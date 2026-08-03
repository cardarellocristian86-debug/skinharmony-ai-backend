Warning: truncated output (original token count: 197649)
Total output lines: 16218

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JsonFileRepository } = require("./JsonFileRepository");
const {
  SKINHARMONY_LIBRARY_CENTER_ID,
  skinHarmonyProtocolLibrary
} = require("./SkinHarmonyProtocolLibrary");
const { ProgressiveIntelligenceActivationLayer } = require("./ProgressiveIntelligenceActivationLayer");
const { FleetIntelligenceLayer } = require("./fleet_intelligence_layer");
const { GoldOnboardingEngine } = require("./GoldOnboardingEngine");
const { CONFIDENCE, computeCenterProfitabilitySnapshot } = require("./core/profitability/ProfitabilityCore");
const { computeCashSnapshot } = require("./core/cash/CashCore");
const { adaptCashSnapshotToLegacyComparable } = require("./core/cash/CashPolicyAdapter");
const { computeDataQualitySnapshot } = require("./core/data-quality/DataQualityCore");
const { adaptDataQualitySnapshotToLegacyComparable } = require("./core/data-quality/DQPolicyAdapter");
const { computeMarketingSnapshot } = require("./core/marketing/MarketingCore");
const { adaptAgendaSnapshotToLegacyComparable } = require("./core/agenda/AgendaPolicyAdapter");
const { buildComparableDecisionSnapshot } = require("./core/decision/DecisionPolicyAdapter");

const DATA_DIR = path.resolve(process.cwd(), "data");
const EXPORTS_DIR = path.resolve(process.cwd(), "public", "exports");

const DEFAULT_CENTER_ID = "center_admin";
const DEFAULT_CENTER_NAME = "Privilege Parrucchieri";
const DEFAULT_ADMIN_USERNAME = "cristian";
const BOOTSTRAP_ADMIN_PASSWORD = String(process.env.SMARTDESK_ADMIN_PASSWORD || "").trim();
const DEFAULT_TRIAL_DAYS = 7;
const DEFAULT_TRIAL_VERIFICATION_MINUTES = 30;
const ANALYTICS_CACHE_TTL_MS = 120000;
const SNAPSHOT_CACHE_TTL_MS = 60000;
const GOLD_DECISION_HISTORY_LIMIT = 10;
const GOLD_TEMPORAL_EPSILON = 0.03;
const GOLD_TEMPORAL_CONFIDENCE_NU = 0.30;
const GOLD_TREND_MU1 = 0.20;
const GOLD_TREND_MU2 = 0.10;
const GOLD_ENTERPRISE_RISK_RHO = Object.freeze({ friction: 0.45, dataGap: 0.30, instability: 0.25 });
const GOLD_ENTERPRISE_ACTION_COST = Object.freeze({ ACT_NOW: 0.06, SUGGEST: 0.04, MONITOR: 0.015, VERIFY: 0.025, STOP: 0 });
const GOLD_ENTERPRISE_BAYES_PRIOR = Object.freeze({ alpha: 2, beta: 2 });
const CASH_PARALLEL_DIFF_WEIGHTS = Object.freeze({ billedDue: 0.25, reconciledCash: 0.35, unlinkedCash: 0.20, gap: 0.20 });
const CASH_PARALLEL_WARNING_THRESHOLDS = Object.freeze({ billedDue: 0.15, reconciledCash: 0.15, unlinkedCash: 0.20, gap: 0.15 });
const CASH_CONTROLLED_SWITCH_THRESHOLDS = Object.freeze({
  agreementScore: 0.85,
  coreConfidenceScore: 0.80,
  dataCompleteness: 0.75,
  reconciliationRatio: 0.80,
  ambiguityRatio: 0.20,
  hysteresisOn: 0.85,
  hysteresisOff: 0.70
});
const CASH_CONTROLLED_SWITCH_WEIGHTS = Object.freeze({ agreementScore: 0.40, coreConfidenceScore: 0.40, dataCompleteness: 0.20 });
const CONTROL_ROOM_AUDIT_DEFAULT_LIMIT = 200;
const CONTROL_ROOM_AUDIT_MAX_LIMIT = 500;
const DATA_QUALITY_PARALLEL_WEIGHTS = Object.freeze({
  dataQualityScore: 0.30,
  paymentQuality: 0.15,
  costQuality: 0.15,
  crmQuality: 0.10,
  appointmentQuality: 0.10,
  linkQuality: 0.10,
  consistencyQuality: 0.10
});
const DATA_QUALITY_PARALLEL_WARNING_THRESHOLD = 0.15;
const MARKETING_PARALLEL_WEIGHTS = Object.freeze({
  readiness: 0.20,
  eligibleRatio: 0.15,
  contactableRatio: 0.15,
  suppressedRatio: 0.15,
  top3Overlap: 0.20,
  averageOpportunity: 0.15
});
const MARKETING_PARALLEL_WARNING_THRESHOLD = 0.20;
const GOLD_WHATSAPP_MESSAGE_COST_EUR = 0.05;
const DASHBOARD_AUTO_REFRESH_MS = 3 * 60 * 60 * 1000;
const DASHBOARD_MANUAL_COOLDOWN_MS = 10 * 60 * 1000;
const APPOINTMENTS_DAY_CACHE_TTL_MS = 15000;
const DEFAULT_OPERATIONAL_SEED_IDEMPOTENCY_PREFIX = "smartdesk-demo-seed-v1";
const DEFAULT_OPERATIONAL_STAFF_COUNT_MIN = 1;
const DEFAULT_OPERATIONAL_SERVICES_COUNT_MIN = 2;
const DEFAULT_OPERATIONAL_CLIENTS_COUNT_MIN = 2;
const DEFAULT_OPERATIONAL_INVENTORY_COUNT_MIN = 2;
const DEFAULT_OPERATIONAL_APPOINTMENTS_COUNT_MIN = 1;
const DEFAULT_OPERATIONAL_PAYMENTS_COUNT_MIN = 1;
const CHANGE_IMPACT_CONTRACT = Object.freeze({
  schemaVersion: "skinharmony_change_impact_contract_v1",
  enabled: true,
  source: "suite_5_1_41_change_impact_orchestration",
  coreBranch: "change_impact_orchestration",
  mode: "read_only_domino_guard",
  automationLevel: "assisted_owner_confirm",
  ownerConfirmationRequired: true,
  executionAllowed: false,
  rollbackRequired: true,
  smartDeskSurface: "ai_gold",
  requiredScope: "impact_review",
  requiredActions: Object.freeze([
    "read_current_state",
    "classify_affected_surfaces",
    "check_plan_permissions",
    "check_core_branches",
    "check_suite_connector_contract",
    "check_smartdesk_gold_contract",
    "prepare_tests",
    "prepare_rollback",
    "wait_owner_confirmation"
  ]),
  testsRequired: Object.freeze([
    "node --check smartdesk-live/server.js",
    "node --check smartdesk-live/src/DesktopMirrorService.js",
    "node --check smartdesk-live/public/assets/gold-bridge.js",
    "curl /api/ai-gold/capabilities",
    "curl /api/ai-gold/decision-context",
    "curl /api/ai-gold/change-impact-contract"
  ]),
  blockedUntil: Object.freeze([
    "core_or_owner_confirms_sensitive_change",
    "affected_services_are_identified",
    "rollback_path_is_known",
    "tests_are_defined"
  ])
});

const OPERATIONAL_DEMO_SEED = Object.freeze({
  services: [
    {
      idempotencyKey: `${DEFAULT_OPERATIONAL_SEED_IDEMPOTENCY_PREFIX}:service:hair_cut`,
      name: "Taglio e piega",
      category: "Capelli",
      durationMin: 45,
      priceCents: 4500,
      estimatedProductCostCents: 1200,
      technologyCostCents: 1500
    },
    {
      idempotencyKey: `${DEFAULT_OPERATIONAL_SEED_IDEMPOTENCY_PREFIX}:service:keratin`,
      name: "Keratin Treatment",
      category: "Ricostruzione",
      durationMin: 90,
      priceCents: 12000,
      estimatedProductCostCents: 3200,
      technologyCostCents: 1800
    }
  ],
  clients: [
    {
      idempotencyKey: `${DEFAULT_OPERATIONAL_SEED_IDEMPOTENCY_PREFIX}:client:client_anna`,
      fullName: "Anna Moretti",
      firstName: "Anna",
      lastName: "Moretti",
      phone: "+39 333 111 2244",
      email: "anna.moretti@example.com",
      birthDate: "1990-03-12",
      notes: "Cliente attiva mensilmente, preferisce appuntamenti nel tardo pomeriggio.",
      privacyConsent: true,
      marketingConsent: true
    },
    {
      idempotencyKey: `${DEFAULT_OPERATIONAL_SEED_IDEMPOTENCY_PREFIX}:client:client_luigi`,
      fullName: "Luigi Bianchi",
      firstName: "Luigi",
      lastName: "Bianchi",
      phone: "347 888 5532",
      email: "luigi.bianchi@example.com",
      birthDate: "1986-11-02",
      notes: "Cliente fidelizzato, gradisce promemoria SMS.",
      marketingConsent: false
    }
  ],
  inventory: [
    {
      idempotencyKey: `${DEFAULT_OPERATIONAL_SEED_IDEMPOTENCY_PREFIX}:inventory:shampoo`,
      name: "Shampoo professionale",
      sku: "SHAM-001",
      category: "Capelli",
      supplier: "Distributore Centro",
      quantity: 24,
      stockQuantity: 24,
      minQuantity: 6,
      thresholdQuantity: 6,
      costCents: 900,
      salePriceCents: 2100,
      unit: "pz",
      usageType: "cabina"
    },
    {
      idempotencyKey: `${DEFAULT_OPERATIONAL_SEED_IDEMPOTENCY_PREFIX}:inventory:maschera`,
      name: "Maschera idratante",
      sku: "MASK-005",
      category: "Capelli",
      supplier: "Distributore Centro",
      quantity: 12,
      stockQuantity: 12,
      minQuantity: 4,
      thresholdQuantity: 4,
      costCents: 1300,
      salePriceCents: 2500,
      unit: "pz",
      usageType: "cabina"
    }
  ]
});

const ANALYTICS_BLOCKS = {
  CLIENTS_QUALITY: "clientsQuality",
  SERVICES_QUALITY: "servicesQuality",
  PAYMENTS_QUALITY: "paymentsQuality",
  APPOINTMENTS_QUALITY: "appointmentsQuality",
  OPERATORS_QUALITY: "operatorsQuality",
  INVENTORY_QUALITY: "inventoryQuality",
  PROFITABILITY_QUALITY: "profitabilityQuality",
  DATA_QUALITY: "dataQuality",
  DATA_QUALITY_SUMMARY: "dataQualitySummary",
  OPERATIONAL_REPORT: "operationalReport",
  PROFITABILITY: "profitability",
  PROFITABILITY_SUMMARY: "profitabilitySummary",
  PAYMENT_ISSUES: "paymentIssues",
  RECALL_PRIORITY: "recallPriority",
  MARKETING_RECALL: "marketingRecall",
  GOLD_STATE: "goldState",
  CENTER_HEALTH: "centerHealth",
  INVENTORY_OVERVIEW: "inventoryOverview",
  OPERATOR_SIGNALS: "operatorSignals",
  SHIFT_SIGNALS: "shiftSignals",
  DASHBOARD_STATS: "dashboardStats",
  SILVER_CORE_SNAPSHOT: "silverCoreSnapshot"
};

const UPDATE_MODES = {
  REALTIME: "realtime",
  EVENT_DRIVEN: "event_driven",
  TIMEOUT_BATCH: "timeout_batch",
  MANUAL: "manual",
  SNAPSHOT_READ: "snapshot_read"
};

