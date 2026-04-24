const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const baselineDataDir = path.resolve(__dirname, "..", "data");
const reportsDir = path.join(repoRoot, "reports", "ai-gold-tests");
const reportPath = path.join(reportsDir, "smartdesk_privilege_90d_real_use_latest.json");
const xlsx = require(path.resolve(__dirname, "..", "node_modules", "xlsx"));

const TEMP_PREFIX = "skinharmony-privilege-90d-";
const TARGET_MONTHLY_REVENUE_CENTS = 2_000_000;
const PROFILE_ITERATIONS = 90;
const WARMUP_ITERATIONS = 12;

const PRICE_SOURCES = [
  {
    name: "Jeune/Ange Parrucchieri Milano - Listino prezzi",
    url: "https://www.jeuneange.com/listino-prezzi",
    services: [
      { name: "Piega sh + Conditioner", priceEuro: 35, durationMinSynthetic: 40 },
      { name: "Piega + Trattamento cute e rituale Aveda", priceEuro: 55, durationMinSynthetic: 55 },
      { name: "Taglio Stylist", priceEuro: 35, durationMinSynthetic: 45 },
      { name: "Taglio art director", priceEuro: 45, durationMinSynthetic: 50 },
      { name: "Acconciatura / Raccolto", priceEuro: 50, durationMinSynthetic: 70 },
      { name: "Colore + Contrasto a pettine", priceEuro: 150, durationMinSynthetic: 180 },
      { name: "Balayage", priceEuro: 150, durationMinSynthetic: 180 },
      { name: "Waves", priceEuro: 160, durationMinSynthetic: 200 },
      { name: "Gloss", priceEuro: 35, durationMinSynthetic: 30 },
      { name: "Trattamento anticrespo", priceEuro: 200, durationMinSynthetic: 210 }
    ]
  },
  {
    name: "Jeune/Ange Parrucchieri Milano - Wedding",
    url: "https://www.jeuneange.com/wedding",
    services: [
      { name: "Pacchetto sposa", priceEuro: 300, durationMinSynthetic: 240 }
    ]
  }
];

const CLIENT_FIRST_NAMES = [
  "Giulia", "Sofia", "Martina", "Chiara", "Alice", "Giorgia", "Elisa", "Laura", "Sara", "Marta",
  "Valentina", "Federica", "Silvia", "Camilla", "Noemi", "Arianna", "Beatrice", "Ilaria", "Gaia", "Nicole"
];
const CLIENT_LAST_NAMES = [
  "Rossi", "Bianchi", "Esposito", "Romano", "Colombo", "Ricci", "Marino", "Greco", "Bruno", "Gallo",
  "Conti", "De Luca", "Costa", "Fontana", "Moretti", "Barbieri", "Lombardi", "Longo", "Martinelli", "Caruso"
];
const STAFF_NAMES = ["Martina", "Federica", "Luca", "Andrea", "Chiara"];
const PAYMENT_METHODS = ["card", "cash", "bank_transfer"];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function measure(fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const end = process.hrtime.bigint();
  return {
    value,
    durationMs: Number(end - start) / 1e6
  };
}

function euroToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function formatEuro(cents) {
  return Number(cents || 0) / 100;
}

function toDateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function toIso(date, hour, minute) {
  const next = new Date(date);
  next.setUTCHours(hour, minute, 0, 0);
  return next.toISOString();
}

function aggregateMonthlyRevenue(payments) {
  const byMonth = new Map();
  payments.forEach((item) => {
    const monthKey = String(item.createdAt || "").slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + Number(item.amountCents || 0));
  });
  return Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amountCents]) => ({ month, amountCents, amountEuro: formatEuro(amountCents) }));
}

function buildClientPool() {
  const clients = [];
  for (let index = 0; index < 140; index += 1) {
    const firstName = CLIENT_FIRST_NAMES[index % CLIENT_FIRST_NAMES.length];
    const lastName = CLIENT_LAST_NAMES[Math.floor(index / CLIENT_FIRST_NAMES.length) % CLIENT_LAST_NAMES.length];
    const fullName = `${firstName} ${lastName} ${String(index + 1).padStart(3, "0")}`;
    const phone = `3${String(300000000 + index).slice(0, 9)}`;
    const email = `${firstName}.${lastName}.${index + 1}`.toLowerCase().replace(/\s+/g, "") + "@privilege-test.it";
    clients.push({
      name: fullName,
      firstName,
      lastName,
      phone,
      email,
      marketingConsent: index % 6 !== 0 ? "si" : "no"
    });
  }
  return clients;
}

