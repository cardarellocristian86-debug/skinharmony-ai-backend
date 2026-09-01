import crypto from "node:crypto";
import { Pool } from "pg";

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[opusr]_[A-Za-z0-9]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
];

function tenant(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw new Error("tenant_invalid");
  return id;
}

export function redactMemoryText(value) {
  let text = String(value || "").replaceAll("\u0000", "");
  let redactions = 0;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      redactions += 1;
      return "[REDACTED]";
    });
  }
  return { text, redactions };
}

export function stableMemoryId(tenantId, sourcePath) {
  return crypto.createHash("sha256").update(`${tenant(tenantId)}\0${sourcePath}`).digest("hex").slice(0, 24);
}

export function createCloudMemoryStore(config, options = {}) {
  if (!config.databaseUrl) return null;
  const pool = options.pool || new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: config.databasePoolMax || 5,
  });
  let ready;
  const initialize = () => ready ||= pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_memory_documents (
      tenant_id varchar(64) NOT NULL,
      id char(24) NOT NULL,
      source_path text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      content_sha256 char(64) NOT NULL,
      redaction_count integer NOT NULL DEFAULT 0,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, source_path)
    );
    CREATE INDEX IF NOT EXISTS mcp_memory_documents_tenant_updated_idx
      ON mcp_memory_documents (tenant_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS mcp_memory_distilled_lessons (
      tenant_id varchar(64) NOT NULL,
      project_id varchar(64) NOT NULL DEFAULT '',
      tool_name varchar(160) NOT NULL,
      failure_code varchar(160) NOT NULL,
      occurrence_count integer NOT NULL DEFAULT 1,
      first_observed_at timestamptz NOT NULL DEFAULT now(),
      last_observed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, project_id, tool_name, failure_code)
    );
    CREATE INDEX IF NOT EXISTS mcp_memory_distilled_lessons_lookup_idx
      ON mcp_memory_distilled_lessons (tenant_id, project_id, last_observed_at DESC);
  `);

  return {
    backend: "postgres",
    async search(tenantId, query, limit = 20) {
      await initialize();
      const terms = String(query || "").trim().split(/\s+/).filter(Boolean).slice(0, 12);
      if (!terms.length) return [];
      const patterns = terms.map((term) => `%${term}%`);
      const result = await pool.query(
        `SELECT id, title FROM mcp_memory_documents
         WHERE tenant_id = $1
           AND concat_ws(' ', title, source_path, content) ILIKE ALL ($2::text[])
         ORDER BY updated_at DESC LIMIT $3`,
        [tenant(tenantId), patterns, Math.min(Number(limit) || 20, 50)],
      );
      return result.rows.map((row) => ({ id: row.id, title: row.title, url: "" }));
    },
    async fetch(tenantId, id) {
      await initialize();
      const result = await pool.query(
        `SELECT id, title, source_path, content, content_sha256, redaction_count, metadata, updated_at
         FROM mcp_memory_documents WHERE tenant_id = $1 AND id = $2`,
        [tenant(tenantId), id],
      );
      return result.rows[0] || null;
    },
    async inspectBySourcePaths(tenantId, sourcePaths) {
      await initialize();
      const paths = [...new Set((sourcePaths || []).map((value) => String(value || "").replace(/^\/+/, "")))]
        .filter((value) => value && !value.includes(".."))
        .slice(0, 50);
      if (!paths.length) return [];
      const result = await pool.query(
        `SELECT id, source_path, content_sha256, updated_at
         FROM mcp_memory_documents
         WHERE tenant_id = $1 AND source_path = ANY($2::text[])
         ORDER BY source_path ASC`,
        [tenant(tenantId), paths],
      );
      return result.rows;
    },
    async fetchBySourcePaths(tenantId, sourcePaths) {
      await initialize();
      const paths = [...new Set((sourcePaths || []).map((value) => String(value || "").replace(/^\/+/, "")))]
        .filter((value) => value && !value.includes(".."))
        .slice(0, 50);
      if (!paths.length) return [];
      const result = await pool.query(
        `SELECT id, title, source_path, content, content_sha256, redaction_count, metadata, updated_at
         FROM mcp_memory_documents
         WHERE tenant_id = $1 AND source_path = ANY($2::text[])
         ORDER BY source_path ASC`,
        [tenant(tenantId), paths],
      );
      return result.rows;
    },
    async upsert(tenantId, input) {
      await initialize();
      const sourcePath = String(input.source_path || "").replace(/^\/+/, "").slice(0, 500);
      if (!sourcePath || sourcePath.includes("..")) throw new Error("memory_source_path_invalid");
      const cleaned = redactMemoryText(input.text);
      const content = cleaned.text.slice(0, config.cloudMemoryMaxDocumentBytes || 250_000);
      const sha256 = crypto.createHash("sha256").update(content).digest("hex");
      if (input.content_sha256 && input.content_sha256 !== sha256) throw new Error("memory_checksum_mismatch");
      const id = stableMemoryId(tenantId, sourcePath);
      const result = await pool.query(
        `INSERT INTO mcp_memory_documents
           (tenant_id, id, source_path, title, content, content_sha256, redaction_count, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (tenant_id, source_path) DO UPDATE SET
           title=EXCLUDED.title, content=EXCLUDED.content,
           content_sha256=EXCLUDED.content_sha256,
           redaction_count=EXCLUDED.redaction_count,
           metadata=EXCLUDED.metadata, updated_at=now()
         RETURNING id, source_path, content_sha256, redaction_count, updated_at`,
        [tenant(tenantId), id, sourcePath, String(input.title || sourcePath).slice(0, 240), content, sha256,
          cleaned.redactions, JSON.stringify(input.metadata || {})],
      );
      return result.rows[0];
    },
    async status(tenantId) {
      await initialize();
      const result = await pool.query(
        `SELECT count(*)::integer AS document_count, coalesce(sum(octet_length(content)),0)::bigint AS bytes,
                max(updated_at) AS last_updated_at
         FROM mcp_memory_documents WHERE tenant_id = $1`,
        [tenant(tenantId)],
      );
      return { backend: "postgres", ...result.rows[0] };
    },
    async recordDistilledFailure(identity, event = {}) {
      await initialize();
      const tenantId = tenant(identity?.tenantId);
      const toolName = String(event.toolName || "").trim().slice(0, 160);
      const code = String(event.error?.code || event.error?.message || "tool_failed")
        .trim().replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 160) || "tool_failed";
      const projectId = /^[a-z0-9][a-z0-9_-]{1,63}$/i.test(String(event.args?.project_id || ""))
        ? String(event.args.project_id) : "";
      if (!toolName || toolName.startsWith("memory_")) return { recorded: false };
      const result = await pool.query(
        `INSERT INTO mcp_memory_distilled_lessons
           (tenant_id, project_id, tool_name, failure_code)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, project_id, tool_name, failure_code) DO UPDATE SET
           occurrence_count = LEAST(mcp_memory_distilled_lessons.occurrence_count + 1, 10000),
           last_observed_at = now()
         RETURNING tenant_id, project_id, tool_name AS source_tool, failure_code,
                   occurrence_count, first_observed_at, last_observed_at`,
        [tenantId, projectId, toolName, code],
      );
      return { recorded: true, lesson_state: "candidate", ...result.rows[0] };
    },
    async listDistilledLessons(tenantId, projectId = "", limit = 10) {
      await initialize();
      const scopedProject = /^[a-z0-9][a-z0-9_-]{1,63}$/i.test(String(projectId || "")) ? String(projectId) : "";
      const result = await pool.query(
        `SELECT tool_name AS source_tool, failure_code, occurrence_count, first_observed_at, last_observed_at,
                'candidate' AS lesson_state
         FROM mcp_memory_distilled_lessons
         WHERE tenant_id = $1 AND (project_id = $2 OR project_id = '')
         ORDER BY occurrence_count DESC, last_observed_at DESC LIMIT $3`,
        [tenant(tenantId), scopedProject, Math.min(Math.max(Number(limit) || 10, 1), 20)],
      );
      return result.rows;
    },
    close: () => pool.end(),
  };
}
