import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createEntity360Migrator } from "../src/entity360Migration.js";
import { createPostgresSoftwareCognitionStore } from "../src/softwareCognitionStore.js";

const sql = fs.readFileSync(new URL("../migrations/20260815_software_cognition_v1.sql", import.meta.url), "utf8");

test("software cognition extends Atlas and Native Plan without parallel authorities", () => {
  assert.match(sql, /ALTER TABLE core_continuity_atlas_nodes/);
  assert.match(sql, /ALTER TABLE core_continuity_native_plans/);
  assert.match(sql, /core_continuity_atlas_edges_from_fk/);
  assert.match(sql, /core_continuity_atlas_edges_to_fk/);
  assert.match(sql, /core_continuity_atlas_revision_history/);
  assert.match(sql, /core_continuity_supervisory_challenges/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS core_software_(?:nodes|edges|graph_revisions|artifacts|action_events)/);
});

test("software cognition migration retries, coalesces and uses the bounded migration session", async () => {
  let attempts = 0;
  let releases = 0;
  const migrationQueries = [];
  const pool = {
    async query() { return { rows: [], rowCount: 0 }; },
    async connect() {
      attempts += 1;
      return {
        async query(query) {
          const statement = typeof query === "string" ? query : String(query?.text || "");
          if (statement.startsWith("SELECT current_setting")) {
            return { rows: [{ statement_timeout: "5s", lock_timeout: "2s" }] };
          }
          if (query && typeof query === "object" && statement === sql) {
            migrationQueries.push(query);
            if (attempts === 1) throw new Error("transient_software_migration_timeout");
          }
          return { rows: [], rowCount: 0 };
        },
        release() { releases += 1; },
      };
    },
  };
  const store = createPostgresSoftwareCognitionStore({ pool });
  await assert.rejects(Promise.all([store.initialize(), store.initialize()]),
    /transient_software_migration_timeout/);
  await Promise.all([store.initialize(), store.initialize()]);
  assert.equal(attempts, 2);
  assert.equal(releases, 2);
  assert.equal(migrationQueries.length, 2);
  assert(migrationQueries.every((query) => query.query_timeout === 30_000));
});

test("Entity360 migrator routes startup work through the bounded migration session", async () => {
  const calls = [];
  let released = false;
  const sentinel = new Error("stop_after_budget_probe");
  const client = {
    async query(query) {
      const statement = typeof query === "string" ? query : String(query?.text || "");
      calls.push({ query, statement });
      if (statement.startsWith("SELECT current_setting")) {
        return { rows: [{ statement_timeout: "5s", lock_timeout: "2s" }] };
      }
      if (query && typeof query === "object" && /pg_advisory_lock/.test(statement)) throw sentinel;
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  const migrator = createEntity360Migrator({
    pool: { query: client.query.bind(client), connect: async () => client },
  });
  await assert.rejects(migrator.apply(), (error) => error === sentinel);
  const bounded = calls.find(({ query, statement }) =>
    query && typeof query === "object" && /pg_advisory_lock/.test(statement));
  assert.equal(bounded.query.query_timeout, 30_000);
  assert(calls.some(({ statement }) => statement.includes("set_config('statement_timeout'")));
  assert(calls.some(({ statement }) => statement.includes("set_config('lock_timeout'")));
  assert.equal(released, true);
});
