import crypto from "node:crypto";

export const CAUSAL_CANONICAL_VERSION = "causal_canonical_json_v1";

export class CausalContinuityError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message);
    this.name = "CausalContinuityError";
    this.code = code;
    this.status = statusFor(code);
    if (details !== undefined) this.details = details;
  }
}

function statusFor(code) {
  if (code === "AGENT_CONTEXT_REQUIRED" || code === "AGENT_CONTEXT_INVALID" || code === "AUTHENTICATED_TENANT_REQUIRED" || code === "AUTHENTICATED_ACTOR_REQUIRED") return 401;
  if (code === "CAUSAL_NOT_FOUND") return 404;
  if (code === "IDEMPOTENCY_CONFLICT" || code === "STALE_PROJECT_STATE" || code === "CONTEXT_REPLAYED") return 409;
  if (["CAUSAL_SIGNER_UNAVAILABLE", "CAUSAL_RUNTIME_NOT_READY", "LEASE_VERIFIER_UNAVAILABLE"].includes(code)) return 503;
  if (code.endsWith("_REQUIRED") || code.endsWith("_INVALID") || code.endsWith("_MISMATCH") || code.endsWith("_VIOLATION")) return 400;
  return 422;
}

function normalize(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CausalContinuityError("CANONICAL_VALUE_INVALID", "Non-finite numbers are not canonicalizable");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64url");
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
  if (typeof value !== "object") throw new CausalContinuityError("CANONICAL_VALUE_INVALID", `Unsupported canonical value: ${typeof value}`);
  if (seen.has(value)) throw new CausalContinuityError("CANONICAL_VALUE_INVALID", "Circular values are not canonicalizable");
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined) output[key] = normalize(item, seen);
  }
  seen.delete(value);
  return output;
}

export function canonicalize(value) {
  return JSON.stringify(normalize(value, new WeakSet()));
}

export function causalDigest(value) {
  return crypto.createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function opaqueNonce(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function requireText(value, name, max = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new CausalContinuityError(`${name.toUpperCase()}_REQUIRED`);
  if (normalized.length > max) throw new CausalContinuityError(`${name.toUpperCase()}_INVALID`);
  return normalized;
}

export function requireUuid(value, name) {
  const normalized = requireText(value, name, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new CausalContinuityError(`${name.toUpperCase()}_INVALID`);
  }
  return normalized;
}

export function requireDigest(value, name) {
  const normalized = requireText(value, name, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new CausalContinuityError(`${name.toUpperCase()}_INVALID`);
  return normalized;
}

export function sortedUnique(values, name, { maxItems = 100, maxLength = 240 } = {}) {
  if (!Array.isArray(values)) throw new CausalContinuityError(`${name.toUpperCase()}_INVALID`);
  if (values.length > maxItems) throw new CausalContinuityError(`${name.toUpperCase()}_INVALID`);
  return [...new Set(values.map((item) => requireText(item, name, maxLength)))].sort();
}

export function publicError(error) {
  const code = error instanceof CausalContinuityError ? error.code : "CAUSAL_INTERNAL_ERROR";
  return {
    code,
    message: error instanceof CausalContinuityError ? error.message : "Causal continuity operation failed",
    ...(error instanceof CausalContinuityError && error.details !== undefined ? { details: error.details } : {}),
  };
}
