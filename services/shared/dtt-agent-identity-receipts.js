import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createRetryablePostgresInitializer } from "./retryable-postgres-initializer.js";

const CONTEXT_VERSION = "dtt_agent_context_v2";
const RECEIPT_VERSION = "dtt_agent_identity_receipt_v2";
const CONTEXT_DOMAIN = "dtt-agent-context-v2";
const RECEIPT_DOMAIN = "dtt-agent-receipt-v2";
const CAUSAL_IDENTITY_VERSION = "causal_agent_identity_context_v1";
const CAUSAL_IDENTITY_DOMAIN = "causal-agent-identity-context-v1";
const WORK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTEXT_KEYS = Object.freeze([
  "actor_provenance",
  "agent_id",
  "client_type",
  "execution_authorized",
  "expires_at_ms",
  "host_transport_session_fingerprint",
  "issued_at_ms",
  "nonce",
  "opaque_agent_id",
  "presence_signature",
  "schema_version",
  "session_fingerprint",
  "session_id",
  "tenant_id",
  "work_id",
]);
const RECEIPT_KEYS = Object.freeze([
  "actor_provenance",
  "assignment_id",
  "client_type",
  "decision",
  "evidence_digest",
  "execution_authorized",
  "expires_at_ms",
  "host_transport_session_fingerprint",
  "issued_at_ms",
  "key_id",
  "node_id",
  "opaque_agent_id",
  "presence_signature",
  "rationale",
  "receipt_id",
  "schema_version",
  "session_fingerprint",
  "session_id",
  "tenant_id",
  "tree_id",
  "verifier_id",
  "work_id",
]);
const CAUSAL_IDENTITY_KEYS = Object.freeze([
  "actor_provenance",
  "agent_id",
  "client_type",
  "execution_authorized",
  "expires_at_ms",
  "host_transport_session_fingerprint",
  "issued_at_ms",
  "nonce",
  "opaque_agent_id",
  "presence_signature",
  "schema_version",
  "session_fingerprint",
  "session_id",
  "tenant_id",
]);

function text(value, field, max = 500) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function workId(value) {
  const normalized = text(value, "work_id", 36).toLowerCase();
  if (!WORK_ID_PATTERN.test(normalized)) throw new Error("work_id_invalid");
  return normalized;
}

function normalizePrincipal(value, { signatureAlias = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("dtt_agent_context_principal_required");
  }
  return {
    agent_id: text(value.agent_id, "agent_id", 160),
    session_id: text(value.session_id, "session_id", 160),
    session_fingerprint: text(value.session_fingerprint, "session_fingerprint", 160),
    host_transport_session_fingerprint: text(
      value.host_transport_session_fingerprint,
      "host_transport_session_fingerprint",
      160,
    ),
    presence_signature: text(
      signatureAlias ? value.signature : value.presence_signature,
      "presence_signature",
      200,
    ),
    opaque_agent_id: text(value.opaque_agent_id, "opaque_agent_id", 160),
    actor_provenance: text(value.actor_provenance, "actor_provenance", 160),
    client_type: text(value.client_type, "client_type", 64),
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) throw new Error(code);
  return value;
}

function normalizeReceiptScope({ receipt_id, tenant_id, work_id, tree_id, node_id } = {}) {
  return {
    receipt_id: text(receipt_id, "receipt_id", 80),
    tenant_id: text(tenant_id, "tenant_id", 120),
    work_id: workId(work_id),
    tree_id: text(tree_id, "tree_id", 160),
    node_id: text(node_id, "node_id", 120),
  };
}

function receiptScopeKey(scope) {
  return crypto.createHash("sha256").update(canonicalJson({
    tenant_id: scope.tenant_id,
    work_id: scope.work_id,
    tree_id: scope.tree_id,
    node_id: scope.node_id,
  })).digest("hex");
}

function assignmentMatches(assignment, expected) {
  if (!assignment || assignment.verified !== true || assignment.execution_authorized !== false) return false;
  return [
    "assignment_id",
    "tenant_id",
    "work_id",
    "tree_id",
    "node_id",
    "verifier_id",
    "session_id",
    "session_fingerprint",
    "host_transport_session_fingerprint",
    "presence_signature",
    "client_type",
    "opaque_agent_id",
    "actor_provenance",
  ].every((field) => assignment[field] === expected[field]);
}

function signingSecret(value) {
  const secret = String(value || "").trim();
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("dtt_agent_identity_secret_unavailable");
  return secret;
}

