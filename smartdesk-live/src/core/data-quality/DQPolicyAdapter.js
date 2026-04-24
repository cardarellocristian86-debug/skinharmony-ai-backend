const DQ_ADAPTER_WEIGHTS = Object.freeze({
  dataQualityScore: 0.30,
  crmQuality: 0.20,
  appointmentQuality: 0.15,
  paymentQuality: 0.20,
  costQuality: 0.15
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
  return cleanText(value).toLowerCase();
}

function positive(value = 0) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function activeOnly(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.active !== false && item?.active !== 0);
}

function toDateOnly(value = "") {
  return String(value || "").slice(0, 10);
}

function isCancelledAppointment(appointment = {}) {
  return ["cancelled", "canceled", "no_show"].includes(normalizeText(appointment.status || ""));
}

function buildInferredOperatorServiceMap(appointments = [], staff = []) {
  const map = new Map();
  const staffIdByName = new Map((Array.isArray(staff) ? staff : []).map((operator) => [
    normalizeText(operator.name || ""),
    String(operator.id || "")
  ]).filter((entry) => entry[0] && entry[1]));
  (Array.isArray(appointments) ? appointments : []).forEach((appointment) => {
    const explicitOperatorId = String(appointment.staffId || appointment.operatorId || "");
    const operatorName = normalizeText(appointment.staffName || appointment.operatorName || appointment.operatore || "");
    const operatorId = explicitOperatorId || staffIdByName.get(operatorName) || "";
    const serviceId = String(appointment.serviceId || appointment.serviceName || "");
    if (!operatorId || !serviceId || isCancelledAppointment(appointment)) return;
    const current = map.get(operatorId) || new Set();
    current.add(serviceId);
    map.set(operatorId, current);
  });
  return map;
}

function serviceHasCompleteCost(service = {}) {
  const hasProductCost = Array.isArray(service.productLinks) && service.productLinks.length > 0;
  const hasTechnologyCost = Array.isArray(service.technologyLinks) && service.technologyLinks.length > 0;
  const hasEstimatedCost = Number(service.estimatedProductCostCents || service.productCostCents || 0) > 0
    || Number(service.technologyCostCents || 0) > 0;
  return hasProductCost || hasTechnologyCost || hasEstimatedCost;
}

function serviceHasEstimatedCostOnly(service = {}) {
  const hasProductCost = Array.isArray(service.productLinks) && service.productLinks.length > 0;
  const hasTechnologyCost = Array.isArray(service.technologyLinks) && service.technologyLinks.length > 0;
  const hasEstimatedCost = Number(service.estimatedProductCostCents || service.productCostCents || 0) > 0
    || Number(service.technologyCostCents || 0) > 0;
  return !hasProductCost && !hasTechnologyCost && hasEstimatedCost;
}

function makeLegacyCheck(missingCount = 0, totalRecords = 0, weight = 0) {
  const safeTotal = Math.max(0, Number(totalRecords || 0));
  const safeMissing = Math.max(0, Number(missingCount || 0));
  const issueRate = safeTotal > 0 ? safeMissing / safeTotal : 0;
  return {
    totalRecords: safeTotal,
    missingCount: safeMissing,
    issueRate: round(issueRate),
    penalty: round(issueRate * Number(weight || 0), 2)
  };
}

function summarizeLegacyBlock(checks = {}) {
  const entries = Object.values(checks);
  const totalRecords = entries.reduce((max, item) => Math.max(max, Number(item.totalRecords || 0)), 0);
  const missingCount = entries.reduce((sum, item) => sum + Number(item.missingCount || 0), 0);
  const issueRate = totalRecords > 0 ? Math.min(1, missingCount / totalRecords) : 0;
  const penalty = entries.reduce((sum, item) => sum + Number(item.penalty || 0), 0);
  return {
    totalRecords,
    missingCount,
    issueRate: round(issueRate),
    quality: round(1 - issueRate),
    penalty: round(penalty, 2),
    checks
  };
}

function appointmentHasPayment(appointment = {}, paidAppointmentIds = new Set()) {
  return paidAppointmentIds.has(String(appointment.id || ""));
}

function isPastAppointment(appointment = {}, now = Date.now()) {
  const time = new Date(appointment.startAt || appointment.createdAt || 0).getTime();
  return Number.isFinite(time) && time <= now;
}

