import crypto from "node:crypto";
import { requireMcpStagingTargetCommit } from "./mcpStagingTargetCommit.js";

const AUDIENCE = "mcp-staging-render-executor";
const TENANT_ID = "codexai";
const TARGET_SERVICE = "skinharmony-core-mcp-staging";
const TARGET_ENVIRONMENT = "staging";
const RECEIPT_OPERATION = "create_only";
const RECEIPT_TTL_MS = 5 * 60_000;
const ISSUER_TTL_MS = 30_000;

const RECEIPT_INPUT_KEYS = Object.freeze([
  "receipt_id",
  "credential_execution_id",
  "issued_at",
  "expires_at",
  "core_key_handle_digest",
]);
const RECEIPT_CLAIM_KEYS = Object.freeze([
  "schema_version",
  "issuer",
  "kid",
  "receipt_id",
  "credential_execution_id",
  "tenant_id",
  "target_service",
  "target_environment",
  "target_commit",
  "operation",
  "issued_at",
  "expires_at",
  "core_key_handle_digest",
  "codex_bearer_mode",
  "secret_values_present",
  "secret_values_persisted",
  "payload_digest",
  "binding_digest",
]);
const OWNER_INPUT_KEYS = Object.freeze([
  "confirmation_reference",
  "authorization_text_digest",
  "attempt_id",
  "deployment_spec_digest",
  "preflight_digest",
  "credential_grant_digest",
  "action_digest",
  "executor_contract_id",
  "issued_at",
  "expires_at",
  "nonce",
]);
const OWNER_CLAIM_KEYS = Object.freeze([
  "schema_version",
  "issuer",
  "audience",
  "kid",
  "tenant_id",
  "target_service",
  "target_environment",
  "target_commit",
  "operation",
  "confirmation_reference",
  "authorization_text_digest",
  "attempt_id",
  "deployment_spec_digest",
  "preflight_digest",
  "credential_grant_digest",
  "action_digest",
  "executor_contract_id",
  "owner_confirmation_digest",
  "issued_at",
  "expires_at",
  "nonce",
]);
const NYRA_CLAIM_KEYS = Object.freeze([
  "schema_version", "issuer", "audience", "request_kind", "decision", "role", "execution_allowed", "risk_band",
  "tenant_id", "domain_pack_id", "target_service", "target_environment", "target_commit", "attempt_id",
  "deployment_spec_digest", "preflight_digest", "credential_grant_digest", "action_digest",
  "executor_contract_id", "issued_at", "expires_at", "nonce",
]);
const VERIFIER_REQUEST_KEYS = Object.freeze([
  "schema_version",
  "mode",
  "request_kind",
  "request_nonce",
  "context",
  "artifacts",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) return false;
  const expected = [...keys].sort();
  actual.sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function mcpStagingCanonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(mcpStagingCanonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${mcpStagingCanonicalJson(value[key])}`).join(",")}}`;
  }
  throw new McpStagingEvidenceError("evidence_non_canonical_value");
}

export function mcpStagingEvidenceDigest(label, value) {
  return crypto.createHash("sha256")
    .update(`${label}\u0000${mcpStagingCanonicalJson(value)}`)
    .digest("hex");
}

function exactDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function exactIso(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function boundedTimes(issuedAt, expiresAt, nowMs, maxTtlMs) {
  if (!exactIso(issuedAt) || !exactIso(expiresAt)) return false;
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  return issued <= nowMs && expires > nowMs && expires > issued && expires - issued <= maxTtlMs;
}

function boundedReceiptTimes(issuedAt, expiresAt, nowMs, allowExpired) {
  if (!exactIso(issuedAt) || !exactIso(expiresAt)) return false;
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  return issued <= nowMs && expires > issued && expires - issued <= RECEIPT_TTL_MS &&
    (allowExpired || expires > nowMs);
}

function publicKey(value, code) {
  try {
    const key = value instanceof crypto.KeyObject && value.type === "public" ? value : crypto.createPublicKey(value);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error("wrong_key");
    return key;
  } catch {
    throw new McpStagingEvidenceError(code);
  }
}

function privateKey(value, code) {
  try {
    if (!(value instanceof crypto.KeyObject) || value.type !== "private" || value.asymmetricKeyType !== "ed25519") {
      throw new Error("wrong_key");
    }
    return value;
  } catch {
    throw new McpStagingEvidenceError(code);
  }
}

function fingerprint(key) {
  return `ed25519-sha256:${crypto.createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
}

function signClaims(claims, signingKey) {
  return Object.freeze({
    claims: Object.freeze(claims),
    signature: crypto.sign(
      null,
      Buffer.from(mcpStagingCanonicalJson(claims), "utf8"),
      signingKey,
    ).toString("base64url"),
  });
}

function verifySignedClaims(envelope, verificationKey, claimKeys, code) {
  if (!exactKeys(envelope, ["claims", "signature"]) || !exactKeys(envelope.claims, claimKeys) ||
      typeof envelope.signature !== "string") {
    throw new McpStagingEvidenceError(code);
  }
  let signature;
  try {
    signature = Buffer.from(envelope.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== envelope.signature) throw new Error("invalid");
  } catch {
    throw new McpStagingEvidenceError(code);
  }
  const verified = crypto.verify(
    null,
    Buffer.from(mcpStagingCanonicalJson(envelope.claims), "utf8"),
    verificationKey,
    signature,
  );
  if (!verified) throw new McpStagingEvidenceError(code);
  return { claims: envelope.claims, signature };
}

export class McpStagingEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingEvidenceError";
    this.code = code;
  }
}

export function issueMcpStagingCredentialReceipt(input, signingKeyValue, options = {}) {
  const targetCommit = requireMcpStagingTargetCommit(options.targetCommit);
  if (!exactKeys(input, RECEIPT_INPUT_KEYS) ||
      !/^mcpstg_receipt_[A-Za-z0-9_-]{16,96}$/.test(String(input.receipt_id || "")) ||
      !/^[A-Za-z0-9._:-]{8,160}$/.test(String(input.credential_execution_id || "")) ||
      !exactDigest(input.core_key_handle_digest) || !exactIso(input.issued_at) || !exactIso(input.expires_at) ||
      Date.parse(input.expires_at) <= Date.parse(input.issued_at) ||
      Date.parse(input.expires_at) - Date.parse(input.issued_at) > RECEIPT_TTL_MS) {
    throw new McpStagingEvidenceError("credential_receipt_input_invalid");
  }
  const signingKey = privateKey(signingKeyValue, "credential_receipt_private_key_invalid");
  const kid = fingerprint(crypto.createPublicKey(signingKey));
  const payload = {
    credential_execution_id: input.credential_execution_id,
    core_key_handle_digest: input.core_key_handle_digest,
    codex_bearer_mode: "render_generate_value_on_create",
    secret_values_present: false,
    secret_values_persisted: false,
  };
  const base = {
    schema_version: "mcp_staging_credential_receipt_v1",
    issuer: "universal-core",
    kid,
    receipt_id: input.receipt_id,
    credential_execution_id: input.credential_execution_id,
    tenant_id: TENANT_ID,
    target_service: TARGET_SERVICE,
    target_environment: TARGET_ENVIRONMENT,
    target_commit: targetCommit,
    operation: RECEIPT_OPERATION,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    core_key_handle_digest: input.core_key_handle_digest,
    codex_bearer_mode: payload.codex_bearer_mode,
    secret_values_present: false,
    secret_values_persisted: false,
    payload_digest: mcpStagingEvidenceDigest("mcp-staging-credential-receipt-payload-v1", payload),
  };
  const claims = {
    ...base,
    binding_digest: mcpStagingEvidenceDigest("mcp-staging-credential-receipt-binding-v1", base),
  };
  return signClaims(claims, signingKey);
}

export function createMcpStagingCredentialReceiptVerifier({
  publicKey: keyValue,
  now = Date.now,
  allowExpired = false,
  targetCommit: targetCommitValue,
} = {}) {
  const targetCommit = requireMcpStagingTargetCommit(targetCommitValue);
  const verificationKey = publicKey(keyValue, "credential_receipt_public_key_invalid");
  const expectedKid = fingerprint(verificationKey);
  if (typeof now !== "function" || typeof allowExpired !== "boolean") {
    throw new McpStagingEvidenceError("credential_receipt_clock_invalid");
  }
  return async function verifyReceipt(envelope) {
    const { claims, signature } = verifySignedClaims(
      envelope,
      verificationKey,
      RECEIPT_CLAIM_KEYS,
      "credential_receipt_signature_invalid",
    );
    const timestamp = now();
    if (!Number.isFinite(timestamp) || claims.schema_version !== "mcp_staging_credential_receipt_v1" ||
        claims.issuer !== "universal-core" || claims.kid !== expectedKid ||
        !/^mcpstg_receipt_[A-Za-z0-9_-]{16,96}$/.test(claims.receipt_id) ||
        !/^[A-Za-z0-9._:-]{8,160}$/.test(claims.credential_execution_id) ||
        claims.tenant_id !== TENANT_ID || claims.target_service !== TARGET_SERVICE ||
        claims.target_environment !== TARGET_ENVIRONMENT || claims.target_commit !== targetCommit ||
        claims.operation !== RECEIPT_OPERATION ||
        !boundedReceiptTimes(claims.issued_at, claims.expires_at, timestamp, allowExpired) ||
        !exactDigest(claims.core_key_handle_digest) || claims.codex_bearer_mode !== "render_generate_value_on_create" ||
        claims.secret_values_present !== false || claims.secret_values_persisted !== false ||
        !exactDigest(claims.payload_digest) || !exactDigest(claims.binding_digest)) {
      throw new McpStagingEvidenceError("credential_receipt_contract_invalid");
    }
    const base = { ...claims };
    delete base.binding_digest;
    const expectedBinding = mcpStagingEvidenceDigest("mcp-staging-credential-receipt-binding-v1", base);
    const expectedPayload = mcpStagingEvidenceDigest("mcp-staging-credential-receipt-payload-v1", {
      credential_execution_id: claims.credential_execution_id,
      core_key_handle_digest: claims.core_key_handle_digest,
      codex_bearer_mode: claims.codex_bearer_mode,
      secret_values_present: false,
      secret_values_persisted: false,
    });
    if (claims.binding_digest !== expectedBinding || claims.payload_digest !== expectedPayload) {
      throw new McpStagingEvidenceError("credential_receipt_digest_invalid");
    }
    return Object.freeze({
      schema_version: "mcp_staging_verified_credential_receipt_v1",
      receipt_id: claims.receipt_id,
      issuer: claims.issuer,
      kid: claims.kid,
      verification_method: "ed25519",
      signature_verified: true,
      signature_digest: crypto.createHash("sha256").update(signature).digest("hex"),
      payload_digest: claims.payload_digest,
      binding_digest: claims.binding_digest,
      credential_execution_id: claims.credential_execution_id,
      tenant_id: claims.tenant_id,
      target_service: claims.target_service,
      target_environment: claims.target_environment,
      target_commit: claims.target_commit,
      operation: claims.operation,
      issued_at: claims.issued_at,
      expires_at: claims.expires_at,
      core_key_handle_digest: claims.core_key_handle_digest,
      codex_bearer_mode: claims.codex_bearer_mode,
      secret_values_present: false,
      secret_values_persisted: false,
    });
  };
}

export function loadMcpStagingPublicTrustAnchor({ authority, jwkJson, expectedKid } = {}) {
  if (!new Set(["receipt", "owner", "core", "nyra"]).has(authority) ||
      typeof jwkJson !== "string" || jwkJson.length < 32 || jwkJson.length > 2_048 ||
      !/^ed25519-sha256:[a-f0-9]{64}$/.test(String(expectedKid || ""))) {
    throw new McpStagingEvidenceError("public_trust_anchor_invalid");
  }
  let jwk;
  try {
    jwk = JSON.parse(jwkJson);
  } catch {
    throw new McpStagingEvidenceError("public_trust_anchor_invalid");
  }
  if (!exactKeys(jwk, ["alg", "crv", "kid", "kty", "use", "x"]) ||
      jwk.alg !== "EdDSA" || jwk.crv !== "Ed25519" || jwk.kty !== "OKP" || jwk.use !== "sig" ||
      jwk.kid !== expectedKid || typeof jwk.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x)) {
    throw new McpStagingEvidenceError("public_trust_anchor_invalid");
  }
  const verificationKey = publicKey({ key: jwk, format: "jwk" }, "public_trust_anchor_invalid");
  if (fingerprint(verificationKey) !== expectedKid) {
    throw new McpStagingEvidenceError("public_trust_anchor_invalid");
  }
  return Object.freeze({ authority, kid: expectedKid, publicKey: verificationKey });
}

export function issueMcpStagingOwnerConfirmation(input, signingKeyValue, options = {}) {
  const targetCommit = requireMcpStagingTargetCommit(options.targetCommit);
  if (!exactKeys(input, OWNER_INPUT_KEYS) ||
      !/^[A-Za-z0-9._:-]{8,160}$/.test(String(input.confirmation_reference || "")) ||
      !exactDigest(input.authorization_text_digest) ||
      !/^[A-Za-z0-9._:-]{8,160}$/.test(String(input.attempt_id || "")) ||
      !exactDigest(input.deployment_spec_digest) || !exactDigest(input.preflight_digest) ||
      !exactDigest(input.credential_grant_digest) || !exactDigest(input.action_digest) ||
      input.executor_contract_id !== `domain_action_${String(input.action_digest || "").slice(0, 20)}` ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(String(input.nonce || "")) ||
      !exactIso(input.issued_at) || !exactIso(input.expires_at) ||
      Date.parse(input.expires_at) <= Date.parse(input.issued_at) ||
      Date.parse(input.expires_at) - Date.parse(input.issued_at) > RECEIPT_TTL_MS) {
    throw new McpStagingEvidenceError("owner_confirmation_input_invalid");
  }
  const signingKey = privateKey(signingKeyValue, "owner_confirmation_private_key_invalid");
  const base = {
    tenant_id: TENANT_ID,
    target_service: TARGET_SERVICE,
    target_environment: TARGET_ENVIRONMENT,
    target_commit: targetCommit,
    operation: "mcp_staging_dependency_alignment",
    confirmation_reference: input.confirmation_reference,
    authorization_text_digest: input.authorization_text_digest,
    attempt_id: input.attempt_id,
    deployment_spec_digest: input.deployment_spec_digest,
    preflight_digest: input.preflight_digest,
    credential_grant_digest: input.credential_grant_digest,
    action_digest: input.action_digest,
    executor_contract_id: input.executor_contract_id,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    nonce: input.nonce,
  };
  const claims = {
    schema_version: "mcp_staging_owner_confirmation_v1",
    issuer: "universal-core-owner-gate",
    audience: AUDIENCE,
    kid: fingerprint(crypto.createPublicKey(signingKey)),
    ...base,
    owner_confirmation_digest: mcpStagingEvidenceDigest("mcp-staging-owner-confirmation-v1", base),
  };
  return signClaims(claims, signingKey);
}

export function createMcpStagingOwnerConfirmationVerifier({
  publicKey: keyValue,
  now = Date.now,
  allowExpired = false,
  targetCommit: targetCommitValue,
} = {}) {
  const targetCommit = requireMcpStagingTargetCommit(targetCommitValue);
  const verificationKey = publicKey(keyValue, "owner_confirmation_public_key_invalid");
  const expectedKid = fingerprint(verificationKey);
  if (typeof now !== "function" || typeof allowExpired !== "boolean") {
    throw new McpStagingEvidenceError("owner_confirmation_clock_invalid");
  }
  return async function verifyOwner(envelope) {
    const { claims } = verifySignedClaims(
      envelope,
      verificationKey,
      OWNER_CLAIM_KEYS,
      "owner_confirmation_signature_invalid",
    );
    const timestamp = now();
    const base = {
      tenant_id: claims.tenant_id,
      target_service: claims.target_service,
      target_environment: claims.target_environment,
      target_commit: claims.target_commit,
      operation: claims.operation,
      confirmation_reference: claims.confirmation_reference,
      authorization_text_digest: claims.authorization_text_digest,
      attempt_id: claims.attempt_id,
      deployment_spec_digest: claims.deployment_spec_digest,
      preflight_digest: claims.preflight_digest,
      credential_grant_digest: claims.credential_grant_digest,
      action_digest: claims.action_digest,
      executor_contract_id: claims.executor_contract_id,
      issued_at: claims.issued_at,
      expires_at: claims.expires_at,
      nonce: claims.nonce,
    };
    if (!Number.isFinite(timestamp) || claims.schema_version !== "mcp_staging_owner_confirmation_v1" ||
        claims.issuer !== "universal-core-owner-gate" || claims.audience !== AUDIENCE || claims.kid !== expectedKid ||
        claims.tenant_id !== TENANT_ID || claims.target_service !== TARGET_SERVICE ||
        claims.target_environment !== TARGET_ENVIRONMENT || claims.target_commit !== targetCommit ||
        claims.operation !== "mcp_staging_dependency_alignment" ||
        !/^[A-Za-z0-9._:-]{8,160}$/.test(claims.confirmation_reference) ||
        !exactDigest(claims.authorization_text_digest) ||
        !/^[A-Za-z0-9._:-]{8,160}$/.test(claims.attempt_id) ||
        !exactDigest(claims.deployment_spec_digest) || !exactDigest(claims.preflight_digest) ||
        !exactDigest(claims.credential_grant_digest) || !exactDigest(claims.action_digest) ||
        claims.executor_contract_id !== `domain_action_${claims.action_digest.slice(0, 20)}` ||
        !exactDigest(claims.owner_confirmation_digest) ||
        claims.owner_confirmation_digest !== mcpStagingEvidenceDigest("mcp-staging-owner-confirmation-v1", base) ||
        !boundedReceiptTimes(claims.issued_at, claims.expires_at, timestamp, allowExpired) ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(claims.nonce)) {
      throw new McpStagingEvidenceError("owner_confirmation_contract_invalid");
    }
    return Object.freeze(structuredClone(claims));
  };
}

function verifyNyraAttestation(envelope, keyValue, context, nowMs, targetCommit) {
  const verificationKey = publicKey(keyValue, "nyra_attestation_public_key_invalid");
  const { claims } = verifySignedClaims(
    envelope,
    verificationKey,
    NYRA_CLAIM_KEYS,
    "nyra_attestation_signature_invalid",
  );
  if (claims.schema_version !== "nyra_mcp_staging_deploy_attestation_v1" || claims.issuer !== "nyra" ||
      claims.audience !== AUDIENCE || claims.request_kind !== "issue" ||
      claims.decision !== "no_objection" || claims.role !== "advisory_veto" ||
      claims.execution_allowed !== false || claims.risk_band !== "bounded_staging" ||
      claims.tenant_id !== TENANT_ID || claims.domain_pack_id !== "skinharmony" ||
      claims.target_service !== TARGET_SERVICE || claims.target_environment !== TARGET_ENVIRONMENT ||
      claims.target_commit !== targetCommit || claims.attempt_id !== context.attempt_id ||
      claims.deployment_spec_digest !== context.deployment_spec_digest ||
      claims.preflight_digest !== context.preflight_digest ||
      claims.credential_grant_digest !== context.credential_grant_digest ||
      claims.action_digest !== context.action_digest || claims.executor_contract_id !== context.executor_contract_id ||
      claims.nonce.length !== 32 || !boundedTimes(claims.issued_at, claims.expires_at, nowMs, ISSUER_TTL_MS)) {
    throw new McpStagingEvidenceError("nyra_attestation_contract_invalid");
  }
  return claims;
}

export function createMcpStagingIssuerEvidenceVerifier({
  mode,
  receiptVerifier,
  ownerConfirmationVerifier,
  nyraPublicKey,
  nyraAttestationVerifier,
  now = Date.now,
  targetCommit: targetCommitValue,
} = {}) {
  const targetCommit = requireMcpStagingTargetCommit(targetCommitValue);
  if (!["core", "nyra"].includes(mode) || typeof receiptVerifier !== "function" ||
      typeof ownerConfirmationVerifier !== "function" || typeof now !== "function" ||
      (mode === "core" && typeof nyraAttestationVerifier !== "function" && nyraPublicKey === undefined)) {
    throw new McpStagingEvidenceError("issuer_evidence_dependencies_invalid");
  }
  return async function verifyIssuerEvidence(request) {
    if (!exactKeys(request, VERIFIER_REQUEST_KEYS) ||
        request.schema_version !== "mcp_staging_issuer_evidence_verification_request_v1" ||
        request.mode !== mode || !["issue", "readiness_probe"].includes(request.request_kind) ||
        !/^[A-Za-z0-9_-]{32}$/.test(String(request.request_nonce || ""))) {
      throw new McpStagingEvidenceError("issuer_evidence_request_invalid");
    }
    const context = request.context;
    const artifactKeys = mode === "core"
      ? ["credential_receipt", "nyra_attestation", "owner_confirmation"]
      : ["credential_receipt", "owner_confirmation"];
    if (!exactKeys(request.artifacts, artifactKeys)) {
      throw new McpStagingEvidenceError("issuer_evidence_request_invalid");
    }
    const timestamp = now();
    if (!Number.isFinite(timestamp) || !isPlainObject(context)) {
      throw new McpStagingEvidenceError("issuer_evidence_request_invalid");
    }
    const activeReceiptEnvelope = request.artifacts.credential_receipt;
    const activeOwnerEnvelope = request.artifacts.owner_confirmation;
    const receipt = await receiptVerifier(activeReceiptEnvelope);
    const owner = await ownerConfirmationVerifier(activeOwnerEnvelope);
    if (receipt.binding_digest !== context.credential_grant_digest ||
        receipt.credential_execution_id !== context.credential_execution_id ||
        owner.attempt_id !== context.attempt_id ||
        owner.deployment_spec_digest !== context.deployment_spec_digest ||
        owner.preflight_digest !== context.preflight_digest ||
        owner.credential_grant_digest !== context.credential_grant_digest ||
        owner.action_digest !== context.action_digest ||
        owner.executor_contract_id !== context.executor_contract_id ||
        !exactDigest(owner.owner_confirmation_digest) ||
        receipt.tenant_id !== context.tenant_id || receipt.target_service !== context.target_service ||
        receipt.target_environment !== context.target_environment || receipt.target_commit !== context.target_commit) {
      throw new McpStagingEvidenceError("issuer_evidence_binding_invalid");
    }
    const verifiedAt = new Date(timestamp).toISOString();
    let expiresAtMs = Math.min(timestamp + 20_000, Date.parse(receipt.expires_at), Date.parse(owner.expires_at));
    const common = {
      verified: true,
      mode,
      request_nonce: request.request_nonce,
      tenant_id: TENANT_ID,
      target_service: TARGET_SERVICE,
      target_environment: TARGET_ENVIRONMENT,
      target_commit: targetCommit,
      attempt_id: context.attempt_id,
      deployment_spec_digest: context.deployment_spec_digest,
      preflight_digest: context.preflight_digest,
      credential_grant_digest: context.credential_grant_digest,
      credential_receipt_verified: true,
      credential_receipt_digest: receipt.binding_digest,
      action_digest: context.action_digest,
      executor_contract_id: context.executor_contract_id,
      verified_at: verifiedAt,
      expires_at: "",
    };
    if (mode === "nyra") {
      return Object.freeze({
        schema_version: "nyra_mcp_staging_independent_evidence_v1",
        ...common,
        expires_at: new Date(expiresAtMs).toISOString(),
        decision: "no_objection",
        risk_band: "bounded_staging",
      });
    }
    const activeNyraEnvelope = request.artifacts.nyra_attestation;
    const nyraClaims = typeof nyraAttestationVerifier === "function"
      ? await nyraAttestationVerifier(activeNyraEnvelope, context, timestamp)
      : verifyNyraAttestation(activeNyraEnvelope, nyraPublicKey, context, timestamp, targetCommit);
    const nyraDigest = mcpStagingEvidenceDigest("mcp-staging-nyra-attestation-v1", activeNyraEnvelope);
    if (nyraDigest !== context.nyra_attestation_digest) {
      throw new McpStagingEvidenceError("nyra_attestation_digest_mismatch");
    }
    expiresAtMs = Math.min(expiresAtMs, Date.parse(nyraClaims.expires_at));
    return Object.freeze({
      schema_version: "core_mcp_staging_independent_evidence_v1",
      ...common,
      expires_at: new Date(expiresAtMs).toISOString(),
      decision: "allow",
      state: "authorized_after_confirmation",
      scope: "reversible_owner_confirmed_mcp_staging_service",
      domain_action_id: "skinharmony_mcp_staging_render_create_v1",
      credential_execution_id: context.credential_execution_id,
      credential_action_digest: context.credential_action_digest,
      credential_executor_contract_id: context.credential_executor_contract_id,
      owner_confirmation_verified: true,
      confirmation_reference: owner.confirmation_reference,
      owner_confirmation_digest: owner.owner_confirmation_digest,
      nyra_attestation_verified: true,
      nyra_attestation_digest: nyraDigest,
      core_key_id: `key_staging-${receipt.core_key_handle_digest.slice(0, 16)}`,
      revalidation_required: true,
    });
  };
}

export const mcpStagingEvidenceContract = Object.freeze({
  audience: AUDIENCE,
  tenant_id: TENANT_ID,
  target_service: TARGET_SERVICE,
  target_environment: TARGET_ENVIRONMENT,
  target_commit_required: true,
  receipt_operation: RECEIPT_OPERATION,
});
