const assert = require("assert");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

function dateAt(dayOffset = 0, hour = 10, minute = 0) {
  const date = new Date();
  date.setUTCHours(hour, minute, 0, 0);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString();
}

function withCenter(item, centerId) {
  return { centerId, ...item };
}

function client(id, centerId, overrides = {}) {
  return withCenter({
    id,
    firstName: `Cliente ${id}`,
    lastName: "Agenda",
    email: `${id}@example.com`,
    phone: `+393401234${String(id).replace(/\D/g, "").slice(-3).padStart(3, "0")}`,
    active: 1,
    ...overrides
  }, centerId);
}

function serviceRow(id, centerId, overrides = {}) {
  return withCenter({
    id,
    name: `Servizio ${id}`,
    priceCents: 9000,
    productCostCents: 1500,
    technologyCostCents: 500,
    durationMin: 60,
    active: 1,
    ...overrides
  }, centerId);
}

function staffRow(id, centerId, overrides = {}) {
  return withCenter({
    id,
    name: `Operatore ${id}`,
    active: 1,
    workingHours: {
      monday: [{ start: "09:00", end: "17:00" }],
      tuesday: [{ start: "09:00", end: "17:00" }],
      wednesday: [{ start: "09:00", end: "17:00" }],
      thursday: [{ start: "09:00", end: "17:00" }],
      friday: [{ start: "09:00", end: "17:00" }],
      saturday: [{ start: "09:00", end: "15:00" }]
    },
    ...overrides
  }, centerId);
}

function appointment(id, centerId, clientId, serviceId, startAt, overrides = {}) {
  return withCenter({
    id,
    clientId,
    serviceId,
    serviceIds: serviceId ? [serviceId] : [],
    staffId: `${centerId}_op1`,
    startAt,
    status: "confirmed",
    amountCents: 9000,
    priceCents: 9000,
    ...overrides
  }, centerId);
}

function payment(id, centerId, appointmentId, overrides = {}) {
  return withCenter({
    id,
    appointmentId,
    clientId: overrides.clientId || `${centerId}_c1`,
    amountCents: 9000,
    method: "card",
    createdAt: dateAt(0, 12),
    ...overrides
  }, centerId);
}

function buildFixture(centerId, mode) {
  const clients = [
    client(`${centerId}_c1`, centerId),
    client(`${centerId}_c2`, centerId),
    client(`${centerId}_c3`, centerId, mode === "fragile" ? { email: "", phone: "" } : {})
  ];
  const services = [
    serviceRow(`${centerId}_s1`, centerId, { priceCents: 8000, durationMin: 45 }),
    serviceRow(`${centerId}_s2`, centerId, { priceCents: 14000, durationMin: 90 })
  ];
  const staff = mode === "fragile"
    ? [staffRow(`${centerId}_op1`, centerId, { workingHours: null })]
    : [staffRow(`${centerId}_op1`, centerId), staffRow(`${centerId}_op2`, centerId)];
  const resources = mode === "fragile" ? [] : [withCenter({ id: `${centerId}_r1`, name: "Laser", active: 1 }, centerId)];
  const appointments = mode === "clean"
    ? [
      appointment(`${centerId}_a1`, centerId, clients[0].id, services[0].id, dateAt(0, 9), { staffId: `${centerId}_op1` }),
      appointment(`${centerId}_a2`, centerId, clients[1].id, services[1].id, dateAt(1, 11), { staffId: `${centerId}_op2` })
    ]
    : mode === "medium"
      ? [
        appointment(`${centerId}_m1`, centerId, clients[0].id, services[1].id, dateAt(0, 10), { status: "booked", staffId: `${centerId}_op1` }),
        appointment(`${centerId}_m2`, centerId, clients[1].id, services[0].id, dateAt(0, 10, 15), { status: "requested", staffId: `${centerId}_op1`, durationMin: 60 }),
        appointment(`${centerId}_m3`, centerId, clients[1].id, services[0].id, dateAt(-1, 10), { status: "no_show", staffId: `${centerId}_op1` })
      ]
      : [
        appointment(`${centerId}_f1`, centerId, "", "", dateAt(0, 20, 30), { status: "requested", serviceIds: [], serviceName: "", staffId: "", amountCents: 0, priceCents: 0 }),
        appointment(`${centerId}_f2`, centerId, clients[2].id, services[1].id, dateAt(1, 20, 30), { status: "booked", staffId: "", amountCents: 0, priceCents: 0 })
      ];
  const payments = appointments.slice(0, 1).map((item) => payment(`${centerId}_p1`, centerId, item.id, { clientId: item.clientId }));
  return { clients, services, staff, resources, appointments, payments, inventory: [] };
}

