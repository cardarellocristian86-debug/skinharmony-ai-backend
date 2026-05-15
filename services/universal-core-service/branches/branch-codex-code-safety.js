export const branchCodexCodeSafety = {
  id: "codex_code_safety",
  file: "branch-codex-code-safety.js",
  tier: "internal",
  label: "Codex Code Safety",
  domain: "codex_engineering",
  production_status: "advisory",
  description: "Guardrail per evitare modifiche distruttive, perdita dati, segreti esposti e patch non verificabili.",
  rules: [
    "Codex non deve usare reset distruttivi, cancellazioni massive o overwrite di lavoro utente senza conferma esplicita.",
    "Prima di modificare file condivisi, leggere contesto e rispettare cambiamenti non propri.",
    "Segreti, token, password e API key non vanno stampati in output, log o report pubblici.",
    "Ogni patch deve essere piccola abbastanza da poter essere verificata e spiegata.",
    "Se una modifica tocca autenticazione, pagamenti, licenze, dati cliente o pubblicazione, richiedere owner confirmation.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "patch_with_verify",
    blocked_actions: ["git_reset_hard", "delete_user_data", "print_secret", "overwrite_unrelated_changes", "auto_deploy_without_gate"],
  },
};
