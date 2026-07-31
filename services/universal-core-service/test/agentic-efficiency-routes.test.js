import assert from "node:assert/strict";
import test from "node:test";

import { mountAgenticEfficiencyRoutes } from "../src/agenticEfficiencyRoutes.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function rateCard(overrides = {}) {
  return {
    version: "rate-card-v1",
    provider: "provider-a",
    model_id: "model-a",
    currency: "EUR",
    input_per_million: 2,
    cached_input_per_million: 0.5,
    output_per_million: 8,
    effective_at: "2026-07-01T00:00:00.000Z",
    source: "server-snapshot",
    provenance_digest: DIGEST,
    ...overrides,
  };
}

class FakeApp {
  constructor() {
    this.routes = new Map();
  }

  get(path, ...handlers) {
    this.routes.set(`GET ${path}`, handlers.at(-1));
  }

  post(path, ...handlers) {
    this.routes.set(`POST ${path}`, handlers.at(-1));
  }
}

function response() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    },
  };
}

function context(overrides = {}) {
  return {
    tenantId: "tenant-a",
    clientType: "chatgpt",
    audience: "chatgpt_connector",
    actorId: "actor-a",
    entitlements: ["core:read", "core:govern"],
    scopes: ["core:read", "core:govern"],
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    goal: "Plan a deterministic bounded task",
    scope: ["services/universal-core-service"],
    success_criteria: ["tests-green"],
    relevant_files: ["services/universal-core-service/src/agenticEfficiencyRuntime.js"],
    requested_agent_count: 4,
    security_tests_passed: true,
    acceptance_evidence: ["test-plan"],
    ...overrides,
  };
}

function storeStub() {
  const usage = [];
  const comparisons = [];
  return {
    usage,
    comparisons,
    async status({ tenant_id }) {
      return { tenant_id, work_capsules: 1, active_claims: 0, reusable_artifacts: 0 };
    },
    async report({ tenant_id }) {
      return { tenant_id, comparisons: 2, actual_comparisons: 0 };
    },
    async getWorkCapsule({ tenant_id, capsule_id }) {
      return capsule_id === "capsule-a" ? { tenant_id, capsule_id, capsule_hash: DIGEST } : null;
    },
    async checkArtifactReuse({ tenant_id, artifact_hash, artifact_version }) {
      return { tenant_id, artifact_hash, artifact_version, reusable: false, reasons: ["artifact_not_found"] };
    },
    async recordUsage(record) {
      usage.push(record);
      return record;
    },
    async recordComparison(record) {
      comparisons.push(record);
      return record;
    },
  };
}

function mount(overrides = {}) {
  const app = new FakeApp();
  const audits = [];
  const result = mountAgenticEfficiencyRoutes({
    app,
    store: storeStub(),
    resolveRequestContext: async (req) => req.trustedContext,
    verifyProviderUsage: async () => ({ verified: false }),
    audit: async (record) => audits.push(record),
    ...overrides,
  });
  return { app, audits, result };
}

async function invoke(app, key, {
  body = {},
  query = {},
  params = {},
  trustedContext = context(),
} = {}) {
  const handler = app.routes.get(key);
  assert(handler, `missing ${key}`);
  const res = response();
  await handler({ body, query, params, trustedContext }, res);
  return res;
}

test("mount exposes exactly eight bounded routes without adding MCP tools or execution authority", () => {
  const { app, result } = mount();
  assert.equal(app.routes.size, 8);
  assert.equal(result.capability_count, 8);
  assert.equal(result.top_level_mcp_tools_added, 0);
  assert.equal(result.hard_budget_stop.active, false);
  assert.equal(result.execution_authorized, false);
});

test("status exposes a rejected hard-stop request without activating it", async () => {
  const { app, result } = mount({
    hardBudgetStopStatus: {
      requested: true,
      active: false,
      state: "rejected",
      advisory_only: true,
      reason: "hard_budget_stop_not_authorized",
    },
  });
  assert.equal(result.hard_budget_stop.active, false);
  assert.equal(result.hard_budget_stop.state, "rejected");

  const status = await invoke(app, "GET /v1/agentic-efficiency/status");
  assert.equal(status.statusCode, 200);
  assert.equal(status.payload.data.hard_budget_stop, false);
  assert.equal(status.payload.data.hard_budget_stop_state, "rejected");
  assert.equal(status.payload.data.hard_budget_stop_advisory_only, true);

  const budget = await invoke(app, "GET /v1/agentic-efficiency/budget/status");
  assert.equal(budget.statusCode, 200);
  assert.equal(budget.payload.data.hard_budget_stop, false);
  assert.equal(budget.payload.data.hard_budget_stop_reason, "hard_budget_stop_not_authorized");
});

