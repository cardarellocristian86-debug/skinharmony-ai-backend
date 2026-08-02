import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aiLearningFactoryMigrationPlan,
  createAiLearningFactoryPostgresPersistence,
} from "../src/aiLearningFactoryPostgres.js";
import { createAiLearningFactoryStore } from "../src/aiLearningFactoryStore.js";

class FakePostgres {
  constructor() {
    this.learning = new Map();
    this.history = new Map();
    this.telemetry = new Map();
    this.idempotency = new Map();
    this.queries = [];
    this.migrationAudit = [];
  }

  async connect() {
    return {
      query: (sql, values) => this.query(sql, values),
      release() {},
    };
  }

  async query(sql, values = []) {
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ sql: normalized, values });
    if (normalized.startsWith("SELECT state FROM ai_learning_governance.schema_migration_audit")) {
      return { rows: [{ state: this.migrationAudit.at(-1)?.state || "active" }] };
    }
    if (normalized.startsWith("INSERT INTO ai_learning_governance.schema_migration_audit")) {
      this.migrationAudit.push({
        version: values[0],
        state: normalized.includes("'disabled'") ? "disabled" : "active",
        actor: values[2],
      });
      return { rows: [] };
    }
    if (
      ["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)
      || normalized.startsWith("SET LOCAL ROLE ")
      || normalized.startsWith("CREATE ")
      || normalized.startsWith("DO $role$")
      || normalized.startsWith("GRANT ")
      || normalized.includes(".schema_migration_audit")
    ) {
      return { rows: [] };
    }
    if (normalized.startsWith("SELECT current_user::text AS current_user")) {
      return {
        rows: [{
          current_user: "ai_learning_runtime",
          session_user: "governance_service_owner",
          schema_usage: true,
          learning_read_ready: true,
          learning_write_ready: true,
          history_ready: true,
          telemetry_ready: true,
          idempotency_ready: true,
        }],
      };
    }
    if (normalized.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [{}] };

    if (normalized.includes("SELECT request_digest,record_id,result_record FROM ai_learning_governance.idempotency_receipt")) {
      const [tenant, operation, idempotencyDigest] = values;
      const row = this.idempotency.get(`${tenant}:${operation}:${idempotencyDigest}`);
      return { rows: row ? [row] : [] };
    }

    if (normalized.includes("INSERT INTO ai_learning_governance.idempotency_receipt")) {
      const [tenant, operation, idempotencyDigest, requestDigest, id, resultRevision, resultRecord, createdAt] = values;
      const key = `${tenant}:${operation}:${idempotencyDigest}`;
      if (this.idempotency.has(key)) throw new Error("duplicate_idempotency_receipt");
      this.idempotency.set(key, {
        request_digest: requestDigest,
        record_id: id,
        result_revision: resultRevision,
        result_record: JSON.parse(resultRecord),
        created_at: createdAt,
      });
      return { rows: [] };
    }

    if (normalized.includes("INSERT INTO ai_learning_governance.learning_record ") && !normalized.includes("_history")) {
      const [tenant, collection, id, record, recordDigest, timestamp] = values;
      const key = `${tenant}:${collection}:${id}`;
      if (this.learning.has(key)) return { rows: [] };
      this.learning.set(key, {
        tenant_id: tenant,
        collection,
        record_id: id,
        revision: 1,
        record: JSON.parse(record),
        record_digest: recordDigest,
        created_at: timestamp,
        updated_at: timestamp,
      });
      return { rows: [{ revision: 1 }] };
    }

    if (normalized.includes("SELECT revision,record,record_digest FROM ai_learning_governance.learning_record")) {
      const [tenant, collection, id] = values;
      const row = this.learning.get(`${tenant}:${collection}:${id}`);
      return { rows: row ? [{ revision: row.revision, record: row.record, record_digest: row.record_digest }] : [] };
    }

    if (normalized.includes("INSERT INTO ai_learning_governance.learning_record_history")) {
      const [tenant, collection, id, recordRevision, record, recordDigest, archivedAt] = values;
      this.history.set(`${tenant}:${collection}:${id}:${recordRevision}`, {
        record: JSON.parse(record),
        record_digest: recordDigest,
        archived_at: archivedAt,
      });
      return { rows: [] };
    }

    if (normalized.includes("UPDATE ai_learning_governance.learning_record SET revision=")) {
      const [tenant, collection, id, nextRevision, record, recordDigest, timestamp, expected] = values;
      const key = `${tenant}:${collection}:${id}`;
      const row = this.learning.get(key);
      if (!row || row.revision !== expected) return { rows: [] };
      this.learning.set(key, {
        ...row,
        revision: nextRevision,
        record: JSON.parse(record),
        record_digest: recordDigest,
        updated_at: timestamp,
      });
      return { rows: [{ revision: nextRevision }] };
    }

    if (normalized.includes("SELECT record FROM ai_learning_governance.learning_record WHERE tenant_id=$1 AND collection=$2 AND record_id=$3")) {
      const [tenant, collection, id] = values;
      const row = this.learning.get(`${tenant}:${collection}:${id}`);
      return { rows: row ? [{ record: row.record }] : [] };
    }

    if (
      normalized.includes("SELECT record FROM ai_learning_governance.learning_record WHERE tenant_id=$1")
      && normalized.includes("collection=$2")
      && !normalized.includes("record_id=$3")
    ) {
      const [tenant, collection] = values;
      const limit = values.at(-2);
      const offset = values.at(-1);
      const filters = [...normalized.matchAll(/record ->> '([^']+)' = \$(\d+)/g)]
        .map((match) => [match[1], values[Number(match[2]) - 1]]);
      return {
        rows: [...this.learning.values()]
          .filter((row) => row.tenant_id === tenant && row.collection === collection)
          .filter((row) => filters.every(([field, value]) => row.record[field] === value))
          .sort((left, right) =>
            right.updated_at.localeCompare(left.updated_at)
            || left.record_id.localeCompare(right.record_id))
          .slice(offset, offset + limit)
          .map((row) => ({ record: row.record })),
      };
    }

    if (normalized.includes("INSERT INTO ai_learning_governance.runtime_telemetry")) {
      const [tenant, runId, record, recordDigest] = values;
      const key = `${tenant}:${runId}`;
      if (this.telemetry.has(key)) return { rows: [] };
      this.telemetry.set(key, { record: JSON.parse(record), record_digest: recordDigest });
      return { rows: [{ record_digest: recordDigest }] };
    }

    if (normalized.includes("SELECT record,record_digest FROM ai_learning_governance.runtime_telemetry")) {
      const [tenant, runId] = values;
      const row = this.telemetry.get(`${tenant}:${runId}`);
      return { rows: row ? [row] : [] };
    }

    if (normalized.includes("SELECT record FROM ai_learning_governance.runtime_telemetry WHERE tenant_id=$1 AND run_id=$2")) {
      const [tenant, runId] = values;
      const row = this.telemetry.get(`${tenant}:${runId}`);
      return { rows: row ? [{ record: row.record }] : [] };
    }

    if (
      normalized.includes("SELECT record FROM ai_learning_governance.runtime_telemetry WHERE tenant_id=$1")
      && !normalized.includes("run_id=$2")
    ) {
      const [tenant] = values;
      const limit = values.at(-2);
      const offset = values.at(-1);
      const filters = [...normalized.matchAll(/record ->> '([^']+)' = \$(\d+)/g)]
        .map((match) => [match[1], values[Number(match[2]) - 1]]);
      return {
        rows: [...this.telemetry.entries()]
          .filter(([key]) => key.startsWith(`${tenant}:`))
          .filter(([, row]) => filters.every(([field, value]) => row.record[field] === value))
          .sort(([, left], [, right]) =>
            right.record.recorded_at.localeCompare(left.record.recorded_at)
            || left.record.run_id.localeCompare(right.record.run_id))
          .slice(offset, offset + limit)
          .map(([, row]) => ({ record: row.record })),
      };
    }

    throw new Error(`unexpected_query:${normalized}`);
  }
}

