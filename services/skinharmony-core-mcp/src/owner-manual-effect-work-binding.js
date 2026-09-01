import crypto from "node:crypto";

import {
  genericWorkCoreJoinDigest,
} from "../../universal-core-service/src/genericWorkCoreJoin.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const RESOURCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,254}$/;
const REPAIR_ACTION_ID = /^nra_[A-Za-z0-9][A-Za-z0-9._:-]{2,123}$/;
const REPAIR_RECEIPT_ID = /^nrr_[A-Za-z0-9][A-Za-z0-9._:-]{2,123}$/;
const OWNER_MANUAL_EFFECT_WORK_BINDING_SCHEMA_VERSION =
  "owner_manual_effect_work_binding_v1";
const OWNER_MANUAL_EFFECT_BREAK_GLASS_EFFECTS = new Set([
  "nyra_core.self_repair.commit",
  "nyra_core.self_repair.push_branch",
  "nyra_core.self_repair.draft_pr",
]);

function fail(code) {
  throw new Error(code);
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, fields, code) {
  if (!plainRecord(value) || Object.keys(value).sort().join("\u0000") !==
      [...fields].sort().join("\u0000")) {
    fail(code);
  }
}

function text(value, code, maximum = 8_000) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(code);
  }
  return value;
}

function lowerHex(value, expression, code) {
  const normalized = text(value, code, 128);
  if (normalized !== normalized.toLowerCase() || !expression.test(normalized)) fail(code);
  return normalized;
}

function stableStrings(value, code, maximum = 64) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) fail(code);
  const values = value.map((entry) => text(entry, code, 160));
  if (values.some((entry) => !/^[A-Za-z0-9][A-Za-z0-9 ._:/@+-]{0,159}$/.test(entry))) {
    fail(code);
  }
  const unique = [...new Set(values)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== values.length || unique.some((entry, index) => entry !== values[index])) {
    fail(code);
  }
  return Object.freeze(unique);
}

/**
 * Canonical, relative POSIX path only.  A manual break-glass selector must
 * not be delegated to any downstream path normalizer: it is rejected before
 * it can be interpreted as a different path by GitHub, a shell, or a host.
 */
export function canonicalOwnerManualEffectPosixPath(value, code = "owner_manual_effect_path_invalid") {
  const path = text(value, code, 240);
  if (path.startsWith("/") || path.endsWith("/") || path.includes("\\") ||
      path.includes("//") || path.includes("%")) {
    fail(code);
  }
  const segments = path.split("/");
  if (!segments.length || segments.some((segment) =>
    !segment || segment === "." || segment === ".." ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(segment))) {
    fail(code);
  }
  return path;
}

