import crypto from "node:crypto";

const MAX_COMMANDS = 24;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,159}$/;

const WORK_CREATE = /\b(?:crea\w*|avvia\w*|apri\w*|create|start|open)\b.{0,80}\b(?:work|lavoro)\b|\b(?:work|lavoro)\b.{0,80}\b(?:nuov\w*|new)\b/iu;
const WORK_RESUME = /^(?:nyra\s+)?(?:riprendi|continua|resume|continue)(?:\s+(?:(?:il|lo|la|questo|questa|the|this|current|existing|corrente|attuale)\s+)?(?:work|lavoro))?(?:\s+(?:esistente|corrente|attuale|current|existing))?$/iu;
const COMMAND_CATALOG = /\b(?:comandi|commands|capabilit(?:y|ies|à)|cosa\s+(?:puoi|sai)\s+fare|catalogo\s+(?:comandi|capabilit)|help\s+(?:commands?|capabilit(?:y|ies)))\b/iu;
const ANALYSIS = /\b(?:analizz\w*|analysis|diagnos\w*|spiega\w*|explain|perch[eé]|why|confront\w*|compare|architett\w*|architecture|stato|status)\b/iu;
const ACTION_NOUN = /\b(?:ticket|delega\w*|delegation|autorizz\w*|authoriz\w*|commit|push|pull\s+request|\bpr\b|merge|deploy\w*|publish\w*|release|rollback)\b/iu;
const ACTION_VERB = /\b(?:crea\w*|emetti\w*|issue|richied\w*|request|autorizz\w*|authoriz\w*|esegui\w*|execute|fai|faccio|fare|do|effettua\w*|porta\w*|metti\w*|avvia\w*|start|prepara\w*|pubblic\w*|publish\w*|rilasci\w*|send|email|notify|invia\w*|manda\w*|delete|remove|destroy|elimina\w*|cancella\w*|pay|purchase|buy|refund|paga\w*|acquista\w*|rimborsa\w*|book|schedule|invite|prenota\w*|invita\w*|grant|revoke|abilita\w*|revoca\w*)\b/iu;
const DIAGNOSTIC = /(?:perch[eé]|why|diagnos\w*|spiega\w*|explain|cosa\s+(?:manca|serve))/iu;
const NEGATION = /\b(?:non|no|senza|never|do\s+not|don't)\b/iu;
const CONDITION = /\b(?:se|if|unless|quando|when|solo\s+se|only\s+if)\b/iu;
const HYPOTHETICAL = /\b(?:dicessi|direi|sarebbe|would|hypothetical|ipotetic\w*|esempio|example)\b/iu;
const QUOTE = /["“”`]|(?:^|\s)['‘’][^'‘’]{1,200}['‘’](?:\s|$)/u;
const EXACT_COMMAND = /^\/[a-zA-Z0-9][a-zA-Z0-9._:-]{1,159}$/u;
export const NYRA_CONSEQUENTIAL_CATEGORY_PATTERNS = Object.freeze([
  Object.freeze({ category: "release", mention: /\b(?:deploy\w*|deployment|merge|push|publish\w*|release|distribuisc\w*|distribuzion\w*|pubblic\w*|rilasci\w*)\b|\b(?:porta\w*|metti\w*)\s+(?:\w+\s+){0,3}(?:live|in\s+produzione)\b/iu, imperative: /\b(?:deploy\w*|merge\w*|push\w*|publish\w*|distribuisc\w*|pubblic\w*|rilasci\w*)\b|\b(?:porta\w*|metti\w*)\s+(?:\w+\s+){0,3}(?:live|in\s+produzione)\b/iu }),
  Object.freeze({ category: "communication", mention: /\b(?:send|email|message|notify|invia\w*|manda\w*|messaggi\w*|messaggia\w*|notific\w*)\b/iu, imperative: /\b(?:send|message|notify|invia\w*|manda\w*|messaggia\w*|notifica\w*)\b/iu }),
  Object.freeze({ category: "destructive", mention: /\b(?:delete|remove|destroy|elimina\w*|cancella\w*|distrugg\w*)\b/iu, imperative: /\b(?:delete|remove|destroy|elimina\w*|cancella\w*|distrugg\w*)\b/iu }),
  Object.freeze({ category: "financial", mention: /\b(?:pay|purchase|buy|refund|paga\w*|acquista\w*|rimborsa\w*)\b/iu, imperative: /\b(?:pay|purchase|buy|refund|paga\w*|acquista\w*|rimborsa\w*)\b/iu }),
  Object.freeze({ category: "scheduling", mention: /\b(?:book|schedule|invite|appointment|prenota\w*|calendar\w*|appuntament\w*|invita\w*)\b/iu, imperative: /\b(?:book|schedule|invite|prenota\w*|invita\w*)\b/iu }),
  Object.freeze({ category: "access", mention: /\b(?:grant|revoke|permission|access|accesso|permess\w*|abilita\w*|revoca\w*)\b/iu, imperative: /\b(?:grant|revoke|abilita\w*|revoca\w*)\b/iu }),
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
  ["commit", /\bcommit\w*\b/iu],
  ["push", /\bpush\w*\b/iu],
  ["pull_request", /\b(?:pull\s+request|pr)\b/iu],
  ["merge", /\bmerge\w*\b/iu],
  ["deploy", /\bdeploy\w*\b|\b(?:porta\w*|metti\w*)\s+(?:\w+\s+){0,3}(?:live|in\s+produzione)\b/iu],
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
  return String(text || "").replace(/^\s*nyra\s*,\s*/iu, "")
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
}

function clauseArtifacts(text) {
  return Object.freeze(splitIntentClauses(text).map((clause) => clause.trim())
    .filter(Boolean).slice(0, 8).map((clause, index) => {
      const actionMatches = ACTION_TYPES.map(([name, pattern]) => [name, clause.search(pattern)])
        .filter(([, position]) => position >= 0);
      let actions = actionMatches.map(([name]) => name);
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
      const quoted = QUOTE.test(clause) || hypothetical;
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
          (negationIndex < 0 || workCreateIndex < negationIndex),
      });
    }));
}

export function classifyNyraIntent({
  message,
  workBootstrap = false,
  tenantId = null,
  workId = null,
  sessionFingerprint = null,
} = {}) {
  const boundedTenantId = safeId(tenantId);
  if (!boundedTenantId) throw new Error("nyra_intent_authenticated_tenant_required");
  const text = normalizedIntentText(message);
  const normalized = text.toLowerCase().replace(/[^a-z0-9à-ÿ]+/giu, " ").trim();
  let intent = "chat";
  let route = "CORE_CONTEXT_THEN_NYRA";
  let confidence = 0.7;
  let reason = "advisory_default";
  const clauses = clauseArtifacts(text);
  const actionClauses = clauses.filter((clause) => clause.action_candidates.length > 0 &&
    ((clause.affirmative_action_candidates.length > 0 && clause.imperative) ||
      clause.modality !== "asserted" || clause.quote_scope));
  const distinctActions = new Set(actionClauses.flatMap((clause) => clause.affirmative_action_candidates));
  const englishNegatedBareContrast = /\bdo\s+not\b[^;.!?]{0,200}(?:,|\bbut\b)\s*(?:deploy|push|merge|publish|release)\b/iu.test(text);
  const ambiguousActionLanguage = englishNegatedBareContrast || distinctActions.size > 1 || actionClauses.some((clause) => (
    (clause.polarity === "negative" && clause.affirmative_action_candidates.length === 0) ||
    clause.condition || clause.quote_scope ||
    clause.modality === "hypothetical"
  ));
  const workCreateRequested = clauses.some((clause) =>
    clause.work_create_affirmative);
  const explicitReadOnlyBoundary = clauses.some((clause) =>
    clause.action_candidates.length > 0 && clause.polarity === "negative") &&
    clauses.every((clause) => clause.affirmative_action_candidates.length === 0) &&
    clauses.every((clause) => clause.action_candidates.length === 0 ||
      (clause.polarity === "negative" && !clause.imperative && !clause.condition && !clause.quote_scope));

  if (EXACT_COMMAND.test(text)) {
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
  } else if (ACTION_NOUN.test(text) && !DIAGNOSTIC.test(text)) {
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
    schema_version: "nyra_intent_route_v1",
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
    core_preflight_required: route !== "CORE_CATALOG_READ",
    resolution_scope: route === "CORE_CATALOG_READ" || intent === "chat" || intent === "analysis" ? "single_explicit" :
      intent === "ticket_or_action" ? "single_consequential" : "clarification_required",
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
      schema_version: "nyra_visible_command_catalog_v1",
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
    schema_version: "nyra_visible_command_catalog_v1",
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
  if (route?.schema_version !== "nyra_intent_route_v1" ||
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