function buildLegacyPolicyBlocks(rawData = {}) {
  const clients = activeOnly(rawData.clients);
  const services = activeOnly(rawData.services);
  const appointments = Array.isArray(rawData.appointments) ? rawData.appointments : [];
  const payments = Array.isArray(rawData.payments) ? rawData.payments : [];
  const staff = activeOnly(rawData.staff);
  const inventory = activeOnly(rawData.inventory);
  const resources = activeOnly(rawData.resources);
  const paidAppointmentIds = new Set(payments.map((payment) => String(payment.appointmentId || "")).filter(Boolean));
  const completedAppointments = appointments.filter((appointment) => normalizeText(appointment.status || "") === "completed");
  const soldServiceIds = new Set(completedAppointments.map((appointment) => String(appointment.serviceId || "")).filter(Boolean));
  const soldServices = services.filter((service) => soldServiceIds.has(String(service.id || "")));
  const clientsWithExpectedHistory = clients.filter((client) => (
    appointments.some((appointment) => String(appointment.clientId || "") === String(client.id || ""))
    || payments.some((payment) => String(payment.clientId || "") === String(client.id || ""))
  ));
  const clientsMissingContact = clients.filter((client) => !client.phone && !client.email);
  const clientsMissingPhone = clients.filter((client) => !client.phone);
  const clientsMissingEmail = clients.filter((client) => !client.email);
  const clientsMissingLastVisit = clientsWithExpectedHistory.filter((client) => !client.lastVisit);
  const servicesMissingCosts = services.filter((service) => !serviceHasCompleteCost(service));
  const servicesMissingPrice = services.filter((service) => Number(service.priceCents || service.price || 0) <= 0);
  const servicesMissingDuration = services.filter((service) => Number(service.durationMin || service.duration || 0) <= 0);
  const servicesMissingCategory = services.filter((service) => !cleanText(service.category || service.serviceCategory || service.type || ""));
  const appointmentsMissingPayment = appointments.filter((appointment) => {
    if (isCancelledAppointment(appointment)) return false;
    if (!isPastAppointment(appointment)) return false;
    return !appointmentHasPayment(appointment, paidAppointmentIds);
  });
  const unlinkedPayments = payments
    .filter((payment) => !["free", "ignored"].includes(normalizeText(payment.reconciliationStatus || "")))
    .filter((payment) => !payment.appointmentId || !payment.clientId);
  const paymentsMissingMethod = payments.filter((payment) => !cleanText(payment.method || ""));
  const appointmentsMissingClient = appointments.filter((appointment) => !appointment.clientId && !appointment.walkInName && !appointment.clientName);
  const appointmentsMissingService = appointments.filter((appointment) => !appointment.serviceId && !appointment.serviceName);
  const appointmentsMissingOperator = appointments.filter((appointment) => !appointment.staffId && !appointment.operatorId && !appointment.staffName);
  const completedAppointmentsMissingFinalData = completedAppointments.filter((appointment) => (
    !appointmentHasPayment(appointment, paidAppointmentIds)
    || (!appointment.serviceId && !appointment.serviceName)
    || (!appointment.clientId && !appointment.walkInName && !appointment.clientName)
  ));
  const staffIdsUsedByServices = new Set(services.flatMap((service) => [
    ...(Array.isArray(service.staffIds) ? service.staffIds : []),
    ...(Array.isArray(service.operatorIds) ? service.operatorIds : []),
    ...(Array.isArray(service.assignedStaffIds) ? service.assignedStaffIds : [])
  ]).map((id) => String(id || "")).filter(Boolean));
  const inferredOperatorServices = buildInferredOperatorServiceMap(completedAppointments, staff);
  const operatorsMissingHourlyCost = staff.filter((operator) => Number(operator.hourlyCostCents || operator.hourlyCost || 0) <= 0);
  const operatorsMissingRole = staff.filter((operator) => !cleanText(operator.role || ""));
  const operatorsMissingServices = staff.filter((operator) => {
    const direct = Array.isArray(operator.serviceIds) || Array.isArray(operator.services) || Array.isArray(operator.assignedServiceIds);
    const directCount = [
      ...(Array.isArray(operator.serviceIds) ? operator.serviceIds : []),
      ...(Array.isArray(operator.services) ? operator.services : []),
      ...(Array.isArray(operator.assignedServiceIds) ? operator.assignedServiceIds : [])
    ].filter(Boolean).length;
    const inferredCount = inferredOperatorServices.get(String(operator.id || ""))?.size || 0;
    return direct ? directCount === 0 && inferredCount === 0 : !staffIdsUsedByServices.has(String(operator.id || "")) && inferredCount === 0;
  });
  const inventoryMissingCost = inventory.filter((item) => Number(item.costCents || item.unitCostCents || item.purchaseCostCents || 0) <= 0);
  const inventoryMissingStock = inventory.filter((item) => item.quantity === undefined && item.stockQuantity === undefined);
  const productServiceLinks = services.flatMap((service) => (
    Array.isArray(service.productLinks)
      ? service.productLinks.map((link) => ({ ...link, serviceId: service.id }))
      : []
  ));
  const productLinksMissingUsage = productServiceLinks.filter((link) => Number(link.quantityUsage || link.usageUnits || 0) <= 0);
  const soldServicesMissingMarginCost = soldServices.filter((service) => !serviceHasCompleteCost(service));
  const resourcesMissingCost = resources.filter((resource) => (
    Number(resource.monthlyCostCents || 0) <= 0 && Number(resource.costPerUseCents || 0) <= 0
  ));
  const servicesWithCalculatedMargin = services.filter((service) => Number(service.priceCents || service.price || 0) > 0 && serviceHasCompleteCost(service));
  const servicesLowMargin = servicesWithCalculatedMargin.filter((service) => {
    const price = Number(service.priceCents || service.price || 0);
    const cost = Number(service.estimatedProductCostCents || service.productCostCents || 0) + Number(service.technologyCostCents || 0);
    const marginPercent = price > 0 ? ((price - cost) / price) * 100 : 0;
    return marginPercent < 35;
  });
  const clientsBlock = summarizeLegacyBlock({
    withoutContact: makeLegacyCheck(clientsMissingContact.length, clients.length, 12),
    withoutPhone: makeLegacyCheck(clientsMissingPhone.length, clients.length, 4),
    withoutEmail: makeLegacyCheck(clientsMissingEmail.length, clients.length, 2),
    withoutLastVisit: makeLegacyCheck(clientsMissingLastVisit.length, clientsWithExpectedHistory.length, 3)
  });
  const servicesBlock = summarizeLegacyBlock({
    withoutPrice: makeLegacyCheck(servicesMissingPrice.length, services.length, 10),
    withoutCost: makeLegacyCheck(servicesMissingCosts.length, services.length, 14),
    withoutDuration: makeLegacyCheck(servicesMissingDuration.length, services.length, 6),
    withoutCategory: makeLegacyCheck(servicesMissingCategory.length, services.length, 3)
  });
  const paymentsBlock = summarizeLegacyBlock({
    completedWithoutPayment: makeLegacyCheck(appointmentsMissingPayment.length, completedAppointments.length, 15),
    unlinkedPayments: makeLegacyCheck(unlinkedPayments.length, payments.length, 6),
    withoutMethod: makeLegacyCheck(paymentsMissingMethod.length, payments.length, 4)
  });
  const appointmentsBlock = summarizeLegacyBlock({
    withoutClient: makeLegacyCheck(appointmentsMissingClient.length, appointments.length, 8),
    withoutService: makeLegacyCheck(appointmentsMissingService.length, appointments.length, 8),
    withoutOperator: makeLegacyCheck(appointmentsMissingOperator.length, appointments.length, 5),
    completedWithMissingFinalData: makeLegacyCheck(completedAppointmentsMissingFinalData.length, completedAppointments.length, 7)
  });
  const operatorsBlock = summarizeLegacyBlock({
    withoutHourlyCost: makeLegacyCheck(operatorsMissingHourlyCost.length, staff.length, 10),
    withoutRole: makeLegacyCheck(operatorsMissingRole.length, staff.length, 3),
    withoutServices: makeLegacyCheck(operatorsMissingServices.length, staff.length, 4)
  });
  const inventoryBlock = summarizeLegacyBlock({
    withoutCost: makeLegacyCheck(inventoryMissingCost.length, inventory.length, 6),
    withoutStock: makeLegacyCheck(inventoryMissingStock.length, inventory.length, 3),
    productServiceLinksWithoutUsage: makeLegacyCheck(productLinksMissingUsage.length, productServiceLinks.length, 8)
  });
  const profitabilityBlock = summarizeLegacyBlock({
    soldServicesWithoutCost: makeLegacyCheck(soldServicesMissingMarginCost.length, soldServices.length, 12),
    technologiesWithoutCost: makeLegacyCheck(resourcesMissingCost.length, resources.length, 6),
    lowMarginServices: makeLegacyCheck(servicesLowMargin.length, servicesWithCalculatedMargin.length, 5)
  });
  const totalPenalty = [
    clientsBlock,
    servicesBlock,
    paymentsBlock,
    appointmentsBlock,
    operatorsBlock,
    inventoryBlock,
    profitabilityBlock
  ].reduce((sum, block) => sum + Number(block.penalty || 0), 0);
  const score = clamp01((100 - totalPenalty) / 100);
  return {
    clientsBlock,
    servicesBlock,
    paymentsBlock,
    appointmentsBlock,
    operatorsBlock,
    inventoryBlock,
    profitabilityBlock,
    totalPenalty: round(totalPenalty, 2),
    score
  };
}

