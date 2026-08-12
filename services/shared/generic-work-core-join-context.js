import crypto from "node:crypto";

export const GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER = "x-sh-generic-work-core-join-context";
export const GENERIC_WORK_CORE_JOIN_CONTEXT_VERSION = "generic_work_core_join_context_v1";
export const GENERIC_WORK_CORE_JOIN_LEASE_BINDING_VERSION = "generic_work_core_join_lease_binding_v1";
export const GENERIC_WORK_CORE_JOIN_CONTEXT_PURPOSE = "generic_work_core_join_issue";

const TOKEN_PREFIX = "gwcjc";
const SIGNATURE_DOMAIN = "generic-work-core-join-context-v1";
const REQUEST_DIGEST_DOMAIN = "generic-work-core-join-request-v1";
const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
  return value;
}

function requiredText(value, field, max = 240) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max || normalized.includes("\u0000")) fail(`${field}_invalid`);
  return normalized;
}

function uuid(value, field) {
  const normalized = requiredText(value, field, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function tenant(value, field) {
  const normalized = requiredText(value, field, 64);
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(normalized)) fail(`${field}_invalid`);
  return normalized;
}

function signingSecret(value) {
  const secret = String(value || "");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    fail("generic_work_core_join_context_signing_unavailable");
  }
  return secret;
}

function stable(value) {
  if (Array.isArray(value)) return value.map((item) => stable(item === undefined ? null : item));
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stable(value[key]);
    return result;
  }, {});
}

export function canonicalGenericWorkCoreJoinContextBody(body) {
  if (body === undefined) return "";
  try {
    return JSON.stringify(stable(body));
  } catch {
    fail("generic_work_core_join_context_body_invalid");
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requestBinding(method, path, body) {
  const normalizedMethod = requiredText(method, "generic_work_core_join_context_method", 16).toUpperCase();
  if (!/^[A-Z]+$/.test(normalizedMethod)) fail("generic_work_core_join_context_method_invalid");
  const normalizedPath = requiredText(path, "generic_work_core_join_context_path", 2_048);
  if (!normalizedPath.startsWith("/") || normalizedPath.includes("\r") || normalizedPath.includes("\n")) {
    fail("generic_work_core_join_context_path_invalid");
  }
  const bodySha256 = sha256(canonicalGenericWorkCoreJoinContextBody(body));
  const requestDigest = sha256(`${REQUEST_DIGEST_DOMAIN}\u0000${canonicalGenericWorkCoreJoinContextBody({
    method: normalizedMethod,
    path: normalizedPath,
    body_sha256: bodySha256,
  })}`);
  return {
    method: normalizedMethod,
    path: normalizedPath,
    body_sha256: bodySha256,
    request_digest: requestDigest,
  };
}

function timestamp(value, field) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) fail(`${field}_invalid`);
  return parsed;
}