function buildServiceCatalog() {
  return PRICE_SOURCES.flatMap((source) => source.services.map((service) => ({
    ...service,
    source: source.name,
    sourceUrl: source.url,
    priceCents: euroToCents(service.priceEuro)
  })));
}

function writeWorkbook(filePath, sheetName, rows) {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  xlsx.writeFile(workbook, filePath);
}

function toImportFile(filePath, declaredType) {
  return {
    name: path.basename(filePath),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    declaredType,
    contentBase64: fs.readFileSync(filePath).toString("base64")
  };
}

function buildMonthlyWorkRows(catalog, clients, monthStartDate, monthLabel, revenueTargetCents) {
  const customersRows = [];
  const appointmentsRows = [];
  const paymentsRows = [];
  const exportedClients = new Set();
  const monthlyRevenue = { cents: 0, rows: 0 };
  const weightedServices = [
    ...catalog.filter((item) => ["Balayage", "Waves", "Trattamento anticrespo", "Pacchetto sposa", "Colore + Contrasto a pettine"].includes(item.name)),
    ...catalog,
    ...catalog.filter((item) => ["Balayage", "Waves", "Trattamento anticrespo", "Pacchetto sposa"].includes(item.name))
  ];
  let rowIndex = 0;
  while (monthlyRevenue.cents < revenueTargetCents) {
    const service = weightedServices[rowIndex % weightedServices.length];
    const client = clients[(rowIndex * 7) % clients.length];
    const dayOffset = rowIndex % 28;
    const slotIndex = rowIndex % 8;
    const appointmentDate = new Date(monthStartDate);
    appointmentDate.setUTCDate(appointmentDate.getUTCDate() + dayOffset);
    const appointmentIso = toIso(appointmentDate, 9 + Math.floor(slotIndex / 2) * 2, slotIndex % 2 === 0 ? 0 : 30);
    const dateOnly = toDateOnly(appointmentIso);
    const timeOnly = appointmentIso.slice(11, 16);
    const staffName = STAFF_NAMES[rowIndex % STAFF_NAMES.length];
    if (!exportedClients.has(client.email)) {
      customersRows.push({
        nome: client.name,
        first_name: client.firstName,
        last_name: client.lastName,
        telefono: client.phone,
        email: client.email,
        consenso_marketing: client.marketingConsent,
        note: `Import storico ${monthLabel}`
      });
      exportedClients.add(client.email);
    }
    appointmentsRows.push({
      nome: client.name,
      telefono: client.phone,
      email: client.email,
      data_appuntamento: dateOnly,
      ora: timeOnly,
      servizio: service.name,
      operatore: staffName,
      durata: service.durationMinSynthetic,
      stato: "completed",
      note: `${monthLabel} - import storico Excel`
    });
    paymentsRows.push({
      nome: client.name,
      telefono: client.phone,
      email: client.email,
      data: dateOnly,
      importo: service.priceEuro,
      metodo: PAYMENT_METHODS[rowIndex % PAYMENT_METHODS.length],
      note: `${monthLabel} - ${service.name}`
    });
    monthlyRevenue.cents += service.priceCents;
    monthlyRevenue.rows += 1;
    rowIndex += 1;
  }
  return {
    customersRows,
    appointmentsRows,
    paymentsRows,
    monthlyRevenueCents: monthlyRevenue.cents,
    rowCount: monthlyRevenue.rows
  };
}

function saveCatalog(service, session, catalog) {
  const existingStaff = service.listStaff(session);
  existingStaff.forEach((row, index) => {
    service.saveStaff({
      ...row,
      name: STAFF_NAMES[index % STAFF_NAMES.length],
      role: index < 2 ? "stylist" : "colorist",
      hourlyCostCents: 0
    }, session);
  });
  return catalog.map((item) => service.saveService({
    name: item.name,
    category: "hair",
    durationMin: item.durationMinSynthetic,
    priceCents: item.priceCents,
    estimatedProductCostCents: 0,
    technologyCostCents: 0
  }, session));
}

