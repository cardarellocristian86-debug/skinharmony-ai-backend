export const OPENAI_PROVIDER_SETUP_LINK_PATH = "/v1/generic-agents/providers/openai/setup-links";

function providerSetupLinkFailure(status, payload) {
  if (status === 401) return "provider_setup_link_authentication_failed";
  if (status === 403) {
    return payload?.error === "scope_denied"
      ? "provider_setup_link_scope_required"
      : "provider_setup_link_access_denied";
  }
  if (status === 404) return "provider_setup_link_route_unavailable";
  return "provider_setup_link_unavailable";
}

export function providerSetupLinkKey(config, tenantId) {
  // This is intentionally a separate, opt-in binding. It must never fall back
  // to the normal Core key: that key has a different responsibility and scope.
  const keys = config.universalCoreProviderSetupLinkKeys || {};
  const key = Object.prototype.hasOwnProperty.call(keys, tenantId)
    ? String(keys[tenantId] || "").trim()
    : "";
  if (!key) throw new Error("provider_setup_link_key_missing");
  return key;
}

export async function issueOpenAiProviderSetupLink({ config, tenantId, ttlMinutes, fetchImpl = fetch }) {
  // The tenant is derived by the MCP from the verified identity, never from
  // tool input. Core checks that it also matches the restricted bearer key.
  const body = { tenant_id: tenantId, ...(ttlMinutes === undefined ? {} : { ttl_minutes: ttlMinutes }) };
  const key = providerSetupLinkKey(config, tenantId);
  let response;
  try {
    response = await fetchImpl(`${config.universalCoreUrl}${OPENAI_PROVIDER_SETUP_LINK_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("provider_setup_link_unavailable");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(providerSetupLinkFailure(response.status, payload));
  if (!payload || typeof payload.setup_url !== "string" || !payload.setup_url) {
    throw new Error("provider_setup_link_invalid_response");
  }
  return payload;
}
