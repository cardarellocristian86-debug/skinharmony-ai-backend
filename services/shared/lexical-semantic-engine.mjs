import crypto from "node:crypto";

export const LEXICAL_SEMANTIC_ENGINE_VERSION = "lexical_semantic_engine_v1";
export const LEXICAL_SEMANTIC_CATALOG_VERSION = "lexical_semantic_catalog_v1";
export const LEXICAL_SEMANTIC_CAPABILITY_PAGE_LIMIT = 100;
export const LEXICAL_SEMANTIC_VIRTUAL_PAGE_LIMIT = 50;

const CAPABILITY_DEFINITIONS = Object.freeze([
  ["unicode_normalization", "surface", "Preserve raw spans while deriving versioned Unicode-normalized forms."],
  ["language_identification", "surface", "Identify language, script and mixed-language spans with uncertainty."],
  ["sentence_segmentation", "surface", "Segment bounded text without losing source offsets."],
  ["tokenization", "surface", "Create Unicode-aware tokens bound to immutable source spans."],
  ["placeholder_protection", "surface", "Protect code, variables, product identifiers and structured placeholders."],
  ["lemma_analysis", "morphology", "Generate bounded lemma candidates without forcing one interpretation."],
  ["inflection_analysis", "morphology", "Represent inflectional features and ambiguity."],
  ["compound_analysis", "morphology", "Resolve compounds while preserving component provenance."],
  ["lexeme_lookup", "lexicon", "Lookup versioned lexemes and senses through tenant-safe adapters."],
  ["multiword_expression_detection", "lexicon", "Detect multiword expressions before independent token scoring."],
  ["idiom_detection", "lexicon", "Identify idiomatic candidates and retain literal alternatives."],
  ["polysemy_detection", "lexicon", "Expose competing senses rather than collapsing ambiguous terms."],
  ["term_extraction", "terminology", "Extract terminology candidates with source spans and confidence."],
  ["term_canonicalization", "terminology", "Map variants to stable concept identifiers without rewriting raw text."],
  ["approved_glossary_match", "terminology", "Match only tenant-authorized, versioned glossary entries."],
  ["forbidden_term_detection", "terminology", "Detect policy-bound terms using word boundaries and context."],
  ["acronym_resolution", "terminology", "Resolve acronyms through scoped evidence and abstain on collisions."],
  ["terminology_drift_detection", "terminology", "Detect meaning and label drift across versioned corpora."],
  ["dependency_analysis", "syntax", "Represent dependency candidates and attachment uncertainty."],
  ["negation_scope", "syntax", "Bind negation to the proposition it modifies."],
  ["modifier_attachment", "syntax", "Keep competing modifier attachments when evidence is insufficient."],
  ["coordination_scope", "syntax", "Resolve coordination boundaries and shared predicates."],
  ["predicate_argument_mapping", "semantics", "Map predicates and arguments into a bounded semantic graph."],
  ["semantic_role_labeling", "semantics", "Propose semantic roles with source-span evidence."],
  ["word_sense_disambiguation", "semantics", "Rank word senses while preserving alternatives and abstention."],
  ["semantic_relation_extraction", "semantics", "Propose typed relations with provenance and confidence."],
  ["entailment_hypothesis", "semantics", "Propose entailment only as an evidence-backed hypothesis."],
  ["contradiction_hypothesis", "semantics", "Surface contradictions without averaging them away."],
  ["entity_link_candidate", "entities", "Link entity candidates to stable identifiers through adapters."],
  ["coreference_resolution", "entities", "Resolve reference chains with explicit uncertainty."],
  ["temporal_expression_normalization", "entities", "Normalize temporal expressions while retaining original text."],
  ["unit_normalization", "entities", "Normalize quantities and units without changing commercial meaning."],
  ["price_quantity_binding", "entities", "Bind prices, quantities and comparison operators to their scope."],
  ["discourse_relation_detection", "discourse", "Detect discourse relations across sentences and sections."],
  ["cross_sentence_contradiction", "discourse", "Detect contradictions across bounded document spans."],
  ["speech_act_detection", "pragmatics", "Classify request, report, quotation, example and command hypotheses."],
  ["request_intent_hypothesis", "pragmatics", "Propose intent without granting authority or execution."],
  ["uncertainty_expression", "pragmatics", "Capture hedging, confidence and missing-information cues."],
  ["commitment_strength", "pragmatics", "Estimate asserted, denied, quoted and hypothetical commitment."],
  ["translation_alignment", "crosslingual", "Align multilingual spans while preserving source and target meaning."],
  ["meaning_preservation", "crosslingual", "Compare translations for material semantic change."],
  ["false_friend_detection", "crosslingual", "Detect cross-language lexical collisions."],
  ["locale_pragmatic_shift", "crosslingual", "Detect audience and register shifts across locales."],
  ["concept_candidate_link", "ontology", "Propose stable concept links with mapping type and evidence."],
  ["ontology_constraint_check", "ontology", "Validate candidates against versioned ontology constraints."],
  ["unknown_concept_abstention", "ontology", "Abstain instead of inventing an unsupported concept."],
  ["prompt_injection_context", "security", "Separate executable-looking instructions from quoted or reported data."],
  ["source_trust_classification", "security", "Type policy, user, retrieved, tool and model-derived trust boundaries."],
  ["evidence_binding", "governance", "Bind claims and hypotheses to exact source spans and provenance."],
  ["confidence_calibration", "governance", "Calibrate confidence against measured outcomes."],
  ["ambiguity_register", "governance", "Persist unresolved ambiguity as an explicit review item."],
  ["source_freshness_check", "governance", "Require version and freshness for temporal or mutable evidence."],
  ["tenant_scope_check", "governance", "Prevent cross-tenant lexicon, glossary and evidence reuse."],
  ["claim_semantic_risk", "governance", "Evaluate claim meaning rather than substring presence alone."],
  ["meaning_change_risk", "governance", "Detect material meaning changes before publication or translation sync."],
  ["human_review_escalation", "governance", "Route genuine ambiguity to explicit review."],
  ["core_signal_compilation", "governance", "Compile bounded signals for Universal Core without producing a verdict."],
  ["web_source_quarantine", "research", "Keep web and retrieved instructions inert during evidence intake."],
  ["claim_source_alignment", "research", "Bind each distilled claim to exact independently evaluated sources."],
  ["distillation_candidate", "research", "Create tenant-scoped learning proposals from verified evidence only."],
  ["regression_corpus_update", "learning", "Propose verified false-positive and false-negative cases for regression."],
]);

