function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function average(values = []) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function readSettingsStore(settingsRepository) {
  const current = settingsRepository?.list?.();
  if (!current || Array.isArray(current)) return {};
  if (current.centerName || current.centerType || current.businessModel) {
    return { default: current };
  }
  return current;
}

function statusFromCenter(center = {}) {
  const maturity = Number(center.maturityScore || 0);
  const alerts = Array.isArray(center.alerts) ? center.alerts : [];
  const critical = alerts.some((alert) => alert.level === "critical");
  const warning = alerts.some((alert) => alert.level === "warning");
  if (critical || maturity < 0.4) return "red";
  if (warning || maturity < 0.65) return "yellow";
  return "green";
}

class FleetIntelligenceLayer {
  constructor(repositories = {}, options = {}) {
    this.usersRepository = repositories.usersRepository;
    this.goldStateRepository = repositories.goldStateRepository;
    this.settingsRepository = repositories.settingsRepository;
    this.now = options.now || (() => new Date().toISOString());
  }

  assertFleetAccess(session = null) {
    if (String(session?.role || "").toLowerCase() !== "superadmin") {
      throw new Error("Fleet Intelligence disponibile solo in modalita Super Admin Fleet");
    }
  }

  logFleet(endpoint = "", centerIds = [], session = null) {
    console.log("[fleet_intelligence]", JSON.stringify({
      role: "SUPER_ADMIN_FLEET",
      username: session?.username || "",
      endpoint,
      centerIds,
      timestamp: this.now(),
      readOnly: true
    }));
  }

