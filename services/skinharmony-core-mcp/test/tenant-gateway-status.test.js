import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";

const SIGNING_SECRET = "tenant-gateway-status-signing-secret-0123456789";

test("provider status GET carries the tenant id with its signed gateway context", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: {},
    universalCoreKey: "",
    defaultTenantId: "owner-private",
    tenantGatewayKey: "tenant-gateway-key",
    ownerContextSigningSecret: SIGNING_SECRET,
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        ok: true,
        tenant_id: "tenant-a",
        provider: { configured: true, execution_available: true, execution_enabled: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handlers.tenant_provider_openai_status({}, { tenantId: "tenant-a" });

  assert.equal(result.structuredContent.tenant_id, "tenant-a");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/v1/generic-agents/providers/openai");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, "Bearer tenant-gateway-key");
  assert.equal(calls[0].init.headers["x-sh-tenant-id"], "tenant-a");

  const context = JSON.parse(Buffer.from(
    calls[0].init.headers["x-sh-tenant-context"],
    "base64url",
  ).toString("utf8"));
  assert.equal(context.version, "mcp_tenant_context_v1");
  assert.equal(context.tenant_id, "tenant-a");
  const canonical = JSON.stringify({
    version: context.version,
    tenant_id: context.tenant_id,
    issued_at: context.issued_at,
  });
  const expected = `mtc_${crypto.createHmac("sha256", SIGNING_SECRET)
    .update(`mcp-tenant-context\u0000${canonical}`)
    .digest("hex")}`;
  assert.equal(context.assertion, expected);
});
