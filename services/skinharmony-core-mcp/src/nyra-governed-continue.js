import crypto from "node:crypto";

import { HOST_APP_CAPABILITIES, authenticatedHostKind, hostPrincipalAllows } from "./host-app-registry.js";
import { SUPPORTED_HOST_NATIVE_KINDS } from "./host-app-authorization.js";
import { governedWorkBootstrapDigest, materializeGovernedWorkBootstrapRequest } from "./work-bootstrap-contract.js";

const SHA256 = /^[a-f0-9]{64}$/;
const ACTION_TICKET_ID = /^hnt_(?:[a-f0-9]{32}|[a-f0-9]{64})$/;
const ACTION_TICKET_SIGNATURE = /^hnt_[a-f0-9]{64}$/;
const READY_STATES = new Set(["READY_FOR_CORE_REVIEW", "MANUAL_ONLY"]);
const WORK_BOOTSTRAP_STATE = "WORK_BOOTSTRAP_READY";
const ACTION_KIND_BY_CLASS = Object.freeze({
  GIT_COMMIT: new Set(["git.commit"]),
  GIT_PUSH: new Set(["git.push.branch", "git.push.protected"]),
  PULL_REQUEST_OPEN: new Set(["github.draft_pr"]),
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

function ensureRecoverableFulfilledWorkContext(context, payload) {
  // A continuation opened after fulfillment remains bound to the exact current
  // context. A continuation opened immediately before fulfillment may use the
  // server-derived predecessor proof below, but no other context drift.
  if (context?.context_digest === payload.context_digest) {
    ensureFreshWorkContext(context, payload);
    return;
  }
  if (context?.available !== true ||
      String(context?.work_id || "").toLowerCase() !== String(payload.work_id).toLowerCase() ||
      context?.project_id !== payload.project_id || Number(context?.work_revision) !== payload.work_revision ||
      context?.intent_digest !== payload.intent_digest ||
      !SHA256.test(String(context?.fulfilled_precommit_predecessor_context_digest || "")) ||
      context.fulfilled_precommit_predecessor_context_digest !== payload.context_digest) {
    fail("nyra_continue_work_drift", 409);
  }
  if (["COMPLETED", "CANCELLED", "SUPERSEDED", "ARCHIVED"].includes(String(context.status || "").toUpperCase())) {
    fail("nyra_continue_work_state_invalid", 409);
  }
}

function actionKindAllowed(actionClass, kind) {
  return ACTION_KIND_BY_CLASS[actionClass]?.has(String(kind || "")) === true;
}

function commitPrecommitGate(context, payload, request) {
  const gate = context?.precommit_ticket_gate;
  const hashes = [
    gate?.evaluation_digest,
    gate?.workspace_digest,
    gate?.supersession_digest,
    gate?.reconciliation_digest,
    gate?.projection_digest,
  ];
  const legacyGate = gate?.schema_version === "precommit_ticket_gate_v1";
  const nativeGate = gate?.schema_version === "precommit_ticket_gate_v2" &&
    gate?.gate_source === "native_closure_evaluation";
  const nativeFields = [
    "schema_version", "gate_source", "tenant_id", "work_id", "action_kind", "gate_kind",
    "task_id", "plan_id", "evaluation_id", "evaluation_digest", "workspace_digest",
    "supersession_digest", "reconciliation_digest", "v2_scope_snapshot_digest", "v2_scope_tasks", "legacy_evidence_ids",
    "replacement_evidence_ids", "fulfilled", "ticket_id", "fresh", "drift_codes",
    "projection_digest",
  ];
  const nativeExact = nativeGate &&
    Object.keys(gate).sort().join("\0") === nativeFields.sort().join("\0");
  const { projection_digest: nativeProjectionDigest, ...nativeProjection } = nativeGate ? gate : {};
  if (context?.precommit_ticket_gate_applicable !== true ||
      (!legacyGate && !nativeGate) ||
      gate.action_kind !== "git.commit" || gate.gate_kind !== "ticket_acquisition" ||
      gate.fresh !== true || gate.fulfilled !== false ||
      typeof gate.task_id !== "string" || typeof gate.plan_id !== "string" ||
      typeof gate.evaluation_id !== "string" || hashes.some((value) => !SHA256.test(String(value || ""))) ||
      !Array.isArray(gate.legacy_evidence_ids) ||
      !Array.isArray(gate.replacement_evidence_ids) ||
      (legacyGate && (gate.legacy_evidence_ids.length < 1 || gate.replacement_evidence_ids.length < 1)) ||
      (nativeGate && (!nativeExact || !SHA256.test(String(gate.v2_scope_snapshot_digest || "")) ||
        !Array.isArray(gate.v2_scope_tasks) || gate.legacy_evidence_ids.length !== 0 ||
        gate.replacement_evidence_ids.length !== 0 || digest(nativeProjection) !== nativeProjectionDigest)) ||
      request?.evidence_digest !== gate.projection_digest ||
      payload?.action_class !== "GIT_COMMIT") {
    fail("nyra_continue_precommit_evidence_mismatch", 409);
  }
  return gate;
}

function fulfilledCommitPrecommitGate(context, payload, request) {
  const gate = context?.precommit_ticket_gate;
  const nativeFields = [
    "schema_version", "gate_source", "tenant_id", "work_id", "action_kind", "gate_kind",
    "task_id", "plan_id", "evaluation_id", "evaluation_digest", "workspace_digest",
    "supersession_digest", "reconciliation_digest", "v2_scope_snapshot_digest", "v2_scope_tasks", "legacy_evidence_ids",
    "replacement_evidence_ids", "fulfilled", "ticket_id", "fresh", "drift_codes",
    "projection_digest",
  ];
  const { projection_digest: projectionDigest, ...projection } = gate || {};
  const originalProjection = { ...projection, fulfilled: false, ticket_id: null };
  if (context?.precommit_ticket_gate_applicable !== false ||
      gate?.schema_version !== "precommit_ticket_gate_v2" ||
      gate.gate_source !== "native_closure_evaluation" ||
      Object.keys(gate).sort().join("\0") !== nativeFields.sort().join("\0") ||
      gate.tenant_id !== payload?.tenant_id || gate.work_id !== payload?.work_id ||
      gate.action_kind !== "git.commit" || gate.gate_kind !== "ticket_acquisition" ||
      gate.fresh !== true || gate.fulfilled !== true || !ACTION_TICKET_ID.test(String(gate.ticket_id || "")) ||
      typeof gate.task_id !== "string" || typeof gate.plan_id !== "string" ||
      typeof gate.evaluation_id !== "string" ||
      [gate.evaluation_digest, gate.workspace_digest, gate.supersession_digest,
        gate.v2_scope_snapshot_digest,
        gate.reconciliation_digest, projectionDigest].some((value) => !SHA256.test(String(value || ""))) ||
      !Array.isArray(gate.v2_scope_tasks) ||
      !Array.isArray(gate.legacy_evidence_ids) || gate.legacy_evidence_ids.length !== 0 ||
      !Array.isArray(gate.replacement_evidence_ids) || gate.replacement_evidence_ids.length !== 0 ||
      !Array.isArray(gate.drift_codes) || gate.drift_codes.length !== 0 ||
      digest(projection) !== projectionDigest ||
      request?.evidence_digest !== digest(originalProjection) ||
      payload?.action_class !== "GIT_COMMIT") {
    fail("nyra_continue_precommit_evidence_mismatch", 409);
  }
  return Object.freeze({ gate, original_projection_digest: request.evidence_digest });
}

function nativePrecommitClaimBinding(payload, request, gate, identity, continuationRef,
  requestDigestValue, idempotencyKey) {
  return Object.freeze({
    work_id: payload.work_id,
    continuation_ref: continuationRef,
    request_digest: requestDigestValue,
    delegation_id: request.delegation_id,
    action_digest: digest(request.action),
    gate_projection_digest: gate.projection_digest,
    host_session_fingerprint: String(identity?.agentPresence?.session_fingerprint || "").toLowerCase(),
    idempotency_key: idempotencyKey,
  });
}

function trustedNativePrecommitClaim(value, binding) {
  const fields = [
    "schema_version", "claim_id", "work_id", "continuation_ref", "request_digest",
    "delegation_id", "action_digest", "gate_projection_digest", "host_session_fingerprint",
    "idempotency_key", "replay", "claim_digest",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== fields.sort().join("\0") ||
      value.schema_version !== "precommit_ticket_gate_claim_v1" ||
      typeof value.claim_id !== "string" || value.claim_id.length < 8 || value.claim_id.length > 160 ||
      typeof value.replay !== "boolean" ||
      Object.entries(binding).some(([key, expected]) => value[key] !== expected)) {
    fail("nyra_continue_precommit_claim_invalid", 502);
  }
  const { claim_digest: claimDigest, ...material } = value;
  if (!SHA256.test(String(claimDigest || "")) || digest(material) !== claimDigest) {
    fail("nyra_continue_precommit_claim_invalid", 502);
  }
  return Object.freeze({ ...value });
}

function trustedRecoveredNativePrecommitClaim(value, binding) {
  const fields = [
    "schema_version", "claim_id", "work_id", "continuation_ref", "request_digest",
    "delegation_id", "action_digest", "gate_projection_digest", "host_session_fingerprint",
    "idempotency_key", "replay", "claim_digest",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== fields.sort().join("\0") ||
      value.schema_version !== "precommit_ticket_gate_claim_v1" ||
      typeof value.claim_id !== "string" || value.claim_id.length < 8 || value.claim_id.length > 160 ||
      typeof value.continuation_ref !== "string" || value.continuation_ref.length < 8 ||
      value.continuation_ref.length > 240 ||
      typeof value.idempotency_key !== "string" || value.idempotency_key.length < 1 ||
      value.idempotency_key.length > 160 || value.replay !== true ||
      Object.entries(binding).some(([key, expected]) => value[key] !== expected)) {
    fail("nyra_continue_precommit_claim_recovery_invalid", 502);
  }
  const { claim_digest: claimDigest, ...material } = value;
  if (!SHA256.test(String(claimDigest || "")) || digest(material) !== claimDigest) {
    fail("nyra_continue_precommit_claim_recovery_invalid", 502);
  }
  return Object.freeze({ ...value });
}

function trustedIssuedActionTicket(readback, payload, request, identity, gate, currentTime,
  { allowPriorIssuedAt = false } = {}) {
  const body = readback?.structuredContent;
  const record = body?.action_ticket;
  const ticket = record?.ticket;
  const issuedAt = Date.parse(String(ticket?.issued_at || ""));
  const expiresAt = Date.parse(String(ticket?.expires_at || ""));
  const candidateIssuedAt = Date.parse(String(payload?.issued_at || ""));
  const sessionFingerprint = String(identity?.agentPresence?.session_fingerprint || "").toLowerCase();
  const errorCode = payload?.action_class === "GIT_COMMIT"
    ? "nyra_continue_commit_ticket_readback_invalid"
    : "nyra_continue_action_ticket_readback_invalid";
  if (body?.ok !== true || body.tenant_id !== payload.tenant_id ||
      !record || typeof record !== "object" || Array.isArray(record) ||
      (record.schema_version !== undefined &&
        record.schema_version !== "host_native_action_ticket_record_v1") ||
      (record.tenant_id !== undefined && record.tenant_id !== payload.tenant_id) ||
      record.state !== "issued" || record.uses !== 0 ||
      !ticket || typeof ticket !== "object" || Array.isArray(ticket) ||
      ticket.schema_version !== "host_native_action_ticket_v1" ||
      !ACTION_TICKET_ID.test(String(ticket.ticket_id || "")) ||
      !ACTION_TICKET_SIGNATURE.test(String(ticket.signature || "")) ||
      ticket.delegation_id !== request.delegation_id ||
      ticket.tenant_id !== payload.tenant_id || ticket.work_id !== payload.work_id ||
      ticket.intent_anchor_digest !== payload.intent_digest ||
      ticket.repository !== request.repository || ticket.host_kind !== payload.host_kind ||
      ticket.host_session_fingerprint !== sessionFingerprint ||
      !actionKindAllowed(payload.action_class, ticket.action?.kind) ||
      digest(ticket.action) !== digest(request.action) ||
      ticket.evidence_digest !== request.evidence_digest ||
      (gate && (ticket.action?.kind !== "git.commit" ||
        ticket.evidence_digest !== gate.projection_digest)) ||
      !Number.isFinite(currentTime) ||
      !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      !Number.isFinite(candidateIssuedAt) ||
      (!allowPriorIssuedAt && issuedAt < candidateIssuedAt - 30_000) ||
      issuedAt > currentTime + 30_000 || expiresAt <= currentTime || expiresAt <= issuedAt ||
      expiresAt - issuedAt > 60 * 60_000 || ticket.max_uses !== 1 ||
      ticket.provider_execution !== false || ticket.host_policy_override !== false ||
      ticket.host_policy_must_allow !== true) {
    fail(errorCode, 502);
  }
  return record;
}

function requestDigest(args) {
  const { continuation_ref: _reference, idempotency_key: _callerKey, ...request } = args || {};
  return digest({ schema_version: "nyra_continue_request_v1", request });
}

function pullRequestMaterialization(value, action) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "title") || !Object.hasOwn(value, "body") ||
      typeof value.title !== "string" || typeof value.body !== "string" ||
      value.title.length < 1 || value.title.length > 256 || value.body.length > 20_000 ||
      /\u0000/u.test(value.title) || /\u0000/u.test(value.body) ||
      crypto.createHash("sha256").update(value.title).digest("hex") !== action?.title_digest ||
      crypto.createHash("sha256").update(value.body).digest("hex") !== action?.body_digest) {
    fail("nyra_continue_pull_request_materialization_invalid", 409);
  }
  return Object.freeze({ title: value.title, body: value.body });
}

