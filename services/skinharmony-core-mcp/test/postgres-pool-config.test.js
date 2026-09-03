import assert from "node:assert/strict";
import test from "node:test";
import { postgresPoolConfig } from "../src/postgres-pool-config.js";

test("PostgreSQL pools always receive finite connection, query and lock deadlines", () => {
  const options = postgresPoolConfig({
    databasePoolMax: 7,
    databaseConnectionTimeoutMs: 2_000,
    databaseQueryTimeoutMs: 9_000,
    databaseStatementTimeoutMs: 8_000,
    databaseLockTimeoutMs: 1_500,
    databaseIdleTransactionTimeoutMs: 12_000,
    databaseSsl: true,
  }, { connectionString: "postgres://example.test/db" });

  assert.deepEqual(options, {
    connectionString: "postgres://example.test/db",
    ssl: { rejectUnauthorized: false },
    max: 7,
    connectionTimeoutMillis: 2_000,
    query_timeout: 9_000,
    statement_timeout: 8_000,
    lock_timeout: 1_500,
    idle_in_transaction_session_timeout: 12_000,
  });
});

test("PostgreSQL pool deadline defaults remain bounded when config is absent", () => {
  const options = postgresPoolConfig({}, { connectionString: "postgres://example.test/db" });
  assert.equal(options.max, 5);
  assert.equal(options.connectionTimeoutMillis, 2_000);
  assert.equal(options.query_timeout, 5_000);
  assert.equal(options.statement_timeout, 5_000);
  assert.equal(options.lock_timeout, 2_000);
  assert.equal(options.idle_in_transaction_session_timeout, 15_000);
});
