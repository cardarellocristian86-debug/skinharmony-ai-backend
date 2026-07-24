"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "nyra_deep_branch_v2_shadow_telemetry_v1";
const AGGREGATE_SCHEMA_VERSION = "nyra_deep_branch_v2_shadow_aggregate_v1";
const DEFAULT_MAX_READ_BYTES = 16 * 1024 * 1024;
const BASELINE_BRANCH_IDS = new Set([
  "context_intelligence",
  "work_intake",
  "risk_governance",
]);
const MANDATORY_CORE_BRANCH_IDS = new Set([
  "context_intelligence",
  "work_intake",
  "research_evidence",
  "decision_reasoning",
  "planning_prioritization",
  "risk_governance",
  "execution_planning",
  "parallel_coordination",
  "quality_verification",
  "learning_memory",
  "adaptive_learning",
]);

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value?.id || value || "").trim())
    .filter((value) => /^[a-z][a-z0-9_]{1,63}$/.test(value)))].sort();
}

function uniqueSubbranchKeys(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^[a-z][a-z0-9_]{1,63}\.[a-z][a-z0-9_]{1,63}$/.test(value)))].sort();
}

function openedBranches(corePayload) {
  const candidates = [
    corePayload?.result?.nyra_neural_network?.opened_branches,
    corePayload?.nyra_neural_network?.opened_branches,
    corePayload?.result?.result?.nyra_neural_network?.opened_branches,
  ];
  return uniqueIds(candidates.find(Array.isArray) || []);
}

function deniedBranches(corePayload) {
  const candidates = [
    corePayload?.result?.nyra_neural_network?.denied_branches,
    corePayload?.nyra_neural_network?.denied_branches,
    corePayload?.result?.result?.nyra_neural_network?.denied_branches,
  ];
  return uniqueIds(candidates.find(Array.isArray) || []);
}

