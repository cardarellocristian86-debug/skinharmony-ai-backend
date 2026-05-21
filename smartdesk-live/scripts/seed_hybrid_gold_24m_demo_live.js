"use strict";

const DEMO_USERNAME = String(process.env.SMARTDESK_DEMO_USERNAME || "demo_gold_cockpit");
const DEMO_PASSWORD = String(process.env.SMARTDESK_DEMO_PASSWORD || "");
const DEMO_CENTER_ID = String(process.env.SMARTDESK_DEMO_CENTER_ID || "center_demo_gold_cockpit");
const DEMO_CENTER_NAME = String(process.env.SMARTDESK_DEMO_CENTER_NAME || "SkinHarmony Demo Gold Hybrid");
const APPLY = process.argv.includes("--apply");
const LIVE_CONFIRM = process.argv.includes("--i-understand-live");
const INTERNAL_RENDER_JOB = process.argv.includes("--internal-render-job");
const SKIP_REBUILD = process.env.SMARTDESK_SKIP_GOLD_REBUILD === "1" || process.argv.includes("--skip-gold-rebuild");

const MONTH_COUNT = 24;
const AVG_MONTHLY_VISITS = 250;
const AVG_PHYSICAL_MONTHLY_VISITS = 62;
const TECHNOLOGY_INSTALLMENT_MONTHS = 48;
const TECHNOLOGY_MONTHLY_RATE_CENTS = cents(1400);
const EMPLOYEE_MONTHLY_SALARY_CENTS = cents(1300);

function cents(euro) {
  return Math.round(Number(euro || 0) * 100);
}

function euro(centsValue) {
  return Number(centsValue || 0) / 100;
}

function makePrng(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const rnd = makePrng(20260521);

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  let cursor = rnd() * total;
  for (const item of items) {
    cursor -= Number(item.weight || 0);
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function monthStart(offsetFromNow) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offsetFromNow, 1, 9, 0, 0));
  return date;
}

function isoInMonth(monthOffsetFromNow, visitIndex, hourSeed = 9) {
  const date = monthStart(monthOffsetFromNow);
  const day = 1 + ((visitIndex * 7 + Math.floor(rnd() * 9)) % 27);
  date.setUTCDate(day);
  date.setUTCHours(hourSeed + (visitIndex % 9), (visitIndex % 2) ? 30 : 0, 0, 0);
  return date.toISOString();
}

function addMinutesIso(value, minutes) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  return date.toISOString();
}

function buildStaff() {
  const hourlyCostCents = Math.round(EMPLOYEE_MONTHLY_SALARY_CENTS / 160);
  return [
    { name: "Elena Hybrid", role: "Hair stylist senior", hourlyCostCents, active: true, idempotencyKey: "hybrid24m:staff:elena" },
    { name: "Marta Hybrid", role: "Estetica e tecnologie", hourlyCostCents, active: true, idempotencyKey: "hybrid24m:staff:marta" },
    { name: "Giulia Hybrid", role: "Beauty operator e retail", hourlyCostCents, active: true, idempotencyKey: "hybrid24m:staff:giulia" }
  ];
}