function integerTimestamp(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`${field}_invalid`);
  return parsed;
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signature(secret, encoded) {
  return crypto.createHmac("sha256", secret)
    .update(`${SIGNATURE_DOMAIN}\u0000${encoded}`)
    .digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function normalizedPrincipal(agentPresence = {}) {
  const principal = {
    agent_id: requiredText(agentPresence.agent_id, "generic_work_core_join_context_agent_id", 160),
    session_id: requiredText(agentPresence.session_id, "generic_work_core_join_context_session_id", 160),
    session_fingerprint: requiredText(
      agentPresence.session_fingerprint,
      "generic_work_core_join_context_session_fingerprint",
      160,
    ).toLowerCase(),
    host_transport_session_fingerprint: requiredText(
      agentPresence.host_transport_session_fingerprint,
      "generic_work_core_join_context_transport_fingerprint",
      160,
    ).toLowerCase(),
    presence_signature: requiredText(
      agentPresence.signature,
      "generic_work_core_join_context_presence_signature",
      200,
    ).toLowerCase(),
    opaque_agent_id: requiredText(
      agentPresence.opaque_agent_id,
      "generic_work_core_join_context_opaque_agent_id",
      160,
    ).toLowerCase(),
    actor_provenance: requiredText(
      agentPresence.actor_provenance,
      "generic_work_core_join_context_actor_provenance",
      160,
    ).toLowerCase(),
    client_type: requiredText(agentPresence.client_type, "generic_work_core_join_context_client_type", 64),
  };
  if (agentPresence.transport_bound !== true) {
    fail("generic_work_core_join_context_transport_binding_required");
  }
  if (!/^ags_[a-f0-9]{32}$/.test(principal.presence_signature)) {
    fail("generic_work_core_join_context_presence_signature_invalid");
  }
  if (!/^[a-f0-9]{16,160}$/.test(principal.session_fingerprint)
      || !/^[a-f0-9]{16,160}$/.test(principal.host_transport_session_fingerprint)) {
    fail("generic_work_core_join_context_session_fingerprint_invalid");
  }
  if (!/^ai_[a-f0-9]{16,160}$/.test(principal.opaque_agent_id)
      || !/^ap_[a-f0-9]{16,160}$/.test(principal.actor_provenance)) {
    fail("generic_work_core_join_context_principal_invalid");
  }
  return principal;
}

function normalizedLease(leaseBinding = {}, tenantId, workId, principal, nowMs) {
  if (leaseBinding.schema_version !== GENERIC_WORK_CORE_JOIN_LEASE_BINDING_VERSION
      || leaseBinding.execution_authorized !== false) {
    fail("generic_work_core_join_context_lease_invalid");
  }
  if (leaseBinding.tenant_id !== tenantId || String(leaseBinding.work_id || "").toLowerCase() !== workId) {
    fail("generic_work_core_join_context_lease_scope_mismatch");
  }
  const fields = [
    ["agent_id", principal.agent_id],
    ["session_id", principal.session_id],
    ["session_fingerprint", principal.session_fingerprint],
    ["host_transport_session_fingerprint", principal.host_transport_session_fingerprint],
    ["presence_signature", principal.presence_signature],
    ["opaque_agent_id", principal.opaque_agent_id],
    ["client_type", principal.client_type],
    ["actor_provenance", principal.actor_provenance],
  ];
  if (fields.some(([field, expected]) => String(leaseBinding[field] || "") !== expected)) {
    fail("generic_work_core_join_context_lease_principal_mismatch");
  }
  const expiresAtMs = timestamp(
    leaseBinding.expires_at,
    "generic_work_core_join_context_lease_expires_at",
  );
  const participantExpiresAtMs = timestamp(
    leaseBinding.participant_expires_at,
    "generic_work_core_join_context_participant_expires_at",
  );
  if (expiresAtMs <= nowMs || participantExpiresAtMs <= nowMs) {
    fail("generic_work_core_join_context_lease_expired");
  }
  return {
    lease_id: uuid(leaseBinding.lease_id, "generic_work_core_join_context_lease_id"),
    expires_at: new Date(expiresAtMs).toISOString(),
    participant_expires_at: new Date(participantExpiresAtMs).toISOString(),
  };
}

function normalizedVerifier(value = {}) {
  exactKeys(
    value,
    ["key_id", "public_key_fingerprint"],
    "generic_work_core_join_verifier_unavailable",
  );
  const keyId = requiredText(value.key_id, "generic_work_core_join_context_key_id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(keyId)) {
    fail("generic_work_core_join_verifier_unavailable");
  }
  const publicKeyFingerprint = String(value.public_key_fingerprint || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(publicKeyFingerprint)) {
    fail("generic_work_core_join_verifier_unavailable");
  }
  return {
    key_id: keyId,
    public_key_fingerprint: publicKeyFingerprint,
  };
}

export function issueGenericWorkCoreJoinContext({
  secret,
  tenant_id,
  work_id,
  lease_binding,
  agent_presence,
  verifier,
  method,
  path,
  body,
  now_ms = Date.now(),
  ttl_ms = DEFAULT_TTL_MS,
  random_bytes = crypto.randomBytes,
} = {}) {
  const key = signingSecret(secret);
  const tenantId = tenant(tenant_id, "generic_work_core_join_context_tenant_id");
  const workId = uuid(work_id, "generic_work_core_join_context_work_id");
  const nowMs = integerTimestamp(now_ms, "generic_work_core_join_context_issued_at");
  const principal = normalizedPrincipal(agent_presence);
  const lease = normalizedLease(lease_binding, tenantId, workId, principal, nowMs);
  const verifierBinding = normalizedVerifier(verifier);
  const request = requestBinding(method, path, body);
  const requestedTtl = Number(ttl_ms);
  if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) {
    fail("generic_work_core_join_context_ttl_invalid");
  }
  const expiresAtMs = Math.min(
    nowMs + Math.min(Math.floor(requestedTtl), MAX_TTL_MS),
    Date.parse(lease.expires_at),
    Date.parse(lease.participant_expires_at),
  );
  if (expiresAtMs <= nowMs) fail("generic_work_core_join_context_lease_expired");
  const nonce = random_bytes(18).toString("hex").toLowerCase();
  if (!/^[a-f0-9]{36}$/.test(nonce)) fail("generic_work_core_join_context_nonce_invalid");
  const payload = {
    schema_version: GENERIC_WORK_CORE_JOIN_CONTEXT_VERSION,
    purpose: GENERIC_WORK_CORE_JOIN_CONTEXT_PURPOSE,
    tenant_id: tenantId,
    work_id: workId,
    principal,
    lease,
    verifier: verifierBinding,
    request,
    execution_authorized: false,
    nonce,
    issued_at_ms: nowMs,
    expires_at_ms: expiresAtMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${TOKEN_PREFIX}_${encoded}.${signature(key, encoded)}`;
}

export function verifyGenericWorkCoreJoinContext({
  token,
  secret,
  expected_tenant_id,
  expected_work_id,
  method,
  path,
  body,
  now_ms = Date.now(),
} = {}) {
  const key = signingSecret(secret);
  const value = requiredText(token, "generic_work_core_join_context_token", 12_000);
  const separator = value.lastIndexOf(".");
  if (!value.startsWith(`${TOKEN_PREFIX}_`) || separator <= TOKEN_PREFIX.length + 1) {
    fail("generic_work_core_join_context_invalid");
  }
  const encoded = value.slice(TOKEN_PREFIX.length + 1, separator);
  const suppliedSignature = value.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    fail("generic_work_core_join_context_invalid");
  }
  const expectedSignature = signature(key, encoded);
  if (!timingSafeTextEqual(suppliedSignature, expectedSignature)) {
    fail("generic_work_core_join_context_signature_invalid");
  }
  let payload;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) fail("generic_work_core_join_context_payload_invalid");
    payload = JSON.parse(decoded.toString("utf8"));
  } catch (error) {
    if (error?.code === "generic_work_core_join_context_payload_invalid") throw error;
    fail("generic_work_core_join_context_payload_invalid");
  }
  exactKeys(payload, [
    "schema_version", "purpose", "tenant_id", "work_id", "principal", "lease", "verifier", "request",
    "execution_authorized", "nonce", "issued_at_ms", "expires_at_ms",
  ], "generic_work_core_join_context_payload_invalid");
  exactKeys(payload.principal, [
    "agent_id", "session_id", "session_fingerprint", "host_transport_session_fingerprint",
    "presence_signature", "opaque_agent_id", "actor_provenance", "client_type",
  ], "generic_work_core_join_context_principal_invalid");
  exactKeys(payload.lease, [
    "lease_id", "expires_at", "participant_expires_at",
  ], "generic_work_core_join_context_lease_invalid");
  exactKeys(payload.verifier, [
    "key_id", "public_key_fingerprint",
  ], "generic_work_core_join_verifier_unavailable");
  exactKeys(payload.request, [
    "method", "path", "body_sha256", "request_digest",
  ], "generic_work_core_join_context_request_invalid");
  if (payload.schema_version !== GENERIC_WORK_CORE_JOIN_CONTEXT_VERSION
      || payload.purpose !== GENERIC_WORK_CORE_JOIN_CONTEXT_PURPOSE
      || payload.execution_authorized !== false) {
    fail("generic_work_core_join_context_payload_invalid");
  }
  const tenantId = tenant(
    expected_tenant_id,
    "generic_work_core_join_context_expected_tenant_id",
  );
  if (payload.tenant_id !== tenantId) fail("generic_work_core_join_context_tenant_mismatch");
  const workId = uuid(payload.work_id, "generic_work_core_join_context_work_id");
  if (expected_work_id !== undefined
      && workId !== uuid(expected_work_id, "generic_work_core_join_context_expected_work_id")) {
    fail("generic_work_core_join_context_work_mismatch");
  }
  const expectedRequest = requestBinding(method, path, body);
  if (!timingSafeTextEqual(payload.request.request_digest, expectedRequest.request_digest)
      || payload.request.method !== expectedRequest.method
      || payload.request.path !== expectedRequest.path
      || !timingSafeTextEqual(payload.request.body_sha256, expectedRequest.body_sha256)) {
    fail("generic_work_core_join_context_request_mismatch");
  }
  const nowMs = integerTimestamp(now_ms, "generic_work_core_join_context_now");
  const issuedAtMs = integerTimestamp(payload.issued_at_ms, "generic_work_core_join_context_issued_at");
  const expiresAtMs = integerTimestamp(payload.expires_at_ms, "generic_work_core_join_context_expires_at");
  const leaseExpiresAtMs = timestamp(
    payload.lease.expires_at,
    "generic_work_core_join_context_lease_expires_at",
  );
  const participantExpiresAtMs = timestamp(
    payload.lease.participant_expires_at,
    "generic_work_core_join_context_participant_expires_at",
  );
  if (issuedAtMs > nowMs + 5_000) fail("generic_work_core_join_context_not_active");
  if (expiresAtMs <= nowMs || leaseExpiresAtMs <= nowMs || participantExpiresAtMs <= nowMs) {
    fail("generic_work_core_join_context_expired");
  }
  if (expiresAtMs > issuedAtMs + MAX_TTL_MS
      || expiresAtMs > leaseExpiresAtMs
      || expiresAtMs > participantExpiresAtMs) {
    fail("generic_work_core_join_context_expiry_invalid");
  }
  if (!/^[a-f0-9]{36}$/.test(String(payload.nonce || ""))) {
    fail("generic_work_core_join_context_nonce_invalid");
  }
  normalizedPrincipal({
    ...payload.principal,
    signature: payload.principal.presence_signature,
    transport_bound: true,
  });
  normalizedVerifier(payload.verifier);
  uuid(payload.lease.lease_id, "generic_work_core_join_context_lease_id");
  return deepFreeze(payload);
}
