import crypto from "node:crypto";
import { validateCoreOrchestrationVerdict } from "../../shared/nyra-core-orchestration-verdict.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const CONTINUATION_REF = /^nyc1_[A-Za-z0-9_-]{32,80}$/;
const WORK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,127}$/;
const DIRECTIVE_ID = /^nyra_dir_[a-f0-9]{24}$/;
const ACTION_KINDS = new Set(["work_bootstrap", "work_action"]);
const OPERATIONS = new Set([
  "review_work_bootstrap",
  "create_work",
  "issue_delegation",
  "authorize_action",
]);

// Continuations are deliberately persisted independently from a Work: a
// bootstrap is valid before a canonical Work exists.  The record is an opaque
// server-side capability, never a bearer token returned to the connected AI.
export const NYRA_GOVERNED_CONTINUATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS nyra_governed_continuation (
    tenant_id varchar(64) NOT NULL,
    continuation_ref varchar(96) NOT NULL,
    app_id varchar(64) NOT NULL,
    host_kind varchar(64) NOT NULL,
    host_registry_revision varchar(128) NOT NULL,
    subject_digest char(64) NOT NULL,
    session_fingerprint varchar(128) NOT NULL,
    directive_id varchar(40) NOT NULL,
    directive_request_digest char(64) NOT NULL,
    ticket_request_digest char(64) NOT NULL,
    ticket_state varchar(40) NOT NULL,
    candidate_kind varchar(32) NOT NULL,
    action_class varchar(64) NOT NULL,
    merge_policy varchar(32) NOT NULL,
    work_id uuid,
    project_id varchar(128) NOT NULL,
    work_revision integer,
    intent_digest char(64),
    context_digest char(64),
    work_bootstrap_request_digest char(64),
    core_orchestration_verdict jsonb,
    state varchar(24) NOT NULL DEFAULT 'OPEN',
    record_digest char(64) NOT NULL,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, continuation_ref),
    CHECK (continuation_ref ~ '^nyc1_[A-Za-z0-9_-]{32,80}$'),
    CHECK (candidate_kind IN ('work_bootstrap','work_action')),
    CHECK (state IN ('OPEN','CONSUMED','EXPIRED')),
    CHECK (expires_at > issued_at)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS nyra_governed_continuation_open_binding_idx
    ON nyra_governed_continuation (
      tenant_id, app_id, session_fingerprint, directive_id, ticket_request_digest
    ) WHERE state='OPEN';
  CREATE INDEX IF NOT EXISTS nyra_governed_continuation_expiry_idx
    ON nyra_governed_continuation (expires_at);
  ALTER TABLE nyra_governed_continuation
    ADD COLUMN IF NOT EXISTS core_orchestration_verdict jsonb;

  CREATE TABLE IF NOT EXISTS nyra_governed_continuation_operation (
    tenant_id varchar(64) NOT NULL,
    continuation_ref varchar(96) NOT NULL,
    operation varchar(40) NOT NULL,
    request_digest char(64) NOT NULL,
    idempotency_key varchar(80) NOT NULL,
    state varchar(24) NOT NULL DEFAULT 'IN_PROGRESS',
    internal_result jsonb,
    result_digest char(64),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    PRIMARY KEY (tenant_id, continuation_ref, operation),
    FOREIGN KEY (tenant_id, continuation_ref)
      REFERENCES nyra_governed_continuation (tenant_id, continuation_ref)
      ON DELETE RESTRICT,
    CHECK (operation IN ('review_work_bootstrap','create_work','issue_delegation','authorize_action')),
    CHECK (state IN ('IN_PROGRESS','COMPLETED'))
  );
  CREATE INDEX IF NOT EXISTS nyra_governed_continuation_operation_state_idx
    ON nyra_governed_continuation_operation (tenant_id, continuation_ref, state);
