import crypto from "node:crypto";

export const POLICY_REGISTRY_SCHEMA_VERSION = "nyra_policy_registry_v1";
export const POLICY_PACK_SCHEMA_VERSION = "nyra_policy_pack_v1";

export const POLICY_SCOPE_ORDER = Object.freeze([
  "core",
  "global",
  "sector",
  "tenant",
  "environment",
  "work_type",
  "action",
  "policy",
]);

export const NYRA_POLICY_PRIMARY_SOURCES = Object.freeze([
  {
    source_id: "opa_bundles",
    publisher: "Open Policy Agent",
    url: "https://www.openpolicyagent.org/docs/management-bundles",
    supports: ["immutable_snapshot", "roots", "revision", "signature_verification"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "opa_discovery",
    publisher: "Open Policy Agent",
    url: "https://www.openpolicyagent.org/docs/management-discovery",
    supports: ["dynamic_bundle_selection", "bootstrap_precedence", "out_of_band_trust_anchor"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "opa_status",
    publisher: "Open Policy Agent",
    url: "https://www.openpolicyagent.org/docs/management-status",
    supports: ["activation_status", "canary_observability", "failure_reporting"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "cedar_authorization",
    publisher: "Cedar Policy",
    url: "https://docs.cedarpolicy.com/auth/authorization.html",
    supports: ["default_deny", "forbid_overrides_permit", "diagnostics"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "cedar_validation",
    publisher: "Cedar Policy",
    url: "https://docs.cedarpolicy.com/policies/validation.html",
    supports: ["schema_validation", "full_revalidation_after_schema_change", "error_diagnostics"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "nist_zero_trust",
    publisher: "NIST",
    url: "https://csrc.nist.gov/pubs/sp/800/207/final",
    supports: ["no_implicit_trust", "resource_centered_authorization", "pre_session_authorization"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "nist_cloud_zero_trust",
    publisher: "NIST",
    url: "https://csrc.nist.gov/pubs/sp/800/207/a/final",
    supports: ["workload_identity", "granular_cloud_policy", "multi_cloud"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "nist_abac",
    publisher: "NIST",
    url: "https://csrc.nist.gov/pubs/sp/800/162/upd2/final",
    supports: ["subject_attributes", "resource_attributes", "action_attributes", "environment_attributes"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "nist_ai_rmf",
    publisher: "NIST",
    url: "https://airc.nist.gov/airmf-resources/airmf/5-sec-core/",
    supports: ["govern", "map", "measure", "manage"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "slsa_provenance",
    publisher: "SLSA",
    url: "https://slsa.dev/spec/v1.2/provenance",
    supports: ["artifact_provenance", "builder_identity", "resolved_dependencies"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "slsa_vsa",
    publisher: "SLSA",
    url: "https://slsa.dev/spec/v1.2/verification_summary",
    supports: ["verification_summary", "subject_digest", "trusted_verifier"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "in_toto_attestation",
    publisher: "in-toto",
    url: "https://github.com/in-toto/attestation/blob/main/spec/README.md",
    supports: ["authenticated_metadata", "statement", "envelope", "bundle"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "spiffe_concepts",
    publisher: "SPIFFE",
    url: "https://spiffe.io/docs/latest/spiffe/concepts/",
    supports: ["workload_identity", "svid", "trust_domain_isolation"],
    reviewed_at: "2026-07-28",
  },
  {
    source_id: "spiffe_workload_api",
    publisher: "SPIFFE",
    url: "https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/",
    supports: ["short_lived_identity", "key_rotation", "no_static_secret_distribution"],
    reviewed_at: "2026-07-28",
  },
]);

const PACK_STATUSES = new Set([
  "candidate",
  "reviewed",
  "signed",
  "canary",
  "active",
  "quarantined",
  "revoked",
]);
const SIGNED_STATUSES = new Set(["signed", "canary", "active"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{1,159}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DEFAULT_TRAVERSAL_BUDGET = 256;
const MAX_TRAVERSAL_BUDGET = 4_096;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireText(value, field, max = 200) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function normalizeId(value, field = "id") {
  const normalized = requireText(value, field, 160).toLowerCase();
  if (!ID_PATTERN.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function uniqueText(values, field) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => requireText(value, field, 200)))].sort();
}

function normalizeBudget(value) {
  const normalized = Number(value ?? DEFAULT_TRAVERSAL_BUDGET);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_TRAVERSAL_BUDGET) {
    throw new Error("traversal_budget_invalid");
  }
  return normalized;
}

function normalizeScope(scope = {}) {
  const kind = requireText(scope.kind, "scope_kind", 32);
  if (!POLICY_SCOPE_ORDER.includes(kind)) throw new Error("scope_kind_invalid");
  const value = requireText(scope.value || kind, "scope_value", 160);
  const tenantId = scope.tenant_id ? requireText(scope.tenant_id, "scope_tenant_id", 120) : null;
  if (["tenant", "environment", "work_type", "action", "policy"].includes(kind) && !tenantId) {
    throw new Error("scope_tenant_id_required");
  }
  if (["core", "global", "sector"].includes(kind) && tenantId) {
    throw new Error("shared_scope_cannot_bind_tenant");
  }
  return { kind, value, tenant_id: tenantId };
}

function normalizeSourceRefs(sources) {
  const known = new Map(NYRA_POLICY_PRIMARY_SOURCES.map((source) => [source.source_id, source]));
  return (Array.isArray(sources) ? sources : []).map((source) => {
    const sourceId = normalizeId(source?.source_id, "source_id");
    const registered = known.get(sourceId);
    if (!registered) throw new Error("source_not_registered");
    const url = requireText(source?.url || registered.url, "source_url", 2_000);
    if (!url.startsWith("https://")) throw new Error("source_https_required");
    if (url !== registered.url) throw new Error("source_url_registry_mismatch");
    return {
      source_id: sourceId,
      url,
      claim: requireText(source?.claim, "source_claim", 1_200),
      reviewed_at: requireText(source?.reviewed_at, "source_reviewed_at", 32),
    };
  });
}

function normalizeBindings(bindings = {}) {
  const coreBranchIds = uniqueText(bindings.core_branch_ids, "core_branch_id");
  const nyraBranchIds = uniqueText(bindings.nyra_branch_ids, "nyra_branch_id");
  const domainPackIds = uniqueText(bindings.domain_pack_ids, "domain_pack_id");
  if (!coreBranchIds.length) throw new Error("core_branch_binding_required");
  if (!nyraBranchIds.length) throw new Error("nyra_branch_binding_required");
  if (!domainPackIds.length) throw new Error("domain_pack_binding_required");
  return {
    core_branch_ids: coreBranchIds,
    nyra_branch_ids: nyraBranchIds,
    domain_pack_ids: domainPackIds,
  };
}

function unsignedPack(pack) {
  const copy = clone(pack);
  delete copy.artifact_digest;
  delete copy.signatures;
  return copy;
}

export function policyPackDigest(pack) {
  return sha256(canonical(unsignedPack(pack)));
}

export function validatePolicyPack(pack, {
  tenant_id = null,
  now = new Date(),
  known_core_branch_ids = null,
  known_nyra_branch_ids = null,
  known_domain_pack_ids = null,
} = {}) {
  const errors = [];
  try {
    if (!pack || typeof pack !== "object") throw new Error("pack_object_required");
    normalizeId(pack.pack_id, "pack_id");
    if (!VERSION_PATTERN.test(String(pack.version || ""))) throw new Error("pack_version_invalid");
    if (pack.schema_version !== POLICY_PACK_SCHEMA_VERSION) throw new Error("pack_schema_version_invalid");
    if (!PACK_STATUSES.has(pack.status)) throw new Error("pack_status_invalid");
    const scope = normalizeScope(pack.scope);
    if (tenant_id && scope.tenant_id && scope.tenant_id !== tenant_id) throw new Error("cross_tenant_pack_denied");
    if (!pack.policy || typeof pack.policy !== "object") throw new Error("pack_policy_required");
    const bindings = normalizeBindings(pack.bindings);
    const ensureKnown = (values, known, error) => {
      if (Array.isArray(known) && values.some((value) => !known.includes(value))) throw new Error(error);
    };
    ensureKnown(bindings.core_branch_ids, known_core_branch_ids, "unknown_core_branch_binding");
    ensureKnown(bindings.nyra_branch_ids, known_nyra_branch_ids, "unknown_nyra_branch_binding");
    ensureKnown(bindings.domain_pack_ids, known_domain_pack_ids, "unknown_domain_pack_binding");
    if (pack.privacy?.raw_customer_data_allowed !== false) throw new Error("raw_customer_data_forbidden");
    uniqueText(pack.policy.allow_actions, "allow_action");
    uniqueText(pack.policy.deny_actions, "deny_action");
    uniqueText(pack.policy.required_gates, "required_gate");
    if (!["inherit", "restrict"].includes(pack.policy.allow_mode)) throw new Error("allow_mode_invalid");
    const sources = normalizeSourceRefs(pack.sources);
    const freshnessSlaDays = Number(pack.freshness_sla_days);
    if (!Number.isInteger(freshnessSlaDays) || freshnessSlaDays < 1 || freshnessSlaDays > 3_650) {
      throw new Error("freshness_sla_days_invalid");
    }
    if (now && sources.some((source) => {
      const reviewedAt = Date.parse(`${source.reviewed_at}T00:00:00.000Z`);
      return Number.isNaN(reviewedAt) || now.getTime() - reviewedAt > freshnessSlaDays * 86_400_000;
    })) throw new Error("policy_source_stale");
    if (!Array.isArray(pack.tests) || pack.tests.length < 2) throw new Error("positive_and_negative_tests_required");
    const testKinds = new Set(pack.tests.map((test) => test?.expected));
    if (!testKinds.has("ALLOW") || !testKinds.has("DENY")) throw new Error("positive_and_negative_tests_required");
    if (!pack.valid_from || Number.isNaN(Date.parse(pack.valid_from))) throw new Error("valid_from_invalid");
    if (!pack.expires_at || Number.isNaN(Date.parse(pack.expires_at))) throw new Error("expires_at_invalid");
    if (Date.parse(pack.expires_at) <= Date.parse(pack.valid_from)) throw new Error("validity_window_invalid");
    if (now && Date.parse(pack.valid_from) > now.getTime()) throw new Error("pack_not_yet_valid");
    if (now && Date.parse(pack.expires_at) <= now.getTime()) throw new Error("pack_expired");
    const expectedDigest = policyPackDigest(pack);
    if (pack.artifact_digest && pack.artifact_digest !== expectedDigest) throw new Error("artifact_digest_mismatch");
    if (
      SIGNED_STATUSES.has(pack.status) &&
      pack.trust_mode !== "compiled_core" &&
      (!Array.isArray(pack.signatures) || pack.signatures.length === 0)
    ) {
      throw new Error("signed_pack_signature_required");
    }
    if (pack.trust_mode === "compiled_core" && scope.kind !== "core") throw new Error("compiled_core_scope_required");
  } catch (error) {
    errors.push(error.message);
  }
  return { ok: errors.length === 0, errors };
}

export function createPolicyPackCandidate(input) {
  const scope = normalizeScope(input?.scope);
  const pack = {
    schema_version: POLICY_PACK_SCHEMA_VERSION,
    pack_id: normalizeId(input?.pack_id, "pack_id"),
    version: requireText(input?.version, "pack_version", 64),
    status: "candidate",
    scope,
    parent_refs: (Array.isArray(input?.parent_refs) ? input.parent_refs : []).map((parent) => ({
      pack_id: normalizeId(parent?.pack_id, "parent_pack_id"),
      version: requireText(parent?.version, "parent_version", 64),
      digest: requireText(parent?.digest, "parent_digest", 128),
    })),
    bindings: normalizeBindings(input?.bindings || {
      core_branch_ids: ["nyra_policy_registry"],
      nyra_branch_ids: ["risk_governance"],
      domain_pack_ids: ["generic"],
    }),
    privacy: {
      raw_customer_data_allowed: false,
      data_classification: requireText(input?.privacy?.data_classification || "policy_metadata_only", "data_classification", 80),
    },
    policy: {
      allow_mode: input?.policy?.allow_mode || "restrict",
      allow_actions: uniqueText(input?.policy?.allow_actions, "allow_action"),
      deny_actions: uniqueText(input?.policy?.deny_actions, "deny_action"),
      required_gates: uniqueText(input?.policy?.required_gates, "required_gate"),
      constraints: clone(input?.policy?.constraints || {}),
    },
    tests: clone(Array.isArray(input?.tests) ? input.tests : []),
    sources: normalizeSourceRefs(input?.sources),
    freshness_sla_days: Number(input?.freshness_sla_days ?? 365),
    provenance: clone(input?.provenance || {}),
    valid_from: requireText(input?.valid_from, "valid_from", 64),
    expires_at: requireText(input?.expires_at, "expires_at", 64),
    rollback_to: input?.rollback_to ? clone(input.rollback_to) : null,
    compatibility: clone(input?.compatibility || {}),
    trust_mode: "signed_bundle",
    signatures: [],
  };
  pack.artifact_digest = policyPackDigest(pack);
  const validation = validatePolicyPack(pack, { tenant_id: scope.tenant_id });
  if (!validation.ok) throw new Error(`policy_pack_invalid:${validation.errors.join(",")}`);
  return deepFreeze(pack);
}

export function verifyPolicyPackSignature(pack, {
  trusted_issuers = {},
  trusted_core_pack_digests = [],
} = {}) {
  if (pack?.trust_mode === "compiled_core" && pack?.scope?.kind === "core") {
    const trusted = trusted_core_pack_digests.includes(policyPackDigest(pack));
    return {
      ok: trusted,
      mode: "compiled_core",
      verified_issuer_ids: ["universal_core_binary"],
      verified_roles: ["core"],
      trusted_core_digest: trusted,
      error: trusted ? null : "compiled_core_digest_untrusted",
    };
  }
  const payload = Buffer.from(policyPackDigest(pack), "utf8");
  const verified = [];
  const roles = [];
  const fingerprints = [];
  for (const signature of Array.isArray(pack?.signatures) ? pack.signatures : []) {
    try {
      const issuerId = requireText(signature?.issuer_id, "signature_issuer_id", 160);
      const trustRecord = trusted_issuers[issuerId];
      const publicKey = trustRecord?.public_key || trustRecord;
      const trustedRole = trustRecord?.role || null;
      if (!publicKey || signature?.algorithm !== "Ed25519") continue;
      const signatureBytes = Buffer.from(requireText(signature?.signature, "signature", 4_096), "base64");
      if (crypto.verify(null, payload, publicKey, signatureBytes)) {
        const keyObject = publicKey?.type === "public" ? publicKey : crypto.createPublicKey(publicKey);
        const fingerprint = sha256(keyObject.export({ type: "spki", format: "der" }));
        verified.push(issuerId);
        if (trustedRole) roles.push(trustedRole);
        fingerprints.push(fingerprint);
      }
    } catch {
      // Invalid signatures are reported by the fail-closed result below.
    }
  }
  const verifiedRoles = [...new Set(roles)].sort();
  const missingRoles = ["core", "nyra"]
    .filter((role) => !verifiedRoles.includes(role));
  const independentKeyCount = new Set(fingerprints).size;
  return {
    ok: verified.length > 0 && missingRoles.length === 0 && independentKeyCount >= 2,
    mode: "ed25519",
    verified_issuer_ids: [...new Set(verified)].sort(),
    verified_roles: verifiedRoles,
    independent_key_count: independentKeyCount,
    missing_roles: missingRoles,
    error: verified.length === 0
      ? "policy_pack_signature_invalid"
      : missingRoles.length || independentKeyCount < 2
        ? "policy_pack_signature_quorum_unsatisfied"
        : null,
  };
}

function packKey(pack) {
  return `${pack.pack_id}@${pack.version}`;
}

export function compilePolicySnapshot({
  tenant_id,
  leaf_pack_ids,
  packs,
  traversal_budget = DEFAULT_TRAVERSAL_BUDGET,
  trusted_issuers = {},
  now = new Date(),
  domain_pack_id,
  known_core_branch_ids = null,
  known_nyra_branch_ids = null,
  known_domain_pack_ids = null,
  trusted_core_pack_digests = [],
} = {}) {
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const domainPackId = requireText(domain_pack_id, "domain_pack_id", 80);
  const budget = normalizeBudget(traversal_budget);
  const byKey = new Map((Array.isArray(packs) ? packs : []).map((pack) => [packKey(pack), pack]));
  const roots = uniqueText(leaf_pack_ids, "leaf_pack_id");
  if (!roots.length) throw new Error("leaf_pack_ids_required");
  const visiting = new Set();
  const visited = new Set();
  const coreRootsByPack = new Map();
  const ordered = [];
  let traversed = 0;

  function visit(key) {
    traversed += 1;
    if (traversed > budget) throw new Error("policy_traversal_budget_exceeded");
    if (visiting.has(key)) throw new Error("policy_ancestry_cycle_detected");
    if (visited.has(key)) return coreRootsByPack.get(key);
    const pack = byKey.get(key);
    if (!pack) throw new Error(`policy_parent_missing:${key}`);
    const validation = validatePolicyPack(pack, {
      tenant_id: tenantId,
      now,
      known_core_branch_ids,
      known_nyra_branch_ids,
      known_domain_pack_ids,
    });
    if (!validation.ok) throw new Error(`policy_pack_invalid:${key}:${validation.errors.join(",")}`);
    if (
      pack.trust_mode === "compiled_core" &&
      !trusted_core_pack_digests.includes(policyPackDigest(pack))
    ) throw new Error(`compiled_core_digest_untrusted:${key}`);
    if (!pack.bindings.domain_pack_ids.includes(domainPackId)) {
      throw new Error(`policy_domain_pack_leakage:${key}`);
    }
    if (!["active", "canary"].includes(pack.status) && pack.trust_mode !== "compiled_core") {
      throw new Error(`policy_pack_not_active:${key}`);
    }
    const signature = verifyPolicyPackSignature(pack, {
      trusted_issuers,
      trusted_core_pack_digests,
    });
    const signatureReady = pack.trust_mode === "compiled_core"
      ? signature?.ok === true && signature?.mode === "compiled_core" && signature?.trusted_core_digest === true
      : signature?.ok === true &&
        signature?.independent_key_count >= 2 &&
        ["core", "nyra"].every((role) => signature?.verified_roles?.includes(role));
    if (!signatureReady) throw new Error(`policy_pack_unverified:${key}`);
    visiting.add(key);
    const parentCoreRoots = [];
    for (const parentRef of Array.isArray(pack.parent_refs) ? pack.parent_refs : []) {
      const parentKey = `${parentRef.pack_id}@${parentRef.version}`;
      const parent = byKey.get(parentKey);
      if (!parent) throw new Error(`policy_parent_missing:${parentKey}`);
      if (policyPackDigest(parent) !== parentRef.digest) throw new Error(`policy_parent_digest_mismatch:${parentKey}`);
      if (POLICY_SCOPE_ORDER.indexOf(parent.scope.kind) > POLICY_SCOPE_ORDER.indexOf(pack.scope.kind)) {
        throw new Error(`policy_scope_precedence_invalid:${parentKey}`);
      }
      parentCoreRoots.push(visit(parentKey));
    }
    const coreRoots = pack.scope.kind === "core" && pack.trust_mode === "compiled_core"
      ? new Set([policyPackDigest(pack)])
      : new Set(parentCoreRoots.flatMap((rootsForParent) => [...rootsForParent]));
    if (
      !(pack.scope.kind === "core" && pack.trust_mode === "compiled_core") &&
      (parentCoreRoots.length === 0 || parentCoreRoots.some((rootsForParent) => rootsForParent.size !== 1))
    ) coreRoots.clear();
    if (coreRoots.size > 1) throw new Error(`multiple_core_invariant_roots:${key}`);
    visiting.delete(key);
    visited.add(key);
    coreRootsByPack.set(key, coreRoots);
    ordered.push(pack);
    return coreRoots;
  }

  let selectedCoreRootDigest = null;
  for (const root of roots) {
    const coreRoots = visit(root);
    if (coreRoots.size !== 1) throw new Error(`core_invariant_ancestry_required:${root}`);
    const [coreRootDigest] = coreRoots;
    if (selectedCoreRootDigest && selectedCoreRootDigest !== coreRootDigest) {
      throw new Error("multiple_core_invariant_roots_across_leaves");
    }
    selectedCoreRootDigest = coreRootDigest;
  }
  ordered.sort((left, right) => {
    const scopeDelta = POLICY_SCOPE_ORDER.indexOf(left.scope.kind) - POLICY_SCOPE_ORDER.indexOf(right.scope.kind);
    return scopeDelta || packKey(left).localeCompare(packKey(right));
  });

  const denyActions = new Set();
  const requiredGates = new Set();
  let allowActions = null;
  const constraints = {};
  let coreBranchIds = null;
  let nyraBranchIds = null;
  let domainPackIds = null;
  for (const pack of ordered) {
    const currentAllow = new Set(uniqueText(pack.policy?.allow_actions, "allow_action"));
    if (pack.policy?.allow_mode === "restrict") {
      allowActions = allowActions === null
        ? currentAllow
        : new Set([...allowActions].filter((action) => currentAllow.has(action)));
    }
    for (const action of uniqueText(pack.policy?.deny_actions, "deny_action")) denyActions.add(action);
    for (const gate of uniqueText(pack.policy?.required_gates, "required_gate")) requiredGates.add(gate);
    for (const [key, value] of Object.entries(pack.policy?.constraints || {})) {
      if (Object.hasOwn(constraints, key) && canonical(constraints[key]) !== canonical(value)) {
        throw new Error(`policy_constraint_conflict:${key}`);
      }
      constraints[key] = clone(value);
    }
    const intersect = (current, values) => current === null
      ? new Set(values)
      : new Set([...current].filter((value) => values.includes(value)));
    coreBranchIds = intersect(coreBranchIds, pack.bindings.core_branch_ids);
    nyraBranchIds = intersect(nyraBranchIds, pack.bindings.nyra_branch_ids);
    domainPackIds = intersect(domainPackIds, pack.bindings.domain_pack_ids);
  }
  if (!coreBranchIds?.size || !nyraBranchIds?.size || !domainPackIds?.size) {
    throw new Error("policy_binding_intersection_empty");
  }
  const snapshotBase = {
    schema_version: POLICY_REGISTRY_SCHEMA_VERSION,
    tenant_id: tenantId,
    domain_pack_id: domainPackId,
    ancestry: ordered.map((pack) => ({
      pack_id: pack.pack_id,
      version: pack.version,
      digest: policyPackDigest(pack),
      scope: pack.scope,
    })),
    leaf_packs: roots.map((key) => {
      const pack = byKey.get(key);
      return { pack_id: pack.pack_id, version: pack.version, digest: policyPackDigest(pack) };
    }),
    policy: {
      allow_actions: [...(allowActions || new Set())].sort(),
      deny_actions: [...denyActions].sort(),
      required_gates: [...requiredGates].sort(),
      constraints,
    },
    bindings: {
      core_branch_ids: [...(coreBranchIds || new Set())].sort(),
      nyra_branch_ids: [...(nyraBranchIds || new Set())].sort(),
      domain_pack_ids: [...(domainPackIds || new Set())].sort(),
    },
    sources: [...new Set(ordered.flatMap((pack) => pack.sources.map((source) => source.source_id)))].sort(),
    validity: {
      valid_from: new Date(Math.max(...ordered.map((pack) => Date.parse(pack.valid_from)))).toISOString(),
      expires_at: new Date(Math.min(...ordered.map((pack) => Date.parse(pack.expires_at)))).toISOString(),
    },
    resolution: {
      logical_depth: ordered.length,
      traversal_budget: budget,
      traversed,
      catalog_depth_policy: "no_static_ceiling",
      runtime_policy: "bounded_fail_closed",
    },
    immutable: true,
  };
  return deepFreeze({
    ...snapshotBase,
    snapshot_digest: sha256(canonical(snapshotBase)),
  });
}

export function evaluatePolicySnapshot(snapshot, {
  tenant_id,
  action,
  core_branch_id,
  nyra_branch_id,
  satisfied_gates = [],
  diagnostics = [],
  context = {},
  now = new Date(),
} = {}) {
  const reasons = [];
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const requestedAction = requireText(action, "action", 200);
  const coreBranchId = requireText(core_branch_id, "core_branch_id", 160);
  const nyraBranchId = requireText(nyra_branch_id, "nyra_branch_id", 160);
  if (snapshot?.tenant_id !== tenantId) reasons.push("cross_tenant_snapshot_denied");
  const snapshotBody = snapshot && typeof snapshot === "object" ? clone(snapshot) : null;
  const claimedDigest = snapshotBody?.snapshot_digest || null;
  if (snapshotBody) delete snapshotBody.snapshot_digest;
  const computedDigest = snapshotBody ? sha256(canonical(snapshotBody)) : null;
  if (!snapshot?.immutable || !claimedDigest || claimedDigest !== computedDigest) reasons.push("invalid_policy_snapshot");
  const validFrom = Date.parse(snapshot?.validity?.valid_from);
  const expiresAt = Date.parse(snapshot?.validity?.expires_at);
  if (
    !Number.isFinite(validFrom) ||
    !Number.isFinite(expiresAt) ||
    validFrom > now.getTime() ||
    expiresAt <= now.getTime()
  ) reasons.push("policy_snapshot_not_current");
  if (!snapshot?.bindings?.core_branch_ids?.includes(coreBranchId)) reasons.push("core_branch_binding_denied");
  if (!snapshot?.bindings?.nyra_branch_ids?.includes(nyraBranchId)) reasons.push("nyra_branch_binding_denied");
  if (Array.isArray(diagnostics) && diagnostics.length) reasons.push("policy_diagnostics_present");
  if (snapshot?.policy?.deny_actions?.includes(requestedAction)) reasons.push("explicit_deny");
  if (!snapshot?.policy?.allow_actions?.includes(requestedAction)) reasons.push("default_deny");
  const satisfied = new Set(uniqueText(satisfied_gates, "satisfied_gate"));
  const missingGates = (snapshot?.policy?.required_gates || []).filter((gate) => !satisfied.has(gate));
  if (missingGates.length) reasons.push("required_gate_missing");
  const constraintContext = context && typeof context === "object" ? context : {};
  const failedConstraints = Object.entries(snapshot?.policy?.constraints || {})
    .filter(([key, expected]) => canonical(constraintContext[key]) !== canonical(expected))
    .map(([key]) => key)
    .sort();
  if (failedConstraints.length) reasons.push("policy_constraint_unsatisfied");
  return {
    verdict: reasons.length ? "DENY" : "ALLOW",
    reasons: [...new Set(reasons)],
    missing_gates: missingGates,
    failed_constraints: failedConstraints,
    snapshot_digest: snapshot?.snapshot_digest || null,
    fail_closed: true,
  };
}

export function assessPolicyCandidate({
  candidate,
  parent_snapshot,
  test_results = [],
  trusted_issuers = {},
  core_receipt,
  owner_proof = null,
  consume_activation_proofs,
  verify_parent_snapshot,
  now = new Date(),
} = {}) {
  const validation = validatePolicyPack(candidate, {
    tenant_id: candidate?.scope?.tenant_id || null,
    now,
  });
  const parentAllow = new Set(parent_snapshot?.policy?.allow_actions || []);
  const candidateAllow = new Set(candidate?.policy?.allow_actions || []);
  const capabilityExpansion = [...candidateAllow].filter((action) => !parentAllow.has(action)).sort();
  const parentScope = parent_snapshot?.ancestry?.at(-1)?.scope || null;
  const scopeExpansion = parentScope
    ? POLICY_SCOPE_ORDER.indexOf(candidate?.scope?.kind) < POLICY_SCOPE_ORDER.indexOf(parentScope.kind)
    : false;
  const bindingExpansion = ["core_branch_ids", "nyra_branch_ids", "domain_pack_ids"].flatMap((field) => {
    const parentValues = new Set(parent_snapshot?.bindings?.[field] || candidate?.bindings?.[field] || []);
    return (candidate?.bindings?.[field] || [])
      .filter((value) => !parentValues.has(value))
      .map((value) => `${field}:${value}`);
  }).sort();
  const validityExpansion = Boolean(
    parent_snapshot?.validity?.expires_at &&
    Date.parse(candidate?.expires_at) > Date.parse(parent_snapshot.validity.expires_at),
  );
  const authorityExpansion = [
    ...capabilityExpansion.map((action) => `allow_action:${action}`),
    ...(scopeExpansion ? ["scope"] : []),
    ...bindingExpansion,
    ...(validityExpansion ? ["validity_window"] : []),
  ];
  const testsPassed =
    test_results.length >= 2 &&
    test_results.every((result) => result?.passed === true) &&
    new Set(test_results.map((result) => result?.expected)).has("ALLOW") &&
    new Set(test_results.map((result) => result?.expected)).has("DENY");
  const candidateDigest = policyPackDigest(candidate);
  const parentBody = parent_snapshot && typeof parent_snapshot === "object" ? clone(parent_snapshot) : null;
  const parentClaimedDigest = parentBody?.snapshot_digest || null;
  if (parentBody) delete parentBody.snapshot_digest;
  const parentComputedDigest = parentBody ? sha256(canonical(parentBody)) : null;
  const parentRefs = new Set((candidate?.parent_refs || [])
    .map((ref) => `${ref.pack_id}@${ref.version}:${ref.digest}`));
  const parentLeafPacks = new Set((parent_snapshot?.leaf_packs || [])
    .map((ref) => `${ref.pack_id}@${ref.version}:${ref.digest}`));
  let parentTrust = null;
  try {
    parentTrust = typeof verify_parent_snapshot === "function"
      ? verify_parent_snapshot(parent_snapshot, {
          tenant_id: candidate?.scope?.tenant_id,
          snapshot_digest: parentClaimedDigest,
          now,
        })
      : null;
  } catch {
    parentTrust = null;
  }
  const parentSnapshotValid =
    parent_snapshot?.tenant_id === candidate?.scope?.tenant_id &&
    parentClaimedDigest &&
    parentClaimedDigest === parentComputedDigest &&
    parentRefs.size > 0 &&
    parentRefs.size === parentLeafPacks.size &&
    [...parentRefs].every((ref) => parentLeafPacks.has(ref)) &&
    Date.parse(parent_snapshot?.validity?.valid_from) <= now.getTime() &&
    Date.parse(parent_snapshot?.validity?.expires_at) > now.getTime() &&
    parentTrust?.ok === true &&
    parentTrust?.signature_verified === true &&
    parentTrust?.tenant_id === candidate?.scope?.tenant_id &&
    parentTrust?.snapshot_digest === parentClaimedDigest;
  const verifyConsumedProof = (result, {
    requireAllow = false,
    proofKind,
    issuerRole,
    transactionId,
  } = {}) => {
    try {
      const expiresAt = Date.parse(result?.expires_at);
      const valid =
        result?.ok === true &&
        result?.signature_verified === true &&
        result?.tenant_id === candidate?.scope?.tenant_id &&
        result?.candidate_digest === candidateDigest &&
        result?.action === "activate_policy_pack" &&
        Number.isFinite(expiresAt) &&
        expiresAt > now.getTime() &&
        result?.single_use === true &&
        result?.consumed === true &&
        result?.consumption_receipt_verified === true &&
        result?.replay_state === "consumed_now" &&
        result?.proof_kind === proofKind &&
        result?.issuer_role === issuerRole &&
        result?.transaction_id === transactionId &&
        typeof result?.consumption_id === "string" &&
        result.consumption_id.length >= 16 &&
        Number.isFinite(Date.parse(result?.consumed_at)) &&
        Date.parse(result.consumed_at) <= now.getTime() &&
        (!requireAllow || result?.verdict === "ALLOW");
      return { ok: valid, error: valid ? null : "proof_binding_invalid" };
    } catch {
      return { ok: false, error: "proof_verification_failed" };
    }
  };
  const ownerRequired = authorityExpansion.length > 0;
  const signatureVerification = verifyPolicyPackSignature(candidate, { trusted_issuers });
  const signatureReady =
    candidate?.status === "signed" &&
    signatureVerification.ok === true &&
    signatureVerification.independent_key_count >= 2 &&
    ["core", "nyra"].every((role) => signatureVerification.verified_roles?.includes(role));
  const localChecksReady =
    validation.ok &&
    parentSnapshotValid &&
    testsPassed &&
    signatureReady &&
    Boolean(core_receipt) &&
    (!ownerRequired || Boolean(owner_proof));
  let consumption = null;
  if (localChecksReady && typeof consume_activation_proofs === "function") {
    try {
      consumption = consume_activation_proofs({
        core_receipt,
        owner_proof: ownerRequired ? owner_proof : null,
      }, {
        tenant_id: candidate?.scope?.tenant_id,
        candidate_digest: candidateDigest,
        action: "activate_policy_pack",
        owner_proof_required: ownerRequired,
        now,
      });
    } catch {
      consumption = null;
    }
  }
  const atomicConsumption =
    consumption?.ok === true &&
    consumption?.atomic === true &&
    typeof consumption?.transaction_id === "string" &&
    consumption.transaction_id.length >= 16;
  const coreVerification = atomicConsumption
    ? verifyConsumedProof(consumption.core, {
        requireAllow: true,
        proofKind: "core_receipt",
        issuerRole: "universal_core",
        transactionId: consumption.transaction_id,
      })
    : { ok: false };
  const ownerVerification = !ownerRequired
    ? { ok: true }
    : atomicConsumption
      ? verifyConsumedProof(consumption.owner, {
          proofKind: "owner_proof",
          issuerRole: "tenant_owner",
          transactionId: consumption.transaction_id,
        })
      : { ok: false };
  const independentProofConsumption =
    !ownerRequired ||
    (coreVerification.ok &&
      ownerVerification.ok &&
      consumption.core.consumption_id !== consumption.owner.consumption_id);
  const coreAllowed = coreVerification.ok;
  const ownerSatisfied = ownerVerification.ok && independentProofConsumption;
  const ready =
    localChecksReady &&
    atomicConsumption &&
    coreAllowed &&
    ownerSatisfied;
  return {
    ready_for_activation: ready,
    activation_performed: false,
    capability_expansion: capabilityExpansion,
    authority_expansion: authorityExpansion,
    owner_proof_required: ownerRequired,
    checks: {
      schema_valid: validation.ok,
      parent_snapshot_valid: parentSnapshotValid,
      positive_and_negative_tests_passed: testsPassed,
      signature_verified: signatureReady,
      core_request_bound_allow: coreAllowed,
      owner_proof_satisfied: ownerSatisfied,
      proofs_consumed_atomically: atomicConsumption,
    },
    reasons: [
      ...validation.errors,
      ...(parentSnapshotValid ? [] : ["parent_snapshot_invalid"]),
      ...(!testsPassed ? ["policy_tests_failed"] : []),
      ...(signatureReady ? [] : ["policy_signature_quorum_invalid"]),
      ...(coreAllowed ? [] : ["core_allow_required"]),
      ...(ownerSatisfied ? [] : ["owner_proof_required_for_expansion"]),
      ...(atomicConsumption ? [] : ["activation_proofs_not_consumed_atomically"]),
    ],
  };
}

export function proposeMissingPolicyBranch({
  tenant_id,
  desired_path,
  research_plan_id,
  source_ids,
} = {}) {
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const path = (Array.isArray(desired_path) ? desired_path : []).map((segment) => normalizeId(segment, "path_segment"));
  if (!path.length) throw new Error("desired_path_required");
  const knownSources = new Set(NYRA_POLICY_PRIMARY_SOURCES.map((source) => source.source_id));
  const sources = uniqueText(source_ids, "source_id");
  if (!sources.length || sources.some((sourceId) => !knownSources.has(sourceId))) {
    throw new Error("trusted_source_required");
  }
  const proposalBase = {
    schema_version: "nyra_policy_branch_candidate_v1",
    tenant_id: tenantId,
    desired_path: path,
    research_plan_id: requireText(research_plan_id, "research_plan_id", 160),
    source_ids: sources,
    status: "candidate",
    authority: "nyra_dtt_advisory",
    execution: {
      authorized: false,
      policy_activation: false,
      external_actions: false,
      core_promotion_required: true,
    },
  };
  return {
    ...proposalBase,
    candidate_digest: sha256(canonical(proposalBase)),
  };
}

export function describeNyraPolicyRegistry() {
  return {
    schema_version: POLICY_REGISTRY_SCHEMA_VERSION,
    hierarchy: [...POLICY_SCOPE_ORDER],
    depth: {
      catalog: "recursive_without_static_ceiling",
      resolution: `bounded_1_to_${MAX_TRAVERSAL_BUDGET}`,
    },
    precedence: "core_to_leaf_with_child_narrowing_only",
    conflict_policy: "deny_wins",
    diagnostic_policy: "any_error_denies",
    tenant_isolation: "exact_tenant_binding",
    update_policy: {
      automatic: ["evidence_refresh", "compatible_restriction", "expiry_quarantine"],
      gated: ["new_capability", "scope_expansion", "activation", "rollback"],
    },
    dtt: {
      missing_branch_mode: "candidate_only",
      activation_authority: "universal_core",
    },
    primary_sources: clone(NYRA_POLICY_PRIMARY_SOURCES),
  };
}
