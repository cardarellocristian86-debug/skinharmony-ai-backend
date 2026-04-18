const DEFAULT_WEIGHTS = {
  historyCoverage: 0.18,
  dataVolume: 0.18,
  costCompleteness: 0.18,
  crmQuality: 0.16,
  stateStability: 0.16,
  economicReliability: 0.14
};

const DEFAULT_THRESHOLDS = {
  l1: { maturity: 0.2, historyMonths: 0.5, minOperationalRecords: 5 },
  l2: { maturity: 0.4, minClients: 20, minAppointments: 30, minPayments: 20 },
  l3: { maturity: 0.6, minCostCompleteness: 0.55, minStateStability: 0.75 },
  l4: { maturity: 0.75, minHistoryCoverage: 0.8, minEconomicReliability: 0.65, minStateStability: 0.9 },
  l5: { maturity: 0.85, minHistoryCoverage: 0.8, minCostCompleteness: 0.75, minStateStability: 0.95, minCrmQuality: 0.75, minDataVolume: 0.75, minEconomicReliability: 0.75 }
};

const FEATURE_CATALOG = [
  { key: "quality_alerts", label: "Alert qualità dati", minLevel: 0 },
  { key: "startup_checklist", label: "Checklist avvio", minLevel: 0 },
  { key: "daily_priorities_basic", label: "Priorità giornaliere semplici", minLevel: 1 },
  { key: "basic_risk_clients", label: "Clienti a rischio base", minLevel: 1 },
  { key: "recall", label: "Recall", minLevel: 2, minLocalConfidence: 0.45 },
  { key: "continuity_signals", label: "Segnali continuità", minLevel: 2, minLocalConfidence: 0.45 },
  { key: "customer_frequency_insights", label: "Insight clienti e frequenze", minLevel: 2, minLocalConfidence: 0.45 },
  { key: "margin_analysis", label: "Analisi margini", minLevel: 3, minLocalConfidence: 0.55, requires: { costCompleteness: 0.55, stateStability: 0.75 } },
  { key: "operator_productivity", label: "Produttività operatori", minLevel: 3, minLocalConfidence: 0.55, requires: { stateStability: 0.75 } },
  { key: "service_correction_suggestions", label: "Servizi da correggere", minLevel: 3, minLocalConfidence: 0.55, requires: { costCompleteness: 0.55 } },
  { key: "strategic_optimization", label: "Ottimizzazione strategica centro", minLevel: 4, minLocalConfidence: 0.65, requires: { historyCoverage: 0.8, economicReliability: 0.65, stateStability: 0.9 } },
  { key: "push_reduce_guidance", label: "Cosa spingere / cosa ridurre", minLevel: 4, minLocalConfidence: 0.65, requires: { costCompleteness: 0.65, economicReliability: 0.65 } },
  { key: "forecast_scenarios", label: "Scenari futuri", minLevel: 5, minLocalConfidence: 0.75, requires: { historyCoverage: 0.8, costCompleteness: 0.75, stateStability: 0.95, economicReliability: 0.75 } },
  { key: "intelligent_marketing", label: "Marketing intelligente", minLevel: 5, minLocalConfidence: 0.75, requires: { historyCoverage: 0.8, crmQuality: 0.75, dataVolume: 0.75, economicReliability: 0.75 } },
  { key: "campaign_timing", label: "Timing campagne", minLevel: 5, minLocalConfidence: 0.75, requires: { historyCoverage: 0.8, crmQuality: 0.75, dataVolume: 0.75 } }
];

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeBySteps(value, steps) {
  const n = Math.max(0, Number(value || 0));
  let score = 0;
  for (let i = 0; i < steps.length; i += 1) {
    const [threshold, stepScore] = steps[i];
    if (n >= threshold) score = stepScore;
  }
  return clamp01(score);
}

function weightedAverage(parts = []) {
  const clean = parts.filter((item) => Number.isFinite(Number(item.value)) && Number(item.weight) > 0);
  const weightTotal = clean.reduce((sum, item) => sum + Number(item.weight), 0);
  if (!weightTotal) return 0;
  return clean.reduce((sum, item) => sum + Number(item.value) * Number(item.weight), 0) / weightTotal;
}

