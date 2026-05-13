export const branchRamoTesto = {
  id: "ramo_testo",
  file: "universal-core/packages/branches/ramo-testo/src/index.ts",
  tier: "network",
  label: "Ramo Testo / Content Guard",
  domain: "content_guard",
  production_status: "advisory",
  description: "Layer decisionale per qualita testo, traduzioni, claim risk, brand tone e publish safety.",
  rules: [
    "Valutare stringhe atomiche e testi strutturati, non HTML finale.",
    "Non pubblicare e non correggere automaticamente senza conferma utente.",
    "Bloccare solo in modo soft/advisory pubblicazione, sync pubblico e auto publish quando ci sono claim risk o publish safety.",
    "Distinguere errori linguistici correggibili da rischi claim/compliance che richiedono review owner.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "review_only",
    blocked_actions: ["auto_publish", "public_sync", "medical_claim", "unsafe_claim"],
  },
};
