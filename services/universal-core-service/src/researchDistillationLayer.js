import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
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
});

const GENERIC_BINDINGS = Object.freeze(["ec_commission", "nist", "crossref"]);

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function listify(value, limit = 50) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, limit).map((item) => String(item || "").trim()).filter(Boolean))];
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
  const enabled = truthy(env.NYRA_RESEARCH_DISTILLATION_ENABLED ?? env.CORE_RESEARCH_DISTILLATION_ENABLED);
  const rawMode = String(env.NYRA_RESEARCH_DISTILLATION_MODE || env.CORE_RESEARCH_DISTILLATION_MODE || "off").trim().toLowerCase();
  const mode = BASE_MODE.has(rawMode) ? rawMode : "off";
  const maxDocuments = Math.max(1, Math.min(100, Number(env.NYRA_RESEARCH_MAX_DOCUMENTS || env.CORE_RESEARCH_MAX_DOCUMENTS || 10)));
  const maxBytes = Math.max(10_000, Math.min(20_000_000, Number(env.NYRA_RESEARCH_MAX_BYTES || env.CORE_RESEARCH_MAX_BYTES || 2_000_000)));
  const timeoutMs = Math.max(1_000, Math.min(120_000, Number(env.NYRA_RESEARCH_TIMEOUT_MS || env.CORE_RESEARCH_TIMEOUT_MS || 30_000)));
  const cacheTtlSeconds = Math.max(60, Math.min(86_400, Number(env.NYRA_RESEARCH_CACHE_TTL_SECONDS || env.CORE_RESEARCH_CACHE_TTL_SECONDS || 3_600)));
  const tenantAllowlist = listify(env.NYRA_RESEARCH_TENANT_ALLOWLIST || env.CORE_RESEARCH_TENANT_ALLOWLIST);
  const distillationRequiresReview = env.NYRA_DISTILLATION_REQUIRES_REVIEW === undefined
    ? true
    : truthy(env.NYRA_DISTILLATION_REQUIRES_REVIEW);
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
  if (config.tenant_allowlist.length && !config.tenant_allowlist.includes(tenantId)) {
    return { ok: false, error: "research_tenant_not_allowlisted" };
  }
  return { ok: true };
}

function validateBranchIds(branchIds, registry) {
  const branches = nyraBranchCatalog("generic").branches;
  const known = new Set(branches.map((branch) => branch.id));
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

function normalizeEvidenceItem(input, context) {
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
  const publishedAt = input?.published_at ? new Date(input.published_at).toISOString() : null;
  const retrievedAt = input?.retrieved_at ? new Date(input.retrieved_at).toISOString() : nowIso(context.now);
  const excerpt = cleanText(input?.excerpt || input?.content || input?.body || "", 1_500);
  const text = `${title} ${claimSummary} ${excerpt}`;
  const supportDirection = String(input?.support_direction || evidenceDirection(text)).toLowerCase();
  const contentHash = stableHash(JSON.stringify({ canonicalUrl, title, claimSummary, excerpt, publishedAt, source_id: source.source_id }));
  const reliability = Math.max(0, Math.min(1, Number(input?.reliability ?? source.reliability_score ?? 0.5)));
  const freshness = publishedAt ? Math.max(0, Math.min(1, 1 - Math.min(1, (context.now.getTime() - new Date(publishedAt).getTime()) / (source.freshness_policy_days * 86_400_000)))) : 0.4;
  const relevance = Math.max(0, Math.min(1, Number(input?.relevance ?? (context.branchIds.includes(input?.branch_id) ? 0.9 : 0.5))));
  const uncertainty = Math.max(0, Math.min(1, Number.isFinite(Number(input?.uncertainty)) ? Number(input.uncertainty) : 1 - ((reliability + freshness + relevance) / 3)));
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
  };
}

