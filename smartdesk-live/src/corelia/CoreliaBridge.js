"use strict";

const {
  DEFAULT_ROUTER_VARIANT,
  parseIntent,
  routeDomain,
  normalizeText
} = require("./CoreliaIntentRouter");

function clamp01(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function round(value, digits = 3) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function average(values = []) {
  const list = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!list.length) return 0;
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function resolveUiReadingBand(v7 = {}, actionBand = "MONITOR") {
  const conflictIndex = Number(v7.conflictIndex || 0);
  const irreversibleMass = Number(v7.irreversibleMass || 0);
  const normalizedBand = String(actionBand || "MONITOR").toUpperCase();
  if (normalizedBand === "STOP" || normalizedBand === "VERIFY" || conflictIndex >= 0.45 || irreversibleMass >= 0.35) {
    return "verify";
  }
  if (conflictIndex >= 0.25 || normalizedBand === "SUGGEST") {
    return "confirm";
  }
  return "clear";
}

function uiReadingLabel(uiReadingBand = "clear") {
  if (uiReadingBand === "verify") return "Quadro da verificare";
  if (uiReadingBand === "confirm") return "Risposta da confermare";
  return "Risposta chiara";
}

function severityToActionBand(level = "") {
  const normalized = String(level || "").toUpperCase();
  if (["ACT_NOW", "HIGH", "CRITICAL"].includes(normalized)) return "ACT_NOW";
  if (["SUGGEST", "MEDIUM", "WARNING"].includes(normalized)) return "SUGGEST";
  if (["VERIFY", "LOW_CONFIDENCE"].includes(normalized)) return "VERIFY";
  if (["STOP", "BLOCKED"].includes(normalized)) return "STOP";
  return "MONITOR";
}

function summarizeDecisionItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    action: String(item?.action || ""),
    confidence: clamp01(Number(item?.confidence || 0)),
    risk: clamp01(Number(item?.risk || 0)),
    priority: clamp01(Number(item?.riskAdjustedPriority || item?.phi || 0))
  }));
}

function isMeaningfulText(value, banned = []) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (/^gold state:/i.test(normalized)) return false;
  if (/^state layer:/i.test(normalized)) return false;
  if (/confidenza\s+\d+%/i.test(normalized) && /saturazione/i.test(normalized) && /continuita/i.test(normalized)) return false;
  return !banned.includes(normalized.toLowerCase());
}

function pickFirstMeaningful(values = [], banned = []) {
  for (const value of values) {
    if (isMeaningfulText(value, banned)) return String(value).trim();
  }
  return "";
}

function resolveShadowGovernorDecision(primaryAction = {}, decisionContext = {}) {
  const primaryDecision = String(primaryAction?.universalCoreShadow?.governor?.decision || "").trim();
  if (primaryDecision) return primaryDecision;
  return String(decisionContext?.universalCoreShadow?.governor?.decision || "").trim();
}

function resolveShadowRuntime(primaryAction = {}, decisionContext = {}) {
  const primaryRuntime = String(primaryAction?.universalCoreShadow?.runtime?.selected_runtime || "").trim();
  if (primaryRuntime) return primaryRuntime;
  return String(decisionContext?.universalCoreShadow?.runtime?.selected_runtime || "").trim();
}

function resolveShadowRisk(primaryAction = {}, decisionContext = {}) {
  const primaryRisk = Number(primaryAction?.universalCoreShadow?.risk?.risk_score);
  if (Number.isFinite(primaryRisk)) return clamp01(primaryRisk);
  const rootRisk = Number(decisionContext?.universalCoreShadow?.risk?.risk_score);
  if (Number.isFinite(rootRisk)) return clamp01(rootRisk);
  return 0;
}

class CoreliaBridge {
  constructor(desktopMirror, options = {}) {
    this.desktopMirror = desktopMirror;
    this.routerVariant = options.routerVariant || DEFAULT_ROUTER_VARIANT;
  }

  buildSourceCatalog(period = {}, session = null) {
    const goldState = this.desktopMirror.getGoldState(session);
    const snapshot = this.desktopMirror.getBusinessSnapshot(period, session);
    const decisionContext = this.desktopMirror.getGoldDecisionContext(period, session);
    const decisionCenter = this.desktopMirror.getAiGoldDecisionCenter(period, session);
    return {
      goldState,
      snapshot,
      decisionContext,
      decisionCenter,
      sourceCatalog: {
        decisionSelection: goldState?.decision || null,
        decisionPrimarySnapshot: decisionContext?.primaryAction || null,
        cashSelection: goldState?.cashSelection || null,
        cashPrimarySnapshot: goldState?.cashPrimarySnapshot || null,
        dataQualitySelection: goldState?.signals?.dataReliability != null
          ? {
              source: "gold_state",
              score: Number(goldState.signals.dataReliability || 0),
              band: Number(goldState.signals.dataReliability || 0) >= 0.75 ? "REAL" : "VERIFY"
            }
          : null,
        dataQualityPrimarySnapshot: snapshot?.dataQuality || null,
        reportParallel: snapshot?.report || null,
        profitabilitySnapshot: snapshot?.profitability || null,
        marketingParallel: goldState?.marketingParallel || snapshot?.marketing || null,
        agendaParallel: snapshot?.goldEngine?.agenda || null,
        operatorProductivityParallel: snapshot?.operations || null,
        goldStateSummary: goldState?.decision || null
      }
    };
  }

  getBaseStateContext(period = {}, session = null, overrides = {}) {
    const resolved = this.buildSourceCatalog(period, session);
    return {
      ...resolved,
      goldState: overrides.goldState || resolved.goldState,
      snapshot: overrides.snapshot || resolved.snapshot,
      decisionContext: overrides.decisionContext || resolved.decisionContext,
      decisionCenter: overrides.decisionCenter || resolved.decisionCenter
    };
  }

