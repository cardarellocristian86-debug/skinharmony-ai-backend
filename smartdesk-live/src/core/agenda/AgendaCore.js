const AGENDA_BAND = Object.freeze({
  CALM: "CALM",
  WATCH: "WATCH",
  STRESSED: "STRESSED",
  CRITICAL: "CRITICAL"
});

const AGENDA_STATUS = Object.freeze({
  CANCELLED: new Set(["cancelled", "canceled"]),
  NO_SHOW: new Set(["no_show", "noshow"]),
  COMPLETED: new Set(["completed", "done", "ready_checkout"]),
  WEAK: new Set(["requested", "booked", "scheduled"]),
  STRONG: new Set(["confirmed", "arrived", "in_progress"])
});

// Centralized weights and thresholds for agenda_core_v1. They are explicit for auditability.
const FRAGILITY_WEIGHTS = Object.freeze({ time: 0.20, client: 0.15, history: 0.20, gap: 0.15, dependency: 0.15, status: 0.15 });
const NO_SHOW_WEIGHTS = Object.freeze({ history: 0.30, status: 0.20, contact: 0.20, time: 0.20, resource: 0.10 });
const SLOT_VALUE_WEIGHTS = Object.freeze({ revenue: 0.30, margin: 0.30, scarcity: 0.20, strategic: 0.20 });
const URGENCY_WEIGHTS = Object.freeze({ saturation: 0.25, pressure: 0.30, fragility: 0.20, noShowRisk: 0.25 });
const READINESS_WEIGHTS = Object.freeze({ dataAvailability: 0.25, scheduleCompleteness: 0.25, appointmentQuality: 0.25, resourceClarity: 0.25 });
const AGENDA_SCORE_WEIGHTS = Object.freeze({ saturation: 0.20, pressure: 0.25, fragility: 0.20, noShowRisk: 0.20, slotValue: 0.15 });

const AGENDA_THRESHOLDS = Object.freeze({
  lowNeedMonitorMax: 0.20,
  calmMax: 0.35,
  watchMax: 0.55,
  stressedMax: 0.75,
  defaultOperatorDayMinutes: 8 * 60,
  defaultSaturdayMinutes: 6 * 60,
  slotMinutes: 30,
  compressedGapMinutes: 10,
  awkwardGapMinutes: 45,
  strategicMorningStart: 10,
  strategicMorningEnd: 12,
  strategicEveningStart: 17,
  strategicEveningEnd: 19
});