function installFixture(service, fixture) {
  service.clientsRepository = { list: () => fixture.clients };
  service.appointmentsRepository = { list: () => fixture.appointments };
  service.servicesRepository = { list: () => fixture.services };
  service.staffRepository = { list: () => fixture.staff };
  service.resourcesRepository = { list: () => fixture.resources };
  service.paymentsRepository = { list: () => fixture.payments };
  service.inventoryRepository = { list: () => fixture.inventory };
  service.inventoryMovementsRepository = { list: () => [] };
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
  assert(state.agendaParallel, `${label}: missing agendaParallel`);
  assert.strictEqual(state.agendaParallel.mode, "shadow", `${label}: agendaParallel must be shadow`);
  assert(["ok", "not_comparable"].includes(state.agendaParallel.status), `${label}: invalid status`);
  assert(state.agendaParallel.legacySnapshot, `${label}: missing legacy snapshot`);
  assert(state.agendaParallel.coreSnapshot, `${label}: missing core snapshot`);
  assert(state.agendaParallel.diffSnapshot, `${label}: missing diff snapshot`);
  assert(!state.agendaParallel.sourceFlags.includes("agenda_core:primary"), `${label}: AgendaCore must not be primary`);
  if (mode === "fragile") {
    assert(state.agendaParallel.sourceFlags.some((flag) => String(flag).includes("capacity:fallback")), `${label}: missing capacity fallback flag`);
  }
  return {
    tenant: label,
    status: state.agendaParallel.status,
    agreementBand: state.agendaParallel.agreementBand,
    agreementScore: state.agendaParallel.agreementScore,
    comparableMetrics: state.agendaParallel.diffSnapshot.comparableMetrics,
    warnings: state.agendaParallel.diffSnapshot.warnings,
    legacy: {
      saturation: state.agendaParallel.legacySnapshot.saturation,
      pressure: state.agendaParallel.legacySnapshot.pressure,
      need: state.agendaParallel.legacySnapshot.need,
      band: state.agendaParallel.legacySnapshot.band
    },
    core: {
      saturation: state.agendaParallel.coreSnapshot.saturation,
      pressure: state.agendaParallel.coreSnapshot.pressure,
      urgency: state.agendaParallel.coreSnapshot.urgency,
      readiness: state.agendaParallel.coreSnapshot.readiness,
      band: state.agendaParallel.coreSnapshot.band
    }
  };
}

const results = [
  runTenant("Privilege Parrucchieri", "agenda_privilege", "clean"),
  runTenant("Gold Test Centro 073", "agenda_centro_073", "medium"),
  runTenant("Gold Test Centro 100 fragile", "agenda_centro_100", "fragile")
];

const errorService = new DesktopMirrorService();
errorService.normalizeAgendaCoreSnapshot = () => { throw new Error("forced_agenda_core_failure"); };
const errorState = errorService.buildAgendaParallelState(errorService.buildDefaultGoldState("agenda_error", "Agenda Error"), session("agenda_error", "Agenda Error"));
assert.strictEqual(errorState.status, "error", "Forced failure must return status=error");
assert(errorState.diffSnapshot.warnings.includes("AGENDA_PARALLEL_ERROR"), "Forced failure must expose warning");

console.log(JSON.stringify({
  ok: true,
  mode: "shadow",
  note: "AgendaCore phase 2 is read-only: legacy agenda remains primary, no appointments moved, no data persisted.",
  tenants: results,
  forcedError: {
    status: errorState.status,
    warnings: errorState.diffSnapshot.warnings
  },
  purity: {
    writes: 0,
    appointmentsMoved: 0,
    realDataModified: false,
    uiTouched: false,
    publicApiChanged: false
  }
}, null, 2));
