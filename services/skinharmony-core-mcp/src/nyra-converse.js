import crypto from "node:crypto";
import {
  bindNyraCanonicalIntent,
  validateNyraCanonicalIntent,
} from "../../shared/nyra-canonical-intent.mjs";
import { validateCoreOrchestrationVerdict } from "../../shared/nyra-core-orchestration-verdict.mjs";
import { NYRA_DIALOGUE_WIDGET_URI } from "./nyra-operating-dialogue-widget.js";
import {
  governedWorkBootstrapDigest,
  materializeGovernedWorkBootstrapRequest,
} from "./work-bootstrap-contract.js";
import { requireTenantWorkCapability } from "./tenant-work-authorization.js";
import {
  buildNyraRoutingTelemetry,
  classifyNyraIntent,
  detectNyraConsequentialCategories,
  publicNyraIntentRoute,
  readAuthorizedNyraCommandCatalog,
  resolveNyraCommandProposal,
} from "./nyra-intent-router.js";
import { projectNyraConversationControlRoomReadback } from "./nyra-control-room.js";

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_SIGNAL_LENGTH = 500;
const MAX_DIRECTIVE_ITEMS = 8;
const MAX_WORK_SELECTION_PAGE_SIZE = MAX_DIRECTIVE_ITEMS;
const MAX_WORK_SELECTION_CATALOG_SIZE = 100_000;
const WORK_SELECTION_CURSOR_PATTERN = /^nws_([1-9][0-9]{0,4})$/u;
const CONTINUATION_OPEN_TIMEOUT_MS = 1_500;
const CORE_ACTION_ID_PATTERN = /^action:[a-zA-Z0-9][a-zA-Z0-9:._-]{0,158}$/;
const PUBLIC_TEXT_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const FALSE_COMPLETION_CLAIM_PATTERN = /\b(?:deploy(?:ed|\s+complet\w*)|merge\s+(?:eseguit\w*|complet\w*|done)|publish(?:ed|\s+complet\w*)|pubblicat\w*|inviat\w*|sent|completed|completat\w*|eseguit\w*)\b/iu;
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
  "work_preflight",
  "nyra_intent_route",
  "nyra_structured_context",
  "icf_context",
  "entity_360_context",
  "ramy_context",
  "tenant",
  "tenant_id",
]);

// Work discovery is a read-only conversational operation.  It must be
// recognized before preflight/continuity so that asking to choose a Work can
// never resume, bind or mutate the Work that happens to be attached to the
// current transport session.
// Do not interpret a request about the current Work (for example its status
// or tasks) as a request to enumerate the Gallery.  The prose route is only
// for an explicit plural/option list or an explicit choice *among* Works;
// callers can always use work_selection_mode: "list" for an unambiguous read.
const WORK_SELECTION_LIST_PATTERN = /(?:\b(?:mostra(?:mi)?|elenca|lista|visualizza|vedi|show|list|view)\b[\s\S]{0,100}\b(?:(?:i|gli|dei)\s+work|(?:all|active|available)\s+works?|works|lavori|work\s+(?:choices|options)|scelte\s+(?:dei\s+)?work)\b|\b(?:fammi\s+scegliere|let\s+me\s+choose|choose)\b[\s\S]{0,100}\b(?:tra|fra|among|between)\b[\s\S]{0,40}\b(?:(?:i|gli|dei)\s+work|(?:all|active|available)\s+works?|works|lavori|work\s+(?:choices|options)|scelte\s+(?:dei\s+)?work)\b)/iu;
const DIAGNOSTIC_REQUEST_PATTERN = /\b(?:perch[eé]|why|diagnostic\w*|spiega\w*|explain\w*|causa(?:\s+radice)?|root\s+cause|cosa\s+(?:manca|serve))\b/iu;
// A no-action boundary often lists the exact action words that Nyra must not
// take.  Strip only that negative sentence.  A later affirmative sentence is
// intentionally preserved and will still be governed.
const GENERIC_GUARD_REASON = "safety_mode";
const ACTION_CONTINUATION_OPERATIONS = new Set([
  "issue_delegation",
  "authorize_action",
]);

export const NYRA_SERVER_CONNECTOR_HINT = Symbol("nyra_server_connector_hint");

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function boundedContinuationOpen(operation) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(fail("continuation_open_timeout", 503)), CONTINUATION_OPEN_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() => clearTimeout(timer));
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

function boundedPublicText(value, maximum = MAX_SIGNAL_LENGTH) {
  const text = boundedString(value, maximum);
  return text && !PUBLIC_TEXT_CONTROL_PATTERN.test(text) ? text : null;
}

function strictCoreSignalList(value) {
  if (!Array.isArray(value) || value.length > MAX_DIRECTIVE_ITEMS) {
    throw fail("nyra_converse_interpretation_contract_invalid", 409);
  }
  const output = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw fail("nyra_converse_interpretation_contract_invalid", 409);
    }
    const text = item.trim();
    if (!text || text.length > 240 || PUBLIC_TEXT_CONTROL_PATTERN.test(text) || output.includes(text)) {
      throw fail("nyra_converse_interpretation_contract_invalid", 409);
    }
    output.push(text);
  }
  return Object.freeze(output);
}

