import crypto from "node:crypto";

import {
  HOST_APP_CAPABILITIES,
  authenticatedHostKind,
  hostPrincipalAllows,
} from "./host-app-registry.js";
import { SUPPORTED_HOST_NATIVE_KINDS } from "./host-app-authorization.js";
import {
  governedWorkBootstrapDigest,
  materializeGovernedWorkBootstrapRequest,
} from "./work-bootstrap-contract.js";
import { validateToolArguments } from "./schema-validation.js";
import { WORK_CONTINUITY_TOOLS } from "./work-continuity-tools.js";

const TOKEN_PREFIX = "ngc2";
const LEGACY_TOKEN_PREFIX = "ngc1";
const ATTESTATION_SCHEMA = "nyra_governed_continue_attestation_v2";
const LEGACY_ATTESTATION_SCHEMA = "nyra_governed_continue_attestation_v1";
const SHA256 = /^[a-f0-9]{64}$/;
const WORK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,127}$/;
const DIRECTIVE_ID = /^nyra_dir_[a-f0-9]{24}$/;
const NONCE = /^[A-Za-z0-9_-]{24}$/;
const READY_STATES = new Set(["READY_FOR_CORE_REVIEW", "MANUAL_ONLY"]);
const WORK_BOOTSTRAP_STATE = "WORK_BOOTSTRAP_READY";
const ACTION_CONTINUATION_OPERATIONS = new Set([
  "issue_delegation",
  "authorize_action",
]);
const WORK_CONTINUATION_OPERATIONS = Object.freeze([
  "resume_existing_work",
  "create_native_plan",
]);
const NATIVE_PLAN_BIND_OPERATION = "bind_native_child";
const GOVERNED_OPERATIONS = new Set([
  "review_work_bootstrap",
  "create_work",
  "issue_delegation",
  "authorize_action",
  ...WORK_CONTINUATION_OPERATIONS,
  NATIVE_PLAN_BIND_OPERATION,
]);
const WORK_CONTINUATION_PROGRESS = new Set([
  "ANALYSIS",
  "EVIDENCE",
  "BOUNDED_WORKSPACE",
  "PROPOSAL",
]);
const WORK_CONTINUATION_TERMINAL_STATES = new Set([
  "COMPLETED",
  "CANCELLED",
  "SUPERSEDED",
  "ARCHIVED",
]);
const CONTINUATION_FORBIDDEN_REQUEST_FIELDS = new Set([
  "agent_id",
  "client_type",
  "idempotency_key",
  "owner_confirmed",
  "confirmation_reference",
]);
const WORK_TOOL_BY_NAME = new Map(WORK_CONTINUITY_TOOLS.map((tool) => [tool.name, tool]));
const ACTION_KIND_BY_CLASS = Object.freeze({
  GIT_MERGE: new Set(["github.merge"]),
  GIT_PUSH: new Set(["git.push.branch", "git.push.protected"]),
  PULL_REQUEST_OPEN: new Set(["github.draft_pr", "github.ready"]),
  DEPLOY: new Set(["render.deploy", "render.promote"]),
  PUBLISH: new Set(["github.release", "render.deploy"]),
  TICKET_RESERVE: new Set([]),
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hmac(secret, payload, version = "v2") {
  return crypto.createHmac("sha256", secret)
    .update(`nyra-governed-continue-${version}\u0000${JSON.stringify(stable(payload))}`)
    .digest("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(stable(value)))
    .digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function continuationIdempotencyKey(payload, operation, replayScope) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(stable({
    schema_version: "nyra_governed_continue_idempotency_v1",
    attestation_payload_digest: sha256(payload),
    operation,
    replay_scope: replayScope,
  }))).digest("hex");
  return `nyra_cont_${digest.slice(0, 48)}`;
}

function continuationRequestDigest(args = {}) {
  const operation = String(args.operation || "");
  const requestByOperation = {
    review_work_bootstrap: {
      work_bootstrap: args.work_bootstrap,
    },
    create_work: {
      work_bootstrap: args.work_bootstrap,
      review_id: args.review_id,
      review_digest: args.review_digest,
      review_decision: args.review_decision,
    },
    issue_delegation: { delegation_request: args.delegation_request },
    authorize_action: { action_request: args.action_request },
    resume_existing_work: { resume_request: args.resume_request },
    create_native_plan: { native_plan_request: args.native_plan_request },
    bind_native_child: { native_bind_request: args.native_bind_request },
  }[operation];
  if (!requestByOperation) fail("nyra_governed_continue_operation_invalid");
  return sha256({
    schema_version: "nyra_governed_continue_request_v1",
    operation,
    request: requestByOperation,
  });
}

function replayScopeForOperation(args = {}) {
  const operation = String(args.operation || "");
  if (operation === NATIVE_PLAN_BIND_OPERATION) {
    const request = args.native_bind_request || {};
    return `bind_native_child_${sha256({
      plan_id: request.plan_id,
      task_id: request.task_id,
    }).slice(0, 16)}`;
  }
  if (["review_work_bootstrap", "create_work", ...WORK_CONTINUATION_OPERATIONS]
    .includes(operation)) return operation;
  return "single";
}

function replayBindingKey(callerIdempotencyKey, requestDigest) {
  return `nyra_req_${sha256({
    caller_idempotency_key: String(callerIdempotencyKey || ""),
    request_digest: requestDigest,
  }).slice(0, 48)}`;
}

function continuationAllowedByDirective(directive, binding) {
  if (!binding || !WORK_ID.test(String(binding.work_id || "")) ||
      !Number.isSafeInteger(Number(binding.work_revision)) ||
      !SHA256.test(String(binding.intent_digest || "")) ||
      !SHA256.test(String(binding.context_digest || "")) ||
      directive?.can_continue !== true ||
      directive?.decision?.execution_authorized !== false ||
      directive?.decision?.external_action_authorized !== false) return false;
  if (WORK_CONTINUATION_TERMINAL_STATES.has(
    String(directive?.work_context?.status || "").toUpperCase(),
  )) return false;
  const progress = Array.isArray(directive?.permitted_progress)
    ? directive.permitted_progress
    : [];
  return progress.some((item) => WORK_CONTINUATION_PROGRESS.has(String(item || "")));
}

function allowedInternalOperations(identity, directive, binding) {
  if (!continuationAllowedByDirective(directive, binding) ||
      !SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) return [];
  const operations = [];
  if (hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_OPERATE)) {
    operations.push("resume_existing_work");
  }
  if (hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE)) {
    operations.push("create_native_plan");
  }
  return operations;
}

