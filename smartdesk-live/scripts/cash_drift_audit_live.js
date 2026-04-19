#!/usr/bin/env node
"use strict";

const { computeCashSnapshot } = require("../src/core/cash/CashCore");

const DEFAULT_BASE_URL = "https://skinharmony-smartdesk-live.onrender.com";
const TENANT_IDS = [
  "user_1775827990203_40042068", // Privilege Parrucchieri
  "user_1776508518533_0aef1be8", // Gold Test Centro 073
  "user_1776508536680_185725ff" // fragile / incomplete control
];

function toDateOnly(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function cents(value) {
  return Math.round(Number(value || 0));
}

function positive(value) {
  return Math.max(0, cents(value));
}

function ratioDelta(coreValue, legacyValue) {
  const core = Number(coreValue || 0);
  const legacy = Number(legacyValue || 0);
  return Math.min(1, Math.abs(core - legacy) / Math.max(1, Math.max(Math.abs(core), Math.abs(legacy))));
}

function serviceIdsForAppointment(appointment = {}) {
  const ids = Array.isArray(appointment.serviceIds) ? appointment.serviceIds : (appointment.serviceId ? [appointment.serviceId] : []);
  return ids.map((id) => String(id || "")).filter(Boolean);
}

function statusOf(appointment = {}) {
  return String(appointment.status || "").toLowerCase();
}

function appointmentAmount(appointment = {}, servicesById = new Map()) {
  const explicit = positive(appointment.dueCents || appointment.amountCents || appointment.priceCents || 0);
  if (explicit > 0) return explicit;
  return serviceIdsForAppointment(appointment).reduce((sum, id) => sum + positive(servicesById.get(String(id))?.priceCents || 0), 0);
}

function legacyAppointmentAmount(appointment = {}, servicesById = new Map()) {
  const service = servicesById.get(String(appointment.serviceId || ""));
  return positive(appointment.amountCents || appointment.priceCents || service?.priceCents || 0);
}

function legacyPaymentIsUnlinked(payment = {}) {
  if (["free", "ignored"].includes(String(payment.reconciliationStatus || "").toLowerCase())) return false;
  return !payment.appointmentId || !payment.clientId;
}

function buildHorizon(appointments = [], payments = []) {
  const dates = [
    ...appointments.map((item) => toDateOnly(item.startAt || item.createdAt || item.dueAt || "")),
    ...payments.map((item) => toDateOnly(item.createdAt || item.paidAt || ""))
  ].filter(Boolean).sort();
  return {
    startDate: dates[0] || "",
    endDate: dates[dates.length - 1] || "",
    mode: dates.length ? "all_observed_data" : "empty"
  };
}

function inHorizon(value, horizon = {}) {
  const date = toDateOnly(value || "");
  if (!date) return false;
  if (horizon.startDate && date < horizon.startDate) return false;
  if (horizon.endDate && date > horizon.endDate) return false;
  return true;
}

function buildLegacySnapshot(appointments = [], payments = [], services = [], horizon = {}) {
  const servicesById = new Map(services.map((item) => [String(item.id || ""), item]));
  const periodPayments = payments.filter((payment) => inHorizon(payment.createdAt || payment.paidAt, horizon));
  const periodAppointments = appointments.filter((appointment) => inHorizon(appointment.startAt || appointment.createdAt || appointment.dueAt, horizon));
  const recordedCashCents = periodPayments.reduce((sum, payment) => sum + positive(payment.amountCents || 0), 0);
  const unlinked = periodPayments.filter(legacyPaymentIsUnlinked);
  const billedDueCents = periodAppointments
    .filter((appointment) => ["completed", "ready_checkout"].includes(statusOf(appointment)))
    .reduce((sum, appointment) => sum + legacyAppointmentAmount(appointment, servicesById), 0);
  return {
    billedDueCents,
    reconciledCashCents: recordedCashCents,
    recordedCashCents,
    unlinkedCashCents: unlinked.reduce((sum, payment) => sum + positive(payment.amountCents), 0),
    ambiguousCashCents: 0,
    overdueCents: 0,
    openResidualCents: Math.max(0, billedDueCents - recordedCashCents),
    gapCents: billedDueCents - recordedCashCents,
    collectionRatio: billedDueCents > 0 ? recordedCashCents / billedDueCents : 0,
    reconciliationRatio: recordedCashCents > 0 ? (recordedCashCents - unlinked.reduce((sum, payment) => sum + positive(payment.amountCents), 0)) / recordedCashCents : 0,
    ambiguityRatio: recordedCashCents > 0 ? unlinked.reduce((sum, payment) => sum + positive(payment.amountCents), 0) / recordedCashCents : 0,
    overdueRatio: 0,
    unlinkedPaymentIds: unlinked.map((item) => String(item.id || ""))
  };
}

function decomposeBilledDue(appointments = [], services = [], horizon = {}) {
  const servicesById = new Map(services.map((item) => [String(item.id || ""), item]));
  const rows = appointments.filter((appointment) => inHorizon(appointment.startAt || appointment.createdAt || appointment.dueAt, horizon));
  const completedStatuses = new Set(["completed", "ready_checkout"]);
  const cancelledStatuses = new Set(["cancelled", "no_show", "deleted"]);
  const statusRows = [];
  const serviceShapeRows = [];
  let statusDelta = 0;
  let serviceShapeDelta = 0;
  let duePolicyDelta = 0;
  let cancelPolicyDelta = 0;
  rows.forEach((appointment) => {
    const status = statusOf(appointment);
    const coreDue = cancelledStatuses.has(status) ? 0 : appointmentAmount(appointment, servicesById);
    const legacyDue = completedStatuses.has(status) ? legacyAppointmentAmount(appointment, servicesById) : 0;
    const singleLegacyAmountIfIncluded = completedStatuses.has(status) ? legacyAppointmentAmount(appointment, servicesById) : 0;
    const serviceIds = serviceIdsForAppointment(appointment);
    if (!completedStatuses.has(status) && !cancelledStatuses.has(status) && coreDue > 0) {
      statusDelta += coreDue;
      statusRows.push({
        id: appointment.id,
        status,
        clientId: appointment.clientId || "",
        startAt: appointment.startAt || "",
        coreDueCents: coreDue,
        legacyDueCents: legacyDue,
        reason: "core_includes_open_non_cancelled_appointment"
      });
    }
    if (completedStatuses.has(status) && serviceIds.length > 1) {
      const explicit = positive(appointment.dueCents || appointment.amountCents || appointment.priceCents || 0);
      const serviceIdsTotal = serviceIds.reduce((sum, id) => sum + positive(servicesById.get(String(id))?.priceCents || 0), 0);
      if (!explicit && serviceIdsTotal !== singleLegacyAmountIfIncluded) {
        serviceShapeDelta += serviceIdsTotal - singleLegacyAmountIfIncluded;
        serviceShapeRows.push({
          id: appointment.id,
          status,
          serviceId: appointment.serviceId || "",
          serviceIds,
          legacyDueCents: singleLegacyAmountIfIncluded,
          coreDueCents: serviceIdsTotal,
          reason: "serviceIds_multiple_vs_legacy_single_serviceId"
        });
      }
    }
    if (completedStatuses.has(status) && coreDue !== legacyDue) duePolicyDelta += coreDue - legacyDue;
    if (cancelledStatuses.has(status) && legacyDue !== coreDue) cancelPolicyDelta += coreDue - legacyDue;
  });
  return {
    deltaParts: {
      statusDeltaCents: statusDelta,
      serviceShapeDeltaCents: serviceShapeDelta,
      duePolicyDeltaCents: duePolicyDelta,
      cancelPolicyDeltaCents: cancelPolicyDelta
    },
    sampleRows: {
      statusRows: statusRows.slice(0, 8),
      serviceShapeRows: serviceShapeRows.slice(0, 8)
    },
    counts: {
      statusRows: statusRows.length,
      serviceShapeRows: serviceShapeRows.length
    }
  };
}

function decomposeUnlinked(payments = [], coreSnapshot = {}) {
  const legacyUnlinked = payments.filter(legacyPaymentIsUnlinked);
  const coreUnlinkedIds = new Set((coreSnapshot.paymentBreakdown || [])
    .filter((item) => ["UNLINKED", "AMBIGUOUS", "PARTIALLY_MATCHED"].includes(String(item.status || "")))
    .map((item) => String(item.id || "")));
  const legacyIds = new Set(legacyUnlinked.map((item) => String(item.id || "")));
  const legacyOnly = legacyUnlinked.filter((item) => !coreUnlinkedIds.has(String(item.id || "")));
  const coreOnly = (coreSnapshot.paymentBreakdown || []).filter((item) => coreUnlinkedIds.has(String(item.id || "")) && !legacyIds.has(String(item.id || "")));
  return {
    legacyOnlyCents: legacyOnly.reduce((sum, item) => sum + positive(item.amountCents), 0),
    coreOnlyCents: coreOnly.reduce((sum, item) => sum + positive(item.unallocatedCents || item.amountCents), 0),
    sampleRows: {
      legacyOnly: legacyOnly.slice(0, 8).map((item) => ({ id: item.id, amountCents: item.amountCents, clientId: item.clientId || "", appointmentId: item.appointmentId || "", reason: "legacy_requires_both_client_and_appointment" })),
      coreOnly: coreOnly.slice(0, 8).map((item) => ({ id: item.id, amountCents: item.amountCents, unallocatedCents: item.unallocatedCents, status: item.status, reason: "core_match_policy_unallocated_or_ambiguous" }))
    },
    counts: {
      legacyOnly: legacyOnly.length,
      coreOnly: coreOnly.length
    }
  };
}

function classifyCauses(delta, decompB, decompU, core = {}, legacy = {}) {
  const causes = [];
  if (decompB.deltaParts.statusDeltaCents > 0) causes.push("STATUS_POLICY_MISMATCH");
  if (decompB.deltaParts.statusDeltaCents > 0) causes.push("LEGACY_UNDERCOUNTS_DUE");
  if (decompB.deltaParts.serviceShapeDeltaCents !== 0) causes.push("SERVICE_COMPOSITION_MISMATCH");
  if (Math.abs(Number(delta.overdueDeltaCents || 0)) > 0) causes.push("LEGACY_UNDERCOUNTS_OVERDUE");
  if (Math.abs(Number(delta.unlinkedDeltaCents || 0)) > 0) causes.push("CORE_POLICY_DIFFERENT");
  if (decompU.counts.legacyOnly || decompU.counts.coreOnly) causes.push("DATA_SHAPE_MISMATCH");
  if (Number(core.reconciledCashCents || 0) < Number(legacy.reconciledCashCents || 0)) causes.push("LEGACY_OVERCOUNTS_MATCHED");
  if (Number(core.ambiguousCashCents || 0) > 0) causes.push("CORE_TOO_STRICT");
  return Array.from(new Set(causes));
}

function buildAudit({ tenant, state, appointments, payments, services }) {
  const horizon = buildHorizon(appointments, payments);
  const legacy = buildLegacySnapshot(appointments, payments, services, horizon);
  const core = computeCashSnapshot({
    appointments,
    payments,
    services,
    period: horizon.startDate && horizon.endDate ? { startDate: horizon.startDate, endDate: horizon.endDate } : {},
    options: { today: state.updatedAt || new Date().toISOString() }
  });
  const coreU = positive(core.unlinkedCashCents) + positive(core.ambiguousCashCents);
  const legacyU = positive(legacy.unlinkedCashCents) + positive(legacy.ambiguousCashCents);
  const deltas = {
    billedDueDeltaCents: positive(core.billedDueCents) - positive(legacy.billedDueCents),
    reconciledCashDeltaCents: positive(core.reconciledCashCents) - positive(legacy.reconciledCashCents),
    unlinkedDeltaCents: coreU - legacyU,
    gapDeltaCents: cents(core.gapCents) - cents(legacy.gapCents),
    overdueDeltaCents: positive(core.overdueCents) - positive(legacy.overdueCents)
  };
  const relativeErrors = {
    billedDueError: ratioDelta(core.billedDueCents, legacy.billedDueCents),
    reconciledCashError: ratioDelta(core.reconciledCashCents, legacy.reconciledCashCents),
    unlinkedError: ratioDelta(coreU, legacyU),
    gapError: ratioDelta(core.gapCents, legacy.gapCents),
    overdueError: ratioDelta(core.overdueCents, legacy.overdueCents)
  };
  const billedDueDecomposition = decomposeBilledDue(appointments, services, horizon);
  const unlinkedDecomposition = decomposeUnlinked(payments, core);
  const rootCauses = classifyCauses(deltas, billedDueDecomposition, unlinkedDecomposition, core, legacy);
  const dominantCause = rootCauses[0] || "NO_DRIFT";
  return {
    tenantId: tenant.centerId,
    tenantName: tenant.centerName,
    username: tenant.username,
    horizon,
    legacy: {
      billedDueCents: legacy.billedDueCents,
      reconciledCashCents: legacy.reconciledCashCents,
      recordedCashCents: legacy.recordedCashCents,
      unlinkedCashCents: legacy.unlinkedCashCents,
      ambiguousCashCents: legacy.ambiguousCashCents,
      overdueCents: legacy.overdueCents,
      openResidualCents: legacy.openResidualCents,
      gapCents: legacy.gapCents
    },
    core: {
      billedDueCents: core.billedDueCents,
      reconciledCashCents: core.reconciledCashCents,
      recordedCashCents: core.recordedCashCents,
      unlinkedCashCents: core.unlinkedCashCents,
      ambiguousCashCents: core.ambiguousCashCents,
      overdueCents: core.overdueCents,
      openResidualCents: core.openResidualCents,
      gapCents: core.gapCents,
      confidence: core.confidence,
      confidenceScore: core.confidenceScore
    },
    deltas,
    relativeErrors,
    rootCauses,
    dominantCause,
    decomposition: {
      billedDue: billedDueDecomposition,
      gap: {
        statusDeltaCents: billedDueDecomposition.deltaParts.statusDeltaCents,
        duePolicyDeltaCents: billedDueDecomposition.deltaParts.duePolicyDeltaCents,
        partialPolicyDeltaCents: deltas.reconciledCashDeltaCents * -1,
        otherDeltaCents: deltas.gapDeltaCents - billedDueDecomposition.deltaParts.statusDeltaCents - billedDueDecomposition.deltaParts.duePolicyDeltaCents + deltas.reconciledCashDeltaCents
      },
      overdue: {
        dueDatePolicyDeltaCents: core.overdueCents,
        statusPolicyDeltaCents: billedDueDecomposition.deltaParts.statusDeltaCents,
        residualPolicyDeltaCents: core.openResidualCents,
        otherDeltaCents: deltas.overdueDeltaCents - positive(core.overdueCents)
      },
      unlinked: unlinkedDecomposition
    },
    sampleRecords: [
      ...billedDueDecomposition.sampleRows.statusRows,
      ...billedDueDecomposition.sampleRows.serviceShapeRows,
      ...unlinkedDecomposition.sampleRows.legacyOnly,
      ...unlinkedDecomposition.sampleRows.coreOnly
    ].slice(0, 12),
    recommendedAlignment: rootCauses.includes("STATUS_POLICY_MISMATCH")
      ? "introdurre normalizzazione intermedia: usare policy status cash condivisa tra legacy e core prima dello switch"
      : rootCauses.includes("SERVICE_COMPOSITION_MISMATCH")
        ? "introdurre mapping separato per serviceIds multipli"
        : "mantenere fallback finche dati cash non maturano",
    recommendedThresholdImpact: {
      currentSelector: state.cashSelection || null,
      expectedAfterAlignment: "agreementScore dovrebbe salire solo se legacy e core condividono status policy, overdue policy e service shape"
    }
  };
}

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
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  const baseUrl = process.env.SMARTDESK_LIVE_URL || DEFAULT_BASE_URL;
  const username = process.env.SMARTDESK_ADMIN_USER;
  const password = process.env.SMARTDESK_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("Set SMARTDESK_ADMIN_USER and SMARTDESK_ADMIN_PASSWORD");
  }
  const login = await request(baseUrl, "/api/auth/login", { method: "POST", body: { username, password } });
  const adminToken = login.token;
  const users = await request(baseUrl, "/api/auth/users", { token: adminToken });
  const audits = [];
  for (const tenantId of TENANT_IDS) {
    const tenant = users.find((item) => String(item.id || "") === tenantId);
    if (!tenant) continue;
    const support = await request(baseUrl, `/api/auth/users/${tenantId}/support-session`, { method: "POST", token: adminToken, body: {} });
    const token = support.token;
    const [state, appointments, payments, services] = await Promise.all([
      request(baseUrl, "/api/ai-gold/state", { token }),
      request(baseUrl, "/api/appointments?view=all", { token }),
      request(baseUrl, "/api/payments", { token }),
      request(baseUrl, "/api/catalog/services", { token })
    ]);
    audits.push(buildAudit({ tenant, state, appointments, payments, services }));
  }
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), audits }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  buildAudit,
  buildLegacySnapshot,
  decomposeBilledDue,
  decomposeUnlinked
};
