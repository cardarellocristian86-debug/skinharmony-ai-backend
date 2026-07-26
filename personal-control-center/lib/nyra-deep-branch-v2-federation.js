"use strict";

const crypto = require("node:crypto");
const {
  featureFlags,
  loadCatalog,
  loadRuntimeShard,
  route,
} = require("./nyra-deep-branch-v2");

const ENVELOPE_SCHEMA_VERSION = "nyra_deep_branch_v2_core_envelope_v1";
const RESPONSE_SCHEMA_VERSION = "nyra_deep_branch_v2_federation_response_v1";
const OPERATIONAL_ATTESTATION_SCHEMA_VERSION = "nyra_deep_branch_v2_operational_attestation_v1";
const OPAQUE_NODE_CONTEXT_SCHEMA_VERSION = "nyra_deep_branch_v2_opaque_node_context_v1";
const EVALUATION_ATTESTATION_SCHEMA_VERSION = OPERATIONAL_ATTESTATION_SCHEMA_VERSION;
const EVALUATION_RESPONSE_SCHEMA_VERSION = "nyra_deep_branch_v2_operational_evaluation_response_v1";
const ENVELOPE_ISSUER = "skinharmony-universal-core";
const ENVELOPE_AUDIENCE = "skinharmony-nyra-core";
const MAX_ENVELOPE_AGE_MS = 60_000;
const MAX_FUTURE_SKEW_MS = 15_000;
const MAX_REPLAY_NONCES = 2_048;
const MAX_OPAQUE_NODE_CONTEXT_BYTES = 64 * 1024;
const MAX_OPAQUE_CONTEXT_TOTAL_BYTES = 384 * 1024;
const ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const NODE_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,384}$/;
const KEY_ID_PATTERN = /^[a-z][a-z0-9_.-]{1,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const NONCE_PATTERN = /^[a-f0-9]{32,128}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const OPAQUE_CONTEXT_FORBIDDEN_KEYS = new Set([
  "raw_text",
  "raw_evidence",
  "raw_message",
  "message",
  "messages",
  "prompt",
  "system_prompt",
  "user_prompt",
  "source_text",
  "original_text",
  "chat_history",
]);

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

function canonicalJson(value) {
  return JSON.stringify(stableCanonical(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value) {
  return sha256(canonicalJson(value));
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseList(value, maxItems = 20) {
  const seen = new Set();
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item) || seen.size >= maxItems) return false;
      seen.add(item);
      return true;
    });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function envelopePayload(envelope = {}) {
  const { signature: _signature, ...payload } = envelope;
  return payload;
}

function envelopeBindingPayload(envelope = {}) {
  const {
    signature: _signature,
    operational_attestation: _operationalAttestation,
    ...payload
  } = envelope;
  return payload;
}

function coreEnvelopeBindingHash(envelope = {}) {
  return sha256(canonicalJson(envelopeBindingPayload(envelope)));
}

function signCoreEnvelope(envelope, sharedSecret) {
  if (!sharedSecret) throw new Error("nyra_deep_branch_v2_shared_secret_required");
  return crypto
    .createHmac("sha256", String(sharedSecret))
    .update(`nyra-deep-branch-v2-envelope\u0000${canonicalJson(envelopePayload(envelope))}`)
    .digest("hex");
}

function operationalAttestationPayload(attestation = {}) {
  const { signature: _signature, ...payload } = attestation;
  return payload;
}

function signOperationalEvaluationAttestation(attestation, privateKey) {
  if (!privateKey) throw new Error("nyra_deep_branch_v2_operational_private_key_required");
  return crypto
    .sign(
      null,
      Buffer.from(
        `nyra-deep-branch-v2-operational-attestation\u0000${canonicalJson(operationalAttestationPayload(attestation))}`,
        "utf8"
      ),
      privateKey
    )
    .toString("base64url");
}

function verifyOperationalEvaluationAttestation(attestation, publicKey) {
  if (!publicKey || !BASE64URL_PATTERN.test(String(attestation?.signature || ""))) return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(
        `nyra-deep-branch-v2-operational-attestation\u0000${canonicalJson(operationalAttestationPayload(attestation))}`,
        "utf8"
      ),
      publicKey,
      Buffer.from(String(attestation.signature), "base64url")
    );
  } catch {
    return false;
  }
}

const signEvaluationAttestation = signOperationalEvaluationAttestation;
const verifyEvaluationAttestation = verifyOperationalEvaluationAttestation;

