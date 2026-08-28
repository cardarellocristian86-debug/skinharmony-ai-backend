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

const TOKEN_PREFIX = "ngc1";
const SHA256 = /^[a-f0-9]{64}$/;
const WORK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,127}$/;
const DIRECTIVE_ID = /^nyra_dir_[a-f0-9]{24}$/;
const NONCE = /^[A-Za-z0-9_-]{24}$/;
const READY_STATES = new Set(["READY_FOR_CORE_REVIEW", "MANUAL_ONLY"]);
const WORK_BOOTSTRAP_STATE = "WORK_BOOTSTRAP_READY";
const ACTION_KIND_BY_CLASS = Object.freeze({
  GIT_MERGE: new Set(["github.merge"]),
  GIT_COMMIT: new Set(["git.commit"]),
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

function hmac(secret, payload) {
  return crypto.createHmac("sha256", secret)
    .update(`nyra-governed-continue-v1\u0000${JSON.stringify(stable(payload))}`)
    .digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function continuationIdempotencyKey(payload, operation) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(stable({
    schema_version: "nyra_governed_continue_idempotency_v1",
    tenant_id: payload.tenant_id,
    app_id: payload.app_id,
    host_kind: payload.host_kind,
    directive_id: payload.directive_id,
    ticket_request_digest: payload.ticket_request_digest,
    nonce: payload.nonce,
    operation,
  }))).digest("hex");
  return `nyra_cont_${digest.slice(0, 48)}`;
}

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function parseToken(token) {
  const [prefix, encoded, signature, extra] = String(token || "").split(".");
  if (prefix !== TOKEN_PREFIX || !encoded || !signature || extra) {
    fail("nyra_governed_continue_attestation_invalid", 403);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail("nyra_governed_continue_attestation_invalid", 403);
  }
  return { payload, signature };
}

function unavailable(reason) {
  return Object.freeze({
    schema_version: "nyra_governed_continuation_v1",
    available: false,
    submit_tool: null,
    candidate_attestation: null,
    expires_at: null,
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

  function issue({ identity, directive }) {
    if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE)) {
      return unavailable("registered_host_capability_required");
    }
    const ticket = directive?.ticket_request;
    const binding = ticket?.binding;
    const workBootstrap = ticket?.state === WORK_BOOTSTRAP_STATE &&
      ticket?.action_class === "WORK_BOOTSTRAP";
    if (!ticket?.required || (!workBootstrap && !READY_STATES.has(ticket.state)) ||
        !SHA256.test(String(ticket.request_digest || ""))) {
      return unavailable(`ticket_candidate_${String(ticket?.state || "unavailable").toLowerCase()}`);
    }
    if (!binding || binding.tenant_id !== identity.tenantId ||
        !DIRECTIVE_ID.test(String(directive.directive_id || "")) ||
        !SHA256.test(String(directive.request_digest || ""))) {
      return unavailable("ticket_candidate_binding_incomplete");
    }
    if (workBootstrap) {
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
        (ACTION_KIND_BY_CLASS[ticket.action_class]?.size || 0) < 1) {
      return unavailable("ticket_candidate_binding_incomplete");
    }
    const principal = identity.authenticatedHostPrincipal;
    const hostKind = authenticatedHostKind(identity);
    if (!workBootstrap && !SUPPORTED_HOST_NATIVE_KINDS.has(hostKind)) {
      return unavailable("host_native_host_kind_not_supported");
    }
    const issuedAt = now();
    const expiresAt = issuedAt + boundedTtl;
    const payload = {
      schema_version: "nyra_governed_continue_attestation_v1",
      tenant_id: identity.tenantId,
      app_id: principal.app_id,
      host_kind: hostKind,
      host_registry_revision: principal.registry_revision,
      session_fingerprint: identity.agentPresence?.session_fingerprint,
      directive_id: directive.directive_id,
      directive_request_digest: directive.request_digest,
      ticket_request_digest: ticket.request_digest,
      ticket_state: ticket.state,
      candidate_kind: workBootstrap ? "work_bootstrap" : "work_action",
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
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      nonce: crypto.randomBytes(18).toString("base64url"),
    };
    if (!/^[a-f0-9]{16,64}$/i.test(String(payload.session_fingerprint || ""))) {
      return unavailable("transport_bound_agent_presence_required");
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return Object.freeze({
      schema_version: "nyra_governed_continuation_v1",
      available: true,
      submit_tool: "nyra_governed_continue",
      candidate_attestation: `${TOKEN_PREFIX}.${encoded}.${hmac(key, payload)}`,
      expires_at: payload.expires_at,
      reason: null,
    });
  }

  function verify({
    token,
    identity,
    idempotencyKey,
    replayScope = "single",
    replayOperation = "single",
  }) {
    const { payload, signature } = parseToken(token);
    if (!safeEqual(signature, hmac(key, payload)) ||
        payload?.schema_version !== "nyra_governed_continue_attestation_v1" ||
        payload.tenant_id !== identity?.tenantId ||
        payload.app_id !== identity?.authenticatedHostPrincipal?.app_id ||
        payload.host_kind !== authenticatedHostKind(identity) ||
        payload.host_registry_revision !== identity?.authenticatedHostPrincipal?.registry_revision ||
        payload.session_fingerprint !== identity?.agentPresence?.session_fingerprint ||
        !DIRECTIVE_ID.test(String(payload.directive_id || "")) ||
        !SHA256.test(String(payload.directive_request_digest || "")) ||
        !SHA256.test(String(payload.ticket_request_digest || "")) ||
        !NONCE.test(String(payload.nonce || ""))) {
      fail("nyra_governed_continue_attestation_binding_mismatch", 403);
    }
    const workBootstrap = payload.candidate_kind === "work_bootstrap";
    if (workBootstrap) {
      if (payload.ticket_state !== WORK_BOOTSTRAP_STATE ||
          payload.action_class !== "WORK_BOOTSTRAP" ||
          payload.work_id !== null || payload.work_revision !== null ||
          payload.intent_digest !== null || payload.context_digest !== null ||
          !PROJECT_ID.test(String(payload.project_id || "")) ||
          !SHA256.test(String(payload.work_bootstrap_request_digest || ""))) {
        fail("nyra_governed_continue_attestation_binding_mismatch", 403);
      }
    } else if (payload.candidate_kind !== "work_action" ||
        !READY_STATES.has(payload.ticket_state) ||
        !WORK_ID.test(String(payload.work_id || "")) ||
        !Number.isSafeInteger(Number(payload.work_revision)) ||
        !SHA256.test(String(payload.intent_digest || "")) ||
        !SHA256.test(String(payload.context_digest || "")) ||
        (ACTION_KIND_BY_CLASS[payload.action_class]?.size || 0) < 1) {
      fail("nyra_governed_continue_attestation_binding_mismatch", 403);
    }
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
    if (!/^[a-z_]{3,40}$/.test(scope)) fail("nyra_governed_continue_replay_scope_invalid");
    const operation = String(replayOperation || "single").trim();
    if (!/^[a-z_]{3,40}$/.test(operation)) {
      fail("nyra_governed_continue_replay_operation_invalid");
    }
    const replayBindingKey = `${payload.nonce}:${scope}`;
    const replayBinding = `${operation}\u0000${replayKey}`;
    const existing = replayBindings.get(replayBindingKey);
    if (existing && existing !== replayBinding) {
      fail("nyra_governed_continue_attestation_replayed", 409);
    }
    replayBindings.set(replayBindingKey, replayBinding);
    for (const [nonce, binding] of replayBindings) {
      if (replayBindings.size <= 2_048) break;
      if (nonce !== replayBindingKey || binding !== replayBinding) replayBindings.delete(nonce);
    }
    return Object.freeze(payload);
  }

  return Object.freeze({ issue, verify });
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
  if (["COMPLETED", "CANCELLED", "SUPERSEDED", "ARCHIVED"].includes(status)) {
    fail("nyra_governed_continue_work_state_invalid", 409);
  }
}

function actionKindAllowed(actionClass, kind) {
  return ACTION_KIND_BY_CLASS[actionClass]?.has(String(kind || "")) === true;
}

function nyraResult(payload, coreResult, operation = null) {
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
      reply_seed: workCreated
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
} = {}) {
  if (!attestor || typeof attestor.verify !== "function" ||
      typeof readDirectiveContext !== "function" ||
      typeof normalizeDirectiveContext !== "function" ||
      typeof issueDelegation !== "function" ||
      typeof authorizeAction !== "function" ||
      typeof reviewWorkBootstrap !== "function" ||
      typeof createWorkBootstrap !== "function") {
    throw new Error("nyra_governed_continue_dependencies_invalid");
  }
  return async function nyraGovernedContinue(args = {}, identity = {}) {
    const bootstrapOperation = ["review_work_bootstrap", "create_work"].includes(args.operation);
    const payload = attestor.verify({
      token: args.candidate_attestation,
      identity,
      idempotencyKey: args.idempotency_key,
      replayScope: bootstrapOperation ? args.operation : "single",
      replayOperation: args.operation,
    });
    // The caller key is only a request correlation input. Downstream Core and
    // Work stores receive a token-derived key so a replay after restart or on
    // another replica converges on the same durable idempotency record instead
    // of minting a second delegation, ticket or review.
    const governedIdempotencyKey = continuationIdempotencyKey(payload, args.operation);
    if (payload.candidate_kind === "work_bootstrap") {
      if (!bootstrapOperation) fail("nyra_governed_continue_candidate_kind_mismatch", 409);
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_CREATE)) {
        fail("nyra_governed_continue_work_create_capability_required", 403);
      }
      if (!args.work_bootstrap || args.delegation_request !== undefined ||
          args.action_request !== undefined) {
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
    if (bootstrapOperation || args.work_bootstrap !== undefined || args.review_id !== undefined ||
        args.review_digest !== undefined || args.review_decision !== undefined) {
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
    if (args.operation === "issue_delegation") {
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
