#!/usr/bin/env node
"use strict";

const { computeMarketingSnapshot } = require("../src/core/marketing/MarketingCore");

const DEFAULT_BASE_URL = "https://skinharmony-smartdesk-live.onrender.com";

const AGREEMENT_BANDS = Object.freeze({
  aligned: 0.90,
  watch: 0.75
});

const MARKETING_AUDIT_WEIGHTS = Object.freeze({
  eligibleRatio: 0.15,
  contactableRatio: 0.15,
  suppressedRatio: 0.15,
  top3Overlap: 0.20,
  averageOpportunity: 0.15
});

const CAUSE_BY_METRIC = Object.freeze({
  eligibleRatio: "CONSENT_POLICY_MISMATCH",
  contactableRatio: "CONTACTABILITY_POLICY_MISMATCH",
  suppressedRatio: "SUPPRESSION_POLICY_MISMATCH",
  averageOpportunity: "OPPORTUNITY_SCALE_MISMATCH",
  top3Overlap: "TOP_CANDIDATE_RANKING_MISMATCH"
});

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function clean(value = "") {
  return String(value || "").trim();
}

function toDateOnly(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function scoreRatio(value = 0, total = 0) {
  const denominator = Number(total || 0);
  if (!denominator) return null;
  return Math.max(0, Math.min(1, Number(value || 0) / denominator));
}

function userLabel(user = {}) {
  return clean(user.centerName || user.businessName || user.username || user.id);
}

function planOf(user = {}) {
  return String(user.subscriptionPlan || user.plan || "").toLowerCase();
}

function chooseTenants(users = []) {
  const gold = users.filter((user) => planOf(user) === "gold");
  const privilege = gold.find((user) => /privilege/i.test(userLabel(user))) || gold.find((user) => /privilege/i.test(user.username || ""));
  const medium = gold
    .filter((user) => user.id !== privilege?.id)
    .find((user) => /073|centro.*73|gold100_gold_073/i.test([userLabel(user), user.username, user.centerId].join(" ")))
    || gold.find((user) => user.id !== privilege?.id);
  const fragile = gold
    .filter((user) => ![privilege?.id, medium?.id].includes(user.id))
    .reverse()
    .find((user) => /100|fragile|incomplet|gold100_gold_100/i.test([userLabel(user), user.username, user.centerId].join(" ")))
    || gold.find((user) => ![privilege?.id, medium?.id].includes(user.id));
  return [privilege, medium, fragile].filter(Boolean);
}

function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.clients)) return data.clients;
  if (Array.isArray(data?.appointments)) return data.appointments;
  if (Array.isArray(data?.payments)) return data.payments;
  if (Array.isArray(data?.services)) return data.services;
  if (Array.isArray(data?.actions)) return data.actions;
  if (Array.isArray(data?.messages)) return data.messages;
  return [];
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

