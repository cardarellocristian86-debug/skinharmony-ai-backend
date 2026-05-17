export const branchJourneyOrchestrationGuard = {
  id: "journey_orchestration_guard",
  file: "branch-journey-orchestration-guard.js",
  tier: "network",
  label: "Journey Orchestration Guard",
  domain: "journey_orchestration",
  production_status: "advisory",
  description: "Governa journey lead, onboarding, follow-up, recall, upsell, renewal e recupero con conferma owner.",
  rules: [
    "Ogni journey deve avere trigger, condizione, canale, consenso, obiettivo, uscita e rollback/log.",
    "Il Core puo suggerire next step, ma l'invio o cambio stato sensibile richiede conferma.",
    "Non avviare automazioni su dati poveri, consenso mancante o target sensibile.",
    "I journey devono essere idempotenti e non duplicare messaggi o task.",
    "Ogni step deve essere auditabile e spiegabile all'utente operativo.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "journey_review",
    blocked_actions: ["journey_without_consent", "auto_send_without_owner", "duplicate_journey_step", "sensitive_targeting"],
  },
};
