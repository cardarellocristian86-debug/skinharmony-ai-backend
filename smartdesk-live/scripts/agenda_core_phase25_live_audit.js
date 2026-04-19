#!/usr/bin/env node
"use strict";

const { computeAgendaSnapshot } = require("../src/core/agenda/AgendaCore");

const DEFAULT_BASE_URL = "https://skinharmony-smartdesk-live.onrender.com";
const AGENDA_WEIGHTS = Object.freeze({ saturation: 0.25, pressure: 0.25, need: 0.20, band: 0.15, load: 0.15 });
const WARNING_THRESHOLDS = Object.freeze({ saturation: 0.20, pressure: 0.25, need: 0.20, band: 0.25 });

const CAUSE = Object.freeze({
  CAPACITY_POLICY_MISMATCH: "CAPACITY_POLICY_MISMATCH",
  SCHEDULE_FALLBACK_MISMATCH: "SCHEDULE_FALLBACK_MISMATCH",
  PRESSURE_PROXY_MISMATCH: "PRESSURE_PROXY_MISMATCH",
  NEED_POLICY_MISMATCH: "NEED_POLICY_MISMATCH",
  BAND_POLICY_MISMATCH: "BAND_POLICY_MISMATCH",
  FRAGILITY_NOT_COMPARABLE: "FRAGILITY_NOT_COMPARABLE",
  NOSHOW_NOT_COMPARABLE: "NOSHOW_NOT_COMPARABLE",
  SLOTVALUE_NOT_COMPARABLE: "SLOTVALUE_NOT_COMPARABLE",
  STATUS_POLICY_MISMATCH: "STATUS_POLICY_MISMATCH",
  RESOURCE_CLARITY_MISMATCH: "RESOURCE_CLARITY_MISMATCH"
});

async function request(baseUrl, path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!response.ok) throw new Error(`${response.status} ${path}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function clamp01(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function toDateOnly(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function clean(value = "") {
  return String(value || "").trim();
}

function tenantLabel(user = {}) {
  return clean(user.centerName || user.businessName || user.username || user.id);
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function statusOf(appointment = {}) {
  return String(appointment.status || "").toLowerCase();
}

function agendaBandScore(band = "") {
  const normalized = String(band || "").toUpperCase();
  if (normalized === "CRITICAL" || normalized === "INTERVENTO_ORA") return 0.9;
  if (normalized === "STRESSED") return 0.7;
  if (normalized === "WATCH" || normalized === "ATTENZIONE") return 0.45;
  if (normalized === "CALM" || normalized === "GIORNATA_EQUILIBRATA") return 0.2;
  return 0.2;
}

function buildHorizon(appointments = []) {
  const today = toDateOnly(new Date().toISOString());
  const end = new Date(`${today}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    startDate: today,
    endDate: end.toISOString().slice(0, 10),
    mode: "next_7_days_live_audit"
  };
}

function appointmentInLegacyWindow(appointment = {}, nowMs = Date.now()) {
  const time = new Date(appointment.startAt || appointment.createdAt || 0).getTime();
  if (!Number.isFinite(time)) return false;
  return time >= nowMs - 86400000 && time <= nowMs + (7 * 86400000);
}