function profileFn(iterations, fn) {
  const samples = [];
  for (let index = 0; index < WARMUP_ITERATIONS; index += 1) fn();
  for (let index = 0; index < iterations; index += 1) {
    samples.push(measure(fn).durationMs);
  }
  return {
    avgMs: Number(average(samples).toFixed(4)),
    p95Ms: Number(percentile(samples, 95).toFixed(4)),
    p99Ms: Number(percentile(samples, 99).toFixed(4)),
    maxMs: Number(Math.max(...samples).toFixed(4))
  };
}

function summarizeDecision(decision = {}) {
  return {
    primaryAction: decision.primaryAction || null,
    secondaryCount: Number(decision.secondaryActions?.length || 0),
    blockedCount: Number(decision.blockedActions?.length || 0),
    anomalyCount: Number(decision.anomalies?.length || 0),
    topAnomalies: (decision.anomalies || []).slice(0, 4)
  };
}

function summarizeMarketing(marketing = {}) {
  return {
    generatedActions: Number(marketing.suggestions?.length || marketing.actions?.length || 0),
    topSuggestion: (marketing.suggestions || marketing.actions || [])[0] || null,
    counters: marketing.counters || {},
    debug: marketing.debug || {}
  };
}

function summarizeProfitability(profitability = {}) {
  return {
    alertCount: Number(profitability.alerts?.length || 0),
    topAlert: profitability.alerts?.[0] || null,
    topSuggestion: profitability.suggestions?.[0] || null,
    monthlyTrend: profitability.monthlyTrend || [],
    summary: profitability.summary || profitability.totals || {}
  };
}

function summarizeDecisionCenter(center = {}) {
  const sections = Array.isArray(center.sections) ? center.sections : [];
  return {
    totalInsights: Number(center.summary?.totalInsights || 0),
    snapshot: center.summary?.snapshot || {},
    sections: sections.map((section) => ({
      key: section.key,
      title: section.title,
      items: (section.items || []).slice(0, 4)
    }))
  };
}

function summarizeOperational(report = {}) {
  return {
    totals: report.totals || {},
    topServices: (report.topServices || []).slice(0, 5),
    topOperators: (report.topOperators || []).slice(0, 5),
    monthlyTrend: report.monthlyTrend || []
  };
}

function summarizeDashboard(stats = {}) {
  return {
    todayAppointments: Number(stats.todayAppointments || 0),
    inactiveClientsCount: Number(stats.inactiveClientsCount || 0),
    revenueCents: Number(stats.revenueCents || 0),
    paymentSummary: stats.paymentSummary || {},
    dataQuality: stats.dataQuality || {},
    dashboardCache: stats.dashboardCache || {}
  };
}

function measureWindow(service, session, label, options = {}) {
  const dashboard = service.getDashboardStats(
    options.period ? { period: options.period, anchorDate: options.anchorDate } : {},
    session
  );
  const operational = service.getOperationalReport(options, session);
  const centerHealth = service.getCenterHealth(options, session);
  const profitabilityOverview = service.getProfitabilityOverview(options, session);
  const profitability = service.getAiGoldProfitability(options, session);
  const decision = service.getGoldDecisionContext(options, session);
  const decisionCenter = service.getAiGoldDecisionCenter(options, session);
  const dataQuality = service.getDataQuality(session, { summaryOnly: true });

  return {
    label,
    range: { startDate: options.startDate || "", endDate: options.endDate || "", period: options.period || "" },
    dashboard: summarizeDashboard(dashboard),
    operational: summarizeOperational(operational),
    centerHealth,
    profitabilityOverview: {
      totals: profitabilityOverview.totals || {},
      monthlyTrend: profitabilityOverview.monthlyTrend || [],
      centerHealth: profitabilityOverview.centerHealth || {}
    },
    profitability: summarizeProfitability(profitability),
    decision: summarizeDecision(decision),
    decisionCenter: summarizeDecisionCenter(decisionCenter),
    dataQuality: {
      score: Number(dataQuality.score || 0),
      status: dataQuality.status || "",
      aiGoldEligible: Boolean(dataQuality.aiGoldEligible),
      profitabilityReliable: Boolean(dataQuality.profitabilityReliable),
      metrics: dataQuality.metrics || {}
    }
  };
}

