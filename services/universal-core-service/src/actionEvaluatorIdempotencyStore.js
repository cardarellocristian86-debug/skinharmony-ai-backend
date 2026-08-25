import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/u;
const OWNER_FINGERPRINT = /^osf_[a-f0-9]{64}$/u;
const APPROVAL_HASH = /^sha256:[a-f0-9]{64}$/u;

function fail(code, status = 500) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.statusCode = status;
  throw error;
}

function text(value, code, maximum) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    fail(code, 422);
  }
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function actionEvaluatorDigest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

export const ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION =
  "action_evaluator_idempotency_v1";
const ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_MANIFEST = Object.freeze({
  schema_version: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
  component: "core_action_evaluator_idempotency",
  tables: Object.freeze([
    "core_action_evaluator_owner_approvals",
    "core_action_evaluator_receipts",
    "core_action_evaluator_schema_manifest",
  ]),
  receipt_primary_key: Object.freeze([
    "tenant_id", "action_type", "idempotency_key_digest",
  ]),
  approval_primary_key: Object.freeze(["tenant_id", "approval_hash"]),
  append_only: true,
  append_only_events: Object.freeze(["update", "delete", "truncate"]),
  expiry_index: Object.freeze({
    method: "btree",
    columns: Object.freeze(["authorization_expires_at"]),
  }),
  mutation_guard: Object.freeze({
    function: "core_action_evaluator_deny_mutation()",
    sqlstate: "55000",
  }),
});
export const ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST =
  actionEvaluatorDigest(ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_MANIFEST);

function normalize(input = {}) {
  const tenantId = text(input.tenant_id, "core_action_idempotency_tenant_invalid", 120);
  const actionType = text(input.action_type, "core_action_idempotency_action_invalid", 160).toLowerCase();
  const idempotencyKey = text(input.idempotency_key, "core_action_idempotency_key_invalid", 240);
  if (idempotencyKey.length < 8) fail("core_action_idempotency_key_invalid", 422);
  const requestDigest = String(input.request_digest || "").trim().toLowerCase();
  if (!SHA256.test(requestDigest)) fail("core_action_idempotency_digest_invalid", 422);
  const ownerSubjectFingerprint = String(input.owner_subject_fingerprint || "").trim().toLowerCase();
  if (!OWNER_FINGERPRINT.test(ownerSubjectFingerprint)) {
    fail("core_action_idempotency_owner_invalid", 403);
  }
  const approvalHash = String(input.owner_approval?.approval_hash || "").trim().toLowerCase();
  if (!APPROVAL_HASH.test(approvalHash)) fail("core_action_idempotency_owner_invalid", 403);
  const authorizationExpiresAt = new Date(String(
    input.authorization_expires_at || input.owner_approval?.expires_at || "",
  ));
  const approvalExpiresAt = new Date(String(input.owner_approval?.expires_at || ""));
  if (!Number.isFinite(authorizationExpiresAt.getTime()) ||
      !Number.isFinite(approvalExpiresAt.getTime()) ||
      authorizationExpiresAt.getTime() !== approvalExpiresAt.getTime()) {
    fail("core_action_idempotency_expiry_invalid", 422);
  }
  const idempotencyKeyDigest = actionEvaluatorDigest(idempotencyKey);
  const scope = `${tenantId}\u0000${actionType}\u0000${idempotencyKeyDigest}`;
  return Object.freeze({
    tenantId,
    actionType,
    idempotencyKeyDigest,
    requestDigest,
    ownerSubjectFingerprint,
    approvalHash,
    approvalExpiresAt: approvalExpiresAt.toISOString(),
    authorizationExpiresAt: authorizationExpiresAt.toISOString(),
    scope,
  });
}

function parseJson(value) {
  if (typeof value === "string") return JSON.parse(value);
  return structuredClone(value);
}

