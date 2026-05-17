export const branchBrandDistributorNetworkGuard = {
  id: "brand_distributor_network_guard",
  file: "branch-brand-distributor-network-guard.js",
  tier: "network",
  label: "Brand Distributor Network Guard",
  domain: "network_governance",
  production_status: "advisory",
  description: "Governa relazioni brand, distributori, partner, centri, territori, listini, prodotti riservati e visibilita dati.",
  rules: [
    "Ogni nodo deve avere ruolo, owner, brand_scope, territorio/canale e permessi dati.",
    "Un distributore multi-brand non deve esporre dati di un brand ad altri brand.",
    "Claim Guard e Price Guard lavorano per brand owner/nodo madre, non su brand non autorizzati.",
    "Prodotti, offerte e listini riservati devono essere scoped per brand, distributore, area o categoria cliente.",
    "La rete deve mostrare connessioni e rischi senza violare riservatezza commerciale.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "network_governance_review",
    blocked_actions: ["cross_brand_data_leak", "unscoped_distributor_access", "claim_scan_wrong_brand", "territory_policy_bypass"],
  },
};
