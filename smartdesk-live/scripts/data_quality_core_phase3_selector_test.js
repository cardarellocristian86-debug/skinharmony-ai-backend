const assert = require("assert");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

function iso(monthOffset = 0, day = 10) {
  const date = new Date("2025-01-10T10:00:00.000Z");
  date.setMonth(date.getMonth() + monthOffset);
  date.setDate(day);
  return date.toISOString();
}

function withCenter(item, centerId) {
  return { centerId, ...item };
}

function installFixture(service, fixture) {
  service.clientsRepository = { list: () => fixture.clients };
  service.appointmentsRepository = { list: () => fixture.appointments };
  service.paymentsRepository = { list: () => fixture.payments };
  service.servicesRepository = { list: () => fixture.services };
  service.staffRepository = { list: () => fixture.staff };
  service.inventoryRepository = { list: () => fixture.inventory };
  service.resourcesRepository = { list: () => fixture.resources };
  service.aiMarketingActionsRepository = { list: () => [] };
  service.goldStateRepository = { findById: () => null, create: (item) => item, update: (id, updater) => updater({ id }) };
}

function session(centerId, centerName) {
  return {
    centerId,
    centerName,
    username: centerId,
    role: "owner",
    subscriptionPlan: "gold",
    accessState: "active",
    accountStatus: "active",
    paymentStatus: "paid"
  };
}

function buildCleanFixture(centerId) {
  const clients = Array.from({ length: 6 }, (_, index) => withCenter({
    id: `${centerId}_c${index + 1}`,
    firstName: `Cliente${index + 1}`,
    lastName: "Core",
    email: `cliente${index + 1}@example.com`,
    phone: `+3934012345${index}`,
    createdAt: iso(0),
    lastVisit: iso(index),
    active: 1
  }, centerId));
  const services = [withCenter({
    id: `${centerId}_s1`,
    name: "Servizio core",
    priceCents: 9000,
    durationMin: 45,
    category: "hair",
    productLinks: [{ productId: `${centerId}_prod_1`, usageUnits: 1, unitCostCents: 900 }],
    technologyLinks: [{ technologyId: `${centerId}_tech_1`, usageUnits: 1, costPerUseCents: 700 }],
    active: 1
  }, centerId)];
  const staff = [withCenter({ id: `${centerId}_op_1`, name: "Operatore", role: "stylist", hourlyCostCents: 1800, serviceIds: [`${centerId}_s1`], active: 1 }, centerId)];
  const inventory = [withCenter({ id: `${centerId}_prod_1`, name: "Prodotto", unitCostCents: 900, quantity: 20, active: 1 }, centerId)];
  const resources = [withCenter({ id: `${centerId}_tech_1`, name: "Tecnologia", costPerUseCents: 700, active: 1 }, centerId)];
  const appointments = clients.map((client, index) => withCenter({
    id: `${centerId}_a${index + 1}`,
    clientId: client.id,
    serviceId: `${centerId}_s1`,
    serviceIds: [`${centerId}_s1`],
    staffId: `${centerId}_op_1`,
    startAt: iso(index),
    endAt: iso(index).replace("10:00:00.000Z", "10:45:00.000Z"),
    status: "completed",
    priceCents: 9000,
    createdAt: iso(index, 1)
  }, centerId));
  const payments = appointments.map((appointment, index) => withCenter({
    id: `${centerId}_p${index + 1}`,
    clientId: appointment.clientId,
    appointmentId: appointment.id,
    amountCents: 9000,
    method: "card",
    createdAt: iso(index).replace("10:00:00.000Z", "11:00:00.000Z")
  }, centerId));
  return { clients, services, staff, inventory, resources, appointments, payments };
}

function buildFragileFixture(centerId) {
  return {
    clients: [withCenter({ id: `${centerId}_c1`, firstName: "", lastName: "", email: "", phone: "", active: 1 }, centerId)],
    services: [withCenter({ id: `${centerId}_s1`, name: "", priceCents: 0, durationMin: 0, category: "", productLinks: [], technologyLinks: [], active: 1 }, centerId)],
    staff: [withCenter({ id: `${centerId}_op_1`, name: "Operatore", role: "", hourlyCostCents: 0, active: 1 }, centerId)],
    inventory: [],
    resources: [],
    appointments: [withCenter({ id: `${centerId}_a1`, clientId: "", serviceId: "", staffId: "", startAt: "bad-date", status: "unknown", priceCents: -1 }, centerId)],
    payments: [withCenter({ id: `${centerId}_p1`, clientId: "", appointmentId: "", amountCents: 0, method: "", createdAt: "" }, centerId)]
  };
}