function hmac(secret, domain, encoded) {
  return crypto.createHmac("sha256", secret).update(`${domain}\u0000${encoded}`).digest("hex");
}

function encodeToken(prefix, secret, domain, payload) {
  const encoded = Buffer.from(canonicalJson(payload)).toString("base64url");
  return `${prefix}_${encoded}.${hmac(secret, domain, encoded)}`;
}

function decodeToken(token, prefix, secret, domain) {
  const raw = text(token, `${prefix}_token`, 4_000);
  const separator = raw.lastIndexOf(".");
  if (!raw.startsWith(`${prefix}_`) || separator < prefix.length + 2) throw new Error(`${prefix}_invalid`);
  const encoded = raw.slice(prefix.length + 1, separator);
  const supplied = raw.slice(separator + 1);
  const expected = hmac(secret, domain, encoded);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw new Error(`${prefix}_signature_invalid`);
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const canonicalEncoded = Buffer.from(canonicalJson(payload)).toString("base64url");
    if (encoded !== canonicalEncoded) throw new Error(`${prefix}_payload_noncanonical`);
    return payload;
  } catch {
    throw new Error(`${prefix}_payload_invalid`);
  }
}

export function issueDttAgentContext({
  secret,
  tenant_id,
  work_id,
  agent_presence,
  now_ms = Date.now(),
  ttl_ms = 120_000,
  random_bytes = crypto.randomBytes,
} = {}) {
  const key = signingSecret(secret);
  const issuedAt = Number(now_ms);
  const ttl = Math.min(Math.max(Number(ttl_ms), 5_000), 300_000);
  const principal = normalizePrincipal(agent_presence, { signatureAlias: true });
  const payload = {
    schema_version: CONTEXT_VERSION,
    tenant_id: text(tenant_id, "tenant_id", 120),
    work_id: workId(work_id),
    ...principal,
    nonce: random_bytes(18).toString("hex"),
    issued_at_ms: issuedAt,
    expires_at_ms: issuedAt + ttl,
    execution_authorized: false,
  };
  return encodeToken("dac", key, CONTEXT_DOMAIN, payload);
}

// Causal project/change/obligation reads are not necessarily attached to a
// Work. Their transport still needs a cryptographically authenticated agent
// identity, but must not invent a Work merely to satisfy DTT's exact-Work
// contract. This separate token is identity-only, tenant-bound, short-lived,
// and can never authorize execution.
export function issueCausalAgentIdentityContext({
  secret,
  tenant_id,
  agent_presence,
  now_ms = Date.now(),
  ttl_ms = 120_000,
  random_bytes = crypto.randomBytes,
} = {}) {
  const key = signingSecret(secret);
  const issuedAt = Number(now_ms);
  const ttl = Math.min(Math.max(Number(ttl_ms), 5_000), 300_000);
  const principal = normalizePrincipal(agent_presence, { signatureAlias: true });
  return encodeToken("cai", key, CAUSAL_IDENTITY_DOMAIN, {
    schema_version: CAUSAL_IDENTITY_VERSION,
    tenant_id: text(tenant_id, "tenant_id", 120),
    ...principal,
    nonce: random_bytes(18).toString("hex"),
    issued_at_ms: issuedAt,
    expires_at_ms: issuedAt + ttl,
    execution_authorized: false,
  });
}

export function verifyCausalAgentIdentityContext({
  context_token,
  secret,
  expected_tenant_id,
  now = () => Date.now(),
} = {}) {
  const key = signingSecret(secret);
  const payload = exactKeys(
    decodeToken(context_token, "cai", key, CAUSAL_IDENTITY_DOMAIN),
    CAUSAL_IDENTITY_KEYS,
    "causal_agent_identity_payload_invalid",
  );
  const current = Number(now());
  if (payload.schema_version !== CAUSAL_IDENTITY_VERSION) {
    throw new Error("causal_agent_identity_version_invalid");
  }
  if (payload.execution_authorized !== false) {
    throw new Error("causal_agent_identity_execution_invalid");
  }
  if (payload.tenant_id !== text(expected_tenant_id, "tenant_id", 120)) {
    throw new Error("causal_agent_identity_tenant_mismatch");
  }
  if (!Number.isSafeInteger(payload.issued_at_ms) || !Number.isSafeInteger(payload.expires_at_ms)
      || payload.issued_at_ms > current + 5_000 || payload.expires_at_ms <= current
      || payload.expires_at_ms <= payload.issued_at_ms) {
    throw new Error("causal_agent_identity_expired");
  }
  normalizePrincipal(payload);
  if (!/^[0-9a-f]{36}$/.test(String(payload.nonce || ""))) {
    throw new Error("causal_agent_identity_nonce_invalid");
  }
  return Object.freeze(structuredClone(payload));
}

