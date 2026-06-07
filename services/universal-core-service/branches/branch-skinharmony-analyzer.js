export const branchSkinHarmonyAnalyzer = {
  id: "skinharmony_analyzer",
  file: "branch-skinharmony-analyzer.js",
  tier: "network",
  label: "SkinHarmony Analyzer Ensemble",
  domain: "beauty_analysis",
  production_status: "advisory",
  description: "Ramo Core per leggere punteggi skin analyzer come quadro estetico complessivo, non come singolo punteggio minimo.",
  subbranches: [
    "pores_texture_matrix",
    "sensitivity_reactivity_matrix",
    "barrier_hydration_matrix",
    "pigmentation_tone_matrix",
    "aging_texture_matrix",
  ],
  rules: [
    "Leggere i punteggi come insieme: dominante, secondari, segnali protettivi e relazioni.",
    "Non ridurre la decisione al singolo valore piu basso.",
    "Distinguere idratazione buona da pori/grana non ottimali.",
    "Citare prodotti e protocolli solo se presenti nel payload/catalogo autorizzato.",
    "Usare linguaggio estetico professionale, non diagnosi o promesse cliniche.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: false,
    allowed_action_level: "advisory",
    blocked_actions: ["medical_diagnosis", "therapeutic_claim", "guaranteed_result", "invented_products", "invented_protocols"],
  },
};
