import crypto from "node:crypto";

export const NYRA_CANONICAL_INTENT_VERSION = "nyra_canonical_intent_v1";
export const NYRA_CANONICAL_INTENT_BINDING_VERSION = "nyra_canonical_intent_binding_v1";

const SHA256 = /^[a-f0-9]{64}$/;
const ACTION = /^[a-z][a-z0-9_]{0,79}$/;
const SPEECH_ACTS = new Set(["QUESTION", "REQUEST", "REPORT"]);
const OPERATION_CLASSES = new Set(["READ_ONLY", "EXTERNAL_MUTATION"]);
const SCOPES = new Set(["GLOBAL", "CONVERSATION", "WORK"]);
const WORK_REQUIREMENTS = new Set(["NONE", "NEW", "EXISTING", "UNKNOWN"]);
const MAX_ACTIONS = 64;

function fail(code = "nyra_canonical_intent_invalid") {
  const error = new Error(code);
  error.code = code;
  error.status = 409;
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(stable(value)),
  ).digest("hex");
}

function exactRecord(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== fields.size ||
      Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function boundedText(value, maximum, code) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > maximum ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function actionList(value, code) {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS) fail(code);
  const result = value.map((item) => boundedText(item, 80, code));
  if (result.some((item) => !ACTION.test(item)) || new Set(result).size !== result.length) fail(code);
  return Object.freeze(result);
}

function frozenRecord(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenRecord));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenRecord(item)])));
}

export function normalizeNyraIntentMessage(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 12_000);
}

export function nyraCanonicalIntentMessageDigest(message) {
  return digest({
    schema_version: "nyra_semantic_hint_message_v1",
    message: normalizeNyraIntentMessage(message),
  });
}

export function nyraCanonicalIntentDigest(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : fail();
  delete source.intent_digest;
  return digest(source);
}

export function validateNyraCanonicalIntent(value, { message } = {}) {
  const source = exactRecord(value, new Set([
    "schema_version", "requested_now", "future_goals", "constraints", "prohibited_actions",
    "referenced_actions", "owner_reserved_actions", "speech_act", "operation_class", "scope",
    "target", "work_requirement", "consequential_intent", "confidence", "ambiguity",
    "safety_signals", "provenance", "intent_digest",
  ]), "nyra_canonical_intent_shape_invalid");
  if (source.schema_version !== NYRA_CANONICAL_INTENT_VERSION) {
    fail("nyra_canonical_intent_version_invalid");
  }
  const requestedNow = actionList(source.requested_now, "nyra_canonical_intent_requested_now_invalid");
  const futureGoals = actionList(source.future_goals, "nyra_canonical_intent_future_goals_invalid");
  const constraints = actionList(source.constraints, "nyra_canonical_intent_constraints_invalid");
  const prohibitedActions = actionList(source.prohibited_actions, "nyra_canonical_intent_prohibited_actions_invalid");
  const referencedActions = actionList(source.referenced_actions, "nyra_canonical_intent_referenced_actions_invalid");
  const ownerReservedActions = actionList(source.owner_reserved_actions, "nyra_canonical_intent_owner_reserved_actions_invalid");
  const safetySignals = actionList(source.safety_signals, "nyra_canonical_intent_safety_signals_invalid");
  if (!SPEECH_ACTS.has(source.speech_act) || !OPERATION_CLASSES.has(source.operation_class) ||
      !SCOPES.has(source.scope) || !WORK_REQUIREMENTS.has(source.work_requirement) ||
      typeof source.consequential_intent !== "boolean" || typeof source.ambiguity !== "boolean" ||
      !Number.isFinite(source.confidence) || source.confidence < 0 || source.confidence > 1) {
    fail("nyra_canonical_intent_semantics_invalid");
  }
  const target = boundedText(source.target, 120, "nyra_canonical_intent_target_invalid");
  const provenance = exactRecord(source.provenance, new Set([
    "source", "reason_code", "semantic_hint_state", "raw_text_digest",
  ]), "nyra_canonical_intent_provenance_invalid");
  const normalizedProvenance = Object.freeze({
    source: boundedText(provenance.source, 120, "nyra_canonical_intent_provenance_invalid"),
    reason_code: boundedText(provenance.reason_code, 160, "nyra_canonical_intent_provenance_invalid"),
    semantic_hint_state: boundedText(provenance.semantic_hint_state, 80, "nyra_canonical_intent_provenance_invalid"),
    raw_text_digest: boundedText(provenance.raw_text_digest, 64, "nyra_canonical_intent_provenance_invalid"),
  });
  if (!SHA256.test(normalizedProvenance.raw_text_digest) ||
      (message !== undefined && normalizedProvenance.raw_text_digest !== nyraCanonicalIntentMessageDigest(message))) {
    fail("nyra_canonical_intent_message_binding_mismatch");
  }
  const excluded = new Set([...futureGoals, ...prohibitedActions, ...ownerReservedActions]);
  if (requestedNow.some((action) => excluded.has(action))) {
    fail("nyra_canonical_intent_temporal_authority_overlap");
  }
  const consequential = requestedNow.some((action) => action !== "work_bootstrap");
  if (source.consequential_intent !== consequential ||
      source.operation_class !== (consequential ? "EXTERNAL_MUTATION" : "READ_ONLY") ||
      (source.work_requirement === "NEW" && !requestedNow.includes("work_bootstrap")) ||
      (requestedNow.includes("work_bootstrap") && source.work_requirement !== "NEW") ||
      (consequential && source.work_requirement === "NONE")) {
    fail("nyra_canonical_intent_semantics_invalid");
  }
  if (!SHA256.test(String(source.intent_digest || "")) ||
      source.intent_digest !== nyraCanonicalIntentDigest(source)) {
    fail("nyra_canonical_intent_digest_mismatch");
  }
  return frozenRecord({
    schema_version: NYRA_CANONICAL_INTENT_VERSION,
    requested_now: requestedNow,
    future_goals: futureGoals,
    constraints,
    prohibited_actions: prohibitedActions,
    referenced_actions: referencedActions,
    owner_reserved_actions: ownerReservedActions,
    speech_act: source.speech_act,
    operation_class: source.operation_class,
    scope: source.scope,
    target,
    work_requirement: source.work_requirement,
    consequential_intent: source.consequential_intent,
    confidence: source.confidence,
    ambiguity: source.ambiguity,
    safety_signals: safetySignals,
    provenance: normalizedProvenance,
    intent_digest: source.intent_digest,
  });
}

export function finalizeNyraCanonicalIntent(value, { message } = {}) {
  const envelope = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value, intent_digest: nyraCanonicalIntentDigest(value) }
    : fail();
  return validateNyraCanonicalIntent(envelope, { message });
}

export function bindNyraCanonicalIntent(value, { message } = {}) {
  const intent = validateNyraCanonicalIntent(value, { message });
  const binding = {
    schema_version: NYRA_CANONICAL_INTENT_BINDING_VERSION,
    intent_digest: intent.intent_digest,
    raw_text_digest: intent.provenance.raw_text_digest,
    operation_class: intent.operation_class,
    work_requirement: intent.work_requirement,
    consequential_intent: intent.consequential_intent,
    ambiguity: intent.ambiguity,
  };
  return Object.freeze({ ...binding, binding_digest: digest(binding) });
}
