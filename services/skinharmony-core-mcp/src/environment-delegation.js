import crypto from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonical(value[key]);
    return result;
  }, {});
}

function mac(payload, key) {
  return crypto.createHmac("sha256", key).update(JSON.stringify(canonical(payload))).digest("base64url");
}

function equal(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const SOURCE_KINDS = new Set(["oauth", "codex", "service"]);
const MEMBERSHIP_ROLES = new Set(["member", "team_manager", "tenant_owner", "super_admin"]);
const MEMBER_BINDING_ROLES = new Set(["member", "reviewer", "operator", "support_delegate"]);
const CLIENT_TYPES = new Set(["chatgpt", "codex", "api_agent", "other"]);
const INTERACTION_MODES = new Set(["nyra_conversational", "native_tooling"]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/;
const CAPABILITY = /^[a-z][a-z0-9_.:-]{1,79}$/;
const SUBJECT = /^[^\u0000-\u001f\u007f]{1,128}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const NONCE = /^[A-Za-z0-9_-]{16,80}$/u;
const ENVIRONMENT_DELEGATION_SCHEMA_VERSION = 3;

function invalid() {
  throw new Error("environment_delegation_invalid");
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid();
}

function boundedText(value, maximum = 240, { nullable = false, pattern = IDENTIFIER } = {}) {
  if (nullable && value === null) return null;
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum || (pattern && !pattern.test(normalized))) invalid();
  return normalized;
}

function stringList(value, { maximum = 256, itemMaximum = 240, pattern = IDENTIFIER, allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length < 1)) invalid();
  const normalized = value.map((item) => boundedText(item, itemMaximum, { pattern }));
  if (new Set(normalized).size !== normalized.length) invalid();
  return normalized;
}

function normalizedPrincipal(value) {
  exactKeys(value, new Set([
    "schema_version", "registered", "registry_revision", "app_id", "auth_kind",
    "host_kind", "client_type", "interaction_mode", "capabilities",
  ]));
  if (value.schema_version !== "authenticated_host_principal_v1" ||
      typeof value.registered !== "boolean") invalid();
  const registered = value.registered;
  const appId = value.app_id === null ? null : boundedText(value.app_id, 64, {
    pattern: /^[a-z][a-z0-9_-]{1,63}$/,
  });
  const hostKind = value.host_kind === null ? null : boundedText(value.host_kind, 64, {
    pattern: /^[a-z][a-z0-9_]{1,62}_native$/,
  });
  const registryRevision = value.registry_revision === null
    ? null
    : boundedText(value.registry_revision, 128);
  const authKind = boundedText(value.auth_kind, 40, { pattern: /^[a-z][a-z0-9_-]{0,39}$/ });
  const clientType = boundedText(value.client_type, 20, { pattern: /^[a-z_]+$/ });
  const interactionMode = boundedText(value.interaction_mode, 32, { pattern: /^[a-z_]+$/ });
  if (!CLIENT_TYPES.has(clientType) || !INTERACTION_MODES.has(interactionMode)) invalid();
  if (registered && (!appId || !hostKind || !registryRevision)) invalid();
  if (!registered && (appId !== null || hostKind !== null)) invalid();
  return {
    schema_version: "authenticated_host_principal_v1",
    registered,
    registry_revision: registryRevision,
    app_id: appId,
    auth_kind: authKind,
    host_kind: hostKind,
    client_type: clientType,
    interaction_mode: interactionMode,
    capabilities: stringList(value.capabilities, { maximum: 32, itemMaximum: 80, pattern: CAPABILITY }),
  };
}

function normalizedMembership(value, { tenantId, subject, now }) {
  if (value === null) return null;
  exactKeys(value, new Set([
    "schema_version", "authenticated", "tenant_id", "subject", "role", "team_ids",
    "managed_team_ids", "assigned_work_ids", "issued_at", "expires_at",
  ]));
  const tenant = boundedText(value.tenant_id, 64);
  const memberSubject = boundedText(value.subject, 128, { pattern: SUBJECT });
  const role = boundedText(value.role, 32, { pattern: /^[a-z_]+$/ });
  const issuedAt = Date.parse(String(value.issued_at || ""));
  const expiresAt = Date.parse(String(value.expires_at || ""));
  if (value.schema_version !== "tenant_membership_binding_v1" || value.authenticated !== true ||
      tenant !== tenantId || memberSubject !== subject || !MEMBERSHIP_ROLES.has(role) ||
      !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt >= expiresAt ||
      issuedAt > now + 30_000 || expiresAt <= now) invalid();
  const managedTeamIds = stringList(value.managed_team_ids);
  if (role === "team_manager" && managedTeamIds.length < 1) invalid();
  return {
    schema_version: "tenant_membership_binding_v1",
    authenticated: true,
    tenant_id: tenant,
    subject: memberSubject,
    role,
    team_ids: stringList(value.team_ids),
    managed_team_ids: managedTeamIds,
    assigned_work_ids: stringList(value.assigned_work_ids),
    issued_at: new Date(issuedAt).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
  };
}

