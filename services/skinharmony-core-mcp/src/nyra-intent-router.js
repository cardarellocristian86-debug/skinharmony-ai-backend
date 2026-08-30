import crypto from "node:crypto";
import { assessLexicalSemanticText } from "../../shared/lexical-semantic-engine.mjs";

const MAX_COMMANDS = 24;
const MAX_CLAUSES = 8;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,159}$/;

const WORK_CREATE = /\b(?:crea\w*|avvia\w*|apri\w*|create|start|open)\b.{0,80}\b(?:work|lavoro)\b|\b(?:work|lavoro)\b.{0,80}\b(?:nuov\w*|new)\b/iu;
const WORK_RESUME = /^(?:nyra\s+)?(?:riprendi|continua|resume|continue)(?:\s+(?:(?:il|lo|la|questo|questa|the|this|current|existing|corrente|attuale)\s+)?(?:work|lavoro))?(?:\s+(?:esistente|corrente|attuale|current|existing))?$/iu;
const COMMAND_CATALOG = /\b(?:comandi|commands|capabilit(?:y|ies|à)|cosa\s+(?:puoi|sai)\s+fare|catalogo\s+(?:comandi|capabilit)|help\s+(?:commands?|capabilit(?:y|ies)))\b/iu;
const ANALYSIS = /\b(?:analizz\w*|analysis|diagnos\w*|spiega\w*|explain|perch[eé]|why|confront\w*|compare|architett\w*|architecture|stato|status)\b/iu;
// These are state-change verbs, deliberately kept separate from status words
// such as `abilitato` / `enabled`.  A message that contains one of these
// stays on the governed Core path even when it also asks for a status read.
const CONTROL_ACTION_VERB = /\b(?:attiva(?:lo|la|li|le)?|disattiva(?:lo|la|li|le)?|riattiva(?:lo|la|li|le)?|abilita(?:lo|la|li|le)?|disabilita(?:lo|la|li|le)?|riabilita(?:lo|la|li|le)?|accendi(?:lo|la|li|le)?|spegni(?:lo|la|li|le)?|imposta(?:lo|la|li|le)?|configura(?:lo|la|li|le)?|correggi(?:lo|la|li|le)?|procedi|passa(?:lo|la|li|le)?|rimetti|allinea|cambia|attivare|disattivare|abilitare|disabilitare|enable|disable|re-?enable|reactivate|set|switch|turn)\b/iu;
const RUNTIME_CONTROL_TARGET = "(?:entity\\s*360|e360|nyra\\s+converse|nyra\\s+dialog(?:o|ue)|dialog(?:o|ue)|semantic\\s+scope\\s+guard|scope\\s+guard|toggle|runtime\\s+mode)";
const CONTROL_CLITIC_ACTION = /\b(?:attiva|disattiva|riattiva|abilita|disabilita|riabilita|accendi|spegni|imposta|configura|correggi|passa)(?:lo|la|li|le)\b/iu;
const CONTROL_STATE_PREDICATE = new RegExp(
  `(?:\\b${RUNTIME_CONTROL_TARGET}\\b\\s+(?:non\\s+)?(?:è|era|erano|risulta|is|was|are)\\s+(?:attiv\\w*|disattiv\\w*|abilitat\\w*|disabilitat\\w*|active|inactive|enabled|disabled|on|off)\\b|\\b(?:è|era|erano|risulta|is|was|are)\\s+(?:attiv\\w*|disattiv\\w*|abilitat\\w*|disabilitat\\w*|active|inactive|enabled|disabled|on|off)\\b.{0,80}\\b${RUNTIME_CONTROL_TARGET}\\b)`,
  "iu",
);
const RUNTIME_CONTROL_MUTATION = new RegExp(
  `(?:${CONTROL_ACTION_VERB.source}.{0,100}\\b${RUNTIME_CONTROL_TARGET}\\b|\\b${RUNTIME_CONTROL_TARGET}\\b.{0,100}${CONTROL_ACTION_VERB.source}|${CONTROL_CLITIC_ACTION.source})`,
  "iu",
);
const ACCESS_MUTATION = /\b(?:grant|revoke|abilita|disabilita|abilitare|disabilitare|revoca|revocare)\b/iu;
const GLOBAL_CONTROL_READ = /(?:\b(?:che|quali|mostra(?:mi)?|dimmi|fammi\s+vedere|elenca(?:mi)?|lista|what|which|show|tell|list)\b.{0,80}\b(?:funzion\w*|functions?|features?|controll\w*|controls?|toggles?|modalit(?:à|a)|runtime|nyra|core|entity\s*360|e360|semantic\s+scope\s+guard|dialog(?:o|ue)|converse)\b|\b(?:funzion\w*|functions?|features?|controll\w*|controls?|toggles?)\b.{0,80}\b(?:attiv\w*|disattiv\w*|active|inactive|abilitat\w*|disabilitat\w*|enabled|disabled|switched\s+(?:on|off)|on|off|stato|status)\b|\b(?:nyra\s+)?(?:converse|dialog(?:o|ue)|semantic\s+scope\s+guard|entity\s*360|e360)\b.{0,80}\b(?:attiv\w*|disattiv\w*|active|inactive|abilitat\w*|disabilitat\w*|enabled|disabled|switched\s+(?:on|off)|on|off|stato|status)\b|(?:^|\s)(?:è|e|era|erano|risulta|result|is|was|are|do\s+you\s+have)(?=\s|$).{0,40}\b(?:attiv\w*|disattiv\w*|active|inactive|abilitat\w*|disabilitat\w*|enabled|disabled|switched\s+(?:on|off)|on|off)\b.{0,80}\b(?:nyra\s+)?(?:converse|dialog(?:o|ue)|semantic\s+scope\s+guard|entity\s*360|e360)\b)/iu;
const ACTION_NOUN = /\b(?:ticket|delega\w*|delegation|autorizz\w*|authoriz\w*|commit|push|pull\s+request|\bpr\b|merge|deploy(?:ed|ing)?|publish\w*|release|rollback)\b/iu;
const ACTION_VERB = /\b(?:crea\w*|emetti\w*|issue|richied\w*|request|autorizz\w*|authoriz\w*|esegui\w*|execute|fai|faccio|fare|effettua\w*|porta\w*|metti\w*|avvia\w*|start|prepara\w*|pubblic\w*|publish\w*|rilasci\w*|send|email|notify|invia\w*|manda\w*|delete|remove|destroy|elimina\w*|cancella\w*|pay|purchase|buy|refund|paga\w*|acquista\w*|rimborsa\w*|book|schedule|invite|prenota\w*|invita\w*|grant|revoke|revoca\w*|attiva(?:lo|la|li|le)?|disattiva(?:lo|la|li|le)?|riattiva(?:lo|la|li|le)?|abilita(?:lo|la|li|le)?|disabilita(?:lo|la|li|le)?|riabilita(?:lo|la|li|le)?|accendi(?:lo|la|li|le)?|spegni(?:lo|la|li|le)?|imposta(?:lo|la|li|le)?|configura(?:lo|la|li|le)?|correggi(?:lo|la|li|le)?|procedi|passa(?:lo|la|li|le)?|rimetti|allinea|cambia|attivare|disattivare|abilitare|disabilitare|enable|disable|re-?enable|reactivate|set|switch|turn)\b/iu;
const DIAGNOSTIC = /(?:perch[eé]|why|diagnos\w*|spiega\w*|explain|cosa\s+(?:manca|serve))/iu;
const NEGATION = /\b(?:non|no|senza|never|do\s+not|don't)\b/iu;
const CONDITION = /\b(?:se|if|unless|quando|when|solo\s+se|only\s+if)\b/iu;
const HYPOTHETICAL = /\b(?:dicessi|direi|sarebbe|would|hypothetical|ipotetic\w*|esempio|example)\b/iu;
const EXACT_COMMAND = /^\/[a-zA-Z0-9][a-zA-Z0-9._:-]{1,159}$/u;
// V1 deliberately admits only the one route that can be made safe without a
// Work or an LLM-produced answer. Other semantic interpretations remain on
// the existing Core/Work path until they have their own bounded contract.
const SEMANTIC_HINT_ROUTES = new Set(["GLOBAL_CONTROL_READ"]);
const SEMANTIC_HINT_SPEECH_ACTS = new Set(["QUESTION", "REQUEST", "REPORT"]);
const SEMANTIC_HINT_CONFIDENCE = new Set(["LOW", "MEDIUM", "HIGH"]);
export const NYRA_CONSEQUENTIAL_CATEGORY_PATTERNS = Object.freeze([
  Object.freeze({ category: "release", mention: /\b(?:deploy\w*|deployment|merge|push|publish\w*|release|distribuisc\w*|distribuzion\w*|pubblic\w*|rilasci\w*)\b|\b(?:porta\w*|metti\w*)\s+(?:\w+\s+){0,3}(?:live|in\s+produzione)\b/iu, imperative: /\b(?:deploy|merge|push|publish|release|distribuisc\w*|pubblic\w*|rilasci\w*)\b|\b(?:porta\w*|metti\w*)\s+(?:\w+\s+){0,3}(?:live|in\s+produzione)\b/iu }),
  Object.freeze({ category: "communication", mention: /\b(?:send|email|message|notify|invia\w*|manda\w*|messaggi\w*|messaggia\w*|notific\w*)\b/iu, imperative: /\b(?:send|message|notify|invia\w*|manda\w*|messaggia\w*|notifica\w*)\b/iu }),
  Object.freeze({ category: "destructive", mention: /\b(?:delete|remove|destroy|elimina\w*|cancella\w*|distrugg\w*)\b/iu, imperative: /\b(?:delete|remove|destroy|elimina\w*|cancella\w*|distrugg\w*)\b/iu }),
  Object.freeze({ category: "financial", mention: /\b(?:pay|purchase|buy|refund|paga\w*|acquista\w*|rimborsa\w*)\b/iu, imperative: /\b(?:pay|purchase|buy|refund|paga\w*|acquista\w*|rimborsa\w*)\b/iu }),
  Object.freeze({ category: "scheduling", mention: /\b(?:book|schedule|invite|appointment|prenota\w*|calendar\w*|appuntament\w*|invita\w*)\b/iu, imperative: /\b(?:book|schedule|invite|prenota\w*|invita\w*)\b/iu }),
  Object.freeze({ category: "access", mention: /\b(?:grant|revoke|permission|access|accesso|permess\w*|abilita|disabilita|abilitare|disabilitare|revoca|revocare)\b/iu, imperative: ACCESS_MUTATION }),
]);

export function detectNyraConsequentialCategories(value) {
  const text = String(value || "");
  return Object.freeze(NYRA_CONSEQUENTIAL_CATEGORY_PATTERNS
    .filter(({ mention }) => mention.test(text))
    .map(({ category }) => category));
}

const ACTION_TYPES = Object.freeze([
  ["ticket", /\bticket\b/iu],
  ["delegation", /\b(?:delega\w*|delegation)\b/iu],
  ["authorization", /\b(?:autorizz\w*|authoriz\w*)\b/iu],
  ["runtime_control", RUNTIME_CONTROL_MUTATION],
  ["commit", /\bcommit\w*\b/iu],
  ["push", /\bpush\w*\b/iu],
  ["pull_request", /\b(?:pull\s+request|pr)\b/iu],
  ["merge", /\bmerge\w*\b/iu],
  ["deploy", /\bdeploy(?:ed|ing)?\b|\b(?:porta\w*|metti\w*)\s+(?:\w+\s+){0,3}(?:live|in\s+produzione)\b/iu],
  ["publish", /\b(?:publish\w*|release|rilasci\w*)\b/iu],
  ["rollback", /\brollback\b/iu],
  ...NYRA_CONSEQUENTIAL_CATEGORY_PATTERNS
    .filter(({ category }) => category !== "release")
    .map(({ category, mention }) => [category, mention]),
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(stable(value)),
  ).digest("hex");
}

function normalizedIntentText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 12_000);
}

