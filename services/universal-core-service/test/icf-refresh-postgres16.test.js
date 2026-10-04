import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createIcfPostgresStore } from "../src/icfPostgresStore.js";

const databaseUrl = String(process.env.ENTITY360_DATABASE_URL || "").trim();
const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

async function seedCanonicalFixture(pool) {
  const tenantId = "icf_refresh_tenant";
  const workId = crypto.randomUUID();
  const causalWorkId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const genesisId = crypto.randomUUID();
  const intentId = crypto.randomUUID();
  await pool.query(`CREATE TABLE tenant_work (tenant_id text,work_id uuid,legacy_work_id uuid);
    CREATE TABLE core_continuity_works (tenant_id text,work_id uuid,project_uuid uuid);
    CREATE TABLE core_work_causal_bindings (tenant_id text,work_id uuid,project_id uuid,genesis_intent_id uuid,intent_revision_id uuid);
    CREATE TABLE core_genesis_intents (tenant_id text,genesis_intent_id uuid,project_id uuid,canonical_digest text);
    CREATE TABLE core_intent_revisions (tenant_id text,intent_revision_id uuid,project_id uuid,genesis_intent_id uuid,state text,canonical_digest text);`);
  await pool.query("INSERT INTO tenant_work VALUES($1,$2,$3)", [tenantId, workId, causalWorkId]);
  await pool.query("INSERT INTO core_continuity_works VALUES($1,$2,$3)", [tenantId, causalWorkId, projectId]);
  await pool.query("INSERT INTO core_work_causal_bindings VALUES($1,$2,$3,$4,$5)", [tenantId, causalWorkId, projectId, genesisId, intentId]);
  await pool.query("INSERT INTO core_genesis_intents VALUES($1,$2,$3,$4)", [tenantId, genesisId, projectId, "a".repeat(64)]);
  await pool.query("INSERT INTO core_intent_revisions VALUES($1,$2,$3,$4,'APPROVED',$5)", [tenantId, intentId, projectId, genesisId, "b".repeat(64)]);
  return { tenantId, workId, causalWorkId, intentId };
}