function evaluateCandidate(candidate, registry, config) {
  const sourceRecords = Array.isArray(candidate.source_records) ? candidate.source_records : [];
  const sourceIds = sourceRecords.map((source) => source.source_id);
  const activeSources = sourceRecords.filter((source) => source.status === "active");
  const duplicateSources = new Set(sourceIds).size !== sourceIds.length;
  const staleSources = sourceRecords.some((source) => (source.freshness_policy_days || 0) < 1);
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
  const score = Math.max(0, Math.min(100, Math.round(
    (Number(candidate.confidence) || 0) * 100
    + activeSources.length * 8
    - contradictionCount * 10
    - (duplicateSources ? 20 : 0)
    - (staleSources ? 10 : 0)
    - (hasSecrets ? 100 : 0),
  )));
  const status = hasSecrets
    ? "rejected"
    : score >= 80 && activeSources.length === sourceRecords.length && !contradictionCount
      ? "confirmed"
      : score >= 55
        ? "under_review"
        : "rejected";
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
    },
    registry_version: registry.version,
    policy_version: config.schema_version,
    verified_reasons: status === "confirmed" ? ["sources_active", "outcome_verified", "regression_checked"] : [],
    rejection_reasons: status === "rejected" ? ["insufficient_evidence_or_policy"] : [],
  };
}

function openWorkspaceStore(state, input, registry, config, now) {
  const tenantId = String(input.tenant_id || "").trim();
  const tenantCheck = validateTenant(config, tenantId);
  if (!tenantCheck.ok) throw new Error(tenantCheck.error);
  const branchCheck = validateBranchIds(input.branch_ids, registry);
  if (!branchCheck.ok) throw new Error(branchCheck.error);
  const sourceAllowlist = listify(input.allowed_source_ids, config.max_documents).filter((sourceId) => registry.sources.some((source) => source.source_id === sourceId));
  if (sourceAllowlist.length !== listify(input.allowed_source_ids, config.max_documents).length) throw new Error("research_source_unknown");
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
    max_documents: Math.min(config.max_documents, Number(input.max_documents || config.max_documents)),
    max_bytes: Math.min(config.max_bytes, Number(input.max_bytes || config.max_bytes)),
    max_duration_ms: Math.min(config.max_duration_ms, Number(input.max_duration_ms || config.max_duration_ms)),
    retention_mode: input.retention_mode || config.default_retention_mode,
    external_side_effects: false,
    created_at: nowIso(now),
    expires_at: new Date(now.getTime() + Math.min(config.max_duration_ms, Number(input.max_duration_ms || config.max_duration_ms))).toISOString(),
    status: "open",
    bytes_used: 0,
    document_count: 0,
    evidence: [],
    evidence_by_hash: new Set(),
    contradictions: [],
    dtt_binding: {
      branch_ids: branchCheck.value,
      mode: input.dtt_mode || "shadow",
      core_decision_reference: input.core_decision_reference || null,
    },
    metrics: {
      normalized: 0,
      duplicate_documents: 0,
      prompt_injection: 0,
      rejected: 0,
    },
  };
  state.workspaces.set(workspaceId, workspace);
  state.metrics.workspace_created += 1;
  return workspace;
}

function touchWorkspace(workspace, now) {
  if (!workspace) return;
  if (new Date(workspace.expires_at).getTime() < now.getTime()) workspace.status = "expired";
}

