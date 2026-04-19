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

function client(id, centerId, overrides = {}) {
  return withCenter({
    id,
    firstName: `Cliente${id}`,
    lastName: "Shadow",
    email: `${id}@example.com`,
    phone: `+39340${String(id).replace(/\D/g, "").padStart(7, "0").slice(0, 7)}`,
    createdAt: iso(0),
    lastVisit: iso(10),
    active: 1,
    ...overrides
  }, centerId);
}

function service(id, centerId, overrides = {}) {
  return withCenter({
    id,
    name: `Servizio ${id}`,
    priceCents: 9000,
    durationMin: 45,
    category: "hair",
    productLinks: [{ productId: `${centerId}_prod_1`, usageUnits: 1, unitCostCents: 900 }],
    technologyLinks: [{ technologyId: `${centerId}_tech_1`, usageUnits: 1, costPerUseCents: 700 }],
    active: 1,
    ...overrides
  }, centerId);
}

function appointment(id, centerId, clientId, serviceId, month, overrides = {}) {
  return withCenter({
    id,
    clientId,
    serviceId,
    serviceIds: [serviceId],
    staffId: `${centerId}_op_1`,
    startAt: iso(month, 10),
    endAt: iso(month, 10).replace("10:00:00.000Z", "10:45:00.000Z"),
    status: "completed",
    priceCents: 9000,
    createdAt: iso(month, 1),
    ...overrides
  }, centerId);
}

function payment(id, centerId, clientId, appointmentId, month, overrides = {}) {
  return withCenter({
    id,
    clientId,
    appointmentId,
    amountCents: 9000,
    method: "card",
    createdAt: iso(month, 10).replace("10:00:00.000Z", "11:00:00.000Z"),
    ...overrides
  }, centerId);
}