function inferBand(score = 0) {
  const value = Number(score || 0);
  if (value >= 0.90) return "REAL";
  if (value >= 0.75) return "STANDARD";
  if (value >= 0.50) return "ESTIMATED";
  return "INCOMPLETE";
}

function buildComparableDataQualitySnapshot(operationalSnapshot = {}, rawData = {}) {
  const legacy = buildLegacyPolicyBlocks(rawData);
  const costValues = [legacy.servicesBlock.quality, legacy.profitabilityBlock.quality].filter((value) => Number.isFinite(Number(value)));
  const costQuality = costValues.length ? round(costValues.reduce((sum, value) => sum + value, 0) / costValues.length) : null;
  const dataQualityScore = round(legacy.score);
  return {
    source: "core_policy_adapter",
    score: dataQualityScore,
    band: inferBand(dataQualityScore),
    crmQuality: legacy.clientsBlock.quality,
    appointmentQuality: legacy.appointmentsBlock.quality,
    paymentQuality: legacy.paymentsBlock.quality,
    costQuality,
    linkQuality: null,
    consistencyQuality: null,
    temporalQuality: null,
    dataQualityScore,
    gate: operationalSnapshot.gate || {},
    sourceFlags: [
      "dq_policy_adapter:legacy_comparable_projection",
      "dq_policy_adapter:link_consistency_temporal_excluded"
    ],
    legacyPolicyBlocks: legacy
  };
}

