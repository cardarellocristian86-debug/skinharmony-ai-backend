import crypto from "node:crypto";

import { branchExposureClassification } from "../branches/branch-exposure-classification.js";
import {
  BRANCH_EXPOSURE_CONTRACT_VERSION,
  CANONICAL_CLIENT_AUDIENCE,
  branchAvailableForContext,
  branchExposureValidation,
  clientAudiencePairValid,
} from "./branchExposure.js";

export const RESOURCE_VISIBILITY_SCHEMA_VERSION = "resource_visibility_v1";

const EXPOSURE_PRIORITY = Object.freeze({
  chatgpt_horizontal: 1,
  codex_internal: 2,
  software_adjacent: 3,
  admin_only: 4,
  test_only: 5,
});

const LEARNING_COLLECTION_BRANCH = Object.freeze({
  evaluation_scorecards: "ai_evaluation_intelligence",
  dataset_metadata: "learning_data_governance",
  causal_experiments: "experiment_causal_learning",
  performance_scorecards: "ai_runtime_performance_intelligence",
  learning_outcomes: "adaptive_learning_intelligence",
});

function uniqueStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].sort()
    : [];
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (key !== "visibility_digest" && value[key] !== undefined) {
      output[key] = canonical(value[key]);
    }
    return output;
  }, {});
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function normalizedContext(context, tenantId = "") {
  const source = context && typeof context === "object" ? context : {};
  return Object.freeze({
    tenant_id: String(source.tenant_id || source.tenantId || tenantId || "").trim(),
    client_type: String(source.client_type || source.clientType || "").trim(),
    audience: String(source.audience || "").trim(),
    entitlements: Object.freeze(uniqueStrings(source.entitlements)),
    role: String(source.role || "").trim(),
  });
}

function exposureProfile(branchId) {
  const profile = branchExposureClassification(branchId);
  if (!branchExposureValidation(profile).ok) throw new Error("resource_visibility_branch_unclassified");
  return profile;
}

function profileSet(branchIds) {
  const ids = uniqueStrings(branchIds);
  if (!ids.length) throw new Error("resource_visibility_branch_required");
  return ids.map((branchId) => ({ branch_id: branchId, profile: exposureProfile(branchId) }));
}

function profileIntersection(entries) {
  let clientTypes = null;
  for (const { profile } of entries) {
    const allowed = new Set(profile.allowed_client_types);
    clientTypes = clientTypes === null
      ? new Set(allowed)
      : new Set([...clientTypes].filter((clientType) => allowed.has(clientType)));
  }
  const allowedClientTypes = [...(clientTypes || new Set())].sort();
  const allowedAudiences = allowedClientTypes
    .map((clientType) => CANONICAL_CLIENT_AUDIENCE[clientType])
    .filter((audience) =>
      entries.every(({ profile }) => profile.allowed_audiences.includes(audience)))
    .sort();
  const canonicalClients = allowedClientTypes.filter((clientType) =>
    allowedAudiences.includes(CANONICAL_CLIENT_AUDIENCE[clientType]));
  if (!canonicalClients.length || canonicalClients.length !== allowedClientTypes.length) {
    throw new Error("resource_visibility_policy_intersection_empty");
  }
  const exposureClass = entries
    .map(({ profile }) => profile.exposure_class)
    .sort((left, right) => EXPOSURE_PRIORITY[right] - EXPOSURE_PRIORITY[left])[0];
  return {
    exposure_class: exposureClass,
    allowed_client_types: canonicalClients,
    allowed_audiences: allowedAudiences,
    required_entitlements: uniqueStrings(
      entries.flatMap(({ profile }) => profile.required_entitlements),
    ),
  };
}

function defaultOrigin(exposureClass) {
  if (exposureClass === "chatgpt_horizontal" || exposureClass === "codex_internal") {
    return {
      tenant_id: "",
      client_type: "codex",
      audience: "codex_internal",
      entitlements: [],
      role: "internal_runtime",
    };
  }
  if (exposureClass === "admin_only" || exposureClass === "test_only") {
    return {
      tenant_id: "",
      client_type: "admin",
      audience: "admin_control_room",
      entitlements: [],
      role: "admin_runtime",
    };
  }
  throw new Error("resource_visibility_adjacent_origin_required");
}

function policySnapshot(entries, policy) {
  return sha256({
    schema_version: RESOURCE_VISIBILITY_SCHEMA_VERSION,
    branch_exposure_contract: BRANCH_EXPOSURE_CONTRACT_VERSION,
    branches: entries.map(({ branch_id, profile }) => ({
      branch_id,
      exposure_class: profile.exposure_class,
      allowed_client_types: profile.allowed_client_types,
      allowed_audiences: profile.allowed_audiences,
      required_entitlements: profile.required_entitlements,
    })),
    policy,
  });
}