function assertCallerInput(args) {
  if (!args || typeof args !== "object") fail("nyra_continue_input_invalid");
  if (!/^(review_work_bootstrap|create_work|issue_delegation|authorize_action|finalize_verified_work)$/.test(String(args.operation || ""))) {
    fail("nyra_continue_operation_invalid", 409);
  }
  if (args.operation !== "finalize_verified_work" &&
      !/^nyc1_[A-Za-z0-9_-]{32,80}$/.test(String(args.continuation_ref || ""))) {
    fail("nyra_continue_ref_invalid", 409);
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
  const boundedConflictSummary = review?.requires_owner_decision === true
    ? Object.freeze({
        conflict_flags: review.conflict_flags && typeof review.conflict_flags === "object"
          ? Object.freeze({
              significant_overlap: review.conflict_flags.significant_overlap === true,
              stale: review.conflict_flags.stale === true,
              priority: review.conflict_flags.priority === true,
              dependency: review.conflict_flags.dependency === true,
              invisible_conflict: review.conflict_flags.invisible_conflict === true,
            })
          : null,
        candidates: Object.freeze((Array.isArray(review.candidates) ? review.candidates : [])
          .slice(0, 8)
          .map((candidate) => Object.freeze({
            work_id: typeof candidate?.work_id === "string" ? candidate.work_id : null,
            project_id: typeof candidate?.project_id === "string" ? candidate.project_id : null,
            work_name: typeof candidate?.work_name === "string"
              ? candidate.work_name.slice(0, 240)
              : typeof candidate?.idea === "string" ? candidate.idea.slice(0, 240) : null,
            classification: typeof candidate?.classification === "string"
              ? candidate.classification.slice(0, 80) : null,
          }))),
      })
    : null;
  return Object.freeze({
    ticket_id: ticket?.ticket_id || null,
    ticket_digest: ticket ? digest(ticket) : null,
    delegation_id: delegation?.delegation_id || null,
    review_id: review?.review_id || null,
    review_digest: review?.review_digest || null,
    review_requires_owner_decision: review?.requires_owner_decision === true,
    review_conflict_summary: boundedConflictSummary,
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
    pull_request_handoff_started: outcome.pull_request_handoff_started === true,
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
    review_conflict_summary: outcome.review_conflict_summary,
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
              : outcome.pull_request_handoff_started
                ? "Universal Core ha emesso e verificato il ticket draft PR. Nyra lo ha affidato al coordinatore standing-release server-owned; il risultato esterno richiede il readback autorevole del coordinatore."
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
  authorizeAction, reviewWorkBootstrap, createWorkBootstrap, readActionTicket,
  fulfillPrecommitTicketTask, claimPrecommitTicketGate = null,
  releaseOrReconcilePrecommitTicketGateClaim = null,
  abandonInactivePrecommitTicketGateClaim = null,
  readPrecommitTicketGateClaimRecovery = null,
  coordinatePullRequest = null, ensureFinalizeWorkBinding = null,
  finalizeVerifiedWork = null, now = () => Date.now(),
} = {}) {
  if (!store || typeof store.claim !== "function" || typeof store.complete !== "function" ||
      typeof store.readCompletedOperation !== "function" || typeof readDirectiveContext !== "function" ||
      typeof normalizeDirectiveContext !== "function" || typeof issueDelegation !== "function" ||
      typeof authorizeAction !== "function" || typeof reviewWorkBootstrap !== "function" ||
      typeof createWorkBootstrap !== "function") throw new Error("nyra_continue_dependencies_invalid");
  return async function nyraContinue(args = {}, identity = {}) {
    assertCallerInput(args);
    if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE)) fail("nyra_continue_host_capability_required", 403);
    if (args.operation === "finalize_verified_work") {
      if (typeof finalizeVerifiedWork !== "function") fail("nyra_continue_verified_finalize_unavailable", 503);
      if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_READ) ||
          args.owner_confirmed !== true || identity.ownerConfirmed !== true ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(args.work_id || "")) ||
          args.continuation_ref !== undefined || args.work_bootstrap !== undefined ||
          args.delegation_request !== undefined || args.action_request !== undefined ||
          args.pull_request_materialization !== undefined || args.review_decision !== undefined) {
        fail("nyra_continue_verified_finalize_binding_mismatch", 409);
      }
      if (typeof ensureFinalizeWorkBinding !== "function") {
        fail("nyra_continue_verified_finalize_lease_binding_unavailable", 503);
      }
      // The published front door may be reached over a transport that rotated
      // after the last Work read. Re-establish the bounded read-only DTT lease
      // for the exact server-selected logical presence before Generic Core
      // Join evaluates it. This grants no execution authority and leaves every
      // owner, Work ACL, Core Join and closure gate inside the finalizer intact.
      await ensureFinalizeWorkBinding({
        work_id: String(args.work_id).toLowerCase(),
      }, identity);
      return finalizeVerifiedWork({
        work_id: String(args.work_id).toLowerCase(),
        idempotency_key: String(args.idempotency_key).trim(),
      }, identity);
    }
    const boundRequestDigest = requestDigest(args);
    let earlyRecovery = null;
    const validateBeforeClaim = async (payload) => {
      const bootstrapOperation = ["review_work_bootstrap", "create_work"].includes(args.operation);
      if (payload.candidate_kind === "work_bootstrap") {
        if (!bootstrapOperation || !hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_CREATE) || !args.work_bootstrap ||
            args.delegation_request !== undefined || args.action_request !== undefined ||
            args.pull_request_materialization !== undefined) {
          fail("nyra_continue_work_bootstrap_binding_mismatch", 409);
        }
        const request = materializeGovernedWorkBootstrapRequest({
          spec: args.work_bootstrap,
          identity,
          projectId: payload.project_id,
          canonicalIntentDigest: payload.intent_digest,
          coreOrchestrationVerdictDigest: payload.context_digest,
          coreOrchestrationVerdict: payload.core_orchestration_verdict,
        });
        if (governedWorkBootstrapDigest(request) !== payload.work_bootstrap_request_digest) {
          fail("nyra_continue_work_bootstrap_binding_mismatch", 409);
        }
        if (args.operation === "review_work_bootstrap") {
          if (args.review_id !== undefined || args.review_digest !== undefined || args.review_decision !== undefined) {
            fail("nyra_continue_work_bootstrap_review_mismatch", 409);
          }
        } else if (args.owner_confirmed !== true || identity.ownerConfirmed !== true ||
            (args.review_decision !== undefined && !["CONTINUE_NEW_WORK", "PARALLEL_VALID"].includes(args.review_decision))) {
          fail("owner_confirmation_required", 403);
        }
        return;
      }
      if (bootstrapOperation || args.work_bootstrap !== undefined || args.review_id !== undefined ||
          args.review_digest !== undefined || args.review_decision !== undefined) {
        fail("nyra_continue_candidate_kind_mismatch", 409);
      }
      if (payload.action_class === "GIT_MERGE") {
        fail("nyra_continue_manual_merge_only", 409);
      }
      const input = {
        work_id: payload.work_id,
        project_id: payload.project_id,
        work_revision: payload.work_revision,
        intent_digest: payload.intent_digest,
      };
      const context = normalizeDirectiveContext(await readDirectiveContext(identity, input), identity, input);
      if (!SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) {
        fail("nyra_continue_host_kind_not_supported", 403);
      }
      if (args.operation === "issue_delegation") {
        ensureFreshWorkContext(context, payload);
        const request = args.delegation_request;
        if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE) || !request ||
            args.action_request !== undefined || request.work_id !== payload.work_id ||
            request.intent_anchor_digest !== payload.intent_digest || !Array.isArray(request.audience) ||
            request.audience.length !== 1 || request.audience[0] !== payload.host_kind ||
            !Array.isArray(request.allowed_actions) || request.allowed_actions.length < 1 ||
            request.allowed_actions.some((kind) => !actionKindAllowed(payload.action_class, kind)) ||
            args.owner_confirmed !== true || identity.ownerConfirmed !== true) {
          fail("nyra_continue_delegation_binding_mismatch", 409);
        }
        if (args.pull_request_materialization !== undefined) {
          fail("nyra_continue_pull_request_materialization_invalid", 409);
        }
      } else if (args.operation === "authorize_action") {
        const request = args.action_request;
        if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE) || !request ||
            args.delegation_request !== undefined || request.work_id !== payload.work_id ||
            request.intent_anchor_digest !== payload.intent_digest ||
            !actionKindAllowed(payload.action_class, request.action?.kind)) {
          fail("nyra_continue_action_binding_mismatch", 409);
        }
        if (payload.action_class === "PULL_REQUEST_OPEN") {
          pullRequestMaterialization(args.pull_request_materialization, request.action);
        } else if (args.pull_request_materialization !== undefined) {
          fail("nyra_continue_pull_request_materialization_invalid", 409);
        }
        if (payload.action_class === "GIT_COMMIT") {
          const observedGate = context?.precommit_ticket_gate;
          let contextValidated = false;
          if (observedGate?.schema_version === "precommit_ticket_gate_v2" &&
              typeof readPrecommitTicketGateClaimRecovery === "function") {
            const fulfilledGate = observedGate.fulfilled === true
              ? fulfilledCommitPrecommitGate(context, payload, request)
              : null;
            if (!fulfilledGate) {
              ensureFreshWorkContext(context, payload);
              contextValidated = true;
            }
            const currentProjectionDigest = fulfilledGate?.original_projection_digest ||
              commitPrecommitGate(context, payload, request).projection_digest;
            earlyRecovery = await readPrecommitTicketGateClaimRecovery({
              work_id: payload.work_id,
              ...(observedGate.fulfilled === true
                ? { fulfilled: true }
                : { gate_projection_digest: currentProjectionDigest }),
              request_digest: boundRequestDigest, delegation_id: request.delegation_id,
              action_digest: digest(request.action),
              host_session_fingerprint: String(identity?.agentPresence?.session_fingerprint || "").toLowerCase(),
            }, identity);
            if (earlyRecovery) {
              trustedRecoveredNativePrecommitClaim(earlyRecovery.gate_claim, {
                work_id: payload.work_id,
                request_digest: boundRequestDigest,
                delegation_id: request.delegation_id,
                action_digest: digest(request.action),
                gate_projection_digest: currentProjectionDigest,
                host_session_fingerprint: String(identity?.agentPresence?.session_fingerprint || "").toLowerCase(),
              });
              if (earlyRecovery.recovery_source === "abandonment") {
                fail("nyra_continue_precommit_claim_abandoned_replan_required", 409);
              }
              if (fulfilledGate &&
                  (String(earlyRecovery.recovery_source || "fulfillment") !== "fulfillment" ||
                    earlyRecovery.ticket_id !== fulfilledGate.gate.ticket_id)) {
                fail("nyra_continue_precommit_claim_recovery_invalid", 502);
              }
              if (fulfilledGate) {
                ensureRecoverableFulfilledWorkContext(context, payload);
                contextValidated = true;
              }
            }
          }
          if (!contextValidated) ensureFreshWorkContext(context, payload);
          if (!earlyRecovery) commitPrecommitGate(context, payload, request);
        } else ensureFreshWorkContext(context, payload);
      }
    };
    const claim = await store.claim({ identity, continuation_ref: args.continuation_ref,
      operation: args.operation, request_digest: boundRequestDigest, validate: validateBeforeClaim });
    const payload = claim.record;
    if (claim.completed_result) return nyraResult(payload, claim.completed_result, args.operation, true);
    let outcome;
    let terminal = true;
    const bootstrapOperation = ["review_work_bootstrap", "create_work"].includes(args.operation);
    if (payload.candidate_kind === "work_bootstrap") {
      if (!bootstrapOperation || !hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_CREATE) || !args.work_bootstrap ||
          args.delegation_request !== undefined || args.action_request !== undefined ||
          args.pull_request_materialization !== undefined) fail("nyra_continue_work_bootstrap_binding_mismatch", 409);
      const request = materializeGovernedWorkBootstrapRequest({
        spec: args.work_bootstrap,
        identity,
        projectId: payload.project_id,
        canonicalIntentDigest: payload.intent_digest,
        coreOrchestrationVerdictDigest: payload.context_digest,
        coreOrchestrationVerdict: payload.core_orchestration_verdict,
      });
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
      if (payload.action_class === "GIT_MERGE") fail("nyra_continue_manual_merge_only", 409);
      const input = { work_id: payload.work_id, project_id: payload.project_id, work_revision: payload.work_revision,
        intent_digest: payload.intent_digest };
      const context = normalizeDirectiveContext(await readDirectiveContext(identity, input), identity, input);
      let precommitGate = null;
      if (payload.action_class === "GIT_COMMIT" && args.operation === "authorize_action") {
        if (earlyRecovery?.gate_claim) {
          const recoverySource = String(earlyRecovery.recovery_source || "fulfillment");
          if (recoverySource === "fulfillment") {
            const fulfilledGate = fulfilledCommitPrecommitGate(context, payload, args.action_request);
            if (earlyRecovery.ticket_id !== fulfilledGate.gate.ticket_id ||
                earlyRecovery.gate_claim.gate_projection_digest !== fulfilledGate.original_projection_digest) {
              fail("nyra_continue_precommit_claim_recovery_invalid", 502);
            }
            // A completed gate legitimately changes the Work context digest.
            // Re-read and bind the exact fulfilled ticket/projection instead of
            // requiring the stale pre-fulfillment digest captured by Nyra.
            ensureRecoverableFulfilledWorkContext(context, payload);
            precommitGate = Object.freeze({
              schema_version: "precommit_ticket_gate_v2",
              projection_digest: fulfilledGate.original_projection_digest,
            });
          } else {
            // Claims and pre-fulfillment reconciliation are resumable only
            // while the same unfulfilled gate and Work snapshot still exist.
            ensureFreshWorkContext(context, payload);
            const currentGate = commitPrecommitGate(context, payload, args.action_request);
            if (earlyRecovery.gate_claim.gate_projection_digest !== currentGate.projection_digest) {
              fail("nyra_continue_precommit_claim_recovery_invalid", 502);
            }
            precommitGate = currentGate;
          }
        } else {
          ensureFreshWorkContext(context, payload);
          precommitGate = commitPrecommitGate(context, payload, args.action_request);
        }
      } else {
        ensureFreshWorkContext(context, payload);
      }
      if (!SUPPORTED_HOST_NATIVE_KINDS.has(authenticatedHostKind(identity))) fail("nyra_continue_host_kind_not_supported", 403);
      if (args.operation === "issue_delegation") {
        const request = args.delegation_request;
        if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE) || !request || args.action_request !== undefined ||
            request.work_id !== payload.work_id || request.intent_anchor_digest !== payload.intent_digest || !Array.isArray(request.audience) ||
            request.audience.length !== 1 || request.audience[0] !== payload.host_kind || !Array.isArray(request.allowed_actions) ||
            request.allowed_actions.length < 1 || request.allowed_actions.some((kind) => !actionKindAllowed(payload.action_class, kind)) ||
            args.owner_confirmed !== true || identity.ownerConfirmed !== true) fail("nyra_continue_delegation_binding_mismatch", 409);
        if (args.pull_request_materialization !== undefined) {
          fail("nyra_continue_pull_request_materialization_invalid", 409);
        }
        outcome = coreOutcome(await issueDelegation({ ...request, idempotency_key: claim.idempotency_key }, identity));
      } else if (args.operation === "authorize_action") {
        const request = args.action_request;
        if (!hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE) || !request || args.delegation_request !== undefined ||
            request.work_id !== payload.work_id || request.intent_anchor_digest !== payload.intent_digest ||
            !actionKindAllowed(payload.action_class, request.action?.kind)) fail("nyra_continue_action_binding_mismatch", 409);
        const materialization = payload.action_class === "PULL_REQUEST_OPEN"
          ? pullRequestMaterialization(args.pull_request_materialization, request.action)
          : null;
        if (!materialization && args.pull_request_materialization !== undefined) {
          fail("nyra_continue_pull_request_materialization_invalid", 409);
        }
        const nativeGate = precommitGate?.schema_version === "precommit_ticket_gate_v2";
        let nativeClaim = null;
        let issuedTicketId = null;
        let recoveryPresent = false;
        let recoverySource = null;
        if (earlyRecovery?.gate_claim) {
          nativeClaim = trustedRecoveredNativePrecommitClaim(earlyRecovery.gate_claim, {
            work_id: payload.work_id,
            request_digest: boundRequestDigest,
            delegation_id: request.delegation_id,
            action_digest: digest(request.action),
            gate_projection_digest: precommitGate.projection_digest,
            host_session_fingerprint: String(identity?.agentPresence?.session_fingerprint || "").toLowerCase(),
          });
        } else if (nativeGate) {
          if (typeof claimPrecommitTicketGate !== "function" ||
              typeof releaseOrReconcilePrecommitTicketGateClaim !== "function") {
            fail("nyra_continue_precommit_claim_unavailable", 503);
          }
          const claimBinding = nativePrecommitClaimBinding(
            payload, request, precommitGate, identity, args.continuation_ref,
            boundRequestDigest, claim.idempotency_key,
          );
          nativeClaim = trustedNativePrecommitClaim(
            await claimPrecommitTicketGate(claimBinding, identity),
            claimBinding,
          );
        }
        let actionTicket;
        let trustedReadback;
        let pullRequestHandoffStarted = false;
        try {
          // A claim created by this continuation is already authoritative for
          // its first authorization attempt. Recovery lookup is only for a
          // replayed claim adopted from an earlier interrupted continuation.
          const recovery = earlyRecovery || (nativeClaim?.replay === true &&
            typeof readPrecommitTicketGateClaimRecovery === "function"
            ? await readPrecommitTicketGateClaimRecovery({ work_id: payload.work_id, gate_claim: nativeClaim }, identity)
            : null);
          recoverySource = recovery?.schema_version === "precommit_ticket_gate_recovery_v1"
            ? String(recovery.recovery_source || "fulfillment")
            : null;
          const recoveredTicketId = ACTION_TICKET_ID.test(String(recovery?.ticket_id || ""))
            ? recovery.ticket_id : null;
          const hasRecovery = recoverySource !== null;
          recoveryPresent = hasRecovery;
          if (recoverySource === "abandonment") {
            fail("nyra_continue_precommit_claim_abandoned_replan_required", 409);
          }
          if (recoverySource && !["fulfillment", "reconciliation", "before_ticket_locator", "claim"].includes(recoverySource)) {
            fail("nyra_continue_precommit_claim_recovery_invalid", 502);
          }
          if ((recoverySource === "fulfillment" || recoverySource === "reconciliation") && !recoveredTicketId) {
            fail("nyra_continue_precommit_claim_recovery_invalid", 502);
          }
          if (["before_ticket_locator", "claim"].includes(recoverySource) && recovery?.ticket_id !== null) {
            fail("nyra_continue_precommit_claim_recovery_invalid", 502);
          }
          if (["reconciliation", "before_ticket_locator", "claim"].includes(recoverySource) && nativeClaim?.replay !== true) {
            fail("nyra_continue_precommit_claim_recovery_invalid", 502);
          }
          // A fulfilled locator proves the original gate transition but never
          // bypasses Core. Replaying the exact signed claim lets Core return a
          // fresh original ticket or atomically replace only an expired,
          // unreserved ticket. A naked claim resumes its interrupted first
          // authorization without creating another claim.
          const coreResult = await authorizeAction({
            ...request,
            idempotency_key: nativeClaim?.idempotency_key || claim.idempotency_key,
          }, identity, nativeClaim);
          const issuedRecord = coreResult?.structuredContent?.action_ticket;
          const issuedTicket = issuedRecord?.ticket || issuedRecord?.action_ticket?.ticket;
          issuedTicketId = issuedTicket?.ticket_id ||
            (recoverySource === "fulfillment" ? null : recoveredTicketId);
          if (!ACTION_TICKET_ID.test(String(issuedTicketId || "")) ||
              typeof readActionTicket !== "function") {
            fail(precommitGate
              ? "nyra_continue_commit_ticket_readback_unavailable"
              : "nyra_continue_action_ticket_readback_unavailable", 503);
          }
          trustedReadback = await readActionTicket({ ticket_id: issuedTicketId }, identity);
          const current = now();
          actionTicket = trustedIssuedActionTicket(
            trustedReadback,
            payload,
            request,
            identity,
            precommitGate,
            current instanceof Date ? current.getTime() : Number(current),
            { allowPriorIssuedAt: recoveryPresent && nativeClaim?.replay === true },
          );
          if (actionTicket.ticket.ticket_id !== issuedTicketId) {
            fail(precommitGate
              ? "nyra_continue_commit_ticket_readback_invalid"
              : "nyra_continue_action_ticket_readback_invalid", 502);
          }
          if (precommitGate && recoverySource !== "fulfillment") {
            if (typeof fulfillPrecommitTicketTask !== "function") {
              fail("nyra_continue_precommit_fulfillment_unavailable", 503);
            }
            await fulfillPrecommitTicketTask({
              work_id: payload.work_id,
              gate_projection_digest: precommitGate.projection_digest,
              action_ticket: actionTicket,
              ...(nativeClaim ? { gate_claim: nativeClaim } : {}),
            }, identity);
          } else if (payload.action_class === "PULL_REQUEST_OPEN") {
            if (typeof coordinatePullRequest !== "function") {
              fail("nyra_continue_pull_request_coordinator_unavailable", 503);
            }
            await coordinatePullRequest({
              action_request: request,
              action_ticket: actionTicket,
              materialization,
              idempotency_key: claim.idempotency_key,
            }, identity);
            pullRequestHandoffStarted = true;
          }
        } catch (error) {
          if (nativeClaim && (!recoveryPresent || recoverySource === "claim") &&
              typeof releaseOrReconcilePrecommitTicketGateClaim === "function") {
            try {
              await releaseOrReconcilePrecommitTicketGateClaim({
                work_id: payload.work_id,
                gate_claim: nativeClaim,
                gate_projection_digest: precommitGate.projection_digest,
                continuation_ref: nativeClaim.continuation_ref,
                request_digest: nativeClaim.request_digest,
                idempotency_key: nativeClaim.idempotency_key,
                stage: issuedTicketId ? "ticket_locator_received" : "before_ticket_locator",
                ticket_id: issuedTicketId || null,
                error_code: /^[a-zA-Z0-9_-]{3,160}$/.test(String(error?.code || ""))
                  ? String(error.code)
                  : "precommit_claim_operation_failed",
              }, identity);
            } catch {
              fail("nyra_continue_precommit_claim_recovery_failed", 503);
            }
          }
          if (nativeClaim && !issuedTicketId &&
              typeof abandonInactivePrecommitTicketGateClaim === "function") {
            try {
              // Only Universal Core can declare the delegation inactive. The
              // store keeps an append-only abandonment receipt; an active or
              // ambiguous delegation leaves the claim frozen for safe replay.
              await abandonInactivePrecommitTicketGateClaim({
                work_id: payload.work_id,
                gate_claim: nativeClaim,
              }, identity);
            } catch {
              fail("nyra_continue_precommit_claim_recovery_failed", 503);
            }
          }
          throw error;
        }
        // The immediate adapter response is only a locator. The continuation
        // result is projected from the authoritative Core registry readback.
        outcome = Object.freeze({
          ...coreOutcome(trustedReadback),
          pull_request_handoff_started: pullRequestHandoffStarted,
        });
      } else fail("nyra_continue_operation_invalid", 409);
    }
    await store.complete({ identity, continuation_ref: args.continuation_ref, operation: args.operation,
      request_digest: boundRequestDigest, internal_result: outcome, terminal });
    return nyraResult(payload, outcome, args.operation, claim.replay);
  };
}

export { ACTION_KIND_BY_CLASS };
