import crypto from "node:crypto";

export const STANDING_RELEASE_RUN_VERSION = "standing_release_run_v1";
export const STANDING_RELEASE_COORDINATION_MODEL = "horizontal_peer_adapters_v1";

export const STANDING_RELEASE_RUN_STATES = Object.freeze({
  COMMIT_PENDING: "COMMIT_PENDING",
  ACTION_IN_PROGRESS: "ACTION_IN_PROGRESS",
  PUSH_PENDING: "PUSH_PENDING",
  DRAFT_PR_PENDING: "DRAFT_PR_PENDING",
  CI_WAIT: "CI_WAIT",
  MERGE_PENDING: "MERGE_PENDING",
  LIVE_VERIFY_PENDING: "LIVE_VERIFY_PENDING",
  COMPLETED: "COMPLETED",
  BLOCKED: "BLOCKED",
  CANCELLED: "CANCELLED",
  QUARANTINED: "QUARANTINED",
});

export const STANDING_RELEASE_ADAPTER_LANES = Object.freeze([
  Object.freeze({ lane: "git", domain: "source_change", relationship: "peer" }),
  Object.freeze({ lane: "github", domain: "repository_release", relationship: "peer" }),
  Object.freeze({ lane: "render", domain: "runtime_release", relationship: "peer" }),
]);

const TERMINAL = new Set(["COMPLETED", "BLOCKED", "CANCELLED", "QUARANTINED"]);
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const TICKET_ID = /^hnt_[A-Za-z0-9._-]{8,200}$/;
const DELEGATION_ID = /^hnd_[A-Za-z0-9._-]{8,200}$/;

const CREATE_KEYS = new Set([
  "tenant_id", "work_id", "intent_anchor_digest", "mandate_id", "mandate_digest",
  "mandate_revision", "revocation_epoch", "delegation_id", "repository", "base_branch",
  "delivery_branch", "base_commit", "changed_files", "services", "host_kind",
  "host_session_fingerprint", "max_repair_attempts",
]);

const RECORD_KEYS = new Set([
  "schema_version", "tenant_id", "state", "uses", "outcome", "observed_outcome",
  "result_commit", "observed_commit", "result_pull_request", "observed_pull_request",
  "result_digest", "readback_digest", "host_readback_digest", "reservation_id",
  "reserved_at", "reservation_expires_at", "completed_at", "reconciled_at", "ticket",
  "result_commit_verified", "finalize_authorization", "finalize_authorization_history",
  "protocol_deviation", "superseded_by_ticket_id", "superseded_at",
  "lifecycle_digest", "lifecycle_signature", "pre_merge_readback_digest",
  "quarantined_at", "quarantine_reason_digest",
  "trusted", "provider_execution",
]);

const TICKET_KEYS = new Set([
  "schema_version", "ticket_id", "delegation_id", "tenant_id", "work_id",
  "intent_anchor_digest", "repository", "host_kind", "host_session_fingerprint", "action",
  "action_digest", "evidence_digest", "issued_at", "expires_at", "max_uses",
  "host_policy_override", "host_policy_must_allow", "provider_execution", "signature",
  "predecessor", "predecessor_chain_digest", "release_manifest_digest",
  "release_manifest_binding", "release_intent_digest", "core_join_verdict_id",
  "core_join_verdict_digest", "release_join_resolution", "release_join_resolution_digest",
  "bootstrap_release_exception_candidate",
]);

const FINALIZE_AUTHORIZATION_KEYS = new Set([
  "schema_version", "trusted", "allowed", "decision", "decision_id", "tenant_id",
  "work_id", "repository", "target_commit", "action_ticket_id", "action_ticket_digest",
  "release_manifest_digest", "release_intent_digest", "core_join_verdict_id",
  "core_join_verdict_digest", "core_join_resolution_digest", "changed_files", "predecessor",
  "predecessor_chain_digest", "evidence_digest", "host_kind", "host_session_fingerprint",
  "host_result_digest", "host_readback_digest", "external_readback_digest", "readback_digest",
  "result_commit_verified", "verification_scope", "services_verified", "github_readback",
  "live_services", "outcome_source", "readback_source", "issued_at", "expires_at",
  "previous_authorization_digest", "host_policy_override", "host_policy_must_allow",
  "external_execution_allowed", "host_execution_required", "provider_execution",
  "authorization_digest", "signature",
]);

