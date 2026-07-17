import crypto from "node:crypto";

const DOMAIN_ACTION_ID = "skinharmony_mcp_staging_render_create_v1";
const OPERATION_CLASS = "reversible_owner_confirmed_mcp_staging_service";
const ACTION_TYPE = "service_environment_configuration";
const ACTION_LABEL = "Create isolated MCP staging service";
const EXPECTED_TENANT_ID = "codexai";
const EXPECTED_DOMAIN_PACK_ID = "skinharmony";
const TARGET_COMMIT = "f435aafb709a26c77e82e2688056d73056d69c82";
const CONFIRMATION_REFERENCE = "ucr_mcp_staging_20260716_01";
const AUTHORIZED_SCOPE = "reversible_owner_confirmed_mcp_staging_service";

const TOP_LEVEL_KEYS = Object.freeze([
  "action_label",
  "action_type",
  "operation_class",
  "target_commit",
  "external_side_effect",
  "contains_customer_data",
  "contains_secret",
  "cross_tenant",
  "destructive",
  "bypass_orchestrator",
  "rollback_ready",
  "audit_ready",
  "configuration_changes",
  "owner_confirmed",
  "confirmation_reference",
  "confirmed_action_digest",
  "action_confirmation",
  "deployment_spec",
  "memory_context",
  "tenant_id",
]);

const REQUIRED_SAFETY_ENVELOPE = Object.freeze({
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  rollback_ready: true,
  audit_ready: true,
  configuration_changes: true,
});

