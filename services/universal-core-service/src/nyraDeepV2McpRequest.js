import crypto from "node:crypto";
import { createNyraDeepV2FileState } from "./nyraDeepV2FileState.js";

export const NYRA_DEEP_V2_MCP_REQUEST_SCHEMA_VERSION = "mcp_nyra_deep_branch_v2_request_attestation_v1";
export const NYRA_DEEP_V2_MCP_REQUEST_ISSUER = "skinharmony-core-mcp";
export const NYRA_DEEP_V2_MCP_REQUEST_MAX_AGE_SECONDS = 60;

const OPERATION_SET = new Set(["preview", "requirements", "prepare_evidence", "evaluate"]);
const ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const MAX_REPLAY_ENTRIES = 4_096;
const REPLAY_STATE_SCHEMA_VERSION = "nyra_deep_v2_mcp_replay_state_v1";

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
  storagePath = "",
} = {}) {
  const signingSecret = String(secret || "");
  const seen = new Map();
  const capacity = Math.max(100, Math.min(MAX_REPLAY_ENTRIES, Number(maxReplayEntries) || MAX_REPLAY_ENTRIES));
  const persistentState = storagePath
    ? createNyraDeepV2FileState({
      filePath: storagePath,
      maxBytes: 2 * 1024 * 1024,
      now,
    })
    : null;
  let persistentStateReady = true;

  function replayStateSignature(unsigned) {
    return crypto
      .createHmac("sha256", signingSecret)
      .update(`nyra-deep-branch-v2-mcp-replay-state\u0000${nyraDeepV2StableJson(unsigned)}`)
      .digest("hex");
  }

  function decodeReplayState(state) {
    if (state === null) return new Map();
    if (
      !isPlainObject(state)
      || state.schema_version !== REPLAY_STATE_SCHEMA_VERSION
      || !Array.isArray(state.entries)
      || state.entries.length > capacity
      || !SHA256_PATTERN.test(String(state.signature || ""))
      || JSON.stringify(Object.keys(state).sort())
        !== JSON.stringify(["entries", "schema_version", "signature"].sort())
    ) throw new Error("nyra_deep_v2_mcp_replay_state_corrupt");
    const unsigned = {
      schema_version: state.schema_version,
      entries: state.entries,
    };
    if (!safeEqual(state.signature, replayStateSignature(unsigned))) {
      throw new Error("nyra_deep_v2_mcp_replay_state_corrupt");
    }
    const decoded = new Map();
    for (const entry of state.entries) {
      if (
        !isPlainObject(entry)
        || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["expires_at", "replay_ref"])
        || !SHA256_PATTERN.test(String(entry.replay_ref || ""))
        || !Number.isSafeInteger(entry.expires_at)
        || entry.expires_at < 1
        || decoded.has(entry.replay_ref)
      ) throw new Error("nyra_deep_v2_mcp_replay_state_corrupt");
      decoded.set(entry.replay_ref, entry.expires_at);
    }
    return decoded;
  }

  function encodeReplayState(entries) {
    const unsigned = {
      schema_version: REPLAY_STATE_SCHEMA_VERSION,
      entries: [...entries]
        .map(([replayRef, expiresAt]) => ({
          replay_ref: replayRef,
          expires_at: expiresAt,
        }))
        .sort((left, right) => (
          left.expires_at - right.expires_at
          || left.replay_ref.localeCompare(right.replay_ref)
        )),
    };
    return {
      ...unsigned,
      signature: replayStateSignature(unsigned),
    };
  }

  function purge(entries, nowMs) {
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= nowMs) entries.delete(key);
    }
  }

  function replayReference({ tenantId, requestId, nonce }) {
    return crypto
      .createHmac("sha256", signingSecret)
      .update(`nyra-deep-branch-v2-mcp-replay-key\u0000${nyraDeepV2StableJson({
        tenant_id: tenantId,
        request_id: requestId,
        nonce,
      })}`)
      .digest("hex");
  }

  function consumeReplay({ replayRef, expiresAt, nowMs }) {
    if (!persistentState) {
      purge(seen, nowMs);
      if (seen.has(replayRef)) {
        return { ok: false, reason: "nyra_deep_v2_mcp_attestation_replayed" };
      }
      if (seen.size >= capacity) {
        return { ok: false, reason: "nyra_deep_v2_mcp_replay_capacity_exhausted" };
      }
      seen.set(replayRef, expiresAt);
      return { ok: true };
    }
    if (!persistentStateReady) {
      return { ok: false, reason: "nyra_deep_v2_mcp_replay_store_unavailable" };
    }
    try {
      return persistentState.update((current) => {
        const entries = decodeReplayState(current);
        purge(entries, nowMs);
        if (entries.has(replayRef)) {
          return {
            state: encodeReplayState(entries),
            result: { ok: false, reason: "nyra_deep_v2_mcp_attestation_replayed" },
          };
        }
        if (entries.size >= capacity) {
          return {
            state: encodeReplayState(entries),
            result: { ok: false, reason: "nyra_deep_v2_mcp_replay_capacity_exhausted" },
          };
        }
        entries.set(replayRef, expiresAt);
        return { state: encodeReplayState(entries), result: { ok: true } };
      });
    } catch {
      return { ok: false, reason: "nyra_deep_v2_mcp_replay_store_unavailable" };
    }
  }

  if (persistentState && signingSecret.length >= 32) {
    try {
      decodeReplayState(persistentState.read());
    } catch {
      persistentStateReady = false;
    }
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
    const replayResult = consumeReplay({
      replayRef: replayReference({
        tenantId,
        requestId,
        nonce: attestation.nonce,
      }),
      expiresAt: validity.issued_at + NYRA_DEEP_V2_MCP_REQUEST_MAX_AGE_SECONDS * 1_000,
      nowMs,
    });
    if (!replayResult.ok) return replayResult;
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

  function status() {
    let replayEntries = seen.size;
    if (persistentState && persistentStateReady) {
      try {
        const entries = decodeReplayState(persistentState.read());
        purge(entries, now());
        replayEntries = entries.size;
      } catch {
        persistentStateReady = false;
      }
    }
    return {
      configured: signingSecret.length >= 32,
      backend: persistentState?.kind || "process_memory_v1",
      restart_durable: persistentState?.restart_durable === true,
      distributed: persistentState?.distributed === true,
      ready: signingSecret.length >= 32 && persistentStateReady,
      replay_entry_count: replayEntries,
      raw_identifiers_retained: false,
    };
  }

  return Object.freeze({ status, verify });
}