  resolveDomainSnapshot(domain, state = {}) {
    const snapshot = state.snapshot || {};
    const decisionContext = state.decisionContext || {};
    const decisionCenter = state.decisionCenter || {};
    const sections = Array.isArray(decisionCenter.sections) ? decisionCenter.sections : [];
    if (domain === "cash") {
      return {
        primary: state.goldState?.cashPrimarySnapshot || snapshot.dataQuality || {},
        secondary: snapshot.dataQuality || {},
        centerItems: sections.find((section) => section.key === "daily")?.items || []
      };
    }
    if (domain === "marketing") {
      return {
        primary: snapshot.marketing || {},
        secondary: state.goldState?.marketingParallel || {},
        centerItems: sections.find((section) => section.key === "actions")?.items || []
      };
    }
    if (domain === "agenda") {
      return {
        primary: snapshot.operations || {},
        secondary: snapshot.goldEngine?.agenda || {},
        centerItems: sections.find((section) => section.key === "daily")?.items || []
      };
    }
    if (domain === "profitability") {
      return {
        primary: snapshot.profitability || {},
        secondary: snapshot.economic || {},
        centerItems: sections.find((section) => section.key === "profitability")?.items || []
      };
    }
    if (domain === "operator") {
      return {
        primary: snapshot.operations || {},
        secondary: snapshot.goldEngine?.operators || {},
        centerItems: sections.find((section) => section.key === "performance")?.items || []
      };
    }
    if (domain === "report") {
      return {
        primary: snapshot.report || {},
        secondary: decisionCenter.summary || {},
        centerItems: sections.find((section) => section.key === "center_health")?.items || []
      };
    }
    if (domain === "data_quality") {
      return {
        primary: snapshot.dataQuality || {},
        secondary: state.goldState?.signals || {},
        centerItems: sections.find((section) => section.key === "actions")?.items || []
      };
    }
    if (domain === "decision") {
      return {
        primary: decisionContext || {},
        secondary: decisionCenter.summary || {},
        centerItems: sections.find((section) => section.key === "gold_engine")?.items || []
      };
    }
    return {
      primary: decisionContext || snapshot.report?.centerHealth || {},
      secondary: decisionCenter.summary || {},
      centerItems: sections.flatMap((section) => section.items || []).slice(0, 4)
    };
  }

  computeSourceConfidence(domain, state = {}, domainSnapshot = {}) {
    const snapshot = state.snapshot || {};
    const decisionContext = state.decisionContext || {};
    const dataQualityScore = clamp01(Number(snapshot.dataQuality?.score || 0) / 100);
    const goldDecisionConfidence = clamp01(Number(decisionContext.globalConfidence || 0));
    const cashReliability = clamp01(Number(state.goldState?.cashSelection?.reliabilityScore || 0));
    const profitabilityConfidence = clamp01(Number(snapshot.profitability?.summary?.confidenceScore || snapshot.profitability?.economicConfidence || 0));
    const fallback = average([dataQualityScore, goldDecisionConfidence, cashReliability, profitabilityConfidence]);
    if (domain === "cash") return round(average([cashReliability || fallback, dataQualityScore || fallback]));
    if (domain === "profitability") return round(average([profitabilityConfidence || fallback, dataQualityScore || fallback]));
    if (domain === "decision") return round(average([goldDecisionConfidence || fallback, dataQualityScore || fallback]));
    if (domain === "marketing") return round(average([
      Array.isArray(snapshot.marketing?.suggestions) ? 0.85 : 0.3,
      dataQualityScore || fallback
    ]));
    if (domain === "agenda") return round(average([
      snapshot.operations?.weakestUpcomingDay ? 0.8 : 0.45,
      dataQualityScore || fallback
    ]));
    if (domain === "operator") return round(average([
      snapshot.operations?.topOperator || snapshot.operations?.weakOperator ? 0.8 : 0.4,
      dataQualityScore || fallback
    ]));
    return round(fallback);
  }

  computeReadiness(domain, state = {}, domainSnapshot = {}) {
    const primary = domainSnapshot.primary || {};
    const snapshot = state.snapshot || {};
    if (domain === "cash") {
      return round(average([
        primary.source ? 1 : 0,
        Number(snapshot.dataQuality?.metrics?.unlinkedPayments || 0) >= 0 ? 1 : 0,
        state.goldState?.cashSelection ? 1 : 0
      ]));
    }
    if (domain === "marketing") {
      return round(average([
        Array.isArray(snapshot.marketing?.suggestions) ? 1 : 0,
        snapshot.marketing?.focusClient ? 1 : 0,
        snapshot.report?.centerHealth ? 1 : 0
      ]));
    }
    if (domain === "agenda") {
      return round(average([
        snapshot.operations?.weakestUpcomingDay ? 1 : 0,
        Array.isArray(snapshot.operations?.upcomingAppointments) ? 1 : 0,
        snapshot.report?.centerHealth ? 1 : 0
      ]));
    }
    if (domain === "profitability") {
      return round(average([
        Array.isArray(snapshot.profitability?.suggestions) ? 1 : 0,
        Array.isArray(snapshot.profitability?.alerts) ? 1 : 0,
        snapshot.profitability?.summary ? 1 : 0
      ]));
    }
    if (domain === "operator") {
      return round(average([
        snapshot.operations?.topOperator ? 1 : 0,
        snapshot.operations?.weakOperator ? 1 : 0,
        snapshot.report?.operational ? 1 : 0
      ]));
    }
    if (domain === "data_quality") {
      return round(average([
        snapshot.dataQuality ? 1 : 0,
        Array.isArray(snapshot.dataQuality?.alerts) ? 1 : 0,
        state.goldState?.signals ? 1 : 0
      ]));
    }
    return round(average([
      snapshot.report?.centerHealth ? 1 : 0,
      state.decisionContext?.primaryAction ? 1 : 0,
      Array.isArray(domainSnapshot.centerItems) ? 1 : 0
    ]));
  }

