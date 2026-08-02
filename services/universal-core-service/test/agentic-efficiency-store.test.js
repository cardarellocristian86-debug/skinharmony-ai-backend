import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  agenticEfficiencyMigrationPlan,
  createAgenticEfficiencyPostgresStore,
} from "../src/agenticEfficiencyStore.js";

const NOW = new Date("2026-07-27T20:00:00.000Z");
const RECEIPT = `sha256:${"a".repeat(64)}`;
const ARTIFACT = `sha256:${"b".repeat(64)}`;

function capsule(overrides = {}) {
  return {
    goal: "Persist a resumable bounded checkpoint",
    scope: ["services/universal-core-service"],
    success_criteria: ["restart-resumes"],
    decisions: [],
    completed: [],
    open_risks: [],
    relevant_files: ["services/universal-core-service/src/agenticEfficiencyStore.js"],
    changed_files: ["services/universal-core-service/src/agenticEfficiencyStore.js"],
    diff_summary: "Additive tenant-bound store",
    test_state: { passed: 0, failed: 0, pending: 1 },
    artifact_hashes: [ARTIFACT],
    reusable_results: [],
    next_action: "Resume the focused test",
    budget: { token_limit: 10_000, invocation_limit: 4, retry_limit: 2 },
    created_at: "2026-07-27T19:59:00.000Z",
    expires_at: "2026-07-27T22:00:00.000Z",
    ...overrides,
  };
}

function normalizedUsage(overrides = {}) {
  return {
    usage_kind: "estimated",
    reconciled: false,
    input_tokens: 100,
    cached_input_tokens: 0,
    output_tokens: 20,
    total_tokens: 120,
    amount: 0.001,
    currency: "EUR",
    formula: "(uncached_input*input_rate + cached_input*cached_rate + output*output_rate)/1000000",
    rate_card_version: "rate-v1",
    rate_card_provenance: ARTIFACT,
    rate_card_verified: true,
    usage_source: "verified_rate_card_estimate",
    provider_receipt_digest: null,
    ...overrides,
  };
}

function comparison(overrides = {}) {
  return {
    schema_version: "agentic_savings_comparison_v1",
    tenant_id: "tenant-a",
    usage_kind: "estimated",
    reconciled: false,
    baseline: normalizedUsage(),
    optimized: normalizedUsage({ input_tokens: 80, output_tokens: 20, total_tokens: 100 }),
    token_savings_ratio: 0.1667,
    amount_savings: 0.0002,
    quality: {
      baseline: 1,
      optimized: 1,
      loss: 0,
      within_floor: true,
    },
    security_preserved: true,
    quality_safety_attestation_verified: false,
    rate_card_verified: true,
    actual_savings_claim_allowed: false,
    label: "estimated_or_unreconciled_comparison",
    execution_authorized: false,
    ...overrides,
  };
}

class FakePostgresPool {
  constructor() {
    this.calls = [];
    this.capsules = new Map();
    this.budgets = new Map();
    this.baselines = new Map();
    this.comparisons = new Map();
    this.savingsClaims = new Map();
    this.rateCards = new Map();
    this.migrationAudit = [];
  }

  async connect() {
    return { query: this.query.bind(this), release() {} };
  }

