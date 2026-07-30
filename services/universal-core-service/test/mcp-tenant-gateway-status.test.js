import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { DEFAULT_AUTOMATION_SCOPES, SCOPES } from "../src/scope.js";

const TENANT_CONTEXT_SIGNING_SECRET = "tenant-context-signing-secret-0123456789";
const OWNER_CONTEXT_SIGNING_SECRET = "owner-context-signing-secret-0123456789";
const GATEWAY_KEY = "tenant-gateway-core-key-0123456789";
const SETUP_SERVICE_KEY = "provider-setup-service-key";

function signedTenantContext(tenantId, secret = TENANT_CONTEXT_SIGNING_SECRET) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  const canonical = JSON.stringify(context);
  return Buffer.from(JSON.stringify({
    ...context,
    assertion: `mtc_${crypto.createHmac("sha256", secret)
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

async function providerRequest(base, {
  method = "GET",
  pathname = "",
  key = "",
  tenantId = "tenant-a",
  tenantContext = "",
  body,
} = {}) {
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  if (tenantId) headers["x-sh-tenant-id"] = tenantId;
  if (tenantContext) headers["x-sh-tenant-context"] = tenantContext;
  const response = await fetch(`${base}/v1/generic-agents/providers/openai${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
    tenantContextSigningSecret: TENANT_CONTEXT_SIGNING_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SIGNING_SECRET,
  });

  const [record] = JSON.parse(fs.readFileSync(path.join(keysDir, "keys.json"), "utf8"));
  assert.equal(record.key_id, "key_existing_gateway");
  assert.equal(record.key_hash, crypto.createHash("sha256").update(GATEWAY_KEY).digest("hex"));
  assert.deepEqual(record.allowed_scopes, [...DEFAULT_AUTOMATION_SCOPES, SCOPES.OWNER_ASSERTION]);
});

test("weak gateway bootstrap material fails closed without creating a gateway record", async () => {
  const storageRoot = path.join(
    os.tmpdir(),
    `mcp-tenant-gateway-weak-${Date.now()}-${Math.random()}`,
  );
  const service = createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: "too-short",
    tenantContextSigningSecret: TENANT_CONTEXT_SIGNING_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SIGNING_SECRET,
  });
  const { server, base } = await listen(service.app);
  try {
    const response = await fetch(`${base}/healthz`);
    const health = await response.json();
    assert.equal(
      health.host_native_governance.mcp_tenant_gateway_configured,
      false,
    );
    const keysFile = path.join(storageRoot, "keys", "keys.json");
    assert.deepEqual(
      fs.existsSync(keysFile)
        ? JSON.parse(fs.readFileSync(keysFile, "utf8"))
        : [],
      [],
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("provider retirement happens before tenant authentication or vault access", async () => {
  let statusCalls = 0;
  const service = createUniversalCoreService({
    storageRoot: path.join(
      os.tmpdir(),
      `mcp-tenant-context-weak-${Date.now()}-${Math.random()}`,
    ),
    mcpTenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: "too-short",
    ownerContextSigningSecret: OWNER_CONTEXT_SIGNING_SECRET,
    tenantProviderCredentials: {
      async status() {
        statusCalls += 1;
        throw new Error("weak tenant context must fail before provider access");
      },
    },
  });
  const { server, base } = await listen(service.app);
  try {
    const retired = await providerRequest(base, {
      key: GATEWAY_KEY,
      tenantId: "tenant-a",
      tenantContext: signedTenantContext("tenant-a", "too-short"),
    });
    assert.equal(retired.status, 410);
    assert.equal(retired.json.error, "native_agent_provider_retired");
    assert.equal(statusCalls, 0);
    const healthResponse = await fetch(`${base}/healthz`);
    const health = await healthResponse.json();
    assert.equal(
      health.host_native_governance.tenant_context_signing_configured,
      false,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("every legacy provider and setup route is retired before a vault or runner can run", async (t) => {
  const previousSigningSecret = process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET;
  process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET = OWNER_CONTEXT_SIGNING_SECRET;
  t.after(() => {
    if (previousSigningSecret === undefined) delete process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET;
    else process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET = previousSigningSecret;
  });
  const providerCalls = [];
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `mcp-tenant-gateway-status-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    providerSetupLinkServiceKey: SETUP_SERVICE_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SIGNING_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SIGNING_SECRET,
    tenantProviderCredentials: {
      async status({ tenant_id }) {
        providerCalls.push(`vault-status:${tenant_id}`);
        return { provider: "openai", configured: true, execution_enabled: false };
      },
      async getOpenAiForExecution() {
        providerCalls.push("vault-execution");
        return { api_key: "must-not-be-read" };
      },
    },
    tenantProviderSetupLinks: {
      async issue() {
        providerCalls.push("setup-link");
        return null;
      },
    },
    tenantOpenAiMultiAgentRunner: {
      start() { providerCalls.push("runner-start"); },
      get() { providerCalls.push("runner-get"); },
      cancel() { providerCalls.push("runner-cancel"); },
    },
  });
  const { server, base } = await listen(service.app);

  try {
    const requests = [
      { method: "GET" },
      { method: "PUT", body: { api_key: "must-not-be-accepted" } },
      { method: "DELETE" },
      { method: "GET", pathname: "/setup/opaque-capability" },
      { method: "POST", pathname: "/setup/opaque-capability", body: { api_key: "must-not-be-accepted" } },
      { method: "POST", pathname: "/setup-links", body: { owner_context: {} } },
      { method: "POST", pathname: "/multi-agent-runs", body: { task: "must-not-run" } },
      { method: "GET", pathname: "/multi-agent-runs/run-retired" },
      { method: "POST", pathname: "/multi-agent-runs/run-retired/result", body: { run_id: "run-retired" } },
      { method: "POST", pathname: "/multi-agent-runs/run-retired/cancel", body: { run_id: "run-retired" } },
    ];
    for (const request of requests) {
      const retired = await providerRequest(base, {
        ...request,
        // A retired path must have the same response even when no bearer
        // key or tenant assertion accompanies an old bookmarked setup link.
        key: "",
        tenantId: "",
      });
      assert.equal(retired.status, 410, `${request.method} ${request.pathname || "/"}`);
      assert.equal(retired.json.error, "native_agent_provider_retired");
      assert.equal(retired.json.message, "Provider execution is retired. Use native ChatGPT/Codex specialists.");
    }
    assert.deepEqual(providerCalls, []);

    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.governed_agent_runner.mode, "manual_dry_run");
    assert.equal(health.governed_agent_runner.provider_execution_available, false);
    assert.equal(health.governed_agent_runner.native_specialists_only, true);
    assert.equal(health.tenant_provider_vault.retired, true);
    assert.equal(health.tenant_provider_vault.execution_available, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway connector accepts only tenant-bound request-bound owner assertions", async (t) => {
  const previousSigningSecret = process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET;
  process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET = OWNER_CONTEXT_SIGNING_SECRET;
  t.after(() => {
    if (previousSigningSecret === undefined) delete process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET;
    else process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET = previousSigningSecret;
  });
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `mcp-tenant-gateway-owner-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SIGNING_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SIGNING_SECRET,
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
