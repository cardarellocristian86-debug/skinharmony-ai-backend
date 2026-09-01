import crypto from "node:crypto";

import {
  authenticatedClientType,
  authenticatedHostKind,
  publicHostPrincipal,
} from "./host-app-registry.js";
import { validateCoreOrchestrationVerdict } from "../../shared/nyra-core-orchestration-verdict.mjs";

const PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,127}$/;
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/;
const REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,159}$/;
const WORK_TYPES = new Set([
  "software_git", "software_non_git", "deployment", "research", "document",
  "commercial_crm", "hardware", "generic",
]);
const SPEC_FIELDS = new Set([
  "request_id", "work_name", "work_type", "idea", "objective", "architecture",
  "next_action", "acceptance_criteria", "constraints", "tasks",
]);
const TASK_FIELDS = new Set(["title", "weight", "required"]);
const AUTHORIZATION_PHASES = new Set(["review", "create"]);

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  if (Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function text(value, maximum, code) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) {
    fail(code);
  }
  return result;
}

function textList(value, { maximumItems, maximumLength, code }) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) fail(code);
  const result = value.map((item) => text(item, maximumLength, code));
  if (new Set(result).size !== result.length) fail(code);
  return result;
}

function boundedJson(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > 5_000 || depth > 10) fail("nyra_work_bootstrap_architecture_invalid", 413);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("nyra_work_bootstrap_architecture_invalid");
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 20_000 || /\u0000/u.test(value)) fail("nyra_work_bootstrap_architecture_invalid", 413);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 250) fail("nyra_work_bootstrap_architecture_invalid", 413);
    return value.map((item) => boundedJson(item, depth + 1, budget));
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("nyra_work_bootstrap_architecture_invalid");
  }
  const keys = Object.keys(value);
  if (keys.length > 250 || keys.some((key) =>
    !key || key.length > 160 || ["__proto__", "constructor", "prototype"].includes(key.toLowerCase()))) {
    fail("nyra_work_bootstrap_architecture_invalid", 413);
  }
  return Object.fromEntries(keys.sort().map((key) => [key, boundedJson(value[key], depth + 1, budget)]));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function governedWorkBootstrapDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function normalizeGovernedWorkBootstrapSpec(input = {}) {
  const source = exactObject(input, SPEC_FIELDS, "nyra_work_bootstrap_spec_invalid");
  const request_id = text(source.request_id, 160, "nyra_work_bootstrap_request_id_invalid");
  if (!REQUEST_ID.test(request_id)) fail("nyra_work_bootstrap_request_id_invalid");
  const work_type = text(source.work_type, 80, "nyra_work_bootstrap_type_invalid").toLowerCase();
  if (!WORK_TYPES.has(work_type)) fail("nyra_work_bootstrap_type_invalid");
  if (!Array.isArray(source.tasks) || source.tasks.length < 1 || source.tasks.length > 250) {
    fail("nyra_work_bootstrap_tasks_invalid");
  }
  const tasks = source.tasks.map((item) => {
    const task = exactObject(item, TASK_FIELDS, "nyra_work_bootstrap_task_invalid");
    const weight = task.weight === undefined ? 1 : Number(task.weight);
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > 10_000 ||
        (task.required !== undefined && typeof task.required !== "boolean")) {
      fail("nyra_work_bootstrap_task_invalid");
    }
    return Object.freeze({
      title: text(task.title, 2_000, "nyra_work_bootstrap_task_invalid"),
      weight,
      required: task.required !== false,
    });
  });
  const architecture = boundedJson(source.architecture);
  if (Buffer.byteLength(JSON.stringify(architecture), "utf8") > 100_000) {
    fail("nyra_work_bootstrap_architecture_too_large", 413);
  }
  return Object.freeze({
    request_id,
    work_name: text(source.work_name, 1_000, "nyra_work_bootstrap_name_invalid"),
    work_type,
    idea: text(source.idea, 8_000, "nyra_work_bootstrap_idea_invalid"),
    objective: text(source.objective, 8_000, "nyra_work_bootstrap_objective_invalid"),
    architecture: Object.freeze(architecture),
    next_action: text(source.next_action, 4_000, "nyra_work_bootstrap_next_action_invalid"),
    acceptance_criteria: Object.freeze(textList(source.acceptance_criteria, {
      maximumItems: 250,
      maximumLength: 2_000,
      code: "nyra_work_bootstrap_acceptance_invalid",
    })),
    constraints: Object.freeze(source.constraints === undefined ||
      (Array.isArray(source.constraints) && source.constraints.length === 0) ? [] : textList(source.constraints, {
      maximumItems: 100,
      maximumLength: 1_000,
      code: "nyra_work_bootstrap_constraints_invalid",
    })),
    tasks: Object.freeze(tasks),
  });
}

