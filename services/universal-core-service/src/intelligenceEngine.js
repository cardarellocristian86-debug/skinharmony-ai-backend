import crypto from "node:crypto";

const ENGINE_VERSION = "intelligence_contract_v1";

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function clamp100(value) {
  return clamp(value, 0, 100);
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function list(value, max = 50) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function logit(probability) {
  const p = clamp(probability, 0.01, 0.99);
  return Math.log(p / (1 - p));
}

function logistic(value) {
  return 1 / (1 + Math.exp(-value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function qualityScore(payload = {}) {
  const explicit = payload.data_quality?.score ?? payload.data_quality_score;
  if (Number.isFinite(Number(explicit))) return clamp100(explicit);
  const completeness = Number(payload.data_quality?.completeness ?? 60);
  const freshness = Number(payload.data_quality?.freshness ?? 60);
  const reliability = Number(payload.data_quality?.reliability ?? 60);
  return clamp100(completeness * 0.4 + freshness * 0.2 + reliability * 0.4);
}

function normalizedEvidence(rawEvidence = []) {
  return list(rawEvidence, 100).map((item, index) => {
    const direction = ["against", "negative", "oppose"].includes(text(item?.direction).toLowerCase()) ? "against" : "support";
    return {
      id: text(item?.id, `evidence_${index + 1}`),
      label: text(item?.label ?? item?.description, `Evidence ${index + 1}`),
      direction,
      strength: clamp(item?.strength ?? item?.weight ?? 0.5),
      reliability: clamp(item?.reliability ?? item?.confidence ?? 0.7),
      source: text(item?.source, "provided_context"),
    };
  });
}

function probabilityEstimate(candidate = {}, payload = {}) {
  const explicitPrior = candidate.prior_probability ?? candidate.base_rate ?? candidate.probability;
  const prior = clamp(explicitPrior ?? payload.default_prior ?? 0.5, 0.01, 0.99);
  const evidence = normalizedEvidence(candidate.evidence ?? payload.evidence);
  const posteriorLogOdds = evidence.reduce((current, item) => {
    const sign = item.direction === "against" ? -1 : 1;
    return current + sign * item.strength * item.reliability * 2.2;
  }, logit(prior));
  const probability = clamp(logistic(posteriorLogOdds), 0.001, 0.999);
  const quality = qualityScore(payload);
  const evidenceMaturity = clamp(evidence.length / 8);
  const uncertainty = clamp((1 - quality / 100) * 0.34 + (1 - evidenceMaturity) * 0.16, 0.04, 0.42);
  return {
    prior_probability: round(prior),
    posterior_probability: round(probability),
    probability_percent: round(probability * 100, 2),
    probability_range: {
      low: round(clamp(probability - uncertainty), 4),
      high: round(clamp(probability + uncertainty), 4),
    },
    confidence: round(clamp((quality / 100) * 0.7 + evidenceMaturity * 0.3) * 100, 2),
    evidence,
    method: "transparent_log_odds_update_v1",
    estimated_from_assumptions: explicitPrior === undefined,
  };
}

function valueProfile(candidate = {}, probability) {
  const value = Number(candidate.value ?? candidate.upside ?? candidate.impact ?? 50);
  const downside = Number(candidate.downside ?? candidate.loss ?? candidate.risk ?? 25);
  const cost = Number(candidate.cost ?? 0);
  const risk = clamp100(candidate.risk ?? downside);
  const reversibility = clamp100(candidate.reversibility ?? 70);
  const expectedValue = probability * value - (1 - probability) * downside - cost;
  const utility = expectedValue - risk * 0.25 + reversibility * 0.1;
  return {
    value: round(value, 2),
    downside: round(downside, 2),
    cost: round(cost, 2),
    risk: round(risk, 2),
    reversibility: round(reversibility, 2),
    expected_value: round(expectedValue, 3),
    utility_score: round(utility, 3),
  };
}

function scenarioCandidates(payload = {}) {
  if (Array.isArray(payload.scenarios) && payload.scenarios.length) return payload.scenarios.slice(0, 20);
  const horizon = text(payload.horizon, "declared_horizon");
  return [
    { id: "favorable", label: "Scenario favorevole", prior_probability: 0.25, value: 80, downside: 10, risk: 20, assumptions: [`horizon:${horizon}`, "segnali favorevoli confermati"] },
    { id: "base", label: "Scenario centrale", prior_probability: 0.5, value: 55, downside: 25, risk: 35, assumptions: [`horizon:${horizon}`, "continuita dei segnali osservati"] },
    { id: "adverse", label: "Scenario avverso", prior_probability: 0.25, value: 20, downside: 70, risk: 75, assumptions: [`horizon:${horizon}`, "materializzazione dei principali rischi"] },
  ];
}

export function analyzeScenarios(payload = {}) {
  const candidates = scenarioCandidates(payload);
  const raw = candidates.map((candidate, index) => {
    const estimate = probabilityEstimate(candidate, payload);
    return {
      id: text(candidate.id, `scenario_${index + 1}`),
      label: text(candidate.label, `Scenario ${index + 1}`),
      description: text(candidate.description),
      assumptions: list(candidate.assumptions ?? payload.assumptions, 30).map(String),
      ...estimate,
      ...valueProfile(candidate, estimate.posterior_probability),
    };
  });
  const total = raw.reduce((sum, item) => sum + item.posterior_probability, 0) || 1;
  const scenarios = raw.map((item) => ({ ...item, normalized_probability: round(item.posterior_probability / total) }));
  scenarios.sort((a, b) => b.utility_score - a.utility_score);
  return {
    schema_version: ENGINE_VERSION,
    analysis_type: "scenario_analysis",
    question: text(payload.question ?? payload.request),
    horizon: text(payload.horizon, "not_specified"),
    data_quality_score: qualityScore(payload),
    scenarios,
    selected_scenario: scenarios[0] || null,
    guardrail: "Le probabilita sono stime condizionate da prior, evidenze e assunzioni dichiarate; non sono certezze.",
  };
}

export function rankHypotheses(payload = {}) {
  const hypotheses = list(payload.hypotheses, 30).map((candidate, index) => {
    const estimate = probabilityEstimate(candidate, payload);
    const profile = valueProfile(candidate, estimate.posterior_probability);
    const evidenceBalance = estimate.evidence.reduce((score, item) => score + (item.direction === "against" ? -1 : 1) * item.strength * item.reliability, 0);
    return {
      id: text(candidate.id, `hypothesis_${index + 1}`),
      label: text(candidate.label ?? candidate.hypothesis, `Hypothesis ${index + 1}`),
      rationale: text(candidate.rationale),
      assumptions: list(candidate.assumptions, 30).map(String),
      evidence_balance: round(evidenceBalance),
      ...estimate,
      ...profile,
      ranking_score: round(estimate.posterior_probability * 60 + estimate.confidence * 0.2 + profile.utility_score * 0.2, 3),
    };
  }).sort((a, b) => b.ranking_score - a.ranking_score);
  return {
    schema_version: ENGINE_VERSION,
    analysis_type: "hypothesis_ranking",
    question: text(payload.question ?? payload.request),
    data_quality_score: qualityScore(payload),
    ranking: hypotheses,
    leading_hypothesis: hypotheses[0] || null,
    unresolved: hypotheses.length < 2 || (hypotheses[0] && hypotheses[1] && Math.abs(hypotheses[0].ranking_score - hypotheses[1].ranking_score) < 5),
  };
}

export function evaluateEvents(payload = {}) {
  const events = list(payload.events, 50).map((candidate, index) => {
    const estimate = probabilityEstimate(candidate, payload);
    const impact = clamp100(candidate.impact ?? candidate.severity ?? 50);
    const urgency = clamp100(candidate.urgency ?? 50);
    const exposure = round(estimate.posterior_probability * impact, 3);
    return {
      id: text(candidate.id, `event_${index + 1}`),
      label: text(candidate.label ?? candidate.event, `Event ${index + 1}`),
      horizon: text(candidate.horizon ?? payload.horizon, "not_specified"),
      impact,
      urgency,
      exposure_score: exposure,
      priority_score: round(exposure * 0.75 + urgency * 0.25, 3),
      triggers: list(candidate.triggers, 20).map(String),
      leading_indicators: list(candidate.leading_indicators, 20).map(String),
      ...estimate,
    };
  }).sort((a, b) => b.priority_score - a.priority_score);
  return {
    schema_version: ENGINE_VERSION,
    analysis_type: "event_probability",
    data_quality_score: qualityScore(payload),
    events,
    highest_priority_event: events[0] || null,
  };
}

export function evaluateCounterfactuals(payload = {}) {
  const baseline = payload.baseline && typeof payload.baseline === "object" ? payload.baseline : { id: "baseline", label: "Baseline" };
  const alternatives = [baseline, ...list(payload.alternatives, 20)].map((candidate, index) => {
    const estimate = probabilityEstimate(candidate, payload);
    const profile = valueProfile(candidate, estimate.posterior_probability);
    return {
      id: text(candidate.id, index === 0 ? "baseline" : `alternative_${index}`),
      label: text(candidate.label, index === 0 ? "Baseline" : `Alternative ${index}`),
      changed_assumptions: list(candidate.changed_assumptions ?? candidate.assumptions, 30).map(String),
      ...estimate,
      ...profile,
    };
  });
  const baselineUtility = alternatives[0]?.utility_score ?? 0;
  const comparison = alternatives.map((item) => ({ ...item, delta_vs_baseline: round(item.utility_score - baselineUtility, 3) })).sort((a, b) => b.utility_score - a.utility_score);
  return {
    schema_version: ENGINE_VERSION,
    analysis_type: "counterfactual_analysis",
    question: text(payload.question ?? payload.request),
    comparison,
    preferred_counterfactual: comparison[0] || null,
    baseline_id: text(baseline.id, "baseline"),
  };
}

export function selectDecision(payload = {}) {
  const options = list(payload.options ?? payload.alternatives, 30).map((candidate, index) => {
    const estimate = probabilityEstimate(candidate, payload);
    const profile = valueProfile(candidate, estimate.posterior_probability);
    const strategicFit = clamp100(candidate.strategic_fit ?? 70);
    const evidenceConfidence = estimate.confidence;
    const finalScore = profile.utility_score * 0.55 + strategicFit * 0.25 + evidenceConfidence * 0.2;
    return {
      id: text(candidate.id, `option_${index + 1}`),
      label: text(candidate.label, `Option ${index + 1}`),
      strategic_fit: strategicFit,
      constraints: list(candidate.constraints, 20).map(String),
      ...estimate,
      ...profile,
      final_score: round(finalScore, 3),
    };
  }).sort((a, b) => b.final_score - a.final_score);
  const winner = options[0] || null;
  const runnerUp = options[1] || null;
  return {
    schema_version: ENGINE_VERSION,
    analysis_type: "decision_selection",
    decision: text(payload.decision ?? payload.question ?? payload.request),
    ranking: options,
    selected_option: winner,
    decision_margin: winner && runnerUp ? round(winner.final_score - runnerUp.final_score, 3) : null,
    requires_more_evidence: !winner || winner.confidence < 55 || (runnerUp && Math.abs(winner.final_score - runnerUp.final_score) < 4),
    execution_allowed: false,
  };
}

export function verifyOutcome(payload = {}) {
  const predicted = clamp(payload.predicted_probability ?? payload.prediction?.probability ?? 0.5);
  const actual = payload.actual_outcome === true || payload.actual_outcome === 1 || payload.actual_outcome === "occurred" ? 1 : 0;
  const brierScore = (predicted - actual) ** 2;
  const absoluteError = Math.abs(predicted - actual);
  return {
    schema_version: ENGINE_VERSION,
    analysis_type: "outcome_verification",
    outcome_id: text(payload.outcome_id, `outcome_${crypto.randomUUID()}`),
    prediction_id: text(payload.prediction_id),
    predicted_probability: round(predicted),
    actual_outcome: Boolean(actual),
    brier_score: round(brierScore),
    absolute_calibration_error: round(absoluteError),
    surprise_index: round(actual ? 1 - predicted : predicted),
    calibration_quality: brierScore <= 0.1 ? "strong" : brierScore <= 0.25 ? "acceptable" : "weak",
    lessons: list(payload.lessons, 20).map(String),
    verified_at: new Date().toISOString(),
  };
}

export function runIntelligenceWorkflow(payload = {}) {
  const output = {
    schema_version: ENGINE_VERSION,
    workflow_id: text(payload.workflow_id, `intel_${crypto.randomUUID()}`),
    request: text(payload.request ?? payload.question),
    generated_at: new Date().toISOString(),
    execution_allowed: false,
  };
  if (payload.scenarios || payload.generate_scenarios === true) output.scenarios = analyzeScenarios(payload);
  if (payload.hypotheses) output.hypotheses = rankHypotheses(payload);
  if (payload.events) output.events = evaluateEvents(payload);
  if (payload.alternatives && payload.baseline) output.counterfactuals = evaluateCounterfactuals(payload);
  if (payload.options || (payload.alternatives && !payload.baseline)) output.decision = selectDecision(payload);
  if (payload.predicted_probability !== undefined || payload.prediction) output.outcome_verification = verifyOutcome(payload);
  if (!output.scenarios && !output.hypotheses && !output.events && !output.counterfactuals && !output.decision && !output.outcome_verification) {
    output.scenarios = analyzeScenarios({ ...payload, generate_scenarios: true });
  }
  output.next_step = "Nyra explains the result; Core governance remains required before any execution.";
  return output;
}

export function summarizeCalibration(records = []) {
  const valid = list(records, 10_000).filter((item) => Number.isFinite(Number(item.brier_score)));
  const meanBrier = valid.length ? valid.reduce((sum, item) => sum + Number(item.brier_score), 0) / valid.length : null;
  return {
    schema_version: ENGINE_VERSION,
    sample_size: valid.length,
    mean_brier_score: meanBrier === null ? null : round(meanBrier),
    calibration_quality: meanBrier === null ? "insufficient_data" : meanBrier <= 0.1 ? "strong" : meanBrier <= 0.25 ? "acceptable" : "weak",
    live_weight_mutation_enabled: false,
    recommendation: valid.length < 20 ? "Raccogliere almeno 20 esiti verificati prima di proporre una ricalibrazione." : "Preparare una proposta di calibrazione e sottoporla a Core/owner review.",
  };
}

export { ENGINE_VERSION };