  async query(query, params = []) {
    const sql = String(query).replace(/\s+/g, " ").trim();
    this.calls.push({ sql, params });
    if (
      ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)
      || sql.startsWith("CREATE ")
      || sql.startsWith("ALTER ")
      || sql.startsWith("DO $role$")
      || sql.startsWith("GRANT ")
      || sql.startsWith("UPDATE agentic_governance.agentic_work_capsule SET expires_at=")
      || sql.startsWith("SET LOCAL ROLE ")
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SELECT current_user::text AS current_user")) {
      return {
        rows: [{
          current_user: "agentic_runtime",
          session_user: "governance_service_owner",
          schema_usage: true,
          capsule_ready: true,
          artifact_ready: true,
          usage_ready: true,
          comparison_ready: true,
          budget_ready: true,
          baseline_ready: true,
          savings_ready: true,
          rate_card_ready: true,
        }],
        rowCount: 1,
      };
    }
    if (sql.startsWith("SELECT state FROM agentic_governance.agentic_schema_migration_audit")) {
      return {
        rows: [{ state: this.migrationAudit.at(-1)?.state || "active" }],
        rowCount: 1,
      };
    }
    if (sql.includes("INSERT INTO agentic_governance.agentic_schema_migration_audit")) {
      this.migrationAudit.push({
        version: params[0],
        state: sql.includes("'disabled'") ? "disabled" : "active",
        actor: params[2],
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO agentic_governance.agentic_work_capsule")) {
      const [capsuleId, tenantId, capsuleHash, capsuleJson, expiresAt, actor, receipt, timestamp] = params;
      const key = `${tenantId}:${capsuleId}`;
      const current = this.capsules.get(key);
      if (current) return { rows: [], rowCount: 0 };
      const row = {
        capsule_id: capsuleId,
        tenant_id: tenantId,
        version: current ? current.version + 1 : 1,
        capsule_hash: capsuleHash,
        capsule: JSON.parse(capsuleJson),
        expires_at: expiresAt,
        actor_provenance: actor,
        receipt_digest: receipt,
        lease_owner: current?.lease_owner || null,
        lease_expires_at: current?.lease_expires_at || null,
        created_at: current?.created_at || timestamp,
        updated_at: timestamp,
      };
      this.capsules.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE agentic_governance.agentic_work_capsule SET version=version+1")) {
      const [tenantId, capsuleId, capsuleHash, capsuleJson, expiresAt, actor, receipt, timestamp, expected] = params;
      const key = `${tenantId}:${capsuleId}`;
      const current = this.capsules.get(key);
      if (!current || current.version !== expected) return { rows: [], rowCount: 0 };
      const row = {
        ...current,
        version: current.version + 1,
        capsule_hash: capsuleHash,
        capsule: JSON.parse(capsuleJson),
        expires_at: expiresAt,
        actor_provenance: actor,
        receipt_digest: receipt,
        updated_at: timestamp,
      };
      this.capsules.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT * FROM agentic_governance.agentic_work_capsule")) {
      const [tenantId, capsuleId] = params;
      const row = this.capsules.get(`${tenantId}:${capsuleId}`);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE agentic_governance.agentic_work_capsule SET lease_owner=$3")) {
      const [tenantId, capsuleId, claimant, expires, timestamp] = params;
      const key = `${tenantId}:${capsuleId}`;
      const row = this.capsules.get(key);
      if (!row) return { rows: [], rowCount: 0 };
      const leaseActive = row.lease_owner && Date.parse(row.lease_expires_at) > Date.parse(timestamp);
      if (leaseActive && row.lease_owner !== claimant) return { rows: [], rowCount: 0 };
      Object.assign(row, { lease_owner: claimant, lease_expires_at: expires, updated_at: timestamp });
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE agentic_governance.agentic_work_capsule SET lease_owner=NULL")) {
      const [tenantId, capsuleId, claimant, timestamp] = params;
      const row = this.capsules.get(`${tenantId}:${capsuleId}`);
      if (!row || row.lease_owner !== claimant) return { rows: [], rowCount: 0 };
      Object.assign(row, { lease_owner: null, lease_expires_at: null, updated_at: timestamp });
      return { rows: [{ capsule_id: capsuleId }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO agentic_governance.agentic_run_budget")) {
      const [tenantId, runId, policyVersion, budgetJson, policyExpiresAt, actor, receipt, timestamp] = params;
      const key = `${tenantId}:${runId}`;
      const prior = this.budgets.get(key);
      if (prior && prior.receipt_digest !== receipt) return { rows: [], rowCount: 0 };
      const row = {
        tenant_id: tenantId,
        run_id: runId,
        policy_version: policyVersion,
        budget: JSON.parse(budgetJson),
        policy_expires_at: policyExpiresAt,
        actor_provenance: actor,
        receipt_digest: receipt,
        created_at: prior?.created_at || timestamp,
        updated_at: timestamp,
      };
      this.budgets.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT tenant_id,run_id,policy_version,budget,policy_expires_at")) {
      const [tenantId, runId] = params;
      const row = this.budgets.get(`${tenantId}:${runId}`);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO agentic_governance.agentic_efficiency_baseline")) {
      const [tenantId, baselineId, repositorySnapshot, rubricDigest, metricsJson, usageKind, actor, receipt, createdAt] = params;
      const key = `${tenantId}:${baselineId}`;
      if (this.baselines.has(key)) return { rows: [], rowCount: 0 };
      const row = {
        tenant_id: tenantId,
        baseline_id: baselineId,
        repository_snapshot: repositorySnapshot,
        rubric_digest: rubricDigest,
        metrics: JSON.parse(metricsJson),
        usage_kind: usageKind,
        actor_provenance: actor,
        receipt_digest: receipt,
        created_at: createdAt,
      };
      this.baselines.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT tenant_id,baseline_id,repository_snapshot,rubric_digest")) {
      const [tenantId, baselineId] = params;
      const row = this.baselines.get(`${tenantId}:${baselineId}`);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO agentic_governance.agentic_rate_card_snapshot")) {
      const [
        tenantId,
        rateCardVersion,
        provider,
        modelId,
        currency,
        ratesJson,
        sourceReference,
        provenanceDigest,
        effectiveAt,
        expiresAt,
        actor,
        receipt,
        createdAt,
      ] = params;
      const key = `${tenantId}:${rateCardVersion}`;
      if (this.rateCards.has(key)) return { rows: [], rowCount: 0 };
      const row = {
        tenant_id: tenantId,
        rate_card_version: rateCardVersion,
        provider,
        model_id: modelId,
        currency,
        rates: JSON.parse(ratesJson),
        source_reference: sourceReference,
        provenance_digest: provenanceDigest,
        effective_at: effectiveAt,
        expires_at: expiresAt,
        actor_provenance: actor,
        receipt_digest: receipt,
        created_at: createdAt,
      };
      this.rateCards.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT tenant_id,rate_card_version,provider,model_id")) {
      const [tenantId, rateCardVersion] = params;
      const row = this.rateCards.get(`${tenantId}:${rateCardVersion}`);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT usage_kind,quality_floor_preserved,safety_preserved")) {
      const [tenantId, comparisonId] = params;
      const row = this.comparisons.get(`${tenantId}:${comparisonId}`);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO agentic_governance.agentic_savings_claim")) {
      const [
        tenantId,
        claimId,
        comparisonId,
        claimKind,
        reconciled,
        amountJson,
        qualityJson,
        actor,
        receipt,
        createdAt,
      ] = params;
      const key = `${tenantId}:${claimId}`;
      if (this.savingsClaims.has(key)) return { rows: [], rowCount: 0 };
      const row = {
        tenant_id: tenantId,
        claim_id: claimId,
        comparison_id: comparisonId,
        claim_kind: claimKind,
        reconciled,
        amount: JSON.parse(amountJson),
        quality_delta: JSON.parse(qualityJson),
        actor_provenance: actor,
        receipt_digest: receipt,
        created_at: createdAt,
      };
      this.savingsClaims.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    throw new Error(`unexpected_fake_query:${sql}`);
  }
}

test("migration is additive, defines the eight required structures and rollback preserves audit", () => {
  const migration = agenticEfficiencyMigrationPlan();
  const joined = readFileSync(
    new URL("../migrations/0.16.0-agentic-efficiency.up.sql", import.meta.url),
    "utf8",
  );
  const rollback = readFileSync(
    new URL("../migrations/0.16.0-agentic-efficiency.down.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "agentic_run_budget",
    "agentic_usage_ledger",
    "agentic_work_capsule",
    "agentic_artifact_reuse",
    "agentic_efficiency_baseline",
    "agentic_efficiency_comparison",
    "agentic_savings_claim",
    "agentic_rate_card_snapshot",
  ]) {
    assert(joined.includes(table), `missing table ${table}`);
  }
  assert.equal(migration.additive, true);
  assert.equal(migration.rollback_safe, true);
  assert.equal(migration.preserves_audit, true);
  assert.equal(migration.creates_database, false);
  assert.equal(migration.creates_service, false);
  assert.equal(migration.runtime_ddl, false);
  assert.equal(migration.migration_artifact, "migrations/0.16.0-agentic-efficiency.up.sql");
  assert.equal(joined.includes("DROP "), false);
  assert(joined.includes("CREATE ROLE nyra_agentic_runtime_v016 NOLOGIN"));
  assert.equal(joined.includes("PASSWORD"), false);
  assert(rollback.includes("REVOKE USAGE ON SCHEMA agentic_governance"));
  assert(rollback.includes("REVOKE nyra_agentic_runtime_v016 FROM CURRENT_USER"));
  assert.equal(rollback.includes("DROP "), false);
});

test("store fails closed without the isolated governance database URL", () => {
  assert.throws(() => createAgenticEfficiencyPostgresStore({}), /governed_agent_database_url_invalid/);
});

test("fake-pool migration, checkpoint restart, tenant isolation and duplicate claim are enforced", async () => {
  const pool = new FakePostgresPool();
  const options = {
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(NOW),
    runtimeRole: "agentic_runtime",
    roleSeparationAttested: false,
  };
  const first = createAgenticEfficiencyPostgresStore(options);
  const initialized = await first.initialize({
    actor_provenance: "core:migration-test",
    rollback_reference: "git:rollback",
  });
  assert.equal(initialized.initialized, true);
  assert(pool.calls.some(({ sql }) => sql.startsWith(
    "SELECT state FROM agentic_governance.agentic_schema_migration_audit",
  )));
  assert.equal(pool.calls.some(({ sql }) => /^(?:CREATE|ALTER|DO \\$role\\$|GRANT )/.test(sql)), false);

  const saved = await first.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-1",
    capsule: capsule(),
    expected_version: 0,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });
  assert.equal(saved.version, 1);

  await first.claimWork({
    tenant_id: "tenant-a",
    capsule_id: "task-1",
    claimant_id: "agent-a",
    lease_ms: 60_000,
  });
  await assert.rejects(
    first.claimWork({
      tenant_id: "tenant-a",
      capsule_id: "task-1",
      claimant_id: "agent-b",
      lease_ms: 60_000,
    }),
    /duplicate_execution_blocked/,
  );

  const restarted = createAgenticEfficiencyPostgresStore(options);
  const resumed = await restarted.getWorkCapsule({ tenant_id: "tenant-a", capsule_id: "task-1" });
  assert.equal(resumed.capsule.next_action, "Resume the focused test");
  assert.equal(resumed.version, 1);
  assert.equal(await restarted.getWorkCapsule({ tenant_id: "tenant-b", capsule_id: "task-1" }), null);

  const rollback = await restarted.rollbackMigration({
    actor_provenance: "core:rollback-test",
    rollback_reference: "git:rollback",
  });
  assert.equal(rollback.data_dropped, false);
  assert.equal(rollback.audit_preserved, true);
  assert.equal(pool.capsules.size, 1);
  assert(pool.migrationAudit.some((entry) => entry.state === "disabled"));
  assert.deepEqual(restarted.roleSeparationStatus(), {
    attested: false,
    runtime_role_configured: true,
    probe_attempted: true,
    session_user_separated: false,
    reads_allowed: false,
    writes_allowed: false,
    reason: "static_migration_disabled_by_rollback",
  });
  const roleProbeCount = pool.calls.filter(({ sql }) =>
    sql.startsWith("SET LOCAL ROLE ")).length;
  await assert.rejects(
    restarted.getWorkCapsule({ tenant_id: "tenant-a", capsule_id: "task-1" }),
    /agentic_static_migration_not_active/,
  );
  assert.equal(
    pool.calls.filter(({ sql }) => sql.startsWith("SET LOCAL ROLE ")).length,
    roleProbeCount,
    "same-instance read must stop before re-attesting the revoked runtime role",
  );
});

test("optimistic concurrency supports create-update and rejects stale capsule versions", async () => {
  const pool = new FakePostgresPool();
  const store = createAgenticEfficiencyPostgresStore({
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(NOW),
    runtimeRole: "agentic_runtime",
    roleSeparationAttested: false,
  });
  await store.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-2",
    capsule: capsule(),
    expected_version: 0,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });
  const updated = await store.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-2",
    capsule: capsule({ next_action: "Second revision" }),
    expected_version: 1,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.capsule.next_action, "Second revision");

