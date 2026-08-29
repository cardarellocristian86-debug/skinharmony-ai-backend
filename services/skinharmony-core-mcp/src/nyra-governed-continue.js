import crypto from "node:crypto";

import { HOST_APP_CAPABILITIES, authenticatedHostKind, hostPrincipalAllows } from "./host-app-registry.js";
import { SUPPORTED_HOST_NATIVE_KINDS } from "./host-app-authorization.js";
import { governedWorkBootstrapDigest, materializeGovernedWorkBootstrapRequest } from "./work-bootstrap-contract.js";

const SHA256 = /^[a-f0-9]{64}$/;
const READY_STATES = new Set(["READY_FOR_CORE_REVIEW", "MANUAL_ONLY"]);
const WORK_BOOTSTRAP_STATE = "WORK_BOOTSTRAP_READY";
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

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function unavailable(reason) {
  return Object.freeze({
    schema_version: "nyra_continuation_ref_v1",
    available: false,
    continuation_ref: null,
    expires_at: null,
    state: "UNAVAILABLE",
    reason,
  });
}

function candidateKind(directive) {
  const ticket = directive?.ticket_request;
  if (!ticket?.required || !SHA256.test(String(ticket.request_digest || ""))) return null;
  if (ticket.state === WORK_BOOTSTRAP_STATE && ticket.action_class === "WORK_BOOTSTRAP") return "work_bootstrap";
  if (READY_STATES.has(ticket.state) && ACTION_KIND_BY_CLASS[ticket.action_class]?.size) return "work_action";
  return null;
}

// AI boundary: persist and return only a server-side reference.  No signed
// Core candidate is exposed to the model or accepted back from it.
export function createNyraContinuationOpener({ store } = {}) {
  return async function openNyraContinuation({ identity, directive } = {}) {
    if (!store || typeof store.open !== "function") return unavailable("continuation_store_unavailable");
    if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE)) {
      return unavailable("registered_host_capability_required");
    }
    const kind = candidateKind(directive);
    if (!kind) return unavailable("ticket_candidate_unavailable");
    if (kind === "work_bootstrap" && !hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_CREATE)) {
      return unavailable("registered_host_work_create_capability_required");
    }
    if (kind === "work_action" && !SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) {
      return unavailable("host_native_host_kind_not_supported");
    }
    try {
      return await store.open({ identity, directive });
    } catch (error) {
      return unavailable(/^nyra_continuation_[a-z0-9_]+$/.test(String(error?.code || ""))
        ? error.code : "continuation_open_failed");
    }
  };
}

function ensureFreshWorkContext(context, payload) {
  if (context?.available !== true ||
      String(context?.work_id || "").toLowerCase() !== String(payload.work_id).toLowerCase() ||
      context?.project_id !== payload.project_id || Number(context?.work_revision) !== payload.work_revision ||
      context?.intent_digest !== payload.intent_digest || context?.context_digest !== payload.context_digest) {
    fail("nyra_continue_work_drift", 409);
  }
  if (["COMPLETED", "CANCELLED", "SUPERSEDED", "ARCHIVED"].includes(String(context.status || "").toUpperCase())) {
    fail("nyra_continue_work_state_invalid", 409);
  }
}

function actionKindAllowed(actionClass, kind) {
  return ACTION_KIND_BY_CLASS[actionClass]?.has(String(kind || "")) === true;
}

function requestDigest(args) {
  const { continuation_ref: _reference, idempotency_key: _callerKey, ...request } = args || {};
  return digest({ schema_version: "nyra_continue_request_v1", request });
}

function assertCallerInput(args) {
  if (!args || typeof args !== "object") fail("nyra_continue_input_invalid");
  if (!/^nyc1_[A-Za-z0-9_-]{32,80}$/.test(String(args.continuation_ref || ""))) fail("nyra_continue_ref_invalid", 409);
  if (!/^(review_work_bootstrap|create_work|issue_delegation|authorize_action)$/.test(String(args.operation || ""))) {
    fail("nyra_continue_operation_invalid", 409);
  }
  const callerKey = String(args.idempotency_key || "").trim();
  if (callerKey.length < 8 || callerKey.length > 160) fail("nyra_continue_idempotency_invalid");
}