function buildLegacyAgendaSnapshot({ state = {}, appointments = [], services = [] } = {}) {
  const existing = state.agendaParallel?.legacySnapshot;
  if (existing?.source === "gold_agenda_legacy") {
    return { ...existing, sourceFlags: [...(existing.sourceFlags || []), "agenda_audit:legacy_from_live_agendaParallel"] };
  }
  const servicesById = mapById(services);
  const maxServicePrice = Math.max(1, ...services.map((service) => Number(service.priceCents || 0)));
  const nowMs = Date.now();
  const relevant = appointments
    .filter((appointment) => !["cancelled", "no_show"].includes(statusOf(appointment)))
    .filter((appointment) => appointmentInLegacyWindow(appointment, nowMs))
    .slice(0, 120);
  const rows = relevant.map((appointment) => {
    const service = servicesById.get(String(appointment.serviceId || "")) || {};
    const startMs = new Date(appointment.startAt || appointment.createdAt || 0).getTime();
    const hoursToStart = Number.isFinite(startMs) ? (startMs - nowMs) / 3600000 : 168;
    const status = statusOf(appointment);
    const missingClient = !appointment.clientId && !appointment.clientName && !appointment.walkInName;
    const missingService = !appointment.serviceId && !appointment.serviceName && !appointment.service;
    const missingOperator = !appointment.staffId && !appointment.operatorId && !appointment.staffName;
    const incompleteScore = clamp01([missingClient, missingService, missingOperator].filter(Boolean).length / 3);
    const need = clamp01(Math.max(
      status === "requested" || status === "booked" ? 0.85 : 0,
      incompleteScore ? 0.75 + (incompleteScore * 0.25) : 0,
      status === "confirmed" ? 0.35 : 0
    ));
    const hour = Number(String(appointment.startAt || "").slice(11, 13));
    const strategicHour = Number.isFinite(hour) && ((hour >= 10 && hour <= 12) || (hour >= 17 && hour <= 19));
    const value = clamp01((Number(service.priceCents || appointment.amountCents || 0) / maxServicePrice) + (strategicHour ? 0.15 : 0));
    const urgency = hoursToStart <= 2 ? 1 : hoursToStart <= 24 ? 0.85 : hoursToStart <= 72 ? 0.55 : 0.25;
    const coherence = clamp01((Number(!missingClient) + Number(!missingService) + Number(!missingOperator)) / 3);
    const friction = clamp01(Math.max(
      incompleteScore,
      status === "completed" || status === "ready_checkout" ? 0.9 : 0,
      status === "confirmed" && hoursToStart > 24 ? 0.25 : 0
    ));
    // This mirrors the legacy agenda intent as an audit proxy without calling private side-effect services.
    const phi = clamp01((0.35 * need) + (0.20 * value) + (0.25 * urgency) + (0.20 * coherence) - (0.15 * friction));
    return { id: appointment.id, status, startAt: appointment.startAt || "", need, phi, missingClient, missingService, missingOperator };
  });
  const counters = state.counters || {};
  const components = state.components || {};
  const appointmentSlots = Math.max(1, Number(counters.appointmentSlots || 0));
  const todayAppointments = Math.max(0, Number(counters.todayAppointments || 0));
  const saturation = Number.isFinite(Number(components.Sat))
    ? clamp01(Number(components.Sat || 0))
    : clamp01(todayAppointments / appointmentSlots);
  const maxPhi = rows.length ? Math.max(...rows.map((item) => item.phi)) : 0;
  const maxNeed = rows.length ? Math.max(...rows.map((item) => item.need)) : 0;
  const status = rows.some((item) => item.phi >= 0.7) ? "intervento_ora" : rows.some((item) => item.phi >= 0.5) ? "attenzione" : "giornata_equilibrata";
  return {
    source: "gold_agenda_legacy_reconstructed_read_only",
    saturation,
    pressure: clamp01(maxPhi),
    need: clamp01(maxNeed),
    urgency: clamp01(maxNeed),
    band: status,
    bandProxy: agendaBandScore(status),
    total: rows.length,
    sampleRows: rows.sort((a, b) => b.phi - a.phi).slice(0, 6),
    sourceFlags: [
      "agenda_audit:legacy_reconstructed_read_only",
      "agenda_audit:pressure_from_phi_proxy",
      "agenda_audit:need_from_legacy_need_proxy",
      "agenda_audit:no_legacy_write"
    ]
  };
}

function normalizeCoreAgendaSnapshot(core = {}) {
  const scores = core.scores || core;
  return {
    mathCore: core.mathCore || "agenda_core_v1",
    horizon: core.horizon || null,
    saturation: clamp01(Number(scores.saturation || 0)),
    pressure: clamp01(Number(scores.pressure || 0)),
    fragility: clamp01(Number(scores.fragility || 0)),
    noShowRisk: clamp01(Number(scores.noShowRisk || 0)),
    slotValue: clamp01(Number(scores.slotValue || 0)),
    urgency: clamp01(Number(scores.urgency || 0)),
    readiness: clamp01(Number(scores.readiness || 0)),
    agendaScore: clamp01(Number(scores.agendaScore || 0)),
    need: clamp01(Number(scores.urgency || 0)),
    band: core.band || "CALM",
    bandProxy: agendaBandScore(core.band || "CALM"),
    counts: core.counts || {},
    sourceFlags: [
      ...(Array.isArray(core.sourceFlags) ? core.sourceFlags.map(String) : []),
      "agenda_audit:core_read_only",
      "agenda_audit:need_from_core_urgency"
    ],
    breakdown: core.breakdown || null
  };
}