function buildServices() {
  return [
    { key: "piega", name: "Piega Revlon Style", category: "parrucchiere", durationMin: 35, priceCents: cents(25), estimatedProductCostCents: cents(2.2), technologyCostCents: 0, weight: 34 },
    { key: "taglio_piega", name: "Taglio donna + piega", category: "parrucchiere", durationMin: 60, priceCents: cents(52), estimatedProductCostCents: cents(3.5), technologyCostCents: 0, weight: 22 },
    { key: "colore_piega", name: "Colore base + piega", category: "parrucchiere", durationMin: 95, priceCents: cents(72), estimatedProductCostCents: cents(14), technologyCostCents: 0, weight: 18 },
    { key: "balayage", name: "Balayage + tonalizzante + piega", category: "parrucchiere", durationMin: 180, priceCents: cents(145), estimatedProductCostCents: cents(39), technologyCostCents: 0, weight: 7 },
    { key: "trattamento_capelli", name: "Trattamento ricostruzione Revlon", category: "parrucchiere", durationMin: 40, priceCents: cents(35), estimatedProductCostCents: cents(8), technologyCostCents: 0, weight: 14 },
    { key: "manicure", name: "Manicure completa", category: "estetica", durationMin: 40, priceCents: cents(25), estimatedProductCostCents: cents(4), technologyCostCents: 0, weight: 16 },
    { key: "semipermanente", name: "Semipermanente mani", category: "estetica", durationMin: 55, priceCents: cents(38), estimatedProductCostCents: cents(6), technologyCostCents: 0, weight: 13 },
    { key: "pedicure", name: "Pedicure estetico", category: "estetica", durationMin: 55, priceCents: cents(40), estimatedProductCostCents: cents(5), technologyCostCents: 0, weight: 10 },
    { key: "pulizia_viso", name: "Pulizia viso ultrasuoni", category: "estetica", durationMin: 60, priceCents: cents(55), estimatedProductCostCents: cents(10), technologyCostCents: 0, weight: 14 },
    { key: "radiofrequenza_viso", name: "Radiofrequenza viso", category: "tecnologia_radiofrequenza", durationMin: 60, priceCents: cents(65), estimatedProductCostCents: cents(8), technologyCostCents: cents(47), weight: 7 },
    { key: "radiofrequenza_corpo", name: "Radiofrequenza corpo", category: "tecnologia_radiofrequenza", durationMin: 60, priceCents: cents(70), estimatedProductCostCents: cents(9), technologyCostCents: cents(47), weight: 6 },
    { key: "laser_ascelle", name: "Laser diodo ascelle", category: "tecnologia_laser", durationMin: 25, priceCents: cents(35), estimatedProductCostCents: cents(3), technologyCostCents: cents(35), weight: 5 },
    { key: "laser_inguine", name: "Laser diodo inguine", category: "tecnologia_laser", durationMin: 35, priceCents: cents(55), estimatedProductCostCents: cents(4), technologyCostCents: cents(35), weight: 5 },
    { key: "laser_gambe", name: "Laser diodo gamba completa", category: "tecnologia_laser", durationMin: 70, priceCents: cents(90), estimatedProductCostCents: cents(6), technologyCostCents: cents(35), weight: 4 },
    { key: "promo_rf", name: "Promo radiofrequenza mantenimento", category: "tecnologia_radiofrequenza", durationMin: 45, priceCents: cents(55), estimatedProductCostCents: cents(7), technologyCostCents: cents(47), weight: 4 }
  ];
}

function buildInventory() {
  const retail = (name, price, stock, minQuantity = 8) => ({
    name,
    category: "rivendita Revlon",
    supplier: "Revlon Professional",
    usageType: "rivendita",
    quantity: stock,
    minQuantity,
    costCents: Math.round(cents(price) * 0.6),
    retailPriceCents: cents(price),
    active: true,
    idempotencyKey: `hybrid24m:retail:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  });
  const cabin = (name, retailPrice, unitCost, stock, minQuantity = 4) => ({
    name,
    category: "uso interno Revlon",
    supplier: "Revlon Professional",
    usageType: "cabina",
    quantity: stock,
    minQuantity,
    costCents: cents(unitCost),
    retailPriceCents: cents(retailPrice),
    active: true,
    idempotencyKey: `hybrid24m:cabin:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  });
  return [
    retail("Revlon UniqOne Treatment 150ml", 17.95, 42),
    retail("Revlon Restart Shampoo 250ml", 15.50, 36),
    retail("Revlon Restart Conditioner 200ml", 16.90, 30),
    retail("Revlon Nutri Color Filter", 19.90, 24),
    retail("Revlon Equave Detangling 200ml", 18.50, 26),
    cabin("Revlon colore tecnico cabina", 0, 9.5, 28),
    cabin("Revlon ossidante colore cabina", 0, 3.8, 34),
    cabin("Revlon trattamento maschera cabina", 0, 6.8, 18),
    cabin("Gel radiofrequenza viso/corpo", 0, 4.8, 16),
    cabin("Kit monouso laser", 0, 2.4, 40)
  ];
}