function encodeOpaqueNodeContext(payload) {
  const raw = Buffer.from(canonicalJson(payload), "utf8");
  const encoded = raw.toString("base64url");
  return {
    payload_encoding: "base64url_canonical_json",
    payload_sha256: sha256Bytes(raw),
    opaque_payload: encoded,
  };
}

function createReplayGuard({ now = () => Date.now(), maxEntries = MAX_REPLAY_NONCES } = {}) {
  const seen = new Map();

  function purge(nowMs) {
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= nowMs) seen.delete(key);
    }
    while (seen.size > maxEntries) seen.delete(seen.keys().next().value);
  }

  return {
    consume({ tenantId, nonce, expiresAt, scope = "envelope" }) {
      const nowMs = now();
      purge(nowMs);
      const key = `${scope}:${tenantId}:${nonce}`;
      if (seen.has(key)) return false;
      seen.set(key, expiresAt);
      purge(nowMs);
      return true;
    },
  };
}

function federationConfig(env = process.env) {
  const rawPublicKeys = String(env.NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_PUBLIC_KEYS || "").trim();
  let operationalPublicKeys = {};
  try {
    const parsed = rawPublicKeys ? JSON.parse(rawPublicKeys) : {};
    if (isPlainObject(parsed)) {
      operationalPublicKeys = Object.fromEntries(
        Object.entries(parsed)
          .filter(([keyId, publicKey]) => KEY_ID_PATTERN.test(String(keyId))
            && typeof publicKey === "string"
            && publicKey.length > 0
            && publicKey.length <= 16 * 1024)
      );
    }
  } catch {
    operationalPublicKeys = {};
  }
  return {
    enabled: truthy(env.NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED),
    shared_secret: String(env.NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET || "").trim(),
    // Federation must be explicitly scoped. It may not inherit the broader V2 tenant flag.
    tenant_allowlist: parseList(env.NYRA_DEEP_BRANCH_V2_FEDERATION_TENANT_ALLOWLIST),
    maximum_envelope_age_ms: Math.max(
      5_000,
      Math.min(MAX_ENVELOPE_AGE_MS, Number(env.NYRA_DEEP_BRANCH_V2_ENVELOPE_MAX_AGE_MS) || MAX_ENVELOPE_AGE_MS)
    ),
    operational_evaluation_enabled: truthy(env.NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED),
    operational_tenant_allowlist: parseList(env.NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST),
    operational_key_allowlist: parseList(env.NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_KEY_ID_ALLOWLIST),
    operational_public_keys: operationalPublicKeys,
    maximum_operational_attestation_age_ms: Math.max(
      5_000,
      Math.min(MAX_ENVELOPE_AGE_MS, Number(env.NYRA_DEEP_BRANCH_V2_OPERATIONAL_ATTESTATION_MAX_AGE_MS) || MAX_ENVELOPE_AGE_MS)
    ),
  };
}

function compactBranch(branch) {
  const subbranches = Array.isArray(branch?.subbranches) ? branch.subbranches : [];
  return {
    id: branch.id,
    label: branch.label,
    work_phase: branch.work_phase,
    subbranch_count: subbranches.length,
    subbranches: subbranches.map((subbranch) => ({
      id: subbranch.id,
      specialized_capability_count: Array.isArray(subbranch.specialized_capabilities)
        ? subbranch.specialized_capabilities.length
        : 0,
    })),
  };
}

function compactValidation(loaded) {
  const validation = loaded?.validation || {};
  const integrity = validation.integrity || {};
  return {
    ok: validation.ok === true,
    branch_count: Number(validation.metrics?.branch_count || 0),
    subbranch_count: Number(validation.metrics?.subbranch_count || 0),
    node_count: Number(validation.metrics?.node_count || 0),
    shard_count: Number(integrity.shard_count || 0),
    checked_shards: Number(integrity.checked_shards || 0),
    unchecked_shards: Number(integrity.unchecked_shards || 0),
    errors: Array.isArray(validation.errors) ? validation.errors.slice(0, 12) : [],
  };
}