function normalizeCoreGovernanceDiagnostics(selected, blockedReasons, ownerConfirmationRequired) {
  const raw = selected?.governance_diagnostics;
  const requestedGuardMode = raw && typeof raw === "object" && !Array.isArray(raw) &&
    raw.guard_mode === "confirmation_required"
    ? "confirmation_required"
    : "normal";
  const hardReasonCodes = blockedReasons.filter((code) => code !== GENERIC_GUARD_REASON);
  const rawCauses = Array.isArray(raw?.blocking_causes) ? raw.blocking_causes.slice(0, MAX_DIRECTIVE_ITEMS) : [];
  const upstreamRemediation = new Map();
  for (const item of rawCauses) {
    const code = boundedPublicText(item?.code, 160);
    const remediation = boundedPublicText(item?.remediation, MAX_SIGNAL_LENGTH);
    if (code && remediation && hardReasonCodes.includes(code)) upstreamRemediation.set(code, remediation);
  }
  const causes = hardReasonCodes.map((code) => Object.freeze({
    code,
    component: "UNIVERSAL_CORE",
    state: "BLOCKED",
    remediation: upstreamRemediation.get(code) ||
      `Risolvere il segnale Core “${code}”, quindi rivalutare la stessa azione bounded.`,
  }));
  const genericGuardObserved = blockedReasons.includes(GENERIC_GUARD_REASON) ||
    requestedGuardMode === "confirmation_required";
  if (genericGuardObserved) {
    causes.push(Object.freeze({
      code: "safety_mode_guard_only",
      component: "UNIVERSAL_CORE",
      state: "GUARDED",
      remediation: "Non è un blocco: analisi, evidenze e proposta possono continuare. Un ticket e la conferma owner servono solo per una specifica azione esterna.",
    }));
  }
  if (ownerConfirmationRequired && !causes.some((cause) => cause.code === "owner_confirmation_required")) {
    causes.push(Object.freeze({
      code: "owner_confirmation_required",
      component: "OWNER",
      state: "CONFIRMATION_REQUIRED",
      remediation: "Definire l’azione esterna esatta e ottenere una conferma owner vincolata a Work, revisione e target.",
    }));
  }
  const hardBlocked = hardReasonCodes.length > 0;
  return Object.freeze({
    state: hardBlocked ? "BLOCKED" : ownerConfirmationRequired || genericGuardObserved
      ? "CONFIRMATION_REQUIRED" : "READY",
    guard_mode: genericGuardObserved ? "confirmation_required" : "normal",
    causes: Object.freeze(causes),
  });
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function deterministicDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function safeActionText(value, maximum = MAX_SIGNAL_LENGTH) {
  const text = boundedPublicText(value, maximum);
  return text && !FALSE_COMPLETION_CLAIM_PATTERN.test(text) ? text : null;
}

function directiveCode(value, fallback = "unspecified") {
  const normalized = String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .replace(/^[_:.-]+|[_:.-]+$/g, "")
    .slice(0, 160);
  return normalized || fallback;
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

function parseWorkSelectionCursor(value) {
  if (value === undefined || value === null || value === "") return 0;
  const match = typeof value === "string" ? WORK_SELECTION_CURSOR_PATTERN.exec(value) : null;
  if (!match) throw fail("nyra_converse_work_selection_cursor_invalid");
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 1 || offset >= MAX_WORK_SELECTION_CATALOG_SIZE) {
    throw fail("nyra_converse_work_selection_cursor_invalid");
  }
  return offset;
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

function normalizeCoreState(value) {
  const state = String(value || "").trim().toLowerCase();
  return new Set(["observe", "ok", "attention", "critical", "protection", "blocked"]).has(state)
    ? state
    : null;
}

function normalizeCoreControl(value) {
  const control = String(value || "").trim().toLowerCase();
  return new Set(["observe", "suggest", "confirm", "execute_allowed", "blocked"]).has(control)
    ? control
    : null;
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
  const assignment = dialogue.assignment && typeof dialogue.assignment === "object" ? dialogue.assignment : {};
  const assignmentId = boundedWorkId(assignment.assignment_id);
  const assignmentRole = boundedPublicText(assignment.role, 80);
  const assignmentState = boundedPublicText(assignment.state, 40);
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
    assignment: Object.freeze({
      available: Boolean(assignmentId),
      assignment_id: assignmentId,
      role: assignmentRole,
      state: assignmentState,
    }),
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
    !new Set([
      "ready_read_only",
      "routed_waiting_for_core_verdict",
      "routed_owner_confirmed_waiting_for_core_verdict",
    ]).has(envelope.state)
  ) throw fail("nyra_converse_work_preflight_binding_invalid");

  const canonicalIntent = validateNyraCanonicalIntent(args.canonical_intent, { message: args.message });
  const expectedCanonicalBinding = bindNyraCanonicalIntent(canonicalIntent, { message: args.message });
  const actualCanonicalBinding = envelope.canonical_intent_binding;
  let orchestrationVerdict;
  try {
    orchestrationVerdict = validateCoreOrchestrationVerdict(
      envelope.core_orchestration_verdict,
      {
        canonicalIntentDigest: canonicalIntent.intent_digest,
        canonicalIntentBindingDigest: expectedCanonicalBinding.binding_digest,
      },
    );
  } catch {
    throw fail("nyra_converse_canonical_intent_preflight_mismatch", 409);
  }
  if (!actualCanonicalBinding ||
      actualCanonicalBinding.schema_version !== "nyra_canonical_intent_binding_v1" ||
      actualCanonicalBinding.intent_digest !== canonicalIntent.intent_digest ||
      actualCanonicalBinding.binding_digest !== expectedCanonicalBinding.binding_digest ||
      orchestrationVerdict.canonical_intent_binding?.binding_digest !== expectedCanonicalBinding.binding_digest ||
      orchestrationVerdict.external_execution_authorized !== false) {
    throw fail("nyra_converse_canonical_intent_preflight_mismatch", 409);
  }

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
  const requestedWorkId = boundedWorkId(args.work_id);
  // The client supplied a syntactically valid canonical ID.  Once the
  // authenticated preflight cannot bind that same ID, this is absence rather
  // than an unbound advisory answer.  Returning an explicit 404 keeps an AI
  // from treating "progress unavailable" as evidence that a nonexistent Work
  // is a real but empty one.  A different bound ID remains a 409: that is a
  // genuine context-integrity failure, not absence.
  if (requestedWorkId && !workId) {
    throw fail("nyra_converse_work_not_found", 404);
  }
  if (requestedWorkId && workId !== requestedWorkId) {
    throw fail("nyra_converse_work_binding_mismatch", 409);
  }
  // In a direct Nyra conversation project_id is only a client-side lookup
  // hint. The authenticated Work binding above is authoritative, so a stale
  // host hint must not force the model through a second, redundant retry.

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
  const selectionRequired = args.work_bootstrap === undefined &&
    args.canonical_intent?.work_requirement !== "NEW" && !workId && (
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
    canonicalIntent,
    canonicalIntentBinding: Object.freeze({ ...actualCanonicalBinding }),
    coreOrchestrationVerdict: Object.freeze({ ...orchestrationVerdict }),
    semanticEscalation: envelope.semantic_escalation || null,
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

function requireTenantBoundInterpretation(result, identity, canonicalIntent, message) {
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
  const automation = payload.result?.automation_plan || {};
  const deep = payload.result?.deep_nyra_runtime || {};
  const memory = payload.received_memory || payload.result?.memory_context || {};
  const selectedState = normalizeCoreState(selected.state);
  const selectedControl = normalizeCoreControl(selected.control_level);
  const selectedRisk = normalizeRisk(selected.risk_band);
  const expectedCanonicalBinding = bindNyraCanonicalIntent(canonicalIntent, { message });
  const interpretedPreflight = payload.result?.work_preflight || payload.work_preflight;
  const interpretedCanonicalBinding = interpretedPreflight?.canonical_intent_binding;
  let interpretedVerdict;
  try {
    interpretedVerdict = validateCoreOrchestrationVerdict(
      interpretedPreflight?.core_orchestration_verdict,
      {
        canonicalIntentDigest: canonicalIntent.intent_digest,
        canonicalIntentBindingDigest: expectedCanonicalBinding.binding_digest,
      },
    );
  } catch {
    throw fail("nyra_converse_canonical_intent_interpretation_mismatch", 409);
  }
  if (!interpretedCanonicalBinding ||
      interpretedCanonicalBinding.binding_digest !== expectedCanonicalBinding.binding_digest ||
      interpretedCanonicalBinding.intent_digest !== canonicalIntent.intent_digest ||
      interpretedVerdict.canonical_intent_binding?.binding_digest !== expectedCanonicalBinding.binding_digest ||
      interpretedVerdict.external_execution_authorized !== false) {
    throw fail("nyra_converse_canonical_intent_interpretation_mismatch", 409);
  }
  if (selected.can_execute !== false || automation.execution_allowed !== false) {
    throw fail("nyra_converse_interpretation_execution_claim_invalid", 409);
  }
  if (!selectedState || !selectedControl || selectedRisk === "unknown" ||
      !Array.isArray(selected.blocked_reasons) ||
      !Array.isArray(selected.unmet_conditions) ||
      !Array.isArray(selected.evidence_requirements) ||
      !Array.isArray(selected.allowed_alternatives) ||
      typeof selected.requires_owner_confirmation !== "boolean" ||
      typeof automation.owner_confirmation_required !== "boolean") {
    throw fail("nyra_converse_interpretation_contract_invalid", 409);
  }
  const actionId = boundedPublicText(selected.primary_action_id, 160);
  const actionLabel = safeActionText(selected.primary_action_label, MAX_SIGNAL_LENGTH);
  const selectedActionValid = Boolean(
    actionId && CORE_ACTION_ID_PATTERN.test(actionId) && actionLabel,
  );
  const blockedReasons = strictCoreSignalList(selected.blocked_reasons);
  const ownerConfirmationRequired =
    selected.requires_owner_confirmation === true || automation.owner_confirmation_required === true;
  const governanceDiagnostics = normalizeCoreGovernanceDiagnostics(
    selected,
    blockedReasons,
    ownerConfirmationRequired,
  );
  return Object.freeze({
    core: Object.freeze({
      mode: runtime.mode,
      route: runtime.route,
      authority: runtime.selected_authority,
      parity_matched: typeof runtime.parity?.matched === "boolean" ? runtime.parity.matched : null,
      execution_allowed: false,
    }),
    selected_action_id: selectedActionValid ? actionId : null,
    selected_action: selectedActionValid ? actionLabel : null,
    selected_action_available: selectedActionValid,
    core_state: selectedState,
    core_control: selectedControl,
    risk_band: selectedRisk,
    // Legacy Core versions may still return safety_mode. It remains visible
    // through diagnostics, but it cannot turn a read/proposal turn into a
    // fictitious hard block.
    blocked_reasons: Object.freeze(blockedReasons.filter((code) => code !== GENERIC_GUARD_REASON)),
    unmet_conditions: strictCoreSignalList(selected.unmet_conditions),
    evidence_requirements: strictCoreSignalList(selected.evidence_requirements),
    allowed_alternatives: strictCoreSignalList(selected.allowed_alternatives),
    next_step: safeActionText(automation.next_step, MAX_SIGNAL_LENGTH),
    runbook_candidate: boundedPublicText(automation.runbook_candidate, 160),
    owner_confirmation_required: ownerConfirmationRequired,
    governance_diagnostics: governanceDiagnostics,
    dialogue_accepted: deep.dialogue?.validator?.accepted === true,
    opened_branch_count: boundedCount(deep.cognition?.opened_branch_count),
    canonical_intent_binding: Object.freeze({ ...interpretedCanonicalBinding }),
    core_orchestration_verdict: Object.freeze({ ...interpretedVerdict }),
    semantic_escalation: interpretedPreflight?.semantic_escalation || null,
    memory: Object.freeze({
      revision: boundedCount(memory.revision),
      relevant_count: boundedCount(memory.relevant_count),
      handoff_count: boundedCount(memory.handoff_count),
      recent_activity_count: boundedCount(memory.recent_activity_count),
    }),
  });
}

function serverConnectorHint(args) {
  const hint = args?.[NYRA_SERVER_CONNECTOR_HINT];
  if (!hint || typeof hint !== "object" || Array.isArray(hint) || hint.server_issued !== true) {
    return Object.freeze({ request_kind: null, capability_hint: null });
  }
  const requestKind = new Set([
    "capability_discovery",
    "capability_read",
    "branch_diagnosis",
    "semantic_selection",
    "work_preflight",
  ]).has(hint.request_kind) ? hint.request_kind : null;
  const capabilityHint = typeof hint.capability_hint === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(hint.capability_hint)
    ? hint.capability_hint
    : null;
  return Object.freeze({ request_kind: requestKind, capability_hint: capabilityHint });
}

function requestedActionClass(canonicalIntent, connectorHint, workBootstrapProvided = false) {
  const requested = new Set(canonicalIntent?.requested_now || []);
  const has = (name) => [...requested].some((action) => action === name || action.startsWith(`${name}_`));
  if (connectorHint.capability_hint === "host_native_action_reserve") return "TICKET_RESERVE";
  // A structured bootstrap is an explicit, typed request.  Its contract must
  // win over incidental prose such as "then merge/deploy" in the objective;
  // otherwise a new-Work review can be incorrectly promoted to an external
  // mutation before Core has evaluated the candidate.
  if (workBootstrapProvided) return "WORK_BOOTSTRAP";
  if (has("merge")) return "GIT_MERGE";
  if (has("commit")) return "GIT_COMMIT";
  if (has("push")) return "GIT_PUSH";
  if (has("pull_request")) return "PULL_REQUEST_OPEN";
  if (has("deploy")) return "DEPLOY";
  if (has("publish")) return "PUBLISH";
  if (requested.has("work_bootstrap")) return "WORK_BOOTSTRAP";
  return "NONE";
}

function actionPolicy(
  canonicalIntent,
  connectorHint,
  coreOwnerConfirmationRequired = false,
  workBootstrapProvided = false,
) {
  const requested = canonicalIntent?.requested_now || [];
  const categories = [...new Set(requested.flatMap((action) => {
    const values = [];
    if (["commit", "push", "pull_request", "merge", "deploy", "publish", "rollback", "release"]
      .some((name) => action === name || action.startsWith(`${name}_`))) values.push("release");
    for (const name of ["communication", "destructive", "financial", "scheduling", "access"]) {
      if (action === name || action.endsWith(`_${name}`)) values.push(name);
    }
    return values;
  }))];
  const classifiedAction = requestedActionClass(canonicalIntent, connectorHint, workBootstrapProvided);
  if (classifiedAction === "GIT_COMMIT" && !categories.includes("release")) {
    categories.push("release");
  }
  const actionClass = classifiedAction === "NONE" && (categories.length > 0 || coreOwnerConfirmationRequired)
    ? "EXTERNAL_MUTATION"
    : classifiedAction;
  const mergeRequested = actionClass === "GIT_MERGE";
  const ticketReserveRequested = actionClass === "TICKET_RESERVE";
  const workBootstrapRequested = actionClass === "WORK_BOOTSTRAP";
  const consequential = categories.length > 0 || classifiedAction !== "NONE" ||
    coreOwnerConfirmationRequired;
  return Object.freeze({
    consequential_request_detected: consequential,
    categories: Object.freeze(categories),
    action_class: actionClass,
    capability_hint: connectorHint.capability_hint,
    merge_requested: mergeRequested,
    ticket_reserve_requested: ticketReserveRequested,
    work_bootstrap_requested: workBootstrapRequested,
    work_bootstrap_spec_provided: workBootstrapProvided,
    manual_owner_execution_requested:
      mergeRequested || (canonicalIntent?.owner_reserved_actions || []).length > 0,
    mode: consequential ? "proposal_only" : "advisory_only",
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

function pureResumeRequest(message) {
  const normalized = String(message || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 160) return false;
  return /^(?:nyra\s+)?(?:riprendi|continua|resume|continue)(?:\s+(?:(?:il|lo|la|questo|questa|the|this|current|existing|corrente|attuale)\s+)?(?:work|lavoro))?(?:\s+(?:esistente|corrente|attuale|current|existing))?$/u.test(normalized);
}

function sentence(value) {
  const text = boundedPublicText(value, MAX_SIGNAL_LENGTH);
  if (!text) return null;
  return `${text}${/[.!?]$/.test(text) ? "" : "."}`;
}

function unavailableWorkDirectiveContext(work, dialogue) {
  return Object.freeze({
    available: false,
    work_id: work.work_id,
    project_id: work.project_id,
    work_revision: dialogue.work_revision,
    intent_digest: dialogue.intent_digest,
    context_digest: null,
    status: null,
    acceptance_criteria_count: 0,
    required_task_count: 0,
    pending_required_task_count: 0,
    required_evidence_count: 0,
    unverified_required_evidence_count: 0,
    precommit_ticket_gate: null,
    precommit_ticket_gate_applicable: false,
    precommit_pending_required_task_count: 0,
    precommit_unverified_required_evidence_count: 0,
    next_required_task: null,
    closure_verified: false,
  });
}

function normalizePrecommitTicketGate(value, tenantId, workId) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("nyra_converse_precommit_ticket_gate_invalid", 409);
  }
  const legacyFields = [
    "schema_version", "tenant_id", "work_id", "action_kind", "gate_kind",
    "task_id", "plan_id", "evaluation_id", "evaluation_digest", "workspace_digest",
    "supersession_digest", "reconciliation_digest", "legacy_evidence_ids",
    "replacement_evidence_ids", "fulfilled", "ticket_id", "fresh", "drift_codes",
    "projection_digest",
  ];
  const native = value.schema_version === "precommit_ticket_gate_v2";
  const fields = native
    ? [...legacyFields, "gate_source", "v2_scope_snapshot_digest", "v2_scope_tasks"]
    : legacyFields;
  const nativeScopeTasksValid = !native || (
    /^[a-f0-9]{64}$/.test(String(value.v2_scope_snapshot_digest || "")) &&
    Array.isArray(value.v2_scope_tasks) && value.v2_scope_tasks.length <= 128 &&
    value.v2_scope_tasks.every((task) => task && typeof task === "object" && !Array.isArray(task) &&
      Object.keys(task).sort().join("\0") === ["revision", "task_id", "v2_task_digest"].join("\0") &&
      Boolean(boundedWorkId(task.task_id)) && /^[a-f0-9]{64}$/.test(String(task.v2_task_digest || "")) &&
      Number.isSafeInteger(task.revision) && task.revision >= 1) &&
    new Set(value.v2_scope_tasks.map((task) => task.task_id)).size === value.v2_scope_tasks.length
  );
  if (Object.keys(value).sort().join("\0") !== fields.sort().join("\0") ||
      (!native && value.schema_version !== "precommit_ticket_gate_v1") ||
      (native && value.gate_source !== "native_closure_evaluation") || !nativeScopeTasksValid ||
      value.tenant_id !== tenantId || boundedWorkId(value.work_id) !== workId ||
      value.action_kind !== "git.commit" || value.gate_kind !== "ticket_acquisition" ||
      !boundedWorkId(value.task_id) || !boundedWorkId(value.plan_id) ||
      !boundedWorkId(value.evaluation_id) ||
      ![value.evaluation_digest, value.workspace_digest, value.supersession_digest,
        value.reconciliation_digest, value.projection_digest]
        .every((item) => /^[a-f0-9]{64}$/.test(String(item || ""))) ||
      !Array.isArray(value.legacy_evidence_ids) ||
      (!native && !value.legacy_evidence_ids.length) ||
      (native && value.legacy_evidence_ids.length !== 0) ||
      value.legacy_evidence_ids.length > 128 ||
      value.legacy_evidence_ids.some((item) => !boundedWorkId(item)) ||
      new Set(value.legacy_evidence_ids).size !== value.legacy_evidence_ids.length ||
      !Array.isArray(value.replacement_evidence_ids) ||
      value.replacement_evidence_ids.length !== value.legacy_evidence_ids.length ||
      (native && value.replacement_evidence_ids.length !== 0) ||
      value.replacement_evidence_ids.some((item) => !boundedWorkId(item)) ||
      new Set(value.replacement_evidence_ids).size !== value.replacement_evidence_ids.length ||
      typeof value.fulfilled !== "boolean" || typeof value.fresh !== "boolean" ||
      !(value.ticket_id === null || (typeof value.ticket_id === "string" && value.ticket_id.length <= 160)) ||
      !Array.isArray(value.drift_codes) || value.drift_codes.length > 16 ||
      value.drift_codes.some((item) => typeof item !== "string" || !item || item.length > 160)) {
    throw fail("nyra_converse_precommit_ticket_gate_invalid", 409);
  }
  const { projection_digest: projectionDigest, ...material } = value;
  if (deterministicDigest(material) !== projectionDigest ||
      (value.fresh && value.drift_codes.length > 0) ||
      (!value.fresh && value.drift_codes.length === 0) ||
      (value.fulfilled !== Boolean(value.ticket_id))) {
    throw fail("nyra_converse_precommit_ticket_gate_invalid", 409);
  }
  return Object.freeze({
    ...value,
    legacy_evidence_ids: Object.freeze([...value.legacy_evidence_ids].sort()),
    replacement_evidence_ids: Object.freeze([...value.replacement_evidence_ids].sort()),
    ...(native ? { v2_scope_tasks: Object.freeze(value.v2_scope_tasks.map((task) => Object.freeze({ ...task }))) } : {}),
    drift_codes: Object.freeze([...value.drift_codes]),
  });
}

function fulfilledPrecommitPredecessorContextDigest(compact, gate) {
  if (
    gate?.schema_version !== "precommit_ticket_gate_v2" ||
    gate.fresh !== true || gate.fulfilled !== true ||
    typeof gate.ticket_id !== "string" || !gate.ticket_id ||
    compact?.precommit_ticket_gate_applicable !== false
  ) return null;
  const fulfilledTasks = compact.tasks.filter((task) => task.task_id === gate.task_id);
  if (
    fulfilledTasks.length !== 1 || fulfilledTasks[0].required !== true ||
    fulfilledTasks[0].status !== "completed" ||
    fulfilledTasks[0].acceptance_verified !== true
  ) return null;
  const { projection_digest: _projectionDigest, ...currentProjection } = gate;
  const predecessorProjectionDigest = deterministicDigest({
    ...currentProjection,
    fulfilled: false,
    ticket_id: null,
  });
  const predecessorTasks = compact.tasks.map((task) => task.task_id === gate.task_id
    ? Object.freeze({ ...task, status: "planned", acceptance_verified: false })
    : task);
  return deterministicDigest({
    ...compact,
    tasks: predecessorTasks,
    precommit_ticket_gate_projection_digest: predecessorProjectionDigest,
    precommit_ticket_gate_applicable: true,
  });
}

function requireWorkDirectiveContext(value, identity, workBinding, dialogue) {
  if (!value) return unavailableWorkDirectiveContext(workBinding, dialogue);
  const tenantId = requireAuthenticatedIdentity(identity);
  const work = value.work && typeof value.work === "object" && !Array.isArray(value.work)
    ? value.work
    : null;
  if (
    value.schema_version !== "work_continuity_v2" ||
    !work ||
    work.tenant_id !== tenantId ||
    boundedWorkId(work.work_id) !== workBinding.work_id ||
    (workBinding.project_id && work.project_id !== workBinding.project_id)
  ) throw fail("nyra_converse_directive_context_binding_invalid", 409);
  const suppliedRevision = Number(value.work_revision);
  const dialogueRevision = Number(dialogue.work_revision);
  if (
    Number.isSafeInteger(suppliedRevision) && suppliedRevision > 0 &&
    Number.isSafeInteger(dialogueRevision) && dialogueRevision > 0 &&
    suppliedRevision !== dialogueRevision
  ) throw fail("nyra_converse_directive_context_revision_mismatch", 409);
  const workRevision = Number.isSafeInteger(dialogueRevision) && dialogueRevision > 0
    ? dialogueRevision
    : Number.isSafeInteger(suppliedRevision) && suppliedRevision > 0 ? suppliedRevision : null;
  const workIntentDigest = /^[a-f0-9]{64}$/.test(String(work.intent_digest || ""))
    ? String(work.intent_digest)
    : null;
  if (dialogue.intent_digest && workIntentDigest && dialogue.intent_digest !== workIntentDigest) {
    throw fail("nyra_converse_directive_context_intent_mismatch", 409);
  }
  const intentDigest = dialogue.intent_digest || workIntentDigest;
  const status = String(work.status || "").trim().toUpperCase();
  if (!new Set([
    "PLANNED", "ACTIVE", "PAUSED", "BLOCKED", "HANDOFF", "COMPLETED",
    "CANCELLED", "SUPERSEDED", "ARCHIVED",
  ]).has(status)) throw fail("nyra_converse_directive_context_status_invalid", 409);
  if (!Array.isArray(work.acceptance_criteria) || work.acceptance_criteria.length > 250) {
    throw fail("nyra_converse_directive_context_acceptance_invalid", 409);
  }
  const acceptanceCriteria = [];
  for (const item of work.acceptance_criteria) {
    const criterion = boundedPublicText(item, 240);
    if (!criterion) throw fail("nyra_converse_directive_context_acceptance_invalid", 409);
    acceptanceCriteria.push(criterion);
  }
  if (Array.isArray(value.tasks) && value.tasks.length > 64) {
    throw fail("nyra_converse_directive_context_task_limit_exceeded", 409);
  }
  const tasks = [];
  for (const item of Array.isArray(value.tasks) ? value.tasks.slice(0, 64) : []) {
    const taskId = boundedWorkId(item?.task_id);
    const title = boundedPublicText(item?.title, 500);
    const taskStatus = String(item?.status || "").trim().toLowerCase();
    if (!taskId || !title || !new Set(["planned", "completed"]).has(taskStatus)) {
      throw fail("nyra_converse_directive_context_task_invalid", 409);
    }
    tasks.push(Object.freeze({
      task_id: taskId,
      title,
      status: taskStatus,
      required: item.required !== false,
      acceptance_verified: item.acceptance_verified === true,
    }));
  }
  if (Array.isArray(value.evidence) && value.evidence.length > 128) {
    throw fail("nyra_converse_directive_context_evidence_limit_exceeded", 409);
  }
  const evidence = [];
  for (const item of Array.isArray(value.evidence) ? value.evidence.slice(0, 128) : []) {
    const evidenceId = boundedWorkId(item?.evidence_id);
    const kind = boundedPublicText(item?.kind, 80);
    const evidenceDigest = /^[a-f0-9]{64}$/.test(String(item?.digest || ""))
      ? String(item.digest)
      : null;
    if (!evidenceId || !kind || !evidenceDigest) {
      throw fail("nyra_converse_directive_context_evidence_invalid", 409);
    }
    evidence.push(Object.freeze({
      evidence_id: evidenceId,
      kind,
      digest: evidenceDigest,
      required: item.required !== false,
      independently_verified: item.independently_verified === true,
    }));
  }
  const requiredTasks = tasks.filter((item) => item.required);
  const pendingRequiredTasks = requiredTasks.filter((item) => (
    item.status !== "completed" || item.acceptance_verified !== true
  ));
  const requiredEvidence = evidence.filter((item) => item.required);
  const unverifiedEvidence = requiredEvidence.filter((item) => !item.independently_verified);
  const precommitTicketGate = normalizePrecommitTicketGate(
    value.precommit_ticket_gate,
    tenantId,
    workBinding.work_id,
  );
  const pendingTaskIds = new Set(pendingRequiredTasks.map((item) => item.task_id));
  const unverifiedEvidenceIds = new Set(unverifiedEvidence.map((item) => item.evidence_id));
  const requiredVerifiedEvidenceIds = new Set(requiredEvidence
    .filter((item) => item.independently_verified)
    .map((item) => item.evidence_id));
  const precommitTicketGateApplicable = Boolean(
    precommitTicketGate?.fresh === true && precommitTicketGate.fulfilled === false &&
    pendingTaskIds.has(precommitTicketGate.task_id) &&
    (precommitTicketGate.schema_version === "precommit_ticket_gate_v2"
      ? tasks.some((item) => item.task_id === precommitTicketGate.task_id &&
          item.required === true && item.status === "planned" && item.acceptance_verified === false)
      : precommitTicketGate.legacy_evidence_ids.every((id) => unverifiedEvidenceIds.has(id)) &&
        precommitTicketGate.replacement_evidence_ids.every((id) => requiredVerifiedEvidenceIds.has(id)))
  );
  const precommitPendingRequiredTasks = precommitTicketGateApplicable
    ? pendingRequiredTasks.filter((item) => item.task_id !== precommitTicketGate.task_id)
    : pendingRequiredTasks;
  const mappedLegacyEvidenceIds = precommitTicketGateApplicable
    ? new Set(precommitTicketGate.legacy_evidence_ids)
    : new Set();
  const precommitUnverifiedEvidence = precommitTicketGateApplicable &&
    precommitTicketGate.schema_version === "precommit_ticket_gate_v2"
    ? []
    : unverifiedEvidence.filter((item) => !mappedLegacyEvidenceIds.has(item.evidence_id));
  const closureProjection = value.closure_verification &&
    typeof value.closure_verification === "object" &&
    !Array.isArray(value.closure_verification)
    ? value.closure_verification
    : null;
  const closureProjectionFields = [
    "schema_version", "verified", "tenant_id", "work_id", "status",
    "receipt_digest", "report_digest", "core_join_digest",
    "final_evidence_digest", "closure_event_hash", "failure_codes",
    "verification_digest",
  ];
  const closureProjectionExact = closureProjection &&
    Object.keys(closureProjection).sort().join("\0") === closureProjectionFields.sort().join("\0");
  const closureProjectionUnsigned = closureProjectionExact
    ? Object.fromEntries(Object.entries(closureProjection).filter(([key]) => key !== "verification_digest"))
    : null;
  const closureVerified = Boolean(
    closureProjectionExact && closureProjection.verified === true &&
    closureProjection.schema_version === "tenant_work_closure_verification_v1" &&
    closureProjection.tenant_id === tenantId &&
    boundedWorkId(closureProjection.work_id) === workBinding.work_id &&
    closureProjection.status === status &&
    [
      closureProjection.receipt_digest,
      closureProjection.report_digest,
      closureProjection.core_join_digest,
      closureProjection.final_evidence_digest,
      closureProjection.closure_event_hash,
      closureProjection.verification_digest,
    ].every((item) => /^[a-f0-9]{64}$/.test(String(item || ""))) &&
    Array.isArray(closureProjection.failure_codes) &&
    closureProjection.failure_codes.length === 0 &&
    deterministicDigest(closureProjectionUnsigned) === closureProjection.verification_digest,
  );
  const compact = {
    schema_version: "nyra_work_directive_context_v1",
    tenant_id: tenantId,
    work_id: workBinding.work_id,
    project_id: workBinding.project_id,
    work_revision: workRevision,
    intent_digest: intentDigest,
    status,
    objective: boundedPublicText(work.objective, 500),
    work_next_action: boundedPublicText(work.next_action, 500),
    acceptance_criteria_digests: acceptanceCriteria.map((item) => deterministicDigest(item)),
    tasks,
    evidence,
    precommit_ticket_gate_projection_digest: precommitTicketGate?.projection_digest || null,
    precommit_ticket_gate_applicable: precommitTicketGateApplicable,
    closure_verified: closureVerified,
    closure_verification_digest: closureVerified ? closureProjection.verification_digest : null,
  };
  const normalized = {
    available: true,
    work_id: workBinding.work_id,
    project_id: workBinding.project_id,
    work_revision: workRevision,
    intent_digest: intentDigest,
    context_digest: deterministicDigest(compact),
    status,
    acceptance_criteria_count: acceptanceCriteria.length,
    required_task_count: requiredTasks.length,
    pending_required_task_count: pendingRequiredTasks.length,
    required_evidence_count: requiredEvidence.length,
    unverified_required_evidence_count: unverifiedEvidence.length,
    precommit_ticket_gate: precommitTicketGate,
    precommit_ticket_gate_applicable: precommitTicketGateApplicable,
    precommit_pending_required_task_count: precommitPendingRequiredTasks.length,
    precommit_unverified_required_evidence_count: precommitUnverifiedEvidence.length,
    next_required_task: pendingRequiredTasks[0]
      ? Object.freeze({
          task_id: pendingRequiredTasks[0].task_id,
          title: pendingRequiredTasks[0].title,
          status: pendingRequiredTasks[0].status,
          acceptance_verified: pendingRequiredTasks[0].acceptance_verified,
      })
      : null,
    closure_verified: closureVerified,
  };
  // This internal, non-enumerable proof reconstructs the exact prior Work
  // context by undoing only a validated native precommit fulfillment. It lets
  // governed recovery tolerate that one transition while rejecting all other
  // task, evidence, acceptance, status, or next-action drift.
  const predecessorContextDigest = fulfilledPrecommitPredecessorContextDigest(
    compact,
    precommitTicketGate,
  );
  if (predecessorContextDigest) {
    Object.defineProperty(normalized, "fulfilled_precommit_predecessor_context_digest", {
      value: predecessorContextDigest,
      enumerable: false,
    });
  }
  return Object.freeze(normalized);
}

export function normalizeNyraDirectiveContext(value, identity, binding = {}) {
  return requireWorkDirectiveContext(
    value,
    identity,
    {
      work_id: binding.work_id,
      project_id: binding.project_id,
    },
    {
      work_revision: binding.work_revision,
      intent_digest: binding.intent_digest,
    },
  );
}

function releaseReadyDirectiveContext(work, workContext, interpretation) {
  const releaseStateRevalidated = interpretation?.source === "fresh_core_interpretation" ||
    workContext?.closure_verified === true;
  if (
    work?.state !== "release_ready" || workContext?.available !== true ||
    !releaseStateRevalidated
  ) return workContext;
  return Object.freeze({
    ...workContext,
    status: "RELEASE_READY",
    pending_required_task_count: 0,
    unverified_required_evidence_count: 0,
    precommit_pending_required_task_count: 0,
    precommit_unverified_required_evidence_count: 0,
    next_required_task: null,
  });
}

function orchestrationDirective({
  tenantId,
  message,
  work,
  dialogue,
  workContext,
  interpretation,
  action,
  connectorHint,
  workBootstrapRequestDigest = null,
  continuationOperation = null,
  canonicalIntentBinding = null,
  coreOrchestrationVerdict = null,
  semanticEscalation = null,
}) {
  workContext = releaseReadyDirectiveContext(work, workContext, interpretation);
  const workBound = Boolean(work.work_id);
  // Control Room is a server-derived, tenant-bound status read.  It must not
  // manufacture a Work-binding need simply because the caller asked a global
  // question without a Work id.
  const standaloneRead = ["control_room", "advisory_read"].includes(interpretation.source);
  const releaseReady = workContext.status === "RELEASE_READY";
  const coreBlocked = interpretation.governance_diagnostics.state === "BLOCKED" ||
    interpretation.risk_band === "blocked" ||
    interpretation.core_state === "blocked" || interpretation.core_control === "blocked" ||
    interpretation.blocked_reasons.length > 0;
  const coreMissingContext = interpretation.unmet_conditions.length > 0 ||
    interpretation.evidence_requirements.length > 0;
  const workBootstrapRequested = action.work_bootstrap_requested === true;
  const workBootstrapCandidate = workBootstrapRequested && !workBound;
  // A request to create a Work never creates a duplicate over an already
  // bound identity. In that case Nyra resumes the canonical Work and does not
  // issue a bootstrap candidate.
  const ticketRequired = workBootstrapRequested
    ? workBootstrapCandidate
    : action.consequential_request_detected || interpretation.owner_confirmation_required;
  const mergeManual = action.action_class === "GIT_MERGE" ||
    action.manual_owner_execution_requested === true;
  const commitPreflightGate = action.action_class === "GIT_COMMIT" &&
    workContext.precommit_ticket_gate_applicable === true
    ? workContext.precommit_ticket_gate
    : null;
  const binding = Object.freeze({
    tenant_id: tenantId,
    work_id: work.work_id,
    project_id: work.project_id,
    work_revision: workContext.work_revision,
    intent_digest: workContext.intent_digest,
    context_digest: workContext.context_digest,
    canonical_intent_digest: canonicalIntentBinding?.intent_digest || null,
    canonical_intent_binding_digest: canonicalIntentBinding?.binding_digest || null,
    core_orchestration_verdict_digest: coreOrchestrationVerdict?.verdict_digest || null,
    precommit_ticket_gate: commitPreflightGate
      ? Object.freeze({
          task_id: commitPreflightGate.task_id,
          plan_id: commitPreflightGate.plan_id,
          evaluation_id: commitPreflightGate.evaluation_id,
          evaluation_digest: commitPreflightGate.evaluation_digest,
          workspace_digest: commitPreflightGate.workspace_digest,
          supersession_digest: commitPreflightGate.supersession_digest,
          reconciliation_digest: commitPreflightGate.reconciliation_digest,
          projection_digest: commitPreflightGate.projection_digest,
        })
      : null,
  });

  const prerequisiteCodes = [];
  function prerequisite(code) {
    if (!prerequisiteCodes.includes(code)) prerequisiteCodes.push(code);
  }
  if (ticketRequired) {
    if (workBootstrapCandidate) {
      if (work.selection_required) prerequisite("work_selection_required");
      if (!work.project_id) prerequisite("project_binding_required");
      if (!/^[a-f0-9]{64}$/.test(String(workBootstrapRequestDigest || ""))) {
        prerequisite("work_bootstrap_spec_required");
      }
    } else {
      if (!workBound) prerequisite("work_binding_required");
      if (!work.project_id) prerequisite("project_binding_required");
      if (!workContext.work_revision) prerequisite("work_revision_required");
      if (!workContext.intent_digest) prerequisite("intent_digest_required");
      if (!workContext.available) prerequisite("work_directive_context_required");
      if (!releaseReady && workContext.available && workContext.acceptance_criteria_count === 0) {
        prerequisite("acceptance_criteria_required");
      }
      if (!releaseReady && workContext.available && workContext.required_task_count === 0) {
        prerequisite("required_work_tasks_missing");
      }
      const pendingTaskCount = commitPreflightGate
        ? workContext.precommit_pending_required_task_count
        : workContext.pending_required_task_count;
      if (!releaseReady && pendingTaskCount > 0) prerequisite("required_work_tasks_incomplete");
      if (!releaseReady && workContext.available && workContext.required_evidence_count === 0) {
        prerequisite("required_evidence_missing");
      }
      const unverifiedEvidenceCount = commitPreflightGate
        ? workContext.precommit_unverified_required_evidence_count
        : workContext.unverified_required_evidence_count;
      if (!releaseReady && unverifiedEvidenceCount > 0) {
        prerequisite("required_evidence_unverified");
      }
    }
    for (const item of interpretation.unmet_conditions) {
      prerequisite(`core_condition_${item}`.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120));
    }
    for (const item of interpretation.evidence_requirements) {
      prerequisite(`core_evidence_${item}`.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120));
    }
    if (action.ticket_reserve_requested) prerequisite("existing_core_ticket_required");
  }

  let ticketState = "NOT_REQUIRED";
  if (ticketRequired && coreBlocked) ticketState = "BLOCKED";
  else if (ticketRequired && prerequisiteCodes.length > 0) ticketState = "NEEDS_CONTEXT";
  else if (ticketRequired && workBootstrapCandidate) ticketState = "WORK_BOOTSTRAP_READY";
  else if (ticketRequired && mergeManual) ticketState = "MANUAL_ONLY";
  else if (ticketRequired) ticketState = "READY_FOR_CORE_REVIEW";

  let disposition = interpretation.source === "persisted_work_context" ? "RESUME" : "PROCEED_READ_ONLY";
  let problem = null;
  if (standaloneRead) {
    disposition = "PROCEED_READ_ONLY";
  } else if (work.selection_required) {
    disposition = "INSUFFICIENT_CONTEXT";
    problem = Object.freeze({
      kind: "WORK_BINDING",
      code: "work_selection_required",
      summary: "Non posso identificare in modo deterministico un unico Work canonico",
      capability_hint: action.capability_hint,
    });
  } else if (!workBound && ticketState === "WORK_BOOTSTRAP_READY") {
    disposition = "REQUEST_WORK_BOOTSTRAP";
    problem = Object.freeze({
      kind: "WORK_BOOTSTRAP",
      code: "governed_work_bootstrap_required",
      summary: "La specifica è pronta per la review anti-duplicato e il gate owner di Universal Core",
      capability_hint: action.capability_hint,
    });
  } else if (!workBound) {
    disposition = "INSUFFICIENT_CONTEXT";
    problem = Object.freeze({
      kind: "WORK_BINDING",
      code: "work_binding_required",
      summary: "Nessun Work canonico tenant-scoped è associato a questo turno",
      capability_hint: action.capability_hint,
    });
  } else if (coreBlocked || work.state === "failed") {
    disposition = "BLOCK";
    problem = Object.freeze({
      kind: "CORE_BLOCK",
      code: coreBlocked ? "universal_core_blocked_action" : "work_failed",
      summary: "L'azione è bloccata, ma diagnosi, evidenze e remediation non mutante possono continuare",
      capability_hint: action.capability_hint,
    });
  } else if (work.state === "completed" && !workContext.closure_verified) {
    disposition = "INSUFFICIENT_CONTEXT";
    problem = Object.freeze({
      kind: "TECHNICAL_REQUEST",
      code: "verified_closure_required",
      summary: "Il Work dichiara completamento ma manca una closure receipt verificata",
      capability_hint: action.capability_hint,
    });
  } else if (work.state === "completed" && workContext.closure_verified) {
    disposition = "COMPLETE";
  } else if (ticketRequired && ticketState === "READY_FOR_CORE_REVIEW") {
    disposition = "REQUEST_CORE_TICKET";
    problem = Object.freeze({
      kind: "CONSEQUENTIAL_REQUEST",
      code: "core_ticket_required",
      summary: "La preparazione è pronta per la verifica indipendente di Universal Core",
      capability_hint: action.capability_hint,
    });
  } else if (ticketRequired && ticketState === "MANUAL_ONLY") {
    disposition = "MANUAL_HANDOFF";
    problem = Object.freeze({
      kind: "MANUAL_MERGE",
      code: "manual_merge_core_gate_required",
      summary: "Il merge resta manuale all'owner dopo la verifica e il ticket esatto di Universal Core",
      capability_hint: action.capability_hint,
    });
  } else if (ticketRequired) {
    disposition = "PREPARE_BOUNDED_WORK";
    problem = Object.freeze({
      kind: mergeManual ? "MANUAL_MERGE" : "CONSEQUENTIAL_REQUEST",
      code: "governed_action_prerequisites_required",
      summary: "La mutazione esterna è in attesa, mentre il lavoro preparatorio bounded può continuare",
      capability_hint: action.capability_hint,
    });
  } else if (coreMissingContext) {
    disposition = "INSUFFICIENT_CONTEXT";
    problem = Object.freeze({
      kind: "TECHNICAL_REQUEST",
      code: "required_context_missing",
      summary: "Mancano condizioni o evidenze richieste da Core",
      capability_hint: action.capability_hint,
    });
  } else if (work.state === "blocked") {
    disposition = "HOLD";
    problem = Object.freeze({
      kind: "TECHNICAL_REQUEST",
      code: "work_blocked",
      summary: "Il Work è bloccato ma può proseguire con diagnosi, evidenze e remediation",
      capability_hint: action.capability_hint,
    });
  }

  let coreVerdict = "NOT_APPLICABLE";
  if (coreBlocked) coreVerdict = "BLOCK";
  else if (coreMissingContext) coreVerdict = "INSUFFICIENT_CONTEXT";
  else if (interpretation.governance_diagnostics.state === "CONFIRMATION_REQUIRED" ||
           interpretation.owner_confirmation_required) coreVerdict = "HOLD";
  else if (ticketRequired) coreVerdict = "NOT_REQUESTED";
  // A HOLD is an explicit Core confirmation gate.  It must be preserved on
  // every consequential ticket candidate even if an older Core response did
  // not set its legacy boolean field.
  const ownerConfirmationRequired = interpretation.owner_confirmation_required ||
    workBootstrapCandidate ||
    (ticketRequired && coreVerdict === "HOLD");

  const needs = [];
  function appendNeed(code, kind, state, authority, detail, sourceDigest = null) {
    if (needs.some((item) => item.code === code) || needs.length >= MAX_DIRECTIVE_ITEMS) return;
    needs.push(Object.freeze({
      code,
      kind,
      state,
      authority,
      detail: boundedPublicText(detail, MAX_SIGNAL_LENGTH),
      source_digest: /^[a-f0-9]{64}$/.test(String(sourceDigest || "")) ? sourceDigest : null,
    }));
  }
  if (work.selection_required) {
    appendNeed("work_selection_required", "CONTEXT", "MISSING", "OWNER",
      "Selezionare esplicitamente il Work Identity canonico persistente");
  } else if (workBootstrapCandidate && prerequisiteCodes.includes("work_bootstrap_spec_required")) {
    appendNeed("work_bootstrap_spec_required", "CONTEXT", "MISSING", "NYRA",
      "Specificare Intent, architecture, acceptance criteria e task graph del nuovo Work");
  } else if (workBootstrapCandidate) {
    appendNeed("work_bootstrap_core_review_required", "AUTHORITY", "REQUIRED", "UNIVERSAL_CORE",
      "Review anti-duplicato e gate owner per il Work canonico V2", workBootstrapRequestDigest);
  } else if (!workBound && !standaloneRead) {
    appendNeed("work_binding_required", "CONTEXT", "MISSING", "WORK_CONTINUITY",
      "Associare un Work Identity canonico tenant-scoped senza creare duplicati");
  }
  if (workContext.next_required_task) {
    appendNeed(
      `task_${workContext.next_required_task.task_id}`,
      "CONTEXT",
      "REQUIRED",
      "WORK_CONTINUITY",
      workContext.next_required_task.title,
      workContext.context_digest,
    );
  }
  if (prerequisiteCodes.includes("acceptance_criteria_required")) {
    appendNeed("acceptance_criteria_required", "CONTEXT", "MISSING", "WORK_CONTINUITY",
      "Acceptance criteria canonici e versionati", workContext.context_digest);
  }
  if (prerequisiteCodes.includes("required_evidence_missing") ||
      prerequisiteCodes.includes("required_evidence_unverified")) {
    appendNeed("verified_evidence_required", "EVIDENCE", "MISSING", "WORK_CONTINUITY",
      "Evidenze richieste con verifica indipendente", workContext.context_digest);
  }
  if (action.ticket_reserve_requested) {
    appendNeed("existing_core_ticket_required", "AUTHORITY", "MISSING", "UNIVERSAL_CORE",
      "Ticket Universal Core esistente e verificato prima di qualsiasi reserve");
  }
  if (ticketRequired && !workBootstrapCandidate) {
    appendNeed("exact_core_ticket_required", "AUTHORITY",
      ticketState === "BLOCKED" ? "BLOCKED" : "REQUIRED", "UNIVERSAL_CORE",
      "Ticket esatto e vincolato a tenant, Work, revisione, Intent e azione");
  }
  if (mergeManual) {
    appendNeed("manual_merge_required", "MANUAL_ACTION", "REQUIRED", "OWNER",
      "Merge manuale dell'owner soltanto dopo il gate Core");
  }
  if (ownerConfirmationRequired) {
    appendNeed("owner_confirmation_required", "CONFIRMATION", "REQUIRED", "OWNER",
      workBootstrapCandidate
        ? "Conferma owner fresca e request-bound prima della creazione V2"
        : "Conferma owner riferita alla specifica azione esterna");
  }
  const remediationByCoreCode = new Map(
    interpretation.governance_diagnostics.causes
      .filter((cause) => cause.state === "BLOCKED")
      .map((cause) => [cause.code, cause.remediation]),
  );
  for (const item of interpretation.blocked_reasons) {
    appendNeed(`core_block_${item}`.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120),
      "AUTHORITY", "BLOCKED", "UNIVERSAL_CORE",
      remediationByCoreCode.get(item) || `Risoluzione Core: ${item}`);
  }
  for (const cause of interpretation.governance_diagnostics.causes) {
    if (cause.state !== "BLOCKED") continue;
    appendNeed(`core_block_${cause.code}`.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120),
      "AUTHORITY", "BLOCKED", cause.component, cause.remediation);
  }
  for (const item of interpretation.unmet_conditions) {
    appendNeed(`core_condition_${item}`.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120),
      "CONTEXT", "MISSING", "UNIVERSAL_CORE", `Condizione richiesta: ${item}`);
  }
  for (const item of interpretation.evidence_requirements) {
    appendNeed(`core_evidence_${item}`.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120),
      "EVIDENCE", "MISSING", "UNIVERSAL_CORE", `Evidenza richiesta: ${item}`);
  }

  const requestDigest = deterministicDigest({
    schema_version: "nyra_orchestration_request_v1",
    tenant_id: tenantId,
    message_digest: deterministicDigest(String(message || "")),
    binding,
    action_class: action.action_class,
    capability_hint: action.capability_hint,
    prerequisite_codes: prerequisiteCodes,
    work_bootstrap_request_digest: workBootstrapRequestDigest,
    continuation_operation: continuationOperation,
  });
  const ticketRequestDigest = ticketRequired &&
    ["READY_FOR_CORE_REVIEW", "MANUAL_ONLY", "WORK_BOOTSTRAP_READY"].includes(ticketState)
    ? deterministicDigest({
        schema_version: "core_ticket_request_candidate_v1",
        binding,
        action_class: action.action_class,
        capability_hint: action.capability_hint,
        prerequisite_codes: prerequisiteCodes,
        merge_policy: mergeManual ? "MANUAL_ONLY" : "NOT_APPLICABLE",
        work_bootstrap_request_digest: workBootstrapRequestDigest,
        continuation_operation: continuationOperation,
      })
    : null;

  const interpretedAction = interpretation.allowed_alternatives[0] ||
    (ticketRequired
      ? interpretation.next_step || interpretation.selected_action
      : interpretation.selected_action || interpretation.next_step);
  const releaseReadyInterpretedAction = (
    coreBlocked || coreMissingContext || ticketRequired ||
    interpretation.allowed_alternatives.length > 0
  ) ? interpretedAction : null;
  let recommendedAction = standaloneRead
    ? null
    : workContext.next_required_task
      ? `Completare il task canonico: ${workContext.next_required_task.title}`
      : releaseReady
        ? releaseReadyInterpretedAction ||
          "Preparare il prossimo gate dal Core Join persistito senza ripetere task o evidenze già verificate"
        : interpretedAction || work.next_action;
  if (!recommendedAction && disposition !== "COMPLETE") {
    recommendedAction = "Diagnosticare lo stato corrente e preparare una proposta verificabile";
  }

  const nextActions = [];
  function appendAction(actor, stage, code, summary, mode, status, requires = [], externalSideEffect = false) {
    const actionText = safeActionText(summary, MAX_SIGNAL_LENGTH);
    if (!actionText || nextActions.length >= MAX_DIRECTIVE_ITEMS) return;
    nextActions.push(Object.freeze({
      order: nextActions.length + 1,
      actor,
      stage,
      code,
      summary: actionText,
      mode,
      status,
      requires: Object.freeze([...new Set(requires)].slice(0, MAX_DIRECTIVE_ITEMS)),
      external_side_effect: externalSideEffect,
    }));
  }
  if (work.selection_required) {
    appendAction("OWNER", "CONTEXT", "select_canonical_work",
      "Selezionare esplicitamente il Work canonico senza crearne uno nuovo",
      "READ_ONLY", "WAITING_ON_NEED", needs.map((item) => item.code));
  } else if (workBootstrapCandidate) {
    appendAction("HOST", "CONTEXT",
      prerequisiteCodes.includes("work_bootstrap_spec_required")
        ? "provide_work_bootstrap_spec"
        : "submit_work_bootstrap_review",
      prerequisiteCodes.includes("work_bootstrap_spec_required")
        ? "Ripresentare a Nyra la specifica strutturata con Intent, architecture, acceptance criteria e task graph"
        : "Sottoporre la specifica attestata alla review anti-duplicato; non creare ancora il Work",
      "CORE_GOVERNED",
      ticketState === "WORK_BOOTSTRAP_READY" ? "READY" : "WAITING_ON_NEED",
      prerequisiteCodes, false);
  } else if (!workBound && !standaloneRead) {
    appendAction("OWNER", "CONTEXT", "bind_canonical_work",
      "Associare un Work canonico esistente senza crearne un duplicato",
      "READ_ONLY", "WAITING_ON_NEED", needs.map((item) => item.code));
  } else if (!standaloneRead && recommendedAction && disposition !== "COMPLETE") {
    appendAction("HOST", workContext.next_required_task ? "CONTEXT" : "REASONING",
      workContext.next_required_task ? "complete_next_work_task" : "prepare_bounded_work",
      recommendedAction, ticketRequired ? "BOUNDED_WORKSPACE" : "READ_ONLY", "READY",
      workContext.next_required_task ? [`task_${workContext.next_required_task.task_id}`] : []);
  }
  const effectiveUnverifiedEvidenceCount = commitPreflightGate
    ? workContext.precommit_unverified_required_evidence_count
    : workContext.unverified_required_evidence_count;
  if (coreMissingContext || effectiveUnverifiedEvidenceCount > 0 ||
      prerequisiteCodes.includes("required_evidence_missing")) {
    appendAction("HOST", "EVIDENCE", "collect_missing_evidence",
      "Raccogliere e collegare al Work le evidenze mancanti con verifica indipendente",
      "BOUNDED_WORKSPACE", "READY",
      needs.filter((item) => item.kind === "EVIDENCE").map((item) => item.code));
  }
  if (ticketRequired && workBootstrapCandidate) {
    appendAction("UNIVERSAL_CORE", "AUTHORITY", "review_work_bootstrap",
      "Verificare la review anti-duplicato e richiedere una conferma owner request-bound prima della creazione V2",
      "CORE_GOVERNED",
      ticketState === "WORK_BOOTSTRAP_READY" ? "READY" : "HELD",
      prerequisiteCodes, false);
  } else if (ticketRequired) {
    appendAction("UNIVERSAL_CORE", "AUTHORITY", "review_ticket_candidate",
      "Verificare indipendentemente prerequisiti e candidate prima di emettere il ticket esatto",
      "CORE_GOVERNED",
      ["READY_FOR_CORE_REVIEW", "MANUAL_ONLY"].includes(ticketState) ? "READY" : "HELD",
      prerequisiteCodes, false);
  }
  if (mergeManual) {
    appendAction("OWNER", "EXECUTION", "manual_merge_after_core_gate",
      "Eseguire manualmente il merge soltanto dopo ticket Core verificato e host approval",
      "MANUAL", "MANUAL", ["exact_core_ticket_required"], true);
  } else if (ticketRequired && !workBootstrapCandidate) {
    appendAction("HOST", "EXECUTION", "bounded_external_action_after_core_gate",
      "Eseguire l'azione bounded soltanto dopo ticket Core verificato e host approval",
      "CORE_GOVERNED", "HELD", ["exact_core_ticket_required"], true);
  }

  const permittedProgress = standaloneRead
    ? ["READ_ONLY"]
    : work.selection_required || (!workBound && !workBootstrapCandidate)
      ? ["DISAMBIGUATION"]
      : workBootstrapCandidate
        ? (ticketState === "WORK_BOOTSTRAP_READY" ? ["WORK_BOOTSTRAP_REVIEW"] : ["DISAMBIGUATION"])
        : disposition === "COMPLETE"
          ? []
          : ["READ_ONLY", "ANALYSIS", "EVIDENCE", "BOUNDED_WORKSPACE", "PROPOSAL"];
  const reasonCodes = [
    ...(problem ? [problem.code] : []),
    ...interpretation.blocked_reasons,
    ...interpretation.governance_diagnostics.causes.map((cause) => cause.code),
    ...prerequisiteCodes,
  ].map((item) => directiveCode(item))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 16);
  const source = connectorHint.request_kind
    ? "LEGACY_CONNECTOR_HINT"
    : interpretation.source === "persisted_work_context" ? "PERSISTED_WORK"
      : interpretation.source === "work_gallery" ? "WORK_GALLERY"
        : interpretation.source === "control_room" ? "CONTROL_ROOM"
          : "FRESH_CORE";
  const decision = Object.freeze({
    disposition,
    recommendation_authority: "NYRA",
    final_authority: "UNIVERSAL_CORE",
    core_verdict: coreVerdict,
    reason_codes: Object.freeze(reasonCodes),
    execution_authorized: false,
    external_action_authorized: false,
  });
  const ticketRequest = Object.freeze({
    schema_version: "core_ticket_request_candidate_v1",
    required: ticketRequired,
    state: ticketState,
    action_class: action.action_class,
    capability_hint: action.capability_hint,
    capability_resolution: !ticketRequired
      ? "NOT_REQUIRED"
      : action.capability_hint ? "SERVER_SIDE_RESOLVED" : "SERVER_SIDE_REQUIRED",
    binding,
    prerequisite_codes: Object.freeze(prerequisiteCodes),
    owner_confirmation_required:
      ownerConfirmationRequired,
    host_approval_required: ticketRequired,
    core_independent_verification_required: true,
    merge_policy: mergeManual ? "MANUAL_ONLY" : "NOT_APPLICABLE",
    work_bootstrap_request_digest: workBootstrapRequestDigest,
    request_digest: ticketRequestDigest,
    ticket_id: null,
    ticket_issued: false,
    execution_authorized: false,
  });
  const directiveId = `nyra_dir_${deterministicDigest({ request_digest: requestDigest, decision, ticket_request: ticketRequest }).slice(0, 24)}`;

  return Object.freeze({
    schema_version: "nyra_orchestration_directive_v2",
    directive_id: directiveId,
    request_digest: requestDigest,
    source,
    problem,
    canonical_intent_binding: canonicalIntentBinding,
    core_orchestration_verdict: coreOrchestrationVerdict,
    semantic_escalation: semanticEscalation,
    core_diagnostics: interpretation.governance_diagnostics,
    needs: Object.freeze(needs),
    next_actions: Object.freeze(nextActions),
    decision,
    work_context: workContext,
    permitted_progress: Object.freeze(permittedProgress),
    can_continue: disposition !== "COMPLETE",
    ticket_request: ticketRequest,
    execution_authorized: false,
  });
}