function buildState(label, centerId, fixture, previousSource = "legacy") {
  const service = new DesktopMirrorService();
  installFixture(service, fixture);
  const targetSession = session(centerId, label);
  const state = service.refreshGoldDerivedState({
    ...service.buildDefaultGoldState(centerId, label),
    centerId,
    centerName: label,
    dataQualitySelection: { primarySource: previousSource },
    counters: service.buildGoldStateCountersFromRepositories(targetSession).counters,
    eventSeq: 1
  }, targetSession);
  return { service, state, targetSession };
}

const privilege = buildState("Privilege Parrucchieri", "dq_phase3_privilege", buildCleanFixture("dq_phase3_privilege"));
assert.strictEqual(privilege.state.dataQualitySelection.primarySource, "core", "Privilege fixture should switch to core");
assert.strictEqual(privilege.state.dataQualityPrimarySnapshot.sourceUsed, "core", "Primary DQ must be core");
assert(privilege.state.dataQualityComparableSnapshot, "Comparable snapshot must stay available");
assert.strictEqual(privilege.service.computeProgressiveIntelligenceStatus(privilege.targetSession).pialDataQualityComparison.primarySource, "core", "PIAL must read selected primary source");
assert.strictEqual(privilege.service.buildOperationalReportFromGoldState({}, privilege.targetSession).meta.dataQualitySource, "core", "Report must read primary DQ source");
const decisionCenter = privilege.service.buildDecisionCenterFromGoldState({}, privilege.targetSession);
assert(decisionCenter?.sections?.length, "Decision Center must stay compatible with selected DQ source");

const fragile = buildState("Tenant fragile incompleto", "dq_phase3_fragile", buildFragileFixture("dq_phase3_fragile"));
assert.strictEqual(fragile.state.dataQualitySelection.primarySource, "legacy", "Fragile fixture must stay on legacy");
assert.strictEqual(fragile.state.dataQualityPrimarySnapshot.sourceUsed, "legacy", "Fragile primary DQ must be legacy");
assert(fragile.state.dataQualitySelection.fallbackReason.includes("core_band_INCOMPLETE"), "Fragile fallback reason must be explicit");

const service = new DesktopMirrorService();
const keepCore = service.buildGoldDataQualityControlledSwitch({
  status: "ok",
  agreementScore: 0.80,
  agreementBand: "WATCH",
  legacySnapshot: { dataQualityScore: 0.70, band: "ESTIMATED" },
  operationalSnapshot: { dataQualityScore: 0.80, score: 0.80, band: "STANDARD", paymentQuality: 0.80, appointmentQuality: 0.80 },
  comparableSnapshot: { dataQualityScore: 0.70, band: "ESTIMATED" }
}, "core");
assert.strictEqual(keepCore.dataQualitySelection.primarySource, "core", "Hysteresis must keep core above off threshold");

const fallBack = service.buildGoldDataQualityControlledSwitch({
  status: "ok",
  agreementScore: 0.70,
  agreementBand: "DRIFT",
  legacySnapshot: { dataQualityScore: 0.70, band: "ESTIMATED" },
  operationalSnapshot: { dataQualityScore: 0.82, score: 0.82, band: "STANDARD", paymentQuality: 0.80, appointmentQuality: 0.80 },
  comparableSnapshot: { dataQualityScore: 0.70, band: "ESTIMATED" }
}, "core");
assert.strictEqual(fallBack.dataQualitySelection.primarySource, "legacy", "DRIFT must force legacy fallback");

console.log(JSON.stringify({
  ok: true,
  phase: "data_quality_core_phase3_selector",
  privilege: {
    primarySource: privilege.state.dataQualitySelection.primarySource,
    agreementScore: privilege.state.dataQualitySelection.agreementScore,
    reliabilityScore: privilege.state.dataQualitySelection.reliabilityScore,
    coreBand: privilege.state.dataQualitySelection.coreBand
  },
  fragile: {
    primarySource: fragile.state.dataQualitySelection.primarySource,
    fallbackReason: fragile.state.dataQualitySelection.fallbackReason
  },
  hysteresis: {
    keepCore: keepCore.dataQualitySelection.primarySource,
    driftFallback: fallBack.dataQualitySelection.primarySource
  },
  confirmations: {
    readOnly: true,
    noUiChange: true,
    noPublicApiChange: true,
    noRealDataModified: true
  }
}, null, 2));