function v1AuthoritativeResponse({
  tenantId,
  requestId,
  state,
  reason,
  validation,
  envelopeHash,
} = {}) {
  return {
    ok: true,
    schema_version: RESPONSE_SCHEMA_VERSION,
    state,
    mode: "disabled",
    tenant_id: tenantId || null,
    request_id: requestId || null,
    reason: reason || null,
    validation: validation || null,
    selected_branches: [],
    evaluation: {
      state: "not_requested_v1_authoritative",
      evaluated_node_count: 0,
    },
    provenance: envelopeHash ? { envelope_hash: envelopeHash } : undefined,
    execution_authorized: false,
    core_final_authority: true,
    fallback: "nyra_neural_branch_network_v1",
  };
}

function envelopeFailure(code, status = 403) {
  return { ok: false, status, error: code, execution_allowed: false, core_final_authority: true };
}

function validateEnvelope(envelope, config, { now = () => Date.now() } = {}) {
  if (!isPlainObject(envelope)) return envelopeFailure("nyra_deep_branch_v2_envelope_required", 400);
  const required = [
    "schema_version",
    "issuer",
    "audience",
    "tenant_id",
    "request_id",
    "domain_pack",
    "opened_branch_ids",
    "branch_allowlist",
    "preflight_id",
    "core_policy_hash",
    "catalog_fingerprint",
    "root_binding_hash",
    "nonce",
    "issued_at",
    "expires_at",
    "signature",
  ];
  if (required.some((field) => envelope[field] === undefined)) return envelopeFailure("nyra_deep_branch_v2_envelope_fields_required", 400);
  if (Object.keys(envelope).some((field) => !required.includes(field) && field !== "operational_attestation")) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_schema_invalid", 400);
  }
  if (envelope.schema_version !== ENVELOPE_SCHEMA_VERSION) return envelopeFailure("nyra_deep_branch_v2_envelope_schema_invalid", 400);
  if (envelope.issuer !== ENVELOPE_ISSUER || envelope.audience !== ENVELOPE_AUDIENCE) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_audience_invalid");
  }
  if (!ID_PATTERN.test(String(envelope.tenant_id || ""))) return envelopeFailure("nyra_deep_branch_v2_envelope_tenant_invalid", 400);
  if (!REQUEST_ID_PATTERN.test(String(envelope.request_id || ""))) return envelopeFailure("nyra_deep_branch_v2_envelope_request_invalid", 400);
  if (envelope.domain_pack !== "skinharmony") return envelopeFailure("nyra_deep_branch_v2_envelope_domain_pack_invalid");
  if (!Array.isArray(envelope.opened_branch_ids) || envelope.opened_branch_ids.length === 0 || envelope.opened_branch_ids.length > 20) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_opened_branches_invalid", 400);
  }
  if (!Array.isArray(envelope.branch_allowlist) || envelope.branch_allowlist.length === 0 || envelope.branch_allowlist.length > 20) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_branch_allowlist_invalid", 400);
  }
  const opened = envelope.opened_branch_ids.map(String);
  const allowlist = envelope.branch_allowlist.map(String);
  if (opened.some((id) => !ID_PATTERN.test(id)) || allowlist.some((id) => !ID_PATTERN.test(id))) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_branch_id_invalid", 400);
  }
  if (new Set(opened).size !== opened.length || new Set(allowlist).size !== allowlist.length) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_branch_duplicates", 400);
  }
  if (opened.some((id) => !allowlist.includes(id))) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_opened_branch_not_allowlisted");
  }
  if (!SHA256_PATTERN.test(String(envelope.core_policy_hash || ""))
    || !SHA256_PATTERN.test(String(envelope.catalog_fingerprint || ""))
    || !SHA256_PATTERN.test(String(envelope.root_binding_hash || ""))) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_hash_invalid", 400);
  }
  if (!NONCE_PATTERN.test(String(envelope.nonce || ""))) return envelopeFailure("nyra_deep_branch_v2_envelope_nonce_invalid", 400);
  const issuedAt = Date.parse(String(envelope.issued_at || ""));
  const expiresAt = Date.parse(String(envelope.expires_at || ""));
  const nowMs = now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > nowMs + MAX_FUTURE_SKEW_MS
    || expiresAt <= nowMs
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > config.maximum_envelope_age_ms) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_expired");
  }
  if (!config.tenant_allowlist.includes(String(envelope.tenant_id))) {
    return envelopeFailure("nyra_deep_branch_v2_tenant_denied");
  }
  const expectedSignature = signCoreEnvelope(envelope, config.shared_secret);
  if (!safeEqual(expectedSignature, envelope.signature)) return envelopeFailure("nyra_deep_branch_v2_envelope_signature_invalid");
  return {
    ok: true,
    issued_at: issuedAt,
    expires_at: expiresAt,
    envelope_hash: sha256(canonicalJson(envelopePayload(envelope))),
  };
}

