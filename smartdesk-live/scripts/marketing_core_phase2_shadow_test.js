const assert = require("assert");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

const session = {
  centerId: "center_admin",
  centerName: "Privilege Parrucchieri",
  subscriptionPlan: "gold",
  accessState: "active"
};

function repo(items) {
  return {
    list: () => items,
    findById: (id) => items.find((item) => String(item.id) === String(id)) || null
  };
}

function appointment(id, clientId, startAt, serviceId, totalCents = 9000) {
  return { id, centerId: "center_admin", clientId, startAt, serviceId, status: "completed", totalCents };
}

function payment(id, clientId, createdAt, amountCents) {
  return { id, centerId: "center_admin", clientId, createdAt, amountCents, appointmentId: `a-${id}` };
}

function marketing(id, clientId, createdAt, status = "done") {
  return { id, centerId: "center_admin", clientId, createdAt, status, type: "recall" };
}

function installFixture(service, variant = "privilege") {
  const services = [
    { id: "hair-color", centerId: "center_admin", name: "Colore premium", priceCents: 9000, costCents: 2200 },
    { id: "hair-cut", centerId: "center_admin", name: "Taglio e piega", priceCents: 5500, costCents: 1600 }
  ];
  const clients = variant === "fragile"
    ? [
        { id: "f1", centerId: "center_admin", firstName: "Cliente", phone: "", email: "", marketingConsent: false },
        { id: "f2", centerId: "center_admin", firstName: "", phone: "", email: "", marketingConsent: false }
      ]
    : [
        { id: "p1", centerId: "center_admin", firstName: "Laura", phone: "+393331111111", email: "laura@example.it", marketingConsent: true },
        { id: "p2", centerId: "center_admin", firstName: "Marta", phone: "+393332222222", email: "marta@example.it", marketingConsent: true },
        { id: "p3", centerId: "center_admin", firstName: "Giulia", phone: "+393333333333", email: "", marketingConsent: true },
        { id: "p4", centerId: "center_admin", firstName: "Sara", phone: "", email: "", marketingConsent: false }
      ];
  const appointments = variant === "fragile"
    ? []
    : [
        appointment("p1-1", "p1", "2025-11-20T09:00:00.000Z", "hair-color", 9000),
        appointment("p1-2", "p1", "2025-12-22T09:00:00.000Z", "hair-color", 9000),
        appointment("p1-3", "p1", "2026-01-24T09:00:00.000Z", "hair-color", 9000),
        appointment("p2-1", "p2", "2026-02-15T09:00:00.000Z", "hair-cut", 5500),
        appointment("p2-2", "p2", "2026-03-20T09:00:00.000Z", "hair-cut", 5500),
        appointment("p3-1", "p3", "2026-01-10T09:00:00.000Z", "hair-cut", 5500)
      ];
  const payments = variant === "fragile"
    ? []
    : [
        payment("p1-1", "p1", "2025-11-20T10:00:00.000Z", 9000),
        payment("p1-2", "p1", "2025-12-22T10:00:00.000Z", 9000),
        payment("p1-3", "p1", "2026-01-24T10:00:00.000Z", 9000),
        payment("p2-1", "p2", "2026-02-15T10:00:00.000Z", 5500),
        payment("p2-2", "p2", "2026-03-20T10:00:00.000Z", 5500),
        payment("p3-1", "p3", "2026-01-10T10:00:00.000Z", 5500)
      ];
  const marketingHistory = variant === "fragile"
    ? [
        marketing("f1-a", "f1", "2026-04-19T10:00:00.000Z", "ignored"),
        marketing("f1-b", "f1", "2026-04-18T10:00:00.000Z", "ignored"),
        marketing("f1-c", "f1", "2026-04-17T10:00:00.000Z", "ignored")
      ]
    : [
        marketing("m-p2", "p2", "2026-04-19T10:00:00.000Z", "done"),
        marketing("m-p3", "p3", "2026-04-01T10:00:00.000Z", "ignored")
      ];
  service.clientsRepository = repo(clients);
  service.appointmentsRepository = repo(appointments);
  service.paymentsRepository = repo(payments);
  service.servicesRepository = repo(services);
  service.aiMarketingActionsRepository = repo(marketingHistory);
  service.whatsappMessagesRepository = repo([]);
}