function coreOutcome(coreResult) {
  const core = coreResult?.structuredContent || {};
  const ticket = core.action_ticket?.ticket || core.action_ticket?.action_ticket?.ticket || null;
  const delegation = core.delegation || null;
  const review = core.result?.review_id ? core.result : null;
  const work = core.result?.work?.work_id ? core.result.work : null;
  return Object.freeze({
    ticket_id: ticket?.ticket_id || null,
    ticket_digest: ticket ? digest(ticket) : null,
    delegation_id: delegation?.delegation_id || null,
    review_id: review?.review_id || null,
    review_digest: review?.review_digest || null,
    review_requires_owner_decision: review?.requires_owner_decision === true,
    review_consumed: review?.consumed === true,
    review_consumed_work_id: review?.consumed_work_id || null,
    work_id: work?.work_id || null,
    work_replayed: core.result?.idempotent_replay === true,
  });
}

function nyraResult(payload, outcome, operation, replay = false) {
  const consumedReview = operation === "review_work_bootstrap" && outcome.review_consumed && Boolean(outcome.review_consumed_work_id);
  const workId = payload.work_id || outcome.work_id || outcome.review_consumed_work_id || null;
  const workCreated = operation === "create_work" && Boolean(outcome.work_id) && !outcome.work_replayed;
  const workReplayed = consumedReview || (operation === "create_work" && outcome.work_replayed);
  const response = Object.freeze({
    schema_version: "nyra_continue_result_v2",
    ok: true,
    tenant_id: payload.tenant_id,
    continuation_ref: payload.continuation_ref,
    directive_id: payload.directive_id,
    work_id: workId,
    action_class: payload.action_class,
    core_authority: "UNIVERSAL_CORE",
    replay,
    core_verification: outcome.ticket_id ? Object.freeze({
      ticket_id: outcome.ticket_id,
      ticket_digest: outcome.ticket_digest,
      host_verification: "CORE_HOST_NATIVE_TICKET_LOOKUP_REQUIRED",
    }) : null,
    delegation_issued: Boolean(outcome.delegation_id),
    delegation_id: outcome.delegation_id,
    ticket_issued: Boolean(outcome.ticket_id),
    ticket_id: outcome.ticket_id,
    work_bootstrap_reviewed: operation === "review_work_bootstrap" && Boolean(outcome.review_id),
    work_created: workCreated,
    work_replayed: workReplayed,
    review_id: outcome.review_id,
    duplicate_review_requires_owner_decision: outcome.review_requires_owner_decision,
    merge_policy: payload.merge_policy,
    execution_authorized: false,
    external_action_authorized: false,
    provider_execution: false,
    host_response_contract: Object.freeze({
      speaker: "Nyra",
      reply_seed: workCreated
        ? `Universal Core ha autorizzato il bootstrap e il Work canonico V2 ${workId} è stato creato. Nessuna azione esterna è stata eseguita.`
        : workReplayed
          ? `Ho ripreso il Work canonico V2 ${workId} senza creare un duplicato. Nessuna azione esterna è stata eseguita.`
          : outcome.review_requires_owner_decision
            ? "La review ha rilevato un possibile conflitto. Non ho creato alcun Work: serve una decisione owner esplicita."
            : outcome.review_id
              ? "La review anti-duplicato è completa. Il Work non è ancora stato creato: serve una conferma owner fresca sul bootstrap esatto."
              : outcome.ticket_id
                ? "Universal Core ha emesso il ticket bounded. L’host può verificarlo tramite il registro Core; nessuna azione esterna è stata eseguita."
                : outcome.delegation_id
                  ? "Universal Core ha emesso la delega bounded. Il passo successivo è richiedere il ticket esatto; nessuna azione esterna è stata eseguita."
                  : "Universal Core ha valutato la richiesta senza autorizzare o eseguire un’azione esterna.",
    }),
  });
  return { structuredContent: response, content: [{ type: "text", text: response.host_response_contract.reply_seed }] };
}

