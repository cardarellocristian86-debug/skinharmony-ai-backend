export const branchCodexReleaseGate = {
  id: "codex_release_gate",
  file: "branch-codex-release-gate.js",
  tier: "internal",
  label: "Codex Release Gate",
  domain: "codex_release",
  production_status: "advisory",
  description: "Governance di release: versione, zip, manifest, changelog, rollback e deploy controllato.",
  rules: [
    "Una release deve avere versione coerente in codice, manifest, zip e documentazione minima.",
    "Gli update automatici aggressivi restano spenti finche staging, rollback e audit non sono verificati.",
    "Il deploy Render richiede conferma dello stato health dopo la pubblicazione.",
    "Ogni pacchetto installabile deve restare motore: dati cliente e configurazioni vanno salvati in opzioni/database, non hardcoded nello zip.",
    "Se un blocco critico resta aperto, non promuovere la versione come major stabile.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "release_candidate_only",
    blocked_actions: ["major_without_critical_clearance", "auto_update_aggressive", "zip_with_customer_data", "deploy_without_health_check"],
  },
};
