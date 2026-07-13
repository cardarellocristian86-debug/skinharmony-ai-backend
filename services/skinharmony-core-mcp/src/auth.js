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
  const tenantId = String(payload[config.tenantClaim] || "").trim();
  if (!tenantId) throw new Error("jwt_tenant_missing");
  return { kind: "oauth", subject: String(payload.sub || ""), tenantId, scopes: tokenScopes(payload) };
}

export function createAuthenticator(config, options = {}) {
  const cache = options.jwksCache || new JwksCache(options.fetchImpl);
  return async function authenticate(header) {
    const match = String(header || "").match(/^Bearer\s+(.+)$/i);
    if (!match) throw new Error("bearer_required");
    const token = match[1].trim();
    if (config.codexKeys.some((key) => safeEqual(key, token))) {
      return { kind: "codex", subject: "codex", tenantId: config.defaultTenantId, scopes: config.codexScopes };
    }
    if (!config.auth0Issuer) throw new Error("bearer_invalid");
    return verifyAuth0Jwt(token, config, cache);
  };
}

export function requireScopes(identity, required) {
  const missing = required.filter((scope) => !identity.scopes.includes(scope));
  if (missing.length) {
    const error = new Error("insufficient_scope");
    error.missing = missing;
    throw error;
  }
}
