import crypto from "node:crypto";

export const ENTITY_360_SCHEMA_VERSION = "entity_360_snapshot_v1";
export const ENTITY_360_ONTOLOGY_VERSION = "entity_360_ontology_v1";
export const ENTITY_360_KERNEL_COMPATIBILITY = "entity_360_kernel_v1";
export const ENTITY_360_POLICY_SCHEMA_VERSION = "entity_360_context_policy_v1";
export const ENTITY_360_TEMPORAL_POLICY_SCHEMA_VERSION = "entity_360_temporal_reconciliation_policy_v1";
export const ENTITY_360_SHADOW_OBSERVATION_POLICY_SCHEMA_VERSION =
  "entity_360_shadow_observation_policy_v1";
export const ENTITY_360_CANONICALIZATION_VERSION = "entity_360_canonical_json_v1";
export const ENTITY_360_DIGEST_ALGORITHM = "sha256";
export const ENTITY_360_QUALIFICATION_ATTESTATION_VERSION =
  "entity_360_qualification_attestation_v2";
export const ENTITY_360_QUALIFICATION_ATTESTATION_PURPOSE =
  "entity360-qualified-context-v1";
export const ENTITY_360_IDENTITY_LINEAGE_SCHEMA_VERSION =
  "entity_360_identity_lineage_v1";
export const ENTITY_360_IDENTITY_LINEAGE_VERIFICATION_SCHEMA_VERSION =
  "entity_360_identity_lineage_verification_v1";
export const ENTITY_360_IDENTITY_LINEAGE_MODE = "SHADOW";

export const ENTITY_360_CONTEXT_STATES = Object.freeze([
  "READY",
  "INCOMPLETE",
  "CONFLICTED",
  "AMBIGUOUS",
  "INVALID",
]);

export const ENTITY_360_TEMPORAL_STATES = Object.freeze([
  "current",
  "historical",
  "superseded",
  "stale",
  "conflicting",
]);

const CONTEXT_STATES = new Set(ENTITY_360_CONTEXT_STATES);
const TEMPORAL_STATES = new Set(ENTITY_360_TEMPORAL_STATES);
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const ENTITY_TYPE = /^[a-z][a-z0-9._-]{0,79}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_RFC3339 = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const SIGNATURE = /^[A-Za-z0-9._~:+/=-]{16,4096}$/u;
const MAX_SAFE_BUDGET = 10_000_000;
const ENTITY_360_IDENTITY_LINEAGE_OPERATIONS = new Set(["MERGE", "SPLIT"]);
const ENTITY_360_IDENTITY_LINEAGE_ROOT_FIELDS = Object.freeze([
  "absorbed_entities",
  "audit_digest",
  "canonical_entity",
  "entity_type",
  "evidence_digest",
  "execution_authorized",
  "idempotency_key",
  "lineage_id",
  "mode",
  "observed_at",
  "operation",
  "predecessor_lineage_digest",
  "production_decision_mutation",
  "restored_entities",
  "reverses_lineage_digest",
  "schema_version",
  "tenant_scope",
]);
const ENTITY_360_IDENTITY_LINEAGE_MEMBER_FIELDS = Object.freeze([
  "entity_id", "identity", "identity_digest",
]);

const ENTITY_360_SNAPSHOT_ROOT_FIELDS = Object.freeze([
  "adapter_registry_version",
  "agent_provider_state",
  "architecture_separation",
  "architecture_state",
  "as_of",
  "assembly_report",
  "authoritative_sources_missing",
  "authority",
  "canonicalization_version",
  "completeness",
  "concurrent_active_work",
  "confidence",
  "content_semantics",
  "context_status",
  "contradictions",
  "contradictions_conflicts",
  "core_review_requirement",
  "core_verification_required",
  "corroboration_gaps",
  "corroboration_state",
  "created_at",
  "current_state",
  "dependencies",
  "deterministic_immutable_digest",
  "digest_algorithm",
  "entity_id",
  "entity_type",
  "envelope_digest",
  "evidence_digests",
  "evidence_references",
  "execution_authorized",
  "freshness",
  "genesis_intent_icf_policy_bindings",
  "historical_state_references",
  "identity",
  "missing_context",
  "ontology_digest",
  "ontology_version",
  "policy_digest",
  "policy_version",
  "previous_snapshot_digest",
  "production_decision_mutation",
  "project_work_linkage",
  "qualification_attestation",
  "qualification_manifest",
  "relationships",
  "runtime_state",
  "schema_version",
  "security_risk_signals",
  "snapshot_version",
  "source_discovery",
  "source_diversity",
  "source_provenance",
  "stale_sources",
  "stale_state_references",
  "superseded_state_references",
  "tenant_scope",
]);

const ENTITY_360_SOURCE_DISCOVERY_REASON_CODES = new Set([
  "ADAPTER_NOT_WIRED_V1",
  "ARCHITECTURE_DIGEST_MISMATCH",
  "AUTHORITATIVE_INTENT_ANCHOR_MISSING",
  "AUTHORITATIVE_INTENT_BINDING_UNAVAILABLE",
  "AUTHORITY_SELF_CORROBORATION_EXCLUDED_V1",
  "CANONICAL_GALLERY_IDENTITY_REQUIRED",
  "CAUSAL_AUTHORITY_GRAPH_MISMATCH",
  "CAUSAL_BINDING_EVENT_MISMATCH",
  "CAUSAL_BINDING_MISSING",
  "CAUSAL_GENESIS_DIGEST_MISMATCH",
  "CAUSAL_INTENT_DIGEST_MISMATCH",
  "CAUSAL_INTENT_REVISION_NOT_APPROVED",
  "CAUSAL_LEGACY_BINDING_UNVERIFIED",
  "COMPONENT_ATLAS_VERIFICATION_REQUIRED",
  "COMPONENT_NOT_FOUND",
  "COMPONENT_REVISION_HISTORY_INVALID",
  "COMPONENT_REVISION_HISTORY_MISSING_AS_OF",
  "EVENT_LEDGER_DIGEST_MISMATCH",
  "GENESIS_BINDING_MISSING",
  "ICF_BINDING_MISSING",
  "ICF_EVENT_DIGEST_CONTRACT_LEGACY_REANCHOR_REQUIRED",
  "ICF_EVENT_DIGEST_CONTRACT_UNSUPPORTED",
  "ICF_EVENT_DIGEST_MISMATCH",
  "INTENT_ANCHOR_DIGEST_MISMATCH",
  "INTENT_ANCHOR_PROJECT_SLUG_MISMATCH",
  "NO_ELIGIBLE_EVIDENCE_AS_OF",
  "NSCT_DECISION_MISSING",
  "NSCT_EVIDENCE_STALE",
  "NSCT_MODE_NOT_ADVISORY",
  "NSCT_MULTIPLE_PLAN_HEADS_AS_OF",
  "NSCT_STORE_NOT_READY",
  "NSCT_STORE_UNAVAILABLE",
  "NSCT_VERIFICATION_FAILED",
  "NSCT_VERIFIER_UNAVAILABLE",
  "SECURITY_OBSERVATION_ADMISSION_REJECTED",
  "SECURITY_OBSERVATION_EXPIRED",
  "SECURITY_OBSERVATION_DIGEST_MISMATCH",
  "SECURITY_OBSERVATION_FRESHNESS_INVALID",
  "SECURITY_OBSERVATION_MISSING",
  "SOURCE_SCHEMA_UNAVAILABLE",
  "SOURCE_RETRIEVAL_BUDGET_EXCEEDED",
  "WORK_NOT_FOUND",
  "WORK_PROJECT_LINKAGE_CONFLICT",
  "WORK_PROJECT_UUID_BINDING_MISMATCH",
  "WORK_PROJECT_UUID_BINDING_MISSING",
]);
const ENTITY_360_GENERIC_DISCOVERY_REASONS = new Set([
  "NO_ELIGIBLE_EVIDENCE_AS_OF", "SOURCE_RETRIEVAL_BUDGET_EXCEEDED",
  "SOURCE_SCHEMA_UNAVAILABLE",
]);
const ENTITY_360_SOURCE_DISCOVERY_REASON_BINDINGS = Object.freeze({
  architecture_map: new Set(["ARCHITECTURE_DIGEST_MISMATCH", "COMPONENT_ATLAS_VERIFICATION_REQUIRED", "COMPONENT_NOT_FOUND",
    "COMPONENT_REVISION_HISTORY_INVALID", "COMPONENT_REVISION_HISTORY_MISSING_AS_OF"]),
  event_ledger: new Set(["CAUSAL_BINDING_EVENT_MISMATCH", "EVENT_LEDGER_DIGEST_MISMATCH"]),
  genesis: new Set(["CAUSAL_AUTHORITY_GRAPH_MISMATCH", "CAUSAL_BINDING_MISSING",
    "CAUSAL_BINDING_EVENT_MISMATCH", "CAUSAL_GENESIS_DIGEST_MISMATCH",
    "CAUSAL_INTENT_REVISION_NOT_APPROVED", "CAUSAL_LEGACY_BINDING_UNVERIFIED",
    "GENESIS_BINDING_MISSING", "WORK_PROJECT_UUID_BINDING_MISMATCH",
    "WORK_PROJECT_UUID_BINDING_MISSING"]),
  icf: new Set(["ICF_BINDING_MISSING", "ICF_EVENT_DIGEST_CONTRACT_LEGACY_REANCHOR_REQUIRED",
    "ICF_EVENT_DIGEST_CONTRACT_UNSUPPORTED", "ICF_EVENT_DIGEST_MISMATCH"]),
  intent: new Set(["AUTHORITATIVE_INTENT_ANCHOR_MISSING", "AUTHORITATIVE_INTENT_BINDING_UNAVAILABLE",
    "CAUSAL_INTENT_DIGEST_MISMATCH", "CAUSAL_INTENT_REVISION_NOT_APPROVED", "CAUSAL_LEGACY_BINDING_UNVERIFIED",
    "INTENT_ANCHOR_DIGEST_MISMATCH", "INTENT_ANCHOR_PROJECT_SLUG_MISMATCH"]),
  nsct: new Set(["NSCT_DECISION_MISSING", "NSCT_EVIDENCE_STALE", "NSCT_MODE_NOT_ADVISORY",
    "NSCT_MULTIPLE_PLAN_HEADS_AS_OF", "NSCT_STORE_NOT_READY", "NSCT_STORE_UNAVAILABLE",
    "NSCT_VERIFICATION_FAILED", "NSCT_VERIFIER_UNAVAILABLE"]),
  runtime_state: new Set(["ADAPTER_NOT_WIRED_V1"]),
  security_intelligence: new Set(["SECURITY_OBSERVATION_EXPIRED",
    "SECURITY_OBSERVATION_ADMISSION_REJECTED", "SECURITY_OBSERVATION_DIGEST_MISMATCH",
    "SECURITY_OBSERVATION_FRESHNESS_INVALID",
    "SECURITY_OBSERVATION_MISSING"]),
  shared_memory: new Set(["ADAPTER_NOT_WIRED_V1"]),
  universal_core: new Set(["AUTHORITY_SELF_CORROBORATION_EXCLUDED_V1"]),
  work_continuity: new Set(["CANONICAL_GALLERY_IDENTITY_REQUIRED", "WORK_NOT_FOUND",
    "WORK_PROJECT_LINKAGE_CONFLICT"]),
});
const ENTITY_360_FORBIDDEN_METADATA_KEYS = new Set([
  "allow", "authority", "authority_scope", "authorization", "authorized", "core_verdict",
  "deploy", "execution", "execution_allowed", "execution_authorized", "merge", "publish",
  "production_decision_mutation", "verdict",
]);
const QUALIFICATION_MANIFEST_KEYS = Object.freeze([
  "manifest_digest", "schema_version", "source_contributions", "source_rejections",
]);
const QUALIFICATION_CONTRIBUTION_KEYS = Object.freeze([
  "adapter_version", "confidence", "contribution_digest", "evidence_class", "evidence_digests",
  "evidence_refs", "facts", "independence_group", "observed_at", "recorded_at", "source_class",
  "source_id", "source_watermark", "trust_boundary", "trust_class",
]);
const QUALIFICATION_CLAIM_KEYS = Object.freeze([
  "authoritative", "bytes", "claim_id", "confidence", "criticality", "declared_state",
  "derived_source", "evidence_class", "evidence_digests", "evidence_refs", "fact_id",
  "independence_group", "observed_at", "recorded_at", "source_class", "source_id",
  "source_watermark", "supersedes_claim_id", "tombstone", "tokens", "trust_boundary",
  "trust_class", "valid_from", "valid_to", "value_digest",
]);
const QUALIFICATION_REJECTION_KEYS = Object.freeze([
  "adapter_version", "reason_codes", "source_id", "status",
]);
const QUALIFICATION_FACT_CONTRACT_REJECTION_KEYS = Object.freeze([
  ...QUALIFICATION_REJECTION_KEYS, "rejected_fact_ids", "rejection_digest",
]);
const ASSEMBLY_REPORT_KEYS = Object.freeze([
  "admitted_claim_count", "decisions", "limited_source_contribution_count",
  "occupancy", "rejected_source_contribution_count",
]);
const OCCUPANCY_DECISION_KEYS = Object.freeze([
  "accepted_claim_ids", "contribution_digest", "reason_codes", "rejected_claim_ids", "source_id",
  "status",
]);
const SNAPSHOT_IDENTITY_KEYS = Object.freeze([
  "candidate_entity_ids", "canonical", "missing_disambiguation", "resolution_status",
]);
const QUALIFICATION_ATTESTATION_KEYS = Object.freeze([
  "algorithm", "key_id", "payload_digest", "purpose", "schema_version", "semantic_digest",
  "signature", "signer_domain",
]);

export class Entity360Error extends Error {
  constructor(code, status = 422, details = undefined) {
    super(code);
    this.name = "Entity360Error";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, status = 422, details) {
  throw new Entity360Error(code, status, details);
}

function plainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  return value;
}

function text(value, code, max = 240, pattern = null) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || pattern && !pattern.test(normalized)) fail(code);
  return normalized;
}

function optionalText(value, code, max = 240, pattern = null) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, code, max, pattern);
}

function finiteNumber(value, code, { minimum = 0, maximum = 1 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) fail(code);
  return numeric;
}

function positiveInteger(value, code, maximum = MAX_SAFE_BUDGET) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > maximum) fail(code);
  return numeric;
}

function nonNegativeInteger(value, code, maximum = MAX_SAFE_BUDGET) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > maximum) fail(code);
  return numeric;
}

function timestamp(value, code) {
  const milliseconds = Date.parse(String(value ?? ""));
  if (!Number.isFinite(milliseconds)) fail(code);
  return new Date(milliseconds).toISOString();
}

function canonicalRfc3339Timestamp(value, code) {
  if (typeof value !== "string" || !CANONICAL_RFC3339.test(value)) fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) fail(code);
  return value;
}

function optionalTimestamp(value, code) {
  if (value === null || value === undefined || value === "") return null;
  return timestamp(value, code);
}

function normalizedIdentityValue(value) {
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value).normalize("NFKC").trim().toLocaleLowerCase("en-US");
  }
  fail("entity360_identity_value_invalid");
}

function stable(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("entity360_canonical_value_invalid");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64url");
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("entity360_canonical_value_circular");
    seen.add(value);
    const result = value.map((item) => stable(item, seen));
    seen.delete(value);
    return result;
  }
  if (!value || typeof value !== "object") fail("entity360_canonical_value_invalid");
  if (seen.has(value)) fail("entity360_canonical_value_circular");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("entity360_canonical_value_invalid");
  seen.add(value);
  const result = Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("entity360_canonical_key_forbidden");
      return [key, stable(value[key], seen)];
    }));
  seen.delete(value);
  return result;
}

function stableString(value) {
  return JSON.stringify(stable(value));
}

function exactKeys(value, expected, code) {
  const source = plainObject(value, code);
  const actualKeys = Object.keys(source).sort();
  if (stableString(actualKeys) !== stableString([...expected].sort())) fail(code);
  return source;
}

function forbiddenMetadataKey(key) {
  return ENTITY_360_FORBIDDEN_METADATA_KEYS.has(String(key).trim().toLowerCase().replaceAll("-", "_"));
}

function assertContextValueHasNoAuthorityKeys(value, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) fail("entity360_fact_value_cycle_invalid");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertContextValueHasNoAuthorityKeys(item, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenMetadataKey(key)) fail("entity360_fact_authority_key_forbidden", 403);
      assertContextValueHasNoAuthorityKeys(item, seen);
    }
  }
  seen.delete(value);
}

