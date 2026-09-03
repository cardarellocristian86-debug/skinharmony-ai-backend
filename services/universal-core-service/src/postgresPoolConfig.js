import { Pool } from "pg";

const TIMEOUT_SPECS = Object.freeze({
  DATABASE_CONNECTION_TIMEOUT_MS: Object.freeze({
    option: "connectionTimeoutMillis",
    fallback: 2_000,
    minimum: 100,
    maximum: 60_000,
  }),
  DATABASE_QUERY_TIMEOUT_MS: Object.freeze({
    option: "query_timeout",
    fallback: 5_000,
    minimum: 500,
    maximum: 120_000,
  }),
  DATABASE_STATEMENT_TIMEOUT_MS: Object.freeze({
    option: "statement_timeout",
    fallback: 5_000,
    minimum: 500,
    maximum: 120_000,
  }),
  DATABASE_LOCK_TIMEOUT_MS: Object.freeze({
    option: "lock_timeout",
    fallback: 2_000,
    minimum: 100,
    maximum: 60_000,
  }),
  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: Object.freeze({
    option: "idle_in_transaction_session_timeout",
    fallback: 15_000,
    minimum: 1_000,
    maximum: 300_000,
  }),
});

function boundedEnvironmentInteger(value, { fallback, minimum, maximum }) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

export const POSTGRES_POOL_TIMEOUT_DEFAULTS = Object.freeze(
  Object.fromEntries(
    Object.values(TIMEOUT_SPECS).map(({ option, fallback }) => [option, fallback]),
  ),
);

export function postgresPoolTimeoutOptions(env = process.env) {
  return Object.fromEntries(
    Object.entries(TIMEOUT_SPECS).map(([name, spec]) => [
      spec.option,
      boundedEnvironmentInteger(env?.[name], spec),
    ]),
  );
}

export function boundedPostgresPoolOptions(options = {}, { env = process.env } = {}) {
  return {
    ...options,
    ...postgresPoolTimeoutOptions(env),
  };
}

// Production modules construct PostgreSQL pools only through this helper.
// Callers may still inject an existing pool at their factory boundary; that
// path must bypass this function so ownership and test seams remain unchanged.
export function createBoundedPostgresPool(options = {}) {
  return new Pool(boundedPostgresPoolOptions(options));
}