  resolveFleetCenterIds(filters = {}) {
    const explicitCenterIds = String(filters.centerIds || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (explicitCenterIds.length) return new Set(explicitCenterIds);
    const fleetId = String(filters.fleetId || "").trim();
    const users = this.usersRepository?.list?.() || [];
    return new Set(users
      .filter((user) => String(user.role || "").toLowerCase() !== "superadmin")
      .filter((user) => !fleetId || String(user.fleetId || user.networkId || "") === fleetId)
      .map((user) => String(user.centerId || "").trim())
      .filter(Boolean));
  }

  readCenters(filters = {}) {
    const allowedCenterIds = this.resolveFleetCenterIds(filters);
    const users = this.usersRepository?.list?.() || [];
    const states = this.goldStateRepository?.list?.() || [];
    const settingsStore = readSettingsStore(this.settingsRepository);
    const byCenter = new Map();

    users
      .filter((user) => String(user.role || "").toLowerCase() !== "superadmin")
      .filter((user) => allowedCenterIds.has(String(user.centerId || "")))
      .forEach((user) => {
        const centerId = String(user.centerId || "").trim();
        if (!centerId || byCenter.has(centerId)) return;
        byCenter.set(centerId, {
          centerId,
          centerName: String(user.centerName || user.businessName || user.username || "Centro"),
          username: String(user.username || ""),
          plan: String(user.subscriptionPlan || "base").toLowerCase(),
          fleetId: String(user.fleetId || user.networkId || ""),
          user
        });
      });

    states
      .filter((state) => allowedCenterIds.has(String(state.centerId || "")))
      .forEach((state) => {
        const centerId = String(state.centerId || "").trim();
        if (!centerId || byCenter.has(centerId)) return;
        byCenter.set(centerId, {
          centerId,
          centerName: String(state.centerName || "Centro"),
          username: "",
          plan: "gold",
          fleetId: "",
          user: null
        });
      });

    return Array.from(byCenter.values()).map((center) => {
      const state = states.find((item) => String(item.centerId || "") === center.centerId) || null;
      const settings = settingsStore[center.centerId] || settingsStore.default || {};
      const pial = settings.progressiveIntelligenceStatus || null;
      return this.buildCenterSnapshot(center, state, pial);
    }).sort((a, b) => a.centerName.localeCompare(b.centerName));
  }

  buildCenterSnapshot(center = {}, state = null, pial = null) {
    const components = state?.components || {};
    const signals = state?.signals || {};
    const decision = state?.decision || null;
    const validation = state?.metadata?.validation || {};
    const maturityScore = round(pial?.maturityScore ?? 0, 4);
    const activationLevel = Number(pial?.activationLevel ?? 0);
    const alerts = this.buildCenterAlerts(center, state, pial);
    const snapshot = {
      centerId: center.centerId,
      centerName: center.centerName,
      username: center.username,
      plan: center.plan,
      fleetId: center.fleetId,
      stateAvailable: Boolean(state),
      eventSeq: Number(state?.eventSeq || 0),
      stateValid: state ? state.metadata?.valid !== false && validation.valid !== false : false,
      maturityScore,
      activationLevel,
      activationCode: pial?.activationCode || `L${activationLevel}`,
      activationLabel: pial?.activationEnterpriseLabel || pial?.activationLabel || "",
      oracleEnabled: Boolean(pial?.oracle?.enabled),
      oracleMode: String(pial?.oracle?.mode || ""),
      decision: decision ? {
        domain: String(decision.domain || ""),
        action: String(decision.action || decision.suggestedAction || ""),
        score: round(decision.score ?? decision.riskAdjustedPriority ?? 0, 4),
        explanation: String(decision.explanationShort || decision.explanation || "").slice(0, 240)
      } : null,
      components: {
        Rev: Number(components.Rev || 0),
        U: Number(components.U || 0),
        Sat: round(components.Sat || 0, 4),
        Act: Number(components.Act || 0),
        Cont: round(components.Cont || 0, 4),
        Ticket: Number(components.Ticket || 0),
        Prod: round(components.Prod || 0, 4),
        DQ: round(components.DQ ?? 0, 4),
        CostConf: round(components.CostConf ?? 0, 4),
        Margin: round(components.Margin ?? 0, 4),
        Conf: round(components.Conf ?? 0, 4)
      },
      signals: {
        operationalRisk: round(signals.operationalRisk || 0, 4),
        centerBelowThreshold: round(signals.centerBelowThreshold || 0, 4),
        opportunity: round(signals.opportunity || 0, 4),
        cashAnomaly: round(signals.cashAnomaly || 0, 4),
        marginAnomaly: round(signals.marginAnomaly || 0, 4),
        dataReliability: round(signals.dataReliability || 0, 4),
        productivitySignal: round(signals.productivitySignal || 0, 4)
      },
      pialCached: Boolean(pial),
      pialGeneratedAt: String(pial?.generatedAt || ""),
      alerts
    };
    return {
      ...snapshot,
      status: statusFromCenter(snapshot)
    };
  }

  buildCenterAlerts(center = {}, state = null, pial = null) {
    const components = state?.components || {};
    const alerts = [];
    if (!state && center.plan === "gold") {
      alerts.push({ level: "critical", type: "missing_state", message: "Gold State non disponibile" });
    }
    if (state && state.metadata?.validation?.valid === false) {
      alerts.push({ level: "critical", type: "drift", message: "Possibile drift state/raw" });
    }
    if (state && Number(components.DQ ?? 1) < 0.7) {
      alerts.push({ level: "warning", type: "dirty_data", message: "Qualita dati sotto soglia" });
    }
    if (state && Number(components.CostConf ?? 1) < 0.65) {
      alerts.push({ level: "warning", type: "cost_completeness", message: "Completezza costi bassa" });
    }
    if (state && Number(components.Margin ?? 1) < 0.25 && Number(components.CostConf ?? 0) >= 0.65) {
      alerts.push({ level: "warning", type: "low_margin", message: "Margine medio basso" });
    }
    if (state && Number(components.U || 0) > 0) {
      alerts.push({ level: "warning", type: "cash_unlinked", message: `${Number(components.U || 0)} pagamenti non collegati` });
    }
    if (pial && Number(pial.activationLevel || 0) <= 1) {
      alerts.push({ level: "info", type: "low_maturity", message: "Intelligenza ancora in maturazione" });
    }
    return alerts;
  }

  getFleetOverview(session = null, filters = {}) {
    this.assertFleetAccess(session);
    const centers = this.readCenters(filters);
    this.logFleet("overview", centers.map((item) => item.centerId), session);
    return {
      success: true,
      mode: "SUPER_ADMIN_FLEET",
      readOnly: true,
      generatedAt: this.now(),
      totalCenters: centers.length,
      counts: this.countByStatus(centers),
      centers: centers.map((center) => ({
        centerId: center.centerId,
        centerName: center.centerName,
        plan: center.plan,
        status: center.status,
        maturityScore: center.maturityScore,
        activationLevel: center.activationLevel,
        activationCode: center.activationCode,
        oracleEnabled: center.oracleEnabled,
        stateAvailable: center.stateAvailable,
        eventSeq: center.eventSeq,
        topAlert: center.alerts[0] || null
      }))
    };
  }

  getFleetMaturity(session = null, filters = {}) {
    this.assertFleetAccess(session);
    const centers = this.readCenters(filters);
    this.logFleet("maturity", centers.map((item) => item.centerId), session);
    const distribution = centers.reduce((acc, center) => {
      const key = `L${Number(center.activationLevel || 0)}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 });
    return {
      success: true,
      mode: "SUPER_ADMIN_FLEET",
      readOnly: true,
      generatedAt: this.now(),
      averageMaturity: round(average(centers.map((item) => item.maturityScore)), 4),
      distribution,
      blockedCenters: centers
        .filter((center) => Number(center.activationLevel || 0) <= 2)
        .map((center) => ({
          centerId: center.centerId,
          centerName: center.centerName,
          maturityScore: center.maturityScore,
          activationLevel: center.activationLevel,
          alerts: center.alerts
        }))
    };
  }

  getFleetOutliers(session = null, filters = {}) {
    this.assertFleetAccess(session);
    const centers = this.readCenters(filters);
    this.logFleet("outliers", centers.map((item) => item.centerId), session);
    const avg = average(centers.map((item) => item.maturityScore));
    const enriched = centers.map((center) => ({
      centerId: center.centerId,
      centerName: center.centerName,
      maturityScore: center.maturityScore,
      delta: round(center.maturityScore - avg, 4),
      status: center.status,
      alerts: center.alerts
    }));
    return {
      success: true,
      mode: "SUPER_ADMIN_FLEET",
      readOnly: true,
      generatedAt: this.now(),
      averageMaturity: round(avg, 4),
      belowAverage: enriched.filter((item) => item.delta < -0.1).sort((a, b) => a.delta - b.delta),
      aboveAverage: enriched.filter((item) => item.delta > 0.1).sort((a, b) => b.delta - a.delta)
    };
  }

  getFleetAlerts(session = null, filters = {}) {
    this.assertFleetAccess(session);
    const centers = this.readCenters(filters);
    this.logFleet("alerts", centers.map((item) => item.centerId), session);
    const alerts = centers.flatMap((center) => center.alerts.map((alert) => ({
      centerId: center.centerId,
      centerName: center.centerName,
      status: center.status,
      maturityScore: center.maturityScore,
      ...alert
    })));
    return {
      success: true,
      mode: "SUPER_ADMIN_FLEET",
      readOnly: true,
      generatedAt: this.now(),
      totalAlerts: alerts.length,
      critical: alerts.filter((item) => item.level === "critical"),
      warnings: alerts.filter((item) => item.level === "warning"),
      info: alerts.filter((item) => item.level === "info")
    };
  }

  getFleetPerformance(session = null, filters = {}) {
    this.assertFleetAccess(session);
    const centers = this.readCenters(filters);
    this.logFleet("performance", centers.map((item) => item.centerId), session);
    const ranking = centers
      .map((center) => ({
        centerId: center.centerId,
        centerName: center.centerName,
        status: center.status,
        maturityScore: center.maturityScore,
        activationLevel: center.activationLevel,
        revenue: center.components.Rev,
        ticket: center.components.Ticket,
        margin: center.components.Margin,
        dataQuality: center.components.DQ,
        economicConfidence: center.components.Conf,
        score: round((0.25 * center.maturityScore)
          + (0.2 * clamp01(center.components.DQ))
          + (0.2 * clamp01(center.components.Conf))
          + (0.2 * clamp01(center.components.Margin))
          + (0.15 * clamp01(center.components.Prod)), 4)
      }))
      .sort((a, b) => b.score - a.score);
    return {
      success: true,
      mode: "SUPER_ADMIN_FLEET",
      readOnly: true,
      generatedAt: this.now(),
      ranking,
      topCenters: ranking.slice(0, 10),
      lowCenters: ranking.slice(-10).reverse()
    };
  }

  getFleetOracleSummary(session = null, filters = {}) {
    this.assertFleetAccess(session);
    const centers = this.readCenters(filters);
    this.logFleet("oracle", centers.map((item) => item.centerId), session);
    const oracleCenters = centers.filter((center) => center.oracleEnabled);
    const riskCenters = centers.filter((center) => center.status === "red" || center.alerts.some((alert) => ["drift", "dirty_data", "low_margin"].includes(alert.type)));
    const opportunities = centers
      .filter((center) => center.signals.opportunity >= 0.5 || center.activationLevel >= 4)
      .map((center) => ({
        centerId: center.centerId,
        centerName: center.centerName,
        maturityScore: center.maturityScore,
        activationLevel: center.activationLevel,
        opportunity: center.signals.opportunity,
        oracleEnabled: center.oracleEnabled
      }))
      .sort((a, b) => b.opportunity - a.opportunity || b.maturityScore - a.maturityScore);
    return {
      success: true,
      mode: "SUPER_ADMIN_FLEET",
      readOnly: true,
      generatedAt: this.now(),
      oracleEnabledCenters: oracleCenters.length,
      oracleCoverage: centers.length ? round(oracleCenters.length / centers.length, 4) : 0,
      globalRisk: {
        riskCenters: riskCenters.length,
        ratio: centers.length ? round(riskCenters.length / centers.length, 4) : 0,
        mainRisks: this.aggregateAlertTypes(riskCenters)
      },
      networkTrend: oracleCenters.length >= 3 ? "oracle_ready_network" : "descrittivo_non_predittivo",
      opportunities: opportunities.slice(0, 10)
    };
  }

  countByStatus(centers = []) {
    return centers.reduce((acc, center) => {
      acc[center.status] = (acc[center.status] || 0) + 1;
      return acc;
    }, { green: 0, yellow: 0, red: 0 });
  }

  aggregateAlertTypes(centers = []) {
    const counts = {};
    centers.forEach((center) => {
      center.alerts.forEach((alert) => {
        counts[alert.type] = (counts[alert.type] || 0) + 1;
      });
    });
    return counts;
  }
}

module.exports = {
  FleetIntelligenceLayer
};
