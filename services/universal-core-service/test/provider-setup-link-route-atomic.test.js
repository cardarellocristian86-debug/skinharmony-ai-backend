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
    assert.equal(html.includes("b".repeat(48)), false);
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

test("provider setup invalid key re-renders the same one-time form and succeeds exactly once on retry", async () => {
  const storageRoot = path.join(os.tmpdir(), `provider-setup-route-retry-${Date.now()}-${Math.random()}`);
  const token = "a".repeat(48);
  const proof = "b".repeat(48);
  const invalidKey = "sk-proj-invalid key-DO-NOT-ECHO";
  const validKey = "sk-proj-route-retry-12345678901234567890";
  let active = true;
  let persistCalls = 0;
  const tenantProviderSetupLinks = {
    async consumeAndPersist({ token: receivedToken, proof: receivedProof, prepare, persist }) {
      assert.equal(receivedToken, token);
      assert.equal(receivedProof, proof);
      if (!active) return null;
      await prepare();
      const credential = await persist({ tenant_id: "codexai", client: { query() {} } });
      active = false;
      return {
        tenant_id: "codexai",
        link_id: "psl_retry_test",
        owner_subject_fingerprint: `osf_${"c".repeat(64)}`,
        credential,
      };
    },
  };
  const tenantProviderCredentials = {
    async ensureInitialized() {},
    async saveOpenAiInTransaction({ api_key }) {
      persistCalls += 1;
      if (!api_key) throw new Error("openai_api_key_invalid");
      if (api_key === invalidKey) throw new Error("openai_api_key_format_invalid");
      assert.equal(api_key, validKey);
      return { provider: "openai", configured: true };
    },
  };
  const service = createUniversalCoreService({ storageRoot, tenantProviderSetupLinks, tenantProviderCredentials });
  const { server, base } = await listen(service.app);
  const setupUrl = `${base}/v1/generic-agents/providers/openai/setup/${token}`;

  try {
    const initialResponse = await fetch(setupUrl);
    const initialHtml = await initialResponse.text();
    assert.equal(initialResponse.status, 200);
    assert.match(initialHtml, /name="setup_proof" id="setup-proof" value=""/);
    assert.match(initialHtml, /const proof=input\.value\|\|fragmentProof/);

    const emptyResponse = await fetch(setupUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ setup_proof: proof, api_key: "" }),
    });
    const emptyHtml = await emptyResponse.text();
    assert.equal(emptyResponse.status, 400);
    assert.match(emptyHtml, new RegExp(`name="setup_proof" id="setup-proof" value="${proof}"`));
    assert.match(emptyHtml, /Chiave non valida\. Correggila e riprova\./);

    const invalidResponse = await fetch(setupUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ setup_proof: proof, api_key: invalidKey }),
    });
    const invalidHtml = await invalidResponse.text();
    assert.equal(invalidResponse.status, 400);
    assert.match(invalidResponse.headers.get("cache-control") || "", /no-store/);
    assert.equal(invalidResponse.headers.get("referrer-policy"), "no-referrer");
    assert.match(invalidHtml, /Chiave non valida\. Correggila e riprova\./);
    assert.match(invalidHtml, /<form method="post" id="provider-setup-form">/);
    assert.match(invalidHtml, new RegExp(`name="setup_proof" id="setup-proof" value="${proof}"`));
    assert.equal(invalidHtml.includes("DO-NOT-ECHO"), false);
    const passwordInput = invalidHtml.match(/<input name="api_key"[^>]*>/)?.[0] || "";
    assert.ok(passwordInput);
    assert.doesNotMatch(passwordInput, /\bvalue=/);
    const csp = invalidResponse.headers.get("content-security-policy") || "";
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1] || "";
    assert.ok(nonce);
    assert.ok(invalidHtml.includes(`<script nonce="${nonce}">`));

    const auditFile = path.join(storageRoot, "audit", "events.jsonl");
    const auditAfterInvalid = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, "utf8") : "";
    assert.equal(auditAfterInvalid.includes("tenant_openai_provider_setup_completed"), false);
    assert.equal(auditAfterInvalid.includes(invalidKey), false);
    assert.equal(auditAfterInvalid.includes(proof), false);

    const renderedProof = invalidHtml.match(/name="setup_proof" id="setup-proof" value="([A-Za-z0-9_-]+)"/)?.[1];
    assert.equal(renderedProof, proof);
    const successResponse = await fetch(setupUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ setup_proof: renderedProof, api_key: validKey }),
    });
    assert.equal(successResponse.status, 200);
    assert.match(await successResponse.text(), /OpenAI collegato/);

    const replayResponse = await fetch(setupUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ setup_proof: renderedProof, api_key: validKey }),
    });
    assert.equal(replayResponse.status, 410);
    assert.equal(persistCalls, 3);

    const audit = fs.readFileSync(auditFile, "utf8");
    assert.equal((audit.match(/tenant_openai_provider_setup_completed/g) || []).length, 1);
    assert.equal(audit.includes(invalidKey), false);
    assert.equal(audit.includes(validKey), false);
    assert.equal(audit.includes(proof), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("provider setup never re-renders an invalid proof after a key validation error", async () => {
  const storageRoot = path.join(os.tmpdir(), `provider-setup-route-invalid-proof-${Date.now()}-${Math.random()}`);
  const maliciousProof = `"><script>proof-must-not-echo</script>`;
  const tenantProviderSetupLinks = {
    async consumeAndPersist() { throw new Error("openai_api_key_format_invalid"); },
  };
  const tenantProviderCredentials = {
    async ensureInitialized() {},
    async saveOpenAiInTransaction() {},
  };
  const service = createUniversalCoreService({ storageRoot, tenantProviderSetupLinks, tenantProviderCredentials });
  const { server, base } = await listen(service.app);

  try {
    const response = await fetch(`${base}/v1/generic-agents/providers/openai/setup/${"a".repeat(48)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ setup_proof: maliciousProof, api_key: "invalid" }),
    });
    const html = await response.text();
    assert.equal(response.status, 410);
    assert.equal(html.includes("proof-must-not-echo"), false);
    assert.equal(html.includes("provider-setup-form"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("provider setup success returns only the fixed cross-client Nyra portal", async () => {
  const storageRoot = path.join(os.tmpdir(), `provider-setup-route-cross-client-${Date.now()}-${Math.random()}`);
  const submittedKey = "sk-proj-cross-client-route-12345678901234567890";
  const tenantProviderSetupLinks = {
    async consumeAndPersist({ prepare, persist }) {
      await prepare();
      await persist({ tenant_id: "codexai", client: { query() {} } });
      return {
        tenant_id: "codexai",
        link_id: "psl_cross_client_test",
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
    assert.match(html, /href="https:\/\/skinharmony-core-mcp\.onrender\.com\/agents"/);
    assert.equal(html.includes(submittedKey), false);
    assert.equal(html.includes("codexai"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
