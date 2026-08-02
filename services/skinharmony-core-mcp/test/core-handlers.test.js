import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createCoreHandlers, createCoreWriteGuard } from "../src/core-handlers.js";

const OWNER_CONTEXT_SECRET = "test-owner-context-signing-secret-0123456789";
const TENANT_CONTEXT_SECRET = "test-tenant-context-signing-secret-0123456789";
const TENANT_GATEWAY_KEY = "test-tenant-gateway-key-0123456789abcdef";

function expectedOwnerAssertion(secret, context) {
  const canonical = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    owner_subject_fingerprint: context.owner_subject_fingerprint,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
    approval_digest: context.approval_digest,
  });
  return `ocs_${crypto.createHmac("sha256", secret)
    .update(`owner-context\u0000${canonical}`)
    .digest("hex")}`;
}

test("maps MCP tools to Universal Core without forwarding the ChatGPT token", async () => {
  const calls = [];
  const contextCalls = [];
  const handlers = createCoreHandlers({ publicUrl: "https://mcp.test", universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" }, defaultTenantId: "owner-private", universalCoreKey: "owner-key", tenantGatewayKey: TENANT_GATEWAY_KEY, tenantContextSigningSecret: TENANT_CONTEXT_SECRET }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (new URL(url).pathname === "/v1/runtime/hierarchy/evaluate") {
        return new Response(JSON.stringify({ ok: true, result: { hierarchy_version: "core_runtime_hierarchy_v1", mode: "shadow", router: { route: "V2" }, selected_authority: "V1", parity: { attempted: true, matched: false, fallback: "V1" }, execution_allowed: true } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const path = new URL(url).pathname;
      if (path === "/v1/nira/core-bridge") {
        return new Response(JSON.stringify({
          ok: true,
          path,
          result: {
            core_runtime: {
              hierarchy_version: "core_runtime_hierarchy_v1",
              mode: "shadow",
              router: { route: "V2" },
              selected_authority: "V1",
              parity: { attempted: true, matched: false, fallback: "V1" },
              execution_allowed: false,
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, path }), { status: 200, headers: { "content-type": "application/json" } });
    },
    contextProvider: async (input, identity) => {
      contextCalls.push({ input, identity });
      return { schema_version: "tenant_memory_context_v1", tenant_id: identity.tenantId, revision: 7, relevant_memories: [] };
    },
  });
  const identity = { tenantId: "tenant-a" };
  await handlers.core_health({}, identity);
  await handlers.work_preflight({
    request: "publish GitHub PR",
    agent_id: "codex-test",
    client_type: "codex",
    session_id: "session-core-one",
    domain_pack: "analyzer",
    available_capabilities: ["github_connected_app"],
    evidence_state: { source_count: 0, confidence: 0, freshness_state: "unknown", evidence_gap: true },
    research_allowed_domains: ["docs.github.com"],
  }, identity);
  await handlers.nyra_runtime_context({ include_control_snapshot: true, domain_pack: "analyzer" }, identity);
  await handlers.nyra_branch_catalog({}, identity);
  await handlers.research_plan({ question: "ricerca fonti", allowed_domains: ["example.org"], domain_pack: "analyzer" }, identity);
  await handlers.research_validate({ evidence_pack: { question: "ricerca", sources: [], claims: [] }, domain_pack: "analyzer" }, identity);
  await handlers.nyra_interpret_request({ message: "analizza", session_id: "s1", domain_pack: "analyzer", nyra_branches: ["context_intelligence"] }, identity);
  await handlers.core_gate_action({ action_label: "deploy", action_type: "release" }, identity);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/healthz", "/v1/runtime/hierarchy/evaluate", "/v1/work/preflight", "/v1/codex/context", "/v1/nira/branches", "/v1/research/plan", "/v1/research/validate", "/v1/nira/core-bridge", "/v1/action-evaluator"]);
  assert(calls.filter((_, index) => ![2, calls.length - 1].includes(index)).every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert.equal(calls[2].init.headers.authorization, `Bearer ${TENANT_GATEWAY_KEY}`);
  assert.ok(calls[2].init.headers["x-sh-tenant-context"]);
  assert.equal(calls.at(-1).init.headers.authorization, `Bearer ${TENANT_GATEWAY_KEY}`);
  assert.ok(calls.at(-1).init.headers["x-sh-tenant-context"]);
  assert(calls.filter((call) => call.init.body && new URL(call.url).pathname !== "/v1/runtime/hierarchy/evaluate").every((call) => JSON.parse(call.init.body).tenant_id === "tenant-a"));
  assert.equal(JSON.parse(calls[1].init.body).core_input.context.tenant_id, "tenant-a");
  assert.deepEqual(JSON.parse(calls[2].init.body).available_capabilities, ["github_connected_app"]);
  assert.equal(JSON.parse(calls[2].init.body).evidence_state.evidence_gap, true);
  assert.deepEqual(JSON.parse(calls[2].init.body).research_allowed_domains, ["docs.github.com"]);
  assert.deepEqual(JSON.parse(calls[2].init.body).host_native, {
    requested: false,
    host_type: "codex_native",
    provider_execution: false,
    provider_api_key_required: false,
    server_model_calls: 0,
    host_spawn_required: true,
    host_policy_override: false,
    host_policy_must_allow: true,
  });
  assert.equal(JSON.stringify(JSON.parse(calls[2].init.body).host_native).includes("OPENAI_API_KEY"), false);
  assert.equal("domain_pack" in JSON.parse(calls[2].init.body), false);
  assert.equal("domain_pack" in JSON.parse(calls[3].init.body), false);
  assert.equal("domain_pack" in JSON.parse(calls[5].init.body), false);
  assert.equal("domain_pack" in JSON.parse(calls[6].init.body), false);
  assert.equal("domain_pack" in JSON.parse(calls[7].init.body), false);
  assert.deepEqual(JSON.parse(calls[5].init.body).allowed_domains, ["example.org"]);
  assert.equal(JSON.parse(calls[6].init.body).evidence_pack.question, "ricerca");
  assert.deepEqual(JSON.parse(calls[7].init.body).nyra_branches, ["context_intelligence"]);
  assert.equal(JSON.parse(calls[2].init.body).memory_context.tenant_id, "tenant-a");
  assert.equal(JSON.parse(calls[7].init.body).memory_context.revision, 7);
  assert.equal("core_runtime" in JSON.parse(calls[7].init.body), false);
  assert.equal(contextCalls.length, 4);
  assert.equal(contextCalls[2].input.query, "analizza");
  assert.equal(contextCalls[2].input.agent_id, "nyra");
});

test("Core gate overwrites caller confirmation and tenant fields with verified identity", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      calls.push({ body: JSON.parse(init.body), headers: init.headers });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const untrusted = {
    action_label: "attempt provider binding",
    action_type: "render_blueprint_environment_binding",
    owner_confirmed: true,
    confirmation_reference: "caller supplied confirmation",
    tenant_id: "codexai",
    authenticated_tenant_id: "codexai",
  };

  await handlers.core_gate_action(untrusted, { tenantId: "tenant-a", godMode: false, ownerConfirmed: false });
  assert.equal(calls[0].body.tenant_id, "tenant-a");
  assert.equal(calls[0].body.authenticated_tenant_id, undefined);
  assert.equal(calls[0].body.owner_confirmed, false);
  assert.equal(calls[0].body.confirmation_reference, undefined);
  assert.equal(calls[0].body.owner_context.owner_verified, false);
  assert.equal(calls[0].headers.authorization, `Bearer ${TENANT_GATEWAY_KEY}`);
  assert.equal(calls[0].headers["x-sh-tenant-id"], "tenant-a");
  assert.ok(calls[0].headers["x-sh-tenant-context"]);

  await handlers.core_gate_action(untrusted, { tenantId: "tenant-a", godMode: true, ownerConfirmed: false });
  assert.equal(calls[1].body.owner_confirmed, false);
  assert.equal(calls[1].body.confirmation_reference, undefined);

  await handlers.core_gate_action(untrusted, {
    tenantId: "tenant-a",
    kind: "oauth",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "verified owner confirmation",
  });
  assert.equal(calls[2].body.tenant_id, "tenant-a");
  assert.equal(calls[2].body.owner_confirmed, true);
  assert.equal(calls[2].body.confirmation_reference, "verified owner confirmation");
  assert.equal(calls[2].body.owner_context.tenant_id, "tenant-a");
  assert.match(calls[2].body.owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
  assert.equal(
    calls[2].body.owner_context.assertion,
    expectedOwnerAssertion(TENANT_GATEWAY_KEY, calls[2].body.owner_context),
  );
  assert.notEqual(
    calls[2].body.owner_context.assertion,
    expectedOwnerAssertion(OWNER_CONTEXT_SECRET, calls[2].body.owner_context),
  );
});

test("bounded internal coordination never borrows owner identity or confirmation", async () => {
  let body;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { codexai: "codexai-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        ok: true,
        authorization: { allowed: true },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await handlers.core_gate_action({
    action_label: "Record native verifier report",
    action_type: "native_agent.report",
    operation_class: "bounded_internal_coordination_write",
    target: "work_continuity_native_report",
    idempotency_key: "native-report-0001",
    external_side_effect: false,
  }, {
    tenantId: "codexai",
    kind: "codex",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "owner session",
  });

  assert.equal(body.tenant_id, "codexai");
  assert.equal(body.owner_confirmed, false);
  assert.equal(body.confirmation_reference, undefined);
  assert.equal(body.owner_context, undefined);
});

test("Core gate preserves governed memory and agent presence for the exact admin bootstrap envelope", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { codexai: "codexai-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    contextProvider: async (_input, identity) => ({
      schema_version: "tenant_memory_context_v1",
      tenant_id: identity.tenantId,
      revision: 2,
      relevant_memories: [],
    }),
  });
  const environmentVariables = [
    "CORE_ADMIN_SESSION_SECRET",
    "CORE_ADMIN_BOOTSTRAP_USERNAME",
    "CORE_ADMIN_BOOTSTRAP_PASSWORD",
  ];
  await handlers.core_gate_action({
    action_label: "Configure Core Admin Control Room bootstrap references",
    action_type: "environment_configuration",
    operation_class: "reversible_owner_confirmed_core_admin_bootstrap_configuration",
    external_side_effect: true,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    values_present_in_envelope: false,
    cross_tenant: false,
    destructive: false,
    bypass_orchestrator: false,
    rollback_ready: true,
    audit_ready: true,
    readback_required: true,
    configuration_changes: true,
    environment: "production",
    target: "skinharmony-core-nyra-admin-login",
    target_service: "skinharmony-universal-core",
    target_service_id: "srv-d82c9j3tqb8s73cgriag",
    resource_type: "render_environment_variable_bundle",
    render_environment_update: true,
    other_environment_changes: false,
    create_missing_only: true,
    overwrite_existing: false,
    current_values_present: false,
    rollback_remove_new_variables: true,
    allowed_environment_variables: environmentVariables,
    auth0_changes: false,
    database_changes: false,
    storage_changes: false,
    domain_changes: false,
    scaling_changes: false,
    merge: false,
    deploy: false,
    production_deploy: false,
    delete: false,
    provider_execution: false,
    execution_enabled: false,
    force: false,
    admin_bypass: false,
    target_commit: "1".repeat(40),
    confirmation_target_commit: "1".repeat(40),
    confirmation_target_service: "skinharmony-universal-core",
    confirmation_target_service_id: "srv-d82c9j3tqb8s73cgriag",
    confirmation_environment_variables: environmentVariables,
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-admin-bootstrap",
    agent_id: "connected_ai",
    client_type: "chatgpt",
    session_id: "session-admin-bootstrap",
    memory_context: {
      schema_version: "tenant_memory_context_v1",
      tenant_id: "caller-controlled",
      revision: 999,
    },
  }, {
    tenantId: "codexai",
    kind: "oauth",
    subject: "oauth|owner",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "owner-confirmed-admin-bootstrap",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenant_id, "codexai");
  assert.equal(calls[0].memory_context.tenant_id, "codexai");
  assert.equal(calls[0].memory_context.revision, 2);
  assert.equal(calls[0].agent_id, "connected_ai");
  assert.equal(calls[0].client_type, "chatgpt");
  assert.equal(calls[0].session_id, "session-admin-bootstrap");
  assert.equal(calls[0].owner_confirmed, true);
  assert.match(calls[0].owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
  assert.deepEqual(calls[0].allowed_environment_variables, environmentVariables);
});

test("Core gate discards caller memory when governed context is unavailable", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { codexai: "codexai-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await handlers.core_gate_action({
    action_label: "Configure Core Admin Control Room bootstrap references",
    action_type: "environment_configuration",
    operation_class: "reversible_owner_confirmed_core_admin_bootstrap_configuration",
    memory_context: {
      schema_version: "tenant_memory_context_v1",
      tenant_id: "codexai",
      revision: 999,
    },
  }, {
    tenantId: "codexai",
    kind: "oauth",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "owner-confirmed-admin-bootstrap",
  });

  assert.equal(calls.length, 1);
  assert.equal("memory_context" in calls[0], false);
});

test("retires provider setup and run handlers from the MCP Core bridge", () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  });
  assert.equal(
    Object.keys(handlers).some((name) => name.startsWith("tenant_provider_openai_")),
    false,
  );
  assert.equal(Object.hasOwn(handlers, "issueOwnerOpenAiSetupLink"), false);
});

