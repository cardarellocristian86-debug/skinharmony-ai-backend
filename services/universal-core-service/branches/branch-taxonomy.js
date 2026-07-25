const STAGE_SEQUENCE = [
  ["sensory_ingest", "Sensory Ingest", "stage_7", ["ingest", "signals", "capture"]],
  ["intent_router", "Intent Router", "stage_8", ["intent", "routing", "selection"]],
  ["context_binding", "Context Binding", "stage_9", ["context", "binding", "scope"]],
  ["rule_matrix", "Rule Matrix", "stage_10", ["rules", "policy", "constraints"]],
  ["risk_surface", "Risk Surface", "stage_11", ["risk", "surface", "guardrails"]],
  ["execution_planning", "Execution Planning", "stage_12", ["execution", "planning", "variants"]],
  ["verification_contract", "Verification Contract", "stage_13", ["verification", "contract", "evidence"]],
  ["rollback_paths", "Rollback Paths", "stage_14", ["rollback", "recovery", "fallback"]],
  ["telemetry_capture", "Telemetry Capture", "stage_15", ["telemetry", "capture", "runtime"]],
  ["memory_distillation", "Memory Distillation", "stage_16", ["memory", "distillation", "learning"]],
  ["feedback_loop", "Feedback Loop", "stage_17", ["feedback", "loop", "improvement"]],
  ["policy_reweighting", "Policy Reweighting", "stage_18", ["policy", "reweighting", "governance"]],
  ["synaptic_consolidation", "Synaptic Consolidation", "stage_19", ["synapse", "consolidation", "network"]],
  ["terminal_action_model", "Terminal Action Model", "stage_20", ["terminal", "action", "model"]],
  ["outcome_observation", "Outcome Observation", "stage_21", ["outcome", "observation", "evidence"]],
  ["expected_actual_comparison", "Expected Actual Comparison", "stage_22", ["expected", "actual", "comparison"]],
  ["drift_detection", "Drift Detection", "stage_23", ["drift", "detection", "baseline"]],
  ["failure_attribution", "Failure Attribution", "stage_24", ["failure", "attribution", "cause"]],
  ["cross_branch_reconciliation", "Cross Branch Reconciliation", "stage_25", ["cross_branch", "reconciliation", "conflict"]],
  ["knowledge_gap_update", "Knowledge Gap Update", "stage_26", ["knowledge", "gap", "update"]],
  ["policy_candidate_review", "Policy Candidate Review", "stage_27", ["policy", "candidate", "review"]],
  ["human_review_checkpoint", "Human Review Checkpoint", "stage_28", ["human", "review", "checkpoint"]],
  ["verified_learning_commit", "Verified Learning Commit", "stage_29", ["verified", "learning", "commit"]],
  ["continuity_handoff", "Continuity Handoff", "stage_30", ["continuity", "handoff", "next_session"]],
];

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function humanize(value) {
  return String(value || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function classifySuperDomain(branch, groupIds) {
  const id = String(branch?.id || "");
  const domain = String(branch?.domain || "");
  const joined = `${id} ${domain} ${groupIds.join(" ")}`.toLowerCase();
  if (joined.includes("beauty") || joined.includes("analyzer") || joined.includes("smartdesk") || joined.includes("suite")) {
    return {
      id: "vertical_systems",
      label: "Vertical Systems",
      semantic_tags: ["vertical", "beauty", "suite", "smartdesk", "translator"],
    };
  }
  if (joined.includes("learning") || joined.includes("memory") || joined.includes("nyra")) {
    return {
      id: "learning_systems",
      label: "Learning Systems",
      semantic_tags: ["learning", "memory", "feedback", "distillation"],
    };
  }
  if (joined.includes("security") || joined.includes("release") || joined.includes("impact") || joined.includes("guard")) {
    return {
      id: "governance_systems",
      label: "Governance Systems",
      semantic_tags: ["governance", "security", "release", "guardrails"],
    };
  }
  return {
    id: "horizontal_systems",
    label: "Horizontal Systems",
    semantic_tags: ["horizontal", "software", "hardware", "runtime", "infrastructure"],
  };
}

function buildGroupMembership(branches, groups) {
  const membership = new Map();
  for (const branch of branches) {
    membership.set(branch.id, []);
  }
  for (const [groupId, group] of Object.entries(groups || {})) {
    for (const branchId of Array.isArray(group?.branches) ? group.branches : []) {
      if (!membership.has(branchId)) membership.set(branchId, []);
      membership.get(branchId).push(groupId);
    }
  }
  return membership;
}

function pushNode(target, seen, node) {
  if (seen.has(node.node_id)) return;
  seen.add(node.node_id);
  target.push(node);
}

function buildCrossBranchSynapses(branches, membershipByBranch) {
  const synapses = [];
  const push = (fromId, toId, reason, strength) => {
    if (!fromId || !toId || fromId === toId) return;
    synapses.push({
      from_node_id: `${fromId}__branch`,
      to_node_id: `${toId}__branch`,
      reason,
      strength,
      shared_branch_ids: [fromId, toId],
    });
  };

  const byDomain = new Map();
  const byGroup = new Map();
  for (const branch of branches) {
    const domain = slugify(branch.domain || "generic");
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(branch.id);
    for (const groupId of membershipByBranch.get(branch.id) || []) {
      if (!byGroup.has(groupId)) byGroup.set(groupId, []);
      byGroup.get(groupId).push(branch.id);
    }
  }

  for (const ids of byDomain.values()) {
    const sorted = unique(ids).sort();
    for (let index = 0; index < sorted.length - 1; index += 1) {
      push(sorted[index], sorted[index + 1], "shared_domain", 0.68);
    }
  }

  for (const ids of byGroup.values()) {
    const sorted = unique(ids).sort();
    for (let index = 0; index < sorted.length - 1; index += 1) {
      push(sorted[index], sorted[index + 1], "shared_group", 0.82);
    }
  }

  for (const branch of branches) {
    synapses.push(
      {
        from_node_id: `${branch.id}__telemetry_capture`,
        to_node_id: `${branch.id}__memory_distillation`,
        reason: "telemetry_feeds_memory",
        strength: 0.9,
        shared_branch_ids: [branch.id],
      },
      {
        from_node_id: `${branch.id}__memory_distillation`,
        to_node_id: `${branch.id}__feedback_loop`,
        reason: "memory_feeds_feedback",
        strength: 0.92,
        shared_branch_ids: [branch.id],
      },
      {
        from_node_id: `${branch.id}__feedback_loop`,
        to_node_id: `${branch.id}__policy_reweighting`,
        reason: "feedback_reweights_policy",
        strength: 0.94,
        shared_branch_ids: [branch.id],
      },
      {
        from_node_id: `${branch.id}__policy_reweighting`,
        to_node_id: `${branch.id}__synaptic_consolidation`,
        reason: "policy_consolidates_branch",
        strength: 0.96,
        shared_branch_ids: [branch.id],
      },
    );
  }

  return synapses;
}

export function buildBranchTaxonomyFromRegistry({ branches = [], groups = {} } = {}) {
  const nodes = [];
  const seen = new Set();
  const normalizedBranches = [...branches].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const membershipByBranch = buildGroupMembership(normalizedBranches, groups);

  pushNode(nodes, seen, {
    node_id: "universal_cortex",
    parent_id: null,
    depth: 1,
    level: "primary",
    label: "Universal Cortex",
    kind: "root",
    branch_bindings: [],
    semantic_tags: ["core", "nyra", "decision", "memory", "control"],
  });

  for (const branch of normalizedBranches) {
    const branchGroups = unique(membershipByBranch.get(branch.id) || []);
    const primaryGroupId = branchGroups[0] || `${slugify(branch.domain || "generic")}_cluster`;
    const primaryGroup = groups[primaryGroupId] || {
      label: humanize(primaryGroupId),
      description: `Cluster ${primaryGroupId}`,
      branches: [branch.id],
    };
    const superDomain = classifySuperDomain(branch, branchGroups);
    const domainId = `domain_${slugify(branch.domain || "generic")}`;
    const groupNodeId = `group_${slugify(primaryGroupId)}`;
    const tierId = `${groupNodeId}__tier_${slugify(branch.tier || "generic")}`;

    pushNode(nodes, seen, {
      node_id: superDomain.id,
      parent_id: "universal_cortex",
      depth: 2,
      level: "secondary",
      label: superDomain.label,
      kind: "super_domain",
      branch_bindings: [],
      semantic_tags: superDomain.semantic_tags,
    });

    pushNode(nodes, seen, {
      node_id: domainId,
      parent_id: superDomain.id,
      depth: 3,
      level: "tertiary",
      label: humanize(branch.domain || "generic"),
      kind: "domain",
      branch_bindings: [],
      semantic_tags: unique([slugify(branch.domain || "generic"), ...superDomain.semantic_tags.slice(0, 2)]),
    });

    pushNode(nodes, seen, {
      node_id: groupNodeId,
      parent_id: domainId,
      depth: 4,
      level: "quaternary",
      label: primaryGroup.label || humanize(primaryGroupId),
      kind: "group",
      branch_bindings: unique(primaryGroup.branches || []),
      semantic_tags: unique([
        slugify(primaryGroupId),
        ...String(primaryGroup.description || "").split(/\s+/).map(slugify),
      ]).filter(Boolean).slice(0, 8),
    });

    pushNode(nodes, seen, {
      node_id: tierId,
      parent_id: groupNodeId,
      depth: 5,
      level: "quinary",
      label: humanize(branch.tier || "generic"),
      kind: "tier",
      branch_bindings: [],
      semantic_tags: [slugify(branch.tier || "generic"), "tier"],
    });

    pushNode(nodes, seen, {
      node_id: `${branch.id}__branch`,
      parent_id: tierId,
      depth: 6,
      level: "branch",
      label: branch.label,
      kind: "branch",
      branch_bindings: [branch.id],
      semantic_tags: unique([
        slugify(branch.id),
        slugify(branch.domain || "generic"),
        slugify(branch.tier || "generic"),
        ...(Array.isArray(branch.subbranches) ? branch.subbranches.map(slugify) : []),
      ]).filter(Boolean),
    });

    let parentId = `${branch.id}__branch`;
    let depth = 7;
    for (const [stageId, stageLabel, level, tags] of STAGE_SEQUENCE) {
      pushNode(nodes, seen, {
        node_id: `${branch.id}__${stageId}`,
        parent_id: parentId,
        depth,
        level,
        label: `${branch.label} · ${stageLabel}`,
        kind: "stage",
        branch_bindings: [branch.id],
        semantic_tags: unique([slugify(branch.id), ...tags]),
      });
      parentId = `${branch.id}__${stageId}`;
      depth += 1;
    }
  }

  const synapses = buildCrossBranchSynapses(normalizedBranches, membershipByBranch);

  return {
    schema_version: "branch_taxonomy_v3",
    generated_from: "complete_branch_registry",
    max_depth: 6 + STAGE_SEQUENCE.length,
    node_count: nodes.length,
    synapse_count: synapses.length,
    branch_count: normalizedBranches.length,
    group_count: Object.keys(groups || {}).length,
    nodes,
    synapses,
    learning_cycle: {
      mode: "governed_feedback_loop",
      phases: [
        "sensory_ingest",
        "intent_router",
        "context_binding",
        "rule_matrix",
        "risk_surface",
        "execution_planning",
        "verification_contract",
        "rollback_paths",
        "telemetry_capture",
        "memory_distillation",
        "feedback_loop",
        "policy_reweighting",
        "synaptic_consolidation",
        "terminal_action_model",
        "outcome_observation",
        "expected_actual_comparison",
        "drift_detection",
        "failure_attribution",
        "cross_branch_reconciliation",
        "knowledge_gap_update",
        "policy_candidate_review",
        "human_review_checkpoint",
        "verified_learning_commit",
        "continuity_handoff",
      ],
      auto_learning_scope: "distilled_memory_and_policy_reweighting_only",
      hard_limits: [
        "no_weight_training",
        "no_policy_activation_without_verify",
        "no_production_write_without_gate",
      ],
    },
    adaptive_model: {
      mode: "governed_adaptive_cognition",
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
      hard_limits: [
        "no_weight_training",
        "no_consciousness_claim",
        "no_free_self_learning",
        "no_policy_activation_without_verify",
        "no_production_write_without_gate",
      ],
    },
  };
}

export function deterministicBranchTaxonomy() {
  return buildBranchTaxonomyFromRegistry({ branches: [], groups: {} });
}