const LIVE_SERVICE_KEYS = new Set([
  "service_id", "environment", "origin", "health_path", "deployment_id", "live_commit",
  "version", "health_status", "health_contract_digest", "previous_live_commit",
  "rollback_commit", "rollback_status", "readback_digest",
]);

const ACTION_KEYS = Object.freeze({
  "git.commit": new Set([
    "kind", "repository", "branch", "parent_commit", "tree_sha", "diff_digest",
    "changed_files", "message_digest", "builder_agent_id", "repair_class", "failed_check",
    "failure_evidence_digest", "provider_execution",
  ]),
  "git.push.branch": new Set([
    "kind", "repository", "branch", "source_commit", "expected_remote_commit",
    "changed_files", "force", "delete_ref", "tags", "induced_effects", "provider_execution",
  ]),
  "github.draft_pr": new Set([
    "kind", "repository", "head_branch", "base_branch", "head_commit",
    "expected_base_commit", "changed_files", "title_digest", "body_digest", "draft", "force",
    "delete_ref", "tags", "provider_execution",
  ]),
  "github.ready": new Set([
    "kind", "repository", "head_branch", "base_branch", "pull_request", "head_commit",
    "draft_before", "ready_for_review", "force", "delete_ref", "tags",
    "expected_base_commit", "origin_draft_ticket_id", "provider_execution",
  ]),
  "github.merge": new Set([
    "kind", "repository", "head_branch", "base_branch", "pull_request", "head_commit",
    "expected_base_commit", "merge_method", "checks_verified", "checks_commit", "force",
    "delete_ref", "tags", "induced_effects", "origin_draft_ticket_id", "provider_execution",
  ]),
  "render.observe": new Set([
    "kind", "repository", "branch", "service_id", "environment", "target_commit",
    "parent_release_ticket_id", "parent_release_ticket_digest", "release_manifest_digest",
    "provider_execution",
  ]),
});

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${code}:${key}`);
}

function requiredKeys(value, required, code) {
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${code}:${key}`);
}

function text(value, code, maximum = 500) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || normalized.includes("\u0000")) fail(code);
  return normalized;
}

function identifier(value, code) {
  const normalized = text(value, code, 160);
  if (!IDENTIFIER.test(normalized)) fail(code);
  return normalized;
}

function digest(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
}

function sessionFingerprint(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(normalized)) fail(code);
  return normalized;
}

function commit(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!GIT_SHA.test(normalized)) fail(code);
  return normalized;
}

function branch(value, code) {
  const normalized = text(value, code, 200);
  if (!BRANCH.test(normalized) || normalized.includes("..") || normalized.endsWith("/")) fail(code);
  return normalized;
}

function integer(value, code, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) =>
    value[key] === undefined ? [] : [[key, canonical(value[key])]]));
}

function objectDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  const millis = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(millis)) fail("standing_release_run_clock_invalid");
  return new Date(millis).toISOString();
}

function strings(values, code, maximum = 5_000) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) fail(code);
  const normalized = values.map((entry) => {
    const item = text(entry, code, 500).replace(/^\.\//, "");
    if (item.startsWith("/") || item.includes("\\") || item.split("/").some((part) => !part || part === "." || part === "..")) fail(code);
    return item;
  });
  const stable = [...new Set(normalized)].sort();
  if (stable.length !== normalized.length) fail(code);
  return stable;
}

function services(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 20) fail("standing_release_run_services_invalid");
  const seen = new Set();
  const normalized = values.map((value) => {
    exactKeys(value, new Set(["service_id", "environment", "health_contract_digest"]), "standing_release_run_services_invalid");
    requiredKeys(value, ["service_id", "environment", "health_contract_digest"], "standing_release_run_services_invalid");
    const service = {
      service_id: identifier(value.service_id, "standing_release_run_services_invalid"),
      environment: identifier(value.environment, "standing_release_run_services_invalid"),
      health_contract_digest: digest(value.health_contract_digest, "standing_release_run_services_invalid"),
    };
    const key = serviceKey(service);
    if (seen.has(key)) fail("standing_release_run_services_invalid");
    seen.add(key);
    return service;
  });
  return normalized.sort((a, b) => serviceKey(a).localeCompare(serviceKey(b)));
}

