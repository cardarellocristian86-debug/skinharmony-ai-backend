import crypto from "node:crypto";

export const AI_RUNTIME_TELEMETRY_PRODUCER_VERSION = "ai_runtime_telemetry_producer_v0_16";

const HORIZONTAL_BRANCHES = new Set([
  "agent_orchestration",
  "agentic_efficiency_intelligence",
  "ai_evaluation_intelligence",
  "ai_orchestration",
]);

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  return value;
}

function text(value, field, max = 160) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || normalized.includes("\u0000")) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")}`;
}

function taskDigest(value) {
  const normalized = String(value ?? "");
  const durable = /^task_digest:(sha256:[a-f0-9]{64})$/.exec(normalized);
  return durable ? durable[1] : digest(value);
}

function workerResultDigest(result) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  for (const field of ["evidence_digest", "result_digest"]) {
    const value = String(source[field] || "");
    if (/^sha256:[a-f0-9]{64}$/.test(value)) return value;
  }
  if (Array.isArray(source.evidence) && source.evidence.length) {
    return digest(source.evidence);
  }
  return digest(source);
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function elapsedMs(from, to) {
  const start = Date.parse(String(from || ""));
  const end = Date.parse(String(to || ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round(end - start);
}

function traceEvents(run, event) {
  return Array.isArray(run.trace)
    ? run.trace.filter((entry) => entry?.event === event)
    : [];
}

function horizontalBranch(value) {
  const branch = text(value || "agentic_efficiency_intelligence", "branch_id", 160);
  if (!HORIZONTAL_BRANCHES.has(branch)) throw new Error("telemetry_vertical_branch_forbidden");
  return branch;
}

/**
 * Builds one final, immutable, redacted aggregate for a generic-agent run.
 * It never copies the task, prompt, worker result or tool output.
 */
export function buildGenericRunTelemetry({
  trustedContext,
  run,
  joined,
  branchId = "agentic_efficiency_intelligence",
  subbranchId = "work_capsule_compilation",
  routeReason = "generic agent run completed through Universal Core join",
  policySnapshot = {},
  rollbackReference = "release:0.16.0-ai-learning-factory",
} = {}) {
  const context = object(trustedContext, "trusted_context");
  const snapshot = object(run, "generic_run");
  const join = object(joined, "generic_join");
  const tenantId = text(context.tenantId || context.tenant_id, "tenant_id", 120);
  if (snapshot.tenant_id !== tenantId || join.run_id !== snapshot.run_id) {
    throw new Error("telemetry_run_scope_violation");
  }
  const tools = traceEvents(snapshot, "tool_event");
  const modelReservations = traceEvents(snapshot, "model_call_reserved");
  const contextBuilds = traceEvents(snapshot, "context_build");
  const handoffs = traceEvents(snapshot, "handoff_created");
  const lastTool = tools.at(-1);
  const lastModel = modelReservations.at(-1);
  const lastHandoff = handoffs.at(-1);
  const reservedModelCalls = nonNegativeInteger(snapshot.model_usage?.model_calls);
  if (reservedModelCalls < modelReservations.length) {
    throw new Error("telemetry_model_reservation_mismatch");
  }
  const agenticPlan = snapshot.metadata?.agentic_efficiency_shadow?.plan?.plan || null;
  const workerResults = Array.isArray(join.worker_results) ? join.worker_results : [];
  const evidenceDigest = digest({
    tenant_id: tenantId,
    run_id: snapshot.run_id,
    plan_id: join.plan_id,
    worker_result_digests: workerResults.map((worker) => digest({
      worker_id: worker.worker_id,
      agent_id: worker.agent_id,
      result_digest: workerResultDigest(worker.result),
    })),
    core_joined_at: join.core_joined_at,
  });
  const reviewRequired = snapshot.metadata?.agentic_control?.reviewer_required === true;
  const contextAvoidanceEstimate = nonNegativeInteger(
    agenticPlan?.context?.avoided_context_units,
  );
  const contextAvoidanceObserved = (
    snapshot.metadata?.agentic_control?.applied === true
    && snapshot.metadata?.agentic_control?.context_compaction_verified === true
  );
  return {
    tenant_id: tenantId,
    client_type: text(context.clientType || context.client_type, "client_type", 80),
    audience: text(context.audience, "audience", 160),
    agent_id: text(snapshot.agent_id, "agent_id", 160),
    session_id: snapshot.session_id
      ? text(snapshot.session_id, "session_id", 160)
      : `session_${digest(snapshot.run_id).slice("sha256:".length, "sha256:".length + 32)}`,
    logical_task: taskDigest(snapshot.task),
    run_id: text(snapshot.run_id, "run_id", 160),
    trace_id: `trace_${digest({
      tenant_id: tenantId,
      run_id: snapshot.run_id,
      plan_id: join.plan_id,
      core_joined_at: join.core_joined_at,
    }).slice("sha256:".length, "sha256:".length + 32)}`,
    parent_trace_id: snapshot.parent_run_id || null,
    branch_id: horizontalBranch(branchId),
    subbranch_id: text(subbranchId, "subbranch_id", 160),
    route_reason: text(routeReason, "route_reason", 500),
    route_confidence: 0,
    route_confidence_kind: "unattested",
    model_provider: "unobserved",
    model_id: lastModel?.data?.model_id
      ? text(lastModel.data.model_id, "model_id", 160)
      : "not-observed",
    model_snapshot: "not-observed",
    prompt_version: "not-persisted",
    tool_id: lastTool?.data?.tool_id || null,
    tool_result_status: lastTool?.data?.outcome || null,
    retry_count: tools.reduce(
      (total, entry) => total + nonNegativeInteger(entry?.data?.retry_count),
      0,
    ),
    fallback_path: null,
    handoff_from: lastHandoff ? snapshot.agent_id : null,
    handoff_to: lastHandoff?.data?.to_agent_id || null,
    handoff_verified: false,
    agent_count: Math.max(1, workerResults.length || nonNegativeInteger(agenticPlan?.agent_count, 1)),
    new_invocations: reservedModelCalls,
    invocation_usage_kind: reservedModelCalls > 0
      ? "reserved_not_provider_verified"
      : "none_observed",
    tool_call_count: tools.length,
    artifacts_reused: nonNegativeInteger(snapshot.metadata?.agentic_control?.reused_artifact_count),
    context_avoided: contextAvoidanceObserved ? contextAvoidanceEstimate : 0,
    context_avoidance_estimate: contextAvoidanceEstimate,
    context_avoidance_kind: contextAvoidanceObserved
      ? "observed_verified"
      : contextAvoidanceEstimate > 0
        ? "estimated_plan_only"
        : "none",
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    usage_kind: "unavailable",
    actual_cost: null,
    estimated_cost: null,
    usage_source: "host_usage_unavailable",
    rate_card_version: null,
    cost_formula: null,
    provider_receipt_digest: null,
    ttft_ms: 0,
    ttft_observed: false,
    latency_ms: elapsedMs(snapshot.created_at, join.core_joined_at),
    latency_observed: elapsedMs(snapshot.created_at, join.core_joined_at) > 0,
    queue_ms: 0,
    queue_observed: false,
    outcome_status: join.status === "completed" ? "succeeded" : "partial",
    outcome_verified: false,
    human_review_status: reviewRequired ? "completed_unattested" : "not_required",
    quality: null,
    quality_verified: false,
    provider_usage_verified: false,
    evidence_digest: evidenceDigest,
    policy_snapshot: digest(policySnapshot),
    rollback_reference: text(rollbackReference, "rollback_reference", 240),
  };
}

export function createAiRuntimeTelemetryProducer({ store } = {}) {
  if (!store || typeof store.record !== "function") throw new Error("telemetry_store_required");
  return Object.freeze({
    schema_version: AI_RUNTIME_TELEMETRY_PRODUCER_VERSION,
    raw_content_persisted: false,
    async recordGenericRunCompletion(input) {
      const telemetry = buildGenericRunTelemetry(input);
      return store.record({
        tenant_id: telemetry.tenant_id,
        idempotency_key: `telemetry:${telemetry.run_id}:core-join`,
        telemetry,
        visibility_context: input.trustedContext,
      });
    },
  });
}
