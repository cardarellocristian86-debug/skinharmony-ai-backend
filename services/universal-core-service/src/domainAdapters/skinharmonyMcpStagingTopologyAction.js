import { createHash } from "node:crypto";

export const SKINHARMONY_MCP_STAGING_TOPOLOGY_OPERATION_CLASS =
  "reversible_owner_confirmed_mcp_staging_topology";
export const SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_TYPE =
  "render_mcp_staging_topology_phase";
export const SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_ID =
  "skinharmony_mcp_staging_topology_v1";
export const SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_LABEL =
  "Deploy isolated SkinHarmony MCP staging topology";
export const SKINHARMONY_MCP_STAGING_POLICY_MAX_MONTHLY_COST_CENTS = 10_000;

export const SKINHARMONY_MCP_STAGING_PHASES = Object.freeze([
  "blueprint_validate",
  "blueprint_apply_dependencies",
  "bootstrap_control_plane",
  "database_runtime_role_transition",
  "blueprint_apply_runtime",
  "persistence_canary",
]);

const PHASE_CONTROLS = Object.freeze({
  blueprint_validate: Object.freeze({
    external_side_effect: false,
    configuration_changes: false,
    provider_execution: false,
    execution_enabled: false,
    deploy: false,
    database_connection: false,
    database_mutation: false,
  }),
  blueprint_apply_dependencies: Object.freeze({
    external_side_effect: true,
    configuration_changes: true,
    provider_execution: true,
    execution_enabled: true,
    deploy: true,
    database_connection: false,
    database_mutation: false,
  }),
  bootstrap_control_plane: Object.freeze({
    external_side_effect: true,
    configuration_changes: true,
    provider_execution: true,
    execution_enabled: true,
    deploy: true,
    database_connection: true,
    database_mutation: false,
  }),
  database_runtime_role_transition: Object.freeze({
    external_side_effect: true,
    configuration_changes: true,
    provider_execution: true,
    execution_enabled: true,
    deploy: false,
    database_connection: true,
    database_mutation: true,
  }),
  blueprint_apply_runtime: Object.freeze({
    external_side_effect: true,
    configuration_changes: true,
    provider_execution: true,
    execution_enabled: true,
    deploy: true,
    database_connection: true,
    database_mutation: false,
  }),
  persistence_canary: Object.freeze({
    external_side_effect: true,
    configuration_changes: false,
    provider_execution: true,
    execution_enabled: true,
    deploy: false,
    database_connection: true,
    database_mutation: true,
  }),
});

const TOPOLOGY = Object.freeze({
  schema_version: "skinharmony_mcp_staging_topology_v1",
  tenant_id: "codexai",
  environment: "staging",
  region: "Oregon",
  database: Object.freeze({
    name: "skinharmony-mcp-staging-db",
    resource_type: "postgresql",
    lifecycle: "existing_only",
    required_status: "available",
    create: false,
    replace: false,
    delete: false,
    reuse_other_database: false,
    provider_reference: "fromDatabase",
  }),
  services: Object.freeze([
    Object.freeze({
      name: "skinharmony-universal-core-staging",
      resource_type: "private_service",
      plan: "starter",
      lifecycle: "create_only",
    }),
    Object.freeze({
      name: "skinharmony-core-staging-issuer",
      resource_type: "private_service",
      plan: "starter",
      lifecycle: "create_only",
    }),
    Object.freeze({
      name: "skinharmony-nyra-staging-issuer",
      resource_type: "private_service",
      plan: "starter",
      lifecycle: "create_only",
    }),
    Object.freeze({
      name: "skinharmony-mcp-staging-db-bootstrap",
      resource_type: "private_service",
      plan: "starter",
      lifecycle: "create_only",
    }),
    Object.freeze({
      name: "skinharmony-core-mcp-staging",
      resource_type: "web_service",
      plan: "starter",
      lifecycle: "create_only",
    }),
  ]),
  phases: SKINHARMONY_MCP_STAGING_PHASES,
  rollout_contract: Object.freeze({
    dependency_manifest: "render-mcp-staging-bootstrap.yaml",
    control_plane_manifest: "render-mcp-staging-control-plane.yaml",
    runtime_manifest: "render-mcp-staging.yaml",
    database_bootstrap_modes: Object.freeze(["hold", "initialize", "steady"]),
    initial_database_reference: false,
    provider_managed_runtime_role: "mcp_collaboration_runtime",
    runtime_services: Object.freeze([
      "skinharmony-universal-core-staging",
      "skinharmony-core-mcp-staging",
    ]),
  }),
  reference_policy: Object.freeze({
    database_connection: "fromDatabase",
    service_connection: "fromService",
    generated_credentials: "generateValue",
    transfer: "provider_native_opaque_only",
    secret_value_readback: false,
    secret_value_persistence: false,
  }),
});

