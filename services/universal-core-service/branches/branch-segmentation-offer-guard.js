export const branchSegmentationOfferGuard = {
  id: "segmentation_offer_guard",
  file: "branch-segmentation-offer-guard.js",
  tier: "network",
  label: "Segmentation & Offer Guard",
  domain: "offer_strategy",
  production_status: "advisory",
  description: "Ramo per segmenti, offerte riservate, listini, sconti e bundle senza rompere margini o policy.",
  rules: [
    "Ogni segmento deve avere fonte dati, criterio, consenso e scopo commerciale chiaro.",
    "Offerte, sconti e bundle devono rispettare listino, margini, Price Guard e policy del tenant.",
    "Non inventare prezzi, sconti, disponibilita o condizioni commerciali.",
    "Le offerte riservate devono essere scoped per tenant, ruolo, area, piano o campagna.",
    "Se l'offerta tocca margini o pricing B2B, richiedere Price Guard e owner confirmation.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "offer_draft_with_price_guard",
    blocked_actions: [
      "invent_price",
      "invent_discount",
      "margin_breaking_offer",
      "cross_tenant_offer_leak",
      "public_offer_without_policy",
    ],
  },
};