function directiveActor(actor, english) {
  if (actor === "CODEX") return "Codex";
  if (actor === "OWNER") return english ? "Owner" : "Tu";
  if (actor === "UNIVERSAL_CORE") return "Universal Core";
  if (actor === "HOST") return english ? "Connected AI" : "AI collegata";
  return "Nyra";
}

function directiveConversationFocus(message) {
  const text = String(message || "").trim();
  if (DIAGNOSTIC_REQUEST_PATTERN.test(text)) return "diagnosis";
  if (/\b(?:riprova|retry|continua|prosegui|riprendi|avanti)\b/iu.test(text)) return "progress";
  return "standard";
}

function directiveProgressSummary(workContext, english) {
  const pendingTasks = boundedCount(workContext?.pending_required_task_count);
  const pendingEvidence = boundedCount(workContext?.unverified_required_evidence_count);
  if (!pendingTasks && !pendingEvidence) return null;
  const details = [];
  if (pendingTasks) details.push(english
    ? `${pendingTasks} required task${pendingTasks === 1 ? "" : "s"}`
    : `${pendingTasks} attività obbligatori${pendingTasks === 1 ? "a" : "e"}`);
  if (pendingEvidence) details.push(english
    ? `${pendingEvidence} evidence item${pendingEvidence === 1 ? "" : "s"} to verify`
    : `${pendingEvidence} evidenz${pendingEvidence === 1 ? "a da verificare" : "e da verificare"}`);
  return english ? `Remaining: ${details.join(" and ")}.` : `Restano ${details.join(" e ")}.`;
}

