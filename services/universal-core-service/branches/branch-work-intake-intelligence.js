export const branchWorkIntakeIntelligence = {
  id: "work_intake_intelligence",
  file: "branch-work-intake-intelligence.js",
  tier: "base",
  label: "Work Intake Intelligence",
  domain: "horizontal_work",
  production_status: "advisory",
  description: "Normalizza obiettivi, deliverable, vincoli e criteri di successo prima di pianificare o eseguire lavoro.",
  subbranches: [
    "goal_clarification", "deliverable_definition", "success_criteria", "scope_boundary", "constraint_inventory",
    "stakeholder_context", "urgency_assessment", "resource_context", "dependency_discovery", "ambiguity_detection",
    "assumption_register", "missing_input_request", "decomposition_boundary", "intake_summary",
  ],
  rules: [
    "Separare sempre obiettivo, deliverable, vincoli, ipotesi e dati mancanti.",
    "Non trasformare un requisito ambiguo in un'azione irreversibile.",
    "Definire criteri di successo verificabili prima di consegnare il lavoro ai rami successivi.",
    "Preservare tenant, brand scope, autorizzazioni e limiti del pacchetto durante ogni handoff.",
    "Chiedere chiarimento solo quando l'ambiguita cambia materialmente risultato o rischio.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "work_intake_advisory",
    blocked_actions: ["execution_from_ambiguous_scope", "cross_tenant_intake", "invented_requirement", "silent_scope_expansion"],
  },
};