function scorecard(revision, proposal = "Keep the release in shadow.") {
  return {
    schema_version: "ai_evaluation_scorecard_v0_16",
    tenant_id: "tenant-a",
    scorecard_id: "scorecard-v016",
    revision,
    proposal,
    created_at: "2026-07-27T10:00:00.000Z",
    updated_at: "2026-07-27T10:00:00.000Z",
  };
}

function telemetry(outcomeStatus = "succeeded") {
  return {
    schema_version: "ai_runtime_telemetry_v0_16",
    tenant_id: "tenant-a",
    run_id: "run-v016",
    outcome_status: outcomeStatus,
    recorded_at: "2026-07-27T10:00:00.000Z",
    raw_content_persisted: false,
  };
}

function scorecardInput(overrides = {}) {
  return {
    scorecard_id: "scorecard-idempotency-v016",
    release_version: "0.16.0",
    dataset_version: "dataset-v1",
    benchmark_manifest_digest: `sha256:${"c".repeat(64)}`,
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
    proposal: "Keep the candidate in shadow.",
    ...overrides,
  };
}

test("migration is additive, rollback preserving and creates only a static NOLOGIN role", () => {
  const plan = aiLearningFactoryMigrationPlan();
  const sql = readFileSync(new URL("../migrations/0.16.0-ai-learning-factory.up.sql", import.meta.url), "utf8").toUpperCase();
  const rollbackSql = readFileSync(
    new URL("../migrations/0.16.0-ai-learning-factory.down.sql", import.meta.url),
    "utf8",
  ).toUpperCase();
  assert.equal(plan.additive, true);
  assert.equal(plan.rollback_safe, true);
  assert.equal(plan.preserves_history, true);
  assert.equal(plan.creates_database, false);
  assert.equal(plan.creates_service, false);
  assert.equal(plan.runtime_ddl, false);
  assert.equal(plan.migration_artifact, "migrations/0.16.0-ai-learning-factory.up.sql");
  assert(!sql.includes("CREATE DATABASE"));
  assert(sql.includes("CREATE ROLE NYRA_AI_LEARNING_RUNTIME_V016 NOLOGIN"));
  assert(!sql.includes(" LOGIN"));
  assert(!sql.includes("PASSWORD"));
  assert(sql.includes("LEARNING_RECORD_HISTORY"));
  assert(rollbackSql.includes("REVOKE USAGE ON SCHEMA AI_LEARNING_GOVERNANCE"));
  assert(rollbackSql.includes("REVOKE NYRA_AI_LEARNING_RUNTIME_V016 FROM CURRENT_USER"));
  assert(!rollbackSql.includes("DROP "));
});

