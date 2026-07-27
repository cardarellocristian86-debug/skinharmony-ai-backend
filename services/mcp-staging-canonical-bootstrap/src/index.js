import crypto from "node:crypto";

export const CANONICAL_BOOTSTRAP_PATHS = Object.freeze([
  "SHARED_MEMORY/INDEX.md",
  "SHARED_MEMORY/STATE.json",
  "SHARED_MEMORY/TASKS.json",
  "SHARED_MEMORY/LOCKS.json",
  "SHARED_MEMORY/ARTIFACTS.json",
  "SHARED_MEMORY/HANDOFF.md",
  "SHARED_MEMORY/handoffs/MCP_STAGING_MULTI_SESSION_COORDINATION_2026-07-21.md",
  "SHARED_MEMORY/snapshots/WORK_SNAPSHOT.md",
]);

export const CANONICAL_BOOTSTRAP_SCOPE = Object.freeze({
  tenant_id: "codexai",
  executor_service: "skinharmony-mcp-staging-db-bootstrap",
  control_role: "mcp_staging_gate_control",
  target_service: "skinharmony-core-mcp-staging",
  target_environment: "staging",
  target_database: "skinharmony_mcp_staging_db",
});

const BUNDLE_SCHEMA = "mcp_staging_canonical_bootstrap_bundle_v1";
const VERIFIED_APPROVAL_SCHEMA = "mcp_staging_canonical_bootstrap_verified_approval_v1";
const RESULT_SCHEMA = "mcp_staging_canonical_bootstrap_result_v1";
const MAX_DOCUMENT_BYTES = 512 * 1024;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const MAX_APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5_000;
const VALIDATED_CAPSULES = new WeakSet();

const BUNDLE_KEYS = Object.freeze([
  "schema_version",
  "bootstrap_id",
  "tenant_id",
  "target",
  "created_at",
  "documents",
]);
const TARGET_KEYS = Object.freeze([
  "service",
  "environment",
  "database",
  "commit",
]);
const DOCUMENT_KEYS = Object.freeze([
  "path",
  "title",
  "content",
  "content_sha256",
  "redaction_count",
  "redaction_status",
]);
const RUNTIME_KEYS = Object.freeze([
  "tenant_id",
  "executor_service",
  "control_role",
  "target_service",
  "target_environment",
  "target_database",
  "target_commit",
]);
const APPROVAL_KEYS = Object.freeze([
  "schema_version",
  "verified",
  "decision",
  "tenant_id",
  "executor_service",
  "control_role",
  "target_service",
  "target_environment",
  "target_database",
  "target_commit",
  "bootstrap_id",
  "bundle_sha256",
  "canonical_paths_sha256",
  "document_count",
  "approval_jti",
  "issued_at",
  "expires_at",
  "authorities",
]);
const AUTHORITY_KEYS = Object.freeze([
  "issuer",
  "role",
  "key_fingerprint",
  "receipt_digest",
]);
const RECEIPT_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "tenant_id",
  "jti",
  "binding_digest",
  "receipt_digest",
  "issued_at",
  "expires_at",
  "authorities",
]);
const RECEIPT_AUTHORITY_KEYS = Object.freeze([
  "issuer",
  "kid",
  "receipt_digest",
]);

const DATA_PLANE_TABLES = Object.freeze([
  "agent_sessions",
  "agent_presence",
  "agent_messages",
  "agent_message_deliveries",
  "agent_tasks",
  "agent_task_leases",
  "agent_handoffs",
  "agent_events",
  "mcp_workspace_heads",
  "mcp_workspace_folders",
  "mcp_workspace_documents",
  "mcp_workspace_document_versions",
  "mcp_workspace_lock_leases",
  "mcp_memory_heads",
  "mcp_memory_stream_heads",
  "mcp_memory_records",
  "mcp_memory_handoffs",
  "mcp_memory_handoff_deliveries",
  "mcp_memory_events",
  "mcp_collaboration_idempotency",
  "mcp_coordination_events",
  "core_ai_work_sessions",
  "core_decision_events",
  "core_verified_outcomes",
]);

