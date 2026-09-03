import { readFile } from "node:fs/promises";
import { createBoundedPostgresPool } from "./postgresPoolConfig.js";
import { causalDigest, CausalContinuityError } from "./causalContinuityCanonical.js";
import {
  acquireBoundedMigrationLock,
  ensureCoreSchemaMigrationRegistry,
} from "./coreSchemaMigrationRegistry.js";
import { withPostgresMigrationSession } from "../../shared/retryable-postgres-initializer.js";

export const PROJECT_SCOPE_RENDER_INDEX_MIGRATION_ID =
  "20260810_002_project_scope_render_origin_indexes_v1";
const LOCK = "skinharmony:universal-core:project-scope-render-origin-indexes:v1";
const UP_URL = new URL("../migrations/20260810_002_project_scope_render_origin_indexes_up.sql", import.meta.url);
const DOWN_URL = new URL("../migrations/20260810_002_project_scope_render_origin_indexes_down.sql", import.meta.url);

const EXPECTED = Object.freeze({
  core_project_scope_render_lookup_idx: {
    table: "core_project_scope_resources",
    keys: "(tenant_id, resource_type, canonical_identifier, environment, project_id, resource_id)",
    predicate: "activeistrue",
  },
  core_reality_observation_project_lookup_idx: {
    table: "core_reality_observations",
    keys: "(tenant_id, project_id, observation_id)",
    predicate: null,
  },
});

export function projectScopeRenderIndexDefinitionMatches(name, row) {
  const expected = EXPECTED[name];
  if (!expected) return false;
  const definition = String(row?.definition || "").replace(/\s+/g, " ").toLowerCase();
  const predicate = String(row?.predicate || "").replace(/[()\s]+/g, "").toLowerCase();
  return definition.includes(`create index ${name}`) &&
    definition.includes(expected.table) && definition.includes("using btree") &&
    definition.includes(expected.keys) &&
    (expected.predicate === null ? !definition.includes(" where ") : predicate === expected.predicate);
}

async function indexReadback(client) {
  const result = await client.query(`
    SELECT idx.relname AS name,i.indisvalid AS valid,
           pg_get_indexdef(i.indexrelid) AS definition,
           pg_get_expr(i.indpred,i.indrelid) AS predicate,
           EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid) AS constraint_owned,
           EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid=i.indexrelid
                    AND d.deptype NOT IN ('i','a')) AS external_dependency
      FROM pg_class idx
      JOIN pg_index i ON i.indexrelid=idx.oid
     WHERE idx.relnamespace=current_schema()::regnamespace
       AND idx.relname = ANY($1::text[])
     ORDER BY idx.relname`, [Object.keys(EXPECTED)]);
  const indexes = Object.fromEntries(result.rows.map((row) => [row.name, {
    ...row,
    matches_expected: projectScopeRenderIndexDefinitionMatches(row.name, row),
  }]));
  for (const name of Object.keys(EXPECTED)) {
    if (!indexes[name]?.valid || !indexes[name]?.matches_expected) {
      throw new CausalContinuityError("CAUSAL_MIGRATION_READBACK_FAILED", `Exact index unavailable: ${name}`);
    }
  }
  return indexes;
}

export async function recoverInterruptedProjectScopeRenderIndexes(client, { migrationQuery = null } = {}) {
  const result = await client.query(`
    SELECT idx.relname AS name,i.indisvalid AS valid,
           pg_get_indexdef(i.indexrelid) AS definition,
           pg_get_expr(i.indpred,i.indrelid) AS predicate,
           EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid) AS constraint_owned,
           EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid=i.indexrelid
                    AND d.deptype NOT IN ('i','a')) AS external_dependency
      FROM pg_class idx
      JOIN pg_index i ON i.indexrelid=idx.oid
     WHERE idx.relnamespace=current_schema()::regnamespace
       AND idx.relname = ANY($1::text[])
     ORDER BY idx.relname`, [Object.keys(EXPECTED)]);
  const existing = new Map(result.rows.map((row) => [row.name, row]));
  const actions = {};
  for (const name of Object.keys(EXPECTED)) {
    const row = existing.get(name);
    if (!row) {
      actions[name] = "CREATE";
      continue;
    }
    if (!projectScopeRenderIndexDefinitionMatches(name, row)) {
      throw new CausalContinuityError("CAUSAL_MIGRATION_INDEX_CONFLICT", `Migration-owned index differs: ${name}`);
    }
    if (row.valid === true) {
      actions[name] = "REUSE_VALID";
      continue;
    }
    if (row.constraint_owned === true || row.external_dependency === true) {
      throw new CausalContinuityError("CAUSAL_MIGRATION_INDEX_OWNERSHIP_UNCERTAIN", `Invalid index has dependencies: ${name}`);
    }
    await (migrationQuery || client.query.bind(client))(`DROP INDEX CONCURRENTLY ${name}`);
    actions[name] = "DROP_INVALID_EXACT";
  }
  return actions;
}

