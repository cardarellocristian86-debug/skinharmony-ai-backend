import crypto from "node:crypto";
import net from "node:net";

const SOURCE_TYPES = new Set([
  "official",
  "regulator",
  "academic",
  "standards",
  "manufacturer",
  "news",
  "industry",
  "community",
  "other",
]);
const CLAIM_KINDS = new Set(["fact", "inference", "hypothesis"]);
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/,
  /\bSHX-[A-Z]+-[A-Za-z0-9_-]{12,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/i,
  /\b[A-Fa-f0-9]{40,}\b/,
];
const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|earlier) (?:instructions|messages|rules)/i,
  /(?:system|developer) (?:prompt|message|instructions)/i,
  /reveal (?:the )?(?:secret|token|password|api key|hidden prompt)/i,
  /(?:execute|run) (?:this |the )?(?:command|shell|code)/i,
  /do not trust (?:the )?(?:user|developer|system)/i,
  /override (?:the )?(?:policy|guardrail|instructions)/i,
  /ignora (?:tutte le )?(?:istruzioni|regole) (?:precedenti|iniziali)/i,
  /rivela (?:il |la |i )?(?:segreto|token|password|chiave api|prompt nascosto)/i,
  /(?:esegui|lancia) (?:questo |il )?(?:comando|shell|codice)/i,
];
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\d .()/-]{7,}\d)/;
const ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/i;

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function unique(values) {
  return [...new Set(values)];
}

function hasPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeText(value, name, max = 2_000, { required = true } = {}) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text && required) fail(`${name}_required`);
  if (!text) return "";
  if (text.length > max) fail(`${name}_too_long`, 413);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail(`${name}_invalid`);
  if (hasPattern(text, SECRET_PATTERNS)) fail("research_sensitive_content_rejected");
  text = text.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]").replace(PHONE_PATTERN, "[REDACTED_PHONE]");
  return text;
}

function normalizeIdentifier(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) fail(`${name}_invalid`);
  return id;
}

function privateHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || [".localhost", ".local", ".internal", ".home", ".lan"].some((suffix) => host.endsWith(suffix))) return true;
  if (net.isIP(host) === 6) {
    return host === "::" || host === "::1" || host.startsWith("::ffff:")
      || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^ff/.test(host) || /^2001:db8(?::|$)/.test(host);
  }
  if (host === "0.0.0.0") return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function publicHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (privateHostname(host) || net.isIP(host) !== 0 || host.length > 253 || !host.includes(".")) return false;
  if ([".test", ".example", ".invalid", ".onion"].some((suffix) => host.endsWith(suffix))) return false;
  return host.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    fail("research_source_url_invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    fail("research_source_url_rejected");
  }
  if (!publicHostname(parsed.hostname)) fail("research_source_host_rejected");
  parsed.hash = "";
  return parsed.toString();
}

function normalizeDomain(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  let hostname = raw;
  try {
    hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    fail("research_domain_invalid");
  }
  if (!publicHostname(hostname)) fail("research_domain_rejected");
  return hostname;
}

function temporalClass(question) {
  const value = question.toLowerCase();
  return /(oggi|attual|corrente|latest|recent|prezzo|legge|regolament|versione|release|news|notizi|calendario|scadenz)/.test(value)
    ? "time_sensitive"
    : "durable";
}

function riskClass(question) {
  const value = question.toLowerCase();
  return /(medic|diagnos|terapi|farmac|salute|legale|regolator|compliance|finanzi|investiment|sicurezza|privacy|credenzial|claim cosmet)/.test(value)
    ? "high"
    : /(prezzo|contratt|business|strateg|benchmark|mercato)/.test(value) ? "medium" : "low";
}

function sourceAuthority(sourceType, hostname) {
  const base = {
    official: 88,
    regulator: 96,
    academic: 90,
    standards: 94,
    manufacturer: 72,
    news: 62,
    industry: 54,
    community: 32,
    other: 24,
  }[sourceType] || 20;
  const domainBonus = /(?:^|\.)(?:gov|edu)\.[a-z]{2,}$/.test(hostname) || /(?:^|\.)europa\.eu$/.test(hostname) ? 4 : 0;
  return Math.min(100, base + domainBonus);
}

