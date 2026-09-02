import crypto from "node:crypto";

export const DTT_WORK_CONTEXT_HEADER = "x-sh-dtt-work-context";
export const DTT_WORK_CONTEXT_VERSION = "dtt_work_context_v1";
export const DTT_WORK_READ_CONTEXT_HEADER = "x-sh-dtt-work-read-context";
export const DTT_WORK_READ_CONTEXT_VERSION = "dtt_work_read_context_v1";

const TOKEN_PREFIX = "dwc";
const SIGNATURE_DOMAIN = "dtt-work-context-v1";
const READ_TOKEN_PREFIX = "dwrc";
const READ_SIGNATURE_DOMAIN = "dtt-work-read-context-v1";
const READ_AUTHORIZATION_VERSION = "dtt_work_acl_read_binding_v1";
const READ_AUTHORIZATION_SOURCE = "tenant_work_v2_acl";
const REQUEST_DIGEST_DOMAIN = "dtt-work-request-v1";
const DEFAULT_TTL_MS = 60_000;
const MAX_TTL_MS = 120_000;
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
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
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

function signingSecret(value) {
  const secret = String(value || "");
  if (Buffer.byteLength(secret, "utf8") < 32) fail("dtt_work_context_signing_unavailable");
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

export function canonicalDttWorkContextBody(body) {
  if (body === undefined) return "";
  try {
    return JSON.stringify(stable(body));
  } catch {
    fail("dtt_work_context_body_invalid");
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requestBinding(method, path, body) {
  const normalizedMethod = requiredText(method, "dtt_work_context_method", 16).toUpperCase();
  if (!/^[A-Z]+$/.test(normalizedMethod)) fail("dtt_work_context_method_invalid");
  const normalizedPath = requiredText(path, "dtt_work_context_path", 2_048);
  if (!normalizedPath.startsWith("/") || normalizedPath.includes("\r") || normalizedPath.includes("\n")) {
    fail("dtt_work_context_path_invalid");
  }
  const bodySha256 = sha256(canonicalDttWorkContextBody(body));
  const requestDigest = sha256(`${REQUEST_DIGEST_DOMAIN}\u0000${canonicalDttWorkContextBody({
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

function signature(secret, encoded, domain = SIGNATURE_DOMAIN) {
  return crypto.createHmac("sha256", secret)
    .update(`${domain}\u0000${encoded}`)
    .digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function normalizedPrincipal(agentPresence = {}) {
  const principal = {
    agent_id: requiredText(agentPresence.agent_id, "dtt_work_context_agent_id", 160),
    session_id: requiredText(agentPresence.session_id, "dtt_work_context_session_id", 160),
    session_fingerprint: requiredText(
      agentPresence.session_fingerprint,
      "dtt_work_context_session_fingerprint",
      160,
    ),
    host_transport_session_fingerprint: requiredText(
      agentPresence.host_transport_session_fingerprint,
      "dtt_work_context_transport_fingerprint",
      160,
    ),
    presence_signature: requiredText(
      agentPresence.signature,
      "dtt_work_context_presence_signature",
      200,
    ),
    opaque_agent_id: requiredText(
      agentPresence.opaque_agent_id,
      "dtt_work_context_opaque_agent_id",
      160,
    ),
    actor_provenance: requiredText(
      agentPresence.actor_provenance,
      "dtt_work_context_actor_provenance",
      160,
    ),
    client_type: requiredText(agentPresence.client_type, "dtt_work_context_client_type", 64),
  };
  if (agentPresence.transport_bound !== true) fail("dtt_work_context_transport_binding_required");
  if (!/^ags_[a-f0-9]{32}$/i.test(principal.presence_signature)) {
    fail("dtt_work_context_presence_signature_invalid");
  }
  if (!/^[a-f0-9]{16,160}$/i.test(principal.session_fingerprint)
      || !/^[a-f0-9]{16,160}$/i.test(principal.host_transport_session_fingerprint)) {
    fail("dtt_work_context_session_fingerprint_invalid");
  }
  if (!/^ai_[a-f0-9]{16,160}$/i.test(principal.opaque_agent_id)
      || !/^ap_[a-f0-9]{16,160}$/i.test(principal.actor_provenance)) {
    fail("dtt_work_context_principal_invalid");
  }
  return principal;
}

function normalizedLease(leaseBinding = {}, tenantId, workId, principal, nowMs) {
  if (leaseBinding.schema_version !== "dtt_work_lease_binding_v1"
      || leaseBinding.execution_authorized !== false) {
    fail("dtt_work_context_lease_invalid");
  }
  if (leaseBinding.tenant_id !== tenantId || String(leaseBinding.work_id || "").toLowerCase() !== workId) {
    fail("dtt_work_context_lease_scope_mismatch");
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
    fail("dtt_work_context_lease_principal_mismatch");
  }
  const expiresAtMs = timestamp(leaseBinding.expires_at, "dtt_work_context_lease_expires_at");
  const participantExpiresAtMs = timestamp(
    leaseBinding.participant_expires_at,
    "dtt_work_context_participant_expires_at",
  );
  if (expiresAtMs <= nowMs || participantExpiresAtMs <= nowMs) fail("dtt_work_context_lease_expired");
  return {
    lease_id: uuid(leaseBinding.lease_id, "dtt_work_context_lease_id"),
    expires_at: new Date(expiresAtMs).toISOString(),
    participant_expires_at: new Date(participantExpiresAtMs).toISOString(),
  };
}

export function issueDttWorkContext({
  secret,
  tenant_id,
  work_id,
  lease_binding,
  agent_presence,
  method,
  path,
  body,
  now_ms = Date.now(),
  ttl_ms = DEFAULT_TTL_MS,
  random_bytes = crypto.randomBytes,
} = {}) {
  const key = signingSecret(secret);
  const tenantId = requiredText(tenant_id, "dtt_work_context_tenant_id", 120);
  const workId = uuid(work_id, "dtt_work_context_work_id");
  const nowMs = integerTimestamp(now_ms, "dtt_work_context_issued_at");
  const principal = normalizedPrincipal(agent_presence);
  const lease = normalizedLease(lease_binding, tenantId, workId, principal, nowMs);
  const request = requestBinding(method, path, body);
  const requestedTtl = Number(ttl_ms);
  if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) fail("dtt_work_context_ttl_invalid");
  const expiresAtMs = Math.min(
    nowMs + Math.min(Math.floor(requestedTtl), MAX_TTL_MS),
    Date.parse(lease.expires_at),
    Date.parse(lease.participant_expires_at),
  );
  if (expiresAtMs <= nowMs) fail("dtt_work_context_lease_expired");
  const nonce = random_bytes(18).toString("hex");
  if (!/^[a-f0-9]{36}$/i.test(nonce)) fail("dtt_work_context_nonce_invalid");
  const payload = {
    schema_version: DTT_WORK_CONTEXT_VERSION,
    tenant_id: tenantId,
    work_id: workId,
    principal,
    lease,
    request,
    execution_authorized: false,
    nonce: nonce.toLowerCase(),
    issued_at_ms: nowMs,
    expires_at_ms: expiresAtMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${TOKEN_PREFIX}_${encoded}.${signature(key, encoded)}`;
}

export function verifyDttWorkContext({
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
  const value = requiredText(token, "dtt_work_context_token", 12_000);
  const separator = value.lastIndexOf(".");
  if (!value.startsWith(`${TOKEN_PREFIX}_`) || separator <= TOKEN_PREFIX.length + 1) {
    fail("dtt_work_context_invalid");
  }
  const encoded = value.slice(TOKEN_PREFIX.length + 1, separator);
  const suppliedSignature = value.slice(separator + 1);
  const expectedSignature = signature(key, encoded);
  if (!timingSafeTextEqual(suppliedSignature, expectedSignature)) fail("dtt_work_context_signature_invalid");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail("dtt_work_context_payload_invalid");
  }
  exactKeys(payload, [
    "schema_version", "tenant_id", "work_id", "principal", "lease", "request",
    "execution_authorized", "nonce", "issued_at_ms", "expires_at_ms",
  ], "dtt_work_context_payload_invalid");
  exactKeys(payload.principal, [
    "agent_id", "session_id", "session_fingerprint", "host_transport_session_fingerprint",
    "presence_signature", "opaque_agent_id", "actor_provenance", "client_type",
  ], "dtt_work_context_principal_invalid");
  exactKeys(payload.lease, [
    "lease_id", "expires_at", "participant_expires_at",
  ], "dtt_work_context_lease_invalid");
  exactKeys(payload.request, [
    "method", "path", "body_sha256", "request_digest",
  ], "dtt_work_context_request_invalid");
  if (payload.schema_version !== DTT_WORK_CONTEXT_VERSION || payload.execution_authorized !== false) {
    fail("dtt_work_context_payload_invalid");
  }
  const tenantId = requiredText(expected_tenant_id, "dtt_work_context_expected_tenant_id", 120);
  if (payload.tenant_id !== tenantId) fail("dtt_work_context_tenant_mismatch");
  const workId = uuid(payload.work_id, "dtt_work_context_work_id");
  if (expected_work_id !== undefined && workId !== uuid(expected_work_id, "dtt_work_context_expected_work_id")) {
    fail("dtt_work_context_work_mismatch");
  }
  const expectedRequest = requestBinding(method, path, body);
  if (!timingSafeTextEqual(payload.request.request_digest, expectedRequest.request_digest)
      || payload.request.method !== expectedRequest.method
      || payload.request.path !== expectedRequest.path
      || !timingSafeTextEqual(payload.request.body_sha256, expectedRequest.body_sha256)) {
    fail("dtt_work_context_request_mismatch");
  }
  const nowMs = integerTimestamp(now_ms, "dtt_work_context_now");
  const issuedAtMs = integerTimestamp(payload.issued_at_ms, "dtt_work_context_issued_at");
  const expiresAtMs = integerTimestamp(payload.expires_at_ms, "dtt_work_context_expires_at");
  const leaseExpiresAtMs = timestamp(payload.lease.expires_at, "dtt_work_context_lease_expires_at");
  const participantExpiresAtMs = timestamp(
    payload.lease.participant_expires_at,
    "dtt_work_context_participant_expires_at",
  );
  if (issuedAtMs > nowMs + 5_000) fail("dtt_work_context_not_active");
  if (expiresAtMs <= nowMs || leaseExpiresAtMs <= nowMs || participantExpiresAtMs <= nowMs) {
    fail("dtt_work_context_expired");
  }
  if (expiresAtMs > issuedAtMs + MAX_TTL_MS
      || expiresAtMs > leaseExpiresAtMs
      || expiresAtMs > participantExpiresAtMs) {
    fail("dtt_work_context_expiry_invalid");
  }
  if (!/^[a-f0-9]{36}$/i.test(String(payload.nonce || ""))) fail("dtt_work_context_nonce_invalid");
  normalizedPrincipal({
    ...payload.principal,
    signature: payload.principal.presence_signature,
    transport_bound: true,
  });
  uuid(payload.lease.lease_id, "dtt_work_context_lease_id");
  return deepFreeze(payload);
}

function normalizedReadAuthorization(readBinding = {}, tenantId, workId) {
  if (
    readBinding.schema_version !== READ_AUTHORIZATION_VERSION
    || readBinding.authorization_source !== READ_AUTHORIZATION_SOURCE
    || readBinding.execution_authorized !== false
    || readBinding.tenant_id !== tenantId
    || String(readBinding.work_id || "").toLowerCase() !== workId
  ) {
    fail("dtt_work_read_context_authorization_invalid");
  }
  return {
    schema_version: READ_AUTHORIZATION_VERSION,
    authorization_source: READ_AUTHORIZATION_SOURCE,
  };
}

export function issueDttWorkReadContext({
  secret,
  tenant_id,
  work_id,
  read_binding,
  agent_presence,
  method,
  path,
  body,
  now_ms = Date.now(),
  ttl_ms = DEFAULT_TTL_MS,
  random_bytes = crypto.randomBytes,
} = {}) {
  const key = signingSecret(secret);
  const tenantId = requiredText(tenant_id, "dtt_work_read_context_tenant_id", 120);
  const workId = uuid(work_id, "dtt_work_read_context_work_id");
  const nowMs = integerTimestamp(now_ms, "dtt_work_read_context_issued_at");
  const principal = normalizedPrincipal(agent_presence);
  const authorization = normalizedReadAuthorization(read_binding, tenantId, workId);
  const request = requestBinding(method, path, body);
  const requestedTtl = Number(ttl_ms);
  if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) {
    fail("dtt_work_read_context_ttl_invalid");
  }
  const expiresAtMs = nowMs + Math.min(Math.floor(requestedTtl), MAX_TTL_MS);
  const nonce = random_bytes(18).toString("hex");
  if (!/^[a-f0-9]{36}$/i.test(nonce)) fail("dtt_work_read_context_nonce_invalid");
  const payload = {
    schema_version: DTT_WORK_READ_CONTEXT_VERSION,
    tenant_id: tenantId,
    work_id: workId,
    principal,
    authorization,
    request,
    execution_authorized: false,
    nonce: nonce.toLowerCase(),
    issued_at_ms: nowMs,
    expires_at_ms: expiresAtMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${READ_TOKEN_PREFIX}_${encoded}.${signature(key, encoded, READ_SIGNATURE_DOMAIN)}`;
}

export function verifyDttWorkReadContext({
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
  const value = requiredText(token, "dtt_work_read_context_token", 12_000);
  const separator = value.lastIndexOf(".");
  if (!value.startsWith(`${READ_TOKEN_PREFIX}_`) || separator <= READ_TOKEN_PREFIX.length + 1) {
    fail("dtt_work_read_context_invalid");
  }
  const encoded = value.slice(READ_TOKEN_PREFIX.length + 1, separator);
  const suppliedSignature = value.slice(separator + 1);
  const expectedSignature = signature(key, encoded, READ_SIGNATURE_DOMAIN);
  if (!timingSafeTextEqual(suppliedSignature, expectedSignature)) {
    fail("dtt_work_read_context_signature_invalid");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail("dtt_work_read_context_payload_invalid");
  }
  exactKeys(payload, [
    "schema_version", "tenant_id", "work_id", "principal", "authorization", "request",
    "execution_authorized", "nonce", "issued_at_ms", "expires_at_ms",
  ], "dtt_work_read_context_payload_invalid");
  exactKeys(payload.principal, [
    "agent_id", "session_id", "session_fingerprint", "host_transport_session_fingerprint",
    "presence_signature", "opaque_agent_id", "actor_provenance", "client_type",
  ], "dtt_work_read_context_principal_invalid");
  exactKeys(payload.authorization, [
    "schema_version", "authorization_source",
  ], "dtt_work_read_context_authorization_invalid");
  exactKeys(payload.request, [
    "method", "path", "body_sha256", "request_digest",
  ], "dtt_work_read_context_request_invalid");
  if (payload.schema_version !== DTT_WORK_READ_CONTEXT_VERSION
      || payload.execution_authorized !== false
      || payload.authorization.schema_version !== READ_AUTHORIZATION_VERSION
      || payload.authorization.authorization_source !== READ_AUTHORIZATION_SOURCE) {
    fail("dtt_work_read_context_payload_invalid");
  }
  const tenantId = requiredText(
    expected_tenant_id,
    "dtt_work_read_context_expected_tenant_id",
    120,
  );
  if (payload.tenant_id !== tenantId) fail("dtt_work_read_context_tenant_mismatch");
  const workId = uuid(payload.work_id, "dtt_work_read_context_work_id");
  if (expected_work_id !== undefined
      && workId !== uuid(expected_work_id, "dtt_work_read_context_expected_work_id")) {
    fail("dtt_work_read_context_work_mismatch");
  }
  const expectedRequest = requestBinding(method, path, body);
  if (!timingSafeTextEqual(payload.request.request_digest, expectedRequest.request_digest)
      || payload.request.method !== expectedRequest.method
      || payload.request.path !== expectedRequest.path
      || !timingSafeTextEqual(payload.request.body_sha256, expectedRequest.body_sha256)) {
    fail("dtt_work_read_context_request_mismatch");
  }
  const nowMs = integerTimestamp(now_ms, "dtt_work_read_context_now");
  const issuedAtMs = integerTimestamp(payload.issued_at_ms, "dtt_work_read_context_issued_at");
  const expiresAtMs = integerTimestamp(payload.expires_at_ms, "dtt_work_read_context_expires_at");
  if (issuedAtMs > nowMs + 5_000) fail("dtt_work_read_context_not_active");
  if (expiresAtMs <= nowMs) fail("dtt_work_read_context_expired");
  if (expiresAtMs > issuedAtMs + MAX_TTL_MS) fail("dtt_work_read_context_expiry_invalid");
  if (!/^[a-f0-9]{36}$/i.test(String(payload.nonce || ""))) {
    fail("dtt_work_read_context_nonce_invalid");
  }
  normalizedPrincipal({
    ...payload.principal,
    signature: payload.principal.presence_signature,
    transport_bound: true,
  });
  return deepFreeze(payload);
}