function lexical(left, right) {
  const a = String(left); const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalSet(values) {
  return [...new Map(values.map((value) => [stableString(value), stable(value)])).values()]
    .sort((left, right) => lexical(stableString(left), stableString(right)));
}

function orderedUnique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = stableString(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export function entity360Digest(value) {
  return crypto.createHash(ENTITY_360_DIGEST_ALGORITHM).update(stableString(value)).digest("hex");
}

function normalizeIdentity(identity) {
  const source = plainObject(identity, "entity360_identity_required");
  const entries = Object.entries(source);
  if (!entries.length || entries.length > 32) fail("entity360_identity_invalid");
  return Object.fromEntries(entries.map(([key, value]) => {
    const normalizedKey = text(key, "entity360_identity_key_invalid", 120, SOURCE_ID);
    if (forbiddenMetadataKey(normalizedKey)) fail("entity360_identity_authority_key_forbidden");
    return [normalizedKey, normalizedIdentityValue(value)];
  }).sort(([left], [right]) => lexical(left, right)));
}

export function deterministicEntity360Id({ tenant_id, entity_type, identity } = {}) {
  const tenantId = text(tenant_id, "entity360_tenant_required", 120, SOURCE_ID);
  const entityType = text(entity_type, "entity360_entity_type_required", 80, ENTITY_TYPE);
  const canonicalIdentity = normalizeIdentity(identity);
  return `e360_${entity360Digest({ tenant_id: tenantId, entity_type: entityType, identity: canonicalIdentity }).slice(0, 48)}`;
}

export const BASE_ENTITY_360_ONTOLOGY = deepFreeze({
  schema_version: ENTITY_360_ONTOLOGY_VERSION,
  ontology_version: ENTITY_360_ONTOLOGY_VERSION,
  kernel_compatibility: ENTITY_360_KERNEL_COMPATIBILITY,
  entity_types: [
    { type: "work", projection: "work_360", extension: false },
    { type: "software_component", projection: "software_component_360", extension: false },
  ],
  relationship_types: [
    "contains", "depends_on", "relates_to", "supersedes", "produced_by", "bound_to", "observed_by",
  ],
  state_classes: ENTITY_360_TEMPORAL_STATES,
  transition_classes: ["observed", "confirmed", "superseded", "invalidated", "reconciled"],
  dependency_classes: ["runtime", "architecture", "data", "policy", "work", "provider"],
  policy_binding_classes: ["genesis", "intent", "icf", "nsct", "security", "core"],
  evidence_classes: ["authoritative_record", "verified_observation", "event", "memory", "analysis", "runtime_observation"],
  source_classes: ["governance", "continuity", "architecture", "cognition", "runtime", "memory", "security", "event_ledger"],
  trust_boundaries: ["core_internal", "tenant_internal", "provider", "external", "untrusted"],
  temporal_semantics: ["valid_time", "recorded_time", "as_of", "superseded_by", "tombstone"],
  extension_contract: {
    mode: "declarative_registry_adapter",
    kernel_modification_required: false,
    compatibility: "additive_minor_breaking_major",
  },
});

export function compileEntity360Ontology(input = BASE_ENTITY_360_ONTOLOGY) {
  const source = exactKeys(input,
    ["dependency_classes", "entity_types", "evidence_classes", "extension_contract",
      "kernel_compatibility", "ontology_version", "policy_binding_classes", "relationship_types",
      "schema_version", "source_classes", "state_classes", "temporal_semantics",
      "transition_classes", "trust_boundaries"],
    "entity360_ontology_schema_invalid");
  if (source.schema_version !== ENTITY_360_ONTOLOGY_VERSION) {
    fail("entity360_ontology_schema_invalid");
  }
  if (source.kernel_compatibility !== ENTITY_360_KERNEL_COMPATIBILITY) {
    fail("entity360_kernel_compatibility_invalid");
  }
  const ontologyVersion = text(source.ontology_version,
    "entity360_ontology_version_invalid", 160, SOURCE_ID);
  if (ontologyVersion !== ENTITY_360_ONTOLOGY_VERSION
    && !ontologyVersion.startsWith(`${ENTITY_360_ONTOLOGY_VERSION}_`)) {
    fail("entity360_ontology_version_incompatible");
  }
  if (!Array.isArray(source.entity_types) || source.entity_types.length > 256) {
    fail("entity360_ontology_entity_types_invalid");
  }
  const types = canonicalSet(source.entity_types.map((item) => {
    const candidate = typeof item === "string" ? { type: item, projection: undefined, extension: undefined }
      : exactKeys(item, ["extension", "projection", "type"], "entity360_entity_type_schema_invalid");
    return {
      type: text(candidate.type, "entity360_entity_type_invalid", 80, ENTITY_TYPE),
      projection: optionalText(candidate.projection, "entity360_projection_invalid", 120, SOURCE_ID),
      extension: candidate.extension === true,
    };
  }));
  if (!types.length) fail("entity360_ontology_entity_types_required");
  if (new Set(types.map((item) => item.type)).size !== types.length) {
    fail("entity360_ontology_entity_type_duplicate");
  }
  const stringSet = (name, maximum = 256) => {
    if (!Array.isArray(source[name]) || source[name].length > maximum) {
      fail(`entity360_${name}_invalid`);
    }
    return canonicalSet(source[name].map((item) =>
      text(item, `entity360_${name}_invalid`, 120, SOURCE_ID)));
  };
  const extensionContract = exactKeys(source.extension_contract,
    ["compatibility", "kernel_modification_required", "mode"],
    "entity360_ontology_extension_contract_invalid");
  if (extensionContract.mode !== BASE_ENTITY_360_ONTOLOGY.extension_contract.mode
    || extensionContract.kernel_modification_required !== false
    || extensionContract.compatibility !== BASE_ENTITY_360_ONTOLOGY.extension_contract.compatibility) {
    fail("entity360_ontology_extension_contract_invalid");
  }
  const compiled = {
    schema_version: ENTITY_360_ONTOLOGY_VERSION,
    ontology_version: ontologyVersion,
    kernel_compatibility: ENTITY_360_KERNEL_COMPATIBILITY,
    entity_types: types,
    relationship_types: stringSet("relationship_types"),
    state_classes: stringSet("state_classes"),
    transition_classes: stringSet("transition_classes"),
    dependency_classes: stringSet("dependency_classes"),
    policy_binding_classes: stringSet("policy_binding_classes"),
    evidence_classes: stringSet("evidence_classes"),
    source_classes: stringSet("source_classes"),
    trust_boundaries: stringSet("trust_boundaries"),
    temporal_semantics: stringSet("temporal_semantics"),
    extension_contract: stable(extensionContract),
  };
  const vocabularyFields = ["entity_types", "relationship_types", "state_classes",
    "transition_classes", "dependency_classes", "policy_binding_classes", "evidence_classes",
    "source_classes", "trust_boundaries", "temporal_semantics"];
  for (const field of vocabularyFields) {
    const baseVocabulary = canonicalSet(BASE_ENTITY_360_ONTOLOGY[field]);
    const compiledVocabulary = compiled[field];
    if (ontologyVersion === ENTITY_360_ONTOLOGY_VERSION) {
      if (stableString(compiledVocabulary) !== stableString(baseVocabulary)) {
        fail("entity360_ontology_base_vocabulary_invalid", 422, { vocabulary: field });
      }
      continue;
    }
    const compiledKeys = new Set(compiledVocabulary.map((item) => stableString(item)));
    if (baseVocabulary.some((item) => !compiledKeys.has(stableString(item)))) {
      fail("entity360_ontology_extension_base_vocabulary_invalid", 422,
        { vocabulary: field });
    }
  }
  return deepFreeze(compiled);
}

function compileBudget(raw, prefix) {
  const source = plainObject(raw, `${prefix}_invalid`);
  return {
    max_contributions: positiveInteger(source.max_contributions, `${prefix}_max_contributions_invalid`),
    max_evidence: positiveInteger(source.max_evidence, `${prefix}_max_evidence_invalid`),
    max_bytes: positiveInteger(source.max_bytes, `${prefix}_max_bytes_invalid`),
    max_tokens: positiveInteger(source.max_tokens, `${prefix}_max_tokens_invalid`),
  };
}

function compileBudgetMap(raw, prefix) {
  const source = plainObject(raw, `${prefix}_invalid`);
  const entries = Object.entries(source);
  if (!entries.length || entries.length > 256) fail(`${prefix}_invalid`);
  return Object.fromEntries(entries.map(([key, value]) => [
    text(key, `${prefix}_key_invalid`, 160, SOURCE_ID),
    compileBudget(value, `${prefix}_entry`),
  ]).sort(([left], [right]) => lexical(left, right)));
}

function compileSourceRegistry(raw) {
  const list = Array.isArray(raw) ? raw
    : Object.values(plainObject(raw, "entity360_source_registry_required"));
  if (!list.length || list.length > 256) fail("entity360_source_registry_invalid");
  const entries = list.map((item) => {
    const source = plainObject(item, "entity360_source_registry_entry_invalid");
    const adapterVersions = canonicalSet((source.adapter_versions || []).map((version) =>
      text(version, "entity360_adapter_version_invalid", 120, SOURCE_ID)));
    if (!adapterVersions.length) fail("entity360_adapter_versions_required");
    const allowedFactPrefixes = canonicalSet((source.allowed_fact_prefixes || []).map((prefix) =>
      text(prefix, "entity360_allowed_fact_prefix_invalid", 160, SOURCE_ID)));
    if (!allowedFactPrefixes.length) fail("entity360_allowed_fact_prefixes_required");
    const blockingConflictFactPrefixes = canonicalSet((source.blocking_conflict_fact_prefixes || [])
      .map((prefix) => text(prefix, "entity360_blocking_conflict_fact_prefix_invalid", 160, SOURCE_ID)));
    if (blockingConflictFactPrefixes.some((prefix) => !allowedFactPrefixes.some((allowed) =>
      prefix === allowed || prefix.startsWith(`${allowed}.`)))) {
      fail("entity360_blocking_conflict_fact_prefix_not_allowed");
    }
    return {
      source_id: text(source.source_id, "entity360_source_id_invalid", 160, SOURCE_ID),
      source_class: text(source.source_class, "entity360_source_class_invalid", 120, SOURCE_ID),
      trust_class: text(source.trust_class, "entity360_trust_class_invalid", 120, SOURCE_ID),
      trust_boundary: text(source.trust_boundary, "entity360_trust_boundary_invalid", 120, SOURCE_ID),
      independence_group: text(source.independence_group, "entity360_independence_group_invalid", 160, SOURCE_ID),
      adapter_versions: adapterVersions,
      allowed_fact_prefixes: allowedFactPrefixes,
      blocking_conflict_fact_prefixes: blockingConflictFactPrefixes,
      authoritative: source.authoritative === true,
      authoritative_fact_prefixes: canonicalSet((source.authoritative_fact_prefixes || []).map((prefix) =>
        text(prefix, "entity360_authoritative_fact_prefix_invalid", 160, SOURCE_ID))),
      derived: source.derived === true,
      valid_from: optionalTimestamp(source.valid_from, "entity360_source_valid_from_invalid"),
      valid_until: optionalTimestamp(source.valid_until, "entity360_source_valid_until_invalid"),
      revoked: source.revoked === true,
    };
  });
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.source_id)) fail("entity360_source_registry_duplicate");
    byId.set(entry.source_id, entry);
  }
  return Object.fromEntries([...byId.entries()].sort(([left], [right]) => lexical(left, right)));
}

function factPrefixAllowed(prefixes, factId) {
  return prefixes.some((prefix) => factId === prefix || factId.startsWith(`${prefix}.`));
}

function compileRequirements(raw = {}) {
  const source = plainObject(raw, "entity360_required_context_invalid");
  return Object.fromEntries(Object.entries(source).map(([entityType, requirements]) => {
    const normalizedType = text(entityType, "entity360_requirement_entity_type_invalid", 80, ENTITY_TYPE);
    if (!Array.isArray(requirements) || requirements.length > 256) fail("entity360_requirements_invalid");
    return [normalizedType, canonicalSet(requirements.map((item) => {
      const requirement = plainObject(item, "entity360_requirement_invalid");
      const mandatory = requirement.mandatory !== false;
      const highImpact = requirement.high_impact === true;
      if (highImpact && !mandatory) {
        fail("entity360_high_impact_requirement_must_be_mandatory", 422, {
          requirement_id: String(requirement.requirement_id || "").slice(0, 160),
        });
      }
      return {
        requirement_id: text(requirement.requirement_id, "entity360_requirement_id_invalid", 160, SOURCE_ID),
        fact_id: text(requirement.fact_id, "entity360_requirement_fact_invalid", 160, SOURCE_ID),
        evidence_class: optionalText(requirement.evidence_class, "entity360_requirement_evidence_class_invalid", 120, SOURCE_ID),
        source_class: optionalText(requirement.source_class, "entity360_requirement_source_class_invalid", 120, SOURCE_ID),
        mandatory,
        high_impact: highImpact,
        authoritative_required: requirement.authoritative_required === true,
      };
    }))];
  }).sort(([left], [right]) => lexical(left, right)));
}

function compileTemporalReconciliationPolicy(raw, sourceRegistry) {
  const source = raw === undefined ? {} : plainObject(raw,
    "entity360_temporal_reconciliation_policy_invalid");
  if (source.schema_version !== undefined
    && source.schema_version !== ENTITY_360_TEMPORAL_POLICY_SCHEMA_VERSION) {
    fail("entity360_temporal_reconciliation_policy_schema_invalid");
  }
  const transitions = Array.isArray(source.authority_transitions)
    ? source.authority_transitions : source.authority_transitions === undefined ? []
      : fail("entity360_authority_transitions_invalid");
  if (transitions.length > 256) fail("entity360_authority_transitions_invalid");
  return {
    schema_version: ENTITY_360_TEMPORAL_POLICY_SCHEMA_VERSION,
    authority_transitions: canonicalSet(transitions.map((rawTransition) => {
      const transition = exactKeys(rawTransition,
        ["fact_prefixes", "from_source_id", "to_source_id", "transition_id"],
        "entity360_authority_transition_schema_invalid");
      const fromSourceId = text(transition.from_source_id,
        "entity360_authority_transition_source_invalid", 160, SOURCE_ID);
      const toSourceId = text(transition.to_source_id,
        "entity360_authority_transition_source_invalid", 160, SOURCE_ID);
      if (!sourceRegistry[fromSourceId] || !sourceRegistry[toSourceId]
        || !sourceRegistry[fromSourceId].authoritative || sourceRegistry[fromSourceId].derived
        || !sourceRegistry[toSourceId].authoritative || sourceRegistry[toSourceId].derived) {
        fail("entity360_authority_transition_source_invalid");
      }
      if (!Array.isArray(transition.fact_prefixes) || !transition.fact_prefixes.length) {
        fail("entity360_authority_transition_fact_prefixes_invalid");
      }
      return {
        transition_id: text(transition.transition_id,
          "entity360_authority_transition_id_invalid", 160, SOURCE_ID),
        from_source_id: fromSourceId,
        to_source_id: toSourceId,
        fact_prefixes: canonicalSet(transition.fact_prefixes.map((prefix) =>
          text(prefix, "entity360_authority_transition_fact_prefix_invalid", 160, SOURCE_ID))),
      };
    })),
  };
}

function compileShadowObservationPolicy(raw) {
  const source = exactKeys(raw,
    ["gate_timeout_ms", "max_cached_tenant_gates", "max_gate_inflight_global", "max_inflight_global",
      "max_inflight_per_tenant", "max_starts_per_tenant_window", "max_starts_per_window",
      "max_tracked_tenants", "max_tracked_work_keys", "minimum_interval_ms", "schema_version",
      "tenant_off_gate_cache_ttl_ms", "window_ms"],
    "entity360_shadow_observation_policy_schema_invalid");
  if (source.schema_version !== ENTITY_360_SHADOW_OBSERVATION_POLICY_SCHEMA_VERSION) {
    fail("entity360_shadow_observation_policy_schema_invalid");
  }
  const compiled = {
    schema_version: ENTITY_360_SHADOW_OBSERVATION_POLICY_SCHEMA_VERSION,
    minimum_interval_ms: nonNegativeInteger(source.minimum_interval_ms,
      "entity360_shadow_observation_interval_invalid", 3_600_000),
    max_inflight_global: positiveInteger(source.max_inflight_global,
      "entity360_shadow_observation_inflight_invalid", 64),
    max_inflight_per_tenant: positiveInteger(source.max_inflight_per_tenant,
      "entity360_shadow_observation_tenant_inflight_invalid", 64),
    window_ms: positiveInteger(source.window_ms,
      "entity360_shadow_observation_window_invalid", 3_600_000),
    max_starts_per_window: positiveInteger(source.max_starts_per_window,
      "entity360_shadow_observation_rate_invalid", 10_000),
    max_starts_per_tenant_window: positiveInteger(source.max_starts_per_tenant_window,
      "entity360_shadow_observation_tenant_rate_invalid", 10_000),
    max_tracked_work_keys: positiveInteger(source.max_tracked_work_keys,
      "entity360_shadow_observation_tracking_invalid", 100_000),
    max_tracked_tenants: positiveInteger(source.max_tracked_tenants,
      "entity360_shadow_observation_tenant_tracking_invalid", 100_000),
    max_gate_inflight_global: positiveInteger(source.max_gate_inflight_global,
      "entity360_shadow_observation_gate_inflight_invalid", 1_000),
    max_cached_tenant_gates: positiveInteger(source.max_cached_tenant_gates,
      "entity360_shadow_observation_gate_cache_tracking_invalid", 100_000),
    tenant_off_gate_cache_ttl_ms: positiveInteger(source.tenant_off_gate_cache_ttl_ms,
      "entity360_shadow_observation_gate_cache_ttl_invalid", 60_000),
    gate_timeout_ms: positiveInteger(source.gate_timeout_ms,
      "entity360_shadow_observation_gate_timeout_invalid", 60_000),
  };
  if (compiled.max_inflight_per_tenant > compiled.max_inflight_global
    || compiled.max_starts_per_tenant_window > compiled.max_starts_per_window) {
    fail("entity360_shadow_observation_tenant_budget_invalid");
  }
  if (compiled.max_gate_inflight_global < 2) {
    fail("entity360_shadow_observation_gate_fairness_invalid");
  }
  return compiled;
}

export function compileEntity360Policy(input) {
  const rawPolicy = plainObject(input, "entity360_policy_required");
  const claimedPolicyDigest = rawPolicy.policy_digest === undefined ? null
    : text(rawPolicy.policy_digest, "entity360_policy_digest_invalid", 64, SHA256);
  const { policy_digest: _claimedDigest, ...policySource } = rawPolicy;
  const source = exactKeys(policySource,
    ["budgets", "corroboration", "freshness", "mode", "policy_version", "required_context",
      "schema_version", "shadow_observation", "source_registry", "temporal_reconciliation",
      "trust_order"],
    "entity360_policy_schema_invalid");
  if (source.schema_version !== ENTITY_360_POLICY_SCHEMA_VERSION) fail("entity360_policy_schema_invalid");
  const budgets = plainObject(source.budgets, "entity360_budgets_required");
  const trustOrder = orderedUnique((source.trust_order || []).map((item) =>
    text(item, "entity360_trust_order_invalid", 120, SOURCE_ID)));
  if (!trustOrder.length) fail("entity360_trust_order_required");
  const freshness = plainObject(source.freshness, "entity360_freshness_policy_required");
  const corroboration = exactKeys(source.corroboration,
    ["allow_verified_authoritative", "default_min_independent_sources",
      "high_impact_eligible_trust_classes", "high_impact_min_independent_sources"],
    "entity360_corroboration_policy_schema_invalid");
  if (!Array.isArray(corroboration.high_impact_eligible_trust_classes)
    || !corroboration.high_impact_eligible_trust_classes.length) {
    fail("entity360_high_impact_eligible_trust_classes_required");
  }
  const highImpactEligibleTrustClasses = canonicalSet(
    corroboration.high_impact_eligible_trust_classes.map((item) =>
      text(item, "entity360_high_impact_eligible_trust_class_invalid", 120, SOURCE_ID)));
  if (highImpactEligibleTrustClasses.includes("advisory")) {
    fail("entity360_high_impact_advisory_trust_forbidden");
  }
  const sourceRegistry = compileSourceRegistry(source.source_registry);
  const compiled = {
    schema_version: ENTITY_360_POLICY_SCHEMA_VERSION,
    policy_version: text(source.policy_version, "entity360_policy_version_invalid", 160, SOURCE_ID),
    mode: text(source.mode, "entity360_policy_mode_invalid", 20).toUpperCase(),
    source_registry: sourceRegistry,
    trust_order: trustOrder,
    budgets: {
      max_sources: positiveInteger(budgets.max_sources, "entity360_max_sources_invalid", 10_000),
      max_entities: positiveInteger(budgets.max_entities, "entity360_max_entities_invalid", 100_000),
      max_evidence: positiveInteger(budgets.max_evidence, "entity360_max_evidence_invalid"),
      max_relationship_depth: nonNegativeInteger(budgets.max_relationship_depth,
        "entity360_max_relationship_depth_invalid", 32),
      max_retrieval_bytes: positiveInteger(budgets.max_retrieval_bytes, "entity360_max_retrieval_bytes_invalid"),
      max_context_tokens: positiveInteger(budgets.max_context_tokens, "entity360_max_context_tokens_invalid"),
      per_source: compileBudgetMap(budgets.per_source, "entity360_per_source_budget"),
      per_source_class: compileBudgetMap(budgets.per_source_class, "entity360_per_source_class_budget"),
      per_trust_class: compileBudgetMap(budgets.per_trust_class, "entity360_per_trust_class_budget"),
    },
    freshness: {
      default_max_age_seconds: positiveInteger(freshness.default_max_age_seconds,
        "entity360_default_freshness_invalid", 31_536_000),
      max_clock_skew_seconds: nonNegativeInteger(freshness.max_clock_skew_seconds,
        "entity360_clock_skew_invalid", 86_400),
      by_source_class: Object.fromEntries(Object.entries(plainObject(freshness.by_source_class || {},
        "entity360_freshness_classes_invalid")).map(([key, value]) => [
        text(key, "entity360_freshness_class_invalid", 120, SOURCE_ID),
        positiveInteger(value, "entity360_freshness_value_invalid", 31_536_000),
      ]).sort(([left], [right]) => lexical(left, right))),
    },
    corroboration: {
      default_min_independent_sources: positiveInteger(corroboration.default_min_independent_sources,
        "entity360_corroboration_minimum_invalid", 32),
      high_impact_min_independent_sources: positiveInteger(corroboration.high_impact_min_independent_sources,
        "entity360_high_impact_corroboration_invalid", 32),
      high_impact_eligible_trust_classes: highImpactEligibleTrustClasses,
      allow_verified_authoritative: corroboration.allow_verified_authoritative === true,
    },
    shadow_observation: compileShadowObservationPolicy(source.shadow_observation),
    temporal_reconciliation: compileTemporalReconciliationPolicy(source.temporal_reconciliation,
      sourceRegistry),
    required_context: compileRequirements(source.required_context || {}),
    policy_digest: null,
  };
  if (!new Set(["SHADOW", "ADVISORY"]).has(compiled.mode)) fail("entity360_policy_mode_invalid");
  const sourceClasses = new Set(Object.values(compiled.source_registry).map((item) => item.source_class));
  const trustClasses = new Set(Object.values(compiled.source_registry).map((item) => item.trust_class));
  for (const sourceClass of sourceClasses) if (!compiled.budgets.per_source_class[sourceClass]
    && !compiled.budgets.per_source_class.default) fail("entity360_source_class_budget_missing", 422, { source_class: sourceClass });
  for (const trustClass of trustClasses) if (!compiled.budgets.per_trust_class[trustClass]
    && !compiled.budgets.per_trust_class.default) fail("entity360_trust_class_budget_missing", 422, { trust_class: trustClass });
  for (const trustClass of trustClasses) if (!compiled.trust_order.includes(trustClass)) {
    fail("entity360_trust_class_order_missing", 422, { trust_class: trustClass });
  }
  for (const trustClass of compiled.corroboration.high_impact_eligible_trust_classes) {
    if (!trustClasses.has(trustClass) || !compiled.trust_order.includes(trustClass)) {
      fail("entity360_high_impact_eligible_trust_class_invalid", 422, { trust_class: trustClass });
    }
  }
  compiled.policy_digest = entity360Digest({ ...compiled, policy_digest: null });
  if (claimedPolicyDigest && claimedPolicyDigest !== compiled.policy_digest) {
    fail("entity360_policy_digest_mismatch", 409);
  }
  return deepFreeze(compiled);
}

