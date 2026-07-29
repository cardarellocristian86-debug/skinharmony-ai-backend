import crypto from "node:crypto";

export const NYRA_DEEP_V2_MCP_REQUEST_SCHEMA_VERSION =
  "mcp_nyra_deep_branch_v2_request_attestation_v1";
export const NYRA_DEEP_V2_MCP_REQUEST_ISSUER = "skinharmony-core-mcp";
export const NYRA_DEEP_V2_MCP_REQUEST_MAX_AGE_SECONDS = 60;

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
    .update(nyraDeepV2StableJson({
      evidence_pack: evidencePack,
      requirement_bindings: requirementBindings,
    }))
    .digest("hex");
}

export function signNyraDeepV2McpRequest({
  secret,
  tenantId,
  requestId,
  operation,
  branchId,
  subbranchId,
  evidenceRefs = [],
  evidencePackHash,
  now = () => new Date(),
  nonce = () => crypto.randomBytes(16).toString("hex"),
} = {}) {
  const signingSecret = String(secret || "");
  if (signingSecret.length < 32) {
    throw new Error("nyra_deep_v2_mcp_request_signing_unavailable");
  }
  const payload = {
    tenant_id: tenantId,
    request_id: requestId,
    operation,
    ...(branchId ? { branch_id: branchId } : {}),
    ...(subbranchId ? { subbranch_id: subbranchId } : {}),
    evidence_refs: evidenceRefs,
    ...(evidencePackHash ? { evidence_pack_hash: evidencePackHash } : {}),
    issued_at: now().toISOString(),
    nonce: nonce(),
  };
  return {
    schema_version: NYRA_DEEP_V2_MCP_REQUEST_SCHEMA_VERSION,
    issuer: NYRA_DEEP_V2_MCP_REQUEST_ISSUER,
    ...payload,
    max_age_seconds: NYRA_DEEP_V2_MCP_REQUEST_MAX_AGE_SECONDS,
    signature: crypto
      .createHmac("sha256", signingSecret)
      .update(`nyra-deep-branch-v2-request\u0000${nyraDeepV2StableJson(payload)}`)
      .digest("hex"),
  };
}