function directiveStateSummary({ directive, workBound, focus, english }) {
  const disposition = directive.decision.disposition;
  const ticket = directive.ticket_request || {};
  const hardBlock = directive.core_diagnostics?.state === "BLOCKED";
  if (hardBlock) {
    return english
      ? "There is a concrete Core blocker; I will keep the Work intact and focus only on the stated remedy."
      : "C'è un blocco concreto di Core: mantengo il Work invariato e procedo solo sulla correzione indicata.";
  }
  if (disposition === "COMPLETE") return english
    ? "The Work has a verified closure."
    : "Il Work ha una chiusura verificata.";
  if (directive.work_context?.status === "RELEASE_READY") return english
    ? "The Work is release-ready: tasks, evidence, and independent verification are already satisfied."
    : "Il Work è release-ready: task, evidenze e verifica indipendente sono già acquisiti.";
  if (disposition === "REQUEST_WORK_BOOTSTRAP") return english
    ? "The new Work is specified and ready for its duplicate review."
    : "Il nuovo Work è definito e pronto per la review anti-duplicato.";
  if (["REQUEST_CORE_TICKET", "MANUAL_HANDOFF"].includes(disposition) ||
      ["READY_FOR_CORE_REVIEW", "MANUAL_ONLY"].includes(ticket.state)) return english
    ? "The preparation is complete: Universal Core can review the exact ticket candidate."
    : "La preparazione è completa: Universal Core può esaminare il candidate di ticket esatto.";
  if (!workBound) return english
    ? "I need one canonical Work before I can coordinate the next step."
    : "Mi serve un solo Work canonico prima di coordinare il prossimo passo.";
  if (focus === "diagnosis" && directive.core_diagnostics?.guard_mode === "confirmation_required") {
    return english
      ? "I found no technical stop: the guard applies only to the external action, while local work can continue."
      : "Non ho rilevato uno stop tecnico: il guard riguarda solo l'azione esterna, mentre il lavoro locale può continuare.";
  }
  if (ticket.required || disposition === "PREPARE_BOUNDED_WORK") return focus === "diagnosis"
    ? (english ? "This is not a technical stop: local analysis and evidence can advance now."
      : "Non è uno stop tecnico: analisi ed evidenze locali possono avanzare ora.")
    : (english ? "I can move the local preparation forward without reopening the analysis."
      : "Posso far avanzare la preparazione locale senza ricominciare l'analisi.");
  if (["RESUME", "PROCEED_READ_ONLY"].includes(disposition)) return focus === "progress"
    ? (english ? "I am resuming from the last verifiable point in this Work."
      : "Riprendo dal punto verificabile di questo Work.")
    : (english ? "The Work can continue from its current verified state."
      : "Il Work può continuare dal suo stato verificato attuale.");
  return directive.problem?.summary
    ? (english ? `Focus: ${sentence(directive.problem.summary)}` : `Focus: ${sentence(directive.problem.summary)}`)
    : (english ? "The Work is ready for its next bounded step." : "Il Work è pronto per il prossimo passo circoscritto.");
}