const VIRTUAL_DIMENSIONS = Object.freeze({
  locale_family: ["it", "en", "es", "fr", "de", "pt", "multilingual", "unknown"],
  analysis_layer: ["morphology", "lexicon", "terminology", "syntax", "semantics", "discourse", "pragmatics", "crosslingual", "domain_ontology"],
  operation: ["normalize", "detect", "classify", "link", "disambiguate", "compare", "infer", "score", "explain", "verify"],
  domain_context: ["generic", "content", "commerce", "customer_support", "beauty_cosmetic", "software"],
  register: ["neutral", "brand", "marketing", "technical", "regulated"],
  audience: ["consumer", "professional", "internal"],
  evidence_mode: ["deterministic_plus_glossary", "source_backed"],
  output_form: ["spans", "annotations", "graph", "hypotheses", "alignment", "core_signals"],
});

const CAPABILITIES = Object.freeze(CAPABILITY_DEFINITIONS.map(([action_id, category, description]) => Object.freeze({
  capability_id: `lexical_semantic_intelligence.${action_id}`,
  action_id,
  category,
  description,
  authority: "advisory",
  execution_effect: "none",
  contract_version: 1,
})));

const DIMENSIONS = Object.freeze(Object.entries(VIRTUAL_DIMENSIONS).map(([dimension_id, values]) => Object.freeze({
  dimension_id,
  values: Object.freeze([...values]),
})));

const VIRTUAL_COMBINATION_COUNT = DIMENSIONS.reduce(
  (product, dimension) => product * BigInt(dimension.values.length),
  1n,
);

const CATALOG_CORE = Object.freeze({
  schema_version: LEXICAL_SEMANTIC_CATALOG_VERSION,
  branch_id: "lexical_semantic_intelligence",
  capabilities: CAPABILITIES,
  dimensions: DIMENSIONS,
});

const CATALOG_FINGERPRINT = crypto
  .createHash("sha256")
  .update(JSON.stringify(CATALOG_CORE))
  .digest("hex");

function boundedLimit(value, fallback, ceiling) {
  const numeric = Number(value ?? fallback);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, ceiling);
}

function decodeCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === "") return 0n;
  if (!/^\d+$/.test(String(cursor))) throw new RangeError("cursor must be a non-negative integer");
  return BigInt(cursor);
}

function nextCursor(offset, total) {
  return offset < total ? offset.toString() : null;
}

export function lexicalSemanticCatalogDescriptor() {
  return Object.freeze({
    schema_version: LEXICAL_SEMANTIC_CATALOG_VERSION,
    branch_id: "lexical_semantic_intelligence",
    fingerprint: CATALOG_FINGERPRINT,
    capability_count: CAPABILITIES.length,
    category_count: new Set(CAPABILITIES.map((item) => item.category)).size,
    virtual_dimension_count: DIMENSIONS.length,
    virtual_combination_count: VIRTUAL_COMBINATION_COUNT.toString(),
    taxonomy_depth: 30,
    virtual_depth_policy: "recursive_lazy_without_static_catalog_ceiling",
    expansion_mode: "lazy_deterministic_paged",
    runtime_policy: "bounded_materialization_only_under_core_owned_dtt",
    authority: "proposal_only",
    execution_effect: "none",
  });
}