function identityMatches(candidateIdentity, requestedIdentity, entityType) {
  const candidate = normalizeIdentity(candidateIdentity);
  return Object.entries(requestedIdentity).every(([key, value]) => {
    if (entityType === "work" && key === "work_id") {
      return candidate.work_id === value || candidate.legacy_work_id === value;
    }
    if (entityType === "work" && key === "legacy_work_id") {
      return candidate.legacy_work_id === value;
    }
    return candidate[key] === value;
  });
}

function ambiguousIdentityKeys(matches) {
  const keys = [...new Set(matches.flatMap((item) => Object.keys(item.identity)))].sort();
  const differing = keys.filter((key) => new Set(matches.map((item) =>
    stableString(item.identity[key]))).size > 1);
  return differing.length ? differing : ["entity_id"];
}

export function resolveEntity360Identity(input = {}) {
  const tenantId = text(input.tenant_id, "entity360_tenant_required", 120, SOURCE_ID);
  const entityType = text(input.entity_type, "entity360_entity_type_required", 80, ENTITY_TYPE);
  const identity = normalizeIdentity(input.identity);
  const derivedId = deterministicEntity360Id({ tenant_id: tenantId, entity_type: entityType, identity });
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const matches = [];
  for (const raw of candidates) {
    const candidate = plainObject(raw, "entity360_resolution_candidate_invalid");
    if (candidate.tenant_id !== tenantId) fail("entity360_cross_tenant_resolution_candidate", 403);
    if (candidate.entity_type !== entityType) continue;
    if (!identityMatches(candidate.identity, identity, entityType)) continue;
    const candidateId = deterministicEntity360Id(candidate);
    if (candidate.entity_id && candidate.entity_id !== candidateId) fail("entity360_candidate_identity_collision", 409);
    matches.push({ entity_id: candidateId, identity: normalizeIdentity(candidate.identity) });
  }
  const uniqueMatches = canonicalSet(matches);
  const scopedId = uniqueMatches.length === 1 ? uniqueMatches[0].entity_id : derivedId;
  if (input.entity_id && input.entity_id !== scopedId) fail("entity360_entity_id_scope_mismatch", 403);
  if (uniqueMatches.length > 1) return deepFreeze({
    schema_version: "entity_360_resolution_v1",
    status: "AMBIGUOUS",
    tenant_scope: tenantId,
    entity_type: entityType,
    entity_id: null,
    identity,
    candidates: uniqueMatches.map((item) => item.entity_id),
    missing_disambiguation: ambiguousIdentityKeys(uniqueMatches),
    execution_authorized: false,
  });
  if (input.require_existing === true && uniqueMatches.length === 0) return deepFreeze({
    schema_version: "entity_360_resolution_v1",
    status: "UNRESOLVED",
    tenant_scope: tenantId,
    entity_type: entityType,
    entity_id: null,
    identity,
    candidates: [],
    missing_disambiguation: ["authoritative_identity_match"],
    execution_authorized: false,
  });
  return deepFreeze({
    schema_version: "entity_360_resolution_v1",
    status: "RESOLVED",
    tenant_scope: tenantId,
    entity_type: entityType,
    entity_id: uniqueMatches[0]?.entity_id || derivedId,
    identity: uniqueMatches[0]?.identity || identity,
    candidates: uniqueMatches.map((item) => item.entity_id),
    missing_disambiguation: [],
    execution_authorized: false,
  });
}

function identityLineageDigest(value) {
  return entity360Digest(value);
}

function normalizedIdentityLineageDigest(value, code) {
  return text(value, code, 64, SHA256).toLowerCase();
}

function normalizeIdentityLineageMember(value, { tenantId, entityType, code } = {}) {
  const source = exactKeys(value, ENTITY_360_IDENTITY_LINEAGE_MEMBER_FIELDS, code);
  const identity = normalizeIdentity(source.identity);
  const entityId = deterministicEntity360Id({ tenant_id: tenantId, entity_type: entityType, identity });
  if (source.entity_id !== entityId) fail("entity360_identity_lineage_contradiction", 409);
  const identityDigest = entity360Digest(identity);
  if (source.identity_digest !== identityDigest) fail("entity360_identity_lineage_contradiction", 409);
  return { entity_id: entityId, identity, identity_digest: identityDigest };
}

function createIdentityLineageMember({ tenantId, entityType, identity } = {}) {
  const canonicalIdentity = normalizeIdentity(identity);
  return {
    entity_id: deterministicEntity360Id({ tenant_id: tenantId, entity_type: entityType,
      identity: canonicalIdentity }),
    identity: canonicalIdentity,
    identity_digest: entity360Digest(canonicalIdentity),
  };
}

function canonicalIdentityLineageMembers(values, { tenantId, entityType, allowEmpty = false,
  code = "entity360_identity_lineage_members_invalid" } = {}) {
  if (!Array.isArray(values) || values.length > 32 || !allowEmpty && values.length === 0) fail(code);
  const members = values.map((value) => createIdentityLineageMember({ tenantId, entityType,
    identity: value }));
  const unique = new Map();
  for (const member of members) {
    if (unique.has(member.entity_id)) fail("entity360_identity_lineage_ambiguous", 409);
    unique.set(member.entity_id, member);
  }
  return [...unique.values()].sort((left, right) => lexical(left.entity_id, right.entity_id));
}

function normalizedPublishedIdentityLineageMembers(values, { tenantId, entityType, allowEmpty = false,
  code = "entity360_identity_lineage_members_invalid" } = {}) {
  if (!Array.isArray(values) || values.length > 32 || !allowEmpty && values.length === 0) fail(code);
  const members = values.map((value) => normalizeIdentityLineageMember(value, { tenantId, entityType,
    code }));
  const unique = new Map();
  for (const member of members) {
    if (unique.has(member.entity_id)) fail("entity360_identity_lineage_ambiguous", 409);
    unique.set(member.entity_id, member);
  }
  const canonical = [...unique.values()].sort((left, right) => lexical(left.entity_id, right.entity_id));
  if (stableString(members) !== stableString(canonical)) {
    fail("entity360_identity_lineage_members_not_canonical", 409);
  }
  return canonical;
}

function assertIdentityLineageMembersDistinct(canonical, members) {
  if (members.some((member) => member.entity_id === canonical.entity_id)) {
    fail("entity360_identity_lineage_ambiguous", 409);
  }
}

function identityLineageBody({ operation, tenantId, entityType, canonicalEntity, absorbedEntities,
  restoredEntities, observedAt, evidenceDigest, idempotencyKey, predecessorLineageDigest,
  reversesLineageDigest } = {}) {
  return {
    schema_version: ENTITY_360_IDENTITY_LINEAGE_SCHEMA_VERSION,
    mode: ENTITY_360_IDENTITY_LINEAGE_MODE,
    operation,
    tenant_scope: tenantId,
    entity_type: entityType,
    canonical_entity: canonicalEntity,
    absorbed_entities: absorbedEntities,
    restored_entities: restoredEntities,
    observed_at: observedAt,
    evidence_digest: evidenceDigest,
    idempotency_key: idempotencyKey,
    predecessor_lineage_digest: predecessorLineageDigest,
    reverses_lineage_digest: reversesLineageDigest,
    execution_authorized: false,
    production_decision_mutation: false,
  };
}

function issueIdentityLineage(body) {
  const lineageId = `e360il_${identityLineageDigest(body).slice(0, 48)}`;
  const auditDigest = identityLineageDigest({ ...body, lineage_id: lineageId });
  return deepFreeze({ ...body, lineage_id: lineageId, audit_digest: auditDigest });
}

function normalizeIdentityLineageInput(input, fields, code) {
  return exactKeys(plainObject(input, code), fields, code);
}

function normalizePublishedIdentityLineage(value) {
  const source = exactKeys(value, ENTITY_360_IDENTITY_LINEAGE_ROOT_FIELDS,
    "entity360_identity_lineage_schema_invalid");
  if (source.schema_version !== ENTITY_360_IDENTITY_LINEAGE_SCHEMA_VERSION
    || source.mode !== ENTITY_360_IDENTITY_LINEAGE_MODE
    || !ENTITY_360_IDENTITY_LINEAGE_OPERATIONS.has(source.operation)
    || source.execution_authorized !== false
    || source.production_decision_mutation !== false) {
    fail("entity360_identity_lineage_schema_invalid");
  }
  const tenantId = text(source.tenant_scope, "entity360_identity_lineage_tenant_required", 120, SOURCE_ID);
  const entityType = text(source.entity_type, "entity360_identity_lineage_entity_type_required", 80,
    ENTITY_TYPE);
  const canonicalEntity = normalizeIdentityLineageMember(source.canonical_entity, { tenantId, entityType,
    code: "entity360_identity_lineage_canonical_entity_invalid" });
  const absorbedEntities = normalizedPublishedIdentityLineageMembers(source.absorbed_entities,
    { tenantId, entityType, allowEmpty: source.operation === "SPLIT",
      code: "entity360_identity_lineage_absorbed_entities_invalid" });
  const restoredEntities = normalizedPublishedIdentityLineageMembers(source.restored_entities,
    { tenantId, entityType, allowEmpty: source.operation === "MERGE",
      code: "entity360_identity_lineage_restored_entities_invalid" });
  const observedAt = timestamp(source.observed_at, "entity360_identity_lineage_observed_at_invalid");
  const evidenceDigest = normalizedIdentityLineageDigest(source.evidence_digest,
    "entity360_identity_lineage_evidence_digest_invalid");
  const idempotencyKey = text(source.idempotency_key, "entity360_identity_lineage_idempotency_key_invalid",
    160, SOURCE_ID);
  const predecessorLineageDigest = source.predecessor_lineage_digest === null ? null
    : normalizedIdentityLineageDigest(source.predecessor_lineage_digest,
      "entity360_identity_lineage_predecessor_digest_invalid");
  const reversesLineageDigest = source.reverses_lineage_digest === null ? null
    : normalizedIdentityLineageDigest(source.reverses_lineage_digest,
      "entity360_identity_lineage_reverses_digest_invalid");
  if (source.operation === "MERGE") {
    assertIdentityLineageMembersDistinct(canonicalEntity, absorbedEntities);
    if (restoredEntities.length !== 0 || predecessorLineageDigest !== null || reversesLineageDigest !== null) {
      fail("entity360_identity_lineage_contradiction", 409);
    }
  } else {
    if (absorbedEntities.length !== 0 || predecessorLineageDigest === null
      || reversesLineageDigest !== predecessorLineageDigest || restoredEntities.length < 2) {
      fail("entity360_identity_lineage_contradiction", 409);
    }
    const restoredCanonical = restoredEntities.find((member) =>
      member.entity_id === canonicalEntity.entity_id);
    if (!restoredCanonical || stableString(restoredCanonical) !== stableString(canonicalEntity)) {
      fail("entity360_identity_lineage_contradiction", 409);
    }
  }
  const body = identityLineageBody({ operation: source.operation, tenantId, entityType, canonicalEntity,
    absorbedEntities, restoredEntities, observedAt, evidenceDigest, idempotencyKey,
    predecessorLineageDigest, reversesLineageDigest });
  const issued = issueIdentityLineage(body);
  if (source.lineage_id !== issued.lineage_id || source.audit_digest !== issued.audit_digest) {
    fail("entity360_identity_lineage_audit_mismatch", 409);
  }
  return issued;
}

/**
 * Creates an immutable, non-authoritative observation that records which
 * tenant-scoped Entity 360 identities were tentatively merged. It does not
 * alter resolution, entity heads, persistence, or any Core decision path.
 */
export function createEntity360IdentityMergeLineage(input = {}) {
  const source = normalizeIdentityLineageInput(input, ["absorbed_identities", "canonical_identity",
    "entity_type", "evidence_digest", "idempotency_key", "observed_at", "tenant_id"],
  "entity360_identity_lineage_merge_input_invalid");
  const tenantId = text(source.tenant_id, "entity360_identity_lineage_tenant_required", 120, SOURCE_ID);
  const entityType = text(source.entity_type, "entity360_identity_lineage_entity_type_required", 80,
    ENTITY_TYPE);
  const canonicalEntity = createIdentityLineageMember({ tenantId, entityType,
    identity: source.canonical_identity });
  const absorbedEntities = canonicalIdentityLineageMembers(source.absorbed_identities,
    { tenantId, entityType, code: "entity360_identity_lineage_absorbed_entities_invalid" });
  assertIdentityLineageMembersDistinct(canonicalEntity, absorbedEntities);
  const observedAt = timestamp(source.observed_at, "entity360_identity_lineage_observed_at_invalid");
  const evidenceDigest = normalizedIdentityLineageDigest(source.evidence_digest,
    "entity360_identity_lineage_evidence_digest_invalid");
  const idempotencyKey = text(source.idempotency_key, "entity360_identity_lineage_idempotency_key_invalid",
    160, SOURCE_ID);
  return issueIdentityLineage(identityLineageBody({ operation: "MERGE", tenantId, entityType,
    canonicalEntity, absorbedEntities, restoredEntities: [], observedAt, evidenceDigest,
    idempotencyKey, predecessorLineageDigest: null, reversesLineageDigest: null }));
}

/**
 * Creates the exact inverse of a verified merge observation. A split is a new
 * SHADOW observation and never mutates the previously issued merge record.
 */
export function createEntity360IdentitySplitLineage(input = {}) {
  const source = normalizeIdentityLineageInput(input, ["evidence_digest", "idempotency_key",
    "merge_lineage", "observed_at", "tenant_id"], "entity360_identity_lineage_split_input_invalid");
  const tenantId = text(source.tenant_id, "entity360_identity_lineage_tenant_required", 120, SOURCE_ID);
  const claimedMergeTenant = text(source.merge_lineage?.tenant_scope,
    "entity360_identity_lineage_merge_required", 120, SOURCE_ID);
  if (claimedMergeTenant !== tenantId) fail("entity360_identity_lineage_cross_tenant", 403);
  let merge;
  try {
    merge = normalizePublishedIdentityLineage(source.merge_lineage);
  } catch (error) {
    if (error instanceof Entity360Error) fail("entity360_identity_lineage_contradiction", 409);
    throw error;
  }
  if (merge.operation !== "MERGE" || merge.tenant_scope !== tenantId) {
    fail("entity360_identity_lineage_contradiction", 409);
  }
  const observedAt = timestamp(source.observed_at, "entity360_identity_lineage_observed_at_invalid");
  const evidenceDigest = normalizedIdentityLineageDigest(source.evidence_digest,
    "entity360_identity_lineage_evidence_digest_invalid");
  const idempotencyKey = text(source.idempotency_key, "entity360_identity_lineage_idempotency_key_invalid",
    160, SOURCE_ID);
  const restoredEntities = [merge.canonical_entity, ...merge.absorbed_entities]
    .sort((left, right) => lexical(left.entity_id, right.entity_id));
  return issueIdentityLineage(identityLineageBody({ operation: "SPLIT", tenantId,
    entityType: merge.entity_type, canonicalEntity: merge.canonical_entity, absorbedEntities: [],
    restoredEntities, observedAt, evidenceDigest, idempotencyKey,
    predecessorLineageDigest: merge.audit_digest, reversesLineageDigest: merge.audit_digest }));
}

/**
 * Verifies the deterministic audit envelope without turning a lineage
 * observation into an authority signal. The result is suitable for an
 * append-only store or independent reviewer, not for execution gating.
 */
export function verifyEntity360IdentityLineage(value) {
  try {
    normalizePublishedIdentityLineage(value);
    return deepFreeze({ schema_version: ENTITY_360_IDENTITY_LINEAGE_VERIFICATION_SCHEMA_VERSION,
      valid: true, reasons: [], execution_authorized: false, authority: "universal_core" });
  } catch (error) {
    return deepFreeze({ schema_version: ENTITY_360_IDENTITY_LINEAGE_VERIFICATION_SCHEMA_VERSION,
      valid: false, reasons: [error instanceof Entity360Error ? error.code
        : "entity360_identity_lineage_verification_failed"], execution_authorized: false,
      authority: "universal_core" });
  }
}

function sourceAuthoritativeForFact(source, factId, asOfMs) {
  if (!source.authoritative || source.derived || source.revoked) return false;
  if (source.valid_from && Date.parse(source.valid_from) > asOfMs) return false;
  if (source.valid_until && Date.parse(source.valid_until) <= asOfMs) return false;
  return source.authoritative_fact_prefixes.length === 0
    || source.authoritative_fact_prefixes.some((prefix) => factId === prefix || factId.startsWith(`${prefix}.`));
}

function normalizeEvidence(values, code) {
  if (!Array.isArray(values) || !values.length || values.length > 512) fail(code);
  return canonicalSet(values.map((value) => text(value, code, 64, SHA256)));
}

function claimIdentityBody(claim) {
  const { value: _value, claim_id: _claimId, bytes: _bytes, tokens: _tokens,
    contribution_digest: _contributionDigest, adapter_version: _adapterVersion,
    temporal_state: _temporalState, ...identity } = claim;
  return stable(identity);
}

function compactQualifiedClaim(claim) {
  const { value: _value, contribution_digest: _contributionDigest,
    adapter_version: _adapterVersion, temporal_state: _temporalState, ...compact } = claim;
  return stable(compact);
}

function contributionDigestBody(contribution) {
  const { contribution_digest: _digest, ...body } = contribution;
  return stable({ ...body, facts: body.facts.map(compactQualifiedClaim) });
}

function compactQualifiedContribution(contribution) {
  return stable({ ...contribution,
    facts: contribution.facts.map(compactQualifiedClaim) });
}

