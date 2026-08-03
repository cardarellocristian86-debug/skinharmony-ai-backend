import {
  deterministicBranchTaxonomy,
} from "../../services/universal-core-service/branches/index.js";
import type { NyraActionRoute } from "./nyra-action-router.ts";
import type { NyraBranchOverlay } from "./nyra-branch-overlay.ts";
import type { NyraCore2PipelineResult } from "./nyra-core2-pipeline.ts";

type TaxonomyNode = {
  node_id: string;
  parent_id: string | null;
  depth: number;
  level: string;
  label: string;
  kind: string;
  branch_bindings?: string[];
  semantic_tags?: string[];
};

type TaxonomySynapse = {
  from_node_id: string;
  to_node_id: string;
  reason: string;
  strength: number;
  shared_branch_ids?: string[];
};

export type NyraLearningCycle = {
  mode: "governed_feedback_loop";
  current_phase:
    | "sensory_ingest"
    | "intent_router"
    | "risk_surface"
    | "execution_planning"
    | "verification_contract"
    | "telemetry_capture"
    | "memory_distillation"
    | "policy_reweighting"
    | "synaptic_consolidation";
  next_phase: string;
  auto_learning_scope: "distilled_memory_and_policy_reweighting_only";
  active_signals: string[];
  hard_limits: string[];
};

export type NyraAdaptiveCognition = {
  mode: "governed_adaptive_cognition";
  self_model: {
    type: "bounded_runtime_self_model";
    identity_anchor: "core_nyra_runtime";
    mutable_weights: false;
    free_self_learning: false;
  };
  memory_stack: Array<"episodic" | "semantic" | "procedural" | "policy">;
  reasoning_primitives: Array<
    | "hypothesis_ranking"
    | "cross_branch_transfer"
    | "counterfactual_screening"
    | "verify_before_escalation"
    | "memory_consolidation"
  >;
  adaptation_actions: Array<
    | "reinforce_active_synapses"
    | "distill_success_patterns"
    | "downgrade_weak_paths"
    | "request_verify_for_new_policy"
  >;
  reinforcement_state: {
    primary_branch_id: string;
    active_branch_ids: string[];
    active_synapse_sample: string[];
  };
  runtime_reasoning: {
    hypothesis_ranking: Array<{
      branch_id: string;
      label: string;
      role: "primary" | "supporting" | "watch";
      score: number;
      confidence: number;
      why: string[];
    }>;
    cross_branch_transfer: Array<{
      from_branch_id: string;
      to_branch_id: string;
      transfer_kind: "constraint" | "tone" | "policy" | "execution";
      reusable_signals: string[];
      reason: string;
    }>;
    counterfactual_screening: Array<{
      branch_id: string;
      disposition: "rejected" | "deferred" | "fallback";
      trigger: string;
      reason: string;
    }>;
    verify_before_escalation: {
      escalation_blocked: boolean;
      verification_gate: "open" | "required" | "blocked";
      required_checks: string[];
      release_blockers: string[];
      safe_scope: string[];
    };
    memory_consolidation: {
      next_phase: "memory_distillation" | "policy_reweighting" | "synaptic_consolidation";
      candidates: Array<{
        source_branch_id: string;
        kind: "policy" | "pattern" | "counterexample" | "playbook";
        summary: string;
        retention: "short" | "medium" | "long";
      }>;
    };
  };
  autonomy_limits: string[];
};

