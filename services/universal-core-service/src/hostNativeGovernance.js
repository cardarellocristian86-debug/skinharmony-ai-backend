import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeStandingReleaseIntentBinding,
  normalizeStandingReleaseMandate,
  standingReleaseBindingActive,
  standingReleaseEffectiveState,
  validateStandingReleaseDerivation,
} from "./standingReleasePolicy.js";
import {
  advanceStandingReleaseRun as advanceStandingReleaseRunState,
  bindStandingReleaseRunTicket as bindStandingReleaseRunTicketState,
  cancelStandingReleaseRun as cancelStandingReleaseRunState,
  createStandingReleaseRun as createStandingReleaseRunState,
  quarantineExpiredStandingReleaseRun as quarantineExpiredStandingReleaseRunState,
} from "./standingReleaseRunner.js";

export const HOST_NATIVE_HEALTH_CONTRACT_VERSION = "host_native_health_contract_v1";
export const HOST_RELEASE_MANIFEST_VERSION = "host_release_manifest_v2";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalObject(value) {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) =>
    value[key] === undefined ? [] : [[key, canonicalObject(value[key])]],
  ));
}

export const HOST_NATIVE_HEALTH_CONTRACT_DIGEST = crypto
  .createHash("sha256")
  .update(canonical({
    schema_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
    transport: "https",
    path: "/healthz",
    content_type: "application/json",
    required: {
      ok: true,
      version: "non_empty",
      build_commit_sha: "exact_release_commit",
      build_commit_verifiable: true,
      render_ready: true,
    },
  }))
  .digest("hex");

export const HOST_NATIVE_ABSOLUTE_DENY_ACTIONS = Object.freeze([
  "secrets.read",
  "secrets.export",
  "credential.exfiltrate",
  "git.force_push",
  "git.delete_ref",
  "git.tag",
  "host.policy.override",
  "provider.api.call",
  "provider.agent.spawn",
]);

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const OWNER_FINGERPRINT = /^osf_[a-f0-9]{64}$/;
const RENDER_ORIGIN = /^https:\/\/[a-z0-9][a-z0-9-]*\.onrender\.com$/;
const MAX_DELEGATION_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_TICKET_TTL_MS = 10 * 60_000;
const DEFAULT_RESERVATION_LEASE_MS = 5 * 60_000;
const DEFAULT_CORE_JOIN_TTL_MS = 30 * 60_000;
const MAX_FINALIZE_AUTHORIZATION_HISTORY = 16;

function fail(code) {
  throw new Error(code);
}

function clone(value) {
  return structuredClone(value);
}

function text(value, code, max = 2_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}

function digest(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) fail("digest_invalid");
  return normalized;
}

function commit(value, code = "commit_invalid") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!GIT_SHA.test(normalized)) fail(code);
  return normalized;
}

function positiveInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail(code);
  return result;
}

