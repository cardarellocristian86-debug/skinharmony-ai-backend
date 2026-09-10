import crypto from "node:crypto";

const OPERATIONS = new Set(["WORK_CREATE_OR_RECONCILE", "DELEGATION_REQUEST", "ACTION_TICKET_REQUEST"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST = /^[a-f0-9]{64}$/u;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
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
      "allowed_path_prefixes", "allowed_actions", "ttl_seconds", "idempotency_key"]) ||
        request.intent_anchor_digest !== undefined ||
        !Array.isArray(request.allowed_actions) || request.allowed_actions.length < 1 ||
        !Array.isArray(request.audience) || request.audience.length !== 1) {
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