  await assert.rejects(
    store.saveWorkCapsule({
      tenant_id: "tenant-a",
      capsule_id: "task-2",
      capsule: capsule({ next_action: "Stale revision" }),
      expected_version: 1,
      actor_provenance: "agent-a",
      receipt_digest: RECEIPT,
    }),
    /work_capsule_revision_conflict/,
  );
});

test("run budgets, baselines, rate cards and savings claims are operational and provenance-bound", async () => {
  const pool = new FakePostgresPool();
  const store = createAgenticEfficiencyPostgresStore({
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(NOW),
    runtimeRole: "agentic_runtime",
  });
  const budget = await store.saveRunBudget({
    tenant_id: "tenant-a",
    run_id: "run-a",
    policy_version: "budget-v1",
    budget: { token_limit: 10_000, invocation_limit: 4, retry_limit: 2 },
    policy_expires_at: "2026-07-27T21:00:00.000Z",
    actor_provenance: "core:budget-guard",
    receipt_digest: RECEIPT,
  });
  assert.equal(budget.policy_version, "budget-v1");
  assert.equal((await store.getRunBudget({ tenant_id: "tenant-a", run_id: "run-a" })).run_id, "run-a");
  assert.equal(await store.getRunBudget({ tenant_id: "tenant-b", run_id: "run-a" }), null);
  await assert.rejects(
    store.saveRunBudget({
      tenant_id: "tenant-a",
      run_id: "run-a",
      policy_version: "budget-v2",
      budget: { token_limit: 1 },
      policy_expires_at: "2026-07-27T21:00:00.000Z",
      actor_provenance: "core:budget-guard",
      receipt_digest: `sha256:${"c".repeat(64)}`,
    }),
    /agentic_run_budget_conflict/,
  );

  const baseline = await store.recordBaseline({
    tenant_id: "tenant-a",
    baseline_id: "baseline-a",
    repository_snapshot: ARTIFACT,
    rubric_digest: RECEIPT,
    metrics: { usage_kind: "estimated", quality: 1 },
    usage_kind: "estimated",
    actor_provenance: "core:evaluation",
    receipt_digest: RECEIPT,
  });
  assert.equal(baseline.usage_kind, "estimated");
  assert.equal((await store.getBaseline({ tenant_id: "tenant-a", baseline_id: "baseline-a" })).baseline_id, "baseline-a");
  await assert.rejects(
    store.recordBaseline({
      tenant_id: "tenant-a",
      baseline_id: "baseline-forged-actual",
      repository_snapshot: ARTIFACT,
      rubric_digest: RECEIPT,
      metrics: { usage_kind: "actual" },
      usage_kind: "actual",
      actor_provenance: "core:evaluation",
      receipt_digest: RECEIPT,
    }),
    /actual_usage_unverified/,
  );

  const rateCard = await store.saveRateCardSnapshot({
    tenant_id: "tenant-a",
    rate_card_version: "rate-v1",
    provider: "provider-a",
    model_id: "model-a",
    currency: "EUR",
    rates: { input_per_million: 1, output_per_million: 2 },
    source_reference: "provider-published-rate-card",
    provenance_digest: ARTIFACT,
    effective_at: "2026-07-27T19:00:00.000Z",
    expires_at: "2026-07-28T20:00:00.000Z",
    actor_provenance: "core:rate-card",
    receipt_digest: RECEIPT,
  });
  assert.equal(rateCard.rate_card_version, "rate-v1");
  assert.equal((await store.getRateCardSnapshot({
    tenant_id: "tenant-a",
    rate_card_version: "rate-v1",
  })).provider, "provider-a");

  pool.comparisons.set("tenant-a:comparison-estimated", {
    usage_kind: "estimated",
    quality_floor_preserved: true,
    safety_preserved: true,
  });
  await assert.rejects(
    store.recordSavingsClaim({
      tenant_id: "tenant-a",
      claim_id: "claim-forged-actual",
      comparison_id: "comparison-estimated",
      claim_kind: "actual",
      reconciled: true,
      amount: { value: 10, currency: "EUR" },
      quality_delta: { loss: 0 },
      actor_provenance: "core:savings",
      receipt_digest: RECEIPT,
    }),
    /actual_savings_claim_unverified/,
  );
  const estimatedClaim = await store.recordSavingsClaim({
    tenant_id: "tenant-a",
    claim_id: "claim-estimated",
    comparison_id: "comparison-estimated",
    claim_kind: "estimated",
    reconciled: false,
    amount: { value: 10, currency: "EUR" },
    quality_delta: { loss: 0 },
    actor_provenance: "core:savings",
    receipt_digest: RECEIPT,
  });
  assert.equal(estimatedClaim.claim_kind, "estimated");
  assert.equal(estimatedClaim.reconciled, false);
});

