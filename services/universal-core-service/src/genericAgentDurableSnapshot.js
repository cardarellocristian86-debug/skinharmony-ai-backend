import crypto from "node:crypto";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_IDENTIFIER_PATTERN = /(?:^|[_:-])\+?\d[\d .()-]{7,}\d$/;
const SECRET_PATTERN = /(?:\b(?:sk|gho|ghp|ghs|github_pat|akia)[-_a-z0-9]{12,}\b|\b(?:bearer)\s+[a-z0-9._~+/=-]{12,}\b)/i;
const OPAQUE_PATTERN = /^[a-z0-9][a-z0-9._:@/-]*$/i;
const STATUS_PATTERN = /^[a-z][a-z0-9_:-]{0,119}$/i;
const GENERATED_UUID_IDENTIFIER_PATTERN = /^[a-z][a-z0-9._:-]*[_:-][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(canonical(value)),
  ).digest("hex")}`;
}

function digestLabel(label, value) {
  const normalized = String(value ?? "");
  if (new RegExp(`^${label}:sha256:[a-f0-9]{64}$`).test(normalized)) return normalized;
  return `${label}:${digest(value)}`;
}

function sensitive(value) {
  const text = String(value ?? "");
  return EMAIL_PATTERN.test(text)
    || (PHONE_IDENTIFIER_PATTERN.test(text) && !GENERATED_UUID_IDENTIFIER_PATTERN.test(text))
    || SECRET_PATTERN.test(text);
}

function requireOpaque(value, field, max = 160) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized
    || normalized.length > max
    || !OPAQUE_PATTERN.test(normalized)
    || sensitive(normalized)
  ) throw new Error(`${field}_invalid`);
  return normalized;
}

export function requireGenericAgentDurableIdentifier(value, field, max = 160) {
  return requireOpaque(value, field, max);
}

function optionalOpaque(value, field, max = 160) {
  return value === null || value === undefined || value === ""
    ? null
    : requireOpaque(value, field, max);
}

function boundedInteger(value, fallback = 0, maximum = 1_000_000_000) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 && normalized <= maximum
    ? normalized
    : fallback;
}

function boundedNumber(value, fallback = 0, maximum = 1_000_000_000) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 && normalized <= maximum
    ? normalized
    : fallback;
}

function timestamp(value) {
  const normalized = String(value ?? "").trim();
  return Number.isFinite(Date.parse(normalized)) ? new Date(normalized).toISOString() : null;
}

function safeCode(value, fallback = null, max = 120) {
  const normalized = String(value ?? "").trim();
  if (
    normalized
    && normalized.length <= max
    && STATUS_PATTERN.test(normalized)
    && !sensitive(normalized)
  ) return normalized;
  return fallback;
}

function safeCursor(value) {
  if (value === null || value === undefined || value === "") return null;
  return safeCode(value, null, 160) || digestLabel("cursor_digest", value);
}

function sanitizeCheckpointState(checkpoint) {
  const state = checkpoint?.state;
  if (
    state
    && typeof state === "object"
    && !Array.isArray(state)
    && DIGEST_PATTERN.test(String(state.state_digest || ""))
    && state.redacted === true
  ) {
    return {
      state_digest: state.state_digest,
      redacted: true,
    };
  }
  if (
    checkpoint?.schema_version === "tenant_openai_multi_agent_checkpoint_v1"
    && state
    && typeof state === "object"
    && !Array.isArray(state)
    && state.workflow === "research_review_synthesis_v1"
  ) {
    const stages = Array.isArray(state.stages)
      ? state.stages.slice(0, 16).map((stage) => ({
        id: requireOpaque(stage?.id, "checkpoint_stage_id", 80),
        status: safeCode(stage?.status, "pending", 40),
        ...(Number.isFinite(Number(stage?.latency_ms))
          ? { latency_ms: boundedNumber(stage.latency_ms, 0) }
          : {}),
      }))
      : [];
    return {
      workflow: "research_review_synthesis_v1",
      status: safeCode(state.status, "interrupted", 40),
      plan_id: requireOpaque(state.plan_id, "checkpoint_plan_id"),
      model: requireOpaque(state.model, "checkpoint_model", 160),
      task_fingerprint: DIGEST_PATTERN.test(String(state.task_fingerprint || ""))
        ? state.task_fingerprint
        : digest(state.task_fingerprint || ""),
      model_usage: {
        model_calls: boundedInteger(state.model_usage?.model_calls),
        reserved_tokens: boundedInteger(state.model_usage?.reserved_tokens),
      },
      provider_usage: {
        input_tokens: boundedInteger(state.provider_usage?.input_tokens),
        output_tokens: boundedInteger(state.provider_usage?.output_tokens),
        total_tokens: boundedInteger(state.provider_usage?.total_tokens),
      },
      stages,
      ...(state.error_code ? { error_code: safeCode(state.error_code, "redacted_error", 120) } : {}),
      ...(state.kill_signal ? {
        kill_signal: {
          propagated: state.kill_signal.propagated === true,
          cancelled_worker_count: boundedInteger(
            state.kill_signal.cancelled_worker_count,
            0,
            2_000,
          ),
        },
      } : {}),
    };
  }
  return {
    state_digest: digest(state && typeof state === "object" ? state : {}),
    redacted: true,
  };
}

export function sanitizeGenericAgentCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw new Error("checkpoint_invalid");
  }
  return {
    schema_version: safeCode(
      checkpoint.schema_version,
      "generic_agent_checkpoint_v1",
      120,
    ),
    state: sanitizeCheckpointState(checkpoint),
    cursor: safeCursor(checkpoint.cursor),
    idempotency_key: checkpoint.idempotency_key
      ? (safeCode(checkpoint.idempotency_key, null, 160)
        || digestLabel("idempotency_digest", checkpoint.idempotency_key))
      : null,
  };
}

function sanitizeTraceData(event, data) {
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  switch (event) {
    case "run_started":
      return {
        tools: Array.isArray(source.tools)
          ? source.tools.slice(0, 64).map((tool) => requireOpaque(tool, "trace_tool_id", 120))
          : [],
        parent_run_id: optionalOpaque(source.parent_run_id, "trace_parent_run_id"),
      };
    case "tool_event":
      return {
        tool_id: requireOpaque(source.tool_id, "trace_tool_id", 120),
        outcome: safeCode(source.outcome, "unknown", 80),
        retry_count: boundedInteger(source.retry_count, 0, 100),
      };
    case "model_call_reserved":
      return {
        model_id: requireOpaque(source.model_id, "trace_model_id", 160),
        estimated_tokens: boundedInteger(source.estimated_tokens),
        model_call_number: boundedInteger(source.model_call_number, 0, 10_000),
      };
    case "context_build":
      return {
        phase: safeCode(source.phase, "unknown", 80),
        duration_ms: boundedNumber(source.duration_ms),
      };
    case "handoff_created":
    case "handoff_claimed":
      return {
        handoff_id: requireOpaque(source.handoff_id, "trace_handoff_id", 160),
        ...(source.to_agent_id
          ? { to_agent_id: requireOpaque(source.to_agent_id, "trace_to_agent_id", 120) }
          : {}),
        ...(source.agent_id
          ? { agent_id: requireOpaque(source.agent_id, "trace_agent_id", 120) }
          : {}),
      };
    case "checkpoint_saved":
    case "run_resumed":
      return {
        cursor: safeCursor(source.cursor),
        ...(source.idempotency_key
          ? {
            idempotency_key: safeCode(source.idempotency_key, null, 160)
              || digestLabel("idempotency_digest", source.idempotency_key),
          }
          : {}),
      };
    case "run_restored":
      return { restored_from_checkpoint: source.restored_from_checkpoint === true };
    default:
      if (DIGEST_PATTERN.test(String(source.event_digest || ""))) {
        return {
          event_digest: source.event_digest,
          raw_content_persisted: false,
        };
      }
      return {
        event_digest: digest(source),
        raw_content_persisted: false,
      };
  }
}

function sanitizeTrace(trace) {
  if (!Array.isArray(trace)) return [];
  return trace.slice(-200).map((entry) => {
    const event = safeCode(entry?.event, "redacted_event", 120);
    return {
      id: requireOpaque(entry?.id, "trace_id", 160),
      at: timestamp(entry?.at),
      event,
      data: sanitizeTraceData(event, entry?.data),
    };
  });
}

function sanitizeAgenticMetadata(metadata) {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
  const output = {};
  if (source.workflow) output.workflow = safeCode(source.workflow, "redacted_workflow", 120);
  if (source.task_fingerprint) {
    output.task_fingerprint = DIGEST_PATTERN.test(String(source.task_fingerprint))
      ? source.task_fingerprint
      : digest(source.task_fingerprint);
  }
  const shadow = source.agentic_efficiency_shadow;
  if (shadow && typeof shadow === "object" && !Array.isArray(shadow)) {
    const plan = shadow.plan?.plan;
    const persistence = shadow.persistence;
    const budgetPersistence = shadow.budget_persistence;
    output.agentic_efficiency_shadow = {
      plan: {
        available: shadow.plan?.available !== false,
        mode: safeCode(shadow.plan?.mode, "shadow", 40),
        plan: {
          agent_count: boundedInteger(plan?.agent_count, 1, 100),
          context: {
            avoided_context_units: boundedInteger(
              plan?.context?.avoided_context_units,
            ),
          },
        },
      },
      persistence: persistence && typeof persistence === "object"
        ? {
          available: persistence.available === true,
          claimed: persistence.claimed === true,
          observation_only: persistence.observation_only === true,
          capsule_id: optionalOpaque(persistence.capsule_id, "capsule_id"),
          lease_owner: optionalOpaque(persistence.lease_owner, "lease_owner"),
          capsule_hash: DIGEST_PATTERN.test(String(persistence.capsule_hash || ""))
            ? persistence.capsule_hash
            : null,
        }
        : null,
      budget_persistence: budgetPersistence && typeof budgetPersistence === "object"
        ? {
          persisted: budgetPersistence.persisted === true,
          policy_version: budgetPersistence.policy_version
            ? safeCode(budgetPersistence.policy_version, "redacted_policy", 160)
            : null,
          receipt_digest: DIGEST_PATTERN.test(String(budgetPersistence.receipt_digest || ""))
            ? budgetPersistence.receipt_digest
            : null,
        }
        : null,
      execution_authorized: false,
    };
  }
  const control = source.agentic_control;
  if (control && typeof control === "object" && !Array.isArray(control)) {
    output.agentic_control = {
      applied: control.applied === true,
      context_compaction_verified: control.context_compaction_verified === true,
      reused_artifact_count: boundedInteger(control.reused_artifact_count),
      budget_mode: safeCode(control.budget_mode, "off", 40),
      budget_guard_joined: control.budget_guard_joined === true,
      recommended_agent_count: boundedInteger(control.recommended_agent_count, 0, 100),
      reviewer_required: control.reviewer_required === true,
      selected_tools: Array.isArray(control.selected_tools)
        ? control.selected_tools.slice(0, 64).map((tool) => requireOpaque(tool, "selected_tool", 120))
        : [],
      execution_authorized: false,
    };
  }
  return output;
}

export function sanitizeGenericAgentRunSnapshot(runSnapshot, tenantId, runId) {
  if (!runSnapshot || typeof runSnapshot !== "object" || Array.isArray(runSnapshot)) {
    throw new Error("run_snapshot_invalid");
  }
  if (runSnapshot.tenant_id !== tenantId || runSnapshot.run_id !== runId) {
    throw new Error("run_snapshot_scope_invalid");
  }
  return {
    schema_version: "generic_agent_durable_run_v2",
    run_id: requireOpaque(runSnapshot.run_id, "run_id"),
    tenant_id: requireOpaque(runSnapshot.tenant_id, "tenant_id", 120),
    agent_id: requireOpaque(runSnapshot.agent_id, "agent_id", 120),
    session_id: optionalOpaque(runSnapshot.session_id, "session_id"),
    parent_run_id: optionalOpaque(runSnapshot.parent_run_id, "parent_run_id"),
    task: digestLabel("task_digest", runSnapshot.task),
    tools: Array.isArray(runSnapshot.tools)
      ? runSnapshot.tools.slice(0, 64).map((tool) => requireOpaque(tool, "tool_id", 120))
      : [],
    metadata: sanitizeAgenticMetadata(runSnapshot.metadata),
    learning_mode: ["frozen", "governed_read_only"].includes(runSnapshot.learning_mode)
      ? runSnapshot.learning_mode
      : "governed_read_only",
    model_budget: {
      max_model_calls: boundedInteger(runSnapshot.model_budget?.max_model_calls, 0, 10_000),
      max_total_tokens: boundedInteger(
        runSnapshot.model_budget?.max_total_tokens,
        0,
        100_000_000,
      ),
    },
    status: safeCode(runSnapshot.status, "running", 40),
    created_at: timestamp(runSnapshot.created_at),
    updated_at: timestamp(runSnapshot.updated_at),
    checkpoint: runSnapshot.checkpoint
      ? sanitizeGenericAgentCheckpoint(runSnapshot.checkpoint)
      : null,
    model_usage: {
      model_calls: boundedInteger(runSnapshot.model_usage?.model_calls, 0, 10_000),
      reserved_tokens: boundedInteger(
        runSnapshot.model_usage?.reserved_tokens,
        0,
        100_000_000,
      ),
    },
    trace: sanitizeTrace(runSnapshot.trace),
    raw_content_persisted: false,
  };
}

function sanitizeWorkerResult(result) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  const output = {
    result_digest: DIGEST_PATTERN.test(String(source.result_digest || ""))
      ? source.result_digest
      : digest(source),
    raw_content_persisted: false,
  };
  const evidenceDigest = String(source.evidence_digest || "");
  if (DIGEST_PATTERN.test(evidenceDigest)) output.evidence_digest = evidenceDigest;
  else if (Array.isArray(source.evidence) && source.evidence.length) {
    output.evidence_digest = digest(source.evidence);
  }
  for (const field of ["output_digest", "content_digest", "provenance_digest"]) {
    if (DIGEST_PATTERN.test(String(source[field] || ""))) output[field] = source[field];
  }
  for (const field of ["output_characters", "latency_ms"]) {
    if (Number.isFinite(Number(source[field]))) output[field] = boundedNumber(source[field]);
  }
  if (source.usage && typeof source.usage === "object" && !Array.isArray(source.usage)) {
    output.usage = {
      input_tokens: boundedInteger(source.usage.input_tokens),
      output_tokens: boundedInteger(source.usage.output_tokens),
      total_tokens: boundedInteger(source.usage.total_tokens),
    };
  }
  return output;
}

export function sanitizeGenericAgentPlanSnapshot(planSnapshot, tenantId) {
  if (!planSnapshot || typeof planSnapshot !== "object" || Array.isArray(planSnapshot)) {
    throw new Error("plan_snapshot_invalid");
  }
  if (planSnapshot.tenant_id !== tenantId) throw new Error("cross_tenant_plan_denied");
  if (!Array.isArray(planSnapshot.workers) || !planSnapshot.workers.length) {
    throw new Error("workers_invalid");
  }
  return {
    schema_version: "generic_agent_durable_orchestration_v2",
    plan_id: requireOpaque(planSnapshot.plan_id, "plan_id"),
    tenant_id: requireOpaque(tenantId, "tenant_id", 120),
    run_id: requireOpaque(planSnapshot.run_id, "run_id"),
    status: safeCode(planSnapshot.status, "pending", 40),
    max_concurrent: boundedInteger(planSnapshot.max_concurrent, 1, 32),
    max_workers: boundedInteger(planSnapshot.max_workers, 200, 2_000),
    max_branch_depth: boundedInteger(planSnapshot.max_branch_depth, 3, 16),
    review_policy: {
      required: planSnapshot.review_policy?.required === true,
      independent: planSnapshot.review_policy?.independent !== false,
      evidence_required: planSnapshot.review_policy?.evidence_required !== false,
    },
    workers: planSnapshot.workers.slice(0, 2_000).map((worker) => ({
      worker_id: requireOpaque(worker?.worker_id, "worker_id", 120),
      agent_id: requireOpaque(worker?.agent_id, "agent_id", 120),
      role: ["author", "reviewer", "supervisor", "worker"].includes(worker?.role)
        ? worker.role
        : "worker",
      task: digestLabel("worker_task_digest", worker?.task),
      dependencies: Array.isArray(worker?.dependencies)
        ? worker.dependencies.slice(0, 2_000).map((dependency) => requireOpaque(
          dependency,
          "dependency_id",
          120,
        ))
        : [],
      parent_worker_id: optionalOpaque(worker?.parent_worker_id, "parent_worker_id", 120),
      branch_depth: boundedInteger(worker?.branch_depth, 0, 16),
      status: safeCode(worker?.status, "pending", 40),
      result: worker?.result === null || worker?.result === undefined
        ? null
        : sanitizeWorkerResult(worker.result),
      error: worker?.error
        ? safeCode(worker.error, null, 120) || digestLabel("worker_error_digest", worker.error)
        : null,
    })),
    created_at: timestamp(planSnapshot.created_at),
    updated_at: timestamp(planSnapshot.updated_at),
    core_joined_at: timestamp(planSnapshot.core_joined_at),
    raw_content_persisted: false,
  };
}

export function durableSnapshotDigest(value) {
  return digest(clone(value));
}
