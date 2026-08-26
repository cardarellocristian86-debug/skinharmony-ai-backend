import {
  CausalContinuityError,
  causalDigest,
  requireDigest,
  requireText,
  requireUuid,
  sortedUnique,
} from "./causalContinuityCanonical.js";

export const RELEASE_TUPLE_SCHEMA_VERSION = "causal_release_tuple_resolution_v1";
export const RELEASE_TUPLE_LOOKUP_VERSION = "causal_release_tuple_lookup_v1";
export const RELEASE_TUPLE_MAX_AGE_MS = 15 * 60 * 1_000;

const SHA = /^[a-f0-9]{40}$/;
const HTTPS_ORIGIN = /^https:\/\/[^/?#]+$/;
const trustedObservers = new WeakSet();

function fail(code, message = code, details) {
  throw new CausalContinuityError(code, message, details);
}

function object(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function exactKeys(value, allowed, code) {
  const keys = Object.keys(object(value, code));
  if (keys.some((key) => !allowed.has(key))) fail(code, `${code}: ${keys.filter((key) => !allowed.has(key)).join(",")}`);
}

function sha(value, name) {
  const normalized = requireText(value, name, 40).toLowerCase();
  if (!SHA.test(normalized)) fail(`${name.toUpperCase()}_INVALID`);
  return normalized;
}

function timestamp(value, name) {
  const parsed = new Date(requireText(value, name, 64));
  if (!Number.isFinite(parsed.getTime())) fail(`${name.toUpperCase()}_INVALID`);
  return parsed.toISOString();
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`${name.toUpperCase()}_INVALID`);
  return parsed;
}

function httpsOrigin(value) {
  const normalized = requireText(value, "service_origin", 500).toLowerCase();
  let parsed;
  try { parsed = new URL(normalized); } catch { fail("SERVICE_ORIGIN_INVALID"); }
  if (!HTTPS_ORIGIN.test(normalized) || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    fail("SERVICE_ORIGIN_INVALID");
  }
  return normalized;
}

function normalizeService(service, targetCommit) {
  exactKeys(service, new Set([
    "service_id", "environment", "origin", "previous_commit", "target_commit",
    "target_resolution", "health_contract_digest", "rollback_health_contract_digest",
  ]), "RELEASE_SERVICE_INVALID");
  const target = sha(service.target_commit, "target_commit");
  if (target !== targetCommit) fail("RELEASE_TARGET_MISMATCH");
  const targetResolution = requireText(service.target_resolution, "target_resolution", 120);
  if (!new Set(["exact_commit", "post_merge_readback"]).has(targetResolution)) fail("TARGET_RESOLUTION_INVALID");
  return {
    service_id: requireText(service.service_id, "service_id", 160),
    environment: requireText(service.environment, "environment", 80),
    origin: httpsOrigin(service.origin),
    previous_commit: sha(service.previous_commit, "previous_commit"),
    target_commit: target,
    target_resolution: targetResolution,
    health_contract_digest: requireDigest(service.health_contract_digest, "health_contract_digest"),
    rollback_health_contract_digest: requireDigest(
      service.rollback_health_contract_digest,
      "rollback_health_contract_digest",
    ),
  };
}

function normalizeObservation(observation, expectedKind, binding) {
  exactKeys(observation, new Set([
    "kind", "source", "observer", "independence", "observed_at", "fresh_until",
    "evidence_digest", "status", "tenant_id", "project_id",
  ]), "RELEASE_OBSERVATION_INVALID");
  if (observation.kind !== expectedKind || observation.status !== "VERIFIED" ||
      observation.independence !== "INDEPENDENT_SYSTEM") fail("RELEASE_OBSERVATION_UNVERIFIED");
  if (observation.tenant_id !== binding.tenant_id || observation.project_id !== binding.project_id) {
    fail("RELEASE_OBSERVATION_BINDING_MISMATCH");
  }
  return {
    kind: expectedKind,
    source: requireText(observation.source, "observation_source", 240),
    observer: requireText(observation.observer, "observation_observer", 240),
    independence: "INDEPENDENT_SYSTEM",
    observed_at: timestamp(observation.observed_at, "observed_at"),
    fresh_until: timestamp(observation.fresh_until, "fresh_until"),
    evidence_digest: requireDigest(observation.evidence_digest, "evidence_digest"),
    status: "VERIFIED",
    tenant_id: binding.tenant_id,
    project_id: binding.project_id,
  };
}

export function normalizeReleaseTupleLookup(input = {}) {
  exactKeys(input, new Set([
    "schema_version", "tenant_id", "project_id", "project_state_digest", "genesis_intent_id",
    "intent_revision_id", "work_id", "change_id", "pull_request",
  ]), "RELEASE_LOOKUP_INVALID");
  if (input.schema_version !== RELEASE_TUPLE_LOOKUP_VERSION) fail("RELEASE_LOOKUP_VERSION_INVALID");
  return Object.freeze({
    schema_version: RELEASE_TUPLE_LOOKUP_VERSION,
    tenant_id: requireText(input.tenant_id, "tenant_id", 120),
    project_id: requireUuid(input.project_id, "project_id"),
    project_state_digest: requireDigest(input.project_state_digest, "project_state_digest"),
    genesis_intent_id: requireUuid(input.genesis_intent_id, "genesis_intent_id"),
    intent_revision_id: requireUuid(input.intent_revision_id, "intent_revision_id"),
    work_id: requireUuid(input.work_id, "work_id"),
    change_id: requireUuid(input.change_id, "change_id"),
    pull_request: positiveInteger(input.pull_request, "pull_request"),
  });
}

function normalizeObservedTuple(raw, lookup, nowMs, maxAgeMs) {
  exactKeys(raw, new Set([
    "phase", "repository", "base_branch", "delivery_branch", "pull_request", "base_commit", "head_commit",
    "merge_commit", "tree_sha", "diff_digest", "changed_files", "delivery_method", "services",
    "rollback", "observations", "observed_at", "expires_at",
  ]), "RELEASE_TUPLE_INVALID");
  const phase = requireText(raw.phase, "release_phase", 40).toUpperCase();
  if (!new Set(["PRE_ACTION", "POST_ACTION"]).has(phase)) fail("RELEASE_PHASE_INVALID");
  if (positiveInteger(raw.pull_request, "pull_request") !== lookup.pull_request) fail("RELEASE_LOOKUP_MISMATCH");
  const headCommit = sha(raw.head_commit, "head_commit");
  const baseCommit = sha(raw.base_commit, "base_commit");
  const mergeCommit = raw.merge_commit == null ? null : sha(raw.merge_commit, "merge_commit");
  if (phase === "POST_ACTION" && !mergeCommit) fail("RELEASE_PARTIAL");
  if (phase === "PRE_ACTION" && mergeCommit) fail("RELEASE_PHASE_INVALID");
  const targetCommit = phase === "POST_ACTION" ? mergeCommit : headCommit;
  const services = Array.isArray(raw.services)
    ? raw.services.map((service) => normalizeService(service, targetCommit))
      .sort((left, right) => `${left.environment}\0${left.service_id}`.localeCompare(`${right.environment}\0${right.service_id}`))
    : fail("RELEASE_SERVICES_REQUIRED");
  if (services.length < 1 || new Set(services.map((service) => `${service.environment}\0${service.service_id}`)).size !== services.length) {
    fail("RELEASE_SERVICES_INVALID");
  }
  const rollback = object(raw.rollback, "RELEASE_ROLLBACK_INVALID");
  exactKeys(rollback, new Set(["mode", "target_commit", "health_contract_digest", "ready", "receipt_digest"]), "RELEASE_ROLLBACK_INVALID");
  if (rollback.ready !== true) fail("RELEASE_ROLLBACK_NOT_READY");
  const rollbackTarget = sha(rollback.target_commit, "rollback_target_commit");
  if (services.some((service) => service.previous_commit !== rollbackTarget)) fail("RELEASE_ROLLBACK_MISMATCH");
  const observationsRaw = object(raw.observations, "RELEASE_OBSERVATIONS_REQUIRED");
  exactKeys(observationsRaw, new Set(["github", "project_scope", "render", "receipt"]), "RELEASE_OBSERVATIONS_INVALID");
  const binding = { tenant_id: lookup.tenant_id, project_id: lookup.project_id };
  const observations = {
    github: normalizeObservation(observationsRaw.github, "GITHUB", binding),
    project_scope: normalizeObservation(observationsRaw.project_scope, "PROJECT_SCOPE", binding),
    render: normalizeObservation(observationsRaw.render, "RENDER", binding),
    receipt: normalizeObservation(observationsRaw.receipt, "RECEIPT", binding),
  };
  const observedAt = timestamp(raw.observed_at, "observed_at");
  const expiresAt = timestamp(raw.expires_at, "expires_at");
  const observedMs = Date.parse(observedAt);
  const expiresMs = Date.parse(expiresAt);
  if (observedMs > nowMs || nowMs - observedMs > maxAgeMs || expiresMs <= nowMs || expiresMs - observedMs > maxAgeMs) {
    fail("RELEASE_OBSERVATION_STALE");
  }
  for (const observation of Object.values(observations)) {
    if (Date.parse(observation.observed_at) > observedMs || Date.parse(observation.fresh_until) < nowMs) {
      fail("RELEASE_OBSERVATION_STALE");
    }
  }
  const changedFiles = sortedUnique(raw.changed_files, "changed_files", { maxItems: 5_000, maxLength: 1_000 });
  if (changedFiles.length < 1) fail("RELEASE_CHANGED_FILES_REQUIRED");
  const deliveryMethod = requireText(raw.delivery_method, "delivery_method", 120);
  if (!new Set(["github_branch_push_auto_deploy", "github_protected_push_auto_deploy", "manual_render_deploy"]).has(deliveryMethod)) {
    fail("DELIVERY_METHOD_INVALID");
  }
  const rollbackMode = requireText(rollback.mode, "rollback_mode", 80);
  if (!new Set(["forward_revert", "redeploy_previous_commit"]).has(rollbackMode)) fail("ROLLBACK_MODE_INVALID");
  return {
    schema_version: RELEASE_TUPLE_SCHEMA_VERSION,
    phase,
    ...binding,
    project_state_digest: lookup.project_state_digest,
    genesis_intent_id: lookup.genesis_intent_id,
    intent_revision_id: lookup.intent_revision_id,
    work_id: lookup.work_id,
    change_id: lookup.change_id,
    repository: requireText(raw.repository, "repository", 300),
    base_branch: requireText(raw.base_branch, "base_branch", 240),
    delivery_branch: requireText(raw.delivery_branch, "delivery_branch", 240),
    pull_request: lookup.pull_request,
    base_commit: baseCommit,
    head_commit: headCommit,
    merge_commit: mergeCommit,
    target_commit: targetCommit,
    tree_sha: sha(raw.tree_sha, "tree_sha"),
    diff_digest: requireDigest(raw.diff_digest, "diff_digest"),
    changed_files: changedFiles,
    delivery_method: deliveryMethod,
    services,
    rollback: {
      mode: rollbackMode,
      target_commit: rollbackTarget,
      health_contract_digest: requireDigest(rollback.health_contract_digest, "rollback_health_contract_digest"),
      ready: true,
      receipt_digest: requireDigest(rollback.receipt_digest, "rollback_receipt_digest"),
    },
    observations,
    observed_at: observedAt,
    expires_at: expiresAt,
  };
}

/**
 * Constructs the only resolver accepted by the causal runtime. The observer is
 * installed by Universal Core and receives an immutable lookup key; no release
 * facts from the caller are forwarded or used as fallback.
 */
export function createServerOwnedReleaseTupleResolver({ observe, now = () => new Date(), maxAgeMs = RELEASE_TUPLE_MAX_AGE_MS } = {}) {
  if (typeof observe !== "function") fail("RELEASE_OBSERVER_REQUIRED");
  const boundedMaxAge = Number(maxAgeMs);
  if (!Number.isSafeInteger(boundedMaxAge) || boundedMaxAge < 1_000 || boundedMaxAge > 24 * 60 * 60 * 1_000) {
    fail("RELEASE_OBSERVATION_MAX_AGE_INVALID");
  }
  const resolver = async (input) => {
    const lookup = normalizeReleaseTupleLookup(input);
    const nowValue = now();
    const nowMs = nowValue instanceof Date ? nowValue.getTime() : Date.parse(String(nowValue || ""));
    if (!Number.isFinite(nowMs)) fail("RELEASE_CLOCK_INVALID");
    const raw = await observe(Object.freeze({ ...lookup }));
    const tuple = normalizeObservedTuple(raw, lookup, nowMs, boundedMaxAge);
    return Object.freeze({ ...tuple, release_tuple_digest: causalDigest(tuple) });
  };
  trustedObservers.add(resolver);
  return resolver;
}

export function isServerOwnedReleaseTupleResolver(value) {
  return typeof value === "function" && trustedObservers.has(value);
}

export function verifyPersistedReleaseTuple(row, now = () => new Date()) {
  const lookup = normalizeReleaseTupleLookup(row.lookup_key);
  const lookupDigest = causalDigest(lookup);
  if (lookupDigest !== requireDigest(row.lookup_digest, "lookup_digest") ||
      row.tenant_id !== lookup.tenant_id || row.project_id !== lookup.project_id ||
      row.project_state_digest !== lookup.project_state_digest || row.genesis_intent_id !== lookup.genesis_intent_id ||
      row.intent_revision_id !== lookup.intent_revision_id || row.work_id !== lookup.work_id ||
      row.change_id !== lookup.change_id || Number(row.pull_request) !== lookup.pull_request) {
    fail("RELEASE_CAUSAL_BINDING_MISMATCH");
  }
  if (causalDigest(object(row.provenance, "RELEASE_PROVENANCE_INVALID")) !==
      requireDigest(row.provenance_digest, "provenance_digest")) {
    fail("RELEASE_PROVENANCE_DIGEST_MISMATCH");
  }
  const persisted = object(row.release_tuple, "RELEASE_TUPLE_INVALID");
  const { release_tuple_digest: embeddedDigest, ...tuple } = persisted;
  if (tuple.schema_version !== RELEASE_TUPLE_SCHEMA_VERSION || tuple.tenant_id !== lookup.tenant_id ||
      tuple.project_id !== lookup.project_id || tuple.project_state_digest !== lookup.project_state_digest ||
      tuple.genesis_intent_id !== lookup.genesis_intent_id || tuple.intent_revision_id !== lookup.intent_revision_id ||
      tuple.work_id !== lookup.work_id || tuple.change_id !== lookup.change_id || tuple.pull_request !== lookup.pull_request) {
    fail("RELEASE_CAUSAL_BINDING_MISMATCH");
  }
  const tupleDigest = causalDigest(tuple);
  if (tupleDigest !== requireDigest(row.release_tuple_digest, "release_tuple_digest") ||
      embeddedDigest !== tupleDigest) fail("RELEASE_TUPLE_DIGEST_MISMATCH");
  const currentValue = now();
  const currentMs = currentValue instanceof Date ? currentValue.getTime() : Date.parse(String(currentValue || ""));
  if (!Number.isFinite(currentMs) || Date.parse(tuple.expires_at) <= currentMs) fail("RELEASE_OBSERVATION_STALE");
  return Object.freeze({ ...tuple, release_tuple_digest: tupleDigest });
}