test("rejects a tenant without its own Core key", async () => {
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: {}, defaultTenantId: "owner-private", universalCoreKey: "owner-key" });
  await assert.rejects(handlers.core_health({}, { tenantId: "tenant-b" }), /core_tenant_key_missing/);
});

test("runtime hierarchy is tenant-scoped, redacts V2 fallback details, and never authorizes execution", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ path: new URL(url).pathname, body: init.body ? JSON.parse(init.body) : null, authorization: init.headers.authorization });
      return new Response(JSON.stringify({
        ok: true,
        result: {
          hierarchy_version: "core_runtime_hierarchy_v1",
          mode: "shadow",
          router: { route: "V0" },
          selected_authority: "V0",
          parity: { attempted: true, matched: false, fallback: "V1", error: "worker timeout: internal details" },
          execution_allowed: true,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handlers.core_runtime_hierarchy_evaluate({
    request: "high-risk decision",
    core_input: { context: { tenant_id: "forged-tenant" }, signals: [{ id: "risk", severity: 100 }] },
  }, { tenantId: "tenant-a" });
  const runtime = result.structuredContent.core_runtime;
  assert.equal(calls[0].body.core_input.context.tenant_id, "tenant-a");
  assert.equal(calls[0].authorization, "Bearer tenant-a-key");
  assert.equal(runtime.selected_authority, "V0");
  assert.equal(runtime.parity.fallback, "V1");
  assert.equal(runtime.parity.error, "v2_unavailable_or_mismatch");
  assert.equal(runtime.execution_allowed, false);
  assert.equal(JSON.stringify(result).includes("tenant-a-key"), false);
  assert.equal(JSON.stringify(result).includes("worker timeout"), false);
});

test("direct Nyra interpretation accepts only the Core bridge hierarchy verdict", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ path, body });
      return new Response(JSON.stringify({
        ok: true,
        tenant_id: "tenant-a",
        result: {
          selected_by_core: { primary_action_label: "Analyze", risk_band: "low" },
          core_runtime: {
            hierarchy_version: "core_runtime_hierarchy_v1",
            mode: "active",
            router: { route: "V2" },
            selected_authority: "V2",
            parity: { attempted: true, matched: true, fallback: null },
            execution_allowed: false,
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handlers.nyra_interpret_request({
    message: "Analizza la richiesta",
    session_id: "session-nyra-runtime",
    selected_authority: "V0",
    core_input: {
      selected_authority: "V0",
      signals: [{ id: "bounded", severity: 10, risk_hint: 10, reversibility_hint: 90 }],
    },
  }, { tenantId: "tenant-a" });

  assert.deepEqual(calls.map((call) => call.path), ["/v1/nira/core-bridge"]);
  assert.equal("core_runtime" in calls[0].body, false);
  assert.equal("selected_authority" in calls[0].body, false);
  assert.equal(result.structuredContent.core_runtime.selected_authority, "V2");
  assert.equal(result.structuredContent.core_runtime.execution_allowed, false);

  const narration = JSON.parse(result.content[0].text);
  assert.equal(narration.core_route, "V2");
  assert.equal(narration.core_authority, "V2");
  assert.equal(narration.execution_allowed, false);

  const cached = await handlers.nyra_fetch_analysis({
    analysis_id: result.structuredContent.analysis_id,
  }, { tenantId: "tenant-a" });
  assert.equal(cached.structuredContent.core_runtime.selected_authority, "V2");
});

test("direct Nyra interpretation fails closed when the Core bridge hierarchy is unavailable", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async (url) => {
      calls.push(new URL(url).pathname);
      return new Response(JSON.stringify({ ok: false, error: "runtime_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    handlers.nyra_interpret_request({
      message: "Analizza senza Core",
      session_id: "session-nyra-fail-closed",
    }, { tenantId: "tenant-a" }),
    (error) =>
      error.message === "core_request_failed:503:runtime_unavailable" &&
      error.code === "runtime_unavailable" &&
      error.statusCode === 503,
  );
  assert.deepEqual(calls, ["/v1/nira/core-bridge"]);
});

test("reports owner binding checks without exposing OAuth identifiers", async () => {
  const subject = "oauth-subject-private";
  const clientId = "oauth-client-private";
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["tenant-a"],
    godModeSubjects: [subject],
    godModeClientIds: [],
    godModeCodexEnabled: true,
  }, {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const result = await handlers.core_health({}, {
    kind: "oauth",
    subject,
    clientId,
    tenantId: "tenant-a",
    role: "owner_root",
    godMode: true,
  });

  assert.deepEqual(result.structuredContent.mcp_identity, {
    kind: "oauth",
    role: "owner_root",
    god_mode: true,
    owner_confirmation_satisfied: true,
    binding_checks: {
      enabled: true,
      emergency_stop: false,
      tenant_allowed: true,
      subject_allowed: true,
      codex_delegate_allowed: false,
    },
  });
  assert.equal(JSON.stringify(result).includes(subject), false);
  assert.equal(JSON.stringify(result).includes(clientId), false);
});

test("preflight preserves an explicit Core owner verdict", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      if (new URL(url).pathname === "/v1/runtime/hierarchy/evaluate") return new Response(JSON.stringify({ ok: true, result: { mode: "shadow", router: { route: "V1" }, selected_authority: "V1", parity: { attempted: false, matched: null }, execution_allowed: false } }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({
        ok: true,
        work_preflight: {
          preflight_id: "preflight-real-shape",
          governance: {
            owner_confirmation_required: false,
            owner_confirmation_satisfied: false,
            owner_identity_verified: false,
            execution_allowed_by_preflight: false,
          },
        },
        governance: {
          owner_confirmation_required: false,
          owner_confirmation_satisfied: false,
          owner_identity_verified: false,
          execution_allowed_by_preflight: true,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const ownerResult = await handlers.work_preflight({ request: "read status", agent_id: "chatgpt-test", client_type: "chatgpt", session_id: "session-owner-status" }, {
    kind: "oauth",
    tenantId: "tenant-a",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
  });
  assert.equal(ownerResult.structuredContent.governance.owner_confirmation_satisfied, false);
  assert.equal(ownerResult.structuredContent.governance.owner_identity_verified, false);
  assert.equal(ownerResult.structuredContent.governance.execution_allowed_by_preflight, true);
  assert.equal(ownerResult.structuredContent.work_preflight.governance.owner_confirmation_satisfied, false);
  assert.equal(ownerResult.structuredContent.work_preflight.governance.owner_identity_verified, false);
  assert.equal(ownerResult.structuredContent.work_preflight.governance.execution_allowed_by_preflight, false);
  assert.equal(calls[1].owner_confirmed, true);
  assert.equal(calls[1].owner_context.assertion_version, "owner_context_assertion_v1");
  assert.equal(calls[1].owner_context.tenant_id, "tenant-a");
  assert.match(calls[1].owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(calls[1].owner_context).includes("tenant-a-key"), false);

  const standardResult = await handlers.work_preflight({ request: "read status", agent_id: "chatgpt-test", client_type: "chatgpt", session_id: "session-owner-status" }, {
    kind: "oauth",
    tenantId: "tenant-a",
  });
  assert.equal(standardResult.structuredContent.governance.owner_confirmation_satisfied, false);
  assert.equal(standardResult.structuredContent.governance.owner_identity_verified, false);
  assert.equal(standardResult.structuredContent.work_preflight.governance.owner_confirmation_satisfied, false);
  assert.equal(standardResult.structuredContent.work_preflight.governance.owner_identity_verified, false);
  assert.equal(standardResult.structuredContent.work_preflight.governance.execution_allowed_by_preflight, false);
  assert.equal(calls[3].owner_confirmed, false);
});

test("preflight uses verified local owner identity only for legacy Core fields", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/v1/runtime/hierarchy/evaluate") {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            mode: "shadow",
            router: { route: "V1" },
            selected_authority: "V1",
            parity: { attempted: false, matched: null },
            execution_allowed: false,
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        ok: true,
        work_preflight: { governance: { execution_allowed_by_preflight: false } },
        governance: { execution_allowed_by_preflight: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handlers.work_preflight({
    request: "read legacy status",
    agent_id: "chatgpt-test",
    client_type: "chatgpt",
    session_id: "session-owner-legacy",
  }, {
    kind: "oauth",
    tenantId: "tenant-a",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
  });
  assert.equal(result.structuredContent.governance.owner_confirmation_satisfied, true);
  assert.equal(result.structuredContent.governance.owner_identity_verified, true);
  assert.equal(result.structuredContent.work_preflight.governance.owner_confirmation_satisfied, true);
  assert.equal(result.structuredContent.work_preflight.governance.owner_identity_verified, true);
});

test("maps the complete intelligence toolset to tenant-scoped Core routes", async () => {
  const calls = [];
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" } }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
    contextProvider: async (_input, identity) => ({ tenant_id: identity.tenantId, revision: 1 }),
  });
  const identity = { tenantId: "tenant-a" };
  await handlers.intelligence_workflow({ request: "analyze", domain_pack: "analyzer" }, identity);
  await handlers.scenario_analysis({ question: "scenarios" }, identity);
  await handlers.hypothesis_rank({ question: "why", hypotheses: [{ id: "a" }, { id: "b" }] }, identity);
  await handlers.event_probability({ question: "events", events: [{ id: "e" }] }, identity);
  await handlers.counterfactual_analysis({ question: "what if", baseline: { id: "b" }, alternatives: [{ id: "a" }] }, identity);
  await handlers.decision_select({ decision: "choose", options: [{ id: "a" }, { id: "b" }] }, identity);
  await handlers.outcome_verify({ predicted_probability: 0.8, actual_outcome: true }, identity);
  await handlers.outcome_record({ outcome_id: "o1", predicted_probability: 0.8, actual_outcome: true }, identity);
  await handlers.calibration_status({ limit: 10 }, identity);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/v1/intelligence/workflow",
    "/v1/nira/core-bridge",
    "/v1/intelligence/scenarios",
    "/v1/intelligence/hypotheses/rank",
    "/v1/intelligence/events/evaluate",
    "/v1/intelligence/counterfactuals/evaluate",
    "/v1/intelligence/decisions/select",
    "/v1/intelligence/outcomes/verify",
    "/v1/intelligence/outcomes/record",
    "/v1/intelligence/calibration",
  ]);
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert.equal("domain_pack" in JSON.parse(calls[0].init.body), false);
  assert.equal("domain_pack" in JSON.parse(calls[1].init.body), false);
  assert(calls.slice(0, 9).every((call) => JSON.parse(call.init.body).tenant_id === "tenant-a"));
  assert(calls.slice(0, 9).every((call) => JSON.parse(call.init.body).memory_context.tenant_id === "tenant-a"));
  assert.match(JSON.parse(calls[1].init.body).text, /Interpreta e spiega/);
});

test("opens the tenant Gallery and shared memory on the first work_preflight call", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "codexai": "tenant-core-key" },
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (new URL(url).pathname === "/v1/runtime/hierarchy/evaluate") {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            mode: "shadow",
            router: { route: "V1" },
            selected_authority: "V1",
            parity: { attempted: false, matched: null },
            execution_allowed: false,
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ok: true,
        work_preflight: {
          preflight_id: "preflight-bootstrap",
          state: "completed_read_only",
          operational_surface: "tenant_work_gallery",
          gallery_version: "tenant_work_gallery_v1",
          tenant_work_gallery: {
            schema_version: "tenant_work_gallery_v1",
            tenant_id: "codexai",
            available: true,
            state: "ready",
            work_count: 1,
            works: [{ work_id: "11111111-1111-4111-8111-111111111111" }],
          },
          governance: { execution_allowed_by_preflight: true },
        },
      }), { status: 200 });
    },
    sharedMemoryBootstrap: {
      load: async (identity) => ({
        loaded: true,
        tenant_id: identity.tenantId,
        generated_at: "2026-07-14T18:45:29.447Z",
        active_task_count: 107,
        active_lock_count: 24,
        artifact_count: 890,
        latest_handoff: null,
        recent_tasks: [],
        recent_artifacts: [],
      }),
    },
    tenantWorkGallery: {
      load: async (identity) => ({
        schema_version: "tenant_work_gallery_v1",
        tenant_id: identity.tenantId,
        filters: { status: "active" },
        works: [{
          work_id: "11111111-1111-4111-8111-111111111111",
          project_id: "gallery",
          status: "active",
          current_version: 4,
          next_action: "run canary",
          active_participants: 2,
          active_leases: 1,
          active_branches: 3,
        }],
      }),
    },
  });
  const result = await handlers.work_preflight({ request: "Dimmi lo stato corrente", agent_id: "codex-bootstrap", client_type: "codex", session_id: "session-bootstrap" }, { tenantId: "codexai" });
  assert.equal(result.structuredContent.shared_memory_bootstrap.loaded, true);
  assert.equal(result.structuredContent.shared_memory_bootstrap.tenant_id, "codexai");
  assert.equal(result.structuredContent.work_preflight.shared_memory_bootstrap.loaded, true);
  assert.equal(result.structuredContent.operational_surface, "tenant_work_gallery");
  assert.equal(result.structuredContent.gallery_version, "tenant_work_gallery_v1");
  assert.equal(result.structuredContent.tenant_work_gallery.state, "ready");
  assert.equal(result.structuredContent.tenant_work_gallery.work_count, 1);
  const preflightCall = calls.find((call) => new URL(call.url).pathname === "/v1/work/preflight");
  assert.equal(preflightCall.body.gallery_context.tenant_id, "codexai");
  assert.equal(preflightCall.body.gallery_context.works[0].next_action, "run canary");
});

