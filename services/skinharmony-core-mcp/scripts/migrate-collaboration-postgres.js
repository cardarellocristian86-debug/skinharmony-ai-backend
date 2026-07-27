import { Pool } from "pg";
import { loadCollaborationMigrationDatabaseUrl } from "../src/collaboration-database-guards.js";
import {
  applyCollaborationPostgresMigration,
  configureCollaborationRuntimeRole,
} from "../src/collaboration-postgres-schema.js";

async function main() {
  const connectionString = loadCollaborationMigrationDatabaseUrl(process.env);
  const pool = new Pool({
    connectionString,
    ssl: ["1", "true", "yes", "on"].includes(String(process.env.MCP_COLLABORATION_MIGRATION_DATABASE_SSL || "").toLowerCase())
      ? { rejectUnauthorized: false }
      : undefined,
    max: 1,
    connectionTimeoutMillis: 8_000,
    query_timeout: 8_000,
  });
  try {
    const result = await applyCollaborationPostgresMigration(pool, { controlPlane: true });
    await configureCollaborationRuntimeRole(
      pool,
      process.env.MCP_COLLABORATION_RUNTIME_DATABASE_ROLE,
      { controlPlane: true },
    );
    process.stdout.write(`${JSON.stringify({ ok: true, version: result.version, migration_id: result.migration_id })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write("collaboration_schema_migration_failed\n");
  process.exitCode = 1;
});