function validateContinuationRequest(toolName, request, idempotencyKey) {
  const tool = WORK_TOOL_BY_NAME.get(toolName);
  if (!tool || !request || typeof request !== "object" || Array.isArray(request)) {
    fail("nyra_governed_continue_native_request_invalid");
  }
  if (Object.keys(request).some((key) => CONTINUATION_FORBIDDEN_REQUEST_FIELDS.has(key))) {
    fail("nyra_governed_continue_native_request_reserved", 403);
  }
  if (["work_continuity_native_plan", "work_continuity_native_bind"].includes(toolName) &&
      Object.hasOwn(request, "session_id")) {
    fail("nyra_governed_continue_native_request_reserved", 403);
  }
  const candidate = toolName === "work_continuity_native_bind"
    ? { ...request }
    : { ...request, idempotency_key: idempotencyKey };
  const violations = validateToolArguments(tool.inputSchema, candidate);
  if (violations.length) {
    const error = new Error("nyra_governed_continue_native_request_invalid");
    error.code = "nyra_governed_continue_native_request_invalid";
    error.status = 422;
    error.violations = violations.slice(0, 20);
    throw error;
  }
  return candidate;
}

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function parseToken(token) {
  const [prefix, encoded, signature, extra] = String(token || "").split(".");
  if (![TOKEN_PREFIX, LEGACY_TOKEN_PREFIX].includes(prefix) ||
      !encoded || !signature || extra) {
    fail("nyra_governed_continue_attestation_invalid", 403);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail("nyra_governed_continue_attestation_invalid", 403);
  }
  return { prefix, payload, signature };
}

function unavailable(reason) {
  return Object.freeze({
    schema_version: "nyra_governed_continuation_v1",
    available: false,
    submit_tool: null,
    candidate_attestation: null,
    expires_at: null,
    operations: Object.freeze([]),
    reason,
  });
}

