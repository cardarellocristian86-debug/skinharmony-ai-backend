"use strict";

const CORE_VERSION = "operator_productivity_core_v1";

const DEFAULT_WEIGHTS = Object.freeze({
  efficiency: Object.freeze({
    completionRate: 0.35,
    punctualityProxy: 0.20,
    serviceDensity: 0.25,
    loadBalance: 0.20
  }),
  readiness: Object.freeze({
    operatorLinkQuality: 0.30,
    scheduleCoverage: 0.25,
    appointmentCoverage: 0.25,
    costAvailability: 0.20
  }),
  productivity: Object.freeze({
    revenue: 0.20,
    saturation: 0.20,
    efficiency: 0.25,
    yield: 0.20,
    readiness: 0.15
  })
});

const PRODUCTIVITY_BANDS = Object.freeze({
  STRONG: 0.80,
  STABLE: 0.60,
  FRAGILE: 0.40
});

const DEFAULTS = Object.freeze({
  fallbackDailyCapacityMinutes: 8 * 60,
  fallbackAppointmentMinutes: 60,
  neutralPunctualityProxy: 0.70,
  appointmentDensityTargetPerHour: 2
});

const RELEVANT_LOAD_EXCLUDED_STATUSES = new Set(["cancelled", "deleted"]);
const COMPLETED_STATUSES = new Set(["completed", "done", "paid", "closed"]);

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function round(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function roundCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number);
}

