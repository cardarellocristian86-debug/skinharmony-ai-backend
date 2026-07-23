import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers, createCoreWriteGuard } from "../src/core-handlers.js";
import { PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS } from "../../universal-core-service/src/providerSetupLinkBinding.js";

const OWNER_CONTEXT_SECRET = "test-owner-context-signing-secret-0123456789";

function providerSetupOwner(tenantId = "tenant-a", overrides = {}) {
  return {
    tenantId,
    kind: "oauth",
    subject: "google-oauth2|owner-test",
    role: "owner_root",
    godMode: true,
    providerSetupOwner: true,
    ...overrides,
  };
}

function issuedProviderSetupLink(tenantId = "tenant-a") {
  return {
    ok: true,
    tenant_id: tenantId,
    setup_url: `https://core.test/v1/generic-agents/providers/openai/setup/${"a".repeat(32)}`,
    setup_proof: "p".repeat(40),
    link_id: `psl_${"l".repeat(24)}`,
    expires_at: "2030-01-01T00:00:00.000Z",
  };
}

test("maps MCP tools to Universal Core without forwarding the ChatGPT token", async () => {
  const calls = [];
  const contextCalls = [];
  const handlers = createCoreHandlers({ publicUrl: "https://mcp.test", universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" }, universalCoreProviderSetupLinkKeys: { "tenant-a": "provider-setup-link-key" }, defaultTenantId: "owner-private", universalCoreKey: "owner-key" }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (new URL(url).pathname === "/v1/runtime/hierarchy/evaluate") {
        return new Response(JSON.stringify({ ok: true, result: { hierarchy_version: "core_runtime_hierarchy_v1", mode: "shadow", router: { route: "V2" }, selected_authority: "V1", parity: { attempted: true, matched: false, fallback: "V1" }, execution_allowed: true } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const path = new URL(url).pathname;
      if (path === "/v1/generic-agents/providers/openai") {
        return new Response(JSON.stringify({ ok: true, path, tenant_id: "tenant-a" }), { status: 200, headers: { "content-type": "application/json" } });
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
  await handlers.work_preflight({ request: "publish GitHub PR", agent_id: "codex-test", client_type: "codex", session_id: "session-core-one", domain_pack: "analyzer", available_capabilities: ["github_connected_app"] }, identity);
  await handlers.nyra_runtime_context({ include_control_snapshot: true, domain_pack: "analyzer" }, identity);
  await handlers.nyra_branch_catalog({}, identity);
  await handlers.research_plan({ question: "ricerca fonti", allowed_domains: ["example.org"], domain_pack: "analyzer" }, identity);
  await handlers.research_validate({ evidence_pack: { question: "ricerca", sources: [], claims: [] }, domain_pack: "analyzer" }, identity);
  await handlers.nyra_interpret_request({ message: "analizza", session_id: "s1", domain_pack: "analyzer", nyra_branches: ["context_intelligence"] }, identity);
  await handlers.tenant_provider_openai_status({}, identity);
  const setupPortal = await handlers.tenant_provider_openai_setup_link({}, providerSetupOwner());
  await handlers.core_gate_action({ action_label: "deploy", action_type: "release" }, identity);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/healthz", "/v1/runtime/hierarchy/evaluate", "/v1/work/preflight", "/v1/codex/context", "/v1/nira/branches", "/v1/research/plan", "/v1/research/validate", "/v1/nira/core-bridge", "/v1/generic-agents/providers/openai", "/v1/action-evaluator"]);
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert(calls.filter((call) => call.init.body && new URL(call.url).pathname !== "/v1/runtime/hierarchy/evaluate").every((call) => JSON.parse(call.init.body).tenant_id === "tenant-a"));
  assert.equal(JSON.parse(calls[1].init.body).core_input.context.tenant_id, "tenant-a");
  assert.deepEqual(JSON.parse(calls[2].init.body).available_capabilities, ["github_connected_app"]);
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
  assert.equal(calls[8].init.method, "GET");
  assert.deepEqual(setupPortal.structuredContent, {
    ok: true,
    tenant_id: "tenant-a",
    setup_url: "https://mcp.test/connect/openai",
    execution_enabled: false,
  });
  assert.equal(contextCalls.length, 4);
  assert.equal(contextCalls[2].input.query, "analizza");
  assert.equal(contextCalls[2].input.agent_id, "nyra");
});

test("uses the dedicated provider setup-link key only for its exact Core route", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "normal-core-key" },
    universalCoreProviderSetupLinkKeys: { "tenant-a": "one-time-link-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(issuedProviderSetupLink()), { status: 200 });
    },
  });

  await handlers.tenant_provider_openai_status({}, { tenantId: "tenant-a" });
  const link = await handlers.issueOwnerOpenAiSetupLink(providerSetupOwner(), 10);

  assert.equal(calls[0].init.headers.authorization, "Bearer normal-core-key");
  assert.equal(calls[1].init.headers.authorization, "Bearer one-time-link-key");
  assert.equal(new URL(calls[1].url).pathname, "/v1/generic-agents/providers/openai/setup-links");
  assert.equal(JSON.stringify(calls).includes("normal-core-key"), true);
  assert.equal(JSON.stringify(calls[1]).includes("normal-core-key"), false);
  assert.equal(JSON.parse(calls[1].init.body).tenant_id, "tenant-a");
  assert.match(JSON.parse(calls[1].init.body).owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
  assert.equal(link.link_id, `psl_${"l".repeat(24)}`);
});

test("reports bounded provider readiness without treating the global execution switch as onboarding", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "normal-core-key" },
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      tenant_id: "tenant-a",
      provider: { configured: true, execution_available: true, execution_enabled: false, key_hint: "sk-proj-...1234" },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const result = await handlers.tenant_provider_openai_status({}, { tenantId: "tenant-a" });
  assert.equal(result.structuredContent.provider.configured, true);
  assert.equal(result.structuredContent.provider.execution_enabled, false);
  assert.equal(result.structuredContent.provider.bounded_execution_ready, true);
  assert.equal(result.structuredContent.provider.onboarding_required, false);
  assert.equal(result.structuredContent.provider.readiness_rule, "configured_and_execution_available");
  assert.equal(JSON.stringify(result).includes("normal-core-key"), false);
});

test("Core gate overwrites caller confirmation and tenant fields with verified identity", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
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
  assert.equal(calls[0].tenant_id, "tenant-a");
  assert.equal(calls[0].authenticated_tenant_id, undefined);
  assert.equal(calls[0].owner_confirmed, false);
  assert.equal(calls[0].confirmation_reference, undefined);
  assert.equal(calls[0].owner_context.owner_verified, false);

  await handlers.core_gate_action(untrusted, { tenantId: "tenant-a", godMode: true, ownerConfirmed: false });
  assert.equal(calls[1].owner_confirmed, false);
  assert.equal(calls[1].confirmation_reference, undefined);

  await handlers.core_gate_action(untrusted, {
    tenantId: "tenant-a",
    kind: "oauth",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "verified owner confirmation",
  });
  assert.equal(calls[2].tenant_id, "tenant-a");
  assert.equal(calls[2].owner_confirmed, true);
  assert.equal(calls[2].confirmation_reference, "verified owner confirmation");
  assert.equal(calls[2].owner_context.tenant_id, "tenant-a");
  assert.match(calls[2].owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
});

test("Core gate preserves governed memory and agent presence for the exact admin bootstrap envelope", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { codexai: "codexai-key" },
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

test("Core gate builds the provider binding envelope itself and rejects caller-supplied scope", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { codexai: "codexai-core-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
    runtimeBuildCommit: "b".repeat(40),
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
    operation_class: PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS,
    target_commit: "a".repeat(40),
    target_service: "caller-controlled-service",
    provider_execution: true,
    unknown_side_effect: "must-not-reach-core",
  }, {
    tenantId: "codexai",
    kind: "oauth",
    ...providerSetupOwner("codexai"),
    ownerConfirmed: true,
    confirmationReference: "owner confirmed exact scoped binding",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenant_id, "codexai");
  assert.equal(calls[0].authenticated_tenant_id, "codexai");
  assert.equal(calls[0].target_service, "skinharmony-universal-core");
  assert.equal(calls[0].target_commit, "b".repeat(40));
  assert.equal(calls[0].provider_execution, false);
  assert.equal(calls[0].owner_confirmed, true);
  assert.equal(calls[0].unknown_side_effect, undefined);
  assert.equal(calls[0].render_blueprint_id, "exs-d99edqgki2s73e29nug");
  assert.match(calls[0].owner_context.approval_digest, /^pslb_[a-f0-9]{64}$/);
  assert.match(calls[0].owner_context.assertion, /^ocs_[a-f0-9]{64}$/);

  await assert.rejects(
    handlers.core_gate_action({
      operation_class: PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS,
      target_commit: "a".repeat(40),
    }, {
      kind: "codex",
      tenantId: "codexai",
      role: "owner_root",
      godMode: true,
      ownerConfirmed: true,
    }),
    /owner_required/,
  );

  await assert.rejects(
    handlers.core_gate_action({
      operation_class: PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS,
      target_commit: "a".repeat(40),
    }, {
      tenantId: "codexai",
      role: "standard",
      godMode: true,
      ownerConfirmed: true,
    }),
    /owner_required/,
  );
  assert.equal(calls.length, 1);
});

test("never falls back to a normal Core key when the scoped provider key is absent", async () => {
  let called = false;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "normal-core-key" },
    universalCoreProviderSetupLinkKeys: {},
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async () => { called = true; throw new Error("must not call Core"); },
  });

  await assert.rejects(
    handlers.issueOwnerOpenAiSetupLink(providerSetupOwner()),
    /provider_setup_link_key_missing/,
  );
  assert.equal(called, false);
});