function serviceKey(value) {
  return `${value.service_id}\u0000${value.environment}`;
}

function adapterLane(kind) {
  const lane = String(kind).split(".")[0];
  if (!STANDING_RELEASE_ADAPTER_LANES.some((entry) => entry.lane === lane)) fail("standing_release_run_adapter_lane_invalid");
  return lane;
}

function assertCas(run, expectedVersion) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== run.version) {
    fail("standing_release_run_version_conflict");
  }
}

function assertMutable(run) {
  if (TERMINAL.has(run.state)) fail("standing_release_run_terminal");
}

function assertRun(run) {
  if (!run || typeof run !== "object" || Array.isArray(run) ||
      run.schema_version !== STANDING_RELEASE_RUN_VERSION ||
      run.coordination_model !== STANDING_RELEASE_COORDINATION_MODEL ||
      run.provider_execution !== false || run.connected_host_required !== true ||
      run.background_execution !== false || typeof run.pull_request_ready !== "boolean" ||
      (run.pull_request_ready && (!Number.isSafeInteger(run.pull_request) || run.pull_request < 1)) ||
      !Object.values(STANDING_RELEASE_RUN_STATES).includes(run.state)) {
    fail("standing_release_run_invalid");
  }
  integer(run.version, "standing_release_run_invalid", { minimum: 1 });
  if (run.change_cone_digest !== objectDigest(run.change_cone)) fail("standing_release_run_change_cone_drift");
  if (run.run_id !== `srr_${objectDigest({
    tenant_id: run.tenant_id,
    work_id: run.work_id,
    delegation_id: run.delegation_id,
    change_cone_digest: run.change_cone_digest,
  }).slice(0, 40)}`) fail("standing_release_run_identity_drift");
  return run;
}

function next(run, patch, at) {
  return deepFreeze({ ...clone(run), ...patch, version: run.version + 1, updated_at: at });
}

function normalizeCreate(input, at) {
  exactKeys(input, CREATE_KEYS, "standing_release_run_input_invalid");
  requiredKeys(input, [...CREATE_KEYS], "standing_release_run_input_invalid");
  const tenantId = identifier(input.tenant_id, "standing_release_run_tenant_invalid");
  const workId = text(input.work_id, "standing_release_run_work_invalid", 80).toLowerCase();
  if (!UUID.test(workId)) fail("standing_release_run_work_invalid");
  const repository = text(input.repository, "standing_release_run_repository_invalid", 300);
  if (!REPOSITORY.test(repository)) fail("standing_release_run_repository_invalid");
  const baseBranch = branch(input.base_branch, "standing_release_run_branch_invalid");
  const deliveryBranch = branch(input.delivery_branch, "standing_release_run_branch_invalid");
  if (baseBranch === deliveryBranch) fail("standing_release_run_branch_invalid");
  const normalizedServices = services(input.services);
  const changeCone = {
    repository,
    base_branch: baseBranch,
    delivery_branch: deliveryBranch,
    base_commit: commit(input.base_commit, "standing_release_run_base_commit_invalid"),
    changed_files: strings(input.changed_files, "standing_release_run_changed_files_invalid"),
    services: normalizedServices,
  };
  const normalized = {
    tenant_id: tenantId,
    work_id: workId,
    intent_anchor_digest: digest(input.intent_anchor_digest, "standing_release_run_intent_invalid"),
    mandate_id: text(input.mandate_id, "standing_release_run_mandate_invalid", 200),
    mandate_digest: digest(input.mandate_digest, "standing_release_run_mandate_invalid"),
    mandate_revision: integer(input.mandate_revision, "standing_release_run_mandate_invalid", { minimum: 1 }),
    revocation_epoch: integer(input.revocation_epoch, "standing_release_run_mandate_invalid"),
    delegation_id: text(input.delegation_id, "standing_release_run_delegation_invalid", 220),
    repository,
    base_branch: baseBranch,
    delivery_branch: deliveryBranch,
    host_kind: text(input.host_kind, "standing_release_run_host_invalid", 80),
    host_session_fingerprint: sessionFingerprint(input.host_session_fingerprint, "standing_release_run_session_invalid"),
    max_repair_attempts: integer(
      input.max_repair_attempts,
      "standing_release_run_repair_limit_invalid",
      { minimum: 1, maximum: 2 },
    ),
    change_cone: changeCone,
    change_cone_digest: objectDigest(changeCone),
    services: normalizedServices,
  };
  if (!DELEGATION_ID.test(normalized.delegation_id) || !["codex_native", "chatgpt_native"].includes(normalized.host_kind)) {
    fail("standing_release_run_binding_invalid");
  }
  const runId = `srr_${objectDigest({
    tenant_id: normalized.tenant_id,
    work_id: normalized.work_id,
    delegation_id: normalized.delegation_id,
    change_cone_digest: normalized.change_cone_digest,
  }).slice(0, 40)}`;
  return { normalized, runId, at };
}

