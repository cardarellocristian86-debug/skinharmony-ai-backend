import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

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
