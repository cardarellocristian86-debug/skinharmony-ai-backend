"use strict";

const BASE_URL = String(process.env.SMARTDESK_BASE_URL || "https://skinharmony-smartdesk-live.onrender.com").replace(/\/$/, "");
const ADMIN_USERNAME = String(process.env.SMARTDESK_ADMIN_USERNAME || "cristian");
const ADMIN_PASSWORD = String(process.env.SMARTDESK_ADMIN_PASSWORD || "");
const DEMO_USERNAME = String(process.env.SMARTDESK_DEMO_USERNAME || "demo_gold_cockpit");
const DEMO_PASSWORD = String(process.env.SMARTDESK_DEMO_PASSWORD || "");
const DEMO_CENTER_ID = String(process.env.SMARTDESK_DEMO_CENTER_ID || "center_demo_gold_cockpit");
const DEMO_CENTER_NAME = String(process.env.SMARTDESK_DEMO_CENTER_NAME || "SkinHarmony Demo Gold");
const APPLY = process.argv.includes("--apply");
const RESET = process.argv.includes("--reset-center");
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

async function request(path, options = {}, token = "") {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text };
  }
  if (!res.ok) {
    const message = payload?.message || payload?.error || text || `HTTP ${res.status}`;
    throw new Error(`${options.method || "GET"} ${path} failed: ${res.status} ${message}`);
  }
  return payload;
}

async function login(username, password) {
  const payload = await request("/api/auth/login", {
    method: "POST",
    body: { username, password }
  });
  if (!payload?.token) throw new Error(`Login failed for ${username}`);
  return payload.token;
}

function buildDemoData() {
  const staff = [
    { name: "Elena Rossi", role: "Senior specialist", hourlyCostCents: cents(24), active: true },
    { name: "Marta Bianchi", role: "Beauty operator", hourlyCostCents: cents(19), active: true },
    { name: "Giulia Neri", role: "Reception e recall", hourlyCostCents: cents(17), active: true }
  ];
  const services = [
    { name: "Skin Reset Premium", category: "viso", durationMin: 60, priceCents: cents(95), estimatedProductCostCents: cents(12), technologyCostCents: cents(8), active: true },
    { name: "Protocollo O3 Glow", category: "tecnologia", durationMin: 75, priceCents: cents(135), estimatedProductCostCents: cents(18), technologyCostCents: cents(22), active: true },
    { name: "Percorso Corpo Method", category: "corpo", durationMin: 70, priceCents: cents(120), estimatedProductCostCents: cents(16), technologyCostCents: cents(18), active: true },
    { name: "Check Pelle + Piano", category: "consulenza", durationMin: 35, priceCents: cents(45), estimatedProductCostCents: cents(3), technologyCostCents: 0, active: true }
  ];
  const clients = [
    ["Laura Conti", true, -18, 980],
    ["Sara Ferri", true, -42, 620],
    ["Beatrice Villa", true, -65, 1240],
    ["Monica Greco", false, -22, 310],
    ["Chiara Longo", true, -35, 540],
    ["Valentina Costa", true, -78, 860],
    ["Irene Ricci", true, -9, 260],
    ["Paola Riva", true, -31, 490],
    ["Silvia Romano", false, -120, 760],
    ["Federica Marchetti", true, -54, 1110],
    ["Alice Fontana", true, -28, 430],
    ["Martina Leone", true, -14, 350]
  ].map(([name, marketingConsent, lastVisitOffset, spend], index) => {
    const [firstName, lastName] = String(name).split(" ");
    return {
      firstName,
      lastName,
      phone: `+39333110${String(index + 1).padStart(3, "0")}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@demo.skinharmony.local`,
      marketingConsent,
      privacyConsent: true,
      sensitiveDataConsent: true,
      consentSource: "demo_gold_live_seed",
      lastVisit: iso(Number(lastVisitOffset), 11),
      totalValue: cents(Number(spend)),
      notes: "SHGOLD_DEMO live cockpit dataset. Profilo simulato per demo commerciale Gold.",
      idempotencyKey: `shgold-demo-client-${index + 1}`
    };
  });
  const inventory = [
    { name: "Siero Reset Barrier", category: "cabina", quantity: 4, minQuantity: 6, costCents: cents(18), retailPriceCents: cents(49), active: true },
    { name: "Maschera O3 Glow", category: "cabina", quantity: 12, minQuantity: 5, costCents: cents(9), retailPriceCents: cents(29), active: true },
    { name: "Crema Home Care Premium", category: "rivendita", quantity: 7, minQuantity: 8, costCents: cents(22), retailPriceCents: cents(65), active: true }
  ];
  return { staff, services, clients, inventory };
}