const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/,
  /\brnd_[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{24,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b[A-Za-z0-9_.-]*(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|bearer[_-]?keys?|authorization)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?(?!<redacted>|\[redacted\]|REDACTED\b)[^\s"',}]{8,}/i,
]);

export class CanonicalBootstrapError extends Error {
  constructor(code) {
    super(code);
    this.name = "CanonicalBootstrapError";
    this.code = code;
  }
}

function fail(code) {
  throw new CanonicalBootstrapError(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical_bootstrap_non_canonical_value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) fail("canonical_bootstrap_non_canonical_value");
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    }).join(",")}}`;
  }
  fail("canonical_bootstrap_non_canonical_value");
}

function digest(label, value) {
  return crypto.createHash("sha256")
    .update(label)
    .update("\0")
    .update(canonicalJson(value))
    .digest("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactIso(value, code) {
  if (typeof value !== "string") fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) fail(code);
  return milliseconds;
}

function exactCommit(value, code) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) fail(code);
  return value;
}

function exactDigest(value, code) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(code);
  return value;
}

function containsCredentialMaterial(value) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function validateText(value, code, maxBytes, { allowNewlines = true } = {}) {
  if (typeof value !== "string" || value.length === 0 ||
      Buffer.byteLength(value, "utf8") > maxBytes ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ||
      (!allowNewlines && /[\r\n]/.test(value))) {
    fail(code);
  }
  if (containsCredentialMaterial(value)) fail("canonical_bootstrap_credential_material_rejected");
  return value;
}

function validateTarget(target, commit) {
  if (!exactKeys(target, TARGET_KEYS) ||
      target.service !== CANONICAL_BOOTSTRAP_SCOPE.target_service ||
      target.environment !== CANONICAL_BOOTSTRAP_SCOPE.target_environment ||
      target.database !== CANONICAL_BOOTSTRAP_SCOPE.target_database ||
      target.commit !== commit) {
    fail("canonical_bootstrap_target_mismatch");
  }
}

function validateDocument(document, expectedPath) {
  if (!exactKeys(document, DOCUMENT_KEYS) || document.path !== expectedPath) {
    fail("canonical_bootstrap_document_set_invalid");
  }
  const title = validateText(document.title, "canonical_bootstrap_title_invalid", 240, {
    allowNewlines: false,
  });
  const content = validateText(document.content, "canonical_bootstrap_content_invalid", MAX_DOCUMENT_BYTES);
  const contentSha256 = exactDigest(
    document.content_sha256,
    "canonical_bootstrap_content_digest_invalid",
  );
  if (sha256(content) !== contentSha256) fail("canonical_bootstrap_content_digest_mismatch");
  if (!Number.isSafeInteger(document.redaction_count) || document.redaction_count < 0 ||
      document.redaction_status !== "reviewed_redacted") {
    fail("canonical_bootstrap_redaction_review_required");
  }
  return Object.freeze({
    path: expectedPath,
    title,
    content,
    content_sha256: contentSha256,
    redaction_count: document.redaction_count,
    redaction_status: "reviewed_redacted",
  });
}

function parseCanonicalJsonDocument(document) {
  try {
    const parsed = JSON.parse(document.content);
    if (!isPlainObject(parsed)) fail("canonical_bootstrap_document_json_invalid");
    return parsed;
  } catch (error) {
    if (error instanceof CanonicalBootstrapError) throw error;
    fail("canonical_bootstrap_document_json_invalid");
  }
}

function canonicalCollection(document, key) {
  const values = document?.[key];
  const count = Number(document?.count);
  if (!Array.isArray(values) || !Number.isSafeInteger(count) ||
      count < 0 || count !== values.length) {
    fail("canonical_bootstrap_document_semantics_invalid");
  }
  return values;
}

function validateCanonicalDocumentSemantics(documents) {
  const byPath = new Map(documents.map((document) => [document.path, document]));
  const state = parseCanonicalJsonDocument(byPath.get("SHARED_MEMORY/STATE.json"));
  const tasks = parseCanonicalJsonDocument(byPath.get("SHARED_MEMORY/TASKS.json"));
  const locks = parseCanonicalJsonDocument(byPath.get("SHARED_MEMORY/LOCKS.json"));
  const artifacts = parseCanonicalJsonDocument(byPath.get("SHARED_MEMORY/ARTIFACTS.json"));
  if ([state, tasks, locks, artifacts].some((document) =>
    document.tenant !== CANONICAL_BOOTSTRAP_SCOPE.tenant_id)) {
    fail("canonical_bootstrap_document_tenant_mismatch");
  }
  const taskRecords = canonicalCollection(tasks, "tasks");
  const lockRecords = canonicalCollection(locks, "locks");
  canonicalCollection(artifacts, "artifacts");
  const activeTaskCount = Number(state.active_task_count);
  const activeLockCount = Number(state.active_lock_count);
  if (!Number.isSafeInteger(activeTaskCount) || activeTaskCount !== taskRecords.length ||
      !Number.isSafeInteger(activeLockCount) || activeLockCount !== lockRecords.length) {
    fail("canonical_bootstrap_document_semantics_invalid");
  }
}

function validateBundle(bundle) {
  if (!exactKeys(bundle, BUNDLE_KEYS) ||
      bundle.schema_version !== BUNDLE_SCHEMA ||
      typeof bundle.bootstrap_id !== "string" ||
      !/^mcpboot_[A-Za-z0-9_-]{16,80}$/.test(bundle.bootstrap_id) ||
      bundle.tenant_id !== CANONICAL_BOOTSTRAP_SCOPE.tenant_id ||
      !Array.isArray(bundle.documents) ||
      bundle.documents.length !== CANONICAL_BOOTSTRAP_PATHS.length) {
    fail("canonical_bootstrap_bundle_invalid");
  }
  const commit = exactCommit(bundle.target?.commit, "canonical_bootstrap_commit_invalid");
  validateTarget(bundle.target, commit);
  exactIso(bundle.created_at, "canonical_bootstrap_created_at_invalid");
  const documents = bundle.documents.map((document, index) =>
    validateDocument(document, CANONICAL_BOOTSTRAP_PATHS[index]));
  validateCanonicalDocumentSemantics(documents);
  const normalized = Object.freeze({
    schema_version: BUNDLE_SCHEMA,
    bootstrap_id: bundle.bootstrap_id,
    tenant_id: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
    target: Object.freeze({ ...bundle.target }),
    created_at: bundle.created_at,
    documents: Object.freeze(documents),
  });
  if (Buffer.byteLength(canonicalJson(normalized), "utf8") > MAX_BUNDLE_BYTES) {
    fail("canonical_bootstrap_bundle_too_large");
  }
  return normalized;
}

function validateRuntimeBinding(runtimeBinding, bundle) {
  if (!exactKeys(runtimeBinding, RUNTIME_KEYS) ||
      runtimeBinding.tenant_id !== CANONICAL_BOOTSTRAP_SCOPE.tenant_id ||
      runtimeBinding.executor_service !== CANONICAL_BOOTSTRAP_SCOPE.executor_service ||
      runtimeBinding.control_role !== CANONICAL_BOOTSTRAP_SCOPE.control_role ||
      runtimeBinding.target_service !== CANONICAL_BOOTSTRAP_SCOPE.target_service ||
      runtimeBinding.target_environment !== CANONICAL_BOOTSTRAP_SCOPE.target_environment ||
      runtimeBinding.target_database !== CANONICAL_BOOTSTRAP_SCOPE.target_database ||
      exactCommit(runtimeBinding.target_commit, "canonical_bootstrap_runtime_commit_invalid") !==
        bundle.target.commit) {
    fail("canonical_bootstrap_runtime_binding_mismatch");
  }
  return Object.freeze({ ...runtimeBinding });
}

function expectedApproval(bundle, runtimeBinding, bundleSha256) {
  return Object.freeze({
    schema_version: "mcp_staging_canonical_bootstrap_approval_request_v1",
    tenant_id: runtimeBinding.tenant_id,
    executor_service: runtimeBinding.executor_service,
    control_role: runtimeBinding.control_role,
    target_service: runtimeBinding.target_service,
    target_environment: runtimeBinding.target_environment,
    target_database: runtimeBinding.target_database,
    target_commit: runtimeBinding.target_commit,
    bootstrap_id: bundle.bootstrap_id,
    bundle_sha256: bundleSha256,
    canonical_paths_sha256: CANONICAL_BOOTSTRAP_PATHS_SHA256,
    document_count: CANONICAL_BOOTSTRAP_PATHS.length,
  });
}

function validateAuthority(authority, issuer, role) {
  if (!exactKeys(authority, AUTHORITY_KEYS) ||
      authority.issuer !== issuer ||
      authority.role !== role ||
      typeof authority.key_fingerprint !== "string" ||
      !/^ed25519-sha256:[a-f0-9]{64}$/.test(authority.key_fingerprint)) {
    fail("canonical_bootstrap_approval_authority_invalid");
  }
  exactDigest(authority.receipt_digest, "canonical_bootstrap_approval_receipt_digest_invalid");
  return Object.freeze({ ...authority });
}

function validateVerifiedApproval(evidence, expected, nowMs) {
  if (!exactKeys(evidence, APPROVAL_KEYS) ||
      evidence.schema_version !== VERIFIED_APPROVAL_SCHEMA ||
      evidence.verified !== true ||
      evidence.decision !== "allow") {
    fail("canonical_bootstrap_verified_approval_required");
  }
  for (const key of [
    "tenant_id",
    "executor_service",
    "control_role",
    "target_service",
    "target_environment",
    "target_database",
    "target_commit",
    "bootstrap_id",
    "bundle_sha256",
    "canonical_paths_sha256",
    "document_count",
  ]) {
    if (evidence[key] !== expected[key]) fail("canonical_bootstrap_approval_binding_mismatch");
  }
  if (typeof evidence.approval_jti !== "string" ||
      !/^mcpcr_[A-Za-z0-9_-]{16,128}$/.test(evidence.approval_jti)) {
    fail("canonical_bootstrap_approval_jti_invalid");
  }
  const issuedAt = exactIso(evidence.issued_at, "canonical_bootstrap_approval_time_invalid");
  const expiresAt = exactIso(evidence.expires_at, "canonical_bootstrap_approval_time_invalid");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      issuedAt > nowMs + MAX_CLOCK_SKEW_MS ||
      expiresAt <= nowMs ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > MAX_APPROVAL_TTL_MS) {
    fail("canonical_bootstrap_approval_expired");
  }
  if (!Array.isArray(evidence.authorities) || evidence.authorities.length !== 2) {
    fail("canonical_bootstrap_approval_authority_invalid");
  }
  const authorities = Object.freeze([
    validateAuthority(evidence.authorities[0], "universal-core-staging", "final_authority"),
    validateAuthority(evidence.authorities[1], "nyra-staging", "advisory_veto"),
  ]);
  return Object.freeze({ ...evidence, authorities });
}

function validateReceiptEvidence(evidence, approval, expected) {
  if (!exactKeys(evidence, RECEIPT_EVIDENCE_KEYS) ||
      evidence.schema_version !== "mcp_collaboration_verified_receipt_v1" ||
      evidence.tenant_id !== expected.tenant_id ||
      evidence.jti !== approval.approval_jti ||
      evidence.issued_at !== approval.issued_at ||
      evidence.expires_at !== approval.expires_at ||
      !Array.isArray(evidence.authorities) || evidence.authorities.length !== 2) {
    fail("canonical_bootstrap_receipt_evidence_invalid");
  }
  exactDigest(evidence.binding_digest, "canonical_bootstrap_receipt_evidence_invalid");
  exactDigest(evidence.receipt_digest, "canonical_bootstrap_receipt_evidence_invalid");
  const issuedAt = exactIso(evidence.issued_at, "canonical_bootstrap_receipt_evidence_invalid");
  const expiresAt = exactIso(evidence.expires_at, "canonical_bootstrap_receipt_evidence_invalid");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 30_000) {
    fail("canonical_bootstrap_receipt_evidence_invalid");
  }
  const authorities = evidence.authorities.map((authority, index) => {
    if (!exactKeys(authority, RECEIPT_AUTHORITY_KEYS) ||
        authority.issuer !== approval.authorities[index].issuer ||
        authority.kid !== approval.authorities[index].key_fingerprint ||
        authority.receipt_digest !== approval.authorities[index].receipt_digest) {
      fail("canonical_bootstrap_receipt_evidence_invalid");
    }
    exactDigest(authority.receipt_digest, "canonical_bootstrap_receipt_evidence_invalid");
    return Object.freeze({ ...authority });
  });
  if (authorities[0].issuer === authorities[1].issuer ||
      authorities[0].kid === authorities[1].kid) {
    fail("canonical_bootstrap_receipt_evidence_invalid");
  }
  return Object.freeze({ ...evidence, authorities: Object.freeze(authorities) });
}

function sanitizedResult(result, expected, approvalEvidence) {
  if (!isPlainObject(result) ||
      result.consumed !== true ||
      typeof result.consumption_id !== "string" ||
      !/^mcpbootcons_[A-Za-z0-9_-]{16,96}$/.test(result.consumption_id) ||
      typeof result.consumed_at !== "string" ||
      !Number.isFinite(Date.parse(result.consumed_at)) ||
      new Date(Date.parse(result.consumed_at)).toISOString() !== result.consumed_at ||
      result.audit_sha256 == null) {
    fail("canonical_bootstrap_consumer_result_invalid");
  }
  exactDigest(result.audit_sha256, "canonical_bootstrap_consumer_result_invalid");
  return Object.freeze({
    schema_version: RESULT_SCHEMA,
    bootstrapped: true,
    tenant_id: expected.tenant_id,
    executor_service: expected.executor_service,
    control_role: expected.control_role,
    target_service: expected.target_service,
    target_environment: expected.target_environment,
    target_database: expected.target_database,
    target_commit: expected.target_commit,
    bootstrap_id: expected.bootstrap_id,
    bundle_sha256: expected.bundle_sha256,
    canonical_paths_sha256: expected.canonical_paths_sha256,
    document_count: expected.document_count,
    approval_evidence_sha256: digest(
      "mcp-staging-canonical-bootstrap-verified-approval-v1",
      approvalEvidence,
    ),
    consumption_id: result.consumption_id,
    consumed_at: result.consumed_at,
    audit_sha256: result.audit_sha256,
  });
}

export const CANONICAL_BOOTSTRAP_PATHS_SHA256 = digest(
  "mcp-staging-canonical-bootstrap-paths-v1",
  CANONICAL_BOOTSTRAP_PATHS,
);

export function canonicalBootstrapBundleDigest(bundle) {
  return digest("mcp-staging-canonical-bootstrap-bundle-v1", validateBundle(bundle));
}

export function createCanonicalBootstrapBundle({
  bootstrap_id,
  target_commit,
  created_at,
  documents,
} = {}) {
  if (!Array.isArray(documents) || documents.length !== CANONICAL_BOOTSTRAP_PATHS.length) {
    fail("canonical_bootstrap_document_set_invalid");
  }
  const bundle = {
    schema_version: BUNDLE_SCHEMA,
    bootstrap_id,
    tenant_id: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
    target: {
      service: CANONICAL_BOOTSTRAP_SCOPE.target_service,
      environment: CANONICAL_BOOTSTRAP_SCOPE.target_environment,
      database: CANONICAL_BOOTSTRAP_SCOPE.target_database,
      commit: target_commit,
    },
    created_at,
    documents: documents.map((document, index) => ({
      path: CANONICAL_BOOTSTRAP_PATHS[index],
      title: document?.title,
      content: document?.content,
      content_sha256: sha256(String(document?.content ?? "")),
      redaction_count: document?.redaction_count,
      redaction_status: document?.redaction_status,
    })),
  };
  return validateBundle(bundle);
}

export function createCanonicalBootstrapProtocol({
  approvalVerifier,
  consumer,
  now = Date.now,
} = {}) {
  if (!approvalVerifier || typeof approvalVerifier.verify !== "function") {
    fail("canonical_bootstrap_approval_verifier_required");
  }
  if (!consumer || typeof consumer.consumeOnce !== "function") {
    fail("canonical_bootstrap_consumer_required");
  }
  if (typeof now !== "function") fail("canonical_bootstrap_clock_invalid");

  return Object.freeze({
    async execute({ bundle, runtime_binding, approval_artifact } = {}) {
      const normalizedBundle = validateBundle(bundle);
      const runtimeBinding = validateRuntimeBinding(runtime_binding, normalizedBundle);
      if (approval_artifact === undefined || approval_artifact === null) {
        fail("canonical_bootstrap_approval_artifact_required");
      }
      const bundleSha256 = digest(
        "mcp-staging-canonical-bootstrap-bundle-v1",
        normalizedBundle,
      );
      const expected = expectedApproval(normalizedBundle, runtimeBinding, bundleSha256);
      const verified = await approvalVerifier.verify(approval_artifact, expected);
      if (!exactKeys(verified, ["approval", "receipt_evidence"])) {
        fail("canonical_bootstrap_verified_approval_required");
      }
      const timestamp = Number(now());
      const approvalEvidence = validateVerifiedApproval(verified.approval, expected, timestamp);
      const receiptEvidence = validateReceiptEvidence(
        verified.receipt_evidence,
        approvalEvidence,
        expected,
      );
      const capsule = Object.freeze({
        bundle: normalizedBundle,
        expected,
        approval: approvalEvidence,
        receipt_evidence: receiptEvidence,
        approval_evidence_sha256: digest(
          "mcp-staging-canonical-bootstrap-verified-approval-v1",
          approvalEvidence,
        ),
      });
      VALIDATED_CAPSULES.add(capsule);
      const result = await consumer.consumeOnce(capsule);
      return sanitizedResult(result, expected, approvalEvidence);
    },
  });
}

export function canonicalBootstrapControlSchemaSql() {
  return `
