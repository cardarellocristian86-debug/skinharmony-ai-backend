const { ACTION_BAND, DECISION_TONE, clamp01 } = require("./DecisionCore");

const DECISION_POLICY_ADAPTER_VERSION = "decision_policy_adapter_v1";
const EPSILON = 1e-6;

// Adapter-only thresholds. They normalize legacy comparison, not operational DecisionCore output.
const ADAPTER_THRESHOLDS = Object.freeze({
  fragile: 0.65,
  lowNeedMonitorMax: 0.20,
  actNowPriority: 0.72,
  suggestPriority: 0.52,
  monitorPriority: 0.28,
  actNowConfidence: 0.70,
  actNowMaxRisk: 0.45,
  lowConfidenceVerify: 0.42,
  highRiskVerify: 0.72
});

const FRAGILE_DOMAIN_WEIGHTS = Object.freeze({
  cash: 1.25,
  data_quality: 1.15,
  operations: 1.05,
  profitability: 0.85,
  growth: 0.90
});

const STABLE_DOMAIN_WEIGHTS = Object.freeze({
  cash: 0.92,
  data_quality: 1.04,
  operations: 1.02,
  profitability: 0.96,
  growth: 1.00
});

const BAND_ORDER = Object.freeze({
  [ACTION_BAND.STOP]: 0,
  [ACTION_BAND.VERIFY]: 1,
  [ACTION_BAND.MONITOR]: 2,
  [ACTION_BAND.SUGGEST]: 3,
  [ACTION_BAND.ACT_NOW]: 4
});

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function mean(values = []) {
  const safe = values.map(Number).filter(Number.isFinite);
  return safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : 0;
}

function std(values = []) {
  const safe = values.map(Number).filter(Number.isFinite);
  if (safe.length < 2) return 0;
  const mu = mean(safe);
  return Math.sqrt(mean(safe.map((value) => (value - mu) ** 2)));
}

function bandOrdinal(band = "") {
  return BAND_ORDER[String(band || "").toUpperCase()] ?? 1;
}

function bandFromOrdinal(value = 1) {
  const normalized = Math.max(0, Math.min(4, Math.round(Number(value) || 0)));
  return Object.entries(BAND_ORDER).find(([, ordinal]) => ordinal === normalized)?.[0] || ACTION_BAND.VERIFY;
}

function inferFragility(context = {}, operationalSnapshot = {}) {
  const explicit = Number(context.fragility);
  if (Number.isFinite(explicit)) return clamp01(explicit);
  const primaryDQ = context.dataQualityPrimarySnapshot || context.dataQuality || {};
  const cash = context.cashPrimarySnapshot || context.cash || {};
  const pial = context.pial || {};
  const scoreInputs = [
    1 - clamp01(Number(primaryDQ.dataQualityScore ?? primaryDQ.score ?? 0.75)),
    1 - clamp01(Number(cash.confidenceScore ?? 0.75)),
    1 - clamp01(Number(pial.maturityScore ?? context.maturityScore ?? 0.75)),
    1 - clamp01(Number(operationalSnapshot.summary?.averageConfidence ?? 0.75))
  ];
  return clamp01(mean(scoreInputs));
}

function legacyRankMap(legacySnapshot = {}) {
  const map = new Map();
  (legacySnapshot.actions || []).forEach((action, index) => {
    const key = String(action.actionKey || "");
    if (key && !map.has(key)) map.set(key, index + 1);
  });
  return map;
}

function buildScaleStats(operationalActions = [], legacyActions = []) {
  const legacyByKey = new Map((legacyActions || []).map((action) => [String(action.actionKey || ""), action]));
  const paired = (operationalActions || [])
    .map((action) => ({ operational: action, legacy: legacyByKey.get(String(action.actionKey || "")) }))
    .filter((pair) => pair.legacy);
  const operationalScores = paired.map((pair) => Number(pair.operational.priorityScore || 0));
  const legacyScores = paired.map((pair) => Number(pair.legacy.priorityScore || 0));
  const muOp = mean(operationalScores);
  const muLegacy = mean(legacyScores);
  const sigmaOp = std(operationalScores);
  const sigmaLegacy = std(legacyScores);
  return {
    pairedCount: paired.length,
    muOp: round(muOp),
    muLegacy: round(muLegacy),
    sigmaOp: round(sigmaOp),
    sigmaLegacy: round(sigmaLegacy),
    affineUsable: paired.length >= 3 && sigmaOp > EPSILON && sigmaLegacy > EPSILON
  };
}

