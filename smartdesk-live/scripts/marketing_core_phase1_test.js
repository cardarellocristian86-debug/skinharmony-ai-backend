const assert = require("assert");
const {
  MARKETING_ACTION_BAND,
  computeMarketingSnapshot,
  inferMarketingActionBand
} = require("../src/core/marketing/MarketingCore");

const services = [
  { id: "hair-color", name: "Colore premium", priceCents: 9000, costCents: 2200 },
  { id: "hair-cut", name: "Taglio e piega", priceCents: 5500, costCents: 1600 },
  { id: "skin-basic", name: "Pulizia viso", priceCents: 7000 }
];

function appointment(id, clientId, startAt, serviceId, totalCents = 9000) {
  return { id, clientId, startAt, serviceId, status: "completed", totalCents };
}

function payment(id, clientId, createdAt, amountCents) {
  return { id, clientId, createdAt, amountCents, method: "card", appointmentId: `a-${id}` };
}

function marketing(id, clientId, createdAt, status = "done") {
  return { id, clientId, createdAt, status, type: "recall" };
}

const privilegeInput = {
  horizon: { startDate: "2026-01-01", endDate: "2026-04-20", tenant: "Privilege Parrucchieri" },
  now: "2026-04-20T10:00:00.000Z",
  goal: { type: "recall", seasonFit: 0.7 },
  schedule: { gapFit: 0.4 },
  services,
  clients: [
    { id: "p1", firstName: "Laura", lastName: "Rossi", phone: "+393331111111", email: "laura@example.it", marketingConsent: true },
    { id: "p2", firstName: "Marta", lastName: "Verdi", phone: "+393332222222", email: "marta@example.it", marketingConsent: true },
    { id: "p3", firstName: "Giulia", lastName: "Bianchi", phone: "+393333333333", email: "", marketingConsent: true },
    { id: "p4", firstName: "Sara", lastName: "Neri", phone: "", email: "", marketingConsent: false }
  ],
  appointments: [
    appointment("p1-1", "p1", "2025-11-20T09:00:00.000Z", "hair-color", 9000),
    appointment("p1-2", "p1", "2025-12-22T09:00:00.000Z", "hair-color", 9000),
    appointment("p1-3", "p1", "2026-01-24T09:00:00.000Z", "hair-color", 9000),
    appointment("p2-1", "p2", "2026-02-15T09:00:00.000Z", "hair-cut", 5500),
    appointment("p2-2", "p2", "2026-03-20T09:00:00.000Z", "hair-cut", 5500),
    appointment("p3-1", "p3", "2026-01-10T09:00:00.000Z", "skin-basic", 7000),
    appointment("p4-1", "p4", "2025-12-01T09:00:00.000Z", "hair-cut", 5500)
  ],
  payments: [
    payment("p1-1", "p1", "2025-11-20T10:00:00.000Z", 9000),
    payment("p1-2", "p1", "2025-12-22T10:00:00.000Z", 9000),
    payment("p1-3", "p1", "2026-01-24T10:00:00.000Z", 9000),
    payment("p2-1", "p2", "2026-02-15T10:00:00.000Z", 5500),
    payment("p2-2", "p2", "2026-03-20T10:00:00.000Z", 5500),
    payment("p3-1", "p3", "2026-01-10T10:00:00.000Z", 7000)
  ],
  marketingHistory: [
    marketing("m-p2", "p2", "2026-04-19T10:00:00.000Z", "done"),
    marketing("m-p2-b", "p2", "2026-04-18T10:00:00.000Z", "ignored"),
    marketing("m-p2-c", "p2", "2026-04-17T10:00:00.000Z", "ignored"),
    marketing("m-p2-d", "p2", "2026-04-16T10:00:00.000Z", "ignored"),
    marketing("m-p3", "p3", "2026-04-01T10:00:00.000Z", "ignored")
  ]
};

const mediumInput = {
  horizon: { startDate: "2026-01-01", endDate: "2026-04-20", tenant: "Gold Test Centro 073" },
  now: "2026-04-20T10:00:00.000Z",
  goal: { type: "recall", seasonFit: 0.5 },
  services,
  clients: [
    { id: "m1", firstName: "Elena", phone: "+393334444444", email: "", marketingConsent: true },
    { id: "m2", firstName: "Paola", phone: "", email: "paola@example.it", marketingConsent: true },
    { id: "m3", firstName: "Noemi", phone: "", email: "", marketingConsent: true }
  ],
  appointments: [
    appointment("m1-1", "m1", "2026-02-01T09:00:00.000Z", "hair-cut", 5500),
    appointment("m1-2", "m1", "2026-03-01T09:00:00.000Z", "hair-cut", 5500),
    appointment("m2-1", "m2", "2026-02-10T09:00:00.000Z", "skin-basic", 7000)
  ],
  payments: [
    payment("m1-1", "m1", "2026-02-01T10:00:00.000Z", 5500),
    payment("m1-2", "m1", "2026-03-01T10:00:00.000Z", 5500)
  ],
  marketingHistory: []
};