function exactKeys(value, expected) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function containsForbiddenOpaqueField(value, depth = 0) {
  if (depth > 24) return true;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8") > 16 * 1024;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenOpaqueField(item, depth + 1));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, item]) => (
    OPAQUE_CONTEXT_FORBIDDEN_KEYS.has(String(key).toLowerCase())
    || containsForbiddenOpaqueField(item, depth + 1)
  ));
}

function decodeOpaqueNodeContext(context) {
  if (!exactKeys(context, [
    "schema_version",
    "node_id",
    "context_id",
    "payload_encoding",
    "payload_sha256",
    "opaque_payload",
  ])) return envelopeFailure("nyra_deep_branch_v2_opaque_context_schema_invalid", 400);
  if (context.schema_version !== OPAQUE_NODE_CONTEXT_SCHEMA_VERSION
    || !NODE_ID_PATTERN.test(String(context.node_id || ""))
    || !REQUEST_ID_PATTERN.test(String(context.context_id || ""))
    || context.payload_encoding !== "base64url_canonical_json"
    || !SHA256_PATTERN.test(String(context.payload_sha256 || ""))
    || !BASE64URL_PATTERN.test(String(context.opaque_payload || ""))) {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_fields_invalid", 400);
  }
  if (Buffer.byteLength(String(context.opaque_payload), "utf8") > Math.ceil(MAX_OPAQUE_NODE_CONTEXT_BYTES * 4 / 3)) {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_too_large", 400);
  }
  let raw;
  let payload;
  try {
    raw = Buffer.from(String(context.opaque_payload), "base64url");
    if (raw.length === 0 || raw.length > MAX_OPAQUE_NODE_CONTEXT_BYTES
      || !safeEqual(sha256Bytes(raw), context.payload_sha256)) {
      return envelopeFailure("nyra_deep_branch_v2_opaque_context_hash_invalid");
    }
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_decode_invalid", 400);
  }
  if (canonicalJson(payload) !== raw.toString("utf8")) {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_canonical_invalid", 400);
  }
  if (!exactKeys(payload, [
    "node_id",
    "capability_input",
    "evidence",
    "evidence_manifest",
    "policy_decisions",
  ])
    || payload.node_id !== context.node_id
    || !isPlainObject(payload.capability_input)
    || !Array.isArray(payload.evidence)
    || !isPlainObject(payload.evidence_manifest)
    || !Array.isArray(payload.policy_decisions)
    || containsForbiddenOpaqueField(payload)) {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_payload_invalid", 400);
  }
  return { ok: true, payload, bytes: raw.length };
}

function compactLineageNode(node) {
  return {
    node_id: node.id,
    parent_id: node.parent_id,
    level: node.level,
    node_type: node.node_type,
    function_binding_hash: sha256(canonicalJson(node.function_binding || {})),
    semantic_function_hash: node.function_binding?.semantic_function_hash || null,
  };
}

function operationalLineageFromShard(shard) {
  const nodeIndex = new Map((shard?.nodes || []).map((node) => [node.id, node]));
  const nodeIds = shard?.descriptor?.node_ids || [];
  if (nodeIds.length !== 6 || new Set(nodeIds).size !== 6) return null;
  const nodes = nodeIds.map((nodeId) => nodeIndex.get(nodeId));
  if (nodes.some((node) => !node)) return null;
  const [level2, level3, ...level4] = nodes;
  if (level2.level !== 2 || level2.node_type !== "specialized_capability"
    || level3.level !== 3 || level3.node_type !== "micro_capability"
    || level3.parent_id !== level2.id
    || level4.length !== 4
    || level4.some((node) => node.level !== 4 || node.parent_id !== level3.id)
    || JSON.stringify(level4.map((node) => node.node_type).sort())
      !== JSON.stringify(["method", "metric", "strategy", "verifier"])) {
    return null;
  }
  return nodes.map(compactLineageNode);
}

