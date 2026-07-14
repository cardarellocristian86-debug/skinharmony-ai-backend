import crypto from "node:crypto";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const CLIENT_TYPES = new Set(["chatgpt", "codex", "api_agent", "other"]);
const SIGNATURE_VERSION = "v1";

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

function signingKey(config, identity) {
  const configured = String(
    config.agentSignatureSecret ||
    config.universalCoreKeys?.[identity.tenantId] ||
    config.universalCoreKey ||
    "",
  ).trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") fail("agent_signature_key_unavailable");
  return "skinharmony-development-agent-presence-key";
}

function digest(key, domain, value, length) {
  return crypto.createHmac("sha256", key).update(`${domain}\u0000${value}`).digest("hex").slice(0, length);
}

export function createAgentPresence(config, identity, input = {}) {
  const agentId = safeId(input.agent_id, "agent");
  const clientType = String(input.client_type || "").trim().toLowerCase();
  if (!CLIENT_TYPES.has(clientType)) fail("client_type_invalid");
  const sessionId = safeId(input.session_id, "session");
  const tenantId = safeId(identity?.tenantId, "tenant");
  const key = signingKey(config, identity);
  const sessionFingerprint = digest(key, "session", JSON.stringify([SIGNATURE_VERSION, tenantId, actor(identity), sessionId]), 24);
  const canonical = JSON.stringify({
    version: SIGNATURE_VERSION,
    environment: process.env.NODE_ENV || "development",
    tenant_id: tenantId,
    actor_subject: actor(identity),
    agent_id: agentId,
    client_type: clientType,
    session_fingerprint: sessionFingerprint,
  });
  const signature = `ags_${digest(key, "presence", canonical, 32)}`;
  const opaqueAgentId = `ai_${digest(key, "lifecycle", canonical, 24)}`;
  return {
    agent_id: agentId,
    opaque_agent_id: opaqueAgentId,
    client_type: clientType,
    session_fingerprint: sessionFingerprint,
    signature,
    signature_version: SIGNATURE_VERSION,
  };
}

export function sameAgentPresence(left, right) {
  return Boolean(left?.signature && right?.signature && left.signature === right.signature);
}

export { CLIENT_TYPES, SIGNATURE_VERSION };