function dateAssessment(value, now, freshnessDays) {
  if (!value) return { published_at: null, freshness_state: "unknown", freshness_score: 35 };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + 86_400_000) fail("research_source_published_at_invalid");
  const ageDays = Math.max(0, (now.getTime() - parsed.getTime()) / 86_400_000);
  if (ageDays <= freshnessDays) return { published_at: parsed.toISOString(), freshness_state: "fresh", freshness_score: 100 };
  if (ageDays <= freshnessDays * 3) return { published_at: parsed.toISOString(), freshness_state: "aging", freshness_score: 60 };
  return { published_at: parsed.toISOString(), freshness_state: "stale", freshness_score: 20 };
}

function planQueries(question, risk, temporal) {
  const suffix = temporal === "time_sensitive" ? " current official source" : " authoritative evidence";
  const candidates = [
    { purpose: "primary_evidence", query: `${question}${suffix}` },
    { purpose: "independent_confirmation", query: `${question} independent review evidence` },
    { purpose: "contradictions_and_limits", query: `${question} limitations contradictions` },
    ...(risk === "high" ? [{ purpose: "regulatory_or_academic", query: `${question} regulator academic standard` }] : []),
  ];
  return unique(candidates.map((item) => `${item.purpose}\u0000${item.query.slice(0, 500)}`)).map((entry, index) => {
    const [purpose, query] = entry.split("\u0000");
    return { id: `rq_${index + 1}`, purpose, query };
  });
}

export function buildResearchPlan(input = {}, options = {}) {
  const question = normalizeText(input.question || input.query || input.request, "research_question", 2_000);
  const decisionContext = normalizeText(input.decision_context, "decision_context", 1_000, { required: false });
  const risk = riskClass(`${question} ${decisionContext}`);
  const temporal = temporalClass(question);
  const minimumSources = risk === "high" ? 3 : 2;
  const freshnessDays = temporal === "time_sensitive" ? (risk === "high" ? 14 : 30) : 365;
  const allowedDomains = unique((Array.isArray(input.allowed_domains) ? input.allowed_domains : [])
    .slice(0, 20)
    .map(normalizeDomain)
    .filter(Boolean));
  return {
    schema_version: "core_research_plan_v1",
    plan_id: `rp_${crypto.randomUUID()}`,
    created_at: (options.now || new Date()).toISOString(),
    question,
    decision_context: decisionContext || null,
    classification: {
      risk,
      temporal,
      high_stakes: risk === "high",
    },
    queries: planQueries(question, risk, temporal),
    source_policy: {
      https_only: true,
      minimum_independent_sources: minimumSources,
      preferred_source_types: risk === "high"
        ? ["regulator", "academic", "standards", "official"]
        : ["official", "academic", "standards", "news", "industry"],
      allowed_domains: allowedDomains,
      freshness_days: freshnessDays,
      full_page_storage_allowed: false,
      maximum_excerpt_characters: 1_200,
    },
    evidence_contract: {
      claim_kinds: [...CLAIM_KINDS],
      provenance_required: true,
      published_at_required_for_time_sensitive_claims: temporal === "time_sensitive",
      contradictions_must_be_preserved: true,
      uncertainty_must_be_explicit: true,
    },
    workflow: [
      "connected_ai_or_curated_collector_searches_web",
      "sanitize_and_capture_provenance",
      "core_validates_claim_evidence_graph",
      "store_as_tenant_candidate_or_quarantine",
      "authorized_review_before_validation",
      "validated_tenant_memory_only_after_review",
    ],
    provider_order: ["connected_ai_web", "curated_collectors", "openai_optional_fallback"],
    nyra_branches: ["research_evidence", "risk_governance", "quality_verification", "learning_memory"],
    core_branches: ["research_evidence_intelligence", "quality_verification_intelligence", "adaptive_learning_intelligence"],
    execution_authorized: false,
  };
}