function compressDecisionPriority(priorityScore = 0, scaleStats = {}, context = {}) {
  const score = clamp01(Number(priorityScore || 0));
  if (scaleStats.affineUsable) {
    const comparable = scaleStats.muLegacy + ((scaleStats.sigmaLegacy / Math.max(EPSILON, scaleStats.sigmaOp)) * (score - scaleStats.muOp));
    return {
      priorityScoreComparable: round(clamp01(comparable)),
      method: "affine_legacy_mean_std",
      sourceFlags: ["priority_adapter:affine"]
    };
  }
  const gamma = Number(context.fragility || 0) >= ADAPTER_THRESHOLDS.fragile ? 1.6 : 1.25;
  return {
    priorityScoreComparable: round(clamp01(score ** gamma)),
    method: "power_compression_fallback",
    gamma,
    sourceFlags: ["priority_adapter:power_fallback"]
  };
}

function adaptDecisionDomainWeights(action = {}, context = {}) {
  const domain = String(action.domain || action.actionKey || "general").toLowerCase();
  const fragile = Number(context.fragility || 0) >= ADAPTER_THRESHOLDS.fragile;
  const table = fragile ? FRAGILE_DOMAIN_WEIGHTS : STABLE_DOMAIN_WEIGHTS;
  let weight = Number(table[domain] || 1);
  const legacyRank = context.legacyRankByKey?.get?.(String(action.actionKey || ""));
  if (legacyRank === 1) weight *= 1.08;
  else if (legacyRank === 2) weight *= 1.06;
  else if (legacyRank === 3) weight *= 1.04;
  if (!fragile && Array.isArray(action.blockReasons) && action.blockReasons.includes("NEED_TOO_LOW")) weight *= 0.92;
  return {
    domainWeight: round(Math.max(0.65, Math.min(1.35, weight))),
    policy: fragile ? "fragile_cash_data_quality_priority" : "stable_near_neutral_with_legacy_rank_nudge"
  };
}

function adaptDecisionEligibility(action = {}, context = {}) {
  const fragile = Number(context.fragility || 0) >= ADAPTER_THRESHOLDS.fragile;
  const domain = String(action.domain || "").toLowerCase();
  const reasons = new Set(Array.isArray(action.blockReasons) ? action.blockReasons : []);
  let eligible = action.eligible !== false;
  let maxBandOrdinal = 4;
  if (Number(action.need || 0) < ADAPTER_THRESHOLDS.lowNeedMonitorMax) {
    maxBandOrdinal = Math.min(maxBandOrdinal, bandOrdinal(ACTION_BAND.MONITOR));
    reasons.add("NEED_TOO_LOW");
  }
  const weakDomainOnFragileTenant = fragile && ["profitability", "growth"].includes(domain) && (
    Number(action.dataQuality || 0) < 0.70 || Number(action.confidence || 0) < 0.62
  );
  if (weakDomainOnFragileTenant) {
    maxBandOrdinal = Math.min(maxBandOrdinal, bandOrdinal(ACTION_BAND.MONITOR));
    reasons.add("FRAGILE_TENANT_GATING_MISMATCH");
  }
  if (Number(action.confidence || 0) < ADAPTER_THRESHOLDS.lowConfidenceVerify) {
    eligible = false;
    maxBandOrdinal = Math.min(maxBandOrdinal, bandOrdinal(ACTION_BAND.VERIFY));
    reasons.add("CONFIDENCE_TOO_LOW");
  }
  if (Number(action.risk || 0) > ADAPTER_THRESHOLDS.highRiskVerify && Number(action.confidence || 0) < 0.70) {
    eligible = false;
    maxBandOrdinal = Math.min(maxBandOrdinal, bandOrdinal(ACTION_BAND.VERIFY));
    reasons.add("RISK_TOO_HIGH");
  }
  return {
    eligibleComparable: eligible,
    maxBandOrdinal,
    blockReasonsComparable: Array.from(reasons)
  };
}