function directiveTicketSummary(ticket, english) {
  if (!ticket?.required) return null;
  if (ticket.state === "WORK_BOOTSTRAP_READY") return english
    ? "Next gate: submit the exact bootstrap candidate for duplicate review, then request a fresh owner confirmation."
    : "Prossimo gate: sottoporre il candidate di bootstrap esatto alla review anti-duplicato, poi chiedere una conferma owner fresca.";
  if (["READY_FOR_CORE_REVIEW", "MANUAL_ONLY"].includes(ticket.state)) return english
    ? "Next gate: request Core review for this revision-bound candidate."
    : "Prossimo gate: richiedere a Core la review di questo candidate vincolato alla revisione.";
  return english
    ? "The ticket remains pending until the listed evidence and acceptance prerequisites are verified."
    : "Il ticket resta in attesa finché evidenze e criteri di accettazione indicati non sono verificati.";
}

function directiveReplySeed(locale, directive, workBound, { message = "", style = "balanced" } = {}) {
  const english = locale === "en";
  const focus = directiveConversationFocus(message);
  const responseStyle = ["concise", "balanced", "detailed"].includes(style) ? style : "balanced";
  const parts = [directiveStateSummary({ directive, workBound, focus, english })];
  const first = directive.next_actions?.[0];
  if (first?.summary) {
    const actor = directiveActor(first.actor, english);
    parts.push(english
      ? `Now: ${actor} — ${sentence(first.summary)}`
      : `Adesso: ${actor} — ${sentence(first.summary)}`);
  }
  const hardCauses = (directive.core_diagnostics?.causes || [])
    .filter((cause) => cause?.state === "BLOCKED")
    .map((cause) => cause.remediation)
    .filter(Boolean);
  if (responseStyle === "detailed" && hardCauses.length) {
    parts.push(english ? `Why: ${hardCauses.slice(0, 2).join("; ")}` : `Perché: ${hardCauses.slice(0, 2).join("; ")}`);
  }
  const needs = (directive.needs || []).map((item) => item?.detail).filter(Boolean);
  if (responseStyle !== "concise" && needs.length) {
    parts.push(english
      ? `To unblock the next gate: ${needs.slice(0, responseStyle === "detailed" ? 2 : 1).join("; ")}`
      : `Per sbloccare il prossimo gate: ${needs.slice(0, responseStyle === "detailed" ? 2 : 1).join("; ")}`);
  }
  if (responseStyle === "detailed") {
    const progress = directiveProgressSummary(directive.work_context, english);
    if (progress) parts.push(progress);
  }
  if (responseStyle !== "concise") {
    const ticket = directiveTicketSummary(directive.ticket_request, english);
    if (ticket) parts.push(ticket);
  }
  if (directive.ticket_request?.continuation?.available === true && responseStyle === "detailed") {
    parts.push(english
      ? "The connected host can submit this exact candidate through Nyra's governed continuation."
      : "L'AI collegata può sottoporre questo candidate esatto tramite la continuazione governata di Nyra.");
  }
  if (directive.ticket_request?.merge_policy === "MANUAL_ONLY") {
    parts.push(english
      ? "After the Core gate, the merge remains your manual action."
      : "Dopo il gate Core, il merge resta un'azione manuale tua.");
  }
  return parts.filter(Boolean).join("\n\n").slice(0, 1_200);
}

function connectedAiBrief(locale, directive) {
  const english = locale === "en";
  const context = directive.work_context || {};
  const evidenceNeeds = (directive.needs || [])
    .filter((item) => item?.kind === "EVIDENCE")
    .map((item) => boundedPublicText(item.detail, MAX_SIGNAL_LENGTH))
    .filter(Boolean)
    .slice(0, 3);
  const readyActions = (directive.next_actions || [])
    .filter((action) => ["HOST", "CODEX"].includes(action?.actor) &&
      action.external_side_effect !== true && action.status === "READY")
    .slice(0, 3);
  const steps = readyActions.map((action, index) => {
    const expectedEvidence = action.code === "complete_next_work_task" && context.next_required_task?.title
      ? [english
        ? `Bounded result for: ${context.next_required_task.title}`
        : `Esito circoscritto per: ${context.next_required_task.title}`]
      : action.code === "collect_missing_evidence" ? evidenceNeeds : [];
    return Object.freeze({
      order: index + 1,
      instruction: action.summary,
      mode: action.mode === "READ_ONLY" ? "READ_ONLY" : "BOUNDED_WORKSPACE",
      expected_evidence: Object.freeze(expectedEvidence),
      external_side_effect: false,
    });
  });
  const firstNeed = (directive.needs || []).find((item) => item?.detail)?.detail || null;
  const goal = steps[0]?.instruction || firstNeed || (english
    ? "Wait for the next server-issued Work instruction."
    : "Attendere la prossima istruzione Work emessa dal server.");
  return Object.freeze({
    schema_version: "nyra_connected_ai_brief_v1",
    state: steps.length ? "READY" : "WAITING",
    goal: boundedPublicText(goal, MAX_SIGNAL_LENGTH),
    steps: Object.freeze(steps),
    expected_evidence: Object.freeze(evidenceNeeds),
    research_required: false,
    external_action_authorized: false,
  });
}

function turnId({ tenantId, sessionId, message, workId, projectId, locale, style, workSelectionCursor }) {
  const digest = crypto.createHash("sha256").update(JSON.stringify({
    tenantId,
    sessionId,
    message,
    workId,
    projectId,
    locale,
    style,
    workSelectionCursor,
  })).digest("hex");
  return `nyra_turn_${digest.slice(0, 24)}`;
}

function textResult(payload) {
  const contract = payload.host_response_contract;
  return {
    structuredContent: payload,
    // The descriptor is not enough for hosts that cached a previous tool
    // list. Bind the resource on the actual result as well, using both the
    // MCP Apps field and ChatGPT's compatibility alias.
    _meta: {
      ui: { resourceUri: NYRA_DIALOGUE_WIDGET_URI },
      "openai/outputTemplate": NYRA_DIALOGUE_WIDGET_URI,
    },
    // Keep the model-facing narration deliberately final and small. The
    // structured payload remains available for a governed follow-up, but
    // listing Work ids, authority levels or diagnostics here tempted hosts to
    // perform their own multi-tool investigation after a simple Nyra resume.
    content: [{ type: "text", text: contract.reply_seed }],
  };
}

function workSelectionRequested(args, message) {
  if (boundedWorkId(args?.work_id) || args?.work_bootstrap !== undefined ||
      args?.continuation_operation !== undefined) return false;
  if (args?.work_selection_mode === "list") return true;
  return WORK_SELECTION_LIST_PATTERN.test(String(message || ""));
}

function selectionIdentityBinding(identity) {
  return Object.freeze({
    authenticated: true,
    tenant_bound: true,
    principal_kind: normalizedIdentityKind(identity),
    client_type: normalizedClientType(identity),
    host_registered: identity.authenticatedHostPrincipal?.registered === true,
    app_id: boundedString(identity.authenticatedHostPrincipal?.app_id, 64),
    host_kind: boundedString(identity.authenticatedHostPrincipal?.host_kind, 80),
    host_registry_revision: /^[a-f0-9]{64}$/.test(String(
      identity.authenticatedHostPrincipal?.registry_revision || "",
    )) ? identity.authenticatedHostPrincipal.registry_revision : null,
    caller_authority_accepted: false,
  });
}

function normalizeWorkSelectionChoices(value, requestedProjectId) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const seen = new Set();
  const choices = [];
  for (const candidate of value) {
    if (choices.length >= MAX_WORK_SELECTION_CATALOG_SIZE) break;
    const workId = boundedWorkId(candidate?.work_id);
    const projectId = boundedProjectId(candidate?.project_id);
    if (!workId || !projectId || seen.has(workId) ||
        (requestedProjectId && projectId !== requestedProjectId)) continue;
    seen.add(workId);
    const name = boundedPublicText(
      candidate?.work_name || candidate?.name || candidate?.idea || candidate?.objective,
      240,
    ) || `Work ${choices.length + 1}`;
    choices.push(Object.freeze({
      work_id: workId,
      project_id: projectId,
      work_name: name,
      status: boundedPublicText(candidate?.status, 40) || "unknown",
    }));
  }
  return Object.freeze(choices);
}

function workSelectionDialogue(selection) {
  const choiceCount = selection.total_count;
  return Object.freeze({
    dialogue_id: null,
    manual_digest: null,
    work_revision: null,
    intent_digest: null,
    checkpoint_available: false,
    gallery_work_count: choiceCount,
    software_state: "not_indexed",
    atlas_revision: null,
    diagnosis_state: selection.available
      ? (choiceCount ? "work_selection_required" : "work_gallery_empty")
      : "work_gallery_unavailable",
    next_action_available: false,
    assignment: Object.freeze({
      available: false,
      assignment_id: null,
      role: null,
      state: null,
    }),
  });
}