function exactKeys(value, allowed, code = "unknown_field") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("object_invalid");
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${code}:${key}`);
  }
}

function stableStrings(values, code = "values_invalid", maximum = 500) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) fail(code);
  const normalized = values.map((value) => text(value, code, 2_000));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) fail(code);
  return unique;
}

function sameStrings(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function hostNativeDigest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

export function hostNativeGithubDiffDigest({
  repository,
  base_commit,
  head_commit,
  tree_sha,
  changed_files,
} = {}) {
  return hostNativeDigest({
    schema_version: "host_native_github_diff_v1",
    repository: text(repository, "repository_invalid"),
    base_commit: commit(base_commit),
    head_commit: commit(head_commit),
    tree_sha: commit(tree_sha, "tree_sha_invalid"),
    changed_files: stableStrings(changed_files, "changed_files_invalid"),
  });
}

function hmac(prefix, secret, value) {
  return `${prefix}_${crypto.createHmac("sha256", secret)
    .update(value)
    .digest("hex")}`;
}

const HOST_NATIVE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

function hostNativeSigningKeyId(value, signingSecret) {
  const configured = String(value || "").trim();
  if (configured) {
    if (!HOST_NATIVE_KEY_ID.test(configured)) fail("host_native_signing_key_id_invalid");
    return configured;
  }
  // Existing installations did not have a configured key identifier.  A
  // stable, non-secret fingerprint gives those installations an immediate
  // rotation-safe identity without embedding signing material in an artifact.
  return `hnk_${crypto.createHash("sha256").update(signingSecret).digest("hex").slice(0, 32)}`;
}

// Causal Continuity deliberately shares the already-provisioned host-native
// governance signing domain.  The caller supplies a purpose label so one
// signature cannot be replayed as another Core artifact.
export function createHostNativeDomainSigner({ signingSecret, keyId } = {}) {
  const signing = text(signingSecret, "host_native_signing_secret_missing", 8_000);
  if (Buffer.byteLength(signing, "utf8") < 32) fail("host_native_signing_secret_missing");
  const signingKeyId = hostNativeSigningKeyId(keyId, signing);
  return Object.freeze({
    algorithm: "hmac-sha256",
    key_id: signingKeyId,
    sign(value, { purpose } = {}) {
      return hmac("hnc", signing, canonical({ purpose: text(purpose, "signing_purpose_missing", 160), value }));
    },
    verify(value, signature, { purpose, key_id: expectedKeyId } = {}) {
      if (expectedKeyId !== undefined && expectedKeyId !== signingKeyId) return false;
      const expected = hmac("hnc", signing, canonical({ purpose: text(purpose, "signing_purpose_missing", 160), value }));
      return safeEqual(String(signature || ""), expected);
    },
  });
}

/**
 * Builds a verify-only bounded keyring.  New artifacts are signed by a
 * separate active signer; retained verification material keeps historical
 * artifacts auditable across rotations.  Unknown key identifiers fail closed
 * and verification never falls back to a different key.
 */
export function createHostNativeDomainVerifier({ verificationKeys } = {}) {
  if (!verificationKeys || typeof verificationKeys !== "object"
    || Array.isArray(verificationKeys)) fail("host_native_verification_keyring_invalid");
  const entries = Object.entries(verificationKeys);
  if (entries.length < 1 || entries.length > 32) fail("host_native_verification_keyring_invalid");
  const keyring = new Map(entries.map(([rawKeyId, rawSecret]) => {
    const keyId = hostNativeSigningKeyId(rawKeyId, "unused");
    const secret = text(rawSecret, "host_native_verification_secret_invalid", 8_000);
    if (Buffer.byteLength(secret, "utf8") < 32) fail("host_native_verification_secret_invalid");
    return [keyId, secret];
  }));
  if (keyring.size !== entries.length) fail("host_native_verification_keyring_invalid");
  return Object.freeze({
    algorithm: "hmac-sha256",
    key_ids: Object.freeze([...keyring.keys()].sort()),
    verify(value, signature, { purpose, key_id: keyId } = {}) {
      const normalizedKeyId = String(keyId || "").trim();
      if (!HOST_NATIVE_KEY_ID.test(normalizedKeyId) || !keyring.has(normalizedKeyId)) return false;
      const expected = hmac("hnc", keyring.get(normalizedKeyId), canonical({
        purpose: text(purpose, "signing_purpose_missing", 160), value,
      }));
      return safeEqual(String(signature || ""), expected);
    },
  });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function nowMillis(now) {
  const value = Number(typeof now === "function" ? now() : Date.now());
  if (!Number.isFinite(value)) fail("clock_invalid");
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}

function validRenderOrigin(origin) {
  const normalized = String(origin || "").trim().toLowerCase();
  if (!RENDER_ORIGIN.test(normalized)) fail("render_service_origin_invalid");
  let parsed;
  try { parsed = new URL(normalized); }
  catch { fail("render_service_origin_invalid"); }
  if (
    parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password ||
    parsed.pathname !== "/" || parsed.search || parsed.hash ||
    parsed.hostname !== normalized.slice("https://".length) ||
    parsed.hostname.split(".").length !== 3
  ) {
    fail("render_service_origin_invalid");
  }
  return normalized;
}

function branchAllowed(branch, patterns) {
  const value = String(branch || "").trim();
  if (!value || value.includes("..") || value.startsWith("/")) return false;
  return patterns.some((pattern) => (
    pattern.endsWith("*")
      ? value.startsWith(pattern.slice(0, -1))
      : value === pattern
  ));
}

function actionBranch(action) {
  return action.kind === "github.draft_pr" || action.kind === "github.ready" || action.kind === "github.merge"
    ? action.head_branch
    : action.branch;
}

function isReleaseAction(kind) {
  return [
    "git.push.protected",
    "github.merge",
    "render.deploy",
    "render.rollback",
    "render.observe",
  ].includes(kind);
}

function ticketReleaseBinding(manifest) {
  // The signed manifest keeps services under delivery.  The runtime binding
  // also exposes the exact resolved set at the top level so the independent
  // readback verifier cannot accidentally select another service list.
  return { ...manifest, services: manifest.delivery.services };
}

function actionUsage(kind, action, delegation = null) {
  const commits = kind === "git.commit" ? 1 : 0;
  const standingRelease = Boolean(delegation?.grant?.standing_release_binding);
  const pushes = (
    ["git.push.branch", "git.push.protected"].includes(kind) ||
    (kind === "github.merge" && !standingRelease)
  ) ? 1 : 0;
  const directDeploy = ["render.deploy", "render.rollback"].includes(kind) ? 1 : 0;
  const inducedDeploys = Array.isArray(action?.induced_effects) ? action.induced_effects.length : 0;
  return { commits, pushes, deploys: directDeploy + inducedDeploys, total_actions: 1 };
}

const EMPTY_STANDING_RELEASE_USAGE = Object.freeze({
  pull_requests: 0,
  merges: 0,
  repair_attempts: 0,
  rollbacks: 0,
  deploys_by_service: {},
});

function validateStandingRepairAction(delegation, action) {
  const binding = delegation?.grant?.standing_release_binding;
  if (!binding || action.kind !== "git.commit" ||
    Number(delegation.usage?.commits || 0) < 1) return;
  if (!binding.repair_classes.includes(action.repair_class)) {
    fail("standing_release_repair_class_denied");
  }
  const failedCheck = text(
    action.failed_check,
    "standing_release_failed_check_required",
    160,
  );
  if (
    failedCheck === "deployment-parity" ||
    !delegation.grant.release_policy.required_checks.includes(failedCheck)
  ) fail("standing_release_repair_check_denied");
  if (!/^[a-f0-9]{64}$/.test(String(action.failure_evidence_digest || ""))) {
    fail("standing_release_repair_evidence_required");
  }
}

function successfulStandingReleasePredecessor(record) {
  return (record?.state === "completed" && record.outcome === "success") ||
    (record?.state === "reconciled" && record.observed_outcome === "success");
}

function sameStandingReleaseAuthority(left, right) {
  return Boolean(left && right) &&
    left.mandate_id === right.mandate_id &&
    left.mandate_digest === right.mandate_digest &&
    left.revision === right.revision &&
    left.revocation_epoch === right.revocation_epoch;
}

function resolveStandingRepairReadyOrigin({
  state,
  delegation,
  standingBinding,
  tenantId,
  hostKind,
  hostSessionFingerprint,
  readyAction,
  repairPush,
}) {
  const originDraftTicketId = text(
    readyAction.origin_draft_ticket_id,
    "standing_release_origin_draft_required",
    240,
  );
  const originDraft = state.tickets?.[originDraftTicketId];
  const originBinding = state.delegations?.[
    originDraft?.ticket?.delegation_id
  ]?.grant?.standing_release_binding;
  const pullRequest = positiveInteger(
    readyAction.pull_request,
    "standing_release_pull_request_invalid",
    Number.MAX_SAFE_INTEGER,
  );
  if (originDraft?.ticket?.action?.kind !== "github.draft_pr") {
    fail("standing_release_origin_draft_mismatch");
  }
  const originHead = commit(originDraft.ticket.action.head_commit);
  const readyHead = commit(readyAction.head_commit);
  const expectedBase = commit(
    readyAction.expected_base_commit,
    "standing_release_expected_base_required",
  );
  const sameTicketContext = (record) => record?.ticket?.tenant_id === tenantId &&
    record.ticket.delegation_id === delegation.delegation_id &&
    record.ticket.work_id === delegation.grant.work_id &&
    record.ticket.intent_anchor_digest === delegation.grant.intent_anchor_digest &&
    record.ticket.repository === delegation.grant.repository &&
    record.ticket.host_kind === hostKind &&
    record.ticket.host_session_fingerprint === hostSessionFingerprint;

  if (
    !successfulStandingReleasePredecessor(originDraft) ||
    !sameTicketContext(originDraft) ||
    !sameStandingReleaseAuthority(originBinding, standingBinding) ||
    originDraft.result_pull_request !== pullRequest ||
    originDraft.ticket.action.head_branch !== readyAction.head_branch ||
    originDraft.ticket.action.base_branch !== readyAction.base_branch ||
    commit(originDraft.ticket.action.expected_base_commit) !== expectedBase ||
    expectedBase !== standingBinding.base_commit ||
    originHead === readyHead
  ) fail("standing_release_origin_draft_mismatch");

  const configuredRepairLimit = Number(standingBinding.max_repair_attempts);
  if (
    !Number.isSafeInteger(configuredRepairLimit) ||
    configuredRepairLimit < 1 || configuredRepairLimit > 2 ||
    configuredRepairLimit !== Number(standingBinding.limits?.max_repair_attempts)
  ) fail("standing_release_origin_draft_mismatch");

  let currentPush = repairPush;
  let expectedNewHead = readyHead;
  let repairCount = 0;
  while (true) {
    repairCount += 1;
    if (repairCount > configuredRepairLimit) {
      fail("standing_release_origin_draft_mismatch");
    }
    const repairCommit = state.tickets?.[
      currentPush?.ticket?.predecessor?.ticket_id
    ];
    const prior = state.tickets?.[
      repairCommit?.ticket?.predecessor?.ticket_id
    ];
    const repairCommitBinding = state.delegations?.[
      repairCommit?.ticket?.delegation_id
    ]?.grant?.standing_release_binding;
    const repairPushBinding = state.delegations?.[
      currentPush?.ticket?.delegation_id
    ]?.grant?.standing_release_binding;
    if (
      currentPush?.ticket?.action?.kind !== "git.push.branch" ||
      repairCommit?.ticket?.action?.kind !== "git.commit" ||
      !successfulStandingReleasePredecessor(currentPush) ||
      !successfulStandingReleasePredecessor(repairCommit) ||
      !sameTicketContext(currentPush) ||
      !sameTicketContext(repairCommit) ||
      !sameStandingReleaseAuthority(repairPushBinding, standingBinding) ||
      !sameStandingReleaseAuthority(repairCommitBinding, standingBinding) ||
      currentPush.ticket.predecessor?.ticket_id !== repairCommit.ticket.ticket_id ||
      currentPush.ticket.action.branch !== readyAction.head_branch ||
      repairCommit.ticket.action.branch !== readyAction.head_branch ||
      repairCommit.result_commit !== expectedNewHead ||
      commit(currentPush.ticket.action.source_commit) !== expectedNewHead ||
      currentPush.result_commit !== expectedNewHead
    ) fail("standing_release_origin_draft_mismatch");
    validateStandingRepairAction(delegation, repairCommit.ticket.action);

    const expectedOldHead = commit(repairCommit.ticket.action.parent_commit);
    if (
      commit(currentPush.ticket.action.expected_remote_commit) !== expectedOldHead ||
      expectedOldHead === expectedNewHead
    ) fail("standing_release_origin_draft_mismatch");

    if (prior?.ticket?.action?.kind === "github.draft_pr") {
      if (
        prior.ticket.ticket_id !== originDraftTicketId ||
        expectedOldHead !== originHead
      ) fail("standing_release_origin_draft_mismatch");
      break;
    }
    if (
      prior?.ticket?.action?.kind !== "git.push.branch" ||
      prior.result_commit !== expectedOldHead
    ) fail("standing_release_origin_draft_mismatch");
    currentPush = prior;
    expectedNewHead = expectedOldHead;
  }
  return originDraft;
}

function standingReleaseUsageNext(delegation, action) {
  const binding = delegation?.grant?.standing_release_binding;
  if (!binding) return null;
  const limits = binding.limits;
  const current = delegation.standing_release_usage || EMPTY_STANDING_RELEASE_USAGE;
  const next = {
    pull_requests: Number(current.pull_requests || 0),
    merges: Number(current.merges || 0),
    repair_attempts: Number(current.repair_attempts || 0),
    rollbacks: Number(current.rollbacks || 0),
    deploys_by_service: { ...(current.deploys_by_service || {}) },
  };
  if (action.kind === "github.draft_pr") next.pull_requests += 1;
  if (action.kind === "github.merge") next.merges += 1;
  if (action.kind === "render.rollback") next.rollbacks += 1;
  if (action.kind === "git.commit" && Number(delegation.usage?.commits || 0) >= 1) {
    validateStandingRepairAction(delegation, action);
    next.repair_attempts += 1;
  }
  const deployments = action.kind === "render.deploy"
    ? [{ service_id: action.service_id, environment: action.environment }]
    : action.kind === "github.merge" && Array.isArray(action.induced_effects)
      ? action.induced_effects
      : [];
  for (const deployment of deployments) {
    const key = `${text(deployment?.service_id, "standing_release_service_invalid", 160)}\u0000${text(deployment?.environment, "standing_release_service_invalid", 160)}`;
    if (!binding.induced_services.some((service) =>
      `${service.service_id}\u0000${service.environment}` === key)) {
      fail("standing_release_service_scope_drift");
    }
    next.deploys_by_service[key] = Number(next.deploys_by_service[key] || 0) + 1;
  }
  if (
    next.pull_requests > limits.max_pull_requests ||
    next.merges > limits.max_merges ||
    next.repair_attempts > limits.max_repair_attempts ||
    next.rollbacks > limits.max_rollbacks ||
    Object.values(next.deploys_by_service).some((count) =>
      count > limits.max_deploys_per_service)
  ) fail("standing_release_action_budget_exhausted");
  return next;
}

function emptyState() {
  return {
    schema_version: "host_native_governance_store_v1",
    delegations: {},
    tickets: {},
    core_join_verdicts: {},
    owner_manual_merge_readbacks: {},
    owner_manual_merge_successors: {},
    owner_nonces: {},
    idempotency: {},
    standing_release_mandates: {},
    standing_release_leases: {},
    standing_release_runs: {},
  };
}

function normalizeState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return emptyState();
  return {
    schema_version: "host_native_governance_store_v1",
    delegations: input.delegations && typeof input.delegations === "object" ? input.delegations : {},
    tickets: input.tickets && typeof input.tickets === "object" ? input.tickets : {},
    core_join_verdicts: input.core_join_verdicts && typeof input.core_join_verdicts === "object" ? input.core_join_verdicts : {},
    owner_manual_merge_readbacks: input.owner_manual_merge_readbacks &&
      typeof input.owner_manual_merge_readbacks === "object"
      ? input.owner_manual_merge_readbacks
      : {},
    owner_manual_merge_successors: input.owner_manual_merge_successors &&
      typeof input.owner_manual_merge_successors === "object"
      ? input.owner_manual_merge_successors
      : {},
    owner_nonces: input.owner_nonces && typeof input.owner_nonces === "object" ? input.owner_nonces : {},
    idempotency: input.idempotency && typeof input.idempotency === "object" ? input.idempotency : {},
    standing_release_mandates: input.standing_release_mandates && typeof input.standing_release_mandates === "object"
      ? input.standing_release_mandates
      : {},
    standing_release_leases: input.standing_release_leases && typeof input.standing_release_leases === "object"
      ? input.standing_release_leases
      : {},
    standing_release_runs: input.standing_release_runs && typeof input.standing_release_runs === "object"
      ? input.standing_release_runs
      : {},
  };
}

export function createInMemoryHostNativeGovernanceStore() {
  let state = emptyState();
  return Object.freeze({
    kind: "memory",
    restart_durable: false,
    distributed: false,
    readState() { return clone(state); },
    mutate(operation) {
      const result = operation(state);
      return clone(result);
    },
  });
}

export function createFileHostNativeGovernanceStore({ root } = {}) {
  const directory = path.resolve(text(root, "host_native_governance_root_invalid", 4_000));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "host-native-governance.json");
  const lock = `${file}.lock`;
  const staleLockMs = 60_000;
  function read() {
    try {
      return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (cause) {
      if (cause?.code === "ENOENT") return emptyState();
      fail("store_unavailable");
    }
  }
  function acquireLock() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = fs.openSync(lock, "wx", 0o600);
        try {
          fs.writeFileSync(descriptor, JSON.stringify({
            pid: process.pid,
            acquired_at: new Date().toISOString(),
          }));
          fs.fsyncSync(descriptor);
          return descriptor;
        } catch {
          try { fs.closeSync(descriptor); } catch {}
          try { fs.unlinkSync(lock); } catch {}
          fail("store_unavailable");
        }
      } catch (cause) {
        if (cause?.code !== "EEXIST" || attempt > 0) fail("store_lock_timeout");
        let recoverable = false;
        try {
          const stat = fs.statSync(lock);
          let metadata = null;
          try { metadata = JSON.parse(fs.readFileSync(lock, "utf8")); } catch {}
          const pid = Number(metadata?.pid);
          if (Number.isSafeInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); }
            catch (probe) { recoverable = probe?.code === "ESRCH"; }
          } else {
            recoverable = Date.now() - stat.mtimeMs > staleLockMs;
          }
        } catch (probe) {
          if (probe?.code === "ENOENT") continue;
          fail("store_lock_timeout");
        }
        if (!recoverable) fail("store_lock_timeout");
        try { fs.unlinkSync(lock); }
        catch (unlinkError) {
          if (unlinkError?.code !== "ENOENT") fail("store_lock_timeout");
        }
      }
    }
    fail("store_lock_timeout");
  }
  function mutate(operation) {
    const descriptor = acquireLock();
    try {
      const state = read();
      const result = operation(state);
      const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
      return clone(result);
    } catch (cause) {
      if (String(cause?.message || "").startsWith("store_")) throw cause;
      throw cause;
    } finally {
      try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(lock); } catch {}
    }
  }
  return Object.freeze({
    kind: "file_atomic",
    restart_durable: true,
    distributed: false,
    readState() { return clone(read()); },
    mutate,
  });
}

function requireStore(store) {
  if (!store || typeof store.readState !== "function" || typeof store.mutate !== "function") {
    fail("host_native_governance_store_required");
  }
  return store;
}

function idempotencyKey(tenantId, method, key) {
  const normalized = String(key || "").trim();
  return normalized ? `${tenantId}\u0000${method}\u0000${normalized}` : null;
}

function getIdempotent(state, tenantId, method, input) {
  const key = idempotencyKey(tenantId, method, input?.idempotency_key);
  if (!key) return null;
  const existing = state.idempotency[key];
  const requestDigest = hostNativeDigest({
    ...input,
    idempotency_key: String(input.idempotency_key),
  });
  if (!existing) return { key, requestDigest, result: null };
  if (existing.request_digest !== requestDigest) fail("idempotency_key_conflict");
  return { key, requestDigest, result: clone(existing.result) };
}

function delegationIssueIdempotencyInput(input, grant) {
  const {
    expires_at: expiresAt,
    owner_confirmation: ownerConfirmation,
    ...semanticGrant
  } = grant;
  const semanticOwner = ownerConfirmation && typeof ownerConfirmation === "object"
    ? {
        verified: ownerConfirmation.verified === true,
        request_bound: ownerConfirmation.request_bound === true,
        owner_subject_fingerprint: ownerConfirmation.owner_subject_fingerprint,
        purpose: ownerConfirmation.purpose,
      }
    : ownerConfirmation;
  return {
    ...semanticGrant,
    // New callers bind the requested duration, not the per-attempt wall-clock
    // expiry. Legacy callers retain exact expires_at matching so this change
    // is additive and cannot broaden an older grant on retry.
    ...(input.requested_ttl_seconds === undefined
      ? { expires_at: expiresAt }
      : { requested_ttl_seconds: Number(input.requested_ttl_seconds) }),
    idempotency_key: String(input.idempotency_key || ""),
    owner_confirmation: semanticOwner,
  };
}

function semanticStandingReleaseIntentBinding(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const {
    work_status: _workStatus,
    current_version: _currentVersion,
    work_updated_at: _workUpdatedAt,
    verified_at: _verifiedAt,
    binding_digest: _bindingDigest,
    ...stableBinding
  } = input;
  return stableBinding;
}

function standingReleaseInstallIdempotencyInput(mandate, intentBinding, idempotencyKey) {
  const { expires_at: _expiresAt, ...semanticMandate } = mandate;
  return {
    ...semanticMandate,
    authorization_intent_binding: semanticStandingReleaseIntentBinding(intentBinding),
    idempotency_key: String(idempotencyKey),
  };
}

function standingReleaseRevokeIdempotencyInput(input = {}) {
  return {
    tenant_id: input.tenant_id,
    mandate_id: input.mandate_id,
    reason_digest: input.reason_digest,
    idempotency_key: input.idempotency_key,
  };
}

function standingReleaseDerivationIdempotencyInput(input, grant) {
  const binding = grant.standing_release_binding;
  return {
    tenant_id: grant.tenant_id,
    mandate_id: binding.mandate_id,
    work_id: grant.work_id,
    intent_anchor_digest: grant.intent_anchor_digest,
    intent_binding: semanticStandingReleaseIntentBinding(binding.intent_binding),
    delivery_branch: binding.delivery_branch,
    changed_files: [...binding.changed_files],
    builder_agent_id: binding.builder_agent_id,
    verifier_agent_ids: [...binding.verifier_agent_ids],
    required_checks_policy_digest: binding.required_checks_policy_digest,
    induced_services: clone(binding.induced_services),
    base_commit: binding.base_commit,
    host_kind: binding.host_kind,
    host_session_fingerprint: binding.host_session_fingerprint,
    horizontal_runner_required: binding.horizontal_runner_required === true,
    ttl_seconds: Number(input.ttl_seconds),
    idempotency_key: String(input.idempotency_key),
  };
}

function standingReleaseRunIdempotencyInput(input = {}) {
  const {
    dtt_request_binding_digest: _freshDttBinding,
    intent_binding: _freshIntentBinding,
    ...semantic
  } = input;
  return semantic;
}

function actionReservationIdempotencyInput(input = {}) {
  const { dtt_request_binding_digest: _freshDttBinding, ...semantic } = input;
  return semantic;
}

function actionLifecycleIdempotencyInput(input = {}) {
  const { dtt_request_binding_digest: _freshDttBinding, ...semantic } = input;
  return semantic;
}

function actionTicketLifecycleUnsigned(record) {
  return {
    schema_version: "host_native_action_lifecycle_v1",
    ticket_id: record?.ticket?.ticket_id,
    ticket_digest: hostNativeDigest(record?.ticket),
    state: record?.state,
    uses: record?.uses,
    reservation_id: record?.reservation_id ?? null,
    reserved_at: record?.reserved_at ?? null,
    reservation_expires_at: record?.reservation_expires_at ?? null,
    outcome: record?.outcome ?? null,
    observed_outcome: record?.observed_outcome ?? null,
    result_digest: record?.result_digest ?? null,
    result_commit: record?.result_commit ?? null,
    result_pull_request: record?.result_pull_request ?? null,
    observed_commit: record?.observed_commit ?? null,
    observed_pull_request: record?.observed_pull_request ?? null,
    host_readback_digest: record?.host_readback_digest ?? null,
    completed_at: record?.completed_at ?? null,
    reconciled_at: record?.reconciled_at ?? null,
    pre_merge_readback_digest: record?.pre_merge_readback_digest ?? null,
    quarantined_at: record?.quarantined_at ?? null,
    quarantine_reason_digest: record?.quarantine_reason_digest ?? null,
    semantic_scope_reservation_digest:
      record?.semantic_scope_at_reservation?.decision_digest ?? null,
  };
}

function saveIdempotent(state, descriptor, result) {
  if (descriptor?.key) {
    state.idempotency[descriptor.key] = {
      request_digest: descriptor.requestDigest,
      result: clone(result),
    };
  }
  return result;
}

function checkOwnerConfirmation(confirmation) {
  exactKeys(confirmation, new Set([
    "verified", "request_bound", "owner_subject_fingerprint", "consent_nonce", "confirmation_reference",
    "purpose", "request_binding_hash",
  ]));
  if (confirmation.verified !== true || confirmation.request_bound !== true) {
    fail("owner_confirmation_invalid");
  }
  const owner_subject_fingerprint = text(confirmation.owner_subject_fingerprint, "owner_confirmation_invalid", 100);
  if (!OWNER_FINGERPRINT.test(owner_subject_fingerprint)) fail("owner_confirmation_invalid");
  const purpose = confirmation.purpose === undefined
    ? null
    : text(confirmation.purpose, "owner_confirmation_invalid", 160);
  const request_binding_hash = confirmation.request_binding_hash === undefined
    ? null
    : digest(confirmation.request_binding_hash);
  return {
    verified: true,
    request_bound: true,
    owner_subject_fingerprint,
    consent_nonce: text(confirmation.consent_nonce, "owner_confirmation_invalid", 300),
    confirmation_reference: text(confirmation.confirmation_reference, "owner_confirmation_invalid", 1_000),
    ...(purpose ? { purpose } : {}),
    ...(request_binding_hash ? { request_binding_hash } : {}),
  };
}

function ownerNonceKey(tenantId, confirmation) {
  return `${tenantId}\u0000${confirmation.owner_subject_fingerprint}\u0000${confirmation.consent_nonce}`;
}

function validatePlanAgents(agents) {
  if (!Array.isArray(agents) || agents.length < 1 || agents.length > 3) fail("agents_invalid");
  const byId = new Map();
  for (const agent of agents) {
    if (!agent || typeof agent !== "object") fail("agents_invalid");
    const agent_id = text(agent.agent_id, "agents_invalid", 160);
    if (byId.has(agent_id)) fail("agents_invalid");
    byId.set(agent_id, {
      agent_id,
      role: text(agent.role, "agents_invalid", 160),
      task: text(agent.task, "agents_invalid", 4_000),
      depends_on: Array.isArray(agent.depends_on) ? agent.depends_on.map((entry) => text(entry, "agents_invalid", 160)) : [],
      capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.map((entry) => text(entry, "agents_invalid", 160)) : [],
    });
  }
  for (const agent of byId.values()) {
    if (agent.depends_on.some((dependency) => !byId.has(dependency) || dependency === agent.agent_id)) {
      fail("dependency_invalid");
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail("dependency_cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return [...byId.values()];
}

export function buildHostNativeWorkPlan(input = {}) {
  exactKeys(input, new Set([
    "tenant_id", "work_id", "intent_anchor_digest", "repository", "objective", "required_checks", "max_parallel", "agents", "base_branch",
  ]));
  const agents = validatePlanAgents(input.agents);
  const max_parallel = input.max_parallel === undefined ? Math.min(2, agents.length) : positiveInteger(input.max_parallel, "max_parallel_invalid", 2);
  if (max_parallel > 2) fail("max_parallel_invalid");
  const unsigned = {
    schema_version: "host_native_work_plan_v1",
    tenant_id: text(input.tenant_id, "tenant_id_invalid", 160),
    work_id: text(input.work_id, "work_id_invalid", 240),
    intent_anchor_digest: digest(input.intent_anchor_digest),
    repository: text(input.repository, "repository_invalid", 300),
    base_branch: input.base_branch === undefined ? null : text(input.base_branch, "base_branch_invalid", 240),
    objective: text(input.objective, "objective_invalid", 8_000),
    required_checks: stableStrings(input.required_checks, "required_checks_invalid", 50),
    max_parallel,
    agents,
    execution_adapter: "host_native",
    provider_execution: false,
    provider_api_key_required: false,
    server_model_calls: 0,
    host_materialization_required: true,
    materialization_status: "planned_not_spawned",
    host_policy_override: false,
    host_policy_must_allow: true,
  };
  return buildPolicyBoundWorkPlan(unsigned, null);
}

function policyText(value) {
  return text(value, "required_checks_policy_invalid", 2_000);
}

function policySha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) fail("required_checks_policy_invalid");
  return normalized;
}

function normalizedRequiredChecksPolicy(policy, plan) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    fail("required_checks_policy_unavailable");
  }
  exactKeys(policy, new Set([
    "schema_version", "tenant_id", "repository", "base_branch", "required_checks", "check_app", "workflow", "allowed_events",
  ]));
  if (
    policy.schema_version !== "host_native_required_checks_policy_v1" ||
    policyText(policy.tenant_id) !== plan.tenant_id ||
    policyText(policy.repository) !== plan.repository ||
    policyText(policy.base_branch) !== plan.base_branch
  ) {
    fail("required_checks_policy_mismatch");
  }
  const required_checks = stableStrings(
    policy.required_checks,
    "required_checks_policy_invalid",
    50,
  );
  if (!sameStrings(required_checks, plan.required_checks)) {
    fail("required_checks_policy_mismatch");
  }
  const checkApp = policy.check_app;
  exactKeys(checkApp, new Set(["id", "slug", "owner"]), "required_checks_policy_invalid");
  const checkAppId = Number(checkApp?.id);
  if (!Number.isSafeInteger(checkAppId) || checkAppId <= 0) {
    fail("required_checks_policy_invalid");
  }
  const workflow = policy.workflow;
  exactKeys(workflow, new Set(["id", "name", "path", "sha256", "candidate_sha256"]), "required_checks_policy_invalid");
  const workflowId = Number(workflow?.id);
  const workflowPath = policyText(workflow?.path);
  if (
    !Number.isSafeInteger(workflowId) || workflowId <= 0 ||
    !/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(workflowPath)
  ) {
    fail("required_checks_policy_invalid");
  }
  const workflowSha256 = policySha256(workflow?.sha256);
  const candidateSha256 = workflow?.candidate_sha256 == null
    ? null
    : policySha256(workflow.candidate_sha256);
  if (candidateSha256 === workflowSha256) fail("required_checks_policy_invalid");
  const allowed_events = stableStrings(
    policy.allowed_events,
    "required_checks_policy_invalid",
    4,
  );
  if (allowed_events.some((event) => !["push", "pull_request"].includes(event))) {
    fail("required_checks_policy_invalid");
  }
  return {
    schema_version: "host_native_required_checks_policy_v1",
    tenant_id: plan.tenant_id,
    repository: plan.repository,
    base_branch: plan.base_branch,
    required_checks,
    check_app: {
      id: checkAppId,
      slug: policyText(checkApp?.slug),
      owner: policyText(checkApp?.owner),
    },
    workflow: {
      id: workflowId,
      name: policyText(workflow?.name),
      path: workflowPath,
      sha256: workflowSha256,
      candidate_sha256: candidateSha256,
    },
    allowed_events,
  };
}

function buildPolicyBoundWorkPlan(plan, requiredChecksPolicyDigest) {
  const builders = plan.agents.filter((agent) => agent.role === "builder");
  const verifier_agent_ids = plan.agents
    .filter((agent) => agent.role === "verifier")
    .map((agent) => agent.agent_id)
    .sort();
  if (builders.length !== 1 || verifier_agent_ids.length < 1) {
    fail("independent_verifier_required");
  }
  const payload = {
    tenant_id: plan.tenant_id,
    work_id: plan.work_id,
    intent_anchor_digest: plan.intent_anchor_digest,
    repository: plan.repository,
    ...(plan.base_branch ? { base_branch: plan.base_branch } : {}),
    objective: plan.objective,
    required_checks: plan.required_checks,
    ...(requiredChecksPolicyDigest
      ? { required_checks_policy_digest: requiredChecksPolicyDigest }
      : {}),
    builder_agent_id: builders[0].agent_id,
    verifier_agent_ids,
    agents: plan.agents,
    maximum_parallel_agents: plan.max_parallel,
  };
  const plan_digest = hostNativeDigest(payload);
  return Object.freeze({
    schema_version: plan.schema_version,
    plan_id: `hnp_${plan_digest.slice(0, 40)}`,
    plan_digest,
    ...payload,
    // Preserve the legacy response field for host clients while keeping the
    // V2 canonical digest bound to its unambiguous field name above.
    max_parallel: plan.max_parallel,
    execution_adapter: plan.execution_adapter,
    provider_execution: false,
    provider_api_key_required: false,
    server_model_calls: 0,
    host_materialization_required: true,
    materialization_status: "planned_not_spawned",
    host_policy_override: false,
    host_policy_must_allow: true,
    child_can_issue_action_ticket: false,
    join_authority: "universal_core",
    release_mode: "external_ticket_required",
  });
}

function normalizeService(service) {
  exactKeys(service, new Set([
    "service_id", "environment", "expected_previous_commit", "target_commit", "target_resolution", "health_contract_digest", "origin",
  ]));
  const targetRaw = service.target_commit;
  const target_commit = targetRaw === null || targetRaw === undefined || targetRaw === ""
    ? null
    : commit(targetRaw);
  const target_resolution = service.target_resolution === undefined || service.target_resolution === null
    ? null
    : text(service.target_resolution, "service_target_resolution_invalid", 100);
  return {
    service_id: text(service.service_id, "service_id_invalid", 160),
    environment: text(service.environment, "environment_invalid", 120),
    expected_previous_commit: commit(service.expected_previous_commit),
    target_commit,
    ...(target_resolution ? { target_resolution } : {}),
    health_contract_digest: digest(service.health_contract_digest),
    ...(service.origin === undefined ? {} : { origin: validRenderOrigin(service.origin) }),
  };
}

function normalizeManifest(input, { allowDigest = false } = {}) {
  const allowed = new Set([
    "schema_version", "manifest_id", "tenant_id", "work_id", "intent_anchor_digest", "repository",
    "base_branch", "delivery_branch", "base_commit", "head_commit", "tree_sha", "diff_digest", "changed_files",
    "verification", "delivery", "rollback", ...(allowDigest ? ["manifest_digest"] : []),
  ]);
  exactKeys(input, allowed);
  if (input.schema_version !== HOST_RELEASE_MANIFEST_VERSION) fail("manifest_schema_invalid");
  const verificationInput = input.verification;
  exactKeys(verificationInput, new Set([
    "builder_agent_id", "verifier_agent_ids", "required_checks", "checks_commit", "checks_digest", "evidence_digest", "core_join_verdict_id",
  ]));
  const builder_agent_id = text(verificationInput.builder_agent_id, "builder_agent_invalid", 240);
  const verifier_agent_ids = stableStrings(verificationInput.verifier_agent_ids, "verifier_agents_invalid", 20);
  if (verifier_agent_ids.includes(builder_agent_id)) fail("self_verification_denied");
  const deliveryInput = input.delivery;
  exactKeys(deliveryInput, new Set(["method", "services"]));
  if (!Array.isArray(deliveryInput.services) || deliveryInput.services.length < 1 || deliveryInput.services.length > 20) {
    fail("delivery_services_invalid");
  }
  const services = deliveryInput.services.map(normalizeService);
  const serviceKeys = new Set();
  for (const service of services) {
    const key = `${service.service_id}\u0000${service.environment}`;
    if (serviceKeys.has(key)) fail("delivery_services_invalid");
    serviceKeys.add(key);
    if (service.health_contract_digest !== HOST_NATIVE_HEALTH_CONTRACT_DIGEST) {
      fail("health_contract_unsupported");
    }
  }
  const rollbackInput = input.rollback;
  exactKeys(rollbackInput, new Set(["mode", "target_commit", "health_contract_digest", "ready"]));
  const result = {
    schema_version: HOST_RELEASE_MANIFEST_VERSION,
    manifest_id: text(input.manifest_id, "manifest_id_invalid", 240),
    tenant_id: text(input.tenant_id, "tenant_id_invalid", 160),
    work_id: text(input.work_id, "work_id_invalid", 240),
    intent_anchor_digest: digest(input.intent_anchor_digest),
    repository: text(input.repository, "repository_invalid", 300),
    base_branch: text(input.base_branch, "base_branch_invalid", 240),
    delivery_branch: text(input.delivery_branch, "delivery_branch_invalid", 240),
    base_commit: commit(input.base_commit),
    head_commit: commit(input.head_commit),
    tree_sha: commit(input.tree_sha, "tree_sha_invalid"),
    diff_digest: digest(input.diff_digest),
    changed_files: stableStrings(input.changed_files, "changed_files_invalid", 5_000),
    verification: {
      builder_agent_id,
      verifier_agent_ids,
      required_checks: stableStrings(verificationInput.required_checks, "required_checks_invalid", 100),
      checks_commit: commit(verificationInput.checks_commit),
      checks_digest: digest(verificationInput.checks_digest),
      evidence_digest: digest(verificationInput.evidence_digest),
      core_join_verdict_id: text(verificationInput.core_join_verdict_id, "core_join_verdict_invalid", 240),
    },
    delivery: {
      method: text(deliveryInput.method, "delivery_method_invalid", 160),
      services,
    },
    rollback: {
      mode: text(rollbackInput.mode, "rollback_mode_invalid", 160),
      target_commit: commit(rollbackInput.target_commit),
      health_contract_digest: digest(rollbackInput.health_contract_digest),
      ready: rollbackInput.ready === true,
    },
  };
  if (result.verification.checks_commit !== result.head_commit) fail("checks_commit_mismatch");
  if (!["forward_revert", "redeploy_previous_commit"].includes(result.rollback.mode)) {
    fail("rollback_mode_unsupported");
  }
  if (
    result.rollback.mode === "forward_revert" &&
    result.rollback.target_commit !== result.base_commit
  ) {
    fail("rollback_previous_commit_mismatch");
  }
  if (
    result.rollback.mode === "redeploy_previous_commit" &&
    result.delivery.services.some((service) =>
      service.expected_previous_commit !== result.rollback.target_commit)
  ) {
    fail("rollback_previous_commit_mismatch");
  }
  if (result.rollback.health_contract_digest !== HOST_NATIVE_HEALTH_CONTRACT_DIGEST) {
    fail("rollback_health_contract_unsupported");
  }
  if (result.rollback.ready !== true) fail("rollback_not_ready");
  const expectedDiff = hostNativeGithubDiffDigest({
    repository: result.repository,
    base_commit: result.base_commit,
    head_commit: result.head_commit,
    tree_sha: result.tree_sha,
    changed_files: result.changed_files,
  });
  if (result.diff_digest !== expectedDiff) fail("diff_digest_mismatch");
  if (allowDigest) result.manifest_digest = digest(input.manifest_digest);
  return result;
}

export function buildHostReleaseManifestV2(input = {}) {
  const unsigned = normalizeManifest(input);
  return Object.freeze({ ...unsigned, manifest_digest: hostNativeDigest(unsigned) });
}

export function validateHostReleaseManifestV2(manifest, context = null) {
  const normalized = normalizeManifest(manifest, { allowDigest: true });
  const { manifest_digest, ...unsigned } = normalized;
  if (manifest_digest !== hostNativeDigest(unsigned)) fail("digest_mismatch");
  if (context) {
    for (const field of ["tenant_id", "work_id", "intent_anchor_digest", "repository"]) {
      if (context[field] !== undefined && normalized[field] !== context[field]) {
        fail(`manifest_${field}_mismatch`);
      }
    }
  }
  return Object.freeze(normalized);
}

function releaseIntentUnsigned(manifest) {
  return {
    schema_version: "host_release_intent_v1",
    tenant_id: manifest.tenant_id,
    work_id: manifest.work_id,
    intent_anchor_digest: manifest.intent_anchor_digest,
    repository: manifest.repository,
    base_branch: manifest.base_branch,
    delivery_branch: manifest.delivery_branch,
    base_commit: manifest.base_commit,
    head_commit: manifest.head_commit,
    tree_sha: manifest.tree_sha,
    diff_digest: manifest.diff_digest,
    changed_files: manifest.changed_files,
    delivery: manifest.delivery,
    rollback: manifest.rollback,
    verification: {
      builder_agent_id: manifest.verification.builder_agent_id,
      verifier_agent_ids: manifest.verification.verifier_agent_ids,
      required_checks: manifest.verification.required_checks,
      checks_commit: manifest.verification.checks_commit,
      checks_digest: manifest.verification.checks_digest,
      evidence_digest: manifest.verification.evidence_digest,
    },
  };
}

function normalizeReleaseIntentRequest(input = {}) {
  exactKeys(input, new Set([
    "tenant_id", "work_id", "intent_anchor_digest", "repository", "base_branch", "delivery_branch",
    "base_commit", "head_commit", "tree_sha", "diff_digest", "changed_files", "verification", "delivery", "rollback",
  ]));
  const verification = input.verification;
  exactKeys(verification, new Set([
    "builder_agent_id", "verifier_agent_ids", "required_checks", "checks_commit", "checks_digest", "evidence_digest",
  ]));
  // A release intent is deliberately created before a Core-join verdict
  // exists.  Validate it through the same full-manifest rules while keeping
  // the synthetic identifiers entirely internal and out of its digest.
  const proposedDiffDigest = digest(input.diff_digest);
  const validationDiffDigest = hostNativeGithubDiffDigest({
    repository: input.repository,
    base_commit: input.base_commit,
    head_commit: input.head_commit,
    tree_sha: input.tree_sha,
    changed_files: input.changed_files,
  });
  if (proposedDiffDigest !== validationDiffDigest) {
    fail("release_intent_diff_digest_mismatch");
  }
  const normalized = normalizeManifest({
    schema_version: HOST_RELEASE_MANIFEST_VERSION,
    manifest_id: "host-release-intent-pending-core-join",
    ...input,
    // A manifestless intent is a proposed release binding, not proof of a
    // remotely-read Git diff.  Validate every structural manifest invariant
    // with the deterministic local binding; the supplied evidence digest is
    // preserved for the later independently-attested Core join.
    diff_digest: validationDiffDigest,
    verification: {
      ...verification,
      core_join_verdict_id: "pending-core-join",
    },
  });
  return releaseIntentUnsigned({ ...normalized, diff_digest: proposedDiffDigest });
}

export function buildHostReleaseIntentV1(input = {}) {
  const fullManifest = Boolean(
    input && typeof input === "object" && (
      input.schema_version !== undefined ||
      input.manifest_id !== undefined ||
      input.manifest_digest !== undefined
    ),
  );
  const unsigned = fullManifest
    ? releaseIntentUnsigned(
      input.manifest_digest
        ? validateHostReleaseManifestV2(input)
        : buildHostReleaseManifestV2(input),
    )
    : normalizeReleaseIntentRequest(input);
  return Object.freeze({ ...unsigned, release_intent_digest: hostNativeDigest(unsigned) });
}

export function deriveHostReleaseIntentV1(manifest) {
  return buildHostReleaseIntentV1(manifest);
}

function normalizeDelegation(input, now) {
  exactKeys(input, new Set([
    "tenant_id", "work_id", "intent_anchor_digest", "repository", "owner_confirmation", "audience",
    "allowed_branches", "protected_branches", "allowed_path_prefixes", "allowed_actions", "budget", "release_policy", "expires_at", "idempotency_key", "requested_ttl_seconds",
  ]));
  const requestedTtlProvided = input.requested_ttl_seconds !== undefined;
  const legacyExpiryProvided = input.expires_at !== undefined;
  if (requestedTtlProvided === legacyExpiryProvided) fail("delegation_expiry_mode_invalid");
  let expires;
  if (requestedTtlProvided) {
    const requestedTtlSeconds = positiveInteger(
      input.requested_ttl_seconds,
      "delegation_ttl_invalid",
      MAX_DELEGATION_MS / 1_000,
    );
    if (requestedTtlSeconds < 60) fail("delegation_ttl_invalid");
    expires = now + requestedTtlSeconds * 1_000;
  } else {
    expires = Date.parse(input.expires_at);
    if (!Number.isFinite(expires) || expires <= now || expires > now + MAX_DELEGATION_MS) {
      fail("delegation_expiry_invalid");
    }
  }
  const allowed_actions = stableStrings(input.allowed_actions, "allowed_actions_invalid", 50);
  if (allowed_actions.some((action) => HOST_NATIVE_ABSOLUTE_DENY_ACTIONS.includes(action))) {
    fail("absolute_deny_action");
  }
  const budgetInput = input.budget;
  exactKeys(budgetInput, new Set([
    "max_agents", "max_parallel", "max_commits", "max_pushes", "max_deploys", "max_total_actions",
  ]));
  const budget = {
    max_agents: positiveInteger(budgetInput.max_agents, "delegation_budget_invalid", 3),
    max_parallel: positiveInteger(budgetInput.max_parallel, "delegation_budget_invalid", 2),
    max_commits: positiveInteger(budgetInput.max_commits, "delegation_budget_invalid", 100),
    max_pushes: positiveInteger(budgetInput.max_pushes, "delegation_budget_invalid", 100),
    max_deploys: positiveInteger(budgetInput.max_deploys, "delegation_budget_invalid", 100),
    max_total_actions: positiveInteger(budgetInput.max_total_actions, "delegation_budget_invalid", 1_000),
  };
  const releasePolicy = input.release_policy;
  exactKeys(releasePolicy, new Set([
    "manifest_required_for_protected_push", "manifest_required_for_induced_deploy", "manifest_required_for_deploy", "independent_verifier_required", "rollback_required", "required_checks",
  ]));
  return {
    tenant_id: text(input.tenant_id, "tenant_id_invalid", 160),
    work_id: text(input.work_id, "work_id_invalid", 240),
    intent_anchor_digest: digest(input.intent_anchor_digest),
    repository: text(input.repository, "repository_invalid", 300),
    owner_confirmation: checkOwnerConfirmation(input.owner_confirmation),
    audience: stableStrings(input.audience, "audience_invalid", 10),
    allowed_branches: stableStrings(input.allowed_branches, "allowed_branches_invalid", 30),
    protected_branches: stableStrings(input.protected_branches, "protected_branches_invalid", 30),
    allowed_path_prefixes: stableStrings(input.allowed_path_prefixes, "allowed_paths_invalid", 100),
    allowed_actions,
    budget,
    release_policy: {
      manifest_required_for_protected_push: releasePolicy.manifest_required_for_protected_push === true,
      manifest_required_for_induced_deploy: releasePolicy.manifest_required_for_induced_deploy === true,
      manifest_required_for_deploy: releasePolicy.manifest_required_for_deploy === true,
      independent_verifier_required: releasePolicy.independent_verifier_required === true,
      rollback_required: releasePolicy.rollback_required === true,
      required_checks: stableStrings(releasePolicy.required_checks, "required_checks_invalid", 100),
    },
    expires_at: iso(expires),
  };
}

function delegationUnsigned(grant, delegationId, issuedAt) {
  return {
    schema_version: "host_native_delegation_v1",
    tenant_id: grant.tenant_id,
    delegation_id: delegationId,
    issued_at: issuedAt,
    state: "active",
    grant,
    usage: { commits: 0, pushes: 0, deploys: 0, total_actions: 0 },
  };
}

function delegationActive(record, now) {
  return record?.state === "active" && Date.parse(record.grant.expires_at) > now;
}

const ZERO_DELEGATION_USAGE = Object.freeze({
  commits: 0,
  pushes: 0,
  deploys: 0,
  total_actions: 0,
});

const OBSERVATION_ONLY_ACTION_FIELDS = new Set([
  "kind",
  "repository",
  "branch",
  "service_id",
  "environment",
  "target_commit",
  "parent_release_ticket_id",
  "parent_release_ticket_digest",
  "release_manifest_digest",
  "provider_execution",
]);

function ensureObservationOnlyActionShape(action) {
  exactKeys(
    action,
    OBSERVATION_ONLY_ACTION_FIELDS,
    "delegation_continuation_action_field_denied",
  );
  if (action.kind !== "render.observe" || action.provider_execution !== false) {
    fail("delegation_continuation_action_invalid");
  }
}

// Delegation usage is authoritative mutable state, while the HMAC emitted at
// issuance authenticates the immutable grant and its zero-use starting point.
// Reconstruct that original envelope so a completed parent remains
// cryptographically attributable after its usage counters have advanced.
function issuedDelegationIssuanceSignatureValid(record, signing) {
  try {
    if (
      !record || record.schema_version !== "host_native_delegation_v1" ||
      record.tenant_id !== record.grant?.tenant_id
    ) return false;
    const issued = delegationUnsigned(
      record.grant,
      record.delegation_id,
      record.issued_at,
    );
    if (record.grant?.standing_release_binding) {
      issued.standing_release_usage = clone(EMPTY_STANDING_RELEASE_USAGE);
    }
    return safeEqual(record.signature, hmac("hnd", signing, canonical(issued)));
  } catch {
    return false;
  }
}

function issuedDelegationSignatureValid(record, signing) {
  return record?.state === "active" &&
    issuedDelegationIssuanceSignatureValid(record, signing);
}

function delegationUsageMatches(record, expectedTotalActions) {
  const usage = record?.usage;
  return usage?.commits === ZERO_DELEGATION_USAGE.commits &&
    usage?.pushes === ZERO_DELEGATION_USAGE.pushes &&
    usage?.deploys === ZERO_DELEGATION_USAGE.deploys &&
    usage?.total_actions === expectedTotalActions;
}

function validateActionShape(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) fail("action_invalid");
  const kind = text(action.kind, "action_invalid", 160);
  if (action.provider_execution === true) fail("provider_execution_denied");
  if (action.force === true || action.delete_ref === true || action.tags === true) fail("absolute_deny_action");
  if (HOST_NATIVE_ABSOLUTE_DENY_ACTIONS.includes(kind)) fail("absolute_deny_action");
  const repository = text(action.repository, "action_repository_invalid", 300);
  return { ...clone(action), kind, repository, provider_execution: false };
}

function ensureActionBound(action, delegation, { serverVerifiedBranch = null } = {}) {
  if (action.repository !== delegation.grant.repository) fail("delegation_repository_mismatch");
  const branch = actionBranch(action);
  const branchIsAllowed = serverVerifiedBranch === null
    ? branchAllowed(branch, delegation.grant.allowed_branches)
    : action.kind === "render.observe" && branch === serverVerifiedBranch;
  if (branch && !branchIsAllowed) fail("branch_not_allowed");
  if (!delegation.grant.allowed_actions.includes(action.kind)) fail("action_not_allowed");
  if (action.kind === "github.merge" && !delegation.grant.protected_branches.includes(action.base_branch)) {
    fail("protected_base_required");
  }
  if (action.kind === "git.push.protected" && !delegation.grant.protected_branches.includes(action.branch)) {
    fail("protected_base_required");
  }
  const changed = Array.isArray(action.changed_files) ? action.changed_files : [];
  if (changed.some((file) => !delegation.grant.allowed_path_prefixes.some((prefix) => (
    String(file).startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || String(file) === prefix
  )))) {
    fail("path_not_allowed");
  }
}

function ensureBudget(delegation, usage) {
  const next = {
    commits: delegation.usage.commits + usage.commits,
    pushes: delegation.usage.pushes + usage.pushes,
    deploys: delegation.usage.deploys + usage.deploys,
    total_actions: delegation.usage.total_actions + usage.total_actions,
  };
  if (next.commits > delegation.grant.budget.max_commits) fail("delegation_commits_budget_exhausted");
  if (next.pushes > delegation.grant.budget.max_pushes) fail("delegation_pushes_budget_exhausted");
  if (next.deploys > delegation.grant.budget.max_deploys) fail("delegation_deploys_budget_exhausted");
  if (next.total_actions > delegation.grant.budget.max_total_actions) fail("delegation_total_actions_budget_exhausted");
  return next;
}

function validateClosureAttestation(input, secret) {
  const attestation = input.closure_attestation;
  exactKeys(attestation, new Set([
    "schema_version", "tenant_id", "work_id", "repository", "core_plan_id", "core_plan_digest", "local_plan_id", "local_plan_digest", "evaluation_digest", "target_commit", "checks_digest", "acceptance_criteria", "report_bindings", "provider_execution", "signature",
  ]));
  if (attestation.schema_version !== "host_native_closure_attestation_v1" || attestation.provider_execution !== false) {
    fail("closure_attestation_invalid");
  }
  const { signature, ...unsigned } = attestation;
  const expected = hmac(
    "hnca",
    secret,
    `host-native-closure-attestation-v1\u0000${JSON.stringify(canonicalObject(unsigned))}`,
  );
  // The format was valid, but its authenticated contents were altered.  Keep
  // this distinct from a malformed attestation so the HTTP layer can deny it
  // as an authorization failure without leaking any verification detail.
  if (!safeEqual(signature, expected)) {
    fail("core_join_closure_attestation_signature_invalid");
  }
  return clone(attestation);
}

function coreJoinClaim(input, manifest, closure, requiredChecksPolicyDigest = null) {
  const checksCommit = commit(input.checks?.commit, "checks_commit_invalid");
  if (checksCommit !== manifest.verification.checks_commit) fail("reviewed_commit_mismatch");
  if (!sameStrings(input.checks?.required_checks, manifest.verification.required_checks)) {
    fail("required_checks_policy_mismatch");
  }
  if (digest(input.checks?.checks_digest) !== manifest.verification.checks_digest) fail("checks_digest_mismatch");
  if (input.provider_execution !== false) fail("provider_execution_denied");
  const core_plan_digest = digest(input.core_plan_digest);
  const core_plan_id = text(input.core_plan_id, "core_plan_binding_mismatch", 240);
  if (core_plan_id !== `hnp_${core_plan_digest.slice(0, 40)}`) fail("core_plan_binding_mismatch");
  if (!Array.isArray(input.acceptance_criteria) || input.acceptance_criteria.length < 1) fail("acceptance_criteria_invalid");
  for (const criterion of input.acceptance_criteria) {
    if (criterion?.proven !== true) fail("criterion_unproven");
  }
  const builder = input.builder_report || {};
  if (text(builder.agent_id, "builder_report_invalid", 240) !== manifest.verification.builder_agent_id ||
      commit(builder.target_commit, "reviewed_commit_mismatch") !== checksCommit) {
    fail("reviewed_commit_mismatch");
  }
  if (!Array.isArray(input.verifier_reports) || input.verifier_reports.length !== manifest.verification.verifier_agent_ids.length) {
    fail("verifier_reports_invalid");
  }
  const seen = new Set();
  for (const report of input.verifier_reports) {
    const agent = text(report?.agent_id, "verifier_reports_invalid", 240);
    if (agent === builder.agent_id) fail("self_verification_denied");
    if (!manifest.verification.verifier_agent_ids.includes(agent) || seen.has(agent) || report?.approved !== true ||
        commit(report?.reviewed_commit, "reviewed_commit_mismatch") !== checksCommit) {
      fail("reviewed_commit_mismatch");
    }
    seen.add(agent);
  }
  const intent = input.release_intent || {};
  const release_intent_digest = text(
    intent.release_intent_digest,
    "core_join_verdict_binding_mismatch",
    100,
  );
  if (!SHA256.test(release_intent_digest)) fail("core_join_verdict_binding_mismatch");
  const softwareClosureDigest = input.software_closure_digest === undefined
    ? null
    : digest(input.software_closure_digest);
  const softwareClosureFreshUntilText = softwareClosureDigest
    ? text(input.software_closure_fresh_until, "software_cognition_closure_expired_during_issuance", 64)
    : null;
  const softwareClosureFreshUntil = softwareClosureFreshUntilText ? Date.parse(softwareClosureFreshUntilText) : null;
  if (softwareClosureFreshUntilText && (!Number.isFinite(softwareClosureFreshUntil) ||
      new Date(softwareClosureFreshUntil).toISOString() !== softwareClosureFreshUntilText)) {
    fail("software_cognition_closure_expired_during_issuance");
  }
  const claim = {
    schema_version: softwareClosureDigest ? "host_native_core_join_claim_v2" : "host_native_core_join_claim_v1",
    tenant_id: manifest.tenant_id,
    work_id: manifest.work_id,
    intent_anchor_digest: manifest.intent_anchor_digest,
    repository: manifest.repository,
    base_branch: text(manifest.base_branch, "base_branch_invalid", 240),
    core_plan_id,
    core_plan_digest,
    local_plan_id: text(input.local_plan_id, "local_plan_invalid", 240),
    local_plan_digest: digest(input.local_plan_digest),
    evaluation_digest: digest(input.evaluation_digest),
    acceptance_criteria: clone(input.acceptance_criteria),
    builder_report: clone(builder),
    verifier_reports: clone(input.verifier_reports),
    checks: {
      commit: checksCommit,
      required_checks: stableStrings(input.checks.required_checks, "required_checks_invalid", 100),
      checks_digest: digest(input.checks.checks_digest),
      evidence_digest: digest(input.checks.evidence_digest),
    },
    closure_attestation: closure,
    ...(softwareClosureDigest ? { software_closure_digest: softwareClosureDigest } : {}),
    ...(softwareClosureFreshUntilText ? { software_closure_fresh_until: softwareClosureFreshUntilText } : {}),
    release_intent_digest,
    ...(requiredChecksPolicyDigest
      ? { required_checks_policy_digest: requiredChecksPolicyDigest }
      : {}),
    provider_execution: false,
  };
  return claim;
}

function ticketSignature(secret, ticket) {
  const { signature, ...unsigned } = ticket;
  return hmac("hnt", secret, canonical(unsigned));
}

function ensureExpiredObserveContinuationDelegations({
  parentDelegation,
  successorDelegation,
  parentTicket,
  tenantId,
  workId,
  intentAnchorDigest,
  repository,
  hostKind,
  hostSessionFingerprint,
  nowValue,
  signing,
  successorUsage,
} = {}) {
  const parentExpiresAt = Date.parse(parentDelegation?.grant?.expires_at || "");
  if (
    !parentDelegation || !successorDelegation || !parentTicket ||
    parentDelegation.delegation_id === successorDelegation.delegation_id ||
    parentDelegation.delegation_id !== parentTicket.delegation_id ||
    parentDelegation.state !== "active" ||
    !Number.isFinite(parentExpiresAt) || parentExpiresAt > nowValue ||
    !issuedDelegationSignatureValid(parentDelegation, signing) ||
    !delegationActive(successorDelegation, nowValue) ||
    !issuedDelegationSignatureValid(successorDelegation, signing) ||
    parentDelegation.grant.tenant_id !== tenantId ||
    successorDelegation.grant.tenant_id !== tenantId ||
    parentDelegation.grant.work_id !== workId ||
    successorDelegation.grant.work_id !== workId ||
    parentDelegation.grant.intent_anchor_digest !== intentAnchorDigest ||
    successorDelegation.grant.intent_anchor_digest !== intentAnchorDigest ||
    parentDelegation.grant.repository !== repository ||
    successorDelegation.grant.repository !== repository ||
    parentDelegation.grant.owner_confirmation?.owner_subject_fingerprint !==
      successorDelegation.grant.owner_confirmation?.owner_subject_fingerprint ||
    !parentDelegation.grant.audience?.includes(hostKind) ||
    !successorDelegation.grant.audience?.includes(hostKind) ||
    parentTicket.host_kind !== hostKind ||
    parentTicket.host_session_fingerprint !== hostSessionFingerprint ||
    !Array.isArray(successorDelegation.grant.allowed_actions) ||
    !sameStrings(successorDelegation.grant.allowed_actions, ["render.observe"]) ||
    successorDelegation.grant.budget?.max_total_actions !== 1 ||
    successorDelegation.grant.provider_execution !== false ||
    successorDelegation.grant.host_policy_override !== false ||
    successorDelegation.grant.host_policy_must_allow !== true ||
    !delegationUsageMatches(successorDelegation, successorUsage)
  ) {
    fail("delegation_continuation_invalid");
  }
}

function delegationContinuationUnsigned({
  parentDelegation,
  successorDelegation,
  parentTicket,
  parentTicketDigest,
  parentFinalizeAuthorizationDigest,
  sourceActionDigest,
  sourceRequiredChecksPolicyDigest,
  hostKind,
  hostSessionFingerprint,
  issuedAt,
} = {}) {
  return {
    schema_version: "host_native_delegation_continuation_v1",
    tenant_id: successorDelegation.grant.tenant_id,
    work_id: successorDelegation.grant.work_id,
    intent_anchor_digest: successorDelegation.grant.intent_anchor_digest,
    repository: successorDelegation.grant.repository,
    parent_ticket_id: parentTicket.ticket_id,
    parent_ticket_digest: parentTicketDigest,
    parent_delegation_id: parentDelegation.delegation_id,
    parent_delegation_grant_digest: hostNativeDigest(parentDelegation.grant),
    parent_delegation_signature: parentDelegation.signature,
    parent_delegation_expires_at: parentDelegation.grant.expires_at,
    successor_delegation_id: successorDelegation.delegation_id,
    successor_delegation_grant_digest: hostNativeDigest(successorDelegation.grant),
    successor_delegation_signature: successorDelegation.signature,
    successor_delegation_expires_at: successorDelegation.grant.expires_at,
    owner_subject_fingerprint:
      successorDelegation.grant.owner_confirmation.owner_subject_fingerprint,
    host_kind: hostKind,
    host_session_fingerprint: hostSessionFingerprint,
    authorized_action: "render.observe",
    max_total_actions: 1,
    release_manifest_digest: parentTicket.release_manifest_digest,
    release_intent_digest: parentTicket.release_intent_digest,
    evidence_digest: parentTicket.evidence_digest,
    core_join_verdict_id: parentTicket.core_join_verdict_id,
    core_join_verdict_digest: parentTicket.core_join_verdict_digest,
    core_join_resolution_digest: parentTicket.release_join_resolution_digest,
    parent_finalize_authorization_digest: parentFinalizeAuthorizationDigest,
    source_action_digest: sourceActionDigest,
    source_required_checks_policy_digest: sourceRequiredChecksPolicyDigest,
    issued_at: issuedAt,
    external_execution_allowed: false,
    provider_execution: false,
  };
}

function signDelegationContinuation(input, signing) {
  const unsigned = delegationContinuationUnsigned(input);
  const continuation_digest = hostNativeDigest(unsigned);
  return {
    ...unsigned,
    continuation_digest,
    signature: hmac("hndc", signing, canonical({ ...unsigned, continuation_digest })),
  };
}

function manualMergeReadbackSignatureValid(receipt, signing) {
  try {
    if (
      receipt?.schema_version !== "host_native_owner_manual_merge_readback_v1" ||
      receipt?.authority !== "evidence_only" || receipt?.evidence_only !== true ||
      receipt?.ticket_issued !== false || receipt?.retrospective_ticket_issued !== false ||
      receipt?.action_authorized !== false || receipt?.execution_authorized !== false ||
      receipt?.host_policy_override !== false || receipt?.provider_execution !== false
    ) return false;
    const { signature, receipt_digest, ...unsigned } = receipt;
    return receipt_digest === hostNativeDigest(unsigned) &&
      safeEqual(signature, hmac(
        "hnmmr",
        signing,
        canonical({ ...unsigned, receipt_digest }),
      ));
  } catch {
    return false;
  }
}

function coreJoinRecordSignatureValid(record, signing) {
  try {
    const verdict = record?.verdict;
    const { signature, ...unsignedVerdict } = verdict || {};
    const releaseIntent = record?.release_intent;
    const { release_intent_digest: releaseIntentDigest, ...unsignedIntent } =
      releaseIntent || {};
    return verdict?.allowed === true && verdict?.provider_execution === false &&
      verdict.verdict_id === record?.verdict_id &&
      record?.claim_digest === hostNativeDigest(record?.claim) &&
      verdict?.claim_digest === record.claim_digest &&
      releaseIntentDigest === hostNativeDigest(unsignedIntent) &&
      record.claim?.release_intent_digest === releaseIntentDigest &&
      verdict.release_intent_digest === releaseIntentDigest &&
      verdict.tenant_id === record.claim?.tenant_id &&
      verdict.work_id === record.claim?.work_id &&
      verdict.repository === record.claim?.repository &&
      safeEqual(signature, hmac("hnj", signing, canonical(unsignedVerdict)));
  } catch {
    return false;
  }
}

function withoutKeys(value, keys) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keys.has(key)));
}

function legacyManualMergeRefreshBindingValid({
  priorReceipt,
  priorJoin,
  currentJoin,
  githubReadback,
  nowValue,
  signing,
}) {
  if (!manualMergeReadbackSignatureValid(priorReceipt, signing) ||
      !coreJoinRecordSignatureValid(priorJoin, signing) ||
      !coreJoinRecordSignatureValid(currentJoin, signing)) return false;
  const priorIntent = priorJoin.release_intent;
  const currentIntent = currentJoin.release_intent;
  const canonicalDiffDigest = hostNativeGithubDiffDigest({
    repository: currentIntent?.repository,
    base_commit: currentIntent?.base_commit,
    head_commit: currentIntent?.head_commit,
    tree_sha: currentIntent?.tree_sha,
    changed_files: currentIntent?.changed_files,
  });
  const priorIssuedAt = Date.parse(priorJoin.verdict?.issued_at || "");
  const priorExpiresAt = Date.parse(priorJoin.verdict?.expires_at || "");
  const priorRecordedAt = Date.parse(priorReceipt.recorded_at || "");
  const mergedAt = Date.parse(githubReadback?.merged_at || "");
  const currentIssuedAt = Date.parse(currentJoin.verdict?.issued_at || "");
  const githubFields = [
    "tenant_id", "repository", "pull_request", "merged", "merged_at",
    "head_branch", "base_branch", "base_commit", "head_commit", "merge_commit",
    "main_head_commit", "checks_commit", "required_checks_policy_digest",
  ];
  const priorJoinBeforeReceipt = withoutKeys(priorJoin, new Set([
    "manual_merge_readback_receipt_id",
    "manual_merge_readback_receipt_digest",
  ]));
  return priorJoin.verdict_id === priorReceipt.core_join_verdict_id &&
    priorReceipt.tenant_id === currentJoin.claim?.tenant_id &&
    priorReceipt.work_id === currentJoin.claim?.work_id &&
    priorReceipt.intent_anchor_digest === currentJoin.claim?.intent_anchor_digest &&
    priorReceipt.repository === currentJoin.claim?.repository &&
    priorReceipt.pull_request === githubReadback?.pull_request &&
    priorReceipt.core_join_record_digest === hostNativeDigest(priorJoinBeforeReceipt) &&
    priorReceipt.predecessor?.core_join_record_digest ===
      priorReceipt.core_join_record_digest &&
    priorReceipt.predecessor?.core_join_verdict_id === priorJoin.verdict_id &&
    priorJoin.manual_merge_readback_receipt_id === priorReceipt.receipt_id &&
    priorJoin.manual_merge_readback_receipt_digest === priorReceipt.receipt_digest &&
    priorReceipt.owner_subject_fingerprint &&
    currentIntent?.diff_digest === canonicalDiffDigest &&
    priorIntent?.diff_digest !== canonicalDiffDigest &&
    hostNativeDigest(withoutKeys(priorIntent, new Set([
      "diff_digest", "release_intent_digest",
    ]))) === hostNativeDigest(withoutKeys(currentIntent, new Set([
      "diff_digest", "release_intent_digest",
    ]))) &&
    hostNativeDigest(withoutKeys(priorJoin.claim, new Set([
      "release_intent_digest", "software_closure_digest",
      "software_closure_fresh_until",
    ]))) === hostNativeDigest(withoutKeys(currentJoin.claim, new Set([
      "release_intent_digest", "software_closure_digest",
      "software_closure_fresh_until",
    ]))) &&
    githubFields.every((field) =>
      priorReceipt.github_readback?.[field] === githubReadback?.[field]) &&
    hostNativeDigest(withoutKeys(priorReceipt.github_readback, new Set([
      "readback_digest", "verified_at",
    ]))) === hostNativeDigest(withoutKeys(githubReadback, new Set([
      "readback_digest", "verified_at",
    ]))) &&
    !priorReceipt.refresh_lineage &&
    Number.isFinite(priorIssuedAt) && Number.isFinite(priorExpiresAt) &&
    Number.isFinite(priorRecordedAt) && Number.isFinite(mergedAt) &&
    Number.isFinite(currentIssuedAt) && priorExpiresAt < currentIssuedAt &&
    priorExpiresAt < nowValue &&
    priorIssuedAt <= mergedAt && mergedAt <= priorExpiresAt &&
    priorRecordedAt <= priorExpiresAt && priorRecordedAt <= nowValue;
}

function manualMergeRefreshLineageValid(receipt, state, signing, nowValue) {
  const lineage = receipt?.refresh_lineage;
  if (!lineage) return true;
  const priorReceipt = state.owner_manual_merge_readbacks?.[
    lineage.predecessor_manual_merge_readback_id
  ];
  const priorSuccessor = state.owner_manual_merge_successors?.[
    lineage.predecessor_manual_merge_readback_id
  ];
  const priorJoin = state.core_join_verdicts?.[
    lineage.predecessor_core_join_verdict_id
  ];
  const currentJoin = state.core_join_verdicts?.[
    lineage.successor_core_join_verdict_id
  ];
  const { lineage_digest: lineageDigest, ...unsignedLineage } = lineage || {};
  return lineage.schema_version ===
      "host_native_owner_manual_merge_refresh_lineage_v1" &&
    lineage.predecessor_manual_merge_readback_digest ===
      priorReceipt?.receipt_digest &&
    lineage.predecessor_core_join_verdict_id ===
      priorReceipt?.core_join_verdict_id &&
    lineage.successor_core_join_verdict_id === receipt.core_join_verdict_id &&
    lineage.correction ===
      "legacy_diff_digest_to_host_native_github_diff_digest" &&
    lineage.authorized_successor_action === "render.observe" &&
    lineage.provider_execution === false &&
    lineage.legacy_diff_digest === priorJoin?.release_intent?.diff_digest &&
    lineage.canonical_diff_digest === currentJoin?.release_intent?.diff_digest &&
    lineage.predecessor_release_intent_digest ===
      priorJoin?.release_intent?.release_intent_digest &&
    lineage.successor_release_intent_digest ===
      currentJoin?.release_intent?.release_intent_digest &&
    lineageDigest === hostNativeDigest(unsignedLineage) &&
    legacyManualMergeRefreshBindingValid({
      priorReceipt,
      priorJoin,
      currentJoin,
      githubReadback: receipt.github_readback,
      nowValue,
      signing,
    }) &&
    !priorReceipt?.refresh_lineage &&
    manualMergeReadbackSignatureValid(priorReceipt, signing) &&
    priorSuccessor?.schema_version ===
      "host_native_owner_manual_merge_refresh_successor_v1" &&
    priorSuccessor.manual_merge_readback_id === priorReceipt.receipt_id &&
    priorSuccessor.manual_merge_readback_digest === priorReceipt.receipt_digest &&
    priorSuccessor.refreshed_manual_merge_readback_id === receipt.receipt_id &&
    priorSuccessor.refreshed_manual_merge_readback_digest === receipt.receipt_digest &&
    priorSuccessor.core_join_verdict_id === receipt.core_join_verdict_id;
}

function validateManualMergeObservationDelegationBeforeMutation(
  delegation,
  receipt,
  signing,
) {
  if (
    !delegation || !issuedDelegationIssuanceSignatureValid(delegation, signing) ||
    !sameStrings(delegation.grant?.allowed_actions, ["render.observe"]) ||
    delegation.grant?.budget?.max_total_actions !== 1 ||
    !delegationUsageMatches(delegation, 0) ||
    delegation.grant?.owner_confirmation?.owner_subject_fingerprint !==
      receipt?.owner_subject_fingerprint ||
    delegation.grant?.provider_execution !== false ||
    delegation.grant?.host_policy_override !== false ||
    delegation.grant?.host_policy_must_allow !== true
  ) fail("owner_manual_merge_observation_delegation_invalid");
}

function validateStoredManualMergeObservation(record, state, {
  signing,
  successorUsage,
  nowValue,
} = {}) {
  const ticket = record?.ticket;
  const predecessor = ticket?.predecessor;
  if (ticket?.action?.kind !== "render.observe" ||
      predecessor?.predecessor_type !== "owner_manual_github_merge_readback") {
    return false;
  }
  ensureObservationOnlyActionShape(ticket.action);
  const receiptId = String(predecessor.manual_merge_readback_id || "");
  const receipt = state.owner_manual_merge_readbacks?.[receiptId];
  const successor = state.owner_manual_merge_successors?.[receiptId];
  const delegation = state.delegations?.[ticket.delegation_id];
  const coreJoin = state.core_join_verdicts?.[ticket.core_join_verdict_id];
  const github = receipt?.github_readback;
  const sourceAction = predecessor.source_action;
  const releaseIntent = coreJoin?.release_intent;
  const joinStateValid = successorUsage === 0
    ? coreJoin?.state === "active" && coreJoin?.uses === 0
    : coreJoin?.state === "consumed" && coreJoin?.uses === 1 &&
      coreJoin?.consumed_by_ticket_id === ticket.ticket_id;
  if (
    !manualMergeReadbackSignatureValid(receipt, signing) ||
    !manualMergeRefreshLineageValid(receipt, state, signing, nowValue) ||
    !safeEqual(ticket.signature, ticketSignature(signing, ticket)) ||
    !delegation || !issuedDelegationIssuanceSignatureValid(delegation, signing) ||
    !sameStrings(delegation.grant?.allowed_actions, ["render.observe"]) ||
    delegation.grant?.budget?.max_total_actions !== 1 ||
    !delegationUsageMatches(delegation, successorUsage) ||
    delegation.grant?.owner_confirmation?.owner_subject_fingerprint !==
      receipt.owner_subject_fingerprint ||
    successor?.ticket_id !== ticket.ticket_id ||
    successor?.ticket_digest !== hostNativeDigest(ticket) ||
    successor?.manual_merge_readback_digest !== receipt.receipt_digest ||
    !joinStateValid || coreJoin?.verdict_id !== receipt.core_join_verdict_id ||
    coreJoin?.manual_merge_readback_receipt_id !== receiptId ||
    coreJoin?.manual_merge_readback_receipt_digest !== receipt.receipt_digest ||
    coreJoin?.claim_digest !== ticket.core_join_verdict_digest ||
    hostNativeDigest(coreJoin?.claim) !== coreJoin?.claim_digest ||
    ticket.tenant_id !== receipt.tenant_id || ticket.work_id !== receipt.work_id ||
    ticket.intent_anchor_digest !== receipt.intent_anchor_digest ||
    ticket.repository !== receipt.repository ||
    ticket.evidence_digest !== receipt.receipt_digest ||
    ticket.predecessor_chain_digest !== hostNativeDigest(predecessor) ||
    predecessor.manual_merge_readback_digest !== receipt.receipt_digest ||
    predecessor.source_readback_digest !== github?.readback_digest ||
    predecessor.source_action_digest !== hostNativeDigest(sourceAction) ||
    predecessor.result_commit !== github?.merge_commit ||
    predecessor.source_required_checks_policy_digest !==
      github?.required_checks_policy_digest ||
    sourceAction?.kind !== "github.merge" || sourceAction?.repository !== ticket.repository ||
    sourceAction?.pull_request !== receipt.pull_request ||
    sourceAction?.head_branch !== github?.head_branch ||
    sourceAction?.base_branch !== github?.base_branch ||
    sourceAction?.head_commit !== github?.head_commit ||
    sourceAction?.checks_commit !== github?.checks_commit ||
    sourceAction?.expected_base_commit !== github?.base_commit ||
    sourceAction?.provider_execution !== false ||
    ticket.action.target_commit !== github?.merge_commit ||
    ticket.action.branch !== github?.base_branch ||
    ticket.release_intent_digest !== releaseIntent?.release_intent_digest ||
    hostNativeDigest((({ release_intent_digest: _digest, ...rest }) => rest)(releaseIntent || {})) !==
      releaseIntent?.release_intent_digest ||
    releaseIntent?.base_commit !== github?.base_commit ||
    releaseIntent?.head_commit !== github?.head_commit ||
    ticket.release_manifest_digest !== ticket.release_manifest_binding?.manifest_digest ||
    ticket.release_manifest_binding?.base_commit !== releaseIntent?.base_commit ||
    ticket.release_manifest_binding?.head_commit !== releaseIntent?.head_commit ||
    ticket.release_manifest_binding?.tree_sha !== releaseIntent?.tree_sha ||
    ticket.release_manifest_binding?.diff_digest !== releaseIntent?.diff_digest ||
    !Array.isArray(ticket.release_manifest_binding?.changed_files) ||
    !Array.isArray(releaseIntent?.changed_files) ||
    !sameStrings(ticket.release_manifest_binding.changed_files, releaseIntent.changed_files) ||
    ticket.release_manifest_binding?.verification?.checks_commit !==
      releaseIntent?.verification?.checks_commit ||
    ticket.release_manifest_binding?.verification?.checks_digest !==
      releaseIntent?.verification?.checks_digest
  ) fail("owner_manual_merge_observation_binding_invalid");
  return true;
}

function validateStoredObserveDelegationContinuation(record, state, {
  nowValue,
  signing,
  successorUsage,
} = {}) {
  const ticket = record?.ticket;
  if (ticket?.action?.kind !== "render.observe") return;
  if (ticket?.predecessor?.predecessor_type ===
      "owner_manual_github_merge_readback") {
    validateStoredManualMergeObservation(record, state, {
      signing,
      successorUsage,
      nowValue,
    });
    return;
  }
  const parent = state.tickets[String(ticket.action.parent_release_ticket_id || "")];
  const parentTicket = parent?.ticket;
  const crossDelegation = parentTicket?.delegation_id !== ticket.delegation_id;
  const continuation = ticket.predecessor?.delegation_continuation;
  if (!crossDelegation) {
    if (continuation) fail("delegation_continuation_invalid");
    return;
  }
  ensureObservationOnlyActionShape(ticket.action);
  const parentDelegation = state.delegations[String(parentTicket?.delegation_id || "")];
  const successorDelegation = state.delegations[String(ticket.delegation_id || "")];
  const parentTicketDigest = parentTicket && hostNativeDigest(parentTicket);
  const sourceAction = parentTicket?.action;
  const parentBinding = parentTicket?.release_manifest_binding;
  const parentResolution = parentTicket?.release_join_resolution;
  const coreJoin = state.core_join_verdicts[String(parentTicket?.core_join_verdict_id || "")];
  const sourceRequiredChecksPolicyDigest = coreJoin?.claim?.required_checks_policy_digest;
  const continuationIssuedAt = Date.parse(continuation?.issued_at || "");
  const authorityTime = successorUsage === 0 ? nowValue : continuationIssuedAt;
  if (
    !continuation || !parent ||
    !Number.isFinite(continuationIssuedAt) || continuationIssuedAt > nowValue ||
    continuation.issued_at !== ticket.issued_at ||
    !["completed", "reconciled"].includes(parent.state) ||
    (parent.outcome !== "success" && parent.observed_outcome !== "success") ||
    !parentTicket || !safeEqual(parentTicket.signature, ticketSignature(signing, parentTicket)) ||
    !safeEqual(ticket.signature, ticketSignature(signing, ticket)) ||
    parentTicket.tenant_id !== ticket.tenant_id ||
    parentTicket.work_id !== ticket.work_id ||
    parentTicket.intent_anchor_digest !== ticket.intent_anchor_digest ||
    parentTicket.repository !== ticket.repository ||
    parentTicket.host_kind !== ticket.host_kind ||
    parentTicket.host_session_fingerprint !== ticket.host_session_fingerprint ||
    ticket.provider_execution !== false || ticket.action.provider_execution !== false ||
    ticket.predecessor_chain_digest !== hostNativeDigest(ticket.predecessor) ||
    ticket.predecessor.ticket_id !== parentTicket.ticket_id ||
    ticket.predecessor.ticket_digest !== parentTicketDigest ||
    ticket.predecessor.source_action_digest !== hostNativeDigest(sourceAction) ||
    ticket.action.parent_release_ticket_digest !== parentTicketDigest ||
    ticket.action.release_manifest_digest !== parentTicket.release_manifest_digest ||
    ticket.release_manifest_digest !== parentTicket.release_manifest_digest ||
    !ticket.release_manifest_binding || !parentBinding ||
    hostNativeDigest(ticket.release_manifest_binding) !== hostNativeDigest(parentBinding) ||
    parentBinding?.manifest_digest !== parentTicket.release_manifest_digest ||
    parentBinding?.repository !== ticket.repository ||
    ticket.release_intent_digest !== parentTicket.release_intent_digest ||
    ticket.evidence_digest !== parentTicket.evidence_digest ||
    ticket.predecessor.source_evidence_digest !== parentTicket.evidence_digest ||
    ticket.core_join_verdict_id !== parentTicket.core_join_verdict_id ||
    ticket.core_join_verdict_digest !== parentTicket.core_join_verdict_digest ||
    ticket.release_join_resolution_digest !== parentTicket.release_join_resolution_digest ||
    !ticket.release_join_resolution || !parentResolution ||
    hostNativeDigest(ticket.release_join_resolution) !== hostNativeDigest(parentResolution) ||
    parentTicket.release_join_resolution_digest !== hostNativeDigest(parentResolution) ||
    parentResolution?.evidence_digest !== parentTicket.evidence_digest ||
    parentResolution?.tenant_id !== ticket.tenant_id ||
    parentResolution?.work_id !== ticket.work_id ||
    parentResolution?.intent_anchor_digest !== ticket.intent_anchor_digest ||
    parentResolution?.repository !== ticket.repository ||
    !coreJoin || coreJoin.state !== "consumed" || coreJoin.uses !== 1 ||
    coreJoin.verdict_id !== parentTicket.core_join_verdict_id ||
    coreJoin.consumed_by_ticket_id !== parentTicket.ticket_id ||
    coreJoin.claim_digest !== parentTicket.core_join_verdict_digest ||
    hostNativeDigest(coreJoin.claim) !== coreJoin.claim_digest ||
    coreJoin.claim?.tenant_id !== ticket.tenant_id ||
    coreJoin.claim?.work_id !== ticket.work_id ||
    coreJoin.claim?.intent_anchor_digest !== ticket.intent_anchor_digest ||
    coreJoin.claim?.repository !== ticket.repository ||
    coreJoin.claim?.release_intent_digest !== ticket.release_intent_digest ||
    !SHA256.test(String(sourceRequiredChecksPolicyDigest || "")) ||
    ticket.predecessor.source_required_checks_policy_digest !==
      sourceRequiredChecksPolicyDigest
  ) {
    fail("delegation_continuation_invalid");
  }
  ensureExpiredObserveContinuationDelegations({
    parentDelegation,
    successorDelegation,
    parentTicket,
    tenantId: ticket.tenant_id,
    workId: ticket.work_id,
    intentAnchorDigest: ticket.intent_anchor_digest,
    repository: ticket.repository,
    hostKind: ticket.host_kind,
    hostSessionFingerprint: ticket.host_session_fingerprint,
    nowValue: authorityTime,
    signing,
    successorUsage,
  });
  const expectedUnsigned = delegationContinuationUnsigned({
    parentDelegation,
    successorDelegation,
    parentTicket,
    parentTicketDigest,
    parentFinalizeAuthorizationDigest:
      ticket.predecessor.finalize_authorization_digest,
    sourceActionDigest: ticket.predecessor.source_action_digest,
    sourceRequiredChecksPolicyDigest,
    hostKind: ticket.host_kind,
    hostSessionFingerprint: ticket.host_session_fingerprint,
    issuedAt: continuation.issued_at,
  });
  const { signature, continuation_digest, ...actualUnsigned } = continuation;
  if (
    hostNativeDigest(expectedUnsigned) !== hostNativeDigest(actualUnsigned) ||
    hostNativeDigest(actualUnsigned) !== continuation_digest ||
    !safeEqual(
      signature,
      hmac("hndc", signing, canonical({ ...actualUnsigned, continuation_digest })),
    )
  ) {
    fail("delegation_continuation_invalid");
  }
}

function verifyReadbackDigest(record) {
  const github = record?.github;
  const services = record?.services;
  if (!record || record.trusted !== true || record.provider_execution !== false || !github || !Array.isArray(services)) {
    fail("trusted_readback_invalid");
  }
  const githubUnsigned = { ...github };
  delete githubUnsigned.readback_digest;
  if (github.readback_digest !== hostNativeDigest(githubUnsigned)) fail("trusted_readback_github_digest_mismatch");
  for (const service of services) {
    const unsigned = { ...service };
    delete unsigned.readback_digest;
    if (service.readback_digest !== hostNativeDigest(unsigned)) fail("trusted_readback_service_mismatch");
  }
}

function verifiedFinalizeAuthorization(record, {
  signing,
  nowValue,
  tenantId,
  workId,
  repository,
  targetCommit,
} = {}) {
  const receipt = record?.finalize_authorization;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("predecessor_finalize_authorization_required");
  }
  const { signature, authorization_digest, ...unsigned } = receipt;
  const signed = { ...unsigned, authorization_digest };
  const issuedAt = Date.parse(receipt.issued_at || "");
  const expiresAt = Date.parse(receipt.expires_at || "");
  const ticket = record?.ticket;
  if (
    !ticket || !safeEqual(ticket.signature, ticketSignature(signing, ticket)) ||
    receipt.schema_version !== "host_native_finalize_authorization_v1" ||
    receipt.trusted !== true || receipt.allowed !== true ||
    receipt.decision !== "ALLOW_FINALIZE" ||
    receipt.result_commit_verified !== true ||
    receipt.tenant_id !== tenantId || receipt.work_id !== workId ||
    receipt.repository !== repository || receipt.target_commit !== targetCommit ||
    receipt.action_ticket_id !== ticket.ticket_id ||
    receipt.decision_id !== ticket.ticket_id ||
    receipt.action_ticket_digest !== hostNativeDigest(ticket) ||
    receipt.release_manifest_digest !== ticket.release_manifest_digest ||
    receipt.release_intent_digest !== ticket.release_intent_digest ||
    receipt.core_join_verdict_id !== ticket.core_join_verdict_id ||
    receipt.core_join_verdict_digest !== ticket.core_join_verdict_digest ||
    receipt.core_join_resolution_digest !== ticket.release_join_resolution_digest ||
    receipt.predecessor_chain_digest !== (ticket.predecessor_chain_digest || null) ||
    receipt.evidence_digest !== ticket.evidence_digest ||
    receipt.host_kind !== ticket.host_kind ||
    receipt.host_session_fingerprint !== ticket.host_session_fingerprint ||
    receipt.host_policy_override !== false || receipt.host_policy_must_allow !== true ||
    receipt.provider_execution !== false ||
    !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
    issuedAt > nowValue || expiresAt <= nowValue || issuedAt >= expiresAt ||
    !/^[a-f0-9]{64}$/.test(String(authorization_digest || "")) ||
    hostNativeDigest(unsigned) !== authorization_digest ||
    !safeEqual(signature, hmac("hnf", signing, canonical(signed)))
  ) {
    fail("predecessor_finalize_authorization_invalid");
  }
  return receipt;
}

export function createHostNativeGovernance({
  store: suppliedStore,
  signingSecret,
  closureAttestationSigningSecret,
  externalReadbackVerifier = null,
  ownerManualMergeReadbackVerifier = null,
  releaseJoinVerdictResolver = null,
  renderServiceOriginResolver = null,
  requiredChecksPolicyResolver = null,
  unreservedEffectVerifier = null,
  bootstrapReleaseExceptionStore = null,
  bootstrapDeadlockVerdictResolver = null,
  now = () => Date.now(),
  idFactory = () => crypto.randomBytes(16).toString("hex"),
  ticketTtlMs = DEFAULT_TICKET_TTL_MS,
  reservationLeaseMs = DEFAULT_RESERVATION_LEASE_MS,
  coreJoinTtlMs = DEFAULT_CORE_JOIN_TTL_MS,
  standingReleaseAutomationEnabled = false,
  standingReleaseEmergencyStop = false,
  standingReleaseBaseProtectionResolver = null,
  semanticScopeGuard = null,
  semanticScopeMode = "OFF",
  semanticScopeContextResolver = null,
} = {}) {
  const store = requireStore(suppliedStore);
  const signing = String(signingSecret || "");
  const closureSecret = String(closureAttestationSigningSecret || "");
  if (signing.length < 32) fail("host_native_signing_secret_invalid");
  if (closureSecret.length < 32) fail("closure_attestation_signing_secret_invalid");
  const ticketTtl = Math.max(1_000, Math.min(60 * 60_000, Number(ticketTtlMs) || DEFAULT_TICKET_TTL_MS));
  const leaseMs = Math.max(1_000, Math.min(60 * 60_000, Number(reservationLeaseMs) || DEFAULT_RESERVATION_LEASE_MS));
  const coreJoinTtl = Math.max(1_000, Math.min(60 * 60_000, Number(coreJoinTtlMs) || DEFAULT_CORE_JOIN_TTL_MS));
  const configuredSemanticScopeMode = String(semanticScopeMode || "OFF").toUpperCase();
  if (!["OFF", "SHADOW", "ENFORCE"].includes(configuredSemanticScopeMode)) {
    fail("semantic_scope_mode_invalid");
  }
  if (configuredSemanticScopeMode !== "OFF" && (!semanticScopeGuard
    || typeof semanticScopeGuard.check !== "function")) fail("semantic_scope_guard_required");
  if (semanticScopeContextResolver !== null && typeof semanticScopeContextResolver !== "function") {
    fail("semantic_scope_context_resolver_invalid");
  }
  const actionEffect = (kind) => {
    if (["render.observe"].includes(kind)) return "read";
    if (["github.merge", "render.deploy", "render.rollback"].includes(kind)) return "deploy";
    if (["git.commit", "git.push.branch", "git.push.protected", "github.draft_pr", "github.ready"].includes(kind)) return "write";
    return "read";
  };
  const actionRisk = (kind) => {
    if (["github.merge", "render.deploy", "render.rollback"].includes(kind)) return "CRITICAL";
    if (["git.push.protected", "git.push.branch"].includes(kind)) return "HIGH";
    if (["git.commit", "github.draft_pr", "github.ready"].includes(kind)) return "MEDIUM";
    return "LOW";
  };
  const semanticScopeUnavailableDecision = ({ delegation, tenantId, hostKind,
    hostSessionFingerprint, riskTier, authorityReservationRef = null } = {}) => {
    const unsigned = {
      schema_version: "semantic_scope_decision_v1",
      action: "HOLD",
      reason_codes: ["SEMANTIC_SCOPE_CONTEXT_UNAVAILABLE"],
      detected_scope: ["EFFECT_DRIFT"],
      expected_scope: null,
      scope_delta: null,
      policy_refs: ["host_native_delegation_v1", "host_native_action_ticket_v1"],
      redaction_plan: null,
      evidence_refs: [],
      binding: {
        tenant_id: tenantId,
        work_id: delegation.grant.work_id,
        agent_id: `${hostKind}:${hostSessionFingerprint}`,
        agent_revision: null,
        intent_digest: delegation.grant.intent_anchor_digest,
        entity360_snapshot_ref: null,
        as_of_valid_time: null,
        as_of_knowledge_time: null,
        authority_reservation_ref: authorityReservationRef,
        policy_revision: "host_native_semantic_scope_policy_v1",
        risk_tier: riskTier,
      },
      enforcement: configuredSemanticScopeMode,
      execution_authorized: false,
      authority: "universal_core",
    };
    return Object.freeze({ ...unsigned, decision_digest: hostNativeDigest(unsigned) });
  };
  const semanticScopeDecision = ({ delegation, action, tenantId, hostKind, hostSessionFingerprint,
    phase, previousScopeState = null, authorityReservationRef = null } = {}) => {
    if (configuredSemanticScopeMode === "OFF") return null;
    const branch = actionBranch(action) || action.service_id || action.target_commit || "root";
    const effect = actionEffect(action.kind);
    let entity360 = null;
    try {
      entity360 = semanticScopeContextResolver?.({ tenant_id: tenantId,
        work_id: delegation.grant.work_id, action: clone(action), phase }) || null;
    } catch {
      entity360 = null;
    }
    const riskTier = actionRisk(action.kind);
    try {
      return semanticScopeGuard.check({
        tenant_id: tenantId,
        work_id: delegation.grant.work_id,
        agent_id: `${hostKind}:${hostSessionFingerprint}`,
        agent_revision: delegation.grant.revision ? String(delegation.grant.revision) : null,
        intent_digest: delegation.grant.intent_anchor_digest,
        entity360_snapshot_ref: entity360?.entity360_snapshot_ref || null,
        as_of_valid_time: entity360?.as_of_valid_time || null,
        as_of_knowledge_time: entity360?.as_of_knowledge_time || null,
        requested_capability: action.kind,
        requested_effect: effect,
        tool_id: "host_native_governance",
        tool_operation: phase,
        target: `${delegation.grant.repository}:${branch}`,
        arguments_digest: hostNativeDigest(action),
        data_scope: [tenantId],
        write_scope: effect === "read" ? [] : [action.kind],
        capability_passport: delegation.grant.allowed_actions,
        effect_ceiling: [...new Set(delegation.grant.allowed_actions.map(actionEffect))].sort(),
        expected_scope: {
          targets: delegation.grant.allowed_branches.map((allowedBranch) =>
            `${delegation.grant.repository}:${allowedBranch}`), tools: ["host_native_governance"],
          data_scope: [tenantId], write_scope: effect === "read" ? [] : delegation.grant.allowed_actions,
          egress_classes: [],
        },
        authority_reservation_ref: authorityReservationRef,
        policy_revision: entity360?.policy_revision || "host_native_semantic_scope_policy_v1",
        policy_refs: ["host_native_delegation_v1", "host_native_action_ticket_v1"],
        risk_tier: riskTier, previous_scope_state: previousScopeState,
        evidence_refs: entity360?.evidence_refs || [], data_egress: false,
        entity360_snapshot_stale: entity360?.stale === true,
        semantic_ambiguous: !entity360?.entity360_snapshot_ref,
      });
    } catch {
      return semanticScopeUnavailableDecision({ delegation, tenantId, hostKind,
        hostSessionFingerprint, riskTier, authorityReservationRef });
    }
  };
  const semanticScopeEnforcedDenial = (decision) => configuredSemanticScopeMode === "ENFORCE"
    && ["BLOCK", "HOLD"].includes(decision?.action);
  const assertSoftwareConsumerFresh = (trusted = {}) => {
    if (trusted.software_closure_fresh_until === undefined) return;
    const freshUntil = Date.parse(trusted.software_closure_fresh_until || "");
    if (!Number.isFinite(freshUntil) || nowMillis(now) > freshUntil) {
      fail("software_cognition_closure_expired_during_consumption");
    }
  };
  const standingReleaseRuntimeEnabled = () => (
    typeof standingReleaseAutomationEnabled === "function"
      ? standingReleaseAutomationEnabled() === true
      : standingReleaseAutomationEnabled === true
  );
  const standingReleaseStopped = () => (
    typeof standingReleaseEmergencyStop === "function"
      ? standingReleaseEmergencyStop() === true
      : standingReleaseEmergencyStop === true
  );

  function makeId(prefix, seed) {
    const suffix = String(idFactory?.() || hostNativeDigest(seed).slice(0, 32)).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
    return `${prefix}_${suffix || hostNativeDigest(seed).slice(0, 32)}`;
  }

  function signActionTicketLifecycleRecord(record) {
    const unsigned = actionTicketLifecycleUnsigned(record);
    record.lifecycle_digest = hostNativeDigest(unsigned);
    record.lifecycle_signature = hmac(
      "hnl",
      signing,
      canonical({ ...unsigned, lifecycle_digest: record.lifecycle_digest }),
    );
    return record;
  }

  function verifyActionTicketLifecycleRecord(record) {
    const unsigned = actionTicketLifecycleUnsigned(record);
    if (
      record?.lifecycle_digest !== hostNativeDigest(unsigned) ||
      !safeEqual(
        record?.lifecycle_signature,
        hmac(
          "hnl",
          signing,
          canonical({ ...unsigned, lifecycle_digest: record?.lifecycle_digest }),
        ),
      )
    ) fail("action_ticket_lifecycle_invalid");
    return record;
  }

  function readDelegationRecord(tenantId, delegationId) {
    const record = store.readState().delegations[String(delegationId || "")];
    if (!record) fail("delegation_not_found");
    if (record.grant.tenant_id !== tenantId) fail("cross_tenant_delegation_denied");
    return clone(record);
  }

  function readTicketRecord(tenantId, ticketId) {
    const record = store.readState().tickets[String(ticketId || "")];
    if (!record) fail("action_ticket_not_found");
    if (record.ticket.tenant_id !== tenantId) fail("cross_tenant_action_ticket_denied");
    return clone(record);
  }

  function signStandingReleaseRunRecord(run, {
    transition,
    dttRequestBindingDigest,
    dttSessionFingerprint,
    intentBinding,
  } = {}) {
    const runDigest = hostNativeDigest(run);
    const unsigned = {
      schema_version: "standing_release_run_record_v1",
      tenant_id: run.tenant_id,
      run_id: run.run_id,
      run_digest: runDigest,
      run,
      transition: text(transition, "standing_release_run_transition_invalid", 80),
      dtt_request_binding_digest: digest(dttRequestBindingDigest),
      dtt_session_fingerprint: text(
        dttSessionFingerprint,
        "standing_release_run_session_invalid",
        160,
      ).toLowerCase(),
      intent_binding_digest: digest(intentBinding?.binding_digest),
      intent_work_version: positiveInteger(
        intentBinding?.current_version,
        "standing_release_intent_binding_invalid",
      ),
      intent_verified_at: text(
        intentBinding?.verified_at,
        "standing_release_intent_binding_invalid",
        80,
      ),
      provider_execution: false,
    };
    return {
      ...unsigned,
      signature: hmac("srr", signing, canonical(unsigned)),
    };
  }

  function verifiedStandingReleaseRunRecord(record) {
    const { authority_state: _derivedAuthorityState, signature, ...unsigned } = record || {};
    if (
      unsigned.schema_version !== "standing_release_run_record_v1" ||
      unsigned.provider_execution !== false ||
      unsigned.tenant_id !== unsigned.run?.tenant_id ||
      unsigned.run_id !== unsigned.run?.run_id ||
      unsigned.run_digest !== hostNativeDigest(unsigned.run) ||
      !/^[a-f0-9]{64}$/.test(String(unsigned.dtt_request_binding_digest || "")) ||
      unsigned.dtt_session_fingerprint !== unsigned.run?.host_session_fingerprint ||
      !/^[a-f0-9]{64}$/.test(String(unsigned.intent_binding_digest || "")) ||
      !Number.isSafeInteger(unsigned.intent_work_version) ||
      !Number.isFinite(Date.parse(unsigned.intent_verified_at || "")) ||
      !safeEqual(signature, hmac("srr", signing, canonical(unsigned)))
    ) fail("standing_release_run_record_invalid");
    return clone(unsigned.run);
  }

  function readStandingReleaseRunRecord(state, tenantId, runId) {
    const record = state.standing_release_runs?.[String(runId || "")];
    if (!record) fail("standing_release_run_not_found");
    if (record.tenant_id !== tenantId) fail("standing_release_run_cross_tenant_denied");
    verifiedStandingReleaseRunRecord(record);
    return record;
  }

  function currentStandingReleaseRunReplay(state, cached, tenantId) {
    const runId = cached?.run_id || cached?.run?.run_id;
    return clone(readStandingReleaseRunRecord(state, tenantId, runId));
  }

  function standingReleaseRunForDelegation(state, delegationId) {
    const matches = Object.values(state.standing_release_runs || {}).filter((record) =>
      record?.run?.delegation_id === delegationId);
    if (matches.length > 1) fail("standing_release_run_store_conflict");
    if (!matches.length) return null;
    verifiedStandingReleaseRunRecord(matches[0]);
    return matches[0];
  }

  function ensureStandingReleaseRunReservation(state, ticketRecord, input, nowValue) {
    const standingRunRecord = standingReleaseRunForDelegation(
      state,
      ticketRecord?.ticket?.delegation_id,
    );
    if (!standingRunRecord) {
      const delegation = state.delegations?.[ticketRecord?.ticket?.delegation_id];
      if (delegation?.grant?.standing_release_binding?.horizontal_runner_required === true) {
        fail("standing_release_run_required");
      }
      return null;
    }
    if (ticketRecord.state !== "issued") {
      verifyActionTicketLifecycleRecord(ticketRecord);
    }
    const standingRun = verifiedStandingReleaseRunRecord(standingRunRecord);
    ensureStandingReleaseRunAuthority(state, standingRun, nowValue);
    if (
      String(input.standing_release_run_id || "") !== standingRun.run_id ||
      input.standing_release_run_version !== standingRun.version ||
      !/^[a-f0-9]{64}$/.test(String(input.dtt_request_binding_digest || "")) ||
      standingRun.state !== "ACTION_IN_PROGRESS" ||
      standingRun.active_action?.ticket_id !== ticketRecord.ticket.ticket_id ||
      standingRun.active_action?.action_digest !==
        hostNativeDigest(ticketRecord.ticket.action)
    ) fail("standing_release_run_ticket_not_bound");
    return standingRun;
  }

  function standingMergeFreshResolutionInput(state, ticketRecord, nowValue) {
    const ticket = ticketRecord?.ticket;
    const delegation = state.delegations?.[ticket?.delegation_id];
    if (
      !delegation?.grant?.standing_release_binding ||
      ticket?.action?.kind !== "github.merge"
    ) return null;
    if (
      typeof releaseJoinVerdictResolver !== "function" ||
      releaseJoinVerdictResolver.trusted !== true ||
      releaseJoinVerdictResolver.standing_pre_merge_readback !== true
    ) fail("standing_release_pre_merge_readback_unavailable");
    if (
      ticketRecord.state !== "issued" || ticketRecord.uses !== 0 ||
      !governance.verifyActionTicket(ticket) ||
      ticket.release_join_resolution_digest !==
        hostNativeDigest(ticket.release_join_resolution)
    ) fail("standing_release_pre_merge_ticket_invalid");
    const coreJoin = state.core_join_verdicts?.[ticket.core_join_verdict_id];
    const requiredChecksPolicyDigest = coreJoin?.claim?.required_checks_policy_digest;
    if (
      !coreJoin || coreJoin.state !== "active" || coreJoin.uses !== 0 ||
      coreJoin.authorized_ticket_id !== ticket.ticket_id ||
      coreJoin.claim_digest !== ticket.core_join_verdict_digest ||
      coreJoin.claim?.release_intent_digest !== ticket.release_intent_digest ||
      !governance.verifyCoreJoinVerdict(coreJoin) ||
      !SHA256.test(String(requiredChecksPolicyDigest || ""))
    ) fail("standing_release_pre_merge_join_invalid");
    const binding = ticket.release_manifest_binding;
    const source = ticket.release_join_resolution?.source_attestation;
    const services = binding?.delivery?.services;
    if (
      !binding || !source || !Array.isArray(services) || services.length < 1 ||
      source.repository !== ticket.repository ||
      source.pull_request !== ticket.action.pull_request ||
      source.base_commit !== ticket.action.expected_base_commit ||
      source.head_commit !== ticket.action.head_commit ||
      source.head_commit !== ticket.action.checks_commit ||
      source.attestation_digest !== hostNativeDigest((({ attestation_digest: _digest, ...unsigned }) => unsigned)(source))
    ) fail("standing_release_pre_merge_ticket_invalid");
    return {
      request: {
        core_join_verified: true,
        core_join_issued_at: coreJoin.verdict.issued_at,
        core_join_expires_at: coreJoin.verdict.expires_at,
        verdict_id: coreJoin.verdict_id,
        tenant_id: ticket.tenant_id,
        work_id: ticket.work_id,
        intent_anchor_digest: ticket.intent_anchor_digest,
        repository: ticket.repository,
        checks_commit: binding.verification.checks_commit,
        required_checks: binding.verification.required_checks,
        required_checks_policy_digest: requiredChecksPolicyDigest,
        evidence_digest: ticket.evidence_digest,
        source_evidence: {
          base_commit: source.base_commit,
          head_commit: source.head_commit,
          tree_sha: source.tree_sha,
          diff_digest: source.diff_digest,
          changed_files: source.changed_files,
        },
        delivery_services: services.map((service) => ({
          service_id: service.service_id,
          environment: service.environment,
          origin: service.origin,
          expected_previous_commit: service.expected_previous_commit,
          health_contract_digest: service.health_contract_digest,
        })),
        rollback: binding.rollback,
        action: ticket.action,
        provider_execution: false,
      },
      ticket_digest: hostNativeDigest(ticket),
      core_join_claim_digest: coreJoin.claim_digest,
      source_attestation_digest: source.attestation_digest,
      now_value: nowValue,
    };
  }

  async function requireFreshStandingMergeReadback(state, ticketRecord, nowValue) {
    const pending = standingMergeFreshResolutionInput(state, ticketRecord, nowValue);
    if (!pending) return null;
    let fresh;
    try {
      fresh = await releaseJoinVerdictResolver(pending.request);
    } catch (cause) {
      const code = String(cause?.message || "standing_release_pre_merge_readback_unavailable");
      if (
        /^(release_join_verdict_pre_merge_|release_join_verdict_pull_request_|required_checks_|trusted_readback_|workflow_|check_app_)/.test(code)
      ) fail(code);
      fail("standing_release_pre_merge_readback_unavailable");
    }
    const readback = fresh?.pre_merge_readback;
    const verifiedAt = Date.parse(readback?.verified_at || "");
    if (
      fresh?.trusted !== true || fresh?.allowed !== true ||
      fresh?.provider_execution !== false ||
      fresh.verdict_id !== pending.request.verdict_id ||
      fresh.tenant_id !== pending.request.tenant_id ||
      fresh.work_id !== pending.request.work_id ||
      fresh.intent_anchor_digest !== pending.request.intent_anchor_digest ||
      fresh.repository !== pending.request.repository ||
      fresh.checks_commit !== pending.request.checks_commit ||
      fresh.required_checks_policy_digest !==
        pending.request.required_checks_policy_digest ||
      fresh.source_attestation?.attestation_digest !==
        pending.source_attestation_digest ||
      readback?.schema_version !== "host_native_pre_merge_readback_v1" ||
      readback?.trusted !== true || readback?.provider_execution !== false ||
      readback.repository !== pending.request.repository ||
      readback.base_branch !== pending.request.action.base_branch ||
      readback.base_commit !== pending.request.action.expected_base_commit ||
      readback.head_branch !== pending.request.action.head_branch ||
      readback.head_commit !== pending.request.action.head_commit ||
      readback.pull_request !== pending.request.action.pull_request ||
      readback.required_checks_policy_digest !==
        pending.request.required_checks_policy_digest ||
      fresh.pre_merge_readback_digest !== hostNativeDigest(readback) ||
      !Number.isFinite(verifiedAt) || verifiedAt > nowValue + 30_000 ||
      verifiedAt < nowValue - 30_000
    ) fail("standing_release_pre_merge_readback_invalid");
    return {
      ticket_digest: pending.ticket_digest,
      core_join_claim_digest: pending.core_join_claim_digest,
      pre_merge_readback_digest: fresh.pre_merge_readback_digest,
    };
  }

  function denyHorizontalRunGenericLifecycle(state, ticketRecord) {
    const delegation = state.delegations?.[ticketRecord?.ticket?.delegation_id];
    if (
      delegation?.grant?.standing_release_binding?.horizontal_runner_required === true ||
      standingReleaseRunForDelegation(state, ticketRecord?.ticket?.delegation_id)
    ) fail("standing_release_run_reservation_route_required");
  }

  function standingReleaseOptions(nowValue = nowMillis(now)) {
    return {
      now: nowValue,
      runtimeEnabled: standingReleaseRuntimeEnabled(),
      emergencyStop: standingReleaseStopped(),
    };
  }

  function ensureStandingReleaseDelegationActive(state, delegation, nowValue = nowMillis(now)) {
    if (!delegation?.grant?.standing_release_binding) return;
    if (!standingReleaseBindingActive(state, delegation, standingReleaseOptions(nowValue))) {
      fail("standing_release_authority_inactive");
    }
    const mandate = state.standing_release_mandates?.[
      delegation.grant.standing_release_binding.mandate_id
    ];
    if (!governance?.verifyStandingReleaseMandate?.(mandate)) {
      fail("standing_release_mandate_signature_invalid");
    }
  }

  function ensureStandingReleaseRunBinding(state, run) {
    const delegation = state.delegations?.[run?.delegation_id];
    if (
      !delegation || delegation.grant?.tenant_id !== run?.tenant_id ||
      !(
        issuedDelegationIssuanceSignatureValid(delegation, signing) ||
        governance?.verifyDelegation?.(delegation) === true
      )
    ) {
      fail("standing_release_run_delegation_invalid");
    }
    const binding = delegation.grant.standing_release_binding;
    const mandate = state.standing_release_mandates?.[binding?.mandate_id];
    const sortedServices = (values) => [...(values || [])]
      .map((service) => ({
        service_id: service.service_id,
        environment: service.environment,
        health_contract_digest: service.health_contract_digest,
      }))
      .sort((left, right) => `${left.service_id}\u0000${left.environment}`.localeCompare(
        `${right.service_id}\u0000${right.environment}`,
      ));
    if (
      !mandate || !governance.verifyStandingReleaseMandate(mandate) ||
      run.work_id !== delegation.grant.work_id ||
      run.intent_anchor_digest !== delegation.grant.intent_anchor_digest ||
      run.repository !== delegation.grant.repository ||
      run.host_kind !== binding.host_kind ||
      run.host_session_fingerprint !== binding.host_session_fingerprint ||
      run.mandate_id !== binding.mandate_id ||
      run.mandate_digest !== binding.mandate_digest ||
      run.mandate_revision !== binding.revision ||
      run.revocation_epoch !== binding.revocation_epoch ||
      run.max_repair_attempts !== binding.max_repair_attempts ||
      run.base_branch !== mandate.mandate.base_branch ||
      run.delivery_branch !== binding.delivery_branch ||
      run.change_cone?.base_commit !== binding.base_commit ||
      !sameStrings(run.change_cone?.changed_files || [], binding.changed_files || []) ||
      hostNativeDigest(sortedServices(run.services)) !==
        hostNativeDigest(sortedServices(binding.induced_services))
    ) fail("standing_release_run_authority_drift");
    return delegation;
  }

  function ensureStandingReleaseRunAuthority(
    state,
    run,
    nowValue = nowMillis(now),
    {
      allowCompletedRenderObservation = false,
      allowCompletedRun = false,
    } = {},
  ) {
    const delegation = ensureStandingReleaseRunBinding(state, run);
    const completedRenderObservation = allowCompletedRenderObservation &&
      delegation.state === "completed" && run?.state === "ACTION_IN_PROGRESS" &&
      run?.active_action?.kind === "render.observe";
    const completedRun = allowCompletedRun && delegation.state === "completed" &&
      run?.state === "COMPLETED";
    if (
      !delegationActive(delegation, nowValue) &&
      !completedRenderObservation &&
      !completedRun
    ) {
      fail("standing_release_authority_inactive");
    }
    ensureStandingReleaseDelegationActive(state, delegation, nowValue);
    return delegation;
  }

  function freshStandingReleaseRunIntent(input, tenantId, run, nowValue) {
    const requestedIntentDigest = digest(input.intent_anchor_digest);
    if (requestedIntentDigest !== run.intent_anchor_digest) {
      fail("standing_release_run_intent_mismatch");
    }
    const dttSessionFingerprint = text(
      input.dtt_session_fingerprint,
      "standing_release_run_session_invalid",
      160,
    ).toLowerCase();
    if (
      !/^[a-f0-9]{16,160}$/.test(dttSessionFingerprint) ||
      dttSessionFingerprint !== run.host_session_fingerprint
    ) fail("standing_release_run_session_mismatch");
    const intentBinding = normalizeStandingReleaseIntentBinding(
      input.intent_binding,
      {
        tenantId,
        workId: run.work_id,
        intentDigest: run.intent_anchor_digest,
        now: nowValue,
      },
    );
    return { intentBinding, dttSessionFingerprint };
  }

  function expiredStandingReleaseRunReservation(state, run, input, nowValue) {
    const ticketId = text(input.ticket_id, "standing_release_expired_ticket_invalid", 240);
    const reservationId = text(
      input.reservation_id,
      "standing_release_expired_reservation_mismatch",
      240,
    );
    const record = state.tickets?.[ticketId];
    if (!record || record.ticket?.tenant_id !== run.tenant_id) {
      fail("action_ticket_not_found");
    }
    if (!governance.verifyActionTicket(record.ticket)) {
      fail("action_ticket_signature_invalid");
    }
    verifyActionTicketLifecycleRecord(record);
    const expiresAt = Date.parse(record.reservation_expires_at || "");
    if (
      run.state !== "ACTION_IN_PROGRESS" || !run.active_action ||
      run.active_action.ticket_id !== ticketId ||
      run.active_action.action_digest !== hostNativeDigest(record.ticket.action) ||
      record.ticket.delegation_id !== run.delegation_id ||
      record.ticket.work_id !== run.work_id ||
      record.ticket.repository !== run.repository ||
      record.ticket.host_kind !== run.host_kind ||
      record.ticket.host_session_fingerprint !== run.host_session_fingerprint ||
      record.uses !== 1 ||
      !["reserved", "reconciliation_required"].includes(record.state) ||
      (record.state === "reconciliation_required" && record.outcome !== "unknown") ||
      record.reservation_id !== reservationId ||
      !Number.isFinite(expiresAt) || expiresAt > nowValue
    ) fail("standing_release_expired_reservation_mismatch");
    return record;
  }

  function authoritativeReplayResult(state, cached) {
    if (cached?.delegation_id && cached?.grant) {
      return state.delegations?.[cached.delegation_id] || cached;
    }
    const ticketId = cached?.ticket?.ticket_id;
    return ticketId ? (state.tickets?.[ticketId] || cached) : cached;
  }

  function validateStandingReplay(state, cached, nowValue = nowMillis(now)) {
    const current = authoritativeReplayResult(state, cached);
    const delegation = current?.grant?.standing_release_binding
      ? current
      : state.delegations?.[current?.ticket?.delegation_id];
    if (delegation?.grant?.standing_release_binding) {
      if (current?.ticket && current.state !== "issued") {
        verifyActionTicketLifecycleRecord(current);
      }
      if (!delegationActive(delegation, nowValue)) {
        fail("standing_release_authority_inactive");
      }
      ensureStandingReleaseDelegationActive(state, delegation, nowValue);
    }
    return clone(current);
  }

  async function resolveCoreJoinRequiredChecksPolicyDigest(input, manifest) {
    const supplied = input.required_checks_policy_digest;
    if (typeof requiredChecksPolicyResolver !== "function") {
      if (supplied !== undefined) fail("required_checks_policy_unavailable");
      return null;
    }
    const plan = {
      tenant_id: manifest.tenant_id,
      repository: manifest.repository,
      base_branch: text(manifest.base_branch, "base_branch_invalid", 240),
      required_checks: manifest.verification.required_checks,
    };
    let policy;
    try {
      policy = await requiredChecksPolicyResolver({
        tenant_id: plan.tenant_id,
        repository: plan.repository,
        base_branch: plan.base_branch,
      });
    } catch {
      fail("required_checks_policy_unavailable");
    }
    const resolved = hostNativeDigest(normalizedRequiredChecksPolicy(policy, plan));
    if (supplied !== undefined && policySha256(supplied) !== resolved) {
      fail("required_checks_policy_mismatch");
    }
    return resolved;
  }

  const governance = {
    storage: Object.freeze({
      kind: store.kind,
      restart_durable: store.restart_durable === true,
      distributed: store.distributed === true,
    }),
    trusted_readback_configured: typeof externalReadbackVerifier === "function",
    owner_manual_merge_readback_configured:
      typeof ownerManualMergeReadbackVerifier === "function" &&
      ownerManualMergeReadbackVerifier.trusted === true,
    release_join_verdict_resolver_configured: typeof releaseJoinVerdictResolver === "function",
    required_checks_policy_resolver_configured: typeof requiredChecksPolicyResolver === "function",
    closure_attestation_verifier_configured: true,
    render_service_origin_resolver_configured: typeof renderServiceOriginResolver === "function",
    standing_release_policy_supported: true,
    standing_release_runner_supported: true,
    nyra_work_automation_v3_supported: true,
    nyra_work_automation_provider_execution: false,
    semantic_scope_guard_mode: configuredSemanticScopeMode,
    semantic_scope_guard_configured: configuredSemanticScopeMode !== "OFF",
    semanticScopeMetrics() {
      return semanticScopeGuard && typeof semanticScopeGuard.metrics === "function"
        ? semanticScopeGuard.metrics()
        : Object.freeze({ semantic_scope_check_latency: 0, semantic_scope_block_total: 0,
          semantic_scope_hold_total: 0, semantic_scope_redact_total: 0,
          scope_drift_detected_total: 0, false_hold_rate: null, false_block_rate: null,
          check_total: 0 });
    },
    standing_release_coordination_model: "horizontal_peer_adapters_v1",
    standing_release_base_protection_resolver_configured:
      typeof standingReleaseBaseProtectionResolver === "function" &&
      standingReleaseBaseProtectionResolver.trusted === true,
    get standing_release_automation_enabled() { return standingReleaseRuntimeEnabled(); },
    get standing_release_emergency_stop() { return standingReleaseStopped(); },

    async buildWorkPlan(input) {
      const plan = buildHostNativeWorkPlan(input);
      if (typeof requiredChecksPolicyResolver !== "function") return plan;
      if (!plan.base_branch) fail("base_branch_invalid");
      let policy;
      try {
        policy = await requiredChecksPolicyResolver({
          tenant_id: plan.tenant_id,
          repository: plan.repository,
          base_branch: plan.base_branch,
        });
      } catch {
        fail("required_checks_policy_unavailable");
      }
      const normalizedPolicy = normalizedRequiredChecksPolicy(policy, plan);
      return buildPolicyBoundWorkPlan(plan, hostNativeDigest(normalizedPolicy));
    },

    async installStandingReleaseMandate(input = {}) {
      exactKeys(input, new Set([
        "tenant_id", "authorization_work_id", "authorization_intent_anchor_digest",
        "authorization_intent_binding", "authorization_dtt_request_binding_digest",
        "repository", "base_branch", "delivery_branch_prefix", "allowed_path_prefixes",
        "denied_path_prefixes", "required_checks", "required_checks_policy_digest",
        "services", "repair_classes", "limits", "base_protection_required", "expires_at",
        "owner_confirmation", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      text(input.idempotency_key, "standing_release_idempotency_key_required", 160);
      const nowValue = nowMillis(now);
      const confirmation = checkOwnerConfirmation(input.owner_confirmation);
      if (
        confirmation.purpose !== "host_native_standing_release_mandate_install" ||
        !confirmation.request_binding_hash
      ) fail("standing_release_owner_binding_invalid");
      const authorizationIntentBinding = normalizeStandingReleaseIntentBinding(
        input.authorization_intent_binding,
        {
          tenantId,
          workId: input.authorization_work_id,
          intentDigest: input.authorization_intent_anchor_digest,
          now: nowValue,
        },
      );
      const authorizationDttRequestBindingDigest = String(
        input.authorization_dtt_request_binding_digest || "",
      ).trim().toLowerCase();
      if (!SHA256.test(authorizationDttRequestBindingDigest)) {
        fail("standing_release_intent_binding_invalid");
      }
      const {
        owner_confirmation: _ownerConfirmation,
        idempotency_key: _idempotencyKey,
        authorization_intent_binding: _authorizationIntentBinding,
        authorization_dtt_request_binding_digest: _authorizationDttRequestBindingDigest,
        ...mandateInput
      } = input;
      const mandate = normalizeStandingReleaseMandate(mandateInput, { now: nowValue });
      if (mandate.tenant_id !== tenantId) fail("standing_release_cross_tenant_denied");
      const mandateDigest = hostNativeDigest(mandate);
      const mandateId = `srm_${mandateDigest.slice(0, 40)}`;
      const idempotencyInput = standingReleaseInstallIdempotencyInput(
        mandate,
        authorizationIntentBinding,
        input.idempotency_key,
      );
      const initial = store.readState();
      const replay = getIdempotent(
        initial,
        tenantId,
        "installStandingReleaseMandate",
        idempotencyInput,
      );
      if (replay?.result) {
        const current = initial.standing_release_mandates?.[replay.result.mandate_id] || replay.result;
        if (current?.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint) {
          fail("standing_release_owner_mismatch");
        }
        return clone(current);
      }
      return store.mutate((state) => {
        const descriptor = getIdempotent(
          state,
          tenantId,
          "installStandingReleaseMandate",
          idempotencyInput,
        );
        if (descriptor?.result) {
          const current = state.standing_release_mandates?.[descriptor.result.mandate_id] ||
            descriptor.result;
          if (current?.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint) {
            fail("standing_release_owner_mismatch");
          }
          return clone(current);
        }
        const nonce = ownerNonceKey(tenantId, confirmation);
        if (state.owner_nonces[nonce]) fail("owner_confirmation_replayed");
        for (const existing of Object.values(state.standing_release_mandates || {})) {
          if (
            standingReleaseEffectiveState(existing, {
              now: nowValue,
              runtimeEnabled: true,
              emergencyStop: false,
            }) === "active" && existing?.mandate?.tenant_id === tenantId &&
            existing.mandate.repository === mandate.repository &&
            existing.mandate.base_branch === mandate.base_branch
          ) fail("standing_release_active_mandate_exists");
        }
        const existing = state.standing_release_mandates?.[mandateId];
        if (existing?.mandate_digest && existing.mandate_digest !== mandateDigest) {
          fail("standing_release_mandate_conflict");
        }
        const revision = existing ? Number(existing.revision || 0) + 1 : 1;
        const revocationEpoch = existing ? Number(existing.revocation_epoch || 0) + 1 : 1;
        const unsigned = {
          schema_version: "owner_standing_release_mandate_record_v1",
          mandate_id: mandateId,
          mandate_digest: mandateDigest,
          tenant_id: tenantId,
          state: "active",
          revision,
          revocation_epoch: revocationEpoch,
          mandate,
          owner_subject_fingerprint: confirmation.owner_subject_fingerprint,
          owner_confirmation_digest: hostNativeDigest(confirmation),
          authorization_intent_binding: authorizationIntentBinding,
          authorization_intent_binding_digest: authorizationIntentBinding.binding_digest,
          authorization_dtt_request_binding_digest: authorizationDttRequestBindingDigest,
          issued_at: iso(nowValue),
          ...(existing ? { previous_record_digest: hostNativeDigest(existing) } : {}),
          provider_execution: false,
          host_action_ticket_required: true,
        };
        const record = { ...unsigned, signature: hmac("srm", signing, canonical(unsigned)) };
        state.owner_nonces[nonce] = { mandate_id: mandateId, used_at: iso(nowValue) };
        state.standing_release_mandates ||= {};
        state.standing_release_mandates[mandateId] = record;
        return saveIdempotent(state, descriptor, clone(record));
      });
    },

    async readStandingReleaseMandate({ tenant_id, mandate_id } = {}) {
      const tenantId = text(tenant_id, "tenant_id_invalid", 160);
      const record = store.readState().standing_release_mandates?.[String(mandate_id || "")];
      if (!record) fail("standing_release_mandate_not_found");
      if (record.tenant_id !== tenantId) fail("standing_release_cross_tenant_denied");
      return {
        ...clone(record),
        effective_state: standingReleaseEffectiveState(record, standingReleaseOptions()),
        automation_enabled: standingReleaseRuntimeEnabled(),
        emergency_stop: standingReleaseStopped(),
      };
    },

    verifyStandingReleaseMandate(record) {
      try {
        const { signature, ...unsigned } = record || {};
        return unsigned.schema_version === "owner_standing_release_mandate_record_v1" &&
          unsigned.mandate_digest === hostNativeDigest(unsigned.mandate) &&
          safeEqual(signature, hmac("srm", signing, canonical(unsigned)));
      } catch { return false; }
    },

    async revokeStandingReleaseMandate(input = {}) {
      exactKeys(input, new Set([
        "tenant_id", "mandate_id", "owner_confirmation", "reason_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const confirmation = checkOwnerConfirmation(input.owner_confirmation);
      if (
        confirmation.purpose !== "host_native_standing_release_mandate_revoke" ||
        !confirmation.request_binding_hash
      ) fail("standing_release_owner_binding_invalid");
      const reasonDigest = digest(input.reason_digest);
      const nowValue = nowMillis(now);
      const idempotencyInput = standingReleaseRevokeIdempotencyInput(input);
      const initial = store.readState();
      const initialRecord = initial.standing_release_mandates?.[String(input.mandate_id || "")];
      if (!initialRecord) fail("standing_release_mandate_not_found");
      if (initialRecord.tenant_id !== tenantId) fail("standing_release_cross_tenant_denied");
      if (initialRecord.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint) {
        fail("standing_release_owner_mismatch");
      }
      const replay = getIdempotent(
        initial,
        tenantId,
        "revokeStandingReleaseMandate",
        idempotencyInput,
      );
      if (replay?.result) return clone(initialRecord);
      return store.mutate((state) => {
        const descriptor = getIdempotent(
          state,
          tenantId,
          "revokeStandingReleaseMandate",
          idempotencyInput,
        );
        if (descriptor?.result) {
          const current = state.standing_release_mandates?.[String(input.mandate_id || "")] ||
            descriptor.result;
          if (current?.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint) {
            fail("standing_release_owner_mismatch");
          }
          return clone(current);
        }
        const record = state.standing_release_mandates?.[String(input.mandate_id || "")];
        if (!record) fail("standing_release_mandate_not_found");
        if (record.tenant_id !== tenantId) fail("standing_release_cross_tenant_denied");
        const nonce = ownerNonceKey(tenantId, confirmation);
        if (state.owner_nonces[nonce]) fail("owner_confirmation_replayed");
        if (record.owner_subject_fingerprint !== confirmation.owner_subject_fingerprint) {
          fail("standing_release_owner_mismatch");
        }
        if (record.state !== "active") fail("standing_release_mandate_not_active");
        record.state = "revoked";
        record.revocation_epoch += 1;
        record.revoked_at = iso(nowValue);
        record.revocation_reason_digest = reasonDigest;
        const { signature: _signature, ...unsigned } = record;
        record.signature = hmac("srm", signing, canonical(unsigned));
        for (const delegation of Object.values(state.delegations || {})) {
          if (delegation?.grant?.standing_release_binding?.mandate_id === record.mandate_id && delegation.state === "active") {
            delegation.state = "revoked";
            delegation.revoked_at = iso(nowValue);
            delegation.revocation = { reason: "standing_release_mandate_revoked" };
            const { signature: _delegationSignature, ...delegationUnsignedRecord } = delegation;
            delegation.signature = hmac("hnd", signing, canonical(delegationUnsignedRecord));
          }
        }
        for (const ticket of Object.values(state.tickets || {})) {
          const delegation = state.delegations?.[ticket?.ticket?.delegation_id];
          if (delegation?.grant?.standing_release_binding?.mandate_id !== record.mandate_id) continue;
          if (ticket.state === "issued") {
            ticket.state = "revoked";
            ticket.revoked_at = iso(nowValue);
          } else if (ticket.state === "reserved") {
            ticket.state = "reconciliation_required";
            ticket.outcome = "unknown";
            ticket.revoked_at = iso(nowValue);
            signActionTicketLifecycleRecord(ticket);
          }
        }
        const leaseKey = `${tenantId}\u0000${record.mandate.repository}\u0000${record.mandate.base_branch}`;
        delete state.standing_release_leases?.[leaseKey];
        state.owner_nonces[nonce] = { mandate_id: record.mandate_id, used_at: iso(nowValue) };
        return saveIdempotent(state, descriptor, clone(record));
      });
    },

    async deriveStandingReleaseDelegation(input = {}) {
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      text(input.idempotency_key, "standing_release_idempotency_key_required", 160);
      const nowValue = nowMillis(now);
      const initial = store.readState();
      const record = initial.standing_release_mandates?.[String(input.mandate_id || "")];
      if (!record) fail("standing_release_mandate_not_found");
      if (!governance.verifyStandingReleaseMandate(record)) fail("standing_release_mandate_signature_invalid");
      if (
        typeof standingReleaseBaseProtectionResolver !== "function" ||
        standingReleaseBaseProtectionResolver.trusted !== true
      ) fail("standing_release_base_protection_readback_unavailable");
      let baseProtection;
      try {
        baseProtection = await standingReleaseBaseProtectionResolver({
          tenant_id: tenantId,
          repository: record.mandate.repository,
          base_branch: record.mandate.base_branch,
          required_checks: record.mandate.required_checks,
          required_checks_policy_digest: record.mandate.required_checks_policy_digest,
        });
      } catch (error) {
        const code = String(error?.message || "standing_release_base_protection_readback_unavailable");
        if (code.startsWith("standing_release_")) fail(code);
        fail("standing_release_base_protection_readback_unavailable");
      }
      const derivationOptions = { ...standingReleaseOptions(nowValue), baseProtection };
      const grant = validateStandingReleaseDerivation(record, input, derivationOptions);
      const idempotencyInput = standingReleaseDerivationIdempotencyInput(input, grant);
      const replay = getIdempotent(
        initial,
        tenantId,
        "deriveStandingReleaseDelegation",
        idempotencyInput,
      );
      if (replay?.result) return validateStandingReplay(initial, replay.result, nowValue);
      return store.mutate((state) => {
        const descriptor = getIdempotent(
          state,
          tenantId,
          "deriveStandingReleaseDelegation",
          idempotencyInput,
        );
        if (descriptor?.result) return validateStandingReplay(state, descriptor.result, nowValue);
        const current = state.standing_release_mandates?.[record.mandate_id];
        if (!current || !governance.verifyStandingReleaseMandate(current)) {
          fail("standing_release_mandate_signature_invalid");
        }
        validateStandingReleaseDerivation(current, input, derivationOptions);
        const leaseKey = `${tenantId}\u0000${current.mandate.repository}\u0000${current.mandate.base_branch}`;
        state.standing_release_leases ||= {};
        const existingLease = state.standing_release_leases[leaseKey];
        if (existingLease) {
          const existingDelegation = state.delegations?.[existingLease.delegation_id];
          if (
            existingDelegation && delegationActive(existingDelegation, nowValue) &&
            standingReleaseBindingActive(state, existingDelegation, standingReleaseOptions(nowValue))
          ) fail("standing_release_lease_conflict");
          delete state.standing_release_leases[leaseKey];
        }
        const delegationId = `hnd_${hostNativeDigest({
          mandate_id: current.mandate_id,
          work_id: grant.work_id,
          intent_anchor_digest: grant.intent_anchor_digest,
          issued_at: iso(nowValue),
          idempotency_key: input.idempotency_key,
        }).slice(0, 40)}`;
        const delegationGrant = {
          ...grant,
          host_policy_override: false,
          host_policy_must_allow: true,
          absolute_deny_actions: [...HOST_NATIVE_ABSOLUTE_DENY_ACTIONS],
        };
        const unsigned = {
          ...delegationUnsigned(delegationGrant, delegationId, iso(nowValue)),
          standing_release_usage: clone(EMPTY_STANDING_RELEASE_USAGE),
        };
        const delegation = { ...unsigned, signature: hmac("hnd", signing, canonical(unsigned)) };
        state.delegations[delegationId] = delegation;
        state.standing_release_leases[leaseKey] = {
          schema_version: "standing_release_lease_v1",
          tenant_id: tenantId,
          mandate_id: current.mandate_id,
          work_id: grant.work_id,
          delegation_id: delegationId,
          acquired_at: iso(nowValue),
          expires_at: grant.expires_at,
        };
        if (grant.standing_release_binding.horizontal_runner_required === true) {
          const run = createStandingReleaseRunState({
            tenant_id: tenantId,
            work_id: grant.work_id,
            intent_anchor_digest: grant.intent_anchor_digest,
            mandate_id: grant.standing_release_binding.mandate_id,
            mandate_digest: grant.standing_release_binding.mandate_digest,
            mandate_revision: grant.standing_release_binding.revision,
            revocation_epoch: grant.standing_release_binding.revocation_epoch,
            delegation_id: delegationId,
            repository: grant.repository,
            base_branch: current.mandate.base_branch,
            delivery_branch: grant.standing_release_binding.delivery_branch,
            base_commit: grant.standing_release_binding.base_commit,
            changed_files: grant.standing_release_binding.changed_files,
            services: grant.standing_release_binding.induced_services,
            host_kind: grant.standing_release_binding.host_kind,
            host_session_fingerprint: grant.standing_release_binding.host_session_fingerprint,
            max_repair_attempts: grant.standing_release_binding.max_repair_attempts,
          }, { now: () => nowValue });
          const record = signStandingReleaseRunRecord(run, {
            transition: "derive_start",
            dttRequestBindingDigest: grant.dtt_request_binding_digest,
            dttSessionFingerprint: input.dtt_session_fingerprint,
            intentBinding: grant.standing_release_binding.intent_binding,
          });
          state.standing_release_runs ||= {};
          if (state.standing_release_runs[run.run_id]) fail("standing_release_run_exists");
          state.standing_release_runs[run.run_id] = record;
        }
        return saveIdempotent(state, descriptor, clone(delegation));
      });
    },

    async startStandingReleaseRun(input = {}) {
      exactKeys(input, new Set([
        "tenant_id", "delegation_id", "work_id", "intent_anchor_digest",
        "intent_binding", "host_kind", "host_session_fingerprint",
        "dtt_session_fingerprint", "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      text(input.idempotency_key, "standing_release_idempotency_key_required", 160);
      const dttRequestBindingDigest = digest(input.dtt_request_binding_digest);
      const idempotencyInput = standingReleaseRunIdempotencyInput(input);
      const nowValue = nowMillis(now);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "startStandingReleaseRun", idempotencyInput);
      if (replay?.result) {
        const current = currentStandingReleaseRunReplay(initial, replay.result, tenantId);
        ensureStandingReleaseRunAuthority(initial, current.run, nowValue);
        freshStandingReleaseRunIntent(input, tenantId, current.run, nowValue);
        return current;
      }
      const delegation = initial.delegations?.[String(input.delegation_id || "")];
      if (!delegation || delegation.grant?.tenant_id !== tenantId) {
        fail("standing_release_run_delegation_invalid");
      }
      if (!delegationActive(delegation, nowValue)) fail("standing_release_authority_inactive");
      ensureStandingReleaseDelegationActive(initial, delegation, nowValue);
      const binding = delegation.grant.standing_release_binding;
      if (!binding) fail("standing_release_run_delegation_invalid");
      const workId = text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase();
      const hostKind = text(input.host_kind, "standing_release_run_host_invalid", 80);
      const hostSessionFingerprint = text(
        input.host_session_fingerprint,
        "standing_release_run_session_invalid",
        80,
      ).toLowerCase();
      if (
        workId !== delegation.grant.work_id ||
        hostKind !== binding.host_kind ||
        hostSessionFingerprint !== binding.host_session_fingerprint
      ) fail("standing_release_run_binding_invalid");
      const existingRunRecord = standingReleaseRunForDelegation(
        initial,
        delegation.delegation_id,
      );
      if (existingRunRecord) {
        const existingRun = verifiedStandingReleaseRunRecord(existingRunRecord);
        ensureStandingReleaseRunAuthority(initial, existingRun, nowValue);
        freshStandingReleaseRunIntent(input, tenantId, existingRun, nowValue);
        return store.mutate((state) => {
          const descriptor = getIdempotent(
            state,
            tenantId,
            "startStandingReleaseRun",
            idempotencyInput,
          );
          if (descriptor?.result) {
            return currentStandingReleaseRunReplay(state, descriptor.result, tenantId);
          }
          const current = readStandingReleaseRunRecord(
            state,
            tenantId,
            existingRun.run_id,
          );
          ensureStandingReleaseRunAuthority(state, current.run, nowValue);
          const freshness = freshStandingReleaseRunIntent(
            input,
            tenantId,
            current.run,
            nowValue,
          );
          const attached = signStandingReleaseRunRecord(current.run, {
            transition: "start_attach",
            dttRequestBindingDigest,
            dttSessionFingerprint: freshness.dttSessionFingerprint,
            intentBinding: freshness.intentBinding,
          });
          state.standing_release_runs[current.run_id] = attached;
          return saveIdempotent(state, descriptor, clone(attached));
        });
      }
      const mandate = initial.standing_release_mandates?.[binding.mandate_id];
      if (!mandate || !governance.verifyStandingReleaseMandate(mandate)) {
        fail("standing_release_mandate_signature_invalid");
      }
      const run = createStandingReleaseRunState({
        tenant_id: tenantId,
        work_id: delegation.grant.work_id,
        intent_anchor_digest: delegation.grant.intent_anchor_digest,
        mandate_id: binding.mandate_id,
        mandate_digest: binding.mandate_digest,
        mandate_revision: binding.revision,
        revocation_epoch: binding.revocation_epoch,
        delegation_id: delegation.delegation_id,
        repository: delegation.grant.repository,
        base_branch: mandate.mandate.base_branch,
        delivery_branch: binding.delivery_branch,
        base_commit: binding.base_commit,
        changed_files: binding.changed_files,
        services: binding.induced_services,
        host_kind: binding.host_kind,
        host_session_fingerprint: binding.host_session_fingerprint,
        max_repair_attempts: binding.max_repair_attempts,
      }, { now: () => nowValue });
      const { intentBinding, dttSessionFingerprint } = freshStandingReleaseRunIntent(
        input,
        tenantId,
        run,
        nowValue,
      );
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "startStandingReleaseRun", idempotencyInput);
        if (descriptor?.result) {
          const current = currentStandingReleaseRunReplay(state, descriptor.result, tenantId);
          ensureStandingReleaseRunAuthority(state, current.run, nowValue);
          freshStandingReleaseRunIntent(input, tenantId, current.run, nowValue);
          return current;
        }
        ensureStandingReleaseRunAuthority(state, run, nowValue);
        state.standing_release_runs ||= {};
        if (state.standing_release_runs[run.run_id]) fail("standing_release_run_exists");
        for (const existingRecord of Object.values(state.standing_release_runs)) {
          const existingRun = verifiedStandingReleaseRunRecord(existingRecord);
          if (existingRun.delegation_id === run.delegation_id) {
            fail("standing_release_run_exists");
          }
        }
        const record = signStandingReleaseRunRecord(run, {
          transition: "start",
          dttRequestBindingDigest,
          dttSessionFingerprint,
          intentBinding,
        });
        state.standing_release_runs[run.run_id] = record;
        return saveIdempotent(state, descriptor, clone(record));
      });
    },

    async readStandingReleaseRun({ tenant_id, run_id } = {}) {
      const tenantId = text(tenant_id, "tenant_id_invalid", 160);
      const state = store.readState();
      const record = clone(readStandingReleaseRunRecord(state, tenantId, run_id));
      let authorityState = "active";
      try {
        ensureStandingReleaseRunAuthority(state, record.run, nowMillis(now), {
          allowCompletedRenderObservation: true,
        });
      } catch (error) {
        const code = String(error?.message || "standing_release_authority_inactive");
        if (!/^(standing_release_(authority_inactive|run_authority_drift|run_delegation_invalid|mandate_signature_invalid))$/.test(code)) {
          throw error;
        }
        authorityState = "inactive";
      }
      return { ...record, authority_state: authorityState };
    },

    verifyStandingReleaseRunRecord(record) {
      try {
        verifiedStandingReleaseRunRecord(record);
        return true;
      } catch {
        return false;
      }
    },

    async bindStandingReleaseRunTicket(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "run_id", "work_id", "intent_anchor_digest", "intent_binding",
        "ticket_id", "expected_version", "dtt_session_fingerprint",
        "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      text(input.idempotency_key, "standing_release_idempotency_key_required", 160);
      const dttRequestBindingDigest = digest(input.dtt_request_binding_digest);
      const idempotencyInput = standingReleaseRunIdempotencyInput(input);
      const nowValue = nowMillis(now);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "bindStandingReleaseRunTicket", idempotencyInput);
      if (replay?.result) {
        const current = currentStandingReleaseRunReplay(initial, replay.result, tenantId);
        ensureStandingReleaseRunAuthority(initial, current.run, nowValue);
        freshStandingReleaseRunIntent(input, tenantId, current.run, nowValue);
        return current;
      }
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "bindStandingReleaseRunTicket", idempotencyInput);
        if (descriptor?.result) {
          const current = currentStandingReleaseRunReplay(state, descriptor.result, tenantId);
          ensureStandingReleaseRunAuthority(state, current.run, nowValue);
          freshStandingReleaseRunIntent(input, tenantId, current.run, nowValue);
          return current;
        }
        const currentRecord = readStandingReleaseRunRecord(state, tenantId, input.run_id);
        const currentRun = verifiedStandingReleaseRunRecord(currentRecord);
        if (text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase() !== currentRun.work_id) {
          fail("standing_release_run_work_mismatch");
        }
        ensureStandingReleaseRunAuthority(state, currentRun, nowValue);
        const freshness = freshStandingReleaseRunIntent(
          input,
          tenantId,
          currentRun,
          nowValue,
        );
        const ticketRecord = state.tickets?.[String(input.ticket_id || "")];
        if (!ticketRecord || ticketRecord.ticket?.tenant_id !== tenantId) {
          fail("action_ticket_not_found");
        }
        if (!governance.verifyActionTicket(ticketRecord.ticket)) {
          fail("action_ticket_signature_invalid");
        }
        const nextRun = bindStandingReleaseRunTicketState(currentRun, clone(ticketRecord), {
          now: () => nowValue,
          expected_version: input.expected_version,
        });
        const nextRecord = signStandingReleaseRunRecord(nextRun, {
          transition: "bind_ticket",
          dttRequestBindingDigest,
          dttSessionFingerprint: freshness.dttSessionFingerprint,
          intentBinding: freshness.intentBinding,
        });
        state.standing_release_runs[nextRun.run_id] = nextRecord;
        return saveIdempotent(state, descriptor, clone(nextRecord));
      });
    },

    async advanceStandingReleaseRun(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "run_id", "work_id", "intent_anchor_digest", "intent_binding",
        "ticket_id", "expected_version", "dtt_session_fingerprint",
        "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      text(input.idempotency_key, "standing_release_idempotency_key_required", 160);
      const dttRequestBindingDigest = digest(input.dtt_request_binding_digest);
      const idempotencyInput = standingReleaseRunIdempotencyInput(input);
      const nowValue = nowMillis(now);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "advanceStandingReleaseRun", idempotencyInput);
      if (replay?.result) {
        const current = currentStandingReleaseRunReplay(initial, replay.result, tenantId);
        ensureStandingReleaseRunAuthority(initial, current.run, nowValue, {
          allowCompletedRun: true,
        });
        freshStandingReleaseRunIntent(input, tenantId, current.run, nowValue);
        return current;
      }
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "advanceStandingReleaseRun", idempotencyInput);
        if (descriptor?.result) {
          const current = currentStandingReleaseRunReplay(state, descriptor.result, tenantId);
          ensureStandingReleaseRunAuthority(state, current.run, nowValue, {
            allowCompletedRun: true,
          });
          freshStandingReleaseRunIntent(input, tenantId, current.run, nowValue);
          return current;
        }
        const currentRecord = readStandingReleaseRunRecord(state, tenantId, input.run_id);
        const currentRun = verifiedStandingReleaseRunRecord(currentRecord);
        if (text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase() !== currentRun.work_id) {
          fail("standing_release_run_work_mismatch");
        }
        if (currentRun.active_action?.ticket_id !== String(input.ticket_id || "")) {
          fail("standing_release_active_ticket_mismatch");
        }
        const allowCompletedRenderObservation = currentRun.active_action?.kind === "render.observe";
        ensureStandingReleaseRunAuthority(state, currentRun, nowValue, {
          allowCompletedRenderObservation,
        });
        const freshness = freshStandingReleaseRunIntent(
          input,
          tenantId,
          currentRun,
          nowValue,
        );
        const ticketRecord = state.tickets?.[String(input.ticket_id || "")];
        if (!ticketRecord || ticketRecord.ticket?.tenant_id !== tenantId) {
          fail("action_ticket_not_found");
        }
        if (!governance.verifyActionTicket(ticketRecord.ticket)) {
          fail("action_ticket_signature_invalid");
        }
        verifyActionTicketLifecycleRecord(ticketRecord);
        if (ticketRecord.ticket.action.kind === "render.observe") {
          const receipt = verifiedFinalizeAuthorization(ticketRecord, {
            signing,
            nowValue,
            tenantId,
            workId: currentRun.work_id,
            repository: currentRun.repository,
            targetCommit: currentRun.merge_commit,
          });
          if (receipt.verification_scope !== "full_release" || receipt.services_verified !== true) {
            fail("standing_release_run_live_verification_incomplete");
          }
        }
        const nextRun = advanceStandingReleaseRunState(currentRun, clone(ticketRecord), {
          now: () => nowValue,
          expected_version: input.expected_version,
        });
        if (nextRun.version === currentRun.version) {
          fail("standing_release_action_outcome_pending");
        }
        const nextRecord = signStandingReleaseRunRecord(nextRun, {
          transition: "advance",
          dttRequestBindingDigest,
          dttSessionFingerprint: freshness.dttSessionFingerprint,
          intentBinding: freshness.intentBinding,
        });
        state.standing_release_runs[nextRun.run_id] = nextRecord;
        return saveIdempotent(state, descriptor, clone(nextRecord));
      });
    },

    async cancelStandingReleaseRun(input = {}) {
      exactKeys(input, new Set([
        "tenant_id", "run_id", "work_id", "intent_anchor_digest", "intent_binding",
        "reason_digest", "expected_version", "dtt_session_fingerprint",
        "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      text(input.idempotency_key, "standing_release_idempotency_key_required", 160);
      const dttRequestBindingDigest = digest(input.dtt_request_binding_digest);
      const idempotencyInput = standingReleaseRunIdempotencyInput(input);
      const nowValue = nowMillis(now);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "cancelStandingReleaseRun", idempotencyInput);
      if (replay?.result) {
        const current = currentStandingReleaseRunReplay(initial, replay.result, tenantId);
        ensureStandingReleaseRunAuthority(initial, current.run, nowValue);
        freshStandingReleaseRunIntent(input, tenantId, current.run, nowValue);
        return current;
      }
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "cancelStandingReleaseRun", idempotencyInput);
        if (descriptor?.result) {
          const current = currentStandingReleaseRunReplay(state, descriptor.result, tenantId);
          ensureStandingReleaseRunAuthority(state, current.run, nowValue);
          freshStandingReleaseRunIntent(input, tenantId, current.run, nowValue);
          return current;
        }
        const currentRecord = readStandingReleaseRunRecord(state, tenantId, input.run_id);
        const currentRun = verifiedStandingReleaseRunRecord(currentRecord);
        if (text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase() !== currentRun.work_id) {
          fail("standing_release_run_work_mismatch");
        }
        ensureStandingReleaseRunAuthority(state, currentRun, nowValue);
        const freshness = freshStandingReleaseRunIntent(
          input,
          tenantId,
          currentRun,
          nowValue,
        );
        const nextRun = cancelStandingReleaseRunState(currentRun, {
          reason_digest: input.reason_digest,
          now: () => nowValue,
          expected_version: input.expected_version,
        });
        const nextRecord = signStandingReleaseRunRecord(nextRun, {
          transition: "cancel",
          dttRequestBindingDigest,
          dttSessionFingerprint: freshness.dttSessionFingerprint,
          intentBinding: freshness.intentBinding,
        });
        state.standing_release_runs[nextRun.run_id] = nextRecord;
        return saveIdempotent(state, descriptor, clone(nextRecord));
      });
    },

    async quarantineExpiredStandingReleaseRun(input = {}) {
      exactKeys(input, new Set([
        "tenant_id", "run_id", "work_id", "intent_anchor_digest", "intent_binding",
        "ticket_id", "reservation_id", "expected_version", "dtt_session_fingerprint",
        "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      text(input.idempotency_key, "standing_release_idempotency_key_required", 160);
      const dttRequestBindingDigest = digest(input.dtt_request_binding_digest);
      const idempotencyInput = standingReleaseRunIdempotencyInput(input);
      const nowValue = nowMillis(now);
      const initial = store.readState();
      const replay = getIdempotent(
        initial,
        tenantId,
        "quarantineExpiredStandingReleaseRun",
        idempotencyInput,
      );
      if (replay?.result) {
        const current = currentStandingReleaseRunReplay(initial, replay.result, tenantId);
        const currentRun = verifiedStandingReleaseRunRecord(current);
        if (
          text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase() !==
            currentRun.work_id ||
          currentRun.state !== "QUARANTINED"
        ) fail("standing_release_run_work_mismatch");
        ensureStandingReleaseRunBinding(initial, currentRun);
        freshStandingReleaseRunIntent(input, tenantId, currentRun, nowValue);
        return current;
      }
      return store.mutate((state) => {
        const descriptor = getIdempotent(
          state,
          tenantId,
          "quarantineExpiredStandingReleaseRun",
          idempotencyInput,
        );
        if (descriptor?.result) {
          const current = currentStandingReleaseRunReplay(state, descriptor.result, tenantId);
          const currentRun = verifiedStandingReleaseRunRecord(current);
          ensureStandingReleaseRunBinding(state, currentRun);
          freshStandingReleaseRunIntent(input, tenantId, currentRun, nowValue);
          return current;
        }
        const currentRecord = readStandingReleaseRunRecord(state, tenantId, input.run_id);
        const currentRun = verifiedStandingReleaseRunRecord(currentRecord);
        if (text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase() !== currentRun.work_id) {
          fail("standing_release_run_work_mismatch");
        }
        ensureStandingReleaseRunBinding(state, currentRun);
        const freshness = freshStandingReleaseRunIntent(input, tenantId, currentRun, nowValue);
        const ticketRecord = expiredStandingReleaseRunReservation(
          state,
          currentRun,
          input,
          nowValue,
        );
        const nextRun = quarantineExpiredStandingReleaseRunState(currentRun, {
          ticket_id: ticketRecord.ticket.ticket_id,
          reservation_id: ticketRecord.reservation_id,
          now: () => nowValue,
          expected_version: input.expected_version,
        });
        ticketRecord.state = "quarantined";
        ticketRecord.observed_outcome = "unknown";
        ticketRecord.quarantined_at = iso(nowValue);
        ticketRecord.quarantine_reason_digest = nextRun.terminal_reason_digest;
        signActionTicketLifecycleRecord(ticketRecord);
        const nextRecord = signStandingReleaseRunRecord(nextRun, {
          transition: "quarantine_expired",
          dttRequestBindingDigest,
          dttSessionFingerprint: freshness.dttSessionFingerprint,
          intentBinding: freshness.intentBinding,
        });
        state.standing_release_runs[nextRun.run_id] = nextRecord;
        return saveIdempotent(state, descriptor, clone(nextRecord));
      });
    },

    async issueDelegation(input = {}) {
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      // Validate every attempt before consulting idempotency. A replay may
      // skip mutation, never schema, TTL, budget or owner-confirmation checks.
      const nowValue = nowMillis(now);
      const grant = normalizeDelegation(input, nowValue);
      const idempotencyInput = delegationIssueIdempotencyInput(input, grant);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "issueDelegation", idempotencyInput);
      if (replay?.result) return replay.result;
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "issueDelegation", idempotencyInput);
        if (descriptor?.result) return descriptor.result;
        const nonce = ownerNonceKey(tenantId, grant.owner_confirmation);
        if (state.owner_nonces[nonce]) fail("owner_confirmation_replayed");
        const delegationId = `hnd_${hostNativeDigest({ grant, issued_at: iso(nowValue) }).slice(0, 40)}`;
        const unsigned = delegationUnsigned({
          ...grant,
          host_policy_override: false,
          host_policy_must_allow: true,
          provider_execution: false,
          absolute_deny_actions: [...HOST_NATIVE_ABSOLUTE_DENY_ACTIONS],
        }, delegationId, iso(nowValue));
        const record = {
          ...unsigned,
          signature: hmac("hnd", signing, canonical(unsigned)),
        };
        state.owner_nonces[nonce] = { delegation_id: delegationId, used_at: iso(nowValue) };
        state.delegations[delegationId] = record;
        return saveIdempotent(state, descriptor, record);
      });
    },

    async readDelegation({ tenant_id, delegation_id } = {}) {
      const record = readDelegationRecord(text(tenant_id, "tenant_id_invalid", 160), delegation_id);
      return {
        ...record,
        effective_state: delegationActive(record, nowMillis(now)) ? "active" :
          record.state === "revoked" ? "revoked" : "expired",
      };
    },

    verifyDelegation(record) {
      try {
        const { signature, ...unsigned } = record || {};
        return safeEqual(signature, hmac("hnd", signing, canonical(unsigned)));
      } catch { return false; }
    },

    async revokeDelegation(input = {}) {
      exactKeys(input, new Set(["tenant_id", "delegation_id", "owner_confirmation", "idempotency_key"]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "revokeDelegation", input);
      if (replay?.result) return replay.result;
      const confirmation = checkOwnerConfirmation(input.owner_confirmation);
      const nowValue = nowMillis(now);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "revokeDelegation", input);
        if (descriptor?.result) return descriptor.result;
        const record = state.delegations[String(input.delegation_id || "")];
        if (!record) fail("delegation_not_found");
        if (record.grant.tenant_id !== tenantId) fail("cross_tenant_delegation_denied");
        const nonce = ownerNonceKey(tenantId, confirmation);
        if (state.owner_nonces[nonce]) fail("owner_confirmation_replayed");
        state.owner_nonces[nonce] = { delegation_id: record.delegation_id, used_at: iso(nowValue) };
        record.state = "revoked";
        record.revoked_at = iso(nowValue);
        record.revocation = { owner_subject_fingerprint: confirmation.owner_subject_fingerprint };
        const { signature: _signature, ...unsigned } = record;
        record.signature = hmac("hnd", signing, canonical(unsigned));
        const standingBinding = record.grant?.standing_release_binding;
        if (standingBinding) {
          for (const ticket of Object.values(state.tickets || {})) {
            if (ticket?.ticket?.delegation_id !== record.delegation_id) continue;
            if (ticket.state === "issued") {
              ticket.state = "revoked";
              ticket.revoked_at = iso(nowValue);
            } else if (ticket.state === "reserved") {
              ticket.state = "reconciliation_required";
              ticket.outcome = "unknown";
              ticket.revoked_at = iso(nowValue);
              signActionTicketLifecycleRecord(ticket);
            }
          }
          const mandate = state.standing_release_mandates?.[standingBinding.mandate_id];
          if (mandate) {
            const leaseKey = `${tenantId}\u0000${mandate.mandate.repository}\u0000${mandate.mandate.base_branch}`;
            const lease = state.standing_release_leases?.[leaseKey];
            if (lease?.delegation_id === record.delegation_id) {
              delete state.standing_release_leases[leaseKey];
            }
          }
        }
        return saveIdempotent(state, descriptor, record);
      });
    },

    async issueCoreJoinVerdict(input = {}) {
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "issueCoreJoinVerdict", input);
      if (replay?.result) return replay.result;
      if (input.provider_execution !== false) fail("provider_execution_denied");
      const releaseIntent = input.release_intent;
      if (!releaseIntent || typeof releaseIntent !== "object") fail("release_intent_invalid");
      // Reconstruct a synthetic manifest-free context from the intent.  The
      // closure and report validation below binds every field that can later
      // be consumed by a release ticket.
      const manifestLike = {
        tenant_id: text(input.tenant_id, "tenant_id_invalid", 160),
        work_id: text(input.work_id, "work_id_invalid", 240),
        intent_anchor_digest: digest(input.intent_anchor_digest),
        repository: text(input.repository, "repository_invalid", 300),
        verification: {
          builder_agent_id: text(input.builder_report?.agent_id, "builder_report_invalid", 240),
          verifier_agent_ids: stableStrings((input.verifier_reports || []).map((report) => report?.agent_id), "verifier_agents_invalid", 20),
          required_checks: stableStrings(input.checks?.required_checks, "required_checks_invalid", 100),
          checks_commit: commit(input.checks?.commit, "checks_commit_invalid"),
          checks_digest: digest(input.checks?.checks_digest),
          evidence_digest: digest(input.evaluation_digest),
        },
      };
      const closure = validateClosureAttestation(input, closureSecret);
      const expectedIntentFields = ["tenant_id", "work_id", "intent_anchor_digest", "repository"];
      for (const field of expectedIntentFields) {
        if (releaseIntent[field] !== manifestLike[field]) fail("core_join_verdict_binding_mismatch");
      }
      // Build a lightweight manifest facade for shared strict validation. The
      // HNJ itself compares the full release intent digest below.
      const intentDigest = text(releaseIntent.release_intent_digest, "release_intent_invalid", 100);
      if (!SHA256.test(intentDigest)) fail("release_intent_invalid");
      const { release_intent_digest: _releaseIntentDigest, ...releaseIntentUnsigned } =
        releaseIntent;
      if (hostNativeDigest(releaseIntentUnsigned) !== intentDigest) {
        fail("release_intent_invalid");
      }
      const canonicalDiffDigest = hostNativeGithubDiffDigest({
        repository: releaseIntent.repository,
        base_commit: releaseIntent.base_commit,
        head_commit: releaseIntent.head_commit,
        tree_sha: releaseIntent.tree_sha,
        changed_files: releaseIntent.changed_files,
      });
      if (releaseIntent.diff_digest !== canonicalDiffDigest) {
        fail("core_join_release_intent_diff_digest_mismatch");
      }
      const checksCommit = manifestLike.verification.checks_commit;
      if (closure.tenant_id !== manifestLike.tenant_id || closure.work_id !== manifestLike.work_id ||
          closure.repository !== manifestLike.repository || closure.target_commit !== checksCommit ||
          closure.core_plan_id !== input.core_plan_id || closure.core_plan_digest !== input.core_plan_digest ||
          closure.local_plan_id !== input.local_plan_id || closure.local_plan_digest !== input.local_plan_digest ||
          closure.evaluation_digest !== input.evaluation_digest || closure.checks_digest !== input.checks.checks_digest) {
        fail("closure_attestation_invalid");
      }
      const requiredChecksPolicyDigest =
        await resolveCoreJoinRequiredChecksPolicyDigest(input, {
          ...manifestLike,
          base_branch: releaseIntent.base_branch,
        });
      const pseudoManifest = {
        ...manifestLike,
        verification: {
          ...manifestLike.verification,
          builder_agent_id: input.builder_report.agent_id,
          verifier_agent_ids: stableStrings((input.verifier_reports || []).map((report) => report.agent_id), "verifier_agents_invalid", 20),
        },
      };
      const claim = coreJoinClaim(input, {
        ...pseudoManifest,
        delivery: releaseIntent.delivery,
        rollback: releaseIntent.rollback,
        base_branch: releaseIntent.base_branch,
        delivery_branch: releaseIntent.delivery_branch,
        base_commit: releaseIntent.base_commit,
        head_commit: releaseIntent.head_commit,
        tree_sha: releaseIntent.tree_sha,
        diff_digest: releaseIntent.diff_digest,
        changed_files: releaseIntent.changed_files,
      }, closure, requiredChecksPolicyDigest);
      const claim_digest = hostNativeDigest(claim);
      const verdictId = `hnj_${claim_digest.slice(0, 40)}`;
      const nowValue = nowMillis(now);
      if (claim.software_closure_fresh_until && nowValue > Date.parse(claim.software_closure_fresh_until)) {
        fail("software_cognition_closure_expired_during_issuance");
      }
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "issueCoreJoinVerdict", input);
        if (descriptor?.result) return descriptor.result;
        const existing = state.core_join_verdicts[verdictId];
        if (existing) return saveIdempotent(state, descriptor, clone(existing));
        const { schema_version: _claimSchemaVersion, ...claimFields } = claim;
        const verdictUnsigned = {
          schema_version: claim.schema_version === "host_native_core_join_claim_v2" ? "host_native_core_join_v2" : "host_native_core_join_v1",
          verdict_id: verdictId,
          claim_digest,
          ...claimFields,
          authority: "universal_core",
          allowed: true,
          provider_execution: false,
          issued_at: iso(nowValue),
          expires_at: iso(Math.min(nowValue + coreJoinTtl,
            claim.software_closure_fresh_until ? Date.parse(claim.software_closure_fresh_until) : Number.POSITIVE_INFINITY)),
        };
        const verdict = { ...verdictUnsigned, signature: hmac("hnj", signing, canonical(verdictUnsigned)) };
        const record = {
          schema_version: "host_native_core_join_record_v1",
          state: "active",
          uses: 0,
          tenant_id: tenantId,
          verdict_id: verdictId,
          claim_digest,
          claim,
          release_intent: clone(releaseIntent),
          verdict,
          issued_at: iso(nowValue),
          expires_at: verdict.expires_at,
        };
        state.core_join_verdicts[verdictId] = record;
        return saveIdempotent(state, descriptor, clone(record));
      });
    },

    async readCoreJoinVerdict({ tenant_id, verdict_id } = {}) {
      const tenantId = text(tenant_id, "tenant_id_invalid", 160);
      const record = store.readState().core_join_verdicts[String(verdict_id || "")];
      if (!record) fail("core_join_verdict_not_found");
      if (record.tenant_id !== tenantId) fail("cross_tenant_core_join_verdict_denied");
      return clone(record);
    },

    async recordOwnerManualMergeReadback(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "work_id", "intent_anchor_digest", "repository",
        "core_join_verdict_id", "pull_request", "owner_confirmation", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const workId = text(input.work_id, "work_id_invalid", 240);
      const intentAnchorDigest = digest(input.intent_anchor_digest);
      const repository = text(input.repository, "repository_invalid", 300);
      const verdictId = text(input.core_join_verdict_id, "core_join_verdict_id_invalid", 240);
      const pullRequest = positiveInteger(
        input.pull_request,
        "owner_manual_merge_pull_request_invalid",
        Number.MAX_SAFE_INTEGER,
      );
      const ownerConfirmation = checkOwnerConfirmation(input.owner_confirmation);
      if (ownerConfirmation.purpose !== "host_native_owner_manual_merge_readback" ||
          !ownerConfirmation.request_binding_hash) {
        fail("owner_manual_merge_owner_confirmation_invalid");
      }
      text(input.idempotency_key, "owner_manual_merge_idempotency_key_required", 160);
      const idempotencyInput = {
        tenant_id: tenantId,
        work_id: workId,
        intent_anchor_digest: intentAnchorDigest,
        repository,
        core_join_verdict_id: verdictId,
        pull_request: pullRequest,
        owner_subject_fingerprint: ownerConfirmation.owner_subject_fingerprint,
        idempotency_key: input.idempotency_key,
      };
      const initial = store.readState();
      const replay = getIdempotent(
        initial,
        tenantId,
        "recordOwnerManualMergeReadback",
        idempotencyInput,
      );
      if (replay?.result) return replay.result;
      if (typeof ownerManualMergeReadbackVerifier !== "function" ||
          ownerManualMergeReadbackVerifier.trusted !== true) {
        fail("owner_manual_merge_readback_unavailable");
      }
      const coreJoin = initial.core_join_verdicts[verdictId];
      const releaseIntent = coreJoin?.release_intent;
      const releaseIntentUnsigned = releaseIntent &&
        typeof releaseIntent === "object" && !Array.isArray(releaseIntent)
        ? (({ release_intent_digest: _digest, ...rest }) => rest)(releaseIntent)
        : null;
      if (!coreJoin || coreJoin.state !== "active" || coreJoin.uses !== 0 ||
          coreJoin.authorized_ticket_id || coreJoin.manual_merge_readback_receipt_id ||
          !governance.verifyCoreJoinVerdict(coreJoin) ||
          coreJoin.tenant_id !== tenantId || coreJoin.claim?.tenant_id !== tenantId ||
          coreJoin.claim?.work_id !== workId ||
          coreJoin.claim?.intent_anchor_digest !== intentAnchorDigest ||
          coreJoin.claim?.repository !== repository ||
          !releaseIntentUnsigned ||
          releaseIntent.release_intent_digest !== coreJoin.claim?.release_intent_digest ||
          hostNativeDigest(releaseIntentUnsigned) !== releaseIntent.release_intent_digest ||
          releaseIntent.tenant_id !== tenantId || releaseIntent.work_id !== workId ||
          releaseIntent.intent_anchor_digest !== intentAnchorDigest ||
          releaseIntent.repository !== repository ||
          coreJoin.claim_digest !== hostNativeDigest(coreJoin.claim)) {
        fail("owner_manual_merge_core_join_invalid");
      }
      let githubReadback;
      try {
        githubReadback = await ownerManualMergeReadbackVerifier({
          tenant_id: tenantId,
          repository,
          pull_request: pullRequest,
          core_join_record: clone(coreJoin),
        });
      } catch (error) {
        fail(String(error?.message || "owner_manual_merge_readback_failed"));
      }
      const joinedAt = Date.parse(coreJoin.verdict?.issued_at || "");
      const joinExpiresAt = Date.parse(coreJoin.verdict?.expires_at || "");
      const mergedAt = Date.parse(githubReadback?.merged_at || "");
      if (!githubReadback || githubReadback.trusted !== true ||
          githubReadback.schema_version !== "host_native_owner_manual_merge_github_readback_v1" ||
          githubReadback.source !== "universal_core_github_readback" ||
          githubReadback.tenant_id !== tenantId || githubReadback.repository !== repository ||
          githubReadback.pull_request !== pullRequest || githubReadback.merged !== true ||
          githubReadback.head_commit !== coreJoin.claim.checks?.commit ||
          githubReadback.checks_commit !== coreJoin.claim.checks?.commit ||
          githubReadback.base_branch !== coreJoin.claim.base_branch ||
          githubReadback.merge_commit !== githubReadback.main_head_commit ||
          githubReadback.required_checks_policy_digest !==
            coreJoin.claim.required_checks_policy_digest ||
          githubReadback.provider_execution !== false ||
          githubReadback.external_side_effect !== false ||
          githubReadback.readback_digest !== hostNativeDigest((({ readback_digest: _digest, ...rest }) => rest)(githubReadback)) ||
          !Number.isFinite(joinedAt) || !Number.isFinite(joinExpiresAt) ||
          !Number.isFinite(mergedAt) || mergedAt > joinExpiresAt) {
        fail("owner_manual_merge_readback_binding_invalid");
      }
      let refreshPredecessor = null;
      if (mergedAt < joinedAt) {
        assertSoftwareConsumerFresh(trusted);
        if (!trusted.software_closure_digest ||
            coreJoin.claim?.schema_version !== "host_native_core_join_claim_v2" ||
            coreJoin.claim?.software_closure_digest !== trusted.software_closure_digest ||
            coreJoin.claim?.software_closure_fresh_until !==
              trusted.software_closure_fresh_until) {
          fail("owner_manual_merge_refresh_software_cognition_invalid");
        }
        const candidates = Object.values(initial.owner_manual_merge_readbacks || {})
          .filter((candidate) => {
            const priorJoin = initial.core_join_verdicts?.[
              candidate?.core_join_verdict_id
            ];
            return !initial.owner_manual_merge_successors?.[candidate?.receipt_id] &&
              candidate?.owner_subject_fingerprint ===
                ownerConfirmation.owner_subject_fingerprint &&
              legacyManualMergeRefreshBindingValid({
                priorReceipt: candidate,
                priorJoin,
                currentJoin: coreJoin,
                githubReadback,
                nowValue: nowMillis(now),
                signing,
              });
          });
        if (candidates.length !== 1) {
          fail(candidates.length ?
            "owner_manual_merge_refresh_ambiguous" :
            "owner_manual_merge_refresh_predecessor_missing");
        }
        refreshPredecessor = candidates[0];
      }
      const coreJoinDigest = hostNativeDigest(coreJoin);
      const predecessorUnsigned = {
        schema_version: "host_native_owner_manual_merge_predecessor_v1",
        predecessor_type: "owner_manual_github_merge_readback",
        source_action_kind: "github.merge",
        tenant_id: tenantId,
        work_id: workId,
        intent_anchor_digest: intentAnchorDigest,
        repository,
        pull_request: pullRequest,
        target_commit: githubReadback.merge_commit,
        core_join_verdict_id: verdictId,
        core_join_record_digest: coreJoinDigest,
        source_readback_digest: githubReadback.readback_digest,
        eligible_successor_action: "render.observe",
        successor_ticket_required: true,
        closure_ticket_required: true,
        retrospective_ticket_issued: false,
        action_authorized: false,
        provider_execution: false,
      };
      const predecessor = {
        ...predecessorUnsigned,
        predecessor_digest: hostNativeDigest(predecessorUnsigned),
      };
      const refreshLineageUnsigned = refreshPredecessor ? {
        schema_version: "host_native_owner_manual_merge_refresh_lineage_v1",
        predecessor_manual_merge_readback_id: refreshPredecessor.receipt_id,
        predecessor_manual_merge_readback_digest: refreshPredecessor.receipt_digest,
        predecessor_core_join_verdict_id:
          refreshPredecessor.core_join_verdict_id,
        successor_core_join_verdict_id: verdictId,
        legacy_diff_digest: initial.core_join_verdicts[
          refreshPredecessor.core_join_verdict_id
        ].release_intent.diff_digest,
        canonical_diff_digest: coreJoin.release_intent.diff_digest,
        predecessor_release_intent_digest: initial.core_join_verdicts[
          refreshPredecessor.core_join_verdict_id
        ].release_intent.release_intent_digest,
        successor_release_intent_digest:
          coreJoin.release_intent.release_intent_digest,
        correction: "legacy_diff_digest_to_host_native_github_diff_digest",
        authorized_successor_action: "render.observe",
        provider_execution: false,
      } : null;
      const refreshLineage = refreshLineageUnsigned ? {
        ...refreshLineageUnsigned,
        lineage_digest: hostNativeDigest(refreshLineageUnsigned),
      } : null;
      const receiptUnsigned = {
        schema_version: "host_native_owner_manual_merge_readback_v1",
        receipt_id: `hnmmr_${hostNativeDigest({
          tenant_id: tenantId,
          work_id: workId,
          core_join_verdict_id: verdictId,
          pull_request: pullRequest,
          readback_digest: githubReadback.readback_digest,
        }).slice(0, 40)}`,
        tenant_id: tenantId,
        work_id: workId,
        intent_anchor_digest: intentAnchorDigest,
        repository,
        core_join_verdict_id: verdictId,
        core_join_record_digest: coreJoinDigest,
        pull_request: pullRequest,
        github_readback: githubReadback,
        predecessor,
        ...(refreshLineage ? { refresh_lineage: refreshLineage } : {}),
        owner_subject_fingerprint: ownerConfirmation.owner_subject_fingerprint,
        authority: "evidence_only",
        evidence_only: true,
        ticket_issued: false,
        retrospective_ticket_issued: false,
        action_authorized: false,
        execution_authorized: false,
        host_policy_override: false,
        provider_execution: false,
        recorded_at: iso(nowMillis(now)),
      };
      const receiptDigest = hostNativeDigest(receiptUnsigned);
      const receipt = {
        ...receiptUnsigned,
        receipt_digest: receiptDigest,
        signature: hmac("hnmmr", signing, canonical({ ...receiptUnsigned, receipt_digest: receiptDigest })),
      };
      return store.mutate((state) => {
        const descriptor = getIdempotent(
          state,
          tenantId,
          "recordOwnerManualMergeReadback",
          idempotencyInput,
        );
        if (descriptor?.result) return descriptor.result;
        const currentJoin = state.core_join_verdicts[verdictId];
        if (!currentJoin || currentJoin.state !== "active" || currentJoin.uses !== 0 ||
            currentJoin.authorized_ticket_id || hostNativeDigest(currentJoin) !== coreJoinDigest) {
          fail("owner_manual_merge_core_join_changed");
        }
        if (refreshPredecessor) {
          const currentPredecessor = state.owner_manual_merge_readbacks?.[
            refreshPredecessor.receipt_id
          ];
          if (!currentPredecessor ||
              currentPredecessor.receipt_digest !== refreshPredecessor.receipt_digest ||
              state.owner_manual_merge_successors?.[refreshPredecessor.receipt_id] ||
              currentPredecessor.refresh_lineage) {
            fail("owner_manual_merge_refresh_predecessor_changed");
          }
        }
        const existing = state.owner_manual_merge_readbacks[receipt.receipt_id];
        if (existing && existing.receipt_digest !== receipt.receipt_digest) {
          fail("owner_manual_merge_readback_conflict");
        }
        state.owner_manual_merge_readbacks[receipt.receipt_id] = clone(receipt);
        if (refreshPredecessor) {
          state.owner_manual_merge_successors[refreshPredecessor.receipt_id] = {
            schema_version: "host_native_owner_manual_merge_refresh_successor_v1",
            manual_merge_readback_id: refreshPredecessor.receipt_id,
            manual_merge_readback_digest: refreshPredecessor.receipt_digest,
            refreshed_manual_merge_readback_id: receipt.receipt_id,
            refreshed_manual_merge_readback_digest: receipt.receipt_digest,
            core_join_verdict_id: verdictId,
            created_at: iso(nowMillis(now)),
          };
        }
        currentJoin.manual_merge_readback_receipt_id = receipt.receipt_id;
        currentJoin.manual_merge_readback_receipt_digest = receipt.receipt_digest;
        return saveIdempotent(state, descriptor, receipt);
      });
    },

    verifyCoreJoinVerdict(record) {
      try {
        const verdict = record?.verdict;
        const { signature, ...unsigned } = verdict || {};
        const issuedAt = Date.parse(verdict?.issued_at || "");
        const expiresAt = Date.parse(verdict?.expires_at || "");
        return verdict?.allowed === true && verdict?.provider_execution === false &&
          verdict?.claim_digest === record?.claim_digest &&
          Number.isFinite(issuedAt) && Number.isFinite(expiresAt) &&
          issuedAt < expiresAt && expiresAt > nowMillis(now) &&
          safeEqual(signature, hmac("hnj", signing, canonical(unsigned)));
      } catch { return false; }
    },

    async issueActionTicket(input = {}, trusted = {}) {
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "issueActionTicket", input);
      if (replay?.result) return validateStandingReplay(initial, replay.result);
      const action = validateActionShape(input.action);
      const nowValue = nowMillis(now);
      const delegation = initial.delegations[String(input.delegation_id || "")];
      if (!delegation) fail("delegation_not_found");
      if (delegation.grant.tenant_id !== tenantId) fail("cross_tenant_delegation_denied");
      if (!delegationActive(delegation, nowValue)) fail("delegation_not_active");
      ensureStandingReleaseDelegationActive(initial, delegation, nowValue);
      if (text(input.work_id, "work_id_invalid", 240) !== delegation.grant.work_id) fail("delegation_work_mismatch");
      if (digest(input.intent_anchor_digest) !== delegation.grant.intent_anchor_digest) fail("delegation_intent_mismatch");
      if (text(input.repository, "repository_invalid", 300) !== delegation.grant.repository) fail("delegation_repository_mismatch");
      const host_kind = text(input.host_kind, "host_kind_invalid", 120);
      if (!delegation.grant.audience.includes(host_kind)) fail("host_not_allowed");
      const host_session_fingerprint = text(input.host_session_fingerprint, "host_session_invalid", 300);
      const standingBinding = delegation.grant.standing_release_binding;
      if (standingBinding && (
        standingBinding.host_kind !== host_kind ||
        standingBinding.host_session_fingerprint !== host_session_fingerprint
      )) fail("standing_release_host_session_mismatch");
      const standingMandate = standingBinding
        ? initial.standing_release_mandates?.[standingBinding.mandate_id]?.mandate
        : null;
      if (standingBinding && !standingMandate) fail("standing_release_authority_inactive");
      if (standingBinding) {
        const changedFilesRequired = [
          "git.commit", "git.push.branch", "github.draft_pr",
        ].includes(action.kind);
        if (["git.commit", "git.push.branch", "github.draft_pr", "github.ready", "github.merge"].includes(action.kind) &&
          actionBranch(action) !== standingBinding.delivery_branch) {
          fail("standing_release_delivery_branch_denied");
        }
        if (["github.draft_pr", "github.ready", "github.merge"].includes(action.kind) &&
          action.base_branch !== standingMandate.base_branch) {
          fail("standing_release_base_branch_denied");
        }
        if (["github.draft_pr", "github.merge"].includes(action.kind) &&
          commit(action.expected_base_commit) !== standingBinding.base_commit) {
          fail("standing_release_base_commit_drift");
        }
        if (changedFilesRequired && (!Array.isArray(action.changed_files) || !action.changed_files.length)) {
          fail("standing_release_changed_files_required");
        }
        if (changedFilesRequired &&
          !sameStrings(action.changed_files, standingBinding.changed_files)) {
          fail("standing_release_change_cone_drift");
        }
        if (action.kind === "git.commit" && !input.predecessor_ticket_id &&
          commit(action.parent_commit) !== standingBinding.base_commit) {
          fail("standing_release_commit_chain_mismatch");
        }
        if (["git.push.branch", "github.draft_pr", "github.ready", "github.merge"].includes(action.kind) &&
          !input.predecessor_ticket_id) {
          fail("standing_release_predecessor_required");
        }
      }
      if (standingBinding && action.kind === "github.merge" &&
        action.head_branch !== standingBinding.delivery_branch) {
        fail("standing_release_delivery_branch_denied");
      }
      validateStandingRepairAction(delegation, action);
      const manualMergeReadbackSupplied = Object.hasOwn(
        input,
        "manual_merge_readback_id",
      );
      const rawManualMergeReadbackId = input.manual_merge_readback_id;
      const normalizedManualMergeReadbackId = typeof rawManualMergeReadbackId === "string"
        ? rawManualMergeReadbackId.trim()
        : "";
      const manualMergeReadbackId = normalizedManualMergeReadbackId &&
        rawManualMergeReadbackId === normalizedManualMergeReadbackId
        ? normalizedManualMergeReadbackId
        : null;
      const candidateManualMergeReadback = manualMergeReadbackId
        ? initial.owner_manual_merge_readbacks?.[manualMergeReadbackId]
        : null;
      const trustedManualMergeReadback = candidateManualMergeReadback &&
        manualMergeReadbackSignatureValid(candidateManualMergeReadback, signing) &&
        manualMergeRefreshLineageValid(
          candidateManualMergeReadback,
          initial,
          signing,
          nowValue,
        ) &&
        !initial.owner_manual_merge_successors?.[manualMergeReadbackId]
        ? candidateManualMergeReadback
        : null;
      ensureActionBound(action, delegation, trustedManualMergeReadback ? {
        serverVerifiedBranch: trustedManualMergeReadback.github_readback?.base_branch,
      } : undefined);
      if (input.bootstrap_release_exception_receipt !== undefined && action.kind !== "github.merge") {
        fail("bootstrap_release_exception_action_not_allowed");
      }
      const evidence_digest = digest(input.evidence_digest);
      let release_manifest = null;
      let release_intent_digest = null;
      let release_join_resolution = null;
      let coreJoin = null;
      let bootstrapReleaseExceptionCandidate = null;
      let predecessor = null;
      let manualMergeReadback = null;
      let expiredDelegationContinuation = null;
      if (input.predecessor_ticket_id && manualMergeReadbackSupplied) {
        fail("predecessor_exclusive");
      }
      if (manualMergeReadbackSupplied) {
        if (action.kind !== "render.observe") {
          fail("owner_manual_merge_successor_action_invalid");
        }
        // Reject caller-invented observation facts before entering the store
        // mutation. The in-memory store is intentionally simple and cannot
        // roll back a mutator that throws after changing nested state.
        ensureObservationOnlyActionShape(action);
        if (!manualMergeReadbackId) {
          fail("owner_manual_merge_readback_id_invalid");
        }
        manualMergeReadback = candidateManualMergeReadback;
        if (manualMergeReadback !== trustedManualMergeReadback) {
          fail("owner_manual_merge_readback_predecessor_invalid");
        }
        // The in-memory store does not roll back nested mutations when a
        // mutator throws. Validate the one-shot successor grant before any
        // ticket, Core Join, or successor state can be changed.
        validateManualMergeObservationDelegationBeforeMutation(
          delegation,
          manualMergeReadback,
          signing,
        );
      }
        if (input.predecessor_ticket_id) {
        const parent = initial.tickets[String(input.predecessor_ticket_id)];
        const parentMayContinue = parent && (
          parent.state === "completed" ||
          parent.state === "reconciled" ||
          (parent.state === "observed_unreserved_effect" &&
            parent.protocol_deviation?.classification === "RECONCILED_WITH_EXCEPTION" &&
            parent.protocol_deviation?.continuation_authorized === true)
        );
        if (!parentMayContinue || parent.ticket.tenant_id !== tenantId) {
          fail("predecessor_ticket_invalid");
        }
        if (standingBinding) verifyActionTicketLifecycleRecord(parent);
        if (standingBinding) {
          const parentDelegation = initial.delegations?.[parent.ticket.delegation_id];
          const parentBinding = parentDelegation?.grant?.standing_release_binding;
          if (
            !parentBinding || parentBinding.mandate_id !== standingBinding.mandate_id ||
            parentBinding.mandate_digest !== standingBinding.mandate_digest ||
            parentBinding.revision !== standingBinding.revision ||
            parentBinding.revocation_epoch !== standingBinding.revocation_epoch ||
            parent.ticket.host_kind !== host_kind ||
            parent.ticket.host_session_fingerprint !== host_session_fingerprint
          ) fail("standing_release_predecessor_mismatch");
          const parentKind = parent.ticket.action.kind;
          const chainValid = action.kind === "git.commit"
            ? (["git.commit", "git.push.branch"].includes(parentKind) &&
              parent.result_commit === commit(action.parent_commit)) ||
              (parentKind === "github.draft_pr" &&
                successfulStandingReleasePredecessor(parent) &&
                parent.ticket.delegation_id === delegation.delegation_id &&
                parent.ticket.action.head_branch === action.branch &&
                commit(parent.ticket.action.head_commit) === commit(action.parent_commit) &&
                Number(delegation.usage?.commits || 0) >= 1)
            : action.kind === "git.push.branch"
              ? parentKind === "git.commit" && parent.result_commit === commit(action.source_commit)
              : action.kind === "github.draft_pr"
                ? parentKind === "git.push.branch" && parent.result_commit === commit(action.head_commit)
                : action.kind === "github.ready"
                  ? (parentKind === "github.draft_pr" &&
                      action.origin_draft_ticket_id === undefined &&
                      parent.ticket.action.head_commit === commit(action.head_commit) &&
                      parent.ticket.action.head_branch === action.head_branch &&
                      parent.ticket.action.base_branch === action.base_branch &&
                      parent.result_pull_request === positiveInteger(
                        action.pull_request,
                        "standing_release_pull_request_invalid",
                        Number.MAX_SAFE_INTEGER,
                      )) ||
                    (parentKind === "git.push.branch" && (() => {
                      resolveStandingRepairReadyOrigin({
                        state: initial,
                        delegation,
                        standingBinding,
                        tenantId,
                        hostKind: host_kind,
                        hostSessionFingerprint: host_session_fingerprint,
                        readyAction: action,
                        repairPush: parent,
                      });
                      return true;
                    })())
                  : action.kind === "github.merge"
                    ? parentKind === "github.ready" &&
                      parent.ticket.action.head_commit === commit(action.head_commit) &&
                      parent.ticket.action.head_branch === action.head_branch &&
                      parent.ticket.action.base_branch === action.base_branch &&
                      positiveInteger(
                        parent.ticket.action.pull_request,
                        "standing_release_pull_request_invalid",
                        Number.MAX_SAFE_INTEGER,
                      ) === positiveInteger(
                        action.pull_request,
                        "standing_release_pull_request_invalid",
                        Number.MAX_SAFE_INTEGER,
                      ) && (parent.ticket.action.origin_draft_ticket_id
                        ? (() => {
                          if (!successfulStandingReleasePredecessor(parent) ||
                            parent.ticket.delegation_id !== delegation.delegation_id ||
                            (action.origin_draft_ticket_id !== undefined &&
                              action.origin_draft_ticket_id !==
                                parent.ticket.action.origin_draft_ticket_id)) {
                            fail("standing_release_origin_draft_mismatch");
                          }
                          const repairPush = initial.tickets?.[
                            parent.ticket.predecessor?.ticket_id
                          ];
                          const draft = resolveStandingRepairReadyOrigin({
                            state: initial,
                            delegation,
                            standingBinding,
                            tenantId,
                            hostKind: host_kind,
                            hostSessionFingerprint: host_session_fingerprint,
                            readyAction: parent.ticket.action,
                            repairPush,
                          });
                          return commit(parent.ticket.action.expected_base_commit) ===
                              commit(action.expected_base_commit) &&
                            draft.ticket.action.head_branch === action.head_branch &&
                            draft.ticket.action.base_branch === action.base_branch &&
                            commit(draft.ticket.action.expected_base_commit) ===
                              commit(action.expected_base_commit) &&
                            draft.result_pull_request === positiveInteger(
                              action.pull_request,
                              "standing_release_pull_request_invalid",
                              Number.MAX_SAFE_INTEGER,
                            );
                        })()
                        : (() => {
                          if (action.origin_draft_ticket_id !== undefined) {
                            fail("standing_release_origin_draft_mismatch");
                          }
                          const draft = initial.tickets?.[
                            parent.ticket.predecessor?.ticket_id
                          ];
                          return draft?.ticket?.action?.kind === "github.draft_pr" &&
                            draft.ticket.action.head_branch === action.head_branch &&
                            draft.ticket.action.base_branch === action.base_branch &&
                            commit(draft.ticket.action.head_commit) ===
                              commit(action.head_commit) &&
                            commit(draft.ticket.action.expected_base_commit) ===
                              commit(action.expected_base_commit) &&
                            draft.result_pull_request === positiveInteger(
                              action.pull_request,
                              "standing_release_pull_request_invalid",
                              Number.MAX_SAFE_INTEGER,
                            );
                        })())
                    : true;
          if (!chainValid) fail("standing_release_predecessor_mismatch");
        }
        let finalizeAuthorization = null;
        if (action.kind === "render.deploy") {
          finalizeAuthorization = verifiedFinalizeAuthorization(parent, {
            signing,
            nowValue,
            tenantId,
            workId: delegation.grant.work_id,
            repository: delegation.grant.repository,
            targetCommit: commit(action.target_commit),
          });
        }
        predecessor = {
          ticket_id: parent.ticket.ticket_id,
          ticket_digest: hostNativeDigest(parent.ticket),
          result_commit: finalizeAuthorization?.target_commit || parent.result_commit || null,
          ...(finalizeAuthorization ? {
            finalize_authorization_digest: finalizeAuthorization.authorization_digest,
          } : {}),
        };
      }
      if (isReleaseAction(action.kind)) {
        if (!input.release_manifest) fail("release_manifest_required");
        release_manifest = validateHostReleaseManifestV2(input.release_manifest, {
          tenant_id: tenantId,
          work_id: delegation.grant.work_id,
          intent_anchor_digest: delegation.grant.intent_anchor_digest,
          repository: delegation.grant.repository,
        });
        if (standingBinding) {
          const manifestServices = release_manifest.delivery.services.map((service) => ({
            service_id: service.service_id,
            environment: service.environment,
            health_contract_digest: service.health_contract_digest,
          })).sort((left, right) =>
            `${left.service_id}\u0000${left.environment}`.localeCompare(
              `${right.service_id}\u0000${right.environment}`,
            ));
          if (
            release_manifest.base_branch !== standingMandate.base_branch ||
            (action.kind === "github.merge" &&
              release_manifest.delivery_branch !== standingMandate.base_branch) ||
            !sameStrings(release_manifest.changed_files, standingBinding.changed_files) ||
            release_manifest.verification.builder_agent_id !== standingBinding.builder_agent_id ||
            !sameStrings(
              release_manifest.verification.verifier_agent_ids,
              standingBinding.verifier_agent_ids,
            ) ||
            hostNativeDigest(manifestServices) !==
              hostNativeDigest(standingBinding.induced_services)
          ) fail("standing_release_release_manifest_drift");
        }
        // Render origins are materialized below and intentionally are not part
        // of the signed manifest digest.  Capture the immutable release intent
        // before adding that server-resolved runtime detail.
        release_intent_digest = deriveHostReleaseIntentV1(release_manifest).release_intent_digest;
        if (!sameStrings(release_manifest.verification.required_checks, delegation.grant.release_policy.required_checks)) {
          fail("required_checks_policy_mismatch");
        }
        if (action.kind === "github.merge") {
          if (action.base_branch !== release_manifest.delivery_branch || action.head_commit !== release_manifest.head_commit ||
              action.expected_base_commit !== release_manifest.base_commit) fail("release_manifest_action_mismatch");
          if (release_manifest.delivery.services.some((service) =>
            service.target_commit !== null || service.target_resolution !== "post_merge_readback")) {
            fail("github_merge_post_merge_readback_required");
          }
          const induced = Array.isArray(action.induced_effects) ? action.induced_effects : [];
          if (induced.length < 1) fail("induced_deploy_required");
          const expected = release_manifest.delivery.services.map((service) => `${service.service_id}\u0000${service.environment}`).sort();
          const actual = induced.map((service) => `${service?.service_id}\u0000${service?.environment}`).sort();
          if (!sameStrings(expected, actual)) fail("induced_effect_mismatch");
        }
        if (input.bootstrap_release_exception_receipt !== undefined) {
          if (!bootstrapReleaseExceptionStore || typeof bootstrapReleaseExceptionStore.verifyAndRecord !== "function") {
            fail("bootstrap_release_exception_store_unavailable");
          }
          if (typeof bootstrapDeadlockVerdictResolver !== "function") {
            fail("bootstrap_deadlock_verdict_unavailable");
          }
          const bootstrapExceptionId = text(
            input.bootstrap_release_exception_receipt?.exception_id,
            "bootstrap_release_exception_id_invalid",
            240,
          );
          const corePolicyVerdictDigest = digest(
            input.bootstrap_release_exception_receipt?.core_policy_verdict_digest,
          );
          let bootstrapDeadlockVerdict;
          try {
            bootstrapDeadlockVerdict = await bootstrapDeadlockVerdictResolver({
              tenant_id: tenantId,
              work_id: delegation.grant.work_id,
              repository: delegation.grant.repository,
              pr_number: action.pull_request,
              head_sha: action.head_commit,
              action: "github.merge",
              exception_id: bootstrapExceptionId,
              core_policy_verdict_digest: corePolicyVerdictDigest,
            });
          } catch (error) {
            fail(String(error?.message || "bootstrap_deadlock_verdict_denied"));
          }
          if (!bootstrapDeadlockVerdict || typeof bootstrapDeadlockVerdict !== "object" ||
              Array.isArray(bootstrapDeadlockVerdict) ||
              bootstrapDeadlockVerdict.classification !== "BOOTSTRAP_DEADLOCK_VERIFIED" ||
              bootstrapDeadlockVerdict.active !== true ||
              bootstrapDeadlockVerdict.exception_id !== bootstrapExceptionId ||
              bootstrapDeadlockVerdict.core_policy_verdict_digest !== corePolicyVerdictDigest ||
              Date.parse(bootstrapDeadlockVerdict.expires_at || "") <= nowValue) {
            fail("bootstrap_deadlock_verdict_denied");
          }
          let verified;
          try {
            verified = await bootstrapReleaseExceptionStore.verifyAndRecord({
              receipt: input.bootstrap_release_exception_receipt,
              expected: {
                tenant_id: tenantId,
                work_id: delegation.grant.work_id,
                repository: delegation.grant.repository,
                pr_number: action.pull_request,
                head_sha: action.head_commit,
                action: "github.merge",
                required_checks: release_manifest.verification.required_checks,
                required_checks_digest: release_manifest.verification.checks_digest,
                required_checks_policy_digest: await resolveCoreJoinRequiredChecksPolicyDigest(input, release_manifest),
                bootstrap_deadlock_verdict: clone(bootstrapDeadlockVerdict),
              },
            });
          } catch (error) {
            fail(String(error?.message || "bootstrap_release_exception_denied"));
          }
          const candidate = verified?.candidate;
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
              candidate.tenant_id !== tenantId || candidate.work_id !== delegation.grant.work_id ||
              candidate.repository !== delegation.grant.repository || candidate.pr_number !== action.pull_request ||
              candidate.exception_id !== bootstrapExceptionId ||
              candidate.head_sha !== action.head_commit || candidate.allowed_action !== "github.merge" ||
              !candidate.receipt_digest || Date.parse(candidate.expires_at || "") <= nowValue) {
            fail("bootstrap_release_exception_denied");
          }
          bootstrapReleaseExceptionCandidate = clone(candidate);
        }
        if (action.kind === "git.push.protected") {
          if (action.branch !== release_manifest.delivery_branch || action.source_commit !== release_manifest.head_commit ||
              action.expected_remote_commit !== release_manifest.base_commit) fail("release_manifest_action_mismatch");
          const induced = Array.isArray(action.induced_effects) ? action.induced_effects : [];
          const expected = release_manifest.delivery.services.map((service) => `${service.service_id}\u0000${service.environment}`).sort();
          const actual = induced.map((service) => `${service?.service_id}\u0000${service?.environment}`).sort();
          if (!sameStrings(expected, actual)) fail("induced_effect_mismatch");
        }
        if (["render.deploy", "render.rollback"].includes(action.kind)) {
          const service = release_manifest.delivery.services.find((entry) =>
            entry.service_id === action.service_id && entry.environment === action.environment);
          if (!service || service.target_commit !== action.target_commit || service.expected_previous_commit !== action.expected_live_commit) {
            fail("release_manifest_action_mismatch");
          }
          if (action.kind === "render.deploy" && action.environment === "production" && (
            release_manifest.delivery.method !== "manual_render_deploy" ||
            release_manifest.delivery.services.some((entry) => entry.target_commit === null) ||
            action.branch !== release_manifest.delivery_branch ||
            action.base_branch !== release_manifest.base_branch ||
            action.source_commit !== release_manifest.head_commit ||
            action.target_commit !== release_manifest.head_commit ||
            action.target_commit !== release_manifest.verification.checks_commit ||
            action.expected_base_commit !== release_manifest.base_commit ||
            action.rollback_commit !== service.expected_previous_commit ||
            action.health_contract_digest !== service.health_contract_digest
          )) fail("release_manifest_action_mismatch");
          if (action.kind === "render.deploy" && action.environment === "staging" && (
            !Number.isSafeInteger(Number(action.pull_request)) || Number(action.pull_request) < 1 ||
            action.branch !== release_manifest.delivery_branch ||
            action.source_commit !== release_manifest.head_commit ||
            action.base_branch !== release_manifest.base_branch ||
            action.expected_base_commit !== release_manifest.base_commit
          )) fail("release_manifest_action_mismatch");
        }
        if (action.kind === "render.observe") {
          if (manualMergeReadback) {
            const github = manualMergeReadback.github_readback;
            coreJoin = initial.core_join_verdicts[manualMergeReadback.core_join_verdict_id];
            const joinExpiresAt = Date.parse(coreJoin?.verdict?.expires_at || "");
            const refreshedManualMerge = Boolean(manualMergeReadback.refresh_lineage);
            const coreJoinVerified = refreshedManualMerge
              ? coreJoinRecordSignatureValid(coreJoin, signing)
              : governance.verifyCoreJoinVerdict(coreJoin);
            if (refreshedManualMerge && (!trusted.software_closure_digest ||
                !trusted.software_closure_fresh_until)) {
              fail("owner_manual_merge_refresh_software_cognition_invalid");
            }
            if (
              !coreJoin || coreJoin.state !== "active" || coreJoin.uses !== 0 ||
              coreJoin.authorized_ticket_id ||
              coreJoin.manual_merge_readback_receipt_id !== manualMergeReadback.receipt_id ||
              coreJoin.manual_merge_readback_receipt_digest !== manualMergeReadback.receipt_digest ||
              !coreJoinVerified ||
              !Number.isFinite(joinExpiresAt) ||
              (!refreshedManualMerge && joinExpiresAt <= nowValue) ||
              coreJoin.claim?.tenant_id !== tenantId ||
              coreJoin.claim?.work_id !== delegation.grant.work_id ||
              coreJoin.claim?.intent_anchor_digest !== delegation.grant.intent_anchor_digest ||
              coreJoin.claim?.repository !== delegation.grant.repository ||
              coreJoin.claim?.release_intent_digest !== release_intent_digest ||
              manualMergeReadback.tenant_id !== tenantId ||
              manualMergeReadback.work_id !== delegation.grant.work_id ||
              manualMergeReadback.intent_anchor_digest !== delegation.grant.intent_anchor_digest ||
              manualMergeReadback.repository !== delegation.grant.repository ||
              manualMergeReadback.owner_subject_fingerprint !==
                delegation.grant.owner_confirmation?.owner_subject_fingerprint ||
              evidence_digest !== manualMergeReadback.receipt_digest ||
              action.repository !== delegation.grant.repository ||
              action.branch !== github.base_branch ||
              action.target_commit !== github.merge_commit ||
              action.release_manifest_digest !== release_manifest.manifest_digest ||
              release_manifest.base_branch !== github.base_branch ||
              release_manifest.delivery_branch !== github.base_branch ||
              release_manifest.base_commit !== github.base_commit ||
              release_manifest.head_commit !== github.head_commit ||
              release_manifest.verification.checks_commit !== github.checks_commit ||
              release_manifest.verification.core_join_verdict_id !== coreJoin.verdict_id ||
              release_manifest.delivery.services.some((service) =>
                service.target_commit !== null ||
                service.target_resolution !== "post_merge_readback")
            ) fail("owner_manual_merge_observation_binding_invalid");
            const resolvedServices = [];
            for (const service of release_manifest.delivery.services) {
              let origin = service.origin;
              if (typeof renderServiceOriginResolver === "function") {
                origin = await renderServiceOriginResolver({
                  tenant_id: tenantId,
                  repository: delegation.grant.repository,
                  service_id: service.service_id,
                  environment: service.environment,
                });
              }
              resolvedServices.push({
                ...service,
                origin: validRenderOrigin(
                  origin || `https://${service.service_id}.onrender.com`,
                ),
              });
            }
            release_manifest = {
              ...release_manifest,
              delivery: { ...release_manifest.delivery, services: resolvedServices },
            };
            const sourceAction = {
              kind: "github.merge",
              repository: delegation.grant.repository,
              head_branch: github.head_branch,
              base_branch: github.base_branch,
              pull_request: manualMergeReadback.pull_request,
              head_commit: github.head_commit,
              expected_base_commit: github.base_commit,
              checks_commit: github.checks_commit,
              provider_execution: false,
            };
            predecessor = {
              schema_version: "host_native_owner_manual_merge_predecessor_v2",
              predecessor_type: "owner_manual_github_merge_readback",
              manual_merge_readback_id: manualMergeReadback.receipt_id,
              manual_merge_readback_digest: manualMergeReadback.receipt_digest,
              source_readback_digest: github.readback_digest,
              core_join_verdict_id: coreJoin.verdict_id,
              core_join_record_digest: manualMergeReadback.core_join_record_digest,
              result_commit: github.merge_commit,
              source_action: sourceAction,
              source_action_digest: hostNativeDigest(sourceAction),
              source_evidence_digest: manualMergeReadback.receipt_digest,
              source_required_checks_policy_digest:
                github.required_checks_policy_digest,
              ...(manualMergeReadback.refresh_lineage ? {
                refresh_lineage: clone(manualMergeReadback.refresh_lineage),
                refresh_lineage_digest: hostNativeDigest(
                  manualMergeReadback.refresh_lineage,
                ),
              } : {}),
              retrospective_ticket_issued: false,
              provider_execution: false,
            };
            if (typeof releaseJoinVerdictResolver !== "function") {
              fail("release_join_verdict_unavailable");
            }
            release_join_resolution = await releaseJoinVerdictResolver({
              core_join_verified: coreJoinVerified,
              core_join_issued_at: coreJoin.verdict.issued_at,
              core_join_expires_at: coreJoin.verdict.expires_at,
              verdict_id: coreJoin.verdict_id,
              tenant_id: tenantId,
              work_id: delegation.grant.work_id,
              intent_anchor_digest: delegation.grant.intent_anchor_digest,
              repository: delegation.grant.repository,
              checks_commit: release_manifest.verification.checks_commit,
              required_checks: release_manifest.verification.required_checks,
              required_checks_policy_digest:
                coreJoin.claim.required_checks_policy_digest,
              evidence_digest,
              source_evidence: {
                base_commit: release_manifest.base_commit,
                head_commit: release_manifest.head_commit,
                tree_sha: release_manifest.tree_sha,
                diff_digest: release_manifest.diff_digest,
                changed_files: release_manifest.changed_files,
              },
              delivery_services: resolvedServices.map((service) => ({
                service_id: service.service_id,
                environment: service.environment,
                origin: service.origin,
                expected_previous_commit: service.expected_previous_commit,
                health_contract_digest: service.health_contract_digest,
              })),
              rollback: release_manifest.rollback,
              action,
              manual_merge_readback: clone(manualMergeReadback),
            });
            if (
              !release_join_resolution ||
              release_join_resolution.trusted !== true ||
              release_join_resolution.allowed !== true ||
              release_join_resolution.provider_execution !== false ||
              release_join_resolution.verdict_id !== coreJoin.verdict_id ||
              release_join_resolution.tenant_id !== tenantId ||
              release_join_resolution.work_id !== delegation.grant.work_id ||
              release_join_resolution.intent_anchor_digest !==
                delegation.grant.intent_anchor_digest ||
              release_join_resolution.repository !== delegation.grant.repository ||
              release_join_resolution.evidence_digest !== evidence_digest
            ) fail("release_join_verdict_untrusted");
          } else {
          const parent = initial.tickets[String(action.parent_release_ticket_id || "")];
          const parentTicket = parent?.ticket;
          const parentTicketDigest = parentTicket && hostNativeDigest(parentTicket);
          const sourceAction = parentTicket?.action;
          const sourceKind = sourceAction?.kind;
          const sourceBranch = sourceKind === "github.merge"
            ? sourceAction?.base_branch
            : sourceAction?.branch;
          const parentBinding = parentTicket?.release_manifest_binding;
          const parentResolution = parentTicket?.release_join_resolution;
          const usesExpiredDelegationContinuation = parentTicket?.delegation_id !==
            delegation.delegation_id;
          if (
            !parent || !["completed", "reconciled"].includes(parent.state) ||
            (parent.outcome !== "success" && parent.observed_outcome !== "success") ||
            !["github.merge", "git.push.protected"].includes(sourceKind) ||
            parentTicket.bootstrap_release_exception_candidate ||
            parentTicket.tenant_id !== tenantId ||
            parentTicket.work_id !== delegation.grant.work_id ||
            parentTicket.repository !== delegation.grant.repository ||
            parentTicket.host_kind !== host_kind ||
            parentTicket.host_session_fingerprint !== host_session_fingerprint ||
            action.parent_release_ticket_digest !== parentTicketDigest ||
            action.release_manifest_digest !== release_manifest.manifest_digest ||
            action.release_manifest_digest !== parentTicket.release_manifest_digest ||
            evidence_digest !== parentTicket.evidence_digest ||
            parentResolution?.evidence_digest !== parentTicket.evidence_digest ||
            parentBinding?.manifest_digest !== parentTicket.release_manifest_digest ||
            parentBinding?.repository !== delegation.grant.repository ||
            parentBinding?.delivery_branch !== sourceBranch || action.branch !== sourceBranch
          ) {
            fail("predecessor_ticket_invalid");
          }
          if (usesExpiredDelegationContinuation) {
            ensureObservationOnlyActionShape(action);
            const parentDelegation = initial.delegations[parentTicket.delegation_id];
            ensureExpiredObserveContinuationDelegations({
              parentDelegation,
              successorDelegation: delegation,
              parentTicket,
              tenantId,
              workId: delegation.grant.work_id,
              intentAnchorDigest: delegation.grant.intent_anchor_digest,
              repository: delegation.grant.repository,
              hostKind: host_kind,
              hostSessionFingerprint: host_session_fingerprint,
              nowValue,
              signing,
              successorUsage: 0,
            });
            expiredDelegationContinuation = { parentDelegation };
          }
          const finalizeAuthorization = verifiedFinalizeAuthorization(parent, {
            signing,
            nowValue,
            tenantId,
            workId: delegation.grant.work_id,
            repository: delegation.grant.repository,
            targetCommit: commit(action.target_commit),
          });
          const service = parentBinding.delivery?.services?.find((entry) =>
            entry.service_id === action.service_id && entry.environment === action.environment);
          if (!service || finalizeAuthorization.target_commit !== action.target_commit) {
            fail("predecessor_ticket_invalid");
          }
          coreJoin = initial.core_join_verdicts[parentTicket.core_join_verdict_id];
          if (
            !coreJoin || coreJoin.state !== "consumed" || coreJoin.uses !== 1 ||
            hostNativeDigest(coreJoin.claim) !== coreJoin.claim_digest ||
            coreJoin.consumed_by_ticket_id !== parentTicket.ticket_id ||
            coreJoin.verdict_id !== parentTicket.core_join_verdict_id ||
            coreJoin.claim_digest !== parentTicket.core_join_verdict_digest ||
            coreJoin.claim?.tenant_id !== tenantId ||
            coreJoin.claim?.work_id !== delegation.grant.work_id ||
            coreJoin.claim?.intent_anchor_digest !== delegation.grant.intent_anchor_digest ||
            coreJoin.claim?.repository !== delegation.grant.repository ||
            coreJoin.claim?.release_intent_digest !== parentTicket.release_intent_digest ||
            parentResolution?.verdict_id !== coreJoin.verdict_id ||
            parentResolution?.tenant_id !== tenantId ||
            parentResolution?.work_id !== delegation.grant.work_id ||
            parentResolution?.intent_anchor_digest !== delegation.grant.intent_anchor_digest ||
            parentResolution?.repository !== delegation.grant.repository
          ) {
            fail("core_join_verdict_binding_mismatch");
          }
          const sourceRequiredChecksPolicyDigest = coreJoin.claim.required_checks_policy_digest;
          if (
            !SHA256.test(String(sourceRequiredChecksPolicyDigest || "")) ||
            finalizeAuthorization.github_readback?.required_checks_policy_digest !==
              sourceRequiredChecksPolicyDigest
          ) fail("required_checks_policy_mismatch");
          release_manifest = clone(parentBinding);
          release_join_resolution = clone(parentResolution);
          release_intent_digest = parentTicket.release_intent_digest;
          const delegationContinuation = expiredDelegationContinuation
            ? signDelegationContinuation({
              parentDelegation: expiredDelegationContinuation.parentDelegation,
              successorDelegation: delegation,
              parentTicket,
              parentTicketDigest,
              parentFinalizeAuthorizationDigest:
                finalizeAuthorization.authorization_digest,
              sourceActionDigest: hostNativeDigest(sourceAction),
              sourceRequiredChecksPolicyDigest,
              hostKind: host_kind,
              hostSessionFingerprint: host_session_fingerprint,
              issuedAt: iso(nowValue),
            }, signing)
            : null;
          predecessor = {
            ticket_id: parentTicket.ticket_id,
            ticket_digest: parentTicketDigest,
            result_commit: finalizeAuthorization.target_commit,
            finalize_authorization: clone(finalizeAuthorization),
            finalize_authorization_digest: finalizeAuthorization.authorization_digest,
            source_action: clone(sourceAction),
            source_action_digest: hostNativeDigest(sourceAction),
            source_evidence_digest: parentTicket.evidence_digest,
            source_required_checks_policy_digest: sourceRequiredChecksPolicyDigest,
            ...(delegationContinuation
              ? { delegation_continuation: delegationContinuation }
              : {}),
          };
          }
        } else if (bootstrapReleaseExceptionCandidate) {
          const resolvedServices = [];
          for (const service of release_manifest.delivery.services) {
            let origin = service.origin;
            if (typeof renderServiceOriginResolver === "function") {
              origin = await renderServiceOriginResolver({
                tenant_id: tenantId,
                repository: delegation.grant.repository,
                service_id: service.service_id,
                environment: service.environment,
              });
            }
            origin = validRenderOrigin(origin || `https://${service.service_id}.onrender.com`);
            resolvedServices.push({ ...service, origin });
          }
          release_manifest = {
            ...release_manifest,
            delivery: { ...release_manifest.delivery, services: resolvedServices },
          };
        } else {
          coreJoin = initial.core_join_verdicts[release_manifest.verification.core_join_verdict_id];
          if (!coreJoin) fail("core_join_verdict_not_found");
          if (coreJoin.tenant_id !== tenantId) fail("cross_tenant_core_join_verdict_denied");
          if (coreJoin.manual_merge_readback_receipt_id) {
            fail("core_join_manual_merge_already_observed");
          }
          if (coreJoin.state !== "active") fail("core_join_verdict_consumed");
          const coreJoinExpiresAt = Date.parse(coreJoin.verdict?.expires_at || "");
          if (!Number.isFinite(coreJoinExpiresAt) || coreJoinExpiresAt <= nowValue) {
            fail("core_join_verdict_expired");
          }
          if (coreJoin.claim.release_intent_digest !== release_intent_digest) {
            fail("core_join_verdict_binding_mismatch");
          }
          if (typeof releaseJoinVerdictResolver !== "function") fail("release_join_verdict_unavailable");
          const resolvedServices = [];
          for (const service of release_manifest.delivery.services) {
            let origin = service.origin;
            if (typeof renderServiceOriginResolver === "function") {
              origin = await renderServiceOriginResolver({
                tenant_id: tenantId,
                repository: delegation.grant.repository,
                service_id: service.service_id,
                environment: service.environment,
              });
            }
            origin = validRenderOrigin(origin || `https://${service.service_id}.onrender.com`);
            resolvedServices.push({ ...service, origin });
          }
          release_manifest = {
            ...release_manifest,
            delivery: { ...release_manifest.delivery, services: resolvedServices },
          };
          const resolutionInput = {
            core_join_verified: governance.verifyCoreJoinVerdict(coreJoin),
            core_join_issued_at: coreJoin.verdict.issued_at,
            core_join_expires_at: coreJoin.verdict.expires_at,
            verdict_id: coreJoin.verdict_id,
            tenant_id: tenantId,
            work_id: delegation.grant.work_id,
            intent_anchor_digest: delegation.grant.intent_anchor_digest,
            repository: delegation.grant.repository,
            checks_commit: release_manifest.verification.checks_commit,
            required_checks: release_manifest.verification.required_checks,
            ...(coreJoin.claim.required_checks_policy_digest ? {
              required_checks_policy_digest: coreJoin.claim.required_checks_policy_digest,
            } : {}),
            evidence_digest,
            source_evidence: {
              base_commit: release_manifest.base_commit,
              head_commit: release_manifest.head_commit,
              tree_sha: release_manifest.tree_sha,
              diff_digest: release_manifest.diff_digest,
              changed_files: release_manifest.changed_files,
            },
            delivery_services: resolvedServices.map((service) => ({
              service_id: service.service_id,
              environment: service.environment,
              origin: service.origin,
              expected_previous_commit: service.expected_previous_commit,
              health_contract_digest: service.health_contract_digest,
            })),
            rollback: release_manifest.rollback,
            action,
          };
          release_join_resolution = await releaseJoinVerdictResolver(resolutionInput);
          if (
            !release_join_resolution || release_join_resolution.trusted !== true ||
            release_join_resolution.allowed !== true || release_join_resolution.provider_execution !== false ||
            release_join_resolution.verdict_id !== coreJoin.verdict_id ||
            release_join_resolution.tenant_id !== tenantId ||
            release_join_resolution.repository !== delegation.grant.repository
          ) {
            fail("release_join_verdict_untrusted");
          }
        }
      }
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "issueActionTicket", input);
        if (descriptor?.result) return validateStandingReplay(state, descriptor.result, nowValue);
        const currentDelegation = state.delegations[String(input.delegation_id || "")];
        if (!currentDelegation || !delegationActive(currentDelegation, nowValue)) fail("delegation_not_active");
        ensureStandingReleaseDelegationActive(state, currentDelegation, nowValue);
        let releaseJoin = null;
        let supersededTicket = null;
        if (isReleaseAction(action.kind) && action.kind !== "render.observe" && !bootstrapReleaseExceptionCandidate) {
          releaseJoin = state.core_join_verdicts[release_manifest.verification.core_join_verdict_id];
          if (!releaseJoin || releaseJoin.state !== "active") fail("core_join_verdict_consumed");
          const joinExpiresAt = Date.parse(releaseJoin.verdict?.expires_at || "");
          if (!Number.isFinite(joinExpiresAt) || joinExpiresAt <= nowValue) {
            fail("core_join_verdict_expired");
          }
          const priorTicket = state.tickets[String(releaseJoin.authorized_ticket_id || "")];
          if (
            priorTicket?.state === "issued" &&
            priorTicket.uses === 0 &&
            Date.parse(priorTicket.ticket?.expires_at || "") > nowValue
          ) {
            fail("core_join_ticket_active");
          }
          if (priorTicket) {
            if (
              priorTicket.state !== "issued" ||
              priorTicket.uses !== 0 ||
              Date.parse(priorTicket.ticket?.expires_at || "") > nowValue ||
              priorTicket.ticket.host_session_fingerprint !== host_session_fingerprint ||
              priorTicket.ticket.evidence_digest !== evidence_digest ||
              priorTicket.ticket.release_manifest_digest !== release_manifest.manifest_digest ||
              priorTicket.ticket.release_intent_digest !== release_intent_digest ||
              hostNativeDigest(priorTicket.ticket.action) !== hostNativeDigest(action)
            ) {
              fail("core_join_ticket_replacement_binding_mismatch");
            }
            supersededTicket = priorTicket;
          }
        }
        const semanticScopeAtIssue = semanticScopeDecision({
          delegation: currentDelegation,
          action,
          tenantId,
          hostKind: host_kind,
          hostSessionFingerprint: host_session_fingerprint,
          phase: "ISSUE",
        });
        if (semanticScopeEnforcedDenial(semanticScopeAtIssue)) {
          fail(`semantic_scope_${semanticScopeAtIssue.action.toLowerCase()}`);
        }
        const usage = actionUsage(action.kind, action, currentDelegation);
        ensureBudget(currentDelegation, usage);
        const ticketId = makeId("hnt", { input, issued_at: iso(nowValue) });
        if (manualMergeReadback) {
          const currentReceipt = state.owner_manual_merge_readbacks?.[
            manualMergeReadback.receipt_id
          ];
          const manualJoin = state.core_join_verdicts?.[
            manualMergeReadback.core_join_verdict_id
          ];
          if (
            !currentReceipt ||
            currentReceipt.receipt_digest !== manualMergeReadback.receipt_digest ||
            state.owner_manual_merge_successors?.[manualMergeReadback.receipt_id] ||
            !manualJoin || manualJoin.state !== "active" || manualJoin.uses !== 0 ||
            manualJoin.authorized_ticket_id ||
            manualJoin.manual_merge_readback_receipt_id !== currentReceipt.receipt_id ||
            manualJoin.manual_merge_readback_receipt_digest !== currentReceipt.receipt_digest
          ) fail("owner_manual_merge_readback_predecessor_changed");
          manualJoin.authorized_ticket_id = ticketId;
          manualJoin.authorized_at = iso(nowValue);
        }
        if (releaseJoin) {
          releaseJoin.authorized_ticket_id = ticketId;
          releaseJoin.authorized_at = iso(nowValue);
        }
        if (supersededTicket) {
          supersededTicket.state = "superseded";
          supersededTicket.superseded_by_ticket_id = ticketId;
          supersededTicket.superseded_at = iso(nowValue);
        }
        const expiresAt = Math.min(Date.parse(currentDelegation.grant.expires_at), nowValue + ticketTtl);
        const ticketUnsigned = {
          schema_version: "host_native_action_ticket_v1",
          ticket_id: ticketId,
          delegation_id: currentDelegation.delegation_id,
          tenant_id: tenantId,
          work_id: currentDelegation.grant.work_id,
          intent_anchor_digest: currentDelegation.grant.intent_anchor_digest,
          repository: currentDelegation.grant.repository,
          host_kind,
          host_session_fingerprint,
          action,
          evidence_digest,
          issued_at: iso(nowValue),
          expires_at: iso(expiresAt),
          max_uses: 1,
          host_policy_override: false,
          host_policy_must_allow: true,
          provider_execution: false,
          ...(semanticScopeAtIssue ? { semantic_scope_at_issue: semanticScopeAtIssue } : {}),
          ...(predecessor ? { predecessor, predecessor_chain_digest: hostNativeDigest(predecessor) } : {}),
          ...(release_manifest ? {
            release_manifest_digest: release_manifest.manifest_digest,
            release_manifest_binding: ticketReleaseBinding(release_manifest),
            release_intent_digest,
            ...(bootstrapReleaseExceptionCandidate ? {
              bootstrap_release_exception_candidate: bootstrapReleaseExceptionCandidate,
            } : {
              core_join_verdict_id: coreJoin?.verdict_id,
              core_join_verdict_digest: coreJoin?.claim_digest,
              release_join_resolution,
              release_join_resolution_digest: hostNativeDigest(release_join_resolution),
            }),
          } : {}),
        };
        const ticket = { ...ticketUnsigned, signature: ticketSignature(signing, ticketUnsigned) };
        const record = { state: "issued", uses: 0, ticket };
        if (manualMergeReadback) {
          state.owner_manual_merge_successors[manualMergeReadback.receipt_id] = {
            schema_version: "host_native_owner_manual_merge_successor_v1",
            manual_merge_readback_id: manualMergeReadback.receipt_id,
            manual_merge_readback_digest: manualMergeReadback.receipt_digest,
            ticket_id: ticket.ticket_id,
            ticket_digest: hostNativeDigest(ticket),
            created_at: iso(nowValue),
          };
        }
        if (action.kind === "render.observe") {
          validateStoredObserveDelegationContinuation(record, state, {
            nowValue,
            signing,
            successorUsage: 0,
          });
        }
        state.tickets[ticketId] = record;
        return saveIdempotent(state, descriptor, record);
      });
    },

    async readActionTicket({ tenant_id, ticket_id } = {}) {
      return readTicketRecord(text(tenant_id, "tenant_id_invalid", 160), ticket_id);
    },

    verifyActionTicket(ticket) {
      try { return safeEqual(ticket?.signature, ticketSignature(signing, ticket)); }
      catch { return false; }
    },

    async reserveStandingReleaseRunTicket(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "run_id", "work_id", "intent_anchor_digest", "intent_binding",
        "ticket_id", "expected_version", "host_session_fingerprint",
        "dtt_session_fingerprint", "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const state = store.readState();
      const runRecord = readStandingReleaseRunRecord(state, tenantId, input.run_id);
      const run = verifiedStandingReleaseRunRecord(runRecord);
      if (text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase() !== run.work_id) {
        fail("standing_release_run_work_mismatch");
      }
      if (
        input.expected_version !== run.version ||
        run.state !== "ACTION_IN_PROGRESS" ||
        run.active_action?.ticket_id !== String(input.ticket_id || "")
      ) fail("standing_release_run_version_conflict");
      ensureStandingReleaseRunAuthority(state, run, nowMillis(now));
      freshStandingReleaseRunIntent(input, tenantId, run, nowMillis(now));
      return governance.reserveActionTicket({
        tenant_id: tenantId,
        ticket_id: input.ticket_id,
        host_session_fingerprint: input.host_session_fingerprint,
        standing_release_run_id: run.run_id,
        standing_release_run_version: run.version,
        dtt_request_binding_digest: input.dtt_request_binding_digest,
        idempotency_key: input.idempotency_key,
      }, trusted);
    },

    async completeStandingReleaseRunTicket(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "run_id", "work_id", "intent_anchor_digest", "intent_binding",
        "ticket_id", "expected_version", "reservation_id", "host_session_fingerprint",
        "outcome", "result_digest", "result_commit", "result_pull_request",
        "readback_digest", "dtt_session_fingerprint", "dtt_request_binding_digest",
        "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const state = store.readState();
      const runRecord = readStandingReleaseRunRecord(state, tenantId, input.run_id);
      const run = verifiedStandingReleaseRunRecord(runRecord);
      if (text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase() !== run.work_id) {
        fail("standing_release_run_work_mismatch");
      }
      if (
        input.expected_version !== run.version ||
        run.state !== "ACTION_IN_PROGRESS" ||
        run.active_action?.ticket_id !== String(input.ticket_id || "")
      ) fail("standing_release_run_version_conflict");
      const nowValue = nowMillis(now);
      ensureStandingReleaseRunAuthority(state, run, nowValue);
      freshStandingReleaseRunIntent(input, tenantId, run, nowValue);
      return governance.completeActionTicket({
        tenant_id: tenantId,
        ticket_id: input.ticket_id,
        reservation_id: input.reservation_id,
        host_session_fingerprint: input.host_session_fingerprint,
        outcome: input.outcome,
        result_digest: input.result_digest,
        ...(input.result_commit === undefined ? {} : { result_commit: input.result_commit }),
        ...(input.result_pull_request === undefined
          ? {}
          : { result_pull_request: input.result_pull_request }),
        ...(input.readback_digest === undefined ? {} : { readback_digest: input.readback_digest }),
        standing_release_run_id: run.run_id,
        standing_release_run_version: run.version,
        dtt_request_binding_digest: input.dtt_request_binding_digest,
        idempotency_key: input.idempotency_key,
      }, trusted);
    },

    async reconcileStandingReleaseRunTicket(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "run_id", "work_id", "intent_anchor_digest", "intent_binding",
        "ticket_id", "expected_version", "reservation_id", "host_session_fingerprint",
        "observed_outcome", "observed_commit", "observed_pull_request", "readback_digest",
        "dtt_session_fingerprint", "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const state = store.readState();
      const runRecord = readStandingReleaseRunRecord(state, tenantId, input.run_id);
      const run = verifiedStandingReleaseRunRecord(runRecord);
      if (text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase() !== run.work_id) {
        fail("standing_release_run_work_mismatch");
      }
      if (
        input.expected_version !== run.version ||
        run.state !== "ACTION_IN_PROGRESS" ||
        run.active_action?.ticket_id !== String(input.ticket_id || "")
      ) fail("standing_release_run_version_conflict");
      const nowValue = nowMillis(now);
      ensureStandingReleaseRunAuthority(state, run, nowValue);
      freshStandingReleaseRunIntent(input, tenantId, run, nowValue);
      return governance.reconcileActionTicket({
        tenant_id: tenantId,
        ticket_id: input.ticket_id,
        reservation_id: input.reservation_id,
        host_session_fingerprint: input.host_session_fingerprint,
        observed_outcome: input.observed_outcome,
        ...(input.observed_commit === undefined ? {} : { observed_commit: input.observed_commit }),
        ...(input.observed_pull_request === undefined
          ? {}
          : { observed_pull_request: input.observed_pull_request }),
        readback_digest: input.readback_digest,
        standing_release_run_id: run.run_id,
        standing_release_run_version: run.version,
        dtt_request_binding_digest: input.dtt_request_binding_digest,
        idempotency_key: input.idempotency_key,
      }, trusted);
    },

    async reserveActionTicket(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "ticket_id", "host_session_fingerprint", "standing_release_run_id",
        "standing_release_run_version", "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const idempotencyInput = actionReservationIdempotencyInput(input);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "reserveActionTicket", idempotencyInput);
      if (replay?.result) return validateStandingReplay(initial, replay.result);
      const nowValue = nowMillis(now);
      const bootstrapTicket = initial.tickets[String(input.ticket_id || "")];
      if (bootstrapTicket) {
        ensureStandingReleaseRunReservation(initial, bootstrapTicket, input, nowValue);
      }
      const freshStandingMerge = bootstrapTicket
        ? await requireFreshStandingMergeReadback(initial, bootstrapTicket, nowValue)
        : null;
      if (bootstrapTicket?.ticket?.bootstrap_release_exception_candidate) {
        if (!bootstrapReleaseExceptionStore || typeof bootstrapReleaseExceptionStore.consume !== "function") {
          fail("bootstrap_release_exception_store_unavailable");
        }
        if (bootstrapTicket.ticket.tenant_id !== tenantId) fail("cross_tenant_action_ticket_denied");
        if (bootstrapTicket.state !== "issued") fail("replayed");
        if (Date.parse(bootstrapTicket.ticket.expires_at) <= nowValue) fail("action_ticket_expired");
        if (bootstrapTicket.ticket.host_session_fingerprint !== text(input.host_session_fingerprint, "host_session_mismatch", 300)) {
          fail("host_session_mismatch");
        }
        try {
          await bootstrapReleaseExceptionStore.consume({
            candidate: clone(bootstrapTicket.ticket.bootstrap_release_exception_candidate),
            expected: {
              tenant_id: tenantId,
              work_id: bootstrapTicket.ticket.work_id,
              repository: bootstrapTicket.ticket.repository,
              pr_number: bootstrapTicket.ticket.action.pull_request,
              head_sha: bootstrapTicket.ticket.action.head_commit,
              action: "github.merge",
            },
            action_ticket_id: bootstrapTicket.ticket.ticket_id,
            consumed_by: "host_native_reservation",
          });
        } catch (error) {
          fail(String(error?.message || "bootstrap_release_exception_consumption_denied"));
        }
      }
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "reserveActionTicket", idempotencyInput);
        if (descriptor?.result) return validateStandingReplay(state, descriptor.result, nowValue);
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record) fail("action_ticket_not_found");
        if (record.ticket.tenant_id !== tenantId) fail("cross_tenant_action_ticket_denied");
        if (record.ticket.host_session_fingerprint !== text(input.host_session_fingerprint, "host_session_mismatch", 300)) fail("host_session_mismatch");
        if (record.state !== "issued") fail("replayed");
        if (Date.parse(record.ticket.expires_at) <= nowValue) fail("action_ticket_expired");
        const delegation = state.delegations[record.ticket.delegation_id];
        if (!delegationActive(delegation, nowValue)) fail("delegation_not_active");
        ensureStandingReleaseDelegationActive(state, delegation, nowValue);
        ensureStandingReleaseRunReservation(state, record, input, nowValue);
        if (freshStandingMerge) {
          const join = state.core_join_verdicts?.[record.ticket.core_join_verdict_id];
          if (
            hostNativeDigest(record.ticket) !== freshStandingMerge.ticket_digest ||
            join?.claim_digest !== freshStandingMerge.core_join_claim_digest ||
            join?.state !== "active" || join?.uses !== 0 ||
            join?.authorized_ticket_id !== record.ticket.ticket_id
          ) fail("standing_release_pre_merge_state_drift");
        }
        if (record.ticket.action.kind === "render.observe") {
          validateStoredObserveDelegationContinuation(record, state, {
            nowValue,
            signing,
            successorUsage: 0,
          });
        }
        const reservationId = makeId("hnr", { ticket_id: record.ticket.ticket_id, nowValue });
        const semanticScopeAtReservation = semanticScopeDecision({
          delegation,
          action: record.ticket.action,
          tenantId,
          hostKind: record.ticket.host_kind,
          hostSessionFingerprint: record.ticket.host_session_fingerprint,
          phase: "RESERVATION",
          previousScopeState: record.ticket.semantic_scope_at_issue?.binding || null,
          authorityReservationRef: reservationId,
        });
        if (semanticScopeEnforcedDenial(semanticScopeAtReservation)) {
          fail(`semantic_scope_${semanticScopeAtReservation.action.toLowerCase()}`);
        }
        const usage = actionUsage(
          record.ticket.action.kind,
          record.ticket.action,
          delegation,
        );
        const nextUsage = ensureBudget(delegation, usage);
        const nextStandingUsage = standingReleaseUsageNext(
          delegation,
          record.ticket.action,
        );
        if (isReleaseAction(record.ticket.action.kind) && record.ticket.action.kind !== "render.observe" && !record.ticket.bootstrap_release_exception_candidate) {
          const join = state.core_join_verdicts[record.ticket.core_join_verdict_id];
          if (!join || join.tenant_id !== tenantId) fail("core_join_verdict_not_found");
          if (join.state !== "active") fail("core_join_verdict_consumed");
          if (join.authorized_ticket_id !== record.ticket.ticket_id) {
            fail("core_join_ticket_superseded");
          }
          const joinExpiresAt = Date.parse(join.verdict?.expires_at || "");
          if (!Number.isFinite(joinExpiresAt) || joinExpiresAt <= nowValue) {
            fail("core_join_verdict_expired");
          }
          if (
            join.claim_digest !== record.ticket.core_join_verdict_digest ||
            join.claim?.release_intent_digest !== record.ticket.release_intent_digest
          ) {
            fail("core_join_verdict_binding_mismatch");
          }
          join.state = "consumed";
          join.uses = 1;
          join.consumed_by_ticket_id = record.ticket.ticket_id;
        }
        if (record.ticket.predecessor?.predecessor_type ===
            "owner_manual_github_merge_readback") {
          const join = state.core_join_verdicts[record.ticket.core_join_verdict_id];
          const receiptId = record.ticket.predecessor.manual_merge_readback_id;
          const successor = state.owner_manual_merge_successors?.[receiptId];
          if (
            !join || join.tenant_id !== tenantId || join.state !== "active" ||
            join.uses !== 0 || join.authorized_ticket_id !== record.ticket.ticket_id ||
            join.claim_digest !== record.ticket.core_join_verdict_digest ||
            join.manual_merge_readback_receipt_id !== receiptId ||
            successor?.ticket_id !== record.ticket.ticket_id ||
            successor?.ticket_digest !== hostNativeDigest(record.ticket)
          ) fail("owner_manual_merge_observation_authority_invalid");
          join.state = "consumed";
          join.uses = 1;
          join.consumed_by_ticket_id = record.ticket.ticket_id;
        }
        delegation.usage = nextUsage;
        if (nextStandingUsage) delegation.standing_release_usage = nextStandingUsage;
        record.state = "reserved";
        record.uses = 1;
        if (freshStandingMerge) {
          record.pre_merge_readback_digest =
            freshStandingMerge.pre_merge_readback_digest;
        }
        record.reservation_id = reservationId;
        record.reserved_at = iso(nowValue);
        record.reservation_expires_at = iso(nowValue + leaseMs);
        if (semanticScopeAtReservation) {
          record.semantic_scope_at_reservation = semanticScopeAtReservation;
        }
        signActionTicketLifecycleRecord(record);
        return saveIdempotent(state, descriptor, record);
      });
    },

    async completeActionTicket(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "ticket_id", "reservation_id", "host_session_fingerprint", "outcome", "result_digest", "result_commit", "result_pull_request", "readback_digest",
        "standing_release_run_id", "standing_release_run_version",
        "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const nowValue = nowMillis(now);
      const initialRecord = initial.tickets[String(input.ticket_id || "")];
      if (initialRecord) ensureStandingReleaseRunReservation(initial, initialRecord, input, nowValue);
      const idempotencyInput = actionLifecycleIdempotencyInput(input);
      const replay = getIdempotent(initial, tenantId, "completeActionTicket", idempotencyInput);
      if (replay?.result) return validateStandingReplay(initial, replay.result, nowValue);
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "completeActionTicket", idempotencyInput);
        if (descriptor?.result) return validateStandingReplay(state, descriptor.result, nowValue);
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        ensureStandingReleaseRunReservation(state, record, input, nowValue);
        if (record.state !== "reserved") fail("not_completable");
        if (record.reservation_id !== input.reservation_id || record.ticket.host_session_fingerprint !== input.host_session_fingerprint) fail("host_session_mismatch");
        if (Date.parse(record.reservation_expires_at) <= nowValue) fail("action_ticket_reservation_expired");
        const outcome = text(input.outcome, "outcome_invalid", 40);
        if (!["success", "failure", "unknown"].includes(outcome)) fail("outcome_invalid");
        record.result_digest = digest(input.result_digest);
        record.host_readback_digest = input.readback_digest ? digest(input.readback_digest) : null;
        record.result_commit = input.result_commit ? commit(input.result_commit) : null;
        record.result_pull_request = input.result_pull_request === undefined
          ? null
          : positiveInteger(
            input.result_pull_request,
            "result_pull_request_invalid",
            Number.MAX_SAFE_INTEGER,
          );
        // A host-reported result is evidence, not independent verification.
        // `authorizeFinalize` is the sole transition that can establish this.
        record.result_commit_verified = false;
        if (record.ticket.action.kind === "github.merge" && outcome === "success") {
          if (!record.result_commit || !record.host_readback_digest) fail("commit_result_evidence_required");
        }
        const standingBinding = state.delegations?.[
          record.ticket.delegation_id
        ]?.grant?.standing_release_binding;
        if (
          standingBinding && outcome === "success" &&
          ["git.push.branch", "git.push.protected"].includes(record.ticket.action.kind) &&
          record.result_commit !== commit(record.ticket.action.source_commit)
        ) fail("standing_release_push_result_commit_mismatch");
        if (
          standingBinding && record.ticket.action.kind === "github.draft_pr" &&
          outcome === "success" && !record.result_pull_request
        ) fail("standing_release_pull_request_result_required");
        record.outcome = outcome;
        record.completed_at = iso(nowValue);
        record.state = outcome === "unknown" ? "reconciliation_required" : "completed";
        signActionTicketLifecycleRecord(record);
        return saveIdempotent(state, descriptor, record);
      });
    },

    async reconcileActionTicket(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "ticket_id", "reservation_id", "host_session_fingerprint", "observed_outcome", "observed_commit", "observed_pull_request", "readback_digest",
        "standing_release_run_id", "standing_release_run_version",
        "dtt_request_binding_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const nowValue = nowMillis(now);
      const initialRecord = initial.tickets[String(input.ticket_id || "")];
      if (initialRecord) ensureStandingReleaseRunReservation(initial, initialRecord, input, nowValue);
      const idempotencyInput = actionLifecycleIdempotencyInput(input);
      const replay = getIdempotent(initial, tenantId, "reconcileActionTicket", idempotencyInput);
      if (replay?.result) return validateStandingReplay(initial, replay.result, nowValue);
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "reconcileActionTicket", idempotencyInput);
        if (descriptor?.result) return validateStandingReplay(state, descriptor.result, nowValue);
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        ensureStandingReleaseRunReservation(state, record, input, nowValue);
        if (!["reconciliation_required", "reserved"].includes(record.state)) fail("not_reconcilable");
        if (record.reservation_id !== input.reservation_id || record.ticket.host_session_fingerprint !== input.host_session_fingerprint) fail("host_session_mismatch");
        if (Date.parse(record.reservation_expires_at) <= nowValue) fail("action_ticket_reservation_expired");
        if (input.observed_outcome !== "success") fail("observed_outcome_invalid");
        const observedCommit = commit(input.observed_commit);
        if (record.result_commit && record.result_commit !== observedCommit) fail("observed_commit_mismatch");
        record.observed_outcome = "success";
        record.observed_commit = observedCommit;
        record.result_commit = observedCommit;
        if (input.observed_pull_request !== undefined) {
          record.result_pull_request = positiveInteger(
            input.observed_pull_request,
            "result_pull_request_invalid",
            Number.MAX_SAFE_INTEGER,
          );
        }
        const standingBinding = state.delegations?.[
          record.ticket.delegation_id
        ]?.grant?.standing_release_binding;
        if (
          standingBinding && record.ticket.action.kind === "github.draft_pr" &&
          !record.result_pull_request
        ) fail("standing_release_pull_request_result_required");
        record.host_readback_digest = digest(input.readback_digest);
        record.reconciled_at = iso(nowValue);
        record.state = "reconciled";
        signActionTicketLifecycleRecord(record);
        return saveIdempotent(state, descriptor, record);
      });
    },

    // Expiry never permits completing, reconciling, retrying, or refunding an
    // action. This terminal path exists solely so an authenticated host can
    // preserve its independent readback and close the exact expired lease.
    async quarantineExpiredActionTicket(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "ticket_id", "reservation_id", "host_session_fingerprint",
        "readback_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const nowValue = nowMillis(now);
      const initialRecord = initial.tickets[String(input.ticket_id || "")];
      if (initialRecord) ensureStandingReleaseRunReservation(initial, initialRecord, input, nowValue);
      const idempotencyInput = actionLifecycleIdempotencyInput(input);
      const replay = getIdempotent(initial, tenantId, "quarantineExpiredActionTicket", idempotencyInput);
      if (replay?.result) return validateStandingReplay(initial, replay.result, nowValue);
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "quarantineExpiredActionTicket", idempotencyInput);
        if (descriptor?.result) return validateStandingReplay(state, descriptor.result, nowValue);
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        ensureStandingReleaseRunReservation(state, record, input, nowValue);
        verifyActionTicketLifecycleRecord(record);
        if (!["reserved", "reconciliation_required"].includes(record.state)) fail("not_quarantinable");
        if (record.reservation_id !== input.reservation_id || record.ticket.host_session_fingerprint !== input.host_session_fingerprint) fail("host_session_mismatch");
        if (record.state === "reconciliation_required" && record.outcome !== "unknown") fail("not_quarantinable");
        const reservationExpiresAt = Date.parse(record.reservation_expires_at || "");
        if (!Number.isFinite(reservationExpiresAt) || reservationExpiresAt > nowValue) {
          fail("action_ticket_reservation_not_expired");
        }
        record.state = "quarantined";
        record.observed_outcome = "unknown";
        record.host_readback_digest = digest(input.readback_digest);
        record.quarantined_at = iso(nowValue);
        record.quarantine_reason_digest = hostNativeDigest({
          schema_version: "host_native_expired_reservation_quarantine_v1",
          ticket_id: record.ticket.ticket_id,
          reservation_id: record.reservation_id,
          reservation_expires_at: record.reservation_expires_at,
          readback_digest: record.host_readback_digest,
        });
        signActionTicketLifecycleRecord(record);
        return saveIdempotent(state, descriptor, record);
      });
    },

    // This is deliberately not a reservation recovery path. It records an
    // independently observed effect that occurred after a valid ticket was
    // issued but before the host reserved it. The original ticket timestamps
    // and reservation fields remain untouched; the default verdict is BLOCKED.
    async observeUnreservedActionEffect(input = {}, trusted = {}) {
      exactKeys(input, new Set([
        "tenant_id", "ticket_id", "host_session_fingerprint", "observed_outcome",
        "observed_commit", "readback_digest", "verifier_evidence_digest",
        "deviation_reason", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "observeUnreservedActionEffect", input);
      if (replay?.result) return replay.result;
      const nowValue = nowMillis(now);
      const initialRecord = initial.tickets[String(input.ticket_id || "")];
      if (!initialRecord || initialRecord.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
      denyHorizontalRunGenericLifecycle(initial, initialRecord);
      if (initialRecord.ticket.host_session_fingerprint !== text(input.host_session_fingerprint, "host_session_mismatch", 300)) fail("host_session_mismatch");
      if (initialRecord.state !== "issued" || initialRecord.reservation_id) fail("unreserved_effect_not_eligible");
      if (Date.parse(initialRecord.ticket.expires_at) <= nowValue) fail("action_ticket_expired");
      if (input.observed_outcome !== "success") fail("observed_outcome_invalid");
      const observedCommit = commit(input.observed_commit);
      const expectedCommit = initialRecord.ticket.action.source_commit || initialRecord.ticket.action.target_commit;
      if (!expectedCommit || observedCommit !== commit(expectedCommit)) fail("observed_commit_mismatch");
      const readbackDigest = digest(input.readback_digest);
      const verifierEvidenceDigest = digest(input.verifier_evidence_digest);
      const deviationReason = text(input.deviation_reason, "protocol_deviation_reason_invalid", 500);
      if (!deviationReason) fail("protocol_deviation_reason_invalid");
      let decision = { classification: "BLOCKED", continuation_authorized: false, reason: "unreserved_effect_verifier_unavailable" };
      if (typeof unreservedEffectVerifier === "function") {
        try {
          decision = await unreservedEffectVerifier({
            tenant_id: tenantId,
            ticket: clone(initialRecord.ticket),
            observed_commit: observedCommit,
            readback_digest: readbackDigest,
            verifier_evidence_digest: verifierEvidenceDigest,
            deviation_reason: deviationReason,
          }) || decision;
        } catch {
          decision = { classification: "BLOCKED", continuation_authorized: false, reason: "unreserved_effect_verifier_failed" };
        }
      }
      const classification = text(decision.classification, "unreserved_effect_classification_invalid", 80);
      if (!["RECONCILED_WITH_EXCEPTION", "REQUIRES_REMEDIATION", "BLOCKED"].includes(classification)) {
        fail("unreserved_effect_classification_invalid");
      }
      const continuationAuthorized = classification === "RECONCILED_WITH_EXCEPTION" && decision.continuation_authorized === true;
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "observeUnreservedActionEffect", input);
        if (descriptor?.result) return descriptor.result;
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        denyHorizontalRunGenericLifecycle(state, record);
        if (record.state !== "issued" || record.reservation_id) fail("unreserved_effect_not_eligible");
        const receiptUnsigned = {
          schema_version: "host_native_observed_unreserved_effect_v1",
          receipt_id: makeId("hnue", { ticket_id: record.ticket.ticket_id, observed_commit: observedCommit, nowValue }),
          ticket_id: record.ticket.ticket_id,
          action_type: record.ticket.action.kind,
          target: clone(record.ticket.action),
          observed_at: iso(nowValue),
          observed_outcome: "success",
          observed_commit: observedCommit,
          effect_digest: hostNativeDigest({ ticket_id: record.ticket.ticket_id, observed_commit: observedCommit, readback_digest: readbackDigest }),
          readback_digest: readbackDigest,
          verifier_evidence_digest: verifierEvidenceDigest,
          reservation_id: null,
          deviation_reason: deviationReason,
          classification,
          continuation_authorized: continuationAuthorized,
          reason: text(decision.reason || "", "unreserved_effect_reason_invalid", 500),
        };
        const receipt = { ...receiptUnsigned, signature: hmac("hnue", signing, canonical(receiptUnsigned)) };
        record.protocol_deviation = receipt;
        record.observed_outcome = "success";
        record.observed_commit = observedCommit;
        record.host_readback_digest = readbackDigest;
        record.state = "observed_unreserved_effect";
        signActionTicketLifecycleRecord(record);
        return saveIdempotent(state, descriptor, record);
      });
    },

    async authorizeFinalize(input = {}, trusted = {}) {
      exactKeys(input, new Set(["tenant_id", "ticket_id", "host_session_fingerprint"]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const nowValue = nowMillis(now);
      const current = readTicketRecord(tenantId, input.ticket_id);
      if (current.ticket.host_session_fingerprint !== text(input.host_session_fingerprint, "host_session_mismatch", 300)) fail("host_session_mismatch");
      const previousAuthorization = current.finalize_authorization || null;
      if (
        previousAuthorization &&
        Date.parse(previousAuthorization.expires_at || 0) > nowValue
      ) {
        assertSoftwareConsumerFresh(trusted);
        return clone(current.finalize_authorization);
      }
      if (
        !["completed", "reconciled"].includes(current.state) &&
        Date.parse(current.reservation_expires_at || 0) <= nowValue
      ) {
        fail("action_ticket_reservation_expired");
      }
      if (!["completed", "reconciled"].includes(current.state) || (current.outcome !== "success" && current.observed_outcome !== "success")) {
        fail("successful_outcome_required");
      }
      if (current.ticket.action.kind === "render.observe") {
        validateStoredObserveDelegationContinuation(current, store.readState(), {
          nowValue,
          signing,
          successorUsage: 1,
        });
      }
      if (!isReleaseAction(current.ticket.action.kind)) fail("release_manifest_required");
      if (typeof externalReadbackVerifier !== "function") fail("trusted_readback_unavailable");
      const targetCommit = commit(current.result_commit || current.ticket.action.target_commit || current.ticket.release_manifest_binding.head_commit);
      let external;
      const verificationScope = current.ticket.action.kind === "github.merge"
        ? "github_merge_and_checks_only"
        : "full_release";
      try {
        external = await externalReadbackVerifier({
          ticket: current.ticket,
          target_commit: targetCommit,
          verification_scope: verificationScope,
        });
      }
      catch (cause) {
        if (String(cause?.message || "").startsWith("trusted_readback_")) throw cause;
        fail("trusted_readback_invalid");
      }
      verifyReadbackDigest(external);
      const github = external.github;
      const verifiedAt = Date.parse(external.verified_at);
      const previousAuthorizationExpiresAt = previousAuthorization
        ? Date.parse(previousAuthorization.expires_at || "")
        : null;
      if (
        !Number.isFinite(verifiedAt) ||
        verifiedAt < Date.parse(current.reserved_at) ||
        verifiedAt > nowValue + 60_000 ||
        (
          previousAuthorization &&
          (!Number.isFinite(previousAuthorizationExpiresAt) ||
            verifiedAt <= previousAuthorizationExpiresAt)
        )
      ) {
        fail("trusted_readback_stale");
      }
      if (
        external.verification_scope !== verificationScope ||
        github.repository !== current.ticket.repository || github.target_commit !== targetCommit ||
        github.action_kind !== current.ticket.action.kind ||
        github.checks_passed !== true || !sameStrings(github.required_checks, current.ticket.release_manifest_binding.verification.required_checks)
      ) {
        fail("trusted_readback_github_mismatch");
      }
      if (verificationScope === "github_merge_and_checks_only" && (
        github.merged !== true || github.merge_commit !== targetCommit ||
        github.head_commit !== current.ticket.action.head_commit ||
        github.expected_base_commit !== current.ticket.action.expected_base_commit
      )) {
        fail("trusted_readback_github_mismatch");
      }
      if (current.ticket.action.kind === "render.deploy" &&
          current.ticket.action.environment === "production") {
        const resolution = current.ticket.release_join_resolution;
        const joinedPolicyDigest = resolution?.required_checks_policy_digest;
        if (
          !SHA256.test(String(joinedPolicyDigest || "")) ||
          current.ticket.release_join_resolution_digest !== hostNativeDigest(resolution) ||
          github.required_checks_policy_digest !== joinedPolicyDigest
        ) fail("trusted_readback_github_mismatch");
      }
      if (current.ticket.action.kind === "render.observe") {
        const predecessor = current.ticket.predecessor;
        const sourceAction = predecessor?.source_action;
        const expectedBase = sourceAction?.kind === "github.merge"
          ? sourceAction.expected_base_commit
          : sourceAction?.expected_remote_commit;
        const ownerManualMerge = predecessor?.predecessor_type ===
          "owner_manual_github_merge_readback";
        if (
          current.ticket.predecessor_chain_digest !== hostNativeDigest(predecessor) ||
          predecessor?.source_action_digest !== hostNativeDigest(sourceAction) ||
          github.source_action_kind !== sourceAction?.kind ||
          github.source_action_digest !== predecessor?.source_action_digest ||
          github.branch !== current.ticket.action.branch || github.branch_commit !== targetCommit ||
          github.head_commit !== current.ticket.release_manifest_binding.verification.checks_commit ||
          github.expected_base_commit !== expectedBase ||
          github.required_checks_policy_digest !==
            predecessor?.source_required_checks_policy_digest ||
          (sourceAction?.kind === "github.merge" && (
            github.merged !== true || github.merge_commit !== targetCommit ||
            github.pull_request !== sourceAction.pull_request ||
            github.head_branch !== sourceAction.head_branch ||
            github.base_branch !== sourceAction.base_branch
          ))
        ) fail("trusted_readback_github_mismatch");
        if (ownerManualMerge) {
          if (
            github.manual_merge_readback_id !==
              predecessor.manual_merge_readback_id ||
            github.manual_merge_readback_digest !==
              predecessor.manual_merge_readback_digest ||
            github.source_readback_digest !== predecessor.source_readback_digest ||
            github.predecessor_ticket_id !== undefined ||
            github.predecessor_ticket_digest !== undefined
          ) fail("trusted_readback_github_mismatch");
        } else if (
          github.predecessor_ticket_id !== predecessor?.ticket_id ||
          github.predecessor_ticket_digest !== predecessor?.ticket_digest ||
          github.manual_merge_readback_id !== undefined ||
          github.manual_merge_readback_digest !== undefined
        ) fail("trusted_readback_github_mismatch");
      }
      if (!Array.isArray(github.observed_checks) || github.observed_checks.some((check) => (
        check?.status !== "completed" || check?.conclusion !== "success" ||
        check?.head_commit !== current.ticket.release_manifest_binding.verification.checks_commit
      ))) {
        fail("trusted_readback_checks_not_ready");
      }
      const expectedServices = current.ticket.release_manifest_binding.delivery.services;
      if (
        verificationScope === "github_merge_and_checks_only" && external.services.length !== 0
      ) fail("trusted_readback_verification_scope_invalid");
      if (
        verificationScope === "full_release" && external.services.length !== expectedServices.length
      ) fail("trusted_readback_service_set_mismatch");
      for (const expected of verificationScope === "full_release" ? expectedServices : []) {
        const observed = external.services.find((service) =>
          service.service_id === expected.service_id && service.environment === expected.environment);
        const expectedLiveCommit = expected.target_commit || targetCommit;
        if (!observed || observed.origin !== expected.origin || observed.live_commit !== expectedLiveCommit ||
            observed.health_contract_digest !== expected.health_contract_digest ||
            observed.previous_live_commit !== expected.expected_previous_commit ||
            observed.rollback_commit !== current.ticket.release_manifest_binding.rollback.target_commit ||
            observed.rollback_status !== "previous_live_attested") {
          fail("trusted_readback_service_mismatch");
        }
      }
      assertSoftwareConsumerFresh(trusted);
      return store.mutate((state) => {
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        const receiptNow = nowMillis(now);
        if (record.ticket.action.kind === "render.observe") {
          validateStoredObserveDelegationContinuation(record, state, {
            nowValue: receiptNow,
            signing,
            successorUsage: 1,
          });
        }
        if (record.finalize_authorization) {
          const storedExpiresAt = Date.parse(record.finalize_authorization.expires_at || 0);
          if (storedExpiresAt > receiptNow) {
            return record.finalize_authorization;
          }
          if (
            !previousAuthorization ||
            record.finalize_authorization.authorization_digest !==
              previousAuthorization.authorization_digest ||
            !Number.isFinite(storedExpiresAt) ||
            verifiedAt <= storedExpiresAt
          ) {
            fail("trusted_readback_stale");
          }
        }
        const receiptUnsigned = {
          schema_version: "host_native_finalize_authorization_v1",
          trusted: true,
          allowed: true,
          decision: "ALLOW_FINALIZE",
          decision_id: record.ticket.ticket_id,
          tenant_id: tenantId,
          work_id: record.ticket.work_id,
          repository: record.ticket.repository,
          target_commit: targetCommit,
          action_ticket_id: record.ticket.ticket_id,
          action_ticket_digest: hostNativeDigest(record.ticket),
          release_manifest_digest: record.ticket.release_manifest_digest,
          release_intent_digest: record.ticket.release_intent_digest,
          core_join_verdict_id: record.ticket.core_join_verdict_id,
          core_join_verdict_digest: record.ticket.core_join_verdict_digest,
          core_join_resolution_digest: record.ticket.release_join_resolution_digest,
          changed_files: record.ticket.release_manifest_binding.changed_files,
          predecessor: record.ticket.predecessor || null,
          predecessor_chain_digest: record.ticket.predecessor_chain_digest || null,
          evidence_digest: record.ticket.evidence_digest,
          host_kind: record.ticket.host_kind,
          host_session_fingerprint: record.ticket.host_session_fingerprint,
          ...(record.result_digest
            ? { host_result_digest: record.result_digest }
            : {}),
          host_readback_digest: record.host_readback_digest,
          external_readback_digest: hostNativeDigest(external),
          readback_digest: hostNativeDigest(external),
          result_commit_verified: true,
          verification_scope: verificationScope,
          services_verified: verificationScope === "full_release",
          github_readback: github,
          live_services: external.services,
          outcome_source: record.state === "reconciled" ? "reconciled_readback" : "verified_completion",
          readback_source: external.verifier_id,
          issued_at: iso(receiptNow),
          expires_at: iso(receiptNow + leaseMs),
          ...(record.finalize_authorization
            ? {
              previous_authorization_digest:
                record.finalize_authorization.authorization_digest,
            }
            : {}),
          host_policy_override: false,
          host_policy_must_allow: true,
          external_execution_allowed: false,
          host_execution_required: true,
          provider_execution: false,
        };
        const authorization_digest = hostNativeDigest(receiptUnsigned);
        const receipt = {
          ...receiptUnsigned,
          authorization_digest,
          signature: hmac("hnf", signing, canonical({ ...receiptUnsigned, authorization_digest })),
        };
        if (record.finalize_authorization) {
          const historicalAuthorization = record.finalize_authorization;
          const history = Array.isArray(record.finalize_authorization_history)
            ? record.finalize_authorization_history
            : [];
          record.finalize_authorization_history = [
            ...history,
            {
              authorization_digest: historicalAuthorization.authorization_digest,
              external_readback_digest:
                historicalAuthorization.external_readback_digest,
              issued_at: historicalAuthorization.issued_at,
              expires_at: historicalAuthorization.expires_at,
            },
          ].slice(-MAX_FINALIZE_AUTHORIZATION_HISTORY);
        }
        record.finalize_authorization = receipt;
        if (
          verificationScope === "full_release" &&
          record.ticket.action.kind === "render.observe"
        ) {
          const delegation = state.delegations?.[record.ticket.delegation_id];
          const standingBinding = delegation?.grant?.standing_release_binding;
          if (standingBinding) {
            delegation.state = "completed";
            delegation.completed_at = iso(receiptNow);
            const mandate = state.standing_release_mandates?.[standingBinding.mandate_id];
            if (mandate) {
              const leaseKey = `${tenantId}\u0000${mandate.mandate.repository}\u0000${mandate.mandate.base_branch}`;
              const lease = state.standing_release_leases?.[leaseKey];
              if (lease?.delegation_id === delegation.delegation_id) {
                delete state.standing_release_leases[leaseKey];
              }
            }
          }
        }
        return receipt;
      });
    },
  };
  // Deliberately leave the facade extensible: callers wrap lifecycle methods
  // to supply a request idempotency key, while all authoritative state stays
  // inside the store and the closure above.
  return governance;
}