const service = new DesktopMirrorService();
installFixture(service, "privilege");
const legacyState = {
  marketingActions: {
    generatedAt: "2026-04-20T10:00:00.000Z",
    actions: [
      { clientId: "p1", clientName: "Laura", contactable: true, hasMarketingConsent: true, phone: "+393331111111", goldDecision: { score: 0.65 } },
      { clientId: "p3", clientName: "Giulia", contactable: true, hasMarketingConsent: true, phone: "+393333333333", goldDecision: { score: 0.49 } }
    ],
    counters: { totalActions: 2 },
    debug: { clientsAnalyzed: 4, excludedByFilter: 2, nonContactable: 1 }
  }
};
const parallel = service.buildMarketingParallelState(legacyState, session);
assert.strictEqual(parallel.mode, "shadow");
assert.strictEqual(parallel.status, "ok");
assert.strictEqual(parallel.mathCore, "marketing_core_v1");
assert.strictEqual(parallel.mathAdapter, "marketing_policy_adapter_v1");
assert(parallel.coreSnapshot);
assert(parallel.comparableSnapshot);
assert(parallel.legacySnapshot);
assert(parallel.diffSnapshot.comparableMetrics.includes("eligibleRatio"));
assert(Number.isFinite(parallel.agreementScore));
assert(Number.isFinite(parallel.rawAgreementScore));
assert(parallel.agreementScore >= parallel.rawAgreementScore);
assert(parallel.sourceFlags.includes("marketing_parallel:agreement_uses_policy_adapter_comparable_snapshot"));

installFixture(service, "fragile");
const fragile = service.buildMarketingParallelState({
  marketingActions: {
    actions: [],
    counters: { totalActions: 0 },
    debug: { clientsAnalyzed: 2, excludedByFilter: 2, nonContactable: 2 }
  }
}, session);
assert.strictEqual(fragile.status, "ok");
assert(fragile.coreSnapshot.readiness < 0.35);
assert(fragile.coreSnapshot.suppressedClients >= 1);

const failing = new DesktopMirrorService();
failing.clientsRepository = { list: () => { throw new Error("forced marketing core failure"); } };
const errorState = failing.buildMarketingParallelState({ marketingActions: legacyState.marketingActions }, session);
assert.strictEqual(errorState.status, "error");
assert.strictEqual(errorState.diffSnapshot.warnings[0], "MARKETING_PARALLEL_ERROR");

console.log(JSON.stringify({
  privilege: {
    status: parallel.status,
    agreementScore: parallel.agreementScore,
    agreementBand: parallel.agreementBand,
    rawAgreementScore: parallel.rawAgreementScore,
    rawAgreementBand: parallel.rawAgreementBand,
    comparableMetrics: parallel.diffSnapshot.comparableMetrics,
    warnings: parallel.diffSnapshot.warnings,
    comparable: {
      averageOpportunity: parallel.comparableSnapshot.averageOpportunity,
      eligibleClients: parallel.comparableSnapshot.eligibleClients,
      contactableClients: parallel.comparableSnapshot.contactableClients,
      suppressedClients: parallel.comparableSnapshot.suppressedClients
    },
    core: {
      readiness: parallel.coreSnapshot.readiness,
      averageOpportunity: parallel.coreSnapshot.averageOpportunity,
      eligibleClients: parallel.coreSnapshot.eligibleClients,
      contactableClients: parallel.coreSnapshot.contactableClients,
      suppressedClients: parallel.coreSnapshot.suppressedClients
    }
  },
  fragile: {
    status: fragile.status,
    agreementScore: fragile.agreementScore,
    agreementBand: fragile.agreementBand,
    warnings: fragile.diffSnapshot.warnings,
    core: {
      readiness: fragile.coreSnapshot.readiness,
      averageOpportunity: fragile.coreSnapshot.averageOpportunity,
      eligibleClients: fragile.coreSnapshot.eligibleClients,
      contactableClients: fragile.coreSnapshot.contactableClients,
      suppressedClients: fragile.coreSnapshot.suppressedClients
    }
  },
  forcedError: {
    status: errorState.status,
    warnings: errorState.diffSnapshot.warnings
  }
}, null, 2));
