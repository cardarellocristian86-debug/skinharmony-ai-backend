const MARKETING_CORE_VERSION = "marketing_core_v1";

const MARKETING_ACTION_BAND = Object.freeze({
  ACT_NOW: "ACT_NOW",
  SUGGEST: "SUGGEST",
  MONITOR: "MONITOR",
  VERIFY: "VERIFY",
  STOP: "STOP"
});

const CUSTOMER_VALUE_WEIGHTS = Object.freeze({ revenue: 0.30, margin: 0.20, frequency: 0.20, recencyPosition: 0.15, depth: 0.15 });
const CUSTOMER_VALUE_WEIGHTS_NO_MARGIN = Object.freeze({ revenue: 0.375, frequency: 0.25, recencyPosition: 0.1875, depth: 0.1875 });
const CHURN_RISK_WEIGHTS = Object.freeze({ gap: 0.30, drop: 0.20, volatility: 0.15, weakRelation: 0.20, lost: 0.15 });
const HABIT_WEIGHTS = Object.freeze({ habit: 0.40, consistency: 0.35, serviceRhythm: 0.25 });
const TIMING_WEIGHTS = Object.freeze({ window: 0.40, urgency: 0.25, season: 0.20, scheduleGap: 0.15 });
const CONTACTABILITY_WEIGHTS = Object.freeze({ consent: 0.30, channel: 0.20, quality: 0.20, reach: 0.15, history: 0.15 });
const SPAM_PRESSURE_WEIGHTS = Object.freeze({ recent: 0.30, frequency: 0.25, ignored: 0.20, fatigue: 0.25 });
const GOAL_FIT_WEIGHTS = Object.freeze({ goal: 0.25, service: 0.30, value: 0.20, reactivation: 0.25 });
const DATA_QUALITY_WEIGHTS = Object.freeze({ crm: 0.30, paymentLink: 0.20, appointmentHistory: 0.25, contactData: 0.25 });
const OPPORTUNITY_WEIGHTS = Object.freeze({ value: 0.18, churnRisk: 0.20, frequency: 0.10, timing: 0.18, contactability: 0.12, goalFit: 0.12, spamPressure: 0.10 });
const READINESS_WEIGHTS = Object.freeze({ meanDataQuality: 0.30, consentCoverage: 0.25, contactCoverage: 0.25, historyCoverage: 0.20 });

