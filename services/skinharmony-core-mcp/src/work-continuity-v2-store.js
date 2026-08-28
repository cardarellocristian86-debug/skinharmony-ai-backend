import crypto from "node:crypto";
import {
  ARCHIVE_STATUSES,
  CLOSURE_ADAPTERS,
  OPERATIONAL_STATUSES,
  WORK_CONTINUITY_V2_SCHEMA_SQL,
  buildGenericClosureArtifacts,
  classifyStaleWork,
  derivePriority,
  deriveProgress,
  resolveWorkRequest,
} from "./work-continuity-v2.js";

const ADDITIVE_SCHEMA_SQL = `
${WORK_CONTINUITY_V2_SCHEMA_SQL}
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_work_id uuid;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS idea text;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS architecture jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS created_by_agent_id varchar(128);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS created_by_session_fingerprint varchar(128);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS priority_version varchar(64) NOT NULL DEFAULT 'work_priority_v1';
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS priority_context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant_work_task ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true;
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1 CHECK (weight > 0);
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS verified_by_agent_id varchar(128);
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS verified_by_session_fingerprint varchar(128);
ALTER TABLE IF EXISTS tenant_work_native_verifier_evidence ADD COLUMN IF NOT EXISTS v2_task_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_legacy_identity_idx
  ON tenant_work (tenant_id, legacy_work_id) WHERE legacy_work_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS tenant_work_core_join (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  core_join_digest char(64) NOT NULL,
  core_join_context jsonb NOT NULL,
  persisted_by_user_id varchar(128),
  persisted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS archived_from_status varchar(24);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS archived_reason text;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS reopened_at timestamptz;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS assignment_target_agent_id varchar(128);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS assignment_target_client_type varchar(32);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS assignment_status varchar(24);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS assignment_offered_at timestamptz;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS assignment_accepted_at timestamptz;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_projection_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_projection_event_hash char(64);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_projection_updated_at timestamptz;
CREATE TABLE IF NOT EXISTS tenant_work_open_review (
  tenant_id varchar(64) NOT NULL, review_id uuid NOT NULL, request_digest char(64) NOT NULL,
  review_digest char(64) NOT NULL, decision_required boolean NOT NULL, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, consumed_by_user_id varchar(128), decision varchar(48), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,review_id)
);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS subject_user_id varchar(128);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS request_id varchar(160);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS project_id varchar(128);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS intent_digest char(64);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS review_result jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS decision_digest char(64);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS consumed_work_id uuid;
CREATE TABLE IF NOT EXISTS tenant_work_bootstrap_request (
  tenant_id varchar(64) NOT NULL,
  subject_user_id varchar(128) NOT NULL,
  request_id varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  review_id uuid NOT NULL,
  consumed_work_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_user_id, request_id),
  UNIQUE (tenant_id, review_id)
);
CREATE INDEX IF NOT EXISTS tenant_work_open_review_request_identity_idx
  ON tenant_work_open_review (tenant_id,subject_user_id,request_id)
  INCLUDE (request_digest,consumed_work_id)
  WHERE subject_user_id IS NOT NULL AND request_id IS NOT NULL;
-- Adopt only unambiguous historical review identities. Ambiguous legacy
-- duplicates remain untouched and fail closed when requested at runtime. A
-- transaction-scoped advisory lock plus ledger marker makes this a one-shot
-- migration across concurrent replicas instead of an O(N) startup scan.
DO $work_bootstrap_backfill$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('20260825_work_bootstrap_request_backfill_v2',0));
  IF NOT EXISTS (
    SELECT 1 FROM core_schema_migrations
    WHERE migration_id='20260825_work_bootstrap_request_backfill_v2'
  ) THEN
    INSERT INTO tenant_work_bootstrap_request
  (tenant_id,subject_user_id,request_id,request_digest,review_id,consumed_work_id)
SELECT DISTINCT ON (r.tenant_id,r.subject_user_id,r.request_id)
  r.tenant_id,r.subject_user_id,r.request_id,r.request_digest,r.review_id,r.consumed_work_id
FROM tenant_work_open_review r
WHERE r.subject_user_id IS NOT NULL AND r.request_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tenant_work_open_review other_review
    WHERE other_review.tenant_id=r.tenant_id
      AND other_review.subject_user_id=r.subject_user_id
      AND other_review.request_id=r.request_id
      AND (
        other_review.request_digest<>r.request_digest OR
        (other_review.consumed_work_id IS NOT NULL AND r.consumed_work_id IS NOT NULL
          AND other_review.consumed_work_id<>r.consumed_work_id)
      )
  )
ORDER BY r.tenant_id,r.subject_user_id,r.request_id,
  (r.consumed_work_id IS NOT NULL) DESC,r.consumed_at DESC NULLS LAST,r.created_at ASC
ON CONFLICT DO NOTHING;
    INSERT INTO core_schema_migrations (migration_id)
    VALUES ('20260825_work_bootstrap_request_backfill_v2');
  END IF;
END;
$work_bootstrap_backfill$;
CREATE TABLE IF NOT EXISTS tenant_work_event (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  event_id uuid NOT NULL,
  sequence_number integer NOT NULL,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash char(64),
  event_hash char(64) NOT NULL,
  created_by_user_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,event_id),
  UNIQUE (tenant_id,work_id,sequence_number),
  FOREIGN KEY (tenant_id,work_id) REFERENCES tenant_work(tenant_id,work_id)
);
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260808_work_continuity_v2_runtime') ON CONFLICT DO NOTHING;
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260825_work_bootstrap_request_v1') ON CONFLICT DO NOTHING;
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260826_native_verifier_evidence_bridge_v1') ON CONFLICT DO NOTHING;
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260828_native_verifier_task_acceptance_v1') ON CONFLICT DO NOTHING;
`;

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION = "generic_work_core_join_v1";
const GENERIC_WORK_CORE_JOIN_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const GENERIC_WORK_CORE_JOIN_ID = GENERIC_WORK_CORE_JOIN_KEY_ID;
const GENERIC_WORK_CORE_JOIN_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GENERIC_WORK_CORE_JOIN_BASE64URL = /^[A-Za-z0-9_-]+$/;
const GENERIC_WORK_CORE_JOIN_VERDICT_FIELDS = Object.freeze([
  "acceptance_criteria_digest", "adapter", "authority", "decision", "evidence_digest",
  "execution_authorized", "host_action_authorized", "idempotency_digest",
  "independent_verifier_receipt_digest", "issued_at", "key_id", "schema_version",
  "signature", "signature_algorithm", "task_state_digest", "tenant_id", "verdict_digest",
  "verdict_id", "work_id",
]);

