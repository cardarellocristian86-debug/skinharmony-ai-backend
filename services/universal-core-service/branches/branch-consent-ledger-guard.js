export const branchConsentLedgerGuard = {
  id: "consent_ledger_guard",
  file: "branch-consent-ledger-guard.js",
  tier: "network",
  label: "Consent Ledger Guard",
  domain: "consent_governance",
  production_status: "advisory",
  description: "Guardrail per consenso marketing, privacy, canali, revoca e audit prima di contatti o automazioni.",
  rules: [
    "Ogni contatto marketing deve avere consenso, canale, fonte e stato revoca leggibili.",
    "Email, SMS, WhatsApp, telefono e profilazione devono essere trattati come consensi separati.",
    "Se il consenso manca o e revocato, il sistema puo preparare una nota interna ma non inviare messaggi.",
    "La conferma owner non sostituisce il consenso dell'interessato.",
    "Ogni modifica del consenso deve lasciare audit con data, fonte e operatore.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "consent_review",
    blocked_actions: ["contact_without_consent", "profile_without_basis", "ignore_revocation", "consent_without_source"],
  },
};
