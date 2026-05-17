export const branchBeautyProtocolGuard = {
  id: "beauty_protocol_guard",
  file: "branch-beauty-protocol-guard.js",
  tier: "gold",
  label: "Beauty Protocol Guard",
  domain: "beauty_protocol",
  production_status: "test",
  description: "Ramo test per protocolli estetici non medicali: raccolta dati, obiettivo seduta, limiti e conferma operatore.",
  rules: [
    "I protocolli sono suggerimenti operativi non medici e devono essere confermati dall'operatore.",
    "Leggere dati cliente, storico, area, sensibilita, tecnologie disponibili e prodotti autorizzati.",
    "Non promettere diagnosi, guarigione, cura, risultato garantito o trattamento terapeutico.",
    "Se mancano dati o immagini/letture non sono affidabili, produrre una bozza prudente.",
    "Ogni protocollo deve indicare limiti, verifiche e comunicazione cliente sicura.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "protocol_draft_review",
    blocked_actions: ["medical_diagnosis", "guaranteed_result", "operator_confirmation_missing", "unsupported_technology_use"],
  },
};