function clamp01(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function normalizeText(value = "") {
  return cleanText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function timestamp(value = "") {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function toDateOnly(value = "") {
  return String(value || "").slice(0, 10);
}

function dayRange(startDate = "", endDate = "") {
  const start = startDate ? new Date(`${startDate}T00:00:00.000Z`) : new Date();
  const end = endDate ? new Date(`${endDate}T00:00:00.000Z`) : new Date(start);
  const days = [];
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return days;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(cursor.toISOString().slice(0, 10));
  }
  return days.length ? days : [start.toISOString().slice(0, 10)];
}

function inHorizon(value = "", horizon = {}) {
  const date = toDateOnly(value || "");
  if (!date) return false;
  if (horizon.startDate && date < horizon.startDate) return false;
  if (horizon.endDate && date > horizon.endDate) return false;
  return true;
}

function filterByHorizon(items = [], horizon = {}, dateFields = ["startAt", "date", "createdAt"]) {
  if (!horizon?.startDate && !horizon?.endDate) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((item) => {
    const value = dateFields.map((field) => item?.[field]).find(Boolean);
    return inHorizon(value, horizon);
  });
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function activeOnly(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.active !== false && item?.active !== 0);
}

function statusOf(appointment = {}) {
  return normalizeText(appointment.status || appointment.day || "scheduled");
}

function isCancelledOrNoShow(appointment = {}) {
  const status = statusOf(appointment);
  return AGENDA_STATUS.CANCELLED.has(status) || AGENDA_STATUS.NO_SHOW.has(status);
}

function serviceIdsForAppointment(appointment = {}) {
  const ids = Array.isArray(appointment.serviceIds)
    ? appointment.serviceIds
    : (appointment.serviceId ? [appointment.serviceId] : []);
  return ids.map((id) => String(id || "")).filter(Boolean);
}

function startTime(appointment = {}) {
  return timestamp(appointment.startAt || appointment.date || appointment.createdAt || "");
}

function inferDurationMinutes(appointment = {}, servicesById = new Map()) {
  const explicit = Number(appointment.durationMin || appointment.durationMinutes || appointment.minutes || 0);
  if (explicit > 0) return explicit;
  const start = startTime(appointment);
  const end = timestamp(appointment.endAt || appointment.end || "");
  if (start && end && end > start) return Math.max(1, Math.round((end - start) / 60000));
  const serviceDurations = serviceIdsForAppointment(appointment)
    .map((id) => Number(servicesById.get(String(id))?.durationMin || servicesById.get(String(id))?.durationMinutes || 0))
    .filter((value) => value > 0);
  if (serviceDurations.length) return serviceDurations.reduce((sum, value) => sum + value, 0);
  return 45;
}

function appointmentEndTime(appointment = {}, servicesById = new Map()) {
  const start = startTime(appointment);
  if (!start) return 0;
  return start + (inferDurationMinutes(appointment, servicesById) * 60000);
}

function appointmentRevenueCents(appointment = {}, servicesById = new Map()) {
  const direct = Number(appointment.amountCents || appointment.priceCents || appointment.dueCents || 0);
  if (direct > 0) return direct;
  const serviceRevenue = serviceIdsForAppointment(appointment)
    .map((id) => Number(servicesById.get(String(id))?.priceCents || 0))
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  return Math.max(0, serviceRevenue);
}

function serviceCostCents(service = {}) {
  return Math.max(0, Number(
    service.directCostCents
    || service.costCents
    || service.productCostCents
    || service.estimatedProductCostCents
    || service.technologyCostCents
    || 0
  ));
}

function appointmentMarginCents(appointment = {}, servicesById = new Map()) {
  const revenue = appointmentRevenueCents(appointment, servicesById);
  const serviceCost = serviceIdsForAppointment(appointment)
    .map((id) => serviceCostCents(servicesById.get(String(id)) || {}))
    .reduce((sum, value) => sum + value, 0);
  return Math.max(0, revenue - serviceCost);
}

function hasScheduleData(staff = []) {
  return activeOnly(staff).some((operator) => (
    operator.workingHours
    || operator.schedule
    || operator.shifts
    || operator.weeklySchedule
    || operator.startTime
    || operator.endTime
  ));
}

function minutesFromTime(value = "") {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour * 60) + minute;
}

function dayName(date = "") {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][day] || "";
}

function scheduleMinutesForOperator(operator = {}, date = "") {
  const key = dayName(date);
  const sources = [
    operator.workingHours?.[key],
    operator.weeklySchedule?.[key],
    operator.schedule?.[key],
    Array.isArray(operator.shifts) ? operator.shifts.find((shift) => toDateOnly(shift.date || shift.startAt) === date) : null,
    operator.startTime || operator.endTime ? { start: operator.startTime, end: operator.endTime } : null
  ].filter(Boolean);
  for (const source of sources) {
    const ranges = Array.isArray(source) ? source : [source];
    const total = ranges.reduce((sum, range) => {
      if (range?.active === false || range?.closed === true) return sum;
      const start = minutesFromTime(range.start || range.startTime || range.from);
      const end = minutesFromTime(range.end || range.endTime || range.to);
      return start !== null && end !== null && end > start ? sum + (end - start) : sum;
    }, 0);
    if (total > 0) return total;
  }
  return null;
}