test("binds host-native delegation and action routes to OAuth owner and server presence", async () => {
  const calls = [];
  let ticketReadCount = 0;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-core-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
    godModeEnabled: true,
    godModeTenantIds: ["tenant-a"],
    godModeCodexEnabled: true,
    godModeEmergencyStop: false,
  }, {
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({
        path,
        method: init.method,
        body: init.body ? JSON.parse(init.body) : undefined,
        headers: init.headers,
      });
      if (
        init.method === "GET" &&
        path === "/v1/host-native/actions/hnt_ticket-12345678"
      ) {
        ticketReadCount += 1;
        return new Response(JSON.stringify({
          ok: true,
          tenant_id: "tenant-a",
          action_ticket: {
            state: ticketReadCount === 1 ? "reserved" : "reconciliation_required",
            uses: 1,
            ticket: {
              schema_version: "host_native_action_ticket_v1",
              tenant_id: "tenant-a",
              ticket_id: "hnt_ticket-12345678",
              delegation_id: "hnd_delegation-12345678",
              work_id: "work-1",
              intent_anchor_digest: "b".repeat(64),
              repository: "owner/repo",
              host_kind: "chatgpt_native",
              host_session_fingerprint: "a".repeat(64),
              action: { kind: "git.push.branch" },
              evidence_digest: "d".repeat(64),
              issued_at: "2026-08-02T10:00:00.000Z",
              expires_at: "2026-08-02T11:00:00.000Z",
              max_uses: 1,
              host_policy_override: false,
              host_policy_must_allow: true,
              provider_execution: false,
              signature: `hnt_${"1".repeat(64)}`,
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (path.endsWith("/authorize-finalize")) {
        return new Response(JSON.stringify({
          ok: true,
          finalize_authorization: {
            trusted: true,
            allowed: true,
            target_commit: "c".repeat(40),
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        action_ticket: {
          ticket: {
            ticket_id: "hnt_ticket-12345678",
          },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const identity = {
    tenantId: "tenant-a",
    kind: "oauth",
    subject: "auth0|verified-owner",
    role: "tenant_owner",
    oauthOwnerElevated: true,
    ownerConfirmed: true,
    confirmationReference: "confirmed bounded native release",
    agentPresence: {
      client_type: "chatgpt",
      session_fingerprint: "a".repeat(64),
    },
  };
  const delegation = await handlers.host_native_delegation_issue({
    work_id: "work-1",
    intent_anchor_digest: "b".repeat(64),
    repository: "owner/repo",
    audience: ["chatgpt_native", "codex_native"],
    allowed_branches: ["agent/*", "main"],
    protected_branches: ["main"],
    allowed_path_prefixes: ["services"],
    allowed_actions: ["git.commit", "git.push.branch"],
    ttl_seconds: 3_600,
  }, identity);
  await handlers.host_native_action_authorize({
    delegation_id: "hnd_delegation-12345678",
    work_id: "work-1",
    intent_anchor_digest: "b".repeat(64),
    repository: "owner/repo",
    action: {
      kind: "git.push.branch",
      repository: "owner/repo",
      branch: "agent/change",
      source_commit: "c".repeat(40),
      expected_remote_commit: null,
      force: false,
      delete_ref: false,
      tags: false,
      induced_effects: [],
      provider_execution: false,
    },
    evidence_digest: "d".repeat(64),
  }, identity);
  await handlers.host_native_action_reserve({
    ticket_id: "hnt_ticket-12345678",
  }, identity);
  await handlers.host_native_action_complete({
    ticket_id: "hnt_ticket-12345678",
    reservation_id: "hnr_reservation-12345678",
    outcome: "success",
    result_digest: "e".repeat(64),
    result_commit: "c".repeat(40),
    readback_digest: "1".repeat(64),
  }, identity);
  await handlers.host_native_action_reconcile({
    ticket_id: "hnt_ticket-12345678",
    observed_outcome: "success",
    readback_digest: "f".repeat(64),
    observed_commit: "c".repeat(40),
  }, identity);
  const closure = await handlers.host_native_action_closure_receipt({
    ticket_id: "hnt_ticket-12345678",
  }, identity);

  assert.equal(delegation.structuredContent.dedicated_core_gate.authorized, true);
  assert.deepEqual(calls.map((call) => call.path), [
    "/v1/host-native/delegations",
    "/v1/host-native/actions/authorize",
    "/v1/host-native/actions/hnt_ticket-12345678/reserve",
    "/v1/host-native/actions/hnt_ticket-12345678",
    "/v1/host-native/actions/hnt_ticket-12345678/complete",
    "/v1/host-native/actions/hnt_ticket-12345678",
    "/v1/host-native/actions/hnt_ticket-12345678/reconcile",
    "/v1/host-native/actions/hnt_ticket-12345678/authorize-finalize",
  ]);
  assert.equal(calls[0].body.owner_confirmed, true);
  assert.equal(calls[0].body.owner_context.role, "tenant_owner");
  const ownerContext = calls[0].body.owner_context;
  const expectedOwnerFingerprint = `osf_${crypto.createHmac("sha256", OWNER_CONTEXT_SECRET)
    .update("host-native-owner\u0000auth0|verified-owner")
    .digest("hex")}`;
  assert.equal(ownerContext.owner_subject_fingerprint, expectedOwnerFingerprint);
  const ownerCanonical = JSON.stringify({
    version: ownerContext.assertion_version,
    audience: ownerContext.audience,
    tenant_id: ownerContext.tenant_id,
    access_mode: ownerContext.access_mode,
    role: ownerContext.role,
    delegated_actor: ownerContext.delegated_actor,
    owner_verified: ownerContext.owner_verified,
    owner_subject_fingerprint: ownerContext.owner_subject_fingerprint,
    issued_at: ownerContext.issued_at,
    binding_version: ownerContext.binding_version,
    binding_hash: ownerContext.binding_hash,
  });
  const expectedOwnerAssertion = `ocs_${crypto.createHmac("sha256", OWNER_CONTEXT_SECRET)
    .update(`owner-context\u0000${ownerCanonical}`)
    .digest("hex")}`;
  assert.equal(ownerContext.assertion, expectedOwnerAssertion);
  assert.equal(JSON.stringify(calls).includes("auth0|verified-owner"), false);
  assert.equal(calls[1].body.host_kind, "chatgpt_native");
  assert.equal(calls[1].body.host_session_fingerprint, "a".repeat(64));
  assert.equal(calls[2].body.host_session_fingerprint, "a".repeat(64));
  assert.equal(calls[4].body.result_commit, "c".repeat(40));
  assert.equal(calls[6].body.observed_commit, "c".repeat(40));
  assert.equal(calls[7].body.host_session_fingerprint, "a".repeat(64));
  assert.equal(closure.structuredContent.finalize_authorization.trusted, true);
  assert.equal(calls[0].headers.authorization, "Bearer tenant-core-key");
  assert.equal(calls[0].headers["x-sh-tenant-id"], undefined);
  for (const call of calls.slice(1, 8)) {
    assert.equal(call.headers.authorization, `Bearer ${TENANT_GATEWAY_KEY}`);
    assert.equal(call.headers["x-sh-tenant-id"], "tenant-a");
    const tenantContext = JSON.parse(Buffer.from(
      call.headers["x-sh-tenant-context"], "base64url",
    ).toString("utf8"));
    assert.equal(tenantContext.version, "mcp_tenant_context_v1");
    assert.equal(tenantContext.tenant_id, "tenant-a");
    assert.match(tenantContext.assertion, /^mtc_[a-f0-9]{64}$/);
  }

  const codexGoodModeDelegation = await handlers.host_native_delegation_issue({
    work_id: "work-1",
    intent_anchor_digest: "b".repeat(64),
    repository: "owner/repo",
    audience: ["codex_native"],
    allowed_branches: ["agent/*"],
    allowed_path_prefixes: ["services"],
    allowed_actions: ["git.commit"],
    ttl_seconds: 3_600,
    idempotency_key: "codex-good-mode-delegation",
  }, {
    tenantId: "tenant-a",
    kind: "codex",
    subject: "codex",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: false,
    confirmationReference: "",
    agentPresence: {
      client_type: "codex",
      session_fingerprint: "b".repeat(64),
    },
  });
  assert.equal(codexGoodModeDelegation.structuredContent.dedicated_core_gate.authorized, true);
  const codexContext = calls.at(-1).body.owner_context;
  assert.equal(calls.at(-1).body.owner_confirmed, true);
  assert.match(calls.at(-1).body.confirmation_reference, /^god_mode_codex:[a-f0-9]{40}$/);
  assert.equal(codexContext.access_mode, "god_mode");
  assert.equal(codexContext.role, "owner_root");
  assert.equal(codexContext.delegated_actor, "codex");
  assert.equal(codexContext.owner_subject_fingerprint, `osf_${crypto.createHmac("sha256", OWNER_CONTEXT_SECRET)
    .update("host-native-codex-owner\u0000codex")
    .digest("hex")}`);

  const codexDelegationArgs = {
    work_id: "work-1",
    intent_anchor_digest: "b".repeat(64),
    repository: "owner/repo",
    audience: ["codex_native"],
    allowed_branches: ["agent/*"],
    allowed_path_prefixes: ["services"],
    allowed_actions: ["git.commit"],
    ttl_seconds: 3_600,
    idempotency_key: "codex-standard-delegation",
  };
  await assert.rejects(
    handlers.host_native_delegation_issue(codexDelegationArgs, {
      tenantId: "tenant-a",
      kind: "codex",
      subject: "codex",
      role: "standard",
      godMode: false,
    }),
    /owner_required/,
  );

  const emergencyStopHandlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-core-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
    godModeEnabled: true,
    godModeTenantIds: ["tenant-a"],
    godModeCodexEnabled: true,
    godModeEmergencyStop: true,
  }, {
    fetchImpl: async () => {
      throw new Error("must not call Core");
    },
  });
  await assert.rejects(
    emergencyStopHandlers.host_native_delegation_issue(codexDelegationArgs, {
      tenantId: "tenant-a",
      kind: "codex",
      subject: "codex",
      role: "owner_root",
      godMode: true,
    }),
    /owner_required/,
  );

  let missingOwnerSecretCalled = false;
  const missingOwnerSecretHandlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-core-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
  }, {
    fetchImpl: async () => {
      missingOwnerSecretCalled = true;
      throw new Error("must not call Core");
    },
  });
  await assert.rejects(
    missingOwnerSecretHandlers.host_native_delegation_issue({
      work_id: "work-1",
      intent_anchor_digest: "b".repeat(64),
      repository: "owner/repo",
      audience: ["codex_native"],
      allowed_branches: ["agent/*"],
      allowed_path_prefixes: ["services"],
      allowed_actions: ["git.commit"],
      ttl_seconds: 3_600,
    }, identity),
    /host_native_owner_context_signing_unavailable/,
  );
  assert.equal(missingOwnerSecretCalled, false);
});

test("validates the real host-native ticket readback shape fail-closed", async () => {
  const ticketId = "hnt_ticket-12345678";
  const fingerprint = "a".repeat(64);
  const identity = {
    tenantId: "tenant-a",
    agentPresence: { client_type: "codex", session_fingerprint: fingerprint },
  };
  const validPayload = () => ({
    ok: true,
    tenant_id: "tenant-a",
    action_ticket: {
      state: "reserved",
      uses: 1,
      ticket: {
        schema_version: "host_native_action_ticket_v1",
        tenant_id: "tenant-a",
        ticket_id: ticketId,
        delegation_id: "hnd_delegation-12345678",
        work_id: "work-1",
        intent_anchor_digest: "b".repeat(64),
        repository: "owner/repo",
        host_kind: "codex_native",
        host_session_fingerprint: fingerprint,
        action: { kind: "git.commit" },
        evidence_digest: "c".repeat(64),
        issued_at: "2026-08-02T10:00:00.000Z",
        expires_at: "2026-08-02T11:00:00.000Z",
        max_uses: 1,
        host_policy_override: false,
        host_policy_must_allow: true,
        provider_execution: false,
        signature: `hnt_${"1".repeat(64)}`,
      },
    },
  });
  const invoke = async (mutate = () => {}) => {
    const payload = validPayload();
    mutate(payload);
    const handlers = createCoreHandlers({
      universalCoreUrl: "https://core.test",
      universalCoreKeys: { "tenant-a": "tenant-core-key" },
      tenantGatewayKey: TENANT_GATEWAY_KEY,
      tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
    }, {
      fetchImpl: async (url) => {
        if (new URL(url).pathname === `/v1/host-native/actions/${ticketId}`) {
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    return handlers.host_native_action_complete({
      ticket_id: ticketId,
      reservation_id: "hnr_reservation-12345678",
      outcome: "success",
      result_digest: "b".repeat(64),
    }, identity);
  };

  await invoke();
  await assert.rejects(invoke((value) => { value.tenant_id = "tenant-b"; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.tenant_id = "tenant-b"; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.schema_version = "unknown_record_v1"; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.ticket.tenant_id = "tenant-b"; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.ticket.ticket_id = "hnt_other"; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.ticket.schema_version = "host_native_action_ticket_v0"; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.ticket.host_session_fingerprint = "b".repeat(64); }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.ticket.signature = "hnt_invalid"; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.state = "completed"; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.uses = 0; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.ticket.max_uses = 2; }), /host_native_ticket_readback_invalid/);
  await assert.rejects(invoke((value) => { value.action_ticket.ticket.provider_execution = true; }), /host_native_ticket_readback_invalid/);
});

test("host-native action automation fails closed without the tenant gateway and never falls back", async () => {
  let fetched = false;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "ordinary-tenant-key" },
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
  }, {
    fetchImpl: async () => {
      fetched = true;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    handlers.host_native_action_authorize({
      delegation_id: "hnd_delegation-12345678",
      work_id: "work-1",
      intent_anchor_digest: "b".repeat(64),
      repository: "owner/repo",
      action: { kind: "git.commit" },
      evidence_digest: "d".repeat(64),
    }, {
      tenantId: "tenant-a",
      agentPresence: {
        client_type: "codex",
        session_fingerprint: "a".repeat(64),
      },
    }),
    /core_tenant_gateway_key_missing/,
  );
  assert.equal(fetched, false);
});

test("issues Core Join only through the signed MCP tenant gateway", async () => {
  const calls = [];
  const tenantGatewayKey = "host-native-core-join-tenant-gateway-key";
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-core-key-must-not-be-used" },
    tenantGatewayKey,
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
  }, {
    fetchImpl: async (url, init) => {
      calls.push({
        path: new URL(url).pathname,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return new Response(JSON.stringify({
        ok: true,
        tenant_id: "tenant-a",
        core_join_verdict: {
          verdict: { verdict_id: "hnj_test-gateway" },
        },
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const request = {
    idempotency_key: "core-join-gateway-1",
    work_id: "work-1",
    intent_anchor_digest: "a".repeat(64),
    repository: "owner/repo",
    core_plan_id: `hnp_${"b".repeat(40)}`,
    core_plan_digest: "b".repeat(64),
    local_plan_id: "local-plan-1",
    local_plan_digest: "c".repeat(64),
    evaluation_digest: "d".repeat(64),
    acceptance_criteria: [{
      criterion_id: "tests-green",
      evidence_digest: "e".repeat(64),
      proven: true,
    }],
    builder_report: {
      agent_id: "builder",
      report_digest: "f".repeat(64),
      target_commit: "1".repeat(40),
    },
    verifier_reports: [{
      agent_id: "verifier",
      report_digest: "2".repeat(64),
      reviewed_commit: "1".repeat(40),
      approved: true,
    }],
    checks: {
      commit: "1".repeat(40),
      required_checks: ["unit-tests"],
      checks_digest: "3".repeat(64),
      evidence_digest: "4".repeat(64),
    },
    release_intent: { release_intent_digest: "5".repeat(64) },
  };
  const result = await handlers.host_native_core_join_issue(
    request,
    { tenantId: "tenant-a" },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/v1/host-native/core-join-verdicts");
  assert.equal(calls[0].headers.authorization, `Bearer ${tenantGatewayKey}`);
  assert.equal(calls[0].headers["x-sh-tenant-id"], "tenant-a");
  assert.equal(calls[0].body.tenant_id, undefined);
  assert.equal(calls[0].body.provider_execution, false);
  const context = JSON.parse(Buffer.from(
    calls[0].headers["x-sh-tenant-context"],
    "base64url",
  ).toString("utf8"));
  assert.equal(context.version, "mcp_tenant_context_v1");
  assert.equal(context.tenant_id, "tenant-a");
  const canonical = JSON.stringify({
    version: context.version,
    tenant_id: context.tenant_id,
    issued_at: context.issued_at,
  });
  const expectedAssertion = `mtc_${crypto.createHmac("sha256", TENANT_CONTEXT_SECRET)
    .update(`mcp-tenant-context\u0000${canonical}`)
    .digest("hex")}`;
  assert.equal(context.assertion, expectedAssertion);
  assert.equal(
    result.structuredContent.core_join_verdict.verdict.verdict_id,
    "hnj_test-gateway",
  );

  for (const [configOverride, expectedError] of [
    [{
      tenantGatewayKey,
      ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
    }, /core_tenant_context_signing_unavailable/],
    [{
      tenantGatewayKey: "weak-gateway",
      tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
      ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
    }, /core_tenant_gateway_key_missing/],
  ]) {
    let called = false;
    const failClosedHandlers = createCoreHandlers({
      universalCoreUrl: "https://core.test",
      universalCoreKeys: { "tenant-a": "tenant-core-key-must-not-be-used" },
      ...configOverride,
    }, {
      fetchImpl: async () => {
        called = true;
        throw new Error("must not call Core");
      },
    });
    await assert.rejects(
      failClosedHandlers.host_native_core_join_issue(
        request,
        { tenantId: "tenant-a" },
      ),
      expectedError,
    );
    assert.equal(called, false);
  }
});

test("builds a Core release intent without adding caller-controlled verification evidence", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-core-key" },
  }, {
    fetchImpl: async (url, init) => {
      calls.push({
        path: new URL(url).pathname,
        body: JSON.parse(init.body),
      });
      return new Response(JSON.stringify({
        ok: true,
        tenant_id: "tenant-a",
        release_intent: {
          schema_version: "host_release_intent_v1",
          tenant_id: "tenant-a",
          work_id: "work-1",
          release_intent_digest: "f".repeat(64),
        },
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const verification = {
    builder_agent_id: "persisted-builder",
    verifier_agent_ids: ["persisted-verifier"],
    required_checks: ["unit-tests"],
    checks_commit: "a".repeat(40),
    checks_digest: "b".repeat(64),
    evidence_digest: "c".repeat(64),
  };
  const result = await handlers.host_native_release_intent_build({
    work_id: "work-1",
    intent_anchor_digest: "d".repeat(64),
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch: "main",
    base_commit: "e".repeat(40),
    head_commit: "a".repeat(40),
    tree_sha: "f".repeat(40),
    diff_digest: "1".repeat(64),
    changed_files: ["src/app.js"],
    verification,
    delivery: { method: "manual_render_deploy", services: [] },
    rollback: { ready: true },
    builder_report: { agent_id: "caller-injected" },
  }, { tenantId: "tenant-a" });

  assert.equal(calls[0].path, "/v1/host-native/release-intents");
  assert.deepEqual(calls[0].body.verification, verification);
  assert.equal(calls[0].body.builder_report, undefined);
  assert.equal(calls[0].body.tenant_id, undefined);
  assert.equal(result.structuredContent.dedicated_core_gate.authorized, true);
});

test("write guard fails closed on hard blocks and allows controlled writes", async () => {
  const calls = [];
  const replies = [
    { authorization: { allowed: false, state: "confirmation_required", mediation: "confirm", confirmation_required: true, confirmation_satisfied: false } },
    { authorization: { allowed: true, state: "authorized_after_confirmation", mediation: "confirmed", confirmation_required: true, confirmation_satisfied: true } },
    { verdict: { decision: "allow_controlled", action_mediation: { state: "allow" } } },
  ];
  const guard = createCoreWriteGuard({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" }, defaultTenantId: "owner-private", universalCoreKey: "owner-key", ownerContextSigningSecret: OWNER_CONTEXT_SECRET, tenantGatewayKey: TENANT_GATEWAY_KEY, tenantContextSigningSecret: TENANT_CONTEXT_SECRET }, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const identity = { tenantId: "tenant-a" };
  const safeTask = {
    action_label: "create task",
    action_type: "task.create",
    target: "task",
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
  };
  assert.equal((await guard(safeTask, identity)).allowed, false);
  const confirmed = await guard(safeTask, {
    ...identity,
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "explicit user confirmation",
  });
  assert.equal(confirmed.allowed, true);
  assert.equal(confirmed.confirmation_satisfied, true);
  assert.equal(calls[0].owner_confirmed, false);
  assert.equal(calls[1].owner_confirmed, true);
  assert.equal(calls[1].confirmation_reference, "explicit user confirmation");
  assert.equal(calls[1].rollback_ready, true);
  assert.equal((await guard({ action_label: "write", action_type: "workspace.write", target: "doc" }, identity)).allowed, false);
  assert.equal(calls.length, 2);
  assert.equal((await guard({ ...safeTask, action_type: "deploy", deploy: true }, identity)).allowed, false);
  assert.equal(calls.length, 2);
  assert.equal((await guard({
    action_label: "external research",
    action_type: "research.external_web_search",
    target: "query",
    operation_class: "billable_external_read",
    external_side_effect: true,
  }, identity)).allowed, true);
  assert.equal(calls[2].operation_class, "billable_external_read");
  assert.equal(calls[2].external_side_effect, true);
  assert.equal(calls[2].rollback_ready, false);
});

test("write guard never promotes an explicit Core confirmation denial", async () => {
  const guard = createCoreWriteGuard({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      authorization: {
        allowed: false,
        state: "confirmation_required",
        mediation: "confirm",
        confirmation_required: true,
        confirmation_satisfied: false,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const result = await guard({
    action_label: "Create task",
    action_type: "task.create",
    target: "task",
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
  }, {
    tenantId: "tenant-a",
    kind: "oauth",
    subject: "auth0|verified-owner",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "explicit owner confirmation",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.owner_confirmation_required, true);
  assert.equal(result.confirmation_satisfied, false);
});

test("write guard preserves bounded coordination idempotency through the Core transport", async () => {
  const calls = [];
  const guard = createCoreWriteGuard({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        authorization: {
          allowed: true,
          state: "allow_controlled",
          mediation: "allow",
          confirmation_required: false,
          confirmation_satisfied: false,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const identity = { tenantId: "tenant-a" };
  for (const action of [
    {
      action_label: "Join tenant work",
      action_type: "work.participant.join",
      target: "11111111-1111-4111-8111-111111111111",
      idempotency_key: "gallery-join-operation-0001",
    },
    {
      action_label: "Register signed agent presence",
      action_type: "agent.heartbeat",
      target: "agent:codex-supervisor",
      idempotency_key: "agent.heartbeat:transport-fingerprint-0001",
    },
  ]) {
    const result = await guard({
      ...action,
      operation_class: "bounded_internal_coordination_write",
      external_side_effect: false,
      bounded_scope: true,
      low_impact: true,
      idempotent_or_compensable: true,
      rollback_ready: true,
      audit_ready: true,
      target_authority_verified: true,
      actor_authorized_for_target: true,
    }, identity);
    assert.equal(result.allowed, true);
  }
  assert.deepEqual(calls.map((body) => body.idempotency_key), [
    "gallery-join-operation-0001",
    "agent.heartbeat:transport-fingerprint-0001",
  ]);
  assert(calls.every((body) => body.operation_class === "bounded_internal_coordination_write"));
  assert(calls.every((body) => body.owner_confirmed === false));
});

test("write guard gives a fresh OAuth tenant owner a request-bound continuity bootstrap assertion only", async () => {
  const calls = [];
  const guard = createCoreWriteGuard({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    tenantGatewayKey: TENANT_GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_CONTEXT_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        authorization: {
          allowed: true,
          state: "authorized_after_confirmation",
          mediation: "confirmed",
          confirmation_required: true,
          confirmation_satisfied: true,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const identity = {
    tenantId: "tenant-a",
    kind: "oauth",
    subject: "auth0|bound-tenant-owner",
    role: "tenant_owner",
    oauthOwnerElevated: true,
    ownerConfirmed: true,
    confirmationReference: "create the first client Work Identity",
  };
  const result = await guard({
    action_label: "Create persistent Work Identity",
    action_type: "work.continuity.create",
    target: "client-project",
    operation_class: "owner_confirmed_governed_action",
    external_side_effect: false,
    destructive: false,
    bounded_scope: true,
    low_impact: false,
    idempotent_or_compensable: true,
    rollback_ready: true,
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
  }, identity);
  assert.equal(result.allowed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].owner_confirmed, true);
  assert.equal(calls[0].confirmation_reference, identity.confirmationReference);
  assert.equal(calls[0].owner_context.owner_verified, true);
  assert.equal(calls[0].owner_context.role, "tenant_owner");
  assert.match(calls[0].owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
  assert.equal("internal_owner_assertion_scope" in calls[0], false);
});