export function lexicalSemanticCapabilityIds() {
  return CAPABILITIES.map((item) => item.action_id);
}

export function listLexicalSemanticCapabilities({ cursor = "0", limit = 25 } = {}) {
  const offset = decodeCursor(cursor);
  const pageLimit = boundedLimit(limit, 25, LEXICAL_SEMANTIC_CAPABILITY_PAGE_LIMIT);
  const total = BigInt(CAPABILITIES.length);
  const start = offset > total ? total : offset;
  const end = start + BigInt(pageLimit) > total ? total : start + BigInt(pageLimit);
  return {
    ...lexicalSemanticCatalogDescriptor(),
    cursor: start.toString(),
    next_cursor: nextCursor(end, total),
    page_limit: pageLimit,
    items: CAPABILITIES.slice(Number(start), Number(end)),
  };
}

function variantAt(index) {
  let remainder = index;
  const selection = {};
  for (let position = DIMENSIONS.length - 1; position >= 0; position -= 1) {
    const dimension = DIMENSIONS[position];
    const radix = BigInt(dimension.values.length);
    selection[dimension.dimension_id] = dimension.values[Number(remainder % radix)];
    remainder /= radix;
  }
  return Object.freeze({
    combination_id: `lexical_semantic_intelligence.virtual.${index.toString(36).padStart(8, "0")}`,
    ordinal: index.toString(),
    selection: Object.freeze(selection),
    materialized: false,
    authority: "proposal_only",
    execution_effect: "none",
  });
}

export function listVirtualLexicalSemanticVariants({ cursor = "0", limit = 20 } = {}) {
  const offset = decodeCursor(cursor);
  const pageLimit = boundedLimit(limit, 20, LEXICAL_SEMANTIC_VIRTUAL_PAGE_LIMIT);
  const start = offset > VIRTUAL_COMBINATION_COUNT ? VIRTUAL_COMBINATION_COUNT : offset;
  const end = start + BigInt(pageLimit) > VIRTUAL_COMBINATION_COUNT
    ? VIRTUAL_COMBINATION_COUNT
    : start + BigInt(pageLimit);
  const items = [];
  for (let index = start; index < end; index += 1n) items.push(variantAt(index));
  return {
    ...lexicalSemanticCatalogDescriptor(),
    cursor: start.toString(),
    next_cursor: nextCursor(end, VIRTUAL_COMBINATION_COUNT),
    page_limit: pageLimit,
    items,
  };
}

function normalizeWithOffsets(value) {
  const raw = String(value || "").slice(0, 32_768);
  const normalized = raw
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/[аеорсхуіј]/gi, (character) => ({
      а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i", ј: "j",
    })[character.toLowerCase()] || character)
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { raw, normalized };
}