function fallbackDayMinutes(date = "") {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (day === 0) return 0;
  if (day === 6) return AGENDA_THRESHOLDS.defaultSaturdayMinutes;
  return AGENDA_THRESHOLDS.defaultOperatorDayMinutes;
}

function computeDayCapacity(date = "", staff = [], sourceFlags = new Set()) {
  const activeStaff = activeOnly(staff);
  const operators = Math.max(1, activeStaff.length || 1);
  let usedSchedule = false;
  const minutes = activeStaff.reduce((sum, operator) => {
    const scheduled = scheduleMinutesForOperator(operator, date);
    if (scheduled !== null) {
      usedSchedule = true;
      return sum + scheduled;
    }
    return sum;
  }, 0);
  if (usedSchedule && minutes > 0) return { capacityMinutes: minutes, operators, source: "schedule" };
  sourceFlags.add("capacity:fallback_operator_day_minutes");
  return { capacityMinutes: fallbackDayMinutes(date) * operators, operators, source: "fallback" };
}

function buildDailyRows(appointments = [], staff = [], servicesById = new Map(), horizon = {}, sourceFlags = new Set()) {
  const days = dayRange(horizon.startDate || toDateOnly(new Date().toISOString()), horizon.endDate || horizon.startDate || toDateOnly(new Date().toISOString()));
  const loadByDay = new Map(days.map((day) => [day, 0]));
  appointments.filter((appointment) => !isCancelledOrNoShow(appointment)).forEach((appointment) => {
    const day = toDateOnly(appointment.startAt || appointment.date || appointment.createdAt);
    if (!loadByDay.has(day)) return;
    loadByDay.set(day, loadByDay.get(day) + inferDurationMinutes(appointment, servicesById));
  });
  return days.map((day) => {
    const capacity = computeDayCapacity(day, staff, sourceFlags);
    const loadMinutes = loadByDay.get(day) || 0;
    const saturation = capacity.capacityMinutes > 0 ? clamp01(loadMinutes / capacity.capacityMinutes) : 0;
    return {
      date: day,
      capacityMinutes: capacity.capacityMinutes,
      loadMinutes,
      operators: capacity.operators,
      capacitySource: capacity.source,
      saturation: round(saturation)
    };
  });
}

function computeAgendaSaturation(input = {}) {
  const servicesById = mapById(input.services);
  const appointments = filterByHorizon(input.appointments, input.horizon);
  const sourceFlags = new Set(input.sourceFlags || []);
  const dailySaturation = buildDailyRows(appointments, input.staff, servicesById, input.horizon, sourceFlags);
  const totalCapacity = dailySaturation.reduce((sum, row) => sum + row.capacityMinutes, 0);
  const totalLoad = dailySaturation.reduce((sum, row) => sum + row.loadMinutes, 0);
  return {
    saturation: round(totalCapacity > 0 ? clamp01(totalLoad / totalCapacity) : 0),
    dailySaturation,
    sourceFlags: Array.from(sourceFlags)
  };
}

function overlapMinutes(aStart = 0, aEnd = 0, bStart = 0, bEnd = 0) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 60000;
}