function evaluationSummary(evaluations) {
  const states = {};
  const reasons = {};
  const evaluatedBranchIds = [];
  const evaluatedSubbranchKeys = [];
  let verified = 0;
  let abstained = 0;
  let humanReview = 0;
  let denied = 0;
  let fallback = 0;
  let notActivated = 0;

  for (const evaluation of Array.isArray(evaluations) ? evaluations : []) {
    const state = String(evaluation?.state || "unknown").slice(0, 96);
    states[state] = (states[state] || 0) + 1;
    const nodeParts = String(evaluation?.node_id || "").split(".");
    const branchId = String(evaluation?.branch_id || nodeParts[0] || "");
    if (/^[a-z][a-z0-9_]{1,63}$/.test(branchId)) evaluatedBranchIds.push(branchId);
    const subbranchId = String(evaluation?.subbranch_id || nodeParts[1] || "");
    if (
      /^[a-z][a-z0-9_]{1,63}$/.test(branchId)
      && /^[a-z][a-z0-9_]{1,63}$/.test(subbranchId)
    ) evaluatedSubbranchKeys.push(`${branchId}.${subbranchId}`);
    for (const reason of uniqueIds(evaluation?.reason_codes)) {
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
    if (state === "advisory_verified") verified += 1;
    else if (state.startsWith("human_review_required_")) {
      abstained += 1;
      humanReview += 1;
    } else if (state.startsWith("denied_")) {
      abstained += 1;
      denied += 1;
    } else if (state.startsWith("fallback_")) {
      abstained += 1;
      fallback += 1;
    } else if (state.startsWith("not_activated_")) {
      notActivated += 1;
    }
  }

  return {
    attempted_node_count: Array.isArray(evaluations) ? evaluations.length : 0,
    verified_node_count: verified,
    abstention_count: abstained,
    human_review_count: humanReview,
    denied_count: denied,
    fallback_count: fallback,
    not_activated_count: notActivated,
    evaluated_branch_ids: uniqueIds(evaluatedBranchIds),
    evaluated_subbranch_keys: uniqueSubbranchKeys(evaluatedSubbranchKeys),
    state_counts: states,
    reason_code_counts: reasons,
  };
}

function buildShadowTelemetryEvent({
  observedAt = new Date().toISOString(),
  service = "nyra-horizontal-runtime",
  tenantId = "",
  domainPackId = "",
  localInterpretation = {},
  corePayload = {},
  deepBranchV2 = {},
  requestedSubbranchId = "",
  coreLatencyMs = 0,
  deepLatencyMs = 0,
} = {}) {
  const proposed = uniqueIds(localInterpretation?.proposed_branches);
  const coreOpened = openedBranches(corePayload);
  const coreDenied = deniedBranches(corePayload);
  const selected = uniqueIds(deepBranchV2?.selected_branches);
  const evaluated = evaluationSummary(deepBranchV2?.evaluations);
  const signalBranches = uniqueIds([
    ...proposed.filter((id) => !BASELINE_BRANCH_IDS.has(id)),
    ...coreOpened.filter((id) => !MANDATORY_CORE_BRANCH_IDS.has(id)),
    ...evaluated.evaluated_branch_ids,
  ]);
  const coreOpenedSet = new Set(coreOpened);
  const selectedSet = new Set(selected);
  const selectedOutsideCore = selected.filter((id) => !coreOpenedSet.has(id));
  const coreNotSelected = coreOpened.filter((id) => !selectedSet.has(id));
  const safeSubbranchId = /^[a-z][a-z0-9_]{1,63}$/.test(String(requestedSubbranchId || ""))
    ? String(requestedSubbranchId)
    : null;

  return {
    schema_version: SCHEMA_VERSION,
    event_id: `nyra_shadow_${crypto.randomUUID()}`,
    observed_at: new Date(observedAt).toISOString(),
    service: String(service || "nyra-horizontal-runtime").slice(0, 96),
    tenant_id: /^[a-zA-Z0-9_-]{1,96}$/.test(String(tenantId || "")) ? String(tenantId) : null,
    domain_pack_id: /^[a-z][a-z0-9_-]{1,63}$/.test(String(domainPackId || "")) ? String(domainPackId) : null,
    catalog_fingerprint: /^[a-f0-9]{64}$/.test(String(deepBranchV2?.catalog_fingerprint || ""))
      ? String(deepBranchV2.catalog_fingerprint)
      : null,
    rollout: {
      mode: String(deepBranchV2?.mode || "disabled").slice(0, 32),
      state: String(deepBranchV2?.state || "unknown").slice(0, 96),
    },
    v1_route: {
      proposed_branch_ids: proposed,
      core_opened_branch_ids: coreOpened,
      core_denied_branch_ids: coreDenied,
    },
    v2_route: {
      selected_branch_ids: selected,
      signal_branch_ids: signalBranches,
      requested_subbranch_id: safeSubbranchId,
      selected_outside_core_ids: selectedOutsideCore,
      core_opened_not_selected_ids: coreNotSelected,
      execution_authorized: deepBranchV2?.execution_authorized === true,
      core_final_authority: deepBranchV2?.core_final_authority === true,
    },
    evaluation: evaluated,
    timing_ms: {
      core: Number(Math.max(0, Number(coreLatencyMs) || 0).toFixed(3)),
      deep_v2: Number(Math.max(0, Number(deepLatencyMs) || 0).toFixed(3)),
    },
    measurement_limits: {
      collision_observable: false,
      collision_reason: "candidate_subbranch_scores_not_emitted",
      subbranch_use_requires_evaluation: true,
      mandatory_open_is_not_usage: true,
    },
    privacy: {
      raw_prompt_stored: false,
      prompt_hash_stored: false,
      request_id_stored: false,
      evidence_payload_stored: false,
      node_input_stored: false,
      pii_fields_stored: false,
    },
  };
}

function appendShadowTelemetry(filePath, event) {
  if (!event || event.schema_version !== SCHEMA_VERSION) throw new Error("invalid_shadow_telemetry_event");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
}

function readShadowTelemetry(filePath, { maxBytes = DEFAULT_MAX_READ_BYTES } = {}) {
  if (!fs.existsSync(filePath)) return { events: [], malformed_line_count: 0, truncated: false };
  const stat = fs.statSync(filePath);
  const bytesToRead = Math.min(stat.size, Math.max(1024, Number(maxBytes) || DEFAULT_MAX_READ_BYTES));
  const start = Math.max(0, stat.size - bytesToRead);
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(bytesToRead);
  try {
    fs.readSync(descriptor, buffer, 0, bytesToRead, start);
  } finally {
    fs.closeSync(descriptor);
  }
  let text = buffer.toString("utf8");
  if (start > 0) text = text.slice(Math.max(0, text.indexOf("\n") + 1));
  let malformed = 0;
  const events = [];
  for (const line of text.split("\n").filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event?.schema_version === SCHEMA_VERSION) events.push(event);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { events, malformed_line_count: malformed, truncated: start > 0 };
}

function incrementCounts(target, values) {
  for (const value of values) target[value] = (target[value] || 0) + 1;
}

function addObjectCounts(target, source) {
  for (const [key, count] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + Number(count || 0);
  }
}

function aggregateShadowTelemetry(events, {
  days,
  now = Date.now(),
  knownBranchIds = [],
  knownSubbranchIds = [],
} = {}) {
  const windowDays = days === 7 ? 7 : 30;
  const cutoff = Number(now) - windowDays * 24 * 60 * 60 * 1000;
  const branchOpened = {};
  const branchSignalled = {};
  const branchEvaluated = {};
  const subbranchEvaluated = {};
  const states = {};
  const reasons = {};
  const fingerprints = new Set();
  let abstentions = 0;
  let humanReviews = 0;
  let denied = 0;
  let fallbacks = 0;
  let notActivated = 0;
  let attemptedNodes = 0;
  let verifiedNodes = 0;
  let selectedOutsideCore = 0;
  let coreNotSelected = 0;
  let authorityViolations = 0;
  let noDeepContext = 0;
  let collisionObservableEvents = 0;
  const inWindow = (Array.isArray(events) ? events : []).filter((event) => {
    const timestamp = Date.parse(String(event?.observed_at || ""));
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= Number(now);
  });

  for (const event of inWindow) {
    incrementCounts(branchOpened, uniqueIds(event?.v1_route?.core_opened_branch_ids));
    incrementCounts(branchSignalled, uniqueIds(event?.v2_route?.signal_branch_ids));
    incrementCounts(branchEvaluated, uniqueIds(event?.evaluation?.evaluated_branch_ids));
    const evaluatedSubbranches = uniqueSubbranchKeys(event?.evaluation?.evaluated_subbranch_keys);
    if (evaluatedSubbranches.length > 0 && Number(event?.evaluation?.attempted_node_count || 0) > 0) {
      incrementCounts(subbranchEvaluated, evaluatedSubbranches);
    } else {
      noDeepContext += 1;
    }
    addObjectCounts(states, event?.evaluation?.state_counts);
    addObjectCounts(reasons, event?.evaluation?.reason_code_counts);
    attemptedNodes += Number(event?.evaluation?.attempted_node_count || 0);
    verifiedNodes += Number(event?.evaluation?.verified_node_count || 0);
    abstentions += Number(event?.evaluation?.abstention_count || 0);
    humanReviews += Number(event?.evaluation?.human_review_count || 0);
    denied += Number(event?.evaluation?.denied_count || 0);
    fallbacks += Number(event?.evaluation?.fallback_count || 0);
    notActivated += Number(event?.evaluation?.not_activated_count || 0);
    selectedOutsideCore += uniqueIds(event?.v2_route?.selected_outside_core_ids).length;
    coreNotSelected += uniqueIds(event?.v2_route?.core_opened_not_selected_ids).length;
    if (event?.v2_route?.execution_authorized === true || event?.v2_route?.core_final_authority !== true) {
      authorityViolations += 1;
    }
    if (event?.measurement_limits?.collision_observable === true) collisionObservableEvents += 1;
    if (/^[a-f0-9]{64}$/.test(String(event?.catalog_fingerprint || ""))) fingerprints.add(event.catalog_fingerprint);
  }

  const knownBranches = uniqueIds(knownBranchIds);
  const knownSubbranches = uniqueSubbranchKeys(knownSubbranchIds);
  const unusedBranches = knownBranches.filter((id) => !branchSignalled[id] && !branchEvaluated[id]);
  const unusedSubbranches = knownSubbranches.filter((id) => !subbranchEvaluated[id]);

  return {
    schema_version: AGGREGATE_SCHEMA_VERSION,
    window_days: windowDays,
    from: new Date(cutoff).toISOString(),
    to: new Date(now).toISOString(),
    event_count: inWindow.length,
    catalog_fingerprints: [...fingerprints].sort(),
    branch_usage: {
      opened_counts: branchOpened,
      signal_counts: branchSignalled,
      evaluated_counts: branchEvaluated,
      known_count: knownBranches.length,
      used_count: knownBranches.length - unusedBranches.length,
      unused_ids: unusedBranches,
      note: "Mandatory Core opening is reported separately and is not counted as use.",
    },
    subbranch_usage: {
      evaluated_counts: subbranchEvaluated,
      known_count: knownSubbranches.length,
      used_count: knownSubbranches.length - unusedSubbranches.length,
      unused_count: unusedSubbranches.length,
      unused_ids: unusedSubbranches,
      events_without_deep_evaluation: noDeepContext,
    },
    evaluation: {
      attempted_node_count: attemptedNodes,
      verified_node_count: verifiedNodes,
      abstention_count: abstentions,
      human_review_count: humanReviews,
      denied_count: denied,
      fallback_count: fallbacks,
      not_activated_count: notActivated,
      state_counts: states,
      reason_code_counts: reasons,
    },
    parity: {
      selected_outside_core_count: selectedOutsideCore,
      core_opened_not_selected_count: coreNotSelected,
      authority_violation_count: authorityViolations,
    },
    collision_measurement: {
      available: collisionObservableEvents > 0,
      observable_event_count: collisionObservableEvents,
      observed_count: null,
      reason: collisionObservableEvents > 0 ? null : "candidate_subbranch_scores_not_emitted",
    },
    gap_indicators: {
      route_selection_gap_count: selectedOutsideCore + coreNotSelected,
      events_without_deep_evaluation: noDeepContext,
      taxonomy_gap_count: null,
      note: "Missing evidence and absent deep context are not classified as taxonomy gaps.",
    },
  };
}

module.exports = {
  AGGREGATE_SCHEMA_VERSION,
  BASELINE_BRANCH_IDS,
  MANDATORY_CORE_BRANCH_IDS,
  SCHEMA_VERSION,
  aggregateShadowTelemetry,
  appendShadowTelemetry,
  buildShadowTelemetryEvent,
  evaluationSummary,
  readShadowTelemetry,
  uniqueIds,
  uniqueSubbranchKeys,
};
