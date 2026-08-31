import { parseNyraProjectReleaseBindings } from "./nyra-native-plan-bridge.js";
import { parseHostAppRegistry } from "./host-app-registry.js";
import {
  canonicalOwnerManualEffectGitRef,
  canonicalOwnerManualEffectPosixPath,
  normalizeOwnerManualEffectReference,
} from "./owner-manual-effect-work-binding.js";
import {
  genericWorkCoreJoinDigest,
} from "../../universal-core-service/src/genericWorkCoreJoin.js";

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function url(value, name) {
  if (!value) return "";
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}

function jsonObject(value, name) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return parsed;
  } catch {
    throw new Error(`${name} must be a JSON object`);
  }
}

function parseNyraAtlasRepositoryBindings(value, name) {
  const parsed = jsonObject(value, name);
  const result = {};
  for (const [projectValue, bindingValue] of Object.entries(parsed)) {
    const projectId = String(projectValue || "").trim();
    const binding = typeof bindingValue === "string" ? { repository: bindingValue } : bindingValue;
    const repository = String(binding?.repository || "").trim();
    const branch = String(binding?.branch || "main").trim();
    const credentialTenantId = String(binding?.credential_tenant_id || "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,63}$/.test(projectId) ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
        !branch || branch.length > 240 || branch.includes("\u0000") ||
        (credentialTenantId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(credentialTenantId))) {
      throw new Error(`${name} contains an invalid project repository binding`);
    }
    result[projectId] = Object.freeze({ repository, branch, credentialTenantId: credentialTenantId || null });
  }
  return Object.freeze(result);
}

function parseNyraAtlasGithubTokens(value, name) {
  const parsed = jsonObject(value, name);
  const result = {};
  for (const [tenantValue, tokenValue] of Object.entries(parsed)) {
    const tenantId = String(tenantValue || "").trim();
    const token = String(tokenValue || "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId) || token.length < 20) {
      throw new Error(`${name} contains an invalid tenant credential`);
    }
    result[tenantId] = token;
  }
  return Object.freeze(result);
}

