const ACTION_BAND = Object.freeze({ ACT_NOW: "ACT_NOW", SUGGEST: "SUGGEST", MONITOR: "MONITOR", VERIFY: "VERIFY", STOP: "STOP" });
const DECISION_TONE = Object.freeze({ DIRECT: "direct", CONSULTATIVE: "consultative", SOFT: "soft" });
const BLOCK_REASON = Object.freeze({
  NEED_TOO_LOW: "NEED_TOO_LOW",
  CONFIDENCE_TOO_LOW: "CONFIDENCE_TOO_LOW",
  RISK_TOO_HIGH: "RISK_TOO_HIGH",
  DATA_QUALITY_TOO_LOW: "DATA_QUALITY_TOO_LOW",
  PIAL_NOT_READY: "PIAL_NOT_READY",
  CASH_NOT_RELIABLE: "CASH_NOT_RELIABLE",
  PROFITABILITY_NOT_RELIABLE: "PROFITABILITY_NOT_RELIABLE",
  ACTION_NOT_REVERSIBLE: "ACTION_NOT_REVERSIBLE"
});

// Centralized weights and thresholds for decision_core_v1. These are explicit for auditability.
const DECISION_CONFIDENCE_WEIGHTS = Object.freeze({ actionDataQuality: 0.20, maturity: 0.15, profitabilityConfidence: 0.20, cashConfidence: 0.20, dataQualityConfidence: 0.25 });
const DECISION_RISK_WEIGHTS = Object.freeze({ baseRisk: 0.25, ambiguity: 0.20, fragility: 0.20, dataLow: 0.20, irreversibility: 0.15 });
const DECISION_PHI_WEIGHTS = Object.freeze({ bias: -1.0, need: 1.4, urgency: 1.1, value: 1.0, trend: 0.6, confidence: 1.2, risk: 1.3, friction: 0.8 });
const DECISION_PRIORITY_WEIGHTS = Object.freeze({ rap: 0.25, rap2: 0.20, expectedValue: 0.20, netExpectedUtility: 0.20, urgency: 0.15 });
const DECISION_THRESHOLDS = Object.freeze({
  needMonitorMax: 0.20,
  confidenceVerify: 0.45,
  highRisk: 0.75,
  highRiskMaxConfidence: 0.70,
  actNowPriority: 0.80,
  actNowConfidence: 0.75,
  actNowMaxRisk: 0.40,
  suggestPriority: 0.60,
  monitorPriority: 0.35,
  minReversibility: 0.25,
  irreversibleRisk: 0.65,
  trendKappa: 0.20
});

const ECONOMIC_DOMAINS = new Set(["cash", "payment", "profit", "profitability", "margin", "report", "economic"]);