  computeConsistency(domain, state = {}, domainSnapshot = {}) {
    const primaryActionDomain = String(state.decisionContext?.primaryAction?.domain || "");
    const stateDecisionDomain = String(state.goldState?.decision?.domain || "");
    const domainMatch = primaryActionDomain === domain || stateDecisionDomain === domain
      ? 1
      : domain === "decision" && ["operations", "growth", "cash", "profitability"].includes(primaryActionDomain)
        ? 0.75
        : 0.4;
    const dataQualityScore = clamp01(Number(state.snapshot?.dataQuality?.score || 0) / 100);
    const agreement = clamp01(Number(state.goldState?.cashSelection?.agreementScore || 0));
    const reliability = clamp01(Number(state.goldState?.signals?.dataReliability || 0));
    if (domain === "cash") return round(average([domainMatch, agreement || 0.5, reliability || dataQualityScore]));
    return round(average([domainMatch, reliability || dataQualityScore, dataQualityScore]));
  }

  computeConfidence(domain, state = {}, domainSnapshot = {}) {
    const SourceConf = this.computeSourceConfidence(domain, state, domainSnapshot);
    const DataQuality = clamp01(Number(state.snapshot?.dataQuality?.score || 0) / 100);
    const Readiness = this.computeReadiness(domain, state, domainSnapshot);
    const Consistency = this.computeConsistency(domain, state, domainSnapshot);
    const confidence = (0.40 * SourceConf) + (0.25 * DataQuality) + (0.20 * Readiness) + (0.15 * Consistency);
    return {
      confidence: round(confidence),
      parts: {
        SourceConf: round(SourceConf),
        DataQuality: round(DataQuality),
        Readiness: round(Readiness),
        Consistency: round(Consistency)
      }
    };
  }

  computeUrgency(state = {}) {
    const snapshot = state.snapshot || {};
    const decisionContext = state.decisionContext || {};
    const shadowRisk = resolveShadowRisk(decisionContext.primaryAction || {}, decisionContext);
    const unlinkedPayments = Number(snapshot.dataQuality?.metrics?.unlinkedPayments || 0);
    const cashAgreementRisk = Number(state.goldState?.cashPrimarySnapshot?.ambiguityRatio || 0);
    const CashUrgency = round(Math.max(unlinkedPayments > 0 ? Math.min(1, unlinkedPayments / 4) : 0, cashAgreementRisk));
    const DecisionUrgency = round(Math.max(
      Number(decisionContext.systemRisk || 0),
      Number(decisionContext.primaryAction?.risk || 0),
      Number(decisionContext.primaryAction?.riskAdjustedPriority || 0),
      shadowRisk
    ));
    const weakestUpcomingDay = snapshot.operations?.weakestUpcomingDay || null;
    const AgendaUrgency = round(
      weakestUpcomingDay
        ? (Number(weakestUpcomingDay[1] || 0) <= 1 ? 0.85 : Number(weakestUpcomingDay[1] || 0) <= 3 ? 0.65 : 0.35)
        : 0
    );
    const focusClient = snapshot.marketing?.focusClient || null;
    const MarketingUrgency = round(
      focusClient
        ? String(focusClient.priority || "") === "alta" ? 0.85 : String(focusClient.priority || "") === "media" ? 0.60 : 0.35
        : 0
    );
    const centerHealth = snapshot.report?.centerHealth || {};
    const profitabilityAlert = Array.isArray(snapshot.profitability?.alerts) ? snapshot.profitability.alerts[0] : null;
    const ReportUrgency = round(Math.max(
      String(centerHealth.status || "") === "sotto_soglia" ? 0.90 : String(centerHealth.status || "") === "fragile" ? 0.65 : 0.35,
      profitabilityAlert ? 0.65 : 0
    ));
    return {
      urgency: round(Math.max(CashUrgency, DecisionUrgency, AgendaUrgency, MarketingUrgency, ReportUrgency)),
      parts: {
        CashUrgency,
        DecisionUrgency,
        AgendaUrgency,
        MarketingUrgency,
        ReportUrgency
      }
    };
  }

  computeV7Envelope(domain, state = {}, domainSnapshot = {}) {
    const centerItems = summarizeDecisionItems(domainSnapshot.centerItems || []);
    const topSignals = summarizeDecisionItems(state.decisionContext?.topSignals || []);
    const primaryAction = summarizeDecisionItems([state.decisionContext?.primaryAction || {}]);
    const items = [...centerItems, ...topSignals, ...primaryAction].filter((item) => item.action || item.priority > 0);
    if (!items.length) {
      return {
        active: true,
        stage: "compressed",
        highMass: 0,
        midMass: 0,
        lowMass: 0,
        irreversibleMass: 0,
        overlapDensity: 0,
        dominanceMargin: 0,
        conflictIndex: 0
      };
    }
    let highMass = 0;
    let midMass = 0;
    let lowMass = 0;
    let irreversibleMass = 0;
    items.forEach((item) => {
      const mass = clamp01((0.55 * item.priority) + (0.25 * item.confidence) + (0.20 * (1 - item.risk)));
      if (item.action === "ACT_NOW" || mass >= 0.72) {
        highMass += mass;
      } else if (item.action === "SUGGEST" || item.action === "VERIFY" || mass >= 0.45) {
        midMass += mass;
      } else {
        lowMass += mass;
      }
      if (item.action === "STOP" || item.risk >= 0.75) {
        irreversibleMass += Math.max(mass, item.risk);
      }
    });
    const totalMass = Math.max(highMass + midMass + lowMass, 0.0001);
    const normalizedHigh = round(highMass / totalMass);
    const normalizedMid = round(midMass / totalMass);
    const normalizedLow = round(lowMass / totalMass);
    const normalizedIrreversible = round(clamp01(irreversibleMass / Math.max(items.length, 1)));
    const ordered = [normalizedHigh, normalizedMid, normalizedLow].sort((a, b) => b - a);
    const dominanceMargin = round(Math.max(0, ordered[0] - (ordered[1] || 0)));
    const conflictIndex = round(clamp01(Math.min(normalizedHigh, normalizedMid) + (normalizedIrreversible * 0.35)));
    return {
      active: true,
      stage: "compressed",
      highMass: normalizedHigh,
      midMass: normalizedMid,
      lowMass: normalizedLow,
      irreversibleMass: normalizedIrreversible,
      overlapDensity: round(totalMass / Math.max(items.length, 1)),
      dominanceMargin,
      conflictIndex
    };
  }

