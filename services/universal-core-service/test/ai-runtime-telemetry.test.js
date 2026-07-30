import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_RUNTIME_TELEMETRY_FIELDS,
  createAiRuntimeTelemetryStore,
  normalizeAiRuntimeTelemetry,
} from "../src/aiRuntimeTelemetry.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;

function telemetry(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    client_type: "chatgpt",
    audience: "chatgpt_connector",
    agent_id: "agent-evaluator",
    session_id: "session-1",
    logical_task: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    run_id: "run-1",
    trace_id: "trace-1",
    parent_trace_id: null,
    branch_id: "ai_evaluation_intelligence",
    subbranch_id: "release_scorecard",
    route_reason: "bounded evaluation request",
    route_confidence: 0.98,
    route_confidence_kind: "router_attested",
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
    agent_count: 1,
    new_invocations: 1,
    invocation_usage_kind: "provider_unverified",
    tool_call_count: 1,
    artifacts_reused: 0,
    context_avoided: 0,
    context_avoidance_estimate: 0,
    context_avoidance_kind: "none",
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
    ttft_ms: 1,
    ttft_observed: true,
    latency_ms: 4,
    latency_observed: true,
    queue_ms: 0,
    queue_observed: false,
    outcome_status: "succeeded",
    outcome_verified: true,
    human_review_status: "not_required",
    quality: 1,
    quality_verified: false,
    provider_usage_verified: false,
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
  assert.throws(
    () => normalizeAiRuntimeTelemetry(telemetry({
      usage_kind: "actual",
      actual_cost: 1,
      provider_usage_verified: true,
      rate_card_version: "rate-v1",
      provider_receipt_digest: DIGEST_A,
    })),
    /usage_attestation_required/,
  );
  assert.throws(
    () => normalizeAiRuntimeTelemetry(telemetry({
      usage_kind: "estimated",
      input_tokens: 100,
      estimated_cost: null,
      usage_source: "runtime_estimate",
    })),
    /usage_attestation_required/,
  );
  assert.throws(
    () => normalizeAiRuntimeTelemetry(telemetry({
      cached_tokens: 99,
    })),
    /unavailable_usage_claim_forbidden/,
  );
  assert.throws(
    () => normalizeAiRuntimeTelemetry(telemetry({
      estimated_cost: 999,
      rate_card_version: "invented-rate-card",
      cost_formula: "caller invented",
    })),
    /unavailable_usage_claim_forbidden/,
  );
  assert.throws(
    () => normalizeAiRuntimeTelemetry(telemetry({ session_id: "393331234567" })),
    /session_id_invalid/,
  );
  assert.throws(
    () => normalizeAiRuntimeTelemetry(telemetry({ agent_id: "agent_393331234567" })),
    /agent_id_invalid/,
  );
  assert.throws(
    () => normalizeAiRuntimeTelemetry(telemetry({ session_id: "operator@example.test" })),
    /session_id_invalid/,
  );
  const numericUuid = normalizeAiRuntimeTelemetry(telemetry({
    trace_id: "trace_12345678-1234-1234-1234-123456789012",
  }));
  assert.equal(
    numericUuid.trace_id,
    "trace_12345678-1234-1234-1234-123456789012",
  );
  const forgedQuality = normalizeAiRuntimeTelemetry(telemetry({ quality_verified: true }));
  assert.equal(forgedQuality.quality_verified, false);
});

test("actual usage and verified quality require out-of-band attestations", async () => {
  const store = createAiRuntimeTelemetryStore({
    now: () => "2026-07-27T12:00:00.000Z",
    verifyProviderUsage: async ({ telemetry: candidate }) => ({
      verified: candidate.provider_receipt_digest === DIGEST_A,
      attestation_digest: DIGEST_A,
      canonical_usage: {
        usage_kind: "actual",
        input_tokens: 100,
        output_tokens: 10,
        cached_tokens: 20,
        actual_cost: 1,
        estimated_cost: null,
        usage_source: "verified_provider_receipt",
        rate_card_version: "rate-v1",
        cost_formula: "provider reconciled receipt",
        provider_receipt_digest: DIGEST_A,
      },
    }),
    verifyQualityEvidence: async () => ({
      verified: true,
      attestation_digest: `sha256:${"b".repeat(64)}`,
      canonical_quality: 1,
      canonical_learning_value: 0.8,
      canonical_human_review_status: "approved",
      outcome_verified: true,
    }),
  });
  const record = await store.record({
    tenant_id: "tenant-a",
    idempotency_key: "idem-actual",
    telemetry: telemetry({
      usage_kind: "actual",
      actual_cost: 1,
      estimated_cost: null,
      usage_source: "verified_provider_receipt",
      rate_card_version: "rate-v1",
      cost_formula: "provider reconciled receipt",
      provider_receipt_digest: DIGEST_A,
      provider_usage_verified: false,
      quality_verified: false,
    }),
  });
  assert.equal(record.provider_usage_verified, true);
  assert.equal(record.quality_verified, true);
  assert.equal(record.quality_attestation_digest, `sha256:${"b".repeat(64)}`);
  assert.equal(record.learning_value, 0.8);
  assert.equal(record.human_review_status, "approved");
  assert.equal(record.input_tokens, 100);
  assert.equal(record.cached_tokens, 20);
  assert.equal(record.usage_kind, "actual");
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

test("adapter failure does not publish an in-memory success and retry persists", async () => {
  let saveCalls = 0;
  let durable = null;
  const store = createAiRuntimeTelemetryStore({
    adapter: {
      async load() {
        return durable;
      },
      async save({ record }) {
        saveCalls += 1;
        if (saveCalls === 1) throw new Error("transient_adapter_failure");
        durable = structuredClone(record);
      },
      async list() {
        return durable ? [structuredClone(durable)] : [];
      },
    },
    now: () => "2026-07-27T12:00:00.000Z",
  });

  await assert.rejects(
    store.record({
      tenant_id: "tenant-a",
      idempotency_key: "idem-retry",
      telemetry: telemetry(),
    }),
    /transient_adapter_failure/,
  );
  assert.equal(await store.read({ tenant_id: "tenant-a", run_id: "run-1" }), null);

  const recorded = await store.record({
    tenant_id: "tenant-a",
    idempotency_key: "idem-retry",
    telemetry: telemetry(),
  });
  assert.equal(saveCalls, 2);
  assert.equal(recorded.telemetry_digest, durable.telemetry_digest);
  assert.equal((await store.list({ tenant_id: "tenant-a" })).length, 1);
});