export function createNyraGovernedContinueAttestor({
  secret,
  now = () => Date.now(),
  ttlMs = 5 * 60 * 1_000,
} = {}) {
  const key = String(secret || "").trim();
  if (Buffer.byteLength(key, "utf8") < 32) return null;
  const boundedTtl = Math.min(Math.max(Number(ttlMs) || 300_000, 60_000), 600_000);
  const replayBindings = new Map();

  function encodedContinuation(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const legacyBootstrap = payload.candidate_kind === "work_bootstrap";
    const tokenPrefix = legacyBootstrap ? LEGACY_TOKEN_PREFIX : TOKEN_PREFIX;
    const tokenVersion = legacyBootstrap ? "v1" : "v2";
    return Object.freeze({
      schema_version: "nyra_governed_continuation_v1",
      available: true,
      submit_tool: "nyra_governed_continue",
      candidate_attestation: `${tokenPrefix}.${encoded}.${hmac(key, payload, tokenVersion)}`,
      expires_at: payload.expires_at,
      operations: Object.freeze([...payload.allowed_operations]),
      reason: null,
    });
  }

  function issue({ identity, directive, continuationOperation: requestedOperation = null }) {
    if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE)) {
      return unavailable("registered_host_capability_required");
    }
    const ticket = directive?.ticket_request;
    const binding = ticket?.binding;
    const workBootstrap = ticket?.state === WORK_BOOTSTRAP_STATE &&
      ticket?.action_class === "WORK_BOOTSTRAP";
    if (!binding || binding.tenant_id !== identity.tenantId ||
        !DIRECTIVE_ID.test(String(directive.directive_id || "")) ||
        !SHA256.test(String(directive.request_digest || ""))) {
      return unavailable("ticket_candidate_binding_incomplete");
    }
    const internalOperations = workBootstrap
      ? []
      : allowedInternalOperations(identity, directive, binding);
    const workActionReady = ticket?.required === true &&
      READY_STATES.has(ticket.state) &&
      SHA256.test(String(ticket.request_digest || "")) &&
      (ACTION_KIND_BY_CLASS[ticket.action_class]?.size || 0) > 0;
    const externalOperations = workActionReady
      ? [
          ...(hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE)
            ? ["issue_delegation"] : []),
          ...(hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE)
            ? ["authorize_action"] : []),
        ]
      : [];
    if (!workBootstrap && internalOperations.length === 0 && externalOperations.length === 0) {
      return unavailable(`ticket_candidate_${String(ticket?.state || "unavailable").toLowerCase()}`);
    }
    if (workBootstrap) {
      if (ticket?.required !== true || !SHA256.test(String(ticket.request_digest || ""))) {
        return unavailable("work_bootstrap_candidate_binding_incomplete");
      }
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_CREATE)) {
        return unavailable("registered_host_work_create_capability_required");
      }
      if (binding.work_id !== null || binding.work_revision !== null ||
          binding.intent_digest !== null || binding.context_digest !== null ||
          !PROJECT_ID.test(String(binding.project_id || "")) ||
          !SHA256.test(String(ticket.work_bootstrap_request_digest || ""))) {
        return unavailable("work_bootstrap_candidate_binding_incomplete");
      }
    } else if (!WORK_ID.test(String(binding.work_id || "")) ||
        !Number.isSafeInteger(Number(binding.work_revision)) ||
        !SHA256.test(String(binding.intent_digest || "")) ||
        !SHA256.test(String(binding.context_digest || "")) ||
        !PROJECT_ID.test(String(binding.project_id || ""))) {
      return unavailable("ticket_candidate_binding_incomplete");
    }
    const principal = identity.authenticatedHostPrincipal;
    const hostKind = authenticatedHostKind(identity);
    if (!workBootstrap && !SUPPORTED_HOST_NATIVE_KINDS.has(hostKind)) {
      return unavailable("host_native_host_kind_not_supported");
    }
    const continuationOperation = requestedOperation === null
      ? null
      : String(requestedOperation || "").trim();
    if (workBootstrap) {
      if (continuationOperation !== null) {
        return unavailable("work_bootstrap_continuation_operation_invalid");
      }
    } else if (externalOperations.length > 0 &&
        (!ACTION_CONTINUATION_OPERATIONS.has(continuationOperation) ||
          !externalOperations.includes(continuationOperation))) {
      return unavailable("continuation_operation_required");
    } else if (externalOperations.length === 0 && continuationOperation !== null) {
      return unavailable("continuation_operation_invalid");
    }
    const issuedAt = now();
    const expiresAt = issuedAt + boundedTtl;
    const candidateKind = workBootstrap
      ? "work_bootstrap"
      : externalOperations.length > 0 ? "work_action" : "work_continuation";
    const allowedOperations = workBootstrap
      ? ["review_work_bootstrap", "create_work"]
      : externalOperations.length > 0 ? externalOperations : internalOperations;
    const payload = {
      schema_version: workBootstrap ? LEGACY_ATTESTATION_SCHEMA : ATTESTATION_SCHEMA,
      tenant_id: identity.tenantId,
      app_id: principal.app_id,
      host_kind: hostKind,
      host_registry_revision: principal.registry_revision,
      session_fingerprint: identity.agentPresence?.session_fingerprint,
      directive_id: directive.directive_id,
      directive_request_digest: directive.request_digest,
      ticket_request_digest: SHA256.test(String(ticket.request_digest || ""))
        ? ticket.request_digest
        : null,
      ticket_state: ticket.state,
      candidate_kind: candidateKind,
      allowed_operations: allowedOperations,
      action_class: ticket.action_class,
      merge_policy: ticket.merge_policy,
      work_id: binding.work_id,
      project_id: binding.project_id,
      work_revision: binding.work_revision,
      intent_digest: binding.intent_digest,
      context_digest: binding.context_digest,
      work_bootstrap_request_digest: workBootstrap
        ? ticket.work_bootstrap_request_digest
        : null,
      ...(!workBootstrap ? { continuation_operation: continuationOperation } : {}),
      native_plan_id: null,
      native_plan_digest: null,
      native_plan_tasks: null,
      parent_nonce_digest: null,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      nonce: crypto.randomBytes(18).toString("base64url"),
    };
    if (!/^[a-f0-9]{16,64}$/i.test(String(payload.session_fingerprint || ""))) {
      return unavailable("transport_bound_agent_presence_required");
    }
    return encodedContinuation(payload);
  }

  function issueNativePlanBinding({ identity, parentPayload, planResult }) {
    if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE) ||
        !hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE) ||
        parentPayload?.tenant_id !== identity?.tenantId ||
        parentPayload?.app_id !== identity?.authenticatedHostPrincipal?.app_id ||
        parentPayload?.host_kind !== authenticatedHostKind(identity) ||
        parentPayload?.session_fingerprint !== identity?.agentPresence?.session_fingerprint ||
        !Array.isArray(parentPayload?.allowed_operations) ||
        !parentPayload.allowed_operations.includes("create_native_plan")) {
      fail("nyra_governed_continue_native_plan_binding_invalid", 403);
    }
    const issuedAt = now();
    const parentIssuedAt = Date.parse(String(parentPayload.issued_at || ""));
    const parentExpiresAt = Date.parse(String(parentPayload.expires_at || ""));
    if (!Number.isFinite(parentIssuedAt) || !Number.isFinite(parentExpiresAt) ||
        parentIssuedAt > issuedAt + 30_000 || parentExpiresAt <= issuedAt ||
        parentExpiresAt <= parentIssuedAt || parentExpiresAt - parentIssuedAt > 600_000) {
      fail("nyra_governed_continue_native_plan_parent_expired", 409);
    }
    const core = planResult?.structuredContent?.result || {};
    const plan = core.plan;
    const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
    if (core.tenant_id !== identity.tenantId || core.work_id !== parentPayload.work_id ||
        !WORK_ID.test(String(plan?.plan_id || "")) ||
        !SHA256.test(String(core.plan_digest || "")) ||
        plan?.host_type !== parentPayload.host_kind ||
        plan?.coordinator_session_fingerprint !== parentPayload.session_fingerprint ||
        tasks.length < 1 || tasks.length > 3 || tasks.some((task) => (
          !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(String(task?.task_id || "")) ||
          !SHA256.test(String(task?.task_digest || ""))
        ))) {
      fail("nyra_governed_continue_native_plan_binding_invalid", 409);
    }
    const expiresAt = Math.min(parentExpiresAt, issuedAt + boundedTtl);
    return encodedContinuation({
      schema_version: ATTESTATION_SCHEMA,
      tenant_id: parentPayload.tenant_id,
      app_id: parentPayload.app_id,
      host_kind: parentPayload.host_kind,
      host_registry_revision: parentPayload.host_registry_revision,
      session_fingerprint: parentPayload.session_fingerprint,
      directive_id: parentPayload.directive_id,
      directive_request_digest: parentPayload.directive_request_digest,
      ticket_request_digest: null,
      ticket_state: "NOT_REQUIRED",
      candidate_kind: "native_plan_bind",
      allowed_operations: [NATIVE_PLAN_BIND_OPERATION],
      action_class: "NONE",
      merge_policy: "NOT_APPLICABLE",
      work_id: parentPayload.work_id,
      project_id: parentPayload.project_id,
      work_revision: parentPayload.work_revision,
      intent_digest: parentPayload.intent_digest,
      context_digest: parentPayload.context_digest,
      work_bootstrap_request_digest: null,
      continuation_operation: null,
      native_plan_id: plan.plan_id,
      native_plan_digest: core.plan_digest,
      native_plan_tasks: tasks.map((task) => ({
        task_id: task.task_id,
        task_digest: task.task_digest,
      })),
      parent_nonce_digest: sha256(parentPayload.nonce),
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      nonce: crypto.randomBytes(18).toString("base64url"),
    });
  }

  function verify({
    token,
    identity,
    idempotencyKey,
    replayScope = "single",
    operation = null,
    replayOperation = null,
  }) {
    const { prefix, payload, signature } = parseToken(token);
    const legacyBootstrap = prefix === LEGACY_TOKEN_PREFIX &&
      payload?.schema_version === LEGACY_ATTESTATION_SCHEMA &&
      payload?.candidate_kind === "work_bootstrap";
    const currentAttestation = prefix === TOKEN_PREFIX &&
      payload?.schema_version === ATTESTATION_SCHEMA;
    if ((!currentAttestation && !legacyBootstrap) ||
        !safeEqual(signature, hmac(key, payload, legacyBootstrap ? "v1" : "v2")) ||
        payload.tenant_id !== identity?.tenantId ||
        payload.app_id !== identity?.authenticatedHostPrincipal?.app_id ||
        payload.host_kind !== authenticatedHostKind(identity) ||
        payload.host_registry_revision !== identity?.authenticatedHostPrincipal?.registry_revision ||
        payload.session_fingerprint !== identity?.agentPresence?.session_fingerprint ||
        !DIRECTIVE_ID.test(String(payload.directive_id || "")) ||
        !SHA256.test(String(payload.directive_request_digest || "")) ||
        !(payload.ticket_request_digest === null ||
          SHA256.test(String(payload.ticket_request_digest || ""))) ||
        !Array.isArray(payload.allowed_operations) ||
        payload.allowed_operations.length < 1 ||
        payload.allowed_operations.length > 6 ||
        new Set(payload.allowed_operations).size !== payload.allowed_operations.length ||
        payload.allowed_operations.some((item) => !GOVERNED_OPERATIONS.has(item)) ||
        (operation && !payload.allowed_operations.includes(operation)) ||
        !NONCE.test(String(payload.nonce || ""))) {
      fail("nyra_governed_continue_attestation_binding_mismatch", 403);
    }
    const workBootstrap = payload.candidate_kind === "work_bootstrap";
    const signedContinuationOperation = legacyBootstrap
      ? null
      : payload.continuation_operation;
    if (workBootstrap) {
      if (payload.ticket_state !== WORK_BOOTSTRAP_STATE ||
          payload.action_class !== "WORK_BOOTSTRAP" ||
          payload.work_id !== null || payload.work_revision !== null ||
          payload.intent_digest !== null || payload.context_digest !== null ||
          signedContinuationOperation !== null ||
          !PROJECT_ID.test(String(payload.project_id || "")) ||
          !SHA256.test(String(payload.work_bootstrap_request_digest || "")) ||
          payload.ticket_request_digest === null ||
          payload.allowed_operations.join("\u0000") !==
            ["review_work_bootstrap", "create_work"].join("\u0000")) {
        fail("nyra_governed_continue_attestation_binding_mismatch", 403);
      }
    } else if (!WORK_ID.test(String(payload.work_id || "")) ||
        !PROJECT_ID.test(String(payload.project_id || "")) ||
        !Number.isSafeInteger(Number(payload.work_revision)) ||
        !SHA256.test(String(payload.intent_digest || "")) ||
        !SHA256.test(String(payload.context_digest || ""))) {
      fail("nyra_governed_continue_attestation_binding_mismatch", 403);
    }
    if (payload.candidate_kind === "work_action" && (
      !READY_STATES.has(payload.ticket_state) ||
      payload.ticket_request_digest === null ||
      (ACTION_KIND_BY_CLASS[payload.action_class]?.size || 0) < 1 ||
      !ACTION_CONTINUATION_OPERATIONS.has(signedContinuationOperation) ||
      !payload.allowed_operations.includes(signedContinuationOperation) ||
      payload.allowed_operations.some((item) =>
        !["issue_delegation", "authorize_action"].includes(item))
    )) fail("nyra_governed_continue_attestation_binding_mismatch", 403);
    if (payload.candidate_kind === "work_continuation" && (
      signedContinuationOperation !== null ||
      payload.allowed_operations.some((item) =>
        !WORK_CONTINUATION_OPERATIONS.includes(item)) ||
      payload.native_plan_id !== null || payload.native_plan_digest !== null ||
      payload.native_plan_tasks !== null || payload.parent_nonce_digest !== null
    )) fail("nyra_governed_continue_attestation_binding_mismatch", 403);
    if (payload.candidate_kind === "native_plan_bind") {
      const tasks = payload.native_plan_tasks;
      if (signedContinuationOperation !== null ||
          payload.allowed_operations.length !== 1 ||
          payload.allowed_operations[0] !== NATIVE_PLAN_BIND_OPERATION ||
          payload.ticket_request_digest !== null ||
          payload.ticket_state !== "NOT_REQUIRED" || payload.action_class !== "NONE" ||
          !WORK_ID.test(String(payload.native_plan_id || "")) ||
          !SHA256.test(String(payload.native_plan_digest || "")) ||
          !SHA256.test(String(payload.parent_nonce_digest || "")) ||
          !Array.isArray(tasks) || tasks.length < 1 || tasks.length > 3 ||
          tasks.some((task) => (
            !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(String(task?.task_id || "")) ||
            !SHA256.test(String(task?.task_digest || ""))
          ))) fail("nyra_governed_continue_attestation_binding_mismatch", 403);
    } else if (!["work_bootstrap", "work_action", "work_continuation"].includes(
      payload.candidate_kind,
    )) fail("nyra_governed_continue_attestation_binding_mismatch", 403);
    const issuedAt = Date.parse(String(payload.issued_at || ""));
    const expiresAt = Date.parse(String(payload.expires_at || ""));
    const current = now();
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
        issuedAt > current + 30_000 || expiresAt <= current ||
        expiresAt - issuedAt > 600_000) {
      fail("nyra_governed_continue_attestation_expired", 409);
    }
    const replayKey = String(idempotencyKey || "").trim();
    if (replayKey.length < 8 || replayKey.length > 160) {
      fail("nyra_governed_continue_idempotency_invalid");
    }
    const scope = String(replayScope || "single").trim();
    if (!/^[a-z0-9_]{3,40}$/.test(scope)) fail("nyra_governed_continue_replay_scope_invalid");
    const effectiveReplayOperation = String(
      operation || replayOperation ||
      (payload.candidate_kind === "work_action" ? signedContinuationOperation : "single"),
    ).trim();
    if (!/^[a-z_]{3,40}$/.test(effectiveReplayOperation)) {
      fail("nyra_governed_continue_replay_operation_invalid");
    }
    if (payload.candidate_kind === "work_action" &&
        effectiveReplayOperation !== signedContinuationOperation) {
      fail("nyra_governed_continue_operation_mismatch", 409);
    }
    const replayBindingKey = `${payload.nonce}:${scope}`;
    const replayBinding = `${effectiveReplayOperation}\u0000${replayKey}`;
    const existing = replayBindings.get(replayBindingKey);
    if (existing && existing !== replayBinding) {
      fail("nyra_governed_continue_attestation_replayed", 409);
    }
    replayBindings.set(replayBindingKey, replayBinding);
    for (const [nonce, binding] of replayBindings) {
      if (replayBindings.size <= 2_048) break;
      if (nonce !== replayBindingKey || binding !== replayBinding) replayBindings.delete(nonce);
    }
    return Object.freeze({
      ...payload,
      continuation_operation: signedContinuationOperation,
    });
  }

  return Object.freeze({ issue, issueNativePlanBinding, verify });
}