function clamp01(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function clampSigned(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-1, Math.min(1, numeric));
}

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function sigmoid(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return 1 / (1 + Math.exp(-numeric));
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function bandScore(band = "") {
  const normalized = String(band || "").toUpperCase();
  if (normalized === "REAL") return 1;
  if (normalized === "STANDARD") return 0.82;
  if (normalized === "ESTIMATED") return 0.55;
  if (normalized === "INCOMPLETE") return 0.25;
  return null;
}

function pialLevelScore(value = 0) {
  if (typeof value === "string" && /^L\d$/.test(value.toUpperCase())) return clamp01(Number(value.slice(1)) / 5);
  const numeric = Number(value || 0);
  return clamp01(numeric > 1 ? numeric / 5 : numeric);
}

function redistributeWeights(values = {}, weights = {}) {
  const available = Object.entries(weights).filter(([key]) => values[key] !== null && values[key] !== undefined);
  const total = available.reduce((sum, [, weight]) => sum + Number(weight || 0), 0);
  if (total <= 0) return { score: 0, appliedWeights: {}, missingKeys: Object.keys(weights) };
  const appliedWeights = {};
  const score = available.reduce((sum, [key, weight]) => {
    const normalizedWeight = Number(weight || 0) / total;
    appliedWeights[key] = round(normalizedWeight);
    return sum + (clamp01(values[key]) * normalizedWeight);
  }, 0);
  return {
    score: clamp01(score),
    appliedWeights,
    missingKeys: Object.keys(weights).filter((key) => values[key] === null || values[key] === undefined)
  };
}

function normalizeDecisionInputs(candidate = {}, context = {}) {
  const sourceFlags = new Set(Array.isArray(candidate.sourceFlags) ? candidate.sourceFlags : []);
  const tenantDQ = context.dataQuality || context.dataQualityPrimarySnapshot || {};
  const pial = context.pial || context.pialStatus || {};
  const cash = context.cash || context.cashPrimarySnapshot || {};
  const profitability = context.profitability || context.profitabilitySnapshot || {};

  function field(name, aliases = [], fallback = 0, mode = "unit") {
    const value = firstFinite(candidate[name], ...aliases.map((alias) => candidate[alias]));
    if (value === null) {
      sourceFlags.add(`missing:${name}`);
      return mode === "signed" ? clampSigned(fallback) : clamp01(fallback);
    }
    return mode === "signed" ? clampSigned(value) : clamp01(value);
  }

  const dataQuality = field("dataQuality", ["quality", "Q"], firstFinite(tenantDQ.dataQualityScore, tenantDQ.score, tenantDQ.crmQuality) ?? 0);
  const maturity = field("maturity", ["readiness", "M"], firstFinite(pial.maturityScore, pial.score, pial.activationLevel) ?? 0);
  return {
    actionKey: String(candidate.actionKey || candidate.key || candidate.id || ""),
    domain: String(candidate.domain || "general"),
    label: candidate.label || candidate.title || "",
    need: field("need", ["N"], 0),
    urgency: field("urgency", ["U"], 0),
    value: field("value", ["expectedValueInput", "V"], 0),
    baseRisk: field("baseRisk", ["risk", "R"], 0),
    friction: field("friction", ["F"], 0),
    trend: field("trend", ["T"], 0, "signed"),
    maturity: pialLevelScore(maturity),
    dataQuality,
    reversibility: field("reversibility", ["K"], 0.5),
    ambiguity: field("ambiguity", ["ambiguous"], 0),
    fragility: field("fragility", ["contextFragility"], firstFinite(context.fragility, 0) ?? 0),
    pLoss: field("pLoss", ["lossProbability"], 0),
    potentialLoss: field("potentialLoss", ["loss"], 0),
    minPialLevel: Number(candidate.minPialLevel ?? candidate.requiredPialLevel ?? 0),
    profitabilityConfidence: firstFinite(candidate.profitabilityConfidence, candidate.PConf, bandScore(candidate.profitabilityBand), profitability.confidenceScore, bandScore(profitability.confidence)),
    cashConfidence: firstFinite(candidate.cashConfidence, candidate.CashConf, cash.confidenceScore, bandScore(cash.confidence)),
    dataQualityConfidence: firstFinite(candidate.dqConfidence, candidate.DQConf, tenantDQ.dataQualityScore, tenantDQ.score, bandScore(tenantDQ.band)),
    dataQualityBand: String(candidate.dataQualityBand || tenantDQ.band || ""),
    cashReliable: candidate.cashReliable,
    profitabilityReliable: candidate.profitabilityReliable,
    raw: candidate,
    sourceFlags: Array.from(sourceFlags)
  };
}

function computeDecisionConfidence(input = {}) {
  const result = redistributeWeights({
    actionDataQuality: input.dataQuality,
    maturity: input.maturity,
    profitabilityConfidence: input.profitabilityConfidence,
    cashConfidence: input.cashConfidence,
    dataQualityConfidence: input.dataQualityConfidence
  }, DECISION_CONFIDENCE_WEIGHTS);
  return {
    confidence: round(result.score),
    appliedWeights: result.appliedWeights,
    missingKeys: result.missingKeys,
    sourceFlags: result.missingKeys.map((key) => `confidence_missing:${key}`)
  };
}

function computeDecisionRisk(input = {}) {
  const components = {
    baseRisk: clamp01(input.baseRisk),
    ambiguity: clamp01(input.ambiguity),
    fragility: clamp01(input.fragility),
    dataLow: 1 - clamp01(input.dataQuality),
    irreversibility: 1 - clamp01(input.reversibility)
  };
  const risk = Object.entries(DECISION_RISK_WEIGHTS).reduce((sum, [key, weight]) => sum + (components[key] * weight), 0);
  return { risk: round(risk), components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value)])) };
}

function computeActivationScore(input = {}) {
  const w = DECISION_PHI_WEIGHTS;
  const raw = w.bias + (w.need * clamp01(input.need)) + (w.urgency * clamp01(input.urgency)) + (w.value * clamp01(input.value)) + (w.trend * clampSigned(input.trend)) + (w.confidence * clamp01(input.confidence)) - (w.risk * clamp01(input.risk)) - (w.friction * clamp01(input.friction));
  return { phi: round(sigmoid(raw)), raw: round(raw) };
}

function computeExpectedValue(input = {}) {
  return round(clamp01(input.confidence) * (1 - clamp01(input.risk)) * clamp01(input.value));
}

