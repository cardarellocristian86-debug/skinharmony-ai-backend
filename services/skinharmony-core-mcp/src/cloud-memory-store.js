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

export const PROJECT_CONTEXT_SCHEMA_VERSION = "skinharmony_project_context_v1";
export const PROJECT_RUN_ARTIFACT_SCHEMA_VERSION = "skinharmony_project_run_artifact_v1";
export const PROJECT_REVIEW_SCHEMA_VERSION = "skinharmony_project_review_v1";
export const PROJECT_CONTEXT_DOCUMENT_NAMES = Object.freeze([
  "PROJECT.md",
  "STATE.md",
  "DECISIONS.md",
  "EVIDENCE.md",
  "HANDOFF.md",
]);

const PROJECT_TERMINAL_STATUS_RANK = Object.freeze({
  interrupted: 1,
  cancelled: 2,
  failed: 3,
  completed: 4,
});

function projectId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw new Error("project_id_invalid");
  return id;
}

function projectText(value, name, max, { multiline = false } = {}) {
  const raw = String(value || "").replaceAll("\u0000", "").trim();
  const invalidControl = multiline
    ? /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0001-\u001f\u007f]/;
  if (!raw || raw.length > max || invalidControl.test(raw)) throw new Error(`${name}_invalid`);
  return redactMemoryText(raw);
}

export function canonicalProjectContextPaths(value) {
  const id = projectId(value);
  const root = `PROJECTS/${id}`;
  return {
    project_id: id,
    root_path: root,
    manifest_path: `${root}/MANIFEST.json`,
    document_paths: PROJECT_CONTEXT_DOCUMENT_NAMES.map((name) => `${root}/${name}`),
  };
}

export function isCanonicalProjectContextPath(value) {
  const sourcePath = String(value || "").replace(/^\/+/, "");
  return /^PROJECTS\/[a-z0-9][a-z0-9_-]{1,63}\/(?:MANIFEST\.json|PROJECT\.md|STATE\.md|DECISIONS\.md|EVIDENCE\.md|HANDOFF\.md)$/i.test(sourcePath);
}

export function isManagedProjectContextPath(value) {
  const sourcePath = String(value || "").replace(/^\/+/, "");
  return /^PROJECTS\/[a-z0-9][a-z0-9_-]{1,63}(?:\/|$)/i.test(sourcePath);
}

function normalizeMemorySourcePath(value) {
  const normalized = String(value || "").replace(/^\/+/, "");
  if (!normalized || normalized.length > 500 || normalized.includes("..") || normalized.includes("\u0000")) {
    throw new Error("memory_source_path_invalid");
  }
  return normalized;
}

function metadataObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the fail-closed error below.
    }
  }
  throw new Error("project_context_provenance_invalid");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function projectRevision(project) {
  const canonical = (project?.documents || []).map((document) => ({
    name: document.name,
    content_sha256: document.content_sha256,
  }));
  return sha256(JSON.stringify(canonical));
}

function exactObject(value, allowedKeys, errorCode) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error(errorCode);
  return value;
}

