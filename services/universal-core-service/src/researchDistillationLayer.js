import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { CORE_RESEARCH_DIRECTIVE_VERSION } from "./coreResearchDirective.js";
import { nyraBranchCatalog } from "./nyraBranchNetwork.js";
import { validateResearchEvidence } from "./researchCortex.js";

export const RESEARCH_DISTILLATION_SCHEMA_VERSION = "nyra_research_distillation_layer_v1";
export const TRUSTED_SOURCE_REGISTRY_VERSION = "nyra_trusted_source_registry_v1";
export const BRANCH_LEARNING_PACK_SCHEMA_VERSION = "nyra_branch_learning_pack_v1";
export const RESEARCH_AUTHORIZATION_ENVELOPE_VERSION = "nyra_core_research_authorization_envelope_v1";
export const EVIDENCE_WORKSPACE_SCHEMA_VERSION = "nyra_ephemeral_evidence_workspace_v1";
export const LEARNING_CANDIDATE_SCHEMA_VERSION = "nyra_learning_candidate_v1";
export const VERIFIED_LEARNING_SCHEMA_VERSION = "nyra_verified_learning_memory_v1";
export const RESEARCH_DISTILLATION_POLICY_VERSION = "nyra_research_distillation_policy_v1";

const BASE_MODE = new Set(["off", "shadow", "advisory", "active"]);
const SOURCE_TYPE = Object.freeze({
  OFFICIAL: "official_documentation",
  REGULATOR: "regulatory_source",
  ACADEMIC: "peer_reviewed",
  STANDARDS: "standards_body",
  VENDOR: "vendor_primary",
  SCIENTIFIC: "scientific_database",
  DATASET: "authorized_dataset",
});