function compareAgenda(legacy = {}, core = {}) {
  const metrics = [
    ["saturation", legacy.saturation, core.saturation, AGENDA_WEIGHTS.saturation, WARNING_THRESHOLDS.saturation],
    ["pressure", legacy.pressure, core.pressure, AGENDA_WEIGHTS.pressure, WARNING_THRESHOLDS.pressure],
    ["need", legacy.need, core.need, AGENDA_WEIGHTS.need, WARNING_THRESHOLDS.need],
    ["band", legacy.bandProxy, core.bandProxy, AGENDA_WEIGHTS.band, WARNING_THRESHOLDS.band]
  ].filter(([, legacyValue, coreValue]) => Number.isFinite(Number(legacyValue)) && Number.isFinite(Number(coreValue)));
  if (!metrics.length) {
    return {
      comparableMetrics: [],
      deltas: {},
      relativeErrors: {},
      agreementScore: null,
      agreementBand: "N/A",
      warnings: ["AGENDA_NOT_COMPARABLE"]
    };
  }
  const totalWeight = metrics.reduce((sum, item) => sum + item[3], 0);
  const deltas = {};
  const relativeErrors = {};
  const warnings = [];
  let weightedError = 0;
  metrics.forEach(([key, legacyValueRaw, coreValueRaw, weight, threshold]) => {
    const legacyValue = clamp01(legacyValueRaw);
    const coreValue = clamp01(coreValueRaw);
    const delta = coreValue - legacyValue;
    const error = Math.abs(delta);
    deltas[`${key}Delta`] = round(delta);
    relativeErrors[`${key}Error`] = round(error);
    weightedError += (weight / totalWeight) * error;
    if (error > threshold) warnings.push(`AGENDA_${key.toUpperCase()}_DRIFT`);
  });
  if ((core.sourceFlags || []).some((flag) => /capacity:fallback/i.test(String(flag)))) warnings.push("AGENDA_CAPACITY_POLICY_DRIFT");
  const agreementScore = round(1 - clamp01(weightedError));
  return {
    comparableMetrics: metrics.map(([key]) => key),
    deltas,
    relativeErrors,
    agreementScore,
    agreementBand: agreementScore >= 0.90 ? "ALIGNED" : agreementScore >= 0.75 ? "WATCH" : "DRIFT",
    warnings: Array.from(new Set(warnings))
  };
}

function driftContribution(diff = {}) {
  const errors = diff.relativeErrors || {};
  const compared = diff.comparableMetrics || [];
  const totalWeight = compared.reduce((sum, key) => sum + Number(AGENDA_WEIGHTS[key] || 0), 0);
  return compared.reduce((acc, key) => {
    acc[key] = round((Number(AGENDA_WEIGHTS[key] || 0) / Math.max(totalWeight, 1)) * Number(errors[`${key}Error`] || 0));
    return acc;
  }, {});
}

function classifyCauses({ legacy = {}, core = {}, diff = {}, appointments = [], staff = [], resources = [] }) {
  const causes = [];
  const contributions = driftContribution(diff);
  const add = (code, contribution, explanation, sampleRecords = []) => {
    if (Number(contribution || 0) <= 0 && !sampleRecords.length) return;
    causes.push({ code, contribution: round(contribution), explanation, sampleRecords: sampleRecords.slice(0, 2) });
  };
  add(CAUSE.PRESSURE_PROXY_MISMATCH, contributions.pressure, "Legacy usa un proxy da phi agenda, AgendaCore misura picchi slot/capacità.", core.breakdown?.dailyPressure || []);
  add(CAUSE.NEED_POLICY_MISMATCH, contributions.need, "Legacy usa need massimo per appuntamento, AgendaCore usa urgency aggregata da saturazione, pressione, fragilità e no-show.", legacy.sampleRows || []);
  add(CAUSE.BAND_POLICY_MISMATCH, contributions.band, "Le band non hanno stessa semantica: legacy usa stato della decisione, core usa agendaScore.", []);
  add(CAUSE.CAPACITY_POLICY_MISMATCH, contributions.saturation, "Saturazione legacy da counters Gold, saturazione core da minuti/capacità per operatori.", core.breakdown?.dailySaturation || []);
  if ((core.sourceFlags || []).some((flag) => /capacity:fallback/i.test(String(flag)))) {
    add(CAUSE.SCHEDULE_FALLBACK_MISMATCH, 0.12, "AgendaCore ha usato capacità fallback perché working hours/shift non sono completi.", staff.slice(0, 2));
  }
  if ((core.sourceFlags || []).some((flag) => /readiness:schedule_fallback/i.test(String(flag)))) {
    add(CAUSE.SCHEDULE_FALLBACK_MISMATCH, 0.10, "Readiness abbassata per schedule fallback.", staff.slice(0, 2));
  }
  if (Number(core.fragility || 0) > 0.25) add(CAUSE.FRAGILITY_NOT_COMPARABLE, 0.05, "Legacy non espone fragilità appuntamento confrontabile.", core.breakdown?.fragileAppointments || []);
  if (Number(core.noShowRisk || 0) > 0.20) add(CAUSE.NOSHOW_NOT_COMPARABLE, 0.05, "Legacy non espone rischio no-show confrontabile.", core.breakdown?.noShowCandidates || []);
  if (Number(core.slotValue || 0) > 0.60) add(CAUSE.SLOTVALUE_NOT_COMPARABLE, 0.03, "Legacy non espone valore slot confrontabile.", core.breakdown?.slotValuation || []);
  const weakStatuses = appointments.filter((item) => ["requested", "booked", "scheduled"].includes(statusOf(item))).slice(0, 2);
  if (weakStatuses.length) add(CAUSE.STATUS_POLICY_MISMATCH, 0.06, "Status deboli pesano in modo diverso tra decisione agenda legacy e AgendaCore.", weakStatuses);
  if (!resources.length && Number(core.readiness || 0) < 0.8) add(CAUSE.RESOURCE_CLARITY_MISMATCH, 0.05, "Risorse/tecnologie assenti o poco chiare abbassano readiness core.", resources);
  return causes.sort((a, b) => Number(b.contribution || 0) - Number(a.contribution || 0));
}