export function createStandingReleaseRun(input = {}, { now } = {}) {
  const { normalized, runId, at } = normalizeCreate(input, timestamp(now));
  return deepFreeze({
    schema_version: STANDING_RELEASE_RUN_VERSION,
    run_id: runId,
    coordination_model: STANDING_RELEASE_COORDINATION_MODEL,
    adapter_lanes: STANDING_RELEASE_ADAPTER_LANES.map((entry) => ({ ...entry })),
    ...normalized,
    state: "COMMIT_PENDING",
    resume_state: null,
    version: 1,
    current_head_commit: null,
    remote_head_commit: normalized.change_cone.base_commit,
    pull_request: null,
    pull_request_ready: false,
    draft_pr_ticket_id: null,
    merge_commit: null,
    repair_attempts: 0,
    max_repair_attempts: normalized.max_repair_attempts,
    observed_services: [],
    active_action: null,
    completed_ticket_ids: [],
    last_ticket_id: null,
    merge_ticket_id: null,
    terminal_reason_digest: null,
    provider_execution: false,
    connected_host_required: true,
    background_execution: false,
    created_at: at,
    updated_at: at,
  });
}

function validateTicketRecord(run, record, at, { requireFresh = false } = {}) {
  exactKeys(record, RECORD_KEYS, "standing_release_ticket_record_invalid");
  requiredKeys(record, ["state", "uses", "ticket"], "standing_release_ticket_record_invalid");
  if ((record.schema_version !== undefined && record.schema_version !== "host_native_action_ticket_record_v1") ||
      (record.tenant_id !== undefined && record.tenant_id !== run.tenant_id) ||
      (record.trusted !== undefined && record.trusted !== true) ||
      (record.provider_execution !== undefined && record.provider_execution !== false)) {
    fail("standing_release_ticket_record_invalid");
  }
  exactKeys(record.ticket, TICKET_KEYS, "standing_release_ticket_invalid");
  requiredKeys(record.ticket, [
    "schema_version", "ticket_id", "delegation_id", "tenant_id", "work_id",
    "intent_anchor_digest", "repository", "host_kind", "host_session_fingerprint", "action",
    "evidence_digest", "issued_at", "expires_at", "max_uses", "host_policy_override",
    "host_policy_must_allow", "provider_execution", "signature",
  ], "standing_release_ticket_invalid");
  const ticket = record.ticket;
  if (ticket.schema_version !== "host_native_action_ticket_v1" || !TICKET_ID.test(String(ticket.ticket_id)) ||
      !/^hnt_[a-f0-9]{64}$/.test(String(ticket.signature)) || ticket.tenant_id !== run.tenant_id ||
      ticket.work_id !== run.work_id || ticket.delegation_id !== run.delegation_id ||
      ticket.intent_anchor_digest !== run.intent_anchor_digest || ticket.repository !== run.repository ||
      ticket.host_kind !== run.host_kind || ticket.host_session_fingerprint !== run.host_session_fingerprint ||
      ticket.max_uses !== 1 || ticket.host_policy_override !== false ||
      ticket.host_policy_must_allow !== true || ticket.provider_execution !== false) {
    fail("standing_release_ticket_binding_mismatch");
  }
  const issued = Date.parse(ticket.issued_at);
  const expires = Date.parse(ticket.expires_at);
  const current = Date.parse(at);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > current + 30_000 ||
      expires <= issued || (requireFresh && expires <= current)) {
    fail("standing_release_ticket_time_invalid");
  }
  digest(ticket.evidence_digest, "standing_release_ticket_invalid");
  const action = validateAction(run, ticket.action);
  if (ticket.action_digest !== undefined && ticket.action_digest !== objectDigest(action)) fail("standing_release_ticket_action_digest_mismatch");
  return { record, ticket, action, action_digest: objectDigest(action) };
}

