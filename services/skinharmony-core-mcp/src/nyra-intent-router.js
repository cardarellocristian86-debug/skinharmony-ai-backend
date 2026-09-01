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
const CONTROL_TARGETED_IMPERATIVE = new RegExp(
  `\\b(?:attiva|disattiva|riattiva|abilita|disabilita|riabilita|accendi|spegni|imposta|configura|correggi|passa)\\b\\s+(?:(?:il|lo|la|i|gli|le|the)\\s+)?(?:${RUNTIME_CONTROL_TARGET})\\b`,
  "iu",
);
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
const GLOBAL_CONTROL_STATUS_QUESTION = /(?:\b(?:hai|avete|have|has|do\s+you\s+have)\b.{0,80}\b(?:entity\s*360|e360|nyra\s+converse|dialog(?:o|ue)|semantic\s+scope\s+guard|scope\s+guard|work\s+continuity|research\s+airlock)\b.{0,80}\b(?:attiv\w*|disattiv\w*|abilitat\w*|disabilitat\w*|active|inactive|enabled|disabled|on|off|shadow|enforced|stato|status)\b|\b(?:quali|che|what|which)\b.{0,80}(?:funzion\w*|capacità|capacita|capability|capabilities|controll\w*).{0,80}\b(?:attiv\w*|disattiv\w*|abilitat\w*|disabilitat\w*|shadow|enforced|autorizz\w*|owner|conferm\w*)\b|\b(?:per\s+quali|which)\b.{0,80}\b(?:azioni|actions?)\b.{0,80}\b(?:owner|conferm\w*|autorizz\w*)\b)/iu;
const NYRA_ADVISORY_READ = /\bnyra\b|\b(?:chi\s+sei|come\s+funzioni|cosa\s+ti\s+manca|cosa\s+puoi|qual(?:\s|')*[èe]\s+la\s+differenza)\b|\b(?:entity\s*360|e360)\b.{0,100}\bsemantic\s+scope\s+guard\b/iu;
const NYRA_SELF_MODEL_READ = /\b(?:self[\s_-]?model|modello\s+(?:di\s+)?(?:te|nyra)|who\s+are\s+you|chi\s+sei|your\s+(?:limits?|capabilities)|tuoi\s+(?:limiti|capacità|capacita))\b/iu;
const NYRA_GAP_READ = /\b(?:cosa\s+ti\s+manca\s+per\s+lavorare\s+meglio|what\s+do\s+you\s+(?:lack|need)\s+to\s+work\s+better|how\s+can\s+you\s+work\s+better)\b/iu;\nconst DISTILLED_LESSONS_READ = /\b(?:lezion[ie]\s+distillat\w*|distilled\s+lessons?|errori\s+(?:passati|ricorrenti)|failure\s+lessons?)\b/iu;
const GLOBAL_READ_DOMAIN = /\b(?:nyra|universal\s+core|core|icf|entity\s*360|e360|self[\s_-]?model|autodiagnos\w*|self[\s_-]?diagnos\w*|software\s+(?:atlas|architecture)|architecture\s+atlas|memori\w*|memory|gallery|verified[\s_-]?learning|capabilit\w*|funzion\w*)\b/iu;
const ACTION_NOUN = /\b(?:ticket|delega\w*|delegation|autorizz\w*|authoriz\w*|commit|push|pull\s+request|\bpr\b|merge|deploy(?:ed|ing)?|publish\w*|release|rollback)\b/iu;
const ACTION_VERB = /\b(?:crea\w*|emetti\w*|issue|richied\w*|request|autorizz\w*|authoriz\w*|esegui\w*|execute|fai|faccio|fare|effettua\w*|porta\w*|metti\w*|avvia\w*|start|prepara\w*|pubblic\w*|publish\w*|rilasci\w*|send|email|notify|invia\w*|manda\w*|delete|remove|destroy|elimina\w*|cancella\w*|pay|purchase|buy|refund|paga\w*|acquista\w*|rimborsa\w*|book|schedule|invite|prenota\w*|invita\w*|grant|revoke|revoca\w*|attiva(?:lo|la|li|le)?|disattiva(?:lo|la|li|le)?|riattiva(?:lo|la|li|le)?|abilita(?:lo|la|li|le)?|disabilita(?:lo|la|li|le)?|riabilita(?:lo|la|li|le)?|accendi(?:lo|la|li|le)?|spegni(?:lo|la|li|le)?|imposta(?:lo|la|li|le)?|configura(?:lo|la|li|le)?|correggi(?:lo|la|li|le)?|procedi|passa(?:lo|la|li|le)?|rimetti|allinea|cambia|attivare|disattivare|abilitare|disabilitare|enable|disable|re-?enable|reactivate|set|switch|turn)\b/iu;
const DIAGNOSTIC = /(?:perch[eé]|why|diagnos\w*|spiega\w*|explain|cosa\s+(?:manca|serve))/iu;
const NEGATION = /\b(?:non|no|senza|never|do\s+not|don't)\b/iu;
const CONDITION = /\b(?:se|if|unless|quando|when|solo\s+se|only\s+if)\b/iu;
const HYPOTHETICAL = /\b(?:dicessi|direi|sarebbe|would|hypothetical|ipotetic\w*|esempio|example)\b/iu;
// A prose question about Work must never be promoted to a Work-create turn.
// Structured `workBootstrap` remains the only explicit non-prose override.
const INTERROGATIVE = /^\s*(?:what|which|who|where|when|why|how|can|could|would|will|should|may|might|shall|do|does|did|is|are|was|were|am|have|has|had|cosa|qual(?:e|i)?|chi|dove|quando|perch[eé]|come|puoi|potresti|vorresti|posso|devo|dovrei|sei|sono|ha|hai)\b/iu;
const EXACT_COMMAND = /^\/[a-zA-Z0-9][a-zA-Z0-9._:-]{1,159}$/u;
const FUTURE_SCOPE = /\b(?:pi[uù]\s+avanti|in\s+seguito|dopo|quando|poi|later|afterwards?|eventually|in\s+the\s+future|when)\b/iu;
const OWNER_RESERVED = /(?:\b(?:lo\s+far[oò]\s+io|lo\s+faccio\s+io|faccio\s+io|lo\s+far[aà]\s+l[’']?owner|owner\s+(?:esegue|far[aà]|will\s+do)|i(?:'|’)ll\s+do\s+it)(?=\s|[;,.!?]|$)|\b(?:merge|deploy\w*|push|pull(?:\s+request)?|\bpr\b|publish\w*|release)\b.{0,40}\b(?:manual(?:e|mente)?|owner)\b)/iu;
// V1 deliberately admits only the one route that can be made safe without a
// Work or an LLM-produced answer. Other semantic interpretations remain on
// the existing Core/Work path until they have their own bounded contract.
const SEMANTIC_HINT_ROUTES = new Set(["GLOBAL_CONTROL_READ", "NYRA_INTROSPECTION_READ"]);
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
  ["pull_request", /\b(?:pull(?:\s+request)?|pr)\b/iu],
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
      const interrogative = INTERROGATIVE.test(clause);
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
      const imperative = actionVerbIndex >= 0 && !diagnostic && !interrogative &&
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
        interrogative,
        work_create_candidate: WORK_CREATE.test(clause),
        work_create_affirmative: workCreateIndex >= 0 &&
          !diagnostic && !interrogative && !conditional && !hypothetical && !quoted &&
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

function ownerReservedActionsForClause(source, actions) {
  if (!OWNER_RESERVED.test(source)) return [];
  const patterns = {
    merge: "merge",
    deploy: "deploy\\w*",
    push: "push",
    pull_request: "(?:pull(?:\\s+request)?|pr)",
    publish: "(?:publish\\w*|release)",
  };
  const ownerMarker = "(?:lo\\s+far[oò]\\s+io|lo\\s+faccio\\s+io|faccio\\s+io|lo\\s+far[aà]\\s+l[’']?owner|owner|i(?:'|’)ll\\s+do\\s+it|manual(?:e|mente)?)";
  const marker = new RegExp(ownerMarker, "iu").exec(source);
  const candidates = actions.filter((action) => action !== "release").flatMap((action) => {
    const token = patterns[action];
    if (!token) return [];
    const match = new RegExp(`\\b${token}\\b`, "iu").exec(source);
    return match ? [{ action, index: match.index }] : [];
  });
  const before = candidates.filter((item) => item.index <= marker.index)
    .sort((left, right) => right.index - left.index)[0];
  const after = candidates.filter((item) => item.index > marker.index)
    .sort((left, right) => left.index - right.index)[0];
  const selected = before || after;
  const reserved = selected ? [selected.action] : [];
  if (reserved.length > 0 && actions.includes("release")) reserved.push("release");
  return reserved.length > 0 ? reserved : actions.length === 1 ? [...actions] : [];
}

function materializeCanonicalIntent({
  text,
  intent,
  route,
  confidence,
  reason,
  clauses,
  semanticIntake,
  semanticAssessment,
  workBootstrap,
}) {
  const sourceClauses = splitIntentClauses(text).clauses;
  const requestedNow = [];
  const futureGoals = [];
  const constraints = [];
  const prohibitedActions = [];
  const referencedActions = [];
  const ownerReservedActions = [];
  for (const clause of clauses) {
    const source = sourceClauses[clause.index] || "";
    const actions = [...new Set([
      ...clause.action_candidates,
      ...detectNyraConsequentialCategories(source),
    ])];
    if (actions.length === 0) continue;
    const future = FUTURE_SCOPE.test(source);
    const reservedActions = ownerReservedActionsForClause(source, actions);
    const ownerReserved = reservedActions.length > 0;
    if (clause.polarity === "negative") {
      prohibitedActions.push(...actions.filter((action) =>
        !clause.affirmative_action_candidates.includes(action)));
    }
    if (clause.condition) constraints.push(...actions);
    if (future) futureGoals.push(...actions);
    if (ownerReserved) ownerReservedActions.push(...reservedActions);
    const currentConsequentialStatement = ["ticket_or_action", "ambiguous_consequential"].includes(intent) &&
      clause.polarity === "positive" && clause.modality === "asserted";
    const consequentialNeed = /\b(?:serve|servono|necessit\w*|need(?:ed)?|required?)\b/iu.test(source) &&
      actions.length > 0;
    if ((clause.imperative || currentConsequentialStatement || consequentialNeed) &&
        (clause.polarity === "positive" || clause.affirmative_action_candidates.length > 0) &&
        clause.modality === "asserted" && !clause.quote_scope && !future) {
      requestedNow.push(...(clause.affirmative_action_candidates.length > 0
        ? clause.affirmative_action_candidates.filter((action) => !reservedActions.includes(action))
        : actions.filter((action) => !reservedActions.includes(action)).map((action) =>
          action === "release" && /\b(?:deploy\w*|distribuzion\w*|live|produzione)\b/iu.test(source)
            ? "deploy" : action)));
    } else {
      referencedActions.push(...actions);
    }
  }
  if (workBootstrap || intent === "work_create") requestedNow.unshift("work_bootstrap");
  const unique = (items) => Object.freeze([...new Set(items)]);
  const consequentialIntent = requestedNow.some((action) => action !== "work_bootstrap");
  const workRequirement = intent === "work_create" ? "NEW" :
    intent === "work_resume" || consequentialIntent ? "EXISTING" :
      ["command_catalog", "global_control_read", "nyra_self_model_read", "nyra_gap_read", "advisory_read", "analysis", "chat"].includes(intent)
        ? "NONE" : "UNKNOWN";
  const envelope = {
    schema_version: "nyra_canonical_intent_v1",
    requested_now: unique(requestedNow),
    future_goals: unique(futureGoals),
    constraints: unique(constraints),
    prohibited_actions: unique(prohibitedActions),
    referenced_actions: unique(referencedActions),
    owner_reserved_actions: unique(ownerReservedActions),
    speech_act: semanticIntake.speech_act || (clauses.some((clause) => clause.interrogative) ? "QUESTION" : "REQUEST"),
    operation_class: consequentialIntent ? "EXTERNAL_MUTATION" : "READ_ONLY",
    scope: ["CORE_CATALOG_READ", "CONTROL_ROOM_READ", "ADVISORY_READ"].includes(route) ? "GLOBAL" :
      workRequirement === "NONE" ? "CONVERSATION" : "WORK",
    target: intent,
    work_requirement: workRequirement,
    consequential_intent: consequentialIntent,
    confidence,
    ambiguity: intent === "ambiguous_consequential",
    safety_signals: Object.freeze(semanticAssessment.disposition === "allow" ? [] : [semanticAssessment.disposition]),
    provenance: Object.freeze({
      source: "nyra_dialogue_semantic_intake",
      reason_code: reason,
      semantic_hint_state: semanticIntake.state,
      raw_text_digest: semanticHintMessageDigest(text),
    }),
  };
  return Object.freeze({ ...envelope, intent_digest: sha256(envelope) });
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
  // A question that names a Work is never a global-control read. A stale
  // host-supplied work_id must not turn a global status read into a binding.
  const explicitWorkScope = /\b(?:work|lavoro)\b/iu.test(text);
  // “Nyra Converse è attiva?” is a state predicate, not an imperative.
  // Strip only that bounded predicate before looking for a mutation verb; a
  // following clitic imperative ("Attivala") still wins and stays in Core.
  const textWithoutStatePredicate = text
    .replace(CONTROL_STATE_PREDICATE, " ")
    .replace(GLOBAL_CONTROL_STATUS_QUESTION, " ");
  const actionVerbPresent = ACTION_VERB.test(textWithoutStatePredicate) ||
    CONTROL_ACTION_VERB.test(textWithoutStatePredicate) || CONTROL_CLITIC_ACTION.test(text) ||
    CONTROL_TARGETED_IMPERATIVE.test(text);
  const pureStatePredicate = (CONTROL_STATE_PREDICATE.test(text) ||
    GLOBAL_CONTROL_STATUS_QUESTION.test(text)) && !actionVerbPresent;
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
  const advisoryReadQuestion = !safeId(workId) && clauses.some((clause) => clause.interrogative) &&
    actionClauses.length === 0 && clauses.every((clause) => clause.action_candidates.length === 0) &&
    !workBootstrap && !workCreateRequested &&
    !WORK_RESUME.test(normalized) && !GLOBAL_CONTROL_READ.test(text) &&
    !COMMAND_CATALOG.test(text) && NYRA_ADVISORY_READ.test(text);
  const comparativeAuthorityRead = clauses.some((clause) => clause.interrogative) &&
    /\b(?:differenza|difference|distinzione|distinction)\b/iu.test(text) &&
    clauses.every((clause) => clause.action_candidates.every((action) => action === "authorization"));
  const horizontalGlobalRead = !safeId(workId) && !workBootstrap && !workCreateRequested &&
    !WORK_RESUME.test(normalized) && actionClauses.length === 0 && GLOBAL_READ_DOMAIN.test(text) &&
    clauses.every((clause) => clause.action_candidates.length === 0 && !clause.imperative) &&
    (/[?？]/u.test(text) || clauses.some((clause) => clause.interrogative || clause.diagnostic) || ANALYSIS.test(text)) &&
    semanticAssessment.disposition === "allow";

  // A host model may express an intent in any language, but it cannot grant
  // authority: the server accepts only this bounded read-only class and still
  // rejects it whenever local evidence sees an operation, a Work bootstrap or
  // a consequential noun.  Direct lexical matches keep the common requests
  // available even for hosts that do not emit a semantic hint.
  const safeIntrospectionRead = actionClauses.length === 0 && !workBootstrap &&
    !workCreateRequested && !WORK_RESUME.test(normalized) && !ACTION_NOUN.test(text) &&
    clauses.every((clause) => clause.action_candidates.length === 0) &&
    semanticAssessment.disposition === "allow" &&
    (NYRA_SELF_MODEL_READ.test(text) || NYRA_GAP_READ.test(text));
  const safeDistilledLessonsRead = actionClauses.length === 0 && !workBootstrap &&\n    !workCreateRequested && !WORK_RESUME.test(normalized) && !ACTION_NOUN.test(text) &&\n    semanticAssessment.disposition === "allow" && DISTILLED_LESSONS_READ.test(text);\n  const hostHintIntrospectionRead = semanticIntake.state === "CANDIDATE" &&
    semanticIntake.route_candidate === "NYRA_INTROSPECTION_READ" &&
    actionClauses.length === 0 && !workBootstrap && !workCreateRequested &&
    clauses.every((clause) => clause.action_candidates.length === 0) &&
    !WORK_RESUME.test(normalized) && !ACTION_NOUN.test(text) &&
    semanticAssessment.disposition === "allow";

  const globalControlReadQuestion = GLOBAL_CONTROL_READ.test(text) ||
    GLOBAL_CONTROL_STATUS_QUESTION.test(text);
  const safeGlobalControlRead = globalControlReadQuestion &&
    actionClauses.length === 0 && !workCreateRequested &&
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
  } else if (actionVerbPresent && RUNTIME_CONTROL_MUTATION.test(text) &&
      clauses.some((clause) => clause.action_candidates.includes("runtime_control"))) {
    intent = "ticket_or_action";
    route = "CORE_CONTEXT_THEN_NYRA";
    confidence = 0.96;
    reason = "explicit_consequential_action_precedence";
  } else if (safeDistilledLessonsRead) {\n    intent = "distilled_lessons_read";\n    route = "ADVISORY_READ";\n    confidence = 0.99;\n    reason = "bounded_distilled_lessons_read";\n  } else if (safeIntrospectionRead || hostHintIntrospectionRead) {
    intent = NYRA_SELF_MODEL_READ.test(text) ? "nyra_self_model_read" : "nyra_gap_read";
    route = "ADVISORY_READ";
    confidence = safeIntrospectionRead ? 0.99 : 0.86;
    reason = safeIntrospectionRead
      ? "bounded_nyra_introspection_read"
      : "host_semantic_hint_nyra_introspection_read";
  } else if (advisoryReadQuestion || comparativeAuthorityRead) {
    intent = "advisory_read";
    route = "ADVISORY_READ";
    confidence = 0.96;
    reason = "bounded_informational_question";
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
  } else if (OWNER_RESERVED.test(text) &&
      clauses.some((clause) => clause.imperative && clause.action_candidates.length === 0)) {
    intent = "analysis";
    route = "CORE_CONTEXT_THEN_NYRA";
    confidence = 0.9;
    reason = "owner_reserved_effect_with_bounded_preparation";
  } else if (clauses.some((clause) => clause.imperative && clause.action_candidates.length === 0)) {
    intent = "ambiguous_consequential";
    route = "CORE_HOLD_THEN_NYRA";
    confidence = 0.82;
    reason = "unresolved_imperative_requires_clarification";
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
  } else if (horizontalGlobalRead) {
    intent = "advisory_read";
    route = "ADVISORY_READ";
    confidence = 0.94;
    reason = "horizontal_global_read_plane";
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

  const canonicalIntent = materializeCanonicalIntent({
    text, intent, route, confidence, reason, clauses, semanticIntake,
    semanticAssessment, workBootstrap,
  });
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
    core_preflight_required: !["CORE_CATALOG_READ", "CONTROL_ROOM_READ", "ADVISORY_READ"].includes(route),
    resolution_scope: ["CORE_CATALOG_READ", "CONTROL_ROOM_READ", "ADVISORY_READ"].includes(route) || intent === "chat" || intent === "analysis" ? "single_explicit" :
      intent === "ticket_or_action" ? "single_consequential" : "clarification_required",
    semantic_intake: Object.freeze({
      ...semanticIntake,
      state: reason === "host_semantic_hint_global_control_read" ? "ACCEPTED" : semanticIntake.state,
      lexical_disposition: semanticAssessment.disposition,
      lexical_risk_band: semanticAssessment.risk_band,
    }),
    canonical_intent: canonicalIntent,
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
    canonical_intent: route.canonical_intent,
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