async function assertRollbackOwnership(client) {
  const result = await client.query(`
    SELECT idx.relname AS name,i.indisvalid AS valid,
           pg_get_indexdef(i.indexrelid) AS definition,
           pg_get_expr(i.indpred,i.indrelid) AS predicate
      FROM pg_class idx JOIN pg_index i ON i.indexrelid=idx.oid
     WHERE idx.relnamespace=current_schema()::regnamespace
       AND idx.relname = ANY($1::text[])`, [Object.keys(EXPECTED)]);
  for (const row of result.rows) {
    if (!projectScopeRenderIndexDefinitionMatches(row.name, row)) {
      throw new CausalContinuityError("CAUSAL_MIGRATION_INDEX_CONFLICT", `Rollback index ownership differs: ${row.name}`);
    }
  }
}

async function runSql(client, sql, { migrationQuery = null } = {}) {
  const query = migrationQuery || client.query.bind(client);
  for (const statement of String(sql).split(";").map((part) => part.trim()).filter(Boolean)) {
    if (statement.startsWith("--")) {
      const executable = statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim();
      if (executable) await query(executable);
    } else {
      await query(statement);
    }
  }
}

export function createProjectScopeRenderOriginIndexMigrator({ pool, connectionString } = {}) {
  if (!pool && !connectionString) throw new CausalContinuityError("CAUSAL_DATABASE_REQUIRED");
  const ownsPool = !pool;
  const db = pool || createBoundedPostgresPool({ connectionString, max: 2, idleTimeoutMillis: 10_000 });

  async function apply() {
    const sql = await readFile(UP_URL, "utf8");
    const sqlDigest = causalDigest({ migration_id: PROJECT_SCOPE_RENDER_INDEX_MIGRATION_ID, sql });
    const client = await db.connect();
    let locked = false;
    try {
      await acquireBoundedMigrationLock(client, LOCK);
      locked = true;
      await ensureCoreSchemaMigrationRegistry(client);
      const existing = (await client.query(
        "SELECT * FROM core_schema_migrations WHERE migration_id=$1",
        [PROJECT_SCOPE_RENDER_INDEX_MIGRATION_ID],
      )).rows[0];
      if (existing && existing.sql_digest !== sqlDigest) {
        throw new CausalContinuityError("CAUSAL_MIGRATION_DIGEST_MISMATCH");
      }
      if (existing?.application_state === "COMPLETED") {
        return { applied: false, sql_digest: sqlDigest, indexes: await indexReadback(client) };
      }
      await client.query(
        `INSERT INTO core_schema_migrations (migration_id,sql_digest,application_state,checkpoint)
         VALUES ($1,$2,'APPLYING','LOCKED')
         ON CONFLICT (migration_id) DO UPDATE SET application_state='APPLYING',checkpoint='LOCKED'`,
        [PROJECT_SCOPE_RENDER_INDEX_MIGRATION_ID, sqlDigest],
      );
      await withPostgresMigrationSession(client, async ({ query }) => {
        await recoverInterruptedProjectScopeRenderIndexes(client, { migrationQuery: query });
        await runSql(client, sql, { migrationQuery: query });
      });
      const indexes = await indexReadback(client);
      await client.query(
        `UPDATE core_schema_migrations SET application_state='COMPLETED',checkpoint='READBACK_VERIFIED',
          completed_at=clock_timestamp(),verifier_evidence=$2::jsonb WHERE migration_id=$1`,
        [PROJECT_SCOPE_RENDER_INDEX_MIGRATION_ID, JSON.stringify({ indexes: Object.keys(indexes) })],
      );
      return { applied: true, sql_digest: sqlDigest, indexes };
    } finally {
      if (locked) try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK]); } catch {}
      client.release();
    }
  }

  async function rollback() {
    const client = await db.connect();
    let locked = false;
    try {
      await acquireBoundedMigrationLock(client, LOCK);
      locked = true;
      await assertRollbackOwnership(client);
      await withPostgresMigrationSession(client, async ({ query }) =>
        runSql(client, await readFile(DOWN_URL, "utf8"), { migrationQuery: query }));
      await client.query("DELETE FROM core_schema_migrations WHERE migration_id=$1", [PROJECT_SCOPE_RENDER_INDEX_MIGRATION_ID]);
      return { rolled_back: true, migration_id: PROJECT_SCOPE_RENDER_INDEX_MIGRATION_ID };
    } finally {
      if (locked) try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK]); } catch {}
      client.release();
    }
  }

  return { migration_id: PROJECT_SCOPE_RENDER_INDEX_MIGRATION_ID, apply, rollback,
    readback: (client = db) => indexReadback(client),
    async close() { if (ownsPool) await db.end(); } };
}
