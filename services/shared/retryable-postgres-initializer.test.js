import assert from "node:assert/strict";
import test from "node:test";

import {
  createRetryablePostgresInitializer,
  initializePostgresWithRetry,
  isRetryablePostgresInitializationError,
  postgresMigrationTimeouts,
  retryableInitializer,
  runPostgresMigrationBlock,
} from "./retryable-postgres-initializer.js";

test("coalesces concurrent initialization and retries after a transient failure", async () => {
  let attempts = 0;
  let releaseFirst;
  const initialize = retryableInitializer(async () => {
    attempts += 1;
    if (attempts === 1) {
      await new Promise((resolve) => { releaseFirst = resolve; });
      throw new Error("transient_lock_timeout");
    }
    return "ready";
  });
  const first = initialize();
  const concurrent = initialize();
  assert.equal(first, concurrent);
  await Promise.resolve();
  releaseFirst();
  await assert.rejects(first, /transient_lock_timeout/);
  assert.equal(await initialize(), "ready");
  assert.equal(attempts, 2);
});

test("uses a separate finite DDL budget and a transaction", async () => {
  const calls = [];
  const client = {
    async query(query) { calls.push(query); return { rowCount: 0, rows: [] }; },
    release() { calls.push("RELEASE"); },
  };
  const pool = {
    async query() { throw new Error("pool_query_must_not_run"); },
    async connect() { return client; },
  };
  const initialize = createRetryablePostgresInitializer({
    pool,
    sql: "CREATE TABLE IF NOT EXISTS example(id integer)",
    env: {
      DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS: "30000",
      DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "5000",
    },
  });
  await initialize();
  assert.deepEqual(calls.slice(0, 3), [
    "BEGIN",
    "SET LOCAL statement_timeout = '30000ms'",
    "SET LOCAL lock_timeout = '5000ms'",
  ]);
  assert.deepEqual(calls[3], {
    text: "CREATE TABLE IF NOT EXISTS example(id integer)",
    query_timeout: 30_000,
  });
  assert.deepEqual(calls.slice(4), ["COMMIT", "RELEASE"]);
});

test("bounds invalid migration timeout configuration", () => {
  assert.deepEqual(postgresMigrationTimeouts({
    DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS: "unbounded",
    DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "0",
  }), { statementTimeoutMs: 30_000, lockTimeoutMs: 500 });
});

test("bounds nontransactional DDL and restores the leased session", async () => {
  const calls = [];
  const client = { async query(query, values) {
    calls.push({ query, values });
    if (typeof query === "string" && query.startsWith("SELECT current_setting")) {
      return { rows: [{ statement_timeout: "5s", lock_timeout: "2s" }] };
    }
    return { rows: [], rowCount: 0 };
  } };
  await runPostgresMigrationBlock(client, "CREATE INDEX CONCURRENTLY example_idx ON example(id)", {
    transactional: false,
    env: {
      DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS: "30000",
      DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "5000",
    },
  });
  assert.deepEqual(calls[1].values, ["30000ms", "5000ms"]);
  assert.deepEqual(calls[2].query, {
    text: "CREATE INDEX CONCURRENTLY example_idx ON example(id)",
    query_timeout: 30_000,
  });
  assert.deepEqual(calls[3].values, ["5s", "2s"]);
});

test("bounded startup orchestration retries transient PostgreSQL errors in-process", async () => {
  let attempts = 0;
  const delays = [];
  const result = await initializePostgresWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("canceling statement due to lock timeout");
      error.code = "55P03";
      throw error;
    }
    return "ready";
  }, {
    delaysMs: [10, 20],
    sleep: async (milliseconds) => { delays.push(milliseconds); },
  });
  assert.equal(result, "ready");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [10]);
  assert.equal(isRetryablePostgresInitializationError({ code: "57014" }), true);
});

test("bounded startup orchestration does not retry permanent schema errors", async () => {
  let attempts = 0;
  await assert.rejects(initializePostgresWithRetry(async () => {
    attempts += 1;
    const error = new Error("schema manifest mismatch");
    error.code = "SCHEMA_MANIFEST_MISMATCH";
    throw error;
  }, { delaysMs: [0, 0] }), /schema manifest mismatch/);
  assert.equal(attempts, 1);
  assert.equal(isRetryablePostgresInitializationError({ code: "SCHEMA_MANIFEST_MISMATCH" }), false);
});
