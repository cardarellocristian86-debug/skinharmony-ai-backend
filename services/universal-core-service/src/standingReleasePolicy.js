import crypto from "node:crypto";

export const STANDING_RELEASE_MANDATE_VERSION = "owner_standing_release_mandate_v1";
export const STANDING_RELEASE_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
export const STANDING_RELEASE_MAX_DELEGATION_MS = 12 * 60 * 60 * 1_000;

export const STANDING_RELEASE_ACTIONS = Object.freeze([
  "git.commit",
  "git.push.branch",
  "github.draft_pr",
  "github.ready",
  "github.merge",
  "render.deploy",
  "render.observe",
  "render.rollback",
]);

export const STANDING_RELEASE_REPAIR_CLASSES = Object.freeze([
  "deterministic_build",
  "deterministic_lint",
  "deterministic_test",
  "deterministic_typecheck",
  "transient_network",
  "transient_runner",
]);

export const STANDING_RELEASE_PROTECTED_PATH_PREFIXES = Object.freeze([
  ".github",
  "AGENTS.md",
  "render",
  "services/universal-core-service/AGENTS.md",
  "services/universal-core-service/src/app.js",
  "services/universal-core-service/src/hostNativeExternalReadback.js",
  "services/universal-core-service/src/hostNativeGovernance.js",
  "services/universal-core-service/src/standingReleasePolicy.js",
  "services/skinharmony-core-mcp/src/config.js",
  "services/skinharmony-core-mcp/src/core-handlers.js",
  "services/skinharmony-core-mcp/src/host-native-tools.js",
  "services/skinharmony-core-mcp/src/server.js",
  "services/skinharmony-core-mcp/src/work-continuity-runtime.js",
  "services/skinharmony-core-mcp/src/work-continuity-v2-store.js",
  "services/shared/dtt-work-context.js",
]);

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const WORK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${code}:${key}`);
}

function text(value, code, max = 500) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}

function identifier(value, code) {
  const normalized = text(value, code, 160);
  if (!IDENTIFIER.test(normalized)) fail(code);
  return normalized;
}

function sha256(value, code) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
}

function gitSha(value, code) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!GIT_SHA.test(normalized)) fail(code);
  return normalized;
}

function workId(value, code) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!WORK_ID.test(normalized)) fail(code);
  return normalized;
}

function branch(value, code) {
  const normalized = text(value, code, 200);
  if (!BRANCH.test(normalized) || normalized.includes("..")) fail(code);
  return normalized;
}

function positiveInteger(value, code, maximum) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) fail(code);
  return normalized;
}

function stableStrings(values, code, { min = 1, max = 100, itemMax = 500 } = {}) {
  if (!Array.isArray(values) || values.length < min || values.length > max) fail(code);
  const normalized = values.map((value) => text(value, code, itemMax));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) fail(code);
  return unique;
}

function normalizePrefix(value, code) {
  const normalized = text(value, code, 500).replace(/^\.\//, "").replace(/\/+$/, "");
  if (
    !normalized || normalized.startsWith("/") || normalized.includes("\\") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) fail(code);
  return normalized;
}

function prefixes(values, code, options) {
  return stableStrings(values, code, options).map((value) => normalizePrefix(value, code));
}

function pathWithin(file, prefix) {
  return file === prefix || file.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) ||
    (prefix === "render" && file.startsWith("render"));
}

function sameStrings(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stable(value[key]);
    return result;
  }, {});
}

function objectDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function normalizeStandingReleaseIntentBinding(input = {}, {
  tenantId,
  workId: expectedWorkId,
  intentDigest,
  now = Date.now(),
} = {}) {
  exactKeys(input, new Set([
    "schema_version", "source", "tenant_id", "work_id", "project_id", "work_status",
    "current_version", "work_updated_at", "intent_anchor_schema_version",
    "intent_anchor_immutable", "intent_anchor_digest", "intent_anchor_created_at",
    "verified_at", "provider_execution", "binding_digest",
  ]), "standing_release_intent_binding_invalid");
  const normalizedTenantId = identifier(tenantId, "standing_release_tenant_invalid");
  const normalizedWorkId = workId(expectedWorkId, "standing_release_work_invalid");
  const normalizedIntentDigest = sha256(intentDigest, "standing_release_intent_invalid");
  const projectId = text(input.project_id, "standing_release_intent_binding_invalid", 64);
  const currentVersion = positiveInteger(
    input.current_version,
    "standing_release_intent_binding_invalid",
    Number.MAX_SAFE_INTEGER,
  );
  const verifiedAt = Date.parse(String(input.verified_at || ""));
  const workUpdatedAt = Date.parse(String(input.work_updated_at || ""));
  const anchorCreatedAt = Date.parse(String(input.intent_anchor_created_at || ""));
  const nowValue = Number(typeof now === "function" ? now() : now);
  const bindingDigest = sha256(
    input.binding_digest,
    "standing_release_intent_binding_invalid",
  );
  if (
    !Number.isFinite(nowValue) || !Number.isFinite(verifiedAt) ||
    !Number.isFinite(workUpdatedAt) || !Number.isFinite(anchorCreatedAt)
  ) fail("standing_release_intent_binding_invalid");
  const normalizedUnsigned = {
    schema_version: "standing_release_intent_binding_v1",
    source: "mcp_work_continuity_postgres",
    tenant_id: normalizedTenantId,
    work_id: normalizedWorkId,
    project_id: projectId,
    work_status: input.work_status,
    current_version: currentVersion,
    work_updated_at: new Date(workUpdatedAt).toISOString(),
    intent_anchor_schema_version: "intent_anchor_v1",
    intent_anchor_immutable: true,
    intent_anchor_digest: normalizedIntentDigest,
    intent_anchor_created_at: new Date(anchorCreatedAt).toISOString(),
    verified_at: new Date(verifiedAt).toISOString(),
    provider_execution: false,
  };
  if (
    input.schema_version !== "standing_release_intent_binding_v1" ||
    input.source !== "mcp_work_continuity_postgres" ||
    input.tenant_id !== normalizedTenantId || input.work_id !== normalizedWorkId ||
    input.project_id !== projectId ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(projectId) ||
    !["active", "verified", "release_ready"].includes(input.work_status) ||
    input.current_version !== currentVersion ||
    input.intent_anchor_schema_version !== "intent_anchor_v1" ||
    input.intent_anchor_immutable !== true ||
    input.intent_anchor_digest !== normalizedIntentDigest ||
    input.provider_execution !== false ||
    verifiedAt > nowValue + 30_000 || verifiedAt < nowValue - 5 * 60_000 ||
    workUpdatedAt > verifiedAt + 30_000 || anchorCreatedAt > verifiedAt + 30_000 ||
    input.work_updated_at !== normalizedUnsigned.work_updated_at ||
    input.intent_anchor_created_at !== normalizedUnsigned.intent_anchor_created_at ||
    input.verified_at !== normalizedUnsigned.verified_at ||
    objectDigest(normalizedUnsigned) !== bindingDigest
  ) fail("standing_release_intent_binding_invalid");
  return Object.freeze({
    ...normalizedUnsigned,
    binding_digest: bindingDigest,
  });
}

function normalizeServices(services, code = "standing_release_services_invalid") {
  if (!Array.isArray(services) || services.length < 1 || services.length > 20) fail(code);
  const seen = new Set();
  const normalized = services.map((service) => {
    exactKeys(service, new Set([
      "service_id", "environment", "health_contract_digest",
    ]), code);
    const result = {
      service_id: identifier(service.service_id, code),
      environment: identifier(service.environment, code),
      health_contract_digest: sha256(service.health_contract_digest, code),
    };
    const key = `${result.service_id}\u0000${result.environment}`;
    if (seen.has(key)) fail(code);
    seen.add(key);
    return result;
  });
  return normalized.sort((left, right) =>
    `${left.service_id}\u0000${left.environment}`.localeCompare(`${right.service_id}\u0000${right.environment}`));
}

function sameServices(left, right) {
  return JSON.stringify(normalizeServices(left)) === JSON.stringify(normalizeServices(right));
}

function normalizeLimits(value) {
  exactKeys(value, new Set([
    "max_pull_requests", "max_merges", "max_commits", "max_pushes",
    "max_repair_attempts", "max_deploys_per_service", "max_rollbacks",
  ]), "standing_release_limits_invalid");
  const limits = {
    max_pull_requests: positiveInteger(value.max_pull_requests, "standing_release_limits_invalid", 1),
    max_merges: positiveInteger(value.max_merges, "standing_release_limits_invalid", 1),
    max_commits: positiveInteger(value.max_commits, "standing_release_limits_invalid", 3),
    max_pushes: positiveInteger(value.max_pushes, "standing_release_limits_invalid", 3),
    max_repair_attempts: positiveInteger(value.max_repair_attempts, "standing_release_limits_invalid", 2),
    max_deploys_per_service: positiveInteger(value.max_deploys_per_service, "standing_release_limits_invalid", 1),
    max_rollbacks: positiveInteger(value.max_rollbacks, "standing_release_limits_invalid", 1),
  };
  return limits;
}

export function normalizeStandingReleaseMandate(input = {}, { now = Date.now() } = {}) {
  exactKeys(input, new Set([
    "tenant_id", "authorization_work_id", "authorization_intent_anchor_digest",
    "repository", "base_branch", "delivery_branch_prefix", "allowed_path_prefixes",
    "denied_path_prefixes", "required_checks", "required_checks_policy_digest",
    "services", "repair_classes", "limits", "base_protection_required", "expires_at",
  ]), "standing_release_mandate_invalid");
  const nowValue = Number(typeof now === "function" ? now() : now);
  if (!Number.isFinite(nowValue)) fail("standing_release_clock_invalid");
  const expiresAt = Date.parse(input.expires_at);
  if (
    !Number.isFinite(expiresAt) || expiresAt <= nowValue ||
    expiresAt > nowValue + STANDING_RELEASE_MAX_DURATION_MS
  ) fail("standing_release_expiry_invalid");
  const repository = text(input.repository, "standing_release_repository_invalid", 300);
  if (!REPOSITORY.test(repository)) fail("standing_release_repository_invalid");
  const baseBranch = branch(input.base_branch, "standing_release_base_branch_invalid");
  const deliveryPrefix = text(input.delivery_branch_prefix, "standing_release_branch_prefix_invalid", 180);
  if (
    !deliveryPrefix.endsWith("/") || !BRANCH.test(`${deliveryPrefix}release`) ||
    baseBranch.startsWith(deliveryPrefix) || deliveryPrefix === `${baseBranch}/`
  ) fail("standing_release_branch_prefix_invalid");
  if (input.base_protection_required !== true) fail("standing_release_base_protection_required");
  const repairClasses = stableStrings(
    input.repair_classes,
    "standing_release_repair_classes_invalid",
    { max: STANDING_RELEASE_REPAIR_CLASSES.length, itemMax: 80 },
  );
  if (repairClasses.some((entry) => !STANDING_RELEASE_REPAIR_CLASSES.includes(entry))) {
    fail("standing_release_repair_classes_invalid");
  }
  const denied = [...new Set([
    ...STANDING_RELEASE_PROTECTED_PATH_PREFIXES,
    ...prefixes(input.denied_path_prefixes || [], "standing_release_denied_paths_invalid", { min: 0, max: 100 }),
  ])].sort((left, right) => left.localeCompare(right));
  const allowed = prefixes(
    input.allowed_path_prefixes,
    "standing_release_allowed_paths_invalid",
    { max: 100 },
  );
  if (allowed.some((allowedPrefix) => denied.some((deniedPrefix) => pathWithin(allowedPrefix, deniedPrefix)))) {
    fail("standing_release_protected_path_allowed");
  }
  return Object.freeze({
    schema_version: STANDING_RELEASE_MANDATE_VERSION,
    tenant_id: identifier(input.tenant_id, "standing_release_tenant_invalid"),
    authorization_work_id: workId(input.authorization_work_id, "standing_release_work_invalid"),
    authorization_intent_anchor_digest: sha256(
      input.authorization_intent_anchor_digest,
      "standing_release_intent_invalid",
    ),
    repository,
    base_branch: baseBranch,
    delivery_branch_prefix: deliveryPrefix,
    allowed_path_prefixes: allowed,
    denied_path_prefixes: denied,
    required_checks: stableStrings(input.required_checks, "standing_release_checks_invalid", { max: 20 }),
    required_checks_policy_digest: sha256(
      input.required_checks_policy_digest,
      "standing_release_checks_policy_invalid",
    ),
    services: normalizeServices(input.services),
    repair_classes: repairClasses,
    limits: normalizeLimits(input.limits),
    allowed_actions: [...STANDING_RELEASE_ACTIONS],
    base_protection_required: true,
    direct_main_push_allowed: false,
    force_push_allowed: false,
    delete_ref_allowed: false,
    tag_allowed: false,
    secret_access_allowed: false,
    workflow_change_allowed: false,
    provider_execution: false,
    host_action_ticket_required: true,
    expires_at: new Date(expiresAt).toISOString(),
  });
}

export function standingReleaseEffectiveState(record, {
  now = Date.now(),
  runtimeEnabled = false,
  emergencyStop = false,
} = {}) {
  if (!record || record.state !== "active") return record?.state || "unavailable";
  if (emergencyStop === true) return "emergency_stopped";
  if (runtimeEnabled !== true) return "runtime_disabled";
  if (Date.parse(record.mandate?.expires_at || "") <= Number(typeof now === "function" ? now() : now)) {
    return "expired";
  }
  return "active";
}

export function validateStandingReleaseDerivation(record, input = {}, options = {}) {
  exactKeys(input, new Set([
    "tenant_id", "mandate_id", "work_id", "intent_anchor_digest", "delivery_branch",
    "changed_files", "builder_agent_id", "verifier_agent_ids", "required_checks_policy_digest",
    "induced_services", "host_kind", "host_session_fingerprint",
    "intent_binding", "dtt_request_binding_digest", "dtt_session_fingerprint",
    "horizontal_runner_required", "ttl_seconds", "idempotency_key",
  ]), "standing_release_derivation_invalid");
  const effectiveState = standingReleaseEffectiveState(record, options);
  if (effectiveState !== "active") fail(`standing_release_${effectiveState}`);
  const mandate = record.mandate;
  if (
    identifier(input.tenant_id, "standing_release_tenant_invalid") !== mandate.tenant_id ||
    text(input.mandate_id, "standing_release_mandate_id_invalid", 200) !== record.mandate_id
  ) fail("standing_release_cross_tenant_denied");
  const deliveryBranch = branch(input.delivery_branch, "standing_release_delivery_branch_invalid");
  if (!deliveryBranch.startsWith(mandate.delivery_branch_prefix) || deliveryBranch === mandate.base_branch) {
    fail("standing_release_delivery_branch_denied");
  }
  const changedFiles = prefixes(input.changed_files, "standing_release_changed_files_invalid", { max: 5_000 });
  if (changedFiles.some((file) =>
    !mandate.allowed_path_prefixes.some((prefix) => pathWithin(file, prefix)) ||
    mandate.denied_path_prefixes.some((prefix) => pathWithin(file, prefix)))) {
    fail("standing_release_path_denied");
  }
  const builder = identifier(input.builder_agent_id, "standing_release_builder_invalid");
  const verifiers = stableStrings(input.verifier_agent_ids, "standing_release_verifiers_invalid", { max: 3 });
  if (verifiers.includes(builder)) fail("standing_release_self_verification_denied");
  if (sha256(input.required_checks_policy_digest, "standing_release_checks_policy_invalid") !== mandate.required_checks_policy_digest) {
    fail("standing_release_checks_policy_drift");
  }
  const protection = options.baseProtection;
  exactKeys(protection, new Set([
    "schema_version", "trusted", "source", "tenant_id", "repository", "branch", "base_commit",
    "protected", "direct_push_allowed", "force_push_allowed", "deletion_allowed",
    "pull_request_required", "approving_reviews_required", "enforce_admins",
    "bypass_allowance_count", "required_checks", "required_checks_policy_digest",
    "check_app_id", "verified_at", "provider_execution", "evidence_digest",
  ]), "standing_release_base_protection_invalid");
  if (
    protection.schema_version !== "standing_release_base_protection_readback_v1" ||
    protection.trusted !== true || protection.source !== "universal_core_github_readback" ||
    protection.tenant_id !== mandate.tenant_id || protection.repository !== mandate.repository ||
    protection.branch !== mandate.base_branch || protection.protected !== true ||
    protection.direct_push_allowed !== false || protection.force_push_allowed !== false ||
    protection.deletion_allowed !== false || protection.pull_request_required !== true ||
    Number(protection.approving_reviews_required) < 1 || protection.enforce_admins !== true ||
    protection.bypass_allowance_count !== 0 || protection.provider_execution !== false ||
    protection.required_checks_policy_digest !== mandate.required_checks_policy_digest ||
    !sameStrings(
      stableStrings(protection.required_checks, "standing_release_base_protection_invalid", { max: 20 }),
      mandate.required_checks,
    )
  ) fail("standing_release_base_protection_invalid");
  sha256(protection.evidence_digest, "standing_release_base_protection_invalid");
  const baseCommit = gitSha(protection.base_commit, "standing_release_base_protection_invalid");
  const protectionVerifiedAt = Date.parse(protection.verified_at);
  const protectionNow = Number(typeof options.now === "function" ? options.now() : options.now ?? Date.now());
  if (
    !Number.isFinite(protectionVerifiedAt) || protectionVerifiedAt > protectionNow + 30_000 ||
    protectionVerifiedAt < protectionNow - 5 * 60_000
  ) fail("standing_release_base_protection_stale");
  if (!sameServices(input.induced_services, mandate.services)) fail("standing_release_service_scope_drift");
  const ttlSeconds = positiveInteger(input.ttl_seconds, "standing_release_delegation_ttl_invalid", 43_200);
  const hostKind = text(input.host_kind, "standing_release_host_invalid", 80);
  if (!["chatgpt_native", "codex_native"].includes(hostKind)) fail("standing_release_host_invalid");
  const hostSessionFingerprint = text(
    input.host_session_fingerprint,
    "standing_release_host_session_invalid",
    300,
  );
  if (!/^[a-f0-9]{64}$/.test(hostSessionFingerprint)) fail("standing_release_host_session_invalid");
  const horizontalRunnerRequired = input.horizontal_runner_required === true;
  if (
    input.horizontal_runner_required !== undefined &&
    typeof input.horizontal_runner_required !== "boolean"
  ) fail("standing_release_runner_binding_invalid");
  const dttSessionFingerprint = horizontalRunnerRequired
    ? text(input.dtt_session_fingerprint, "standing_release_runner_binding_invalid", 160)
    : null;
  if (
    horizontalRunnerRequired &&
    (!/^[a-f0-9]{64}$/.test(dttSessionFingerprint) ||
      dttSessionFingerprint !== hostSessionFingerprint)
  ) fail("standing_release_runner_binding_invalid");
  const nowValue = Number(typeof options.now === "function" ? options.now() : options.now ?? Date.now());
  text(input.idempotency_key, "standing_release_idempotency_key_required", 160);
  const boundWorkId = workId(input.work_id, "standing_release_work_invalid");
  const boundIntentDigest = sha256(input.intent_anchor_digest, "standing_release_intent_invalid");
  const intentBinding = normalizeStandingReleaseIntentBinding(input.intent_binding, {
    tenantId: mandate.tenant_id,
    workId: boundWorkId,
    intentDigest: boundIntentDigest,
    now: nowValue,
  });
  const dttRequestBindingDigest = sha256(
    input.dtt_request_binding_digest,
    "standing_release_intent_binding_invalid",
  );
  const expiresAt = Math.min(
    Date.parse(mandate.expires_at),
    nowValue + ttlSeconds * 1_000,
    nowValue + STANDING_RELEASE_MAX_DELEGATION_MS,
  );
  return Object.freeze({
    tenant_id: mandate.tenant_id,
    work_id: boundWorkId,
    intent_anchor_digest: boundIntentDigest,
    work_intent_binding_digest: intentBinding.binding_digest,
    dtt_request_binding_digest: dttRequestBindingDigest,
    repository: mandate.repository,
    audience: [hostKind],
    allowed_branches: [deliveryBranch, mandate.base_branch].sort(),
    protected_branches: [mandate.base_branch],
    allowed_path_prefixes: [...mandate.allowed_path_prefixes],
    allowed_actions: [...mandate.allowed_actions],
    budget: {
      max_agents: 3,
      max_parallel: 2,
      max_commits: mandate.limits.max_commits,
      max_pushes: mandate.limits.max_pushes,
      max_deploys:
        mandate.services.length * mandate.limits.max_deploys_per_service + mandate.limits.max_rollbacks,
      max_total_actions:
        mandate.limits.max_commits + mandate.limits.max_pushes +
        mandate.limits.max_pull_requests + mandate.limits.max_merges +
        mandate.services.length * mandate.limits.max_deploys_per_service +
        mandate.limits.max_rollbacks + 4,
    },
    release_policy: {
      manifest_required_for_protected_push: true,
      manifest_required_for_induced_deploy: true,
      manifest_required_for_deploy: true,
      independent_verifier_required: true,
      rollback_required: true,
      required_checks: [...mandate.required_checks],
    },
    expires_at: new Date(expiresAt).toISOString(),
    standing_release_binding: {
      schema_version: "standing_release_delegation_binding_v1",
      mandate_id: record.mandate_id,
      mandate_digest: record.mandate_digest,
      revision: record.revision,
      revocation_epoch: record.revocation_epoch,
      delivery_branch: deliveryBranch,
      changed_files: changedFiles,
      builder_agent_id: builder,
      verifier_agent_ids: verifiers,
      base_protection_evidence_digest: protection.evidence_digest,
      intent_binding: intentBinding,
      work_intent_binding_digest: intentBinding.binding_digest,
      dtt_request_binding_digest: dttRequestBindingDigest,
      base_commit: baseCommit,
      required_checks_policy_digest: mandate.required_checks_policy_digest,
      induced_services: normalizeServices(input.induced_services),
      max_repair_attempts: mandate.limits.max_repair_attempts,
      repair_classes: [...mandate.repair_classes],
      limits: { ...mandate.limits },
      host_kind: hostKind,
      host_session_fingerprint: hostSessionFingerprint,
      horizontal_runner_required: horizontalRunnerRequired,
      coordination_model: horizontalRunnerRequired
        ? "horizontal_peer_adapters_v1"
        : "legacy_host_ticket_v1",
      provider_execution: false,
    },
    authorization_source: "owner_standing_release_mandate",
    provider_execution: false,
  });
}

export function standingReleaseBindingActive(state, delegation, options = {}) {
  const binding = delegation?.grant?.standing_release_binding;
  if (!binding) return true;
  const record = state?.standing_release_mandates?.[binding.mandate_id];
  return standingReleaseEffectiveState(record, options) === "active" &&
    record?.mandate?.tenant_id === delegation.grant.tenant_id &&
    record?.mandate_digest === binding.mandate_digest &&
    record?.revision === binding.revision &&
    record?.revocation_epoch === binding.revocation_epoch;
}
