const SOURCE_REGISTRY_VERSION = "nyra_governed_research_source_registry_v1";
const LEARNING_PACK_VERSION = "nyra_governed_research_branch_learning_pack_v1";

function source({
  source_id,
  name,
  base_url,
  allowed_domains,
  source_type,
  branch_bindings,
  reliability_score,
  freshness_policy_days,
  citation_required = true,
  license_policy = "metadata_only",
  allowed_operations = ["search", "fetch_document"],
  blocked_operations = ["authenticate_with_unmanaged_secret", "submit", "write", "purchase"],
  status = "active",
}) {
  return Object.freeze({
    source_id,
    name,
    base_url,
    allowed_domains: Object.freeze([...allowed_domains]),
    source_type,
    branch_bindings: Object.freeze([...branch_bindings]),
    reliability_score,
    freshness_policy_days,
    citation_required,
    license_policy,
    allowed_operations: Object.freeze([...allowed_operations]),
    blocked_operations: Object.freeze([...blocked_operations]),
    status,
  });
}

export const TRUSTED_SOURCE_REGISTRY = Object.freeze({
  schema_version: SOURCE_REGISTRY_VERSION,
  owner: "universal_core",
  status: "active",
  sources: Object.freeze([
    source({
      source_id: "pubmed",
      name: "PubMed",
      base_url: "https://pubmed.ncbi.nlm.nih.gov/",
      allowed_domains: ["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov"],
      source_type: "peer_reviewed_database",
      branch_bindings: ["research_evidence", "quality_verification", "learning_memory", "adaptive_learning"],
      reliability_score: 0.98,
      freshness_policy_days: 90,
    }),
    source({
      source_id: "crossref",
      name: "Crossref",
      base_url: "https://www.crossref.org/",
      allowed_domains: ["crossref.org", "api.crossref.org"],
      source_type: "bibliographic_index",
      branch_bindings: ["research_evidence", "decision_provenance", "quality_verification", "learning_memory"],
      reliability_score: 0.92,
      freshness_policy_days: 365,
    }),
    source({
      source_id: "clinicaltrials",
      name: "ClinicalTrials.gov",
      base_url: "https://clinicaltrials.gov/",
      allowed_domains: ["clinicaltrials.gov"],
      source_type: "clinical_registry",
      branch_bindings: ["research_evidence", "risk_governance", "quality_verification"],
      reliability_score: 0.96,
      freshness_policy_days: 90,
    }),
    source({
      source_id: "eur_lex",
      name: "EUR-Lex",
      base_url: "https://eur-lex.europa.eu/",
      allowed_domains: ["eur-lex.europa.eu"],
      source_type: "regulatory_source",
      branch_bindings: ["research_evidence", "risk_governance", "decision_provenance"],
      reliability_score: 0.97,
      freshness_policy_days: 180,
    }),
    source({
      source_id: "european_commission",
      name: "European Commission",
      base_url: "https://ec.europa.eu/",
      allowed_domains: ["ec.europa.eu", "europa.eu"],
      source_type: "official_documentation",
      branch_bindings: ["research_evidence", "risk_governance", "communication_explanation"],
      reliability_score: 0.95,
      freshness_policy_days: 180,
    }),
    source({
      source_id: "cosing",
      name: "EU CosIng",
      base_url: "https://ec.europa.eu/growth/tools-databases/cosing/",
      allowed_domains: ["ec.europa.eu"],
      source_type: "cosmetic_ingredients_registry",
      branch_bindings: ["research_evidence", "risk_governance", "quality_verification"],
      reliability_score: 0.94,
      freshness_policy_days: 365,
    }),
    source({
      source_id: "sccs",
      name: "Scientific Committee on Consumer Safety",
      base_url: "https://health.ec.europa.eu/scientific-committees/scientific-committee-consumer-safety_en",
      allowed_domains: ["health.ec.europa.eu", "ec.europa.eu"],
      source_type: "regulatory_opinion",
      branch_bindings: ["research_evidence", "risk_governance", "quality_verification"],
      reliability_score: 0.95,
      freshness_policy_days: 365,
    }),
    source({
      source_id: "echa",
      name: "ECHA",
      base_url: "https://echa.europa.eu/",
      allowed_domains: ["echa.europa.eu"],
      source_type: "regulatory_source",
      branch_bindings: ["research_evidence", "risk_governance", "decision_provenance"],
      reliability_score: 0.95,
      freshness_policy_days: 365,
    }),
    source({
      source_id: "wipo",
      name: "WIPO",
      base_url: "https://www.wipo.int/",
      allowed_domains: ["wipo.int"],
      source_type: "standards_and_ip",
      branch_bindings: ["research_evidence", "decision_provenance", "software_intelligence"],
      reliability_score: 0.93,
      freshness_policy_days: 365,
    }),
    source({
      source_id: "euipo",
      name: "EUIPO",
      base_url: "https://euipo.europa.eu/",
      allowed_domains: ["euipo.europa.eu"],
      source_type: "official_documentation",
      branch_bindings: ["research_evidence", "decision_provenance", "risk_governance"],
      reliability_score: 0.92,
      freshness_policy_days: 365,
    }),
    source({
      source_id: "nist",
      name: "NIST",
      base_url: "https://www.nist.gov/",
      allowed_domains: ["nist.gov"],
      source_type: "technical_standard",
      branch_bindings: ["research_evidence", "decision_reasoning", "planning_prioritization", "quality_verification", "software_intelligence", "risk_governance"],
      reliability_score: 0.96,
      freshness_policy_days: 365,
    }),
    source({
      source_id: "github_docs",
      name: "GitHub Docs",
      base_url: "https://docs.github.com/",
      allowed_domains: ["docs.github.com"],
      source_type: "official_vendor_docs",
      branch_bindings: ["software_intelligence", "quality_verification", "decision_provenance"],
      reliability_score: 0.9,
      freshness_policy_days: 180,
    }),
    source({
      source_id: "node_docs",
      name: "Node.js Documentation",
      base_url: "https://nodejs.org/api/",
      allowed_domains: ["nodejs.org"],
      source_type: "official_vendor_docs",
      branch_bindings: ["software_intelligence", "execution_planning", "parallel_coordination"],
      reliability_score: 0.9,
      freshness_policy_days: 180,
    }),
    source({
      source_id: "postgres_docs",
      name: "PostgreSQL Documentation",
      base_url: "https://www.postgresql.org/docs/",
      allowed_domains: ["postgresql.org"],
      source_type: "official_vendor_docs",
      branch_bindings: ["planning_prioritization", "execution_planning", "quality_verification", "research_evidence"],
      reliability_score: 0.9,
      freshness_policy_days: 365,
    }),
    source({
      source_id: "render_docs",
      name: "Render Docs",
      base_url: "https://docs.render.com/",
      allowed_domains: ["docs.render.com", "render.com"],
      source_type: "official_vendor_docs",
      branch_bindings: ["planning_prioritization", "execution_planning", "parallel_coordination", "software_intelligence"],
      reliability_score: 0.88,
      freshness_policy_days: 180,
    }),
    source({
      source_id: "openai_docs",
      name: "OpenAI Docs",
      base_url: "https://platform.openai.com/docs",
      allowed_domains: ["platform.openai.com", "openai.com"],
      source_type: "official_vendor_docs",
      branch_bindings: ["decision_reasoning", "communication_explanation", "software_intelligence", "research_evidence"],
      reliability_score: 0.9,
      freshness_policy_days: 180,
    }),
    source({
      source_id: "fda",
      name: "FDA",
      base_url: "https://www.fda.gov/",
      allowed_domains: ["fda.gov"],
      source_type: "regulatory_source",
      branch_bindings: ["research_evidence", "risk_governance", "quality_verification"],
      reliability_score: 0.96,
      freshness_policy_days: 180,
    }),
    source({
      source_id: "who",
      name: "WHO",
      base_url: "https://www.who.int/",
      allowed_domains: ["who.int"],
      source_type: "regulatory_source",
      branch_bindings: ["research_evidence", "risk_governance", "communication_explanation"],
      reliability_score: 0.95,
      freshness_policy_days: 180,
    }),
  ]),
});