test("runtime writes fail closed until a pre-existing dedicated role is attested", async () => {
  const database = new FakePostgres();
  const persistence = createAiLearningFactoryPostgresPersistence({
    pool: database,
  });
  assert.equal(persistence.runtime_role_attested, false);
  assert.equal(persistence.runtime_write_mode, "shadow_unavailable_until_dedicated_role_attested");
  assert.equal(persistence.readiness().persistence_read_ready, false);
  await assert.rejects(
    persistence.learningAdapter.save({
      tenant_id: "tenant-a",
      collection: "evaluation_scorecards",
      record_id: "scorecard-v016",
      expected_revision: 0,
      record: scorecard(1),
    }),
    /ai_learning_runtime_role_attestation_failed/,
  );
});

test("tenant-scoped records survive a store restart and keep CAS rollback history", async () => {
  const database = new FakePostgres();
  const first = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
  });
  await first.learningAdapter.save({
    tenant_id: "tenant-a",
    collection: "evaluation_scorecards",
    record_id: "scorecard-v016",
    expected_revision: 0,
    record: scorecard(1),
  });
  assert.equal(first.runtime_role_attested, true);
  assert.equal(first.readiness().session_user_separated, true);

  const restarted = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
  });
  assert.deepEqual(
    await restarted.learningAdapter.load({
      tenant_id: "tenant-a",
      collection: "evaluation_scorecards",
      record_id: "scorecard-v016",
    }),
    scorecard(1),
  );
  assert.equal(
    await restarted.learningAdapter.load({
      tenant_id: "tenant-b",
      collection: "evaluation_scorecards",
      record_id: "scorecard-v016",
    }),
    null,
  );

  await restarted.learningAdapter.save({
    tenant_id: "tenant-a",
    collection: "evaluation_scorecards",
    record_id: "scorecard-v016",
    expected_revision: 1,
    record: scorecard(2, "Review measured evidence before promotion."),
  });
  assert(database.history.has("tenant-a:evaluation_scorecards:scorecard-v016:1"));
  await assert.rejects(
    restarted.learningAdapter.save({
      tenant_id: "tenant-a",
      collection: "evaluation_scorecards",
      record_id: "scorecard-v016",
      expected_revision: 1,
      record: scorecard(2, "Stale concurrent write."),
    }),
    /learning_factory_revision_conflict/,
  );
  assert(database.queries.some((query) => query.sql === "SET LOCAL ROLE ai_learning_runtime"));
});

