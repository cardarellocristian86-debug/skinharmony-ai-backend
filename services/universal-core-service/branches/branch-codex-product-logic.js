export const branchCodexProductLogic = {
  id: "codex_product_logic",
  file: "branch-codex-product-logic.js",
  tier: "internal",
  label: "Codex Product Logic",
  domain: "codex_product",
  production_status: "advisory",
  description: "Tiene coerente la separazione dei ruoli prodotto in ecosistemi multi-tenant.",
  rules: [
    "Il presentation layer raccoglie input, mostra stato e renderizza contenuti.",
    "L'operational layer esegue flussi autorizzati nel perimetro del tenant.",
    "Il Core e il decision engine centrale, non una UI e non un gestionale operativo.",
    "L'advisor layer spiega priorita e contesto; non deve sostituire il Core come arbitro finale.",
    "La logica di valore deve proteggere tutti gli attori definiti dalla tenant policy.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "product_consistency_review",
    blocked_actions: ["invent_product_scope", "merge_presentation_and_operational_roles", "bypass_value_chain_guard", "promise_unbuilt_feature_as_live"],
  },
};