const BRANCH_PACKS = Object.freeze({
  context_intelligence: {
    branch_id: "context_intelligence",
    capability: "request_context_normalization",
    domain: "context",
    risk: "low",
    retention: "ephemeral",
    policy: "context must stay redacted, scoped and source-backed when evidence is attached",
    source_ids: ["nist", "crossref", "openai_docs", "github_docs"],
    verified_knowledge: [
      "Normalize intent before research; keep tenant context and request fingerprint separate from evidence content.",
      "Cache only redacted context fragments; never persist raw prompt or source material into durable memory.",
    ],
  },
  work_intake: {
    branch_id: "work_intake",
    capability: "scope_and_deliverable_discovery",
    domain: "planning",
    risk: "low",
    retention: "ephemeral",
    policy: "intake clarifies problem, constraints, deliverables and missing context before any evidence run",
    source_ids: ["nist", "crossref", "postgres_docs"],
    verified_knowledge: [
      "Separate deliverable definition from implementation detail.",
      "Ask for missing inputs early; do not infer irreversible actions from ambiguous scope.",
    ],
  },
  research_evidence: {
    branch_id: "research_evidence",
    capability: "source_governed_evidence_collection",
    domain: "research",
    risk: "medium",
    retention: "ephemeral",
    policy: "use only allowlisted authoritative sources; retain only redacted evidence references and citations",
    source_ids: ["pubmed", "crossref", "clinicaltrials", "eur_lex", "european_commission", "cosing", "sccs", "echa", "wipo", "euipo", "nist", "fda", "who"],
    verified_knowledge: [
      "Authoritative evidence should prefer primary sources and official documentation before secondary commentary.",
      "Prompt injection and source drift are evidence failures, not just quality issues.",
    ],
  },
  decision_reasoning: {
    branch_id: "decision_reasoning",
    capability: "bounded_choice_evaluation",
    domain: "reasoning",
    risk: "medium",
    retention: "ephemeral",
    policy: "compare alternatives with evidence, uncertainty and policy context; never self-authorize execution",
    source_ids: ["nist", "crossref", "eur_lex", "european_commission", "openai_docs"],
    verified_knowledge: [
      "Keep options explicit and comparable; hidden assumptions belong in the audit trail, not in the verdict.",
      "A high confidence option still needs policy compatibility and rollback clarity.",
    ],
  },
  planning_prioritization: {
    branch_id: "planning_prioritization",
    capability: "bounded_plan_assembly",
    domain: "planning",
    risk: "medium",
    retention: "ephemeral",
    policy: "prioritize by utility, reversibility, budget and dependency before execution planning",
    source_ids: ["nist", "crossref", "postgres_docs", "render_docs"],
    verified_knowledge: [
      "Plan decomposition must respect operational limits before implementation detail.",
      "Dependencies and rollback readiness rank above convenience or raw speed.",
    ],
  },
  risk_governance: {
    branch_id: "risk_governance",
    capability: "policy_and_safety_review",
    domain: "governance",
    risk: "high",
    retention: "ephemeral",
    policy: "fail closed on privacy, tenant mismatch, source trust, SSRF and destructive side effects",
    source_ids: ["nist", "eur_lex", "european_commission", "echa", "fda", "who"],
    verified_knowledge: [
      "If provenance or tenant scope is unclear, the safest answer is abstention or a narrower request.",
      "Governance issues must be surfaced as blockers, not normalized away.",
    ],
  },
  delegated_authority: {
    branch_id: "delegated_authority",
    capability: "authority_boundary_validation",
    domain: "governance",
    risk: "high",
    retention: "ephemeral",
    policy: "delegation must be bounded by identity, scope, expiry and explicit Core authorization",
    source_ids: ["nist", "github_docs", "node_docs", "render_docs"],
    verified_knowledge: [
      "Delegation chains should be inspectable and revocable.",
      "A caller-provided claim of authority is never enough without server-side verification.",
    ],
  },
  decision_provenance: {
    branch_id: "decision_provenance",
    capability: "audit_join_and_replayability",
    domain: "governance",
    risk: "medium",
    retention: "ephemeral",
    policy: "retain only redacted lineage, contracts and hashes; do not persist raw chain-of-thought",
    source_ids: ["nist", "crossref", "eur_lex", "european_commission", "github_docs"],
    verified_knowledge: [
      "Decision provenance must be reconstructable from compact evidence, not from hidden reasoning dumps.",
      "Rollback references are part of the contract for every governed decision.",
    ],
  },
  execution_planning: {
    branch_id: "execution_planning",
    capability: "runbook_and_release_shaping",
    domain: "execution",
    risk: "high",
    retention: "ephemeral",
    policy: "separate planning from execution; execution requires Core verdict and owner confirmation when impactful",
    source_ids: ["render_docs", "postgres_docs", "node_docs", "github_docs"],
    verified_knowledge: [
      "Release plans should be bounded, reversible and observability-backed.",
      "An execution plan is not an execution permit.",
    ],
  },
  parallel_coordination: {
    branch_id: "parallel_coordination",
    capability: "bounded_multilane_execution",
    domain: "coordination",
    risk: "medium",
    retention: "ephemeral",
    policy: "fan out only within limits, then join through Core with no orphaned branches",
    source_ids: ["node_docs", "postgres_docs", "github_docs", "render_docs"],
    verified_knowledge: [
      "Parallelism is useful only when ownership and join conditions are explicit.",
      "Every lane needs a blocker, a budget and a rollback path.",
    ],
  },
  quality_verification: {
    branch_id: "quality_verification",
    capability: "validation_and_regression",
    domain: "verification",
    risk: "medium",
    retention: "ephemeral",
    policy: "prefer positive, negative, adversarial and regression checks before promotion",
    source_ids: ["nist", "crossref", "github_docs", "node_docs", "postgres_docs", "render_docs"],
    verified_knowledge: [
      "Verification should prove both the happy path and the failure modes that would otherwise regress quietly.",
      "A verified result with missing fallback is still incomplete governance.",
    ],
  },
  learning_memory: {
    branch_id: "learning_memory",
    capability: "memory_distillation_readiness",
    domain: "learning",
    risk: "medium",
    retention: "verified",
    policy: "retain only lessons with provenance, outcome and review; never store raw work traces as memory",
    source_ids: ["crossref", "nist", "github_docs", "openai_docs"],
    verified_knowledge: [
      "Learning memory should compress successful patterns, not archive every intermediate trace.",
      "A lesson without outcome and review is only a candidate.",
    ],
  },
  adaptive_learning: {
    branch_id: "adaptive_learning",
    capability: "verified_learning_loop",
    domain: "learning",
    risk: "medium",
    retention: "verified",
    policy: "learning candidates are proposed from outcome, then verified, then promoted by Core",
    source_ids: ["crossref", "nist", "github_docs", "openai_docs", "postgres_docs"],
    verified_knowledge: [
      "An improvement loop requires expected-vs-actual comparison and explicit review gates.",
      "Automatic policy change is forbidden without benchmark and verification.",
    ],
  },
  communication_explanation: {
    branch_id: "communication_explanation",
    capability: "audience_safe_explanation",
    domain: "communication",
    risk: "low",
    retention: "ephemeral",
    policy: "explain clearly, cite evidence, and do not leak sensitive internal reasoning",
    source_ids: ["european_commission", "openai_docs", "github_docs", "node_docs"],
    verified_knowledge: [
      "Audience-safe explanations should separate verified fact from advisory interpretation.",
      "Citations are part of explanation quality, not optional decoration.",
    ],
  },
  software_intelligence: {
    branch_id: "software_intelligence",
    capability: "source_governed_static_analysis",
    domain: "software",
    risk: "high",
    retention: "ephemeral",
    policy: "use official docs and verified artifact provenance; no arbitrary writes or unmanaged secrets",
    source_ids: ["github_docs", "node_docs", "postgres_docs", "render_docs", "nist", "wipo", "euipo", "openai_docs"],
    verified_knowledge: [
      "Static analysis should preserve artifact authority and provenance before any deeper inspection.",
      "High-risk analysis must remain sandboxed and reversible.",
    ],
  },
});