export function createNyraGovernedContinuationIssuer(attestor) {
  if (!attestor || typeof attestor.issue !== "function") {
    throw new Error("nyra_governed_continue_attestor_invalid");
  }
  return function issueNyraGovernedContinuation(candidate) {
    return attestor.issue(candidate);
  };
}

function ensureFreshWorkContext(context, payload, identity) {
  const revision = Number(context?.work_revision);
  if (context?.available !== true ||
      String(context?.work_id || "").toLowerCase() !== String(payload.work_id).toLowerCase() ||
      context?.project_id !== payload.project_id ||
      revision !== payload.work_revision ||
      context?.intent_digest !== payload.intent_digest ||
      context?.context_digest !== payload.context_digest) {
    fail("nyra_governed_continue_work_drift", 409);
  }
  const status = String(context.status || "").toUpperCase();
  if (WORK_CONTINUATION_TERMINAL_STATES.has(status)) {
    fail("nyra_governed_continue_work_state_invalid", 409);
  }
}

function actionKindAllowed(actionClass, kind) {
  return ACTION_KIND_BY_CLASS[actionClass]?.has(String(kind || "")) === true;
}

const OPERATION_REQUEST_FIELDS = Object.freeze([
  "work_bootstrap",
  "review_id",
  "review_digest",
  "review_decision",
  "delegation_request",
  "action_request",
  "resume_request",
  "native_plan_request",
  "native_bind_request",
]);

