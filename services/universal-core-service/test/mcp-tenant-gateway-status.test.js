import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

const SIGNING_SECRET = "tenant-gateway-core-signing-secret-0123456789";
const GATEWAY_KEY = "tenant-gateway-core-key";
const SETUP_SERVICE_KEY = "provider-setup-service-key";

function signedTenantContext(tenantId) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  const canonical = JSON.stringify(context);
  return Buffer.from(JSON.stringify({
    ...context,
    assertion: `mtc_${crypto.createHmac("sha256", SIGNING_SECRET)
      .update(`mcp-tenant-context\u0000${canonical}`)
      .digest("hex")}`,
  })).toString("base64url");
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function providerStatus(base, key, tenantId, tenantContext) {
  const headers = {
    authorization: `Bearer ${key}`,
    "x-sh-tenant-id": tenantId,
  };
  if (tenantContext) headers["x-sh-tenant-context"] = tenantContext;
  const response = await fetch(`${base}/v1/generic-agents/providers/openai`, { headers });
  return { status: response.status, json: await response.json() };
}

test("gateway GET provider status is tenant-bound and setup service key has no read authority", async (t) => {
  const previousSigningSecret = process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET;
  process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET = SIGNING_SECRET;
  t.after(() => {
    if (previousSigningSecret === undefined) delete process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET;
    else process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET = previousSigningSecret;
  });
  const statusCalls = [];
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `mcp-tenant-gateway-status-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    providerSetupLinkServiceKey: SETUP_SERVICE_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
    tenantProviderCredentials: {
      async status({ tenant_id }) {
        statusCalls.push(tenant_id);
        return { provider: "openai", configured: true, execution_enabled: false };
      },
    },
  });
  const { server, base } = await listen(service.app);

  try {
    const allowed = await providerStatus(base, GATEWAY_KEY, "tenant-a", signedTenantContext("tenant-a"));
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.tenant_id, "tenant-a");
    assert.equal(allowed.json.provider.configured, true);
    assert.deepEqual(statusCalls, ["tenant-a"]);

    const mismatched = await providerStatus(base, GATEWAY_KEY, "tenant-a", signedTenantContext("tenant-b"));
    assert.equal(mismatched.status, 403);
    assert.equal(mismatched.json.error, "tenant_scope_denied");

    const missingContext = await providerStatus(base, GATEWAY_KEY, "tenant-a", "");
    assert.equal(missingContext.status, 403);
    assert.equal(missingContext.json.error, "tenant_scope_denied");

    const setupServiceRead = await providerStatus(
      base,
      SETUP_SERVICE_KEY,
      "tenant-a",
      signedTenantContext("tenant-a"),
    );
    assert.equal(setupServiceRead.status, 403);
    assert.equal(setupServiceRead.json.error, "tenant_scope_denied");
    assert.deepEqual(statusCalls, ["tenant-a"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
