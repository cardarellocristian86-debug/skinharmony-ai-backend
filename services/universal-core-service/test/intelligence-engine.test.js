import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeScenarios,
  evaluateCounterfactuals,
  evaluateEvents,
  rankHypotheses,
  runIntelligenceWorkflow,
  selectDecision,
  summarizeCalibration,
  verifyOutcome,
} from "../src/intelligenceEngine.js";

const evidence = [
  { label: "real signal", direction: "support", strength: 0.9, reliability: 0.9 },
  { label: "weak objection", direction: "against", strength: 0.2, reliability: 0.6 },
];

test("scenario analysis exposes probabilities, ranges, assumptions and expected value", () => {
  const result = analyzeScenarios({ question: "Will demand grow?", data_quality_score: 80 });
  assert.equal(result.scenarios.length, 3);
  assert(result.scenarios.every((item) => item.probability_range.low <= item.posterior_probability));
  assert(result.scenarios.every((item) => item.probability_range.high >= item.posterior_probability));
  assert(result.scenarios.every((item) => Number.isFinite(item.expected_value)));
  assert.match(result.guardrail, /stime condizionate/);
});

test("supporting evidence moves posterior above prior and ranks hypotheses", () => {
  const result = rankHypotheses({
    question: "Root cause",
    data_quality_score: 90,
    hypotheses: [
      { id: "supported", label: "Supported", prior_probability: 0.4, evidence },
      { id: "unsupported", label: "Unsupported", prior_probability: 0.4, evidence: [{ label: "contrary", direction: "against", strength: 0.8, reliability: 0.9 }] },
    ],
  });
  assert.equal(result.leading_hypothesis.id, "supported");
  assert(result.ranking[0].posterior_probability > result.ranking[0].prior_probability);
});

test("event evaluation uses probability impact and urgency", () => {
  const result = evaluateEvents({
    question: "What can happen?",
    events: [
      { id: "high", label: "High", base_rate: 0.8, impact: 90, urgency: 90 },
      { id: "low", label: "Low", base_rate: 0.1, impact: 20, urgency: 10 },
    ],
  });
  assert.equal(result.highest_priority_event.id, "high");
});

test("counterfactual and decision ranking preserve non-executing boundary", () => {
  const counterfactual = evaluateCounterfactuals({
    question: "Change path?",
    baseline: { id: "base", probability: 0.4, value: 30, downside: 40 },
    alternatives: [{ id: "safe", probability: 0.8, value: 80, downside: 10, risk: 10, reversibility: 95 }],
  });
  assert.equal(counterfactual.preferred_counterfactual.id, "safe");
  const decision = selectDecision({
    decision: "Choose",
    options: [
      { id: "a", probability: 0.8, value: 80, risk: 10, strategic_fit: 90 },
      { id: "b", probability: 0.3, value: 40, risk: 70, strategic_fit: 50 },
    ],
  });
  assert.equal(decision.selected_option.id, "a");
  assert.equal(decision.execution_allowed, false);
});

test("outcome verification computes Brier score and calibration summary", () => {
  const strong = verifyOutcome({ outcome_id: "o1", predicted_probability: 0.9, actual_outcome: true });
  const weak = verifyOutcome({ outcome_id: "o2", predicted_probability: 0.9, actual_outcome: false });
  assert.equal(strong.brier_score, 0.01);
  assert.equal(weak.brier_score, 0.81);
  const summary = summarizeCalibration([strong, weak]);
  assert.equal(summary.sample_size, 2);
  assert.equal(summary.live_weight_mutation_enabled, false);
});

test("full workflow composes every requested intelligence phase", () => {
  const result = runIntelligenceWorkflow({
    request: "Evaluate launch",
    generate_scenarios: true,
    hypotheses: [{ id: "h1", prior_probability: 0.6 }, { id: "h2", prior_probability: 0.4 }],
    events: [{ id: "e1", probability: 0.5, impact: 80 }],
    baseline: { id: "base", probability: 0.4 },
    alternatives: [{ id: "alt", probability: 0.7 }],
    options: [{ id: "o1", probability: 0.7 }, { id: "o2", probability: 0.3 }],
  });
  assert(result.scenarios && result.hypotheses && result.events && result.counterfactuals && result.decision);
  assert.equal(result.execution_allowed, false);
});
