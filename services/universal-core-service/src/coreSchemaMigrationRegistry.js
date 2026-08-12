import { CausalContinuityError } from "./causalContinuityCanonical.js";

export const CORE_SCHEMA_MIGRATION_REGISTRY_LOCK =
  "skinharmony:core-schema-migrations:compatibility:v1";

const DEFAULT_LOCK_TIMEOUT_MS = 3_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;

const REGISTRY_SQL = `
CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  sql_digest char(64),
  application_state text,
  checkpoint text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  verifier_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE core_schema_migrations
  ADD COLUMN IF NOT EXISTS applied_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sql_digest char(64),
  ADD COLUMN IF NOT EXISTS application_state text,
  ADD COLUMN IF NOT EXISTS checkpoint text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verifier_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE core_schema_migrations
  ALTER COLUMN sql_digest DROP NOT NULL,
  ALTER COLUMN application_state DROP NOT NULL,
  ALTER COLUMN checkpoint DROP NOT NULL;
`;

const EXPECTED_COLUMNS = Object.freeze({
  migration_id: {
    types: ["text", "character varying"],
    nullable: "NO",
    minimumVarcharLength: 160,
  },
  applied_at: {
    types: ["timestamp with time zone"], nullable: "NO", default: "now()",
  },
  sql_digest: {
    types: ["character"], nullable: "YES", length: 64, default: null,
  },
  application_state: { types: ["text"], nullable: "YES", default: null },
  checkpoint: { types: ["text"], nullable: "YES", default: null },
  started_at: {
    types: ["timestamp with time zone"], nullable: "NO", default: "clock_timestamp()",
  },
  completed_at: {
    types: ["timestamp with time zone"], nullable: "YES", default: null,
  },
  verifier_evidence: {
    types: ["jsonb"], nullable: "NO", default: "'{}'::jsonb",
  },
});

function boundedMilliseconds(value, fallback, maximum = 60_000) {
  const numeric = Number(value ?? fallback);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > maximum) {
    throw new CausalContinuityError("CAUSAL_MIGRATION_TIMEOUT_INVALID");
  }
  return numeric;
}

async function inBoundedTransaction(client, {
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS,
  timeoutCode,
} = {}, operation) {
  const lockMs = boundedMilliseconds(lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
  const statementMs = boundedMilliseconds(
    statementTimeoutMs,
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(`SET LOCAL lock_timeout = '${lockMs}ms'`);
    await client.query(`SET LOCAL statement_timeout = '${statementMs}ms'`);
    const result = await operation();
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the authoritative error */ }
    }
    if (error?.code === "55P03" || error?.code === "57014") {
      throw new CausalContinuityError(timeoutCode, timeoutCode, {
        lock_timeout_ms: lockMs,
        statement_timeout_ms: statementMs,
      });
    }
    throw error;
  }
}

function normalizedDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function verifyRegistry(columns, primaryKeyColumns) {
  const byName = new Map(columns.map((column) => [column.column_name, column]));
  const incompatible = [];
  for (const [name, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = byName.get(name);
    if (!actual || !expected.types.includes(actual.data_type) ||
        actual.is_nullable !== expected.nullable ||
        (expected.length && Number(actual.character_maximum_length) !== expected.length) ||
        (expected.minimumVarcharLength && actual.data_type === "character varying" &&
          actual.character_maximum_length !== null &&
          Number(actual.character_maximum_length) < expected.minimumVarcharLength) ||
        (Object.hasOwn(expected, "default") &&
          normalizedDefault(actual.column_default) !== expected.default)) {
      incompatible.push(name);
    }
  }
  for (const column of columns) {
    if (!Object.hasOwn(EXPECTED_COLUMNS, column.column_name) &&
        column.is_nullable === "NO" && normalizedDefault(column.column_default) === null) {
      incompatible.push(column.column_name);
    }
  }
  if (primaryKeyColumns.length !== 1 || primaryKeyColumns[0] !== "migration_id") {
    incompatible.push("primary_key");
  }
  if (incompatible.length) {
    throw new CausalContinuityError(
      "CAUSAL_MIGRATION_REGISTRY_INCOMPATIBLE",
      "Shared migration registry does not match the additive compatibility contract",
      { incompatible: [...new Set(incompatible)].sort() },
    );
  }
}

export async function ensureCoreSchemaMigrationRegistry(client, options = {}) {
  if (!client || typeof client.query !== "function") {
    throw new CausalContinuityError("CAUSAL_DATABASE_REQUIRED");
  }
  return inBoundedTransaction(client, {
    ...options,
    timeoutCode: "CAUSAL_MIGRATION_REGISTRY_TIMEOUT",
  }, async () => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [CORE_SCHEMA_MIGRATION_REGISTRY_LOCK],
    );
    await client.query(REGISTRY_SQL);
    const columns = await client.query(`
      SELECT column_name,data_type,character_maximum_length,is_nullable,column_default
        FROM information_schema.columns
       WHERE table_schema=current_schema()
         AND table_name='core_schema_migrations'
       ORDER BY ordinal_position
    `);
    const primaryKey = await client.query(`
      SELECT attribute.attname AS column_name
        FROM pg_constraint constraint_row
        JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum,position)
          ON TRUE
        JOIN pg_attribute attribute
          ON attribute.attrelid=constraint_row.conrelid
         AND attribute.attnum=key_column.attnum
       WHERE constraint_row.conrelid='core_schema_migrations'::regclass
         AND constraint_row.contype='p'
       ORDER BY key_column.position
    `);
    verifyRegistry(
      columns.rows,
      primaryKey.rows.map((row) => row.column_name),
    );
    return {
      schema_version: "core_schema_migration_registry_compat_v1",
      columns: Object.keys(EXPECTED_COLUMNS),
      legacy_mcp_insert_compatible: true,
    };
  });
}

export async function acquireBoundedMigrationLock(client, lockName, options = {}) {
  if (!client || typeof client.query !== "function") {
    throw new CausalContinuityError("CAUSAL_DATABASE_REQUIRED");
  }
  const normalizedLock = String(lockName || "").trim();
  if (!normalizedLock || normalizedLock.length > 240) {
    throw new CausalContinuityError("CAUSAL_MIGRATION_LOCK_INVALID");
  }
  let lockAcquired = false;
  try {
    return await inBoundedTransaction(client, {
      lockTimeoutMs: options.lockTimeoutMs,
      statementTimeoutMs: options.statementTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
      timeoutCode: "CAUSAL_MIGRATION_LOCK_TIMEOUT",
    }, async () => {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [normalizedLock]);
      lockAcquired = true;
      return true;
    });
  } catch (error) {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [normalizedLock]);
      } catch { /* preserve the authoritative acquisition/transaction error */ }
    }
    throw error;
  }
}
