import crypto from "node:crypto";
import {
  attachAuthenticatedHostPrincipal,
  registeredBearerApp,
} from "./host-app-registry.js";

function b64json(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function scopes(value) {
  if (Array.isArray(value)) return value.map(String);
  return String(value || "").split(/\s+/).filter(Boolean);
}

function tokenScopes(payload) {
  return [...new Set([
    ...scopes(payload.scope),
    ...scopes(payload.permissions),
  ])];
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function applyOwnerRoot(identity, config) {
  const enabled = config.godModeEnabled === true && config.godModeEmergencyStop !== true;
  const tenantMatch = (config.godModeTenantIds || [config.godModeTenantId].filter(Boolean)).includes(identity.tenantId);
  const subjectAllowed = identity.kind === "codex"
    ? config.godModeCodexEnabled === true
    // A client/application ID identifies an OAuth application, not a human
    // owner. It must never elevate every user of that application. OAuth
    // owner-root therefore requires the authenticated subject to be allowlisted
    // explicitly; an empty subject allowlist fails closed.
    : identity.oauthOwnerBound === true && (config.godModeSubjects || []).includes(identity.subject);
  if (!enabled || !tenantMatch || !subjectAllowed) return identity;
  const registeredApp = identity.authenticatedHostPrincipal?.registered === true;
  return {
    ...identity,
    role: "owner_root",
    godMode: true,
    // Good Mode can establish the tenant owner role, but a registered app's
    // configured scopes remain an immutable upper bound. Legacy Codex keeps
    // the historical scope expansion only until it is moved into the app
    // registry.
    scopes: [...new Set([
      ...identity.scopes,
      ...(!registeredApp ? config.supportedScopes : []),
      "owner:root",
    ])],
  };
}

// Good Mode is a tenant-bound host policy, not a caller-supplied boolean. This
// helper deliberately rechecks the deployment configuration wherever an MCP
// handler needs to mint the initial host-native delegation. It applies only to
// the configured Codex bearer identity; OAuth owners still use their fresh,
// request-bound elevation flow.
export function isCodexGoodModeDelegation(identity, config = {}) {
  const tenantIds = config.godModeTenantIds || [config.godModeTenantId].filter(Boolean);
  return (
    identity?.kind === "codex" &&
    identity?.godMode === true &&
    identity?.role === "owner_root" &&
    String(identity?.subject || "") === "codex" &&
    config.godModeEnabled === true &&
    config.godModeEmergencyStop !== true &&
    config.godModeCodexEnabled === true &&
    tenantIds.includes(identity.tenantId)
  );
}

function applyTenantMemberRole(identity, config) {
  // OAuth identities are members by default. Owner capabilities are granted
  // only by the fresh, request-bound elevation below.
  if (identity.kind !== "oauth" || identity.oauthOwnerElevated === true) return identity;
  return { ...identity, role: identity.role || "member" };
}

function isoFromEpoch(seconds) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function canonicalWorkRole(role) {
  if (role === "team_manager") return "team_manager";
  if (role === "tenant_owner" || role === "super_admin") return role;
  return "member";
}

function attachAuthenticatedTenantMembership(identity, { role, teamIds = [], managedTeamIds = [], issuedAt, expiresAt }) {
  if (!identity?.tenantId || !identity?.subject || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new Error("authenticated_tenant_membership_invalid");
  }
  return {
    ...identity,
    authenticatedTenantMembership: Object.freeze({
      schema_version: "tenant_membership_binding_v1",
      authenticated: true,
      tenant_id: identity.tenantId,
      subject: identity.subject,
      role: canonicalWorkRole(role),
      team_ids: [...new Set(teamIds)],
      managed_team_ids: [...new Set(managedTeamIds)],
      assigned_work_ids: [],
      issued_at: isoFromEpoch(issuedAt),
      expires_at: isoFromEpoch(expiresAt),
    }),
  };
}

function attachCodexTenantMembership(identity, config) {
  // A static bearer becomes a Work owner only after the existing, server-side
  // Good Mode policy has verified its configured key, tenant and emergency stop.
  if (!isCodexGoodModeDelegation(identity, config)) return identity;
  const issuedAt = Math.floor(Date.now() / 1_000);
  const ttl = Number(config.codexTenantMembershipTtlSeconds || 300);
  return attachAuthenticatedTenantMembership(identity, {
    role: "tenant_owner", issuedAt, expiresAt: issuedAt + ttl,
  });
}

function elevateOAuthOwner(identity, proof, config, consumed) {
  if (identity?.kind !== "oauth" || identity?.oauthOwnerBound !== true) throw new Error("owner_binding_required");
  if (proof?.confirmed !== true) throw new Error("owner_confirmation_required");
  const reference = String(proof?.confirmationReference || "").trim();
  const requestBinding = String(proof?.requestBinding || "").trim();
  if (!reference || reference.length > 240 || !requestBinding || requestBinding.length > 20_000) throw new Error("owner_confirmation_invalid");
  // `auth_time` is the time of the original interactive login and remains
  // unchanged when an OAuth client legitimately refreshes its access token.
  // ChatGPT connectors therefore cannot satisfy a short owner-confirmation
  // window if freshness is measured from `auth_time`. Measure freshness from
  // the currently verified access token's `iat` instead. The confirmation is
  // still subject-bound, request-bound and single-use below.
  const authTime = Number(identity.tokenIssuedAt);
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Number(config.oauthOwnerConfirmationMaxAgeSeconds || 300);
  if (!Number.isFinite(authTime) || now - authTime > maxAge || authTime > now + 30) throw new Error("owner_authentication_stale");
  const key = `${identity.subject}\u0000${reference}\u0000${crypto.createHash("sha256").update(requestBinding).digest("hex")}`;
  if (consumed.has(key)) throw new Error("owner_confirmation_replayed");
  consumed.set(key, now);
  while (consumed.size > 2_048) consumed.delete(consumed.keys().next().value);
  const role = identity.godMode === true && identity.role === "owner_root"
    ? "owner_root"
    : "tenant_owner";
  return {
    ...identity,
    role,
    oauthOwnerElevated: true,
    ownerConfirmationReference: reference,
    // A production gateway may delegate this already-verified confirmation
    // to the exact signed staging request. Carry only digests/timestamps; the
    // receiver must never re-consume or reinterpret the browser assertion.
    ownerConfirmationBindingDigest: crypto.createHash("sha256")
      .update(requestBinding)
      .digest("hex"),
    ownerConfirmationVerifiedAt: new Date(now * 1_000).toISOString(),
  };
}

export class JwksCache {
  constructor(fetchImpl = fetch, ttlMs = 300_000) {
    this.fetch = fetchImpl;
    this.ttlMs = ttlMs;
    this.expires = 0;
    this.keys = [];
  }

  async get(uri, kid) {
    if (Date.now() >= this.expires || !this.keys.some((key) => key.kid === kid)) {
      const response = await this.fetch(uri, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("jwks_unavailable");
      const body = await response.json();
      if (!Array.isArray(body.keys)) throw new Error("jwks_invalid");
      this.keys = body.keys;
      this.expires = Date.now() + this.ttlMs;
    }
    const key = this.keys.find((candidate) => candidate.kid === kid && candidate.kty === "RSA");
    if (!key) throw new Error("jwt_key_not_found");
    return key;
  }
}

export async function verifyAuth0Jwt(token, config, cache = new JwksCache()) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("jwt_malformed");
  const header = b64json(parts[0]);
  const payload = b64json(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("jwt_algorithm_rejected");
  const jwk = await cache.get(config.jwksUri, header.kid);
  const valid = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!valid) throw new Error("jwt_signature_invalid");
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `${config.auth0Issuer}/`) throw new Error("jwt_issuer_invalid");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.auth0Audience)) throw new Error("jwt_audience_invalid");
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error("jwt_expired");
  if (payload.nbf && payload.nbf > now + 30) throw new Error("jwt_not_active");
  const subject = String(payload.sub || "").trim();
  if (!subject) throw new Error("jwt_subject_missing");
  const claimedTenantId = String(payload[config.tenantClaim] || "").trim();
  const tenantRole = String(payload[config.tenantOwnerRoleClaim] || "").trim();
  const ownerTenantId = config.oauthOwnerTenantBindings?.[subject] || "";
  // A membership is a collaboration grant, not an ownership grant. If a
  // subject is deliberately present in both maps, the owner binding remains
  // authoritative and the bounded membership role is ignored.
  const membership = ownerTenantId ? undefined : config.oauthTenantMemberships?.[subject];
  const memberTenantId = String(membership?.tenantId || "").trim();
  const membershipRole = String(membership?.role || "").trim();
  const supportDelegation = membershipRole === "support_delegate";
  const supportDelegationExpiresAt = String(membership?.expiresAt || "").trim();
  const supportDelegationExpiry = Date.parse(supportDelegationExpiresAt);
  if (!supportDelegation && membership?.expiresAt && (!Number.isFinite(supportDelegationExpiry) || supportDelegationExpiry <= Date.now())) {
    throw new Error("tenant_membership_expired");
  }
  if (supportDelegation && (
    !Number.isFinite(supportDelegationExpiry)
    || supportDelegationExpiry <= Date.now()
  )) {
    throw new Error("tenant_support_delegation_expired");
  }
  // Consumer users do not need an Auth0 administrator to pre-provision a
  // tenant or role. When the feature is enabled, an unprivileged login is
  // assigned a stable personal tenant derived only from its verified subject.
  // Only server-side owner or membership bindings may select a shared tenant.
  const selfServiceTenant = !ownerTenantId && !memberTenantId && config.selfServiceTenantsEnabled === true;
  const tenantId = ownerTenantId || memberTenantId || (selfServiceTenant
    ? `chatgpt_${crypto.createHash("sha256").update(`self-service-tenant\u0000${subject}`).digest("hex").slice(0, 32)}`
    : claimedTenantId);
  if (!tenantId) throw new Error("jwt_tenant_missing");
  const identity = {
    kind: "oauth",
    subject,
    ...(payload.azp || payload.client_id ? { clientId: String(payload.azp || payload.client_id) } : {}),
    tenantId,
    role: membershipRole || "member",
    ...(selfServiceTenant ? { selfServiceTenant: true } : {}),
    ...(ownerTenantId ? { oauthOwnerBound: true } : {}),
    ...(memberTenantId ? { oauthTenantMemberBound: true, tenantMembershipRole: membershipRole } : {}),
    ...(supportDelegation ? {
      tenantSupportDelegationBound: true,
      tenantSupportDelegationId: String(membership.delegationId),
      tenantSupportDelegationExpiresAt: supportDelegationExpiresAt,
    } : {}),
    ...(tenantRole ? { tenantRole } : {}),
    ...(Number.isFinite(Number(payload.auth_time || payload.iat)) ? { authenticatedAt: Number(payload.auth_time || payload.iat) } : {}),
    ...(Number.isFinite(Number(payload.iat)) ? { tokenIssuedAt: Number(payload.iat) } : {}),
    scopes: tokenScopes(payload),
  };
  // V2 receives only an envelope derived here, after JWT verification and
  // server-side owner/membership resolution. A tenant claim alone grants none.
  if (!ownerTenantId && !memberTenantId && !selfServiceTenant) return identity;
  const issuedAt = Number.isFinite(Number(payload.iat)) ? Number(payload.iat) : now;
  const tokenExpiry = Number(payload.exp);
  const configuredExpiry = membership?.expiresAt ? Math.floor(Date.parse(membership.expiresAt) / 1_000) : tokenExpiry;
  const expiresAt = Math.min(tokenExpiry, configuredExpiry);
  return attachAuthenticatedTenantMembership(identity, {
    role: ownerTenantId ? "tenant_owner" : (membershipRole || "member"),
    teamIds: membership?.teamIds || [], managedTeamIds: membership?.managedTeamIds || [],
    issuedAt, expiresAt,
  });
}

