import crypto from "node:crypto";

export const ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1 =
  "nyra.icf.event-digest/json-stringify-v1";
export const ICF_EVENT_DIGEST_CONTRACT_V2 =
  "nyra.icf.event-digest/canonical-json-v2";
export const ICF_EVENT_CANONICALIZATION_V2 = "nyra.icf.canonical-json/2.0";
export const ICF_EVENT_DIGEST_ALGORITHM = "sha256";
export const ICF_EVENT_DIGEST_INPUT_SCHEMA_V2 = "nyra.icf.event-digest-input/2.0";
export const ICF_EVENT_REANCHOR_SCHEMA_V2 = "nyra.icf.event-digest-reanchor/2.0";
export const ICF_EVENT_REANCHOR_TYPE_V2 = "DIGEST_CONTRACT_REANCHORED";

const DIGEST = /^[a-f0-9]{64}$/u;

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function canonicalValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("icf_event_canonical_value_invalid");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64url");
  if (!value || typeof value !== "object") fail("icf_event_canonical_value_invalid");
  if (seen.has(value)) fail("icf_event_canonical_value_circular");
  if (Array.isArray(value)) {
    seen.add(value);
    const result = value.map((item) => canonicalValue(item, seen));
    seen.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("icf_event_canonical_value_invalid");
  }
  seen.add(value);
  const result = Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        fail("icf_event_canonical_key_forbidden");
      }
      return [key, canonicalValue(value[key], seen)];
    }));
  seen.delete(value);
  return result;
}

function digestText(value) {
  return crypto.createHash(ICF_EVENT_DIGEST_ALGORITHM).update(value).digest("hex");
}

function requiredText(value, code, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum) fail(code);
  return normalized;
}

function requiredDigest(value, code) {
  const normalized = String(value ?? "").toLowerCase();
  if (!DIGEST.test(normalized)) fail(code);
  return normalized;
}

function optionalDigest(value, code) {
  if (value === null || value === undefined || value === "") return null;
  return requiredDigest(value, code);
}

function sequenceNumber(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    fail("icf_event_sequence_invalid");
  }
  return normalized;
}

export function canonicalIcfEventJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function normalizeIcfEventPayload(payload) {
  return canonicalValue(payload);
}

export function icfEventPayloadDigestV2(payload) {
  return digestText(canonicalIcfEventJson(payload));
}

export function buildIcfEventDigestMetadataV2({ payload, previousDigest,
  previousDigestContract } = {}) {
  const previous = optionalDigest(previousDigest, "icf_event_previous_digest_invalid");
  const predecessorContract = previous === null ? null
    : requiredText(previousDigestContract, "icf_event_previous_digest_contract_invalid", 120);
  if (predecessorContract !== null
    && ![ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1, ICF_EVENT_DIGEST_CONTRACT_V2]
      .includes(predecessorContract)) {
    fail("icf_event_previous_digest_contract_invalid");
  }
  return Object.freeze({
    digest_contract: ICF_EVENT_DIGEST_CONTRACT_V2,
    canonicalization_version: ICF_EVENT_CANONICALIZATION_V2,
    digest_algorithm: ICF_EVENT_DIGEST_ALGORITHM,
    payload_digest: icfEventPayloadDigestV2(payload),
    previous_digest_contract: predecessorContract,
  });
}

export function icfEventDigestV2({ tenantId, workId, seq, eventType, payload,
  previous, previousDigestContract } = {}) {
  const metadata = buildIcfEventDigestMetadataV2({ payload, previousDigest: previous,
    previousDigestContract });
  const digestInput = {
    schema_version: ICF_EVENT_DIGEST_INPUT_SCHEMA_V2,
    tenant_id: requiredText(tenantId, "icf_event_tenant_invalid", 120),
    work_id: requiredText(workId, "icf_event_work_invalid", 240),
    sequence_number: sequenceNumber(seq),
    event_type: requiredText(eventType, "icf_event_type_invalid", 160),
    digest_contract: metadata.digest_contract,
    canonicalization_version: metadata.canonicalization_version,
    digest_algorithm: metadata.digest_algorithm,
    payload_digest: metadata.payload_digest,
    previous_digest: optionalDigest(previous, "icf_event_previous_digest_invalid"),
    previous_digest_contract: metadata.previous_digest_contract,
  };
  return digestText(`${ICF_EVENT_DIGEST_CONTRACT_V2}\0${canonicalIcfEventJson(digestInput)}`);
}

export function buildIcfEventDigestReanchorPayloadV2(legacyHeadDigest) {
  return Object.freeze({
    schema_version: ICF_EVENT_REANCHOR_SCHEMA_V2,
    strategy: "FORWARD_ONLY_APPEND",
    from_digest: requiredDigest(legacyHeadDigest, "icf_event_reanchor_digest_invalid"),
    from_digest_contract: ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1,
    to_digest_contract: ICF_EVENT_DIGEST_CONTRACT_V2,
  });
}
