"use strict";

const BASE_USERNAME = String(process.env.SMARTDESK_DEMO_BASE_USERNAME || "demo_base_plan");
const BASE_PASSWORD = String(process.env.SMARTDESK_DEMO_BASE_PASSWORD || "");
const SILVER_USERNAME = String(process.env.SMARTDESK_DEMO_SILVER_USERNAME || "demo_silver_plan");
const SILVER_PASSWORD = String(process.env.SMARTDESK_DEMO_SILVER_PASSWORD || "");
const APPLY = process.argv.includes("--apply");
const LIVE_CONFIRM = process.argv.includes("--i-understand-live");
const INTERNAL_RENDER_JOB = process.argv.includes("--internal-render-job");

function cents(euro) {
  return Math.round(Number(euro || 0) * 100);
}

function iso(daysOffset = 0, hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

async function flushPersistence(adapter) {
  if (!adapter?.writeChains) return;
  await Promise.allSettled(Array.from(adapter.writeChains.values()));
  if (adapter.pool?.end) await adapter.pool.end();
}

function buildPlanDemoConfig() {
  return [
    {
      plan: "base",
      username: BASE_USERNAME,
      password: BASE_PASSWORD,
      centerId: "center_demo_base_plan",
      centerName: "SkinHarmony Demo Base",
      contactEmail: "demo.base@demo.skinharmony.local",
      marker: "SHBASE_DEMO",
      settings: {
        centerName: "SkinHarmony Demo Base",
        businessModel: "esthetic",
        enableMarketing: true,
        enableCashdesk: true,
        enableTreatments: false,
        enableProtocolsHub: true,
        inventoryBaseEnabled: true,
        inventoryMovementsEnabled: false,
        inventoryAlertsEnabled: false,
        profitabilityEnabled: false
      }
    },
    {
      plan: "silver",
      username: SILVER_USERNAME,
      password: SILVER_PASSWORD,
      centerId: "center_demo_silver_plan",
      centerName: "SkinHarmony Demo Silver",
      contactEmail: "demo.silver@demo.skinharmony.local",
      marker: "SHSILVER_DEMO",
      settings: {
        centerName: "SkinHarmony Demo Silver",
        businessModel: "esthetic",
        enableMarketing: true,
        enableCashdesk: true,
        enableTreatments: true,
        enableProtocolsHub: true,
        inventoryBaseEnabled: true,
        inventoryMovementsEnabled: true,
        inventoryAlertsEnabled: true,
        profitabilityEnabled: true,
        profitabilityOperatorCostEnabled: true
      }
    }
  ];
}

async function seedOperationalData(service, session, marker) {
  const staff = await Promise.all([
    service.saveStaff({ name: "Anna Demo", role: "Operatrice", hourlyCostCents: cents(18), active: true }, session),
    service.saveStaff({ name: "Luca Demo", role: "Reception", hourlyCostCents: cents(15), active: true }, session)
  ]);
  const services = await Promise.all([
    service.saveService({ name: "Check pelle demo", category: "consulenza", durationMin: 35, priceCents: cents(45), estimatedProductCostCents: cents(3), active: true }, session),
    service.saveService({ name: "Trattamento viso demo", category: "viso", durationMin: 60, priceCents: cents(85), estimatedProductCostCents: cents(12), technologyCostCents: cents(6), active: true }, session)
  ]);
  const clients = [
    service.saveClient({
      firstName: "Giulia",
      lastName: "Demo",
      phone: "+393330001001",
      email: `giulia.${marker.toLowerCase()}@demo.skinharmony.local`,
      marketingConsent: true,
      privacyConsent: true,
      consentSource: marker,
      lastVisit: iso(-21, 11),
      totalValue: cents(180),
      notes: `${marker} cliente demo per test accesso piano.`,
      idempotencyKey: `${marker}:client:1`
    }, session),
    service.saveClient({
      firstName: "Marta",
      lastName: "Demo",
      phone: "+393330001002",
      email: `marta.${marker.toLowerCase()}@demo.skinharmony.local`,
      marketingConsent: true,
      privacyConsent: true,
      consentSource: marker,
      lastVisit: iso(-55, 10),
      totalValue: cents(320),
      notes: `${marker} cliente inattiva per test recall manuale/read-only.`,
      idempotencyKey: `${marker}:client:2`
    }, session)
  ];
  const inventory = [
    service.saveInventoryItem({ name: "Crema demo cabina", category: "cabina", quantity: 5, minQuantity: 3, costCents: cents(12), retailPriceCents: cents(39), active: true }, session)
  ];
  const appointment = service.saveAppointment({
    clientId: clients[0].id,
    clientName: clients[0].name,
    staffId: staff[0].id,
    staffName: staff[0].name,
    serviceId: services[1].id,
    serviceName: services[1].name,
    startAt: iso(-7, 10),
    durationMin: services[1].durationMin,
    status: "completed",
    notes: `${marker} appuntamento demo.`,
    idempotencyKey: `${marker}:appointment:1`
  }, session);
  service.createPayment({
    clientId: clients[0].id,
    appointmentId: appointment.id,
    amountCents: cents(85),
    method: "card",
    createdAt: iso(-7, 12),
    note: `${marker} pagamento demo.`,
    idempotencyKey: `${marker}:payment:1`
  }, session);
  service.saveProtocol({
    clientId: clients[0].id,
    title: `Protocollo manuale ${marker}`,
    objective: "Percorso beauty dimostrativo senza claim medico.",
    area: "beauty",
    sessionsCount: 3,
    notes: `${marker} protocollo manuale demo.`
  }, session);
  return {
    staff: staff.length,
    services: services.length,
    clients: clients.length,
    inventory: inventory.length,
    appointments: 1,
    payments: 1,
    protocols: 1
  };
}

async function runInternalRenderJob() {
  if (!process.env.DATABASE_URL) {
    throw new Error("--internal-render-job requires DATABASE_URL inside Render.");
  }
  const missingPasswords = buildPlanDemoConfig().filter((item) => !item.password).map((item) => item.username);
  if (missingPasswords.length) {
    throw new Error(`Missing demo password env for: ${missingPasswords.join(", ")}`);
  }
  const { DesktopMirrorService } = require("../src/DesktopMirrorService");
  const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");
  const adapter = new PostgresPersistenceAdapter(process.env.DATABASE_URL);
  const service = new DesktopMirrorService({ persistenceAdapter: adapter });
  await service.init();

  const adminSession = {
    username: "render_internal_plan_demo_seed_job",
    role: "superadmin",
    centerId: "center_admin",
    centerName: "SkinHarmony Admin",
    subscriptionPlan: "gold",
    accessState: "active"
  };

  const results = [];
  for (const config of buildPlanDemoConfig()) {
    const existingUsers = service.usersRepository
      .list()
      .filter((user) =>
        String(user.username || "").toLowerCase() === config.username.toLowerCase()
        || String(user.centerId || "") === config.centerId
      );
    for (const user of existingUsers) {
      service.usersRepository.delete(user.id);
    }
    const reset = service.resetCenterOperationalData({
      centerId: config.centerId,
      confirm: `RESET-${config.centerId}`
    }, adminSession);
    const user = await service.createAccessUser({
      username: config.username,
      password: config.password,
      role: "owner",
      centerId: config.centerId,
      centerName: config.centerName,
      planType: "active",
      accountStatus: "active",
      paymentStatus: "paid",
      subscriptionPlan: config.plan,
      businessModel: "esthetic",
      ownerName: `Demo ${config.plan}`,
      contactEmail: config.contactEmail
    }, adminSession);
    const session = {
      username: config.username,
      role: "owner",
      centerId: config.centerId,
      centerName: config.centerName,
      subscriptionPlan: config.plan,
      accessState: "active"
    };
    service.saveSettings(config.settings, session);
    const created = await seedOperationalData(service, session, config.marker);
    const capabilities = service.getGoldCapabilities(session);
    const decisionContext = service.getGoldDecisionContext({}, session);
    results.push({
      username: config.username,
      centerId: config.centerId,
      plan: config.plan,
      userId: user.id,
      reset,
      created,
      accessCheck: {
        capabilitiesCurrentPlan: capabilities.currentPlan,
        goldEnabled: capabilities.goldEnabled,
        silverCoreEnabled: capabilities.silverCoreEnabled,
        decisionContextGoldEnabled: decisionContext.goldEnabled,
        decisionContextSourceLayer: decisionContext.sourceLayer || decisionContext.meta?.sourceLayer || "",
        primaryAction: decisionContext.primaryAction?.label || null
      }
    });
  }

  await flushPersistence(adapter);
  console.log(JSON.stringify({ success: true, mode: "internal-render-job", results }, null, 2));
}

async function main() {
  if (!APPLY) {
    console.log(JSON.stringify({
      mode: "dry-run",
      script: "seed_plan_access_demo_live",
      tenants: buildPlanDemoConfig().map((item) => ({
        username: item.username,
        centerId: item.centerId,
        plan: item.plan,
        passwordFromEnv: Boolean(item.password)
      })),
      guardrails: {
        internalRenderJobOnlyForApply: true,
        noPublicEndpoint: true,
        noKeys: true,
        noPricingMutation: true,
        demoTenantsOnly: true
      }
    }, null, 2));
    return;
  }
  if (!LIVE_CONFIRM || !INTERNAL_RENDER_JOB) {
    throw new Error("Live apply requires --apply --i-understand-live --internal-render-job.");
  }
  await runInternalRenderJob();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
