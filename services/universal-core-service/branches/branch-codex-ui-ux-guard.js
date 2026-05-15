export const branchCodexUiUxGuard = {
  id: "codex_ui_ux_guard",
  file: "branch-codex-ui-ux-guard.js",
  tier: "internal",
  label: "Codex UI/UX Guard",
  domain: "codex_ui_ux",
  production_status: "advisory",
  description: "Valuta se una UI e leggibile, enterprise, coerente e usabile da operatori non tecnici.",
  rules: [
    "Le UI operative devono sembrare piattaforma enterprise, non pannello tecnico o database grezzo.",
    "Niente testi che escono dai contenitori; tabelle responsive e card leggibili.",
    "Ogni pulsante visibile deve avere effetto chiaro: link, dialog, salvataggio, duplicazione o feedback.",
    "Evitare etichette tecniche interne nelle UI cliente; tradurle in linguaggio operativo.",
    "Dashboard e CRM devono mostrare prima priorita, rischio e prossima azione; poi dettagli.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "ux_review",
    blocked_actions: ["dead_button", "technical_label_in_client_ui", "overflowing_text", "incoherent_dashboard", "nested_card_noise"],
  },
};