// Centralized thresholds for marketing_core_v1. They are deliberately conservative:
// the core suggests and ranks, but never sends or persists messages.
const MARKETING_THRESHOLDS = Object.freeze({
  actNowOpportunity: 0.80,
  actNowContactability: 0.75,
  actNowMaxSpamPressure: 0.35,
  actNowDataQuality: 0.70,
  suggestOpportunity: 0.60,
  monitorOpportunity: 0.35,
  minConsent: 0.50,
  minContactability: 0.45,
  maxSpamPressure: 0.75,
  minDataQuality: 0.45,
  weakTiming: 0.20
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

function cents(value = 0) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function positive(value = 0) {
  return Math.max(0, cents(value));
}

function average(values = [], fallback = 0) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return fallback;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function scoreRatio(numerator = 0, denominator = 0, emptyScore = 0) {
  const den = Number(denominator || 0);
  if (!den) return emptyScore;
  return clamp01(Number(numerator || 0) / den);
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function normalizeText(value = "") {
  return cleanText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizePhone(value = "") {
  return String(value || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
}

function validEmail(value = "") {
  const email = cleanText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function validPhone(value = "") {
  const digits = normalizePhone(value).replace(/\D/g, "");
  return digits.length >= 7;
}

function timestamp(value = "") {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function toDateOnly(value = "") {
  return String(value || "").slice(0, 10);
}

function daysBetween(from = "", to = "") {
  const start = timestamp(from);
  const end = timestamp(to);
  if (!start || !end) return null;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function appointmentDate(appointment = {}) {
  return appointment.startAt || appointment.date || appointment.createdAt || "";
}

function paymentDate(payment = {}) {
  return payment.paidAt || payment.createdAt || payment.date || "";
}

function marketingDate(entry = {}) {
  return entry.sentAt || entry.copiedAt || entry.approvedAt || entry.generatedAt || entry.createdAt || entry.updatedAt || "";
}

function inHorizon(value = "", horizon = {}) {
  const date = toDateOnly(value);
  if (!date) return false;
  if (horizon.startDate && date < horizon.startDate) return false;
  if (horizon.endDate && date > horizon.endDate) return false;
  return true;
}

function filterByHorizon(items = [], horizon = {}, dateSelector = (item) => item?.createdAt) {
  if (!horizon?.startDate && !horizon?.endDate) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((item) => inHorizon(dateSelector(item), horizon));
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function groupByClientId(items = []) {
  const grouped = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const clientId = String(item.clientId || item.customerId || "");
    if (!clientId) return;
    if (!grouped.has(clientId)) grouped.set(clientId, []);
    grouped.get(clientId).push(item);
  });
  return grouped;
}

function clientName(client = {}) {
  return `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || client.clientName || "";
}

function activeOnly(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.active !== false && item?.active !== 0);
}

function isCancelledAppointment(appointment = {}) {
  return ["cancelled", "canceled", "no_show"].includes(normalizeText(appointment.status || ""));
}

function serviceIdsForAppointment(appointment = {}) {
  if (Array.isArray(appointment.serviceIds)) return appointment.serviceIds.map(String).filter(Boolean);
  return appointment.serviceId ? [String(appointment.serviceId)] : [];
}

function servicePriceCents(service = {}) {
  const price = Number(service.priceCents || service.price || 0);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return price > 0 && price < 10000 && !service.priceCents ? Math.round(price * 100) : Math.round(price);
}

function serviceMarginCents(service = {}) {
  const price = servicePriceCents(service);
  const cost = positive(service.totalCostCents || service.costCents || service.estimatedCostCents || service.estimatedProductCostCents || service.productCostCents || service.technologyCostCents || 0);
  if (!price || cost <= 0) return null;
  return Math.max(0, price - cost);
}

function inferAmountCents(item = {}) {
  const raw = item.amountCents || item.totalCents || item.priceCents || item.amount || item.total || 0;
  const numeric = Number(raw || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 0 && numeric < 10000 && !item.amountCents && !item.totalCents && !item.priceCents ? Math.round(numeric * 100) : Math.round(numeric);
}

function sortByDateAsc(items = [], selector = (item) => item?.createdAt) {
  return [...items].sort((a, b) => timestamp(selector(a)) - timestamp(selector(b)));
}

function latestByDate(items = [], selector = (item) => item?.createdAt) {
  return sortByDateAsc(items, selector).slice(-1)[0] || null;
}

function computeVisitGaps(appointments = []) {
  const sorted = sortByDateAsc(appointments.filter((item) => !isCancelledAppointment(item)), appointmentDate);
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = daysBetween(appointmentDate(sorted[index - 1]), appointmentDate(sorted[index]));
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  return gaps;
}

function expectedRoutineDays(appointments = [], servicesById = new Map()) {
  const gaps = computeVisitGaps(appointments);
  if (gaps.length >= 2) return Math.max(14, Math.min(120, Math.round(average(gaps, 45))));
  const last = latestByDate(appointments, appointmentDate);
  const serviceId = serviceIdsForAppointment(last || {})[0] || "";
  const serviceName = normalizeText(servicesById.get(serviceId)?.name || last?.serviceName || "");
  if (/colore|ricresc|piega|taglio|barba|styling/.test(serviceName)) return 35;
  if (/viso|trattamento|cute|o3|laser|plasma|radiofrequ|corpo/.test(serviceName)) return 45;
  return 45;
}

function computeClientStats(client = {}, context = {}) {
  const clientId = String(client.id || client.clientId || "");
  const nowDate = context.now || context.horizon?.endDate || new Date().toISOString();
  const servicesById = context.servicesById || new Map();
  const appointments = (context.appointmentsByClientId?.get(clientId) || []).filter((item) => !isCancelledAppointment(item));
  const payments = context.paymentsByClientId?.get(clientId) || [];
  const marketing = context.marketingByClientId?.get(clientId) || [];
  const lastAppointment = latestByDate(appointments, appointmentDate);
  const lastMarketing = latestByDate(marketing, marketingDate);
  const routineDays = expectedRoutineDays(appointments, servicesById);
  const daysSinceLastVisit = lastAppointment ? daysBetween(appointmentDate(lastAppointment), nowDate) : null;
  const daysSinceLastContact = lastMarketing ? daysBetween(marketingDate(lastMarketing), nowDate) : null;
  const visitGaps = computeVisitGaps(appointments);
  const totalRevenueCents = payments.reduce((sum, item) => sum + inferAmountCents(item), 0)
    || appointments.reduce((sum, item) => sum + inferAmountCents(item), 0)
    || positive(client.totalValueCents || (Number(client.totalValue || 0) * 100));
  const averageTicketCents = payments.length ? Math.round(totalRevenueCents / Math.max(1, payments.length)) : 0;
  const serviceIds = new Set();
  let marginCents = 0;
  let marginAvailable = false;
  appointments.forEach((appointment) => {
    serviceIdsForAppointment(appointment).forEach((serviceId) => {
      serviceIds.add(serviceId);
      const margin = serviceMarginCents(servicesById.get(serviceId));
      if (margin !== null) {
        marginAvailable = true;
        marginCents += margin;
      }
    });
  });
  return {
    clientId,
    appointments,
    payments,
    marketing,
    lastAppointment,
    lastMarketing,
    routineDays,
    daysSinceLastVisit,
    daysSinceLastContact,
    visitGaps,
    totalRevenueCents,
    averageTicketCents,
    serviceDepth: serviceIds.size,
    marginCents: marginAvailable ? marginCents : null,
    hasHistory: appointments.length > 0 || payments.length > 0,
    hasContactHistory: marketing.length > 0
  };
}

function buildContext(input = {}) {
  const horizon = input.horizon || {};
  const clients = activeOnly(input.clients);
  const appointmentsAll = Array.isArray(input.appointments) ? input.appointments : [];
  const paymentsAll = Array.isArray(input.payments) ? input.payments : [];
  const marketingAll = Array.isArray(input.marketingHistory || input.marketingActions || input.communications)
    ? (input.marketingHistory || input.marketingActions || input.communications)
    : [];
  const appointments = filterByHorizon(appointmentsAll, horizon, appointmentDate);
  const payments = filterByHorizon(paymentsAll, horizon, paymentDate);
  const marketing = filterByHorizon(marketingAll, horizon, marketingDate);
  const services = Array.isArray(input.services) ? input.services : [];
  const servicesById = mapById(services);
  const appointmentsByClientId = groupByClientId(appointmentsAll);
  const paymentsByClientId = groupByClientId(paymentsAll);
  const marketingByClientId = groupByClientId(marketingAll);
  const clientStats = clients.map((client) => computeClientStats(client, {
    horizon,
    now: input.now || horizon.endDate || new Date().toISOString(),
    servicesById,
    appointmentsByClientId,
    paymentsByClientId,
    marketingByClientId
  }));
  const maxRevenueCents = Math.max(1, ...clientStats.map((stat) => stat.totalRevenueCents));
  const maxMarginCents = Math.max(1, ...clientStats.map((stat) => positive(stat.marginCents || 0)));
  const maxVisits = Math.max(1, ...clientStats.map((stat) => stat.appointments.length));
  const maxDepth = Math.max(1, ...clientStats.map((stat) => stat.serviceDepth));
  return {
    horizon,
    now: input.now || horizon.endDate || new Date().toISOString(),
    clients,
    appointments,
    payments,
    marketing,
    services,
    servicesById,
    appointmentsByClientId,
    paymentsByClientId,
    marketingByClientId,
    clientStatsById: new Map(clientStats.map((stat) => [stat.clientId, stat])),
    maxRevenueCents,
    maxMarginCents,
    maxVisits,
    maxDepth,
    goal: input.goal || {},
    schedule: input.schedule || {},
    sourceFlags: []
  };
}

function computeCustomerValue(client = {}, context = buildContext({})) {
  const stat = context.clientStatsById?.get(String(client.id || client.clientId || "")) || computeClientStats(client, context);
  const revenue = scoreRatio(stat.totalRevenueCents, context.maxRevenueCents, 0);
  const marginAvailable = stat.marginCents !== null && context.maxMarginCents > 1;
  const margin = marginAvailable ? scoreRatio(stat.marginCents, context.maxMarginCents, 0) : null;
  const frequency = scoreRatio(stat.appointments.length, context.maxVisits, 0);
  const recencyPosition = stat.daysSinceLastVisit === null
    ? 0
    : clamp01(1 - (Math.abs(Number(stat.daysSinceLastVisit || 0) - stat.routineDays) / Math.max(1, stat.routineDays * 2)));
  const depth = scoreRatio(stat.serviceDepth, context.maxDepth, 0);
  const score = marginAvailable
    ? (CUSTOMER_VALUE_WEIGHTS.revenue * revenue)
      + (CUSTOMER_VALUE_WEIGHTS.margin * margin)
      + (CUSTOMER_VALUE_WEIGHTS.frequency * frequency)
      + (CUSTOMER_VALUE_WEIGHTS.recencyPosition * recencyPosition)
      + (CUSTOMER_VALUE_WEIGHTS.depth * depth)
    : (CUSTOMER_VALUE_WEIGHTS_NO_MARGIN.revenue * revenue)
      + (CUSTOMER_VALUE_WEIGHTS_NO_MARGIN.frequency * frequency)
      + (CUSTOMER_VALUE_WEIGHTS_NO_MARGIN.recencyPosition * recencyPosition)
      + (CUSTOMER_VALUE_WEIGHTS_NO_MARGIN.depth * depth);
  return {
    score: round(score),
    components: { revenue: round(revenue), margin: margin === null ? null : round(margin), frequency: round(frequency), recencyPosition: round(recencyPosition), depth: round(depth) },
    sourceFlags: marginAvailable ? [] : ["marketing_core:margin_unavailable_weight_redistributed"]
  };
}

function computeChurnRisk(client = {}, context = buildContext({})) {
  const stat = context.clientStatsById?.get(String(client.id || client.clientId || "")) || computeClientStats(client, context);
  const days = Number(stat.daysSinceLastVisit ?? stat.routineDays * 3);
  const routine = Math.max(1, Number(stat.routineDays || 45));
  const gap = clamp01(Math.max(0, days - routine) / routine);
  const gaps = stat.visitGaps;
  const avgGap = average(gaps, routine);
  const recentGap = gaps.length ? gaps[gaps.length - 1] : avgGap;
  const drop = clamp01(Math.max(0, recentGap - avgGap) / Math.max(1, avgGap));
  const volatility = gaps.length >= 2 ? clamp01((Math.max(...gaps) - Math.min(...gaps)) / Math.max(1, avgGap * 2)) : 0.35;
  const weakRelation = stat.appointments.length <= 1 ? 1 : stat.appointments.length <= 3 ? 0.55 : 0.15;
  const lost = days > 180 ? 1 : days > routine * 3 ? 0.85 : days > routine * 2 ? 0.55 : 0;
  const score = (CHURN_RISK_WEIGHTS.gap * gap)
    + (CHURN_RISK_WEIGHTS.drop * drop)
    + (CHURN_RISK_WEIGHTS.volatility * volatility)
    + (CHURN_RISK_WEIGHTS.weakRelation * weakRelation)
    + (CHURN_RISK_WEIGHTS.lost * lost);
  return {
    score: round(score),
    components: { gap: round(gap), drop: round(drop), volatility: round(volatility), weakRelation: round(weakRelation), lost: round(lost) }
  };
}

function computeHabitStrength(client = {}, context = buildContext({})) {
  const stat = context.clientStatsById?.get(String(client.id || client.clientId || "")) || computeClientStats(client, context);
  const gaps = stat.visitGaps;
  const avgGap = average(gaps, stat.routineDays);
  const spread = gaps.length >= 2 ? Math.max(...gaps) - Math.min(...gaps) : avgGap;
  const habit = scoreRatio(Math.min(stat.appointments.length, 6), 6, 0);
  const consistency = gaps.length >= 2 ? clamp01(1 - (spread / Math.max(1, avgGap * 2))) : (stat.appointments.length > 1 ? 0.45 : 0);
  const serviceRhythm = stat.serviceDepth > 0 && stat.appointments.length > 1 ? clamp01(1 - Math.min(1, stat.serviceDepth / Math.max(1, stat.appointments.length + 1))) : 0.25;
  const score = (HABIT_WEIGHTS.habit * habit)
    + (HABIT_WEIGHTS.consistency * consistency)
    + (HABIT_WEIGHTS.serviceRhythm * serviceRhythm);
  return {
    score: round(score),
    components: { habit: round(habit), consistency: round(consistency), serviceRhythm: round(serviceRhythm) }
  };
}

function computeTimingOpportunity(client = {}, context = buildContext({})) {
  const stat = context.clientStatsById?.get(String(client.id || client.clientId || "")) || computeClientStats(client, context);
  const days = Number(stat.daysSinceLastVisit ?? 0);
  const routine = Math.max(1, Number(stat.routineDays || 45));
  const delta = days - routine;
  const window = delta < 0
    ? clamp01(1 - Math.abs(delta) / routine)
    : delta <= routine * 0.75
      ? 1
      : delta <= routine * 1.5
        ? 0.8
        : delta <= routine * 3
          ? 0.5
          : 0.25;
  const urgency = clamp01(Math.max(0, delta) / routine);
  const season = clamp01(context.goal?.seasonFit ?? context.campaign?.seasonFit ?? 0.5);
  const scheduleGap = clamp01(context.schedule?.gapFit ?? context.agendaGapFit ?? 0);
  const score = (TIMING_WEIGHTS.window * window)
    + (TIMING_WEIGHTS.urgency * urgency)
    + (TIMING_WEIGHTS.season * season)
    + (TIMING_WEIGHTS.scheduleGap * scheduleGap);
  return {
    score: round(score),
    components: { window: round(window), urgency: round(urgency), season: round(season), scheduleGap: round(scheduleGap) }
  };
}

function computeContactability(client = {}, context = buildContext({})) {
  const stat = context.clientStatsById?.get(String(client.id || client.clientId || "")) || computeClientStats(client, context);
  const hasConsentField = Object.prototype.hasOwnProperty.call(client, "marketingConsent");
  const consent = client.marketingConsent === false ? 0 : client.marketingConsent === true ? 1 : 0.5;
  const hasPhone = validPhone(client.phone || client.mobile || client.whatsapp);
  const hasEmail = validEmail(client.email);
  const channel = hasPhone && hasEmail ? 1 : hasPhone || hasEmail ? 0.75 : 0;
  const quality = (hasPhone ? 0.55 : 0) + (hasEmail ? 0.45 : 0);
  const reach = hasPhone ? 1 : hasEmail ? 0.65 : 0;
  const latest = stat.marketing.slice().sort((a, b) => timestamp(marketingDate(b)) - timestamp(marketingDate(a)))[0] || null;
  const status = normalizeText(latest?.status || latest?.outcome || "");
  const history = !latest ? 0.6 : ["done", "converted", "replied", "risposto", "prenotato"].includes(status) ? 1 : ["failed", "bounced", "blocked"].includes(status) ? 0.15 : 0.55;
  const score = (CONTACTABILITY_WEIGHTS.consent * consent)
    + (CONTACTABILITY_WEIGHTS.channel * channel)
    + (CONTACTABILITY_WEIGHTS.quality * quality)
    + (CONTACTABILITY_WEIGHTS.reach * reach)
    + (CONTACTABILITY_WEIGHTS.history * history);
  return {
    score: round(score),
    components: { consent: round(consent), channel: round(channel), quality: round(quality), reach: round(reach), history: round(history) },
    sourceFlags: hasConsentField ? [] : ["marketing_core:consent_missing_assumed_partial"]
  };
}

function computeSpamPressure(client = {}, context = buildContext({})) {
  const stat = context.clientStatsById?.get(String(client.id || client.clientId || "")) || computeClientStats(client, context);
  const days = stat.daysSinceLastContact;
  const recent = days === null ? 0 : days < 3 ? 1 : days < 7 ? 0.65 : days < 14 ? 0.35 : 0;
  const last30 = stat.marketing.filter((entry) => {
    const age = daysBetween(marketingDate(entry), context.now);
    return Number.isFinite(age) && age <= 30;
  }).length;
  const frequency = clamp01(last30 / 4);
  const ignoredCount = stat.marketing.filter((entry) => ["ignored", "no_reply", "failed", "bounced"].includes(normalizeText(entry.status || entry.outcome || ""))).length;
  const ignored = scoreRatio(ignoredCount, Math.max(1, stat.marketing.length), 0);
  const fatigue = clamp01((recent + frequency + ignored) / 3);
  const score = (SPAM_PRESSURE_WEIGHTS.recent * recent)
    + (SPAM_PRESSURE_WEIGHTS.frequency * frequency)
    + (SPAM_PRESSURE_WEIGHTS.ignored * ignored)
    + (SPAM_PRESSURE_WEIGHTS.fatigue * fatigue);
  return {
    score: round(score),
    components: { recent: round(recent), frequency: round(frequency), ignored: round(ignored), fatigue: round(fatigue) }
  };
}

function computeGoalFit(client = {}, context = buildContext({})) {
  const stat = context.clientStatsById?.get(String(client.id || client.clientId || "")) || computeClientStats(client, context);
  const goalType = normalizeText(context.goal?.type || context.campaign?.type || "recall");
  const lastAppointment = stat.lastAppointment || {};
  const lastServiceName = normalizeText(lastAppointment.serviceName || context.servicesById?.get(serviceIdsForAppointment(lastAppointment)[0] || "")?.name || "");
  const goal = goalType.includes("recall") || goalType.includes("marketing") ? 0.8 : 0.6;
  const serviceKeywords = normalizeText(context.goal?.serviceKeywords || context.goal?.service || "");
  const serviceFit = serviceKeywords ? (lastServiceName.includes(serviceKeywords) ? 1 : 0.35) : (lastServiceName ? 0.75 : 0.4);
  const valueFit = computeCustomerValue(client, context).components.revenue;
  const reactivationFit = computeChurnRisk(client, context).components.lost || computeChurnRisk(client, context).components.gap;
  const score = (GOAL_FIT_WEIGHTS.goal * goal)
    + (GOAL_FIT_WEIGHTS.service * serviceFit)
    + (GOAL_FIT_WEIGHTS.value * valueFit)
    + (GOAL_FIT_WEIGHTS.reactivation * reactivationFit);
  return {
    score: round(score),
    components: { goal: round(goal), serviceFit: round(serviceFit), valueFit: round(valueFit), reactivationFit: round(reactivationFit) }
  };
}

function computeMarketingDataQuality(client = {}, context = buildContext({})) {
  const stat = context.clientStatsById?.get(String(client.id || client.clientId || "")) || computeClientStats(client, context);
  const hasName = normalizeText(clientName(client)) ? 1 : 0;
  const hasContact = validPhone(client.phone || client.mobile || client.whatsapp) || validEmail(client.email) ? 1 : 0;
  const crm = ((client.id ? 1 : 0) + hasName + hasContact) / 3;
  const paymentLink = stat.payments.length ? 1 : stat.appointments.length ? 0.45 : 0;
  const appointmentHistory = stat.appointments.length >= 2 ? 1 : stat.appointments.length === 1 ? 0.55 : 0;
  const contactData = hasContact;
  const score = (DATA_QUALITY_WEIGHTS.crm * crm)
    + (DATA_QUALITY_WEIGHTS.paymentLink * paymentLink)
    + (DATA_QUALITY_WEIGHTS.appointmentHistory * appointmentHistory)
    + (DATA_QUALITY_WEIGHTS.contactData * contactData);
  return {
    score: round(score),
    components: { crm: round(crm), paymentLink: round(paymentLink), appointmentHistory: round(appointmentHistory), contactData: round(contactData) }
  };
}

function computeMarketingOpportunity(input = {}) {
  const value = clamp01(input.value);
  const churnRisk = clamp01(input.churnRisk);
  const frequency = clamp01(input.frequency);
  const timingOpportunity = clamp01(input.timingOpportunity);
  const contactability = clamp01(input.contactability);
  const goalFit = clamp01(input.goalFit);
  const spamPressure = clamp01(input.spamPressure);
  const score = (OPPORTUNITY_WEIGHTS.value * value)
    + (OPPORTUNITY_WEIGHTS.churnRisk * churnRisk)
    + (OPPORTUNITY_WEIGHTS.frequency * frequency)
    + (OPPORTUNITY_WEIGHTS.timing * timingOpportunity)
    + (OPPORTUNITY_WEIGHTS.contactability * contactability)
    + (OPPORTUNITY_WEIGHTS.goalFit * goalFit)
    - (OPPORTUNITY_WEIGHTS.spamPressure * spamPressure);
  return round(clamp01(score));
}

function inferMarketingActionBand(input = {}) {
  const opportunityScore = clamp01(input.opportunityScore);
  const contactability = clamp01(input.contactability);
  const spamPressure = clamp01(input.spamPressure);
  const dataQuality = clamp01(input.dataQuality);
  const timingOpportunity = clamp01(input.timingOpportunity);
  const consent = clamp01(input.contactabilityComponents?.consent ?? input.consent ?? contactability);
  const reasonCodes = [];
  if (consent < MARKETING_THRESHOLDS.minConsent) reasonCodes.push("NO_VALID_CONSENT");
  if (contactability < MARKETING_THRESHOLDS.minContactability) reasonCodes.push("CONTACT_DATA_TOO_WEAK");
  if (spamPressure > MARKETING_THRESHOLDS.maxSpamPressure) reasonCodes.push("SPAM_PRESSURE_TOO_HIGH");
  if (dataQuality < MARKETING_THRESHOLDS.minDataQuality) reasonCodes.push("DATA_QUALITY_TOO_LOW");
  if (timingOpportunity < MARKETING_THRESHOLDS.weakTiming) reasonCodes.push("TIMING_NOT_READY");
  if (opportunityScore < MARKETING_THRESHOLDS.monitorOpportunity && input.churnRisk < 0.35 && input.value < 0.35) reasonCodes.push("LOW_VALUE_LOW_RISK");
  if (timingOpportunity >= 0.60) reasonCodes.push("RECALL_WINDOW_OPEN");
  if (input.churnRisk >= 0.60 && contactability >= 0.60) reasonCodes.push("REACTIVATION_OPPORTUNITY");

  if (reasonCodes.includes("NO_VALID_CONSENT") || reasonCodes.includes("SPAM_PRESSURE_TOO_HIGH")) {
    return { actionBand: MARKETING_ACTION_BAND.STOP, reasonCodes };
  }
  if (reasonCodes.includes("CONTACT_DATA_TOO_WEAK") || reasonCodes.includes("DATA_QUALITY_TOO_LOW")) {
    return { actionBand: MARKETING_ACTION_BAND.VERIFY, reasonCodes };
  }
  if (
    opportunityScore >= MARKETING_THRESHOLDS.actNowOpportunity
    && contactability >= MARKETING_THRESHOLDS.actNowContactability
    && spamPressure <= MARKETING_THRESHOLDS.actNowMaxSpamPressure
    && dataQuality >= MARKETING_THRESHOLDS.actNowDataQuality
  ) {
    return { actionBand: MARKETING_ACTION_BAND.ACT_NOW, reasonCodes };
  }
  if (opportunityScore >= MARKETING_THRESHOLDS.suggestOpportunity) {
    return { actionBand: MARKETING_ACTION_BAND.SUGGEST, reasonCodes };
  }
  if (opportunityScore >= MARKETING_THRESHOLDS.monitorOpportunity) {
    return { actionBand: MARKETING_ACTION_BAND.MONITOR, reasonCodes };
  }
  return { actionBand: MARKETING_ACTION_BAND.MONITOR, reasonCodes };
}

function computeMarketingReadiness(rows = [], input = {}) {
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const consentCoverage = scoreRatio(clients.filter((client) => client.marketingConsent === true).length, Math.max(1, clients.length), 0);
  const contactCoverage = scoreRatio(clients.filter((client) => validPhone(client.phone || client.mobile || client.whatsapp) || validEmail(client.email)).length, Math.max(1, clients.length), 0);
  const historyCoverage = scoreRatio(rows.filter((row) => row.dataQuality >= 0.55).length, Math.max(1, rows.length), 0);
  const meanDataQuality = average(rows.map((row) => row.dataQuality), 0);
  const score = (READINESS_WEIGHTS.meanDataQuality * meanDataQuality)
    + (READINESS_WEIGHTS.consentCoverage * consentCoverage)
    + (READINESS_WEIGHTS.contactCoverage * contactCoverage)
    + (READINESS_WEIGHTS.historyCoverage * historyCoverage);
  return {
    score: round(score),
    components: { meanDataQuality: round(meanDataQuality), consentCoverage: round(consentCoverage), contactCoverage: round(contactCoverage), historyCoverage: round(historyCoverage) }
  };
}

function evaluateCustomerMarketing(client = {}, context = buildContext({})) {
  const valueResult = computeCustomerValue(client, context);
  const churnRiskResult = computeChurnRisk(client, context);
  const habitResult = computeHabitStrength(client, context);
  const timingResult = computeTimingOpportunity(client, context);
  const contactabilityResult = computeContactability(client, context);
  const spamPressureResult = computeSpamPressure(client, context);
  const goalFitResult = computeGoalFit(client, context);
  const dataQualityResult = computeMarketingDataQuality(client, context);
  const opportunityScore = computeMarketingOpportunity({
    value: valueResult.score,
    churnRisk: churnRiskResult.score,
    frequency: habitResult.score,
    timingOpportunity: timingResult.score,
    contactability: contactabilityResult.score,
    goalFit: goalFitResult.score,
    spamPressure: spamPressureResult.score
  });
  const band = inferMarketingActionBand({
    opportunityScore,
    value: valueResult.score,
    churnRisk: churnRiskResult.score,
    timingOpportunity: timingResult.score,
    contactability: contactabilityResult.score,
    spamPressure: spamPressureResult.score,
    dataQuality: dataQualityResult.score,
    contactabilityComponents: contactabilityResult.components
  });
  const sourceFlags = [
    ...valueResult.sourceFlags,
    ...contactabilityResult.sourceFlags
  ];
  return {
    clientId: String(client.id || client.clientId || ""),
    clientName: clientName(client) || "Cliente",
    value: valueResult.score,
    churnRisk: churnRiskResult.score,
    frequency: habitResult.score,
    timingOpportunity: timingResult.score,
    contactability: contactabilityResult.score,
    spamPressure: spamPressureResult.score,
    goalFit: goalFitResult.score,
    dataQuality: dataQualityResult.score,
    opportunityScore,
    actionBand: band.actionBand,
    reasonCodes: band.reasonCodes,
    sourceFlags,
    breakdown: {
      value: valueResult.components,
      churnRisk: churnRiskResult.components,
      frequency: habitResult.components,
      timing: timingResult.components,
      contactability: contactabilityResult.components,
      spamPressure: spamPressureResult.components,
      goalFit: goalFitResult.components,
      dataQuality: dataQualityResult.components
    }
  };
}

function computeMarketingSnapshot(input = {}) {
  const context = buildContext(input);
  const rows = context.clients.map((client) => evaluateCustomerMarketing(client, context))
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.churnRisk - a.churnRisk || b.value - a.value);
  const readiness = computeMarketingReadiness(rows, { clients: context.clients });
  const suppressed = rows.filter((row) => [MARKETING_ACTION_BAND.STOP, MARKETING_ACTION_BAND.VERIFY].includes(row.actionBand));
  const contactable = rows.filter((row) => row.contactability >= MARKETING_THRESHOLDS.minContactability && !row.reasonCodes.includes("NO_VALID_CONSENT"));
  const actionable = rows.filter((row) => [MARKETING_ACTION_BAND.ACT_NOW, MARKETING_ACTION_BAND.SUGGEST].includes(row.actionBand));
  const reactivation = rows.filter((row) => row.reasonCodes.includes("REACTIVATION_OPPORTUNITY"));
  const retention = rows.filter((row) => row.reasonCodes.includes("RECALL_WINDOW_OPEN") && !row.reasonCodes.includes("REACTIVATION_OPPORTUNITY"));
  const upsell = rows.filter((row) => row.value >= 0.65 && row.goalFit >= 0.55);
  const monitor = rows.filter((row) => row.actionBand === MARKETING_ACTION_BAND.MONITOR);
  const sourceFlags = new Set([
    ...context.sourceFlags,
    ...rows.flatMap((row) => row.sourceFlags || [])
  ]);
  if (!context.marketing.length) sourceFlags.add("marketing_core:marketing_history_missing_or_empty");
  if (!context.schedule || !Object.keys(context.schedule).length) sourceFlags.add("marketing_core:schedule_gap_not_available");

  return {
    mathCore: MARKETING_CORE_VERSION,
    horizon: context.horizon,
    counts: {
      clients: context.clients.length,
      eligibleClients: actionable.length,
      contactableClients: contactable.length,
      suppressedClients: suppressed.length
    },
    scores: {
      marketingReadiness: readiness.score,
      averageOpportunity: round(average(rows.map((row) => row.opportunityScore), 0)),
      averageChurnRisk: round(average(rows.map((row) => row.churnRisk), 0)),
      averageContactability: round(average(rows.map((row) => row.contactability), 0)),
      averageSpamPressure: round(average(rows.map((row) => row.spamPressure), 0))
    },
    sourceFlags: Array.from(sourceFlags),
    topCandidates: rows.slice(0, input.limit || 20).map((row) => ({
      clientId: row.clientId,
      clientName: row.clientName,
      value: row.value,
      churnRisk: row.churnRisk,
      frequency: row.frequency,
      timingOpportunity: row.timingOpportunity,
      contactability: row.contactability,
      spamPressure: row.spamPressure,
      goalFit: row.goalFit,
      dataQuality: row.dataQuality,
      opportunityScore: row.opportunityScore,
      actionBand: row.actionBand,
      reasonCodes: row.reasonCodes,
      sourceFlags: row.sourceFlags
    })),
    breakdown: {
      suppressed,
      reactivation,
      retention,
      upsell,
      monitor
    },
    diagnostics: {
      weights: {
        customerValue: CUSTOMER_VALUE_WEIGHTS,
        customerValueNoMargin: CUSTOMER_VALUE_WEIGHTS_NO_MARGIN,
        churnRisk: CHURN_RISK_WEIGHTS,
        habit: HABIT_WEIGHTS,
        timing: TIMING_WEIGHTS,
        contactability: CONTACTABILITY_WEIGHTS,
        spamPressure: SPAM_PRESSURE_WEIGHTS,
        goalFit: GOAL_FIT_WEIGHTS,
        dataQuality: DATA_QUALITY_WEIGHTS,
        opportunity: OPPORTUNITY_WEIGHTS,
        readiness: READINESS_WEIGHTS
      },
      thresholds: MARKETING_THRESHOLDS,
      readinessBreakdown: readiness.components
    }
  };
}

module.exports = {
  MARKETING_CORE_VERSION,
  MARKETING_ACTION_BAND,
  MARKETING_THRESHOLDS,
  CUSTOMER_VALUE_WEIGHTS,
  CUSTOMER_VALUE_WEIGHTS_NO_MARGIN,
  CHURN_RISK_WEIGHTS,
  HABIT_WEIGHTS,
  TIMING_WEIGHTS,
  CONTACTABILITY_WEIGHTS,
  SPAM_PRESSURE_WEIGHTS,
  GOAL_FIT_WEIGHTS,
  DATA_QUALITY_WEIGHTS,
  OPPORTUNITY_WEIGHTS,
  READINESS_WEIGHTS,
  computeCustomerValue,
  computeChurnRisk,
  computeHabitStrength,
  computeTimingOpportunity,
  computeContactability,
  computeSpamPressure,
  computeGoalFit,
  computeMarketingDataQuality,
  computeMarketingOpportunity,
  inferMarketingActionBand,
  computeMarketingReadiness,
  computeMarketingSnapshot,
  evaluateCustomerMarketing
};
