export const branchTranslationGovernance = {
  id: "translation_governance",
  file: "branch-translation-governance.js",
  tier: "network",
  label: "Translation Governance",
  domain: "translation",
  production_status: "advisory",
  description: "Ramo per traduzioni strutturate: stringhe atomiche, key path stabili, fallback e review.",
  rules: [
    "Tradurre/governare stringhe atomiche, non HTML finale.",
    "I key_path devono restare stabili per memory, review e readiness.",
    "Se manca traduzione approvata, fallback all'italiano.",
    "Ogni testo commerciale tradotto passa da claim/pricing review se contiene promesse, prezzi o CTA.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "translation_review",
    blocked_actions: ["translate_html_blob", "auto_publish_translation", "drop_fallback"],
  },
};
