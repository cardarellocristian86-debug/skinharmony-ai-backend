export const CAPABILITY_EXPOSURE_CONTRACT_VERSION = "capability_exposure_contract_v1";

const HORIZONTAL_CLIENTS = Object.freeze([
  "chatgpt",
  "codex",
  "api_agent",
  "smartdesk",
  "analyzer",
  "tricocamera",
  "suite",
  "waas",
  "admin",
]);
const HORIZONTAL_AUDIENCES = Object.freeze([
  "chatgpt_connector",
  "codex_internal",
  "api_agent",
  "smartdesk_runtime",
  "analyzer_runtime",
  "suite_runtime",
  "admin_control_room",
]);

function serverClientType(identity = {}) {
  if (identity.kind === "oauth") return "chatgpt";
  if (identity.kind === "codex") return "codex";
  const trusted = String(identity.serverClientType || "");
  return [
    "api_agent",
    "smartdesk",
    "analyzer",
    "tricocamera",
    "suite",
    "waas",
    "admin",
  ].includes(trusted) ? trusted : "api_agent";
}

function serverAudience(clientType) {
  if (clientType === "chatgpt") return "chatgpt_connector";
  if (clientType === "codex") return "codex_internal";
  if (clientType === "smartdesk") return "smartdesk_runtime";
  if (clientType === "analyzer" || clientType === "tricocamera") return "analyzer_runtime";
  if (clientType === "suite" || clientType === "waas") return "suite_runtime";
  if (clientType === "admin") return "admin_control_room";
  return "api_agent";
}

export function capabilityAccessContext(identity = {}) {
  const clientType = serverClientType(identity);
  return Object.freeze({
    tenant_id: String(identity.tenantId || ""),
    client_type: clientType,
    audience: serverAudience(clientType),
    entitlements: Object.freeze([...new Set((identity.scopes || []).map(String))]),
    role: String(identity.role || "member"),
    source: "authenticated_mcp_identity",
  });
}

function profile(tool) {
  const name = String(tool?.name || "");
  const requiredEntitlements = [...new Set((tool?.scopes || []).map(String))];
  if (name.startsWith("suite_")) {
    return {
      exposure_class: "software_adjacent",
      allowed_client_types: ["suite", "waas", "admin"],
      allowed_audiences: ["suite_runtime", "admin_control_room"],
      required_entitlements: requiredEntitlements,
      discoverable_in_connector: true,
      semantic_select_allowed: true,
    };
  }
  if (name.startsWith("skin_") || name.startsWith("scalp_")) {
    return {
      exposure_class: "software_adjacent",
      allowed_client_types: ["analyzer", "tricocamera", "admin"],
      allowed_audiences: ["analyzer_runtime", "admin_control_room"],
      required_entitlements: requiredEntitlements,
      discoverable_in_connector: true,
      semantic_select_allowed: true,
    };
  }
  return {
    exposure_class: "chatgpt_horizontal",
    allowed_client_types: [...HORIZONTAL_CLIENTS],
    allowed_audiences: [...HORIZONTAL_AUDIENCES],
    required_entitlements: requiredEntitlements,
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  };
}

export function capabilityExposureProfile(tool) {
  return Object.freeze(profile(tool));
}

export function capabilityAvailableForIdentity(tool, identity, { semantic = false } = {}) {
  const access = capabilityAccessContext(identity);
  const exposure = profile(tool);
  if (!exposure.allowed_client_types.includes(access.client_type)) return false;
  if (!exposure.allowed_audiences.includes(access.audience)) return false;
  if (access.client_type === "chatgpt" && exposure.exposure_class !== "chatgpt_horizontal") {
    return false;
  }
  if (semantic && exposure.semantic_select_allowed !== true) return false;
  if (!semantic && exposure.discoverable_in_connector !== true) return false;
  if (access.client_type === "admin" && access.audience === "admin_control_room") return true;
  const entitlements = new Set(access.entitlements);
  return exposure.required_entitlements.every((entitlement) => entitlements.has(entitlement));
}

export function candidateLooksVertical(candidate) {
  const values = [
    candidate?.id,
    candidate?.capability_id,
    candidate?.branch_id,
    candidate?.branch,
    candidate?.group,
    candidate?.metadata?.branch_id,
    candidate?.semantic_context?.branch_id,
  ].map((value) => String(value || "").toLowerCase());
  return values.some((value) =>
    /^(suite|skin|scalp|smartdesk|beauty|analyzer|tricocamera|waas)_/.test(value),
  );
}
