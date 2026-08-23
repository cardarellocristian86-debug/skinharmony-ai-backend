import crypto from "node:crypto";

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_SIGNAL_LENGTH = 500;
const RESERVED_AUTHORITY_KEYS = new Set([
  "api_key",
  "authenticated_tenant_id",
  "authorization",
  "client_secret",
  "confirmation_reference",
  "execution_authorized",
  "model",
  "owner",
  "owner_confirmed",
  "owner_context",
  "owner_id",
  "provider",
  "provider_id",
  "tenant",
  "tenant_id",
]);

const CONSEQUENTIAL_PATTERNS = Object.freeze([
  ["release", /\b(?:deploy|deployment|merge|push|publish|release|distribuisc\w*|pubblic\w*|rilasci\w*)\b/iu],
  ["communication", /\b(?:send|email|message|notify|invia\w*|manda\w*|messaggi\w*|notific\w*)\b/iu],
  ["destructive", /\b(?:delete|remove|destroy|elimina\w*|cancella\w*|distrugg\w*)\b/iu],
  ["financial", /\b(?:pay|purchase|buy|refund|paga\w*|acquista\w*|rimborsa\w*)\b/iu],
  ["scheduling", /\b(?:book|schedule|invite|prenota\w*|calendar\w*|invita\w*)\b/iu],
  ["access", /\b(?:grant|revoke|permission|accesso|permess\w*|abilita\w*|revoca\w*)\b/iu],
]);

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function assertNoCallerAuthority(value, path = "$", depth = 0) {
  if (!value || typeof value !== "object") return;
  if (depth > 8) throw fail("nyra_converse_arguments_too_deep", 413);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCallerAuthority(item, `${path}[${index}]`, depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (["__proto__", "prototype", "constructor"].includes(normalized) ||
        RESERVED_AUTHORITY_KEYS.has(normalized)) {
      const error = fail("nyra_converse_reserved_authority_argument");
      error.argumentPath = `${path}.${key}`;
      throw error;
    }
    assertNoCallerAuthority(item, `${path}.${key}`, depth + 1);
  }
}

function boundedString(value, maximum = MAX_SIGNAL_LENGTH) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maximum) : null;
}

function boundedWorkId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

function boundedProjectId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,63}$/.test(id) ? id : null;
}

function boundedCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0
    ? Math.min(number, 100_000)
    : 0;
}

function structured(result) {
  return result?.structuredContent && typeof result.structuredContent === "object" &&
    !Array.isArray(result.structuredContent)
    ? result.structuredContent
    : {};
}

function requireAuthenticatedIdentity(identity) {
  const tenantId = String(identity?.tenantId || "").trim();
  if (!tenantId) throw fail("nyra_converse_authenticated_tenant_required", 403);
  return tenantId;
}

function normalizeWorkState(value, { workId, selectionRequired }) {
  if (selectionRequired) return "selection_required";
  if (!workId) return "unbound";
  const state = String(value || "").trim().toLowerCase();
  return new Set([
    "active",
    "blocked",
    "verified",
    "release_ready",
    "completed",
    "failed",
    "selection_required",
    "unbound",
    "unknown",
  ]).has(state) ? state : "unknown";
}

function normalizeRisk(value) {
  const risk = String(value || "").trim().toLowerCase();
  return new Set(["low", "medium", "high", "blocked"]).has(risk) ? risk : "unknown";
}