const LEGACY_STAGING_POSTGRES_KEYS = Object.freeze([
  "action_label",
  "action_type",
  "operation_class",
  "external_side_effect",
  "contains_customer_data",
  "contains_secret",
  "cross_tenant",
  "destructive",
  "bypass_orchestrator",
  "rollback_ready",
  "audit_ready",
  "configuration_changes",
  "environment",
  "target",
  "target_branch",
  "resource_type",
  "create_new",
  "reuse_existing_database",
  "auth0_changes",
  "merge",
  "production_deploy",
  "delete",
  "target_commit",
  "confirmation_reference",
  "owner_confirmed",
  "tenant_id",
  "memory_context",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const DEPLOYMENT_SPEC = deepFreeze({
  schema_version: "skinharmony_mcp_staging_render_action_v1",
  gate_id: DOMAIN_ACTION_ID,
  provider: "render",
  target: {
    workspace_id: "tea-d780u0c50q8c73d51fi0",
    project_id: "prj-d7817c9r0fns738cf6vg",
    project_name: "My project",
    environment_id: "evm-d9cdaovavr4c73av1h10",
    environment_name: "staging",
    region_slug: "oregon",
    region_label: "Oregon",
  },
  service: {
    name: "skinharmony-core-mcp-staging",
    resource_type: "web_service",
    plan: "free",
    create_mode: "create_only",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    root_directory: "",
    branch: "agent/multiagent-postgres-cloud",
    commit: TARGET_COMMIT,
    expected_branch_head: TARGET_COMMIT,
    runtime: "node",
    build_command: "npm ci",
    start_command: "npm run core:mcp",
    health_check_path: "/healthz",
    public_url: "https://skinharmony-core-mcp-staging.onrender.com",
    initial_deploy: true,
    auto_deploy: false,
    pull_request_previews: false,
  },
  database: {
    name: "skinharmony-mcp-staging-db",
    resource_id: "dpg-d9cdeie1a83c73ca5l10-a",
    required_status: "available",
    binding_key: "MCP_COLLABORATION_DATABASE_URL",
    binding_kind: "render_database_reference",
    reference_property: "connectionString",
    reference_only: true,
    value_access: false,
  },
  environment_bindings: [
    { key: "NODE_ENV", kind: "literal", value: "production" },
    { key: "MCP_PUBLIC_URL", kind: "literal", value: "https://skinharmony-core-mcp-staging.onrender.com" },
    { key: "MCP_DEFAULT_TENANT_ID", kind: "literal", value: "codexai" },
    { key: "UNIVERSAL_CORE_URL", kind: "literal", value: "https://skinharmony-universal-core.onrender.com" },
    { key: "MCP_SUPPORTED_SCOPES", kind: "literal", value: "core:read,core:govern" },
    { key: "CORE_DECISION_LEDGER_REQUIRED", kind: "literal", value: "false" },
    { key: "MCP_COLLABORATION_DATABASE_SSL", kind: "literal", value: "true" },
    {
      key: "MCP_COLLABORATION_DATABASE_URL",
      kind: "render_database_reference",
      resource_id: "dpg-d9cdeie1a83c73ca5l10-a",
      property: "connectionString",
      value_access: false,
    },
    {
      key: "CODEX_BEARER_KEYS",
      kind: "preprovisioned_staging_secret_reference",
      reference_id: "mcp-staging-codex-bearer-v1",
      credential_scope: "codexai_staging_only",
      value_access: false,
      production_reuse: false,
    },
    {
      key: "UNIVERSAL_CORE_KEY",
      kind: "preprovisioned_staging_secret_reference",
      reference_id: "mcp-staging-universal-core-key-v1",
      credential_scope: "codexai_staging_only",
      value_access: false,
      production_reuse: false,
    },
  ],
  credential_policy: {
    staging_credentials_preprovisioned: true,
    create_credentials: false,
    copy_existing_environment: false,
    reuse_production_credentials: false,
    secret_values_in_payload: false,
  },
  safety: {
    create_new_service_only: true,
    update_existing_service: false,
    reuse_existing_service: false,
    link_other_services: false,
    auth0_usage: false,
    auth0_changes: false,
    generic_database_url_usage: false,
    god_mode_enabled: false,
    merge: false,
    production_deploy: false,
    production_changes: false,
    delete: false,
    cross_tenant: false,
  },
  verification: {
    revalidate_branch_head_before_execution: true,
    require_service_absent_before_creation: true,
    verify_database_available_before_binding: true,
    verify_deployed_commit_before_validation: true,
    executor_uses_normalized_spec_only: true,
    rollback_requires_separate_authorization: true,
    automatic_deletion_on_failure: false,
  },
});

const FORBIDDEN_ENVIRONMENT_KEYS = new Set([
  "DATABASE_URL",
  "DATABASE_SSL",
  "CORE_BASE_URL",
  "CORE_MCP_KEY",
  "UNIVERSAL_CORE_KEYS_JSON",
  "MCP_CHATGPT_TENANT_ID",
  "MCP_TENANT_CLAIM",
  "AGENT_WORKSPACE_ROOT",
  "MEMORY_FABRIC_ROOT",
  "RESEARCH_CORTEX_ROOT",
  "SHARED_WORK_MEMORY_ROOT",
  "CODEX_BEARER_KEYS",
  "UNIVERSAL_CORE_KEY",
  "MCP_COLLABORATION_DATABASE_URL",
]);

const FORBIDDEN_FIELD_ALIASES = new Set([
  "apikey",
  "connectionstring",
  "credentials",
  "databaseconnectionurl",
  "databaseurl",
  "environmentgroupids",
  "environmentvariables",
  "envgroupids",
  "envvars",
  "existingserviceid",
  "externalconnectionstring",
  "password",
  "rawenvironment",
  "rootdir",
  "secret",
  "secretfiles",
  "secretreferences",
  "secretvalues",
  "serviceid",
  "token",
]);

const PROTECTED_IDENTIFIERS = new Set([
  DOMAIN_ACTION_ID,
  TARGET_COMMIT,
  CONFIRMATION_REFERENCE,
  DEPLOYMENT_SPEC.target.workspace_id,
  DEPLOYMENT_SPEC.target.project_id,
  DEPLOYMENT_SPEC.target.environment_id,
  DEPLOYMENT_SPEC.service.name,
  DEPLOYMENT_SPEC.service.branch,
  DEPLOYMENT_SPEC.service.public_url,
  DEPLOYMENT_SPEC.database.name,
  DEPLOYMENT_SPEC.database.resource_id,
  DEPLOYMENT_SPEC.database.binding_key,
].map((value) => value.toLowerCase()));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactValue(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      actual.every((item, index) => exactValue(item, expected[index]));
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) => key === expectedKeys[index] && exactValue(actual[key], expected[key]));
  }
  return typeof actual === typeof expected && Object.is(actual, expected);
}

function exactOwnKeySubset(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function actionDigest(value) {
  return crypto.createHash("sha256").update(`core-domain-action-v1\u0000${canonicalJson(value)}`).digest("hex");
}

function containsExact(value, expected) {
  return value === expected || (Array.isArray(value) && value.some((item) => item === expected));
}

function containsCommit(value, expected) {
  const matches = (item) => typeof item === "string" && item.toLowerCase() === expected;
  return matches(value) || (Array.isArray(value) && value.some(matches));
}

function containsReference(value, expected) {
  const matches = (item) => typeof item === "string" && item.toLowerCase() === expected;
  return matches(value) || (Array.isArray(value) && value.some(matches));
}

function containsProtectedIdentifier(value, parentKey = "") {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return [...PROTECTED_IDENTIFIERS].some((identifier) => normalized.includes(identifier));
  }
  if (Array.isArray(value)) return value.some((item) => containsProtectedIdentifier(item, parentKey));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    key !== "memory_context" && containsProtectedIdentifier(child, key));
}