function normalizeFact(raw, source, contribution, asOfMs, policy) {
  const fact = plainObject(raw, "entity360_fact_invalid");
  const factId = text(fact.fact_id, "entity360_fact_id_invalid", 160, SOURCE_ID);
  const observedAt = timestamp(fact.observed_at || contribution.observed_at, "entity360_fact_observed_at_invalid");
  const recordedAt = timestamp(fact.recorded_at || contribution.recorded_at || contribution.observed_at,
    "entity360_fact_recorded_at_invalid");
  const validFrom = optionalTimestamp(fact.valid_from, "entity360_fact_valid_from_invalid") || observedAt;
  const validTo = optionalTimestamp(fact.valid_to, "entity360_fact_valid_to_invalid");
  if (validTo && Date.parse(validTo) <= Date.parse(validFrom)) fail("entity360_fact_validity_invalid");
  if (Date.parse(recordedAt) > asOfMs + policy.freshness.max_clock_skew_seconds * 1000) {
    fail("entity360_future_recorded_time_invalid");
  }
  if (Date.parse(observedAt) > asOfMs + policy.freshness.max_clock_skew_seconds * 1000) {
    fail("entity360_future_observed_time_invalid");
  }
  assertContextValueHasNoAuthorityKeys(fact.value);
  const value = stable(fact.value);
  if (value === undefined) fail("entity360_fact_value_required");
  const valueDigest = entity360Digest(value);
  const state = text(fact.state || "current", "entity360_fact_state_invalid", 32).toLowerCase();
  if (!TEMPORAL_STATES.has(state)) fail("entity360_fact_state_invalid");
  const evidenceDigests = normalizeEvidence(fact.evidence_digests || contribution.evidence_digests,
    "entity360_fact_evidence_digest_required");
  const evidenceRefs = canonicalSet((fact.evidence_refs || contribution.evidence_refs || []).map((item) =>
    text(item, "entity360_evidence_ref_invalid", 2_000)));
  const canonical = {
    fact_id: factId,
    value,
    value_digest: valueDigest,
    criticality: ["normal", "critical", "high_impact"].includes(fact.criticality) ? fact.criticality : "normal",
    confidence: finiteNumber(fact.confidence ?? contribution.confidence ?? 0.5,
      "entity360_fact_confidence_invalid"),
    valid_from: validFrom,
    valid_to: validTo,
    observed_at: observedAt,
    recorded_at: recordedAt,
    declared_state: state,
    supersedes_claim_id: optionalText(fact.supersedes_claim_id,
      "entity360_supersedes_claim_invalid", 160, SOURCE_ID),
    tombstone: fact.tombstone === true,
    evidence_class: text(fact.evidence_class || contribution.evidence_class,
      "entity360_evidence_class_invalid", 120, SOURCE_ID),
    evidence_refs: evidenceRefs,
    evidence_digests: evidenceDigests,
    source_id: source.source_id,
    source_class: source.source_class,
    trust_class: source.trust_class,
    trust_boundary: source.trust_boundary,
    independence_group: source.independence_group,
    authoritative: sourceAuthoritativeForFact(source, factId, asOfMs),
    derived_source: source.derived,
    source_watermark: contribution.source_watermark,
  };
  canonical.claim_id = `ecl_${entity360Digest(claimIdentityBody(canonical)).slice(0, 48)}`;
  canonical.bytes = Buffer.byteLength(stableString(canonical));
  // Token occupancy is derived from the canonical qualified fact. A source
  // cannot under-report this value to evade a policy budget.
  canonical.tokens = Math.max(1, Math.ceil(canonical.bytes / 4));
  return canonical;
}

function normalizeContribution(raw, scope, policy, asOfMs) {
  const contribution = plainObject(raw, "entity360_source_contribution_invalid");
  if (contribution.tenant_id !== undefined && contribution.tenant_id !== scope.tenant_id) {
    fail("entity360_cross_tenant_source_contribution", 403);
  }
  if (contribution.entity_id !== undefined && contribution.entity_id !== scope.entity_id) {
    fail("entity360_cross_entity_source_contribution", 403);
  }
  const sourceId = text(contribution.source_id, "entity360_source_id_invalid", 160, SOURCE_ID);
  const adapterVersion = text(contribution.adapter_version, "entity360_adapter_version_invalid", 120, SOURCE_ID);
  const source = policy.source_registry[sourceId];
  if (!source) return { accepted: false, source_id: sourceId,
    adapter_version: adapterVersion, reason: "SOURCE_NOT_REGISTERED" };
  if (!source.adapter_versions.includes(adapterVersion)) {
    return { accepted: false, source_id: sourceId,
      adapter_version: adapterVersion, reason: "ADAPTER_VERSION_NOT_ALLOWED" };
  }
  if (source.revoked) {
    return { accepted: false, source_id: sourceId,
      adapter_version: adapterVersion, reason: "SOURCE_REVOKED" };
  }
  if (source.valid_from && Date.parse(source.valid_from) > asOfMs
    || source.valid_until && Date.parse(source.valid_until) <= asOfMs) {
    return { accepted: false, source_id: sourceId,
      adapter_version: adapterVersion, reason: "SOURCE_NOT_VALID_AS_OF" };
  }
  const observedAt = timestamp(contribution.observed_at, "entity360_source_observed_at_invalid");
  const recordedAt = timestamp(contribution.recorded_at || contribution.observed_at,
    "entity360_source_recorded_at_invalid");
  const sourceWatermark = text(contribution.source_watermark,
    "entity360_source_watermark_required", 240, SOURCE_ID);
  const evidenceClass = text(contribution.evidence_class,
    "entity360_evidence_class_invalid", 120, SOURCE_ID);
  const evidenceDigests = normalizeEvidence(contribution.evidence_digests,
    "entity360_source_evidence_digest_required");
  const evidenceRefs = canonicalSet((contribution.evidence_refs || []).map((item) =>
    text(item, "entity360_evidence_ref_invalid", 2_000)));
  const facts = Array.isArray(contribution.facts) ? contribution.facts : fail("entity360_source_facts_required");
  if (!facts.length || facts.length > 1_000) fail("entity360_source_facts_invalid");
  const rawFactIds = facts.map((rawFact) => {
    const value = plainObject(rawFact, "entity360_fact_invalid");
    return text(value.fact_id, "entity360_fact_id_invalid", 160, SOURCE_ID);
  });
  const rejectedFactIds = canonicalSet(rawFactIds.filter((factId) =>
    !factPrefixAllowed(source.allowed_fact_prefixes, factId)));
  if (rejectedFactIds.length) {
    const rejection = { source_id: sourceId, adapter_version: adapterVersion,
      reason_code: "FACT_CONTRACT_VIOLATION", rejected_fact_ids: rejectedFactIds };
    return { accepted: false, ...rejection, reason: rejection.reason_code,
      rejection_digest: entity360Digest(rejection) };
  }
  const normalized = {
    source_id: sourceId,
    source_class: source.source_class,
    trust_class: source.trust_class,
    trust_boundary: source.trust_boundary,
    independence_group: source.independence_group,
    adapter_version: adapterVersion,
    observed_at: observedAt,
    recorded_at: recordedAt,
    source_watermark: sourceWatermark,
    evidence_class: evidenceClass,
    evidence_digests: evidenceDigests,
    evidence_refs: evidenceRefs,
    confidence: finiteNumber(contribution.confidence ?? 0.5,
      "entity360_source_confidence_invalid"),
  };
  normalized.facts = canonicalSet(facts.map((fact) => normalizeFact(fact, source, normalized, asOfMs, policy)));
  normalized.contribution_digest = entity360Digest(contributionDigestBody(normalized));
  return { accepted: true, contribution: normalized };
}

function budgetFor(map, key) {
  return map[key] || map.default || fail("entity360_occupancy_budget_missing", 422, { key });
}

function emptyCounter() {
  return { contributions: 0, evidence: 0, bytes: 0, tokens: 0 };
}

function wouldExceed(counter, budget, delta) {
  return counter.contributions + delta.contributions > budget.max_contributions
    || counter.evidence + delta.evidence > budget.max_evidence
    || counter.bytes + delta.bytes > budget.max_bytes
    || counter.tokens + delta.tokens > budget.max_tokens;
}

function addCounter(counter, delta) {
  counter.contributions += delta.contributions;
  counter.evidence += delta.evidence;
  counter.bytes += delta.bytes;
  counter.tokens += delta.tokens;
}

function claimPriority(claim, policy, entityType = null) {
  const requirement = entityType ? (policy.required_context[entityType] || [])
    .find((item) => item.fact_id === claim.fact_id) : null;
  const criticality = requirement?.high_impact === true ? 3 : requirement?.mandatory === true ? 2 : 1;
  const trust = Math.max(0, policy.trust_order.indexOf(claim.trust_class));
  return [criticality, claim.authoritative ? 1 : 0, -trust, Date.parse(claim.observed_at), claim.claim_id];
}

function comparePriority(left, right, policy, entityType = null) {
  const a = claimPriority(left, policy, entityType); const b = claimPriority(right, policy, entityType);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    if (typeof a[index] === "string") return lexical(a[index], b[index]);
    return Number(b[index]) - Number(a[index]);
  }
  return 0;
}

export function applyBoundedSourceOccupancy(contributions, policyInput, entityType = null) {
  const policy = policyInput.policy_digest ? policyInput : compileEntity360Policy(policyInput);
  const claims = contributions.flatMap((contribution) => contribution.facts.map((fact) => ({
    ...fact,
    contribution_digest: contribution.contribution_digest,
    adapter_version: contribution.adapter_version,
  }))).sort((left, right) => comparePriority(left, right, policy, entityType));
  const counters = {
    global: emptyCounter(),
    source: new Map(),
    source_class: new Map(),
    trust_class: new Map(),
  };
  const accepted = [];
  const decisions = new Map();
  const seen = new Set();
  const sourceIds = new Set();
  for (const claim of claims) {
    const decision = decisions.get(claim.contribution_digest) || {
      contribution_digest: claim.contribution_digest,
      source_id: claim.source_id,
      accepted_claim_ids: [],
      rejected_claim_ids: [],
      reason_codes: [],
    };
    decisions.set(claim.contribution_digest, decision);
    const dedupeKey = entity360Digest({ source_id: claim.source_id, fact_id: claim.fact_id,
      value_digest: claim.value_digest, valid_from: claim.valid_from, valid_to: claim.valid_to });
    if (seen.has(dedupeKey)) {
      decision.rejected_claim_ids.push(claim.claim_id);
      decision.reason_codes.push("DUPLICATE_CONTRIBUTION");
      continue;
    }
    const delta = {
      contributions: 1,
      evidence: claim.evidence_digests.length,
      bytes: claim.bytes,
      tokens: claim.tokens,
    };
    const sourceCounter = counters.source.get(claim.source_id) || emptyCounter();
    const classCounter = counters.source_class.get(claim.source_class) || emptyCounter();
    const trustCounter = counters.trust_class.get(claim.trust_class) || emptyCounter();
    const sourceBudget = budgetFor(policy.budgets.per_source, claim.source_id);
    const classBudget = budgetFor(policy.budgets.per_source_class, claim.source_class);
    const trustBudget = budgetFor(policy.budgets.per_trust_class, claim.trust_class);
    let reason = null;
    if (!sourceIds.has(claim.source_id) && sourceIds.size >= policy.budgets.max_sources) reason = "MAX_SOURCES_REACHED";
    else if (counters.global.evidence + delta.evidence > policy.budgets.max_evidence) reason = "MAX_EVIDENCE_REACHED";
    else if (counters.global.bytes + delta.bytes > policy.budgets.max_retrieval_bytes) reason = "MAX_RETRIEVAL_BYTES_REACHED";
    else if (counters.global.tokens + delta.tokens > policy.budgets.max_context_tokens) reason = "MAX_CONTEXT_TOKENS_REACHED";
    else if (wouldExceed(sourceCounter, sourceBudget, delta)) reason = "SOURCE_OCCUPANCY_REACHED";
    else if (wouldExceed(classCounter, classBudget, delta)) reason = "SOURCE_CLASS_OCCUPANCY_REACHED";
    else if (wouldExceed(trustCounter, trustBudget, delta)) reason = "TRUST_CLASS_OCCUPANCY_REACHED";
    if (reason) {
      decision.rejected_claim_ids.push(claim.claim_id);
      decision.reason_codes.push(reason);
      continue;
    }
    seen.add(dedupeKey);
    sourceIds.add(claim.source_id);
    addCounter(counters.global, delta);
    addCounter(sourceCounter, delta); addCounter(classCounter, delta); addCounter(trustCounter, delta);
    counters.source.set(claim.source_id, sourceCounter);
    counters.source_class.set(claim.source_class, classCounter);
    counters.trust_class.set(claim.trust_class, trustCounter);
    accepted.push(claim);
    decision.accepted_claim_ids.push(claim.claim_id);
  }
  const contributionDecisions = [...decisions.values()].map((decision) => ({
    ...decision,
    status: decision.accepted_claim_ids.length && decision.rejected_claim_ids.length ? "limited"
      : decision.accepted_claim_ids.length ? "accepted" : "rejected",
    reason_codes: [...new Set(decision.reason_codes)].sort(),
  })).sort((left, right) => lexical(left.contribution_digest, right.contribution_digest));
  return deepFreeze({
    admitted_claims: canonicalSet(accepted),
    decisions: contributionDecisions,
    occupancy: {
      source_count: sourceIds.size,
      evidence_count: counters.global.evidence,
      retrieval_bytes: counters.global.bytes,
      context_tokens: counters.global.tokens,
      per_source: Object.fromEntries([...counters.source.entries()].sort(([left], [right]) => lexical(left, right))),
      per_source_class: Object.fromEntries([...counters.source_class.entries()].sort(([left], [right]) => lexical(left, right))),
      per_trust_class: Object.fromEntries([...counters.trust_class.entries()].sort(([left], [right]) => lexical(left, right))),
    },
  });
}

function temporalState(claim, asOfMs, policy) {
  if (claim.tombstone || claim.declared_state === "superseded") return "superseded";
  if (Date.parse(claim.valid_from) > asOfMs) return "historical";
  if (claim.valid_to && Date.parse(claim.valid_to) <= asOfMs || claim.declared_state === "historical") return "historical";
  const maximumAge = policy.freshness.by_source_class[claim.source_class]
    || policy.freshness.default_max_age_seconds;
  if (Date.parse(claim.observed_at) + maximumAge * 1000 < asOfMs || claim.declared_state === "stale") return "stale";
  if (claim.declared_state === "conflicting") return "conflicting";
  return "current";
}

function supersessionCycleClaimIds(claims) {
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const cycles = new Set();
  for (const start of claims) {
    const path = []; const position = new Map();
    let cursor = start;
    while (cursor && cursor.supersedes_claim_id && byId.has(cursor.supersedes_claim_id)) {
      if (position.has(cursor.claim_id)) {
        for (const claimId of path.slice(position.get(cursor.claim_id))) cycles.add(claimId);
        break;
      }
      position.set(cursor.claim_id, path.length);
      path.push(cursor.claim_id);
      cursor = byId.get(cursor.supersedes_claim_id);
    }
    if (cursor && position.has(cursor.claim_id)) {
      for (const claimId of path.slice(position.get(cursor.claim_id))) cycles.add(claimId);
    }
  }
  return cycles;
}

function authorityTransitionAllowed(target, superseder, policy) {
  const sameAuthoritativeLineage = target.authoritative && superseder.authoritative
    && !target.derived_source && !superseder.derived_source
    && target.source_id === superseder.source_id
    && target.independence_group === superseder.independence_group;
  if (sameAuthoritativeLineage) return true;
  return policy.temporal_reconciliation.authority_transitions.some((transition) =>
    transition.from_source_id === target.source_id
    && transition.to_source_id === superseder.source_id
    && factPrefixAllowed(transition.fact_prefixes, superseder.fact_id));
}

function reconcileSupersessions(claims, policy, requirements, asOfMs) {
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const cycleIds = supersessionCycleClaimIds(claims);
  const supersededClaimIds = new Set(); const contradictions = [];
  for (const superseder of claims.filter((claim) => claim.supersedes_claim_id)) {
    const target = byId.get(superseder.supersedes_claim_id);
    let reasonCode = null;
    if (!target) reasonCode = "INVALID_SUPERSESSION_TARGET_MISSING";
    else if (cycleIds.has(superseder.claim_id) || cycleIds.has(target.claim_id)) {
      reasonCode = "INVALID_SUPERSESSION_CYCLE";
    } else if (target.fact_id !== superseder.fact_id) {
      reasonCode = "INVALID_SUPERSESSION_FACT_SCOPE";
    } else if (temporalState({ ...superseder, tombstone: false }, asOfMs, policy) !== "current") {
      reasonCode = "INVALID_SUPERSESSION_SUPERSEDER_NOT_CURRENT";
    } else if (Date.parse(target.valid_from) > asOfMs) {
      reasonCode = "INVALID_SUPERSESSION_TARGET_NOT_EFFECTIVE";
    } else {
      const targetObserved = Date.parse(target.observed_at); const supersederObserved = Date.parse(superseder.observed_at);
      const targetRecorded = Date.parse(target.recorded_at); const supersederRecorded = Date.parse(superseder.recorded_at);
      if (targetObserved > supersederObserved || targetRecorded > supersederRecorded
        || targetObserved === supersederObserved && targetRecorded === supersederRecorded) {
        reasonCode = "INVALID_SUPERSESSION_TEMPORAL_ORDER";
      } else if (!authorityTransitionAllowed(target, superseder, policy)) {
        reasonCode = "INVALID_SUPERSESSION_AUTHORITY_LINEAGE";
      }
    }
    if (!reasonCode) {
      supersededClaimIds.add(target.claim_id);
      continue;
    }
    const governed = requirements.filter((item) => item.fact_id === superseder.fact_id);
    contradictions.push({
      fact_id: superseder.fact_id,
      value_digests: [...new Set([superseder.value_digest, target?.value_digest].filter(Boolean))].sort(),
      claim_ids: [...new Set([superseder.claim_id, target?.claim_id].filter(Boolean))].sort(),
      source_ids: [...new Set([superseder.source_id, target?.source_id].filter(Boolean))].sort(),
      reason_code: reasonCode,
      supersedes_claim_id: superseder.supersedes_claim_id,
      blocking: true,
      policy_requirement_ids: governed.map((item) => item.requirement_id).sort(),
    });
  }
  return { superseded_claim_ids: supersededClaimIds, contradictions: canonicalSet(contradictions) };
}