/** Like a POSIX path, but used for a git ref (where slash is allowed). */
export function canonicalOwnerManualEffectGitRef(value, code = "owner_manual_effect_branch_invalid") {
  const branch = canonicalOwnerManualEffectPosixPath(value, code);
  if (branch.includes("@{") || branch.includes("..") || /[~^:?*\[]/.test(branch)) {
    fail(code);
  }
  return branch;
}

function canonicalRepository(value, code) {
  const repository = text(value, code, 255);
  if (!REPOSITORY.test(repository)) fail(code);
  return repository;
}

function canonicalIdentifier(value, code) {
  const identifier = text(value, code, 128);
  if (!IDENTIFIER.test(identifier)) fail(code);
  return identifier;
}

function canonicalResource(value, code) {
  const resource = text(value, code, 255);
  if (!RESOURCE.test(resource)) fail(code);
  return resource;
}

function pathIsWithinPrefix(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * This validator is deliberately shared by deployment configuration and the
 * resolver's caller-supplied assertion.  The returned reference is the
 * server-owned descriptor; caller input is only compared to it, never used to
 * construct an authority binding or forwarded to Universal Core.
 */
export function normalizeOwnerManualEffectReference({
  adapter_id,
  effect_type,
  resource_id,
  effect_reference,
  repository,
  mode,
  break_glass = null,
  code = "owner_manual_effect_reference_invalid",
} = {}) {
  const adapterId = canonicalIdentifier(adapter_id, code);
  const effectType = canonicalIdentifier(effect_type, code);
  const resourceId = canonicalResource(resource_id, code);
  const expectedRepository = canonicalRepository(repository, code);

  if (adapterId === "github" && effectType === "github.merge") {
    exactKeys(effect_reference, [
      "base_branch",
      "base_commit",
      "head_commit",
      "merge_commit",
      "pull_request",
      "repository",
      "required_checks",
      "required_checks_policy_digest",
    ], code);
    const reference = {
      repository: canonicalRepository(effect_reference.repository, code),
      pull_request: effect_reference.pull_request,
      base_branch: canonicalOwnerManualEffectGitRef(effect_reference.base_branch, code),
      base_commit: lowerHex(effect_reference.base_commit, SHA1, code),
      head_commit: lowerHex(effect_reference.head_commit, SHA1, code),
      merge_commit: lowerHex(effect_reference.merge_commit, SHA1, code),
      required_checks: stableStrings(effect_reference.required_checks, code),
      required_checks_policy_digest: lowerHex(
        effect_reference.required_checks_policy_digest,
        SHA256,
        code,
      ),
    };
    if (!Number.isSafeInteger(reference.pull_request) || reference.pull_request < 1 ||
        reference.repository !== expectedRepository ||
        resourceId !== `github:${expectedRepository}` || mode !== "OWNER_MANUAL") {
      fail(code);
    }
    return Object.freeze(reference);
  }

  if (adapterId === "render" && effectType === "render.deploy") {
    exactKeys(effect_reference, [
      "environment",
      "health_contract_digest",
      "repository",
      "service_id",
      "target_commit",
    ], code);
    const reference = {
      repository: canonicalRepository(effect_reference.repository, code),
      service_id: canonicalIdentifier(effect_reference.service_id, code),
      environment: canonicalIdentifier(effect_reference.environment, code),
      target_commit: lowerHex(effect_reference.target_commit, SHA1, code),
      health_contract_digest: lowerHex(effect_reference.health_contract_digest, SHA256, code),
    };
    if (reference.repository !== expectedRepository ||
        resourceId !== `render:${reference.service_id}:${reference.environment}` ||
        mode !== "OWNER_MANUAL") {
      fail(code);
    }
    return Object.freeze(reference);
  }

  if (adapterId === "nyra_core" && OWNER_MANUAL_EFFECT_BREAK_GLASS_EFFECTS.has(effectType)) {
    // A path is a location, not an effect. Bind Break-Glass to an immutable
    // commit, a server-owned Nyra/Core action, and its pre-existing signed
    // receipt. The receipt signs the action digest, never this full descriptor
    // digest, so there is no self-referential hash construction.
    exactKeys(effect_reference, [
      "branch",
      "commit",
      "path",
      "repair_action_digest",
      "repair_action_id",
      "repair_receipt_digest",
      "repair_receipt_id",
      "repository",
    ], code);
    const reference = {
      repository: canonicalRepository(effect_reference.repository, code),
      branch: canonicalOwnerManualEffectGitRef(effect_reference.branch, code),
      path: canonicalOwnerManualEffectPosixPath(effect_reference.path, code),
      commit: lowerHex(effect_reference.commit, SHA1, code),
      repair_action_id: text(effect_reference.repair_action_id, code, 128),
      repair_action_digest: lowerHex(effect_reference.repair_action_digest, SHA256, code),
      repair_receipt_id: text(effect_reference.repair_receipt_id, code, 128),
      repair_receipt_digest: lowerHex(effect_reference.repair_receipt_digest, SHA256, code),
    };
    const allowedPrefixes = Array.isArray(break_glass?.allowed_path_prefixes)
      ? break_glass.allowed_path_prefixes : [];
    if (mode !== "OWNER_BREAK_GLASS" || reference.repository !== expectedRepository ||
        resourceId !== break_glass?.resource_id || reference.branch !== break_glass?.branch ||
        !REPAIR_ACTION_ID.test(reference.repair_action_id) ||
        !REPAIR_RECEIPT_ID.test(reference.repair_receipt_id) ||
        !pathIsWithinPrefix(reference.path, allowedPrefixes)) {
      fail(code);
    }
    return Object.freeze(reference);
  }

  fail(code);
}

function workStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (status === "ACTIVE") return "active";
  if (status === "HANDOFF") return "release_ready";
  if (status === "VERIFIED") return "verified";
  fail("owner_manual_effect_work_binding_status_invalid");
}

function bindingDigest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableCanonical(value)))
    .digest("hex");
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableCanonical(value[key])]));
  }
  return value;
}

function tuple(binding) {
  return Object.freeze({
    adapter_id: binding.adapter_id,
    effect_type: binding.effect_type,
    resource_id: binding.resource_id,
    effect_reference_digest: binding.effect_reference_digest,
  });
}