function validateAction(run, value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !ACTION_KEYS[value.kind]) fail("standing_release_action_invalid");
  exactKeys(value, ACTION_KEYS[value.kind], "standing_release_action_invalid");
  if (value.provider_execution !== false || value.repository !== run.repository) fail("standing_release_action_binding_mismatch");
  return value;
}

function requireFlags(action, keys) {
  for (const key of keys) if (action[key] !== false) fail("standing_release_action_safety_invalid");
}

function requireNoInducedEffects(action) {
  if (!Array.isArray(action.induced_effects) || action.induced_effects.length !== 0) {
    fail("standing_release_action_induced_effects_invalid");
  }
}

function requireInducedServices(run, action) {
  if (!Array.isArray(action.induced_effects) ||
      action.induced_effects.length !== run.services.length) {
    fail("standing_release_action_induced_effects_invalid");
  }
  const effects = action.induced_effects.map((effect) => {
    exactKeys(
      effect,
      new Set(["service_id", "environment", "trigger"]),
      "standing_release_action_induced_effects_invalid",
    );
    requiredKeys(
      effect,
      ["service_id", "environment", "trigger"],
      "standing_release_action_induced_effects_invalid",
    );
    if (effect.trigger !== "github_auto_deploy") {
      fail("standing_release_action_induced_effects_invalid");
    }
    return `${identifier(effect.service_id, "standing_release_action_induced_effects_invalid")}\u0000${identifier(effect.environment, "standing_release_action_induced_effects_invalid")}`;
  }).sort();
  const expected = run.services.map(serviceKey).sort();
  if (JSON.stringify(effects) !== JSON.stringify(expected)) {
    fail("standing_release_action_induced_effects_invalid");
  }
}

function requireChangedFiles(run, action) {
  if (JSON.stringify(strings(action.changed_files, "standing_release_action_changed_files_invalid")) !==
      JSON.stringify(run.change_cone.changed_files)) fail("standing_release_action_change_cone_drift");
}

function requireBranchPair(run, action) {
  if (action.head_branch !== run.delivery_branch || action.base_branch !== run.base_branch) {
    fail("standing_release_action_branch_mismatch");
  }
}

function expectedRepair(run, action) {
  if (run.repair_attempts >= run.max_repair_attempts) return { quarantine: true };
  if (action.kind !== "git.commit" || action.branch !== run.delivery_branch ||
      action.parent_commit !== run.current_head_commit || !action.repair_class ||
      !action.failed_check || !action.failure_evidence_digest) {
    fail("standing_release_action_repair_invalid");
  }
  requireChangedFiles(run, action);
  commit(action.tree_sha, "standing_release_action_commit_invalid");
  digest(action.diff_digest, "standing_release_action_commit_invalid");
  digest(action.message_digest, "standing_release_action_commit_invalid");
  digest(action.failure_evidence_digest, "standing_release_action_repair_invalid");
  return { resume_state: "PUSH_PENDING", repair: true };
}

function expectedMerge(run, action) {
  if (run.pull_request_ready !== true || action.kind !== "github.merge") {
    fail("standing_release_action_sequence_invalid");
  }
  requireBranchPair(run, action);
  if (action.pull_request !== run.pull_request || action.head_commit !== run.current_head_commit ||
      action.expected_base_commit !== run.change_cone.base_commit || action.checks_commit !== run.current_head_commit ||
      action.checks_verified !== true || action.merge_method !== "merge") fail("standing_release_action_head_mismatch");
  requireFlags(action, ["force", "delete_ref", "tags"]);
  requireInducedServices(run, action);
  return { resume_state: "LIVE_VERIFY_PENDING", repair: false };
}