export function materializeGovernedWorkBootstrapRequest({
  spec,
  identity,
  projectId,
  canonicalIntentDigest = null,
  coreOrchestrationVerdictDigest = null,
  coreOrchestrationVerdict = null,
} = {}) {
  const normalized = normalizeGovernedWorkBootstrapSpec(spec);
  const project_id = String(projectId || "").trim();
  const session_id = String(identity?.agentPresence?.session_id || "").trim();
  if (!PROJECT_ID.test(project_id)) fail("nyra_work_bootstrap_project_binding_required", 409);
  if (!SESSION_ID.test(session_id)) fail("nyra_work_bootstrap_session_binding_required", 409);
  const principal = publicHostPrincipal(identity);
  if (principal?.registered !== true) fail("registered_host_principal_required", 403);
  const host_type = authenticatedHostKind(identity);
  const canonical_intent_digest = canonicalIntentDigest === null || canonicalIntentDigest === undefined
    ? null : String(canonicalIntentDigest).trim().toLowerCase();
  const core_orchestration_verdict_digest = coreOrchestrationVerdictDigest === null ||
    coreOrchestrationVerdictDigest === undefined
    ? null : String(coreOrchestrationVerdictDigest).trim().toLowerCase();
  if ((canonical_intent_digest && !/^[a-f0-9]{64}$/.test(canonical_intent_digest)) ||
      (core_orchestration_verdict_digest && !/^[a-f0-9]{64}$/.test(core_orchestration_verdict_digest)) ||
      Boolean(canonical_intent_digest) !== Boolean(core_orchestration_verdict_digest)) {
    fail("nyra_work_bootstrap_canonical_binding_invalid", 409);
  }
  let core_orchestration_verdict = null;
  if (canonical_intent_digest) {
    try {
      core_orchestration_verdict = validateCoreOrchestrationVerdict(coreOrchestrationVerdict, {
        canonicalIntentDigest: canonical_intent_digest,
      });
    } catch {
      fail("nyra_work_bootstrap_core_verdict_invalid", 409);
    }
    if (core_orchestration_verdict.verdict_digest !== core_orchestration_verdict_digest) {
      fail("nyra_work_bootstrap_core_verdict_invalid", 409);
    }
  } else if (coreOrchestrationVerdict !== null && coreOrchestrationVerdict !== undefined) {
    fail("nyra_work_bootstrap_core_verdict_invalid", 409);
  }
  return bindWorkBootstrapRequestToAuthenticatedHost({
    identity,
    request: {
      intent_type: "CREATE_WORK",
      request_id: normalized.request_id,
      project_id,
      session_id,
      initial_message: normalized.objective,
      work_name: normalized.work_name,
      work_type: normalized.work_type,
      idea: normalized.idea,
      objective: normalized.objective,
      architecture: Object.freeze({
        schema_version: "nyra_governed_work_bootstrap_v1",
        declared: normalized.architecture,
        host_binding: Object.freeze({
          app_id: principal.app_id,
          host_kind: host_type,
          registry_revision: principal.registry_revision,
          nyra_first: true,
          universal_core_final_authority: true,
          provider_execution: false,
          ...(canonical_intent_digest ? {
            canonical_intent_binding: Object.freeze({
              schema_version: "nyra_work_canonical_intent_binding_v1",
              canonical_intent_digest,
              core_orchestration_verdict_digest,
              core_orchestration_verdict,
              intent_anchor_materialization: "intent_anchor_v1_from_governed_bootstrap",
              immutable: true,
              authority: "DESCRIPTIVE_ONLY",
            }),
          } : {}),
        }),
      }),
      next_action: normalized.next_action,
      visibility_scope: "private",
      acceptance_criteria: normalized.acceptance_criteria,
      constraints: normalized.constraints,
      tasks: normalized.tasks,
      resume_existing: false,
    },
  });
}

export function bindWorkBootstrapRequestToAuthenticatedHost({ request, identity } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    fail("nyra_work_bootstrap_spec_invalid");
  }
  const principal = publicHostPrincipal(identity);
  if (principal?.registered !== true) fail("registered_host_principal_required", 403);
  const session_id = String(identity?.agentPresence?.session_id || "").trim();
  if (!SESSION_ID.test(session_id)) fail("nyra_work_bootstrap_session_binding_required", 409);
  const agent_id = text(
    String(identity?.agentPresence?.agent_id || "connected_ai").slice(0, 128),
    128,
    "nyra_work_bootstrap_agent_binding_required",
  );
  return Object.freeze({
    ...request,
    // These provenance fields are identity assertions. Always overwrite
    // caller-shaped values before request digesting, Core authorization or
    // persistence so review and create share one authenticated host binding.
    session_id,
    host_type: authenticatedHostKind(identity),
    client_type: authenticatedClientType(identity) || "other",
    agent_id,
  });
}

export function governedWorkBootstrapAuthorizationTarget({
  phase,
  request,
  identity,
} = {}) {
  const normalizedPhase = String(phase || "").trim().toLowerCase();
  if (!AUTHORIZATION_PHASES.has(normalizedPhase)) {
    fail("nyra_work_bootstrap_authorization_phase_invalid");
  }
  const principal = publicHostPrincipal(identity);
  if (principal?.registered !== true) fail("registered_host_principal_required", 403);
  const session_fingerprint = String(
    identity?.agentPresence?.session_fingerprint || "",
  ).trim().toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(session_fingerprint)) {
    fail("nyra_work_bootstrap_session_binding_required", 409);
  }
  const requestValue = request && typeof request === "object" && !Array.isArray(request)
    ? { ...request }
    : fail("nyra_work_bootstrap_spec_invalid");
  // Confirmation is verified independently by the gateway identity layer.
  // It is not Work content and must not make the same canonical create request
  // hash differently across the conversational and direct V2 entrypoints.
  delete requestValue.owner_confirmed;
  delete requestValue.confirmation_reference;
  const binding = Object.freeze({
    schema_version: "nyra_work_bootstrap_authorization_binding_v1",
    phase: normalizedPhase,
    tenant_id: String(identity?.tenantId || ""),
    project_id: String(requestValue.project_id || ""),
    request_id: String(requestValue.request_id || requestValue.session_id || ""),
    review_id: String(requestValue.review_id || "") || null,
    review_digest: String(requestValue.review_digest || "") || null,
    app_id: principal.app_id,
    host_kind: authenticatedHostKind(identity),
    registry_revision: principal.registry_revision,
    session_fingerprint,
    request_digest: governedWorkBootstrapDigest(requestValue),
  });
  return `work_bootstrap:${normalizedPhase}:${principal.app_id}:${principal.host_kind}:${governedWorkBootstrapDigest(binding)}`;
}
