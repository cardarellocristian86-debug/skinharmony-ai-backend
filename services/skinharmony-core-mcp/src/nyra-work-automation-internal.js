function fail(code) { throw new Error(code); }
function result(value) { return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] }; }

export function createNyraWorkAutomationInternal({ coreRequest, resolveSystemVerifier = null, resolveIntentBinding = null } = {}) {
  if (typeof coreRequest !== "function") fail("nyra_work_automation_core_request_unavailable");
  async function invoke(path, method, body, identity) {
    const payload = await coreRequest(path, identity?.tenantId, {
      method,
      ...(body ? { body } : {}),
      useTenantGateway: true,
    });
    return result(payload);
  }
  return Object.freeze({
    nyra_work_automation_status: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}`, "GET", null, identity),
    nyra_work_automation_plan: async (args, identity) => {
      if (typeof resolveIntentBinding !== "function" || resolveIntentBinding.trusted !== true) fail("nyra_work_automation_intent_resolver_unavailable");
      const binding = await resolveIntentBinding(identity, args.work_id);
      if (binding?.schema_version !== "standing_release_intent_binding_v1" || binding.tenant_id !== identity?.tenantId || binding.work_id !== args.work_id || binding.intent_anchor_immutable !== true || binding.source !== "mcp_work_continuity_postgres") fail("nyra_work_automation_intent_binding_invalid");
      const { intent_anchor_digest: _callerIntent, intent_objective: _callerObjective, task_objective_digest: _callerTask, intent_anchor_receipt: _callerReceipt, ...safe } = args;
      return invoke("/v1/nyra/work-automation/plan", "POST", safe, identity);
    },
    nyra_work_automation_builder_bind: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/builder/bind`, "POST", args, identity),
    nyra_work_automation_builder_begin: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/builder/begin`, "POST", args, identity),
    nyra_work_automation_commit_attest: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/commit/attest`, "POST", args, identity),
    nyra_work_automation_builder_report: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/builder-report`, "POST", args, identity),
    nyra_work_automation_push_record: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/push/record`, "POST", args, identity),
    nyra_work_automation_pull_request_ready: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/pull-request/ready`, "POST", args, identity),
    nyra_work_automation_ci_verify: async (args, identity) => {
      if (typeof resolveSystemVerifier !== "function") fail("nyra_work_automation_system_verifier_unavailable");
      const verifier = await resolveSystemVerifier({ tenant_id: identity?.tenantId, work_id: args.work_id });
      if (!verifier?.agent_id || verifier.agent_id === args.agent_id) fail("nyra_work_automation_independent_verifier_required");
      return invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/ci/verify`, "POST", { ...args, verifier_agent_id: verifier.agent_id, system_assigned: true }, identity);
    },
    nyra_work_automation_readiness_record: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/readiness/record`, "POST", args, identity),
    nyra_work_automation_core_join_record: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/core-join/record`, "POST", args, identity),
    nyra_work_automation_merge_record: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/merge/record`, "POST", args, identity),
    nyra_work_automation_deployment_readback: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/deployment/readback`, "POST", args, identity),
    nyra_work_automation_services_observe: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/services/observe`, "POST", args, identity),
    nyra_work_automation_acceptance_finalize: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/acceptance/finalize`, "POST", args, identity),
    nyra_work_automation_closure_finalize: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/closure/finalize`, "POST", args, identity),
    nyra_work_automation_reconcile: (args, identity) => invoke(`/v1/nyra/work-automation/${encodeURIComponent(args.work_id)}/reconcile`, "POST", args, identity),
  });
}