function buildClients(count = 520) {
  const firstNames = ["Laura", "Sara", "Giulia", "Martina", "Elena", "Chiara", "Federica", "Alice", "Valentina", "Irene", "Paola", "Silvia", "Monica", "Beatrice", "Francesca", "Camilla", "Noemi", "Anna", "Marta", "Claudia"];
  const lastNames = ["Rossi", "Bianchi", "Conti", "Ferri", "Leone", "Gallo", "Fontana", "Romano", "Ricci", "Villa", "Costa", "Riva", "Greco", "Moretti", "Marchetti", "Longo"];
  return Array.from({ length: count }, (_, index) => {
    const firstName = firstNames[index % firstNames.length];
    const lastName = lastNames[(index * 7) % lastNames.length];
    return {
      firstName,
      lastName: `${lastName} ${index + 1}`,
      phone: `+39333${String(2000000 + index).slice(0, 7)}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${index + 1}@demo.skinharmony.local`,
      marketingConsent: index % 9 !== 0,
      privacyConsent: true,
      sensitiveDataConsent: true,
      consentSource: "hybrid_gold_24m_demo",
      lastVisit: isoInMonth(index % 18, index, 11),
      totalValue: 0,
      notes: "SHGOLD_24M_HYBRID demo: salone ibrido estetica/parrucchiere, dati simulati per stress AI Gold.",
      idempotencyKey: `hybrid24m:client:${index + 1}`
    };
  });
}

function normalizeClientPayload(payload, index) {
  const now = new Date().toISOString();
  const firstName = String(payload.firstName || "").trim();
  const lastName = String(payload.lastName || "").trim();
  return {
    ...payload,
    id: `client_hybrid24m_${index + 1}`,
    centerId: DEMO_CENTER_ID,
    centerName: DEMO_CENTER_NAME,
    name: `${firstName} ${lastName}`.trim(),
    privacyConsentAt: payload.privacyConsent ? now : "",
    marketingConsentAt: payload.marketingConsent ? now : "",
    sensitiveDataConsentAt: payload.sensitiveDataConsent ? now : "",
    loyaltyTier: index % 12 === 0 ? "premium" : index % 4 === 0 ? "regular" : "base",
    preferences: [],
    packages: [],
    allergies: "",
    birthDate: "",
    createdAt: now,
    updatedAt: now
  };
}

function bulkAppend(repository, items) {
  if (!items.length) return;
  repository.write([...items, ...repository.list()]);
}

function upsertById(repository, entity) {
  const items = repository.list();
  const index = items.findIndex((item) => String(item.id || "") === String(entity.id || ""));
  if (index >= 0) {
    items[index] = entity;
  } else {
    items.unshift(entity);
  }
  repository.write(items);
}

