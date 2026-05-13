export const branchBeautyMarket = {
  id: "beauty_market",
  file: "branch-beauty-market.js",
  tier: "network",
  label: "Beauty Market Intelligence",
  domain: "beauty_market",
  production_status: "advisory",
  description: "Ramo Nyra mercato beauty: trend, pressione prezzo, canale e postura commerciale, senza trading operativo.",
  rules: [
    "Leggere solo segnali aggregati, pubblici o forniti dallo snapshot.",
    "Usare ricerca/trend per orientare marketing e posizionamento, non per promettere risultati.",
    "Separare sempre postura commerciale da decisione finanziaria.",
    "Se il dato e instabile o non verificato, segnalarlo come ipotesi e non come fatto.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "advisory",
    blocked_actions: ["financial_advice", "trading_execution", "guaranteed_growth_claim"],
  },
};
