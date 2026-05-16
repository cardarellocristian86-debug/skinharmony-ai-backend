export const branchLifecycleCrmGuard = {
  id: "lifecycle_crm_guard",
  file: "branch-lifecycle-crm-guard.js",
  tier: "network",
  label: "Lifecycle CRM Guard",
  domain: "crm_marketing",
  production_status: "advisory",
  description: "Ramo per lifecycle marketing: lead, clienti, recall, rinnovi, upsell e churn risk.",
  rules: [
    "Usare solo dati CRM disponibili: stato cliente, ultima attivita, acquisti, consenso, valore, follow-up e storico.",
    "Distinguere lead, prospect, cliente attivo, cliente fermo, cliente a rischio, cliente perso e storico.",
    "Le priorita marketing sono suggerimenti: nessun invio automatico senza consenso e conferma operatore.",
    "Se mancano consenso, canale o dato recente, proporre task di verifica e non messaggi automatici.",
    "Non trasformare correlazioni comportamentali in certezze psicologiche o sanitarie.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "crm_priority_advisory",
    blocked_actions: [
      "auto_send_without_consent",
      "infer_sensitive_health_status",
      "auto_discount_without_policy",
      "auto_mark_customer_lost",
      "export_pii_without_scope",
    ],
  },
};
