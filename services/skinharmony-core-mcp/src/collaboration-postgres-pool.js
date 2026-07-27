import { Pool } from "pg";

export function createCollaborationPostgresPool(config, options = {}) {
  if (options.pool) return options.pool;
  if (!config.collaborationDatabaseUrl) return null;
  return new Pool({
    connectionString: config.collaborationDatabaseUrl,
    ssl: config.collaborationDatabaseSsl ? { rejectUnauthorized: false } : undefined,
    max: config.databasePoolMax || 5,
    connectionTimeoutMillis: config.collaborationDatabaseTimeoutMs || 8_000,
    query_timeout: config.collaborationDatabaseTimeoutMs || 8_000,
    options: "-c search_path=pg_catalog,public,pg_temp -c row_security=on",
    application_name: "skinharmony-core-mcp-collaboration",
  });
}