CREATE SCHEMA IF NOT EXISTS mcp_collaboration_control;
ALTER SCHEMA mcp_collaboration_control OWNER TO CURRENT_USER;
REVOKE ALL ON SCHEMA mcp_collaboration_control FROM PUBLIC;

CREATE TABLE IF NOT EXISTS mcp_collaboration_control.canonical_bootstrap_consumptions (
  tenant_id varchar(64) NOT NULL,
  consumption_id varchar(108) NOT NULL,
  bootstrap_id varchar(96) NOT NULL,
  bundle_sha256 char(64) NOT NULL,
  canonical_paths_sha256 char(64) NOT NULL,
  approval_jti_sha256 char(64) NOT NULL,
  approval_evidence_sha256 char(64) NOT NULL,
  core_receipt_digest char(64) NOT NULL,
  nyra_receipt_digest char(64) NOT NULL,
  executor_service varchar(120) NOT NULL,
  control_role name NOT NULL,
  target_service varchar(120) NOT NULL,
  target_environment varchar(40) NOT NULL,
  target_database varchar(120) NOT NULL,
  target_commit char(40) NOT NULL,
  document_count smallint NOT NULL CHECK (document_count = 8),
  audit_sha256 char(64) NOT NULL,
  consumed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id),
  UNIQUE (consumption_id),
  UNIQUE (bootstrap_id),
  UNIQUE (bundle_sha256),
  UNIQUE (approval_jti_sha256)
);
ALTER TABLE mcp_collaboration_control.canonical_bootstrap_consumptions OWNER TO CURRENT_USER;
REVOKE ALL ON TABLE mcp_collaboration_control.canonical_bootstrap_consumptions FROM PUBLIC;