function computeOpportunityCost(input = {}) {
  return round(clamp01(input.potentialLoss) * clamp01(input.pLoss));
}

function computeDecisionPriority(input = {}) {
  const rap = clamp01(input.phi) * clamp01(input.confidence) * (1 - clamp01(input.risk));
  const rap2 = clamp01(rap * (1 + (DECISION_THRESHOLDS.trendKappa * clampSigned(input.trend))));
  const ev = input.ev ?? computeExpectedValue(input);
  const oc = input.oc ?? computeOpportunityCost(input);
  const neu = clampSigned(ev - oc - clamp01(input.friction));
  const neuNormalized = clamp01((neu + 1) / 2);
  const w = DECISION_PRIORITY_WEIGHTS;
  return {
    rap: round(rap),
    rap2: round(rap2),
    ev: round(ev),
    oc: round(oc),
    neu: round(neu),
    priorityScore: round((w.rap * rap) + (w.rap2 * rap2) + (w.expectedValue * clamp01(ev)) + (w.netExpectedUtility * neuNormalized) + (w.urgency * clamp01(input.urgency)))
  };
}

function inferActionBand(input = {}, context = {}) {
  const blockReasons = [];
  const domain = String(input.domain || "").toLowerCase();
  const dataQualityBand = String(input.dataQualityBand || context.dataQualityBand || "").toUpperCase();
  const activationLevel = Number(context.activationLevel ?? context.pial?.activationLevel ?? 0);
  let hardBlocked = false;
  let forcedVerify = false;
  let monitorMax = false;

  if (clamp01(input.need) < DECISION_THRESHOLDS.needMonitorMax) {
    monitorMax = true;
    blockReasons.push(BLOCK_REASON.NEED_TOO_LOW);
  }
  if (clamp01(input.confidence) < DECISION_THRESHOLDS.confidenceVerify) {
    forcedVerify = true;
    blockReasons.push(BLOCK_REASON.CONFIDENCE_TOO_LOW);
  }
  if (clamp01(input.risk) > DECISION_THRESHOLDS.highRisk && clamp01(input.confidence) < DECISION_THRESHOLDS.highRiskMaxConfidence) {
    hardBlocked = true;
    blockReasons.push(BLOCK_REASON.RISK_TOO_HIGH);
  }
  if (dataQualityBand === "INCOMPLETE" && ECONOMIC_DOMAINS.has(domain)) {
    forcedVerify = true;
    blockReasons.push(BLOCK_REASON.DATA_QUALITY_TOO_LOW);
  }
  if (Number(input.minPialLevel || 0) > 0 && activationLevel < Number(input.minPialLevel || 0)) {
    forcedVerify = true;
    blockReasons.push(BLOCK_REASON.PIAL_NOT_READY);
  }
  if (input.cashReliable === false && ["cash", "payment", "report"].includes(domain)) {
    forcedVerify = true;
    blockReasons.push(BLOCK_REASON.CASH_NOT_RELIABLE);
  }
  if (input.profitabilityReliable === false && ["profit", "profitability", "margin", "report"].includes(domain)) {
    forcedVerify = true;
    blockReasons.push(BLOCK_REASON.PROFITABILITY_NOT_RELIABLE);
  }
  if (clamp01(input.reversibility) < DECISION_THRESHOLDS.minReversibility && clamp01(input.risk) > DECISION_THRESHOLDS.irreversibleRisk) {
    forcedVerify = true;
    blockReasons.push(BLOCK_REASON.ACTION_NOT_REVERSIBLE);
  }

  if (hardBlocked) return { actionBand: ACTION_BAND.STOP, eligible: false, blockReasons };
  if (forcedVerify) return { actionBand: ACTION_BAND.VERIFY, eligible: false, blockReasons };
  if (input.priorityScore >= DECISION_THRESHOLDS.actNowPriority && input.confidence >= DECISION_THRESHOLDS.actNowConfidence && input.risk <= DECISION_THRESHOLDS.actNowMaxRisk && !monitorMax) return { actionBand: ACTION_BAND.ACT_NOW, eligible: true, blockReasons };
  if (input.priorityScore >= DECISION_THRESHOLDS.suggestPriority && !monitorMax) return { actionBand: ACTION_BAND.SUGGEST, eligible: true, blockReasons };
  if (input.priorityScore >= DECISION_THRESHOLDS.monitorPriority || monitorMax) return { actionBand: ACTION_BAND.MONITOR, eligible: true, blockReasons };
  return { actionBand: ACTION_BAND.VERIFY, eligible: false, blockReasons };
}

