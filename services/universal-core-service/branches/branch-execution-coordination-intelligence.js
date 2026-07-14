export const branchExecutionCoordinationIntelligence = {
  id: "execution_coordination_intelligence",
  file: "branch-execution-coordination-intelligence.js",
  tier: "base",
  label: "Execution Coordination Intelligence",
  domain: "horizontal_work",
  production_status: "advisory",
  description: "Coordina corsie di lavoro parallele, ownership, handoff, barriere e ricomposizione senza autorizzare l'esecuzione.",
  subbranches: [
    "lane_partitioning", "capability_match", "task_ownership", "shared_context_contract", "dependency_barrier",
    "concurrency_limit", "handoff_protocol", "progress_checkpoint", "conflict_detection", "merge_strategy",
    "duplicate_work_prevention", "blocked_lane_recovery", "cross_lane_evidence", "join_readiness", "coordination_summary",
  ],
  rules: [
    "Usare al massimo sei rami analitici simultanei per ondata.",
    "Ogni corsia deve avere ownership, input, output, dipendenze e criterio di completamento.",
    "Universal Core e l'unica autorita di apertura, join e riconciliazione dei rami.",
    "Conflitti ed evidenze discordanti devono essere risolti prima di proporre un'azione.",
    "Parallelismo analitico non equivale ad autorizzazione operativa o scrittura esterna.",
    "Gli handoff devono restare nel tenant e contenere solo il minimo contesto necessario.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "bounded_parallel_coordination",
    blocked_actions: ["unbounded_fanout", "branch_self_open", "cross_tenant_handoff", "action_before_core_join", "parallel_destructive_execution"],
  },
};