function toDateOnly(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function normalizeHorizon(horizon = {}) {
  const today = toDateOnly(new Date().toISOString());
  let startDate = toDateOnly(horizon.startDate || horizon.start || horizon.from || today);
  let endDate = toDateOnly(horizon.endDate || horizon.end || horizon.to || startDate);
  if (startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }
  return { startDate, endDate };
}

function isInHorizon(value, horizon) {
  const date = toDateOnly(value || "");
  return Boolean(date && date >= horizon.startDate && date <= horizon.endDate);
}

function daysInHorizon(horizon) {
  const start = new Date(`${horizon.startDate}T00:00:00.000Z`);
  const end = new Date(`${horizon.endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function minutesFromTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function durationBetweenTimes(startTime, endTime) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start == null || end == null || end <= start) return 0;
  return end - start;
}

function parseDurationMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number;
}

function mapById(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const id = String(item?.id || "");
    if (id) map.set(id, item);
  });
  return map;
}

function getOperatorId(appointment = {}) {
  return String(appointment.staffId || appointment.operatorId || "");
}

function getAppointmentDate(appointment = {}) {
  return appointment.startAt || appointment.date || appointment.createdAt || "";
}

function getAppointmentServiceIds(appointment = {}) {
  const ids = [];
  if (appointment.serviceId) ids.push(String(appointment.serviceId));
  if (Array.isArray(appointment.serviceIds)) {
    appointment.serviceIds.forEach((id) => {
      if (id) ids.push(String(id));
    });
  }
  return Array.from(new Set(ids));
}

function getAppointmentDurationMinutes(appointment = {}, serviceById = new Map(), defaults = DEFAULTS) {
  const direct = parseDurationMinutes(appointment.durationMinutes || appointment.duration || appointment.minutes);
  if (direct > 0) return direct;
  const serviceMinutes = getAppointmentServiceIds(appointment)
    .map((id) => serviceById.get(id))
    .reduce((sum, service) => sum + parseDurationMinutes(service?.durationMinutes || service?.duration || service?.minutes), 0);
  return serviceMinutes > 0 ? serviceMinutes : defaults.fallbackAppointmentMinutes;
}

function buildPaymentsByAppointment(payments = [], horizon) {
  const map = new Map();
  payments
    .filter((payment) => isInHorizon(payment.createdAt || payment.date || payment.paidAt, horizon))
    .forEach((payment) => {
      const appointmentId = String(payment.appointmentId || "");
      if (!appointmentId) return;
      const amount = Number(payment.amountCents || payment.totalCents || payment.valueCents || 0);
      map.set(appointmentId, (map.get(appointmentId) || 0) + (Number.isFinite(amount) ? amount : 0));
    });
  return map;
}

function computeOperatorRevenue(appointments = [], payments = [], services = [], horizonInput = {}) {
  const horizon = normalizeHorizon(horizonInput);
  const serviceById = mapById(services);
  const paymentsByAppointment = buildPaymentsByAppointment(payments, horizon);
  const sourceFlags = [];
  const rows = new Map();

  appointments
    .filter((appointment) => isInHorizon(getAppointmentDate(appointment), horizon))
    .forEach((appointment) => {
      const operatorId = getOperatorId(appointment) || "unassigned";
      const appointmentId = String(appointment.id || "");
      const linkedCash = paymentsByAppointment.get(appointmentId);
      let revenue = Number.isFinite(Number(linkedCash)) && Number(linkedCash) > 0 ? Number(linkedCash) : 0;
      if (revenue <= 0) {
        revenue = Number(appointment.priceCents || appointment.amountCents || appointment.totalCents || 0);
      }
      if (!Number.isFinite(revenue) || revenue <= 0) {
        revenue = getAppointmentServiceIds(appointment)
          .map((id) => serviceById.get(id))
          .reduce((sum, service) => sum + Number(service?.priceCents || service?.amountCents || 0), 0);
      }
      if (!paymentsByAppointment.has(appointmentId)) sourceFlags.push("revenue:service_or_appointment_proxy");
      const row = rows.get(operatorId) || {
        operatorId,
        revenueCents: 0,
        cashCents: 0,
        linkedCashAppointments: 0
      };
      row.revenueCents += Number.isFinite(revenue) ? revenue : 0;
      if (paymentsByAppointment.has(appointmentId)) {
        row.cashCents += Number(linkedCash || 0);
        row.linkedCashAppointments += 1;
      }
      rows.set(operatorId, row);
    });

  return {
    byOperator: rows,
    sourceFlags: Array.from(new Set(sourceFlags))
  };
}

function computeOperatorCapacity(operator = {}, shifts = [], horizonInput = {}, options = {}) {
  const horizon = normalizeHorizon(horizonInput);
  const defaults = { ...DEFAULTS, ...(options.defaults || {}) };
  const operatorId = String(operator.id || operator.staffId || operator.operatorId || "");
  const operatorName = String(operator.name || operator.staffName || "");
  const sourceFlags = [];
  const matchingShifts = shifts.filter((shift) => {
    const shiftStaffId = String(shift.staffId || shift.operatorId || "");
    const shiftStaffName = String(shift.staffName || "");
    const sameOperator = shiftStaffId ? shiftStaffId === operatorId : operatorName && shiftStaffName === operatorName;
    return sameOperator && isInHorizon(shift.date || shift.startAt || shift.createdAt, horizon);
  });
  const shiftMinutes = matchingShifts.reduce((sum, shift) => {
    if (shift.startAt && shift.endAt) {
      const start = new Date(shift.startAt);
      const end = new Date(shift.endAt);
      const delta = end.getTime() - start.getTime();
      if (Number.isFinite(delta) && delta > 0) return sum + Math.round(delta / 60000);
    }
    return sum + durationBetweenTimes(
      shift.rectifiedStartTime || shift.originalStartTime || shift.startTime,
      shift.rectifiedEndTime || shift.originalEndTime || shift.endTime
    );
  }, 0);
  if (shiftMinutes > 0) {
    sourceFlags.push("capacity:from_shifts");
    return {
      capacityMinutes: shiftMinutes,
      hours: shiftMinutes / 60,
      scheduled: true,
      shiftCount: matchingShifts.length,
      sourceFlags
    };
  }
  const fallbackMinutes = daysInHorizon(horizon) * defaults.fallbackDailyCapacityMinutes;
  sourceFlags.push("capacity:fallback_8h_day");
  return {
    capacityMinutes: fallbackMinutes,
    hours: fallbackMinutes / 60,
    scheduled: false,
    shiftCount: 0,
    sourceFlags
  };
}

function computeOperatorSaturation(loadMinutes, capacityMinutes) {
  return capacityMinutes > 0 ? clamp01(Number(loadMinutes || 0) / Number(capacityMinutes)) : 0;
}

function computeOperatorYield(revenueCents, hours, hourlyCostCents = 0) {
  const safeHours = Math.max(1, Number(hours || 0));
  const revenuePerHourCents = Number(revenueCents || 0) / safeHours;
  const hourlyCost = Number(hourlyCostCents || 0);
  const marginPerHourCents = hourlyCost > 0 ? (Number(revenueCents || 0) - hourlyCost * safeHours) / safeHours : null;
  return {
    yieldPerHourCents: roundCents(revenuePerHourCents),
    marginYieldPerHourCents: marginPerHourCents == null ? null : roundCents(marginPerHourCents)
  };
}

function computeOperatorEfficiency(metrics = {}, weights = DEFAULT_WEIGHTS.efficiency) {
  const completionRate = clamp01(metrics.completionRate);
  const punctualityProxy = clamp01(metrics.punctualityProxy);
  const serviceDensity = clamp01(metrics.serviceDensity);
  const loadBalance = clamp01(metrics.loadBalance);
  return round(
    weights.completionRate * completionRate +
    weights.punctualityProxy * punctualityProxy +
    weights.serviceDensity * serviceDensity +
    weights.loadBalance * loadBalance
  );
}

function computeOperatorReadiness(factors = {}, weights = DEFAULT_WEIGHTS.readiness) {
  const operatorLinkQuality = clamp01(factors.operatorLinkQuality);
  const scheduleCoverage = clamp01(factors.scheduleCoverage);
  const appointmentCoverage = clamp01(factors.appointmentCoverage);
  const costAvailability = clamp01(factors.costAvailability);
  return round(
    weights.operatorLinkQuality * operatorLinkQuality +
    weights.scheduleCoverage * scheduleCoverage +
    weights.appointmentCoverage * appointmentCoverage +
    weights.costAvailability * costAvailability
  );
}

function inferProductivityBand(score) {
  const value = Number(score || 0);
  if (value >= PRODUCTIVITY_BANDS.STRONG) return "STRONG";
  if (value >= PRODUCTIVITY_BANDS.STABLE) return "STABLE";
  if (value >= PRODUCTIVITY_BANDS.FRAGILE) return "FRAGILE";
  return "CRITICAL";
}

function average(values = []) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function computeOperatorProductivitySnapshot(input = {}, options = {}) {
  const horizon = normalizeHorizon(input.horizon || options.horizon || {});
  const defaults = { ...DEFAULTS, ...(options.defaults || {}) };
  const staff = Array.isArray(input.staff) ? input.staff : Array.isArray(input.operators) ? input.operators : [];
  const activeStaff = staff.filter((operator) => operator && operator.active !== false && operator.active !== 0);
  const operators = activeStaff.length ? activeStaff : staff;
  const appointmentsAll = Array.isArray(input.appointments) ? input.appointments : [];
  const services = Array.isArray(input.services) ? input.services : [];
  const shifts = Array.isArray(input.shifts) ? input.shifts : [];
  const payments = Array.isArray(input.payments) ? input.payments : [];
  const serviceById = mapById(services);
  const periodAppointments = appointmentsAll.filter((appointment) => isInHorizon(getAppointmentDate(appointment), horizon));
  const relevantAppointments = periodAppointments.filter((appointment) => !RELEVANT_LOAD_EXCLUDED_STATUSES.has(String(appointment.status || "").toLowerCase()));
  const linkedAppointments = periodAppointments.filter((appointment) => getOperatorId(appointment)).length;
  const revenueResult = computeOperatorRevenue(periodAppointments, payments, services, horizon);
  const operatorIds = new Set(operators.map((operator) => String(operator.id || "")));
  const unassignedAppointments = periodAppointments.filter((appointment) => !getOperatorId(appointment));
  const sourceFlags = [...revenueResult.sourceFlags];
  if (unassignedAppointments.length) sourceFlags.push("appointments:missing_operator_link");
  if (!shifts.length) sourceFlags.push("schedule:no_shifts_available");
  if (!operators.length) sourceFlags.push("operators:none_available");

  const baseRows = operators.map((operator) => {
    const operatorId = String(operator.id || "");
    const operatorAppointments = periodAppointments.filter((appointment) => getOperatorId(appointment) === operatorId);
    const loadAppointments = relevantAppointments.filter((appointment) => getOperatorId(appointment) === operatorId);
    const completed = operatorAppointments.filter((appointment) => COMPLETED_STATUSES.has(String(appointment.status || "").toLowerCase())).length;
    const loadMinutes = loadAppointments.reduce((sum, appointment) => sum + getAppointmentDurationMinutes(appointment, serviceById, defaults), 0);
    const capacity = computeOperatorCapacity(operator, shifts, horizon, { defaults });
    const saturation = computeOperatorSaturation(loadMinutes, capacity.capacityMinutes);
    const serviceCount = operatorAppointments.reduce((sum, appointment) => sum + Math.max(1, getAppointmentServiceIds(appointment).length), 0);
    return {
      operator,
      operatorId,
      operatorName: operator.name || operator.staffName || "Operatore",
      appointments: operatorAppointments,
      appointmentCount: operatorAppointments.length,
      completed,
      loadMinutes,
      serviceCount,
      capacity,
      saturation
    };
  });

  const averageSaturation = average(baseRows.map((row) => row.saturation));
  const maxRevenue = Math.max(1, ...baseRows.map((row) => Number(revenueResult.byOperator.get(row.operatorId)?.revenueCents || 0)));
  const preliminaryYields = baseRows.map((row) => {
    const revenue = revenueResult.byOperator.get(row.operatorId)?.revenueCents || 0;
    return Number(revenue || 0) / Math.max(1, Number(row.capacity.hours || 0));
  });
  const maxYield = Math.max(1, ...preliminaryYields);

  const operatorRows = baseRows.map((row) => {
    const revenueRow = revenueResult.byOperator.get(row.operatorId) || {};
    const revenueCents = roundCents(revenueRow.revenueCents || 0);
    const cashCents = Number(revenueRow.linkedCashAppointments || 0) > 0 ? roundCents(revenueRow.cashCents || 0) : null;
    const completionRate = row.appointmentCount > 0 ? row.completed / row.appointmentCount : 0;
    const densityPerHour = row.appointmentCount / Math.max(1, row.capacity.hours || 0);
    const serviceDensity = clamp01(densityPerHour / defaults.appointmentDensityTargetPerHour);
    const loadBalance = clamp01(1 - Math.abs(row.saturation - averageSaturation));
    const efficiency = computeOperatorEfficiency({
      completionRate,
      punctualityProxy: defaults.neutralPunctualityProxy,
      serviceDensity,
      loadBalance
    });
    const hasLinkedAppointments = row.appointmentCount > 0;
    const readiness = computeOperatorReadiness({
      operatorLinkQuality: operatorIds.has(row.operatorId) ? 1 : 0.5,
      scheduleCoverage: row.capacity.scheduled ? 1 : 0.45,
      appointmentCoverage: hasLinkedAppointments ? 1 : periodAppointments.length ? 0.5 : 0.6,
      costAvailability: Number(row.operator.hourlyCostCents || row.operator.hourlyCost || 0) > 0 ? 1 : 0.35
    });
    const yieldResult = computeOperatorYield(revenueCents, row.capacity.hours, row.operator.hourlyCostCents || row.operator.hourlyCost || 0);
    const revenueNorm = clamp01(revenueCents / maxRevenue);
    const yieldNorm = clamp01(Number(yieldResult.yieldPerHourCents || 0) / maxYield);
    const productivityScore = round(
      DEFAULT_WEIGHTS.productivity.revenue * revenueNorm +
      DEFAULT_WEIGHTS.productivity.saturation * row.saturation +
      DEFAULT_WEIGHTS.productivity.efficiency * efficiency +
      DEFAULT_WEIGHTS.productivity.yield * yieldNorm +
      DEFAULT_WEIGHTS.productivity.readiness * readiness
    );
    const rowFlags = [...row.capacity.sourceFlags, "punctuality:fallback_neutral"];
    if (cashCents == null) rowFlags.push("cash:not_linked_to_operator");
    if (Number(row.operator.hourlyCostCents || row.operator.hourlyCost || 0) <= 0) rowFlags.push("cost:missing_hourly_cost");
    return {
      operatorId: row.operatorId,
      operatorName: row.operatorName,
      revenue: revenueCents,
      cash: cashCents,
      appointments: row.appointmentCount,
      completed: row.completed,
      ticket: roundCents(revenueCents / Math.max(1, row.appointmentCount)),
      capacityMinutes: roundCents(row.capacity.capacityMinutes),
      loadMinutes: roundCents(row.loadMinutes),
      saturation: round(row.saturation),
      efficiency,
      yieldPerHour: yieldResult.yieldPerHourCents,
      marginYieldPerHour: yieldResult.marginYieldPerHourCents,
      readiness,
      productivityScore,
      band: inferProductivityBand(productivityScore),
      sourceFlags: Array.from(new Set(rowFlags))
    };
  }).sort((a, b) => Number(b.productivityScore || 0) - Number(a.productivityScore || 0));

  const staffReadiness = round(average(operatorRows.map((row) => row.readiness)));
  const averageProductivity = round(average(operatorRows.map((row) => row.productivityScore)));
  const centerBand = inferProductivityBand(averageProductivity);

  return {
    mathCore: CORE_VERSION,
    horizon,
    counts: {
      operators: operators.length,
      appointments: periodAppointments.length,
      linkedAppointments,
      scheduledOperators: baseRows.filter((row) => row.capacity.scheduled).length
    },
    scores: {
      staffReadiness,
      averageProductivity,
      averageSaturation: round(average(operatorRows.map((row) => row.saturation))),
      averageEfficiency: round(average(operatorRows.map((row) => row.efficiency))),
      averageYield: roundCents(average(operatorRows.map((row) => row.yieldPerHour)))
    },
    band: centerBand,
    operators: operatorRows,
    sourceFlags: Array.from(new Set(sourceFlags))
  };
}

module.exports = {
  CORE_VERSION,
  DEFAULT_WEIGHTS,
  PRODUCTIVITY_BANDS,
  computeOperatorCapacity,
  computeOperatorSaturation,
  computeOperatorRevenue,
  computeOperatorEfficiency,
  computeOperatorYield,
  computeOperatorReadiness,
  computeOperatorProductivitySnapshot,
  inferProductivityBand
};
