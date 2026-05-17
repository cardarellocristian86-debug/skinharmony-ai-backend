export const branchBillingContractGuard = {
  id: "billing_contract_guard",
  file: "branch-billing-contract-guard.js",
  tier: "network",
  label: "Billing Contract Guard",
  domain: "billing_contract",
  production_status: "advisory",
  description: "Controlla piani, setup fee, rinnovi, limiti API/key, contratti, revenue share e scadenze.",
  rules: [
    "Non attivare moduli, seat, chiavi o nodi senza piano, contratto, trial o override owner.",
    "Distinguere prezzo pubblico, preventivo, setup fee, canone, extra, commissioni e settlement.",
    "Ogni rinnovo, sospensione, grace period o upgrade deve essere leggibile e auditato.",
    "La policy commerciale deve definire limiti mensili/annuali e cosa succede alla scadenza.",
    "Non inventare condizioni economiche: usare listino, contratto o proposta approvata.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "billing_contract_review",
    blocked_actions: ["activate_without_commercial_event", "invent_contract_terms", "ignore_expiry", "unscoped_key_generation"],
  },
};