function expectedForPending(run, action) {
  if (run.state === "COMMIT_PENDING") {
    if (action.kind !== "git.commit" || action.branch !== run.delivery_branch ||
        action.parent_commit !== run.change_cone.base_commit || action.repair_class !== undefined) fail("standing_release_action_sequence_invalid");
    requireChangedFiles(run, action);
    commit(action.tree_sha, "standing_release_action_commit_invalid");
    digest(action.diff_digest, "standing_release_action_commit_invalid");
    digest(action.message_digest, "standing_release_action_commit_invalid");
    return { resume_state: "PUSH_PENDING", repair: false };
  }
  if (run.state === "PUSH_PENDING") {
    if (action.kind !== "git.push.branch" || action.branch !== run.delivery_branch ||
        action.source_commit !== run.current_head_commit || action.expected_remote_commit !== run.remote_head_commit) fail("standing_release_action_sequence_invalid");
    requireFlags(action, ["force", "delete_ref", "tags"]);
    requireNoInducedEffects(action);
    requireChangedFiles(run, action);
    return { resume_state: run.pull_request === null ? "DRAFT_PR_PENDING" : "CI_WAIT", repair: false };
  }
  if (run.state === "DRAFT_PR_PENDING") {
    if (action.kind !== "github.draft_pr") fail("standing_release_action_sequence_invalid");
    requireBranchPair(run, action);
    if (action.head_commit !== run.current_head_commit || action.expected_base_commit !== run.change_cone.base_commit || action.draft !== true) fail("standing_release_action_head_mismatch");
    requireFlags(action, ["force", "delete_ref", "tags"]);
    requireChangedFiles(run, action);
    return { resume_state: "CI_WAIT", repair: false };
  }
  if ((run.state === "CI_WAIT" || run.state === "MERGE_PENDING") && action.kind === "git.commit") {
    return expectedRepair(run, action);
  }
  if (run.state === "CI_WAIT") {
    if (run.pull_request_ready) return expectedMerge(run, action);
    if (action.kind !== "github.ready") fail("standing_release_action_sequence_invalid");
    requireBranchPair(run, action);
    if (action.pull_request !== run.pull_request || action.head_commit !== run.current_head_commit || action.draft_before !== true || action.ready_for_review !== true) fail("standing_release_action_head_mismatch");
    if (run.repair_attempts > 0 && (
      action.origin_draft_ticket_id !== run.draft_pr_ticket_id ||
      action.expected_base_commit !== run.change_cone.base_commit
    )) {
      fail("standing_release_action_repair_origin_invalid");
    }
    requireFlags(action, ["force", "delete_ref", "tags"]);
    return { resume_state: "MERGE_PENDING", repair: false };
  }
  if (run.state === "MERGE_PENDING") {
    return expectedMerge(run, action);
  }
  if (run.state === "LIVE_VERIFY_PENDING") {
    if (action.kind !== "render.observe" || action.branch !== run.base_branch || action.target_commit !== run.merge_commit ||
        action.parent_release_ticket_id !== run.merge_ticket_id) fail("standing_release_action_sequence_invalid");
    const wanted = run.services.find((service) => service.service_id === action.service_id && service.environment === action.environment);
    if (!wanted || run.observed_services.includes(serviceKey(wanted))) fail("standing_release_action_service_mismatch");
    digest(action.parent_release_ticket_digest, "standing_release_action_release_binding_invalid");
    digest(action.release_manifest_digest, "standing_release_action_release_binding_invalid");
    return { resume_state: "LIVE_VERIFY_PENDING", repair: false, service: serviceKey(wanted) };
  }
  fail("standing_release_action_sequence_invalid");
}

export function bindStandingReleaseRunTicket(run, ticketRecord, { now, expected_version } = {}) {
  assertRun(run);
  assertMutable(run);
  assertCas(run, expected_version);
  const at = timestamp(now);
  const validated = validateTicketRecord(run, ticketRecord, at);
  if (run.state === "ACTION_IN_PROGRESS") {
    if (run.active_action?.ticket_id === validated.ticket.ticket_id && run.active_action.action_digest === validated.action_digest) return run;
    fail("standing_release_action_already_in_progress");
  }
  if (run.completed_ticket_ids.includes(validated.ticket.ticket_id)) fail("standing_release_ticket_replayed");
  if (ticketRecord.state !== "issued" || ticketRecord.uses !== 0) fail("standing_release_ticket_not_bindable");
  if (Date.parse(validated.ticket.expires_at) <= Date.parse(at)) fail("standing_release_ticket_time_invalid");
  const expected = expectedForPending(run, validated.action);
  if (expected.quarantine) {
    return next(run, {
      state: "QUARANTINED",
      terminal_reason_digest: objectDigest({ code: "repair_limit_exceeded", ticket_id: validated.ticket.ticket_id }),
    }, at);
  }
  return next(run, {
    state: "ACTION_IN_PROGRESS",
    resume_state: expected.resume_state,
    active_action: {
      ticket_id: validated.ticket.ticket_id,
      action_digest: validated.action_digest,
      kind: validated.action.kind,
      adapter_lane: adapterLane(validated.action.kind),
      repair: expected.repair,
      service: expected.service ?? null,
    },
  }, at);
}