function profileService(service, session, fullRange) {
  return {
    getDashboardStatsDay: profileFn(PROFILE_ITERATIONS, () => service.getDashboardStats({}, session)),
    getOperationalReport90d: profileFn(PROFILE_ITERATIONS, () => service.getOperationalReport(fullRange, session)),
    getCenterHealth90d: profileFn(PROFILE_ITERATIONS, () => service.getCenterHealth(fullRange, session)),
    getProfitabilityOverview90d: profileFn(PROFILE_ITERATIONS, () => service.getProfitabilityOverview(fullRange, session)),
    getAiGoldProfitability90d: profileFn(PROFILE_ITERATIONS, () => service.getAiGoldProfitability(fullRange, session)),
    getAiGoldMarketingSnapshot: profileFn(PROFILE_ITERATIONS, () => service.getAiGoldMarketingSnapshot(session)),
    getGoldDecisionContext90d: profileFn(PROFILE_ITERATIONS, () => service.getGoldDecisionContext(fullRange, session))
  };
}

function buildFindings(report) {
  const findings = [];
  const full = report.windows.full90d;
  const current = report.windows.currentDay;
  const marketing = report.marketing || {};
  if (!full.decision.primaryAction) {
    findings.push({
      severity: "high",
      key: "missing_primary_action",
      message: "Su 90 giorni Gold non promuove una primary action."
    });
  }
  if (!full.dataQuality.aiGoldEligible) {
    findings.push({
      severity: "high",
      key: "gold_not_eligible",
      message: "Dopo 3 mesi di dati importati Gold resta non eligible.",
      evidence: full.dataQuality
    });
  }
  if (!full.dataQuality.profitabilityReliable) {
    findings.push({
      severity: "high",
      key: "profitability_not_reliable",
      message: "La redditività resta non affidabile perché il catalogo non ha costi reali.",
      evidence: full.dataQuality.metrics
    });
  }
  if (Number(marketing.generatedActions || 0) === 0) {
    findings.push({
      severity: "medium",
      key: "marketing_still_quiet",
      message: "Il marketing non genera azioni abbastanza presto sullo storico importato."
    });
  }
  if (Number(current.dashboard.todayAppointments || 0) === 0) {
    findings.push({
      severity: "medium",
      key: "current_day_empty",
      message: "Nel giorno corrente non ci sono appuntamenti: dashboard veloce ma poco significativa finché non entra uso giornaliero vivo."
    });
  }
  return findings;
}

