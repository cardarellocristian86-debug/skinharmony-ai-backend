import assert from "node:assert/strict";
import test from "node:test";

import { createAiRuntimeTelemetryStore } from "../src/aiRuntimeTelemetry.js";
import {
  buildGenericRunTelemetry,
  createAiRuntimeTelemetryProducer,
} from "../src/aiRuntimeTelemetryProducer.js";
import {
  sanitizeGenericAgentPlanSnapshot,
  sanitizeGenericAgentRunSnapshot,
} from "../src/genericAgentDurableSnapshot.js";

function context(overrides = {}) {
  return {
    tenantId: "tenant-a",
    clientType: "codex",
    audience: "codex_internal",
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    run_id: "run-a",
    agent_id: "agent-a",
    session_id: "session-a",
    parent_run_id: null,
    task: "Private task for mario.rossi@example.test",
    created_at: "2026-07-27T20:00:00.000Z",
    metadata: {
      agentic_control: {
        reviewer_required: true,
        reused_artifact_count: 0,
      },
      agentic_efficiency_shadow: {
        plan: {
          plan: {
            agent_count: 2,
            context: { avoided_context_units: 7 },
          },
        },
      },
    },
    trace: [
      {
        id: "trace-start",
        event: "tool_event",
        data: { tool_id: "read", outcome: "success", retry_count: 0 },
      },
    ],
    ...overrides,
  };
}

function joined(overrides = {}) {
  return {
    plan_id: "plan-a",
    run_id: "run-a",
    status: "completed",
    worker_results: [
      { worker_id: "author", agent_id: "agent-a", result: { evidence_digest: `sha256:${"a".repeat(64)}` } },
      { worker_id: "reviewer", agent_id: "agent-b", result: { evidence_digest: `sha256:${"b".repeat(64)}` } },
    ],
    core_joined_at: "2026-07-27T20:00:02.000Z",
    ...overrides,
  };
}

test("generic-run producer writes one immutable redacted aggregate at Core join", async () => {
  const store = createAiRuntimeTelemetryStore({
    now: () => "2026-07-27T20:00:02.000Z",
  });
  const producer = createAiRuntimeTelemetryProducer({ store });
  const record = await producer.recordGenericRunCompletion({
    trustedContext: context(),
    run: run(),
    joined: joined(),
    policySnapshot: { version: "policy-v1", execution_enabled: false },
    rollbackReference: "git:pre-v0.16",
  });
  assert.equal(record.tenant_id, "tenant-a");
  assert.equal(record.usage_kind, "unavailable");
  assert.equal(record.provider_usage_verified, false);
  assert.equal(record.quality_verified, false);
  assert.equal(record.agent_count, 2);
  assert.equal(record.tool_call_count, 1);
  assert.equal(record.route_confidence, 0);
  assert.equal(record.route_confidence_kind, "unattested");
  assert.equal(record.context_avoided, 0);
  assert.equal(record.context_avoidance_estimate, 7);
  assert.equal(record.context_avoidance_kind, "estimated_plan_only");
  assert.equal(record.latency_ms, 2_000);
  assert.equal(record.latency_observed, true);
  assert.match(record.logical_task, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(record).includes("mario.rossi@example.test"), false);
  assert.equal(JSON.stringify(record).includes("Private task"), false);
  assert.deepEqual(
    await producer.recordGenericRunCompletion({
      trustedContext: context(),
      run: run(),
      joined: joined(),
      policySnapshot: { version: "policy-v1", execution_enabled: false },
      rollbackReference: "git:pre-v0.16",
    }),
    record,
  );
});

test("context avoidance is observed only with applied and verified compaction", async () => {
  const store = createAiRuntimeTelemetryStore({
    now: () => "2026-07-27T20:00:02.000Z",
  });
  const record = await createAiRuntimeTelemetryProducer({ store }).recordGenericRunCompletion({
    trustedContext: context(),
    run: run({
      metadata: {
        agentic_control: {
          applied: true,
          context_compaction_verified: true,
          reviewer_required: false,
        },
        agentic_efficiency_shadow: {
          plan: {
            plan: {
              agent_count: 1,
              context: { avoided_context_units: 7 },
            },
          },
        },
      },
    }),
    joined: joined(),
  });
  assert.equal(record.context_avoided, 7);
  assert.equal(record.context_avoidance_estimate, 7);
  assert.equal(record.context_avoidance_kind, "observed_verified");
});