function validContact(client = {}) {
  const phoneDigits = String(client.phone || client.mobile || client.whatsapp || "").replace(/\D/g, "");
  const email = String(client.email || "");
  return phoneDigits.length >= 7 || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function buildHorizon(appointments = [], payments = [], marketingHistory = []) {
  const dates = [
    ...appointments.map((item) => item.startAt || item.date || item.createdAt),
    ...payments.map((item) => item.paidAt || item.createdAt || item.date),
    ...marketingHistory.map((item) => item.sentAt || item.copiedAt || item.approvedAt || item.generatedAt || item.createdAt)
  ].map(toDateOnly).filter(Boolean).sort();
  return {
    startDate: dates[0] || "",
    endDate: dates[dates.length - 1] || toDateOnly(new Date().toISOString()),
    mode: dates.length ? "live_observed_marketing_data" : "live_empty_marketing_data"
  };
}

function normalizeCoreSnapshot(core = {}) {
  const counts = core.counts || {};
  const scores = core.scores || {};
  return {
    readiness: Number(scores.marketingReadiness || 0),
    averageOpportunity: Number(scores.averageOpportunity || 0),
    averageChurnRisk: Number(scores.averageChurnRisk || 0),
    averageContactability: Number(scores.averageContactability || 0),
    averageSpamPressure: Number(scores.averageSpamPressure || 0),
    clients: Number(counts.clients || 0),
    eligibleClients: Number(counts.eligibleClients || 0),
    contactableClients: Number(counts.contactableClients || 0),
    suppressedClients: Number(counts.suppressedClients || 0),
    eligibleRatio: scoreRatio(counts.eligibleClients || 0, counts.clients || 0),
    contactableRatio: scoreRatio(counts.contactableClients || 0, counts.clients || 0),
    suppressedRatio: scoreRatio(counts.suppressedClients || 0, counts.clients || 0),
    topCandidates: (core.topCandidates || []).map((item) => ({
      clientId: String(item.clientId || ""),
      clientName: item.clientName || item.name || "Cliente",
      opportunityScore: Number(item.opportunityScore || 0),
      actionBand: item.actionBand || "MONITOR",
      reasonCodes: item.reasonCodes || [],
      sourceFlags: item.sourceFlags || []
    })),
    sourceFlags: core.sourceFlags || []
  };
}

function normalizeLegacySnapshot(state = {}, marketingEndpoint = {}) {
  const marketingActions = state.marketingActions || {};
  const actions = Array.isArray(marketingActions.actions)
    ? marketingActions.actions
    : Array.isArray(marketingEndpoint.actions)
      ? marketingEndpoint.actions
      : Array.isArray(marketingEndpoint.suggestions)
        ? marketingEndpoint.suggestions
        : [];
  const debug = marketingActions.debug || marketingEndpoint.debug || {};
  const counters = marketingActions.counters || marketingEndpoint.counters || {};
  const analyzed = Number(debug.clientsAnalyzed || actions.length || 0);
  const eligibleClients = Number(counters.totalActions ?? marketingEndpoint.kpis?.recommendedToday ?? actions.length);
  const contactableClients = actions.filter((item) => item.contactable || (item.hasMarketingConsent && (item.phone || item.email))).length;
  const suppressedClients = Number(debug.excludedByFilter || debug.nonContactable || marketingEndpoint.kpis?.avoidToday || 0);
  const scores = actions
    .map((item) => Number(item.goldDecision?.score ?? item.priorityScore ?? item.score ?? 0))
    .filter(Number.isFinite);
  return {
    readiness: null,
    averageOpportunity: scores.length ? round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
    clients: analyzed,
    eligibleClients,
    contactableClients,
    suppressedClients,
    eligibleRatio: analyzed ? scoreRatio(eligibleClients, analyzed) : null,
    contactableRatio: analyzed ? scoreRatio(contactableClients, analyzed) : null,
    suppressedRatio: analyzed ? scoreRatio(suppressedClients, analyzed) : null,
    topCandidates: actions.map((item) => ({
      clientId: String(item.clientId || ""),
      clientName: item.clientName || item.name || "Cliente",
      opportunityScore: Number(item.goldDecision?.score ?? item.priorityScore ?? item.score ?? 0),
      status: item.status || "",
      contactable: Boolean(item.contactable)
    })),
    sourceFlags: ["legacy:gold_marketing_action_state", "legacy:readiness_not_available"]
  };
}

function top3Overlap(legacy = {}, core = {}) {
  const legacyTop = (legacy.topCandidates || []).map((item) => String(item.clientId || "")).filter(Boolean).slice(0, 3);
  const coreTop = (core.topCandidates || []).map((item) => String(item.clientId || "")).filter(Boolean).slice(0, 3);
  if (!legacyTop.length || !coreTop.length) return null;
  const denominator = Math.max(1, Math.min(3, legacyTop.length, coreTop.length));
  return round(legacyTop.filter((clientId) => coreTop.includes(clientId)).length / denominator);
}

function computeAgreement(legacy = {}, core = {}) {
  const scalarMetrics = ["eligibleRatio", "contactableRatio", "suppressedRatio", "averageOpportunity"]
    .filter((metric) => legacy[metric] !== null && legacy[metric] !== undefined && core[metric] !== null && core[metric] !== undefined);
  const overlap = top3Overlap(legacy, core);
  const comparableMetrics = [...scalarMetrics, ...(overlap !== null ? ["top3Overlap"] : [])];
  if (!comparableMetrics.length) {
    return {
      comparableMetrics: [],
      deltas: {},
      relativeErrors: {},
      top3Overlap: null,
      agreementScore: null,
      agreementBand: "N/A",
      warnings: ["MARKETING_NOT_COMPARABLE"],
      weightsUsed: {}
    };
  }
  const totalWeight = comparableMetrics.reduce((sum, metric) => sum + Number(MARKETING_AUDIT_WEIGHTS[metric] || 0), 0) || comparableMetrics.length;
  const deltas = {};
  const relativeErrors = {};
  const weightsUsed = {};
  const warnings = [];
  let agreement = 0;
  scalarMetrics.forEach((metric) => {
    const delta = round(Number(core[metric] || 0) - Number(legacy[metric] || 0));
    const error = round(Math.abs(delta));
    const match = Math.max(0, Math.min(1, 1 - error));
    const weight = Number(MARKETING_AUDIT_WEIGHTS[metric] || 0) / totalWeight;
    deltas[metric] = delta;
    relativeErrors[metric] = error;
    weightsUsed[metric] = round(weight);
    agreement += weight * match;
    if (error > 0.20) warnings.push(`MARKETING_${metric.replace(/Ratio|average/g, "").toUpperCase()}_DRIFT`);
  });
  if (overlap !== null) {
    const weight = Number(MARKETING_AUDIT_WEIGHTS.top3Overlap || 0) / totalWeight;
    weightsUsed.top3Overlap = round(weight);
    agreement += weight * overlap;
    if (overlap < 0.67) warnings.push("MARKETING_TOPK_DRIFT");
  }
  const agreementScore = round(Math.max(0, Math.min(1, agreement)));
  return {
    comparableMetrics,
    deltas,
    relativeErrors,
    top3Overlap: overlap,
    agreementScore,
    agreementBand: agreementScore >= AGREEMENT_BANDS.aligned ? "ALIGNED" : agreementScore >= AGREEMENT_BANDS.watch ? "WATCH" : "DRIFT",
    warnings,
    weightsUsed
  };
}

function explainMarketingDrift(diff = {}, raw = {}, core = {}) {
  const causes = [];
  Object.entries(diff.relativeErrors || {}).forEach(([metric, error]) => {
    if (Number(error || 0) < 0.15) return;
    const category = CAUSE_BY_METRIC[metric] || "MARKETING_POLICY_MISMATCH";
    const examples = [];
    if (metric === "contactableRatio" || category === "CONTACTABILITY_POLICY_MISMATCH") {
      examples.push(...raw.clients.filter((client) => !validContact(client)).slice(0, 2).map((client) => ({
        id: client.id,
        name: [client.firstName, client.lastName].filter(Boolean).join(" ") || client.name || "Cliente",
        issue: "missing phone/email"
      })));
    }
    if (metric === "eligibleRatio" || category === "CONSENT_POLICY_MISMATCH") {
      examples.push(...raw.clients.filter((client) => client.marketingConsent !== true).slice(0, 2).map((client) => ({
        id: client.id,
        name: [client.firstName, client.lastName].filter(Boolean).join(" ") || client.name || "Cliente",
        issue: "marketing consent not true"
      })));
    }
    causes.push({
      category,
      metric,
      contribution: round(error),
      examples
    });
  });
  if (diff.top3Overlap !== null && diff.top3Overlap < 0.67) {
    causes.push({
      category: "TOP_CANDIDATE_RANKING_MISMATCH",
      metric: "top3Overlap",
      contribution: round(1 - Number(diff.top3Overlap || 0)),
      examples: (core.topCandidates || []).slice(0, 2).map((item) => ({
        clientId: item.clientId,
        score: item.opportunityScore,
        actionBand: item.actionBand,
        reasonCodes: item.reasonCodes
      }))
    });
  }
  if ((core.sourceFlags || []).includes("marketing_core:marketing_history_missing_or_empty")) {
    causes.push({
      category: "HISTORY_COVERAGE_MISMATCH",
      metric: "marketingHistory",
      contribution: null,
      examples: []
    });
  }
  return causes.sort((a, b) => Number(b.contribution || 0) - Number(a.contribution || 0));
}

function promotionDecision(audit = {}) {
  const agreement = Number(audit.agreementScore || 0);
  const readiness = Number(audit.core?.readiness || 0);
  const warnings = new Set(audit.warnings || []);
  if (agreement >= 0.90 && readiness >= 0.75 && !warnings.has("MARKETING_CONTACTABLE_DRIFT") && !warnings.has("MARKETING_ELIGIBLE_DRIFT")) return "YES";
  if (agreement >= 0.75) return "WATCH";
  return "NO";
}

function buildCoreFromLiveRaw(raw = {}) {
  const horizon = buildHorizon(raw.appointments, raw.payments, raw.marketingHistory);
  return computeMarketingSnapshot({
    horizon,
    now: horizon.endDate || new Date().toISOString(),
    goal: { type: "recall", seasonFit: 0.5 },
    clients: raw.clients,
    appointments: raw.appointments,
    payments: raw.payments,
    services: raw.services,
    marketingHistory: raw.marketingHistory,
    schedule: {}
  });
}

async function auditTenant(baseUrl, adminToken, tenant) {
  const support = await request(baseUrl, `/api/auth/users/${tenant.id}/support-session`, { method: "POST", token: adminToken, body: {} });
  const token = support.token;
  const [
    state,
    marketingEndpoint,
    clientsData,
    appointmentsData,
    paymentsData,
    servicesData,
    autopilot,
    whatsappStatus
  ] = await Promise.all([
    request(baseUrl, "/api/ai-gold/state", { token }),
    request(baseUrl, "/api/ai-gold/marketing", { token }).catch(() => ({})),
    request(baseUrl, "/api/clients?summary=1&limit=5000", { token }).catch(() => []),
    request(baseUrl, "/api/appointments?view=all", { token }).catch(() => []),
    request(baseUrl, "/api/payments", { token }).catch(() => []),
    request(baseUrl, "/api/catalog/services", { token }).catch(() => []),
    request(baseUrl, "/api/ai-gold/marketing/autopilot", { token }).catch(() => ({})),
    request(baseUrl, "/api/ai-gold/whatsapp/status", { token }).catch(() => ({}))
  ]);
  const raw = {
    clients: normalizeRows(clientsData),
    appointments: normalizeRows(appointmentsData),
    payments: normalizeRows(paymentsData),
    services: normalizeRows(servicesData),
    marketingHistory: [
      ...normalizeRows(autopilot),
      ...normalizeRows(whatsappStatus)
    ]
  };
  const liveParallel = state.marketingParallel || null;
  const legacy = liveParallel?.legacySnapshot || normalizeLegacySnapshot(state, marketingEndpoint);
  const localCoreRaw = buildCoreFromLiveRaw(raw);
  const localCore = normalizeCoreSnapshot(localCoreRaw);
  const core = liveParallel?.coreSnapshot || localCore;
  const diff = liveParallel?.diffSnapshot || computeAgreement(legacy, core);
  const causes = explainMarketingDrift(diff, raw, core);
  const audit = {
    tenantId: tenant.id,
    username: tenant.username,
    centerId: tenant.centerId,
    centerName: userLabel(tenant),
    selectedReason: /privilege/i.test(userLabel(tenant)) ? "tenant obbligatorio Privilege" : "tenant Gold reale scelto per confronto medio/fragile",
    liveShadowPresent: Boolean(liveParallel),
    liveShadowStatus: liveParallel?.status || "missing",
    horizon: liveParallel?.horizon || localCoreRaw.horizon,
    rawCounts: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.length])),
    legacy,
    core,
    localCoreShadow: localCore,
    diffSnapshot: diff,
    eligibleRatio: { legacy: legacy.eligibleRatio, core: core.eligibleRatio },
    contactableRatio: { legacy: legacy.contactableRatio, core: core.contactableRatio },
    suppressedRatio: { legacy: legacy.suppressedRatio, core: core.suppressedRatio },
    averageOpportunity: { legacy: legacy.averageOpportunity, core: core.averageOpportunity },
    top3Overlap: diff.top3Overlap,
    agreementScore: diff.agreementScore,
    agreementBand: diff.agreementBand,
    warnings: diff.warnings || [],
    sourceFlags: [
      ...(liveParallel?.sourceFlags || []),
      ...(legacy.sourceFlags || []),
      ...(core.sourceFlags || []),
      !liveParallel ? "marketing_parallel:not_present_live" : ""
    ].filter(Boolean),
    causes,
    dominantDrift: causes[0]?.category || "NO_DOMINANT_DRIFT"
  };
  audit.promoteToCoreMarketing = promotionDecision(audit);
  return audit;
}