function fieldAlias(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function forbiddenKey(key) {
  if (typeof key !== "string") return true;
  const canonical = key.trim().toUpperCase();
  const alias = fieldAlias(key);
  return FORBIDDEN_ENVIRONMENT_KEYS.has(canonical) || FORBIDDEN_FIELD_ALIASES.has(alias) ||
    canonical.startsWith("AUTH0_") || canonical.startsWith("NYRA_GOD_MODE_") || canonical.startsWith("OPENAI_");
}

function secretLookingString(value) {
  if (typeof value !== "string") return false;
  return /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i.test(value) ||
    /\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/i.test(value) ||
    /\bBearer\s+\S+/i.test(value) || /\bSHX-[A-Z0-9_-]{8,}/i.test(value) || /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/.test(value);
}

function hasForbiddenPayload(value, parentKey = "") {
  if (secretLookingString(value)) return true;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenPayload(item, parentKey));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const reviewedDisabledFlag = parentKey === "safety" && child === false && ["auth0_usage", "auth0_changes"].includes(key);
    return (forbiddenKey(key) && !reviewedDisabledFlag) || hasForbiddenPayload(child, key);
  });
}

function attemptsProductionOrExistingResource(body) {
  const spec = isPlainObject(body.deployment_spec) ? body.deployment_spec : {};
  return spec.target?.environment_name === "production" || spec.service?.name === "skinharmony-core-mcp" ||
    spec.service?.branch === "main" || spec.service?.id !== undefined || spec.database?.name === "skinharmony-db" ||
    body.production_deploy === true || body.production_changes === true || body.reuse_existing_service === true ||
    body.update_existing_service === true || body.modify_existing_service === true || body.reuse_production_credentials === true ||
    body.copy_existing_environment === true || body.auth0_usage === true || body.auth0_changes === true ||
    body.god_mode_enabled === true || body.merge === true || body.delete === true || body.database_url_usage === true ||
    body.secret_value_access === true || body.secret_values_provided === true;
}

function buildCanonicalAction({ tenantId, keyId, domainPackId }) {
  return {
    schema_version: "core_domain_action_v1",
    domain_action_id: DOMAIN_ACTION_ID,
    tenant_binding: {
      tenant_id: tenantId,
      core_key_id: keyId,
      domain_pack_id: domainPackId,
    },
    action: DEPLOYMENT_SPEC,
  };
}

function isExactLegacyStagingPostgresAction(body) {
  if (!exactOwnKeySubset(body, LEGACY_STAGING_POSTGRES_KEYS)) return false;
  const confirmationReference = body.confirmation_reference;
  const optionalIdentityValid = body.owner_confirmed === undefined || typeof body.owner_confirmed === "boolean";
  const optionalLabelValid = body.action_label === undefined ||
    (typeof body.action_label === "string" && body.action_label.length > 0 && body.action_label.length <= 500);
  const optionalTenantValid = body.tenant_id === undefined ||
    (typeof body.tenant_id === "string" && body.tenant_id.length > 0 && body.tenant_id.length <= 120);
  const optionalMemoryValid = body.memory_context === undefined || isPlainObject(body.memory_context);
  return body.operation_class === "reversible_owner_confirmed_deploy" &&
    body.action_type === "environment_configuration" &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.cross_tenant === false && body.destructive === false && body.bypass_orchestrator === false &&
    body.rollback_ready === true && body.audit_ready === true && body.configuration_changes === true &&
    body.environment === "staging" && body.target === "skinharmony-mcp-staging-db" &&
    body.target_branch === "agent/multiagent-postgres-cloud" && body.resource_type === "postgresql" &&
    body.create_new === true && body.reuse_existing_database === false && body.auth0_changes === false &&
    body.merge === false && body.production_deploy === false && body.delete === false &&
    typeof body.target_commit === "string" && /^[a-f0-9]{40}$/.test(body.target_commit) &&
    typeof confirmationReference === "string" && confirmationReference.length > 0 && confirmationReference.length <= 240 &&
    confirmationReference.trim() === confirmationReference && !secretLookingString(confirmationReference) &&
    optionalIdentityValid && optionalLabelValid && optionalTenantValid && optionalMemoryValid;
}

function isReserved(body, digest) {
  const spec = isPlainObject(body.deployment_spec) ? body.deployment_spec : {};
  return containsProtectedIdentifier(body) || containsExact(body.operation_class, OPERATION_CLASS) ||
    containsExact(body.action_type, ACTION_TYPE) ||
    body.deployment_spec !== undefined || containsCommit(body.target_commit, TARGET_COMMIT) ||
    containsExact(body.target, DEPLOYMENT_SPEC.service.name) || containsExact(body.service_name, DEPLOYMENT_SPEC.service.name) ||
    spec.gate_id === DOMAIN_ACTION_ID || spec.service?.name === DEPLOYMENT_SPEC.service.name ||
    containsCommit(spec.service?.commit, TARGET_COMMIT) || containsCommit(spec.service?.expected_branch_head, TARGET_COMMIT) ||
    spec.database?.resource_id === DEPLOYMENT_SPEC.database.resource_id ||
    containsReference(body.confirmation_reference, CONFIRMATION_REFERENCE) ||
    containsReference(body.action_confirmation?.confirmation_reference, CONFIRMATION_REFERENCE) ||
    body.confirmed_action_digest === digest || body.action_confirmation?.action_digest === digest;
}