export type NyraCortexGraph = {
  mode: "cortex_graph";
  schema_version: string;
  max_depth: number;
  node_count: number;
  synapse_count: number;
  registry_branch_count: number;
  active_branch_count: number;
  primary_branch_id: string;
  active_group_ids: string[];
  active_paths: Array<{
    branch_id: string;
    labels: string[];
    node_ids: string[];
    max_depth: number;
  }>;
  active_synapses: TaxonomySynapse[];
  learning_cycle: NyraLearningCycle;
  adaptive_cognition: NyraAdaptiveCognition;
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildLearningCycle(input: {
  overlay: NyraBranchOverlay;
  route?: NyraActionRoute;
  pipeline?: NyraCore2PipelineResult;
}): NyraLearningCycle {
  const risk = input.route?.risk_band || "low";
  const executionMode = input.route?.execution_mode || "reply_only";
  const v7 = input.pipeline?.stages?.v7?.path_label || "normal";
  const currentPhase: NyraLearningCycle["current_phase"] =
    risk === "high"
      ? "risk_surface"
      : executionMode === "plan_only"
        ? "execution_planning"
        : v7 === "protect"
          ? "verification_contract"
          : input.overlay.cross_domain
            ? "intent_router"
            : "sensory_ingest";

  const nextPhase =
    currentPhase === "risk_surface"
      ? "verification_contract"
      : currentPhase === "execution_planning"
        ? "telemetry_capture"
        : currentPhase === "verification_contract"
          ? "telemetry_capture"
          : currentPhase === "intent_router"
            ? "memory_distillation"
            : "policy_reweighting";

  return {
    mode: "governed_feedback_loop",
    current_phase: currentPhase,
    next_phase: nextPhase,
    auto_learning_scope: "distilled_memory_and_policy_reweighting_only",
    active_signals: unique([
      input.overlay.primary_branch.id,
      ...(input.overlay.risk_flags || []),
      input.route?.intent || "",
      input.route?.execution_mode || "",
      input.pipeline?.stages?.v7?.path_label || "",
    ]).filter(Boolean),
    hard_limits: [
      "no_weight_training",
      "no_policy_activation_without_verify",
      "no_production_write_without_gate",
    ],
  };
}

function buildAdaptiveCognition(input: {
  overlay: NyraBranchOverlay;
  route?: NyraActionRoute;
  pipeline?: NyraCore2PipelineResult;
  activeSynapses: TaxonomySynapse[];
}): NyraAdaptiveCognition {
  const topBranches = input.overlay.active_branches.slice(0, 6);
  const primaryBranch = input.overlay.primary_branch;
  const routeIntent = input.route?.intent || "unknown";
  const v7Path = input.pipeline?.stages?.v7?.path_label || "normal";
  const renderProtected = Boolean(input.overlay.render_protected || input.route?.render_protected);
  const verificationRequired =
    input.route?.execution_mode === "dry_run" ||
    input.route?.execution_mode === "plan_only" ||
    input.route?.execution_mode === "blocked" ||
    renderProtected ||
    v7Path === "verify" ||
    v7Path === "protect";
  const verificationBlocked =
    input.route?.execution_mode === "blocked" ||
    input.pipeline?.winner?.control_level === "blocked";

  const hypothesisRanking = topBranches.map((branch, index) => {
    const role: "primary" | "supporting" | "watch" =
      index === 0 ? "primary" : index <= 2 ? "supporting" : "watch";
    const confidence = Math.max(0.15, Math.min(0.99, branch.score / 100));
    const why = [
      branch.domain ? `dominio:${branch.domain}` : "",
      branch.tier ? `tier:${branch.tier}` : "",
      ...(branch.signals || []).slice(0, 3),
      role === "primary" ? `intent:${routeIntent}` : "",
    ].filter(Boolean);
    return {
      branch_id: branch.id,
      label: branch.label,
      role,
      score: branch.score,
      confidence: Math.round(confidence * 1000) / 1000,
      why,
    };
  });

  const crossBranchTransfer = topBranches
    .slice(1, 5)
    .map((branch) => {
      const sharedSignals = (branch.signals || []).filter((signal) => String(signal).startsWith("synapse:")).slice(0, 2);
      const sameDomain = branch.domain && branch.domain === primaryBranch.domain;
      return {
        from_branch_id: primaryBranch.id,
        to_branch_id: branch.id,
        transfer_kind: sameDomain
          ? "execution"
          : (branch.group_ids || []).some((groupId) => (primaryBranch.group_ids || []).includes(groupId))
            ? "policy"
            : branch.domain === "assistant" || branch.domain === "governance"
              ? "tone"
              : "constraint",
        reusable_signals: sharedSignals.length ? sharedSignals : (branch.signals || []).slice(0, 2),
        reason: sameDomain
          ? `${primaryBranch.id} puo riusare pattern operativi di ${branch.id}`
          : `${branch.id} aggiunge vincoli o tono al ramo dominante ${primaryBranch.id}`,
      };
    });

  const counterfactualScreening = [
    renderProtected
      ? {
          branch_id: "render_boundary",
          disposition: "rejected" as const,
          trigger: "render_protected",
          reason: "il testo tocca Render o produzione, quindi la scrittura live non entra nel perimetro locale",
        }
      : null,
    input.overlay.cross_domain
      ? {
          branch_id: "multi_domain_overlay",
          disposition: "deferred" as const,
          trigger: "cross_domain_overlap",
          reason: "piu domini sono attivi insieme, quindi il ramo secondario va verificato prima di assorbire policy nuove",
        }
      : null,
    {
      branch_id: primaryBranch.id,
      disposition: verificationRequired ? "fallback" : "deferred",
      trigger: `route:${routeIntent}`,
      reason: verificationRequired
        ? "si resta su risposta o dry-run finche verify, gate e perimetro non sono chiari"
        : "il ramo principale resta attivo senza escalation operativa",
    },
  ].filter(Boolean) as NyraAdaptiveCognition["runtime_reasoning"]["counterfactual_screening"];

  const requiredChecks = [
    verificationRequired ? "confermare perimetro locale/render prima di escalation" : "",
    v7Path === "protect" ? "passare dal path V7 protect e non aprire esecuzione" : "",
    input.overlay.risk_flags.includes("security_surface_mentioned") ? "verificare surface security e segreti" : "",
    input.overlay.risk_flags.includes("automation_surface_mentioned") ? "verificare effetto di automazione e blast radius" : "",
  ].filter(Boolean);

  const releaseBlockers = [
    verificationBlocked ? "winner blocked dal Core 2.0" : "",
    renderProtected ? "render/prod boundary attivo" : "",
    input.route?.requires_owner_confirmation ? "owner confirmation richiesta" : "",
  ].filter(Boolean);

  const memoryCandidates = topBranches.slice(0, 4).map((branch, index) => ({
    source_branch_id: branch.id,
    kind: (index === 0
      ? "playbook"
      : branch.domain === "governance" || branch.domain === "security"
        ? "policy"
        : branch.signals.some((signal) => String(signal).startsWith("synapse:"))
          ? "pattern"
          : "counterexample") as "policy" | "pattern" | "counterexample" | "playbook",
    summary:
      index === 0
        ? `tenere ${branch.id} come playbook dominante per richieste ${routeIntent}`
        : `distillare ${branch.id} con segnali ${branch.signals.slice(0, 2).join(", ") || "deboli"}`,
    retention: index === 0 ? "long" as const : index <= 2 ? "medium" as const : "short" as const,
  }));

  return {
    mode: "governed_adaptive_cognition",
    self_model: {
      type: "bounded_runtime_self_model",
      identity_anchor: "core_nyra_runtime",
      mutable_weights: false,
      free_self_learning: false,
    },
    memory_stack: ["episodic", "semantic", "procedural", "policy"],
    reasoning_primitives: [
      "hypothesis_ranking",
      "cross_branch_transfer",
      "counterfactual_screening",
      "verify_before_escalation",
      "memory_consolidation",
    ],
    adaptation_actions: [
      "reinforce_active_synapses",
      "distill_success_patterns",
      "downgrade_weak_paths",
      "request_verify_for_new_policy",
    ],
    reinforcement_state: {
      primary_branch_id: input.overlay.primary_branch.id,
      active_branch_ids: input.overlay.active_branches.slice(0, 6).map((branch) => branch.id),
      active_synapse_sample: input.activeSynapses.slice(0, 8).map((synapse) => synapse.reason),
    },
    runtime_reasoning: {
      hypothesis_ranking: hypothesisRanking,
      cross_branch_transfer: crossBranchTransfer,
      counterfactual_screening: counterfactualScreening,
      verify_before_escalation: {
        escalation_blocked: verificationBlocked,
        verification_gate: verificationBlocked ? "blocked" : verificationRequired ? "required" : "open",
        required_checks: requiredChecks,
        release_blockers: releaseBlockers,
        safe_scope: [
          "reply_only",
          "dry_run",
          "memory_distillation",
          verificationBlocked ? "" : "verified_local_execution",
        ].filter(Boolean),
      },
      memory_consolidation: {
        next_phase: verificationBlocked
          ? "memory_distillation"
          : verificationRequired
            ? "policy_reweighting"
            : "synaptic_consolidation",
        candidates: memoryCandidates,
      },
    },
    autonomy_limits: [
      "no_weight_training",
      "no_consciousness_claim",
      "no_free_self_learning",
      "no_policy_activation_without_verify",
      "no_production_write_without_gate",
    ],
  };
}

function descendantsByParent(nodes: TaxonomyNode[]): Map<string, TaxonomyNode[]> {
  const map = new Map<string, TaxonomyNode[]>();
  for (const node of nodes) {
    const parentId = node.parent_id || "__root__";
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId)!.push(node);
  }
  for (const value of map.values()) value.sort((a, b) => a.depth - b.depth || a.node_id.localeCompare(b.node_id));
  return map;
}