test("raw and digest-only restored snapshots produce the same immutable telemetry", async () => {
  const rawRun = run();
  const rawJoined = joined();
  const rawPlan = {
    schema_version: "generic_agent_orchestration_v1",
    plan_id: rawJoined.plan_id,
    tenant_id: rawRun.tenant_id,
    run_id: rawRun.run_id,
    status: "completed",
    max_concurrent: 2,
    max_workers: 200,
    max_branch_depth: 3,
    review_policy: {
      required: true,
      independent: true,
      evidence_required: true,
    },
    workers: rawJoined.worker_results.map((worker, index) => ({
      ...worker,
      role: index === 0 ? "author" : "reviewer",
      task: `Private worker task ${index}`,
      dependencies: [],
      parent_worker_id: null,
      branch_depth: 0,
      status: "completed",
      error: null,
    })),
    created_at: rawRun.created_at,
    updated_at: rawJoined.core_joined_at,
    core_joined_at: rawJoined.core_joined_at,
  };
  const durableRun = sanitizeGenericAgentRunSnapshot(
    rawRun,
    rawRun.tenant_id,
    rawRun.run_id,
  );
  const durablePlan = sanitizeGenericAgentPlanSnapshot(rawPlan, rawRun.tenant_id);
  const restoredJoined = {
    plan_id: durablePlan.plan_id,
    run_id: durablePlan.run_id,
    status: durablePlan.status,
    worker_results: durablePlan.workers.map((worker) => ({
      worker_id: worker.worker_id,
      agent_id: worker.agent_id,
      result: worker.result,
    })),
    core_joined_at: durablePlan.core_joined_at,
  };
  const input = {
    trustedContext: context(),
    policySnapshot: { version: "policy-v1", execution_enabled: false },
    rollbackReference: "git:pre-v0.16",
  };
  const before = buildGenericRunTelemetry({
    ...input,
    run: rawRun,
    joined: rawJoined,
  });
  const after = buildGenericRunTelemetry({
    ...input,
    run: durableRun,
    joined: restoredJoined,
  });
  assert.deepEqual(after, before);

  const store = createAiRuntimeTelemetryStore({
    now: () => "2026-07-27T20:00:02.000Z",
  });
  const producer = createAiRuntimeTelemetryProducer({ store });
  const first = await producer.recordGenericRunCompletion({
    ...input,
    run: rawRun,
    joined: rawJoined,
  });
  assert.deepEqual(
    await producer.recordGenericRunCompletion({
      ...input,
      run: durableRun,
      joined: restoredJoined,
    }),
    first,
  );
});

test("producer rejects cross-tenant and vertical branch telemetry", () => {
  assert.throws(
    () => buildGenericRunTelemetry({
      trustedContext: context({ tenantId: "tenant-b" }),
      run: run(),
      joined: joined(),
    }),
    /telemetry_run_scope_violation/,
  );
  assert.throws(
    () => buildGenericRunTelemetry({
      trustedContext: context(),
      run: run(),
      joined: joined(),
      branchId: "skinharmony_analyzer",
    }),
    /telemetry_vertical_branch_forbidden/,
  );
});

test("numeric-heavy generated identifiers are validated without PII text rewriting", async () => {
  const store = createAiRuntimeTelemetryStore({
    now: () => "2026-07-28T10:00:01.000Z",
  });
  const record = await createAiRuntimeTelemetryProducer({ store }).recordGenericRunCompletion({
    trustedContext: context(),
    run: run({
      run_id: "r1",
      session_id: null,
      task: "x",
      created_at: "2026-07-28T10:00:00.000Z",
      trace: [{
        id: "trace_cef3ea9b35975c8c2c730a8794895040",
        event: "run_started",
        data: {},
      }],
      metadata: {},
    }),
    joined: joined({
      plan_id: "p1",
      run_id: "r1",
      worker_results: [],
      core_joined_at: "2026-07-28T10:00:01.000Z",
    }),
  });
  assert.match(record.trace_id, /^trace_[a-f0-9]{32}$/);
  assert.match(record.session_id, /^session_[a-f0-9]{32}$/);
});

test("model reservations are counted but never presented as verified provider usage", () => {
  const reserved = buildGenericRunTelemetry({
    trustedContext: context(),
    run: run({
      model_usage: { model_calls: 1, reserved_tokens: 500 },
      trace: [{
        id: "trace-model",
        event: "model_call_reserved",
        data: { model_id: "model-a", estimated_tokens: 500 },
      }],
    }),
    joined: joined(),
  });
  assert.equal(reserved.new_invocations, 1);
  assert.equal(reserved.invocation_usage_kind, "reserved_not_provider_verified");
  assert.equal(reserved.usage_kind, "unavailable");
  assert.equal(reserved.provider_usage_verified, false);
  assert.throws(
    () => buildGenericRunTelemetry({
      trustedContext: context(),
      run: run({
        model_usage: { model_calls: 0, reserved_tokens: 0 },
        trace: [{
          id: "trace-model",
          event: "model_call_reserved",
          data: { model_id: "model-a", estimated_tokens: 500 },
        }],
      }),
      joined: joined(),
    }),
    /telemetry_model_reservation_mismatch/,
  );
});
