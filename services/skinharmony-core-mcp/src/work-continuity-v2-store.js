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
import {
  buildNativeV2TaskBinding,
  evaluateTaskScopedNativeVerifierEvidence,
  verifiedNativePrecommitWorkspaceDigest,
} from "./work-continuity-runtime.js";
import { createRetryablePostgresInitializer } from "../../shared/retryable-postgres-initializer.js";
import { buildNativePlanMergePreview } from "./native-plan-merge-preview.js";

// This is a diagnostic-presence lease only.  It is created by Nyra before an
// exact Work read and deliberately grants no execution authority.  Historical
// bridge archival must not mistake that server-created read context for live
// Work execution, while still refusing every real lease, branch or unleased
// active participant.
const NYRA_READ_ONLY_LEASE_PURPOSE = "Nyra governed read-only Work context";
const HISTORICAL_BLOCKED_TIMESTAMP_REPAIR_MIN_AGE_MS = 72 * 60 * 60 * 1_000;

function isAttestedNyraReadOnlyLease(row) {
  return row?.branch_id == null && row?.purpose === NYRA_READ_ONLY_LEASE_PURPOSE &&
    row?.nyra_read_binding_attested === true;
}

// A signed Nyra diagnostic binding grants no execution authority.  It must
// remain auditable, but it cannot turn a dormant legacy Work into an active
// execution or prevent its owner-confirmed historical reconciliation.  Keep
// every other live lease or participant in the staleness input fail-closed.
function stalenessExecutionActivity(participants = [], leases = [], at = Date.now()) {
  const activeLeasesBySession = new Map();
  const activeParticipantsBySession = new Map();
  for (const lease of leases) {
    if (lease?.status !== "active" || new Date(lease.expires_at).getTime() <= at) continue;
    const rows = activeLeasesBySession.get(lease.session_id) || [];
    rows.push(lease);
    activeLeasesBySession.set(lease.session_id, rows);
  }
  for (const participant of participants) {
    if (participant?.status !== "active" || new Date(participant.expires_at).getTime() <= at) continue;
    const rows = activeParticipantsBySession.get(participant.session_id) || [];
    rows.push(participant);
    activeParticipantsBySession.set(participant.session_id, rows);
  }
  const readOnlySessions = new Set(
    [...activeLeasesBySession.entries()]
      .filter(([sessionId, rows]) => {
        const sessionParticipants = activeParticipantsBySession.get(sessionId) || [];
        return rows.length > 0 && sessionParticipants.length > 0 &&
          rows.every(isAttestedNyraReadOnlyLease) &&
          sessionParticipants.every((participant) => participant.branch_id == null);
      })
      .map(([sessionId]) => sessionId),
  );
  return {
    participants: participants.filter((participant) => !readOnlySessions.has(participant.session_id)),
    leases: leases.filter((lease) => !readOnlySessions.has(lease.session_id)),
    read_only_binding_count: [...activeLeasesBySession.values()]
      .flat()
      .filter(isAttestedNyraReadOnlyLease).length,
    execution_activity_count: participants.filter((participant) =>
      !readOnlySessions.has(participant.session_id) && participant.status === "active" &&
      new Date(participant.expires_at).getTime() > at).length +
      leases.filter((lease) => !readOnlySessions.has(lease.session_id) && lease.status === "active" &&
        new Date(lease.expires_at).getTime() > at).length,
  };
}

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
ALTER TABLE tenant_work_task ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1 CHECK (weight > 0);
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS verified_by_agent_id varchar(128);
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS verified_by_session_fingerprint varchar(128);
ALTER TABLE IF EXISTS tenant_work_native_verifier_evidence ADD COLUMN IF NOT EXISTS v2_task_id uuid;
ALTER TABLE IF EXISTS tenant_work_native_verifier_evidence ADD COLUMN IF NOT EXISTS v2_task_digest char(64);
ALTER TABLE IF EXISTS core_continuity_leases
  ADD COLUMN IF NOT EXISTS nyra_read_binding_attested boolean NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS tenant_work_precommit_ticket_gate ADD COLUMN IF NOT EXISTS gate_source varchar(48)
  NOT NULL DEFAULT 'legacy_evidence_reconciliation';
ALTER TABLE IF EXISTS tenant_work_precommit_ticket_gate
  ADD COLUMN IF NOT EXISTS v2_scope_snapshot_digest char(64);
ALTER TABLE IF EXISTS tenant_work_precommit_ticket_gate
  ADD COLUMN IF NOT EXISTS v2_scope_tasks jsonb;
ALTER TABLE IF EXISTS tenant_work_precommit_ticket_gate_supersession ADD COLUMN IF NOT EXISTS gate_source varchar(48)
  NOT NULL DEFAULT 'legacy_evidence_reconciliation';
ALTER TABLE IF EXISTS tenant_work_precommit_ticket_gate_supersession
  ADD COLUMN IF NOT EXISTS v2_scope_snapshot_digest char(64);
