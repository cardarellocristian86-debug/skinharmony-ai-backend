export const branchFunnelConversionGuard = {
  id: "funnel_conversion_guard",
  file: "branch-funnel-conversion-guard.js",
  tier: "network",
  label: "Funnel & Conversion Guard",
  domain: "conversion",
  production_status: "advisory",
  description: "Ramo per landing, CTA, funnel, conversioni e tracking. Ottimizza senza promettere risultati.",
  rules: [
    "Ogni funnel deve avere obiettivo, audience, offerta, CTA, prova, tracking e pagina di destinazione.",
    "Non dichiarare miglioramenti percentuali garantiti senza dati verificati.",
    "Distinguere traffico, lead, trial, acquisto, richiesta preventivo e rinnovo.",
    "Tracking e conversion event devono essere espliciti e privacy-safe.",
    "Pubblicazione, cambio checkout o tracking invasivo richiedono review owner.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "funnel_draft_review",
    blocked_actions: [
      "auto_publish_landing",
      "invent_conversion_rate",
      "tracking_without_consent",
      "checkout_change_without_owner",
      "claim_guaranteed_growth",
    ],
  },
};