test("does not resolve inherited object properties as provider setup-link keys", async () => {
  let called = false;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreProviderSetupLinkKeys: {},
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async () => { called = true; throw new Error("must not call Core"); },
  });

  await assert.rejects(
    handlers.issueOwnerOpenAiSetupLink(providerSetupOwner("toString")),
    /provider_setup_link_key_missing/,
  );
  assert.equal(called, false);
});

test("requires a verified owner before issuing a provider setup link", async () => {
  let called = false;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreProviderSetupLinkKeys: { "tenant-a": "one-time-link-key" },
  }, {
    fetchImpl: async () => { called = true; throw new Error("must not call Core"); },
  });

  await assert.rejects(
    handlers.tenant_provider_openai_setup_link({}, { tenantId: "tenant-a", godMode: false, role: "standard" }),
    /owner_required/,
  );
  assert.equal(called, false);
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

test("marks preflight owner confirmation satisfied only for a verified owner identity", async () => {
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
            execution_allowed_by_preflight: false,
          },
        },
        governance: {
          owner_confirmation_required: false,
          owner_confirmation_satisfied: false,
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
  assert.equal(ownerResult.structuredContent.governance.owner_confirmation_satisfied, true);
  assert.equal(ownerResult.structuredContent.governance.owner_identity_verified, true);
  assert.equal(ownerResult.structuredContent.governance.execution_allowed_by_preflight, true);
  assert.equal(ownerResult.structuredContent.work_preflight.governance.owner_confirmation_satisfied, true);
  assert.equal(ownerResult.structuredContent.work_preflight.governance.owner_identity_verified, true);
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
  assert.equal(standardResult.structuredContent.governance.owner_identity_verified, undefined);
  assert.equal(standardResult.structuredContent.work_preflight.governance.owner_confirmation_satisfied, false);
  assert.equal(standardResult.structuredContent.work_preflight.governance.owner_identity_verified, undefined);
  assert.equal(standardResult.structuredContent.work_preflight.governance.execution_allowed_by_preflight, false);
  assert.equal(calls[3].owner_confirmed, false);
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

test("adds automatic shared-memory bootstrap to a generic first work_preflight call", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "codexai": "tenant-core-key" },
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      work_preflight: {
        preflight_id: "preflight-bootstrap",
        state: "completed_read_only",
        governance: { execution_allowed_by_preflight: true },
      },
    }), { status: 200 }),
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
  });
  const result = await handlers.work_preflight({ request: "Dimmi lo stato corrente", agent_id: "codex-bootstrap", client_type: "codex", session_id: "session-bootstrap" }, { tenantId: "codexai" });
  assert.equal(result.structuredContent.shared_memory_bootstrap.loaded, true);
  assert.equal(result.structuredContent.shared_memory_bootstrap.tenant_id, "codexai");
  assert.equal(result.structuredContent.work_preflight.shared_memory_bootstrap.loaded, true);
});