test("rollback disables reads and writes in the same persistence instance while preserving records", async () => {
  const database = new FakePostgres();
  const persistence = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
  });
  await persistence.learningAdapter.save({
    tenant_id: "tenant-a",
    collection: "evaluation_scorecards",
    record_id: "scorecard-v016",
    expected_revision: 0,
    record: scorecard(1),
  });

  const rollback = await persistence.rollbackMigration({
    actor_provenance: "core:rollback-test",
    rollback_reference: "git:pre-v0.16",
  });
  assert.equal(rollback.data_dropped, false);
  assert.equal(rollback.history_preserved, true);
  assert.equal(database.learning.size, 1);
  assert(database.migrationAudit.some((entry) => entry.state === "disabled"));
  assert.deepEqual(persistence.readiness(), {
    initialized: false,
    persistence_read_ready: false,
    persistence_write_ready: false,
    runtime_role_attested: false,
    runtime_role_configured: true,
    runtime_role_probe_attempted: true,
    session_user_separated: false,
    reason: "static_migration_disabled_by_rollback",
  });
  const roleProbeCount = database.queries.filter(({ sql }) =>
    sql.startsWith("SET LOCAL ROLE ")).length;
  await assert.rejects(
    persistence.learningAdapter.load({
      tenant_id: "tenant-a",
      collection: "evaluation_scorecards",
      record_id: "scorecard-v016",
    }),
    /ai_learning_static_migration_not_active/,
  );
  await assert.rejects(
    persistence.learningAdapter.save({
      tenant_id: "tenant-a",
      collection: "evaluation_scorecards",
      record_id: "scorecard-after-rollback",
      expected_revision: 0,
      record: scorecard(1),
    }),
    /ai_learning_static_migration_not_active/,
  );
  assert.equal(
    database.queries.filter(({ sql }) => sql.startsWith("SET LOCAL ROLE ")).length,
    roleProbeCount,
    "same-instance operations must stop before re-attesting the revoked runtime role",
  );
});

test("telemetry is immutable, idempotent and tenant-bound across restarts", async () => {
  const database = new FakePostgres();
  const first = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
  });
  await first.telemetryAdapter.save({
    tenant_id: "tenant-a",
    run_id: "run-v016",
    record: telemetry(),
  });
  await first.telemetryAdapter.save({
    tenant_id: "tenant-a",
    run_id: "run-v016",
    record: telemetry(),
  });
  await assert.rejects(
    first.telemetryAdapter.save({
      tenant_id: "tenant-a",
      run_id: "run-v016",
      record: telemetry("failed"),
    }),
    /telemetry_run_conflict/,
  );

  const restarted = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
  });
  assert.deepEqual(
    await restarted.telemetryAdapter.load({ tenant_id: "tenant-a", run_id: "run-v016" }),
    telemetry(),
  );
  assert.equal(
    await restarted.telemetryAdapter.load({ tenant_id: "tenant-b", run_id: "run-v016" }),
    null,
  );
});

test("durable idempotency survives a store restart and rejects a mismatched replay", async () => {
  const database = new FakePostgres();
  const firstPersistence = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
    now: () => new Date("2026-07-27T10:00:00.000Z"),
  });
  const firstStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true,
    adapter: firstPersistence.learningAdapter,
    now: () => "2026-07-27T10:00:00.000Z",
  });
  const created = await firstStore.recordEvaluationScorecard({
    tenant_id: "tenant-a",
    record: scorecardInput(),
    idempotency_key: "same-idempotency-key",
    expected_revision: 0,
  });
  assert.equal(created.revision, 1);

  const restartedPersistence = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
    now: () => new Date("2026-07-27T10:05:00.000Z"),
  });
  const restartedStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true,
    adapter: restartedPersistence.learningAdapter,
    now: () => "2026-07-27T10:05:00.000Z",
  });
  const replayed = await restartedStore.recordEvaluationScorecard({
    tenant_id: "tenant-a",
    record: scorecardInput(),
    idempotency_key: "same-idempotency-key",
    expected_revision: 0,
  });
  assert.deepEqual(replayed, created);
  assert.equal(database.idempotency.size, 1);

  await assert.rejects(
    restartedStore.recordEvaluationScorecard({
      tenant_id: "tenant-a",
      record: scorecardInput({ proposal: "Different replay payload." }),
      idempotency_key: "same-idempotency-key",
      expected_revision: 0,
    }),
    /learning_factory_idempotency_conflict/,
  );
  assert.equal(database.idempotency.size, 1);
});