function getBlockedReason(feature, qualityVector, activationLevel, localConfidence) {
  if (activationLevel < feature.minLevel) return `richiede livello L${feature.minLevel}`;
  if (localConfidence < Number(feature.minLocalConfidence || 0)) return "confidenza locale sotto soglia";
  const requirements = feature.requires || {};
  const failed = Object.entries(requirements).find(([key, threshold]) => Number(qualityVector[key] || 0) < Number(threshold));
  if (failed) return `${failed[0]} sotto soglia ${failed[1]}`;
  return "";
}

class ProgressiveIntelligenceActivationLayer {
  constructor(options = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
    this.featureCatalog = options.featureCatalog || FEATURE_CATALOG;
  }

  computeHistoryCoverage(historyMonths = 0) {
    return normalizeBySteps(historyMonths, [
      [0, 0],
      [1, 0.2],
      [3, 0.5],
      [6, 0.8],
      [12, 1]
    ]);
  }

  computeDataVolume(rawCounts = {}) {
    const clients = clamp01(Number(rawCounts.clients || 0) / 500);
    const appointments = clamp01(Number(rawCounts.appointments || 0) / 1200);
    const payments = clamp01(Number(rawCounts.payments || 0) / 900);
    const services = clamp01(Number(rawCounts.services || 0) / 30);
    return round(weightedAverage([
      { value: clients, weight: 0.3 },
      { value: appointments, weight: 0.3 },
      { value: payments, weight: 0.3 },
      { value: services, weight: 0.1 }
    ]), 4);
  }

  computeQualityVector(context = {}) {
    const state = context.goldState || {};
    const components = state.components || {};
    const counters = state.counters || {};
    const rawCounts = context.rawCounts || state.metadata?.rawCounts || {};
    const validation = state.metadata?.validation || {};
    const validationValid = validation.valid !== false;
    const diffCount = Object.keys(validation.diffSummary || {}).length;
    const historyMonths = Number(context.historyMonths || 0);
    const costCompleteness = clamp01(components.CostConf ?? (counters.servicesTotal ? Number(counters.servicesWithCost || 0) / Number(counters.servicesTotal || 1) : 0));
    const crmQuality = clamp01(
      components.DQ ?? (counters.clientsTotal ? Number(counters.clientsWithContact || 0) / Number(counters.clientsTotal || 1) : 0)
    );
    const stateStability = validationValid
      ? clamp01((Number(state.eventSeq || 0) > 0 ? 0.7 : 0.25) + (state.metadata?.rebuiltFromRaw ? 0.3 : 0.15) - Math.min(0.5, diffCount * 0.1))
      : 0.25;
    const economicReliability = clamp01(components.Conf ?? 0);
    return {
      historyCoverage: round(this.computeHistoryCoverage(historyMonths), 4),
      dataVolume: this.computeDataVolume(rawCounts),
      costCompleteness: round(costCompleteness, 4),
      crmQuality: round(crmQuality, 4),
      stateStability: round(stateStability, 4),
      economicReliability: round(economicReliability, 4)
    };
  }

  computeMaturityScore(qualityVector = {}) {
    return round(weightedAverage(Object.entries(this.weights).map(([key, weight]) => ({
      value: Number(qualityVector[key] || 0),
      weight
    }))), 4);
  }