function workSelectionInterpretation() {
  return Object.freeze({
    source: "work_gallery",
    core: Object.freeze({
      mode: "off",
      route: "V0",
      authority: "V0",
      parity_matched: null,
      execution_allowed: false,
    }),
    selected_action_id: null,
    selected_action: null,
    selected_action_available: false,
    core_state: "observe",
    core_control: "observe",
    risk_band: "low",
    blocked_reasons: Object.freeze([]),
    governance_diagnostics: Object.freeze({
      state: "READY",
      guard_mode: "normal",
      causes: Object.freeze([]),
    }),
    unmet_conditions: Object.freeze([]),
    evidence_requirements: Object.freeze([]),
    allowed_alternatives: Object.freeze([]),
    next_step: null,
    runbook_candidate: null,
    owner_confirmation_required: false,
    dialogue_accepted: true,
    opened_branch_count: 0,
    memory: Object.freeze({
      revision: 0,
      relevant_count: 0,
      handoff_count: 0,
      recent_activity_count: 0,
    }),
  });
}

function controlRoomInterpretation() {
  // The Control Room reader is an authenticated server read, not a Core
  // interpretation and not a Work selection.  Reuse the compact public
  // shape while keeping that provenance explicit for replay and rendering.
  return Object.freeze({
    ...workSelectionInterpretation(),
    source: "control_room",
  });
}

function advisoryReadInterpretation() {
  return Object.freeze({
    ...workSelectionInterpretation(),
    source: "advisory_read",
  });
}

function requireControlRoomStatus(value, tenantId) {
  const payload = value?.structuredContent && typeof value.structuredContent === "object" &&
    !Array.isArray(value.structuredContent) ? value.structuredContent : null;
  const controlRoom = payload?.control_room;
  if (
    !payload || typeof payload.ok !== "boolean" || payload.tenant_id !== tenantId ||
    !controlRoom || typeof controlRoom !== "object" || Array.isArray(controlRoom) ||
    controlRoom.schema_version !== "nyra_control_room_status_v1"
  ) throw new Error("nyra_control_room_status_invalid");
  const projection = projectNyraConversationControlRoomReadback(controlRoom);
  // The read is deliberately global and is invoked with `{}`.  A reader that
  // nevertheless attaches a Work must not smuggle its task/title into the
  // conversational boundary; treat the unexpected scope as invalid instead.
  if (projection.work_progress.available !== false) {
    throw new Error("nyra_control_room_readback_invalid");
  }
  return projection;
}

function advisoryUsesEnglish(locale, message) {
  if (locale === "en") return true;
  if (locale === "it") return false;
  const text = String(message || "").toLowerCase();
  const englishSignals = /\b(?:what|which|show|tell|status|commands?|features?|enabled|disabled|dialogue|controls?)\b/u.test(text);
  const italianSignals = /\b(?:che|quali|mostra|dimmi|stato|comandi|funzioni|abilitat\w*|disabilitat\w*|dialogo|controlli)\b/u.test(text);
  return englishSignals && !italianSignals;
}

const CONTROL_ROOM_DOMAIN_LABELS = Object.freeze({
  nyra_dialogue: Object.freeze({ it: "Dialogo Nyra", en: "Nyra Dialogue" }),
  entity_360: Object.freeze({ it: "Entity 360", en: "Entity 360" }),
  semantic_scope_guard: Object.freeze({ it: "Semantic Scope Guard", en: "Semantic Scope Guard" }),
  work_continuity: Object.freeze({ it: "Continuità Work", en: "Work Continuity" }),
  research_airlock: Object.freeze({ it: "Research Airlock", en: "Research Airlock" }),
  policy_registry: Object.freeze({ it: "Registro policy", en: "Policy Registry" }),
});

const CONTROL_ROOM_ACTION_LABELS = Object.freeze({
  REQUEST_CONFIGURATION_CHANGE: Object.freeze({ it: "richiedi una modifica di configurazione", en: "request a configuration change" }),
  REQUEST_ENABLE_SHADOW: Object.freeze({ it: "richiedi l'attivazione SHADOW", en: "request SHADOW enablement" }),
  REQUEST_DISABLE_SHADOW: Object.freeze({ it: "richiedi la disattivazione SHADOW", en: "request SHADOW disablement" }),
  REQUEST_LIFECYCLE_ACTION: Object.freeze({ it: "richiedi un'azione sul ciclo di vita", en: "request a lifecycle action" }),
});

function controlRoomReplySeed(locale, controlRoom) {
  const english = locale === "en";
  const language = english ? "en" : "it";
  const statuses = controlRoom.domains.map((domain) =>
    `${CONTROL_ROOM_DOMAIN_LABELS[domain.id][language]}: ${domain.state}`,
  ).join("; ");
  const governedRequests = controlRoom.domains.flatMap((domain) => domain.allowed_actions
    .filter((action) => action.id !== "READ_STATUS" && action.availability !== "UNAVAILABLE")
    .map((action) => {
      const requirements = [];
      if (action.requires_owner_confirmation) requirements.push(english ? "owner confirmation" : "conferma owner");
      if (action.requires_core_authorization) requirements.push(english ? "Core authorization" : "autorizzazione Core");
      if (action.restart_required) requirements.push(english ? "restart required" : "riavvio richiesto");
      const suffix = requirements.length ? ` (${requirements.join(", ")})` : "";
      return `${CONTROL_ROOM_DOMAIN_LABELS[domain.id][language]}: ${CONTROL_ROOM_ACTION_LABELS[action.id][language]}${suffix}`;
    }));
  const requests = governedRequests.length ? governedRequests.join("; ") :
    (english ? "No governed change is currently available." : "Non risultano modifiche governate disponibili.");
  return english
    ? `Current Control Room status: ${statuses}. Governed requests: ${requests}. This was a read only: I did not open, select, resume, or create a Work, ticket, or action.`
    : `Stato attuale Control Room: ${statuses}. Richieste governate: ${requests}. Questa è una lettura: non ho aperto, selezionato, ripreso o creato alcun Work, ticket o azione.`;
}

function workSelectionReplySeed(locale, selection) {
  const english = locale === "en";
  if (!selection.available) return english
    ? "I cannot read the Work list right now. No Work was resumed or changed; retry this read-only request."
    : "Non riesco a leggere ora la lista dei Work. Non ho ripreso né modificato alcun Work: riprova questa richiesta in sola lettura.";
  if (selection.total_count === 0) return english
    ? "There are no active Works available to select. No Work was resumed or changed."
    : "Non ci sono Work attivi disponibili da selezionare. Non ho ripreso né modificato alcun Work.";
  if (!selection.choices.length) return english
    ? "There are no more Works on this page. No Work was resumed or changed."
    : "Non ci sono altri Work in questa pagina. Non ho ripreso né modificato alcun Work.";
  // Work metadata is rendered by the structured selector.  Never concatenate
  // tenant-provided names here: eight valid 240-character names would exceed
  // the response contract and would turn untrusted text into model narration.
  const continuation = selection.has_more
    ? (english ? " More choices are available on the next page." : " Ci sono altre scelte nella pagina successiva.")
    : "";
  return english
    ? `Choose one of the ${selection.choices.length} displayed Works; I will not continue one automatically.${continuation}`
    : `Scegli uno dei ${selection.choices.length} Work mostrati; non ne continuo nessuno automaticamente.${continuation}`;
}

async function readWorkSelection(listWorkChoices, identity, projectId, cursor) {
  if (typeof listWorkChoices !== "function") {
    return Object.freeze({
      available: false,
      choices: Object.freeze([]),
      total_count: 0,
      has_more: false,
      next_cursor: null,
    });
  }
  try {
    const value = await listWorkChoices(identity, projectId ? { project_id: projectId } : {});
    const allChoices = normalizeWorkSelectionChoices(value, projectId);
    const offset = Math.min(cursor, allChoices.length);
    const page = allChoices.slice(offset, offset + MAX_WORK_SELECTION_PAGE_SIZE)
      .map((choice, index) => Object.freeze({
        ...choice,
        ordinal: offset + index + 1,
      }));
    const nextOffset = offset + page.length;
    return Object.freeze({
      available: true,
      choices: Object.freeze(page),
      total_count: allChoices.length,
      has_more: nextOffset < allChoices.length,
      next_cursor: nextOffset < allChoices.length ? `nws_${nextOffset}` : null,
    });
  } catch {
    // A Gallery outage must not fall through to the resumptive preflight. The
    // caller asked for a read-only choice, so retain that safety boundary.
    return Object.freeze({
      available: false,
      choices: Object.freeze([]),
      total_count: 0,
      has_more: false,
      next_cursor: null,
    });
  }
}

async function workSelectionResult({
  identity,
  tenantId,
  sessionId,
  message,
  locale,
  style,
  projectId,
  workSelectionCursor,
  listWorkChoices,
}) {
  const selection = await readWorkSelection(
    listWorkChoices,
    identity,
    projectId,
    parseWorkSelectionCursor(workSelectionCursor),
  );
  const selectionRequired = selection.available && selection.choices.length > 0;
  const work = Object.freeze({
    preflight_bound: false,
    work_bound: false,
    work_id: null,
    project_id: projectId,
    state: selectionRequired ? "selection_required" : "unbound",
    next_action: null,
    next_action_available: false,
    selection_required: selectionRequired,
  });
  const dialogue = workSelectionDialogue(selection);
  const interpretation = workSelectionInterpretation();
  const workContext = unavailableWorkDirectiveContext(work, dialogue);
  // A Work gallery request is never reclassified from incidental words in the
  // user's sentence or a stale connector capability: it is a read operation,
  // not a ticket candidate.
  const galleryConnectorHint = Object.freeze({ request_kind: null, capability_hint: null });
  const action = actionPolicy("", galleryConnectorHint, false, false);
  const baseDirective = orchestrationDirective({
    tenantId,
    message,
    work,
    dialogue,
    workContext,
    interpretation,
    action,
    connectorHint: galleryConnectorHint,
  });
  const directive = Object.freeze({
    ...baseDirective,
    ticket_request: Object.freeze({
      ...baseDirective.ticket_request,
      continuation: Object.freeze({
        schema_version: "nyra_continuation_ref_v1",
        available: false,
        continuation_ref: null,
        expires_at: null,
        state: "UNAVAILABLE",
        reason: "work_selection_read_only",
      }),
    }),
  });
  const replySeed = workSelectionReplySeed(locale, selection);
  const nextAction = selectionRequired
    ? (locale === "en" ? "Choose one Work in the selector." : "Scegli un Work nel selettore.")
    : null;
  const agentBrief = Object.freeze({
    schema_version: "nyra_connected_ai_brief_v1",
    state: "WAITING",
    goal: nextAction || (locale === "en"
      ? "Wait for a successful read-only Work list."
      : "Attendere una lettura della lista Work riuscita."),
    steps: Object.freeze([]),
    expected_evidence: Object.freeze([]),
    research_required: false,
    external_action_authorized: false,
  });
  const id = turnId({
    tenantId,
    sessionId,
    message,
    workId: null,
    projectId,
    locale,
    style,
    workSelectionCursor: workSelectionCursor || null,
  });
  return textResult(Object.freeze({
    schema_version: "nyra_conversation_turn_v3",
    ok: true,
    tenant_id: tenantId,
    turn_id: id,
    identity_binding: selectionIdentityBinding(identity),
    work,
    memory: Object.freeze({
      loaded: false,
      active_task_count: 0,
      active_lock_count: 0,
      artifact_count: 0,
      ...interpretation.memory,
      raw_memory_returned: false,
    }),
    interpretation: Object.freeze({
      core: interpretation.core,
      selected_action_id: interpretation.selected_action_id,
      selected_action: interpretation.selected_action,
      selected_action_available: interpretation.selected_action_available,
      core_state: interpretation.core_state,
      core_control: interpretation.core_control,
      risk_band: interpretation.risk_band,
      blocked_reasons: interpretation.blocked_reasons,
      governance_diagnostics: interpretation.governance_diagnostics,
      unmet_conditions: interpretation.unmet_conditions,
      evidence_requirements: interpretation.evidence_requirements,
      allowed_alternatives: interpretation.allowed_alternatives,
      next_step: interpretation.next_step,
      runbook_candidate: interpretation.runbook_candidate,
      owner_confirmation_required: interpretation.owner_confirmation_required,
      dialogue_accepted: interpretation.dialogue_accepted,
      opened_branch_count: interpretation.opened_branch_count,
    }),
    nyra_dialogue: dialogue,
    action_policy: action,
    orchestration_directive: directive,
    work_selection: Object.freeze({
      schema_version: "nyra_work_selection_v1",
      requested: true,
      available: selection.available,
      project_id: projectId,
      choices: selection.choices,
      total_count: selection.total_count,
      has_more: selection.has_more,
      next_cursor: selection.next_cursor,
      selection_required: selectionRequired,
      execution_authorized: false,
      external_action_authorized: false,
    }),
    host_response_contract: Object.freeze({
      speaker: "Nyra",
      renderer: "nyra_widget_with_host_fallback",
      response_language: responseLanguage(locale),
      response_style: style,
      reply_seed: replySeed,
      next_action: nextAction,
      connected_ai_brief: agentBrief,
      rendering_policy: "server_orchestration_directive_first_v2",
      instructions: Object.freeze([
        "Render host_response_contract.reply_seed as Nyra's complete Work-selection answer before adding any optional explanation.",
        "Wait for the owner to select one work_selection.choice; then call Nyra again with that exact work_id and project_id. Use work_selection.next_cursor only to read the next Gallery page. Do not list, resume, create, or mutate another Work.",
        "Do not claim that Nyra, Codex, Core or the owner performed an action unless separately verified evidence is present; this turn never authorizes an external action.",
      ]),
    }),
    execution_authorized: false,
    external_action_authorized: false,
    provider_execution: false,
    provider_api_key_required: false,
    server_model_calls: 0,
  }));
}

function introspectionReplySeed(language, intent, selfModel, readback) {
  const italian = language === "it";
  if (readback === "MATERIALIZATION_REQUIRED") {
    return italian
      ? "Il self-model persistente non è ancora materializzato per questa identità. Non ho aperto un Work né eseguito azioni: la sua materializzazione è una distinta operazione owner-governed."
      : "The persistent self-model is not materialized for this identity. I did not open a Work or perform an action; materialization is a separate owner-governed operation.";
  }
  if (!selfModel) {
    return italian
      ? "Il self-model persistente non è al momento leggibile. Non ho effettuato fallback verso Work, preflight o azioni."
      : "The persistent self-model is not currently readable. I did not fall back to a Work, preflight, or action.";
  }
  const available = Array.isArray(selfModel.capabilities)
    ? selfModel.capabilities.filter((item) => item?.state === "available").map((item) => item.id).slice(0, 8)
    : [];
  const missing = Array.isArray(selfModel.required_infrastructure)
    ? selfModel.required_infrastructure.map((item) => item?.id).filter(Boolean).slice(0, 5)
    : [];
  if (intent === "nyra_gap_read") {
    return italian
      ? `Per lavorare meglio mi servono: ${missing.join(", ") || "nessun gap verificato"}. Prossima capacità raccomandata: ${selfModel.next_recommended_capability || "non disponibile"}.`
      : `To work better I need: ${missing.join(", ") || "no verified gap"}. Next recommended capability: ${selfModel.next_recommended_capability || "unavailable"}.`;
  }
  return italian
    ? `Sono Nyra: coordino in modo governato, mentre Universal Core è l'autorità finale. Capacità verificate disponibili: ${available.join(", ") || "nessuna"}. Limite: non autorizzo né eseguo effetti esterni; ${missing.length ? `mi mancano ${missing.join(", ")}.` : "non risultano gap verificati."}`
    : `I am Nyra: I coordinate under governance while Universal Core is the final authority. Verified available capabilities: ${available.join(", ") || "none"}. Limit: I neither authorize nor execute external effects; ${missing.length ? `I still need ${missing.join(", ")}.` : "no verified gaps are recorded."}`;
}

