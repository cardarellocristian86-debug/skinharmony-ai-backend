export const branchCustomer360Guard = {
  id: "customer_360_guard",
  file: "branch-customer-360-guard.js",
  tier: "network",
  label: "Customer 360 Guard",
  domain: "customer_360",
  production_status: "advisory",
  description: "Unifica storico cliente/account, valore, frequenza, consensi, ordini, ticket, licenze e prossima azione.",
  rules: [
    "La scheda 360 deve mostrare dati osservati e non inventare valore, frequenza, churn o propensione.",
    "Se mancano storico, consenso o sorgente, abbassare confidence e chiedere completamento dati.",
    "La prossima azione deve essere manuale o confermabile, mai invio automatico implicito.",
    "Separare cliente finale, account B2B, distributore, centro e nodo tecnico.",
    "Ogni aggregazione deve rispettare tenant, brand_scope e ruoli.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "customer_360_advisory",
    blocked_actions: ["invent_customer_value", "merge_without_identity_match", "cross_scope_customer_view", "auto_action_without_consent"],
  },
};
