import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import {
  createProjectScopeRenderOriginIndexMigrator,
  projectScopeRenderIndexDefinitionMatches,
  recoverInterruptedProjectScopeRenderIndexes,
} from "../src/projectScopeRenderOriginMigration.js";
import { PROJECT_SCOPE_RENDER_ORIGIN_QUERY } from "../src/projectScopeRenderOriginResolver.js";
import { createPostgresCausalContinuityStore } from "../src/causalContinuityStore.js";
import { rollbackCausalContinuityMigrations } from "../src/causalContinuityStore.js";

test("exact resolver indexes reject reordered, partial, or extra definitions", () => {
  assert.equal(projectScopeRenderIndexDefinitionMatches(
    "core_project_scope_render_lookup_idx",
    {
      definition: "CREATE INDEX core_project_scope_render_lookup_idx ON public.core_project_scope_resources USING btree (tenant_id, resource_type, canonical_identifier, environment, project_id, resource_id) WHERE (active IS TRUE)",
      predicate: "active IS TRUE",
    },
  ), true);
  assert.equal(projectScopeRenderIndexDefinitionMatches(
    "core_reality_observation_project_lookup_idx",
    {
      definition: "CREATE INDEX core_reality_observation_project_lookup_idx ON public.core_reality_observations USING btree (tenant_id, project_id, observation_id)",
      predicate: null,
    },
  ), true);
  for (const definition of [
    "CREATE INDEX core_project_scope_render_lookup_idx ON core_project_scope_resources (tenant_id, canonical_identifier, resource_type, environment, project_id, resource_id) WHERE active",
    "CREATE INDEX core_project_scope_render_lookup_idx ON core_project_scope_resources (tenant_id, resource_type, canonical_identifier, environment, project_id) WHERE active",
    "CREATE INDEX core_project_scope_render_lookup_idx ON core_project_scope_resources (tenant_id, resource_type, canonical_identifier, environment, project_id, resource_id)",
  ]) assert.equal(projectScopeRenderIndexDefinitionMatches(
    "core_project_scope_render_lookup_idx",
    { definition, predicate: definition.includes("WHERE") ? "active IS TRUE" : null },
  ), false);
});

test("interrupted exact indexes recover only without dependencies", async () => {
  let rows = [{
    name: "core_project_scope_render_lookup_idx",
    valid: false,
    definition: "CREATE INDEX core_project_scope_render_lookup_idx ON public.core_project_scope_resources USING btree (tenant_id, resource_type, canonical_identifier, environment, project_id, resource_id) WHERE (active IS TRUE)",
    predicate: "active IS TRUE",
    constraint_owned: false,
    external_dependency: false,
  }];
  const dropped = [];
  const client = { async query(sql) {
    if (String(sql).includes("FROM pg_class idx")) return { rows };
    if (String(sql).startsWith("DROP INDEX CONCURRENTLY")) {
      dropped.push(String(sql)); rows = []; return { rows: [] };
    }
    return { rows: [] };
  } };
  const actions = await recoverInterruptedProjectScopeRenderIndexes(client);
  assert.equal(actions.core_project_scope_render_lookup_idx, "DROP_INVALID_EXACT");
  assert.equal(actions.core_reality_observation_project_lookup_idx, "CREATE");
  assert.deepEqual(dropped, ["DROP INDEX CONCURRENTLY core_project_scope_render_lookup_idx"]);

  for (const unsafe of [
    { ...rows[0], name: "core_project_scope_render_lookup_idx", valid: false,
      definition: "CREATE INDEX wrong ON core_project_scope_resources (tenant_id)",
      predicate: null, constraint_owned: false, external_dependency: false },
    { name: "core_reality_observation_project_lookup_idx", valid: false,
      definition: "CREATE INDEX core_reality_observation_project_lookup_idx ON public.core_reality_observations USING btree (tenant_id, project_id, observation_id)",
      predicate: null, constraint_owned: true, external_dependency: false },
  ]) {
    const unsafeClient = { async query() { return { rows: [unsafe] }; } };
    await assert.rejects(
      recoverInterruptedProjectScopeRenderIndexes(unsafeClient),
      (error) => error.code?.startsWith("CAUSAL_MIGRATION_INDEX_"),
    );
  }
});

