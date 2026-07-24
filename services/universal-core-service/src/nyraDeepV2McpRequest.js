import crypto from "node:crypto";

export const NYRA_DEEP_V2_MCP_REQUEST_SCHEMA_VERSION = "mcp_nyra_deep_branch_v2_request_attestation_v1";
export const NYRA_DEEP_V2_MCP_REQUEST_ISSUER = "skinharmony-core-mcp";
export const NYRA_DEEP_V2_MCP_REQUEST_MAX_AGE_SECONDS = 60;

const OPERATION_SET = new Set(["preview", "requirements", "prepare_evidence", "evaluate"]);
const ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const MAX_REPLAY_ENTRIES = 4_096;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

export function nyraDeepV2StableJson(value) {
  return JSON.stringify(stableCanonical(value));
}

export function nyraDeepV2EvidencePackHash(evidencePack, requirementBindings) {
  return crypto
    .createHash("sha256")
    .update(nyraDeepV2StableJson({ evidence_pack: evidencePack, requirement_bindings: requirementBindings }))
    .digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function payloadFrom(attestation) {
  const payload = {
    tenant_id: attestation.tenant_id,
    request_id: attestation.request_id,
    operation: attestation.operation,
    ...(attestation.branch_id ? { branch_id: attestation.branch_id } : {}),
    ...(attestation.subbranch_id ? { subbranch_id: attestation.subbranch_id } : {}),
    ...(attestation.evidence_refs ? { evidence_refs: attestation.evidence_refs } : {}),
    ...(attestation.evidence_pack_hash ? { evidence_pack_hash: attestation.evidence_pack_hash } : {}),
    issued_at: attestation.issued_at,
    nonce: attestation.nonce,
  };
  return payload;
}

function expectedKeys(operation) {
  const base = [
    "schema_version",
    "issuer",
    "tenant_id",
    "request_id",
    "operation",
    "evidence_refs",
    "issued_at",
    "nonce",
    "max_age_seconds",
    "signature",
  ];
  if (["requirements", "prepare_evidence", "evaluate"].includes(operation)) base.push("branch_id", "subbranch_id");
  if (operation === "prepare_evidence") base.push("evidence_pack_hash");
  return base.sort();
}

function normalizedEvidenceRefs(values) {
  if (!Array.isArray(values) || values.length > 100) return null;
  const refs = values.map((value) => String(value || "").trim());
  if (refs.some((value) => !SHA256_PATTERN.test(value)) || new Set(refs).size !== refs.length) return null;
  return refs;
}

function baseValidity(attestation, { tenantId, requestId, operation, nowMs }) {
  if (!isPlainObject(attestation) || !OPERATION_SET.has(operation)) return { ok: false, reason: "nyra_deep_v2_mcp_attestation_required" };
  if (JSON.stringify(Object.keys(attestation).sort()) !== JSON.stringify(expectedKeys(operation))) {
    return { ok: false, reason: "nyra_deep_v2_mcp_attestation_schema_invalid" };
  }
  if (
    attestation.schema_version !== NYRA_DEEP_V2_MCP_REQUEST_SCHEMA_VERSION
    || attestation.issuer !== NYRA_DEEP_V2_MCP_REQUEST_ISSUER
    || attestation.tenant_id !== tenantId
    || attestation.request_id !== requestId
    || attestation.operation !== operation
    || !REQUEST_ID_PATTERN.test(String(requestId || ""))
    || attestation.max_age_seconds !== NYRA_DEEP_V2_MCP_REQUEST_MAX_AGE_SECONDS
    || !NONCE_PATTERN.test(String(attestation.nonce || ""))
    || !SHA256_PATTERN.test(String(attestation.signature || ""))
  ) return { ok: false, reason: "nyra_deep_v2_mcp_attestation_fields_invalid" };
  const issuedAt = Date.parse(String(attestation.issued_at || ""));
  if (!Number.isFinite(issuedAt) || issuedAt > nowMs + 15_000 || nowMs - issuedAt > NYRA_DEEP_V2_MCP_REQUEST_MAX_AGE_SECONDS * 1_000) {
    return { ok: false, reason: "nyra_deep_v2_mcp_attestation_expired" };
  }
  const refs = normalizedEvidenceRefs(attestation.evidence_refs);
  if (refs === null || (operation === "evaluate" && refs.length === 0) || (operation !== "evaluate" && refs.length !== 0)) {
    return { ok: false, reason: "nyra_deep_v2_mcp_attestation_evidence_refs_invalid" };
  }
  if (["requirements", "prepare_evidence", "evaluate"].includes(operation)) {
    if (!ID_PATTERN.test(String(attestation.branch_id || "")) || !ID_PATTERN.test(String(attestation.subbranch_id || ""))) {
      return { ok: false, reason: "nyra_deep_v2_mcp_attestation_branch_invalid" };
    }
  }
  if (operation === "prepare_evidence" && !SHA256_PATTERN.test(String(attestation.evidence_pack_hash || ""))) {
    return { ok: false, reason: "nyra_deep_v2_mcp_attestation_evidence_hash_invalid" };
  }
  return { ok: true, issued_at: issuedAt, evidence_refs: refs };
}

/**
 * Verifies the narrow MCP→Core handoff used by V2 only.  The outer Core key
 * still authenticates the connection; this HMAC prevents arbitrary callers
 * from enabling or binding a Deep V2 branch/evidence request.
 */
export function createNyraDeepV2McpRequestVerifier({
  secret,
  now = () => Date.now(),
  maxReplayEntries = MAX_REPLAY_ENTRIES,
} = {}) {
  const signingSecret = String(secret || "");
  const seen = new Map();
  const capacity = Math.max(100, Math.min(MAX_REPLAY_ENTRIES, Number(maxReplayEntries) || MAX_REPLAY_ENTRIES));

  function purge(nowMs) {
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= nowMs) seen.delete(key);
    }
    while (seen.size > capacity) seen.delete(seen.keys().next().value);
  }

  function verify({ attestation, tenantId, requestId, operation } = {}) {
    if (signingSecret.length < 32) return { ok: false, reason: "nyra_deep_v2_mcp_request_signing_unavailable" };
    const nowMs = now();
    const validity = baseValidity(attestation, { tenantId, requestId, operation, nowMs });
    if (!validity.ok) return validity;
    const expected = crypto
      .createHmac("sha256", signingSecret)
      .update(`nyra-deep-branch-v2-request\u0000${nyraDeepV2StableJson(payloadFrom(attestation))}`)
      .digest("hex");
    if (!safeEqual(expected, attestation.signature)) return { ok: false, reason: "nyra_deep_v2_mcp_attestation_signature_invalid" };
    const replayKey = `${tenantId}:${requestId}:${attestation.nonce}`;
    purge(nowMs);
    if (seen.has(replayKey)) return { ok: false, reason: "nyra_deep_v2_mcp_attestation_replayed" };
    seen.set(replayKey, validity.issued_at + NYRA_DEEP_V2_MCP_REQUEST_MAX_AGE_SECONDS * 1_000);
    purge(nowMs);
    return {
      ok: true,
      request_id: requestId,
      operation,
      branch_id: attestation.branch_id || null,
      subbranch_id: attestation.subbranch_id || null,
      evidence_refs: validity.evidence_refs,
      evidence_pack_hash: attestation.evidence_pack_hash || null,
      issued_at: attestation.issued_at,
    };
  }

  return Object.freeze({ verify });
}