const fragileInput = {
  horizon: { startDate: "2026-01-01", endDate: "2026-04-20", tenant: "Gold Test Centro 100 fragile" },
  now: "2026-04-20T10:00:00.000Z",
  clients: [
    { id: "f1", firstName: "Cliente", phone: "", email: "", marketingConsent: false },
    { id: "f2", firstName: "", phone: "", email: "", marketingConsent: false }
  ],
  appointments: [],
  payments: [],
  services: [],
  marketingHistory: [
    marketing("f1-a", "f1", "2026-04-19T10:00:00.000Z", "ignored"),
    marketing("f1-b", "f1", "2026-04-18T10:00:00.000Z", "ignored"),
    marketing("f1-c", "f1", "2026-04-17T10:00:00.000Z", "ignored")
  ]
};

const actNowBand = inferMarketingActionBand({
  opportunityScore: 0.86,
  contactability: 0.92,
  spamPressure: 0.08,
  dataQuality: 0.82,
  timingOpportunity: 0.72,
  churnRisk: 0.72,
  value: 0.8,
  contactabilityComponents: { consent: 1 }
});
assert.strictEqual(actNowBand.actionBand, MARKETING_ACTION_BAND.ACT_NOW);

const weakDataBand = inferMarketingActionBand({
  opportunityScore: 0.65,
  contactability: 0.52,
  spamPressure: 0.2,
  dataQuality: 0.3,
  timingOpportunity: 0.7,
  contactabilityComponents: { consent: 1 }
});
assert.strictEqual(weakDataBand.actionBand, MARKETING_ACTION_BAND.VERIFY);

const spamBand = inferMarketingActionBand({
  opportunityScore: 0.7,
  contactability: 0.9,
  spamPressure: 0.9,
  dataQuality: 0.9,
  timingOpportunity: 0.8,
  contactabilityComponents: { consent: 1 }
});
assert.strictEqual(spamBand.actionBand, MARKETING_ACTION_BAND.STOP);

const privilege = computeMarketingSnapshot(privilegeInput);
const medium = computeMarketingSnapshot(mediumInput);
const fragile = computeMarketingSnapshot(fragileInput);

assert.strictEqual(privilege.mathCore, "marketing_core_v1");
assert(privilege.scores.marketingReadiness > medium.scores.marketingReadiness);
assert(fragile.scores.marketingReadiness < 0.35);
assert(privilege.topCandidates.some((item) => item.reasonCodes.includes("REACTIVATION_OPPORTUNITY")));
assert(privilege.topCandidates.some((item) => item.reasonCodes.includes("SPAM_PRESSURE_TOO_HIGH")));
assert(fragile.topCandidates.every((item) => [MARKETING_ACTION_BAND.STOP, MARKETING_ACTION_BAND.VERIFY, MARKETING_ACTION_BAND.MONITOR].includes(item.actionBand)));

console.log(JSON.stringify({
  privilege: {
    tenant: privilege.horizon.tenant,
    readiness: privilege.scores.marketingReadiness,
    averageOpportunity: privilege.scores.averageOpportunity,
    counts: privilege.counts,
    top: privilege.topCandidates.slice(0, 3).map((item) => ({
      clientId: item.clientId,
      score: item.opportunityScore,
      band: item.actionBand,
      reasons: item.reasonCodes
    }))
  },
  medium: {
    tenant: medium.horizon.tenant,
    readiness: medium.scores.marketingReadiness,
    averageOpportunity: medium.scores.averageOpportunity,
    counts: medium.counts,
    top: medium.topCandidates.slice(0, 3).map((item) => ({
      clientId: item.clientId,
      score: item.opportunityScore,
      band: item.actionBand,
      reasons: item.reasonCodes
    }))
  },
  fragile: {
    tenant: fragile.horizon.tenant,
    readiness: fragile.scores.marketingReadiness,
    averageOpportunity: fragile.scores.averageOpportunity,
    counts: fragile.counts,
    top: fragile.topCandidates.slice(0, 3).map((item) => ({
      clientId: item.clientId,
      score: item.opportunityScore,
      band: item.actionBand,
      reasons: item.reasonCodes
    }))
  }
}, null, 2));
