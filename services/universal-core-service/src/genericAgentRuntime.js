import crypto from "node:crypto";

const MAX_TRACE_EVENTS = 200;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return [];
  return [...new Set(tools.map((tool) => requireText(tool, "tool_id", 120)))].slice(0, 64);
}

function normalizeRunInput(input = {}) {
  const tenantId = requireText(input.tenant_id, "tenant_id", 120);
  const agentId = requireText(input.agent_id, "agent_id", 120);
  const runId = input.run_id ? requireText(input.run_id, "run_id", 160) : `run_${crypto.randomUUID()}`;
  return {
    schema_version: "generic_agent_run_v1",
    run_id: runId,
    tenant_id: tenantId,
    agent_id: agentId,
    session_id: input.session_id ? requireText(input.session_id, "session_id", 160) : null,
    parent_run_id: input.parent_run_id ? requireText(input.parent_run_id, "parent_run_id", 160) : null,
    task: requireText(input.task, "task", 4_000),
    tools: normalizeTools(input.tools),
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? clone(input.metadata) : {},
  };
}

function normalizeCheckpoint(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("checkpoint_invalid");
  const state = input.state && typeof input.state === "object" && !Array.isArray(input.state) ? clone(input.state) : {};
  return {
    schema_version: "generic_agent_checkpoint_v1",
    state,
    cursor: input.cursor === undefined || input.cursor === null ? null : requireText(input.cursor, "cursor", 1_000),
    idempotency_key: input.idempotency_key ? requireText(input.idempotency_key, "idempotency_key", 160) : null,
  };
}

export function createGenericAgentRuntime({ now = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) {
  const runs = new Map();
  const handoffs = new Map();

  function appendTrace(run, event, data = {}) {
    const trace = {
      id: `trace_${idFactory()}`,
      at: now(),
      event: requireText(event, "trace_event", 120),
      data: clone(data),
    };
    run.trace.push(trace);
    if (run.trace.length > MAX_TRACE_EVENTS) run.trace.splice(0, run.trace.length - MAX_TRACE_EVENTS);
    run.updated_at = trace.at;
    return trace;
  }

  function getRun(runId, tenantId) {
    const run = runs.get(requireText(runId, "run_id", 160));
    if (!run) throw new Error("run_not_found");
    if (tenantId && run.tenant_id !== requireText(tenantId, "tenant_id", 120)) throw new Error("cross_tenant_run_denied");
    return run;
  }

  return {
    startRun(input) {
      const normalized = normalizeRunInput(input);
      if (runs.has(normalized.run_id)) throw new Error("run_already_exists");
      const run = {
        ...normalized,
        status: "running",
        created_at: now(),
        updated_at: now(),
        checkpoint: null,
        trace: [],
      };
      appendTrace(run, "run_started", { tools: run.tools, parent_run_id: run.parent_run_id });
      runs.set(run.run_id, run);
      return clone(run);
    },

    checkpointRun({ run_id, tenant_id, checkpoint }) {
      const run = getRun(run_id, tenant_id);
      if (!["running", "waiting_handoff"].includes(run.status)) throw new Error("run_not_checkpointable");
      run.checkpoint = normalizeCheckpoint(checkpoint);
      appendTrace(run, "checkpoint_saved", { cursor: run.checkpoint.cursor, idempotency_key: run.checkpoint.idempotency_key });
      return clone(run);
    },

    resumeRun({ run_id, tenant_id, expected_checkpoint_key = null }) {
      const run = getRun(run_id, tenant_id);
      if (!run.checkpoint) throw new Error("checkpoint_not_found");
      if (expected_checkpoint_key && run.checkpoint.idempotency_key !== expected_checkpoint_key) throw new Error("checkpoint_idempotency_mismatch");
      if (run.status === "completed" || run.status === "cancelled") throw new Error("run_not_resumable");
      run.status = "running";
      appendTrace(run, "run_resumed", { cursor: run.checkpoint.cursor });
      return clone(run);
    },

    createHandoff({ run_id, tenant_id, to_agent_id, summary, idempotency_key = null }) {
      const run = getRun(run_id, tenant_id);
      if (run.status !== "running") throw new Error("run_not_handoffable");
      const handoff = {
        schema_version: "generic_agent_handoff_v1",
        handoff_id: `handoff_${idFactory()}`,
        tenant_id: run.tenant_id,
        from_agent_id: run.agent_id,
        to_agent_id: requireText(to_agent_id, "to_agent_id", 120),
        run_id: run.run_id,
        summary: requireText(summary, "summary", 4_000),
        idempotency_key: idempotency_key ? requireText(idempotency_key, "idempotency_key", 160) : null,
        status: "open",
        created_at: now(),
        claimed_at: null,
      };
      for (const existing of handoffs.values()) {
        if (handoff.idempotency_key && existing.tenant_id === handoff.tenant_id && existing.idempotency_key === handoff.idempotency_key) return clone(existing);
      }
      handoffs.set(handoff.handoff_id, handoff);
      run.status = "waiting_handoff";
      appendTrace(run, "handoff_created", { handoff_id: handoff.handoff_id, to_agent_id: handoff.to_agent_id });
      return clone(handoff);
    },

    claimHandoff({ handoff_id, tenant_id, agent_id }) {
      const handoff = handoffs.get(requireText(handoff_id, "handoff_id", 160));
      if (!handoff) throw new Error("handoff_not_found");
      if (handoff.tenant_id !== requireText(tenant_id, "tenant_id", 120)) throw new Error("cross_tenant_handoff_denied");
      if (handoff.to_agent_id !== requireText(agent_id, "agent_id", 120)) throw new Error("handoff_recipient_mismatch");
      if (handoff.status !== "open") throw new Error("handoff_not_claimable");
      handoff.status = "claimed";
      handoff.claimed_at = now();
      const run = getRun(handoff.run_id, tenant_id);
      appendTrace(run, "handoff_claimed", { handoff_id: handoff.handoff_id, agent_id });
      return clone(handoff);
    },

    completeRun({ run_id, tenant_id, result = {} }) {
      const run = getRun(run_id, tenant_id);
      if (run.status === "cancelled") throw new Error("run_cancelled");
      run.status = "completed";
      appendTrace(run, "run_completed", { result: result && typeof result === "object" ? clone(result) : {} });
      return clone(run);
    },

    getRun({ run_id, tenant_id }) {
      return clone(getRun(run_id, tenant_id));
    },
  };
}
