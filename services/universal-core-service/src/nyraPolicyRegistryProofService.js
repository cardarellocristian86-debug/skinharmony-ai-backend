import crypto from "node:crypto";

const ATTESTATION_SCHEMA = "nyra_policy_activation_attestation_v1";
const RECEIPT_SCHEMA = "core_policy_activation_receipt_v1";
const ATTESTATION_CONTEXT = "nyra-policy-activation-attestation-v1\0";
const RECEIPT_CONTEXT = "core-policy-activation-receipt-v1\0";
const ACTIONS = new Set(["policy.snapshot.activate", "policy.snapshot.rollback", "policy.snapshot.reconcile"]);
const STORE_ACTION = Object.freeze({
  "policy.snapshot.activate": "activate_policy_snapshot",
  "policy.snapshot.rollback": "rollback_policy_snapshot",
  "policy.snapshot.reconcile": "reconcile_policy_snapshot",
});
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const SHA = /^[a-f0-9]{64}$/;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const bytes = (context, value) => Buffer.from(`${context}${canonical(value)}`, "utf8");
const digest = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");
function required(value, pattern, code) {
  const result = String(value || "").trim();
  if (!pattern.test(result)) throw new Error(code);
  return result;
}
function same(left, right) {
  const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createNyraPolicyRegistryProofService({ pool, env = process.env, now = () => Date.now() } = {}) {
  if (!pool?.query) throw new Error("policy_proof_postgres_required");
  const coreKeyId = String(env.CORE_NYRA_POLICY_REGISTRY_CORE_KEY_ID || "").trim();
  const nyraKeyId = String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID || "").trim();
  const secret = String(env.CORE_NYRA_POLICY_REGISTRY_RECEIPT_SECRET || "");
  const allowlist = new Set(String(env.CORE_NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST || "").split(/[\s,]+/).filter(Boolean));
  const ttlMs = Math.max(30_000, Math.min(900_000, Number(env.CORE_NYRA_POLICY_REGISTRY_PROOF_TTL_MS || 300_000)));
  let corePrivate; let corePublic; let nyraPublic; let configError = null;
  try {
    corePrivate = crypto.createPrivateKey(String(env.CORE_NYRA_POLICY_REGISTRY_CORE_PRIVATE_KEY || ""));
    corePublic = crypto.createPublicKey(corePrivate);
    nyraPublic = crypto.createPublicKey(String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY || ""));
    if (corePrivate.asymmetricKeyType !== "ed25519" || nyraPublic.asymmetricKeyType !== "ed25519" ||
      !coreKeyId || !nyraKeyId || coreKeyId === nyraKeyId || secret.length < 32 || !allowlist.size) throw new Error("configuration_invalid");
  } catch (error) { configError = String(error?.message || "configuration_invalid"); }
  const schema = pool.query(`CREATE TABLE IF NOT EXISTS nyra_policy_registry_proofs (
    tenant_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_digest TEXT NOT NULL,
    owner_approval_hash TEXT NOT NULL, envelope JSONB NOT NULL, core_signature TEXT NOT NULL,
    nyra_attestation JSONB, receipt JSONB, status TEXT NOT NULL DEFAULT 'prepared',
    expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(tenant_id,operation_id), UNIQUE(tenant_id,owner_approval_hash)
  )`);
  async function ready() { await schema; if (configError) throw new Error("policy_proof_unavailable"); }
  const sign = (context, value) => crypto.sign(null, bytes(context, value), corePrivate).toString("base64url");
  const mac = (value) => crypto.createHmac("sha256", secret).update(bytes(RECEIPT_CONTEXT, value)).digest("base64url");
  function normalize(input) {
    const tenantId = required(input.tenant_id, ID, "policy_proof_tenant_invalid");
    if (!allowlist.has(tenantId)) throw new Error("policy_proof_tenant_denied");
    const action = String(input.action || "");
    if (!ACTIONS.has(action)) throw new Error("policy_proof_action_invalid");
    return { tenantId, action, workId: required(input.work_id, ID, "policy_proof_work_invalid"),
      preflightId: required(input.preflight_id, ID, "policy_proof_preflight_invalid"),
      intentDigest: required(input.intent_digest, SHA, "policy_proof_intent_invalid"),
      operationId: required(input.operation_id, ID, "policy_proof_operation_invalid"),
      snapshotDigest: required(input.snapshot_digest, SHA, "policy_proof_snapshot_invalid"),
      domainPackId: required(input.domain_pack_id, ID, "policy_proof_domain_invalid"),
      ownerHash: required(input.owner_approval_hash, SHA, "policy_proof_owner_invalid") };
  }
  async function prepare(input) {
    await ready(); const v = normalize(input); const timestamp = now();
    const envelope = { schema_version: ATTESTATION_SCHEMA, tenant_id: v.tenantId, work_id: v.workId,
      preflight_id: v.preflightId, intent_digest: v.intentDigest, operation_id: v.operationId,
      action: v.action, snapshot_digest: v.snapshotDigest, domain_pack_id: v.domainPackId,
      nonce: crypto.randomBytes(24).toString("base64url"), issued_at: new Date(timestamp).toISOString(),
      expires_at: new Date(timestamp + ttlMs).toISOString(), core_key_id: coreKeyId, nyra_key_id: nyraKeyId };
    const requestDigest = digest(v);
    const coreSignature = sign(ATTESTATION_CONTEXT, envelope);
    const inserted = await pool.query(`INSERT INTO nyra_policy_registry_proofs
      (tenant_id,operation_id,request_digest,owner_approval_hash,envelope,core_signature,expires_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(tenant_id,operation_id) DO NOTHING`,
    [v.tenantId, v.operationId, requestDigest, v.ownerHash, JSON.stringify(envelope), coreSignature, envelope.expires_at]);
    const selected = await pool.query("SELECT request_digest,envelope,core_signature,status FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2", [v.tenantId, v.operationId]);
    if (!selected.rowCount || selected.rows[0].request_digest !== requestDigest) throw new Error("policy_proof_idempotency_conflict");
    return { schema_version: ATTESTATION_SCHEMA, envelope: selected.rows[0].envelope,
      core_signature: selected.rows[0].core_signature, idempotent_replay: inserted.rowCount === 0 };
  }
  async function issue({ tenant_id, operation_id, attestation }) {
    await ready(); const tenantId = required(tenant_id, ID, "policy_proof_tenant_invalid");
    const operationId = required(operation_id, ID, "policy_proof_operation_invalid");
    const selected = await pool.query("SELECT envelope,core_signature,status,receipt,expires_at FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2", [tenantId, operationId]);
    const row = selected.rows[0];
    if (!row) throw new Error("policy_proof_not_found");
    if (row.status !== "prepared") return { ...row.receipt, idempotent_replay: true };
    if (Date.parse(row.expires_at) <= now() || attestation?.schema_version !== ATTESTATION_SCHEMA ||
      digest(attestation?.envelope) !== digest(row.envelope) || attestation?.core_signature !== row.core_signature ||
      !crypto.verify(null, bytes(ATTESTATION_CONTEXT, row.envelope), nyraPublic,
        Buffer.from(String(attestation?.nyra_signature || ""), "base64url"))) throw new Error("policy_proof_attestation_invalid");
    const payload = { schema_version: RECEIPT_SCHEMA, receipt_id: `pcr_${crypto.randomUUID()}`,
      tenant_id: tenantId, operation_id: operationId, action: row.envelope.action,
      snapshot_digest: row.envelope.snapshot_digest, preflight_id: row.envelope.preflight_id,
      intent_digest: row.envelope.intent_digest, nonce: row.envelope.nonce,
      issued_at: new Date(now()).toISOString(), expires_at: row.envelope.expires_at,
      issuer_role: "universal_core", single_use: true, core_key_id: coreKeyId };
    const receipt = { ...payload, signature: sign(RECEIPT_CONTEXT, payload), mac: mac(payload) };
    const updated = await pool.query(`UPDATE nyra_policy_registry_proofs SET status='issued',nyra_attestation=$3::jsonb,
      receipt=$4::jsonb,updated_at=NOW() WHERE tenant_id=$1 AND operation_id=$2 AND status='prepared'`,
    [tenantId, operationId, JSON.stringify(attestation), JSON.stringify(receipt)]);
    if (updated.rowCount !== 1) {
      const replay = await pool.query("SELECT receipt FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2", [tenantId, operationId]);
      if (!replay.rows[0]?.receipt) throw new Error("policy_proof_cas_conflict");
      return { ...replay.rows[0].receipt, idempotent_replay: true };
    }
    return { ...receipt, idempotent_replay: false };
  }
  function verifyReceipt(receipt, binding) {
    const { signature, mac: suppliedMac, idempotent_replay: _replay, ...payload } = receipt || {};
    const valid = payload.schema_version === RECEIPT_SCHEMA && payload.single_use === true &&
      payload.tenant_id === binding.tenantId && STORE_ACTION[payload.action] === binding.operation &&
      payload.snapshot_digest === binding.snapshotDigest && Date.parse(payload.expires_at) > now() &&
      same(suppliedMac, mac(payload)) && crypto.verify(null, bytes(RECEIPT_CONTEXT, payload), corePublic,
        Buffer.from(String(signature || ""), "base64url"));
    if (!valid) throw new Error("policy_activation_core_receipt_invalid");
    return payload;
  }
  function verifyActivationSnapshot(snapshot, binding = {}) {
    const attestation = snapshot?.policy_registry_attestation || binding.persisted_attestation?.policy_registry_attestation;
    const envelope = attestation?.envelope;
    const valid = attestation?.schema_version === ATTESTATION_SCHEMA &&
      envelope?.tenant_id === binding.tenant_id && envelope?.snapshot_digest === snapshot?.snapshot_digest &&
      envelope?.core_key_id === coreKeyId && envelope?.nyra_key_id === nyraKeyId &&
      attestation?.core_signature && attestation?.nyra_signature &&
      crypto.verify(null, bytes(ATTESTATION_CONTEXT, envelope), corePublic,
        Buffer.from(String(attestation.core_signature), "base64url")) &&
      crypto.verify(null, bytes(ATTESTATION_CONTEXT, envelope), nyraPublic,
        Buffer.from(String(attestation.nyra_signature), "base64url"));
    if (!valid) throw new Error("policy_snapshot_signature_quorum_invalid");
    return { ok: true, signature_verified: true, tenant_id: binding.tenant_id,
      snapshot_digest: snapshot.snapshot_digest, verified_roles: ["core", "nyra"],
      independent_key_count: 2, policy_registry_attestation: attestation };
  }
  async function consume(receipt, binding) {
    await ready(); const payload = verifyReceipt(receipt, binding);
    const updated = await pool.query(`UPDATE nyra_policy_registry_proofs SET status='consumed',updated_at=NOW()
      WHERE tenant_id=$1 AND operation_id=$2 AND status='issued' AND receipt->>'receipt_id'=$3`,
    [payload.tenant_id, payload.operation_id, payload.receipt_id]);
    if (updated.rowCount !== 1) throw new Error("policy_activation_core_receipt_replayed");
    return { ok: true, consumed: true, single_use: true, signature_verified: true,
      issuer_role: "universal_core", tenant_id: payload.tenant_id, action: binding.operation,
      snapshot_digest: payload.snapshot_digest,
      consumption_id: `pcc_${crypto.createHash("sha256").update(payload.receipt_id).digest("hex")}` };
  }
  async function reconcile({ tenant_id, operation_id }) {
    await ready(); const selected = await pool.query("SELECT status,receipt,envelope FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2", [tenant_id, operation_id]);
    if (!selected.rowCount) throw new Error("policy_proof_not_found");
    const row = selected.rows[0];
    return { tenant_id, operation_id, status: row.status, snapshot_digest: row.envelope.snapshot_digest,
      receipt: row.status === "issued" ? row.receipt : null, consumed: row.status === "consumed" };
  }
  async function reconcileConsumption({ tenant_id, operation_id, operation, snapshot_digest }) {
    await ready();
    const selected = await pool.query("SELECT status,receipt,envelope FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2", [tenant_id, operation_id]);
    const row = selected.rows[0];
    if (!row || row.status !== "consumed" || row.envelope.snapshot_digest !== snapshot_digest ||
      STORE_ACTION[row.envelope.action] !== operation || !row.receipt?.receipt_id) {
      throw new Error("policy_proof_consumption_not_found");
    }
    return { ok: true, consumed: true, single_use: true, signature_verified: true,
      issuer_role: "universal_core", tenant_id, action: operation, snapshot_digest,
      consumption_id: `pcc_${crypto.createHash("sha256").update(row.receipt.receipt_id).digest("hex")}` };
  }
  return { prepare, issue, consume, reconcile, reconcileConsumption, verifyReceipt, verifyActivationSnapshot,
    status: async () => { try { await ready(); return { ready: true, backend: "postgresql", algorithm: "Ed25519+HMAC-SHA256" }; }
      catch { return { ready: false, backend: "postgresql", error: configError }; } } };
}

export { ATTESTATION_SCHEMA, RECEIPT_SCHEMA, canonical };