function nodesById(nodes: TaxonomyNode[]): Map<string, TaxonomyNode> {
  return new Map(nodes.map((node) => [node.node_id, node]));
}

function ancestry(nodeId: string, byId: Map<string, TaxonomyNode>): TaxonomyNode[] {
  const path: TaxonomyNode[] = [];
  let cursor = byId.get(nodeId);
  while (cursor) {
    path.push(cursor);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return path.reverse();
}

function branchPath(branchId: string, nodes: TaxonomyNode[], byId: Map<string, TaxonomyNode>): TaxonomyNode[] {
  const branchNode = nodes.find((node) => node.node_id === `${branchId}__branch`);
  if (!branchNode) return [];
  const path = ancestry(branchNode.node_id, byId);
  const branchStages = nodes
    .filter((node) => (node.branch_bindings || []).includes(branchId) && node.depth > branchNode.depth)
    .sort((a, b) => a.depth - b.depth || a.node_id.localeCompare(b.node_id));
  return [...path, ...branchStages];
}

export function buildNyraCortexGraph(input: {
  branch_overlay: NyraBranchOverlay;
  action_route?: NyraActionRoute;
  core2_pipeline?: NyraCore2PipelineResult;
}): NyraCortexGraph {
  const taxonomy = deterministicBranchTaxonomy() as {
    schema_version: string;
    max_depth: number;
    node_count: number;
    synapse_count: number;
    branch_count?: number;
    nodes: TaxonomyNode[];
    synapses: TaxonomySynapse[];
  };
  const nodes = Array.isArray(taxonomy.nodes) ? taxonomy.nodes : [];
  const synapses = Array.isArray(taxonomy.synapses) ? taxonomy.synapses : [];
  const activeBranchIds = unique((input.branch_overlay.active_branches || []).slice(0, 6).map((branch) => branch.id));
  const byId = nodesById(nodes);
  const activePaths = activeBranchIds
    .map((branchId) => {
      const pathNodes = branchPath(branchId, nodes, byId);
      return {
        branch_id: branchId,
        labels: pathNodes.map((node) => node.label),
        node_ids: pathNodes.map((node) => node.node_id),
        max_depth: pathNodes.reduce((max, node) => Math.max(max, node.depth), 0),
      };
    })
    .filter((entry) => entry.node_ids.length > 0);

  const activeNodeIds = new Set(activePaths.flatMap((entry) => entry.node_ids));
  const activeSynapses = synapses.filter((synapse) => {
    const sharedBranchIds = Array.isArray(synapse.shared_branch_ids) ? synapse.shared_branch_ids : [];
    return (
      activeNodeIds.has(synapse.from_node_id) ||
      activeNodeIds.has(synapse.to_node_id) ||
      sharedBranchIds.some((branchId) => activeBranchIds.includes(branchId))
    );
  });

  return {
    mode: "cortex_graph",
    schema_version: taxonomy.schema_version || "branch_taxonomy_v3",
    max_depth: Number(taxonomy.max_depth) || 30,
    node_count: Number(taxonomy.node_count) || nodes.length,
    synapse_count: Number(taxonomy.synapse_count) || synapses.length,
    registry_branch_count: Number(taxonomy.branch_count) || 0,
    active_branch_count: activeBranchIds.length,
    primary_branch_id: input.branch_overlay.primary_branch.id,
    active_group_ids: input.branch_overlay.active_group_ids || [],
    active_paths: activePaths,
    active_synapses: activeSynapses.slice(0, 48),
    learning_cycle: buildLearningCycle({
      overlay: input.branch_overlay,
      route: input.action_route,
      pipeline: input.core2_pipeline,
    }),
    adaptive_cognition: buildAdaptiveCognition({
      overlay: input.branch_overlay,
      route: input.action_route,
      pipeline: input.core2_pipeline,
      activeSynapses: activeSynapses.slice(0, 48),
    }),
  };
}

export function summarizeNyraCortexGraph(graph?: NyraCortexGraph): string {
  if (!graph) return "";
  const pathSummary = graph.active_paths
    .slice(0, 3)
    .map((entry) => `${entry.branch_id}@${entry.max_depth}`)
    .join(" | ");
  return `Cortex ${graph.schema_version}: rami attivi ${graph.active_branch_count}/${graph.registry_branch_count}, profondita ${graph.max_depth}, sinapsi ${graph.synapse_count}, fase ${graph.learning_cycle.current_phase}${pathSummary ? `, path ${pathSummary}` : ""}`;
}
