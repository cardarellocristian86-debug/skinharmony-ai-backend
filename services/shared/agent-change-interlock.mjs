import crypto from "node:crypto";

export const AGENT_CHANGE_INTERLOCK_SCHEMA_VERSION = "agent_change_interlock_v1";

export const INTERLOCK_PLAN = Object.freeze({
  PARALLEL_SAFE: "parallel_safe",
  EXCLUSIVE_LEASE_REQUIRED: "exclusive_lease_required",
  ORDERED_HANDOFF_REQUIRED: "ordered_handoff_required",
  NEW_DECISION_REQUIRED: "new_decision_required",
  MANUAL_REVIEW: "manual_review",
});

const ADAPTER_KINDS = new Set([
  "github", "render", "database", "business_record", "document", "external_resource",
]);
const OPERATION_CLASSES = new Set(["read", "prepare", "write", "deploy", "publish", "rollback"]);
const SECRET_PATTERN = /(?:password|passwd|secret|api[_ -]?key|token|bearer|private[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._~:/@-]{0,479}$/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function requiredText(value, field, max = 480) {
  const result = String(value ?? "").trim();
  if (!result || result.length > max || SECRET_PATTERN.test(result)) throw new Error(`${field}_invalid`);
  return result;
}

function optionalText(value, field, max = 480) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, field, max);
}