function validatePrior(row, request, nowMilliseconds) {
  if (String(row.request_digest || "") !== request.requestDigest ||
      String(row.owner_subject_fingerprint || "").toLowerCase() !== request.ownerSubjectFingerprint) {
    fail("core_action_idempotency_conflict", 409);
  }
  const authorityResponse = parseJson(row.authority_response);
  const receipt = parseJson(row.receipt);
  const responseDigest = String(row.response_digest || "").trim().toLowerCase();
  const authorizationId = String(row.authorization_id || "");
  const rowExpiryMilliseconds = Date.parse(String(row.authorization_expires_at || ""));
  const receiptIssuedMilliseconds = Date.parse(String(receipt?.issued_at || ""));
  if (!Number.isFinite(rowExpiryMilliseconds) || !Number.isFinite(receiptIssuedMilliseconds)) {
    fail("core_action_idempotency_record_invalid", 503);
  }
  const rowExpiresAt = new Date(rowExpiryMilliseconds).toISOString();
  if (!authorityResponse || typeof authorityResponse !== "object" || Array.isArray(authorityResponse) ||
      !receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
      !SHA256.test(responseDigest) || !/^cae_[a-f0-9]{40}$/u.test(authorizationId)) {
    fail("core_action_idempotency_record_invalid", 503);
  }
  const { authorization_receipt: embeddedReceipt, ...responseMaterial } = authorityResponse;
  const { receipt_digest: receiptDigest, ...receiptMaterial } = receipt;
  if (actionEvaluatorDigest(responseMaterial) !== responseDigest ||
      receipt.response_digest !== responseDigest ||
      receipt.authorization_id !== authorizationId ||
      authorityResponse.authorization?.decision_id !== authorizationId ||
      receipt.schema_version !== "core_action_authorization_receipt_v1" ||
      receipt.authority !== "universal_core" || receipt.tenant_id !== request.tenantId ||
      receipt.action_type !== request.actionType ||
      receipt.idempotency_key_digest !== request.idempotencyKeyDigest ||
      receipt.request_digest !== request.requestDigest ||
      receipt.expires_at !== rowExpiresAt ||
      receiptIssuedMilliseconds >= rowExpiryMilliseconds ||
      receiptDigest !== actionEvaluatorDigest(receiptMaterial) ||
      canonical(embeddedReceipt) !== canonical(receipt)) {
    fail("core_action_idempotency_record_invalid", 503);
  }
  if (rowExpiryMilliseconds <= nowMilliseconds) {
    fail("core_action_idempotency_expired", 409);
  }
  return {
    authority_response: authorityResponse,
    receipt,
  };
}

function materializeRecord(request, response, issuedAt) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    fail("core_action_idempotency_response_invalid");
  }
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > 1_000_000) {
    fail("core_action_idempotency_response_too_large");
  }
  if (Date.parse(issuedAt) >= Date.parse(request.authorizationExpiresAt)) {
    fail("core_action_idempotency_expired", 409);
  }
  const authorizationId = `cae_${actionEvaluatorDigest({
    scope: request.scope,
    request_digest: request.requestDigest,
  }).slice(0, 40)}`;
  const authorityResponse = structuredClone(response);
  authorityResponse.authorization = {
    ...(authorityResponse.authorization && typeof authorityResponse.authorization === "object"
      ? authorityResponse.authorization : {}),
    decision_id: authorizationId,
  };
  const responseDigest = actionEvaluatorDigest(authorityResponse);
  const receiptMaterial = {
    schema_version: "core_action_authorization_receipt_v1",
    authority: "universal_core",
    authorization_id: authorizationId,
    tenant_id: request.tenantId,
    action_type: request.actionType,
    idempotency_key_digest: request.idempotencyKeyDigest,
    request_digest: request.requestDigest,
    response_digest: responseDigest,
    issued_at: issuedAt,
    expires_at: request.authorizationExpiresAt,
  };
  const receipt = Object.freeze({
    ...receiptMaterial,
    receipt_digest: actionEvaluatorDigest(receiptMaterial),
  });
  authorityResponse.authorization_receipt = receipt;
  return {
    authorizationId,
    authorityResponse,
    responseDigest,
    receipt,
  };
}

