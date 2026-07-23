import crypto from "node:crypto";

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

// Confirmation references are process-wide capabilities, not per-tool
// capabilities. A reference can never be replayed through another
// authenticator, tool name or argument set.
const consumedOwnerConfirmations = new Map();

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
  const subjectAllowed = identity.kind === "codex" && config.godModeCodexEnabled === true;
  if (!enabled || !tenantMatch || !subjectAllowed) return identity;
  return {
    ...identity,
    role: "owner_root",
    godMode: true,
    scopes: [...new Set([...identity.scopes, ...config.supportedScopes, "owner:root"])],
    ...(identity.kind === "codex" ? { providerSetupOwner: true } : {}),
  };
}

function applyTenantProviderOwner(identity, config) {
  // OAuth identities are members by default. Owner capabilities are granted
  // only by the fresh, request-bound elevation below.
  if (identity.kind !== "oauth" || identity.oauthOwnerElevated === true) return identity;
  return { ...identity, role: identity.role || "member" };
}

function elevateOAuthOwner(identity, proof, config, consumed) {
  if (identity?.kind !== "oauth" || identity?.oauthOwnerBound !== true) throw new Error("owner_binding_required");
  if (proof?.confirmed !== true) throw new Error("owner_confirmation_required");
  const reference = String(proof?.confirmationReference || "").trim();
  const requestBinding = String(proof?.requestBinding || "").trim();
  if (!reference || reference.length > 240 || !requestBinding || requestBinding.length > 20_000) throw new Error("owner_confirmation_invalid");
  const authTime = Number(identity.authenticatedAt);
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Number(config.oauthOwnerConfirmationMaxAgeSeconds || 300);
  if (!Number.isFinite(authTime) || now - authTime > maxAge || authTime > now + 30) throw new Error("owner_authentication_stale");
  const bindingHash = crypto.createHash("sha256").update(requestBinding).digest("hex");
  if (consumed.has(reference)) throw new Error("owner_confirmation_replayed");
  consumed.set(reference, { consumed_at: now, binding_hash: bindingHash });
  while (consumed.size > 2_048) consumed.delete(consumed.keys().next().value);
  return { ...identity, role: "tenant_owner", providerSetupOwner: true, oauthOwnerElevated: true, ownerConfirmationReference: reference };
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
  // Consumer users do not need an Auth0 administrator to pre-provision a
  // tenant or role. When the feature is enabled, an unprivileged login is
  // assigned a stable personal tenant derived only from its verified subject.
  // Only the server-side owner binding may select the shared codexai tenant.
  const selfServiceTenant = !ownerTenantId && config.selfServiceTenantsEnabled === true;
  const tenantId = ownerTenantId || (selfServiceTenant
    ? `chatgpt_${crypto.createHash("sha256").update(`self-service-tenant\u0000${subject}`).digest("hex").slice(0, 32)}`
    : claimedTenantId);
  if (!tenantId) throw new Error("jwt_tenant_missing");
  return {
    kind: "oauth",
    subject,
    ...(payload.azp || payload.client_id ? { clientId: String(payload.azp || payload.client_id) } : {}),
    tenantId,
    role: "member",
    ...(selfServiceTenant ? { selfServiceTenant: true } : {}),
    ...(ownerTenantId ? { oauthOwnerBound: true } : {}),
    ...(tenantRole ? { tenantRole } : {}),
    ...(Number.isFinite(Number(payload.auth_time || payload.iat)) ? { authenticatedAt: Number(payload.auth_time || payload.iat) } : {}),
    scopes: tokenScopes(payload)
  };
}

export function createAuthenticator(config, options = {}) {
  const cache = options.jwksCache || new JwksCache(options.fetchImpl);
  const jwtConfig = options.audience ? { ...config, auth0Audience: options.audience } : config;
  const authenticate = async function authenticate(header) {
    const match = String(header || "").match(/^Bearer\s+(.+)$/i);
    if (!match) throw new Error("bearer_required");
    const token = match[1].trim();
    if (config.codexKeys.some((key) => safeEqual(key, token))) {
      return applyOwnerRoot({ kind: "codex", subject: "codex", tenantId: config.defaultTenantId, scopes: config.codexScopes }, config);
    }
    if (!config.auth0Issuer) throw new Error("bearer_invalid");
    return applyTenantProviderOwner(applyOwnerRoot(await verifyAuth0Jwt(token, jwtConfig, cache), config), config);
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