async function main() {
  const data = buildDemoData();
  const planned = {
    mode: APPLY ? "apply" : "dry-run",
    baseUrl: BASE_URL,
    demoUsername: DEMO_USERNAME,
    demoCenterId: DEMO_CENTER_ID,
    demoCenterName: DEMO_CENTER_NAME,
    resetRequired: true,
    applyRequires: ["--apply", "--reset-center", "--i-understand-live", "SMARTDESK_ADMIN_PASSWORD", "SMARTDESK_DEMO_PASSWORD"],
    counts: {
      staff: data.staff.length,
      services: data.services.length,
      clients: data.clients.length,
      inventory: data.inventory.length,
      appointments: 44,
      payments: 43,
      treatments: 43,
      protocols: 3
    },
    guardrails: {
      targetTenantOnly: DEMO_CENTER_ID,
      noKeys: true,
      noPricingMutationOutsideDemoTenant: true,
      noCustomerTenantWrites: true
    }
  };
  if (!APPLY) {
    console.log(JSON.stringify(planned, null, 2));
    return;
  }
  if (!RESET || !LIVE_CONFIRM || !ADMIN_PASSWORD || !DEMO_PASSWORD) {
    if (!INTERNAL_RENDER_JOB) {
      throw new Error("Live apply requires --apply --reset-center --i-understand-live and SMARTDESK_ADMIN_PASSWORD/SMARTDESK_DEMO_PASSWORD.");
    }
  }
  if (INTERNAL_RENDER_JOB) {
    await runInternalRenderJob(data);
    return;
  }

  const adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const users = await request("/api/auth/users", {}, adminToken);
  const existing = users.find((user) => String(user.username || "").toLowerCase() === DEMO_USERNAME.toLowerCase());
  let demoUser = existing;
  if (!demoUser) {
    demoUser = await request("/api/auth/users", {
      method: "POST",
      body: {
        username: DEMO_USERNAME,
        password: DEMO_PASSWORD,
        role: "owner",
        centerId: DEMO_CENTER_ID,
        centerName: DEMO_CENTER_NAME,
        planType: "active",
        accountStatus: "active",
        paymentStatus: "paid",
        subscriptionPlan: "gold",
        businessModel: "esthetic",
        ownerName: "Demo SkinHarmony",
        contactEmail: "demo.gold@demo.skinharmony.local"
      }
    }, adminToken);
  } else {
    demoUser = await request(`/api/auth/users/${demoUser.id}/status`, {
      method: "POST",
      body: {
        active: true,
        planType: "active",
        accountStatus: "active",
        paymentStatus: "paid",
        subscriptionPlan: "gold"
      }
    }, adminToken);
  }

  await request("/api/admin/reset-center-data", {
    method: "POST",
    body: { centerId: DEMO_CENTER_ID, confirm: `RESET-${DEMO_CENTER_ID}` }
  }, adminToken);

  const demoToken = await login(DEMO_USERNAME, DEMO_PASSWORD);
  await request("/api/settings", {
    method: "PUT",
    body: {
      centerName: DEMO_CENTER_NAME,
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
    }
  }, demoToken);

  const createdStaff = [];
  for (const item of data.staff) {
    createdStaff.push(await request("/api/catalog/staff", { method: "POST", body: item }, demoToken));
  }
  const createdServices = [];
  for (const item of data.services) {
    createdServices.push(await request("/api/catalog/services", { method: "POST", body: item }, demoToken));
  }
  const createdClients = [];
  for (const item of data.clients) {
    createdClients.push(await request("/api/clients", { method: "POST", body: item }, demoToken));
  }
  for (const item of data.inventory) {
    await request("/api/inventory/items", { method: "POST", body: item }, demoToken);
  }

  let appointmentCount = 0;
  let paymentCount = 0;
  let treatmentCount = 0;
  for (let month = 4; month >= 0; month -= 1) {
    for (let index = 0; index < createdClients.length; index += 1) {
      if ((index + month) % 3 === 0 && month < 4) continue;
      const client = createdClients[index];
      const service = createdServices[(index + month) % createdServices.length];
      const operator = createdStaff[(index + month) % createdStaff.length];
      const daysOffset = -((month * 28) + ((index * 3) % 21));
      const amountCents = Number(service.priceCents || 0) + (index % 4 === 0 ? cents(25) : 0);
      const appointment = await request("/api/appointments", {
        method: "POST",
        body: {
          clientId: client.id,
          clientName: client.name,
          staffId: operator.id,
          staffName: operator.name,
          serviceId: service.id,
          serviceName: service.name,
          startAt: iso(daysOffset, 9 + (index % 7), index % 2 ? 30 : 0),
          durationMin: service.durationMin,
          status: daysOffset < -2 ? "completed" : "confirmed",
          notes: "SHGOLD_DEMO seduta demo Gold per cockpit, continuita e redditivita.",
          idempotencyKey: `shgold-demo-app-${month}-${index + 1}`
        }
      }, demoToken);
      appointmentCount += 1;
      if (daysOffset < -2) {
        await request("/api/payments", {
          method: "POST",
          body: {
            clientId: client.id,
            appointmentId: appointment.id,
            amountCents,
            method: index % 2 ? "card" : "cash",
            createdAt: iso(daysOffset, 12),
            note: "SHGOLD_DEMO pagamento demo Gold.",
            idempotencyKey: `shgold-demo-pay-${month}-${index + 1}`
          }
        }, demoToken);
        paymentCount += 1;
        await request("/api/treatments", {
          method: "POST",
          body: {
            clientId: client.id,
            title: `${service.name} - follow-up demo`,
            note: "SHGOLD_DEMO trattamento demo: follow-up consigliato, nessun claim medico."
          }
        }, demoToken);
        treatmentCount += 1;
      }
    }
  }
  for (const client of createdClients.slice(0, 3)) {
    await request("/api/protocols", {
      method: "POST",
      body: {
        clientId: client.id,
        title: `Percorso demo Gold - ${client.name}`,
        objective: "Continuita cliente, recall e controllo risultati non medico.",
        area: "beauty",
        sessionsCount: 4,
        notes: "SHGOLD_DEMO protocollo dimostrativo controllato."
      }
    }, demoToken);
  }

  const rebuild = await request("/api/admin/gold-state/rebuild", {
    method: "POST",
    body: { username: DEMO_USERNAME }
  }, adminToken);
  const cockpit = await request("/api/ai-gold/cockpit", {}, demoToken);
  console.log(JSON.stringify({
    success: true,
    demoUsername: DEMO_USERNAME,
    demoCenterId: DEMO_CENTER_ID,
    created: {
      staff: createdStaff.length,
      services: createdServices.length,
      clients: createdClients.length,
      appointments: appointmentCount,
      payments: paymentCount,
      treatments: treatmentCount,
      protocols: 3
    },
    rebuild: {
      success: rebuild.success,
      rawCounts: rebuild.rawCounts,
      valid: rebuild.valid
    },
    cockpit: {
      version: cockpit.cockpitVersion,
      summary: cockpit.summary,
      sections: Array.isArray(cockpit.sections) ? cockpit.sections.map((section) => ({ key: section.key, status: section.status, items: section.items?.length || 0 })) : []
    }
  }, null, 2));
}