const REQUIRED_ACTION_FIELDS = Object.freeze([
  "action_label",
  "action_type",
  "operation_class",
  "domain_action_id",
  "authenticated_tenant_id",
  "tenant_id",
  "owner_confirmed",
  "owner_context_verified",
  "owner_context_approval_bound",
  "memory_context",
  "external_side_effect",
  "contains_customer_data",
  "contains_secret",
  "secret_value_transmitted",
  "values_present_in_envelope",
  "cross_tenant",
  "destructive",
  "bypass_orchestrator",
  "rollback_ready",
  "audit_ready",
  "readback_required",
  "configuration_changes",
  "auth0_changes",
  "production_deploy",
  "merge",
  "delete",
  "provider_execution",
  "execution_enabled",
  "deploy",
  "database_connection",
  "database_mutation",
  "create_missing_only",
  "overwrite_existing",
  "target_branch",
  "target_commit",
  "environment",
  "region",
  "phase",
  "topology",
  "provider_native_references",
  "secret_values_present",
  "spec_digest",
  "confirmation_spec_digest",
  "maximum_recurring_monthly_cost_cents",
  "recurring_cost_currency",
  "recurring_cost_confirmed",
  "confirmation_maximum_recurring_monthly_cost_cents",
  "confirmation_recurring_cost_currency",
  "confirmation_reference",
]);

const REQUIRED_ACTION_FIELD_SET = new Set(REQUIRED_ACTION_FIELDS);
const REQUIRED_TRANSPORT_FIELDS = Object.freeze([
  "agent_id",
  "client_type",
  "session_id",
  "owner_context",
  "request_bound_owner_confirmation",
  "authenticated_key_type",
]);
const REQUIRED_TRANSPORT_FIELD_SET = new Set(REQUIRED_TRANSPORT_FIELDS);
const RESERVED_NAMES = Object.freeze([
  "skinharmony-mcp-staging-db",
  "skinharmony-universal-core-staging",
  "skinharmony-core-staging-issuer",
  "skinharmony-nyra-staging-issuer",
  "skinharmony-mcp-staging-db-bootstrap",
  "skinharmony-core-mcp-staging",
]);
const RESERVED_ENVIRONMENT_VARIABLES = Object.freeze([
  "MCP_COLLABORATION_DATABASE_URL",
  "MCP_COLLABORATION_CORE_ISSUER_HOSTPORT",
  "MCP_COLLABORATION_NYRA_ISSUER_HOSTPORT",
  "MCP_COLLABORATION_TARGET_SERVICE",
]);

const NONE = Object.freeze({
  reserved: false,
  claimed: false,
  eligible: false,
  hard_block: false,
});

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function exactValue(actual, expected) {
  return canonicalJson(actual) === canonicalJson(expected);
}

function normalizeMarker(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const NORMALIZED_RESERVED_MARKERS = Object.freeze([
  ...RESERVED_NAMES,
  ...RESERVED_ENVIRONMENT_VARIABLES,
  "MCP_STAGING_",
  SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_ID,
].map(normalizeMarker));

function containsReservedMarker(value, seen = new Set()) {
  if (typeof value === "string") {
    const normalized = normalizeMarker(value);
    return normalized.length > 0 &&
      NORMALIZED_RESERVED_MARKERS.some((marker) => normalized.includes(marker));
  }
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsReservedMarker(item, seen));
  return Object.entries(value).some(([key, item]) =>
    containsReservedMarker(key, seen) || containsReservedMarker(item, seen));
}