async function main() {
  const baseUrl = process.env.SMARTDESK_LIVE_URL || DEFAULT_BASE_URL;
  const username = process.env.SMARTDESK_ADMIN_USER;
  const password = process.env.SMARTDESK_ADMIN_PASSWORD;
  if (!username || !password) throw new Error("Set SMARTDESK_ADMIN_USER and SMARTDESK_ADMIN_PASSWORD");
  const health = await request(baseUrl, "/health");
  const login = await request(baseUrl, "/api/auth/login", { method: "POST", body: { username, password } });
  const users = await request(baseUrl, "/api/auth/users", { token: login.token });
  const tenants = chooseTenants(users);
  if (!tenants.length) throw new Error("No Gold tenants found");
  const audits = [];
  for (const tenant of tenants) {
    audits.push(await auditTenant(baseUrl, login.token, tenant));
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    commitLive: health.commit || health.version || null,
    tenantsAnalyzed: audits.map((item) => item.centerName),
    audits,
    globalCauses: Array.from(new Set(audits.flatMap((item) => item.causes.map((cause) => cause.category)))),
    recommendation: audits.every((item) => item.liveShadowPresent)
      ? (audits.some((item) => item.agreementBand === "DRIFT" || item.warnings.includes("MARKETING_CONTACTABLE_DRIFT") || item.warnings.includes("MARKETING_ELIGIBLE_DRIFT"))
          ? "MarketingPolicyAdapter prima della Fase 3"
          : "valutare Fase 3 solo se readiness resta >= 0.75 sui tenant forti")
      : "portare online MarketingCore Fase 2 shadow prima di considerare valida la Fase 2.5 live",
    confirmations: {
      readOnly: true,
      marketingCorePrimary: false,
      uiChanged: false,
      publicApiChanged: false,
      realDataModified: false,
      messagesSent: false
    }
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  chooseTenants,
  normalizeLegacySnapshot,
  normalizeCoreSnapshot,
  computeAgreement,
  explainMarketingDrift,
  promotionDecision,
  buildCoreFromLiveRaw
};