function computeAgendaPressure(input = {}) {
  const servicesById = mapById(input.services);
  const appointments = filterByHorizon(input.appointments, input.horizon).filter((appointment) => !isCancelledOrNoShow(appointment));
  const sourceFlags = new Set(input.sourceFlags || []);
  const dailyRows = buildDailyRows(appointments, input.staff, servicesById, input.horizon, sourceFlags);
  const slotMinutes = Number(input.slotMinutes || AGENDA_THRESHOLDS.slotMinutes);
  const dailyPressure = dailyRows.map((day) => {
    const slots = [];
    const dayStart = timestamp(`${day.date}T00:00:00.000Z`);
    const slotCount = Math.ceil((24 * 60) / slotMinutes);
    for (let index = 0; index < slotCount; index += 1) {
      const slotStart = dayStart + (index * slotMinutes * 60000);
      const slotEnd = slotStart + (slotMinutes * 60000);
      const loadMinutes = appointments.reduce((sum, appointment) => {
        const start = startTime(appointment);
        const end = appointmentEndTime(appointment, servicesById);
        return sum + overlapMinutes(start, end, slotStart, slotEnd);
      }, 0);
      if (loadMinutes <= 0) continue;
      const capacityMinutes = Math.max(slotMinutes, day.operators * slotMinutes);
      const pressure = clamp01(loadMinutes / capacityMinutes);
      slots.push({
        slot: new Date(slotStart).toISOString().slice(11, 16),
        loadMinutes: round(loadMinutes, 2),
        capacityMinutes,
        pressure: round(pressure),
        compressed: pressure >= 1
      });
    }
    const maxPressure = slots.length ? Math.max(...slots.map((slot) => slot.pressure)) : 0;
    const avgPressure = slots.length ? slots.reduce((sum, slot) => sum + slot.pressure, 0) / slots.length : 0;
    return {
      date: day.date,
      maxPressure: round(maxPressure),
      averageOccupiedSlotPressure: round(avgPressure),
      pressure: round((0.7 * maxPressure) + (0.3 * avgPressure)),
      compressedSlots: slots.filter((slot) => slot.compressed).length,
      slots: slots.slice(0, 12)
    };
  });
  const pressure = dailyPressure.length ? Math.max(...dailyPressure.map((row) => row.pressure)) : 0;
  return { pressure: round(pressure), dailyPressure, sourceFlags: Array.from(sourceFlags) };
}

function contactQuality(client = {}) {
  const email = /\S+@\S+\.\S+/.test(String(client.email || "")) ? 1 : 0;
  const phone = String(client.phone || "").replace(/\D/g, "").length >= 7 ? 1 : 0;
  return clamp01((email + phone) / 2);
}

function clientHistoryRisk(clientId = "", appointments = []) {
  if (!clientId) return 0.35;
  const clientAppointments = appointments.filter((appointment) => String(appointment.clientId || "") === String(clientId));
  if (!clientAppointments.length) return 0.25;
  const bad = clientAppointments.filter((appointment) => {
    const status = statusOf(appointment);
    return AGENDA_STATUS.CANCELLED.has(status) || AGENDA_STATUS.NO_SHOW.has(status);
  }).length;
  return clamp01(bad / clientAppointments.length);
}

function appointmentGapRisk(appointment = {}, appointments = [], servicesById = new Map()) {
  const sameDayStaff = appointments
    .filter((item) => !isCancelledOrNoShow(item))
    .filter((item) => toDateOnly(item.startAt || item.date || item.createdAt) === toDateOnly(appointment.startAt || appointment.date || appointment.createdAt))
    .filter((item) => String(item.staffId || item.operatorId || "unassigned") === String(appointment.staffId || appointment.operatorId || "unassigned"))
    .sort((a, b) => startTime(a) - startTime(b));
  const index = sameDayStaff.findIndex((item) => String(item.id || "") === String(appointment.id || ""));
  if (index < 0) return 0.25;
  const start = startTime(appointment);
  const end = appointmentEndTime(appointment, servicesById);
  const previous = sameDayStaff[index - 1];
  const next = sameDayStaff[index + 1];
  const prevGap = previous ? Math.max(0, (start - appointmentEndTime(previous, servicesById)) / 60000) : null;
  const nextGap = next ? Math.max(0, (startTime(next) - end) / 60000) : null;
  const gaps = [prevGap, nextGap].filter((value) => value !== null);
  if (!gaps.length) return 0.15;
  if (gaps.some((gap) => gap < AGENDA_THRESHOLDS.compressedGapMinutes)) return 1;
  if (gaps.some((gap) => gap > 0 && gap <= AGENDA_THRESHOLDS.awkwardGapMinutes)) return 0.55;
  return 0.2;
}