ALTER TABLE IF EXISTS tenant_work_precommit_ticket_gate_supersession
  ADD COLUMN IF NOT EXISTS v2_scope_tasks jsonb;
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
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260829_precommit_ticket_reconciliation_v1') ON CONFLICT DO NOTHING;
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260830_precommit_ticket_gate_supersession_v1') ON CONFLICT DO NOTHING;
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260901_native_precommit_ticket_gate_v2') ON CONFLICT DO NOTHING;
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260901_precommit_ticket_gate_claim_v1') ON CONFLICT DO NOTHING;
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260903_native_v2_task_revision_v1') ON CONFLICT DO NOTHING;
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
const NYRA_AUTOPILOT_VERIFICATION_FIELDS = Object.freeze([
  "schema_version", "verdict", "summary", "verified_work_task_ids",
  "verified_assignment_ids", "evidence_refs",
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
  return normalized.toLowerCase();
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

function nativePlanSupersessionDigest(rows = []) {
  return objectDigest({
    schema_version: "native_plan_supersession_set_v1",
    plans: rows.map((row) => ({
      plan_id: row.plan_id,
      plan_digest: row.plan_digest,
      status: row.status,
      plan_version: Number(row.plan_version || 0),
      supersedes_plan_id: row.supersedes_plan_id || null,
    })).sort((left, right) =>
      left.plan_version - right.plan_version || left.plan_id.localeCompare(right.plan_id)),
  });
}

function reportHasPassingTests(report) {
  return Array.isArray(report?.tests) && report.tests.length > 0 &&
    report.tests.every((item) => item?.passed === true);
}

function reportHasProvenVerifierEvidence(report, {
  matchingPrecommitEvidence = false,
  matchingV2TaskBinding = false,
} = {}) {
  const acceptanceEvidence = Array.isArray(report?.acceptance_evidence)
    ? report.acceptance_evidence
    : [];
  const acceptanceProven = acceptanceEvidence.length > 0 &&
    acceptanceEvidence.every((item) => item?.passed === true &&
      Array.isArray(item?.evidence_refs) && item.evidence_refs.length > 0);
  const precommitProven = acceptanceEvidence.length === 0 &&
    matchingPrecommitEvidence === true && matchingV2TaskBinding === true;
  return Array.isArray(report?.evidence_refs) && report.evidence_refs.length > 0 &&
    (acceptanceProven || precommitProven);
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactObjectKeys(value, fields) {
  return plainRecord(value) &&
    Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

// A Nyra worker submission is useful evidence, but it is not acceptance on
// its own.  Only a separately claimed `independent_verifier` assignment may
// project it into the canonical V2 Work ledger, and it must name every
// required Work task as well as the submitted assignments it checked.
export function normalizeNyraAutopilotVerificationResult(value, {
  workId,
  requiredTaskIds = [],
  verifier = {},
  sourceAssignments = [],
} = {}) {
  if (!exactObjectKeys(value, NYRA_AUTOPILOT_VERIFICATION_FIELDS) ||
      value.schema_version !== "nyra_independent_verification_v1" ||
      !["approved", "rejected"].includes(value.verdict)) {
    fail("nyra_autopilot_verification_contract_invalid");
  }
  const expectedTasks = [...new Set(requiredTaskIds.map((taskId) => uuid(taskId, "nyra_autopilot_verification_task_invalid")))].sort();
  if (!expectedTasks.length) fail("nyra_autopilot_verification_tasks_required");
  const verifiedTasks = stringArray(value.verified_work_task_ids, "nyra_autopilot_verification_task_invalid", 250, 36)
    .map((taskId) => uuid(taskId, "nyra_autopilot_verification_task_invalid")).sort();
  if (!verifiedTasks.length || verifiedTasks.some((taskId) => !expectedTasks.includes(taskId)) ||
      (value.verdict === "approved" && (verifiedTasks.length !== expectedTasks.length ||
        verifiedTasks.some((taskId, index) => taskId !== expectedTasks[index])))) {
    fail("nyra_autopilot_verification_scope_invalid");
  }
  const sourceIds = stringArray(value.verified_assignment_ids, "nyra_autopilot_verification_assignment_invalid", 16, 36)
    .map((assignmentId) => uuid(assignmentId, "nyra_autopilot_verification_assignment_invalid")).sort();
  if (!sourceIds.length) fail("nyra_autopilot_verification_sources_required");
  const sources = new Map(sourceAssignments.map((assignment) => [assignment.assignment_id, assignment]));
  const materialSourceIds = sourceAssignments
    .filter((assignment) => assignment?.status === "submitted" && assignment.role !== "independent_verifier")
    .map((assignment) => assignment.assignment_id)
    .sort();
  if (value.verdict === "approved" && (
    sourceIds.length !== materialSourceIds.length ||
    sourceIds.some((assignmentId, index) => assignmentId !== materialSourceIds[index])
  )) fail("nyra_autopilot_verification_source_coverage_required");
  // The Autopilot table intentionally stores the durable claim as
  // `claimed_*`; the runtime-facing shape uses `agent_id` /
  // `session_fingerprint`.  Accept both server-owned representations here,
  // but never a caller-provided identity: the candidate loader above binds
  // the selected assignment to the authenticated actor before this function
  // runs.
  const verifierAgentId = text(
    verifier.agent_id ?? verifier.claimed_agent_id,
    "nyra_autopilot_verifier_identity_required",
    120,
  );
  const verifierSession = text(
    verifier.session_fingerprint ?? verifier.claimed_session_fingerprint,
    "nyra_autopilot_verifier_identity_required",
    80,
  );
  for (const assignmentId of sourceIds) {
    const source = sources.get(assignmentId);
    if (!source || source.status !== "submitted" || source.role === "independent_verifier" ||
        !source.claimed_agent_id || !source.claimed_session_fingerprint ||
        source.claimed_agent_id === verifierAgentId ||
        source.claimed_session_fingerprint === verifierSession) {
      fail("nyra_autopilot_verification_independence_required");
    }
  }
  const evidenceRefs = stringArray(value.evidence_refs, "nyra_autopilot_verification_evidence_invalid", 100, 500);
  if (!evidenceRefs.length) fail("nyra_autopilot_verification_evidence_required");
  return Object.freeze({
    schema_version: value.schema_version,
    verdict: value.verdict,
    work_id: uuid(workId, "work_id_invalid"),
    verifier_agent_id: verifierAgentId,
    verifier_session_fingerprint: verifierSession,
    summary: text(value.summary, "nyra_autopilot_verification_summary_required", 8_000),
    verified_work_task_ids: Object.freeze(verifiedTasks),
    verified_assignment_ids: Object.freeze(sourceIds),
    evidence_refs: Object.freeze(evidenceRefs),
  });
}

export function buildNyraAutopilotVerificationReplay(candidate, evidenceDigest) {
  return Object.freeze({
    ...candidate,
    evidence_digest: evidenceDigest,
    idempotent_replay: true,
    ...(candidate.verification.verdict === "rejected" ? { task_projection: "not_applied" } : {}),
  });
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
const CLOSURE_EVENT_COORDINATION_FIELDS = Object.freeze([
  ...CLOSURE_EVENT_PAYLOAD_FIELDS,
  "released_lease_count",
  "closed_participant_count",
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
      !(
        exactObjectKeys(eventPayload, CLOSURE_EVENT_PAYLOAD_FIELDS) ||
        (
          exactObjectKeys(eventPayload, CLOSURE_EVENT_COORDINATION_FIELDS) &&
          Number.isSafeInteger(Number(eventPayload.released_lease_count)) &&
          Number(eventPayload.released_lease_count) >= 0 &&
          Number.isSafeInteger(Number(eventPayload.closed_participant_count)) &&
          Number(eventPayload.closed_participant_count) >= 0
        )
      ) ||
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
  const verifySignedDigest = ({ digest: signedDigest, signature, key_id, signature_domain } = {}) => {
    if (!HASH.test(String(signedDigest || "")) || key_id !== keyId ||
        signature_domain !== GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION) return false;
    const signatureBytes = decodeGenericWorkCoreJoinSignature(signature);
    if (!signatureBytes) return false;
    try {
      return crypto.verify(
        null,
        Buffer.from(`${GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION}\0${signedDigest}`, "utf8"),
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
    verifySignedDigest,
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
function normalizeResolutionWorks(rows) {
  // resolveWorkRequest intentionally preserves input order for equal scores.
  // Database row order is not stable without ORDER BY, so canonicalize on the
  // immutable Work identity before taking its bounded top-five candidate set.
  return rows.map(normalizeWork).sort((left, right) =>
    String(left.work_id || "").localeCompare(String(right.work_id || "")));
}
const CANONICAL_OPEN_REVIEW_WORKS_QUERY = `SELECT * FROM tenant_work
  WHERE tenant_id=$1 AND status = ANY($2)
  ORDER BY work_id ASC`;
const OPEN_REVIEW_RESOLUTION_CONTRACT_SCHEMA = "tenant_work_open_review_resolution_contract_v1";
const OPEN_REVIEW_WORK_PROJECTION_DIGEST = objectDigest({
  schema_version: "tenant_work_open_review_work_projection_v1",
  query: CANONICAL_OPEN_REVIEW_WORKS_QUERY,
  operational_statuses: [...OPERATIONAL_STATUSES].sort(),
});
async function canonicalOpenReviewWorks(client, actor) {
  const result = await client.query(CANONICAL_OPEN_REVIEW_WORKS_QUERY, [
    actor.tenant_id,
    [...OPERATIONAL_STATUSES],
  ]);
  return normalizeResolutionWorks(result.rows);
}
function openReviewResolutionContract(query, projectId, intentDigest) {
  const resolverQuery = text(query, "work_review_request_invalid", 8_000);
  const unsigned = {
    schema_version: OPEN_REVIEW_RESOLUTION_CONTRACT_SCHEMA,
    resolver_query: resolverQuery,
    resolver_query_digest: objectDigest({
      schema_version: "tenant_work_open_review_resolver_query_v1",
      resolver_query: resolverQuery,
    }),
    work_projection_digest: OPEN_REVIEW_WORK_PROJECTION_DIGEST,
    project_id: projectId,
    intent_digest: intentDigest || null,
  };
  return { ...unsigned, contract_digest: objectDigest(unsigned) };
}
function validatedOpenReviewResolutionContract(review, projectId, intentDigest) {
  const contract = review?.review_result?.resolution_contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    fail("open_work_review_resolution_contract_invalid");
  }
  const expected = openReviewResolutionContract(
    contract.resolver_query,
    projectId,
    intentDigest,
  );
  if (Object.keys(contract).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([name, value]) => contract[name] !== value)) {
    fail("open_work_review_resolution_contract_invalid");
  }
  return expected;
}
function openReviewRequiresRefresh(review, projectId, intentDigest, nowValue) {
  if (review?.consumed_at || review?.consumed_work_id) return false;
  if (!review?.review_result?.resolution_contract) return true;
  validatedOpenReviewResolutionContract(review, projectId, intentDigest);
  const expiresAt = Date.parse(String(review.expires_at || ""));
  if (!Number.isFinite(expiresAt)) fail("open_work_review_expiry_invalid");
  return expiresAt <= nowValue.getTime();
}
function visibleProjectResolutionCandidates(resolution, works, projectId, actor) {
  const visibleIds = new Set(works
    .filter((work) => work.project_id === projectId && canRead(work, actor))
    .map((work) => work.work_id));
  return resolution.candidates.filter((candidate) => visibleIds.has(candidate.work_id));
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

function independentlyVerifiedGenericEvidence(item, work = {}) {
  if (!plainRecord(item) || item.independently_verified !== true) return false;
  const verifierAgentId = String(item.verified_by_agent_id || "").trim();
  const verifierSession = String(item.verified_by_session_fingerprint || "").trim();
  const creatorAgentId = String(work.created_by_agent_id || "").trim();
  const creatorSession = String(work.created_by_session_fingerprint || "").trim();
  return Boolean(
    verifierAgentId && verifierSession &&
    (!creatorAgentId || verifierAgentId !== creatorAgentId) &&
    (!creatorSession || verifierSession !== creatorSession)
  );
}

function authoritativeNativeReleaseEvidence(item, work = {}) {
  return Boolean(
    item?.kind === "owner_manual_merge_release" &&
    independentlyVerifiedGenericEvidence(item, work) &&
    item?.metadata?.schema_version ===
      "tenant_work_owner_manual_merge_release_evidence_v1" &&
    item?.metadata?.tenant_id === work?.tenant_id &&
    item?.metadata?.work_id === work?.work_id &&
    item?.metadata?.note === "owner_manual_merge" &&
    item?.metadata?.provider_execution === false &&
    item?.verified_by_agent_id === "universal_core_owner_manual_merge_release" &&
    item?.digest === objectDigest(item.metadata)
  );
}

export function deriveGenericClosureReadiness(state = {}) {
  const work = plainRecord(state.work) ? state.work : {};
  const tasks = Array.isArray(state.tasks)
    ? state.tasks.filter((item) => item?.required !== false)
    : [];
  const evidence = Array.isArray(state.evidence)
    ? state.evidence.filter((item) => item?.required !== false)
    : [];
  const completedTasks = tasks.filter((item) =>
    item?.status === "completed" && item?.acceptance_verified === true);
  const independentlyVerifiedEvidence = evidence.filter((item) =>
    independentlyVerifiedGenericEvidence(item, work));
  const requiredTasksComplete = tasks.length > 0 && completedTasks.length === tasks.length;
  const independentVerificationPersisted = evidence.length > 0 &&
    independentlyVerifiedEvidence.length === evidence.length;
  // This evidence kind is intrinsically task-scoped.  Only the separate,
  // server-verified full-release path may add Work-wide closure authority.
  const nativeTaskEvidencePresent = evidence.some((item) =>
    item?.kind === "native_verifier_terminal_report");
  const nativeReleaseAuthorityPersisted = evidence.some((item) =>
    authoritativeNativeReleaseEvidence(item, work));
  const nativeTaskEvidenceOnly = nativeTaskEvidencePresent &&
    !nativeReleaseAuthorityPersisted;
  const coreJoinPersisted = Boolean(state.join);
  const missing = [];
  if (!tasks.length) missing.push("required_tasks_missing");
  else if (!requiredTasksComplete) missing.push("required_tasks_incomplete");
  if (!evidence.length) missing.push("required_evidence_missing");
  else if (!independentVerificationPersisted) missing.push("independent_verification_missing");
  if (nativeTaskEvidenceOnly) missing.push("native_closure_required");
  if (!coreJoinPersisted) missing.push("core_join_missing");
  return Object.freeze({
    ready: missing.length === 0,
    required_tasks_complete: requiredTasksComplete,
    independent_verification_persisted: independentVerificationPersisted,
    core_join_persisted: coreJoinPersisted,
    idempotent_receipt: Boolean(state.receipt),
    required_task_count: tasks.length,
    completed_required_task_count: completedTasks.length,
    required_evidence_count: evidence.length,
    independently_verified_evidence_count: independentlyVerifiedEvidence.length,
    native_release_authority_persisted: nativeReleaseAuthorityPersisted,
    native_task_evidence_only: nativeTaskEvidenceOnly,
    missing: Object.freeze(missing),
  });
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
  const initialize = createRetryablePostgresInitializer({
    pool,
    sql: ADDITIVE_SCHEMA_SQL,
  });
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
  function assertOperationalWorkMutation(work) {
    if (!work) fail("tenant_work_not_found");
    if (ARCHIVE_STATUSES.has(work.status)) fail("tenant_work_terminal");
    if (!OPERATIONAL_STATUSES.has(work.status)) fail("tenant_work_not_operational");
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
  async function v2CreationIntentBindingValid(client, tenantId, work, createdEvent) {
    const eventIntentDigest = createdEvent?.payload?.intent_digest || null;
    const workIntentDigest = work?.intent_digest || null;
    const eventPayload = createdEvent?.payload || {};
    const hasLegacyIntentMarker = Object.hasOwn(eventPayload, "legacy_intent_digest");
    if (!work?.legacy_work_id || work.legacy_work_id !== work.work_id ||
        !HASH.test(String(workIntentDigest || "")) ||
        !HASH.test(String(eventIntentDigest || ""))) return false;
    const legacyIntentResult = await client.query(`SELECT anchor,intent_digest
      FROM core_continuity_intent_anchors
      WHERE tenant_id=$1 AND work_id=$2`, [tenantId, work.work_id]);
    const legacyIntent = legacyIntentResult.rows[0];
    const canonicalLegacyAnchor = Boolean(
      legacyIntent && HASH.test(String(legacyIntent.intent_digest || "")) &&
      plainRecord(legacyIntent.anchor) &&
      legacyIntent.anchor.schema_version === "intent_anchor_v1" &&
      legacyIntent.anchor.immutable === true &&
      objectDigest(legacyIntent.anchor) === legacyIntent.intent_digest
    );
    if (!canonicalLegacyAnchor) return false;
    if (hasLegacyIntentMarker) {
      return eventIntentDigest === workIntentDigest &&
        HASH.test(String(eventPayload.legacy_intent_digest || "")) &&
        eventPayload.legacy_intent_digest === legacyIntent.intent_digest;
    }
    // The previous writer stored the immutable legacy anchor digest in the
    // event intent field, while the V2 row could retain a different explicit
    // digest. That old shape is accepted only through the anchor above.
    return eventIntentDigest === legacyIntent.intent_digest;
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
    // Serialize Core and V2 creation on the shared tenant/Work UUID before
    // either namespace is inspected.  FOR UPDATE on a missing row cannot
    // prevent the other creator from inserting concurrently.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      actor.tenant_id,
      workId,
    ]);
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
      if (!legacyWorkId && row.legacy_work_id) fail("tenant_work_core_id_collision");
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
      if (!legacyWorkId) {
        const coreCollision = await client.query(`SELECT work_id
          FROM core_continuity_works
          WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
        if (coreCollision.rows[0]) fail("tenant_work_core_id_collision");
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
      const currentWorks = await canonicalOpenReviewWorks(client, actor);
      const resolutionContract = validatedOpenReviewResolutionContract(
        review,
        input.project_id,
        input.intent_digest || null,
      );
      const currentResolution = resolveWorkRequest(
        resolutionContract.resolver_query,
        currentWorks,
        actor,
        { project_id: input.project_id, intent_digest: input.intent_digest || null, now: now() },
      );
      const related = currentWorks.filter((work) => work.project_id === input.project_id);
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
      // Keep the projection project-scoped while also accounting for a
      // selected same-project Work that may have been redacted from the
      // rendered candidate list. A visible cross-project selection is not a
      // new candidate for this project's already-reviewed decision.
      const originalCandidateIds = new Set([
        ...(Array.isArray(original.candidates) ? original.candidates : [])
          .map((item) => String(item.work_id || "")),
        String(original.selected_work_id || ""),
      ].filter(Boolean));
      const currentCandidates = visibleProjectResolutionCandidates(
        currentResolution,
        currentWorks,
        input.project_id,
        actor,
      );
      const selectedCurrentWork = currentWorks.find((work) =>
        work.work_id === currentResolution.selected_work_id &&
        work.project_id === input.project_id && canRead(work, actor));
      const currentCandidateIds = new Set([
        ...currentCandidates.map((item) => String(item.work_id || "")),
        String(selectedCurrentWork?.work_id || ""),
      ].filter(Boolean));
      const newCandidate = [...currentCandidateIds].some((workId) => !originalCandidateIds.has(workId));
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
          legacy_work_id: workId,
          intent_digest: v2.work.intent_digest || null,
          legacy_intent_digest: legacy.intent_digest || null,
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
      // Cross-fabric transactions always acquire Core before the V2 Work row.
      // Read the candidate first without a lock, then revalidate it after the
      // Core row has been locked or created in this same transaction.
      const observedWork = await loadWork(client, actor, workId, false);
      assertPermission(canAdminister, observedWork, actor);
      if (observedWork.legacy_work_id !== workId) fail("legacy_bridge_identity_mismatch");
      const observedBridgeInput = legacyBridgeInput(observedWork);
      const observedBridgeDigest = objectDigest(observedBridgeInput);
      const existing = await client.query(`SELECT w.project_id,w.status,a.anchor,a.intent_digest
        FROM core_continuity_works w
        LEFT JOIN core_continuity_intent_anchors a
          ON a.tenant_id=w.tenant_id AND a.work_id=w.work_id
        WHERE w.tenant_id=$1 AND w.work_id=$2
        FOR UPDATE OF w`, [actor.tenant_id, workId]);
      const legacy = existing.rows[0];
      if (legacy) {
        const work = await loadWork(client, actor, workId, true);
        assertPermission(canAdminister, work, actor);
        if (work.legacy_work_id !== workId) fail("legacy_bridge_identity_mismatch");
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
      const reconstructed = await legacyRuntime.ensureWithClient(client, identity, observedBridgeInput, {
        creationAuthorized: true,
      });
      const projectedEvent = reconstructed.intent_event || reconstructed.event;
      if (reconstructed.work_id !== workId || !HASH.test(String(reconstructed.intent_digest || "")) ||
          !Number.isSafeInteger(Number(projectedEvent?.sequence_number)) ||
          Number(projectedEvent.sequence_number) < 1 || !HASH.test(String(projectedEvent.event_hash || ""))) {
        fail("legacy_bridge_reconstruction_invalid");
      }
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      if (work.legacy_work_id !== workId ||
          objectDigest(legacyBridgeInput(work)) !== observedBridgeDigest) {
        fail("legacy_bridge_source_changed");
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
    const creationIntentBound = createdEvent
      ? await v2CreationIntentBindingValid(pool, actor.tenant_id, work, createdEvent)
      : false;
    if (!consumedEvent || !createdEvent ||
        Number(createdEvent.sequence_number) !== Number(consumedEvent.sequence_number) + 1 ||
        createdEvent.previous_event_hash !== consumedEvent.event_hash ||
        consumedEvent.payload?.review_id !== reviewId ||
        consumedEvent.payload?.review_digest !== reviewDigest ||
        consumedEvent.payload?.request_digest !== requestDigest ||
        consumedEvent.payload?.decision !== review.decision ||
        consumedEvent.payload?.decision_digest !== expectedDecisionDigest ||
        createdEvent.payload?.legacy_work_id !== work.work_id ||
        !creationIntentBound) {
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
      if (existing.rows.some((candidate) =>
        candidate.work_id === legacyId && candidate.legacy_work_id !== legacyId)) {
        fail("tenant_work_legacy_link_conflict");
      }
      const existingRow = existing.rows.find((candidate) =>
        candidate.legacy_work_id === legacyId) || null;
      const sourceEvent = legacyProjectionEvent(row, suppliedEvent);
      if (!sourceEvent && existingRow) return normalizeWork(existingRow);
      if (!sourceEvent) fail("legacy_projection_source_event_required");
      if (!terminalLegacyProjectionVerified(status, sourceEvent, row)) {
        fail("legacy_projection_terminal_evidence_required");
      }
      if (existingRow) {
        const current = normalizeWork(existingRow);
        // A linked V2 identity remains authoritative for identity, ownership,
        // intent and architecture. Legacy events only advance its mirrored
        // operational state and projection cursor.
        const linkedCanonicalWork = current.legacy_work_id === legacyId &&
          current.work_type !== "legacy";
        const projectedSequence = Number(current.legacy_projection_sequence || 0);
        if (projectedSequence >= sourceEvent.sequence_number) return current;
        if (ARCHIVE_STATUSES.has(current.status) && !ARCHIVE_STATUSES.has(status)) {
          // Historical bridge archival deliberately terminals only the V2
          // Gallery record and preserves the legacy Work unchanged.  A later
          // projector pass must therefore leave that archival receipt intact,
          // rather than treating the preserved legacy BLOCKED state as a
          // regression and making the Work unreadable/replay-inaccessible.
          if (linkedCanonicalWork && current.status === "ARCHIVED" &&
              current.closure_type === "historical_bridge_archive") {
            // Consume the immutable legacy event even though it cannot alter
            // the V2 terminal state.  Otherwise catalog/backfill workers see
            // the same source sequence forever and report a projection on
            // every pass.
            const preserved = await client.query(`UPDATE tenant_work SET
                legacy_projection_sequence=$3,legacy_projection_event_hash=$4,
                legacy_projection_updated_at=$5::timestamptz
              WHERE tenant_id=$1 AND work_id=$2
                AND COALESCE(legacy_projection_sequence,0) < $3
              RETURNING *`, [actor.tenant_id, current.work_id,
              sourceEvent.sequence_number, sourceEvent.event_hash, now()]);
            return normalizeWork(preserved.rows[0] || current);
          }
          fail("legacy_projection_terminal_regression_denied");
        }
        const projectionUpdatedAt = now();
        const sourceUpdatedAt = row.updated_at || projectionUpdatedAt;
        const updated = linkedCanonicalWork
          ? await client.query(`UPDATE tenant_work SET
              status=$3::varchar,next_action=$4,
              updated_at=GREATEST(updated_at,$5::timestamptz),
              closed_at=CASE WHEN $3::varchar = ANY($9::varchar[]) THEN COALESCE(closed_at,$5::timestamptz) ELSE closed_at END,
              archived_at=CASE WHEN $3::varchar = ANY($9::varchar[]) THEN COALESCE(archived_at,$5::timestamptz) ELSE archived_at END,
              legacy_projection_sequence=$6,legacy_projection_event_hash=$7,
              legacy_projection_updated_at=$8::timestamptz
            WHERE tenant_id=$1 AND work_id=$2
              AND COALESCE(legacy_projection_sequence,0) < $6
            RETURNING *`, [actor.tenant_id, current.work_id, status, row.next_action || null,
            sourceUpdatedAt, sourceEvent.sequence_number, sourceEvent.event_hash,
            projectionUpdatedAt, [...ARCHIVE_STATUSES]])
          : await client.query(`UPDATE tenant_work SET
              project_id=$3,parent_work_id=$4,work_name=$5,objective=$6,next_action=$7,status=$8::varchar,
              updated_at=$9::timestamptz,
              closed_at=CASE WHEN $8::varchar = ANY($13::varchar[]) THEN COALESCE(closed_at,$9::timestamptz) ELSE closed_at END,
              archived_at=CASE WHEN $8::varchar = ANY($13::varchar[]) THEN COALESCE(archived_at,$9::timestamptz) ELSE archived_at END,
              legacy_projection_sequence=$10,legacy_projection_event_hash=$11,
              legacy_projection_updated_at=$12::timestamptz
            WHERE tenant_id=$1 AND work_id=$2
              AND COALESCE(legacy_projection_sequence,0) < $10
            RETURNING *`,
          [actor.tenant_id, current.work_id, row.project_id || null, row.parent_work_id || null,
            String(row.idea || row.objective || "Legacy work").slice(0, 1_000), row.objective || null,
            row.next_action || null, status, sourceUpdatedAt, sourceEvent.sequence_number,
            sourceEvent.event_hash, projectionUpdatedAt, [...ARCHIVE_STATUSES]]);
        if (!updated.rows[0]) return current;
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
    const result = await query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, uuid(work_id)]);
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
  async function previewNativePlanMerge(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    const workResult = await query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    const work = workResult.rows[0] && normalizeWork(workResult.rows[0]);
    if (!work) fail("tenant_work_not_found");
    assertPermission(canRead, work, actor);
    const plans = await query(`SELECT plan_id,plan,plan_digest,status,plan_version,supersedes_plan_id
      FROM core_continuity_native_plans
      WHERE tenant_id=$1 AND work_id=$2
      ORDER BY plan_version,plan_id
      LIMIT 101`, [actor.tenant_id, workId]);
    return buildNativePlanMergePreview(plans.rows, workId);
  }
  async function verifyWorkClosure(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, false);
      assertPermission(canRead, work, actor);
      const tasks = await client.query("SELECT * FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY task_id", [actor.tenant_id, workId]);
      const evidence = await client.query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY created_at,evidence_id", [actor.tenant_id, workId]);
      const join = await client.query("SELECT * FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
      const receipt = await client.query("SELECT * FROM tenant_work_closure_receipt WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
      const report = await client.query("SELECT tenant_id,work_id,report,report_digest,created_at FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
      const event = await client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,previous_event_hash,event_hash
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2 AND event_type='generic_closure_finalized'
        ORDER BY sequence_number DESC LIMIT 1`, [actor.tenant_id, workId]);
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
      // A native V2 Work has no Core coordination namespace. Its UUID must
      // never be treated as an implicit bridge to an identically named Core
      // Work; only an explicit legacy_work_id may authorize Core cleanup.
      const releasedLeaseCount = 0;
      const event = await appendV2Event(client, actor, workId, "work_archived_v3", {
        schema_version: "tenant_work_gallery_archive_event_v1",
        from_status: work.status,
        reason,
        request_digest: requestDigest,
        idempotency_key_digest: idempotencyKeyDigest,
        work: normalizeWork(archived.rows[0]),
        released_lease_count: releasedLeaseCount,
      });
      return {
        schema_version: "tenant_work_gallery_v3",
        work: normalizeWork(archived.rows[0]),
        released_lease_count: releasedLeaseCount,
        event,
        idempotent_replay: false,
      };
    });
  }
  // A linked V2 Work can outlive the native plan that originally governed it.
  // This is deliberately not a closure path: it preserves both ledgers,
  // records why the item left the operational Gallery, and can never claim
  // completed acceptance, receipt, or deployment evidence.
  async function archiveHistoricalBridgedWork(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("historical_bridge_archive_owner_required");
    const confirmationReference = String(identity.confirmationReference || "").trim();
    if (identity.ownerConfirmed !== true || !confirmationReference || confirmationReference.length > 240) {
      fail("historical_bridge_archive_owner_confirmation_required");
    }
    const workId = uuid(input.work_id);
    const expectedClassification = String(input.expected_classification || "").trim().toUpperCase();
    if (!['STALE', 'ABANDONED', 'BLOCKED_VALID'].includes(expectedClassification)) {
      fail("historical_bridge_archive_expected_classification_invalid");
    }
    const reason = text(input.reason, "historical_bridge_archive_reason_required", 1_000);
    // Older, server-created Nyra read contexts predate the attestation field.
    // They remain blockers by default: their public-shaped purpose text alone
    // cannot prove that they are non-operational.  An owner may explicitly
    // revoke this narrow class after pausing the sessions; execution leases
    // and branches remain unconditionally non-revocable through this route.
    const revokeUnattestedReadOnlyBindings = input.revoke_unattested_read_only_bindings === true;
    // A maintenance client without a signed host presence must not be able to
    // manufacture a read-binding audit.  This opt-in is deliberately much
    // narrower than a general BLOCKED_VALID archive; its invariants describe
    // the historical bridge anomaly caused by a pre-attestation diagnostic
    // resume that refreshed only the legacy/V2 projection timestamps.
    const repairUnattestedHistoricalTimestamp = input.repair_unattested_historical_timestamp === true;
    // Core materializes phase branches before a Nyra assignment has done any
    // work.  Those rows are useful planning records, but a stranded set of
    // them must not make an otherwise stale historical bridge impossible to
    // archive forever.  This is intentionally an explicit owner action and
    // has a much narrower predicate than a normal branch closure.
    const retireEmptyBootstrapBranches = input.retire_empty_bootstrap_branches === true;
    const idempotencyKey = galleryIdempotencyKey(
      input.idempotency_key,
      "historical_bridge_archive_idempotency_key_required",
    );
    const requestDigest = objectDigest({
      schema_version: "tenant_work_historical_bridge_archive_request_v1",
      tenant_id: actor.tenant_id,
      work_id: workId,
      expected_classification: expectedClassification,
      reason,
      // Preserve the v1 digest byte-for-byte when this new, opt-in action is
      // absent.  Existing archived Work retries must remain replayable.
      ...(revokeUnattestedReadOnlyBindings
        ? { revoke_unattested_read_only_bindings: true }
        : {}),
      ...(repairUnattestedHistoricalTimestamp
        ? { repair_unattested_historical_timestamp: true }
        : {}),
      ...(retireEmptyBootstrapBranches
        ? { retire_empty_bootstrap_branches: true }
        : {}),
    });
    const idempotencyKeyDigest = archiveIdempotencyKeyDigest(actor, workId, idempotencyKey);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      if (!work.legacy_work_id || work.work_type === "legacy") {
        fail("historical_bridge_archive_work_type_invalid");
      }
      const replay = await client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,
          previous_event_hash,event_hash
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2
          AND event_type='historical_bridge_archived_v1'
          AND payload->>'idempotency_key_digest'=$3
        ORDER BY sequence_number DESC LIMIT 1`,
      [actor.tenant_id, workId, idempotencyKeyDigest]);
      if (replay.rows[0]) {
        const payload = replay.rows[0].payload || {};
        if (payload.request_digest !== requestDigest ||
            payload.schema_version !== "tenant_work_historical_bridge_archive_event_v1") {
          fail("historical_bridge_archive_idempotency_conflict");
        }
        return {
          schema_version: "tenant_work_historical_bridge_archive_v1",
          work: payload.work,
          classification: payload.classification,
          legacy_status: payload.legacy_status,
          closure_claimed: false,
          blocked_read_audit_event_hash: payload.blocked_read_audit_event_hash || null,
          blocked_timestamp_repair: payload.blocked_timestamp_repair || null,
          revoked_unattested_read_only_binding_count: Number(
            payload.revoked_unattested_read_only_binding_count || 0,
          ),
          revoked_unattested_read_only_session_count: Number(
            payload.revoked_unattested_read_only_session_count || 0,
          ),
          retired_empty_bootstrap_branch_count: Number(
            payload.retired_empty_bootstrap_branch_count || 0,
          ),
          cancelled_empty_bootstrap_assignment_count: Number(
            payload.cancelled_empty_bootstrap_assignment_count || 0,
          ),
          bootstrap_branch_audit_event_hash: payload.bootstrap_branch_audit_event_hash || null,
          event_hash: replay.rows[0].event_hash,
          idempotent_replay: true,
        };
      }
      if (!OPERATIONAL_STATUSES.has(work.status)) fail("historical_bridge_archive_status_invalid");
      const legacyResult = await client.query(`SELECT work_id,status,updated_at
        FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`,
      [actor.tenant_id, work.legacy_work_id]);
      const legacy = legacyResult.rows[0];
      if (!legacy) fail("historical_bridge_archive_legacy_work_not_found");
      // BLOCKED_VALID is eligible only when the recent legacy timestamp is
      // explained by the server-owned Nyra read-binding audit.  A normally
      // progressing or newly blocked Work must still age into STALE/ABANDONED.
      // The sole alternative handles a pre-attestation diagnostic resume:
      // it is a bridge whose latest meaningful V2 completion/evidence
      // activity is old, and whose legacy row says
      // release_ready while the V2 projection is BLOCKED.  That contradictory
      // state can never represent a current blocked execution, and every
      // predicate is re-read inside this transaction.
      let blockedReadAuditEvent = null;
      let blockedTimestampRepair = null;
      if (expectedClassification === "BLOCKED_VALID") {
        const audit = await client.query(`SELECT event_type,event_hash,created_at FROM core_continuity_events
          WHERE tenant_id=$1 AND work_id=$2 AND event_type='nyra_read_binding_attested'
          ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [actor.tenant_id, work.legacy_work_id]);
        const candidate = audit.rows[0];
        const legacyUpdatedAt = new Date(legacy.updated_at).getTime();
        const auditAt = new Date(candidate?.created_at || "").getTime();
        if (candidate && Number.isFinite(legacyUpdatedAt) && Number.isFinite(auditAt) &&
            Math.abs(legacyUpdatedAt - auditAt) <= 5 * 60 * 1000) {
          blockedReadAuditEvent = candidate;
        } else {
          if (!repairUnattestedHistoricalTimestamp) {
            fail("historical_bridge_archive_blocked_audit_required");
          }
          if (work.status !== "BLOCKED" || String(legacy.status || "").toLowerCase() !== "release_ready" ||
              Number(work.progress_bp) !== 10_000) {
            fail("historical_bridge_archive_timestamp_repair_ineligible");
          }
          const [requiredTasks, requiredEvidence] = await Promise.all([
            client.query(`SELECT status,acceptance_verified,completed_at FROM tenant_work_task
              WHERE tenant_id=$1 AND work_id=$2 AND required=true FOR UPDATE`, [actor.tenant_id, workId]),
            client.query(`SELECT independently_verified,verified_by_agent_id,verified_by_session_fingerprint,created_at
              FROM tenant_work_evidence
              WHERE tenant_id=$1 AND work_id=$2 AND required=true FOR UPDATE`, [actor.tenant_id, workId]),
          ]);
          if (!requiredTasks.rows.length || !requiredEvidence.rows.length ||
              requiredTasks.rows.some((row) => row.status !== "completed" || row.acceptance_verified !== true) ||
              requiredEvidence.rows.some((row) => !independentlyVerifiedGenericEvidence(row, work))) {
            fail("historical_bridge_archive_timestamp_repair_ineligible");
          }
          const verifiedActivityAt = [
            ...requiredTasks.rows.map((row) => new Date(row.completed_at || "").getTime()),
            ...requiredEvidence.rows.map((row) => new Date(row.created_at || "").getTime()),
          ];
          if (verifiedActivityAt.some((timestamp) => !Number.isFinite(timestamp)) ||
              now().getTime() - Math.max(...verifiedActivityAt) < HISTORICAL_BLOCKED_TIMESTAMP_REPAIR_MIN_AGE_MS) {
            fail("historical_bridge_archive_timestamp_repair_ineligible");
          }
          blockedTimestampRepair = {
            schema_version: "historical_bridge_unattested_timestamp_repair_v1",
            latest_verified_activity_at: new Date(Math.max(...verifiedActivityAt)).toISOString(),
            minimum_age_hours: HISTORICAL_BLOCKED_TIMESTAMP_REPAIR_MIN_AGE_MS / (60 * 60 * 1_000),
            legacy_status: "release_ready",
            verified_required_task_count: requiredTasks.rows.length,
            independently_verified_required_evidence_count: requiredEvidence.rows.length,
          };
        }
      }
      const [participants, leases, branches] = await Promise.all([
        client.query(`SELECT session_id,branch_id,status,expires_at FROM core_continuity_participants
          WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, work.legacy_work_id]),
        client.query(`SELECT lease_id,session_id,branch_id,purpose,status,expires_at,nyra_read_binding_attested FROM core_continuity_leases
          WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, work.legacy_work_id]),
        client.query(`SELECT branch_id,branch_key,title,objective,created_by FROM core_continuity_branches
          WHERE tenant_id=$1 AND work_id=$2 AND status='active'`, [actor.tenant_id, work.legacy_work_id]),
      ]);
      let retiredEmptyBootstrapBranches = [];
      let cancelledEmptyBootstrapAssignmentCount = 0;
      let bootstrapBranchAuditEventHash = null;
      if (branches.rows.length && retireEmptyBootstrapBranches) {
        // Every active branch must be an exact, untouched materialization of
        // one persisted Core verdict.  A manually opened branch, a partial
        // set, or any branch ever bound to a participant, lease or message is
        // ambiguous execution and remains an unconditional blocker.
        // Lock order is Core Work (locked above), then run, then branch.  It
        // matches Nyra materialization and avoids an archive/materialization
        // deadlock while preserving a transactionally re-read branch set.
        const runs = await client.query(`SELECT run_id,plan,plan_digest,status FROM core_nyra_autopilot_runs
          WHERE tenant_id=$1 AND work_id=$2 AND status='materialized'
          ORDER BY architecture_version DESC,created_at DESC FOR UPDATE`, [actor.tenant_id, work.legacy_work_id]);
        const matchingRun = runs.rows.find((run) => {
          const plan = plainRecord(run.plan) ? run.plan : {};
          const orchestration = plainRecord(plan.core_orchestration) ? plan.core_orchestration : {};
          const required = Array.isArray(plan.required_nyra_branches) ? plan.required_nyra_branches : [];
          if (!HASH.test(String(orchestration.verdict_digest || "")) || required.length !== branches.rows.length ||
              new Set(required.map((item) => item?.id)).size !== required.length) return false;
          const requiredById = new Map(required.map((item) => [item?.id, item]));
          return branches.rows.every((branch) => {
            const requiredBranch = requiredById.get(branch.branch_key);
            return requiredBranch && branch.created_by === "nyra_autopilot" &&
              branch.title === `Nyra Core branch: ${branch.branch_key}` &&
              branch.objective === `Core-required phase ${requiredBranch.work_phase}; verdict ${orchestration.verdict_digest}`;
          });
        });
        if (!matchingRun) fail("historical_bridge_archive_bootstrap_branch_ineligible");
        const lockedBranches = await client.query(`SELECT branch_id,branch_key,title,objective,created_by FROM core_continuity_branches
          WHERE tenant_id=$1 AND work_id=$2 AND status='active' FOR UPDATE`, [actor.tenant_id, work.legacy_work_id]);
        if (lockedBranches.rows.length !== branches.rows.length ||
            lockedBranches.rows.some((row) => !branches.rows.some((before) => before.branch_id === row.branch_id))) {
          fail("historical_bridge_archive_bootstrap_branch_conflict");
        }
        branches.rows = lockedBranches.rows;
        const branchIds = branches.rows.map((row) => row.branch_id);
        const [branchParticipants, branchLeases, branchMessages, assignments] = await Promise.all([
          client.query(`SELECT branch_id FROM core_continuity_participants
            WHERE tenant_id=$1 AND work_id=$2 AND branch_id=ANY($3::uuid[]) FOR UPDATE`,
          [actor.tenant_id, work.legacy_work_id, branchIds]),
          client.query(`SELECT branch_id FROM core_continuity_leases
            WHERE tenant_id=$1 AND work_id=$2 AND branch_id=ANY($3::uuid[]) FOR UPDATE`,
          [actor.tenant_id, work.legacy_work_id, branchIds]),
          client.query(`SELECT branch_id FROM core_continuity_messages
            WHERE tenant_id=$1 AND work_id=$2 AND branch_id=ANY($3::uuid[]) FOR UPDATE`,
          [actor.tenant_id, work.legacy_work_id, branchIds]),
          client.query(`SELECT assignment_id,status FROM core_nyra_autopilot_assignments
            WHERE tenant_id=$1 AND work_id=$2
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(
                COALESCE(task_contract->'materialized_nyra_branches','[]'::jsonb)
              ) branch_binding WHERE branch_binding->>'branch_id'=ANY($3::varchar[])) FOR UPDATE`,
          [actor.tenant_id, work.legacy_work_id, branchIds]),
        ]);
        if (branchParticipants.rows.length || branchLeases.rows.length || branchMessages.rows.length ||
            assignments.rows.some((row) => row.status !== "offered")) {
          fail("historical_bridge_archive_bootstrap_branch_activity_denied");
        }
        const retired = await client.query(`UPDATE core_continuity_branches
          SET status='retired',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND branch_id=ANY($3::uuid[]) AND status='active'
          RETURNING branch_id,branch_key`, [actor.tenant_id, work.legacy_work_id, branchIds]);
        if (retired.rows.length !== branchIds.length) fail("historical_bridge_archive_bootstrap_branch_conflict");
        retiredEmptyBootstrapBranches = retired.rows;
        if (assignments.rows.length) {
          const cancelled = await client.query(`UPDATE core_nyra_autopilot_assignments
            SET status='cancelled',updated_at=now()
            WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=ANY($3::uuid[]) AND status='offered'
            RETURNING assignment_id`, [actor.tenant_id, work.legacy_work_id,
            assignments.rows.map((row) => row.assignment_id)]);
          if (cancelled.rows.length !== assignments.rows.length) fail("historical_bridge_archive_bootstrap_assignment_conflict");
          cancelledEmptyBootstrapAssignmentCount = cancelled.rows.length;
        }
        const cancelledRun = await client.query(`UPDATE core_nyra_autopilot_runs
          SET status='cancelled',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND run_id=$3 AND status='materialized'
          RETURNING run_id`, [actor.tenant_id, work.legacy_work_id, matchingRun.run_id]);
        if (!cancelledRun.rows[0]) fail("historical_bridge_archive_bootstrap_run_conflict");
        const previousLegacyEvent = await client.query(`SELECT sequence_number,event_hash FROM core_continuity_events
          WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
        [actor.tenant_id, work.legacy_work_id]);
        const legacySequence = Number(previousLegacyEvent.rows[0]?.sequence_number || 0) + 1;
        const bootstrapPayload = {
          schema_version: "nyra_empty_bootstrap_branch_retirement_v1",
          run_id: matchingRun.run_id,
          plan_digest: matchingRun.plan_digest,
          branch_keys: retiredEmptyBootstrapBranches.map((row) => row.branch_key).sort(),
          cancelled_assignment_count: cancelledEmptyBootstrapAssignmentCount,
          reason_digest: objectDigest(reason),
        };
        const bootstrapEvent = {
          tenant_id: actor.tenant_id, work_id: work.legacy_work_id, sequence_number: legacySequence,
          event_type: "nyra_empty_bootstrap_branches_retired", payload: bootstrapPayload,
          previous_event_hash: previousLegacyEvent.rows[0]?.event_hash || null,
        };
        bootstrapBranchAuditEventHash = objectDigest(bootstrapEvent);
        await client.query(`INSERT INTO core_continuity_events
          (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [actor.tenant_id, work.legacy_work_id,
          crypto.randomUUID(), legacySequence, bootstrapEvent.event_type, JSON.stringify(bootstrapPayload),
          bootstrapEvent.previous_event_hash, bootstrapBranchAuditEventHash, actor.agent_id || actor.user_id]);
        branches.rows = [];
      }
      const currentTime = now().getTime();
      const activeParticipants = participants.rows.filter((row) => row.status === "active" &&
        new Date(row.expires_at).getTime() > currentTime);
      const activeLeases = leases.rows.filter((row) => row.status === "active" &&
        new Date(row.expires_at).getTime() > currentTime);
      const hasOnlyReadLease = (sessionId) => {
        const sessionLeases = activeLeases.filter((row) => row.session_id === sessionId);
        return sessionLeases.length > 0 && sessionLeases.every((row) =>
          row.branch_id == null && row.purpose === NYRA_READ_ONLY_LEASE_PURPOSE &&
            row.nyra_read_binding_attested === true);
      };
      const isReadOnlyBinding = (row) => row.branch_id == null &&
        row.purpose === NYRA_READ_ONLY_LEASE_PURPOSE;
      const activeLeasesBySession = new Map();
      for (const lease of activeLeases) {
        const sessionLeases = activeLeasesBySession.get(lease.session_id) || [];
        sessionLeases.push(lease);
        activeLeasesBySession.set(lease.session_id, sessionLeases);
      }
      const activeParticipantSessions = new Set(activeParticipants.map((row) => row.session_id));
      const onlyReadOnlyBindingsRemain = activeLeases.length > 0 &&
        activeLeases.every((row) => isReadOnlyBinding(row) &&
          activeParticipantSessions.has(row.session_id)) &&
        activeParticipants.every((row) => row.branch_id == null &&
          (activeLeasesBySession.get(row.session_id) || []).length > 0 &&
          (activeLeasesBySession.get(row.session_id) || []).every(isReadOnlyBinding));
      let revokedReadOnlyBindingCount = 0;
      let revokedReadOnlySessionCount = 0;
      if (branches.rows.length || !onlyReadOnlyBindingsRemain) {
        // An active branch, a lease with another purpose/surface, or a
        // participant without a matching read-only lease is real or
        // ambiguous execution.  Never auto-clear it, even for an owner.
        if (branches.rows.length || activeLeases.length || activeParticipants.length) {
          fail("historical_bridge_archive_active_work_denied");
        }
      } else {
        const unattested = activeLeases.filter((row) => row.nyra_read_binding_attested !== true);
        if (unattested.length && !revokeUnattestedReadOnlyBindings) {
          fail("historical_bridge_archive_active_work_denied");
        }
        if (unattested.length) {
          const leaseIds = unattested.map((row) => row.lease_id);
          const released = await client.query(`UPDATE core_continuity_leases
            SET status='expired',released_at=coalesce(released_at,now())
            WHERE tenant_id=$1 AND work_id=$2 AND lease_id=ANY($3::uuid[])
              AND status='active' AND branch_id IS NULL AND purpose=$4
              AND nyra_read_binding_attested=false
            RETURNING lease_id,session_id`, [
            actor.tenant_id, work.legacy_work_id, leaseIds, NYRA_READ_ONLY_LEASE_PURPOSE,
          ]);
          if (released.rows.length !== leaseIds.length) {
            fail("historical_bridge_archive_read_binding_conflict");
          }
          revokedReadOnlyBindingCount = released.rows.length;
          const releasedSessions = new Set(released.rows.map((row) => row.session_id));
          const remainingActiveLeases = activeLeases.filter((row) => !releasedSessions.has(row.session_id) ||
            row.nyra_read_binding_attested === true);
          const sessionsWithoutRemainingLease = activeParticipants
            .filter((row) => releasedSessions.has(row.session_id) &&
              !remainingActiveLeases.some((lease) => lease.session_id === row.session_id))
            .map((row) => row.session_id);
          if (sessionsWithoutRemainingLease.length) {
            const expiredParticipants = await client.query(`UPDATE core_continuity_participants
              SET expires_at=now()
              WHERE tenant_id=$1 AND work_id=$2 AND session_id=ANY($3::varchar[])
                AND status='active' AND branch_id IS NULL
              RETURNING session_id`, [actor.tenant_id, work.legacy_work_id, sessionsWithoutRemainingLease]);
            if (expiredParticipants.rows.length !== sessionsWithoutRemainingLease.length) {
              fail("historical_bridge_archive_read_participant_conflict");
            }
            revokedReadOnlySessionCount = expiredParticipants.rows.length;
          }
          for (const lease of activeLeases) {
            if (leaseIds.includes(lease.lease_id)) lease.status = "expired";
          }
          for (const participant of activeParticipants) {
            if (sessionsWithoutRemainingLease.includes(participant.session_id)) participant.status = "expired";
          }
        }
      }
      const effectiveActiveLeases = activeLeases.filter((row) => row.status === "active");
      const effectiveActiveParticipants = activeParticipants.filter((row) => row.status === "active");
      const effectiveHasOnlyReadLease = (sessionId) => {
        const sessionLeases = effectiveActiveLeases.filter((row) => row.session_id === sessionId);
        return sessionLeases.length > 0 && sessionLeases.every((row) =>
          row.branch_id == null && row.purpose === NYRA_READ_ONLY_LEASE_PURPOSE &&
            row.nyra_read_binding_attested === true);
      };
      const activeExecutionLease = effectiveActiveLeases.some((row) =>
        row.branch_id != null || row.purpose !== NYRA_READ_ONLY_LEASE_PURPOSE ||
          row.nyra_read_binding_attested !== true);
      const activeExecutionParticipant = effectiveActiveParticipants.some((row) =>
        row.branch_id != null || !effectiveHasOnlyReadLease(row.session_id));
      if (branches.rows.length || activeExecutionLease || activeExecutionParticipant) {
        fail("historical_bridge_archive_active_work_denied");
      }
      // Read contexts do not revive a historical Work.  Keep their audit rows
      // in the coordination ledger, but omit them from staleness evaluation;
      // all execution-capable participation remains in the calculation.
      const stale = classifyStaleWork({ ...work, updated_at: legacy.updated_at,
        participants: participants.rows
          .filter((row) => !effectiveHasOnlyReadLease(row.session_id))
          .map((row) => ({ ...row, active: row.status === "active" })),
        leases: leases.rows.filter((row) => row.purpose !== NYRA_READ_ONLY_LEASE_PURPOSE ||
          row.nyra_read_binding_attested !== true) }, now());
      if (stale.classification !== expectedClassification) {
        fail("historical_bridge_archive_classification_conflict");
      }
      const archived = await client.query(`UPDATE tenant_work SET
          status='ARCHIVED',archived_at=now(),archived_from_status=$3::varchar,archived_reason=$4,
          closure_type='historical_bridge_archive',closure_reason=$4,assignment_status='REVOKED',updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND status=$5::varchar
        RETURNING *`, [actor.tenant_id, workId, work.status, reason, work.status]);
      if (!archived.rows[0]) fail("historical_bridge_archive_status_conflict");
      const normalized = normalizeWork(archived.rows[0]);
      const event = await appendV2Event(client, actor, workId, "historical_bridge_archived_v1", {
        schema_version: "tenant_work_historical_bridge_archive_event_v1",
        from_status: work.status,
        reason,
        classification: stale.classification,
        legacy_work_id: work.legacy_work_id,
        legacy_status: String(legacy.status || "").toLowerCase(),
        blocked_read_audit_event_hash: blockedReadAuditEvent?.event_hash || null,
        blocked_timestamp_repair: blockedTimestampRepair,
        request_digest: requestDigest,
        idempotency_key_digest: idempotencyKeyDigest,
        revoked_unattested_read_only_binding_count: revokedReadOnlyBindingCount,
        revoked_unattested_read_only_session_count: revokedReadOnlySessionCount,
        retired_empty_bootstrap_branch_count: retiredEmptyBootstrapBranches.length,
        cancelled_empty_bootstrap_assignment_count: cancelledEmptyBootstrapAssignmentCount,
        bootstrap_branch_audit_event_hash: bootstrapBranchAuditEventHash,
        closure_claimed: false,
        work: normalized,
      });
      return {
        schema_version: "tenant_work_historical_bridge_archive_v1",
        work: normalized,
        classification: stale.classification,
        legacy_status: String(legacy.status || "").toLowerCase(),
        closure_claimed: false,
        blocked_read_audit_event_hash: blockedReadAuditEvent?.event_hash || null,
        blocked_timestamp_repair: blockedTimestampRepair,
        revoked_unattested_read_only_binding_count: revokedReadOnlyBindingCount,
        revoked_unattested_read_only_session_count: revokedReadOnlySessionCount,
        retired_empty_bootstrap_branch_count: retiredEmptyBootstrapBranches.length,
        cancelled_empty_bootstrap_assignment_count: cancelledEmptyBootstrapAssignmentCount,
        bootstrap_branch_audit_event_hash: bootstrapBranchAuditEventHash,
        event_hash: event.event_hash,
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
      const bindingWasReserved = Boolean(reserved.rows[0]);
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
        if (!openReviewRequiresRefresh(
          linked.rows[0],
          projectId,
          intentDigest,
          now(),
        )) return responseFor(linked.rows[0], true);
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
        const row = historical.rows.find((candidate) =>
          !openReviewRequiresRefresh(candidate, projectId, intentDigest, now()));
        if (row) {
          const adopted = await client.query(`UPDATE tenant_work_bootstrap_request
            SET review_id=$4,consumed_work_id=$5,updated_at=now()
            WHERE tenant_id=$1 AND subject_user_id=$2 AND request_id=$3
              AND request_digest=$6
            RETURNING *`, [actor.tenant_id, actor.user_id, requestId, row.review_id,
            row.consumed_work_id || null, requestDigest]);
          if (!adopted.rows[0]) fail("open_work_review_request_binding_invalid");
          return responseFor(row, true);
        }
      }

      const normalizedWorks = await canonicalOpenReviewWorks(client, actor);
      const resolutionContract = openReviewResolutionContract(
        input.request || `${proposed.work_name} ${proposed.objective}`,
        projectId,
        intentDigest,
      );
      const review = resolveWorkRequest(resolutionContract.resolver_query, normalizedWorks, actor, {
        project_id: projectId, intent_digest: intentDigest, now: now(),
      });
      const related = normalizedWorks.filter((work) => work.project_id === projectId);
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
        candidates: visibleProjectResolutionCandidates(review, normalizedWorks, projectId, actor),
        conflict_flags: conflictFlags,
        hidden_conflict: review.hidden_conflict === true,
        resolution_contract: resolutionContract,
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
      if (!bindingWasReserved) {
        const refreshed = await client.query(`UPDATE tenant_work_bootstrap_request
          SET review_id=$4,consumed_work_id=$5,updated_at=now()
          WHERE tenant_id=$1 AND subject_user_id=$2 AND request_id=$3
            AND request_digest=$6
          RETURNING *`, [actor.tenant_id, actor.user_id, requestId,
          candidateReviewId, null, requestDigest]);
        if (!refreshed.rows[0]) fail("open_work_review_request_binding_invalid");
      }
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
    const actor = actorFromIdentity(identity);
    // Preflight is a read path. Legacy projection/backfill is deliberately
    // owned by the startup projector and the explicit writer entry points;
    // observing the Gallery must never create/update Work rows or events.
    const values = [actor.tenant_id];
    const where = ["tenant_id=$1"];
    if (input.project_id) {
      values.push(text(input.project_id, "project_id_invalid", 128));
      where.push(`project_id=$${values.length}`);
    }
    const persisted = await query(`SELECT * FROM tenant_work WHERE ${where.join(" AND ")}
      ORDER BY priority_score DESC,updated_at DESC`, values);
    const works = persisted.rows.map(normalizeWork).filter((work) =>
      OPERATIONAL_STATUSES.has(work.status) && canRead(work, actor));
    const limited = works.slice(0, Math.max(1, Math.min(200, Number(input.limit) || 20)));
    const rows = [];
    for (const work of limited) {
      const coordinationWorkId = work.legacy_work_id || null;
      const activity = coordinationWorkId
        ? await query(`SELECT
          count(DISTINCT p.session_id) FILTER (WHERE p.status='active' AND p.expires_at>now())::int AS active_participants,
          count(DISTINCT l.lease_id) FILTER (WHERE l.status='active' AND l.expires_at>now())::int AS active_leases,
          count(DISTINCT b.branch_id) FILTER (WHERE b.status='active')::int AS active_branches
        FROM core_continuity_works w
        LEFT JOIN core_continuity_participants p ON p.tenant_id=w.tenant_id AND p.work_id=w.work_id
        LEFT JOIN core_continuity_leases l ON l.tenant_id=w.tenant_id AND l.work_id=w.work_id
        LEFT JOIN core_continuity_branches b ON b.tenant_id=w.tenant_id AND b.work_id=w.work_id
        WHERE w.tenant_id=$1 AND w.work_id=$2`, [actor.tenant_id, coordinationWorkId])
        : { rows: [{ active_participants: 0, active_leases: 0, active_branches: 0 }] };
      rows.push({
        tenant_id: actor.tenant_id, project_id: work.project_id,
        work_id: coordinationWorkId || work.work_id,
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
  async function nyraAutopilotVerificationCandidateWithClient(client, actor, {
    work_id,
    assignment_id,
    assignment: suppliedAssignment = null,
    result,
    assignmentStates = ["claimed", "submitted"],
  } = {}) {
    const workId = uuid(work_id);
    const assignmentId = uuid(assignment_id, "assignment_id_invalid");
    const work = await loadWork(client, actor, workId, true);
    assertPermission(canContributeEvidence, work, actor);
    // `submit` holds its assignment row while it calls the pre-persistence
    // validator.  It passes that server-selected row here; querying it again
    // from a second transaction would self-deadlock.  The projector never
    // supplies this value and always locks/reads the durable submitted row.
    const selected = suppliedAssignment ? null : await client.query(`SELECT assignment_id,run_id,role,status,claimed_agent_id,claimed_session_fingerprint,submitted_result
      FROM core_nyra_autopilot_assignments
      WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=$3 FOR UPDATE`, [actor.tenant_id, workId, assignmentId]);
    const assignment = suppliedAssignment || selected.rows[0];
    if (!assignment) fail("nyra_autopilot_assignment_not_found");
    if (assignment.role !== "independent_verifier") {
      return Object.freeze({ required: false, work_id: workId, assignment_id: assignmentId,
        work_status: work.status });
    }
    if (!assignmentStates.includes(assignment.status)) fail("nyra_autopilot_verification_assignment_state_invalid");
    if (!actor.agent_id || !actor.session_fingerprint ||
        assignment.claimed_agent_id !== actor.agent_id ||
        assignment.claimed_session_fingerprint !== actor.session_fingerprint) {
      fail("nyra_autopilot_verifier_identity_required");
    }
    const runId = uuid(assignment.run_id, "nyra_autopilot_verification_run_invalid");
    const run = await client.query(`SELECT status,architecture_version,intent_digest FROM core_nyra_autopilot_runs
      WHERE tenant_id=$1 AND work_id=$2 AND run_id=$3 FOR UPDATE`, [actor.tenant_id, workId, runId]);
    if (run.rows[0]?.status !== "materialized") {
      fail("nyra_autopilot_verification_run_not_current");
    }
    const newerRun = await client.query(`SELECT run_id FROM core_nyra_autopilot_runs
      WHERE tenant_id=$1 AND work_id=$2 AND architecture_version>$3 AND status<>'cancelled'
      ORDER BY architecture_version DESC LIMIT 1 FOR UPDATE`, [actor.tenant_id, workId, run.rows[0].architecture_version]);
    if (newerRun.rows[0]) fail("nyra_autopilot_verification_run_not_current");
    const tasks = await client.query(`SELECT task_id FROM tenant_work_task
      WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY task_id FOR UPDATE`, [actor.tenant_id, workId]);
    const sources = await client.query(`SELECT assignment_id,run_id,role,status,claimed_agent_id,claimed_session_fingerprint,submitted_result
      FROM core_nyra_autopilot_assignments
      WHERE tenant_id=$1 AND work_id=$2 AND run_id=$3 AND status='submitted' ORDER BY assignment_id FOR UPDATE`,
    [actor.tenant_id, workId, runId]);
    const verification = normalizeNyraAutopilotVerificationResult(
      result === undefined ? assignment.submitted_result : result,
      {
        workId,
        requiredTaskIds: tasks.rows.map((task) => task.task_id),
        verifier: assignment,
        sourceAssignments: sources.rows,
      },
    );
    const sourceDigests = verification.verified_assignment_ids.map((sourceId) => {
      const source = sources.rows.find((item) => item.assignment_id === sourceId);
      return Object.freeze({ assignment_id: sourceId, result_digest: objectDigest(source.submitted_result) });
    });
    return Object.freeze({
      required: true,
      work_id: workId,
      assignment_id: assignmentId,
      run_id: runId,
      work_status: work.status,
      verification,
      source_digests: Object.freeze(sourceDigests),
    });
  }
  async function validateNyraAutopilotVerificationCandidate(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    return transaction((client) => nyraAutopilotVerificationCandidateWithClient(client, actor, {
      ...input,
      assignmentStates: ["claimed"],
    }));
  }
  async function projectNyraAutopilotVerification(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const assignmentId = uuid(input.assignment_id, "assignment_id_invalid");
    const outcome = await transaction(async (client) => {
      const candidate = await nyraAutopilotVerificationCandidateWithClient(client, actor, {
        work_id: workId,
        assignment_id: assignmentId,
        assignmentStates: ["submitted"],
      });
      if (!candidate.required) return candidate;
      const eventType = candidate.verification.verdict === "approved"
        ? "nyra_autopilot_verification_projected_v1"
        : "nyra_autopilot_verification_rejected_v1";
      const evidenceDigest = objectDigest({
        verification: candidate.verification,
        source_digests: candidate.source_digests,
      });
      const existing = await client.query(`SELECT payload FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2 AND event_type=$3
          AND payload->>'assignment_id'=$4
        ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [actor.tenant_id, workId, eventType, assignmentId]);
      if (existing.rows[0]) {
        if (existing.rows[0].payload?.evidence_digest !== evidenceDigest) {
          fail("nyra_autopilot_verification_projection_conflict");
        }
        return Object.freeze({
          ...buildNyraAutopilotVerificationReplay(candidate, evidenceDigest),
          progress: await deriveWorkStateWithClient(
            client,
            actor,
            workId,
            { persist: false },
          ),
        });
      }
      assertOperationalWorkMutation({ status: candidate.work_status });
      if (candidate.verification.verdict === "rejected") {
        const event = await appendV2Event(client, actor, workId, eventType, {
          assignment_id: assignmentId,
          evidence_digest: evidenceDigest,
          verified_assignment_ids: candidate.verification.verified_assignment_ids,
          verified_work_task_ids: candidate.verification.verified_work_task_ids,
          verifier_agent_id: candidate.verification.verifier_agent_id,
          verifier_session_fingerprint: candidate.verification.verifier_session_fingerprint,
        });
        const progress = await refreshDerivedWithClient(client, actor, workId);
        return Object.freeze({ ...candidate, evidence_digest: evidenceDigest, event, idempotent_replay: false,
          task_projection: "not_applied", progress });
      }
      const taskUpdate = await client.query(`UPDATE tenant_work_task
        SET status='completed',acceptance_verified=true,completed_at=coalesce(completed_at,now())
        WHERE tenant_id=$1 AND work_id=$2 AND required=true AND task_id=ANY($3::uuid[])`,
      [actor.tenant_id, workId, candidate.verification.verified_work_task_ids]);
      if (Number(taskUpdate.rowCount || 0) !== candidate.verification.verified_work_task_ids.length) {
        fail("nyra_autopilot_verification_task_projection_conflict");
      }
      const evidenceId = crypto.randomUUID();
      await client.query(`INSERT INTO tenant_work_evidence
        (tenant_id,evidence_id,work_id,kind,digest,required,independently_verified,verified_by_agent_id,verified_by_session_fingerprint,weight,metadata)
        VALUES ($1,$2,$3,'nyra_autopilot_verification',$4,true,true,$5,$6,1,$7::jsonb)`,
      [actor.tenant_id, evidenceId, workId, evidenceDigest,
        candidate.verification.verifier_agent_id, candidate.verification.verifier_session_fingerprint,
        JSON.stringify({
          schema_version: "nyra_autopilot_verification_projection_v1",
          assignment_id: assignmentId,
          verified_assignment_ids: candidate.verification.verified_assignment_ids,
          verified_work_task_ids: candidate.verification.verified_work_task_ids,
          source_digests: candidate.source_digests,
          evidence_refs: candidate.verification.evidence_refs,
        })]);
      const event = await appendV2Event(client, actor, workId, eventType, {
        assignment_id: assignmentId,
        evidence_id: evidenceId,
        evidence_digest: evidenceDigest,
        verified_assignment_ids: candidate.verification.verified_assignment_ids,
        verified_work_task_ids: candidate.verification.verified_work_task_ids,
        verifier_agent_id: candidate.verification.verifier_agent_id,
        verifier_session_fingerprint: candidate.verification.verifier_session_fingerprint,
      });
      const progress = await refreshDerivedWithClient(client, actor, workId);
      return Object.freeze({ ...candidate, evidence_id: evidenceId,
        evidence_digest: evidenceDigest, event, progress, idempotent_replay: false });
    });
    return outcome;
  }
  async function recordTask(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const taskId = input.task_id ? uuid(input.task_id, "task_id_invalid") : crypto.randomUUID();
    const task = Object.freeze({
      title: text(input.title, "task_title_invalid", 2_000),
      weight: Math.max(1, Number(input.weight) || 1),
      status: input.status === "completed" ? "completed" : "planned",
      required: input.required !== false,
    });
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canRecordTask, work, actor);
      const existing = await client.query(`SELECT work_id,title,weight,status,required
        FROM tenant_work_task
        WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`, [actor.tenant_id, taskId]);
      if (existing.rows[0] && existing.rows[0].work_id !== workId) {
        fail("tenant_work_task_binding_conflict");
      }
      if (existing.rows[0] &&
          existing.rows[0].title === task.title &&
          Number(existing.rows[0].weight) === task.weight &&
          existing.rows[0].status === task.status &&
          existing.rows[0].required === task.required) {
        return deriveWorkStateWithClient(client, actor, workId, { persist: false });
      }
      assertOperationalWorkMutation(work);
      const persisted = await client.query(`INSERT INTO tenant_work_task (tenant_id,task_id,work_id,title,weight,status,required,acceptance_verified,completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,false,CASE WHEN $6::varchar='completed' THEN now() ELSE NULL END)
        ON CONFLICT (tenant_id,task_id) DO UPDATE
        SET title=EXCLUDED.title,weight=EXCLUDED.weight,status=EXCLUDED.status,
          required=EXCLUDED.required,acceptance_verified=false,
          completed_at=EXCLUDED.completed_at
        WHERE tenant_work_task.work_id=EXCLUDED.work_id
        RETURNING work_id`,
      [actor.tenant_id, taskId, workId, task.title, task.weight, task.status, task.required]);
      if (persisted.rows[0]?.work_id !== workId) fail("tenant_work_task_binding_conflict");
      return refreshDerivedWithClient(client, actor, workId);
    });
  }
  async function resolveNativeTaskBindingWithClient(client, source = {}) {
    if (!client || typeof client.query !== "function") {
      fail("native_v2_task_binding_transaction_required");
    }
    if (source.server_owned !== true) fail("native_v2_task_binding_server_owned_required");
    const tenantId = text(source.tenant_id, "native_v2_task_binding_tenant_invalid", 64);
    const workId = uuid(source.work_id, "native_v2_task_binding_work_invalid");
    const closureRevalidation = source.closure_revalidation === true;
    const taskId = source.task_id === undefined || source.task_id === null
      ? null
      : uuid(source.task_id, "native_v2_task_binding_task_invalid");
    if (!closureRevalidation && !taskId) fail("native_v2_task_binding_task_invalid");
    let linkedWork = null;
    if (closureRevalidation) {
      const linked = await client.query(`SELECT work_id,work_type FROM tenant_work
        WHERE tenant_id=$1 AND work_id=$2 AND legacy_work_id=$2 FOR UPDATE`,
      [tenantId, workId]);
      if (!linked.rows[0]) fail("native_v2_task_binding_work_invalid");
      linkedWork = linked.rows[0];
    }
    const result = closureRevalidation
      ? await client.query(`SELECT task_id,title,weight,required,status,acceptance_verified,revision
          FROM tenant_work_task
          WHERE tenant_id=$1 AND work_id=$2
          ORDER BY task_id FOR UPDATE`, [tenantId, workId])
      : await client.query(`SELECT task_id,title,weight,required,status,acceptance_verified,revision
          FROM tenant_work_task
          WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3`,
        [tenantId, workId, taskId]);
    const task = closureRevalidation && taskId
      ? result.rows.find((candidate) =>
          String(candidate.task_id).toLowerCase() === taskId.toLowerCase())
      : closureRevalidation ? null : result.rows[0];
    if ((!closureRevalidation || taskId) &&
        (!task || !["planned", "completed"].includes(task.status))) {
      fail("native_v2_task_binding_not_found");
    }
    const binding = task ? {
        ...buildNativeV2TaskBinding({
          tenant_id: tenantId,
          work_id: workId,
          task_id: task.task_id,
          title: task.title,
          weight: Number(task.weight),
          required: task.required,
        }),
        status: task.status,
        acceptance_verified: task.acceptance_verified === true,
        revision: Number(task.revision),
      } : {
        schema_version: "native_v2_work_task_bindings_v1",
        tenant_id: tenantId,
        work_id: workId.toLowerCase(),
      };
    if (closureRevalidation) {
      binding.work_type = String(linkedWork.work_type || "");
      binding.v2_task_governed = !(
        binding.work_type === "legacy" && result.rows.length === 0
      );
      binding.work_task_bindings = Object.freeze(result.rows.map((candidate) =>
        Object.freeze({
          ...buildNativeV2TaskBinding({
            tenant_id: tenantId,
            work_id: workId,
            task_id: candidate.task_id,
            title: candidate.title,
            weight: Number(candidate.weight),
            required: candidate.required,
          }),
          status: candidate.status,
          acceptance_verified: candidate.acceptance_verified === true,
          revision: Number(candidate.revision),
        })));
    }
    return Object.freeze(binding);
  }
  async function recordEvidence(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const evidenceId = input.evidence_id ? uuid(input.evidence_id, "evidence_id_invalid") : crypto.randomUUID();
    const evidence = Object.freeze({
      kind: text(input.kind, "evidence_kind_invalid", 80),
      digest: digest(input.digest, "evidence_digest_invalid"),
      required: false,
      independently_verified: false,
      verified_by_agent_id: null,
      verified_by_session_fingerprint: null,
      weight: Math.max(1, Number(input.weight) || 1),
      metadata: stable(input.metadata || {}),
    });
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canContributeEvidence, work, actor);
      const existing = await client.query(`SELECT work_id,kind,digest,required,
          independently_verified,verified_by_agent_id,
          verified_by_session_fingerprint,weight,metadata
        FROM tenant_work_evidence
        WHERE tenant_id=$1 AND evidence_id=$2 FOR UPDATE`, [actor.tenant_id, evidenceId]);
      if (existing.rows[0] && existing.rows[0].work_id !== workId) {
        fail("tenant_work_evidence_binding_conflict");
      }
      if (existing.rows[0]) {
        const exactReplay = existing.rows[0].kind === evidence.kind &&
          existing.rows[0].digest === evidence.digest &&
          existing.rows[0].required === evidence.required &&
          existing.rows[0].independently_verified === evidence.independently_verified &&
          (existing.rows[0].verified_by_agent_id || null) === evidence.verified_by_agent_id &&
          (existing.rows[0].verified_by_session_fingerprint || null) ===
            evidence.verified_by_session_fingerprint &&
          Number(existing.rows[0].weight) === evidence.weight &&
          objectDigest(existing.rows[0].metadata || {}) === objectDigest(evidence.metadata);
        if (!exactReplay) fail("tenant_work_evidence_conflict");
        return deriveWorkStateWithClient(client, actor, workId, { persist: false });
      }
      assertOperationalWorkMutation(work);
      // This generic client-facing path records candidate evidence only.
      // Independent evidence is derived exclusively by the atomic native
      // verifier bridge from a server-read terminal report and receipt.
      const persisted = await client.query(`INSERT INTO tenant_work_evidence (tenant_id,evidence_id,work_id,kind,digest,required,independently_verified,verified_by_agent_id,verified_by_session_fingerprint,weight,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        ON CONFLICT (tenant_id,evidence_id) DO NOTHING
        RETURNING work_id`,
      [actor.tenant_id, evidenceId, workId, evidence.kind, evidence.digest,
        // A client-submitted record is a candidate only.  It cannot become a
        // closure prerequisite before a server-owned verifier bridge derives
        // independent evidence from a terminal native receipt.
        evidence.required, evidence.independently_verified, evidence.verified_by_agent_id,
        evidence.verified_by_session_fingerprint, evidence.weight,
        JSON.stringify(evidence.metadata)]);
      if (persisted.rows[0]?.work_id !== workId) {
        fail("tenant_work_evidence_binding_conflict");
      }
      return refreshDerivedWithClient(client, actor, workId);
    });
  }
  async function recordOwnerManualMergeReleaseEvidence(identity, source = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const authorization = plainRecord(source.finalize_authorization)
      ? source.finalize_authorization
      : null;
    const proof = plainRecord(source.finalize_authorization_proof)
      ? source.finalize_authorization_proof
      : null;
    const predecessor = plainRecord(authorization?.predecessor)
      ? authorization.predecessor
      : null;
    const workId = uuid(authorization?.work_id, "owner_manual_merge_release_work_invalid");
    const ticketId = text(
      authorization?.action_ticket_id,
      "owner_manual_merge_release_ticket_invalid",
      240,
    );
    const receiptId = text(
      predecessor?.manual_merge_readback_id,
      "owner_manual_merge_release_receipt_invalid",
      240,
    );
    const receiptDigest = digest(
      predecessor?.manual_merge_readback_digest,
      "owner_manual_merge_release_receipt_invalid",
    );
    const proofFields = [
      "action_ticket_id", "authority", "authorization_digest", "authorization_signature_digest",
      "core_join_verdict_id", "expires_at", "intent_anchor_digest", "issued_at",
      "key_id", "proof_digest", "repository", "schema_version", "signature",
      "signature_algorithm", "signature_domain", "tenant_id", "work_id",
    ];
    const authorizationAllowedFields = new Set([
      "action_ticket_digest", "action_ticket_id", "allowed", "authorization_digest",
      "changed_files", "core_join_resolution_digest", "core_join_verdict_digest",
      "core_join_verdict_id", "decision", "decision_id", "evidence_digest",
      "expires_at", "external_execution_allowed", "external_readback_digest",
      "github_readback", "host_execution_required", "host_kind", "host_policy_must_allow",
      "host_policy_override", "host_readback_digest", "host_result_digest",
      "host_session_fingerprint", "issued_at", "live_services",
      "outcome_source", "predecessor", "predecessor_chain_digest",
      "previous_authorization_digest", "provider_execution", "readback_digest",
      "readback_source", "release_intent_digest", "release_manifest_digest",
      "repository", "result_commit_verified", "schema_version", "services_verified",
      "signature", "target_commit", "tenant_id", "trusted", "verification_scope",
      "work_id",
    ]);
    const authorizationRequiredFields = [
      "action_ticket_digest", "action_ticket_id", "allowed", "authorization_digest",
      "core_join_resolution_digest", "core_join_verdict_digest", "core_join_verdict_id",
      "decision", "decision_id", "evidence_digest", "expires_at",
      "external_readback_digest", "github_readback", "host_session_fingerprint",
      "issued_at", "live_services", "predecessor",
      "predecessor_chain_digest", "readback_digest", "readback_source",
      "release_intent_digest", "release_manifest_digest", "repository",
      "result_commit_verified", "schema_version", "services_verified", "signature",
      "target_commit", "tenant_id", "trusted", "verification_scope", "work_id",
    ];
    const issuedAt = Date.parse(String(authorization?.issued_at || ""));
    const expiresAt = Date.parse(String(authorization?.expires_at || ""));
    const proofUnsigned = proof && { ...proof };
    if (proofUnsigned) {
      delete proofUnsigned.proof_digest;
      delete proofUnsigned.signature;
    }
    const authorizationUnsigned = authorization && { ...authorization };
    if (authorizationUnsigned) {
      delete authorizationUnsigned.authorization_digest;
      delete authorizationUnsigned.signature;
    }
    const sourceAction = predecessor?.source_action;
    const github = authorization?.github_readback;
    const githubUnsigned = plainRecord(github) ? { ...github } : null;
    if (githubUnsigned) delete githubUnsigned.readback_digest;
    if (
      !authorization || authorization.schema_version !==
        "host_native_finalize_authorization_v1" ||
      !proof || !exactObjectKeys(proof, proofFields) ||
      proof.schema_version !== "host_native_finalize_authorization_proof_v1" ||
      proof.authority !== "universal_core" ||
      proof.signature_domain !== GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION ||
      proof.signature_algorithm !== "ed25519" ||
      proof.key_id !== resolvedCoreJoinVerifier?.metadata?.key_id ||
      proof.proof_digest !== objectDigest(proofUnsigned) ||
      typeof resolvedCoreJoinVerifier?.verifySignedDigest !== "function" ||
      !resolvedCoreJoinVerifier.verifySignedDigest({
        digest: proof.proof_digest,
        signature: proof.signature,
        key_id: proof.key_id,
        signature_domain: proof.signature_domain,
      }) ||
      proof.tenant_id !== actor.tenant_id ||
      proof.tenant_id !== authorization.tenant_id ||
      proof.work_id !== authorization.work_id ||
      proof.repository !== authorization.repository ||
      proof.action_ticket_id !== authorization.action_ticket_id ||
      proof.core_join_verdict_id !== authorization.core_join_verdict_id ||
      proof.authorization_digest !== authorization.authorization_digest ||
      proof.authorization_signature_digest !== objectDigest({
        signature: String(authorization.signature || ""),
      }) ||
      proof.issued_at !== authorization.issued_at ||
      proof.expires_at !== authorization.expires_at ||
      !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt >= expiresAt || expiresAt <= now().getTime() ||
      Object.keys(authorization).some((field) => !authorizationAllowedFields.has(field)) ||
      authorizationRequiredFields.some((field) => !Object.hasOwn(authorization, field)) ||
      authorization.authorization_digest !== objectDigest(authorizationUnsigned) ||
      authorization.trusted !== true || authorization.allowed !== true ||
      authorization.decision !== "ALLOW_FINALIZE" ||
      authorization.decision_id !== ticketId ||
      authorization.result_commit_verified !== true ||
      authorization.services_verified !== true ||
      authorization.verification_scope !== "full_release" ||
      authorization.provider_execution !== false ||
      authorization.host_policy_override !== false ||
      authorization.host_policy_must_allow !== true ||
      authorization.external_execution_allowed !== false ||
      authorization.host_execution_required !== true ||
      authorization.readback_source !== "core_server_external_readback_v1" ||
      authorization.readback_digest !== authorization.external_readback_digest ||
      predecessor?.schema_version !==
        "host_native_owner_manual_merge_predecessor_v2" ||
      predecessor?.predecessor_type !== "owner_manual_github_merge_readback" ||
      predecessor?.retrospective_ticket_issued !== false ||
      predecessor?.provider_execution !== false ||
      authorization.predecessor_chain_digest !== objectDigest(predecessor) ||
      predecessor.source_action_digest !== objectDigest(sourceAction) ||
      predecessor.source_evidence_digest !== receiptDigest ||
      authorization.evidence_digest !== receiptDigest ||
      predecessor.core_join_verdict_id !== authorization.core_join_verdict_id ||
      !HASH.test(String(predecessor.core_join_record_digest || "")) ||
      !HASH.test(String(authorization.core_join_verdict_digest || "")) ||
      !HASH.test(String(authorization.core_join_resolution_digest || "")) ||
      sourceAction?.kind !== "github.merge" ||
      sourceAction?.repository !== authorization.repository ||
      sourceAction?.pull_request !== github?.pull_request ||
      sourceAction?.head_branch !== github?.head_branch ||
      sourceAction?.base_branch !== github?.base_branch ||
      sourceAction?.head_commit !== github?.head_commit ||
      sourceAction?.checks_commit !== github?.checks_commit ||
      sourceAction?.expected_base_commit !== github?.expected_base_commit ||
      sourceAction?.provider_execution !== false ||
      predecessor.result_commit !== authorization.target_commit ||
      authorization.github_readback?.manual_merge_readback_id !== receiptId ||
      authorization.github_readback?.manual_merge_readback_digest !== receiptDigest ||
      authorization.github_readback?.merged !== true ||
      authorization.github_readback?.merge_commit !== authorization.target_commit ||
      authorization.github_readback?.target_commit !== authorization.target_commit ||
      authorization.github_readback?.branch_commit !== authorization.target_commit ||
      authorization.github_readback?.repository !== authorization.repository ||
      authorization.github_readback?.source_action_kind !== "github.merge" ||
      authorization.github_readback?.source_action_digest !==
        predecessor.source_action_digest ||
      authorization.github_readback?.source_readback_digest !==
        predecessor.source_readback_digest ||
      authorization.github_readback?.required_checks_policy_digest !==
        predecessor.source_required_checks_policy_digest ||
      authorization.github_readback?.checks_passed !== true ||
      authorization.github_readback?.readback_digest !== objectDigest(githubUnsigned) ||
      !Array.isArray(authorization.live_services) ||
      authorization.live_services.length < 1 ||
      authorization.live_services.some((service) =>
        service?.live_commit !== authorization.target_commit ||
        service?.health_status !== "healthy" ||
        service?.readback_digest !== objectDigest((({ readback_digest: _digest, ...rest }) =>
          rest)(service || {})))
    ) fail("owner_manual_merge_release_authorization_invalid");
    const evidenceBinding = {
      schema_version: "tenant_work_owner_manual_merge_release_evidence_v1",
      tenant_id: actor.tenant_id,
      work_id: workId,
      intent_anchor_digest: proof.intent_anchor_digest,
      repository: authorization.repository,
      action_ticket_id: ticketId,
      action_ticket_digest: digest(authorization.action_ticket_digest),
      core_join_verdict_id: authorization.core_join_verdict_id,
      core_join_verdict_digest: authorization.core_join_verdict_digest,
      manual_merge_readback_id: receiptId,
      manual_merge_readback_digest: receiptDigest,
      pull_request: sourceAction.pull_request,
      base_commit: sourceAction.expected_base_commit,
      head_commit: sourceAction.head_commit,
      target_commit: text(
        authorization.target_commit,
        "owner_manual_merge_release_target_invalid",
        64,
      ),
      external_readback_digest: digest(authorization.external_readback_digest),
      authorization_digest: digest(authorization.authorization_digest),
      authorization_proof_digest: proof.proof_digest,
      authorization_key_id: proof.key_id,
      verifier_id: authorization.readback_source,
      expires_at: authorization.expires_at,
      note: "owner_manual_merge",
      provider_execution: false,
    };
    const immutableReleaseIdentity = (metadata) => ({
      schema_version: "tenant_work_owner_manual_merge_release_identity_v1",
      tenant_id: metadata?.tenant_id,
      work_id: metadata?.work_id,
      intent_anchor_digest: metadata?.intent_anchor_digest,
      repository: metadata?.repository,
      action_ticket_id: metadata?.action_ticket_id,
      action_ticket_digest: metadata?.action_ticket_digest,
      core_join_verdict_id: metadata?.core_join_verdict_id,
      core_join_verdict_digest: metadata?.core_join_verdict_digest,
      manual_merge_readback_id: metadata?.manual_merge_readback_id,
      manual_merge_readback_digest: metadata?.manual_merge_readback_digest,
      pull_request: metadata?.pull_request,
      base_commit: metadata?.base_commit,
      head_commit: metadata?.head_commit,
      target_commit: metadata?.target_commit,
      external_readback_digest: metadata?.external_readback_digest,
      verifier_id: metadata?.verifier_id,
      note: metadata?.note,
      provider_execution: metadata?.provider_execution,
    });
    const immutableReleaseIdentityDigest = objectDigest(
      immutableReleaseIdentity(evidenceBinding),
    );
    const evidenceDigest = objectDigest(evidenceBinding);
    const outcome = await transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canClose, work, actor);
      if (work.intent_digest !== proof.intent_anchor_digest ||
          !plainRecord(work.architecture) ||
          work.architecture.repository !== authorization.repository) {
        fail("owner_manual_merge_release_work_binding_invalid");
      }
      const existing = await client.query(`SELECT evidence_id,digest,metadata
        FROM tenant_work_evidence
        WHERE tenant_id=$1 AND work_id=$2 AND kind='owner_manual_merge_release'
          AND metadata->>'manual_merge_readback_id'=$3
        ORDER BY created_at,evidence_id LIMIT 1 FOR UPDATE`,
      [actor.tenant_id, workId, receiptId]);
      if (existing.rows[0]) {
        if (objectDigest(immutableReleaseIdentity(existing.rows[0].metadata)) !==
            immutableReleaseIdentityDigest) {
          fail("owner_manual_merge_release_evidence_conflict");
        }
        return {
          work,
          evidence_id: existing.rows[0].evidence_id,
          // A fresh, valid finalize authorization may supersede an expired
          // authorization after a downstream closure retry. The evidence row
          // remains append-only and retains its original digest when all
          // immutable release facts are identical.
          evidence_digest: existing.rows[0].digest,
          idempotent_replay: true,
        };
      }
      assertOperationalWorkMutation(work);
      const evidenceId = crypto.randomUUID();
      await client.query(`INSERT INTO tenant_work_evidence
        (tenant_id,evidence_id,work_id,kind,digest,required,independently_verified,
         verified_by_agent_id,verified_by_session_fingerprint,weight,metadata)
        VALUES ($1,$2,$3,'owner_manual_merge_release',$4,true,true,$5,$6,1,$7::jsonb)`,
      [actor.tenant_id, evidenceId, workId, evidenceDigest,
        "universal_core_owner_manual_merge_release",
        text(authorization.host_session_fingerprint,
          "owner_manual_merge_release_session_invalid", 128),
        JSON.stringify(evidenceBinding)]);
      const event = await appendV2Event(
        client,
        actor,
        workId,
        "owner_manual_merge_release_verified",
        {
          evidence_id: evidenceId,
          evidence_digest: evidenceDigest,
          action_ticket_id: ticketId,
          manual_merge_readback_id: receiptId,
          authorization_digest: evidenceBinding.authorization_digest,
          target_commit: evidenceBinding.target_commit,
          note: "owner_manual_merge",
          authority: "universal_core_finalize_authorization",
        },
      );
      return {
        work,
        evidence_id: evidenceId,
        evidence_digest: evidenceDigest,
        event,
        idempotent_replay: false,
      };
    });
    return Object.freeze({
      schema_version: "tenant_work_owner_manual_merge_release_projection_v1",
      work_id: workId,
      adapter: outcome.work.work_type,
      evidence_id: outcome.evidence_id,
      evidence_digest: outcome.evidence_digest,
      note: "owner_manual_merge",
      legacy_bridged: Boolean(outcome.work.legacy_work_id),
      idempotent_replay: outcome.idempotent_replay,
      ...(outcome.event ? { event: outcome.event } : {}),
    });
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
    const taskEvaluationDigest = digest(
      source.task_evaluation_digest,
      "native_verifier_evidence_evaluation_digest_invalid",
    );
    const legacyReplayOnlyRequested = source.legacy_replay_only === true;
    if (!/^[a-f0-9]{16,64}$/.test(sessionFingerprint) ||
        !/^ags_[a-f0-9]{32}$/.test(presenceSignature)) {
      fail("native_verifier_evidence_presence_invalid");
    }
    const native = await client.query(`SELECT a.task_id,a.task_kind,a.task_digest,a.v2_task_id,a.v2_task_digest,
        a.status,a.report,a.report_digest,a.coordinator_session_fingerprint,
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
        objectDigest({ status: nativeRow.status, report: nativeRow.report }) !== nativeRow.report_digest ||
        nativeRow.report?.verdict !== "approved" ||
        nativeRow.report?.correction_required === true ||
        nativeRow.coordinator_session_fingerprint === sessionFingerprint) {
      fail("native_verifier_evidence_source_binding_invalid");
    }
    if (!reportHasPassingTests(nativeRow.report)) {
      fail("native_verifier_evidence_task_scope_invalid");
    }
    // The V2 task id is not supplied by the verifier report.  It is bound
    // before execution into every native assignment capability and re-read
    // here from the durable server-owned binding.
    const v2TaskId = nativeRow.v2_task_id
      ? uuid(nativeRow.v2_task_id, "native_verifier_evidence_task_binding_invalid")
      : null;
    if (!v2TaskId) fail("native_verifier_evidence_task_binding_missing");
    const suppliedV2TaskDigest = String(source.v2_task_digest || "").trim().toLowerCase();
    if (nativeRow.v2_task_digest && suppliedV2TaskDigest !== nativeRow.v2_task_digest) {
      fail("native_verifier_evidence_task_binding_invalid");
    }
    const scopedAgents = await client.query(`SELECT task_id,agent_id,task_kind,status,report,report_digest,
        coordinator_session_fingerprint,native_session_fingerprint,native_presence_signature,
        v2_task_id,v2_task_digest
      FROM core_continuity_native_agents
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
      ORDER BY task_id FOR UPDATE`, [tenantId, legacyWorkId, planId]);
    const scopedEvaluation = evaluateTaskScopedNativeVerifierEvidence({
      plan: nativeRow.plan,
      agents: scopedAgents.rows,
      verifier_task_id: taskId,
    });
    const historicalV1Replay = legacyReplayOnlyRequested &&
      scopedAgents.rows
        .filter((agent) =>
          String(agent.v2_task_id || "").trim().toLowerCase() === v2TaskId)
        .every((agent) => !agent.v2_task_digest) &&
      Boolean(nativeRow.report?.precommit_evidence);
    if ((!historicalV1Replay && scopedEvaluation.promotable !== true) ||
        scopedEvaluation.evaluation_digest !== taskEvaluationDigest) {
      fail("native_verifier_evidence_task_scope_invalid");
    }
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
    const verifiedBuilders = await client.query(`SELECT task_id,agent_id,status,task_digest,v2_task_id,v2_task_digest,report,report_digest,
        native_session_fingerprint,native_presence_signature
      FROM core_continuity_native_agents
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
        AND task_id = ANY($4::varchar[]) AND task_kind='builder'
      FOR UPDATE`, [tenantId, legacyWorkId, planId, verifiedBuilderTaskIds]);
    const scopedBuilders = await client.query(`SELECT task_id
      FROM core_continuity_native_agents
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
        AND task_kind='builder' AND v2_task_id=$4
      FOR UPDATE`, [tenantId, legacyWorkId, planId, v2TaskId]);
    const persistedBuilderTaskIds = new Set(verifiedBuilders.rows.map((row) => row.task_id));
    const scopedBuilderTaskIds = new Set(scopedBuilders.rows.map((row) => row.task_id));
    if (
      !scopedBuilders.rowCount ||
      verifiedBuilders.rowCount !== verifiedBuilderTaskIds.length ||
      verifiedBuilderTaskIds.some((task) => !persistedBuilderTaskIds.has(task)) ||
      [...scopedBuilderTaskIds].some((task) => !verifiedBuilderTaskIds.includes(task)) ||
      verifiedBuilders.rows.some((row) =>
        row.status !== "completed" ||
        !HASH.test(String(row.report_digest || "")) ||
        !reportHasPassingTests(row.report) ||
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
    const verifierWorkspaceDigest = verifiedNativePrecommitWorkspaceDigest(
      nativeRow.report?.precommit_evidence,
    );
    const scopedPrecommitPresent = Boolean(nativeRow.report?.precommit_evidence) ||
      verifiedBuilders.rows.some((row) => Boolean(row.report?.precommit_evidence));
    const matchingPrecommitEvidence = Boolean(
      verifierWorkspaceDigest && verifiedBuilders.rows.length &&
      verifiedBuilders.rows.every((row) =>
        verifiedNativePrecommitWorkspaceDigest(row.report?.precommit_evidence) ===
          verifierWorkspaceDigest),
    );
    if (scopedPrecommitPresent && !matchingPrecommitEvidence) {
      fail("native_verifier_evidence_task_scope_invalid");
    }
    if (!historicalV1Replay && !reportHasProvenVerifierEvidence(nativeRow.report, {
      matchingPrecommitEvidence,
      matchingV2TaskBinding: HASH.test(String(scopedEvaluation.v2_task_digest || "")),
    })) {
      fail("native_verifier_evidence_task_scope_invalid");
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
    const linkedWork = await client.query(`SELECT work_id,legacy_work_id,status,created_by_agent_id,
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
    const v2Task = await client.query(`SELECT task_id,title,weight,required,status,acceptance_verified
      FROM tenant_work_task
      WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3
      FOR UPDATE`, [tenantId, work.work_id, v2TaskId]);
    if (!v2Task.rows[0] || !["planned", "completed"].includes(v2Task.rows[0].status)) {
      fail("native_verifier_evidence_task_binding_invalid");
    }
    const currentV2TaskBinding = buildNativeV2TaskBinding({
      tenant_id: tenantId,
      work_id: work.work_id,
      task_id: v2Task.rows[0].task_id,
      title: v2Task.rows[0].title,
      weight: Number(v2Task.rows[0].weight),
      required: v2Task.rows[0].required,
    });
    const matchingV2TaskBinding = Boolean(
      HASH.test(String(nativeRow.v2_task_digest || "")) &&
      nativeRow.v2_task_digest === currentV2TaskBinding.v2_task_digest &&
      scopedEvaluation.v2_task_digest === currentV2TaskBinding.v2_task_digest &&
      verifiedBuilders.rows.every((row) =>
        row.v2_task_digest === currentV2TaskBinding.v2_task_digest),
    );
    const historicalV1ReplayStateValid = historicalV1Replay &&
      v2Task.rows[0].status === "completed" &&
      v2Task.rows[0].acceptance_verified === true;
    if (!historicalV1ReplayStateValid && ((nativeRow.v2_task_digest && !matchingV2TaskBinding) ||
        (v2Task.rows[0].status === "planned" && !matchingV2TaskBinding) ||
        (nativeRow.report.acceptance_evidence.length === 0 && !matchingV2TaskBinding))) {
      fail("native_verifier_evidence_task_binding_invalid");
    }
    const { title_preview: _v2TaskTitlePreview, ...canonicalV2TaskBinding } =
      currentV2TaskBinding;
    const verifiedBuilderBindingsV1 = verifiedBuilders.rows.map((row) => ({
      task_id: row.task_id,
      task_digest: row.task_digest,
      v2_task_id: row.v2_task_id,
      agent_id: row.agent_id,
      session_fingerprint: row.native_session_fingerprint,
      presence_signature: row.native_presence_signature,
      report_digest: row.report_digest,
    })).sort((left, right) => left.task_id.localeCompare(right.task_id));
    const legacyMaterial = {
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
      verified_builder_bindings: verifiedBuilderBindingsV1,
      native_receipt_id: receiptId,
      native_receipt_digest: receiptDigest,
      report_digest: reportDigest,
    };
    const material = matchingV2TaskBinding ? {
      ...legacyMaterial,
      schema_version: "native_verifier_terminal_evidence_v2",
      v2_task_digest: currentV2TaskBinding.v2_task_digest,
      v2_task_binding: canonicalV2TaskBinding,
      task_evaluation_digest: taskEvaluationDigest,
      scoped_report_bindings: scopedEvaluation.scoped_report_bindings,
      verified_builder_bindings: verifiedBuilderBindingsV1.map((binding) => ({
        ...binding,
        v2_task_digest: currentV2TaskBinding.v2_task_digest,
      })),
    } : legacyMaterial;
    const evidenceDigest = objectDigest(material);
    const metadata = stable({
      ...material,
      source: "server_native_verifier_terminal_report",
      authority: "evidence_only",
      execution_authorized: false,
    });
    const existing = await client.query(`SELECT evidence_id,task_digest,v2_task_id,v2_task_digest,verifier_agent_id,
        verifier_session_fingerprint,native_receipt_id,native_receipt_digest,report_digest,evidence_digest
      FROM tenant_work_native_verifier_evidence
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND task_id=$4
      FOR UPDATE`, [tenantId, work.work_id, planId, taskId]);
    if (!existing.rows[0] && historicalV1Replay) return null;
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.task_digest !== nativeRow.task_digest ||
          row.v2_task_id !== v2TaskId ||
          (row.v2_task_digest || null) !== (material.v2_task_digest || null) ||
          row.verifier_agent_id !== agentId ||
          row.verifier_session_fingerprint !== sessionFingerprint ||
          row.native_receipt_id !== receiptId ||
          row.native_receipt_digest !== receiptDigest ||
          row.report_digest !== reportDigest ||
          row.evidence_digest !== evidenceDigest) {
        fail("native_verifier_evidence_replay_conflict");
      }
      const evidence = await client.query(`SELECT digest,independently_verified,verified_by_agent_id,
          verified_by_session_fingerprint,metadata FROM tenant_work_evidence
        WHERE tenant_id=$1 AND evidence_id=$2 AND work_id=$3`,
      [tenantId, row.evidence_id, work.work_id]);
      const evidenceRow = evidence.rows[0];
      if (!evidenceRow || evidenceRow.digest !== evidenceDigest ||
          evidenceRow.independently_verified !== true ||
          evidenceRow.verified_by_agent_id !== agentId ||
          evidenceRow.verified_by_session_fingerprint !== sessionFingerprint ||
          objectDigest(evidenceRow.metadata) !== objectDigest(metadata)) {
        fail("native_verifier_evidence_replay_integrity_failed");
      }
      if (ARCHIVE_STATUSES.has(String(work.status || "").toUpperCase())) {
        if (v2Task.rows[0].status !== "completed" ||
            v2Task.rows[0].acceptance_verified !== true) {
          fail("native_verifier_evidence_replay_integrity_failed");
        }
        const derived = await deriveWorkStateWithClient(client, {
          tenant_id: tenantId,
          user_id: "core_native_verifier_evidence_bridge",
          agent_id: agentId,
          session_fingerprint: sessionFingerprint,
          team_ids: [], managed_team_ids: [], is_tenant_owner: true, is_super_admin: false,
        }, work.work_id, { persist: false });
        return Object.freeze({
          schema_version: material.schema_version,
          evidence_id: row.evidence_id,
          evidence_digest: evidenceDigest,
          report_digest: reportDigest,
          receipt_id: receiptId,
          v2_task_digest: material.v2_task_digest,
          task_evaluation_digest: taskEvaluationDigest,
          derived,
          idempotent_replay: true,
        });
      }
      assertOperationalWorkMutation(work);
      if (v2Task.rows[0].status !== "completed" ||
          v2Task.rows[0].acceptance_verified !== true) {
        fail("native_verifier_evidence_replay_integrity_failed");
      }
      const derived = await deriveWorkStateWithClient(client, {
        tenant_id: tenantId,
        user_id: "core_native_verifier_evidence_bridge",
        agent_id: agentId,
        session_fingerprint: sessionFingerprint,
        team_ids: [], managed_team_ids: [], is_tenant_owner: true, is_super_admin: false,
      }, work.work_id, { persist: false });
      return Object.freeze({
        schema_version: material.schema_version,
        evidence_id: row.evidence_id,
        evidence_digest: evidenceDigest,
        report_digest: reportDigest,
        receipt_id: receiptId,
        v2_task_digest: material.v2_task_digest,
        task_evaluation_digest: taskEvaluationDigest,
        derived,
        idempotent_replay: true,
      });
    }
    assertOperationalWorkMutation(work);
    const evidenceId = crypto.randomUUID();
    await client.query(`INSERT INTO tenant_work_evidence
      (tenant_id,evidence_id,work_id,kind,digest,required,independently_verified,
       verified_by_agent_id,verified_by_session_fingerprint,weight,metadata)
      VALUES ($1,$2,$3,$4,$5,true,true,$6,$7,1,$8::jsonb)`, [
      tenantId, evidenceId, work.work_id, "native_verifier_terminal_report", evidenceDigest,
      agentId, sessionFingerprint, JSON.stringify(metadata),
    ]);
    await client.query(`INSERT INTO tenant_work_native_verifier_evidence
      (tenant_id,work_id,plan_id,task_id,task_digest,v2_task_id,v2_task_digest,verifier_agent_id,
       verifier_session_fingerprint,native_receipt_id,native_receipt_digest,
       report_digest,evidence_id,evidence_digest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
      tenantId, work.work_id, planId, taskId, nativeRow.task_digest, v2TaskId,
      material.v2_task_digest || null, agentId, sessionFingerprint, receiptId, receiptDigest,
      reportDigest, evidenceId, evidenceDigest,
    ]);
    const promotedTask = await client.query(`UPDATE tenant_work_task SET status='completed',
        acceptance_verified=true,completed_at=coalesce(completed_at,now())
      WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3
        AND (status='completed' OR (status='planned' AND $4::boolean=true)) RETURNING task_id`,
    [tenantId, work.work_id, v2TaskId, matchingV2TaskBinding]);
    if (!promotedTask.rows[0]) fail("native_verifier_evidence_task_binding_invalid");
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
      task_evaluation_digest: taskEvaluationDigest,
      v2_task_digest: material.v2_task_digest,
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
      schema_version: material.schema_version,
      evidence_id: evidenceId,
      evidence_digest: evidenceDigest,
      report_digest: reportDigest,
      receipt_id: receiptId,
      v2_task_digest: material.v2_task_digest,
      task_evaluation_digest: taskEvaluationDigest,
      event,
      derived,
      idempotent_replay: false,
    });
  }
  async function readPrecommitTicketGateWithClient(client, actor, workId, { lock = false } = {}) {
    const supersedingGateResult = await client.query(`SELECT *
      FROM tenant_work_precommit_ticket_gate_supersession
      WHERE tenant_id=$1 AND work_id=$2 AND action_kind='git.commit'
        AND gate_kind='ticket_acquisition'
      ORDER BY gate_version DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [actor.tenant_id, workId]);
    const superseding = Boolean(supersedingGateResult.rows[0]);
    const gateResult = superseding ? supersedingGateResult : await client.query(
      `SELECT * FROM tenant_work_precommit_ticket_gate
        WHERE tenant_id=$1 AND work_id=$2 AND action_kind='git.commit'
          AND gate_kind='ticket_acquisition'${lock ? " FOR UPDATE" : ""}`,
      [actor.tenant_id, workId],
    );
    if (!gateResult.rows[0]) return null;
    if (gateResult.rows.length !== 1) fail("precommit_ticket_gate_ambiguous");
    const gate = gateResult.rows[0];
    const gateSource = gate.gate_source || "legacy_evidence_reconciliation";
    const nativeGate = gateSource === "native_closure_evaluation";
    if (!nativeGate && gateSource !== "legacy_evidence_reconciliation") {
      fail("precommit_ticket_gate_source_invalid");
    }
    const gateVersion = superseding ? Number(gate.gate_version) : 1;
    const reconciliationTable = superseding
      ? "tenant_work_precommit_evidence_reconciliation_supersession"
      : "tenant_work_precommit_evidence_reconciliation";
    const fulfillmentTable = superseding
      ? "tenant_work_precommit_ticket_fulfillment_supersession"
      : "tenant_work_precommit_ticket_fulfillment";
    const reconciliationVersionPredicate = superseding ? " AND r.gate_version=$4" : "";
    const fulfillmentVersionPredicate = superseding ? " AND gate_version=$4" : "";
    const mappingsResult = await client.query(`SELECT r.*,legacy.required AS legacy_required,
          legacy.independently_verified AS legacy_independently_verified,
          replacement.required AS replacement_required,
          replacement.independently_verified AS replacement_independently_verified,
          replacement.digest AS current_replacement_evidence_digest,
          replacement.kind AS replacement_kind,
          native.plan_id AS native_plan_id,native.evidence_id AS native_evidence_id,
          native.native_receipt_id AS current_native_receipt_id,
          native.native_receipt_digest AS current_native_receipt_digest,
          native.evidence_digest AS native_evidence_digest
        FROM ${reconciliationTable} r
        JOIN tenant_work_evidence legacy
          ON legacy.tenant_id=r.tenant_id AND legacy.evidence_id=r.legacy_evidence_id
            AND legacy.work_id=r.work_id
        JOIN tenant_work_evidence replacement
          ON replacement.tenant_id=r.tenant_id AND replacement.evidence_id=r.replacement_evidence_id
            AND replacement.work_id=r.work_id
        JOIN tenant_work_native_verifier_evidence native
          ON native.tenant_id=r.tenant_id AND native.work_id=r.work_id
            AND native.evidence_id=r.replacement_evidence_id
        WHERE r.tenant_id=$1 AND r.work_id=$2 AND r.task_id=$3${reconciliationVersionPredicate}
        ORDER BY r.legacy_evidence_id${lock ? " FOR UPDATE OF r" : ""}`,
    superseding
      ? [actor.tenant_id, workId, gate.task_id, gateVersion]
      : [actor.tenant_id, workId, gate.task_id]);
    const taskResult = await client.query(`SELECT task_id,status,required,acceptance_verified FROM tenant_work_task
        WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3${lock ? " FOR UPDATE" : ""}`,
    [actor.tenant_id, workId, gate.task_id]);
    const planRowsResult = await client.query(`SELECT plan_id,plan,plan_digest,status,plan_version,supersedes_plan_id
        FROM core_continuity_native_plans WHERE tenant_id=$1 AND work_id=$2
        ORDER BY plan_version,plan_id${lock ? " FOR UPDATE" : ""}`,
    [actor.tenant_id, workId]);
    const evaluationResult = await client.query(`SELECT evaluation_id,evaluation,evaluation_digest FROM core_continuity_closure_evaluations
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
        ORDER BY created_at DESC,evaluation_id DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [actor.tenant_id, workId, gate.plan_id]);
    const fulfillmentResult = await client.query(`SELECT ticket_id,ticket_digest,gate_projection_digest,fulfillment_digest
      FROM ${fulfillmentTable}
      WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3${fulfillmentVersionPredicate}${
        lock ? " FOR UPDATE" : ""}`,
    superseding
      ? [actor.tenant_id, workId, gate.task_id, gateVersion]
      : [actor.tenant_id, workId, gate.task_id]);
    const mappings = mappingsResult.rows;
    const task = taskResult.rows[0];
    const planRows = planRowsResult.rows;
    const currentPlan = [...planRows].reverse().find((row) => row.status !== "superseded") || null;
    const plan = planRows.find((row) => row.plan_id === gate.plan_id) || null;
    const evaluation = evaluationResult.rows[0] || null;
    const fulfillment = fulfillmentResult.rows[0] || null;
    const currentSupersessionDigest = nativePlanSupersessionDigest(planRows);
    const driftCodes = [];
    const drift = (code) => { if (!driftCodes.includes(code)) driftCodes.push(code); };
    let v2TaskScope = null;
    if (nativeGate) {
      try {
        const evaluationScope = normalizeNativePrecommitScope(
          evaluation?.evaluation?.native_v2_precommit_scope,
        );
        const gateScope = normalizeNativePrecommitScope({
          schema_version: "native_v2_precommit_scope_v1",
          scope_snapshot_digest: gate.v2_scope_snapshot_digest,
          v2_task_governed: evaluationScope.v2_task_governed,
          tasks: gate.v2_scope_tasks,
        });
        if (objectDigest(evaluationScope) !== objectDigest(gateScope)) {
          drift("precommit_gate_v2_scope_drift");
        } else {
          v2TaskScope = gateScope;
        }
      } catch {
        drift("precommit_gate_v2_scope_drift");
      }
    }
    if (gate.action_kind !== "git.commit" || gate.gate_kind !== "ticket_acquisition") {
      drift("precommit_gate_kind_invalid");
    }
    if (!task || task.required !== true) drift("precommit_gate_task_missing");
    if (!fulfillment && task && (task.status !== "planned" || task.acceptance_verified === true)) {
      drift("precommit_gate_task_state_drift");
    }
    if (fulfillment && task && (task.status !== "completed" || task.acceptance_verified !== true)) {
      drift("precommit_gate_fulfillment_state_drift");
    }
    if (!plan || currentPlan?.plan_id !== gate.plan_id || plan.status !== "planned" ||
        objectDigest(plan.plan) !== plan.plan_digest) drift("precommit_gate_plan_drift");
    if (currentSupersessionDigest !== gate.supersession_digest) {
      drift("precommit_gate_supersession_drift");
    }
    if (!evaluation || evaluation.evaluation_id !== gate.evaluation_id ||
        evaluation.evaluation_digest !== gate.evaluation_digest ||
        objectDigest(evaluation.evaluation) !== evaluation.evaluation_digest ||
        evaluation.evaluation?.schema_version !== "native_closure_evaluation_v1" ||
        evaluation.evaluation?.closed !== false ||
        evaluation.evaluation?.commit_ticket_ready !== true ||
        evaluation.evaluation?.precommit_verification?.ready !== true ||
        evaluation.evaluation?.precommit_verification?.workspace_digest !== gate.workspace_digest) {
      drift("precommit_gate_evaluation_drift");
    }
    if (!nativeGate && !mappings.length) drift("precommit_gate_mapping_missing");
    if (nativeGate && mappings.length) drift("precommit_gate_native_mapping_present");
    if (!nativeGate && mappings.some((row) =>
      row.plan_id !== gate.plan_id || row.evaluation_id !== gate.evaluation_id ||
      row.evaluation_digest !== gate.evaluation_digest || row.workspace_digest !== gate.workspace_digest ||
      row.supersession_digest !== gate.supersession_digest ||
      row.reconciliation_digest !== gate.reconciliation_digest ||
      row.legacy_required !== true || row.legacy_independently_verified === true ||
      row.replacement_required !== true || row.replacement_independently_verified !== true ||
      row.replacement_kind !== "native_verifier_terminal_report" ||
      row.current_replacement_evidence_digest !== row.replacement_evidence_digest ||
      row.native_plan_id !== gate.plan_id || row.native_evidence_id !== row.replacement_evidence_id ||
      row.current_native_receipt_id !== row.native_receipt_id ||
      row.current_native_receipt_digest !== row.native_receipt_digest ||
      row.native_evidence_digest !== row.replacement_evidence_digest)) {
      drift("precommit_gate_evidence_drift");
    }
    const projection = {
      schema_version: nativeGate ? "precommit_ticket_gate_v2" : "precommit_ticket_gate_v1",
      ...(nativeGate ? { gate_source: gateSource } : {}),
      tenant_id: actor.tenant_id,
      work_id: workId,
      action_kind: "git.commit",
      gate_kind: "ticket_acquisition",
      task_id: gate.task_id,
      plan_id: gate.plan_id,
      evaluation_id: gate.evaluation_id,
      evaluation_digest: gate.evaluation_digest,
      workspace_digest: gate.workspace_digest,
      supersession_digest: gate.supersession_digest,
      reconciliation_digest: gate.reconciliation_digest,
      ...(nativeGate ? {
        v2_scope_snapshot_digest: gate.v2_scope_snapshot_digest || null,
        v2_scope_tasks: v2TaskScope?.tasks || [],
      } : {}),
      legacy_evidence_ids: mappings.map((row) => row.legacy_evidence_id).sort(),
      replacement_evidence_ids: mappings.map((row) => row.replacement_evidence_id).sort(),
      fulfilled: Boolean(fulfillment),
      ticket_id: fulfillment?.ticket_id || null,
      fresh: driftCodes.length === 0,
      drift_codes: driftCodes,
    };
    return Object.freeze({ ...projection, projection_digest: objectDigest(projection) });
  }
  async function readPrecommitTicketGate(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    const work = await loadWork(pool, actor, workId, false);
    assertPermission(canRead, work, actor);
    return readPrecommitTicketGateWithClient(pool, actor, workId);
  }
  function precommitClaimProjection(row, replay = false) {
    const material = {
      schema_version: "precommit_ticket_gate_claim_v1", claim_id: row.claim_id,
      work_id: row.work_id,
      gate_projection_digest: row.gate_projection_digest,
      continuation_ref: row.continuation_ref, request_digest: row.request_digest,
      delegation_id: row.delegation_id, action_digest: row.action_digest,
      host_session_fingerprint: row.host_session_fingerprint,
      idempotency_key: row.idempotency_key,
      replay,
    };
    return Object.freeze({ ...material, claim_digest: objectDigest(material) });
  }
  async function claimPrecommitTicketGate(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id, "precommit_gate_claim_work_invalid");
    const projectionDigest = digest(input.gate_projection_digest, "precommit_gate_claim_projection_invalid");
    const continuationRef = text(input.continuation_ref, "precommit_gate_claim_continuation_invalid", 240);
    const requestDigest = digest(input.request_digest, "precommit_gate_claim_request_invalid");
    const delegationId = text(input.delegation_id, "precommit_gate_claim_delegation_invalid", 160);
    const actionDigest = digest(input.action_digest, "precommit_gate_claim_action_invalid");
    const hostSessionFingerprint = text(input.host_session_fingerprint,
      "precommit_gate_claim_host_invalid", 128).toLowerCase();
    const idempotencyKey = text(input.idempotency_key, "precommit_gate_claim_idempotency_invalid", 160);
    if (!/^[a-f0-9]{16,128}$/.test(hostSessionFingerprint) ||
        hostSessionFingerprint !== String(identity?.agentPresence?.session_fingerprint || "").toLowerCase()) {
      fail("precommit_gate_claim_host_invalid");
    }
    return transaction(async (client) => {
      const coreWork = await client.query(`SELECT work_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
      if (!coreWork.rows[0]) fail("tenant_work_not_found");
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      const gate = await readPrecommitTicketGateWithClient(client, actor, workId, { lock: true });
      let scopeTasks = Object.freeze([]);
      const existingResult = await client.query(`SELECT c.*,f.ticket_id AS fulfilled_ticket_id,
          a.abandonment_digest
        FROM tenant_work_precommit_ticket_gate_claim c
        LEFT JOIN tenant_work_precommit_ticket_gate_claim_fulfillment f
          ON f.tenant_id=c.tenant_id AND f.work_id=c.work_id
            AND f.gate_projection_digest=c.gate_projection_digest
        LEFT JOIN tenant_work_precommit_ticket_gate_claim_abandonment a
          ON a.tenant_id=c.tenant_id AND a.work_id=c.work_id
            AND a.gate_projection_digest=c.gate_projection_digest
            AND a.claim_id=c.claim_id
        WHERE c.tenant_id=$1 AND c.work_id=$2 AND
          (c.gate_projection_digest=$3 OR c.idempotency_key=$4) FOR UPDATE OF c`,
      [actor.tenant_id, workId, projectionDigest, idempotencyKey]);
      const existing = existingResult.rows[0];
      if (existing) {
        const exact = existing.gate_projection_digest === projectionDigest &&
          existing.continuation_ref === continuationRef && existing.request_digest === requestDigest &&
          existing.delegation_id === delegationId && existing.action_digest === actionDigest &&
          existing.host_session_fingerprint === hostSessionFingerprint &&
          existing.idempotency_key === idempotencyKey;
        if (!exact) fail("precommit_gate_claim_replay_conflict");
        if (existing.abandonment_digest) fail("precommit_gate_claim_abandoned");
        if (existing.fulfilled_ticket_id) return precommitClaimProjection(existing, true);
        if (gate?.schema_version === "precommit_ticket_gate_v2") {
          scopeTasks = await lockAndValidateNativePrecommitScope(client, actor, workId, gate);
          const freezes = await client.query(`SELECT task_id,revision,v2_task_digest,
              scope_snapshot_digest,gate_projection_digest
            FROM tenant_work_precommit_scope_freeze
            WHERE tenant_id=$1 AND work_id=$2 AND claim_id=$3
            ORDER BY task_id FOR UPDATE`, [actor.tenant_id, workId, existing.claim_id]);
          const expectedFreezes = scopeTasks.map((task) => ({
            task_id: task.task_id,
            revision: task.revision,
            v2_task_digest: task.v2_task_digest,
            scope_snapshot_digest: gate.v2_scope_snapshot_digest,
            gate_projection_digest: projectionDigest,
          }));
          if (objectDigest(freezes.rows.map((row) => ({ ...row,
            revision: Number(row.revision),
          }))) !== objectDigest(expectedFreezes)) {
            fail("precommit_gate_claim_v2_freeze_invalid");
          }
        }
        return precommitClaimProjection(existing, true);
      }
      const activeClaim = await client.query(`SELECT c.claim_id
        FROM tenant_work_precommit_ticket_gate_claim c
        LEFT JOIN tenant_work_precommit_ticket_gate_claim_fulfillment f
          ON f.tenant_id=c.tenant_id AND f.work_id=c.work_id
            AND f.gate_projection_digest=c.gate_projection_digest AND f.claim_id=c.claim_id
        LEFT JOIN tenant_work_precommit_ticket_gate_claim_abandonment a
          ON a.tenant_id=c.tenant_id AND a.work_id=c.work_id
            AND a.gate_projection_digest=c.gate_projection_digest AND a.claim_id=c.claim_id
        WHERE c.tenant_id=$1 AND c.work_id=$2 AND f.claim_id IS NULL AND a.claim_id IS NULL
        LIMIT 1 FOR UPDATE OF c`, [actor.tenant_id, workId]);
      if (activeClaim.rows[0]) fail("precommit_gate_claim_active");
      assertOperationalWorkMutation(work);
      if (!gate || gate.fresh !== true || gate.projection_digest !== projectionDigest) {
        fail("precommit_gate_claim_gate_invalid");
      }
      if (gate.fulfilled === true) fail("precommit_gate_claim_gate_invalid");
      if (gate.schema_version === "precommit_ticket_gate_v2") {
        scopeTasks = await lockAndValidateNativePrecommitScope(client, actor, workId, gate);
      }
      const claimId = crypto.randomUUID();
      const row = { claim_id: claimId, tenant_id: actor.tenant_id, work_id: workId,
        gate_projection_digest: projectionDigest, continuation_ref: continuationRef,
        request_digest: requestDigest, delegation_id: delegationId, action_digest: actionDigest,
        host_session_fingerprint: hostSessionFingerprint, idempotency_key: idempotencyKey };
      const projection = precommitClaimProjection(row);
      await client.query(`INSERT INTO tenant_work_precommit_ticket_gate_claim
        (tenant_id,work_id,gate_projection_digest,claim_id,continuation_ref,request_digest,
         delegation_id,action_digest,host_session_fingerprint,idempotency_key,claim_digest,state,
         ticket_id,claimed_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CLAIMED',NULL,$12)`,
      [actor.tenant_id, workId, projectionDigest, claimId, continuationRef, requestDigest,
        delegationId, actionDigest, hostSessionFingerprint, idempotencyKey,
        projection.claim_digest, actor.user_id]);
      for (const task of scopeTasks) {
        await client.query(`INSERT INTO tenant_work_precommit_scope_freeze
          (tenant_id,work_id,gate_projection_digest,claim_id,task_id,revision,
           v2_task_digest,scope_snapshot_digest)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [actor.tenant_id, workId,
          projectionDigest, claimId, task.task_id, task.revision,
          task.v2_task_digest, gate.v2_scope_snapshot_digest]);
      }
      await appendV2Event(client, actor, workId, "precommit_ticket_gate_claimed", {
        claim_id: claimId, claim_digest: projection.claim_digest,
        gate_projection_digest: projectionDigest, continuation_ref: continuationRef,
        request_digest: requestDigest, delegation_id: delegationId, action_digest: actionDigest,
        v2_scope_snapshot_digest: gate?.v2_scope_snapshot_digest || null,
        frozen_v2_task_ids: scopeTasks.map((task) => task.task_id),
        host_session_fingerprint: hostSessionFingerprint, execution_authorized: false,
      });
      return projection;
    });
  }
  async function readPrecommitTicketGateClaimRecovery(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id, "precommit_claim_recovery_work_invalid");
    const work = await loadWork(pool, actor, workId, false);
    assertPermission(canAdminister, work, actor);
    let gateClaim = input.gate_claim;
    if (!gateClaim) {
      const continuationRef = input.continuation_ref === undefined ? null
        : text(input.continuation_ref, "precommit_claim_recovery_continuation_invalid", 240);
      const gateProjectionDigest = input.gate_projection_digest === undefined ? null
        : digest(input.gate_projection_digest, "precommit_claim_recovery_projection_invalid");
      const fulfilledRecovery = input.fulfilled === true;
      if ([continuationRef !== null, gateProjectionDigest !== null, fulfilledRecovery]
        .filter(Boolean).length !== 1) {
        fail("precommit_claim_recovery_selector_invalid");
      }
      const requestDigest = digest(input.request_digest, "precommit_claim_recovery_request_invalid");
      const delegationId = text(input.delegation_id, "precommit_claim_recovery_delegation_invalid", 160);
      const actionDigest = digest(input.action_digest, "precommit_claim_recovery_action_invalid");
      const host = text(input.host_session_fingerprint, "precommit_claim_recovery_host_invalid", 128).toLowerCase();
      if (host !== String(identity?.agentPresence?.session_fingerprint || "").toLowerCase()) {
        fail("precommit_claim_recovery_host_invalid");
      }
      const found = await pool.query(`SELECT c.*,f.ticket_id AS fulfilled_ticket_id,
          f.claim_id AS fulfilled_claim_id,f.claim_digest AS fulfilled_claim_digest,
          r.ticket_id AS reconciled_ticket_id,b.before_ticket_locator,a.abandonment_digest
        FROM tenant_work_precommit_ticket_gate_claim c
        LEFT JOIN tenant_work_precommit_ticket_gate_claim_fulfillment f
          ON f.tenant_id=c.tenant_id AND f.work_id=c.work_id AND f.gate_projection_digest=c.gate_projection_digest
        LEFT JOIN tenant_work_precommit_ticket_gate_claim_abandonment a
          ON a.tenant_id=c.tenant_id AND a.work_id=c.work_id
            AND a.gate_projection_digest=c.gate_projection_digest AND a.claim_id=c.claim_id
        LEFT JOIN LATERAL (SELECT cr.ticket_id
          FROM tenant_work_precommit_ticket_gate_claim_reconciliation cr
          WHERE cr.tenant_id=c.tenant_id AND cr.work_id=c.work_id AND cr.claim_id=c.claim_id
            AND cr.stage='ticket_locator_received' AND cr.ticket_id IS NOT NULL LIMIT 1) r ON true
        LEFT JOIN LATERAL (SELECT true AS before_ticket_locator
          FROM tenant_work_precommit_ticket_gate_claim_reconciliation cb
          WHERE cb.tenant_id=c.tenant_id AND cb.work_id=c.work_id AND cb.claim_id=c.claim_id
            AND cb.stage='before_ticket_locator' LIMIT 1) b ON true
        WHERE c.tenant_id=$1 AND c.work_id=$2 AND ${gateProjectionDigest
          ? "c.gate_projection_digest=$3" : continuationRef
            ? "c.continuation_ref=$3" : "$3::boolean IS TRUE AND f.ticket_id IS NOT NULL"} AND c.request_digest=$4
          AND c.delegation_id=$5 AND c.action_digest=$6 AND c.host_session_fingerprint=$7`,
      [actor.tenant_id, workId, gateProjectionDigest || continuationRef || true,
        requestDigest, delegationId, actionDigest, host]);
      if (found.rows.length !== 1) return null;
      const recovered = found.rows[0];
      if (recovered.fulfilled_ticket_id &&
          (recovered.fulfilled_claim_id !== recovered.claim_id ||
            ![recovered.claim_digest, precommitClaimProjection(recovered, true).claim_digest]
              .includes(recovered.fulfilled_claim_digest))) {
        fail("precommit_claim_recovery_fulfillment_invalid");
      }
      const recoveredTicketId = recovered.fulfilled_ticket_id || recovered.reconciled_ticket_id || null;
      const recoverySource = recovered.fulfilled_ticket_id ? "fulfillment"
        : recovered.abandonment_digest ? "abandonment"
        : recovered.reconciled_ticket_id ? "reconciliation"
          : recovered.before_ticket_locator === true ? "before_ticket_locator" : "claim";
      gateClaim = precommitClaimProjection(found.rows[0], true);
      return Object.freeze({ schema_version: "precommit_ticket_gate_recovery_v1",
        ticket_id: recoveredTicketId,
        recovery_source: recoverySource,
        gate_claim: gateClaim });
    }
    const material = gateClaim && { ...gateClaim };
    if (material) delete material.claim_digest;
    if (!gateClaim || gateClaim.schema_version !== "precommit_ticket_gate_claim_v1" ||
        objectDigest(material) !== gateClaim.claim_digest || gateClaim.work_id !== workId) {
      fail("precommit_claim_recovery_claim_invalid");
    }
    const result = await pool.query(`SELECT c.*,f.ticket_id AS fulfilled_ticket_id,
        f.claim_id AS fulfilled_claim_id,f.claim_digest AS fulfilled_claim_digest,
        r.ticket_id AS reconciled_ticket_id,b.before_ticket_locator,a.abandonment_digest
      FROM tenant_work_precommit_ticket_gate_claim c
      LEFT JOIN tenant_work_precommit_ticket_gate_claim_fulfillment f
        ON f.tenant_id=c.tenant_id AND f.work_id=c.work_id
          AND f.gate_projection_digest=c.gate_projection_digest
      LEFT JOIN tenant_work_precommit_ticket_gate_claim_abandonment a
        ON a.tenant_id=c.tenant_id AND a.work_id=c.work_id
          AND a.gate_projection_digest=c.gate_projection_digest AND a.claim_id=c.claim_id
      LEFT JOIN LATERAL (SELECT cr.ticket_id
        FROM tenant_work_precommit_ticket_gate_claim_reconciliation cr
        WHERE cr.tenant_id=c.tenant_id AND cr.work_id=c.work_id AND cr.claim_id=c.claim_id
          AND cr.stage='ticket_locator_received' AND cr.ticket_id IS NOT NULL LIMIT 1) r ON true
      LEFT JOIN LATERAL (SELECT true AS before_ticket_locator
        FROM tenant_work_precommit_ticket_gate_claim_reconciliation cb
        WHERE cb.tenant_id=c.tenant_id AND cb.work_id=c.work_id AND cb.claim_id=c.claim_id
          AND cb.stage='before_ticket_locator' LIMIT 1) b ON true
      WHERE c.tenant_id=$1 AND c.work_id=$2 AND c.claim_id=$3`,
    [actor.tenant_id, workId, gateClaim.claim_id]);
    const row = result.rows[0];
    if (!row || row.gate_projection_digest !== gateClaim.gate_projection_digest ||
        row.continuation_ref !== gateClaim.continuation_ref || row.request_digest !== gateClaim.request_digest ||
        row.delegation_id !== gateClaim.delegation_id || row.action_digest !== gateClaim.action_digest ||
        row.host_session_fingerprint !== gateClaim.host_session_fingerprint ||
        row.idempotency_key !== gateClaim.idempotency_key) return null;
    if (row.fulfilled_ticket_id &&
        (row.fulfilled_claim_id !== row.claim_id ||
          ![row.claim_digest, precommitClaimProjection(row, true).claim_digest]
            .includes(row.fulfilled_claim_digest))) {
      fail("precommit_claim_recovery_fulfillment_invalid");
    }
    const recoveredTicketId = row.fulfilled_ticket_id || row.reconciled_ticket_id || null;
    const recoverySource = row.fulfilled_ticket_id ? "fulfillment"
      : row.abandonment_digest ? "abandonment"
      : row.reconciled_ticket_id ? "reconciliation"
        : row.before_ticket_locator === true ? "before_ticket_locator" : "claim";
    return Object.freeze({ schema_version: "precommit_ticket_gate_recovery_v1",
      ticket_id: recoveredTicketId,
      recovery_source: recoverySource,
      gate_claim: gateClaim });
  }
  async function reconcilePrecommitTicketGateClaim(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id, "precommit_claim_reconciliation_work_invalid");
    const gateClaim = input.gate_claim;
    const projectionDigest = digest(input.gate_projection_digest,
      "precommit_claim_reconciliation_projection_invalid");
    const stage = text(input.stage, "precommit_claim_reconciliation_stage_invalid", 40);
    if (!["before_ticket_locator", "ticket_locator_received"].includes(stage)) {
      fail("precommit_claim_reconciliation_stage_invalid");
    }
    const ticketId = input.ticket_id === null ? null : text(input.ticket_id,
      "precommit_claim_reconciliation_ticket_invalid", 160);
    const errorCode = text(input.error_code, "precommit_claim_reconciliation_error_invalid", 160);
    const requestDigest = digest(input.request_digest, "precommit_claim_reconciliation_request_invalid");
    const continuationRef = text(input.continuation_ref,
      "precommit_claim_reconciliation_continuation_invalid", 240);
    const idempotencyKey = text(input.idempotency_key,
      "precommit_claim_reconciliation_idempotency_invalid", 160);
    const receiptMaterial = gateClaim && { ...gateClaim };
    if (receiptMaterial) delete receiptMaterial.claim_digest;
    if (!gateClaim || gateClaim.schema_version !== "precommit_ticket_gate_claim_v1" ||
        objectDigest(receiptMaterial) !== gateClaim.claim_digest || gateClaim.work_id !== workId ||
        gateClaim.gate_projection_digest !== projectionDigest || gateClaim.request_digest !== requestDigest ||
        gateClaim.continuation_ref !== continuationRef || gateClaim.idempotency_key !== idempotencyKey) {
      fail("precommit_claim_reconciliation_claim_invalid");
    }
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      const claimResult = await client.query(`SELECT * FROM tenant_work_precommit_ticket_gate_claim
        WHERE tenant_id=$1 AND work_id=$2 AND claim_id=$3 FOR UPDATE`,
      [actor.tenant_id, workId, gateClaim.claim_id]);
      const claim = claimResult.rows[0];
      if (!claim || claim.gate_projection_digest !== projectionDigest ||
          claim.request_digest !== requestDigest || claim.continuation_ref !== continuationRef ||
          claim.idempotency_key !== idempotencyKey) fail("precommit_claim_reconciliation_claim_invalid");
      const existing = await client.query(`SELECT * FROM tenant_work_precommit_ticket_gate_claim_reconciliation
        WHERE tenant_id=$1 AND work_id=$2 AND claim_id=$3 AND stage=$4 FOR UPDATE`,
      [actor.tenant_id, workId, gateClaim.claim_id, stage]);
      const material = { schema_version: "precommit_ticket_gate_claim_reconciliation_v1",
        tenant_id: actor.tenant_id, work_id: workId, claim_id: gateClaim.claim_id,
        gate_projection_digest: projectionDigest, stage, ticket_id: ticketId, error_code: errorCode,
        request_digest: requestDigest, continuation_ref: continuationRef, idempotency_key: idempotencyKey };
      const reconciliationDigest = objectDigest(material);
      if (existing.rows[0]) {
        if (existing.rows[0].reconciliation_digest !== reconciliationDigest) {
          fail("precommit_claim_reconciliation_replay_conflict");
        }
        return Object.freeze({ ...material, reconciliation_id: existing.rows[0].reconciliation_id,
          reconciliation_digest: reconciliationDigest, replay: true });
      }
      assertOperationalWorkMutation(work);
      const reconciliationId = crypto.randomUUID();
      await client.query(`INSERT INTO tenant_work_precommit_ticket_gate_claim_reconciliation
        (tenant_id,work_id,claim_id,reconciliation_id,gate_projection_digest,stage,ticket_id,
         error_code,request_digest,continuation_ref,idempotency_key,reconciliation_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [actor.tenant_id, workId,
        gateClaim.claim_id, reconciliationId, projectionDigest, stage, ticketId, errorCode,
        requestDigest, continuationRef, idempotencyKey, reconciliationDigest]);
      return Object.freeze({ ...material, reconciliation_id: reconciliationId,
        reconciliation_digest: reconciliationDigest, replay: false });
    });
  }
  async function abandonInactivePrecommitTicketGateClaim(identity, input = {}) {
    await initialize();
    if (input.server_owned !== true) fail("precommit_claim_abandonment_server_owned_required");
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id, "precommit_claim_abandonment_work_invalid");
    const gateClaim = input.gate_claim;
    const claimMaterial = gateClaim && { ...gateClaim };
    if (claimMaterial) delete claimMaterial.claim_digest;
    if (!gateClaim || gateClaim.schema_version !== "precommit_ticket_gate_claim_v1" ||
        objectDigest(claimMaterial) !== gateClaim.claim_digest || gateClaim.work_id !== workId) {
      fail("precommit_claim_abandonment_claim_invalid");
    }
    const readback = input.core_delegation_readback;
    const readbackMaterial = readback && { ...readback };
    if (readbackMaterial) delete readbackMaterial.readback_digest;
    const exactReadbackKeys = ["authority", "delegation_id", "effective_state", "expires_at",
      "provider_execution", "readback_digest", "revoked_at", "schema_version",
      "signature_digest", "state", "tenant_id", "work_id"];
    if (!plainRecord(readback) ||
        Object.keys(readback).sort().join("\0") !== exactReadbackKeys.sort().join("\0") ||
        readback.schema_version !== "core_precommit_claim_inactive_readback_v1" ||
        readback.authority !== "universal_core" || readback.provider_execution !== false ||
        readback.tenant_id !== actor.tenant_id || uuid(readback.work_id) !== workId ||
        readback.delegation_id !== gateClaim.delegation_id ||
        !["expired", "revoked"].includes(readback.effective_state) ||
        !HASH.test(String(readback.signature_digest || "")) ||
        objectDigest(readbackMaterial) !== readback.readback_digest) {
      fail("precommit_claim_abandonment_readback_invalid");
    }
    const expiresAt = new Date(readback.expires_at);
    const revokedAt = readback.revoked_at === null ? null : new Date(readback.revoked_at);
    if (!Number.isFinite(expiresAt.getTime()) ||
        (revokedAt && !Number.isFinite(revokedAt.getTime())) ||
        (readback.effective_state === "revoked" &&
          (readback.state !== "revoked" || !revokedAt))) {
      fail("precommit_claim_abandonment_readback_invalid");
    }
    return transaction(async (client) => {
      const coreWork = await client.query(`SELECT work_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
      if (!coreWork.rows[0]) fail("precommit_claim_abandonment_core_work_invalid");
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      const claim = (await client.query(`SELECT * FROM tenant_work_precommit_ticket_gate_claim
        WHERE tenant_id=$1 AND work_id=$2 AND claim_id=$3 FOR UPDATE`,
      [actor.tenant_id, workId, gateClaim.claim_id])).rows[0];
      if (!claim || claim.claim_digest !== precommitClaimProjection(claim, false).claim_digest ||
          claim.gate_projection_digest !== gateClaim.gate_projection_digest ||
          claim.delegation_id !== gateClaim.delegation_id ||
          claim.request_digest !== gateClaim.request_digest ||
          claim.action_digest !== gateClaim.action_digest ||
          claim.host_session_fingerprint !== gateClaim.host_session_fingerprint ||
          claim.idempotency_key !== gateClaim.idempotency_key) {
        fail("precommit_claim_abandonment_claim_invalid");
      }
      const fulfillment = await client.query(`SELECT ticket_id
        FROM tenant_work_precommit_ticket_gate_claim_fulfillment
        WHERE tenant_id=$1 AND work_id=$2 AND gate_projection_digest=$3 FOR UPDATE`,
      [actor.tenant_id, workId, claim.gate_projection_digest]);
      if (fulfillment.rows[0]) fail("precommit_claim_abandonment_ticket_live");
      const databaseNow = new Date((await client.query("SELECT now() AS database_now")).rows[0].database_now);
      if ((readback.effective_state === "expired" && expiresAt.getTime() > databaseNow.getTime()) ||
          (readback.effective_state === "revoked" && revokedAt.getTime() > databaseNow.getTime())) {
        fail("precommit_claim_abandonment_delegation_active");
      }
      const material = {
        schema_version: "precommit_ticket_gate_claim_abandonment_v1",
        tenant_id: actor.tenant_id,
        work_id: workId,
        gate_projection_digest: claim.gate_projection_digest,
        claim_id: claim.claim_id,
        delegation_id: claim.delegation_id,
        delegation_effective_state: readback.effective_state,
        delegation_expires_at: expiresAt.toISOString(),
        delegation_revoked_at: revokedAt?.toISOString() || null,
        core_readback_digest: readback.readback_digest,
      };
      const abandonmentDigest = objectDigest(material);
      const existing = await client.query(`SELECT *
        FROM tenant_work_precommit_ticket_gate_claim_abandonment
        WHERE tenant_id=$1 AND work_id=$2 AND gate_projection_digest=$3 FOR UPDATE`,
      [actor.tenant_id, workId, claim.gate_projection_digest]);
      if (existing.rows[0]) {
        if (existing.rows[0].abandonment_digest !== abandonmentDigest) {
          fail("precommit_claim_abandonment_replay_conflict");
        }
        return Object.freeze({ ...material, abandonment_digest: abandonmentDigest,
          idempotent_replay: true });
      }
      assertOperationalWorkMutation(work);
      await client.query(`INSERT INTO tenant_work_precommit_ticket_gate_claim_abandonment
        (tenant_id,work_id,gate_projection_digest,claim_id,delegation_id,
         delegation_effective_state,delegation_expires_at,delegation_revoked_at,
         core_readback_digest,abandonment_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [actor.tenant_id, workId,
        claim.gate_projection_digest, claim.claim_id, claim.delegation_id,
        readback.effective_state, expiresAt.toISOString(), revokedAt?.toISOString() || null,
        readback.readback_digest, abandonmentDigest]);
      await appendV2Event(client, actor, workId, "precommit_ticket_claim_abandoned", {
        claim_id: claim.claim_id,
        gate_projection_digest: claim.gate_projection_digest,
        delegation_id: claim.delegation_id,
        delegation_effective_state: readback.effective_state,
        core_readback_digest: readback.readback_digest,
        abandonment_digest: abandonmentDigest,
        execution_authorized: false,
      });
      return Object.freeze({ ...material, abandonment_digest: abandonmentDigest,
        idempotent_replay: false });
    });
  }
  function normalizeNativePrecommitScope(value) {
    if (!plainRecord(value) || value.schema_version !== "native_v2_precommit_scope_v1" ||
        typeof value.v2_task_governed !== "boolean" ||
        !Array.isArray(value.tasks) || value.tasks.length > 128) {
      fail("native_precommit_gate_v2_scope_invalid");
    }
    const scopeSnapshotDigest = digest(value.scope_snapshot_digest,
      "native_precommit_gate_v2_scope_invalid");
    const seen = new Set();
    const tasks = value.tasks.map((item) => {
      if (!plainRecord(item) ||
          Object.keys(item).sort().join("\0") !==
            ["revision", "task_id", "v2_task_digest"].sort().join("\0")) {
        fail("native_precommit_gate_v2_scope_invalid");
      }
      const taskId = uuid(item.task_id, "native_precommit_gate_v2_scope_invalid");
      const revision = Number(item.revision);
      if (!Number.isSafeInteger(revision) || revision < 1 || seen.has(taskId)) {
        fail("native_precommit_gate_v2_scope_invalid");
      }
      seen.add(taskId);
      return Object.freeze({
        task_id: taskId,
        v2_task_digest: digest(item.v2_task_digest,
          "native_precommit_gate_v2_scope_invalid"),
        revision,
      });
    }).sort((left, right) => left.task_id.localeCompare(right.task_id));
    if (value.v2_task_governed === true && tasks.length === 0) {
      fail("native_precommit_gate_v2_scope_invalid");
    }
    return Object.freeze({
      schema_version: "native_v2_precommit_scope_v1",
      scope_snapshot_digest: scopeSnapshotDigest,
      v2_task_governed: value.v2_task_governed,
      tasks: Object.freeze(tasks),
    });
  }
  async function lockAndValidateNativePrecommitScope(client, actor, workId, gate) {
    if (gate?.schema_version !== "precommit_ticket_gate_v2" ||
        gate.gate_source !== "native_closure_evaluation" ||
        !HASH.test(String(gate.v2_scope_snapshot_digest || "")) ||
        !Array.isArray(gate.v2_scope_tasks)) {
      fail("precommit_gate_claim_v2_scope_invalid");
    }
    const expectedTasks = gate.v2_scope_tasks;
    if (!expectedTasks.length) return Object.freeze([]);
    const current = await client.query(`SELECT task_id,title,weight,required,status,
        acceptance_verified,revision
      FROM tenant_work_task
      WHERE tenant_id=$1 AND work_id=$2 AND task_id=ANY($3::uuid[])
      ORDER BY task_id FOR UPDATE`,
    [actor.tenant_id, workId, expectedTasks.map((item) => item.task_id)]);
    if (current.rows.length !== expectedTasks.length) {
      fail("precommit_gate_claim_v2_scope_changed");
    }
    const currentById = new Map(current.rows.map((row) => [String(row.task_id), row]));
    for (const expected of expectedTasks) {
      const row = currentById.get(expected.task_id);
      const binding = row && buildNativeV2TaskBinding({
        tenant_id: actor.tenant_id,
        work_id: workId,
        task_id: row.task_id,
        title: row.title,
        weight: Number(row.weight),
        required: row.required,
      });
      if (!row || binding.v2_task_digest !== expected.v2_task_digest ||
          Number(row.revision) !== expected.revision || row.status !== "completed" ||
          row.acceptance_verified !== true) {
        fail("precommit_gate_claim_v2_scope_changed");
      }
    }
    const agents = await client.query(`SELECT v2_task_id,v2_task_digest
      FROM core_continuity_native_agents
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND v2_task_id IS NOT NULL
      ORDER BY task_id`, [actor.tenant_id, workId, gate.plan_id]);
    const agentTaskIds = [...new Set(agents.rows.map((row) =>
      String(row.v2_task_id).toLowerCase()))].sort();
    const expectedTaskIds = expectedTasks.map((item) => item.task_id).sort();
    if (objectDigest(agentTaskIds) !== objectDigest(expectedTaskIds) ||
        agents.rows.some((row) => {
          const expected = expectedTasks.find((item) =>
            item.task_id === String(row.v2_task_id).toLowerCase());
          return !expected || (row.v2_task_digest &&
            row.v2_task_digest !== expected.v2_task_digest);
        })) {
      fail("precommit_gate_claim_v2_scope_changed");
    }
    return Object.freeze(expectedTasks);
  }
  async function materializeNativePrecommitTicketGateWithClient(client, source = {}) {
    if (!client || typeof client.query !== "function") fail("native_precommit_gate_transaction_required");
    if (source.server_owned !== true) fail("native_precommit_gate_server_owned_required");
    const tenantId = text(source.tenant_id, "native_precommit_gate_tenant_invalid", 64);
    const workId = uuid(source.work_id, "native_precommit_gate_work_invalid");
    const planId = uuid(source.plan_id, "native_precommit_gate_plan_invalid");
    const evaluationId = uuid(source.evaluation_id, "native_precommit_gate_evaluation_invalid");
    const evaluationDigest = digest(source.evaluation_digest, "native_precommit_gate_evaluation_digest_invalid");
    const workspaceDigest = digest(source.workspace_digest, "native_precommit_gate_workspace_digest_invalid");
    const v2TaskScope = normalizeNativePrecommitScope(source.v2_task_scope);
    const actor = { tenant_id: tenantId, user_id: "core_native_precommit_gate", agent_id: "core_native_precommit_gate" };
    const coreWork = await client.query(`SELECT work_id FROM core_continuity_works
      WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [tenantId, workId]);
    if (!coreWork.rows[0]) fail("native_precommit_gate_work_invalid");
    const workResult = await client.query(`SELECT * FROM tenant_work
      WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [tenantId, workId]);
    const work = workResult.rows[0];
    if (!work) fail("native_precommit_gate_work_invalid");
    if (work.legacy_work_id !== workId) fail("native_precommit_gate_work_invalid");
    {
      const promotedEventResult = await client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,
          previous_event_hash,event_hash
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2 AND event_type='work_v2_created'
        ORDER BY sequence_number`, [tenantId, workId]);
      const promotedEvent = promotedEventResult.rows[0];
      const promotedMaterial = promotedEvent && {
        tenant_id: promotedEvent.tenant_id,
        work_id: promotedEvent.work_id,
        sequence_number: Number(promotedEvent.sequence_number),
        event_type: promotedEvent.event_type,
        payload: stable(promotedEvent.payload),
        previous_event_hash: promotedEvent.previous_event_hash || null,
      };
      const canonicalPromotedEnvelope = work.legacy_work_id === workId &&
        work.work_type === "software_git" && HASH.test(String(work.intent_digest || "")) &&
        promotedEventResult.rows.length === 1 && promotedEvent?.tenant_id === tenantId &&
        promotedEvent?.work_id === workId && promotedEvent?.event_type === "work_v2_created" &&
        promotedEvent.payload?.legacy_work_id === workId &&
        objectDigest(promotedMaterial) === promotedEvent.event_hash;
      const canonicalPromotedBridge = canonicalPromotedEnvelope &&
        await v2CreationIntentBindingValid(client, tenantId, work, promotedEvent);
      if (!canonicalPromotedBridge) fail("native_precommit_gate_work_invalid");
    }
    if (ARCHIVE_STATUSES.has(String(work.status || "").toUpperCase())) {
      const existing = await readPrecommitTicketGateWithClient(
        client,
        actor,
        workId,
        { lock: true },
      );
      if (existing?.schema_version === "precommit_ticket_gate_v2" &&
          existing.gate_source === "native_closure_evaluation" &&
          existing.plan_id === planId && existing.evaluation_id === evaluationId &&
          existing.evaluation_digest === evaluationDigest &&
          existing.workspace_digest === workspaceDigest &&
          existing.v2_scope_snapshot_digest === v2TaskScope.scope_snapshot_digest &&
          objectDigest(existing.v2_scope_tasks) === objectDigest(v2TaskScope.tasks)) {
        return Object.freeze({ ...existing, idempotent_replay: true });
      }
      fail("tenant_work_terminal");
    }
    assertOperationalWorkMutation(work);
    const planRowsResult = await client.query(`SELECT plan_id,plan,plan_digest,status,plan_version,supersedes_plan_id
      FROM core_continuity_native_plans WHERE tenant_id=$1 AND work_id=$2
      ORDER BY plan_version,plan_id FOR UPDATE`, [tenantId, workId]);
    const planRows = planRowsResult.rows;
    const plan = [...planRows].reverse().find((row) => row.status !== "superseded") || null;
    if (!plan || plan.plan_id !== planId || plan.status !== "planned" || objectDigest(plan.plan) !== plan.plan_digest) {
      fail("native_precommit_gate_plan_not_current");
    }
    const supersessionDigest = nativePlanSupersessionDigest(planRows);
    const evaluationResult = await client.query(`SELECT evaluation_id,evaluation,evaluation_digest
      FROM core_continuity_closure_evaluations
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
      ORDER BY created_at DESC,evaluation_id DESC LIMIT 1 FOR UPDATE`, [tenantId, workId, planId]);
    const evaluation = evaluationResult.rows[0];
    if (!evaluation || evaluation.evaluation_id !== evaluationId ||
        evaluation.evaluation_digest !== evaluationDigest || objectDigest(evaluation.evaluation) !== evaluationDigest ||
        evaluation.evaluation?.schema_version !== "native_closure_evaluation_v1" ||
        evaluation.evaluation?.closed !== false || evaluation.evaluation?.commit_ticket_ready !== true ||
        evaluation.evaluation?.precommit_verification?.ready !== true ||
        evaluation.evaluation?.precommit_verification?.workspace_digest !== workspaceDigest ||
        objectDigest(evaluation.evaluation?.native_v2_precommit_scope) !==
          objectDigest(v2TaskScope)) {
      fail("native_precommit_gate_evaluation_not_current");
    }
    const existing = await readPrecommitTicketGateWithClient(client, actor, workId, { lock: true });
    if (existing) {
      if (existing.schema_version === "precommit_ticket_gate_v2" && existing.gate_source === "native_closure_evaluation" &&
          existing.plan_id === planId && existing.evaluation_id === evaluationId &&
          existing.evaluation_digest === evaluationDigest && existing.workspace_digest === workspaceDigest &&
          existing.v2_scope_snapshot_digest === v2TaskScope.scope_snapshot_digest &&
          objectDigest(existing.v2_scope_tasks) === objectDigest(v2TaskScope.tasks) &&
          existing.supersession_digest === supersessionDigest) {
        return Object.freeze({ ...existing, idempotent_replay: true });
      }
      if (existing.schema_version !== "precommit_ticket_gate_v2" ||
          existing.gate_source !== "native_closure_evaluation" || existing.fulfilled === true ||
          existing.fresh === true) fail("native_precommit_gate_conflict");
      const activeClaim = await client.query(`SELECT c.claim_id
        FROM tenant_work_precommit_ticket_gate_claim c
        LEFT JOIN tenant_work_precommit_ticket_gate_claim_fulfillment f
          ON f.tenant_id=c.tenant_id AND f.work_id=c.work_id
            AND f.gate_projection_digest=c.gate_projection_digest AND f.claim_id=c.claim_id
        LEFT JOIN tenant_work_precommit_ticket_gate_claim_abandonment a
          ON a.tenant_id=c.tenant_id AND a.work_id=c.work_id
            AND a.gate_projection_digest=c.gate_projection_digest AND a.claim_id=c.claim_id
        WHERE c.tenant_id=$1 AND c.work_id=$2 AND f.claim_id IS NULL AND a.claim_id IS NULL
        LIMIT 1 FOR UPDATE OF c`, [tenantId, workId]);
      if (activeClaim.rows[0]) fail("native_precommit_gate_claim_active");
      const latest = await client.query(`SELECT * FROM tenant_work_precommit_ticket_gate_supersession
        WHERE tenant_id=$1 AND work_id=$2 AND action_kind='git.commit'
          AND gate_kind='ticket_acquisition' ORDER BY gate_version DESC LIMIT 1 FOR UPDATE`,
      [tenantId, workId]);
      const nextVersion = Number(latest.rows[0]?.gate_version || 1) + 1;
      const material = { schema_version: "native_precommit_gate_material_v1", tenant_id: tenantId,
        work_id: workId, task_id: existing.task_id, plan_id: planId, evaluation_id: evaluationId,
        evaluation_digest: evaluationDigest, workspace_digest: workspaceDigest,
        v2_scope_snapshot_digest: v2TaskScope.scope_snapshot_digest,
        v2_scope_tasks: v2TaskScope.tasks,
        supersession_digest: supersessionDigest, gate_source: "native_closure_evaluation", mappings: [],
        gate_version: nextVersion, supersedes_reconciliation_digest: existing.reconciliation_digest };
      const reconciliationDigest = objectDigest(material);
      await client.query(`INSERT INTO tenant_work_precommit_ticket_gate_supersession
        (tenant_id,work_id,gate_version,task_id,plan_id,evaluation_id,evaluation_digest,
         workspace_digest,v2_scope_snapshot_digest,v2_scope_tasks,supersession_digest,
         reconciliation_digest,supersedes_reconciliation_digest,
         gate_source,action_kind,gate_kind,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,
          'native_closure_evaluation','git.commit','ticket_acquisition',$14)`,
      [tenantId, workId, nextVersion, existing.task_id, planId, evaluationId,
        evaluationDigest, workspaceDigest, v2TaskScope.scope_snapshot_digest,
        JSON.stringify(v2TaskScope.tasks), supersessionDigest, reconciliationDigest,
        existing.reconciliation_digest, actor.user_id]);
      const projection = await readPrecommitTicketGateWithClient(client, actor, workId, { lock: true });
      if (projection?.fresh !== true || projection.schema_version !== "precommit_ticket_gate_v2") {
        fail("native_precommit_gate_projection_invalid");
      }
      return Object.freeze({ ...projection, idempotent_replay: false });
    }
    const taskId = crypto.randomUUID();
    await client.query(`INSERT INTO tenant_work_task
      (tenant_id,task_id,work_id,title,weight,status,required,acceptance_verified)
      VALUES ($1,$2,$3,$4,1,'planned',true,false)`,
    [tenantId, taskId, workId, "Acquire exact Core git.commit ticket"]);
    const material = { schema_version: "native_precommit_gate_material_v1", tenant_id: tenantId,
      work_id: workId, task_id: taskId, plan_id: planId, evaluation_id: evaluationId,
      evaluation_digest: evaluationDigest, workspace_digest: workspaceDigest,
      v2_scope_snapshot_digest: v2TaskScope.scope_snapshot_digest,
      v2_scope_tasks: v2TaskScope.tasks,
      supersession_digest: supersessionDigest, gate_source: "native_closure_evaluation", mappings: [] };
    const reconciliationDigest = objectDigest(material);
    await client.query(`INSERT INTO tenant_work_precommit_ticket_gate
      (tenant_id,work_id,task_id,plan_id,evaluation_id,evaluation_digest,workspace_digest,
       v2_scope_snapshot_digest,v2_scope_tasks,supersession_digest,reconciliation_digest,
       gate_source,action_kind,gate_kind,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,
        'native_closure_evaluation','git.commit','ticket_acquisition',$12)`,
    [tenantId, workId, taskId, planId, evaluationId, evaluationDigest, workspaceDigest,
      v2TaskScope.scope_snapshot_digest, JSON.stringify(v2TaskScope.tasks),
      supersessionDigest, reconciliationDigest, actor.user_id]);
    await appendV2Event(client, actor, workId, "native_precommit_ticket_gate_materialized", {
      task_id: taskId, plan_id: planId, evaluation_id: evaluationId, evaluation_digest: evaluationDigest,
      workspace_digest: workspaceDigest, supersession_digest: supersessionDigest,
      v2_scope_snapshot_digest: v2TaskScope.scope_snapshot_digest,
      v2_scope_tasks: v2TaskScope.tasks,
      reconciliation_digest: reconciliationDigest, gate_source: "native_closure_evaluation",
      action_kind: "git.commit", gate_kind: "ticket_acquisition", execution_authorized: false,
    });
    const projection = await readPrecommitTicketGateWithClient(client, actor, workId, { lock: true });
    if (projection?.fresh !== true || projection.schema_version !== "precommit_ticket_gate_v2") {
      fail("native_precommit_gate_projection_invalid");
    }
    return Object.freeze({ ...projection, idempotent_replay: false });
  }
  async function reconcilePersistedPrecommitTicketGate(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    // The public front door intentionally accepts no plan, evaluation, task,
    // scope or evidence identifiers.  They are selected and locked here from
    // the authoritative ledgers, then revalidated by the existing native gate
    // materializer in the same PostgreSQL transaction.
    return transaction(async (client) => {
      // Preserve the repository-wide cross-fabric lock order: Core first,
      // then its linked V2 projection.  The materializer repeats these reads
      // only as invariant checks while the same transaction retains both
      // locks.
      const coreWork = await client.query(`SELECT work_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
      if (!coreWork.rows[0]) fail("persisted_precommit_reconciliation_work_missing");
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      if (work.legacy_work_id !== workId) {
        fail("persisted_precommit_reconciliation_bridge_required");
      }
      const plans = await client.query(`SELECT plan_id,plan,plan_digest,status,plan_version,supersedes_plan_id
        FROM core_continuity_native_plans
        WHERE tenant_id=$1 AND work_id=$2
        ORDER BY plan_version,plan_id FOR UPDATE`, [actor.tenant_id, workId]);
      const currentPlans = plans.rows.filter((row) => row.status !== "superseded");
      const plan = currentPlans.length === 1 ? currentPlans[0] : null;
      if (!plan || plan.status !== "planned" || objectDigest(plan.plan) !== plan.plan_digest) {
        return Object.freeze({
          schema_version: "persisted_precommit_reconciliation_v1",
          work_id: workId,
          outcome: "BLOCKED",
          reason_codes: Object.freeze([currentPlans.length > 1
            ? "current_native_plan_ambiguous"
            : "current_native_plan_missing"]),
          execution_authorized: false,
          provider_execution: false,
        });
      }
      const evaluations = await client.query(`SELECT evaluation_id,evaluation,evaluation_digest
        FROM core_continuity_closure_evaluations
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
        ORDER BY created_at DESC,evaluation_id DESC LIMIT 1 FOR UPDATE`,
      [actor.tenant_id, workId, plan.plan_id]);
      const evaluation = evaluations.rows[0] || null;
      const scope = evaluation?.evaluation?.native_v2_precommit_scope;
      if (!evaluation || objectDigest(evaluation.evaluation) !== evaluation.evaluation_digest ||
          evaluation.evaluation?.schema_version !== "native_closure_evaluation_v1" ||
          evaluation.evaluation?.closed !== false ||
          evaluation.evaluation?.commit_ticket_ready !== true ||
          evaluation.evaluation?.precommit_verification?.ready !== true ||
          !HASH.test(String(evaluation.evaluation?.precommit_verification?.workspace_digest || "")) ||
          !plainRecord(scope) || scope.schema_version !== "native_v2_precommit_scope_v1") {
        return Object.freeze({
          schema_version: "persisted_precommit_reconciliation_v1",
          work_id: workId,
          outcome: "BLOCKED",
          reason_codes: Object.freeze(["current_native_closure_evaluation_not_ready"]),
          execution_authorized: false,
          provider_execution: false,
        });
      }
      const projection = await materializeNativePrecommitTicketGateWithClient(client, {
        server_owned: true,
        tenant_id: actor.tenant_id,
        work_id: workId,
        plan_id: plan.plan_id,
        evaluation_id: evaluation.evaluation_id,
        evaluation_digest: evaluation.evaluation_digest,
        workspace_digest: evaluation.evaluation.precommit_verification.workspace_digest,
        v2_task_scope: scope,
      });
      return Object.freeze({
        schema_version: "persisted_precommit_reconciliation_v1",
        work_id: workId,
        outcome: "RECONCILED",
        gate_schema_version: projection.schema_version,
        gate_source: projection.gate_source,
        gate_projection_digest: projection.projection_digest,
        fresh: projection.fresh === true,
        fulfilled: projection.fulfilled === true,
        scoped_task_count: Array.isArray(projection.v2_scope_tasks)
          ? projection.v2_scope_tasks.length
          : 0,
        idempotent_replay: projection.idempotent_replay === true,
        execution_authorized: false,
        provider_execution: false,
      });
    });
  }
  async function reconcilePrecommitTicketGate(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const taskId = uuid(input.task_id, "precommit_reconcile_task_invalid");
    const planId = uuid(input.plan_id, "precommit_reconcile_plan_invalid");
    const evaluationId = uuid(input.evaluation_id, "precommit_reconcile_evaluation_invalid");
    const evaluationDigest = digest(input.evaluation_digest, "precommit_reconcile_evaluation_digest_invalid");
    const workspaceDigest = digest(input.workspace_digest, "precommit_reconcile_workspace_digest_invalid");
    if (!Array.isArray(input.mappings) || !input.mappings.length || input.mappings.length > 128) {
      fail("precommit_reconcile_mappings_invalid");
    }
    const mappings = input.mappings.map((item) => ({
      legacy_evidence_id: uuid(item?.legacy_evidence_id, "precommit_reconcile_legacy_evidence_invalid"),
      replacement_evidence_id: uuid(item?.replacement_evidence_id, "precommit_reconcile_replacement_evidence_invalid"),
      native_receipt_id: uuid(item?.native_receipt_id, "precommit_reconcile_receipt_invalid"),
      native_receipt_digest: digest(item?.native_receipt_digest, "precommit_reconcile_receipt_digest_invalid"),
    })).sort((left, right) => left.legacy_evidence_id.localeCompare(right.legacy_evidence_id));
    if (new Set(mappings.map((item) => item.legacy_evidence_id)).size !== mappings.length ||
        new Set(mappings.map((item) => item.replacement_evidence_id)).size !== mappings.length ||
        new Set(mappings.map((item) => item.native_receipt_id)).size !== mappings.length ||
        mappings.some((item) => item.legacy_evidence_id === item.replacement_evidence_id)) {
      fail("precommit_reconcile_mappings_invalid");
    }
    return transaction(async (client) => {
      const coreWork = await client.query(`SELECT work_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
      if (!coreWork.rows[0]) fail("tenant_work_not_found");
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      if (work.legacy_work_id !== workId) fail("precommit_reconcile_native_work_binding_missing");
      const latestSuperseding = await client.query(`SELECT *
        FROM tenant_work_precommit_ticket_gate_supersession
        WHERE tenant_id=$1 AND work_id=$2 AND action_kind='git.commit'
          AND gate_kind='ticket_acquisition'
        ORDER BY gate_version DESC LIMIT 1 FOR UPDATE`, [actor.tenant_id, workId]);
      const legacyGate = latestSuperseding.rows[0] ? { rows: [] } : await client.query(
        `SELECT * FROM tenant_work_precommit_ticket_gate
          WHERE tenant_id=$1 AND work_id=$2 AND action_kind='git.commit'
            AND gate_kind='ticket_acquisition' FOR UPDATE`,
        [actor.tenant_id, workId],
      );
      const currentGate = latestSuperseding.rows[0] || legacyGate.rows[0] || null;
      const currentGateVersion = latestSuperseding.rows[0]
        ? Number(latestSuperseding.rows[0].gate_version)
        : currentGate ? 1 : 0;
      let nextGateVersion = 1;
      let supersedesReconciliationDigest = null;
      if (currentGate) {
        const superseding = currentGateVersion > 1;
        const existingMappings = await client.query(`SELECT legacy_evidence_id,replacement_evidence_id,
            native_receipt_id,native_receipt_digest FROM ${superseding
            ? "tenant_work_precommit_evidence_reconciliation_supersession"
            : "tenant_work_precommit_evidence_reconciliation"}
          WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3${
            superseding ? " AND gate_version=$4" : ""}
          ORDER BY legacy_evidence_id FOR UPDATE`, superseding
          ? [actor.tenant_id, workId, currentGate.task_id, currentGateVersion]
          : [actor.tenant_id, workId, currentGate.task_id]);
        const exact = currentGate.task_id === taskId && currentGate.plan_id === planId &&
          currentGate.evaluation_id === evaluationId &&
          currentGate.evaluation_digest === evaluationDigest &&
          currentGate.workspace_digest === workspaceDigest &&
          objectDigest(existingMappings.rows.map((row) => ({
            legacy_evidence_id: row.legacy_evidence_id,
            replacement_evidence_id: row.replacement_evidence_id,
            native_receipt_id: row.native_receipt_id,
            native_receipt_digest: row.native_receipt_digest,
          }))) === objectDigest(mappings);
        if (exact) {
          const projection = await readPrecommitTicketGateWithClient(
            client, actor, workId, { lock: true },
          );
          return Object.freeze({ ...projection, idempotent_replay: true });
        }
        assertOperationalWorkMutation(work);
        const currentProjection = await readPrecommitTicketGateWithClient(
          client, actor, workId, { lock: true },
        );
        const supersedingDrift = currentProjection?.drift_codes?.some((code) => [
          "precommit_gate_plan_drift",
          "precommit_gate_evaluation_drift",
          "precommit_gate_supersession_drift",
        ].includes(code));
        const legacyEvidenceDigest = objectDigest(existingMappings.rows
          .map((row) => row.legacy_evidence_id).sort());
        const requestedLegacyEvidenceDigest = objectDigest(mappings
          .map((row) => row.legacy_evidence_id).sort());
        if (!currentProjection || currentProjection.fulfilled === true ||
            currentProjection.fresh === true || !supersedingDrift ||
            currentGate.task_id !== taskId ||
            legacyEvidenceDigest !== requestedLegacyEvidenceDigest) {
          fail("precommit_reconcile_replay_conflict");
        }
        nextGateVersion = currentGateVersion + 1;
        supersedesReconciliationDigest = currentGate.reconciliation_digest;
      }
      assertOperationalWorkMutation(work);
      const taskResult = await client.query(`SELECT task_id,status,required,acceptance_verified
        FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3 FOR UPDATE`,
      [actor.tenant_id, workId, taskId]);
      const task = taskResult.rows[0];
      if (!task || task.required !== true || task.status !== "planned" || task.acceptance_verified === true) {
        fail("precommit_reconcile_ticket_task_invalid");
      }
      const planRowsResult = await client.query(`SELECT plan_id,plan,plan_digest,status,plan_version,supersedes_plan_id
        FROM core_continuity_native_plans WHERE tenant_id=$1 AND work_id=$2
        ORDER BY plan_version,plan_id FOR UPDATE`, [actor.tenant_id, workId]);
      const planRows = planRowsResult.rows;
      const latestPlan = [...planRows].reverse().find((row) => row.status !== "superseded") || null;
      if (!latestPlan || latestPlan.plan_id !== planId || latestPlan.status !== "planned" ||
          objectDigest(latestPlan.plan) !== latestPlan.plan_digest) {
        fail("precommit_reconcile_plan_not_current");
      }
      const supersessionDigest = nativePlanSupersessionDigest(planRows);
      const latestEvaluation = await client.query(`SELECT evaluation_id,evaluation,evaluation_digest
        FROM core_continuity_closure_evaluations
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
        ORDER BY created_at DESC,evaluation_id DESC LIMIT 1 FOR UPDATE`,
      [actor.tenant_id, workId, planId]);
      const evaluation = latestEvaluation.rows[0];
      if (!evaluation || evaluation.evaluation_id !== evaluationId ||
          evaluation.evaluation_digest !== evaluationDigest ||
          objectDigest(evaluation.evaluation) !== evaluationDigest ||
          evaluation.evaluation?.schema_version !== "native_closure_evaluation_v1" ||
          evaluation.evaluation?.closed !== false ||
          evaluation.evaluation?.commit_ticket_ready !== true ||
          evaluation.evaluation?.precommit_verification?.ready !== true ||
          evaluation.evaluation?.precommit_verification?.workspace_digest !== workspaceDigest) {
        fail("precommit_reconcile_evaluation_not_current");
      }
      const legacyResult = await client.query(`SELECT evidence_id,required,independently_verified
        FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2
          AND evidence_id = ANY($3::uuid[]) FOR UPDATE`,
      [actor.tenant_id, workId, mappings.map((item) => item.legacy_evidence_id)]);
      if (legacyResult.rows.length !== mappings.length || legacyResult.rows.some((row) =>
        row.required !== true || row.independently_verified === true)) {
        fail("precommit_reconcile_legacy_evidence_invalid");
      }
      const replacementRows = [];
      for (const mapping of mappings) {
        const replacement = await client.query(`SELECT e.evidence_id,e.kind,e.digest,e.required,
            e.independently_verified,n.plan_id,n.native_receipt_id,n.native_receipt_digest,
            n.evidence_digest,n.task_id AS native_task_id,
            n.verifier_agent_id AS native_verifier_agent_id,
            n.verifier_session_fingerprint AS native_verifier_session_fingerprint,
            n.report_digest AS native_report_digest,
            r.receipt_type,r.agent_id AS receipt_agent_id,r.payload,r.payload_digest
          FROM tenant_work_evidence e
          JOIN tenant_work_native_verifier_evidence n
            ON n.tenant_id=e.tenant_id AND n.work_id=e.work_id AND n.evidence_id=e.evidence_id
          JOIN core_continuity_native_receipts r
            ON r.tenant_id=n.tenant_id AND r.work_id=$2 AND r.plan_id=n.plan_id
              AND r.receipt_id=n.native_receipt_id
          WHERE e.tenant_id=$1 AND e.work_id=$2 AND e.evidence_id=$3 FOR UPDATE`,
        [actor.tenant_id, workId, mapping.replacement_evidence_id]);
        const row = replacement.rows[0];
        if (!row || row.kind !== "native_verifier_terminal_report" || row.required !== true ||
            row.independently_verified !== true || row.plan_id !== planId ||
            row.native_receipt_id !== mapping.native_receipt_id ||
            row.native_receipt_digest !== mapping.native_receipt_digest ||
            row.evidence_digest !== row.digest || row.receipt_type !== "agent_reported" ||
            row.payload_digest !== mapping.native_receipt_digest ||
            objectDigest(row.payload) !== row.payload_digest ||
            row.receipt_agent_id !== row.native_verifier_agent_id ||
            row.payload?.schema_version !== "native_agent_receipt_v1" ||
            row.payload?.receipt_id !== mapping.native_receipt_id ||
            row.payload?.work_id !== workId || row.payload?.plan_id !== planId ||
            row.payload?.receipt_type !== "agent_reported" ||
            row.payload?.agent_id !== row.native_verifier_agent_id ||
            row.payload?.task_id !== row.native_task_id || row.payload?.task_kind !== "verifier" ||
            row.payload?.status !== "completed" ||
            row.payload?.report_digest !== row.native_report_digest ||
            row.payload?.native_session_fingerprint !== row.native_verifier_session_fingerprint ||
            row.payload?.host_native !== true || row.payload?.provider_execution !== false ||
            row.payload?.host_permission_override !== false ||
            row.payload?.host_policy_override !== false ||
            row.payload?.host_policy_must_allow !== true) {
          fail("precommit_reconcile_replacement_evidence_invalid");
        }
        replacementRows.push({ ...mapping, replacement_evidence_digest: row.digest });
      }
      const reconciliationMaterial = {
        schema_version: "precommit_evidence_reconciliation_v1",
        tenant_id: actor.tenant_id,
        work_id: workId,
        task_id: taskId,
        action_kind: "git.commit",
        gate_kind: "ticket_acquisition",
        plan_id: planId,
        evaluation_id: evaluationId,
        evaluation_digest: evaluationDigest,
        workspace_digest: workspaceDigest,
        supersession_digest: supersessionDigest,
        mappings: replacementRows,
        ...(nextGateVersion > 1 ? {
          gate_version: nextGateVersion,
          supersedes_reconciliation_digest: supersedesReconciliationDigest,
        } : {}),
      };
      const reconciliationDigest = objectDigest(reconciliationMaterial);
      if (nextGateVersion === 1) {
        await client.query(`INSERT INTO tenant_work_precommit_ticket_gate
          (tenant_id,work_id,task_id,plan_id,evaluation_id,evaluation_digest,workspace_digest,
           supersession_digest,reconciliation_digest,action_kind,gate_kind,created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'git.commit','ticket_acquisition',$10)`,
        [actor.tenant_id, workId, taskId, planId, evaluationId, evaluationDigest, workspaceDigest,
          supersessionDigest, reconciliationDigest, actor.user_id]);
      } else {
        await client.query(`INSERT INTO tenant_work_precommit_ticket_gate_supersession
          (tenant_id,work_id,gate_version,task_id,plan_id,evaluation_id,evaluation_digest,
           workspace_digest,supersession_digest,reconciliation_digest,
           supersedes_reconciliation_digest,action_kind,gate_kind,created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'git.commit','ticket_acquisition',$12)`,
        [actor.tenant_id, workId, nextGateVersion, taskId, planId, evaluationId,
          evaluationDigest, workspaceDigest, supersessionDigest, reconciliationDigest,
          supersedesReconciliationDigest, actor.user_id]);
      }
      for (const mapping of replacementRows) {
        if (nextGateVersion === 1) {
          await client.query(`INSERT INTO tenant_work_precommit_evidence_reconciliation
            (tenant_id,work_id,legacy_evidence_id,replacement_evidence_id,task_id,plan_id,evaluation_id,
             native_receipt_id,native_receipt_digest,replacement_evidence_digest,evaluation_digest,
             workspace_digest,supersession_digest,reconciliation_digest,created_by_user_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [actor.tenant_id, workId, mapping.legacy_evidence_id, mapping.replacement_evidence_id,
            taskId, planId, evaluationId, mapping.native_receipt_id, mapping.native_receipt_digest,
            mapping.replacement_evidence_digest, evaluationDigest, workspaceDigest,
            supersessionDigest, reconciliationDigest, actor.user_id]);
        } else {
          await client.query(`INSERT INTO tenant_work_precommit_evidence_reconciliation_supersession
            (tenant_id,work_id,gate_version,legacy_evidence_id,replacement_evidence_id,task_id,
             plan_id,evaluation_id,native_receipt_id,native_receipt_digest,
             replacement_evidence_digest,evaluation_digest,workspace_digest,supersession_digest,
             reconciliation_digest,created_by_user_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [actor.tenant_id, workId, nextGateVersion, mapping.legacy_evidence_id,
            mapping.replacement_evidence_id, taskId, planId, evaluationId,
            mapping.native_receipt_id, mapping.native_receipt_digest,
            mapping.replacement_evidence_digest, evaluationDigest, workspaceDigest,
            supersessionDigest, reconciliationDigest, actor.user_id]);
        }
      }
      await appendV2Event(client, actor, workId, "precommit_ticket_gate_reconciled", {
        task_id: taskId, plan_id: planId, evaluation_id: evaluationId,
        evaluation_digest: evaluationDigest, workspace_digest: workspaceDigest,
        supersession_digest: supersessionDigest, reconciliation_digest: reconciliationDigest,
        legacy_evidence_ids: mappings.map((item) => item.legacy_evidence_id),
        replacement_evidence_ids: mappings.map((item) => item.replacement_evidence_id),
        action_kind: "git.commit", gate_kind: "ticket_acquisition",
        gate_version: nextGateVersion,
        supersedes_reconciliation_digest: supersedesReconciliationDigest,
        execution_authorized: false,
      });
      const projection = await readPrecommitTicketGateWithClient(client, actor, workId, { lock: true });
      if (projection?.fresh !== true) fail("precommit_reconcile_projection_invalid");
      return Object.freeze({ ...projection, idempotent_replay: false });
    });
  }
  async function fulfillPrecommitTicketTask(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const gateProjectionDigest = digest(input.gate_projection_digest,
      "precommit_ticket_fulfillment_gate_digest_invalid");
    const actionTicket = input.action_ticket;
    const gateClaim = input.gate_claim;
    const ticket = actionTicket?.ticket;
    if (!actionTicket || actionTicket.state !== "issued" || actionTicket.uses !== 0 ||
        ticket?.schema_version !== "host_native_action_ticket_v1" ||
        ticket.tenant_id !== actor.tenant_id || ticket.work_id !== workId ||
        ticket.action?.kind !== "git.commit" || ticket.evidence_digest !== gateProjectionDigest ||
        !/^hnt_[A-Za-z0-9_-]{8,}$/.test(String(ticket.ticket_id || "")) ||
        !/^hnt_[A-Za-z0-9_-]{64}$/.test(String(ticket.signature || "")) ||
        ticket.max_uses !== 1 || ticket.provider_execution !== false ||
        ticket.host_policy_override !== false || ticket.host_policy_must_allow !== true) {
      fail("precommit_ticket_fulfillment_readback_invalid");
    }
    return transaction(async (client) => {
      const coreWork = await client.query(`SELECT work_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
      if (!coreWork.rows[0]) fail("tenant_work_not_found");
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canAdminister, work, actor);
      const gate = await readPrecommitTicketGateWithClient(client, actor, workId, { lock: true });
      const nativeGate = gate?.schema_version === "precommit_ticket_gate_v2";
      let claim = null;
      if (nativeGate) {
        const claimFields = ["schema_version", "claim_id", "work_id", "continuation_ref",
          "request_digest", "delegation_id", "action_digest", "gate_projection_digest",
          "host_session_fingerprint", "idempotency_key", "replay", "claim_digest"];
        const claimMaterial = gateClaim && { ...gateClaim };
        if (claimMaterial) delete claimMaterial.claim_digest;
        if (!gateClaim || Object.keys(gateClaim).sort().join("\0") !== claimFields.sort().join("\0") ||
            gateClaim.schema_version !== "precommit_ticket_gate_claim_v1" ||
            !UUID.test(String(gateClaim.claim_id || "")) || !HASH.test(String(gateClaim.claim_digest || "")) ||
            objectDigest(claimMaterial) !== gateClaim.claim_digest || typeof gateClaim.replay !== "boolean" ||
            gateClaim.work_id !== workId || gateClaim.gate_projection_digest !== gateProjectionDigest) {
          fail("precommit_ticket_fulfillment_claim_invalid");
        }
        const claimResult = await client.query(`SELECT c.*,f.ticket_id AS fulfilled_ticket_id,
            a.abandonment_digest
          FROM tenant_work_precommit_ticket_gate_claim c
          LEFT JOIN tenant_work_precommit_ticket_gate_claim_fulfillment f
            ON f.tenant_id=c.tenant_id AND f.work_id=c.work_id
              AND f.gate_projection_digest=c.gate_projection_digest
          LEFT JOIN tenant_work_precommit_ticket_gate_claim_abandonment a
            ON a.tenant_id=c.tenant_id AND a.work_id=c.work_id
              AND a.gate_projection_digest=c.gate_projection_digest AND a.claim_id=c.claim_id
          WHERE c.tenant_id=$1 AND c.work_id=$2 AND c.gate_projection_digest=$3 FOR UPDATE OF c`,
        [actor.tenant_id, workId, gateProjectionDigest]);
        claim = claimResult.rows[0];
        if (claim?.abandonment_digest) fail("precommit_ticket_fulfillment_claim_abandoned");
        const immutableClaimDigest = claim && precommitClaimProjection(claim, false).claim_digest;
        if (!claim || claim.claim_id !== gateClaim.claim_id || claim.work_id !== gateClaim.work_id ||
            claim.claim_digest !== immutableClaimDigest ||
            claim.gate_projection_digest !== gateClaim.gate_projection_digest ||
            claim.continuation_ref !== gateClaim.continuation_ref ||
            claim.request_digest !== gateClaim.request_digest || claim.delegation_id !== gateClaim.delegation_id ||
            claim.action_digest !== gateClaim.action_digest ||
            claim.host_session_fingerprint !== gateClaim.host_session_fingerprint ||
            claim.idempotency_key !== gateClaim.idempotency_key ||
            ticket.delegation_id !== claim.delegation_id || objectDigest(ticket.action) !== claim.action_digest ||
            ticket.host_session_fingerprint !== claim.host_session_fingerprint) {
          fail("precommit_ticket_fulfillment_claim_invalid");
        }
      } else if (gateClaim !== undefined && gateClaim !== null) {
        fail("precommit_ticket_fulfillment_claim_unexpected");
      }
      const latestSuperseding = await client.query(`SELECT gate_version,reconciliation_digest
        FROM tenant_work_precommit_ticket_gate_supersession
        WHERE tenant_id=$1 AND work_id=$2 AND action_kind='git.commit'
          AND gate_kind='ticket_acquisition'
        ORDER BY gate_version DESC LIMIT 1 FOR UPDATE`, [actor.tenant_id, workId]);
      const superseding = Boolean(latestSuperseding.rows[0]) &&
        latestSuperseding.rows[0].reconciliation_digest === gate?.reconciliation_digest;
      const gateVersion = superseding ? Number(latestSuperseding.rows[0].gate_version) : 1;
      const fulfillmentTable = superseding
        ? "tenant_work_precommit_ticket_fulfillment_supersession"
        : "tenant_work_precommit_ticket_fulfillment";
      if (!gate || gate.fresh !== true || gate.fulfilled === true ||
          gate.projection_digest !== gateProjectionDigest) {
        const existing = await client.query(`SELECT ticket_id,ticket_digest,gate_projection_digest,
            fulfillment_digest FROM ${fulfillmentTable}
          WHERE tenant_id=$1 AND work_id=$2${superseding ? " AND gate_version=$3" : ""}`,
        superseding ? [actor.tenant_id, workId, gateVersion] : [actor.tenant_id, workId]);
        if (!existing.rows[0]) fail("precommit_ticket_fulfillment_gate_drift");
        const ticketDigest = objectDigest(ticket);
        if (existing.rows[0].ticket_id !== ticket.ticket_id ||
            existing.rows[0].ticket_digest !== ticketDigest ||
            existing.rows[0].gate_projection_digest !== gateProjectionDigest) {
          fail("precommit_ticket_fulfillment_replay_conflict");
        }
        return Object.freeze({ schema_version: "precommit_ticket_fulfillment_v1",
          work_id: workId, task_id: gate?.task_id || null, ticket_id: ticket.ticket_id,
          fulfillment_digest: existing.rows[0].fulfillment_digest, idempotent_replay: true });
      }
      assertOperationalWorkMutation(work);
      if (nativeGate) await lockAndValidateNativePrecommitScope(client, actor, workId, gate);
      const ticketDigest = objectDigest(ticket);
      const material = { schema_version: "precommit_ticket_fulfillment_v1",
        tenant_id: actor.tenant_id, work_id: workId, task_id: gate.task_id,
        ticket_id: ticket.ticket_id, ticket_digest: ticketDigest,
        gate_projection_digest: gateProjectionDigest };
      const fulfillmentDigest = objectDigest(material);
      if (superseding) {
        await client.query(`INSERT INTO tenant_work_precommit_ticket_fulfillment_supersession
          (tenant_id,work_id,gate_version,task_id,ticket_id,ticket_digest,
           gate_projection_digest,fulfillment_digest)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [actor.tenant_id, workId, gateVersion,
          gate.task_id, ticket.ticket_id, ticketDigest, gateProjectionDigest, fulfillmentDigest]);
      } else {
        await client.query(`INSERT INTO tenant_work_precommit_ticket_fulfillment
          (tenant_id,work_id,task_id,ticket_id,ticket_digest,gate_projection_digest,fulfillment_digest)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actor.tenant_id, workId, gate.task_id,
          ticket.ticket_id, ticketDigest, gateProjectionDigest, fulfillmentDigest]);
      }
      if (nativeGate) {
        await client.query(`INSERT INTO tenant_work_precommit_ticket_gate_claim_fulfillment
          (tenant_id,work_id,gate_projection_digest,claim_id,claim_digest,ticket_id)
          VALUES ($1,$2,$3,$4,$5,$6)`, [actor.tenant_id, workId, gateProjectionDigest,
          claim.claim_id, gateClaim.claim_digest, ticket.ticket_id]);
      }
      const completed = await client.query(`UPDATE tenant_work_task SET status='completed',
          acceptance_verified=true,completed_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3 AND required=true
          AND status='planned' AND acceptance_verified=false RETURNING task_id`,
      [actor.tenant_id, workId, gate.task_id]);
      if (!completed.rows[0]) fail("precommit_ticket_fulfillment_task_conflict");
      await appendV2Event(client, actor, workId, "precommit_ticket_task_fulfilled", {
        task_id: gate.task_id, ticket_id: ticket.ticket_id, ticket_digest: ticketDigest,
        gate_projection_digest: gateProjectionDigest, fulfillment_digest: fulfillmentDigest,
        authority: "universal_core_ticket_readback",
      });
      return Object.freeze({ ...material, fulfillment_digest: fulfillmentDigest,
        idempotent_replay: false });
    });
  }
  async function persistCoreJoin(identity, { work_id, core_join_digest, core_join_context }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (actor.core_join_trusted !== true) fail("core_join_trust_required");
    if (!resolvedCoreJoinVerifier || !resolvedCoreJoinVerifier.verify(core_join_context)) fail("generic_core_join_signature_invalid");
    const workId = uuid(work_id);
    const outcome = await transaction(async (client) => {
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
        if (ARCHIVE_STATUSES.has(work.status)) {
          return {
            terminal_replay: true,
            derived: await deriveWorkStateWithClient(
              client,
              actor,
              workId,
              { persist: false },
            ),
          };
        }
        assertOperationalWorkMutation(work);
        return {
          terminal_replay: false,
          derived: await refreshDerivedWithClient(client, actor, workId),
        };
      }
      assertOperationalWorkMutation(work);
      await client.query(`INSERT INTO tenant_work_core_join (tenant_id,work_id,core_join_digest,core_join_context,persisted_by_user_id)
        VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [actor.tenant_id, workId, joinDigest, JSON.stringify(context), actor.user_id]);
      return {
        terminal_replay: false,
        derived: await refreshDerivedWithClient(client, actor, workId),
      };
    });
    return outcome.derived;
  }
  async function deriveWorkStateWithClient(client, actor, workId, { persist = false } = {}) {
    const work = await loadWork(client, actor, workId, true);
    const tasks = await client.query("SELECT title,weight,status,required,acceptance_verified FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    const evidence = await client.query("SELECT weight,required,independently_verified FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    const join = await client.query("SELECT core_join_digest FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    const progress = deriveProgress(tasks.rows, evidence.rows, { evaluated: false, independent_verification_passed: evidence.rows.length > 0 && evidence.rows.every((item) => item.independently_verified), core_join_received: Boolean(join.rows[0]) });
    const priorityFacts = await derivePersistedPriorityFacts(client, actor, { ...work, progress_bp: progress.overall_progress_bp });
    const priority = derivePriority(priorityFacts);
    if (!persist) return { ...progress, ...priority, work };
    assertOperationalWorkMutation(work);
    await client.query(`UPDATE tenant_work SET progress_bp=$3,progress_version=$4,progress_source=$5,priority=$6,priority_score=$7,priority_version=$8,priority_context=$9::jsonb,updated_at=now()
      WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, workId, progress.overall_progress_bp, progress.progress_version, progress.progress_source,
      priority.priority, priority.priority_score, priority.priority_version, JSON.stringify(priorityFacts)]);
    return { ...progress, ...priority, work: await loadWork(client, actor, workId) };
  }
  async function refreshDerivedWithClient(client, actor, workId) {
    return deriveWorkStateWithClient(client, actor, workId, { persist: true });
  }
  async function readDerivedReplay(identity, workId) {
    const actor = actorFromIdentity(identity);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canRead, work, actor);
      return deriveWorkStateWithClient(client, actor, workId, { persist: false });
    });
  }
  async function refreshDerived(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canRead, work, actor);
      assertOperationalWorkMutation(work);
      return refreshDerivedWithClient(client, actor, workId);
    });
  }
  async function reconcileStaleDryRun(identity, { project_id } = {}) {
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("stale_reconciliation_forbidden");
    const works = await listWorks(identity, { view: "tenant", project_id });
    const result = [];
    for (const work of works) {
      const legacyReconciliationEligible = work.work_type === "legacy" &&
        Boolean(work.legacy_work_id);
      if (!legacyReconciliationEligible) {
        const activity = { participants: [], leases: [] };
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
      const sourceId = work.legacy_work_id;
      const [participants, leases] = await Promise.all([
        query("SELECT session_id,branch_id,status,expires_at FROM core_continuity_participants WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, sourceId]),
        query("SELECT session_id,branch_id,purpose,status,expires_at,nyra_read_binding_attested FROM core_continuity_leases WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, sourceId]),
      ]);
      const activity = stalenessExecutionActivity(
        participants.rows.map((row) => ({ ...row, active: row.status === "active" })),
        leases.rows,
        now().getTime(),
      );
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
      const staleFromExecution = classifyStaleWork({ ...work,
        updated_at: authoritativeTimestampValid ? authoritativeUpdatedAt : null,
        ...activity });
      // Keep the decision fail-closed even if a future classifier revision
      // stops consuming a new execution-activity field: a live non-read-only
      // participant or lease can never be offered for reconciliation.
      const stale = activity.execution_activity_count > 0
        ? { classification: "ACTIVE_VALID", reasons: ["effective_execution_activity"] }
        : staleFromExecution;
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
        read_only_binding_count: activity.read_only_binding_count,
        execution_activity_count: activity.execution_activity_count,
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

      const participants = await client.query(`SELECT session_id,branch_id,status,expires_at FROM core_continuity_participants
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
      const leases = await client.query(`SELECT session_id,branch_id,purpose,status,expires_at,nyra_read_binding_attested FROM core_continuity_leases
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
      const activity = stalenessExecutionActivity(
        participants.rows.map((row) => ({ ...row, active: row.status === "active" })),
        leases.rows,
        now().getTime(),
      );
      const stale = classifyStaleWork({ ...work, updated_at: legacy.updated_at,
        participants: activity.participants,
        leases: activity.leases }, now());
      const currentTime = now().getTime();
      const activeParticipant = activity.participants.some((row) => row.status === "active" &&
        new Date(row.expires_at).getTime() > currentTime);
      const activeLease = activity.leases.some((row) => row.status === "active" &&
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
    const tasks = await client.query("SELECT status,acceptance_verified FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true", [actor.tenant_id, workId]);
    const evidence = await client.query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 AND required=true", [actor.tenant_id, workId]);
    const join = await client.query("SELECT * FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    const receipt = await client.query("SELECT * FROM tenant_work_closure_receipt WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    return { work, tasks: tasks.rows, evidence: evidence.rows,
      join: join.rows[0] || null, receipt: receipt.rows[0] || null };
  }
  async function releaseTerminalCoordination(client, actor, workId) {
    if (!workId) {
      return Object.freeze({
        released_lease_count: 0,
        closed_participant_count: 0,
      });
    }
    const released = await client.query(`UPDATE core_continuity_leases
      SET status='released',released_at=coalesce(released_at,now()),
        expires_at=LEAST(expires_at,now())
      WHERE tenant_id=$1 AND work_id=$2 AND status='active'
      RETURNING lease_id`, [actor.tenant_id, workId]);
    const closed = await client.query(`UPDATE core_continuity_participants
      SET status='closed',last_seen_at=now(),expires_at=LEAST(expires_at,now())
      WHERE tenant_id=$1 AND work_id=$2 AND status='active'
      RETURNING session_id`, [actor.tenant_id, workId]);
    return Object.freeze({
      released_lease_count: Number(released.rowCount || 0),
      closed_participant_count: Number(closed.rowCount || 0),
    });
  }
  async function lockLegacyCoordinationWork(client, actor, workId) {
    const locked = await client.query(`SELECT status FROM core_continuity_works
      WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [actor.tenant_id, workId]);
    if (!locked.rows[0]) fail("legacy_work_not_found");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      actor.tenant_id,
      workId,
    ]);
    return locked.rows[0];
  }
  async function appendLegacyTerminalCoordinationEvent(client, actor, workId, payload) {
    // Re-entrant when finalizeGenericClosure already holds the lock. Keeping
    // the guard here makes every legacy ledger append share the runtime's
    // Core-row -> Work-advisory ordering.
    await lockLegacyCoordinationWork(client, actor, workId);
    const previous = await client.query(`SELECT sequence_number,event_hash
      FROM core_continuity_events
      WHERE tenant_id=$1 AND work_id=$2
      ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
    [actor.tenant_id, workId]);
    const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
    const material = {
      tenant_id: actor.tenant_id,
      work_id: workId,
      sequence_number: sequence,
      event_type: "terminal_coordination_reconciled",
      payload: stable(payload),
      previous_event_hash: previous.rows[0]?.event_hash || null,
    };
    const eventHash = objectDigest(material);
    await client.query(`INSERT INTO core_continuity_events
      (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [
      actor.tenant_id,
      workId,
      crypto.randomUUID(),
      sequence,
      material.event_type,
      JSON.stringify(material.payload),
      material.previous_event_hash,
      eventHash,
      actor.agent_id || actor.user_id,
    ]);
    return Object.freeze({
      sequence_number: sequence,
      event_type: material.event_type,
      event_hash: eventHash,
    });
  }
  async function reconcileTerminalCoordination(client, actor, state, historical = {}) {
    const workId = state.work.work_id;
    const coordinationWorkId = state.work.legacy_work_id || null;
    const coordination = await releaseTerminalCoordination(
      client,
      actor,
      coordinationWorkId,
    );
    const reconciled = coordination.released_lease_count > 0 ||
      coordination.closed_participant_count > 0;
    let v2Event = null;
    let legacyEvent = null;
    if (reconciled) {
      const payload = {
        closure_event_type: "generic_closure_finalized",
        reconciliation_source: "terminal_closure_replay",
        coordination_work_id: coordinationWorkId,
        released_lease_count: coordination.released_lease_count,
        closed_participant_count: coordination.closed_participant_count,
        historical_released_lease_count: historical.released_lease_count ?? null,
        historical_closed_participant_count: historical.closed_participant_count ?? null,
      };
      v2Event = await appendV2Event(
        client,
        actor,
        workId,
        "terminal_coordination_reconciled",
        payload,
      );
      if (state.work.legacy_work_id) {
        legacyEvent = await appendLegacyTerminalCoordinationEvent(
          client,
          actor,
          state.work.legacy_work_id,
          { ...payload, v2_event_hash: v2Event.event_hash },
        );
      }
      await injectFailure("terminal_coordination_reconciled", {
        tenant_id: actor.tenant_id,
        work_id: workId,
        coordination_work_id: coordinationWorkId,
      });
    }
    return Object.freeze({
      reconciled,
      released_lease_count: coordination.released_lease_count,
      closed_participant_count: coordination.closed_participant_count,
      event: v2Event,
      legacy_event: legacyEvent,
    });
  }
  async function verifyAndBackfillExistingClosure(client, actor, state, adapter) {
    const workId = state.work.work_id;
    const tasks = await client.query("SELECT * FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY task_id", [actor.tenant_id, workId]);
    const reportResult = await client.query("SELECT tenant_id,work_id,report,report_digest,created_at FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    const eventResult = await client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,previous_event_hash,event_hash
      FROM tenant_work_event
      WHERE tenant_id=$1 AND work_id=$2 AND event_type='generic_closure_finalized'
      ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [actor.tenant_id, workId]);
    const reportRow = reportResult.rows[0] || null;
    const report = plainRecord(reportRow?.report) ? reportRow.report : null;
    if (!report) fail("work_closure_projection_backfill_invalid");
    const reportDigest = objectDigest(report);
    const legacyReportDigest = deriveLegacyFinalReportDigest(report);
    let projectionBackfilled = reportRow.report_digest !== reportDigest;
    if (projectionBackfilled) {
      // A JSONB row can have been written by a pre-canonical runtime.  Do not
      // trust its stored digest merely because it is present: first prove that
      // replacing it with the current canonical digest leaves every report
      // invariant intact.  The event is checked separately below, so a known
      // historical event encoding cannot prevent a safe report-digest repair.
      // The former JSON serialization is still accepted as a compatibility
      // projection. Any other stored value must first pass a complete
      // invariant check with the canonical digest substituted.
      if (reportRow.report_digest !== legacyReportDigest) {
        const provisional = deriveTenantWorkClosureVerification({
          tenant_id: actor.tenant_id,
          work: state.work,
          tasks: tasks.rows,
          evidence: state.evidence,
          core_join: state.join,
          closure_receipt: state.receipt,
          final_report: { ...reportRow, report_digest: reportDigest },
          closure_event: eventResult.rows[0] || null,
        }, {
          verifyCoreJoin: (context) => Boolean(
            resolvedCoreJoinVerifier && resolvedCoreJoinVerifier.verify(context),
          ),
        });
        if (provisional.failure_codes.some((code) => code !== "closure_event_unverified")) {
          fail("work_closure_projection_backfill_invalid");
        }
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

    let verification = deriveTenantWorkClosureVerification({
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
    // Historical closures may contain a report that is semantically valid but
    // an event hashed by an older envelope implementation.  Preserve that
    // immutable event and append one canonical closure event; verification
    // always reads the latest closure event.  This repair is available only
    // when the canonical report and every non-event closure invariant pass.
    if (!verification.verified &&
        verification.failure_codes.length === 1 &&
        verification.failure_codes[0] === "closure_event_unverified") {
      await appendV2Event(client, actor, workId, "generic_closure_finalized", {
        adapter,
        archived: true,
        closure_receipt_digest: state.receipt?.receipt_digest,
        core_join_digest: state.join?.core_join_digest,
        final_evidence_digest: state.work.final_evidence_digest,
        report_digest: reportDigest,
      });
      const correctedEvent = await client.query(`SELECT tenant_id,work_id,sequence_number,event_type,payload,previous_event_hash,event_hash
        FROM tenant_work_event
        WHERE tenant_id=$1 AND work_id=$2 AND event_type='generic_closure_finalized'
        ORDER BY sequence_number DESC LIMIT 1`, [actor.tenant_id, workId]);
      closureEvent = correctedEvent.rows[0] || null;
      projectionBackfilled = true;
      verification = deriveTenantWorkClosureVerification({
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
    }
    if (!verification.verified) fail("work_closure_projection_backfill_invalid");
    const releasedLeaseCount = closureEvent?.payload?.released_lease_count;
    const closedParticipantCount = closureEvent?.payload?.closed_participant_count;
    return { report, projection_backfilled: projectionBackfilled, verification,
      released_lease_count: Number.isSafeInteger(Number(releasedLeaseCount)) &&
        Number(releasedLeaseCount) >= 0 ? Number(releasedLeaseCount) : null,
      closed_participant_count: Number.isSafeInteger(Number(closedParticipantCount)) &&
        Number(closedParticipantCount) >= 0 ? Number(closedParticipantCount) : null };
  }
  async function evaluateGenericClosure(identity, { work_id, adapter }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    if (!CLOSURE_ADAPTERS.includes(adapter)) fail("work_closure_adapter_invalid");
    const state = await transaction((client) => closureState(client, actor, workId, false));
    assertPermission(canRead, state.work, actor);
    if (state.work.work_type !== adapter) fail("work_closure_adapter_mismatch");
    return { work_id: workId, adapter, ...deriveGenericClosureReadiness(state) };
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
    const readiness = deriveGenericClosureReadiness(state);
    if (!readiness.required_tasks_complete) fail("generic_core_join_tasks_incomplete");
    if (readiness.native_task_evidence_only) {
      fail("generic_core_join_native_closure_required");
    }
    if (!state.evidence.length ||
        state.evidence.some((item) => item.independently_verified !== true)) {
      fail("generic_core_join_evidence_incomplete");
    }
    if (!readiness.independent_verification_persisted) {
      fail("generic_core_join_verifier_not_independent");
    }
    const verifier = state.evidence.find((item) =>
      independentlyVerifiedGenericEvidence(item, state.work));
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
      // Resolve the immutable bridge without locking, then take the shared
      // legacy Core row/advisory locks before tenant_work. Runtime Gallery
      // writers use the same Core-row-first order, so a join either commits
      // before this release sweep or observes the terminal status afterwards.
      const bridge = await client.query(`SELECT legacy_work_id FROM tenant_work
        WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, workId]);
      if (!bridge.rows[0]) fail("tenant_work_not_found");
      const expectedLegacyWorkId = bridge.rows[0].legacy_work_id || null;
      if (expectedLegacyWorkId) {
        await lockLegacyCoordinationWork(client, actor, expectedLegacyWorkId);
      }
      const state = await closureState(client, actor, workId, true);
      if ((state.work.legacy_work_id || null) !== expectedLegacyWorkId) {
        fail("work_closure_legacy_binding_changed");
      }
      assertPermission(canClose, state.work, actor);
      if (state.work.work_type !== adapter) fail("work_closure_adapter_mismatch");
      if (state.receipt) {
        const replay = await verifyAndBackfillExistingClosure(client, actor, state, adapter);
        const coordinationReconciliation = await reconcileTerminalCoordination(
          client,
          actor,
          state,
          {
            released_lease_count: replay.released_lease_count,
            closed_participant_count: replay.closed_participant_count,
          },
        );
        return { receipt: state.receipt, final_report: replay.report, idempotent_replay: true,
          projection_backfilled: replay.projection_backfilled,
          closure_verification: replay.verification, terminal_status: "COMPLETED", archived: true,
          released_lease_count: replay.released_lease_count,
          closed_participant_count: replay.closed_participant_count,
          terminal_coordination_reconciliation: coordinationReconciliation };
      }
      const readiness = deriveGenericClosureReadiness(state);
      if (!readiness.ready) fail("work_closure_gate_unsatisfied");
      const ownerManualMergeClosure = state.evidence.some((item) =>
        authoritativeNativeReleaseEvidence(item, state.work));
      const finalEvidenceDigest = crypto.createHash("sha256").update(JSON.stringify(state.evidence.map((item) => item.digest).sort())).digest("hex");
      const finalized = buildGenericClosureArtifacts({ ...state.work, progress_bp: 10_000 }, {
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
      await client.query(`UPDATE tenant_work SET status='COMPLETED',
          closed_at=$3::timestamptz,archived_at=$3::timestamptz,
          final_evidence_digest=$4,closure_type=$5,
          closure_reason='acceptance_criteria_verified',progress_bp=10000,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2`, [
        actor.tenant_id,
        workId,
        finalized.closed_at,
        finalEvidenceDigest,
        adapter,
      ]);
      const coordination = await releaseTerminalCoordination(
        client,
        actor,
        state.work.legacy_work_id || null,
      );
      await injectFailure("generic_closure_coordination_released", {
        tenant_id: actor.tenant_id,
        work_id: workId,
      });
      await appendV2Event(client, actor, workId, "generic_closure_finalized", {
        adapter,
        archived: true,
        closure_receipt_digest: finalized.receipt.receipt_digest,
        core_join_digest: state.join.core_join_digest,
        final_evidence_digest: finalEvidenceDigest,
        report_digest: reportDigest,
        released_lease_count: coordination.released_lease_count,
        closed_participant_count: coordination.closed_participant_count,
      });
      if (state.work.legacy_work_id) {
        await client.query(`UPDATE core_continuity_works SET status='completed',next_action='',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, state.work.legacy_work_id]);
        const previous = await client.query(`SELECT sequence_number,event_hash FROM core_continuity_events
          WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
        [actor.tenant_id, state.work.legacy_work_id]);
        const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
        const payload = { adapter, closure_receipt_digest: finalized.receipt.receipt_digest,
          final_evidence_digest: finalEvidenceDigest,
          report_digest: objectDigest(finalized.final_report), archived: true,
          released_lease_count: coordination.released_lease_count,
          closed_participant_count: coordination.closed_participant_count,
          ...(ownerManualMergeClosure ? { note: "owner_manual_merge" } : {}) };
        const event = { tenant_id: actor.tenant_id, work_id: state.work.legacy_work_id,
          sequence_number: sequence, event_type: "generic_closure_finalized", payload,
          previous_event_hash: previous.rows[0]?.event_hash || null };
        await client.query(`INSERT INTO core_continuity_events
          (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [actor.tenant_id, state.work.legacy_work_id,
          crypto.randomUUID(), sequence, event.event_type, JSON.stringify(payload), event.previous_event_hash,
          objectDigest(event), actor.agent_id || actor.user_id]);
      }
      return { receipt: finalized.receipt, final_report: finalized.final_report,
        idempotent_replay: false, terminal_status: "COMPLETED", archived: true,
        released_lease_count: coordination.released_lease_count,
        closed_participant_count: coordination.closed_participant_count,
        ...(ownerManualMergeClosure ? { closure_note: "owner_manual_merge" } : {}) };
    });
  }
  return Object.freeze({ initialize, createWork, createNewWork, readCreatedWorkByBootstrapRequest, queueNewWork,
    ensureLegacyBridge,
    projectLegacyWork, projectLegacyCatalog, projectLegacyEvent, backfillLegacyProjection,
    readWork, previewNativePlanMerge, verifyWorkClosure, listWorks, assignQueuedWork, acceptQueuedWorkAssignment, archiveWork,
    archiveHistoricalBridgedWork, reopenWork,
    preflightGallery, openWorkReview, readPrecommitTicketGate, reconcilePrecommitTicketGate,
    reconcilePersistedPrecommitTicketGate,
    claimPrecommitTicketGate, reconcilePrecommitTicketGateClaim, readPrecommitTicketGateClaimRecovery,
    abandonInactivePrecommitTicketGateClaim,
    materializeNativePrecommitTicketGateWithClient,
    fulfillPrecommitTicketTask,
    validateNyraAutopilotVerificationCandidate, projectNyraAutopilotVerification,
    recordTask, resolveNativeTaskBindingWithClient, recordEvidence,
    recordOwnerManualMergeReleaseEvidence,
    recordNativeVerifierEvidenceWithClient,
    persistCoreJoin, refreshDerived, reconcileStaleDryRun,
    reconcileLegacyClosed,
    evaluateGenericClosure, buildGenericCoreJoinRequest, finalizeGenericClosure,
    coreJoinVerifierMetadata: resolvedCoreJoinVerifier?.metadata || null,
    verifyCoreJoinVerdict: (verdict, expected) => Boolean(
      resolvedCoreJoinVerifier && resolvedCoreJoinVerifier.verify(verdict, expected)),
  });
}

export { ADDITIVE_SCHEMA_SQL, actorFromIdentity };