async function advisoryConversationResult({
  args, identity, tenantId, sessionId, message, locale, style, route, readCommandCatalog,
  readControlRoomStatus = null, readNyraSelfModel = null, readDistilledLessons = null, startedAt = Date.now(),
}) {
  const controlRoomRead = route.intent === "global_control_read";
  const introspectionRead = ["nyra_self_model_read", "nyra_gap_read"].includes(route.intent);
  const projectId = controlRoomRead ? null : boundedProjectId(args.project_id);
  const work = Object.freeze({ preflight_bound: false, work_bound: false, work_id: null,
    project_id: projectId, state: "unbound", next_action: null,
    next_action_available: false, selection_required: false });
  const dialogue = publicNyraDialogue({});
  const interpretation = controlRoomRead
    ? controlRoomInterpretation()
    : route.intent === "advisory_read"
      ? advisoryReadInterpretation()
      : workSelectionInterpretation();
  const action = actionPolicy("", { request_kind: null, capability_hint: null }, false, false);
  const baseDirective = orchestrationDirective({ tenantId, message, work, dialogue,
    workContext: unavailableWorkDirectiveContext(work, dialogue), interpretation, action,
    connectorHint: { request_kind: null, capability_hint: null } });
  const directive = Object.freeze({ ...baseDirective, ticket_request: Object.freeze({
    ...baseDirective.ticket_request, continuation: Object.freeze({
      schema_version: "nyra_continuation_ref_v1", available: false, continuation_ref: null,
      expires_at: null, state: "UNAVAILABLE",
      reason: controlRoomRead ? "control_room_read_only" : "catalog_read_only",
    }),
  }) });
  let controlRoom = null;
  let controlRoomReadback = Object.freeze({ state: "NOT_REQUESTED", reason: null });
  if (controlRoomRead) {
    try {
      // Intentionally pass no Work binding. A global status query must not
      // attach the caller to an arbitrary canonical Work.
      controlRoom = requireControlRoomStatus(
        await readControlRoomStatus({}, identity),
        tenantId,
      );
      controlRoomReadback = Object.freeze({ state: "AVAILABLE", reason: null });
    } catch (error) {
      // The bounded status reader is unavailable. Never turn that outage into
      // a preflight, Gallery scan, or unbound Work prompt.
      controlRoomReadback = Object.freeze({
        state: "UNAVAILABLE",
        reason: error?.message === "nyra_control_room_status_invalid" ||
          error?.message === "nyra_control_room_readback_invalid"
          ? "control_room_readback_invalid"
          : "control_room_reader_unavailable",
      });
    }
  }
  let catalog = null;
  let catalogError = null;
  if (route.intent === "command_catalog") {
    try {
      catalog = await readAuthorizedNyraCommandCatalog({
        reader: readCommandCatalog,
        identity,
        exactCapabilityId: route.reason === "exact_command_id_proposal" ? message.trim().slice(1) : null,
      });
    } catch {
      catalogError = "authorized_catalog_unavailable";
    }
  }
  const proposal = catalog ? resolveNyraCommandProposal({
    message, catalog, route, tenantId,
    workId: boundedWorkId(args.work_id),
    sessionFingerprint: identity.agentPresence?.session_fingerprint,
  }) : null;
  let selfModel = null;
  let selfModelReadback = "NOT_REQUESTED";
  if (introspectionRead) {
    try {
      const raw = await readNyraSelfModel({}, identity);
      const payload = raw?.structuredContent || raw;
      if (payload?.ok === true && payload.tenant_id === tenantId) {
        selfModel = payload.self_model && payload.self_model.schema_version === "nyra_persistent_self_model_v1"
          ? payload.self_model : null;
        selfModelReadback = selfModel ? "AVAILABLE" :
          payload.materialization_required === true ? "MATERIALIZATION_REQUIRED" : "UNAVAILABLE";
      } else selfModelReadback = "UNAVAILABLE";
    } catch {
      selfModelReadback = "UNAVAILABLE";
    }
  }
  let lessons = [];
  let platformBlocks = [];
  if (route.intent === "distilled_lessons_read" && typeof readDistilledLessons === "function") {
    try {
      const readback = await readDistilledLessons({ project_id: projectId }, identity);
      lessons = Array.isArray(readback) ? readback : readback?.tenant_lessons || [];
      platformBlocks = Array.isArray(readback?.platform_blocks) ? readback.platform_blocks : [];
    } catch { lessons = []; platformBlocks = []; }
  }
  const telemetry = buildNyraRoutingTelemetry({
    route, preflightInvoked: false, context: null, catalog,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  });
  const english = advisoryUsesEnglish(locale, message);
  const replySeed = controlRoomRead
    ? controlRoom
      ? controlRoomReplySeed(english ? "en" : "it", controlRoom)
      : (english
        ? "The governed Control Room read is currently unavailable. I did not fall back to a Work, ticket, preflight, or action."
        : "La lettura governata del Control Room non è al momento disponibile. Non ho eseguito fallback verso Work, ticket, preflight o azioni.")
    : introspectionRead
    ? introspectionReplySeed(english ? "en" : "it", route.intent, selfModel, selfModelReadback)
    : route.intent === "distilled_lessons_read"
    ? (() => {
      const local = lessons.length
        ? `Ho trovato ${lessons.length} lezioni del progetto: ${lessons.map((item) => `${item.source_tool}: ${item.failure_code} (${item.occurrence_count})`).join("; ")}.`
        : "Non risultano lezioni del progetto.";
      const platform = platformBlocks.length
        ? ` Pattern anonimi di piattaforma: ${platformBlocks.map((item) => `${item.source_tool}: ${item.failure_code} (${item.occurrence_count}, ${item.corroborating_tenant_count} contesti)`).join("; ")}.`
        : " Nessun pattern anonimo di piattaforma è ancora corroborato.";
      return `${local}${platform} Sono guardrail advisory: non autorizzano alcuna azione e non espongono dati di altri tenant.`;
    })()
    : route.intent === "command_catalog"
    ? catalog
      ? (english
        ? `I read ${catalog.commands.length} commands visible to this identity. Every natural-language alias remains a proposal: invocation requires a fresh catalog revision and the corresponding Core gate.`
        : `Ho letto ${catalog.commands.length} comandi visibili per questa identità. Ogni alias naturale resta una proposta: l'invocazione richiede una nuova revisione del catalogo e il relativo gate Core.`)
      : (english
        ? "The authorized catalog is unavailable. I did not use a fallback, preflight, or action."
        : "Il catalogo autorizzato non è disponibile. Non ho eseguito fallback, preflight o azioni.")
    : (english
      ? "This is an advisory request. I can explain it without opening a preflight, ticket, or action; verified Intent, ICF, and Entity360 references remain required for governed work."
      : "Questa è una richiesta advisory: posso spiegarla senza aprire preflight, ticket o azioni; per lavoro governato restano necessari riferimenti verificati a Intent, ICF ed Entity360.");
  return textResult(Object.freeze({
    schema_version: "nyra_conversation_turn_v3", ok: true, tenant_id: tenantId,
    turn_id: turnId({ tenantId, sessionId, message, workId: null, projectId, locale, style }),
    identity_binding: selectionIdentityBinding(identity),
    work,
    memory: Object.freeze({ loaded: false, active_task_count: 0, active_lock_count: 0,
      artifact_count: 0, ...interpretation.memory, raw_memory_returned: false }),
    interpretation: Object.freeze({
      core: interpretation.core, selected_action_id: null, selected_action: null,
      selected_action_available: false, core_state: interpretation.core_state,
      core_control: interpretation.core_control, risk_band: interpretation.risk_band,
      blocked_reasons: interpretation.blocked_reasons,
      governance_diagnostics: interpretation.governance_diagnostics,
      unmet_conditions: interpretation.unmet_conditions,
      evidence_requirements: interpretation.evidence_requirements,
      allowed_alternatives: interpretation.allowed_alternatives,
      next_step: null, runbook_candidate: null, owner_confirmation_required: false,
      dialogue_accepted: true, opened_branch_count: 0,
    }),
    nyra_dialogue: dialogue,
    action_policy: action,
    orchestration_directive: directive,
    intent_routing: Object.freeze({
      route: publicNyraIntentRoute(route),
      structured_context: Object.freeze({
        intent_available: true,
        icf_available: false,
        entity_360_available: false,
        ramy_state: "unavailable_no_verified_adapter",
      }),
      self_model_readback: Object.freeze({
        state: selfModelReadback,
        materialized: selfModel !== null,
      }),
      command_catalog: catalog ? Object.freeze({
        state: "AVAILABLE",
        catalog_revision: catalog.catalog_revision,
        commands: catalog.commands,
        identity_filtered: catalog.identity_filtered,
        truncated: catalog.truncated,
      }) : Object.freeze({
        state: catalogError ? "UNAVAILABLE" : "NOT_REQUESTED",
        catalog_revision: null,
        commands: Object.freeze([]),
        identity_filtered: false,
        truncated: false,
      }),
      command_proposal: proposal,
      telemetry,
      control_room: controlRoom,
      control_room_readback: controlRoomReadback,
      invocation_separate: true,
      execution_authorized: false,
    }),
    host_response_contract: Object.freeze({
      speaker: "Nyra", renderer: "nyra_widget_with_host_fallback",
      response_language: responseLanguage(locale), response_style: style,
      reply_seed: replySeed,
      next_action: null,
      connected_ai_brief: Object.freeze({ schema_version: "nyra_connected_ai_brief_v1",
        state: controlRoomRead && controlRoom ? "READY" : "WAITING", goal: controlRoomRead
          ? (english
            ? "Explain the server-derived Control Room status in the user's language without inventing a toggle, authority, or Work binding."
            : "Spiegare nella lingua dell'utente lo stato Control Room derivato dal server senza inventare toggle, autorità o binding Work.")
          : (english
            ? "Present the bounded catalog without invoking a command."
            : "Presentare il catalogo bounded senza invocare comandi."),
        steps: controlRoomRead && controlRoom ? Object.freeze([Object.freeze({
          order: 1,
          instruction: english
            ? "Use only host_response_contract.reply_seed and intent_routing.control_room to give a clear, conversational status summary."
            : "Usa solo host_response_contract.reply_seed e intent_routing.control_room per dare un riepilogo di stato chiaro e conversazionale.",
          mode: "READ_ONLY",
          expected_evidence: Object.freeze([]),
          external_side_effect: false,
        })]) : Object.freeze([]), expected_evidence: Object.freeze([]),
        research_required: false, external_action_authorized: false }),
      rendering_policy: "server_orchestration_directive_first_v2",
      instructions: controlRoomRead ? Object.freeze([
        "Render reply_seed and intent_routing.control_room as server-derived status only. Never invent an ON/OFF state, percentage, handler, authority, or Work binding.",
        "A Control Room read is not a configuration change. Route a requested mutation through its exact governed handler and fresh Core/owner gates.",
        "Do not claim that Nyra, Core, the owner, or any external system performed an action; this read authorizes none.",
      ]) : Object.freeze([
        "Render reply_seed as advisory text. Never treat chat text as owner confirmation.",
        "A command proposal is not an invocation. Re-read the authorized catalog and perform fresh Core preflight, owner confirmation and idempotency checks before any consequential invocation.",
        "Do not claim that Nyra, Core, the owner, or any external system performed an action; this advisory turn authorizes none.",
      ]),
    }),
    execution_authorized: false, external_action_authorized: false,
    provider_execution: false, provider_api_key_required: false, server_model_calls: 0,
  }));
}

// A fresh host session has no caller-owned work_id.  Nyra must not make the
// connected AI enumerate the Gallery and guess: when the authenticated tenant
// has exactly one operational Work, the server can safely and deterministically
// restore that identity before the one governed preflight. More than one
// operational Work remains deliberately unbound so Core can request a
// selection. Do not query only `active`: a blocked, verified or release-ready
// Work is still operational and must make this selection explicit.
async function resolveSingleActiveWork(identity, args, workContinuityRuntime) {
  if (boundedWorkId(args.work_id) || typeof workContinuityRuntime?.listWorks !== "function") {
    return args;
  }
  // An explicit bootstrap specification must enter the semantic duplicate
  // review. A sole, unrelated Work in the same project is not sufficient
  // evidence that it is the requested identity. An explicit work_id still
  // wins above and resumes that exact canonical Work.
  if (args.work_bootstrap !== undefined || args.canonical_intent?.work_requirement === "NEW") return args;
  const requestedProjectId = boundedProjectId(args.project_id);
  let catalogs;
  try {
    catalogs = await Promise.all(["active", "verified", "release_ready", "blocked"].map((status) => (
      workContinuityRuntime.listWorks(identity, {
        status,
        limit: 2,
        ...(requestedProjectId ? { project_id: requestedProjectId } : {}),
      })
    )));
  } catch {
    // This optimisation must never turn an otherwise valid read-only Nyra
    // turn into an outage.  The normal preflight retains its fail-closed
    // unbound/selection behaviour if the compact catalog is unavailable.
    return args;
  }
  const workById = new Map();
  let hasMore = false;
  for (const catalog of catalogs) {
    hasMore ||= Boolean(catalog?.next_cursor);
    for (const work of Array.isArray(catalog?.works) ? catalog.works : []) {
      const work_id = boundedWorkId(work?.work_id);
      const project_id = boundedProjectId(work?.project_id);
      if (work_id && project_id && (!requestedProjectId || project_id === requestedProjectId)) {
        workById.set(work_id, { work_id, project_id });
      }
    }
  }
  const works = [...workById.values()];
  if (works.length !== 1 || hasMore) return args;
  return Object.freeze({
    ...args,
    work_id: works[0].work_id,
    project_id: works[0].project_id,
  });
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
    // A signed tenant claim is routing metadata, not Gallery membership. Stop
    // before automatic Work discovery, legacy continuity reads or writes.
    requireTenantWorkCapability(identity, "read");
    // `core_capability_read` is intentionally exempt from generic preflight.
    // Conversation obtains its authenticated Work binding inside the target
    // handler and accepts no caller-made preflight or authority envelope.
    const resumeArgs = await resolveSingleActiveWork(identity, args, workContinuityRuntime);
    const preflightArgs = {
      request: resumeArgs.message,
      target_system: "nyra_conversational_runtime",
      operation_type: "nyra.converse",
      tool_name: "nyra_converse",
      response_mode: "full",
      ...(resumeArgs.work_id ? { work_id: resumeArgs.work_id } : {}),
      ...(resumeArgs.project_id ? { project_id: resumeArgs.project_id } : {}),
      session_id: identity.agentPresence?.session_id || resumeArgs.session_id,
      agent_id: identity.agentPresence?.agent_id || resumeArgs.agent_id || "connected_ai",
      client_type: identity.agentPresence?.client_type || resumeArgs.client_type,
      host_type: hostType(identity, resumeArgs),
      available_capabilities: ["nyra_converse", "skinharmony_core_mcp"],
      canonical_intent: resumeArgs.canonical_intent,
    };
    const continuityBinding = await resolveContinuityProjectBinding(
      identity,
      preflightArgs,
      workContinuityRuntime,
      { preferPersistedWorkProject: true },
    );
    const result = await workPreflight({
      ...preflightArgs,
      project_id: continuityBinding.projectId,
    }, identity);
    if ((resumeArgs.work_bootstrap === undefined &&
         resumeArgs.canonical_intent?.work_requirement !== "NEW") || resumeArgs.work_id) {
      await ensureContinuity(
        identity,
        continuityBinding.continuityArgs,
        "nyra_converse",
        result,
        { resumeExisting: true },
      );
    }
    return result;
  };
}