function timeRisk(appointment = {}) {
  const start = new Date(appointment.startAt || appointment.date || appointment.createdAt || 0);
  if (!Number.isFinite(start.getTime())) return 0.7;
  const hour = start.getHours();
  if (hour < 9 || hour >= 20) return 0.75;
  if ((hour >= 10 && hour <= 12) || (hour >= 17 && hour <= 19)) return 0.35;
  return 0.2;
}

function statusRisk(appointment = {}) {
  const status = statusOf(appointment);
  if (AGENDA_STATUS.WEAK.has(status)) return 0.85;
  if (AGENDA_STATUS.STRONG.has(status)) return 0.25;
  if (AGENDA_STATUS.COMPLETED.has(status)) return 0.05;
  if (AGENDA_STATUS.CANCELLED.has(status) || AGENDA_STATUS.NO_SHOW.has(status)) return 1;
  return 0.45;
}

function dependencyRisk(appointment = {}, staffById = new Map(), servicesById = new Map(), resources = []) {
  const missingOperator = !(appointment.staffId || appointment.operatorId || appointment.staffName);
  const serviceIds = serviceIdsForAppointment(appointment);
  const missingService = !serviceIds.length && !(appointment.serviceName || appointment.service);
  const serviceRequiresTechnology = serviceIds.some((id) => {
    const service = servicesById.get(String(id)) || {};
    return Array.isArray(service.technologyLinks) && service.technologyLinks.length > 0;
  });
  const technologyUnavailable = serviceRequiresTechnology && !(Array.isArray(resources) && resources.length);
  const inactiveStaff = appointment.staffId && staffById.has(String(appointment.staffId)) && staffById.get(String(appointment.staffId))?.active === false;
  return clamp01((Number(missingOperator) * 0.35) + (Number(missingService) * 0.35) + (Number(technologyUnavailable) * 0.2) + (Number(inactiveStaff) * 0.1));
}

function computeAppointmentFragility(input = {}) {
  const appointments = filterByHorizon(input.appointments, input.horizon);
  const clientsById = mapById(input.clients);
  const staffById = mapById(input.staff);
  const servicesById = mapById(input.services);
  const rows = appointments.map((appointment) => {
    const client = clientsById.get(String(appointment.clientId || "")) || {};
    const fTime = timeRisk(appointment);
    const fClient = appointment.clientId ? (1 - contactQuality(client)) : 0.6;
    const fHistory = clientHistoryRisk(appointment.clientId, input.appointments || []);
    const fGap = appointmentGapRisk(appointment, appointments, servicesById);
    const fDependency = dependencyRisk(appointment, staffById, servicesById, input.resources);
    const fStatus = statusRisk(appointment);
    const fragility = (FRAGILITY_WEIGHTS.time * fTime)
      + (FRAGILITY_WEIGHTS.client * fClient)
      + (FRAGILITY_WEIGHTS.history * fHistory)
      + (FRAGILITY_WEIGHTS.gap * fGap)
      + (FRAGILITY_WEIGHTS.dependency * fDependency)
      + (FRAGILITY_WEIGHTS.status * fStatus);
    return {
      id: appointment.id || "",
      startAt: appointment.startAt || appointment.date || "",
      status: appointment.status || "",
      clientId: appointment.clientId || "",
      staffId: appointment.staffId || appointment.operatorId || "",
      fragility: round(fragility),
      factors: {
        time: round(fTime),
        client: round(fClient),
        history: round(fHistory),
        gap: round(fGap),
        dependency: round(fDependency),
        status: round(fStatus)
      }
    };
  });
  const sorted = rows.slice().sort((a, b) => b.fragility - a.fragility);
  const average = rows.length ? rows.reduce((sum, row) => sum + row.fragility, 0) / rows.length : 0;
  const topCount = Math.max(1, Math.ceil(rows.length * 0.2));
  const topAverage = sorted.length ? sorted.slice(0, topCount).reduce((sum, row) => sum + row.fragility, 0) / topCount : 0;
  return {
    fragility: round((0.65 * average) + (0.35 * topAverage)),
    fragileAppointments: sorted.slice(0, 10)
  };
}

