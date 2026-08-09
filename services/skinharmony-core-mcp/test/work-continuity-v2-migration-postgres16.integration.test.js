import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = String(process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();
const directory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(directory, "../migrations/20260808_work_continuity_v2.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const migrationId = "20260808_work_continuity_v2_runtime";

async function cleanup(pool, tenantId) {
  await pool.query("DELETE FROM tenant_work_closure_receipt WHERE tenant_id=$1", [tenantId]);
  await pool.query("DELETE FROM tenant_work_final_report WHERE tenant_id=$1", [tenantId]);
  await pool.query("DELETE FROM tenant_work_core_join WHERE tenant_id=$1", [tenantId]);
  await pool.query("DELETE FROM tenant_work_task WHERE tenant_id=$1", [tenantId]);
  await pool.query("DELETE FROM tenant_work_evidence WHERE tenant_id=$1", [tenantId]);
  await pool.query("DELETE FROM tenant_work WHERE tenant_id=$1", [tenantId]);
  await pool.query("DELETE FROM tenant_work_code_sequence WHERE tenant_id=$1", [tenantId]);
}

test("PostgreSQL 16 applies Work Continuity V2 migration idempotently without legacy mutation", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required for PostgreSQL 16 migration integration",
}, async () => {
  const tenantId = `wc_v2_pg16_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const workId = crypto.randomUUID();
  const pool = new Pool({ connectionString: databaseUrl, max: 2, statement_timeout: 10_000 });

  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16);

    assert.match(migrationSql, /^BEGIN;/m);
    assert.match(migrationSql, /COMMIT;\s*$/m);
    assert.doesNotMatch(migrationSql, /\b(DROP|TRUNCATE|DELETE|UPDATE\s+core_continuity_works)\b/i);
    assert.doesNotMatch(migrationSql, /ALTER TABLE core_continuity_works/i);

    await pool.query(migrationSql);
    await pool.query(migrationSql);

    const registry = await pool.query("SELECT count(*)::integer AS count FROM core_schema_migrations WHERE migration_id=$1", [migrationId]);
    assert.equal(registry.rows[0].count, 1);

    const tables = await pool.query(`SELECT relname FROM pg_class
      WHERE relkind='r' AND relname = ANY($1::text[]) ORDER BY relname`, [[
      "tenant_work", "tenant_work_task", "tenant_work_evidence", "tenant_work_closure_receipt",
      "tenant_work_final_report", "tenant_work_code_sequence", "tenant_work_core_join",
    ]]);
    assert.deepEqual(tables.rows.map((row) => row.relname), [
      "tenant_work", "tenant_work_closure_receipt", "tenant_work_code_sequence", "tenant_work_core_join",
      "tenant_work_evidence", "tenant_work_final_report", "tenant_work_task",
    ]);

    const columns = await pool.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name = ANY($1::text[])
      AND column_name = ANY($2::text[])`, [["tenant_work", "tenant_work_evidence"], [
      "work_code", "progress_bp", "progress_version", "progress_source", "priority", "priority_score",
      "legacy_work_id", "acceptance_criteria", "created_by_session_fingerprint",
      "verified_by_agent_id", "verified_by_session_fingerprint",
    ]]);
    const columnSet = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const column of [
      "tenant_work.work_code", "tenant_work.progress_bp", "tenant_work.progress_version", "tenant_work.progress_source",
      "tenant_work.priority", "tenant_work.priority_score", "tenant_work.legacy_work_id",
      "tenant_work.acceptance_criteria", "tenant_work.created_by_session_fingerprint",
      "tenant_work_evidence.verified_by_agent_id", "tenant_work_evidence.verified_by_session_fingerprint",
    ]) assert.equal(columnSet.has(column), true, `missing ${column}`);

    const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='tenant_work'");
    const indexSet = new Set(indexes.rows.map((row) => row.indexname));
    assert.equal(indexSet.has("tenant_work_operational_idx"), true);
    assert.equal(indexSet.has("tenant_work_project_idx"), true);
    assert.equal(indexSet.has("tenant_work_legacy_identity_idx"), true);

    const constraints = await pool.query(`SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE t.relname='tenant_work' AND c.contype='c'`);
    const constraintText = constraints.rows.map((row) => row.definition).join("\n");
    assert.match(constraintText, /progress_bp.*10000/i);
    assert.match(constraintText, /COMPLETED/);
    assert.match(constraintText, /ARCHIVED/);
    assert.match(constraintText, /P0/);

    await pool.query(`INSERT INTO tenant_work
      (tenant_id,work_id,work_code,work_name,work_type,status,progress_bp,priority,acceptance_criteria)
      VALUES ($1,$2,$3,'migration integration','generic','ACTIVE',0,'P2','[]'::jsonb)`,
    [tenantId, workId, `TEST-20260808-${workId.slice(0, 4)}`]);
    await assert.rejects(pool.query(`UPDATE tenant_work SET progress_bp=10001
      WHERE tenant_id=$1 AND work_id=$2`, [tenantId, workId]), /check constraint|23514/i);
    const work = await pool.query("SELECT status,closed_at,final_evidence_digest FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [tenantId, workId]);
    assert.deepEqual(work.rows[0], { status: "ACTIVE", closed_at: null, final_evidence_digest: null });
  } finally {
    await cleanup(pool, tenantId).catch(() => {});
    await pool.end();
  }
});