function delegatedIdentityV1(identity) {
  const principal = identity.authenticatedHostPrincipal;
  return {
    kind: "delegated_gateway",
    subject: String(identity.subject || ""),
    tenantId: String(identity.tenantId || ""),
    role: String(identity.role || "member"),
    scopes: Array.isArray(identity.scopes) ? identity.scopes.map(String) : [],
    oauthOwnerBound: identity.oauthOwnerBound === true,
    oauthOwnerElevated: identity.oauthOwnerElevated === true,
    providerSetupOwner: identity.providerSetupOwner === true,
    godMode: identity.godMode === true,
    ...(principal?.schema_version === "authenticated_host_principal_v1"
      ? {
        authenticatedHostPrincipal: {
          schema_version: principal.schema_version,
          registered: principal.registered === true,
          registry_revision: principal.registry_revision || null,
          app_id: principal.app_id || null,
          auth_kind: principal.auth_kind || null,
          host_kind: principal.host_kind || null,
          client_type: principal.client_type || "other",
          interaction_mode: principal.interaction_mode || "nyra_conversational",
          capabilities: Array.isArray(principal.capabilities)
            ? principal.capabilities.map(String)
            : [],
        },
      }
      : {}),
  };
}

function delegatedIdentityV2(identity, now = Date.now()) {
  if (!identity || identity.environmentDelegationBound === true || !SOURCE_KINDS.has(identity.kind)) invalid();
  const subject = boundedText(identity.subject, 128, { pattern: SUBJECT });
  const tenantId = boundedText(identity.tenantId, 64);
  const principal = normalizedPrincipal(identity.authenticatedHostPrincipal);
  const membership = normalizedMembership(identity.authenticatedTenantMembership ?? null, {
    tenantId, subject, now,
  });
  const oauthOwnerBound = identity.oauthOwnerBound === true;
  const oauthOwnerElevated = identity.oauthOwnerElevated === true;
  const oauthTenantMemberBound = identity.oauthTenantMemberBound === true;
  const registeredServiceMemberBound = identity.registeredServiceMemberBound === true;
  const selfServiceTenant = identity.selfServiceTenant === true;
  const supportBound = identity.tenantSupportDelegationBound === true;
  if ((oauthOwnerBound || oauthTenantMemberBound || registeredServiceMemberBound ||
      selfServiceTenant || supportBound) && !membership) invalid();
  if (oauthOwnerElevated && (
    !oauthOwnerBound || identity.kind !== "oauth" ||
    !["tenant_owner", "owner_root"].includes(String(identity.role || ""))
  )) invalid();
  const membershipRole = identity.tenantMembershipRole == null
    ? null
    : boundedText(identity.tenantMembershipRole, 32, { pattern: /^[a-z_]+$/ });
  if ((oauthTenantMemberBound || registeredServiceMemberBound) &&
      !MEMBER_BINDING_ROLES.has(membershipRole)) invalid();
  const supportId = identity.tenantSupportDelegationId == null
    ? null
    : boundedText(identity.tenantSupportDelegationId, 160);
  const rawSupportExpiry = identity.tenantSupportDelegationExpiresAt == null
    ? null
    : Date.parse(String(identity.tenantSupportDelegationExpiresAt));
  if (rawSupportExpiry !== null && !Number.isFinite(rawSupportExpiry)) invalid();
  const supportExpiresAt = rawSupportExpiry === null
    ? null
    : new Date(rawSupportExpiry).toISOString();
  if (supportBound) {
    const supportExpiry = Date.parse(String(supportExpiresAt || ""));
    if (membershipRole !== "support_delegate" || !supportId || !Number.isFinite(supportExpiry) ||
        supportExpiry <= now || supportExpiry > Date.parse(membership.expires_at)) invalid();
  } else if (supportId !== null || supportExpiresAt !== null) invalid();
  return {
    kind: identity.kind,
    subject,
    tenantId,
    role: boundedText(identity.role || "member", 32, { pattern: /^[a-z_]+$/ }),
    scopes: stringList(identity.scopes, { maximum: 64, itemMaximum: 120, pattern: CAPABILITY, allowEmpty: false }),
    oauthOwnerBound,
    oauthOwnerElevated,
    providerSetupOwner: identity.providerSetupOwner === true,
    godMode: identity.godMode === true,
    oauthTenantMemberBound,
    registeredServiceMemberBound,
    selfServiceTenant,
    tenantMembershipRole: membershipRole,
    tenantSupportDelegationBound: supportBound,
    tenantSupportDelegationId: supportId,
    tenantSupportDelegationExpiresAt: supportExpiresAt,
    authenticatedTenantMembership: membership,
    authenticatedHostPrincipal: principal,
  };
}

