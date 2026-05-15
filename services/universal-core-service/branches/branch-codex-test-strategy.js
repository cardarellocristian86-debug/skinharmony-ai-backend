export const branchCodexTestStrategy = {
  id: "codex_test_strategy",
  file: "branch-codex-test-strategy.js",
  tier: "internal",
  label: "Codex Test Strategy",
  domain: "codex_quality",
  production_status: "advisory",
  description: "Stabilisce test minimi, smoke, regression e blocchi prima di dichiarare chiuso un lavoro.",
  rules: [
    "Ogni modifica codice richiede almeno syntax check o test equivalente disponibile.",
    "Se manca il tool di test, dichiarare il limite e usare controlli alternativi sensati.",
    "Per pacchetti installabili verificare versione, manifest, artefatto, endpoint/hook critici e assenza fatal ove possibile.",
    "Per servizi remoti verificare endpoint health, contratto JSON e smoke test locale prima del deploy.",
    "Non dichiarare release-safe se preflight, manifest o rollback non sono coerenti.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "verify_before_release",
    blocked_actions: ["skip_tests_silently", "release_without_preflight", "ignore_failed_smoke", "hide_test_limit"],
  },
};