// The direct conversation never returns raw evidence, but it must carry the
// same compact operational briefing that automatic Work calls deliver.
function publicNyraDialogue(value) {
  const dialogue = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const work = dialogue.work && typeof dialogue.work === "object" ? dialogue.work : {};
  const checkpoint = work.checkpoint && typeof work.checkpoint === "object" ? work.checkpoint : {};
  const gallery = work.gallery && typeof work.gallery === "object" ? work.gallery : {};
  const software = work.software && typeof work.software === "object" ? work.software : {};
  const diagnosis = dialogue.self_diagnosis && typeof dialogue.self_diagnosis === "object" ? dialogue.self_diagnosis : {};
  return Object.freeze({
    dialogue_id: boundedString(dialogue.dialogue_id, 80) || null,
    manual_digest: /^[a-f0-9]{64}$/.test(String(dialogue.manual?.digest || "")) ? dialogue.manual.digest : null,
    work_revision: Number.isSafeInteger(Number(work.work_revision)) ? Number(work.work_revision) : null,
    intent_digest: /^[a-f0-9]{64}$/.test(String(work.intent_digest || "")) ? work.intent_digest : null,
    checkpoint_available: checkpoint.available === true,
    gallery_work_count: boundedCount(gallery.work_count),
    software_state: boundedString(software.state, 40) || "not_indexed",
    atlas_revision: Number.isSafeInteger(Number(software.atlas_revision)) ? Number(software.atlas_revision) : null,
    diagnosis_state: boundedString(diagnosis.state, 80) || "unknown",
    next_action_available: true,
  });
}

function requireBoundPreflight(result, identity, args) {
  const payload = structured(result);
  const envelope = payload.work_preflight && typeof payload.work_preflight === "object" &&
    !Array.isArray(payload.work_preflight)
    ? payload.work_preflight
    : payload;
  const tenantId = requireAuthenticatedIdentity(identity);
  if (
    payload.ok !== true ||
    !Object.hasOwn(payload, "tenant_id") ||
    typeof payload.tenant_id !== "string" || payload.tenant_id !== tenantId ||
    !Object.hasOwn(envelope, "schema_version") ||
    envelope.schema_version !== "skinharmony_work_preflight_v1" ||
    !Object.hasOwn(envelope, "preflight_id") ||
    typeof envelope.preflight_id !== "string" || envelope.preflight_id.trim().length < 3 ||
    !Object.hasOwn(envelope, "mandatory") ||
    envelope.mandatory !== true ||
    !Object.hasOwn(envelope, "tenant_id") ||
    typeof envelope.tenant_id !== "string" || envelope.tenant_id !== tenantId ||
    !Object.hasOwn(envelope, "operational_surface") ||
    envelope.operational_surface !== "tenant_work_gallery" ||
    !Object.hasOwn(envelope, "state") ||
    envelope.state !== "ready_read_only"
  ) throw fail("nyra_converse_work_preflight_binding_invalid");

  const continuity = envelope.continuity && typeof envelope.continuity === "object"
    ? envelope.continuity
    : payload.continuity && typeof payload.continuity === "object"
      ? payload.continuity
      : {};
  const control = envelope.nyra_control_context && typeof envelope.nyra_control_context === "object"
    ? envelope.nyra_control_context
    : payload.nyra_control_context && typeof payload.nyra_control_context === "object"
      ? payload.nyra_control_context
      : {};
  const continuityWorkId = boundedWorkId(continuity.work_id);
  const controlWorkId = boundedWorkId(control.work_id);
  if ((continuity.work_id && !continuityWorkId) || (control.work_id && !controlWorkId) ||
      (continuityWorkId && controlWorkId && continuityWorkId !== controlWorkId)) {
    throw fail("nyra_converse_work_binding_mismatch", 409);
  }
  const workId = continuityWorkId || controlWorkId;
  const continuityProjectId = boundedProjectId(continuity.project_id);
  const controlProjectId = boundedProjectId(control.project_id);
  if ((continuity.project_id && !continuityProjectId) || (control.project_id && !controlProjectId) ||
      (continuityProjectId && controlProjectId && continuityProjectId !== controlProjectId)) {
    throw fail("nyra_converse_project_binding_mismatch", 409);
  }
  const projectId = continuityProjectId || controlProjectId || boundedProjectId(args.project_id);
  if (args.work_id && workId !== String(args.work_id)) {
    throw fail("nyra_converse_work_binding_mismatch", 409);
  }
  if (args.project_id && projectId && projectId !== String(args.project_id)) {
    throw fail("nyra_converse_project_binding_mismatch", 409);
  }

  const memory = envelope.shared_memory_bootstrap && typeof envelope.shared_memory_bootstrap === "object"
    ? envelope.shared_memory_bootstrap
    : payload.shared_memory_bootstrap && typeof payload.shared_memory_bootstrap === "object"
      ? payload.shared_memory_bootstrap
      : {};
  const gallery = envelope.tenant_work_gallery && typeof envelope.tenant_work_gallery === "object"
    ? envelope.tenant_work_gallery
    : payload.tenant_work_gallery && typeof payload.tenant_work_gallery === "object"
      ? payload.tenant_work_gallery
      : {};
  const selectionRequired = !workId && (
    continuity.state === "work_selection_required" ||
    Number(gallery.work_count || 0) > 1
  );
  // A response without a bound Work must never inherit a stale action from a
  // compact control projection. That would make Nyra sound as though it had
  // resumed work it has not authenticated for this turn.
  const nextAction = workId
    ? boundedString(control.next_action || continuity.next_action, MAX_SIGNAL_LENGTH)
    : null;

  return Object.freeze({
    // This is an internal, server-issued contract. It is deliberately kept
    // outside the public conversation response and never accepted from tool
    // callers, but must accompany the trusted MCP-to-Core bridge request.
    serverIssuedWorkPreflight: envelope,
    work: Object.freeze({
      preflight_bound: true,
      work_bound: Boolean(workId),
      work_id: workId,
      project_id: projectId,
      state: normalizeWorkState(control.work_state || continuity.state, { workId, selectionRequired }),
      next_action: nextAction,
      next_action_available: Boolean(nextAction),
      selection_required: selectionRequired,
    }),
    memory: Object.freeze({
      loaded: memory.loaded === true,
      active_task_count: boundedCount(memory.active_task_count),
      active_lock_count: boundedCount(memory.active_lock_count),
      artifact_count: boundedCount(memory.artifact_count),
    }),
    dialogue: publicNyraDialogue(control.nyra_dialogue),
  });
}

