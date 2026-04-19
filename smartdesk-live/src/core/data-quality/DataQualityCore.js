const DATA_QUALITY_BAND = Object.freeze({
  REAL: "REAL",
  STANDARD: "STANDARD",
  ESTIMATED: "ESTIMATED",
  INCOMPLETE: "INCOMPLETE"
});

const CLIENT_WEIGHTS = Object.freeze({ email: 0.20, phone: 0.20, name: 0.20, unique: 0.20, notDuplicate: 0.20 });
const APPOINTMENT_WEIGHTS = Object.freeze({ datetime: 0.20, service: 0.25, customer: 0.20, status: 0.20, revenue: 0.15 });
const PAYMENT_WEIGHTS = Object.freeze({ amount: 0.20, date: 0.15, strongLink: 0.30, notUnlinked: 0.20, method: 0.15 });
const COST_WEIGHTS = Object.freeze({ labor: 0.25, products: 0.20, technologies: 0.15, price: 0.15, profitability: 0.25 });
const LINK_WEIGHTS = Object.freeze({ appointmentCustomer: 0.15, appointmentService: 0.15, paymentAppointment: 0.25, paymentCustomer: 0.20, serviceProduct: 0.15, serviceTechnology: 0.10 });
const TEMPORAL_WEIGHTS = Object.freeze({ order: 0.40, coverage: 0.35, recency: 0.25 });
const GLOBAL_WEIGHTS = Object.freeze({ crm: 0.15, appointment: 0.15, payment: 0.20, cost: 0.20, link: 0.10, consistency: 0.10, temporal: 0.10 });