test("plan uses server identity and suppresses unnecessary agents", async () => {
  const { app } = mount();
  const res = await invoke(app, "POST /v1/agentic-efficiency/plan", { body: task() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.tenant_id, "tenant-a");
  assert.equal(res.payload.data.plan.agent_count, 1);
  assert.equal(res.payload.data.plan.suppressed_agent_count, 3);
  assert.equal(res.payload.execution_authorized, false);
});

test("payload and query cannot broaden tenant, client, audience or entitlement", async () => {
  const { app } = mount();
  for (const body of [
    { ...task(), tenant_id: "tenant-b" },
    { ...task(), client_type: "admin" },
    { ...task(), entitlements: ["*"] },
  ]) {
    const res = await invoke(app, "POST /v1/agentic-efficiency/plan", { body });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.execution_authorized, false);
    assert.match(res.payload.error, /untrusted_identity_field/);
  }
  const query = await invoke(app, "GET /v1/agentic-efficiency/status", {
    query: { tenant_id: "tenant-b" },
  });
  assert.equal(query.statusCode, 400);
});

test("untrusted client/audience and missing Core scope fail closed", async () => {
  const { app } = mount();
  const wrongAudience = await invoke(app, "GET /v1/agentic-efficiency/status", {
    trustedContext: context({ audience: "smartdesk_runtime" }),
  });
  assert.equal(wrongAudience.statusCode, 403);
  assert.equal(wrongAudience.payload.error, "agentic_client_audience_pair_not_allowed");

  const noScope = await invoke(app, "GET /v1/agentic-efficiency/status", {
    trustedContext: context({ scopes: [], entitlements: [] }),
  });
  assert.equal(noScope.statusCode, 403);
  assert.equal(noScope.payload.error, "agentic_scope_missing");
});

