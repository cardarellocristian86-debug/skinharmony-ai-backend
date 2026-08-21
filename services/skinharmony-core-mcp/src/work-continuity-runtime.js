import crypto from "node:crypto";
import { Pool } from "pg";
import { redactMemoryText } from "./cloud-memory-store.js";
import { assertTransitionAllowed } from "../../shared/core-block-remediation.js";

// Existing MCP create/read/capsule responses retain their v1 contract. New
// fabric methods advertise WORK_CONTINUITY_FABRIC_SCHEMA_VERSION; the storage
// upgrade is additive and does not reinterpret legacy records.
export const WORK_CONTINUITY_SCHEMA_VERSION = "work_continuity_v1";
export const WORK_CONTINUITY_FABRIC_SCHEMA_VERSION = "work_continuity_fabric_v2";
export const WORK_EVENT_TYPES = new Set([
  "work_created", "branch_opened", "function_added", "function_changed",
  "dependency_changed", "checkpoint_created", "handoff_created",
  "test_completed", "defect_found", "correction_verified", "work_resumed",
  "drift_detected", "rollback_prepared", "memory_verified",
  "participant_joined", "participant_heartbeat", "lease_acquired",
  "lease_renewed", "lease_released", "lease_expired", "lease_conflict",
  "message_posted",
  "intent_anchored", "native_plan_created", "native_agent_bound",
  "native_agent_reported", "closure_evaluated", "atlas_updated",
  "software_challenge_opened", "software_challenge_resolved", "software_receipt_recorded",
  "incident_recorded", "incident_runbook_verified", "incident_runbook_quarantined",
  "native_plan_superseded", "native_agent_lease_expired",
  "core_join_issued", "closure_finalized",
  "generic_core_join_issued", "generic_closure_finalized", "work_archived",
  "legacy_work_reconciled_closed",
  "quality_failure_observed", "security_observation_quarantined", "quality_evidence_verified", "quality_completion_rejected",
]);

const NATIVE_HOST_TYPES = new Set(["chatgpt_native", "codex_native"]);
const NATIVE_TASK_KINDS = new Set(["builder", "verifier", "researcher", "reviewer", "supervisor"]);
const NATIVE_REPORT_STATES = new Set(["completed", "failed", "blocked"]);
const NATIVE_ASSIGNMENT_CAPABILITY_PATTERN = /^hnac_[A-Za-z0-9_-]{43}$/;
const GALLERY_PARTICIPANT_MAX_TTL_SECONDS = 3_600;
const GALLERY_PARTICIPANT_ACL = Object.freeze(["gallery.read", "gallery.coordinate"]);