function attemptReceipt(receipt, replayed, attemptedAt) {
  return Object.freeze({
    schema_version: "core_action_authorization_attempt_v1",
    authority: "universal_core",
    idempotent_replay: replayed,
    original_authorization_id: receipt.authorization_id,
    original_receipt_digest: receipt.receipt_digest,
    attempted_at: attemptedAt,
    execution_authorized: false,
  });
}

const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS core_action_evaluator_receipts (
  tenant_id varchar(120) NOT NULL,
  action_type varchar(160) NOT NULL,
  idempotency_key_digest char(64) NOT NULL,
  request_digest char(64) NOT NULL,
  owner_subject_fingerprint varchar(80) NOT NULL,
  authorization_id varchar(64) NOT NULL,
  authority_response jsonb NOT NULL,
  response_digest char(64) NOT NULL,
  receipt jsonb NOT NULL,
  authorization_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,action_type,idempotency_key_digest),
  CHECK (idempotency_key_digest ~ '^[a-f0-9]{64}$'),
  CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  CHECK (response_digest ~ '^[a-f0-9]{64}$'),
  CHECK (jsonb_typeof(authority_response)='object'),
  CHECK (jsonb_typeof(receipt)='object')
);
CREATE TABLE IF NOT EXISTS core_action_evaluator_owner_approvals (
  tenant_id varchar(120) NOT NULL,
  approval_hash varchar(80) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,approval_hash)
);
CREATE INDEX IF NOT EXISTS core_action_evaluator_receipts_expiry_idx
  ON core_action_evaluator_receipts (authorization_expires_at);

CREATE TABLE IF NOT EXISTS core_action_evaluator_schema_manifest (
  component text PRIMARY KEY,
  schema_version varchar(80) NOT NULL,
  schema_digest char(64) NOT NULL,
  append_only boolean NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION core_action_evaluator_deny_mutation()
RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  RAISE EXCEPTION 'core_action_evaluator_append_only_violation'
    USING ERRCODE = '55000';
END;
$guard$;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_receipts'::regclass
      AND tgname='core_action_evaluator_receipts_append_only') THEN
    CREATE TRIGGER core_action_evaluator_receipts_append_only
      BEFORE UPDATE OR DELETE ON core_action_evaluator_receipts
      FOR EACH ROW EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_owner_approvals'::regclass
      AND tgname='core_action_evaluator_owner_approvals_append_only') THEN
    CREATE TRIGGER core_action_evaluator_owner_approvals_append_only
      BEFORE UPDATE OR DELETE ON core_action_evaluator_owner_approvals
      FOR EACH ROW EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_schema_manifest'::regclass
      AND tgname='core_action_evaluator_schema_manifest_append_only') THEN
    CREATE TRIGGER core_action_evaluator_schema_manifest_append_only
      BEFORE UPDATE OR DELETE ON core_action_evaluator_schema_manifest
      FOR EACH ROW EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_receipts'::regclass
      AND tgname='core_action_evaluator_receipts_truncate_guard') THEN
    CREATE TRIGGER core_action_evaluator_receipts_truncate_guard
      BEFORE TRUNCATE ON core_action_evaluator_receipts
      FOR EACH STATEMENT EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_owner_approvals'::regclass
      AND tgname='core_action_evaluator_owner_approvals_truncate_guard') THEN
    CREATE TRIGGER core_action_evaluator_owner_approvals_truncate_guard
      BEFORE TRUNCATE ON core_action_evaluator_owner_approvals
      FOR EACH STATEMENT EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_schema_manifest'::regclass
      AND tgname='core_action_evaluator_schema_manifest_truncate_guard') THEN
    CREATE TRIGGER core_action_evaluator_schema_manifest_truncate_guard
      BEFORE TRUNCATE ON core_action_evaluator_schema_manifest
      FOR EACH STATEMENT EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
END;
$guard$;