export function reconcileEntity360TemporalState(claims, asOf, policyInput, entityType = null) {
  const policy = policyInput.policy_digest ? policyInput : compileEntity360Policy(policyInput);
  const requirements = entityType ? policy.required_context[entityType] || [] : [];
  const asOfIso = timestamp(asOf, "entity360_as_of_invalid");
  const asOfMs = Date.parse(asOfIso);
  const byFact = new Map();
  const supersession = reconcileSupersessions(claims, policy, requirements, asOfMs);
  const supersededClaimIds = supersession.superseded_claim_ids;
  for (const claim of claims) {
    const classified = { ...claim, temporal_state: supersededClaimIds.has(claim.claim_id)
      ? "superseded" : temporalState(claim, asOfMs, policy) };
    const values = byFact.get(claim.fact_id) || [];
    values.push(classified); byFact.set(claim.fact_id, values);
  }
  const currentState = {};
  const historical = []; const superseded = []; const stale = [];
  const conflicts = [...supersession.contradictions];
  for (const [factId, factClaims] of [...byFact.entries()].sort(([left], [right]) => lexical(left, right))) {
    const current = factClaims.filter((claim) => claim.temporal_state === "current");
    historical.push(...factClaims.filter((claim) => claim.temporal_state === "historical"));
    superseded.push(...factClaims.filter((claim) => claim.temporal_state === "superseded"));
    stale.push(...factClaims.filter((claim) => claim.temporal_state === "stale"));
    const declaredConflicts = factClaims.filter((claim) => claim.temporal_state === "conflicting");
    if (declaredConflicts.length) {
      const governed = requirements.filter((item) => item.fact_id === factId);
      const independentGroups = new Set(declaredConflicts.filter((claim) => !claim.derived_source
        && claim.trust_class !== "advisory").map((claim) => claim.independence_group));
      const policyBlockingSource = declaredConflicts.some((claim) => factPrefixAllowed(
        policy.source_registry[claim.source_id]?.blocking_conflict_fact_prefixes || [], factId));
      conflicts.push({
        fact_id: factId,
        value_digests: [...new Set(declaredConflicts.map((claim) => claim.value_digest))].sort(),
        claim_ids: declaredConflicts.map((claim) => claim.claim_id).sort(),
        source_ids: [...new Set(declaredConflicts.map((claim) => claim.source_id))].sort(),
        reason_code: "DECLARED_SOURCE_CONFLICT",
        blocking: governed.length > 0 || independentGroups.size >= 2 || policyBlockingSource,
        policy_requirement_ids: governed.map((item) => item.requirement_id).sort(),
      });
    }
    const values = new Map(current.map((claim) => [claim.value_digest, claim.value]));
    if (values.size > 1) {
      const governed = requirements.filter((item) => item.fact_id === factId);
      const independentGroups = new Set(current.filter((claim) => !claim.derived_source
        && claim.trust_class !== "advisory").map((claim) => claim.independence_group));
      const policyBlockingSource = current.some((claim) => factPrefixAllowed(
        policy.source_registry[claim.source_id]?.blocking_conflict_fact_prefixes || [], factId));
      const conflict = {
        fact_id: factId,
        value_digests: [...values.keys()].sort(),
        claim_ids: current.map((claim) => claim.claim_id).sort(),
        source_ids: [...new Set(current.map((claim) => claim.source_id))].sort(),
        reason_code: "CONCURRENT_CURRENT_VALUES_CONFLICT",
        blocking: governed.length > 0 || independentGroups.size >= 2 || policyBlockingSource,
        policy_requirement_ids: governed.map((item) => item.requirement_id).sort(),
      };
      conflicts.push(conflict);
      for (const claim of current) claim.temporal_state = "conflicting";
      continue;
    }
    if (current.length === 0) continue;
    const ordered = current.sort((left, right) => comparePriority(left, right, policy));
    currentState[factId] = {
      value: ordered[0].value,
      value_digest: ordered[0].value_digest,
      claim_ids: ordered.map((claim) => claim.claim_id).sort(),
      source_ids: [...new Set(ordered.map((claim) => claim.source_id))].sort(),
      observed_at: ordered.map((claim) => claim.observed_at).sort().at(-1),
      valid_from: ordered.map((claim) => claim.valid_from).sort().at(-1),
    };
  }
  const reference = (claim) => ({ fact_id: claim.fact_id, claim_id: claim.claim_id,
    value_digest: claim.value_digest, evidence_digests: claim.evidence_digests,
    source_id: claim.source_id, temporal_state: claim.temporal_state });
  return deepFreeze({
    as_of: asOfIso,
    current_state: stable(currentState),
    historical_state_references: canonicalSet(historical.map(reference)),
    superseded_state_references: canonicalSet(superseded.map(reference)),
    stale_state_references: canonicalSet(stale.map(reference)),
    contradictions: canonicalSet(conflicts),
    classified_claims: canonicalSet([...byFact.values()].flat()),
  });
}

function corroborationRule(factId, claims, requirements, policy) {
  const requirement = requirements.find((item) => item.fact_id === factId);
  // A source cannot promote an arbitrary fact into a high-impact release gate.
  // Criticality is governed only by the versioned policy requirement contract.
  const highImpact = requirement?.high_impact === true;
  return {
    minimum: highImpact ? policy.corroboration.high_impact_min_independent_sources
      : policy.corroboration.default_min_independent_sources,
    allow_authoritative: policy.corroboration.allow_verified_authoritative,
    authoritative_required: requirement?.authoritative_required === true,
    high_impact: highImpact,
    eligible_trust_classes: highImpact
      ? policy.corroboration.high_impact_eligible_trust_classes : policy.trust_order,
  };
}

export function evaluateEntity360Corroboration(temporal, entityType, policyInput) {
  const policy = policyInput.policy_digest ? policyInput : compileEntity360Policy(policyInput);
  const requirements = policy.required_context[entityType] || [];
  const currentClaims = temporal.classified_claims.filter((claim) => claim.temporal_state === "current");
  const byFact = new Map();
  for (const claim of currentClaims) {
    const values = byFact.get(claim.fact_id) || [];
    values.push(claim); byFact.set(claim.fact_id, values);
  }
  const facts = [];
  const gaps = [];
  const authoritativeMissing = [];
  for (const factId of new Set([...byFact.keys(), ...requirements.filter((item) => item.mandatory)
    .map((item) => item.fact_id)])) {
    const claims = byFact.get(factId) || [];
    const requirement = requirements.find((item) => item.fact_id === factId);
    if (!requirement) {
      facts.push({
        fact_id: factId,
        independent_source_count: new Set(claims.filter((claim) => !claim.derived_source)
          .map((claim) => claim.independence_group)).size,
        authoritative_verified: claims.some((claim) => claim.authoritative && !claim.derived_source),
        required_independent_sources: 0,
        authoritative_required: false,
        high_impact: false,
        state: "NOT_POLICY_GATED",
      });
      continue;
    }
    const rule = corroborationRule(factId, claims, requirements, policy);
    const independentClaims = claims.filter((claim) => !claim.derived_source);
    const observedGroups = new Set(independentClaims.map((claim) => claim.independence_group));
    const eligibleTrustClasses = new Set(rule.eligible_trust_classes);
    const eligibleClaims = independentClaims.filter((claim) =>
      eligibleTrustClasses.has(claim.trust_class));
    const groups = new Set(eligibleClaims.map((claim) => claim.independence_group));
    const observedIneligibleTrustClasses = [...new Set(independentClaims
      .filter((claim) => !eligibleTrustClasses.has(claim.trust_class))
      .map((claim) => claim.trust_class))].sort();
    const authoritative = eligibleClaims.some((claim) => claim.authoritative);
    const ineligibleAuthoritativeObserved = independentClaims.some((claim) =>
      claim.authoritative && !eligibleTrustClasses.has(claim.trust_class));
    const satisfied = rule.authoritative_required
      ? authoritative
      : groups.size >= rule.minimum || rule.allow_authoritative && authoritative;
    const result = {
      fact_id: factId,
      independent_source_count: groups.size,
      observed_independent_source_count: observedGroups.size,
      authoritative_verified: authoritative,
      required_independent_sources: rule.minimum,
      authoritative_required: rule.authoritative_required,
      high_impact: rule.high_impact,
      eligible_trust_classes: rule.high_impact ? rule.eligible_trust_classes : [],
      observed_ineligible_trust_classes: observedIneligibleTrustClasses,
      state: satisfied ? "CORROBORATED" : "GAP",
    };
    facts.push(result);
    if (!satisfied) gaps.push({
      fact_id: factId,
      reason_code: !claims.length ? "CURRENT_FACT_MISSING"
        : rule.high_impact && observedIneligibleTrustClasses.length
          ? "HIGH_IMPACT_TRUST_CLASS_INELIGIBLE" : "INDEPENDENT_CORROBORATION_MISSING",
      required_independent_sources: rule.minimum,
      observed_independent_sources: observedGroups.size,
      eligible_independent_sources: groups.size,
      eligible_trust_classes: rule.high_impact ? rule.eligible_trust_classes : [],
      observed_ineligible_trust_classes: observedIneligibleTrustClasses,
      authoritative_alternative_allowed: rule.allow_authoritative,
      authoritative_alternative_eligible: authoritative,
      ineligible_authoritative_source_observed: ineligibleAuthoritativeObserved,
    });
    if (rule.authoritative_required && !authoritative) authoritativeMissing.push({
      fact_id: factId,
      reason_code: ineligibleAuthoritativeObserved
        ? "AUTHORITATIVE_SOURCE_TRUST_CLASS_INELIGIBLE"
        : "VERIFIED_AUTHORITATIVE_SOURCE_MISSING",
      eligible_trust_classes: rule.high_impact ? rule.eligible_trust_classes : [],
      observed_ineligible_trust_classes: observedIneligibleTrustClasses,
    });
  }
  const covered = facts.filter((item) => item.state === "CORROBORATED").length;
  return deepFreeze({
    state: gaps.length ? "INCOMPLETE" : "CORROBORATED",
    coverage: facts.length ? covered / facts.length : 1,
    facts: canonicalSet(facts),
    corroboration_gaps: canonicalSet(gaps),
    authoritative_sources_missing: canonicalSet(authoritativeMissing),
  });
}

export function evaluateEntity360Completeness({ entity_type, temporal, corroboration, policy: policyInput } = {}) {
  const policy = policyInput.policy_digest ? policyInput : compileEntity360Policy(policyInput);
  const requirements = policy.required_context[entity_type] || [];
  const staleFacts = new Set(temporal.stale_state_references.map((item) => item.fact_id));
  const contradictionFacts = new Set(temporal.contradictions.map((item) => item.fact_id));
  const currentClaims = temporal.classified_claims.filter((claim) => claim.temporal_state === "current");
  const currentFacts = new Set(Object.keys(temporal.current_state));
  const gapFacts = new Set(corroboration.corroboration_gaps.map((item) => item.fact_id));
  const missingContext = [];
  const staleSources = temporal.stale_state_references;
  for (const requirement of requirements) {
    const reasons = [];
    if (!currentFacts.has(requirement.fact_id)) reasons.push("CURRENT_FACT_MISSING");
    const qualifyingClaims = currentClaims.filter((claim) => claim.fact_id === requirement.fact_id
      && (!requirement.evidence_class || claim.evidence_class === requirement.evidence_class)
      && (!requirement.source_class || claim.source_class === requirement.source_class));
    if (currentFacts.has(requirement.fact_id) && qualifyingClaims.length === 0) {
      reasons.push("REQUIRED_SOURCE_OR_EVIDENCE_CLASS_MISSING");
    }
    if (!currentFacts.has(requirement.fact_id) && staleFacts.has(requirement.fact_id)) {
      reasons.push("ONLY_STALE_EVIDENCE_AVAILABLE");
    }
    if (contradictionFacts.has(requirement.fact_id)) reasons.push("UNRESOLVED_CONTRADICTION");
    if (gapFacts.has(requirement.fact_id)) reasons.push("CORROBORATION_REQUIRED");
    if (reasons.length) missingContext.push({
      requirement_id: requirement.requirement_id,
      fact_id: requirement.fact_id,
      evidence_class: requirement.evidence_class,
      source_class: requirement.source_class,
      mandatory: requirement.mandatory,
      high_impact: requirement.high_impact,
      reason_codes: reasons.sort(),
      resolution_condition: requirement.authoritative_required
        ? "verified_authoritative_source_required" : "fresh_policy_compliant_evidence_required",
    });
  }
  const satisfied = requirements.filter((requirement) => !missingContext.some((item) =>
    item.requirement_id === requirement.requirement_id)).length;
  const completeness = requirements.length ? satisfied / requirements.length
    : Object.keys(temporal.current_state).length ? 1 : 0;
  const confidences = temporal.classified_claims.filter((claim) => claim.temporal_state === "current")
    .map((claim) => claim.confidence);
  const rawConfidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0;
  const confidence = Math.max(0, Math.min(1, rawConfidence * corroboration.coverage));
  return deepFreeze({
    completeness,
    confidence,
    missing_context: canonicalSet(missingContext),
    stale_sources: canonicalSet(staleSources),
    contradictions: temporal.contradictions,
    corroboration_gaps: corroboration.corroboration_gaps,
    authoritative_sources_missing: corroboration.authoritative_sources_missing,
  });
}

function normalizeLinks(values, scope, ontology, kind, maximum) {
  if (!Array.isArray(values)) fail(`entity360_${kind}_invalid`);
  if (values.length > maximum) fail(`entity360_${kind}_budget_exceeded`);
  const allowedRelationships = new Set(ontology.relationship_types);
  const allowedDependencies = new Set(ontology.dependency_classes);
  return canonicalSet(values.map((raw) => {
    const item = plainObject(raw, `entity360_${kind}_invalid`);
    const allowedKeys = new Set(["tenant_id", "type", "target_entity_id", "depth", "evidence_digests"]);
    if (Object.keys(item).some((key) => !allowedKeys.has(key))) {
      fail(`entity360_${kind}_field_invalid`);
    }
    if (item.tenant_id !== undefined && item.tenant_id !== scope.tenant_id) {
      fail(`entity360_cross_tenant_${kind}`, 403);
    }
    const type = text(item.type, `entity360_${kind}_type_invalid`, 120, SOURCE_ID);
    if (kind === "relationship" && !allowedRelationships.has(type)) fail("entity360_relationship_type_invalid");
    if (kind === "dependency" && !allowedDependencies.has(type)) fail("entity360_dependency_type_invalid");
    return {
      type,
      target_entity_id: text(item.target_entity_id, `entity360_${kind}_target_invalid`, 160, SOURCE_ID),
      depth: nonNegativeInteger(item.depth ?? 1, `entity360_${kind}_depth_invalid`, 32),
      evidence_digests: normalizeEvidence(item.evidence_digests, `entity360_${kind}_evidence_required`),
    };
  }));
}

function normalizeSnapshotLinks({ relationships, dependencies, scope, ontology, policy }) {
  const normalizedRelationships = normalizeLinks(relationships, scope, ontology, "relationship",
    policy.budgets.max_entities);
  const normalizedDependencies = normalizeLinks(dependencies, scope, ontology, "dependency",
    policy.budgets.max_entities);
  const links = [...normalizedRelationships, ...normalizedDependencies];
  if (links.some((item) => item.depth > policy.budgets.max_relationship_depth)) {
    fail("entity360_relationship_depth_budget_exceeded");
  }
  if (new Set(links.map((item) => item.target_entity_id)).size > policy.budgets.max_entities) {
    fail("entity360_related_entity_budget_exceeded");
  }
  const linkEvidenceCount = links.reduce((total, item) => total + item.evidence_digests.length, 0);
  if (linkEvidenceCount > policy.budgets.max_evidence) {
    fail("entity360_relationship_evidence_budget_exceeded");
  }
  const linkBytes = Buffer.byteLength(stableString(links));
  if (linkBytes > policy.budgets.max_retrieval_bytes
    || Math.ceil(linkBytes / 4) > policy.budgets.max_context_tokens) {
    fail("entity360_relationship_context_budget_exceeded");
  }
  return { relationships: normalizedRelationships, dependencies: normalizedDependencies };
}

function optionalLinkageText(value, code, maximum = 160, pattern = SOURCE_ID) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, code, maximum, pattern);
}

function qualifiedStateValue(currentState, factId, code) {
  const fact = currentState?.[factId];
  if (!fact) return null;
  return plainObject(fact.value, code);
}

function deriveProjectWorkLinkage({ entityType, identity, currentState }) {
  const canonicalIdentity = plainObject(identity, "entity360_linkage_identity_invalid");
  if (entityType === "work") {
    const workIdentity = qualifiedStateValue(currentState, "work.identity",
      "entity360_work_identity_fact_invalid") || {};
    const canonicalWorkId = optionalLinkageText(canonicalIdentity.work_id,
      "entity360_work_linkage_work_id_invalid");
    const qualifiedWorkId = optionalLinkageText(workIdentity.work_id,
      "entity360_work_linkage_work_id_invalid");
    if (canonicalWorkId && qualifiedWorkId && canonicalWorkId !== qualifiedWorkId) {
      fail("entity360_work_linkage_identity_mismatch", 409);
    }
    const workId = qualifiedWorkId || canonicalWorkId;
    if (!workId) fail("entity360_work_linkage_work_id_required");
    const canonicalLegacyWorkId = optionalLinkageText(canonicalIdentity.legacy_work_id,
      "entity360_work_linkage_legacy_work_id_invalid");
    const qualifiedLegacyWorkId = optionalLinkageText(workIdentity.legacy_work_id,
      "entity360_work_linkage_legacy_work_id_invalid");
    if (canonicalLegacyWorkId && qualifiedLegacyWorkId
      && canonicalLegacyWorkId !== qualifiedLegacyWorkId) {
      fail("entity360_work_linkage_identity_mismatch", 409);
    }
    const projectId = Object.hasOwn(workIdentity, "project_id")
      ? optionalLinkageText(workIdentity.project_id, "entity360_work_linkage_project_id_invalid", 128)
      : undefined;
    if (projectId && UUID.test(projectId)) fail("entity360_project_namespace_conflation", 409);
    const genesisBinding = qualifiedStateValue(currentState, "governance.genesis.binding",
      "entity360_genesis_binding_fact_invalid");
    const projectUuid = genesisBinding && Object.hasOwn(genesisBinding, "project_uuid")
      ? optionalLinkageText(genesisBinding.project_uuid,
        "entity360_work_linkage_project_uuid_invalid", 36) : null;
    if (projectUuid && !UUID.test(projectUuid)) fail("entity360_work_linkage_project_uuid_invalid");
    return stable({
      work_id: workId,
      ...(qualifiedLegacyWorkId || canonicalLegacyWorkId
        ? { legacy_work_id: qualifiedLegacyWorkId || canonicalLegacyWorkId } : {}),
      ...(Object.hasOwn(workIdentity, "project_id") ? { project_id: projectId } : {}),
      ...(projectUuid ? { project_uuid: projectUuid.toLowerCase() } : {}),
    });
  }
  if (entityType === "software_component") {
    const componentIdentity = qualifiedStateValue(currentState, "component.identity",
      "entity360_component_identity_fact_invalid") || {};
    const qualifiedWorkId = optionalLinkageText(componentIdentity.work_id,
      "entity360_component_linkage_work_id_invalid");
    const canonicalWorkId = optionalLinkageText(canonicalIdentity.work_id,
      "entity360_component_linkage_work_id_invalid");
    const qualifiedComponentId = optionalLinkageText(componentIdentity.node_id,
      "entity360_component_linkage_component_id_invalid", 160, null);
    const canonicalComponentId = optionalLinkageText(canonicalIdentity.node_id,
      "entity360_component_linkage_component_id_invalid", 160, null);
    if (qualifiedWorkId && canonicalWorkId && qualifiedWorkId !== canonicalWorkId
      || qualifiedComponentId && canonicalComponentId && qualifiedComponentId !== canonicalComponentId) {
      fail("entity360_component_linkage_identity_mismatch", 409);
    }
    const workId = qualifiedWorkId || canonicalWorkId;
    const componentId = qualifiedComponentId || canonicalComponentId;
    if (!workId || !componentId) fail("entity360_component_linkage_identity_required");
    const projectId = Object.hasOwn(componentIdentity, "project_id")
      ? optionalLinkageText(componentIdentity.project_id,
        "entity360_component_linkage_project_id_invalid", 128) : undefined;
    if (projectId && UUID.test(projectId)) fail("entity360_project_namespace_conflation", 409);
    return stable({ work_id: workId, component_id: componentId,
      ...(Object.hasOwn(componentIdentity, "project_id") ? { project_id: projectId } : {}) });
  }
  return {};
}

function normalizeProjectWorkLinkage(input, derived, entityType) {
  const source = plainObject(input, "entity360_project_work_linkage_invalid");
  const allowed = entityType === "work"
    ? new Set(["work_id", "legacy_work_id", "project_id", "project_uuid"])
    : new Set(["work_id", "component_id", "project_id"]);
  for (const [key, value] of Object.entries(source)) {
    if (!allowed.has(key)) fail("entity360_project_work_linkage_field_invalid");
    if (value === null || value === undefined || value === "") continue;
    if (!Object.hasOwn(derived, key) || String(value).trim().toLowerCase()
      !== String(derived[key]).trim().toLowerCase()) {
      fail("entity360_project_work_linkage_mismatch", 409, { field: key });
    }
  }
  return derived;
}

