import crypto from "node:crypto";

import { hasScope, SCOPES } from "./scope.js";

export const BRANCH_EXPOSURE_CONTRACT_VERSION = "branch_exposure_contract_v1";

export const EXPOSURE_CLASSES = Object.freeze([
  "chatgpt_horizontal",
  "codex_internal",
  "software_adjacent",
  "admin_only",
  "test_only",
]);

export const CLIENT_TYPES = Object.freeze([
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

export const CLIENT_AUDIENCES = Object.freeze([
  "chatgpt_connector",
  "codex_internal",
  "api_agent",
  "smartdesk_runtime",
  "analyzer_runtime",
  "suite_runtime",
  "admin_control_room",
]);

export const CANONICAL_CLIENT_AUDIENCE = Object.freeze({
  chatgpt: "chatgpt_connector",
  codex: "codex_internal",
  api_agent: "api_agent",
  smartdesk: "smartdesk_runtime",
  analyzer: "analyzer_runtime",
  tricocamera: "analyzer_runtime",
  suite: "suite_runtime",
  waas: "suite_runtime",
  admin: "admin_control_room",
});

export function clientAudiencePairValid(clientType, audience) {
  return CANONICAL_CLIENT_AUDIENCE[String(clientType || "")] === String(audience || "");
}

const CLIENT_CONTEXT_VERSION = "mcp_client_context_v1";
const EXPOSURE_FIELDS = Object.freeze([
  "exposure_class",
  "allowed_client_types",
  "allowed_audiences",
  "required_entitlements",
  "discoverable_in_connector",
  "semantic_select_allowed",
]);

function safeArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clientContextCanonical(context) {
  return JSON.stringify({
    version: context.version,
    tenant_id: context.tenant_id,
    client_type: context.client_type,
    audience: context.audience,
    entitlements: safeArray(context.entitlements).sort(),
    role: context.role,
    issued_at: context.issued_at,
  });
}

function verifySignedClientContext(value, secret, tenantId, now = Date.now()) {
  if (!secret || secret.length < 32) return null;
  let context;
  try {
    context = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    !context ||
    context.version !== CLIENT_CONTEXT_VERSION ||
    String(context.tenant_id || "") !== String(tenantId || "") ||
    !CLIENT_TYPES.includes(String(context.client_type || "")) ||
    !CLIENT_AUDIENCES.includes(String(context.audience || "")) ||
    !clientAudiencePairValid(context.client_type, context.audience)
  ) {
    return null;
  }
  const issuedAt = Date.parse(String(context.issued_at || ""));
  if (!Number.isFinite(issuedAt) || issuedAt > now + 30_000 || now - issuedAt > 120_000) return null;
  const expected = `mcc_${crypto.createHmac("sha256", secret)
    .update(`mcp-client-context\u0000${clientContextCanonical(context)}`)
    .digest("hex")}`;
  if (!safeEqual(context.assertion, expected)) return null;
  return {
    client_type: context.client_type,
    audience: context.audience,
    entitlements: safeArray(context.entitlements),
    role: String(context.role || "member"),
    source: "verified_mcp_client_context",
  };
}

function keyMetadataContext(keyRecord = {}) {
  const metadata = keyRecord?.metadata && typeof keyRecord.metadata === "object"
    ? keyRecord.metadata
    : {};
  const explicitClientType = CLIENT_TYPES.includes(String(metadata.client_type || ""))
    ? String(metadata.client_type)
    : "";
  const explicitAudience = CLIENT_AUDIENCES.includes(String(metadata.audience || ""))
    ? String(metadata.audience)
    : "";

  if (
    explicitClientType === "admin" &&
    explicitAudience === "admin_control_room" &&
    keyRecord?.preset === "admin_control_room" &&
    hasScope(keyRecord, SCOPES.ADMIN_TENANT)
  ) {
    return {
      client_type: "admin",
      audience: "admin_control_room",
      role: String(metadata.role || "admin"),
      source: "server_key_admin_control_room_binding",
    };
  }
  if (
    explicitClientType &&
    explicitClientType !== "admin" &&
    explicitAudience &&
    clientAudiencePairValid(explicitClientType, explicitAudience)
  ) {
    return {
      client_type: explicitClientType,
      audience: explicitAudience,
      role: String(metadata.role || "service"),
      source: "server_key_metadata",
    };
  }
  if (keyRecord?.preset === "smartdesk_connector") {
    return {
      client_type: "smartdesk",
      audience: "smartdesk_runtime",
      role: "software_adjacent",
      source: "server_key_preset",
    };
  }
  if (keyRecord?.preset === "suite_connector") {
    return {
      client_type: "suite",
      audience: "suite_runtime",
      role: "software_adjacent",
      source: "server_key_preset",
    };
  }
  if (keyRecord?.preset === "wordpress_connector") {
    return {
      client_type: "waas",
      audience: "suite_runtime",
      role: "software_adjacent",
      source: "server_key_preset",
    };
  }
  if (keyRecord?.preset === "codex_automation") {
    return {
      client_type: "codex",
      audience: "codex_internal",
      role: "automation",
      source: "server_key_preset",
    };
  }
  return {
    client_type: "api_agent",
    audience: "api_agent",
    role: "service",
    source: "server_key_fail_closed_default",
  };
}

export function deriveBranchAccessContext(req, keyRecord, signingSecret = "", options = {}) {
  const signed = verifySignedClientContext(
    req?.get?.("x-sh-client-context"),
    signingSecret,
    req?.tenantId || keyRecord?.tenant_id,
  );
  const base = signed || keyMetadataContext(keyRecord);
  const branchEntitlements = safeArray(keyRecord?.metadata?.active_branches)
    .map((branchId) => `branch:${branchId}`);
  const resolvedBranchEntitlements = safeArray(options.allowed_branches)
    .map((branchId) => `branch:${branchId}`);
  const entitlements = safeArray([
    ...(signed?.entitlements || []),
    ...(keyRecord?.allowed_scopes || []),
    ...branchEntitlements,
    ...resolvedBranchEntitlements,
    ...(keyRecord?.metadata?.entitlements || []),
    ...(keyRecord?.metadata?.domain_pack_id
      ? [`domain_pack:${String(keyRecord.metadata.domain_pack_id)}`]
      : []),
  ]);
  return Object.freeze({
    tenant_id: String(req?.tenantId || keyRecord?.tenant_id || ""),
    client_type: base.client_type,
    audience: base.audience,
    role: base.role,
    entitlements: Object.freeze(entitlements),
    source: base.source,
  });
}

export function branchExposureValidation(profile) {
  const errors = [];
  if (!profile || typeof profile !== "object") return { ok: false, errors: ["profile_required"] };
  for (const field of EXPOSURE_FIELDS) {
    if (!Object.hasOwn(profile, field)) errors.push(`${field}_required`);
  }
  if (!EXPOSURE_CLASSES.includes(profile.exposure_class)) errors.push("exposure_class_invalid");
  const allowedClientTypes = safeArray(profile.allowed_client_types);
  const allowedAudiences = safeArray(profile.allowed_audiences);
  const requiredEntitlements = safeArray(profile.required_entitlements);
  if (!allowedClientTypes.length) errors.push("allowed_client_types_empty");
  if (allowedClientTypes.some((value) => !CLIENT_TYPES.includes(value) || value === "*")) {
    errors.push("allowed_client_types_invalid");
  }
  if (!allowedAudiences.length) errors.push("allowed_audiences_empty");
  if (allowedAudiences.some((value) => !CLIENT_AUDIENCES.includes(value) || value === "*")) {
    errors.push("allowed_audiences_invalid");
  }
  const canonicalAudiences = [...new Set(
    allowedClientTypes.map((clientType) => CANONICAL_CLIENT_AUDIENCE[clientType]).filter(Boolean),
  )].sort();
  if (
    canonicalAudiences.length !== allowedAudiences.length ||
    canonicalAudiences.some((audience, index) => audience !== [...allowedAudiences].sort()[index])
  ) {
    errors.push("allowed_client_audience_pairs_invalid");
  }
  if (!Array.isArray(profile.required_entitlements) || requiredEntitlements.includes("*")) {
    errors.push("required_entitlements_invalid");
  }
  if (typeof profile.discoverable_in_connector !== "boolean") {
    errors.push("discoverable_in_connector_boolean_required");
  }
  if (typeof profile.semantic_select_allowed !== "boolean") {
    errors.push("semantic_select_allowed_boolean_required");
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function branchAvailableForContext(profile, context, { semantic = false } = {}) {
  if (!branchExposureValidation(profile).ok || !context) return false;
  if (!clientAudiencePairValid(context.client_type, context.audience)) return false;
  if (!profile.allowed_client_types.includes(context.client_type)) return false;
  if (!profile.allowed_audiences.includes(context.audience)) return false;
  if (context.client_type === "chatgpt" && profile.exposure_class !== "chatgpt_horizontal") return false;
  if (profile.exposure_class === "admin_only" && context.client_type !== "admin") return false;
  if (profile.exposure_class === "test_only" && context.client_type !== "admin") return false;
  if (semantic && profile.semantic_select_allowed !== true) return false;
  if (!semantic && profile.discoverable_in_connector !== true) return false;
  if (context.client_type === "admin" && context.audience === "admin_control_room") return true;
  const entitlements = new Set(context.entitlements || []);
  return profile.required_entitlements.every((entitlement) => entitlements.has(entitlement));
}

export function filterBranchRegistry(registry, context, options = {}) {
  const entries = Object.entries(registry || {}).filter(([, profile]) =>
    branchAvailableForContext(profile, context, options),
  );
  const visible = new Set(entries.map(([branchId]) => branchId));
  const hidden = new Set(Object.keys(registry || {}).filter((branchId) => !visible.has(branchId)));
  const project = (value) => {
    if (typeof value === "string") return hidden.has(value) ? undefined : value;
    if (Array.isArray(value)) {
      return value.map(project).filter((item) => item !== undefined);
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const projected = project(item);
        return projected === undefined ? [] : [[key, projected]];
      }),
    );
  };
  return Object.fromEntries(entries.map(([branchId, profile]) => [branchId, project(profile)]));
}

export function filterBranchGroups(groups, visibleBranchIds) {
  const visible = new Set(visibleBranchIds || []);
  return Object.fromEntries(
    Object.entries(groups || {}).flatMap(([groupId, group]) => {
      const branches = safeArray(group?.branches).filter((branchId) => visible.has(branchId));
      return branches.length ? [[groupId, { ...group, branches }]] : [];
    }),
  );
}

export function filterBranchPackages(packages, visibleBranchIds) {
  const visible = new Set(visibleBranchIds || []);
  return Object.fromEntries(
    Object.entries(packages || {}).map(([packageId, branches]) => [
      packageId,
      safeArray(branches).filter((branchId) => visible.has(branchId)),
    ]),
  );
}

export function filterBranchTaxonomy(taxonomy, visibleBranchIds) {
  const visible = new Set(visibleBranchIds || []);
  const nodes = Array.isArray(taxonomy?.nodes) ? taxonomy.nodes : [];
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const keep = new Set();
  for (const node of nodes) {
    const bindings = safeArray(node.branch_bindings);
    if (bindings.some((branchId) => visible.has(branchId))) {
      let current = node;
      while (current && !keep.has(current.node_id)) {
        keep.add(current.node_id);
        current = current.parent_id ? byId.get(current.parent_id) : null;
      }
    }
  }
  const filteredNodes = nodes
    .filter((node) => keep.has(node.node_id))
    .map((node) => ({
      ...node,
      branch_bindings: safeArray(node.branch_bindings).filter((branchId) => visible.has(branchId)),
    }));
  const keptNodeIds = new Set(filteredNodes.map((node) => node.node_id));
  const filteredSynapses = (Array.isArray(taxonomy?.synapses) ? taxonomy.synapses : [])
    .filter((synapse) =>
      keptNodeIds.has(synapse.from_node_id) &&
      keptNodeIds.has(synapse.to_node_id) &&
      safeArray(synapse.shared_branch_ids).every((branchId) => visible.has(branchId)),
    );
  return {
    ...(taxonomy || {}),
    max_depth: filteredNodes.reduce((maximum, node) => Math.max(maximum, Number(node.depth || 0)), 0),
    node_count: filteredNodes.length,
    synapse_count: filteredSynapses.length,
    branch_count: visible.size,
    group_count: filteredNodes.filter((node) => node.kind === "group").length,
    nodes: filteredNodes,
    synapses: filteredSynapses,
    exposure_contract_version: BRANCH_EXPOSURE_CONTRACT_VERSION,
  };
}

export function filterBranchMaturity(report, visibleBranchIds) {
  const visible = new Set(visibleBranchIds || []);
  const statuses = Object.fromEntries(
    Object.entries(report?.statuses || {}).filter(([branchId]) => visible.has(branchId)),
  );
  const groups = Object.fromEntries(
    Object.entries(filterBranchGroups(report?.groups, visible)).map(([groupId, group]) => {
      const maturitySummary = group.branches.reduce((summary, branchId) => {
        const maturity = statuses[branchId]?.maturity || "unknown";
        summary[maturity] = (summary[maturity] || 0) + 1;
        return summary;
      }, {});
      return [groupId, { ...group, maturity_summary: maturitySummary }];
    }),
  );
  return {
    ...(report || {}),
    statuses,
    groups,
    exposure_contract_version: BRANCH_EXPOSURE_CONTRACT_VERSION,
  };
}

function candidateBranchIds(candidate, registry) {
  const explicit = [
    candidate?.branch_id,
    candidate?.branch,
    candidate?.metadata?.branch_id,
    candidate?.semantic_context?.branch_id,
    candidate?.context?.branch_id,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const id = String(candidate?.id || "").trim();
  if (id && Object.hasOwn(registry || {}, id)) explicit.push(id);
  return [...new Set(explicit)];
}

export function filterSemanticBranchCandidates(candidates, registry, context) {
  const visible = filterBranchRegistry(registry, context, { semantic: true });
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
    const branchIds = candidateBranchIds(candidate, registry);
    return !branchIds.length || branchIds.every((branchId) => Object.hasOwn(visible, branchId));
  });
}
