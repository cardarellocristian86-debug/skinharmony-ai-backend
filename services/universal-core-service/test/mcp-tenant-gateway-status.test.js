import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { DEFAULT_AUTOMATION_SCOPES, SCOPES } from "../src/scope.js";

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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stable(value[key])]));
}

function signedOwnerContext(tenantId, body) {
  const binding = `core_action_evaluator\u0000${JSON.stringify(stable(body))}`;
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "oauth",
    owner_verified: true,
    issued_at: new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256").update(binding).digest("hex"),
  };
  const canonical = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", GATEWAY_KEY)
      .update(`owner-context\u0000${canonical}`)
      .digest("hex")}`,
  };
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

test("legacy gateway record gains owner assertion without rotating its key", () => {
  const storageRoot = path.join(os.tmpdir(), `mcp-tenant-gateway-migration-${Date.now()}-${Math.random()}`);
  const keysDir = path.join(storageRoot, "keys");
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(path.join(keysDir, "keys.json"), JSON.stringify([{
    key_id: "key_existing_gateway",
    key_type: "connector",
    key_hash: crypto.createHash("sha256").update(GATEWAY_KEY).digest("hex"),
    tenant_id: "__mcp_tenant_gateway__",
    brand_scope: "",
    label: "MCP verified tenant gateway",
    preset: null,
    allowed_scopes: [...DEFAULT_AUTOMATION_SCOPES],
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    metadata: {
      bootstrap_kind: "mcp_tenant_gateway",
      suite_modules: [],
      suite_limits: {},
      allowed_domains: [],
      suite_policy: { soft_gate: true, hard_block: false },
    },
  }]));

  createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
  });

  const [record] = JSON.parse(fs.readFileSync(path.join(keysDir, "keys.json"), "utf8"));
  assert.equal(record.key_id, "key_existing_gateway");
  assert.equal(record.key_hash, crypto.createHash("sha256").update(GATEWAY_KEY).digest("hex"));
  assert.deepEqual(record.allowed_scopes, [...DEFAULT_AUTOMATION_SCOPES, SCOPES.OWNER_ASSERTION]);
});

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

test("gateway connector accepts only tenant-bound request-bound owner assertions", async (t) => {
  const previousSigningSecret = process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET;
  process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET = SIGNING_SECRET;
  t.after(() => {
    if (previousSigningSecret === undefined) delete process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET;
    else process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET = previousSigningSecret;
  });
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `mcp-tenant-gateway-owner-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
  });
  const { server, base } = await listen(service.app);
  const body = {
    action_label: "Create Work Continuity checkpoint",
    action_type: "dynamic_capability.invoke",
    target: "work_continuity_create",
    operation_class: "owner_confirmed_governed_action",
    external_side_effect: false,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    cross_tenant: false,
    configuration_changes: false,
    destructive: false,
    bypass_orchestrator: false,
    provider_execution: false,
    bounded_scope: true,
    low_impact: true,
    idempotent_or_compensable: true,
    rollback_ready: true,
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
    owner_confirmed: true,
    confirmation_reference: "owner-approved gateway action",
  };

  async function evaluate(tenantContext, ownerContext = signedOwnerContext("tenant-a", body)) {
    const response = await fetch(`${base}/v1/action-evaluator`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${GATEWAY_KEY}`,
        "content-type": "application/json",
        "x-sh-tenant-id": "tenant-a",
        "x-sh-tenant-context": tenantContext,
      },
      body: JSON.stringify({ ...body, owner_context: ownerContext }),
    });
    return { status: response.status, json: await response.json() };
  }

  try {
    const allowed = await evaluate(signedTenantContext("tenant-a"));
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.authorization.allowed, true, JSON.stringify(allowed.json));
    assert.equal(allowed.json.authorization.confirmation_satisfied, true);

    const wrongTenant = await evaluate(signedTenantContext("tenant-b"));
    assert.equal(wrongTenant.status, 403);
    assert.equal(wrongTenant.json.error, "tenant_scope_denied");

    const tamperedOwner = signedOwnerContext("tenant-a", body);
    tamperedOwner.binding_hash = "0".repeat(64);
    const denied = await evaluate(signedTenantContext("tenant-a"), tamperedOwner);
    assert.equal(denied.status, 200);
    assert.equal(denied.json.authorization.allowed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