function buildSeededGoldState(monthly, created, totals) {
  const now = new Date().toISOString();
  const last = monthly[monthly.length - 1] || {};
  const lastRevenue = Number(last.totalRevenueCents || 0);
  const totalRevenue = Number(totals.revenueCents || 0);
  const totalVisits = Number(totals.visits || 0);
  const paymentCount = created.servicePayments + created.retailPayments;
  const estimatedCost = Math.round(totalRevenue * 0.72);
  const estimatedProfit = totalRevenue - estimatedCost;
  const margin = totalRevenue > 0 ? Number((estimatedProfit / totalRevenue).toFixed(4)) : 0;
  const confidence = 0.78;
  const costConfidence = 0.74;
  const monthlyTrend = monthly.map((item, index) => ({
    monthIndex: index + 1,
    revenueCents: item.totalRevenueCents,
    serviceRevenueCents: item.serviceRevenueCents,
    retailRevenueCents: item.retailRevenueCents,
    visits: item.actualVisits,
    staffSalaryCents: item.staffSalaryCents,
    technologyRateCents: item.technologyRateCents
  }));
  return {
    id: `gold_state:${DEMO_CENTER_ID}`,
    version: "corelia_state_v1",
    centerId: DEMO_CENTER_ID,
    centerName: DEMO_CENTER_NAME,
    updatedAt: now,
    lastEvent: {
      type: "seed_hybrid_gold_24m_snapshot",
      at: now,
      reason: "hybrid_gold_24m_demo_seed",
      importId: "",
      previousEventSeq: 0
    },
    eventSeq: totalVisits + paymentCount,
    components: {
      Rev: totalRevenue,
      U: 0,
      Sat: 0.58,
      Act: 520,
      Cont: 0.63,
      Ticket: totalVisits ? Math.round(totalRevenue / totalVisits) : 0,
      Prod: 0.64,
      DQ: 0.82,
      CostConf: costConfidence,
      Margin: margin,
      Conf: confidence
    },
    counters: {
      revenueTotalCents: totalRevenue,
      paymentCount,
      unlinkedPayments: 0,
      todayAppointments: 0,
      appointmentSlots: 72,
      clientsTotal: 520,
      activeClients: 420,
      clientsWithContact: 520,
      servicesTotal: 15,
      servicesWithPrice: 15,
      servicesWithCost: 15,
      staffActive: 3,
      staffTotal: 3,
      inventoryTotal: 10,
      lowStock: 3,
      marginTotal: margin,
      marginSamples: totalVisits,
      profitabilityRevenueCents: totalRevenue,
      profitabilityCostCents: estimatedCost,
      profitabilityProfitCents: estimatedProfit,
      profitabilitySamples: totalVisits,
      profitabilityReal: Math.round(totalVisits * 0.55),
      profitabilityStandard: Math.round(totalVisits * 0.35),
      profitabilityEstimated: Math.round(totalVisits * 0.1),
      profitabilityIncomplete: 0
    },
    dirty: { components: [], snapshots: [], signals: [] },
    snapshots: {
      business: {
        type: "business_snapshot",
        source: "seed_hybrid_gold_24m_snapshot",
        revenueCents: totalRevenue,
        monthlyRevenueCents: lastRevenue,
        unlinkedPayments: 0,
        agendaSaturation: 0.58,
        activeClients: 420,
        clientContinuity: 0.63,
        averageTicketCents: totalVisits ? Math.round(totalRevenue / totalVisits) : 0,
        productivity: 0.64,
        dataQuality: 0.82,
        confidence,
        status: "centro_monitorato",
        monthlyTrend
      },
      profitability: {
        type: "profitability_snapshot",
        source: "seed_hybrid_gold_24m_snapshot",
        revenueCents: totalRevenue,
        coreRevenueCents: totalRevenue,
        coreCostCents: estimatedCost,
        coreProfitCents: estimatedProfit,
        averageMargin: margin,
        costConfidence,
        economicConfidence: confidence,
        profitabilityConfidence: Math.min(costConfidence, confidence),
        confidenceLabel: "media",
        coreSamples: totalVisits,
        confidenceBreakdown: {
          real: Math.round(totalVisits * 0.55),
          standard: Math.round(totalVisits * 0.35),
          estimated: Math.round(totalVisits * 0.1),
          incomplete: 0
        },
        mathCore: "seed_hybrid_gold_24m_snapshot",
        status: margin < 0.08 ? "margine_sotto_soglia" : "margine_da_verificare",
        monthlyTrend
      },
      report: {
        type: "report_snapshot",
        source: "seed_hybrid_gold_24m_snapshot",
        revenueCents: totalRevenue,
        averageTicketCents: totalVisits ? Math.round(totalRevenue / totalVisits) : 0,
        productivity: 0.64,
        agendaSaturation: 0.58,
        continuity: 0.63,
        dataQuality: 0.82,
        unlinkedPayments: 0,
        monthlyTrend
      }
    },
    signals: {
      operationalRisk: 0.42,
      centerBelowThreshold: 0.34,
      opportunity: 0.72,
      cashAnomaly: 0,
      marginAnomaly: margin < 0.1 ? 0.78 : 0.48,
      dataReliability: confidence,
      productivitySignal: 0.64
    },
    decision: {
      source: "seed_hybrid_gold_24m_snapshot",
      domain: margin < 0.1 ? "profitability" : "growth",
      score: margin < 0.1 ? 0.78 : 0.72,
      weightedScore: margin < 0.1 ? 0.7 : 0.66,
      action: "ACT_NOW",
      primaryAction: {
        domain: margin < 0.1 ? "profitability" : "growth",
        action: "ACT_NOW",
        label: margin < 0.1 ? "Tecnologie e margini da correggere" : "Volume buono, ottimizza margini e retail",
        actionabilityScore: 1
      },
      secondaryActions: [
        { domain: "marketing", score: 0.68, weightedScore: 0.61, actionabilityScore: 0.9, label: "Riattiva clienti ricorrenti e pacchetti" },
        { domain: "inventory", score: 0.54, weightedScore: 0.48, actionabilityScore: 0.8, label: "Controlla rivendita e uso interno Revlon" }
      ],
      blockedActions: [],
      explanationShort: margin < 0.1
        ? "Il centro ha volume, ma radiofrequenza e laser pesano sui margini: Gold deve guidare pacchetti e correzioni operative."
        : "Il centro ha storico e volume: Gold deve spingere continuita, retail e servizi sostenibili.",
      updatedAt: now,
      temporalStability: { stable: true, candidateCount: 3, requiredCycles: 2 }
    },
    decisionStability: {
      acceptedKey: margin < 0.1 ? "profitability:ACT_NOW" : "growth:ACT_NOW",
      candidateKey: "",
      candidateCount: 0,
      minPersistenceCycles: 2,
      switchedAt: now
    }
  };
}