test("PostgreSQL 16 ICF refresh is append-only, replay-safe, and rejects drift", {
  skip: databaseUrl ? false : "ENTITY360_DATABASE_URL required",
}, async () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `icf_refresh_${crypto.randomUUID().replaceAll("-", "")}`;
  let pool;
  try {
    assert.match((await admin.query("SHOW server_version")).rows[0].server_version, /^16\./u);
    await admin.query(`CREATE SCHEMA ${identifier(schema)}`);
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema}` });
    const fixture = await seedCanonicalFixture(pool);
    const store = createIcfPostgresStore({ pool });
    await store.initialize();

    const seed = await store.ensureInitialWorkGovernanceSeed(fixture);
    assert.equal(seed.state, "seeded");
    await pool.query("UPDATE core_icf_event SET created_at=now()-interval '30 days' WHERE tenant_id=$1 AND work_id=$2 AND seq=1", [fixture.tenantId, fixture.causalWorkId]);

    const [first, concurrent] = await Promise.all([
      store.refreshWorkGovernanceBinding({ ...fixture, idempotencyKey: "refresh-key-one" }),
      store.refreshWorkGovernanceBinding({ ...fixture, idempotencyKey: "refresh-key-one" }),
    ]);
    assert.deepEqual(new Set([first.state, concurrent.state]), new Set(["reobserved", "replayed"]));
    assert.equal(first.icf_version, 2);
    assert.equal(concurrent.icf_version, 2);
    const returnedCut = first.state === "reobserved" ? first.consistent_cut_at : concurrent.consistent_cut_at;
    const visibleAtCut = await pool.query(`SELECT count(*)::int AS count FROM core_icf_event
      WHERE tenant_id=$1 AND work_id=$2 AND created_at <= $3::timestamptz`,
    [fixture.tenantId, fixture.causalWorkId, returnedCut]);
    assert.equal(visibleAtCut.rows[0].count, 2,
      "the database-owned post-write cut includes the reobserved ICF head");
    const futureAtCut = await pool.query(`SELECT count(*)::int AS count FROM core_icf_event
      WHERE tenant_id=$1 AND work_id=$2 AND created_at > $3::timestamptz`,
    [fixture.tenantId, fixture.causalWorkId, returnedCut]);
    assert.equal(futureAtCut.rows[0].count, 0, "no committed ICF event is hidden beyond its returned cut");

    const second = await store.refreshWorkGovernanceBinding({ ...fixture, idempotencyKey: "refresh-key-two" });
    assert.equal(second.state, "reobserved");
    assert.equal(second.icf_version, 3);
    const historicalReplay = await store.refreshWorkGovernanceBinding({ ...fixture, idempotencyKey: "refresh-key-one" });
    assert.equal(historicalReplay.state, "replayed");
    assert.equal(historicalReplay.icf_version, 2);
    const ledger = await pool.query("SELECT seq,event_type FROM core_icf_event WHERE tenant_id=$1 AND work_id=$2 ORDER BY seq", [fixture.tenantId, fixture.causalWorkId]);
    assert.deepEqual(ledger.rows.map((row) => [Number(row.seq), row.event_type]), [
      [1, "WORK_INITIAL_GOVERNANCE_SEEDED"],
      [2, "WORK_GOVERNANCE_BINDING_REOBSERVED"],
      [3, "WORK_GOVERNANCE_BINDING_REOBSERVED"],
    ]);

    await assert.rejects(store.refreshWorkGovernanceBinding({ ...fixture, tenantId: `${fixture.tenantId}x`, idempotencyKey: "cross-tenant" }), /icf_initial_seed_canonical_binding_missing/);
    const crossWorkId = crypto.randomUUID();
    await pool.query("INSERT INTO tenant_work VALUES($1,$2,$3)", [fixture.tenantId, crossWorkId, fixture.causalWorkId]);
    await assert.rejects(store.refreshWorkGovernanceBinding({ tenantId: fixture.tenantId, workId: crossWorkId, idempotencyKey: "cross-work" }), /icf_initial_seed_binding_mismatch/);

    await pool.query("UPDATE core_intent_revisions SET canonical_digest=$3 WHERE tenant_id=$1 AND intent_revision_id=$2", [fixture.tenantId, fixture.intentId, "c".repeat(64)]);
    await assert.rejects(store.refreshWorkGovernanceBinding({ ...fixture, idempotencyKey: "intent-drift" }), /icf_initial_seed_binding_mismatch/);
    await pool.query("UPDATE core_intent_revisions SET canonical_digest=$3 WHERE tenant_id=$1 AND intent_revision_id=$2", [fixture.tenantId, fixture.intentId, "b".repeat(64)]);
    await pool.query("UPDATE core_icf_event SET payload='{}'::jsonb WHERE tenant_id=$1 AND work_id=$2 AND seq=2", [fixture.tenantId, fixture.causalWorkId]);
    await assert.rejects(store.refreshWorkGovernanceBinding({ ...fixture, idempotencyKey: "middle-tamper" }), /icf_binding_refresh_ledger_invalid/);
    await pool.query("UPDATE core_icf_work SET ledger_head_digest=$3 WHERE tenant_id=$1 AND work_id=$2", [fixture.tenantId, fixture.causalWorkId, "f".repeat(64)]);
    await assert.rejects(store.refreshWorkGovernanceBinding({ ...fixture, idempotencyKey: "head-tamper" }), /icf_initial_seed_head_mismatch/);
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`);
    await admin.end();
  }
});

test("PostgreSQL millisecond cut is an upper bound for a microsecond ICF head", {
  skip: databaseUrl ? false : "ENTITY360_DATABASE_URL required",
}, async (t) => {
  const schema = `icf_cut_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${identifier(schema)}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${identifier(schema)} CASCADE`); await admin.end(); });
  await pool.query("CREATE TABLE core_icf_event (created_at timestamptz NOT NULL)");
  await pool.query("INSERT INTO core_icf_event(created_at) VALUES ('2026-10-04T00:00:00.123900Z'), ('2026-10-04T00:00:00.125000Z')");
  const cut = (await pool.query("SELECT date_trunc('milliseconds', '2026-10-04T00:00:00.123950Z'::timestamptz) + interval '1 millisecond' AS cut")).rows[0].cut;
  assert.equal(cut.toISOString(), "2026-10-04T00:00:00.124Z");
  const visible = await pool.query("SELECT count(*)::int count FROM core_icf_event WHERE created_at <= $1::timestamptz", [cut]);
  const future = await pool.query("SELECT count(*)::int count FROM core_icf_event WHERE created_at > $1::timestamptz", [cut]);
  assert.equal(visible.rows[0].count, 1); assert.equal(future.rows[0].count, 1);
});
