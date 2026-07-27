import crypto from "node:crypto";
import {
  createMcpStagingCredentialReceiptVerifier,
  createMcpStagingOwnerConfirmationVerifier,
  loadMcpStagingPublicTrustAnchor,
  mcpStagingCanonicalJson,
  mcpStagingEvidenceDigest,
} from "./mcpStagingEvidence.js";
import { requireMcpStagingTargetCommit } from "./mcpStagingTargetCommit.js";

const AUDIENCE = "mcp-staging-render-executor";
const TENANT_ID = "codexai";
const DOMAIN_PACK_ID = "skinharmony";
const TARGET_SERVICE = "skinharmony-core-mcp-staging";
const TARGET_ENVIRONMENT = "staging";
const EXECUTION_ID = "skinharmony-core-mcp-staging-render-create-v1";
const MAX_ISSUER_TTL_MS = 30_000;

const ENVELOPE_KEYS = Object.freeze(["claims", "signature"]);
const ANCHOR_KEYS = Object.freeze(["expectedKid", "jwkJson"]);
const CONSUMPTION_KEYS = Object.freeze([
  "execution_id",
  "attempt_id",
  "action_digest",
  "executor_contract_id",
  "deployment_spec_digest",
  "preflight_digest",
  "credential_grant_digest",
  "core_grant_digest",
  "nyra_attestation_digest",
  "owner_confirmation_digest",
]);
const NYRA_CLAIM_KEYS = Object.freeze([
  "schema_version", "issuer", "audience", "request_kind", "decision", "role", "execution_allowed",
  "risk_band", "tenant_id", "domain_pack_id", "target_service", "target_environment", "target_commit",
  "attempt_id", "deployment_spec_digest", "preflight_digest", "credential_grant_digest", "action_digest",
  "executor_contract_id", "issued_at", "expires_at", "nonce",
]);
const CORE_CLAIM_KEYS = Object.freeze([
  "schema_version", "issuer", "audience", "request_kind", "decision", "state", "scope",
  "domain_action_id", "tenant_id", "domain_pack_id", "core_key_id", "core_key_type", "core_key_scope",
  "target_service", "target_environment", "target_commit", "attempt_id", "deployment_spec_digest",
  "preflight_digest", "credential_grant_digest", "credential_execution_id", "credential_action_digest",
  "credential_executor_contract_id", "credential_receipt_verified", "nyra_attestation_digest",
  "action_digest", "executor_contract_id", "confirmation_reference", "owner_confirmation_digest",
  "confirmation_satisfied", "revalidation_required", "nyra_available", "issued_at", "expires_at", "nonce",
]);

export class McpStagingConsumptionEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingConsumptionEvidenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new McpStagingConsumptionEvidenceError(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) return false;
  return actual.sort().join("\u0000") === [...expected].sort().join("\u0000");
}

function exactDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function exactIso(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function verifyIssuerTimes(claims, nowMs, authority) {
  if (!exactIso(claims.issued_at) || !exactIso(claims.expires_at)) fail(`${authority}_grant_ttl_invalid`);
  const issuedAt = Date.parse(claims.issued_at);
  const expiresAt = Date.parse(claims.expires_at);
  if (issuedAt > nowMs || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_ISSUER_TTL_MS) {
    fail(`${authority}_grant_ttl_invalid`);
  }
  return expiresAt > nowMs;
}

function verifyEnvelope(envelope, anchor, claimKeys, authority) {
  if (!exactKeys(envelope, ENVELOPE_KEYS) || !exactKeys(envelope.claims, claimKeys) ||
      typeof envelope.signature !== "string") {
    fail(`${authority}_grant_envelope_invalid`);
  }
  let signature;
  try {
    signature = Buffer.from(envelope.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== envelope.signature) throw new Error("invalid");
  } catch {
    fail(`${authority}_grant_envelope_invalid`);
  }
  let verified = false;
  try {
    verified = crypto.verify(
      null,
      Buffer.from(mcpStagingCanonicalJson(envelope.claims), "utf8"),
      anchor.publicKey,
      signature,
    );
  } catch {
    verified = false;
  }
  if (!verified) fail(`${authority}_grant_signature_invalid`);
  return envelope.claims;
}

function loadAnchor(authority, descriptor) {
  if (!exactKeys(descriptor, ANCHOR_KEYS)) fail("consumption_trust_anchor_invalid");
  try {
    return loadMcpStagingPublicTrustAnchor({ authority, ...descriptor });
  } catch {
    fail("consumption_trust_anchor_invalid");
  }
}

function normalizedConsumption(value) {
  if (!exactKeys(value, CONSUMPTION_KEYS) || value.execution_id !== EXECUTION_ID ||
      !/^mcpstg_[A-Za-z0-9._:-]{8,120}$/.test(String(value.attempt_id || "")) ||
      !exactDigest(value.action_digest) ||
      value.executor_contract_id !== `domain_action_${String(value.action_digest || "").slice(0, 20)}` ||
      !exactDigest(value.deployment_spec_digest) || !exactDigest(value.preflight_digest) ||
      !exactDigest(value.credential_grant_digest) || !exactDigest(value.core_grant_digest) ||
      !exactDigest(value.nyra_attestation_digest) || !exactDigest(value.owner_confirmation_digest)) {
    fail("consumption_binding_invalid");
  }
  return structuredClone(value);
}

function verifyCommonIssuerClaims(claims, binding, authority, targetCommit) {
  const fixed = {
    audience: AUDIENCE,
    request_kind: "issue",
    tenant_id: TENANT_ID,
    domain_pack_id: DOMAIN_PACK_ID,
    target_service: TARGET_SERVICE,
    target_environment: TARGET_ENVIRONMENT,
    target_commit: targetCommit,
    attempt_id: binding.attempt_id,
    deployment_spec_digest: binding.deployment_spec_digest,
    preflight_digest: binding.preflight_digest,
    credential_grant_digest: binding.credential_grant_digest,
    action_digest: binding.action_digest,
    executor_contract_id: binding.executor_contract_id,
  };
  for (const [key, expected] of Object.entries(fixed)) {
    if (claims[key] !== expected) fail(`${authority}_grant_binding_invalid`);
  }
  if (!/^[A-Za-z0-9_-]{32}$/.test(String(claims.nonce || ""))) fail(`${authority}_grant_binding_invalid`);
}

function verifyNyraClaims(claims, binding, targetCommit) {
  verifyCommonIssuerClaims(claims, binding, "nyra", targetCommit);
  if (claims.schema_version !== "nyra_mcp_staging_deploy_attestation_v1" || claims.issuer !== "nyra" ||
      claims.decision !== "no_objection" || claims.role !== "advisory_veto" ||
      claims.execution_allowed !== false || claims.risk_band !== "bounded_staging") {
    fail("nyra_grant_contract_invalid");
  }
}

function verifyCoreClaims(claims, binding, receipt, owner, nyraDigest, targetCommit) {
  verifyCommonIssuerClaims(claims, binding, "core", targetCommit);
  if (claims.schema_version !== "core_mcp_staging_render_grant_v1" || claims.issuer !== "universal-core" ||
      claims.decision !== "allow" || claims.state !== "authorized_after_confirmation" ||
      claims.scope !== "reversible_owner_confirmed_mcp_staging_service" ||
      claims.domain_action_id !== "skinharmony_mcp_staging_render_create_v1" ||
      claims.core_key_id !== `key_staging-${receipt.core_key_handle_digest.slice(0, 16)}` ||
      claims.core_key_type !== "staging_executor" || claims.core_key_scope !== "mcp_staging_render_create" ||
      claims.credential_execution_id !== receipt.credential_execution_id ||
      !exactDigest(claims.credential_action_digest) ||
      claims.credential_executor_contract_id !==
        `domain_action_${String(claims.credential_action_digest || "").slice(0, 20)}` ||
      claims.credential_receipt_verified !== true || claims.nyra_attestation_digest !== nyraDigest ||
      claims.confirmation_reference !== owner.confirmation_reference ||
      claims.owner_confirmation_digest !== owner.owner_confirmation_digest ||
      claims.confirmation_satisfied !== true || claims.revalidation_required !== true ||
      claims.nyra_available !== true) {
    fail("core_grant_contract_invalid");
  }
}

export function createMcpStagingConsumptionEvidenceVerifier(options = {}) {
  if (!isPlainObject(options) ||
      Reflect.ownKeys(options).some((key) =>
        !["receipt", "owner", "core", "nyra", "now", "targetCommit"].includes(key)) ||
      !["receipt", "owner", "core", "nyra"].every((key) => key in options)) {
    fail("consumption_verifier_options_invalid");
  }
  let targetCommit;
  try {
    targetCommit = requireMcpStagingTargetCommit(options.targetCommit);
  } catch {
    fail("consumption_target_commit_invalid");
  }
  const now = options.now === undefined ? Date.now : options.now;
  if (typeof now !== "function") fail("consumption_verifier_clock_invalid");
  const anchors = Object.freeze({
    receipt: loadAnchor("receipt", options.receipt),
    owner: loadAnchor("owner", options.owner),
    core: loadAnchor("core", options.core),
    nyra: loadAnchor("nyra", options.nyra),
  });
  if (new Set(Object.values(anchors).map((anchor) => anchor.kid)).size !== 4) {
    fail("consumption_trust_anchors_not_independent");
  }
  const verifyReceipt = createMcpStagingCredentialReceiptVerifier({
    publicKey: anchors.receipt.publicKey,
    now,
    allowExpired: true,
    targetCommit,
  });
  const verifyOwner = createMcpStagingOwnerConfirmationVerifier({
    publicKey: anchors.owner.publicKey,
    now,
    allowExpired: true,
    targetCommit,
  });

  return async function verifyConsumptionEvidence(input) {
    if (!exactKeys(input, [
      "credential_receipt", "owner_confirmation", "core_grant", "nyra_attestation", "consumption",
    ])) {
      fail("consumption_evidence_input_invalid");
    }
    const timestamp = now();
    if (!Number.isFinite(timestamp)) fail("consumption_verifier_clock_invalid");
    let receipt;
    let owner;
    try {
      [receipt, owner] = await Promise.all([
        verifyReceipt(input.credential_receipt),
        verifyOwner(input.owner_confirmation),
      ]);
    } catch {
      fail("consumption_base_evidence_invalid");
    }
    const binding = normalizedConsumption(input.consumption);
    const nyraClaims = verifyEnvelope(input.nyra_attestation, anchors.nyra, NYRA_CLAIM_KEYS, "nyra");
    const coreClaims = verifyEnvelope(input.core_grant, anchors.core, CORE_CLAIM_KEYS, "core");
    const nyraDigest = mcpStagingEvidenceDigest("mcp-staging-nyra-attestation-v1", input.nyra_attestation);
    const coreDigest = mcpStagingEvidenceDigest("mcp-staging-core-grant-v1", input.core_grant);

    if (binding.credential_grant_digest !== receipt.binding_digest ||
        binding.owner_confirmation_digest !== owner.owner_confirmation_digest ||
        binding.nyra_attestation_digest !== nyraDigest || binding.core_grant_digest !== coreDigest ||
        owner.attempt_id !== binding.attempt_id || owner.deployment_spec_digest !== binding.deployment_spec_digest ||
        owner.preflight_digest !== binding.preflight_digest ||
        owner.credential_grant_digest !== binding.credential_grant_digest ||
        owner.action_digest !== binding.action_digest || owner.executor_contract_id !== binding.executor_contract_id) {
      fail("consumption_cross_binding_invalid");
    }
    verifyNyraClaims(nyraClaims, binding, targetCommit);
    verifyCoreClaims(coreClaims, binding, receipt, owner, nyraDigest, targetCommit);
    const receiptCurrent = Date.parse(receipt.expires_at) > timestamp;
    const ownerCurrent = Date.parse(owner.expires_at) > timestamp;
    const nyraCurrent = verifyIssuerTimes(nyraClaims, timestamp, "nyra");
    const coreCurrent = verifyIssuerTimes(coreClaims, timestamp, "core");

    return Object.freeze({
      receipt_evidence: receipt,
      consumption: Object.freeze({
        ...binding,
        core_grant_digest: coreDigest,
        nyra_attestation_digest: nyraDigest,
        owner_confirmation_digest: owner.owner_confirmation_digest,
      }),
      temporally_current: receiptCurrent && ownerCurrent && nyraCurrent && coreCurrent,
    });
  };
}