function outcome(record) {
  if (record.state === "reconciled" && record.observed_outcome === "success") return "success";
  if (["issued", "reserved", "reconciliation_required"].includes(record.state) || record.outcome === "unknown") return "pending";
  if (record.state === "completed" && record.outcome === "success") return "success";
  if (record.state === "completed" && record.outcome === "failure") return "failure";
  return "invalid";
}

function resultCommit(record, code) {
  return commit(record.observed_commit || record.result_commit, code);
}

function verifiedLiveServices(run, record, ticket) {
  const authorization = record.finalize_authorization;
  exactKeys(authorization, FINALIZE_AUTHORIZATION_KEYS, "standing_release_finalize_authorization_invalid");
  requiredKeys(authorization, [
    "schema_version", "trusted", "allowed", "decision", "decision_id", "tenant_id",
    "work_id", "repository", "target_commit", "action_ticket_id", "action_ticket_digest",
    "release_manifest_digest", "host_kind", "host_session_fingerprint", "result_commit_verified",
    "verification_scope", "services_verified", "live_services", "host_policy_override",
    "host_policy_must_allow", "external_execution_allowed", "host_execution_required",
    "provider_execution", "authorization_digest", "signature",
  ], "standing_release_finalize_authorization_invalid");
  if (
    authorization.schema_version !== "host_native_finalize_authorization_v1" ||
    authorization.trusted !== true || authorization.allowed !== true ||
    authorization.decision !== "ALLOW_FINALIZE" || authorization.decision_id !== ticket.ticket_id ||
    authorization.tenant_id !== run.tenant_id || authorization.work_id !== run.work_id ||
    authorization.repository !== run.repository || authorization.target_commit !== run.merge_commit ||
    authorization.action_ticket_id !== ticket.ticket_id ||
    authorization.release_manifest_digest !== ticket.action.release_manifest_digest ||
    authorization.host_kind !== run.host_kind ||
    authorization.host_session_fingerprint !== run.host_session_fingerprint ||
    authorization.result_commit_verified !== true || authorization.verification_scope !== "full_release" ||
    authorization.services_verified !== true || authorization.host_policy_override !== false ||
    authorization.host_policy_must_allow !== true || authorization.external_execution_allowed !== false ||
    authorization.host_execution_required !== true || authorization.provider_execution !== false ||
    !SHA256.test(String(authorization.action_ticket_digest || "")) ||
    !SHA256.test(String(authorization.authorization_digest || "")) ||
    !/^hnf_[a-f0-9]{64}$/.test(String(authorization.signature || ""))
  ) fail("standing_release_finalize_authorization_invalid");
  if (!Array.isArray(authorization.live_services) || authorization.live_services.length !== run.services.length) {
    fail("standing_release_live_service_set_mismatch");
  }
  const seen = new Set();
  for (const observed of authorization.live_services) {
    exactKeys(observed, LIVE_SERVICE_KEYS, "standing_release_live_service_invalid");
    requiredKeys(observed, [
      "service_id", "environment", "live_commit", "health_status", "health_contract_digest",
      "readback_digest",
    ], "standing_release_live_service_invalid");
    const key = serviceKey(observed);
    const expected = run.services.find((service) => serviceKey(service) === key);
    if (!expected || seen.has(key) || observed.live_commit !== run.merge_commit ||
        observed.health_status !== "healthy" ||
        observed.health_contract_digest !== expected.health_contract_digest) {
      fail("standing_release_live_service_set_mismatch");
    }
    digest(observed.readback_digest, "standing_release_live_service_invalid");
    seen.add(key);
  }
  return [...seen].sort();
}