function dominantDrift(causes = [], contributions = {}) {
  const topCause = causes[0];
  if (topCause) return topCause.code;
  const topMetric = Object.entries(contributions).sort((a, b) => b[1] - a[1])[0];
  return topMetric ? topMetric[0] : "NO_DRIFT";
}

function promoteToCoreAgenda(audit = {}) {
  const agreement = Number(audit.agreementScore || 0);
  const readiness = Number(audit.core?.readiness || 0);
  const hasCapacityMismatch = (audit.causes || []).some((cause) => [CAUSE.CAPACITY_POLICY_MISMATCH, CAUSE.SCHEDULE_FALLBACK_MISMATCH].includes(cause.code) && Number(cause.contribution || 0) >= 0.1);
  if (agreement >= 0.90 && readiness >= 0.75 && !hasCapacityMismatch) return "YES";
  if (agreement >= 0.75 && readiness >= 0.60) return "WATCH";
  return "NO";
}

function chooseTenants(users = []) {
  const gold = users.filter((user) => String(user.subscriptionPlan || user.plan || "").toLowerCase() === "gold");
  const privilege = gold.find((user) => /privilege/i.test(tenantLabel(user))) || gold[0];
  const medium = gold.find((user) => user.id !== privilege?.id && /073|medio|intermedio|clean/i.test([tenantLabel(user), user.username, user.centerId].join(" ")))
    || gold.find((user) => user.id !== privilege?.id);
  const fragile = gold.find((user) => ![privilege?.id, medium?.id].includes(user.id) && /100|fragile|incomplet|sporco/i.test([tenantLabel(user), user.username, user.centerId].join(" ")))
    || gold.find((user) => ![privilege?.id, medium?.id].includes(user.id));
  return [privilege, medium, fragile].filter(Boolean);
}