export function createNyraConverseHandler({
  preflight,
  interpret,
  readControlContext = null,
  readDirectiveContext = null,
  openContinuation = null,
  listWorkChoices = null,
  readCommandCatalog = null,
  readControlRoomStatus = null,
  readNyraSelfModel = null,
  readDistilledLessons = null,
  dialogueEnabled = true,
} = {}) {
  if (typeof preflight !== "function" || typeof interpret !== "function") {
    throw new Error("nyra_converse_dependencies_invalid");
  }
  return async function nyraConverse(args = {}, identity = {}) {
    // Defense in depth for direct/internal callers: no cached dialogue,
    // preflight or auto-resume may run without a server-bound membership.
    requireTenantWorkCapability(identity, "read");
    assertNoCallerAuthority(args);
    const connectorHint = serverConnectorHint(args);
    const tenantId = requireAuthenticatedIdentity(identity);
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) throw fail("nyra_converse_message_required");
    if (message.length > MAX_MESSAGE_LENGTH) throw fail("nyra_converse_message_too_long", 413);
    const continuationOperation = args.continuation_operation === undefined
      ? null
      : String(args.continuation_operation || "").trim();
    if (continuationOperation !== null &&
        !ACTION_CONTINUATION_OPERATIONS.has(continuationOperation)) {
      throw fail("nyra_converse_continuation_operation_invalid");
    }
    const locale = ["auto", "it", "en"].includes(args.locale) ? (args.locale || "auto") : "auto";
    const style = ["concise", "balanced", "detailed"].includes(args.response_style)
      ? args.response_style
      : "balanced";
    const sessionId = String(identity.agentPresence?.session_id || args.session_id || "").trim();
    if (!sessionId) throw fail("nyra_converse_session_required", 400);
    const startedAt = Date.now();

    // This is a real execution kill switch, not only a tools/list filter.
    // Keep the dedicated read-only Control Room handler available separately
    // so an owner can still observe that Dialogue is OFF without reopening it.
    if (dialogueEnabled !== true) throw fail("nyra_dialogue_disabled", 503);

    // This branch is deliberately before persisted context, preflight and
    // Core interpretation.  Choosing a Work is a Gallery read, never a
    // request to attach the conversation session to a Work.
    if (workSelectionRequested(args, message)) {
      return workSelectionResult({
        identity,
        tenantId,
        sessionId,
        message,
        locale,
        style,
        projectId: boundedProjectId(args.project_id),
        workSelectionCursor: args.work_selection_cursor,
        listWorkChoices,
      });
    }

    const intentRoute = classifyNyraIntent({
      message,
      workBootstrap: args.work_bootstrap !== undefined,
      tenantId,
      workId: boundedWorkId(args.work_id),
      sessionFingerprint: identity.agentPresence?.session_fingerprint,
      semanticHint: args.semantic_intent_hint,
    });
    if (["CORE_CATALOG_READ", "CONTROL_ROOM_READ", "ADVISORY_READ"].includes(intentRoute.route)) {
      if (continuationOperation !== null) {
        throw fail("nyra_converse_continuation_operation_not_applicable");
      }
      return advisoryConversationResult({
        args, identity, tenantId, sessionId, message, locale, style,
        route: intentRoute, readCommandCatalog, readControlRoomStatus, readNyraSelfModel, readDistilledLessons, startedAt,
      });
    }

    let persisted = null;
    if (
      pureResumeRequest(message) &&
      connectorHint.request_kind === null &&
      connectorHint.capability_hint === null &&
      typeof readControlContext === "function" &&
      args.work_bootstrap === undefined &&
      args.work_id && args.project_id
    ) {
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
        source: "persisted_work_context",
        core: Object.freeze({
          mode: "off",
          route: "V0",
          authority: "V0",
          parity_matched: null,
          execution_allowed: false,
        }),
        selected_action_id: null,
        selected_action: null,
        selected_action_available: false,
        core_state: "observe",
        core_control: "observe",
        risk_band: persisted.dialogue.diagnosis_state === "recovery_required" ? "blocked" : "low",
        blocked_reasons: Object.freeze([]),
        governance_diagnostics: Object.freeze({
          state: persisted.dialogue.diagnosis_state === "recovery_required" ? "BLOCKED" : "READY",
          guard_mode: "normal",
          causes: Object.freeze(persisted.dialogue.diagnosis_state === "recovery_required"
            ? [Object.freeze({
              code: "persisted_recovery_required",
              component: "UNIVERSAL_CORE",
              state: "BLOCKED",
              remediation: "Leggere il checkpoint persistito e completare la recovery prevista prima di rivalutare il Work.",
            })]
            : []),
        }),
        unmet_conditions: Object.freeze([]),
        evidence_requirements: Object.freeze([]),
        allowed_alternatives: Object.freeze([]),
        next_step: null,
        runbook_candidate: null,
        owner_confirmation_required: false,
        dialogue_accepted: true,
        opened_branch_count: 0,
        canonical_intent_binding: null,
        core_orchestration_verdict: null,
        semantic_escalation: null,
        memory: Object.freeze({
          revision: 0,
          relevant_count: 0,
          handoff_count: 0,
          recent_activity_count: 0,
        }),
      });
    } else {
      const preflightResult = await preflight({
        message,
        canonical_intent: intentRoute.canonical_intent,
        ...(args.work_id ? { work_id: args.work_id } : {}),
        ...(args.project_id ? { project_id: args.project_id } : {}),
        ...(args.work_bootstrap !== undefined ? { work_bootstrap: args.work_bootstrap } : {}),
        session_id: sessionId,
        agent_id: identity.agentPresence?.agent_id,
        client_type: identity.agentPresence?.client_type,
      }, identity);
      boundedPreflight = requireBoundPreflight(preflightResult, identity, {
        ...args,
        message,
        canonical_intent: intentRoute.canonical_intent,
      });
      const interpretationResult = await interpret({
        message,
        canonical_intent: intentRoute.canonical_intent,
        session_id: sessionId,
        ...(boundedPreflight.work.project_id ? { project_id: boundedPreflight.work.project_id } : {}),
        // The server-issued preflight is forwarded byte-semantically. Routing
        // metadata is local advisory evidence and never alters this signed
        // Core authority envelope.
        work_preflight: boundedPreflight.serverIssuedWorkPreflight,
        response_mode: "fast",
        available_capabilities: ["nyra_converse", "skinharmony_core_mcp"],
      }, identity);
      interpretation = requireTenantBoundInterpretation(
        interpretationResult,
        identity,
        intentRoute.canonical_intent,
        message,
      );
      interpretation = Object.freeze({
        ...interpretation,
        source: "fresh_core_interpretation",
      });
      if (intentRoute.intent === "ambiguous_consequential") {
        interpretation = Object.freeze({
          ...interpretation,
          selected_action_id: null,
          selected_action: null,
          selected_action_available: false,
          core_control: "confirm",
          owner_confirmation_required: true,
          governance_diagnostics: Object.freeze({
            state: "CONFIRMATION_REQUIRED",
            guard_mode: "confirmation_required",
            causes: Object.freeze([Object.freeze({
              code: "intent_clarification_required",
              component: "OWNER",
              state: "CONFIRMATION_REQUIRED",
              remediation: "Separare una sola azione esplicita, non condizionale e non citata; quindi ottenere conferma owner sul target esatto.",
            })]),
          }),
        });
      }
    }
    let workContext = unavailableWorkDirectiveContext(
      boundedPreflight.work,
      boundedPreflight.dialogue,
    );
    if (boundedPreflight.work.work_id && typeof readDirectiveContext === "function") {
      const rawDirectiveContext = await readDirectiveContext(identity, {
        work_id: boundedPreflight.work.work_id,
        project_id: boundedPreflight.work.project_id,
        work_revision: boundedPreflight.dialogue.work_revision,
        intent_digest: boundedPreflight.dialogue.intent_digest,
        // A state/checkpoint question must never validate a write-only
        // precommit ticket.  Consequential routes still receive the full gate.
        read_only: intentRoute.canonical_intent.consequential_intent !== true,
      });
      if (!rawDirectiveContext && args.work_id) {
        throw fail("nyra_converse_work_not_found", 404);
      }
      workContext = requireWorkDirectiveContext(
        rawDirectiveContext,
        identity,
        boundedPreflight.work,
        boundedPreflight.dialogue,
      );
    }
    let workBootstrapRequestDigest = null;
    if (args.work_bootstrap !== undefined) {
      const workBootstrapRequest = materializeGovernedWorkBootstrapRequest({
        spec: args.work_bootstrap,
        identity,
        projectId: boundedPreflight.work.project_id,
        canonicalIntentDigest: boundedPreflight.canonicalIntentBinding?.intent_digest,
        coreOrchestrationVerdictDigest: boundedPreflight.coreOrchestrationVerdict?.verdict_digest,
        coreOrchestrationVerdict: boundedPreflight.coreOrchestrationVerdict,
      });
      workBootstrapRequestDigest = governedWorkBootstrapDigest(workBootstrapRequest);
    }
    const advisoryOnly = intentRoute.reason === "explicit_read_only_boundary";
    const action = actionPolicy(
      advisoryOnly ? Object.freeze({ requested_now: [] }) : intentRoute.canonical_intent,
      connectorHint,
      advisoryOnly ? false : interpretation.owner_confirmation_required,
      args.work_bootstrap !== undefined,
    );
    if (continuationOperation !== null &&
        (intentRoute.route === "CORE_HOLD_THEN_NYRA" ||
          action.work_bootstrap_requested || !action.consequential_request_detected ||
          action.action_class === "GIT_MERGE")) {
      throw fail("nyra_converse_continuation_operation_not_applicable");
    }
    const directiveAction = intentRoute.route === "CORE_HOLD_THEN_NYRA"
      ? actionPolicy(Object.freeze({ requested_now: [] }), connectorHint, false, false)
      : action;
    const directiveInterpretation = intentRoute.route === "CORE_HOLD_THEN_NYRA"
      ? Object.freeze({ ...interpretation, owner_confirmation_required: false })
      : interpretation;
    const baseDirective = orchestrationDirective({
      tenantId,
      message,
      work: boundedPreflight.work,
      dialogue: boundedPreflight.dialogue,
      workContext,
      interpretation: directiveInterpretation,
      action: directiveAction,
      connectorHint,
      workBootstrapRequestDigest,
      continuationOperation,
      canonicalIntentBinding: boundedPreflight.canonicalIntentBinding ||
        interpretation.canonical_intent_binding || null,
      coreOrchestrationVerdict: interpretation.core_orchestration_verdict ||
        boundedPreflight.coreOrchestrationVerdict || null,
      semanticEscalation: interpretation.semantic_escalation ||
        boundedPreflight.semanticEscalation || null,
    });
    let continuation = Object.freeze({
      schema_version: "nyra_continuation_ref_v1",
      available: false,
      continuation_ref: null,
      expires_at: null,
      state: "UNAVAILABLE",
      reason: "continuation_operation_not_applicable",
    });
    const continuationEligible = intentRoute.intent === "work_create" ||
      (intentRoute.intent === "ticket_or_action" &&
        !new Set(["EXTERNAL_MUTATION", "GIT_MERGE"]).has(action.action_class) &&
        !(action.action_class === "GIT_COMMIT" &&
          workContext.precommit_unverified_required_evidence_count > 0));
    if (continuationEligible && typeof openContinuation === "function") {
      try {
        const reference = await boundedContinuationOpen(openContinuation({ identity, directive: baseDirective }));
        if (reference?.schema_version === "nyra_continuation_ref_v1") {
          continuation = reference;
        }
      } catch {
        continuation = Object.freeze({
          ...continuation,
          reason: "continuation_open_failed",
        });
      }
    } else if (continuationEligible) {
      continuation = Object.freeze({
        ...continuation,
        reason: "continuation_store_unavailable",
      });
    }
    const directive = Object.freeze({
      ...baseDirective,
      ticket_request: Object.freeze({
        ...baseDirective.ticket_request,
        continuation,
      }),
    });
    const nextAction = directive.next_actions[0]?.summary || null;
    const replySeed = directiveReplySeed(
      locale,
      directive,
      Boolean(boundedPreflight.work.work_id),
      { message, style },
    );
    const agentBrief = connectedAiBrief(locale, directive);
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
      "Render host_response_contract.reply_seed as Nyra's complete operational answer before adding any optional explanation.",
      "Follow host_response_contract.connected_ai_brief as the complete server-issued task brief: execute only its ordered steps, return only its expected evidence, and never research or invent missing steps.",
      "Do not claim that Nyra, Codex, Core or the owner performed an action unless separately verified evidence is present; this turn never authorizes an external action.",
    ];
    const localRouting = Object.freeze({
      route: publicNyraIntentRoute(intentRoute),
      structured_context: Object.freeze({
        intent_available: true,
        icf_available: false,
        entity_360_available: false,
        ramy_state: "unavailable_no_verified_adapter",
      }),
      command_catalog: Object.freeze({ state: "NOT_REQUESTED", catalog_revision: null,
        commands: Object.freeze([]), identity_filtered: false, truncated: false }),
      command_proposal: null,
      telemetry: buildNyraRoutingTelemetry({ route: intentRoute, preflightInvoked: !persisted,
        context: { intent: { available: Boolean(boundedPreflight.dialogue.intent_digest), variants: [] } },
        catalog: null, elapsedMs: Math.max(0, Date.now() - startedAt) }),
      control_room: null,
      control_room_readback: Object.freeze({ state: "NOT_REQUESTED", reason: null }),
      invocation_separate: true,
      execution_authorized: false,
    });
    return textResult(Object.freeze({
      schema_version: "nyra_conversation_turn_v3",
      ok: true,
      tenant_id: tenantId,
      turn_id: id,
      identity_binding: Object.freeze({
        authenticated: true,
        tenant_bound: true,
        principal_kind: normalizedIdentityKind(identity),
        client_type: normalizedClientType(identity),
        host_registered: identity.authenticatedHostPrincipal?.registered === true,
        app_id: boundedString(identity.authenticatedHostPrincipal?.app_id, 64),
        host_kind: boundedString(identity.authenticatedHostPrincipal?.host_kind, 80),
        host_registry_revision: /^[a-f0-9]{64}$/.test(String(
          identity.authenticatedHostPrincipal?.registry_revision || "",
        )) ? identity.authenticatedHostPrincipal.registry_revision : null,
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
        selected_action_id: interpretation.selected_action_id,
        selected_action: interpretation.selected_action,
        selected_action_available: interpretation.selected_action_available,
        core_state: interpretation.core_state,
        core_control: interpretation.core_control,
        risk_band: interpretation.risk_band,
        blocked_reasons: interpretation.blocked_reasons,
        governance_diagnostics: interpretation.governance_diagnostics,
        unmet_conditions: interpretation.unmet_conditions,
        evidence_requirements: interpretation.evidence_requirements,
        allowed_alternatives: interpretation.allowed_alternatives,
        next_step: interpretation.next_step,
        runbook_candidate: interpretation.runbook_candidate,
        owner_confirmation_required: interpretation.owner_confirmation_required,
        dialogue_accepted: interpretation.dialogue_accepted,
        opened_branch_count: interpretation.opened_branch_count,
      }),
      nyra_dialogue: boundedPreflight.dialogue,
      action_policy: action,
      orchestration_directive: directive,
      intent_routing: localRouting,
      host_response_contract: Object.freeze({
        speaker: "Nyra",
        renderer: "nyra_widget_with_host_fallback",
        response_language: responseLanguage(locale),
        response_style: style,
        reply_seed: replySeed,
        next_action: nextAction,
        connected_ai_brief: agentBrief,
        rendering_policy: "server_orchestration_directive_first_v2",
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
