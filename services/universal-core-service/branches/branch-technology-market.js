export const branchTechnologyMarket = {
  id: "technology_market",
  file: "branch-technology-market.js",
  tier: "network",
  label: "Technology Trend Intelligence",
  domain: "technology",
  production_status: "advisory",
  description: "Ramo per tecnologie beauty/wellness: domanda, maturita, education, CTA e prudenza claim.",
  rules: [
    "Valutare tecnologia per domanda, maturita, training richiesto, rischio claim e valore commerciale.",
    "Prima education e proof controllata, poi conversione.",
    "Non promettere effetti medici o risultati certi.",
    "Se la tecnologia richiede consenso, privacy o protocollo, segnalarlo prima della CTA.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "advisory",
    blocked_actions: ["medical_claim", "unsafe_protocol", "auto_publish"],
  },
};
