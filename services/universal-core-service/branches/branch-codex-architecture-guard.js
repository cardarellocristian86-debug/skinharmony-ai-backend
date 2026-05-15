export const branchCodexArchitectureGuard = {
  id: "codex_architecture_guard",
  file: "branch-codex-architecture-guard.js",
  tier: "internal",
  label: "Codex Architecture Guard",
  domain: "codex_architecture",
  production_status: "advisory",
  description: "Decide dove deve vivere una modifica nel sistema multi-tenant distribuito.",
  rules: [
    "I nodi di presentazione raccolgono e mostrano; il Core decide; i client eseguono solo entro policy.",
    "Non spostare logica decisionale critica dentro prompt liberi o UI periferiche se deve scalare multi-tenant.",
    "Se una funzione serve piu client o tenant, metterla nel Core o in un adapter condiviso.",
    "Mantenere i nodi operativi periferici separati dall'orchestratore centrale.",
    "Preferire adapter e snapshot a sync pesanti o accesso diretto cross-tenant.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "architecture_review",
    blocked_actions: ["monolith_growth_without_reason", "cross_tenant_coupling", "decision_logic_in_prompt_only", "peripheral_role_confusion"],
  },
};
