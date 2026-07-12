function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function url(value, name) {
  if (!value) return "";
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}

export function loadConfig(env = process.env) {
  const publicUrl = url(env.MCP_PUBLIC_URL || "http://localhost:8790", "MCP_PUBLIC_URL");
  const auth0Issuer = url(env.AUTH0_ISSUER, "AUTH0_ISSUER");
  const auth0Audience = String(env.AUTH0_AUDIENCE || "").trim();
  const codexKeys = csv(env.CODEX_BEARER_KEYS);
  if (env.NODE_ENV === "production" && !auth0Issuer && !codexKeys.length) {
    throw new Error("At least one authentication method is required in production");
  }
  if (auth0Issuer && !auth0Audience) throw new Error("AUTH0_AUDIENCE is required with AUTH0_ISSUER");
  return {
    port: Number(env.PORT || 8790),
    publicUrl,
    resource: `${publicUrl}/mcp`,
    auth0Issuer,
    auth0Audience,
    jwksUri: auth0Issuer ? `${auth0Issuer}/.well-known/jwks.json` : "",
    codexKeys,
    codexScopes: csv(env.CODEX_BEARER_SCOPES || "core:read,core:govern"),
    supportedScopes: csv(env.MCP_SUPPORTED_SCOPES || "core:read,core:govern")
  };
}