function main() {
  ensureDir(reportsDir);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const tempDataDir = path.join(tempDir, "data");
  const tempPublicDir = path.join(tempDir, "public");
  const tempExportsDir = path.join(tempPublicDir, "exports");
  fs.cpSync(baselineDataDir, tempDataDir, { recursive: true });
  ensureDir(tempExportsDir);

  const xlsxDir = path.join(reportsDir, "privilege-90d-xlsx");
  ensureDir(xlsxDir);
  const customersXlsx = path.join(xlsxDir, "privilege_90d_clienti.xlsx");
  const appointmentsXlsx = path.join(xlsxDir, "privilege_90d_appuntamenti.xlsx");
  const paymentsXlsx = path.join(xlsxDir, "privilege_90d_pagamenti.xlsx");

  const clientPool = buildClientPool();
  const catalog = buildServiceCatalog();
  const monthSpecs = [
    { label: "2026-01", startDate: new Date(Date.UTC(2026, 0, 1)), endDate: "2026-01-31" },
    { label: "2026-02", startDate: new Date(Date.UTC(2026, 1, 1)), endDate: "2026-02-28" },
    { label: "2026-03", startDate: new Date(Date.UTC(2026, 2, 1)), endDate: "2026-03-31" }
  ];

  const allCustomers = [];
  const allAppointments = [];
  const allPayments = [];
  const monthlyTargets = [];
  monthSpecs.forEach((month) => {
    const monthly = buildMonthlyWorkRows(catalog, clientPool, month.startDate, month.label, TARGET_MONTHLY_REVENUE_CENTS);
    allCustomers.push(...monthly.customersRows);
    allAppointments.push(...monthly.appointmentsRows);
    allPayments.push(...monthly.paymentsRows);
    monthlyTargets.push({
      month: month.label,
      targetEuro: formatEuro(TARGET_MONTHLY_REVENUE_CENTS),
      generatedEuro: formatEuro(monthly.monthlyRevenueCents),
      rows: monthly.rowCount
    });
  });

  writeWorkbook(customersXlsx, "clienti", allCustomers);
  writeWorkbook(appointmentsXlsx, "appuntamenti", allAppointments);
  writeWorkbook(paymentsXlsx, "pagamenti", allPayments);

  process.chdir(tempDir);
  const { DesktopMirrorService } = require(path.resolve(__dirname, "..", "src", "DesktopMirrorService.js"));
  const service = new DesktopMirrorService();
  const session = {
    userId: "privilege-90d",
    username: "cristian",
    role: "superadmin",
    accessState: "active",
    subscriptionPlan: "gold",
    centerId: "center_admin",
    centerName: "Privilege Parrucchieri"
  };

  saveCatalog(service, session, catalog);
  const onboarding = service.getGoldOnboardingEngine();
  const analyze = onboarding.analyze({
    files: [
      toImportFile(customersXlsx, "customers"),
      toImportFile(appointmentsXlsx, "appointments"),
      toImportFile(paymentsXlsx, "payments")
    ]
  }, session);
  const reviewIds = [
    ...(analyze.snapshots?.import_customers_snapshot?.reviewRows || []).map((item) => item.id),
    ...(analyze.snapshots?.import_appointments_snapshot?.reviewRows || []).map((item) => item.id),
    ...(analyze.snapshots?.import_payments_snapshot?.reviewRows || []).map((item) => item.id)
  ];
  const decisions = Object.fromEntries(reviewIds.map((id) => [id, "approve"]));
  const confirm = onboarding.confirm({ importId: analyze.importId, decisions }, session);

  const fullRange = { startDate: "2026-01-01", endDate: "2026-03-31" };
  const windows = {
    january: measureWindow(service, session, "gennaio", { startDate: "2026-01-01", endDate: "2026-01-31", period: "month", anchorDate: "2026-01-31" }),
    february: measureWindow(service, session, "febbraio", { startDate: "2026-02-01", endDate: "2026-02-28", period: "month", anchorDate: "2026-02-28" }),
    march: measureWindow(service, session, "marzo", { startDate: "2026-03-01", endDate: "2026-03-31", period: "month", anchorDate: "2026-03-31" }),
    full90d: measureWindow(service, session, "90_giorni", fullRange),
    currentDay: measureWindow(service, session, "giorno_corrente", {})
  };

  const marketing = summarizeMarketing(service.getAiGoldMarketingSnapshot(session));
  const profile = profileService(service, session, fullRange);
  const monthlyRevenue = aggregateMonthlyRevenue(service.paymentsRepository.list());
  const report = {
    generatedAt: nowIso(),
    test: "privilege_90d_real_use_v1",
    note: {
      mode: "test in workspace temporaneo, senza toccare il Privilege pulito locale/live",
      prices: "prezzi da listini pubblici online già fissati nel lab",
      durations: "durate sintetiche solo per agenda e volume operativo"
    },
    sources: PRICE_SOURCES,
    tempWorkspace: tempDir,
    artifacts: {
      customersXlsx,
      appointmentsXlsx,
      paymentsXlsx
    },
    monthlyTargets,
    onboarding: {
      analyze: analyze.summary,
      confirm: confirm.summary || confirm,
      importedCounts: {
        clients: service.clientsRepository.list().length,
        appointments: service.appointmentsRepository.list().length,
        payments: service.paymentsRepository.list().length,
        services: service.servicesRepository.list().length
      }
    },
    monthlyRevenue,
    windows,
    marketing,
    performance: profile
  };
  report.findings = buildFindings(report);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