function requirePersistedConversationContext(value, identity, args) {
  const context = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const tenantId = requireAuthenticatedIdentity(identity);
  if (!context ||
      context.schema_version !== "nyra_control_context_v1" ||
      context.tenant_id !== tenantId ||
      !/^[a-f0-9]{64}$/.test(String(context.context_digest || "")) ||
      context.nyra_dialogue?.schema_version !== "nyra_dialogue_context_v1" ||
      context.nyra_dialogue?.persistent !== true ||
      !/^[a-f0-9]{64}$/.test(String(context.nyra_dialogue?.dialogue_digest || ""))) return null;
  const workId = boundedWorkId(context.work_id);
  const projectId = boundedProjectId(context.project_id);
  if (!workId || !projectId || (args.work_id && workId !== String(args.work_id)) ||
      (args.project_id && projectId !== String(args.project_id)) ||
      context.nyra_dialogue?.work?.work_id !== workId ||
      context.nyra_dialogue?.work?.project_id !== projectId ||
      !Number.isSafeInteger(Number(context.nyra_dialogue?.work?.work_revision)) ||
      Number(context.nyra_dialogue.work.work_revision) < 1) return null;
  return Object.freeze({
    work: Object.freeze({
      // The durable context was itself emitted by the authenticated Work
      // preflight/materialization path. Preserve the established public
      // contract so older hosts do not need a second response shape.
      preflight_bound: true,
      work_bound: true,
      work_id: workId,
      project_id: projectId,
      state: normalizeWorkState(context.work_state, { workId, selectionRequired: false }),
      next_action: boundedString(context.next_action, MAX_SIGNAL_LENGTH),
      next_action_available: Boolean(boundedString(context.next_action, MAX_SIGNAL_LENGTH)),
      selection_required: false,
    }),
    memory: Object.freeze({
      loaded: true,
      active_task_count: 0,
      active_lock_count: 0,
      artifact_count: 0,
      revision: 0,
      relevant_count: 0,
      handoff_count: 0,
      recent_activity_count: 0,
      raw_memory_returned: false,
    }),
    dialogue: publicNyraDialogue(context.nyra_dialogue),
    assignment_available: Boolean(boundedString(context.assignment?.assignment_id, 80)),
  });
}

