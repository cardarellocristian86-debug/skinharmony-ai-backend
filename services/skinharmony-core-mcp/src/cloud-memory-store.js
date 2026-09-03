import crypto from "node:crypto";
import { Pool } from "pg";
import { postgresPoolConfig } from "./postgres-pool-config.js";
import {
  createRetryablePostgresInitializer,
  initializePostgresWithRetry,
} from "../../shared/retryable-postgres-initializer.js";

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

function safeLessonCode(value) {
  const code = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_.:-]{1,159}$/.test(code) ? code : "unclassified_failure";
}

function safeProjectId(...values) {
  const value = values.map((item) => String(item || "")).find((item) => /^[a-z0-9][a-z0-9_-]{1,63}$/i.test(item));
  return value || "";
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

// This key deliberately contains no tenant, project, prompt, error message or
// caller identity. It identifies a platform-wide failure *class*, not a
// customer's incident. Tenant observations remain service-private and are used
// only to establish corroboration before a block can be exposed to Nyra.
export function platformLearningBlockKey(toolName, failureCode) {
  return crypto.createHash("sha256")
    .update(`nyra-platform-learning-block-v1\0${toolName}\0${failureCode}`)
    .digest("hex");
}

export function createCloudMemoryStore(config, options = {}) {
  if (!config.databaseUrl) return null;
  const pool = options.pool || new Pool(postgresPoolConfig(config, {
    connectionString: config.databaseUrl,
  }));
  const migrate = createRetryablePostgresInitializer({ pool, sql: `
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
    CREATE TABLE IF NOT EXISTS mcp_platform_learning_blocks (
      block_key char(64) PRIMARY KEY,
      source_tool varchar(160) NOT NULL,
      failure_code varchar(160) NOT NULL,
      occurrence_count integer NOT NULL DEFAULT 1,
      corroborating_tenant_count integer NOT NULL DEFAULT 1,
      lifecycle_state varchar(16) NOT NULL DEFAULT 'candidate',
      first_observed_at timestamptz NOT NULL DEFAULT now(),
      last_observed_at timestamptz NOT NULL DEFAULT now(),
      CHECK (lifecycle_state IN ('candidate', 'shadow', 'verified')),
      UNIQUE (source_tool, failure_code)
    );
    CREATE INDEX IF NOT EXISTS mcp_platform_learning_blocks_read_idx
      ON mcp_platform_learning_blocks (lifecycle_state, occurrence_count DESC, last_observed_at DESC);
    CREATE TABLE IF NOT EXISTS mcp_platform_learning_block_observations (
      block_key char(64) NOT NULL REFERENCES mcp_platform_learning_blocks(block_key) ON DELETE CASCADE,
      tenant_id varchar(64) NOT NULL,
      first_observed_at timestamptz NOT NULL DEFAULT now(),
      last_observed_at timestamptz NOT NULL DEFAULT now(),
      occurrence_count integer NOT NULL DEFAULT 1,
      PRIMARY KEY (block_key, tenant_id)
    );
  ` });
  let initializationState = "idle";
  let initializationError = null;
  let initializationPromise = null;

  function initialize() {
    if (initializationState === "ready") return Promise.resolve({ ready: true, backend: "postgres" });
    if (initializationPromise) return initializationPromise;
    initializationState = "initializing";
    initializationError = null;
    const attempt = initializePostgresWithRetry(() => migrate());
    const guarded = attempt.then(() => {
      initializationState = "ready";
      return { ready: true, backend: "postgres" };
    }).catch((error) => {
      initializationState = "failed";
      initializationError = String(error?.code || "cloud_memory_initialization_failed").slice(0, 80);
      if (initializationPromise === guarded) initializationPromise = null;
      throw error;
    });
    initializationPromise = guarded;
    return guarded;
  }

  function requireInitialized() {
    if (initializationState === "ready") return;
    const error = new Error("cloud_memory_not_ready");
    error.code = "cloud_memory_not_ready";
    error.status = 503;
    error.statusCode = 503;
    throw error;
  }

  return {
    backend: "postgres",
    initialize,
    initializationStatus: () => ({
      state: initializationState,
      ready: initializationState === "ready",
      error: initializationError,
    }),
    async search(tenantId, query, limit = 20) {
      requireInitialized();
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
      requireInitialized();
      const result = await pool.query(
        `SELECT id, title, source_path, content, content_sha256, redaction_count, metadata, updated_at
         FROM mcp_memory_documents WHERE tenant_id = $1 AND id = $2`,
        [tenant(tenantId), id],
      );
      return result.rows[0] || null;
    },
    async inspectBySourcePaths(tenantId, sourcePaths) {
      requireInitialized();
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
      requireInitialized();
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
      requireInitialized();
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
      requireInitialized();
      const result = await pool.query(
        `SELECT count(*)::integer AS document_count, coalesce(sum(octet_length(content)),0)::bigint AS bytes,
                max(updated_at) AS last_updated_at
         FROM mcp_memory_documents WHERE tenant_id = $1`,
        [tenant(tenantId)],
      );
      return { backend: "postgres", ...result.rows[0] };
    },
    async recordDistilledFailure(identity, event = {}) {
      requireInitialized();
      const tenantId = tenant(identity?.tenantId);
      const dynamic = event.toolName === "core_capability_invoke";
      const toolName = String(dynamic ? event.args?.capability_id : event.toolName || "").trim().slice(0, 160);
      const targetArgs = dynamic && event.args?.arguments && typeof event.args.arguments === "object"
        ? event.args.arguments : event.args || {};
      const payload = event.result?.structuredContent || {};
      const code = safeLessonCode(event.error?.code || event.error?.error_code || payload.error_code || payload.code || payload.result?.error_code);
      const projectId = safeProjectId(
        event.preflight?.work_preflight?.continuity?.project_id,
        event.preflight?.work_preflight?.project_id,
        targetArgs.project_id,
      );
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
      const lesson = result.rows[0];
      let platformLearning = null;
      // The platform aggregate contains only a failure class. A tenant ID is
      // retained exclusively in the non-exposed observation table to count
      // independent corroboration; it is never returned by a platform read.
      // A platform-learning write is deliberately best-effort: it must never
      // prevent the tenant's own lesson from being retained.
      try {
        const blockKey = platformLearningBlockKey(toolName, code);
        await pool.query(
        `INSERT INTO mcp_platform_learning_blocks
           (block_key, source_tool, failure_code)
         VALUES ($1,$2,$3)
         ON CONFLICT (block_key) DO UPDATE SET
           occurrence_count = LEAST(mcp_platform_learning_blocks.occurrence_count + 1, 1000000),
           last_observed_at = now()
         RETURNING block_key`,
        [blockKey, toolName, code],
        );
        const observation = await pool.query(
        `INSERT INTO mcp_platform_learning_block_observations
           (block_key, tenant_id)
         VALUES ($1,$2)
         ON CONFLICT (block_key, tenant_id) DO UPDATE SET
           occurrence_count = LEAST(mcp_platform_learning_block_observations.occurrence_count + 1, 10000),
           last_observed_at = now()
         RETURNING (xmax = 0) AS first_for_tenant`,
        [blockKey, tenantId],
        );
        const firstForTenant = observation.rows[0]?.first_for_tenant === true;
        const platform = await pool.query(
        `UPDATE mcp_platform_learning_blocks
         SET corroborating_tenant_count = CASE WHEN $2 THEN LEAST(corroborating_tenant_count + 1, 100000) ELSE corroborating_tenant_count END,
             lifecycle_state = CASE WHEN (CASE WHEN $2 THEN corroborating_tenant_count + 1 ELSE corroborating_tenant_count END) >= 2
               THEN CASE WHEN lifecycle_state = 'verified' THEN 'verified' ELSE 'shadow' END
               ELSE lifecycle_state END,
             last_observed_at = now()
         WHERE block_key = $1
         RETURNING block_key, source_tool, failure_code, occurrence_count,
                   corroborating_tenant_count, lifecycle_state, first_observed_at, last_observed_at`,
        [blockKey, firstForTenant],
        );
        platformLearning = platform.rows[0] || null;
      } catch {
        platformLearning = { state: "unavailable" };
      }
      return { recorded: true, lesson_state: "candidate", ...lesson,
        platform_learning: platformLearning };
    },
    async listDistilledLessons(tenantId, projectId, limit = 10) {
      requireInitialized();
      const scopedProject = safeProjectId(projectId);
      const result = await pool.query(
        `SELECT tool_name AS source_tool, failure_code, occurrence_count, first_observed_at, last_observed_at,
                'candidate' AS lesson_state
         FROM mcp_memory_distilled_lessons
         WHERE tenant_id = $1 AND project_id = $2
         ORDER BY occurrence_count DESC, last_observed_at DESC LIMIT $3`,
        [tenant(tenantId), scopedProject, Math.min(Math.max(Number(limit) || 10, 1), 20)],
      );
      return result.rows;
    },
    async listPlatformLearningBlocks(limit = 10) {
      requireInitialized();
      const result = await pool.query(
        `SELECT block_key, source_tool, failure_code, occurrence_count,
                corroborating_tenant_count, lifecycle_state, first_observed_at, last_observed_at
         FROM mcp_platform_learning_blocks
         WHERE lifecycle_state IN ('shadow', 'verified')
         ORDER BY occurrence_count DESC, last_observed_at DESC LIMIT $1`,
        [Math.min(Math.max(Number(limit) || 10, 1), 20)],
      );
      return result.rows.map((row) => ({
        ...row,
        scope: "platform_anonymized",
        entity_360_reference: {
          schema_version: "entity_360_platform_learning_block_v1",
          entity_id: `nyra_platform_learning:${String(row.block_key).slice(0, 24)}`,
          entity_type: "nyra_platform_learning_block",
          lifecycle_state: row.lifecycle_state,
          provenance: "aggregate_failure_class_only",
        },
      }));
    },
    close: () => pool.end(),
  };
}