function requestId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) invalid();
    return value;
  }
  if (typeof value !== "string" || value.length > 240 ||
      /[\u0000-\u001f\u007f]/u.test(value)) invalid();
  return value;
}

function requestBinding({
  method,
  toolName,
  exactTarget,
  args,
  requestId: id,
  transportSessionId,
} = {}) {
  if (method !== "tools/call" || !args || typeof args !== "object" || Array.isArray(args)) invalid();
  return {
    schema_version: "environment_delegation_request_v1",
    jsonrpc: "2.0",
    id: requestId(id),
    method,
    tool: boundedText(toolName, 160),
    exact_target: boundedText(exactTarget, 160),
    transport_session_id: transportSessionId != null
      ? boundedText(transportSessionId, 240, { pattern: SUBJECT })
      : null,
    arguments: canonical(args),
  };
}

export function environmentDelegationRequestDigest(request) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(requestBinding(request)))
    .digest("hex");
}

function ownerConfirmationClaim(identity, requestDigest) {
  if (identity.oauthOwnerElevated !== true) return null;
  const sourceBindingDigest = String(identity.ownerConfirmationBindingDigest || "").trim().toLowerCase();
  const verifiedAt = Date.parse(String(identity.ownerConfirmationVerifiedAt || ""));
  const reference = String(identity.ownerConfirmationReference || "");
  if (!SHA256.test(sourceBindingDigest) || !Number.isFinite(verifiedAt) || !reference) invalid();
  return {
    schema_version: "environment_delegated_owner_confirmation_v1",
    verified: true,
    subject_fingerprint: crypto.createHash("sha256").update(identity.subject).digest("hex"),
    source_request_binding_digest: sourceBindingDigest,
    confirmation_reference_digest: crypto.createHash("sha256").update(reference).digest("hex"),
    delegated_request_digest: requestDigest,
    verified_at: new Date(verifiedAt).toISOString(),
  };
}

function normalizedOwnerConfirmation(value, { identity, requestDigest, currentMs }) {
  if (value === null) {
    if (identity.oauthOwnerElevated === true) invalid();
    return null;
  }
  exactKeys(value, new Set([
    "schema_version", "verified", "subject_fingerprint",
    "source_request_binding_digest", "confirmation_reference_digest",
    "delegated_request_digest", "verified_at",
  ]));
  const verifiedAt = Date.parse(String(value.verified_at || ""));
  if (value.schema_version !== "environment_delegated_owner_confirmation_v1" ||
      value.verified !== true || identity.kind !== "oauth" ||
      identity.oauthOwnerBound !== true || identity.oauthOwnerElevated !== true ||
      !SHA256.test(String(value.subject_fingerprint || "")) ||
      value.subject_fingerprint !== crypto.createHash("sha256").update(identity.subject).digest("hex") ||
      !SHA256.test(String(value.source_request_binding_digest || "")) ||
      !SHA256.test(String(value.confirmation_reference_digest || "")) ||
      value.delegated_request_digest !== requestDigest ||
      !Number.isFinite(verifiedAt) || verifiedAt > currentMs + 30_000 ||
      currentMs - verifiedAt > 5 * 60_000) invalid();
  return {
    schema_version: value.schema_version,
    verified: true,
    subject_fingerprint: value.subject_fingerprint,
    source_request_binding_digest: value.source_request_binding_digest,
    confirmation_reference_digest: value.confirmation_reference_digest,
    delegated_request_digest: value.delegated_request_digest,
    verified_at: new Date(verifiedAt).toISOString(),
  };
}