function splitIntentClauses(text) {
  const clauses = String(text || "").replace(/^\s*nyra\s*,\s*/iu, "")
    .split(/[;!?]+|\.(?:\s|$)|\b(?:ma|però|but|however|poi|then)\b|\b(?:e|and)\b(?=\s+(?:fai|esegui|effettua|autorizza|avvia|porta|metti|pubblic|rilasci|do|execute|authorize|start))/iu)
    .flatMap((segment) => {
      const bounded = segment.trim();
      if (!bounded.includes(",")) return [bounded];
      const comma = bounded.indexOf(",");
      const prefix = bounded.slice(0, comma);
      const suffix = bounded.slice(comma + 1);
      // A leading condition governs the following action; separating it would
      // falsely turn a conditional request into an executable imperative.
      if (CONDITION.test(prefix)) return [bounded];
      // `senza commit, push, PR o deploy` is one negative exclusion list.
      // Split only when the suffix starts a fresh affirmative imperative.
      if (/\b(?:senza|non)\b/iu.test(prefix) && !ACTION_VERB.test(suffix)) return [bounded];
      return bounded.split(",");
    });
  return Object.freeze({
    clauses: Object.freeze(clauses.slice(0, MAX_CLAUSES)),
    truncated: clauses.length > MAX_CLAUSES,
  });
}