function fail(code) { throw new Error(code); }
function text(value, code, max = 8_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}
function galleryIdempotencyKey(value, code) {
  const normalized = text(value, code, 160);
  if (normalized.length < 8 || /[\u0000-\u001f\u007f]/u.test(normalized)) fail(code);
  return normalized;
}
function uuid(value, code = "work_id_invalid") {
  const normalized = text(value, code, 36);
  if (!UUID.test(normalized)) fail(code);
  return normalized;
}
function digest(value, code = "digest_invalid") {
  const normalized = text(value, code, 64);
  if (!HASH.test(normalized)) fail(code);
  return normalized;
}
function projectCode(projectId) {
  return text(projectId, "project_id_invalid", 128)
    .toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "WORK";
}
function stringArray(value, code, maxItems = 100, maxLength = 128) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(code);
  return [...new Set(value.map((item) => text(item, code, maxLength)))];
}
function workBootstrapTextCollections(input = {}) {
  const acceptanceCriteria = stringArray(
    input.acceptance_criteria,
    "acceptance_criteria_invalid",
    250,
    2_000,
  );
  if (!acceptanceCriteria.length) fail("acceptance_criteria_required");
  const constraints = stringArray(input.constraints, "constraints_invalid", 100, 1_000);
  return { acceptanceCriteria, constraints };
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function objectDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactObjectKeys(value, fields) {
  return plainRecord(value) &&
    Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

const CLOSURE_VERIFICATION_SCHEMA_VERSION = "tenant_work_closure_verification_v1";
const CLOSURE_EVENT_PAYLOAD_FIELDS = Object.freeze([
  "adapter",
  "archived",
  "closure_receipt_digest",
  "core_join_digest",
  "final_evidence_digest",
  "report_digest",
]);
const FINAL_REPORT_FIELDS = Object.freeze([
  "schema_version",
  "work_id",
  "work_code",
  "work_name",
  "work_type",
  "tenant_id",
  "project_id",
  "owner_user_id",
  "team_id",
  "intent_digest",
  "created_at",
  "started_at",
  "closed_at",
  "final_status",
  "progress_bp",
  "priority",
  "objective",
  "acceptance_criteria",
  "evidence_summary",
  "core_join_digest",
  "closure_receipt",
  "final_evidence_digest",
]);

export function deriveLegacyFinalReportDigest(report) {
  if (!plainRecord(report) || !plainRecord(report.closure_receipt) ||
      !Array.isArray(report.evidence_summary)) return null;
  const closureReceipt = {
    receipt_id: report.closure_receipt.receipt_id,
    work_id: report.closure_receipt.work_id,
    adapter: report.closure_receipt.adapter,
    core_join_digest: report.closure_receipt.core_join_digest,
    final_evidence_digest: report.closure_receipt.final_evidence_digest,
    issued_at: report.closure_receipt.issued_at,
    receipt_digest: report.closure_receipt.receipt_digest,
  };
  const legacyOrder = {
    schema_version: report.schema_version,
    work_id: report.work_id,
    work_code: report.work_code,
    work_name: report.work_name,
    work_type: report.work_type,
    tenant_id: report.tenant_id,
    project_id: report.project_id,
    owner_user_id: report.owner_user_id,
    team_id: report.team_id,
    intent_digest: report.intent_digest,
    created_at: report.created_at,
    started_at: report.started_at,
    closed_at: report.closed_at,
    final_status: report.final_status,
    progress_bp: report.progress_bp,
    priority: report.priority,
    objective: report.objective,
    acceptance_criteria: report.acceptance_criteria,
    evidence_summary: report.evidence_summary.map((item) => ({
      kind: item?.kind,
      digest: item?.digest,
    })),
    core_join_digest: report.core_join_digest,
    closure_receipt: closureReceipt,
    final_evidence_digest: report.final_evidence_digest,
  };
  return crypto.createHash("sha256").update(JSON.stringify(legacyOrder)).digest("hex");
}

function canonicalTimestamp(value) {
  if (value == null) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function canonicalEvidenceSummary(value) {
  if (!Array.isArray(value) || value.some((item) => (
    !exactObjectKeys(item, ["kind", "digest"]) ||
    typeof item.kind !== "string" || !item.kind || !HASH.test(String(item.digest || ""))
  ))) return null;
  return value.map((item) => ({ kind: item.kind, digest: item.digest }))
    .sort((left, right) => `${left.kind}\0${left.digest}`.localeCompare(`${right.kind}\0${right.digest}`));
}

export function deriveTenantWorkClosureVerification(input = {}, { verifyCoreJoin } = {}) {
  const work = plainRecord(input.work) ? input.work : {};
  const tenantId = typeof input.tenant_id === "string" ? input.tenant_id : null;
  const workId = typeof work.work_id === "string" ? work.work_id : null;
  const status = typeof work.status === "string" ? work.status : null;
  const failureCodes = [];
  const reject = (code) => {
    if (!failureCodes.includes(code)) failureCodes.push(code);
  };

  if (!tenantId || work.tenant_id !== tenantId || !UUID.test(String(workId || ""))) {
    reject("closure_work_binding_invalid");
  }
  if (!new Set(["COMPLETED", "ARCHIVED"]).has(status)) {
    reject("closure_work_status_invalid");
  }

  const requiredTasks = Array.isArray(input.tasks)
    ? input.tasks.filter((item) => item?.required !== false)
    : [];
  if (!requiredTasks.length || requiredTasks.some((item) => (
    !plainRecord(item) || item.tenant_id !== tenantId || item.work_id !== workId ||
    item.status !== "completed" || item.acceptance_verified !== true
  ))) reject("closure_required_tasks_unverified");

  const requiredEvidence = Array.isArray(input.evidence)
    ? input.evidence.filter((item) => item?.required !== false)
    : [];
  if (!requiredEvidence.length || requiredEvidence.some((item) => (
    !plainRecord(item) || item.tenant_id !== tenantId || item.work_id !== workId ||
    !HASH.test(String(item.digest || "")) || item.independently_verified !== true
  ))) reject("closure_required_evidence_unverified");
  const evidenceDigests = requiredEvidence
    .map((item) => String(item?.digest || ""))
    .filter((item) => HASH.test(item))
    .sort();
  const finalEvidenceDigest = evidenceDigests.length === requiredEvidence.length && evidenceDigests.length
    ? objectDigest(evidenceDigests)
    : null;

  const join = plainRecord(input.core_join) ? input.core_join : null;
  const joinContext = plainRecord(join?.core_join_context) ? join.core_join_context : null;
  if (!join || join.tenant_id !== tenantId || join.work_id !== workId ||
      !HASH.test(String(join.core_join_digest || "")) || !joinContext ||
      joinContext.tenant_id !== tenantId || joinContext.work_id !== workId ||
      joinContext.verdict_digest !== join.core_join_digest ||
      joinContext.authority !== "universal_core" ||
      joinContext.decision !== "GENERIC_WORK_CORE_JOIN_ELIGIBLE" ||
      typeof verifyCoreJoin !== "function" || verifyCoreJoin(joinContext) !== true) {
    reject("closure_core_join_unverified");
  }

  const receipt = plainRecord(input.closure_receipt) ? input.closure_receipt : null;
  if (!receipt || receipt.tenant_id !== tenantId || receipt.work_id !== workId ||
      !UUID.test(String(receipt.receipt_id || "")) ||
      !CLOSURE_ADAPTERS.includes(receipt.adapter) ||
      !HASH.test(String(receipt.core_join_digest || "")) ||
      !HASH.test(String(receipt.final_evidence_digest || "")) ||
      !HASH.test(String(receipt.receipt_digest || "")) ||
      receipt.core_join_digest !== join?.core_join_digest ||
      receipt.final_evidence_digest !== finalEvidenceDigest ||
      work.final_evidence_digest !== finalEvidenceDigest) {
    reject("closure_receipt_binding_invalid");
  }

  const reportRow = plainRecord(input.final_report) ? input.final_report : null;
  const report = plainRecord(reportRow?.report) ? reportRow.report : null;
  const reportDigest = report ? objectDigest(report) : null;
  const reportReceipt = plainRecord(report?.closure_receipt) ? report.closure_receipt : null;
  const reportEvidenceSummary = canonicalEvidenceSummary(report?.evidence_summary);
  const expectedEvidenceSummary = canonicalEvidenceSummary(requiredEvidence.map((item) => ({
    kind: item?.kind,
    digest: item?.digest,
  })));
  const reportClosedAt = canonicalTimestamp(report?.closed_at);
  const workClosedAt = canonicalTimestamp(work.closed_at);
  const closureTimeBound = reportClosedAt && workClosedAt &&
    Math.abs(Date.parse(reportClosedAt) - Date.parse(workClosedAt)) <= 5 * 60_000;
  if (!reportRow || reportRow.tenant_id !== tenantId || reportRow.work_id !== workId ||
      !HASH.test(String(reportRow.report_digest || "")) || reportRow.report_digest !== reportDigest ||
      !exactObjectKeys(report, FINAL_REPORT_FIELDS) ||
      report.schema_version !== "tenant_work_final_report_v1" ||
      report.tenant_id !== tenantId || report.work_id !== workId ||
      report.work_code !== work.work_code || report.work_name !== work.work_name ||
      report.work_type !== work.work_type || report.project_id !== work.project_id ||
      report.owner_user_id !== work.owner_user_id || report.team_id !== work.team_id ||
      report.intent_digest !== work.intent_digest || report.objective !== work.objective ||
      canonicalTimestamp(report.created_at) !== canonicalTimestamp(work.created_at) ||
      canonicalTimestamp(report.started_at) !== canonicalTimestamp(work.started_at) ||
      !closureTimeBound || report.progress_bp !== 10000 || Number(work.progress_bp) !== 10000 ||
      report.priority !== work.priority || !Array.isArray(report.acceptance_criteria) ||
      objectDigest(report.acceptance_criteria) !== objectDigest(work.acceptance_criteria || []) ||
      !reportEvidenceSummary || !expectedEvidenceSummary ||
      objectDigest(reportEvidenceSummary) !== objectDigest(expectedEvidenceSummary) ||
      report.final_status !== "COMPLETED" || report.core_join_digest !== join?.core_join_digest ||
      report.final_evidence_digest !== finalEvidenceDigest) {
    reject("closure_final_report_invalid");
  }

  if (!exactObjectKeys(reportReceipt, [
    "receipt_id", "work_id", "adapter", "core_join_digest",
    "final_evidence_digest", "issued_at", "receipt_digest",
  ])) {
    reject("closure_report_receipt_invalid");
  } else {
    const { receipt_digest: reportReceiptDigest, ...unsignedReceipt } = reportReceipt;
    if (!UUID.test(String(reportReceipt.receipt_id || "")) ||
        reportReceipt.work_id !== workId ||
        reportReceipt.adapter !== receipt?.adapter ||
        reportReceipt.core_join_digest !== receipt?.core_join_digest ||
        reportReceipt.final_evidence_digest !== receipt?.final_evidence_digest ||
        reportReceiptDigest !== receipt?.receipt_digest ||
        objectDigest(unsignedReceipt) !== reportReceiptDigest ||
        !Number.isFinite(Date.parse(String(reportReceipt.issued_at || "")))) {
      reject("closure_report_receipt_invalid");
    }
  }

  const event = plainRecord(input.closure_event) ? input.closure_event : null;
  const eventPayload = plainRecord(event?.payload) ? event.payload : null;
  const previousEventHash = event?.previous_event_hash == null ? null : String(event.previous_event_hash);
  const eventEnvelope = event && eventPayload ? {
    tenant_id: event.tenant_id,
    work_id: event.work_id,
    sequence_number: Number(event.sequence_number),
    event_type: event.event_type,
    payload: stable(eventPayload),
    previous_event_hash: previousEventHash,
  } : null;
  if (!event || event.tenant_id !== tenantId || event.work_id !== workId ||
      event.event_type !== "generic_closure_finalized" ||
      !Number.isSafeInteger(Number(event.sequence_number)) || Number(event.sequence_number) < 1 ||
      !(previousEventHash === null || HASH.test(previousEventHash)) ||
      !HASH.test(String(event.event_hash || "")) ||
      !eventEnvelope || objectDigest(eventEnvelope) !== event.event_hash ||
      !exactObjectKeys(eventPayload, CLOSURE_EVENT_PAYLOAD_FIELDS) ||
      eventPayload.adapter !== receipt?.adapter || eventPayload.archived !== true ||
      eventPayload.closure_receipt_digest !== receipt?.receipt_digest ||
      eventPayload.core_join_digest !== join?.core_join_digest ||
      eventPayload.final_evidence_digest !== finalEvidenceDigest ||
      eventPayload.report_digest !== reportDigest) {
    reject("closure_event_unverified");
  }

  const verified = failureCodes.length === 0;
  const projection = {
    schema_version: CLOSURE_VERIFICATION_SCHEMA_VERSION,
    verified,
    tenant_id: tenantId,
    work_id: workId,
    status,
    receipt_digest: verified ? receipt.receipt_digest : null,
    report_digest: verified ? reportDigest : null,
    core_join_digest: verified ? join.core_join_digest : null,
    final_evidence_digest: verified ? finalEvidenceDigest : null,
    closure_event_hash: verified ? event.event_hash : null,
    failure_codes: failureCodes,
  };
  return Object.freeze({
    ...projection,
    failure_codes: Object.freeze([...failureCodes]),
    verification_digest: objectDigest(projection),
  });
}

function parseGenericWorkCoreJoinPublicKey(value) {
  let material = value;
  if (typeof material === "string") {
    const textValue = material.trim();
    if (/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----$/.test(textValue)) {
      material = textValue;
    } else {
      try { material = JSON.parse(textValue); } catch { fail("generic_work_core_join_verifier_unavailable"); }
    }
  }
  try {
    let key;
    if (typeof material === "string") {
      key = crypto.createPublicKey(material);
    } else {
      if (!plainRecord(material)) fail("generic_work_core_join_verifier_unavailable");
      const fields = Object.keys(material);
      if (!fields.includes("crv") || !fields.includes("kty") || !fields.includes("x") ||
          fields.some((field) => !["alg", "crv", "kid", "kty", "use", "x"].includes(field)) ||
          material.kty !== "OKP" || material.crv !== "Ed25519" ||
          (material.alg !== undefined && material.alg !== "EdDSA") ||
          (material.use !== undefined && material.use !== "sig") ||
          (material.kid !== undefined && !GENERIC_WORK_CORE_JOIN_KEY_ID.test(material.kid)) ||
          typeof material.x !== "string" || material.x.length !== 43 ||
          !GENERIC_WORK_CORE_JOIN_BASE64URL.test(material.x)) {
        fail("generic_work_core_join_verifier_unavailable");
      }
      const publicBytes = Buffer.from(material.x, "base64url");
      if (publicBytes.byteLength !== 32 || publicBytes.toString("base64url") !== material.x) {
        fail("generic_work_core_join_verifier_unavailable");
      }
      key = crypto.createPublicKey({ key: material, format: "jwk" });
    }
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      fail("generic_work_core_join_verifier_unavailable");
    }
    return key;
  } catch {
    fail("generic_work_core_join_verifier_unavailable");
  }
}

function decodeGenericWorkCoreJoinSignature(value) {
  if (typeof value !== "string" || value.length !== 86 ||
      !GENERIC_WORK_CORE_JOIN_BASE64URL.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.byteLength === 64 && bytes.toString("base64url") === value ? bytes : null;
}

function validGenericWorkCoreJoinTimestamp(value) {
  if (typeof value !== "string" || !GENERIC_WORK_CORE_JOIN_ISO_TIMESTAMP.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function genericWorkCoreJoinExpectedValid(expected) {
  return exactObjectKeys(expected, ["adapter", "idempotency_digest", "tenant_id", "work_id"]) &&
    GENERIC_WORK_CORE_JOIN_ID.test(expected.tenant_id) &&
    GENERIC_WORK_CORE_JOIN_ID.test(expected.work_id) &&
    CLOSURE_ADAPTERS.includes(expected.adapter) && HASH.test(expected.idempotency_digest);
}

export function createGenericWorkCoreJoinVerifier({ publicKey, keyId } = {}) {
  if (typeof keyId !== "string" || !GENERIC_WORK_CORE_JOIN_KEY_ID.test(keyId)) {
    fail("generic_work_core_join_verifier_unavailable");
  }
  const keyMaterial = typeof publicKey === "string" && !publicKey.trim()
    ? null
    : publicKey;
  const key = parseGenericWorkCoreJoinPublicKey(keyMaterial);
  if (plainRecord(keyMaterial) && keyMaterial.kid !== undefined && keyMaterial.kid !== keyId) {
    fail("generic_work_core_join_verifier_unavailable");
  }
  if (typeof keyMaterial === "string" && !keyMaterial.trim().startsWith("-----BEGIN PUBLIC KEY-----")) {
    let jwk;
    try { jwk = JSON.parse(keyMaterial); } catch { jwk = null; }
    if (plainRecord(jwk) && jwk.kid !== undefined && jwk.kid !== keyId) {
      fail("generic_work_core_join_verifier_unavailable");
    }
  }
  const metadata = Object.freeze({
    key_id: keyId,
    public_key_fingerprint: crypto.createHash("sha256")
      .update(key.export({ type: "spki", format: "der" }))
      .digest("hex"),
  });
  const verify = (verdict, expected) => {
    if (!exactObjectKeys(verdict, GENERIC_WORK_CORE_JOIN_VERDICT_FIELDS) ||
        verdict.schema_version !== GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION ||
        verdict.authority !== "universal_core" ||
        verdict.decision !== "GENERIC_WORK_CORE_JOIN_ELIGIBLE" ||
        verdict.execution_authorized !== false || verdict.host_action_authorized !== false ||
        verdict.signature_algorithm !== "ed25519" || verdict.key_id !== keyId ||
        !GENERIC_WORK_CORE_JOIN_ID.test(verdict.tenant_id) ||
        !GENERIC_WORK_CORE_JOIN_ID.test(verdict.work_id) ||
        !GENERIC_WORK_CORE_JOIN_ID.test(verdict.verdict_id) ||
        !GENERIC_WORK_CORE_JOIN_ID.test(verdict.key_id) ||
        !CLOSURE_ADAPTERS.includes(verdict.adapter) ||
        !validGenericWorkCoreJoinTimestamp(verdict.issued_at)) return false;
    for (const field of ["acceptance_criteria_digest", "task_state_digest", "evidence_digest",
      "independent_verifier_receipt_digest", "idempotency_digest", "verdict_digest"]) {
      if (!HASH.test(verdict[field])) return false;
    }
    const signatureBytes = decodeGenericWorkCoreJoinSignature(verdict.signature);
    if (!signatureBytes) return false;
    const { signature: _signature, verdict_digest: verdictDigest, ...unsigned } = verdict;
    if (objectDigest(unsigned) !== verdictDigest) return false;
    if (expected !== undefined) {
      if (!genericWorkCoreJoinExpectedValid(expected)) return false;
      for (const field of ["tenant_id", "work_id", "adapter", "idempotency_digest"]) {
        if (verdict[field] !== expected[field]) return false;
      }
    }
    try {
      return crypto.verify(
        null,
        Buffer.from(`${GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION}\0${verdictDigest}`, "utf8"),
        key,
        signatureBytes,
      );
    } catch { return false; }
  };
  return Object.freeze({
    schema_version: GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION,
    algorithm: "Ed25519",
    ...metadata,
    metadata,
    verify,
  });
}
function deterministicWorkId(tenantId, reviewId, requestDigest) {
  const bytes = crypto.createHash("sha256")
    .update(`tenant-work-v2\0${tenantId}\0${reviewId}\0${requestDigest}`)
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function canonicalCreateRequest(input = {}) {
  const source = input.create_request && typeof input.create_request === "object" && !Array.isArray(input.create_request)
    ? input.create_request : input;
  const tasks = Array.isArray(source.tasks) ? source.tasks.map((task) => ({
    task_id: String(task?.task_id || "").trim() || null,
    title: String(task?.title || "").trim(),
    weight: Math.max(1, Number(task?.weight) || 1),
    required: task?.required !== false,
  })) : [];
  return stable({
    intent_type: "CREATE_WORK",
    request_id: String(source.request_id || source.session_id || "").trim(),
    work_id: String(source.work_id || "").trim() || null,
    project_id: String(source.project_id || "").trim(),
    session_id: String(source.session_id || "").trim(),
    initial_message: String(source.initial_message || "").trim() || null,
    work_name: String(source.work_name || "").trim(),
    work_type: String(source.work_type || "").trim(),
    idea: String(source.idea || "").trim() || null,
    objective: String(source.objective || "").trim(),
    architecture: source.architecture && typeof source.architecture === "object"
      ? source.architecture : null,
    next_action: String(source.next_action || "").trim(),
    intent_digest: String(source.intent_digest || "").trim() || null,
    parent_work_id: String(source.parent_work_id || "").trim() || null,
    team_id: String(source.team_id || "").trim() || null,
    visibility_scope: String(source.visibility_scope || "private").trim(),
    acceptance_criteria: Array.isArray(source.acceptance_criteria)
      ? source.acceptance_criteria.map((item) => String(item || "").trim()) : [],
    constraints: Array.isArray(source.constraints)
      ? source.constraints.map((item) => String(item || "").trim()) : [],
    assigned_user_ids: Array.isArray(source.assigned_user_ids) ? [...source.assigned_user_ids].map(String).sort() : [],
    supervising_user_ids: Array.isArray(source.supervising_user_ids) ? [...source.supervising_user_ids].map(String).sort() : [],
    host_type: String(source.host_type || "").trim() || null,
    client_type: String(source.client_type || "").trim() || null,
    agent_id: String(source.agent_id || "").trim() || null,
    resume_existing: source.resume_existing === true,
    tasks,
  });
}
function createRequestDigest(input) {
  return objectDigest(canonicalCreateRequest(input));
}
function normalizeUniversalCoreActionReceipt(value, tenantId) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactObjectKeys(value, [
    "schema_version", "authority", "authorization_id", "tenant_id", "action_type",
    "idempotency_key_digest", "request_digest", "response_digest", "issued_at",
    "expires_at", "receipt_digest",
  ])) fail("work_bootstrap_core_authorization_receipt_invalid");
  const issuedAt = Date.parse(String(value.issued_at || ""));
  const expiresAt = Date.parse(String(value.expires_at || ""));
  if (value.schema_version !== "core_action_authorization_receipt_v1" ||
      value.authority !== "universal_core" || value.tenant_id !== tenantId ||
      value.action_type !== "work.continuity.v2.create" ||
      !/^cae_[a-f0-9]{40}$/.test(String(value.authorization_id || "")) ||
      !HASH.test(String(value.idempotency_key_digest || "")) ||
      !HASH.test(String(value.request_digest || "")) ||
      !HASH.test(String(value.response_digest || "")) ||
      !HASH.test(String(value.receipt_digest || "")) ||
      !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt >= expiresAt) {
    fail("work_bootstrap_core_authorization_receipt_invalid");
  }
  const { receipt_digest, ...material } = value;
  if (objectDigest(material) !== receipt_digest) {
    fail("work_bootstrap_core_authorization_receipt_invalid");
  }
  return stable(value);
}

function normalizeCoreAuthorizationReceipt(value, tenantId) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("work_bootstrap_core_authorization_receipt_invalid");
  }
  const v2 = value.schema_version === "work_bootstrap_core_authorization_receipt_v2";
  if (!exactObjectKeys(value, [
    "schema_version", "authority", "route", "target", "decision_id", "decision",
    "mediation", "owner_confirmation_required", "confirmation_satisfied", "receipt_digest",
    ...(v2 ? ["core_authorization_receipt"] : []),
  ])) fail("work_bootstrap_core_authorization_receipt_invalid");
  if (!v2 && value.schema_version !== "work_bootstrap_core_authorization_receipt_v1") {
    fail("work_bootstrap_core_authorization_receipt_invalid");
  }
  if (
      value.authority !== "universal_core" || value.route !== "/v1/action-evaluator" ||
      !/^work_bootstrap:create:[a-z][a-z0-9_-]{1,63}:[a-z][a-z0-9_]{1,62}_native:[a-f0-9]{64}$/.test(String(value.target || "")) ||
      !HASH.test(String(value.receipt_digest || "")) ||
      typeof value.owner_confirmation_required !== "boolean" ||
      typeof value.confirmation_satisfied !== "boolean" ||
      String(value.decision || "").length < 1 || String(value.decision || "").length > 80 ||
      String(value.mediation || "").length < 1 || String(value.mediation || "").length > 80 ||
      (value.decision_id !== null && (typeof value.decision_id !== "string" ||
        value.decision_id.length < 1 || value.decision_id.length > 240))) {
    fail("work_bootstrap_core_authorization_receipt_invalid");
  }
  if (v2) {
    const coreReceipt = normalizeUniversalCoreActionReceipt(
      value.core_authorization_receipt,
      tenantId,
    );
    if (value.decision_id !== coreReceipt.authorization_id) {
      fail("work_bootstrap_core_authorization_receipt_invalid");
    }
  }
  const { receipt_digest, ...material } = value;
  if (objectDigest(material) !== receipt_digest) {
    fail("work_bootstrap_core_authorization_receipt_invalid");
  }
  return stable(value);
}

async function requireCurrentCoreAuthorizationReceipt(client, receipt) {
  if (receipt?.schema_version !== "work_bootstrap_core_authorization_receipt_v2") return;
  const expiresAt = receipt.core_authorization_receipt?.expires_at;
  const clock = await client.query(`SELECT checked_at,
      checked_at < $1::timestamptz AS authorization_current
    FROM (SELECT clock_timestamp() AS checked_at) authority_clock`, [expiresAt]);
  const row = clock.rows?.[0];
  if (!row || row.authorization_current !== true) {
    fail("work_bootstrap_core_authorization_receipt_expired");
  }
}
export function deriveAuthenticatedTenantWorkAcl(identity = {}, now = Date.now()) {
  const binding = identity.authenticatedTenantMembership;
  if (!binding || typeof binding !== "object" || Array.isArray(binding) ||
      binding.schema_version !== "tenant_membership_binding_v1" || binding.authenticated !== true) {
    fail("tenant_work_membership_binding_required");
  }
  const tenantId = text(identity.tenantId || identity.tenant_id, "tenant_identity_required", 64);
  const subject = text(identity.subject, "work_actor_identity_required", 128);
  if (text(binding.tenant_id, "tenant_work_membership_binding_invalid", 64) !== tenantId ||
      text(binding.subject, "tenant_work_membership_binding_invalid", 128) !== subject) {
    fail("tenant_work_membership_binding_scope_mismatch");
  }
  const expiresAt = Date.parse(String(binding.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) fail("tenant_work_membership_binding_expired");
  const role = String(binding.role || "");
  if (!["member", "team_manager", "tenant_owner", "super_admin"].includes(role)) {
    fail("tenant_work_membership_role_invalid");
  }
  const teamIds = stringArray(binding.team_ids, "tenant_work_membership_binding_invalid");
  const managedTeamIds = stringArray(binding.managed_team_ids, "tenant_work_membership_binding_invalid");
  if (role === "team_manager" && !managedTeamIds.length) fail("tenant_work_membership_manager_scope_required");
  return Object.freeze({
    server_derived: true,
    version: "tenant_work_acl_v1",
    tenant_id: tenantId,
    user_id: subject,
    role,
    team_ids: teamIds,
    managed_team_ids: managedTeamIds,
    assigned_work_ids: stringArray(binding.assigned_work_ids, "tenant_work_membership_binding_invalid"),
    is_tenant_owner: role === "tenant_owner" || role === "super_admin",
    is_super_admin: role === "super_admin",
    expires_at: new Date(expiresAt).toISOString(),
  });
}
function actorFromIdentity(identity = {}) {
  const acl = identity.tenant_work_acl;
  if (!acl || typeof acl !== "object" || Array.isArray(acl) || acl.server_derived !== true) {
    fail("work_server_acl_required");
  }
  const userId = String(identity.userId || identity.user_id || identity.subject || "").trim();
  if (!userId) fail("work_actor_identity_required");
  if (String(acl.user_id || "") !== userId) fail("work_server_acl_subject_mismatch");
  const tenantId = text(identity.tenantId || identity.tenant_id, "tenant_identity_required", 64);
  if (String(acl.tenant_id || "") !== tenantId) fail("work_server_acl_tenant_mismatch");
  const presence = identity.agentPresence;
  const agentId = String(presence?.agent_id || identity.agentId || "").trim() || null;
  const teamIds = acl.team_ids || [];
  const managedTeamIds = acl.managed_team_ids || [];
  if (!Array.isArray(teamIds) || teamIds.some((item) => !String(item || "").trim())) fail("work_actor_team_identity_invalid");
  if (!Array.isArray(managedTeamIds) || managedTeamIds.some((item) => !String(item || "").trim())) fail("work_actor_team_identity_invalid");
  // Native reports persist the transport-bound fingerprint.  Selecting the
  // ordinary session fingerprint here made a valid independent verifier
  // invisible to V2 evidence promotion.  Never fall back when a claimed
  // native transport binding is incomplete: that would turn a server-bound
  // identity requirement into caller-controlled data.
  const sessionFingerprint = String(
    presence?.transport_bound === true
      ? presence?.host_transport_session_fingerprint || ""
      : presence?.session_fingerprint || "",
  ).trim() || null;
  const clientType = String(presence?.client_type || "").trim() || null;
  return {
    tenant_id: tenantId,
    user_id: userId,
    agent_id: agentId,
    // Preserve the legacy actor shape when a host type is absent. Assignment
    // acceptance still fails closed below unless a transport-bound client type
    // is actually present.
    ...(clientType ? { client_type: clientType } : {}),
    session_fingerprint: sessionFingerprint,
    team_ids: [...new Set(teamIds.map((item) => String(item).trim()))],
    managed_team_ids: [...new Set(managedTeamIds.map((item) => String(item).trim()))],
    is_tenant_owner: acl.is_tenant_owner === true,
    is_super_admin: acl.is_super_admin === true,
    core_join_trusted: identity.coreJoinTrusted === true,
  };
}
function isAdmin(actor) {
  return actor.is_super_admin || actor.is_tenant_owner;
}
function sameTenant(work, actor) {
  return Boolean(actor?.tenant_id) && String(work?.tenant_id || "") === actor.tenant_id;
}
function isNamedPrincipal(work, actor) {
  const namedUser = [work.owner_user_id, work.created_by_user_id]
    .concat(work.assigned_user_ids || [], work.supervising_user_ids || [])
    .filter(Boolean).includes(actor.user_id);
  // `agent_ids` records historical participation as well as the current
  // assignment.  Only the exact, actively accepted assignment grants an
  // agent access to a private Work; archive, reopen, and reassignment all
  // invalidate that grant without widening owner or creator access.
  const acceptedAssignment = Boolean(
    actor.agent_id &&
    work.assignment_status === "ACCEPTED" &&
    work.assignment_target_agent_id === actor.agent_id &&
    (work.agent_ids || []).includes(actor.agent_id),
  );
  return namedUser || acceptedAssignment;
}
export function canRead(work, actor) {
  if (!sameTenant(work, actor)) return false;
  if (isAdmin(actor)) return true;
  if (work.visibility_scope === "tenant" || work.visibility_scope === "shared") return true;
  if (work.visibility_scope === "team" && work.team_id &&
      (actor.team_ids.includes(work.team_id) || actor.managed_team_ids.includes(work.team_id))) return true;
  return isNamedPrincipal(work, actor);
}
export function canRecordTask(work, actor) {
  return sameTenant(work, actor) && (isAdmin(actor) || work.owner_user_id === actor.user_id ||
    (work.assigned_user_ids || []).includes(actor.user_id));
}
export function canContributeEvidence(work, actor) {
  return sameTenant(work, actor) && (canRecordTask(work, actor) || (work.supervising_user_ids || []).includes(actor.user_id));
}
export function canClose(work, actor) {
  return sameTenant(work, actor) && (isAdmin(actor) || work.owner_user_id === actor.user_id ||
    (work.supervising_user_ids || []).includes(actor.user_id));
}
export function canAdminister(work, actor) {
  return sameTenant(work, actor) && (isAdmin(actor) || work.owner_user_id === actor.user_id);
}
function assertPermission(predicate, work, actor) {
  if (!predicate(work, actor)) fail("work_acl_denied");
}
function normalizeWork(row) {
  return {
    ...row,
    assigned_user_ids: Array.isArray(row.assigned_user_ids) ? row.assigned_user_ids : [],
    supervising_user_ids: Array.isArray(row.supervising_user_ids) ? row.supervising_user_ids : [],
    agent_ids: Array.isArray(row.agent_ids) ? row.agent_ids : [],
  };
}
function mapLegacyStatus(status) {
  const value = String(status || "active").toLowerCase();
  if (value === "active") return "ACTIVE";
  if (value === "verified") return "ACTIVE";
  if (value === "completed") return "COMPLETED";
  if (value === "cancelled") return "CANCELLED";
  if (value === "superseded") return "SUPERSEDED";
  if (value === "blocked" || value === "failed") return "BLOCKED";
  if (value === "release_ready") return "HANDOFF";
  return null;
}
function mapV2StatusToLegacy(status) {
  if (["PLANNED", "ACTIVE", "PAUSED"].includes(status)) return "active";
  if (status === "BLOCKED") return "blocked";
  if (status === "HANDOFF") return "release_ready";
  if (["COMPLETED", "ARCHIVED"].includes(status)) return "completed";
  if (status === "CANCELLED") return "cancelled";
  if (status === "SUPERSEDED") return "superseded";
  return "blocked";
}

const LEGACY_TERMINAL_PROJECTION_EVENTS = Object.freeze({
  COMPLETED: new Set(["closure_finalized", "generic_closure_finalized"]),
  CANCELLED: new Set(["legacy_work_reconciled_closed"]),
  SUPERSEDED: new Set(["legacy_work_reconciled_closed"]),
});

function legacyProjectionEvent(row, suppliedEvent = null) {
  const event = suppliedEvent || {
    sequence_number: row?.source_sequence_number,
    event_type: row?.source_event_type,
    event_hash: row?.source_event_hash,
    payload: row?.source_event_payload,
  };
  const sequence = Number(event?.sequence_number || 0);
  const eventHash = String(event?.event_hash || "").trim().toLowerCase();
  const eventType = String(event?.event_type || "").trim();
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !HASH.test(eventHash) || !eventType) return null;
  return { sequence_number: sequence, event_type: eventType, event_hash: eventHash,
    payload: plainRecord(event?.payload) ? stable(event.payload) : {} };
}

function terminalLegacyProjectionVerified(projectedStatus, event, row = null) {
  const allowed = LEGACY_TERMINAL_PROJECTION_EVENTS[projectedStatus];
  if (!allowed) return true;
  const evidence = event && allowed.has(event.event_type) ? event : legacyProjectionEvent({
    source_sequence_number: row?.terminal_sequence_number,
    source_event_type: row?.terminal_event_type,
    source_event_hash: row?.terminal_event_hash,
    source_event_payload: row?.terminal_event_payload,
  });
  if (!evidence || !allowed.has(evidence.event_type)) return false;
  if (evidence.event_type !== "legacy_work_reconciled_closed") return true;
  return String(evidence.payload?.status || "").toUpperCase() === projectedStatus;
}

export function verifyGenericCoreJoinVerdict(verdict, { publicKey, keyId, expected } = {}) {
  try {
    return createGenericWorkCoreJoinVerifier({ publicKey, keyId }).verify(verdict, expected);
  } catch { return false; }
}

function genericWorkCoreJoinMcpError(code, status, retryable = false) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  return error;
}

export function createGenericWorkCoreJoinMcpCoordinator({
  enabled = false,
  store,
  readiness = {},
  issueCore,
} = {}) {
  const currentReadiness = () => typeof readiness === "function" ? readiness() || {} : readiness || {};
  return async ({ args = {}, identity = {}, aclIdentity } = {}) => {
    if (enabled !== true) {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_disabled", 503);
    }
    if (!store || typeof store.buildGenericCoreJoinRequest !== "function" ||
        typeof store.verifyCoreJoinVerdict !== "function" ||
        typeof store.persistCoreJoin !== "function") {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_store_unavailable", 503, true);
    }
    const state = currentReadiness();
    if (state.initializationFailed === true) {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_store_unavailable", 503, true);
    }
    if (state.initialized !== true) {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_store_initializing", 503, true);
    }
    if (!store.coreJoinVerifierMetadata ||
        !GENERIC_WORK_CORE_JOIN_KEY_ID.test(String(store.coreJoinVerifierMetadata.key_id || "")) ||
        !HASH.test(String(store.coreJoinVerifierMetadata.public_key_fingerprint || ""))) {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_verifier_unavailable", 503, true);
    }
    if (typeof issueCore !== "function") {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_upstream_unavailable", 503, true);
    }
    const request = await store.buildGenericCoreJoinRequest(aclIdentity, args);
    const expected = {
      tenant_id: String(identity.tenantId || ""),
      work_id: request?.work_id,
      adapter: request?.adapter,
      idempotency_digest: request?.idempotency_digest,
    };
    if (!genericWorkCoreJoinExpectedValid(expected) || request?.tenant_id !== expected.tenant_id) {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_local_request_invalid", 503, true);
    }
    const response = await issueCore(request, identity);
    const verdict = response?.structuredContent?.generic_core_join_verdict;
    if (response?.structuredContent?.dedicated_core_gate?.authorized !== true || !verdict) {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_response_invalid", 502, true);
    }
    if (!store.verifyCoreJoinVerdict(verdict, expected)) {
      throw genericWorkCoreJoinMcpError("generic_work_core_join_signature_invalid", 502, true);
    }
    const result = await store.persistCoreJoin({ ...aclIdentity, coreJoinTrusted: true }, {
      work_id: expected.work_id,
      core_join_digest: verdict.verdict_digest,
      core_join_context: verdict,
    });
    return Object.freeze({ request, verdict, result });
  };
}

export function createWorkContinuityV2Store({
  pool,
  now = () => new Date(),
  verifierReceiptSigningSecret = "",
  coreJoinVerifier = null,
  legacyRuntime = null,
  failureInjector = null,
} = {}) {
  if (!pool || typeof pool.query !== "function") fail("work_v2_pool_required");
  const resolvedCoreJoinVerifier = coreJoinVerifier && typeof coreJoinVerifier.verify === "function"
    ? coreJoinVerifier
    : coreJoinVerifier
      ? createGenericWorkCoreJoinVerifier(coreJoinVerifier)
      : null;
  let ready;
  const initialize = () => ready ||= pool.query(ADDITIVE_SCHEMA_SQL);
  const query = (...args) => pool.query(...args);
  async function transaction(fn) {
    const client = typeof pool.connect === "function" ? await pool.connect() : pool;
    const transactional = client !== pool;
    try {
      if (transactional) await client.query("BEGIN");
      const result = await fn(client);
      if (transactional) await client.query("COMMIT");
      return result;
    } catch (error) {
      if (transactional) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release?.(); }
  }
  async function injectFailure(phase, context) {
    if (typeof failureInjector === "function") await failureInjector(phase, context);
  }
  async function loadWork(client, actor, workId, lock = false) {
    const result = await client.query(`SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2${lock ? " FOR UPDATE" : ""}`,
      [actor.tenant_id, uuid(workId)]);
    const work = result.rows[0] && normalizeWork(result.rows[0]);
    if (!work) fail("tenant_work_not_found");
    return work;
  }
  async function allocateCode(client, actor, projectId) {
    const project = projectCode(projectId);
    const allocated = await client.query(`INSERT INTO tenant_work_code_sequence
      (tenant_id,project_id,code_date,next_sequence)
      VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date,1)
      ON CONFLICT (tenant_id,project_id,code_date) DO UPDATE
      SET next_sequence=tenant_work_code_sequence.next_sequence+1,updated_at=now()
      RETURNING to_char(code_date,'YYYYMMDD') AS day,next_sequence AS sequence`,
    [actor.tenant_id, project]);
    const day = String(allocated.rows[0]?.day || "");
    const sequence = Number(allocated.rows[0]?.sequence || 0);
    if (!/^\d{8}$/.test(day) || sequence < 1) fail("work_code_allocation_failed");
    return `${project}-${day}-${String(sequence).padStart(4, "0")}`;
  }
  async function appendV2Event(client, actor, workId, eventType, payload = {}) {
    const previous = await client.query(`SELECT sequence_number,event_hash FROM tenant_work_event
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
    [actor.tenant_id, workId]);
    const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
    const event = { tenant_id: actor.tenant_id, work_id: workId, sequence_number: sequence,
      event_type: eventType, payload: stable(payload), previous_event_hash: previous.rows[0]?.event_hash || null };
    const eventHash = objectDigest(event);
    await client.query(`INSERT INTO tenant_work_event
      (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [actor.tenant_id, workId, crypto.randomUUID(),
      sequence, eventType, JSON.stringify(event.payload), event.previous_event_hash, eventHash, actor.user_id]);
    return { sequence_number: sequence, event_type: eventType, event_hash: eventHash };
  }
  function archiveRequestDigest(actor, workId, reason) {
    return objectDigest({
      schema_version: "tenant_work_gallery_archive_request_v1",
      tenant_id: actor.tenant_id,
      work_id: workId,
      reason,
    });
  }
  function archiveIdempotencyKeyDigest(actor, workId, idempotencyKey) {
    return objectDigest({
      schema_version: "tenant_work_gallery_archive_idempotency_v1",
      tenant_id: actor.tenant_id,
      work_id: workId,
      idempotency_key: idempotencyKey,
    });
  }
  function archiveReplayOutcome(row, {
    tenantId,
    workId,
    reason,
    requestDigest,
    idempotencyKeyDigest,
  }) {
    const payload = row?.payload;
    const material = {
      tenant_id: row?.tenant_id,
      work_id: row?.work_id,
      sequence_number: Number(row?.sequence_number),
      event_type: row?.event_type,
      payload: stable(payload),
      previous_event_hash: row?.previous_event_hash || null,
    };
    if (!plainRecord(payload) ||
        payload.schema_version !== "tenant_work_gallery_archive_event_v1" ||
        !plainRecord(payload.work) ||
        !Number.isSafeInteger(Number(row?.sequence_number)) ||
        row?.event_type !== "work_archived_v3" ||
        objectDigest(material) !== row?.event_hash) {
      fail("work_archive_replay_evidence_invalid");
    }
    if (payload.request_digest !== requestDigest ||
        payload.idempotency_key_digest !== idempotencyKeyDigest ||
        payload.reason !== reason) {
      fail("work_archive_idempotency_conflict");
    }
    if (payload.work.tenant_id !== tenantId || payload.work.work_id !== workId ||
        payload.work.status !== "ARCHIVED" || payload.work.archived_reason !== reason) {
      fail("work_archive_replay_evidence_invalid");
    }
    if (!Number.isSafeInteger(Number(payload.released_lease_count)) ||
        Number(payload.released_lease_count) < 0) {
      fail("work_archive_replay_evidence_invalid");
    }
    return {
      schema_version: "tenant_work_gallery_v3",
      work: normalizeWork(payload.work),
      released_lease_count: Number(payload.released_lease_count),
      event: {
        sequence_number: Number(row.sequence_number),
        event_type: row.event_type,
        event_hash: row.event_hash,
      },
      idempotent_replay: true,
    };
  }
  async function derivePersistedPriorityFacts(client, actor, work) {
    const relations = await client.query(`SELECT
        count(*) FILTER (WHERE parent_work_id=$2 AND status = ANY($3))::int AS dependent_work_count,
        count(*) FILTER (WHERE work_id=$4 AND status = ANY($3))::int AS blocking_dependencies
      FROM tenant_work WHERE tenant_id=$1`, [actor.tenant_id, work.work_id, [...OPERATIONAL_STATUSES], work.parent_work_id]);
    const ageSeconds = Math.max(0, Math.floor((now().getTime() - new Date(work.updated_at || now()).getTime()) / 1000));
    return {
      dependent_work_count: Number(relations.rows[0]?.dependent_work_count || 0),
      blocking_dependencies: Number(relations.rows[0]?.blocking_dependencies || 0),
      stale_duration: Math.min(100, Math.floor(ageSeconds / 86_400)),
      near_closure_state: Math.min(100, Math.floor(Number(work.progress_bp || 0) / 100)),
    };
  }
  async function createWorkWithClient(client, actor, input = {}, {
    legacyWorkId = null,
    promoteLegacyProjection = false,
    initialStatus = "ACTIVE",
  } = {}) {
    if (!["PLANNED", "ACTIVE"].includes(initialStatus)) fail("work_initial_status_invalid");
    const workId = input.work_id ? uuid(input.work_id) : crypto.randomUUID();
    const projectId = text(input.project_id, "project_id_invalid", 128);
    const workName = text(input.work_name, "work_name_invalid", 1_000);
    const workType = text(input.work_type, "work_type_invalid", 80);
    const idea = text(input.idea, "work_idea_invalid", 8_000);
    if (!plainRecord(input.architecture)) fail("work_architecture_invalid");
    const architecture = stable(input.architecture);
    const visibilityScope = ["private", "shared", "team", "tenant"].includes(input.visibility_scope) ? input.visibility_scope : "private";
    if (visibilityScope === "team" && !text(input.team_id, "team_id_required", 128)) fail("team_id_required");
    const priorityFacts = { dependent_work_count: 0, blocking_dependencies: 0, stale_duration: 0, near_closure_state: 0 };
    const priority = derivePriority(priorityFacts);
    const { acceptanceCriteria } = workBootstrapTextCollections(input);
    // Constraints remain owned by the immutable legacy Intent Anchor rather
    // than duplicated in tenant_work, but V2 still enforces the exact shared
    // bootstrap boundary before coordinating either representation.
    const assignedUserIds = stringArray(input.assigned_user_ids, "assigned_user_ids_invalid");
    const supervisingUserIds = stringArray(input.supervising_user_ids, "supervising_user_ids_invalid");
    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    if (!tasks.length || tasks.length > 250) fail("work_tasks_required");
    const insertTasks = async () => {
      for (const task of tasks) {
        await client.query(`INSERT INTO tenant_work_task
          (tenant_id,task_id,work_id,title,weight,status,required,acceptance_verified)
          VALUES ($1,$2,$3,$4,$5,'planned',$6,false)`, [actor.tenant_id,
          task.task_id ? uuid(task.task_id, "task_id_invalid") : crypto.randomUUID(), workId,
          text(task.title, "task_title_invalid", 2_000), Math.max(1, Number(task.weight) || 1), task.required !== false]);
      }
    };
    const existing = await client.query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    if (existing.rows[0]) {
      const row = normalizeWork(existing.rows[0]);
      if (legacyWorkId && row.legacy_work_id !== legacyWorkId) fail("tenant_work_legacy_link_conflict");
      // The compatibility bridge can project the just-created legacy work in a
      // concurrent transaction. Promote only that bridge-owned projection: a
      // genuine V2 identity remains immutable and exact retries stay no-ops.
      const canPromoteLegacyProjection = promoteLegacyProjection === true &&
        legacyWorkId && row.legacy_work_id === legacyWorkId && row.work_type === "legacy";
      if (canPromoteLegacyProjection) {
        await client.query(`UPDATE tenant_work SET
          work_name=$3,work_type=$4,project_id=$5,owner_user_id=$6,created_by_user_id=$6,team_id=$7,
          assigned_user_ids=$8::jsonb,supervising_user_ids=$9::jsonb,agent_ids=$10::jsonb,visibility_scope=$11,
          priority=$12,priority_score=$13,priority_version=$14,priority_context=$15::jsonb,intent_digest=$16,
          objective=$17,next_action=$18,created_by_agent_id=$19,created_by_session_fingerprint=$20,
          acceptance_criteria=$21::jsonb,idea=$22,architecture=$23::jsonb,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, workId,
          workName, workType, projectId, actor.user_id, input.team_id || null,
          JSON.stringify(assignedUserIds), JSON.stringify(supervisingUserIds), JSON.stringify(actor.agent_id ? [actor.agent_id] : []), visibilityScope,
          priority.priority, priority.priority_score, priority.priority_version, JSON.stringify(priorityFacts),
          input.intent_digest ? digest(input.intent_digest, "intent_digest_invalid") : null,
          String(input.objective || "").slice(0, 8_000) || null, String(input.next_action || "").slice(0, 4_000) || null,
          actor.agent_id, actor.session_fingerprint, JSON.stringify(acceptanceCriteria),
          idea, JSON.stringify(architecture)]);
        await insertTasks();
        return { work: await loadWork(client, actor, workId), created: true };
      }
      return { work: row, created: false };
    }
      const workCode = await allocateCode(client, actor, projectId);
      await client.query(`INSERT INTO tenant_work
        (tenant_id,work_id,legacy_work_id,work_code,work_name,work_type,project_id,owner_user_id,created_by_user_id,team_id,
         assigned_user_ids,supervising_user_ids,agent_ids,visibility_scope,started_at,status,priority,priority_score,priority_version,priority_context,intent_digest,objective,next_action,created_by_agent_id,created_by_session_fingerprint,acceptance_criteria,idea,architecture)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,now(),'${initialStatus}',$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$22,$23::jsonb,$24,$25::jsonb)`,
      [actor.tenant_id, workId, legacyWorkId, workCode, workName, workType, projectId, actor.user_id, input.team_id || null,
        JSON.stringify(assignedUserIds), JSON.stringify(supervisingUserIds), JSON.stringify(actor.agent_id ? [actor.agent_id] : []), visibilityScope,
        priority.priority, priority.priority_score, priority.priority_version, JSON.stringify(priorityFacts),
        input.intent_digest ? digest(input.intent_digest, "intent_digest_invalid") : null,
        String(input.objective || "").slice(0, 8_000) || null, String(input.next_action || "").slice(0, 4_000) || null,
        actor.agent_id, actor.session_fingerprint, JSON.stringify(acceptanceCriteria), idea, JSON.stringify(architecture)]);
      await injectFailure("v2_work_created", { tenant_id: actor.tenant_id, work_id: workId });
      await insertTasks();
      await injectFailure("v2_tasks_created", { tenant_id: actor.tenant_id, work_id: workId });
      return { work: await loadWork(client, actor, workId), created: true };
  }
  async function createWork(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    return transaction(async (client) => {
      const created = await createWorkWithClient(client, actor, input, { legacyWorkId: input.legacy_work_id || null });
      if (created.created) await appendV2Event(client, actor, created.work.work_id, "work_v2_created", {
        legacy_work_id: created.work.legacy_work_id || null, request_digest: createRequestDigest(input),
      });
      return created.work;
    });
  }
  async function consumeOpenReviewWithClient(client, actor, input, workId) {
    const reviewId = uuid(input.review_id, "open_work_review_id_required");
    const reviewDigest = digest(input.review_digest, "open_work_review_digest_required");
    const requestDigest = createRequestDigest(input);
    const requestId = text(canonicalCreateRequest(input).request_id,
      "open_work_review_request_id_required", 160);
    // Match openWorkReview's mapping→review lock order. This prevents a
    // concurrent review replay and create replay from deadlocking each other.
    const bindingResult = await client.query(`SELECT * FROM tenant_work_bootstrap_request
      WHERE tenant_id=$1 AND subject_user_id=$2 AND request_id=$3 FOR UPDATE`,
    [actor.tenant_id, actor.user_id, requestId]);
    const binding = bindingResult.rows[0];
    if (!binding || binding.request_digest !== requestDigest || binding.review_id !== reviewId) {
      fail("open_work_review_request_binding_invalid");
    }
    const result = await client.query(`SELECT * FROM tenant_work_open_review
      WHERE tenant_id=$1 AND review_id=$2 FOR UPDATE`, [actor.tenant_id, reviewId]);
    const review = result.rows[0];
    if (!review) fail("open_work_review_not_found");
    if (review.review_digest !== reviewDigest || review.request_digest !== requestDigest ||
        review.subject_user_id !== actor.user_id || review.request_id !== requestId ||
        (review.project_id && review.project_id !== input.project_id) ||
        (review.intent_digest || null) !== (input.intent_digest || null)) fail("open_work_review_binding_mismatch");
    if (binding.consumed_work_id && binding.consumed_work_id !== review.consumed_work_id) {
      fail("open_work_review_request_binding_invalid");
    }
    const requestedDecision = String(input.review_decision || "").trim();
    const effectiveDecision = review.decision_required
      ? requestedDecision : (requestedDecision || "NO_CONFLICT_PROCEED");
    if (review.decision_required) {
      if (!isAdmin(actor)) fail("open_work_review_owner_decision_required");
      if (!["CONTINUE_NEW_WORK", "PARALLEL_VALID"].includes(effectiveDecision)) {
        fail("open_work_review_proceed_decision_required");
      }
    }
    const decisionDigest = objectDigest({ tenant_id: actor.tenant_id, review_id: reviewId,
      review_digest: reviewDigest, request_digest: requestDigest, subject_user_id: actor.user_id,
      decision: effectiveDecision, work_id: workId });
    // A consumed review is a durable request-to-Work identity. Exact replay
    // remains valid after the short review TTL; expiry only limits unconsumed
    // owner decisions and must never mint a replacement Work.
    if (review.consumed_at) {
      if (review.consumed_work_id !== workId || binding.consumed_work_id !== workId ||
          review.decision !== effectiveDecision || review.decision_digest !== decisionDigest) {
        fail("open_work_review_replay_denied");
      }
      return { review, decision: effectiveDecision, decision_digest: decisionDigest, idempotent_replay: true };
    }
    if (Date.parse(review.expires_at) <= now().getTime()) fail("open_work_review_expired");
    // A fresh review must be revalidated while holding the tenant+project
    // bootstrap lock; otherwise two concurrent no-conflict reviews could both
    // create a semantically duplicate Work.
    {
      const currentRows = await client.query(
        "SELECT * FROM tenant_work WHERE tenant_id=$1 AND status = ANY($2)",
        [actor.tenant_id, [...OPERATIONAL_STATUSES]],
      );
      const currentWorks = currentRows.rows.map(normalizeWork);
      const currentProjectWorks = currentWorks.filter((work) => work.project_id === input.project_id);
      const currentResolution = resolveWorkRequest(
        `${String(input.work_name || "")} ${String(input.objective || "")}`.trim(),
        currentProjectWorks,
        actor,
        { project_id: input.project_id, intent_digest: input.intent_digest || null, now: now() },
      );
      const related = currentProjectWorks;
      const currentFlags = {
        significant_overlap:
          currentResolution.classification !== "NO_CONFLICT" || currentResolution.hidden_conflict === true,
        stale: related.some((work) => ["STALE", "ABANDONED", "COMPLETED_BUT_UNCLOSED"]
          .includes(classifyStaleWork(work, now()).classification)),
        priority: related.some((work) => ["P0", "P1"].includes(work.priority)),
        dependency: Boolean(input.parent_work_id && related.some((work) =>
          work.work_id === input.parent_work_id && OPERATIONAL_STATUSES.has(work.status))),
        invisible_conflict: currentResolution.hidden_conflict === true,
      };
      const original = review.review_result && typeof review.review_result === "object"
        ? review.review_result
        : {};
      const originalCandidateIds = new Set(
        (Array.isArray(original.candidates) ? original.candidates : []).map((item) => String(item.work_id || "")),
      );
      // openWorkReview persists only response-eligible candidates: readable
      // by this actor and bound to the requested project. Apply that exact
      // projection during revalidation as well, otherwise an already-reviewed
      // filtered overlap is misclassified as a newly appeared candidate.
      const currentVisibleIds = new Set(currentProjectWorks
        .filter((work) => canRead(work, actor))
        .map((work) => String(work.work_id || "")));
      const newCandidate = currentResolution.candidates.some((item) =>
        currentVisibleIds.has(String(item.work_id || "")) &&
        !originalCandidateIds.has(String(item.work_id || "")));
      const newConflictFlag = Object.entries(currentFlags).some(([name, value]) =>
        value === true && original.conflict_flags?.[name] !== true);
      if (newCandidate || newConflictFlag ||
          (currentFlags.significant_overlap && original.requires_owner_decision !== true)) {
        fail("open_work_review_stale_conflict");
      }
    }
    const consumed = await client.query(`UPDATE tenant_work_open_review SET
        consumed_at=now(),consumed_by_user_id=$3,decision=$4,decision_digest=$5,consumed_work_id=$6
      WHERE tenant_id=$1 AND review_id=$2 AND consumed_at IS NULL
      RETURNING *`, [actor.tenant_id, reviewId, actor.user_id, effectiveDecision, decisionDigest, workId]);
    if (!consumed.rows[0]) fail("open_work_review_replay_denied");
    const consumedBinding = await client.query(`UPDATE tenant_work_bootstrap_request
      SET consumed_work_id=$4,updated_at=now()
      WHERE tenant_id=$1 AND subject_user_id=$2 AND request_id=$3
        AND request_digest=$5 AND review_id=$6 AND consumed_work_id IS NULL
      RETURNING *`, [actor.tenant_id, actor.user_id, requestId, workId, requestDigest, reviewId]);
    if (!consumedBinding.rows[0]) fail("open_work_review_request_binding_invalid");
    return { review: consumed.rows[0], decision: effectiveDecision, decision_digest: decisionDigest, idempotent_replay: false };
  }
  async function createNewWork(identity, input = {}) {
    if (!legacyRuntime || typeof legacyRuntime.ensureWithClient !== "function") fail("legacy_work_transaction_bridge_unavailable");
    await Promise.all([initialize(), legacyRuntime.initialize()]);
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("work_creation_owner_required");
    if (String(input.intent_type || "CREATE_WORK") !== "CREATE_WORK" || input.resume_existing === true) {
      fail("open_work_review_create_intent_required");
    }
    const requestDigest = createRequestDigest(input);
    const coreAuthorizationReceipt = normalizeCoreAuthorizationReceipt(
      input._core_authorization_receipt,
      actor.tenant_id,
    );
    const reviewId = uuid(input.review_id, "open_work_review_id_required");
    const workId = input.work_id ? uuid(input.work_id) : deterministicWorkId(actor.tenant_id, reviewId, requestDigest);
    return transaction(async (client) => {
      const bootstrapLockKey = `tenant_work_bootstrap:${objectDigest({
        schema_version: "tenant_work_bootstrap_lock_v1",
        tenant_id: actor.tenant_id,
        project_id: String(input.project_id || ""),
      })}`;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [bootstrapLockKey],
      );
      // The Core decision can expire while this transaction waits for the
      // project bootstrap lock. PostgreSQL is the transaction authority for
      // time here: application clocks must not be able to extend a receipt.
      await requireCurrentCoreAuthorizationReceipt(client, coreAuthorizationReceipt);
      const review = await consumeOpenReviewWithClient(client, actor, input, workId);
      await injectFailure("review_consumed", { tenant_id: actor.tenant_id, work_id: workId, review_id: reviewId });
      const legacy = await legacyRuntime.ensureWithClient(client, identity, { ...input, work_id: workId }, {
        creationAuthorized: true,
      });
      if (legacy.work_id !== workId) fail("legacy_work_identity_mismatch");
      await injectFailure("legacy_created", { tenant_id: actor.tenant_id, work_id: workId, review_id: reviewId });
      const v2 = await createWorkWithClient(client, actor, {
        ...input,
        work_id: workId,
        intent_digest: input.intent_digest || legacy.intent_digest || null,
      }, { legacyWorkId: workId, promoteLegacyProjection: true });
      if (v2.created) {
        await appendV2Event(client, actor, workId, "open_work_review_consumed", {
          review_id: reviewId, review_digest: review.review.review_digest,
          request_digest: requestDigest, decision: review.decision,
          decision_digest: review.decision_digest,
        });
        await appendV2Event(client, actor, workId, "work_v2_created", {
          legacy_work_id: workId, intent_digest: legacy.intent_digest || input.intent_digest || null,
          legacy_event_hash: legacy.event?.event_hash || null,
          ...(coreAuthorizationReceipt ? {
            core_authorization_receipt: coreAuthorizationReceipt,
          } : {}),
        });
        await injectFailure("v2_events_created", { tenant_id: actor.tenant_id, work_id: workId, review_id: reviewId });
      }
      // Recheck immediately before the transaction returns for COMMIT. If the
      // receipt expired during assembly, every Work/legacy/event mutation is
      // rolled back atomically.
      await requireCurrentCoreAuthorizationReceipt(client, coreAuthorizationReceipt);
      return {
        schema_version: "work_continuity_v2",
        work: v2.work,
        legacy_work_id: workId,
        review: { review_id: reviewId, decision: review.decision, consumed: true },
        // The event ledger owns the creation evidence. A replay may pass a
        // fresh Core decision for the same deterministic request, but that
        // receipt was not persisted as the original creation event.
        core_authorization_receipt: v2.created ? coreAuthorizationReceipt : null,
        idempotent_replay: review.idempotent_replay && !v2.created,
      };
    });
  }
  function legacyBridgeSessionId(workId) {
    return `v2bridge-${objectDigest({ schema_version: "legacy_work_bridge_session_v1", work_id: workId }).slice(0, 48)}`;
  }
  function legacyBridgeInput(work) {
    const workId = uuid(work.work_id);
    if (work.legacy_work_id !== workId) fail("legacy_bridge_identity_mismatch");
    if (!OPERATIONAL_STATUSES.has(work.status)) fail("legacy_bridge_work_not_operational");
    const workName = text(work.work_name, "legacy_bridge_work_name_invalid", 1_000);
    const projectId = text(work.project_id, "legacy_bridge_project_id_invalid", 128);
    const objective = text(work.objective, "legacy_bridge_objective_invalid", 8_000);
    const { acceptanceCriteria } = workBootstrapTextCollections({
      acceptance_criteria: work.acceptance_criteria,
    });
    const architecture = plainRecord(work.architecture) ? stable(work.architecture) : {};
    return {
      // A V2 record does not retain the raw legacy-only prompt or constraints.
      // Reconstruct a new, explicit immutable anchor from retained canonical
      // fields only; never claim that the previous legacy digest was recovered.
      work_id: workId,
      project_id: projectId,
      session_id: legacyBridgeSessionId(workId),
      initial_message: `Canonical V2 Work ${work.work_code || workId} legacy bridge reconstruction`,
      idea: text(work.idea || `Canonical V2 Work: ${workName}`, "legacy_bridge_idea_invalid", 8_000),
      objective,
      acceptance_criteria: acceptanceCriteria,
      constraints: ["The legacy continuity row was absent; this bridge uses only retained canonical V2 fields."],
      architecture,
      next_action: String(work.next_action || "Reconcile the canonical legacy bridge").slice(0, 4_000),
      client_type: "canonical_v2_bridge",
    };
  }
  async function ensureLegacyBridge(identity, { work_id }) {
    if (!legacyRuntime || typeof legacyRuntime.ensureWithClient !== "function") {
      fail("legacy_work_transaction_bridge_unavailable");
    }
    await Promise.all([initialize(), legacyRuntime.initialize()]);
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("legacy_bridge_owner_required");
    const workId = uuid(work_id);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      if (work.legacy_work_id !== workId) fail("legacy_bridge_identity_mismatch");
      const existing = await client.query(`SELECT w.project_id,w.status,a.anchor,a.intent_digest
        FROM core_continuity_works w
        LEFT JOIN core_continuity_intent_anchors a
          ON a.tenant_id=w.tenant_id AND a.work_id=w.work_id
        WHERE w.tenant_id=$1 AND w.work_id=$2
        FOR UPDATE OF w`, [actor.tenant_id, workId]);
      const legacy = existing.rows[0];
      if (legacy) {
        if (legacy.project_id !== work.project_id || !plainRecord(legacy.anchor) ||
            legacy.anchor.schema_version !== "intent_anchor_v1" || legacy.anchor.immutable !== true ||
            !HASH.test(String(legacy.intent_digest || "")) ||
            objectDigest(legacy.anchor) !== legacy.intent_digest) {
          fail("legacy_bridge_existing_state_invalid");
        }
        return {
          schema_version: "work_continuity_legacy_bridge_v1",
          work_id: workId,
          project_id: work.project_id,
          v2_intent_digest: work.intent_digest,
          legacy_intent_digest: legacy.intent_digest,
          state: "already_linked",
          idempotent_replay: true,
          execution_authorized: false,
        };
      }
      const reconstructed = await legacyRuntime.ensureWithClient(client, identity, legacyBridgeInput(work), {
        creationAuthorized: true,
      });
      const projectedEvent = reconstructed.intent_event || reconstructed.event;
      if (reconstructed.work_id !== workId || !HASH.test(String(reconstructed.intent_digest || "")) ||
          !Number.isSafeInteger(Number(projectedEvent?.sequence_number)) ||
          Number(projectedEvent.sequence_number) < 1 || !HASH.test(String(projectedEvent.event_hash || ""))) {
        fail("legacy_bridge_reconstruction_invalid");
      }
      const updated = await client.query(`UPDATE tenant_work SET
          legacy_projection_sequence=$3,legacy_projection_event_hash=$4,legacy_projection_updated_at=now(),updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND legacy_work_id=$2
        RETURNING work_id`, [actor.tenant_id, workId, Number(projectedEvent.sequence_number), projectedEvent.event_hash]);
      if (!updated.rows[0]) fail("legacy_bridge_identity_mismatch");
      const event = await appendV2Event(client, actor, workId, "legacy_bridge_reconstructed", {
        schema_version: "legacy_work_bridge_v1",
        source: "retained_canonical_v2_fields",
        v2_intent_digest: work.intent_digest,
        legacy_intent_digest: reconstructed.intent_digest,
        legacy_event_sequence: Number(projectedEvent.sequence_number),
        legacy_event_hash: projectedEvent.event_hash,
      });
      return {
        schema_version: "work_continuity_legacy_bridge_v1",
        work_id: workId,
        project_id: work.project_id,
        v2_intent_digest: work.intent_digest,
        legacy_intent_digest: reconstructed.intent_digest,
        state: "reconstructed",
        event,
        idempotent_replay: false,
        execution_authorized: false,
      };
    });
  }
  async function queueNewWork(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("work_creation_owner_required");
    if (String(input.intent_type || "CREATE_WORK") !== "CREATE_WORK" || input.resume_existing === true) {
      fail("open_work_review_create_intent_required");
    }
    const requestDigest = createRequestDigest(input);
    const reviewId = uuid(input.review_id, "open_work_review_id_required");
    const workId = input.work_id ? uuid(input.work_id) : deterministicWorkId(actor.tenant_id, reviewId, requestDigest);
    return transaction(async (client) => {
      const review = await consumeOpenReviewWithClient(client, actor, input, workId);
      const queued = await createWorkWithClient(client, actor, {
        ...input,
        work_id: workId,
      }, { initialStatus: "PLANNED" });
      // A caller-selected work_id is never a convenient alias for an
      // unrelated Gallery row.  The review-to-Work binding above permits one
      // exact retry only; any fresh request that collides rolls its review
      // consumption back with the transaction instead of reporting success.
      if (!queued.created && !review.idempotent_replay) {
        fail("tenant_work_queue_work_id_collision");
      }
      if (queued.created) {
        await appendV2Event(client, actor, workId, "work_queued_v3", {
          review_id: reviewId,
          review_digest: review.review.review_digest,
          request_digest: requestDigest,
          decision: review.decision,
          status: "PLANNED",
        });
      }
      return {
        schema_version: "tenant_work_gallery_v3",
        work: queued.work,
        review: { review_id: reviewId, decision: review.decision, consumed: true },
        idempotent_replay: review.idempotent_replay && !queued.created,
      };
    });
  }
  async function readCreatedWorkByBootstrapRequest(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("work_creation_owner_required");
    if (String(input.intent_type || "CREATE_WORK") !== "CREATE_WORK" || input.resume_existing === true) {
      fail("open_work_review_create_intent_required");
    }
    const requestDigest = createRequestDigest(input);
    const requestId = text(canonicalCreateRequest(input).request_id,
      "open_work_review_request_id_required", 160);
    const reviewId = uuid(input.review_id, "open_work_review_id_required");
    const reviewDigest = digest(input.review_digest, "open_work_review_digest_required");
    const bindingResult = await query(`SELECT * FROM tenant_work_bootstrap_request
      WHERE tenant_id=$1 AND subject_user_id=$2 AND request_id=$3`,
    [actor.tenant_id, actor.user_id, requestId]);
    const binding = bindingResult.rows[0];
    if (!binding) return null;
    if (binding.request_digest !== requestDigest) fail("open_work_review_idempotency_conflict");
    if (binding.review_id !== reviewId) fail("open_work_review_request_binding_invalid");
    if (!binding.consumed_work_id) return null;

    const [reviewResult, workResult, eventResult] = await Promise.all([
      query(`SELECT * FROM tenant_work_open_review
        WHERE tenant_id=$1 AND review_id=$2`, [actor.tenant_id, reviewId]),
      query(`SELECT * FROM tenant_work
        WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, binding.consumed_work_id]),
      query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,
          previous_event_hash,event_hash
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2
          AND event_type = ANY(ARRAY['open_work_review_consumed','work_v2_created']::varchar[])
        ORDER BY sequence_number`, [actor.tenant_id, binding.consumed_work_id]),
    ]);
    const review = reviewResult.rows[0];
    const work = workResult.rows[0] && normalizeWork(workResult.rows[0]);
    if (!review || !work || review.review_digest !== reviewDigest ||
        review.request_digest !== requestDigest || review.subject_user_id !== actor.user_id ||
        review.request_id !== requestId || review.consumed_work_id !== binding.consumed_work_id ||
        !review.consumed_at || work.work_id !== binding.consumed_work_id ||
        work.legacy_work_id !== binding.consumed_work_id ||
        work.project_id !== String(input.project_id || "") ||
        (input.intent_digest && work.intent_digest !== input.intent_digest)) {
      fail("open_work_review_request_binding_invalid");
    }
    assertPermission(canRead, work, actor);
    if (input.review_decision && review.decision !== input.review_decision) {
      fail("open_work_review_replay_denied");
    }
    const expectedDecisionDigest = objectDigest({
      tenant_id: actor.tenant_id,
      review_id: reviewId,
      review_digest: reviewDigest,
      request_digest: requestDigest,
      subject_user_id: actor.user_id,
      decision: review.decision,
      work_id: work.work_id,
    });
    if (review.decision_digest !== expectedDecisionDigest) {
      fail("open_work_review_request_binding_invalid");
    }
    const events = new Map();
    for (const row of eventResult.rows) {
      const material = {
        tenant_id: row.tenant_id,
        work_id: row.work_id,
        sequence_number: Number(row.sequence_number),
        event_type: row.event_type,
        payload: stable(row.payload),
        previous_event_hash: row.previous_event_hash || null,
      };
      if (row.tenant_id !== actor.tenant_id || row.work_id !== work.work_id ||
          objectDigest(material) !== row.event_hash || events.has(row.event_type)) {
        fail("work_bootstrap_replay_evidence_invalid");
      }
      events.set(row.event_type, row);
    }
    const consumedEvent = events.get("open_work_review_consumed");
    const createdEvent = events.get("work_v2_created");
    if (!consumedEvent || !createdEvent ||
        Number(createdEvent.sequence_number) !== Number(consumedEvent.sequence_number) + 1 ||
        createdEvent.previous_event_hash !== consumedEvent.event_hash ||
        consumedEvent.payload?.review_id !== reviewId ||
        consumedEvent.payload?.review_digest !== reviewDigest ||
        consumedEvent.payload?.request_digest !== requestDigest ||
        consumedEvent.payload?.decision !== review.decision ||
        consumedEvent.payload?.decision_digest !== expectedDecisionDigest ||
        createdEvent.payload?.legacy_work_id !== work.work_id ||
        (createdEvent.payload?.intent_digest || null) !== (work.intent_digest || null)) {
      fail("work_bootstrap_replay_evidence_invalid");
    }
    const persistedCoreAuthorizationReceipt = normalizeCoreAuthorizationReceipt(
      createdEvent.payload?.core_authorization_receipt,
      actor.tenant_id,
    );
    if (!persistedCoreAuthorizationReceipt) fail("work_bootstrap_replay_evidence_invalid");
    return {
      schema_version: "work_continuity_v2",
      work,
      legacy_work_id: work.work_id,
      review: { review_id: reviewId, decision: review.decision, consumed: true },
      core_authorization_receipt: null,
      persisted_core_authorization_receipt: persistedCoreAuthorizationReceipt,
      idempotent_replay: true,
      replay_source: "durable_bootstrap_mapping",
      execution_authorized: false,
    };
  }
  async function projectLegacyWorkWithClient(client, actor, legacyId, suppliedRow = null, suppliedEvent = null) {
      const legacy = suppliedRow ? { rows: [suppliedRow] } : await client.query(`SELECT
          w.work_id,w.project_id,w.parent_work_id,w.idea,w.objective,w.status,w.created_at,w.updated_at,w.next_action,
          e.sequence_number AS source_sequence_number,e.event_type AS source_event_type,
          e.event_hash AS source_event_hash,e.payload AS source_event_payload,
          te.sequence_number AS terminal_sequence_number,te.event_type AS terminal_event_type,
          te.event_hash AS terminal_event_hash,te.payload AS terminal_event_payload
        FROM core_continuity_works w
        LEFT JOIN LATERAL (
          SELECT sequence_number,event_type,event_hash,payload
          FROM core_continuity_events
          WHERE tenant_id=w.tenant_id AND work_id=w.work_id
          ORDER BY sequence_number DESC LIMIT 1
        ) e ON true
        LEFT JOIN LATERAL (
          SELECT sequence_number,event_type,event_hash,payload
          FROM core_continuity_events
          WHERE tenant_id=w.tenant_id AND work_id=w.work_id
            AND event_type = ANY(ARRAY['closure_finalized','generic_closure_finalized','legacy_work_reconciled_closed']::varchar[])
          ORDER BY sequence_number DESC LIMIT 1
        ) te ON true
        WHERE w.tenant_id=$1 AND w.work_id=$2`, [actor.tenant_id, legacyId]);
      const row = legacy.rows[0];
      if (!row) fail("legacy_work_not_found");
      const status = mapLegacyStatus(row.status);
      if (!status) fail("legacy_work_status_not_projectable");
      const existing = await client.query(`SELECT * FROM tenant_work
        WHERE tenant_id=$1 AND (legacy_work_id=$2 OR work_id=$2) FOR UPDATE`,
      [actor.tenant_id, legacyId]);
      const sourceEvent = legacyProjectionEvent(row, suppliedEvent);
      if (!sourceEvent && existing.rows[0]) return normalizeWork(existing.rows[0]);
      if (!sourceEvent) fail("legacy_projection_source_event_required");
      if (!terminalLegacyProjectionVerified(status, sourceEvent, row)) {
        fail("legacy_projection_terminal_evidence_required");
      }
      if (existing.rows[0]) {
        const current = normalizeWork(existing.rows[0]);
        // A linked V2 identity is authoritative for its V2 fields. The
        // compatibility projector must not later turn it back into a legacy
        // projection when a delayed legacy event is observed.
        if (current.legacy_work_id === legacyId && current.work_type !== "legacy") return current;
        const projectedSequence = Number(current.legacy_projection_sequence || 0);
        if (projectedSequence >= sourceEvent.sequence_number) return current;
        if (ARCHIVE_STATUSES.has(current.status) && !ARCHIVE_STATUSES.has(status)) {
          fail("legacy_projection_terminal_regression_denied");
        }
        const updated = await client.query(`UPDATE tenant_work SET
            project_id=$3,parent_work_id=$4,work_name=$5,objective=$6,next_action=$7,status=$8::varchar,
            updated_at=$9::timestamptz,
            closed_at=CASE WHEN $8::varchar = ANY($13::varchar[]) THEN COALESCE(closed_at,$9::timestamptz) ELSE closed_at END,
            archived_at=CASE WHEN $8::varchar = ANY($13::varchar[]) THEN COALESCE(archived_at,$9::timestamptz) ELSE archived_at END,
            legacy_projection_sequence=$10,legacy_projection_event_hash=$11,
            legacy_projection_updated_at=$12::timestamptz
          WHERE tenant_id=$1 AND work_id=$2 RETURNING *`,
        [actor.tenant_id, current.work_id, row.project_id || null, row.parent_work_id || null,
          String(row.idea || row.objective || "Legacy work").slice(0, 1_000), row.objective || null,
          row.next_action || null, status, row.updated_at || now(), sourceEvent.sequence_number,
          sourceEvent.event_hash, now(), [...ARCHIVE_STATUSES]]);
        await appendV2Event(client, actor, current.work_id, "legacy_work_projection_synced", {
          legacy_status: String(row.status || "").toLowerCase(), projected_status: status,
          source_event_type: sourceEvent.event_type, source_event_hash: sourceEvent.event_hash,
          source_sequence_number: sourceEvent.sequence_number,
        });
        return normalizeWork(updated.rows[0]);
      }
      const workCode = await allocateCode(client, actor, row.project_id || "LEGACY");
      await client.query(`INSERT INTO tenant_work
        (tenant_id,work_id,legacy_work_id,work_code,work_name,work_type,project_id,owner_user_id,created_by_user_id,
         assigned_user_ids,supervising_user_ids,agent_ids,visibility_scope,created_at,started_at,updated_at,status,objective,next_action,parent_work_id,
         closed_at,archived_at,legacy_projection_sequence,legacy_projection_event_hash,legacy_projection_updated_at)
        VALUES ($1,$2,$2,$3,$4,'legacy',$5,NULL,NULL,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'private',$6,$6,$7,$8::varchar,$9,$10,$11,
          CASE WHEN $8::varchar = ANY($15::varchar[]) THEN $7::timestamptz ELSE NULL END,
          CASE WHEN $8::varchar = ANY($15::varchar[]) THEN $7::timestamptz ELSE NULL END,$12,$13,$14)`,
      [actor.tenant_id, legacyId, workCode, String(row.idea || row.objective || "Legacy work").slice(0, 1_000), row.project_id || null,
        row.created_at || now(), row.updated_at || now(), status, row.objective || null, row.next_action || null,
        row.parent_work_id || null, sourceEvent.sequence_number, sourceEvent.event_hash, now(), [...ARCHIVE_STATUSES]]);
      const projected = await loadWork(client, actor, legacyId);
      await appendV2Event(client, actor, legacyId, "legacy_work_projected", {
        legacy_status: row.status, projected_status: status, ownership_invented: false,
        source_event_type: sourceEvent.event_type, source_event_hash: sourceEvent.event_hash,
        source_sequence_number: sourceEvent.sequence_number,
      });
      return projected;
  }
  async function projectLegacyWork(identity, { legacy_work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("legacy_projection_owner_required");
    const legacyId = uuid(legacy_work_id, "legacy_work_id_invalid");
    return transaction(async (client) => {
      return projectLegacyWorkWithClient(client, actor, legacyId);
    });
  }
  async function readWork(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    let result = await query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, uuid(work_id)]);
    if (!result.rows[0] && isAdmin(actor)) {
      await projectLegacyWork(identity, { legacy_work_id: work_id });
      result = await query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, uuid(work_id)]);
    }
    const work = result.rows[0] && normalizeWork(result.rows[0]);
    if (!work) fail("tenant_work_not_found");
    assertPermission(canRead, work, actor);
    const [tasks, evidence, receipt, report] = await Promise.all([
      query("SELECT * FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 ORDER BY task_id", [actor.tenant_id, work.work_id]),
      query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 ORDER BY created_at,evidence_id", [actor.tenant_id, work.work_id]),
      query("SELECT * FROM tenant_work_closure_receipt WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, work.work_id]),
      query("SELECT report,report_digest,created_at FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, work.work_id]),
    ]);
    return { schema_version: "work_continuity_v2", work, tasks: tasks.rows, evidence: evidence.rows,
      closure_receipt: receipt.rows[0] || null, final_report: report.rows[0] || null };
  }
  async function verifyWorkClosure(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, false);
      assertPermission(canRead, work, actor);
      const [tasks, evidence, join, receipt, report, event] = await Promise.all([
        client.query("SELECT * FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY task_id", [actor.tenant_id, workId]),
        client.query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY created_at,evidence_id", [actor.tenant_id, workId]),
        client.query("SELECT * FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
        client.query("SELECT * FROM tenant_work_closure_receipt WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
        client.query("SELECT tenant_id,work_id,report,report_digest,created_at FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
        client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,previous_event_hash,event_hash
          FROM tenant_work_event
          WHERE tenant_id=$1 AND work_id=$2 AND event_type='generic_closure_finalized'
          ORDER BY sequence_number DESC LIMIT 1`, [actor.tenant_id, workId]),
      ]);
      return deriveTenantWorkClosureVerification({
        tenant_id: actor.tenant_id,
        work,
        tasks: tasks.rows,
        evidence: evidence.rows,
        core_join: join.rows[0] || null,
        closure_receipt: receipt.rows[0] || null,
        final_report: report.rows[0] || null,
        closure_event: event.rows[0] || null,
      }, {
        verifyCoreJoin: (context) => Boolean(
          resolvedCoreJoinVerifier && resolvedCoreJoinVerifier.verify(context),
        ),
      });
    });
  }
  async function listWorks(identity, { view = "operational", project_id } = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!["my", "team", "tenant", "operational", "archive"].includes(view)) fail("work_gallery_view_invalid");
    if (view === "tenant" && !isAdmin(actor)) fail("tenant_gallery_forbidden");
    if (view === "team" && !actor.team_ids.length && !actor.managed_team_ids.length) fail("team_gallery_forbidden");
    const values = [actor.tenant_id];
    const where = ["tenant_id=$1"];
    if (project_id) { values.push(text(project_id, "project_id_invalid", 128)); where.push(`project_id=$${values.length}`); }
    const rows = await query(`SELECT * FROM tenant_work WHERE ${where.join(" AND ")} ORDER BY priority_score DESC,updated_at DESC`, values);
    const visible = rows.rows.map(normalizeWork).filter((work) => {
      if (view === "archive") return ARCHIVE_STATUSES.has(work.status) && canRead(work, actor);
      if (view === "operational") return OPERATIONAL_STATUSES.has(work.status) && canRead(work, actor);
      if (view === "my") return isNamedPrincipal(work, actor);
      if (view === "team") return work.team_id && (actor.team_ids.includes(work.team_id) || actor.managed_team_ids.includes(work.team_id)) && canRead(work, actor);
      return canRead(work, actor);
    });
    if (view !== "archive" || !visible.length) return visible;
    const reportRows = await query(`SELECT work_id,report_digest,created_at,
        report->>'final_status' AS final_status,
        report->>'closed_at' AS report_closed_at,
        report->>'final_evidence_digest' AS report_final_evidence_digest
      FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id = ANY($2::uuid[])`,
    [actor.tenant_id, visible.map((work) => work.work_id)]);
    const summaries = new Map(reportRows.rows.map((row) => [String(row.work_id), {
      report_digest: row.report_digest,
      created_at: row.created_at,
      final_status: row.final_status || null,
      closed_at: row.report_closed_at || null,
      final_evidence_digest: row.report_final_evidence_digest || null,
    }]));
    return visible.map((work) => ({ ...work, final_report_summary: summaries.get(String(work.work_id)) || null }));
  }
  async function assignQueuedWork(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const targetAgentId = text(input.target_agent_id, "work_assignment_agent_required", 128);
    const targetClientType = text(input.target_client_type, "work_assignment_client_type_required", 32);
    if (!["chatgpt", "codex", "api_agent", "other"].includes(targetClientType)) {
      fail("work_assignment_client_type_invalid");
    }
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      if (work.legacy_work_id) fail("work_assignment_legacy_bridge_unsupported");
      if (!OPERATIONAL_STATUSES.has(work.status)) fail("work_assignment_status_invalid");
      const assigned = await client.query(`UPDATE tenant_work SET
          assignment_target_agent_id=$3,assignment_target_client_type=$4,assignment_status='OFFERED',
          assignment_offered_at=now(),assignment_accepted_at=NULL,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND status=$5::varchar
        RETURNING *`, [actor.tenant_id, workId, targetAgentId, targetClientType, work.status]);
      if (!assigned.rows[0]) fail("work_assignment_status_conflict");
      const event = await appendV2Event(client, actor, workId, "work_assignment_offered_v3", {
        target_agent_id: targetAgentId,
        target_client_type: targetClientType,
        status: "OFFERED",
      });
      return { schema_version: "tenant_work_gallery_v3", work: normalizeWork(assigned.rows[0]), event };
    });
  }
  async function acceptQueuedWorkAssignment(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    if (!actor.agent_id || !actor.client_type) fail("work_assignment_host_identity_required");
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      if (!sameTenant(work, actor) || work.legacy_work_id || !OPERATIONAL_STATUSES.has(work.status) ||
          work.assignment_status !== "OFFERED" ||
          work.assignment_target_agent_id !== actor.agent_id ||
          work.assignment_target_client_type !== actor.client_type) {
        fail("work_assignment_acceptance_denied");
      }
      const agentIds = [...new Set([...(work.agent_ids || []), actor.agent_id])];
      const accepted = await client.query(`UPDATE tenant_work SET
          agent_ids=$3::jsonb,assignment_status='ACCEPTED',assignment_accepted_at=now(),updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND assignment_status='OFFERED'
          AND assignment_target_agent_id=$4 AND assignment_target_client_type=$5
        RETURNING *`, [actor.tenant_id, workId, JSON.stringify(agentIds), actor.agent_id, actor.client_type]);
      if (!accepted.rows[0]) fail("work_assignment_acceptance_conflict");
      const event = await appendV2Event(client, actor, workId, "work_assignment_accepted_v3", {
        target_agent_id: actor.agent_id,
        target_client_type: actor.client_type,
        status: "ACCEPTED",
      });
      return { schema_version: "tenant_work_gallery_v3", work: normalizeWork(accepted.rows[0]), event };
    });
  }
  async function archiveWork(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const reason = text(input.reason, "work_archive_reason_required", 1_000);
    const idempotencyKey = galleryIdempotencyKey(
      input.idempotency_key,
      "work_archive_idempotency_key_required",
    );
    const requestDigest = archiveRequestDigest(actor, workId, reason);
    const idempotencyKeyDigest = archiveIdempotencyKeyDigest(actor, workId, idempotencyKey);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      if (work.legacy_work_id) fail("work_archive_legacy_bridge_unsupported");
      // The event ledger is the durable result record. Check it before the
      // current status so a response-lost retry succeeds even though the
      // original transition already made the Work terminal.
      const replay = await client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,
          previous_event_hash,event_hash
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2
          AND event_type='work_archived_v3'
          AND payload->>'idempotency_key_digest'=$3
        ORDER BY sequence_number DESC LIMIT 1`,
      [actor.tenant_id, workId, idempotencyKeyDigest]);
      if (replay.rows[0]) return archiveReplayOutcome(replay.rows[0], {
        tenantId: actor.tenant_id,
        workId,
        reason,
        requestDigest,
        idempotencyKeyDigest,
      });
      if (!OPERATIONAL_STATUSES.has(work.status)) fail("work_archive_status_invalid");
      const archived = await client.query(`UPDATE tenant_work SET
          status='ARCHIVED',archived_at=now(),archived_from_status=$3::varchar,archived_reason=$4,
          assignment_status='REVOKED',updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND status=$5::varchar
        RETURNING *`, [actor.tenant_id, workId, work.status, reason, work.status]);
      if (!archived.rows[0]) fail("work_archive_status_conflict");
      const released = await client.query(`UPDATE core_continuity_leases
        SET status='released',released_at=coalesce(released_at,now())
        WHERE tenant_id=$1 AND work_id=$2 AND status='active'
        RETURNING lease_id`, [actor.tenant_id, workId]);
      const event = await appendV2Event(client, actor, workId, "work_archived_v3", {
        schema_version: "tenant_work_gallery_archive_event_v1",
        from_status: work.status,
        reason,
        request_digest: requestDigest,
        idempotency_key_digest: idempotencyKeyDigest,
        work: normalizeWork(archived.rows[0]),
        released_lease_count: released.rowCount,
      });
      return {
        schema_version: "tenant_work_gallery_v3",
        work: normalizeWork(archived.rows[0]),
        released_lease_count: released.rowCount,
        event,
        idempotent_replay: false,
      };
    });
  }
  async function reopenWork(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const reason = text(input.reason, "work_reopen_reason_required", 1_000);
    const nextAction = input.next_action === undefined
      ? null
      : text(input.next_action, "work_reopen_next_action_invalid", 4_000);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      if (work.legacy_work_id) fail("work_reopen_legacy_bridge_unsupported");
      if (work.status !== "ARCHIVED" || !OPERATIONAL_STATUSES.has(work.archived_from_status)) {
        fail("work_reopen_status_invalid");
      }
      const resumedNextAction = nextAction || work.next_action || "Review the Work and assign the next bounded action.";
      const reopened = await client.query(`UPDATE tenant_work SET
          status='PLANNED',archived_at=NULL,archived_from_status=NULL,archived_reason=NULL,
          assignment_target_agent_id=NULL,assignment_target_client_type=NULL,assignment_status=NULL,
          assignment_offered_at=NULL,assignment_accepted_at=NULL,
          reopened_at=now(),reopen_count=reopen_count+1,next_action=$3,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND status='ARCHIVED'
        RETURNING *`, [actor.tenant_id, workId, resumedNextAction]);
      if (!reopened.rows[0]) fail("work_reopen_status_conflict");
      const event = await appendV2Event(client, actor, workId, "work_reopened_v3", {
        archived_from_status: work.archived_from_status,
        reason,
        next_action: resumedNextAction,
        status: "PLANNED",
      });
      return { schema_version: "tenant_work_gallery_v3", work: normalizeWork(reopened.rows[0]), event };
    });
  }
  async function openWorkReview(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (String(input.intent_type || "") !== "CREATE_WORK") fail("open_work_review_create_intent_required");
    const proposed = canonicalCreateRequest(input);
    workBootstrapTextCollections(proposed);
    const projectId = text(proposed.project_id, "project_id_invalid", 128);
    const requestId = text(proposed.request_id, "open_work_review_request_id_required", 160);
    const intentDigest = proposed.intent_digest ? digest(proposed.intent_digest, "intent_digest_invalid") : null;
    const requestDigest = createRequestDigest(input);
    const responseFor = (row, idempotentReplay) => ({
      ...(row.review_result || {}),
      review_id: row.review_id,
      review_digest: row.review_digest,
      request_digest: row.request_digest,
      subject_user_id: row.subject_user_id,
      request_id: row.request_id,
      expires_at: row.expires_at,
      consumed: Boolean(row.consumed_at),
      consumed_work_id: row.consumed_work_id || null,
      idempotent_replay: idempotentReplay === true,
    });
    return transaction(async (client) => {
      const candidateReviewId = crypto.randomUUID();
      const reserved = await client.query(`INSERT INTO tenant_work_bootstrap_request
        (tenant_id,subject_user_id,request_id,request_digest,review_id)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (tenant_id,subject_user_id,request_id) DO NOTHING
        RETURNING *`, [actor.tenant_id, actor.user_id, requestId, requestDigest, candidateReviewId]);
      let binding = reserved.rows[0];
      if (!binding) {
        const selected = await client.query(`SELECT * FROM tenant_work_bootstrap_request
          WHERE tenant_id=$1 AND subject_user_id=$2 AND request_id=$3 FOR UPDATE`,
        [actor.tenant_id, actor.user_id, requestId]);
        binding = selected.rows[0];
        if (!binding) fail("open_work_review_request_binding_unavailable");
        if (binding.request_digest !== requestDigest) fail("open_work_review_idempotency_conflict");
        const linked = await client.query(`SELECT * FROM tenant_work_open_review
          WHERE tenant_id=$1 AND review_id=$2 FOR UPDATE`, [actor.tenant_id, binding.review_id]);
        if (!linked.rows[0] || (binding.consumed_work_id || null) !== (linked.rows[0].consumed_work_id || null)) {
          fail("open_work_review_request_binding_invalid");
        }
        return responseFor(linked.rows[0], true);
      }

      // On first access after migration, adopt a single unambiguous legacy
      // review instead of minting a new identity. Conflicting historical
      // digests or multiple consumed Works are retained for audit and rejected.
      const historical = await client.query(`SELECT * FROM tenant_work_open_review
        WHERE tenant_id=$1 AND subject_user_id=$2 AND request_id=$3
        ORDER BY (consumed_work_id IS NOT NULL) DESC,consumed_at DESC NULLS LAST,created_at ASC
        FOR UPDATE`, [actor.tenant_id, actor.user_id, requestId]);
      if (historical.rows.length) {
        if (historical.rows.some((row) => row.request_digest !== requestDigest)) {
          fail("open_work_review_idempotency_conflict");
        }
        const consumedWorkIds = new Set(historical.rows
          .map((row) => row.consumed_work_id)
          .filter(Boolean));
        if (consumedWorkIds.size > 1) fail("open_work_review_historical_duplicate_conflict");
        const row = historical.rows[0];
        const adopted = await client.query(`UPDATE tenant_work_bootstrap_request
          SET review_id=$4,consumed_work_id=$5,updated_at=now()
          WHERE tenant_id=$1 AND subject_user_id=$2 AND request_id=$3
            AND request_digest=$6
          RETURNING *`, [actor.tenant_id, actor.user_id, requestId, row.review_id,
          row.consumed_work_id || null, requestDigest]);
        if (!adopted.rows[0]) fail("open_work_review_request_binding_invalid");
        return responseFor(row, true);
      }

      const all = await client.query(
        "SELECT * FROM tenant_work WHERE tenant_id=$1 AND status = ANY($2)",
        [actor.tenant_id, [...OPERATIONAL_STATUSES]],
      );
      const normalizedWorks = all.rows.map(normalizeWork);
      const projectWorks = normalizedWorks.filter((work) => work.project_id === projectId);
      const review = resolveWorkRequest(text(input.request || `${proposed.work_name} ${proposed.objective}`, "work_review_request_invalid", 8_000), projectWorks, actor, {
        project_id: projectId, intent_digest: intentDigest, now: now(),
      });
      const visibleIds = new Set(projectWorks
        .filter((work) => canRead(work, actor))
        .map((work) => work.work_id));
      const related = projectWorks;
      const staleConflict = related.some((work) => ["STALE", "ABANDONED", "COMPLETED_BUT_UNCLOSED"]
        .includes(classifyStaleWork(work, now()).classification));
      const priorityConflict = related.some((work) => ["P0", "P1"].includes(work.priority));
      const dependencyConflict = Boolean(proposed.parent_work_id && related.some((work) =>
        work.work_id === proposed.parent_work_id && OPERATIONAL_STATUSES.has(work.status)));
      const significantOverlap = review.classification !== "NO_CONFLICT" || review.hidden_conflict === true;
      const conflictFlags = {
        significant_overlap: significantOverlap,
        stale: staleConflict,
        priority: priorityConflict,
        dependency: dependencyConflict,
        invisible_conflict: review.hidden_conflict === true,
      };
      const result = { ...review,
        requires_owner_decision: Object.values(conflictFlags).some(Boolean),
        candidates: review.candidates.filter((candidate) => visibleIds.has(candidate.work_id)),
        conflict_flags: conflictFlags,
        hidden_conflict: review.hidden_conflict === true,
      };
      const expiresAt = new Date(now().getTime() + 10 * 60_000).toISOString();
      const reviewDigest = objectDigest({ tenant_id: actor.tenant_id, subject_user_id: actor.user_id,
        review_id: candidateReviewId, request_id: requestId, request_digest: requestDigest, result, expires_at: expiresAt });
      const inserted = await client.query(`INSERT INTO tenant_work_open_review
        (tenant_id,review_id,subject_user_id,request_id,project_id,intent_digest,request_digest,review_digest,review_result,decision_required,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
        RETURNING *`, [actor.tenant_id, candidateReviewId, actor.user_id,
        requestId, projectId, intentDigest, requestDigest, reviewDigest, JSON.stringify(result), result.requires_owner_decision, expiresAt]);
      if (!inserted.rows[0]) fail("open_work_review_persistence_failed");
      return responseFor(inserted.rows[0], false);
    });
  }
  async function projectLegacyCatalog(identity, { project_id, limit = 50 } = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) return { projected: 0 };
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const legacy = await query(`SELECT w.work_id,w.project_id,w.parent_work_id,w.idea,w.objective,w.status,w.created_at,w.updated_at,w.next_action,
        e.sequence_number AS source_sequence_number,e.event_type AS source_event_type,
        e.event_hash AS source_event_hash,e.payload AS source_event_payload,
        te.sequence_number AS terminal_sequence_number,te.event_type AS terminal_event_type,
        te.event_hash AS terminal_event_hash,te.payload AS terminal_event_payload
      FROM core_continuity_works w
      LEFT JOIN LATERAL (
        SELECT sequence_number,event_type,event_hash,payload FROM core_continuity_events
        WHERE tenant_id=w.tenant_id AND work_id=w.work_id ORDER BY sequence_number DESC LIMIT 1
      ) e ON true
      LEFT JOIN LATERAL (
        SELECT sequence_number,event_type,event_hash,payload FROM core_continuity_events
        WHERE tenant_id=w.tenant_id AND work_id=w.work_id
          AND event_type = ANY(ARRAY['closure_finalized','generic_closure_finalized','legacy_work_reconciled_closed']::varchar[])
        ORDER BY sequence_number DESC LIMIT 1
      ) te ON true
      WHERE w.tenant_id=$1 AND ($2::varchar IS NULL OR w.project_id=$2)
      ORDER BY w.updated_at DESC LIMIT $3`, [actor.tenant_id, project_id || null, boundedLimit]);
    let projected = 0;
    let skipped = 0;
    await transaction(async (client) => {
      for (const row of legacy.rows) {
        if (!mapLegacyStatus(row.status)) { skipped += 1; continue; }
        try {
          const before = await client.query(`SELECT legacy_projection_sequence FROM tenant_work
            WHERE tenant_id=$1 AND (legacy_work_id=$2 OR work_id=$2)`, [actor.tenant_id, row.work_id]);
          const previousSequence = Number(before.rows[0]?.legacy_projection_sequence || 0);
          const event = legacyProjectionEvent(row);
          await projectLegacyWorkWithClient(client, actor, row.work_id, row, event);
          if (event && event.sequence_number > previousSequence) projected += 1;
        } catch (error) {
          if (["legacy_projection_source_event_required", "legacy_projection_terminal_evidence_required",
            "legacy_projection_terminal_regression_denied"].includes(error?.message)) {
            skipped += 1;
            continue;
          }
          throw error;
        }
      }
    });
    return { projected, skipped, scanned: legacy.rows.length };
  }

  async function projectLegacyEvent({ client, tenant_id, work_id, actor, event } = {}) {
    await initialize();
    if (!client || typeof client.query !== "function") fail("legacy_projection_client_required");
    const internalActor = {
      tenant_id: text(tenant_id, "tenant_identity_required", 64),
      user_id: String(actor || "core_gallery_projector").slice(0, 128),
      agent_id: "core_gallery_projector",
      session_fingerprint: null,
      team_ids: [], managed_team_ids: [], is_tenant_owner: true, is_super_admin: false,
    };
    return projectLegacyWorkWithClient(client, internalActor, uuid(work_id), null, event);
  }

  async function backfillLegacyProjection({ limit = 5_000 } = {}) {
    await initialize();
    const boundedLimit = Math.max(1, Math.min(10_000, Number(limit) || 5_000));
    const rows = await query(`SELECT w.tenant_id,w.work_id,w.project_id,w.parent_work_id,w.idea,w.objective,w.status,
        w.created_at,w.updated_at,w.next_action,e.sequence_number AS source_sequence_number,
        e.event_type AS source_event_type,e.event_hash AS source_event_hash,e.payload AS source_event_payload,
        te.sequence_number AS terminal_sequence_number,te.event_type AS terminal_event_type,
        te.event_hash AS terminal_event_hash,te.payload AS terminal_event_payload
      FROM core_continuity_works w
      LEFT JOIN LATERAL (
        SELECT sequence_number,event_type,event_hash,payload FROM core_continuity_events
        WHERE tenant_id=w.tenant_id AND work_id=w.work_id ORDER BY sequence_number DESC LIMIT 1
      ) e ON true
      LEFT JOIN LATERAL (
        SELECT sequence_number,event_type,event_hash,payload FROM core_continuity_events
        WHERE tenant_id=w.tenant_id AND work_id=w.work_id
          AND event_type = ANY(ARRAY['closure_finalized','generic_closure_finalized','legacy_work_reconciled_closed']::varchar[])
        ORDER BY sequence_number DESC LIMIT 1
      ) te ON true
      ORDER BY w.tenant_id,w.work_id LIMIT $1`, [boundedLimit]);
    const result = { scanned: rows.rows.length, projected: 0, skipped: 0 };
    await transaction(async (client) => {
      for (const row of rows.rows) {
        const actor = { tenant_id: row.tenant_id, user_id: "core_gallery_projector",
          agent_id: "core_gallery_projector", session_fingerprint: null, team_ids: [],
          managed_team_ids: [], is_tenant_owner: true, is_super_admin: false };
        const event = legacyProjectionEvent(row);
        try {
          const before = await client.query(`SELECT legacy_projection_sequence FROM tenant_work
            WHERE tenant_id=$1 AND (legacy_work_id=$2 OR work_id=$2)`, [row.tenant_id, row.work_id]);
          const previousSequence = Number(before.rows[0]?.legacy_projection_sequence || 0);
          await projectLegacyWorkWithClient(client, actor, row.work_id, row, event);
          if (event && event.sequence_number > previousSequence) result.projected += 1;
        } catch (error) {
          if (["legacy_projection_source_event_required", "legacy_projection_terminal_evidence_required",
            "legacy_projection_terminal_regression_denied"].includes(error?.message)) {
            result.skipped += 1;
            continue;
          }
          throw error;
        }
      }
    });
    return Object.freeze(result);
  }
  async function preflightGallery(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    await projectLegacyCatalog(identity, { project_id: input.project_id, limit: input.limit || 50 });
    const works = await listWorks(identity, { view: "operational", project_id: input.project_id });
    const limited = works.slice(0, Math.max(1, Math.min(200, Number(input.limit) || 20)));
    const rows = [];
    for (const work of limited) {
      const sourceId = work.legacy_work_id || work.work_id;
      const activity = await query(`SELECT
          count(DISTINCT p.session_id) FILTER (WHERE p.status='active' AND p.expires_at>now())::int AS active_participants,
          count(DISTINCT l.lease_id) FILTER (WHERE l.status='active' AND l.expires_at>now())::int AS active_leases,
          count(DISTINCT b.branch_id) FILTER (WHERE b.status='active')::int AS active_branches
        FROM core_continuity_works w
        LEFT JOIN core_continuity_participants p ON p.tenant_id=w.tenant_id AND p.work_id=w.work_id
        LEFT JOIN core_continuity_leases l ON l.tenant_id=w.tenant_id AND l.work_id=w.work_id
        LEFT JOIN core_continuity_branches b ON b.tenant_id=w.tenant_id AND b.work_id=w.work_id
        WHERE w.tenant_id=$1 AND w.work_id=$2`, [actor.tenant_id, sourceId]);
      rows.push({
        tenant_id: actor.tenant_id, project_id: work.project_id, work_id: sourceId,
        parent_work_id: work.parent_work_id || null, idea: work.work_name, objective: work.objective,
        status: mapV2StatusToLegacy(work.status), current_version: 2, next_action: work.next_action || "",
        updated_at: work.updated_at, active_participants: Number(activity.rows[0]?.active_participants || 0),
        active_leases: Number(activity.rows[0]?.active_leases || 0),
        active_branches: Number(activity.rows[0]?.active_branches || 0), blockers: [], blocker_count: 0,
        work_code: work.work_code, work_name: work.work_name, work_type: work.work_type,
        progress_bp: work.progress_bp, priority: work.priority, priority_score: work.priority_score,
        continuity_v2: true,
      });
    }
    return { schema_version: "tenant_work_gallery_v1", source_schema_version: "work_continuity_v2",
      tenant_id: actor.tenant_id, filters: { project_id: input.project_id || null, status: "active", query: null }, works: rows };
  }
  async function recordTask(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const taskId = input.task_id ? uuid(input.task_id, "task_id_invalid") : crypto.randomUUID();
    await transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canRecordTask, work, actor);
      await client.query(`INSERT INTO tenant_work_task (tenant_id,task_id,work_id,title,weight,status,required,acceptance_verified,completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,false,CASE WHEN $6::varchar='completed' THEN now() ELSE NULL END)
        ON CONFLICT (tenant_id,task_id) DO UPDATE SET title=EXCLUDED.title,weight=EXCLUDED.weight,status=EXCLUDED.status,required=EXCLUDED.required,completed_at=EXCLUDED.completed_at`,
      [actor.tenant_id, taskId, workId, text(input.title, "task_title_invalid", 2_000), Math.max(1, Number(input.weight) || 1),
        input.status === "completed" ? "completed" : "planned", input.required !== false]);
    });
    return refreshDerived(identity, { work_id: workId });
  }
  async function recordEvidence(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const evidenceId = input.evidence_id ? uuid(input.evidence_id, "evidence_id_invalid") : crypto.randomUUID();
    await transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canContributeEvidence, work, actor);
      // This generic client-facing path records candidate evidence only.
      // Independent evidence is derived exclusively by the atomic native
      // verifier bridge from a server-read terminal report and receipt.
      const independentlyVerified = false;
      await client.query(`INSERT INTO tenant_work_evidence (tenant_id,evidence_id,work_id,kind,digest,required,independently_verified,verified_by_agent_id,verified_by_session_fingerprint,weight,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        ON CONFLICT (tenant_id,evidence_id) DO NOTHING`,
      [actor.tenant_id, evidenceId, workId, text(input.kind, "evidence_kind_invalid", 80), digest(input.digest, "evidence_digest_invalid"),
        // A client-submitted record is a candidate only.  It cannot become a
        // closure prerequisite before a server-owned verifier bridge derives
        // independent evidence from a terminal native receipt.
        false, independentlyVerified, independentlyVerified ? actor.agent_id : null,
        independentlyVerified ? actor.session_fingerprint : null, Math.max(1, Number(input.weight) || 1), JSON.stringify(input.metadata || {})]);
    });
    return refreshDerived(identity, { work_id: workId });
  }
  async function recordNativeVerifierEvidenceWithClient(client, source = {}) {
    if (!client || typeof client.query !== "function") {
      fail("native_verifier_evidence_transaction_required");
    }
    // This function has no tool handler. Its only caller is the legacy
    // continuity transaction after it persists the transport-bound report and
    // append-only receipt.
    if (source.server_owned !== true) fail("native_verifier_evidence_server_owned_required");
    const tenantId = text(source.tenant_id, "native_verifier_evidence_tenant_invalid", 64);
    const legacyWorkId = uuid(source.work_id, "native_verifier_evidence_work_invalid");
    const planId = uuid(source.plan_id, "native_verifier_evidence_plan_invalid");
    const taskId = text(source.task_id, "native_verifier_evidence_task_invalid", 120);
    const agentId = text(source.agent_id, "native_verifier_evidence_agent_invalid", 120);
    const sessionFingerprint = text(
      source.session_fingerprint,
      "native_verifier_evidence_session_invalid",
      128,
    ).toLowerCase();
    const presenceSignature = text(
      source.presence_signature,
      "native_verifier_evidence_presence_invalid",
      80,
    ).toLowerCase();
    const reportDigest = digest(source.report_digest, "native_verifier_evidence_report_digest_invalid");
    const receiptId = uuid(source.receipt_id, "native_verifier_evidence_receipt_invalid");
    const receiptDigest = digest(source.receipt_digest, "native_verifier_evidence_receipt_digest_invalid");
    if (!/^[a-f0-9]{16,64}$/.test(sessionFingerprint) ||
        !/^ags_[a-f0-9]{32}$/.test(presenceSignature)) {
      fail("native_verifier_evidence_presence_invalid");
    }
    const native = await client.query(`SELECT a.task_id,a.task_kind,a.task_digest,a.v2_task_id,a.status,a.report,a.report_digest,
        a.agent_id,
        a.native_session_fingerprint,a.native_presence_signature,p.plan,p.status AS plan_status
      FROM core_continuity_native_agents a
      JOIN core_continuity_native_plans p
        ON p.tenant_id=a.tenant_id AND p.plan_id=a.plan_id
      WHERE a.tenant_id=$1 AND a.work_id=$2 AND a.plan_id=$3 AND a.agent_id=$4
      FOR UPDATE`, [tenantId, legacyWorkId, planId, agentId]);
    const nativeRow = native.rows[0];
    if (!nativeRow ||
        nativeRow.plan_status !== "planned" ||
        nativeRow.task_id !== taskId ||
        nativeRow.task_kind !== "verifier" ||
        nativeRow.status !== "completed" ||
        nativeRow.report_digest !== reportDigest ||
        nativeRow.native_session_fingerprint !== sessionFingerprint ||
        nativeRow.native_presence_signature !== presenceSignature ||
        nativeRow.report?.schema_version !== "native_agent_report_v1" ||
        nativeRow.report?.verdict !== "approved") {
      fail("native_verifier_evidence_source_binding_invalid");
    }
    // The V2 task id is not supplied by the verifier report.  It is bound
    // before execution into every native assignment capability and re-read
    // here from the durable server-owned binding.
    const v2TaskId = nativeRow.v2_task_id
      ? uuid(nativeRow.v2_task_id, "native_verifier_evidence_task_binding_invalid")
      : null;
    if (!v2TaskId) fail("native_verifier_evidence_task_binding_missing");
    const verifiedTaskIds = Array.isArray(nativeRow.report?.verifies_task_ids)
      ? [...new Set(nativeRow.report.verifies_task_ids.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];
    if (!verifiedTaskIds.length) fail("native_verifier_evidence_source_binding_invalid");
    const canonicalBuilderTaskDigests = new Map(
      (Array.isArray(nativeRow.plan?.tasks) ? nativeRow.plan.tasks : [])
        .filter((task) => task?.kind === "builder")
        .map((task) => [
          String(task.task_id || "").trim(),
          String(task.task_digest || "").trim().toLowerCase(),
        ]),
    );
    // A verifier may cover non-builder tasks as part of a larger plan.  Only
    // builder bindings participate in the independent-evidence proof.
    const verifiedBuilderTaskIds = verifiedTaskIds.filter((taskId) =>
      canonicalBuilderTaskDigests.has(taskId));
    if (!verifiedBuilderTaskIds.length) fail("native_verifier_evidence_source_binding_invalid");
    const verifiedBuilders = await client.query(`SELECT task_id,agent_id,status,task_digest,v2_task_id,report_digest,
        native_session_fingerprint,native_presence_signature
      FROM core_continuity_native_agents
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
        AND task_id = ANY($4::varchar[]) AND task_kind='builder'
      FOR UPDATE`, [tenantId, legacyWorkId, planId, verifiedBuilderTaskIds]);
    const persistedBuilderTaskIds = new Set(verifiedBuilders.rows.map((row) => row.task_id));
    if (
      verifiedBuilders.rowCount !== verifiedBuilderTaskIds.length ||
      verifiedBuilderTaskIds.some((task) => !persistedBuilderTaskIds.has(task)) ||
      verifiedBuilders.rows.some((row) =>
        row.status !== "completed" ||
        !HASH.test(String(row.report_digest || "")) ||
        !/^[a-f0-9]{16,64}$/i.test(String(row.native_session_fingerprint || "")) ||
        !/^ags_[a-f0-9]{32}$/.test(String(row.native_presence_signature || "")) ||
        !HASH.test(String(row.task_digest || "")) ||
        row.v2_task_id !== v2TaskId ||
        canonicalBuilderTaskDigests.get(row.task_id) !== String(row.task_digest).toLowerCase() ||
        row.agent_id === agentId ||
        row.native_session_fingerprint === sessionFingerprint)
    ) {
      fail("native_verifier_evidence_independence_invalid");
    }
    const receipt = await client.query(`SELECT receipt_type,agent_id,payload,payload_digest
      FROM core_continuity_native_receipts
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND receipt_id=$4
      FOR UPDATE`, [tenantId, legacyWorkId, planId, receiptId]);
    const receiptRow = receipt.rows[0];
    const payload = receiptRow?.payload;
    if (!receiptRow ||
        receiptRow.receipt_type !== "agent_reported" ||
        receiptRow.agent_id !== agentId ||
        receiptRow.payload_digest !== receiptDigest ||
        payload?.task_id !== taskId ||
        payload?.task_kind !== "verifier" ||
        payload?.status !== "completed" ||
        payload?.report_digest !== reportDigest ||
        payload?.native_session_fingerprint !== sessionFingerprint ||
        payload?.native_presence_signature !== presenceSignature) {
      fail("native_verifier_evidence_receipt_binding_invalid");
    }
    const linkedWork = await client.query(`SELECT work_id,legacy_work_id,created_by_agent_id,
        created_by_session_fingerprint
      FROM tenant_work
      WHERE tenant_id=$1 AND work_id=$2 AND legacy_work_id=$2
      FOR UPDATE`, [tenantId, legacyWorkId]);
    const work = linkedWork.rows[0];
    if (!work ||
        (work.created_by_agent_id && work.created_by_agent_id === agentId) ||
        (work.created_by_session_fingerprint &&
          work.created_by_session_fingerprint === sessionFingerprint)) {
      fail("native_verifier_evidence_independence_invalid");
    }
    const v2Task = await client.query(`SELECT task_id,status,acceptance_verified
      FROM tenant_work_task
      WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3
      FOR UPDATE`, [tenantId, work.work_id, v2TaskId]);
    if (v2Task.rows[0]?.status !== "completed") {
      fail("native_verifier_evidence_task_binding_invalid");
    }
    const material = {
      schema_version: "native_verifier_terminal_evidence_v1",
      tenant_id: tenantId,
      work_id: work.work_id,
      legacy_work_id: legacyWorkId,
      plan_id: planId,
      task_id: taskId,
      task_digest: nativeRow.task_digest,
      v2_task_id: v2TaskId,
      verifier_agent_id: agentId,
      verifier_session_fingerprint: sessionFingerprint,
      verified_builder_bindings: verifiedBuilders.rows.map((row) => ({
        task_id: row.task_id,
        task_digest: row.task_digest,
        v2_task_id: row.v2_task_id,
        agent_id: row.agent_id,
        session_fingerprint: row.native_session_fingerprint,
        presence_signature: row.native_presence_signature,
        report_digest: row.report_digest,
      })).sort((left, right) => left.task_id.localeCompare(right.task_id)),
      native_receipt_id: receiptId,
      native_receipt_digest: receiptDigest,
      report_digest: reportDigest,
    };
    const evidenceDigest = objectDigest(material);
    const existing = await client.query(`SELECT evidence_id,task_digest,v2_task_id,verifier_agent_id,
        verifier_session_fingerprint,native_receipt_id,native_receipt_digest,report_digest,evidence_digest
      FROM tenant_work_native_verifier_evidence
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND task_id=$4
      FOR UPDATE`, [tenantId, work.work_id, planId, taskId]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.task_digest !== nativeRow.task_digest ||
          row.v2_task_id !== v2TaskId ||
          row.verifier_agent_id !== agentId ||
          row.verifier_session_fingerprint !== sessionFingerprint ||
          row.native_receipt_id !== receiptId ||
          row.native_receipt_digest !== receiptDigest ||
          row.report_digest !== reportDigest ||
          row.evidence_digest !== evidenceDigest) {
        fail("native_verifier_evidence_replay_conflict");
      }
      const evidence = await client.query(`SELECT digest,independently_verified,verified_by_agent_id,
          verified_by_session_fingerprint FROM tenant_work_evidence
        WHERE tenant_id=$1 AND evidence_id=$2 AND work_id=$3`,
      [tenantId, row.evidence_id, work.work_id]);
      const evidenceRow = evidence.rows[0];
      if (!evidenceRow || evidenceRow.digest !== evidenceDigest ||
          evidenceRow.independently_verified !== true ||
          evidenceRow.verified_by_agent_id !== agentId ||
          evidenceRow.verified_by_session_fingerprint !== sessionFingerprint) {
        fail("native_verifier_evidence_replay_integrity_failed");
      }
      await client.query(`UPDATE tenant_work_task SET acceptance_verified=true
        WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3
          AND status='completed'`, [tenantId, work.work_id, v2TaskId]);
      const derived = await refreshDerivedWithClient(client, {
        tenant_id: tenantId,
        user_id: "core_native_verifier_evidence_bridge",
        agent_id: agentId,
        session_fingerprint: sessionFingerprint,
        team_ids: [], managed_team_ids: [], is_tenant_owner: true, is_super_admin: false,
      }, work.work_id);
      return Object.freeze({
        schema_version: "native_verifier_terminal_evidence_v1",
        evidence_id: row.evidence_id,
        evidence_digest: evidenceDigest,
        report_digest: reportDigest,
        receipt_id: receiptId,
        derived,
        idempotent_replay: true,
      });
    }
    const evidenceId = crypto.randomUUID();
    const metadata = stable({
      ...material,
      source: "server_native_verifier_terminal_report",
      authority: "evidence_only",
      execution_authorized: false,
    });
    await client.query(`INSERT INTO tenant_work_evidence
      (tenant_id,evidence_id,work_id,kind,digest,required,independently_verified,
       verified_by_agent_id,verified_by_session_fingerprint,weight,metadata)
      VALUES ($1,$2,$3,$4,$5,true,true,$6,$7,1,$8::jsonb)`, [
      tenantId, evidenceId, work.work_id, "native_verifier_terminal_report", evidenceDigest,
      agentId, sessionFingerprint, JSON.stringify(metadata),
    ]);
    await client.query(`INSERT INTO tenant_work_native_verifier_evidence
      (tenant_id,work_id,plan_id,task_id,task_digest,v2_task_id,verifier_agent_id,
       verifier_session_fingerprint,native_receipt_id,native_receipt_digest,
       report_digest,evidence_id,evidence_digest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
      tenantId, work.work_id, planId, taskId, nativeRow.task_digest, v2TaskId,
      agentId, sessionFingerprint, receiptId, receiptDigest, reportDigest, evidenceId, evidenceDigest,
    ]);
    await client.query(`UPDATE tenant_work_task SET acceptance_verified=true
      WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3
        AND status='completed'`, [tenantId, work.work_id, v2TaskId]);
    const event = await appendV2Event(client, {
      tenant_id: tenantId,
      user_id: "core_native_verifier_evidence_bridge",
    }, work.work_id, "native_verifier_evidence_recorded", {
      plan_id: planId,
      task_id: taskId,
      v2_task_id: v2TaskId,
      verifier_agent_id: agentId,
      verifier_session_fingerprint: sessionFingerprint,
      native_receipt_id: receiptId,
      native_receipt_digest: receiptDigest,
      report_digest: reportDigest,
      evidence_id: evidenceId,
      evidence_digest: evidenceDigest,
      execution_authorized: false,
    });
    const derived = await refreshDerivedWithClient(client, {
      tenant_id: tenantId,
      user_id: "core_native_verifier_evidence_bridge",
      agent_id: agentId,
      session_fingerprint: sessionFingerprint,
      team_ids: [], managed_team_ids: [], is_tenant_owner: true, is_super_admin: false,
    }, work.work_id);
    return Object.freeze({
      schema_version: "native_verifier_terminal_evidence_v1",
      evidence_id: evidenceId,
      evidence_digest: evidenceDigest,
      report_digest: reportDigest,
      receipt_id: receiptId,
      event,
      derived,
      idempotent_replay: false,
    });
  }
  async function persistCoreJoin(identity, { work_id, core_join_digest, core_join_context }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (actor.core_join_trusted !== true) fail("core_join_trust_required");
    if (!resolvedCoreJoinVerifier || !resolvedCoreJoinVerifier.verify(core_join_context)) fail("generic_core_join_signature_invalid");
    const workId = uuid(work_id);
    await transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canClose, work, actor);
      const joinDigest = digest(core_join_digest, "core_join_digest_invalid");
      const context = core_join_context || {};
      if (context.tenant_id !== actor.tenant_id || context.work_id !== workId || context.adapter !== work.work_type ||
          context.verdict_digest !== joinDigest || context.authority !== "universal_core" ||
          context.decision !== "GENERIC_WORK_CORE_JOIN_ELIGIBLE" || typeof context.signature !== "string" || context.signature.length < 16) {
        fail("generic_core_join_context_invalid");
      }
      const existing = await client.query("SELECT core_join_digest,core_join_context FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [actor.tenant_id, workId]);
      if (existing.rows[0]) {
        if (existing.rows[0].core_join_digest !== joinDigest || objectDigest(existing.rows[0].core_join_context) !== objectDigest(context)) fail("generic_core_join_conflict");
        return;
      }
      await client.query(`INSERT INTO tenant_work_core_join (tenant_id,work_id,core_join_digest,core_join_context,persisted_by_user_id)
        VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [actor.tenant_id, workId, joinDigest, JSON.stringify(context), actor.user_id]);
    });
    return refreshDerived(identity, { work_id: workId });
  }
  async function refreshDerivedWithClient(client, actor, workId) {
      const work = await loadWork(client, actor, workId, true);
      const [tasks, evidence, join] = await Promise.all([
        client.query("SELECT title,weight,status,required,acceptance_verified FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
        client.query("SELECT weight,required,independently_verified FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
        client.query("SELECT core_join_digest FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
      ]);
      const progress = deriveProgress(tasks.rows, evidence.rows, { evaluated: false, independent_verification_passed: evidence.rows.length > 0 && evidence.rows.every((item) => item.independently_verified), core_join_received: Boolean(join.rows[0]) });
      const priorityFacts = await derivePersistedPriorityFacts(client, actor, { ...work, progress_bp: progress.overall_progress_bp });
      const priority = derivePriority(priorityFacts);
      await client.query(`UPDATE tenant_work SET progress_bp=$3,progress_version=$4,progress_source=$5,priority=$6,priority_score=$7,priority_version=$8,priority_context=$9::jsonb,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, workId, progress.overall_progress_bp, progress.progress_version, progress.progress_source,
        priority.priority, priority.priority_score, priority.priority_version, JSON.stringify(priorityFacts)]);
      return { ...progress, ...priority, work: await loadWork(client, actor, workId) };
  }
  async function refreshDerived(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canRead, work, actor);
      return refreshDerivedWithClient(client, actor, workId);
    });
  }
  async function reconcileStaleDryRun(identity, { project_id } = {}) {
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("stale_reconciliation_forbidden");
    const works = await listWorks(identity, { view: "tenant", project_id });
    const result = [];
    for (const work of works) {
      const sourceId = work.legacy_work_id || work.work_id;
      const [participants, leases] = await Promise.all([
        query("SELECT status,expires_at FROM core_continuity_participants WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, sourceId]),
        query("SELECT status,expires_at FROM core_continuity_leases WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, sourceId]),
      ]);
      const activity = {
        participants: participants.rows.map((row) => ({ ...row, active: row.status === "active" })),
        leases: leases.rows,
      };
      const legacyReconciliationEligible = work.work_type === "legacy";
      if (!legacyReconciliationEligible) {
        result.push({
          work_id: work.work_id,
          work_code: work.work_code,
          parent_work_id: work.parent_work_id || null,
          successor_work_id: work.successor_work_id || null,
          superseded_by_work_id: work.superseded_by_work_id || null,
          expected_status: null,
          authoritative_status: null,
          projected_status: work.status,
          projection_drift: false,
          authoritative_updated_at: null,
          projected_updated_at: work.updated_at || null,
          timestamp_projection_drift: false,
          work_type: work.work_type,
          legacy_reconciliation_eligible: false,
          allowed_actions: [],
          owner_confirmation_required: false,
          successor_required_for_supersede: false,
          server_closure_evidence_required: false,
          ...classifyStaleWork({ ...work, ...activity }),
        });
        continue;
      }
      const authoritative = await query(
        "SELECT status,updated_at FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2",
        [actor.tenant_id, sourceId],
      );
      const authoritativeStatus = authoritative.rows[0]
        ? String(authoritative.rows[0].status || "").toLowerCase()
        : null;
      const authoritativeUpdatedAt = authoritative.rows[0]?.updated_at || null;
      const authoritativeUpdatedAtMs = new Date(authoritativeUpdatedAt || "").getTime();
      const projectedUpdatedAtMs = new Date(work.updated_at || "").getTime();
      const authoritativeTimestampValid = Number.isFinite(authoritativeUpdatedAtMs);
      const projectedTimestampValid = Number.isFinite(projectedUpdatedAtMs);
      const timestampProjectionDrift = !authoritativeTimestampValid || !projectedTimestampValid ||
        Math.abs(authoritativeUpdatedAtMs - projectedUpdatedAtMs) > 5 * 60_000;
      const stale = classifyStaleWork({ ...work,
        updated_at: authoritativeTimestampValid ? authoritativeUpdatedAt : null,
        ...activity });
      const authoritativeV2Status = authoritativeStatus
        ? mapLegacyStatus(authoritativeStatus)
        : null;
      const projectionDrift = !authoritativeStatus || !authoritativeV2Status ||
        authoritativeV2Status !== work.status;
      const reconcilable = legacyReconciliationEligible && !projectionDrift && authoritativeTimestampValid &&
        ["STALE", "ABANDONED"].includes(stale.classification);
      const completedProjectionRepair = legacyReconciliationEligible && !projectionDrift && authoritativeTimestampValid &&
        stale.classification === "COMPLETED_BUT_UNCLOSED";
      result.push({ work_id: work.work_id, work_code: work.work_code,
        parent_work_id: work.parent_work_id || null, successor_work_id: work.successor_work_id || null,
        superseded_by_work_id: work.superseded_by_work_id || null,
        expected_status: authoritativeStatus,
        authoritative_status: authoritativeStatus,
        projected_status: work.status,
        projection_drift: projectionDrift,
        authoritative_updated_at: authoritativeUpdatedAt,
        projected_updated_at: work.updated_at || null,
        timestamp_projection_drift: timestampProjectionDrift,
        work_type: work.work_type,
        legacy_reconciliation_eligible: legacyReconciliationEligible,
        allowed_actions: completedProjectionRepair
          ? ["REPAIR_COMPLETED_PROJECTION"]
          : reconcilable
            ? (authoritativeStatus === "release_ready" ? ["SUPERSEDE"] : ["CANCEL", "SUPERSEDE"])
            : [],
        owner_confirmation_required: reconcilable || completedProjectionRepair,
        successor_required_for_supersede: !projectionDrift && reconcilable,
        server_closure_evidence_required: completedProjectionRepair ||
          (reconcilable && authoritativeStatus === "release_ready"),
        ...stale });
    }
    return { dry_run: true, classifications: result };
  }

  // This path closes stale legacy Gallery records without claiming that their
  // acceptance criteria or deployment were completed. Completion remains
  // reserved for the normal Core Join + final receipt flow above.
  async function reconcileLegacyClosed(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("legacy_reconciliation_owner_required");
    const confirmationReference = String(identity.confirmationReference || "").trim();
    if (identity.ownerConfirmed !== true || !confirmationReference || confirmationReference.length > 240) {
      fail("legacy_reconciliation_owner_confirmation_required");
    }
    const workId = uuid(input.work_id);
    const action = String(input.action || "").trim().toUpperCase();
    if (!["CANCEL", "SUPERSEDE", "REPAIR_COMPLETED_PROJECTION"].includes(action)) {
      fail("legacy_reconciliation_action_invalid");
    }
    const expectedStatus = String(input.expected_status || "").trim().toLowerCase();
    if (!["active", "verified", "release_ready", "completed", "blocked", "failed"].includes(expectedStatus)) {
      fail("legacy_reconciliation_expected_status_invalid");
    }
    const expectedClassification = String(input.expected_classification || "").trim().toUpperCase();
    if (!["STALE", "ABANDONED", "COMPLETED_BUT_UNCLOSED"].includes(expectedClassification)) {
      fail("legacy_reconciliation_expected_classification_invalid");
    }
    const reason = text(input.reason, "legacy_reconciliation_reason_required", 1_000);
    const idempotencyKey = text(input.idempotency_key, "legacy_reconciliation_idempotency_key_required", 160);
    const successorWorkId = input.successor_work_id
      ? uuid(input.successor_work_id, "legacy_reconciliation_successor_invalid")
      : null;
    const projectionRepair = action === "REPAIR_COMPLETED_PROJECTION";
    if ((action === "SUPERSEDE") !== Boolean(successorWorkId) || successorWorkId === workId ||
        (projectionRepair && (expectedStatus !== "completed" ||
          expectedClassification !== "COMPLETED_BUT_UNCLOSED"))) {
      fail("legacy_reconciliation_successor_invalid");
    }
    if (!projectionRepair && (expectedStatus === "completed" ||
        expectedClassification === "COMPLETED_BUT_UNCLOSED")) {
      fail("legacy_reconciliation_completed_action_invalid");
    }
    const targetStatus = action === "SUPERSEDE"
      ? "SUPERSEDED"
      : projectionRepair ? "COMPLETED" : "CANCELLED";
    const targetLegacyStatus = targetStatus.toLowerCase();
    const request = {
      tenant_id: actor.tenant_id,
      work_id: workId,
      action,
      expected_status: expectedStatus,
      expected_classification: expectedClassification,
      reason_digest: objectDigest(reason),
      successor_work_id: successorWorkId,
    };
    const requestDigest = objectDigest(request);
    const idempotencyKeyDigest = objectDigest({
      tenant_id: actor.tenant_id,
      work_id: workId,
      idempotency_key: idempotencyKey,
    });
    const confirmationReferenceDigest = objectDigest({
      tenant_id: actor.tenant_id,
      work_id: workId,
      confirmation_reference: confirmationReference,
    });

    return transaction(async (client) => {
      const legacyResult = await client.query(`SELECT
          work_id,project_id,parent_work_id,idea,objective,status,created_at,updated_at,next_action
        FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
      const legacy = legacyResult.rows[0];
      if (!legacy) fail("legacy_work_not_found");
      await projectLegacyWorkWithClient(client, actor, workId, legacy);
      const work = await loadWork(client, actor, workId, true);
      if (work.work_type !== "legacy") fail("legacy_reconciliation_work_type_invalid");

      const replay = await client.query(`SELECT payload,event_hash,sequence_number
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2
          AND event_type='legacy_work_reconciled_closed'
          AND payload->>'idempotency_key_digest'=$3
        ORDER BY sequence_number DESC LIMIT 1`,
      [actor.tenant_id, workId, idempotencyKeyDigest]);
      if (replay.rows[0]) {
        const payload = replay.rows[0].payload || {};
        if (payload.request_digest !== requestDigest) fail("legacy_reconciliation_idempotency_conflict");
        return {
          schema_version: "legacy_gallery_reconciliation_v1",
          tenant_id: actor.tenant_id,
          work_id: workId,
          action: payload.action,
          status: payload.status,
          legacy_status: payload.legacy_status,
          successor_work_id: payload.successor_work_id || null,
          classification: payload.classification,
          completed: payload.completed === true,
          closed: true,
          closure_receipt_created: false,
          server_evidence: payload.server_evidence || null,
          legacy_event_hash: payload.legacy_event_hash,
          v2_event_hash: replay.rows[0].event_hash,
          idempotent_replay: true,
        };
      }

      if (String(legacy.status || "").toLowerCase() !== expectedStatus) {
        fail("legacy_reconciliation_status_conflict");
      }
      const expectedV2Status = mapLegacyStatus(expectedStatus);
      if (!expectedV2Status || work.status !== expectedV2Status) {
        fail("legacy_reconciliation_projection_drift");
      }
      if (ARCHIVE_STATUSES.has(work.status) && !(projectionRepair && !work.closed_at)) {
        fail("legacy_reconciliation_already_closed");
      }

      const [participants, leases] = await Promise.all([
        client.query(`SELECT status,expires_at FROM core_continuity_participants
          WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]),
        client.query(`SELECT status,expires_at FROM core_continuity_leases
          WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]),
      ]);
      const stale = classifyStaleWork({ ...work, updated_at: legacy.updated_at,
        participants: participants.rows.map((row) => ({ ...row, active: row.status === "active" })),
        leases: leases.rows }, now());
      const currentTime = now().getTime();
      const activeParticipant = participants.rows.some((row) => row.status === "active" &&
        new Date(row.expires_at).getTime() > currentTime);
      const activeLease = leases.rows.some((row) => row.status === "active" &&
        new Date(row.expires_at).getTime() > currentTime);
      if (activeParticipant || activeLease) fail("legacy_reconciliation_active_work_denied");
      if (stale.classification !== expectedClassification) {
        fail("legacy_reconciliation_classification_conflict");
      }

      let serverEvidence = null;
      if (projectionRepair) {
        const verifiedLegacy = await client.query(`SELECT event_type,event_hash,created_at
          FROM core_continuity_events
          WHERE tenant_id=$1 AND work_id=$2
            AND event_type = ANY($3::varchar[])
          ORDER BY sequence_number DESC LIMIT 1`,
        [actor.tenant_id, workId, ["closure_finalized", "generic_closure_finalized"]]);
        if (!verifiedLegacy.rows[0]) fail("legacy_completed_server_evidence_required");
        serverEvidence = {
          source: "legacy_closure_finalized_event",
          successor_work_id: null,
          observed_at: verifiedLegacy.rows[0].created_at,
          evidence_digest: objectDigest({
            event_type: verifiedLegacy.rows[0].event_type,
            event_hash: verifiedLegacy.rows[0].event_hash,
          }),
        };
      } else if (successorWorkId) {
        const successorLegacyResult = await client.query(`SELECT work_id,project_id,status
          FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR SHARE`,
        [actor.tenant_id, successorWorkId]);
        const successorV2Result = await client.query(`SELECT work_id,legacy_work_id,project_id,status
          FROM tenant_work WHERE tenant_id=$1 AND (work_id=$2 OR legacy_work_id=$2) FOR SHARE`,
        [actor.tenant_id, successorWorkId]);
        const successorLegacy = successorLegacyResult.rows[0] || null;
        const successorV2 = successorV2Result.rows[0] || null;
        if (!successorLegacy && !successorV2) fail("legacy_reconciliation_successor_not_found");
        if ((successorLegacy?.project_id || successorV2?.project_id) !== legacy.project_id) {
          fail("legacy_reconciliation_successor_project_mismatch");
        }
        if (expectedStatus === "release_ready") {
          const successorV2Id = successorV2?.work_id || successorWorkId;
          const verifiedV2 = await client.query(`SELECT
              r.receipt_digest,f.report_digest,tw.status
            FROM tenant_work tw
            JOIN tenant_work_closure_receipt r
              ON r.tenant_id=tw.tenant_id AND r.work_id=tw.work_id
            JOIN tenant_work_final_report f
              ON f.tenant_id=tw.tenant_id AND f.work_id=tw.work_id
            WHERE tw.tenant_id=$1 AND tw.work_id=$2
              AND tw.status IN ('COMPLETED','ARCHIVED')`,
          [actor.tenant_id, successorV2Id]);
          const verifiedLegacy = await client.query(`SELECT event_type,event_hash
            FROM core_continuity_events
            WHERE tenant_id=$1 AND work_id=$2
              AND event_type = ANY($3::varchar[])
            ORDER BY sequence_number DESC LIMIT 1`,
          [actor.tenant_id, successorWorkId, ["closure_finalized", "generic_closure_finalized"]]);
          if (verifiedV2.rows[0]) {
            serverEvidence = {
              source: "tenant_work_closure_receipt",
              successor_work_id: successorWorkId,
              evidence_digest: objectDigest({
                receipt_digest: verifiedV2.rows[0].receipt_digest,
                report_digest: verifiedV2.rows[0].report_digest,
              }),
            };
          } else if (String(successorLegacy?.status || "").toLowerCase() === "completed" &&
              verifiedLegacy.rows[0]) {
            serverEvidence = {
              source: "legacy_closure_finalized_event",
              successor_work_id: successorWorkId,
              evidence_digest: objectDigest({
                event_type: verifiedLegacy.rows[0].event_type,
                event_hash: verifiedLegacy.rows[0].event_hash,
              }),
            };
          } else {
            fail("legacy_release_ready_server_evidence_required");
          }
        }
      } else if (expectedStatus === "release_ready") {
        fail("legacy_release_ready_server_evidence_required");
      }

      const updatedV2 = await client.query(`UPDATE tenant_work SET
          status=$3::varchar(24),closed_at=COALESCE(closed_at,$7::timestamptz,now()),
          cancelled_at=CASE WHEN $3::varchar(24)='CANCELLED'
            THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END,
          archived_at=COALESCE(archived_at,now()),closure_type='legacy_reconciliation',
          closure_reason=$4,next_action='',successor_work_id=$5,superseded_by_work_id=$5,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND status=$6::varchar(24)
        RETURNING closed_at,archived_at`,
      [actor.tenant_id, workId, targetStatus, reason, successorWorkId, expectedV2Status,
        serverEvidence?.observed_at || null]);
      if (!updatedV2.rows[0]) fail("legacy_reconciliation_status_conflict");
      if (!projectionRepair) {
        const updatedLegacy = await client.query(`UPDATE core_continuity_works SET
            status=$3,next_action='',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND status=$4
          RETURNING updated_at`,
        [actor.tenant_id, workId, targetLegacyStatus, expectedStatus]);
        if (!updatedLegacy.rows[0]) fail("legacy_reconciliation_status_conflict");
      }

      const previousLegacyEvent = await client.query(`SELECT sequence_number,event_hash
        FROM core_continuity_events
        WHERE tenant_id=$1 AND work_id=$2
        ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [actor.tenant_id, workId]);
      const legacySequence = Number(previousLegacyEvent.rows[0]?.sequence_number || 0) + 1;
      const auditPayload = {
        action,
        classification: stale.classification,
        completed: projectionRepair,
        confirmation_reference_digest: confirmationReferenceDigest,
        expected_status: expectedStatus,
        idempotency_key_digest: idempotencyKeyDigest,
        legacy_status: targetLegacyStatus,
        reason,
        reason_digest: request.reason_digest,
        request_digest: requestDigest,
        server_evidence: serverEvidence,
        status: targetStatus,
        successor_work_id: successorWorkId,
      };
      const legacyEvent = {
        tenant_id: actor.tenant_id,
        work_id: workId,
        sequence_number: legacySequence,
        event_type: "legacy_work_reconciled_closed",
        payload: auditPayload,
        previous_event_hash: previousLegacyEvent.rows[0]?.event_hash || null,
      };
      const legacyEventHash = objectDigest(legacyEvent);
      await client.query(`INSERT INTO core_continuity_events
        (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [actor.tenant_id, workId, crypto.randomUUID(), legacySequence, legacyEvent.event_type,
        JSON.stringify(auditPayload), legacyEvent.previous_event_hash, legacyEventHash,
        actor.agent_id || actor.user_id]);
      const v2Event = await appendV2Event(client, actor, workId, "legacy_work_reconciled_closed", {
        ...auditPayload,
        legacy_event_hash: legacyEventHash,
      });
      return {
        schema_version: "legacy_gallery_reconciliation_v1",
        tenant_id: actor.tenant_id,
        work_id: workId,
        action,
        status: targetStatus,
        legacy_status: targetLegacyStatus,
        successor_work_id: successorWorkId,
        classification: stale.classification,
        completed: projectionRepair,
        closed: true,
        closure_receipt_created: false,
        server_evidence: serverEvidence,
        legacy_event_hash: legacyEventHash,
        v2_event_hash: v2Event.event_hash,
        idempotent_replay: false,
      };
    });
  }
  async function closureState(client, actor, workId, lock = false) {
    const work = await loadWork(client, actor, workId, lock);
    const [evidence, join, receipt] = await Promise.all([
      client.query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 AND required=true", [actor.tenant_id, workId]),
      client.query("SELECT * FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
      client.query("SELECT * FROM tenant_work_closure_receipt WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
    ]);
    return { work, evidence: evidence.rows, join: join.rows[0] || null, receipt: receipt.rows[0] || null };
  }
  async function verifyAndBackfillExistingClosure(client, actor, state, adapter) {
    const workId = state.work.work_id;
    const [tasks, reportResult, eventResult] = await Promise.all([
      client.query("SELECT * FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY task_id", [actor.tenant_id, workId]),
      client.query("SELECT tenant_id,work_id,report,report_digest,created_at FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
      client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,previous_event_hash,event_hash
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2 AND event_type='generic_closure_finalized'
        ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [actor.tenant_id, workId]),
    ]);
    const reportRow = reportResult.rows[0] || null;
    const report = plainRecord(reportRow?.report) ? reportRow.report : null;
    if (!report) fail("work_closure_projection_backfill_invalid");
    const reportDigest = objectDigest(report);
    let projectionBackfilled = reportRow.report_digest !== reportDigest;
    if (projectionBackfilled) {
      const legacyReportDigest = deriveLegacyFinalReportDigest(report);
      if (!legacyReportDigest || reportRow.report_digest !== legacyReportDigest) {
        fail("work_closure_projection_backfill_invalid");
      }
      await client.query(`UPDATE tenant_work_final_report SET report_digest=$3
        WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, workId, reportDigest]);
    }

    let closureEvent = eventResult.rows[0] || null;
    if (!closureEvent) {
      await appendV2Event(client, actor, workId, "generic_closure_finalized", {
        adapter,
        archived: true,
        closure_receipt_digest: state.receipt?.receipt_digest,
        core_join_digest: state.join?.core_join_digest,
        final_evidence_digest: state.work.final_evidence_digest,
        report_digest: reportDigest,
      });
      const appended = await client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,previous_event_hash,event_hash
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2 AND event_type='generic_closure_finalized'
        ORDER BY sequence_number DESC LIMIT 1`, [actor.tenant_id, workId]);
      closureEvent = appended.rows[0] || null;
      projectionBackfilled = true;
    }

    const verification = deriveTenantWorkClosureVerification({
      tenant_id: actor.tenant_id,
      work: state.work,
      tasks: tasks.rows,
      evidence: state.evidence,
      core_join: state.join,
      closure_receipt: state.receipt,
      final_report: { ...reportRow, report_digest: reportDigest },
      closure_event: closureEvent,
    }, {
      verifyCoreJoin: (context) => Boolean(
        resolvedCoreJoinVerifier && resolvedCoreJoinVerifier.verify(context),
      ),
    });
    if (!verification.verified) fail("work_closure_projection_backfill_invalid");
    return { report, projection_backfilled: projectionBackfilled, verification };
  }
  async function evaluateGenericClosure(identity, { work_id, adapter }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    if (!CLOSURE_ADAPTERS.includes(adapter)) fail("work_closure_adapter_invalid");
    const state = await transaction((client) => closureState(client, actor, workId, false));
    assertPermission(canRead, state.work, actor);
    if (state.work.work_type !== adapter) fail("work_closure_adapter_mismatch");
    const independent = state.evidence.length > 0 && state.evidence.every((item) => item.independently_verified === true && item.verified_by_agent_id !== state.work.created_by_agent_id);
    return { work_id: workId, adapter, ready: Boolean(independent && state.join), independent_verification_persisted: independent, core_join_persisted: Boolean(state.join), idempotent_receipt: Boolean(state.receipt) };
  }
  async function buildGenericCoreJoinRequest(identity, { work_id, adapter, idempotency_key }) {
    await initialize();
    if (String(verifierReceiptSigningSecret).length < 32) fail("generic_verifier_receipt_signing_unavailable");
    if (!CLOSURE_ADAPTERS.includes(adapter)) fail("work_closure_adapter_invalid");
    const actor = actorFromIdentity(identity);
    if (!actor.agent_id || !actor.session_fingerprint) fail("generic_core_join_requester_presence_required");
    const state = await transaction(async (client) => {
      const work = await loadWork(client, actor, uuid(work_id), false);
      assertPermission(canClose, work, actor);
      if (work.work_type !== adapter) fail("work_closure_adapter_mismatch");
      const tasks = await client.query("SELECT * FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY task_id", [actor.tenant_id, work.work_id]);
      const evidence = await client.query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY created_at,evidence_id", [actor.tenant_id, work.work_id]);
      return { work, tasks: tasks.rows, evidence: evidence.rows };
    });
    if (!state.tasks.length || state.tasks.some((task) => task.status !== "completed" || task.acceptance_verified !== true)) fail("generic_core_join_tasks_incomplete");
    if (!state.evidence.length || state.evidence.some((item) => item.independently_verified !== true)) fail("generic_core_join_evidence_incomplete");
    const verifier = state.evidence.find((item) => item.verified_by_agent_id && item.verified_by_session_fingerprint);
    if (!verifier || verifier.verified_by_agent_id === state.work.created_by_agent_id || verifier.verified_by_session_fingerprint === state.work.created_by_session_fingerprint) fail("generic_core_join_verifier_not_independent");
    const evidenceDigests = state.evidence.map((item) => item.digest).sort();
    const evidenceDigest = objectDigest(evidenceDigests);
    const acceptanceCriteria = (state.work.acceptance_criteria || []).map((criterion, index) => ({
      criterion_id: `criterion-${String(index + 1).padStart(3, "0")}`,
      criterion_digest: objectDigest(criterion), evidence_digest: evidenceDigest,
      verification_digest: verifier.digest,
    }));
    const taskState = state.tasks.map((task) => ({ task_id: task.task_id,
      task_state_digest: objectDigest({ status: task.status, acceptance_verified: task.acceptance_verified }),
      completion_evidence_digest: evidenceDigest, verification_digest: verifier.digest }));
    const issuedAt = now();
    const receipt = {
      schema_version: "generic_work_independent_verifier_receipt_v1", tenant_id: actor.tenant_id,
      work_id: state.work.work_id, adapter, acceptance_criteria_digest: objectDigest(acceptanceCriteria),
      task_state_digest: objectDigest(taskState), evidence_digest: objectDigest(evidenceDigests),
      verification_digest: verifier.digest, verifier_identity: verifier.verified_by_agent_id,
      session_id: verifier.verified_by_session_fingerprint, nonce: crypto.randomUUID(),
      issued_at: issuedAt.toISOString(), expires_at: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    };
    receipt.signature = crypto.createHmac("sha256", verifierReceiptSigningSecret)
      .update(`generic_work_verifier_receipt_v1\0${objectDigest(receipt)}`).digest("base64url");
    return { tenant_id: actor.tenant_id, work_id: state.work.work_id, adapter,
      requester_identity: actor.agent_id, requester_session_id: actor.session_fingerprint,
      idempotency_digest: objectDigest({ work_id: state.work.work_id, adapter, idempotency_key }),
      acceptance_criteria: acceptanceCriteria, task_state: taskState, evidence_digests: evidenceDigests,
      independent_verifier_receipt: receipt };
  }
  async function finalizeGenericClosure(identity, { work_id, adapter }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    if (!CLOSURE_ADAPTERS.includes(adapter)) fail("work_closure_adapter_invalid");
    return transaction(async (client) => {
      const state = await closureState(client, actor, workId, true);
      assertPermission(canClose, state.work, actor);
      if (state.work.work_type !== adapter) fail("work_closure_adapter_mismatch");
      if (state.receipt) {
        const replay = await verifyAndBackfillExistingClosure(client, actor, state, adapter);
        return { receipt: state.receipt, final_report: replay.report, idempotent_replay: true,
          projection_backfilled: replay.projection_backfilled,
          closure_verification: replay.verification, archive_status: "ARCHIVED" };
      }
      const tasks = await client.query("SELECT status,acceptance_verified FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true", [actor.tenant_id, workId]);
      const independent = state.evidence.length > 0 && state.evidence.every((item) => item.independently_verified === true && item.verified_by_agent_id !== state.work.created_by_agent_id);
      const completeTasks = tasks.rows.length > 0 && tasks.rows.every((item) => item.status === "completed" && item.acceptance_verified === true);
      if (!independent || !completeTasks || !state.join) fail("work_closure_gate_unsatisfied");
      const finalEvidenceDigest = crypto.createHash("sha256").update(JSON.stringify(state.evidence.map((item) => item.digest).sort())).digest("hex");
      const finalized = buildGenericClosureArtifacts({ ...state.work, progress_bp: state.work.progress_bp }, {
        adapter, server_verified_closure_context: { schema_version: "work_closure_context_v1",
          server_verified: true, independent_verification: { passed: true },
          core_join: { received: true, digest: state.join.core_join_digest }, final_evidence_digest: finalEvidenceDigest,
          evidence_summary: state.evidence.map((item) => ({ kind: item.kind, digest: item.digest })) },
      });
      const reportDigest = objectDigest(finalized.final_report);
      await client.query(`INSERT INTO tenant_work_closure_receipt (tenant_id,receipt_id,work_id,adapter,core_join_digest,final_evidence_digest,receipt_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actor.tenant_id, finalized.receipt.receipt_id, workId, adapter, state.join.core_join_digest, finalEvidenceDigest, finalized.receipt.receipt_digest]);
      await client.query(`INSERT INTO tenant_work_final_report (tenant_id,work_id,report,report_digest) VALUES ($1,$2,$3::jsonb,$4)`,
        [actor.tenant_id, workId, JSON.stringify(finalized.final_report), reportDigest]);
      await client.query(`UPDATE tenant_work SET status='COMPLETED',closed_at=now(),archived_at=now(),final_evidence_digest=$3,closure_type=$4,closure_reason='acceptance_criteria_verified',progress_bp=10000,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, workId, finalEvidenceDigest, adapter]);
      await appendV2Event(client, actor, workId, "generic_closure_finalized", {
        adapter,
        archived: true,
        closure_receipt_digest: finalized.receipt.receipt_digest,
        core_join_digest: state.join.core_join_digest,
        final_evidence_digest: finalEvidenceDigest,
        report_digest: reportDigest,
      });
      if (state.work.legacy_work_id) {
        await client.query(`UPDATE core_continuity_works SET status='completed',next_action='',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, state.work.legacy_work_id]);
        const previous = await client.query(`SELECT sequence_number,event_hash FROM core_continuity_events
          WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
        [actor.tenant_id, state.work.legacy_work_id]);
        const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
        const payload = { adapter, closure_receipt_digest: finalized.receipt.receipt_digest,
          final_evidence_digest: finalEvidenceDigest, report_digest: objectDigest(finalized.final_report), archived: true };
        const event = { tenant_id: actor.tenant_id, work_id: state.work.legacy_work_id,
          sequence_number: sequence, event_type: "generic_closure_finalized", payload,
          previous_event_hash: previous.rows[0]?.event_hash || null };
        await client.query(`INSERT INTO core_continuity_events
          (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [actor.tenant_id, state.work.legacy_work_id,
          crypto.randomUUID(), sequence, event.event_type, JSON.stringify(payload), event.previous_event_hash,
          objectDigest(event), actor.agent_id || actor.user_id]);
      }
      return { receipt: finalized.receipt, final_report: finalized.final_report, idempotent_replay: false, archive_status: "ARCHIVED" };
    });
  }
  return Object.freeze({ initialize, createWork, createNewWork, readCreatedWorkByBootstrapRequest, queueNewWork,
    ensureLegacyBridge,
    projectLegacyWork, projectLegacyCatalog, projectLegacyEvent, backfillLegacyProjection,
    readWork, verifyWorkClosure, listWorks, assignQueuedWork, acceptQueuedWorkAssignment, archiveWork, reopenWork,
    preflightGallery, openWorkReview,
    recordTask, recordEvidence, recordNativeVerifierEvidenceWithClient,
    persistCoreJoin, refreshDerived, reconcileStaleDryRun,
    reconcileLegacyClosed,
    evaluateGenericClosure, buildGenericCoreJoinRequest, finalizeGenericClosure,
    coreJoinVerifierMetadata: resolvedCoreJoinVerifier?.metadata || null,
    verifyCoreJoinVerdict: (verdict, expected) => Boolean(
      resolvedCoreJoinVerifier && resolvedCoreJoinVerifier.verify(verdict, expected)),
  });
}

export { ADDITIVE_SCHEMA_SQL, actorFromIdentity };
