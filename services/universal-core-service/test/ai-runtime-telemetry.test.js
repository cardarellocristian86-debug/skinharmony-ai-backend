import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_RUNTIME_TELEMETRY_FIELDS,
  createAiRuntimeTelemetryStore,
  normalizeAiRuntimeTelemetry,
} from "../src/aiRuntimeTelemetry.js";

function telemetry(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    client_type: "chatgpt",
    audience: "chatgpt_connector",
    agent_id: "agent-evaluator",
    session_id: "session-1",
    run_id: "run-1",
    trace_id: "trace-1",
    parent_trace_id: null,
    branch_id: "ai_evaluation_intelligence",
    subbranch_id: "release_scorecard",
    route_reason: "bounded evaluation request",
    route_confidence: 0.98,
    model_provider: "none",
    model_id: "deterministic-evaluator",
    model_snapshot: "snapshot-v1",
    prompt_version: "prompt-v1",
    tool_id: "ai_eval_scorecard_read",
    tool_result_status: "succeeded",
    retry_count: 0,
    fallback_path: null,
    handoff_from: null,
    handoff_to: null,
    handoff_verified: false,
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    estimated_cost: 0,
    ttft_ms: 1,
    latency_ms: 4,
    queue_ms: 0,
    outcome_status: "succeeded",
    outcome_verified: true,
    human_review_status: "not_required",
    evidence_digest: "evd-a1",
    policy_snapshot: "policy-v1",
    rollback_reference: "rollback-v1",
    ...overrides,
  };
}

test("canonical telemetry emits every allowlisted field and no raw content", () => {
  const normalized = normalizeAiRuntimeTelemetry({
    ...telemetry({
      route_reason: "contact operator@example.test token=ghp_abcdefghijklmnopqrstuv",
    }),
    harmless_unknown: "not persisted",
  }, { recordedAt: "2026-07-27T12:00:00.000Z" });

  for (const field of AI_RUNTIME_TELEMETRY_FIELDS) assert(Object.hasOwn(normalized, field), field);
  assert.equal(normalized.schema_version, "ai_runtime_telemetry_v0_16");
  assert.equal(normalized.raw_content_persisted, false);
  assert.equal(Object.hasOwn(normalized, "harmless_unknown"), false);
  assert.equal(JSON.stringify(normalized).includes("operator@example.test"), false);
  assert.equal(JSON.stringify(normalized).includes("ghp_abcdefghijklmnopqrstuv"), false);
  assert.match(normalized.route_reason, /\[REDACTED_EMAIL\]/);
  assert.match(normalized.route_reason, /\[REDACTED_SECRET\]/);
});

test("raw prompts and content fail closed", () => {
  assert.throws(
    () => normalizeAiRuntimeTelemetry({ ...telemetry(), raw_prompt: "private prompt" }),
    /telemetry_raw_content_forbidden/,
  );
  assert.throws(
    () => normalizeAiRuntimeTelemetry({ ...telemetry(), content: "customer content" }),
    /telemetry_raw_content_forbidden/,
  );
  assert.throws(
    () => normalizeAiRuntimeTelemetry({ ...telemetry(), evidence_digest: "ghp_abcdefghijklmnopqrstuv" }),
    /evidence_digest_invalid/,
  );
});

test("telemetry store is tenant-first, immutable and idempotent", async () => {
  const store = createAiRuntimeTelemetryStore({ now: () => "2026-07-27T12:00:00.000Z" });
  const first = await store.record({
    tenant_id: "tenant-a",
    idempotency_key: "idem-1",
    telemetry: telemetry(),
  });
  const replay = await store.record({
    tenant_id: "tenant-a",
    idempotency_key: "idem-1",
    telemetry: telemetry(),
  });
  assert.deepEqual(replay, first);
  assert.equal((await store.list({ tenant_id: "tenant-a" })).length, 1);
  assert.equal((await store.list({ tenant_id: "tenant-b" })).length, 0);
  assert.equal(await store.read({ tenant_id: "tenant-b", run_id: "run-1" }), null);

  await assert.rejects(
    store.record({
      tenant_id: "tenant-a",
      idempotency_key: "idem-1",
      telemetry: telemetry({ outcome_status: "failed" }),
    }),
    /telemetry_idempotency_conflict/,
  );
  await assert.rejects(
    store.record({
      tenant_id: "tenant-a",
      idempotency_key: "idem-2",
      telemetry: telemetry({ outcome_status: "failed" }),
    }),
    /telemetry_run_conflict/,
  );
});