const ANALYTICS_UPDATE_POLICIES = {
  agendaDay: {
    mode: UPDATE_MODES.REALTIME,
    type: "summary",
    purpose: "Agenda operativa del giorno",
    trigger: "apertura agenda/dashboard e modifiche appuntamenti",
    condition: "sempre disponibile",
    risk: "se non e live l'operatore perde controllo operativo"
  },
  appointmentStatus: {
    mode: UPDATE_MODES.REALTIME,
    type: "summary",
    purpose: "Stato arrivo, in corso, completato, no-show",
    trigger: "cambio stato appuntamento",
    condition: "sempre disponibile",
    risk: "deve aggiornarsi subito per cassa e agenda"
  },
  cashdeskDay: {
    mode: UPDATE_MODES.REALTIME,
    type: "summary",
    purpose: "Incasso e pagamenti del giorno",
    trigger: "apertura cassa e registrazione pagamento",
    condition: "sempre disponibile",
    risk: "non deve dipendere da snapshot o batch"
  },
  livePayments: {
    mode: UPDATE_MODES.REALTIME,
    type: "summary",
    purpose: "Pagamento appena registrato",
    trigger: "creazione pagamento",
    condition: "sempre disponibile",
    risk: "l'utente deve vedere subito cosa ha salvato"
  },
  paymentIssues: {
    mode: UPDATE_MODES.MANUAL,
    type: "detail",
    purpose: "Pagamenti da collegare e riconciliazione",
    trigger: "click Verifica cassa / Controllo pagamenti / Chiudi cassa",
    condition: "calcolo on demand con cache breve",
    risk: "se live continuo pesa senza migliorare il lavoro"
  },
  cashdeskVerification: {
    mode: UPDATE_MODES.MANUAL,
    type: "detail",
    purpose: "Verifica o chiusura cassa",
    trigger: "azione esplicita utente",
    condition: "solo su richiesta",
    risk: "deve produrre azioni risolvibili, non solo alert"
  },
  dataQualitySummary: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Qualita dati sintetica per dashboard/snapshot",
    trigger: "modifica cliente, servizio, pagamento, appuntamento, operatore, magazzino",
    condition: "dirty flag per blocco",
    risk: "non deve trascinare preview e checks completi in dashboard"
  },
  dataQualityFull: {
    mode: UPDATE_MODES.TIMEOUT_BATCH,
    type: "detail",
    purpose: "Controlli completi qualita dati e preview problemi",
    trigger: "timeout, batch o click vista dettaglio",
    condition: "forceRefresh se richiesto",
    risk: "troppo pesante per lettura continua"
  },
  profitabilitySummary: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Sintesi margini e quadro economico",
    trigger: "checkout, pagamento, modifica costi/prezzi",
    condition: "riuso cache analytics se non stale",
    risk: "deve alimentare AI Gold senza ricalcoli diretti"
  },
  profitabilityDetail: {
    mode: UPDATE_MODES.MANUAL,
    type: "detail",
    purpose: "Margini servizio/prodotto/tecnologia",
    trigger: "apertura Redditivita o Aggiorna analisi",
    condition: "on demand, con forceRefresh opzionale",
    risk: "periodi lunghi possono pesare"
  },
  profitabilityAlerts: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Alert margini bassi o servizi in perdita",
    trigger: "checkout, pagamento, modifica costi/prezzi",
    condition: "entra nel Business Snapshot",
    risk: "deve restare operativo, non tecnico"
  },
  reportOperationalSummary: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Numeri ordinati: incassi, ticket, appuntamenti, clienti",
    trigger: "pagamento, checkout, modifica appuntamento",
    condition: "periodi brevi e cache analytics",
    risk: "non deve ricalcolare tutto in Gold"
  },
  reportOperationalDetail: {
    mode: UPDATE_MODES.MANUAL,
    type: "detail",
    purpose: "Timeline, top servizi, top operatori, periodo lungo",
    trigger: "apertura Report o export",
    condition: "on demand o batch per periodi lunghi",
    risk: "se automatico rallenta dashboard"
  },
  recallPriority: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Clienti da richiamare ora",
    trigger: "appuntamento completato, modifica cliente, storico visite",
    condition: "solo richiamare/a rischio",
    risk: "non includere persi e storico nella priorita"
  },
  lostClients: {
    mode: UPDATE_MODES.TIMEOUT_BATCH,
    type: "detail",
    purpose: "Clienti persi recenti",
    trigger: "batch giornaliero o apertura Marketing",
    condition: "fuori dalla lista prioritaria",
    risk: "puo gonfiare i numeri se trattato come recall urgente"
  },
  historicInactive: {
    mode: UPDATE_MODES.TIMEOUT_BATCH,
    type: "detail",
    purpose: "Storico inattivi vecchi",
    trigger: "batch giornaliero/settimanale o filtro dedicato",
    condition: "mai in priorita principale",
    risk: "lista grande e poco operativa"
  },
  centerHealth: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Salute centro su fatturato, operatori, agenda, continuita",
    trigger: "checkout, pagamento, agenda, clienti",
    condition: "separata da prodotti e tecnologie",
    risk: "non deve essere falsata da margini alti con basso volume"
  },
  dashboardGoldAlerts: {
    mode: UPDATE_MODES.SNAPSHOT_READ,
    type: "summary",
    purpose: "Priorita operative visibili in dashboard Gold",
    trigger: "Business Snapshot aggiornato",
    condition: "lettura snapshot-only",
    risk: "non ricalcolare nella dashboard"
  },
  businessSnapshot: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Fotografia coerente del centro per AI Gold",
    trigger: "dirty blocks, preload dashboard Gold, rebuild controllato",
    condition: "solo Gold",
    risk: "prossimo step: debounce/batch persistente"
  },
  decisionCenter: {
    mode: UPDATE_MODES.SNAPSHOT_READ,
    type: "summary",
    purpose: "Decisioni operative AI Gold",
    trigger: "apertura AI Gold o dashboard decisionale",
    condition: "legge Business Snapshot",
    risk: "non deve chiamare report/profitability/data-quality diretti"
  },
  operatorSignals: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Segnali operatori, saturazione e resa",
    trigger: "turni, appuntamenti, checkout",
    condition: "solo se modulo turni/operatori attivo",
    risk: "non pesare su centri che non usano turni"
  },
  inventoryOverview: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Giacenze, sottoscorta e quadro magazzino",
    trigger: "modifica prodotto o movimento stock",
    condition: "lista articoli resta operativa, overview cache",
    risk: "Base non deve vedere numeri avanzati fuorvianti"
  },
  shifts: {
    mode: UPDATE_MODES.REALTIME,
    type: "summary",
    purpose: "Turni operativi dipendenti",
    trigger: "apertura Turni e modifica turno",
    condition: "solo se shiftsBaseEnabled=true",
    risk: "se modulo spento non deve calcolare"
  },
  shiftReports: {
    mode: UPDATE_MODES.MANUAL,
    type: "detail",
    purpose: "Report presenze, PDF e periodo",
    trigger: "apertura report turni/export",
    condition: "solo modulo turni attivo e piano adeguato",
    risk: "non serve durante lavoro ordinario"
  },
  clientDuplicates: {
    mode: UPDATE_MODES.MANUAL,
    type: "detail",
    purpose: "Possibili duplicati clienti",
    trigger: "click sezione duplicati o batch dedicato",
    condition: "non blocca creazione cliente",
    risk: "falsi positivi se troppo aggressivo"
  },
  trendAnalysis: {
    mode: UPDATE_MODES.TIMEOUT_BATCH,
    type: "detail",
    purpose: "Trend e analisi periodo lungo",
    trigger: "batch o apertura report periodo",
    condition: "mai realtime",
    risk: "periodi lunghi possono saturare la lettura"
  },
  marketingAutopilotCandidates: {
    mode: UPDATE_MODES.EVENT_DRIVEN,
    type: "summary",
    purpose: "Candidati azioni marketing Gold",
    trigger: "recallPriority aggiornato o generazione azioni",
    condition: "candidati automatici, invio sempre confermato",
    risk: "messaggi completi meglio on demand"
  },
  messageDrafts: {
    mode: UPDATE_MODES.MANUAL,
    type: "detail",
    purpose: "Messaggi pronti da copiare",
    trigger: "click Prepara messaggio / Genera azioni",
    condition: "on demand",
    risk: "non generare testi inutili per tutti i clienti"
  }
};

const defaultSettings = {
  centerName: DEFAULT_CENTER_NAME,
  centerType: "Advanced Aesthetic Systems",
  centerLegalName: "",
  centerVatNumber: "",
  centerTaxCode: "",
  centerEmail: "",
  centerPhone: "",
  centerAddress: "",
  centerCity: "",
  centerProvince: "",
  centerPostalCode: "",
  businessModel: "esthetic",
  agendaStartHour: "08:00",
  agendaEndHour: "20:00",
  agendaSlotMinutes: "30",
  agendaSoundEnabled: true,
  agendaPageFlipEnabled: false,
  defaultView: "day",
  fullscreenAgenda: true,
  enableMarketing: false,
  enableTreatments: true,
  enableCashdesk: true,
  enableProtocolsHub: true,
  enableTrainingHub: true,
  enableMultiLocation: false,
  aiMode: "local",
  aiActionsEnabled: true,
  shiftsBaseEnabled: true,
  shiftsTemplatesEnabled: true,
  shiftsClockEnabled: true,
  shiftsReportsEnabled: true,
  shiftsFlexEnabled: false,
  inventoryBaseEnabled: true,
  inventoryMovementsEnabled: true,
  inventoryAlertsEnabled: true,
  inventoryReportsEnabled: true,
  profitabilityEnabled: true,
  profitabilityOperatorCostEnabled: true,
  profitabilityTechnologyAnalysisEnabled: true,
  operatorReportsEnabled: true,
  operatorComparisonEnabled: true,
  operatorRewardsEnabled: true,
  operatorSalesBonusEnabled: true,
  operatorPerformanceBonusEnabled: true,
  operatorRetentionBonusEnabled: true,
  operatorBenefitsEnabled: true,
  membershipEnabled: true,
  membershipPearlThresholdCents: 30000,
  membershipSilverThresholdCents: 70000,
  membershipGoldThresholdCents: 120000,
  membershipPearlDiscountPercent: 5,
  membershipSilverDiscountPercent: 10,
  membershipGoldDiscountPercent: 15,
  whatsappSilverRedirectEnabled: true,
  whatsappGoldMode: "not_active",
  whatsappBusinessPhone: "",
  whatsappActivationRequestedAt: "",
  whatsappCenterNumberConfirmed: false,
  whatsappCustomerConsentConfirmed: false,
  whatsappMonthlyQuota: 100,
  whatsappMonthlyUsed: 0,
  whatsappMode: "silver_redirect",
  whatsappProvider: "twilio",
  whatsappTemplatesReady: false,
  whatsappWebhookReady: false,
  whatsappTwilioAccountSid: "",
  whatsappTwilioAuthToken: "",
  whatsappTwilioAuthTokenConfigured: false,
  whatsappTwilioFrom: "",
  whatsappTwilioConnectedAt: "",
  whatsappTwilioLastTestAt: "",
  whatsappTwilioLastTestStatus: "",
  whatsappTwilioLastTestMessage: ""
};

const DEFAULT_STAFF = [
  { id: "staff_1", name: "Operatore 1", colorTag: "#6db7ff", role: "Operatore", active: 1 },
  { id: "staff_2", name: "Operatore 2", colorTag: "#8fd9c8", role: "Operatore", active: 1 },
  { id: "staff_3", name: "Responsabile", colorTag: "#d7b3ff", role: "Responsabile", active: 1 }
];

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function economicConfigGapText(servicesMissingCosts = 0, operatorsMissingHourlyCost = 0, mode = "complete") {
  const parts = [];
  const servicesCount = Number(servicesMissingCosts || 0);
  const operatorsCount = Number(operatorsMissingHourlyCost || 0);
  if (servicesCount > 0) parts.push(`${servicesCount} costi servizio`);
  if (operatorsCount > 0) parts.push(`${operatorsCount} costi orari operatori`);
  const gap = parts.join(" e ") || "configurazione economica";
  if (mode === "missing") return gap;
  if (mode === "action") return `completa ${gap}`;
  return `Completa ${gap}`;
}