  selectPrimaryEvidence(domain, state = {}, domainSnapshot = {}) {
    const snapshot = state.snapshot || {};
    const centerHealth = snapshot.report?.centerHealth || {};
    if (domain === "cash") {
      return [
        { label: "Pagamenti da collegare", value: Number(snapshot.dataQuality?.metrics?.unlinkedPayments || 0), source: "dataQualityPrimarySnapshot" },
        { label: "Fonte cash primaria", value: String(state.goldState?.cashSelection?.primarySource || "legacy"), source: "cashSelection" },
        { label: "Reliability cash", value: round(state.goldState?.cashSelection?.reliabilityScore || 0), source: "cashSelection" }
      ];
    }
    if (domain === "marketing") {
      return [
        { label: "Clienti prioritari", value: Array.isArray(snapshot.marketing?.suggestions) ? snapshot.marketing.suggestions.length : 0, source: "marketingParallel" },
        { label: "Focus client", value: snapshot.marketing?.focusClient?.name || "", source: "marketingParallel" },
        { label: "Continuità", value: Number(centerHealth.continuityPercent || 0), source: "reportParallel" }
      ];
    }
    if (domain === "agenda") {
      return [
        { label: "Giorno debole", value: snapshot.operations?.weakestUpcomingDay?.[0] || "", source: "agendaParallel" },
        { label: "Appuntamenti giorno debole", value: Number(snapshot.operations?.weakestUpcomingDay?.[1] || 0), source: "agendaParallel" },
        { label: "Saturazione", value: Number(centerHealth.saturationPercent || 0), source: "reportParallel" }
      ];
    }
    if (domain === "profitability") {
      const top = Array.isArray(snapshot.profitability?.suggestions) ? snapshot.profitability.suggestions[0] : null;
      return [
        { label: "Alert redditività", value: Array.isArray(snapshot.profitability?.alerts) ? snapshot.profitability.alerts.length : 0, source: "profitabilitySnapshot" },
        { label: "Servizio critico", value: top?.name || "", source: "profitabilitySnapshot" },
        { label: "Margine medio", value: round(snapshot.profitability?.summary?.averageMargin || snapshot.profitability?.averageMargin || 0), source: "profitabilitySnapshot" }
      ];
    }
    if (domain === "operator") {
      return [
        { label: "Top operatore", value: snapshot.operations?.topOperator?.name || "", source: "operatorProductivityParallel" },
        { label: "Operatore debole", value: snapshot.operations?.weakOperator?.name || "", source: "operatorProductivityParallel" },
        { label: "Produttività", value: round(snapshot.report?.operational?.productivityScore || 0), source: "reportParallel" }
      ];
    }
    if (domain === "data_quality") {
      return [
        { label: "Score qualità dati", value: Number(snapshot.dataQuality?.score || 0), source: "dataQualityPrimarySnapshot" },
        { label: "Alert qualità", value: Array.isArray(snapshot.dataQuality?.alerts) ? snapshot.dataQuality.alerts.length : 0, source: "dataQualityPrimarySnapshot" },
        { label: "Reliability", value: round(state.goldState?.signals?.dataReliability || 0), source: "dataQualitySelection" }
      ];
    }
    if (domain === "report") {
      return [
        { label: "Stato centro", value: centerHealth.statusLabel || centerHealth.status || "", source: "reportParallel" },
        { label: "Fatturato per operatore", value: Number(centerHealth.revenuePerOperatorCents || 0), source: "reportParallel" },
        { label: "Saturazione", value: Number(centerHealth.saturationPercent || 0), source: "reportParallel" }
      ];
    }
    const primary = state.decisionContext?.primaryAction || {};
    return [
      { label: "Primary action", value: primary.label || primary.domain || "", source: "decisionPrimarySnapshot" },
      { label: "System risk", value: round(state.decisionContext?.systemRisk || 0), source: "decisionSelection" },
      { label: "Confidence globale", value: round(state.decisionContext?.globalConfidence || 0), source: "decisionSelection" },
      { label: "Shadow governor", value: resolveShadowGovernorDecision(primary, state.decisionContext) || "", source: "decisionPrimarySnapshot" },
      { label: "Shadow runtime", value: resolveShadowRuntime(primary, state.decisionContext) || "", source: "decisionPrimarySnapshot" }
    ];
  }

