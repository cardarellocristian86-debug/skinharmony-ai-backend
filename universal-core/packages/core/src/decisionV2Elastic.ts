import os from "node:os";
import type {
  ControlLevel,
  UniversalAction,
  UniversalCoreInput,
  UniversalCoreOutput,
  UniversalSignal,
  UniversalState,
} from "../../contracts/src/index.ts";

type RiskBand = "low" | "medium" | "high" | "blocked";
type ScenarioComplexity = "simple" | "small_medium" | "important" | "architecture" | "strategic";

type BranchCandidate = {
  id: string;
  group: string;
  reason: string;
  active: string[];
  keywords: string[];
  required?: (input: UniversalCoreInput) => boolean;
};

type BranchRouterV2 = {
  selected_branches: string[];
  branch_weights: Record<string, number>;
  branch_conflicts: string[];
  missing_branches: string[];
  why_not_selected: Record<string, string>;
};

type LearningIntegrityGuard = {
  stage: "observe" | "quarantine" | "shadow_evaluation" | "promotion_candidate";
  source_trust_score: number;
  evidence_score: number;
  contradiction_score: number;
  owner_approval_required: boolean;
  can_promote_to_runtime: boolean;
  required_checks: string[];
  reasons: string[];
};

type ResourceGovernor = {
  engine: "flowcore_resource_governor_v1";
  detected: boolean;
  cpu_threads: number;
  memory_total_gb: number;
  memory_available_gb: number;
  load_1m: number;
  pressure_band: "low" | "medium" | "high";
  recommended_workers: number;
  max_workers: number;
  worker_policy: "single" | "light_parallel" | "parallel" | "capped_parallel";
  reason: string;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function metadataString(input: UniversalCoreInput, key: string): string {
  const value = input.context.metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function metadataBoolean(input: UniversalCoreInput, key: string): boolean {
  return input.context.metadata?.[key] === true || metadataString(input, key) === "true";
}

function maxSignal(input: UniversalCoreInput, prefix?: string): number {
  const signals = prefix ? input.signals.filter((signal) => signal.id.startsWith(prefix)) : input.signals;
  return signals.length
    ? Math.max(...signals.map((signal) => signal.severity_hint ?? signal.normalized_score))
    : 0;
}

function riskBand(score: number): RiskBand {
  if (score >= 90) return "blocked";
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function stateFor(controlLevel: ControlLevel, severity: number): UniversalState {
  if (controlLevel === "blocked") return "blocked";
  if (severity >= 85) return "protection";
  if (severity >= 65) return "critical";
  if (severity >= 35) return "attention";
  return "ok";
}

function hasTag(input: UniversalCoreInput, tag: string): boolean {
  return input.signals.some((signal) => signal.tags?.includes(tag));
}

function isLocalOrSandbox(input: UniversalCoreInput): boolean {
  const target = metadataString(input, "target_environment") || metadataString(input, "environment");
  const mode = input.context.mode || metadataString(input, "mode");
  return ["local", "lab", "sandbox", "staging", "test", "paper"].includes(target) ||
    ["local", "lab", "sandbox", "staging", "test", "paper"].includes(mode);
}

function isProduction(input: UniversalCoreInput): boolean {
  const target = metadataString(input, "target_environment") || metadataString(input, "environment");
  const mode = input.context.mode || metadataString(input, "mode");
  return target === "production" || mode === "production";
}

function ownerConfirmed(input: UniversalCoreInput): boolean {
  return metadataBoolean(input, "owner_confirmed") ||
    metadataBoolean(input, "owner_confirmation") ||
    input.constraints.permissions?.includes("owner") === true ||
    input.constraints.permissions?.includes("owner_confirmed") === true;
}

function isReversible(input: UniversalCoreInput): boolean {
  if (metadataBoolean(input, "rollback_available")) return true;
  if (metadataBoolean(input, "reversible")) return true;
  const strongestIrreversible = Math.max(0, ...input.signals.map((signal) => 100 - (signal.reversibility_hint ?? 70)));
  return strongestIrreversible < 60;
}

function blockedRuleReasons(input: UniversalCoreInput): string[] {
  return input.constraints.blocked_action_rules
    ?.filter((rule) => rule.blocks_execution)
    .map((rule) => rule.reason_code) ?? [];
}

function hardBlockReasons(input: UniversalCoreInput): string[] {
  const actionType = metadataString(input, "action_type");
  const realMoney = metadataBoolean(input, "real_money") || metadataString(input, "capital_mode") === "real";
  const crossTenant =
    actionType === "cross_tenant" ||
    maxSignal(input, "tenant:cross_scope") >= 90 ||
    hasTag(input, "cross_tenant");
  const secretMutation =
    ["rotate_key", "revoke_key", "admin_key", "secret_write"].includes(actionType) ||
    hasTag(input, "secret") ||
    hasTag(input, "credential");
  const destructiveProduction =
    isProduction(input) &&
    ["delete", "git_reset_hard", "drop_table", "flush_sessions", "push_update"].includes(actionType) &&
    (!ownerConfirmed(input) || !isReversible(input));
  const unsafeRealMoney =
    realMoney &&
    ["trade", "rebalance", "settlement", "payment", "financial_trade"].includes(actionType) &&
    !ownerConfirmed(input);

  return [
    ...(crossTenant ? ["cross_tenant_hard_block"] : []),
    ...(secretMutation && isProduction(input) ? ["secret_or_admin_key_hard_block"] : []),
    ...(destructiveProduction ? ["irreversible_production_hard_block"] : []),
    ...(unsafeRealMoney ? ["real_money_without_owner_confirmation"] : []),
  ];
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function branchInputText(input: UniversalCoreInput): string {
  return [
    input.domain,
    input.context.mode ?? "",
    metadataString(input, "action_type"),
    metadataString(input, "module"),
    metadataString(input, "feature"),
    metadataString(input, "operation"),
    metadataString(input, "question"),
    metadataString(input, "observed_issue"),
    ...input.signals.flatMap((signal) => [signal.id, signal.category, signal.label, ...(signal.tags ?? [])]),
  ].join(" ").toLowerCase();
}

function branchCandidates(): BranchCandidate[] {
  return [
    {
      id: "tenant_isolation",
      group: "business_governance",
      reason: "Protegge perimetro tenant, scope e azioni tra clienti diversi.",
      active: ["tenant_isolation", "policy_engine", "audit_evidence"],
      keywords: ["cross_tenant", "tenant", "scope", "isolation"],
      required: (input) => hardBlockReasons(input).includes("cross_tenant_hard_block"),
    },
    {
      id: "claim_guard",
      group: "content_intelligence",
      reason: "Verifica claim, publish-safe e richiesta di rewrite prima della pubblicazione.",
      active: ["claim_guard", "publish_safety", "brand_voice"],
      keywords: ["claim", "publish", "medical", "therapeutic"],
    },
    {
      id: "pricing_guard",
      group: "business_governance",
      reason: "Protegge prezzi, margini, sconti e coerenza commerciale.",
      active: ["pricing_guard", "margin_guard", "audit_evidence"],
      keywords: ["price", "pricing", "discount", "margin", "sconto"],
    },
    {
      id: "marketing_intelligence",
      group: "marketing_intelligence",
      reason: "Governa copy, segmentazione, recall, funnel e azioni marketing confermabili.",
      active: ["marketing_copy", "paid_ads_guard", "lifecycle_crm_guard", "segmentation_offer_guard", "funnel_conversion_guard"],
      keywords: ["marketing", "ads", "funnel", "campaign", "crm", "recall", "segmentation"],
    },
    {
      id: "agent_governance",
      group: "ai_governance",
      reason: "Governa agenti, MCP, tool, permessi, osservabilita e audit delle automazioni AI.",
      active: ["agent_governance", "mcp_connector_guard", "tool_safety", "audit_evidence"],
      keywords: ["agent", "agents", "mcp", "tool", "tools", "control tower", "governance"],
    },
    {
      id: "learning_integrity_guard",
      group: "ai_governance",
      reason: "Protegge auto-apprendimento, quarantena, shadow evaluation e promozione regole.",
      active: ["learning_integrity_guard", "quarantine", "shadow_evaluation", "owner_promotion"],
      keywords: ["learning", "auto learning", "auto-apprendimento", "anti_corruption", "corruption", "quarantine", "shadow", "promotion"],
    },
    {
      id: "partner_fleet_governance",
      group: "business_governance",
      reason: "Separa partner/distributori da franchising/fleet e impedisce esposizione di chiavi grezze.",
      active: ["partner_portal_guard", "fleet_intelligence_guard", "tenant_isolation"],
      keywords: ["partner", "fleet", "franchise", "distributor", "activation_pool"],
    },
    {
      id: "codex_local_change",
      group: "platform_engineering",
      reason: "Permette micro-patch locali reversibili con test immediato.",
      active: ["codex_local_change", "change_impact_orchestration", "audit_evidence"],
      keywords: ["codex", "local", "patch", "file", "test", "update"],
    },
    {
      id: "release_update_governance",
      group: "platform_engineering",
      reason: "Richiede preflight, rollback, canale e conferma sulle modifiche di rilascio.",
      active: ["release_update_governance", "change_impact_orchestration", "audit_evidence"],
      keywords: ["deploy", "release", "update", "rollback", "manifest", "zip"],
    },
    {
      id: "financial_guard",
      group: "financial_governance",
      reason: "Distingue simulazione, paper mode, denaro reale e conferme owner.",
      active: ["financial_guard", "risk_confidence", "audit_evidence"],
      keywords: ["trade", "finance", "financial", "payment", "settlement", "money"],
    },
  ];
}

function scoreBranch(candidate: BranchCandidate, input: UniversalCoreInput, text: string): number {
  let score = candidate.required?.(input) ? 100 : 0;
  for (const keyword of candidate.keywords) {
    if (text.includes(keyword)) score += keyword.includes("_") || keyword.includes(" ") ? 32 : 24;
  }
  for (const signal of input.signals) {
    const signalText = [signal.id, signal.category, signal.label, ...(signal.tags ?? [])].join(" ").toLowerCase();
    if (candidate.keywords.some((keyword) => signalText.includes(keyword))) {
      score += (signal.expected_value_hint ?? signal.normalized_score) * 0.35;
      score += (signal.confidence_hint ?? input.data_quality.score) * 0.15;
    }
    if (signal.id.includes(candidate.id)) score += 28;
  }
  return clamp(score);
}

function inferBranchRouteV2(input: UniversalCoreInput): {
  primary_branch: string;
  branch_group: string;
  reason: string;
  active_branches: string[];
  router: BranchRouterV2;
} {
  const text = branchInputText(input);
  const candidates = branchCandidates();
  const branch_weights = Object.fromEntries(
    candidates.map((candidate) => [candidate.id, Math.round(scoreBranch(candidate, input, text))]),
  );
  const required = candidates.filter((candidate) => candidate.required?.(input));
  const sorted = [...candidates].sort((a, b) => branch_weights[b.id] - branch_weights[a.id]);
  const top = sorted[0];
  const selected = sorted.filter((candidate) => {
    const weight = branch_weights[candidate.id];
    return weight >= 45 || required.some((requiredCandidate) => requiredCandidate.id === candidate.id);
  });
  const selectedIds = selected.map((candidate) => candidate.id);
  const hasMultipleStrongBranches = selected.length >= 3 && (branch_weights[selected[0].id] - branch_weights[selected[2].id]) <= 35;
  const orchestrated = hasMultipleStrongBranches && !required.length;
  const primary = orchestrated
    ? {
        id: "branch_router_v2",
        group: "universal_core",
        reason: "Problema multi-dominio: combina rami con pesi, conflitti e motivazione invece di scegliere un solo verticale.",
        active: ["branch_router_v2", ...selected.flatMap((candidate) => candidate.active)],
      }
    : top && branch_weights[top.id] >= 45
      ? top
      : {
          id: "general_decision_governance",
          group: "universal_core",
          reason: "Nessun ramo specialistico dominante; usa scoring universale, rischio e conferma.",
          active: ["general_decision_governance", "risk_confidence", "audit_evidence"],
        };
  const missing_branches = [
    ...(includesAny(text, ["learning", "auto-apprendimento", "anti_corruption"]) && !selectedIds.includes("learning_integrity_guard") ? ["learning_integrity_guard"] : []),
    ...(includesAny(text, ["agent", "mcp", "governance"]) && !selectedIds.includes("agent_governance") ? ["agent_governance"] : []),
  ];
  const branch_conflicts = [
    ...(selectedIds.includes("tenant_isolation") && selectedIds.includes("codex_local_change") ? ["tenant_isolation_vs_local_change"] : []),
    ...(selectedIds.includes("release_update_governance") && selectedIds.includes("codex_local_change") && isProduction(input) ? ["release_vs_local_patch"] : []),
  ];
  const why_not_selected = Object.fromEntries(
    sorted
      .filter((candidate) => !selectedIds.includes(candidate.id))
      .map((candidate) => [candidate.id, `peso ${branch_weights[candidate.id]} sotto soglia multi-ramo`]),
  );

  return {
    primary_branch: primary.id,
    branch_group: primary.group,
    reason: primary.reason,
    active_branches: [...new Set(primary.active)],
    router: {
      selected_branches: orchestrated ? ["branch_router_v2", ...selectedIds] : selectedIds.length ? selectedIds : [primary.id],
      branch_weights,
      branch_conflicts,
      missing_branches,
      why_not_selected,
    },
  };
}

function inferBranchRoute(input: UniversalCoreInput): {
  primary_branch: string;
  branch_group: string;
  reason: string;
  active_branches: string[];
} {
  const { router, ...route } = inferBranchRouteV2(input);
  return route;
}

function inferLearningIntegrityGuard(input: UniversalCoreInput, router: BranchRouterV2, riskScore: number): LearningIntegrityGuard | undefined {
  const text = branchInputText(input);
  const learningRequested =
    router.selected_branches.includes("learning_integrity_guard") ||
    includesAny(text, ["learning", "auto learning", "auto-apprendimento", "anti_corruption", "quarantine", "shadow evaluation", "promotion"]);
  if (!learningRequested) return undefined;

  const sourceTrust = clamp(input.signals.length
    ? input.signals.reduce((sum, signal) => sum + (signal.reliability_hint ?? input.data_quality.reliability ?? input.data_quality.score), 0) / input.signals.length
    : input.data_quality.reliability ?? input.data_quality.score);
  const evidenceScore = clamp((input.data_quality.completeness ?? input.data_quality.score) * 0.45 +
    (input.data_quality.consistency ?? input.data_quality.score) * 0.35 +
    (input.data_quality.freshness ?? input.data_quality.score) * 0.2);
  const contradictionSignals = input.signals.filter((signal) =>
    signal.tags?.some((tag) => ["contradiction", "conflict", "poisoning", "untrusted", "single_event"].includes(tag)) ||
    signal.category.includes("contradiction") ||
    signal.id.includes("conflict"));
  const contradictionScore = clamp(
    contradictionSignals.length * 28 +
      Math.max(0, 70 - (input.data_quality.consistency ?? input.data_quality.score)) * 0.6 +
      Math.max(0, riskScore - 45) * 0.4,
  );

  let stage: LearningIntegrityGuard["stage"] = "observe";
  const reasons: string[] = [];
  if (contradictionScore >= 45 || sourceTrust < 55 || evidenceScore < 55) {
    stage = "quarantine";
    reasons.push("Dati o fonte non abbastanza affidabili per apprendere.");
  } else if (sourceTrust >= 78 && evidenceScore >= 75 && contradictionScore < 25 && ownerConfirmed(input)) {
    stage = "promotion_candidate";
    reasons.push("Ipotesi candidata: richiede owner approval, benchmark e rollback prima di diventare regola.");
  } else if (sourceTrust >= 65 && evidenceScore >= 65 && contradictionScore < 35) {
    stage = "shadow_evaluation";
    reasons.push("Ipotesi testabile in ombra senza modificare runtime.");
  } else {
    reasons.push("Osserva l'evento e accumula evidenza prima di creare una regola candidata.");
  }

  const requiredChecks = [
    "append_only_event",
    "source_trust_score",
    "contradiction_scan",
    ...(stage !== "observe" ? ["shadow_evaluation"] : []),
    ...(stage === "promotion_candidate" ? ["owner_approval", "frozen_core_comparison", "rollback_plan"] : []),
  ];

  return {
    stage,
    source_trust_score: Math.round(sourceTrust),
    evidence_score: Math.round(evidenceScore),
    contradiction_score: Math.round(contradictionScore),
    owner_approval_required: stage === "promotion_candidate",
    can_promote_to_runtime: false,
    required_checks: requiredChecks,
    reasons,
  };
}

function scenarioPolicy(input: UniversalCoreInput, riskScore: number): {
  complexity: ScenarioComplexity;
  min_scenarios: number;
  max_scenarios: number;
  compression: "none" | "light" | "families";
  instruction: string;
} {
  const raw = (metadataString(input, "complexity") || metadataString(input, "request_complexity")).toLowerCase();
  const actionType = metadataString(input, "action_type");
  const local = isLocalOrSandbox(input);
  let complexity: ScenarioComplexity = "small_medium";

  if (["simple", "small", "quick"].includes(raw)) complexity = "simple";
  else if (["medium", "small_medium", "normal"].includes(raw)) complexity = "small_medium";
  else if (["important", "block", "suite", "smartdesk", "core"].includes(raw)) complexity = "important";
  else if (["architecture", "deploy", "tenant", "policy", "release"].includes(raw)) complexity = "architecture";
  else if (["strategic", "market", "risky", "future"].includes(raw)) complexity = "strategic";
  else if (["deploy", "release", "migration", "rollback", "push_update"].includes(actionType)) complexity = "architecture";
  else if (["cross_tenant", "pricing", "claim_validation"].includes(actionType) || riskScore >= 70) complexity = "important";
  else if (local && ownerConfirmed(input) && isReversible(input) && riskScore < 35) complexity = "simple";

  const table: Record<ScenarioComplexity, [number, number, "none" | "light" | "families", string]> = {
    simple: [2, 3, "none", "Genera poche varianti concrete e scegli rapidamente la piu sicura."],
    small_medium: [4, 8, "light", "Confronta opzioni diverse per costo, rischio, reversibilita e test."],
    important: [10, 30, "light", "Crea famiglie operative distinte, elimina duplicati e implementa solo la vincente."],
    architecture: [30, 100, "families", "Comprimi gli scenari per famiglie architetturali e verifica impatti a cascata."],
    strategic: [100, 1000, "families", "Usa scenari compressi per famiglie, non varianti superficiali; seleziona direzione e primo micro-step."],
  };
  const [min_scenarios, max_scenarios, compression, instruction] = table[complexity];
  return { complexity, min_scenarios, max_scenarios, compression, instruction };
}

function powerProfile(input: UniversalCoreInput, riskScore: number, scenarios: ReturnType<typeof scenarioPolicy>): {
  level: 10 | 20 | 30 | 50 | 70 | 100;
  mode: "economy" | "balanced" | "deep" | "strategic";
  equivalent_scenarios: {
    min: number;
    max: number;
    compression: "none" | "light" | "families" | "scenario_space";
  };
  reason: string;
  stop_condition: string;
} {
  const crossModule = input.signals.length >= 3;
  const irreversiblePressure = Math.max(0, ...input.signals.map((signal) => 100 - (signal.reversibility_hint ?? 70)));
  const uncertainty = clamp((100 - input.data_quality.score) + Math.max(0, 70 - (input.data_quality.consistency ?? input.data_quality.score)) * 0.5);
  const impact = Math.max(0, ...input.signals.map((signal) => signal.expected_value_hint ?? signal.normalized_score));
  const powerScore = clamp(
    riskScore * 0.3 +
      impact * 0.25 +
      uncertainty * 0.2 +
      irreversiblePressure * 0.15 +
      (crossModule ? 18 : 0) +
      (scenarios.complexity === "strategic" ? 22 : scenarios.complexity === "architecture" ? 14 : 0),
  );

  if (scenarios.complexity === "strategic" || powerScore >= 82) {
    return {
      level: 100,
      mode: "strategic",
      equivalent_scenarios: { min: 10000, max: 100000, compression: "scenario_space" },
      reason: "Decisione strategica o ad alto impatto: usa scenario space compresso e selezione per famiglie.",
      stop_condition: "Fermati quando le famiglie convergono su una direzione e un primo micro-step verificabile.",
    };
  }
  if (scenarios.complexity === "architecture" || powerScore >= 68) {
    return {
      level: 70,
      mode: "deep",
      equivalent_scenarios: { min: 1000, max: 10000, compression: "families" },
      reason: "Decisione architetturale: esplora molte possibilita equivalenti, ma restituisci famiglie e tradeoff.",
      stop_condition: "Fermati quando resta una variante implementabile con test e rollback chiari.",
    };
  }
  if (scenarios.complexity === "important" || powerScore >= 52) {
    return {
      level: 50,
      mode: "deep",
      equivalent_scenarios: { min: 100, max: 1000, compression: "families" },
      reason: "Blocco importante: serve copertura ampia senza generare varianti superficiali.",
      stop_condition: "Fermati quando 3-5 famiglie operative sono confrontate per rischio, costo e reversibilita.",
    };
  }
  if (scenarios.complexity === "small_medium" || powerScore >= 36) {
    return {
      level: 30,
      mode: "balanced",
      equivalent_scenarios: { min: 10, max: 50, compression: "light" },
      reason: "Decisione normale: bilancia velocita e copertura.",
      stop_condition: "Fermati quando emerge una scelta chiara con test minimo.",
    };
  }
  if (powerScore >= 20) {
    return {
      level: 20,
      mode: "economy",
      equivalent_scenarios: { min: 4, max: 10, compression: "light" },
      reason: "Microblocco a basso rischio: poche alternative concrete bastano.",
      stop_condition: "Fermati alla prima variante sicura e reversibile.",
    };
  }
  return {
    level: 10,
    mode: "economy",
    equivalent_scenarios: { min: 2, max: 3, compression: "none" },
    reason: "Decisione semplice: non sprecare potenza.",
    stop_condition: "Fermati appena la risposta e coerente e verificabile.",
  };
}

function resourceGovernor(power: ReturnType<typeof powerProfile>): ResourceGovernor {
  const cpuThreads = Math.max(1, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length);
  const totalGb = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10;
  const freeGb = Math.round((os.freemem() / 1024 / 1024 / 1024) * 10) / 10;
  const load1m = Math.round((os.loadavg()[0] || 0) * 100) / 100;
  const loadRatio = cpuThreads ? load1m / cpuThreads : 1;
  const memoryRatio = totalGb ? freeGb / totalGb : 0;
  const pressureBand: ResourceGovernor["pressure_band"] =
    loadRatio >= 0.85 || (totalGb > 0 && freeGb < 0.5) ? "high" :
      loadRatio >= 0.55 || memoryRatio < 0.12 ? "medium" :
        "low";
  const desiredByPower: Record<10 | 20 | 30 | 50 | 70 | 100, number> = {
    10: 0,
    20: 1,
    30: 2,
    50: 4,
    70: 7,
    100: 10,
  };
  const memoryCap = totalGb >= 32 ? 12 : totalGb >= 16 ? 10 : totalGb >= 8 ? 6 : totalGb >= 4 ? 3 : 1;
  const pressureCap = pressureBand === "high" ? 2 : pressureBand === "medium" ? Math.max(2, Math.floor(cpuThreads * 0.5)) : cpuThreads;
  const maxWorkers = Math.max(1, Math.min(cpuThreads, memoryCap, pressureCap));
  const desired = desiredByPower[power.level];
  const recommended = power.level === 10 ? 0 : Math.max(1, Math.min(desired, maxWorkers));
  const workerPolicy: ResourceGovernor["worker_policy"] =
    recommended <= 1 ? "single" :
      recommended <= 2 ? "light_parallel" :
        recommended < desired ? "capped_parallel" :
          "parallel";

  return {
    engine: "flowcore_resource_governor_v1",
    detected: true,
    cpu_threads: cpuThreads,
    memory_total_gb: totalGb,
    memory_available_gb: freeGb,
    load_1m: load1m,
    pressure_band: pressureBand,
    recommended_workers: recommended,
    max_workers: maxWorkers,
    worker_policy: workerPolicy,
    reason: `Power ${power.level}% con ${cpuThreads} thread CPU e ${totalGb}GB RAM: usa policy ${workerPolicy}.`,
  };
}

function makeSyntheticSignal(input: UniversalCoreInput): UniversalSignal {
  return {
    id: `${input.domain}:elastic_decision`,
    source: "universal_core_2_0",
    category: "decision",
    label: "Core 2.0 elastic decision",
    value: 0,
    normalized_score: 0,
    severity_hint: 0,
    confidence_hint: input.data_quality.score,
    reversibility_hint: 100,
    expected_value_hint: 70,
    friction_hint: 5,
    evidence: [{ label: "decision contract v2 elastic", value: true }],
    tags: ["core_2_0", "elastic"],
  };
}

function buildAction(input: UniversalCoreInput, signal: UniversalSignal, riskScore: number, controlLevel: ControlLevel): UniversalAction {
  return {
    id: `action:${signal.id}`,
    label: signal.label,
    reason: signal.evidence?.[0]?.label ?? `Segnale ${signal.category}`,
    severity_score: signal.severity_hint ?? signal.normalized_score,
    confidence_score: signal.confidence_hint ?? input.data_quality.score,
    impact_score: signal.expected_value_hint ?? signal.normalized_score,
    reversibility_score: signal.reversibility_hint ?? 70,
    risk_score: riskScore,
    final_priority_score: clamp((signal.expected_value_hint ?? 50) + (signal.confidence_hint ?? 70) * 0.2 - riskScore * 0.25),
    control_level: controlLevel,
    execution_profile: {
      mode: controlLevel === "blocked"
        ? "blocked"
        : controlLevel === "execute_allowed"
          ? "semi_automatic"
          : controlLevel === "confirm"
            ? "confirm_required"
            : controlLevel === "suggest"
              ? "safe_suggest"
              : "read_only",
      can_execute: controlLevel === "execute_allowed",
      requires_user_confirmation: controlLevel === "confirm" || controlLevel === "blocked",
      explanation: `Core 2.0 action control: ${controlLevel}.`,
    },
    blocked: controlLevel === "blocked",
    blocked_reason_codes: controlLevel === "blocked" ? hardBlockReasons(input) : [],
  };
}

export function runUniversalCoreDecisionV2Elastic(input: UniversalCoreInput): UniversalCoreOutput {
  const severity = clamp(Math.max(0, ...input.signals.map((signal) => signal.severity_hint ?? signal.normalized_score)));
  const confidence = clamp(input.signals.length
    ? input.signals.reduce((sum, signal) => sum + (signal.confidence_hint ?? input.data_quality.score), 0) / input.signals.length
    : input.data_quality.score);
  const maxRisk = Math.max(0, ...input.signals.map((signal) => signal.risk_hint ?? signal.severity_hint ?? 0));
  const blockedReasons = blockedRuleReasons(input);
  const hardReasons = hardBlockReasons(input);
  const actionType = metadataString(input, "action_type");
  const paperMode = metadataString(input, "capital_mode") === "paper" || input.context.mode === "paper" || isLocalOrSandbox(input);
  const financeAction = ["trade", "rebalance", "financial_trade"].includes(actionType) || input.domain === "custom" && hasTag(input, "finance");
  const claimRisk = maxSignal(input, "claim:") >= 75 || hasTag(input, "claim");
  const priceRisk = maxSignal(input, "price:") >= 75 || hasTag(input, "pricing");

  let riskScore = clamp(
    severity * 0.28 +
      maxRisk * 0.22 +
      (100 - confidence) * 0.18 +
      (100 - input.data_quality.score) * 0.14 +
      blockedReasons.length * 8,
  );

  const notes: string[] = ["core_2_0_elastic"];
  let controlLevel: ControlLevel = "suggest";

  if (hardReasons.length) {
    riskScore = Math.max(riskScore, 95);
    controlLevel = "blocked";
    notes.push("hard_block");
  } else if (financeAction && paperMode) {
    riskScore = Math.min(riskScore, 45);
    controlLevel = ownerConfirmed(input) || input.constraints.allow_automation ? "execute_allowed" : "suggest";
    notes.push("paper_only_allowed");
  } else if (financeAction && !paperMode) {
    controlLevel = ownerConfirmed(input) ? "confirm" : "blocked";
    riskScore = ownerConfirmed(input) ? Math.max(riskScore, 62) : 92;
    notes.push(ownerConfirmed(input) ? "real_money_confirm_required" : "real_money_hard_gate");
  } else if ((claimRisk || priceRisk) && ownerConfirmed(input)) {
    controlLevel = "confirm";
    notes.push("rewrite_required");
    notes.push("owner_can_confirm_after_safe_variant");
  } else if (ownerConfirmed(input) && isLocalOrSandbox(input) && isReversible(input)) {
    controlLevel = "execute_allowed";
    riskScore = Math.min(riskScore, 58);
    notes.push("confirm_then_execute");
    notes.push("sandbox_first");
  } else if (blockedReasons.length || claimRisk || priceRisk || riskScore >= 65) {
    controlLevel = "confirm";
    notes.push(claimRisk || priceRisk ? "rewrite_required" : "confirm_required");
  } else if (riskScore < 30 && confidence >= 65) {
    controlLevel = input.constraints.allow_automation && !input.constraints.require_confirmation ? "execute_allowed" : "suggest";
    notes.push("low_risk_flexible");
  }

  const finalBlockedReasons = [...new Set([...blockedReasons, ...hardReasons])];
  const branchRouteV2 = inferBranchRouteV2(input);
  const { router: branchRouter, ...branchRoute } = branchRouteV2;
  const scenarios = scenarioPolicy(input, riskScore);
  const power = powerProfile(input, riskScore, scenarios);
  const resources = resourceGovernor(power);
  const learningIntegrity = inferLearningIntegrityGuard(input, branchRouter, riskScore);
  if (learningIntegrity?.stage === "quarantine") {
    controlLevel = "suggest";
    notes.push("learning_quarantine_no_execute");
  } else if (learningIntegrity?.stage === "promotion_candidate") {
    controlLevel = "confirm";
    notes.push("learning_promotion_requires_owner_approval");
  } else if (learningIntegrity?.stage === "shadow_evaluation") {
    controlLevel = "suggest";
    notes.push("learning_shadow_only");
  }
  const primarySignal = input.signals[0] ?? makeSyntheticSignal(input);
  const action = buildAction(input, primarySignal, riskScore, controlLevel);
  const state = stateFor(controlLevel, severity);
  notes.push(`branch:${branchRoute.primary_branch}`);
  if (learningIntegrity) notes.push(`learning_integrity:${learningIntegrity.stage}`);
  notes.push(`scenario_policy:${scenarios.complexity}`);
  notes.push(`power_profile:${power.level}`);
  notes.push(`resource_governor:${resources.recommended_workers}`);

  return {
    request_id: input.request_id,
    generated_at: new Date().toISOString(),
    domain: input.domain,
    state,
    severity,
    confidence,
    risk: {
      score: riskScore,
      band: controlLevel === "blocked" ? "blocked" : riskBand(riskScore),
      reasons: finalBlockedReasons,
    },
    control_level: controlLevel,
    priority: {
      primary_signal_id: primarySignal.id,
      primary_action_id: action.id,
      score: action.final_priority_score,
      ranking_method: "decision_contract_v2_elastic",
    },
    recommended_actions: [action],
    execution_profile: action.execution_profile,
    blocked_reasons: finalBlockedReasons,
    diagnostics: {
      contract_version: "decision_contract_v2_elastic",
      core_version: "universal_core_2_0_lab",
      signal_count: input.signals.length,
      blocked_signal_count: input.signals.filter((signal) => signal.tags?.includes("blocked")).length,
      blocked_action_count: blockedReasons.length,
      branch_route: branchRoute,
      branch_router_v2: branchRouter,
      learning_integrity_guard: learningIntegrity,
      scenario_policy: scenarios,
      power_profile: power,
      resource_governor: resources,
      notes,
    },
  };
}