function validateOperationalEvaluationAttestation({
  attestation,
  envelope,
  envelopeValidation,
  config,
  loaded,
  env = process.env,
  now = () => Date.now(),
} = {}) {
  if (!config?.operational_evaluation_enabled) {
    return envelopeFailure("nyra_deep_branch_v2_operational_evaluation_disabled");
  }
  if (!isPlainObject(attestation)) return envelopeFailure("nyra_deep_branch_v2_operational_attestation_required", 400);
  const required = [
    "schema_version",
    "issuer",
    "audience",
    "key_id",
    "tenant_id",
    "request_id",
    "domain_pack",
    "branch_id",
    "subbranch_id",
    "preflight_id",
    "core_policy_hash",
    "envelope_binding_hash",
    "catalog_fingerprint",
    "root_binding_hash",
    "function_registry_hash",
    "package_hash",
    "lineage",
    "node_contexts",
    "nonce",
    "issued_at",
    "expires_at",
    "observed_at",
    "signature",
  ];
  if (!exactKeys(attestation, required)) return envelopeFailure("nyra_deep_branch_v2_operational_attestation_schema_invalid", 400);
  if (attestation.schema_version !== OPERATIONAL_ATTESTATION_SCHEMA_VERSION
    || attestation.issuer !== ENVELOPE_ISSUER
    || attestation.audience !== ENVELOPE_AUDIENCE
    || !KEY_ID_PATTERN.test(String(attestation.key_id || ""))
    || !ID_PATTERN.test(String(attestation.tenant_id || ""))
    || !REQUEST_ID_PATTERN.test(String(attestation.request_id || ""))
    || attestation.domain_pack !== "skinharmony"
    || !ID_PATTERN.test(String(attestation.branch_id || ""))
    || !ID_PATTERN.test(String(attestation.subbranch_id || ""))
    || !NONCE_PATTERN.test(String(attestation.nonce || ""))
    || !Number.isFinite(Number(attestation.observed_at))) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_fields_invalid", 400);
  }
  const requiredHashes = [
    "core_policy_hash",
    "envelope_binding_hash",
    "catalog_fingerprint",
    "root_binding_hash",
    "function_registry_hash",
    "package_hash",
  ];
  if (requiredHashes.some((field) => !SHA256_PATTERN.test(String(attestation[field] || "")))) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_hash_invalid", 400);
  }
  if (!config.operational_tenant_allowlist.includes(attestation.tenant_id)
    || !config.operational_key_allowlist.includes(attestation.key_id)
    || !Object.hasOwn(config.operational_public_keys, attestation.key_id)) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_not_allowlisted");
  }
  if (attestation.tenant_id !== envelope?.tenant_id
    || attestation.request_id !== envelope?.request_id
    || attestation.domain_pack !== envelope?.domain_pack
    || attestation.preflight_id !== envelope?.preflight_id
    || attestation.core_policy_hash !== envelope?.core_policy_hash
    || attestation.catalog_fingerprint !== envelope?.catalog_fingerprint
    || attestation.root_binding_hash !== envelope?.root_binding_hash
    || attestation.envelope_binding_hash !== coreEnvelopeBindingHash(envelope)
    || !envelope?.opened_branch_ids?.includes(attestation.branch_id)
    || !envelope?.branch_allowlist?.includes(attestation.branch_id)) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_envelope_binding_invalid");
  }
  const issuedAt = Date.parse(String(attestation.issued_at || ""));
  const expiresAt = Date.parse(String(attestation.expires_at || ""));
  const nowMs = now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > nowMs + MAX_FUTURE_SKEW_MS
    || expiresAt <= nowMs
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > config.maximum_operational_attestation_age_ms) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_expired");
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(config.operational_public_keys[attestation.key_id]);
  } catch {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_public_key_invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519"
    || !verifyOperationalEvaluationAttestation(attestation, publicKey)) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_signature_invalid");
  }
  const shard = loadRuntimeShard({
    loaded,
    tenantId: envelope.tenant_id,
    branchId: attestation.branch_id,
    subbranchId: attestation.subbranch_id,
    env,
  });
  if (!shard.ok) return envelopeFailure("nyra_deep_branch_v2_operational_shard_rejected");
  const expectedLineage = operationalLineageFromShard(shard);
  if (!expectedLineage
    || attestation.catalog_fingerprint !== loaded?.manifest?.root_binding?.catalog_fingerprint
    || attestation.root_binding_hash !== loaded?.manifest?.root_binding_hash
    || attestation.function_registry_hash !== loaded?.manifest?.root_binding?.function_registry_hash
    || attestation.package_hash !== shard.descriptor?.uncompressed_sha256
    || !Array.isArray(attestation.lineage)
    || canonicalJson(attestation.lineage) !== canonicalJson(expectedLineage)) {
    return envelopeFailure("nyra_deep_branch_v2_operational_lineage_binding_invalid");
  }
  if (!Array.isArray(attestation.node_contexts)
    || attestation.node_contexts.length !== expectedLineage.length) {
    return envelopeFailure("nyra_deep_branch_v2_operational_context_coverage_invalid", 400);
  }
  const seenContextIds = new Set();
  const seenEvidenceIds = new Set();
  let totalBytes = 0;
  const contexts = [];
  for (const [index, opaqueContext] of attestation.node_contexts.entries()) {
    const expected = expectedLineage[index];
    const decoded = decodeOpaqueNodeContext(opaqueContext);
    if (!decoded.ok) return decoded;
    if (opaqueContext.node_id !== expected.node_id
      || seenContextIds.has(opaqueContext.context_id)) {
      return envelopeFailure("nyra_deep_branch_v2_operational_context_lineage_invalid");
    }
    seenContextIds.add(opaqueContext.context_id);
    totalBytes += decoded.bytes;
    if (totalBytes > MAX_OPAQUE_CONTEXT_TOTAL_BYTES) {
      return envelopeFailure("nyra_deep_branch_v2_operational_context_budget_exceeded", 400);
    }
    for (const evidence of decoded.payload.evidence) {
      const evidenceId = String(evidence?.evidence_id || "");
      if (!evidenceId || seenEvidenceIds.has(evidenceId)) {
        return envelopeFailure("nyra_deep_branch_v2_operational_evidence_identity_invalid");
      }
      seenEvidenceIds.add(evidenceId);
    }
    contexts.push(decoded.payload);
  }
  return {
    ok: true,
    issued_at: issuedAt,
    expires_at: expiresAt,
    observed_at: Number(attestation.observed_at),
    attestation_hash: sha256(canonicalJson(operationalAttestationPayload(attestation))),
    branch_id: attestation.branch_id,
    subbranch_id: attestation.subbranch_id,
    package_hash: attestation.package_hash,
    key_id: attestation.key_id,
    lineage: expectedLineage,
    contexts,
  };
}