function requireTenantBoundInterpretation(result, identity) {
  const payload = structured(result);
  const tenantId = requireAuthenticatedIdentity(identity);
  const runtime = payload.core_runtime;
  if (
    payload.ok !== true ||
    !Object.hasOwn(payload, "tenant_id") ||
    typeof payload.tenant_id !== "string" || payload.tenant_id !== tenantId
  ) {
    throw fail("nyra_converse_interpretation_tenant_mismatch", 409);
  }
  if (
    !runtime || typeof runtime !== "object" || Array.isArray(runtime) ||
    !Object.hasOwn(runtime, "mode") ||
    !new Set(["active", "shadow", "off"]).has(runtime.mode) ||
    !Object.hasOwn(runtime, "route") ||
    !new Set(["V0", "V1", "V2"]).has(runtime.route) ||
    !Object.hasOwn(runtime, "selected_authority") ||
    !new Set(["V0", "V1", "V2"]).has(runtime.selected_authority) ||
    !Object.hasOwn(runtime, "execution_allowed") ||
    runtime.execution_allowed !== false
  ) throw fail("nyra_converse_core_runtime_binding_invalid", 409);
  const selected = payload.result?.selected_by_core || {};
  const deep = payload.result?.deep_nyra_runtime || {};
  const memory = payload.received_memory || payload.result?.memory_context || {};
  return Object.freeze({
    core: Object.freeze({
      mode: runtime.mode,
      route: runtime.route,
      authority: runtime.selected_authority,
      parity_matched: typeof runtime.parity?.matched === "boolean" ? runtime.parity.matched : null,
      execution_allowed: false,
    }),
    selected_action_available: Boolean(boundedString(selected.primary_action_label, MAX_SIGNAL_LENGTH)),
    risk_band: normalizeRisk(selected.risk_band),
    dialogue_accepted: deep.dialogue?.validator?.accepted === true,
    opened_branch_count: boundedCount(deep.cognition?.opened_branch_count),
    memory: Object.freeze({
      revision: boundedCount(memory.revision),
      relevant_count: boundedCount(memory.relevant_count),
      handoff_count: boundedCount(memory.handoff_count),
      recent_activity_count: boundedCount(memory.recent_activity_count),
    }),
  });
}

function actionPolicy(message) {
  const categories = CONSEQUENTIAL_PATTERNS
    .filter(([, pattern]) => pattern.test(message))
    .map(([category]) => category);
  return Object.freeze({
    consequential_request_detected: categories.length > 0,
    categories: Object.freeze(categories),
    mode: categories.length ? "proposal_only" : "advisory_only",
    classification_only: true,
    external_action_authorized: false,
    consequential_action_performed: false,
  });
}

function normalizedIdentityKind(identity) {
  return ["oauth", "codex", "service"].includes(identity?.kind) ? identity.kind : "other";
}

function normalizedClientType(identity) {
  const value = identity?.agentPresence?.client_type;
  return ["chatgpt", "codex", "api_agent", "other"].includes(value) ? value : "other";
}

function responseLanguage(locale) {
  return locale === "it" || locale === "en" ? locale : "match_user";
}

function staticReplySeed(locale, workBound, nextAction = null) {
  const proposedNextAction = boundedString(nextAction, MAX_SIGNAL_LENGTH);
  const nextActionTerminal = /[.!?]$/.test(proposedNextAction) ? "" : ".";
  if (locale === "en") {
    return proposedNextAction
      ? `Proposed next step: ${proposedNextAction}${nextActionTerminal} No external action has been authorized or performed.`
      : workBound
        ? "No server-issued next step is currently available. No external action has been authorized or performed."
        : "No Work is currently bound. No external action has been authorized or performed.";
  }
  return proposedNextAction
    ? `Prossimo passo proposto: ${proposedNextAction}${nextActionTerminal} Nessuna azione esterna è stata autorizzata o eseguita.`
    : workBound
      ? "Nessun prossimo passo server-emesso è al momento disponibile. Nessuna azione esterna è stata autorizzata o eseguita."
      : "Nessun Work è attualmente associato. Nessuna azione esterna è stata autorizzata o eseguita.";
}

