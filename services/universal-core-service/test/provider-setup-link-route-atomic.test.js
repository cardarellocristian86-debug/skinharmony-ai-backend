import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("provider setup failure never reports completion or exposes the submitted key", async () => {
  const storageRoot = path.join(os.tmpdir(), `provider-setup-route-atomic-${Date.now()}-${Math.random()}`);
  const submittedKey = "sk-proj-atomic-route-12345678901234567890";
  let persistCalls = 0;
  const tenantProviderSetupLinks = {
    async consumeAndPersist({ prepare, persist }) {
      await prepare();
      return persist({ tenant_id: "codexai", client: { query() {} } });
    },
  };
  const tenantProviderCredentials = {
    async ensureInitialized() {},
    async saveOpenAiInTransaction({ api_key }) {
      persistCalls += 1;
      assert.equal(api_key, submittedKey);
      throw new Error(`database_failure:${api_key}`);
    },
  };
  const service = createUniversalCoreService({
    storageRoot,
    tenantProviderSetupLinks,
    tenantProviderCredentials,
  });
  const { server, base } = await listen(service.app);

  try {
    const response = await fetch(`${base}/v1/generic-agents/providers/openai/setup/${"a".repeat(48)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ setup_proof: "b".repeat(48), api_key: submittedKey }),
    });
    const html = await response.text();
    assert.equal(response.status, 503);
    assert.equal(persistCalls, 1);
    assert.equal(html.includes(submittedKey), false);
    assert.equal(html.includes("database_failure"), false);
    assert.equal(html.includes("OpenAI collegato"), false);

    const auditFile = path.join(storageRoot, "audit", "events.jsonl");
    const audit = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, "utf8") : "";
    assert.equal(audit.includes("tenant_openai_provider_setup_completed"), false);
    assert.equal(audit.includes(submittedKey), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("provider setup success returns only the fixed mobile Nyra portal", async () => {
  const storageRoot = path.join(os.tmpdir(), `provider-setup-route-mobile-${Date.now()}-${Math.random()}`);
  const submittedKey = "sk-proj-mobile-route-12345678901234567890";
  const tenantProviderSetupLinks = {
    async consumeAndPersist({ prepare, persist }) {
      await prepare();
      await persist({ tenant_id: "codexai", client: { query() {} } });
      return {
        tenant_id: "codexai",
        link_id: "psl_mobile_test",
        owner_subject_fingerprint: `osf_${"a".repeat(64)}`,
      };
    },
  };
  const tenantProviderCredentials = {
    async ensureInitialized() {},
    async saveOpenAiInTransaction({ api_key }) { assert.equal(api_key, submittedKey); },
  };
  const service = createUniversalCoreService({ storageRoot, tenantProviderSetupLinks, tenantProviderCredentials });
  const { server, base } = await listen(service.app);
  try {
    const response = await fetch(`${base}/v1/generic-agents/providers/openai/setup/${"a".repeat(48)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ setup_proof: "b".repeat(48), api_key: submittedKey }),
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /OpenAI collegato/);
    assert.match(html, /href="https:\/\/skinharmony-core-mcp\.onrender\.com\/mobile\/agents"/);
    assert.equal(html.includes(submittedKey), false);
    assert.equal(html.includes("codexai"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