CREATE OR REPLACE FUNCTION mcp_collaboration_control.reject_canonical_bootstrap_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, mcp_collaboration_control, pg_temp
AS $canonical_bootstrap_append_only$
BEGIN
  RAISE EXCEPTION 'canonical_bootstrap_append_only';
END;
$canonical_bootstrap_append_only$;
ALTER FUNCTION mcp_collaboration_control.reject_canonical_bootstrap_mutation() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION mcp_collaboration_control.reject_canonical_bootstrap_mutation() FROM PUBLIC;

DROP TRIGGER IF EXISTS canonical_bootstrap_consumptions_no_mutation
  ON mcp_collaboration_control.canonical_bootstrap_consumptions;
CREATE TRIGGER canonical_bootstrap_consumptions_no_mutation
  BEFORE UPDATE OR DELETE OR TRUNCATE
  ON mcp_collaboration_control.canonical_bootstrap_consumptions
  FOR EACH STATEMENT
  EXECUTE FUNCTION mcp_collaboration_control.reject_canonical_bootstrap_mutation();
`;
}

function emptyDataPlaneSql() {
  return `SELECT (${DATA_PLANE_TABLES.map((table) =>
    `(SELECT count(*) FROM public.${table} WHERE tenant_id=$1)`).join(" + ")})::bigint AS tenant_row_count`;
}

function postgresError(code) {
  return new CanonicalBootstrapError(code);
}

export function createPostgresCanonicalBootstrapConsumer(pool) {
  if (!pool || typeof pool.connect !== "function") {
    fail("canonical_bootstrap_postgres_pool_invalid");
  }

  return Object.freeze({
    async consumeOnce(capsule) {
      if (!VALIDATED_CAPSULES.has(capsule)) fail("canonical_bootstrap_validated_capsule_required");
      const {
        bundle,
        expected,
        approval,
        receipt_evidence: receiptEvidence,
        approval_evidence_sha256: approvalEvidenceSha256,
      } = capsule;
      let client;
      let transactionOpen = false;
      try {
        client = await pool.connect();
        if (!client || typeof client.query !== "function") {
          throw postgresError("canonical_bootstrap_postgres_client_invalid");
        }
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
        transactionOpen = true;
        await client.query({
          name: "canonical-bootstrap-advisory-lock-v1",
          text: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          values: [`mcp-staging-canonical-bootstrap:${expected.tenant_id}`],
        });
        const database = await client.query({
          name: "canonical-bootstrap-database-and-role-binding-v2",
          text: `SELECT current_database() AS database_name,
                        current_user AS current_user,
                        session_user AS session_user`,
          values: [],
        });
        if (database?.rowCount !== 1 ||
            database.rows[0]?.database_name !== expected.target_database ||
            database.rows[0]?.current_user !== expected.control_role ||
            database.rows[0]?.session_user !== expected.control_role) {
          throw postgresError("canonical_bootstrap_database_binding_mismatch");
        }
        const consumed = await client.query({
          name: "canonical-bootstrap-existing-consumption-v1",
          text: `SELECT consumption_id
                 FROM mcp_collaboration_control.canonical_bootstrap_consumptions
                 WHERE tenant_id=$1`,
          values: [expected.tenant_id],
        });
        if (consumed?.rowCount !== 0) {
          throw postgresError("canonical_bootstrap_already_consumed");
        }
        const empty = await client.query({
          name: "canonical-bootstrap-empty-data-plane-v1",
          text: emptyDataPlaneSql(),
          values: [expected.tenant_id],
        });
        if (empty?.rowCount !== 1 ||
            BigInt(empty.rows[0]?.tenant_row_count ?? -1) !== 0n) {
          throw postgresError("canonical_bootstrap_database_not_empty");
        }
        const consumedReceipts = await client.query({
          name: "canonical-bootstrap-consume-receipt-pair-v1",
          text: `SELECT consumed_issuer AS issuer
                 FROM mcp_collaboration_control.consume_receipt_pair(
                   $1::varchar,$2::varchar,$3::char(64),$4::timestamptz,$5::timestamptz,
                   $6::varchar,$7::char(64),$8::varchar,$9::char(64)
                 )`,
          values: [
            receiptEvidence.tenant_id,
            receiptEvidence.jti,
            receiptEvidence.binding_digest,
            receiptEvidence.issued_at,
            receiptEvidence.expires_at,
            receiptEvidence.authorities[0].issuer,
            receiptEvidence.authorities[0].receipt_digest,
            receiptEvidence.authorities[1].issuer,
            receiptEvidence.authorities[1].receipt_digest,
          ],
        });
        if (consumedReceipts?.rowCount !== 2) {
          throw postgresError("canonical_bootstrap_receipt_expired_or_replayed");
        }
        const timestamp = await client.query({
          name: "canonical-bootstrap-database-time-v1",
          text: "SELECT clock_timestamp() AS consumed_at",
          values: [],
        });
        const consumedAtValue = timestamp?.rows?.[0]?.consumed_at;
        const consumedAt = consumedAtValue instanceof Date
          ? consumedAtValue.toISOString()
          : new Date(consumedAtValue).toISOString();
        const consumptionId = `mcpbootcons_${crypto.randomBytes(18).toString("base64url")}`;
        const actorSubject = "mcp-staging-canonical-bootstrap";
        const actorSubjectSha256 = sha256(actorSubject);

        const folderPaths = [
          "SHARED_MEMORY",
          "SHARED_MEMORY/handoffs",
          "SHARED_MEMORY/snapshots",
        ];
        for (const path of folderPaths) {
          const parentPath = path.includes("/")
            ? path.split("/").slice(0, -1).join("/")
            : null;
          await client.query({
            name: "canonical-bootstrap-insert-folder-v1",
            text: `INSERT INTO public.mcp_workspace_folders
                     (tenant_id,id,path,parent_path,name,version,created_by_subject,created_at)
                   VALUES ($1,$2,$3,$4,$5,1,$6,$7)`,
            values: [
              expected.tenant_id,
              crypto.randomUUID(),
              path,
              parentPath,
              path.split("/").at(-1),
              actorSubject,
              consumedAt,
            ],
          });
        }

        for (const document of bundle.documents) {
          const documentId = crypto.randomUUID();
          await client.query({
            name: "canonical-bootstrap-insert-document-v1",
            text: `INSERT INTO public.mcp_workspace_documents
                     (tenant_id,id,path,title,current_version,current_content_sha256,redaction_count,
                      last_fencing_token,created_by_subject,updated_by_subject,created_by_agent_id,
                      updated_by_agent_id,created_at,updated_at)
                   VALUES ($1,$2,$3,$4,1,$5,$6,NULL,$7,$7,NULL,NULL,$8,$8)`,
            values: [
              expected.tenant_id,
              documentId,
              document.path,
              document.title,
              document.content_sha256,
              document.redaction_count,
              actorSubject,
              consumedAt,
            ],
          });
          await client.query({
            name: "canonical-bootstrap-insert-document-version-v1",
            text: `INSERT INTO public.mcp_workspace_document_versions
                     (tenant_id,document_id,version,title,content,content_sha256,redaction_count,
                      actor_subject,agent_id,session_fingerprint,agent_signature,fencing_token,created_at)
                   VALUES ($1,$2,1,$3,$4,$5,$6,$7,NULL,NULL,NULL,NULL,$8)`,
            values: [
              expected.tenant_id,
              documentId,
              document.title,
              document.content,
              document.content_sha256,
              document.redaction_count,
              actorSubject,
              consumedAt,
            ],
          });
        }
        await client.query({
          name: "canonical-bootstrap-insert-workspace-head-v1",
          text: `INSERT INTO public.mcp_workspace_heads
                   (tenant_id,revision,updated_at)
                 VALUES ($1,$2,$3)`,
          values: [
            expected.tenant_id,
            CANONICAL_BOOTSTRAP_PATHS.length,
            consumedAt,
          ],
        });

        const approvalJtiSha256 = sha256(approval.approval_jti);
        const auditPayload = Object.freeze({
          schema_version: "mcp_staging_canonical_bootstrap_audit_v1",
          tenant_id: expected.tenant_id,
          executor_service: expected.executor_service,
          control_role: expected.control_role,
          target_service: expected.target_service,
          target_environment: expected.target_environment,
          target_database: expected.target_database,
          target_commit: expected.target_commit,
          bootstrap_id: expected.bootstrap_id,
          bundle_sha256: expected.bundle_sha256,
          canonical_paths_sha256: expected.canonical_paths_sha256,
          approval_jti_sha256: approvalJtiSha256,
          approval_evidence_sha256: approvalEvidenceSha256,
          document_count: expected.document_count,
          consumption_id: consumptionId,
          consumed_at: consumedAt,
        });
        const auditSha256 = digest(
          "mcp-staging-canonical-bootstrap-audit-v1",
          auditPayload,
        );
        await client.query({
          name: "canonical-bootstrap-insert-coordination-audit-v1",
          text: `INSERT INTO public.mcp_coordination_events
                   (tenant_id,event_type,actor_subject_sha256,actor_agent_id,target,action_sha256,metadata,created_at)
                 VALUES ($1,'canonical.bootstrap',$2,NULL,$3,$4,$5::jsonb,$6)`,
          values: [
            expected.tenant_id,
            actorSubjectSha256,
            expected.target_service,
            auditSha256,
            JSON.stringify(auditPayload),
            consumedAt,
          ],
        });
        await client.query({
          name: "canonical-bootstrap-insert-consumption-v1",
          text: `INSERT INTO mcp_collaboration_control.canonical_bootstrap_consumptions
                   (tenant_id,consumption_id,bootstrap_id,bundle_sha256,canonical_paths_sha256,
                    approval_jti_sha256,approval_evidence_sha256,core_receipt_digest,
                    nyra_receipt_digest,executor_service,control_role,target_service,
                    target_environment,target_database,target_commit,document_count,audit_sha256,
                    consumed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          values: [
            expected.tenant_id,
            consumptionId,
            expected.bootstrap_id,
            expected.bundle_sha256,
            expected.canonical_paths_sha256,
            approvalJtiSha256,
            approvalEvidenceSha256,
            approval.authorities[0].receipt_digest,
            approval.authorities[1].receipt_digest,
            expected.executor_service,
            expected.control_role,
            expected.target_service,
            expected.target_environment,
            expected.target_database,
            expected.target_commit,
            expected.document_count,
            auditSha256,
            consumedAt,
          ],
        });
        await client.query("COMMIT");
        transactionOpen = false;
        return {
          consumed: true,
          consumption_id: consumptionId,
          consumed_at: consumedAt,
          audit_sha256: auditSha256,
        };
      } catch (error) {
        if (transactionOpen && client) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Fail closed without surfacing a provider/database error.
          }
        }
        if (error instanceof CanonicalBootstrapError) throw error;
        throw postgresError("canonical_bootstrap_database_error");
      } finally {
        if (client && typeof client.release === "function") {
          try {
            const releaseResult = client.release();
            releaseResult?.catch?.(() => {});
          } catch {
            // Release failures never override a committed result or expose provider detail.
          }
        }
      }
    },
  });
}