function turnId({ tenantId, sessionId, message, workId, projectId, locale, style }) {
  const digest = crypto.createHash("sha256").update(JSON.stringify({
    tenantId,
    sessionId,
    message,
    workId,
    projectId,
    locale,
    style,
  })).digest("hex");
  return `nyra_turn_${digest.slice(0, 24)}`;
}

function textResult(payload) {
  const contract = payload.host_response_contract;
  const narration = {
    speaker: contract.speaker,
    response_language: contract.response_language,
    reply_seed: contract.reply_seed,
    next_action: contract.next_action,
    rendering_policy: contract.rendering_policy,
    action_mode: payload.action_policy.mode,
    work_id: payload.work.work_id,
    core_authority: payload.interpretation.core.authority,
    execution_authorized: false,
    external_action_authorized: false,
  };
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(narration) }],
  };
}

export function createNyraConversePreflight({
  workPreflight,
  ensureContinuity,
  resolveContinuityProjectBinding,
  workContinuityRuntime,
  hostType,
} = {}) {
  if (
    typeof workPreflight !== "function" ||
    typeof ensureContinuity !== "function" ||
    typeof resolveContinuityProjectBinding !== "function" ||
    typeof hostType !== "function"
  ) {
    throw new Error("nyra_converse_preflight_dependencies_invalid");
  }
  return async function nyraConversePreflight(args = {}, identity = {}) {
    // `core_capability_read` is intentionally exempt from generic preflight.
    // Conversation obtains its authenticated Work binding inside the target
    // handler and accepts no caller-made preflight or authority envelope.
    const preflightArgs = {
      request: args.message,
      target_system: "nyra_conversational_runtime",
      operation_type: "nyra.converse",
      tool_name: "nyra_converse",
      response_mode: "full",
      ...(args.work_id ? { work_id: args.work_id } : {}),
      ...(args.project_id ? { project_id: args.project_id } : {}),
      session_id: identity.agentPresence?.session_id || args.session_id,
      agent_id: identity.agentPresence?.agent_id || args.agent_id || "connected_ai",
      client_type: identity.agentPresence?.client_type || args.client_type,
      host_type: hostType(identity, args),
      available_capabilities: ["nyra_converse", "skinharmony_core_mcp"],
    };
    const continuityBinding = await resolveContinuityProjectBinding(
      identity,
      preflightArgs,
      workContinuityRuntime,
    );
    const result = await workPreflight({
      ...preflightArgs,
      project_id: continuityBinding.projectId,
    }, identity);
    await ensureContinuity(
      identity,
      continuityBinding.continuityArgs,
      "nyra_converse",
      result,
      { resumeExisting: true },
    );
    return result;
  };
}

