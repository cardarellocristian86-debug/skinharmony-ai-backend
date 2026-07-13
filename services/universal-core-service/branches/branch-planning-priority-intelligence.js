export const branchPlanningPriorityIntelligence = {
  id: "planning_priority_intelligence",
  file: "branch-planning-priority-intelligence.js",
  tier: "base",
  label: "Planning & Priority Intelligence",
  domain: "horizontal_work",
  production_status: "advisory",
  description: "Scompone il lavoro, ordina priorita e dipendenze e costruisce piani verificabili e reversibili.",
  subbranches: [
    "work_breakdown", "priority_matrix", "dependency_graph", "critical_path", "effort_estimation",
    "value_estimation", "risk_adjusted_order", "milestone_design", "capacity_fit", "timebox_design",
    "decision_points", "fallback_sequence", "definition_of_ready", "next_action_selection", "plan_summary",
  ],
  rules: [
    "Ordinare il lavoro per valore, rischio, dipendenze e costo di ritardo dichiarati.",
    "Rendere espliciti prerequisiti, blocchi, milestone, verifiche e piano di fallback.",
    "Non confondere una stima con un impegno garantito.",
    "Una corsia parallela puo partire solo se proprietario, input e criterio di uscita sono definiti.",
    "Ogni piano operativo deve preservare conferme, audit e rollback richiesti dal Core.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "planning_priority_advisory",
    blocked_actions: ["plan_without_dependencies", "false_precision", "unsafe_parallelization", "plan_bypassing_core_policy"],
  },
};