test("budget preview rebuilds the plan under trusted context and remains observe-only", async () => {
  const { app } = mount({
    verifyGovernanceEvidence: async () => ({
      governanceReceiptDigest: DIGEST,
      qualityVerified: true,
      qualityBaseline: 0.98,
      qualityPrediction: 0.98,
      securityVerified: true,
      tenantIsolationVerified: true,
      exposurePolicyVerified: true,
    }),
    resolveRateCard: async () => ({ verified: true, rateCard: rateCard() }),
  });
  const res = await invoke(app, "POST /v1/agentic-efficiency/budget/preview", {
    body: {
      task: task(),
      policy: {
        expires_at: "2099-01-01T00:00:00.000Z",
        security_checks_required: true,
        security_checks_passed: true,
        tenant_isolation_verified: true,
        exposure_policy_verified: true,
        quality_baseline: 0.98,
        quality_prediction: 0.98,
        quality_floor: 0.96,
      },
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.mode, "observe");
  assert.equal(res.payload.data.execution_authorized, false);
  assert.equal(res.payload.data.optimization_allowed, true);
});

test("forged caller security and quality flags cannot authorize a budget preview", async () => {
  const { app } = mount();
  const res = await invoke(app, "POST /v1/agentic-efficiency/budget/preview", {
    body: {
      task: task({
        completed: ["tests-green"],
        test_state: { passed: 100, failed: 0, pending: 0 },
      }),
      policy: {
        expires_at: "2099-01-01T00:00:00.000Z",
        security_checks_required: true,
        security_checks_passed: true,
        tenant_isolation_verified: true,
        exposure_policy_verified: true,
        quality_baseline: 0.99,
        quality_prediction: 0.99,
        quality_floor: 0.97,
      },
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.optimization_allowed, false);
  assert(res.payload.data.reasons.includes("quality_attestation_missing"));
  assert(res.payload.data.reasons.includes("security_checks_unverified"));
});

test("forged caller rate card, quality and safety stay estimated and cannot authorize savings", async () => {
  const { app } = mount({
    verifyProviderUsage: async () => ({ verified: false }),
  });
  const res = await invoke(app, "POST /v1/agentic-efficiency/savings/compare", {
    body: {
      baseline: {
        usage_kind: "actual",
        input_tokens: 1_000,
        output_tokens: 100,
        provider_receipt_digest: DIGEST,
      },
      optimized: {
        usage_kind: "actual",
        input_tokens: 10,
        output_tokens: 1,
        provider_receipt_digest: DIGEST,
      },
      rate_card: rateCard({ input_per_million: 999_999 }),
      baseline_quality: 1,
      optimized_quality: 1,
      security_preserved: true,
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.usage_kind, "estimated");
  assert.equal(res.payload.data.rate_card_verified, false);
  assert.equal(res.payload.data.actual_savings_claim_allowed, false);
  assert.equal(res.payload.data.quality_safety_attestation_verified, false);
});

test("caller rate card cannot authorize budget accounting without the server snapshot", async () => {
  const { app } = mount({
    verifyProviderUsage: async () => ({ verified: false }),
    verifyGovernanceEvidence: async () => ({
      governanceReceiptDigest: DIGEST,
      qualityVerified: true,
      qualityBaseline: 0.98,
      qualityPrediction: 0.98,
      securityVerified: true,
      tenantIsolationVerified: true,
      exposurePolicyVerified: true,
    }),
  });
  const res = await invoke(app, "POST /v1/agentic-efficiency/budget/preview", {
    body: {
      task: task(),
      policy: {
        expires_at: "2099-01-01T00:00:00.000Z",
        security_checks_required: true,
        token_limit: 100_000,
      },
      usage: {
        usage_kind: "actual",
        input_tokens: 100,
        output_tokens: 10,
        provider_receipt_digest: DIGEST,
      },
      rate_card: rateCard({ output_per_million: 999_999 }),
    },
  });
  assert.equal(res.statusCode, 200);
  assert(res.payload.data.reasons.includes("rate_card_unverified"));
  assert.equal(res.payload.data.usage.usage_kind, "estimated");
  assert.equal(res.payload.data.optimization_allowed, false);
});

test("actual usage ignores caller numbers and binds canonical server attestations to non-replayable receipts", async () => {
  const store = storeStub();
  const canonicalBySlot = {
    baseline: {
      usage_kind: "actual",
      input_tokens: 1_000,
      cached_input_tokens: 100,
      output_tokens: 100,
      provider_receipt_digest: DIGEST,
    },
    optimized: {
      usage_kind: "actual",
      input_tokens: 500,
      cached_input_tokens: 50,
      output_tokens: 50,
      provider_receipt_digest: DIGEST_B,
    },
  };
  const { app } = mount({
    store,
    verifyProviderUsage: async ({ slot }) => ({
      verified: true,
      canonicalUsage: canonicalBySlot[slot],
      receiptDigest: canonicalBySlot[slot].provider_receipt_digest,
      runId: slot === "baseline" ? "run-baseline" : "run-optimized",
    }),
    resolveRateCard: async () => ({ verified: true, rateCard: rateCard() }),
    verifySavingsEvidence: async () => ({
      qualitySafetyAttestationVerified: true,
      receiptDigest: DIGEST_B,
      baselineQuality: 0.99,
      optimizedQuality: 0.99,
      securityPreserved: true,
    }),
  });
  const body = {
    baseline: {
      usage_kind: "actual",
      input_tokens: 999_999_999,
      output_tokens: 999_999_999,
      provider_receipt_digest: DIGEST,
    },
    optimized: {
      usage_kind: "actual",
      input_tokens: 1,
      output_tokens: 1,
      provider_receipt_digest: DIGEST_B,
    },
    rate_card: rateCard({ input_per_million: 999_999 }),
    baseline_quality: 0,
    optimized_quality: 0,
    security_preserved: false,
  };
  const res = await invoke(app, "POST /v1/agentic-efficiency/savings/compare", { body });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.usage_kind, "actual");
  assert.equal(res.payload.data.baseline.input_tokens, 1_000);
  assert.equal(res.payload.data.optimized.input_tokens, 500);
  assert.equal(res.payload.data.rate_card_verified, true);
  assert.deepEqual(store.usage, []);
  assert.deepEqual(store.comparisons, []);

  canonicalBySlot.optimized = {
    ...canonicalBySlot.optimized,
    provider_receipt_digest: DIGEST,
  };
  const replay = await invoke(app, "POST /v1/agentic-efficiency/savings/compare", { body });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.payload.error, "agentic_provider_receipt_replayed");
});

test("capsule and artifact reads are tenant-bound by the server resolver", async () => {
  const { app } = mount();
  const capsule = await invoke(app, "GET /v1/agentic-efficiency/work-capsules/:capsule_id", {
    params: { capsule_id: "capsule-a" },
  });
  assert.equal(capsule.statusCode, 200);
  assert.equal(capsule.payload.data.tenant_id, "tenant-a");

  const artifact = await invoke(app, "POST /v1/agentic-efficiency/artifacts/reuse-check", {
    body: { artifact_hash: DIGEST, artifact_version: "v1" },
  });
  assert.equal(artifact.statusCode, 200);
  assert.equal(artifact.payload.data.tenant_id, "tenant-a");
  assert.equal(artifact.payload.data.reusable, false);
});