function isDeployLikeAttempt(body) {
  const operationClass = String(body?.operation_class || "");
  const actionType = String(body?.action_type || "").toLowerCase();
  return operationClass === SKINHARMONY_MCP_STAGING_TOPOLOGY_OPERATION_CLASS ||
    operationClass === "reversible_owner_confirmed_deploy" ||
    actionType === SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_TYPE ||
    actionType === "deploy" ||
    actionType === "environment_configuration";
}

function hasExactActionFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === REQUIRED_ACTION_FIELDS.length + REQUIRED_TRANSPORT_FIELDS.length &&
    REQUIRED_ACTION_FIELDS.every((key) => Object.hasOwn(body, key)) &&
    REQUIRED_TRANSPORT_FIELDS.every((key) => Object.hasOwn(body, key)) &&
    keys.every((key) =>
      REQUIRED_ACTION_FIELD_SET.has(key) || REQUIRED_TRANSPORT_FIELD_SET.has(key));
}

function hasValidTransportContext(body) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(String(body.agent_id || "")) &&
    ["chatgpt", "codex", "api_agent", "other"].includes(String(body.client_type || "")) &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(String(body.session_id || "")) &&
    body.owner_context && typeof body.owner_context === "object" &&
    !Array.isArray(body.owner_context) &&
    body.request_bound_owner_confirmation === true &&
    body.authenticated_key_type === "connector";
}

function hasValidMemoryContext(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    value.schema_version === "tenant_memory_context_v1" &&
    value.tenant_id === "codexai" &&
    Number.isInteger(value.revision) && value.revision >= 0;
}

function isSafeConfirmationReference(value) {
  const reference = String(value || "").trim();
  return reference.length > 0 && reference.length <= 240 &&
    !/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]/i.test(reference) &&
    !/[\u0000-\u001f\u007f]/u.test(reference);
}

function hasValidCostConfirmation(body) {
  return Number.isInteger(body.maximum_recurring_monthly_cost_cents) &&
    body.maximum_recurring_monthly_cost_cents > 0 &&
    body.maximum_recurring_monthly_cost_cents <=
      SKINHARMONY_MCP_STAGING_POLICY_MAX_MONTHLY_COST_CENTS &&
    body.recurring_cost_currency === "USD" &&
    body.recurring_cost_confirmed === true &&
    body.confirmation_maximum_recurring_monthly_cost_cents ===
      body.maximum_recurring_monthly_cost_cents &&
    body.confirmation_recurring_cost_currency === body.recurring_cost_currency;
}

function digestPayload(body) {
  return {
    schema_version: "skinharmony_mcp_staging_action_spec_v1",
    domain_action_id: body.domain_action_id,
    tenant_id: body.tenant_id,
    environment: body.environment,
    region: body.region,
    target_branch: body.target_branch,
    target_commit: body.target_commit,
    phase: body.phase,
    topology: body.topology,
    provider_native_references: body.provider_native_references,
    maximum_recurring_monthly_cost_cents: body.maximum_recurring_monthly_cost_cents,
    recurring_cost_currency: body.recurring_cost_currency,
  };
}

export function buildSkinHarmonyMcpStagingTopologySpecDigest(body = {}) {
  return createHash("sha256").update(canonicalJson(digestPayload(body))).digest("hex");
}

export function skinHarmonyMcpStagingTopology() {
  return JSON.parse(JSON.stringify(TOPOLOGY));
}

export function skinHarmonyMcpStagingPhaseControls(phase) {
  const controls = PHASE_CONTROLS[String(phase || "")];
  return controls ? { ...controls } : null;
}

function blocked(reason, claimed = true) {
  return Object.freeze({
    reserved: true,
    claimed,
    eligible: false,
    hard_block: true,
    confirmation_required: true,
    confirmation_satisfied: false,
    domain_action_id: SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_ID,
    reason,
  });
}

