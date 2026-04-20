const REPORT_HEALTH_BANDS = Object.freeze({
  STRONG: "STRONG",
  STABLE: "STABLE",
  FRAGILE: "FRAGILE",
  CRITICAL: "CRITICAL"
});

const REPORT_READY_WEIGHTS = Object.freeze({
  dataQuality: 0.30,
  cashReady: 0.25,
  profitReady: 0.25,
  periodCoverage: 0.20
});

const ANOMALY_WEIGHTS = Object.freeze({
  magnitude: 0.50,
  volatility: 0.25,
  confidencePenalty: 0.25
});

function clamp01(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function round(value = 0, decimals = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function cents(value = 0) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function positiveCents(value = 0) {
  return Math.max(0, cents(value));
}

function toDateOnly(value = "") {
  return String(value || "").slice(0, 10);
}

function addDays(dateOnly = "", days = 0) {
  const date = new Date(`${toDateOnly(dateOnly)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return toDateOnly(new Date().toISOString());
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return toDateOnly(date.toISOString());
}

function daySpanInclusive(startDate = "", endDate = "") {
  const start = new Date(`${toDateOnly(startDate)}T00:00:00.000Z`).getTime();
  const end = new Date(`${toDateOnly(endDate)}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function normalizeHorizon(horizon = {}) {
  const today = toDateOnly(new Date().toISOString());
  let startDate = toDateOnly(horizon.startDate || horizon.t0 || today);
  let endDate = toDateOnly(horizon.endDate || horizon.t1 || startDate);
  if (startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }
  const days = daySpanInclusive(startDate, endDate);
  const comparableEndDate = addDays(startDate, -1);
  const comparableStartDate = addDays(comparableEndDate, -(days - 1));
  return {
    startDate,
    endDate,
    days,
    comparable: {
      startDate: comparableStartDate,
      endDate: comparableEndDate,
      days
    }
  };
}

function inHorizon(value = "", horizon = {}) {
  const date = toDateOnly(value || "");
  return Boolean(date && date >= horizon.startDate && date <= horizon.endDate);
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function appointmentServiceIds(appointment = {}) {
  if (Array.isArray(appointment.serviceIds) && appointment.serviceIds.length) {
    return appointment.serviceIds.map((id) => String(id || "")).filter(Boolean);
  }
  return appointment.serviceId ? [String(appointment.serviceId)] : [];
}

function appointmentRevenueCents(appointment = {}, servicesById = new Map(), paymentsByAppointment = new Map()) {
  const linkedCash = positiveCents(paymentsByAppointment.get(String(appointment.id || "")) || 0);
  if (linkedCash > 0) return linkedCash;
  if (Number(appointment.priceCents || 0) > 0) return positiveCents(appointment.priceCents);
  const serviceIds = appointmentServiceIds(appointment);
  const serviceTotal = serviceIds.reduce((sum, id) => {
    const service = servicesById.get(String(id)) || {};
    return sum + positiveCents(service.priceCents || service.price || 0);
  }, 0);
  return serviceTotal || positiveCents(appointment.amountCents || 0);
}

function serviceMaterialCostCents(service = {}) {
  return positiveCents(
    service.estimatedProductCostCents
    || service.productCostCents
    || service.materialCostCents
    || service.inventoryCostAverage
    || 0
  );
}

function appointmentCostCents(appointment = {}, servicesById = new Map()) {
  const serviceIds = appointmentServiceIds(appointment);
  if (!serviceIds.length) return positiveCents(appointment.costCents || 0);
  return serviceIds.reduce((sum, id) => {
    const service = servicesById.get(String(id)) || {};
    return sum + serviceMaterialCostCents(service) + positiveCents(service.technologyCostCents || service.laborCostCents || 0);
  }, 0);
}

function groupPaymentsByAppointment(payments = []) {
  const map = new Map();
  (Array.isArray(payments) ? payments : []).forEach((payment) => {
    const appointmentId = String(payment.appointmentId || "");
    if (!appointmentId) return;
    map.set(appointmentId, positiveCents(map.get(appointmentId) || 0) + positiveCents(payment.amountCents || 0));
  });
  return map;
}

function extractDataQualityScore(input = {}) {
  const candidates = [
    input.dataQualitySnapshot?.dataQualityScore,
    input.dataQualitySnapshot?.score,
    input.goldState?.dataQualityPrimarySnapshot?.dataQualityScore,
    input.goldState?.components?.DQ,
    input.legacyReport?.dataQuality?.score
  ];
  const raw = candidates.find((value) => Number.isFinite(Number(value)));
  if (raw === undefined) return null;
  const numeric = Number(raw);
  return numeric > 1 ? clamp01(numeric / 100) : clamp01(numeric);
}

function cashReady(input = {}) {
  const selection = input.goldState?.cashSelection || input.cashSnapshot?.selection || null;
  if (selection && Number.isFinite(Number(selection.reliabilityScore))) return clamp01(selection.reliabilityScore);
  const score = input.cashSnapshot?.confidenceScore ?? input.cashSnapshot?.cashConfidence ?? input.cashSnapshot?.dataCompleteness;
  if (Number.isFinite(Number(score))) return clamp01(score);
  return null;
}

function profitReady(input = {}) {
  const selection = input.goldState?.inventoryCostSelection || null;
  if (selection && Number.isFinite(Number(selection.reliabilityScore))) return clamp01(selection.reliabilityScore);
  const confidence = input.profitabilitySnapshot?.meta?.confidence || input.profitabilitySnapshot?.confidence || "";
  if (confidence === "REAL") return 1;
  if (confidence === "STANDARD") return 0.8;
  if (confidence === "ESTIMATED") return 0.5;
  if (confidence === "INCOMPLETE") return 0.2;
  const economic = input.goldState?.snapshots?.profitability?.economicConfidence;
  if (Number.isFinite(Number(economic))) return clamp01(economic);
  return null;
}

function computePeriodCoverage({ appointments = [], payments = [], horizon = {} } = {}) {
  const days = Math.max(1, Number(horizon.days || 1));
  const activeDays = new Set([
    ...(appointments || []).map((item) => toDateOnly(item.startAt || item.createdAt)).filter(Boolean),
    ...(payments || []).map((item) => toDateOnly(item.createdAt)).filter(Boolean)
  ]);
  return clamp01(activeDays.size / days);
}

function computeReportReadiness(input = {}, periodContext = {}) {
  const flags = [];
  const dq = extractDataQualityScore(input);
  const cash = cashReady(input);
  const profit = profitReady(input);
  const coverage = computePeriodCoverage(periodContext);
  const values = {
    dataQuality: dq,
    cashReady: cash,
    profitReady: profit,
    periodCoverage: coverage
  };
  Object.entries(values).forEach(([key, value]) => {
    if (!Number.isFinite(Number(value))) flags.push(`report_readiness:${key}_missing`);
  });
  const available = Object.entries(values).filter(([, value]) => Number.isFinite(Number(value)));
  const weightTotal = available.reduce((sum, [key]) => sum + REPORT_READY_WEIGHTS[key], 0) || 1;
  const readiness = available.reduce((sum, [key, value]) => sum + ((REPORT_READY_WEIGHTS[key] / weightTotal) * clamp01(value)), 0);
  return {
    readiness: round(readiness),
    factors: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number.isFinite(Number(value)) ? round(value) : null])),
    sourceFlags: flags
  };
}

function computePeriodKPIs(input = {}, horizon = {}) {
  const sourceFlags = [];
  const appointmentsAll = Array.isArray(input.appointments) ? input.appointments : [];
  const paymentsAll = Array.isArray(input.payments) ? input.payments : [];
  const clientsAll = Array.isArray(input.clients) ? input.clients : [];
  const services = Array.isArray(input.services) ? input.services : [];
  const staff = Array.isArray(input.staff) ? input.staff : [];
  const servicesById = mapById(services);
  const appointments = appointmentsAll.filter((item) => inHorizon(item.startAt || item.createdAt, horizon));
  const payments = paymentsAll.filter((item) => inHorizon(item.createdAt, horizon));
  const paymentsByAppointment = groupPaymentsByAppointment(payments);
  const relevantAppointments = appointments.filter((item) => !["cancelled", "deleted"].includes(String(item.status || "").toLowerCase()));
  const completedAppointments = appointments.filter((item) => String(item.status || "").toLowerCase() === "completed");
  const noShowAppointments = appointments.filter((item) => String(item.status || "").toLowerCase() === "no_show");
  const revenue = relevantAppointments.reduce((sum, appointment) => sum + appointmentRevenueCents(appointment, servicesById, paymentsByAppointment), 0);
  const cash = payments.reduce((sum, payment) => sum + positiveCents(payment.amountCents || 0), 0);
  const cost = completedAppointments.reduce((sum, appointment) => sum + appointmentCostCents(appointment, servicesById), 0);
  const profit = Math.max(0, revenue - cost);
  const margin = revenue > 0 ? profit / revenue : 0;
  const activeClients = new Set(relevantAppointments.map((item) => String(item.clientId || "")).filter(Boolean)).size;
  const operators = staff.filter((item) => item.active !== false && item.active !== 0).length || staff.length || 1;
  const capacity = Math.max(1, operators * 8 * Math.max(1, horizon.days || 1));
  const saturation = clamp01(relevantAppointments.length / capacity);
  const noShowRate = appointments.length ? noShowAppointments.length / appointments.length : 0;
  const productivity = clamp01(completedAppointments.length / capacity);
  const readiness = computeReportReadiness(input, { appointments, payments, horizon });
  if (!services.length) sourceFlags.push("report_core:services_missing_or_empty");
  if (!staff.length) sourceFlags.push("report_core:staff_missing_or_empty");
  if (!clientsAll.length) sourceFlags.push("report_core:clients_missing_or_empty");
  if (!payments.length) sourceFlags.push("report_core:payments_empty_in_period");
  if (!appointments.length) sourceFlags.push("report_core:appointments_empty_in_period");
  return {
    counts: {
      appointments: appointments.length,
      payments: payments.length,
      clients: clientsAll.length,
      services: services.length,
      operators
    },
    kpis: {
      revenue,
      cash,
      gap: Math.abs(revenue - cash),
      margin: round(margin),
      ticket: Math.round(revenue / Math.max(1, relevantAppointments.length)),
      appointments: relevantAppointments.length,
      activeClients,
      saturation: round(saturation),
      dataQuality: extractDataQualityScore(input),
      noShowRate: round(noShowRate),
      productivity: round(productivity),
      readiness: readiness.readiness
    },
    readinessFactors: readiness.factors,
    sourceFlags: [...sourceFlags, ...readiness.sourceFlags]
  };
}

function computeReportKPIs(input = {}, horizon = {}) {
  return computePeriodKPIs(input, normalizeHorizon(horizon));
}

function deltaForKpi(current = 0, previous = 0, relative = true) {
  const delta = Number(current || 0) - Number(previous || 0);
  return {
    current,
    previous,
    delta: Number.isInteger(delta) ? delta : round(delta),
    deltaRelative: relative ? round(delta / Math.max(1, Math.abs(Number(previous || 0)))) : null
  };
}

function computeReportDeltas(currentKpis = {}, previousKpis = {}) {
  const absoluteKeys = ["revenue", "cash", "gap", "ticket", "appointments", "activeClients"];
  const scoreKeys = ["margin", "saturation", "dataQuality", "noShowRate", "productivity", "readiness"];
  const out = {};
  absoluteKeys.forEach((key) => {
    out[key] = deltaForKpi(currentKpis[key] || 0, previousKpis[key] || 0, true);
  });
  scoreKeys.forEach((key) => {
    out[key] = deltaForKpi(currentKpis[key] || 0, previousKpis[key] || 0, false);
  });
  return out;
}

function anomalyReasonCodes(key = "", delta = {}, readiness = 1) {
  const codes = [];
  if (Math.abs(Number(delta.deltaRelative || delta.delta || 0)) >= 0.3) codes.push("LARGE_DELTA");
  if (["cash", "gap", "revenue", "margin"].includes(key)) codes.push("ECONOMIC_KPI");
  if (["appointments", "activeClients", "noShowRate", "productivity"].includes(key)) codes.push("OPERATIONAL_KPI");
  if (readiness < 0.6) codes.push("LOW_REPORT_CONFIDENCE");
  if (Number(delta.delta || 0) < 0 && ["revenue", "cash", "margin", "appointments", "activeClients"].includes(key)) codes.push("NEGATIVE_DIRECTION");
  if (key === "gap" && Number(delta.current || 0) > 0) codes.push("ECONOMIC_GAP_PRESENT");
  if (key === "noShowRate" && Number(delta.current || 0) > Number(delta.previous || 0)) codes.push("NOSHOW_INCREASE");
  return codes;
}

function computeReportAnomalies(deltas = {}, currentKpis = {}) {
  const readiness = Number(currentKpis.readiness ?? 1);
  return Object.entries(deltas)
    .map(([key, delta]) => {
      const magnitudeBase = delta.deltaRelative === null
        ? Math.abs(Number(delta.delta || 0))
        : Math.abs(Number(delta.deltaRelative || 0));
      const magnitude = clamp01(magnitudeBase);
      const volatility = clamp01(Math.abs(Number(delta.current || 0) - Number(delta.previous || 0)) / Math.max(1, Math.abs(Number(delta.current || 0)) + Math.abs(Number(delta.previous || 0))));
      const confidencePenalty = clamp01(1 - readiness);
      const score = clamp01(
        (ANOMALY_WEIGHTS.magnitude * magnitude)
        + (ANOMALY_WEIGHTS.volatility * volatility)
        + (ANOMALY_WEIGHTS.confidencePenalty * confidencePenalty)
      );
      return {
        key,
        score: round(score),
        magnitude: round(magnitude),
        volatility: round(volatility),
        confidencePenalty: round(confidencePenalty),
        reasonCodes: anomalyReasonCodes(key, delta, readiness)
      };
    })
    .filter((item) => item.score > 0.08 || item.reasonCodes.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function inferReportHealthBand(kpis = {}, anomalies = []) {
  const readiness = Number(kpis.readiness || 0);
  const dataQuality = Number(kpis.dataQuality ?? readiness);
  const margin = Number(kpis.margin || 0);
  const gapRatio = Number(kpis.revenue || 0) > 0 ? Number(kpis.gap || 0) / Number(kpis.revenue || 1) : Number(kpis.gap || 0) > 0 ? 1 : 0;
  const negativeAnomaly = (anomalies || []).find((item) => (item.reasonCodes || []).some((code) => [
    "NEGATIVE_DIRECTION",
    "ECONOMIC_GAP_PRESENT",
    "NOSHOW_INCREASE",
    "LOW_REPORT_CONFIDENCE"
  ].includes(code)));
  const topRiskAnomaly = Number(negativeAnomaly?.score || 0);
  const topAnomaly = Number(anomalies[0]?.score || 0);
  if (readiness < 0.4 || dataQuality < 0.4 || gapRatio > 0.5 || topRiskAnomaly >= 0.75) return REPORT_HEALTH_BANDS.CRITICAL;
  if (readiness < 0.6 || margin < 0.25 || gapRatio > 0.25 || topRiskAnomaly >= 0.5) return REPORT_HEALTH_BANDS.FRAGILE;
  if (readiness >= 0.75 && margin >= 0.35 && gapRatio <= 0.1 && topAnomaly < 0.35) return REPORT_HEALTH_BANDS.STRONG;
  return REPORT_HEALTH_BANDS.STABLE;
}

function signalRows(kpis = {}, deltas = {}, anomalies = []) {
  const strongestSignals = [];
  const weakestSignals = [];
  if (Number(kpis.cash || 0) >= Number(kpis.revenue || 0) * 0.9) strongestSignals.push("cash_aligned");
  if (Number(kpis.margin || 0) >= 0.35) strongestSignals.push("margin_healthy");
  if (Number(kpis.readiness || 0) >= 0.75) strongestSignals.push("report_ready");
  if (Number(kpis.noShowRate || 0) <= 0.05) strongestSignals.push("noshow_low");
  if (Number(kpis.gap || 0) > 0) weakestSignals.push("revenue_cash_gap");
  if (Number(kpis.margin || 0) < 0.25) weakestSignals.push("margin_weak");
  if (Number(kpis.readiness || 0) < 0.6) weakestSignals.push("report_readiness_low");
  if ((anomalies || []).length) weakestSignals.push(`top_anomaly:${anomalies[0].key}`);
  if (Number(deltas.revenue?.delta || 0) < 0) weakestSignals.push("revenue_down_vs_previous");
  return {
    strongestSignals: strongestSignals.slice(0, 5),
    weakestSignals: weakestSignals.slice(0, 5)
  };
}

function computeReportSnapshot(input = {}, horizonInput = {}) {
  const horizon = normalizeHorizon(horizonInput);
  const current = computePeriodKPIs(input, horizon);
  const previous = computePeriodKPIs(input, horizon.comparable);
  const deltas = computeReportDeltas(current.kpis, previous.kpis);
  const anomalies = computeReportAnomalies(deltas, current.kpis);
  const healthBand = inferReportHealthBand(current.kpis, anomalies);
  const signals = signalRows(current.kpis, deltas, anomalies);
  return {
    mathCore: "report_core_v1",
    horizon: {
      startDate: horizon.startDate,
      endDate: horizon.endDate,
      days: horizon.days
    },
    comparableHorizon: horizon.comparable,
    counts: current.counts,
    kpis: current.kpis,
    deltas,
    anomalies,
    summary: {
      healthBand,
      strongestSignals: signals.strongestSignals,
      weakestSignals: signals.weakestSignals,
      topAnomalies: anomalies.slice(0, 3),
      executiveReadiness: current.kpis.readiness
    },
    sourceFlags: Array.from(new Set([
      "report_core:read_only",
      "report_core:no_export",
      ...current.sourceFlags,
      ...previous.sourceFlags.map((flag) => `previous:${flag}`)
    ]))
  };
}

module.exports = {
  REPORT_HEALTH_BANDS,
  REPORT_READY_WEIGHTS,
  ANOMALY_WEIGHTS,
  computeReportKPIs,
  computeReportDeltas,
  computeReportAnomalies,
  computeReportReadiness,
  inferReportHealthBand,
  computeReportSnapshot
};