export function createNyraConverseHandler({ preflight, interpret, readControlContext = null } = {}) {
  if (typeof preflight !== "function" || typeof interpret !== "function") {
    throw new Error("nyra_converse_dependencies_invalid");
  }
  return async function nyraConverse(args = {}, identity = {}) {
    assertNoCallerAuthority(args);
    const tenantId = requireAuthenticatedIdentity(identity);
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) throw fail("nyra_converse_message_required");
    if (message.length > MAX_MESSAGE_LENGTH) throw fail("nyra_converse_message_too_long", 413);
    const locale = ["auto", "it", "en"].includes(args.locale) ? (args.locale || "auto") : "auto";
    const style = ["concise", "balanced", "detailed"].includes(args.response_style)
      ? args.response_style
      : "balanced";
    const sessionId = String(identity.agentPresence?.session_id || args.session_id || "").trim();
    if (!sessionId) throw fail("nyra_converse_session_required", 400);

    let persisted = null;
    if (typeof readControlContext === "function" && args.work_id && args.project_id) {
      persisted = requirePersistedConversationContext(await readControlContext(identity, {
        work_id: args.work_id,
        project_id: args.project_id,
      }), identity, args);
    }
    let boundedPreflight = persisted;
    let interpretation;
    if (persisted) {
      interpretation = Object.freeze({
        // A cached dialogue never claims a fresh Core evaluation. This is the
        // existing non-executing, no-parity public contract shape.
        core: Object.freeze({
          mode: "off",
          route: "V0",
          authority: "V0",
          parity_matched: null,
          execution_allowed: false,
        }),
        selected_action_available: persisted.assignment_available,
        risk_band: persisted.dialogue.self_diagnosis_state === "recovery_required" ? "blocked" : "low",
        dialogue_accepted: true,
        opened_branch_count: 0,
      });
    } else {
      const preflightResult = await preflight({
        message,
        ...(args.work_id ? { work_id: args.work_id } : {}),
        ...(args.project_id ? { project_id: args.project_id } : {}),
        session_id: sessionId,
        agent_id: identity.agentPresence?.agent_id,
        client_type: identity.agentPresence?.client_type,
      }, identity);
      boundedPreflight = requireBoundPreflight(preflightResult, identity, args);
      const interpretationResult = await interpret({
        message,
        session_id: sessionId,
        ...(boundedPreflight.work.project_id ? { project_id: boundedPreflight.work.project_id } : {}),
        work_preflight: boundedPreflight.serverIssuedWorkPreflight,
        response_mode: "fast",
        available_capabilities: ["nyra_converse", "skinharmony_core_mcp"],
      }, identity);
      interpretation = requireTenantBoundInterpretation(interpretationResult, identity);
    }
    const action = actionPolicy(message);
    const nextAction = boundedPreflight.work.next_action;
    const replySeed = staticReplySeed(locale, Boolean(boundedPreflight.work.work_id), nextAction);
    const id = turnId({
      tenantId,
      sessionId,
      message,
      workId: boundedPreflight.work.work_id,
      projectId: boundedPreflight.work.project_id,
      locale,
      style,
    });
    const instructions = [
      "Render host_response_contract.reply_seed as the complete operational answer before adding any optional explanation.",
      "When next_action is present, preserve it verbatim after 'Prossimo passo proposto'. Do not cite PRs, CI, plans, checkpoints or history unless those exact facts are separately present in the server contract.",
      "Do not say that Nyra has resumed, will proceed, started work, verified a result, or performed an external action. This turn is advisory only; a separate governed tool and host approval are required for any action.",
    ];
    return textResult(Object.freeze({
      schema_version: "nyra_conversation_turn_v1",
      ok: true,
      tenant_id: tenantId,
      turn_id: id,
      identity_binding: Object.freeze({
        authenticated: true,
        tenant_bound: true,
        principal_kind: normalizedIdentityKind(identity),
        client_type: normalizedClientType(identity),
        caller_authority_accepted: false,
      }),
      work: boundedPreflight.work,
      memory: Object.freeze({
        ...boundedPreflight.memory,
        ...interpretation.memory,
        raw_memory_returned: false,
      }),
      interpretation: Object.freeze({
        core: interpretation.core,
        selected_action_available: interpretation.selected_action_available,
        risk_band: interpretation.risk_band,
        dialogue_accepted: interpretation.dialogue_accepted,
        opened_branch_count: interpretation.opened_branch_count,
      }),
      nyra_dialogue: boundedPreflight.dialogue,
      action_policy: action,
      host_response_contract: Object.freeze({
        speaker: "Nyra",
        renderer: "connected_host_model",
        response_language: responseLanguage(locale),
        response_style: style,
        reply_seed: replySeed,
        next_action: nextAction,
        rendering_policy: "server_next_action_first_v1",
        instructions: Object.freeze(instructions),
      }),
      execution_authorized: false,
      external_action_authorized: false,
      provider_execution: false,
      provider_api_key_required: false,
      server_model_calls: 0,
    }));
  };
}

export { MAX_MESSAGE_LENGTH };