async function flushPersistence(adapter) {
  if (!adapter?.writeChains) return;
  await Promise.allSettled(Array.from(adapter.writeChains.values()));
  if (adapter.pool?.end) await adapter.pool.end();
}

async function runInternalRenderJob(data) {
  if (!process.env.DATABASE_URL) {
    throw new Error("--internal-render-job requires DATABASE_URL inside Render.");
  }
  const { DesktopMirrorService } = require("../src/DesktopMirrorService");
  const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");
  const adapter = new PostgresPersistenceAdapter(process.env.DATABASE_URL);
  const service = new DesktopMirrorService({ persistenceAdapter: adapter });
  await service.init();

  const adminSession = {
    username: "render_internal_seed_job",
    role: "superadmin",
    centerId: "center_admin",
    centerName: "SkinHarmony Admin",
    subscriptionPlan: "gold",
    accessState: "active"
  };
  const demoSession = {
    username: DEMO_USERNAME,
    role: "owner",
    centerId: DEMO_CENTER_ID,
    centerName: DEMO_CENTER_NAME,
    subscriptionPlan: "gold",
    accessState: "active"
  };

  const existingDemoUsers = service.usersRepository
    .list()
    .filter((user) =>
      String(user.username || "").toLowerCase() === DEMO_USERNAME.toLowerCase()
      || String(user.centerId || "") === DEMO_CENTER_ID
    );
  for (const user of existingDemoUsers) {
    service.usersRepository.delete(user.id);
  }

  const reset = service.resetCenterOperationalData({
    centerId: DEMO_CENTER_ID,
    confirm: `RESET-${DEMO_CENTER_ID}`
  }, adminSession);

  const demoPassword = DEMO_PASSWORD || `DemoGold-${Date.now()}`;
  const demoUser = service.createAccessUser({
    username: DEMO_USERNAME,
    password: demoPassword,
    role: "owner",
    centerId: DEMO_CENTER_ID,
    centerName: DEMO_CENTER_NAME,
    planType: "active",
    accountStatus: "active",
    paymentStatus: "paid",
    subscriptionPlan: "gold",
    businessModel: "esthetic",
    ownerName: "Demo SkinHarmony",
    contactEmail: "demo.gold@demo.skinharmony.local"
  }, adminSession);

  service.saveSettings({
    centerName: DEMO_CENTER_NAME,
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
  }, demoSession);

  const createdStaff = data.staff.map((item) => service.saveStaff(item, demoSession));
  const createdServices = data.services.map((item) => service.saveService(item, demoSession));
  const createdClients = data.clients.map((item) => service.saveClient(item, demoSession));
  const createdInventory = data.inventory.map((item) => service.saveInventoryItem(item, demoSession));

  let appointmentCount = 0;
  let paymentCount = 0;
  let treatmentCount = 0;
  for (let month = 4; month >= 0; month -= 1) {
    for (let index = 0; index < createdClients.length; index += 1) {
      if ((index + month) % 3 === 0 && month < 4) continue;
      const client = createdClients[index];
      const serviceItem = createdServices[(index + month) % createdServices.length];
      const operator = createdStaff[(index + month) % createdStaff.length];
      const daysOffset = -((month * 28) + ((index * 3) % 21));
      const amountCents = Number(serviceItem.priceCents || 0) + (index % 4 === 0 ? cents(25) : 0);
      const appointment = service.saveAppointment({
        clientId: client.id,
        clientName: client.name,
        staffId: operator.id,
        staffName: operator.name,
        serviceId: serviceItem.id,
        serviceName: serviceItem.name,
        startAt: iso(daysOffset, 9 + (index % 7), index % 2 ? 30 : 0),
        durationMin: serviceItem.durationMin,
        status: daysOffset < -2 ? "completed" : "confirmed",
        notes: "SHGOLD_DEMO seduta demo Gold per cockpit, continuita e redditivita.",
        idempotencyKey: `shgold-demo-app-${month}-${index + 1}`
      }, demoSession);
      appointmentCount += 1;
      if (daysOffset < -2) {
        service.createPayment({
          clientId: client.id,
          appointmentId: appointment.id,
          amountCents,
          method: index % 2 ? "card" : "cash",
          createdAt: iso(daysOffset, 12),
          note: "SHGOLD_DEMO pagamento demo Gold.",
          idempotencyKey: `shgold-demo-pay-${month}-${index + 1}`
        }, demoSession);
        paymentCount += 1;
        service.createTreatment({
          clientId: client.id,
          title: `${serviceItem.name} - follow-up demo`,
          note: "SHGOLD_DEMO trattamento demo: follow-up consigliato, nessun claim medico."
        }, demoSession);
        treatmentCount += 1;
      }
    }
  }
  for (const client of createdClients.slice(0, 3)) {
    service.saveProtocol({
      clientId: client.id,
      title: `Percorso demo Gold - ${client.name}`,
      objective: "Continuita cliente, recall e controllo risultati non medico.",
      area: "beauty",
      sessionsCount: 4,
      notes: "SHGOLD_DEMO protocollo dimostrativo controllato."
    }, demoSession);
  }

  const rebuild = service.rebuildGoldStateForTenant({ username: DEMO_USERNAME }, adminSession);
  const cockpit = service.getAiGoldCockpit({}, demoSession);
  await flushPersistence(adapter);

  console.log(JSON.stringify({
    success: true,
    mode: "internal-render-job",
    demoUsername: DEMO_USERNAME,
    demoCenterId: DEMO_CENTER_ID,
    demoUserId: demoUser.id,
    reset,
    created: {
      staff: createdStaff.length,
      services: createdServices.length,
      clients: createdClients.length,
      inventory: createdInventory.length,
      appointments: appointmentCount,
      payments: paymentCount,
      treatments: treatmentCount,
      protocols: 3
    },
    rebuild: {
      success: rebuild.success,
      rawCounts: rebuild.rawCounts,
      valid: rebuild.valid
    },
    cockpit: {
      version: cockpit.cockpitVersion,
      summary: cockpit.summary,
      sections: Array.isArray(cockpit.sections) ? cockpit.sections.map((section) => ({ key: section.key, status: section.status, items: section.items?.length || 0 })) : []
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
