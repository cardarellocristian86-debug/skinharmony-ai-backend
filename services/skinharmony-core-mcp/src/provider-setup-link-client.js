export const OPENAI_PROVIDER_SETUP_LINK_PATH = "/v1/generic-agents/providers/openai/setup-links";

function providerSetupLinkFailure(status, payload) {
  if (status === 401) return "provider_setup_link_authentication_failed";
  if (status === 403) {
    if (payload?.error === "scope_denied") return "provider_setup_link_scope_required";
    if (payload?.error === "owner_context_required") return "provider_setup_link_owner_required";
    if (payload?.error === "provider_setup_link_issuer_required") return "provider_setup_link_issuer_required";
    return "provider_setup_link_access_denied";
  }
  if (status === 404) return "provider_setup_link_route_unavailable";
  return "provider_setup_link_unavailable";
}

export function providerSetupLinkKey(config, tenantId) {
  // This is intentionally a separate, opt-in binding. It must never fall back
  // to the normal Core key: that key has a different responsibility and scope.
  const serviceKey = String(config.providerSetupLinkServiceKey || "").trim();
  if (serviceKey) return serviceKey;
  const keys = config.universalCoreProviderSetupLinkKeys || {};
  const key = Object.prototype.hasOwnProperty.call(keys, tenantId)
    ? String(keys[tenantId] || "").trim()
    : "";
  if (!key) throw new Error("provider_setup_link_key_missing");
  return key;
}

export function validateOpenAiProviderSetupLink(payload, config, expectedTenantId) {
  const setupUrl = String(payload?.setup_url || "");
  const setupProof = String(payload?.setup_proof || "");
  const linkId = String(payload?.link_id || "");
  const tenantId = String(payload?.tenant_id || "").trim();
  const expectedTenant = String(expectedTenantId || "").trim();
  if (!expectedTenant || tenantId !== expectedTenant) {
    throw new Error("provider_setup_link_tenant_mismatch");
  }
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(setupProof) || !/^psl_[A-Za-z0-9_-]{16,120}$/.test(linkId)) {
    throw new Error("provider_setup_link_invalid_response");
  }
  let received;
  let expected;
  try {
    received = new URL(setupUrl);
    expected = new URL(config.universalCoreUrl);
  } catch {
    throw new Error("provider_setup_link_invalid_response");
  }
  if (
    received.protocol !== "https:" ||
    expected.protocol !== "https:" ||
    received.origin !== expected.origin ||
    !/^\/v1\/generic-agents\/providers\/openai\/setup\/[A-Za-z0-9_-]{30,120}$/.test(received.pathname) ||
    received.search ||
    received.hash ||
    received.username ||
    received.password
  ) {
    throw new Error("provider_setup_link_invalid_response");
  }
  return {
    ok: payload?.ok === true,
    tenant_id: tenantId,
    setup_url: received.toString(),
    setup_proof: setupProof,
    link_id: linkId,
    expires_at: String(payload?.expires_at || ""),
    execution_enabled: false,
  };
}

export async function issueOpenAiProviderSetupLink({ config, tenantId, ttlMinutes, ownerContext, fetchImpl = fetch }) {
  if (!ownerContext || typeof ownerContext !== "object" || Array.isArray(ownerContext)) {
    throw new Error("provider_setup_link_owner_context_unavailable");
  }
  const expectedTenant = String(tenantId || "").trim();
  if (!expectedTenant || String(ownerContext.tenant_id || "").trim() !== expectedTenant) {
    throw new Error("provider_setup_link_tenant_mismatch");
  }
  // The tenant is derived by the MCP from the verified identity, never from
  // tool input. Core checks that it also matches the restricted bootstrap key
  // and fresh OAuth owner assertion.
  const body = {
    tenant_id: tenantId,
    owner_context: ownerContext,
    ...(ttlMinutes === undefined ? {} : { ttl_minutes: ttlMinutes }),
  };
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
  return validateOpenAiProviderSetupLink(payload, config, expectedTenant);
}
