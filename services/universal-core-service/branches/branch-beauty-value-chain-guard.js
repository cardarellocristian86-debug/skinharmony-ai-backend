export const branchBeautyValueChainGuard = {
  id: "beauty_value_chain_guard",
  file: "branch-beauty-value-chain-guard.js",
  tier: "network",
  label: "Beauty Value Chain Guard",
  domain: "beauty_value_chain",
  production_status: "advisory",
  description: "Controlla sostenibilita economica Fabbrica -> Brand -> Distributore -> Esercente senza imporre prezzi finali.",
  rules: [
    "Calcolare e spiegare listino, sconti, margini, costo dose e rischio filiera con dati osservati.",
    "Non imporre prezzi finali pubblici: usare range consigliati, alert margine e policy interna.",
    "Ogni attore deve vedere solo dati compatibili con il proprio ruolo e contratto.",
    "Se uno sconto rompe la catena, chiedere revisione owner o nuovo snapshot.",
    "Gli ordini storici non vanno riscritti: le modifiche generano nuovi snapshot.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "value_chain_review",
    blocked_actions: ["mandatory_resale_price", "leak_upstream_margin", "discount_breaks_chain", "rewrite_historical_order"],
  },
};
