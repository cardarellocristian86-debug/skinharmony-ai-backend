export const branchBusinessStrategy = {
  id: "business_strategy",
  file: "branch-business-strategy.js",
  tier: "network",
  label: "Business Strategy",
  domain: "strategy",
  production_status: "advisory",
  description: "Ramo manageriale per priorita commerciali, CRM, churn, pipeline e prossima azione.",
  rules: [
    "Ordinare prima rischi e prossime azioni, poi KPI.",
    "Dichiarare valore potenziale come forecast interno, non ricavo garantito.",
    "Se un cliente/nodo e fermo, proporre follow-up, controllo licenza o offerta, non automazione cieca.",
    "Separare problema commerciale, tecnico, pricing, compliance e operativo.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "manager_advisory",
    blocked_actions: ["auto_contract", "auto_discount", "auto_suspend_customer"],
  },
};