test("every JSONB write boundary rejects raw fields, PII and usage-kind ambiguity", async () => {
  const store = createAgenticEfficiencyPostgresStore({
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool: new FakePostgresPool(),
    now: () => new Date(NOW),
    runtimeRole: "agentic_runtime",
  });
  const common = {
    tenant_id: "tenant-a",
    actor_provenance: "core:privacy-guard",
    receipt_digest: RECEIPT,
  };

  await assert.rejects(
    store.saveRunBudget({
      ...common,
      run_id: "run-private-budget",
      policy_version: "budget-v1",
      budget: { token_limit: 10, raw_prompt: "private prompt" },
      policy_expires_at: "2026-07-27T21:00:00.000Z",
    }),
    /sensitive_field_forbidden/,
  );
  await assert.rejects(
    store.saveRunBudget({
      ...common,
      run_id: "mario.rossi@example.test",
      policy_version: "budget-v1",
      budget: { token_limit: 10 },
      policy_expires_at: "2026-07-27T21:00:00.000Z",
    }),
    /run_id_invalid/,
  );
  await assert.rejects(
    store.saveRunBudget({
      ...common,
      run_id: "run_393331234567",
      policy_version: "budget-v1",
      budget: { token_limit: 10 },
      policy_expires_at: "2026-07-27T21:00:00.000Z",
    }),
    /run_id_invalid/,
  );
  await assert.rejects(
    store.recordUsage({
      ...common,
      run_id: "run-private-usage",
      usage: normalizedUsage({ usage_source: "mario.rossi@example.test" }),
    }),
    /sensitive_content_forbidden/,
  );
  await assert.rejects(
    store.recordBaseline({
      ...common,
      baseline_id: "baseline-private",
      repository_snapshot: ARTIFACT,
      rubric_digest: RECEIPT,
      metrics: {
        usage_kind: "estimated",
        quality: 1,
        currency: "+39 333 1234567",
      },
      usage_kind: "estimated",
    }),
    /sensitive_content_forbidden/,
  );
  await assert.rejects(
    store.saveRateCardSnapshot({
      ...common,
      rate_card_version: "rate-private",
      provider: "provider-a",
      model_id: "model-a",
      currency: "EUR",
      rates: {
        input_per_million: 1,
        output_per_million: 2,
        raw_prompt: "private prompt",
      },
      source_reference: "provider-rate-card",
      provenance_digest: ARTIFACT,
      effective_at: "2026-07-27T19:00:00.000Z",
      expires_at: "2026-07-28T20:00:00.000Z",
    }),
    /sensitive_field_forbidden/,
  );
  await assert.rejects(
    store.recordComparison({
      ...common,
      comparison_id: "comparison-private",
      baseline_id: "baseline-a",
      optimized_run_id: "run-a",
      comparison: {
        ...comparison(),
        raw_prompt: "private prompt",
      },
    }),
    /sensitive_field_forbidden/,
  );
  await assert.rejects(
    store.recordSavingsClaim({
      ...common,
      claim_id: "claim-private",
      comparison_id: "comparison-a",
      claim_kind: "estimated",
      reconciled: false,
      amount: { value: 1, currency: "mario.rossi@example.test" },
      quality_delta: { loss: 0 },
    }),
    /sensitive_content_forbidden/,
  );

  await assert.rejects(
    store.recordBaseline({
      ...common,
      baseline_id: "baseline-kind-mismatch",
      repository_snapshot: ARTIFACT,
      rubric_digest: RECEIPT,
      metrics: { usage_kind: "actual", quality: 1 },
      usage_kind: "estimated",
    }),
    /usage_kind_mismatch/,
  );
  const actualUsage = normalizedUsage({
    usage_kind: "actual",
    reconciled: true,
    provider_receipt_digest: RECEIPT,
  });
  await assert.rejects(
    store.recordComparison({
      ...common,
      comparison_id: "comparison-kind-mismatch",
      baseline_id: "baseline-a",
      optimized_run_id: "run-a",
      comparison: comparison({
        baseline: actualUsage,
        optimized: actualUsage,
      }),
    }),
    /usage_binding_invalid/,
  );
});

