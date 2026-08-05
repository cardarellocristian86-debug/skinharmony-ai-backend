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

function delegatedIdentity(identity) {
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
  };
}

export function signEnvironmentDelegation({ identity, toolName, key }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 1, source: "production", target: "staging", tool: String(toolName), iat: now, exp: now + 30, nonce: crypto.randomBytes(18).toString("base64url"), identity: delegatedIdentity(identity) };
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${mac(payload, key)}`;
}

export function verifyEnvironmentDelegation(token, { key, consumed = new Map() } = {}) {
  const [encoded, received, extra] = String(token || "").split(".");
  if (!encoded || !received || extra) throw new Error("environment_delegation_invalid");
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new Error("environment_delegation_invalid"); }
  const now = Math.floor(Date.now() / 1000);
  if (!equal(mac(payload, key), received) || payload?.v !== 1 || payload.source !== "production" || payload.target !== "staging" ||
      !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp < now || payload.iat > now + 15 || payload.exp - payload.iat > 45 ||
      !/^[A-Za-z0-9_-]{16,80}$/.test(payload.nonce || "") || !payload.identity?.subject || !payload.identity?.tenantId || !Array.isArray(payload.identity?.scopes) || !payload.tool) {
    throw new Error("environment_delegation_invalid");
  }
  if (consumed.has(payload.nonce)) throw new Error("environment_delegation_replayed");
  consumed.set(payload.nonce, payload.exp);
  for (const [nonce, expiry] of consumed) if (expiry < now) consumed.delete(nonce);
  while (consumed.size > 5_000) consumed.delete(consumed.keys().next().value);
  return { identity: delegatedIdentity(payload.identity), toolName: payload.tool };
}
