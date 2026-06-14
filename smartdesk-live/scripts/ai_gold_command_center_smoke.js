const assert = require("assert");
const { AssistantService } = require("../src/AssistantService");

const session = {
  userId: "smoke-owner",
  username: "smoke-owner",
  role: "owner",
  subscriptionPlan: "gold",
  centerId: "center_smoke",
  centerName: "Centro Smoke Gold"
};

const mirror = {
  getPlanLevel: () => "gold",
  getSettings: () => ({
    inventoryBaseEnabled: true,
    profitabilityEnabled: true,
    enableProtocolsHub: true,
    enableTrainingHub: true,
    operatorReportsEnabled: true
  }),
  getDashboardStats: () => ({
    todayAppointments: 1,
    inactiveClientsCount: 2,
    completedAppointments: 4,
    activeClientsCount: 12
  }),
  getDataQuality: () => ({
    score: 82,
    status: "buono",
    metrics: {}
  }),
  getGoldCapabilities: () => ({
    aiGoldEnabled: true,
    requiresConfirmation: true
  }),
  getGoldDecisionContext: () => ({
    primaryAction: {
      id: "growth_recall",
      domain: "growth",
      label: "Recupera clienti inattivi",
      canExecute: true
    },
    blockedActions: []
  }),
  listClients: () => [
    { id: "cli-laura", firstName: "Laura", lastName: "Bianchi", phone: "+393331111111" },
    { id: "cli-maria", firstName: "Maria", lastName: "Rossi", phone: "+393332222222" }
  ],
  listStaff: () => [
    { id: "stf-anna", name: "Anna" },
    { id: "stf-marta", name: "Marta" }
  ],
  listServices: () => [
    { id: "srv-colore", name: "Colore", durationMin: 75 },
    { id: "srv-taglio", name: "Taglio", durationMin: 45 }
  ],
  listProtocols: () => []
};

async function ask(service, message) {
  return service.chat({
    message,
    page: "/ai-gold",
    context: {
      currentPage: "ai-gold",
      currentModule: "ai-gold",
      userRole: "owner",
      activePeriod: { startDate: "2026-06-01", endDate: "2026-06-14" }
    }
  }, session);
}

async function main() {
  process.env.SMARTDESK_AI_PROVIDER = "corelia_only";
  const service = new AssistantService(mirror);

  const openCashdesk = await ask(service, "apri cassa");
  assert.strictEqual(openCashdesk.mode, "action");
  assert.strictEqual(openCashdesk.action, "open_cashdesk");

  const openServices = await ask(service, "apri servizi e operatori");
  assert.strictEqual(openServices.mode, "action");
  assert.strictEqual(openServices.action, "open_services");

  const openMarketing = await ask(service, "prepara recall clienti inattivi");
  assert.strictEqual(openMarketing.mode, "action");
  assert.strictEqual(openMarketing.action, "open_marketing");

  const createClient = await ask(service, "crea cliente Mario Verdi 3331234567");
  assert.strictEqual(createClient.mode, "action");
  assert.strictEqual(createClient.action, "create_client");
  assert.strictEqual(createClient.requiresConfirmation, true);
  assert.strictEqual(createClient.payload.firstName, "Mario");

  const appointmentExisting = await ask(service, "aggiungi appuntamento a Maria Rossi domani alle 15 con Anna per colore");
  assert.strictEqual(appointmentExisting.mode, "action");
  assert.strictEqual(appointmentExisting.action, "create_appointment");
  assert.strictEqual(appointmentExisting.requiresConfirmation, true);
  assert.strictEqual(appointmentExisting.payload.clientId, "cli-maria");
  assert.strictEqual(appointmentExisting.payload.staffId, "stf-anna");
  assert.strictEqual(appointmentExisting.payload.serviceId, "srv-colore");
  assert.strictEqual(appointmentExisting.payload.time, "15:00");

  const appointmentWalkIn = await ask(service, "aggiungi appuntamento a Giada Neri domani alle 16 con Anna per taglio");
  assert.strictEqual(appointmentWalkIn.mode, "action");
  assert.strictEqual(appointmentWalkIn.action, "create_appointment");
  assert.strictEqual(appointmentWalkIn.requiresConfirmation, true);
  assert.strictEqual(appointmentWalkIn.payload.clientId, "");
  assert.strictEqual(appointmentWalkIn.payload.walkInName, "Giada Neri");
  assert.strictEqual(appointmentWalkIn.payload.serviceId, "srv-taglio");

  const shift = await ask(service, "crea turno Anna domani dalle 9 alle 18");
  assert.strictEqual(shift.mode, "action");
  assert.strictEqual(shift.action, "create_shift");
  assert.strictEqual(shift.requiresConfirmation, true);
  assert.strictEqual(shift.payload.staffId, "stf-anna");

  const blocked = await ask(service, "elimina tutti i clienti");
  assert.strictEqual(blocked.mode, "blocked_action");
  assert.strictEqual(blocked.provider, "core_required");

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "open_cashdesk",
      "open_services",
      "open_marketing",
      "create_client",
      "create_appointment_existing_client",
      "create_appointment_walk_in",
      "create_shift",
      "blocked_destructive"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