function adaptDecisionBand(action = {}, context = {}) {
  const eligibility = adaptDecisionEligibility(action, context);
  const score = clamp01(Number(action.priorityScoreComparable ?? action.priorityScore ?? 0));
  let band = ACTION_BAND.VERIFY;
  if (!eligibility.eligibleComparable && eligibility.maxBandOrdinal <= bandOrdinal(ACTION_BAND.VERIFY)) {
    band = ACTION_BAND.VERIFY;
  } else if (score >= ADAPTER_THRESHOLDS.actNowPriority && Number(action.confidence || 0) >= ADAPTER_THRESHOLDS.actNowConfidence && Number(action.risk || 0) <= ADAPTER_THRESHOLDS.actNowMaxRisk) {
    band = ACTION_BAND.ACT_NOW;
  } else if (score >= ADAPTER_THRESHOLDS.suggestPriority) {
    band = ACTION_BAND.SUGGEST;
  } else if (score >= ADAPTER_THRESHOLDS.monitorPriority || Number(action.need || 0) < ADAPTER_THRESHOLDS.lowNeedMonitorMax) {
    band = ACTION_BAND.MONITOR;
  }
  band = bandFromOrdinal(Math.min(bandOrdinal(band), eligibility.maxBandOrdinal));
  if (band === ACTION_BAND.STOP) return ACTION_BAND.STOP;
  return band;
}

function adaptDecisionTone(action = {}, context = {}) {
  const fragile = Number(context.fragility || 0) >= ADAPTER_THRESHOLDS.fragile;
  const band = action.actionBandComparable || action.actionBand;
  if (band === ACTION_BAND.ACT_NOW && !fragile && Number(action.confidence || 0) >= 0.70 && Number(action.risk || 0) <= 0.45) return DECISION_TONE.DIRECT;
  if (band === ACTION_BAND.SUGGEST || band === ACTION_BAND.VERIFY) return DECISION_TONE.CONSULTATIVE;
  return DECISION_TONE.SOFT;
}

function comparableAction(action = {}, context = {}) {
  const compressed = compressDecisionPriority(action.priorityScore, context.scaleStats, context);
  const domain = adaptDecisionDomainWeights(action, context);
  const priorityScoreComparable = round(clamp01(compressed.priorityScoreComparable * domain.domainWeight));
  const eligibility = adaptDecisionEligibility({ ...action, priorityScoreComparable }, context);
  const actionBandComparable = adaptDecisionBand({ ...action, priorityScoreComparable }, context);
  const toneComparable = adaptDecisionTone({ ...action, priorityScoreComparable, actionBandComparable }, context);
  return {
    ...action,
    operationalPriorityScore: action.priorityScore,
    operationalActionBand: action.actionBand,
    operationalTone: action.tone,
    operationalEligible: action.eligible,
    priorityScoreComparable,
    actionBandComparable,
    toneComparable,
    eligibleComparable: eligibility.eligibleComparable,
    blockReasonsComparable: eligibility.blockReasonsComparable,
    domainWeight: domain.domainWeight,
    priorityCompressionMethod: compressed.method,
    policyFlags: Array.from(new Set([
      ...(action.policyFlags || []),
      ...compressed.sourceFlags,
      `domain_weight:${domain.policy}`,
      ...(eligibility.blockReasonsComparable.includes("FRAGILE_TENANT_GATING_MISMATCH") ? ["eligibility_adapter:fragile_domain_downgrade"] : [])
    ])),
    // These fields intentionally mirror the comparable view for existing agreement code.
    priorityScore: priorityScoreComparable,
    actionBand: actionBandComparable,
    tone: toneComparable,
    eligible: eligibility.eligibleComparable
  };
}

function summarizeComparableSnapshot(operationalSnapshot = {}, actions = []) {
  const blockedActions = actions.filter((action) => [ACTION_BAND.STOP, ACTION_BAND.VERIFY].includes(action.actionBandComparable));
  const actionable = actions.filter((action) => ![ACTION_BAND.STOP, ACTION_BAND.VERIFY].includes(action.actionBandComparable));
  const primaryAction = actionable[0] || blockedActions[0] || null;
  const secondaryActions = actionable.filter((action) => !primaryAction || action.actionKey !== primaryAction.actionKey).slice(0, 3);
  return {
    mathAdapter: DECISION_POLICY_ADAPTER_VERSION,
    mathCore: operationalSnapshot.mathCore || "decision_core_v1",
    horizon: operationalSnapshot.horizon || null,
    candidateCount: actions.length,
    primaryAction,
    secondaryActions,
    blockedActions,
    summary: {
      topPriorityScore: round(primaryAction?.priorityScoreComparable || primaryAction?.priorityScore || 0),
      averageConfidence: actions.length ? round(mean(actions.map((action) => action.confidence))) : 0,
      averageRisk: actions.length ? round(mean(actions.map((action) => action.risk))) : 0
    },
    actions
  };
}