function hydrateOperationalEvaluationContext({ envelope, attestation }) {
  const nodeInputs = {};
  const evidenceManifests = {};
  const evidence = [];
  const policyDecisions = [];
  for (const context of attestation.contexts || []) {
    nodeInputs[context.node_id] = context.capability_input;
    evidenceManifests[context.node_id] = context.evidence_manifest;
    evidence.push(...context.evidence);
    policyDecisions.push(...context.policy_decisions);
  }
  return {
    corePayload: {
      tenant_id: envelope.tenant_id,
      domain_pack: { id: envelope.domain_pack },
      result: {
        nyra_neural_network: {
          opened_by: "universal_core",
          opened_branches: [{ id: attestation.branch_id, status: "opened" }],
          execution_authorized: false,
        },
        evidence_manifests: evidenceManifests,
        policy_decisions: policyDecisions,
      },
    },
    evaluationContext: {
      subbranch_id: attestation.subbranch_id,
      evidence,
      // The Ed25519 attestation authenticates the otherwise opaque, bounded atoms.
      evidence_source: "authenticated_core",
      node_inputs: nodeInputs,
      request_id: envelope.request_id,
      observed_at: attestation.observed_at,
    },
  };
}

function compactOperationalNodeEvaluation(evaluation, lineage) {
  const result = {
    node_id: lineage.node_id,
    parent_id: lineage.parent_id,
    level: lineage.level,
    node_type: lineage.node_type,
    state: String(evaluation?.state || "not_evaluated"),
  };
  if (Number.isFinite(evaluation?.confidence)) result.confidence = evaluation.confidence;
  if (Number.isFinite(evaluation?.confidence_threshold)) result.confidence_threshold = evaluation.confidence_threshold;
  if (typeof evaluation?.fallback_node === "string") result.fallback_node = evaluation.fallback_node;
  if (Array.isArray(evaluation?.reason_codes)) result.reason_codes = evaluation.reason_codes.slice(0, 6).map(String);
  return result;
}

