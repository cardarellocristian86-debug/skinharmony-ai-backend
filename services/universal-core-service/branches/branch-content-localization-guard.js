export const branchContentLocalizationGuard = {
  id: "content_localization_guard",
  file: "branch-content-localization-guard.js",
  tier: "network",
  label: "Content Localization Guard",
  domain: "localization",
  production_status: "advisory",
  description: "Ramo per adattamento multilingua/locale di copy, offerte e contenuti senza tradurre HTML finale.",
  rules: [
    "Tradurre e localizzare stringhe atomiche, non HTML finale.",
    "Mantenere key_path stabili, domain chiaro e fallback alla lingua sorgente.",
    "Adattare tono, valuta, mercato e CTA senza inventare prezzi, prove o normative locali.",
    "Claim e compliance vanno ricontrollati dopo la localizzazione.",
    "Se manca glossario o revisione lingua, produrre bozza e non publish-safe.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "localized_draft_review",
    blocked_actions: [
      "translate_html_blob",
      "unstable_key_path",
      "invent_local_price",
      "skip_claim_recheck",
      "auto_publish_translation",
    ],
  },
};