function buildDataQualityPolicyDelta(operationalSnapshot = {}, comparableSnapshot = {}) {
  const metrics = ["dataQualityScore", "crmQuality", "appointmentQuality", "paymentQuality", "costQuality"];
  return metrics.reduce((acc, metric) => {
    const opValue = operationalSnapshot[metric];
    const cmpValue = comparableSnapshot[metric];
    if (opValue === null || opValue === undefined || cmpValue === null || cmpValue === undefined) return acc;
    acc[metric] = round(Number(cmpValue || 0) - Number(opValue || 0));
    return acc;
  }, {});
}

function explainDataQualityPolicyDifferences() {
  return [
    {
      policy: "CRM",
      explanation: "La vista comparabile replica le penalità legacy senza contatto, telefono, email e lastVisit. Il core operativo resta più granulare su email, telefono, nome, unicità e duplicati."
    },
    {
      policy: "APPOINTMENT",
      explanation: "La vista comparabile replica i controlli legacy su cliente, servizio, operatore e final data dei completati. Il core operativo mantiene controlli formali su date, status e ricavo."
    },
    {
      policy: "PAYMENT",
      explanation: "La vista comparabile replica la severità legacy su appuntamenti completati senza pagamento, pagamenti non collegati e metodo assente."
    },
    {
      policy: "COST",
      explanation: "La vista comparabile considera sufficienti anche fallback stimati legacy dove getDataQuality li considera completi; il core operativo mantiene lettura rigorosa."
    },
    {
      policy: "EXCLUDED",
      explanation: "Q_link, Q_cons e Q_temp restano nel core operativo ma sono esclusi dall'accordo comparabile perché il legacy non espone metriche omogenee."
    }
  ];
}

function adaptDataQualitySnapshotToLegacyComparable(operationalSnapshot = {}, context = {}) {
  const rawData = context.rawData || context || {};
  const comparableSnapshot = buildComparableDataQualitySnapshot(operationalSnapshot, rawData);
  return {
    mathAdapter: "dq_policy_adapter_v1",
    operationalSnapshot,
    comparableSnapshot,
    policyDeltas: buildDataQualityPolicyDelta(operationalSnapshot, comparableSnapshot),
    excludedFromAgreement: ["linkQuality", "consistencyQuality", "temporalQuality"],
    policyFlags: [
      "legacy_crm_penalty_projection",
      "legacy_appointment_penalty_projection",
      "legacy_payment_penalty_projection",
      "legacy_cost_fallback_projection"
    ],
    policyNotes: explainDataQualityPolicyDifferences()
  };
}

module.exports = {
  DQ_ADAPTER_WEIGHTS,
  adaptDataQualitySnapshotToLegacyComparable,
  buildComparableDataQualitySnapshot,
  explainDataQualityPolicyDifferences,
  buildDataQualityPolicyDelta
};