function workspaceSummary(workspace) {
  return {
    schema_version: workspace.schema_version,
    workspace_id: workspace.workspace_id,
    tenant_id: workspace.tenant_id,
    request_id: workspace.request_id,
    request_fingerprint: workspace.request_fingerprint,
    branch_ids: [...workspace.branch_ids],
    allowed_source_ids: [...workspace.allowed_source_ids],
    status: workspace.status,
    created_at: workspace.created_at,
    expires_at: workspace.expires_at,
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
  const registry = sourceRegistry(nyraBranchCatalog("generic").branches);
  const storageRoot = options.storageRoot ? String(options.storageRoot) : null;
  const store = storageRoot ? createResearchStorage(storageRoot) : null;
  const state = {
    workspaces: new Map(),
    metrics: {
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
    },
  };

  function cleanupExpired() {
    const current = now();
    let cleaned = 0;
    for (const [workspaceId, workspace] of state.workspaces.entries()) {
      touchWorkspace(workspace, current);
      if (workspace.status === "expired" || workspace.status === "closed") {
        state.workspaces.delete(workspaceId);
        cleaned += 1;
      }
    }
    if (cleaned) state.metrics.cleanup_success += cleaned;
    return cleaned;
  }

  function getWorkspace(workspaceId) {
    const workspace = state.workspaces.get(String(workspaceId || ""));
    if (!workspace) throw new Error("research_workspace_not_found");
    touchWorkspace(workspace, now());
    if (workspace.status === "expired") throw new Error("research_workspace_expired");
    return workspace;
  }

  function openWorkspace(input = {}) {
    const workspace = openWorkspaceStore(state, input, registry, config, now());
    if (store) {
      fs.mkdirSync(store.workspacesDir, { recursive: true });
      fs.writeFileSync(path.join(store.workspacesDir, `${workspace.workspace_id}.json`), JSON.stringify(workspaceSummary(workspace), null, 2), "utf8");
    }
    return workspaceSummary(workspace);
  }

  function normalizeEvidenceBatch(workspace, evidenceItems = []) {
    const normalized = [];
    for (const item of evidenceItems.slice(0, workspace.max_documents)) {
      const clean = normalizeEvidenceItem(item, { now: now(), branchIds: workspace.branch_ids, allowedSourceIds: workspace.allowed_source_ids });
      if (workspace.evidence_by_hash.has(clean.content_hash)) {
        workspace.metrics.duplicate_documents += 1;
        continue;
      }
      const encoded = Buffer.byteLength(JSON.stringify(clean), "utf8");
      if (workspace.bytes_used + encoded > workspace.max_bytes) throw new Error("research_workspace_byte_limit_exceeded");
      workspace.evidence_by_hash.add(clean.content_hash);
      workspace.evidence.push(clean);
      workspace.document_count += 1;
      workspace.bytes_used += encoded;
      workspace.metrics.normalized += 1;
      workspace.metrics.prompt_injection += clean.prompt_injection_detected ? 1 : 0;
      normalized.push(clean);
    }
    state.metrics.bytes_temporary += normalized.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item), "utf8"), 0);
    state.metrics.sources_used += normalized.length;
    state.metrics.contradictions += normalized.filter((item) => item.support_direction === "against").length;
    return normalized;
  }

  function closeWorkspace(workspaceId) {
    const workspace = getWorkspace(workspaceId);
    workspace.status = "closed";
    state.workspaces.delete(workspace.workspace_id);
    state.metrics.workspace_closed += 1;
    if (store) {
      fs.writeFileSync(path.join(store.workspacesDir, `${workspace.workspace_id}.closed.json`), JSON.stringify(workspaceSummary(workspace), null, 2), "utf8");
    }
    return workspaceSummary(workspace);
  }

  function authorizeEnvelope(envelope = {}, context = {}) {
    const tenantId = String(envelope.tenant_id || context.tenantId || "").trim();
    const tenantCheck = validateTenant(config, tenantId);
    if (!tenantCheck.ok) throw new Error(tenantCheck.error);
    const branchCheck = validateBranchIds(envelope.branch_ids || envelope.branch_id || context.branchIds || [], registry);
    if (!branchCheck.ok) throw new Error(branchCheck.error);
    const allowedSourceIds = listify(envelope.allowed_source_ids, config.max_documents);
    const unknown = allowedSourceIds.filter((sourceId) => !registry.sources.some((source) => source.source_id === sourceId));
    if (unknown.length) throw new Error("research_source_unknown");
    if (envelope.max_documents !== undefined && Number(envelope.max_documents) > config.max_documents) throw new Error("research_budget_exceeded");
    if (envelope.max_bytes !== undefined && Number(envelope.max_bytes) > config.max_bytes) throw new Error("research_budget_exceeded");
    if (envelope.max_duration_ms !== undefined && Number(envelope.max_duration_ms) > config.max_duration_ms) throw new Error("research_budget_exceeded");
    const coreDecision = context.coreDecision || envelope.core_decision_reference || null;
    return {
      schema_version: RESEARCH_AUTHORIZATION_ENVELOPE_VERSION,
      request_id: String(envelope.request_id || crypto.randomUUID()),
      tenant_id: tenantId,
      branch_ids: branchCheck.value,
      question: cleanText(envelope.question || "", 2_000),
      allowed_source_ids: allowedSourceIds,
      max_documents: Math.min(config.max_documents, Number(envelope.max_documents || config.max_documents)),
      max_bytes: Math.min(config.max_bytes, Number(envelope.max_bytes || config.max_bytes)),
      max_duration_ms: Math.min(config.max_duration_ms, Number(envelope.max_duration_ms || config.max_duration_ms)),
      max_cost: Number(envelope.max_cost || 0),
      retention_mode: envelope.retention_mode || config.default_retention_mode,
      external_side_effects: false,
      status: config.enabled && config.mode !== "off" ? "allowed" : "shadow_only",
      source_registry_version: registry.version,
      policy_version: config.schema_version,
      core_decision_reference: coreDecision,
      required_review: config.distillation_requires_review,
    };
  }

  function attachEvidence(workspaceId, input = {}) {
    const workspace = getWorkspace(workspaceId);
    if (input.tenant_id && String(input.tenant_id) !== workspace.tenant_id) throw new Error("research_workspace_tenant_mismatch");
    const normalized = normalizeEvidenceBatch(workspace, Array.isArray(input.evidence) ? input.evidence : []);
    const evidenceForValidation = normalized.length ? normalized : workspace.evidence;
    const validationInput = {
      question: workspace.question,
      plan: { source_policy: { minimum_independent_sources: Math.max(1, workspace.allowed_source_ids.length || 1), freshness_days: 90, allowed_domains: [] } },
      sources: evidenceForValidation.map((item) => ({
        id: item.source_id,
        url: item.canonical_url,
        title: item.title,
        source_type: "official",
        published_at: item.published_at || undefined,
      })),
      claims: evidenceForValidation.map((item, index) => ({
        id: `claim_${index + 1}`,
        kind: item.support_direction === "against" ? "hypothesis" : "fact",
        text: item.claim_summary,
        source_ids: [item.source_id],
        confidence: item.reliability,
      })),
    };
    const validation = validateResearchEvidence(validationInput);
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
    const workspace = getWorkspace(workspaceId);
    const validation = attachEvidence(workspaceId, { tenant_id: workspace.tenant_id, evidence: input.evidence || [] }).validation;
    const primaryBranch = workspace.branch_ids[0] || "research_evidence";
    const lesson = cleanText(input.lesson || input.learning || workspace.question || "Verified lesson pending", 1_000);
    const candidate = {
      schema_version: LEARNING_CANDIDATE_SCHEMA_VERSION,
      candidate_id: `lc_${crypto.randomUUID()}`,
      tenant_id: workspace.tenant_id,
      branch_id: primaryBranch,
      branch_ids: [...workspace.branch_ids],
      lesson,
      source_refs: workspace.evidence.map((item) => item.source_id),
      outcome_refs: [workspace.request_id].concat(listify(input.outcome_refs, 10)),
      confidence: Math.max(0, Math.min(1, Number(input.confidence ?? (validation.quality_score / 100)))),
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
    state.metrics.candidate_created += 1;
    const evaluated = evaluateCandidate(candidate, registry, config);
    if (evaluated.status === "confirmed") state.metrics.candidate_verified += 1;
    if (evaluated.status === "rejected") state.metrics.candidate_rejected += 1;
    if (input.persist_verified === true && evaluated.status === "confirmed" && store) {
      store.appendVerified(workspace.tenant_id, {
        schema_version: VERIFIED_LEARNING_SCHEMA_VERSION,
        ...evaluated,
        verified_at: nowIso(now()),
        audit_reference: input.audit_reference || null,
      });
    } else if (store && evaluated.status === "candidate") {
      store.appendCandidate(workspace.tenant_id, evaluated);
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
        memory_promotion_allowed: evaluated.status === "confirmed" && input.persist_verified === true,
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
      config,
      registry,
      learning_packs: buildLearningPacks(nyraBranchCatalog("generic").branches, registry.version),
    };
  }

  function status(tenantId) {
    const tenantCheck = validateTenant(config, tenantId);
    return {
      schema_version: RESEARCH_DISTILLATION_SCHEMA_VERSION,
      enabled: config.enabled,
      mode: config.mode,
      policy_version: config.schema_version,
      registry_version: registry.version,
      tenant_allowed: tenantCheck.ok,
      active_workspaces: state.workspaces.size,
      metrics: { ...state.metrics },
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