export function createNyraGovernedContinueHandler({
  store, readDirectiveContext, normalizeDirectiveContext, issueDelegation,
  authorizeAction, reviewWorkBootstrap, createWorkBootstrap,
} = {}) {
  if (!store || typeof store.claim !== "function" || typeof store.complete !== "function" ||
      typeof store.readCompletedOperation !== "function" || typeof readDirectiveContext !== "function" ||
      typeof normalizeDirectiveContext !== "function" || typeof issueDelegation !== "function" ||
      typeof authorizeAction !== "function" || typeof reviewWorkBootstrap !== "function" ||
      typeof createWorkBootstrap !== "function") throw new Error("nyra_continue_dependencies_invalid");
  return async function nyraContinue(args = {}, identity = {}) {
    assertCallerInput(args);
    if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE)) fail("nyra_continue_host_capability_required", 403);
    const boundRequestDigest = requestDigest(args);
    const claim = await store.claim({ identity, continuation_ref: args.continuation_ref,
      operation: args.operation, request_digest: boundRequestDigest });
    const payload = claim.record;
    if (claim.completed_result) return nyraResult(payload, claim.completed_result, args.operation, true);
    let outcome;
    let terminal = true;
    const bootstrapOperation = ["review_work_bootstrap", "create_work"].includes(args.operation);
    if (payload.candidate_kind === "work_bootstrap") {
      if (!bootstrapOperation || !hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_CREATE) || !args.work_bootstrap ||
          args.delegation_request !== undefined || args.action_request !== undefined) fail("nyra_continue_work_bootstrap_binding_mismatch", 409);
      const request = materializeGovernedWorkBootstrapRequest({ spec: args.work_bootstrap, identity, projectId: payload.project_id });
      if (governedWorkBootstrapDigest(request) !== payload.work_bootstrap_request_digest) fail("nyra_continue_work_bootstrap_binding_mismatch", 409);
      if (args.operation === "review_work_bootstrap") {
        if (args.review_id !== undefined || args.review_digest !== undefined || args.review_decision !== undefined) {
          fail("nyra_continue_work_bootstrap_review_mismatch", 409);
        }
        outcome = coreOutcome(await reviewWorkBootstrap({
          request: `${request.work_name} ${request.objective}`.slice(0, 8_000), intent_type: "CREATE_WORK",
          create_request: request, idempotency_key: claim.idempotency_key,
        }, identity));
        terminal = false;
      } else {
        if (args.owner_confirmed !== true || identity.ownerConfirmed !== true ||
            (args.review_decision !== undefined && !["CONTINUE_NEW_WORK", "PARALLEL_VALID"].includes(args.review_decision))) {
          fail("owner_confirmation_required", 403);
        }
        const review = await store.readCompletedOperation({ identity, continuation_ref: args.continuation_ref,
          operation: "review_work_bootstrap" });
        if (!review.review_id || !SHA256.test(String(review.review_digest || ""))) fail("nyra_continue_work_bootstrap_review_required", 409);
        outcome = coreOutcome(await createWorkBootstrap({ ...request, review_id: review.review_id, review_digest: review.review_digest,
          idempotency_key: claim.idempotency_key, ...(args.review_decision ? { review_decision: args.review_decision } : {}) }, identity));
      }
    } else {
      if (bootstrapOperation || args.work_bootstrap !== undefined || args.review_id !== undefined || args.review_digest !== undefined ||
          args.review_decision !== undefined) fail("nyra_continue_candidate_kind_mismatch", 409);
      const input = { work_id: payload.work_id, project_id: payload.project_id, work_revision: payload.work_revision,
        intent_digest: payload.intent_digest };
      const context = normalizeDirectiveContext(await readDirectiveContext(identity, input), identity, input);
      ensureFreshWorkContext(context, payload);
      if (!SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) fail("nyra_continue_host_kind_not_supported", 403);
      if (args.operation === "issue_delegation") {
        const request = args.delegation_request;
        if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE) || !request || args.action_request !== undefined ||
            request.work_id !== payload.work_id || request.intent_anchor_digest !== payload.intent_digest || !Array.isArray(request.audience) ||
            request.audience.length !== 1 || request.audience[0] !== payload.host_kind || !Array.isArray(request.allowed_actions) ||
            request.allowed_actions.length < 1 || request.allowed_actions.some((kind) => !actionKindAllowed(payload.action_class, kind)) ||
            args.owner_confirmed !== true || identity.ownerConfirmed !== true) fail("nyra_continue_delegation_binding_mismatch", 409);
        outcome = coreOutcome(await issueDelegation({ ...request, idempotency_key: claim.idempotency_key }, identity));
      } else if (args.operation === "authorize_action") {
        const request = args.action_request;
        if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE) || !request || args.delegation_request !== undefined ||
            request.work_id !== payload.work_id || request.intent_anchor_digest !== payload.intent_digest ||
            !actionKindAllowed(payload.action_class, request.action?.kind)) fail("nyra_continue_action_binding_mismatch", 409);
        outcome = coreOutcome(await authorizeAction({ ...request, idempotency_key: claim.idempotency_key }, identity));
      } else fail("nyra_continue_operation_invalid", 409);
    }
    await store.complete({ identity, continuation_ref: args.continuation_ref, operation: args.operation,
      request_digest: boundRequestDigest, internal_result: outcome, terminal });
    return nyraResult(payload, outcome, args.operation, claim.replay);
  };
}

export { ACTION_KIND_BY_CLASS };