`;

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function hmac(secret, value) {
  return crypto.createHmac("sha256", secret)
    .update(`nyra-governed-continuation-v2\u0000${JSON.stringify(stable(value))}`)
    .digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function exactString(value, pattern, code, maximum = 240) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum || !pattern.test(text)) fail(code, 409);
  return text;
}

function nullableDigest(value, code) {
  if (value === null || value === undefined) return null;
  return exactString(value, SHA256, code, 64);
}

function nullableWorkId(value, code) {
  if (value === null || value === undefined) return null;
  return exactString(value, WORK_ID, code, 36).toLowerCase();
}

function nullableRevision(value, code) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 100_000) {
    fail(code, 409);
  }
  return Number(value);
}

function subjectDigest(identity) {
  const subject = String(identity?.subject || "").trim();
  if (!subject || subject.length > 512) fail("nyra_continuation_subject_required", 403);
  return crypto.createHash("sha256").update(subject).digest("hex");
}

function identityBinding(identity) {
  const principal = identity?.authenticatedHostPrincipal;
  const tenantId = String(identity?.tenantId || "").trim();
  const appId = String(principal?.app_id || "").trim();
  const hostKind = String(principal?.host_kind || "").trim();
  const registryRevision = String(principal?.registry_revision || "").trim();
  const sessionFingerprint = String(identity?.agentPresence?.session_fingerprint || "").trim();
  if (!tenantId || !appId || !hostKind || !registryRevision || !sessionFingerprint ||
      principal?.registered !== true || !/^[a-f0-9]{16,128}$/i.test(sessionFingerprint)) {
    fail("nyra_continuation_authenticated_host_presence_required", 403);
  }
  return Object.freeze({
    tenant_id: tenantId,
    app_id: appId,
    host_kind: hostKind,
    host_registry_revision: registryRevision,
    subject_digest: subjectDigest(identity),
    session_fingerprint: sessionFingerprint,
  });
}

function canonicalRecord(record) {
  return {
    tenant_id: record.tenant_id,
    continuation_ref: record.continuation_ref,
    app_id: record.app_id,
    host_kind: record.host_kind,
    host_registry_revision: record.host_registry_revision,
    subject_digest: record.subject_digest,
    session_fingerprint: record.session_fingerprint,
    directive_id: record.directive_id,
    directive_request_digest: record.directive_request_digest,
    ticket_request_digest: record.ticket_request_digest,
    ticket_state: record.ticket_state,
    candidate_kind: record.candidate_kind,
    action_class: record.action_class,
    merge_policy: record.merge_policy,
    work_id: record.work_id,
    project_id: record.project_id,
    work_revision: record.work_revision,
    intent_digest: record.intent_digest,
    context_digest: record.context_digest,
    work_bootstrap_request_digest: record.work_bootstrap_request_digest,
    core_orchestration_verdict: record.core_orchestration_verdict || null,
    issued_at: new Date(record.issued_at).toISOString(),
    expires_at: new Date(record.expires_at).toISOString(),
  };
}

// A repeat of the same Nyra turn must reuse the durable reference.  Its
// original issue/expiry timestamps are deliberately not part of this
// comparison: they are facts of the persisted capability, not client input.
function openingBindingMatches(record, candidate) {
  const fields = [
    "tenant_id", "app_id", "host_kind", "host_registry_revision", "subject_digest",
    "session_fingerprint", "directive_id", "directive_request_digest", "ticket_request_digest",
    "ticket_state", "candidate_kind", "action_class", "merge_policy", "work_id", "project_id",
    "work_revision", "intent_digest", "context_digest", "work_bootstrap_request_digest",
  ];
  return fields.every((field) => record[field] === candidate[field]) &&
    digest(record.core_orchestration_verdict || null) ===
      digest(candidate.core_orchestration_verdict || null);
}

function normalizeOpen(input, identity, now, ttlMs) {
  const binding = identityBinding(identity);
  const ticket = input?.ticket_request;
  const directiveId = exactString(input?.directive_id, DIRECTIVE_ID, "nyra_continuation_directive_invalid", 40);
  const directiveRequestDigest = exactString(input?.request_digest, SHA256, "nyra_continuation_directive_digest_invalid", 64);
  const ticketRequestDigest = exactString(ticket?.request_digest, SHA256, "nyra_continuation_ticket_digest_invalid", 64);
  const candidateKind = ticket?.state === "WORK_BOOTSTRAP_READY" && ticket?.action_class === "WORK_BOOTSTRAP"
    ? "work_bootstrap"
    : "work_action";
  if (ticket?.required !== true || !["WORK_BOOTSTRAP_READY", "READY_FOR_CORE_REVIEW", "MANUAL_ONLY"].includes(ticket?.state)) {
    fail("nyra_continuation_candidate_unavailable", 409);
  }
  const rawBinding = ticket?.binding;
  if (!rawBinding || rawBinding.tenant_id !== binding.tenant_id) {
    fail("nyra_continuation_tenant_binding_invalid", 403);
  }
  const issuedAt = Number(now());
  const expiresAt = issuedAt + ttlMs;
  const common = {
    ...binding,
    directive_id: directiveId,
    directive_request_digest: directiveRequestDigest,
    ticket_request_digest: ticketRequestDigest,
    ticket_state: String(ticket.state),
    candidate_kind: candidateKind,
    action_class: String(ticket.action_class || ""),
    merge_policy: String(ticket.merge_policy || "NOT_APPLICABLE"),
    project_id: exactString(rawBinding.project_id, PROJECT_ID, "nyra_continuation_project_binding_invalid", 127),
    issued_at: new Date(issuedAt).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
  };
  if (candidateKind === "work_bootstrap") {
    if (rawBinding.work_id !== null || rawBinding.work_revision !== null ||
        rawBinding.intent_digest !== null || rawBinding.context_digest !== null ||
        common.action_class !== "WORK_BOOTSTRAP") {
      fail("nyra_continuation_bootstrap_binding_invalid", 409);
    }
    const canonicalIntentDigest = nullableDigest(
      rawBinding.canonical_intent_digest,
      "nyra_continuation_canonical_intent_binding_invalid",
    );
    const coreOrchestrationVerdictDigest = nullableDigest(
      rawBinding.core_orchestration_verdict_digest,
      "nyra_continuation_core_verdict_binding_invalid",
    );
    if (!canonicalIntentDigest || !coreOrchestrationVerdictDigest) {
      fail("nyra_continuation_bootstrap_binding_invalid", 409);
    }
    const canonicalIntentBindingDigest = nullableDigest(
      rawBinding.canonical_intent_binding_digest,
      "nyra_continuation_canonical_intent_binding_invalid",
    );
    if (!canonicalIntentBindingDigest) {
      fail("nyra_continuation_bootstrap_binding_invalid", 409);
    }
    let coreOrchestrationVerdict;
    try {
      coreOrchestrationVerdict = validateCoreOrchestrationVerdict(
        input?.core_orchestration_verdict,
        {
          canonicalIntentDigest,
          canonicalIntentBindingDigest,
        },
      );
    } catch {
      fail("nyra_continuation_core_verdict_binding_invalid", 409);
    }
    if (coreOrchestrationVerdict.verdict_digest !== coreOrchestrationVerdictDigest) {
      fail("nyra_continuation_core_verdict_binding_invalid", 409);
    }
    return {
      ...common,
      work_id: null,
      work_revision: null,
      // Before a Work exists these two existing integrity columns bind the
      // turn-level canonical Intent and the Core orchestration verdict. For a
      // work_action they retain their established Work-anchor meanings.
      intent_digest: canonicalIntentDigest,
      context_digest: coreOrchestrationVerdictDigest,
      work_bootstrap_request_digest: exactString(
        ticket.work_bootstrap_request_digest,
        SHA256,
        "nyra_continuation_bootstrap_digest_invalid",
        64,
      ),
      core_orchestration_verdict: coreOrchestrationVerdict,
    };
  }
  const workId = nullableWorkId(rawBinding.work_id, "nyra_continuation_work_binding_invalid");
  const revision = nullableRevision(rawBinding.work_revision, "nyra_continuation_revision_binding_invalid");
  const intentDigest = nullableDigest(rawBinding.intent_digest, "nyra_continuation_intent_binding_invalid");
  const contextDigest = nullableDigest(rawBinding.context_digest, "nyra_continuation_context_binding_invalid");
  if (!workId || !revision || !intentDigest || !contextDigest || common.action_class === "WORK_BOOTSTRAP") {
    fail("nyra_continuation_work_binding_invalid", 409);
  }
  return {
    ...common,
    work_id: workId,
    work_revision: revision,
    intent_digest: intentDigest,
    context_digest: contextDigest,
    work_bootstrap_request_digest: null,
    core_orchestration_verdict: null,
  };
}

function continuationId() {
  return `nyc1_${crypto.randomBytes(30).toString("base64url")}`;
}

function operationIdempotencyKey(continuationRef, operation) {
  return `nyra_ref_${digest({ continuation_ref: continuationRef, operation }).slice(0, 48)}`;
}

function publicRecord(record) {
  return Object.freeze({
    schema_version: "nyra_continuation_ref_v1",
    available: true,
    continuation_ref: record.continuation_ref,
    expires_at: new Date(record.expires_at).toISOString(),
    state: record.state === "OPEN" ? "READY" : "CONSUMED",
    reason: null,
  });
}

function recordMatchesIdentity(record, identity) {
  const binding = identityBinding(identity);
  return record.tenant_id === binding.tenant_id &&
    record.app_id === binding.app_id &&
    record.host_kind === binding.host_kind &&
    record.host_registry_revision === binding.host_registry_revision &&
    record.subject_digest === binding.subject_digest &&
    record.session_fingerprint === binding.session_fingerprint;
}

function assertStoredRecord(record, identity, now, secret, { allowExpired = false } = {}) {
  if (!record || !recordMatchesIdentity(record, identity)) {
    fail("nyra_continuation_binding_mismatch", 403);
  }
  const expiresAt = Date.parse(String(record.expires_at || ""));
  if (!Number.isFinite(expiresAt) || (!allowExpired && expiresAt <= Number(now()))) {
    fail("nyra_continuation_expired", 409);
  }
  const canonical = canonicalRecord(record);
  if (!safeEqual(record.record_digest, hmac(secret, canonical))) {
    fail("nyra_continuation_record_integrity_invalid", 503);
  }
  return canonical;
}

function validOperationFor(record, operation) {
  if (!OPERATIONS.has(operation)) fail("nyra_continuation_operation_invalid", 409);
  if (record.candidate_kind === "work_bootstrap") {
    if (!["review_work_bootstrap", "create_work"].includes(operation)) {
      fail("nyra_continuation_candidate_kind_mismatch", 409);
    }
  } else if (!["issue_delegation", "authorize_action"].includes(operation)) {
    fail("nyra_continuation_candidate_kind_mismatch", 409);
  }
}

function rowToRecord(row) {
  if (!row) return null;
  return {
    ...row,
    work_revision: row.work_revision === null || row.work_revision === undefined
      ? null : Number(row.work_revision),
  };
}

export function createNyraGovernedContinuationStore({
  pool,
  signingSecret,
  now = () => Date.now(),
  ttlMs = 5 * 60 * 1_000,
} = {}) {
  if (!pool?.query) throw new Error("nyra_continuation_postgres_pool_required");
  const secret = String(signingSecret || "").trim();
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("nyra_continuation_signing_secret_required");
  }
  const boundedTtl = Math.min(Math.max(Number(ttlMs) || 300_000, 60_000), 600_000);
  let initialized = false;
  let initialization;

  async function initialize() {
    initialization ||= Promise.resolve().then(async () => {
      await pool.query(NYRA_GOVERNED_CONTINUATION_SCHEMA);
      const verification = await pool.query(`
        SELECT
          to_regclass('nyra_governed_continuation') IS NOT NULL AS continuation_table,
          to_regclass('nyra_governed_continuation_operation') IS NOT NULL AS operation_table,
          to_regclass('nyra_governed_continuation_open_binding_idx') IS NOT NULL AS open_index,
          to_regclass('nyra_governed_continuation_operation_state_idx') IS NOT NULL AS operation_index,
          EXISTS (
            SELECT 1
            FROM pg_attribute
            WHERE attrelid=to_regclass('nyra_governed_continuation')
              AND attname='core_orchestration_verdict'
              AND atttypid='jsonb'::regtype
              AND attnum > 0
              AND NOT attisdropped
              AND NOT attnotnull
          ) AS core_verdict_column
      `);
      const row = verification.rows?.[0];
      if (
        !row?.continuation_table ||
        !row?.operation_table ||
        !row?.open_index ||
        !row?.operation_index ||
        !row?.core_verdict_column
      ) {
        throw new Error("nyra_continuation_schema_unverified");
      }
      initialized = true;
      return Object.freeze({ ready: true, distributed: true, restart_durable: true });
    });
    return initialization;
  }

  function requireReady() {
    if (!initialized) fail("nyra_continuation_store_unavailable", 503);
  }

  async function open({ identity, directive }) {
    requireReady();
    const candidate = normalizeOpen(directive, identity, now, boundedTtl);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // PostgreSQL partial indexes cannot use the volatile database clock in
      // their predicate. Transition an expired open reference in this same
      // transaction before looking up or inserting the replacement, so a
      // later identical Nyra turn can obtain a fresh bounded reference.
      await client.query(`
        UPDATE nyra_governed_continuation
        SET state='EXPIRED',updated_at=clock_timestamp()
        WHERE tenant_id=$1 AND app_id=$2 AND session_fingerprint=$3 AND directive_id=$4
          AND ticket_request_digest=$5 AND state='OPEN' AND expires_at<=clock_timestamp()`, [
        candidate.tenant_id, candidate.app_id, candidate.session_fingerprint,
        candidate.directive_id, candidate.ticket_request_digest,
      ]);
      const existing = await client.query(`
        SELECT * FROM nyra_governed_continuation
        WHERE tenant_id=$1 AND app_id=$2 AND session_fingerprint=$3 AND directive_id=$4
          AND ticket_request_digest=$5 AND state='OPEN' AND expires_at>clock_timestamp()
        FOR UPDATE`, [
        candidate.tenant_id, candidate.app_id, candidate.session_fingerprint,
        candidate.directive_id, candidate.ticket_request_digest,
      ]);
      let record;
      if (existing.rows[0]) {
        record = rowToRecord(existing.rows[0]);
        assertStoredRecord(record, identity, now, secret);
        if (!openingBindingMatches(record, candidate)) {
          fail("nyra_continuation_existing_binding_drift", 409);
        }
      } else {
        record = {
          ...candidate,
          continuation_ref: continuationId(),
          state: "OPEN",
        };
        record.record_digest = hmac(secret, canonicalRecord(record));
        const inserted = await client.query(`
          INSERT INTO nyra_governed_continuation (
            tenant_id,continuation_ref,app_id,host_kind,host_registry_revision,subject_digest,
            session_fingerprint,directive_id,directive_request_digest,ticket_request_digest,
            ticket_state,candidate_kind,action_class,merge_policy,work_id,project_id,work_revision,
            intent_digest,context_digest,work_bootstrap_request_digest,core_orchestration_verdict,
            state,record_digest,issued_at,expires_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24,$25
          ) ON CONFLICT (tenant_id,app_id,session_fingerprint,directive_id,ticket_request_digest)
            WHERE state='OPEN' DO NOTHING
          RETURNING *`, [
          record.tenant_id, record.continuation_ref, record.app_id, record.host_kind,
          record.host_registry_revision, record.subject_digest, record.session_fingerprint,
          record.directive_id, record.directive_request_digest, record.ticket_request_digest,
          record.ticket_state, record.candidate_kind, record.action_class, record.merge_policy,
          record.work_id, record.project_id, record.work_revision, record.intent_digest,
          record.context_digest, record.work_bootstrap_request_digest,
          record.core_orchestration_verdict ? JSON.stringify(record.core_orchestration_verdict) : null,
          record.state, record.record_digest, record.issued_at, record.expires_at,
        ]);
        record = rowToRecord(inserted.rows[0]);
        if (!record) {
          // A concurrent opener won the unique binding after our lookup. It
          // is safe to reuse only the exact record authenticated above.
          const concurrent = await client.query(`
            SELECT * FROM nyra_governed_continuation
            WHERE tenant_id=$1 AND app_id=$2 AND session_fingerprint=$3 AND directive_id=$4
              AND ticket_request_digest=$5 AND state='OPEN' AND expires_at>clock_timestamp()
            FOR UPDATE`, [
            candidate.tenant_id, candidate.app_id, candidate.session_fingerprint,
            candidate.directive_id, candidate.ticket_request_digest,
          ]);
          record = rowToRecord(concurrent.rows[0]);
          if (!record) fail("nyra_continuation_open_conflict", 503);
          assertStoredRecord(record, identity, now, secret);
          if (!openingBindingMatches(record, candidate)) {
            fail("nyra_continuation_existing_binding_drift", 409);
          }
        }
      }
      await client.query("COMMIT");
      return publicRecord(record);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function claim({ identity, continuation_ref, operation, request_digest, validate = null }) {
    requireReady();
    const ref = exactString(continuation_ref, CONTINUATION_REF, "nyra_continuation_ref_invalid", 96);
    const op = exactString(operation, /^[a-z_]{3,40}$/, "nyra_continuation_operation_invalid", 40);
    const requestDigest = exactString(request_digest, SHA256, "nyra_continuation_request_digest_invalid", 64);
    const binding = identityBinding(identity);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(`
        SELECT * FROM nyra_governed_continuation
        WHERE tenant_id=$1 AND continuation_ref=$2 FOR UPDATE`, [binding.tenant_id, ref]);
      const record = rowToRecord(selected.rows[0]);
      assertStoredRecord(record, identity, now, secret);
      validOperationFor(record, op);
      const previous = await client.query(`
        SELECT request_digest,idempotency_key,state,internal_result FROM nyra_governed_continuation_operation
        WHERE tenant_id=$1 AND continuation_ref=$2 AND operation=$3 FOR UPDATE`, [binding.tenant_id, ref, op]);
      const existing = previous.rows[0] || null;
      if (existing && existing.request_digest !== requestDigest) {
        fail("nyra_continuation_request_replay_conflict", 409);
      }
      // A caller can lose the successful response after a terminal operation.
      // Replay the exact stored result before testing the consumed continuation
      // state, otherwise the durable recovery path would be unreachable.
      if (existing?.state === "COMPLETED") {
        await client.query("COMMIT");
        return Object.freeze({ record: canonicalRecord(record), operation: op, request_digest: requestDigest,
          idempotency_key: existing.idempotency_key, replay: true, completed_result: existing.internal_result });
      }
      if (record.state !== "OPEN") fail("nyra_continuation_consumed", 409);
      if (typeof validate === "function") {
        await validate(canonicalRecord(record));
      }
      if (record.candidate_kind === "work_bootstrap" && op === "create_work") {
        const review = await client.query(`
          SELECT internal_result FROM nyra_governed_continuation_operation
          WHERE tenant_id=$1 AND continuation_ref=$2 AND operation='review_work_bootstrap' AND state='COMPLETED'
          FOR UPDATE`, [binding.tenant_id, ref]);
        if (!review.rows[0]?.internal_result?.review_id || !review.rows[0]?.internal_result?.review_digest) {
          fail("nyra_continuation_bootstrap_review_required", 409);
        }
      }
      if (record.candidate_kind === "work_action") {
        const other = await client.query(`
          SELECT operation FROM nyra_governed_continuation_operation
          WHERE tenant_id=$1 AND continuation_ref=$2 AND operation<>$3 LIMIT 1 FOR UPDATE`,
        [binding.tenant_id, ref, op]);
        if (other.rows[0]) fail("nyra_continuation_replayed", 409);
      }
      if (!existing) {
        const idempotencyKey = operationIdempotencyKey(ref, op);
        await client.query(`
          INSERT INTO nyra_governed_continuation_operation
            (tenant_id,continuation_ref,operation,request_digest,idempotency_key)
          VALUES ($1,$2,$3,$4,$5)`, [binding.tenant_id, ref, op, requestDigest, idempotencyKey]);
        await client.query("COMMIT");
        return Object.freeze({ record: canonicalRecord(record), operation: op, request_digest: requestDigest,
          idempotency_key: idempotencyKey, replay: false, completed_result: null });
      }
      await client.query("COMMIT");
      return Object.freeze({ record: canonicalRecord(record), operation: op, request_digest: requestDigest,
        idempotency_key: existing.idempotency_key, replay: true,
        completed_result: existing.state === "COMPLETED" ? existing.internal_result : null });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function readCompletedOperation({ identity, continuation_ref, operation }) {
    requireReady();
    const ref = exactString(continuation_ref, CONTINUATION_REF, "nyra_continuation_ref_invalid", 96);
    const op = exactString(operation, /^[a-z_]{3,40}$/, "nyra_continuation_operation_invalid", 40);
    const binding = identityBinding(identity);
    const selected = await pool.query(`
      SELECT c.*,o.internal_result,o.state AS operation_state
      FROM nyra_governed_continuation c
      JOIN nyra_governed_continuation_operation o
        ON o.tenant_id=c.tenant_id AND o.continuation_ref=c.continuation_ref
      WHERE c.tenant_id=$1 AND c.continuation_ref=$2 AND o.operation=$3`, [binding.tenant_id, ref, op]);
    const row = selected.rows[0];
    const record = rowToRecord(row);
    assertStoredRecord(record, identity, now, secret);
    if (row.operation_state !== "COMPLETED" || !row.internal_result) {
      fail("nyra_continuation_predecessor_incomplete", 409);
    }
    return row.internal_result;
  }

  async function complete({ identity, continuation_ref, operation, request_digest, internal_result, terminal = true }) {
    requireReady();
    const ref = exactString(continuation_ref, CONTINUATION_REF, "nyra_continuation_ref_invalid", 96);
    const op = exactString(operation, /^[a-z_]{3,40}$/, "nyra_continuation_operation_invalid", 40);
    const requestDigest = exactString(request_digest, SHA256, "nyra_continuation_request_digest_invalid", 64);
    const binding = identityBinding(identity);
    const result = internal_result && typeof internal_result === "object" && !Array.isArray(internal_result)
      ? stable(internal_result) : fail("nyra_continuation_internal_result_invalid", 503);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const continuation = await client.query(`SELECT * FROM nyra_governed_continuation
        WHERE tenant_id=$1 AND continuation_ref=$2 FOR UPDATE`, [binding.tenant_id, ref]);
      const record = rowToRecord(continuation.rows[0]);
      // Once an exact operation was claimed while the reference was valid,
      // Core may finish just after the reference TTL. Its result must still be
      // persisted for a safe retry; this does not permit a new claim.
      assertStoredRecord(record, identity, now, secret, { allowExpired: true });
      if (record.state !== "OPEN") fail("nyra_continuation_consumed", 409);
      const updated = await client.query(`
        UPDATE nyra_governed_continuation_operation
        SET state='COMPLETED',internal_result=$5::jsonb,result_digest=$6,completed_at=clock_timestamp()
        WHERE tenant_id=$1 AND continuation_ref=$2 AND operation=$3 AND request_digest=$4 AND state='IN_PROGRESS'
        RETURNING internal_result`, [binding.tenant_id, ref, op, requestDigest, JSON.stringify(result), digest(result)]);
      if (!updated.rowCount) fail("nyra_continuation_operation_claim_missing", 409);
      if (terminal) {
        await client.query(`UPDATE nyra_governed_continuation SET state='CONSUMED',updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND continuation_ref=$2 AND state='OPEN'`, [binding.tenant_id, ref]);
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    kind: "postgres",
    distributed: true,
    restart_durable: true,
    initialize,
    open,
    claim,
    readCompletedOperation,
    complete,
  });
}