export function createMemoryEnvironmentDelegationNonceStore({ now = () => Date.now() } = {}) {
  const consumed = new Map();
  return Object.freeze({
    kind: "memory",
    distributed: false,
    restart_durable: false,
    schema_version: "environment_delegation_nonce_memory_v1",
    async initialize() {
      return Object.freeze({
        ready: true,
        schema_verified: false,
        distributed: false,
        restart_durable: false,
      });
    },
    async claim({ nonce, expires_at }) {
      const current = Math.floor(Number(now()) / 1_000);
      const expiry = Math.floor(Date.parse(String(expires_at || "")) / 1_000);
      if (!NONCE.test(String(nonce || "")) || !Number.isFinite(expiry) || expiry < current) return false;
      if (consumed.has(nonce)) return false;
      consumed.set(nonce, expiry);
      for (const [candidate, candidateExpiry] of consumed) {
        if (candidateExpiry < current) consumed.delete(candidate);
      }
      while (consumed.size > 5_000) consumed.delete(consumed.keys().next().value);
      return true;
    },
  });
}

const POSTGRES_NONCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS mcp_environment_delegation_nonces (
  nonce varchar(80) PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (nonce ~ '^[A-Za-z0-9_-]{16,80}$')
);
CREATE INDEX IF NOT EXISTS mcp_environment_delegation_nonces_expiry_idx
  ON mcp_environment_delegation_nonces (expires_at)`;

const POSTGRES_NONCE_SCHEMA_VERIFICATION = `
SELECT
  (SELECT array_agg(a.attname ORDER BY k.ordinality)
     FROM pg_index i
     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum,ordinality)
     JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
    WHERE i.indrelid='mcp_environment_delegation_nonces'::regclass AND i.indisprimary)
    = ARRAY['nonce']::name[] AS primary_key_verified,
  (SELECT array_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull ORDER BY a.attnum)
     FROM pg_attribute a
    WHERE a.attrelid='mcp_environment_delegation_nonces'::regclass
      AND a.attnum>0 AND NOT a.attisdropped)
    = ARRAY[
      'nonce:character varying(80):true',
      'expires_at:timestamp with time zone:true',
      'consumed_at:timestamp with time zone:true'
    ]::text[] AS columns_verified,
  EXISTS (SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_am am ON am.oid=c.relam
    WHERE i.indrelid='mcp_environment_delegation_nonces'::regclass
      AND c.relname='mcp_environment_delegation_nonces_expiry_idx'
      AND am.amname='btree' AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)
        = ARRAY['expires_at']::name[]) AS expiry_index_verified`;

export function createPostgresEnvironmentDelegationNonceStore({ pool } = {}) {
  if (!pool?.query) invalid();
  let initialization;
  const initialize = () => {
    initialization ||= Promise.resolve().then(async () => {
      await pool.query(POSTGRES_NONCE_SCHEMA);
      const verification = await pool.query(POSTGRES_NONCE_SCHEMA_VERIFICATION);
      const row = verification.rows?.[0];
      if (row?.primary_key_verified !== true || row?.columns_verified !== true ||
          row?.expiry_index_verified !== true) {
        const error = new Error("environment_delegation_nonce_schema_unverified");
        error.code = error.message;
        error.status = 503;
        throw error;
      }
      return Object.freeze({
        ready: true,
        schema_verified: true,
        distributed: true,
        restart_durable: true,
        schema_version: "environment_delegation_nonce_postgresql_v1",
      });
    }).catch((error) => {
      initialization = null;
      throw error;
    });
    return initialization;
  };
  return Object.freeze({
    kind: "postgresql",
    distributed: true,
    restart_durable: true,
    schema_version: "environment_delegation_nonce_postgresql_v1",
    initialize,
    async claim({ nonce, expires_at }) {
      if (!NONCE.test(String(nonce || "")) || !Number.isFinite(Date.parse(String(expires_at || "")))) {
        invalid();
      }
      try {
        await initialize();
        const result = await pool.query(`
          INSERT INTO mcp_environment_delegation_nonces (nonce,expires_at)
          SELECT $1,$2::timestamptz
          WHERE $2::timestamptz >= clock_timestamp()
          ON CONFLICT (nonce) DO NOTHING
          RETURNING nonce`, [nonce, expires_at]);
        return result.rowCount === 1;
      } catch (cause) {
        const error = new Error("environment_delegation_nonce_store_unavailable", { cause });
        error.code = error.message;
        error.status = 503;
        throw error;
      }
    },
  });
}

export function signEnvironmentDelegation({
  identity,
  toolName,
  exactTarget,
  args,
  requestId: id,
  transportSessionId,
  method = "tools/call",
  key,
  now = () => Date.now(),
}) {
  if (Buffer.byteLength(String(key || ""), "utf8") < 32) invalid();
  const currentMs = Number(now());
  if (!Number.isFinite(currentMs)) invalid();
  const current = Math.floor(currentMs / 1000);
  const request = {
    method,
    toolName,
    exactTarget: exactTarget || toolName,
    args: args || {},
    requestId: id,
    transportSessionId,
  };
  const requestDigest = environmentDelegationRequestDigest(request);
  const normalizedIdentity = delegatedIdentityV2(identity, currentMs);
  const payload = {
    v: ENVIRONMENT_DELEGATION_SCHEMA_VERSION,
    source: "production",
    target: "staging",
    tool: boundedText(toolName, 160),
    exact_target: boundedText(exactTarget || toolName, 160),
    request_digest: requestDigest,
    iat: current,
    exp: current + 30,
    nonce: crypto.randomBytes(18).toString("base64url"),
    identity: normalizedIdentity,
    owner_confirmation: ownerConfirmationClaim(identity, requestDigest),
  };
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${mac(payload, key)}`;
}

