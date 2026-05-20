"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const CENTER_ID = "center_admin";
const CENTER_NAME = "SkinHarmony Demo Gold";
const APPLY = process.argv.includes("--apply");

function iso(daysOffset = 0, hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function dateOnly(daysOffset = 0) {
  return iso(daysOffset).slice(0, 10);
}

function readJson(name, fallback = []) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(name, data) {
  const file = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function withoutCenter(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => String(row.centerId || "") !== CENTER_ID);
}

function cents(euro) {
  return Math.round(Number(euro || 0) * 100);
}

const staff = [
  { id: "gold-op-1", centerId: CENTER_ID, name: "Elena Rossi", role: "Senior specialist", hourlyCostCents: cents(24), active: true, createdAt: iso(-180) },
  { id: "gold-op-2", centerId: CENTER_ID, name: "Marta Bianchi", role: "Beauty operator", hourlyCostCents: cents(19), active: true, createdAt: iso(-180) },
  { id: "gold-op-3", centerId: CENTER_ID, name: "Giulia Neri", role: "Reception e recall", hourlyCostCents: cents(17), active: true, createdAt: iso(-180) }
];

const services = [
  { id: "gold-svc-1", centerId: CENTER_ID, name: "Skin Reset Premium", category: "viso", durationMin: 60, priceCents: cents(95), materialCostCents: cents(12), technologyCostCents: cents(8), active: true },
  { id: "gold-svc-2", centerId: CENTER_ID, name: "Protocollo O3 Glow", category: "tecnologia", durationMin: 75, priceCents: cents(135), materialCostCents: cents(18), technologyCostCents: cents(22), active: true },
  { id: "gold-svc-3", centerId: CENTER_ID, name: "Percorso Corpo Method", category: "corpo", durationMin: 70, priceCents: cents(120), materialCostCents: cents(16), technologyCostCents: cents(18), active: true },
  { id: "gold-svc-4", centerId: CENTER_ID, name: "Check Pelle + Piano", category: "consulenza", durationMin: 35, priceCents: cents(45), materialCostCents: cents(3), technologyCostCents: cents(0), active: true }
];

const clients = [
  ["gold-cli-1", "Laura Conti", "alta", true, -18, 980],
  ["gold-cli-2", "Sara Ferri", "media", true, -42, 620],
  ["gold-cli-3", "Beatrice Villa", "alta", true, -65, 1240],
  ["gold-cli-4", "Monica Greco", "bassa", false, -22, 310],
  ["gold-cli-5", "Chiara Longo", "media", true, -35, 540],
  ["gold-cli-6", "Valentina Costa", "alta", true, -78, 860],
  ["gold-cli-7", "Irene Ricci", "bassa", true, -9, 260],
  ["gold-cli-8", "Paola Riva", "media", true, -31, 490],
  ["gold-cli-9", "Silvia Romano", "storico", false, -120, 760],
  ["gold-cli-10", "Federica Marchetti", "alta", true, -54, 1110],
  ["gold-cli-11", "Alice Fontana", "media", true, -28, 430],
  ["gold-cli-12", "Martina Leone", "bassa", true, -14, 350]
].map(([id, name, tier, consent, lastVisitOffset, spend], index) => {
  const [firstName, lastName] = String(name).split(" ");
  return {
    id,
    centerId: CENTER_ID,
    firstName,
    lastName,
    name,
    phone: `+39333100${String(index + 1).padStart(3, "0")}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@demo.skinharmony.local`,
    marketingConsent: Boolean(consent),
    privacyConsent: true,
    consentSource: "demo_gold_seed",
    lastVisit: iso(Number(lastVisitOffset), 11),
    lifetimeValueCents: cents(Number(spend)),
    notes: `Profilo demo ${tier}: usare per cockpit Gold, recall e customer intelligence.`,
    createdAt: iso(-170 + index),
    updatedAt: iso(-1)
  };
});

const appointments = [];
const payments = [];
const treatments = [];
for (let month = 4; month >= 0; month -= 1) {
  clients.forEach((client, index) => {
    if ((index + month) % 3 === 0 && month < 4) return;
    const service = services[(index + month) % services.length];
    const operator = staff[(index + month) % staff.length];
    const daysOffset = -((month * 28) + ((index * 3) % 21));
    const appointmentId = `gold-app-${month}-${index + 1}`;
    const amountCents = service.priceCents + (index % 4 === 0 ? cents(25) : 0);
    appointments.push({
      id: appointmentId,
      centerId: CENTER_ID,
      clientId: client.id,
      clientName: client.name,
      staffId: operator.id,
      staffName: operator.name,
      serviceId: service.id,
      serviceName: service.name,
      startAt: iso(daysOffset, 9 + (index % 7), index % 2 ? 30 : 0),
      durationMin: service.durationMin,
      status: daysOffset < -2 ? "completed" : "confirmed",
      notes: "Seduta demo Gold per lettura centro, continuita e redditivita.",
      createdAt: iso(daysOffset - 3)
    });
    if (daysOffset < -2) {
      payments.push({
        id: `gold-pay-${month}-${index + 1}`,
        centerId: CENTER_ID,
        clientId: client.id,
        clientName: client.name,
        appointmentId,
        amountCents,
        method: index % 2 ? "card" : "cash",
        paidAt: iso(daysOffset, 12),
        createdAt: iso(daysOffset, 12)
      });
      treatments.push({
        id: `gold-trt-${month}-${index + 1}`,
        centerId: CENTER_ID,
        clientId: client.id,
        clientName: client.name,
        serviceId: service.id,
        serviceName: service.name,
        area: service.category,
        objective: index % 2 ? "continuita percorso" : "migliorare luminosita e texture",
        result: "Output demo: follow-up consigliato, nessun claim medico.",
        createdAt: iso(daysOffset, 13)
      });
    }
  });
}

const inventory = [
  { id: "gold-stock-1", centerId: CENTER_ID, name: "Siero Reset Barrier", category: "cabina", quantity: 4, minQuantity: 6, costCents: cents(18), retailPriceCents: cents(49), active: true },
  { id: "gold-stock-2", centerId: CENTER_ID, name: "Maschera O3 Glow", category: "cabina", quantity: 12, minQuantity: 5, costCents: cents(9), retailPriceCents: cents(29), active: true },
  { id: "gold-stock-3", centerId: CENTER_ID, name: "Crema Home Care Premium", category: "rivendita", quantity: 7, minQuantity: 8, costCents: cents(22), retailPriceCents: cents(65), active: true }
];

const settings = {
  ...readJson("settings", {}),
  centerName: CENTER_NAME,
  businessModel: "esthetic",
  enableMarketing: true,
  enableCashdesk: true,
  enableTreatments: true,
  enableProtocolsHub: true,
  inventoryBaseEnabled: true,
  inventoryMovementsEnabled: true,
  inventoryAlertsEnabled: true,
  profitabilityEnabled: true,
  profitabilityOperatorCostEnabled: true,
  profitabilityTechnologyAnalysisEnabled: true
};

const plan = {
  users: readJson("users", []).map((user) => String(user.role || "") === "superadmin"
    ? { ...user, centerId: CENTER_ID, centerName: CENTER_NAME, subscriptionPlan: "gold", planType: "active", accountStatus: "active", paymentStatus: "paid" }
    : user),
  staff: [...withoutCenter(readJson("staff", [])), ...staff],
  services: [...withoutCenter(readJson("services", [])), ...services],
  clients: [...withoutCenter(readJson("clients", [])), ...clients],
  appointments: [...withoutCenter(readJson("appointments", [])), ...appointments],
  payments: [...withoutCenter(readJson("payments", [])), ...payments],
  treatments: [...withoutCenter(readJson("treatments", [])), ...treatments],
  inventory: [...withoutCenter(readJson("inventory", [])), ...inventory],
  ai_marketing_actions: withoutCenter(readJson("ai_marketing_actions", [])),
  gold_state: withoutCenter(readJson("gold_state", [])),
  settings
};

const summary = {
  mode: APPLY ? "apply" : "dry-run",
  centerId: CENTER_ID,
  centerName: CENTER_NAME,
  counts: {
    staff: staff.length,
    services: services.length,
    clients: clients.length,
    appointments: appointments.length,
    payments: payments.length,
    treatments: treatments.length,
    inventory: inventory.length
  },
  rule: "Demo Gold leggibile: dati reali simulati, costi completi, consensi misti, recall e redditivita pronti per cockpit."
};

if (APPLY) {
  Object.entries(plan).forEach(([name, data]) => writeJson(name, data));
}

console.log(JSON.stringify(summary, null, 2));
