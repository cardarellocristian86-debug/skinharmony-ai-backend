const assert = require("assert");
const {
  computeDataQualitySnapshot
} = require("../src/core/data-quality/DataQualityCore");

function iso(monthOffset = 0, day = 10) {
  const date = new Date("2025-01-10T10:00:00.000Z");
  date.setMonth(date.getMonth() + monthOffset);
  date.setDate(day);
  return date.toISOString();
}

function client(id, overrides = {}) {
  return {
    id,
    firstName: `Cliente${id}`,
    lastName: "Test",
    email: `${id}@example.com`,
    phone: `+39340${String(id).replace(/\D/g, "").padStart(7, "0").slice(0, 7)}`,
    createdAt: iso(0),
    lastVisit: iso(10),
    active: 1,
    ...overrides
  };
}

function service(id, overrides = {}) {
  return {
    id,
    name: `Servizio ${id}`,
    priceCents: 9000,
    durationMin: 45,
    productLinks: [{ productId: "prod_1", usageUnits: 1, unitCostCents: 900 }],
    technologyLinks: [{ technologyId: "tech_1", usageUnits: 1, costPerUseCents: 700 }],
    active: 1,
    ...overrides
  };
}

function appointment(id, clientId, serviceId, month, overrides = {}) {
  return {
    id,
    clientId,
    serviceId,
    serviceIds: [serviceId],
    startAt: iso(month, 10),
    endAt: iso(month, 10).replace("10:00:00.000Z", "10:45:00.000Z"),
    status: "completed",
    priceCents: 9000,
    createdAt: iso(month, 1),
    ...overrides
  };
}

function payment(id, clientId, appointmentId, month, overrides = {}) {
  return {
    id,
    clientId,
    appointmentId,
    amountCents: 9000,
    method: "card",
    createdAt: iso(month, 10).replace("10:00:00.000Z", "11:00:00.000Z"),
    ...overrides
  };
}

function buildTenant({ name, clean = true, medium = false, fragile = false, drift = false }) {
  const clients = clean
    ? Array.from({ length: 12 }, (_, index) => client(`c${index + 1}`))
    : medium
      ? [
        client("m1", { email: "" }),
        client("m2", { phone: "" }),
        client("m3"),
        client("m4", { lastName: "", email: "" }),
        client("m5")
      ]
      : [
        client("f1", { firstName: "", lastName: "", email: "", phone: "", lastVisit: "" }),
        client("f2", { firstName: "", lastName: "", email: "", phone: "", lastVisit: "" })
      ];
  const services = clean
    ? [service("s1"), service("s2", { priceCents: 12000 })]
    : medium
      ? [service("ms1", { productLinks: [], estimatedProductCostCents: 1200, technologyLinks: [] }), service("ms2", { productLinks: [], technologyLinks: [], priceCents: 7000 })]
      : [service("fs1", { priceCents: 0, productLinks: [], technologyLinks: [], durationMin: 0 })];
  const staff = clean || medium
    ? [{ id: "op1", name: "Operatore", hourlyCostCents: 1800, active: 1 }]
    : [{ id: "op_fragile", name: "", hourlyCostCents: 0, active: 1 }];
  const inventory = clean
    ? [{ id: "prod_1", name: "Prodotto", unitCostCents: 900, costCents: 900, quantity: 20, active: 1 }]
    : [];
  const resources = clean
    ? [{ id: "tech_1", name: "Tecnologia", costPerUseCents: 700, active: 1 }]
    : [];
  const appointments = clean
    ? Array.from({ length: 12 }, (_, index) => appointment(`a${index + 1}`, clients[index].id, index % 2 ? "s2" : "s1", index))
    : medium
      ? [
        appointment("ma1", "m1", "ms1", 5),
        appointment("ma2", "m2", "ms2", 6, { status: "booked" }),
        appointment("ma3", "", "ms2", 7, { walkInName: "Walk in" }),
        appointment("ma4", "m4", "", 8, { serviceIds: [], serviceName: "Servizio libero" })
      ]
      : [
        appointment("fa1", "", "", 10, { serviceIds: [], startAt: "not-a-date", endAt: iso(9), status: "unknown", priceCents: -1 }),
        appointment("fa2", "", "", 10, { serviceIds: [], serviceName: "", endAt: iso(9), status: "" })
      ];
  const payments = clean
    ? appointments.map((item, index) => payment(`p${index + 1}`, item.clientId, item.id, index, { amountCents: item.priceCents || 9000 }))
    : medium
      ? [
        payment("mp1", "m1", "ma1", 5),
        payment("mp2", "m2", "", 6),
        payment("mp3", "", "", 7, { method: "cash" }),
        payment("mp4", "m4", "ma4", 8, { method: "" })
      ]
      : [
        payment("fp1", "", "", 10, { amountCents: 0, method: "", createdAt: "" }),
        payment("fp2", "", "", 10, { method: "", createdAt: "bad-date" })
      ];
  const revenue = payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const unlinked = payments.filter((item) => !item.clientId || !item.appointmentId).reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const goldState = {
    components: { Rev: drift ? revenue * 2 : revenue, U: drift ? 99 : unlinked, DQ: clean ? 0.94 : medium ? 0.68 : 0.15, Conf: clean ? 0.93 : medium ? 0.6 : 0.1 },
    counters: {
      revenueTotalCents: drift ? revenue * 2 : revenue,
      clientsTotal: drift ? clients.length * 3 : clients.length,
      todayAppointments: appointments.length,
      unlinkedPayments: unlinked
    },
    cashPrimarySnapshot: {
      recordedCashCents: drift ? revenue * 2 : revenue,
      unlinkedCashCents: drift ? unlinked + 50000 : unlinked
    }
  };
  return {
    name,
    input: {
      horizon: { startDate: "2025-01-01", endDate: "2026-01-31" },
      clients,
      appointments,
      payments,
      services,
      staff,
      inventory,
      resources,
      goldState
    }
  };
}