function buildFixture(centerId, mode) {
  const clean = mode === "clean";
  const medium = mode === "medium";
  const clients = clean
    ? Array.from({ length: 8 }, (_, index) => client(`${centerId}_c${index + 1}`, centerId))
    : medium
      ? [
        client(`${centerId}_m1`, centerId, { email: "" }),
        client(`${centerId}_m2`, centerId, { phone: "" }),
        client(`${centerId}_m3`, centerId),
        client(`${centerId}_m4`, centerId, { lastName: "", email: "" })
      ]
      : [
        client(`${centerId}_f1`, centerId, { firstName: "", lastName: "", email: "", phone: "", lastVisit: "" }),
        client(`${centerId}_f2`, centerId, { firstName: "", lastName: "", email: "", phone: "", lastVisit: "" })
      ];
  const services = clean
    ? [service(`${centerId}_s1`, centerId), service(`${centerId}_s2`, centerId)]
    : medium
      ? [service(`${centerId}_ms1`, centerId, { productLinks: [], estimatedProductCostCents: 1200, technologyLinks: [] }), service(`${centerId}_ms2`, centerId, { productLinks: [], technologyLinks: [] })]
      : [service(`${centerId}_fs1`, centerId, { priceCents: 0, productLinks: [], technologyLinks: [], durationMin: 0, category: "" })];
  const staff = [withCenter({ id: `${centerId}_op_1`, name: "Operatore", role: "stylist", hourlyCostCents: clean || medium ? 1800 : 0, active: 1 }, centerId)];
  const inventory = clean ? [withCenter({ id: `${centerId}_prod_1`, name: "Prodotto", unitCostCents: 900, costCents: 900, quantity: 20, active: 1 }, centerId)] : [];
  const resources = clean ? [withCenter({ id: `${centerId}_tech_1`, name: "Tecnologia", costPerUseCents: 700, active: 1 }, centerId)] : [];
  const appointments = clean
    ? clients.map((item, index) => appointment(`${centerId}_a${index + 1}`, centerId, item.id, index % 2 ? `${centerId}_s2` : `${centerId}_s1`, index))
    : medium
      ? [
        appointment(`${centerId}_ma1`, centerId, clients[0].id, `${centerId}_ms1`, 4),
        appointment(`${centerId}_ma2`, centerId, clients[1].id, `${centerId}_ms2`, 5, { status: "booked" }),
        appointment(`${centerId}_ma3`, centerId, "", `${centerId}_ms2`, 6, { walkInName: "Walk in" })
      ]
      : [
        appointment(`${centerId}_fa1`, centerId, "", "", 10, { serviceIds: [], startAt: "bad-date", endAt: iso(9), status: "unknown", priceCents: -1 }),
        appointment(`${centerId}_fa2`, centerId, "", "", 10, { serviceIds: [], serviceName: "", status: "" })
      ];
  const payments = clean
    ? appointments.map((item, index) => payment(`${centerId}_p${index + 1}`, centerId, item.clientId, item.id, index))
    : medium
      ? [
        payment(`${centerId}_mp1`, centerId, clients[0].id, `${centerId}_ma1`, 4),
        payment(`${centerId}_mp2`, centerId, clients[1].id, "", 5),
        payment(`${centerId}_mp3`, centerId, "", "", 6, { method: "cash" })
      ]
      : [
        payment(`${centerId}_fp1`, centerId, "", "", 10, { amountCents: 0, method: "", createdAt: "" }),
        payment(`${centerId}_fp2`, centerId, "", "", 10, { method: "", createdAt: "bad-date" })
      ];
  return { clients, services, staff, inventory, resources, appointments, payments };
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

function runTenant(label, centerId, mode) {
  const service = new DesktopMirrorService();
  const fixture = buildFixture(centerId, mode);
  installFixture(service, fixture);
  const targetSession = session(centerId, label);
  const state = service.refreshGoldDerivedState({
    ...service.buildDefaultGoldState(centerId, label),
    centerId,
    centerName: label,
    counters: service.buildGoldStateCountersFromRepositories(targetSession).counters,
    eventSeq: 1
  }, targetSession);
  const pial = service.computeProgressiveIntelligenceStatus(targetSession);
  assert(state.dataQualityParallel, `${label}: missing dataQualityParallel`);
  assert(["ok", "not_comparable"].includes(state.dataQualityParallel.status), `${label}: invalid dataQualityParallel status`);
  assert(pial.pialDataQualityComparison, `${label}: missing PIAL comparison`);
  return {
    tenant: label,
    status: state.dataQualityParallel.status,
    agreementBand: state.dataQualityParallel.agreementBand,
    agreementScore: state.dataQualityParallel.agreementScore,
    legacyScore: state.dataQualityParallel.legacySnapshot?.dataQualityScore,
    coreScore: state.dataQualityParallel.coreSnapshot?.dataQualityScore,
    coreBand: state.dataQualityParallel.coreSnapshot?.band,
    comparableMetrics: state.dataQualityParallel.diffSnapshot?.comparableMetrics || [],
    warnings: state.dataQualityParallel.diffSnapshot?.warnings || [],
    pialComparison: pial.pialDataQualityComparison
  };
}

const results = [
  runTenant("Privilege Parrucchieri", "dq_privilege", "clean"),
  runTenant("Gold Test Centro 073", "dq_centro_073", "medium"),
  runTenant("Tenant fragile incompleto", "dq_fragile", "fragile")
];

const errorService = new DesktopMirrorService();
errorService.clientsRepository = { list: () => { throw new Error("forced_data_quality_core_failure"); } };
const errorState = errorService.buildDataQualityParallelState(errorService.buildDefaultGoldState("error_tenant", "Error Tenant"), session("error_tenant", "Error Tenant"));
assert.strictEqual(errorState.status, "error", "Forced failure must return status=error");

console.log(JSON.stringify({
  ok: true,
  mode: "shadow",
  note: "Read-only shadow integration test. No repositories or real records modified.",
  tenants: results,
  forcedError: {
    status: errorState.status,
    warnings: errorState.diffSnapshot.warnings
  }
}, null, 2));
