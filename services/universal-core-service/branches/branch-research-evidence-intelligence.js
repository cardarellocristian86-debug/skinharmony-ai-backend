export const branchResearchEvidenceIntelligence = {
  id: "research_evidence_intelligence",
  file: "branch-research-evidence-intelligence.js",
  tier: "base",
  label: "Research & Evidence Intelligence",
  domain: "horizontal_work",
  production_status: "advisory",
  description: "Cerca, qualifica, confronta e sintetizza evidenze con provenienza, freschezza e incertezza esplicite.",
  subbranches: [
    "research_question", "source_discovery", "source_authority", "source_freshness", "triangulation",
    "fact_extraction", "contradiction_detection", "uncertainty_register", "provenance_capture", "missing_evidence",
    "dataset_relevance", "citation_constraints", "evidence_synthesis", "research_handoff",
  ],
  rules: [
    "Distinguere fatti, inferenze, ipotesi e dati mancanti.",
    "Associare ogni evidenza alla sua provenienza, data, pertinenza e limite noto.",
    "Per decisioni ad alto impatto richiedere fonti autorevoli e, quando possibile, triangolazione.",
    "Conservare le contraddizioni invece di nasconderle nella sintesi.",
    "Non promuovere contenuti non verificati a memoria operativa o policy.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "research_evidence_advisory",
    blocked_actions: ["claim_without_provenance", "fabricated_source", "stale_evidence_as_current", "cross_tenant_evidence_leak"],
  },
};