function tupleKey(value) {
  return genericWorkCoreJoinDigest(value);
}

function canonicalRequestScope(value) {
  exactKeys(value, [
    "adapter_ids",
    "effect_reference_digests",
    "effect_types",
    "resource_ids",
  ], "owner_manual_effect_work_binding_scope_invalid");
  const identifiers = (entries, code, pattern) => {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 32) fail(code);
    const normalized = entries.map((entry) => text(entry, code, 255));
    if (normalized.some((entry) => !pattern.test(entry))) fail(code);
    const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
    if (unique.length !== normalized.length || unique.some((entry, index) => entry !== normalized[index])) {
      fail(code);
    }
    return unique;
  };
  const digests = identifiers(value.effect_reference_digests,
    "owner_manual_effect_work_binding_scope_invalid", SHA256);
  if (digests.some((entry) => entry !== entry.toLowerCase())) {
    fail("owner_manual_effect_work_binding_scope_invalid");
  }
  return {
    adapter_ids: identifiers(value.adapter_ids, "owner_manual_effect_work_binding_scope_invalid", IDENTIFIER),
    effect_types: identifiers(value.effect_types, "owner_manual_effect_work_binding_scope_invalid", IDENTIFIER),
    resource_ids: identifiers(value.resource_ids, "owner_manual_effect_work_binding_scope_invalid", RESOURCE),
    effect_reference_digests: digests,
  };
}

function canonicalEffectCeiling(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    fail("owner_manual_effect_work_binding_scope_invalid");
  }
  const entries = value.map((entry) => canonicalIdentifier(entry, "owner_manual_effect_work_binding_scope_invalid"));
  const unique = [...new Set(entries)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== entries.length || unique.some((entry, index) => entry !== entries[index])) {
    fail("owner_manual_effect_work_binding_scope_invalid");
  }
  return unique;
}

function requestedTuplesFromScope(scope) {
  const values = [];
  for (const adapter_id of scope.adapter_ids) for (const effect_type of scope.effect_types) {
    for (const resource_id of scope.resource_ids) for (const effect_reference_digest of scope.effect_reference_digests) {
      values.push({ adapter_id, effect_type, resource_id, effect_reference_digest });
    }
  }
  if (!values.length || values.length > 32) fail("owner_manual_effect_work_binding_scope_invalid");
  return values.sort((left, right) => tupleKey(left).localeCompare(tupleKey(right)));
}

function selector(value, { includeDigest = false } = {}) {
  const fields = includeDigest
    ? ["adapter_id", "effect_reference_digest", "effect_type", "resource_id"]
    : ["adapter_id", "effect_type", "resource_id"];
  exactKeys(value, fields, "owner_manual_effect_work_binding_selector_invalid");
  const normalized = {
    adapter_id: canonicalIdentifier(value.adapter_id, "owner_manual_effect_work_binding_selector_invalid"),
    effect_type: canonicalIdentifier(value.effect_type, "owner_manual_effect_work_binding_selector_invalid"),
    resource_id: canonicalResource(value.resource_id, "owner_manual_effect_work_binding_selector_invalid"),
  };
  if (includeDigest) {
    normalized.effect_reference_digest = lowerHex(
      value.effect_reference_digest,
      SHA256,
      "owner_manual_effect_work_binding_selector_invalid",
    );
  }
  return normalized;
}

function policyForWork(config, work, identity) {
  const policy = (config?.ownerManualEffectPolicies || []).find((candidate) =>
    candidate?.tenant_id === identity?.tenantId && candidate?.tenant_id === work?.tenant_id &&
    candidate?.project_id === work?.project_id,
  );
  if (!policy) fail("owner_manual_effect_work_binding_policy_unavailable");
  const workRepository = canonicalRepository(work?.architecture?.repository,
    "owner_manual_effect_work_binding_repository_invalid");
  if (workRepository !== policy.repository) fail("owner_manual_effect_work_binding_repository_mismatch");
  return policy;
}

function configuredBindings(policy, { workId, intentDigest, mode }) {
  const entries = Array.isArray(policy.effect_bindings) ? policy.effect_bindings : [];
  const values = entries.filter((entry) => entry.work_id === workId &&
    entry.intent_anchor_digest === intentDigest && entry.mode === mode);
  if (!values.length) fail("owner_manual_effect_work_binding_effect_unbound");
  return values;
}