function reviewedText(value, name, max) {
  if (typeof value !== "string") throw new Error(`${name}_invalid`);
  const text = value.normalize("NFC").trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${name}_invalid`);
  const cleaned = redactMemoryText(text);
  if (cleaned.redactions > 0 || cleaned.text !== text || /\[REDACTED\]/i.test(text)) {
    throw new Error("project_review_sensitive_content");
  }
  return text;
}

export function normalizeProjectReviewInput(input) {
  const value = exactObject(input, [
    "schema_version",
    "project_id",
    "run_id",
    "expected_revision",
    "disposition",
    "decision_items",
    "evidence_items",
    "idempotency_key",
    "review_digest_sha256",
  ], "project_review_input_invalid");
  if (value.schema_version !== undefined && value.schema_version !== PROJECT_REVIEW_SCHEMA_VERSION) {
    throw new Error("project_review_schema_invalid");
  }
  const expectedRevision = String(value.expected_revision || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error("project_review_revision_invalid");
  const disposition = String(value.disposition || "").trim();
  if (!new Set(["accept_selected", "reject"]).has(disposition)) throw new Error("project_review_disposition_invalid");
  const idempotencyKey = String(value.idempotency_key || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,119}$/.test(idempotencyKey)) {
    throw new Error("project_review_idempotency_key_invalid");
  }
  if (!Array.isArray(value.decision_items) || value.decision_items.length > 10) {
    throw new Error("project_review_decision_items_invalid");
  }
  if (!Array.isArray(value.evidence_items) || value.evidence_items.length > 10) {
    throw new Error("project_review_evidence_items_invalid");
  }
  const decisionItems = value.decision_items.map((item) => {
    exactObject(item, ["decision", "rationale"], "project_review_decision_item_invalid");
    return {
      decision: reviewedText(item.decision, "project_review_decision", 1_000),
      rationale: item.rationale === undefined || item.rationale === null || item.rationale === ""
        ? ""
        : reviewedText(item.rationale, "project_review_rationale", 2_000),
    };
  });
  const evidenceItems = value.evidence_items.map((item) => {
    exactObject(item, ["claim", "source"], "project_review_evidence_item_invalid");
    return {
      claim: reviewedText(item.claim, "project_review_claim", 1_000),
      source: reviewedText(item.source, "project_review_source", 1_000),
    };
  });
  if (disposition === "accept_selected" && decisionItems.length + evidenceItems.length === 0) {
    throw new Error("project_review_selection_required");
  }
  if (disposition === "reject" && decisionItems.length + evidenceItems.length !== 0) {
    throw new Error("project_review_reject_items_invalid");
  }
  const canonical = {
    schema_version: PROJECT_REVIEW_SCHEMA_VERSION,
    project_id: projectId(value.project_id),
    run_id: runId(value.run_id),
    expected_revision: expectedRevision,
    disposition,
    decision_items: decisionItems,
    evidence_items: evidenceItems,
    idempotency_key: idempotencyKey,
  };
  if (Buffer.byteLength(JSON.stringify(canonical), "utf8") > 32_000) {
    throw new Error("project_review_too_large");
  }
  const reviewDigestSha256 = sha256(JSON.stringify(canonical));
  if (value.review_digest_sha256 !== undefined && value.review_digest_sha256 !== reviewDigestSha256) {
    throw new Error("project_review_digest_invalid");
  }
  return { ...canonical, review_digest_sha256: reviewDigestSha256 };
}

function terminalStatus(value) {
  const status = String(value || "").trim();
  if (!Object.hasOwn(PROJECT_TERMINAL_STATUS_RANK, status)) throw new Error("project_run_status_invalid");
  return status;
}

function runId(value) {
  const id = String(value || "").trim();
  if (!/^run_[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error("run_id_invalid");
  return id;
}

function runTimestamp(value, errorCode) {
  const raw = String(value || "").trim();
  const timestamp = Date.parse(raw);
  if (!raw || !Number.isFinite(timestamp)) throw new Error(errorCode);
  return { iso: new Date(timestamp).toISOString(), timestamp };
}

function runStartedAt(value) {
  return runTimestamp(value, "run_started_at_invalid");
}

function runCreatedAt(value) {
  return runTimestamp(value, "run_created_at_invalid");
}

function runCompletedAt(value) {
  return runTimestamp(value, "run_completed_at_invalid");
}

function outputDigest(value, outputPresent, errorCode = "project_run_output_digest_invalid") {
  const digest = value === undefined ? "" : String(value || "").trim();
  if (outputPresent && !/^[a-f0-9]{64}$/.test(digest)) throw new Error(errorCode);
  if (!outputPresent && digest) throw new Error(errorCode);
  return digest || undefined;
}

function canonicalProjectContextRows(tenantId, input) {
  const paths = canonicalProjectContextPaths(input.project_id);
  const title = projectText(input.title, "project_title", 160);
  const objective = projectText(input.objective, "project_objective", 4_000, { multiline: true });
  const manifest = {
    schema_version: PROJECT_CONTEXT_SCHEMA_VERSION,
    project_id: paths.project_id,
    root_path: paths.root_path,
    title: title.text,
    objective: objective.text,
    canonical_documents: [...PROJECT_CONTEXT_DOCUMENT_NAMES],
    evidence_policy: "reviewed_only",
    state: "initialized",
  };
  const rawDocuments = new Map([
    ["MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["PROJECT.md", `# ${title.text}\n\nProject ID: \`${paths.project_id}\`\n\n## Objective\n\n${objective.text}\n`],
    ["STATE.md", "# Project state\n\n- Status: initialized\n- Current phase: discovery\n- Next step: define the first governed work item.\n"],
    ["DECISIONS.md", "# Accepted decisions\n\nNo accepted decisions yet. Add only decisions confirmed by the project owner or Universal Core.\n"],
    ["EVIDENCE.md", "# Reviewed evidence\n\nNo reviewed evidence yet. Add only evidence that has been checked and attributed.\n"],
    ["HANDOFF.md", "# Current handoff\n\nNo active handoff. Record the owner, next agent, completed work, blockers, and next action.\n"],
  ]);
  return ["MANIFEST.json", ...PROJECT_CONTEXT_DOCUMENT_NAMES].map((name) => {
    const sourcePath = `${paths.root_path}/${name}`;
    const cleaned = redactMemoryText(rawDocuments.get(name));
    const contentSha256 = sha256(cleaned.text);
    return {
      tenant_id: tenant(tenantId),
      id: stableMemoryId(tenantId, sourcePath),
      source_path: sourcePath,
      title: name === "MANIFEST.json" ? `${title.text} manifest` : `${title.text} — ${name}`,
      content: cleaned.text,
      content_sha256: contentSha256,
      redaction_count: cleaned.redactions + title.redactions + (name === "PROJECT.md" || name === "MANIFEST.json" ? objective.redactions : 0),
      metadata: {
        schema_version: PROJECT_CONTEXT_SCHEMA_VERSION,
        kind: name === "MANIFEST.json" ? "project_manifest" : "project_context_document",
        project_id: paths.project_id,
        document_name: name,
        canonical: true,
      },
    };
  });
}