function computeNoShowRisk(input = {}) {
  const appointments = filterByHorizon(input.appointments, input.horizon)
    .filter((appointment) => !AGENDA_STATUS.COMPLETED.has(statusOf(appointment)));
  const clientsById = mapById(input.clients);
  const servicesById = mapById(input.services);
  const rows = appointments.map((appointment) => {
    const client = clientsById.get(String(appointment.clientId || "")) || {};
    const h = clientHistoryRisk(appointment.clientId, input.appointments || []);
    const s = statusRisk(appointment);
    const c = 1 - contactQuality(client);
    const t = timeRisk(appointment);
    const r = dependencyRisk(appointment, mapById(input.staff), servicesById, input.resources);
    const noShowRisk = (NO_SHOW_WEIGHTS.history * h)
      + (NO_SHOW_WEIGHTS.status * s)
      + (NO_SHOW_WEIGHTS.contact * c)
      + (NO_SHOW_WEIGHTS.time * t)
      + (NO_SHOW_WEIGHTS.resource * r);
    return {
      id: appointment.id || "",
      startAt: appointment.startAt || appointment.date || "",
      status: appointment.status || "",
      clientId: appointment.clientId || "",
      noShowRisk: round(noShowRisk),
      factors: { history: round(h), status: round(s), contact: round(c), time: round(t), resource: round(r) }
    };
  }).sort((a, b) => b.noShowRisk - a.noShowRisk);
  const risk = rows.length ? rows.reduce((sum, row) => sum + row.noShowRisk, 0) / rows.length : 0;
  return { noShowRisk: round(risk), noShowCandidates: rows.slice(0, 10) };
}

function isStrategicHour(appointment = {}) {
  const start = new Date(appointment.startAt || appointment.date || appointment.createdAt || 0);
  if (!Number.isFinite(start.getTime())) return false;
  const hour = start.getHours();
  return (hour >= AGENDA_THRESHOLDS.strategicMorningStart && hour <= AGENDA_THRESHOLDS.strategicMorningEnd)
    || (hour >= AGENDA_THRESHOLDS.strategicEveningStart && hour <= AGENDA_THRESHOLDS.strategicEveningEnd);
}

function computeSlotValue(input = {}) {
  const appointments = filterByHorizon(input.appointments, input.horizon).filter((appointment) => !isCancelledOrNoShow(appointment));
  const servicesById = mapById(input.services);
  const maxRevenue = Math.max(1, ...appointments.map((appointment) => appointmentRevenueCents(appointment, servicesById)));
  const maxMargin = Math.max(1, ...appointments.map((appointment) => appointmentMarginCents(appointment, servicesById)));
  const pressure = computeAgendaPressure(input);
  const pressureByDate = new Map((pressure.dailyPressure || []).map((row) => [row.date, row.pressure]));
  const rows = appointments.map((appointment) => {
    const revenue = clamp01(appointmentRevenueCents(appointment, servicesById) / maxRevenue);
    const margin = clamp01(appointmentMarginCents(appointment, servicesById) / maxMargin);
    const scarcity = clamp01(pressureByDate.get(toDateOnly(appointment.startAt || appointment.date || appointment.createdAt)) || 0);
    const strategic = isStrategicHour(appointment) ? 1 : 0.35;
    const slotValue = (SLOT_VALUE_WEIGHTS.revenue * revenue)
      + (SLOT_VALUE_WEIGHTS.margin * margin)
      + (SLOT_VALUE_WEIGHTS.scarcity * scarcity)
      + (SLOT_VALUE_WEIGHTS.strategic * strategic);
    return {
      id: appointment.id || "",
      startAt: appointment.startAt || appointment.date || "",
      slotValue: round(slotValue),
      factors: { revenue: round(revenue), margin: round(margin), scarcity: round(scarcity), strategic: round(strategic) }
    };
  }).sort((a, b) => b.slotValue - a.slotValue);
  const value = rows.length ? rows.reduce((sum, row) => sum + row.slotValue, 0) / rows.length : 0;
  return { slotValue: round(value), slotValuation: rows.slice(0, 10) };
}

