import { entity360Digest } from "./entity360.js";

export const ENTITY_360_ENFORCEMENT_POLICY_SCHEMA_VERSION =
  "entity_360_enforcement_policy_v2";
export const ENTITY_360_ENFORCEMENT_CONTRACT_SCHEMA_VERSION =
  "entity_360_enforcement_contract_v2";
export const ENTITY_360_ENFORCEMENT_MIGRATION_ID =
  "20260905_003_entity360_v2_enforcement";

const EXACT_POLICY_KEYS = new Set([
  "adapter_registry_schema_version",
  "authority_owner",
  "bitemporal_mode",
  "context_statuses",
  "decision_receipt_schema_version",
  "entity360_self_approval",
  "failure_policy",
  "migration_id",
  "mode",
  "policy_version",
  "provider_mutation",
  "rollback_mode",
  "schema_version",
  "snapshot_schema_version",
  "store_backend",
  "tenant_feature_mode",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  error.status = 503;
  throw error;
}

function plain(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function exactKeys(value, expected, code) {
  const keys = Object.keys(plain(value, code)).sort();
  const allowed = [...expected].sort();
  if (keys.length !== allowed.length
    || keys.some((key, index) => key !== allowed[index])) fail(code);
}

function text(value, code, maximum = 160) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum) fail(code);
  return normalized;
}

export function compileEntity360EnforcementPolicy(input = {}) {
  exactKeys(input, EXACT_POLICY_KEYS, "entity360_enforcement_policy_schema_invalid");
  if (input.schema_version !== ENTITY_360_ENFORCEMENT_POLICY_SCHEMA_VERSION
    || input.mode !== "ENFORCE"
    || input.authority_owner !== "UNIVERSAL_CORE"
    || input.failure_policy !== "FAIL_CLOSED"
    || input.snapshot_schema_version !== "entity_360_snapshot_v2"
    || input.adapter_registry_schema_version !== "entity_360_adapter_registry_v1"
    || input.store_backend !== "entity360_postgres_append_only_v1"
    || input.migration_id !== ENTITY_360_ENFORCEMENT_MIGRATION_ID
    || input.bitemporal_mode !== "ENFORCE"
    || input.tenant_feature_mode !== "ENFORCED"
    || input.rollback_mode !== "SHADOW"
    || input.decision_receipt_schema_version !== "host_native_action_ticket_v1"
    || input.provider_mutation !== false
    || input.entity360_self_approval !== false) {
    fail("entity360_enforcement_policy_invalid");
  }
  if (!Array.isArray(input.context_statuses)
    || input.context_statuses.length !== 1 || input.context_statuses[0] !== "READY") {
    fail("entity360_enforcement_context_status_invalid");
  }
  const policy = {
    schema_version: ENTITY_360_ENFORCEMENT_POLICY_SCHEMA_VERSION,
    policy_version: text(input.policy_version, "entity360_enforcement_policy_version_invalid"),
    mode: "ENFORCE",
    authority_owner: "UNIVERSAL_CORE",
    failure_policy: "FAIL_CLOSED",
    snapshot_schema_version: "entity_360_snapshot_v2",
    adapter_registry_schema_version: "entity_360_adapter_registry_v1",
    store_backend: "entity360_postgres_append_only_v1",
    migration_id: ENTITY_360_ENFORCEMENT_MIGRATION_ID,
    bitemporal_mode: "ENFORCE",
    tenant_feature_mode: "ENFORCED",
    rollback_mode: "SHADOW",
    decision_receipt_schema_version: "host_native_action_ticket_v1",
    context_statuses: Object.freeze(["READY"]),
    provider_mutation: false,
    entity360_self_approval: false,
  };
  return Object.freeze({ ...policy, policy_digest: entity360Digest(policy) });
}

export function buildEntity360EnforcementContract({ policy, contextPolicy, ontology,
  adapterRegistry } = {}) {
  const compiled = policy?.policy_digest
    ? policy : compileEntity360EnforcementPolicy(policy);
  if (!contextPolicy?.policy_digest || !ontology?.ontology_version
    || !adapterRegistry || adapterRegistry.schema_version !==
      compiled.adapter_registry_schema_version
    || !Array.isArray(adapterRegistry.adapter_versions)
    || adapterRegistry.adapter_versions.length < 1) {
    fail("entity360_enforcement_contract_dependency_invalid");
  }
  const unsigned = {
    schema_version: ENTITY_360_ENFORCEMENT_CONTRACT_SCHEMA_VERSION,
    enforcement_policy_version: compiled.policy_version,
    enforcement_policy_digest: compiled.policy_digest,
    context_policy_version: contextPolicy.policy_version,
    context_policy_digest: contextPolicy.policy_digest,
    ontology_version: ontology.ontology_version,
    ontology_digest: entity360Digest(ontology),
    adapter_registry_schema_version: adapterRegistry.schema_version,
    adapter_versions: [...new Set(adapterRegistry.adapter_versions.map(String))].sort(),
    snapshot_schema_version: compiled.snapshot_schema_version,
    store_backend: compiled.store_backend,
    migration_id: compiled.migration_id,
    bitemporal_mode: compiled.bitemporal_mode,
    authority_owner: compiled.authority_owner,
    decision_receipt_schema_version: compiled.decision_receipt_schema_version,
    failure_policy: compiled.failure_policy,
    provider_mutation: false,
    entity360_self_approval: false,
  };
  return Object.freeze({ ...unsigned,
    enforcement_authority_digest: entity360Digest(unsigned) });
}