function createNyraDeepBranchV2Federation({
  env = process.env,
  now = () => Date.now(),
  loadCatalogImpl = loadCatalog,
  routeImpl = route,
  replayGuard = createReplayGuard({ now }),
} = {}) {
  function config() {
    return federationConfig(env);
  }

  function authenticate(sharedSecret) {
    const current = config();
    if (!current.enabled || !current.shared_secret || current.tenant_allowlist.length === 0) {
      return { ok: false, error: "nyra_deep_branch_v2_federation_unavailable" };
    }
    return safeEqual(current.shared_secret, sharedSecret)
      ? { ok: true }
      : { ok: false, error: "nyra_deep_branch_v2_service_auth_invalid" };
  }

  function evaluate(envelope) {
    const current = config();
    if (!current.enabled || !current.shared_secret || current.tenant_allowlist.length === 0) {
      return v1AuthoritativeResponse({
        tenantId: envelope?.tenant_id,
        requestId: envelope?.request_id,
        state: "federation_disabled_v1_authoritative",
        reason: "nyra_deep_branch_v2_federation_disabled",
      });
    }
    const validation = validateEnvelope(envelope, current, { now });
    if (!validation.ok) return validation;
    if (!replayGuard.consume({
      tenantId: envelope.tenant_id,
      nonce: envelope.nonce,
      expiresAt: validation.expires_at,
    })) return envelopeFailure("nyra_deep_branch_v2_envelope_replayed");

    const loaded = loadCatalogImpl({ runtimeMode: "lazy" });
    const compactedValidation = compactValidation(loaded);
    if (!loaded.ok) {
      return v1AuthoritativeResponse({
        tenantId: envelope.tenant_id,
        requestId: envelope.request_id,
        state: "catalog_rejected_v1_authoritative",
        reason: "nyra_deep_branch_v2_catalog_rejected",
        validation: compactedValidation,
        envelopeHash: validation.envelope_hash,
      });
    }
    if (loaded.catalog.catalog_fingerprint !== envelope.catalog_fingerprint
      || loaded.manifest?.root_binding_hash !== envelope.root_binding_hash) {
      return envelopeFailure("nyra_deep_branch_v2_catalog_binding_mismatch");
    }

    const flags = featureFlags(env, envelope.tenant_id);
    const serviceAllowlist = new Set(flags.branch_allowlist);
    if (envelope.branch_allowlist.some((branchId) => !serviceAllowlist.has(branchId))) {
      return envelopeFailure("nyra_deep_branch_v2_core_allowlist_exceeds_service_allowlist");
    }
    if (envelope.operational_attestation !== undefined) {
      if (!current.operational_evaluation_enabled
        || current.operational_tenant_allowlist.length === 0
        || current.operational_key_allowlist.length === 0) {
        return v1AuthoritativeResponse({
          tenantId: envelope.tenant_id,
          requestId: envelope.request_id,
          state: "operational_evaluation_disabled_v1_authoritative",
          reason: "nyra_deep_branch_v2_operational_evaluation_disabled_or_unscoped",
          validation: compactedValidation,
          envelopeHash: validation.envelope_hash,
        });
      }
      const operational = validateOperationalEvaluationAttestation({
        attestation: envelope.operational_attestation,
        envelope,
        envelopeValidation: validation,
        config: current,
        loaded,
        env,
        now,
      });
      if (!operational.ok) return operational;
      if (!replayGuard.consume({
        tenantId: envelope.tenant_id,
        nonce: envelope.operational_attestation.nonce,
        expiresAt: operational.expires_at,
        scope: "operational_attestation",
      })) return envelopeFailure("nyra_deep_branch_v2_operational_attestation_replayed");
      const hydrated = hydrateOperationalEvaluationContext({ envelope, attestation: operational });
      const evaluated = routeImpl({
        tenantId: envelope.tenant_id,
        domainPackId: envelope.domain_pack,
        corePayload: hydrated.corePayload,
        requestedBranches: [operational.branch_id],
        evaluationContext: hydrated.evaluationContext,
        env,
        runtimeMode: "lazy",
      });
      const evaluations = Array.isArray(evaluated.evaluations) ? evaluated.evaluations : [];
      const evaluationsByNodeId = new Map(evaluations.map((item) => [item?.node_id, item]));
      if (evaluations.length !== operational.lineage.length
        || evaluationsByNodeId.size !== operational.lineage.length
        || operational.lineage.some((lineage) => !evaluationsByNodeId.has(lineage.node_id))) {
        return envelopeFailure("nyra_deep_branch_v2_operational_runtime_lineage_invalid");
      }
      const nodeResults = operational.lineage.map((lineage) => (
        compactOperationalNodeEvaluation(evaluationsByNodeId.get(lineage.node_id), lineage)
      ));
      const allVerified = nodeResults.every((item) => item.state === "advisory_verified");
      return {
        ok: true,
        schema_version: RESPONSE_SCHEMA_VERSION,
        state: allVerified
          ? "operational_advisory_verified_v1_authoritative"
          : "operational_advisory_fallback_v1_authoritative",
        mode: evaluated.mode,
        tenant_id: envelope.tenant_id,
        request_id: envelope.request_id,
        catalog: {
          version: evaluated.catalog_version || loaded.catalog.version,
          fingerprint: evaluated.catalog_fingerprint || loaded.catalog.catalog_fingerprint,
          root_binding_hash: loaded.manifest?.root_binding_hash || null,
        },
        validation: compactedValidation,
        selected_branches: [],
        evaluation: {
          schema_version: EVALUATION_RESPONSE_SCHEMA_VERSION,
          state: allVerified ? "operational_advisory_verified" : "operational_advisory_fallback",
          evaluated_node_count: nodeResults.length,
          all_nodes_verified: allVerified,
          lineage: {
            branch_id: operational.branch_id,
            subbranch_id: operational.subbranch_id,
            package_hash: operational.package_hash,
            nodes: nodeResults,
          },
        },
        provenance: {
          envelope_hash: validation.envelope_hash,
          attestation_hash: operational.attestation_hash,
          key_id: operational.key_id,
          core_policy_hash: envelope.core_policy_hash,
          preflight_id: envelope.preflight_id,
        },
        execution_authorized: false,
        core_final_authority: true,
        fallback: "nyra_neural_branch_network_v1",
      };
    }
    const deepBranchV2 = routeImpl({
      tenantId: envelope.tenant_id,
      domainPackId: envelope.domain_pack,
      corePayload: {
        result: {
          nyra_neural_network: {
            opened_by: "universal_core",
            opened_branches: envelope.opened_branch_ids.map((id) => ({ id, status: "opened" })),
          },
          work_preflight: {
            preflight_id: envelope.preflight_id,
          },
        },
      },
      requestedBranches: envelope.opened_branch_ids,
      env,
      runtimeMode: "lazy",
    });
    const selectedBranches = (deepBranchV2.selected_branches || []).map(compactBranch);
    return {
      ok: true,
      schema_version: RESPONSE_SCHEMA_VERSION,
      state: deepBranchV2.state,
      mode: deepBranchV2.mode,
      tenant_id: envelope.tenant_id,
      request_id: envelope.request_id,
      catalog: {
        version: deepBranchV2.catalog_version || loaded.catalog.version,
        fingerprint: deepBranchV2.catalog_fingerprint || loaded.catalog.catalog_fingerprint,
        root_binding_hash: loaded.manifest?.root_binding_hash || null,
      },
      validation: compactedValidation,
      selected_branches: selectedBranches,
      evaluation: {
        state: "not_requested_core_evidence_contract_unavailable",
        evaluated_node_count: 0,
        reason: "preview_routes_only_core_opened_branches_until_core_attests_node_evidence_and_policy",
      },
      provenance: {
        envelope_hash: validation.envelope_hash,
        core_policy_hash: envelope.core_policy_hash,
        preflight_id: envelope.preflight_id,
      },
      execution_authorized: false,
      core_final_authority: true,
      fallback: "nyra_neural_branch_network_v1",
    };
  }

  return {
    authenticate,
    config,
    evaluate,
  };
}

module.exports = {
  ENVELOPE_AUDIENCE,
  ENVELOPE_ISSUER,
  ENVELOPE_SCHEMA_VERSION,
  EVALUATION_ATTESTATION_SCHEMA_VERSION,
  EVALUATION_RESPONSE_SCHEMA_VERSION,
  OPAQUE_NODE_CONTEXT_SCHEMA_VERSION,
  OPERATIONAL_ATTESTATION_SCHEMA_VERSION,
  RESPONSE_SCHEMA_VERSION,
  canonicalHash,
  canonicalJson,
  coreEnvelopeBindingHash,
  createNyraDeepBranchV2Federation,
  createReplayGuard,
  encodeOpaqueNodeContext,
  federationConfig,
  hydrateOperationalEvaluationContext,
  operationalLineageFromShard,
  signCoreEnvelope,
  signEvaluationAttestation,
  signOperationalEvaluationAttestation,
  validateOperationalEvaluationAttestation,
  verifyEvaluationAttestation,
  verifyOperationalEvaluationAttestation,
};