function computeAgendaUrgency(input = {}) {
  const saturation = Number(input.saturation ?? 0);
  const pressure = Number(input.pressure ?? 0);
  const fragility = Number(input.fragility ?? 0);
  const noShowRisk = Number(input.noShowRisk ?? 0);
  const urgency = (URGENCY_WEIGHTS.saturation * clamp01(saturation))
    + (URGENCY_WEIGHTS.pressure * clamp01(pressure))
    + (URGENCY_WEIGHTS.fragility * clamp01(fragility))
    + (URGENCY_WEIGHTS.noShowRisk * clamp01(noShowRisk));
  const monitorMax = urgency < AGENDA_THRESHOLDS.lowNeedMonitorMax;
  return { urgency: round(urgency), monitorMax };
}

function computeAgendaReadiness(input = {}) {
  const appointments = filterByHorizon(input.appointments, input.horizon);
  const servicesById = mapById(input.services);
  const staffById = mapById(input.staff);
  const hasAppointments = appointments.length > 0 ? 1 : 0;
  const hasOperators = activeOnly(input.staff).length > 0 ? 1 : 0;
  const dataAvailability = clamp01((hasAppointments + hasOperators + (Array.isArray(input.services) && input.services.length ? 1 : 0)) / 3);
  const scheduleCompleteness = hasScheduleData(input.staff) ? 1 : 0.45;
  const appointmentQuality = appointments.length
    ? appointments.reduce((sum, appointment) => {
      const validTime = startTime(appointment) ? 1 : 0;
      const service = serviceIdsForAppointment(appointment).some((id) => servicesById.has(String(id))) || appointment.serviceName ? 1 : 0;
      const operator = (appointment.staffId && staffById.has(String(appointment.staffId))) || appointment.staffName ? 1 : 0;
      const client = appointment.clientId || appointment.clientName || appointment.walkInName ? 1 : 0;
      return sum + ((validTime + service + operator + client) / 4);
    }, 0) / appointments.length
    : 0;
  const resourceClarity = appointments.length
    ? appointments.reduce((sum, appointment) => {
      const dependency = dependencyRisk(appointment, staffById, servicesById, input.resources);
      return sum + (1 - dependency);
    }, 0) / appointments.length
    : 0;
  const readiness = (READINESS_WEIGHTS.dataAvailability * dataAvailability)
    + (READINESS_WEIGHTS.scheduleCompleteness * scheduleCompleteness)
    + (READINESS_WEIGHTS.appointmentQuality * appointmentQuality)
    + (READINESS_WEIGHTS.resourceClarity * resourceClarity);
  return {
    readiness: round(readiness),
    readinessFactors: {
      dataAvailability: round(dataAvailability),
      scheduleCompleteness: round(scheduleCompleteness),
      appointmentQuality: round(appointmentQuality),
      resourceClarity: round(resourceClarity)
    },
    sourceFlags: hasScheduleData(input.staff) ? [] : ["readiness:schedule_fallback"]
  };
}

function inferAgendaBand(score = 0) {
  const value = clamp01(score);
  if (value < AGENDA_THRESHOLDS.calmMax) return AGENDA_BAND.CALM;
  if (value < AGENDA_THRESHOLDS.watchMax) return AGENDA_BAND.WATCH;
  if (value < AGENDA_THRESHOLDS.stressedMax) return AGENDA_BAND.STRESSED;
  return AGENDA_BAND.CRITICAL;
}