export function createAuthenticator(config, options = {}) {
  const cache = options.jwksCache || new JwksCache(options.fetchImpl);
  const consumedOwnerConfirmations = new Map();
  const jwtConfig = options.audience ? { ...config, auth0Audience: options.audience } : config;
  const authenticate = async function authenticate(header) {
    const match = String(header || "").match(/^Bearer\s+(.+)$/i);
    if (!match) throw new Error("bearer_required");
    const token = match[1].trim();
    const registeredBearer = registeredBearerApp(token, config.hostAppRegistry);
    if (registeredBearer) {
      const issuedAt = Math.floor(Date.now() / 1_000);
      const ttl = Number(config.serviceTenantMembershipTtlSeconds || 300);
      const app = registeredBearer.app;
      if (app.app_id === "codex" && app.client_type === "codex" &&
          app.host_kind === "codex_native") {
        const memberCodex = attachAuthenticatedTenantMembership({
          kind: "codex",
          subject: "codex",
          tenantId: app.tenant_id,
          role: app.service_role,
          registeredServiceMemberBound: true,
          tenantMembershipRole: app.service_role,
          scopes: [...app.scopes],
          authenticatedHostPrincipal: registeredBearer.principal,
        }, {
          role: "member",
          issuedAt,
          expiresAt: issuedAt + ttl,
        });
        return attachCodexTenantMembership(applyOwnerRoot(memberCodex, config), config);
      }
      const serviceIdentity = attachAuthenticatedTenantMembership({
        kind: "service",
        subject: `app:${app.app_id}`,
        tenantId: app.tenant_id,
        role: app.service_role,
        registeredServiceMemberBound: true,
        tenantMembershipRole: app.service_role,
        scopes: [...app.scopes],
        authenticatedHostPrincipal: registeredBearer.principal,
      }, {
        role: "member",
        issuedAt,
        expiresAt: issuedAt + ttl,
      });
      return serviceIdentity;
    }
    if (config.codexKeys.some((key) => safeEqual(key, token))) {
      return attachAuthenticatedHostPrincipal(
        attachCodexTenantMembership(applyOwnerRoot({ kind: "codex", subject: "codex", tenantId: config.defaultTenantId, scopes: config.codexScopes }, config), config),
        config.hostAppRegistry,
        { allowLegacyCodex: config.legacyCodexHostPrincipalEnabled !== false },
      );
    }
    if (!config.auth0Issuer) throw new Error("bearer_invalid");
    return attachAuthenticatedHostPrincipal(
      applyTenantMemberRole(applyOwnerRoot(await verifyAuth0Jwt(token, jwtConfig, cache), config), config),
      config.hostAppRegistry,
    );
  };
  authenticate.elevateOAuthOwner = (identity, proof) => elevateOAuthOwner(identity, proof, config, consumedOwnerConfirmations);
  return authenticate;
}

export function ownerRequestBinding(toolName, args = {}) {
  const payload = { ...args };
  delete payload.owner_confirmed;
  delete payload.confirmation_reference;
  return `${String(toolName || "")}\u0000${JSON.stringify(stableCanonical(payload))}`;
}

export function requireScopes(identity, required) {
  const missing = required.filter((scope) => !identity.scopes.includes(scope));
  if (missing.length) {
    const error = new Error("insufficient_scope");
    error.missing = missing;
    throw error;
  }
}