function matchingBinding(entries, requested, { includeDigest = true } = {}) {
  const matches = entries.filter((entry) =>
    entry.adapter_id === requested.adapter_id &&
    entry.effect_type === requested.effect_type &&
    entry.resource_id === requested.resource_id &&
    (!includeDigest || entry.effect_reference_digest === requested.effect_reference_digest));
  if (matches.length !== 1) fail("owner_manual_effect_work_binding_effect_unbound");
  return matches[0];
}

function assertPolicyAllowsEntry(policy, entry) {
  if (entry.mode === "OWNER_BREAK_GLASS") {
    if (!policy.break_glass || entry.adapter_id !== "nyra_core" ||
        !OWNER_MANUAL_EFFECT_BREAK_GLASS_EFFECTS.has(entry.effect_type) ||
        entry.resource_id !== policy.break_glass.resource_id) {
      fail("owner_manual_effect_break_glass_selector_denied");
    }
    normalizeOwnerManualEffectReference({
      adapter_id: entry.adapter_id,
      effect_type: entry.effect_type,
      resource_id: entry.resource_id,
      effect_reference: entry.effect_reference,
      repository: policy.repository,
      mode: entry.mode,
      break_glass: policy.break_glass,
      code: "owner_manual_effect_break_glass_reference_denied",
    });
    return;
  }
  if (!policy.effects.some((effect) => effect.adapter_id === entry.adapter_id &&
      effect.effect_type === entry.effect_type && effect.resource_id === entry.resource_id)) {
    fail("owner_manual_effect_work_binding_selector_denied");
  }
  normalizeOwnerManualEffectReference({
    adapter_id: entry.adapter_id,
    effect_type: entry.effect_type,
    resource_id: entry.resource_id,
    effect_reference: entry.effect_reference,
    repository: policy.repository,
    mode: entry.mode,
    break_glass: policy.break_glass,
    code: "owner_manual_effect_work_binding_reference_denied",
  });
}

function canonicalTimestamp(value, code) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail(code);
  return timestamp;
}

function normalizedWorkFromRead(value) {
  const work = value?.work ?? value;
  if (!plainRecord(work)) fail("owner_manual_effect_work_binding_work_invalid");
  return work;
}

/**
 * Resolve a manual-effect binding only from canonical Work/intent data plus
 * immutable deployment configuration.  `effect_reference` in an MCP request
 * is an assertion to compare against the server-owned descriptor, never an
 * authority input.
 */