function computeAgendaScore(scores = {}) {
  const score = (AGENDA_SCORE_WEIGHTS.saturation * clamp01(scores.saturation))
    + (AGENDA_SCORE_WEIGHTS.pressure * clamp01(scores.pressure))
    + (AGENDA_SCORE_WEIGHTS.fragility * clamp01(scores.fragility))
    + (AGENDA_SCORE_WEIGHTS.noShowRisk * clamp01(scores.noShowRisk))
    + (AGENDA_SCORE_WEIGHTS.slotValue * clamp01(scores.slotValue));
  return round(score);
}

function computeAgendaSnapshot(input = {}) {
  const sourceFlags = new Set(Array.isArray(input.sourceFlags) ? input.sourceFlags : []);
  const appointments = filterByHorizon(input.appointments, input.horizon);
  const services = Array.isArray(input.services) ? input.services : [];
  const staff = activeOnly(input.staff);
  const resources = Array.isArray(input.resources) ? input.resources : [];
  const days = dayRange(input.horizon?.startDate || toDateOnly(new Date().toISOString()), input.horizon?.endDate || input.horizon?.startDate || toDateOnly(new Date().toISOString()));
  const saturation = computeAgendaSaturation({ ...input, appointments });
  saturation.sourceFlags.forEach((flag) => sourceFlags.add(flag));
  const pressure = computeAgendaPressure({ ...input, appointments });
  pressure.sourceFlags.forEach((flag) => sourceFlags.add(flag));
  const fragility = computeAppointmentFragility({ ...input, appointments });
  const noShow = computeNoShowRisk({ ...input, appointments });
  const slotValue = computeSlotValue({ ...input, appointments });
  const urgency = computeAgendaUrgency({
    saturation: saturation.saturation,
    pressure: pressure.pressure,
    fragility: fragility.fragility,
    noShowRisk: noShow.noShowRisk
  });
  if (urgency.monitorMax) sourceFlags.add("agenda_need_below_0_20:monitor_max");
  const readiness = computeAgendaReadiness({ ...input, appointments });
  readiness.sourceFlags.forEach((flag) => sourceFlags.add(flag));
  const agendaScore = computeAgendaScore({
    saturation: saturation.saturation,
    pressure: pressure.pressure,
    fragility: fragility.fragility,
    noShowRisk: noShow.noShowRisk,
    slotValue: slotValue.slotValue
  });
  return {
    mathCore: "agenda_core_v1",
    horizon: input.horizon || null,
    counts: {
      appointments: appointments.length,
      operators: staff.length,
      resources: resources.length,
      services: services.length,
      days: days.length
    },
    scores: {
      saturation: saturation.saturation,
      pressure: pressure.pressure,
      fragility: fragility.fragility,
      noShowRisk: noShow.noShowRisk,
      slotValue: slotValue.slotValue,
      urgency: urgency.urgency,
      readiness: readiness.readiness,
      agendaScore
    },
    band: inferAgendaBand(agendaScore),
    sourceFlags: Array.from(sourceFlags),
    breakdown: {
      dailySaturation: saturation.dailySaturation,
      dailyPressure: pressure.dailyPressure,
      fragileAppointments: fragility.fragileAppointments,
      noShowCandidates: noShow.noShowCandidates,
      slotValuation: slotValue.slotValuation,
      readinessFactors: readiness.readinessFactors
    }
  };
}

module.exports = {
  AGENDA_BAND,
  FRAGILITY_WEIGHTS,
  NO_SHOW_WEIGHTS,
  SLOT_VALUE_WEIGHTS,
  URGENCY_WEIGHTS,
  READINESS_WEIGHTS,
  AGENDA_SCORE_WEIGHTS,
  AGENDA_THRESHOLDS,
  computeAgendaSaturation,
  computeAgendaPressure,
  computeAppointmentFragility,
  computeNoShowRisk,
  computeSlotValue,
  computeAgendaUrgency,
  computeAgendaReadiness,
  computeAgendaScore,
  computeAgendaSnapshot,
  inferAgendaBand,
  clamp01
};