export async function verifyEnvironmentDelegation(token, {
  key,
  nonceStore,
  request,
  now = () => Date.now(),
} = {}) {
  if (Buffer.byteLength(String(key || ""), "utf8") < 32) invalid();
  if (!nonceStore || typeof nonceStore.claim !== "function") invalid();
  const [encoded, received, extra] = String(token || "").split(".");
  if (!encoded || !received || extra) invalid();
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { invalid(); }
  exactKeys(payload, new Set([
    "v", "source", "target", "tool", "exact_target", "request_digest",
    "iat", "exp", "nonce", "identity", "owner_confirmation",
  ]));
  const currentMs = Number(now());
  const current = Math.floor(currentMs / 1000);
  const expectedRequestDigest = environmentDelegationRequestDigest(request);
  if (!Number.isFinite(currentMs) || !equal(mac(payload, key), received) ||
      payload?.v !== ENVIRONMENT_DELEGATION_SCHEMA_VERSION ||
      payload.source !== "production" || payload.target !== "staging" ||
      !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp < current || payload.iat > current + 15 || payload.exp - payload.iat > 45 ||
      !NONCE.test(payload.nonce || "") || !payload.identity?.subject ||
      !payload.identity?.tenantId || !Array.isArray(payload.identity?.scopes) ||
      payload.tool !== requestBinding(request).tool ||
      payload.exact_target !== requestBinding(request).exact_target ||
      !SHA256.test(String(payload.request_digest || "")) ||
      payload.request_digest !== expectedRequestDigest) {
    invalid();
  }
  const normalizedIdentity = delegatedIdentityV2(payload.identity, currentMs);
  const ownerConfirmation = normalizedOwnerConfirmation(payload.owner_confirmation, {
    identity: normalizedIdentity,
    requestDigest: expectedRequestDigest,
    currentMs,
  });
  const claimed = await nonceStore.claim({
    nonce: payload.nonce,
    expires_at: new Date(payload.exp * 1_000).toISOString(),
  });
  if (claimed !== true) throw new Error("environment_delegation_replayed");
  return {
    identity: Object.freeze({
      ...normalizedIdentity,
      environmentDelegationBound: true,
      environmentDelegationVersion: ENVIRONMENT_DELEGATION_SCHEMA_VERSION,
      environmentDelegatedOwnerConfirmation: ownerConfirmation,
    }),
    toolName: boundedText(payload.tool, 160),
    exactTarget: boundedText(payload.exact_target, 160),
    requestDigest: expectedRequestDigest,
  };
}
