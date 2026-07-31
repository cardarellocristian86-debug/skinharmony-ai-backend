import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createWorkContinuityRuntime } from "../../skinharmony-core-mcp/src/work-continuity-runtime.js";

const runtimeSourceUrl = new URL(
  "../../skinharmony-core-mcp/src/work-continuity-runtime.js",
  import.meta.url,
);

test("continuity fails closed instead of creating a deploy-filesystem runtime without PostgreSQL", () => {
  const runtime = createWorkContinuityRuntime({});

  assert.equal(runtime, null);
});

test("an explicitly supplied database pool is the only injectable continuity backend", async () => {
  const queries = [];
  let ended = false;
  const pool = {
    async query(sql) {
      queries.push(String(sql));
      return { rows: [], rowCount: 0 };
    },
    async end() {
      ended = true;
    },
  };
  const runtime = createWorkContinuityRuntime({}, { pool });

  await runtime.initialize();
  await runtime.close();

  assert.equal(typeof runtime.ensure, "function");
  assert.equal(typeof runtime.selectAtlas, "function");
  assert.equal(runtime.schemaSql.includes("core_continuity_events_append_only"), true);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS core_continuity_works/);
  assert.equal(ended, true);
});

test("the canonical continuity runtime has no filesystem state-store import or JSON fallback", async () => {
  const source = await readFile(runtimeSourceUrl, "utf8");

  assert.doesNotMatch(source, /from\s+["']node:fs(?:\/promises)?["']/);
  assert.doesNotMatch(source, /createFile(?:Work)?Continuity|work[-_]continuity[^"'\n]*\.json/i);
  assert.match(source, /import\s+\{\s*Pool\s*\}\s+from\s+["']pg["']/);
  assert.match(source, /if \(!config\.databaseUrl && !options\.pool\) return null/);
  assert.match(source, /SELECT pg_advisory_xact_lock/);
});
