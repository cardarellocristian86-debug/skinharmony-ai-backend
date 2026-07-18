import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers, createCoreWriteGuard } from "../src/core-handlers.js";

test("maps MCP tools to Universal Core without forwarding the ChatGPT token", async () => {
  const calls = [];
  const contextCalls = [];
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" }, defaultTenantId: "owner-private", universalCoreKey: "owner-key" }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (new URL(url).pathname === "/v1/runtime/hierarchy/evaluate") {
        return new Response(JSON.stringify({ ok: true, result: { hierarchy_version: "core_runtime_hierarchy_v1", mode: "shadow", router: { route: "V2" }, selected_authority: "V1", parity: { attempted: true, matched: false, fallback: "V1" }, execution_allowed: true } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, path: new URL(url).pathname }), { status: 200, headers: { "content-type": "application/json" } });
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
  await handlers.tenant_provider_openai_setup_link({ ttl_minutes: 10 }, identity);
  await handlers.core_gate_action({ action_label: "deploy", action_type: "release" }, identity);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/healthz", "/v1/runtime/hierarchy/evaluate", "/v1/work/preflight", "/v1/codex/context", "/v1/nira/branches", "/v1/research/plan", "/v1/research/validate", "/v1/nira/core-bridge", "/v1/generic-agents/providers/openai/setup-links", "/v1/action-evaluator"]);
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
  assert.equal(JSON.parse(calls[8].init.body).ttl_minutes, 10);
  assert.equal(JSON.parse(calls[8].init.body).memory_context.revision, 7);
  assert.equal(contextCalls.length, 4);
  assert.equal(contextCalls[2].input.query, "analizza");
  assert.equal(contextCalls[2].input.agent_id, "nyra");
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
      client_allowed: false,
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
  const guard = createCoreWriteGuard({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" }, defaultTenantId: "owner-private", universalCoreKey: "owner-key" }, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const identity = { tenantId: "tenant-a" };
  assert.equal((await guard({ action_label: "write", action_type: "workspace.write", target: "doc" }, identity)).allowed, false);
  const confirmed = await guard({ action_label: "write", action_type: "workspace.write", target: "doc" }, {
    ...identity,
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
