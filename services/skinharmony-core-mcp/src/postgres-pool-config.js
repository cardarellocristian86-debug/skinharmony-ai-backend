function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

// Keep every fallback pool on the same finite wait policy. Most production
// runtimes receive the shared pool from server.js, while tests and standalone
// adapters may still construct one locally.
export function postgresPoolConfig(config = {}, {
  connectionString,
  ssl = config.databaseSsl,
} = {}) {
  return {
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: boundedInteger(config.databasePoolMax, 5, 1, 20),
    connectionTimeoutMillis: boundedInteger(config.databaseConnectionTimeoutMs, 2_000, 100, 60_000),
    query_timeout: boundedInteger(config.databaseQueryTimeoutMs, 5_000, 500, 120_000),
    statement_timeout: boundedInteger(config.databaseStatementTimeoutMs, 5_000, 500, 120_000),
    lock_timeout: boundedInteger(config.databaseLockTimeoutMs, 2_000, 100, 60_000),
    idle_in_transaction_session_timeout: boundedInteger(
      config.databaseIdleTransactionTimeoutMs,
      15_000,
      1_000,
      300_000,
    ),
  };
}