  computeActivationLevel(maturityScore = 0, qualityVector = {}, context = {}) {
    const rawCounts = context.rawCounts || {};
    const historyMonths = Number(context.historyMonths || 0);
    const operationalRecords = Number(rawCounts.clients || 0) + Number(rawCounts.appointments || 0) + Number(rawCounts.payments || 0);
    const reasons = [];
    let level = 0;
    if (maturityScore >= this.thresholds.l1.maturity && historyMonths >= this.thresholds.l1.historyMonths && operationalRecords >= this.thresholds.l1.minOperationalRecords) {
      level = 1;
    } else {
      reasons.push("storico o dati operativi insufficienti per L1");
    }
    if (
      maturityScore >= this.thresholds.l2.maturity
      && Number(rawCounts.clients || 0) >= this.thresholds.l2.minClients
      && Number(rawCounts.appointments || 0) >= this.thresholds.l2.minAppointments
      && Number(rawCounts.payments || 0) >= this.thresholds.l2.minPayments
    ) {
      level = 2;
    } else if (level >= 1) {
      reasons.push("volume minimo clienti/appuntamenti/pagamenti insufficiente per L2");
    }
    if (
      maturityScore >= this.thresholds.l3.maturity
      && qualityVector.costCompleteness >= this.thresholds.l3.minCostCompleteness
      && qualityVector.stateStability >= this.thresholds.l3.minStateStability
    ) {
      level = 3;
    } else if (level >= 2) {
      reasons.push("cost completeness o stabilità stato insufficienti per L3");
    }
    if (
      maturityScore >= this.thresholds.l4.maturity
      && qualityVector.historyCoverage >= this.thresholds.l4.minHistoryCoverage
      && qualityVector.economicReliability >= this.thresholds.l4.minEconomicReliability
      && qualityVector.stateStability >= this.thresholds.l4.minStateStability
    ) {
      level = 4;
    } else if (level >= 3) {
      reasons.push("storico alto, affidabilità economica o no-drift insufficienti per L4");
    }
    if (
      maturityScore >= this.thresholds.l5.maturity
      && qualityVector.historyCoverage >= this.thresholds.l5.minHistoryCoverage
      && qualityVector.costCompleteness >= this.thresholds.l5.minCostCompleteness
      && qualityVector.stateStability >= this.thresholds.l5.minStateStability
      && qualityVector.crmQuality >= this.thresholds.l5.minCrmQuality
      && qualityVector.dataVolume >= this.thresholds.l5.minDataVolume
      && qualityVector.economicReliability >= this.thresholds.l5.minEconomicReliability
    ) {
      level = 5;
    } else if (level >= 4) {
      reasons.push("requisiti previsionali/marketing intelligente non ancora completi per L5");
    }
    return {
      level,
      label: ["boot", "operativo_base", "analitico_base", "analitico_avanzato", "strategico", "previsionale_marketing_intelligente"][level] || "boot",
      reasons
    };
  }

  getEnabledAIFeatures(activationLevel = 0, qualityVector = {}, localConfidence = 1) {
    const enabledFeatures = [];
    const blockedFeatures = [];
    const reasons = {};
    this.featureCatalog.forEach((feature) => {
      const reason = getBlockedReason(feature, qualityVector, activationLevel, localConfidence);
      if (reason) {
        blockedFeatures.push({ key: feature.key, label: feature.label, minLevel: feature.minLevel, reason });
        reasons[feature.key] = reason;
      } else {
        enabledFeatures.push({ key: feature.key, label: feature.label, minLevel: feature.minLevel });
      }
    });
    return { enabledFeatures, blockedFeatures, reasons };
  }

  explainActivationStatus(result = {}) {
    const level = Number(result.activationLevel || 0);
    if (level <= 0) return "Dati insufficienti: AI in modalità avvio prudenziale.";
    if (level === 1) return "Modalità operativa base attiva: priorità semplici e messaggi prudenti.";
    if (level === 2) return "Analitico base attivo: recall e continuità clienti disponibili.";
    if (level === 3) return "Analisi economica sbloccata: margini, produttività e servizi critici disponibili.";
    if (level === 4) return "Lettura strategica disponibile: ottimizzazione centro e priorità organizzative abilitate.";
    return "Livello previsionale disponibile: scenari e marketing intelligente abilitati con output prudenziali.";
  }

  compute(context = {}) {
    const qualityVector = this.computeQualityVector(context);
    const maturityScore = this.computeMaturityScore(qualityVector);
    const activation = this.computeActivationLevel(maturityScore, qualityVector, context);
    const localConfidence = Number(context.goldState?.components?.Conf ?? qualityVector.economicReliability ?? 0);
    const features = this.getEnabledAIFeatures(activation.level, qualityVector, localConfidence);
    const result = {
      centerId: context.centerId || "",
      maturityScore,
      activationLevel: activation.level,
      activationLabel: activation.label,
      qualityVector,
      thresholds: this.thresholds,
      weights: this.weights,
      enabledFeatures: features.enabledFeatures,
      blockedFeatures: features.blockedFeatures,
      reasons: {
        ...features.reasons,
        level: activation.reasons
      },
      forecastAllowed: activation.level >= 5 && features.enabledFeatures.some((item) => item.key === "forecast_scenarios"),
      marketingReady: activation.level >= 5 && features.enabledFeatures.some((item) => item.key === "intelligent_marketing"),
      generatedAt: new Date().toISOString(),
      sourceLayer: "progressive_intelligence_activation_layer_v1"
    };
    return {
      ...result,
      message: this.explainActivationStatus(result)
    };
  }
}

module.exports = {
  ProgressiveIntelligenceActivationLayer,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  FEATURE_CATALOG
};