test("bounded persistent pagination reaches records beyond 500 with filters applied before offset", async () => {
  const database = new FakePostgres();
  const persistence = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
    now: () => new Date("2026-07-27T10:00:00.000Z"),
  });
  const writer = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true,
    adapter: persistence.learningAdapter,
    now: () => "2026-07-27T10:00:00.000Z",
  });
  for (let index = 0; index < 620; index += 1) {
    const suffix = String(index).padStart(4, "0");
    await writer.recordEvaluationScorecard({
      tenant_id: "tenant-a",
      record: scorecardInput({
        scorecard_id: `scorecard-${suffix}`,
        release_version: index < 610 ? "0.16.0" : "other-release",
      }),
      idempotency_key: `scorecard-page-${suffix}`,
      expected_revision: 0,
    });
  }

  const restarted = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true,
    adapter: persistence.learningAdapter,
    now: () => "2026-07-27T10:05:00.000Z",
  });
  const seen = [];
  let offset = 0;
  let pageCount = 0;
  do {
    const page = await restarted.listEvaluationScorecards({
      tenant_id: "tenant-a",
      limit: 100,
      offset,
      filters: { release_version: "0.16.0" },
      page: true,
      visibility_context: {
        tenant_id: "tenant-a",
        client_type: "chatgpt",
        audience: "chatgpt_connector",
        entitlements: [],
      },
    });
    seen.push(...page.records.map((record) => record.scorecard_id));
    pageCount += 1;
    offset = page.next_offset;
  } while (offset !== null);

  assert.equal(pageCount, 7);
  assert.equal(seen.length, 610);
  assert.equal(new Set(seen).size, 610);
  assert(seen.includes("scorecard-0609"));
  assert(!seen.includes("scorecard-0610"));
  const listQueries = database.queries.filter((query) =>
    query.sql.includes("SELECT record FROM ai_learning_governance.learning_record")
    && query.sql.includes("ORDER BY updated_at DESC,record_id ASC"));
  assert(listQueries.length >= 7);
  assert(listQueries.every((query) =>
    query.sql.includes("record ->> 'release_version'")
    && query.sql.includes("LIMIT $")
    && query.sql.includes("OFFSET $")));
});

test("telemetry adapter applies trace filtering and stable offset pagination", async () => {
  const database = new FakePostgres();
  for (let index = 0; index < 620; index += 1) {
    const suffix = String(index).padStart(4, "0");
    database.telemetry.set(`tenant-a:run-${suffix}`, {
      record: {
        ...telemetry(),
        run_id: `run-${suffix}`,
        trace_id: index < 605 ? "trace-shared" : "trace-other",
      },
      record_digest: `sha256:${suffix}`,
    });
  }
  const persistence = createAiLearningFactoryPostgresPersistence({
    pool: database,
    runtimeRole: "ai_learning_runtime",
  });
  const seen = [];
  for (let offset = 0; offset < 605; offset += 100) {
    const rows = await persistence.telemetryAdapter.list({
      tenant_id: "tenant-a",
      limit: 100,
      offset,
      filters: { trace_id: "trace-shared" },
    });
    seen.push(...rows.map((row) => row.run_id));
  }
  assert.equal(seen.length, 605);
  assert.equal(new Set(seen).size, 605);
  assert(!seen.includes("run-0605"));
  const listQueries = database.queries.filter((query) =>
    query.sql.includes("SELECT record FROM ai_learning_governance.runtime_telemetry")
    && query.sql.includes("ORDER BY recorded_at DESC,run_id ASC"));
  assert.equal(listQueries.length, 7);
  assert(listQueries.every((query) =>
    query.sql.includes("record ->> 'trace_id'")
    && query.sql.includes("OFFSET $")));
});