test("an exact expired capsule can be verified and CAS-refreshed after restart", async () => {
  const pool = new FakePostgresPool();
  let clock = new Date("2026-07-27T20:00:00.000Z");
  const options = {
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(clock),
    runtimeRole: "agentic_runtime",
    roleSeparationAttested: false,
  };
  const first = createAgenticEfficiencyPostgresStore(options);
  await first.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-expiry",
    capsule: capsule({ expires_at: "2026-07-27T20:01:00.000Z" }),
    expected_version: 0,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });

  clock = new Date("2026-07-27T20:02:00.000Z");
  const restarted = createAgenticEfficiencyPostgresStore(options);
  await assert.rejects(
    restarted.getWorkCapsule({ tenant_id: "tenant-a", capsule_id: "task-expiry" }),
    /work_capsule_stale/,
  );
  const expired = await restarted.getWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-expiry",
    allow_expired: true,
  });
  assert.equal(expired.version, 1);
  const refreshed = await restarted.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-expiry",
    capsule: capsule({
      created_at: "2026-07-27T20:02:00.000Z",
      expires_at: "2026-07-27T21:02:00.000Z",
    }),
    expected_version: expired.version,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });
  assert.equal(refreshed.version, 2);
  assert.equal(
    (await restarted.getWorkCapsule({
      tenant_id: "tenant-a",
      capsule_id: "task-expiry",
    })).capsule.expires_at,
    "2026-07-27T21:02:00.000Z",
  );
});

test("runtime writes fail closed until a pre-existing separated role is attested", async () => {
  const pool = new FakePostgresPool();
  const store = createAgenticEfficiencyPostgresStore({
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(NOW),
  });
  assert.equal(store.roleSeparationStatus().attested, false);
  assert.equal(store.roleSeparationStatus().runtime_role_configured, false);
  assert.equal(store.roleSeparationStatus().writes_allowed, false);
  await assert.rejects(
    store.saveWorkCapsule({
      tenant_id: "tenant-a",
      capsule_id: "task-role",
      capsule: capsule(),
      expected_version: 0,
      actor_provenance: "agent-a",
      receipt_digest: RECEIPT,
    }),
    /agentic_runtime_role_attestation_failed/,
  );
});
