import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

import {
  AI_LEARNING_FACTORY_RUNTIME_ROLE,
  createAiLearningFactoryPostgresPersistence,
} from "../src/aiLearningFactoryPostgres.js";
import { createAiLearningFactoryStore } from "../src/aiLearningFactoryStore.js";
import {
  AGENTIC_EFFICIENCY_RUNTIME_ROLE,
  createAgenticEfficiencyPostgresStore,
} from "../src/agenticEfficiencyStore.js";
import { applyV016StaticMigrations } from "../src/v016StaticMigrations.js";

const integrationTest = process.env.RUN_POSTGRES_INTEGRATION === "1" ? test : test.skip;
const RECEIPT = `sha256:${"a".repeat(64)}`;

function scorecard() {
  return {
    scorecard_id: "scorecard-postgres-v016",
    release_version: "0.16.0",
    dataset_version: "dataset-v1",
    benchmark_manifest_digest: `sha256:${"b".repeat(64)}`,
    metrics: {
      branch_selection_accuracy: 0.96,
      tool_selection_accuracy: 0.97,
      safety_compliance_score: 1,
    },
    regression_count: 0,
    regressions: [],
    evidence_refs: ["evidence-v016"],
    confidence: 0.95,
    limitations: ["shadow-only"],
    proposal: "Keep the release in shadow.",
  };
}

function capsule() {
  return {
    goal: "Resume a bounded PostgreSQL checkpoint",
    scope: ["services/universal-core-service"],
    success_criteria: ["restart-resumes"],
    decisions: [],
    completed: [],
    open_risks: [],
    relevant_files: [],
    changed_files: [],
    diff_summary: "PostgreSQL integration fixture",
    test_state: { passed: 1, failed: 0, pending: 0 },
    artifact_hashes: [],
    reusable_results: [],
    next_action: "Read after restart",
    budget: { token_limit: 1000, invocation_limit: 2, retry_limit: 1 },
    created_at: "2026-07-27T20:00:00.000Z",
    expires_at: "2099-07-27T21:00:00.000Z",
  };
}

