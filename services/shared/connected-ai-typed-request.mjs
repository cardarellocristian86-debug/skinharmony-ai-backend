import crypto from "node:crypto";

const OPERATIONS = new Set(["WORK_CREATE_OR_RECONCILE", "DELEGATION_REQUEST", "ACTION_TICKET_REQUEST"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST = /^[a-f0-9]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const DELEGATION_BUDGET_FIELDS = Object.freeze([
  "max_agents", "max_parallel", "max_commits", "max_pushes", "max_deploys",
  "max_total_actions",
]);
const DELEGATION_RELEASE_POLICY_FIELDS = Object.freeze([
  "manifest_required_for_protected_push", "manifest_required_for_induced_deploy",
  "manifest_required_for_deploy", "independent_verifier_required", "rollback_required",
  "required_checks",
]);
const DELEGATION_BUDGET_LIMITS = Object.freeze({
  max_agents: 3, max_parallel: 2, max_commits: 100, max_pushes: 100,
  max_deploys: 100, max_total_actions: 1_000,
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function boundedUniqueStrings(value, { minimum = 1, maximum, maxLength }) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return false;
  const normalized = value.map((item) => typeof item === "string" ? item.trim() : null);
  return normalized.every((item, index) => item && item === value[index] && item.length <= maxLength) &&
    new Set(normalized).size === normalized.length;
}

export function connectedAiTypedRequestDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function normalizeConnectedAiTypedRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== ["operation", "request", "schema_version"].sort().join("\0") ||
      value.schema_version !== "connected_ai_typed_request_v1" || !OPERATIONS.has(value.operation) ||
      !value.request || typeof value.request !== "object" || Array.isArray(value.request)) {
    throw new Error("connected_ai_typed_request_invalid");
  }
  const request = structuredClone(value.request);
  const exact = (fields) => Object.keys(request).sort().join("\0") === fields.sort().join("\0");
  if (value.operation === "WORK_CREATE_OR_RECONCILE") {
    if (!exact(["create_request", "idempotency_key"]) || !request.create_request ||
        typeof request.create_request !== "object" || Array.isArray(request.create_request) ||
        Object.keys(request.create_request).some((key) => !new Set([
          "project_id", "request_id", "work_name", "work_type", "idea", "objective",
          "architecture", "next_action", "acceptance_criteria", "constraints", "tasks",
          "parent_work_id", "idempotency_key",
        ]).has(key)) || ["tenant_id", "session_id", "host_type", "client_type", "agent_id",
          "intent_digest", "canonical_intent_digest", "core_orchestration_verdict_digest"]
          .some((key) => Object.hasOwn(request.create_request, key))) {
      throw new Error("connected_ai_work_request_invalid");
    }
  } else if (!UUID.test(String(request.work_id || ""))) {
    throw new Error("connected_ai_typed_request_binding_invalid");
  } else if (value.operation === "DELEGATION_REQUEST") {
    if (!exact(["work_id", "repository", "audience", "allowed_branches", "protected_branches",
      "allowed_path_prefixes", "allowed_actions", "budget", "release_policy", "ttl_seconds",
      "idempotency_key"]) ||
        request.intent_anchor_digest !== undefined ||
        !Array.isArray(request.allowed_actions) || request.allowed_actions.length < 1 ||
        !Array.isArray(request.audience) || request.audience.length !== 1 ||
        !REPOSITORY.test(String(request.repository || "")) ||
        !boundedUniqueStrings(request.audience, { maximum: 1, maxLength: 160 }) ||
        !boundedUniqueStrings(request.allowed_branches, { maximum: 30, maxLength: 240 }) ||
        !boundedUniqueStrings(request.protected_branches, { maximum: 30, maxLength: 240 }) ||
        !boundedUniqueStrings(request.allowed_path_prefixes, { maximum: 100, maxLength: 500 }) ||
        !boundedUniqueStrings(request.allowed_actions, { maximum: 50, maxLength: 160 }) ||
        !Number.isInteger(request.ttl_seconds) || request.ttl_seconds < 60 ||
        request.ttl_seconds > 3_600 || typeof request.idempotency_key !== "string" ||
        request.idempotency_key.length < 8 || request.idempotency_key.length > 160 ||
        !request.budget || typeof request.budget !== "object" || Array.isArray(request.budget) ||
        Object.keys(request.budget).sort().join("\0") !== [...DELEGATION_BUDGET_FIELDS].sort().join("\0") ||
        Object.entries(DELEGATION_BUDGET_LIMITS).some(([key, maximum]) =>
          !Number.isInteger(request.budget[key]) || request.budget[key] < 1 ||
          request.budget[key] > maximum) ||
        !request.release_policy || typeof request.release_policy !== "object" ||
        Array.isArray(request.release_policy) ||
        Object.keys(request.release_policy).sort().join("\0") !==
          [...DELEGATION_RELEASE_POLICY_FIELDS].sort().join("\0") ||
        DELEGATION_RELEASE_POLICY_FIELDS.slice(0, -1).some((key) =>
          typeof request.release_policy[key] !== "boolean") ||
        !boundedUniqueStrings(request.release_policy.required_checks,
          { maximum: 100, maxLength: 240 })) {
      throw new Error("connected_ai_delegation_request_invalid");
    }
  } else if (!exact(["work_id", "delegation_id", "repository", "action", "evidence_digest",
    "idempotency_key"]) || !DIGEST.test(String(request.evidence_digest || "")) ||
    !request.delegation_id || !request.action || typeof request.action !== "object") {
    throw new Error("connected_ai_action_ticket_request_invalid");
  }
  return Object.freeze({ schema_version: value.schema_version, operation: value.operation,
    request: stable(request) });
}