function buildDecisionPolicyDelta(operationalSnapshot = {}, comparableSnapshot = {}) {
  const comparableByKey = new Map((comparableSnapshot.actions || []).map((action) => [String(action.actionKey || ""), action]));
  const actionDeltas = (operationalSnapshot.actions || []).map((action) => {
    const comparable = comparableByKey.get(String(action.actionKey || "")) || {};
    return {
      actionKey: action.actionKey,
      domain: action.domain,
      priorityDelta: round(Number(comparable.priorityScoreComparable ?? comparable.priorityScore ?? 0) - Number(action.priorityScore || 0)),
      bandChanged: String(action.actionBand || "") !== String(comparable.actionBandComparable || comparable.actionBand || ""),
      toneChanged: String(action.tone || "") !== String(comparable.toneComparable || comparable.tone || ""),
      eligibleChanged: Boolean(action.eligible) !== Boolean(comparable.eligibleComparable ?? comparable.eligible)
    };
  });
  return {
    primaryChanged: String(operationalSnapshot.primaryAction?.actionKey || "") !== String(comparableSnapshot.primaryAction?.actionKey || ""),
    top3Changed: (operationalSnapshot.actions || []).slice(0, 3).map((action) => action.actionKey).join("|")
      !== (comparableSnapshot.actions || []).slice(0, 3).map((action) => action.actionKey).join("|"),
    actionDeltas
  };
}

function explainDecisionPolicyDifferences(adapterResult = {}) {
  const flags = new Set(adapterResult.policyFlags || []);
  const deltas = adapterResult.policyDeltas?.actionDeltas || [];
  if (deltas.some((delta) => Math.abs(delta.priorityDelta) > 0.05)) flags.add("PRIORITY_SCALE_MISMATCH_NORMALIZED");
  if (deltas.some((delta) => delta.bandChanged)) flags.add("ACTION_BAND_POLICY_NORMALIZED");
  if (deltas.some((delta) => delta.toneChanged)) flags.add("TONE_POLICY_NORMALIZED");
  if (adapterResult.policyDeltas?.top3Changed) flags.add("SECONDARY_RANKING_MISMATCH_NORMALIZED");
  return Array.from(flags);
}

function adaptDecisionSnapshotToLegacyComparable(operationalSnapshot = {}, legacySnapshot = {}, context = {}) {
  const operationalActions = Array.isArray(operationalSnapshot.actions) ? operationalSnapshot.actions : [];
  const legacyActions = Array.isArray(legacySnapshot.actions) ? legacySnapshot.actions : [];
  const fragility = inferFragility(context, operationalSnapshot);
  const adapterContext = {
    ...context,
    fragility,
    legacyRankByKey: legacyRankMap(legacySnapshot),
    scaleStats: buildScaleStats(operationalActions, legacyActions)
  };
  const actions = operationalActions
    .map((action) => comparableAction(action, adapterContext))
    .sort((a, b) => Number(b.priorityScoreComparable || 0) - Number(a.priorityScoreComparable || 0) || Number(b.rap2 || 0) - Number(a.rap2 || 0));
  const comparableSnapshot = summarizeComparableSnapshot(operationalSnapshot, actions);
  const policyDeltas = buildDecisionPolicyDelta(operationalSnapshot, comparableSnapshot);
  const result = {
    mathAdapter: DECISION_POLICY_ADAPTER_VERSION,
    operationalSnapshot,
    comparableSnapshot,
    policyDeltas,
    excludedFromAgreement: [],
    policyFlags: [
      "decision_adapter:comparison_only",
      `fragility:${round(fragility)}`,
      `priority_scale:${adapterContext.scaleStats.affineUsable ? "affine" : "power_fallback"}`
    ],
    scaleStats: adapterContext.scaleStats,
    thresholds: ADAPTER_THRESHOLDS
  };
  result.policyFlags = explainDecisionPolicyDifferences(result);
  return result;
}

function buildComparableDecisionSnapshot(operationalSnapshot = {}, legacySnapshot = {}, context = {}) {
  return adaptDecisionSnapshotToLegacyComparable(operationalSnapshot, legacySnapshot, context).comparableSnapshot;
}

module.exports = {
  DECISION_POLICY_ADAPTER_VERSION,
  ADAPTER_THRESHOLDS,
  adaptDecisionSnapshotToLegacyComparable,
  buildComparableDecisionSnapshot,
  compressDecisionPriority,
  adaptDecisionDomainWeights,
  adaptDecisionEligibility,
  adaptDecisionBand,
  adaptDecisionTone,
  buildDecisionPolicyDelta,
  explainDecisionPolicyDifferences
};