integrationTest("v0.16 static migrations attest roles, survive restart and preserve audit on rollback", async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert(connectionString, "TEST_DATABASE_URL is required when RUN_POSTGRES_INTEGRATION=1");
  const pool = new pg.Pool({ connectionString, max: 4 });
  try {
    const migrationReceipt = await applyV016StaticMigrations({ pool });
    assert.equal(migrationReceipt.applied_count, 2);
    assert.equal(migrationReceipt.reconciled_count, 0);
    const migrationReplay = await applyV016StaticMigrations({ pool });
    assert.equal(migrationReplay.applied_count, 0);
    assert.equal(migrationReplay.reconciled_count, 2);
    const migrationAudit = await pool.query(
      `(SELECT migration_version,state,migration_digest,rollback_reference
        FROM ai_learning_governance.schema_migration_audit
        WHERE migration_version='0.16.0-ai-learning-factory-v1'
        ORDER BY applied_at DESC
        LIMIT 1)
       UNION ALL
       (SELECT migration_version,state,migration_digest,rollback_reference
        FROM agentic_governance.agentic_schema_migration_audit
        WHERE migration_version='0.16.0-agentic-efficiency-v1'
        ORDER BY applied_at DESC
        LIMIT 1)
       ORDER BY migration_version`,
    );
    assert.deepEqual(
      migrationAudit.rows.map((row) => ({
        version: row.migration_version,
        state: row.state,
        digest: row.migration_digest,
        rollback_reference: row.rollback_reference,
      })),
      [...migrationReceipt.migrations]
        .sort((left, right) => left.version.localeCompare(right.version))
        .map((item) => ({
          version: item.version,
          state: "active",
          digest: item.digest,
          rollback_reference: item.rollback_reference,
        })),
    );

    const aiPersistence = createAiLearningFactoryPostgresPersistence({
      pool,
      runtimeRole: AI_LEARNING_FACTORY_RUNTIME_ROLE,
    });
    await aiPersistence.initialize();
    assert.deepEqual(
      {
        read: aiPersistence.readiness().persistence_read_ready,
        write: aiPersistence.readiness().persistence_write_ready,
        attested: aiPersistence.readiness().runtime_role_attested,
      },
      { read: true, write: true, attested: true },
    );
    const aiStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true, adapter: aiPersistence.learningAdapter });
    const created = await aiStore.recordEvaluationScorecard({
      tenant_id: "tenant-pg-a",
      record: scorecard(),
      idempotency_key: "postgres-restart-idempotency",
      expected_revision: 0,
    });

    const restartedAi = createAiLearningFactoryPostgresPersistence({
      pool,
      runtimeRole: AI_LEARNING_FACTORY_RUNTIME_ROLE,
    });
    const restartedStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true, adapter: restartedAi.learningAdapter });
    const replay = await restartedStore.recordEvaluationScorecard({
      tenant_id: "tenant-pg-a",
      record: scorecard(),
      idempotency_key: "postgres-restart-idempotency",
      expected_revision: 0,
    });
    assert.deepEqual(replay, created);
    await assert.rejects(
      restartedStore.recordEvaluationScorecard({
        tenant_id: "tenant-pg-a",
        record: { ...scorecard(), proposal: "Mismatched replay." },
        idempotency_key: "postgres-restart-idempotency",
        expected_revision: 0,
      }),
      /learning_factory_idempotency_conflict/,
    );

    const agentic = createAgenticEfficiencyPostgresStore({
      connectionString,
      pool,
      runtimeRole: AGENTIC_EFFICIENCY_RUNTIME_ROLE,
    });
    await agentic.initialize();
    const saved = await agentic.saveWorkCapsule({
      tenant_id: "tenant-pg-a",
      capsule_id: "capsule-postgres-v016",
      capsule: capsule(),
      expected_version: 0,
      actor_provenance: "postgres-integration",
      receipt_digest: RECEIPT,
    });
    const restartedAgentic = createAgenticEfficiencyPostgresStore({
      connectionString,
      pool,
      runtimeRole: AGENTIC_EFFICIENCY_RUNTIME_ROLE,
    });
    assert.equal(
      (await restartedAgentic.getWorkCapsule({
        tenant_id: "tenant-pg-a",
        capsule_id: "capsule-postgres-v016",
      })).capsule_hash,
      saved.capsule_hash,
    );

    const privileges = await pool.query(
      `SELECT
         has_table_privilege($1,'ai_learning_governance.learning_record','DELETE') AS ai_delete,
         has_table_privilege($2,'agentic_governance.agentic_work_capsule','DELETE') AS agentic_delete`,
      [AI_LEARNING_FACTORY_RUNTIME_ROLE, AGENTIC_EFFICIENCY_RUNTIME_ROLE],
    );
    assert.equal(privileges.rows[0].ai_delete, false);
    assert.equal(privileges.rows[0].agentic_delete, false);

    await aiPersistence.rollbackMigration({
      actor_provenance: "postgres-integration-rollback",
      rollback_reference: migrationReceipt.migrations[0].rollback_reference,
    });
    await agentic.rollbackMigration({
      actor_provenance: "postgres-integration-rollback",
      rollback_reference: migrationReceipt.migrations[1].rollback_reference,
    });
    for (const artifact of [
      "../migrations/0.16.0-ai-learning-factory.down.sql",
      "../migrations/0.16.0-agentic-efficiency.down.sql",
    ]) {
      await pool.query(await readFile(new URL(artifact, import.meta.url), "utf8"));
    }
    const retained = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM ai_learning_governance.learning_record) AS learning_records,
         (SELECT count(*)::int FROM agentic_governance.agentic_work_capsule) AS capsules,
         (SELECT count(*)::int FROM ai_learning_governance.schema_migration_audit WHERE state='disabled') AS ai_rollbacks,
         (SELECT count(*)::int FROM agentic_governance.agentic_schema_migration_audit WHERE state='disabled') AS agentic_rollbacks`,
    );
    assert.deepEqual(retained.rows[0], {
      learning_records: 1,
      capsules: 1,
      ai_rollbacks: 2,
      agentic_rollbacks: 2,
    });
    const disabledAi = createAiLearningFactoryPostgresPersistence({
      pool,
      runtimeRole: AI_LEARNING_FACTORY_RUNTIME_ROLE,
    });
    await assert.rejects(
      disabledAi.initialize(),
      /ai_learning_static_migration_not_active/,
    );
    const disabledAgentic = createAgenticEfficiencyPostgresStore({
      connectionString,
      pool,
      runtimeRole: AGENTIC_EFFICIENCY_RUNTIME_ROLE,
    });
    await assert.rejects(
      disabledAgentic.initialize(),
      /agentic_static_migration_not_active/,
    );

    const recovered = await applyV016StaticMigrations({ pool });
    assert.equal(recovered.applied_count, 2);
    assert.equal(recovered.reconciled_count, 0);
    const recoveredAi = createAiLearningFactoryPostgresPersistence({
      pool,
      runtimeRole: AI_LEARNING_FACTORY_RUNTIME_ROLE,
    });
    await recoveredAi.initialize();
    const recoveredAgentic = createAgenticEfficiencyPostgresStore({
      connectionString,
      pool,
      runtimeRole: AGENTIC_EFFICIENCY_RUNTIME_ROLE,
    });
    await recoveredAgentic.initialize();
  } finally {
    await pool.end();
  }
});