  buildStructuredDomainAnswer(message, domain, intent, state = {}) {
    const domainSnapshot = this.resolveDomainSnapshot(domain, state);
    const confidenceBlock = this.computeConfidence(domain, state, domainSnapshot);
    const urgencyBlock = this.computeUrgency(state);
    const v7 = this.computeV7Envelope(domain, state, domainSnapshot);
    const evidence = this.selectPrimaryEvidence(domain, state, domainSnapshot).filter((item) => item.value !== "" && item.value !== null && item.value !== undefined);
    const decisionContext = state.decisionContext || {};
    const decisionSummary = state.decisionCenter?.summary || {};
    const snapshot = state.snapshot || {};
    const primaryActionCandidate = decisionContext.primaryAction || {};
    const centerHealth = snapshot.report?.centerHealth || {};
    const servicesMissingCosts = Number(snapshot.dataQuality?.metrics?.servicesMissingCosts || 0);
    const operatorsMissingHourlyCost = Number(snapshot.dataQuality?.metrics?.operatorsMissingHourlyCost || 0);
    const profitabilityBlockedForConfig = servicesMissingCosts > 0 || operatorsMissingHourlyCost > 0;
    const shadowDecision = resolveShadowGovernorDecision(primaryActionCandidate, decisionContext);
    const shadowRuntime = resolveShadowRuntime(primaryActionCandidate, decisionContext);
    const shadowRisk = resolveShadowRisk(primaryActionCandidate, decisionContext);

    let primarySignal = "Centro sotto controllo";
    let secondarySignals = [];
    let primaryAction = "monitorare";
    let actionBand = "MONITOR";
    let risks = [];
    let reasons = [];
    let recommendedNextStep = "verifica il modulo collegato e conferma l'azione se serve";
    let sourceUsed = ["goldStateSummary"];

    if (domain === "cash") {
      const unlinked = Number(snapshot.dataQuality?.metrics?.unlinkedPayments || 0);
      primarySignal = unlinked > 0 ? `${unlinked} pagamenti da collegare` : "Cassa senza anomalie forti";
      secondarySignals = uniqueStrings([
        `Fonte primaria ${state.goldState?.cashSelection?.primarySource || "legacy"}`,
        `Agreement ${state.goldState?.cashSelection?.agreementBand || "N/A"}`
      ]);
      primaryAction = unlinked > 0 ? "collega i pagamenti e verifica i movimenti ambigui" : "mantieni il controllo della cassa";
      actionBand = unlinked > 0 ? "VERIFY" : "MONITOR";
      risks = uniqueStrings([
        unlinked > 0 ? "lettura report distorta finché la cassa resta sporca" : "",
        Number(state.goldState?.cashPrimarySnapshot?.ambiguityRatio || 0) > 0.4 ? "ambiguità nei collegamenti cassa" : ""
      ]);
      reasons = uniqueStrings([
        "La cassa sporca deforma report e priorità operative",
        state.goldState?.cashSelection?.fallbackReason || ""
      ]);
      recommendedNextStep = unlinked > 0 ? "apri cassa e verifica i pagamenti non collegati" : "continua con il controllo ordinario";
      sourceUsed = ["cashSelection", "cashPrimarySnapshot", "dataQualityPrimarySnapshot"];
    } else if (domain === "marketing") {
      const focusClient = snapshot.marketing?.focusClient || null;
      const suggestionCount = Array.isArray(snapshot.marketing?.suggestions) ? snapshot.marketing.suggestions.length : 0;
      const analyzedClients = Number(snapshot.marketing?.debug?.clientsAnalyzed || 0);
      const avoidCount = Number(snapshot.marketing?.counts?.avoid || 0);
      const hasPriorityQueue = Boolean(focusClient || suggestionCount > 0);
      const insufficientHistory = analyzedClients === 0;

      primarySignal = focusClient
        ? `${focusClient.name} è il cliente da presidiare`
        : insufficientHistory
          ? "Storico insufficiente per recall operativo"
          : suggestionCount === 0 && avoidCount > 0
            ? "Nessun recall prioritario disponibile oggi"
            : "Recall da monitorare";
      secondarySignals = uniqueStrings([
        `Clienti prioritari ${suggestionCount}`,
        focusClient?.clearReason || ""
      ]);
      primaryAction = focusClient
        ? (focusClient.operatingDecision || "prepara un richiamo mirato")
        : insufficientHistory
          ? "carica storico reale prima di attivare recall e marketing"
          : suggestionCount === 0 && avoidCount > 0
            ? "non forzare richiami: lavora agenda o acquisizione"
            : "rileggi la coda recall e seleziona i clienti ad alta priorità";
      actionBand = focusClient && String(focusClient.priority || "") === "alta"
        ? "ACT_NOW"
        : hasPriorityQueue
          ? "SUGGEST"
          : insufficientHistory
            ? "VERIFY"
            : "MONITOR";
      risks = uniqueStrings([
        focusClient ? "perdita continuità cliente se non contattato" : "",
        Number(snapshot.dataQuality?.score || 0) < 75 ? "dati contatto o storico incompleti" : ""
      ]);
      reasons = uniqueStrings([
        focusClient?.clearReason
          || (insufficientHistory
            ? "Il centro non ha ancora storico sufficiente per generare recall attendibili"
            : suggestionCount === 0 && avoidCount > 0
              ? "Il marketing Gold non vede clienti da richiamare oggi: i profili analizzati sono da evitare o da lasciare in osservazione"
              : "Il marketing Gold ha già ordinato i clienti per urgenza reale"),
        "Corelia usa storico visite, frequenza e consenso"
      ]);
      recommendedNextStep = focusClient
        ? "apri marketing e prepara il messaggio da confermare"
        : insufficientHistory
          ? "completa clienti, visite e consensi prima di aspettarti recall affidabili"
          : suggestionCount === 0 && avoidCount > 0
            ? "apri agenda o marketing e lavora solo clienti davvero fuori routine"
            : "controlla marketing e valida la coda recall";
      sourceUsed = ["marketingParallel", "reportParallel", "goldStateSummary"];
    } else if (domain === "agenda") {
      const weakDay = snapshot.operations?.weakestUpcomingDay || null;
      primarySignal = weakDay ? `${weakDay[0]} è la giornata più debole` : "Agenda senza buchi evidenti";
      secondarySignals = uniqueStrings([
        weakDay ? `${weakDay[1]} appuntamenti previsti` : "",
        `Saturazione ${Number(centerHealth.saturationPercent || 0)}%`
      ]);
      primaryAction = weakDay ? "riempi il buco agenda con recall mirati" : "mantieni monitorata l'agenda";
      actionBand = weakDay && Number(weakDay[1] || 0) <= 2 ? "ACT_NOW" : weakDay ? "SUGGEST" : "MONITOR";
      risks = uniqueStrings([
        weakDay ? "agenda scarica nei prossimi giorni" : "",
        Number(centerHealth.saturationPercent || 0) < 50 ? "volume appuntamenti fragile" : ""
      ]);
      reasons = uniqueStrings([
        "Prima riempiere agenda, poi ottimizzare margini",
        weakDay ? "La giornata più debole è il punto di intervento più economico" : ""
      ]);
      recommendedNextStep = weakDay ? "apri agenda o marketing e copri la giornata debole" : "nessuna azione immediata";
      sourceUsed = ["agendaParallel", "reportParallel", "decisionPrimarySnapshot"];
    } else if (domain === "profitability") {
      const alert = Array.isArray(snapshot.profitability?.alerts) ? snapshot.profitability.alerts[0] : null;
      const suggestion = Array.isArray(snapshot.profitability?.suggestions) ? snapshot.profitability.suggestions[0] : null;
      if (profitabilityBlockedForConfig) {
        primarySignal = "Redditività non ancora leggibile";
        secondarySignals = uniqueStrings([
          servicesMissingCosts > 0 ? `${servicesMissingCosts} costi servizio da completare` : "",
          operatorsMissingHourlyCost > 0 ? `${operatorsMissingHourlyCost} costi orari operatori da completare` : ""
        ]);
        primaryAction = "completa configurazione costi prima di usare la redditività come guida";
        actionBand = "VERIFY";
        risks = uniqueStrings([
          "lettura economica facilmente fraintendibile finché la configurazione costi resta incompleta"
        ]);
        reasons = uniqueStrings([
          "Il centro può lavorare bene anche se la configurazione economica non è completa",
          `Gold evita margini forti finché mancano ${servicesMissingCosts} costi servizio e ${operatorsMissingHourlyCost} costi orari operatori.`
        ]);
        recommendedNextStep = `apri servizi e operatori e completa ${servicesMissingCosts} costi servizio e ${operatorsMissingHourlyCost} costi orari operatori`;
      } else {
        primarySignal = alert?.title || suggestion?.name || "Redditività da monitorare";
        secondarySignals = uniqueStrings([
          suggestion?.clearConclusion || "",
          `Alert ${(snapshot.profitability?.alerts || []).length}`
        ]);
        primaryAction = suggestion?.operatingAction || "controlla prezzo, durata e costi dei servizi critici";
        actionBand = alert ? "VERIFY" : suggestion ? "SUGGEST" : "MONITOR";
        risks = uniqueStrings([
          alert ? "margine sotto soglia o dati costo da verificare" : "",
          Number(snapshot.dataQuality?.score || 0) < 75 ? "lettura economica poco affidabile" : ""
        ]);
        reasons = uniqueStrings([
          "La redditività va letta solo sui dati reali del gestionale",
          suggestion?.clearConclusion || ""
        ]);
        recommendedNextStep = "apri redditività e verifica il servizio o la tecnologia più critica";
      }
      sourceUsed = ["profitabilitySnapshot", "reportParallel", "dataQualityPrimarySnapshot", shadowRuntime ? "decisionPrimaryShadow" : ""].filter(Boolean);
    } else if (domain === "operator") {
      const topOperator = snapshot.operations?.topOperator || null;
      const weakOperator = snapshot.operations?.weakOperator || null;
      primarySignal = weakOperator
        ? `${weakOperator.name} è l'operatore da verificare`
        : topOperator
          ? `${topOperator.name} è il riferimento del periodo`
          : "Performance operatori da monitorare";
      secondarySignals = uniqueStrings([
        topOperator ? `Top ${topOperator.name}` : "",
        weakOperator ? `Debole ${weakOperator.name}` : ""
      ]);
      primaryAction = weakOperator ? "verifica agenda, servizi assegnati e continuità cliente" : "usa l'operatore forte come benchmark";
      actionBand = weakOperator ? "SUGGEST" : topOperator ? "MONITOR" : "VERIFY";
      risks = uniqueStrings([
        weakOperator ? "operatore sotto-utilizzato o con produttività bassa" : "",
        Number(snapshot.dataQuality?.score || 0) < 75 ? "storico operatori poco pulito" : ""
      ]);
      reasons = uniqueStrings([
        "Corelia confronta saturazione, volume e produzione",
        weakOperator ? "serve capire se il problema è agenda o mix servizi" : ""
      ]);
      recommendedNextStep = weakOperator ? "apri turni o report operatore e confronta i volumi" : "mantieni benchmark e controllo";
      sourceUsed = ["operatorProductivityParallel", "reportParallel", "goldStateSummary"];
    } else if (domain === "data_quality") {
      const dq = snapshot.dataQuality || {};
      primarySignal = `Qualità dati ${Number(dq.score || 0)}%`;
      secondarySignals = uniqueStrings([
        Array.isArray(dq.alerts) ? dq.alerts[0] : "",
        `Pagamenti scollegati ${Number(dq.metrics?.unlinkedPayments || 0)}`
      ]);
      primaryAction = "correggi i dati sporchi prima di fidarti delle letture Gold";
      actionBand = Number(dq.score || 0) < 60 ? "ACT_NOW" : Number(dq.score || 0) < 75 ? "VERIFY" : "MONITOR";
      risks = uniqueStrings([
        "insight meno affidabili se la qualità dati resta bassa",
        Number(dq.metrics?.unlinkedPayments || 0) > 0 ? "cassa sporca" : ""
      ]);
      reasons = uniqueStrings([
        "AI Gold non corregge i numeri: segnala dove i dati vanno sistemati",
        Array.isArray(dq.alerts) ? dq.alerts[0] : ""
      ]);
      recommendedNextStep = "apri i moduli che generano il dato sporco e ripulisci i record";
      sourceUsed = ["dataQualitySelection", "dataQualityPrimarySnapshot", "cashPrimarySnapshot"];
    } else if (domain === "report") {
      primarySignal = `${centerHealth.statusLabel || "Stato centro"}: ${centerHealth.reason || "lettura operativa disponibile"}`;
      secondarySignals = uniqueStrings([
        `Fatturato/operatore ${Number(centerHealth.revenuePerOperatorCents || 0)}`,
        `Saturazione ${Number(centerHealth.saturationPercent || 0)}%`,
        `Continuità ${Number(centerHealth.continuityPercent || 0)}%`
      ]);
      primaryAction = ["sotto_soglia", "fragile"].includes(String(centerHealth.status || ""))
        ? "aumenta volume agenda e continuità clienti"
        : "mantieni il centro sotto controllo e correggi solo i punti deboli";
      actionBand = String(centerHealth.status || "") === "sotto_soglia"
        ? "ACT_NOW"
        : String(centerHealth.status || "") === "fragile"
          ? "SUGGEST"
          : "MONITOR";
      risks = uniqueStrings([
        String(centerHealth.status || "") === "sotto_soglia" ? "centro sotto soglia" : "",
        String(centerHealth.status || "") === "fragile" ? "volume operativo fragile" : ""
      ]);
      reasons = uniqueStrings([
        "La salute centro pesa prima di margini e tecnologie",
        centerHealth.reason || ""
      ]);
      recommendedNextStep = ["sotto_soglia", "fragile"].includes(String(centerHealth.status || ""))
        ? "agisci su agenda e recall prima delle ottimizzazioni"
        : "usa il report per confermare che il centro regga";
      sourceUsed = ["reportParallel", "decisionSelection", "goldStateSummary"];
    } else {
      const progressive = decisionContext.progressiveIntelligence || {};
      const progressiveMessage = pickFirstMeaningful([
        progressive.message,
        progressive.oracle?.reason,
        progressive.prudentialForecast?.reason
      ]);
      const lowMaturity = (!primaryActionCandidate.label && !primaryActionCandidate.suggestedAction)
        && (Number(progressive.activationLevel || 0) === 0 || /avvio prudenziale|insufficient data|storico insufficiente/i.test(progressiveMessage));
      const mainProblem = pickFirstMeaningful([
        centerHealth.reason,
        decisionSummary.mainProblem,
        primaryActionCandidate.explanationShort,
        (Array.isArray(decisionContext.topSignals) ? decisionContext.topSignals : []).map((item) => item.explanationShort || item.label).find(Boolean)
      ], ["nessun problema urgente", "lettura operativa disponibile"]);
      const bestOpportunity = pickFirstMeaningful([
        decisionSummary.bestOpportunity
      ], ["nessuna opportunità prioritaria"]);
      const operationalRisk = pickFirstMeaningful([
        decisionSummary.operationalRisk
      ], ["rischio sotto controllo"]);
      const fragileDataArea = pickFirstMeaningful([decisionSummary.fragileDataArea]);
      const firstAction = pickFirstMeaningful([
        decisionSummary.firstAction,
        primaryActionCandidate.suggestedAction,
        primaryActionCandidate.label
      ], ["nessuna azione urgente"]);
      const centerHealthLead = pickFirstMeaningful([
        centerHealth.statusLabel && centerHealth.reason ? `${centerHealth.statusLabel}: ${centerHealth.reason}` : "",
        centerHealth.reason
      ]);

      if (profitabilityBlockedForConfig && (String(primaryActionCandidate.domain || "") === "profitability" || String(primaryActionCandidate.domain || "") === "economic")) {
        primarySignal = "Volume presente, completa costi per sbloccare redditivita";
      } else if (lowMaturity) {
        primarySignal = "Il centro è ancora in avvio prudenziale: i dati sono troppo pochi per una priorità forte";
      } else if (intent === "ask_center_status") {
        primarySignal = mainProblem
          ? `Il punto da presidiare oggi è ${mainProblem}`
          : centerHealthLead || "Centro sotto controllo";
      } else if (intent === "ask_priority") {
        primarySignal = firstAction
          ? `La prima mossa di oggi è ${firstAction}`
          : mainProblem
            ? `Il collo operativo di oggi è ${mainProblem}`
            : centerHealthLead || "Priorità operativa disponibile";
      } else if (intent === "ask_general_explanation") {
        primarySignal = centerHealthLead || mainProblem || "Lettura operativa disponibile";
      } else {
        primarySignal = mainProblem || centerHealthLead || primaryActionCandidate.label || primaryActionCandidate.explanationShort || "Priorità operativa disponibile";
      }

      secondarySignals = uniqueStrings([
        profitabilityBlockedForConfig ? `Configurazione economica incompleta: ${servicesMissingCosts} costi servizio, ${operatorsMissingHourlyCost} costi orari` : "",
        lowMaturity ? progressiveMessage : "",
        bestOpportunity ? `Opportunità: ${bestOpportunity}` : "",
        operationalRisk ? `Rischio: ${operationalRisk}` : "",
        fragileDataArea ? `Dato fragile: ${fragileDataArea}` : "",
        ...((Array.isArray(decisionContext.topSignals) ? decisionContext.topSignals : [])
          .slice(0, 2)
          .map((item) => item.explanationShort || item.label || item.domain))
      ]);
      primaryAction = profitabilityBlockedForConfig && (String(primaryActionCandidate.domain || "") === "profitability" || String(primaryActionCandidate.domain || "") === "economic")
        ? `completa ${servicesMissingCosts} costi servizio e ${operatorsMissingHourlyCost} costi orari operatori`
        : lowMaturity
          ? "completa agenda, cassa e anagrafica prima di aspettarti letture più profonde"
          : firstAction || "verifica la priorità principale";
      actionBand = profitabilityBlockedForConfig && (String(primaryActionCandidate.domain || "") === "profitability" || String(primaryActionCandidate.domain || "") === "economic")
        ? "VERIFY"
        : lowMaturity
          ? "VERIFY"
          : severityToActionBand(primaryActionCandidate.action || state.goldState?.decision?.action || "MONITOR");
      risks = uniqueStrings([
        profitabilityBlockedForConfig ? "la lettura economica resta prudente finché i costi non sono completi" : "",
        lowMaturity ? "dati insufficienti per priorità affidabili" : "",
        Number(decisionContext.systemRisk || 0) > 0.7 ? "rischio operativo alto" : "",
        shadowDecision === "block" ? "governor shadow in blocco: non forzare l'azione" : "",
        shadowDecision === "escalate" ? "governor shadow richiede escalation o conferma forte" : "",
        ["retry", "fallback"].includes(shadowDecision) ? "governor shadow suggerisce prudenza operativa" : "",
        shadowRisk > 0.7 ? "rischio shadow alto" : "",
        Number(snapshot.dataQuality?.score || 0) < 75 ? "dati da verificare" : "",
        fragileDataArea ? `area dati fragile: ${fragileDataArea}` : ""
      ]);
      reasons = uniqueStrings([
        profitabilityBlockedForConfig ? `Il centro lavora già, ma Gold evita priorità economiche forti finché mancano ${servicesMissingCosts} costi servizio e ${operatorsMissingHourlyCost} costi orari operatori.` : "",
        lowMaturity ? progressiveMessage : "",
        lowMaturity ? "Corelia qui deve restare prudente: descrive il centro ma non forza priorità artificiali" : "",
        shadowDecision === "block" ? "Il governor shadow legge questa priorità come bloccata, quindi la risposta resta descrittiva e non esecutiva." : "",
        shadowDecision === "escalate" ? "Il governor shadow chiede un passaggio umano più esplicito prima di trattare il segnale come azione forte." : "",
        shadowDecision === "retry" ? "Il governor shadow preferisce un secondo passaggio o una verifica prima di confermare questa direzione." : "",
        shadowDecision === "fallback" ? "Il governor shadow preferisce una strada più prudente rispetto alla prima formulazione." : "",
        shadowRuntime ? `Runtime shadow selezionato: ${shadowRuntime}.` : "",
        mainProblem ? `Il segnale dominante oggi è ${mainProblem}` : "",
        bestOpportunity ? `L'opportunità più utile è ${bestOpportunity}` : "",
        centerHealth.reason || "",
        primaryActionCandidate.explanationShort || "",
        state.goldState?.decision?.explanationShort || ""
      ]);
      recommendedNextStep = profitabilityBlockedForConfig && (String(primaryActionCandidate.domain || "") === "profitability" || String(primaryActionCandidate.domain || "") === "economic")
        ? `apri servizi e operatori e completa ${servicesMissingCosts} costi servizio e ${operatorsMissingHourlyCost} costi orari operatori`
        : lowMaturity
          ? "chiudi i dati base del centro e poi rileggi AI Gold"
          : shadowDecision === "block"
            ? "non eseguire ora: apri il modulo collegato e verifica prima il dato o la configurazione"
            : shadowDecision === "escalate"
              ? "usa l'indicazione come guida e fai una conferma operativa esplicita prima di agire"
              : shadowDecision === "retry"
                ? "ripeti la lettura nel modulo collegato e conferma solo dopo un secondo controllo"
                : shadowDecision === "fallback"
                  ? "apri il modulo collegato e usa il percorso più prudente disponibile"
                  : primaryActionCandidate.canExecute === false
                    ? "usa l'indicazione come guida e conferma l'azione dal modulo corretto"
                    : firstAction
                      ? `apri il modulo collegato e conferma: ${firstAction}`
                      : "apri il modulo suggerito e verifica il contesto prima di agire";
      sourceUsed = ["decisionSelection", "decisionPrimarySnapshot", "goldStateSummary", "reportParallel"];
    }

    const humanSummary = `${primarySignal}. Azione: ${primaryAction}.`;
    const uiReadingBand = resolveUiReadingBand(v7, actionBand);
    return {
      identity: "corelia",
      tenantId: String(state.snapshot?.centerId || state.goldState?.centerId || ""),
      timestamp: state.snapshot?.generatedAt || new Date().toISOString(),
      intent,
      domain,
      confidence: confidenceBlock.confidence,
      urgency: urgencyBlock.urgency,
      primarySignal,
      secondarySignals,
      sourceUsed,
      primaryAction,
      actionBand,
      risks,
      reasons,
      evidence,
      recommendedNextStep,
      humanSummary,
      uiReadingBand,
      uiReadingLabel: uiReadingLabel(uiReadingBand),
      v7,
      confidenceBreakdown: confidenceBlock.parts,
      urgencyBreakdown: urgencyBlock.parts
    };
  }

  buildDialog(payload = {}, session = null) {
    const message = String(payload.message || payload.question || "").trim();
    const period = {
      startDate: payload.startDate || "",
      endDate: payload.endDate || ""
    };
    const state = this.getBaseStateContext(period, session, payload.sourceOverrides || {});
    const routerIntent = parseIntent(message, payload.routerVariant || this.routerVariant);
    const routerDomain = routeDomain(message, state, routerIntent.intent, payload.routerVariant || this.routerVariant);
    return this.buildStructuredDomainAnswer(message, routerDomain.domain, routerIntent.intent, state);
  }
}

module.exports = {
  CoreliaBridge
};