test("Store rollback blocks a hijacked 002 index before any base down and preserves order", async () => {
  let baseDownCalls = 0;
  let tablesIntact = true;
  const client = {
    async query(sql) {
      const query = String(sql);
      if (query.includes("pg_advisory_lock") || query.includes("pg_advisory_unlock")) return { rows: [] };
      if (query.includes("FROM pg_class idx")) return { rows: [{
        name: "core_project_scope_render_lookup_idx",
        valid: true,
        definition: "CREATE INDEX core_project_scope_render_lookup_idx ON core_project_scope_resources USING btree (tenant_id)",
        predicate: null,
      }] };
      throw new Error(`unexpected_query:${query.slice(0, 40)}`);
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const renderOriginIndexMigrator = createProjectScopeRenderOriginIndexMigrator({ pool });
  const baseMigrator = { async rollback() {
    baseDownCalls += 1;
    tablesIntact = false;
    return { rolled_back: true };
  } };
  await assert.rejects(
    rollbackCausalContinuityMigrations({ baseMigrator, renderOriginIndexMigrator }),
    (error) => error.code === "CAUSAL_MIGRATION_INDEX_CONFLICT",
  );
  assert.equal(baseDownCalls, 0);
  assert.equal(tablesIntact, true);

  const order = [];
  const happy = await rollbackCausalContinuityMigrations({
    renderOriginIndexMigrator: { async rollback() {
      order.push("002"); return { rolled_back: true, migration_id: "002" };
    } },
    baseMigrator: { async rollback() {
      order.push("001"); return { rolled_back: true, migration_id: "001" };
    } },
  });
  assert.deepEqual(order, ["002", "001"]);
  assert.equal(happy.migration_id, "001");
  assert.equal(happy.project_scope_render_origin_indexes.migration_id, "002");
});

test("PostgreSQL 16 apply/down/reapply readback and bounded EXPLAIN use exact indexes", {
  skip: !process.env.PROJECT_SCOPE_RENDER_ORIGIN_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({
    connectionString: process.env.PROJECT_SCOPE_RENDER_ORIGIN_DATABASE_URL,
    max: 2,
  });
  const migrator = createProjectScopeRenderOriginIndexMigrator({ pool });
  try {
    const first = await migrator.apply();
    assert.equal(first.indexes.core_project_scope_render_lookup_idx.matches_expected, true);
    assert.equal(first.indexes.core_reality_observation_project_lookup_idx.matches_expected, true);
    assert.equal((await migrator.rollback()).rolled_back, true);
    const reapplied = await migrator.apply();
    assert.equal(reapplied.applied, true);
    assert.equal(reapplied.indexes.core_project_scope_render_lookup_idx.valid, true);
    assert.equal(reapplied.indexes.core_reality_observation_project_lookup_idx.valid, true);
    const store = createPostgresCausalContinuityStore({ pool });
    await store.initialize();
    const health = await store.health();
    assert.equal(health.ok, true);
    assert.equal(
      health.project_scope_render_origin_indexes.core_project_scope_render_lookup_idx.matches_expected,
      true,
    );
    await store.close();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TEMP TABLE core_project_scope_resources (
        tenant_id text,resource_id uuid,project_id uuid,resource_type text,
        canonical_identifier text,environment text,ownership jsonb,active boolean,
        provenance jsonb,resource_digest text,last_verified_at timestamptz)`);
      await client.query(`CREATE TEMP TABLE core_reality_observations (
        tenant_id text,observation_id uuid,project_id uuid,intent_revision_id uuid,
        work_id uuid,change_id uuid,obligation_id uuid,source text,observer_identity text,
        observer_role text,provenance jsonb,independence text,baseline jsonb,
        freshness_seconds bigint,observed_at timestamptz,evidence_digest text,
        causal_relation text,confidence double precision,contradiction_status text,
        observation_digest text)`);
      await client.query(`CREATE INDEX core_project_scope_render_lookup_idx
        ON core_project_scope_resources
        (tenant_id,resource_type,canonical_identifier,environment,project_id,resource_id)
        WHERE active IS TRUE`);
      await client.query(`CREATE INDEX core_reality_observation_project_lookup_idx
        ON core_reality_observations (tenant_id,project_id,observation_id)`);
      await client.query(`INSERT INTO core_reality_observations
        SELECT 'noise-'||(g%100),md5('o'||g)::uuid,md5('p'||(g%100))::uuid,
          md5('i'||g)::uuid,md5('w'||g)::uuid,md5('c'||g)::uuid,md5('b'||g)::uuid,
          'noise','observer','role','{}'::jsonb,'INDEPENDENT_SYSTEM','{}'::jsonb,60,
          clock_timestamp(),'a','OBSERVED',1,'NONE','b'
        FROM generate_series(1,100000) AS g`);
      await client.query(`INSERT INTO core_project_scope_resources
        SELECT 'noise-'||(g%100),md5('r'||g)::uuid,md5('p'||(g%100))::uuid,
          CASE WHEN g%2=0 THEN 'github_repository' ELSE 'render_service_origin' END,
          'noise-'||g,CASE WHEN g%2=0 THEN 'shared' ELSE 'production' END,
          '{}'::jsonb,true,jsonb_build_object('observation_id',md5('o'||g)::uuid::text),
          repeat('a',64),clock_timestamp()
        FROM generate_series(1,20000) AS g`);
      const project = "10000000-0000-4000-8000-000000000001";
      const serviceObservation = "40000000-0000-4000-8000-000000000001";
      const repositoryObservation = "50000000-0000-4000-8000-000000000001";
      await client.query(`INSERT INTO core_reality_observations
        (tenant_id,observation_id,project_id,intent_revision_id,work_id,change_id,obligation_id,
         source,observer_identity,observer_role,provenance,independence,baseline,freshness_seconds,
         observed_at,evidence_digest,causal_relation,confidence,contradiction_status,observation_digest)
        VALUES ('codexai',$1,$3,md5('i')::uuid,md5('w')::uuid,md5('c')::uuid,md5('b1')::uuid,
          'render','o','r','{}','INDEPENDENT_SYSTEM','{}',60,clock_timestamp(),'a','r',1,'NONE','b'),
          ('codexai',$2,$3,md5('i')::uuid,md5('w')::uuid,md5('c')::uuid,md5('b2')::uuid,
          'github','o','r','{}','INDEPENDENT_SYSTEM','{}',60,clock_timestamp(),'a','r',1,'NONE','b')`,
      [serviceObservation, repositoryObservation, project]);
      await client.query(`INSERT INTO core_project_scope_resources VALUES
        ('codexai',md5('service')::uuid,$1,'render_service_origin','srv-core','production','{}',true,
         jsonb_build_object('observation_id',$2::text),repeat('a',64),clock_timestamp()),
        ('codexai',md5('repo')::uuid,$1,'github_repository','owner/repo','shared','{}',true,
         jsonb_build_object('observation_id',$3::text),repeat('a',64),clock_timestamp())`,
      [project, serviceObservation, repositoryObservation]);
      await client.query("ANALYZE core_project_scope_resources");
      await client.query("ANALYZE core_reality_observations");
      const plan = (await client.query(
        `EXPLAIN (COSTS OFF) ${PROJECT_SCOPE_RENDER_ORIGIN_QUERY}`,
        ["codexai", "owner/repo", "srv-core", "production"],
      )).rows.map((row) => row["QUERY PLAN"]).join("\n");
      assert.match(plan, /core_project_scope_render_lookup_idx/);
      assert.match(plan, /core_reality_observation_project_lookup_idx/);
      const indexConditions = plan.split("\n").filter((line) => line.includes("Index Cond:"));
      assert(indexConditions.some((line) =>
        ["tenant_id", "resource_type", "canonical_identifier", "environment"]
          .every((field) => line.includes(field))));
      assert(indexConditions.some((line) =>
        ["tenant_id", "project_id", "observation_id"]
          .every((field) => line.includes(field))), plan);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  } finally {
    await migrator.close();
    await pool.end();
  }
});