function normalizeSourceDiscovery(values, scope, policy) {
  if (!Array.isArray(values)) fail("entity360_source_discovery_invalid");
  const maximumEntries = Math.max(16, Object.keys(policy.source_registry).length * 8);
  if (values.length > maximumEntries) fail("entity360_source_discovery_budget_exceeded");
  const allowedKeys = new Set(["source_id", "state", "reason_code", "evidence_digest",
    "project_slug_candidates", "continuity_project_uuid", "causal_project_uuid",
    "consistent_cut", "tenant_id", "evidence_ref", "valid_to", "expected_project_slug",
    "observed_project_slug", "retrieved_bytes", "attempted_retrieval_bytes",
    "retrieval_budget_bytes"]);
  const allowedStates = new Set(["accepted", "missing", "unavailable", "excluded", "rejected",
    "conflicting", "complete", "stale"]);
  const entries = values.map((raw) => {
    const item = plainObject(raw, "entity360_source_discovery_entry_invalid");
    if (Object.keys(item).some((key) => !allowedKeys.has(key))) {
      fail("entity360_source_discovery_field_invalid");
    }
    if (item.tenant_id !== undefined && item.tenant_id !== scope.tenant_id) {
      fail("entity360_cross_tenant_source_discovery", 403);
    }
    const sourceId = text(item.source_id, "entity360_source_discovery_source_invalid", 160, SOURCE_ID);
    if (!policy.source_registry[sourceId] && sourceId !== "entity360_context_assembler") {
      fail("entity360_source_discovery_source_not_registered");
    }
    if (sourceId === "entity360_context_assembler") {
      exactKeys(item, ["consistent_cut", "source_id", "state"],
        "entity360_source_discovery_assembler_schema_invalid");
    } else if (item.consistent_cut !== undefined) {
      fail("entity360_source_discovery_cut_binding_invalid");
    }
    const state = text(item.state, "entity360_source_discovery_state_invalid", 32).toLowerCase();
    if (!allowedStates.has(state)) fail("entity360_source_discovery_state_invalid");
    if (sourceId === "entity360_context_assembler" && state !== "complete"
      || sourceId !== "entity360_context_assembler" && state === "complete") {
      fail("entity360_source_discovery_state_binding_invalid");
    }
    const reasonCode = item.reason_code === undefined ? null : text(item.reason_code,
      "entity360_source_discovery_reason_invalid", 160, SOURCE_ID);
    if (reasonCode && !ENTITY_360_SOURCE_DISCOVERY_REASON_CODES.has(reasonCode)) {
      fail("entity360_source_discovery_reason_not_registered");
    }
    if (reasonCode && !ENTITY_360_GENERIC_DISCOVERY_REASONS.has(reasonCode)
      && !ENTITY_360_SOURCE_DISCOVERY_REASON_BINDINGS[sourceId]?.has(reasonCode)) {
      fail("entity360_source_discovery_reason_binding_invalid");
    }
    if (["accepted", "complete"].includes(state) ? reasonCode !== null : reasonCode === null) {
      fail("entity360_source_discovery_reason_state_invalid");
    }
    if (state === "accepted" && (item.evidence_digest === undefined || item.evidence_ref === undefined)) {
      fail("entity360_source_discovery_accepted_evidence_required");
    }
    if (state === "stale" && (item.evidence_digest === undefined || item.evidence_ref === undefined
      || item.valid_to === undefined)) {
      fail("entity360_source_discovery_stale_evidence_required");
    }
    if (sourceId === "entity360_context_assembler"
      && item.consistent_cut !== "postgres_repeatable_read") {
      fail("entity360_source_discovery_cut_invalid");
    }
    const projectSlug = (value) => {
      const slug = text(value, "entity360_source_discovery_project_slug_invalid", 128, SOURCE_ID);
      if (UUID.test(slug)) fail("entity360_project_namespace_conflation", 409);
      return slug;
    };
    const projectSlugs = item.project_slug_candidates === undefined ? undefined
      : canonicalSet((Array.isArray(item.project_slug_candidates)
        ? item.project_slug_candidates : fail("entity360_source_discovery_project_slugs_invalid"))
        .map(projectSlug));
    const projectUuid = (value, code) => {
      if (value === null) return null;
      const normalizedUuid = text(value, code, 36).toLowerCase();
      if (!UUID.test(normalizedUuid)) fail(code);
      return normalizedUuid;
    };
    return {
      source_id: sourceId,
      state,
      ...(reasonCode ? { reason_code: reasonCode } : {}),
      ...(item.evidence_digest !== undefined ? { evidence_digest: text(item.evidence_digest,
        "entity360_source_discovery_evidence_digest_invalid", 64, SHA256) } : {}),
      ...(item.evidence_ref !== undefined ? { evidence_ref: text(item.evidence_ref,
        "entity360_source_discovery_evidence_ref_invalid", 2_000) } : {}),
      ...(item.valid_to !== undefined ? { valid_to: canonicalRfc3339Timestamp(item.valid_to,
        "entity360_source_discovery_valid_to_invalid") } : {}),
      ...(projectSlugs !== undefined ? { project_slug_candidates: projectSlugs } : {}),
      ...(item.expected_project_slug !== undefined
        ? { expected_project_slug: projectSlug(item.expected_project_slug) } : {}),
      ...(item.observed_project_slug !== undefined
        ? { observed_project_slug: projectSlug(item.observed_project_slug) } : {}),
      ...(item.continuity_project_uuid !== undefined ? { continuity_project_uuid: projectUuid(
        item.continuity_project_uuid, "entity360_source_discovery_project_uuid_invalid") } : {}),
      ...(item.causal_project_uuid !== undefined ? { causal_project_uuid: projectUuid(
        item.causal_project_uuid, "entity360_source_discovery_project_uuid_invalid") } : {}),
      ...(item.consistent_cut !== undefined ? { consistent_cut: text(item.consistent_cut,
        "entity360_source_discovery_cut_invalid", 120, SOURCE_ID) } : {}),
      ...(item.retrieved_bytes !== undefined ? { retrieved_bytes: nonNegativeInteger(
        item.retrieved_bytes, "entity360_source_discovery_retrieved_bytes_invalid",
        Number.MAX_SAFE_INTEGER) } : {}),
      ...(item.attempted_retrieval_bytes !== undefined ? { attempted_retrieval_bytes:
        nonNegativeInteger(item.attempted_retrieval_bytes,
          "entity360_source_discovery_attempted_bytes_invalid", Number.MAX_SAFE_INTEGER) } : {}),
      ...(item.retrieval_budget_bytes !== undefined ? { retrieval_budget_bytes: positiveInteger(
        item.retrieval_budget_bytes, "entity360_source_discovery_retrieval_budget_invalid") } : {}),
      ...(item.tenant_id !== undefined ? { tenant_id: scope.tenant_id } : {}),
    };
  });
  const normalized = canonicalSet(entries);
  if (normalized.length !== entries.length) fail("entity360_source_discovery_duplicate_invalid");
  if (Buffer.byteLength(stableString(normalized)) > policy.budgets.max_retrieval_bytes) {
    fail("entity360_source_discovery_budget_exceeded");
  }
  return normalized;
}

function validateSourceDiscoverySemantics(discovery, qualification) {
  const assemblerEntries = discovery.filter((entry) =>
    entry.source_id === "entity360_context_assembler");
  if (assemblerEntries.length !== 1) fail("entity360_source_discovery_assembler_marker_required");
  const contributionsBySource = new Map();
  for (const contribution of qualification.source_contributions) {
    const values = contributionsBySource.get(contribution.source_id) || [];
    values.push(contribution); contributionsBySource.set(contribution.source_id, values);
  }
  const entriesBySource = new Map();
  for (const entry of discovery) {
    if (entry.source_id === "entity360_context_assembler") continue;
    const contributions = contributionsBySource.get(entry.source_id) || [];
    const values = entriesBySource.get(entry.source_id) || [];
    values.push(entry); entriesBySource.set(entry.source_id, values);
    const evidenceBound = entry.evidence_digest === undefined || contributions.some((contribution) =>
      contribution.evidence_digests.includes(entry.evidence_digest)
      && (entry.evidence_ref === undefined || contribution.evidence_refs.includes(entry.evidence_ref)));
    if (entry.state === "accepted" && (!contributions.length || !evidenceBound)) {
      fail("entity360_source_discovery_accepted_binding_invalid");
    }
    if (entry.state === "stale" && (!evidenceBound || !contributions.some((contribution) =>
      contribution.facts.some((fact) => fact.declared_state === "stale")))) {
      fail("entity360_source_discovery_stale_binding_invalid");
    }
    if (entry.state === "conflicting" && (!evidenceBound || !contributions.some((contribution) =>
      contribution.facts.some((fact) => fact.declared_state === "conflicting")))) {
      fail("entity360_source_discovery_conflict_binding_invalid");
    }
    if (["missing", "unavailable", "rejected", "excluded"].includes(entry.state)
      && contributions.length) {
      fail("entity360_source_discovery_negative_binding_invalid");
    }
  }
  for (const entries of entriesBySource.values()) {
    if (entries.length < 2 || entries.every((entry) =>
      ["missing", "unavailable", "rejected", "excluded"].includes(entry.state))) continue;
    if (entries.every((entry) => ["accepted", "conflicting"].includes(entry.state))
      && entries.some((entry) => entry.state === "conflicting")) continue;
    const evidenceKeys = entries.map((entry) => entry.evidence_digest && entry.evidence_ref
      ? `${entry.evidence_digest}:${entry.evidence_ref}` : null);
    if (!entries.every((entry) => ["accepted", "stale"].includes(entry.state))
      || evidenceKeys.some((key) => key === null)
      || new Set(evidenceKeys).size !== evidenceKeys.length) {
      fail("entity360_source_discovery_multi_attempt_invalid");
    }
  }
  for (const contribution of qualification.source_contributions) {
    const bound = discovery.some((entry) => entry.source_id === contribution.source_id
      && ["accepted", "stale", "conflicting"].includes(entry.state)
      && contribution.evidence_digests.includes(entry.evidence_digest)
      && contribution.evidence_refs.includes(entry.evidence_ref));
    if (!bound) fail("entity360_source_discovery_contribution_binding_missing");
  }
}

function requireEmptyV1ContextSections(input) {
  const architectureState = stable(input.architecture_state || {});
  const runtimeState = stable(input.runtime_state || {});
  const concurrentActiveWork = canonicalSet(input.concurrent_active_work || []);
  const agentProviderState = stable(input.agent_provider_state || {});
  const governanceBindings = stable(input.genesis_intent_icf_policy_bindings || {});
  if (stableString(architectureState) !== "{}" || stableString(runtimeState) !== "{}"
    || stableString(concurrentActiveWork) !== "[]" || stableString(agentProviderState) !== "{}"
    || stableString(governanceBindings) !== "{}") {
    fail("entity360_unqualified_context_section_forbidden");
  }
  return { architecture_state: architectureState, runtime_state: runtimeState,
    concurrent_active_work: concurrentActiveWork, agent_provider_state: agentProviderState,
    genesis_intent_icf_policy_bindings: governanceBindings };
}

function semanticSnapshotBody(snapshot) {
  const { created_at: _createdAt, deterministic_immutable_digest: _digest,
    envelope_digest: _envelope, qualification_attestation: _attestation, ...body } = snapshot;
  return stable(body);
}

export function entity360SnapshotSemanticBody(snapshot) {
  return semanticSnapshotBody(snapshot);
}

function qualificationConsistentCut(snapshot) {
  if (!Array.isArray(snapshot.source_discovery)) {
    fail("entity360_qualification_attestation_source_discovery_invalid");
  }
  const assemblerEntries = snapshot.source_discovery.filter((entry) =>
    entry?.source_id === "entity360_context_assembler");
  if (assemblerEntries.length !== 1
    || assemblerEntries[0].state !== "complete"
    || assemblerEntries[0].consistent_cut !== "postgres_repeatable_read") {
    fail("entity360_qualification_attestation_consistent_cut_invalid");
  }
  return assemblerEntries[0].consistent_cut;
}

function qualificationAttestationPayload(snapshot, semanticDigest) {
  return stable({
    schema_version: "entity_360_qualification_attestation_payload_v1",
    tenant_scope: text(snapshot.tenant_scope, "entity360_qualification_attestation_tenant_invalid",
      120, SOURCE_ID),
    entity_id: text(snapshot.entity_id, "entity360_qualification_attestation_entity_invalid",
      160, SOURCE_ID),
    entity_type: text(snapshot.entity_type, "entity360_qualification_attestation_type_invalid",
      80, ENTITY_TYPE),
    identity_digest: entity360Digest(plainObject(snapshot.identity?.canonical,
      "entity360_qualification_attestation_identity_invalid")),
    snapshot_schema_version: text(snapshot.schema_version,
      "entity360_qualification_attestation_snapshot_schema_invalid", 160, SOURCE_ID),
    snapshot_version: positiveInteger(snapshot.snapshot_version,
      "entity360_qualification_attestation_snapshot_version_invalid"),
    previous_snapshot_digest: snapshot.previous_snapshot_digest === null ? null
      : text(snapshot.previous_snapshot_digest,
        "entity360_qualification_attestation_previous_digest_invalid", 64, SHA256),
    as_of: canonicalRfc3339Timestamp(snapshot.as_of,
      "entity360_qualification_attestation_as_of_invalid"),
    created_at: canonicalRfc3339Timestamp(snapshot.created_at,
      "entity360_qualification_attestation_created_at_invalid"),
    policy_version: text(snapshot.policy_version,
      "entity360_qualification_attestation_policy_version_invalid", 160, SOURCE_ID),
    policy_digest: text(snapshot.policy_digest,
      "entity360_qualification_attestation_policy_digest_invalid", 64, SHA256),
    ontology_version: text(snapshot.ontology_version,
      "entity360_qualification_attestation_ontology_version_invalid", 160, SOURCE_ID),
    ontology_digest: text(snapshot.ontology_digest,
      "entity360_qualification_attestation_ontology_digest_invalid", 64, SHA256),
    adapter_registry_version: text(snapshot.adapter_registry_version,
      "entity360_adapter_registry_version_invalid", 160, SOURCE_ID),
    consistent_cut: qualificationConsistentCut(snapshot),
    qualification_manifest_digest: text(snapshot.qualification_manifest?.manifest_digest,
      "entity360_qualification_attestation_manifest_digest_invalid", 64, SHA256),
    source_discovery_digest: entity360Digest(snapshot.source_discovery),
    project_work_linkage_digest: entity360Digest(plainObject(snapshot.project_work_linkage,
      "entity360_qualification_attestation_project_work_linkage_invalid")),
    snapshot_semantic_digest: text(semanticDigest,
      "entity360_qualification_attestation_semantic_digest_invalid", 64, SHA256),
  });
}

function createQualificationAttestation(snapshot, semanticDigest, signer) {
  if (!signer || typeof signer.sign !== "function") {
    fail("entity360_qualification_signer_required", 503);
  }
  const payload = qualificationAttestationPayload(snapshot, semanticDigest);
  const keyId = text(signer.key_id, "entity360_qualification_signer_key_id_required",
    160, SOURCE_ID);
  if (signer.algorithm !== "hmac-sha256") {
    fail("entity360_qualification_signer_algorithm_invalid", 503);
  }
  const signed = signer.sign(payload, { purpose: ENTITY_360_QUALIFICATION_ATTESTATION_PURPOSE });
  if (signed && typeof signed.then === "function") {
    fail("entity360_qualification_signer_async_unsupported", 503);
  }
  const signature = text(signed, "entity360_qualification_signature_invalid", 4096, SIGNATURE);
  if (signature !== signed) fail("entity360_qualification_signature_invalid");
  return deepFreeze({
    schema_version: ENTITY_360_QUALIFICATION_ATTESTATION_VERSION,
    algorithm: "hmac-sha256",
    purpose: ENTITY_360_QUALIFICATION_ATTESTATION_PURPOSE,
    signer_domain: "host_native_governance",
    key_id: keyId,
    semantic_digest: semanticDigest,
    payload_digest: entity360Digest(payload),
    signature,
  });
}

function verifyQualificationAttestation(snapshot, semanticDigest, verifier) {
  const attestation = exactKeys(snapshot.qualification_attestation,
    QUALIFICATION_ATTESTATION_KEYS, "entity360_qualification_attestation_schema_invalid");
  if (attestation.schema_version !== ENTITY_360_QUALIFICATION_ATTESTATION_VERSION
    || attestation.algorithm !== "hmac-sha256"
    || attestation.purpose !== ENTITY_360_QUALIFICATION_ATTESTATION_PURPOSE
    || attestation.signer_domain !== "host_native_governance") {
    fail("entity360_qualification_attestation_binding_invalid");
  }
  const keyId = text(attestation.key_id, "entity360_qualification_attestation_key_id_invalid",
    160, SOURCE_ID);
  text(attestation.semantic_digest, "entity360_qualification_attestation_semantic_digest_invalid",
    64, SHA256);
  text(attestation.payload_digest, "entity360_qualification_attestation_payload_digest_invalid",
    64, SHA256);
  const signature = text(attestation.signature,
    "entity360_qualification_attestation_signature_invalid", 4096, SIGNATURE);
  if (signature !== attestation.signature || attestation.semantic_digest !== semanticDigest) {
    fail("entity360_qualification_attestation_semantic_binding_invalid");
  }
  const payload = qualificationAttestationPayload(snapshot, semanticDigest);
  if (attestation.payload_digest !== entity360Digest(payload)) {
    fail("entity360_qualification_attestation_payload_digest_invalid");
  }
  let verified = false;
  try {
    verified = verifier.verify(payload, signature,
      { purpose: ENTITY_360_QUALIFICATION_ATTESTATION_PURPOSE, key_id: keyId });
  } catch {
    fail("entity360_qualification_attestation_signature_invalid");
  }
  if (verified && typeof verified.then === "function") {
    fail("entity360_qualification_verifier_async_unsupported", 503);
  }
  if (verified !== true) fail("entity360_qualification_attestation_signature_invalid");
}

function contextState(resolution, completeness, temporal, admittedCount) {
  if (resolution.status === "AMBIGUOUS") return "AMBIGUOUS";
  if (temporal.contradictions.some((item) => item.blocking !== false)) return "CONFLICTED";
  if (!admittedCount || completeness.missing_context.some((item) => item.mandatory)
    || completeness.corroboration_gaps.length || completeness.authoritative_sources_missing.length) return "INCOMPLETE";
  return "READY";
}

function createQualificationManifest(contributions, rejections, policy) {
  const payload = {
    schema_version: "entity_360_qualification_manifest_v1",
    source_contributions: canonicalSet(contributions.map(compactQualifiedContribution)),
    source_rejections: canonicalSet(rejections),
  };
  const manifestBudget = Math.min(policy.budgets.max_retrieval_bytes,
    policy.budgets.max_context_tokens * 4);
  if (Buffer.byteLength(stableString(payload)) > manifestBudget) {
    fail("entity360_qualification_manifest_budget_exceeded");
  }
  return deepFreeze({ ...payload, manifest_digest: entity360Digest(payload) });
}

