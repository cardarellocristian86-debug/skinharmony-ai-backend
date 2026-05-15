const DEFAULT_POLICY = Object.freeze({
  tenant_id: "default",
  domain: "generic_multi_tenant_system",
  vocabulary: {
    presentation_nodes: ["ui_node", "web_client", "admin_console"],
    operational_nodes: ["operational_client", "workflow_app", "field_node"],
    orchestrators: ["core_service", "central_orchestrator"],
    decision_layers: ["decision_engine", "policy_engine"],
    explanation_layers: ["advisor_layer", "assistant_layer"],
  },
  sensitive_domains: ["identity", "permissions", "billing", "publishing", "data_sync", "tenant_data", "deployment"],
  guardrails: {
    forbidden_claims: [],
    protected_terms: [],
    price_policy_mode: "tenant_defined",
    data_isolation: "tenant_scope",
  },
  product_roles: {
    presentation_layer: "Raccoglie input e mostra output.",
    operational_layer: "Esegue flussi autorizzati nel perimetro locale.",
    core_layer: "Decide rischio, priorita, policy e controllo.",
    advisor_layer: "Spiega e prepara azioni senza essere arbitro finale.",
  },
});

const TENANT_POLICIES = Object.freeze({
  regulated_demo: {
    tenant_id: "regulated_demo",
    domain: "regulated_content_demo",
    vocabulary: {
      presentation_nodes: ["ui_node", "web_client", "admin_console"],
      operational_nodes: ["operational_client", "workflow_app", "field_node"],
      orchestrators: ["core_service", "central_orchestrator"],
      decision_layers: ["decision_engine", "policy_engine", "content_guard"],
      explanation_layers: ["advisor_layer", "assistant_layer"],
    },
    sensitive_domains: ["publishing", "regulated_claims", "pricing", "tenant_data", "deployment"],
    guardrails: {
      forbidden_claims: [
        "risultati garantiti",
        "risultato garantito",
        "guaranteed result",
        "guaranteed results",
        "resultados garantizados",
        "resultado garantizado",
        "resultat garanti",
        "resultats garantis",
        "garantiertes ergebnis",
      ],
      protected_terms: ["owner approval", "policy review", "internal range", "recommended range"],
      price_policy_mode: "advisory_not_resale_price_imposition",
      data_isolation: "tenant_scope",
    },
    product_roles: {
      presentation_layer: "Raccoglie input e mostra output.",
      operational_layer: "Esegue flussi autorizzati nel perimetro locale.",
      core_layer: "Decide rischio, priorita, policy e controllo.",
      advisor_layer: "Spiega e prepara azioni senza essere arbitro finale.",
    },
  },
  skinharmony: {
    tenant_id: "skinharmony",
    domain: "beauty_wellness_waas_network",
    vocabulary: {
      presentation_nodes: ["Site Suite", "WordPress node", "template", "landing", "pagina offerte"],
      operational_nodes: ["Smart Desk", "centro", "salone", "nodo operativo"],
      orchestrators: ["SkinHarmony Suite", "Core Admin", "network dashboard"],
      decision_layers: ["Universal Core", "Price Guard", "Claim Guard", "Value Chain Guard"],
      explanation_layers: ["Nyra", "AI Gold", "report advisor"],
    },
    sensitive_domains: ["claim cosmetici", "listini", "margini", "licenze", "dati cliente", "Smart Desk API", "publish sito"],
    guardrails: {
      forbidden_claims: ["cura", "guarisce", "terapia", "medicale", "risultato garantito"],
      protected_terms: ["prezzo consigliato", "range consigliato", "policy interna", "owner approval"],
      price_policy_mode: "advisory_not_resale_price_imposition",
      data_isolation: "brand_scope_and_tenant_scope",
    },
    product_roles: {
      presentation_layer: "Site Suite raccoglie contenuti, lead, offerte e mostra governance.",
      operational_layer: "Smart Desk gestisce agenda, clienti, cassa, magazzino e operativita centro.",
      core_layer: "Universal Core decide rischio, readiness, policy, claim/pricing safety e limiti.",
      advisor_layer: "Nyra spiega priorita, strategia e prossima azione senza sostituire il Core.",
    },
  },
});

export function normalizeTenantId(value) {
  return String(value || "default").toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "_") || "default";
}

export function getTenantPolicy(tenantId, plan = "") {
  const normalized = normalizeTenantId(tenantId);
  const alias = normalized.includes("skinharmony") ? "skinharmony" : normalized.replace(/^tenant_/, "");
  const base = TENANT_POLICIES[normalized] || TENANT_POLICIES[alias] || DEFAULT_POLICY;
  return {
    ...base,
    tenant_id: normalized,
    plan: String(plan || "").trim() || "unspecified",
    source: base === DEFAULT_POLICY ? "default_policy" : "tenant_registry",
    runtime_rule: "Universal Core resta agnostico; la specificita business viene iniettata tramite tenant policy.",
  };
}