function requireExclusiveOperationRequest(args, allowedFields) {
  for (const field of OPERATION_REQUEST_FIELDS) {
    if (args[field] !== undefined && !allowedFields.includes(field)) {
      fail("nyra_governed_continue_operation_request_mismatch", 409);
    }
  }
}

function requireNativeRequestBinding(request, payload, identity, {
  hostRequired = false,
  sessionRequired = false,
} = {}) {
  if (String(request?.work_id || "").toLowerCase() !== String(payload.work_id).toLowerCase() ||
      (sessionRequired &&
        String(request?.session_id || "") !== String(identity?.agentPresence?.session_id || ""))) {
    fail("nyra_governed_continue_native_request_binding_mismatch", 409);
  }
  if (hostRequired && (
    request.host_type !== payload.host_kind ||
    request.host_type !== authenticatedHostKind(identity)
  )) fail("nyra_governed_continue_native_request_binding_mismatch", 409);
}

function nyraResult(payload, coreResult, operation = null, nextContinuation = null) {
  const core = coreResult?.structuredContent || {};
  const ticket = core.action_ticket?.ticket || core.action_ticket?.action_ticket?.ticket || null;
  const delegation = core.delegation || null;
  const review = core.result?.review_id ? core.result : null;
  const work = core.result?.work?.work_id ? core.result.work : null;
  const consumedReview = operation === "review_work_bootstrap" &&
    review?.consumed === true && Boolean(review?.consumed_work_id);
  const workId = payload.work_id || work?.work_id || review?.consumed_work_id || null;
  const bootstrapReviewReady = operation === "review_work_bootstrap" && review;
  const workReplayed = consumedReview ||
    (operation === "create_work" && work && core.result?.idempotent_replay === true);
  const workCreated = operation === "create_work" && work && !workReplayed;
  const workResumed = operation === "resume_existing_work" && core.result?.resumed === true;
  const nativePlanCreated = operation === "create_native_plan" &&
    WORK_ID.test(String(core.result?.plan?.plan_id || ""));
  const nativeChildBound = operation === "bind_native_child" &&
    Boolean(core.result?.binding?.task_id);
  const response = Object.freeze({
    schema_version: "nyra_governed_continue_result_v1",
    ok: true,
    tenant_id: payload.tenant_id,
    directive_id: payload.directive_id,
    work_id: workId,
    action_class: payload.action_class,
    core_authority: "UNIVERSAL_CORE",
    core_result: core,
    delegation_issued: Boolean(delegation?.delegation_id),
    ticket_issued: Boolean(ticket?.ticket_id),
    ticket_id: ticket?.ticket_id || null,
    work_bootstrap_reviewed: Boolean(bootstrapReviewReady),
    work_created: Boolean(workCreated),
    work_replayed: Boolean(workReplayed),
    work_resumed: Boolean(workResumed),
    native_plan_created: Boolean(nativePlanCreated),
    native_child_bound: Boolean(nativeChildBound),
    plan_id: core.result?.plan?.plan_id || core.result?.plan_id || null,
    bound_task_id: nativeChildBound ? core.result.binding.task_id : null,
    next_governed_continuation: nextContinuation,
    review_id: review?.review_id || null,
    review_digest: review?.review_digest || null,
    duplicate_review_requires_owner_decision:
      review?.requires_owner_decision === true,
    merge_policy: payload.merge_policy,
    execution_authorized: false,
    external_action_authorized: false,
    provider_execution: false,
    host_response_contract: Object.freeze({
      speaker: "Nyra",
      reply_seed: workResumed
        ? `Ho ripreso il Work canonico ${workId} attraverso il gate dedicato di Universal Core. Nessuna azione esterna è stata eseguita.`
        : nativePlanCreated
          ? `Ho creato il piano nativo bounded ${core.result.plan.plan_id}. Il prossimo candidato firmato può bindare soltanto i task attestati di questo piano.`
          : nativeChildBound
            ? `Ho bindato il task nativo ${core.result.binding.task_id} alla presenza figlio dichiarata. Il report resta riservato alla sessione child transport-bound.`
            : workCreated
        ? `Universal Core ha autorizzato il bootstrap e il Work canonico V2 ${workId} è stato creato. Nessuna azione esterna è stata eseguita.`
        : consumedReview
          ? `La review era già stata consumata: ho ripreso il Work canonico V2 ${workId} senza crearne un duplicato. Nessuna azione esterna è stata eseguita.`
        : workReplayed
          ? `Il bootstrap era già stato consumato: ho ripreso il Work canonico V2 ${workId} senza crearne un duplicato. Nessuna azione esterna è stata eseguita.`
        : bootstrapReviewReady && review.requires_owner_decision === true
          ? "La review ha rilevato un possibile conflitto. Non ho creato alcun Work: serve selezionare quello canonico o una decisione owner esplicita e request-bound."
          : bootstrapReviewReady
            ? "La review anti-duplicato non ha rilevato conflitti bloccanti. Il Work non è ancora stato creato: serve la conferma owner fresca sul bootstrap esatto."
            : ticket?.ticket_id
        ? "Universal Core ha emesso il ticket bounded. Nessuna azione esterna è stata eseguita; se il merge è manuale, resta all'owner."
        : delegation?.delegation_id
          ? "Universal Core ha emesso la delega bounded. Il passo successivo è richiedere il ticket esatto; nessuna azione esterna è stata eseguita."
          : "Universal Core ha valutato la richiesta senza autorizzare o eseguire un'azione esterna.",
    }),
  });
  return {
    structuredContent: response,
    content: [{ type: "text", text: response.host_response_contract.reply_seed }],
  };
}

