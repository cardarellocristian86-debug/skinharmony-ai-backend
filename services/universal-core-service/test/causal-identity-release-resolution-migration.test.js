import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

import {
  CAUSAL_IDENTITY_RELEASE_MIGRATION_ID,
  releaseTupleReadIndexMatches,
} from "../src/causalIdentityReleaseResolutionMigration.js";
import { createPostgresCausalContinuityStore } from "../src/causalContinuityStore.js";

test("additive release resolution migration is append-only, tenant-scoped and reversible", async () => {
  const up = await readFile(new URL("../migrations/20260812_001_causal_identity_release_resolution_up.sql", import.meta.url), "utf8");
  const down = await readFile(new URL("../migrations/20260812_001_causal_identity_release_resolution_down.sql", import.meta.url), "utf8");
  assert.match(up, /PRIMARY KEY \(tenant_id, resolution_id\)/);
  assert.match(up, /UNIQUE \(tenant_id, project_id, work_id, change_id, phase, lookup_digest\)/);
  assert.match(up, /core_release_tuple_resolutions_append_only/);
  assert.match(up, /derived_from_intent_revision_id UUID/);
  assert.match(up, /core_projects_derived_from_intent_revision_fk/);
  assert.match(up, /VALIDATE CONSTRAINT core_projects_derived_from_intent_revision_fk/);
  assert.match(up, /FOREIGN KEY \(tenant_id, project_id\)/);
  assert.match(up, /FOREIGN KEY \(tenant_id, work_id\)/);
  assert.match(up, /FOREIGN KEY \(tenant_id, change_id\)/);
  assert.match(down, new RegExp(CAUSAL_IDENTITY_RELEASE_MIGRATION_ID));
  assert.match(down, /DROP TABLE IF EXISTS core_release_tuple_resolutions/);
});

test("release tuple bounded read index requires the exact ordered definition", () => {
  assert.equal(releaseTupleReadIndexMatches({
    definition: "CREATE INDEX core_release_tuple_resolution_read_idx ON public.core_release_tuple_resolutions USING btree (tenant_id, project_id, work_id, change_id, phase, event_sequence DESC)",
  }), true);
  for (const definition of [
    "CREATE INDEX core_release_tuple_resolution_read_idx ON core_release_tuple_resolutions (tenant_id, project_id, work_id, change_id, phase)",
    "CREATE INDEX core_release_tuple_resolution_read_idx ON core_release_tuple_resolutions (tenant_id, work_id, project_id, change_id, phase, event_sequence DESC)",
    "CREATE INDEX core_release_tuple_resolution_read_idx ON core_release_tuple_resolutions (tenant_id, project_id, work_id, change_id, phase, event_sequence DESC) WHERE phase='POST_ACTION'",
  ]) assert.equal(releaseTupleReadIndexMatches({ definition }), false);
});

test("PostgreSQL apply/down/reapply verifies the release authority schema", {
  skip: !process.env.CAUSAL_IDENTITY_RELEASE_DATABASE_URL,
}, async () => {
  const admin = new pg.Pool({ connectionString: process.env.CAUSAL_IDENTITY_RELEASE_DATABASE_URL, max: 1 });
  const schema = `causal_release_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({
    connectionString: process.env.CAUSAL_IDENTITY_RELEASE_DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 3,
  });
  const store = createPostgresCausalContinuityStore({ pool });
  try {
    const first = await store.initialize();
    assert.equal(first.identity_release_resolution.readback.table_present, true);
    assert.equal(first.identity_release_resolution.readback.append_only_guard, true);
    assert.equal(first.identity_release_resolution.readback.composite_foreign_keys, true);
    assert.equal(first.identity_release_resolution.readback.read_index.matches_expected, true);
    assert.equal((await store.migrationRollback()).rolled_back, true);
    const second = await store.initialize();
    assert.equal(second.identity_release_resolution.applied, true);
    assert.equal((await store.health()).ok, true);
  } finally {
    await store.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