async function auditTenant(baseUrl, adminToken, tenant) {
  const support = await request(baseUrl, `/api/auth/users/${tenant.id}/support-session`, { method: "POST", token: adminToken, body: {} });
  const token = support.token;
  const [state, appointments, services, staff, resources] = await Promise.all([
    request(baseUrl, "/api/ai-gold/state", { token }),
    request(baseUrl, "/api/appointments?view=all", { token }).catch(() => []),
    request(baseUrl, "/api/catalog/services", { token }).catch(() => []),
    request(baseUrl, "/api/catalog/staff", { token }).catch(() => []),
    request(baseUrl, "/api/catalog/resources", { token }).catch(() => [])
  ]);
  const horizon = state.agendaParallel?.horizon || buildHorizon(appointments);
  const legacy = buildLegacyAgendaSnapshot({ state, appointments, services });
  const coreRaw = state.agendaParallel?.operationalSnapshot || computeAgendaSnapshot({ appointments, services, staff, resources, clients: [], horizon });
  const core = state.agendaParallel?.coreSnapshot || normalizeCoreAgendaSnapshot(coreRaw);
  const diff = state.agendaParallel?.diffSnapshot || compareAgenda(legacy, core);
  const contributions = driftContribution(diff);
  const causes = classifyCauses({ legacy, core, diff, appointments, staff, resources });
  const audit = {
    tenantId: tenant.centerId || tenant.id,
    tenantName: tenantLabel(tenant),
    username: tenant.username || "",
    plan: tenant.subscriptionPlan || tenant.plan || "",
    horizon,
    agendaParallelPresent: Boolean(state.agendaParallel),
    agendaParallelStatus: state.agendaParallel?.status || "reconstructed_read_only",
    legacy: {
      saturation: round(legacy.saturation),
      pressure: round(legacy.pressure),
      need: round(legacy.need),
      band: legacy.band,
      bandProxy: round(legacy.bandProxy)
    },
    core: {
      saturation: round(core.saturation),
      pressure: round(core.pressure),
      need: round(core.need),
      band: core.band,
      bandProxy: round(core.bandProxy),
      fragility: round(core.fragility),
      noShowRisk: round(core.noShowRisk),
      slotValue: round(core.slotValue),
      urgency: round(core.urgency),
      readiness: round(core.readiness),
      agendaScore: round(core.agendaScore)
    },
    deltas: diff.deltas || {},
    relativeErrors: diff.relativeErrors || {},
    comparableMetrics: diff.comparableMetrics || [],
    agreementScore: diff.agreementScore ?? null,
    agreementBand: diff.agreementBand || "N/A",
    warnings: diff.warnings || [],
    contributions,
    sourceFlags: Array.from(new Set([...(legacy.sourceFlags || []), ...(core.sourceFlags || []), ...(diff.sourceFlags || [])])),
    causes,
    dominantDrift: dominantDrift(causes, contributions),
    sampleRecords: causes.flatMap((cause) => cause.sampleRecords || []).slice(0, 8),
    rawCounts: {
      appointments: Array.isArray(appointments) ? appointments.length : 0,
      staff: Array.isArray(staff) ? staff.length : 0,
      services: Array.isArray(services) ? services.length : 0,
      resources: Array.isArray(resources) ? resources.length : 0
    }
  };
  audit.promote_to_core_agenda = promoteToCoreAgenda(audit);
  audit.finalJudgement = audit.promote_to_core_agenda === "YES"
    ? "pronto per adapter/selector controllato"
    : audit.promote_to_core_agenda === "WATCH"
      ? "quasi pronto, serve AgendaPolicyAdapter prima dello switch"
      : "non pronto";
  return audit;
}

function globalRecommendation(audits = []) {
  const strongEnough = audits.filter((audit) => /privilege|073/i.test(audit.tenantName)).every((audit) => Number(audit.agreementScore || 0) >= 0.75);
  const allAligned = audits.every((audit) => Number(audit.agreementScore || 0) >= 0.90 && Number(audit.core?.readiness || 0) >= 0.75);
  const hasPolicyMismatch = audits.some((audit) => (audit.causes || []).some((cause) => [
    CAUSE.CAPACITY_POLICY_MISMATCH,
    CAUSE.PRESSURE_PROXY_MISMATCH,
    CAUSE.NEED_POLICY_MISMATCH,
    CAUSE.BAND_POLICY_MISMATCH
  ].includes(cause.code)));
  if (allAligned && !hasPolicyMismatch) {
    return {
      selected: "FASE_3",
      reason: "Agreement e readiness sono già robusti su tutti i tenant analizzati."
    };
  }
  if (strongEnough && hasPolicyMismatch) {
    return {
      selected: "AGENDA_POLICY_ADAPTER",
      reason: "Il drift è soprattutto policy mismatch: capacity/status/band/pressure proxy vanno normalizzati prima dello switch."
    };
  }
  return {
    selected: "MANTENERE_SHADOW",
    reason: "Agreement o readiness non sono sufficienti per procedere a Fase 3."
  };
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
  const audits = [];
  for (const tenant of tenants) audits.push(await auditTenant(baseUrl, login.token, tenant));
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    commitLive: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || null,
    tenantsAnalyzed: audits.map((audit) => audit.tenantName),
    audits,
    globalCauses: audits.flatMap((audit) => audit.causes.map((cause) => ({
      tenant: audit.tenantName,
      code: cause.code,
      contribution: cause.contribution
    }))),
    recommendation: globalRecommendation(audits),
    confirmations: {
      agendaCorePrimary: false,
      uiChanged: false,
      publicApiChanged: false,
      realDataModified: false,
      appointmentsMovedOrCreated: false,
      readOnly: true
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
  buildLegacyAgendaSnapshot,
  compareAgenda,
  classifyCauses,
  promoteToCoreAgenda,
  globalRecommendation
};
