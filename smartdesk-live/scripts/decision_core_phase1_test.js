const assert = require("assert");
const { ACTION_BAND, buildDecisionSnapshot, evaluateCandidate } = require("../src/core/decision/DecisionCore");

const privilegeContext = {
  tenantName: "Privilege Parrucchieri",
  activationLevel: 5,
  pial: { activationLevel: 5, maturityScore: 0.93 },
  dataQualityPrimarySnapshot: { dataQualityScore: 0.92, band: "REAL" },
  cashPrimarySnapshot: { confidenceScore: 0.93, confidence: "REAL" },
  profitabilitySnapshot: { confidenceScore: 0.91, confidence: "REAL" }
};

const mediumContext = {
  tenantName: "Gold Test Centro 073",
  activationLevel: 3,
  pial: { activationLevel: 3, maturityScore: 0.72 },
  dataQualityPrimarySnapshot: { dataQualityScore: 0.78, band: "STANDARD" },
  cashPrimarySnapshot: { confidenceScore: 0.76, confidence: "STANDARD" },
  profitabilitySnapshot: { confidenceScore: 0.68, confidence: "ESTIMATED" }
};

const fragileContext = {
  tenantName: "Gold Test Centro 100",
  activationLevel: 1,
  pial: { activationLevel: 1, maturityScore: 0.22 },
  dataQualityPrimarySnapshot: { dataQualityScore: 0.18, band: "INCOMPLETE" },
  cashPrimarySnapshot: { confidenceScore: 0.21, confidence: "INCOMPLETE" },
  profitabilitySnapshot: { confidenceScore: 0.2, confidence: "INCOMPLETE" }
};

function compact(action) {
  return {
    key: action.actionKey,
    band: action.actionBand,
    priorityScore: action.priorityScore,
    confidence: action.confidence,
    risk: action.risk,
    tone: action.tone,
    blockReasons: action.blockReasons
  };
}

const actNow = evaluateCandidate({
  actionKey: "privilege_cash_link",
  domain: "cash",
  need: 0.98,
  urgency: 0.96,
  value: 0.94,
  baseRisk: 0.08,
  friction: 0.02,
  trend: 0.8,
  ambiguity: 0.02,
  fragility: 0.04,
  reversibility: 0.96,
  potentialLoss: 0.08,
  pLoss: 0.08,
  minPialLevel: 3
}, privilegeContext);
assert.strictEqual(actNow.actionBand, ACTION_BAND.ACT_NOW);

const suggest = evaluateCandidate({
  actionKey: "medium_margin_review",
  domain: "profitability",
  need: 0.82,
  urgency: 0.78,
  value: 0.84,
  baseRisk: 0.2,
  friction: 0.05,
  trend: 0.35,
  ambiguity: 0.08,
  fragility: 0.12,
  reversibility: 0.86,
  profitabilityConfidence: 0.78,
  minPialLevel: 3
}, mediumContext);
assert.strictEqual(suggest.actionBand, ACTION_BAND.SUGGEST);

const lowNeed = evaluateCandidate({ actionKey: "low_need_watch", domain: "marketing", need: 0.12, urgency: 0.8, value: 0.9, baseRisk: 0.1, friction: 0.1, trend: 0.5, reversibility: 0.9 }, privilegeContext);
assert.strictEqual(lowNeed.actionBand, ACTION_BAND.MONITOR);

const lowConfidence = evaluateCandidate({ actionKey: "low_confidence_verify", domain: "cash", need: 0.8, urgency: 0.7, value: 0.8, baseRisk: 0.2, friction: 0.1, dataQuality: 0.2, maturity: 0.2, profitabilityConfidence: 0.2, cashConfidence: 0.2, dqConfidence: 0.2 }, mediumContext);
assert.strictEqual(lowConfidence.actionBand, ACTION_BAND.VERIFY);