function validatedContextPayload({ contextToken, secret, expectedTenantId, expectedWorkId, expectedPrincipal, now }) {
  const payload = exactKeys(
    decodeToken(contextToken, "dac", secret, CONTEXT_DOMAIN),
    CONTEXT_KEYS,
    "dtt_agent_context_payload_invalid",
  );
  const current = Number(now());
  if (payload.schema_version !== CONTEXT_VERSION) throw new Error("dtt_agent_context_version_invalid");
  if (payload.execution_authorized !== false) throw new Error("dtt_agent_context_execution_invalid");
  if (payload.tenant_id !== text(expectedTenantId, "tenant_id", 120)) throw new Error("dtt_agent_context_tenant_mismatch");
  if (payload.work_id !== workId(expectedWorkId)) throw new Error("dtt_agent_context_work_mismatch");
  if (!Number.isSafeInteger(payload.issued_at_ms) || !Number.isSafeInteger(payload.expires_at_ms)
    || payload.issued_at_ms > current + 5_000 || payload.expires_at_ms <= current
    || payload.expires_at_ms <= payload.issued_at_ms) {
    throw new Error("dtt_agent_context_expired");
  }
  const principal = normalizePrincipal(payload);
  const expected = normalizePrincipal(expectedPrincipal);
  if (Object.keys(expected).some((field) => principal[field] !== expected[field])) {
    throw new Error("dtt_agent_context_principal_mismatch");
  }
  if (!/^[0-9a-f]{36}$/.test(String(payload.nonce || ""))) throw new Error("dtt_agent_context_nonce_invalid");
  return Object.freeze(structuredClone(payload));
}

function buildReceiptPayload({
  keyId,
  receiptId,
  tenant_id,
  work_id,
  tree_id,
  node_id,
  evidence_digest,
  decision,
  rationale,
  assignment_id,
  context,
  issuedAt,
  receiptTtlMs,
}) {
  return {
    schema_version: RECEIPT_VERSION,
    key_id: keyId,
    receipt_id: receiptId,
    tenant_id: text(tenant_id, "tenant_id", 120),
    work_id: workId(work_id),
    tree_id: text(tree_id, "tree_id", 160),
    node_id: text(node_id, "node_id", 120),
    evidence_digest: text(evidence_digest, "evidence_digest", 100),
    decision: text(decision, "decision", 32),
    rationale: text(rationale, "rationale", 1_000),
    assignment_id: text(assignment_id, "assignment_id", 160),
    actor_provenance: context.actor_provenance,
    client_type: context.client_type,
    host_transport_session_fingerprint: context.host_transport_session_fingerprint,
    opaque_agent_id: context.opaque_agent_id,
    presence_signature: context.presence_signature,
    verifier_id: context.agent_id,
    session_fingerprint: context.session_fingerprint,
    session_id: context.session_id,
    issued_at_ms: issuedAt,
    expires_at_ms: issuedAt + Math.min(Math.max(Number(receiptTtlMs), 30_000), 900_000),
    execution_authorized: false,
  };
}

function receiptPayload(identityReceipt, key) {
  return exactKeys(
    decodeToken(identityReceipt, "dair", key, RECEIPT_DOMAIN),
    RECEIPT_KEYS,
    "dair_payload_invalid",
  );
}

function storedReceiptMatches(stored, payload, identityReceipt) {
  if (!stored || stored.receipt !== identityReceipt) return false;
  return [
    "schema_version",
    "receipt_id",
    "tenant_id",
    "work_id",
    "tree_id",
    "node_id",
    "evidence_digest",
    "verifier_id",
    "assignment_id",
    "client_type",
    "session_fingerprint",
    "session_id",
    "host_transport_session_fingerprint",
    "presence_signature",
    "actor_provenance",
    "opaque_agent_id",
    "decision",
    "rationale",
    "execution_authorized",
  ].every((field) => stored[field] === payload[field]);
}