function parseProjectContextRows(tenantIdValue, projectIdValue, rows) {
  const paths = canonicalProjectContextPaths(projectIdValue);
  const expected = [paths.manifest_path, ...paths.document_paths];
  const byPath = new Map();
  for (const row of rows || []) {
    if (!expected.includes(row?.source_path) || byPath.has(row.source_path)) {
      throw new Error("project_context_provenance_invalid");
    }
    byPath.set(row.source_path, row);
  }
  if (expected.some((sourcePath) => !byPath.has(sourcePath))) throw new Error("project_context_incomplete");
  if (byPath.size !== expected.length) throw new Error("project_context_provenance_invalid");

  for (const [index, expectedPath] of expected.entries()) {
    const row = byPath.get(expectedPath);
    const expectedName = index === 0 ? "MANIFEST.json" : PROJECT_CONTEXT_DOCUMENT_NAMES[index - 1];
    const metadata = metadataObject(row.metadata);
    if (row.id !== stableMemoryId(tenantIdValue, expectedPath)
      || row.content_sha256 !== sha256(row.content)
      || metadata.schema_version !== PROJECT_CONTEXT_SCHEMA_VERSION
      || metadata.kind !== (expectedName === "MANIFEST.json" ? "project_manifest" : "project_context_document")
      || metadata.project_id !== paths.project_id
      || metadata.document_name !== expectedName
      || metadata.canonical !== true) {
      throw new Error("project_context_provenance_invalid");
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(byPath.get(paths.manifest_path).content);
  } catch {
    throw new Error("project_context_manifest_invalid");
  }
  if (manifest?.schema_version !== PROJECT_CONTEXT_SCHEMA_VERSION
    || manifest?.project_id !== paths.project_id
    || manifest?.root_path !== paths.root_path
    || typeof manifest?.title !== "string"
    || !manifest.title.trim()
    || typeof manifest?.objective !== "string"
    || !manifest.objective.trim()
    || JSON.stringify(manifest?.canonical_documents) !== JSON.stringify(PROJECT_CONTEXT_DOCUMENT_NAMES)) {
    throw new Error("project_context_manifest_invalid");
  }
  const documents = PROJECT_CONTEXT_DOCUMENT_NAMES.map((name) => {
    const row = byPath.get(`${paths.root_path}/${name}`);
    return {
      name,
      id: row.id,
      source_path: row.source_path,
      title: row.title,
      content: row.content,
      content_sha256: row.content_sha256,
      redaction_count: Number(row.redaction_count || 0),
      metadata: metadataObject(row.metadata),
      updated_at: row.updated_at,
    };
  });
  return {
    schema_version: PROJECT_CONTEXT_SCHEMA_VERSION,
    project_id: paths.project_id,
    root_path: paths.root_path,
    manifest,
    documents,
  };
}

function validateRunArtifactRow(tenantIdValue, projectIdValue, runIdValue, row) {
  if (!row) return null;
  const expectedPath = `${canonicalProjectContextPaths(projectIdValue).root_path}/RUNS/${runIdValue}.md`;
  const metadata = metadataObject(row.metadata);
  const status = terminalStatus(metadata.status);
  const started = runStartedAt(metadata.run_started_at);
  const created = runCreatedAt(metadata.run_created_at);
  const expectedMetadataKeys = [
    "kind",
    "output_present",
    "project_id",
    "run_created_at",
    "run_id",
    "run_started_at",
    "schema_version",
    "status",
    "terminal_rank",
    "trust_state",
    ...(metadata.run_completed_at === undefined ? [] : ["run_completed_at"]),
    ...(metadata.output_digest_sha256 === undefined ? [] : ["output_digest_sha256"]),
  ].sort();
  const actualMetadataKeys = Object.keys(metadata).sort();
  const completed = metadata.run_completed_at === undefined ? null : runCompletedAt(metadata.run_completed_at);
  const digest = outputDigest(metadata.output_digest_sha256, metadata.output_present, "project_run_artifact_conflict");
  if (row.source_path !== expectedPath
    || row.id !== stableMemoryId(tenantIdValue, expectedPath)
    || row.content_sha256 !== sha256(row.content)
    || !Number.isInteger(Number(row.redaction_count))
    || Number(row.redaction_count) < 0
    || JSON.stringify(actualMetadataKeys) !== JSON.stringify(expectedMetadataKeys)
    || metadata.schema_version !== PROJECT_RUN_ARTIFACT_SCHEMA_VERSION
    || metadata.kind !== "project_run_artifact"
    || metadata.project_id !== projectIdValue
    || metadata.run_id !== runIdValue
    || metadata.trust_state !== "unreviewed_model_output"
    || typeof metadata.output_present !== "boolean"
    || Number(metadata.terminal_rank) !== PROJECT_TERMINAL_STATUS_RANK[status]
    || (completed && completed.timestamp < started.timestamp)) {
    throw new Error("project_run_artifact_conflict");
  }
  return {
    row: { ...row, metadata },
    status,
    rank: PROJECT_TERMINAL_STATUS_RANK[status],
    output_present: metadata.output_present,
    output_digest_sha256: digest,
    created_at: created,
    started_at: started,
    completed_at: completed,
  };
}

function validateReviewArtifactRow(tenantIdValue, projectIdValue, idempotencyKey, row) {
  if (!row) return null;
  const expectedPath = `${canonicalProjectContextPaths(projectIdValue).root_path}/REVIEWS/${idempotencyKey}.json`;
  const metadata = metadataObject(row.metadata);
  const expectedMetadataKeys = [
    "disposition",
    "idempotency_key",
    "kind",
    "owner_reviewed",
    "previous_revision",
    "project_id",
    "review_digest_sha256",
    "reviewed_at",
    "revision",
    "run_id",
    "schema_version",
    "trust_state",
  ].sort();
  if (JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(expectedMetadataKeys)) {
    throw new Error("project_review_artifact_conflict");
  }
  let content;
  try {
    content = JSON.parse(row.content);
  } catch {
    throw new Error("project_review_artifact_conflict");
  }
  const expectedContentKeys = [
    "decision_items",
    "disposition",
    "evidence_items",
    "expected_revision",
    "idempotency_key",
    "owner_reviewed",
    "previous_revision",
    "project_id",
    "review_digest_sha256",
    "reviewed_at",
    "revision",
    "run_id",
    "schema_version",
  ].sort();
  if (!content || typeof content !== "object" || Array.isArray(content)
    || JSON.stringify(Object.keys(content).sort()) !== JSON.stringify(expectedContentKeys)) {
    throw new Error("project_review_artifact_conflict");
  }
  let normalized;
  try {
    normalized = normalizeProjectReviewInput({
      schema_version: content.schema_version,
      project_id: content.project_id,
      run_id: content.run_id,
      expected_revision: content.expected_revision,
      disposition: content.disposition,
      decision_items: content.decision_items,
      evidence_items: content.evidence_items,
      idempotency_key: content.idempotency_key,
      review_digest_sha256: content.review_digest_sha256,
    });
  } catch {
    throw new Error("project_review_artifact_conflict");
  }
  const reviewedAt = String(content.reviewed_at || "");
  const previousRevision = String(content.previous_revision || "");
  const revision = String(content.revision || "");
  if (row.source_path !== expectedPath
    || row.id !== stableMemoryId(tenantIdValue, expectedPath)
    || row.content_sha256 !== sha256(row.content)
    || Number(row.redaction_count) !== 0
    || !Number.isFinite(Date.parse(reviewedAt))
    || !/^[a-f0-9]{64}$/.test(previousRevision)
    || !/^[a-f0-9]{64}$/.test(revision)
    || content.owner_reviewed !== true
    || content.previous_revision !== content.expected_revision
    || metadata.schema_version !== PROJECT_REVIEW_SCHEMA_VERSION
    || metadata.kind !== "project_review_artifact"
    || metadata.project_id !== projectIdValue
    || metadata.run_id !== normalized.run_id
    || metadata.disposition !== normalized.disposition
    || metadata.idempotency_key !== idempotencyKey
    || metadata.review_digest_sha256 !== normalized.review_digest_sha256
    || metadata.reviewed_at !== reviewedAt
    || metadata.previous_revision !== previousRevision
    || metadata.revision !== revision
    || metadata.owner_reviewed !== true
    || metadata.trust_state !== "owner_reviewed") {
    throw new Error("project_review_artifact_conflict");
  }
  return {
    row: { ...row, metadata },
    normalized,
    result: {
      committed: true,
      idempotent: true,
      project_id: projectIdValue,
      run_id: normalized.run_id,
      disposition: normalized.disposition,
      review_id: row.id,
      reviewed_at: reviewedAt,
      previous_revision: previousRevision,
      revision,
    },
  };
}

function prependReviewedBlock(content, block, placeholder) {
  const source = String(content || "").trim();
  const newline = source.indexOf("\n");
  const heading = newline < 0 ? source : source.slice(0, newline).trim();
  let body = newline < 0 ? "" : source.slice(newline + 1).trim();
  if (placeholder && body === placeholder) body = "";
  return `${heading}\n\n${block.trim()}${body ? `\n\n${body}` : ""}\n`;
}

function requireDocumentSize(content, maxBytes) {
  if (!content || Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new Error("project_review_document_too_large");
  }
  return content;
}

function projectRuntimeCursor(project) {
  const state = project.documents.find((document) => document.name === "STATE.md");
  const handoff = project.documents.find((document) => document.name === "HANDOFF.md");
  const fields = ["last_run_id", "last_run_status", "last_run_created_at", "last_run_started_at", "last_run_rank", "last_run_output_present"];
  const stateHas = fields.some((field) => state.metadata[field] !== undefined);
  const handoffHas = fields.some((field) => handoff.metadata[field] !== undefined);
  if (!stateHas && !handoffHas) return null;
  if (!stateHas || !handoffHas || fields.some((field) => state.metadata[field] !== handoff.metadata[field])) {
    throw new Error("project_context_runtime_conflict");
  }
  const id = runId(state.metadata.last_run_id);
  const status = terminalStatus(state.metadata.last_run_status);
  const created = runCreatedAt(state.metadata.last_run_created_at);
  const started = runStartedAt(state.metadata.last_run_started_at);
  const stateCompleted = state.metadata.last_run_completed_at;
  const handoffCompleted = handoff.metadata.last_run_completed_at;
  if (stateCompleted !== handoffCompleted) throw new Error("project_context_runtime_conflict");
  const completed = stateCompleted === undefined ? null : runCompletedAt(stateCompleted);
  const stateDigest = state.metadata.last_run_output_digest_sha256;
  const handoffDigest = handoff.metadata.last_run_output_digest_sha256;
  if (stateDigest !== handoffDigest) throw new Error("project_context_runtime_conflict");
  const digest = outputDigest(stateDigest, state.metadata.last_run_output_present, "project_context_runtime_conflict");
  const rank = Number(state.metadata.last_run_rank);
  if (rank !== PROJECT_TERMINAL_STATUS_RANK[status]
    || typeof state.metadata.last_run_output_present !== "boolean"
    || (completed && completed.timestamp < started.timestamp)) {
    throw new Error("project_context_runtime_conflict");
  }
  return {
    run_id: id,
    status,
    rank,
    output_present: state.metadata.last_run_output_present,
    output_digest_sha256: digest,
    created_at: created,
    started_at: started,
    completed_at: completed,
  };
}

function compareRunPosition(left, right) {
  if (left.started_at.timestamp !== right.started_at.timestamp) {
    return left.started_at.timestamp - right.started_at.timestamp;
  }
  if (left.created_at.timestamp !== right.created_at.timestamp) {
    return left.created_at.timestamp - right.created_at.timestamp;
  }
  const leftCompleted = left.completed_at?.timestamp ?? Number.NEGATIVE_INFINITY;
  const rightCompleted = right.completed_at?.timestamp ?? Number.NEGATIVE_INFINITY;
  if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
  return left.run_id.localeCompare(right.run_id);
}

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
  const now = typeof options.now === "function" ? options.now : () => new Date();
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
  `);
  const readProjectRows = async (client, tenantId, projectIdValue) => {
    const paths = canonicalProjectContextPaths(projectIdValue);
    const sourcePaths = [paths.manifest_path, ...paths.document_paths];
    const result = await client.query(
      `SELECT id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at
       FROM mcp_memory_documents
       WHERE tenant_id = $1 AND source_path = ANY($2::text[])
       ORDER BY source_path ASC`,
      [tenant(tenantId), sourcePaths],
    );
    return result.rows;
  };

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
    async listBySourcePrefix(tenantId, sourcePrefix, limit = 10) {
      await initialize();
      const prefix = String(sourcePrefix || "").replace(/^\/+/, "");
      if (!prefix || prefix.length > 500 || prefix.includes("..") || prefix.includes("\u0000")) {
        throw new Error("memory_source_path_invalid");
      }
      const escaped = prefix.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
      const result = await pool.query(
        `SELECT id, title, source_path, content, content_sha256, redaction_count, metadata, updated_at
         FROM mcp_memory_documents
         WHERE tenant_id = $1 AND source_path LIKE $2 ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT $3`,
        [tenant(tenantId), `${escaped}%`, Math.min(Math.max(Number(limit) || 10, 1), 50)],
      );
      const runPrefix = prefix.match(/^PROJECTS\/([a-z0-9][a-z0-9_-]{1,63})\/RUNS\/$/i);
      if (isManagedProjectContextPath(prefix) && !runPrefix) {
        throw new Error("project_context_source_prefix_invalid");
      }
      if (!runPrefix) return result.rows;
      const tenantIdValue = tenant(tenantId);
      const projectIdValue = projectId(runPrefix[1]);
      return result.rows.map((row) => {
        const expectedPrefix = `${canonicalProjectContextPaths(projectIdValue).root_path}/RUNS/`;
        if (!row.source_path.startsWith(expectedPrefix)) throw new Error("project_run_artifact_conflict");
        const filename = row.source_path.slice(expectedPrefix.length);
        const match = filename.match(/^(run_[A-Za-z0-9_-]{1,150})\.md$/);
        if (!match) throw new Error("project_run_artifact_conflict");
        return validateRunArtifactRow(tenantIdValue, projectIdValue, match[1], row).row;
      });
    },
    async upsert(tenantId, input) {
      await initialize();
      const sourcePath = normalizeMemorySourcePath(input.source_path);
      if (isManagedProjectContextPath(sourcePath)) throw new Error("project_context_namespace_reserved");
      const cleaned = redactMemoryText(input.text);
      const content = cleaned.text.slice(0, config.cloudMemoryMaxDocumentBytes || 250_000);
      const contentSha256 = sha256(content);
      if (input.content_sha256 && input.content_sha256 !== contentSha256) throw new Error("memory_checksum_mismatch");
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
        [tenant(tenantId), id, sourcePath, String(input.title || sourcePath).slice(0, 240), content, contentSha256,
          cleaned.redactions, JSON.stringify(input.metadata || {})],
      );
      return result.rows[0];
    },
    async ensureProjectContext(tenantId, input) {
      await initialize();
      const tenantIdValue = tenant(tenantId);
      const rows = canonicalProjectContextRows(tenantIdValue, input || {});
      const projectIdValue = projectId(input?.project_id);
      const client = typeof pool.connect === "function" ? await pool.connect() : pool;
      const inserted = [];
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantIdValue, projectIdValue]);
        const existingRows = await readProjectRows(client, tenantIdValue, projectIdValue);
        if (existingRows.length > 0 && existingRows.length !== rows.length) {
          throw new Error("project_context_conflict");
        }
        if (existingRows.length === rows.length) {
          const project = parseProjectContextRows(tenantIdValue, projectIdValue, existingRows);
          await client.query("COMMIT");
          return { ...project, created: false, created_documents: [] };
        }
        for (const row of rows) {
          const result = await client.query(
            `INSERT INTO mcp_memory_documents
               (tenant_id, id, source_path, title, content, content_sha256, redaction_count, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
             ON CONFLICT DO NOTHING
             RETURNING source_path`,
            [row.tenant_id, row.id, row.source_path, row.title, row.content, row.content_sha256,
              row.redaction_count, JSON.stringify(row.metadata)],
          );
          if (!result.rows[0]?.source_path) throw new Error("project_context_conflict");
          inserted.push(result.rows[0].source_path);
        }
        const storedRows = await readProjectRows(client, tenantIdValue, projectIdValue);
        const project = parseProjectContextRows(tenantIdValue, projectIdValue, storedRows);
        await client.query("COMMIT");
        return {
          ...project,
          created: inserted.length > 0,
          created_documents: inserted,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        if (client !== pool) client.release?.();
      }
    },
    async recordProjectRunTerminal(tenantId, input) {
      await initialize();
      const tenantIdValue = tenant(tenantId);
      const projectIdValue = projectId(input?.project_id);
      const runIdValue = runId(input?.run_id);
      const status = terminalStatus(input?.status);
      const rank = PROJECT_TERMINAL_STATUS_RANK[status];
      const outputPresent = input?.output_present === true;
      const outputDigestSha256 = outputDigest(input?.output_digest_sha256, outputPresent);
      const created = runCreatedAt(input?.created_at || input?.started_at);
      const started = runStartedAt(input?.started_at);
      const completed = input?.completed_at ? runCompletedAt(input.completed_at) : null;
      if (completed && completed.timestamp < started.timestamp) throw new Error("run_completed_at_invalid");
      const completedAt = completed?.iso;
      const paths = canonicalProjectContextPaths(projectIdValue);
      const artifactPath = `${paths.root_path}/RUNS/${runIdValue}.md`;
      const artifactCleaned = redactMemoryText(input?.artifact_text);
      const artifactContent = artifactCleaned.text.slice(0, config.cloudMemoryMaxDocumentBytes || 250_000);
      const stateCleaned = redactMemoryText(input?.state_text);
      const stateContent = stateCleaned.text.slice(0, config.cloudMemoryMaxDocumentBytes || 250_000);
      const handoffCleaned = redactMemoryText(input?.handoff_text);
      const handoffContent = handoffCleaned.text.slice(0, config.cloudMemoryMaxDocumentBytes || 250_000);
      if (!artifactContent || !stateContent || !handoffContent) throw new Error("project_run_document_invalid");
      const artifactMetadata = {
        schema_version: PROJECT_RUN_ARTIFACT_SCHEMA_VERSION,
        kind: "project_run_artifact",
        project_id: projectIdValue,
        run_id: runIdValue,
        status,
        terminal_rank: rank,
        output_present: outputPresent,
        ...(outputDigestSha256 ? { output_digest_sha256: outputDigestSha256 } : {}),
        run_created_at: created.iso,
        run_started_at: started.iso,
        ...(completedAt ? { run_completed_at: completedAt } : {}),
        trust_state: "unreviewed_model_output",
      };
      const client = typeof pool.connect === "function" ? await pool.connect() : pool;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantIdValue, projectIdValue]);
        const canonicalRows = await readProjectRows(client, tenantIdValue, projectIdValue);
        const project = parseProjectContextRows(tenantIdValue, projectIdValue, canonicalRows);
        const cursor = projectRuntimeCursor(project);
        const canonicalByPath = new Map(canonicalRows.map((row) => [row.source_path, row]));

        const artifactResult = await client.query(
          `SELECT id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at
           FROM mcp_memory_documents WHERE tenant_id = $1 AND source_path = $2`,
          [tenantIdValue, artifactPath],
        );
        const existingArtifact = validateRunArtifactRow(
          tenantIdValue,
          projectIdValue,
          runIdValue,
          artifactResult.rows[0],
        );
        if (existingArtifact && existingArtifact.started_at.iso !== started.iso) {
          throw new Error("project_run_artifact_conflict");
        }
        if (existingArtifact && existingArtifact.created_at.iso !== created.iso) {
          throw new Error("project_run_artifact_conflict");
        }

        let artifact;
        let artifactChanged = false;
        if (!existingArtifact) {
          const inserted = await client.query(
            `INSERT INTO mcp_memory_documents
               (tenant_id, id, source_path, title, content, content_sha256, redaction_count, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
             ON CONFLICT DO NOTHING
             RETURNING id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at`,
            [tenantIdValue, stableMemoryId(tenantIdValue, artifactPath), artifactPath,
              String(input?.artifact_title || `${projectIdValue} — ${runIdValue}`).slice(0, 240),
              artifactContent, sha256(artifactContent), artifactCleaned.redactions, JSON.stringify(artifactMetadata)],
          );
          if (!inserted.rows[0]) throw new Error("project_run_artifact_conflict");
          artifact = inserted.rows[0];
          artifactChanged = true;
        } else if (rank > existingArtifact.rank
          || (rank === existingArtifact.rank && outputPresent && !existingArtifact.output_present)) {
          const updated = await client.query(
            `UPDATE mcp_memory_documents SET
               title=$3, content=$4, content_sha256=$5, redaction_count=$6, metadata=$7::jsonb, updated_at=now()
             WHERE tenant_id=$1 AND source_path=$2
             RETURNING id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at`,
            [tenantIdValue, artifactPath,
              String(input?.artifact_title || `${projectIdValue} — ${runIdValue}`).slice(0, 240),
              artifactContent, sha256(artifactContent), artifactCleaned.redactions, JSON.stringify(artifactMetadata)],
          );
          if (!updated.rows[0]) throw new Error("project_run_artifact_conflict");
          artifact = updated.rows[0];
          artifactChanged = true;
        } else {
          artifact = existingArtifact.row;
        }

        const effectiveStatus = artifactChanged ? status : existingArtifact.status;
        const effectiveRank = artifactChanged ? rank : existingArtifact.rank;
        const effectiveOutputPresent = artifactChanged ? outputPresent : existingArtifact.output_present;
        const effectiveOutputDigest = artifactChanged ? outputDigestSha256 : existingArtifact.output_digest_sha256;
        const effectiveCompleted = artifactChanged ? completed : existingArtifact.completed_at;
        const candidate = {
          run_id: runIdValue,
          status: effectiveStatus,
          rank: effectiveRank,
          output_present: effectiveOutputPresent,
          output_digest_sha256: effectiveOutputDigest,
          created_at: created,
          started_at: started,
          completed_at: effectiveCompleted,
        };
        const position = cursor ? compareRunPosition(candidate, cursor) : 1;
        const stateAdvanced = position > 0
          || (position === 0 && cursor?.run_id === runIdValue && (
            effectiveRank > cursor.rank
            || (effectiveRank === cursor.rank && effectiveOutputPresent && !cursor.output_present)
          ));
        const canonicalAdvanced = stateAdvanced && effectiveStatus === status;
        let state = canonicalByPath.get(`${paths.root_path}/STATE.md`);
        let handoff = canonicalByPath.get(`${paths.root_path}/HANDOFF.md`);

        // If a lower-rank terminal callback loses a same-run race, retain both
        // the completed artifact and its canonical output verbatim.
        if (canonicalAdvanced) {
          const runtimeMetadata = {
            last_run_id: runIdValue,
            last_run_status: status,
            last_run_created_at: created.iso,
            last_run_started_at: started.iso,
            last_run_rank: rank,
            last_run_output_present: outputPresent,
            ...(outputDigestSha256 ? { last_run_output_digest_sha256: outputDigestSha256 } : {}),
            ...(completedAt ? { last_run_completed_at: completedAt } : {}),
            trust_state: "unreviewed_model_output",
          };
          const updateCanonical = async (name, current, content, redactionCount, title) => {
            const metadata = { ...metadataObject(current.metadata), ...runtimeMetadata };
            if (!completedAt) delete metadata.last_run_completed_at;
            if (!outputDigestSha256) delete metadata.last_run_output_digest_sha256;
            const result = await client.query(
              `UPDATE mcp_memory_documents SET
                 title=$3, content=$4, content_sha256=$5, redaction_count=$6, metadata=$7::jsonb, updated_at=now()
               WHERE tenant_id=$1 AND source_path=$2
               RETURNING id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at`,
              [tenantIdValue, `${paths.root_path}/${name}`, String(title || current.title).slice(0, 240),
                content, sha256(content), redactionCount, JSON.stringify(metadata)],
            );
            if (!result.rows[0]) throw new Error("project_context_runtime_conflict");
            return result.rows[0];
          };
          state = await updateCanonical(
            "STATE.md", state, stateContent, stateCleaned.redactions,
            input?.state_title || `${projectIdValue} — STATE.md`,
          );
          handoff = await updateCanonical(
            "HANDOFF.md", handoff, handoffContent, handoffCleaned.redactions,
            input?.handoff_title || `${projectIdValue} — HANDOFF.md`,
          );
        }

        await client.query("COMMIT");
        return {
          recorded: artifactChanged || canonicalAdvanced,
          idempotent: !artifactChanged && !canonicalAdvanced,
          state_advanced: canonicalAdvanced,
          artifact,
          state,
          handoff,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        if (client !== pool) client.release?.();
      }
    },
    async commitProjectReview(tenantId, input) {
      await initialize();
      const review = normalizeProjectReviewInput(input);
      const tenantIdValue = tenant(tenantId);
      const projectIdValue = review.project_id;
      const paths = canonicalProjectContextPaths(projectIdValue);
      const reviewPath = `${paths.root_path}/REVIEWS/${review.idempotency_key}.json`;
      const reviewId = stableMemoryId(tenantIdValue, reviewPath);
      const maxDocumentBytes = config.cloudMemoryMaxDocumentBytes || 250_000;
      const client = typeof pool.connect === "function" ? await pool.connect() : pool;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantIdValue, projectIdValue]);

        // Idempotency is checked before CAS and run lookup so an acknowledged
        // commit remains safely retryable after the project revision advances.
        const priorResult = await client.query(
          `SELECT id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at
           FROM mcp_memory_documents WHERE tenant_id = $1 AND source_path = $2`,
          [tenantIdValue, reviewPath],
        );
        const priorReview = validateReviewArtifactRow(
          tenantIdValue,
          projectIdValue,
          review.idempotency_key,
          priorResult.rows[0],
        );
        if (priorReview) {
          if (priorReview.normalized.review_digest_sha256 !== review.review_digest_sha256) {
            throw new Error("project_review_idempotency_conflict");
          }
          await client.query("COMMIT");
          return priorReview.result;
        }

        const canonicalRows = await readProjectRows(client, tenantIdValue, projectIdValue);
        const project = parseProjectContextRows(tenantIdValue, projectIdValue, canonicalRows);
        const previousRevision = projectRevision(project);
        if (previousRevision !== review.expected_revision) throw new Error("project_review_revision_conflict");

        const runPath = `${paths.root_path}/RUNS/${review.run_id}.md`;
        const runResult = await client.query(
          `SELECT id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at
           FROM mcp_memory_documents WHERE tenant_id = $1 AND source_path = $2`,
          [tenantIdValue, runPath],
        );
        const reviewedRun = validateRunArtifactRow(
          tenantIdValue,
          projectIdValue,
          review.run_id,
          runResult.rows[0],
        );
        if (!reviewedRun) throw new Error("project_review_run_not_found");

        const reviewedAtValue = now();
        const reviewedAt = reviewedAtValue instanceof Date
          ? reviewedAtValue.toISOString()
          : new Date(reviewedAtValue).toISOString();
        const dispositionLabel = review.disposition === "accept_selected" ? "accepted selected items" : "rejected all proposed items";
        const blockHeading = [
          `## Owner-reviewed review \`${review.idempotency_key}\``,
        ];
        const blockProvenance = [
          "",
          `- Reviewed at: ${reviewedAt}`,
          `- Source run: \`${review.run_id}\``,
          `- Disposition: ${review.disposition}`,
          "- Provenance: authenticated project owner review",
        ];
        const decisionLines = review.disposition === "accept_selected"
          ? (review.decision_items.length
            ? review.decision_items.flatMap((item, index) => [
              "",
              `### Accepted decision ${index + 1}`,
              `- Decision: ${item.decision}`,
              ...(item.rationale ? [`- Rationale: ${item.rationale}`] : []),
            ])
            : ["", "No decision was selected in this review."])
          : ["", "The owner rejected all proposed decisions; no model output was accepted as a decision."];
        const evidenceLines = review.disposition === "accept_selected"
          ? (review.evidence_items.length
            ? review.evidence_items.flatMap((item, index) => [
              "",
              `### Accepted evidence ${index + 1}`,
              `- Claim: ${item.claim}`,
              `- Source: ${item.source}`,
            ])
            : ["", "No evidence was selected in this review."])
          : ["", "The owner rejected all proposed evidence; no model output was accepted as evidence."];
        const currentByName = new Map(project.documents.map((document) => [document.name, document]));
        const decisionsContent = requireDocumentSize(prependReviewedBlock(
          currentByName.get("DECISIONS.md").content,
          [...blockHeading, ...decisionLines, ...blockProvenance].join("\n"),
          "No accepted decisions yet. Add only decisions confirmed by the project owner or Universal Core.",
        ), maxDocumentBytes);
        const evidenceContent = requireDocumentSize(prependReviewedBlock(
          currentByName.get("EVIDENCE.md").content,
          [...blockHeading, ...evidenceLines, ...blockProvenance].join("\n"),
          "No reviewed evidence yet. Add only evidence that has been checked and attributed.",
        ), maxDocumentBytes);
        const stateContent = requireDocumentSize([
          "# Project state",
          "",
          "- Status: owner reviewed",
          `- Reviewed run: ${review.run_id}`,
          `- Review disposition: ${review.disposition}`,
          `- Review outcome: ${dispositionLabel}`,
          "- Current phase: governed continuation",
          "- Next step: start the next run from the accepted project context.",
          "- Trust: only the explicitly selected owner-reviewed items are canonical.",
          "",
        ].join("\n"), maxDocumentBytes);
        const handoffContent = requireDocumentSize([
          "# Current handoff",
          "",
          `- From: authenticated project owner review of ${review.run_id}`,
          "- To: Nyra supervisor and the next governed specialist",
          `- Disposition: ${review.disposition}`,
          `- Outcome: ${dispositionLabel}`,
          "- Provenance: owner-reviewed project context only",
          "- Unreviewed model output: withheld",
          "- Next action: use DECISIONS.md and EVIDENCE.md as the accepted logical thread.",
          "",
        ].join("\n"), maxDocumentBytes);
        const reviewMetadata = {
          last_review_id: reviewId,
          last_reviewed_at: reviewedAt,
          last_review_run_id: review.run_id,
          last_review_disposition: review.disposition,
          last_review_digest_sha256: review.review_digest_sha256,
          last_review_provenance: "authenticated_owner_review",
          trust_state: "owner_reviewed",
        };
        const updates = new Map([
          ["DECISIONS.md", decisionsContent],
          ["EVIDENCE.md", evidenceContent],
          ["STATE.md", stateContent],
          ["HANDOFF.md", handoffContent],
        ]);
        for (const [name, content] of updates) {
          const current = currentByName.get(name);
          const metadata = { ...metadataObject(current.metadata), ...reviewMetadata };
          const result = await client.query(
            `UPDATE mcp_memory_documents SET
               title=$3, content=$4, content_sha256=$5, redaction_count=$6, metadata=$7::jsonb, updated_at=now()
             WHERE tenant_id=$1 AND source_path=$2
             RETURNING id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at`,
            [tenantIdValue, `${paths.root_path}/${name}`, current.title, content, sha256(content), 0, JSON.stringify(metadata)],
          );
          if (!result.rows[0]) throw new Error("project_review_commit_conflict");
        }

        const storedRows = await readProjectRows(client, tenantIdValue, projectIdValue);
        const committedProject = parseProjectContextRows(tenantIdValue, projectIdValue, storedRows);
        const revision = projectRevision(committedProject);
        const artifactContent = requireDocumentSize(`${JSON.stringify({
          ...review,
          reviewed_at: reviewedAt,
          previous_revision: previousRevision,
          revision,
          owner_reviewed: true,
        }, null, 2)}\n`, maxDocumentBytes);
        const artifactMetadata = {
          schema_version: PROJECT_REVIEW_SCHEMA_VERSION,
          kind: "project_review_artifact",
          project_id: projectIdValue,
          run_id: review.run_id,
          disposition: review.disposition,
          idempotency_key: review.idempotency_key,
          review_digest_sha256: review.review_digest_sha256,
          reviewed_at: reviewedAt,
          previous_revision: previousRevision,
          revision,
          owner_reviewed: true,
          trust_state: "owner_reviewed",
        };
        const inserted = await client.query(
          `INSERT INTO mcp_memory_documents
             (tenant_id, id, source_path, title, content, content_sha256, redaction_count, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           ON CONFLICT DO NOTHING
           RETURNING id, title, source_path, content, content_sha256, redaction_count, metadata, created_at, updated_at`,
          [tenantIdValue, reviewId, reviewPath, `${projectIdValue} — owner review ${review.idempotency_key}`,
            artifactContent, sha256(artifactContent), 0, JSON.stringify(artifactMetadata)],
        );
        if (!inserted.rows[0]) throw new Error("project_review_idempotency_conflict");

        await client.query("COMMIT");
        return {
          committed: true,
          idempotent: false,
          project_id: projectIdValue,
          run_id: review.run_id,
          disposition: review.disposition,
          review_id: reviewId,
          reviewed_at: reviewedAt,
          previous_revision: previousRevision,
          revision,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        if (client !== pool) client.release?.();
      }
    },
    async readProjectContext(tenantId, projectIdValue) {
      await initialize();
      const tenantIdValue = tenant(tenantId);
      const rows = await readProjectRows(pool, tenantIdValue, projectIdValue);
      return parseProjectContextRows(tenantIdValue, projectIdValue, rows);
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
    close: () => pool.end(),
  };
}