const BRANCH_IDS = Object.freeze(Object.keys(BRANCH_PACKS));

function normalizeBranchId(value) {
  return String(value || "").trim();
}

export function getBranchLearningPack(branchId) {
  const id = normalizeBranchId(branchId);
  const pack = BRANCH_PACKS[id];
  if (!pack) return null;
  return {
    manifest: {
      branch_id: pack.branch_id,
      version: LEARNING_PACK_VERSION,
      description: `${pack.branch_id} governed learning pack`,
      domain: pack.domain,
      capability: pack.capability,
      policy: pack.policy,
      catalog_version: "nyra_governed_research_catalog_v1",
      source_registry_version: SOURCE_REGISTRY_VERSION,
      last_reviewed_at: "2026-07-25T00:00:00.000Z",
      owner: "universal_core",
      risk_level: pack.risk,
      retention: pack.retention,
      compatibility: { v1: true, v2: true, dtt: true },
    },
    source_ids: [...pack.source_ids],
    verified_knowledge: [...pack.verified_knowledge],
  };
}

export function listBranchLearningPacks(branchIds = BRANCH_IDS) {
  return branchIds.map((branchId) => getBranchLearningPack(branchId)).filter(Boolean);
}

export function getSourceById(sourceId) {
  return TRUSTED_SOURCE_REGISTRY.sources.find((source) => source.source_id === sourceId) || null;
}