export function validateResearchEvidence(input = {}, options = {}) {
  const now = options.now || new Date();
  const question = normalizeText(input.question || input.query, "research_question", 2_000);
  const risk = riskClass(question);
  const temporal = temporalClass(question);
  const planPolicy = input.plan?.source_policy && typeof input.plan.source_policy === "object" ? input.plan.source_policy : {};
  const riskMinimumSources = risk === "high" ? 3 : 2;
  const riskFreshnessDays = temporal === "time_sensitive" ? (risk === "high" ? 14 : 30) : 365;
  const minimumSources = Math.max(riskMinimumSources, Math.round(boundedNumber(planPolicy.minimum_independent_sources, riskMinimumSources, 1, 10)));
  const freshnessDays = Math.min(riskFreshnessDays, Math.round(boundedNumber(planPolicy.freshness_days, riskFreshnessDays, 1, 3_650)));
  const allowedDomains = unique((Array.isArray(planPolicy.allowed_domains) ? planPolicy.allowed_domains : []).slice(0, 20).map(normalizeDomain).filter(Boolean));
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 20) fail("research_sources_invalid");
  if (!Array.isArray(input.claims) || input.claims.length < 1 || input.claims.length > 30) fail("research_claims_invalid");

  const sourceIds = new Set();
  let injectionCount = 0;
  let sensitiveCount = 0;
  const sourceAssessments = input.sources.map((source) => {
    const sourceId = normalizeIdentifier(source?.id, "research_source_id");
    if (sourceIds.has(sourceId)) fail("research_source_id_duplicate");
    sourceIds.add(sourceId);
    const url = normalizeUrl(source?.url);
    const hostname = new URL(url).hostname.toLowerCase();
    if (allowedDomains.length && !allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      fail("research_source_domain_not_allowed");
    }
    const sourceType = String(source?.source_type || "other").trim().toLowerCase();
    if (!SOURCE_TYPES.has(sourceType)) fail("research_source_type_invalid");
    const inspected = [source?.title, source?.publisher, source?.excerpt, source?.summary].map((value) => String(value || "")).join(" ");
    if (hasPattern(inspected, SECRET_PATTERNS)) fail("research_sensitive_content_rejected");
    const promptInjection = hasPattern(inspected, PROMPT_INJECTION_PATTERNS);
    const sensitive = EMAIL_PATTERN.test(inspected) || PHONE_PATTERN.test(inspected);
    if (promptInjection) injectionCount += 1;
    if (sensitive) sensitiveCount += 1;
    const temporalAssessment = dateAssessment(source?.published_at, now, freshnessDays);
    return {
      source_id: sourceId,
      hostname,
      source_type: sourceType,
      authority_score: sourceAuthority(sourceType, hostname),
      ...temporalAssessment,
      prompt_injection_detected: promptInjection,
      sensitive_content_detected: sensitive,
    };
  });

  const claimIds = new Set();
  const claimInputs = input.claims.map((claim) => {
    const claimId = normalizeIdentifier(claim?.id, "research_claim_id");
    if (claimIds.has(claimId)) fail("research_claim_id_duplicate");
    claimIds.add(claimId);
    const kind = String(claim?.kind || "fact").trim().toLowerCase();
    if (!CLAIM_KINDS.has(kind)) fail("research_claim_kind_invalid");
    const text = normalizeText(claim?.text, "research_claim_text", 2_000);
    const references = unique((Array.isArray(claim?.source_ids) ? claim.source_ids : []).map((id) => normalizeIdentifier(id, "research_claim_source_id")));
    if (references.some((id) => !sourceIds.has(id))) fail("research_claim_source_unknown");
    const contradicts = unique((Array.isArray(claim?.contradicts_claim_ids) ? claim.contradicts_claim_ids : []).map((id) => normalizeIdentifier(id, "research_contradiction_id")));
    if (hasPattern(text, PROMPT_INJECTION_PATTERNS)) injectionCount += 1;
    return { claimId, kind, references, contradicts, confidence: boundedNumber(claim?.confidence, kind === "fact" ? 0.7 : 0.5, 0, 1) };
  });
  for (const claim of claimInputs) {
    if (claim.contradicts.some((id) => !claimIds.has(id) || id === claim.claimId)) fail("research_contradiction_invalid");
  }

  const sourceById = new Map(sourceAssessments.map((source) => [source.source_id, source]));
  const claimAssessments = claimInputs.map((claim) => {
    const authorities = claim.references.map((id) => sourceById.get(id)?.authority_score || 0);
    const uniqueHosts = unique(claim.references.map((id) => sourceById.get(id)?.hostname || "").filter(Boolean));
    const supportScore = claim.references.length
      ? Math.min(100, authorities.reduce((sum, score) => sum + score, 0) / authorities.length + Math.min(20, (uniqueHosts.length - 1) * 10))
      : 0;
    return {
      claim_id: claim.claimId,
      kind: claim.kind,
      source_count: claim.references.length,
      independent_host_count: uniqueHosts.length,
      support_score: Math.round(supportScore),
      declared_confidence: Number(claim.confidence.toFixed(2)),
      contradictions: claim.contradicts,
      state: !claim.references.length ? "unsupported" : claim.contradicts.length ? "contested" : supportScore >= 70 ? "supported" : "weak_support",
    };
  });

  const contradictionPairs = unique(claimInputs.flatMap((claim) => claim.contradicts.map((other) => [claim.claimId, other].sort().join(":"))));
  const hosts = unique(sourceAssessments.map((source) => source.hostname));
  const authoritativeCount = sourceAssessments.filter((source) => source.authority_score >= 80).length;
  const unsupportedFacts = claimAssessments.filter((claim) => claim.kind === "fact" && claim.source_count === 0).length;
  const authorityAverage = sourceAssessments.reduce((sum, source) => sum + source.authority_score, 0) / sourceAssessments.length;
  const freshnessAverage = sourceAssessments.reduce((sum, source) => sum + source.freshness_score, 0) / sourceAssessments.length;
  const supportAverage = claimAssessments.reduce((sum, claim) => sum + claim.support_score, 0) / claimAssessments.length;
  const triangulation = Math.min(100, hosts.length / minimumSources * 100);
  const qualityScore = Math.max(0, Math.min(100, Math.round(
    authorityAverage * 0.3 + freshnessAverage * 0.2 + supportAverage * 0.3 + triangulation * 0.2
    - injectionCount * 60 - sensitiveCount * 30 - contradictionPairs.length * 5,
  )));

  const missing = [];
  if (hosts.length < minimumSources) missing.push("independent_sources");
  if (risk === "high" && authoritativeCount < 2) missing.push("authoritative_sources");
  if (temporal === "time_sensitive" && sourceAssessments.some((source) => source.freshness_state === "unknown")) missing.push("publication_dates");
  if (temporal === "time_sensitive" && sourceAssessments.some((source) => source.freshness_state !== "fresh")) missing.push("fresh_sources");
  if (unsupportedFacts) missing.push("fact_provenance");
  if (contradictionPairs.length) missing.push("contradiction_resolution");
  if (injectionCount) missing.push("prompt_injection_review");
  if (sensitiveCount) missing.push("sensitive_content_review");
  if (qualityScore < 65) missing.push("quality_threshold");
  const quarantined = injectionCount > 0 || sensitiveCount > 0 || unsupportedFacts > 0;
  const eligibleForReview = !quarantined && missing.length === 0;

  return {
    schema_version: "core_research_validation_v1",
    validation_id: `rv_${crypto.randomUUID()}`,
    validated_at: now.toISOString(),
    state: quarantined ? "quarantined" : "candidate",
    quality_score: qualityScore,
    confidence_band: qualityScore >= 85 ? "high" : qualityScore >= 65 ? "medium" : "low",
    effective_policy: {
      minimum_independent_sources: minimumSources,
      freshness_days: freshnessDays,
      allowed_domains: allowedDomains,
      client_policy_cannot_weaken_risk_floor: true,
    },
    source_count: sourceAssessments.length,
    independent_host_count: hosts.length,
    authoritative_source_count: authoritativeCount,
    source_assessments: sourceAssessments,
    claim_assessments: claimAssessments,
    contradictions: contradictionPairs.map((pair) => ({ claim_ids: pair.split(":"), state: "unresolved" })),
    threat_assessment: {
      prompt_injection_count: injectionCount,
      sensitive_content_count: sensitiveCount,
      secret_content_count: 0,
    },
    release_readiness: {
      eligible_for_tenant_review: eligibleForReview,
      missing,
      automatic_validation_allowed: false,
      global_promotion_allowed: false,
    },
    guardrail: {
      tenant_scope_required: true,
      raw_page_storage_allowed: false,
      execution_authorized: false,
      policy_activation_authorized: false,
    },
  };
}

export { CLAIM_KINDS, PROMPT_INJECTION_PATTERNS, SOURCE_TYPES };