INSERT INTO core_action_evaluator_schema_manifest
  (component,schema_version,schema_digest,append_only)
VALUES ('core_action_evaluator_idempotency',
  '${ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION}',
  '${ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST}',true)
ON CONFLICT (component) DO NOTHING;`;

const POSTGRES_SCHEMA_VERIFICATION = `
SELECT
  m.schema_version,
  m.schema_digest,
  m.append_only,
  (SELECT array_agg(a.attname ORDER BY k.ordinality)
     FROM pg_index i
     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum,ordinality)
     JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
    WHERE i.indrelid='core_action_evaluator_receipts'::regclass AND i.indisprimary)
    = ARRAY['tenant_id','action_type','idempotency_key_digest']::name[] AS receipt_primary_key_verified,
  (SELECT array_agg(a.attname ORDER BY k.ordinality)
     FROM pg_index i
     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum,ordinality)
     JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
    WHERE i.indrelid='core_action_evaluator_owner_approvals'::regclass AND i.indisprimary)
    = ARRAY['tenant_id','approval_hash']::name[] AS approval_primary_key_verified,
  (SELECT array_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull ORDER BY a.attnum)
     FROM pg_attribute a
    WHERE a.attrelid='core_action_evaluator_receipts'::regclass AND a.attnum>0 AND NOT a.attisdropped)
    = ARRAY[
      'tenant_id:character varying(120):true','action_type:character varying(160):true',
      'idempotency_key_digest:character(64):true','request_digest:character(64):true',
      'owner_subject_fingerprint:character varying(80):true','authorization_id:character varying(64):true',
      'authority_response:jsonb:true','response_digest:character(64):true','receipt:jsonb:true',
      'authorization_expires_at:timestamp with time zone:true','created_at:timestamp with time zone:true'
    ]::text[] AS receipt_columns_verified,
  (SELECT array_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull ORDER BY a.attnum)
     FROM pg_attribute a
    WHERE a.attrelid='core_action_evaluator_owner_approvals'::regclass AND a.attnum>0 AND NOT a.attisdropped)
    = ARRAY[
      'tenant_id:character varying(120):true','approval_hash:character varying(80):true',
      'expires_at:timestamp with time zone:true','consumed_at:timestamp with time zone:true'
    ]::text[] AS approval_columns_verified,
  EXISTS (SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_am am ON am.oid=c.relam
    WHERE i.indrelid='core_action_evaluator_receipts'::regclass
      AND c.relname='core_action_evaluator_receipts_expiry_idx'
      AND am.amname='btree'
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND NOT i.indisprimary
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)
        = ARRAY['authorization_expires_at']::name[])
    AS expiry_index_verified,
  EXISTS (SELECT 1 FROM pg_proc p
    JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid='core_action_evaluator_deny_mutation()'::regprocedure
      AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql'
      AND p.provolatile='v' AND NOT p.prosecdef AND p.proconfig IS NULL
      AND p.prosrc=$body$
BEGIN
  RAISE EXCEPTION 'core_action_evaluator_append_only_violation'
    USING ERRCODE = '55000';
END;
$body$) AS deny_mutation_function_verified,
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='core_action_evaluator_receipts'::regclass
    AND t.tgname='core_action_evaluator_receipts_append_only' AND t.tgenabled='O'
    AND NOT t.tgisinternal AND t.tgtype=27
    AND t.tgfoid='core_action_evaluator_deny_mutation()'::regprocedure)
    AS receipt_append_only_verified,
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='core_action_evaluator_owner_approvals'::regclass
    AND t.tgname='core_action_evaluator_owner_approvals_append_only' AND t.tgenabled='O'
    AND NOT t.tgisinternal AND t.tgtype=27
    AND t.tgfoid='core_action_evaluator_deny_mutation()'::regprocedure)
    AS approval_append_only_verified,
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='core_action_evaluator_schema_manifest'::regclass
    AND t.tgname='core_action_evaluator_schema_manifest_append_only' AND t.tgenabled='O'
    AND NOT t.tgisinternal AND t.tgtype=27
    AND t.tgfoid='core_action_evaluator_deny_mutation()'::regprocedure)
    AS manifest_append_only_verified,
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='core_action_evaluator_receipts'::regclass
    AND t.tgname='core_action_evaluator_receipts_truncate_guard' AND t.tgenabled='O'
    AND NOT t.tgisinternal AND t.tgtype=34
    AND t.tgfoid='core_action_evaluator_deny_mutation()'::regprocedure)
    AS receipt_truncate_guard_verified,
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='core_action_evaluator_owner_approvals'::regclass
    AND t.tgname='core_action_evaluator_owner_approvals_truncate_guard' AND t.tgenabled='O'
    AND NOT t.tgisinternal AND t.tgtype=34
    AND t.tgfoid='core_action_evaluator_deny_mutation()'::regprocedure)
    AS approval_truncate_guard_verified,
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='core_action_evaluator_schema_manifest'::regclass
    AND t.tgname='core_action_evaluator_schema_manifest_truncate_guard' AND t.tgenabled='O'
    AND NOT t.tgisinternal AND t.tgtype=34
    AND t.tgfoid='core_action_evaluator_deny_mutation()'::regprocedure)
    AS manifest_truncate_guard_verified