export function advanceStandingReleaseRun(run, ticketRecord, { now, expected_version } = {}) {
  assertRun(run);
  assertMutable(run);
  assertCas(run, expected_version);
  if (run.state !== "ACTION_IN_PROGRESS" || !run.active_action) fail("standing_release_action_not_in_progress");
  const at = timestamp(now);
  const validated = validateTicketRecord(run, ticketRecord, at);
  if (validated.ticket.ticket_id !== run.active_action.ticket_id || validated.action_digest !== run.active_action.action_digest) {
    fail("standing_release_active_ticket_mismatch");
  }
  const status = outcome(ticketRecord);
  if (status === "pending") return run;
  if (status === "invalid") fail("standing_release_ticket_outcome_invalid");
  if (status === "failure") {
    return next(run, {
      state: "BLOCKED",
      resume_state: null,
      active_action: null,
      terminal_reason_digest: objectDigest({ code: "action_failed", ticket_id: validated.ticket.ticket_id }),
    }, at);
  }
  const patch = {
    state: run.resume_state,
    resume_state: null,
    active_action: null,
    completed_ticket_ids: [...run.completed_ticket_ids, validated.ticket.ticket_id],
    last_ticket_id: validated.ticket.ticket_id,
  };
  switch (validated.action.kind) {
    case "git.commit": {
      const head = resultCommit(ticketRecord, "standing_release_commit_result_invalid");
      if (head === validated.action.parent_commit) fail("standing_release_commit_result_invalid");
      patch.current_head_commit = head;
      if (run.active_action.repair) patch.repair_attempts = run.repair_attempts + 1;
      break;
    }
    case "git.push.branch": {
      const head = resultCommit(ticketRecord, "standing_release_push_result_invalid");
      if (head !== run.current_head_commit) fail("standing_release_push_result_mismatch");
      patch.remote_head_commit = head;
      break;
    }
    case "github.draft_pr": {
      const pullRequest = ticketRecord.observed_pull_request ?? ticketRecord.result_pull_request;
      if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) fail("standing_release_pull_request_result_invalid");
      patch.pull_request = pullRequest;
      patch.pull_request_ready = false;
      patch.draft_pr_ticket_id = validated.ticket.ticket_id;
      break;
    }
    case "github.ready":
      patch.pull_request_ready = true;
      break;
    case "github.merge": {
      if (validated.action.origin_draft_ticket_id !== undefined &&
          validated.action.origin_draft_ticket_id !== run.draft_pr_ticket_id) {
        fail("standing_release_action_repair_origin_invalid");
      }
      const merged = resultCommit(ticketRecord, "standing_release_merge_result_invalid");
      if (merged === run.current_head_commit || merged === run.change_cone.base_commit) fail("standing_release_merge_result_invalid");
      patch.merge_commit = merged;
      patch.merge_ticket_id = validated.ticket.ticket_id;
      break;
    }
    case "render.observe": {
      patch.observed_services = verifiedLiveServices(run, ticketRecord, validated.ticket);
      patch.state = "COMPLETED";
      break;
    }
    default:
      fail("standing_release_action_invalid");
  }
  return next(run, patch, at);
}

export function cancelStandingReleaseRun(run, { reason_digest, now, expected_version } = {}) {
  assertRun(run);
  assertMutable(run);
  assertCas(run, expected_version);
  if (run.state === "ACTION_IN_PROGRESS") fail("standing_release_action_outcome_reconciliation_required");
  const at = timestamp(now);
  return next(run, {
    state: "CANCELLED",
    resume_state: null,
    active_action: null,
    terminal_reason_digest: digest(reason_digest, "standing_release_cancel_reason_invalid"),
  }, at);
}

export function quarantineExpiredStandingReleaseRun(run, {
  ticket_id,
  reservation_id,
  now,
  expected_version,
} = {}) {
  assertRun(run);
  assertMutable(run);
  assertCas(run, expected_version);
  if (
    run.state !== "ACTION_IN_PROGRESS" || !run.active_action ||
    run.active_action.ticket_id !== ticket_id ||
    !TICKET_ID.test(String(ticket_id || "")) ||
    !/^hnr_[A-Za-z0-9._-]{8,200}$/.test(String(reservation_id || ""))
  ) fail("standing_release_expired_reservation_mismatch");
  const at = timestamp(now);
  return next(run, {
    state: "QUARANTINED",
    resume_state: null,
    active_action: null,
    terminal_reason_digest: objectDigest({
      code: "reservation_expired_unknown_effect",
      ticket_id,
      reservation_id,
      action_digest: run.active_action.action_digest,
    }),
  }, at);
}
