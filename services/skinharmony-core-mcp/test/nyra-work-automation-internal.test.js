import assert from "node:assert/strict";
import test from "node:test";

import { createNyraWorkAutomationInternal } from "../src/nyra-work-automation-internal.js";

test("internal bridge derives the verifier and uses the tenant gateway", async () => {
  const calls = [];
  const bridge = createNyraWorkAutomationInternal({
    coreRequest: async (...args) => { calls.push(args); return { ok: true }; },
    resolveSystemVerifier: async () => ({ agent_id: "system-verifier" }),
  });
  const response = await bridge.nyra_work_automation_ci_verify({
    work_id: "work", agent_id: "builder", repository: "o/r",
    verifier_agent_id: "caller-selected", system_assigned: false,
  }, { tenantId: "tenant" });
  assert.equal(response.structuredContent.ok, true);
  assert.equal(calls[0][1], "tenant");
  assert.equal(calls[0][2].body.verifier_agent_id, "system-verifier");
  assert.equal(calls[0][2].body.system_assigned, true);
  assert.equal(calls[0][2].useTenantGateway, true);
});

test("caller cannot become its own verifier", async () => {
  const bridge = createNyraWorkAutomationInternal({ coreRequest: async () => ({}), resolveSystemVerifier: async () => ({ agent_id: "builder" }) });
  await assert.rejects(bridge.nyra_work_automation_ci_verify({ work_id: "work", agent_id: "builder" }, { tenantId: "tenant" }), /independent_verifier_required/);
});

test("plan resolves immutable Work intent server-side and strips caller self-attestation", async () => {
  const calls = [];
  const resolver = async (identity, work_id) => ({ schema_version: "standing_release_intent_binding_v1", source: "mcp_work_continuity_postgres", tenant_id: identity.tenantId, work_id, intent_anchor_immutable: true });
  Object.defineProperty(resolver, "trusted", { value: true });
  const bridge = createNyraWorkAutomationInternal({ coreRequest: async (...args) => { calls.push(args); return { ok: true }; }, resolveIntentBinding: resolver });
  await bridge.nyra_work_automation_plan({ work_id: "work", repository: "o/r", intent_objective: "forged", intent_anchor_receipt: { forged: true } }, { tenantId: "tenant" });
  assert.equal(calls[0][0], "/v1/nyra/work-automation/plan");
  assert.equal(calls[0][2].body.intent_objective, undefined);
  assert.equal(calls[0][2].body.intent_anchor_receipt, undefined);
  const untrusted = createNyraWorkAutomationInternal({ coreRequest: async () => ({}), resolveIntentBinding: async () => ({}) });
  await assert.rejects(untrusted.nyra_work_automation_plan({ work_id: "work" }, { tenantId: "tenant" }), /intent_resolver_unavailable/);
});

test("connector bridge maps every late-stage transition to the tenant Core gateway", async () => {
  const calls = [];
  const bridge = createNyraWorkAutomationInternal({ coreRequest: async (...args) => { calls.push(args); return { ok: true }; } });
  const mappings = [
    ["nyra_work_automation_builder_bind", "/builder/bind"],
    ["nyra_work_automation_builder_begin", "/builder/begin"],
    ["nyra_work_automation_commit_attest", "/commit/attest"],
    ["nyra_work_automation_builder_report", "/builder-report"],
    ["nyra_work_automation_push_record", "/push/record"],
    ["nyra_work_automation_pull_request_ready", "/pull-request/ready"],
    ["nyra_work_automation_readiness_record", "/readiness/record"],
    ["nyra_work_automation_core_join_record", "/core-join/record"],
    ["nyra_work_automation_merge_record", "/merge/record"],
    ["nyra_work_automation_deployment_readback", "/deployment/readback"],
    ["nyra_work_automation_services_observe", "/services/observe"],
    ["nyra_work_automation_acceptance_finalize", "/acceptance/finalize"],
    ["nyra_work_automation_closure_finalize", "/closure/finalize"],
  ];
  for (const [method] of mappings) await bridge[method]({ work_id: "work" }, { tenantId: "tenant" });
  assert.deepEqual(calls.map((call) => call[0]), mappings.map(([, suffix]) => `/v1/nyra/work-automation/work${suffix}`));
  assert.ok(calls.every((call) => call[1] === "tenant" && call[2].method === "POST" && call[2].useTenantGateway === true));
});
