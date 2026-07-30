import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CONTEXT_VERSION = "dtt_agent_context_v1";
const RECEIPT_VERSION = "dtt_agent_identity_receipt_v1";

function text(value, field, max = 500) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
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
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
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
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error(`${prefix}_payload_invalid`);
  }
}

export function issueDttAgentContext({
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
  const payload = {
    version: CONTEXT_VERSION,
    tenant_id: text(tenant_id, "tenant_id", 120),
    agent_id: text(agent_presence?.agent_id, "agent_id", 160),
    session_fingerprint: text(agent_presence?.session_fingerprint, "session_fingerprint", 160),
    presence_signature: text(agent_presence?.signature, "presence_signature", 200),
    opaque_agent_id: text(agent_presence?.opaque_agent_id, "opaque_agent_id", 160),
    actor_provenance: text(agent_presence?.actor_provenance, "actor_provenance", 160),
    client_type: text(agent_presence?.client_type, "client_type", 64),
    nonce: random_bytes(18).toString("hex"),
    issued_at_ms: issuedAt,
    expires_at_ms: issuedAt + ttl,
  };
  return encodeToken("dac", key, "dtt-agent-context", payload);
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

  function verifyContext(contextToken, expectedTenantId) {
    const payload = decodeToken(contextToken, "dac", key, "dtt-agent-context");
    const current = Number(now());
    if (payload.version !== CONTEXT_VERSION) throw new Error("dtt_agent_context_version_invalid");
    if (payload.tenant_id !== text(expectedTenantId, "tenant_id", 120)) throw new Error("dtt_agent_context_tenant_mismatch");
    if (!Number.isFinite(payload.issued_at_ms) || !Number.isFinite(payload.expires_at_ms)
      || payload.issued_at_ms > current + 5_000 || payload.expires_at_ms <= current) {
      throw new Error("dtt_agent_context_expired");
    }
    text(payload.agent_id, "agent_id", 160);
    text(payload.session_fingerprint, "session_fingerprint", 160);
    text(payload.presence_signature, "presence_signature", 200);
    return payload;
  }

  function issue({
    context_token,
    tenant_id,
    tree_id,
    node_id,
    evidence_digest,
    decision,
    rationale,
    assignment_id,
  }) {
    const context = verifyContext(context_token, tenant_id);
    const assignment = typeof resolve_assignment === "function" ? resolve_assignment({
      assignment_id,
      tenant_id,
      tree_id,
      node_id,
      verifier_id: context.agent_id,
      session_fingerprint: context.session_fingerprint,
      opaque_agent_id: context.opaque_agent_id,
      actor_provenance: context.actor_provenance,
    }) : null;
    if (!assignment || assignment.verified !== true) throw new Error("dtt_verifier_assignment_invalid");
    const contextFingerprint = crypto.createHash("sha256").update(context_token).digest("hex");
    const issuedAt = Number(now());
    const receiptId = `dair_${randomBytes(18).toString("hex")}`;
    const payload = {
      version: RECEIPT_VERSION,
      key_id: keyId,
      receipt_id: receiptId,
      tenant_id: text(tenant_id, "tenant_id", 120),
      tree_id: text(tree_id, "tree_id", 160),
      node_id: text(node_id, "node_id", 120),
      evidence_digest: text(evidence_digest, "evidence_digest", 100),
      decision: text(decision, "decision", 32),
      rationale: text(rationale, "rationale", 1_000),
      assignment_id: text(assignment_id, "assignment_id", 160),
      actor_provenance: context.actor_provenance,
      opaque_agent_id: context.opaque_agent_id,
      verifier_id: context.agent_id,
      session_fingerprint: context.session_fingerprint,
      issued_at_ms: issuedAt,
      expires_at_ms: issuedAt + Math.min(Math.max(Number(receipt_ttl_ms), 30_000), 900_000),
    };
    const receipt = encodeToken("dair", key, "dtt-agent-receipt", payload);
    if (typeof store.issueAtomic === "function") {
      if (!store.issueAtomic(contextFingerprint, context.expires_at_ms, receiptId, { ...payload, receipt })) {
        throw new Error("dtt_agent_context_replayed");
      }
    } else {
      if (!store.consumeContext(contextFingerprint, context.expires_at_ms)) throw new Error("dtt_agent_context_replayed");
      store.putReceipt(receiptId, { ...payload, receipt });
    }
    return {
      verifier_id: payload.verifier_id,
      identity_receipt: receipt,
      receipt_id: receiptId,
      assignment_id: payload.assignment_id,
    };
  }

  function validate({
    tenant_id,
    tree_id,
    node_id,
    evidence_digest,
    decision,
    rationale,
    verifier_id,
    identity_receipt,
  }) {
    const payload = decodeToken(identity_receipt, "dair", key, "dtt-agent-receipt");
    const stored = store.getReceipt(payload.receipt_id);
    if (!stored || stored.receipt !== identity_receipt) return { verified: false };
    if (payload.version !== RECEIPT_VERSION || payload.key_id !== keyId) return { verified: false };
    const current = Number(now());
    if (
      !Number.isFinite(payload.issued_at_ms)
      || !Number.isFinite(payload.expires_at_ms)
      || payload.issued_at_ms > current + 5_000
      || payload.expires_at_ms <= current
    ) return { verified: false };
    const expected = {
      tenant_id: text(tenant_id, "tenant_id", 120),
      tree_id: text(tree_id, "tree_id", 160),
      node_id: text(node_id, "node_id", 120),
      evidence_digest: text(evidence_digest, "evidence_digest", 100),
      decision: text(decision, "decision", 32),
      rationale: text(rationale, "rationale", 1_000),
      verifier_id: text(verifier_id, "verifier_id", 160),
    };
    if (Object.entries(expected).some(([field, value]) => payload[field] !== value)) return { verified: false };
    return {
      verified: true,
      receipt_id: payload.receipt_id,
      session_fingerprint: payload.session_fingerprint,
      assignment_id: payload.assignment_id,
      // Independence is principal-bound, not session-bound: one OAuth/service
      // actor cannot manufacture quorum by opening multiple sessions or aliases.
      independence_key: payload.actor_provenance,
      issued_at_ms: payload.issued_at_ms,
      expires_at_ms: payload.expires_at_ms,
    };
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
  return {
    issueAtomic(fingerprint, expiresAt, receiptId, record) {
      if (contexts.has(fingerprint)) return false;
      if (receipts.has(receiptId)) throw new Error("dtt_agent_identity_receipt_collision");
      contexts.set(fingerprint, expiresAt);
      receipts.set(receiptId, structuredClone(record));
      return true;
    },
    consumeContext(fingerprint, expiresAt) {
      if (contexts.has(fingerprint)) return false;
      contexts.set(fingerprint, expiresAt);
      return true;
    },
    putReceipt(receiptId, record) { receipts.set(receiptId, structuredClone(record)); },
    getReceipt(receiptId) { return receipts.has(receiptId) ? structuredClone(receipts.get(receiptId)) : null; },
    size() { return receipts.size; },
  };
}

export function createPostgresDttAgentIdentityReceiptStore({ pool } = {}) {
  const databasePool = pool;
  if (!databasePool || typeof databasePool.query !== "function" || typeof databasePool.connect !== "function") {
    throw new Error("dtt_agent_identity_postgres_pool_required");
  }
  let initialized;
  async function initialize() {
    if (!initialized) initialized = databasePool.query(`
      CREATE TABLE IF NOT EXISTS dtt_agent_identity_contexts (
        context_fingerprint char(64) PRIMARY KEY,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS dtt_agent_identity_receipts (
        receipt_id varchar(80) PRIMARY KEY,
        tenant_id varchar(120) NOT NULL,
        tree_id varchar(160) NOT NULL,
        node_id varchar(120) NOT NULL,
        evidence_digest varchar(100) NOT NULL,
        verifier_id varchar(160) NOT NULL,
        session_fingerprint varchar(160) NOT NULL,
        decision varchar(32) NOT NULL,
        rationale text NOT NULL,
        receipt text NOT NULL,
        expires_at timestamptz NOT NULL,
        issued_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, tree_id, node_id, evidence_digest, verifier_id, session_fingerprint)
      );
      CREATE INDEX IF NOT EXISTS dtt_agent_identity_receipts_scope_idx
        ON dtt_agent_identity_receipts (tenant_id, tree_id, node_id, expires_at);
    `);
    return initialized;
  }
  return {
    async issueAtomic(fingerprint, expiresAt, receiptId, record) {
      await initialize();
      const client = await databasePool.connect();
      try {
        await client.query("BEGIN");
        const consumed = await client.query(
          "INSERT INTO dtt_agent_identity_contexts (context_fingerprint,expires_at) VALUES ($1,to_timestamp($2/1000.0)) ON CONFLICT DO NOTHING RETURNING context_fingerprint",
          [fingerprint, Number(expiresAt)],
        );
        if (!consumed.rowCount) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query(
          `INSERT INTO dtt_agent_identity_receipts
           (receipt_id,tenant_id,tree_id,node_id,evidence_digest,verifier_id,session_fingerprint,decision,rationale,receipt,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11/1000.0))`,
          [
            receiptId, record.tenant_id, record.tree_id, record.node_id, record.evidence_digest,
            record.verifier_id, record.session_fingerprint, record.decision, record.rationale,
            record.receipt, Number(record.expires_at_ms),
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
    async getReceipt(receiptId) {
      await initialize();
      const result = await databasePool.query(
        `SELECT receipt_id,tenant_id,tree_id,node_id,evidence_digest,verifier_id,session_fingerprint,
                decision,rationale,receipt,
                (extract(epoch from expires_at)*1000)::bigint AS expires_at_ms
         FROM dtt_agent_identity_receipts WHERE receipt_id=$1`,
        [receiptId],
      );
      if (!result.rows[0]) return null;
      return { ...result.rows[0], expires_at_ms: Number(result.rows[0].expires_at_ms), version: RECEIPT_VERSION };
    },
    async size() {
      await initialize();
      const result = await databasePool.query("SELECT count(*)::integer AS count FROM dtt_agent_identity_receipts WHERE expires_at>now()");
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
  function verifyContext(contextToken, expectedTenantId) {
    const payload = decodeToken(contextToken, "dac", key, "dtt-agent-context");
    const current = Number(now());
    if (payload.version !== CONTEXT_VERSION) throw new Error("dtt_agent_context_version_invalid");
    if (payload.tenant_id !== text(expectedTenantId, "tenant_id", 120)) throw new Error("dtt_agent_context_tenant_mismatch");
    if (!Number.isFinite(payload.issued_at_ms) || !Number.isFinite(payload.expires_at_ms)
      || payload.issued_at_ms > current + 5_000 || payload.expires_at_ms <= current) {
      throw new Error("dtt_agent_context_expired");
    }
    text(payload.agent_id, "agent_id", 160);
    text(payload.session_fingerprint, "session_fingerprint", 160);
    return payload;
  }
  return {
    configured: true,
    async issue({ context_token, tenant_id, tree_id, node_id, evidence_digest, decision, rationale, assignment_id }) {
      const context = verifyContext(context_token, tenant_id);
      const assignment = typeof resolve_assignment === "function" ? await resolve_assignment({
        assignment_id,
        tenant_id,
        tree_id,
        node_id,
        verifier_id: context.agent_id,
        session_fingerprint: context.session_fingerprint,
        opaque_agent_id: context.opaque_agent_id,
        actor_provenance: context.actor_provenance,
      }) : null;
      if (!assignment || assignment.verified !== true) throw new Error("dtt_verifier_assignment_invalid");
      const contextFingerprint = crypto.createHash("sha256").update(context_token).digest("hex");
      const issuedAt = Number(now());
      const receiptId = `dair_${randomBytes(18).toString("hex")}`;
      const payload = {
        version: RECEIPT_VERSION,
        key_id: keyId,
        receipt_id: receiptId,
        tenant_id: text(tenant_id, "tenant_id", 120),
        tree_id: text(tree_id, "tree_id", 160),
        node_id: text(node_id, "node_id", 120),
        evidence_digest: text(evidence_digest, "evidence_digest", 100),
        decision: text(decision, "decision", 32),
        rationale: text(rationale, "rationale", 1_000),
        assignment_id: text(assignment_id, "assignment_id", 160),
        actor_provenance: context.actor_provenance,
        opaque_agent_id: context.opaque_agent_id,
        verifier_id: context.agent_id,
        session_fingerprint: context.session_fingerprint,
        issued_at_ms: issuedAt,
        expires_at_ms: issuedAt + Math.min(Math.max(Number(receipt_ttl_ms), 30_000), 900_000),
      };
      const receipt = encodeToken("dair", key, "dtt-agent-receipt", payload);
      const inserted = await store.issueAtomic(
        contextFingerprint, context.expires_at_ms, receiptId, { ...payload, receipt },
      );
      if (!inserted) throw new Error("dtt_agent_context_replayed");
      return {
        verifier_id: payload.verifier_id,
        identity_receipt: receipt,
        receipt_id: receiptId,
        assignment_id: payload.assignment_id,
      };
    },
    async validate({ tenant_id, tree_id, node_id, evidence_digest, decision, rationale, verifier_id, identity_receipt }) {
      const payload = decodeToken(identity_receipt, "dair", key, "dtt-agent-receipt");
      const stored = await store.getReceipt(payload.receipt_id);
      if (!stored || stored.receipt !== identity_receipt || payload.version !== RECEIPT_VERSION
        || payload.key_id !== keyId) return { verified: false };
      const current = Number(now());
      if (
        !Number.isFinite(payload.issued_at_ms)
        || !Number.isFinite(payload.expires_at_ms)
        || payload.issued_at_ms > current + 5_000
        || payload.expires_at_ms <= current
      ) return { verified: false };
      const expected = {
        tenant_id: text(tenant_id, "tenant_id", 120),
        tree_id: text(tree_id, "tree_id", 160),
        node_id: text(node_id, "node_id", 120),
        evidence_digest: text(evidence_digest, "evidence_digest", 100),
        decision: text(decision, "decision", 32),
        rationale: text(rationale, "rationale", 1_000),
        verifier_id: text(verifier_id, "verifier_id", 160),
      };
      if (Object.entries(expected).some(([field, value]) => payload[field] !== value)) return { verified: false };
      return {
        verified: true,
        receipt_id: payload.receipt_id,
        session_fingerprint: payload.session_fingerprint,
        assignment_id: payload.assignment_id,
        // Distinct sessions owned by one actor are not independent verifiers.
        independence_key: payload.actor_provenance,
        issued_at_ms: payload.issued_at_ms,
        expires_at_ms: payload.expires_at_ms,
      };
    },
    verifyContext,
    size: () => store.size(),
  };
}

export function createFileDttAgentIdentityReceiptStore({ file_path } = {}) {
  const filePath = path.resolve(text(file_path, "dtt_agent_identity_store_path", 2_000));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        contexts: parsed?.contexts && typeof parsed.contexts === "object" ? parsed.contexts : {},
        receipts: parsed?.receipts && typeof parsed.receipts === "object" ? parsed.receipts : {},
      };
    } catch (error) {
      if (error.code === "ENOENT") return { contexts: {}, receipts: {} };
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
        state.contexts[fingerprint] = Number(expiresAt);
        state.receipts[receiptId] = structuredClone(record);
        write(state);
        return true;
      });
    },
    consumeContext(fingerprint, expiresAt) {
      return withLock(() => {
        const state = read();
        if (Object.hasOwn(state.contexts, fingerprint)) return false;
        state.contexts[fingerprint] = Number(expiresAt);
        write(state);
        return true;
      });
    },
    putReceipt(receiptId, record) {
      withLock(() => {
        const state = read();
        if (Object.hasOwn(state.receipts, receiptId)) throw new Error("dtt_agent_identity_receipt_collision");
        state.receipts[receiptId] = structuredClone(record);
        write(state);
      });
    },
    getReceipt(receiptId) {
      const record = read().receipts[receiptId];
      return record ? structuredClone(record) : null;
    },
    size() { return Object.keys(read().receipts).length; },
  };
}

export const DTT_AGENT_CONTEXT_VERSION = CONTEXT_VERSION;
export const DTT_AGENT_IDENTITY_RECEIPT_VERSION = RECEIPT_VERSION;
