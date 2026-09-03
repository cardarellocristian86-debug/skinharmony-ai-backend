const DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_INITIALIZATION_RETRY_DELAYS_MS = Object.freeze([100, 500]);

function boundedInteger(value, fallback, minimum, maximum) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

export function postgresMigrationTimeouts(env = process.env) {
  return Object.freeze({
    statementTimeoutMs: boundedInteger(
      env?.DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS,
      DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    lockTimeoutMs: boundedInteger(
      env?.DATABASE_MIGRATION_LOCK_TIMEOUT_MS,
      DEFAULT_MIGRATION_LOCK_TIMEOUT_MS,
      500,
      30_000,
    ),
  });
}

// Cache successful initialization and coalesce concurrent callers, but never
// cache a rejected Promise. A transient lock timeout must be recoverable by a
// later readiness probe without restarting the Render instance.
export function retryableInitializer(factory) {
  if (typeof factory !== "function") throw new TypeError("initializer_factory_required");
  let current = null;
  return function initialize() {
    if (current) return current;
    const attempt = Promise.resolve().then(factory);
    const guarded = attempt.catch((error) => {
      if (current === guarded) current = null;
      throw error;
    });
    current = guarded;
    return guarded;
  };
}

export function isRetryablePostgresInitializationError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (/^08[A-Z0-9]{3}$/.test(code)) return true;
  if (["55P03", "57014", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE"].includes(code)) {
    return true;
  }
  const message = String(error?.message || error || "").toLowerCase();
  return /(?:lock|statement|query|connection|pool).{0,40}(?:timeout|timed out|terminated|reset|closed)/u.test(message)
    || /(?:timeout|timed out).{0,40}(?:lock|statement|query|connection|pool)/u.test(message);
}

// Retry only transient PostgreSQL startup failures. Permanent schema or
// contract errors still fail immediately, while lock overlap during a rolling
// deploy gets a small bounded recovery window in the same process.
export async function initializePostgresWithRetry(factory, {
  delaysMs = DEFAULT_INITIALIZATION_RETRY_DELAYS_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof factory !== "function") throw new TypeError("initializer_factory_required");
  const delays = Array.isArray(delaysMs) ? delaysMs.map((value) => boundedInteger(value, 0, 0, 5_000)) : [];
  let attempt = 0;
  while (true) {
    try {
      return await factory();
    } catch (error) {
      if (!isRetryablePostgresInitializationError(error) || attempt >= delays.length) throw error;
      const delay = delays[attempt];
      attempt += 1;
      if (delay > 0) await sleep(delay);
    }
  }
}

export async function runPostgresMigration(pool, sql, {
  env = process.env,
  statementTimeoutMs,
  lockTimeoutMs,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("postgres_migration_pool_required");
  }
  const defaults = postgresMigrationTimeouts(env);
  const statementMs = boundedInteger(
    statementTimeoutMs,
    defaults.statementTimeoutMs,
    1_000,
    120_000,
  );
  const lockMs = boundedInteger(
    lockTimeoutMs,
    defaults.lockTimeoutMs,
    500,
    30_000,
  );
  const migrationSql = String(sql || "").trim();
  if (!migrationSql) throw new TypeError("postgres_migration_sql_required");
  const client = typeof pool.connect === "function" ? await pool.connect() : pool;
  // Test/minimal adapters sometimes return the pool itself from connect(); in
  // that case retain their single-query contract. A real pg.Pool always
  // returns a distinct PoolClient and receives the transactional DDL path.
  const transactional = client !== pool;
  try {
    return transactional
      ? await runPostgresMigrationBlock(client, migrationSql, {
          env,
          statementTimeoutMs: statementMs,
          lockTimeoutMs: lockMs,
          transactional: true,
        })
      : await client.query(migrationSql);
  } finally {
    if (client !== pool) client.release?.();
  }
}

function migrationQuery(client, statementTimeoutMs) {
  return (text, values = undefined) => client.query({
    text: String(text),
    ...(values === undefined ? {} : { values }),
    query_timeout: statementTimeoutMs,
  });
}

// Concurrent index DDL cannot run in a transaction. Temporarily raise the
// PostgreSQL session budget on the leased client, pair it with node-postgres'
// client-side query_timeout, then restore the exact prior settings before the
// client returns to the pool.
export async function withPostgresMigrationSession(client, operation, {
  env = process.env,
  statementTimeoutMs,
  lockTimeoutMs,
} = {}) {
  if (!client || typeof client.query !== "function" || typeof operation !== "function") {
    throw new TypeError("postgres_migration_client_required");
  }
  const defaults = postgresMigrationTimeouts(env);
  const statementMs = boundedInteger(statementTimeoutMs, defaults.statementTimeoutMs, 1_000, 120_000);
  const lockMs = boundedInteger(lockTimeoutMs, defaults.lockTimeoutMs, 500, 30_000);
  const previous = await client.query(
    "SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout",
  );
  const priorStatement = String(previous.rows?.[0]?.statement_timeout ?? "5s");
  const priorLock = String(previous.rows?.[0]?.lock_timeout ?? "2s");
  try {
    await client.query(
      "SELECT set_config('statement_timeout',$1,false), set_config('lock_timeout',$2,false)",
      [`${statementMs}ms`, `${lockMs}ms`],
    );
    return await operation({
      query: migrationQuery(client, statementMs),
      statementTimeoutMs: statementMs,
      lockTimeoutMs: lockMs,
    });
  } finally {
    await client.query(
      "SELECT set_config('statement_timeout',$1,false), set_config('lock_timeout',$2,false)",
      [priorStatement, priorLock],
    );
  }
}

export async function runPostgresMigrationBlock(client, sql, {
  transactional = true,
  env = process.env,
  statementTimeoutMs,
  lockTimeoutMs,
} = {}) {
  const migrationSql = String(sql || "").trim();
  if (!migrationSql) throw new TypeError("postgres_migration_sql_required");
  const defaults = postgresMigrationTimeouts(env);
  const statementMs = boundedInteger(statementTimeoutMs, defaults.statementTimeoutMs, 1_000, 120_000);
  const lockMs = boundedInteger(lockTimeoutMs, defaults.lockTimeoutMs, 500, 30_000);
  if (!transactional) {
    return withPostgresMigrationSession(client, ({ query }) => query(migrationSql), {
      env,
      statementTimeoutMs: statementMs,
      lockTimeoutMs: lockMs,
    });
  }
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query(`SET LOCAL statement_timeout = '${statementMs}ms'`);
    await client.query(`SET LOCAL lock_timeout = '${lockMs}ms'`);
    const result = await migrationQuery(client, statementMs)(migrationSql);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw error;
  }
}

export function createRetryablePostgresInitializer({ pool, sql, ...options } = {}) {
  return retryableInitializer(() => runPostgresMigration(pool, sql, options));
}
