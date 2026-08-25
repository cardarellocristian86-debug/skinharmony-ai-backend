import crypto from "node:crypto";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const CLIENT_TYPES = new Set(["chatgpt", "codex", "api_agent", "other"]);
const SIGNATURE_VERSION = "v2";
const SIGNATURE_VERSIONS = new Set(["v1", "v2"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function safeId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) fail(`${name}_invalid`);
  return id;
}

function actor(identity) {
  return String(identity?.subject || identity?.kind || "unknown").slice(0, 200);
}

function sameConfiguredSecret(left, right) {
  const leftBuffer = Buffer.from(String(left || "").trim(), "utf8");
  const rightBuffer = Buffer.from(String(right || "").trim(), "utf8");
  return (
    leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function signingKey(config) {
  const configured = String(config.agentSignatureSecret || "").trim();
  const reused = Boolean(
    configured &&
    (
      config.agentSignatureSecretReused === true ||
      [
        config.universalCoreKey,
        ...Object.values(config.universalCoreKeys || {}),
        config.tenantGatewayKey,
        config.ownerContextSigningSecret,
        config.tenantContextSigningSecret,
        config.dttAgentIdentitySigningSecret,
        config.nyraDeepV2McpRequestSigningSecret,
        ...(Array.isArray(config.codexKeys) ? config.codexKeys : []),
      ].some((secret) => sameConfiguredSecret(configured, secret))
    )
  );
  if (reused) fail("agent_signature_key_reused");
  if (Buffer.byteLength(configured, "utf8") >= 32) return configured;
  const environment = String(
    config.environment ||
    (config.production === true ? "production" : process.env.NODE_ENV) ||
    "development",
  ).trim().toLowerCase();
  if (environment === "production") fail("agent_signature_key_unavailable");
  return "skinharmony-development-agent-presence-key";
}

function digest(key, domain, value, length) {
  return crypto.createHmac("sha256", key).update(`${domain}\u0000${value}`).digest("hex").slice(0, length);
}

export function createAgentPresence(config, identity, input = {}) {
  const agentId = safeId(input.agent_id, "agent");
  const clientType = String(input.client_type || "").trim().toLowerCase();
  if (!CLIENT_TYPES.has(clientType)) fail("client_type_invalid");
  const principal = identity?.authenticatedHostPrincipal;
  const principalClientType = String(principal?.client_type || "").trim().toLowerCase();
  if (principalClientType && principalClientType !== clientType) {
    fail("client_type_principal_mismatch");
  }
  const sessionId = safeId(input.session_id, "session");
  const tenantId = safeId(identity?.tenantId, "tenant");
  const key = signingKey(config);
  const signatureVersion = String(
    config.agentPresenceSignatureVersion || SIGNATURE_VERSION,
  ).trim().toLowerCase();
  if (!SIGNATURE_VERSIONS.has(signatureVersion)) fail("agent_signature_version_invalid");
  const v2 = signatureVersion === "v2";
  const sessionFingerprint = digest(key, "session", JSON.stringify(v2
    ? [
        signatureVersion,
        tenantId,
        actor(identity),
        principal?.app_id || null,
        principal?.host_kind || null,
        sessionId,
      ]
    : [signatureVersion, tenantId, actor(identity), sessionId]), 24);
  const canonical = JSON.stringify({
    version: signatureVersion,
    environment: process.env.NODE_ENV || "development",
    tenant_id: tenantId,
    actor_subject: actor(identity),
    ...(v2 ? {
      host_app_id: principal?.app_id || null,
      host_kind: principal?.host_kind || null,
      host_registry_revision: principal?.registry_revision || null,
    } : {}),
    agent_id: agentId,
    client_type: clientType,
    session_fingerprint: sessionFingerprint,
  });
  const signature = `ags_${digest(key, "presence", canonical, 32)}`;
  const opaqueAgentId = `ai_${digest(key, "lifecycle", canonical, 24)}`;
  const actorProvenance = `ap_${digest(key, "actor-provenance", JSON.stringify([tenantId, actor(identity)]), 32)}`;
  return {
    agent_id: agentId,
    opaque_agent_id: opaqueAgentId,
    actor_provenance: actorProvenance,
    host_app_id: principal?.app_id || null,
    host_kind: principal?.host_kind || null,
    host_registry_revision: principal?.registry_revision || null,
    host_registered: principal?.registered === true,
    client_type: clientType,
    session_fingerprint: sessionFingerprint,
    signature,
    signature_version: signatureVersion,
    session_binding_version: signatureVersion,
  };
}

export function sameAgentPresence(left, right) {
  return Boolean(left?.signature && right?.signature && left.signature === right.signature);
}

export { CLIENT_TYPES, SIGNATURE_VERSION };