function validateQualifiedClaim(claim, contribution, source, snapshot, policy) {
  const compact = exactKeys(claim, QUALIFICATION_CLAIM_KEYS,
    "entity360_qualification_claim_schema_invalid");
  if (Object.hasOwn(compact, "value") || compact.source_id !== source.source_id
    || compact.source_class !== source.source_class || compact.trust_class !== source.trust_class
    || compact.trust_boundary !== source.trust_boundary
    || compact.independence_group !== source.independence_group
    || compact.derived_source !== source.derived
    || compact.authoritative !== sourceAuthoritativeForFact(source, compact.fact_id,
      Date.parse(snapshot.as_of))) {
    fail("entity360_qualification_claim_source_binding_invalid");
  }
  text(compact.fact_id, "entity360_qualification_fact_id_invalid", 160, SOURCE_ID);
  if (!factPrefixAllowed(source.allowed_fact_prefixes, compact.fact_id)) {
    fail("entity360_qualification_fact_contract_invalid");
  }
  text(compact.value_digest, "entity360_qualification_value_digest_invalid", 64, SHA256);
  if (!['normal', 'critical', 'high_impact'].includes(compact.criticality)) {
    fail("entity360_qualification_criticality_invalid");
  }
  finiteNumber(compact.confidence, "entity360_qualification_confidence_invalid");
  const validFrom = canonicalRfc3339Timestamp(compact.valid_from,
    "entity360_qualification_valid_from_invalid");
  const validTo = compact.valid_to === null ? null
    : canonicalRfc3339Timestamp(compact.valid_to, "entity360_qualification_valid_to_invalid");
  if (validTo && Date.parse(validTo) <= Date.parse(validFrom)) {
    fail("entity360_qualification_validity_invalid");
  }
  const observedAt = canonicalRfc3339Timestamp(compact.observed_at,
    "entity360_qualification_observed_at_invalid");
  const recordedAt = canonicalRfc3339Timestamp(compact.recorded_at,
    "entity360_qualification_recorded_at_invalid");
  const asOfMs = Date.parse(snapshot.as_of);
  if (Date.parse(observedAt) > asOfMs + policy.freshness.max_clock_skew_seconds * 1000
    || Date.parse(recordedAt) > asOfMs + policy.freshness.max_clock_skew_seconds * 1000) {
    fail("entity360_qualification_future_time_invalid");
  }
  if (!TEMPORAL_STATES.has(compact.declared_state)) {
    fail("entity360_qualification_temporal_state_invalid");
  }
  if (compact.supersedes_claim_id !== null) {
    text(compact.supersedes_claim_id, "entity360_qualification_supersedes_invalid", 160, SOURCE_ID);
  }
  if (typeof compact.tombstone !== "boolean") fail("entity360_qualification_tombstone_invalid");
  text(compact.evidence_class, "entity360_qualification_evidence_class_invalid", 120, SOURCE_ID);
  if (differsCanonical(compact.evidence_digests,
    normalizeEvidence(compact.evidence_digests, "entity360_qualification_evidence_digest_invalid"))) {
    fail("entity360_qualification_evidence_digest_invalid");
  }
  const evidenceRefs = canonicalSet((compact.evidence_refs || []).map((item) =>
    text(item, "entity360_qualification_evidence_ref_invalid", 2_000)));
  if (differsCanonical(compact.evidence_refs, evidenceRefs)) {
    fail("entity360_qualification_evidence_ref_invalid");
  }
  text(compact.source_watermark, "entity360_qualification_watermark_invalid", 240, SOURCE_ID);
  const expectedClaimId = `ecl_${entity360Digest(claimIdentityBody(compact)).slice(0, 48)}`;
  if (compact.claim_id !== expectedClaimId) fail("entity360_qualification_claim_digest_invalid");
  const bytes = positiveInteger(compact.bytes, "entity360_qualification_bytes_invalid",
    policy.budgets.max_retrieval_bytes * 8);
  const minimumBytes = Buffer.byteLength(stableString(claimIdentityBody(compact)));
  if (bytes < minimumBytes || compact.tokens !== Math.max(1, Math.ceil(bytes / 4))) {
    fail("entity360_qualification_occupancy_measurement_invalid");
  }
  const current = snapshot.current_state?.[compact.fact_id];
  const currentValueValid = current?.value_digest === compact.value_digest
    && entity360Digest(current.value) === compact.value_digest;
  return { ...compact,
    value: currentValueValid ? current.value
      : { entity360_opaque_value_digest: compact.value_digest },
    contribution_digest: contribution.contribution_digest,
    adapter_version: contribution.adapter_version,
  };
}

function differsCanonical(left, right) {
  return stableString(left) !== stableString(right);
}

function rebuildQualificationManifest(snapshot, policy) {
  const manifest = exactKeys(snapshot.qualification_manifest, QUALIFICATION_MANIFEST_KEYS,
    "entity360_qualification_manifest_schema_invalid");
  if (manifest.schema_version !== "entity_360_qualification_manifest_v1") {
    fail("entity360_qualification_manifest_schema_invalid");
  }
  const sourceContributions = Array.isArray(manifest.source_contributions)
    ? manifest.source_contributions : fail("entity360_qualification_contributions_invalid");
  const sourceRejections = Array.isArray(manifest.source_rejections)
    ? manifest.source_rejections : fail("entity360_qualification_rejections_invalid");
  const payload = { schema_version: manifest.schema_version,
    source_contributions: sourceContributions, source_rejections: sourceRejections };
  if (manifest.manifest_digest !== entity360Digest(payload)) {
    fail("entity360_qualification_manifest_digest_invalid");
  }
  const manifestBudget = Math.min(policy.budgets.max_retrieval_bytes,
    policy.budgets.max_context_tokens * 4);
  if (Buffer.byteLength(stableString(payload)) > manifestBudget) {
    fail("entity360_qualification_manifest_budget_exceeded");
  }
  const rebuilt = [];
  for (const stored of sourceContributions) {
    const contribution = exactKeys(stored, QUALIFICATION_CONTRIBUTION_KEYS,
      "entity360_qualification_contribution_schema_invalid");
    if (Object.hasOwn(contribution, "tenant_id") || Object.hasOwn(contribution, "entity_id")) {
      fail("entity360_qualification_scope_duplication_invalid");
    }
    const source = policy.source_registry[contribution.source_id];
    if (!source || contribution.source_class !== source.source_class
      || contribution.trust_class !== source.trust_class
      || contribution.trust_boundary !== source.trust_boundary
      || contribution.independence_group !== source.independence_group
      || !source.adapter_versions.includes(contribution.adapter_version)) {
      fail("entity360_qualification_contribution_source_binding_invalid");
    }
    text(contribution.source_watermark, "entity360_qualification_watermark_invalid", 240, SOURCE_ID);
    canonicalRfc3339Timestamp(contribution.observed_at,
      "entity360_qualification_observed_at_invalid");
    canonicalRfc3339Timestamp(contribution.recorded_at,
      "entity360_qualification_recorded_at_invalid");
    text(contribution.evidence_class, "entity360_qualification_evidence_class_invalid", 120, SOURCE_ID);
    if (differsCanonical(contribution.evidence_digests, normalizeEvidence(contribution.evidence_digests,
      "entity360_qualification_evidence_digest_invalid"))) {
      fail("entity360_qualification_evidence_digest_invalid");
    }
    const contributionEvidenceRefs = canonicalSet((contribution.evidence_refs || []).map((item) =>
      text(item, "entity360_qualification_evidence_ref_invalid", 2_000)));
    if (differsCanonical(contribution.evidence_refs, contributionEvidenceRefs)) {
      fail("entity360_qualification_evidence_ref_invalid");
    }
    finiteNumber(contribution.confidence, "entity360_qualification_confidence_invalid");
    if (!Array.isArray(contribution.facts) || !contribution.facts.length) {
      fail("entity360_qualification_facts_invalid");
    }
    if (differsCanonical(contribution.facts, canonicalSet(contribution.facts))) {
      fail("entity360_qualification_fact_order_invalid");
    }
    const hydratedFacts = contribution.facts.map((claim) =>
      validateQualifiedClaim(claim, contribution, source, snapshot, policy));
    if (contribution.contribution_digest !== entity360Digest(contributionDigestBody(contribution))) {
      fail("entity360_qualification_contribution_digest_invalid");
    }
    rebuilt.push({ ...contribution, facts: hydratedFacts });
  }
  if (stableString(canonicalSet(sourceContributions)) !== stableString(sourceContributions)) {
    fail("entity360_qualification_contribution_order_invalid");
  }
  for (const rejection of sourceRejections) {
    const source = policy.source_registry[rejection?.source_id];
    const reason = rejection?.reason_codes?.[0];
    exactKeys(rejection, reason === "FACT_CONTRACT_VIOLATION"
      ? QUALIFICATION_FACT_CONTRACT_REJECTION_KEYS : QUALIFICATION_REJECTION_KEYS,
    "entity360_qualification_rejection_schema_invalid");
    const rejectedFactIds = Array.isArray(rejection?.rejected_fact_ids)
      ? canonicalSet(rejection.rejected_fact_ids.map((factId) =>
        text(factId, "entity360_qualification_rejected_fact_invalid", 160, SOURCE_ID))) : [];
    const factContractRejection = reason === "FACT_CONTRACT_VIOLATION" && source
      && source.adapter_versions.includes(rejection.adapter_version)
      && rejectedFactIds.length > 0
      && rejectedFactIds.every((factId) => !factPrefixAllowed(source.allowed_fact_prefixes, factId))
      && stableString(rejectedFactIds) === stableString(rejection.rejected_fact_ids)
      && rejection.rejection_digest === entity360Digest({ source_id: rejection.source_id,
        adapter_version: rejection.adapter_version, reason_code: reason,
        rejected_fact_ids: rejectedFactIds });
    const sourceNotValid = source && source.adapter_versions.includes(rejection?.adapter_version)
      && (reason === "SOURCE_REVOKED" && source.revoked
        || reason === "SOURCE_NOT_VALID_AS_OF" && !source.revoked
          && (source.valid_from && Date.parse(source.valid_from) > Date.parse(snapshot.as_of)
            || source.valid_until && Date.parse(source.valid_until) <= Date.parse(snapshot.as_of)));
    const valid = rejection?.status === "rejected"
      && Array.isArray(rejection.reason_codes) && rejection.reason_codes.length === 1
      && (reason === "SOURCE_NOT_REGISTERED" && !source
        || reason === "ADAPTER_VERSION_NOT_ALLOWED" && source
          && !source.adapter_versions.includes(rejection.adapter_version)
        || factContractRejection || sourceNotValid);
    if (!valid) fail("entity360_qualification_rejection_invalid");
  }
  if (stableString(canonicalSet(sourceRejections)) !== stableString(sourceRejections)) {
    fail("entity360_qualification_rejection_order_invalid");
  }
  return { source_contributions: rebuilt, source_rejections: sourceRejections };
}

export function assembleEntity360Snapshot(input = {}, options = {}) {
  const policy = options.policy?.policy_digest ? options.policy : compileEntity360Policy(options.policy);
  const ontology = compileEntity360Ontology(options.ontology);
  const adapterRegistryVersion = text(options.adapter_registry_version,
    "entity360_adapter_registry_version_required", 160, SOURCE_ID);
  const tenantId = text(input.tenant_id, "entity360_tenant_required", 120, SOURCE_ID);
  const entityType = text(input.entity_type, "entity360_entity_type_required", 80, ENTITY_TYPE);
  if (!ontology.entity_types.some((item) => item.type === entityType)) fail("entity360_entity_type_not_registered");
  const asOf = timestamp(input.as_of, "entity360_as_of_required");
  const asOfMs = Date.parse(asOf);
  const createdAt = timestamp(options.created_at || new Date().toISOString(),
    "entity360_created_at_invalid");
  if (Date.parse(createdAt) + policy.freshness.max_clock_skew_seconds * 1000 < asOfMs) {
    fail("entity360_as_of_after_creation_invalid");
  }
  const resolution = resolveEntity360Identity({ tenant_id: tenantId, entity_type: entityType,
    identity: input.identity, entity_id: input.entity_id, candidates: input.resolution_candidates || [],
    require_existing: options.require_existing === true });
  const entityId = resolution.entity_id || `${resolution.status.toLowerCase()}_${entity360Digest({ tenant_id: tenantId, entity_type: entityType,
    identity: resolution.identity }).slice(0, 48)}`;
  const snapshotVersion = positiveInteger(input.snapshot_version, "entity360_snapshot_version_required");
  const previousSnapshotDigest = input.previous_snapshot_digest === undefined
    || input.previous_snapshot_digest === null ? null
    : text(input.previous_snapshot_digest, "entity360_previous_snapshot_digest_invalid", 64, SHA256);
  if (snapshotVersion === 1 && previousSnapshotDigest !== null
    || snapshotVersion > 1 && previousSnapshotDigest === null) {
    fail("entity360_previous_snapshot_binding_invalid");
  }
  const scope = { tenant_id: tenantId, entity_id: entityId };
  const rawContributions = Array.isArray(input.source_contributions) ? input.source_contributions : [];
  if (rawContributions.length > 2_000) fail("entity360_source_contribution_budget_exceeded");
  const acceptedContributions = []; const rejectedBeforeOccupancy = [];
  for (const raw of rawContributions) {
    const normalized = normalizeContribution(raw, scope, policy, asOfMs);
    if (normalized.accepted) acceptedContributions.push(normalized.contribution);
    else rejectedBeforeOccupancy.push({ source_id: normalized.source_id,
      adapter_version: normalized.adapter_version, status: "rejected", reason_codes: [normalized.reason],
      ...(normalized.rejected_fact_ids ? { rejected_fact_ids: normalized.rejected_fact_ids,
        rejection_digest: normalized.rejection_digest } : {}) });
  }
  const qualificationManifest = createQualificationManifest(acceptedContributions,
    rejectedBeforeOccupancy, policy);
  const occupancy = applyBoundedSourceOccupancy(acceptedContributions, policy, entityType);
  const temporal = reconcileEntity360TemporalState(occupancy.admitted_claims, asOf, policy, entityType);
  const corroboration = evaluateEntity360Corroboration(temporal, entityType, policy);
  const completeness = evaluateEntity360Completeness({ entity_type: entityType, temporal, corroboration, policy });
  const { relationships, dependencies } = normalizeSnapshotLinks({
    relationships: input.relationships || [], dependencies: input.dependencies || [],
    scope, ontology, policy,
  });
  const derivedProjectWorkLinkage = deriveProjectWorkLinkage({ entityType,
    identity: resolution.identity, currentState: temporal.current_state });
  const projectWorkLinkage = normalizeProjectWorkLinkage(input.project_work_linkage || {},
    derivedProjectWorkLinkage, entityType);
  const contextSections = requireEmptyV1ContextSections(input);
  const sourceDiscovery = normalizeSourceDiscovery(input.source_discovery || [], scope, policy);
  validateSourceDiscoverySemantics(sourceDiscovery, { source_contributions: acceptedContributions });
  const evidenceDigests = canonicalSet(occupancy.admitted_claims.flatMap((claim) => claim.evidence_digests));
  const evidenceReferences = canonicalSet(occupancy.admitted_claims.flatMap((claim) => claim.evidence_refs));
  const sourceIds = [...new Set(occupancy.admitted_claims.map((claim) => claim.source_id))].sort();
  const independenceGroups = [...new Set(occupancy.admitted_claims.filter((claim) => !claim.derived_source)
    .map((claim) => claim.independence_group))].sort();
  const decisions = [...occupancy.decisions, ...rejectedBeforeOccupancy]
    .sort((left, right) => lexical(left.contribution_digest || left.source_id,
      right.contribution_digest || right.source_id));
  const status = contextState(resolution, completeness, temporal, occupancy.admitted_claims.length);
  const sourceProvenance = canonicalSet(sourceIds.map((sourceId) => {
    const source = policy.source_registry[sourceId];
    return {
      source_id: source.source_id,
      source_class: source.source_class,
      trust_class: source.trust_class,
      trust_boundary: source.trust_boundary,
      independence_group: source.independence_group,
      adapter_versions: source.adapter_versions,
      allowed_fact_prefixes: source.allowed_fact_prefixes,
      blocking_conflict_fact_prefixes: source.blocking_conflict_fact_prefixes,
      authoritative: source.authoritative,
      derived: source.derived,
    };
  }));
  const snapshot = {
    schema_version: ENTITY_360_SCHEMA_VERSION,
    adapter_registry_version: adapterRegistryVersion,
    ontology_version: ontology.ontology_version,
    ontology_digest: entity360Digest(ontology),
    policy_version: policy.policy_version,
    policy_digest: policy.policy_digest,
    canonicalization_version: ENTITY_360_CANONICALIZATION_VERSION,
    digest_algorithm: ENTITY_360_DIGEST_ALGORITHM,
    snapshot_version: snapshotVersion,
    previous_snapshot_digest: previousSnapshotDigest,
    entity_id: entityId,
    entity_type: entityType,
    tenant_scope: tenantId,
    project_work_linkage: projectWorkLinkage,
    identity: {
      canonical: resolution.identity,
      resolution_status: resolution.status,
      candidate_entity_ids: resolution.status === "RESOLVED" ? [entityId] : resolution.candidates,
      missing_disambiguation: resolution.missing_disambiguation,
    },
    context_status: status,
    current_state: temporal.current_state,
    historical_state_references: temporal.historical_state_references,
    superseded_state_references: temporal.superseded_state_references,
    stale_state_references: temporal.stale_state_references,
    relationships,
    dependencies,
    architecture_state: contextSections.architecture_state,
    runtime_state: contextSections.runtime_state,
    concurrent_active_work: contextSections.concurrent_active_work,
    agent_provider_state: contextSections.agent_provider_state,
    source_provenance: sourceProvenance,
    source_discovery: sourceDiscovery,
    evidence_references: evidenceReferences,
    evidence_digests: evidenceDigests,
    genesis_intent_icf_policy_bindings: contextSections.genesis_intent_icf_policy_bindings,
    security_risk_signals: canonicalSet([
      ...(resolution.status === "AMBIGUOUS" ? [{ code: "AMBIGUOUS_ENTITY_RESOLUTION", severity: "high" }] : []),
      ...(resolution.status === "UNRESOLVED" ? [{ code: "ENTITY_RESOLUTION_NOT_FOUND", severity: "high" }] : []),
      ...decisions.filter((item) => item.status !== "accepted").map((item) => ({
        code: item.status === "limited" ? "SOURCE_CONTRIBUTION_LIMITED" : "SOURCE_CONTRIBUTION_REJECTED",
        severity: "medium",
        source_id: item.source_id,
        reason_codes: item.reason_codes,
      })),
      ...(temporal.contradictions.length ? [{ code: "CONTRADICTORY_CURRENT_EVIDENCE", severity: "high" }] : []),
    ]),
    contradictions_conflicts: temporal.contradictions,
    freshness: {
      as_of: asOf,
      stale_source_count: completeness.stale_sources.length,
      freshest_observation_at: occupancy.admitted_claims.map((claim) => claim.observed_at).sort().at(-1) || null,
      oldest_observation_at: occupancy.admitted_claims.map((claim) => claim.observed_at).sort().at(0) || null,
    },
    completeness: completeness.completeness,
    confidence: completeness.confidence,
    missing_context: completeness.missing_context,
    stale_sources: completeness.stale_sources,
    contradictions: completeness.contradictions,
    corroboration_gaps: completeness.corroboration_gaps,
    authoritative_sources_missing: completeness.authoritative_sources_missing,
    source_diversity: {
      source_count: sourceIds.length,
      independence_group_count: independenceGroups.length,
      independence_groups: independenceGroups,
      ratio: sourceIds.length ? independenceGroups.length / sourceIds.length : 0,
    },
    corroboration_state: corroboration,
    qualification_manifest: qualificationManifest,
    qualification_attestation: null,
    assembly_report: {
      decisions,
      occupancy: occupancy.occupancy,
      admitted_claim_count: occupancy.admitted_claims.length,
      rejected_source_contribution_count: decisions.filter((item) => item.status === "rejected").length,
      limited_source_contribution_count: decisions.filter((item) => item.status === "limited").length,
    },
    core_verification_required: true,
    content_semantics: "data_only_non_executable",
    architecture_separation: ["CONTEXT", "REASONING", "AUTHORITY", "EXECUTION", "EVIDENCE"],
    core_review_requirement: status === "AMBIGUOUS" || status === "CONFLICTED"
      ? { condition: status, admissible_outcomes: ["HOLD"] }
      : status === "INCOMPLETE"
        ? { condition: "MANDATORY_CONTEXT_MISSING", admissible_outcomes: ["INSUFFICIENT_CONTEXT", "HOLD"] }
        : { condition: "CONTEXT_READY_FOR_INDEPENDENT_VERIFICATION", admissible_outcomes: ["ALLOW", "HOLD", "BLOCK"] },
    execution_authorized: false,
    authority: "universal_core",
    production_decision_mutation: false,
    as_of: asOf,
    created_at: createdAt,
    deterministic_immutable_digest: null,
    envelope_digest: null,
  };
  const semanticForDigest = semanticSnapshotBody(snapshot);
  snapshot.deterministic_immutable_digest = entity360Digest(semanticForDigest);
  snapshot.qualification_attestation = createQualificationAttestation(snapshot,
    snapshot.deterministic_immutable_digest, options.qualification_signer);
  snapshot.envelope_digest = entity360Digest({
    semantic_digest: snapshot.deterministic_immutable_digest,
    created_at: snapshot.created_at,
    schema_version: snapshot.schema_version,
  });
  return deepFreeze(snapshot);
}