test("write guard fails closed on hard blocks and allows controlled writes", async () => {
  const calls = [];
  const replies = [
    { authorization: { allowed: false, state: "confirmation_required", mediation: "confirm", confirmation_required: true, confirmation_satisfied: false } },
    { authorization: { allowed: true, state: "authorized_after_confirmation", mediation: "confirmed", confirmation_required: true, confirmation_satisfied: true } },
    { verdict: { decision: "unknown", action_mediation: { state: "unknown" } } },
    { verdict: { decision: "allow_controlled", action_mediation: { state: "allow" } } },
  ];
  const guard = createCoreWriteGuard({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" }, defaultTenantId: "owner-private", universalCoreKey: "owner-key", ownerContextSigningSecret: OWNER_CONTEXT_SECRET }, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const identity = { tenantId: "tenant-a" };
  assert.equal((await guard({ action_label: "write", action_type: "workspace.write", target: "doc" }, identity)).allowed, false);
  const confirmed = await guard({ action_label: "write", action_type: "workspace.write", target: "doc" }, {
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
  assert.equal((await guard({
    action_label: "external research",
    action_type: "research.external_web_search",
    target: "query",
    operation_class: "billable_external_read",
    external_side_effect: true,
  }, identity)).allowed, true);
  assert.equal(calls[3].operation_class, "billable_external_read");
  assert.equal(calls[3].external_side_effect, true);
  assert.equal(calls[3].rollback_ready, false);
});