const RISK_PATTERNS = Object.freeze({
  authority_override: [
    /\b(?:ignore|disregard|forget)\b.{0,80}\b(?:instructions?|rules?|policy|core|system)\b/i,
    /\b(?:ignora|dimentica|aggira|disabilita)\b.{0,80}\b(?:istruzioni|regole|policy|core|sistema)\b/i,
    /\b(?:ignora|olvida|omite)\b.{0,80}\b(?:instrucciones|reglas|pol[ií]tica|sistema)\b/i,
    /\b(?:ignor(?:e|ez)|oubli(?:e|ez)|contourn(?:e|ez)|désactiv(?:e|ez)|desactiv(?:e|ez))\b.{0,80}\b(?:instructions|règles|regles|politique|système|systeme)\b/i,
    /\b(?:ignorier(?:e|en|t)|missacht(?:e|en)|vergiss|umgeh(?:e|en))\b.{0,80}\b(?:anweisungen|regeln|richtlinie|system)\b/i,
    /\b(?:ignore|ignora|esqueça|esqueca|contorne|desative)\b.{0,80}\b(?:instruções|instrucoes|regras|política|politica|sistema)\b/i,
  ],
  secret_exfiltration: [
    /\b(?:reveal|print|dump|expose|send|return|show)\b.{0,80}\b(?:secret|token|password|api[ _-]?key|credentials?|environment variables?)\b/i,
    /\b(?:rivela|stampa|mostra|invia|restituisci)\b.{0,80}\b(?:segreti?|token|password|chiavi?|credenziali|variabili d ambiente)\b/i,
    /\b(?:revela|muestra|imprime|envía|envia)\b.{0,80}\b(?:secreto|token|contraseña|contrasena|clave api|credenciales)\b/i,
    /\b(?:révél(?:e|ez)|revel(?:e|ez)|montr(?:e|ez)|imprim(?:e|ez)|envoi(?:e|ez))\b.{0,80}\b(?:secret|jeton|mot de passe|clé api|cle api|identifiants)\b/i,
    /\b(?:enthüll(?:e|en)|enthull(?:e|en)|zeig(?:e|en)|druck(?:e|en)|sende)\b.{0,80}\b(?:geheimnis|passwort|token|api[ _-]?schlüssel|api[ _-]?schlussel|zugangsdaten)\b/i,
    /\b(?:revele|mostre|imprima|envie|retorne)\b.{0,80}\b(?:segredo|senha|token|chave api|credenciais)\b/i,
  ],
  tool_execution: [
    /\b(?:execute|run|invoke|call)\b.{0,60}\b(?:command|shell|tool|terminal|function)\b/i,
    /\b(?:esegui|lancia|invoca|chiama)\b.{0,60}\b(?:comando|shell|tool|terminale|funzione)\b/i,
    /\b(?:ejecuta|lanza|invoca)\b.{0,60}\b(?:comando|shell|herramienta|terminal|función|funcion)\b/i,
    /\b(?:exécute|execute|lance|invoque)\b.{0,60}\b(?:commande|shell|outil|terminal|fonction)\b/i,
    /\b(?:führ(?:e|en)|fuhr(?:e|en)|starte|rufe)\b.{0,60}\b(?:befehl|shell|werkzeug|terminal|funktion)\b/i,
    /\b(?:execute|rode|invoque|chame)\b.{0,60}\b(?:comando|shell|ferramenta|terminal|função|funcao)\b/i,
    /\b(?:rm\s+-rf|process\.env|curl\s+[^|]{0,180}\|\s*(?:sh|bash)|wget\s+[^|]{0,180}\|\s*(?:sh|bash))\b/i,
  ],
});

function riskFamilies(text) {
  return Object.entries(RISK_PATTERNS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(text)))
    .map(([family]) => family);
}

function looksQuotedOrReported(text) {
  const quotedSegments = [
    ...text.matchAll(/["'`«“]([^"'`»”]{4,})["'`»”]/gs),
    ...text.matchAll(/```([\s\S]{4,}?)```/g),
  ].map((match) => match[1] || "");
  const quoted = quotedSegments.some((segment) => riskFamilies(segment).length > 0);
  const reportCue = /\b(?:report|assessment|finding|example|documentation|quoted?|said|test|corpus|detector|incident|rapporto|valutazione|esempio|documentazione|citazione|test|incidente|informe|ejemplo|documentación|documentation|rapport|exemple|citation)\b/i;
  const reported = quoted && reportCue.test(text);
  const negated = /\b(?:do not|don't|never|must not|non|vietato|proibito|no se debe|ne pas|interdit)\b.{0,40}\b(?:execute|run|reveal|ignore|esegui|lancia|rivela|ignora|ejecuta|revela|exécute|revele)\b/i.test(text);
  return { quoted, reported, negated };
}

export function assessLexicalSemanticText({
  text,
  locale = "unknown",
  source_context = "untrusted_data",
  scope_salt = "",
} = {}) {
  const { raw, normalized } = normalizeWithOffsets(text);
  const matchedFamilies = riskFamilies(normalized);
  const context = looksQuotedOrReported(normalized);
  const ambiguousContext = matchedFamilies.length > 0 && (context.quoted || context.reported || context.negated);
  const disposition = matchedFamilies.length === 0
    ? "allow"
    : ambiguousContext
      ? "clarify"
      : "block";
  const textDigest = crypto.createHash("sha256").update(`${String(scope_salt || "")}\u0000${raw}`).digest("hex");
  return Object.freeze({
    schema_version: "lexical_semantic_assessment_v1",
    engine_version: LEXICAL_SEMANTIC_ENGINE_VERSION,
    catalog_fingerprint: CATALOG_FINGERPRINT,
    text_digest: textDigest,
    locale: String(locale || "unknown").slice(0, 64),
    source_context: String(source_context || "untrusted_data").slice(0, 80),
    disposition,
    risk_band: disposition === "block" ? "high" : disposition === "clarify" ? "ambiguous" : "none",
    matched_families: Object.freeze(matchedFamilies),
    context: Object.freeze(context),
    normalized_changed: raw !== normalized,
    raw_length: raw.length,
    normalized_length: normalized.length,
    requires_core_verdict: disposition !== "allow",
    explicit_confirmation_eligible: disposition === "clarify",
    grants_role: false,
    grants_tools: false,
    grants_authority: false,
    execution_effect: "none",
  });
}