function inferDecisionTone(input = {}) {
  if (input.actionBand === ACTION_BAND.ACT_NOW && input.confidence >= 0.75 && input.risk <= 0.4) return DECISION_TONE.DIRECT;
  if (input.actionBand === ACTION_BAND.SUGGEST || input.actionBand === ACTION_BAND.VERIFY) return DECISION_TONE.CONSULTATIVE;
  return DECISION_TONE.SOFT;
}

function evaluateCandidate(candidate = {}, context = {}) {
  const normalized = normalizeDecisionInputs(candidate, context);
  const confidenceResult = computeDecisionConfidence(normalized);
  const riskResult = computeDecisionRisk(normalized);
  const activation = computeActivationScore({ ...normalized, confidence: confidenceResult.confidence, risk: riskResult.risk });
  const priority = computeDecisionPriority({ ...normalized, confidence: confidenceResult.confidence, risk: riskResult.risk, phi: activation.phi });
  const band = inferActionBand({ ...normalized, confidence: confidenceResult.confidence, risk: riskResult.risk, priorityScore: priority.priorityScore }, context);
  const sourceFlags = Array.from(new Set([...normalized.sourceFlags, ...confidenceResult.sourceFlags]));
  return {
    actionKey: normalized.actionKey,
    domain: normalized.domain,
    label: normalized.label,
    need: round(normalized.need),
    urgency: round(normalized.urgency),
    value: round(normalized.value),
    risk: riskResult.risk,
    confidence: confidenceResult.confidence,
    friction: round(normalized.friction),
    trend: round(normalized.trend),
    maturity: round(normalized.maturity),
    dataQuality: round(normalized.dataQuality),
    phi: activation.phi,
    rap: priority.rap,
    rap2: priority.rap2,
    ev: priority.ev,
    oc: priority.oc,
    neu: priority.neu,
    priorityScore: priority.priorityScore,
    actionBand: band.actionBand,
    tone: inferDecisionTone({ actionBand: band.actionBand, confidence: confidenceResult.confidence, risk: riskResult.risk }),
    eligible: band.eligible,
    blockReasons: band.blockReasons,
    sourceFlags,
    breakdown: {
      confidence: { appliedWeights: confidenceResult.appliedWeights, missingKeys: confidenceResult.missingKeys },
      risk: riskResult.components,
      phiRaw: activation.raw
    }
  };
}

function buildDecisionSnapshot(input = {}, options = {}) {
  const candidates = Array.isArray(input) ? input : (Array.isArray(input.candidates) ? input.candidates : []);
  const context = Array.isArray(input) ? options : (input.context || options || {});
  const actions = candidates.map((candidate) => evaluateCandidate(candidate, context)).sort((a, b) => b.priorityScore - a.priorityScore || b.rap2 - a.rap2 || b.ev - a.ev);
  const blockedActions = actions.filter((action) => [ACTION_BAND.STOP, ACTION_BAND.VERIFY].includes(action.actionBand));
  const actionable = actions.filter((action) => ![ACTION_BAND.STOP, ACTION_BAND.VERIFY].includes(action.actionBand));
  const primaryAction = actionable[0] || blockedActions[0] || null;
  const secondaryActions = actionable.filter((action) => !primaryAction || action.actionKey !== primaryAction.actionKey).slice(0, 3);
  const averageConfidence = actions.length ? actions.reduce((sum, item) => sum + item.confidence, 0) / actions.length : 0;
  const averageRisk = actions.length ? actions.reduce((sum, item) => sum + item.risk, 0) / actions.length : 0;
  return {
    mathCore: "decision_core_v1",
    horizon: context.horizon || input.horizon || null,
    candidateCount: actions.length,
    primaryAction,
    secondaryActions,
    blockedActions,
    summary: { topPriorityScore: round(primaryAction?.priorityScore || 0), averageConfidence: round(averageConfidence), averageRisk: round(averageRisk) },
    actions
  };
}

module.exports = {
  ACTION_BAND,
  DECISION_TONE,
  BLOCK_REASON,
  DECISION_CONFIDENCE_WEIGHTS,
  DECISION_RISK_WEIGHTS,
  DECISION_PHI_WEIGHTS,
  DECISION_PRIORITY_WEIGHTS,
  DECISION_THRESHOLDS,
  normalizeDecisionInputs,
  computeDecisionConfidence,
  computeDecisionRisk,
  computeActivationScore,
  computeExpectedValue,
  computeOpportunityCost,
  computeDecisionPriority,
  inferActionBand,
  inferDecisionTone,
  buildDecisionSnapshot,
  evaluateCandidate,
  clamp01,
  clampSigned,
  sigmoid
};
