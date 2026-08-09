import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ADDITIVE_SCHEMA_SQL } from "../src/work-continuity-v2-store.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(directory, "../migrations/20260808_work_continuity_v2.sql"), "utf8");

test("Work Continuity V2 migration is additive, idempotent, and registry compatible", () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /COMMIT;\s*$/m);
  for (const table of [
    "tenant_work", "tenant_work_task", "tenant_work_evidence", "tenant_work_closure_receipt",
    "tenant_work_final_report", "tenant_work_code_sequence", "tenant_work_core_join", "tenant_work_open_review",
    "tenant_work_event", "core_schema_migrations",
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_work_id/);
  assert.match(migration, /ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS acceptance_criteria/);
  assert.match(migration, /ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS archived_at/);
  assert.match(migration, /ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS subject_user_id/);
  assert.match(migration, /INSERT INTO core_schema_migrations \(migration_id\)[\s\S]*20260808_work_continuity_v2_runtime[\s\S]*ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE|UPDATE\s+core_continuity_works)\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE core_continuity_works/i);
});

test("startup DDL and executable migration contain the same acceptance, archive and review contract", () => {
  for (const fragment of [
    "acceptance_criteria", "archived_at", "tenant_work_open_review", "subject_user_id",
    "request_id", "review_result", "decision_digest", "consumed_work_id", "tenant_work_event",
  ]) {
    assert.match(ADDITIVE_SCHEMA_SQL, new RegExp(fragment));
    assert.match(migration, new RegExp(fragment));
  }
});