export function createNyraGovernedContinueHandler({
  attestor,
  readDirectiveContext,
  normalizeDirectiveContext,
  issueDelegation,
  authorizeAction,
  reviewWorkBootstrap,
  createWorkBootstrap,
  resumeExistingWork,
  createNativePlan,
  bindNativeChild,
  authorizeNativeCoordination,
} = {}) {
  if (!attestor || typeof attestor.verify !== "function" ||
      typeof attestor.issueNativePlanBinding !== "function" ||
      typeof readDirectiveContext !== "function" ||
      typeof normalizeDirectiveContext !== "function" ||
      typeof issueDelegation !== "function" ||
      typeof authorizeAction !== "function" ||
      typeof reviewWorkBootstrap !== "function" ||
      typeof createWorkBootstrap !== "function") {
    throw new Error("nyra_governed_continue_dependencies_invalid");
  }
  return async function nyraGovernedContinue(args = {}, identity = {}) {
    const operation = String(args.operation || "");
    if (!GOVERNED_OPERATIONS.has(operation)) {
      fail("nyra_governed_continue_operation_invalid");
    }
    const bootstrapOperation = ["review_work_bootstrap", "create_work"].includes(args.operation);
    const requestDigest = continuationRequestDigest(args);
    const replayScope = replayScopeForOperation(args);
    const payload = attestor.verify({
      token: args.candidate_attestation,
      identity,
      idempotencyKey: replayBindingKey(args.idempotency_key, requestDigest),
      replayScope,
      operation,
    });
    // The caller key is only a request correlation input. Downstream Core and
    // Work stores receive a token-derived key so a replay after restart or on
    // another replica converges on the same durable idempotency record instead
    // of minting a second delegation, ticket or review.
    const governedOperation = payload.candidate_kind === "work_action"
      ? payload.continuation_operation
      : operation;
    const governedIdempotencyKey = continuationIdempotencyKey(
      payload,
      governedOperation,
      replayScope,
    );
    if (payload.candidate_kind === "work_bootstrap") {
      if (!bootstrapOperation) fail("nyra_governed_continue_candidate_kind_mismatch", 409);
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_CREATE)) {
        fail("nyra_governed_continue_work_create_capability_required", 403);
      }
      requireExclusiveOperationRequest(
        args,
        args.operation === "review_work_bootstrap"
          ? ["work_bootstrap"]
          : ["work_bootstrap", "review_id", "review_digest", "review_decision"],
      );
      if (!args.work_bootstrap) {
        fail("nyra_governed_continue_work_bootstrap_binding_mismatch", 409);
      }
      const request = materializeGovernedWorkBootstrapRequest({
        spec: args.work_bootstrap,
        identity,
        projectId: payload.project_id,
      });
      if (governedWorkBootstrapDigest(request) !== payload.work_bootstrap_request_digest) {
        fail("nyra_governed_continue_work_bootstrap_binding_mismatch", 409);
      }
      if (args.operation === "review_work_bootstrap") {
        if (args.review_id !== undefined || args.review_digest !== undefined ||
            args.review_decision !== undefined) {
          fail("nyra_governed_continue_work_bootstrap_review_mismatch", 409);
        }
        const result = await reviewWorkBootstrap({
          request: `${request.work_name} ${request.objective}`.slice(0, 8_000),
          intent_type: "CREATE_WORK",
          create_request: request,
          idempotency_key: governedIdempotencyKey,
        }, identity);
        return nyraResult(payload, result, args.operation);
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(args.review_id || "")) ||
          !SHA256.test(String(args.review_digest || "")) ||
          (args.review_decision !== undefined &&
            !["CONTINUE_NEW_WORK", "PARALLEL_VALID"].includes(args.review_decision))) {
        fail("nyra_governed_continue_work_bootstrap_review_required", 409);
      }
      if (args.owner_confirmed !== true || identity.ownerConfirmed !== true) {
        fail("owner_confirmation_required", 403);
      }
      const result = await createWorkBootstrap({
        ...request,
        review_id: args.review_id,
        review_digest: args.review_digest,
        idempotency_key: governedIdempotencyKey,
        ...(args.review_decision ? { review_decision: args.review_decision } : {}),
      }, identity);
      return nyraResult(payload, result, args.operation);
    }
    if (bootstrapOperation) {
      fail("nyra_governed_continue_candidate_kind_mismatch", 409);
    }
    const rawContext = await readDirectiveContext(identity, {
      work_id: payload.work_id,
      project_id: payload.project_id,
      work_revision: payload.work_revision,
      intent_digest: payload.intent_digest,
    });
    const context = normalizeDirectiveContext(rawContext, identity, {
      work_id: payload.work_id,
      project_id: payload.project_id,
      work_revision: payload.work_revision,
      intent_digest: payload.intent_digest,
    });
    ensureFreshWorkContext(context, payload, identity);
    if (args.operation === "resume_existing_work") {
      requireExclusiveOperationRequest(args, ["resume_request"]);
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_OPERATE)) {
        fail("nyra_governed_continue_work_operate_capability_required", 403);
      }
      if (args.owner_confirmed !== true || identity.ownerConfirmed !== true) {
        fail("owner_confirmation_required", 403);
      }
      const request = validateContinuationRequest(
        "work_continuity_resume",
        args.resume_request,
        governedIdempotencyKey,
      );
      requireNativeRequestBinding(request, payload, identity, { sessionRequired: true });
      const result = await resumeExistingWork(request, identity);
      return nyraResult(payload, result, args.operation);
    }
    if (args.operation === "create_native_plan") {
      requireExclusiveOperationRequest(args, ["native_plan_request"]);
      if (args.owner_confirmed !== undefined || args.confirmation_reference !== undefined) {
        fail("nyra_governed_continue_native_request_reserved", 403);
      }
      if (!SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) {
        fail("nyra_governed_continue_host_kind_not_supported", 403);
      }
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE)) {
        fail("nyra_governed_continue_delegation_capability_required", 403);
      }
      const request = validateContinuationRequest(
        "work_continuity_native_plan",
        args.native_plan_request,
        governedIdempotencyKey,
      );
      requireNativeRequestBinding(request, payload, identity, { hostRequired: true });
      await authorizeNativeCoordination({
        operation: args.operation,
        tool_name: "work_continuity_native_plan",
        work_id: payload.work_id,
        request_digest: requestDigest,
        idempotency_key: governedIdempotencyKey,
      }, identity);
      const result = await createNativePlan(request, identity);
      const nextContinuation = attestor.issueNativePlanBinding({
        identity,
        parentPayload: payload,
        planResult: result,
      });
      return nyraResult(payload, result, args.operation, nextContinuation);
    }
    if (args.operation === NATIVE_PLAN_BIND_OPERATION) {
      requireExclusiveOperationRequest(args, ["native_bind_request"]);
      if (payload.candidate_kind !== "native_plan_bind") {
        fail("nyra_governed_continue_candidate_kind_mismatch", 409);
      }
      if (args.owner_confirmed !== undefined || args.confirmation_reference !== undefined) {
        fail("nyra_governed_continue_native_request_reserved", 403);
      }
      if (!SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) {
        fail("nyra_governed_continue_host_kind_not_supported", 403);
      }
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE)) {
        fail("nyra_governed_continue_delegation_capability_required", 403);
      }
      const request = validateContinuationRequest(
        "work_continuity_native_bind",
        args.native_bind_request,
        governedIdempotencyKey,
      );
      requireNativeRequestBinding(request, payload, identity, { hostRequired: true });
      const attestedTask = payload.native_plan_tasks.find(
        (task) => task.task_id === request.task_id,
      );
      if (request.plan_id !== payload.native_plan_id || !attestedTask) {
        fail("nyra_governed_continue_native_bind_binding_mismatch", 409);
      }
      await authorizeNativeCoordination({
        operation: args.operation,
        tool_name: "work_continuity_native_bind",
        work_id: payload.work_id,
        plan_id: payload.native_plan_id,
        task_id: request.task_id,
        request_digest: requestDigest,
        idempotency_key: governedIdempotencyKey,
      }, identity);
      const result = await bindNativeChild(request, identity);
      const bound = result?.structuredContent?.result;
      if (bound?.work_id !== payload.work_id || bound?.plan_id !== payload.native_plan_id ||
          bound?.binding?.task_id !== request.task_id ||
          bound?.binding?.task_digest !== attestedTask.task_digest ||
          bound?.binding?.agent_id !== request.native_agent_id ||
          bound?.binding?.host_type !== request.host_type ||
          bound?.binding?.host_task_id !== request.host_task_id) {
        fail("nyra_governed_continue_native_bind_readback_mismatch", 409);
      }
      return nyraResult(payload, result, args.operation);
    }
    if (args.operation === "issue_delegation") {
      requireExclusiveOperationRequest(args, ["delegation_request"]);
      if (!SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) {
        fail("nyra_governed_continue_host_kind_not_supported", 403);
      }
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE)) {
        fail("nyra_governed_continue_delegation_capability_required", 403);
      }
      const request = args.delegation_request;
      if (!request || args.action_request !== undefined ||
          request.work_id !== payload.work_id ||
          request.intent_anchor_digest !== payload.intent_digest ||
          !Array.isArray(request.audience) || request.audience.length !== 1 ||
          request.audience[0] !== payload.host_kind ||
          !Array.isArray(request.allowed_actions) || request.allowed_actions.length < 1 ||
          request.allowed_actions.some((kind) => !actionKindAllowed(payload.action_class, kind))) {
        fail("nyra_governed_continue_delegation_binding_mismatch", 409);
      }
      if (args.owner_confirmed !== true || identity.ownerConfirmed !== true) {
        fail("owner_confirmation_required", 403);
      }
      const result = await issueDelegation({
        ...request,
        idempotency_key: governedIdempotencyKey,
      }, identity);
      return nyraResult(payload, result);
    }
    if (args.operation === "authorize_action") {
      requireExclusiveOperationRequest(args, ["action_request"]);
      if (!SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) {
        fail("nyra_governed_continue_host_kind_not_supported", 403);
      }
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE)) {
        fail("nyra_governed_continue_action_capability_required", 403);
      }
      const request = args.action_request;
      if (!request || args.delegation_request !== undefined ||
          request.work_id !== payload.work_id ||
          request.intent_anchor_digest !== payload.intent_digest ||
          !actionKindAllowed(payload.action_class, request.action?.kind)) {
        fail("nyra_governed_continue_action_binding_mismatch", 409);
      }
      const result = await authorizeAction({
        ...request,
        idempotency_key: governedIdempotencyKey,
      }, identity);
      return nyraResult(payload, result);
    }
    fail("nyra_governed_continue_operation_invalid");
  };
}

export { ACTION_KIND_BY_CLASS, continuationIdempotencyKey };
