import crypto from "node:crypto";

const SCHEMA_VERSION = "core_research_directive_v1";
const HIGH_IMPACT_PATTERN = /\b(?:deploy|release|publish|pubblic\w*|merge|payment|pagament\w*|charge|delete|cancell\w*|drop|reset|production|produzione|medical|medic\w*|diagnos\w*|therapy|terapi\w*|legal|legale|regulator\w*|compliance|financial|finanzi\w*|investment|investiment\w*|privacy|security|sicurezza|credential\w*|credenzial\w*|secret|segreto|customer data|dati cliente)\b/i;
const TIME_SENSITIVE_PATTERN = /\b(?:today|current|latest|recent|price|law|regulation|version|release|news|schedule|deadline|oggi|attual|corrente|prezzo|legge|regolament|versione|notizi|scadenz)\w*/i;
const RESEARCH_INTENT_PATTERN = /\b(?:research|evidence|verify|validate|compare|benchmark|source|learn|study|ricerc\w*|evidenz\w*|verific\w*|valid\w*|confront\w*|font\w*|apprend\w*|studi\w*)\b/i;

function clean(value, max = 2_000) {
  return String(value || "")
    .slice(0, max)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_SECRET]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonical(value[key]);
    return result;
  }, {});
}

function directiveId(contract) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(canonical(contract))).digest("hex");
  return `crd_${digest.slice(0, 32)}`;
}

function normalizeEvidenceState(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const provided = Object.keys(input).length > 0;
  const sourceCount = Math.max(0, Math.floor(finiteNumber(input.source_count, 0)));
  const confidence = Math.max(0, Math.min(1, finiteNumber(input.confidence, sourceCount > 0 ? 0.5 : 0)));
  const freshnessState = clean(input.freshness_state || (input.stale === true ? "stale" : "unknown"), 40).toLowerCase();
  const contradictions = Math.max(0, Math.floor(finiteNumber(
    Array.isArray(input.contradictions) ? input.contradictions.length : input.contradiction_count,
    input.contradicted === true ? 1 : 0,
  )));
  return {
    provided,
    source_count: sourceCount,
    confidence,
    freshness_state: ["fresh", "aging", "stale", "unknown"].includes(freshnessState) ? freshnessState : "unknown",
    contradiction_count: contradictions,
    explicit_knowledge_gap: input.knowledge_gap === true || input.evidence_gap === true,
    high_impact: input.high_impact === true,
  };
}

export function assessCoreResearchNeed({
  requestText,
  operationType = "advisory_work",
  evidenceState = {},
} = {}) {
  const request = clean(requestText, 20_000);
  if (!request) throw new Error("core_research_request_required");
  const evidence = normalizeEvidenceState(evidenceState);
  const highImpact = evidence.high_impact || HIGH_IMPACT_PATTERN.test(`${request} ${clean(operationType, 100)}`);
  const timeSensitive = TIME_SENSITIVE_PATTERN.test(request);
  const researchIntent = RESEARCH_INTENT_PATTERN.test(request);
  const reasons = [];
  if (evidence.explicit_knowledge_gap || (evidence.provided && evidence.source_count === 0) || (!evidence.provided && (highImpact || researchIntent))) reasons.push("evidence_gap");
  if (evidence.freshness_state === "stale" || ((evidence.provided || highImpact || researchIntent) && timeSensitive && evidence.freshness_state !== "fresh")) reasons.push("freshness_gap");
  if (evidence.contradiction_count > 0) reasons.push("unresolved_contradiction");
  if ((evidence.provided || highImpact || researchIntent) && evidence.confidence < (highImpact ? 0.85 : 0.65)) reasons.push("confidence_below_threshold");
  if (highImpact) reasons.push("high_impact_decision");
  return {
    required: reasons.length > 0,
    reasons: uniqueSorted(reasons),
    high_impact: highImpact,
    time_sensitive: timeSensitive,
    research_intent: researchIntent,
    evidence,
    confidence_threshold: highImpact ? 0.85 : 0.65,
  };
}