export function skinHarmonyMcpStagingActionTemplate() {
  return {
    action_label: ACTION_LABEL,
    action_type: ACTION_TYPE,
    operation_class: OPERATION_CLASS,
    target_commit: TARGET_COMMIT,
    ...REQUIRED_SAFETY_ENVELOPE,
    owner_confirmed: false,
    confirmation_reference: CONFIRMATION_REFERENCE,
    deployment_spec: clone(DEPLOYMENT_SPEC),
  };
}

export function evaluateSkinHarmonyMcpStagingAction({
  body = {},
  tenantId = "",
  keyId = "",
  domainPackId = "",
  actionConfirmation = { verified: false },
} = {}) {
  if (isExactLegacyStagingPostgresAction(body)) {
    return Object.freeze({ reserved: false, claimed: false, eligible: false, hard_block: false });
  }
  const canonicalAction = buildCanonicalAction({ tenantId, keyId, domainPackId });
  const digest = actionDigest(canonicalAction);
  const reserved = isReserved(body, digest);
  if (!reserved) return Object.freeze({ reserved: false, claimed: false, eligible: false, hard_block: false });

  const claimed = containsExact(body.operation_class, OPERATION_CLASS) || containsExact(body.action_type, ACTION_TYPE) ||
    body.deployment_spec?.gate_id === DOMAIN_ACTION_ID;
  const contextMatches = tenantId === EXPECTED_TENANT_ID && domainPackId === EXPECTED_DOMAIN_PACK_ID &&
    typeof keyId === "string" && /^key_[a-z0-9-]{8,}$/i.test(keyId);
  const envelopeMatches = Object.entries(REQUIRED_SAFETY_ENVELOPE).every(([key, expected]) => body[key] === expected);
  const topLevelMatches = exactOwnKeySubset(body, TOP_LEVEL_KEYS);
  const memoryMatches = body.memory_context === undefined ||
    (isPlainObject(body.memory_context) && body.memory_context.tenant_id === tenantId);
  const requestMatches = body.action_label === ACTION_LABEL && body.action_type === ACTION_TYPE &&
    body.operation_class === OPERATION_CLASS && body.target_commit === TARGET_COMMIT &&
    body.tenant_id === tenantId && body.confirmation_reference === CONFIRMATION_REFERENCE;
  const specMatches = exactValue(body.deployment_spec, DEPLOYMENT_SPEC);
  const confirmationEnvelopeMatches = typeof body.owner_confirmed === "boolean" &&
    (body.confirmed_action_digest === undefined || body.confirmed_action_digest === digest) &&
    (body.action_confirmation === undefined || (
      actionConfirmation?.verified === true && actionConfirmation.tenant_id === tenantId &&
      actionConfirmation.confirmation_reference === CONFIRMATION_REFERENCE && actionConfirmation.action_digest === digest
    ));
  const dangerous = body.cross_tenant === true || body.destructive === true || body.bypass_orchestrator === true ||
    body.contains_secret === true || attemptsProductionOrExistingResource(body) || hasForbiddenPayload(body);
  const eligible = claimed && contextMatches && envelopeMatches && topLevelMatches && memoryMatches && requestMatches &&
    specMatches && confirmationEnvelopeMatches && !dangerous;
  const confirmationMatches = eligible && body.owner_confirmed === true && body.confirmed_action_digest === digest &&
    actionConfirmation?.verified === true && actionConfirmation.tenant_id === tenantId &&
    actionConfirmation.confirmation_reference === CONFIRMATION_REFERENCE && actionConfirmation.action_digest === digest;

  return Object.freeze({
    reserved: true,
    claimed,
    eligible,
    hard_block: dangerous,
    scope: AUTHORIZED_SCOPE,
    domain_action_id: DOMAIN_ACTION_ID,
    action_digest: eligible ? digest : null,
    confirmation_required: eligible,
    confirmation_satisfied: confirmationMatches,
    confirmation_reference: confirmationMatches ? CONFIRMATION_REFERENCE : null,
    target_commit: eligible ? TARGET_COMMIT : null,
    executor_contract_id: eligible ? `domain_action_${digest.slice(0, 20)}` : null,
    revalidation_required: eligible,
  });
}