// Centralized thresholds for data_quality_core_v1. Keep explicit for auditability.
const DATA_QUALITY_THRESHOLDS = Object.freeze({
  realScore: 0.90,
  realMinPayment: 0.85,
  realMinLink: 0.80,
  standardScore: 0.75,
  standardMinPayment: 0.70,
  estimatedScore: 0.50,
  gateAiGoldScore: 0.75,
  gateAiGoldPayment: 0.70,
  gateAiGoldAppointment: 0.70,
  gateDecisionScore: 0.80,
  gateDecisionConsistency: 0.70,
  gateCost: 0.75,
  gateCashPayment: 0.75,
  gateCashLink: 0.75,
  gateMarketingCrm: 0.75,
  gateMarketingTemporal: 0.60,
  gateReportScore: 0.70
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

function ratio(numerator = 0, denominator = 0) {
  const den = Number(denominator || 0);
  if (!den) return null;
  return Number(numerator || 0) / den;
}

function scoreRatio(numerator = 0, denominator = 0, emptyScore = 0) {
  const value = ratio(numerator, denominator);
  return value === null ? emptyScore : clamp01(value);
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
  const phone = normalizePhone(value);
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7;
}

function toDateOnly(value = "") {
  return String(value || "").slice(0, 10);
}

function timestamp(value = "") {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function inHorizon(value = "", horizon = {}) {
  const date = toDateOnly(value || "");
  if (!date) return false;
  if (horizon.startDate && date < horizon.startDate) return false;
  if (horizon.endDate && date > horizon.endDate) return false;
  return true;
}

function filterByHorizon(items = [], horizon = {}, dateFields = []) {
  if (!horizon?.startDate && !horizon?.endDate) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((item) => {
    const value = dateFields.map((field) => item?.[field]).find(Boolean);
    return inHorizon(value, horizon);
  });
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function serviceIdsForAppointment(appointment = {}) {
  const ids = Array.isArray(appointment.serviceIds)
    ? appointment.serviceIds
    : (appointment.serviceId ? [appointment.serviceId] : []);
  return ids.map((id) => String(id || "")).filter(Boolean);
}

function appointmentDate(appointment = {}) {
  return appointment.startAt || appointment.date || appointment.createdAt || "";
}

function paymentDate(payment = {}) {
  return payment.createdAt || payment.paidAt || payment.date || "";
}

function activeOnly(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.active !== false && item?.active !== 0);
}

function clientName(client = {}) {
  return `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "";
}

function isCancelledAppointment(appointment = {}) {
  return ["cancelled", "canceled", "no_show"].includes(normalizeText(appointment.status || appointment.day || ""));
}

function servicePriceCents(service = {}) {
  return positive(service.priceCents || (Number(service.price || 0) > 0 && Number(service.price || 0) < 10000 ? Number(service.price || 0) * 100 : service.price));
}

function serviceCostFallbackCents(service = {}) {
  return positive(
    service.estimatedProductCostCents
    || service.productCostCents
    || service.inventoryCostAverage
    || service.technologyCostCents
    || service.costCents
    || 0
  );
}

function productLinkUsable(link = {}, productsById = new Map()) {
  const product = productsById.get(String(link.productId || link.id || ""));
  const usage = Number(link.usageUnits || link.quantityUsage || link.quantity || 0);
  const cost = Number(link.costPerUseCents || link.unitCostCents || product?.costPerUseCents || product?.unitCostCents || product?.costCents || 0);
  return usage > 0 && cost > 0;
}

function technologyLinkUsable(link = {}, resourcesById = new Map()) {
  const technology = resourcesById.get(String(link.technologyId || link.resourceId || link.id || ""));
  const usage = Number(link.usageUnits || link.quantityUsage || link.quantity || 1);
  const cost = Number(link.costPerUseCents || technology?.costPerUseCents || 0);
  return usage > 0 && cost > 0;
}

function buildDuplicateIndex(clients = []) {
  const byEmail = new Map();
  const byPhone = new Map();
  const byName = new Map();
  clients.forEach((client) => {
    const email = validEmail(client.email) ? normalizeText(client.email) : "";
    const phone = validPhone(client.phone) ? normalizePhone(client.phone) : "";
    const name = normalizeText(clientName(client));
    if (email) byEmail.set(email, (byEmail.get(email) || 0) + 1);
    if (phone) byPhone.set(phone, (byPhone.get(phone) || 0) + 1);
    if (name) byName.set(name, (byName.get(name) || 0) + 1);
  });
  return { byEmail, byPhone, byName };
}

function inferClientUnique(client = {}) {
  return Boolean(client.id || validEmail(client.email) || validPhone(client.phone) || normalizeText(clientName(client)));
}

function isDuplicateCandidate(client = {}, index = {}) {
  const email = validEmail(client.email) ? normalizeText(client.email) : "";
  const phone = validPhone(client.phone) ? normalizePhone(client.phone) : "";
  const name = normalizeText(clientName(client));
  return Boolean(
    (email && Number(index.byEmail?.get(email) || 0) > 1)
    || (phone && Number(index.byPhone?.get(phone) || 0) > 1)
    || (name && !email && !phone && Number(index.byName?.get(name) || 0) > 1)
  );
}

function computeCRMQuality(input = {}) {
  const clients = activeOnly(input.clients);
  const duplicateIndex = buildDuplicateIndex(clients);
  const rows = clients.map((client) => {
    const email = validEmail(client.email) ? 1 : 0;
    const phone = validPhone(client.phone) ? 1 : 0;
    const name = normalizeText(clientName(client)) ? 1 : 0;
    const unique = inferClientUnique(client) ? 1 : 0;
    const notDuplicate = isDuplicateCandidate(client, duplicateIndex) ? 0 : 1;
    const score = (CLIENT_WEIGHTS.email * email)
      + (CLIENT_WEIGHTS.phone * phone)
      + (CLIENT_WEIGHTS.name * name)
      + (CLIENT_WEIGHTS.unique * unique)
      + (CLIENT_WEIGHTS.notDuplicate * notDuplicate);
    return {
      id: client.id || "",
      name: clientName(client) || "Cliente",
      score: round(score),
      indicators: { email, phone, name, unique, notDuplicate }
    };
  });
  const score = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
  return {
    score: round(score),
    total: clients.length,
    weakCount: rows.filter((row) => row.score < 0.75).length,
    rows: rows.slice(0, 25)
  };
}

function computeAppointmentQuality(input = {}) {
  const servicesById = mapById(input.services);
  const clientsById = mapById(input.clients);
  const allowedStatuses = new Set(["requested", "booked", "scheduled", "confirmed", "arrived", "in_progress", "completed", "cancelled", "canceled", "no_show", "done"]);
  const appointments = filterByHorizon(input.appointments, input.horizon, ["startAt", "date", "createdAt"]);
  const rows = appointments.map((appointment) => {
    const start = timestamp(appointment.startAt || appointment.date || appointment.createdAt);
    const end = timestamp(appointment.endAt || "");
    const datetime = start > 0 && (!end || end >= start) ? 1 : 0;
    const ids = serviceIdsForAppointment(appointment);
    const service = ids.length
      ? (ids.every((id) => servicesById.has(String(id))) ? 1 : 0)
      : (cleanText(appointment.serviceName || appointment.service || "") ? 0.5 : 0);
    const customer = appointment.clientId && clientsById.has(String(appointment.clientId))
      ? 1
      : (cleanText(appointment.walkInName || appointment.clientName || appointment.client || "") ? 0.6 : 0);
    const statusText = normalizeText(appointment.status || appointment.day || "scheduled");
    const status = allowedStatuses.has(statusText) ? 1 : 0;
    const revenue = positive(appointment.amountCents || appointment.priceCents || appointment.dueCents || 0) >= 0 ? 1 : 0;
    const score = (APPOINTMENT_WEIGHTS.datetime * datetime)
      + (APPOINTMENT_WEIGHTS.service * service)
      + (APPOINTMENT_WEIGHTS.customer * customer)
      + (APPOINTMENT_WEIGHTS.status * status)
      + (APPOINTMENT_WEIGHTS.revenue * revenue);
    return {
      id: appointment.id || "",
      score: round(score),
      indicators: { datetime, service, customer, status, revenue }
    };
  });
  const score = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
  return {
    score: round(score),
    total: appointments.length,
    weakCount: rows.filter((row) => row.score < 0.75).length,
    rows: rows.slice(0, 25)
  };
}

function paymentIsIgnored(payment = {}) {
  return ["free", "ignored"].includes(normalizeText(payment.reconciliationStatus || ""));
}

function computePaymentQuality(input = {}) {
  const appointmentsById = mapById(input.appointments);
  const clientsById = mapById(input.clients);
  const allowedMethods = new Set(["cash", "card", "mixed", "bank_transfer", "transfer", "wire", "stripe", "pos", "paypal", "satispay"]);
  const payments = filterByHorizon(input.payments, input.horizon, ["createdAt", "paidAt", "date"]);
  const rows = payments.map((payment) => {
    const amount = positive(payment.amountCents || payment.amount || 0) > 0 ? 1 : 0;
    const date = timestamp(paymentDate(payment)) > 0 ? 1 : 0;
    const appointmentLinked = Boolean(payment.appointmentId && appointmentsById.has(String(payment.appointmentId)));
    const clientLinked = Boolean(payment.clientId && clientsById.has(String(payment.clientId)));
    const strongLink = appointmentLinked || clientLinked || cleanText(payment.reference || payment.externalReference || "") ? 1 : 0;
    const notUnlinked = paymentIsIgnored(payment) || (appointmentLinked && clientLinked) ? 1 : strongLink ? 0.7 : 0;
    const methodText = normalizeText(payment.method || "");
    const method = allowedMethods.has(methodText) ? 1 : cleanText(methodText) ? 0.6 : 0;
    const score = (PAYMENT_WEIGHTS.amount * amount)
      + (PAYMENT_WEIGHTS.date * date)
      + (PAYMENT_WEIGHTS.strongLink * strongLink)
      + (PAYMENT_WEIGHTS.notUnlinked * notUnlinked)
      + (PAYMENT_WEIGHTS.method * method);
    return {
      id: payment.id || "",
      amountCents: positive(payment.amountCents || payment.amount || 0),
      score: round(score),
      indicators: { amount, date, strongLink, notUnlinked, method },
      unlinked: !paymentIsIgnored(payment) && (!appointmentLinked || !clientLinked)
    };
  });
  const score = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
  return {
    score: round(score),
    total: payments.length,
    unlinkedCount: rows.filter((row) => row.unlinked).length,
    weakCount: rows.filter((row) => row.score < 0.75).length,
    rows: rows.slice(0, 25)
  };
}

function computeCostQuality(input = {}) {
  const services = activeOnly(input.services);
  const staff = activeOnly(input.staff);
  const productsById = mapById(input.inventory);
  const resourcesById = mapById(input.resources);
  const anyLaborCost = staff.some((operator) => Number(operator.hourlyCostCents || operator.hourlyCost || 0) > 0);
  const rows = services.map((service) => {
    const labor = anyLaborCost || Number(service.laborCostCents || service.hourlyCostCents || 0) > 0 ? 1 : 0;
    const productLinks = Array.isArray(service.productLinks) ? service.productLinks : [];
    const technologyLinks = Array.isArray(service.technologyLinks) ? service.technologyLinks : [];
    const productUsable = productLinks.length ? productLinks.every((link) => productLinkUsable(link, productsById)) : false;
    const technologyUsable = technologyLinks.length ? technologyLinks.every((link) => technologyLinkUsable(link, resourcesById)) : false;
    const fallbackCost = serviceCostFallbackCents(service) > 0;
    const products = productUsable ? 1 : fallbackCost ? 0.55 : 0;
    const technologies = technologyUsable ? 1 : Number(service.technologyCostCents || 0) > 0 ? 0.55 : technologyLinks.length ? 0 : 0.8;
    const price = servicePriceCents(service) > 0 ? 1 : 0;
    const profitability = labor && price && (products > 0 || technologies > 0) ? (products >= 1 || technologies >= 1 ? 1 : 0.65) : 0;
    const score = (COST_WEIGHTS.labor * labor)
      + (COST_WEIGHTS.products * products)
      + (COST_WEIGHTS.technologies * technologies)
      + (COST_WEIGHTS.price * price)
      + (COST_WEIGHTS.profitability * profitability);
    return {
      id: service.id || "",
      name: service.name || "Servizio",
      score: round(score),
      indicators: { labor, products: round(products), technologies: round(technologies), price, profitability: round(profitability) }
    };
  });
  const score = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
  return {
    score: round(score),
    total: services.length,
    weakCount: rows.filter((row) => row.score < 0.75).length,
    rows: rows.slice(0, 25)
  };
}

function computeLinkQuality(input = {}) {
  const clientsById = mapById(input.clients);
  const servicesById = mapById(input.services);
  const appointmentsById = mapById(input.appointments);
  const productsById = mapById(input.inventory);
  const resourcesById = mapById(input.resources);
  const appointments = filterByHorizon(input.appointments, input.horizon, ["startAt", "date", "createdAt"]);
  const payments = filterByHorizon(input.payments, input.horizon, ["createdAt", "paidAt", "date"]);
  const services = activeOnly(input.services);
  const L_ac = scoreRatio(appointments.filter((a) => (a.clientId && clientsById.has(String(a.clientId))) || cleanText(a.walkInName || a.clientName || a.client || "")).length, appointments.length, 0);
  const L_as = scoreRatio(appointments.filter((a) => {
    const ids = serviceIdsForAppointment(a);
    return ids.length ? ids.every((id) => servicesById.has(String(id))) : Boolean(cleanText(a.serviceName || a.service || ""));
  }).length, appointments.length, 0);
  const L_pa = scoreRatio(payments.filter((p) => p.appointmentId && appointmentsById.has(String(p.appointmentId))).length, payments.length, 0);
  const L_pc = scoreRatio(payments.filter((p) => p.clientId && clientsById.has(String(p.clientId))).length, payments.length, 0);
  const productRelevant = services.filter((s) => Array.isArray(s.productLinks) && s.productLinks.length);
  const technologyRelevant = services.filter((s) => Array.isArray(s.technologyLinks) && s.technologyLinks.length);
  const L_sp = productRelevant.length
    ? scoreRatio(productRelevant.filter((s) => s.productLinks.every((link) => productLinkUsable(link, productsById))).length, productRelevant.length, 0)
    : 1;
  const L_st = technologyRelevant.length
    ? scoreRatio(technologyRelevant.filter((s) => s.technologyLinks.every((link) => technologyLinkUsable(link, resourcesById))).length, technologyRelevant.length, 0)
    : 1;
  const score = (LINK_WEIGHTS.appointmentCustomer * L_ac)
    + (LINK_WEIGHTS.appointmentService * L_as)
    + (LINK_WEIGHTS.paymentAppointment * L_pa)
    + (LINK_WEIGHTS.paymentCustomer * L_pc)
    + (LINK_WEIGHTS.serviceProduct * L_sp)
    + (LINK_WEIGHTS.serviceTechnology * L_st);
  return {
    score: round(score),
    ratios: {
      appointmentCustomer: round(L_ac),
      appointmentService: round(L_as),
      paymentAppointment: round(L_pa),
      paymentCustomer: round(L_pc),
      serviceProduct: round(L_sp),
      serviceTechnology: round(L_st)
    }
  };
}

function buildRawConsistencySnapshot(input = {}) {
  const appointments = filterByHorizon(input.appointments, input.horizon, ["startAt", "date", "createdAt"]);
  const payments = filterByHorizon(input.payments, input.horizon, ["createdAt", "paidAt", "date"]);
  const unlinkedPayments = payments.filter((payment) => !paymentIsIgnored(payment) && (!payment.appointmentId || !payment.clientId));
  return {
    revenue: payments.reduce((sum, payment) => sum + positive(payment.amountCents || payment.amount || 0), 0),
    recordedCash: payments.reduce((sum, payment) => sum + positive(payment.amountCents || payment.amount || 0), 0),
    clientCount: activeOnly(input.clients).length,
    appointmentCount: appointments.length,
    unlinkedCash: unlinkedPayments.reduce((sum, payment) => sum + positive(payment.amountCents || payment.amount || 0), 0)
  };
}

function buildGoldComparableSnapshot(goldState = {}) {
  const components = goldState.components || {};
  const counters = goldState.counters || {};
  const cash = goldState.cashPrimarySnapshot || goldState.cashParallel?.coreSnapshot || {};
  return {
    revenue: Number(components.Rev ?? counters.revenueTotalCents ?? 0),
    recordedCash: Number(cash.recordedCashCents ?? components.Rev ?? counters.revenueTotalCents ?? 0),
    clientCount: Number(counters.clientsTotal ?? components.Act ?? 0),
    appointmentCount: Number(counters.todayAppointments ?? 0),
    unlinkedCash: Number(cash.unlinkedCashCents ?? 0) || Number(counters.unlinkedPayments || components.U || 0)
  };
}

function computeConsistencyQuality(input = {}) {
  const goldState = input.goldState || input.goldSnapshot || null;
  if (!goldState || (!goldState.components && !goldState.counters && !goldState.cashPrimarySnapshot)) {
    return {
      score: null,
      comparable: false,
      reason: "gold_state_missing",
      metrics: [],
      sourceFlags: ["consistency:not_available"]
    };
  }
  const raw = buildRawConsistencySnapshot(input);
  const gold = buildGoldComparableSnapshot(goldState);
  const comparable = [
    ["revenue", raw.revenue, gold.revenue],
    ["recordedCash", raw.recordedCash, gold.recordedCash],
    ["clientCount", raw.clientCount, gold.clientCount],
    ["appointmentCount", raw.appointmentCount, gold.appointmentCount],
    ["unlinkedCash", raw.unlinkedCash, gold.unlinkedCash]
  ].filter(([, rawValue, goldValue]) => Number.isFinite(Number(rawValue)) && Number.isFinite(Number(goldValue)));
  if (!comparable.length) {
    return { score: null, comparable: false, reason: "no_comparable_metrics", metrics: [], sourceFlags: ["consistency:not_comparable"] };
  }
  const weight = 1 / comparable.length;
  const metrics = comparable.map(([metric, rawValue, goldValue]) => {
    const relativeError = Math.min(1, Math.abs(Number(rawValue || 0) - Number(goldValue || 0)) / Math.max(1, Math.max(Math.abs(Number(rawValue || 0)), Math.abs(Number(goldValue || 0)))));
    return { metric, raw: Number(rawValue || 0), state: Number(goldValue || 0), relativeError: round(relativeError) };
  });
  const penalty = metrics.reduce((sum, item) => sum + (weight * item.relativeError), 0);
  return {
    score: round(1 - penalty),
    comparable: true,
    metrics,
    sourceFlags: []
  };
}

function monthsBetween(startMs = 0, endMs = 0) {
  if (!startMs || !endMs || endMs < startMs) return 0;
  return (endMs - startMs) / (1000 * 60 * 60 * 24 * 30.4375);
}

function computeTemporalQuality(input = {}) {
  const appointments = filterByHorizon(input.appointments, input.horizon, ["startAt", "date", "createdAt"]);
  const payments = filterByHorizon(input.payments, input.horizon, ["createdAt", "paidAt", "date"]);
  const clients = activeOnly(input.clients);
  const orderChecks = [];
  appointments.forEach((appointment) => {
    const start = timestamp(appointment.startAt || appointment.date || appointment.createdAt);
    const end = timestamp(appointment.endAt || "");
    if (start) orderChecks.push(!end || end >= start ? 1 : 0);
  });
  payments.forEach((payment) => {
    orderChecks.push(timestamp(paymentDate(payment)) > 0 ? 1 : 0);
  });
  const T_ord = orderChecks.length ? orderChecks.reduce((sum, value) => sum + value, 0) / orderChecks.length : 0;
  const dates = [
    ...appointments.map(appointmentDate),
    ...payments.map(paymentDate),
    ...clients.map((client) => client.lastVisit || client.createdAt || "")
  ].map(timestamp).filter((value) => Number.isFinite(value) && value > 0);
  const oldest = dates.length ? Math.min(...dates) : 0;
  const newest = dates.length ? Math.max(...dates) : 0;
  const historyMonths = monthsBetween(oldest, newest);
  const T_cov = clamp01(historyMonths / 12);
  const ageDays = newest ? Math.max(0, (Date.now() - newest) / 86400000) : Infinity;
  const T_rec = newest ? clamp01(1 - (ageDays / 180)) : 0;
  const score = (TEMPORAL_WEIGHTS.order * T_ord) + (TEMPORAL_WEIGHTS.coverage * T_cov) + (TEMPORAL_WEIGHTS.recency * T_rec);
  return {
    score: round(score),
    historyMonths: round(historyMonths, 2),
    oldestDate: oldest ? new Date(oldest).toISOString() : "",
    newestDate: newest ? new Date(newest).toISOString() : "",
    ratios: { temporalOrder: round(T_ord), coverage: round(T_cov), recency: round(T_rec) }
  };
}

function weightedGlobalScore(scores = {}) {
  const available = Object.entries({
    crm: scores.crmQuality,
    appointment: scores.appointmentQuality,
    payment: scores.paymentQuality,
    cost: scores.costQuality,
    link: scores.linkQuality,
    consistency: scores.consistencyQuality,
    temporal: scores.temporalQuality
  }).filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const totalWeight = available.reduce((sum, [key]) => sum + Number(GLOBAL_WEIGHTS[key] || 0), 0);
  if (!available.length || !totalWeight) return { score: 0, redistributedWeights: true, weightsUsed: {} };
  const weightsUsed = {};
  const score = available.reduce((sum, [key, value]) => {
    const weight = Number(GLOBAL_WEIGHTS[key] || 0) / totalWeight;
    weightsUsed[key] = round(weight);
    return sum + (weight * Number(value || 0));
  }, 0);
  return { score: round(score), redistributedWeights: Math.abs(totalWeight - 1) > 0.000001, weightsUsed };
}

function inferDataQualityBand(scores = {}) {
  const dq = Number(scores.dataQualityScore || 0);
  const qPay = Number(scores.paymentQuality || 0);
  const qLink = Number(scores.linkQuality || 0);
  if (dq >= DATA_QUALITY_THRESHOLDS.realScore && qPay >= DATA_QUALITY_THRESHOLDS.realMinPayment && qLink >= DATA_QUALITY_THRESHOLDS.realMinLink) return DATA_QUALITY_BAND.REAL;
  if (dq >= DATA_QUALITY_THRESHOLDS.standardScore && qPay >= DATA_QUALITY_THRESHOLDS.standardMinPayment) return DATA_QUALITY_BAND.STANDARD;
  if (dq >= DATA_QUALITY_THRESHOLDS.estimatedScore) return DATA_QUALITY_BAND.ESTIMATED;
  return DATA_QUALITY_BAND.INCOMPLETE;
}

function inferDataQualityGate(scores = {}) {
  const dq = Number(scores.dataQualityScore || 0);
  const qPay = Number(scores.paymentQuality || 0);
  const qAppt = Number(scores.appointmentQuality || 0);
  const qCons = scores.consistencyQuality === null || scores.consistencyQuality === undefined ? 0 : Number(scores.consistencyQuality || 0);
  const qCost = Number(scores.costQuality || 0);
  const qLink = Number(scores.linkQuality || 0);
  const qCrm = Number(scores.crmQuality || 0);
  const qTemp = Number(scores.temporalQuality || 0);
  return {
    aiGoldEligible: dq >= DATA_QUALITY_THRESHOLDS.gateAiGoldScore && qPay >= DATA_QUALITY_THRESHOLDS.gateAiGoldPayment && qAppt >= DATA_QUALITY_THRESHOLDS.gateAiGoldAppointment,
    decisionEligible: dq >= DATA_QUALITY_THRESHOLDS.gateDecisionScore && qCons >= DATA_QUALITY_THRESHOLDS.gateDecisionConsistency,
    forecastEligible: inferDataQualityBand(scores) === DATA_QUALITY_BAND.REAL && qTemp >= 0.80,
    profitabilityReliable: qCost >= DATA_QUALITY_THRESHOLDS.gateCost,
    cashReliable: qPay >= DATA_QUALITY_THRESHOLDS.gateCashPayment && qLink >= DATA_QUALITY_THRESHOLDS.gateCashLink,
    marketingReliable: qCrm >= DATA_QUALITY_THRESHOLDS.gateMarketingCrm && qTemp >= DATA_QUALITY_THRESHOLDS.gateMarketingTemporal,
    reportReliable: dq >= DATA_QUALITY_THRESHOLDS.gateReportScore
  };
}

function computeDataQualitySnapshot(input = {}) {
  const horizon = {
    startDate: input.horizon?.startDate || input.startDate || "",
    endDate: input.horizon?.endDate || input.endDate || ""
  };
  const normalizedInput = { ...input, horizon };
  const crm = computeCRMQuality(normalizedInput);
  const appointments = computeAppointmentQuality(normalizedInput);
  const payments = computePaymentQuality(normalizedInput);
  const costs = computeCostQuality(normalizedInput);
  const links = computeLinkQuality(normalizedInput);
  const consistency = computeConsistencyQuality(normalizedInput);
  const temporal = computeTemporalQuality(normalizedInput);
  const baseScores = {
    crmQuality: crm.score,
    appointmentQuality: appointments.score,
    paymentQuality: payments.score,
    costQuality: costs.score,
    linkQuality: links.score,
    consistencyQuality: consistency.score,
    temporalQuality: temporal.score
  };
  const global = weightedGlobalScore(baseScores);
  const scores = {
    ...baseScores,
    dataQualityScore: global.score
  };
  const band = inferDataQualityBand(scores);
  const gate = inferDataQualityGate(scores);
  const sourceFlags = [
    ...(consistency.sourceFlags || []),
    global.redistributedWeights ? "global_weights:redistributed_missing_consistency" : "",
    crm.total === 0 ? "crm:no_clients" : "",
    appointments.total === 0 ? "appointments:no_records" : "",
    payments.total === 0 ? "payments:no_records" : "",
    costs.total === 0 ? "costs:no_services" : ""
  ].filter(Boolean);
  return {
    mathCore: "data_quality_core_v1",
    horizon,
    counts: {
      clients: activeOnly(input.clients).length,
      appointments: filterByHorizon(input.appointments, horizon, ["startAt", "date", "createdAt"]).length,
      payments: filterByHorizon(input.payments, horizon, ["createdAt", "paidAt", "date"]).length,
      services: activeOnly(input.services).length,
      staff: activeOnly(input.staff).length,
      inventory: activeOnly(input.inventory).length,
      technologies: activeOnly(input.resources).length
    },
    scores,
    band,
    gate,
    sourceFlags,
    weights: {
      clients: CLIENT_WEIGHTS,
      appointments: APPOINTMENT_WEIGHTS,
      payments: PAYMENT_WEIGHTS,
      costs: COST_WEIGHTS,
      links: LINK_WEIGHTS,
      temporal: TEMPORAL_WEIGHTS,
      global: GLOBAL_WEIGHTS,
      globalUsed: global.weightsUsed
    },
    thresholds: DATA_QUALITY_THRESHOLDS,
    breakdown: {
      crm,
      appointments,
      payments,
      costs,
      links,
      consistency,
      temporal
    }
  };
}

module.exports = {
  DATA_QUALITY_BAND,
  DATA_QUALITY_THRESHOLDS,
  computeCRMQuality,
  computeAppointmentQuality,
  computePaymentQuality,
  computeCostQuality,
  computeLinkQuality,
  computeConsistencyQuality,
  computeTemporalQuality,
  computeDataQualitySnapshot,
  inferDataQualityBand,
  inferDataQualityGate
};