export function buildCoreResearchDirective({
  tenantId,
  requestText,
  operationType = "advisory_work",
  evidenceState = {},
  selectedBranches = [],
  allowedDomains = [],
} = {}) {
  const tenant = clean(tenantId, 128);
  if (!tenant) throw new Error("core_research_tenant_required");
  const question = clean(requestText, 2_000);
  const assessment = assessCoreResearchNeed({ requestText: question, operationType, evidenceState });
  if (!assessment.required) return { assessment, directive: null };

  const minimumSources = assessment.high_impact ? 3 : 2;
  const freshnessDays = assessment.time_sensitive ? (assessment.high_impact ? 14 : 30) : 365;
  const branchIds = uniqueSorted([
    ...selectedBranches.map((item) => clean(item, 100).toLowerCase()),
    "research_evidence_intelligence",
    "quality_verification_intelligence",
    "adaptive_learning_intelligence",
  ]).slice(0, 50);
  const domains = uniqueSorted(allowedDomains.map((item) => clean(item, 253).toLowerCase())).slice(0, 20);
  const contract = {
    schema_version: SCHEMA_VERSION,
    tenant_scope: { tenant_id: tenant, cross_tenant: false },
    issued_by: "universal_core",
    status: "directive_issued_non_executing",
    trigger: assessment,
    questions: [
      { id: "primary", question, purpose: "resolve_core_identified_gap" },
      { id: "counterevidence", question: `Quali evidenze affidabili contraddicono o limitano: ${question}`, purpose: "preserve_contradictions_and_limits" },
      { id: "verification", question: `Quali fonti primarie verificano: ${question}`, purpose: "independent_primary_verification" },
    ],
    branches: {
      core_selected: branchIds,
      nyra_advisory: ["research_evidence", "risk_governance", "quality_verification", "learning_memory"],
      selection_authority: "universal_core",
    },
    source_policy: {
      https_only: true,
      minimum_independent_sources: minimumSources,
      preferred_source_types: assessment.high_impact
        ? ["regulator", "academic", "standards", "official"]
        : ["official", "academic", "standards", "news", "industry"],
      allowed_domains: domains,
      freshness_days: freshnessDays,
      full_page_storage_allowed: false,
      maximum_excerpt_characters: 1_200,
    },
    citation_contract: {
      required_per_factual_claim: true,
      provenance_required: true,
      publication_date_required_when_time_sensitive: assessment.time_sensitive,
      contradictions_must_be_preserved: true,
      uncertainty_must_be_explicit: true,
    },
    budget: {
      maximum_queries: assessment.high_impact ? 8 : 5,
      maximum_sources: assessment.high_impact ? 16 : 10,
      maximum_parallel_collectors: 2,
      maximum_elapsed_ms: assessment.high_impact ? 900_000 : 600_000,
    },
    deadline: {
      starts_at: "separate_core_execution_authorization",
      maximum_elapsed_ms: assessment.high_impact ? 900_000 : 600_000,
      expired_results_state: "candidate_requires_revalidation",
    },
    verification_criteria: {
      minimum_independent_sources: minimumSources,
      minimum_confidence: assessment.high_impact ? 0.85 : 0.65,
      fresh_sources_required: assessment.time_sensitive,
      authoritative_sources_required: assessment.high_impact ? 2 : 1,
      unsupported_facts_allowed: 0,
      unresolved_contradictions_allowed: 0,
      prompt_injection_review_required: true,
      tenant_scope_must_match: tenant,
    },
    lifecycle_contract: {
      stages: ["research", "evidence", "distill", "verify", "consolidate"],
      current_stage: "directive",
      transitions: [
        { from: "directive", to: "research", authority: "universal_core", separate_authorization_required: true },
        { from: "research", to: "evidence", authority: "evidence_collector", core_contract_required: true },
        { from: "evidence", to: "distill", authority: "nyra", evidence_validation_required: true },
        { from: "distill", to: "verify", authority: "universal_core", deterministic_criteria_required: true },
        { from: "verify", to: "consolidate", authority: "universal_core", explicit_promotion_authorization_required: true },
      ],
    },
    authority: {
      nyra_may_propose_questions: true,
      nyra_may_select_core_variant: false,
      ai_may_execute_without_core_authorization: false,
      research_execution_authorized: false,
      distillation_authorized: false,
      consolidation_authorized: false,
      global_promotion_authorized: false,
    },
  };
  return {
    assessment,
    directive: { directive_id: directiveId(contract), ...contract },
  };
}

export { SCHEMA_VERSION as CORE_RESEARCH_DIRECTIVE_VERSION };