function localizeServerText(value, language = "it") {
  const counted = (singular, plural) => (_match, count) => `${count} ${Number(count) === 1 ? singular : plural}`;
  if (language === "de") {
    return String(value || "")
      .replace(/\bfatturato per operatore sotto soglia · agenda poco satura · continuità clienti bassa · pochi clienti attivi nel periodo\b/g, "Umsatz pro Mitarbeitendem unter Schwelle · Agenda zu wenig ausgelastet · geringe Kundenkontinuität · zu wenige aktive Kunden im Zeitraum")
      .replace(/\bLa salute centro non include margini prodotti o resa tecnologie: prima sopravvivenza del centro, poi ottimizzazione dei margini\.\b/g, "Die Center-Gesundheit berücksichtigt keine Produktmargen oder Technologieerträge: zuerst Überleben des Centers, danach Margenoptimierung.")
      .replace(/\bLa center health non include margini prodotti o resa tecnologie: prima sopravvivenza del centro, poi ottimizzazione dei margini\.\b/g, "Die Center-Gesundheit berücksichtigt keine Produktmargen oder Technologieerträge: zuerst Überleben des Centers, danach Margenoptimierung.")
      .replace(/\bCenter health does not include product margins or technology performance: survival first, margin optimization after\.\b/g, "Die Center-Gesundheit berücksichtigt keine Produktmargen oder Technologieerträge: zuerst Überleben des Centers, danach Margenoptimierung.")
      .replace(/\bCenter state is not representative yet\b/g, "Center-Status noch nicht repräsentativ")
      .replace(/\bCautious center reading: economic setup incomplete\b/g, "Vorsichtige Center-Lesung: wirtschaftliche Konfiguration unvollständig")
      .replace(/\bVolume is present, center reading is still cautious\b/g, "Volumen vorhanden, Center-Lesung bleibt vorsichtig")
      .replace(/\bProfitability to configure: incomplete economic setup\b/g, "Rentabilität zu konfigurieren: wirtschaftliche Konfiguration unvollständig")
      .replace(/\bProfitability to configure\b/g, "Rentabilität zu konfigurieren")
      .replace(/\bSituation to verify\b/g, "Lage zu prüfen")
      .replace(/\bto verify\b/g, "zu prüfen")
      .replace(/\bbelow threshold\b/g, "unter Schwelle")
      .replace(/\blow\b/g, "niedrig")
      .replace(/\bmedium\b/g, "mittel")
      .replace(/\bhigh\b/g, "hoch")
      .replace(/\bcritical\b/g, "kritisch")
      .replace(/\bgood\b/g, "gut")
      .replace(/\bcontrol\b/g, "Kontrolle")
      .replace(/\bVolume is present, complete costs to unlock profitability\b/g, "Volumen ist vorhanden, Kosten ergänzen, um Rentabilität freizuschalten")
      .replace(/\bComplete data quality\b/g, "Datenqualität ergänzen")
      .replace(/\bReview margins and costs\b/g, "Marge und Kosten prüfen")
      .replace(/\bverify before acting\b/g, "vor der Aktion prüfen")
      .replace(/\bcomplete service and staff costs\b/g, "Leistungs- und Mitarbeiterkosten ergänzen")
      .replace(/\bcomplete service costs before reading profitability\b/g, "Leistungskosten ergänzen, bevor die Rentabilität gelesen wird")
      .replace(/\bThe Gold State Layer reports insufficient confidence or fragile data\./g, "Der Gold State Layer meldet geringe Sicherheit oder fragile Daten.")
      .replace(/\bThe center is working, but Gold avoids strong economic readings until service costs are complete\./g, "Das Center arbeitet, aber Gold vermeidet starke wirtschaftliche Lesungen, bis die Leistungskosten vollständig sind.")
      .replace(/\bThis is not a negative judgment on the center: economic setup is missing on\b/g, "Das ist kein negatives Urteil über das Center: wirtschaftliche Konfiguration fehlt bei")
      .replace(/\bState layer: saturation\b/g, "State Layer: Auslastung")
      .replace(/\bcontinuity\b/g, "Kontinuität")
      .replace(/\bconfidence\b/g, "Sicherheit")
      .replace(/\bRevenue\b/g, "Umsatz")
      .replace(/\baverage ticket\b/g, "Durchschnittsbon")
      .replace(/\bmissing service costs\b/g, "fehlende Leistungskosten")
      .replace(/\bunlinked payments\b/g, "nicht verknüpfte Zahlungen")
      .replace(/\bReliability\b/g, "Zuverlässigkeit")
      .replace(/\bCore checkout\b/g, "Core-Kasse")
      .replace(/\bSource gold_state\b/g, "Quelle gold_state")
      .replace(/\bOpen profitability\b/g, "Rentabilität öffnen")
      .replace(/\beconomic reading is not reliable yet\b/g, "wirtschaftliche Lesung ist noch nicht zuverlässig")
      .replace(/\byou are losing money\b/g, "du verlierst Geld")
      .replace(/\bmargin can improve\b/g, "Marge verbesserbar")
      .replace(/\byou are earning well\b/g, "du verdienst gut")
      .replace(/\bCenter state\b/g, "Center-Status")
      .replace(/\bDaily priorities\b/g, "Tagesprioritäten")
      .replace(/\bHidden opportunities\b/g, "Verborgene Chancen")
      .replace(/\bImmediate actions\b/g, "Sofortaktionen")
      .replace(/\bProduct and technology profitability\b/g, "Rentabilität von Produkten und Technologien")
      .replace(/\bCenter performance\b/g, "Center-Leistung")
      .replace(/\bcenter health\b/g, "Center-Gesundheit")
      .replace(/\bThe center shows real work signals, but until costs are complete its health must be read cautiously, not as a verdict\./g, "Das Center zeigt echte Arbeitssignale, aber bis die Kosten vollständig sind, muss seine Gesundheit vorsichtig gelesen werden, nicht als Urteil.")
      .replace(/\bThe center shows real volume, but until service costs and hourly staff costs are complete the overall reading must stay cautious\./g, "Das Center zeigt echtes Volumen, aber bis Leistungskosten und Stundenkosten vollständig sind, bleibt die Gesamtlesung vorsichtig.")
      .replace(/\bAt this stage do not read this block as a judgment on the center: the full reading unlocks when the economic setup and history become more representative\./g, "In dieser Phase ist dieser Block kein Urteil über das Center: die vollständige Lesung wird freigeschaltet, wenn wirtschaftliche Konfiguration und Historie repräsentativer sind.")
      .replace(/\bIncrease schedule volume and recalls before working on margins\./g, "Agenda-Volumen und Rückrufe erhöhen, bevor an Margen gearbeitet wird.")
      .replace(/\bStrengthen client continuity and schedule fill\./g, "Kundenkontinuität und Agenda-Auslastung stärken.")
      .replace(/\bKeep the pace and review only the weak points\./g, "Rhythmus halten und nur Schwachstellen prüfen.")
      .replace(/\bThe center is holding: work on margins and selective growth\./g, "Das Center hält: an Margen und selektivem Wachstum arbeiten.")
      .replace(/\bcomplete setup before reading center state\b/g, "Konfiguration ergänzen, bevor der Center-Status gelesen wird")
      .replace(/\bincrease schedule volume and recalls before margins\b/g, "Agenda-Volumen und Rückrufe vor Margen erhöhen")
      .replace(/\bstrengthen client continuity and schedule fill\b/g, "Kundenkontinuität und Agenda-Auslastung stärken")
      .replace(/\bkeep operational control\b/g, "operative Kontrolle halten")
      .replace(/\bA client to protect before continuity is lost\./g, "Ein Kunde, den man sichern sollte, bevor Kontinuität verloren geht.")
      .replace(/\bcontact within 3 days\b/g, "innerhalb von 3 Tagen kontaktieren")
      .replace(/\bLow-load day:/g, "Schwacher Tag:")
      .replace(/\bFill the gap with targeted recalls before pushing other services\./g, "Die Lücke mit gezielten Rückrufen füllen, bevor weitere Leistungen gepusht werden.")
      .replace(/\bfill the schedule gap\b/g, "Agenda-Lücke füllen")
      .replace(/\bpayments to link\b/g, "zu verknüpfende Zahlungen")
      .replace(/\bFix checkout before reading reports and profitability\./g, "Kasse korrigieren, bevor Berichte und Rentabilität gelesen werden.")
      .replace(/\bSome movements are not linked to a client or appointment\./g, "Einige Bewegungen sind nicht mit Kunde oder Termin verknüpft.")
      .replace(/\blink payments\b/g, "Zahlungen verknüpfen")
      .replace(/\bSecondary signal read from the Gold State Layer\./g, "Sekundäres Signal aus dem Gold State Layer.")
      .replace(/\bDo not read this as a judgment on the center: complete the economic setup first\./g, "Das ist kein Urteil über das Center: zuerst die wirtschaftliche Konfiguration ergänzen.")
      .replace(/\bReview price, duration and product consumption immediately\./g, "Preis, Dauer und Produktverbrauch sofort prüfen.")
      .replace(/\bMargin can improve: correct it before pushing the service\./g, "Marge verbesserbar: korrigieren, bevor die Leistung gepusht wird.")
      .replace(/\bVolume is present, but costs are not complete\. Missing\b/g, "Volumen ist vorhanden, aber Kosten sind nicht vollständig. Es fehlen")
      .replace(/\bservice costs and\b/g, "Leistungskosten und")
      .replace(/\bhourly costs\./g, "Stundenkosten.")
      .replace(/\bcomplete cost setup\b/g, "Kostenkonfiguration ergänzen")
      .replace(/\breview service cost\b/g, "Leistungskosten prüfen")
      .replace(/\bservice to push\b/g, "Leistung zum Fördern")
      .replace(/\bIt is a service worth proposing more consistently\./g, "Diese Leistung sollte konsequenter vorgeschlagen werden.")
      .replace(/\buse this service as a commercial benchmark\./g, "diese Leistung als kommerziellen Referenzwert nutzen.")
      .replace(/\bpromote this service\b/g, "diese Leistung fördern")
      .replace(/\bUseful but secondary signal: clarify the economic setup first\./g, "Nützliches, aber sekundäres Signal: zuerst die wirtschaftliche Konfiguration klären.")
      .replace(/\bUse this pattern as an operational benchmark\./g, "Dieses Muster als operative Referenz nutzen.")
      .replace(/\bkeep as reference, not as the primary priority\b/g, "als Referenz behalten, nicht als Hauptpriorität")
      .replace(/\buse as operational benchmark\b/g, "als operative Referenz nutzen")
      .replace(/\bReview schedule, assigned services and client continuity\./g, "Agenda, zugewiesene Leistungen und Kundenkontinuität prüfen.")
      .replace(/\breview operator\b/g, "Mitarbeitenden prüfen")
      .replace(/\bunderused or weak-profitability technology\b/g, "untergenutzte oder schwach rentable Technologie")
      .replace(/\bDecide whether to promote it better or reduce its operational weight\./g, "Entscheiden, ob sie besser beworben oder operativ reduziert werden soll.")
      .replace(/\bpromote the right technology\b/g, "passende Technologie fördern")
      .replace(/\bunder review\b/g, "unter Kontrolle")
      .replace(/\bAvoid operational stops on linked services\./g, "Operative Stopps bei verknüpften Leistungen vermeiden.")
      .replace(/\breview stock\b/g, "Lager prüfen")
      .replace(/\bhigh-value client to protect\b/g, "High-Value-Kunde zu sichern")
      .replace(/\bDo not treat this client as standard: prepare a path or an upgrade\./g, "Diesen Kunden nicht wie Standard behandeln: Verlauf oder Upgrade vorbereiten.")
      .replace(/\bpropose a path or upgrade\b/g, "Verlauf oder Upgrade vorschlagen")
      .replace(/\bProfitability not readable yet\b/g, "Rentabilität noch nicht lesbar")
      .replace(/\bProfitability ready for operational reading\b/g, "Rentabilität bereit für operative Lesung")
      .replace(/\bThe center is working, but margins would be misleading until service costs and hourly staff costs are complete\./g, "Das Center arbeitet, aber Margen wären irreführend, solange Leistungskosten und Stundenkosten nicht vollständig sind.")
      .replace(/\bThe economic reading can be used as operational support\./g, "Die wirtschaftliche Lesung kann als operative Unterstützung genutzt werden.")
      .replace(/\bEconomic setup is sufficient for stronger Gold readings\./g, "Die wirtschaftliche Konfiguration reicht für stärkere Gold-Lesungen.")
      .replace(/\breview margins and opportunities\b/g, "Margen und Chancen prüfen")
      .replace(/\bclients to review with priority\b/g, "Kunden mit Priorität prüfen")
      .replace(/\bCautious marketing: no contact promoted today\b/g, "Vorsichtiges Marketing: heute kein Kontakt priorisiert")
      .replace(/\bStart from the most urgent clients and prepare targeted messages\./g, "Mit den dringendsten Kunden starten und gezielte Nachrichten vorbereiten.")
      .replace(/\bWith the current rules Gold did not find recall actions safe enough to promote today\./g, "Mit den aktuellen Regeln hat Gold heute keine ausreichend sicheren Recall-Aktionen gefunden.")
      .replace(/\bGold orders recall, operational risk and real economic references already present before starting the message\./g, "Gold ordnet Recall, operatives Risiko und reale wirtschaftliche Referenzen, bevor die Nachricht startet.")
      .replace(/\bThis does not mean marketing is failing: today there are not enough useful contacts or strong enough signals to push an action\./g, "Das bedeutet nicht, dass Marketing nicht funktioniert: heute fehlen genug nützliche Kontakte oder starke Signale für eine Aktion.")
      .replace(/\bwork the recall list\b/g, "Recall-Liste bearbeiten")
      .replace(/\breview contacts, consents and history\b/g, "Kontakte, Einwilligungen und Historie prüfen")
      .replace(/\bFirst dashboard snapshot created\. The next openings will read the saved data\./g, "Erster Dashboard-Snapshot erstellt. Die nächsten Öffnungen lesen die gespeicherten Daten.")
      .replace(/\bComplete and check out appointments to activate a more accurate report\./g, "Termine abschließen und kassieren, um einen genaueren Bericht zu aktivieren.")
      .replace(/\bTo recall\b/g, "Zurückrufen")
      .replace(/\bAt risk\b/g, "Gefährdet")
      .replace(/\bLost\b/g, "Verloren")
      .replace(/\bHistoric\b/g, "Historisch")
      .replace(/\bOn track\b/g, "Im Plan")
      .replace(/\b(\d+) clients? without phone or email\b/g, counted("Kunde ohne Telefon oder E-Mail", "Kunden ohne Telefon oder E-Mail"))
      .replace(/\b(\d+) services? without configured costs\b/g, counted("Leistung ohne konfigurierte Kosten", "Leistungen ohne konfigurierte Kosten"))
      .replace(/\b(\d+) services? with estimated costs not linked to products or technologies\b/g, counted("Leistung mit geschätzten Kosten ohne Produkt- oder Technologieverknüpfung", "Leistungen mit geschätzten Kosten ohne Produkt- oder Technologieverknüpfung"))
      .replace(/\b(\d+) past appointments? without a linked payment\b/g, counted("vergangener Termin ohne verknüpfte Zahlung", "vergangene Termine ohne verknüpfte Zahlung"))
      .replace(/\b(\d+) payments? to link\b/g, counted("Zahlung zu verknüpfen", "Zahlungen zu verknüpfen"))
      .replace(/\b(\d+) possible duplicate client groups?\b/g, counted("mögliche Kundenduplikat-Gruppe", "mögliche Kundenduplikat-Gruppen"))
      .replace(/\bservices with estimated costs not linked to products or technologies\b/g, "Leistungen mit geschätzten Kosten ohne Produkt- oder Technologieverknüpfung")
      .replace(/\bpast appointments without a linked payment\b/g, "vergangene Termine ohne verknüpfte Zahlung")
      .replace(/\brevenue per operator below threshold\b/g, "Umsatz pro Mitarbeitendem unter Schwelle")
      .replace(/\bschedule fill is too low\b/g, "Agenda zu wenig ausgelastet")
      .replace(/\bclient continuity is low\b/g, "geringe Kundenkontinuität")
      .replace(/\btoo few active clients in the period\b/g, "zu wenige aktive Kunden im Zeitraum")
      .replace(/\brevenue, schedule fill and client continuity are aligned with the period\./g, "Umsatz, Agenda-Auslastung und Kundenkontinuität passen zum Zeitraum.")
      .replace(/\bCorrect the data that blocks reliable readings\./g, "Daten korrigieren, die zuverlässige Lesungen blockieren.")
      .replace(/\bKeep checkout, clients and services clean\./g, "Kasse, Kunden und Leistungen sauber halten.")
      .replace(/\bData is sufficient for operational reading\./g, "Daten reichen für eine operative Lesung aus.")
      .replace(/\bcorrect dirty data when it slows the analysis\b/g, "unsaubere Daten korrigieren, wenn sie die Analyse bremsen")
      .replace(/\bAssertive outputs remain blocked until data is more reliable\./g, "Assertive Ausgaben bleiben blockiert, bis Daten zuverlässiger sind.")
      .replace(/\bGenerate actions\b/g, "Aktionen generieren")
      .replace(/\bPrepare message\b/g, "Nachricht vorbereiten")
      .replace(/\bOpen dashboard\b/g, "Dashboard öffnen")
      .replace(/\bOpen schedule\b/g, "Agenda öffnen")
      .replace(/\bOpen checkout\b/g, "Kasse öffnen")
      .replace(/\bOpen marketing\b/g, "Marketing öffnen")
      .replace(/\bOpen details\b/g, "Details öffnen")
      .replace(/\bOpen services\b/g, "Leistungen öffnen")
      .replace(/\bOpen clients\b/g, "Kunden öffnen")
      .replace(/\bOpen client\b/g, "Kunde öffnen")
      .replace(/\bOpen stock\b/g, "Lager öffnen")
      .replace(/\bOpen operator\b/g, "Mitarbeitenden öffnen")
      .replace(/\bVolume is present, but profitability cannot be read until service costs and hourly staff costs are complete\./g, "Volumen ist vorhanden, aber Rentabilität ist erst lesbar, wenn Leistungskosten und Stundenkosten vollständig sind.")
      .replace(/\bReview price, duration, staff cost and product consumption: the service may be working at a loss\./g, "Preis, Dauer, Mitarbeiterkosten und Produktverbrauch prüfen: die Leistung könnte mit Verlust laufen.")
      .replace(/\bLow margin: review real duration and products used before pushing the service\./g, "Niedrige Marge: reale Dauer und verwendete Produkte prüfen, bevor die Leistung gepusht wird.")
      .replace(/\bHealthy service: you can keep it or use it as a commercial benchmark\./g, "Gesunde Leistung: beibehalten oder als kommerzielle Referenz nutzen.")
      .replace(/\bComplete service costs and staff hourly cost before using this reading as an economic guide\./g, "Leistungskosten und Stundenkosten ergänzen, bevor diese Lesung als wirtschaftliche Führung genutzt wird.")
      .replace(/\bReview the data in Services: price, real duration and product consumption\./g, "Daten in Leistungen prüfen: Preis, reale Dauer und Produktverbrauch.")
      .replace(/\bReview entered costs and decide whether the service should be pushed or corrected\./g, "Eingetragene Kosten prüfen und entscheiden, ob die Leistung gepusht oder korrigiert wird.")
      .replace(/\bUse it as a benchmark service to build sustainable offers\./g, "Als Benchmark-Leistung für nachhaltige Angebote nutzen.")
      .replace(/\bService\b/g, "Leistung")
      .replace(/\bincomplete economic setup\b/g, "unvollständige wirtschaftliche Konfiguration")
      .replace(/\bat a loss\b/g, "mit Verlust")
      .replace(/\bwith low margin\b/g, "mit niedriger Marge")
      .replace(/\bDa richiamare\b/g, "Zurückrufen")
      .replace(/\bA rischio\b/g, "Gefährdet")
      .replace(/\bPerso\b/g, "Verloren")
      .replace(/\bStorico\b/g, "Historisch")
      .replace(/\bIn linea\b/g, "Im Plan")
      .replace(/\bStato centro non ancora rappresentativo\b/g, "Center-Status noch nicht repräsentativ")
      .replace(/\bLettura centro prudente: configurazione economica incompleta\b/g, "Vorsichtige Center-Lesung: wirtschaftliche Konfiguration unvollständig")
      .replace(/\bVolume presente, lettura centro ancora prudente\b/g, "Volumen vorhanden, Center-Lesung bleibt vorsichtig")
      .replace(/\bRedditività da configurare: configurazione economica incompleta\b/g, "Rentabilität zu konfigurieren: wirtschaftliche Konfiguration unvollständig")
      .replace(/\bRedditività da configurare\b/g, "Rentabilität zu konfigurieren")
      .replace(/\bQuadro da verificare\b/g, "Lage zu prüfen")
      .replace(/\bQualità dati\b/g, "Datenqualität")
      .replace(/\bCompleta qualita dati\b/g, "Datenqualität ergänzen")
      .replace(/\bVerifica marginalita e costi\b/g, "Marge und Kosten prüfen")
      .replace(/\bverifica prima di agire\b/g, "vor der Aktion prüfen")
      .replace(/\bcompleta costi servizi e operatori\b/g, "Leistungs- und Mitarbeiterkosten ergänzen")
      .replace(/\bcompleta costi servizi prima di leggere la redditivita\b/g, "Leistungskosten ergänzen, bevor die Rentabilität gelesen wird")
      .replace(/\bIl Gold State Layer segnala confidenza insufficiente o dato fragile\./g, "Der Gold State Layer meldet geringe Sicherheit oder fragile Daten.")
      .replace(/\bPrimo snapshot dashboard creato\. Le prossime aperture leggeranno il dato salvato\./g, "Erster Dashboard-Snapshot erstellt. Die nächsten Öffnungen lesen die gespeicherten Daten.")
      .replace(/\bCompleta e incassa gli appuntamenti per attivare un report più preciso\./g, "Termine abschließen und kassieren, um einen genaueren Bericht zu aktivieren.")
      .replace(/\b(\d+) clienti? senza telefono o email\b/g, counted("Kunde ohne Telefon oder E-Mail", "Kunden ohne Telefon oder E-Mail"))
      .replace(/\b(\d+) servizi? senza costi configurati\b/g, counted("Leistung ohne konfigurierte Kosten", "Leistungen ohne konfigurierte Kosten"))
      .replace(/\b(\d+) servizi? con costi stimati non collegat[io] a prodotti o tecnologie\b/g, counted("Leistung mit geschätzten Kosten ohne Produkt- oder Technologieverknüpfung", "Leistungen mit geschätzten Kosten ohne Produkt- oder Technologieverknüpfung"))
      .replace(/\b(\d+) appuntament[io] passat[io] senza pagamento collegato\b/g, counted("vergangener Termin ohne verknüpfte Zahlung", "vergangene Termine ohne verknüpfte Zahlung"))
      .replace(/\b(\d+) pagament[io] da collegare\b/g, counted("Zahlung zu verknüpfen", "Zahlungen zu verknüpfen"))
      .replace(/\b(\d+) grupp[oi] di possibili duplicati cliente\b/g, counted("mögliche Kundenduplikat-Gruppe", "mögliche Kundenduplikat-Gruppen"))
      .replace(/\bservizi con costi stimati non collegati a prodotti o tecnologie\b/g, "Leistungen mit geschätzten Kosten ohne Produkt- oder Technologieverknüpfung")
      .replace(/\bappuntamenti passati senza pagamento collegato\b/g, "vergangene Termine ohne verknüpfte Zahlung")
      .replace(/\bfatturato per operatore sotto soglia\b/g, "Umsatz pro Mitarbeitendem unter Schwelle")
      .replace(/\bagenda poco satura\b/g, "Agenda zu wenig ausgelastet")
      .replace(/\bcontinuità clienti bassa\b/g, "geringe Kundenkontinuität")
      .replace(/\bpochi clienti attivi nel periodo\b/g, "zu wenige aktive Kunden im Zeitraum")
      .replace(/\bDati sufficienti per lettura operativa\./g, "Daten reichen für eine operative Lesung aus.");
  }
  if (language !== "en") return value;
  return String(value || "")
    .replace(/\bfatturato per operatore sotto soglia · agenda poco satura · continuità clienti bassa · pochi clienti attivi nel periodo\b/g, "revenue per operator below threshold · schedule fill is too low · client continuity is low · too few active clients in the period")
    .replace(/\bLa salute centro non include margini prodotti o resa tecnologie: prima sopravvivenza del centro, poi ottimizzazione dei margini\.\b/g, "Center health does not include product margins or technology performance: survival first, margin optimization after.")
    .replace(/\bLa center health non include margini prodotti o resa tecnologie: prima sopravvivenza del centro, poi ottimizzazione dei margini\.\b/g, "Center health does not include product margins or technology performance: survival first, margin optimization after.")
    .replace(/La center health non include margini prodotti o resa tecnologie: prima sopravvivenza del centro, poi ottimizzazione dei margini\./g, "Center health does not include product margins or technology performance: survival first, margin optimization after.")
    .replace(/\bStato centro non ancora rappresentativo\b/g, "Center state is not representative yet")
    .replace(/\bLettura centro prudente: configurazione economica incompleta\b/g, "Cautious center reading: economic setup incomplete")
    .replace(/\bVolume presente, lettura centro ancora prudente\b/g, "Volume is present, center reading is still cautious")
    .replace(/\bRedditività da configurare: configurazione economica incompleta\b/g, "Profitability to configure: incomplete economic setup")
    .replace(/\bRedditività da configurare\b/g, "Profitability to configure")
    .replace(/\bQuadro da verificare\b/g, "Situation to verify")
    .replace(/\bda verificare\b/g, "to verify")
    .replace(/\bsotto_soglia\b/g, "below threshold")
    .replace(/\bsotto soglia\b/g, "below threshold")
    .replace(/\bbasso\b/g, "low")
    .replace(/\bmedio\b/g, "medium")
    .replace(/\balto\b/g, "high")
    .replace(/\bcritico\b/g, "critical")
    .replace(/\bbuono\b/g, "good")
    .replace(/\bcontrollo\b/g, "control")
    .replace(/\bVolume presente, completa costi per sbloccare redditivita\b/g, "Volume is present, complete costs to unlock profitability")
    .replace(/\bCompleta qualita dati\b/g, "Complete data quality")
    .replace(/\bVerifica marginalita e costi\b/g, "Review margins and costs")
    .replace(/\bverifica prima di agire\b/g, "verify before acting")
    .replace(/\bcompleta costi servizi e operatori\b/g, "complete service and staff costs")
    .replace(/\bcompleta costi servizi prima di leggere la redditivita\b/g, "complete service costs before reading profitability")
    .replace(/\bIl Gold State Layer segnala confidenza insufficiente o dato fragile\./g, "The Gold State Layer reports insufficient confidence or fragile data.")
    .replace(/\bIl centro lavora, ma Gold evita letture economiche forti finche i costi servizi restano incompleti\./g, "The center is working, but Gold avoids strong economic readings until service costs are complete.")
    .replace(/\bIl centro lavora, ma Gold evita letture economiche forti finche i costi servizi restano incompleti\. Non e un giudizio negativo sul centro: manca configurazione economica su\b/g, "The center is working, but Gold avoids strong economic readings until service costs are complete. This is not a negative judgment on the center: economic setup is missing on")
    .replace(/\bNon e un giudizio negativo sul centro: manca configurazione economica su\b/g, "This is not a negative judgment on the center: economic setup is missing on")
    .replace(/\bState layer: saturazione\b/g, "State layer: saturation")
    .replace(/\bcontinuita\b/g, "continuity")
    .replace(/\bconfidenza\b/g, "confidence")
    .replace(/\bFatturato\b/g, "Revenue")
    .replace(/\bticket medio\b/g, "average ticket")
    .replace(/\bcosti servizio mancanti\b/g, "missing service costs")
    .replace(/\bpagamenti non collegati\b/g, "unlinked payments")
    .replace(/\bAffidabilita\b/g, "Reliability")
    .replace(/\bCassa core\b/g, "Core checkout")
    .replace(/\bFonte gold_state\b/g, "Source gold_state")
    .replace(/\bApri redditività\b/g, "Open profitability")
    .replace(/\boutput_assertivi\b/g, "assertive_outputs")
    .replace(/\bazioni_automatiche\b/g, "automatic_actions")
    .replace(/\blettura economica non ancora affidabile\b/g, "economic reading is not reliable yet")
    .replace(/\bstai perdendo soldi\b/g, "you are losing money")
    .replace(/\bmargine migliorabile\b/g, "margin can improve")
    .replace(/\bstai guadagnando bene\b/g, "you are earning well")
    .replace(/\bStato centro\b/g, "Center state")
    .replace(/\bPriorità del giorno\b/g, "Daily priorities")
    .replace(/\bOpportunità nascoste\b/g, "Hidden opportunities")
    .replace(/\bAzioni immediate\b/g, "Immediate actions")
    .replace(/\bRedditività prodotti e tecnologie\b/g, "Product and technology profitability")
    .replace(/\bPerformance centro\b/g, "Center performance")
    .replace(/\bsalute centro\b/g, "center health")
    .replace(/\bIl centro ha segnali di lavoro reali, ma finché i costi non sono completi la salute centro va letta con prudenza e non come verdetto\./g, "The center shows real work signals, but until costs are complete its health must be read cautiously, not as a verdict.")
    .replace(/\bIl centro mostra volume reale, ma finché costi servizi e costi orari non sono completi la lettura complessiva va tenuta prudente\./g, "The center shows real volume, but until service costs and hourly staff costs are complete the overall reading must stay cautious.")
    .replace(/\bIn questa fase non leggere questo blocco come giudizio sul centro: la lettura completa si sblocca quando configurazione economica e storico diventano più rappresentativi\./g, "At this stage do not read this block as a judgment on the center: the full reading unlocks when the economic setup and history become more representative.")
    .replace(/\bAumenta agenda e richiami prima di lavorare sui margini\./g, "Increase schedule volume and recalls before working on margins.")
    .replace(/\bRinforza continuità clienti e riempimento agenda\./g, "Strengthen client continuity and schedule fill.")
    .replace(/\bMantieni il ritmo e controlla solo i punti deboli\./g, "Keep the pace and review only the weak points.")
    .replace(/\bIl centro regge: lavora su margini e crescita selettiva\./g, "The center is holding: work on margins and selective growth.")
    .replace(/\bcompleta configurazione prima di leggere lo stato centro\b/g, "complete setup before reading center state")
    .replace(/\baumenta volume agenda e richiami prima dei margini\b/g, "increase schedule volume and recalls before margins")
    .replace(/\brinforza continuità clienti e saturazione\b/g, "strengthen client continuity and schedule fill")
    .replace(/\bmantieni controllo operativo\b/g, "keep operational control")
    .replace(/\bCliente da presidiare prima che perda continuità\./g, "A client to protect before continuity is lost.")
    .replace(/\bcontattare entro 3 giorni\b/g, "contact within 3 days")
    .replace(/\bGiornata scarica:\b/g, "Low-load day:")
    .replace(/\bRiempi il buco con recall mirati prima di spingere altri servizi\./g, "Fill the gap with targeted recalls before pushing other services.")
    .replace(/\briempi buco agenda\b/g, "fill the schedule gap")
    .replace(/\bpagamenti da collegare\b/g, "payments to link")
    .replace(/\bSistema la cassa prima di leggere report e redditività\./g, "Fix checkout before reading reports and profitability.")
    .replace(/\bAlcuni movimenti non sono collegati a cliente o appuntamento\./g, "Some movements are not linked to a client or appointment.")
    .replace(/\bcollega pagamenti\b/g, "link payments")
    .replace(/\bSegnale secondario letto dal Gold State Layer\./g, "Secondary signal read from the Gold State Layer.")
    .replace(/\bNon leggere questo come giudizio sul centro: prima va completata la configurazione economica\./g, "Do not read this as a judgment on the center: complete the economic setup first.")
    .replace(/\bControlla subito prezzo, durata e consumo prodotto\./g, "Review price, duration and product consumption immediately.")
    .replace(/\bMargine migliorabile: correggi prima di spingere il servizio\./g, "Margin can improve: correct it before pushing the service.")
    .replace(/\bVolume presente, ma i costi non sono completi\. Mancano\b/g, "Volume is present, but costs are not complete. Missing")
    .replace(/\bcosti servizio e\b/g, "service costs and")
    .replace(/\bcosti orari\./g, "hourly costs.")
    .replace(/\bcompleta configurazione costi\b/g, "complete cost setup")
    .replace(/\bcontrolla costo servizio\b/g, "review service cost")
    .replace(/\bservizio da spingere\b/g, "service to push")
    .replace(/\bÈ un servizio utile da proporre con più continuità\./g, "It is a service worth proposing more consistently.")
    .replace(/\busa questo servizio come riferimento commerciale\./g, "use this service as a commercial benchmark.")
    .replace(/\bspingi questo servizio\b/g, "promote this service")
    .replace(/\bSegnale utile ma secondario: prima chiarisci la configurazione economica\./g, "Useful but secondary signal: clarify the economic setup first.")
    .replace(/\bUsa il suo schema come riferimento operativo\./g, "Use this pattern as an operational benchmark.")
    .replace(/\btieni come riferimento, non come priorita primaria\b/g, "keep as reference, not as the primary priority")
    .replace(/\busa come benchmark operativo\b/g, "use as operational benchmark")
    .replace(/\bVerifica agenda, servizi assegnati e continuità cliente\./g, "Review schedule, assigned services and client continuity.")
    .replace(/\bverifica operatore\b/g, "review operator")
    .replace(/\btecnologia sottoutilizzata o poco redditizia\b/g, "underused or weak-profitability technology")
    .replace(/\bDecidi se promuoverla meglio o ridurne il peso operativo\./g, "Decide whether to promote it better or reduce its operational weight.")
    .replace(/\bpromuovi tecnologia coerente\b/g, "promote the right technology")
    .replace(/\bsotto controllo\b/g, "under review")
    .replace(/\bEvita stop operativi sui servizi collegati\./g, "Avoid operational stops on linked services.")
    .replace(/\bverifica stock\b/g, "review stock")
    .replace(/\bcliente alto valore da presidiare\b/g, "high-value client to protect")
    .replace(/\bNon trattarlo come cliente normale: prepara percorso o upgrade\./g, "Do not treat this client as standard: prepare a path or an upgrade.")
    .replace(/\bproponi percorso o upgrade\b/g, "propose a path or upgrade")
    .replace(/\bRedditività non ancora leggibile\b/g, "Profitability not readable yet")
    .replace(/\bRedditività pronta per lettura operativa\b/g, "Profitability ready for operational reading")
    .replace(/\bIl centro lavora, ma i margini sarebbero fraintendibili finché costi servizi e costi orari restano incompleti\./g, "The center is working, but margins would be misleading until service costs and hourly staff costs are complete.")
    .replace(/\bLa lettura economica può essere usata come supporto operativo\./g, "The economic reading can be used as operational support.")
    .replace(/\bConfigurazione economica sufficiente per letture Gold più forti\./g, "Economic setup is sufficient for stronger Gold readings.")
    .replace(/\bcontrolla margini e opportunita\b/g, "review margins and opportunities")
    .replace(/\bclienti da leggere con priorità\b/g, "clients to review with priority")
    .replace(/\bMarketing prudente: nessun contatto promosso oggi\b/g, "Cautious marketing: no contact promoted today")
    .replace(/\bParti dai clienti più urgenti e prepara messaggi mirati\./g, "Start from the most urgent clients and prepare targeted messages.")
    .replace(/\bCon le regole attuali Gold non ha trovato recall abbastanza sicuri da promuovere oggi\./g, "With the current rules Gold did not find recall actions safe enough to promote today.")
    .replace(/\bGold ordina recall, rischio operativo e riferimenti economici reali già presenti prima di far partire il messaggio\./g, "Gold orders recall, operational risk and real economic references already present before starting the message.")
    .replace(/\bQuesto non significa che il marketing non funzioni: oggi mancano contatti utili o segnali abbastanza solidi per spingere un’azione\./g, "This does not mean marketing is failing: today there are not enough useful contacts or strong enough signals to push an action.")
    .replace(/\blavora la lista recall\b/g, "work the recall list")
    .replace(/\brivedi contatti, consensi e storico\b/g, "review contacts, consents and history")
    .replace(/\bQualità dati\b/g, "Data quality")
    .replace(/\bPrimo snapshot dashboard creato\. Le prossime aperture leggeranno il dato salvato\./g, "First dashboard snapshot created. The next openings will read the saved data.")
    .replace(/\bCompleta e incassa gli appuntamenti per attivare un report più preciso\./g, "Complete and check out appointments to activate a more accurate report.")
    .replace(/\bDa richiamare\b/g, "To recall")
    .replace(/\bA rischio\b/g, "At risk")
    .replace(/\bPerso\b/g, "Lost")
    .replace(/\bStorico\b/g, "Historic")
    .replace(/\bIn linea\b/g, "On track")
    .replace(/\b(\d+) clienti? senza telefono o email\b/g, counted("client without phone or email", "clients without phone or email"))
    .replace(/\b(\d+) servizi? senza costi configurati\b/g, counted("service without configured costs", "services without configured costs"))
    .replace(/\b(\d+) servizi? con costi stimati non collegat[io] a prodotti o tecnologie\b/g, counted("service with estimated costs not linked to products or technologies", "services with estimated costs not linked to products or technologies"))
    .replace(/\b(\d+) appuntament[io] passat[io] senza pagamento collegato\b/g, counted("past appointment without a linked payment", "past appointments without a linked payment"))
    .replace(/\b(\d+) pagament[io] da collegare\b/g, counted("payment to link", "payments to link"))
    .replace(/\b(\d+) grupp[oi] di possibili duplicati cliente\b/g, counted("possible duplicate client group", "possible duplicate client groups"))
    .replace(/\bservizi con costi stimati non collegati a prodotti o tecnologie\b/g, "services with estimated costs not linked to products or technologies")
    .replace(/\bappuntamenti passati senza pagamento collegato\b/g, "past appointments without a linked payment")
    .replace(/\bfatturato per operatore sotto soglia\b/g, "revenue per operator below threshold")
    .replace(/\bagenda poco satura\b/g, "schedule fill is too low")
    .replace(/\bcontinuità clienti bassa\b/g, "client continuity is low")
    .replace(/\bpochi clienti attivi nel periodo\b/g, "too few active clients in the period")
    .replace(/\bfatturato, saturazione agenda e continuità clienti sono coerenti con il periodo\./g, "revenue, schedule fill and client continuity are aligned with the period.")
    .replace(/\bCorreggi i dati che bloccano letture affidabili\./g, "Correct the data that blocks reliable readings.")
    .replace(/\bMantieni puliti cassa, clienti e servizi\./g, "Keep checkout, clients and services clean.")
    .replace(/\bDati sufficienti per lettura operativa\./g, "Data is sufficient for operational reading.")
    .replace(/\bcorreggi dati sporchi quando rallentano l'analisi\b/g, "correct dirty data when it slows the analysis")
    .replace(/\bOutput assertivi bloccati fino a dato piu affidabile\./g, "Assertive outputs remain blocked until data is more reliable.")
    .replace(/\bGenera azioni\b/g, "Generate actions")
    .replace(/\bPrepara messaggio\b/g, "Prepare message")
    .replace(/\bApri dashboard\b/g, "Open dashboard")
    .replace(/\bApri agenda\b/g, "Open schedule")
    .replace(/\bApri cassa\b/g, "Open checkout")
    .replace(/\bApri redditività\b/g, "Open profitability")
    .replace(/\bApri marketing\b/g, "Open marketing")
    .replace(/\bApri dettaglio\b/g, "Open details")
    .replace(/\bApri servizi\b/g, "Open services")
    .replace(/\bApri clienti\b/g, "Open clients")
    .replace(/\bApri cliente\b/g, "Open client")
    .replace(/\bApri magazzino\b/g, "Open stock")
    .replace(/\bApri operatore\b/g, "Open operator")
    .replace(/\bVolume presente, ma la redditivita non e leggibile finche non completi costi servizio e costi orari\./g, "Volume is present, but profitability cannot be read until service costs and hourly staff costs are complete.")
    .replace(/\bVerifica prezzo, durata, costo operatore e consumo prodotti: il servizio rischia di lavorare in perdita\./g, "Review price, duration, staff cost and product consumption: the service may be working at a loss.")
    .replace(/\bMargine basso: controlla durata reale e prodotti usati prima di spingere il servizio\./g, "Low margin: re…167649 tokens truncated…ActionsForSection(section = {}) {
    const items = Array.isArray(section.items) ? section.items : [];
    return items
      .filter((item) => item && (item.button || item.action || item.target || item.suggestedAction || item.reason))
      .slice(0, 4)
      .map((item, index) => {
        const route = item.manualActionMode && item.target
          ? { target: item.target, targetFocus: item.targetFocus || "" }
          : this.normalizeGoldManualTarget(item, section.key || "dashboard");
        const label = this.getGoldManualActionLabel(item, route);
        return {
          id: `manual-${section.key || "gold"}-${item.id || index}`,
          mode: "manual",
          label,
          title: item.conclusion || item.label || item.title || label,
          reason: item.reason || item.value || item.details || "",
          instruction: item.action || item.suggestedAction || item.nextAction || "Apri il modulo indicato, verifica i dati e salva manualmente.",
          target: route.target,
          targetFocus: item.targetFocus || route.targetFocus || "",
          clientId: item.clientId || "",
          staffId: item.staffId || "",
          requiresOperatorConfirmation: true,
          automaticExecutionAllowed: false
        };
      });
  }

  getGoldManualActionLabel(item = {}, route = {}) {
    const defaultLabel = route.target === "services"
      ? (route.targetFocus === "staff-costs" ? "Completa costi operatori" : "Completa costi servizi")
      : route.target === "marketing" ? "Apri marketing"
      : route.target === "clients" ? "Apri clienti"
      : route.target === "cashdesk" ? "Apri cassa"
      : route.target === "appointments" ? "Apri agenda"
      : route.target === "inventory" ? "Apri magazzino"
      : route.target === "profitability" ? "Apri redditività"
      : route.target === "shifts" ? "Apri turni"
      : route.target === "protocols" ? "Apri protocolli"
      : "Apri dashboard";
    const rawButton = String(item.button || item.actionLabel || "").trim();
    if (!rawButton) return defaultLabel;
    if (route.target === "services" && !/(servizi|servizio|operatori|costi|costo|configura|completa)/i.test(rawButton)) {
      return defaultLabel;
    }
    return rawButton;
  }

  withGoldManualActions(sections = []) {
    return (Array.isArray(sections) ? sections : []).map((section) => {
      const rawItems = Array.isArray(section.items) ? section.items.slice(0, 4) : [];
      const items = rawItems.map((item, index) => {
        const route = this.normalizeGoldManualTarget(item, section.key || "dashboard");
        const label = this.getGoldManualActionLabel(item, route);
        return {
          ...item,
          button: label,
          target: route.target,
          targetFocus: item.targetFocus || route.targetFocus || "",
          manualActionMode: true,
          requiresOperatorConfirmation: item.requiresOperatorConfirmation !== false,
          automaticExecutionAllowed: false,
          manualActionId: `manual-${section.key || "gold"}-${item.id || index}`
        };
      });
      return {
        ...section,
        items,
        actions: this.buildGoldManualActionsForSection({ ...section, items })
      };
    });
  }

  isGoldInternalNoise(value = "") {
    return /core\/nyra|corelia|nyra|gold engine|modulo corretto|evitare duplicati|legge il centro|fonte primaria|sorgente|snapshot|decision context|business_snapshot|gold_decision|layer esterno/i.test(String(value || ""));
  }

  buildGoldCoreV2UserCopy(item = {}, sectionKey = "") {
    const route = this.normalizeGoldManualTarget(item, item.target || sectionKey || "dashboard");
    const focus = String(item.targetFocus || route.targetFocus || "").toLowerCase();
    const target = String(route.target || item.target || "").toLowerCase();
    const raw = [
      item.title,
      item.label,
      item.conclusion,
      item.reason,
      item.details,
      item.value,
      item.action,
      item.suggestedAction,
      item.instruction
    ].filter(Boolean).join(" ").toLowerCase();

    if (sectionKey === "evidence") {
      return {
        title: item.label || "Dato gestionale letto",
        reason: "Dato disponibile per verifiche interne e controllo qualita.",
        details: "Non richiede azione operativa del centro.",
        action: "nessuna azione operativa richiesta",
        button: item.button || "Apri modulo"
      };
    }
    if (sectionKey === "gold_engine" && !/service-costs|staff-costs|low-stock/.test(focus)) {
      if (/stato centro|salute centro|center/.test(raw)) {
        return {
          title: "Controlla stato centro",
          reason: "Apri lo stato del centro e verifica il primo blocco evidenziato.",
          details: "Parti da volume, agenda, operatori e continuita clienti.",
          action: "controlla stato centro",
          button: "Apri dashboard"
        };
      }
      return {
        title: "Lavora la priorita indicata",
        reason: "Apri il modulo collegato e completa la prima azione evidenziata.",
        details: "La priorita e gia ordinata: lavora solo cio che richiede intervento.",
        action: "apri il modulo e lavora la priorita",
        button: item.button || "Apri modulo"
      };
    }

    if (focus === "service-costs" || (/servizi|servizio/.test(raw) && /costi|costo|redditiv|margini/.test(raw))) {
      return {
        title: "Completa costi servizi",
        reason: "Mancano dati economici sui servizi: finche non li completi, margini e redditivita non sono affidabili.",
        details: "Controlla prezzo, durata, costo prodotto e consumo dei servizi evidenziati.",
        action: "completa i costi dei servizi evidenziati",
        button: "Completa costi servizi"
      };
    }
    if (focus === "staff-costs" || (/operatori|operatore|staff/.test(raw) && /costi|costo|resa|performance/.test(raw))) {
      return {
        title: "Completa costi operatori",
        reason: "Manca il costo orario degli operatori: senza questo dato la resa del centro resta parziale.",
        details: "Controlla costo orario, ruolo e turni degli operatori evidenziati.",
        action: "completa i costi operatori",
        button: "Completa costi operatori"
      };
    }
    if (focus === "low-stock" || target === "inventory" || /sottoscorta|sotto soglia|stock|magazzino|giacenza/.test(raw)) {
      return {
        title: "Prepara riordino stock",
        reason: "Un articolo utile al lavoro e sotto soglia.",
        details: "Verifica giacenza reale e prepara carico o riordino prima che blocchi i servizi.",
        action: "verifica giacenza e prepara carico",
        button: "Apri magazzino"
      };
    }
    if (target === "marketing" || /cliente|clienti|recall|richiamare|recuperare|contatto|messaggio/.test(raw)) {
      return {
        title: "Lavora clienti prioritari",
        reason: "Parti dai clienti con piu valore o rischio di perdita.",
        details: "Verifica consenso, ultimo passaggio e motivo del contatto prima di inviare messaggi.",
        action: "prepara il contatto cliente",
        button: "Apri marketing"
      };
    }
    if (target === "cashdesk" || /cassa|pagamenti|incassi|pagamento/.test(raw)) {
      return {
        title: "Sistema cassa e pagamenti",
        reason: "I report restano poco affidabili se cassa e appuntamenti non sono allineati.",
        details: "Collega i pagamenti aperti e chiudi gli appuntamenti gia incassati.",
        action: "controlla cassa e pagamenti",
        button: "Apri cassa"
      };
    }
    if (target === "appointments" || /agenda|appuntamenti|slot|giornata scarica/.test(raw)) {
      return {
        title: "Riempi agenda",
        reason: "Prima serve volume operativo: agenda e continuita clienti vengono prima dell'ottimizzazione margini.",
        details: "Controlla slot liberi, richiami utili e appuntamenti deboli.",
        action: "riempi agenda con richiami mirati",
        button: "Apri agenda"
      };
    }
    if (target === "profitability" || sectionKey === "profitability" || /redditiv|margini|margine|utile|perdita/.test(raw)) {
      return {
        title: "Controlla margini",
        reason: "Verifica quali servizi assorbono margine prima di spingerli in vendita.",
        details: "Lavora prima i servizi con dati incompleti, costo alto o margine debole.",
        action: "controlla dettaglio redditivita",
        button: "Apri redditivita"
      };
    }
    return {
      title: item.conclusion || item.label || item.title || "Azione prioritaria",
      reason: this.isGoldInternalNoise(item.reason || item.value || item.details)
        ? "Apri il modulo indicato e lavora la priorita evidenziata."
        : (item.reason || item.value || item.details || "Completa il controllo indicato nel modulo."),
      details: this.isGoldInternalNoise(item.details || item.value) ? "" : (item.details || item.value || ""),
      action: this.isGoldInternalNoise(item.action || item.suggestedAction)
        ? "apri il modulo e completa il controllo"
        : (item.action || item.suggestedAction || "apri il modulo e completa il controllo"),
      button: item.button || "Apri modulo"
    };
  }

  normalizeGoldCoreV2Item(item = {}, sectionKey = "") {
    const copy = this.buildGoldCoreV2UserCopy(item, sectionKey);
    const route = this.normalizeGoldManualTarget(item, item.target || sectionKey || "dashboard");
    const explicitTarget = String(item.target || "").toLowerCase();
    if (route.target === "dashboard" && explicitTarget && !["dashboard", "ai-gold", "center_health"].includes(explicitTarget)) {
      route.target = explicitTarget === "agenda" ? "appointments"
        : explicitTarget === "cash" ? "cashdesk"
        : explicitTarget === "client" ? "clients"
        : explicitTarget;
    }
    const originalText = [
      item.title,
      item.label,
      item.conclusion,
      item.reason,
      item.details,
      item.value,
      item.action,
      item.instruction
    ].filter(Boolean).join(" ");
    const shouldReplace = this.isGoldInternalNoise(originalText)
      || sectionKey === "gold_engine"
      || !String(item.conclusion || item.label || item.title || "").trim();
    const normalized = {
      ...item,
      target: route.target,
      targetFocus: item.targetFocus || route.targetFocus || "",
      conclusion: shouldReplace ? copy.title : (item.conclusion || item.label || item.title || copy.title),
      title: shouldReplace ? copy.title : (item.title || item.conclusion || item.label || copy.title),
      label: shouldReplace ? copy.title : (item.label || item.conclusion || item.title || copy.title),
      reason: shouldReplace || this.isGoldInternalNoise(item.reason) ? copy.reason : (item.reason || copy.reason),
      details: shouldReplace || this.isGoldInternalNoise(item.details) ? copy.details : (item.details || copy.details),
      value: shouldReplace || this.isGoldInternalNoise(item.value) ? copy.reason : (item.value || copy.reason),
      action: shouldReplace || this.isGoldInternalNoise(item.action) ? copy.action : (item.action || copy.action),
      instruction: shouldReplace || this.isGoldInternalNoise(item.instruction) ? copy.action : (item.instruction || copy.action),
      button: this.isGoldInternalNoise(item.button) ? copy.button : (item.button || copy.button),
      coreV2Prefiltered: true
    };
    return normalized;
  }

  applyGoldCoreV2Prefilter(payload = {}) {
    const seen = new Set();
    const sections = (Array.isArray(payload.sections) ? payload.sections : []).map((section) => {
      const sectionKey = String(section.key || "");
      const normalizedItems = [];
      (Array.isArray(section.items) ? section.items : []).forEach((item) => {
        if (!item) return;
        const normalized = this.normalizeGoldCoreV2Item(item, sectionKey);
        const signature = [
          sectionKey,
          normalized.target || "",
          normalized.targetFocus || "",
          normalized.conclusion || normalized.label || normalized.title || ""
        ].join("|").toLowerCase();
        if (seen.has(signature)) return;
        seen.add(signature);
        normalizedItems.push(normalized);
      });
      const normalizedSection = {
        ...section,
        title: sectionKey === "gold_engine" ? "Regia operativa" : section.title,
        items: normalizedItems.slice(0, 4)
      };
      return {
        ...normalizedSection,
        actions: this.buildGoldManualActionsForSection(normalizedSection).map((action) => this.normalizeGoldCoreV2Item(action, sectionKey))
      };
    });
    return {
      ...payload,
      coreV2Prefilter: {
        enabled: true,
        rule: "noise_removed_before_ui",
        generatedAt: nowIso()
      },
      sections
    };
  }

  getAiGoldDecisionCenter(options = {}, session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      return {
        goldEnabled: false,
        message: "Dashboard decisionale disponibile solo con piano Gold.",
        sections: []
      };
    }
    if (this.getPlanLevel(session) === "gold" && options.forceRefresh) {
      try {
        this.rebuildGoldStateForCurrentGoldTenant(session, { reason: "api_force_refresh" });
      } catch (error) {
        console.warn("[gold_state_force_refresh_error]", error?.message || error);
      }
    }
    if (this.getPlanLevel(session) === "gold") {
      try {
        const stateDecisionCenter = this.buildDecisionCenterFromGoldState(options, session);
        if (stateDecisionCenter) {
          console.log("[decision_center_source]", JSON.stringify({
            centerId: this.getCenterId(session),
            source: "smartdesk_gold_state"
          }));
          return localizeDecisionCenterPayload(this.applyGoldCoreV2Prefilter(stateDecisionCenter), this.getRuntimeLanguage(session));
        }
      } catch (error) {
        console.warn("[gold_state_decision_error]", error?.message || error);
      }
    }
    console.log("[decision_center_source]", JSON.stringify({
      centerId: this.getCenterId(session),
      source: "raw_fallback"
    }));
    const startDate = String(options.startDate || "");
    const endDate = String(options.endDate || "");
    const snapshot = this.getBusinessSnapshot({ startDate, endDate }, session);
    const marketing = snapshot.marketing || {};
    const profitability = snapshot.profitability || {};
    const operational = snapshot.report?.operational || {};
    const centerHealth = snapshot.report?.centerHealth || {};
    let inventory = snapshot.inventory || {};
    if (!Number(inventory.totalItems || inventory.summary?.totalItems || 0) && (!Array.isArray(inventory.lowStock) || inventory.lowStock.length === 0)) {
      const liveInventoryItems = this.filterByCenter(this.inventoryRepository.list(), session);
      inventory = {
        totalItems: liveInventoryItems.length,
        summary: { totalItems: liveInventoryItems.length },
        lowStock: liveInventoryItems.filter((item) => Number(item.quantity || 0) <= Number(item.minQuantity || 0))
      };
    }
    const dataQuality = snapshot.dataQuality || {};
    const goldEngine = snapshot.goldEngine || {};
    const profitabilityBlockedForConfig = Number(dataQuality.metrics?.servicesMissingCosts || 0) > 0
      || Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0) > 0;
    const goldEnginePriorityItems = (goldEngine.dashboard?.items || []).slice(0, 5).map((item) => {
      const itemDomain = String(item.domain || "").toLowerCase();
      const itemEntityId = String(item.entityId || "").toLowerCase();
      const isEconomicGapItem = itemDomain === "dashboard"
        || itemDomain === "economic"
        || itemEntityId.includes("economic-revenue-gap")
        || itemEntityId.includes("revenue-gap");
      if (profitabilityBlockedForConfig && isEconomicGapItem) {
        return {
          id: `gold-engine-${item.domain}-${item.entityId}`,
          level: "warning",
          area: item.domain,
          conclusion: "Completa i costi prima di leggere i margini",
          reason: "Il centro sta lavorando, ma senza costi completi Gold non può dirti se un servizio conviene davvero.",
          details: `${economicConfigGapText(Number(dataQuality.metrics?.servicesMissingCosts || 0), Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0))}.`,
          impactCents: 0,
          riskCents: 0,
          action: economicConfigGapText(Number(dataQuality.metrics?.servicesMissingCosts || 0), Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0), "action"),
          button: Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0) > 0 && Number(dataQuality.metrics?.servicesMissingCosts || 0) <= 0
            ? "Completa costi operatori"
            : "Completa costi servizi",
          target: "services",
          targetFocus: Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0) > 0 && Number(dataQuality.metrics?.servicesMissingCosts || 0) <= 0
            ? "staff-costs"
            : "service-costs"
        };
      }
      return {
        id: `gold-engine-${item.domain}-${item.entityId}`,
        level: item.band === "alta" ? "critical" : item.band === "media" ? "warning" : item.band === "bassa" ? "info" : "success",
        area: item.domain,
        conclusion: item.explanationShort || item.output || "Segnale Gold",
        reason: item.explanationLong || item.suggestedAction || "Priorità letta dai dati Smart Desk e governata dal layer esterno Core/Nyra.",
        details: `Necessità ${Math.round(Number(item.factors?.need || 0) * 100)} · Valore ${Math.round(Number(item.factors?.value || 0) * 100)} · Urgenza ${Math.round(Number(item.factors?.urgency || 0) * 100)} · Coerenza ${Math.round(Number(item.factors?.coherence || 0) * 100)} · Frizione ${Math.round(Number(item.factors?.friction || 0) * 100)}`,
        impactCents: Number(item.amountCents || item.revenueCents || 0),
        riskCents: 0,
        action: item.suggestedAction || "gestisci priorità",
        button: item.domain === "cash" ? "Apri cassa" : item.domain === "agenda" ? "Apri agenda" : item.domain === "profit" ? "Apri redditività" : item.domain === "marketing" ? "Apri marketing" : "Apri dettaglio",
        target: item.target || (item.domain === "cash" ? "cashdesk" : item.domain === "profit" ? "profitability" : item.domain)
      };
    });
    const focusClient = snapshot.marketing?.focusClient || null;
    const marginAlert = profitability.suggestions?.find((item) => item.status !== "HEALTHY") || null;
    const bestService = profitability.suggestions?.slice().sort((a, b) => Number(b.marginPercent || 0) - Number(a.marginPercent || 0))[0] || null;
    const lowTechnology = (profitability.technologies || []).find((item) => Number(item.totalUses || 0) <= 2 || item.status !== "HEALTHY") || null;
    const lowStock = inventory.lowStock?.[0] || null;
    const weakestUpcomingDay = snapshot.operations?.weakestUpcomingDay || null;
    const topOperator = snapshot.operations?.topOperator || null;
    const weakOperator = snapshot.operations?.weakOperator || null;
    const topClient = snapshot.operations?.topClient || null;
    const membershipWarning = topClient && focusClient && String(topClient.clientId || "") === String(focusClient.clientId || "")
      ? topClient
      : null;
    const centerHealthNotRepresentative = profitabilityBlockedForConfig
      && Number(centerHealth.monthlyRevenueCents || 0) <= 0
      && Number(centerHealth.saturationPercent || 0) <= 0
      && Number(centerHealth.continuityPercent || 0) <= 0;
    const fallbackSections = [
      {
        key: "center_health",
        title: "Stato centro",
        items: [
          {
            id: "center-health-main",
            level: centerHealthNotRepresentative || profitabilityBlockedForConfig ? "warning" : centerHealth.level,
            area: "salute centro",
            conclusion: centerHealthNotRepresentative
              ? "Stato centro non ancora rappresentativo"
              : profitabilityBlockedForConfig
                ? "Volume presente, lettura centro ancora prudente"
                : `Centro ${centerHealth.statusLabel}: ${centerHealth.status === "sotto_soglia" ? "attività insufficiente rispetto agli operatori" : centerHealth.status === "fragile" ? "volume operativo da rinforzare" : centerHealth.status === "stabile" ? "base operativa sotto controllo" : "centro forte nel periodo"}`,
            reason: centerHealthNotRepresentative
              ? "In questa fase non leggere questo blocco come giudizio sul centro: la lettura completa si sblocca quando configurazione economica e storico diventano più rappresentativi."
              : profitabilityBlockedForConfig
                ? "Il centro ha segnali di lavoro reali, ma finché i costi non sono completi la salute centro va letta con prudenza e non come verdetto."
                : centerHealth.status === "sotto_soglia"
                  ? "Aumenta agenda e richiami prima di lavorare sui margini."
                  : centerHealth.status === "fragile"
                    ? "Rinforza continuità clienti e riempimento agenda."
                    : centerHealth.status === "stabile"
                      ? "Mantieni il ritmo e controlla solo i punti deboli."
                      : "Il centro regge: lavora su margini e crescita selettiva.",
            details: centerHealthNotRepresentative
              ? `${economicConfigGapText(Number(dataQuality.metrics?.servicesMissingCosts || 0), Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0))} prima di usare questo blocco come lettura di stato.`
              : profitabilityBlockedForConfig
                ? `${centerHealth.reason} · costi servizio mancanti ${Number(dataQuality.metrics?.servicesMissingCosts || 0)} · costi orari mancanti ${Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0)}`
                : `${centerHealth.reason} · fatturato/operatore ${euro(centerHealth.revenuePerOperatorCents)} al mese · saturazione ${centerHealth.saturationPercent}% · continuità ${centerHealth.continuityPercent}%`,
            impactCents: Number(centerHealth.monthlyRevenueCents || 0),
            riskCents: 0,
            action: centerHealthNotRepresentative || profitabilityBlockedForConfig
              ? "completa configurazione prima di leggere lo stato centro"
              : centerHealth.status === "sotto_soglia"
                ? "aumenta volume agenda e richiami prima dei margini"
                : centerHealth.status === "fragile"
                  ? "rinforza continuità clienti e saturazione"
                  : "mantieni controllo operativo",
            button: "Apri dashboard",
            target: "dashboard"
          }
        ]
      },
      {
        key: "daily",
        title: "Priorità del giorno",
        items: [
          focusClient ? {
            id: `client-${focusClient.clientId}`,
            level: focusClient.priority === "alta" ? "critical" : "warning",
            area: "clienti",
            conclusion: focusClient.conclusion || `${focusClient.name} va seguito.`,
            reason: focusClient.clearReason || "Cliente da presidiare prima che perda continuità.",
            details: `Ultima visita ${focusClient.daysSinceLastVisit} gg · frequenza ${focusClient.averageFrequencyDays} gg`,
            impactCents: Number(focusClient.referenceValueCents || focusClient.estimatedRecallValueCents || 0),
            riskCents: 0,
            action: focusClient.operatingDecision || "contattare entro 3 giorni",
            button: "Prepara messaggio",
            target: "marketing",
            clientId: focusClient.clientId
          } : null,
          weakestUpcomingDay ? {
            id: `agenda-${weakestUpcomingDay[0]}`,
            level: Number(weakestUpcomingDay[1]) <= 2 ? "warning" : "info",
            area: "agenda",
            conclusion: `Giornata scarica: ${weakestUpcomingDay[0]}`,
            reason: "Riempi il buco con recall mirati prima di spingere altri servizi.",
            details: `${weakestUpcomingDay[1]} appuntamenti nei prossimi 7 giorni.`,
            impactCents: 0,
            riskCents: 0,
            action: "riempi buco agenda",
            button: "Apri agenda",
            target: "agenda"
          } : null,
          dataQuality.metrics?.unlinkedPayments ? {
            id: "cash-unlinked",
            level: "warning",
            area: "cassa",
            conclusion: `${dataQuality.metrics.unlinkedPayments} pagamenti da collegare`,
            reason: "Sistema la cassa prima di leggere report e redditività.",
            details: "Alcuni movimenti non sono collegati a cliente o appuntamento.",
            impactCents: 0,
            riskCents: 0,
            action: "collega pagamenti",
            button: "Apri cassa",
            target: "cashdesk"
          } : null
        ].filter(Boolean)
      },
      {
        key: "profitability",
        title: "Redditività prodotti e tecnologie",
        items: [
          marginAlert ? {
            id: `service-${marginAlert.id}`,
            level: marginAlert.status === "LOSS" ? "critical" : "warning",
            area: "servizi",
            conclusion: `${marginAlert.name}: ${marginAlert.clearConclusion}`,
            reason: profitabilityBlockedForConfig
              ? "Non leggere questo come giudizio sul centro: prima va completata la configurazione economica."
              : marginAlert.status === "LOSS" ? "Controlla subito prezzo, durata e consumo prodotto." : "Margine migliorabile: correggi prima di spingere il servizio.",
            details: profitabilityBlockedForConfig
              ? `Volume presente, ma i costi non sono completi. Mancano ${economicConfigGapText(Number(dataQuality.metrics?.servicesMissingCosts || 0), Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0), "missing")}.`
              : `Incasso medio ${euro(Number(marginAlert.averageRevenueCents || 0))} · costo medio ${euro(Number(marginAlert.averageCostCents || 0))} · margine ${marginAlert.marginPercent}%`,
            impactCents: Number(marginAlert.economicGapCents || 0),
            riskCents: Number(marginAlert.economicGapCents || 0),
            action: profitabilityBlockedForConfig ? "completa configurazione costi" : marginAlert.operatingAction || "controlla costo servizio",
            button: "Apri servizi",
            target: "services"
          } : null,
          bestService && !profitabilityBlockedForConfig ? {
            id: `best-service-${bestService.id}`,
            level: "success",
            area: "servizi",
            conclusion: `${bestService.name}: servizio da spingere`,
            reason: "È un servizio utile da proporre con più continuità.",
            details: `Margine ${bestService.marginPercent}%: usa questo servizio come riferimento commerciale.`,
            impactCents: Number(bestService.averageRevenueCents || 0),
            riskCents: 0,
            action: "spingi questo servizio",
            button: "Apri marketing",
            target: "marketing"
          } : null
        ].filter(Boolean)
      },
      {
        key: "performance",
        title: "Performance centro",
        items: [
          topOperator ? {
            id: `operator-top-${topOperator.staffId}`,
            level: "success",
            area: "operatori",
            conclusion: `${topOperator.name}: operatore forte nel periodo`,
            reason: profitabilityBlockedForConfig
              ? "Segnale utile ma secondario: prima chiarisci la configurazione economica."
              : "Usa il suo schema come riferimento operativo.",
            details: profitabilityBlockedForConfig
              ? `${topOperator.appointments} appuntamenti · ${topOperator.completed} completati. Tienilo come riferimento dopo aver completato i costi.`
              : `${topOperator.appointments} appuntamenti · ${topOperator.completed} completati · ${euro(Number(topOperator.revenueCents || 0))} generati.`,
            impactCents: Number(topOperator.revenueCents || 0),
            riskCents: 0,
            action: profitabilityBlockedForConfig ? "tieni come riferimento, non come priorita primaria" : "usa come benchmark operativo",
            button: "Apri operatore",
            target: "shifts",
            staffId: topOperator.staffId
          } : null,
          weakOperator && topOperator && String(weakOperator.staffId || "") !== String(topOperator.staffId || "") ? {
            id: `operator-weak-${weakOperator.staffId}`,
            level: "warning",
            area: "operatori",
            conclusion: `${weakOperator.name}: saturazione da controllare`,
            reason: "Verifica agenda, servizi assegnati e continuità cliente.",
            details: `${weakOperator.appointments || 0} appuntamenti nel periodo.`,
            impactCents: 0,
            riskCents: 0,
            action: "verifica operatore",
            button: "Apri operatore",
            target: "shifts",
            staffId: weakOperator.staffId
          } : null
        ].filter(Boolean)
      },
      {
        key: "hidden",
        title: "Opportunità nascoste",
        items: [
          lowTechnology ? {
            id: `tech-${lowTechnology.id}`,
            level: "warning",
            area: "tecnologie",
            conclusion: `${lowTechnology.name}: tecnologia sottoutilizzata o poco redditizia`,
            reason: "Decidi se promuoverla meglio o ridurne il peso operativo.",
            details: `${lowTechnology.totalUses || 0} utilizzi · ricavi ${euro(Number(lowTechnology.revenueCents || 0))} · margine ${lowTechnology.marginPercent || 0}%.`,
            impactCents: Number(lowTechnology.monthlyCostCents || 0),
            riskCents: Number(lowTechnology.monthlyCostCents || 0),
            action: "promuovi tecnologia coerente",
            button: "Apri redditività",
            target: "profitability"
          } : null,
          lowStock ? {
            id: `stock-${lowStock.id}`,
            level: "warning",
            area: "magazzino",
            conclusion: `${lowStock.name || "Prodotto"} sotto controllo`,
            reason: "Evita stop operativi sui servizi collegati.",
            details: `Giacenza ${lowStock.quantity || 0}, soglia ${lowStock.minQuantity || 0}.`,
            impactCents: Number(lowStock.costCents || 0),
            riskCents: 0,
            action: "verifica stock",
            button: "Apri magazzino",
            target: "inventory",
            targetFocus: "low-stock"
          } : null,
          membershipWarning ? {
            id: `membership-${membershipWarning.clientId}`,
            level: "success",
            area: "membership",
            conclusion: `${membershipWarning.name}: cliente alto valore da presidiare`,
            reason: "Non trattarlo come cliente normale: prepara percorso o upgrade.",
            details: `${euro(Number(membershipWarning.amountCents || 0))} di storico nel periodo.`,
            impactCents: Number(membershipWarning.amountCents || 0),
            riskCents: 0,
            action: "proponi percorso o upgrade",
            button: "Apri cliente",
            target: "client",
            clientId: membershipWarning.clientId
          } : null
        ].filter(Boolean)
      },
      {
        key: "actions",
        title: "Azioni immediate",
        items: [
          {
            id: "action-profitability-config",
            level: profitabilityBlockedForConfig ? "warning" : "info",
            area: "redditività",
            conclusion: profitabilityBlockedForConfig
              ? "Completa i costi per leggere i margini"
              : "Margini pronti da controllare",
            reason: profitabilityBlockedForConfig
              ? "Mancano valori economici di base. Senza quei dati Gold rischia di darti una lettura sbagliata."
              : "Ora puoi usare i numeri per capire quali servizi convengono, quali assorbono tempo e dove correggere.",
            details: profitabilityBlockedForConfig
              ? `${economicConfigGapText(Number(dataQuality.metrics?.servicesMissingCosts || 0), Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0))}.`
              : "Prezzi, costi e operatori sono abbastanza completi per una prima lettura utile.",
            impactCents: 0,
            riskCents: 0,
            action: profitabilityBlockedForConfig
              ? "Completa prima i campi mancanti, poi torna qui a leggere i margini."
              : "Apri redditività e controlla quali servizi meritano più attenzione.",
            button: profitabilityBlockedForConfig
              ? (Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0) > 0 && Number(dataQuality.metrics?.servicesMissingCosts || 0) <= 0 ? "Completa costi operatori" : "Completa costi servizi")
              : "Apri redditività",
            target: profitabilityBlockedForConfig ? "services" : "profitability",
            targetFocus: profitabilityBlockedForConfig
              ? (Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0) > 0 && Number(dataQuality.metrics?.servicesMissingCosts || 0) <= 0 ? "staff-costs" : "service-costs")
              : ""
          },
          {
            id: "action-marketing",
            level: marketing.suggestions?.length ? "critical" : "info",
            area: "marketing",
            conclusion: marketing.suggestions?.length
              ? `${marketing.suggestions.length} clienti da leggere con priorità`
              : "Nessun cliente da contattare oggi",
            reason: marketing.suggestions?.length
              ? "Parti dai clienti più urgenti: il sistema ti prepara il lavoro, ma sei tu a confermare il messaggio."
              : "Gold non forza messaggi quando mancano consenso, storico utile o segnali abbastanza chiari.",
            details: marketing.suggestions?.length
              ? "Apri la lista, controlla il motivo del recall e usa il messaggio solo se ti torna."
              : "Non è un errore: oggi è meglio non spingere contatti deboli. Controlla consensi e storico se vuoi aumentare la qualità dei recall.",
            impactCents: 0,
            riskCents: 0,
            action: marketing.suggestions?.length ? "Apri i recall, approva solo i messaggi utili e segna quelli fatti." : "Controlla che i clienti abbiano telefono, consenso e storico visite.",
            button: marketing.suggestions?.length ? "Prepara messaggi" : "Controlla clienti e consensi",
            target: marketing.suggestions?.length ? "autopilot" : "clients"
          },
          {
            id: "action-data",
            level: profitabilityBlockedForConfig || dataQuality.status === "basso" ? "warning" : "info",
            area: "qualità dati",
            conclusion: dataQuality.status === "basso" ? "Dati da sistemare" : `Dati ordinati ${dataQuality.score}%`,
            reason: dataQuality.status === "basso" ? "Alcuni dati impediscono a Gold di leggere bene il centro." : "I dati principali sono leggibili. Tieni puliti clienti, cassa e servizi.",
            details: profitabilityBlockedForConfig
              ? `${economicConfigGapText(Number(dataQuality.metrics?.servicesMissingCosts || 0), Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0))}.`
              : dataQuality.alerts?.[0] || "Non ci sono blocchi evidenti sui dati principali.",
            impactCents: 0,
            riskCents: 0,
            action: profitabilityBlockedForConfig
              ? "Completa i costi mancanti: è il primo dato che serve per leggere redditività e margini."
              : "Apri clienti solo se devi pulire schede, contatti o duplicati.",
            button: profitabilityBlockedForConfig
              ? (Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0) > 0 && Number(dataQuality.metrics?.servicesMissingCosts || 0) <= 0 ? "Completa costi operatori" : "Completa costi servizi")
              : "Apri clienti",
            target: profitabilityBlockedForConfig ? "services" : "clients",
            targetFocus: profitabilityBlockedForConfig
              ? (Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0) > 0 && Number(dataQuality.metrics?.servicesMissingCosts || 0) <= 0 ? "staff-costs" : "service-costs")
              : ""
          }
        ]
      }
    ];
    const distributedFallbackSections = this.dedupeGoldDecisionSections(fallbackSections);
    const sections = [
      distributedFallbackSections[0],
      {
        key: "gold_engine",
        title: "AI Gold - Core/Nyra esterni",
        items: this.buildGoldEngineRoutingItems(distributedFallbackSections)
      },
      ...distributedFallbackSections.slice(1)
    ].map((section) => ({
      ...section,
      items: section.items.slice(0, 4)
    }));
    const manualSections = this.withGoldManualActions(sections);
    const totalInsights = manualSections.reduce((sum, section) => sum + section.items.length, 0);
    const payload = {
      goldEnabled: true,
      generatedAt: nowIso(),
      summary: {
        totalInsights,
        centerHealth,
        modulesConnected: [
          "agenda",
          "clienti",
          "servizi",
          "cassa",
          "magazzino",
          "turni",
          "trattamenti",
          "protocolli",
          "redditività",
          "operatori",
          "membership",
          "AI cliente"
        ],
        snapshot: {
          sourceLayer: snapshot.sourceLayer,
          cached: Boolean(snapshot.meta?.cached),
          generatedAt: snapshot.generatedAt,
          expiresAt: snapshot.expiresAt
        },
        treatments: Number(snapshot.core?.treatments || 0),
        protocols: Number(snapshot.core?.protocols || 0),
        technologies: Number(snapshot.core?.technologies || 0)
      },
      sections: manualSections
    };
    return localizeDecisionCenterPayload(this.applyGoldCoreV2Prefilter(payload), this.getRuntimeLanguage(session));
  }

  getAiGoldCockpit(options = {}, session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      return {
        goldEnabled: false,
        requiredPlan: "gold",
        currentPlan: this.getPlanLevel(session),
        message: "Cockpit Gold disponibile solo con piano Gold.",
        sections: []
      };
    }

    const startDate = String(options.startDate || "");
    const endDate = String(options.endDate || "");
    const period = { startDate, endDate };
    const snapshotPeriod = (startDate || endDate) && !options.forceWindow ? {} : period;
    const snapshot = this.getBusinessSnapshot(snapshotPeriod, session);
    const decisionContext = this.getGoldDecisionContext(snapshotPeriod, session);
    const decisionCenter = this.getAiGoldDecisionCenter(snapshotPeriod, session);
    const goldState = this.getGoldState(session);
    const cachedProgressive = this.getSettings(session).progressiveIntelligenceStatus || null;
    const progressive = this.shouldUseCachedProgressiveIntelligence(cachedProgressive, goldState)
      ? { ...cachedProgressive, cached: true, source: "batch_cache" }
      : {
          forecastAllowed: false,
          oracleStatus: { forecastAllowed: false },
          enabledFeatures: [],
          blockedFeatures: [{
            key: "progressive_intelligence_cache",
            label: "Lettura prudenziale in aggiornamento",
            reason: "Il cockpit usa lo snapshot Gold corrente e non forza ricalcoli pesanti in apertura."
          }],
          activation: { code: "safe_read" },
          source: "cockpit_lightweight_fallback"
        };
    const dataQuality = snapshot.dataQuality || {};
    const centerHealth = snapshot.report?.centerHealth || {};
    const profitability = snapshot.profitability || {};
    const marketing = snapshot.marketing || {};
    let inventory = snapshot.inventory || {};
    if (!Number(inventory.totalItems || inventory.summary?.totalItems || 0) && (!Array.isArray(inventory.lowStock) || inventory.lowStock.length === 0)) {
      const liveInventoryItems = this.filterByCenter(this.inventoryRepository.list(), session);
      inventory = {
        totalItems: liveInventoryItems.length,
        summary: { totalItems: liveInventoryItems.length },
        lowStock: liveInventoryItems.filter((item) => Number(item.quantity || 0) <= Number(item.minQuantity || 0))
      };
    }
    const primaryAction = decisionContext.primaryAction || null;
    const priorityClients = Array.isArray(marketing.priorityClients)
      ? marketing.priorityClients
      : Array.isArray(marketing.suggestions)
        ? marketing.suggestions
        : [];
    const profitabilitySuggestions = Array.isArray(profitability.suggestions) ? profitability.suggestions : [];
    const servicesMissingCosts = Number(dataQuality.metrics?.servicesMissingCosts || 0);
    const operatorsMissingHourlyCost = Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0);
    const profitabilityBlockedForConfig = servicesMissingCosts > 0 || operatorsMissingHourlyCost > 0;
    const forecastStatus = progressive?.oracleStatus || {};
    const forecastAllowed = Boolean(progressive?.forecastAllowed || forecastStatus.forecastAllowed);
    const enabledFeatures = Array.isArray(progressive?.enabledFeatures) ? progressive.enabledFeatures : [];
    const blockedFeatures = Array.isArray(progressive?.blockedFeatures) ? progressive.blockedFeatures : [];
    const primaryLooksLikeStaleCostSetup = !profitabilityBlockedForConfig
      && /completa\s+costi|costo\s+orario|configurazione\s+costi/i.test(String(primaryAction?.suggestedAction || primaryAction?.explanationShort || ""));
    const resolvedPrimaryLabel = primaryLooksLikeStaleCostSetup
      ? "Crescita e controllo centro"
      : primaryAction?.label || "Priorità operativa";
    const resolvedPrimaryValue = primaryLooksLikeStaleCostSetup
      ? "Il centro demo ha dati economici leggibili: parti da clienti prioritari, continuità agenda e controllo marginalità."
      : primaryAction?.explanationShort || primaryAction?.suggestedAction || "Gold sta leggendo il centro senza forzare azioni.";
    const resolvedPrimaryAction = primaryLooksLikeStaleCostSetup
      ? "apri cockpit e lavora la prima priorità"
      : primaryAction?.suggestedAction || "leggi priorità";

    const sections = this.withGoldManualActions([
      {
        key: "executive",
        title: "Cockpit Gold",
        status: primaryAction ? "ready" : "monitor",
        items: [
          {
            id: "gold-primary-action",
            label: resolvedPrimaryLabel,
            value: resolvedPrimaryValue,
            action: resolvedPrimaryAction,
            target: primaryAction?.target || primaryAction?.domain || "dashboard",
            requiresOperatorConfirmation: true,
            confidence: Number(primaryAction?.confidence || decisionContext.globalConfidence || 0),
            risk: Number(primaryAction?.risk || decisionContext.systemRisk || 0)
          },
          {
            id: "gold-rule",
            label: "Regola operativa",
            value: "Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare. L'operatore conferma ogni azione.",
            action: "mantieni conferma operatore",
            target: "ai-gold"
          }
        ]
      },
      {
        key: "center_health",
        title: "Stato centro",
        status: centerHealth.status || "unknown",
        items: [
          {
            id: "health-main",
            label: centerHealth.statusLabel || "Stato non ancora classificato",
            value: centerHealth.reason || "La lettura centro dipende da fatturato, operatori, agenda e continuità clienti.",
            action: centerHealth.action || "controlla dashboard",
            target: "dashboard",
            metrics: {
              monthlyRevenueCents: Number(centerHealth.monthlyRevenueCents || 0),
              revenuePerOperatorCents: Number(centerHealth.revenuePerOperatorCents || 0),
              saturationPercent: Number(centerHealth.saturationPercent || 0),
              continuityPercent: Number(centerHealth.continuityPercent || 0)
            }
          }
        ]
      },
      {
        key: "growth",
        title: "Crescita clienti",
        status: priorityClients.length ? "action_queue" : "monitor",
        items: priorityClients.slice(0, 5).map((client, index) => ({
          id: `growth-${client.clientId || index + 1}`,
          label: client.name || "Cliente da leggere",
          value: client.clearReason || client.conclusion || client.contactClassLabel || "Cliente ordinato dal motore marketing Gold.",
          action: client.operatingDecision || client.recommendedAction || "prepara contatto",
          target: "marketing",
          clientId: client.clientId || "",
          consentRequired: !client.marketingConsent,
          impactCents: Number(client.referenceValueCents || client.estimatedRecallValueCents || 0)
        }))
      },
      {
        key: "economic_control",
        title: "Controllo economico",
        status: profitabilityBlockedForConfig ? "configuration_required" : "readable",
        items: profitabilityBlockedForConfig
          ? [{
              id: "profitability-config",
              label: "Redditività da configurare",
              value: `${economicConfigGapText(servicesMissingCosts, operatorsMissingHourlyCost)} prima di usare la lettura economica come guida forte.`,
              action: "completa configurazione costi",
              target: "services"
            }]
          : (profitabilitySuggestions.length ? profitabilitySuggestions.slice(0, 5).map((item) => ({
              id: `profit-${item.id || item.name}`,
              label: item.name || "Servizio",
              value: item.clearConclusion || item.suggestion || "Lettura economica Gold.",
              action: item.operatingAction || item.nextAction || "controlla redditività",
              target: "profitability",
              revenueCents: Number(item.revenueCents || 0),
              profitCents: Number(item.profitCents || 0),
              marginPercent: Number(item.marginPercent || 0)
            })) : [{
              id: "profitability-summary",
              label: "Redditività leggibile",
              value: "Costi principali presenti: Gold può leggere margini e controllo economico senza trasformarlo in promessa di risultato.",
              action: "apri redditività e controlla servizi benchmark",
              target: "profitability",
              revenueCents: Number(profitability.summary?.revenueCents || profitability.summary?.totalRevenueCents || 0),
              profitCents: Number(profitability.summary?.profitCents || profitability.summary?.totalProfitCents || 0),
              marginPercent: Number(profitability.summary?.marginPercent || 0)
            }])
      },
      {
        key: "forecast_readiness",
        title: "Previsione prudenziale",
        status: forecastAllowed ? "available" : "not_ready",
        items: [
          {
            id: "forecast-status",
            label: forecastAllowed ? "Forecast prudenziale disponibile" : "Forecast non ancora maturo",
            value: forecastAllowed
              ? "Il centro ha dati sufficienti per scenari condizionati e prudenti."
              : "Gold non produce previsioni forti finché storico, costi, stabilità e affidabilità economica non sono sufficienti.",
            action: forecastAllowed ? "leggi scenari" : "aumenta qualità dati e storico",
            target: "ai-gold",
            level: progressive?.activation?.code || progressive?.levelCode || "",
            enabledFeatures: enabledFeatures.map((item) => item.key || item).filter(Boolean).slice(0, 8),
            blockedFeatures: blockedFeatures.map((item) => ({
              key: item.key || "",
              label: item.label || "",
              reason: item.reason || ""
            })).slice(0, 8)
          }
        ]
      },
      {
        key: "evidence",
        title: "Prove e sorgenti",
        status: "read_only",
        items: [
          {
            id: "source-snapshot",
            label: "Snapshot gestionale",
            value: snapshot.sourceLayer || "business_snapshot",
            endpoint: "/api/business-snapshot"
          },
          {
            id: "source-decision-context",
            label: "Contesto decisionale",
            value: decisionContext.sourceLayer || "gold_decision_context",
            endpoint: "/api/ai-gold/decision-context"
          },
          {
            id: "source-decision-center",
            label: "Centro decisionale",
            value: decisionCenter.sourceLayer || "gold_decision_center",
            endpoint: "/api/ai-gold/decision-center"
          },
          {
            id: "source-inventory",
            label: "Magazzino",
            value: `${Number(inventory.totalItems || inventory.summary?.totalItems || 0)} articoli letti`,
            endpoint: "/api/inventory/overview",
            button: "Apri magazzino",
            target: "inventory",
            targetFocus: Array.isArray(inventory.lowStock) && inventory.lowStock.length ? "low-stock" : ""
          }
        ]
      }
    ].map((section) => ({
      ...section,
      items: Array.isArray(section.items) ? section.items : []
    })));

    return this.applyGoldCoreV2Prefilter({
      goldEnabled: true,
      cockpitVersion: "gold_cockpit_v1",
      sourceLayer: "smartdesk_gold_cockpit",
      generatedAt: nowIso(),
      period: snapshot.period || period,
      tenant: {
        centerId: this.getCenterId(session),
        plan: this.getPlanLevel(session)
      },
      summary: {
        centerStatus: centerHealth.status || "",
        centerStatusLabel: centerHealth.statusLabel || "",
        primaryAction: resolvedPrimaryAction || resolvedPrimaryLabel || "",
        totalPriorityClients: priorityClients.length,
        profitabilityBlockedForConfig,
        forecastAllowed,
        dataQualityScore: Number(dataQuality.score || 0),
        decisionConfidence: Number(decisionContext.globalConfidence || 0),
        systemRisk: Number(decisionContext.systemRisk || 0)
      },
      guardrails: {
        readOnly: true,
        automaticExecutionAllowed: false,
        operatorConfirmationRequired: true,
        medicalClaimsAllowed: false,
        pricingMutationAllowed: false,
        rule: "Cockpit Gold legge e ordina. Non invia messaggi, non modifica prezzi, non pubblica e non corregge dati senza operatore."
      },
      sections
    });
  }

  buildAiGoldProfitabilityFromOverview(overview = {}, session = null) {
    const services = Array.isArray(overview.services) ? overview.services : [];
    const suggestions = services.map((service) => {
      const status = String(service.status || "HEALTHY");
      const executions = Number(service.executions || 0);
      const averageRevenueCents = Number(service.averageRevenueCents || 0);
      const averageCostCents = Number(service.averageCostCents || 0);
      const marginPercent = Number(service.marginPercent || 0);
      const suggestion = status === "CONFIG_REQUIRED"
        ? "Mancano dati economici: completa prezzo, durata, prodotti o tecnologie usate e costo orario operatore."
        : status === "LOSS"
        ? `Questo servizio perde margine: incassa in media ${euro(averageRevenueCents)} e costa circa ${euro(averageCostCents)}.`
        : status === "LOW_MARGIN"
          ? `Margine basso: ${executions} esecuzioni nel periodo e margine ${marginPercent}%. Controlla costi e frequenza prima di promuoverlo.`
          : "Servizio sotto controllo: puoi mantenerlo o usarlo come riferimento per offerte sostenibili.";
      const nextAction = status === "CONFIG_REQUIRED"
        ? "Apri il servizio e completa i campi mancanti. Se usa una tecnologia, collega la tecnologia e indica quante volte viene usata."
        : status === "LOSS"
        ? "Apri questo servizio: controlla prezzo, durata, costo operatore, prodotti e tecnologie collegate. Poi salva e rilegge i margini."
        : status === "LOW_MARGIN"
          ? "Se il costo nasce da una tecnologia con rata o costo mensile, serve più frequenza, prezzo corretto o una promozione mirata."
          : "Usalo come servizio di riferimento per costruire pacchetti sostenibili.";
      const clearConclusion = status === "CONFIG_REQUIRED"
        ? "mancano dati per leggere il margine"
        : status === "LOSS"
        ? "semaforo rosso: servizio in perdita"
        : status === "LOW_MARGIN"
          ? "semaforo giallo: margine basso"
          : "semaforo verde: margine sano";
      const economicGapCents = status === "LOSS"
        ? Math.abs(Number(service.profitCents || 0))
        : 0;
      const operatingAction = status === "CONFIG_REQUIRED"
        ? "completa i costi mancanti"
        : status === "LOSS"
        ? "correggi prezzo, durata o costi collegati"
        : status === "LOW_MARGIN"
          ? "aumenta frequenza, prezzo o promozione"
          : "mantieni il servizio";
      return {
        id: service.id,
        name: service.name || "Servizio",
        executions,
        revenueCents: Number(service.revenueCents || 0),
        costCents: Number(service.costCents || 0),
        profitCents: Number(service.profitCents || 0),
        laborCostCents: Number(service.laborCostCents || 0),
        materialCostCents: Number(service.materialCostCents || 0),
        technologyCostCents: Number(service.technologyCostCents || 0),
        marginPercent,
        averageRevenueCents,
        averageCostCents,
        confidence: service.confidence || overview.meta?.confidence || "",
        sourceFlags: Array.isArray(service.sourceFlags) ? service.sourceFlags : [],
        economicGapCents,
        clearConclusion,
        operatingAction,
        nextAction,
        status,
        suggestion
      };
    }).sort((a, b) => a.marginPercent - b.marginPercent);
    const alerts = suggestions
      .filter((item) => item.status !== "HEALTHY")
      .map((item) => ({
        level: item.status === "LOSS" ? "critical" : "warning",
        title: item.status === "CONFIG_REQUIRED"
          ? `${item.name}: configurazione economica incompleta`
          : item.status === "LOSS"
            ? `${item.name} in perdita`
            : `${item.name} con margine basso`,
        body: item.suggestion,
        serviceId: item.id
      }));
    const payload = {
      goldEnabled: true,
      generatedAt: nowIso(),
      summary: overview.totals,
      monthlyTrend: overview.monthlyTrend || [],
      operatingCostMinuteProfile: overview.operatingCostMinuteProfile || null,
      alerts,
      suggestions
    };
    if (this.getRuntimeLanguage(session) !== "en") return payload;
    return {
      ...payload,
      alerts: payload.alerts.map((item) => ({
        ...item,
        title: localizeServerText(item.title, "en"),
        body: localizeServerText(item.body, "en")
      })),
      suggestions: payload.suggestions.map((item) => ({
        ...item,
        name: localizeServerText(item.name, "en"),
        clearConclusion: localizeServerText(item.clearConclusion, "en"),
        operatingAction: localizeServerText(item.operatingAction, "en"),
        nextAction: localizeServerText(item.nextAction, "en"),
        suggestion: localizeServerText(item.suggestion, "en")
      }))
    };
  }

  getAiGoldProfitabilityLive(options = {}, session = null, precomputedOverview = null) {
    this.assertCanOperate(session);
    const goldEnabled = this.hasGoldIntelligence(session);
    if (!goldEnabled) {
      return {
        goldEnabled: false,
        message: "AI Gold Redditività disponibile solo con piano Gold.",
        alerts: [],
        suggestions: []
      };
    }
    const overview = precomputedOverview || this.getProfitabilityOverview(options, session);
    return this.buildAiGoldProfitabilityFromOverview(overview, session);
  }

  getAiGoldProfitability(options = {}, session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      return {
        goldEnabled: false,
        message: "AI Gold Redditività disponibile solo con piano Gold.",
        alerts: [],
        suggestions: []
      };
    }
    const stateOverview = this.buildProfitabilityOverviewFromGoldState(options, session);
    if (stateOverview) {
      this.logGoldStateEndpoint("ai_profitability", session, {
        source: "smartdesk_gold_state",
        valid: true,
        reason: "ok",
        eventSeq: stateOverview.meta?.eventSeq ?? null
      });
      return this.buildAiGoldProfitabilityFromOverview(stateOverview, session);
    }
    this.logGoldStateEndpoint("ai_profitability", session, {
      source: "raw_fallback",
      valid: false,
      reason: "state_unavailable"
    });
    const dataQuality = this.getDataQuality(session, { summaryOnly: true });
    const servicesMissingCosts = Number(dataQuality.metrics?.servicesMissingCosts || 0);
    const operatorsMissingHourlyCost = Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0);
    const profitabilityBlockedForConfig = servicesMissingCosts > 0 || operatorsMissingHourlyCost > 0;
    const snapshot = this.getBusinessSnapshot(options, session);
    const profitability = snapshot.profitability || {
      goldEnabled: true,
      generatedAt: snapshot.generatedAt || nowIso(),
      summary: {},
      monthlyTrend: [],
      alerts: [],
      suggestions: [],
      sourceLayer: "business_snapshot"
    };
    if (profitabilityBlockedForConfig && (!Array.isArray(profitability.suggestions) || profitability.suggestions.length === 0)) {
      const payload = {
        ...profitability,
        alerts: [{
          level: "warning",
          title: "Completa i costi prima di leggere i margini",
          body: `Mancano costi nei servizi o negli operatori. Completa questi campi e poi rilegge il margine.`,
          serviceId: "profitability-config-block"
        }],
        suggestions: [{
          id: "profitability-config-block",
          name: "Costi da completare",
          executions: Number(profitability.summary?.executions || 0),
          revenueCents: Number(profitability.summary?.revenueCents || 0),
          costCents: Number(profitability.summary?.costCents || 0),
          profitCents: Number(profitability.summary?.profitCents || 0),
          laborCostCents: 0,
          materialCostCents: 0,
          technologyCostCents: 0,
          marginPercent: 0,
          averageRevenueCents: 0,
          averageCostCents: 0,
          confidence: "bassa",
          sourceFlags: ["config_required"],
          economicGapCents: 0,
          clearConclusion: "semaforo giallo: mancano costi",
          operatingAction: "completa i costi mancanti",
          nextAction: `${economicConfigGapText(servicesMissingCosts, operatorsMissingHourlyCost)}. Apri il campo indicato, inserisci il costo e salva.`,
          status: "CONFIG_REQUIRED",
          suggestion: "Il margine diventa leggibile solo quando prezzo, durata, prodotti/tecnologie e costo operatore sono completi."
        }]
      };
      if (this.getRuntimeLanguage(session) !== "en") return payload;
      return {
        ...payload,
        alerts: payload.alerts.map((item) => ({
          ...item,
          title: localizeServerText(item.title, "en"),
          body: localizeServerText(item.body, "en")
        })),
        suggestions: payload.suggestions.map((item) => ({
          ...item,
          name: localizeServerText(item.name, "en"),
          clearConclusion: localizeServerText(item.clearConclusion, "en"),
          operatingAction: localizeServerText(item.operatingAction, "en"),
          nextAction: localizeServerText(item.nextAction, "en"),
          suggestion: localizeServerText(item.suggestion, "en")
        }))
      };
    }
    return profitability;
  }
}

module.exports = {
  DesktopMirrorService,
  defaultSettings
};