export function evaluateSkinHarmonyMcpStagingTopologyAction(context = {}) {
  const body = context?.body && typeof context.body === "object" ? context.body : {};
  if (!isDeployLikeAttempt(body) || !containsReservedMarker(body)) return NONE;

  const claimed =
    body.operation_class === SKINHARMONY_MCP_STAGING_TOPOLOGY_OPERATION_CLASS &&
    body.action_type === SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_TYPE &&
    body.domain_action_id === SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_ID;
  if (!claimed) return blocked("reserved_mcp_staging_action_requires_dedicated_gate", false);
  if (!hasExactActionFields(body)) return blocked("mcp_staging_action_shape_mismatch");
  if (!hasValidTransportContext(body)) return blocked("mcp_staging_transport_context_invalid");
  if (!hasValidCostConfirmation(body)) return blocked("mcp_staging_cost_confirmation_required");

  const phaseControls = PHASE_CONTROLS[body.phase];
  const exactCommit = /^[a-f0-9]{40}$/.test(String(body.target_commit || ""));
  const nonMainBranch = /^agent\/[a-z0-9._/-]+$/i.test(String(body.target_branch || "")) &&
    String(body.target_branch || "").toLowerCase() !== "main";
  const exactTopology = exactValue(body.topology, TOPOLOGY);
  const exactPhaseControls = phaseControls && Object.entries(phaseControls)
    .every(([key, expected]) => body[key] === expected);
  const calculatedDigest = buildSkinHarmonyMcpStagingTopologySpecDigest(body);
  const exactDigest = /^[a-f0-9]{64}$/.test(String(body.spec_digest || "")) &&
    body.spec_digest === calculatedDigest &&
    body.confirmation_spec_digest === calculatedDigest;

  const exactNonConfirmationScope =
    body.action_label === SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_LABEL &&
    body.authenticated_tenant_id === "codexai" &&
    body.tenant_id === "codexai" &&
    hasValidMemoryContext(body.memory_context) &&
    body.owner_context_approval_bound === false &&
    body.contains_customer_data === false &&
    body.contains_secret === false &&
    body.secret_value_transmitted === false &&
    body.values_present_in_envelope === false &&
    body.cross_tenant === false &&
    body.destructive === false &&
    body.bypass_orchestrator === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    body.readback_required === true &&
    body.auth0_changes === false &&
    body.production_deploy === false &&
    body.merge === false &&
    body.delete === false &&
    body.create_missing_only === true &&
    body.overwrite_existing === false &&
    body.environment === "staging" &&
    body.region === "Oregon" &&
    body.provider_native_references === true &&
    body.secret_values_present === false &&
    exactCommit &&
    nonMainBranch &&
    exactTopology &&
    exactPhaseControls &&
    exactDigest &&
    isSafeConfirmationReference(body.confirmation_reference);
  if (!exactNonConfirmationScope) return blocked("mcp_staging_topology_scope_mismatch");

  const confirmationSatisfied =
    body.owner_confirmed === true &&
    body.owner_context_verified === true;
  if (!confirmationSatisfied) {
    return Object.freeze({
      reserved: true,
      claimed: true,
      eligible: false,
      hard_block: false,
      confirmation_required: true,
      confirmation_satisfied: false,
      domain_action_id: SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_ID,
      spec_digest: calculatedDigest,
      workflow_phase: body.phase,
      target_commit: body.target_commit,
      reason: "mcp_staging_server_bound_owner_confirmation_required",
    });
  }

  return Object.freeze({
    reserved: true,
    claimed: true,
    eligible: true,
    hard_block: false,
    confirmation_required: true,
    confirmation_satisfied: true,
    domain_action_id: SKINHARMONY_MCP_STAGING_TOPOLOGY_ACTION_ID,
    spec_digest: calculatedDigest,
    workflow_phase: body.phase,
    target_commit: body.target_commit,
    reason: "mcp_staging_topology_authorized",
  });
}
