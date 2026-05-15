export const branchCodexBusinessGuard = {
  id: "codex_business_guard",
  file: "branch-codex-business-guard.js",
  tier: "internal",
  label: "Codex Business Guard",
  domain: "codex_business",
  production_status: "advisory",
  description: "Controlla coerenza commerciale: prezzi ufficiali, pacchetti, policy, offerte e promesse.",
  rules: [
    "Non inventare prezzi, sconti, condizioni o specifiche tecniche: usare listini e policy ufficiali.",
    "Separare contenuto pubblico da listino interno/preventivi su misura.",
    "Prodotti o moduli possono essere venduti insieme solo se seat, API key, limiti e responsabilita sono espliciti.",
    "I guardrail proteggono governance e coerenza; non promettono compliance legale assoluta.",
    "Ogni proposta commerciale deve indicare cosa e incluso, cosa e extra e cosa richiede setup custom.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "commercial_review",
    blocked_actions: ["invent_price", "promise_guaranteed_results", "hide_extra_costs", "publicize_internal_terms", "claim_legal_certification"],
  },
};
