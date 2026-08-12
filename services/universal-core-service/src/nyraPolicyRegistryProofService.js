import crypto from "node:crypto";

const ATTESTATION_SCHEMA = "nyra_policy_activation_attestation_v3";
const RECEIPT_SCHEMA = "core_policy_activation_receipt_v3";
const PROOF_SCHEMA = "nyra_policy_registry_proof_v3";
const ATTESTATION_CONTEXT = "nyra-policy-activation-attestation-v3\0";
const RECEIPT_CONTEXT = "core-policy-activation-receipt-v3\0";
const ATTESTATION_SIGNING_PURPOSE = "nyra-policy-activation-attestation-v3";
const RECEIPT_SIGNING_PURPOSE = "core-policy-activation-receipt-v3";
const ACTIONS = new Set(["policy.snapshot.activate", "policy.snapshot.rollback"]);
const STORE_ACTION = Object.freeze({
  "policy.snapshot.activate": "activate_policy_snapshot",
  "policy.snapshot.rollback": "rollback_policy_snapshot",
});
const ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "tenant_id", "work_id", "preflight_id", "intent_digest",
  "operation_id", "action", "snapshot_digest", "compiler_provenance_digest", "domain_pack_id",
  "owner_approval_hash", "nonce", "issued_at", "expires_at", "core_key_id",
  "nyra_key_id", "core_public_key_fingerprint", "nyra_public_key_fingerprint",
]);
const RECEIPT_PAYLOAD_FIELDS = Object.freeze([
  "schema_version", "receipt_id", "tenant_id", "operation_id", "action",
  "work_id", "preflight_id", "intent_digest", "domain_pack_id",
  "snapshot_digest", "compiler_provenance_digest", "owner_approval_hash", "nonce", "issued_at", "expires_at",
  "issuer_role", "single_use", "core_key_id", "nyra_key_id",
  "core_public_key_fingerprint", "nyra_public_key_fingerprint",
]);
const COMPILER_PROVENANCE_VERIFICATION_FIELDS = Object.freeze([
  "ok", "record_integrity_verified", "derivation_reverified", "tenant_id",
  "domain_pack_id", "snapshot_digest", "compiler_provenance_digest",
  "compiler_build_commit", "catalog_digest", "trust_catalog_digest",
  "execution_authorized", "error",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const SHA = /^[a-f0-9]{64}$/;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
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
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function exactFields(value, requiredFields, optionalFields = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set([...requiredFields, ...optionalFields]);
  const keys = Object.keys(value);
  return requiredFields.every((field) => value[field] !== undefined) &&
    keys.every((field) => allowed.has(field)) && keys.length >= requiredFields.length;
}

function canonicalBase64url(value, byteLength) {
  const encoded = String(value || "");
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    return decoded.length === byteLength && decoded.toString("base64url") === encoded
      ? decoded
      : null;
  } catch {
    return null;
  }
}

function publicKeyObject(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("key_material_missing");
  const normalized = raw.replaceAll("\\n", "\n").replaceAll("\\r", "\r").trim();
  if (normalized.includes("-----BEGIN")) {
    if (!normalized.startsWith("-----BEGIN PUBLIC KEY-----") || normalized.includes("PRIVATE KEY")) {
      throw new Error("nyra_public_key_required");
    }
    return crypto.createPublicKey(normalized);
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(normalized)) throw new Error("key_material_encoding_invalid");
  return crypto.createPublicKey({
    key: Buffer.from(normalized.replaceAll("-", "+").replaceAll("_", "/"), "base64"),
    format: "der",
    type: "spki",
  });
}

function publicFingerprint(key) {
  return crypto.createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function proofBindingFromEnvelope(envelope) {
  return {
    tenant_id: envelope.tenant_id,
    operation_id: envelope.operation_id,
    action: envelope.action,
    operation: STORE_ACTION[envelope.action],
    work_id: envelope.work_id,
    preflight_id: envelope.preflight_id,
    intent_digest: envelope.intent_digest,
    domain_pack_id: envelope.domain_pack_id,
    snapshot_digest: envelope.snapshot_digest,
    compiler_provenance_digest: envelope.compiler_provenance_digest,
    owner_approval_hash: envelope.owner_approval_hash,
    core_key_id: envelope.core_key_id,
    nyra_key_id: envelope.nyra_key_id,
    core_public_key_fingerprint: envelope.core_public_key_fingerprint,
    nyra_public_key_fingerprint: envelope.nyra_public_key_fingerprint,
  };
}

function normalizeBinding(binding = {}) {
  const action = String(binding.action || "");
  if (!ACTIONS.has(action)) throw new Error("policy_proof_action_invalid");
  const operation = String(binding.operation || "");
  if (STORE_ACTION[action] !== operation) throw new Error("policy_proof_operation_binding_invalid");
  return {
    tenant_id: required(binding.tenant_id ?? binding.tenantId, ID, "policy_proof_tenant_invalid"),
    operation_id: required(binding.operation_id ?? binding.operationId, ID, "policy_proof_operation_invalid"),
    action,
    operation,
    work_id: required(binding.work_id ?? binding.workId, ID, "policy_proof_work_invalid"),
    preflight_id: required(binding.preflight_id ?? binding.preflightId, ID, "policy_proof_preflight_invalid"),
    intent_digest: required(binding.intent_digest ?? binding.intentDigest, SHA, "policy_proof_intent_invalid"),
    domain_pack_id: required(binding.domain_pack_id ?? binding.domainPackId, ID, "policy_proof_domain_invalid"),
    snapshot_digest: required(binding.snapshot_digest ?? binding.snapshotDigest, SHA, "policy_proof_snapshot_invalid"),
    compiler_provenance_digest: required(
      binding.compiler_provenance_digest ?? binding.compilerProvenanceDigest,
      SHA,
      "policy_proof_compiler_provenance_invalid",
    ),
    owner_approval_hash: required(binding.owner_approval_hash ?? binding.ownerApprovalHash, SHA, "policy_proof_owner_invalid"),
    core_key_id: required(binding.core_key_id ?? binding.coreKeyId, ID, "policy_proof_core_key_invalid"),
    nyra_key_id: required(binding.nyra_key_id ?? binding.nyraKeyId, ID, "policy_proof_nyra_key_invalid"),
    core_public_key_fingerprint: required(
      binding.core_public_key_fingerprint ?? binding.corePublicKeyFingerprint,
      SHA,
      "policy_proof_core_fingerprint_invalid",
    ),
    nyra_public_key_fingerprint: required(
      binding.nyra_public_key_fingerprint ?? binding.nyraPublicKeyFingerprint,
      SHA,
      "policy_proof_nyra_fingerprint_invalid",
    ),
  };
}

function bindingMatchesEnvelope(binding, envelope) {
  if (!exactFields(envelope, ENVELOPE_FIELDS)) return false;
  return envelope.schema_version === ATTESTATION_SCHEMA &&
    ENVELOPE_FIELDS.filter((field) => !["schema_version", "nonce", "issued_at", "expires_at"].includes(field))
      .every((field) => envelope[field] === binding[field]);
}

function bindingMatchesReceipt(binding, payload) {
  return [
    "tenant_id", "operation_id", "action", "work_id", "preflight_id",
    "intent_digest", "domain_pack_id", "snapshot_digest", "owner_approval_hash",
    "compiler_provenance_digest",
    "core_key_id", "nyra_key_id", "core_public_key_fingerprint",
    "nyra_public_key_fingerprint",
  ].every((field) => payload[field] === binding[field]);
}

function compilerProvenanceVerified(verifier, record, snapshot, binding) {
  try {
    const expectedBinding = {
      tenant_id: binding.tenant_id,
      domain_pack_id: binding.domain_pack_id,
      snapshot_digest: binding.snapshot_digest,
      compiler_provenance_digest: binding.compiler_provenance_digest,
    };
    const outcome = verifier.verifyPersistedRecord(record, expectedBinding);
    return exactFields(outcome, COMPILER_PROVENANCE_VERIFICATION_FIELDS) &&
      outcome.ok === true && outcome.record_integrity_verified === true &&
      outcome.derivation_reverified === false && outcome.execution_authorized === false &&
      outcome.error === null && outcome.tenant_id === expectedBinding.tenant_id &&
      outcome.domain_pack_id === expectedBinding.domain_pack_id &&
      outcome.snapshot_digest === expectedBinding.snapshot_digest &&
      outcome.compiler_provenance_digest === expectedBinding.compiler_provenance_digest &&
      snapshot?.tenant_id === outcome.tenant_id &&
      snapshot?.domain_pack_id === outcome.domain_pack_id &&
      snapshot?.snapshot_digest === outcome.snapshot_digest &&
      /^[a-f0-9]{40}$/.test(String(outcome.compiler_build_commit || "")) &&
      SHA.test(String(outcome.catalog_digest || "")) &&
      SHA.test(String(outcome.trust_catalog_digest || ""));
  } catch {
    return false;
  }
}

export function createNyraPolicyRegistryProofService({
  pool,
  env = process.env,
  signer,
  compilerProvenanceVerifier,
  now = () => Date.now(),
} = {}) {
  if (!pool?.query) throw new Error("policy_proof_postgres_required");
  const coreKeyId = String(env.CORE_NYRA_POLICY_REGISTRY_CORE_KEY_ID || "").trim();
  const nyraKeyId = String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID || "").trim();
  const secret = String(env.CORE_NYRA_POLICY_REGISTRY_RECEIPT_SECRET || "");
  const allowlist = new Set(String(env.CORE_NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST || "")
    .split(/[\s,]+/).filter(Boolean));
  const requestedTtl = Number(env.CORE_NYRA_POLICY_REGISTRY_PROOF_TTL_MS || 300_000);
  const ttlMs = Number.isFinite(requestedTtl) && requestedTtl >= 30_000 && requestedTtl <= 900_000
    ? Math.trunc(requestedTtl)
    : null;
  let corePublic;
  let nyraPublic;
  let coreFingerprint = null;
  let nyraFingerprint = null;
  let configError = null;
  let signerProbeVerified = false;
  try {
    if (!compilerProvenanceVerifier ||
      typeof compilerProvenanceVerifier.verifyPersistedRecord !== "function") {
      throw new Error("policy_proof_compiler_provenance_verifier_invalid");
    }
    if (!signer || signer.algorithm !== "Ed25519" || typeof signer.signPayload !== "function" ||
      typeof signer.probe !== "function" || typeof signer.health !== "function" ||
      signer.key_id !== coreKeyId || signer.public_key?.type !== "public" ||
      signer.public_key?.asymmetricKeyType !== "ed25519") {
      throw new Error("core_signer_invalid");
    }
    corePublic = signer.public_key;
    nyraPublic = publicKeyObject(env.CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY);
    coreFingerprint = publicFingerprint(corePublic);
    nyraFingerprint = publicFingerprint(nyraPublic);
    const pinnedCoreFingerprint = String(
      env.CORE_NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY_FINGERPRINT || "",
    ).trim();
    const pinnedNyraFingerprint = String(
      env.CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT || "",
    ).trim();
    if (nyraPublic.asymmetricKeyType !== "ed25519" ||
      !coreKeyId || !nyraKeyId || coreKeyId === nyraKeyId || coreFingerprint === nyraFingerprint ||
      signer.public_key_fingerprint !== coreFingerprint || pinnedCoreFingerprint !== coreFingerprint ||
      pinnedNyraFingerprint !== nyraFingerprint ||
      secret.length < 32 || !allowlist.size || ttlMs === null) {
      throw new Error("configuration_invalid");
    }
  } catch (error) {
    const code = String(error?.message || "");
    configError = new Set([
      "configuration_invalid",
      "core_signer_invalid",
      "key_material_encoding_invalid",
      "key_material_missing",
      "nyra_public_key_required",
      "policy_proof_compiler_provenance_verifier_invalid",
    ]).has(code) ? code : "configuration_invalid";
  }
  const schemaSql = `CREATE TABLE IF NOT EXISTS nyra_policy_registry_proofs (
    tenant_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_digest TEXT NOT NULL,
    owner_approval_hash TEXT NOT NULL, envelope JSONB NOT NULL, core_signature TEXT NOT NULL,
    nyra_attestation JSONB, receipt JSONB, status TEXT NOT NULL DEFAULT 'prepared',
    proof_schema_version TEXT, compiler_provenance_digest TEXT,
    expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(tenant_id,operation_id), UNIQUE(tenant_id,owner_approval_hash)
  )`;
  const migrationSql = `ALTER TABLE nyra_policy_registry_proofs
    ADD COLUMN IF NOT EXISTS proof_schema_version TEXT,
    ADD COLUMN IF NOT EXISTS compiler_provenance_digest TEXT`;
  let schemaReady = false;
  let schemaInFlight = null;

  async function ensureSchema() {
    if (schemaReady) return;
    if (schemaInFlight) return schemaInFlight;
    const current = Promise.resolve().then(async () => {
      await pool.query(schemaSql);
      await pool.query(migrationSql);
    });
    schemaInFlight = current;
    try {
      await current;
      schemaReady = true;
    } catch {
      throw new Error("policy_proof_unavailable");
    } finally {
      if (schemaInFlight === current) schemaInFlight = null;
    }
  }

  async function ready() {
    if (configError) throw new Error("policy_proof_unavailable");
    await ensureSchema();
    // Always consult the signer probe. The signer owns the bounded freshness
    // window: it returns the cached result inside its cooldown and performs a
    // new remote proof once that window expires. A process-local boolean here
    // would otherwise keep an initially healthy signer ready forever.
    let verified = false;
    try { verified = await signer.probe() === true; } catch { verified = false; }
    const signerHealth = signer.health();
    signerProbeVerified = verified && signerHealth?.signer_state === "ready";
    if (!signerProbeVerified) throw new Error("policy_proof_signer_unavailable");
  }

  const sign = async (context, purpose, value) => {
    const payload = bytes(context, value);
    try {
      const signature = await signer.signPayload(payload, purpose);
      const signatureBytes = canonicalBase64url(signature, 64);
      if (!signatureBytes || !crypto.verify(null, payload, corePublic, signatureBytes)) {
        throw new Error("policy_proof_core_signature_invalid");
      }
      signerProbeVerified = true;
      return signature;
    } catch (error) {
      signerProbeVerified = false;
      if (error?.message === "policy_proof_core_signature_invalid") throw error;
      throw new Error("policy_proof_signer_unavailable");
    }
  };
  const mac = (value) => crypto.createHmac("sha256", secret)
    .update(bytes(RECEIPT_CONTEXT, value)).digest("base64url");

  function normalize(input) {
    const tenantId = required(input.tenant_id, ID, "policy_proof_tenant_invalid");
    if (!allowlist.has(tenantId)) throw new Error("policy_proof_tenant_denied");
    const action = String(input.action || "");
    if (!ACTIONS.has(action)) throw new Error("policy_proof_action_invalid");
    return {
      tenant_id: tenantId,
      action,
      work_id: required(input.work_id, ID, "policy_proof_work_invalid"),
      preflight_id: required(input.preflight_id, ID, "policy_proof_preflight_invalid"),
      intent_digest: required(input.intent_digest, SHA, "policy_proof_intent_invalid"),
      operation_id: required(input.operation_id, ID, "policy_proof_operation_invalid"),
      snapshot_digest: required(input.snapshot_digest, SHA, "policy_proof_snapshot_invalid"),
      compiler_provenance_digest: required(
        input.compiler_provenance_digest,
        SHA,
        "policy_proof_compiler_provenance_invalid",
      ),
      domain_pack_id: required(input.domain_pack_id, ID, "policy_proof_domain_invalid"),
      owner_approval_hash: required(input.owner_approval_hash, SHA, "policy_proof_owner_invalid"),
    };
  }

  function assertCurrentProofRow(row, expectedCompilerProvenanceDigest) {
    if (row?.proof_schema_version !== PROOF_SCHEMA || row?.compiler_provenance_digest == null) {
      throw new Error("policy_proof_legacy_schema_unsupported");
    }
    if (!SHA.test(String(row.compiler_provenance_digest || "")) ||
      (expectedCompilerProvenanceDigest !== undefined &&
        row.compiler_provenance_digest !== expectedCompilerProvenanceDigest)) {
      throw new Error("policy_proof_state_invalid");
    }
  }

  async function prepare(input) {
    await ready();
    const value = normalize(input);
    const timestamp = now();
    const envelope = {
      schema_version: ATTESTATION_SCHEMA,
      tenant_id: value.tenant_id,
      work_id: value.work_id,
      preflight_id: value.preflight_id,
      intent_digest: value.intent_digest,
      operation_id: value.operation_id,
      action: value.action,
      snapshot_digest: value.snapshot_digest,
      compiler_provenance_digest: value.compiler_provenance_digest,
      domain_pack_id: value.domain_pack_id,
      owner_approval_hash: value.owner_approval_hash,
      nonce: crypto.randomBytes(24).toString("base64url"),
      issued_at: new Date(timestamp).toISOString(),
      expires_at: new Date(timestamp + ttlMs).toISOString(),
      core_key_id: coreKeyId,
      nyra_key_id: nyraKeyId,
      core_public_key_fingerprint: coreFingerprint,
      nyra_public_key_fingerprint: nyraFingerprint,
    };
    const requestDigest = digest(value);
    const coreSignature = await sign(ATTESTATION_CONTEXT, ATTESTATION_SIGNING_PURPOSE, envelope);
    let inserted;
    try {
      inserted = await pool.query(`INSERT INTO nyra_policy_registry_proofs
        (tenant_id,operation_id,request_digest,owner_approval_hash,envelope,core_signature,expires_at,
          proof_schema_version,compiler_provenance_digest)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) ON CONFLICT(tenant_id,operation_id) DO NOTHING`,
      [value.tenant_id, value.operation_id, requestDigest, value.owner_approval_hash,
        JSON.stringify(envelope), coreSignature, envelope.expires_at, PROOF_SCHEMA,
        value.compiler_provenance_digest]);
    } catch (error) {
      if (error?.code === "23505") throw new Error("policy_proof_owner_replayed");
      throw new Error("policy_proof_unavailable");
    }
    const selected = await pool.query(
      `SELECT request_digest,envelope,core_signature,status,proof_schema_version,compiler_provenance_digest
        FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2`,
      [value.tenant_id, value.operation_id],
    );
    if (!selected.rowCount) throw new Error("policy_proof_idempotency_conflict");
    assertCurrentProofRow(selected.rows[0], value.compiler_provenance_digest);
    if (selected.rows[0].request_digest !== requestDigest) {
      throw new Error("policy_proof_idempotency_conflict");
    }
    return {
      schema_version: ATTESTATION_SCHEMA,
      envelope: selected.rows[0].envelope,
      core_signature: selected.rows[0].core_signature,
      idempotent_replay: inserted.rowCount === 0,
    };
  }

  function attestationValid(attestation, envelope, coreSignature) {
    if (!exactFields(attestation,
      ["schema_version", "envelope", "core_signature", "nyra_signature"],
      ["idempotent_replay"])) return false;
    const coreBytes = canonicalBase64url(coreSignature, 64);
    const nyraBytes = canonicalBase64url(attestation.nyra_signature, 64);
    return attestation.schema_version === ATTESTATION_SCHEMA &&
      exactFields(envelope, ENVELOPE_FIELDS) &&
      digest(attestation.envelope) === digest(envelope) &&
      attestation.core_signature === coreSignature && coreBytes && nyraBytes &&
      crypto.verify(null, bytes(ATTESTATION_CONTEXT, envelope), corePublic, coreBytes) &&
      crypto.verify(null, bytes(ATTESTATION_CONTEXT, envelope), nyraPublic, nyraBytes);
  }

  async function issue({ tenant_id, operation_id, attestation }) {
    await ready();
    const tenantId = required(tenant_id, ID, "policy_proof_tenant_invalid");
    const operationId = required(operation_id, ID, "policy_proof_operation_invalid");
    const selected = await pool.query(
      `SELECT envelope,core_signature,status,receipt,expires_at,proof_schema_version,
        compiler_provenance_digest FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2`,
      [tenantId, operationId],
    );
    const row = selected.rows[0];
    if (!row) throw new Error("policy_proof_not_found");
    assertCurrentProofRow(row, row.envelope?.compiler_provenance_digest);
    if (row.status !== "prepared") {
      if (!row.receipt) throw new Error("policy_proof_state_invalid");
      verifyReceipt(row.receipt, proofBindingFromEnvelope(row.envelope), { allowExpired: true });
      return { ...row.receipt, idempotent_replay: true };
    }
    const binding = normalizeBinding(proofBindingFromEnvelope(row.envelope));
    if (binding.tenant_id !== tenantId || binding.operation_id !== operationId ||
      Date.parse(row.expires_at) <= now() ||
      !attestationValid(attestation, row.envelope, row.core_signature)) {
      throw new Error("policy_proof_attestation_invalid");
    }
    const payload = {
      schema_version: RECEIPT_SCHEMA,
      receipt_id: `pcr_${crypto.randomUUID()}`,
      tenant_id: tenantId,
      operation_id: operationId,
      action: binding.action,
      work_id: binding.work_id,
      preflight_id: binding.preflight_id,
      intent_digest: binding.intent_digest,
      domain_pack_id: binding.domain_pack_id,
      snapshot_digest: binding.snapshot_digest,
      compiler_provenance_digest: binding.compiler_provenance_digest,
      owner_approval_hash: binding.owner_approval_hash,
      nonce: row.envelope.nonce,
      issued_at: new Date(now()).toISOString(),
      expires_at: row.envelope.expires_at,
      issuer_role: "universal_core",
      single_use: true,
      core_key_id: coreKeyId,
      nyra_key_id: nyraKeyId,
      core_public_key_fingerprint: coreFingerprint,
      nyra_public_key_fingerprint: nyraFingerprint,
    };
    const receipt = {
      ...payload,
      signature: await sign(RECEIPT_CONTEXT, RECEIPT_SIGNING_PURPOSE, payload),
      mac: mac(payload),
    };
    const updated = await pool.query(`UPDATE nyra_policy_registry_proofs SET status='issued',nyra_attestation=$3::jsonb,
      receipt=$4::jsonb,updated_at=NOW() WHERE tenant_id=$1 AND operation_id=$2 AND status='prepared'
        AND proof_schema_version=$5 AND compiler_provenance_digest=$6`,
    [tenantId, operationId, JSON.stringify(attestation), JSON.stringify(receipt), PROOF_SCHEMA,
      binding.compiler_provenance_digest]);
    if (updated.rowCount !== 1) {
      const replay = await pool.query(
        `SELECT receipt,envelope,proof_schema_version,compiler_provenance_digest
          FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2`,
        [tenantId, operationId],
      );
      assertCurrentProofRow(replay.rows[0], binding.compiler_provenance_digest);
      if (!replay.rows[0]?.receipt) throw new Error("policy_proof_cas_conflict");
      verifyReceipt(replay.rows[0].receipt, binding, { allowExpired: true });
      return { ...replay.rows[0].receipt, idempotent_replay: true };
    }
    return { ...receipt, idempotent_replay: false };
  }

  function verifyReceipt(receipt, suppliedBinding, { allowExpired = false } = {}) {
    if (!exactFields(receipt,
      [...RECEIPT_PAYLOAD_FIELDS, "signature", "mac"],
      ["idempotent_replay"])) throw new Error("policy_activation_core_receipt_invalid");
    const { signature, mac: suppliedMac, idempotent_replay: _replay, ...payload } = receipt;
    const binding = normalizeBinding(suppliedBinding);
    const signatureBytes = canonicalBase64url(signature, 64);
    const macBytes = canonicalBase64url(suppliedMac, 32);
    const expectedMac = mac(payload);
    const valid = exactFields(payload, RECEIPT_PAYLOAD_FIELDS) &&
      payload.schema_version === RECEIPT_SCHEMA && payload.single_use === true &&
      payload.issuer_role === "universal_core" &&
      bindingMatchesReceipt(binding, payload) &&
      payload.core_key_id === coreKeyId && payload.nyra_key_id === nyraKeyId &&
      payload.core_public_key_fingerprint === coreFingerprint &&
      payload.nyra_public_key_fingerprint === nyraFingerprint &&
      STORE_ACTION[payload.action] === binding.operation &&
      (allowExpired || Date.parse(payload.expires_at) > now()) &&
      signatureBytes && macBytes && canonicalBase64url(expectedMac, 32) &&
      same(suppliedMac, expectedMac) &&
      crypto.verify(null, bytes(RECEIPT_CONTEXT, payload), corePublic, signatureBytes);
    if (!valid) throw new Error("policy_activation_core_receipt_invalid");
    return payload;
  }

  function verifyActivationSnapshot(snapshot, compilerProvenance, suppliedBinding = {}) {
    const attestation = suppliedBinding.activation_attestation ||
      suppliedBinding.persisted_attestation?.policy_registry_attestation;
    const binding = normalizeBinding(
      suppliedBinding.binding || suppliedBinding.persisted_attestation?.binding || suppliedBinding,
    );
    const envelope = attestation?.envelope;
    const valid = snapshot?.snapshot_digest === binding.snapshot_digest &&
      binding.tenant_id === snapshot?.tenant_id &&
      bindingMatchesEnvelope(binding, envelope) &&
      compilerProvenanceVerified(
        compilerProvenanceVerifier,
        compilerProvenance,
        snapshot,
        binding,
      ) &&
      envelope?.core_key_id === coreKeyId && envelope?.nyra_key_id === nyraKeyId &&
      envelope?.core_public_key_fingerprint === coreFingerprint &&
      envelope?.nyra_public_key_fingerprint === nyraFingerprint &&
      attestationValid(attestation, envelope, attestation?.core_signature);
    if (!valid) throw new Error("policy_snapshot_signature_quorum_invalid");
    return {
      ok: true,
      signature_verified: true,
      tenant_id: binding.tenant_id,
      snapshot_digest: snapshot.snapshot_digest,
      compiler_provenance_digest: binding.compiler_provenance_digest,
      compiler_provenance_bound: true,
      verified_roles: ["core", "nyra"],
      independent_key_count: 2,
      binding,
      policy_registry_attestation: attestation,
      execution_authorized: false,
    };
  }

  async function consume(receipt, suppliedBinding) {
    await ready();
    const binding = normalizeBinding(suppliedBinding);
    const payload = verifyReceipt(receipt, binding);
    const selected = await pool.query(
      `SELECT proof_schema_version,compiler_provenance_digest FROM nyra_policy_registry_proofs
        WHERE tenant_id=$1 AND operation_id=$2`,
      [payload.tenant_id, payload.operation_id],
    );
    if (!selected.rowCount) throw new Error("policy_proof_not_found");
    assertCurrentProofRow(selected.rows[0], binding.compiler_provenance_digest);
    const updated = await pool.query(`UPDATE nyra_policy_registry_proofs SET status='consumed',updated_at=NOW()
      WHERE tenant_id=$1 AND operation_id=$2 AND status='issued' AND receipt->>'receipt_id'=$3
        AND proof_schema_version=$4 AND compiler_provenance_digest=$5`,
    [payload.tenant_id, payload.operation_id, payload.receipt_id, PROOF_SCHEMA,
      binding.compiler_provenance_digest]);
    if (updated.rowCount !== 1) throw new Error("policy_activation_core_receipt_replayed");
    return {
      ok: true,
      consumed: true,
      single_use: true,
      signature_verified: true,
      issuer_role: "universal_core",
      ...binding,
      consumption_id: `pcc_${crypto.createHash("sha256").update(payload.receipt_id).digest("hex")}`,
      execution_authorized: false,
    };
  }

  async function reconcile({ tenant_id, operation_id }) {
    await ready();
    const tenantId = required(tenant_id, ID, "policy_proof_tenant_invalid");
    const operationId = required(operation_id, ID, "policy_proof_operation_invalid");
    const selected = await pool.query(
      `SELECT status,receipt,envelope,nyra_attestation,proof_schema_version,compiler_provenance_digest
        FROM nyra_policy_registry_proofs WHERE tenant_id=$1 AND operation_id=$2`,
      [tenantId, operationId],
    );
    if (!selected.rowCount) throw new Error("policy_proof_not_found");
    const row = selected.rows[0];
    assertCurrentProofRow(row, row.envelope?.compiler_provenance_digest);
    const binding = normalizeBinding(proofBindingFromEnvelope(row.envelope));
    return {
      tenant_id: tenantId,
      operation_id: operationId,
      status: row.status,
      binding,
      receipt: row.receipt || null,
      activation_attestation: row.nyra_attestation || null,
      consumed: row.status === "consumed",
      compiler_provenance_digest: row.compiler_provenance_digest,
      execution_authorized: false,
    };
  }

  async function reconcileConsumption({ tenant_id, operation_id }) {
    const state = await reconcile({ tenant_id, operation_id });
    if (!state.consumed || !state.receipt?.receipt_id) {
      throw new Error("policy_proof_consumption_not_found");
    }
    verifyReceipt(state.receipt, state.binding, { allowExpired: true });
    return {
      ok: true,
      consumed: true,
      single_use: true,
      signature_verified: true,
      issuer_role: "universal_core",
      ...state.binding,
      consumption_id: `pcc_${crypto.createHash("sha256").update(state.receipt.receipt_id).digest("hex")}`,
      execution_authorized: false,
    };
  }

  return {
    prepare,
    issue,
    consume,
    reconcile,
    reconcileConsumption,
    verifyReceipt,
    verifyActivationSnapshot,
    status: async () => {
      try {
        await ready();
        const signerHealth = signer.health();
        return {
          ready: true,
          backend: "postgresql",
          algorithm: "Ed25519+HMAC-SHA256",
          proof_schema_version: PROOF_SCHEMA,
          attestation_schema_version: ATTESTATION_SCHEMA,
          receipt_schema_version: RECEIPT_SCHEMA,
          compiler_provenance_binding_required: true,
          core_key_id: coreKeyId,
          nyra_key_id: nyraKeyId,
          core_public_key_fingerprint: coreFingerprint,
          nyra_public_key_fingerprint: nyraFingerprint,
          signer: {
            ready: signerProbeVerified === true && signerHealth?.signer_state === "ready",
            state: signerHealth?.signer_state || "unavailable",
            custody: signer.custody || null,
            target_commit: signerHealth?.target_commit || null,
          },
        };
      } catch {
        const signerHealth = signer?.health?.();
        return {
          ready: false,
          backend: "postgresql",
          proof_schema_version: PROOF_SCHEMA,
          attestation_schema_version: ATTESTATION_SCHEMA,
          receipt_schema_version: RECEIPT_SCHEMA,
          compiler_provenance_binding_required: true,
          error: configError || signerHealth?.reason || "policy_proof_signer_unavailable",
          signer: {
            ready: false,
            state: signerHealth?.signer_state || "unavailable",
            custody: signer?.custody || null,
            target_commit: signerHealth?.target_commit || null,
          },
        };
      }
    },
  };
}

export {
  ACTIONS,
  ATTESTATION_SCHEMA,
  ENVELOPE_FIELDS,
  PROOF_SCHEMA,
  RECEIPT_SCHEMA,
  STORE_ACTION,
  canonical,
  proofBindingFromEnvelope,
};