export function getSourceByHostname(hostname) {
  const value = String(hostname || "").toLowerCase();
  return TRUSTED_SOURCE_REGISTRY.sources.find((source) => source.allowed_domains.some((domain) => value === domain || value.endsWith(`.${domain}`))) || null;
}

export function branchesForQuestion(question, domainPackId = "generic") {
  const text = String(question || "").toLowerCase();
  const selected = new Set(["context_intelligence", "work_intake"]);
  if (/(research|source|eviden|paper|study|pubmed|trial|literature|citazione|bibliography)/.test(text)) selected.add("research_evidence");
  if (/(decision|choose|choice|opzione|tradeoff|compare|confront|reason|perche|why)/.test(text)) selected.add("decision_reasoning");
  if (/(plan|planning|priorit|roadmap|milestone|sequence|roadmap|road map)/.test(text)) selected.add("planning_prioritization");
  if (/(risk|rischio|security|privacy|policy|tenant|ssrf|compliance|govern)/.test(text)) selected.add("risk_governance");
  if (/(delegate|delegation|authority|identity|token|scope|auth|credential|permess|authority)/.test(text)) selected.add("delegated_authority");
  if (/(provenance|provenien|audit|rollback|trace|lineage|verdict|decision envelope)/.test(text)) selected.add("decision_provenance");
  if (/(execute|implementation|deploy|render|release|runbook|rollout)/.test(text)) selected.add("execution_planning");
  if (/(parallel|concurrent|agent|coordination|handoff|fan[- ]?out)/.test(text)) selected.add("parallel_coordination");
  if (/(test|verify|benchmark|regression|quality|quality verification|validation)/.test(text)) selected.add("quality_verification");
  if (/(learn|learning|memory|lesson|distill|distillation|candidate)/.test(text)) selected.add("learning_memory");
  if (/(adapt|improve|feedback|outcome|verified learning)/.test(text)) selected.add("adaptive_learning");
  if (/(explain|spiega|summary|riassum|communication|chat|reply)/.test(text)) selected.add("communication_explanation");
  if (/(software|code|repo|artifact|ghidra|frida|binary|reverse engineering|render|node|postgres|github)/.test(text)) selected.add("software_intelligence");
  if (domainPackId !== "generic" && /analyzer|beauty|scalp/.test(domainPackId)) selected.add("quality_verification");
  if (selected.has("research_evidence") && !selected.has("quality_verification")) selected.add("quality_verification");
  return [...selected].filter((branchId) => BRANCH_IDS.includes(branchId));
}

export function allowedSourcesForBranches(branchIds = []) {
  const sourceIds = new Set();
  for (const branchId of branchIds) {
    const pack = getBranchLearningPack(branchId);
    for (const sourceId of pack?.source_ids || []) sourceIds.add(sourceId);
  }
  return [...sourceIds].map((sourceId) => getSourceById(sourceId)).filter(Boolean);
}

export function isSourceAllowedForBranch(sourceId, branchId) {
  const source = getSourceById(sourceId);
  if (!source) return false;
  return source.branch_bindings.includes(branchId);
}