function monthlyTargetCents(monthIndexFromOldest) {
  const seasonal = Math.sin((monthIndexFromOldest / 12) * Math.PI * 2) * cents(1700);
  const trend = monthIndexFromOldest > 15 ? -cents(450) : monthIndexFromOldest * cents(55);
  const noise = (rnd() - 0.5) * cents(1500);
  return Math.max(cents(14000), Math.min(cents(20000), Math.round(cents(16800) + seasonal + trend + noise)));
}

function monthlyVisitTarget(monthIndexFromOldest) {
  const seasonal = Math.round(Math.sin((monthIndexFromOldest / 12) * Math.PI * 2) * 18);
  const noise = Math.round((rnd() - 0.5) * 12);
  return Math.max(48, Math.min(76, AVG_PHYSICAL_MONTHLY_VISITS + Math.round(seasonal / 4) + noise));
}

async function flushPersistence(adapter) {
  if (!adapter?.writeChains) return;
  await Promise.allSettled(Array.from(adapter.writeChains.values()));
  if (adapter.pool?.end) await adapter.pool.end();
}

async function runInternalRenderJob() {
  if (!process.env.DATABASE_URL) throw new Error("--internal-render-job requires DATABASE_URL inside Render.");
  if (!DEMO_PASSWORD) throw new Error("SMARTDESK_DEMO_PASSWORD required.");
  const { DesktopMirrorService } = require("../src/DesktopMirrorService");
  const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");
  const adapter = new PostgresPersistenceAdapter(process.env.DATABASE_URL);
  const service = new DesktopMirrorService({ persistenceAdapter: adapter });
  await service.init();

  const adminSession = {
    username: "render_internal_hybrid_gold_24m_seed_job",
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

  for (const user of service.usersRepository.list().filter((item) =>
    String(item.username || "").toLowerCase() === DEMO_USERNAME.toLowerCase()
    || String(item.centerId || "") === DEMO_CENTER_ID
  )) {
    service.usersRepository.delete(user.id);
  }
  const reset = service.resetCenterOperationalData({
    centerId: DEMO_CENTER_ID,
    confirm: `RESET-${DEMO_CENTER_ID}`
  }, adminSession);
  const demoUser = service.createAccessUser({
    username: DEMO_USERNAME,
    password: DEMO_PASSWORD,
    role: "owner",
    centerId: DEMO_CENTER_ID,
    centerName: DEMO_CENTER_NAME,
    planType: "active",
    accountStatus: "active",
    paymentStatus: "paid",
    subscriptionPlan: "gold",
    businessModel: "hybrid_beauty_hair",
    ownerName: "Demo SkinHarmony Hybrid",
    contactEmail: "demo.gold.hybrid@demo.skinharmony.local"
  }, adminSession);
  service.saveSettings({
    centerName: DEMO_CENTER_NAME,
    businessModel: "hybrid_beauty_hair",
    enableMarketing: true,
    enableCashdesk: true,
    enableTreatments: true,
    enableProtocolsHub: true,
    inventoryBaseEnabled: true,
    inventoryMovementsEnabled: true,
    inventoryAlertsEnabled: true,
    profitabilityEnabled: true,
    profitabilityOperatorCostEnabled: true,
    profitabilityTechnologyAnalysisEnabled: true,
    aiActionsEnabled: true,
    whatsappGoldMode: "manual"
  }, demoSession);

  const staff = buildStaff().map((item) => service.saveStaff(item, demoSession));
  const services = buildServices().map((item) => service.saveService({ ...item, idempotencyKey: `hybrid24m:service:${item.key}` }, demoSession));
  const inventory = buildInventory().map((item) => service.saveInventoryItem(item, demoSession));
  const clients = buildClients().map((item, index) => normalizeClientPayload(item, index));
  bulkAppend(service.clientsRepository, clients);
  const retailItems = inventory.filter((item) => String(item.usageType || "") === "rivendita");
  const cabinItems = inventory.filter((item) => String(item.usageType || "") === "cabina");

  const byKey = new Map(services.map((item) => [String(item.idempotencyKey || "").split(":").pop(), item]));
  const serviceWeights = buildServices().map((template) => ({ ...byKey.get(template.key), key: template.key, weight: template.weight }));
  const monthly = [];
  let appointmentCount = 0;
  let paymentCount = 0;
  let treatmentCount = 0;
  let retailPaymentCount = 0;
  let movementCount = 0;
  const appointmentRows = [];
  const paymentRows = [];
  const treatmentRows = [];
  const movementRows = [];

  for (let oldestIndex = 0; oldestIndex < MONTH_COUNT; oldestIndex += 1) {
    const monthOffsetFromNow = MONTH_COUNT - 1 - oldestIndex;
    const targetVisits = monthlyVisitTarget(oldestIndex);
    const logicalVisits = Math.max(220, Math.min(285, AVG_MONTHLY_VISITS + Math.round(Math.sin((oldestIndex / 12) * Math.PI * 2) * 18) + Math.round((rnd() - 0.5) * 18)));
    const targetRevenue = monthlyTargetCents(oldestIndex);
    let monthRevenue = 0;
    let monthVisits = 0;
    for (let visitIndex = 0; visitIndex < targetVisits; visitIndex += 1) {
      const serviceItem = pickWeighted(serviceWeights);
      const client = clients[(oldestIndex * 37 + visitIndex * 11) % clients.length];
      const operator = staff[(visitIndex + oldestIndex) % staff.length];
      const startAt = isoInMonth(monthOffsetFromNow, visitIndex, 8 + (visitIndex % 4));
      const amountCents = Number(serviceItem.priceCents || 0);
      const appointment = {
        id: `appt_hybrid24m_${oldestIndex}_${visitIndex}`,
        idempotencyKey: `hybrid24m:app:${oldestIndex}:${visitIndex}`,
        centerId: DEMO_CENTER_ID,
        centerName: DEMO_CENTER_NAME,
        clientId: client.id,
        clientName: client.name,
        walkInName: "",
        walkInPhone: "",
        staffId: operator.id,
        staffName: operator.name,
        serviceId: serviceItem.id,
        serviceIds: [serviceItem.id],
        serviceName: serviceItem.name,
        resourceId: "",
        resourceName: "",
        startAt,
        endAt: addMinutesIso(startAt, serviceItem.durationMin),
        status: "completed",
        notes: `SHGOLD_24M_HYBRID ${serviceItem.category}. Rate tecnologie: 48 mesi x 700 euro per radiofrequenza e laser.`,
        durationMin: serviceItem.durationMin,
        locked: 0,
        createdAt: startAt,
        updatedAt: startAt
      };
      appointmentRows.push(appointment);
      appointmentCount += 1;
      paymentRows.push({
        id: `pay_hybrid24m_${oldestIndex}_${visitIndex}`,
        idempotencyKey: `hybrid24m:pay:${oldestIndex}:${visitIndex}`,
        centerId: DEMO_CENTER_ID,
        centerName: DEMO_CENTER_NAME,
        clientId: client.id,
        walkInName: "",
        appointmentId: appointment.id,
        amountCents,
        method: visitIndex % 5 === 0 ? "cash" : "card",
        createdAt: startAt,
        description: `SHGOLD_24M_HYBRID incasso servizio ${serviceItem.name}.`,
        note: `SHGOLD_24M_HYBRID incasso servizio ${serviceItem.name}.`,
      });
      paymentCount += 1;
      if (visitIndex % 8 === 0) {
        treatmentRows.push({
          id: `treat_hybrid24m_${oldestIndex}_${visitIndex}`,
          centerId: DEMO_CENTER_ID,
          centerName: DEMO_CENTER_NAME,
          clientId: client.id,
          title: `${serviceItem.name} - storico demo`,
          note: "SHGOLD_24M_HYBRID trattamento storico; output non medico, conferma operatore richiesta.",
          createdAt: startAt
        });
        treatmentCount += 1;
      }
      const linkedCabin = cabinItems[(visitIndex + oldestIndex) % cabinItems.length];
      if (linkedCabin && visitIndex % 3 === 0) {
        movementRows.push({
          id: `move_hybrid24m_internal_${oldestIndex}_${visitIndex}`,
          centerId: DEMO_CENTER_ID,
          centerName: DEMO_CENTER_NAME,
          itemId: linkedCabin.id,
          type: "internal_use",
          quantity: 0.08 + ((visitIndex % 3) * 0.04),
          note: `SHGOLD_24M_HYBRID uso interno per ${serviceItem.name}.`,
          createdAt: startAt
        });
        movementCount += 1;
      }
      monthRevenue += amountCents;
      monthVisits += 1;
      if (monthVisits >= 220 && monthRevenue >= targetRevenue && rnd() > 0.35) break;
    }

    const retailTarget = Math.round(targetRevenue * (0.08 + rnd() * 0.06));
    let retailRevenue = 0;
    let saleIndex = 0;
    while (retailRevenue < retailTarget && saleIndex < 90) {
      const retail = retailItems[(saleIndex + oldestIndex) % retailItems.length];
      const client = clients[(oldestIndex * 19 + saleIndex * 17) % clients.length];
      const createdAt = isoInMonth(monthOffsetFromNow, 300 + saleIndex, 15);
      paymentRows.push({
        id: `pay_hybrid24m_retail_${oldestIndex}_${saleIndex}`,
        idempotencyKey: `hybrid24m:retail-pay:${oldestIndex}:${saleIndex}`,
        centerId: DEMO_CENTER_ID,
        centerName: DEMO_CENTER_NAME,
        clientId: client.id,
        walkInName: "",
        appointmentId: "",
        amountCents: Number(retail.retailPriceCents || retail.salePriceCents || 0),
        method: saleIndex % 4 === 0 ? "cash" : "card",
        createdAt,
        description: `SHGOLD_24M_HYBRID rivendita ${retail.name}; acquisto simulato a sconto 40%, vendita retail piena.`,
        note: `SHGOLD_24M_HYBRID rivendita ${retail.name}; acquisto simulato a sconto 40%, vendita retail piena.`,
      });
      movementRows.push({
        id: `move_hybrid24m_sale_${oldestIndex}_${saleIndex}`,
        centerId: DEMO_CENTER_ID,
        centerName: DEMO_CENTER_NAME,
        itemId: retail.id,
        type: "sale",
        quantity: 1,
        note: `SHGOLD_24M_HYBRID vendita rivendita ${retail.name}.`,
        createdAt
      });
      retailRevenue += Number(retail.retailPriceCents || retail.salePriceCents || 0);
      retailPaymentCount += 1;
      movementCount += 1;
      saleIndex += 1;
    }

    const aggregateGap = Math.max(0, targetRevenue - (monthRevenue + retailRevenue));
    if (aggregateGap > 0) {
      const aggregateAt = isoInMonth(monthOffsetFromNow, 390, 18);
      paymentRows.push({
        id: `pay_hybrid24m_aggregate_${oldestIndex}`,
        idempotencyKey: `hybrid24m:aggregate-pay:${oldestIndex}`,
        centerId: DEMO_CENTER_ID,
        centerName: DEMO_CENTER_NAME,
        clientId: "",
        walkInName: "Incasso servizi aggregato mese",
        appointmentId: "",
        amountCents: aggregateGap,
        method: "card",
        createdAt: aggregateAt,
        description: `SHGOLD_24M_HYBRID incasso aggregato mensile per rappresentare circa ${logicalVisits} passaggi/mese senza appesantire agenda.`,
        note: `SHGOLD_24M_HYBRID incasso aggregato mensile per forecast Gold.`
      });
      paymentCount += 1;
    }

    monthly.push({
      monthIndex: oldestIndex + 1,
      targetVisits: logicalVisits,
      physicalVisits: monthVisits,
      actualVisits: logicalVisits,
      serviceRevenueCents: monthRevenue,
      retailRevenueCents: retailRevenue,
      aggregateRevenueCents: aggregateGap,
      totalRevenueCents: monthRevenue + retailRevenue + aggregateGap,
      technologyRateCents: TECHNOLOGY_MONTHLY_RATE_CENTS,
      staffSalaryCents: EMPLOYEE_MONTHLY_SALARY_CENTS * staff.length
    });
  }

  bulkAppend(service.appointmentsRepository, appointmentRows);
  bulkAppend(service.paymentsRepository, paymentRows);
  bulkAppend(service.treatmentsRepository, treatmentRows);
  bulkAppend(service.inventoryMovementsRepository, movementRows);

  for (const client of clients.slice(0, 24)) {
    service.saveProtocol({
      clientId: client.id,
      title: `Percorso ibrido Gold 24M - ${client.name}`,
      objective: "Continuita cliente, combinazione hair/beauty e controllo marginalita senza claim medico.",
      area: "beauty_hair_hybrid",
      sessionsCount: 6,
      notes: "SHGOLD_24M_HYBRID protocollo dimostrativo da confermare dall'operatore.",
      idempotencyKey: `hybrid24m:protocol:${client.id}`
    }, demoSession);
  }

  const createdSummary = {
    staff: staff.length,
    services: services.length,
    clients: clients.length,
    inventory: inventory.length,
    appointments: appointmentCount,
    servicePayments: paymentCount,
    retailPayments: retailPaymentCount,
    treatments: treatmentCount,
    protocols: 24,
    inventoryMovements: movementCount
  };
  const totals = monthly.reduce((acc, item) => ({
    visits: acc.visits + item.actualVisits,
    revenueCents: acc.revenueCents + item.totalRevenueCents,
    serviceRevenueCents: acc.serviceRevenueCents + item.serviceRevenueCents,
    retailRevenueCents: acc.retailRevenueCents + item.retailRevenueCents
  }), { visits: 0, revenueCents: 0, serviceRevenueCents: 0, retailRevenueCents: 0 });
  const seededGoldState = buildSeededGoldState(monthly, createdSummary, totals);
  upsertById(service.goldStateRepository, seededGoldState);
  const rebuild = SKIP_REBUILD
    ? { skipped: true, reason: "seeded_gold_state_snapshot_written" }
    : service.rebuildGoldStateForTenant({ username: DEMO_USERNAME }, adminSession);
  const cockpit = SKIP_REBUILD
    ? { skipped: true, summary: {}, sections: [] }
    : service.getAiGoldCockpit({}, demoSession);
  const profitability = SKIP_REBUILD
    ? { skipped: true, totals: {}, confidence: {}, centerHealth: {} }
    : service.getProfitabilityOverview({}, demoSession);
  await flushPersistence(adapter);

  console.log(JSON.stringify({
    success: true,
    mode: "internal-render-job",
    demoUsername: DEMO_USERNAME,
    demoCenterId: DEMO_CENTER_ID,
    demoUserId: demoUser.id,
    reset,
    assumptions: {
      months: MONTH_COUNT,
      averageMonthlyVisits: Math.round(totals.visits / MONTH_COUNT),
      monthlyRevenueRangeEuro: [
        Math.round(Math.min(...monthly.map((item) => euro(item.totalRevenueCents)))),
        Math.round(Math.max(...monthly.map((item) => euro(item.totalRevenueCents))))
      ],
      employees: staff.length,
      employeeMonthlySalaryEuro: euro(EMPLOYEE_MONTHLY_SALARY_CENTS),
      technologyInstallments: "radiofrequenza + laser, 48 rate, 700 euro/mese ciascuna",
      retailPurchaseDiscount: "40%"
    },
    rebuildSkipped: SKIP_REBUILD,
    created: createdSummary,
    totals,
    rebuild: {
      success: rebuild.success,
      rawCounts: rebuild.rawCounts,
      valid: rebuild.valid
    },
    cockpit: {
      version: cockpit.cockpitVersion,
      summary: cockpit.summary,
      sections: Array.isArray(cockpit.sections) ? cockpit.sections.map((section) => ({ key: section.key, status: section.status, items: section.items?.length || 0 })) : []
    },
    profitability: {
      totals: profitability.totals,
      confidence: profitability.confidence,
      centerHealth: profitability.centerHealth
    }
  }, null, 2));
}

async function main() {
  if (!APPLY) {
    console.log(JSON.stringify({
      mode: "dry-run",
      script: "seed_hybrid_gold_24m_demo_live",
      target: { username: DEMO_USERNAME, centerId: DEMO_CENTER_ID, plan: "gold" },
      assumptions: {
        months: MONTH_COUNT,
        targetAverageMonthlyVisits: AVG_MONTHLY_VISITS,
        targetMonthlyRevenueEuro: "14000-20000",
        employees: 3,
        employeeMonthlySalaryEuro: euro(EMPLOYEE_MONTHLY_SALARY_CENTS),
        technologyInstallments: {
          radiofrequencyMonthlyEuro: 700,
          laserMonthlyEuro: 700,
          months: TECHNOLOGY_INSTALLMENT_MONTHS
        },
        retailBrand: "Revlon Professional",
        retailPurchaseDiscount: "40%"
      },
      guardrails: {
        internalRenderJobOnlyForApply: true,
        noPublicEndpoint: true,
        noKeys: true,
      noRealTenantWrites: true,
      demoGoldTenantOnly: true,
      skipGoldRebuild: SKIP_REBUILD
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
  console.error(error.stack || error.message);
  process.exit(1);
});
