import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(SERVICE_ROOT, "../..");
const ROLLBACK_POINT_FILE =
  "docs/releases/0.16.0-ai-learning-factory-rollback-point.json";
const MIGRATION_DIGEST_TOKEN = "__V016_MIGRATION_DIGEST__";
const ROLLBACK_REFERENCE_TOKEN = "__V016_ROLLBACK_REFERENCE__";
const MIGRATION_LOCK_KEY = "universal-core:v0.16:static-migrations";

export const V016_STATIC_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: "0.16.0-ai-learning-factory-v1",
    file: "migrations/0.16.0-ai-learning-factory.up.sql",
    auditQuery:
      "SELECT state,migration_digest,rollback_reference "
      + "FROM ai_learning_governance.schema_migration_audit "
      + "WHERE migration_version=$1 ORDER BY applied_at DESC LIMIT 1",
  }),
  Object.freeze({
    version: "0.16.0-agentic-efficiency-v1",
    file: "migrations/0.16.0-agentic-efficiency.up.sql",
    auditQuery:
      "SELECT state,migration_digest,rollback_reference "
      + "FROM agentic_governance.agentic_schema_migration_audit "
      + "WHERE migration_version=$1 ORDER BY applied_at DESC LIMIT 1",
  }),
]);

function migrationDigest(sql) {
  return `sha256:${crypto.createHash("sha256").update(sql).digest("hex")}`;
}

function validateStaticMigration(sql, migration) {
  const normalized = String(sql || "").trim();
  if (
    !normalized
    || !/\bBEGIN\s*;/i.test(normalized)
    || !/\bCOMMIT\s*;\s*$/i.test(normalized)
    || !normalized.includes(migration.version)
    || !normalized.includes(MIGRATION_DIGEST_TOKEN)
    || !normalized.includes(ROLLBACK_REFERENCE_TOKEN)
  ) {
    throw new Error(`static_migration_invalid:${migration.file}`);
  }
  return normalized;
}

function rollbackReference(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || ""));
  } catch {
    throw new Error("rollback_point_invalid");
  }
  const commit = String(parsed?.git?.base_commit || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("rollback_point_invalid");
  return `git:${commit}`;
}

function auditMissing(error) {
  return ["3F000", "42P01", "42703"].includes(String(error?.code || ""));
}

async function readMigrationAudit(client, migration) {
  try {
    const result = await client.query(migration.auditQuery, [migration.version]);
    return result.rows?.[0] || null;
  } catch (error) {
    if (auditMissing(error)) return null;
    throw error;
  }
}

function auditMatches(row, migration) {
  return (
    row?.state === "active"
    && row?.migration_digest === migration.digest
    && row?.rollback_reference === migration.rollback_reference
  );
}

export function v016MigrationPublicErrorCode(error) {
  const message = String(error?.message || "");
  if (message === "governed_agent_database_url_required") return message;
  if (message === "static_migration_path_invalid") return message;
  if (message === "rollback_point_invalid") return message;
  if (/^static_migration_invalid:[a-zA-Z0-9._/-]+$/.test(message)) return message;
  if (/^static_migration_not_active:[a-zA-Z0-9._-]+$/.test(message)) return message;
  if (/^static_migration_digest_mismatch:[a-zA-Z0-9._-]+$/.test(message)) return message;
  if (message === "static_migration_lock_unavailable") return message;
  if (message === "static_migration_unlock_failed") return message;
  return "v016_static_migration_failed";
}

export async function loadV016StaticMigrations({
  serviceRoot = SERVICE_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
  readFile = fs.readFile,
} = {}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const rollbackPath = path.resolve(resolvedRepositoryRoot, ROLLBACK_POINT_FILE);
  if (!rollbackPath.startsWith(`${resolvedRepositoryRoot}${path.sep}`)) {
    throw new Error("rollback_point_invalid");
  }
  const resolvedRollbackReference = rollbackReference(
    await readFile(rollbackPath, "utf8"),
  );
  const loaded = [];
  for (const migration of V016_STATIC_MIGRATIONS) {
    const absolutePath = path.resolve(serviceRoot, migration.file);
    if (!absolutePath.startsWith(`${path.resolve(serviceRoot)}${path.sep}`)) {
      throw new Error("static_migration_path_invalid");
    }
    const template = validateStaticMigration(
      await readFile(absolutePath, "utf8"),
      migration,
    );
    const digest = migrationDigest(template);
    const sql = template
      .replaceAll(MIGRATION_DIGEST_TOKEN, digest)
      .replaceAll(ROLLBACK_REFERENCE_TOKEN, resolvedRollbackReference);
    loaded.push(Object.freeze({
      ...migration,
      sql,
      digest,
      rollback_reference: resolvedRollbackReference,
    }));
  }
  return Object.freeze(loaded);
}

export async function applyV016StaticMigrations({
  connectionString = "",
  pool = null,
  serviceRoot = SERVICE_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const databaseUrl = String(connectionString || "").trim();
  if (!pool && !databaseUrl) throw new Error("governed_agent_database_url_required");

  const migrations = await loadV016StaticMigrations({
    serviceRoot,
    repositoryRoot,
  });
  const database = pool || new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 5_000,
    application_name: "universal-core-v016-predeploy",
  });
  const ownsPool = !pool;
  let client = null;
  let lockAcquired = false;
  let operationError = null;
  const receipts = [];
  try {
    client = await database.connect();
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
      [MIGRATION_LOCK_KEY],
    );
    if (lock.rows?.[0]?.acquired !== true) {
      throw new Error("static_migration_lock_unavailable");
    }
    lockAcquired = true;
    for (const migration of migrations) {
      const existing = await readMigrationAudit(client, migration);
      if (existing?.state === "active" && !auditMatches(existing, migration)) {
        throw new Error(`static_migration_digest_mismatch:${migration.version}`);
      }
      const skipped = auditMatches(existing, migration);
      if (!skipped) await client.query(migration.sql);
      const audit = skipped ? existing : await readMigrationAudit(client, migration);
      if (!auditMatches(audit, migration)) {
        throw new Error(`static_migration_not_active:${migration.version}`);
      }
      receipts.push(Object.freeze({
        version: migration.version,
        file: migration.file,
        digest: migration.digest,
        rollback_reference: migration.rollback_reference,
        state: "active",
        operation: skipped ? "reconciled_existing" : "applied",
      }));
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let cleanupError = null;
    try {
      if (client && lockAcquired) {
        const unlock = await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released",
          [MIGRATION_LOCK_KEY],
        );
        if (unlock.rows?.[0]?.released !== true) {
          throw new Error("static_migration_unlock_failed");
        }
      }
    } catch {
      cleanupError = new Error("static_migration_unlock_failed");
    }
    try {
      client?.release?.();
    } catch {
      cleanupError ||= new Error("static_migration_cleanup_failed");
    }
    try {
      if (ownsPool) await database.end();
    } catch {
      cleanupError ||= new Error("static_migration_cleanup_failed");
    }
    if (!operationError && cleanupError) throw cleanupError;
  }

  return Object.freeze({
    schema_version: "universal_core_v016_static_migration_receipt_v1",
    migration_count: receipts.length,
    applied_count: receipts.filter((item) => item.operation === "applied").length,
    reconciled_count: receipts.filter((item) =>
      item.operation === "reconciled_existing").length,
    migrations: Object.freeze(receipts),
    advisory_lock: "verified",
    secrets_exposed: false,
  });
}