export function createOwnerManualEffectWorkBindingResolver({
  config,
  readWork,
  resolveStandingReleaseIntentBinding,
  requireTenantWorkCapability,
  withTenantWorkAcl = (identity) => identity,
  now = () => Date.now(),
} = {}) {
  async function resolveOwnerManualEffectWorkBinding(identity, request = {}) {
    if (typeof readWork !== "function" || typeof resolveStandingReleaseIntentBinding !== "function" ||
        typeof requireTenantWorkCapability !== "function") {
      fail("owner_manual_effect_work_binding_unavailable");
    }
    requireTenantWorkCapability(identity, "read");
    const workId = lowerHex(text(request.work_id, "owner_manual_effect_work_binding_request_invalid", 36),
      UUID, "owner_manual_effect_work_binding_request_invalid");
    const intentDigest = lowerHex(request.intent_anchor_digest, SHA256,
      "owner_manual_effect_work_binding_request_invalid");
    const mode = request.mode;
    if (!["OWNER_MANUAL", "OWNER_BREAK_GLASS"].includes(mode) ||
        !["issue", "reconcile", "closure"].includes(request.phase)) {
      fail("owner_manual_effect_work_binding_request_invalid");
    }

    const intent = await resolveStandingReleaseIntentBinding(identity, workId);
    if (String(intent?.intent_anchor_digest || "").toLowerCase() !== intentDigest) {
      fail("owner_manual_effect_work_binding_intent_mismatch");
    }

    let read;
    try {
      read = await readWork(withTenantWorkAcl(identity), { work_id: workId });
    } catch (error) {
      const denied = new Error("owner_manual_effect_work_binding_acl_denied");
      denied.code = "owner_manual_effect_work_binding_acl_denied";
      throw denied;
    }
    const work = normalizedWorkFromRead(read);
    if (String(work.tenant_id || "") !== identity?.tenantId ||
        String(work.work_id || "").toLowerCase() !== workId ||
        String(work.intent_digest || "").toLowerCase() !== intentDigest) {
      fail("owner_manual_effect_work_binding_intent_mismatch");
    }
    const policy = policyForWork(config, work, identity);
    const entries = configuredBindings(policy, { workId, intentDigest, mode });

    let selected;
    let resolvedEffectReference = null;
    if (request.phase === "issue") {
      const scope = canonicalRequestScope(request.scope);
      const ceiling = canonicalEffectCeiling(request.effect_ceiling);
      selected = requestedTuplesFromScope(scope).map((requested) =>
        matchingBinding(entries, requested));
      if (selected.some((entry) => !ceiling.includes(entry.effect_type))) {
        fail("owner_manual_effect_work_binding_scope_denied");
      }
      // Break-Glass is recovery for one already-completed, immutable repair
      // action. A broad cross-product or a multi-effect ceiling would turn it
      // into a reusable execution grant instead of evidence reconciliation.
      if (mode === "OWNER_BREAK_GLASS" && (
        selected.length !== 1 || ceiling.length !== 1 ||
        ceiling[0] !== selected[0]?.effect_type
      )) {
        fail("owner_manual_effect_break_glass_scope_denied");
      }
    } else {
      const selectedSelector = selector(request.selector, {
        includeDigest: request.phase === "closure",
      });
      if (request.phase === "reconcile") {
        selected = [matchingBinding(entries, selectedSelector, { includeDigest: false })];
        // Validate the caller value only as an assertion.  In particular, this
        // rejects alternate JSON fields, a different PR/commit, and a path
        // with traversal syntax before the server-owned descriptor is used.
        const asserted = normalizeOwnerManualEffectReference({
          adapter_id: selected[0].adapter_id,
          effect_type: selected[0].effect_type,
          resource_id: selected[0].resource_id,
          effect_reference: request.effect_reference,
          repository: policy.repository,
          mode,
          break_glass: policy.break_glass,
          code: mode === "OWNER_BREAK_GLASS"
            ? "owner_manual_effect_break_glass_reference_denied"
            : "owner_manual_effect_work_binding_reference_denied",
        });
        if (genericWorkCoreJoinDigest(asserted) !== selected[0].effect_reference_digest) {
          fail("owner_manual_effect_work_binding_effect_unbound");
        }
        resolvedEffectReference = structuredClone(selected[0].effect_reference);
      } else {
        selected = [matchingBinding(entries, selectedSelector, { includeDigest: true })];
      }
    }
    const unique = new Map(selected.map((entry) => [tupleKey(tuple(entry)), entry]));
    if (unique.size !== selected.length || !unique.size || unique.size > 32) {
      fail("owner_manual_effect_work_binding_scope_invalid");
    }
    // Core validates the signed tuple list in generic-digest order. Keep the
    // resolver on that canonical order rather than the human-readable tuple
    // order, otherwise a valid multi-effect OWNER_MANUAL scope can be
    // rejected at the MCP/Core boundary solely because the two sort keys
    // differ.
    const ordered = [...unique.values()].sort((left, right) =>
      genericWorkCoreJoinDigest(tuple(left)).localeCompare(
        genericWorkCoreJoinDigest(tuple(right)),
      ));
    ordered.forEach((entry) => assertPolicyAllowsEntry(policy, entry));

    const updatedAt = canonicalTimestamp(work.updated_at,
      "owner_manual_effect_work_binding_updated_at_invalid");
    const current = Number(typeof now === "function" ? now() : now);
    if (!Number.isFinite(current)) fail("owner_manual_effect_work_binding_clock_invalid");
    const unsigned = {
      schema_version: OWNER_MANUAL_EFFECT_WORK_BINDING_SCHEMA_VERSION,
      source: "mcp_work_continuity_v2",
      tenant_id: identity.tenantId,
      work_id: workId,
      intent_anchor_digest: intentDigest,
      mode,
      work_status: workStatus(work.status),
      current_version: Math.floor(updatedAt),
      work_updated_at: new Date(updatedAt).toISOString(),
      repository: policy.repository,
      provider_execution: false,
      allowed_effect_tuples: ordered.map(tuple),
    };
    const binding = Object.freeze({
      ...unsigned,
      trusted: true,
      verified_at: new Date(current).toISOString(),
      binding_digest: bindingDigest(unsigned),
    });
    return Object.freeze({
      work_binding: binding,
      effect_reference: resolvedEffectReference === null
        ? null
        : Object.freeze(resolvedEffectReference),
    });
  }
  Object.defineProperty(resolveOwnerManualEffectWorkBinding, "trusted", { value: true });
  return resolveOwnerManualEffectWorkBinding;
}