const privilege = buildTenant({ name: "Privilege Parrucchieri", clean: true });
const intermediate = buildTenant({ name: "Gold Test Centro 073", clean: false, medium: true });
const fragile = buildTenant({ name: "Tenant fragile incompleto", clean: false, fragile: true, drift: true });

const privilegeSnapshot = computeDataQualitySnapshot(privilege.input);
const intermediateSnapshot = computeDataQualitySnapshot(intermediate.input);
const fragileSnapshot = computeDataQualitySnapshot(fragile.input);

assert(["REAL", "STANDARD"].includes(privilegeSnapshot.band), "Privilege fixture should be REAL/STANDARD");
assert(["STANDARD", "ESTIMATED"].includes(intermediateSnapshot.band), "Intermediate fixture should be STANDARD/ESTIMATED");
assert.strictEqual(fragileSnapshot.band, "INCOMPLETE", "Fragile fixture should be INCOMPLETE");
assert(intermediateSnapshot.scores.paymentQuality < privilegeSnapshot.scores.paymentQuality, "Unlinked payments must lower payment quality");
assert(intermediateSnapshot.scores.linkQuality < privilegeSnapshot.scores.linkQuality, "Unlinked payments must lower link quality");
assert(intermediateSnapshot.scores.costQuality < privilegeSnapshot.scores.costQuality, "Missing costs must lower cost quality");
assert(fragileSnapshot.scores.consistencyQuality < intermediateSnapshot.scores.consistencyQuality, "Drift must lower consistency quality");
assert(fragileSnapshot.scores.temporalQuality < privilegeSnapshot.scores.temporalQuality, "Temporal incoherence must lower temporal quality");

const report = [privilege, intermediate, fragile].map((tenant) => {
  const snapshot = computeDataQualitySnapshot(tenant.input);
  return {
    tenant: tenant.name,
    band: snapshot.band,
    score: snapshot.scores.dataQualityScore,
    crm: snapshot.scores.crmQuality,
    appointments: snapshot.scores.appointmentQuality,
    payments: snapshot.scores.paymentQuality,
    costs: snapshot.scores.costQuality,
    links: snapshot.scores.linkQuality,
    consistency: snapshot.scores.consistencyQuality,
    temporal: snapshot.scores.temporalQuality,
    gate: snapshot.gate,
    sourceFlags: snapshot.sourceFlags
  };
});

console.log(JSON.stringify({
  ok: true,
  mathCore: "data_quality_core_v1",
  note: "Read-only deterministic fixtures. No repositories or real records modified.",
  tenants: report
}, null, 2));
