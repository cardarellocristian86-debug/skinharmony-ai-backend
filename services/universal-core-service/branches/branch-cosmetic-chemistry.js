export const branchCosmeticChemistry = {
  id: "cosmetic_chemistry",
  file: "branch-cosmetic-chemistry.js",
  tier: "network",
  label: "Cosmetic Chemistry Positioning",
  domain: "product",
  production_status: "advisory",
  description: "Ramo per posizionare attivi cosmetici in modo prudente e utile al marketing.",
  rules: [
    "Distinguere funzione cosmetica, percezione cliente, evidenza disponibile e claim non ammessi.",
    "Non trasformare un attivo cosmetico in promessa terapeutica.",
    "Se serve trend o studio aggiornato, dichiarare ricerca richiesta prima della pubblicazione.",
    "Usare linguaggio di supporto cosmetico, benessere e routine, non linguaggio medico.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "advisory",
    blocked_actions: ["therapeutic_claim", "medical_positioning", "guaranteed_result"],
  },
};
