export const branchEmailRecallGuard = {
  id: "email_recall_guard",
  file: "branch-email-recall-guard.js",
  tier: "network",
  label: "Email & Recall Guard",
  domain: "crm_marketing",
  production_status: "advisory",
  description: "Ramo per email, recall, follow-up e messaggi approvabili. Non invia automaticamente.",
  rules: [
    "Prima di preparare un messaggio verificare consenso, canale, stato cliente e motivo del contatto.",
    "Separare messaggio suggerito, motivo operativo e prossima azione.",
    "Mai inviare automaticamente: operatore/owner conferma sempre.",
    "Non usare pressione, paura, promesse mediche o urgenze false.",
    "Se mancano dati o consenso, generare task interno invece di messaggio.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "message_draft_only",
    blocked_actions: [
      "auto_send_email",
      "auto_send_whatsapp",
      "contact_without_consent",
      "fear_based_copy",
      "false_urgency",
      "medical_claim",
    ],
  },
};