function validateReceiptPayload({ payload, keyId, expected, stored, identityReceipt, now }) {
  if (!storedReceiptMatches(stored, payload, identityReceipt)) return { verified: false };
  if (payload.schema_version !== RECEIPT_VERSION || payload.key_id !== keyId
    || payload.execution_authorized !== false) return { verified: false };
  const current = Number(now());
  if (!Number.isSafeInteger(payload.issued_at_ms) || !Number.isSafeInteger(payload.expires_at_ms)
    || payload.issued_at_ms > current + 5_000 || payload.expires_at_ms <= current
    || payload.expires_at_ms <= payload.issued_at_ms) return { verified: false };
  if (Object.entries(expected).some(([field, value]) => payload[field] !== value)) return { verified: false };
  return {
    verified: true,
    tenant_id: payload.tenant_id,
    work_id: payload.work_id,
    tree_id: payload.tree_id,
    node_id: payload.node_id,
    verifier_id: payload.verifier_id,
    evidence_digest: payload.evidence_digest,
    receipt_id: payload.receipt_id,
    session_fingerprint: payload.session_fingerprint,
    assignment_id: payload.assignment_id,
    independence_key: payload.actor_provenance,
    execution_authorized: false,
  };
}

export function createDttAgentIdentityReceiptService({
  secret,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  receipt_ttl_ms = 300_000,
  store,
  resolve_assignment,
} = {}) {
  const key = signingSecret(secret);
  const keyId = `dik_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
  if (!store || typeof store.consumeContext !== "function" || typeof store.putReceipt !== "function"
    || typeof store.getReceipt !== "function") throw new Error("dtt_agent_identity_store_unavailable");

  function verifyContext(contextToken, expectedTenantId, expectedWorkId, expectedPrincipal) {
    return validatedContextPayload({
      contextToken,
      secret: key,
      expectedTenantId,
      expectedWorkId,
      expectedPrincipal,
      now,
    });
  }

  function issue({
    context_token,
    tenant_id,
    work_id,
    tree_id,
    node_id,
    evidence_digest,
    decision,
    rationale,
    assignment_id,
    expected_principal,
  }) {
    const context = verifyContext(context_token, tenant_id, work_id, expected_principal);
    const boundTreeId = text(tree_id, "tree_id", 160);
    const boundNodeId = text(node_id, "node_id", 120);
    const boundAssignmentId = text(assignment_id, "assignment_id", 160);
    const assignmentInput = {
      assignment_id: boundAssignmentId,
      tenant_id: context.tenant_id,
      work_id: context.work_id,
      tree_id: boundTreeId,
      node_id: boundNodeId,
      verifier_id: context.agent_id,
      session_fingerprint: context.session_fingerprint,
      session_id: context.session_id,
      host_transport_session_fingerprint: context.host_transport_session_fingerprint,
      presence_signature: context.presence_signature,
      client_type: context.client_type,
      opaque_agent_id: context.opaque_agent_id,
      actor_provenance: context.actor_provenance,
    };
    const assignment = typeof resolve_assignment === "function" ? resolve_assignment(assignmentInput) : null;
    if (!assignmentMatches(assignment, assignmentInput)) {
      throw new Error("dtt_verifier_assignment_invalid");
    }
    const contextFingerprint = crypto.createHash("sha256").update(context_token).digest("hex");
    const issuedAt = Number(now());
    const receiptId = `dair_${randomBytes(18).toString("hex")}`;
    const payload = buildReceiptPayload({
      keyId,
      receiptId,
      tenant_id: context.tenant_id,
      work_id: context.work_id,
      tree_id: boundTreeId,
      node_id: boundNodeId,
      evidence_digest,
      decision,
      rationale,
      assignment_id: boundAssignmentId,
      context,
      issuedAt,
      receiptTtlMs: receipt_ttl_ms,
    });
    const receipt = encodeToken("dair", key, RECEIPT_DOMAIN, payload);
    if (typeof store.issueAtomic === "function") {
      if (!store.issueAtomic(contextFingerprint, context.expires_at_ms, receiptId, { ...payload, receipt })) {
        throw new Error("dtt_agent_context_replayed");
      }
    } else {
      if (!store.consumeContext(contextFingerprint, context.expires_at_ms, {
        tenant_id: payload.tenant_id,
        work_id: payload.work_id,
      })) throw new Error("dtt_agent_context_replayed");
      store.putReceipt(receiptId, { ...payload, receipt });
    }
    return {
      verifier_id: payload.verifier_id,
      identity_receipt: receipt,
      receipt_id: receiptId,
      assignment_id: payload.assignment_id,
      work_id: payload.work_id,
      execution_authorized: false,
    };
  }

  function validate({
    tenant_id,
    work_id,
    tree_id,
    node_id,
    evidence_digest,
    decision,
    rationale,
    verifier_id,
    assignment_id,
    identity_receipt,
  }) {
    const payload = receiptPayload(identity_receipt, key);
    const expected = {
      tenant_id: text(tenant_id, "tenant_id", 120),
      work_id: workId(work_id),
      tree_id: text(tree_id, "tree_id", 160),
      node_id: text(node_id, "node_id", 120),
      evidence_digest: text(evidence_digest, "evidence_digest", 100),
      decision: text(decision, "decision", 32),
      rationale: text(rationale, "rationale", 1_000),
      verifier_id: text(verifier_id, "verifier_id", 160),
      assignment_id: text(assignment_id, "assignment_id", 160),
    };
    const stored = store.getReceipt(normalizeReceiptScope({ receipt_id: payload.receipt_id, ...expected }));
    return validateReceiptPayload({ payload, keyId, expected, stored, identityReceipt: identity_receipt, now });
  }

  return {
    configured: true,
    issue,
    validate,
    verifyContext,
    size: () => store.size(),
  };
}

export function createInMemoryDttAgentIdentityReceiptStore() {
  const contexts = new Map();
  const receipts = new Map();
  const receiptIndex = new Map();
  return {
    issueAtomic(fingerprint, expiresAt, receiptId, record) {
      if (contexts.has(fingerprint)) return false;
      if (receipts.has(receiptId)) throw new Error("dtt_agent_identity_receipt_collision");
      const scope = normalizeReceiptScope({ ...record, receipt_id: receiptId });
      if (record.receipt_id !== receiptId || record.schema_version !== RECEIPT_VERSION
        || record.execution_authorized !== false) {
        throw new Error("dtt_agent_identity_receipt_v2_required");
      }
      contexts.set(fingerprint, {
        schema_version: CONTEXT_VERSION,
        tenant_id: scope.tenant_id,
        work_id: scope.work_id,
        expires_at_ms: Number(expiresAt),
      });
      receipts.set(receiptId, structuredClone(record));
      receiptIndex.set(`${receiptScopeKey(scope)}:${receiptId}`, true);
      return true;
    },
    consumeContext(fingerprint, expiresAt, scope = {}) {
      if (contexts.has(fingerprint)) return false;
      contexts.set(fingerprint, {
        schema_version: CONTEXT_VERSION,
        tenant_id: text(scope.tenant_id, "tenant_id", 120),
        work_id: workId(scope.work_id),
        expires_at_ms: Number(expiresAt),
      });
      return true;
    },
    putReceipt(receiptId, record) {
      const scope = normalizeReceiptScope({ ...record, receipt_id: receiptId });
      if (record.receipt_id !== receiptId || record.schema_version !== RECEIPT_VERSION
        || record.execution_authorized !== false) {
        throw new Error("dtt_agent_identity_receipt_v2_required");
      }
      if (receipts.has(receiptId)) throw new Error("dtt_agent_identity_receipt_collision");
      receipts.set(receiptId, structuredClone(record));
      receiptIndex.set(`${receiptScopeKey(scope)}:${receiptId}`, true);
    },
    getReceipt(input) {
      const scope = normalizeReceiptScope(input);
      if (!receiptIndex.has(`${receiptScopeKey(scope)}:${scope.receipt_id}`)) return null;
      const record = receipts.get(scope.receipt_id);
      if (!record || record.schema_version !== RECEIPT_VERSION || record.execution_authorized !== false
        || ["tenant_id", "work_id", "tree_id", "node_id"].some((field) => record[field] !== scope[field])) return null;
      return structuredClone(record);
    },
    size() { return receipts.size; },
  };
}

export function createPostgresDttAgentIdentityReceiptStore({ pool } = {}) {
  const databasePool = pool;
  if (!databasePool || typeof databasePool.query !== "function" || typeof databasePool.connect !== "function") {
    throw new Error("dtt_agent_identity_postgres_pool_required");
  }
  const initialize = createRetryablePostgresInitializer({
    pool: databasePool,
    sql: `
      CREATE TABLE IF NOT EXISTS dtt_agent_identity_contexts_v2 (
        context_fingerprint char(64) PRIMARY KEY,
        schema_version varchar(64) NOT NULL CHECK (schema_version = 'dtt_agent_context_v2'),
        tenant_id varchar(120) NOT NULL,
        work_id uuid NOT NULL,
        execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized IS FALSE),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS dtt_agent_identity_receipts_v2 (
        receipt_id varchar(80) PRIMARY KEY,
        schema_version varchar(64) NOT NULL CHECK (schema_version = 'dtt_agent_identity_receipt_v2'),
        key_id varchar(80) NOT NULL,
        tenant_id varchar(120) NOT NULL,
        work_id uuid NOT NULL,
        tree_id varchar(160) NOT NULL,
        node_id varchar(120) NOT NULL,
        evidence_digest varchar(100) NOT NULL,
        verifier_id varchar(160) NOT NULL,
        session_fingerprint varchar(160) NOT NULL,
        session_id varchar(160) NOT NULL,
        assignment_id varchar(160) NOT NULL,
        actor_provenance varchar(160) NOT NULL,
        opaque_agent_id varchar(160) NOT NULL,
        presence_signature varchar(200) NOT NULL,
        client_type varchar(64) NOT NULL,
        host_transport_session_fingerprint varchar(160) NOT NULL,
        decision varchar(32) NOT NULL,
        rationale text NOT NULL,
        receipt text NOT NULL,
        execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized IS FALSE),
        expires_at timestamptz NOT NULL,
        issued_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, work_id, tree_id, node_id, evidence_digest, verifier_id, session_fingerprint)
      );
      CREATE INDEX IF NOT EXISTS dtt_agent_identity_contexts_v2_work_scope_idx
        ON dtt_agent_identity_contexts_v2 (tenant_id, work_id, expires_at);
      CREATE INDEX IF NOT EXISTS dtt_agent_identity_receipts_v2_work_scope_idx
        ON dtt_agent_identity_receipts_v2 (tenant_id, work_id, tree_id, node_id, receipt_id);
    `,
  });
  return {
    async issueAtomic(fingerprint, expiresAt, receiptId, record) {
      await initialize();
      const scope = normalizeReceiptScope({ ...record, receipt_id: receiptId });
      if (record.receipt_id !== receiptId || record.schema_version !== RECEIPT_VERSION
        || record.execution_authorized !== false) {
        throw new Error("dtt_agent_identity_receipt_v2_required");
      }
      const client = await databasePool.connect();
      try {
        await client.query("BEGIN");
        const consumed = await client.query(
          `INSERT INTO dtt_agent_identity_contexts_v2
           (context_fingerprint,schema_version,tenant_id,work_id,expires_at)
           VALUES ($1,$2,$3,$4::uuid,to_timestamp($5/1000.0))
           ON CONFLICT DO NOTHING RETURNING context_fingerprint`,
          [fingerprint, CONTEXT_VERSION, scope.tenant_id, scope.work_id, Number(expiresAt)],
        );
        if (!consumed.rowCount) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query(
          `INSERT INTO dtt_agent_identity_receipts_v2
           (receipt_id,schema_version,key_id,tenant_id,work_id,tree_id,node_id,evidence_digest,
            verifier_id,session_fingerprint,session_id,assignment_id,actor_provenance,opaque_agent_id,
            presence_signature,client_type,host_transport_session_fingerprint,decision,rationale,
            receipt,execution_authorized,expires_at,issued_at)
           VALUES ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,to_timestamp($22/1000.0),to_timestamp($23/1000.0))`,
          [
            receiptId, RECEIPT_VERSION, record.key_id, scope.tenant_id, scope.work_id,
            scope.tree_id, scope.node_id, record.evidence_digest, record.verifier_id,
            record.session_fingerprint, record.session_id, record.assignment_id,
            record.actor_provenance, record.opaque_agent_id, record.presence_signature,
            record.client_type, record.host_transport_session_fingerprint, record.decision,
            record.rationale, record.receipt, false, Number(record.expires_at_ms),
            Number(record.issued_at_ms),
          ],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
    async getReceipt(input) {
      await initialize();
      const scope = normalizeReceiptScope(input);
      const result = await databasePool.query(
        `SELECT receipt_id,schema_version,key_id,tenant_id,work_id::text AS work_id,tree_id,node_id,
                evidence_digest,verifier_id,session_fingerprint,session_id,assignment_id,
                actor_provenance,opaque_agent_id,presence_signature,client_type,
                host_transport_session_fingerprint,decision,rationale,receipt,execution_authorized,
                (extract(epoch from expires_at)*1000)::bigint AS expires_at_ms,
                (extract(epoch from issued_at)*1000)::bigint AS issued_at_ms
         FROM dtt_agent_identity_receipts_v2
         WHERE receipt_id=$1 AND tenant_id=$2 AND work_id=$3::uuid AND tree_id=$4 AND node_id=$5
           AND schema_version=$6 AND execution_authorized IS FALSE`,
        [scope.receipt_id, scope.tenant_id, scope.work_id, scope.tree_id, scope.node_id, RECEIPT_VERSION],
      );
      if (!result.rows[0]) return null;
      return {
        ...result.rows[0],
        expires_at_ms: Number(result.rows[0].expires_at_ms),
        issued_at_ms: Number(result.rows[0].issued_at_ms),
      };
    },
    async size() {
      await initialize();
      const result = await databasePool.query(
        "SELECT count(*)::integer AS count FROM dtt_agent_identity_receipts_v2 WHERE expires_at>now() AND schema_version=$1 AND execution_authorized IS FALSE",
        [RECEIPT_VERSION],
      );
      return Number(result.rows[0]?.count || 0);
    },
    initialize,
  };
}

export function createAsyncDttAgentIdentityReceiptService({
  secret,
  store,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  receipt_ttl_ms = 300_000,
  resolve_assignment,
} = {}) {
  const key = signingSecret(secret);
  const keyId = `dik_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
  if (!store || typeof store.issueAtomic !== "function" || typeof store.getReceipt !== "function") {
    throw new Error("dtt_agent_identity_store_unavailable");
  }
  function verifyContext(contextToken, expectedTenantId, expectedWorkId, expectedPrincipal) {
    return validatedContextPayload({
      contextToken,
      secret: key,
      expectedTenantId,
      expectedWorkId,
      expectedPrincipal,
      now,
    });
  }
  return {
    configured: true,
    async issue({ context_token, tenant_id, work_id, tree_id, node_id, evidence_digest, decision, rationale, assignment_id, expected_principal }) {
      const context = verifyContext(context_token, tenant_id, work_id, expected_principal);
      const boundTreeId = text(tree_id, "tree_id", 160);
      const boundNodeId = text(node_id, "node_id", 120);
      const boundAssignmentId = text(assignment_id, "assignment_id", 160);
      const assignmentInput = {
        assignment_id: boundAssignmentId,
        tenant_id: context.tenant_id,
        work_id: context.work_id,
        tree_id: boundTreeId,
        node_id: boundNodeId,
        verifier_id: context.agent_id,
        session_fingerprint: context.session_fingerprint,
        session_id: context.session_id,
        host_transport_session_fingerprint: context.host_transport_session_fingerprint,
        presence_signature: context.presence_signature,
        client_type: context.client_type,
        opaque_agent_id: context.opaque_agent_id,
        actor_provenance: context.actor_provenance,
      };
      const assignment = typeof resolve_assignment === "function" ? await resolve_assignment(assignmentInput) : null;
      if (!assignmentMatches(assignment, assignmentInput)) {
        throw new Error("dtt_verifier_assignment_invalid");
      }
      const contextFingerprint = crypto.createHash("sha256").update(context_token).digest("hex");
      const issuedAt = Number(now());
      const receiptId = `dair_${randomBytes(18).toString("hex")}`;
      const payload = buildReceiptPayload({
        keyId,
        receiptId,
        tenant_id: context.tenant_id,
        work_id: context.work_id,
        tree_id: boundTreeId,
        node_id: boundNodeId,
        evidence_digest,
        decision,
        rationale,
        assignment_id: boundAssignmentId,
        context,
        issuedAt,
        receiptTtlMs: receipt_ttl_ms,
      });
      const receipt = encodeToken("dair", key, RECEIPT_DOMAIN, payload);
      const inserted = await store.issueAtomic(
        contextFingerprint, context.expires_at_ms, receiptId, { ...payload, receipt },
      );
      if (!inserted) throw new Error("dtt_agent_context_replayed");
      return {
        verifier_id: payload.verifier_id,
        identity_receipt: receipt,
        receipt_id: receiptId,
        assignment_id: payload.assignment_id,
        work_id: payload.work_id,
        execution_authorized: false,
      };
    },
    async validate({ tenant_id, work_id, tree_id, node_id, evidence_digest, decision, rationale, verifier_id, assignment_id, identity_receipt }) {
      const payload = receiptPayload(identity_receipt, key);
      const expected = {
        tenant_id: text(tenant_id, "tenant_id", 120),
        work_id: workId(work_id),
        tree_id: text(tree_id, "tree_id", 160),
        node_id: text(node_id, "node_id", 120),
        evidence_digest: text(evidence_digest, "evidence_digest", 100),
        decision: text(decision, "decision", 32),
        rationale: text(rationale, "rationale", 1_000),
        verifier_id: text(verifier_id, "verifier_id", 160),
        assignment_id: text(assignment_id, "assignment_id", 160),
      };
      const stored = await store.getReceipt(normalizeReceiptScope({ receipt_id: payload.receipt_id, ...expected }));
      return validateReceiptPayload({ payload, keyId, expected, stored, identityReceipt: identity_receipt, now });
    },
    verifyContext,
    size: () => store.size(),
  };
}