export function verifyEntity360Snapshot(snapshot, { policy, ontology, verification_time, persisted_at,
  qualification_verifier } = {}) {
  const reasons = [];
  try {
    plainObject(snapshot, "entity360_snapshot_invalid");
    const compiledPolicy = policy?.policy_digest ? policy : compileEntity360Policy(policy);
    const compiledOntology = compileEntity360Ontology(ontology);
    const differs = (left, right) => stableString(left) !== stableString(right);
    const qualificationVerifierAvailable = Boolean(qualification_verifier
      && typeof qualification_verifier.verify === "function"
      && typeof qualification_verifier.sign !== "function");
    if (!qualificationVerifierAvailable) reasons.push("QUALIFICATION_VERIFIER_REQUIRED");
    let verificationTime = null; let persistedAt = null;
    try {
      verificationTime = canonicalRfc3339Timestamp(verification_time,
        "entity360_trusted_verification_time_required");
      persistedAt = persisted_at === undefined || persisted_at === null ? null
        : canonicalRfc3339Timestamp(persisted_at, "entity360_persisted_at_invalid");
    } catch (error) {
      reasons.push(String(error?.code || "TRUSTED_VERIFICATION_TIME_INVALID"));
    }
    if (differs(Object.keys(snapshot).sort(), [...ENTITY_360_SNAPSHOT_ROOT_FIELDS].sort())) {
      reasons.push("SNAPSHOT_ROOT_SCHEMA_INVALID");
    }
    if (snapshot.schema_version !== ENTITY_360_SCHEMA_VERSION) reasons.push("SCHEMA_VERSION_INVALID");
    try {
      text(snapshot.adapter_registry_version, "entity360_adapter_registry_version_invalid",
        160, SOURCE_ID);
    } catch (error) {
      reasons.push(String(error?.code || "ADAPTER_REGISTRY_VERSION_INVALID"));
    }
    if (snapshot.canonicalization_version !== ENTITY_360_CANONICALIZATION_VERSION
      || snapshot.digest_algorithm !== ENTITY_360_DIGEST_ALGORITHM) {
      reasons.push("CANONICALIZATION_BINDING_INVALID");
    }
    if (snapshot.policy_version !== compiledPolicy.policy_version || snapshot.policy_digest !== compiledPolicy.policy_digest) {
      reasons.push("POLICY_BINDING_INVALID");
    }
    if (snapshot.ontology_version !== compiledOntology.ontology_version
      || snapshot.ontology_digest !== entity360Digest(compiledOntology)) {
      reasons.push("ONTOLOGY_BINDING_INVALID");
    }
    if (!CONTEXT_STATES.has(snapshot.context_status)) reasons.push("CONTEXT_STATUS_INVALID");
    if (snapshot.execution_authorized !== false || snapshot.authority !== "universal_core"
      || snapshot.production_decision_mutation !== false
      || snapshot.core_verification_required !== true) reasons.push("AUTHORITY_BOUNDARY_INVALID");
    if (snapshot.content_semantics !== "data_only_non_executable"
      || stableString(snapshot.architecture_separation) !== stableString([
        "CONTEXT", "REASONING", "AUTHORITY", "EXECUTION", "EVIDENCE",
      ])) reasons.push("ARCHITECTURE_SEPARATION_INVALID");
    if (!Number.isSafeInteger(snapshot.snapshot_version) || snapshot.snapshot_version < 1) {
      reasons.push("SNAPSHOT_VERSION_INVALID");
    }
    try {
      canonicalRfc3339Timestamp(snapshot.as_of, "entity360_snapshot_as_of_rfc3339_invalid");
      canonicalRfc3339Timestamp(snapshot.created_at, "entity360_snapshot_created_at_rfc3339_invalid");
    } catch (error) {
      reasons.push(String(error?.code || "SNAPSHOT_TIMESTAMP_INVALID"));
    }
    if (Date.parse(snapshot.created_at) + compiledPolicy.freshness.max_clock_skew_seconds * 1000
      < Date.parse(snapshot.as_of)) reasons.push("SNAPSHOT_TEMPORAL_ANCHOR_INVALID");
    const maximumSkewMs = compiledPolicy.freshness.max_clock_skew_seconds * 1000;
    if (verificationTime && Date.parse(snapshot.created_at) > Date.parse(verificationTime) + maximumSkewMs) {
      reasons.push("SNAPSHOT_CREATED_AT_FUTURE_INVALID");
    }
    if (persistedAt && (Date.parse(snapshot.created_at) > Date.parse(persistedAt) + maximumSkewMs
      || verificationTime && Date.parse(persistedAt) > Date.parse(verificationTime) + maximumSkewMs)) {
      reasons.push("SNAPSHOT_PERSISTENCE_TIME_BINDING_INVALID");
    }
    if (snapshot.snapshot_version === 1 && snapshot.previous_snapshot_digest !== null
      || snapshot.snapshot_version > 1 && !SHA256.test(String(snapshot.previous_snapshot_digest || ""))) {
      reasons.push("PREVIOUS_SNAPSHOT_BINDING_INVALID");
    }
    exactKeys(snapshot.identity, SNAPSHOT_IDENTITY_KEYS, "entity360_snapshot_identity_schema_invalid");
    if (snapshot.identity?.resolution_status !== "RESOLVED"
      || !Array.isArray(snapshot.identity?.candidate_entity_ids)
      || !Array.isArray(snapshot.identity?.missing_disambiguation)
      || snapshot.identity.missing_disambiguation.length !== 0) {
      reasons.push("ENTITY_RESOLUTION_BINDING_INVALID");
    }
    if (differs(snapshot.identity?.candidate_entity_ids, [snapshot.entity_id])) {
      reasons.push("ENTITY_RESOLUTION_CANDIDATE_BINDING_INVALID");
    }
    if (!Number.isFinite(snapshot.completeness) || snapshot.completeness < 0 || snapshot.completeness > 1
      || !Number.isFinite(snapshot.confidence) || snapshot.confidence < 0 || snapshot.confidence > 1) {
      reasons.push("COMPLETENESS_SIGNAL_INVALID");
    }
    if (differs(snapshot.architecture_state, {}) || differs(snapshot.runtime_state, {})
      || differs(snapshot.concurrent_active_work, []) || differs(snapshot.agent_provider_state, {})
      || differs(snapshot.genesis_intent_icf_policy_bindings, {})) {
      reasons.push("UNQUALIFIED_CONTEXT_SECTION_INVALID");
    }
    const scope = { tenant_id: snapshot.tenant_scope, entity_id: snapshot.entity_id };
    const normalizedSourceDiscovery = normalizeSourceDiscovery(snapshot.source_discovery,
      scope, compiledPolicy);
    if (differs(snapshot.source_discovery, normalizedSourceDiscovery)) {
      reasons.push("SOURCE_DISCOVERY_SCHEMA_INVALID");
    }
    const normalizedLinks = normalizeSnapshotLinks({ relationships: snapshot.relationships,
      dependencies: snapshot.dependencies, scope, ontology: compiledOntology, policy: compiledPolicy });
    if (differs(snapshot.relationships, normalizedLinks.relationships)
      || differs(snapshot.dependencies, normalizedLinks.dependencies)) {
      reasons.push("RELATIONSHIP_DERIVATION_INVALID");
    }
    const qualification = rebuildQualificationManifest(snapshot, compiledPolicy);
    validateSourceDiscoverySemantics(normalizedSourceDiscovery, qualification);
    const occupancy = applyBoundedSourceOccupancy(qualification.source_contributions, compiledPolicy,
      snapshot.entity_type);
    const temporal = reconcileEntity360TemporalState(occupancy.admitted_claims,
      snapshot.as_of, compiledPolicy, snapshot.entity_type);
    const corroboration = evaluateEntity360Corroboration(temporal,
      snapshot.entity_type, compiledPolicy);
    const completeness = evaluateEntity360Completeness({ entity_type: snapshot.entity_type,
      temporal, corroboration, policy: compiledPolicy });
    const expectedStatus = contextState({ status: snapshot.identity?.resolution_status },
      completeness, temporal, occupancy.admitted_claims.length);
    const expectedProjectWorkLinkage = deriveProjectWorkLinkage({ entityType: snapshot.entity_type,
      identity: snapshot.identity?.canonical, currentState: temporal.current_state });
    if (differs(snapshot.project_work_linkage, expectedProjectWorkLinkage)) {
      reasons.push("PROJECT_WORK_LINKAGE_DERIVATION_INVALID");
    }
    if (differs(snapshot.current_state, temporal.current_state)
      || differs(snapshot.historical_state_references, temporal.historical_state_references)
      || differs(snapshot.superseded_state_references, temporal.superseded_state_references)
      || differs(snapshot.stale_state_references, temporal.stale_state_references)) {
      reasons.push("TEMPORAL_RECONCILIATION_INVALID");
    }
    if (differs(snapshot.contradictions, temporal.contradictions)
      || differs(snapshot.contradictions_conflicts, temporal.contradictions)) {
      reasons.push("CONTRADICTION_DERIVATION_INVALID");
    }
    if (differs(snapshot.corroboration_state, corroboration)
      || differs(snapshot.corroboration_gaps, corroboration.corroboration_gaps)
      || differs(snapshot.authoritative_sources_missing, corroboration.authoritative_sources_missing)) {
      reasons.push("CORROBORATION_DERIVATION_INVALID");
    }
    if (snapshot.completeness !== completeness.completeness
      || snapshot.confidence !== completeness.confidence
      || differs(snapshot.missing_context, completeness.missing_context)
      || differs(snapshot.stale_sources, completeness.stale_sources)) {
      reasons.push("COMPLETENESS_DERIVATION_INVALID");
    }
    if (snapshot.context_status !== expectedStatus) reasons.push("CONTEXT_STATUS_DERIVATION_INVALID");
    const allowedCoreOutcomes = snapshot.core_review_requirement?.admissible_outcomes;
    const expectedCoreOutcomes = expectedStatus === "AMBIGUOUS" || expectedStatus === "CONFLICTED"
      ? ["HOLD"] : expectedStatus === "INCOMPLETE"
        ? ["INSUFFICIENT_CONTEXT", "HOLD"] : ["ALLOW", "HOLD", "BLOCK"];
    if (differs(allowedCoreOutcomes, expectedCoreOutcomes)) {
      reasons.push("CORE_REVIEW_REQUIREMENT_INVALID");
    }
    const expectedCondition = expectedStatus === "AMBIGUOUS" || expectedStatus === "CONFLICTED"
      ? expectedStatus : expectedStatus === "INCOMPLETE"
        ? "MANDATORY_CONTEXT_MISSING" : "CONTEXT_READY_FOR_INDEPENDENT_VERIFICATION";
    if (snapshot.core_review_requirement?.condition !== expectedCondition) {
      reasons.push("CORE_REVIEW_CONDITION_INVALID");
    }
    const claims = occupancy.admitted_claims;
    const sourceIds = [...new Set(claims.map((claim) => claim.source_id))].sort();
    const expectedProvenance = canonicalSet(sourceIds.map((sourceId) => {
      const source = compiledPolicy.source_registry[sourceId];
      return { source_id: source.source_id, source_class: source.source_class,
        trust_class: source.trust_class, trust_boundary: source.trust_boundary,
        independence_group: source.independence_group, adapter_versions: source.adapter_versions,
        allowed_fact_prefixes: source.allowed_fact_prefixes,
        blocking_conflict_fact_prefixes: source.blocking_conflict_fact_prefixes,
        authoritative: source.authoritative, derived: source.derived };
    }));
    if (differs(snapshot.source_provenance, expectedProvenance)) {
      reasons.push("SOURCE_REGISTRY_BINDING_INVALID");
    }
    const independenceGroups = [...new Set(claims.filter((claim) => !claim.derived_source)
      .map((claim) => claim.independence_group))].sort();
    const expectedDiversity = { source_count: sourceIds.length,
      independence_group_count: independenceGroups.length,
      independence_groups: independenceGroups,
      ratio: sourceIds.length ? independenceGroups.length / sourceIds.length : 0 };
    if (differs(snapshot.source_diversity, expectedDiversity)) reasons.push("SOURCE_DIVERSITY_INVALID");
    const expectedEvidenceDigests = canonicalSet(claims.flatMap((claim) => claim.evidence_digests));
    const expectedEvidenceReferences = canonicalSet(claims.flatMap((claim) => claim.evidence_refs));
    if (differs(snapshot.evidence_digests, expectedEvidenceDigests)
      || differs(snapshot.evidence_references, expectedEvidenceReferences)) {
      reasons.push("EVIDENCE_BINDING_INVALID");
    }
    const expectedDecisions = [...occupancy.decisions, ...qualification.source_rejections]
      .sort((left, right) => lexical(left.contribution_digest || left.source_id,
        right.contribution_digest || right.source_id));
    const assemblyReport = exactKeys(snapshot.assembly_report, ASSEMBLY_REPORT_KEYS,
      "entity360_assembly_report_schema_invalid");
    if (!Array.isArray(assemblyReport.decisions)) fail("entity360_assembly_decisions_invalid");
    for (const decision of assemblyReport.decisions) {
      if (Object.hasOwn(decision, "contribution_digest")) {
        exactKeys(decision, OCCUPANCY_DECISION_KEYS, "entity360_assembly_decision_schema_invalid");
      } else {
        const reason = decision?.reason_codes?.[0];
        exactKeys(decision, reason === "FACT_CONTRACT_VIOLATION"
          ? QUALIFICATION_FACT_CONTRACT_REJECTION_KEYS : QUALIFICATION_REJECTION_KEYS,
        "entity360_assembly_decision_schema_invalid");
      }
    }
    if (differs(snapshot.assembly_report?.decisions, expectedDecisions)
      || differs(snapshot.assembly_report?.occupancy, occupancy.occupancy)
      || snapshot.assembly_report?.admitted_claim_count !== claims.length
      || snapshot.assembly_report?.rejected_source_contribution_count
        !== expectedDecisions.filter((item) => item.status === "rejected").length
      || snapshot.assembly_report?.limited_source_contribution_count
        !== expectedDecisions.filter((item) => item.status === "limited").length) {
      reasons.push("BOUNDED_OCCUPANCY_DERIVATION_INVALID");
    }
    const observedTimes = claims.map((claim) => claim.observed_at).sort();
    const expectedFreshness = { as_of: snapshot.as_of,
      stale_source_count: completeness.stale_sources.length,
      freshest_observation_at: observedTimes.at(-1) || null,
      oldest_observation_at: observedTimes.at(0) || null };
    if (differs(snapshot.freshness, expectedFreshness)) reasons.push("FRESHNESS_DERIVATION_INVALID");
    const expectedSecuritySignals = canonicalSet([
      ...expectedDecisions.filter((item) => item.status !== "accepted").map((item) => ({
        code: item.status === "limited" ? "SOURCE_CONTRIBUTION_LIMITED" : "SOURCE_CONTRIBUTION_REJECTED",
        severity: "medium", source_id: item.source_id, reason_codes: item.reason_codes,
      })),
      ...(temporal.contradictions.length
        ? [{ code: "CONTRADICTORY_CURRENT_EVIDENCE", severity: "high" }] : []),
    ]);
    if (differs(snapshot.security_risk_signals, expectedSecuritySignals)) {
      reasons.push("SECURITY_SIGNAL_DERIVATION_INVALID");
    }
    const semantic = semanticSnapshotBody(snapshot);
    const expected = entity360Digest(semantic);
    if (snapshot.deterministic_immutable_digest !== expected) reasons.push("SEMANTIC_DIGEST_INVALID");
    const envelope = entity360Digest({ semantic_digest: expected, created_at: snapshot.created_at,
      schema_version: snapshot.schema_version });
    if (snapshot.envelope_digest !== envelope) reasons.push("ENVELOPE_DIGEST_INVALID");
    if (!SHA256.test(String(snapshot.deterministic_immutable_digest || ""))) reasons.push("DIGEST_FORMAT_INVALID");
    if (qualificationVerifierAvailable) {
      try {
        verifyQualificationAttestation(snapshot, expected, qualification_verifier);
      } catch (error) {
        reasons.push(String(error?.code || error?.message
          || "QUALIFICATION_ATTESTATION_INVALID"));
      }
    }
    if (deterministicEntity360Id({ tenant_id: snapshot.tenant_scope,
      entity_type: snapshot.entity_type, identity: snapshot.identity?.canonical }) !== snapshot.entity_id) {
      reasons.push("ENTITY_ID_BINDING_INVALID");
    }
  } catch (error) {
    reasons.push(String(error?.code || error?.message || "SNAPSHOT_VALIDATION_FAILED"));
  }
  return deepFreeze({
    schema_version: "entity_360_core_verification_v1",
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    execution_authorized: false,
    authority: "universal_core",
  });
}

export function compareEntity360Shadow({ snapshot, legacy_context_digest, legacy_outcome } = {}) {
  plainObject(snapshot, "entity360_snapshot_required");
  const legacyDigest = text(legacy_context_digest, "entity360_legacy_context_digest_required", 64, SHA256);
  const outcome = text(legacy_outcome, "entity360_legacy_outcome_required", 80, SOURCE_ID).toUpperCase();
  if (!["ALLOW", "HOLD", "BLOCK", "INSUFFICIENT_CONTEXT"].includes(outcome)) {
    fail("entity360_legacy_outcome_invalid");
  }
  const e360Requirement = snapshot.core_review_requirement?.admissible_outcomes || [];
  const diverged = !e360Requirement.includes(outcome);
  const payload = {
    schema_version: "entity_360_shadow_comparison_v1",
    snapshot_digest: snapshot.deterministic_immutable_digest,
    legacy_context_digest: legacyDigest,
    legacy_outcome: outcome,
    entity360_context_status: snapshot.context_status,
    entity360_admissible_core_outcomes: e360Requirement,
    diverged,
    reason_codes: diverged ? ["LEGACY_OUTCOME_OUTSIDE_ENTITY360_CONTEXT_ENVELOPE"] : [],
    comparison_evidence_state: "UNVERIFIED_CALLER_OBSERVATION",
    release_evidence_eligible: false,
    production_decision_changed: false,
    execution_authorized: false,
    authority: "universal_core",
  };
  return deepFreeze({ ...payload, comparison_digest: entity360Digest(payload) });
}