test("telemetry serialization prevents concurrent immutable-run replacement", async () => {
  const store = createAiRuntimeTelemetryStore({ now: () => "2026-07-27T12:00:00.000Z" });
  const writes = await Promise.allSettled([
    store.record({
      tenant_id: "tenant-a",
      idempotency_key: "idem-concurrent-a",
      telemetry: telemetry({ outcome_status: "succeeded" }),
    }),
    store.record({
      tenant_id: "tenant-a",
      idempotency_key: "idem-concurrent-b",
      telemetry: telemetry({ outcome_status: "failed" }),
    }),
  ]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = writes.find((result) => result.status === "rejected");
  assert(rejected);
  assert.match(rejected.reason.message, /telemetry_run_conflict/);
  assert.equal((await store.list({ tenant_id: "tenant-a" })).length, 1);
});

test("telemetry idempotency is atomic across different run ids", async () => {
  const store = createAiRuntimeTelemetryStore({ now: () => "2026-07-27T12:00:00.000Z" });
  const writes = await Promise.allSettled([
    store.record({
      tenant_id: "tenant-a",
      idempotency_key: "idem-shared",
      telemetry: telemetry({ run_id: "run-a", trace_id: "trace-a" }),
    }),
    store.record({
      tenant_id: "tenant-a",
      idempotency_key: "idem-shared",
      telemetry: telemetry({ run_id: "run-b", trace_id: "trace-b" }),
    }),
  ]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = writes.find((result) => result.status === "rejected");
  assert(rejected);
  assert.match(rejected.reason.message, /telemetry_idempotency_conflict/);
  assert.equal((await store.list({ tenant_id: "tenant-a" })).length, 1);
});

test("optional adapter receives tenant-scoped keys and rejects cross-tenant rows", async () => {
  const calls = [];
  const adapter = {
    async load(input) {
      calls.push(["load", input]);
      return null;
    },
    async save(input) {
      calls.push(["save", input]);
    },
    async list(input) {
      calls.push(["list", input]);
      return [];
    },
  };
  const store = createAiRuntimeTelemetryStore({ adapter, now: () => "2026-07-27T12:00:00.000Z" });
  await store.record({ tenant_id: "tenant-a", idempotency_key: "idem-1", telemetry: telemetry() });
  await store.list({ tenant_id: "tenant-a" });
  assert(calls.every(([, input]) => input.tenant_id === "tenant-a"));
  assert.equal(calls.find(([name]) => name === "save")[1].record.raw_content_persisted, false);

  const leaking = createAiRuntimeTelemetryStore({
    adapter: {
      async load() { return null; },
      async save() {},
      async list() { return [normalizeAiRuntimeTelemetry(telemetry({ tenant_id: "tenant-b" }))]; },
    },
  });
  await assert.rejects(leaking.list({ tenant_id: "tenant-a" }), /telemetry_adapter_scope_violation/);

  const tampered = normalizeAiRuntimeTelemetry(telemetry());
  tampered.telemetry_digest = "art_tampered";
  const corrupt = createAiRuntimeTelemetryStore({
    adapter: {
      async load() { return tampered; },
      async save() {},
      async list() { return []; },
    },
  });
  await assert.rejects(
    corrupt.read({ tenant_id: "tenant-a", run_id: "run-1" }),
    /telemetry_adapter_integrity_violation/,
  );
});