function arraysEqual(left, right) {
  const a = uniqueStrings(left);
  const b = uniqueStrings(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function learningRecordBranchIds(collection, record = {}) {
  const name = String(collection || "").trim();
  if (name === "learning_candidates") {
    const candidateType = String(record.candidate_type || "").trim();
    if (candidateType === "dataset") return ["learning_data_governance"];
    if (candidateType === "skill") return ["agent_orchestration"];
    return ["model_adaptation_lab"];
  }
  const branchId = LEARNING_COLLECTION_BRANCH[name];
  if (!branchId) throw new Error("resource_visibility_collection_unclassified");
  return [branchId];
}

export function createResourceVisibilityBinding({
  tenant_id,
  branch_ids,
  origin_context = null,
  domain_pack_id = "",
  created_at = new Date().toISOString(),
} = {}) {
  const tenantId = String(tenant_id || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,119}$/i.test(tenantId)) {
    throw new Error("resource_visibility_tenant_invalid");
  }
  const entries = profileSet(branch_ids);
  const policy = profileIntersection(entries);
  const origin = normalizedContext(origin_context || defaultOrigin(policy.exposure_class), tenantId);
  if (!origin.tenant_id) {
    origin.tenant_id = tenantId;
  }
  if (
    origin.tenant_id !== tenantId
    || !clientAudiencePairValid(origin.client_type, origin.audience)
    || !policy.allowed_client_types.includes(origin.client_type)
    || !policy.allowed_audiences.includes(origin.audience)
    || !entries.every(({ profile }) => branchAvailableForContext(profile, origin))
  ) {
    throw new Error("resource_visibility_origin_not_authorized");
  }
  const createdAt = new Date(created_at);
  if (Number.isNaN(createdAt.getTime())) throw new Error("resource_visibility_created_at_invalid");
  const normalizedDomainPack = policy.exposure_class === "chatgpt_horizontal"
    ? "generic"
    : String(domain_pack_id || "generic").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(normalizedDomainPack)) {
    throw new Error("resource_visibility_domain_pack_invalid");
  }
  const binding = {
    schema_version: RESOURCE_VISIBILITY_SCHEMA_VERSION,
    tenant_id: tenantId,
    exposure_class: policy.exposure_class,
    origin_client_type: origin.client_type,
    origin_audience: origin.audience,
    allowed_client_types: policy.allowed_client_types,
    allowed_audiences: policy.allowed_audiences,
    required_entitlements: policy.required_entitlements,
    branch_ids: entries.map(({ branch_id }) => branch_id).sort(),
    domain_pack_id: normalizedDomainPack,
    policy_snapshot: policySnapshot(entries, policy),
    created_at: createdAt.toISOString(),
  };
  return Object.freeze({
    ...binding,
    visibility_digest: sha256(binding),
  });
}

export function validateResourceVisibilityBinding(binding, {
  tenant_id = "",
} = {}) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return { ok: false, reason: "resource_visibility_missing" };
  }
  try {
    if (binding.schema_version !== RESOURCE_VISIBILITY_SCHEMA_VERSION) {
      throw new Error("resource_visibility_schema_invalid");
    }
    const tenantId = String(tenant_id || binding.tenant_id || "").trim();
    if (!tenantId || binding.tenant_id !== tenantId) {
      throw new Error("resource_visibility_tenant_mismatch");
    }
    if (!clientAudiencePairValid(binding.origin_client_type, binding.origin_audience)) {
      throw new Error("resource_visibility_origin_invalid");
    }
    const entries = profileSet(binding.branch_ids);
    const policy = profileIntersection(entries);
    if (
      binding.exposure_class !== policy.exposure_class
      || !arraysEqual(binding.allowed_client_types, policy.allowed_client_types)
      || !arraysEqual(binding.allowed_audiences, policy.allowed_audiences)
      || !arraysEqual(binding.required_entitlements, policy.required_entitlements)
      || !binding.allowed_client_types.includes(binding.origin_client_type)
      || !binding.allowed_audiences.includes(binding.origin_audience)
      || (
        binding.exposure_class === "chatgpt_horizontal"
        && binding.domain_pack_id !== "generic"
      )
      || binding.policy_snapshot !== policySnapshot(entries, policy)
      || !/^sha256:[a-f0-9]{64}$/.test(String(binding.visibility_digest || ""))
      || binding.visibility_digest !== sha256(binding)
      || Number.isNaN(Date.parse(String(binding.created_at || "")))
    ) throw new Error("resource_visibility_binding_invalid");
    return { ok: true, binding };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message || "resource_visibility_binding_invalid"),
    };
  }
}

export function resourceVisibleToContext(record, context, {
  tenant_id = "",
  allow_legacy_admin = true,
} = {}) {
  const caller = normalizedContext(context, tenant_id);
  if (!clientAudiencePairValid(caller.client_type, caller.audience)) return false;
  if (caller.tenant_id !== String(tenant_id || record?.tenant_id || "")) return false;
  const validation = validateResourceVisibilityBinding(record?.resource_visibility, {
    tenant_id: caller.tenant_id,
  });
  if (!validation.ok) {
    return Boolean(
      allow_legacy_admin
      && caller.client_type === "admin"
      && caller.audience === "admin_control_room",
    );
  }
  const binding = validation.binding;
  if (
    !binding.allowed_client_types.includes(caller.client_type)
    || !binding.allowed_audiences.includes(caller.audience)
    || (
      caller.client_type === "chatgpt"
      && (
        binding.exposure_class !== "chatgpt_horizontal"
        || binding.domain_pack_id !== "generic"
      )
    )
  ) return false;
  const entitlements = new Set(caller.entitlements);
  if (!binding.required_entitlements.every((entitlement) => entitlements.has(entitlement))) {
    return false;
  }
  return binding.branch_ids.every((branchId) =>
    branchAvailableForContext(exposureProfile(branchId), caller));
}

export function filterVisibleResources(records, context, options = {}) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => resourceVisibleToContext(record, context, options));
}