function digestOrNull(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const result = requiredText(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${field}_invalid`);
  return result;
}

function canonicalAsset(asset = {}) {
  const adapter = requiredText(asset.adapter, "asset_adapter", 80).toLowerCase();
  const kind = requiredText(asset.kind, "asset_kind", 80).toLowerCase();
  if (!ADAPTER_KINDS.has(adapter) || !SAFE_ID.test(kind)) throw new Error("asset_kind_invalid");
  const reference = requiredText(asset.reference, "asset_reference", 480);
  const segments = reference.split("/");
  if (!SAFE_ID.test(reference) || reference.includes("//") || reference.includes("..")
    || reference.includes("%") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("asset_reference_not_canonical");
  }
  const conflictKey = `${adapter}:${kind}:${reference.toLowerCase()}`;
  return { adapter, kind, reference, conflict_key: conflictKey };
}

function normalizedAssets(assets) {
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > 64) throw new Error("assets_invalid");
  const unique = new Map();
  for (const asset of assets) {
    const canonical = canonicalAsset(asset);
    unique.set(canonical.conflict_key, canonical);
  }
  return [...unique.values()].sort((left, right) => left.conflict_key.localeCompare(right.conflict_key));
}

function redactReference(value) {
  return value.replace(/[A-Za-z0-9]/g, "*").slice(0, 160);
}

/**
 * Creates the immutable, minimal record that a durable Gallery adapter persists.
 * The authoritative tenant comes from the authenticated runtime, never from a caller.
 */
export function buildChangeIntent({ authoritative_tenant_id, input = {}, now = new Date().toISOString() } = {}) {
  const tenantId = requiredText(authoritative_tenant_id, "authoritative_tenant_id", 120);
  if (input.tenant_id && String(input.tenant_id) !== tenantId) throw new Error("tenant_scope_violation");
  const operationClass = requiredText(input.operation_class, "operation_class", 32).toLowerCase();
  if (!OPERATION_CLASSES.has(operationClass)) throw new Error("operation_class_invalid");
  const assets = normalizedAssets(input.assets);
  const binding = {
    schema_version: AGENT_CHANGE_INTERLOCK_SCHEMA_VERSION,
    tenant_id: tenantId,
    work_id: requiredText(input.work_id, "work_id", 160),
    project_id: optionalText(input.project_id, "project_id", 160),
    branch_id: optionalText(input.branch_id, "branch_id", 160),
    operation_class: operationClass,
    assets,
    expected_effect_digest: digestOrNull(input.expected_effect_digest, "expected_effect_digest"),
    rollback_digest: digestOrNull(input.rollback_digest, "rollback_digest"),
    evidence_digest: digestOrNull(input.evidence_digest, "evidence_digest"),
  };
  const assetSetDigest = canonicalDigest(assets.map((asset) => asset.conflict_key));
  const scopeDigest = canonicalDigest(binding);
  const intentId = optionalText(input.intent_id, "intent_id", 160) || `aci_${scopeDigest.slice(0, 24)}`;
  return Object.freeze({
    ...binding,
    intent_id: intentId,
    asset_set_digest: assetSetDigest,
    scope_digest: scopeDigest,
    intent_digest: canonicalDigest({ ...binding, intent_id: intentId, asset_set_digest: assetSetDigest, scope_digest: scopeDigest }),
    created_at: requiredText(now, "created_at", 64),
    execution_allowed: false,
    persistence_requirement: "gallery_append_only_event_and_projection_required",
    public_assets: assets.map((asset) => ({ adapter: asset.adapter, kind: asset.kind, reference: redactReference(asset.reference) })),
  });
}

function prefixesOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function assetOverlap(left, right) {
  if (left.adapter !== right.adapter || left.kind !== right.kind) return false;
  return prefixesOverlap(left.reference.toLowerCase(), right.reference.toLowerCase());
}

export function compareChangeIntents(current, candidate) {
  if (!current || !candidate) throw new Error("intent_required");
  if (current.tenant_id !== candidate.tenant_id) return { classification: "cross_tenant", overlapping_assets: [] };
  // A physical asset collision takes precedence over project/work boundaries.
  // Project identity affects visibility and dependency planning, never safety.
  const overlappingAssets = [];
  for (const left of current.assets || []) for (const right of candidate.assets || []) {
    if (assetOverlap(left, right)) overlappingAssets.push({ left: left.conflict_key, right: right.conflict_key });
  }
  if (overlappingAssets.length) return { classification: "overlap", overlapping_assets: overlappingAssets };
  return { classification: "disjoint", overlapping_assets: [] };
}

/** Advisory only: Core must revalidate an active durable lease before an adapter acts. */
export function proposeInterlockPlan({ candidate, active_intents = [], dependency_intent_digests = [] } = {}) {
  if (!candidate?.intent_digest) throw new Error("candidate_intent_required");
  const conflicts = [];
  for (const current of active_intents) {
    const comparison = compareChangeIntents(current, candidate);
    if (comparison.classification === "cross_tenant") return Object.freeze({
      schema_version: AGENT_CHANGE_INTERLOCK_SCHEMA_VERSION,
      plan: INTERLOCK_PLAN.MANUAL_REVIEW,
      reason_code: "tenant_scope_violation",
      execution_allowed: false,
      candidate_intent_digest: candidate.intent_digest,
      conflicts: [],
    });
    if (comparison.classification === "overlap") conflicts.push({ intent_digest: current.intent_digest, ...comparison });
  }
  const plan = conflicts.length ? INTERLOCK_PLAN.EXCLUSIVE_LEASE_REQUIRED
    : dependency_intent_digests.length ? INTERLOCK_PLAN.ORDERED_HANDOFF_REQUIRED
      : INTERLOCK_PLAN.PARALLEL_SAFE;
  const body = {
    schema_version: AGENT_CHANGE_INTERLOCK_SCHEMA_VERSION,
    candidate_intent_digest: candidate.intent_digest,
    candidate_scope_digest: candidate.scope_digest,
    plan,
    conflicts,
    dependency_intent_digests: [...new Set(dependency_intent_digests)].sort(),
    required_conditions: [
      "authenticated_tenant_binding",
      "durable_gallery_cas_lease",
      "fresh_core_revalidation_before_external_action",
      "atomic_execution_receipt",
    ],
    execution_allowed: false,
  };
  return Object.freeze({ ...body, plan_digest: canonicalDigest(body) });
}

export function buildInterlockRevalidationRequest({ intent, plan, lease_claim, core_decision_digest, current_state_digest } = {}) {
  if (!intent || !plan) throw new Error("interlock_revalidation_required");
  if (plan.candidate_intent_digest !== intent.intent_digest || plan.candidate_scope_digest !== intent.scope_digest) {
    throw new Error("scope_expansion_requires_new_intent");
  }
  if (!lease_claim || lease_claim.intent_digest !== intent.intent_digest || lease_claim.scope_digest !== intent.scope_digest) {
    throw new Error("active_interlock_lease_required");
  }
  if (!digestOrNull(core_decision_digest, "core_decision_digest") || !digestOrNull(current_state_digest, "current_state_digest")) {
    throw new Error("fresh_core_revalidation_required");
  }
  return Object.freeze({
    schema_version: AGENT_CHANGE_INTERLOCK_SCHEMA_VERSION,
    intent_digest: intent.intent_digest,
    plan_digest: plan.plan_digest,
    lease_id: requiredText(lease_claim.lease_id, "lease_id", 160),
    core_decision_digest: core_decision_digest.toLowerCase(),
    current_state_digest: current_state_digest.toLowerCase(),
    execution_allowed: false,
    next_action: "gallery_must_transactionally_validate_lease_and_consume_one_shot_execution_receipt",
  });
}

// Compatibility alias for Phase 1 callers. It only builds a request and never
// verifies a durable lease or authorizes adapter execution.
export function validateInterlockRevalidation({ intent, plan, active_lease, core_decision_digest, current_state_digest } = {}) {
  return buildInterlockRevalidationRequest({ intent, plan, lease_claim: active_lease, core_decision_digest, current_state_digest });
}