const DEFAULT_SOURCES = Object.freeze([
  {
    source_id: "pubmed",
    name: "PubMed",
    base_url: "https://pubmed.ncbi.nlm.nih.gov",
    allowed_domains: ["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov"],
    source_type: SOURCE_TYPE.SCIENTIFIC,
    branch_bindings: ["research_evidence", "decision_reasoning", "quality_verification", "learning_memory", "adaptive_learning", "software_intelligence"],
    reliability_score: 0.96,
    freshness_policy_days: 30,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "crossref",
    name: "Crossref",
    base_url: "https://www.crossref.org",
    allowed_domains: ["crossref.org", "api.crossref.org"],
    source_type: SOURCE_TYPE.SCIENTIFIC,
    branch_bindings: ["research_evidence", "decision_reasoning", "quality_verification", "learning_memory", "adaptive_learning"],
    reliability_score: 0.94,
    freshness_policy_days: 30,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "clinicaltrials",
    name: "ClinicalTrials.gov",
    base_url: "https://clinicaltrials.gov",
    allowed_domains: ["clinicaltrials.gov"],
    source_type: SOURCE_TYPE.REGULATOR,
    branch_bindings: ["research_evidence", "quality_verification", "risk_governance", "decision_reasoning"],
    reliability_score: 0.93,
    freshness_policy_days: 30,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "eur_lex",
    name: "EUR-Lex",
    base_url: "https://eur-lex.europa.eu",
    allowed_domains: ["eur-lex.europa.eu", "europa.eu"],
    source_type: SOURCE_TYPE.REGULATOR,
    branch_bindings: ["research_evidence", "risk_governance", "delegated_authority", "decision_provenance", "quality_verification"],
    reliability_score: 0.98,
    freshness_policy_days: 30,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "ec_commission",
    name: "European Commission",
    base_url: "https://commission.europa.eu",
    allowed_domains: ["commission.europa.eu", "ec.europa.eu", "europa.eu"],
    source_type: SOURCE_TYPE.OFFICIAL,
    branch_bindings: ["research_evidence", "risk_governance", "decision_reasoning", "communication_explanation", "quality_verification"],
    reliability_score: 0.96,
    freshness_policy_days: 60,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "cosing",
    name: "EU CosIng",
    base_url: "https://ec.europa.eu/growth/tools-databases/cosing/",
    allowed_domains: ["ec.europa.eu", "europa.eu"],
    source_type: SOURCE_TYPE.REGULATOR,
    branch_bindings: ["research_evidence", "risk_governance", "quality_verification", "analyzer_domain"],
    reliability_score: 0.95,
    freshness_policy_days: 90,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "sccs",
    name: "Scientific Committee on Consumer Safety",
    base_url: "https://health.ec.europa.eu/scientific-committees/scientific-committee-consumer-safety-sccs_en",
    allowed_domains: ["health.ec.europa.eu", "ec.europa.eu", "europa.eu"],
    source_type: SOURCE_TYPE.REGULATOR,
    branch_bindings: ["research_evidence", "risk_governance", "quality_verification", "analyzer_domain"],
    reliability_score: 0.95,
    freshness_policy_days: 90,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "echa",
    name: "ECHA",
    base_url: "https://echa.europa.eu",
    allowed_domains: ["echa.europa.eu", "europa.eu"],
    source_type: SOURCE_TYPE.REGULATOR,
    branch_bindings: ["research_evidence", "risk_governance", "quality_verification", "software_intelligence"],
    reliability_score: 0.96,
    freshness_policy_days: 60,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "wipo",
    name: "WIPO",
    base_url: "https://www.wipo.int",
    allowed_domains: ["wipo.int"],
    source_type: SOURCE_TYPE.OFFICIAL,
    branch_bindings: ["research_evidence", "risk_governance", "decision_provenance", "software_intelligence"],
    reliability_score: 0.93,
    freshness_policy_days: 120,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "euipo",
    name: "EUIPO",
    base_url: "https://euipo.europa.eu",
    allowed_domains: ["euipo.europa.eu", "europa.eu"],
    source_type: SOURCE_TYPE.OFFICIAL,
    branch_bindings: ["research_evidence", "risk_governance", "decision_provenance", "software_intelligence"],
    reliability_score: 0.93,
    freshness_policy_days: 120,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "nist",
    name: "NIST",
    base_url: "https://www.nist.gov",
    allowed_domains: ["nist.gov"],
    source_type: SOURCE_TYPE.OFFICIAL,
    branch_bindings: ["research_evidence", "planning_prioritization", "quality_verification", "software_intelligence", "decision_reasoning"],
    reliability_score: 0.95,
    freshness_policy_days: 90,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "vendor_docs",
    name: "Official Vendor Documentation",
    base_url: "https://example.vendor.invalid",
    allowed_domains: ["example.vendor.invalid"],
    source_type: SOURCE_TYPE.VENDOR,
    branch_bindings: ["research_evidence", "planning_prioritization", "software_intelligence", "quality_verification", "communication_explanation"],
    reliability_score: 0.75,
    freshness_policy_days: 45,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
  {
    source_id: "authorised_dataset",
    name: "Authorised Dataset Registry",
    base_url: "https://example.dataset.invalid",
    allowed_domains: ["example.dataset.invalid"],
    source_type: SOURCE_TYPE.DATASET,
    branch_bindings: ["research_evidence", "quality_verification", "learning_memory", "adaptive_learning"],
    reliability_score: 0.88,
    freshness_policy_days: 90,
    citation_required: true,
    license_policy: "metadata_only",
    allowed_operations: ["search", "fetch_document"],
    blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
    status: "active",
  },
]);

const VERTICAL_BRANCH_FOCUS = Object.freeze({
  beauty_market: ["ec_commission", "eur_lex", "cosing", "sccs", "echa", "pubmed", "vendor_docs"],
  cosmetic_chemistry: ["cosing", "sccs", "echa", "pubmed", "crossref", "vendor_docs"],
  skinharmony_analyzer: ["cosing", "sccs", "pubmed", "crossref", "vendor_docs"],
  scalp_analyzer: ["pubmed", "crossref", "clinicaltrials", "vendor_docs"],
  nyra_finance_beauty_test: ["ec_commission", "eur_lex", "nist", "crossref"],
  beauty_value_chain_guard: ["ec_commission", "eur_lex", "echa", "wipo", "euipo"],
  beauty_protocol_guard: ["cosing", "sccs", "echa", "ec_commission"],
  beauty_vertical_orchestration: ["ec_commission", "nist", "vendor_docs", "crossref"],
  suite_domain: ["ec_commission", "nist", "vendor_docs"],
  smartdesk_domain: ["nist", "vendor_docs", "crossref"],
  analyzer_domain: ["cosing", "sccs", "pubmed", "crossref", "vendor_docs"],
});

const GENERIC_BINDINGS = Object.freeze(["ec_commission", "nist", "crossref"]);

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function strictBoolean(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name}_invalid`);
}

function firstNonBlank(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function listify(value, limit = 50) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, limit).map((item) => String(item || "").trim()).filter(Boolean))];
}

function csvList(value, limit = 50) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
}

function boundedNumber(value, fallback, minimum, maximum, { integer = false } = {}) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  const bounded = Math.max(minimum, Math.min(maximum, safe));
  return integer ? Math.floor(bounded) : bounded;
}

function requestedBudget(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error("research_budget_exceeded");
  return Math.floor(parsed);
}

function cleanText(value, max = 2_000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_SECRET]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]");
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function nowIso(now = new Date()) {
  return new Date(now).toISOString();
}

function normalizedDate(value, errorCode, { fallback = null, now = null, futureToleranceMs = 86_400_000 } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(errorCode);
  if (now && parsed.getTime() > now.getTime() + futureToleranceMs) throw new Error(errorCode);
  return parsed.toISOString();
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
  if (!host || privateHostname(host) || net.isIP(host) !== 0 || host.length > 253 || !host.includes(".")) return false;
  if ([".test", ".example", ".invalid", ".onion"].some((suffix) => host.endsWith(suffix))) return false;
  return host.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error("research_source_url_invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    throw new Error("research_source_url_rejected");
  }
  if (!publicHostname(parsed.hostname)) throw new Error("research_source_host_rejected");
  parsed.hash = "";
  return parsed.toString();
}

function inferBranchFamily(branchId) {
  const id = String(branchId || "");
  if (["research_evidence", "decision_reasoning", "planning_prioritization", "quality_verification", "software_intelligence"].includes(id)) return "high_rigor";
  if (["risk_governance", "delegated_authority", "decision_provenance"].includes(id)) return "governance";
  if (["learning_memory", "adaptive_learning"].includes(id)) return "learning";
  if (["execution_planning", "parallel_coordination", "communication_explanation", "work_intake", "context_intelligence"].includes(id)) return "operational";
  return "vertical";
}

function learningPackRules(branchId) {
  const family = inferBranchFamily(branchId);
  const common = [
    "Universal Core retains final authority.",
    "Temporary research material may not be promoted automatically.",
    "Evidences and counterevidences must retain provenance.",
    "No raw chain-of-thought is persisted.",
  ];
  if (family === "high_rigor") return [...common, "Prefer official, scientific, regulatory, and standards sources.", "Reject low provenance or stale evidence."];
  if (family === "governance") return [...common, "Prefer regulatory, standards, and official sources.", "Block side effects and cross-tenant leakage."];
  if (family === "learning") return [...common, "Only verified outcome may create a candidate lesson.", "Learning requires explicit verification and regression."];
  if (family === "operational") return [...common, "Prefer vendor and official sources for implementation context.", "Keep execution advisory until Core authorizes."];
  return [...common, "Use vertical official sources when domain-bound.", "Respect license, citation, and tenant scoping."];
}

function sourceBindingsFor(branchId) {
  if (VERTICAL_BRANCH_FOCUS[branchId]) return [...VERTICAL_BRANCH_FOCUS[branchId]];
  if (branchId === "research_evidence") return DEFAULT_SOURCES.map((source) => source.source_id);
  return [...GENERIC_BINDINGS];
}

function findSourceById(sourceId) {
  return DEFAULT_SOURCES.find((source) => source.source_id === sourceId) || null;
}

function sourceRegistry(branches = []) {
  return {
    schema_version: TRUSTED_SOURCE_REGISTRY_VERSION,
    registry_id: `trusted_sources_${stableHash(JSON.stringify(branches.map((branch) => branch.id))).slice(0, 16)}`,
    version: TRUSTED_SOURCE_REGISTRY_VERSION,
    generated_at: nowIso(),
    license_policy: "metadata_only",
    branch_source_policy: {
      citation_required: true,
      freshness_review_required: true,
      allowed_operations: ["search", "fetch_document"],
      blocked_operations: ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
      fail_closed_on_unknown_source: true,
    },
    sources: DEFAULT_SOURCES.map((source) => ({
      ...source,
      branch_bindings: [...source.branch_bindings],
      allowed_domains: [...source.allowed_domains],
      allowed_operations: [...source.allowed_operations],
      blocked_operations: [...source.blocked_operations],
    })),
    branch_bindings: Object.fromEntries(branches.map((branch) => [branch.id, sourceBindingsFor(branch.id)])),
  };
}

function learningPackForBranch(branch, registryVersion) {
  const sourceIds = sourceBindingsFor(branch.id);
  const capability = Array.isArray(branch.subbranches) ? branch.subbranches.slice(0, 4) : [];
  return {
    manifest: {
      branch_id: branch.id,
      version: "1.0.0",
      description: branch.label,
      domain: branch.domain || "generic",
      capability: branch.work_phase || "general",
      policy: "universal_core_final_authority",
      catalog_version: "nyra_neural_branch_network_v1",
      source_registry_version: registryVersion,
      last_reviewed_at: nowIso(),
      owner: "universal_core",
      risk_level: inferBranchFamily(branch.id) === "governance" ? "high" : inferBranchFamily(branch.id) === "high_rigor" ? "medium" : "low",
      retention: "verified_only",
      compatibility: ["V1", "V2", "DTT"],
    },
    ontology: {
      branch_id: branch.id,
      branch_label: branch.label,
      initial_capabilities: capability,
      branch_family: inferBranchFamily(branch.id),
    },
    rules: learningPackRules(branch.id),
    verified_knowledge: [],
    examples: [],
    counterexamples: [],
    evals: [],
    sources: sourceIds,
    source_records: sourceIds.map((sourceId) => findSourceById(sourceId)).filter(Boolean),
    verified_outcomes: [],
  };
}

function buildLearningPacks(branches, registryVersion = TRUSTED_SOURCE_REGISTRY_VERSION) {
  const sourceRegistryValue = sourceRegistry(branches);
  return {
    schema_version: BRANCH_LEARNING_PACK_SCHEMA_VERSION,
    generated_at: nowIso(),
    registry_version: registryVersion,
    packs: branches.map((branch) => ({
      branch_id: branch.id,
      ...learningPackForBranch(branch, registryVersion),
    })),
    source_registry: sourceRegistryValue,
  };
}

function parseResearchDistillationConfig(env = process.env) {
  const enabled = strictBoolean(
    firstNonBlank(env.NYRA_RESEARCH_DISTILLATION_ENABLED, env.CORE_RESEARCH_DISTILLATION_ENABLED),
    false,
    "research_distillation_enabled",
  );
  const rawMode = String(firstNonBlank(
    env.NYRA_RESEARCH_DISTILLATION_MODE,
    env.CORE_RESEARCH_DISTILLATION_MODE,
  ) || "off").trim().toLowerCase();
  const mode = BASE_MODE.has(rawMode) ? rawMode : "off";
  const maxDocuments = boundedNumber(firstNonBlank(env.NYRA_RESEARCH_MAX_DOCUMENTS, env.CORE_RESEARCH_MAX_DOCUMENTS), 10, 1, 20, { integer: true });
  const maxBytes = boundedNumber(firstNonBlank(env.NYRA_RESEARCH_MAX_BYTES, env.CORE_RESEARCH_MAX_BYTES), 2_000_000, 10_000, 20_000_000, { integer: true });
  const timeoutMs = boundedNumber(firstNonBlank(env.NYRA_RESEARCH_TIMEOUT_MS, env.CORE_RESEARCH_TIMEOUT_MS), 30_000, 1_000, 120_000, { integer: true });
  const cacheTtlSeconds = boundedNumber(firstNonBlank(env.NYRA_RESEARCH_CACHE_TTL_SECONDS, env.CORE_RESEARCH_CACHE_TTL_SECONDS), 3_600, 60, 86_400, { integer: true });
  const tenantAllowlist = csvList(firstNonBlank(
    env.NYRA_RESEARCH_TENANT_ALLOWLIST,
    env.CORE_RESEARCH_TENANT_ALLOWLIST,
  ));
  const distillationRequiresReview = strictBoolean(
    firstNonBlank(env.NYRA_DISTILLATION_REQUIRES_REVIEW, env.CORE_DISTILLATION_REQUIRES_REVIEW),
    true,
    "distillation_requires_review",
  );
  return {
    schema_version: RESEARCH_DISTILLATION_POLICY_VERSION,
    enabled,
    mode,
    max_documents: maxDocuments,
    max_bytes: maxBytes,
    max_duration_ms: timeoutMs,
    cache_ttl_seconds: cacheTtlSeconds,
    tenant_allowlist: tenantAllowlist,
    distillation_requires_review: distillationRequiresReview,
    default_retention_mode: "ephemeral",
  };
}

function validateTenant(config, tenantId) {
  if (!tenantId) return { ok: false, error: "research_tenant_required" };
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(tenantId)) return { ok: false, error: "research_tenant_invalid" };
  if (!config.tenant_allowlist.length) return { ok: false, error: "research_tenant_allowlist_required" };
  if (!config.tenant_allowlist.includes(tenantId)) {
    return { ok: false, error: "research_tenant_not_allowlisted" };
  }
  return { ok: true };
}

function validateBranchIds(branchIds, registry) {
  const known = new Set(Object.keys(registry.branch_bindings || {}));
  const selected = listify(branchIds, 24);
  if (!selected.length) return { ok: false, error: "research_branch_ids_required" };
  const unknown = selected.filter((id) => !known.has(id));
  if (unknown.length) return { ok: false, error: "research_branch_unknown" };
  const allowed = selected.filter((id) => registry.branch_bindings[id]);
  return { ok: true, value: allowed.length ? allowed : selected };
}

function hostAllowed(url, allowedDomains = []) {
  const normalized = normalizeUrl(url);
  const hostname = new URL(normalized).hostname.toLowerCase();
  return !allowedDomains.length || allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function evidenceDirection(text) {
  const value = String(text || "").toLowerCase();
  if (/\bagainst\b|\bcontra\b|\bnot supported\b|\bnon supportato\b/.test(value)) return "against";
  if (/\bsupport\b|\bsupports\b|\bconfirms\b|\bsupporta\b|\bconferma\b/.test(value)) return "support";
  return "neutral";
}

function validationSourceType(sourceType) {
  return {
    [SOURCE_TYPE.OFFICIAL]: "official",
    [SOURCE_TYPE.REGULATOR]: "regulator",
    [SOURCE_TYPE.ACADEMIC]: "academic",
    [SOURCE_TYPE.STANDARDS]: "standards",
    [SOURCE_TYPE.VENDOR]: "manufacturer",
    [SOURCE_TYPE.SCIENTIFIC]: "academic",
    [SOURCE_TYPE.DATASET]: "other",
  }[sourceType] || "other";
}

function normalizeEvidenceItem(input, context = {}) {
  const current = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
  const branchIds = Array.isArray(context.branchIds) ? context.branchIds : [];
  const source = findSourceById(String(input?.source_id || input?.sourceId || "").trim());
  if (!source) throw new Error("research_source_unknown");
  if (!source.status || source.status !== "active") throw new Error("research_source_inactive");
  if (Array.isArray(context.allowedSourceIds) && context.allowedSourceIds.length && !context.allowedSourceIds.includes(source.source_id)) {
    throw new Error("research_source_not_authorized");
  }
  const canonicalUrl = normalizeUrl(input?.canonical_url || input?.url || source.base_url);
  if (!hostAllowed(canonicalUrl, source.allowed_domains)) throw new Error("research_source_domain_not_allowed");
  const title = cleanText(input?.title || input?.name || "Untitled evidence", 400);
  const claimSummary = cleanText(input?.claim_summary || input?.summary || title, 1_000);
  const publishedAt = normalizedDate(input?.published_at, "research_source_published_at_invalid", { now: current });
  const retrievedAt = normalizedDate(input?.retrieved_at, "research_source_retrieved_at_invalid", { fallback: nowIso(current), now: current });
  const excerpt = cleanText(input?.excerpt || input?.content || input?.body || "", 1_500);
  const text = `${title} ${claimSummary} ${excerpt}`;
  const supportDirection = String(input?.support_direction || evidenceDirection(text)).toLowerCase();
  const contentHash = stableHash(JSON.stringify({ canonicalUrl, title, claimSummary, excerpt, publishedAt, source_id: source.source_id }));
  const reliability = boundedNumber(input?.reliability, source.reliability_score ?? 0.5, 0, 1);
  const freshness = publishedAt
    ? Math.max(0, Math.min(1, 1 - Math.min(1, (current.getTime() - new Date(publishedAt).getTime()) / (source.freshness_policy_days * 86_400_000))))
    : 0.4;
  const relevance = boundedNumber(input?.relevance, branchIds.includes(input?.branch_id) ? 0.9 : 0.5, 0, 1);
  const uncertainty = boundedNumber(input?.uncertainty, 1 - ((reliability + freshness + relevance) / 3), 0, 1);
  return {
    evidence_id: `e_${contentHash.slice(0, 16)}`,
    source_id: source.source_id,
    canonical_url: canonicalUrl,
    title,
    published_at: publishedAt,
    retrieved_at: retrievedAt,
    content_hash: contentHash,
    claim_summary: claimSummary,
    support_direction: ["support", "against", "neutral"].includes(supportDirection) ? supportDirection : "neutral",
    reliability: Number(reliability.toFixed(3)),
    freshness: Number(freshness.toFixed(3)),
    relevance: Number(relevance.toFixed(3)),
    uncertainty: Number(uncertainty.toFixed(3)),
    citation: cleanText(input?.citation || `${source.name} (${source.base_url})`, 500),
    license_class: cleanText(input?.license_class || source.license_policy || "metadata_only", 120),
    source_type: validationSourceType(source.source_type),
    source_registry_version: TRUSTED_SOURCE_REGISTRY_VERSION,
    redacted: true,
    prompt_injection_detected: /ignore previous instructions|reveal (?:the )?(?:prompt|secret)|ignora le istruzioni|rivela il prompt/i.test(text),
  };
}

function appendJsonl(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function createResearchStorage(storageRoot) {
  const root = path.join(storageRoot, "research");
  const workspacesDir = path.join(root, "workspaces");
  const candidatesDir = path.join(root, "learning-candidates");
  const verifiedDir = path.join(root, "verified-learning");
  const metricsFile = path.join(root, "metrics.json");

  function tenantWorkspaceDir(tenantId) {
    return path.join(workspacesDir, tenantId);
  }

  function workspaceFile(workspace) {
    return path.join(tenantWorkspaceDir(workspace.tenant_id), `${workspace.workspace_id}.json`);
  }

  return {
    root,
    workspacesDir,
    candidatesDir,
    verifiedDir,
    metricsFile,
    appendCandidate(tenantId, candidate) {
      appendJsonl(path.join(candidatesDir, `${tenantId}.jsonl`), candidate);
    },
    appendVerified(tenantId, verified) {
      appendJsonl(path.join(verifiedDir, `${tenantId}.jsonl`), verified);
    },
    writeWorkspace(workspace) {
      const filePath = workspaceFile(workspace);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(workspaceSummary(workspace), null, 2), "utf8");
    },
    removeWorkspace(workspace) {
      const filePath = workspaceFile(workspace);
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    },
    cleanupExpiredWorkspaceFiles(tenantId, current) {
      const directory = tenantWorkspaceDir(tenantId);
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return 0;
        throw error;
      }
      let cleaned = 0;
      for (const entry of entries) {
        if (!entry.isFile() || !/^rw_[a-f0-9-]+\.json$/i.test(entry.name)) continue;
        const filePath = path.join(directory, entry.name);
        let record;
        try {
          record = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch {
          continue;
        }
        const expiresAt = Date.parse(String(record?.expires_at || ""));
        const removable = record?.tenant_id === tenantId
          && (["closed", "expired"].includes(record?.status) || (Number.isFinite(expiresAt) && expiresAt <= current.getTime()));
        if (!removable) continue;
        fs.unlinkSync(filePath);
        cleaned += 1;
      }
      return cleaned;
    },
  };
}

function validSourceEvidence(record, registryById, sourceRefs) {
  const source = registryById.get(record?.source_id);
  if (!source || source.status !== "active" || !sourceRefs.has(source.source_id)) return false;
  if (!record?.content_hash || !/^[a-f0-9]{64}$/i.test(record.content_hash)) return false;
  if (!record?.citation || !record?.license_class || record?.prompt_injection_detected === true) return false;
  try {
    const canonicalUrl = normalizeUrl(record.canonical_url);
    return hostAllowed(canonicalUrl, source.allowed_domains);
  } catch {
    return false;
  }
}

function evaluateCandidate(candidate, registry, config, validation = null) {
  const sourceRecords = Array.isArray(candidate.source_records) ? candidate.source_records : [];
  const sourceEvidence = Array.isArray(candidate.source_evidence) ? candidate.source_evidence : [];
  const sourceRefs = listify(candidate.source_refs, registry.sources.length);
  const sourceRefSet = new Set(sourceRefs);
  const sourceIds = sourceRecords.map((source) => source?.source_id).filter(Boolean);
  const registryById = new Map(registry.sources.map((source) => [source.source_id, source]));
  const activeSources = sourceRecords.filter((source) => source.status === "active");
  const duplicateSources = new Set(sourceIds).size !== sourceIds.length;
  const sourceRecordsValid = sourceRecords.length > 0
    && !duplicateSources
    && sourceIds.length === sourceRefs.length
    && sourceIds.every((sourceId) => sourceRefSet.has(sourceId) && registryById.get(sourceId)?.status === "active");
  const sourceEvidenceValid = sourceEvidence.length > 0
    && sourceEvidence.every((record) => validSourceEvidence(record, registryById, sourceRefSet))
    && sourceRefs.every((sourceId) => sourceEvidence.some((record) => record.source_id === sourceId));
  const staleSources = sourceEvidence.some((record) => Number(record?.freshness) <= 0);
  const contradictionCount = Array.isArray(candidate.contradictions) ? candidate.contradictions.length : 0;
  const hasSecrets = /(?:Bearer\s+[A-Za-z0-9._~+/-]+=*|sk-(?:proj-)?[A-Za-z0-9_-]{12,}|(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+)/i.test(JSON.stringify({
    lesson: candidate.lesson,
    source_refs: candidate.source_refs,
    outcome_refs: candidate.outcome_refs,
    limitations: candidate.limitations,
    contradictions: candidate.contradictions,
    scope: candidate.scope,
    branch_id: candidate.branch_id,
    branch_ids: candidate.branch_ids,
    policy_version: candidate.policy_version,
    provenance: candidate.provenance,
  }));
  const validationReady = validation?.state === "candidate"
    && validation?.release_readiness?.eligible_for_tenant_review === true;
  const policyRejected = hasSecrets
    || !sourceRecordsValid
    || !sourceEvidenceValid
    || validation?.state === "quarantined";
  const score = Math.max(0, Math.min(100, Math.round(
    (Number(candidate.confidence) || 0) * 100
    + activeSources.length * 8
    - contradictionCount * 10
    - (duplicateSources ? 20 : 0)
    - (staleSources ? 10 : 0)
    - (hasSecrets ? 100 : 0),
  )));
  const confirmationEligible = !policyRejected
    && validationReady
    && score >= 80
    && activeSources.length === sourceRecords.length
    && !contradictionCount
    && !staleSources;
  const confirmationHeld = config.distillation_requires_review || config.mode !== "active";
  const status = policyRejected
    ? "rejected"
    : confirmationEligible
      ? (confirmationHeld ? "under_review" : "confirmed")
      : score >= 55
        ? "under_review"
        : "rejected";
  const rejectionReasons = [];
  if (hasSecrets) rejectionReasons.push("sensitive_content");
  if (!sourceRecordsValid) rejectionReasons.push("source_records_invalid");
  if (!sourceEvidenceValid) rejectionReasons.push("source_evidence_invalid");
  if (validation?.state === "quarantined") rejectionReasons.push("evidence_quarantined");
  if (status === "rejected" && !rejectionReasons.length) rejectionReasons.push("insufficient_evidence_or_policy");
  return {
    ...candidate,
    schema_version: LEARNING_CANDIDATE_SCHEMA_VERSION,
    status,
    confidence_score: score,
    core_policy_validation: {
      tenant_scope_required: true,
      verified_outcome_required: true,
      no_raw_prompt_or_cot: true,
      no_cross_tenant_promotion: true,
      license_required: true,
      citation_required: true,
      source_records_valid: sourceRecordsValid,
      source_evidence_valid: sourceEvidenceValid,
      validation_ready_for_review: validationReady,
    },
    review: {
      required: config.distillation_requires_review,
      state: status === "confirmed" ? "not_required" : confirmationEligible ? "pending" : "not_ready",
      confirmation_held: confirmationHeld && confirmationEligible,
    },
    registry_version: registry.version,
    policy_version: config.schema_version,
    verified_reasons: status === "confirmed" ? ["sources_active", "outcome_verified", "regression_checked"] : [],
    rejection_reasons: status === "rejected" ? rejectionReasons : [],
  };
}

function openWorkspaceStore(state, input, registry, config, now, metrics) {
  const tenantId = String(input.tenant_id || "").trim();
  const tenantCheck = validateTenant(config, tenantId);
  if (!tenantCheck.ok) throw new Error(tenantCheck.error);
  const branchCheck = validateBranchIds(input.branch_ids, registry);
  if (!branchCheck.ok) throw new Error(branchCheck.error);
  const requestedSourceIds = listify(input.allowed_source_ids);
  const knownSourceIds = new Set(registry.sources.map((source) => source.source_id));
  if (requestedSourceIds.some((sourceId) => !knownSourceIds.has(sourceId))) throw new Error("research_source_unknown");
  const branchSourceIds = new Set(branchCheck.value.flatMap((branchId) => registry.branch_bindings[branchId] || []));
  if (requestedSourceIds.some((sourceId) => !branchSourceIds.has(sourceId))) throw new Error("research_source_not_authorized");
  const sourceAllowlist = requestedSourceIds.length
    ? requestedSourceIds
    : registry.sources.map((source) => source.source_id).filter((sourceId) => branchSourceIds.has(sourceId));
  if (!sourceAllowlist.length) throw new Error("research_source_not_authorized");
  const maxDocuments = requestedBudget(input.max_documents, config.max_documents, 1, config.max_documents);
  const maxBytes = requestedBudget(input.max_bytes, config.max_bytes, 1, config.max_bytes);
  const maxDurationMs = requestedBudget(input.max_duration_ms, config.max_duration_ms, 1_000, config.max_duration_ms);
  const ttlMs = Math.min(maxDurationMs, config.cache_ttl_seconds * 1_000);
  const workspaceId = `rw_${crypto.randomUUID()}`;
  const workspace = {
    schema_version: EVIDENCE_WORKSPACE_SCHEMA_VERSION,
    workspace_id: workspaceId,
    tenant_id: tenantId,
    request_id: String(input.request_id || crypto.randomUUID()),
    request_fingerprint: String(input.request_fingerprint || stableHash(JSON.stringify({
      tenant_id: tenantId,
      request_id: input.request_id || "",
      question: cleanText(input.question || "", 1000),
      branch_ids: branchCheck.value,
    }))),
    question: cleanText(input.question || "", 2000),
    branch_ids: branchCheck.value,
    allowed_source_ids: sourceAllowlist,
    max_documents: maxDocuments,
    max_bytes: maxBytes,
    max_duration_ms: maxDurationMs,
    ttl_ms: ttlMs,
    retention_mode: input.retention_mode || config.default_retention_mode,
    envelope_id: input.envelope_id,
    external_side_effects: false,
    created_at: nowIso(now),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    status: "open",
    bytes_used: 0,
    document_count: 0,
    evidence: [],
    evidence_by_hash: new Set(),
    contradictions: [],
    dtt_binding: {
      branch_ids: branchCheck.value,
      mode: input.dtt_mode || "shadow",
      core_decision_reference: input.core_decision_reference,
    },
    metrics: {
      normalized: 0,
      duplicate_documents: 0,
      prompt_injection: 0,
      rejected: 0,
    },
  };
  state.workspaces.set(workspaceId, workspace);
  metrics.workspace_created += 1;
  return workspace;
}

function touchWorkspace(workspace, now) {
  if (!workspace) return;
  if (new Date(workspace.expires_at).getTime() <= now.getTime()) workspace.status = "expired";
}

function workspaceSummary(workspace) {
  return {
    schema_version: workspace.schema_version,
    workspace_id: workspace.workspace_id,
    tenant_id: workspace.tenant_id,
    request_id: workspace.request_id,
    request_fingerprint: workspace.request_fingerprint,
    envelope_id: workspace.envelope_id,
    branch_ids: [...workspace.branch_ids],
    allowed_source_ids: [...workspace.allowed_source_ids],
    status: workspace.status,
    created_at: workspace.created_at,
    expires_at: workspace.expires_at,
    max_documents: workspace.max_documents,
    max_bytes: workspace.max_bytes,
    max_duration_ms: workspace.max_duration_ms,
    ttl_ms: workspace.ttl_ms,
    retention_mode: workspace.retention_mode,
    document_count: workspace.document_count,
    bytes_used: workspace.bytes_used,
    metrics: { ...workspace.metrics },
    dtt_binding: { ...workspace.dtt_binding },
  };
}

export function createResearchDistillationRuntime(options = {}) {
  const env = options.env || process.env;
  const now = () => new Date(typeof options.now === "function" ? options.now() : options.now || Date.now());
  const config = parseResearchDistillationConfig(env);
  const registry = sourceRegistry(nyraBranchCatalog("skinharmony").branches);
  const storageRoot = options.storageRoot ? String(options.storageRoot) : null;
  const store = storageRoot ? createResearchStorage(storageRoot) : null;
  const state = {
    workspaces: new Map(),
    envelopes: new Map(),
    metrics_by_tenant: new Map(),
  };
  const emptyMetrics = () => ({
      workspace_created: 0,
      workspace_closed: 0,
      workspace_expired: 0,
      cleanup_success: 0,
      cleanup_failed: 0,
      candidate_created: 0,
      candidate_verified: 0,
      candidate_rejected: 0,
      bytes_temporary: 0,
      sources_used: 0,
      sources_obsolete: 0,
      contradictions: 0,
    });
  const metricsFor = (tenantId) => {
    if (!state.metrics_by_tenant.has(tenantId)) state.metrics_by_tenant.set(tenantId, emptyMetrics());
    return state.metrics_by_tenant.get(tenantId);
  };
  const workspaceStorageEnabled = Boolean(store) && config.mode !== "shadow";
  const activeAuthorizationVerifier = options.activeAuthorizationVerifier;

  function operationTenant(input = {}) {
    if (!config.enabled || config.mode === "off") throw new Error("research_distillation_disabled");
    const tenantId = String(typeof input === "string" ? input : input?.tenant_id || "").trim();
    const tenantCheck = validateTenant(config, tenantId);
    if (!tenantCheck.ok) throw new Error(tenantCheck.error);
    return tenantId;
  }

  function cleanupExpired(input = {}) {
    const tenantId = operationTenant(input);
    const metrics = metricsFor(tenantId);
    const current = now();
    let cleaned = 0;
    try {
      for (const [envelopeId, envelope] of state.envelopes.entries()) {
        if (envelope.tenant_id === tenantId && new Date(envelope.expires_at).getTime() <= current.getTime()) {
          state.envelopes.delete(envelopeId);
        }
      }
      for (const [workspaceId, workspace] of state.workspaces.entries()) {
        if (workspace.tenant_id !== tenantId) continue;
        touchWorkspace(workspace, current);
        if (workspace.status !== "expired" && workspace.status !== "closed") continue;
        if (workspaceStorageEnabled) store.removeWorkspace(workspace);
        state.workspaces.delete(workspaceId);
        metrics.workspace_expired += workspace.status === "expired" ? 1 : 0;
        cleaned += 1;
      }
      if (workspaceStorageEnabled) cleaned += store.cleanupExpiredWorkspaceFiles(tenantId, current);
    } catch (error) {
      metrics.cleanup_failed += 1;
      throw error;
    }
    if (cleaned) metrics.cleanup_success += cleaned;
    return cleaned;
  }

  function getWorkspace(workspaceId, tenantId) {
    const workspace = state.workspaces.get(String(workspaceId || ""));
    if (!workspace) throw new Error("research_workspace_not_found");
    if (workspace.tenant_id !== tenantId) throw new Error("research_workspace_tenant_mismatch");
    touchWorkspace(workspace, now());
    if (workspace.status === "expired") throw new Error("research_workspace_expired");
    if (workspace.status !== "open") throw new Error("research_workspace_not_open");
    return workspace;
  }

  function openWorkspace(input = {}) {
    const tenantId = operationTenant(input);
    const envelopeId = String(input.envelope_id || "").trim();
    if (!envelopeId) throw new Error("research_envelope_id_required");
    const envelope = state.envelopes.get(envelopeId);
    if (!envelope) throw new Error("research_envelope_not_found_or_expired");
    if (envelope.tenant_id !== tenantId) throw new Error("research_envelope_tenant_mismatch");
    if (!["shadow_only", "allowed"].includes(envelope.status)) throw new Error("research_envelope_denied");
    if (envelope.consumed_at) throw new Error("research_envelope_replayed");
    if (new Date(envelope.expires_at).getTime() <= now().getTime()) {
      state.envelopes.delete(envelopeId);
      throw new Error("research_envelope_not_found_or_expired");
    }
    const metrics = metricsFor(tenantId);
    const workspace = openWorkspaceStore(state, {
      ...envelope,
      tenant_id: tenantId,
      envelope_id: envelopeId,
      core_decision_reference: envelope.directive_id,
      dtt_mode: config.mode === "shadow" ? "shadow" : "advisory",
    }, registry, config, now(), metrics);
    envelope.consumed_at = nowIso(now());
    envelope.workspace_id = workspace.workspace_id;
    if (workspaceStorageEnabled) {
      try {
        store.writeWorkspace(workspace);
      } catch (error) {
        state.workspaces.delete(workspace.workspace_id);
        envelope.consumed_at = null;
        envelope.workspace_id = null;
        metrics.workspace_created -= 1;
        throw error;
      }
    }
    return workspaceSummary(workspace);
  }

  function prepareEvidenceBatch(workspace, evidenceItems = []) {
    if (!Array.isArray(evidenceItems)) throw new Error("research_evidence_invalid");
    if (evidenceItems.length > config.max_documents) throw new Error("research_documents_limit_exceeded");
    const normalized = [];
    const seenHashes = new Set(workspace.evidence_by_hash);
    let duplicateDocuments = 0;
    let bytesAdded = 0;
    for (const item of evidenceItems) {
      const clean = normalizeEvidenceItem(item, { now: now(), branchIds: workspace.branch_ids, allowedSourceIds: workspace.allowed_source_ids });
      if (seenHashes.has(clean.content_hash)) {
        duplicateDocuments += 1;
        continue;
      }
      const encoded = Buffer.byteLength(JSON.stringify(clean), "utf8");
      if (workspace.document_count + normalized.length + 1 > workspace.max_documents) {
        throw new Error("research_workspace_document_limit_exceeded");
      }
      if (workspace.bytes_used + bytesAdded + encoded > workspace.max_bytes) {
        throw new Error("research_workspace_byte_limit_exceeded");
      }
      seenHashes.add(clean.content_hash);
      bytesAdded += encoded;
      normalized.push(clean);
    }
    return { normalized, duplicateDocuments, bytesAdded };
  }

  function validateWorkspaceEvidence(workspace, evidence) {
    const validationInput = {
      question: workspace.question,
      plan: {
        source_policy: {
          minimum_independent_sources: Math.min(2, workspace.max_documents),
          freshness_days: 90,
          allowed_domains: [],
        },
      },
      sources: evidence.map((item) => ({
        id: item.evidence_id,
        url: item.canonical_url,
        title: item.title,
        source_type: item.source_type,
        published_at: item.published_at || undefined,
      })),
      claims: evidence.map((item, index) => ({
        id: `claim_${index + 1}`,
        kind: item.support_direction === "against" ? "hypothesis" : "fact",
        text: item.claim_summary,
        source_ids: [item.evidence_id],
        confidence: item.reliability,
      })),
    };
    return validateResearchEvidence(validationInput, { now: now() });
  }

  function commitEvidenceBatch(workspace, prepared) {
    const metrics = metricsFor(workspace.tenant_id);
    for (const item of prepared.normalized) {
      workspace.evidence_by_hash.add(item.content_hash);
      workspace.evidence.push(item);
    }
    workspace.document_count = workspace.evidence.length;
    workspace.bytes_used += prepared.bytesAdded;
    workspace.metrics.normalized += prepared.normalized.length;
    workspace.metrics.duplicate_documents += prepared.duplicateDocuments;
    workspace.metrics.prompt_injection += prepared.normalized.filter((item) => item.prompt_injection_detected).length;
    metrics.bytes_temporary += prepared.bytesAdded;
    metrics.sources_used += prepared.normalized.length;
    metrics.contradictions += prepared.normalized.filter((item) => item.support_direction === "against").length;
  }

  function closeWorkspace(workspaceId, input = {}) {
    const tenantId = operationTenant(input);
    const workspace = getWorkspace(workspaceId, tenantId);
    if (workspaceStorageEnabled) store.removeWorkspace(workspace);
    workspace.status = "closed";
    state.workspaces.delete(workspace.workspace_id);
    metricsFor(tenantId).workspace_closed += 1;
    return workspaceSummary(workspace);
  }

  function authorizeEnvelope(envelope = {}, context = {}) {
    const envelopeTenantId = String(envelope.tenant_id || "").trim();
    const contextTenantId = String(context.tenantId || "").trim();
    if (contextTenantId && envelopeTenantId && contextTenantId !== envelopeTenantId) {
      throw new Error("research_tenant_mismatch");
    }
    const tenantId = contextTenantId || envelopeTenantId;
    const tenantCheck = validateTenant(config, tenantId);
    if (!tenantCheck.ok) throw new Error(tenantCheck.error);
    const directive = context.coreDirective;
    if (
      !directive
      || directive.schema_version !== CORE_RESEARCH_DIRECTIVE_VERSION
      || directive.issued_by !== "universal_core"
      || directive.status !== "directive_issued_non_executing"
      || !/^crd_[a-f0-9]{32}$/.test(String(directive.directive_id || ""))
      || directive.tenant_scope?.tenant_id !== tenantId
      || directive.tenant_scope?.cross_tenant !== false
      || directive.authority?.research_execution_authorized !== false
      || directive.authority?.distillation_authorized !== false
      || directive.authority?.consolidation_authorized !== false
      || directive.authority?.global_promotion_authorized !== false
    ) {
      throw new Error("research_core_directive_invalid");
    }
    const question = cleanText(envelope.question || "", 2_000);
    if (!question || directive.questions?.find((item) => item.id === "primary")?.question !== question) {
      throw new Error("research_core_directive_question_mismatch");
    }
    const requestedBranchIds = envelope.branch_ids
      || (envelope.branch_id ? [envelope.branch_id] : context.branchIds)
      || [];
    const branchCheck = validateBranchIds(Array.isArray(requestedBranchIds) ? requestedBranchIds : [requestedBranchIds], registry);
    if (!branchCheck.ok) throw new Error(branchCheck.error);
    const requestedSourceIds = listify(envelope.allowed_source_ids);
    const branchSourceIds = new Set(branchCheck.value.flatMap((branchId) => registry.branch_bindings[branchId] || []));
    const allowedSourceIds = requestedSourceIds.length ? requestedSourceIds : [...branchSourceIds];
    const unknown = allowedSourceIds.filter((sourceId) => !registry.sources.some((source) => source.source_id === sourceId));
    if (unknown.length) throw new Error("research_source_unknown");
    if (allowedSourceIds.some((sourceId) => !branchSourceIds.has(sourceId))) throw new Error("research_source_not_authorized");
    const maxDocuments = requestedBudget(envelope.max_documents, config.max_documents, 1, config.max_documents);
    const maxBytes = requestedBudget(envelope.max_bytes, config.max_bytes, 1, config.max_bytes);
    const maxDurationMs = requestedBudget(envelope.max_duration_ms, config.max_duration_ms, 1_000, config.max_duration_ms);
    const activeAuthorized = config.mode === "active"
      && typeof activeAuthorizationVerifier === "function"
      && activeAuthorizationVerifier({ tenant_id: tenantId, directive, envelope }) === true;
    const issuedAt = now();
    const status = !config.enabled || config.mode === "off"
      ? "denied"
      : config.mode === "shadow"
        ? "shadow_only"
        : activeAuthorized
          ? "allowed"
          : "denied";
    const envelopeId = `rae_${crypto.randomUUID()}`;
    const authorized = {
      schema_version: RESEARCH_AUTHORIZATION_ENVELOPE_VERSION,
      envelope_id: envelopeId,
      request_id: String(envelope.request_id || crypto.randomUUID()),
      tenant_id: tenantId,
      branch_ids: branchCheck.value,
      question,
      allowed_source_ids: allowedSourceIds,
      max_documents: maxDocuments,
      max_bytes: maxBytes,
      max_duration_ms: maxDurationMs,
      max_cost: Number(envelope.max_cost || 0),
      retention_mode: envelope.retention_mode || config.default_retention_mode,
      external_side_effects: false,
      status,
      issued_at: nowIso(issuedAt),
      expires_at: new Date(issuedAt.getTime() + Math.min(maxDurationMs, config.cache_ttl_seconds * 1_000)).toISOString(),
      source_registry_version: registry.version,
      policy_version: config.schema_version,
      directive_id: directive.directive_id,
      required_review: config.distillation_requires_review,
      consumed_at: null,
      workspace_id: null,
    };
    if (status !== "denied") state.envelopes.set(envelopeId, authorized);
    return { ...authorized, consumed_at: undefined, workspace_id: undefined };
  }

  function attachEvidence(workspaceId, input = {}) {
    const tenantId = operationTenant(input);
    const workspace = getWorkspace(workspaceId, tenantId);
    const prepared = prepareEvidenceBatch(workspace, input.evidence === undefined ? [] : input.evidence);
    const evidenceForValidation = [...workspace.evidence, ...prepared.normalized];
    const validation = validateWorkspaceEvidence(workspace, evidenceForValidation);
    commitEvidenceBatch(workspace, prepared);
    if (workspaceStorageEnabled) store.writeWorkspace(workspace);
    const dttBinding = {
      ...workspace.dtt_binding,
      evidence_refs: evidenceForValidation.map((item) => item.evidence_id),
    };
    return {
      schema_version: RESEARCH_DISTILLATION_SCHEMA_VERSION,
      workspace: workspaceSummary(workspace),
      evidence: evidenceForValidation,
      validation,
      dtt_binding: dttBinding,
      guardrail: {
        no_side_effects: true,
        raw_page_storage_allowed: false,
        automatic_memory_promotion: false,
      },
    };
  }

  function distillCandidate(workspaceId, input = {}) {
    const tenantId = operationTenant(input);
    const workspace = getWorkspace(workspaceId, tenantId);
    const attached = attachEvidence(workspaceId, {
      tenant_id: tenantId,
      evidence: input.evidence === undefined ? [] : input.evidence,
    });
    const validation = attached.validation;
    const primaryBranch = workspace.branch_ids[0] || "research_evidence";
    const lesson = cleanText(input.lesson || input.learning || workspace.question || "Verified lesson pending", 1_000);
    const sourceRefs = [...new Set(workspace.evidence.map((item) => item.source_id))];
    const candidate = {
      schema_version: LEARNING_CANDIDATE_SCHEMA_VERSION,
      candidate_id: `lc_${crypto.randomUUID()}`,
      tenant_id: workspace.tenant_id,
      branch_id: primaryBranch,
      branch_ids: [...workspace.branch_ids],
      lesson,
      source_refs: sourceRefs,
      source_records: sourceRefs.map((sourceId) => registry.sources.find((source) => source.source_id === sourceId)).filter(Boolean),
      source_evidence: workspace.evidence.map((item) => ({ ...item })),
      outcome_refs: [...new Set([workspace.request_id].concat(listify(input.outcome_refs, 10)))],
      confidence: boundedNumber(input.confidence, validation.quality_score / 100, 0, 1),
      limitations: listify(input.limitations, 10),
      contradictions: validation.contradictions.map((item) => item.claim_ids.join(":")),
      scope: cleanText(input.scope || primaryBranch, 200),
      valid_from: nowIso(now()),
      valid_until: new Date(now().getTime() + 30 * 86_400_000).toISOString(),
      policy_version: config.schema_version,
      status: "candidate",
      evidence_hashes: workspace.evidence.map((item) => item.content_hash),
      dtt_binding: {
        ...workspace.dtt_binding,
        evidence_refs: workspace.evidence.map((item) => item.evidence_id),
      },
      provenance: {
        source_registry_version: registry.version,
        workspace_id: workspace.workspace_id,
        request_id: workspace.request_id,
        validation_id: validation.validation_id,
      },
    };
    const metrics = metricsFor(workspace.tenant_id);
    metrics.candidate_created += 1;
    const evaluated = evaluateCandidate(candidate, registry, config, validation);
    if (evaluated.status === "confirmed") metrics.candidate_verified += 1;
    if (evaluated.status === "rejected") metrics.candidate_rejected += 1;
    const persistVerified = input.persist_verified === true
      && evaluated.status === "confirmed"
      && config.mode === "active"
      && config.distillation_requires_review === false
      && Boolean(store);
    if (persistVerified) {
      store.appendVerified(workspace.tenant_id, {
        schema_version: VERIFIED_LEARNING_SCHEMA_VERSION,
        ...evaluated,
        verified_at: nowIso(now()),
        audit_reference: input.audit_reference || null,
      });
    }
    return {
      schema_version: RESEARCH_DISTILLATION_SCHEMA_VERSION,
      workspace: workspaceSummary(workspace),
      validation,
      candidate: evaluated,
      verified_learning: evaluated.status === "confirmed"
        ? {
            schema_version: VERIFIED_LEARNING_SCHEMA_VERSION,
            tenant_id: workspace.tenant_id,
            branch_id: primaryBranch,
            lesson,
            source_refs: [...evaluated.source_refs],
            outcome_refs: [...evaluated.outcome_refs],
            confidence: evaluated.confidence,
            limitations: [...evaluated.limitations],
            policy_version: config.schema_version,
            status: "verified",
            verified_at: nowIso(now()),
          }
        : null,
      guardrail: {
        automatic_promotion: false,
        memory_promotion_allowed: persistVerified,
        durable_persistence_performed: persistVerified,
        review_required: config.distillation_requires_review,
        observational_mode: config.mode === "shadow",
        no_raw_page_storage: true,
      },
    };
  }

  function registryForTenant(tenantId) {
    const tenantCheck = validateTenant(config, tenantId);
    if (!tenantCheck.ok) throw new Error(tenantCheck.error);
    return {
      schema_version: RESEARCH_DISTILLATION_SCHEMA_VERSION,
      tenant_id: tenantId,
      config: {
        schema_version: config.schema_version,
        enabled: config.enabled,
        mode: config.mode,
        max_documents: config.max_documents,
        max_bytes: config.max_bytes,
        max_duration_ms: config.max_duration_ms,
        cache_ttl_seconds: config.cache_ttl_seconds,
        distillation_requires_review: config.distillation_requires_review,
        default_retention_mode: config.default_retention_mode,
        tenant_allowlist_configured: config.tenant_allowlist.length > 0,
        tenant_allowlist_size: config.tenant_allowlist.length,
      },
      registry,
      learning_packs: buildLearningPacks(nyraBranchCatalog("skinharmony").branches, registry.version),
    };
  }

  function status(tenantId) {
    const tenantCheck = validateTenant(config, tenantId);
    const current = now();
    const activeWorkspaces = tenantCheck.ok
      ? [...state.workspaces.values()].filter((workspace) => {
          if (workspace.tenant_id !== tenantId) return false;
          touchWorkspace(workspace, current);
          return workspace.status === "open";
        }).length
      : 0;
    return {
      schema_version: RESEARCH_DISTILLATION_SCHEMA_VERSION,
      enabled: config.enabled,
      mode: config.mode,
      policy_version: config.schema_version,
      registry_version: registry.version,
      tenant_allowed: tenantCheck.ok,
      active_workspaces: activeWorkspaces,
      metrics: tenantCheck.ok ? { ...metricsFor(tenantId) } : emptyMetrics(),
    };
  }

  function branchPack(tenantId, branchId = null) {
    const payload = registryForTenant(tenantId);
    if (!branchId) return payload;
    const pack = payload.learning_packs.packs.find((item) => item.branch_id === branchId);
    if (!pack) throw new Error("research_branch_pack_not_found");
    return { ...payload, learning_pack: pack };
  }

  return {
    config,
    registry,
    status,
    registryForTenant,
    branchPack,
    openWorkspace,
    attachEvidence,
    closeWorkspace,
    distillCandidate,
    authorizeEnvelope,
    cleanupExpired,
    sourceRegistry,
    buildLearningPacks,
    sourceBindingsFor,
    normalizeEvidenceItem: (input, context = {}) => normalizeEvidenceItem(input, { now: now(), ...context }),
  };
}

export { buildLearningPacks, parseResearchDistillationConfig, sourceRegistry };