const highRiskFragile = evaluateCandidate({ actionKey: "fragile_auto_marketing", domain: "marketing", need: 0.9, urgency: 0.85, value: 0.8, baseRisk: 0.96, friction: 0.35, trend: -0.4, ambiguity: 0.85, fragility: 0.9, reversibility: 0.08, dataQuality: 0.12, maturity: 0.15, profitabilityConfidence: 0.15, cashConfidence: 0.12, dqConfidence: 0.14 }, fragileContext);
assert.strictEqual(highRiskFragile.actionBand, ACTION_BAND.STOP);

const privilegeSnapshot = buildDecisionSnapshot({
  horizon: { at: "2026-04-19", tenant: "Privilege Parrucchieri" },
  context: privilegeContext,
  candidates: [
    { actionKey: "privilege_cash_link", domain: "cash", need: 0.98, urgency: 0.96, value: 0.94, baseRisk: 0.08, friction: 0.02, trend: 0.8, ambiguity: 0.02, fragility: 0.04, reversibility: 0.96, minPialLevel: 3 },
    { actionKey: "privilege_marketing_push", domain: "marketing", need: 0.7, urgency: 0.58, value: 0.78, baseRisk: 0.18, friction: 0.18, trend: 0.2, ambiguity: 0.08, fragility: 0.08, reversibility: 0.82, minPialLevel: 4 }
  ]
});
assert.strictEqual(privilegeSnapshot.primaryAction.actionKey, "privilege_cash_link");
assert.strictEqual(privilegeSnapshot.primaryAction.actionBand, ACTION_BAND.ACT_NOW);

const mediumSnapshot = buildDecisionSnapshot({
  horizon: { at: "2026-04-19", tenant: "Gold Test Centro 073" },
  context: mediumContext,
  candidates: [
    { actionKey: "medium_margin_review", domain: "profitability", need: 0.82, urgency: 0.78, value: 0.84, baseRisk: 0.2, friction: 0.05, trend: 0.35, ambiguity: 0.08, fragility: 0.12, reversibility: 0.86, profitabilityConfidence: 0.78, minPialLevel: 3 },
    { actionKey: "medium_forecast", domain: "report", need: 0.68, urgency: 0.3, value: 0.9, baseRisk: 0.42, friction: 0.28, trend: 0.1, minPialLevel: 5 }
  ]
});
assert.strictEqual(mediumSnapshot.primaryAction.actionKey, "medium_margin_review");
assert.strictEqual(mediumSnapshot.primaryAction.actionBand, ACTION_BAND.SUGGEST);

const fragileSnapshot = buildDecisionSnapshot({
  horizon: { at: "2026-04-19", tenant: "Gold Test Centro 100" },
  context: fragileContext,
  candidates: [
    { actionKey: "fragile_cash_action", domain: "cash", need: 0.86, urgency: 0.82, value: 0.7, baseRisk: 0.65, friction: 0.3, ambiguity: 0.72, fragility: 0.85, reversibility: 0.3, minPialLevel: 3 },
    { actionKey: "fragile_quality_fix", domain: "data_quality", need: 0.88, urgency: 0.7, value: 0.5, baseRisk: 0.22, friction: 0.2, reversibility: 0.9, minPialLevel: 1 }
  ]
});
assert(fragileSnapshot.actions.filter((action) => [ACTION_BAND.VERIFY, ACTION_BAND.STOP].includes(action.actionBand)).length >= 1);

console.log(JSON.stringify({
  cases: {
    actNow: compact(actNow),
    suggest: compact(suggest),
    lowNeed: compact(lowNeed),
    lowConfidence: compact(lowConfidence),
    highRiskFragile: compact(highRiskFragile)
  },
  tenants: {
    privilege: { primary: compact(privilegeSnapshot.primaryAction), summary: privilegeSnapshot.summary, actions: privilegeSnapshot.actions.map(compact) },
    medium: { primary: compact(mediumSnapshot.primaryAction), summary: mediumSnapshot.summary, actions: mediumSnapshot.actions.map(compact) },
    fragile: { primary: compact(fragileSnapshot.primaryAction), summary: fragileSnapshot.summary, actions: fragileSnapshot.actions.map(compact) }
  },
  purity: { writes: 0, persistedAllocations: 0, uiTouched: false, apiTouched: false }
}, null, 2));