// Authority policy is deployment-owned configuration, deliberately separate
// from the caller-authored V2 Work architecture. It gives the owner-manual
// reconciliation flow an immutable allowlist of adapters/effects and the
// exact Nyra/Core break-glass selector for a tenant/project.
function parseOwnerManualEffectPolicies(value, name) {
  if (!value) return Object.freeze([]);
  let source;
  try { source = JSON.parse(value); } catch { throw new Error(`${name} must be valid JSON`); }
  if (!source || typeof source !== "object" || Array.isArray(source) ||
      source.schema_version !== "owner_manual_effect_policies_v1" ||
      !Array.isArray(source.policies) || source.policies.length > 256) {
    throw new Error(`${name} must contain owner_manual_effect_policies_v1 policies`);
  }
  const seen = new Set();
  // A completed Nyra/Core repair action may close exactly one tenant Work.
  // This deployment-time constraint prevents two effect bindings from
  // describing the same physical repair even when they share a path.
  const breakGlassActionIds = new Set();
  const breakGlassActionDigests = new Set();
  const breakGlassReceiptIds = new Set();
  const breakGlassReceiptDigests = new Set();
  const policies = source.policies.map((policy) => {
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      throw new Error(`${name} policy invalid`);
    }
    const fields = Object.keys(policy).sort();
    const permitted = [
      "break_glass",
      "effect_bindings",
      "effects",
      "project_id",
      "repository",
      "tenant_id",
    ];
    if (fields.some((field) => !permitted.includes(field)) ||
        !["effects", "project_id", "repository", "tenant_id"].every((field) => fields.includes(field))) {
      throw new Error(`${name} policy fields invalid`);
    }
    const tenantId = String(policy.tenant_id || "").trim();
    const projectId = String(policy.project_id || "").trim();
    const repository = String(policy.repository || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(tenantId) ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(projectId) ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
        !Array.isArray(policy.effects) || policy.effects.length > 32) {
      throw new Error(`${name} policy binding invalid`);
    }
    const key = `${tenantId}\u0000${projectId}`;
    if (seen.has(key)) throw new Error(`${name} has duplicate tenant/project policy`);
    seen.add(key);
    const effects = policy.effects.map((effect) => {
      if (!effect || typeof effect !== "object" || Array.isArray(effect) ||
          Object.keys(effect).sort().join("\u0000") !== [
            "adapter_id", "effect_type", "resource_id",
          ].join("\u0000")) {
        throw new Error(`${name} effect invalid`);
      }
      const adapterId = String(effect.adapter_id || "").trim();
      const effectType = String(effect.effect_type || "").trim();
      const resourceId = String(effect.resource_id || "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(adapterId) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(effectType) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,254}$/.test(resourceId)) {
        throw new Error(`${name} effect invalid`);
      }
      return Object.freeze({ adapter_id: adapterId, effect_type: effectType, resource_id: resourceId });
    });
    let breakGlass = null;
    if (policy.break_glass !== undefined) {
      const entry = policy.break_glass;
      if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
          Object.keys(entry).sort().join("\u0000") !== [
            "allowed_path_prefixes", "branch", "resource_id",
          ].join("\u0000") ||
          typeof entry.branch !== "string" ||
          typeof entry.resource_id !== "string" ||
          !/^nyra_core:[A-Za-z0-9][A-Za-z0-9._:/-]{2,240}$/.test(entry.resource_id) ||
          !Array.isArray(entry.allowed_path_prefixes) || !entry.allowed_path_prefixes.length ||
          entry.allowed_path_prefixes.length > 16) {
        throw new Error(`${name} break_glass invalid`);
      }
      let branch;
      let prefixes;
      try {
        branch = canonicalOwnerManualEffectGitRef(entry.branch, `${name} break_glass invalid`);
        prefixes = entry.allowed_path_prefixes.map((prefix) =>
          canonicalOwnerManualEffectPosixPath(prefix, `${name} break_glass invalid`));
      } catch {
        throw new Error(`${name} break_glass invalid`);
      }
      const stablePrefixes = [...new Set(prefixes)].sort((left, right) => left.localeCompare(right));
      if (stablePrefixes.length !== prefixes.length) {
        throw new Error(`${name} break_glass invalid`);
      }
      breakGlass = Object.freeze({
        branch,
        resource_id: entry.resource_id,
        allowed_path_prefixes: Object.freeze(stablePrefixes),
      });
    }
    const effectBindingsInput = policy.effect_bindings === undefined ? [] : policy.effect_bindings;
    if (!Array.isArray(effectBindingsInput) || effectBindingsInput.length > 64) {
      throw new Error(`${name} effect_bindings invalid`);
    }
    const effectBindingKeys = new Set();
    const effectBindings = effectBindingsInput.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
          Object.keys(entry).sort().join("\u0000") !== [
            "adapter_id",
            "effect_reference",
            "effect_type",
            "intent_anchor_digest",
            "mode",
            "resource_id",
            "work_id",
          ].join("\u0000")) {
        throw new Error(`${name} effect_binding invalid`);
      }
      const workId = String(entry.work_id || "").trim().toLowerCase();
      const intentAnchorDigest = String(entry.intent_anchor_digest || "").trim().toLowerCase();
      const mode = entry.mode;
      const adapterId = String(entry.adapter_id || "").trim();
      const effectType = String(entry.effect_type || "").trim();
      const resourceId = String(entry.resource_id || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workId) ||
          !/^[a-f0-9]{64}$/.test(intentAnchorDigest) ||
          !["OWNER_MANUAL", "OWNER_BREAK_GLASS"].includes(mode) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(adapterId) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(effectType) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,254}$/.test(resourceId)) {
        throw new Error(`${name} effect_binding invalid`);
      }
      let effectReference;
      try {
        effectReference = normalizeOwnerManualEffectReference({
          adapter_id: adapterId,
          effect_type: effectType,
          resource_id: resourceId,
          effect_reference: entry.effect_reference,
          repository,
          mode,
          break_glass: breakGlass,
          code: `${name} effect_binding invalid`,
        });
      } catch {
        throw new Error(`${name} effect_binding invalid`);
      }
      const effectReferenceDigest = genericWorkCoreJoinDigest(effectReference);
      if (mode === "OWNER_BREAK_GLASS") {
        const actionIdClaim = [tenantId, effectReference.repair_action_id].join("\u0000");
        const actionDigestClaim = [tenantId, effectReference.repair_action_digest].join("\u0000");
        if (breakGlassActionIds.has(actionIdClaim) ||
            breakGlassActionDigests.has(actionDigestClaim)) {
          throw new Error(`${name} effect_binding repair action reused`);
        }
        breakGlassActionIds.add(actionIdClaim);
        breakGlassActionDigests.add(actionDigestClaim);
        const receiptIdClaim = [tenantId, effectReference.repair_receipt_id].join("\u0000");
        const receiptDigestClaim = [tenantId, effectReference.repair_receipt_digest].join("\u0000");
        if (breakGlassReceiptIds.has(receiptIdClaim) ||
            breakGlassReceiptDigests.has(receiptDigestClaim)) {
          throw new Error(`${name} effect_binding repair receipt reused`);
        }
        breakGlassReceiptIds.add(receiptIdClaim);
        breakGlassReceiptDigests.add(receiptDigestClaim);
      }
      const bindingKey = [
        workId,
        intentAnchorDigest,
        mode,
        adapterId,
        effectType,
        resourceId,
        effectReferenceDigest,
      ].join("\u0000");
      if (effectBindingKeys.has(bindingKey)) throw new Error(`${name} effect_binding duplicate`);
      effectBindingKeys.add(bindingKey);
      return Object.freeze({
        work_id: workId,
        intent_anchor_digest: intentAnchorDigest,
        mode,
        adapter_id: adapterId,
        effect_type: effectType,
        resource_id: resourceId,
        effect_reference: effectReference,
        effect_reference_digest: effectReferenceDigest,
      });
    });
    if (!effects.length && !breakGlass) throw new Error(`${name} policy has no authority selectors`);
    return Object.freeze({
      tenant_id: tenantId,
      project_id: projectId,
      repository,
      effects: Object.freeze(effects),
      break_glass: breakGlass,
      effect_bindings: Object.freeze(effectBindings.sort((left, right) =>
        `${left.work_id}\u0000${left.effect_reference_digest}`.localeCompare(
          `${right.work_id}\u0000${right.effect_reference_digest}`))),
    });
  });
  return Object.freeze(policies);
}

