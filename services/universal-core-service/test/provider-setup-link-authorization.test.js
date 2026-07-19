import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import {
  DEFAULT_AUTOMATION_SCOPES,
  DEFAULT_CONNECTOR_SCOPES,
  KEY_PRESETS,
  SCOPES,
} from "../src/scope.js";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function request(base, method, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("provider setup-link issuance requires only its dedicated tenant-scoped capability", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "provider-setup-scope-admin";
  const issued = [];
  const tenantProviderSetupLinks = {
    async issue(input) {
      issued.push(input);
      return {
        token: "local_test_setup_token_abcdefghijklmnopqrstuvwxyz",
        expires_at: "2026-07-18T20:00:00.000Z",
      };
    },
  };
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `provider-setup-scope-${Date.now()}-${Math.random()}`),
    tenantProviderSetupLinks,
  });
  const { server, base } = await listen(service.app);

  try {
    assert.equal(SCOPES.WRITE_PROVIDER_SETUP_LINK, "write:provider_setup_link");
    assert.equal(DEFAULT_CONNECTOR_SCOPES.includes(SCOPES.WRITE_PROVIDER_SETUP_LINK), false);
    assert.equal(DEFAULT_AUTOMATION_SCOPES.includes(SCOPES.WRITE_PROVIDER_SETUP_LINK), false);
    for (const preset of Object.values(KEY_PRESETS)) {
      assert.equal(preset.scopes.includes(SCOPES.WRITE_PROVIDER_SETUP_LINK), false);
    }

    const dedicated = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      key_type: "connector",
      label: "Tenant-scoped MCP provider setup-link test",
      allowed_scopes: [SCOPES.WRITE_PROVIDER_SETUP_LINK],
    }, "provider-setup-scope-admin");
    assert.equal(dedicated.status, 201);
    assert.deepEqual(dedicated.json.record.allowed_scopes, [SCOPES.WRITE_PROVIDER_SETUP_LINK]);

    const broadLegacy = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      key_type: "connector",
      label: "Legacy decision writer",
      allowed_scopes: [SCOPES.WRITE_DECISION],
    }, "provider-setup-scope-admin");
    assert.equal(broadLegacy.status, 201);

    const deniedLegacy = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "codexai",
      ttl_minutes: 15,
    }, broadLegacy.json.key);
    assert.equal(deniedLegacy.status, 403);
    assert.equal(deniedLegacy.json.error, "scope_denied");

    const allowed = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "codexai",
      ttl_minutes: 15,
    }, dedicated.json.key);
    assert.equal(allowed.status, 201);
    assert.equal(allowed.json.tenant_id, "codexai");
    assert.equal(allowed.json.execution_enabled, false);
    assert.match(allowed.json.setup_url, /\/v1\/generic-agents\/providers\/openai\/setup\//);
    assert.deepEqual(issued, [{ tenant_id: "codexai", ttl_minutes: 15 }]);

    const crossTenant = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "another-tenant",
      ttl_minutes: 15,
    }, dedicated.json.key);
    assert.equal(crossTenant.status, 403);
    assert.equal(crossTenant.json.error, "tenant_scope_denied");
    assert.equal(issued.length, 1);

    const unrelatedWrite = await request(base, "POST", "/v1/generic-agents/runs", {
      tenant_id: "codexai",
      agent_id: "must-not-start",
      task: "This key cannot acquire generic write authority",
    }, dedicated.json.key);
    assert.equal(unrelatedWrite.status, 403);
    assert.equal(unrelatedWrite.json.error, "scope_denied");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