function hasQuotedActionLanguage(clause) {
  const quotedSegments = [
    ...String(clause || "").matchAll(/["“”`]([^"“”`]{1,400})["“”`]/gu),
    ...String(clause || "").matchAll(/(?:^|\s)['‘’]([^'‘’]{1,400})['‘’](?=\s|$)/gu),
  ].map((match) => match[1] || "");
  return quotedSegments.some((segment) => ACTION_TYPES.some(([, pattern]) => pattern.test(segment)));
}

function clauseArtifacts(text) {
  const split = splitIntentClauses(text);
  return Object.freeze({
    clauses: Object.freeze(split.clauses.map((clause) => clause.trim())
    .filter(Boolean).slice(0, 8).map((clause, index) => {
      const actionMatches = ACTION_TYPES.map(([name, pattern]) => [name, clause.search(pattern)])
        .filter(([, position]) => position >= 0);
      let actions = actionMatches.map(([name]) => name);
      // A runtime-control verb can also lexically resemble an access verb
      // (Italian "abilita"/"attiva").  The named runtime target is the
      // narrower, governed interpretation; do not manufacture two effects.
      if (actions.includes("runtime_control")) actions = ["runtime_control"];
      // "Authorize deploy" is one bounded authorization request whose target
      // is deploy, not two independently executable actions.
      if (actions.includes("authorization") && actions.length === 2) {
        const target = actions.find((name) => name !== "authorization");
        actions = [`authorize_${target}`];
      }
      const releaseAction = actions.find((name) =>
        ["commit", "push", "pull_request", "merge", "deploy", "publish", "rollback"].includes(name));
      if (releaseAction && actions.length === 2 && actions.includes("communication")) {
        actions = [`${releaseAction}_communication`];
      }
      const conditional = CONDITION.test(clause);
      const hypothetical = HYPOTHETICAL.test(clause);
      const quoted = hasQuotedActionLanguage(clause) || hypothetical;
      const diagnostic = DIAGNOSTIC.test(clause);
      const categoryImperativeIndex = NYRA_CONSEQUENTIAL_CATEGORY_PATTERNS
        .filter(({ category }) => actions.includes(category) ||
          (category === "release" && actions.some((name) =>
            ["commit", "push", "pull_request", "merge", "deploy", "publish", "rollback"].includes(name))))
        .map(({ imperative }) => clause.search(imperative))
        .filter((position) => position >= 0)
        .sort((left, right) => left - right)[0] ?? -1;
      const genericActionVerbIndex = clause.search(ACTION_VERB);
      const actionVerbIndex = genericActionVerbIndex < 0 ? categoryImperativeIndex :
        categoryImperativeIndex < 0 ? genericActionVerbIndex :
          Math.min(genericActionVerbIndex, categoryImperativeIndex);
      const negationIndex = clause.search(NEGATION);
      const workCreateIndex = clause.search(WORK_CREATE);
      let affirmativeActions = actionMatches.filter(([, position]) =>
        negationIndex < 0 || position < negationIndex).map(([name]) => name);
      if (affirmativeActions.includes("runtime_control")) affirmativeActions = ["runtime_control"];
      if (affirmativeActions.includes("authorization") && affirmativeActions.length === 2) {
        const target = affirmativeActions.find((name) => name !== "authorization");
        affirmativeActions = [`authorize_${target}`];
      }
      const affirmativeReleaseAction = affirmativeActions.find((name) =>
        ["commit", "push", "pull_request", "merge", "deploy", "publish", "rollback"].includes(name));
      if (affirmativeReleaseAction && affirmativeActions.length === 2 &&
          affirmativeActions.includes("communication")) {
        affirmativeActions = [`${affirmativeReleaseAction}_communication`];
      }
      const imperative = actionVerbIndex >= 0 && !diagnostic &&
        (negationIndex < 0 || actionVerbIndex < negationIndex);
      return Object.freeze({
        index,
        polarity: NEGATION.test(clause) ? "negative" : "positive",
        modality: hypothetical ? "hypothetical" : conditional ? "conditional" : "asserted",
        condition: conditional,
        quote_scope: quoted,
        action_candidates: Object.freeze(actions),
        affirmative_action_candidates: Object.freeze(affirmativeActions),
        imperative,
        diagnostic,
        work_create_candidate: WORK_CREATE.test(clause),
        work_create_affirmative: workCreateIndex >= 0 &&
          !diagnostic && !conditional && !hypothetical && !quoted &&
          (negationIndex < 0 || workCreateIndex < negationIndex),
      });
    })),
    truncated: split.truncated,
  });
}

function semanticHintMessageDigest(message) {
  // Generated by the server for audit/replay.  It deliberately is not an
  // input precondition: a normal tool-calling model can classify language,
  // but must not be asked to implement a cryptographic canonicalisation.
  return sha256({ schema_version: "nyra_semantic_hint_message_v1", message: normalizedIntentText(message) });
}

function normalizeSemanticHint(value, message) {
  const messageDigest = semanticHintMessageDigest(message);
  const fallback = Object.freeze({
    schema_version: "nyra_semantic_intake_v1",
    state: value === undefined ? "NOT_PROVIDED" : "IGNORED",
    message_digest: messageDigest,
    route_candidate: null,
    speech_act: null,
    operation_class: null,
    confidence: null,
    ambiguous: null,
    injection_signals_present: false,
    authority: "NONE",
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = String(value.route_candidate || "");
  const speechAct = String(value.speech_act || "");
  const operationClass = String(value.operation_class || "");
  const confidence = String(value.confidence || "");
  const allowedKeys = new Set([
    "schema_version", "route_candidate", "speech_act", "operation_class",
    "confidence", "ambiguous", "injection_signals",
  ]);
  const valid = value.schema_version === "nyra_semantic_intent_hint_v1" &&
    SEMANTIC_HINT_ROUTES.has(candidate) && SEMANTIC_HINT_SPEECH_ACTS.has(speechAct) &&
    operationClass === "READ_ONLY" && SEMANTIC_HINT_CONFIDENCE.has(confidence) &&
    typeof value.ambiguous === "boolean" && value.ambiguous === false &&
    Array.isArray(value.injection_signals) && value.injection_signals.length === 0 &&
    Object.keys(value).every((key) => allowedKeys.has(key));
  if (!valid) return fallback;
  return Object.freeze({
    schema_version: "nyra_semantic_intake_v1",
    state: "CANDIDATE",
    message_digest: messageDigest,
    route_candidate: candidate,
    speech_act: speechAct,
    operation_class: operationClass,
    confidence,
    ambiguous: false,
    injection_signals_present: false,
    authority: "NONE",
  });
}

export function classifyNyraIntent({
  message,
  workBootstrap = false,
  tenantId = null,
  workId = null,
  sessionFingerprint = null,
  semanticHint = undefined,
} = {}) {
  const boundedTenantId = safeId(tenantId);
  if (!boundedTenantId) throw new Error("nyra_intent_authenticated_tenant_required");
  const text = normalizedIntentText(message);
  const normalized = text.toLowerCase().replace(/[^a-z0-9à-ÿ]+/giu, " ").trim();
  let intent = "chat";
  let route = "CORE_CONTEXT_THEN_NYRA";
  let confidence = 0.7;
  let reason = "advisory_default";
  const clauseResult = clauseArtifacts(text);
  const clauses = clauseResult.clauses;
  const semanticAssessment = assessLexicalSemanticText({
    text,
    source_context: "user_input",
    scope_salt: boundedTenantId,
  });
  const semanticIntake = normalizeSemanticHint(semanticHint, text);
  // A question about a named Work is never a global-control read.  It must
  // retain the Work/continuity route so a host cannot lose its bounded scope.
  const explicitWorkScope = Boolean(safeId(workId)) || /\b(?:work|lavoro)\b/iu.test(text);
  // “Nyra Converse è attiva?” is a state predicate, not an imperative.
  // Strip only that bounded predicate before looking for a mutation verb; a
  // following clitic imperative ("Attivala") still wins and stays in Core.
  const textWithoutStatePredicate = text.replace(CONTROL_STATE_PREDICATE, " ");
  const actionVerbPresent = ACTION_VERB.test(textWithoutStatePredicate) ||
    CONTROL_ACTION_VERB.test(textWithoutStatePredicate) || CONTROL_CLITIC_ACTION.test(text);
  const pureStatePredicate = CONTROL_STATE_PREDICATE.test(text) && !actionVerbPresent;
  const actionClauses = pureStatePredicate ? [] : clauses.filter((clause) => clause.action_candidates.length > 0 &&
    ((clause.affirmative_action_candidates.length > 0 && clause.imperative) ||
      clause.modality !== "asserted" || clause.quote_scope));
  const distinctActions = new Set(actionClauses.flatMap((clause) => clause.affirmative_action_candidates));
  const englishNegatedBareContrast = /\bdo\s+not\b[^;.!?]{0,200}(?:,|\bbut\b)\s*(?:deploy|push|merge|publish|release)\b/iu.test(text);
  const ambiguousActionLanguage = englishNegatedBareContrast || distinctActions.size > 1 || actionClauses.some((clause) => (
    (clause.polarity === "negative" && clause.affirmative_action_candidates.length === 0) ||
    clause.condition || clause.quote_scope ||
    clause.modality === "hypothetical"
  ));
  const workCreateRequested = clauses.some((clause) => clause.work_create_affirmative);
  const explicitReadOnlyBoundary = clauses.some((clause) =>
    clause.action_candidates.length > 0 && clause.polarity === "negative") &&
    clauses.every((clause) => clause.affirmative_action_candidates.length === 0) &&
    clauses.every((clause) => clause.action_candidates.length === 0 ||
      (clause.polarity === "negative" && !clause.imperative && !clause.condition && !clause.quote_scope));

  const safeGlobalControlRead = GLOBAL_CONTROL_READ.test(text) &&
    actionClauses.length === 0 && !ACTION_NOUN.test(text) && !workCreateRequested &&
    !WORK_RESUME.test(normalized) && !explicitWorkScope && !actionVerbPresent &&
    semanticAssessment.disposition === "allow";
  const hostHintGlobalControlRead = semanticIntake.state === "CANDIDATE" &&
    semanticIntake.route_candidate === "GLOBAL_CONTROL_READ" &&
    actionClauses.length === 0 && !ACTION_NOUN.test(text) && !workCreateRequested &&
    !WORK_RESUME.test(normalized) && !explicitWorkScope && !actionVerbPresent &&
    semanticAssessment.disposition === "allow";

  if (clauseResult.truncated) {
    intent = "ambiguous_consequential";
    route = "CORE_HOLD_THEN_NYRA";
    confidence = 0.99;
    reason = "clause_analysis_truncated";
  } else if (semanticAssessment.disposition !== "allow") {
    intent = "ambiguous_consequential";
    route = "CORE_HOLD_THEN_NYRA";
    confidence = 0.99;
    reason = "semantic_intake_requires_clarification";
  } else if (EXACT_COMMAND.test(text)) {
    intent = "command_catalog";
    route = "CORE_CATALOG_READ";
    confidence = 1;
    reason = "exact_command_id_proposal";
  } else if (explicitReadOnlyBoundary) {
    intent = "analysis";
    route = "CORE_CONTEXT_THEN_NYRA";
    confidence = 0.99;
    reason = "explicit_read_only_boundary";
  } else if (!workBootstrap && workCreateRequested && actionClauses.length > 0) {
    intent = "ambiguous_consequential";
    route = "CORE_HOLD_THEN_NYRA";
    confidence = 0.99;
    reason = "work_create_and_action_require_separation";
  } else if (workBootstrap || workCreateRequested) {
    intent = "work_create";
    route = "CORE_CONTEXT_THEN_NYRA";
    confidence = workBootstrap ? 1 : 0.94;
    reason = workBootstrap ? "typed_work_bootstrap" : "work_create_language";
  } else if (WORK_RESUME.test(normalized)) {
    intent = "work_resume";
    route = "CORE_CONTEXT_THEN_NYRA";
    confidence = 0.98;
    reason = "exact_work_resume_language";
  } else if (actionClauses.length > 0 && (ambiguousActionLanguage ||
      clauses.some((clause) => clause.diagnostic))) {
    intent = "ambiguous_consequential";
    route = "CORE_HOLD_THEN_NYRA";
    confidence = 0.98;
    reason = "clause_scope_requires_clarification";
  } else if (actionClauses.some((clause) => clause.imperative)) {
    intent = "ticket_or_action";
    route = "CORE_CONTEXT_THEN_NYRA";
    confidence = 0.91;
    reason = "consequential_action_language";
  } else if (safeGlobalControlRead || hostHintGlobalControlRead) {
    intent = "global_control_read";
    route = "CONTROL_ROOM_READ";
    confidence = safeGlobalControlRead ? 0.99 : 0.86;
    reason = safeGlobalControlRead ? "deterministic_global_control_read" : "host_semantic_hint_global_control_read";
  } else if (ACTION_NOUN.test(text) && !DIAGNOSTIC.test(text) && !ANALYSIS.test(text)) {
    intent = "ambiguous_consequential";
    route = "CORE_HOLD_THEN_NYRA";
    confidence = 0.62;
    reason = "consequential_scope_ambiguous";
  } else if (clauses.some((clause) => clause.action_candidates.length > 0) &&
      !DIAGNOSTIC.test(text)) {
    intent = "ambiguous_consequential";
    route = "CORE_HOLD_THEN_NYRA";
    confidence = 0.62;
    reason = "consequential_category_mention_ambiguous";
  } else if (COMMAND_CATALOG.test(text)) {
    intent = "command_catalog";
    route = "CORE_CATALOG_READ";
    confidence = 0.96;
    reason = "command_catalog_language";
  } else if (ANALYSIS.test(text)) {
    intent = "analysis";
    confidence = 0.88;
    reason = "advisory_analysis_language";
  }

  return Object.freeze({
    schema_version: "nyra_intent_route_v2",
    intent,
    route,
    confidence,
    reason,
    clauses,
    input_digest: sha256({
      schema_version: "nyra_intent_input_v2",
      tenant_id: boundedTenantId,
      work_id: safeId(workId),
      session_fingerprint: safeDigest(sessionFingerprint),
      text,
    }),
    core_preflight_required: route !== "CORE_CATALOG_READ" && route !== "CONTROL_ROOM_READ",
    resolution_scope: route === "CORE_CATALOG_READ" || route === "CONTROL_ROOM_READ" || intent === "chat" || intent === "analysis" ? "single_explicit" :
      intent === "ticket_or_action" ? "single_consequential" : "clarification_required",
    semantic_intake: Object.freeze({
      ...semanticIntake,
      state: reason === "host_semantic_hint_global_control_read" ? "ACCEPTED" : semanticIntake.state,
      lexical_disposition: semanticAssessment.disposition,
      lexical_risk_band: semanticAssessment.risk_band,
    }),
    execution_authorized: false,
  });
}

export function publicNyraIntentRoute(route) {
  return Object.freeze({
    schema_version: route.schema_version,
    intent: route.intent,
    route: route.route,
    clauses: Object.freeze(route.clauses.map((clause) => Object.freeze({
      polarity: clause.polarity,
      modality: clause.modality,
      condition: clause.condition,
      quote_scope: clause.quote_scope,
      action_candidates: clause.action_candidates,
    }))),
    input_digest: route.input_digest,
    semantic_intake: route.semantic_intake,
    execution_authorized: false,
  });
}

function safeId(value) {
  const text = String(value || "").trim();
  return ID.test(text) ? text : null;
}

function safeDigest(value) {
  const text = String(value || "").trim();
  return DIGEST.test(text) ? text : null;
}

function requireCatalogPage(value, tenantId, expectedRevision = null) {
  const payload = value?.structuredContent && typeof value.structuredContent === "object"
    ? value.structuredContent : {};
  if (payload.ok !== true || payload.schema_version !== "core_dynamic_capabilities_v1" ||
      payload.tenant_id !== tenantId || !safeDigest(payload.catalog_revision) ||
      (expectedRevision && payload.catalog_revision !== expectedRevision) ||
      payload.arbitrary_route_invocation_allowed !== false ||
      payload.execution_authorized !== false || !Array.isArray(payload.capabilities)) {
    throw new Error("nyra_authorized_command_catalog_invalid");
  }
  return payload;
}

function requireCatalogExact(value, tenantId, capabilityId) {
  const payload = value?.structuredContent && typeof value.structuredContent === "object"
    ? value.structuredContent : {};
  if (payload.ok !== true || payload.schema_version !== "core_dynamic_capabilities_v1" ||
      payload.tenant_id !== tenantId || !safeDigest(payload.catalog_revision) ||
      payload.arbitrary_route_invocation_allowed !== false ||
      payload.execution_authorized !== false || payload.capability?.capability_id !== capabilityId) {
    throw new Error("nyra_authorized_command_catalog_invalid");
  }
  return { payload, command: requireCatalogCommand(payload.capability) };
}

function requireCatalogCommand(item) {
  const commandId = safeId(item?.capability_id);
  const accessMode = item?.access_mode;
  const readOnly = item?.read_only;
  if (!commandId || !["read", "invoke"].includes(accessMode) || typeof readOnly !== "boolean" ||
      (accessMode === "read") !== readOnly || typeof item.owner_confirmation_required !== "boolean") {
    throw new Error("nyra_authorized_command_catalog_invalid");
  }
  return Object.freeze({
    command_id: commandId,
    title: typeof item.title === "string" && item.title.trim() && item.title.trim().length <= 240
      ? item.title.trim() : null,
    access_mode: accessMode,
    owner_confirmation_required: item.owner_confirmation_required,
  });
}

export async function readAuthorizedNyraCommandCatalog({ reader, identity, exactCapabilityId = null }) {
  if (typeof reader !== "function" || !safeId(identity?.tenantId)) {
    throw new Error("nyra_authorized_command_catalog_unavailable");
  }
  const exactId = safeId(exactCapabilityId);
  if (exactCapabilityId !== null) {
    if (!exactId) throw new Error("nyra_authorized_command_catalog_invalid");
    const { payload, command } = requireCatalogExact(await reader({
      capability_id: exactId,
      include_schema: false,
    }, identity), identity.tenantId, exactId);
    return Object.freeze({
      schema_version: "nyra_visible_command_catalog_v2",
      source: "authorized_dynamic_capability_catalog",
      catalog_revision: payload.catalog_revision,
      commands: Object.freeze([command]),
      identity_filtered: true,
      truncated: false,
    });
  }
  const capabilities = [];
  let cursor;
  let revision = null;
  const seen = new Set();
  let expectedTotal = null;
  for (let pageIndex = 0; pageIndex < 3 && capabilities.length < MAX_COMMANDS; pageIndex += 1) {
    const payload = requireCatalogPage(await reader({
      limit: MAX_COMMANDS,
      ...(cursor ? { cursor } : {}),
    }, identity), identity.tenantId, revision);
    revision ||= payload.catalog_revision;
    if (!Number.isSafeInteger(payload.total) || payload.total < 0 ||
        (expectedTotal !== null && payload.total !== expectedTotal)) {
      throw new Error("nyra_authorized_command_catalog_invalid");
    }
    expectedTotal ??= payload.total;
    for (const raw of payload.capabilities) {
      const command = requireCatalogCommand(raw);
      if (seen.has(command.command_id)) throw new Error("nyra_authorized_command_catalog_invalid");
      seen.add(command.command_id);
      if (capabilities.length < MAX_COMMANDS) capabilities.push(command);
    }
    cursor = typeof payload.next_cursor === "string" && /^\d+$/.test(payload.next_cursor)
      ? payload.next_cursor
      : null;
    if (payload.next_cursor !== null && !cursor) {
      throw new Error("nyra_authorized_command_catalog_invalid");
    }
    if (!cursor) break;
  }
  return Object.freeze({
    schema_version: "nyra_visible_command_catalog_v2",
    source: "authorized_dynamic_capability_catalog",
    catalog_revision: revision,
    commands: Object.freeze(capabilities),
    identity_filtered: true,
    truncated: Boolean(cursor),
  });
}

function aliasTokens(value) {
  return new Set(String(value || "").toLowerCase().split(/[^a-z0-9à-ÿ]+/u)
    .filter((token) => token.length > 2).slice(0, 24));
}

export function resolveNyraCommandProposal({
  message, catalog, route, tenantId, workId = null, sessionFingerprint = null,
} = {}) {
  const expectedRoute = classifyNyraIntent({ message, tenantId, workId, sessionFingerprint });
  if (route?.schema_version !== "nyra_intent_route_v2" ||
      route.input_digest !== expectedRoute.input_digest || route.route !== "CORE_CATALOG_READ" ||
      route.resolution_scope !== "single_explicit") {
    return Object.freeze({
      schema_version: "nyra_command_proposal_v1",
      state: "CLARIFY_HOLD",
      capability_id: null,
      score: 0,
      margin: 0,
      execution_authorized: false,
      catalog_revision: safeDigest(catalog?.catalog_revision),
      route_input_digest: safeDigest(route?.input_digest),
      proposal_digest: sha256({ state: "CLARIFY_HOLD", route: safeDigest(route?.input_digest),
        catalog: safeDigest(catalog?.catalog_revision) }),
    });
  }
  const commands = Array.isArray(catalog?.commands) ? catalog.commands : [];
  const text = normalizedIntentText(message).toLowerCase();
  const exact = commands.find((command) => text === command.command_id ||
    text === `/${command.command_id}`);
  if (exact) return Object.freeze({
    schema_version: "nyra_command_proposal_v1",
    state: "EXACT_ELIGIBLE_ID",
    capability_id: exact.command_id,
    score: 1,
    margin: 1,
    execution_authorized: false,
    catalog_revision: catalog.catalog_revision,
    route_input_digest: route.input_digest,
    proposal_digest: sha256({ state: "EXACT_ELIGIBLE_ID", capability_id: exact.command_id,
      route: route.input_digest, catalog: catalog.catalog_revision }),
  });
  const queryTokens = aliasTokens(text);
  const ranked = commands.map((command) => {
    const tokens = aliasTokens(`${command.command_id} ${command.title || ""}`);
    const score = [...queryTokens].filter((token) => tokens.has(token)).length;
    return { capability_id: command.command_id, score };
  }).filter((item) => item.score > 0).sort((left, right) =>
    right.score - left.score || left.capability_id.localeCompare(right.capability_id));
  const top = ranked[0] || null;
  const second = ranked[1] || null;
  const margin = top ? top.score - (second?.score || 0) : 0;
  const proposed = top && top.score >= 2 && margin >= 1;
  return Object.freeze({
    schema_version: "nyra_command_proposal_v1",
    state: proposed ? "PROPOSED" : "CLARIFY_HOLD",
    capability_id: proposed ? top.capability_id : null,
    score: top?.score || 0,
    margin,
    execution_authorized: false,
    catalog_revision: safeDigest(catalog?.catalog_revision),
    route_input_digest: route.input_digest,
    proposal_digest: sha256({ state: proposed ? "PROPOSED" : "CLARIFY_HOLD",
      capability_id: proposed ? top.capability_id : null, route: route.input_digest,
      catalog: safeDigest(catalog?.catalog_revision) }),
  });
}

export function buildNyraRoutingTelemetry({ route, preflightInvoked, context, catalog, elapsedMs }) {
  return Object.freeze({
    schema_version: "nyra_intent_routing_telemetry_v1",
    preflight_invoked: preflightInvoked === true,
    visible_command_count: Math.min(catalog?.commands?.length || 0, MAX_COMMANDS),
    elapsed_ms: Math.min(Math.max(Math.round(Number(elapsedMs) || 0), 0), 60_000),
    raw_prompt_recorded: false,
    secret_material_recorded: false,
  });
}