function gallerySecurityError(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function dttWorkBindingError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const DTT_WORK_ACL_DENIALS = new Set([
  "work_acl_denied",
  "tenant_work_not_found",
  "legacy_work_not_found",
  "work_id_invalid",
  "tenant_identity_required",
  "work_actor_identity_required",
  "work_server_acl_required",
  "work_server_acl_subject_mismatch",
  "work_server_acl_tenant_mismatch",
]);

const GENERIC_WORK_CORE_JOIN_ACL_DENIALS = new Set(DTT_WORK_ACL_DENIALS);

export async function authorizeDttExactWorkRead({
  store,
  identity,
  tenant_id,
  work_id,
} = {}) {
  if (typeof store?.readWork !== "function") {
    throw dttWorkBindingError("dtt_work_binding_unavailable");
  }
  const tenantId = tenant(tenant_id);
  const workId = uuid(work_id, "work_id");
  let result;
  try {
    result = await store.readWork(identity, { work_id: workId });
  } catch (error) {
    const reason = String(error?.code || error?.message || "");
    if (DTT_WORK_ACL_DENIALS.has(reason) || reason.startsWith("tenant_work_membership_")) {
      throw dttWorkBindingError("dtt_work_acl_denied");
    }
    throw dttWorkBindingError("dtt_work_binding_unavailable");
  }
  if (
    result?.schema_version !== "work_continuity_v2"
    || String(result?.work?.tenant_id || "") !== tenantId
    || String(result?.work?.work_id || "").toLowerCase() !== workId.toLowerCase()
  ) {
    throw dttWorkBindingError("dtt_work_acl_denied");
  }
  return Object.freeze({ tenant_id: tenantId, work_id: workId });
}

export async function authorizeGenericWorkCoreJoinExactWorkRead({
  store,
  identity,
  tenant_id,
  work_id,
} = {}) {
  if (typeof store?.readWork !== "function") {
    throw dttWorkBindingError("generic_work_core_join_work_binding_unavailable");
  }
  const tenantId = tenant(tenant_id);
  const workId = uuid(work_id, "work_id");
  let result;
  try {
    result = await store.readWork(identity, { work_id: workId });
  } catch (error) {
    const reason = String(error?.code || error?.message || "");
    if (GENERIC_WORK_CORE_JOIN_ACL_DENIALS.has(reason)
        || reason.startsWith("tenant_work_membership_")) {
      throw dttWorkBindingError("generic_work_core_join_work_acl_denied");
    }
    throw dttWorkBindingError("generic_work_core_join_work_binding_unavailable");
  }
  if (
    result?.schema_version !== "work_continuity_v2"
    || String(result?.work?.tenant_id || "") !== tenantId
    || String(result?.work?.work_id || "").toLowerCase() !== workId.toLowerCase()
  ) {
    throw dttWorkBindingError("generic_work_core_join_work_acl_denied");
  }
  return Object.freeze({ tenant_id: tenantId, work_id: workId });
}

export function assertGalleryParticipantBinding(identity = {}, input = {}) {
  const presence = identity.agentPresence;
  if (
    presence?.transport_bound !== true ||
    !/^ags_[a-f0-9]{32}$/.test(String(presence.signature || "")) ||
    !/^[a-f0-9]{16,64}$/i.test(String(presence.host_transport_session_fingerprint || ""))
  ) {
    gallerySecurityError("gallery_signed_presence_required");
  }
  if (
    String(input.session_id || "") !== String(presence.session_id || "") ||
    String(input.agent_id || "") !== String(presence.agent_id || "") ||
    (input.client_type && String(input.client_type) !== String(presence.client_type || ""))
  ) {
    gallerySecurityError("gallery_participant_presence_mismatch");
  }
  return {
    sessionId: identifier(presence.session_id, "session_id"),
    agentId: identifier(presence.agent_id, "agent_id"),
    clientType: safeText(presence.client_type || "other", 40),
    sessionFingerprint: String(presence.session_fingerprint || ""),
    transportSessionFingerprint: String(presence.host_transport_session_fingerprint).toLowerCase(),
    acl: [...GALLERY_PARTICIPANT_ACL],
  };
}
const WORK_CATALOG_STATUSES = new Set([
  "active", "verified", "release_ready", "completed", "cancelled", "superseded", "blocked", "failed",
]);
// A new host conversation may safely attach itself only when the project has
// exactly one still-operational Work.  This is deliberately narrower than the
// catalog: closed or superseded Work must never become the implicit context of
// a fresh chat, and two candidates must remain an explicit selection.
const AUTO_RESUMABLE_WORK_STATUSES = Object.freeze([
  "active", "verified", "release_ready", "blocked",
]);
const STANDING_RELEASE_ELIGIBLE_WORK_STATUSES = new Set([
  "active", "verified", "release_ready",
]);

function tenant(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw new Error("tenant_invalid");
  return id;
}

function uuid(value, name = "id") {
  const id = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${name}_invalid`);
  }
  return id;
}

function safeText(value, max = 4_000) {
  return redactMemoryText(String(value || "").replaceAll("\u0000", "")).text.slice(0, max);
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error("continuity_limit_invalid");
  return parsed;
}

const LEGACY_SURFACE_KINDS = new Set(["file", "component", "dependency"]);
const CAUSAL_SURFACE_KINDS = new Set(["causal_project", "causal_change", "causal_obligation"]);
const SURFACE_KINDS = new Set([...LEGACY_SURFACE_KINDS, ...CAUSAL_SURFACE_KINDS]);
const CAUSAL_CONTEXT_LEASE_AUTHORITY_SCOPES = new Set([
  "agent:presence:recover",
  "causal:change:execute",
  "causal:evidence:produce",
  "causal:obligation:execute",
  "causal:obligation:close",
  "causal:outcome:reconcile",
  "causal:write",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function normalizeSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length < 1 || surfaces.length > 100) {
    throw new Error("continuity_lease_surfaces_invalid");
  }
  const normalized = surfaces.map((surface) => {
    const kind = String(surface?.kind || "").trim().toLowerCase();
    let value = safeText(surface?.value, 500).trim().replaceAll("\\", "/").replace(/^\.\//, "");
    if (!SURFACE_KINDS.has(kind) || !value || value.startsWith("/") || value.includes("\u0000")) {
      throw new Error("continuity_lease_surface_invalid");
    }
    if (kind === "file") {
      value = value.replace(/\/+/g, "/").replace(/\/$/, "");
      if (!value || value.split("/").some((part) => part === "." || part === "..")) {
        throw new Error("continuity_lease_surface_invalid");
      }
    } else if (CAUSAL_SURFACE_KINDS.has(kind)) {
      value = value.toLowerCase();
      if (!UUID_PATTERN.test(value)) throw new Error("continuity_lease_surface_invalid");
    }
    return { kind, value };
  });
  const unique = new Map(normalized.map((surface) => [`${surface.kind}\u0000${surface.value}`, surface]));
  return [...unique.values()].sort((a, b) => `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`));
}

function causalLeasePolicy({ tenantId, actorId, leaseId, purpose, surfaces, sessionFingerprint }) {
  const causal = surfaces.filter((surface) => CAUSAL_SURFACE_KINDS.has(surface.kind));
  if (!causal.length) {
    return {
      authorityScope: [],
      authoritySource: "legacy_work_lease_v1",
      authorityBindingDigest: null,
      policySessionFingerprint: null,
      causal: false,
    };
  }
  if (causal.length !== surfaces.length || String(purpose || "").trim() !== "causal_context_issue") {
    throw new Error("continuity_causal_lease_contract_invalid");
  }
  const count = (kind) => causal.filter((surface) => surface.kind === kind).length;
  if (count("causal_project") !== 1 || count("causal_change") !== 1 || count("causal_obligation") < 1) {
    throw new Error("continuity_causal_lease_contract_invalid");
  }
  if (!/^[a-f0-9]{16,64}$/i.test(String(sessionFingerprint || ""))) {
    throw new Error("continuity_causal_lease_session_fingerprint_required");
  }
  // The lease authority is a static Core policy for this exact purpose and is
  // never copied from an MCP argument or a DTT receipt.
  const persistedAuthorityScope = [...CAUSAL_CONTEXT_LEASE_AUTHORITY_SCOPES].sort();
  const authorityProof = {
    schema_version: "persisted_lease_authority_v1",
    tenant_id: tenantId,
    lease_id: leaseId,
    actor_id: actorId,
    purpose: "causal_context_issue",
    surfaces,
    persisted_authority_scope: persistedAuthorityScope,
    policy_session_fingerprint: sessionFingerprint,
  };
  return {
    authorityScope: persistedAuthorityScope,
    authoritySource: "persisted_lease_policy_v1",
    authorityBindingDigest: digest(authorityProof),
    policySessionFingerprint: sessionFingerprint,
    causal: true,
  };
}

export function surfacesOverlap(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.value === right.value) return true;
  if (left.kind !== "file") return false;
  return left.value.startsWith(`${right.value}/`) || right.value.startsWith(`${left.value}/`);
}

function identifier(value, name = "identifier", max = 160) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(normalized) || normalized.length > max) {
    throw new Error(`${name}_invalid`);
  }
  return normalized;
}

function hostTaskIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 240 || normalized.includes("..")) {
    throw new Error("host_task_id_invalid");
  }
  if (/^\/[a-zA-Z0-9][a-zA-Z0-9_/-]{1,239}$/.test(normalized) ||
      /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(normalized)) {
    return normalized;
  }
  throw new Error("host_task_id_invalid");
}

function stringList(value, name, { maxItems = 100, maxLength = 240 } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${name}_invalid`);
  return [...new Set(value.map((item) => {
    const normalized = safeText(item, maxLength).trim();
    if (!normalized) throw new Error(`${name}_invalid`);
    return normalized;
  }))];
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}_invalid`);
  return value;
}

function dateValue(value, name) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${name}_invalid`);
  return parsed;
}

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function deterministicUuid(value) {
  const bytes = Buffer.from(digest(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeCatalogCursor(row) {
  return Buffer.from(JSON.stringify({
    updated_at: dateValue(row.updated_at, "catalog_updated_at").toISOString(),
    work_id: uuid(row.work_id, "work_id"),
  }), "utf8").toString("base64url");
}

function decodeCatalogCursor(value) {
  if (!value) return null;
  try {
    const encoded = String(value);
    if (encoded.length > 240 || !/^[a-zA-Z0-9_-]+$/.test(encoded)) {
      throw new Error("invalid_cursor");
    }
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return {
      updated_at: dateValue(decoded.updated_at, "catalog_cursor").toISOString(),
      work_id: uuid(decoded.work_id, "catalog_cursor_work_id"),
    };
  } catch {
    throw new Error("work_catalog_cursor_invalid");
  }
}

function cleanJson(value, maxBytes = 200_000) {
  const serialized = JSON.stringify(value ?? {});
  if (Buffer.byteLength(serialized) > maxBytes) throw new Error("continuity_payload_too_large");
  const sensitiveKeys = new Set([
    "api_key", "apikey", "openai_api_key", "provider_key", "provider_credential",
    "token", "access_token", "refresh_token", "secret", "client_secret", "password",
    "authorization", "private_key",
  ]);
  const redactStructured = (current) => {
    if (typeof current === "string") return redactMemoryText(current).text;
    if (Array.isArray(current)) return current.map(redactStructured);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(Object.entries(current).map(([key, item]) => {
      const normalizedKey = key
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replaceAll("-", "_")
        .toLowerCase();
      return [
        key,
        sensitiveKeys.has(normalizedKey) ? "[REDACTED]" : redactStructured(item),
      ];
    }));
  };
  const cleaned = redactStructured(JSON.parse(serialized));
  if (Buffer.byteLength(JSON.stringify(cleaned)) > maxBytes) throw new Error("continuity_payload_too_large");
  return cleaned;
}

function canonicalIntentInput(input = {}) {
  return {
    project_id: safeText(input.project_id, 64),
    session_id: safeText(input.session_id, 64),
    parent_work_id: input.parent_work_id || null,
    initial_message: safeText(input.initial_message || input.request || input.idea, 20_000),
    idea: safeText(input.idea, 8_000),
    objective: safeText(input.objective, 8_000),
    acceptance_criteria: stringList(input.acceptance_criteria, "acceptance_criteria", {
      maxItems: 100,
      maxLength: 1_000,
    }),
    constraints: stringList(input.constraints, "constraints", { maxItems: 100, maxLength: 1_000 }),
  };
}

export function buildIntentAnchor(input = {}) {
  const canonical = canonicalIntentInput(input);
  if (!canonical.project_id || !canonical.session_id || !canonical.initial_message ||
      !canonical.idea || !canonical.objective) {
    throw new Error("intent_anchor_fields_required");
  }
  const anchor = {
    schema_version: "intent_anchor_v1",
    initial_message: canonical.initial_message,
    idea: canonical.idea,
    objective: canonical.objective,
    acceptance_criteria: canonical.acceptance_criteria,
    constraints: canonical.constraints,
    source: {
      client_type: NATIVE_HOST_TYPES.has(input.host_type) ? input.host_type : safeText(input.client_type || "connected_ai", 40),
      session_id: canonical.session_id,
    },
    immutable: true,
  };
  return { anchor, intent_digest: digest(anchor), create_request_digest: digest(canonical) };
}

function assertNativePayload(value) {
  const serialized = JSON.stringify(value ?? {});
  if (/"(?:openai_api_key|api_key|provider_key|provider_credential)"\s*:/i.test(serialized)) {
    throw new Error("native_agent_provider_credential_forbidden");
  }
  if (/(?:^|[^\w])sk-(?:proj-)?[a-z0-9_-]{12,}/i.test(serialized)) {
    throw new Error("native_agent_provider_credential_forbidden");
  }
}

export function buildNativeAgentPlan(input = {}) {
  assertNativePayload(input);
  const hostType = String(input.host_type || "");
  if (!NATIVE_HOST_TYPES.has(hostType)) throw new Error("native_agent_host_type_invalid");
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (!tasks.length || tasks.length > 3) throw new Error("native_agent_task_count_invalid");
  const seen = new Set();
  const normalizedTasks = tasks.map((task) => {
    requireObject(task, "native_agent_task");
    const taskId = identifier(task.task_id, "task_id", 120);
    if (seen.has(taskId)) throw new Error("native_agent_task_duplicate");
    seen.add(taskId);
    const kind = String(task.kind || "");
    if (!NATIVE_TASK_KINDS.has(kind)) throw new Error("native_agent_task_kind_invalid");
    const instruction = safeText(task.instruction, 8_000).trim();
    if (!instruction) throw new Error("native_agent_instruction_required");
    return {
      task_id: taskId,
      kind,
      instruction,
      required: task.required !== false,
      dependencies: stringList(task.dependencies, "native_agent_dependencies", {
        maxItems: 3,
        maxLength: 120,
      }),
      task_digest: digest({ task_id: taskId, kind, instruction }),
    };
  });
  for (const task of normalizedTasks) {
    if (task.dependencies.some((dependency) => !seen.has(dependency) || dependency === task.task_id)) {
      throw new Error("native_agent_dependency_invalid");
    }
  }
  const maxParallel = Math.min(Math.max(Number(input.max_parallel) || 1, 1), 2, normalizedTasks.length);
  const requirements = {
    independent_verifier_required: input.closure_requirements?.independent_verifier_required !== false,
    tests_required: input.closure_requirements?.tests_required !== false,
    evidence_required: input.closure_requirements?.evidence_required !== false,
    live_verification_required: input.closure_requirements?.live_verification_required === true,
  };
  const requiredChecks = stringList(input.required_checks, "native_agent_required_checks", {
    maxItems: 64,
    maxLength: 160,
  }).map((check) => identifier(check, "native_agent_required_check", 160)).sort();
  if (!requiredChecks.length) throw new Error("native_agent_required_checks_missing");
  if (requirements.independent_verifier_required &&
      !normalizedTasks.some((task) => task.kind === "verifier")) {
    throw new Error("native_agent_verifier_task_required");
  }
  if (normalizedTasks.filter((task) => task.kind === "builder").length !== 1) {
    throw new Error("native_agent_single_builder_required");
  }
  const softwareContract = input.software_contract === undefined ? null : cleanJson(input.software_contract, 80_000);
  return {
    schema_version: "native_agent_plan_v1",
    execution_mode: "host_native_only",
    host_type: hostType,
    // Every host-native repository plan is release-ticketed. The caller
    // cannot downgrade this immutable plan field during finalization.
    release_mode: "external_ticket_required",
    provider_execution: false,
    provider_api_key_required: false,
    max_agents: normalizedTasks.length,
    max_parallel: maxParallel,
    required_checks: requiredChecks,
    tasks: normalizedTasks,
    closure_requirements: requirements,
    ...(softwareContract ? { software_contract: { schema_version: "worker_plan_contract_v1", ...softwareContract } } : {}),
  };
}

function buildAcceptanceContract(anchor, intentDigest) {
  requireObject(anchor, "intent_anchor");
  if (!/^[a-f0-9]{64}$/.test(String(intentDigest || ""))) {
    throw new Error("intent_digest_invalid");
  }
  const candidates = [
    {
      criterion_id: "objective",
      criterion_kind: "objective",
      text: safeText(anchor.objective, 8_000).trim(),
    },
    ...(Array.isArray(anchor.acceptance_criteria) ? anchor.acceptance_criteria : [])
      .map((criterion, index) => ({
        criterion_id: `acceptance_${index + 1}`,
        criterion_kind: "acceptance",
        text: safeText(criterion, 1_000).trim(),
      })),
    ...(Array.isArray(anchor.constraints) ? anchor.constraints : [])
      .map((constraint, index) => ({
        criterion_id: `constraint_${index + 1}`,
        criterion_kind: "constraint",
        text: safeText(constraint, 1_000).trim(),
      })),
  ].filter((criterion) => criterion.text);
  const criteria = candidates.map((criterion) => ({
    ...criterion,
    criterion_digest: digest({
      schema_version: "intent_acceptance_criterion_v1",
      intent_digest: intentDigest,
      criterion_id: criterion.criterion_id,
      criterion_kind: criterion.criterion_kind,
      text: criterion.text,
    }),
  }));
  if (!criteria.length) throw new Error("intent_acceptance_contract_empty");
  return {
    schema_version: "intent_acceptance_contract_v1",
    intent_digest: intentDigest,
    criteria,
    criteria_digest: digest(criteria),
    evidence_required: true,
    independent_verifier_required: true,
  };
}

function bindCoreWorkPlan(corePlan, localPlan, {
  workId,
  intentDigest,
  repository,
  baseBranch,
} = {}) {
  requireObject(corePlan, "core_host_native_work_plan");
  const expectedBaseBranch = baseBranch === undefined
    ? null
    : releaseBranch(baseBranch, "core_host_native_expected_base_branch");
  const coreBaseBranch = corePlan.base_branch === undefined
    ? null
    : releaseBranch(corePlan.base_branch, "core_host_native_base_branch");
  const requiredChecksPolicyDigest =
    corePlan.required_checks_policy_digest === undefined
      ? null
      : releaseField(
          corePlan.required_checks_policy_digest,
          "core_host_native_required_checks_policy_digest",
          /^[a-f0-9]{64}$/,
          64,
        );
  const corePlanPayload = {
    tenant_id: corePlan.tenant_id,
    work_id: corePlan.work_id,
    intent_anchor_digest: corePlan.intent_anchor_digest,
    repository: corePlan.repository,
    ...(coreBaseBranch ? { base_branch: coreBaseBranch } : {}),
    objective: corePlan.objective,
    required_checks: corePlan.required_checks,
    ...(requiredChecksPolicyDigest
      ? { required_checks_policy_digest: requiredChecksPolicyDigest }
      : {}),
    builder_agent_id: corePlan.builder_agent_id,
    verifier_agent_ids: corePlan.verifier_agent_ids,
    agents: corePlan.agents,
    maximum_parallel_agents: corePlan.maximum_parallel_agents,
  };
  if (
    corePlan.schema_version !== "host_native_work_plan_v1" ||
    corePlan.work_id !== workId ||
    corePlan.intent_anchor_digest !== intentDigest ||
    corePlan.repository !== repository ||
    coreBaseBranch !== expectedBaseBranch ||
    (requiredChecksPolicyDigest !== null && coreBaseBranch === null) ||
    corePlan.execution_adapter !== "host_native" ||
    corePlan.provider_execution !== false ||
    corePlan.provider_api_key_required !== false ||
    corePlan.server_model_calls !== 0 ||
    corePlan.host_materialization_required !== true ||
    corePlan.host_policy_override !== false ||
    corePlan.host_policy_must_allow !== true ||
    !/^[a-f0-9]{64}$/.test(String(corePlan.plan_digest || "")) ||
    corePlan.plan_digest !== digest(corePlanPayload) ||
    corePlan.plan_id !== `hnp_${corePlan.plan_digest.slice(0, 40)}`
  ) {
    throw new Error("core_host_native_work_plan_invalid");
  }
  if (
    Number(corePlan.maximum_parallel_agents) !== Number(localPlan.max_parallel) ||
    JSON.stringify([...(corePlan.required_checks || [])].sort()) !==
      JSON.stringify(localPlan.required_checks) ||
    !Array.isArray(corePlan.agents) ||
    corePlan.agents.length !== localPlan.tasks.length
  ) {
    throw new Error("core_host_native_work_plan_scope_mismatch");
  }
  const localTasks = new Map(localPlan.tasks.map((task) => [task.task_id, task]));
  const localBuilderIds = localPlan.tasks
    .filter((task) => task.kind === "builder")
    .map((task) => task.task_id);
  const localVerifierIds = localPlan.tasks
    .filter((task) => task.kind === "verifier")
    .map((task) => task.task_id)
    .sort();
  if (
    corePlan.builder_agent_id !== localBuilderIds[0] ||
    JSON.stringify([...(corePlan.verifier_agent_ids || [])].sort()) !==
      JSON.stringify(localVerifierIds)
  ) {
    throw new Error("core_host_native_work_plan_scope_mismatch");
  }
  for (const agent of corePlan.agents) {
    const task = localTasks.get(agent.agent_id);
    const dependencies = [...(task?.dependencies || [])].sort();
    if (
      !task ||
      agent.role !== task.kind ||
      agent.task !== task.instruction ||
      JSON.stringify([...(agent.depends_on || [])].sort()) !== JSON.stringify(dependencies)
    ) {
      throw new Error("core_host_native_work_plan_scope_mismatch");
    }
  }
  if (localVerifierIds.some((verifierId) =>
    !localTasks.get(verifierId)?.dependencies.includes(localBuilderIds[0]))) {
    throw new Error("core_host_native_work_plan_dependency_mismatch");
  }
  return {
    schema_version: corePlan.schema_version,
    plan_id: corePlan.plan_id,
    plan_digest: corePlan.plan_digest,
    repository: corePlan.repository,
    ...(coreBaseBranch ? { base_branch: coreBaseBranch } : {}),
    intent_anchor_digest: corePlan.intent_anchor_digest,
    ...(requiredChecksPolicyDigest
      ? { required_checks_policy_digest: requiredChecksPolicyDigest }
      : {}),
    maximum_parallel_agents: corePlan.maximum_parallel_agents,
    required_checks: [...corePlan.required_checks],
    builder_agent_id: corePlan.builder_agent_id,
    verifier_agent_ids: [...corePlan.verifier_agent_ids],
    provider_execution: false,
    provider_api_key_required: false,
    host_policy_override: false,
    host_policy_must_allow: true,
  };
}

export function evaluateNativeClosure({ plan, agents = [] } = {}) {
  requireObject(plan, "native_agent_plan");
  const missing = [];
  const taskById = new Map((plan.tasks || []).map((task) => [task.task_id, task]));
  const agentByTask = new Map();
  for (const agent of agents) {
    if (!taskById.has(agent.task_id)) missing.push(`unknown_task_binding:${agent.task_id}`);
    if (agentByTask.has(agent.task_id)) missing.push(`duplicate_task_binding:${agent.task_id}`);
    agentByTask.set(agent.task_id, agent);
  }
  for (const task of plan.tasks || []) {
    const agent = agentByTask.get(task.task_id);
    if (task.required !== false && !agent) missing.push(`agent_not_bound:${task.task_id}`);
    if (task.required !== false && agent?.status !== "completed") missing.push(`task_not_completed:${task.task_id}`);
  }
  const builders = agents.filter((agent) => taskById.get(agent.task_id)?.kind === "builder");
  const verifiers = agents.filter((agent) => taskById.get(agent.task_id)?.kind === "verifier");
  for (const agent of agents) {
    if (agent.report?.correction_required === true) {
      missing.push(`correction_required:${agent.task_id}`);
    }
  }
  const builderIds = new Set(builders.map((agent) => agent.agent_id));
  const builderSessions = new Set(builders
    .map((agent) => agent.native_session_fingerprint)
    .filter(Boolean));
  const independentVerifiers = verifiers.filter((agent) =>
    !builderIds.has(agent.agent_id) &&
    Boolean(agent.native_session_fingerprint) &&
    !builderSessions.has(agent.native_session_fingerprint));
  for (const agent of agents) {
    if (
      !/^[a-f0-9]{16,64}$/i.test(String(agent.native_session_fingerprint || "")) ||
      !/^ags_[a-f0-9]{32}$/.test(String(agent.native_presence_signature || "")) ||
      agent.native_session_fingerprint === agent.coordinator_session_fingerprint
    ) {
      missing.push(`native_agent_result_unattested:${agent.task_id}`);
    }
  }
  const reportedSessions = agents
    .map((agent) => agent.native_session_fingerprint)
    .filter(Boolean);
  if (new Set(reportedSessions).size !== reportedSessions.length) {
    missing.push("native_agent_session_reused");
  }
  if (plan.closure_requirements?.independent_verifier_required) {
    if (!independentVerifiers.length) missing.push("independent_verifier_missing");
    for (const verifier of verifiers) {
      if (builderIds.has(verifier.agent_id)) missing.push("verifier_self_approval_forbidden");
      if (verifier.report?.verdict !== "approved") missing.push(`verifier_not_approved:${verifier.agent_id}`);
    }
    for (const builder of builders.filter((agent) => taskById.get(agent.task_id)?.required !== false)) {
      const covered = independentVerifiers.some((verifier) =>
        verifier.report?.verdict === "approved" &&
        Array.isArray(verifier.report?.verifies_task_ids) &&
        verifier.report.verifies_task_ids.includes(builder.task_id));
      if (!covered) missing.push(`verification_coverage_missing:${builder.task_id}`);
    }
  }
  if (plan.closure_requirements?.tests_required) {
    const tests = agents.flatMap((agent) => Array.isArray(agent.report?.tests) ? agent.report.tests : []);
    if (!tests.length) missing.push("test_evidence_missing");
    if (tests.some((test) => test?.passed !== true)) missing.push("test_failure_present");
  }
  if (plan.closure_requirements?.evidence_required &&
      !agents.some((agent) => Array.isArray(agent.report?.evidence_refs) && agent.report.evidence_refs.length > 0)) {
    missing.push("evidence_refs_missing");
  }
  if (plan.closure_requirements?.live_verification_required &&
      !verifiers.some((agent) => agent.report?.live_verified === true)) {
    missing.push("live_verification_missing");
  }
  const acceptanceContract = plan.acceptance_contract;
  if (
    !acceptanceContract ||
    acceptanceContract.schema_version !== "intent_acceptance_contract_v1" ||
    !Array.isArray(acceptanceContract.criteria) ||
    !acceptanceContract.criteria.length
  ) {
    missing.push("intent_acceptance_contract_missing");
  } else {
    for (const criterion of acceptanceContract.criteria) {
      const evidence = independentVerifiers.flatMap((verifier) =>
        Array.isArray(verifier.report?.acceptance_evidence)
          ? verifier.report.acceptance_evidence
          : [])
        .filter((item) => item?.criterion_digest === criterion.criterion_digest);
      if (!evidence.length) {
        missing.push(`acceptance_evidence_missing:${criterion.criterion_id}`);
      } else if (evidence.some((item) => item?.passed !== true)) {
        missing.push(`acceptance_dissent:${criterion.criterion_id}`);
      } else if (
        !evidence.some((item) =>
          item.passed === true &&
          Array.isArray(item.evidence_refs) &&
          item.evidence_refs.length > 0)
      ) {
        missing.push(`acceptance_not_proven:${criterion.criterion_id}`);
      }
    }
  }
  const reportBindings = agents
    .map((agent) => ({
      task_id: agent.task_id,
      agent_id: agent.agent_id,
      task_kind: taskById.get(agent.task_id)?.kind || agent.task_kind,
      report_digest: String(agent.report_digest || "").toLowerCase(),
      native_session_fingerprint: String(agent.native_session_fingerprint || ""),
      native_presence_signature: String(agent.native_presence_signature || ""),
    }))
    .sort((left, right) => left.task_id.localeCompare(right.task_id));
  if (reportBindings.some((binding) => !/^[a-f0-9]{64}$/.test(binding.report_digest))) {
    missing.push("agent_report_digest_missing");
  }
  const targetCommit = String(builders[0]?.report?.commit_sha || "").toLowerCase();
  if (plan.release_mode === "external_ticket_required") {
    if (builders.length !== 1) missing.push("single_builder_required");
    if (!/^[a-f0-9]{40}$/.test(targetCommit)) missing.push("builder_target_commit_missing");
    for (const verifier of independentVerifiers) {
      if (!/^[a-f0-9]{40}$/.test(String(verifier.report?.commit_sha || ""))) {
        missing.push(`verifier_reviewed_commit_missing:${verifier.agent_id}`);
      } else if (String(verifier.report.commit_sha).toLowerCase() !== targetCommit) {
        missing.push(`verifier_reviewed_commit_mismatch:${verifier.agent_id}`);
      }
    }
    if (!Array.isArray(plan.required_checks) || !plan.required_checks.length) {
      missing.push("required_checks_missing");
    }
  }
  const testEvidence = agents
    .flatMap((agent) => (Array.isArray(agent.report?.tests) ? agent.report.tests : [])
      .map((test) => ({
        task_id: agent.task_id,
        agent_id: agent.agent_id,
        test,
      })));
  const acceptanceProofs = (acceptanceContract?.criteria || []).map((criterion) => {
    const verifierEvidence = independentVerifiers
      .flatMap((verifier) => (verifier.report?.acceptance_evidence || [])
        .filter((item) => item.criterion_digest === criterion.criterion_digest)
        .map((item) => ({
          agent_id: verifier.agent_id,
          report_digest: verifier.report_digest,
          passed: item.passed === true,
          evidence_refs: [...item.evidence_refs].sort(),
        })))
      .sort((left, right) => left.agent_id.localeCompare(right.agent_id));
    return {
      criterion_id: criterion.criterion_id,
      criterion_digest: criterion.criterion_digest,
      evidence_digest: digest({
        criterion_digest: criterion.criterion_digest,
        verifier_evidence: verifierEvidence,
      }),
      proven: verifierEvidence.length > 0 &&
        verifierEvidence.every((item) => item.passed === true && item.evidence_refs.length > 0),
    };
  });
  const requiredChecks = [...(plan.required_checks || [])].sort();
  const checksDigest = digest({
    schema_version: "native_closure_checks_v1",
    target_commit: targetCommit || null,
    required_checks: requiredChecks,
    test_evidence: testEvidence,
    report_bindings: reportBindings,
  });
  return {
    schema_version: "native_closure_evaluation_v1",
    closed: missing.length === 0,
    missing: [...new Set(missing)],
    completed_tasks: agents.filter((agent) => agent.status === "completed").map((agent) => agent.task_id),
    independent_verifier_count: independentVerifiers.length,
    acceptance_criteria_count: acceptanceContract?.criteria?.length || 0,
    acceptance_criteria_proven: acceptanceContract?.criteria?.length
      ? acceptanceContract.criteria.length -
        missing.filter((item) =>
          item.startsWith("acceptance_evidence_missing:") ||
          item.startsWith("acceptance_not_proven:") ||
          item.startsWith("acceptance_dissent:")).length
      : 0,
    target_commit: targetCommit || null,
    required_checks: requiredChecks,
    checks_digest: checksDigest,
    report_bindings: reportBindings,
    acceptance_proofs: acceptanceProofs,
  };
}

function releaseField(value, name, pattern, max = 240) {
  const normalized = safeText(value, max).trim().toLowerCase();
  if (!pattern.test(normalized)) throw new Error(`${name}_invalid`);
  return normalized;
}

function releaseBranch(value, name) {
  const normalized = safeText(value, 240).trim();
  if (
    !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]+$/.test(normalized)
  ) {
    throw new Error(`${name}_invalid`);
  }
  return normalized;
}

function normalizeReleaseInput(value) {
  const release = requireObject(value, "continuity_release");
  const allowedKeys = new Set([
    "base_branch", "delivery_branch", "base_commit", "head_commit", "tree_sha",
    "diff_digest", "changed_files", "delivery", "rollback",
  ]);
  if (Object.keys(release).some((key) => !allowedKeys.has(key))) {
    throw new Error("continuity_release_fields_invalid");
  }
  const changedFiles = stringList(release.changed_files, "continuity_release_changed_files", {
    maxItems: 1_000,
    maxLength: 2_000,
  }).sort();
  if (!changedFiles.length) throw new Error("continuity_release_changed_files_invalid");
  return {
    base_branch: releaseBranch(release.base_branch, "continuity_release_base_branch"),
    delivery_branch: releaseBranch(
      release.delivery_branch,
      "continuity_release_delivery_branch",
    ),
    base_commit: releaseField(
      release.base_commit,
      "continuity_release_base_commit",
      /^[a-f0-9]{40}$/,
      40,
    ),
    head_commit: releaseField(
      release.head_commit,
      "continuity_release_head_commit",
      /^[a-f0-9]{40}$/,
      40,
    ),
    tree_sha: releaseField(
      release.tree_sha,
      "continuity_release_tree_sha",
      /^[a-f0-9]{40}$/,
      40,
    ),
    diff_digest: releaseField(
      release.diff_digest,
      "continuity_release_diff_digest",
      /^[a-f0-9]{64}$/,
      64,
    ),
    changed_files: changedFiles,
    delivery: cleanJson(requireObject(release.delivery, "continuity_release_delivery"), 80_000),
    rollback: cleanJson(requireObject(release.rollback, "continuity_release_rollback"), 20_000),
  };
}

function buildCoreJoinMaterial({
  tenantId,
  workId,
  plan,
  planDigest,
  agents,
  evaluation,
  evaluationDigest,
  release,
  attestationSigningSecret,
} = {}) {
  if (evaluation?.closed !== true) throw new Error("native_agent_verified_closure_required");
  const normalizedRelease = normalizeReleaseInput(release);
  const coreAuthority = requireObject(plan.core_authority, "core_authority");
  if (
    coreAuthority.base_branch &&
    normalizedRelease.base_branch !== coreAuthority.base_branch
  ) {
    throw new Error("continuity_release_base_branch_policy_mismatch");
  }
  if (normalizedRelease.head_commit !== evaluation.target_commit) {
    throw new Error("continuity_release_head_commit_mismatch");
  }
  const taskKinds = new Map((plan.tasks || []).map((task) => [task.task_id, task.kind]));
  const builders = agents.filter((agent) => taskKinds.get(agent.task_id) === "builder");
  const verifiers = agents.filter((agent) =>
    taskKinds.get(agent.task_id) === "verifier" &&
    agent.status === "completed" &&
    agent.report?.verdict === "approved");
  if (builders.length !== 1 || !verifiers.length) {
    throw new Error("continuity_core_join_agents_invalid");
  }
  const builder = builders[0];
  const builderReport = {
    agent_id: identifier(builder.agent_id, "core_join_builder_agent_id", 120),
    report_digest: releaseField(
      builder.report_digest,
      "core_join_builder_report_digest",
      /^[a-f0-9]{64}$/,
      64,
    ),
    target_commit: releaseField(
      builder.report?.commit_sha,
      "core_join_builder_target_commit",
      /^[a-f0-9]{40}$/,
      40,
    ),
  };
  const verifierReports = verifiers.map((verifier) => ({
    agent_id: identifier(verifier.agent_id, "core_join_verifier_agent_id", 120),
    report_digest: releaseField(
      verifier.report_digest,
      "core_join_verifier_report_digest",
      /^[a-f0-9]{64}$/,
      64,
    ),
    reviewed_commit: releaseField(
      verifier.report?.commit_sha,
      "core_join_verifier_reviewed_commit",
      /^[a-f0-9]{40}$/,
      40,
    ),
    approved: true,
  })).sort((left, right) => left.agent_id.localeCompare(right.agent_id));
  const acceptanceCriteria = (evaluation.acceptance_proofs || []).map((criterion) => ({
    criterion_id: identifier(criterion.criterion_id, "core_join_criterion_id", 160),
    evidence_digest: releaseField(
      criterion.evidence_digest,
      "core_join_criterion_evidence_digest",
      /^[a-f0-9]{64}$/,
      64,
    ),
    proven: criterion.proven === true,
  })).sort((left, right) => left.criterion_id.localeCompare(right.criterion_id));
  if (!acceptanceCriteria.length || acceptanceCriteria.some((criterion) => !criterion.proven)) {
    throw new Error("continuity_core_join_acceptance_invalid");
  }
  const verification = {
    builder_agent_id: builderReport.agent_id,
    verifier_agent_ids: verifierReports.map((report) => report.agent_id),
    required_checks: [...evaluation.required_checks],
    checks_commit: evaluation.target_commit,
    checks_digest: evaluation.checks_digest,
    evidence_digest: evaluationDigest,
  };
  const releaseIntentRequest = {
    work_id: workId,
    intent_anchor_digest: coreAuthority.intent_anchor_digest,
    repository: coreAuthority.repository,
    ...normalizedRelease,
    verification,
  };
  const coreJoinRequest = {
    work_id: workId,
    intent_anchor_digest: coreAuthority.intent_anchor_digest,
    repository: coreAuthority.repository,
    core_plan_id: coreAuthority.plan_id,
    core_plan_digest: coreAuthority.plan_digest,
    local_plan_id: plan.plan_id,
    local_plan_digest: planDigest,
    evaluation_digest: evaluationDigest,
    acceptance_criteria: acceptanceCriteria,
    builder_report: builderReport,
    verifier_reports: verifierReports,
    checks: {
      commit: evaluation.target_commit,
      required_checks: [...evaluation.required_checks],
      checks_digest: evaluation.checks_digest,
      evidence_digest: evaluationDigest,
    },
    ...(coreAuthority.required_checks_policy_digest
      ? {
          required_checks_policy_digest:
            coreAuthority.required_checks_policy_digest,
        }
      : {}),
    provider_execution: false,
  };
  const closureAttestationUnsigned = {
    schema_version: "host_native_closure_attestation_v1",
    tenant_id: tenantId,
    work_id: workId,
    repository: coreAuthority.repository,
    core_plan_id: coreAuthority.plan_id,
    core_plan_digest: coreAuthority.plan_digest,
    local_plan_id: plan.plan_id,
    local_plan_digest: planDigest,
    evaluation_digest: evaluationDigest,
    target_commit: evaluation.target_commit,
    checks_digest: evaluation.checks_digest,
    acceptance_criteria: acceptanceCriteria,
    report_bindings: (evaluation.report_bindings || []).map((binding) => ({
      task_id: identifier(binding.task_id, "closure_attestation_task_id", 120),
      agent_id: identifier(binding.agent_id, "closure_attestation_agent_id", 120),
      task_kind: identifier(binding.task_kind, "closure_attestation_task_kind", 40),
      report_digest: releaseField(
        binding.report_digest,
        "closure_attestation_report_digest",
        /^[a-f0-9]{64}$/,
        64,
      ),
      native_session_fingerprint: releaseField(
        binding.native_session_fingerprint,
        "closure_attestation_native_session_fingerprint",
        /^[a-f0-9]{16,64}$/,
        64,
      ),
      native_presence_signature: releaseField(
        binding.native_presence_signature,
        "closure_attestation_native_presence_signature",
        /^ags_[a-f0-9]{32}$/,
        36,
      ),
    })).sort((left, right) => left.task_id.localeCompare(right.task_id)),
    provider_execution: false,
  };
  const closureSecret = String(attestationSigningSecret || "").trim();
  if (Buffer.byteLength(closureSecret, "utf8") < 32) {
    throw new Error("continuity_closure_attestation_signing_secret_unavailable");
  }
  const closureAttestation = {
    ...closureAttestationUnsigned,
    signature: `hnca_${crypto.createHmac("sha256", closureSecret)
      .update(
        `host-native-closure-attestation-v1\u0000` +
        JSON.stringify(stable(closureAttestationUnsigned)),
      )
      .digest("hex")}`,
  };
  coreJoinRequest.closure_attestation = closureAttestation;
  return {
    schema_version: "continuity_core_join_material_v1",
    tenant_id: tenantId,
    release_intent_request: releaseIntentRequest,
    core_join_request: coreJoinRequest,
    material_digest: digest({ release_intent_request: releaseIntentRequest, core_join_request: coreJoinRequest }),
  };
}

export function coreJoinIdempotencyKey(material) {
  if (
    material?.schema_version !== "continuity_core_join_material_v1" ||
    !/^[a-f0-9]{64}$/.test(String(material.material_digest || ""))
  ) {
    throw new Error("continuity_core_join_material_invalid");
  }
  return `continuity-core-join-${material.material_digest}`;
}

export function selectAtlasWithinBudget(nodes = [], options = {}) {
  const maxBytes = Math.min(Math.max(Number(options.max_bytes) || 32_000, 256), 128_000);
  const ordered = [...nodes].sort((left, right) =>
    Number(left.depth || 0) - Number(right.depth || 0) ||
    String(left.node_id).localeCompare(String(right.node_id)));
  const selected = [];
  let selectedBytes = 0;
  for (const node of ordered) {
    const compact = {
      node_id: node.node_id,
      kind: node.node_kind || node.kind,
      path: node.path || "",
      symbol: node.symbol || "",
      summary: node.summary || node.metadata?.summary || "",
      digest: node.node_digest || node.digest,
      depth: Number(node.depth || 0),
      ...(Array.isArray(node.source_work_ids) ? {
        source_work_ids: [...new Set(node.source_work_ids.map(String))].sort(),
      } : {}),
    };
    const bytes = Buffer.byteLength(JSON.stringify(compact));
    if (selected.length && selectedBytes + bytes > maxBytes) continue;
    if (!selected.length && bytes > maxBytes) {
      compact.summary = safeText(compact.summary, Math.max(64, maxBytes - 256));
    }
    const boundedBytes = Buffer.byteLength(JSON.stringify(compact));
    if (boundedBytes > maxBytes) continue;
    selected.push(compact);
    selectedBytes += boundedBytes;
  }
  const totalBytes = Number(options.total_context_bytes) ||
    ordered.reduce((sum, node) => sum + Number(node.context_bytes || Buffer.byteLength(JSON.stringify(node))), 0);
  return {
    schema_version: "work_atlas_context_v1",
    nodes: selected,
    metrics: {
      candidate_nodes: ordered.length,
      selected_nodes: selected.length,
      selected_context_bytes: selectedBytes,
      total_context_bytes: totalBytes,
      avoided_context_bytes: Math.max(totalBytes - selectedBytes, 0),
      max_context_bytes: maxBytes,
      full_scan_performed: false,
    },
  };
}

export function selectAggregatedAtlasWithinBudget(nodes = [], edges = [], options = {}) {
  const selected = selectAtlasWithinBudget(nodes, options);
  const selectedNodeIds = new Set(selected.nodes.map((node) => node.node_id));
  const deduplicatedEdges = new Map();
  for (const edge of edges) {
    if (!selectedNodeIds.has(edge.from_node_id) || !selectedNodeIds.has(edge.to_node_id)) continue;
    const edgeType = String(edge.edge_type || "depends_on");
    const edgeKey = `${edge.from_node_id}\u0000${edge.to_node_id}\u0000${edgeType}`;
    const current = deduplicatedEdges.get(edgeKey);
    const sourceWorkIds = [
      ...(current?.source_work_ids || []),
      ...(Array.isArray(edge.source_work_ids) ? edge.source_work_ids : []),
      ...(edge.work_id ? [edge.work_id] : []),
    ].map(String);
    deduplicatedEdges.set(edgeKey, {
      from_node_id: edge.from_node_id,
      to_node_id: edge.to_node_id,
      edge_type: edgeType,
      source_work_ids: [...new Set(sourceWorkIds)].sort(),
    });
  }
  const orderedEdges = [...deduplicatedEdges.values()].sort((left, right) =>
    left.from_node_id.localeCompare(right.from_node_id) ||
    left.to_node_id.localeCompare(right.to_node_id) ||
    left.edge_type.localeCompare(right.edge_type));
  const selectedEdges = [];
  let edgeBytes = 0;
  const remainingBytes = Math.max(
    selected.metrics.max_context_bytes - selected.metrics.selected_context_bytes,
    0,
  );
  for (const edge of orderedEdges) {
    const bytes = Buffer.byteLength(JSON.stringify(edge));
    if (edgeBytes + bytes > remainingBytes) continue;
    selectedEdges.push(edge);
    edgeBytes += bytes;
  }
  const candidateEdgeBytes = orderedEdges.reduce(
    (sum, edge) => sum + Buffer.byteLength(JSON.stringify(edge)),
    0,
  );
  const totalContextBytes = selected.metrics.total_context_bytes + candidateEdgeBytes;
  const selectedContextBytes = selected.metrics.selected_context_bytes + edgeBytes;
  return {
    ...selected,
    edges: selectedEdges,
    metrics: {
      ...selected.metrics,
      candidate_edges: orderedEdges.length,
      selected_edges: selectedEdges.length,
      selected_edge_context_bytes: edgeBytes,
      total_edge_context_bytes: candidateEdgeBytes,
      selected_context_bytes: selectedContextBytes,
      total_context_bytes: totalContextBytes,
      avoided_context_bytes: Math.max(totalContextBytes - selectedContextBytes, 0),
    },
  };
}

export function incidentFingerprint(input = {}) {
  const scope = {
    error_code: identifier(input.error_code, "incident_error_code", 120).toUpperCase(),
    repository: safeText(input.repository, 240).toLowerCase(),
    branch: safeText(input.branch, 240),
    connector: safeText(input.connector, 120).toLowerCase(),
    deployment_path: safeText(input.deployment_path, 120).toLowerCase(),
    configuration_digest: String(input.configuration_digest || "").toLowerCase(),
  };
  if (!scope.repository || !scope.branch || !scope.connector || !scope.deployment_path ||
      !/^[a-f0-9]{64}$/.test(scope.configuration_digest)) {
    throw new Error("incident_scope_invalid");
  }
  return { fingerprint: digest(scope), scope };
}

export function buildImpactMap(architecture = {}, change = {}) {
  const functions = Array.isArray(architecture.functions) ? architecture.functions : [];
  const components = Array.isArray(architecture.components) ? architecture.components : [];
  const dependencies = Array.isArray(architecture.dependencies) ? architecture.dependencies : [];
  const links = Array.isArray(architecture.links) ? architecture.links : [];
  const functionId = String(change.function_id || "");
  const affectedDependencies = dependencies.filter((item) =>
    JSON.stringify(item).includes(functionId) || (change.dependencies || []).includes(item?.id));
  const affectedLinks = links.filter((item) =>
    JSON.stringify(item).includes(functionId) || (change.links || []).includes(item?.id));
  return {
    schema_version: "work_impact_map_v1",
    change: cleanJson(change, 40_000),
    affected_functions: functions.filter((item) => JSON.stringify(item).includes(functionId)),
    affected_components: components.filter((item) =>
      JSON.stringify(item).includes(functionId) || (change.components || []).includes(item?.id)),
    affected_dependencies: affectedDependencies,
    affected_links: affectedLinks,
    regression_targets: [...new Set([
      ...(change.regression_targets || []),
      ...affectedDependencies.map((item) => item?.id).filter(Boolean),
      ...affectedLinks.map((item) => item?.id).filter(Boolean),
    ])],
    depth_delta: Number(change.depth_delta || 0),
    reason: safeText(change.reason, 2_000),
  };
}

export const WORK_CONTINUITY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS core_continuity_works (
  tenant_id varchar(64) NOT NULL, project_id varchar(64) NOT NULL, work_id uuid NOT NULL,
  session_id varchar(64) NOT NULL, parent_work_id uuid, idea text NOT NULL, objective text NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'active', current_version bigint NOT NULL DEFAULT 1,
  repository_hash char(64), policy_hash char(64), live_state_hash char(64),
  next_action text NOT NULL DEFAULT '', created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_works_project_idx
  ON core_continuity_works (tenant_id, project_id, updated_at DESC);

-- Nyra's operational context is server-owned and deliberately compact. It is
-- a projection of the authoritative Work ledger, not a second conversational
-- memory. A fresh chat can therefore resume the same Work without asking a
-- connected AI to rediscover Gallery, plan, policy and checkpoints.
CREATE TABLE IF NOT EXISTS core_continuity_control_contexts (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  project_id varchar(64) NOT NULL,
  work_revision bigint NOT NULL,
  context_digest char(64) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_control_contexts_project_idx
  ON core_continuity_control_contexts (tenant_id, project_id, work_revision DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS core_continuity_architecture_versions (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, version bigint NOT NULL,
  architecture jsonb NOT NULL, impact_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  architecture_digest char(64) NOT NULL, reason text NOT NULL, created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, version),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS core_continuity_events (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, event_id uuid NOT NULL,
  sequence_number bigint NOT NULL, event_type varchar(80) NOT NULL, payload jsonb NOT NULL,
  previous_event_hash char(64), event_hash char(64) NOT NULL, created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id), UNIQUE (tenant_id, work_id, sequence_number),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE OR REPLACE FUNCTION core_continuity_events_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_continuity_events_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_events_no_mutation ON core_continuity_events;
CREATE TRIGGER core_continuity_events_no_mutation BEFORE UPDATE OR DELETE ON core_continuity_events
FOR EACH ROW EXECUTE FUNCTION core_continuity_events_append_only();

CREATE TABLE IF NOT EXISTS core_continuity_capsules (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, capsule_id uuid NOT NULL,
  architecture_version bigint NOT NULL, capsule jsonb NOT NULL, capsule_digest char(64) NOT NULL,
  supervisor_approved boolean NOT NULL DEFAULT false, verified_memory boolean NOT NULL DEFAULT false,
  created_by varchar(120) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, capsule_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_capsules_work_idx
  ON core_continuity_capsules (tenant_id, work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core_continuity_idempotency (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, idempotency_key varchar(160) NOT NULL,
  operation varchar(120) NOT NULL, request_digest char(64) NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS core_continuity_branches (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, branch_id uuid NOT NULL,
  parent_branch_id uuid, branch_key varchar(64) NOT NULL, title varchar(240) NOT NULL,
  objective text NOT NULL DEFAULT '', status varchar(40) NOT NULL DEFAULT 'active',
  created_by varchar(120) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, branch_id),
  UNIQUE (tenant_id, work_id, branch_key),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS core_continuity_participants (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, session_id varchar(64) NOT NULL,
  actor_subject varchar(200) NOT NULL, agent_id varchar(64) NOT NULL,
  client_type varchar(40) NOT NULL DEFAULT 'other', branch_id uuid,
  status varchar(40) NOT NULL DEFAULT 'active', joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, work_id, session_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id, branch_id)
    REFERENCES core_continuity_branches(tenant_id, work_id, branch_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_participants_active_idx
  ON core_continuity_participants (tenant_id, work_id, expires_at DESC);
-- Existing rows intentionally remain unusable for participant operations until
-- a signed join refreshes the server-derived transport binding.
ALTER TABLE core_continuity_participants
  ADD COLUMN IF NOT EXISTS transport_session_fingerprint varchar(64);

CREATE TABLE IF NOT EXISTS core_continuity_leases (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, lease_id uuid NOT NULL,
  session_id varchar(64) NOT NULL, branch_id uuid, purpose text NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'active', acquired_at timestamptz NOT NULL DEFAULT now(),
  renewed_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  released_at timestamptz, created_by varchar(120) NOT NULL,
  policy_authority_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_authority_source varchar(80) NOT NULL DEFAULT 'legacy_work_lease_v1',
  policy_authority_binding_digest char(64),
  policy_session_fingerprint varchar(64),
  PRIMARY KEY (tenant_id, work_id, lease_id),
  FOREIGN KEY (tenant_id, work_id, session_id)
    REFERENCES core_continuity_participants(tenant_id, work_id, session_id),
  FOREIGN KEY (tenant_id, work_id, branch_id)
    REFERENCES core_continuity_branches(tenant_id, work_id, branch_id)
);
ALTER TABLE core_continuity_leases
  ADD COLUMN IF NOT EXISTS policy_authority_scope jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE core_continuity_leases
  ADD COLUMN IF NOT EXISTS policy_authority_source varchar(80) NOT NULL DEFAULT 'legacy_work_lease_v1';
ALTER TABLE core_continuity_leases
  ADD COLUMN IF NOT EXISTS policy_authority_binding_digest char(64);
ALTER TABLE core_continuity_leases
  ADD COLUMN IF NOT EXISTS policy_session_fingerprint varchar(64);
CREATE INDEX IF NOT EXISTS core_continuity_leases_active_idx
  ON core_continuity_leases (tenant_id, work_id, expires_at DESC) WHERE status='active';

CREATE TABLE IF NOT EXISTS core_continuity_lease_surfaces (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, lease_id uuid NOT NULL,
  surface_kind varchar(40) NOT NULL, surface_value varchar(500) NOT NULL,
  PRIMARY KEY (tenant_id, work_id, lease_id, surface_kind, surface_value),
  FOREIGN KEY (tenant_id, work_id, lease_id)
    REFERENCES core_continuity_leases(tenant_id, work_id, lease_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_lease_surfaces_lookup_idx
  ON core_continuity_lease_surfaces (tenant_id, work_id, surface_kind, surface_value);

CREATE TABLE IF NOT EXISTS core_continuity_messages (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, message_id uuid NOT NULL,
  branch_id uuid, from_session_id varchar(64) NOT NULL, to_session_id varchar(64),
  to_actor_subject varchar(200),
  message_type varchar(40) NOT NULL DEFAULT 'update', subject varchar(240) NOT NULL,
  payload jsonb NOT NULL, created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, message_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id, branch_id)
    REFERENCES core_continuity_branches(tenant_id, work_id, branch_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_messages_inbox_idx
  ON core_continuity_messages (tenant_id, work_id, to_session_id, created_at DESC);
-- A session id can be reused after its presence TTL expires. Direct messages
-- therefore bind to the authenticated recipient subject as well as the
-- session id. Existing rows have no such proof and are deliberately hidden
-- from direct inbox reads rather than being exposed to a replacement session.
ALTER TABLE core_continuity_messages
  ADD COLUMN IF NOT EXISTS to_actor_subject varchar(200);
CREATE TABLE IF NOT EXISTS core_continuity_intent_anchors (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, project_id varchar(64) NOT NULL,
  session_id varchar(64) NOT NULL, anchor jsonb NOT NULL, intent_digest char(64) NOT NULL,
  create_request_digest char(64) NOT NULL, created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_intent_session_idx
  ON core_continuity_intent_anchors (tenant_id, project_id, session_id);
CREATE OR REPLACE FUNCTION core_continuity_intent_anchors_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_continuity_intent_anchor_immutable'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_intent_anchors_no_mutation ON core_continuity_intent_anchors;
CREATE TRIGGER core_continuity_intent_anchors_no_mutation
BEFORE UPDATE OR DELETE ON core_continuity_intent_anchors
FOR EACH ROW EXECUTE FUNCTION core_continuity_intent_anchors_immutable();

CREATE TABLE IF NOT EXISTS core_continuity_session_bindings (
  tenant_id varchar(64) NOT NULL, project_id varchar(64) NOT NULL, session_id varchar(64) NOT NULL,
  work_id uuid NOT NULL, create_request_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, session_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS core_continuity_native_plans (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  plan jsonb NOT NULL, plan_digest char(64) NOT NULL, status varchar(32) NOT NULL DEFAULT 'planned',
  change_id uuid, base_state_digest char(64), contract_schema varchar(80) NOT NULL DEFAULT 'native_agent_plan_v1',
  plan_version bigint NOT NULL DEFAULT 1, supersedes_plan_id uuid,
  created_by varchar(120) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  PRIMARY KEY (tenant_id, plan_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
ALTER TABLE core_continuity_native_plans ADD COLUMN IF NOT EXISTS change_id uuid;
ALTER TABLE core_continuity_native_plans ADD COLUMN IF NOT EXISTS base_state_digest char(64);
ALTER TABLE core_continuity_native_plans ADD COLUMN IF NOT EXISTS contract_schema varchar(80) NOT NULL DEFAULT 'native_agent_plan_v1';
ALTER TABLE core_continuity_native_plans ADD COLUMN IF NOT EXISTS plan_version bigint NOT NULL DEFAULT 1;
ALTER TABLE core_continuity_native_plans ADD COLUMN IF NOT EXISTS supersedes_plan_id uuid;
CREATE INDEX IF NOT EXISTS core_continuity_native_plans_work_idx
  ON core_continuity_native_plans (tenant_id, work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core_continuity_native_agents (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  task_id varchar(120) NOT NULL, agent_id varchar(120) NOT NULL, host_type varchar(40) NOT NULL,
  host_task_id varchar(240) NOT NULL, task_kind varchar(40) NOT NULL, task_digest char(64) NOT NULL,
  coordinator_session_fingerprint varchar(64) NOT NULL,
  assignment_capability_digest char(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'bound', report jsonb, report_digest char(64),
  native_session_fingerprint varchar(64), native_presence_signature varchar(80),
  bound_by varchar(120) NOT NULL, bound_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz, reported_at timestamptz,
  PRIMARY KEY (tenant_id, plan_id, task_id),
  UNIQUE (tenant_id, plan_id, agent_id),
  UNIQUE (tenant_id, plan_id, host_task_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES core_continuity_native_plans(tenant_id, plan_id)
);
ALTER TABLE core_continuity_native_agents
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE core_continuity_native_agents
  ADD COLUMN IF NOT EXISTS assignment_capability_digest char(64);
ALTER TABLE core_continuity_native_agents
  ADD COLUMN IF NOT EXISTS native_session_fingerprint varchar(64);
ALTER TABLE core_continuity_native_agents
  ADD COLUMN IF NOT EXISTS native_presence_signature varchar(80);
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_native_agents_session_once_idx
  ON core_continuity_native_agents (tenant_id,plan_id,native_session_fingerprint)
  WHERE native_session_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS core_continuity_native_receipts (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  receipt_id uuid NOT NULL, receipt_type varchar(40) NOT NULL, agent_id varchar(120),
  payload jsonb NOT NULL, payload_digest char(64) NOT NULL, created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, receipt_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES core_continuity_native_plans(tenant_id, plan_id)
);
CREATE OR REPLACE FUNCTION core_continuity_native_receipts_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_continuity_native_receipts_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_native_receipts_no_mutation ON core_continuity_native_receipts;
CREATE TRIGGER core_continuity_native_receipts_no_mutation
BEFORE UPDATE OR DELETE ON core_continuity_native_receipts
FOR EACH ROW EXECUTE FUNCTION core_continuity_native_receipts_append_only();

CREATE TABLE IF NOT EXISTS core_continuity_closure_evaluations (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  evaluation_id uuid NOT NULL, evaluation jsonb NOT NULL, evaluation_digest char(64) NOT NULL,
  evaluated_by varchar(120) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, evaluation_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES core_continuity_native_plans(tenant_id, plan_id)
);

CREATE TABLE IF NOT EXISTS core_continuity_release_joins (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  evaluation_id uuid NOT NULL, verdict_id varchar(160) NOT NULL,
  release_intent jsonb NOT NULL, release_intent_digest char(64) NOT NULL,
  core_join_record jsonb NOT NULL, core_join_record_digest char(64) NOT NULL,
  created_by varchar(120) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, verdict_id),
  UNIQUE (tenant_id, evaluation_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES core_continuity_native_plans(tenant_id, plan_id)
);
CREATE OR REPLACE FUNCTION core_continuity_release_joins_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_continuity_release_joins_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_release_joins_no_mutation ON core_continuity_release_joins;
CREATE TRIGGER core_continuity_release_joins_no_mutation
BEFORE UPDATE OR DELETE ON core_continuity_release_joins
FOR EACH ROW EXECUTE FUNCTION core_continuity_release_joins_append_only();

CREATE TABLE IF NOT EXISTS core_continuity_atlas_state (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, project_id varchar(64) NOT NULL,
  revision bigint NOT NULL DEFAULT 0, total_nodes bigint NOT NULL DEFAULT 0,
  total_context_bytes bigint NOT NULL DEFAULT 0, source_hash char(64),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_atlas_project_idx
  ON core_continuity_atlas_state (tenant_id, project_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS core_continuity_atlas_nodes (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, project_id varchar(64), node_id varchar(160) NOT NULL,
  node_kind varchar(60) NOT NULL, path text NOT NULL DEFAULT '', symbol text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '', node_digest char(64) NOT NULL, context_bytes integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, revision bigint NOT NULL, active boolean NOT NULL DEFAULT true,
  source_kind varchar(80), source_ref text, source_digest char(64), provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_state varchar(32) NOT NULL DEFAULT 'observed', confidence double precision NOT NULL DEFAULT 0.5,
  tombstoned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, node_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_atlas_nodes_path_idx
  ON core_continuity_atlas_nodes (tenant_id, work_id, path);
CREATE TABLE IF NOT EXISTS core_continuity_atlas_edges (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, project_id varchar(64), from_node_id varchar(160) NOT NULL,
  to_node_id varchar(160) NOT NULL, edge_type varchar(60) NOT NULL, revision bigint NOT NULL,
  edge_id varchar(64), edge_digest char(64), source varchar(120), provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_state varchar(32) NOT NULL DEFAULT 'observed', confidence double precision NOT NULL DEFAULT 0.5,
  active boolean NOT NULL DEFAULT true, tombstoned_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, from_node_id, to_node_id, edge_type),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS core_continuity_atlas_revision_history (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, project_id varchar(64) NOT NULL,
  revision bigint NOT NULL, source_digest char(64) NOT NULL, base_commit varchar(64), head_commit varchar(64),
  node_count bigint NOT NULL, edge_count bigint NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,work_id,revision),
  FOREIGN KEY(tenant_id,work_id) REFERENCES core_continuity_atlas_state(tenant_id,work_id)
);

CREATE TABLE IF NOT EXISTS core_continuity_incident_runbooks (
  tenant_id varchar(64) NOT NULL, project_id varchar(64) NOT NULL, fingerprint char(64) NOT NULL,
  scope jsonb NOT NULL, runbook jsonb NOT NULL, runbook_digest char(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'candidate', created_by varchar(120) NOT NULL,
  verified_by varchar(120), verification_evidence jsonb,
  verification_count integer NOT NULL DEFAULT 0, failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS core_continuity_remediations (
  tenant_id varchar(64) NOT NULL,
  remediation_id varchar(80) NOT NULL,
  work_id varchar(160) NOT NULL,
  project_id varchar(64),
  original_decision_id varchar(160) NOT NULL,
  status varchar(40) NOT NULL,
  block_class varchar(40) NOT NULL,
  scope_digest char(64) NOT NULL,
  contract_digest char(64) NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, remediation_id),
  UNIQUE (tenant_id, original_decision_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_remediations_work_status_idx
  ON core_continuity_remediations (tenant_id, work_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS core_continuity_remediations_expiry_idx
  ON core_continuity_remediations (tenant_id, expires_at);

CREATE TABLE IF NOT EXISTS core_continuity_remediation_versions (
  tenant_id varchar(64) NOT NULL,
  remediation_id varchar(80) NOT NULL,
  version bigint NOT NULL,
  contract_digest char(64) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, remediation_id, version),
  FOREIGN KEY (tenant_id, remediation_id)
    REFERENCES core_continuity_remediations(tenant_id, remediation_id)
);
CREATE OR REPLACE FUNCTION core_continuity_remediation_versions_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_continuity_remediation_versions_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_remediation_versions_no_mutation ON core_continuity_remediation_versions;
CREATE TRIGGER core_continuity_remediation_versions_no_mutation
BEFORE UPDATE OR DELETE ON core_continuity_remediation_versions
FOR EACH ROW EXECUTE FUNCTION core_continuity_remediation_versions_append_only();

CREATE TABLE IF NOT EXISTS core_continuity_remediation_idempotency (
  tenant_id varchar(64) NOT NULL,
  remediation_id varchar(80) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  proposal_digest char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, remediation_id, idempotency_key),
  FOREIGN KEY (tenant_id, remediation_id)
    REFERENCES core_continuity_remediations(tenant_id, remediation_id)
);
`;

export function createWorkContinuityRuntime(config, options = {}) {
  if (!config.databaseUrl && !options.pool) return null;
  const pool = options.pool || new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: config.databasePoolMax || 5,
  });
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const nowDate = () => dateValue(now(), "clock");
  const assignmentSigningSecret = String(
    config.dttAgentIdentitySigningSecret || "",
  ).trim();
  let workEventProjector = null;
  let ready;
  const initialize = () => ready ||= pool.query(WORK_CONTINUITY_SCHEMA_SQL);

  function actorFor(identity, input = {}) {
    return safeText(
      identity.agentPresence?.agent_id || input.agent_id || identity.subject || "connected_ai",
      120,
    );
  }

  function workContext(identity, input = {}) {
    return {
      tenantId: tenant(identity.tenantId),
      workId: uuid(input.work_id, "work_id"),
      actor: actorFor(identity, input),
      actorSubject: safeText(identity.subject || identity.kind || "unknown", 200),
    };
  }

  function assignmentCapability(binding) {
    if (assignmentSigningSecret.length < 32) {
      throw new Error("native_agent_assignment_signing_unavailable");
    }
    const signature = crypto.createHmac("sha256", assignmentSigningSecret)
      .update(`host-native-assignment-capability-v1\u0000${JSON.stringify(stable(binding))}`)
      .digest("base64url");
    return `hnac_${signature}`;
  }

  function assignmentCapabilityDigest(value) {
    const capability = String(value || "").trim();
    if (!NATIVE_ASSIGNMENT_CAPABILITY_PATTERN.test(capability)) {
      throw new Error("native_agent_assignment_capability_invalid");
    }
    return crypto.createHash("sha256").update(capability).digest("hex");
  }

  function nativeReporterPresence(identity, agentId) {
    const presence = identity?.agentPresence;
    const fingerprint = String(
      presence?.host_transport_session_fingerprint || "",
    );
    const signature = String(presence?.signature || "");
    if (
      presence?.transport_bound !== true ||
      presence?.agent_id !== agentId ||
      !/^[a-f0-9]{16,64}$/i.test(fingerprint) ||
      !/^ags_[a-f0-9]{32}$/.test(signature)
    ) {
      throw new Error("native_agent_reporter_presence_required");
    }
    return {
      agent_id: agentId,
      client_type: String(presence.client_type || ""),
      session_fingerprint: fingerprint,
      signature,
    };
  }

  function nativeCoordinatorFingerprint(identity) {
    const presence = identity?.agentPresence;
    const transportFingerprint = String(
      presence?.host_transport_session_fingerprint || "",
    );
    if (
      presence?.transport_bound === true &&
      /^[a-f0-9]{16,64}$/i.test(transportFingerprint)
    ) {
      return transportFingerprint;
    }
    const developmentFingerprint = String(presence?.session_fingerprint || "");
    if (
      process.env.NODE_ENV !== "production" &&
      /^[a-f0-9]{16,64}$/i.test(developmentFingerprint)
    ) {
      return developmentFingerprint;
    }
    throw new Error("native_agent_coordinator_presence_required");
  }

  async function lockWork(client, context) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [context.tenantId, context.workId]);
  }

  async function lockWorkRow(client, context) {
    const work = await client.query(`SELECT work_id FROM core_continuity_works
      WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [context.tenantId, context.workId]);
    if (!work.rows[0]) throw new Error("continuity_work_not_found");
    return work.rows[0];
  }

  async function lockGalleryWork(client, context) {
    await lockWorkRow(client, context);
    // Work-row first is the shared order used by checkpoint/change writers.
    // Taking the Gallery advisory lock only afterwards prevents a writer from
    // holding one side of a row/advisory deadlock while waiting for the other.
    await lockWork(client, context);
  }

  async function appendEvent(client, context, eventType, payload = {}) {
    if (!WORK_EVENT_TYPES.has(eventType)) throw new Error("continuity_event_type_invalid");
    await lockWork(client, context);
    const previous = await client.query(`SELECT sequence_number,event_hash FROM core_continuity_events
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
    [context.tenantId, context.workId]);
    const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
    const cleanPayload = cleanJson(payload);
    const event = {
      tenant_id: context.tenantId, work_id: context.workId, sequence_number: sequence,
      event_type: eventType, payload: cleanPayload, previous_event_hash: previous.rows[0]?.event_hash || null,
    };
    const eventHash = digest(event);
    const eventId = crypto.randomUUID();
    await client.query(`INSERT INTO core_continuity_events
      (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [context.tenantId, context.workId, eventId, sequence, eventType, JSON.stringify(cleanPayload),
      event.previous_event_hash, eventHash, context.actor]);
    const persistedEvent = { event_id: eventId, sequence_number: sequence, event_type: eventType,
      event_hash: eventHash, payload: cleanPayload };
    if (workEventProjector) {
      await workEventProjector({ client, tenant_id: context.tenantId, work_id: context.workId,
        actor: context.actor, event: persistedEvent });
    }
    return persistedEvent;
  }

  function setWorkEventProjector(projector) {
    if (typeof projector !== "function") throw new Error("work_event_projector_invalid");
    if (workEventProjector && workEventProjector !== projector) {
      throw new Error("work_event_projector_already_configured");
    }
    workEventProjector = projector;
    return true;
  }

  async function transaction(fn) {
    await initialize();
    const client = typeof pool.connect === "function" ? await pool.connect() : pool;
    try {
      if (client.query !== pool.query) await client.query("BEGIN");
      const result = await fn(client);
      if (client.query !== pool.query) await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client.query !== pool.query) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release?.(); }
  }

  async function withIdempotency(client, context, key, operation, request, perform) {
    const idempotencyKey = safeText(key, 160);
    if (!idempotencyKey) throw new Error("idempotency_key_required");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [context.tenantId, `${context.workId}:${idempotencyKey}`]);
    const existing = await client.query(`SELECT operation,request_digest,result FROM core_continuity_idempotency
      WHERE tenant_id=$1 AND work_id=$2 AND idempotency_key=$3`,
    [context.tenantId, context.workId, idempotencyKey]);
    const actorBinding = String(context.actorSubject || context.actor || "");
    const requestDigest = digest({
      operation,
      actor_binding: actorBinding,
      ...(context.transportSessionFingerprint
        ? { transport_session_fingerprint: context.transportSessionFingerprint }
        : {}),
      request,
    });
    if (existing.rows[0]) {
      if (existing.rows[0].operation !== operation ||
          existing.rows[0].request_digest !== requestDigest) {
        throw new Error("idempotency_key_conflict");
      }
      return { ...existing.rows[0].result, idempotent_replay: true };
    }
    const result = await perform();
    await client.query(`INSERT INTO core_continuity_idempotency
      (tenant_id,work_id,idempotency_key,operation,request_digest,result)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [context.tenantId, context.workId, idempotencyKey, operation, requestDigest, JSON.stringify(result)]);
    return result;
  }

  async function ensureWithClient(client, identity, input, options = {}) {
    const tenantId = tenant(identity.tenantId);
    const workId = input.work_id ? uuid(input.work_id, "work_id") : crypto.randomUUID();
    const context = { tenantId, workId, actor: actorFor(identity, input) };
    const projectId = identifier(input.project_id, "project_id", 64);
      const sessionId = identifier(input.session_id, "session_id", 64);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        tenantId,
        `${projectId}:${sessionId}`,
      ]);
      const binding = await client.query(`SELECT work_id,create_request_digest
        FROM core_continuity_session_bindings
        WHERE tenant_id=$1 AND project_id=$2 AND session_id=$3`,
      [tenantId, projectId, sessionId]);
      let autoResumeCandidate = null;
      let autoResumeCandidates = [];
      if (input.resume_existing === true && !binding.rows[0] && !input.work_id) {
        // Do not make the model discover or choose a Work in a new chat.  The
        // database makes the choice under the same transaction lock used for
        // the session binding.  More than one operational Work fails closed
        // into the existing explicit-selection path.
        const candidates = await client.query(`SELECT work_id FROM core_continuity_works
          WHERE tenant_id=$1 AND project_id=$2 AND status = ANY($3::varchar[])
          ORDER BY updated_at DESC,work_id DESC
          LIMIT 2
          FOR UPDATE`, [tenantId, projectId, AUTO_RESUMABLE_WORK_STATUSES]);
        autoResumeCandidates = candidates.rows;
        if (autoResumeCandidates.length === 1) autoResumeCandidate = autoResumeCandidates[0];
      }
      if (input.resume_existing === true && (binding.rows[0] || input.work_id || autoResumeCandidate)) {
        if (binding.rows[0] && input.work_id && binding.rows[0].work_id !== workId) {
          throw new Error("continuity_session_binding_conflict");
        }
        const resumeWorkId = binding.rows[0]?.work_id || input.work_id || autoResumeCandidate.work_id;
        const existing = await client.query(`SELECT a.intent_digest,a.create_request_digest,
            w.project_id,w.status,w.current_version,w.next_action
          FROM core_continuity_intent_anchors a JOIN core_continuity_works w
            ON w.tenant_id=a.tenant_id AND w.work_id=a.work_id
          WHERE a.tenant_id=$1 AND a.work_id=$2
          FOR UPDATE OF w`,
        [tenantId, resumeWorkId]);
        if (!existing.rows[0]) throw new Error("continuity_work_not_found");
        if (existing.rows[0].project_id !== projectId) {
          throw new Error("continuity_project_mismatch");
        }
        if (binding.rows[0] &&
            binding.rows[0].create_request_digest !== existing.rows[0].create_request_digest) {
          throw new Error("continuity_session_binding_conflict");
        }
        if (options.trustedSessionFollowup !== true) {
          const candidate = buildIntentAnchor({
            ...input,
            project_id: projectId,
            session_id: sessionId,
            client_type: input.client_type || identity.kind,
          });
          if (candidate.intent_digest !== existing.rows[0]?.intent_digest) {
            throw new Error("continuity_resume_intent_mismatch");
          }
        }
        let sessionBindingCreated = false;
        if (!binding.rows[0]) {
          const inserted = await client.query(`INSERT INTO core_continuity_session_bindings
            (tenant_id,project_id,session_id,work_id,create_request_digest)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (tenant_id,project_id,session_id) DO NOTHING
            RETURNING work_id,create_request_digest`,
          [tenantId, projectId, sessionId, resumeWorkId, existing.rows[0].create_request_digest]);
          if (!inserted.rows[0]) {
            const concurrentBinding = await client.query(`SELECT work_id,create_request_digest
              FROM core_continuity_session_bindings
              WHERE tenant_id=$1 AND project_id=$2 AND session_id=$3 AND work_id=$4`,
            [tenantId, projectId, sessionId, resumeWorkId]);
            if (!concurrentBinding.rows[0] ||
                concurrentBinding.rows[0].create_request_digest !==
                  existing.rows[0].create_request_digest) {
              throw new Error("continuity_session_binding_conflict");
            }
          }
          sessionBindingCreated = Boolean(inserted.rows[0]);
        }
        return {
          schema_version: WORK_CONTINUITY_SCHEMA_VERSION,
          fabric_schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: tenantId,
          project_id: projectId,
          work_id: resumeWorkId,
          intent_digest: existing.rows[0]?.intent_digest || null,
          status: existing.rows[0]?.status || null,
          architecture_version: Number(existing.rows[0]?.current_version || 0),
          next_action: existing.rows[0]?.next_action || "",
          resumed_existing: true,
          resume_source: binding.rows[0]
            ? "session_binding"
            : input.work_id ? "explicit_work_id" : "unambiguous_project_work",
          automatic_resume: Boolean(autoResumeCandidate),
          session_binding_created: sessionBindingCreated,
          idempotent_replay: !sessionBindingCreated,
        };
      }
      if (input.resume_existing === true && !binding.rows[0] && !input.work_id && autoResumeCandidates.length > 1) {
        const error = new Error("continuity_resume_selection_required");
        error.code = "continuity_resume_selection_required";
        error.candidate_work_ids = autoResumeCandidates.map((candidate) => String(candidate.work_id));
        throw error;
      }
      const architecture = cleanJson(input.architecture || {});
      const intent = buildIntentAnchor({
        ...input,
        project_id: projectId,
        session_id: sessionId,
        client_type: input.client_type || identity.kind,
      });
      const createRequestDigest = digest({
        base: intent.create_request_digest,
        architecture,
        next_action: safeText(input.next_action, 4_000),
        repository_hash: input.repository_hash || null,
        policy_hash: input.policy_hash || null,
        live_state_hash: input.live_state_hash || null,
        requested_work_id: input.work_id || null,
      });
      if (binding.rows[0]) {
        if (binding.rows[0].create_request_digest !== createRequestDigest ||
            (input.work_id && binding.rows[0].work_id !== workId)) {
          throw new Error("continuity_session_intent_conflict");
        }
        const anchored = await client.query(`SELECT intent_digest FROM core_continuity_intent_anchors
          WHERE tenant_id=$1 AND work_id=$2`, [tenantId, binding.rows[0].work_id]);
        return {
          schema_version: WORK_CONTINUITY_SCHEMA_VERSION,
          fabric_schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: tenantId,
          project_id: projectId,
          work_id: binding.rows[0].work_id,
          intent_digest: anchored.rows[0]?.intent_digest || null,
          idempotent_replay: true,
        };
      }
      if (options.creationAuthorized !== true) {
        const error = new Error("continuity_creation_owner_confirmation_required");
        error.code = "continuity_creation_owner_confirmation_required";
        throw error;
      }
      const architectureDigest = digest(architecture);
      await client.query(`INSERT INTO core_continuity_works
        (tenant_id,project_id,work_id,session_id,parent_work_id,idea,objective,status,current_version,
         repository_hash,policy_hash,live_state_hash,next_action,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'active',1,$8,$9,$10,$11,$12)`,
      [tenantId, projectId, workId, sessionId,
        input.parent_work_id ? uuid(input.parent_work_id, "parent_work_id") : null,
        safeText(input.idea, 8_000), safeText(input.objective, 8_000), input.repository_hash || null,
        input.policy_hash || null, input.live_state_hash || null, safeText(input.next_action, 4_000), context.actor]);
      await client.query(`INSERT INTO core_continuity_architecture_versions
        (tenant_id,work_id,version,architecture,impact_map,architecture_digest,reason,created_by)
        VALUES ($1,$2,1,$3::jsonb,'{}'::jsonb,$4,$5,$6)`,
      [tenantId, workId, JSON.stringify(architecture), architectureDigest, "initial_architecture", context.actor]);
      await client.query(`INSERT INTO core_continuity_intent_anchors
        (tenant_id,work_id,project_id,session_id,anchor,intent_digest,create_request_digest,created_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [tenantId, workId, projectId, sessionId, JSON.stringify(intent.anchor), intent.intent_digest,
        createRequestDigest, context.actor]);
      await client.query(`INSERT INTO core_continuity_session_bindings
        (tenant_id,project_id,session_id,work_id,create_request_digest)
        VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, projectId, sessionId, workId, createRequestDigest]);
      const event = await appendEvent(client, context, "work_created", {
        project_id: projectId, session_id: sessionId, parent_work_id: input.parent_work_id || null,
        architecture_digest: architectureDigest,
      });
      const intentEvent = await appendEvent(client, context, "intent_anchored", {
        intent_digest: intent.intent_digest,
        initial_message_redacted: true,
        immutable: true,
      });
    return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: tenantId, work_id: workId,
        project_id: projectId,
        fabric_schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
        architecture_version: 1, architecture_digest: architectureDigest,
        intent_digest: intent.intent_digest, event, intent_event: intentEvent };
  }

  async function upsertControlContext(identity, input = {}) {
    const context = workContext(identity, input);
    const projectId = identifier(input.project_id, "project_id", 64);
    const candidate = cleanJson(input.context || {}, 16_000);
    if (candidate.schema_version !== "nyra_control_context_v1" ||
        candidate.tenant_id !== context.tenantId ||
        candidate.work_id !== context.workId ||
        candidate.project_id !== projectId ||
        !/^[a-f0-9]{64}$/.test(String(candidate.context_digest || ""))) {
      throw new Error("nyra_control_context_invalid");
    }
    return transaction(async (client) => {
      const work = await client.query(`SELECT project_id,current_version,status,next_action
        FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`,
      [context.tenantId, context.workId]);
      const row = work.rows[0];
      if (!row) throw new Error("continuity_work_not_found");
      if (row.project_id !== projectId) throw new Error("continuity_project_mismatch");
      const unsignedPayload = cleanJson({
        ...candidate,
        context_digest: undefined,
        work_state: String(row.status || candidate.work_state || "unknown"),
        work_revision: Number(row.current_version || 0),
        next_action: safeText(row.next_action || candidate.next_action, 360),
      }, 16_000);
      const payload = {
        ...unsignedPayload,
        context_digest: digest(unsignedPayload),
      };
      await client.query(`INSERT INTO core_continuity_control_contexts
        (tenant_id,work_id,project_id,work_revision,context_digest,payload)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb)
        ON CONFLICT (tenant_id,work_id) DO UPDATE SET
          project_id=EXCLUDED.project_id,work_revision=EXCLUDED.work_revision,
          context_digest=EXCLUDED.context_digest,payload=EXCLUDED.payload,updated_at=now()`, [
        context.tenantId, context.workId, projectId, Number(row.current_version || 0),
        payload.context_digest, JSON.stringify(payload),
      ]);
      return payload;
    });
  }

  async function ensure(identity, input, options = {}) {
    return transaction((client) => ensureWithClient(client, identity, input, options));
  }

  async function create(identity, input) {
    return ensure(identity, input, { creationAuthorized: true });
  }

  async function readIntent(identity, input) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const workId = uuid(input.work_id, "work_id");
    const result = await pool.query(`SELECT project_id,session_id,anchor,intent_digest,created_by,created_at
      FROM core_continuity_intent_anchors WHERE tenant_id=$1 AND work_id=$2`, [tenantId, workId]);
    if (!result.rows[0]) throw new Error("continuity_intent_anchor_not_found");
    return {
      schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
      tenant_id: tenantId,
      work_id: workId,
      ...result.rows[0],
    };
  }

  async function resolveStandingReleaseIntentBinding(identity, input = {}) {
    await initialize();
    const tenantId = tenant(identity?.tenantId);
    const workId = uuid(input.work_id, "work_id");
    const result = await pool.query(`SELECT
        w.tenant_id,w.work_id,w.project_id,w.status AS work_status,
        w.current_version,w.updated_at AS work_updated_at,
        a.anchor,a.intent_digest,a.created_at AS intent_anchor_created_at
      FROM core_continuity_works w
      JOIN core_continuity_intent_anchors a
        ON a.tenant_id=w.tenant_id AND a.work_id=w.work_id
      WHERE w.tenant_id=$1 AND w.work_id=$2`, [tenantId, workId]);
    const row = result.rows[0];
    if (!row) throw new Error("standing_release_intent_binding_not_found");
    const anchor = row.anchor;
    const persistedDigest = String(row.intent_digest || "").trim().toLowerCase();
    if (
      String(row.tenant_id || "") !== tenantId ||
      String(row.work_id || "").trim().toLowerCase() !== workId ||
      !anchor || typeof anchor !== "object" || Array.isArray(anchor) ||
      anchor.schema_version !== "intent_anchor_v1" || anchor.immutable !== true ||
      !/^[a-f0-9]{64}$/.test(persistedDigest) || digest(anchor) !== persistedDigest
    ) {
      throw new Error("standing_release_intent_binding_corrupt");
    }
    const workStatus = String(row.work_status || "");
    if (!STANDING_RELEASE_ELIGIBLE_WORK_STATUSES.has(workStatus)) {
      throw new Error("standing_release_intent_work_status_ineligible");
    }
    const currentVersion = Number(row.current_version);
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
      throw new Error("standing_release_intent_binding_corrupt");
    }
    let workUpdatedAt;
    let intentAnchorCreatedAt;
    try {
      workUpdatedAt = dateValue(row.work_updated_at, "standing_release_work_updated_at").toISOString();
      intentAnchorCreatedAt = dateValue(
        row.intent_anchor_created_at,
        "standing_release_intent_anchor_created_at",
      ).toISOString();
    } catch {
      throw new Error("standing_release_intent_binding_corrupt");
    }
    const binding = {
      schema_version: "standing_release_intent_binding_v1",
      source: "mcp_work_continuity_postgres",
      tenant_id: tenantId,
      work_id: workId,
      project_id: identifier(row.project_id, "standing_release_project_id", 64),
      work_status: workStatus,
      current_version: currentVersion,
      work_updated_at: workUpdatedAt,
      intent_anchor_schema_version: "intent_anchor_v1",
      intent_anchor_immutable: true,
      intent_anchor_digest: persistedDigest,
      intent_anchor_created_at: intentAnchorCreatedAt,
      verified_at: nowDate().toISOString(),
      provider_execution: false,
    };
    return Object.freeze({
      ...binding,
      binding_digest: digest(binding),
    });
  }

  // Compact tenant-wide index. Deliberately excludes idea, objective, anchor,
  // reports, evidence and every other prompt-shaped field.
  async function listWorks(identity, input = {}) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const projectId = input.project_id
      ? identifier(input.project_id, "project_id", 64)
      : null;
    const status = input.status ? String(input.status) : null;
    if (status && !WORK_CATALOG_STATUSES.has(status)) throw new Error("work_catalog_status_invalid");
    const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
    const cursor = decodeCatalogCursor(input.cursor);
    const parameters = [tenantId];
    const predicates = ["w.tenant_id=$1"];
    if (projectId) {
      parameters.push(projectId);
      predicates.push(`w.project_id=$${parameters.length}`);
    }
    if (status) {
      parameters.push(status);
      predicates.push(`w.status=$${parameters.length}`);
    }
    if (cursor) {
      parameters.push(cursor.updated_at, cursor.work_id);
      predicates.push(`(w.updated_at,w.work_id) < ($${parameters.length - 1}::timestamptz,$${parameters.length}::uuid)`);
    }
    parameters.push(limit + 1);
    const result = await pool.query(`SELECT
        w.work_id,w.project_id,w.session_id,w.status,w.current_version,w.next_action,w.updated_at,
        p.plan_id AS latest_plan_id,p.status AS latest_plan_status,
        p.created_at AS latest_plan_created_at,
        i.fingerprint AS latest_incident_fingerprint,i.status AS latest_incident_status,
        i.updated_at AS latest_incident_updated_at,
        a.revision AS atlas_revision,a.source_hash AS atlas_source_hash,
        a.updated_at AS atlas_updated_at
      FROM core_continuity_works w
      LEFT JOIN LATERAL (
        SELECT plan_id,status,created_at
        FROM core_continuity_native_plans
        WHERE tenant_id=w.tenant_id AND work_id=w.work_id
        ORDER BY created_at DESC,plan_id DESC LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT fingerprint,status,updated_at
        FROM core_continuity_incident_runbooks
        WHERE tenant_id=w.tenant_id AND project_id=w.project_id
        ORDER BY updated_at DESC,fingerprint DESC LIMIT 1
      ) i ON true
      LEFT JOIN core_continuity_atlas_state a
        ON a.tenant_id=w.tenant_id AND a.work_id=w.work_id
      WHERE ${predicates.join(" AND ")}
      ORDER BY w.updated_at DESC,w.work_id DESC
      LIMIT $${parameters.length}`,
    parameters);
    const hasMore = result.rows.length > limit;
    const pageRows = result.rows.slice(0, limit);
    const works = pageRows.map((row) => ({
      work_id: row.work_id,
      project_id: row.project_id,
      session_id: row.session_id,
      status: row.status,
      current_version: Number(row.current_version || 0),
      next_action: row.next_action || "",
      updated_at: row.updated_at,
      latest_plan: row.latest_plan_id ? {
        plan_id: row.latest_plan_id,
        status: row.latest_plan_status,
        created_at: row.latest_plan_created_at,
      } : null,
      latest_incident: row.latest_incident_fingerprint ? {
        fingerprint: row.latest_incident_fingerprint,
        status: row.latest_incident_status,
        updated_at: row.latest_incident_updated_at,
      } : null,
      atlas: row.atlas_revision === null || row.atlas_revision === undefined ? null : {
        revision: Number(row.atlas_revision),
        source_hash: row.atlas_source_hash || null,
        updated_at: row.atlas_updated_at,
      },
    }));
    return {
      schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
      catalog_schema_version: "work_catalog_v1",
      tenant_id: tenantId,
      filters: { project_id: projectId, status },
      works,
      next_cursor: hasMore && pageRows.length
        ? encodeCatalogCursor(pageRows[pageRows.length - 1])
        : null,
      raw_prompt_fields_returned: false,
    };
  }

  async function recordChange(identity, input) {
    const context = workContext(identity, input);
    return transaction(async (client) => withIdempotency(client, context, input.idempotency_key, "record_change", input,
      async () => {
        const current = await client.query(`SELECT w.current_version,v.architecture FROM core_continuity_works w
          JOIN core_continuity_architecture_versions v ON v.tenant_id=w.tenant_id AND v.work_id=w.work_id AND v.version=w.current_version
          WHERE w.tenant_id=$1 AND w.work_id=$2 FOR UPDATE`, [context.tenantId, context.workId]);
        if (!current.rows[0]) throw new Error("continuity_work_not_found");
        if (Number(input.expected_version) !== Number(current.rows[0].current_version)) throw new Error("continuity_version_conflict");
        const architecture = cleanJson(input.architecture);
        const impactMap = buildImpactMap(current.rows[0].architecture, input.change);
        const version = Number(current.rows[0].current_version) + 1;
        const architectureDigest = digest(architecture);
        await client.query(`INSERT INTO core_continuity_architecture_versions
          (tenant_id,work_id,version,architecture,impact_map,architecture_digest,reason,created_by)
          VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
        [context.tenantId, context.workId, version, JSON.stringify(architecture), JSON.stringify(impactMap),
          architectureDigest, safeText(input.change?.reason, 2_000), context.actor]);
        await client.query(`UPDATE core_continuity_works SET current_version=$3,next_action=$4,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`,
        [context.tenantId, context.workId, version, safeText(input.next_action, 4_000)]);
        const eventType = input.event_type || (input.change?.function_id ? "function_changed" : "dependency_changed");
        const event = await appendEvent(client, context, eventType, { version, architecture_digest: architectureDigest, impact_map: impactMap });
        return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
          work_id: context.workId, architecture_version: version, architecture_digest: architectureDigest, impact_map: impactMap, event };
      }));
  }

  async function checkpoint(identity, input) {
    const context = workContext(identity, input);
    return transaction(async (client) => withIdempotency(client, context, input.idempotency_key, "checkpoint", input,
      async () => {
        const current = await client.query(`SELECT current_version,repository_hash,policy_hash,live_state_hash,next_action
          FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`,
        [context.tenantId, context.workId]);
        if (!current.rows[0]) throw new Error("continuity_work_not_found");
        const architecture = await client.query(`SELECT architecture,architecture_digest FROM core_continuity_architecture_versions
          WHERE tenant_id=$1 AND work_id=$2 AND version=$3`,
        [context.tenantId, context.workId, current.rows[0].current_version]);
        const capsule = cleanJson({
          schema_version: "continuity_capsule_v1",
          snapshot: architecture.rows[0]?.architecture || {},
          architecture_digest: architecture.rows[0]?.architecture_digest,
          evidence: input.evidence || [], commit_patch: input.commit_patch || {},
          tests: input.tests || [], authorizations: input.authorizations || [],
          rollback: input.rollback || {}, next_action: input.next_action || current.rows[0].next_action,
          provenance: input.provenance || {}, state_hashes: {
            repository_hash: input.repository_hash || current.rows[0].repository_hash,
            policy_hash: input.policy_hash || current.rows[0].policy_hash,
            live_state_hash: input.live_state_hash || current.rows[0].live_state_hash,
          },
        });
        const capsuleId = crypto.randomUUID();
        const capsuleDigest = digest(capsule);
        await client.query(`INSERT INTO core_continuity_capsules
          (tenant_id,work_id,capsule_id,architecture_version,capsule,capsule_digest,supervisor_approved,verified_memory,created_by)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,false,$8)`,
        [context.tenantId, context.workId, capsuleId, current.rows[0].current_version, JSON.stringify(capsule),
          capsuleDigest, input.supervisor_approved === true, context.actor]);
        await client.query(`UPDATE core_continuity_works SET repository_hash=$3,policy_hash=$4,live_state_hash=$5,
          next_action=$6,updated_at=now() WHERE tenant_id=$1 AND work_id=$2`,
        [context.tenantId, context.workId, capsule.state_hashes.repository_hash, capsule.state_hashes.policy_hash,
          capsule.state_hashes.live_state_hash, safeText(capsule.next_action, 4_000)]);
        const event = await appendEvent(client, context, input.handoff_to ? "handoff_created" : "checkpoint_created",
          { capsule_id: capsuleId, capsule_digest: capsuleDigest, supervisor_approved: input.supervisor_approved === true,
            handoff_to: input.handoff_to || null });
        return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
          work_id: context.workId, capsule_id: capsuleId, capsule_digest: capsuleDigest,
          supervisor_approved: input.supervisor_approved === true, event };
      }));
  }

  async function read(identity, input) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const workId = uuid(input.work_id, "work_id");
    const work = await pool.query(`SELECT * FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2`, [tenantId, workId]);
    if (!work.rows[0]) throw new Error("continuity_work_not_found");
    const architecture = await pool.query(`SELECT version,architecture,impact_map,architecture_digest,reason,created_at
      FROM core_continuity_architecture_versions WHERE tenant_id=$1 AND work_id=$2 ORDER BY version DESC LIMIT 1`, [tenantId, workId]);
    const capsule = await pool.query(`SELECT capsule_id,architecture_version,capsule,capsule_digest,supervisor_approved,verified_memory,created_at
      FROM core_continuity_capsules WHERE tenant_id=$1 AND work_id=$2 ORDER BY created_at DESC LIMIT 1`, [tenantId, workId]);
    const events = await pool.query(`SELECT event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_at
      FROM core_continuity_events WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT $3`,
    [tenantId, workId, Math.min(Math.max(Number(input.event_limit) || 50, 1), 200)]);
    const branches = await pool.query(`SELECT branch_id,parent_branch_id,branch_key,title,objective,status,created_at,updated_at
      FROM core_continuity_branches WHERE tenant_id=$1 AND work_id=$2 ORDER BY created_at`, [tenantId, workId]);
    const participants = await pool.query(`SELECT session_id,agent_id,client_type,branch_id,status,joined_at,last_seen_at,
        expires_at,(status='active' AND expires_at>now()) AS active
      FROM core_continuity_participants WHERE tenant_id=$1 AND work_id=$2 ORDER BY last_seen_at DESC`,
    [tenantId, workId]);
    const leases = await pool.query(`SELECT l.lease_id,l.session_id,l.branch_id,l.purpose,l.status,l.acquired_at,
        l.renewed_at,l.expires_at,l.released_at,
        coalesce(jsonb_agg(jsonb_build_object('kind',s.surface_kind,'value',s.surface_value))
          FILTER (WHERE s.surface_kind IS NOT NULL),'[]'::jsonb) AS surfaces
      FROM core_continuity_leases l
      LEFT JOIN core_continuity_lease_surfaces s
        ON s.tenant_id=l.tenant_id AND s.work_id=l.work_id AND s.lease_id=l.lease_id
      WHERE l.tenant_id=$1 AND l.work_id=$2
      GROUP BY l.lease_id,l.session_id,l.branch_id,l.purpose,l.status,l.acquired_at,
        l.renewed_at,l.expires_at,l.released_at
      ORDER BY l.acquired_at DESC`, [tenantId, workId]);
    return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: tenantId, work: work.rows[0],
      architecture: architecture.rows[0] || null, latest_capsule: capsule.rows[0] || null,
      branches: branches.rows, participants: participants.rows, leases: leases.rows,
      events: events.rows.reverse() };
  }

  async function resume(identity, input, authorization) {
    const context = workContext(identity, input);
    return transaction(async (client) => withIdempotency(client, context, input.idempotency_key, "resume", input,
      async () => {
        const result = await client.query(`SELECT w.*,c.capsule_id,c.capsule,c.capsule_digest,c.supervisor_approved
          FROM core_continuity_works w LEFT JOIN LATERAL (
            SELECT * FROM core_continuity_capsules WHERE tenant_id=w.tenant_id AND work_id=w.work_id
            ORDER BY created_at DESC LIMIT 1
          ) c ON true WHERE w.tenant_id=$1 AND w.work_id=$2 FOR UPDATE OF w`, [context.tenantId, context.workId]);
        const state = result.rows[0];
        if (!state) throw new Error("continuity_work_not_found");
        if (!state.capsule_id) throw new Error("continuity_capsule_required");
        if (digest(state.capsule) !== state.capsule_digest) throw new Error("continuity_capsule_digest_mismatch");
        const expected = state.capsule.state_hashes || {};
        const actual = input.current_state_hashes || {};
        const drift = ["repository_hash", "policy_hash", "live_state_hash"].filter((key) =>
          expected[key] && expected[key] !== actual[key]);
        if (drift.length) {
          const event = await appendEvent(client, context, "drift_detected", { fields: drift, capsule_id: state.capsule_id });
          return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
            work_id: context.workId, resumed: false, blocked_reason: "continuity_drift_detected", drift, event };
        }
        if (authorization?.allowed !== true) throw new Error("continuity_core_revalidation_denied");
        const coordinatorSessionFingerprint = String(
          identity.agentPresence?.session_fingerprint || "",
        );
        if (!/^[a-f0-9]{16,64}$/i.test(coordinatorSessionFingerprint)) {
          throw new Error("native_agent_coordinator_presence_required");
        }
        const openPlans = await client.query(`SELECT plan_id,plan,status
          FROM core_continuity_native_plans
          WHERE tenant_id=$1 AND work_id=$2 AND status IN ('planned','verified')
          ORDER BY created_at FOR UPDATE`,
        [context.tenantId, context.workId]);
        const supersededPlanIds = openPlans.rows
          .filter((row) =>
            row.plan?.coordinator_session_fingerprint !== coordinatorSessionFingerprint)
          .map((row) => row.plan_id);
        if (supersededPlanIds.length) {
          await client.query(`UPDATE core_continuity_native_plans
            SET status='superseded',closed_at=now()
            WHERE tenant_id=$1 AND work_id=$2 AND plan_id=ANY($3::uuid[])`,
          [context.tenantId, context.workId, supersededPlanIds]);
          await client.query(`UPDATE core_continuity_native_agents SET status='superseded'
            WHERE tenant_id=$1 AND work_id=$2 AND plan_id=ANY($3::uuid[]) AND status='bound'`,
          [context.tenantId, context.workId, supersededPlanIds]);
        }
        await client.query(`UPDATE core_continuity_works SET session_id=$3,status='active',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`, [context.tenantId, context.workId, safeText(input.session_id, 64)]);
        const replanEvent = supersededPlanIds.length
          ? await appendEvent(client, context, "native_plan_superseded", {
            superseded_plan_ids: supersededPlanIds,
            reason: "coordinator_session_changed",
            verified_receipts_preserved: true,
            native_replan_required: true,
          })
          : null;
        const event = await appendEvent(client, context, "work_resumed", {
          capsule_id: state.capsule_id, core_decision_id: authorization.decision_id || null,
          session_id: input.session_id,
          native_replan_required: supersededPlanIds.length > 0,
        });
        return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
          work_id: context.workId, capsule_id: state.capsule_id, next_action: state.capsule.next_action,
          architecture: state.capsule.snapshot, authorization, resumed: true,
          native_replan_required: supersededPlanIds.length > 0,
          superseded_plan_ids: supersededPlanIds,
          replan_event: replanEvent,
          event };
      }));
  }

  async function verifyMemory(identity, input) {
    const context = workContext(identity, input);
    return transaction(async (client) => withIdempotency(client, context, input.idempotency_key, "verify_memory", input,
      async () => {
        await lockWorkRow(client, context);
        const capsuleId = uuid(input.capsule_id, "capsule_id");
        const result = await client.query(`UPDATE core_continuity_capsules SET verified_memory=true
          WHERE tenant_id=$1 AND work_id=$2 AND capsule_id=$3 AND supervisor_approved=true
          RETURNING capsule_digest`, [context.tenantId, context.workId, capsuleId]);
        if (!result.rows[0]) throw new Error("continuity_supervisor_approval_required");
        const event = await appendEvent(client, context, "memory_verified", {
          capsule_id: capsuleId, capsule_digest: result.rows[0].capsule_digest,
          test_evidence: input.test_evidence, verifier: context.actor,
        });
        return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
          work_id: context.workId, capsule_id: capsuleId, verified_memory: true, event };
      }));
  }

  async function requireParticipant(client, context, sessionId, {
    active = true,
    agentId,
    clientType,
    transportSessionFingerprint,
  } = {}) {
    const result = await client.query(`SELECT session_id,agent_id,client_type,branch_id,status,expires_at,actor_subject,
        transport_session_fingerprint
      FROM core_continuity_participants
      WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3 AND actor_subject=$4
        AND ($5::boolean=false OR (status='active' AND expires_at>now()))
        AND ($6::varchar IS NULL OR agent_id=$6)
        AND ($7::varchar IS NULL OR client_type=$7)
        AND transport_session_fingerprint=$8
      FOR UPDATE`, [context.tenantId, context.workId, sessionId, context.actorSubject, active,
      agentId || null, clientType || null, transportSessionFingerprint]);
    if (!result.rows[0]) throw new Error("continuity_participant_not_active");
    return result.rows[0];
  }

  async function resolveDttWorkLeaseBinding(identity, input = {}) {
    await initialize();
    const context = workContext(identity, input);
    const presence = identity?.agentPresence || {};
    const binding = assertGalleryParticipantBinding(identity, {
      session_id: presence.session_id,
      agent_id: presence.agent_id,
      client_type: presence.client_type,
    });
    if (
      !/^[a-f0-9]{16,160}$/i.test(String(presence.session_fingerprint || ""))
      || !/^ai_[a-f0-9]{16,160}$/i.test(String(presence.opaque_agent_id || ""))
      || !/^ap_[a-f0-9]{16,160}$/i.test(String(presence.actor_provenance || ""))
    ) {
      throw new Error("dtt_work_signed_presence_required");
    }
    const result = await pool.query(`SELECT
        p.session_id,p.agent_id,p.client_type,p.expires_at AS participant_expires_at,
        p.transport_session_fingerprint,l.lease_id,l.expires_at AS lease_expires_at
      FROM core_continuity_participants p
      JOIN core_continuity_leases l
        ON l.tenant_id=p.tenant_id AND l.work_id=p.work_id AND l.session_id=p.session_id
      WHERE p.tenant_id=$1 AND p.work_id=$2 AND p.session_id=$3 AND p.actor_subject=$4
        AND p.agent_id=$5 AND p.client_type=$6 AND p.transport_session_fingerprint=$7
        AND p.status='active' AND p.expires_at>now()
        AND l.status='active' AND l.expires_at>now()
      ORDER BY l.expires_at,l.lease_id
      LIMIT 1`, [
      context.tenantId,
      context.workId,
      binding.sessionId,
      context.actorSubject,
      binding.agentId,
      binding.clientType,
      binding.transportSessionFingerprint,
    ]);
    const row = result.rows[0];
    if (!row) throw new Error("dtt_work_active_lease_required");
    const leaseExpiresAt = dateValue(row.lease_expires_at, "dtt_work_lease_expires_at");
    const participantExpiresAt = dateValue(
      row.participant_expires_at,
      "dtt_work_participant_expires_at",
    );
    if (leaseExpiresAt.getTime() <= nowDate().getTime()
        || participantExpiresAt.getTime() <= nowDate().getTime()) {
      throw new Error("dtt_work_active_lease_required");
    }
    return Object.freeze({
      schema_version: "dtt_work_lease_binding_v1",
      tenant_id: context.tenantId,
      work_id: context.workId,
      lease_id: uuid(row.lease_id, "dtt_work_lease_id"),
      expires_at: leaseExpiresAt.toISOString(),
      participant_expires_at: participantExpiresAt.toISOString(),
      session_id: binding.sessionId,
      agent_id: binding.agentId,
      client_type: binding.clientType,
      session_fingerprint: String(presence.session_fingerprint).toLowerCase(),
      host_transport_session_fingerprint: binding.transportSessionFingerprint,
      presence_signature: String(presence.signature),
      opaque_agent_id: String(presence.opaque_agent_id),
      actor_provenance: String(presence.actor_provenance),
      execution_authorized: false,
    });
  }

  async function resolveGenericWorkCoreJoinLeaseBinding(identity, input = {}) {
    let binding;
    try {
      binding = await resolveDttWorkLeaseBinding(identity, input);
    } catch (error) {
      const reason = String(error?.code || error?.message || "");
      const mapped = new Map([
        ["dtt_work_active_lease_required", "generic_work_core_join_active_lease_required"],
        ["dtt_work_signed_presence_required", "generic_work_core_join_signed_presence_required"],
        ["gallery_signed_presence_required", "generic_work_core_join_signed_presence_required"],
        ["gallery_participant_presence_mismatch", "generic_work_core_join_principal_mismatch"],
        ["tenant_work_membership_required", "generic_work_core_join_work_acl_denied"],
        ["work_id_invalid", "generic_work_core_join_work_id_invalid"],
      ]).get(reason) || "generic_work_core_join_work_binding_unavailable";
      throw dttWorkBindingError(mapped);
    }
    return Object.freeze({
      ...binding,
      schema_version: "generic_work_core_join_lease_binding_v1",
      execution_authorized: false,
    });
  }

  async function expireLeases(client, context) {
    const expired = await client.query(`UPDATE core_continuity_leases
      SET status='expired',released_at=coalesce(released_at,now())
      WHERE tenant_id=$1 AND work_id=$2 AND status='active' AND expires_at<=now()
      RETURNING lease_id,session_id`, [context.tenantId, context.workId]);
    if (expired.rows.length) {
      await appendEvent(client, context, "lease_expired", {
        recovered_leases: expired.rows.map((row) => ({
          lease_id: row.lease_id, session_id: row.session_id,
        })),
      });
    }
    return expired.rows;
  }

  async function gallery(identity, input = {}) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const limit = positiveInteger(input.limit, 50, 200);
    const status = input.status ? safeText(input.status, 40) : null;
    const projectId = input.project_id ? identifier(input.project_id, "project_id") : null;
    const query = safeText(input.query, 240).trim() || null;
    const result = await pool.query(`SELECT
        w.tenant_id,w.project_id,w.work_id,w.parent_work_id,w.idea,w.objective,w.status,
        w.current_version,w.next_action,w.updated_at,
        count(DISTINCT p.session_id) FILTER (
          WHERE p.status='active' AND p.expires_at>now()
        )::int AS active_participants,
        count(DISTINCT l.lease_id) FILTER (
          WHERE l.status='active' AND l.expires_at>now()
        )::int AS active_leases,
        count(DISTINCT b.branch_id) FILTER (WHERE b.status='active')::int AS active_branches
      FROM core_continuity_works w
      LEFT JOIN core_continuity_participants p
        ON p.tenant_id=w.tenant_id AND p.work_id=w.work_id
      LEFT JOIN core_continuity_leases l
        ON l.tenant_id=w.tenant_id AND l.work_id=w.work_id
      LEFT JOIN core_continuity_branches b
        ON b.tenant_id=w.tenant_id AND b.work_id=w.work_id
      WHERE w.tenant_id=$1
        AND ($2::varchar IS NULL OR w.project_id=$2)
        AND ($3::varchar IS NULL OR w.status=$3)
        AND ($4::text IS NULL OR w.idea ILIKE '%'||$4||'%' OR
          w.objective ILIKE '%'||$4||'%' OR w.next_action ILIKE '%'||$4||'%')
      GROUP BY w.tenant_id,w.project_id,w.work_id
      ORDER BY w.updated_at DESC LIMIT $5`, [tenantId, projectId, status, query, limit]);
    const remediationRows = await pool.query(`SELECT work_id,remediation_id,original_decision_id,
        status,block_class,payload->'original_decision'->>'block_code' AS block_code,
        payload->'nyra_explanation'->>'plain_summary' AS summary,
        payload->'nyra_explanation'->>'recommended_next_action' AS next_action,
        payload->>'assigned_agent_id' AS assigned_agent_id,
        payload->>'surface' AS surface,
        created_at,updated_at
      FROM core_continuity_remediations
      WHERE tenant_id=$1 AND ($2::varchar IS NULL OR project_id=$2)
        AND status NOT IN ('closed','cancelled','expired')
      ORDER BY updated_at DESC`, [tenantId, projectId]);
    const blockersByWork = new Map();
    for (const row of remediationRows.rows) {
      const blockers = blockersByWork.get(row.work_id) || [];
      blockers.push({
        blocker_id: row.remediation_id,
        type: "core_block_remediation",
        decision_id: row.original_decision_id,
        block_code: row.block_code,
        block_class: row.block_class,
        status: row.status,
        assigned_agent_id: row.assigned_agent_id || null,
        surface: row.surface || null,
        summary: row.summary || row.block_code,
        next_action: row.next_action || "inspect_remediation",
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
      blockersByWork.set(row.work_id, blockers);
    }
    return {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: tenantId,
      filters: { project_id: projectId, status, query },
      works: result.rows.map((work) => ({
        ...work,
        blockers: blockersByWork.get(String(work.work_id)) || [],
        blocker_count: (blockersByWork.get(String(work.work_id)) || []).length,
      })),
    };
  }

  async function join(identity, input) {
    const context = workContext(identity, input);
    const binding = assertGalleryParticipantBinding(identity, input);
    const { sessionId, agentId, transportSessionFingerprint } = binding;
    context.transportSessionFingerprint = transportSessionFingerprint;
    const branchId = input.branch_id ? uuid(input.branch_id, "branch_id") : null;
    const ttlSeconds = positiveInteger(input.ttl_seconds, GALLERY_PARTICIPANT_MAX_TTL_SECONDS,
      GALLERY_PARTICIPANT_MAX_TTL_SECONDS);
    return transaction(async (client) => withIdempotency(
      client, context, input.idempotency_key, "gallery_join", input, async () => {
        await lockGalleryWork(client, context);
        if (branchId) {
          const branch = await client.query(`SELECT branch_id FROM core_continuity_branches
            WHERE tenant_id=$1 AND work_id=$2 AND branch_id=$3 AND status='active'`,
          [context.tenantId, context.workId, branchId]);
          if (!branch.rows[0]) throw new Error("continuity_branch_not_found");
        }
        // A session identifier may be reassigned only after its participant
        // presence expires. Lock the prior participant first so a concurrent
        // heartbeat/lease mutation cannot race the reassignment, then expire
        // every lease owned by the old subject before changing the binding.
        await client.query(`SELECT actor_subject,agent_id,client_type,branch_id,expires_at
          FROM core_continuity_participants
          WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3
          FOR UPDATE`, [context.tenantId, context.workId, sessionId]);
        const reboundLeases = await client.query(`UPDATE core_continuity_leases l
          SET status='expired',released_at=coalesce(l.released_at,now())
          WHERE l.tenant_id=$1 AND l.work_id=$2 AND l.session_id=$3 AND l.status='active'
            AND EXISTS (
              SELECT 1 FROM core_continuity_participants p
              WHERE p.tenant_id=l.tenant_id AND p.work_id=l.work_id
                AND p.session_id=l.session_id
                AND (p.actor_subject<>$4 OR p.agent_id<>$5 OR p.client_type<>$6
                     OR p.branch_id IS DISTINCT FROM $7::uuid
                     OR p.transport_session_fingerprint IS DISTINCT FROM $8)
                AND (
                  p.expires_at<=now()
                  OR (p.actor_subject=$4 AND p.agent_id=$5 AND p.client_type=$6
                      AND p.branch_id IS NULL AND $7::uuid IS NOT NULL)
                )
            )
          RETURNING l.lease_id,l.session_id`,
        [context.tenantId, context.workId, sessionId, context.actorSubject,
          agentId, binding.clientType, branchId, transportSessionFingerprint]);
        const participant = await client.query(`INSERT INTO core_continuity_participants
          (tenant_id,work_id,session_id,actor_subject,agent_id,client_type,branch_id,expires_at,metadata,
           transport_session_fingerprint)
          VALUES ($1,$2,$3,$4,$5,$6,$7,now()+($8::int*interval '1 second'),$9::jsonb,$10)
          ON CONFLICT (tenant_id,work_id,session_id) DO UPDATE SET
            actor_subject=EXCLUDED.actor_subject,agent_id=EXCLUDED.agent_id,
            client_type=EXCLUDED.client_type,
            transport_session_fingerprint=EXCLUDED.transport_session_fingerprint,
            branch_id=CASE
              WHEN core_continuity_participants.expires_at<=now() THEN EXCLUDED.branch_id
              ELSE coalesce(core_continuity_participants.branch_id,EXCLUDED.branch_id)
            END,
            status='active',last_seen_at=now(),
            expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata
          WHERE (core_continuity_participants.actor_subject=EXCLUDED.actor_subject
                 AND core_continuity_participants.agent_id=EXCLUDED.agent_id
                 AND core_continuity_participants.client_type=EXCLUDED.client_type
                 AND core_continuity_participants.transport_session_fingerprint=
                   EXCLUDED.transport_session_fingerprint
                 AND (core_continuity_participants.branch_id IS NULL
                      OR EXCLUDED.branch_id IS NULL
                      OR core_continuity_participants.branch_id=EXCLUDED.branch_id))
             OR core_continuity_participants.expires_at<=now()
          RETURNING session_id,agent_id,client_type,branch_id,status,joined_at,last_seen_at,expires_at`,
        [context.tenantId, context.workId, sessionId, context.actorSubject, agentId,
          binding.clientType, branchId, ttlSeconds,
          JSON.stringify(cleanJson({
            profile: input.metadata || {},
            gallery_acl: binding.acl,
            ownership_transfer_allowed: false,
          }, 20_000)), transportSessionFingerprint]);
        if (!participant.rows[0]) throw new Error("continuity_session_conflict");
        const leaseRebindEvent = reboundLeases.rows.length
          ? await appendEvent(client, context, "lease_expired", {
            reason: "session_binding_changed",
            recovered_leases: reboundLeases.rows.map((row) => ({
              lease_id: row.lease_id,
              session_id: row.session_id,
            })),
          })
          : null;
        const event = await appendEvent(client, context, "participant_joined", {
          session_id: sessionId, agent_id: agentId,
          branch_id: participant.rows[0].branch_id,
        });
        return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
          work_id: context.workId, participant: participant.rows[0],
          rebound_leases_expired: reboundLeases.rows.length,
          lease_rebind_event: leaseRebindEvent, event };
      }));
  }

  async function heartbeat(identity, input) {
    const context = workContext(identity, input);
    const { sessionId, agentId, clientType, transportSessionFingerprint } =
      assertGalleryParticipantBinding(identity, input);
    context.transportSessionFingerprint = transportSessionFingerprint;
    const ttlSeconds = positiveInteger(input.ttl_seconds, GALLERY_PARTICIPANT_MAX_TTL_SECONDS,
      GALLERY_PARTICIPANT_MAX_TTL_SECONDS);
    return transaction(async (client) => withIdempotency(
      client, context, input.idempotency_key, "gallery_heartbeat", input, async () => {
        await lockGalleryWork(client, context);
        await requireParticipant(client, context, sessionId, {
          active: false,
          agentId,
          clientType,
          transportSessionFingerprint,
        });
        const participant = await client.query(`UPDATE core_continuity_participants
          SET status='active',last_seen_at=now(),expires_at=now()+($5::int*interval '1 second')
          WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3 AND actor_subject=$4
            AND agent_id=$6 AND client_type=$7
          RETURNING session_id,agent_id,branch_id,status,last_seen_at,expires_at`,
        [context.tenantId, context.workId, sessionId, context.actorSubject, ttlSeconds,
          agentId, clientType]);
        if (!participant.rows[0]) throw new Error("continuity_participant_not_active");
        const recovered = await expireLeases(client, context);
        const event = await appendEvent(client, context, "participant_heartbeat", {
          session_id: sessionId, expired_leases_recovered: recovered.length,
        });
        return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
          work_id: context.workId, participant: participant.rows[0], event };
      }));
  }

  async function openBranch(identity, input) {
    const context = workContext(identity, input);
    const { sessionId, agentId, clientType, transportSessionFingerprint } =
      assertGalleryParticipantBinding(identity, input);
    context.transportSessionFingerprint = transportSessionFingerprint;
    const branchKey = identifier(input.branch_key, "branch_key");
    const parentBranchId = input.parent_branch_id ? uuid(input.parent_branch_id, "parent_branch_id") : null;
    return transaction(async (client) => withIdempotency(
      client, context, input.idempotency_key, "branch_open", input, async () => {
        await lockGalleryWork(client, context);
        await requireParticipant(client, context, sessionId, {
          agentId, clientType, transportSessionFingerprint,
        });
        if (parentBranchId) {
          const parent = await client.query(`SELECT branch_id FROM core_continuity_branches
            WHERE tenant_id=$1 AND work_id=$2 AND branch_id=$3`,
          [context.tenantId, context.workId, parentBranchId]);
          if (!parent.rows[0]) throw new Error("continuity_parent_branch_not_found");
        }
        const branchId = crypto.randomUUID();
        const branch = await client.query(`INSERT INTO core_continuity_branches
          (tenant_id,work_id,branch_id,parent_branch_id,branch_key,title,objective,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (tenant_id,work_id,branch_key) DO UPDATE SET
            updated_at=core_continuity_branches.updated_at
          RETURNING branch_id,parent_branch_id,branch_key,title,objective,status,created_at,updated_at`,
        [context.tenantId, context.workId, branchId, parentBranchId, branchKey,
          safeText(input.title, 240), safeText(input.objective, 4_000), context.actor]);
        const reboundLeases = await client.query(`UPDATE core_continuity_leases
          SET status='expired',released_at=coalesce(released_at,now())
          WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3 AND status='active'
            AND branch_id IS DISTINCT FROM $4::uuid
          RETURNING lease_id,session_id`,
        [context.tenantId, context.workId, sessionId, branch.rows[0].branch_id]);
        const assigned = await client.query(`UPDATE core_continuity_participants SET branch_id=$4,last_seen_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3
            AND (branch_id IS NULL OR branch_id=$4)
          RETURNING branch_id`,
        [context.tenantId, context.workId, sessionId, branch.rows[0].branch_id]);
        if (!assigned.rows[0]) throw new Error("continuity_participant_branch_locked");
        const leaseRebindEvent = reboundLeases.rows.length
          ? await appendEvent(client, context, "lease_expired", {
            reason: "participant_branch_bound",
            recovered_leases: reboundLeases.rows.map((row) => ({
              lease_id: row.lease_id,
              session_id: row.session_id,
            })),
          })
          : null;
        const event = await appendEvent(client, context, "branch_opened", {
          branch_id: branch.rows[0].branch_id, parent_branch_id: parentBranchId,
          branch_key: branchKey, session_id: sessionId,
        });
        return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
          work_id: context.workId, branch: branch.rows[0],
          rebound_leases_expired: reboundLeases.rows.length,
          lease_rebind_event: leaseRebindEvent, event };
      }));
  }

  async function acquireLease(identity, input) {
    const context = workContext(identity, input);
    const {
      sessionId,
      agentId,
      clientType,
      sessionFingerprint,
      transportSessionFingerprint,
    } = assertGalleryParticipantBinding(identity, input);
    if (Object.prototype.hasOwnProperty.call(input, "authority_scope") ||
        Object.prototype.hasOwnProperty.call(input, "policy_session_fingerprint")) {
      throw new Error("continuity_lease_authority_scope_forbidden");
    }
    context.transportSessionFingerprint = transportSessionFingerprint;
    const branchId = input.branch_id ? uuid(input.branch_id, "branch_id") : null;
    const ttlSeconds = positiveInteger(input.ttl_seconds, GALLERY_PARTICIPANT_MAX_TTL_SECONDS,
      GALLERY_PARTICIPANT_MAX_TTL_SECONDS);
    const surfaces = normalizeSurfaces(input.surfaces);
    const causalLeaseRequest = surfaces.some((surface) => CAUSAL_SURFACE_KINDS.has(surface.kind))
      ? { ...input, _verified_policy_session_fingerprint: sessionFingerprint }
      : input;
    return transaction(async (client) => withIdempotency(
      client, context, input.idempotency_key, "lease_acquire", causalLeaseRequest, async () => {
        await lockGalleryWork(client, context);
        const participant = await requireParticipant(client, context, sessionId, {
          agentId,
          clientType,
          transportSessionFingerprint,
        });
        if (branchId && branchId !== participant.branch_id) {
          throw new Error("continuity_participant_branch_locked");
        }
        const leaseId = crypto.randomUUID();
        const policy = causalLeasePolicy({
          tenantId: context.tenantId,
          actorId: context.actor,
          leaseId,
          purpose: input.purpose,
          surfaces,
          sessionFingerprint,
        });
        const causalProject = surfaces.find((surface) => surface.kind === "causal_project");
        if (causalProject) {
          const projectBinding = await client.query(`SELECT project_uuid FROM core_continuity_works
            WHERE tenant_id=$1 AND work_id=$2`, [context.tenantId, context.workId]);
          if (!projectBinding.rows[0]?.project_uuid ||
              String(projectBinding.rows[0].project_uuid).toLowerCase() !== causalProject.value) {
            throw new Error("continuity_causal_project_binding_mismatch");
          }
        }
        await expireLeases(client, context);
        const active = await client.query(`SELECT l.lease_id,l.session_id,l.branch_id,l.purpose,l.expires_at,
            coalesce(jsonb_agg(jsonb_build_object('kind',s.surface_kind,'value',s.surface_value))
              FILTER (WHERE s.surface_kind IS NOT NULL),'[]'::jsonb) AS surfaces
          FROM core_continuity_leases l
          LEFT JOIN core_continuity_lease_surfaces s
            ON s.tenant_id=l.tenant_id AND s.work_id=l.work_id AND s.lease_id=l.lease_id
          WHERE l.tenant_id=$1 AND l.work_id=$2 AND l.status='active' AND l.expires_at>now()
            AND l.session_id<>$3
          GROUP BY l.lease_id,l.session_id,l.branch_id,l.purpose,l.expires_at`,
        [context.tenantId, context.workId, sessionId]);
        const conflicts = active.rows.flatMap((lease) => {
          const conflicting = surfaces.filter((requested) =>
            (lease.surfaces || []).some((held) => surfacesOverlap(requested, held)));
          return conflicting.length ? [{
            lease_id: lease.lease_id, session_id: lease.session_id, branch_id: lease.branch_id,
            purpose: lease.purpose, expires_at: lease.expires_at, surfaces: conflicting,
          }] : [];
        });
        if (conflicts.length) {
          const event = await appendEvent(client, context, "lease_conflict", {
            session_id: sessionId, requested_surfaces: surfaces,
            conflicting_leases: conflicts.map((conflict) => ({
              lease_id: conflict.lease_id, session_id: conflict.session_id,
              branch_id: conflict.branch_id, surfaces: conflict.surfaces,
            })),
          });
          return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
            work_id: context.workId, acquired: false, blocked_reason: "continuity_lease_overlap",
            conflicts, event };
        }
        const lease = await client.query(`INSERT INTO core_continuity_leases
          (tenant_id,work_id,lease_id,session_id,branch_id,purpose,expires_at,created_by,
           policy_authority_scope,policy_authority_source,policy_authority_binding_digest,policy_session_fingerprint)
          VALUES ($1,$2,$3,$4,$5,$6,now()+($7::int*interval '1 second'),$8,$9::jsonb,$10,$11,$12)
          RETURNING lease_id,session_id,branch_id,purpose,status,acquired_at,renewed_at,expires_at,
            policy_authority_scope,policy_authority_source,policy_authority_binding_digest,policy_session_fingerprint`,
        [context.tenantId, context.workId, leaseId, sessionId, branchId || participant.branch_id,
          safeText(input.purpose, 2_000), ttlSeconds, context.actor, JSON.stringify(policy.authorityScope),
          policy.authoritySource, policy.authorityBindingDigest, policy.policySessionFingerprint]);
        for (const surface of surfaces) {
          await client.query(`INSERT INTO core_continuity_lease_surfaces
            (tenant_id,work_id,lease_id,surface_kind,surface_value) VALUES ($1,$2,$3,$4,$5)`,
          [context.tenantId, context.workId, leaseId, surface.kind, surface.value]);
        }
        const event = await appendEvent(client, context, "lease_acquired", {
          lease_id: leaseId, session_id: sessionId, branch_id: lease.rows[0].branch_id,
          surfaces, expires_at: lease.rows[0].expires_at,
          policy_authority_source: policy.authoritySource,
          policy_authority_binding_digest: policy.authorityBindingDigest,
          policy_session_fingerprint: policy.policySessionFingerprint,
        });
        return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
          work_id: context.workId, acquired: true, lease: { ...lease.rows[0], surfaces }, event };
      }));
  }

  async function renewLease(identity, input) {
    const context = workContext(identity, input);
    const { sessionId, agentId, clientType, transportSessionFingerprint } =
      assertGalleryParticipantBinding(identity, input);
    context.transportSessionFingerprint = transportSessionFingerprint;
    const leaseId = uuid(input.lease_id, "lease_id");
    const ttlSeconds = positiveInteger(input.ttl_seconds, GALLERY_PARTICIPANT_MAX_TTL_SECONDS,
      GALLERY_PARTICIPANT_MAX_TTL_SECONDS);
    return transaction(async (client) => withIdempotency(
      client, context, input.idempotency_key, "lease_renew", input, async () => {
        await lockGalleryWork(client, context);
        const participant = await requireParticipant(client, context, sessionId, {
          agentId,
          clientType,
          transportSessionFingerprint,
        });
        const lease = await client.query(`UPDATE core_continuity_leases
          SET renewed_at=now(),expires_at=now()+($5::int*interval '1 second')
          WHERE tenant_id=$1 AND work_id=$2 AND lease_id=$3 AND session_id=$4
            AND status='active' AND expires_at>now() AND created_by=$6
            AND branch_id IS NOT DISTINCT FROM $7::uuid
          RETURNING lease_id,session_id,branch_id,purpose,status,renewed_at,expires_at`,
        [context.tenantId, context.workId, leaseId, sessionId, ttlSeconds,
          agentId, participant.branch_id]);
        if (!lease.rows[0]) throw new Error("continuity_lease_not_active");
        const event = await appendEvent(client, context, "lease_renewed", {
          lease_id: leaseId, session_id: sessionId, expires_at: lease.rows[0].expires_at,
        });
        return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
          work_id: context.workId, lease: lease.rows[0], event };
      }));
  }

  async function releaseLease(identity, input) {
    const context = workContext(identity, input);
    const { sessionId, agentId, clientType, transportSessionFingerprint } =
      assertGalleryParticipantBinding(identity, input);
    context.transportSessionFingerprint = transportSessionFingerprint;
    const leaseId = uuid(input.lease_id, "lease_id");
    return transaction(async (client) => withIdempotency(
      client, context, input.idempotency_key, "lease_release", input, async () => {
        await lockGalleryWork(client, context);
        const participant = await requireParticipant(client, context, sessionId, {
          active: false,
          agentId,
          clientType,
          transportSessionFingerprint,
        });
        const lease = await client.query(`UPDATE core_continuity_leases
          SET status='released',released_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND lease_id=$3 AND session_id=$4
            AND status='active' AND created_by=$5
            AND branch_id IS NOT DISTINCT FROM $6::uuid
          RETURNING lease_id,session_id,branch_id,purpose,status,released_at`,
        [context.tenantId, context.workId, leaseId, sessionId,
          agentId, participant.branch_id]);
        if (!lease.rows[0]) throw new Error("continuity_lease_not_active");
        const event = await appendEvent(client, context, "lease_released", {
          lease_id: leaseId, session_id: sessionId,
        });
        return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
          work_id: context.workId, lease: lease.rows[0], event };
      }));
  }

  async function postMessage(identity, input) {
    const context = workContext(identity, input);
    const {
      sessionId: fromSessionId,
      agentId,
      clientType,
      transportSessionFingerprint,
    } = assertGalleryParticipantBinding(identity, input);
    context.transportSessionFingerprint = transportSessionFingerprint;
    const toSessionId = input.to_session_id ? identifier(input.to_session_id, "to_session_id") : null;
    const branchId = input.branch_id ? uuid(input.branch_id, "branch_id") : null;
    return transaction(async (client) => withIdempotency(
      client, context, input.idempotency_key, "message_post", input, async () => {
        await lockGalleryWork(client, context);
        await requireParticipant(client, context, fromSessionId, {
          agentId, clientType, transportSessionFingerprint,
        });
        let recipient = null;
        if (toSessionId) {
          const result = await client.query(`SELECT session_id,actor_subject FROM core_continuity_participants
            WHERE tenant_id=$1 AND work_id=$2 AND session_id=$3
              AND status='active' AND expires_at>now()`,
          [context.tenantId, context.workId, toSessionId]);
          recipient = result.rows[0] || null;
          if (!recipient) throw new Error("continuity_message_recipient_not_found");
        }
        if (branchId) {
          const branch = await client.query(`SELECT branch_id FROM core_continuity_branches
            WHERE tenant_id=$1 AND work_id=$2 AND branch_id=$3`,
          [context.tenantId, context.workId, branchId]);
          if (!branch.rows[0]) throw new Error("continuity_branch_not_found");
        }
        const messageId = crypto.randomUUID();
        const payload = cleanJson(input.payload || {}, 40_000);
        const message = await client.query(`INSERT INTO core_continuity_messages
          (tenant_id,work_id,message_id,branch_id,from_session_id,to_session_id,to_actor_subject,
           message_type,subject,payload,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
          RETURNING message_id,branch_id,from_session_id,to_session_id,message_type,subject,payload,created_at`,
        [context.tenantId, context.workId, messageId, branchId, fromSessionId, toSessionId,
          recipient?.actor_subject || null, safeText(input.message_type || "update", 40),
          safeText(input.subject, 240), JSON.stringify(payload), context.actor]);
        const event = await appendEvent(client, context, "message_posted", {
          message_id: messageId, branch_id: branchId, from_session_id: fromSessionId,
          to_session_id: toSessionId, message_type: input.message_type || "update",
        });
        return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
          work_id: context.workId, message: message.rows[0], event };
      }));
  }

  async function inbox(identity, input) {
    await initialize();
    const context = workContext(identity, input);
    const { sessionId, agentId, clientType, transportSessionFingerprint } =
      assertGalleryParticipantBinding(identity, input);
    const limit = positiveInteger(input.limit, 50, 200);
    const participant = await requireParticipant(pool, context, sessionId, {
      active: false,
      agentId,
      clientType,
      transportSessionFingerprint,
    });
    const branchId = input.branch_id ? uuid(input.branch_id, "branch_id") : null;
    const messages = await pool.query(`SELECT message_id,branch_id,from_session_id,to_session_id,
        message_type,subject,payload,created_at
      FROM core_continuity_messages
      WHERE tenant_id=$1 AND work_id=$2
        AND (to_session_id IS NULL OR (to_session_id=$3 AND to_actor_subject=$4))
        AND ($5::uuid IS NULL OR branch_id=$5)
        AND ($6::timestamptz IS NULL OR created_at>$6)
      ORDER BY created_at DESC LIMIT $7`,
    [context.tenantId, context.workId, sessionId, participant.actor_subject, branchId, input.since || null, limit]);
    return { schema_version: "tenant_work_gallery_v1", tenant_id: context.tenantId,
      work_id: context.workId, session_id: sessionId, messages: messages.rows };
  }

  async function insertNativeReceipt(client, context, input) {
    const receiptId = crypto.randomUUID();
    const payload = cleanJson({
      schema_version: "native_agent_receipt_v1",
      receipt_id: receiptId,
      work_id: context.workId,
      plan_id: input.plan_id,
      receipt_type: input.receipt_type,
      agent_id: input.agent_id || null,
      ...input.payload,
      host_native: true,
      provider_execution: false,
      host_permission_override: false,
      host_policy_override: false,
      host_policy_must_allow: true,
      coordinator_session_fingerprint:
        input.coordinator_session_fingerprint || null,
      host_type: input.host_type || null,
    }, 80_000);
    const payloadDigest = digest(payload);
    await client.query(`INSERT INTO core_continuity_native_receipts
      (tenant_id,work_id,plan_id,receipt_id,receipt_type,agent_id,payload,payload_digest,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [context.tenantId, context.workId, input.plan_id, receiptId, input.receipt_type,
      input.agent_id || null, JSON.stringify(payload), payloadDigest, context.actor]);
    return { ...payload, payload_digest: payloadDigest };
  }

  // Example plan input:
  // {work_id, host_type:"codex_native", tasks:[{task_id:"build",kind:"builder",
  // instruction:"Implement..."},{task_id:"verify",kind:"verifier",instruction:"Verify...",
  // dependencies:["build"]}], max_parallel:2, closure_requirements:{tests_required:true},
  // idempotency_key:"native-plan-1"}.
  async function planNativeAgents(identity, input, options = {}) {
    const context = workContext(identity, input);
    const idempotencyKey = safeText(input.idempotency_key, 160).trim();
    if (!idempotencyKey) throw new Error("idempotency_key_required");
    const coordinatorSessionFingerprint = nativeCoordinatorFingerprint(identity);
    const planId = input.plan_id
      ? uuid(input.plan_id, "plan_id")
      : deterministicUuid({
        tenant_id: context.tenantId,
        work_id: context.workId,
        operation: "native_agent_plan",
        idempotency_key: idempotencyKey,
      });
    const declaredBaseBranch = input.base_branch === undefined
      ? null
      : releaseBranch(input.base_branch, "native_agent_base_branch");
    const basePlan = {
      ...buildNativeAgentPlan(input),
      ...(declaredBaseBranch ? { base_branch: declaredBaseBranch } : {}),
      plan_id: planId,
      work_id: context.workId,
    };
    return transaction(async (client) => withIdempotency(
      client,
      context,
      idempotencyKey,
      "native_agent_plan",
      {
        input,
        core_plan_digest: options.corePlan ? digest(options.corePlan) : null,
      },
      async () => {
        const work = await client.query(`SELECT w.work_id,a.anchor,a.intent_digest
          FROM core_continuity_works w JOIN core_continuity_intent_anchors a
            ON a.tenant_id=w.tenant_id AND a.work_id=w.work_id
          WHERE w.tenant_id=$1 AND w.work_id=$2 FOR UPDATE`,
        [context.tenantId, context.workId]);
        if (!work.rows[0]) throw new Error("continuity_work_not_found");
        const priorPlan = (await client.query(`SELECT plan_id,plan_version FROM core_continuity_native_plans
          WHERE tenant_id=$1 AND work_id=$2 ORDER BY plan_version DESC,created_at DESC,plan_id DESC LIMIT 1 FOR UPDATE`,
        [context.tenantId, context.workId])).rows[0];
        const planVersion = Number(priorPlan?.plan_version || 0) + 1;
        const plan = {
          ...basePlan,
          coordinator_session_fingerprint: coordinatorSessionFingerprint,
          acceptance_contract: buildAcceptanceContract(
            work.rows[0].anchor,
            work.rows[0].intent_digest,
          ),
          core_authority: bindCoreWorkPlan(options.corePlan, basePlan, {
            workId: context.workId,
            intentDigest: work.rows[0].intent_digest,
            repository: safeText(input.repository, 240),
            baseBranch: input.base_branch,
          }),
        };
        const planDigest = digest(plan);
        await client.query(`INSERT INTO core_continuity_native_plans
          (tenant_id,work_id,plan_id,plan,plan_digest,status,created_by,change_id,base_state_digest,contract_schema,plan_version,supersedes_plan_id)
          VALUES ($1,$2,$3,$4::jsonb,$5,'planned',$6,$7,$8,$9,$10,$11)`,
        [context.tenantId, context.workId, planId, JSON.stringify(plan), planDigest, context.actor,
          plan.software_contract?.change_id || null, plan.software_contract?.base_state_digest || null,
          plan.software_contract ? "worker_plan_contract_v1" : "native_agent_plan_v1", planVersion, priorPlan?.plan_id || null]);
        const receipt = await insertNativeReceipt(client, context, {
          plan_id: planId,
          receipt_type: "plan_created",
          host_type: plan.host_type,
          coordinator_session_fingerprint: coordinatorSessionFingerprint,
          payload: {
            plan_digest: planDigest,
            core_plan_id: plan.core_authority.plan_id,
            core_plan_digest: plan.core_authority.plan_digest,
            host_type: plan.host_type,
            max_agents: plan.max_agents,
          },
        });
        const event = await appendEvent(client, context, "native_plan_created", {
          plan_id: planId,
          plan_digest: planDigest,
          core_plan_id: plan.core_authority.plan_id,
          core_plan_digest: plan.core_authority.plan_digest,
          host_type: plan.host_type,
          provider_execution: false,
        });
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          plan,
          plan_digest: planDigest,
          receipt,
          event,
        };
      },
    ));
  }

  async function expireNativeAgentLeases(context, planId) {
    return transaction(async (client) => {
      await lockWorkRow(client, context);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        context.tenantId,
        planId,
      ]);
      const expired = await client.query(`UPDATE core_continuity_native_agents
        SET status='expired',reported_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND status='bound'
          AND lease_expires_at IS NOT NULL AND lease_expires_at<=now()
        RETURNING task_id,agent_id`,
      [context.tenantId, context.workId, planId]);
      if (!expired.rowCount) return [];
      const taskIds = expired.rows.map((row) => safeText(row.task_id, 120)).sort();
      const nextAction =
        `Native lease expired for ${taskIds.join(", ")}. Keep the work blocked, inspect the indexed incident, and create a fresh bounded plan before resuming.`.slice(0, 4_000);
      await client.query(`UPDATE core_continuity_native_plans
        SET status='blocked'
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND status='planned'`,
      [context.tenantId, context.workId, planId]);
      await client.query(`UPDATE core_continuity_works
        SET status='blocked',next_action=$3,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND status<>'completed'`,
      [context.tenantId, context.workId, nextAction]);
      await appendEvent(client, context, "native_agent_lease_expired", {
        plan_id: planId,
        task_ids: taskIds,
        next_action: nextAction,
      });
      return expired.rows;
    });
  }

  // Example bind input:
  // {work_id, plan_id, task_id:"build", native_agent_id:"codex-builder",
  // host_type:"codex_native", host_task_id:"/root/build"}.
  async function bindNativeAgent(identity, input) {
    assertNativePayload(input);
    const context = workContext(identity, input);
    const planId = uuid(input.plan_id, "plan_id");
    const taskId = identifier(input.task_id, "task_id", 120);
    const agentId = identifier(input.native_agent_id || input.agent_id, "native_agent_id", 120);
    const hostTaskId = hostTaskIdentifier(input.host_task_id);
    const hostType = String(input.host_type || "");
    if (!NATIVE_HOST_TYPES.has(hostType)) throw new Error("native_agent_host_type_invalid");
    const coordinatorSessionFingerprint = nativeCoordinatorFingerprint(identity);
    const expiredLeases = await expireNativeAgentLeases(context, planId);
    if (expiredLeases.length) {
      throw new Error("native_agent_binding_expired_replan_required");
    }
    return transaction(async (client) => {
      await lockWorkRow(client, context);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        context.tenantId,
        planId,
      ]);
      const planResult = await client.query(`SELECT plan,status FROM core_continuity_native_plans
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 FOR UPDATE`,
      [context.tenantId, context.workId, planId]);
      const plan = planResult.rows[0]?.plan;
      if (!plan) throw new Error("native_agent_plan_not_found");
      if (planResult.rows[0].status !== "planned") throw new Error("native_agent_plan_not_open");
      if (plan.host_type !== hostType) throw new Error("native_agent_host_scope_mismatch");
      const task = plan.tasks.find((candidate) => candidate.task_id === taskId);
      if (!task) throw new Error("native_agent_task_not_found");
      const active = await client.query(`SELECT task_id,status
        FROM core_continuity_native_agents
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
        ORDER BY task_id FOR UPDATE`,
      [context.tenantId, context.workId, planId]);
      const existing = await client.query(`SELECT task_id,agent_id,host_type,host_task_id,task_digest,
          coordinator_session_fingerprint,assignment_capability_digest,status,lease_expires_at
        FROM core_continuity_native_agents
        WHERE tenant_id=$1 AND plan_id=$2 AND
          (task_id=$3 OR agent_id=$4 OR host_task_id=$5) LIMIT 1`,
      [context.tenantId, planId, taskId, agentId, hostTaskId]);
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.status === "expired") {
          throw new Error("native_agent_binding_expired_replan_required");
        }
        const replayCapability = assignmentCapability({
          tenant_id: context.tenantId,
          work_id: context.workId,
          plan_id: planId,
          task_id: taskId,
          agent_id: agentId,
          host_type: hostType,
          host_task_id: hostTaskId,
          task_digest: task.task_digest,
          coordinator_session_fingerprint: coordinatorSessionFingerprint,
          lease_expires_at: dateValue(
            row.lease_expires_at,
            "native_agent_lease",
          ).toISOString(),
        });
        if (row.task_id !== taskId || row.agent_id !== agentId ||
            row.host_type !== hostType || row.host_task_id !== hostTaskId ||
            row.task_digest !== task.task_digest ||
            row.coordinator_session_fingerprint !== coordinatorSessionFingerprint ||
            row.assignment_capability_digest !==
              assignmentCapabilityDigest(replayCapability)) {
          throw new Error("native_agent_binding_conflict");
        }
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          plan_id: planId,
          native_agent_id: agentId,
          binding: row,
          assignment_capability: replayCapability,
          idempotent_replay: true,
        };
      }
      const activeByTask = new Map(active.rows.map((row) => [row.task_id, row.status]));
      const dependencyNotReady = task.dependencies.find(
        (dependency) => activeByTask.get(dependency) !== "completed",
      );
      if (dependencyNotReady) {
        throw new Error(`native_agent_dependency_not_ready:${dependencyNotReady}`);
      }
      const activeCount = active.rows.filter((row) => row.status === "bound").length;
      if (activeCount >= Number(plan.max_parallel || 1)) {
        throw new Error("native_agent_parallel_limit_reached");
      }
      const leaseExpiresAt = new Date(nowDate().getTime() + 60 * 60 * 1_000).toISOString();
      const assignmentBinding = {
        tenant_id: context.tenantId,
        work_id: context.workId,
        plan_id: planId,
        task_id: taskId,
        agent_id: agentId,
        host_type: hostType,
        host_task_id: hostTaskId,
        task_digest: task.task_digest,
        coordinator_session_fingerprint: coordinatorSessionFingerprint,
        lease_expires_at: leaseExpiresAt,
      };
      const assignment = assignmentCapability(assignmentBinding);
      const assignmentDigest = assignmentCapabilityDigest(assignment);
      await client.query(`INSERT INTO core_continuity_native_agents
        (tenant_id,work_id,plan_id,task_id,agent_id,host_type,host_task_id,task_kind,task_digest,
         coordinator_session_fingerprint,assignment_capability_digest,bound_by,lease_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [context.tenantId, context.workId, planId, taskId, agentId, hostType, hostTaskId,
        task.kind, task.task_digest, coordinatorSessionFingerprint, assignmentDigest,
        context.actor, leaseExpiresAt]);
      const binding = {
        task_id: taskId,
        agent_id: agentId,
        host_type: hostType,
        host_task_id: hostTaskId,
        task_kind: task.kind,
        task_digest: task.task_digest,
        coordinator_session_fingerprint: coordinatorSessionFingerprint,
        assignment_capability_digest: assignmentDigest,
        status: "bound",
        lease_expires_at: leaseExpiresAt,
      };
      const receipt = await insertNativeReceipt(client, context, {
        plan_id: planId,
        receipt_type: "agent_bound",
        agent_id: agentId,
        host_type: hostType,
        coordinator_session_fingerprint: coordinatorSessionFingerprint,
        payload: binding,
      });
      const event = await appendEvent(client, context, "native_agent_bound", {
        plan_id: planId,
        task_id: taskId,
        agent_id: agentId,
        host_type: hostType,
          task_digest: task.task_digest,
          assignment_capability_digest: assignmentDigest,
      });
      return {
        schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
        tenant_id: context.tenantId,
        work_id: context.workId,
        plan_id: planId,
        native_agent_id: agentId,
        binding,
        assignment_capability: assignment,
        receipt,
        event,
      };
    });
  }

  // Example report input:
  // {work_id, plan_id, native_agent_id:"codex-verifier", host_task_id:"/root/verify",
  // status:"completed", report:{summary:"All checks passed", verdict:"approved",
  // tests:[{name:"npm test",passed:true}], evidence_refs:["commit:..."],live_verified:true}}.
  async function reportNativeAgent(identity, input) {
    assertNativePayload(input);
    const context = workContext(identity, input);
    const planId = uuid(input.plan_id, "plan_id");
    const agentId = identifier(input.native_agent_id || input.agent_id, "native_agent_id", 120);
    const hostTaskId = hostTaskIdentifier(input.host_task_id);
    const reporterPresence = nativeReporterPresence(identity, agentId);
    const suppliedAssignmentDigest = assignmentCapabilityDigest(
      input.assignment_capability,
    );
    const status = String(input.status || "");
    if (!NATIVE_REPORT_STATES.has(status)) throw new Error("native_agent_report_status_invalid");
    const reportInput = requireObject(input.report, "native_agent_report");
    const commitSha = reportInput.commit_sha === undefined || reportInput.commit_sha === null
      ? null
      : String(reportInput.commit_sha).trim().toLowerCase();
    if (commitSha !== null && !/^[a-f0-9]{40}$/.test(commitSha)) {
      throw new Error("native_agent_report_commit_invalid");
    }
    const report = cleanJson({
      schema_version: "native_agent_report_v1",
      automation_stage: reportInput.automation_stage
        ? String(reportInput.automation_stage)
        : null,
      summary: safeText(reportInput.summary, 8_000),
      verdict: reportInput.verdict ? String(reportInput.verdict) : null,
      commit_sha: commitSha,
      tests: Array.isArray(reportInput.tests) ? reportInput.tests.slice(0, 100) : [],
      evidence_refs: stringList(reportInput.evidence_refs, "native_agent_evidence_refs", {
        maxItems: 100,
        maxLength: 500,
      }),
      acceptance_evidence: Array.isArray(reportInput.acceptance_evidence)
        ? reportInput.acceptance_evidence.slice(0, 250).map((item) => {
          requireObject(item, "native_agent_acceptance_evidence");
          const criterionDigest = String(item.criterion_digest || "").toLowerCase();
          if (!/^[a-f0-9]{64}$/.test(criterionDigest)) {
            throw new Error("native_agent_acceptance_criterion_digest_invalid");
          }
          return {
            criterion_digest: criterionDigest,
            passed: item.passed === true,
            evidence_refs: stringList(
              item.evidence_refs,
              "native_agent_acceptance_evidence_refs",
              { maxItems: 30, maxLength: 500 },
            ),
          };
        })
        : [],
      live_verified: reportInput.live_verified === true,
      verifies_task_ids: stringList(reportInput.verifies_task_ids, "native_agent_verifies_tasks", {
        maxItems: 3,
        maxLength: 120,
      }),
      correction_required: reportInput.correction_required === true,
    }, 100_000);
    if (!report.summary) throw new Error("native_agent_report_summary_required");
    const expiredLeases = await expireNativeAgentLeases(context, planId);
    if (expiredLeases.length) {
      throw new Error("native_agent_binding_expired_replan_required");
    }
    return transaction(async (client) => {
      await lockWorkRow(client, context);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        context.tenantId,
        planId,
      ]);
      const current = await client.query(`SELECT a.task_id,a.task_kind,a.task_digest,a.status,a.report_digest,
          a.host_type,a.host_task_id,a.coordinator_session_fingerprint,
          a.assignment_capability_digest,a.native_session_fingerprint,
          a.native_presence_signature,a.lease_expires_at,
          p.plan,p.status AS plan_status
        FROM core_continuity_native_agents a JOIN core_continuity_native_plans p
          ON p.tenant_id=a.tenant_id AND p.plan_id=a.plan_id
        WHERE a.tenant_id=$1 AND a.work_id=$2 AND a.plan_id=$3 AND a.agent_id=$4 FOR UPDATE`,
      [context.tenantId, context.workId, planId, agentId]);
      const row = current.rows[0];
      if (!row) throw new Error("native_agent_binding_not_found");
      if (row.plan_status !== "planned") throw new Error("native_agent_plan_not_open");
      if (row.host_task_id !== hostTaskId) throw new Error("native_agent_host_task_mismatch");
      if (
        row.status === "expired" ||
        (row.lease_expires_at && dateValue(row.lease_expires_at, "native_agent_lease").getTime() <=
          nowDate().getTime())
      ) {
        throw new Error("native_agent_binding_expired_replan_required");
      }
      if (row.coordinator_session_fingerprint === reporterPresence.session_fingerprint) {
        throw new Error("native_agent_coordinator_report_forbidden");
      }
      const expectedAssignment = assignmentCapability({
        tenant_id: context.tenantId,
        work_id: context.workId,
        plan_id: planId,
        task_id: row.task_id,
        agent_id: agentId,
        host_type: row.host_type,
        host_task_id: row.host_task_id,
        task_digest: row.task_digest,
        coordinator_session_fingerprint: row.coordinator_session_fingerprint,
        lease_expires_at: dateValue(
          row.lease_expires_at,
          "native_agent_lease",
        ).toISOString(),
      });
      if (
        row.assignment_capability_digest !== suppliedAssignmentDigest ||
        suppliedAssignmentDigest !== assignmentCapabilityDigest(expectedAssignment) ||
        input.assignment_capability !== expectedAssignment
      ) {
        throw new Error("native_agent_assignment_capability_mismatch");
      }
      if (
        status === "completed" &&
        row.plan?.release_mode === "external_ticket_required" &&
        ["builder", "verifier"].includes(row.task_kind) &&
        !report.commit_sha
      ) {
        throw new Error("native_agent_report_commit_required");
      }
      if (row.task_kind === "verifier") {
        if (!["approved", "rejected"].includes(report.verdict)) throw new Error("native_agent_verifier_verdict_required");
        if (!report.verifies_task_ids.length || report.verifies_task_ids.includes(row.task_id)) {
          throw new Error("native_agent_verifier_scope_invalid");
        }
        const planTaskIds = new Set((row.plan?.tasks || []).map((task) => task.task_id));
        if (report.verifies_task_ids.some((taskId) => !planTaskIds.has(taskId))) {
          throw new Error("native_agent_verifier_scope_invalid");
        }
        const allowedCriteria = new Set(
          (row.plan?.acceptance_contract?.criteria || [])
            .map((criterion) => criterion.criterion_digest),
        );
        if (
          !report.acceptance_evidence.length ||
          report.acceptance_evidence.some((item) => !allowedCriteria.has(item.criterion_digest))
        ) {
          throw new Error("native_agent_acceptance_evidence_invalid");
        }
      } else if (
        row.task_kind === "builder" &&
        (report.verdict !== null || report.live_verified || report.acceptance_evidence.length)
      ) {
        throw new Error("native_agent_builder_authority_exceeded");
      } else if (report.verdict === "approved") {
        throw new Error("native_agent_non_verifier_approval_forbidden");
      } else if (report.acceptance_evidence.length) {
        throw new Error("native_agent_acceptance_evidence_verifier_only");
      }
      const reportDigest = digest({ status, report });
      if (row.report_digest) {
        if (
          row.report_digest !== reportDigest ||
          row.native_session_fingerprint !== reporterPresence.session_fingerprint ||
          row.native_presence_signature !== reporterPresence.signature
        ) {
          throw new Error("native_agent_report_conflict");
        }
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          plan_id: planId,
          agent_id: agentId,
          native_agent_id: agentId,
          report_digest: reportDigest,
          idempotent_replay: true,
        };
      }
      const reusedPresence = await client.query(`SELECT task_id FROM core_continuity_native_agents
        WHERE tenant_id=$1 AND plan_id=$2 AND native_session_fingerprint=$3
          AND agent_id<>$4 LIMIT 1`,
      [context.tenantId, planId, reporterPresence.session_fingerprint, agentId]);
      if (reusedPresence.rows[0]) throw new Error("native_agent_reporter_reuse_denied");
      await client.query(`UPDATE core_continuity_native_agents
        SET status=$5,report=$6::jsonb,report_digest=$7,
          native_session_fingerprint=$8,native_presence_signature=$9,reported_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND agent_id=$4`,
      [context.tenantId, context.workId, planId, agentId, status, JSON.stringify(report),
        reportDigest, reporterPresence.session_fingerprint, reporterPresence.signature]);
      const receipt = await insertNativeReceipt(client, context, {
        plan_id: planId,
        receipt_type: "agent_reported",
        agent_id: agentId,
        host_type: row.plan?.host_type,
        coordinator_session_fingerprint: row.coordinator_session_fingerprint,
        payload: {
          task_id: row.task_id,
          task_kind: row.task_kind,
          status,
          report_digest: reportDigest,
          native_session_fingerprint: reporterPresence.session_fingerprint,
          native_presence_signature: reporterPresence.signature,
        },
      });
      const event = await appendEvent(client, context, "native_agent_reported", {
        plan_id: planId,
        task_id: row.task_id,
        agent_id: agentId,
        status,
        report_digest: reportDigest,
        native_session_fingerprint: reporterPresence.session_fingerprint,
        native_presence_signature: reporterPresence.signature,
      });
      return {
        schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
        tenant_id: context.tenantId,
        work_id: context.workId,
        plan_id: planId,
        agent_id: agentId,
        native_agent_id: agentId,
        status,
        report_digest: reportDigest,
        receipt,
        event,
      };
    });
  }

  async function evaluateClosure(identity, input) {
    const context = workContext(identity, input);
    const planId = uuid(input.plan_id, "plan_id");
    return transaction(async (client) => withIdempotency(
      client,
      context,
      input.idempotency_key,
      "native_closure_evaluation",
      input,
      async () => {
        await lockWorkRow(client, context);
        const planResult = await client.query(`SELECT p.plan,p.plan_digest,p.status,a.intent_digest
          FROM core_continuity_native_plans p JOIN core_continuity_intent_anchors a
            ON a.tenant_id=p.tenant_id AND a.work_id=p.work_id
          WHERE p.tenant_id=$1 AND p.work_id=$2 AND p.plan_id=$3 FOR UPDATE`,
        [context.tenantId, context.workId, planId]);
        if (!planResult.rows[0]) throw new Error("native_agent_plan_not_found");
        if (digest(planResult.rows[0].plan) !== planResult.rows[0].plan_digest) {
          throw new Error("native_agent_plan_integrity_failed");
        }
        if (
          planResult.rows[0].plan?.acceptance_contract?.intent_digest !==
          planResult.rows[0].intent_digest
        ) {
          throw new Error("native_agent_intent_binding_mismatch");
        }
        const agents = await client.query(`SELECT task_id,agent_id,task_kind,status,report,report_digest,
            coordinator_session_fingerprint,native_session_fingerprint,native_presence_signature
          FROM core_continuity_native_agents WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
          ORDER BY task_id`, [context.tenantId, context.workId, planId]);
        const evaluation = evaluateNativeClosure({ plan: planResult.rows[0].plan, agents: agents.rows });
        const evaluationId = crypto.randomUUID();
        const evaluationDigest = digest(evaluation);
        const coreJoinMaterial = evaluation.closed
          ? buildCoreJoinMaterial({
            tenantId: context.tenantId,
            workId: context.workId,
            plan: planResult.rows[0].plan,
            planDigest: planResult.rows[0].plan_digest,
            agents: agents.rows,
            evaluation,
            evaluationDigest,
            release: input.release,
            attestationSigningSecret: assignmentSigningSecret,
          })
          : null;
        await client.query(`INSERT INTO core_continuity_closure_evaluations
          (tenant_id,work_id,plan_id,evaluation_id,evaluation,evaluation_digest,evaluated_by)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [context.tenantId, context.workId, planId, evaluationId, JSON.stringify(evaluation),
          evaluationDigest, context.actor]);
        if (evaluation.closed) {
          await client.query(`UPDATE core_continuity_works
            SET next_action='Issue and persist the exact Universal Core Join verdict before release readiness.',
              updated_at=now()
            WHERE tenant_id=$1 AND work_id=$2`, [context.tenantId, context.workId]);
        } else {
          await client.query(`UPDATE core_continuity_works SET next_action=$3,updated_at=now()
            WHERE tenant_id=$1 AND work_id=$2`,
          [context.tenantId, context.workId, `Resolve closure gaps: ${evaluation.missing.join(", ")}`.slice(0, 4_000)]);
        }
        const event = await appendEvent(client, context, "closure_evaluated", {
          plan_id: planId,
          evaluation_id: evaluationId,
          evaluation_digest: evaluationDigest,
          closed: evaluation.closed,
          missing: evaluation.missing,
        });
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          plan_id: planId,
          evaluation_id: evaluationId,
          evaluation_digest: evaluationDigest,
          ...evaluation,
          core_join_required: evaluation.closed,
          ...(coreJoinMaterial ? { core_join_material: coreJoinMaterial } : {}),
          event,
        };
      },
    ));
  }

  async function bindCoreJoinVerdict(identity, input, options = {}) {
    const context = workContext(identity, input);
    const planId = uuid(input.plan_id, "plan_id");
    const evaluationId = uuid(input.evaluation_id, "evaluation_id");
    const releaseIntent = requireObject(options.releaseIntent, "core_release_intent");
    const coreJoinRecord = requireObject(options.coreJoinRecord, "core_join_record");
    return transaction(async (client) => {
      await lockWorkRow(client, context);
      const stored = await client.query(`SELECT
          p.plan,p.plan_digest,p.status,a.intent_digest,e.evaluation,e.evaluation_digest
        FROM core_continuity_native_plans p
        JOIN core_continuity_intent_anchors a
          ON a.tenant_id=p.tenant_id AND a.work_id=p.work_id
        JOIN core_continuity_closure_evaluations e
          ON e.tenant_id=p.tenant_id AND e.work_id=p.work_id AND e.plan_id=p.plan_id
        WHERE p.tenant_id=$1 AND p.work_id=$2 AND p.plan_id=$3 AND e.evaluation_id=$4
        FOR UPDATE`,
      [context.tenantId, context.workId, planId, evaluationId]);
      const row = stored.rows[0];
      if (!row) throw new Error("continuity_closure_evaluation_not_found");
      if (
        digest(row.plan) !== row.plan_digest ||
        digest(row.evaluation) !== row.evaluation_digest ||
        row.plan?.acceptance_contract?.intent_digest !== row.intent_digest ||
        row.evaluation?.closed !== true
      ) {
        throw new Error("continuity_core_join_local_integrity_failed");
      }
      const agents = await client.query(`SELECT task_id,agent_id,task_kind,status,report,report_digest,
          coordinator_session_fingerprint,native_session_fingerprint,native_presence_signature
        FROM core_continuity_native_agents
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3
        ORDER BY task_id`,
      [context.tenantId, context.workId, planId]);
      const release = {
        base_branch: releaseIntent.base_branch,
        delivery_branch: releaseIntent.delivery_branch,
        base_commit: releaseIntent.base_commit,
        head_commit: releaseIntent.head_commit,
        tree_sha: releaseIntent.tree_sha,
        diff_digest: releaseIntent.diff_digest,
        changed_files: releaseIntent.changed_files,
        delivery: releaseIntent.delivery,
        rollback: releaseIntent.rollback,
      };
      const material = buildCoreJoinMaterial({
        tenantId: context.tenantId,
        workId: context.workId,
        plan: row.plan,
        planDigest: row.plan_digest,
        agents: agents.rows,
        evaluation: row.evaluation,
        evaluationDigest: row.evaluation_digest,
        release,
        attestationSigningSecret: assignmentSigningSecret,
      });
      const expectedReleaseIntent = {
        schema_version: "host_release_intent_v1",
        tenant_id: context.tenantId,
        ...material.release_intent_request,
      };
      const expectedReleaseIntentDigest = digest(expectedReleaseIntent);
      if (
        releaseIntent.release_intent_digest !== expectedReleaseIntentDigest ||
        JSON.stringify(stable(releaseIntent)) !== JSON.stringify(stable({
          ...expectedReleaseIntent,
          release_intent_digest: expectedReleaseIntentDigest,
        }))
      ) {
        throw new Error("continuity_core_release_intent_binding_mismatch");
      }
      const verdict = requireObject(coreJoinRecord.verdict, "core_join_verdict");
      const expectedClaim = {
        tenant_id: context.tenantId,
        ...material.core_join_request,
        release_intent_digest: expectedReleaseIntentDigest,
        base_branch: expectedReleaseIntent.base_branch,
        ...(verdict.schema_version === "host_native_core_join_v2"
          ? { software_closure_digest: releaseField(verdict.software_closure_digest,
              "software_closure_digest", /^[a-f0-9]{64}$/, 64),
            software_closure_fresh_until: dateValue(verdict.software_closure_fresh_until, "software_closure_fresh_until").toISOString() }
          : {}),
        ...(row.plan.core_authority?.required_checks_policy_digest
          ? {
              required_checks_policy_digest:
                row.plan.core_authority.required_checks_policy_digest,
            }
          : {}),
      };
      const expectedClaimDigest = digest({
        schema_version: verdict.schema_version === "host_native_core_join_v2"
          ? "host_native_core_join_claim_v2"
          : "host_native_core_join_claim_v1",
        ...expectedClaim,
      });
      const verdictId = String(verdict.verdict_id || "");
      const issuedAt = dateValue(verdict.issued_at, "core_join_issued_at");
      const expiresAt = dateValue(verdict.expires_at, "core_join_expires_at");
      if (
        coreJoinRecord.schema_version !== "host_native_core_join_record_v1" ||
        coreJoinRecord.tenant_id !== context.tenantId ||
        coreJoinRecord.state !== "active" ||
        !["host_native_core_join_v1", "host_native_core_join_v2"].includes(verdict.schema_version) ||
        verdict.authority !== "universal_core" ||
        verdict.allowed !== true ||
        verdict.provider_execution !== false ||
        !/^hnj_[a-f0-9]{64}$/.test(String(verdict.signature || ""))
      ) {
        throw new Error("continuity_core_join_verdict_invalid");
      }
      if (
        coreJoinRecord.claim_digest !== expectedClaimDigest ||
        verdictId !== `hnj_${expectedClaimDigest.slice(0, 40)}` ||
        verdict.claim_digest !== expectedClaimDigest
      ) {
        throw new Error("continuity_core_join_claim_digest_mismatch");
      }
      if (
        JSON.stringify(stable(Object.fromEntries(Object.keys(expectedClaim)
          .map((key) => [key, verdict[key]])))) !== JSON.stringify(stable(expectedClaim))
      ) {
        throw new Error("continuity_core_join_claim_payload_mismatch");
      }
      if (
        expiresAt.getTime() <= nowDate().getTime() ||
        issuedAt.getTime() > expiresAt.getTime()
      ) {
        throw new Error("continuity_core_join_verdict_expired");
      }
      const releaseIntentDigest = expectedReleaseIntentDigest;
      const coreJoinRecordDigest = digest(coreJoinRecord);
      const existing = await client.query(`SELECT verdict_id,release_intent_digest,
          core_join_record_digest
        FROM core_continuity_release_joins
        WHERE tenant_id=$1 AND evaluation_id=$2`,
      [context.tenantId, evaluationId]);
      if (existing.rows[0]) {
        if (
          existing.rows[0].verdict_id !== verdictId ||
          existing.rows[0].release_intent_digest !== releaseIntentDigest ||
          existing.rows[0].core_join_record_digest !== coreJoinRecordDigest
        ) {
          throw new Error("continuity_core_join_replay_conflict");
        }
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          plan_id: planId,
          evaluation_id: evaluationId,
          verdict_id: verdictId,
          release_intent_digest: releaseIntentDigest,
          core_join_record_digest: coreJoinRecordDigest,
          release_ready: true,
          idempotent_replay: true,
        };
      }
      await client.query(`INSERT INTO core_continuity_release_joins
        (tenant_id,work_id,plan_id,evaluation_id,verdict_id,release_intent,
         release_intent_digest,core_join_record,core_join_record_digest,created_by)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10)`,
      [context.tenantId, context.workId, planId, evaluationId, verdictId,
        JSON.stringify(releaseIntent), releaseIntentDigest, JSON.stringify(coreJoinRecord),
        coreJoinRecordDigest, context.actor]);
      await client.query(`UPDATE core_continuity_native_plans SET status='verified'
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3`,
      [context.tenantId, context.workId, planId]);
      await client.query(`UPDATE core_continuity_works
        SET status='release_ready',
          next_action='Use the persisted Core Join to obtain the exact action ticket, execute through host policy, then verify live readback.',
          updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2`,
      [context.tenantId, context.workId]);
      const event = await appendEvent(client, context, "core_join_issued", {
        plan_id: planId,
        evaluation_id: evaluationId,
        evaluation_digest: row.evaluation_digest,
        verdict_id: verdictId,
        claim_digest: expectedClaimDigest,
        release_intent_digest: releaseIntentDigest,
        core_join_record_digest: coreJoinRecordDigest,
      });
      return {
        schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
        tenant_id: context.tenantId,
        work_id: context.workId,
        plan_id: planId,
        evaluation_id: evaluationId,
        verdict_id: verdictId,
        claim_digest: expectedClaimDigest,
        release_intent_digest: releaseIntentDigest,
        core_join_record_digest: coreJoinRecordDigest,
        release_ready: true,
        event,
      };
    });
  }

  // Final completion is deliberately separate from local agent verification.
  // The only caller-controlled release reference is the one-shot ticket ID.
  // Every completion fact below comes from the authenticated Universal Core
  // receipt after Core performs its own GitHub, CI, Render and rollback
  // readback. The MCP cannot verify Core's HMAC secret, but it verifies the
  // complete canonical binding before projecting the signed receipt locally.
  async function finalizeClosure(identity, input, authorization) {
    const allowedInputFields = new Set([
      "work_id", "plan_id", "action_ticket_id", "idempotency_key",
      "agent_id", "client_type", "session_id",
    ]);
    if (Object.keys(input || {}).some((field) => !allowedInputFields.has(field))) {
      throw new Error("continuity_finalize_fields_invalid");
    }
    const context = workContext(identity, input);
    const planId = uuid(input.plan_id, "plan_id");
    const actionTicketId = identifier(
      input.action_ticket_id,
      "action_ticket_id",
      164,
    );
    if (!/^hnt_[a-zA-Z0-9-]{8,160}$/.test(actionTicketId)) {
      throw new Error("continuity_external_release_ticket_invalid");
    }
    const receipt = requireObject(authorization, "core_finalize_authorization");
    const coordinatorSessionFingerprint = String(identity.agentPresence?.session_fingerprint || "");
    if (!/^[a-f0-9]{16,64}$/i.test(coordinatorSessionFingerprint)) {
      throw new Error("native_agent_coordinator_presence_required");
    }
    const targetCommit = String(receipt.target_commit || "").toLowerCase();
    const issuedAt = dateValue(receipt.issued_at, "core_finalize_issued_at");
    const expiresAt = dateValue(receipt.expires_at, "core_finalize_expires_at");
    const currentTime = nowDate().getTime();
    const digestFields = [
      "action_ticket_digest",
      "release_manifest_digest",
      "release_intent_digest",
      "core_join_verdict_digest",
      "core_join_resolution_digest",
      "evidence_digest",
      "host_result_digest",
      "host_readback_digest",
      "external_readback_digest",
      "readback_digest",
      "authorization_digest",
    ];
    if (
      receipt.schema_version !== "host_native_finalize_authorization_v1" ||
      receipt.trusted !== true ||
      receipt.allowed !== true ||
      receipt.decision !== "ALLOW_FINALIZE" ||
      receipt.decision_id !== actionTicketId ||
      receipt.tenant_id !== context.tenantId ||
      receipt.work_id !== context.workId ||
      receipt.action_ticket_id !== actionTicketId ||
      !/^[a-f0-9]{40}$/.test(targetCommit) ||
      !/^hnj_[a-f0-9]{40}$/.test(String(receipt.core_join_verdict_id || "")) ||
      !/^hnf_[a-f0-9]{64}$/.test(String(receipt.signature || "")) ||
      digestFields.some((field) => !/^[a-f0-9]{64}$/.test(String(receipt[field] || ""))) ||
      receipt.result_commit_verified !== true ||
      receipt.host_session_fingerprint !== coordinatorSessionFingerprint ||
      !NATIVE_HOST_TYPES.has(String(receipt.host_kind || "")) ||
      receipt.host_policy_override !== false ||
      receipt.host_policy_must_allow !== true ||
      receipt.external_execution_allowed !== false ||
      receipt.host_execution_required !== true ||
      receipt.provider_execution !== false ||
      (
        receipt.previous_authorization_digest !== undefined &&
        !/^[a-f0-9]{64}$/.test(String(receipt.previous_authorization_digest || ""))
      ) ||
      receipt.readback_source !== "core_server_external_readback_v1" ||
      !["verified_completion", "reconciled_readback"].includes(receipt.outcome_source) ||
      issuedAt.getTime() > currentTime + 5 * 60 * 1_000 ||
      expiresAt.getTime() <= currentTime ||
      issuedAt.getTime() >= expiresAt.getTime()
    ) {
      throw new Error("continuity_trusted_core_closure_receipt_required");
    }
    const {
      signature: _signature,
      authorization_digest: suppliedAuthorizationDigest,
      ...unsignedWithDigest
    } = receipt;
    if (
      digest(unsignedWithDigest) !== suppliedAuthorizationDigest ||
      receipt.external_readback_digest !== receipt.readback_digest
    ) {
      throw new Error("continuity_core_closure_receipt_integrity_failed");
    }
    return transaction(async (client) => withIdempotency(
      client,
      context,
      input.idempotency_key,
      "native_closure_finalize",
      {
        work_id: context.workId,
        plan_id: planId,
        action_ticket_id: actionTicketId,
        authorization_digest: suppliedAuthorizationDigest,
      },
      async () => {
        await lockWorkRow(client, context);
        const joined = await client.query(`SELECT
            p.plan,p.plan_digest,p.status,
            e.evaluation_id,e.evaluation,e.evaluation_digest,
            j.verdict_id,j.release_intent,j.release_intent_digest,
            j.core_join_record,j.core_join_record_digest
          FROM core_continuity_native_plans p
          JOIN core_continuity_release_joins j
            ON j.tenant_id=p.tenant_id AND j.work_id=p.work_id AND j.plan_id=p.plan_id
          JOIN core_continuity_closure_evaluations e
            ON e.tenant_id=j.tenant_id AND e.evaluation_id=j.evaluation_id
          WHERE p.tenant_id=$1 AND p.work_id=$2 AND p.plan_id=$3
          ORDER BY j.created_at DESC LIMIT 1 FOR UPDATE`,
        [context.tenantId, context.workId, planId]);
        const row = joined.rows[0];
        if (!row) throw new Error("continuity_core_join_required");
        const {
          release_intent_digest: embeddedReleaseIntentDigest,
          ...unsignedReleaseIntent
        } = row.release_intent || {};
        if (
          row.status !== "verified" ||
          digest(row.plan) !== row.plan_digest ||
          row.evaluation?.closed !== true ||
          digest(row.evaluation) !== row.evaluation_digest ||
          embeddedReleaseIntentDigest !== row.release_intent_digest ||
          digest(unsignedReleaseIntent) !== row.release_intent_digest ||
          digest(row.core_join_record) !== row.core_join_record_digest
        ) {
          throw new Error("native_agent_plan_not_release_ready");
        }
        const planHostType = String(row.plan.host_type || "");
        const receiptHostKind = String(receipt.host_kind || "");
        const sameNativeHost =
          NATIVE_HOST_TYPES.has(planHostType) &&
          planHostType === receiptHostKind;
        const transportSessionFingerprint = String(
          identity.agentPresence?.host_transport_session_fingerprint || "",
        );
        const sessionBoundChatgptToCodexHandoff =
          planHostType === "chatgpt_native" &&
          receiptHostKind === "codex_native" &&
          identity.agentPresence?.transport_bound === true &&
          /^[a-f0-9]{16,64}$/i.test(transportSessionFingerprint) &&
          row.plan.coordinator_session_fingerprint ===
            transportSessionFingerprint;
        if (
          (!sameNativeHost && !sessionBoundChatgptToCodexHandoff) ||
          row.plan.core_authority?.repository !== receipt.repository ||
          row.release_intent.repository !== receipt.repository ||
          row.release_intent.work_id !== context.workId ||
          row.release_intent.tenant_id !== context.tenantId
        ) {
          throw new Error("continuity_host_policy_scope_mismatch");
        }
        const verdict = requireObject(
          row.core_join_record?.verdict,
          "persisted_core_join_verdict",
        );
        const coreJoinClaim = requireObject(
          row.core_join_record?.claim,
          "persisted_core_join_claim",
        );
        const closureEvidenceDigest = row.evaluation_digest;
        if (
          row.verdict_id !== receipt.core_join_verdict_id ||
          verdict.verdict_id !== row.verdict_id ||
          verdict.claim_digest !== row.core_join_record.claim_digest ||
          row.core_join_record.claim_digest !==
            receipt.core_join_verdict_digest ||
          row.release_intent_digest !== receipt.release_intent_digest ||
          coreJoinClaim.evaluation_digest !== closureEvidenceDigest ||
          coreJoinClaim.checks?.evidence_digest !== closureEvidenceDigest ||
          row.release_intent.verification?.evidence_digest !==
            closureEvidenceDigest ||
          receipt.evidence_digest !== closureEvidenceDigest ||
          row.release_intent.head_commit !== row.evaluation.target_commit ||
          receipt.github_readback?.checks_commit !== row.evaluation.target_commit ||
          receipt.github_readback?.checks_passed !== true ||
          receipt.github_readback?.rollback_commit_available !== true ||
          JSON.stringify([...(receipt.github_readback?.required_checks || [])].sort()) !==
            JSON.stringify([...(row.evaluation.required_checks || [])].sort())
        ) {
          throw new Error("continuity_external_release_authorization_mismatch");
        }
        const changedFiles = [...(row.release_intent.changed_files || [])].sort();
        if (
          !changedFiles.length ||
          JSON.stringify([...(receipt.changed_files || [])].sort()) !==
            JSON.stringify(changedFiles)
        ) {
          throw new Error("continuity_external_release_changed_files_mismatch");
        }
        const expectedServices = [...(row.release_intent.delivery?.services || [])]
          .sort((left, right) =>
            `${left.service_id}:${left.environment}`.localeCompare(
              `${right.service_id}:${right.environment}`,
            ));
        const liveServices = [...(Array.isArray(receipt.live_services)
          ? receipt.live_services
          : [])].sort((left, right) =>
          `${left.service_id}:${left.environment}`.localeCompare(
            `${right.service_id}:${right.environment}`,
          ));
        if (
          !expectedServices.length ||
          liveServices.length !== expectedServices.length ||
          expectedServices.some((expected, index) => {
            const live = liveServices[index];
            return (
              live?.service_id !== expected.service_id ||
              live?.environment !== expected.environment ||
              live?.live_commit !== targetCommit ||
              live?.health_status !== "healthy" ||
              live?.health_contract_digest !== expected.health_contract_digest ||
              live?.rollback_commit !== row.release_intent.rollback?.target_commit ||
              live?.rollback_status !== "previous_live_attested" ||
              !/^[a-f0-9]{64}$/.test(String(live?.readback_digest || "")) ||
              (
                expected.target_resolution === "exact_commit" &&
                expected.target_commit !== targetCommit
              )
            );
          })
        ) {
          throw new Error("continuity_live_verification_required");
        }
        const finalReceipt = await insertNativeReceipt(client, context, {
          plan_id: planId,
          receipt_type: "closure_finalized",
          host_type: receipt.host_kind,
          coordinator_session_fingerprint: coordinatorSessionFingerprint,
          payload: {
            core_decision_id: receipt.decision_id,
            target_commit: targetCommit,
            services: liveServices,
            readback_at: receipt.issued_at,
            health_ok: true,
            rollback_ready: true,
            host_type: receipt.host_kind,
            host_policy_allowed: true,
            closure_evaluation_id: row.evaluation_id,
            closure_evaluation_digest: row.evaluation_digest,
            external_release: true,
            action_ticket_id: actionTicketId,
            action_ticket_digest: receipt.action_ticket_digest,
            release_manifest_digest: receipt.release_manifest_digest,
            release_intent_digest: receipt.release_intent_digest,
            core_join_verdict_id: receipt.core_join_verdict_id,
            core_join_verdict_digest: receipt.core_join_verdict_digest,
            core_join_resolution_digest: receipt.core_join_resolution_digest,
            host_readback_digest: receipt.host_readback_digest,
            external_readback_digest: receipt.external_readback_digest,
            authorization_digest: suppliedAuthorizationDigest,
            authorization_signature: receipt.signature,
          },
        });
        await client.query(`UPDATE core_continuity_native_plans SET status='closed',closed_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3`,
        [context.tenantId, context.workId, planId]);
        await client.query(`UPDATE core_continuity_works
          SET status='completed',next_action='',live_state_hash=$3,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`,
        [context.tenantId, context.workId, digest({
          repository: receipt.repository,
          commit_sha: targetCommit,
          services: liveServices.map((service) => ({
            service_id: service.service_id,
            environment: service.environment,
            live_commit: service.live_commit,
            health_status: service.health_status,
            rollback_commit: service.rollback_commit,
          })),
          external_readback_digest: receipt.external_readback_digest,
        })]);
        const event = await appendEvent(client, context, "closure_finalized", {
          plan_id: planId,
          finalized: true,
          core_decision_id: receipt.decision_id,
          target_commit: targetCommit,
          live_health_ok: true,
          external_release: true,
          action_ticket_id: actionTicketId,
          action_ticket_digest: receipt.action_ticket_digest,
          release_manifest_digest: receipt.release_manifest_digest,
          release_intent_digest: receipt.release_intent_digest,
          core_join_verdict_id: receipt.core_join_verdict_id,
          core_join_verdict_digest: receipt.core_join_verdict_digest,
          core_join_resolution_digest: receipt.core_join_resolution_digest,
          host_readback_digest: receipt.host_readback_digest,
          external_readback_digest: receipt.external_readback_digest,
          authorization_digest: suppliedAuthorizationDigest,
          final_receipt_digest: finalReceipt.payload_digest,
        });
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          plan_id: planId,
          completed: true,
          external_release: true,
          target_commit: targetCommit,
          core_decision_id: receipt.decision_id,
          action_ticket_id: actionTicketId,
          release_manifest_digest: receipt.release_manifest_digest,
          release_intent_digest: receipt.release_intent_digest,
          external_readback_digest: receipt.external_readback_digest,
          final_receipt: finalReceipt,
          event,
        };
      },
    ));
  }

  async function upsertAtlas(identity, input) {
    const context = workContext(identity, input);
    const nodesInput = Array.isArray(input.nodes) ? input.nodes : [];
    const edgesInput = Array.isArray(input.edges) ? input.edges : [];
    if (!nodesInput.length || nodesInput.length > 500) throw new Error("work_atlas_nodes_invalid");
    if (edgesInput.length > 2_000) throw new Error("work_atlas_edges_invalid");
    const nodes = nodesInput.map((node) => {
      requireObject(node, "work_atlas_node");
      const nodeId = identifier(node.node_id, "node_id", 160);
      const nodeKind = identifier(node.kind || node.node_kind, "node_kind", 60);
      const summary = safeText(node.summary, 4_000);
      const metadata = cleanJson(node.metadata || {}, 20_000);
      const normalized = {
        node_id: nodeId,
        node_kind: nodeKind,
        path: safeText(node.path, 2_000),
        symbol: safeText(node.symbol, 500),
        summary,
        metadata,
        source_kind: identifier(node.source_kind || "work_atlas", "source_kind", 80),
        source_ref: safeText(node.source_ref || node.path || nodeId, 2_000),
        provenance: cleanJson(node.provenance || {}, 20_000),
        verification_state: ["observed", "inferred_candidate", "verified", "contradicted", "stale"].includes(node.verification_state) ? node.verification_state : "observed",
        confidence: Math.max(0, Math.min(1, Number(node.confidence ?? 0.5))),
      };
      return {
        ...normalized,
        node_digest: digest(normalized),
        context_bytes: Buffer.byteLength(JSON.stringify(normalized)),
      };
    });
    const nodeIds = new Set(nodes.map((node) => node.node_id));
    const edges = edgesInput.map((edge) => {
      requireObject(edge, "work_atlas_edge");
      const normalized = {
        from_node_id: identifier(edge.from_node_id, "from_node_id", 160),
        to_node_id: identifier(edge.to_node_id, "to_node_id", 160),
        edge_type: identifier(edge.edge_type || "depends_on", "edge_type", 60),
        provenance: cleanJson(edge.provenance || {}, 20_000),
        verification_state: ["observed", "inferred_candidate", "verified", "contradicted", "stale"].includes(edge.verification_state) ? edge.verification_state : "observed",
        confidence: Math.max(0, Math.min(1, Number(edge.confidence ?? 0.5))),
      };
      if ((!nodeIds.has(normalized.from_node_id) || !nodeIds.has(normalized.to_node_id)) &&
          (!input.allow_existing_edge_nodes || input.replace === true)) {
        throw new Error("work_atlas_edge_node_missing");
      }
      return normalized;
    });
    return transaction(async (client) => withIdempotency(
      client,
      context,
      input.idempotency_key,
      "work_atlas_upsert",
      input,
      async () => {
        const work = await client.query(`SELECT project_id FROM core_continuity_works
          WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [context.tenantId, context.workId]);
        if (!work.rows[0]) throw new Error("continuity_work_not_found");
        const referencedExistingNodeIds = [...new Set(edges.flatMap((edge) =>
          [edge.from_node_id, edge.to_node_id].filter((nodeId) => !nodeIds.has(nodeId))))];
        if (referencedExistingNodeIds.length) {
          const existingNodes = await client.query(`SELECT node_id FROM core_continuity_atlas_nodes
            WHERE tenant_id=$1 AND work_id=$2 AND active=true AND node_id=ANY($3::varchar[])`,
          [context.tenantId, context.workId, referencedExistingNodeIds]);
          const found = new Set(existingNodes.rows.map((row) => row.node_id));
          if (referencedExistingNodeIds.some((nodeId) => !found.has(nodeId))) {
            throw new Error("work_atlas_edge_node_missing");
          }
        }
        await client.query(`INSERT INTO core_continuity_atlas_state
          (tenant_id,work_id,project_id,revision,total_nodes,total_context_bytes)
          VALUES ($1,$2,$3,0,0,0) ON CONFLICT (tenant_id,work_id) DO NOTHING`,
        [context.tenantId, context.workId, work.rows[0].project_id]);
        const state = await client.query(`SELECT revision FROM core_continuity_atlas_state
          WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [context.tenantId, context.workId]);
        const currentRevision = Number(state.rows[0]?.revision || 0);
        if (input.expected_revision !== undefined && Number(input.expected_revision) !== currentRevision) {
          throw new Error("work_atlas_revision_conflict");
        }
        const revision = currentRevision + 1;
        if (input.replace === true) {
          await client.query(`UPDATE core_continuity_atlas_nodes SET active=false,revision=$3,tombstoned_at=clock_timestamp(),updated_at=clock_timestamp()
            WHERE tenant_id=$1 AND work_id=$2`, [context.tenantId, context.workId, revision]);
          await client.query(`UPDATE core_continuity_atlas_edges
            SET active=false,revision=$3,tombstoned_at=clock_timestamp(),updated_at=clock_timestamp()
            WHERE tenant_id=$1 AND work_id=$2 AND active=true`, [context.tenantId, context.workId, revision]);
        }
        let changedNodes = 0;
        for (const node of nodes) {
          const written = await client.query(`INSERT INTO core_continuity_atlas_nodes
            (tenant_id,work_id,project_id,node_id,node_kind,path,symbol,summary,node_digest,context_bytes,metadata,revision,active,
             source_kind,source_ref,source_digest,provenance,verification_state,confidence,tombstoned_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,true,$13,$14,$9,$15::jsonb,$16,$17,NULL)
            ON CONFLICT (tenant_id,work_id,node_id) DO UPDATE SET
              project_id=EXCLUDED.project_id,node_kind=EXCLUDED.node_kind,path=EXCLUDED.path,symbol=EXCLUDED.symbol,
              summary=EXCLUDED.summary,node_digest=EXCLUDED.node_digest,
              context_bytes=EXCLUDED.context_bytes,metadata=EXCLUDED.metadata,
              revision=EXCLUDED.revision,active=true,source_kind=EXCLUDED.source_kind,source_ref=EXCLUDED.source_ref,
              source_digest=EXCLUDED.source_digest,provenance=EXCLUDED.provenance,verification_state=EXCLUDED.verification_state,
              confidence=EXCLUDED.confidence,tombstoned_at=NULL,updated_at=clock_timestamp()
            WHERE core_continuity_atlas_nodes.node_digest IS DISTINCT FROM EXCLUDED.node_digest
               OR core_continuity_atlas_nodes.active=false
            RETURNING node_id`,
          [context.tenantId, context.workId, work.rows[0].project_id, node.node_id, node.node_kind, node.path, node.symbol,
            node.summary, node.node_digest, node.context_bytes, JSON.stringify(node.metadata), revision, node.source_kind,
            node.source_ref, JSON.stringify(node.provenance), node.verification_state, node.confidence]);
          changedNodes += Number(written.rowCount ?? written.rows.length);
        }
        for (const edge of edges) {
          await client.query(`INSERT INTO core_continuity_atlas_edges
            (tenant_id,work_id,project_id,from_node_id,to_node_id,edge_type,revision,edge_id,edge_digest,source,provenance,verification_state,confidence,active,tombstoned_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,true,NULL)
            ON CONFLICT (tenant_id,work_id,from_node_id,to_node_id,edge_type)
            DO UPDATE SET project_id=EXCLUDED.project_id,revision=EXCLUDED.revision,edge_id=EXCLUDED.edge_id,
              edge_digest=EXCLUDED.edge_digest,source=EXCLUDED.source,provenance=EXCLUDED.provenance,
              verification_state=EXCLUDED.verification_state,confidence=EXCLUDED.confidence,active=true,tombstoned_at=NULL,updated_at=clock_timestamp()`,
          [context.tenantId, context.workId, work.rows[0].project_id, edge.from_node_id, edge.to_node_id, edge.edge_type, revision,
            `sce_${digest({ tenant_id: context.tenantId, work_id: context.workId, ...edge }).slice(0, 48)}`,
            digest({ tenant_id: context.tenantId, work_id: context.workId, ...edge }), "software_cognition_v1",
            JSON.stringify(edge.provenance), edge.verification_state, edge.confidence]);
        }
        const totals = await client.query(`SELECT count(*)::bigint AS total_nodes,
            COALESCE(sum(context_bytes),0)::bigint AS total_context_bytes
          FROM core_continuity_atlas_nodes WHERE tenant_id=$1 AND work_id=$2 AND active=true`,
        [context.tenantId, context.workId]);
        const totalNodes = Number(totals.rows[0]?.total_nodes || 0);
        const totalContextBytes = Number(totals.rows[0]?.total_context_bytes || 0);
        const sourceHash = input.source_hash || digest(nodes.map((node) => node.node_digest));
        if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error("work_atlas_source_hash_invalid");
        await client.query(`UPDATE core_continuity_atlas_state
          SET revision=$3,total_nodes=$4,total_context_bytes=$5,source_hash=$6,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`,
        [context.tenantId, context.workId, revision, totalNodes, totalContextBytes, sourceHash]);
        await client.query(`INSERT INTO core_continuity_atlas_revision_history
          (tenant_id,work_id,project_id,revision,source_digest,base_commit,head_commit,node_count,edge_count,provenance)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [context.tenantId, context.workId, work.rows[0].project_id,
          revision, sourceHash, input.base_commit || null, input.head_commit || null, totalNodes, edges.length,
          JSON.stringify({ actor: context.actor, incremental: input.replace !== true })]);
        const event = await appendEvent(client, context, "atlas_updated", {
          revision,
          source_hash: sourceHash,
          changed_nodes: changedNodes,
          submitted_nodes: nodes.length,
          submitted_edges: edges.length,
          total_nodes: totalNodes,
          total_context_bytes: totalContextBytes,
          incremental: input.replace !== true,
        });
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          revision,
          changed_nodes: changedNodes,
          submitted_nodes: nodes.length,
          submitted_edges: edges.length,
          total_nodes: totalNodes,
          total_context_bytes: totalContextBytes,
          full_scan_performed: false,
          event,
        };
      },
    ));
  }

  async function selectAtlas(identity, input) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const workId = input.work_id ? uuid(input.work_id, "work_id") : null;
    const requestedProjectId = input.project_id
      ? identifier(input.project_id, "project_id", 64)
      : null;
    let projectId = requestedProjectId;
    if (!workId && !projectId) throw new Error("work_atlas_scope_required");
    const seedNodeIds = stringList(input.seed_node_ids, "seed_node_ids", {
      maxItems: 50,
      maxLength: 160,
    });
    if (!seedNodeIds.length) throw new Error("work_atlas_seed_required");
    const maxDepth = Math.min(Math.max(Number(input.max_depth) || 1, 0), 4);
    const maxNodes = Math.min(Math.max(Number(input.max_nodes) || 200, 1), 500);
    const edgeTypes = input.edge_types === undefined ? null : stringList(input.edge_types, "edge_types", { maxItems: 40, maxLength: 60 });
    if (edgeTypes && !edgeTypes.length) throw new Error("work_atlas_edge_types_invalid");

    // An explicit work remains an exact snapshot lookup. Project selection is
    // a separate aggregate projection below and never silently substitutes
    // the latest work for the requested project.
    if (workId) {
      const state = await pool.query(`SELECT project_id,revision,total_nodes,total_context_bytes,source_hash
        FROM core_continuity_atlas_state WHERE tenant_id=$1 AND work_id=$2`, [tenantId, workId]);
      if (!state.rows[0]) throw new Error("work_atlas_not_found");
      if (projectId && state.rows[0].project_id !== projectId) throw new Error("work_atlas_project_scope_mismatch");
      projectId = state.rows[0].project_id;
      const candidates = await pool.query(`WITH RECURSIVE selected(node_id,depth) AS (
          SELECT unnest($3::varchar[])::varchar,0
          UNION
          SELECT CASE WHEN e.from_node_id=s.node_id THEN e.to_node_id ELSE e.from_node_id END,s.depth+1
          FROM selected s JOIN core_continuity_atlas_edges e
            ON e.tenant_id=$1 AND e.work_id=$2
           AND e.active=true
           AND ($5::varchar[] IS NULL OR e.edge_type=ANY($5::varchar[]))
           AND (e.from_node_id=s.node_id OR e.to_node_id=s.node_id)
          WHERE s.depth<$4
        )
        SELECT n.node_id,n.node_kind,n.path,n.symbol,n.summary,n.node_digest,n.context_bytes,
          n.metadata,min(s.depth)::integer AS depth
        FROM selected s JOIN core_continuity_atlas_nodes n
          ON n.tenant_id=$1 AND n.work_id=$2 AND n.node_id=s.node_id AND n.active=true
        GROUP BY n.node_id,n.node_kind,n.path,n.symbol,n.summary,n.node_digest,n.context_bytes,n.metadata
        ORDER BY min(s.depth),n.node_id`,
      [tenantId, workId, seedNodeIds, maxDepth, edgeTypes]);
      const selected = selectAtlasWithinBudget(candidates.rows.slice(0, maxNodes), {
        max_bytes: input.max_bytes,
        total_context_bytes: Number(state.rows[0].total_context_bytes || 0),
      });
      return {
        ...selected,
        tenant_id: tenantId,
        work_id: workId,
        last_work_id: workId,
        project_id: projectId,
        revision: Number(state.rows[0].revision || 0),
        source_hash: state.rows[0].source_hash || null,
        metrics: {
          ...selected.metrics,
          indexed_nodes: Number(state.rows[0].total_nodes || 0),
          seed_nodes: seedNodeIds.length,
          traversal_depth: maxDepth,
        },
      };
    }

    const states = await pool.query(`SELECT work_id,project_id,revision,total_nodes,total_context_bytes,
        source_hash,updated_at
      FROM core_continuity_atlas_state
      WHERE tenant_id=$1 AND project_id=$2
      ORDER BY updated_at DESC,work_id DESC`,
    [tenantId, projectId]);
    if (!states.rows.length) {
      const empty = selectAggregatedAtlasWithinBudget([], [], {
        max_bytes: input.max_bytes,
        total_context_bytes: 0,
      });
      return {
        ...empty,
        tenant_id: tenantId,
        work_id: null,
        last_work_id: null,
        project_id: projectId,
        revision: 0,
        source_hash: null,
        source_work_ids: [],
        aggregate: true,
        state: "discovery_required",
        discovery_required: true,
        discovery_reason: "work_atlas_project_not_indexed",
        metrics: {
          ...empty.metrics,
          indexed_nodes: 0,
          indexed_works: 0,
          seed_nodes: seedNodeIds.length,
          traversal_depth: maxDepth,
        },
      };
    }

    const totals = await pool.query(`WITH ranked_nodes AS (
        SELECT n.node_id,n.context_bytes,
          row_number() OVER (
            PARTITION BY n.node_id
            ORDER BY n.updated_at DESC,s.updated_at DESC,n.revision DESC,n.work_id DESC
          ) AS priority
        FROM core_continuity_atlas_nodes n
        JOIN core_continuity_atlas_state s
          ON s.tenant_id=n.tenant_id AND s.work_id=n.work_id
        WHERE n.tenant_id=$1 AND s.project_id=$2 AND n.active=true
      )
      SELECT count(*)::bigint AS total_nodes,
        COALESCE(sum(context_bytes),0)::bigint AS total_context_bytes
      FROM ranked_nodes WHERE priority=1`,
    [tenantId, projectId]);
    const candidates = await pool.query(`WITH RECURSIVE
      scoped_nodes AS (
        SELECT n.*,s.updated_at AS state_updated_at
        FROM core_continuity_atlas_nodes n
        JOIN core_continuity_atlas_state s
          ON s.tenant_id=n.tenant_id AND s.work_id=n.work_id
        WHERE n.tenant_id=$1 AND s.project_id=$2 AND n.active=true
      ),
      node_sources AS (
        SELECT node_id,array_agg(DISTINCT work_id ORDER BY work_id) AS source_work_ids
        FROM scoped_nodes GROUP BY node_id
      ),
      ranked_nodes AS (
        SELECT n.*,
          row_number() OVER (
            PARTITION BY n.node_id
            ORDER BY n.updated_at DESC,n.state_updated_at DESC,n.revision DESC,n.work_id DESC
          ) AS priority
        FROM scoped_nodes n
      ),
      latest_nodes AS (
        SELECT n.node_id,n.node_kind,n.path,n.symbol,n.summary,n.node_digest,
          n.context_bytes,n.metadata,s.source_work_ids
        FROM ranked_nodes n JOIN node_sources s USING (node_id)
        WHERE n.priority=1
      ),
      aggregate_edges AS (
        SELECT e.from_node_id,e.to_node_id,e.edge_type
        FROM core_continuity_atlas_edges e
        JOIN core_continuity_atlas_state s
          ON s.tenant_id=e.tenant_id AND s.work_id=e.work_id
        JOIN latest_nodes source ON source.node_id=e.from_node_id
        JOIN latest_nodes target ON target.node_id=e.to_node_id
        WHERE e.tenant_id=$1 AND s.project_id=$2
          AND e.active=true
          AND ($5::varchar[] IS NULL OR e.edge_type=ANY($5::varchar[]))
        GROUP BY e.from_node_id,e.to_node_id,e.edge_type
      ),
      selected(node_id,depth) AS (
        SELECT unnest($3::varchar[])::varchar,0
        UNION
        SELECT CASE WHEN e.from_node_id=s.node_id THEN e.to_node_id ELSE e.from_node_id END,s.depth+1
        FROM selected s JOIN aggregate_edges e
          ON e.from_node_id=s.node_id OR e.to_node_id=s.node_id
        WHERE s.depth<$4
      )
      SELECT n.node_id,n.node_kind,n.path,n.symbol,n.summary,n.node_digest,n.context_bytes,
        n.metadata,n.source_work_ids,min(s.depth)::integer AS depth
      FROM selected s JOIN latest_nodes n ON n.node_id=s.node_id
      GROUP BY n.node_id,n.node_kind,n.path,n.symbol,n.summary,n.node_digest,n.context_bytes,
        n.metadata,n.source_work_ids
      ORDER BY min(s.depth),n.node_id`,
    [tenantId, projectId, seedNodeIds, maxDepth, edgeTypes]);
    const boundedCandidates = candidates.rows.slice(0, maxNodes);
    const candidateNodeIds = boundedCandidates.map((node) => node.node_id);
    const aggregateEdges = candidateNodeIds.length
      ? await pool.query(`SELECT e.from_node_id,e.to_node_id,e.edge_type,
          array_agg(DISTINCT e.work_id ORDER BY e.work_id) AS source_work_ids
        FROM core_continuity_atlas_edges e
        JOIN core_continuity_atlas_state s
          ON s.tenant_id=e.tenant_id AND s.work_id=e.work_id
        WHERE e.tenant_id=$1 AND s.project_id=$2 AND e.active=true
          AND ($4::varchar[] IS NULL OR e.edge_type=ANY($4::varchar[]))
          AND e.from_node_id=ANY($3::varchar[]) AND e.to_node_id=ANY($3::varchar[])
        GROUP BY e.from_node_id,e.to_node_id,e.edge_type
        ORDER BY e.from_node_id,e.to_node_id,e.edge_type`,
      [tenantId, projectId, candidateNodeIds, edgeTypes])
      : { rows: [] };
    const selected = selectAggregatedAtlasWithinBudget(boundedCandidates, aggregateEdges.rows, {
      max_bytes: input.max_bytes,
      total_context_bytes: Number(totals.rows[0]?.total_context_bytes || 0),
    });
    const sourceStates = states.rows.map((state) => ({
      work_id: String(state.work_id),
      revision: Number(state.revision || 0),
      source_hash: state.source_hash || null,
    })).sort((a, b) => a.work_id.localeCompare(b.work_id));
    const sourceWorkIds = [...new Set(sourceStates.map((state) => state.work_id))].sort();
    const discoveryRequired = candidates.rows.length === 0;
    return {
      ...selected,
      tenant_id: tenantId,
      work_id: null,
      last_work_id: String(states.rows[0].work_id),
      project_id: projectId,
      revision: Math.max(...sourceStates.map((state) => state.revision), 0),
      source_hash: digest({
        schema_version: "work_atlas_project_aggregate_v1",
        tenant_id: tenantId,
        project_id: projectId,
        sources: sourceStates,
      }),
      revision_vector: sourceStates,
      project_revision_digest: digest({ tenant_id: tenantId, project_id: projectId, revision_vector: sourceStates }),
      source_work_ids: sourceWorkIds,
      aggregate: true,
      state: discoveryRequired ? "discovery_required" : "indexed",
      discovery_required: discoveryRequired,
      ...(discoveryRequired ? { discovery_reason: "work_atlas_seed_not_indexed" } : {}),
      metrics: {
        ...selected.metrics,
        indexed_nodes: Number(totals.rows[0]?.total_nodes || 0),
        indexed_works: sourceWorkIds.length,
        seed_nodes: seedNodeIds.length,
        traversal_depth: maxDepth,
      },
    };
  }

  async function readAtlasGraph(identity, input) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const workId = uuid(input.work_id, "work_id");
    const projectId = identifier(input.project_id, "project_id", 64);
    const state = await pool.query(`SELECT revision,source_hash,total_nodes,total_context_bytes FROM core_continuity_atlas_state
      WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3`, [tenantId, projectId, workId]);
    if (!state.rows[0]) throw new Error("work_atlas_not_found");
    const [nodes, edges] = await Promise.all([
      pool.query(`SELECT node_id,node_kind,source_ref,source_kind,source_digest,provenance,metadata,revision
        FROM core_continuity_atlas_nodes WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND active=true ORDER BY node_id`,
      [tenantId, projectId, workId]),
      pool.query(`SELECT edge_id,from_node_id,to_node_id,edge_type,edge_digest,source,provenance
        FROM core_continuity_atlas_edges WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND active=true ORDER BY edge_id`,
      [tenantId, projectId, workId]),
    ]);
    return {
      schema_version: "software_reality_graph_atlas_v1", tenant_id: tenantId, project_id: projectId, work_id: workId,
      revision: Number(state.rows[0].revision), source_digest: state.rows[0].source_hash,
      nodes: nodes.rows.map((row) => ({ tenant_id: tenantId, project_id: projectId, work_id: workId, node_id: row.node_id,
        kind: row.node_kind, source_ref: row.source_ref, source_kind: row.source_kind, provenance: row.provenance,
        payload: row.metadata, digest: row.source_digest, version: Number(row.revision), tombstoned: false })),
      edges: edges.rows.map((row) => ({ tenant_id: tenantId, project_id: projectId, work_id: workId, edge_id: row.edge_id,
        from_node_id: row.from_node_id, to_node_id: row.to_node_id, edge_type: row.edge_type,
        digest: row.edge_digest, source: row.source, provenance: row.provenance })),
      metrics: { total_nodes: Number(state.rows[0].total_nodes), total_context_bytes: Number(state.rows[0].total_context_bytes) },
    };
  }

  async function recordOperationalIncident(identity, input) {
    const context = workContext(identity, input);
    const operation = identifier(input.operation, "operational_incident_operation", 120);
    const errorCode = identifier(
      input.error_code,
      "operational_incident_error_code",
      120,
    ).toUpperCase();
    const evidenceDigest = String(input.evidence_digest || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(evidenceDigest)) {
      throw new Error("operational_incident_evidence_digest_invalid");
    }
    await initialize();
    const work = await pool.query(`SELECT project_id FROM core_continuity_works
      WHERE tenant_id=$1 AND work_id=$2`,
    [context.tenantId, context.workId]);
    if (!work.rows[0]) throw new Error("continuity_work_not_found");
    const projectId = identifier(work.rows[0].project_id, "project_id", 64);
    const latestPlan = await pool.query(`SELECT plan FROM core_continuity_native_plans
      WHERE tenant_id=$1 AND work_id=$2
      ORDER BY created_at DESC LIMIT 1`,
    [context.tenantId, context.workId]);
    const repository = safeText(
      latestPlan.rows[0]?.plan?.core_authority?.repository ||
        `project:${projectId}`,
      240,
    );
    const connector = operation === "work_continuity_closure_finalize"
      ? "universal-core-readback"
      : "host-native-coordination";
    const configurationDigest = digest({
      schema_version: "operational_incident_configuration_v1",
      tenant_id: context.tenantId,
      work_id: context.workId,
      project_id: projectId,
      repository,
      operation,
      error_code: errorCode,
      evidence_digest: evidenceDigest,
    });
    const incidentIdempotencyDigest = digest({
      work_id: context.workId,
      operation,
      error_code: errorCode,
      evidence_digest: evidenceDigest,
      configuration_digest: configurationDigest,
    });
    return recordIncident(identity, {
      work_id: context.workId,
      project_id: projectId,
      scope: {
        error_code: errorCode,
        repository,
        branch: "governed-work",
        connector,
        deployment_path: operation,
        configuration_digest: configurationDigest,
      },
      runbook: {
        title: `${operation}: ${errorCode}`,
        preconditions: [
          "Resume only the same tenant, work, persisted plan and exact failure fingerprint.",
          "Keep this candidate blocked until a distinct native verifier proves the correction.",
        ],
        steps: [
          "Read the immutable Intent Anchor, latest plan, agent receipts and indexed blocker.",
          "Correct only the bounded cause and rerun the exact required checks.",
          "Re-evaluate closure and obtain a fresh Universal Core Join before any release action.",
        ],
        verification: [
          "A distinct host-native verifier must approve the corrected commit and acceptance evidence.",
          "Universal Core must issue a fresh exact verdict; caller-provided success flags are invalid.",
        ],
        rollback: [
          "Keep the previous verified commit and health contract available until live closure.",
        ],
      },
      next_action: safeText(input.next_action, 4_000),
      idempotency_key: `incident-operational-${incidentIdempotencyDigest}`,
    });
  }

  // Incident scope is deliberately exact: the same error code on another
  // repository, branch, connector, deployment path or configuration digest is
  // a different fingerprint and cannot reuse a verified runbook.
  async function recordIncident(identity, input) {
    const context = workContext(identity, input);
    const projectId = identifier(input.project_id, "project_id", 64);
    const { fingerprint, scope } = incidentFingerprint(input.scope || input);
    const steps = stringList(input.runbook?.steps, "incident_runbook_steps", {
      maxItems: 30,
      maxLength: 2_000,
    });
    if (!steps.length) throw new Error("incident_runbook_steps_required");
    const runbook = cleanJson({
      schema_version: "incident_runbook_v1",
      title: safeText(input.runbook?.title, 500),
      preconditions: stringList(input.runbook?.preconditions, "incident_runbook_preconditions", {
        maxItems: 30,
        maxLength: 1_000,
      }),
      steps,
      verification: stringList(input.runbook?.verification, "incident_runbook_verification", {
        maxItems: 30,
        maxLength: 1_000,
      }),
      rollback: stringList(input.runbook?.rollback, "incident_runbook_rollback", {
        maxItems: 30,
        maxLength: 1_000,
      }),
      promotes_only_after_independent_verification: true,
    }, 100_000);
    const runbookDigest = digest(runbook);
    return transaction(async (client) => {
      const work = await client.query(`SELECT project_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [context.tenantId, context.workId]);
      if (!work.rows[0]) throw new Error("continuity_work_not_found");
      if (work.rows[0].project_id !== projectId) throw new Error("incident_project_scope_mismatch");
      const existing = await client.query(`SELECT runbook_digest,status,created_by
        FROM core_continuity_incident_runbooks
        WHERE tenant_id=$1 AND project_id=$2 AND fingerprint=$3 FOR UPDATE`,
      [context.tenantId, projectId, fingerprint]);
      const nextAction = safeText(
        input.next_action ||
          `Resume incident ${fingerprint.slice(0, 12)} from its indexed runbook; diagnose, correct, rerun exact checks, then obtain independent verification.`,
        4_000,
      );
      if (existing.rows[0]) {
        if (existing.rows[0].runbook_digest !== runbookDigest) throw new Error("incident_runbook_conflict");
        await client.query(`UPDATE core_continuity_works
          SET status='blocked',next_action=$3,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`,
        [context.tenantId, context.workId, nextAction]);
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          project_id: projectId,
          fingerprint,
          status: existing.rows[0].status,
          next_action: nextAction,
          idempotent_replay: true,
        };
      }
      await client.query(`INSERT INTO core_continuity_incident_runbooks
        (tenant_id,project_id,fingerprint,scope,runbook,runbook_digest,status,created_by)
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,'candidate',$7)`,
      [context.tenantId, projectId, fingerprint, JSON.stringify(scope), JSON.stringify(runbook),
        runbookDigest, context.actor]);
      await client.query(`UPDATE core_continuity_works
        SET status='blocked',next_action=$3,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2`,
      [context.tenantId, context.workId, nextAction]);
      const event = await appendEvent(client, context, "incident_recorded", {
        project_id: projectId,
        fingerprint,
        runbook_digest: runbookDigest,
        status: "candidate",
        next_action: nextAction,
      });
      return {
        schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
        tenant_id: context.tenantId,
        work_id: context.workId,
        project_id: projectId,
        fingerprint,
        scope,
        runbook_digest: runbookDigest,
        status: "candidate",
        next_action: nextAction,
        event,
      };
    });
  }

  // resolved=true promotes only with independent test evidence. resolved=false
  // records a failed reuse and quarantines the recipe after two failures.
  async function verifyIncident(identity, input) {
    const context = workContext(identity, input);
    const projectId = identifier(input.project_id, "project_id", 64);
    const fingerprint = String(input.fingerprint || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("incident_fingerprint_invalid");
    const resolved = input.resolved === true;
    const tests = Array.isArray(input.tests) ? cleanJson(input.tests.slice(0, 100), 80_000) : [];
    const evidenceRefs = stringList(input.evidence_refs, "incident_evidence_refs", {
      maxItems: 100,
      maxLength: 500,
    });
    return transaction(async (client) => {
      const work = await client.query(`SELECT project_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`,
      [context.tenantId, context.workId]);
      if (!work.rows[0]) throw new Error("continuity_work_not_found");
      if (work.rows[0].project_id !== projectId) throw new Error("incident_project_scope_mismatch");
      const current = await client.query(`SELECT created_by,status,verification_count,failure_count
        FROM core_continuity_incident_runbooks
        WHERE tenant_id=$1 AND project_id=$2 AND fingerprint=$3 FOR UPDATE`,
      [context.tenantId, projectId, fingerprint]);
      const row = current.rows[0];
      if (!row) throw new Error("incident_runbook_not_found");
      if (resolved) {
        if (row.status === "quarantined") throw new Error("incident_runbook_quarantined");
        if (row.created_by === context.actor) throw new Error("incident_independent_verifier_required");
        if (!tests.length || !tests.some((test) => test?.passed === true) || !evidenceRefs.length) {
          throw new Error("incident_verification_evidence_required");
        }
        const evidence = cleanJson({ tests, evidence_refs: evidenceRefs, resolved: true }, 100_000);
        await client.query(`UPDATE core_continuity_incident_runbooks
          SET status='verified',verified_by=$4,verification_evidence=$5::jsonb,
            verification_count=verification_count+1,updated_at=now()
          WHERE tenant_id=$1 AND project_id=$2 AND fingerprint=$3`,
        [context.tenantId, projectId, fingerprint, context.actor, JSON.stringify(evidence)]);
        const nextAction =
          `Incident ${fingerprint.slice(0, 12)} independently verified; resume the indexed work from the last checkpoint and re-evaluate closure.`;
        await client.query(`UPDATE core_continuity_works
          SET status='active',next_action=$3,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`,
        [context.tenantId, context.workId, nextAction]);
        const event = await appendEvent(client, context, "incident_runbook_verified", {
          project_id: projectId,
          fingerprint,
          verifier: context.actor,
          evidence_digest: digest(evidence),
        });
        return {
          schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
          tenant_id: context.tenantId,
          work_id: context.workId,
          project_id: projectId,
          fingerprint,
          status: "verified",
          promoted: true,
          next_action: nextAction,
          event,
        };
      }
      const failures = Number(row.failure_count || 0) + 1;
      const status = failures >= 2 ? "quarantined" : "candidate";
      await client.query(`UPDATE core_continuity_incident_runbooks
        SET status=$4,failure_count=$5,updated_at=now()
        WHERE tenant_id=$1 AND project_id=$2 AND fingerprint=$3`,
      [context.tenantId, projectId, fingerprint, status, failures]);
      const nextAction = status === "quarantined"
        ? `Incident ${fingerprint.slice(0, 12)} runbook quarantined; perform a fresh diagnosis and create a corrected candidate.`
        : `Incident ${fingerprint.slice(0, 12)} remains blocked; correct the failed recovery and request independent verification again.`;
      await client.query(`UPDATE core_continuity_works
        SET status='blocked',next_action=$3,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2`,
      [context.tenantId, context.workId, nextAction]);
      const event = status === "quarantined"
        ? await appendEvent(client, context, "incident_runbook_quarantined", {
          project_id: projectId,
          fingerprint,
          failure_count: failures,
        })
        : null;
      return {
        schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
        tenant_id: context.tenantId,
        work_id: context.workId,
        project_id: projectId,
        fingerprint,
        status,
        promoted: false,
        failure_count: failures,
        next_action: nextAction,
        event,
      };
    });
  }

  async function resolveIncident(identity, input) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const projectId = identifier(input.project_id, "project_id", 64);
    const { fingerprint, scope } = incidentFingerprint(input.scope || input);
    const result = await pool.query(`SELECT runbook,runbook_digest,verified_by,verification_count,updated_at
      FROM core_continuity_incident_runbooks
      WHERE tenant_id=$1 AND project_id=$2 AND fingerprint=$3 AND status='verified'`,
    [tenantId, projectId, fingerprint]);
    if (!result.rows[0]) {
      return {
        schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
        tenant_id: tenantId,
        project_id: projectId,
        fingerprint,
        scope,
        matched: false,
        revalidation_required: true,
      };
    }
    return {
      schema_version: WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
      tenant_id: tenantId,
      project_id: projectId,
      fingerprint,
      scope,
      matched: true,
      revalidation_required: false,
      ...result.rows[0],
    };
  }

  function remediationPayload(row) {
    return row?.payload && typeof row.payload === "object" ? row.payload : null;
  }

  const remediationStore = {
    backend: "tenant_work_gallery_postgresql",
    async list(tenantId, { work_id, status } = {}) {
      await initialize();
      const values = [tenant(tenantId)];
      const where = ["tenant_id=$1"];
      if (work_id) { values.push(String(work_id)); where.push(`work_id=$${values.length}`); }
      if (status) { values.push(String(status)); where.push(`status=$${values.length}`); }
      const result = await pool.query(`SELECT payload FROM core_continuity_remediations
        WHERE ${where.join(" AND ")} ORDER BY updated_at DESC`, values);
      return result.rows.map(remediationPayload).filter(Boolean);
    },
    async listBlockers(tenantId) { return this.list(tenantId); },
    async findById({ tenant_id, remediation_id }) {
      await initialize();
      const result = await pool.query(`SELECT payload FROM core_continuity_remediations
        WHERE tenant_id=$1 AND remediation_id=$2`, [tenant(tenant_id), String(remediation_id)]);
      return remediationPayload(result.rows[0]);
    },
    async findByOriginalDecision({ tenant_id, decision_id }) {
      await initialize();
      const result = await pool.query(`SELECT payload FROM core_continuity_remediations
        WHERE tenant_id=$1 AND original_decision_id=$2`, [tenant(tenant_id), String(decision_id)]);
      return remediationPayload(result.rows[0]);
    },
    async findIdempotency({ tenant_id, remediation_id, idempotency_key }) {
      await initialize();
      const result = await pool.query(`SELECT proposal_digest,result,created_at
        FROM core_continuity_remediation_idempotency
        WHERE tenant_id=$1 AND remediation_id=$2 AND idempotency_key=$3`,
      [tenant(tenant_id), String(remediation_id), String(idempotency_key)]);
      return result.rows[0] || null;
    },
    async rememberIdempotency({ tenant_id, remediation_id, idempotency_key, proposal_digest, result }) {
      await initialize();
      const tenantKey = tenant(tenant_id);
      const inserted = await pool.query(`INSERT INTO core_continuity_remediation_idempotency
        (tenant_id,remediation_id,idempotency_key,proposal_digest,result)
        VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING
        RETURNING proposal_digest,result,created_at`,
      [tenantKey, String(remediation_id), String(idempotency_key), String(proposal_digest), JSON.stringify(result)]);
      const stored = inserted.rows[0] || await this.findIdempotency({
        tenant_id: tenantKey, remediation_id, idempotency_key,
      });
      if (stored?.proposal_digest !== proposal_digest) throw new Error("core_block_remediation_replay_rejected");
      return stored;
    },
    async create(remediation) {
      await initialize();
      const tenantKey = tenant(remediation.tenant_id);
      const existing = await this.findByOriginalDecision({
        tenant_id: tenantKey, decision_id: remediation.original_decision?.decision_id,
      });
      if (existing) return existing;
      const payload = structuredClone(remediation);
      const result = await pool.query(`INSERT INTO core_continuity_remediations
        (tenant_id,remediation_id,work_id,project_id,original_decision_id,status,block_class,
         scope_digest,contract_digest,version,payload,created_at,updated_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
        ON CONFLICT (tenant_id,original_decision_id) DO NOTHING RETURNING payload`, [
        tenantKey, payload.remediation_id, String(payload.work_id), payload.project_id || null,
        payload.original_decision.decision_id, payload.status, payload.original_decision.block_class,
        payload.bound_scope.scope_digest, payload.contract_digest, Number(payload.version || 0),
        JSON.stringify(payload), payload.created_at, payload.updated_at, payload.expires_at,
      ]);
      const created = remediationPayload(result.rows[0]);
      if (created) await pool.query(`INSERT INTO core_continuity_remediation_versions
        (tenant_id,remediation_id,version,contract_digest,payload) VALUES ($1,$2,$3,$4,$5::jsonb)
        ON CONFLICT DO NOTHING`, [tenantKey, created.remediation_id, Number(created.version || 0),
        created.contract_digest, JSON.stringify(created)]);
      return created || this.findByOriginalDecision({
        tenant_id: tenantKey, decision_id: payload.original_decision.decision_id,
      });
    },
    async update({ tenant_id, remediation_id, expected_version, mutate }) {
      await initialize();
      const tenantKey = tenant(tenant_id);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query(`SELECT payload,version FROM core_continuity_remediations
          WHERE tenant_id=$1 AND remediation_id=$2 FOR UPDATE`, [tenantKey, String(remediation_id)]);
        const row = selected.rows[0];
        if (!row) throw new Error("remediation_not_found");
        if (Number(row.version) !== Number(expected_version)) throw new Error("remediation_version_conflict");
        const current = structuredClone(row.payload);
        const next = await mutate(current);
        if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("remediation_update_invalid");
        if (next.tenant_id !== current.tenant_id ||
            next.original_decision?.decision_id !== current.original_decision?.decision_id ||
            next.bound_scope?.scope_digest !== current.bound_scope?.scope_digest) {
          throw new Error("remediation_immutable_identity_changed");
        }
        next.version = Number(row.version) + 1;
        next.updated_at = nowDate().toISOString();
        next.contract_digest = digest({ ...next, contract_digest: null });
        await client.query(`UPDATE core_continuity_remediations SET
          status=$3,block_class=$4,contract_digest=$5,version=$6,payload=$7::jsonb,
          updated_at=$8,expires_at=$9 WHERE tenant_id=$1 AND remediation_id=$2`, [
          tenantKey, String(remediation_id), next.status, next.original_decision.block_class,
          next.contract_digest, next.version, JSON.stringify(next), next.updated_at, next.expires_at,
        ]);
        await client.query(`INSERT INTO core_continuity_remediation_versions
          (tenant_id,remediation_id,version,contract_digest,payload) VALUES ($1,$2,$3,$4,$5::jsonb)`, [
          tenantKey, String(remediation_id), next.version, next.contract_digest, JSON.stringify(next),
        ]);
        await client.query("COMMIT");
        return next;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    async attachNyraReview({ tenant_id, remediation_id, expected_version, review }) {
      return this.update({ tenant_id, remediation_id, expected_version, mutate: (current) => {
        const nextStatus = review.status === "approve_for_core" ? "nyra_reviewed"
          : review.status === "request_revision" ? "revision_required" : "hard_denied";
        assertTransitionAllowed(current.status, nextStatus);
        current.nyra_review = review;
        current.status = nextStatus;
        return current;
      }});
    },
    async appendAttempt({ tenant_id, remediation_id, expected_version, attempt, next_status }) {
      return this.update({ tenant_id, remediation_id, expected_version, mutate: (current) => {
        const nextStatus = next_status || "proposal_ready";
        if (current.status === "open" && nextStatus === "waiting_owner") {
          assertTransitionAllowed(current.status, nextStatus);
        } else if (current.status === "open") {
          assertTransitionAllowed(current.status, "diagnosing");
          assertTransitionAllowed("diagnosing", nextStatus);
        } else {
          assertTransitionAllowed(current.status, nextStatus);
        }
        current.attempts = [...(Array.isArray(current.attempts) ? current.attempts : []), attempt];
        current.attempt_count = Number(current.attempt_count || 0) + 1;
        current.status = nextStatus;
        current.diagnosis = { status: "submitted", submitted_by: attempt.submitted_by,
          root_cause: attempt.diagnosis?.root_cause || null, evidence: attempt.diagnosis?.evidence || [],
          unknowns: attempt.diagnosis?.unknowns || [], affected_components: attempt.diagnosis?.affected_components || [],
          submitted_at: attempt.created_at, diagnosis_digest: digest(attempt.diagnosis || {}) };
        return current;
      }});
    },
    async appendAttemptIdempotent({ tenant_id, remediation_id, expected_version, attempt, next_status,
      idempotency_key, proposal_digest }) {
      await initialize();
      const tenantKey = tenant(tenant_id);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query(`SELECT payload,version FROM core_continuity_remediations
          WHERE tenant_id=$1 AND remediation_id=$2 FOR UPDATE`, [tenantKey, String(remediation_id)]);
        const row = selected.rows[0];
        if (!row) throw new Error("remediation_not_found");
        const replay = await client.query(`SELECT proposal_digest,result FROM core_continuity_remediation_idempotency
          WHERE tenant_id=$1 AND remediation_id=$2 AND idempotency_key=$3 FOR UPDATE`,
        [tenantKey, String(remediation_id), String(idempotency_key)]);
        if (replay.rows[0]) {
          if (replay.rows[0].proposal_digest !== proposal_digest) throw new Error("core_block_remediation_replay_rejected");
          await client.query("COMMIT");
          return { idempotent: true, remediation: replay.rows[0].result?.remediation || null };
        }
        if (Number(row.version) !== Number(expected_version)) throw new Error("remediation_version_conflict");
        const next = structuredClone(row.payload);
        const nextStatus = next_status || "proposal_ready";
        if (next.status === "open" && nextStatus === "waiting_owner") assertTransitionAllowed(next.status, nextStatus);
        else if (next.status === "open") {
          assertTransitionAllowed(next.status, "diagnosing");
          assertTransitionAllowed("diagnosing", nextStatus);
        } else assertTransitionAllowed(next.status, nextStatus);
        next.attempts = [...(Array.isArray(next.attempts) ? next.attempts : []), attempt];
        next.attempt_count = Number(next.attempt_count || 0) + 1;
        next.status = nextStatus;
        next.diagnosis = { status: "submitted", submitted_by: attempt.submitted_by,
          root_cause: attempt.diagnosis?.root_cause || null, evidence: attempt.diagnosis?.evidence || [],
          unknowns: attempt.diagnosis?.unknowns || [], affected_components: attempt.diagnosis?.affected_components || [],
          submitted_at: attempt.created_at, diagnosis_digest: digest(attempt.diagnosis || {}) };
        next.version = Number(row.version) + 1;
        next.updated_at = nowDate().toISOString();
        next.contract_digest = digest({ ...next, contract_digest: null });
        await client.query(`UPDATE core_continuity_remediations SET status=$3,contract_digest=$4,version=$5,
          payload=$6::jsonb,updated_at=$7 WHERE tenant_id=$1 AND remediation_id=$2`, [
          tenantKey, String(remediation_id), next.status, next.contract_digest, next.version,
          JSON.stringify(next), next.updated_at,
        ]);
        await client.query(`INSERT INTO core_continuity_remediation_versions
          (tenant_id,remediation_id,version,contract_digest,payload) VALUES ($1,$2,$3,$4,$5::jsonb)`, [
          tenantKey, String(remediation_id), next.version, next.contract_digest, JSON.stringify(next),
        ]);
        await client.query(`INSERT INTO core_continuity_remediation_idempotency
          (tenant_id,remediation_id,idempotency_key,proposal_digest,result)
          VALUES ($1,$2,$3,$4,$5::jsonb)`, [tenantKey, String(remediation_id), String(idempotency_key),
          String(proposal_digest), JSON.stringify({ remediation: next })]);
        await client.query("COMMIT");
        return { idempotent: false, remediation: next };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    async markStatus({ tenant_id, remediation_id, expected_version, status, fields = {} }) {
      return this.update({ tenant_id, remediation_id, expected_version, mutate: (current) => {
        assertTransitionAllowed(current.status, status);
        current.status = status; Object.assign(current, fields); return current;
      }});
    },
    async recordResubmission({ tenant_id, remediation_id, expected_version, resubmission }) {
      return this.markStatus({ tenant_id, remediation_id, expected_version, status: "resubmitted",
        fields: { resubmission } });
    },
    async recordOutcome({ tenant_id, remediation_id, expected_version, outcome }) {
      return this.update({ tenant_id, remediation_id, expected_version, mutate: (current) => {
        current.outcome = { ...(current.outcome || {}), ...outcome }; return current;
      }});
    },
    async cancel({ tenant_id, remediation_id, expected_version, reason }) {
      return this.markStatus({ tenant_id, remediation_id, expected_version, status: "cancelled",
        fields: { cancel_reason: reason || "cancelled" } });
    },
  };

  return {
    initialize,
    create,
    ensure,
    ensureWithClient,
    upsertControlContext,
    setWorkEventProjector,
    readIntent,
    resolveStandingReleaseIntentBinding,
    listWorks,
    recordChange,
    checkpoint,
    read,
    resume,
    verifyMemory,
    planNativeAgents,
    bindNativeAgent,
    reportNativeAgent,
    evaluateClosure,
    bindCoreJoinVerdict,
    finalizeClosure,
    upsertAtlas,
    selectAtlas,
    readAtlasGraph,
    recordOperationalIncident,
    recordIncident,
    verifyIncident,
    resolveIncident,
    remediationStore,
    gallery,
    resolveDttWorkLeaseBinding,
    resolveGenericWorkCoreJoinLeaseBinding,
    join,
    heartbeat,
    openBranch,
    acquireLease,
    renewLease,
    releaseLease,
    postMessage,
    inbox,
    close: () => pool.end(),
    schemaSql: WORK_CONTINUITY_SCHEMA_SQL,
  };
}