function parseOauthOwnerTenantBindings(value, name) {
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${name} must be a JSON object`); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(`${name} must be a JSON object`);
  const result = {};
  for (const [subjectValue, tenantValue] of Object.entries(parsed)) {
    const subject = String(subjectValue || "").trim();
    const tenantId = typeof tenantValue === "string"
      ? tenantValue.trim()
      : String(tenantValue?.tenant_id || "").trim();
    if (!subject || subject.length > 240) throw new Error(`${name} contains an invalid subject`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId)) throw new Error(`${name} contains an invalid tenant id`);
    result[subject] = tenantId;
  }
  return result;
}

const OAUTH_TENANT_MEMBERSHIP_ROLES = new Set([
  "member", "reviewer", "operator", "support_delegate", "team_manager", "super_admin",
]);

function parseOauthTenantMemberships(value, name) {
  const parsed = jsonObject(value, name);
  const result = {};
  for (const [subjectValue, membershipValue] of Object.entries(parsed)) {
    const subject = String(subjectValue || "").trim();
    if (!subject || subject.length > 240) throw new Error(`${name} contains an invalid subject`);
    if (!membershipValue || Array.isArray(membershipValue) || typeof membershipValue !== "object") {
      throw new Error(`${name} membership must contain tenant_id and role`);
    }
    const tenantId = String(membershipValue.tenant_id || "").trim();
    const role = String(membershipValue.role || "").trim().toLowerCase();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId)) {
      throw new Error(`${name} contains an invalid tenant id`);
    }
    if (!OAUTH_TENANT_MEMBERSHIP_ROLES.has(role)) {
      throw new Error(`${name} contains an invalid membership role`);
    }
    const teamIds = Array.isArray(membershipValue.team_ids) ? membershipValue.team_ids.map((item) => String(item || "").trim()) : [];
    const managedTeamIds = Array.isArray(membershipValue.managed_team_ids) ? membershipValue.managed_team_ids.map((item) => String(item || "").trim()) : [];
    if ([...teamIds, ...managedTeamIds].some((item) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/.test(item))) {
      throw new Error(`${name} contains an invalid team id`);
    }
    const expiresAt = String(membershipValue.expires_at || "").trim();
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw new Error(`${name} contains an invalid expires_at`);
    if (role === "team_manager" && !managedTeamIds.length) {
      throw new Error(`${name} team_manager requires managed_team_ids`);
    }
    if (role === "support_delegate") {
      const delegationId = String(membershipValue.delegation_id || "").trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{1,119}$/.test(delegationId)) {
        throw new Error(`${name} support delegation requires a valid delegation_id`);
      }
      if (!Number.isFinite(Date.parse(expiresAt))) {
        throw new Error(`${name} support delegation requires a valid expires_at`);
      }
      result[subject] = {
        tenantId, role, delegationId, expiresAt,
        ...(teamIds.length ? { teamIds } : {}),
        ...(managedTeamIds.length ? { managedTeamIds } : {}),
      };
      continue;
    }
    result[subject] = {
      tenantId, role,
      ...(expiresAt ? { expiresAt } : {}),
      ...(teamIds.length ? { teamIds } : {}),
      ...(managedTeamIds.length ? { managedTeamIds } : {}),
    };
  }
  return result;
}

function parseSuiteControlPlaneKeys(value, singleKey, singleTenantId) {
  const bindings = {};
  const tenantMap = {};
  const add = (identityTenantValue, suiteTenantValue, secretValue) => {
    const identityTenantId = String(identityTenantValue || "").trim();
    const suiteTenantId = String(suiteTenantValue || identityTenantId).trim();
    const secret = String(secretValue || "").trim();
    if (!identityTenantId || !suiteTenantId || !secret) return;
    if (![identityTenantId, suiteTenantId].every((tenantId) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId))) {
      throw new Error("SUITE_CONTROL_PLANE_KEYS_JSON contains an invalid tenant id");
    }
    if (bindings[identityTenantId] && (bindings[identityTenantId] !== secret || tenantMap[identityTenantId] !== suiteTenantId)) {
      throw new Error(`SUITE_CONTROL_PLANE_KEYS_JSON contains duplicate tenant ${identityTenantId}`);
    }
    bindings[identityTenantId] = secret;
    tenantMap[identityTenantId] = suiteTenantId;
  };

  if (value) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("SUITE_CONTROL_PLANE_KEYS_JSON must be valid JSON");
    }
    if (Array.isArray(parsed)) {
      for (const record of parsed) {
        const identityTenantId = record?.mcp_tenant_id || record?.identity_tenant_id || record?.tenant_id;
        add(identityTenantId, record?.suite_tenant_id || record?.tenant_id || identityTenantId, record?.secret || record?.key || record?.api_key);
      }
    } else if (parsed && typeof parsed === "object") {
      for (const [entryKey, entryValue] of Object.entries(parsed)) {
        if (typeof entryValue === "string") add(entryKey, entryKey, entryValue);
        else if (entryValue && typeof entryValue === "object") {
          const identityTenantId = entryValue.mcp_tenant_id || entryValue.identity_tenant_id || entryKey;
          add(identityTenantId, entryValue.suite_tenant_id || entryValue.tenant_id || identityTenantId, entryValue.secret || entryValue.key || entryValue.api_key);
        }
      }
    } else {
      throw new Error("SUITE_CONTROL_PLANE_KEYS_JSON must be an object or array");
    }
  }

  const compatibilityKey = String(singleKey || "").trim();
  const compatibilityTenant = String(singleTenantId || "").trim();
  if (compatibilityKey && !compatibilityTenant) {
    throw new Error("SUITE_CONTROL_PLANE_TENANT_ID is required with SUITE_CONTROL_PLANE_API_KEY");
  }
  add(compatibilityTenant, compatibilityTenant, compatibilityKey);
  return { keys: bindings, tenantMap };
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function strictInteger(value, fallback, min, max, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function flag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function strictFlag(value, fallback, name) {
  if (value === undefined || value === null || value === "") {
    return { value: fallback, valid: true, error: null };
  }
  const normalized = String(value);
  if (normalized === "true") return { value: true, valid: true, error: null };
  if (normalized === "false") return { value: false, valid: true, error: null };
  return { value: false, valid: false, error: `${name}_FLAG_INVALID`.toLowerCase() };
}

function optionalFullCommit(value, name) {
  const commit = String(value || "").trim().toLowerCase();
  if (!commit) return "";
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`${name} must be a full 40-character commit SHA`);
  return commit;
}

export function loadConfig(env = process.env) {
  const environment = String(env.NODE_ENV || "development").trim().toLowerCase();
  const publicUrl = url(env.MCP_PUBLIC_URL || "http://localhost:8790", "MCP_PUBLIC_URL");
  const webAgentAllowedOrigins = csv(env.WEB_AGENT_ALLOWED_ORIGINS).map((value) => {
    try { return new URL(value).origin; } catch { throw new Error("WEB_AGENT_ALLOWED_ORIGINS contains an invalid URL"); }
  });
  const auth0Issuer = url(env.AUTH0_ISSUER, "AUTH0_ISSUER");
  const auth0Audience = String(env.AUTH0_AUDIENCE || "").trim();
  const codexKeys = csv(env.CODEX_BEARER_KEYS);
  const legacyCodexHostPrincipalEnabledFlag = strictFlag(
    env.MCP_LEGACY_CODEX_HOST_PRINCIPAL_ENABLED,
    false,
    "MCP_LEGACY_CODEX_HOST_PRINCIPAL_ENABLED",
  );
  const legacyCodexHostPrincipalEnabled = legacyCodexHostPrincipalEnabledFlag.valid
    ? legacyCodexHostPrincipalEnabledFlag.value
    : false;
  const nyraDialogueEnabledFlag = strictFlag(
    env.NYRA_DIALOGUE_ENABLED,
    false,
    "NYRA_DIALOGUE_ENABLED",
  );
  const nyraDialogueEnabled = nyraDialogueEnabledFlag.valid
    ? nyraDialogueEnabledFlag.value
    : false;
  const universalCoreUrl = url(env.UNIVERSAL_CORE_URL || env.CORE_BASE_URL || "http://127.0.0.1:8787", "UNIVERSAL_CORE_URL");
  const githubStandingReleaseWorkerUrl = url(
    env.GITHUB_STANDING_RELEASE_WORKER_URL,
    "GITHUB_STANDING_RELEASE_WORKER_URL",
  );
  const standingReleaseAutoCoordinatorFlag = strictFlag(
    env.STANDING_RELEASE_AUTO_COORDINATOR_ENABLED,
    false,
    "STANDING_RELEASE_AUTO_COORDINATOR_ENABLED",
  );
  const standingReleaseAutoCoordinatorEnabled = standingReleaseAutoCoordinatorFlag.valid
    ? standingReleaseAutoCoordinatorFlag.value
    : false;
  const standingReleaseAutoCoordinatorConfigurationError =
    !standingReleaseAutoCoordinatorFlag.valid
      ? standingReleaseAutoCoordinatorFlag.error
      : standingReleaseAutoCoordinatorEnabled && !githubStandingReleaseWorkerUrl
        ? "standing_release_auto_coordinator_worker_url_required"
        : null;
  const universalCoreKey = String(env.UNIVERSAL_CORE_KEY || "").trim();
  const universalCoreKeys = jsonObject(env.UNIVERSAL_CORE_KEYS_JSON, "UNIVERSAL_CORE_KEYS_JSON");
  const suiteControlPlaneUrl = url(env.SUITE_CONTROL_PLANE_URL, "SUITE_CONTROL_PLANE_URL");
  const suiteControlPlaneBindings = parseSuiteControlPlaneKeys(
    env.SUITE_CONTROL_PLANE_KEYS_JSON,
    env.SUITE_CONTROL_PLANE_API_KEY,
    env.SUITE_CONTROL_PLANE_TENANT_ID,
  );
  const agentSignatureSecretCandidate = String(
    env.AGENT_SIGNATURE_SECRET || "",
  ).trim();
  const agentSignatureSecret =
    Buffer.byteLength(agentSignatureSecretCandidate, "utf8") >= 32
      ? agentSignatureSecretCandidate
      : "";
  const agentPresenceSignatureVersion = String(
    env.AGENT_PRESENCE_SIGNATURE_VERSION || "v1",
  ).trim().toLowerCase();
  if (!["v1", "v2"].includes(agentPresenceSignatureVersion)) {
    throw new Error("AGENT_PRESENCE_SIGNATURE_VERSION must be v1 or v2");
  }
  const dttAgentIdentitySigningSecretCandidate = String(env.DTT_AGENT_IDENTITY_SIGNING_SECRET || "").trim();
  const dttAgentIdentitySigningSecret = dttAgentIdentitySigningSecretCandidate.length >= 32
    ? dttAgentIdentitySigningSecretCandidate
    : "";
  const nyraDeepV2McpRequestSigningSecretCandidate = String(
    env.CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET || "",
  ).trim();
  const nyraDeepV2McpRequestSigningSecret =
    nyraDeepV2McpRequestSigningSecretCandidate.length >= 32
      ? nyraDeepV2McpRequestSigningSecretCandidate
      : "";
  const ownerContextSigningSecretCandidate = String(env.CORE_OWNER_CONTEXT_SIGNING_SECRET || "").trim();
  // Keep this independent from Core bearer credentials. A short value is not
  // a usable signature key and therefore deliberately behaves as missing.
  const ownerContextSigningSecret = ownerContextSigningSecretCandidate.length >= 32
    ? ownerContextSigningSecretCandidate
    : "";
  const tenantContextSigningSecretCandidate = String(
    env.CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET || "",
  ).trim();
  const tenantContextSigningSecret =
    Buffer.byteLength(tenantContextSigningSecretCandidate, "utf8") >= 32
      ? tenantContextSigningSecretCandidate
      : "";
  const nyraGovernedContinueEnabledFlag = strictFlag(
    env.NYRA_GOVERNED_CONTINUE_ENABLED,
    false,
    "NYRA_GOVERNED_CONTINUE_ENABLED",
  );
  const nyraGovernedContinueSigningSecretCandidate = String(
    env.NYRA_GOVERNED_CONTINUE_SIGNING_SECRET || "",
  ).trim();
  const nyraGovernedContinueSigningSecret =
    Buffer.byteLength(nyraGovernedContinueSigningSecretCandidate, "utf8") >= 32
      ? nyraGovernedContinueSigningSecretCandidate
      : "";
  const runtimeBuildCommit = optionalFullCommit(env.RENDER_GIT_COMMIT || env.GIT_COMMIT, "RENDER_GIT_COMMIT");
  const chatgptTenantId = String(env.MCP_CHATGPT_TENANT_ID || "").trim();
  const chatgptCoreKey = String(env.CORE_MCP_KEY || "").trim();
  const tenantGatewayKeyCandidate = String(
    env.CORE_MCP_TENANT_GATEWAY_KEY || "",
  ).trim();
  const tenantGatewayKey =
    Buffer.byteLength(tenantGatewayKeyCandidate, "utf8") >= 32
      ? tenantGatewayKeyCandidate
      : "";
  const environmentDelegationKey = String(env.MCP_ENVIRONMENT_DELEGATION_KEY || "").trim();
  if (chatgptTenantId && chatgptCoreKey && !universalCoreKeys[chatgptTenantId]) {
    universalCoreKeys[chatgptTenantId] = chatgptCoreKey;
  }
  const defaultTenantId = String(env.MCP_DEFAULT_TENANT_ID || "owner-private").trim();
  const tenantClaim = String(env.MCP_TENANT_CLAIM || "https://skinharmony.it/tenant_id").trim();
  // Subject-to-tenant ownership is server-side only. Never accept this
  // binding from a token claim, URL, body or tool argument.
  const oauthOwnerTenantBindings = parseOauthOwnerTenantBindings(env.AUTH0_OWNER_TENANT_BINDINGS_JSON, "AUTH0_OWNER_TENANT_BINDINGS_JSON");
  // Ordinary tenant collaboration is configured independently from ownership.
  // These roles are intentionally bounded and can never grant owner elevation
  // or provider setup.
  const oauthTenantMemberships = parseOauthTenantMemberships(
    env.AUTH0_TENANT_MEMBERSHIPS_JSON,
    "AUTH0_TENANT_MEMBERSHIPS_JSON",
  );
  // Authentication proves the subject. This independent registry proves
  // which ChatGPT/Codex/future-AI application is carrying that subject and
  // which Work/host-native capabilities that application may request. It
  // never grants an owner role.
  const hostAppRegistry = parseHostAppRegistry(
    env.MCP_HOST_APP_REGISTRY_JSON,
    env,
  );
  const hostAppBearerCredentials = hostAppRegistry.apps
    .filter((app) => app.auth_kind === "bearer")
    .map((app) => app.credential)
    .filter(Boolean);
  const reservedHostCredentialSecrets = [
    ["CODEX_BEARER_KEYS", codexKeys],
    ["UNIVERSAL_CORE_KEY", [universalCoreKey]],
    ["CORE_MCP_KEY", [chatgptCoreKey]],
    ["UNIVERSAL_CORE_KEYS_JSON", Object.values(universalCoreKeys)],
    ["CORE_MCP_TENANT_GATEWAY_KEY", [tenantGatewayKey]],
    ["SUITE_CONTROL_PLANE_KEYS_JSON", Object.values(suiteControlPlaneBindings.keys)],
    ["AGENT_SIGNATURE_SECRET", [agentSignatureSecret]],
    ["DTT_AGENT_IDENTITY_SIGNING_SECRET", [dttAgentIdentitySigningSecret]],
    ["CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET", [nyraDeepV2McpRequestSigningSecret]],
    ["CORE_OWNER_CONTEXT_SIGNING_SECRET", [ownerContextSigningSecret]],
    ["CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET", [tenantContextSigningSecret]],
    ["NYRA_GOVERNED_CONTINUE_SIGNING_SECRET", [nyraGovernedContinueSigningSecret]],
    ["MCP_ENVIRONMENT_DELEGATION_KEY", [environmentDelegationKey]],
  ];
  for (const credential of hostAppBearerCredentials) {
    for (const [source, secrets] of reservedHostCredentialSecrets) {
      if (secrets.some((secret) => String(secret || "").trim() === credential)) {
        throw new Error(
          `MCP_HOST_APP_REGISTRY_JSON bearer credential reuses reserved secret ${source}`,
        );
      }
    }
  }
  const agentSignatureSecretReused = Boolean(
    agentSignatureSecret &&
    [
      universalCoreKey,
      chatgptCoreKey,
      ...Object.values(universalCoreKeys),
      tenantGatewayKey,
      ownerContextSigningSecret,
      tenantContextSigningSecret,
      dttAgentIdentitySigningSecret,
      nyraDeepV2McpRequestSigningSecret,
      nyraGovernedContinueSigningSecret,
      ...codexKeys,
      ...hostAppBearerCredentials,
    ].some((secret) =>
      String(secret || "").trim() === agentSignatureSecret),
  );
  const nyraGovernedContinueSecretReused = Boolean(
    nyraGovernedContinueSigningSecret && [
      universalCoreKey,
      chatgptCoreKey,
      ...Object.values(universalCoreKeys),
      tenantGatewayKey,
      ownerContextSigningSecret,
      tenantContextSigningSecret,
      dttAgentIdentitySigningSecret,
      nyraDeepV2McpRequestSigningSecret,
      agentSignatureSecret,
      ...codexKeys,
      ...hostAppBearerCredentials,
    ].some((secret) => String(secret || "").trim() === nyraGovernedContinueSigningSecret),
  );
  const nyraGovernedContinueEnabled = nyraGovernedContinueEnabledFlag.valid
    ? nyraGovernedContinueEnabledFlag.value
    : false;
  const nyraGovernedContinueConfigurationError = !nyraGovernedContinueEnabledFlag.valid
    ? nyraGovernedContinueEnabledFlag.error
    : nyraGovernedContinueEnabled && !nyraGovernedContinueSigningSecret
      ? "nyra_governed_continue_signing_secret_unavailable"
      : nyraGovernedContinueEnabled && !hostAppRegistry.configured
        ? "nyra_governed_continue_host_app_registry_unavailable"
        : nyraGovernedContinueEnabled && agentPresenceSignatureVersion !== "v2"
          ? "nyra_governed_continue_agent_presence_v2_required"
        : nyraGovernedContinueEnabled && nyraGovernedContinueSecretReused
          ? "nyra_governed_continue_signing_secret_reused"
          : null;
  // Enabled by the production Blueprint. Keep the code default fail-closed so
  // an existing installation does not silently change tenant routing on update.
  const selfServiceTenantsEnabled = flag(env.MCP_SELF_SERVICE_TENANTS_ENABLED, false);
  const sharedMemoryRoot = String(env.SHARED_WORK_MEMORY_ROOT || new URL("../../../shared-work-memory", import.meta.url).pathname).trim();
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  const nyraProjectReleaseBindings = parseNyraProjectReleaseBindings(
    env.NYRA_PROJECT_RELEASE_BINDINGS_JSON,
  );
  // Atlas repository scope is server-owned. A connected AI can request a
  // project Work, but can never substitute an arbitrary repository or token.
  const nyraAtlasRepositoryBindings = parseNyraAtlasRepositoryBindings(
    env.NYRA_ATLAS_REPOSITORY_BINDINGS_JSON,
    "NYRA_ATLAS_REPOSITORY_BINDINGS_JSON",
  );
  const nyraAtlasGithubTokens = parseNyraAtlasGithubTokens(
    env.NYRA_ATLAS_GITHUB_TOKENS_JSON,
    "NYRA_ATLAS_GITHUB_TOKENS_JSON",
  );
  const ownerManualEffectPolicies = parseOwnerManualEffectPolicies(
    env.OWNER_MANUAL_EFFECT_POLICIES_JSON,
    "OWNER_MANUAL_EFFECT_POLICIES_JSON",
  );
  const genericWorkCoreJoinEnabledFlag = strictFlag(
    env.GENERIC_WORK_CORE_JOIN_ENABLED,
    false,
    "GENERIC_WORK_CORE_JOIN_ENABLED",
  );
  const genericWorkCoreJoinRequiredFlag = strictFlag(
    env.GENERIC_WORK_CORE_JOIN_REQUIRED,
    false,
    "GENERIC_WORK_CORE_JOIN_REQUIRED",
  );
  const genericWorkCoreJoinEnabled = genericWorkCoreJoinEnabledFlag.valid
    ? genericWorkCoreJoinEnabledFlag.value
    : false;
  const genericWorkCoreJoinRequired = genericWorkCoreJoinEnabledFlag.valid &&
    genericWorkCoreJoinRequiredFlag.valid
    ? genericWorkCoreJoinRequiredFlag.value
    : true;
  const genericWorkCoreJoinConfigurationError = !genericWorkCoreJoinEnabledFlag.valid
    ? genericWorkCoreJoinEnabledFlag.error
    : !genericWorkCoreJoinRequiredFlag.valid
      ? genericWorkCoreJoinRequiredFlag.error
      : genericWorkCoreJoinRequired && !genericWorkCoreJoinEnabled
        ? "generic_work_core_join_required_without_enabled"
        : null;
  const genericWorkCoreJoinPublicKey = String(env.GENERIC_WORK_CORE_JOIN_ED25519_PUBLIC_KEY || "").trim();
  const genericWorkCoreJoinKeyId = String(env.GENERIC_WORK_CORE_JOIN_ED25519_KEY_ID || "").trim();
  const policyRegistryLifecycleEnabledFlag = strictFlag(
    env.NYRA_POLICY_REGISTRY_LIFECYCLE_ENABLED,
    false,
    "NYRA_POLICY_REGISTRY_LIFECYCLE_ENABLED",
  );
  const policyRegistryLifecycleRequiredFlag = strictFlag(
    env.NYRA_POLICY_REGISTRY_LIFECYCLE_REQUIRED,
    false,
    "NYRA_POLICY_REGISTRY_LIFECYCLE_REQUIRED",
  );
  const policyRegistryLifecycleEnabled = policyRegistryLifecycleEnabledFlag.valid
    ? policyRegistryLifecycleEnabledFlag.value
    : false;
  const policyRegistryLifecycleRequired = policyRegistryLifecycleEnabledFlag.valid &&
    policyRegistryLifecycleRequiredFlag.valid
    ? policyRegistryLifecycleRequiredFlag.value
    : true;
  let policyRegistryLifecycleCoreOriginValid = false;
  try {
    const parsedCoreOrigin = new URL(universalCoreUrl);
    policyRegistryLifecycleCoreOriginValid = parsedCoreOrigin.protocol === "https:" &&
      !parsedCoreOrigin.username && !parsedCoreOrigin.password &&
      !parsedCoreOrigin.search && !parsedCoreOrigin.hash &&
      ["", "/"].includes(parsedCoreOrigin.pathname) &&
      parsedCoreOrigin.origin === universalCoreUrl;
  } catch {
    policyRegistryLifecycleCoreOriginValid = false;
  }
  const policyRegistryLifecycleConfigurationError = !policyRegistryLifecycleEnabledFlag.valid
    ? policyRegistryLifecycleEnabledFlag.error
    : !policyRegistryLifecycleRequiredFlag.valid
      ? policyRegistryLifecycleRequiredFlag.error
      : policyRegistryLifecycleRequired && !policyRegistryLifecycleEnabled
        ? "nyra_policy_registry_lifecycle_required_without_enabled"
        : policyRegistryLifecycleEnabled && !policyRegistryLifecycleCoreOriginValid
          ? "nyra_policy_registry_lifecycle_core_origin_invalid"
          : null;
  // Collaboration state must never silently share the service's existing
  // DATABASE_URL. It is intentionally opt-in and has a distinct Render secret.
  const collaborationDatabaseUrl = String(env.MCP_COLLABORATION_DATABASE_URL || "").trim();
  const decisionLedgerRequired = flag(env.CORE_DECISION_LEDGER_REQUIRED, env.NODE_ENV === "production");
  const coreBlockRemediationMode = String(env.CORE_BLOCK_REMEDIATION_MODE || "shadow").trim().toLowerCase();
  if (!["disabled", "shadow", "active"].includes(coreBlockRemediationMode)) {
    throw new Error("CORE_BLOCK_REMEDIATION_MODE must be disabled, shadow, or active");
  }
  const aiWorkQualityMode = String(env.AI_WORK_QUALITY_MODE || "observe").trim().toLowerCase();
  if (!["observe", "draft", "sandbox_active", "scoped_active", "privileged"].includes(aiWorkQualityMode)) {
    throw new Error("AI_WORK_QUALITY_MODE must be observe, draft, sandbox_active, scoped_active, or privileged");
  }
  const coreBlockRemediationMaxAttempts = integer(env.CORE_BLOCK_REMEDIATION_MAX_ATTEMPTS, 3, 1, 20);
  const coreBlockRemediationTtlSeconds = integer(env.CORE_BLOCK_REMEDIATION_TTL_SECONDS, 86_400, 1, 7 * 86_400);
  const coreBlockRemediationTransientRetryLimit = integer(env.CORE_BLOCK_REMEDIATION_TRANSIENT_RETRY_LIMIT, 2, 1, 20);
  // Automatic continuity capture is opt-in because it persists a redacted
  // derivative of the first host-supplied request as an immutable Intent
  // Anchor. Existing tenants retain the previous no-capture behaviour.
  const workContinuityAutoCaptureEnabled = flag(env.WORK_CONTINUITY_AUTO_CAPTURE_ENABLED, false);
  const hostNativeAgentProtocolEnabled = flag(env.HOST_NATIVE_AGENT_PROTOCOL_ENABLED, false);
  // When enabled, every functional Nyra/Core tool call must first refresh a
  // server-derived signed presence in the tenant registry. It is intentionally
  // opt-in so existing development installations are not silently tightened.
  const mandatoryAgentPresenceEnabled = flag(env.MANDATORY_AGENT_PRESENCE_ENABLED, false);
  const agentWorkspaceRoot = String(env.AGENT_WORKSPACE_ROOT || "").trim();
  const memoryFabricRoot = String(env.MEMORY_FABRIC_ROOT || agentWorkspaceRoot || "").trim();
  const researchCortexRoot = String(env.RESEARCH_CORTEX_ROOT || memoryFabricRoot || agentWorkspaceRoot || "").trim();
  const godModeEnabled = flag(env.NYRA_GOD_MODE_ENABLED, false);
  const godModeTenantIds = csv(env.NYRA_GOD_MODE_TENANT_IDS || env.NYRA_GOD_MODE_TENANT_ID || "owner-private");
  const godModeSubjects = csv(env.NYRA_GOD_MODE_SUBJECTS);
  const godModeClientIds = csv(env.NYRA_GOD_MODE_CLIENT_IDS);
  const godModeCodexEnabled = flag(env.NYRA_GOD_MODE_CODEX_ENABLED, false);
  const godModeEmergencyStop = flag(env.NYRA_GOD_MODE_EMERGENCY_STOP, false);
  // Owner elevation is only the short bootstrap for a bounded Core
  // delegation. Long-running work continues through signed, expiring action
  // tickets instead of treating an old browser login as fresh confirmation.
  const oauthOwnerConfirmationMaxAgeSeconds = strictInteger(
    env.AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS,
    300,
    60,
    300,
    "AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS",
  );
  const environmentRoutingRequired = flag(env.MCP_ENVIRONMENT_ROUTING_REQUIRED, false);
  const environmentDelegationReceiverEnabled = flag(env.MCP_ENVIRONMENT_DELEGATION_RECEIVER_ENABLED, false);
  const stagingMcpUrl = url(env.MCP_STAGING_MCP_URL, "MCP_STAGING_MCP_URL");
  if ((environmentRoutingRequired || environmentDelegationReceiverEnabled) && Buffer.byteLength(environmentDelegationKey, "utf8") < 32) throw new Error("MCP_ENVIRONMENT_DELEGATION_KEY must contain at least 32 bytes when environment routing is enabled");
  if (environmentRoutingRequired && !stagingMcpUrl) throw new Error("MCP_STAGING_MCP_URL is required when environment routing is enabled");
  if (stagingMcpUrl) {
    const stagingOrigin = new URL(stagingMcpUrl);
    if (!["http:", "https:"].includes(stagingOrigin.protocol) ||
        stagingOrigin.username || stagingOrigin.password || stagingOrigin.search ||
        stagingOrigin.hash || !["", "/"].includes(stagingOrigin.pathname)) {
      throw new Error("MCP_STAGING_MCP_URL must be an exact credential-free origin");
    }
    if (environment === "production" && stagingOrigin.protocol !== "https:") {
      throw new Error("MCP_STAGING_MCP_URL must use HTTPS in production");
    }
  }
  // Missing production prerequisites are reported by the local readiness
  // endpoint. Authentication itself still fails closed, while keeping the
  // process alive lets Render observe an explicit 503 and coded blocker.
  if (auth0Issuer && !auth0Audience) throw new Error("AUTH0_AUDIENCE is required with AUTH0_ISSUER");
  const supportedScopes = csv(env.MCP_SUPPORTED_SCOPES || "core:read,core:govern")
    .filter((scope) => scope !== "offline_access");
  // `offline_access` lets an OAuth client request a refresh token.  It is an
  // OAuth lifecycle scope, not an entitlement to a Core capability, so keep it
  // separate from `supportedScopes` (which is used by the authorizer).
  const oauthScopesSupported = [...new Set([...supportedScopes, "offline_access"])];
  return {
    environment,
    production: environment === "production",
    port: Number(env.PORT || 8790),
    publicUrl,
    resource: `${publicUrl}/mcp`,
    environmentRoutingRequired,
    environmentDelegationReceiverEnabled,
    environmentDelegationKey,
    stagingMcpUrl,
    auth0Issuer,
    auth0Audience,
    jwksUri: auth0Issuer ? `${auth0Issuer}/.well-known/jwks.json` : "",
    codexKeys,
    legacyCodexHostPrincipalEnabled,
    legacyCodexHostPrincipalConfigurationValid: legacyCodexHostPrincipalEnabledFlag.valid,
    legacyCodexHostPrincipalConfigurationError: legacyCodexHostPrincipalEnabledFlag.error,
    codexScopes: csv(env.CODEX_BEARER_SCOPES || "core:read,core:govern"),
    supportedScopes,
    oauthScopesSupported,
    universalCoreUrl,
    githubStandingReleaseWorkerUrl,
    standingReleaseAutoCoordinatorEnabled,
    standingReleaseAutoCoordinatorConfigurationValid:
      standingReleaseAutoCoordinatorConfigurationError === null,
    standingReleaseAutoCoordinatorConfigurationError,
    universalCoreKey,
    universalCoreKeys,
    tenantGatewayKey,
    suiteControlPlaneUrl,
    suiteControlPlaneKeys: suiteControlPlaneBindings.keys,
    suiteControlPlaneTenantMap: suiteControlPlaneBindings.tenantMap,
    suiteControlPlaneTimeoutMs: integer(env.SUITE_CONTROL_PLANE_TIMEOUT_MS, 8_000, 100, 30_000),
    suiteControlPlaneCacheTtlMs: integer(env.SUITE_CONTROL_PLANE_CACHE_TTL_MS, 5_000, 0, 60_000),
    agentSignatureSecret,
    agentSignatureSecretReused,
    agentPresenceSignatureVersion,
    dttAgentIdentitySigningSecret,
    nyraDeepV2McpRequestSigningSecret,
    ownerContextSigningSecret,
    tenantContextSigningSecret,
    nyraGovernedContinueEnabled,
    nyraGovernedContinueSigningSecret,
    nyraGovernedContinueConfigurationValid:
      nyraGovernedContinueConfigurationError === null,
    nyraGovernedContinueConfigurationError,
    runtimeBuildCommit,
    defaultTenantId,
    tenantClaim,
    oauthOwnerTenantBindings,
    oauthTenantMemberships,
    hostAppRegistry,
    oauthOwnerConfirmationMaxAgeSeconds,
    selfServiceTenantsEnabled,
    tenantOwnerRoleClaim: String(env.MCP_TENANT_OWNER_ROLE_CLAIM || "https://skinharmony.it/role").trim(),
    tenantOwnerRoles: csv(env.MCP_TENANT_OWNER_ROLES || "tenant_owner,tenant_admin,owner_root"),
    sharedMemoryRoot,
    databaseUrl,
    nyraProjectReleaseBindings,
    nyraAtlasRepositoryBindings,
    nyraAtlasGithubTokens,
    ownerManualEffectPolicies,
    genericWorkCoreJoinEnabled,
    genericWorkCoreJoinRequired,
    genericWorkCoreJoinConfigurationValid: genericWorkCoreJoinConfigurationError === null,
    genericWorkCoreJoinConfigurationError,
    genericWorkCoreJoinPublicKey,
    genericWorkCoreJoinKeyId,
    policyRegistryLifecycleEnabled,
    policyRegistryLifecycleRequired,
    policyRegistryLifecycleConfigurationValid:
      policyRegistryLifecycleConfigurationError === null,
    policyRegistryLifecycleConfigurationError,
    policyRegistryLifecycleCoreOriginValid,
    collaborationDatabaseUrl,
    decisionLedgerRequired,
    coreBlockRemediationMode,
    aiWorkQualityMode,
    coreBlockRemediationMaxAttempts,
    coreBlockRemediationTtlSeconds,
    coreBlockRemediationTransientRetryLimit,
    workContinuityAutoCaptureEnabled,
    nyraDialogueEnabled,
    hostNativeAgentProtocolEnabled,
    mandatoryAgentPresenceEnabled,
    databaseSsl: flag(env.DATABASE_SSL, env.NODE_ENV === "production"),
    collaborationDatabaseSsl: flag(env.MCP_COLLABORATION_DATABASE_SSL, env.NODE_ENV === "production"),
    databasePoolMax: integer(env.DATABASE_POOL_MAX, 5, 1, 20),
    cloudMemoryMaxDocumentBytes: integer(env.CLOUD_MEMORY_MAX_DOCUMENT_BYTES, 250_000, 1_000, 900_000),
    agentWorkspaceRoot,
    memoryFabricRoot,
    researchCortexRoot,
    godModeEnabled,
    godModeTenantIds,
    godModeSubjects,
    godModeClientIds,
    godModeCodexEnabled,
    godModeEmergencyStop,
    memoryRetentionDays: integer(env.MEMORY_RETENTION_DAYS, 365, 1, 3_650),
    personalMemoryRetentionDays: integer(env.MEMORY_PERSONAL_RETENTION_DAYS, 90, 1, 365),
    researchRetentionDays: integer(env.RESEARCH_RETENTION_DAYS, 365, 1, 3_650),
  };
}