export function createFileDttAgentIdentityReceiptStore({ file_path } = {}) {
  const legacyFilePath = path.resolve(text(file_path, "dtt_agent_identity_store_path", 2_000));
  const parsedPath = path.parse(legacyFilePath);
  const extension = parsedPath.ext || ".json";
  const stem = parsedPath.name.endsWith(".v2") ? parsedPath.name : `${parsedPath.name}.v2`;
  const filePath = path.join(parsedPath.dir, `${stem}${extension}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        contexts: parsed?.contexts && typeof parsed.contexts === "object" ? parsed.contexts : {},
        receipts: parsed?.receipts && typeof parsed.receipts === "object" ? parsed.receipts : {},
        receipt_index: parsed?.receipt_index && typeof parsed.receipt_index === "object" ? parsed.receipt_index : {},
      };
    } catch (error) {
      if (error.code === "ENOENT") return { contexts: {}, receipts: {}, receipt_index: {} };
      throw new Error("dtt_agent_identity_store_corrupt");
    }
  }
  function write(state) {
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
  }
  function withLock(operation) {
    const lockPath = `${filePath}.lock`;
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("dtt_agent_identity_store_busy");
      throw error;
    }
    try {
      return operation();
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(lockPath);
    }
  }
  return {
    issueAtomic(fingerprint, expiresAt, receiptId, record) {
      return withLock(() => {
        const state = read();
        if (Object.hasOwn(state.contexts, fingerprint)) return false;
        if (Object.hasOwn(state.receipts, receiptId)) throw new Error("dtt_agent_identity_receipt_collision");
        const scope = normalizeReceiptScope({ ...record, receipt_id: receiptId });
        if (record.receipt_id !== receiptId || record.schema_version !== RECEIPT_VERSION
          || record.execution_authorized !== false) {
          throw new Error("dtt_agent_identity_receipt_v2_required");
        }
        state.contexts[fingerprint] = {
          schema_version: CONTEXT_VERSION,
          tenant_id: scope.tenant_id,
          work_id: scope.work_id,
          expires_at_ms: Number(expiresAt),
        };
        state.receipts[receiptId] = structuredClone(record);
        state.receipt_index[`${receiptScopeKey(scope)}:${receiptId}`] = true;
        write(state);
        return true;
      });
    },
    consumeContext(fingerprint, expiresAt, scope = {}) {
      return withLock(() => {
        const state = read();
        if (Object.hasOwn(state.contexts, fingerprint)) return false;
        state.contexts[fingerprint] = {
          schema_version: CONTEXT_VERSION,
          tenant_id: text(scope.tenant_id, "tenant_id", 120),
          work_id: workId(scope.work_id),
          expires_at_ms: Number(expiresAt),
        };
        write(state);
        return true;
      });
    },
    putReceipt(receiptId, record) {
      withLock(() => {
        const state = read();
        if (Object.hasOwn(state.receipts, receiptId)) throw new Error("dtt_agent_identity_receipt_collision");
        const scope = normalizeReceiptScope({ ...record, receipt_id: receiptId });
        if (record.receipt_id !== receiptId || record.schema_version !== RECEIPT_VERSION
          || record.execution_authorized !== false) {
          throw new Error("dtt_agent_identity_receipt_v2_required");
        }
        state.receipts[receiptId] = structuredClone(record);
        state.receipt_index[`${receiptScopeKey(scope)}:${receiptId}`] = true;
        write(state);
      });
    },
    getReceipt(input) {
      const scope = normalizeReceiptScope(input);
      const state = read();
      if (!Object.hasOwn(state.receipt_index, `${receiptScopeKey(scope)}:${scope.receipt_id}`)) return null;
      const record = state.receipts[scope.receipt_id];
      if (!record || record.schema_version !== RECEIPT_VERSION || record.execution_authorized !== false
        || ["tenant_id", "work_id", "tree_id", "node_id"].some((field) => record[field] !== scope[field])) return null;
      return structuredClone(record);
    },
    size() { return Object.keys(read().receipt_index).length; },
  };
}

export const DTT_AGENT_CONTEXT_VERSION = CONTEXT_VERSION;
export const DTT_AGENT_IDENTITY_RECEIPT_VERSION = RECEIPT_VERSION;
