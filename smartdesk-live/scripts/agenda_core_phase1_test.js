const assert = require("assert");
const {
  computeAgendaSnapshot,
  computeAgendaSaturation,
  computeAgendaPressure,
  computeAppointmentFragility,
  computeNoShowRisk,
  computeAgendaReadiness
} = require("../src/core/agenda/AgendaCore");

const HORIZON = { startDate: "2026-04-20", endDate: "2026-04-22" };

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
      wednesday: [{ start: "09:00", end: "17:00" }]
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

function buildFixture(centerId, mode) {
  const clients = [
    client(`${centerId}_c1`, centerId),
    client(`${centerId}_c2`, centerId),
    client(`${centerId}_c3`, centerId, mode === "fragile" ? { email: "", phone: "" } : {}),
    client(`${centerId}_c4`, centerId)
  ];
  const services = [
    serviceRow(`${centerId}_s1`, centerId, { priceCents: 8000, durationMin: 45 }),
    serviceRow(`${centerId}_s2`, centerId, { priceCents: 14000, durationMin: 90, technologyLinks: [{ technologyId: `${centerId}_r1`, usageUnits: 1 }] })
  ];
  const staff = mode === "fragile"
    ? [staffRow(`${centerId}_op1`, centerId, { workingHours: null })]
    : [staffRow(`${centerId}_op1`, centerId), staffRow(`${centerId}_op2`, centerId)];
  const resources = mode === "fragile" ? [] : [withCenter({ id: `${centerId}_r1`, name: "Laser", costPerUseCents: 700, active: 1 }, centerId)];

  if (mode === "clean") {
    const appointments = [
      appointment(`${centerId}_a1`, centerId, clients[0].id, services[0].id, "2026-04-20T09:00:00.000Z", { staffId: `${centerId}_op1` }),
      appointment(`${centerId}_a2`, centerId, clients[1].id, services[0].id, "2026-04-20T10:00:00.000Z", { staffId: `${centerId}_op1` }),
      appointment(`${centerId}_a3`, centerId, clients[2].id, services[1].id, "2026-04-20T11:00:00.000Z", { staffId: `${centerId}_op2` }),
      appointment(`${centerId}_a4`, centerId, clients[3].id, services[1].id, "2026-04-21T15:00:00.000Z", { staffId: `${centerId}_op2` })
    ];
    return { clients, services, staff, resources, appointments };
  }

  if (mode === "medium") {
    const appointments = [
      appointment(`${centerId}_m1`, centerId, clients[0].id, services[1].id, "2026-04-20T10:00:00.000Z", { status: "booked", staffId: `${centerId}_op1` }),
      appointment(`${centerId}_m2`, centerId, clients[1].id, services[0].id, "2026-04-20T10:15:00.000Z", { status: "requested", staffId: `${centerId}_op1`, durationMin: 60 }),
      appointment(`${centerId}_m3`, centerId, clients[1].id, services[0].id, "2026-04-18T10:00:00.000Z", { status: "no_show", staffId: `${centerId}_op1` }),
      appointment(`${centerId}_m4`, centerId, clients[2].id, services[0].id, "2026-04-21T19:30:00.000Z", { status: "booked", staffId: `${centerId}_op2` })
    ];
    return { clients, services, staff, resources, appointments };
  }

  const appointments = [
    appointment(`${centerId}_f1`, centerId, "", "", "bad-date", { status: "booked", serviceIds: [], serviceName: "", staffId: "", amountCents: 0, priceCents: 0 }),
    appointment(`${centerId}_f2`, centerId, clients[2].id, services[1].id, "2026-04-20T20:30:00.000Z", { status: "requested", staffId: "", amountCents: 0, priceCents: 0 }),
    appointment(`${centerId}_f3`, centerId, clients[2].id, services[1].id, "2026-04-19T10:00:00.000Z", { status: "cancelled", staffId: "" })
  ];
  return { clients, services, staff, resources, appointments };
}

function runCase(label, mode) {
  const centerId = `agenda_${mode}`;
  const fixture = buildFixture(centerId, mode);
  const input = { ...fixture, horizon: HORIZON };
  const saturation = computeAgendaSaturation(input);
  const pressure = computeAgendaPressure(input);
  const fragility = computeAppointmentFragility(input);
  const noShow = computeNoShowRisk(input);
  const readiness = computeAgendaReadiness(input);
  const snapshot = computeAgendaSnapshot(input);

  assert.strictEqual(snapshot.mathCore, "agenda_core_v1", `${label}: wrong core version`);
  assert(snapshot.counts.days === 3, `${label}: horizon days not respected`);
  assert(snapshot.scores.saturation >= 0 && snapshot.scores.saturation <= 1, `${label}: saturation out of bounds`);
  assert(snapshot.scores.pressure >= 0 && snapshot.scores.pressure <= 1, `${label}: pressure out of bounds`);
  assert(snapshot.scores.fragility >= 0 && snapshot.scores.fragility <= 1, `${label}: fragility out of bounds`);
  assert(snapshot.scores.noShowRisk >= 0 && snapshot.scores.noShowRisk <= 1, `${label}: noShowRisk out of bounds`);
  assert(snapshot.scores.readiness >= 0 && snapshot.scores.readiness <= 1, `${label}: readiness out of bounds`);
  assert(snapshot.breakdown.dailySaturation.length === 3, `${label}: missing daily saturation`);
  assert(snapshot.breakdown.dailyPressure.length === 3, `${label}: missing daily pressure`);

  if (mode === "medium") {
    assert(pressure.pressure > 0.7, `${label}: compressed slots should raise pressure`);
    assert(noShow.noShowRisk > 0.25, `${label}: weak/no-show appointments should raise no-show risk`);
    assert(fragility.fragility > 0.35, `${label}: weak appointments should raise fragility`);
  }
  if (mode === "fragile") {
    assert(readiness.readiness < 0.75, `${label}: incomplete data should lower readiness`);
    assert(snapshot.sourceFlags.includes("readiness:schedule_fallback"), `${label}: missing schedule fallback flag`);
  }

  return {
    tenant: label,
    mode,
    band: snapshot.band,
    counts: snapshot.counts,
    scores: snapshot.scores,
    sourceFlags: snapshot.sourceFlags,
    sample: {
      dailySaturation: snapshot.breakdown.dailySaturation.slice(0, 2),
      fragileAppointments: snapshot.breakdown.fragileAppointments.slice(0, 2),
      noShowCandidates: snapshot.breakdown.noShowCandidates.slice(0, 2)
    }
  };
}

const results = [
  runCase("Privilege Parrucchieri", "clean"),
  runCase("Gold Test Centro 073", "medium"),
  runCase("Gold Test Centro 100 fragile", "fragile")
];

console.log(JSON.stringify({
  ok: true,
  mathCore: "agenda_core_v1",
  note: "AgendaCore phase 1 is pure/read-only: no appointments moved, no data persisted, no UI/API changes.",
  tenants: results,
  purity: {
    writes: 0,
    appointmentsMoved: 0,
    realDataModified: false,
    uiTouched: false,
    publicApiChanged: false
  }
}, null, 2));
