export const branchMarketingCopy = {
  id: "marketing_copy",
  file: "branch-marketing-copy.js",
  tier: "network",
  label: "Nyra Marketing Copy",
  domain: "marketing",
  production_status: "advisory",
  description: "Ramo copywriting marketing con Claim Guard, briefing strutturato e review owner.",
  rules: [
    "Generare testi chiari, premium e commerciali, senza claim medici o risultati garantiti.",
    "Partire da target, offerta, differenziante, prova e CTA.",
    "Se manca il listino o la policy claim del brand, produrre solo bozza da revisionare.",
    "Ogni testo pubblico passa da Claim Guard e owner review.",
    "Non usare trend, studi, ingredienti o dati di mercato come prova se non sono stati forniti o verificati.",
    "Non inventare testimonianze, case study, clienti, risultati, numeri o sconti.",
    "Per pagine sito, il copy deve indicare cosa serve alla UI: headline, sottotitolo, proof, CTA, blocchi e note di compliance.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "draft_only",
    blocked_actions: ["auto_publish", "medical_claim", "invent_price", "invent_case_study", "fake_testimonial", "unsupported_trend_claim", "public_claim_without_guard"],
  },
};
