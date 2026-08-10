import crypto from "node:crypto";

export const GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION = "generic_work_core_join_v1";
export const GENERIC_WORK_INDEPENDENT_VERIFIER_RECEIPT_SCHEMA_VERSION = "generic_work_independent_verifier_receipt_v1";
const ADAPTERS = new Set(["software_git", "software_non_git", "deployment", "research", "document", "commercial_crm", "hardware", "generic"]);
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SIGNER_INFRASTRUCTURE_CODES = new Set([
  "generic_work_core_join_disabled",
  "generic_work_core_join_dependency_unavailable",
  "generic_work_core_join_enabled_flag_invalid",
  "generic_work_core_join_external_signer_required",
  "generic_work_core_join_local_signer_forbidden",
  "generic_work_core_join_required_flag_invalid",
  "generic_work_core_join_required_without_enabled",
  "generic_work_core_join_signature_invalid",
  "generic_work_core_join_signer_configuration_invalid",
  "generic_work_core_join_signer_digest_invalid",
  "generic_work_core_join_signer_digest_mismatch",
  "generic_work_core_join_signer_health_unavailable",
  "generic_work_core_join_signer_injection_forbidden",
  "generic_work_core_join_signer_jwks_invalid",
  "generic_work_core_join_signer_key_id_invalid",
  "generic_work_core_join_signer_key_id_mismatch",
  "generic_work_core_join_signer_mode_invalid",
  "generic_work_core_join_signer_not_yet_verified",
  "generic_work_core_join_signer_origin_invalid",
  "generic_work_core_join_signer_path_invalid",
  "generic_work_core_join_signer_pinned_key_required",
  "generic_work_core_join_signer_public_key_invalid",
  "generic_work_core_join_signer_purpose_invalid",
  "generic_work_core_join_signer_purpose_mismatch",
  "generic_work_core_join_signer_redirect_denied",
  "generic_work_core_join_signer_response_invalid",
  "generic_work_core_join_signer_response_limit_invalid",
  "generic_work_core_join_signer_response_too_large",
  "generic_work_core_join_signer_service_invalid",
  "generic_work_core_join_signer_service_mismatch",
  "generic_work_core_join_signer_service_token_required",
  "generic_work_core_join_signer_signature_invalid",
  "generic_work_core_join_signer_target_commit_invalid",
  "generic_work_core_join_signer_target_commit_mismatch",
  "generic_work_core_join_signer_timeout",
  "generic_work_core_join_signer_timeout_invalid",
  "generic_work_core_join_signer_transport_unavailable",
  "generic_work_core_join_signer_unavailable",
  "generic_work_core_join_signer_unconfigured",
  "generic_work_core_join_signing_unavailable",
  "generic_work_core_join_verifier_unavailable",
]);
const STORE_INFRASTRUCTURE_CODES = new Set([
  "generic_work_core_join_durable_store_unavailable",
  "generic_work_core_join_distributed_store_unavailable",
  "generic_work_core_join_postgres_unavailable",
  "generic_work_core_join_store_initialization_failed",
  "generic_work_core_join_store_initializing",
  "generic_work_core_join_store_lock_timeout",
  "generic_work_core_join_store_unavailable",
  "initialize_unavailable",
  "postgres_unavailable",
  "store_unavailable",
]);
const STORE_SEMANTIC_CODES = new Set(["generic_work_core_join_idempotency_conflict", "generic_work_core_join_nonce_replayed"]);
const VERDICT_FIELDS = ["acceptance_criteria_digest", "adapter", "authority", "decision", "evidence_digest", "execution_authorized", "host_action_authorized", "idempotency_digest", "independent_verifier_receipt_digest", "issued_at", "key_id", "schema_version", "signature", "signature_algorithm", "task_state_digest", "tenant_id", "verdict_digest", "verdict_id", "work_id"];
function fail(code) { throw new Error(code); }
function errorCode(value) { return String(value?.message || value || ""); }
export function genericWorkCoreJoinSignerInfrastructureCode(value) { const code = errorCode(value); return SIGNER_INFRASTRUCTURE_CODES.has(code) ? code : null; }
export function genericWorkCoreJoinStoreInfrastructureCode(value) { const code = errorCode(value); return STORE_INFRASTRUCTURE_CODES.has(code) ? code : null; }
export function genericWorkCoreJoinInfrastructureCode(value) { return genericWorkCoreJoinSignerInfrastructureCode(value) || genericWorkCoreJoinStoreInfrastructureCode(value); }
export function decodeGenericWorkCoreJoinEd25519Signature(value, code = "generic_work_core_join_signature_invalid") { const resolvedCode = code === "generic_work_core_join_signer_signature_invalid" ? code : "generic_work_core_join_signature_invalid"; if (typeof value !== "string" || value.length !== 86 || !BASE64URL.test(value)) fail(resolvedCode); const bytes = Buffer.from(value, "base64url"); if (bytes.byteLength !== 64 || bytes.toString("base64url") !== value) fail(resolvedCode); return bytes; }
function exact(value, fields, code) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) fail(code); }
function id(value, code) { if (typeof value !== "string" || !ID.test(value)) fail(code); return value; }
function digest(value, code) { if (typeof value !== "string" || !SHA256.test(value)) fail(code); return value; }
function timestamp(value, code) { if (typeof value !== "string" || !ISO.test(value) || new Date(value).toISOString() !== value) fail(code); return Date.parse(value); }
function plainRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function canonical(value) { if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail("generic_work_core_join_input_invalid"); return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
export function genericWorkCoreJoinDigest(value) { return crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
function privateKey(value) { try { const key = crypto.createPrivateKey(value); if (key.asymmetricKeyType !== "ed25519") fail("generic_work_core_join_signing_unavailable"); return key; } catch { fail("generic_work_core_join_signing_unavailable"); } }
function publicKey(value) { try { let key; if (value instanceof crypto.KeyObject) { if (value.type !== "public") fail("generic_work_core_join_verifier_unavailable"); key = value; } else if (typeof value === "string") { const pem = value.trim(); if (!/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----$/.test(pem)) fail("generic_work_core_join_verifier_unavailable"); key = crypto.createPublicKey(pem); } else if (plainRecord(value)) { const fields = Object.keys(value); if (!fields.includes("crv") || !fields.includes("kty") || !fields.includes("x") || fields.some((field) => !["alg", "crv", "kid", "kty", "use", "x"].includes(field)) || value.kty !== "OKP" || value.crv !== "Ed25519" || (value.alg !== undefined && value.alg !== "EdDSA") || (value.use !== undefined && value.use !== "sig") || (value.kid !== undefined && !ID.test(value.kid)) || typeof value.x !== "string" || value.x.length !== 43 || !BASE64URL.test(value.x) || Buffer.from(value.x, "base64url").byteLength !== 32 || Buffer.from(value.x, "base64url").toString("base64url") !== value.x) fail("generic_work_core_join_verifier_unavailable"); key = crypto.createPublicKey({ key: value, format: "jwk" }); } else { fail("generic_work_core_join_verifier_unavailable"); } if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") fail("generic_work_core_join_verifier_unavailable"); return key; } catch { fail("generic_work_core_join_verifier_unavailable"); } }
export function genericWorkCoreJoinSignaturePayload(verdictDigest) { return Buffer.from(`${GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION}\0${digest(verdictDigest, "generic_work_core_join_verdict_digest_invalid")}`, "utf8"); }
export function verifyGenericWorkCoreJoinDigestSignature({ digest: verdictDigest, signature, publicKey: verifierPublicKey } = {}) { const signatureBytes = decodeGenericWorkCoreJoinEd25519Signature(signature, "generic_work_core_join_signer_signature_invalid"); if (!crypto.verify(null, genericWorkCoreJoinSignaturePayload(verdictDigest), publicKey(verifierPublicKey), signatureBytes)) fail("generic_work_core_join_signer_signature_invalid"); return true; }
function publicKeyFingerprint(key) { return crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex"); }
function collection(entries, fields, code, entryCode) { if (!Array.isArray(entries) || entries.length < 1 || entries.length > 4096) fail(code); const ids = new Set(); for (const entry of entries) { exact(entry, fields, entryCode); const entryId = id(entry[fields[0]], entryCode); if (ids.has(entryId)) fail(`${code}_duplicate`); ids.add(entryId); for (const field of fields.slice(1)) digest(entry[field], entryCode); } return genericWorkCoreJoinDigest(entries); }
function evidence(entries) { if (!Array.isArray(entries) || entries.length < 1 || entries.length > 4096) fail("evidence_invalid"); const unique = new Set(entries.map((entry) => digest(entry, "evidence_invalid"))); if (unique.size !== entries.length) fail("evidence_duplicate"); return genericWorkCoreJoinDigest([...unique].sort()); }
function requestMaterial(input) { exact(input, ["acceptance_criteria", "adapter", "evidence_digests", "idempotency_digest", "independent_verifier_receipt", "requester_identity", "requester_session_id", "task_state", "tenant_id", "work_id"], "generic_work_core_join_request_invalid"); const tenant_id = id(input.tenant_id, "tenant_id_invalid"); const work_id = id(input.work_id, "work_id_invalid"); if (!ADAPTERS.has(input.adapter)) fail("adapter_unsupported"); const requester_identity = id(input.requester_identity, "requester_identity_invalid"); const requester_session_id = id(input.requester_session_id, "requester_session_invalid"); const idempotency_digest = digest(input.idempotency_digest, "idempotency_digest_invalid"); const acceptance_criteria_digest = collection(input.acceptance_criteria, ["criterion_id", "criterion_digest", "evidence_digest", "verification_digest"], "acceptance_criteria_invalid", "acceptance_criterion_invalid"); const task_state_digest = collection(input.task_state, ["task_id", "completion_evidence_digest", "task_state_digest", "verification_digest"], "task_state_invalid", "task_state_invalid"); const evidence_digest = evidence(input.evidence_digests); return { tenant_id, work_id, adapter: input.adapter, requester_identity, requester_session_id, idempotency_digest, acceptance_criteria_digest, task_state_digest, evidence_digest, independent_verifier_receipt: input.independent_verifier_receipt, request_canonical: canonical(input), request_digest: genericWorkCoreJoinDigest(input) }; }
function verifyReceipt(value, expected, now, verifier) { exact(value, ["acceptance_criteria_digest", "adapter", "evidence_digest", "expires_at", "issued_at", "nonce", "schema_version", "session_id", "signature", "task_state_digest", "tenant_id", "verification_digest", "verifier_identity", "work_id"], "independent_verifier_receipt_invalid"); if (value.schema_version !== GENERIC_WORK_INDEPENDENT_VERIFIER_RECEIPT_SCHEMA_VERSION || !ADAPTERS.has(value.adapter)) fail("independent_verifier_receipt_invalid"); for (const field of ["tenant_id", "work_id", "verifier_identity", "session_id", "nonce"]) id(value[field], "independent_verifier_receipt_invalid"); for (const field of ["acceptance_criteria_digest", "task_state_digest", "evidence_digest", "verification_digest"]) digest(value[field], "independent_verifier_receipt_invalid"); if (typeof value.signature !== "string" || value.signature.length < 16) fail("independent_verifier_receipt_invalid"); const issued = timestamp(value.issued_at, "independent_verifier_receipt_invalid"); const expires = timestamp(value.expires_at, "independent_verifier_receipt_invalid"); if (!(issued < expires) || expires <= now) fail("independent_verifier_receipt_expired"); for (const field of ["tenant_id", "work_id", "adapter", "acceptance_criteria_digest", "task_state_digest", "evidence_digest"]) if (value[field] !== expected[field]) fail(`independent_verifier_${field}_mismatch`); if (value.verifier_identity === expected.requester_identity || value.session_id === expected.requester_session_id) fail("independent_verifier_not_distinct"); let trusted = false; try { trusted = verifier(Object.freeze(structuredClone(value))) === true; } catch {} if (!trusted) fail("independent_verifier_receipt_untrusted"); return { digest: genericWorkCoreJoinDigest(value), nonce: value.nonce }; }

export function verifyGenericWorkCoreJoinVerdict({ verdict, expected, publicKey: verifierPublicKey, expectedKeyId } = {}) { exact(verdict, VERDICT_FIELDS, "generic_work_core_join_verdict_invalid"); if (verdict.schema_version !== GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION || verdict.authority !== "universal_core" || verdict.decision !== "GENERIC_WORK_CORE_JOIN_ELIGIBLE" || verdict.execution_authorized !== false || verdict.host_action_authorized !== false || verdict.signature_algorithm !== "ed25519") fail("generic_work_core_join_verdict_invalid"); for (const field of ["tenant_id", "work_id", "verdict_id", "key_id"]) id(verdict[field], "generic_work_core_join_verdict_invalid"); if (!ADAPTERS.has(verdict.adapter)) fail("generic_work_core_join_verdict_invalid"); for (const field of ["acceptance_criteria_digest", "task_state_digest", "evidence_digest", "independent_verifier_receipt_digest", "idempotency_digest", "verdict_digest"]) digest(verdict[field], "generic_work_core_join_verdict_invalid"); timestamp(verdict.issued_at, "generic_work_core_join_verdict_invalid"); const { signature, verdict_digest, ...unsigned } = verdict; if (verdict_digest !== genericWorkCoreJoinDigest(unsigned)) fail("generic_work_core_join_verdict_digest_invalid"); if (verdict.key_id !== id(expectedKeyId, "generic_work_core_join_key_id_mismatch")) fail("generic_work_core_join_key_id_mismatch"); const signatureBytes = decodeGenericWorkCoreJoinEd25519Signature(signature); if (!crypto.verify(null, genericWorkCoreJoinSignaturePayload(verdict_digest), publicKey(verifierPublicKey), signatureBytes)) fail("generic_work_core_join_signature_invalid"); exact(expected, ["adapter", "idempotency_digest", "tenant_id", "work_id"], "generic_work_core_join_context_invalid"); for (const field of ["tenant_id", "work_id", "adapter", "idempotency_digest"]) if (verdict[field] !== expected[field]) fail(`generic_work_core_join_${field}_mismatch`); return true; }
export function createGenericWorkCoreJoinVerdictVerifier({ publicKey: verifierPublicKey, keyId } = {}) { const pinned = publicKey(verifierPublicKey); id(keyId, "generic_work_core_join_verifier_unavailable"); return Object.freeze({ schema_version: GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION, key_id: keyId, verify: ({ verdict, expected } = {}) => verifyGenericWorkCoreJoinVerdict({ verdict, expected, publicKey: pinned, expectedKeyId: keyId }) }); }
export function createLocalGenericWorkCoreJoinSigner({ privateKey: material, keyId } = {}) { const signer = privateKey(material); const verifier = crypto.createPublicKey(signer); const resolvedKeyId = id(keyId, "generic_work_core_join_signing_unavailable"); return Object.freeze({ algorithm: "Ed25519", key_id: resolvedKeyId, public_key: verifier, public_key_fingerprint: publicKeyFingerprint(verifier), custody: "local_process_key", signer_state: "ready", signer_reason: null, signDigest: (value) => crypto.sign(null, genericWorkCoreJoinSignaturePayload(value), signer).toString("base64url") }); }
function normalizeSigner(value) { if (!value || value.algorithm !== "Ed25519" || typeof value.signDigest !== "function") fail("generic_work_core_join_signing_unavailable"); const verifier = publicKey(value.public_key); const fingerprint = digest(value.public_key_fingerprint || publicKeyFingerprint(verifier), "generic_work_core_join_signing_unavailable"); if (fingerprint !== publicKeyFingerprint(verifier)) fail("generic_work_core_join_signing_unavailable"); return { ...value, key_id: id(value.key_id, "generic_work_core_join_signing_unavailable"), public_key: verifier, public_key_fingerprint: fingerprint }; }
async function readStore(store, key) { try { return await store.read(key); } catch (error) { fail(genericWorkCoreJoinStoreInfrastructureCode(error) || "generic_work_core_join_store_unavailable"); } }
async function recordStore(store, record) { try { return await store.record(record); } catch (error) { const code = errorCode(error); if (STORE_SEMANTIC_CODES.has(code)) fail(code); fail(genericWorkCoreJoinStoreInfrastructureCode(error) || "generic_work_core_join_store_unavailable"); } }

/** Server-side evidence gate only. It never authorizes a host action. */
export function createGenericWorkCoreJoinAuthority({ signer: suppliedSigner, signingPrivateKey, signingKeyId, now = () => Date.now(), verifyIndependentVerifierReceipt, store } = {}) {
  const signer = normalizeSigner(suppliedSigner || createLocalGenericWorkCoreJoinSigner({ privateKey: signingPrivateKey, keyId: signingKeyId }));
  if (typeof now !== "function" || typeof verifyIndependentVerifierReceipt !== "function" || !store || typeof store.read !== "function" || typeof store.record !== "function") fail("generic_work_core_join_dependency_unavailable");

  async function issueDetailed(input = {}) {
    const material = requestMaterial(input);
    const key = { tenant_id: material.tenant_id, work_id: material.work_id, adapter: material.adapter, idempotency_digest: material.idempotency_digest };
    const prior = await readStore(store, key);
    if (prior) {
      if (prior.request_canonical !== material.request_canonical) fail("generic_work_core_join_idempotency_conflict");
      verifyGenericWorkCoreJoinVerdict({ verdict: prior.verdict, expected: key, publicKey: signer.public_key, expectedKeyId: signer.key_id });
      return Object.freeze({ verdict: Object.freeze(structuredClone(prior.verdict)), fresh_signature_verified: false, durable_record_verified: true });
    }
    const nowValue = now();
    if (!Number.isFinite(nowValue)) fail("clock_invalid");
    const verified = verifyReceipt(material.independent_verifier_receipt, material, nowValue, verifyIndependentVerifierReceipt);
    const unsigned = { schema_version: GENERIC_WORK_CORE_JOIN_SCHEMA_VERSION, verdict_id: `gwcj_${genericWorkCoreJoinDigest({ ...key, receipt_digest: verified.digest }).slice(0, 40)}`, tenant_id: material.tenant_id, work_id: material.work_id, adapter: material.adapter, acceptance_criteria_digest: material.acceptance_criteria_digest, task_state_digest: material.task_state_digest, evidence_digest: material.evidence_digest, independent_verifier_receipt_digest: verified.digest, idempotency_digest: material.idempotency_digest, issued_at: new Date(nowValue).toISOString(), authority: "universal_core", decision: "GENERIC_WORK_CORE_JOIN_ELIGIBLE", execution_authorized: false, host_action_authorized: false, key_id: signer.key_id, signature_algorithm: "ed25519" };
    const verdict_digest = genericWorkCoreJoinDigest(unsigned);
    let signature;
    try {
      signature = await signer.signDigest(verdict_digest);
    } catch (error) {
      fail(genericWorkCoreJoinSignerInfrastructureCode(error) || "generic_work_core_join_signer_unavailable");
    }
    decodeGenericWorkCoreJoinEd25519Signature(signature);
    const verdict = { ...unsigned, verdict_digest, signature };
    verifyGenericWorkCoreJoinVerdict({ verdict, expected: key, publicKey: signer.public_key, expectedKeyId: signer.key_id });
    const recorded = await recordStore(store, { ...key, request_canonical: material.request_canonical, request_digest: material.request_digest, independent_verifier_receipt_digest: verified.digest, verifier_nonce: verified.nonce, verdict });
    if (!recorded || typeof recorded !== "object") fail("generic_work_core_join_store_unavailable");
    if (recorded.request_canonical !== material.request_canonical) fail("generic_work_core_join_idempotency_conflict");
    verifyGenericWorkCoreJoinVerdict({ verdict: recorded.verdict, expected: key, publicKey: signer.public_key, expectedKeyId: signer.key_id });
    return Object.freeze({ verdict: Object.freeze(structuredClone(recorded.verdict)), fresh_signature_verified: true, durable_record_verified: true });
  }

  return Object.freeze({
    signer_metadata: Object.freeze({ algorithm: signer.algorithm, key_id: signer.key_id, public_key_fingerprint: signer.public_key_fingerprint, custody: signer.custody || "external" }),
    async issue(input = {}) { return (await issueDetailed(input)).verdict; },
    issueDetailed,
  });
}