FROM core_action_evaluator_schema_manifest m
WHERE m.component='core_action_evaluator_idempotency'`;

function verifiedSchemaStatus(row) {
  const verified = row?.schema_version === ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION &&
    String(row?.schema_digest || "").trim() === ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST &&
    row?.append_only === true && row?.receipt_primary_key_verified === true &&
    row?.approval_primary_key_verified === true && row?.receipt_columns_verified === true &&
    row?.approval_columns_verified === true && row?.expiry_index_verified === true &&
    row?.deny_mutation_function_verified === true &&
    row?.receipt_append_only_verified === true && row?.approval_append_only_verified === true &&
    row?.manifest_append_only_verified === true && row?.receipt_truncate_guard_verified === true &&
    row?.approval_truncate_guard_verified === true && row?.manifest_truncate_guard_verified === true;
  if (!verified) fail("core_action_idempotency_schema_unverified", 503);
  return Object.freeze({
    schema_version: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
    schema_digest: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST,
    schema_verified: true,
    append_only_enforced: true,
  });
}

export function createPostgresActionEvaluatorIdempotencyStore({ pool } = {}) {
  if (!pool?.query || !pool?.connect) fail("core_action_idempotency_store_invalid");
  let initialization;
  let schemaInstalled = false;
  let schemaStatus = null;
  let schemaVerifiedAt = 0;
  const verificationTtlMilliseconds = 30_000;
  const initialize = ({ forceVerification = false } = {}) => {
    if (!forceVerification && schemaStatus &&
        Date.now() - schemaVerifiedAt < verificationTtlMilliseconds) {
      return Promise.resolve(schemaStatus);
    }
    initialization ||= Promise.resolve().then(async () => {
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        // Initialization/readback must never wait indefinitely behind a DDL
        // lock. These are DB-enforced deadlines, so a timed-out HTTP health
        // probe cannot leave an unbounded schema query running.
        await client.query("SET LOCAL lock_timeout='1s'");
        await client.query("SET LOCAL statement_timeout='5s'");
        if (!schemaInstalled) await client.query(POSTGRES_SCHEMA);
        const verification = await client.query(POSTGRES_SCHEMA_VERIFICATION);
        const status = verifiedSchemaStatus(verification.rows?.[0]);
        await client.query("COMMIT");
        transactionOpen = false;
        schemaInstalled = true;
        schemaStatus = status;
        schemaVerifiedAt = Date.now();
        return status;
      } catch (error) {
        if (transactionOpen) {
          try { await client.query("ROLLBACK"); } catch {}
        }
        throw error;
      } finally {
        client.release();
      }
    }).catch((error) => {
      initialization = null;
      const code = error?.code === "core_action_idempotency_schema_unverified"
        ? error.code : "core_action_idempotency_store_unavailable";
      const wrapped = new Error(code, { cause: error });
      wrapped.code = wrapped.message;
      wrapped.status = 503;
      throw wrapped;
    }).finally(() => {
      initialization = null;
    });
    return initialization;
  };
  return Object.freeze({
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    schema_version: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
    schema_digest: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST,
    initialize,
    async begin(input = {}) {
      const request = normalize(input);
      // At-most-once execution depends on the append-only guards being live at
      // the moment of use, not merely at process startup.
      await initialize({ forceVerification: true });
      const client = await pool.connect();
      let closed = false;
      const close = () => { if (!closed) { closed = true; client.release(); } };
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query("SET LOCAL statement_timeout='30s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [request.scope]);
        const priorResult = await client.query(
          `SELECT request_digest,owner_subject_fingerprint,authorization_id,authority_response,
                  response_digest,receipt,authorization_expires_at
             FROM core_action_evaluator_receipts
            WHERE tenant_id=$1 AND action_type=$2 AND idempotency_key_digest=$3 FOR UPDATE`,
          [request.tenantId, request.actionType, request.idempotencyKeyDigest],
        );
        const databaseNow = new Date((await client.query("SELECT clock_timestamp() AS now")).rows[0].now);
        if (priorResult.rows[0]) {
          const prior = validatePrior(priorResult.rows[0], request, databaseNow.getTime());
          await client.query("COMMIT");
          close();
          return Object.freeze({
            replayed: true,
            authority_response: prior.authority_response,
            receipt: prior.receipt,
            attempt_receipt: attemptReceipt(prior.receipt, true, databaseNow.toISOString()),
          });
        }
        if (Date.parse(request.approvalExpiresAt) <= databaseNow.getTime()) {
          fail("core_action_idempotency_expired", 409);
        }
        const consumed = await client.query(
          `INSERT INTO core_action_evaluator_owner_approvals(tenant_id,approval_hash,expires_at)
           SELECT $1,$2,$3::timestamptz WHERE $3::timestamptz>clock_timestamp()
           ON CONFLICT (tenant_id,approval_hash) DO NOTHING RETURNING tenant_id`,
          [request.tenantId, request.approvalHash, request.approvalExpiresAt],
        );
        if (!consumed.rows[0]) fail("owner_confirmation_replayed", 409);
        const rollback = async () => {
          if (closed) return;
          try { await client.query("ROLLBACK"); } finally { close(); }
        };
        return Object.freeze({
          replayed: false,
          async commit(response) {
            if (closed) fail("core_action_idempotency_session_closed");
            try {
              const issuedAt = new Date((await client.query("SELECT clock_timestamp() AS now")).rows[0].now).toISOString();
              if (Date.parse(issuedAt) >= Date.parse(request.authorizationExpiresAt)) {
                fail("core_action_idempotency_expired", 409);
              }
              const record = materializeRecord(request, response, issuedAt);
              await client.query(
                `INSERT INTO core_action_evaluator_receipts
                   (tenant_id,action_type,idempotency_key_digest,request_digest,owner_subject_fingerprint,
                    authorization_id,authority_response,response_digest,receipt,authorization_expires_at,created_at)
                 VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11)`,
                [request.tenantId, request.actionType, request.idempotencyKeyDigest, request.requestDigest,
                  request.ownerSubjectFingerprint, record.authorizationId,
                  JSON.stringify(record.authorityResponse), record.responseDigest,
                  JSON.stringify(record.receipt), request.authorizationExpiresAt, issuedAt],
              );
              await client.query("COMMIT");
              close();
              return Object.freeze({
                replayed: false,
                authority_response: record.authorityResponse,
                receipt: record.receipt,
                attempt_receipt: attemptReceipt(record.receipt, false, issuedAt),
              });
            } catch (error) {
              await rollback();
              throw error;
            }
          },
          rollback,
        });
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        close();
        throw error;
      }
    },
  });
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { fs.linkSync(temporary, file); } finally { try { fs.unlinkSync(temporary); } catch {} }
}

export function createFileActionEvaluatorIdempotencyStore({ root, now = Date.now } = {}) {
  const storeRoot = path.resolve(text(root, "core_action_idempotency_store_invalid", 4_000));
  const locks = new Map();
  const acquire = async (key) => {
    const prior = locks.get(key) || Promise.resolve();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    locks.set(key, prior.then(() => held));
    await prior;
    return release;
  };
  const recordFile = (request) => path.join(
    storeRoot,
    actionEvaluatorDigest(request.tenantId),
    actionEvaluatorDigest(request.actionType),
    `${request.idempotencyKeyDigest}.json`,
  );
  const approvalFile = (request) => path.join(
    storeRoot,
    "owner-approvals",
    actionEvaluatorDigest(request.tenantId),
    `${actionEvaluatorDigest(request.approvalHash)}.json`,
  );
  const read = (file) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  };
  return Object.freeze({
    kind: "file_atomic",
    restart_durable: true,
    distributed: false,
    schema_version: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
    schema_digest: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST,
    async initialize() {
      fs.mkdirSync(storeRoot, { recursive: true, mode: 0o700 });
      return Object.freeze({
        schema_version: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
        schema_digest: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST,
        schema_verified: true,
        append_only_enforced: false,
      });
    },
    async begin(input = {}) {
      const request = normalize(input);
      const release = await acquire(request.scope);
      const file = recordFile(request);
      let approval = null;
      let closed = false;
      const close = () => { if (!closed) { closed = true; release(); } };
      try {
        const priorRow = read(file);
        const attemptedAt = new Date(now()).toISOString();
        if (priorRow) {
          const prior = validatePrior(priorRow, request, Date.parse(attemptedAt));
          close();
          return Object.freeze({ replayed: true, ...prior,
            attempt_receipt: attemptReceipt(prior.receipt, true, attemptedAt) });
        }
        if (Date.parse(request.approvalExpiresAt) <= Date.parse(attemptedAt)) {
          fail("core_action_idempotency_expired", 409);
        }
        approval = approvalFile(request);
        try { atomicWrite(approval, { expires_at: request.approvalExpiresAt }); }
        catch (error) { if (error?.code === "EEXIST") fail("owner_confirmation_replayed", 409); throw error; }
        const rollback = async () => {
          if (closed) return;
          try { if (approval) fs.unlinkSync(approval); } catch {}
          close();
        };
        return Object.freeze({
          replayed: false,
          async commit(response) {
            try {
              const issuedAt = new Date(now()).toISOString();
              const record = materializeRecord(request, response, issuedAt);
              atomicWrite(file, {
                request_digest: request.requestDigest,
                owner_subject_fingerprint: request.ownerSubjectFingerprint,
                authorization_id: record.authorizationId,
                authority_response: record.authorityResponse,
                response_digest: record.responseDigest,
                receipt: record.receipt,
                authorization_expires_at: request.authorizationExpiresAt,
              });
              close();
              return Object.freeze({ replayed: false, authority_response: record.authorityResponse,
                receipt: record.receipt, attempt_receipt: attemptReceipt(record.receipt, false, issuedAt) });
            } catch (error) { await rollback(); throw error; }
          },
          rollback,
        });
      } catch (error) { close(); throw error; }
    },
  });
}

export function createUnavailableActionEvaluatorIdempotencyStore() {
  return Object.freeze({
    kind: "unavailable",
    restart_durable: false,
    distributed: false,
    schema_version: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
    schema_digest: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST,
    async initialize() { fail("core_action_idempotency_store_unavailable", 503); },
    async begin() { fail("core_action_idempotency_store_unavailable", 503); },
  });
}

export {
  POSTGRES_SCHEMA as ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA,
  POSTGRES_SCHEMA_VERIFICATION as ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERIFICATION,
};
