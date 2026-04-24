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

const DATA_DIR = path.resolve(process.cwd(), "data");
const EXPORTS_DIR = path.resolve(process.cwd(), "public", "exports");

const DEFAULT_CENTER_ID = "center_admin";
const DEFAULT_CENTER_NAME = "Privilege Parrucchieri";
const DEFAULT_ADMIN_USERNAME = "cristian";
const DEFAULT_ADMIN_PASSWORD = "fabiana88!";
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
  DASHBOARD_STATS: "dashboardStats"
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
  whatsappWebhookReady: false
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

function addDaysIso(value, days) {
  const base = new Date(value || nowIso());
  const next = new Date(base.getTime() + Number(days || 0) * 86400000);
  return next.toISOString();
}

function addMonthsIso(value, months) {
  const base = new Date(value || nowIso());
  const next = new Date(base);
  next.setMonth(next.getMonth() + Number(months || 0));
  return next.toISOString();
}

function addMinutesIso(value, minutes) {
  const base = new Date(value || nowIso());
  const next = new Date(base.getTime() + Number(minutes || 0) * 60000);
  return next.toISOString();
}

function toDateOnly(value) {
  if (!value) return nowIso().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return nowIso().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function toUtcDateOnlyFromParts(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function getWeekWindow(anchorDate) {
  const anchor = new Date(`${toDateOnly(anchorDate)}T00:00:00`);
  const diffToMonday = (anchor.getDay() + 6) % 7;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    startDate: toUtcDateOnlyFromParts(start.getFullYear(), start.getMonth(), start.getDate()),
    endDate: toUtcDateOnlyFromParts(end.getFullYear(), end.getMonth(), end.getDate())
  };
}

function getMonthWindow(anchorDate) {
  const anchor = new Date(`${toDateOnly(anchorDate)}T00:00:00`);
  return {
    startDate: toUtcDateOnlyFromParts(anchor.getFullYear(), anchor.getMonth(), 1),
    endDate: toUtcDateOnlyFromParts(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  };
}

function toDateTime(date, time) {
  return `${toDateOnly(date)}T${String(time || "09:00").slice(0, 5)}:00`;
}

function toTimeOnly(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "09:00";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function addMinutes(dateTime, minutes) {
  const base = new Date(dateTime);
  const next = new Date(base.getTime() + Number(minutes || 0) * 60000);
  return next.toISOString();
}

function euro(cents) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(cents || 0) / 100);
}

function average(values) {
  const clean = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value)));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + Number(value), 0) / clean.length;
}

function stddev(values) {
  const clean = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value))).map(Number);
  if (clean.length <= 1) return 0;
  const avg = average(clean);
  return Math.sqrt(average(clean.map((value) => (value - avg) ** 2)));
}

function clamp(value, min, max) {
  const numeric = Number(value || 0);
  return Math.min(max, Math.max(min, numeric));
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function groupByClientId(items = []) {
  const grouped = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const clientId = String(item.clientId || "");
    if (!clientId) return;
    const current = grouped.get(clientId) || [];
    current.push(item);
    grouped.set(clientId, current);
  });
  return grouped;
}

function groupByAppointmentId(items = []) {
  const grouped = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const appointmentId = String(item.appointmentId || "");
    if (!appointmentId) return;
    const current = grouped.get(appointmentId) || [];
    current.push(item);
    grouped.set(appointmentId, current);
  });
  return grouped;
}

function buildInferredOperatorServiceMap(appointments = [], staff = []) {
  const map = new Map();
  const staffIdByName = new Map((Array.isArray(staff) ? staff : []).map((operator) => [
    normalizeText(operator.name || ""),
    String(operator.id || "")
  ]).filter((entry) => entry[0] && entry[1]));
  (Array.isArray(appointments) ? appointments : []).forEach((appointment) => {
    const status = String(appointment.status || "").toLowerCase();
    if (["cancelled", "no_show"].includes(status)) return;
    const explicitOperatorId = String(appointment.staffId || appointment.operatorId || "");
    const operatorName = normalizeText(appointment.staffName || appointment.operatorName || appointment.operatore || "");
    const operatorId = explicitOperatorId || staffIdByName.get(operatorName) || "";
    const serviceId = String(appointment.serviceId || appointment.serviceName || "");
    if (!operatorId || !serviceId) return;
    const current = map.get(operatorId) || new Set();
    current.add(serviceId);
    map.set(operatorId, current);
  });
  return map;
}

function relevantClientAppointments(appointments, clientId, nowMs = Date.now()) {
  const sourceIsGrouped = appointments instanceof Map;
  const source = appointments instanceof Map
    ? appointments.get(String(clientId || "")) || []
    : (Array.isArray(appointments) ? appointments : []);
  return source
    .filter((item) => sourceIsGrouped || String(item.clientId || "") === String(clientId || ""))
    .filter((item) => {
      const status = String(item.status || "").toLowerCase();
      if (["cancelled", "no_show", "moved"].includes(status)) return false;
      const time = new Date(item.startAt || item.createdAt || 0).getTime();
      return Number.isFinite(time) && time <= nowMs;
    })
    .sort((a, b) => new Date(a.startAt || a.createdAt || 0).getTime() - new Date(b.startAt || b.createdAt || 0).getTime());
}

function visitGapsDays(appointments) {
  return (Array.isArray(appointments) ? appointments : []).slice(1)
    .map((item, index) => {
      const current = new Date(item.startAt || item.createdAt || 0).getTime();
      const previous = new Date(appointments[index].startAt || appointments[index].createdAt || 0).getTime();
      return Math.max(1, Math.round((current - previous) / 86400000));
    })
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 365);
}

function getCenterAverageFrequencyDays(clients, appointments, nowMs = Date.now()) {
  const allGaps = [];
  const appointmentsByClientId = appointments instanceof Map ? appointments : groupByClientId(appointments);
  (Array.isArray(clients) ? clients : []).forEach((client) => {
    const visits = relevantClientAppointments(appointmentsByClientId, String(client.id || ""), nowMs);
    if (visits.length < 3) return;
    visitGapsDays(visits)
      .filter((gap) => gap >= 7 && gap <= 120)
      .forEach((gap) => allGaps.push(gap));
  });
  const value = Math.round(average(allGaps));
  return value ? clamp(value, 21, 75) : 45;
}

function expectedRecallRoutineFromService(serviceInput, fallbackDays = 45) {
  const service = serviceInput && typeof serviceInput === "object" ? serviceInput : null;
  const rawName = service ? service.name || service.serviceName || service.service || "" : serviceInput || "";
  const rawCategory = service ? service.category || service.serviceCategory || service.type || "" : "";
  const hasTechnologyLinks = service && Array.isArray(service.technologyLinks) && service.technologyLinks.length > 0;
  const text = normalizeText(`${rawCategory || ""} ${rawName || ""}`);
  if (hasTechnologyLinks || /tecnolog|radiofrequ|laser|pressoter|ultrasu|ossigen|ozon|o3|plasma|skin pro|macchin|fotobiomod|endosfer|criolip|elettropor/.test(text)) {
    return { key: "tecnologie_avanzate", label: "Tecnologie avanzate", minDays: 30, maxDays: 60 };
  }
  if (/corpo|body|cellulit|dren|linfodren|massagg|press|rimodell|fang|bendagg|tonific|gambe|addome|percorso corpo/.test(text)) {
    return { key: "estetica_corpo", label: "Estetica corpo / percorso", minDays: 7, maxDays: 14 };
  }
  if (/viso|facial|pulizia|peeling|trattamento viso|idrata|antiage|anti age|macchie viso|couperose|acne|pelle|dermo/.test(text)) {
    return { key: "estetica_viso", label: "Estetica viso", minDays: 30, maxDays: 45 };
  }
  if (/schiar|balay|meches|meces|shatush|shatoush|decolor/.test(text)) {
    return { key: "parrucchiere_schiariture", label: "Parrucchiere / schiariture", minDays: 56, maxDays: 70 };
  }
  if (/colore|ricresc|tonalizz|gloss|rifless/.test(text)) {
    return { key: "parrucchiere_colore", label: "Parrucchiere / colore", minDays: 28, maxDays: 42 };
  }
  if (/keratin|cheratin|lisciante|trattament|ricostruz|botox|cute|cuoio|o3|special/.test(text)) {
    return { key: "parrucchiere_trattamento", label: "Parrucchiere / trattamento speciale", minDays: 70, maxDays: 90 };
  }
  if (/parrucch|hair|barber|taglio|piega|barba|styling|messa in piega/.test(text)) {
    return { key: "parrucchiere", label: "Parrucchiere", minDays: 21, maxDays: 45 };
  }
  const normalizedFallback = clamp(fallbackDays, 35, 75);
  return { key: "routine_centro", label: "Routine media centro", minDays: Math.max(21, normalizedFallback - 7), maxDays: normalizedFallback };
}

function classifyRecallStatus(daysSinceLastVisit, expectedRoutineDays) {
  const days = Number(daysSinceLastVisit || 0);
  const routine = Number(expectedRoutineDays || 45);
  const overdueDays = Math.round(days - routine);
  const timing = classifyMarketingTiming(days, routine);
  if (timing.timingClass === "storico") return { recallStatus: "storico", recallStatusLabel: "Storico", overdueDays };
  if (timing.timingClass === "perso") return { recallStatus: "perso", recallStatusLabel: "Perso", overdueDays };
  if (timing.timingClass === "recupero_attivo" || timing.timingClass === "recupero_soft") {
    return { recallStatus: "a_rischio", recallStatusLabel: "A rischio", overdueDays };
  }
  if (timing.timingClass === "mantenimento" || timing.timingClass === "promemoria_naturale") {
    return { recallStatus: "da_richiamare", recallStatusLabel: "Da richiamare", overdueDays };
  }
  return { recallStatus: "in_linea", recallStatusLabel: "In linea", overdueDays: Math.max(0, overdueDays) };
}

function normalizeScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function classifyMarketingTiming(daysSinceLastVisit, routineDays) {
  const days = Math.max(0, Number(daysSinceLastVisit || 0));
  const routine = Math.max(1, Number(routineDays || 45));
  const deltaDays = Math.round(days - routine);
  const timingScore = Math.max(0, deltaDays / routine);
  if (days > 180) {
    return {
      timingClass: "storico",
      timingLabel: "Storico inattivo",
      contactClassLabel: "Storico",
      deltaDays,
      timingScore
    };
  }
  if (days > routine * 3) {
    return {
      timingClass: "perso",
      timingLabel: "Cliente perso",
      contactClassLabel: "Perso",
      deltaDays,
      timingScore
    };
  }
  if (deltaDays <= 0) {
    return {
      timingClass: "in_routine",
      timingLabel: "In routine",
      contactClassLabel: "Non contattare",
      deltaDays: 0,
      timingScore: 0
    };
  }
  if (deltaDays <= routine * 0.25) {
    return {
      timingClass: "promemoria_naturale",
      timingLabel: "Promemoria naturale",
      contactClassLabel: "Promemoria naturale",
      deltaDays,
      timingScore
    };
  }
  if (deltaDays <= routine * 0.75) {
    return {
      timingClass: "mantenimento",
      timingLabel: "Mantenimento",
      contactClassLabel: "Mantenimento",
      deltaDays,
      timingScore
    };
  }
  if (deltaDays <= routine * 1.5) {
    return {
      timingClass: "recupero_soft",
      timingLabel: "Recupero soft",
      contactClassLabel: "Recupero soft",
      deltaDays,
      timingScore
    };
  }
  return {
    timingClass: "recupero_attivo",
    timingLabel: "Recupero attivo",
    contactClassLabel: "Recupero attivo",
    deltaDays,
    timingScore
  };
}

function freshnessScoreFromDays(daysSinceLastMarketingContact) {
  const days = Number(daysSinceLastMarketingContact);
  if (!Number.isFinite(days)) return 1;
  if (days < 3) return 0;
  if (days < 7) return 0.5;
  return 1;
}

function timingFitScore(timingScore) {
  const score = Number(timingScore || 0);
  if (score <= 0) return 0;
  if (score <= 0.75) return 1;
  if (score <= 1.5) return 0.8;
  if (score <= 3) return 0.5;
  return 0.3;
}

function scoreClass(value, ranges) {
  const score = Number(value || 0);
  const match = ranges.find((item) => score < item.max);
  return match || ranges[ranges.length - 1];
}

function relationStateFromMarketingAction(action) {
  const status = String(action?.status || "");
  if (!action) return "non_contattato";
  if (status === "done") return "prenotato";
  if (status === "copied") return "contattato";
  if (status === "approved" || status === "to_approve") return "in_attesa";
  return "non_contattato";
}

const GOLD_DECISION_WEIGHTS = Object.freeze({
  default: { need: 1.0, value: 1.0, urgency: 0.9, coherence: 1.0, friction: 1.3, bias: -1.15 },
  cliente: { need: 1.1, value: 1.0, urgency: 0.8, coherence: 1.1, friction: 1.45, bias: -1.1 },
  marketing: { need: 1.1, value: 1.0, urgency: 0.8, coherence: 1.1, friction: 1.45, bias: -1.1 },
  appuntamento: { need: 1.1, value: 0.8, urgency: 1.2, coherence: 0.8, friction: 1.4, bias: -1.1 },
  pagamento: { need: 1.2, value: 1.1, urgency: 1.0, coherence: 0.9, friction: 1.5, bias: -1.15 },
  servizio: { need: 1.0, value: 1.2, urgency: 0.7, coherence: 1.0, friction: 1.2, bias: -1.15 },
  operatore: { need: 1.0, value: 1.1, urgency: 0.9, coherence: 0.9, friction: 1.3, bias: -1.1 },
  prodotto: { need: 1.0, value: 0.9, urgency: 1.1, coherence: 0.8, friction: 1.2, bias: -1.1 },
  tecnologia: { need: 1.0, value: 1.2, urgency: 0.7, coherence: 0.9, friction: 1.2, bias: -1.15 },
  data_quality_alert: { need: 1.3, value: 0.9, urgency: 0.9, coherence: 1.0, friction: 1.1, bias: -1.0 },
  centro: { need: 1.1, value: 1.2, urgency: 0.8, coherence: 1.0, friction: 1.3, bias: -1.1 }
});

// Corelia Decision Engine: layer premium sopra i dati del gestionale.
// Non e' usato dal Core operativo Base/Silver e non sostituisce CRUD, agenda, cassa o report.
function sigmoid(value) {
  return 1 / (1 + Math.exp(-Number(value || 0)));
}

function goldDecisionBand(score) {
  const value = Number(score || 0);
  if (value >= 0.75) return { key: "alta", label: "Priorità alta" };
  if (value >= 0.55) return { key: "media", label: "Priorità media" };
  if (value >= 0.35) return { key: "bassa", label: "Priorità bassa" };
  return { key: "stop", label: "Non prioritario" };
}

function computeNeed(entityType, entity = {}, context = {}) {
  const type = String(entityType || "default");
  if (type === "cliente" || type === "marketing") {
    return normalizeScore(Number(entity.needScore ?? Math.min(Number(entity.timingScore || 0), 2) / 2));
  }
  if (type === "appuntamento") return normalizeScore(entity.isIncomplete ? 1 : entity.needsConfirmation ? 0.75 : entity.needScore || 0);
  if (type === "pagamento") return normalizeScore(entity.isUnlinked ? 1 : entity.isOpen ? 0.75 : entity.needScore || 0);
  if (type === "servizio" || type === "tecnologia") return normalizeScore(entity.marginAlert ? 1 : entity.needScore || 0);
  if (type === "operatore") return normalizeScore(entity.underTarget ? 1 : entity.needScore || 0);
  if (type === "prodotto") return normalizeScore(entity.isUnderstock ? 1 : entity.needScore || 0);
  if (type === "data_quality_alert") return normalizeScore(entity.issueRate ?? entity.needScore ?? 0);
  if (type === "centro") return normalizeScore(entity.centerNeedScore ?? entity.needScore ?? 0);
  return normalizeScore(entity.needScore ?? context.needScore ?? 0);
}

function computeValue(entityType, entity = {}, context = {}) {
  const type = String(entityType || "default");
  if (type === "cliente" || type === "marketing") return normalizeScore(entity.valueScoreNormalized ?? entity.valueScore ?? 0);
  if (type === "pagamento") return normalizeScore(entity.amountScore ?? entity.valueScore ?? 0);
  if (type === "servizio" || type === "tecnologia") return normalizeScore(entity.marginImpactScore ?? entity.valueScore ?? 0);
  if (type === "centro") return normalizeScore(entity.businessImpactScore ?? entity.valueScore ?? 0);
  return normalizeScore(entity.valueScore ?? context.valueScore ?? 0);
}

function computeUrgency(entityType, entity = {}, context = {}) {
  const type = String(entityType || "default");
  if (type === "cliente" || type === "marketing") return normalizeScore(entity.timingFit ?? entity.urgencyScore ?? 0);
  if (type === "appuntamento") return normalizeScore(entity.startsSoon ? 1 : entity.urgencyScore || 0);
  if (type === "pagamento") return normalizeScore(entity.closeDayUrgency ?? entity.urgencyScore ?? 0);
  if (type === "prodotto") return normalizeScore(entity.stockUrgencyScore ?? entity.urgencyScore ?? 0);
  return normalizeScore(entity.urgencyScore ?? context.urgencyScore ?? 0);
}

function computeCoherence(entityType, entity = {}, context = {}) {
  const type = String(entityType || "default");
  if (type === "cliente" || type === "marketing") return normalizeScore(entity.responseProbability ?? entity.coherenceScore ?? 0);
  if (type === "pagamento") return normalizeScore(entity.matchConfidence ?? entity.coherenceScore ?? 0);
  if (type === "data_quality_alert") return normalizeScore(1 - Number(entity.issueRate || 0));
  return normalizeScore(entity.coherenceScore ?? context.coherenceScore ?? 0.5, 0.5);
}

function computeFriction(entityType, entity = {}, context = {}) {
  const type = String(entityType || "default");
  if (type === "cliente" || type === "marketing") {
    if (entity.blockedByAntiInvasiveRule) return 1;
    return normalizeScore(entity.frictionScore ?? 0);
  }
  if (type === "appuntamento") return normalizeScore(entity.hasConflict ? 1 : entity.frictionScore || 0);
  if (type === "pagamento") return normalizeScore(entity.isAmbiguous ? 1 : entity.frictionScore || 0);
  if (type === "servizio" || type === "tecnologia") return normalizeScore(entity.costUncertaintyScore ?? entity.frictionScore ?? 0);
  return normalizeScore(entity.frictionScore ?? context.frictionScore ?? 0);
}

function computeGoldDecisionScore(entityType, entity = {}, context = {}) {
  const type = String(entityType || "default");
  const weights = { ...GOLD_DECISION_WEIGHTS.default, ...(GOLD_DECISION_WEIGHTS[type] || {}) };
  const axes = {
    need: computeNeed(type, entity, context),
    value: computeValue(type, entity, context),
    urgency: computeUrgency(type, entity, context),
    coherence: computeCoherence(type, entity, context),
    friction: computeFriction(type, entity, context)
  };
  const raw = (weights.need * axes.need)
    + (weights.value * axes.value)
    + (weights.urgency * axes.urgency)
    + (weights.coherence * axes.coherence)
    - (weights.friction * axes.friction)
    + weights.bias;
  const score = normalizeScore(sigmoid(raw));
  const band = goldDecisionBand(score);
  const suggestedAction = entity.suggestedAction
    || (band.key === "alta" ? "agire ora" : band.key === "media" ? "programmare azione" : band.key === "bassa" ? "tenere monitorato" : "non agire ora");
  const explanation = entity.explanation
    || `Priorità ${band.label.toLowerCase()}: necessita ${Math.round(axes.need * 100)}%, valore ${Math.round(axes.value * 100)}%, urgenza ${Math.round(axes.urgency * 100)}%, coerenza ${Math.round(axes.coherence * 100)}%, frizione ${Math.round(axes.friction * 100)}%.`;
  return {
    entityType: type,
    score: Number(score.toFixed(3)),
    scorePercent: Math.round(score * 100),
    raw: Number(raw.toFixed(3)),
    axes: {
      need: Number(axes.need.toFixed(3)),
      value: Number(axes.value.toFixed(3)),
      urgency: Number(axes.urgency.toFixed(3)),
      coherence: Number(axes.coherence.toFixed(3)),
      friction: Number(axes.friction.toFixed(3))
    },
    weights,
    priorityBand: band.key,
    priorityLabel: band.label,
    explanation,
    suggestedAction
  };
}

function confidenceBand(confidence) {
  const value = Number(confidence || 0);
  if (value < 0.4) return { key: "bassa", label: "Bassa affidabilità" };
  if (value < 0.65) return { key: "media", label: "Affidabilità media" };
  return { key: "buona", label: "Buona affidabilità" };
}

function computeGoldDecisionControlMetrics(goldDecision = {}, options = {}) {
  const factors = goldDecision.axes || {};
  const coherence = normalizeScore(factors.coherence ?? options.coherence ?? 0);
  const friction = normalizeScore(factors.friction ?? options.friction ?? 0);
  const dataQuality = normalizeScore(options.dataQuality ?? coherence);
  const value = normalizeScore(factors.value ?? options.value ?? 0);
  const phi = normalizeScore(goldDecision.score || 0);
  const confidence = normalizeScore((0.45 * coherence) + (0.35 * (1 - friction)) + (0.20 * dataQuality));
  const pSuccess = normalizeScore(coherence * (1 - friction));
  const expectedValue = normalizeScore(pSuccess * value);
  const risk = normalizeScore(options.risk ?? friction);
  const riskAdjustedPriority = normalizeScore(phi * confidence * (1 - risk));
  const band = confidenceBand(confidence);
  return {
    confidence: Number(confidence.toFixed(3)),
    confidencePercent: Math.round(confidence * 100),
    confidenceBand: band.key,
    confidenceLabel: band.label,
    expectedValue: Number(expectedValue.toFixed(3)),
    expectedValuePercent: Math.round(expectedValue * 100),
    pSuccess: Number(pSuccess.toFixed(3)),
    risk: Number(risk.toFixed(3)),
    riskAdjustedPriority: Number(riskAdjustedPriority.toFixed(3)),
    riskAdjustedPriorityPercent: Math.round(riskAdjustedPriority * 100),
    dataQuality: Number(dataQuality.toFixed(3))
  };
}

function goldDecisionTone(confidence, friction) {
  const k = Number(confidence || 0);
  const f = Number(friction || 0);
  if (k >= 0.65 && f < 0.4) return "direct";
  if (k >= 0.5 && k < 0.65) return "consultative";
  return "soft";
}

function goldDecisionActionBand(action) {
  switch (String(action || "")) {
    case "ACT_NOW":
      return { key: "alta", label: "Azione prioritaria" };
    case "SUGGEST":
      return { key: "media", label: "Azione consigliata" };
    case "MONITOR":
      return { key: "bassa", label: "Monitorare" };
    case "STOP":
      return { key: "stop", label: "Non agire ora" };
    case "VERIFY":
    default:
      return { key: "verify", label: "Da verificare" };
  }
}

function applyGoldDecisionMatrixV1(goldDecision = {}, control = {}, meta = {}) {
  const factors = goldDecision.axes || {};
  const need = normalizeScore(factors.need ?? meta.need ?? 0);
  const friction = normalizeScore(factors.friction ?? meta.friction ?? 0);
  const confidence = normalizeScore(control.confidence ?? 0);
  const coherence = normalizeScore(factors.coherence ?? meta.coherence ?? 0);
  const phi = normalizeScore(goldDecision.score || 0);
  let riskAdjustedPriority = normalizeScore(control.riskAdjustedPriority ?? 0);
  let action = "";
  const rules = [];

  if (need < 0.2) {
    action = "MONITOR";
    riskAdjustedPriority = Math.min(riskAdjustedPriority, 0.49);
    rules.push("need_gate");
  }
  if (confidence < 0.4) {
    action = "VERIFY";
    rules.push("confidence_gate");
  }
  if (friction >= 0.7) {
    action = "STOP";
    riskAdjustedPriority = Math.min(riskAdjustedPriority, 0.49);
    rules.push("friction_gate");
  }

  if (!action) {
    if (riskAdjustedPriority >= 0.6 && confidence >= 0.65 && need >= 0.5 && friction < 0.4) {
      action = "ACT_NOW";
    } else if (riskAdjustedPriority >= 0.5 && confidence >= 0.5 && need >= 0.3) {
      action = "SUGGEST";
    } else if (confidence >= 0.5) {
      action = "MONITOR";
    } else {
      action = "VERIFY";
    }
  }

  const band = goldDecisionActionBand(action);
  const tone = goldDecisionTone(confidence, friction);
  return {
    matrixVersion: "gold_decision_matrix_v1",
    phi: Number(phi.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    coherence: Number(coherence.toFixed(3)),
    need: Number(need.toFixed(3)),
    friction: Number(friction.toFixed(3)),
    riskAdjustedPriority: Number(riskAdjustedPriority.toFixed(3)),
    riskAdjustedPriorityPercent: Math.round(riskAdjustedPriority * 100),
    action,
    tone,
    band: band.key,
    bandLabel: band.label,
    rules
  };
}

function clampSignedScore(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-1, Math.min(1, number));
}

function computeBayesianSuccessRate(stats = {}) {
  const successes = Number(stats.successes || 0);
  const failures = Number(stats.failures || 0);
  const alpha = GOLD_ENTERPRISE_BAYES_PRIOR.alpha + Math.max(0, successes);
  const beta = GOLD_ENTERPRISE_BAYES_PRIOR.beta + Math.max(0, failures);
  return normalizeScore(alpha / Math.max(alpha + beta, 1));
}

function allowedEnterpriseActions(item = {}) {
  const action = String(item.action || "");
  const friction = Number(item.factors?.friction || 0);
  const confidence = Number(item.confidenceTemporal ?? item.confidence ?? 0);
  const need = Number(item.factors?.need || 0);
  if (friction >= 0.70 || action === "STOP") return ["STOP", "VERIFY"];
  if (confidence < 0.40 || action === "VERIFY") return ["VERIFY", "MONITOR", "STOP"];
  if (need < 0.20) return ["MONITOR", "VERIFY", "STOP"];
  return ["ACT_NOW", "SUGGEST", "MONITOR", "VERIFY", "STOP"];
}

function simulateGoldEnterpriseActions(item = {}, enterprise = {}) {
  const allowed = allowedEnterpriseActions(item);
  const value = normalizeScore(item.factors?.value ?? 0);
  const need = normalizeScore(item.factors?.need ?? 0);
  const risk = normalizeScore(enterprise.risk ?? item.risk ?? 0);
  const pSuccess = normalizeScore(enterprise.pSuccessLearned ?? item.pSuccess ?? 0);
  const candidates = allowed.map((action) => {
    const actionMultiplier = action === "ACT_NOW" ? 1
      : action === "SUGGEST" ? 0.82
        : action === "MONITOR" ? 0.42
          : action === "VERIFY" ? 0.28
            : 0;
    const cost = Number(GOLD_ENTERPRISE_ACTION_COST[action] ?? 0.03);
    const estimatedSuccess = normalizeScore(pSuccess * actionMultiplier);
    const estimatedOutcome = clampSignedScore((estimatedSuccess * value) - (risk * 0.18) - cost);
    return {
      action,
      pSuccess: Number(estimatedSuccess.toFixed(3)),
      outcome: Number(estimatedOutcome.toFixed(3)),
      ev: Number(normalizeScore(estimatedSuccess * value * Math.max(0.25, need)).toFixed(3)),
      cost: Number(cost.toFixed(3))
    };
  }).sort((a, b) => Number(b.ev || 0) - Number(a.ev || 0) || Number(b.outcome || 0) - Number(a.outcome || 0));
  return {
    version: "gold_simulation_v1",
    mode: "base",
    candidates,
    bestAction: candidates[0]?.action || String(item.action || "MONITOR"),
    bestExpectedValue: Number(candidates[0]?.ev || 0),
    bestOutcome: Number(candidates[0]?.outcome || 0)
  };
}

function classifyClientRoutine(client, appointments, centerAverageFrequencyDays, nowMs = Date.now(), serviceById = new Map()) {
  const clientId = String(client?.id || "");
  const visits = relevantClientAppointments(appointments, clientId, nowMs);
  const lastVisit = visits[visits.length - 1] || null;
  const lastVisitAt = lastVisit?.startAt || client?.lastVisit || "";
  const lastVisitTime = lastVisitAt ? new Date(lastVisitAt).getTime() : NaN;
  const daysSinceLastVisit = Number.isFinite(lastVisitTime)
    ? Math.max(0, Math.floor((nowMs - lastVisitTime) / 86400000))
    : 999;
  const gaps = visitGapsDays(visits);
  const averageFrequencyDays = gaps.length
    ? Math.round(average(gaps))
    : Math.round(Number(centerAverageFrequencyDays || 45));
  const deviation = gaps.length && averageFrequencyDays
    ? average(gaps.map((gap) => Math.abs(gap - averageFrequencyDays))) / averageFrequencyDays
    : 1;
  const visitCount = visits.length;
  const clientType = visitCount <= 2
    ? "occasionale"
    : (visitCount >= 4 && deviation <= 0.65) || (visitCount >= 3 && averageFrequencyDays <= Number(centerAverageFrequencyDays || 45) * 1.35 && deviation <= 0.85)
      ? "abituale"
      : "saltuario";
  const lastService = lastVisit ? serviceById.get(String(lastVisit.serviceId || "")) : null;
  const serviceRoutine = expectedRecallRoutineFromService(lastService || lastVisit?.serviceName || lastVisit?.service || "", centerAverageFrequencyDays);
  const routineDays = serviceRoutine.maxDays;
  const outOfRoutineAfter = routineDays;
  const highRiskAfter = routineDays + 30;
  const lostAfter = routineDays + 90;
  const { recallStatus, recallStatusLabel, overdueDays } = classifyRecallStatus(daysSinceLastVisit, routineDays);
  const alertLevel = recallStatus === "a_rischio"
    ? "rischio"
    : recallStatus === "da_richiamare"
      ? "alert"
      : recallStatus === "perso" || recallStatus === "storico"
        ? recallStatus
        : "nessuno";
  return {
    clientType,
    visitCount,
    visits,
    lastVisit,
    lastVisitAt,
    daysSinceLastVisit,
    gaps,
    averageFrequencyDays,
    centerAverageFrequencyDays: Math.round(Number(centerAverageFrequencyDays || 45)),
    routineDays,
    expectedRoutineDays: routineDays,
    expectedRoutineRange: { minDays: serviceRoutine.minDays, maxDays: serviceRoutine.maxDays, label: serviceRoutine.label, key: serviceRoutine.key },
    recallStatus,
    recallStatusLabel,
    overdueDays,
    outOfRoutineAfter,
    highRiskAfter,
    lostAfter,
    lightThreshold: routineDays,
    alertLevel,
    hasRecallAlert: recallStatus === "da_richiamare" || recallStatus === "a_rischio",
    deviation: Number.isFinite(deviation) ? Number(deviation.toFixed(2)) : 1
  };
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function sanitizeFileName(value) {
  return String(value || "file")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "file";
}

function normalizePdfText(value) {
  const replacements = {
    "€": "EUR",
    "è": "e",
    "é": "e",
    "à": "a",
    "ì": "i",
    "ò": "o",
    "ù": "u",
    "È": "E",
    "É": "E",
    "À": "A",
    "Ì": "I",
    "Ò": "O",
    "Ù": "U",
    "’": "'",
    "“": "\"",
    "”": "\"",
    "–": "-"
  };
  return String(value || "").replace(/[€èéàìòùÈÉÀÌÒÙ’“”–]/g, (match) => replacements[match] || match);
}

function escapePdfText(value) {
  return normalizePdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfLine(value, limit = 92) {
  const words = normalizePdfText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = `${current} ${word}`.trim();
    if (next.length > limit && current) {
      lines.push(current);
      current = word;
      return;
    }
    current = next;
  });
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function writeSimplePdf(filePath, sections = []) {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 54;
  const pages = [];
  let current = [];
  let y = pageHeight - margin;
  const pushPage = () => {
    if (current.length) pages.push(current);
    current = [];
    y = pageHeight - margin;
  };
  sections.forEach((section) => {
    const style = section.style || "body";
    const lineHeight = style === "title" ? 24 : style === "heading" ? 18 : 14;
    const size = style === "title" ? 20 : style === "heading" ? 14 : 10;
    const wrapped = wrapPdfLine(section.text || "", style === "title" ? 56 : style === "heading" ? 74 : 92);
    const needed = wrapped.length * lineHeight + (style === "title" || style === "heading" ? 10 : 3);
    if (y - needed < margin) pushPage();
    wrapped.forEach((line) => {
      current.push({ style, size, text: line, y });
      y -= lineHeight;
    });
    y -= style === "title" || style === "heading" ? 8 : 3;
  });
  pushPage();

  const objects = [];
  const add = (content) => {
    objects.push(content);
    return objects.length;
  };
  const regularFont = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFont = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const contentIds = pages.map((page, pageIndex) => {
    const commands = ["BT"];
    page.forEach((line) => {
      const font = line.style === "body" ? "F1" : "F2";
      commands.push(`/${font} ${line.size} Tf ${margin} ${line.y} Td (${escapePdfText(line.text)}) Tj`);
      commands.push(`${-margin} ${-line.y} Td`);
    });
    commands.push(`/F1 8 Tf ${margin} 28 Td (Pagina ${pageIndex + 1} di ${pages.length} - SkinHarmony Smart Desk) Tj`);
    commands.push("ET");
    const stream = commands.join("\n");
    return add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  const pageIds = [];
  const pagesId = objects.length + contentIds.length + 1;
  contentIds.forEach((contentId) => {
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFont} 0 R /F2 ${boldFont} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });
  const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`);
  const chunks = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "latin1"));
  });
  const body = Buffer.concat(chunks);
  const xrefOffset = body.length;
  const xrefRows = offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n");
  const trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  fs.writeFileSync(filePath, Buffer.concat([body, Buffer.from(trailer, "latin1")]));
}

function splitName(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ")
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || typeof passwordHash !== "string") return false;
  const [scheme, salt, storedHash] = passwordHash.split(":");
  if (scheme !== "scrypt" || !salt || !storedHash) return false;
  const derivedHash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const left = Buffer.from(storedHash, "hex");
  const right = Buffer.from(derivedHash, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function clampNumber(value, fallback = 0, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const min = Number.isFinite(options.min) ? options.min : -Infinity;
  const max = Number.isFinite(options.max) ? options.max : Infinity;
  return Math.min(max, Math.max(min, numeric));
}

function cleanText(value, fallback = "", maxLength = 500) {
  const cleaned = String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLength);
}

function cleanEmail(value = "") {
  const email = cleanText(value, "", 180).toLowerCase();
  if (!email) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanPhone(value = "") {
  return String(value || "")
    .replace(/[^\d+]/g, "")
    .slice(0, 24);
}

function duplicateTokens(value = "") {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function tokenSimilarity(left = "", right = "") {
  const leftTokens = new Set(duplicateTokens(left));
  const rightTokens = new Set(duplicateTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function clientNameForDuplicate(client = {}) {
  return cleanText(`${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "", "", 180);
}

function mergeTextValues(...values) {
  return values
    .map((value) => cleanText(value || "", "", 2000))
    .filter(Boolean)
    .filter((value, index, source) => source.indexOf(value) === index)
    .join(" | ");
}

function idempotencyKey(payload = {}) {
  return cleanText(payload.idempotencyKey || payload.requestId || "", "", 120);
}

function rawProvided(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function assertValid(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEmailIfProvided(value, label = "Email") {
  if (rawProvided(value)) {
    assertValid(Boolean(cleanEmail(value)), `${label} non valida`);
  }
}

function assertPhoneIfProvided(value, label = "Telefono") {
  if (rawProvided(value)) {
    const cleaned = cleanPhone(value);
    assertValid(cleaned.length >= 7, `${label} non valido`);
  }
}

function assertDateTime(value, label = "Data") {
  const parsed = new Date(value);
  assertValid(Boolean(value) && !Number.isNaN(parsed.getTime()), `${label} non valida`);
}

function assertTime(value, label = "Orario") {
  assertValid(/^\d{2}:\d{2}$/.test(String(value || "")), `${label} non valido`);
}

function minutesFromTime(value) {
  const [hours = "0", minutes = "0"] = String(value || "00:00").split(":");
  return Number(hours) * 60 + Number(minutes);
}

function assertRange(value, label, options = {}) {
  const numeric = Number(value);
  assertValid(Number.isFinite(numeric), `${label} non valido`);
  if (Number.isFinite(options.min)) {
    assertValid(numeric >= options.min, `${label} sotto il minimo consentito`);
  }
  if (Number.isFinite(options.max)) {
    assertValid(numeric <= options.max, `${label} sopra il massimo consentito`);
  }
  return numeric;
}

function makeSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

function readBooleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function getTrialPaymentConfig() {
  return {
    method: "bank_transfer",
    enabled: readBooleanEnv("TRIAL_BANK_TRANSFER_ENABLED", true),
    configured: Boolean(process.env.TRIAL_BANK_ACCOUNT_HOLDER && process.env.TRIAL_BANK_IBAN),
    accountHolder: String(process.env.TRIAL_BANK_ACCOUNT_HOLDER || ""),
    iban: String(process.env.TRIAL_BANK_IBAN || ""),
    bankName: String(process.env.TRIAL_BANK_NAME || ""),
    bic: String(process.env.TRIAL_BANK_BIC || ""),
    reason: String(process.env.TRIAL_BANK_REASON || ""),
    supportEmail: String(process.env.TRIAL_SUPPORT_EMAIL || "")
  };
}

function isTrialEmailVerificationConfigured() {
  return Boolean(
    process.env.TRIAL_SMTP_HOST &&
    process.env.TRIAL_SMTP_PORT &&
    process.env.TRIAL_MAIL_FROM &&
    process.env.TRIAL_SMTP_USER &&
    process.env.TRIAL_SMTP_PASS
  );
}

function makeVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sanitizeUsername(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function slugifySegment(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

class DesktopMirrorService {
  constructor(options = {}) {
    this.persistenceAdapter = options.persistenceAdapter || null;
    ensureDir(DATA_DIR);
    ensureDir(EXPORTS_DIR);

    this.clientsRepository = this.createRepository("clients", []);
    this.appointmentsRepository = this.createRepository("appointments", []);
    this.servicesRepository = this.createRepository("services", []);
    this.staffRepository = this.createRepository("staff", []);
    this.shiftsRepository = this.createRepository("shifts", []);
    this.shiftTemplatesRepository = this.createRepository("shift_templates", []);
    this.resourcesRepository = this.createRepository("resources", []);
    this.inventoryRepository = this.createRepository("inventory", []);
    this.inventoryMovementsRepository = this.createRepository("inventory_movements", []);
    this.paymentsRepository = this.createRepository("payments", []);
    this.cashClosuresRepository = this.createRepository("cash_closures", []);
    this.treatmentsRepository = this.createRepository("treatments", []);
    this.protocolsRepository = this.createRepository("protocols", []);
    this.aiMarketingActionsRepository = this.createRepository("ai_marketing_actions", []);
    this.dashboardSnapshotsRepository = this.createRepository("dashboard_snapshots", []);
    this.goldStateRepository = this.createRepository("gold_state", []);
    this.goldDecisionHistoryRepository = this.createRepository("gold_decision_history", []);
    this.goldActionOutcomesRepository = this.createRepository("gold_action_outcomes", []);
    this.goldImportRepository = this.createRepository("gold_imports", []);
    this.whatsappMessagesRepository = this.createRepository("whatsapp_messages", []);
    this.usersRepository = this.createRepository("users", []);
    this.salesRepository = this.createRepository("sales", []);
    this.settingsRepository = this.createRepository("settings", defaultSettings);

    this.sessions = new Map();
    this.businessSnapshotCache = new Map();
    this.goldStateReadCache = new Map();
    this.analyticsCache = new Map();
    this.analyticsDirtyBlocks = new Map();
    this.dashboardRefreshLocks = new Set();
    this.appointmentsDayCache = new Map();
    this.progressiveIntelligenceLayer = new ProgressiveIntelligenceActivationLayer();
    this.fleetIntelligenceLayer = null;
    this.goldOnboardingEngine = null;
  }

  getGoldOnboardingEngine() {
    if (!this.goldOnboardingEngine) {
      this.goldOnboardingEngine = new GoldOnboardingEngine({
        service: this,
        importRepository: this.goldImportRepository
      });
    }
    return this.goldOnboardingEngine;
  }

  getFleetIntelligenceLayer() {
    if (!this.fleetIntelligenceLayer) {
      this.fleetIntelligenceLayer = new FleetIntelligenceLayer({
        usersRepository: this.usersRepository,
        goldStateRepository: this.goldStateRepository,
        settingsRepository: this.settingsRepository
      });
    }
    return this.fleetIntelligenceLayer;
  }

  getCenterId(session = null) {
    return String(session?.centerId || DEFAULT_CENTER_ID);
  }

  getCenterName(session = null) {
    return String(session?.centerName || DEFAULT_CENTER_NAME);
  }

  getCurrentIso() {
    return nowIso();
  }

  isSuperAdminSession(session = null) {
    return String(session?.role || "") === "superadmin";
  }

  normalizeUserAccount(user = {}) {
    const hasLegacyPlanlessAccount = !user.planType && !user.trialStartsAt && !user.trialEndsAt;
    const inferredPlanType = hasLegacyPlanlessAccount ? "active" : (String(user.role || "") === "superadmin" ? "active" : "trial");
    const planType = String(user.planType || inferredPlanType);
    const subscriptionPlan = String(user.subscriptionPlan || (String(user.role || "") === "superadmin" ? "gold" : "base"));
    const paymentStatus = String(user.paymentStatus || (planType === "active" ? "paid" : "pending"));
    const requestedSubscriptionPlan = ["base", "silver", "gold"].includes(String(user.requestedSubscriptionPlan || ""))
      ? String(user.requestedSubscriptionPlan)
      : "";
    const baseStatus = String(user.accountStatus || (planType === "active" ? "active" : "trial"));
    const trialDays = Number(user.trialDays || DEFAULT_TRIAL_DAYS);
    const trialStartsAt = user.trialStartsAt || (planType === "trial" ? user.createdAt || this.getCurrentIso() : "");
    const trialEndsAt = user.trialEndsAt || (planType === "trial" && trialStartsAt ? addDaysIso(trialStartsAt, trialDays) : "");
    const now = Date.now();
    const expiredByDate = planType === "trial" && trialEndsAt && new Date(trialEndsAt).getTime() < now;
    let accountStatus = baseStatus;
    if (planType === "active") {
      accountStatus = "active";
    } else if (["pending_verification", "pending_payment"].includes(baseStatus)) {
      accountStatus = baseStatus;
    } else if (user.active === false) {
      accountStatus = "suspended";
    } else if (expiredByDate || baseStatus === "expired") {
      accountStatus = "expired";
    } else if (!accountStatus) {
      accountStatus = "trial";
    }
    const accessState = accountStatus === "active"
      ? "active"
      : accountStatus === "suspended"
        ? "suspended"
        : accountStatus === "expired"
          ? "expired"
          : accountStatus === "pending_verification"
            ? "pending_verification"
            : accountStatus === "pending_payment"
              ? "pending_payment"
              : "trial";
    const trialRemainingDays = accessState === "trial" && trialEndsAt
      ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now) / 86400000))
      : 0;
    return {
      ...user,
      planType,
      subscriptionPlan,
      requestedSubscriptionPlan,
      subscriptionChangeRequestedAt: String(user.subscriptionChangeRequestedAt || ""),
      subscriptionChangeStatus: String(user.subscriptionChangeStatus || (requestedSubscriptionPlan ? "pending" : "")),
      paymentStatus,
      accountStatus,
      accessState,
      trialDays,
      trialStartsAt,
      trialEndsAt,
      trialRemainingDays
    };
  }

  canOperate(session = null) {
    if (!session) return false;
    if (this.isSuperAdminSession(session)) return true;
    return session.accessState === "active" || session.accessState === "trial";
  }

  hasGoldIntelligence(session = null) {
    if (!session) return false;
    if (this.isSuperAdminSession(session) && !session.supportMode) return true;
    return String(session.subscriptionPlan || "").toLowerCase() === "gold";
  }

  getPlanLevel(session = null) {
    if (!session) return "base";
    if (this.isSuperAdminSession(session) && !session.supportMode) return "gold";
    const plan = String(session.subscriptionPlan || "").toLowerCase();
    return ["base", "silver", "gold"].includes(plan) ? plan : "base";
  }

  getBusinessSnapshotCacheKey(options = {}, session = null) {
    const centerId = this.getCenterId(session);
    const startDate = String(options.startDate || "");
    const endDate = String(options.endDate || "");
    return `${centerId}:${startDate}:${endDate}:${this.getPlanLevel(session)}`;
  }

  getAnalyticsCacheKey(block, options = {}, session = null) {
    const centerId = this.getCenterId(session);
    const startDate = String(options.startDate || "");
    const endDate = String(options.endDate || "");
    const mode = String(options.period || "");
    const anchorDate = String(options.anchorDate || "");
    const plan = this.getPlanLevel(session);
    return `${centerId}:${plan}:${block}:${startDate}:${endDate}:${mode}:${anchorDate}`;
  }

  getDirtyBlockSet(centerId = "") {
    const key = String(centerId || DEFAULT_CENTER_ID);
    if (!this.analyticsDirtyBlocks.has(key)) this.analyticsDirtyBlocks.set(key, new Set());
    return this.analyticsDirtyBlocks.get(key);
  }

  markAnalyticsBlocksStale(centerId = "", blocks = []) {
    const normalizedCenterId = String(centerId || DEFAULT_CENTER_ID);
    const normalizedBlocks = Array.from(new Set((Array.isArray(blocks) ? blocks : [blocks]).filter(Boolean)));
    if (!normalizedBlocks.length) return;
    const dirtySet = this.getDirtyBlockSet(normalizedCenterId);
    normalizedBlocks.forEach((block) => dirtySet.add(block));
    const prefix = `${normalizedCenterId}:`;
    Array.from(this.analyticsCache.keys()).forEach((key) => {
      if (!String(key).startsWith(prefix)) return;
      if (normalizedBlocks.some((block) => String(key).includes(`:${block}:`))) {
        this.analyticsCache.delete(key);
      }
    });
  }

  clearAnalyticsDirtyBlocks(centerId = "", blocks = []) {
    const dirtySet = this.getDirtyBlockSet(centerId);
    (Array.isArray(blocks) ? blocks : [blocks]).filter(Boolean).forEach((block) => dirtySet.delete(block));
  }

  getCachedAnalyticsBlock(block, options = {}, session = null) {
    const centerId = this.getCenterId(session);
    const dirtySet = this.getDirtyBlockSet(centerId);
    if (dirtySet.has(block)) return null;
    const key = this.getAnalyticsCacheKey(block, options, session);
    const cached = this.analyticsCache.get(key);
    if (!cached || cached.expiresAtMs <= Date.now()) {
      this.analyticsCache.delete(key);
      return null;
    }
    return {
      ...cached.value,
      meta: {
        ...(cached.value?.meta || {}),
        cached: true,
        cacheAgeMs: Date.now() - cached.createdAtMs,
        cacheBlock: block
      }
    };
  }

  setCachedAnalyticsBlock(block, options = {}, session = null, value = {}, ttlMs = ANALYTICS_CACHE_TTL_MS) {
    const centerId = this.getCenterId(session);
    const key = this.getAnalyticsCacheKey(block, options, session);
    this.analyticsCache.set(key, {
      value,
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + ttlMs
    });
    this.clearAnalyticsDirtyBlocks(centerId, block);
    return value;
  }

  dirtyBlocksForRepository(repository) {
    if (repository === this.clientsRepository) {
      return [
        ANALYTICS_BLOCKS.CLIENTS_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY,
        ANALYTICS_BLOCKS.RECALL_PRIORITY,
        ANALYTICS_BLOCKS.MARKETING_RECALL,
        ANALYTICS_BLOCKS.OPERATIONAL_REPORT,
        ANALYTICS_BLOCKS.CENTER_HEALTH
      ];
    }
    if (repository === this.appointmentsRepository) {
      return [
        ANALYTICS_BLOCKS.APPOINTMENTS_QUALITY,
        ANALYTICS_BLOCKS.PAYMENTS_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY,
        ANALYTICS_BLOCKS.RECALL_PRIORITY,
        ANALYTICS_BLOCKS.MARKETING_RECALL,
        ANALYTICS_BLOCKS.OPERATIONAL_REPORT,
        ANALYTICS_BLOCKS.CENTER_HEALTH,
        ANALYTICS_BLOCKS.PROFITABILITY,
        ANALYTICS_BLOCKS.PROFITABILITY_SUMMARY,
        ANALYTICS_BLOCKS.PAYMENT_ISSUES
      ];
    }
    if (repository === this.paymentsRepository) {
      return [
        ANALYTICS_BLOCKS.PAYMENTS_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY,
        ANALYTICS_BLOCKS.PAYMENT_ISSUES,
        ANALYTICS_BLOCKS.OPERATIONAL_REPORT,
        ANALYTICS_BLOCKS.CENTER_HEALTH,
        ANALYTICS_BLOCKS.PROFITABILITY,
        ANALYTICS_BLOCKS.PROFITABILITY_SUMMARY
      ];
    }
    if (repository === this.servicesRepository) {
      return [
        ANALYTICS_BLOCKS.SERVICES_QUALITY,
        ANALYTICS_BLOCKS.PROFITABILITY_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY,
        ANALYTICS_BLOCKS.PROFITABILITY,
        ANALYTICS_BLOCKS.PROFITABILITY_SUMMARY,
        ANALYTICS_BLOCKS.OPERATIONAL_REPORT,
        ANALYTICS_BLOCKS.MARKETING_RECALL
      ];
    }
    if (repository === this.staffRepository) {
      return [
        ANALYTICS_BLOCKS.OPERATORS_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY,
        ANALYTICS_BLOCKS.OPERATOR_SIGNALS,
        ANALYTICS_BLOCKS.OPERATIONAL_REPORT,
        ANALYTICS_BLOCKS.CENTER_HEALTH,
        ANALYTICS_BLOCKS.PROFITABILITY
      ];
    }
    if (repository === this.shiftsRepository || repository === this.shiftTemplatesRepository) {
      return [ANALYTICS_BLOCKS.SHIFT_SIGNALS, ANALYTICS_BLOCKS.OPERATOR_SIGNALS];
    }
    if (repository === this.inventoryRepository || repository === this.inventoryMovementsRepository || repository === this.resourcesRepository) {
      return [
        ANALYTICS_BLOCKS.INVENTORY_QUALITY,
        ANALYTICS_BLOCKS.PROFITABILITY_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY,
        ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY,
        ANALYTICS_BLOCKS.INVENTORY_OVERVIEW,
        ANALYTICS_BLOCKS.PROFITABILITY,
        ANALYTICS_BLOCKS.PROFITABILITY_SUMMARY
      ];
    }
    return [
      ANALYTICS_BLOCKS.DATA_QUALITY,
      ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY,
      ANALYTICS_BLOCKS.OPERATIONAL_REPORT,
      ANALYTICS_BLOCKS.PROFITABILITY,
      ANALYTICS_BLOCKS.MARKETING_RECALL,
      ANALYTICS_BLOCKS.GOLD_STATE
    ];
  }

  invalidateBusinessSnapshot(centerId = "", blocks = []) {
    const dirtyBlocks = Array.isArray(blocks) && blocks.length ? blocks : [
      ANALYTICS_BLOCKS.DATA_QUALITY,
      ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY,
      ANALYTICS_BLOCKS.OPERATIONAL_REPORT,
      ANALYTICS_BLOCKS.PROFITABILITY,
      ANALYTICS_BLOCKS.PROFITABILITY_SUMMARY,
      ANALYTICS_BLOCKS.PAYMENT_ISSUES,
      ANALYTICS_BLOCKS.MARKETING_RECALL,
      ANALYTICS_BLOCKS.GOLD_STATE,
      ANALYTICS_BLOCKS.CENTER_HEALTH,
      ANALYTICS_BLOCKS.INVENTORY_OVERVIEW,
      ANALYTICS_BLOCKS.OPERATOR_SIGNALS
    ];
    if (!centerId) {
      this.businessSnapshotCache.clear();
      this.analyticsCache.clear();
      this.analyticsDirtyBlocks.clear();
      return;
    }
    const normalizedCenterId = String(centerId || DEFAULT_CENTER_ID);
    this.markAnalyticsBlocksStale(normalizedCenterId, dirtyBlocks);
    const prefix = `${normalizedCenterId}:`;
    Array.from(this.businessSnapshotCache.keys()).forEach((key) => {
      if (String(key).startsWith(prefix)) this.businessSnapshotCache.delete(key);
    });
    this.goldStateReadCache.delete(normalizedCenterId);
  }

  getGoldStateRecordId(centerId = "") {
    return `gold_state:${String(centerId || DEFAULT_CENTER_ID)}`;
  }

  buildDefaultGoldState(centerId = "", centerName = "") {
    return {
      id: this.getGoldStateRecordId(centerId),
      version: "corelia_state_v1",
      centerId: String(centerId || DEFAULT_CENTER_ID),
      centerName: String(centerName || DEFAULT_CENTER_NAME),
      updatedAt: nowIso(),
      lastEvent: null,
      eventSeq: 0,
      components: {
        Rev: 0,
        U: 0,
        Sat: 0,
        Act: 0,
        Cont: 0,
        Ticket: 0,
        Prod: 0,
        DQ: 1,
        CostConf: 1,
        Margin: 0,
        Conf: 1
      },
      counters: {
        revenueTotalCents: 0,
        paymentCount: 0,
        unlinkedPayments: 0,
        todayAppointments: 0,
        appointmentSlots: 24,
        clientsTotal: 0,
        activeClients: 0,
        clientsWithContact: 0,
        servicesTotal: 0,
        servicesWithPrice: 0,
        servicesWithCost: 0,
        staffActive: 0,
        staffTotal: 0,
        inventoryTotal: 0,
        lowStock: 0,
        marginTotal: 0,
        marginSamples: 0,
        profitabilityRevenueCents: 0,
        profitabilityCostCents: 0,
        profitabilityProfitCents: 0,
        profitabilitySamples: 0,
        profitabilityReal: 0,
        profitabilityStandard: 0,
        profitabilityEstimated: 0,
        profitabilityIncomplete: 0
      },
      dirty: {
        components: [],
        snapshots: [],
        signals: []
      },
      snapshots: {},
      signals: {},
      decision: null,
      decisionStability: {
        acceptedKey: "",
        candidateKey: "",
        candidateCount: 0,
        minPersistenceCycles: 2,
        switchedAt: ""
      },
      cashParallel: null,
      cashSelection: null,
      cashPrimarySnapshot: null,
      cashShadowSnapshot: null,
      dataQualityParallel: null,
      marketingParallel: null,
      graph: {
        eventToState: {
          appointment_created: ["Sat", "Prod"],
          appointment_updated: ["Sat", "Prod", "DQ"],
          appointment_deleted: ["Sat", "Prod"],
          client_created: ["Act", "Cont", "DQ"],
          client_updated: ["Act", "Cont", "DQ"],
          client_deleted: ["Act", "Cont", "DQ"],
          payment_created: ["Rev", "U", "Ticket", "Conf"],
          payment_updated: ["Rev", "U", "Ticket", "Conf"],
          service_created: ["CostConf", "Margin", "DQ"],
          service_updated: ["CostConf", "Margin", "DQ"],
          service_deleted: ["CostConf", "Margin", "DQ"],
          staff_created: ["Prod"],
          staff_updated: ["Prod"],
          staff_deleted: ["Prod"],
          inventory_created: ["DQ"],
          inventory_updated: ["DQ"],
          inventory_deleted: ["DQ"]
        },
        stateToSnapshot: {
          Rev: ["business", "profitability", "report"],
          U: ["business", "report"],
          Sat: ["business", "report"],
          Act: ["business", "report"],
          Cont: ["business", "report"],
          Ticket: ["business", "profitability", "report"],
          Prod: ["business", "report"],
          DQ: ["business", "profitability", "report"],
          CostConf: ["profitability"],
          Margin: ["profitability"],
          Conf: ["business", "profitability"]
        },
        snapshotToSignal: {
          business: ["operationalRisk", "centerBelowThreshold", "opportunity"],
          profitability: ["marginAnomaly", "dataReliability"],
          report: ["cashAnomaly", "productivitySignal"]
        }
      }
    };
  }

  getGoldState(session = null) {
    const centerId = this.getCenterId(session);
    const recordId = this.getGoldStateRecordId(centerId);
    const existing = this.goldStateRepository.findById(recordId);
    if (existing) {
      const hasDirtyState = Boolean(
        (Array.isArray(existing.dirty?.components) && existing.dirty.components.length)
        || (Array.isArray(existing.dirty?.snapshots) && existing.dirty.snapshots.length)
        || (Array.isArray(existing.dirty?.signals) && existing.dirty.signals.length)
      );
      if (Number(existing.eventSeq || 0) <= 0) {
        const bootstrapped = this.bootstrapGoldStateFromRepositories(existing, session);
        if (bootstrapped) return bootstrapped;
      }
      if (!hasDirtyState) {
        return existing;
      }
      return this.refreshGoldDerivedState(existing, session);
    }
    const state = this.buildDefaultGoldState(centerId, this.getCenterName(session));
    const bootstrapped = this.bootstrapGoldStateFromRepositories(state, session);
    if (bootstrapped) return bootstrapped;
    this.goldStateRepository.create(state);
    return this.refreshGoldDerivedState(state, session);
  }

  bootstrapGoldStateFromRepositories(baseState = {}, session = null) {
    if (this.getPlanLevel(session) !== "gold") return null;
    const centerId = this.getCenterId(session);
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const inventory = this.filterByCenter(this.inventoryRepository.list(), session);
    const resources = this.filterByCenter(this.resourcesRepository.list(), session);
    const hasData = clients.length + appointments.length + payments.length + services.length + staff.length + inventory.length > 0;
    if (!hasData) return null;
    const counters = {
      revenueTotalCents: payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0),
      paymentCount: payments.length,
      unlinkedPayments: payments.filter((item) => this.goldPaymentIsUnlinked(item)).length,
      todayAppointments: appointments.filter((item) => this.goldAppointmentActiveForToday(item)).length,
      appointmentSlots: Math.max(24, staff.filter((item) => item.active !== false).length * 8),
      clientsTotal: clients.length,
      activeClients: clients.filter((item) => this.goldClientIsActive(item)).length,
      clientsWithContact: clients.filter((item) => this.goldClientHasContact(item)).length,
      servicesTotal: services.length,
      servicesWithPrice: services.filter((item) => this.goldServiceHasPrice(item)).length,
      servicesWithCost: services.filter((item) => this.goldServiceHasCost(item)).length,
      staffActive: staff.filter((item) => item.active !== false).length,
      staffTotal: staff.length,
      inventoryTotal: inventory.length,
      lowStock: inventory.filter((item) => this.goldInventoryIsLow(item)).length,
      marginTotal: 0,
      marginSamples: 0
    };
    this.applyGoldProfitabilityCoreCounters(counters, { appointments, services, staff, payments, inventory, resources });
    const next = this.refreshGoldDerivedState({
      ...this.buildDefaultGoldState(centerId, this.getCenterName(session)),
      ...baseState,
      id: this.getGoldStateRecordId(centerId),
      centerId,
      centerName: this.getCenterName(session),
      eventSeq: 1,
      lastEvent: {
        type: "bootstrap_existing_data",
        at: nowIso(),
        reason: "one_time_state_initialization"
      },
      counters,
      updatedAt: nowIso()
    }, session);
    if (this.goldStateRepository.findById(next.id)) {
      this.goldStateRepository.update(next.id, () => next);
    } else {
      this.goldStateRepository.create(next);
    }
    console.log("[gold_state_bootstrap]", JSON.stringify({
      centerId,
      eventSeq: next.eventSeq,
      clients: clients.length,
      appointments: appointments.length,
      payments: payments.length,
      services: services.length
    }));
    return next;
  }

  findUserForGoldStateRebuild(payload = {}) {
    const centerId = String(payload.centerId || "").trim();
    const username = String(payload.username || "").trim().toLowerCase();
    const query = String(payload.query || "").trim().toLowerCase();
    const users = this.usersRepository.list();
    return users.find((user) => {
      if (centerId && String(user.centerId || "") === centerId) return true;
      if (username && String(user.username || "").toLowerCase() === username) return true;
      if (query) {
        const haystack = [
          user.username,
          user.centerName,
          user.businessName,
          user.contactEmail,
          user.ownerName
        ].join(" ").toLowerCase();
        return query.split(/\s+/).filter(Boolean).every((part) => haystack.includes(part));
      }
      return false;
    });
  }

  buildGoldStateRebuildSession(user = {}) {
    const normalized = this.normalizeUserAccount(user);
    return {
      userId: normalized.id,
      username: normalized.username,
      role: normalized.role || "owner",
      centerId: normalized.centerId || DEFAULT_CENTER_ID,
      centerName: normalized.centerName || DEFAULT_CENTER_NAME,
      subscriptionPlan: normalized.subscriptionPlan || "base",
      planType: normalized.planType || "active",
      paymentStatus: normalized.paymentStatus || "paid",
      accountStatus: normalized.accountStatus || "active",
      accessState: normalized.accessState || "active",
      supportMode: true
    };
  }

  buildGoldStateCountersFromRepositories(session = null) {
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const inventory = this.filterByCenter(this.inventoryRepository.list(), session);
    const resources = this.filterByCenter(this.resourcesRepository.list(), session);
    const counters = {
      revenueTotalCents: payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0),
      paymentCount: payments.length,
      unlinkedPayments: payments.filter((item) => this.goldPaymentIsUnlinked(item)).length,
      todayAppointments: appointments.filter((item) => this.goldAppointmentActiveForToday(item)).length,
      appointmentSlots: Math.max(24, staff.filter((item) => item.active !== false).length * 8),
      clientsTotal: clients.length,
      activeClients: clients.filter((item) => this.goldClientIsActive(item)).length,
      clientsWithContact: clients.filter((item) => this.goldClientHasContact(item)).length,
      servicesTotal: services.length,
      servicesWithPrice: services.filter((item) => this.goldServiceHasPrice(item)).length,
      servicesWithCost: services.filter((item) => this.goldServiceHasCost(item)).length,
      staffActive: staff.filter((item) => item.active !== false).length,
      staffTotal: staff.length,
      inventoryTotal: inventory.length,
      lowStock: inventory.filter((item) => this.goldInventoryIsLow(item)).length,
      marginTotal: 0,
      marginSamples: 0
    };
    this.applyGoldProfitabilityCoreCounters(counters, { appointments, services, staff, payments, inventory, resources });
    return {
      counters,
      rawCounts: {
        clients: clients.length,
        appointments: appointments.length,
        payments: payments.length,
        services: services.length,
        staff: staff.length,
        inventory: inventory.length
      }
    };
  }

  compareGoldStateToRaw(state = {}, session = null) {
    const rebuilt = this.refreshGoldDerivedState({
      ...this.buildDefaultGoldState(this.getCenterId(session), this.getCenterName(session)),
      counters: this.buildGoldStateCountersFromRepositories(session).counters
    }, session);
    const metrics = [
      ["Rev", rebuilt.components?.Rev, state.components?.Rev, 0],
      ["U", rebuilt.components?.U, state.components?.U, 0],
      ["Sat", rebuilt.components?.Sat, state.components?.Sat, 0.0001],
      ["Act", rebuilt.components?.Act, state.components?.Act, 0],
      ["Cont", rebuilt.components?.Cont, state.components?.Cont, 0.0001],
      ["Ticket", rebuilt.components?.Ticket, state.components?.Ticket, 1],
      ["Prod", rebuilt.components?.Prod, state.components?.Prod, 0.0001],
      ["DQ", rebuilt.components?.DQ, state.components?.DQ, 0.0001],
      ["CostConf", rebuilt.components?.CostConf, state.components?.CostConf, 0.0001],
      ["Margin", rebuilt.components?.Margin, state.components?.Margin, 0.0001],
      ["Conf", rebuilt.components?.Conf, state.components?.Conf, 0.0001]
    ].map(([metric, rawValue, stateValue, tolerance]) => {
      const diff = Math.abs(Number(rawValue || 0) - Number(stateValue || 0));
      return {
        metric,
        raw: rawValue,
        state: stateValue,
        diff: this.goldRound(diff, 6),
        tolerance,
        ok: diff <= tolerance
      };
    });
    return {
      valid: metrics.every((item) => item.ok),
      metrics,
      diffSummary: metrics.reduce((acc, item) => {
        if (!item.ok) acc[item.metric] = item.diff;
        return acc;
      }, {})
    };
  }

  rebuildGoldStateForTenant(payload = {}, adminSession = null) {
    if (!this.isSuperAdminSession(adminSession)) {
      throw new Error("Rebuild Gold State riservato al super admin");
    }
    const user = this.findUserForGoldStateRebuild(payload);
    assertValid(Boolean(user), "Tenant Gold non trovato per rebuild");
    const normalized = this.normalizeUserAccount(user);
    assertValid(String(normalized.subscriptionPlan || "").toLowerCase() === "gold", "Il rebuild Gold State è disponibile solo per tenant Gold");
    const targetSession = this.buildGoldStateRebuildSession(normalized);
    const centerId = this.getCenterId(targetSession);
    const recordId = this.getGoldStateRecordId(centerId);
    const startedAt = nowIso();
    console.log("[gold_state_rebuild]", JSON.stringify({
      centerId,
      phase: "rebuild_start",
      rebuiltAt: startedAt,
      requestedBy: adminSession?.username || ""
    }));
    const existing = this.goldStateRepository.findById(recordId);
    const { counters, rawCounts } = this.buildGoldStateCountersFromRepositories(targetSession);
    const rawEventSeq = Object.values(rawCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    const eventSeq = Math.max(1, Number(existing?.eventSeq || 0), rawEventSeq);
    const rebuilt = this.refreshGoldDerivedState({
      ...this.buildDefaultGoldState(centerId, this.getCenterName(targetSession)),
      id: recordId,
      centerId,
      centerName: this.getCenterName(targetSession),
      eventSeq,
      counters,
      dirty: {
        components: ["Rev", "U", "Sat", "Act", "Cont", "Ticket", "Prod", "DQ", "CostConf", "Margin", "Conf"],
        snapshots: ["business", "profitability", "report"],
        signals: ["operationalRisk", "centerBelowThreshold", "opportunity", "cashAnomaly", "marginAnomaly", "dataReliability", "productivitySignal"]
      },
      metadata: {
        ...(existing?.metadata || {}),
        version: "gold_state_rebuild_v1",
        rebuiltAt: startedAt,
        rebuiltFromRaw: true,
        rebuildMode: "manual_tenant_reconciliation",
        previousEventSeq: Number(existing?.eventSeq || 0),
        rawCounts,
        valid: true
      },
      lastEvent: {
        type: "rebuild_initial_state",
        at: startedAt,
        reason: "manual_tenant_reconciliation",
        previousEventSeq: Number(existing?.eventSeq || 0)
      },
      updatedAt: startedAt
    }, targetSession);
    const validation = this.compareGoldStateToRaw(rebuilt, targetSession);
    rebuilt.metadata = {
      ...(rebuilt.metadata || {}),
      valid: validation.valid,
      validation
    };
    const saved = this.goldStateRepository.findById(recordId)
      ? this.goldStateRepository.update(recordId, () => rebuilt)
      : this.goldStateRepository.create(rebuilt);
    const progressiveIntelligence = this.recomputeProgressiveIntelligenceStatus(targetSession, {
      reason: "gold_state_rebuild",
      force: true
    });
    console.log("[gold_state_rebuild]", JSON.stringify({
      centerId,
      phase: "rebuild_complete",
      metricsCompared: validation.metrics.map((item) => item.metric),
      diffSummary: validation.diffSummary,
      valid: validation.valid,
      rebuiltAt: startedAt,
      eventSeq
    }));
    return {
      success: true,
      centerId,
      centerName: this.getCenterName(targetSession),
      username: normalized.username || "",
      eventSeq,
      rawCounts,
      valid: validation.valid,
      validation,
      progressiveIntelligence,
      state: saved || rebuilt
    };
  }

  rebuildGoldStateForCurrentGoldTenant(session = null, options = {}) {
    this.assertCanOperate(session);
    assertValid(this.getPlanLevel(session) === "gold", "Gold Onboarding disponibile solo per tenant Gold");
    const centerId = this.getCenterId(session);
    const recordId = this.getGoldStateRecordId(centerId);
    const startedAt = nowIso();
    const existing = this.goldStateRepository.findById(recordId);
    const { counters, rawCounts } = this.buildGoldStateCountersFromRepositories(session);
    const rawEventSeq = Object.values(rawCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    const eventSeq = Math.max(1, Number(existing?.eventSeq || 0), rawEventSeq);
    const rebuilt = this.refreshGoldDerivedState({
      ...this.buildDefaultGoldState(centerId, this.getCenterName(session)),
      id: recordId,
      centerId,
      centerName: this.getCenterName(session),
      eventSeq,
      counters,
      metadata: {
        ...(existing?.metadata || {}),
        version: "gold_state_rebuild_v1",
        rebuiltAt: startedAt,
        rebuiltFromRaw: true,
        rebuildMode: "gold_onboarding_reconciliation",
        reason: options.reason || "gold_onboarding_import",
        importId: options.importId || "",
        previousEventSeq: Number(existing?.eventSeq || 0),
        rawCounts,
        valid: true
      },
      lastEvent: {
        type: "rebuild_after_gold_onboarding",
        at: startedAt,
        reason: options.reason || "gold_onboarding_import",
        importId: options.importId || "",
        previousEventSeq: Number(existing?.eventSeq || 0)
      },
      updatedAt: startedAt
    }, session);
    const validation = this.compareGoldStateToRaw(rebuilt, session);
    rebuilt.metadata = {
      ...(rebuilt.metadata || {}),
      valid: validation.valid,
      validation
    };
    const saved = this.goldStateRepository.findById(recordId)
      ? this.goldStateRepository.update(recordId, () => rebuilt)
      : this.goldStateRepository.create(rebuilt);
    const progressiveIntelligence = this.recomputeProgressiveIntelligenceStatus(session, {
      reason: options.reason || "gold_onboarding_import",
      force: true
    });
    console.log("[gold_onboarding_rebuild]", JSON.stringify({
      centerId,
      importId: options.importId || "",
      valid: validation.valid,
      eventSeq,
      diffSummary: validation.diffSummary
    }));
    return {
      success: true,
      centerId,
      eventSeq,
      rawCounts,
      valid: validation.valid,
      validation,
      progressiveIntelligence,
      state: saved || rebuilt
    };
  }

  analyzeGoldOnboardingImport(payload = {}, session = null) {
    this.assertCanOperate(session);
    assertValid(this.getPlanLevel(session) === "gold", "Gold Onboarding disponibile solo per tenant Gold");
    return this.getGoldOnboardingEngine().analyze(payload, session);
  }

  confirmGoldOnboardingImport(payload = {}, session = null) {
    this.assertCanOperate(session);
    assertValid(this.getPlanLevel(session) === "gold", "Gold Onboarding disponibile solo per tenant Gold");
    return this.getGoldOnboardingEngine().confirm(payload, session);
  }

  listGoldOnboardingImports(session = null) {
    this.assertCanOperate(session);
    assertValid(this.getPlanLevel(session) === "gold", "Gold Onboarding disponibile solo per tenant Gold");
    return this.getGoldOnboardingEngine().list(session);
  }

  getProgressiveIntelligenceRawContext(session = null) {
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const inventory = this.filterByCenter(this.inventoryRepository.list(), session);
    const dates = [
      ...appointments.map((item) => item.startAt || item.createdAt || ""),
      ...payments.map((item) => item.createdAt || ""),
      ...clients.map((item) => item.lastVisit || item.createdAt || "")
    ]
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value) && value > 0);
    const oldest = dates.length ? Math.min(...dates) : Date.now();
    const newest = dates.length ? Math.max(...dates) : Date.now();
    const historyMonths = dates.length > 1 ? Math.max(0, (newest - oldest) / (1000 * 60 * 60 * 24 * 30.4375)) : 0;
    return {
      rawCounts: {
        clients: clients.length,
        appointments: appointments.length,
        payments: payments.length,
        services: services.length,
        staff: staff.length,
        inventory: inventory.length
      },
      historyMonths,
      oldestDate: dates.length ? new Date(oldest).toISOString() : "",
      newestDate: dates.length ? new Date(newest).toISOString() : ""
    };
  }

  computeProgressiveIntelligenceStatus(session = null) {
    this.assertCanOperate(session);
    const centerId = this.getCenterId(session);
    const plan = this.getPlanLevel(session);
    const rawContext = this.getProgressiveIntelligenceRawContext(session);
    const goldState = plan === "gold" ? this.getGoldState(session) : null;
    const status = this.progressiveIntelligenceLayer.compute({
      centerId,
      plan,
      goldState,
      rawCounts: rawContext.rawCounts,
      historyMonths: rawContext.historyMonths
    });
    const result = {
      ...status,
      currentPlan: plan,
      centerName: this.getCenterName(session),
      historyMonths: this.goldRound(rawContext.historyMonths, 2),
      historyRange: {
        oldestDate: rawContext.oldestDate,
        newestDate: rawContext.newestDate
      },
      rawCounts: rawContext.rawCounts,
      goldStateEventSeq: Number(goldState?.eventSeq || 0)
    };
    if (plan === "gold") {
      result.pialDataQualityComparison = this.buildPialDataQualityComparison(goldState?.dataQualityParallel || null);
    }
    return result;
  }

  shouldUseCachedProgressiveIntelligence(cached = {}, goldState = null, maxAgeMs = 24 * 60 * 60 * 1000) {
    if (!cached || !cached.generatedAt) return false;
    const ageMs = Date.now() - new Date(cached.generatedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) return false;
    const cachedSeq = Number(cached.goldStateEventSeq || 0);
    const currentSeq = Number(goldState?.eventSeq || 0);
    return cachedSeq === currentSeq;
  }

  recomputeProgressiveIntelligenceStatus(session = null, options = {}) {
    const status = this.computeProgressiveIntelligenceStatus(session);
    const next = {
      ...status,
      cached: true,
      recomputeReason: options.reason || "manual_or_structural_trigger",
      persistedAt: nowIso()
    };
    if (String(status.currentPlan || "").toLowerCase() === "gold") {
      this.saveSettings({ progressiveIntelligenceStatus: next }, session);
    }
    console.log("[progressive_intelligence_recompute]", JSON.stringify({
      centerId: this.getCenterId(session),
      reason: next.recomputeReason,
      maturityScore: next.maturityScore,
      activationLevel: next.activationLevel,
      oracleEnabled: Boolean(next.oracle?.enabled),
      goldStateEventSeq: next.goldStateEventSeq
    }));
    return next;
  }

  getProgressiveIntelligenceStatus(session = null, options = {}) {
    this.assertCanOperate(session);
    const plan = this.getPlanLevel(session);
    if (plan !== "gold") return this.computeProgressiveIntelligenceStatus(session);
    const goldState = this.getGoldState(session);
    const cached = this.getSettings(session).progressiveIntelligenceStatus || null;
    if (!options.force && this.shouldUseCachedProgressiveIntelligence(cached, goldState)) {
      return {
        ...cached,
        cached: true,
        source: "batch_cache"
      };
    }
    return {
      ...this.recomputeProgressiveIntelligenceStatus(session, {
        reason: options.reason || "cache_miss_or_state_changed",
        force: true
      }),
      source: "recomputed"
    };
  }

  recomputeProgressiveIntelligenceForTenant(payload = {}, adminSession = null) {
    if (!this.isSuperAdminSession(adminSession)) {
      throw new Error("Recompute PIAL riservato al super admin");
    }
    const user = this.findUserForGoldStateRebuild(payload);
    assertValid(Boolean(user), "Tenant Gold non trovato per recompute PIAL");
    const normalized = this.normalizeUserAccount(user);
    assertValid(String(normalized.subscriptionPlan || "").toLowerCase() === "gold", "PIAL è disponibile solo per tenant Gold");
    const targetSession = this.buildGoldStateRebuildSession(normalized);
    return this.recomputeProgressiveIntelligenceStatus(targetSession, {
      reason: payload.reason || "admin_recompute"
    });
  }

  getFeatureActivation(status = {}, featureKey = "") {
    const enabled = (status.enabledFeatures || []).some((item) => item.key === featureKey);
    const blocked = (status.blockedFeatures || []).find((item) => item.key === featureKey);
    return {
      enabled,
      reason: enabled ? "" : blocked?.reason || "funzione non disponibile al livello dati corrente"
    };
  }

  getFleetOverview(session = null, filters = {}) {
    return this.getFleetIntelligenceLayer().getFleetOverview(session, filters);
  }

  getFleetMaturity(session = null, filters = {}) {
    return this.getFleetIntelligenceLayer().getFleetMaturity(session, filters);
  }

  getFleetOutliers(session = null, filters = {}) {
    return this.getFleetIntelligenceLayer().getFleetOutliers(session, filters);
  }

  getFleetAlerts(session = null, filters = {}) {
    return this.getFleetIntelligenceLayer().getFleetAlerts(session, filters);
  }

  getFleetPerformance(session = null, filters = {}) {
    return this.getFleetIntelligenceLayer().getFleetPerformance(session, filters);
  }

  getFleetOracleSummary(session = null, filters = {}) {
    return this.getFleetIntelligenceLayer().getFleetOracleSummary(session, filters);
  }

  getGoldStateDecision(session = null) {
    const state = this.getGoldState(session);
    return state?.decision ? {
      state,
      decision: state.decision
    } : null;
  }

  logGoldStateEndpoint(endpoint, session = null, payload = {}) {
    console.log(`[${endpoint}_source]`, JSON.stringify({
      centerId: this.getCenterId(session),
      endpoint,
      source: payload.source || "raw_fallback",
      valid: Boolean(payload.valid),
      reason: payload.reason || "",
      eventSeq: payload.eventSeq ?? null
    }));
  }

  getValidGoldStateSnapshot(snapshotKey = "", session = null) {
    if (this.getPlanLevel(session) !== "gold") {
      return { valid: false, reason: "not_gold" };
    }
    const state = this.getGoldState(session);
    const eventSeq = Number(state?.eventSeq || 0);
    if (!state || eventSeq <= 0) {
      return { valid: false, reason: "empty_state", state, eventSeq };
    }
    const snapshots = state.snapshots || {};
    const snapshot = snapshotKey ? snapshots[snapshotKey] : snapshots;
    if (!snapshot || (snapshotKey && snapshot.source !== "gold_state")) {
      return { valid: false, reason: "invalid_snapshot", state, eventSeq };
    }
    const confidence = Number(state.components?.Conf ?? snapshot.confidence ?? snapshot.economicConfidence ?? 0);
    if (Number.isFinite(confidence) && confidence < 0.15) {
      return { valid: false, reason: "drift_flag", state, snapshot, eventSeq };
    }
    return { valid: true, reason: "ok", state, snapshot, eventSeq };
  }

  buildGoldStateCenterHealth(state = {}) {
    const business = state.snapshots?.business || {};
    const revenueCents = Number(business.revenueCents || 0);
    const saturationPercent = Math.round(Number(business.agendaSaturation || 0) * 100);
    const continuityPercent = Math.round(Number(business.clientContinuity || 0) * 100);
    const confidencePercent = Math.round(Number(business.confidence || 0) * 100);
    const status = business.status === "centro_sotto_pressione"
      ? "fragile"
      : business.status === "dato_da_verificare"
        ? "sotto_soglia"
        : "stabile";
    return {
      source: "gold_state",
      status,
      statusLabel: status === "sotto_soglia" ? "da verificare" : status,
      level: status === "sotto_soglia" ? "warning" : status === "fragile" ? "warning" : "success",
      businessModel: "standard",
      period: { startDate: "", endDate: "", dayCount: 1, monthsEquivalent: 1 },
      thresholds: {},
      revenueCents,
      monthlyRevenueCents: revenueCents,
      revenuePerOperatorCents: 0,
      activeOperators: Number(state.counters?.staffActive || state.counters?.staffTotal || 0),
      appointments: Number(state.counters?.todayAppointments || 0),
      saturationPercent,
      activeClients: Number(business.activeClients || 0),
      returningClients: 0,
      continuityPercent,
      reason: `Gold State: saturazione ${saturationPercent}%, continuità ${continuityPercent}%, confidenza ${confidencePercent}%.`,
      note: "Lettura da Gold State Layer con fallback raw disponibile."
    };
  }

  shouldBypassGoldStateForWindow(options = {}) {
    const startDate = String(options.startDate || "").trim();
    const endDate = String(options.endDate || "").trim();
    const period = String(options.period || "").trim().toLowerCase();
    const anchorDate = toDateOnly(options.anchorDate || "");
    const today = toDateOnly(nowIso());
    if (startDate || endDate) return true;
    if (period && period !== "day") return true;
    if (period === "day" && anchorDate && anchorDate !== today) return true;
    return false;
  }

  buildDashboardStatsFromGoldState(options = {}, session = null) {
    if (this.shouldBypassGoldStateForWindow(options)) {
      return null;
    }
    const validState = this.getValidGoldStateSnapshot("business", session);
    if (!validState.valid) {
      this.logGoldStateEndpoint("dashboard", session, { source: "raw_fallback", ...validState });
      return null;
    }
    const state = validState.state;
    const business = state.snapshots?.business || {};
    const report = state.snapshots?.report || {};
    const payload = {
      todayAppointments: Number(state.counters?.todayAppointments || 0),
      inactiveClientsCount: 0,
      inactiveClients: [],
      centerAverageFrequencyDays: 45,
      completedAppointments: 0,
      confirmedAppointments: 0,
      arrivedAppointments: 0,
      inProgressAppointments: 0,
      readyCheckoutAppointments: 0,
      pendingConfirmations: 0,
      upcomingAppointments: Number(state.counters?.todayAppointments || 0),
      revenueCents: Number(business.revenueCents || 0),
      todayRevenueCents: Number(business.revenueCents || 0),
      activeClients: Number(business.activeClients || state.counters?.activeClients || 0),
      activeClientsCount: Number(business.activeClients || state.counters?.activeClients || 0),
      paymentSummary: {
        period: options.period || "day",
        startDate: toDateOnly(options.anchorDate || nowIso()),
        endDate: toDateOnly(options.anchorDate || nowIso()),
        totals: {
          count: Number(state.counters?.paymentCount || 0),
          revenueCents: Number(business.revenueCents || 0)
        },
        byMethod: [],
        byDay: [],
        recentPayments: []
      },
      dataQuality: {
        summaryOnly: true,
        score: Math.round(Number(report.dataQuality ?? business.dataQuality ?? 0) * 100),
        metrics: {
          unlinkedPayments: Number(business.unlinkedPayments || 0)
        },
        sourceLayer: "gold_state"
      },
      dashboardCache: {
        cached: true,
        source: "gold_state",
        generatedAt: state.updatedAt || nowIso(),
        ageMs: Math.max(0, Date.now() - new Date(state.updatedAt || nowIso()).getTime()),
        stale: false,
        autoRefreshMs: DASHBOARD_AUTO_REFRESH_MS,
        manualCooldownMs: DASHBOARD_MANUAL_COOLDOWN_MS,
        nextAutoRefreshAt: "",
        eventSeq: validState.eventSeq
      }
    };
    this.logGoldStateEndpoint("dashboard", session, { source: "gold_state", ...validState });
    return payload;
  }

  buildOperationalReportFromGoldState(options = {}, session = null) {
    if (this.shouldBypassGoldStateForWindow(options)) {
      return null;
    }
    const validState = this.getValidGoldStateSnapshot("report", session);
    if (!validState.valid) {
      this.logGoldStateEndpoint("report_operational", session, { source: "raw_fallback", ...validState });
      return null;
    }
    const state = validState.state;
    const report = state.snapshots?.report || {};
    const cashPrimary = state.cashPrimarySnapshot || null;
    const cashSelection = state.cashSelection || null;
    const startDate = toDateOnly(options.startDate || nowIso());
    const endDate = toDateOnly(options.endDate || startDate);
    const revenueCents = Number(cashPrimary?.reconciledCashCents ?? report.revenueCents ?? 0);
    const unlinkedCashCents = Number(cashPrimary?.unlinkedCashCents || 0) + Number(cashPrimary?.ambiguousCashCents || 0);
    const appointments = Number(state.counters?.todayAppointments || 0);
    const result = {
      period: String(options.period || "day"),
      generatedAt: nowIso(),
      dateLabel: startDate === endDate ? startDate : `${startDate} - ${endDate}`,
      totals: {
        appointments,
        completedAppointments: 0,
        cancelledAppointments: 0,
        noShowAppointments: 0,
        revenueCents,
        averageTicketCents: Number(report.averageTicketCents || 0),
        activeClients: Number(state.counters?.activeClients || 0),
        returningClients: 0,
        occasionalClients: 0,
        rebookingRate: Math.round(Number(report.continuity || 0) * 100)
      },
      timeline: [],
      topOperators: [],
      topServices: [],
      lowServices: [],
      topClientsBySpend: [],
      frequentClients: [],
      inactiveClients: [],
      technologyUsage: [],
      lowTechnologyUsage: [],
      insights: [
        `Report letto da Gold State Layer: incasso ${euro(revenueCents)}, ticket medio ${euro(report.averageTicketCents || 0)}.`,
        unlinkedCashCents > 0 ? `${euro(unlinkedCashCents)} da collegare o verificare.` : "Nessuna anomalia cassa aggregata nello stato."
      ],
      meta: {
        source: "gold_state",
        cashSource: cashPrimary?.sourceUsed || "legacy",
        cashSelection,
        eventSeq: validState.eventSeq,
        fallbackAvailable: true
      }
    };
    this.logGoldStateEndpoint("report_operational", session, { source: "gold_state", ...validState });
    return result;
  }

  buildProfitabilityOverviewFromGoldState(options = {}, session = null) {
    if (this.shouldBypassGoldStateForWindow(options)) {
      return null;
    }
    const validState = this.getValidGoldStateSnapshot("profitability", session);
    if (!validState.valid) {
      this.logGoldStateEndpoint("profitability_overview", session, { source: "raw_fallback", ...validState });
      return null;
    }
    const state = validState.state;
    const profitability = state.snapshots?.profitability || {};
    const revenueCents = Number(profitability.coreRevenueCents || profitability.revenueCents || 0);
    const marginRatio = Number(profitability.averageMargin || 0);
    const costCents = Number(profitability.coreCostCents || 0) || Math.round(revenueCents * Math.max(0, 1 - marginRatio));
    const profitCents = Number(profitability.coreProfitCents || 0) || Math.max(0, revenueCents - costCents);
    const confidenceValue = Number(profitability.profitabilityConfidence ?? Math.min(Number(profitability.economicConfidence || 0), Number(profitability.costConfidence || 0)));
    const servicesTotal = Number(state.counters?.servicesTotal || 0);
    const servicesWithCost = Number(state.counters?.servicesWithCost || 0);
    const profitabilityConfigBlocked = confidenceValue < 0.55 || (servicesTotal > 0 && servicesWithCost < servicesTotal);
    const status = profitabilityConfigBlocked
      ? "CONFIG_REQUIRED"
      : profitability.status === "margine_da_verificare"
      ? "LOW_MARGIN"
      : profitability.status === "margine_sotto_soglia"
        ? "LOW_MARGIN"
        : "HEALTHY";
    const aggregateService = {
      id: "gold-state-profitability",
      name: profitabilityConfigBlocked ? "Redditività da configurare" : "Margine aggregato centro",
      executions: Number(state.counters?.marginSamples || state.counters?.paymentCount || 0),
      revenueCents,
      costCents,
      profitCents,
      averageRevenueCents: Number(state.components?.Ticket || 0),
      averageCostCents: Number(state.components?.Ticket || 0) ? Math.round(Number(state.components.Ticket) * Math.max(0, 1 - marginRatio)) : 0,
      marginPercent: Math.round(marginRatio * 100),
      status
    };
    const result = {
      totals: {
        executions: aggregateService.executions,
        revenueCents,
        costCents,
        profitCents
      },
      confidence: {
        value: confidenceValue,
        label: profitability.confidenceLabel || "bassa"
      },
      centerHealth: this.buildGoldStateCenterHealth(state),
      services: [aggregateService],
      products: [],
      technologies: [],
      monthlyTrend: [],
      alerts: status === "HEALTHY" ? [] : [{
        area: "servizi",
        level: "warning",
        title: status === "CONFIG_REQUIRED" ? "Redditività da configurare" : profitability.status === "margine_da_verificare" ? "Margine da verificare" : "Margine sotto soglia",
        body: status === "CONFIG_REQUIRED"
          ? "Volume e pagamenti sono presenti, ma i costi non sono abbastanza completi per una lettura economica affidabile."
          : "Gold State segnala costo/confidenza non sufficienti per promuovere una lettura forte.",
        serviceId: aggregateService.id
      }],
      revenueCents,
      inventoryCostCents: costCents,
      meta: {
        source: "gold_state",
        mathCore: profitability.mathCore || "gold_state_aggregate",
        confidenceBreakdown: profitability.confidenceBreakdown || {},
        eventSeq: validState.eventSeq,
        fallbackAvailable: true,
        economicConfidence: Number(profitability.economicConfidence || 0),
        costConfidence: Number(profitability.costConfidence || 0),
        confidenceLabel: profitability.confidenceLabel || "bassa"
      }
    };
    this.logGoldStateEndpoint("profitability_overview", session, { source: "gold_state", ...validState });
    return result;
  }

  buildBusinessSnapshotFromGoldState(options = {}, session = null) {
    if (this.shouldBypassGoldStateForWindow(options)) {
      return null;
    }
    const validState = this.getValidGoldStateSnapshot("business", session);
    if (!validState.valid) {
      this.logGoldStateEndpoint("business_snapshot", session, { source: "raw_fallback", ...validState });
      return null;
    }
    const state = validState.state;
    const business = state.snapshots?.business || {};
    const marketingActions = state.marketingActions || this.buildGoldMarketingActionState(session);
    const report = this.buildOperationalReportFromGoldState(options, session) || {};
    const centerHealth = this.buildGoldStateCenterHealth(state);
    const profitability = this.buildProfitabilityOverviewFromGoldState(options, session) || {};
    const dataQualityScore = Math.round(Number(business.dataQuality || 0) * 100);
    const operatorSignals = Array.isArray(report.topOperators)
      ? report.topOperators.slice(0, 5).map((operator, index) => {
        const revenueCents = Number(operator.revenueCents || 0);
        const appointments = Number(operator.appointments || 0);
        return {
          id: operator.staffId || operator.operatorId || operator.name || `operator-${index + 1}`,
          label: operator.name || operator.operatorName || `Operatore ${index + 1}`,
          output: index === 0 ? "benchmark operativo" : "operatore da monitorare",
          target: "shifts",
          appointments,
          revenueCents
        };
      })
      : [];
    const topOperator = report.topOperators?.[0] || report.topOperator || null;
    const weakOperator = report.weakOperator || (Array.isArray(report.topOperators) ? report.topOperators.slice().reverse()[0] : null) || null;
    const snapshot = {
      snapshotAvailable: true,
      snapshotVersion: "1.0",
      sourceLayer: "gold_state",
      generatedAt: state.updatedAt || nowIso(),
      expiresAt: "",
      plan: this.getPlanLevel(session),
      period: {
        startDate: String(options.startDate || ""),
        endDate: String(options.endDate || "")
      },
      meta: {
        cached: true,
        cacheTtlMs: SNAPSHOT_CACHE_TTL_MS,
        freshness: "state",
        rule: "Gold State Layer primario con fallback raw disponibile.",
        dirtyBlocks: Array.from(this.getDirtyBlockSet(this.getCenterId(session))),
        source: "gold_state",
        eventSeq: validState.eventSeq
      },
      core: {
        appointments: Number(state.counters?.todayAppointments || 0),
        treatments: 0,
        protocols: 0,
        technologies: 0
      },
      report: {
        operational: report,
        centerHealth
      },
      marketing: {
        goldEnabled: true,
        generatedAt: state.updatedAt || nowIso(),
        suggestions: marketingActions.actions || [],
        actions: marketingActions.actions || [],
        priorityClients: marketingActions.actions || [],
        lostClients: [],
        historicInactiveClients: [],
        focusClient: (marketingActions.actions || [])[0] || null,
        counts: {
          priority: marketingActions.counters?.totalActions || 0,
          lost: 0,
          historic: 0,
          avoid: marketingActions.debug?.excludedByFilter || 0,
          waiting: marketingActions.counters?.toApprove || 0
        },
        kpis: {
          recommendedToday: marketingActions.counters?.totalActions || 0,
          avoidToday: marketingActions.debug?.excludedByFilter || 0,
          waiting: marketingActions.counters?.toApprove || 0,
          opportunitiesActive: marketingActions.counters?.approvedActions || 0,
          callableApproved: marketingActions.counters?.callableApproved || 0,
          clientsAtRiskToday: marketingActions.counters?.clientsAtRiskToday || 0
        },
        debug: marketingActions.debug || {},
        counters: marketingActions.counters || {},
        sourceLayer: "gold_state"
      },
      profitability,
      inventory: {
        lowStock: [],
        items: [],
        summary: {
          total: Number(state.counters?.inventoryTotal || 0),
          lowStock: Number(state.counters?.lowStock || 0)
        },
        sourceLayer: "gold_state"
      },
      dataQuality: {
        summaryOnly: true,
        score: dataQualityScore,
        metrics: {
          unlinkedPayments: Number(business.unlinkedPayments || 0)
        },
        sourceLayer: "gold_state"
      },
      economic: {
        sourceLayer: "gold_state",
        operationalRevenueCents: Number(business.revenueCents || 0),
        cashRevenueCents: Number(business.revenueCents || 0),
        gapCents: 0,
        confidence: Number(business.confidence || 0),
        status: Number(business.unlinkedPayments || 0) > 0 ? "incasso_da_verificare" : "sistema_allineato",
        action: Number(business.unlinkedPayments || 0) > 0 ? "VERIFY" : "OK"
      },
      goldEngine: {
        engineName: "Corelia",
        runtimeStack: ["V0", "V2", "V7"],
        engineLayer: "gold_decision_engine",
        engineVersion: "corelia_state_v1",
        enterpriseLayer: "corelia_enterprise_v1",
        rule: "Gold legge Gold State Layer e mantiene fallback raw.",
        inventory: {
          source: "gold_state",
          summary: {
            total: Number(state.counters?.inventoryTotal || 0),
            lowStock: Number(state.counters?.lowStock || 0),
            status: Number(state.counters?.lowStock || 0) > 0 ? "sottoscorta_attiva" : "stock_stabile"
          }
        },
        operators: {
          source: "gold_state",
          items: operatorSignals,
          summary: {
            total: operatorSignals.length,
            topOperator: topOperator?.name || topOperator?.operatorName || "",
            weakOperator: weakOperator?.name || weakOperator?.operatorName || "",
            status: operatorSignals.length ? "operators_visible_in_state" : "nessun_operatore"
          }
        },
        dashboard: {
          source: "gold_state",
          items: [],
          primaryAction: state.decision?.primaryAction
            ? {
              ...state.decision.primaryAction,
              label: state.decision.primaryAction.label || state.decision.explanationShort || "Priorità Gold",
              suggestedAction: state.decision.primaryAction.label || state.decision.explanationShort || "gestisci priorità",
              explanationShort: state.decision.explanationShort || state.decision.primaryAction.label || "Priorita letta dal Gold State Layer.",
              explanationLong: state.decision.explanationShort || state.decision.primaryAction.label || "Priorita letta dal Gold State Layer.",
              confidence: Number(state.components?.Conf || 0),
              risk: Number(state.signals?.operationalRisk || 0)
            }
            : null,
          secondaryActions: Array.isArray(state.decision?.secondaryActions)
            ? state.decision.secondaryActions.map((item) => ({
              ...item,
              suggestedAction: item.label || "gestisci priorità secondaria",
              confidence: Number(state.components?.Conf || 0),
              risk: Number(state.signals?.operationalRisk || 0)
            }))
            : [],
          blockedActions: Array.isArray(state.decision?.blockedActions)
            ? state.decision.blockedActions.map((item) => ({
              domain: "blocked",
              entityId: String(item || ""),
              label: String(item || ""),
              action: "VERIFY",
              suggestedAction: String(item || "")
            }))
            : [],
          summary: state.decision || null
        }
      },
      operations: {
        upcomingAppointments: [],
        weakestUpcomingDay: null,
        leastLoadedOperator: null,
        topOperator,
        weakOperator,
        topClient: null
      }
    };
    this.logGoldStateEndpoint("business_snapshot", session, { source: "gold_state", ...validState });
    return snapshot;
  }

  buildDecisionCenterFromGoldState(options = {}, session = null) {
    if (this.shouldBypassGoldStateForWindow(options)) return null;
    const stateDecision = this.getGoldStateDecision(session);
    const state = stateDecision?.state || null;
    const decision = stateDecision?.decision || null;
    if (!state || !decision || !decision.primaryAction || Number(state.eventSeq || 0) <= 0) {
      return null;
    }
    const snapshots = state.snapshots || {};
    const signals = state.signals || {};
    const business = snapshots.business || {};
    const profitability = snapshots.profitability || {};
    const report = snapshots.report || {};
    const servicesTotal = Number(state.counters?.servicesTotal || 0);
    const servicesWithCost = Number(state.counters?.servicesWithCost || 0);
    const profitabilityConfigBlocked = servicesTotal > 0 && servicesWithCost < servicesTotal;
    const missingServiceCosts = Math.max(0, servicesTotal - servicesWithCost);
    const cashPrimary = state.cashPrimarySnapshot || null;
    const cashSelection = state.cashSelection || null;
    const decisionScore = Number(decision.score || 0);
    const level = decision.action === "ACT_NOW" ? "critical" : decision.action === "SUGGEST" ? "warning" : "info";
    const centerHealth = {
      source: "gold_state",
      status: business.status === "centro_sotto_pressione" ? "fragile" : business.status === "dato_da_verificare" ? "sotto_soglia" : "stabile",
      statusLabel: business.status === "centro_sotto_pressione" ? "sotto pressione" : business.status === "dato_da_verificare" ? "da verificare" : "stabile",
      level: business.status === "dato_da_verificare" ? "warning" : business.status === "centro_sotto_pressione" ? "warning" : "success",
      reason: `State layer: saturazione ${Math.round(Number(business.agendaSaturation || 0) * 100)}%, continuita ${Math.round(Number(business.clientContinuity || 0) * 100)}%, confidenza ${Math.round(Number(business.confidence || 0) * 100)}%.`,
      revenuePerOperatorCents: 0,
      monthlyRevenueCents: Number(business.revenueCents || 0),
      saturationPercent: Math.round(Number(business.agendaSaturation || 0) * 100),
      continuityPercent: Math.round(Number(business.clientContinuity || 0) * 100)
    };
    const stateHasOperationalEvidence = Number(business.revenueCents || 0) > 0
      || Number(business.averageTicketCents || 0) > 0
      || Number(business.unlinkedPayments || 0) > 0;
    const primaryItem = {
      id: `gold-state-${decision.domain}`,
      level,
      area: decision.domain || "gold",
      conclusion: decision.primaryAction?.label || decision.explanationShort || "Priorita Gold",
      reason: profitabilityConfigBlocked
        ? `${decision.explanationShort || "Priorita letta dal Gold State Layer."} Non e un giudizio negativo sul centro: manca configurazione economica su ${missingServiceCosts} servizi.`
        : decision.explanationShort || "Priorita letta dal Gold State Layer.",
      details: profitabilityConfigBlocked
        ? `Score ${Math.round(decisionScore * 100)} · Affidabilita ${Math.round(Number(signals.dataReliability ?? business.confidence ?? 0) * 100)} · Cassa ${cashSelection?.primarySource || "legacy"} · Costi servizio mancanti ${missingServiceCosts}/${servicesTotal}.`
        : `Score ${Math.round(decisionScore * 100)} · Affidabilita ${Math.round(Number(signals.dataReliability ?? business.confidence ?? 0) * 100)} · Cash ${cashSelection?.primarySource || "legacy"}`,
      impactCents: decision.domain === "cash"
        ? Number(cashPrimary?.unlinkedCashCents || 0) + Number(cashPrimary?.ambiguousCashCents || 0) + Number(cashPrimary?.overdueCents || 0)
        : Number(business.revenueCents || profitability.revenueCents || report.revenueCents || 0),
      riskCents: decision.domain === "profitability" ? Number(profitability.revenueCents || 0) : 0,
      action: profitabilityConfigBlocked
        ? "completa costi servizi prima di leggere la redditivita"
        : decision.primaryAction?.label || "gestisci priorita",
      button: decision.domain === "cash" ? "Apri cassa" : decision.domain === "profitability" ? "Apri redditività" : decision.domain === "operations" ? "Apri dashboard" : decision.domain === "growth" ? "Apri marketing" : "Apri dettaglio",
      target: decision.domain === "cash" ? "cashdesk" : decision.domain === "profitability" ? "profitability" : decision.domain === "operations" ? "dashboard" : decision.domain === "growth" ? "marketing" : "dashboard"
    };
    const secondaryItems = (decision.secondaryActions || []).slice(0, 3).map((item, index) => ({
      id: `gold-state-secondary-${item.domain || index}`,
      level: Number(item.score || 0) >= 0.7 ? "critical" : Number(item.score || 0) >= 0.45 ? "warning" : "info",
      area: item.domain || "gold",
      conclusion: item.label || "Segnale secondario Gold",
      reason: "Segnale secondario letto dal Gold State Layer.",
      details: `Score ${Math.round(Number(item.score || 0) * 100)} · Fonte gold_state`,
      impactCents: 0,
      riskCents: 0,
      action: item.label || "monitorare",
      button: item.domain === "cash" ? "Apri cassa" : item.domain === "profitability" ? "Apri redditività" : "Apri dettaglio",
      target: item.domain === "cash" ? "cashdesk" : item.domain === "profitability" ? "profitability" : "dashboard"
    }));
    const blockedItems = (decision.blockedActions || []).slice(0, 3).map((label, index) => ({
      id: `gold-state-blocked-${index}`,
      level: "warning",
      area: "controllo",
      conclusion: String(label || "Azione bloccata"),
      reason: "Il Gold State Layer segnala confidenza insufficiente o dato fragile.",
      details: "Output assertivi bloccati fino a dato piu affidabile.",
      impactCents: 0,
      riskCents: 0,
      action: "verifica prima di agire",
      button: "Apri dashboard",
      target: "dashboard"
    }));
    const sections = [
      {
        key: "center_health",
        title: "Stato centro",
        items: [{
          id: "center-health-main",
          level: centerHealth.level,
          area: "salute centro",
          conclusion: profitabilityConfigBlocked && stateHasOperationalEvidence
            ? "Lettura centro prudente: configurazione economica incompleta"
            : `Centro ${centerHealth.statusLabel}`,
          reason: profitabilityConfigBlocked && stateHasOperationalEvidence
            ? "Il centro mostra volume reale, ma finché costi servizi e costi orari non sono completi la lettura complessiva va tenuta prudente."
            : centerHealth.reason,
          details: profitabilityConfigBlocked && stateHasOperationalEvidence
            ? `Fatturato ${euro(Number(business.revenueCents || 0))} · ticket medio ${euro(Number(business.averageTicketCents || 0))} · costi servizio mancanti ${missingServiceCosts}/${servicesTotal} · pagamenti non collegati ${Number(business.unlinkedPayments || 0)}`
            : `Fatturato ${euro(Number(business.revenueCents || 0))} · ticket medio ${euro(Number(business.averageTicketCents || 0))} · pagamenti non collegati ${Number(business.unlinkedPayments || 0)}`,
          impactCents: Number(business.revenueCents || 0),
          riskCents: 0,
          action: profitabilityConfigBlocked && stateHasOperationalEvidence
            ? "completa costi servizi e operatori"
            : centerHealth.status === "sotto_soglia" ? "verifica dati e operativita" : "mantieni controllo operativo",
          button: "Apri dashboard",
          target: "dashboard"
        }]
      },
      {
        key: "gold_engine",
        title: "Corelia Decision Engine",
        items: [primaryItem, ...secondaryItems].slice(0, 4)
      },
      {
        key: "daily",
        title: "Priorità del giorno",
        items: [primaryItem, ...secondaryItems].filter((item) => item.area !== "profitability").slice(0, 4)
      },
      {
        key: "profitability",
        title: "Redditività prodotti e tecnologie",
        items: [primaryItem, ...secondaryItems].filter((item) => item.area === "profitability").slice(0, 4)
      },
      {
        key: "performance",
        title: "Performance centro",
        items: []
      },
      {
        key: "hidden",
        title: "Opportunità nascoste",
        items: [primaryItem, ...secondaryItems].filter((item) => item.area === "growth").slice(0, 4)
      },
      {
        key: "actions",
        title: "Azioni immediate",
        items: blockedItems.length ? blockedItems : [primaryItem]
      }
    ];
    const allDecisionItems = sections.flatMap((section) => section.items || []);
    const v7 = this.computeDecisionCenterV7(allDecisionItems);
    const uiReading = this.resolveDecisionCenterUiBand(v7, {
      action: decision.action || primaryItem.level,
      confidence: Number(signals.dataReliability ?? business.confidence ?? 0),
      reliabilityScore: Number(cashSelection?.reliabilityScore ?? signals.dataReliability ?? business.confidence ?? 0),
      ...decision.primaryAction
    });
    return {
      goldEnabled: true,
      generatedAt: nowIso(),
      v7,
      summary: {
        totalInsights: sections.reduce((sum, section) => sum + section.items.length, 0),
        uiReadingBand: uiReading.key,
        uiReadingLabel: uiReading.label,
        conflictIndex: v7.conflictIndex,
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
          sourceLayer: "gold_state",
          cached: true,
          generatedAt: state.updatedAt,
          expiresAt: ""
        },
        cash: {
          primarySource: cashSelection?.primarySource || "legacy",
          reliabilityScore: cashSelection?.reliabilityScore ?? null,
          agreementBand: cashSelection?.agreementBand || "N/A"
        },
        treatments: 0,
        protocols: 0,
        technologies: 0
      },
      sections,
      meta: {
        source: "gold_state",
        fallbackAvailable: true,
        stateVersion: state.version,
        eventSeq: state.eventSeq,
        cashSelection,
        lastEvent: state.lastEvent || null
      }
    };
  }

  goldClamp01(value) {
    return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
  }

  goldSafeDivide(value, total) {
    return Number(total || 0) > 0 ? Number(value || 0) / Number(total || 0) : 0;
  }

  goldRound(value, decimals = 4) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  goldAppointmentActiveForToday(item = {}) {
    const status = String(item.status || "").toLowerCase();
    return toDateOnly(item.startAt || item.createdAt || "") === toDateOnly(nowIso())
      && !["cancelled", "no_show", "deleted"].includes(status);
  }

  goldClientHasContact(item = {}) {
    return Boolean(String(item.phone || "").trim() || String(item.email || "").trim());
  }

  goldClientIsActive(item = {}) {
    return item.active !== false && item.active !== 0 && String(item.status || "").toLowerCase() !== "inactive";
  }

  goldPaymentIsUnlinked(item = {}) {
    if (["free", "ignored"].includes(String(item.reconciliationStatus || "").toLowerCase())) return false;
    return !item.appointmentId || !item.clientId;
  }

  goldServiceHasPrice(item = {}) {
    return Number(item.priceCents || item.price || 0) > 0;
  }

  goldServiceHasCost(item = {}) {
    return Number(item.estimatedProductCostCents || item.productCostCents || 0) > 0
      || Number(item.technologyCostCents || 0) > 0
      || (Array.isArray(item.productLinks) && item.productLinks.length > 0)
      || (Array.isArray(item.technologyLinks) && item.technologyLinks.length > 0);
  }

  goldServiceMarginRatio(item = {}) {
    const price = Number(item.priceCents || item.price || 0);
    if (price <= 0) return null;
    const cost = Number(item.estimatedProductCostCents || item.productCostCents || 0) + Number(item.technologyCostCents || 0);
    return this.goldClamp01((price - cost) / price);
  }

  applyGoldProfitabilityCoreCounters(counters = {}, collections = {}) {
    const snapshot = computeCenterProfitabilitySnapshot({
      appointments: (collections.appointments || []).filter((item) => item.status === "completed"),
      services: collections.services || [],
      staff: collections.staff || [],
      payments: collections.payments || [],
      inventory: collections.inventory || [],
      resources: collections.resources || []
    });
    const breakdowns = Array.isArray(snapshot.appointmentBreakdowns) ? snapshot.appointmentBreakdowns : [];
    counters.profitabilityRevenueCents = Number(snapshot.totals?.revenueCents || 0);
    counters.profitabilityCostCents = Number(snapshot.totals?.costCents || 0);
    counters.profitabilityProfitCents = Number(snapshot.totals?.profitCents || 0);
    counters.profitabilitySamples = breakdowns.length;
    counters.profitabilityReal = breakdowns.filter((item) => item.confidence === CONFIDENCE.REAL).length;
    counters.profitabilityStandard = breakdowns.filter((item) => item.confidence === CONFIDENCE.STANDARD).length;
    counters.profitabilityEstimated = breakdowns.filter((item) => item.confidence === CONFIDENCE.ESTIMATED).length;
    counters.profitabilityIncomplete = breakdowns.filter((item) => item.confidence === CONFIDENCE.INCOMPLETE).length;
    counters.marginTotal = Number(snapshot.totals?.revenueCents || 0) > 0
      ? Number(snapshot.totals.profitCents || 0) / Number(snapshot.totals.revenueCents || 1)
      : 0;
    counters.marginSamples = Number(snapshot.totals?.revenueCents || 0) > 0 ? 1 : 0;
    return counters;
  }

  refreshGoldProfitabilityCountersFromRepositories(counters = {}, session = null) {
    return this.applyGoldProfitabilityCoreCounters(counters, {
      appointments: this.filterByCenter(this.appointmentsRepository.list(), session),
      services: this.filterByCenter(this.servicesRepository.list(), session),
      staff: this.filterByCenter(this.staffRepository.list(), session),
      payments: this.filterByCenter(this.paymentsRepository.list(), session),
      inventory: this.filterByCenter(this.inventoryRepository.list(), session),
      resources: this.filterByCenter(this.resourcesRepository.list(), session)
    });
  }

  goldInventoryIsLow(item = {}) {
    const quantity = Number(item.quantity ?? item.stockQuantity ?? item.stock ?? 0);
    const threshold = Number(item.minQuantity ?? item.thresholdQuantity ?? item.threshold ?? 0);
    return quantity <= threshold;
  }

  markGoldStateDirty(state, eventType) {
    const changed = state.graph?.eventToState?.[eventType] || [];
    const snapshots = Array.from(new Set(changed.flatMap((key) => state.graph?.stateToSnapshot?.[key] || [])));
    const signals = Array.from(new Set(snapshots.flatMap((key) => state.graph?.snapshotToSignal?.[key] || [])));
    state.dirty = { components: changed, snapshots, signals };
  }

  normalizeGoldStateComponents(state) {
    const c = state.counters || {};
    const cmp = state.components || {};
    cmp.Rev = Math.max(0, Math.round(Number(c.revenueTotalCents || 0)));
    cmp.U = Math.max(0, Number(c.unlinkedPayments || 0));
    cmp.Sat = this.goldClamp01(this.goldSafeDivide(c.todayAppointments, c.appointmentSlots || 24));
    cmp.Act = Math.max(0, Number(c.activeClients || 0));
    cmp.Cont = this.goldClamp01(this.goldSafeDivide(c.activeClients, c.clientsTotal));
    cmp.Ticket = Math.max(0, Math.round(this.goldSafeDivide(c.revenueTotalCents, c.paymentCount)));
    cmp.Prod = this.goldClamp01(this.goldSafeDivide(c.todayAppointments, Math.max(1, Number(c.staffActive || 0)) * 6));
    cmp.DQ = this.goldClamp01(
      (this.goldSafeDivide(c.clientsWithContact, c.clientsTotal) * 0.45)
      + (this.goldSafeDivide(c.servicesWithPrice, c.servicesTotal) * 0.2)
      + (this.goldSafeDivide(c.servicesWithCost, c.servicesTotal) * 0.2)
      + ((1 - this.goldSafeDivide(c.lowStock, Math.max(1, Number(c.inventoryTotal || 0)))) * 0.15)
    );
    const profitabilitySamples = Number(c.profitabilitySamples || 0);
    const reliableProfitabilitySamples = Number(c.profitabilityReal || 0) + Number(c.profitabilityStandard || 0);
    cmp.CostConf = profitabilitySamples
      ? this.goldClamp01(this.goldSafeDivide(reliableProfitabilitySamples, profitabilitySamples))
      : this.goldClamp01(this.goldSafeDivide(c.servicesWithCost, c.servicesTotal));
    cmp.Margin = Number(c.profitabilityRevenueCents || 0) > 0
      ? this.goldRound(Number(c.profitabilityProfitCents || 0) / Number(c.profitabilityRevenueCents || 1), 4)
      : this.goldRound(this.goldSafeDivide(c.marginTotal, c.marginSamples), 4);
    const economicReliability = profitabilitySamples
      ? this.goldClamp01(
        (Number(c.profitabilityReal || 0) * 1
        + Number(c.profitabilityStandard || 0) * 0.82
        + Number(c.profitabilityEstimated || 0) * 0.45)
        / profitabilitySamples
      )
      : cmp.CostConf;
    cmp.Conf = this.goldClamp01(c.clientsTotal || c.servicesTotal || c.paymentCount ? cmp.DQ * (0.65 + economicReliability * 0.35) : 1);
    state.components = cmp;
    return state;
  }

  buildGoldSnapshotsFromState(state = {}) {
    const s = state.components || {};
    return {
      business: {
        type: "business_snapshot",
        source: "gold_state",
        revenueCents: Number(s.Rev || 0),
        unlinkedPayments: Number(s.U || 0),
        agendaSaturation: Number(s.Sat || 0),
        activeClients: Number(s.Act || 0),
        clientContinuity: Number(s.Cont || 0),
        averageTicketCents: Number(s.Ticket || 0),
        productivity: Number(s.Prod || 0),
        dataQuality: Number(s.DQ || 0),
        confidence: Number(s.Conf || 0),
        status: Number(s.Conf || 0) < 0.5 ? "dato_da_verificare" : Number(s.Sat || 0) > 0.85 ? "centro_sotto_pressione" : "centro_monitorato"
      },
      profitability: {
        type: "profitability_snapshot",
        source: "gold_state",
        revenueCents: Number(s.Rev || 0),
        coreRevenueCents: Number(state.counters?.profitabilityRevenueCents || 0),
        coreCostCents: Number(state.counters?.profitabilityCostCents || 0),
        coreProfitCents: Number(state.counters?.profitabilityProfitCents || 0),
        averageMargin: Number(s.Margin || 0),
        costConfidence: Number(s.CostConf || 0),
        economicConfidence: Number(s.Conf || 0),
        profitabilityConfidence: Math.min(Number(s.CostConf || 0), Number(s.Conf || 0)),
        confidenceLabel: Math.min(Number(s.CostConf || 0), Number(s.Conf || 0)) >= 0.8
          ? "alta"
          : Math.min(Number(s.CostConf || 0), Number(s.Conf || 0)) >= 0.55
            ? "media"
            : "bassa",
        coreSamples: Number(state.counters?.profitabilitySamples || 0),
        confidenceBreakdown: {
          real: Number(state.counters?.profitabilityReal || 0),
          standard: Number(state.counters?.profitabilityStandard || 0),
          estimated: Number(state.counters?.profitabilityEstimated || 0),
          incomplete: Number(state.counters?.profitabilityIncomplete || 0)
        },
        mathCore: "profitability_core_v1",
        status: Number(s.CostConf || 0) < 0.5 || Number(s.Conf || 0) < 0.5 ? "margine_da_verificare" : Number(s.Margin || 0) < 0.35 ? "margine_sotto_soglia" : "margine_monitorato"
      },
      report: {
        type: "report_snapshot",
        source: "gold_state",
        revenueCents: Number(s.Rev || 0),
        averageTicketCents: Number(s.Ticket || 0),
        productivity: Number(s.Prod || 0),
        agendaSaturation: Number(s.Sat || 0),
        continuity: Number(s.Cont || 0),
        dataQuality: Number(s.DQ || 0),
        unlinkedPayments: Number(s.U || 0)
      }
    };
  }

  buildGoldSignalsFromState(state = {}) {
    const s = state.components || {};
    const c = state.counters || {};
    const hasOperationalData = Number(c.clientsTotal || 0) + Number(c.paymentCount || 0) + Number(c.todayAppointments || 0) + Number(c.servicesTotal || 0) > 0;
    const hasFinancialData = Number(c.paymentCount || 0) > 0 || Number(c.revenueTotal || 0) > 0;
    const hasMarginData = Number(c.marginSamples || 0) > 0;
    const hasQualityData = Number(c.clientsTotal || 0) > 0 || Number(c.servicesTotal || 0) > 0 || Number(c.inventoryTotal || 0) > 0;
    const cashPrimary = state.cashPrimarySnapshot || null;
    const cashAnomalyScore = cashPrimary
      ? this.goldClamp01(
        Number(cashPrimary.ambiguityRatio ?? 0)
        || (Number(cashPrimary.unlinkedCashCents || 0) + Number(cashPrimary.ambiguousCashCents || 0) > 0 ? 0.5 : 0)
      )
      : this.goldClamp01(Math.min(Number(s.U || 0), 5) / 5);
    if (!hasOperationalData) {
      return {
        operationalRisk: 0,
        centerBelowThreshold: 0,
        opportunity: 0,
        cashAnomaly: 0,
        marginAnomaly: 0,
        dataReliability: hasQualityData ? Number(s.Conf ?? 1) : 1,
        productivitySignal: 0
      };
    }
    return {
      operationalRisk: this.goldClamp01((Number(s.Sat || 0) * 0.35) + ((1 - Number(s.DQ || 0)) * 0.35) + cashAnomalyScore * 0.3),
      centerBelowThreshold: this.goldClamp01(((1 - Number(s.Cont || 0)) * 0.45) + ((1 - Number(s.Prod || 0)) * 0.25) + ((1 - Number(s.Conf || 0)) * 0.3)),
      opportunity: this.goldClamp01((Number(s.Conf || 0) * 0.4) + (Number(s.Cont || 0) * 0.25) + (Number(s.Ticket || 0) > 0 ? 0.2 : 0) + (Number(s.Sat || 0) < 0.7 ? 0.15 : 0)),
      cashAnomaly: hasFinancialData ? cashAnomalyScore : 0,
      marginAnomaly: hasMarginData
        ? this.goldClamp01((1 - Number(s.CostConf || 0)) * 0.55 + (Number(s.Margin || 0) < 0.35 ? 0.45 : 0))
        : hasFinancialData
          ? this.goldClamp01((1 - Number(s.CostConf || 0)) * 0.25)
          : 0,
      dataReliability: hasQualityData ? Number(s.Conf || 0) : 1,
      productivitySignal: Number(s.Prod || 0)
    };
  }

  buildGoldDecisionFromState(state = {}) {
    const signals = state.signals || this.buildGoldSignalsFromState(state);
    const counters = state.counters || {};
    const hasAnyRevenue = Number(counters.revenueTotal || 0) > 0 || Number(counters.paymentCount || 0) > 0;
    const hasMarginData = Number(counters.marginSamples || 0) > 0;
    const hasSetupGaps = Number(counters.clientsWithContact || 0) < Number(counters.clientsTotal || 0)
      || Number(counters.servicesWithPrice || 0) < Number(counters.servicesTotal || 0);
    const servicesTotal = Number(counters.servicesTotal || 0);
    const servicesWithCost = Number(counters.servicesWithCost || 0);
    const profitabilityConfigBlocked = servicesTotal > 0 && servicesWithCost < servicesTotal;
    const entries = [
      ["cash", signals.cashAnomaly || 0, "Verifica pagamenti non collegati"],
      ["profitability", signals.marginAnomaly || 0, "Verifica marginalita e costi"],
      ["operations", signals.operationalRisk || 0, "Controlla rischio operativo"],
      ["growth", signals.opportunity || 0, "Valuta opportunita operative"],
      ["data_quality", 1 - (signals.dataReliability ?? state.components?.Conf ?? 1), "Completa qualita dati"]
    ].map(([domain, rawScore, label]) => {
      const actionabilityScore = this.getGoldDecisionActionability(domain, state, rawScore);
      const confidenceWeight = 0.7 + this.goldClamp01(Number(state.components?.Conf || 0)) * 0.3;
      const weightedScore = this.goldClamp01(Number(rawScore || 0) * actionabilityScore * confidenceWeight);
      return [domain, Number(rawScore || 0), label, actionabilityScore, weightedScore];
    }).sort((a, b) => b[4] - a[4] || b[1] - a[1]);
    const [domain, score, label, actionabilityScore, weightedScore] = entries[0];
    let action = score >= 0.7 ? "ACT_NOW" : score >= 0.45 ? "SUGGEST" : "MONITOR";
    if (domain === "profitability" && !hasMarginData) {
      action = hasAnyRevenue ? "SUGGEST" : "MONITOR";
    }
    if (domain === "data_quality" && hasSetupGaps && score >= 0.45) {
      action = "SUGGEST";
    }
    let feedbackLabel = label;
    let explanationShort = score >= 0.7 ? `${label}: priorita alta.` : score >= 0.45 ? `${label}: suggerito.` : "Centro stabile: monitorare.";
    if (profitabilityConfigBlocked && hasAnyRevenue) {
      if (domain === "growth") {
        feedbackLabel = "Volume presente, completa costi per sbloccare redditivita";
        explanationShort = "Il centro lavora, ma Gold evita letture economiche forti finche i costi servizi restano incompleti.";
      } else if (domain === "profitability") {
        feedbackLabel = "Redditivita da configurare prima di leggerla";
        explanationShort = "Pagamenti e volume ci sono, ma la redditivita non e ancora affidabile senza costi servizi completi.";
      } else if (domain === "operations") {
        explanationShort = "Operativita leggibile. Parte economica ancora prudente finche i costi servizi non sono completi.";
      }
    }
    return {
      source: "gold_state",
      domain,
      score: this.goldRound(score),
      weightedScore: this.goldRound(weightedScore),
      action,
      primaryAction: { domain, action, label: feedbackLabel, actionabilityScore: this.goldRound(actionabilityScore) },
      secondaryActions: entries.slice(1, 3).map(([itemDomain, itemScore, itemLabel, itemActionability, itemWeighted]) => ({
        domain: itemDomain,
        score: this.goldRound(itemScore),
        weightedScore: this.goldRound(itemWeighted),
        actionabilityScore: this.goldRound(itemActionability),
        label: itemLabel
      })),
      blockedActions: Number(state.components?.Conf || 1) < 0.4 ? ["output_assertivi", "azioni_automatiche"] : [],
      explanationShort,
      updatedAt: state.updatedAt || nowIso()
    };
  }

  getGoldDecisionActionability(domain = "", state = {}, rawScore = 0) {
    const counters = state.counters || {};
    const profitabilityConfidence = Math.min(Number(state.components?.CostConf || 0), Number(state.components?.Conf || 0));
    const hasMarginData = Number(counters.marginSamples || 0) > 0;
    const baseByDomain = {
      cash: 1,
      growth: 0.95,
      operations: 0.85,
      data_quality: 0.72,
      profitability: hasMarginData ? 0.72 + profitabilityConfidence * 0.18 : 0.52
    };
    const base = Number(baseByDomain[String(domain || "")] ?? 0.7);
    const urgencyBoost = Number(rawScore || 0) >= 0.75 ? 0.05 : 0;
    return this.goldClamp01(base + urgencyBoost);
  }

  getGoldDecisionKey(decision = null) {
    if (!decision?.primaryAction?.domain && !decision?.domain) return "";
    const domain = String(decision?.primaryAction?.domain || decision?.domain || "");
    const action = String(decision?.primaryAction?.action || decision?.action || "");
    return `${domain}:${action}`;
  }

  stabilizeGoldDecision(previousDecision = null, previousStability = null, rawDecision = null) {
    const rawKey = this.getGoldDecisionKey(rawDecision);
    const previousKey = this.getGoldDecisionKey(previousDecision);
    const stability = {
      acceptedKey: String(previousStability?.acceptedKey || previousKey || ""),
      candidateKey: String(previousStability?.candidateKey || ""),
      candidateCount: Number(previousStability?.candidateCount || 0),
      minPersistenceCycles: Math.max(2, Number(previousStability?.minPersistenceCycles || 2)),
      switchedAt: String(previousStability?.switchedAt || "")
    };
    if (!previousDecision || !previousKey || !rawKey) {
      return {
        decision: {
          ...rawDecision,
          temporalStability: {
            stable: true,
            candidateCount: 0,
            requiredCycles: stability.minPersistenceCycles
          }
        },
        stability: {
          ...stability,
          acceptedKey: rawKey,
          candidateKey: "",
          candidateCount: 0,
          switchedAt: nowIso()
        }
      };
    }
    if (rawKey === previousKey) {
      return {
        decision: {
          ...rawDecision,
          temporalStability: {
            stable: true,
            candidateCount: 0,
            requiredCycles: stability.minPersistenceCycles
          }
        },
        stability: {
          ...stability,
          acceptedKey: rawKey,
          candidateKey: "",
          candidateCount: 0
        }
      };
    }
    const candidateKey = stability.candidateKey === rawKey ? rawKey : rawKey;
    const candidateCount = stability.candidateKey === rawKey ? stability.candidateCount + 1 : 1;
    const strongAdvantage = Number(rawDecision?.score || 0) - Number(previousDecision?.score || 0) >= 0.2;
    const canSwitch = strongAdvantage || candidateCount >= stability.minPersistenceCycles;
    if (canSwitch) {
      return {
        decision: {
          ...rawDecision,
          temporalStability: {
            stable: true,
            candidateCount,
            requiredCycles: stability.minPersistenceCycles
          }
        },
        stability: {
          ...stability,
          acceptedKey: rawKey,
          candidateKey: "",
          candidateCount: 0,
          switchedAt: nowIso()
        }
      };
    }
    return {
      decision: {
        ...previousDecision,
        deferredDecision: rawDecision,
        explanationShort: `${previousDecision.explanationShort || "Priorita confermata."} Cambio in osservazione.`,
        temporalStability: {
          stable: false,
          candidateKey: rawKey,
          candidateCount,
          requiredCycles: stability.minPersistenceCycles
        }
      },
      stability: {
        ...stability,
        candidateKey,
        candidateCount
      }
    };
  }

  buildGoldCashParallelHorizon(appointments = [], payments = []) {
    const dates = [
      ...appointments.map((item) => toDateOnly(item.startAt || item.createdAt || item.dueAt || "")),
      ...payments.map((item) => toDateOnly(item.createdAt || item.paidAt || ""))
    ].filter(Boolean).sort();
    return {
      startDate: dates[0] || "",
      endDate: dates[dates.length - 1] || "",
      mode: dates.length ? "all_observed_data" : "empty"
    };
  }

  buildGoldCashLegacySnapshotForParallel({ appointments = [], payments = [], services = [] } = {}, horizon = {}) {
    const servicesById = mapById(services);
    const inHorizon = (value) => {
      const date = toDateOnly(value || "");
      if (!date) return false;
      if (horizon.startDate && date < horizon.startDate) return false;
      if (horizon.endDate && date > horizon.endDate) return false;
      return true;
    };
    const periodPayments = payments.filter((payment) => inHorizon(payment.createdAt || payment.paidAt));
    const periodAppointments = appointments.filter((appointment) => inHorizon(appointment.startAt || appointment.createdAt || appointment.dueAt));
    const recordedCashCents = periodPayments.reduce((sum, payment) => sum + Number(payment.amountCents || 0), 0);
    const unlinkedPayments = periodPayments.filter((payment) => this.goldPaymentIsUnlinked(payment));
    const unlinkedCashCents = unlinkedPayments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amountCents || 0)), 0);
    const operationalRevenueCents = periodAppointments
      .filter((appointment) => ["completed", "ready_checkout"].includes(String(appointment.status || "")))
      .reduce((sum, appointment) => {
        const service = servicesById.get(String(appointment.serviceId || ""));
        return sum + Number(appointment.amountCents || appointment.priceCents || service?.priceCents || 0);
      }, 0);
    return {
      source: "gold_state_legacy_cash",
      recordedCashCents,
      // Legacy does not distinguish reconciled cash; this is the closest comparable cash metric available today.
      reconciledCashCents: recordedCashCents,
      operationalRevenueCents,
      unlinkedPaymentCount: unlinkedPayments.length,
      unlinkedCashCents,
      gapCents: operationalRevenueCents - recordedCashCents,
      overdueCents: null,
      sourceFlags: ["legacy_cash:recorded_cash_used_as_cash_equivalent", "legacy_cash:no_overdue_metric"]
    };
  }

  symmetricRelativeError(coreValue, legacyValue) {
    const core = Number(coreValue || 0);
    const legacy = Number(legacyValue || 0);
    return this.goldClamp01(Math.abs(core - legacy) / Math.max(1, Math.max(Math.abs(core), Math.abs(legacy))));
  }

  buildGoldCashParallelDiff(coreSnapshot = {}, legacySnapshot = {}) {
    const metricDefinitions = [
      {
        key: "billedDue",
        deltaKey: "billedDueDeltaCents",
        errorKey: "billedDueError",
        warning: "CASH_BILLED_DUE_DRIFT",
        coreValue: Number(coreSnapshot.billedDueCents || 0),
        legacyValue: Number(legacySnapshot.operationalRevenueCents ?? legacySnapshot.billedDueCents ?? 0),
        weight: CASH_PARALLEL_DIFF_WEIGHTS.billedDue,
        threshold: CASH_PARALLEL_WARNING_THRESHOLDS.billedDue,
        comparable: true,
        sourceFlag: "compare:adapter_billed_due_vs_legacy_operational_revenue"
      },
      {
        key: "reconciledCash",
        deltaKey: "reconciledCashDeltaCents",
        errorKey: "reconciledCashError",
        warning: "CASH_RECONCILIATION_DRIFT",
        coreValue: Number(coreSnapshot.recordedCashCents || 0),
        legacyValue: Number(legacySnapshot.reconciledCashCents || 0),
        weight: CASH_PARALLEL_DIFF_WEIGHTS.reconciledCash,
        threshold: CASH_PARALLEL_WARNING_THRESHOLDS.reconciledCash,
        comparable: true,
        sourceFlag: "compare:core_recorded_cash_vs_legacy_recorded_cash"
      },
      {
        key: "unlinkedCash",
        deltaKey: "unlinkedCashDeltaCents",
        errorKey: "unlinkedCashError",
        warning: "CASH_UNLINKED_DRIFT",
        coreValue: Number(coreSnapshot.unlinkedCashCents || 0) + Number(coreSnapshot.ambiguousCashCents || 0),
        legacyValue: Number(legacySnapshot.unlinkedCashCents || 0),
        weight: CASH_PARALLEL_DIFF_WEIGHTS.unlinkedCash,
        threshold: CASH_PARALLEL_WARNING_THRESHOLDS.unlinkedCash,
        comparable: true,
        sourceFlag: "compare:adapter_missing_link_unlinked_vs_legacy_unlinked"
      },
      {
        key: "gap",
        deltaKey: "gapDeltaCents",
        errorKey: "gapError",
        warning: "CASH_GAP_DRIFT",
        coreValue: Number(coreSnapshot.gapCents || 0),
        legacyValue: Number(legacySnapshot.gapCents || 0),
        weight: CASH_PARALLEL_DIFF_WEIGHTS.gap,
        threshold: CASH_PARALLEL_WARNING_THRESHOLDS.gap,
        comparable: true,
        sourceFlag: "compare:adapter_gap_vs_legacy_operational_gap"
      }
    ];
    const comparableMetrics = metricDefinitions.filter((metric) => metric.comparable);
    const deltas = {};
    const relativeErrors = {};
    const warnings = [];
    const sourceFlags = [];
    const totalWeight = comparableMetrics.reduce((sum, metric) => sum + Number(metric.weight || 0), 0);
    if (!comparableMetrics.length || totalWeight <= 0) {
      return {
        comparableMetrics: [],
        deltas: {
          billedDueDeltaCents: null,
          reconciledCashDeltaCents: null,
          unlinkedCashDeltaCents: null,
          gapDeltaCents: null
        },
        relativeErrors: {
          billedDueError: null,
          reconciledCashError: null,
          unlinkedCashError: null,
          gapError: null
        },
        agreementScore: null,
        agreementBand: "N/A",
        warnings: ["CASH_PARALLEL_NOT_COMPARABLE"],
        sourceFlags: ["cash_parallel:no_comparable_metrics", "cash_policy_adapter:overdue_excluded_from_agreement"]
      };
    }
    let weightedError = 0;
    comparableMetrics.forEach((metric) => {
      const delta = Number(metric.coreValue || 0) - Number(metric.legacyValue || 0);
      const error = this.symmetricRelativeError(metric.coreValue, metric.legacyValue);
      deltas[metric.deltaKey] = Math.round(delta);
      relativeErrors[metric.errorKey] = this.goldRound(error, 4);
      weightedError += (Number(metric.weight || 0) / totalWeight) * error;
      sourceFlags.push(metric.sourceFlag);
      if (error > metric.threshold) warnings.push(metric.warning);
    });
    metricDefinitions.filter((metric) => !metric.comparable).forEach((metric) => {
      deltas[metric.deltaKey] = null;
      relativeErrors[metric.errorKey] = null;
      warnings.push("CASH_PARALLEL_NOT_COMPARABLE");
      sourceFlags.push(`${metric.key}:not_comparable`);
    });
    const agreementScore = this.goldRound(1 - this.goldClamp01(weightedError), 4);
    const criticalDrift = warnings.some((item) => item !== "CASH_PARALLEL_NOT_COMPARABLE");
    const agreementBand = agreementScore >= 0.90 && !criticalDrift
      ? "ALIGNED"
      : agreementScore >= 0.75
        ? "WATCH"
        : "DRIFT";
    return {
      comparableMetrics: comparableMetrics.map((metric) => metric.key),
      deltas,
      relativeErrors,
      agreementScore,
      agreementBand,
      warnings: Array.from(new Set(warnings)),
      excludedFromAgreement: {
        overdueCents: {
          reason: "legacy_has_no_real_overdue_metric",
          sourceFlag: "cash_policy_adapter:overdue_excluded_from_agreement"
        }
      },
      sourceFlags: [...sourceFlags, "cash_policy_adapter:overdue_excluded_from_agreement"]
    };
  }

  buildGoldCashParallelState(state = {}, session = null) {
    const centerId = state.centerId || this.getCenterId(session);
    const shadowSession = session || {
      centerId,
      centerName: state.centerName || this.getCenterName(session),
      subscriptionPlan: "gold",
      supportMode: true
    };
    try {
      const appointments = this.filterByCenter(this.appointmentsRepository.list(), shadowSession);
      const payments = this.filterByCenter(this.paymentsRepository.list(), shadowSession);
      const services = this.filterByCenter(this.servicesRepository.list(), shadowSession);
      const horizon = this.buildGoldCashParallelHorizon(appointments, payments);
      const period = horizon.startDate && horizon.endDate
        ? { startDate: horizon.startDate, endDate: horizon.endDate }
        : {};
      const core = computeCashSnapshot({
        appointments,
        payments,
        services,
        period,
        options: { today: state.updatedAt || nowIso() }
      });
      const policyAdapter = adaptCashSnapshotToLegacyComparable(core);
      const legacySnapshot = this.buildGoldCashLegacySnapshotForParallel({ appointments, payments, services }, horizon);
      const comparableSnapshot = policyAdapter.comparableSnapshot || {};
      const diffSnapshot = this.buildGoldCashParallelDiff(comparableSnapshot, legacySnapshot);
      return {
        mode: "shadow",
        status: diffSnapshot.agreementBand === "N/A" ? "not_comparable" : "ok",
        mathCore: "cash_core_v1",
        mathAdapter: "cash_policy_adapter_v1",
        horizon,
        legacySnapshot,
        coreSnapshot: {
          billedDueCents: Number(core.billedDueCents || 0),
          reconciledCashCents: Number(core.reconciledCashCents || 0),
          recordedCashCents: Number(core.recordedCashCents || 0),
          unlinkedCashCents: Number(core.unlinkedCashCents || 0),
          ambiguousCashCents: Number(core.ambiguousCashCents || 0),
          overdueCents: Number(core.overdueCents || 0),
          openResidualCents: Number(core.openResidualCents || 0),
          gapCents: Number(core.gapCents || 0),
          collectionRatio: core.collectionRatio,
          reconciliationRatio: core.reconciliationRatio,
          ambiguityRatio: core.ambiguityRatio,
          overdueRatio: core.overdueRatio,
          confidence: core.confidence,
          confidenceScore: core.confidenceScore,
          confidenceBreakdown: core.confidenceBreakdown || null,
          sourceFlags: core.sourceFlags || []
        },
        comparableSnapshot: {
          mathAdapter: comparableSnapshot.mathAdapter || "cash_policy_adapter_v1",
          billedDueCents: Number(comparableSnapshot.billedDueCents || 0),
          reconciledCashCents: Number(comparableSnapshot.reconciledCashCents || 0),
          recordedCashCents: Number(comparableSnapshot.recordedCashCents || 0),
          unlinkedCashCents: Number(comparableSnapshot.unlinkedCashCents || 0),
          ambiguousCashCents: Number(comparableSnapshot.ambiguousCashCents || 0),
          overdueCents: null,
          openResidualCents: Number(comparableSnapshot.openResidualCents || 0),
          gapCents: Number(comparableSnapshot.gapCents || 0),
          collectionRatio: comparableSnapshot.collectionRatio,
          reconciliationRatio: comparableSnapshot.reconciliationRatio,
          ambiguityRatio: comparableSnapshot.ambiguityRatio,
          overdueRatio: null,
          confidence: comparableSnapshot.confidence,
          confidenceScore: comparableSnapshot.confidenceScore,
          confidenceBreakdown: comparableSnapshot.confidenceBreakdown || null,
          sourceFlags: comparableSnapshot.sourceFlags || [],
          policyBreakdown: comparableSnapshot.policyBreakdown || null
        },
        policyAdapter: {
          mathAdapter: policyAdapter.mathAdapter,
          policyDeltas: policyAdapter.policyDeltas,
          excludedFromAgreement: policyAdapter.excludedFromAgreement,
          policyFlags: policyAdapter.policyFlags,
          explanations: policyAdapter.explanations
        },
        diffSnapshot,
        sourceFlags: [
          "cash_parallel:shadow_only",
          "cash_parallel:no_primary_switch",
          "cash_parallel:no_allocation_persistence",
          "cash_parallel:agreement_uses_policy_adapter_comparable_snapshot",
          ...diffSnapshot.sourceFlags
        ],
        updatedAt: nowIso()
      };
    } catch (error) {
      console.warn("[cash_parallel_error]", JSON.stringify({
        centerId,
        error: error?.message || String(error)
      }));
      return {
        mode: "shadow",
        status: "error",
        mathCore: "cash_core_v1",
        horizon: null,
        legacySnapshot: null,
        coreSnapshot: null,
        diffSnapshot: null,
        sourceFlags: ["cash_parallel:error", "cash_parallel:legacy_untouched"],
        error: error?.message || String(error),
        updatedAt: nowIso()
      };
    }
  }

  normalizeGoldCashSnapshot(snapshot = {}, sourceUsed = "legacy") {
    const isCore = sourceUsed === "core";
    const billedDueCents = Number(isCore ? snapshot.billedDueCents : snapshot.operationalRevenueCents || snapshot.billedDueCents || 0);
    const reconciledCashCents = Number(snapshot.reconciledCashCents ?? snapshot.recordedCashCents ?? 0);
    const recordedCashCents = Number(snapshot.recordedCashCents ?? reconciledCashCents);
    const unlinkedCashCents = Number(snapshot.unlinkedCashCents || 0);
    const ambiguousCashCents = Number(isCore ? snapshot.ambiguousCashCents || 0 : 0);
    const overdueCents = Number.isFinite(Number(snapshot.overdueCents)) ? Number(snapshot.overdueCents || 0) : 0;
    const openResidualCents = Number.isFinite(Number(snapshot.openResidualCents))
      ? Number(snapshot.openResidualCents || 0)
      : Math.max(0, Number(snapshot.gapCents || 0));
    const gapCents = Number(snapshot.gapCents ?? (billedDueCents - reconciledCashCents));
    const collectionRatio = snapshot.collectionRatio ?? this.goldSafeDivide(reconciledCashCents, billedDueCents);
    const reconciliationRatio = snapshot.reconciliationRatio ?? this.goldSafeDivide(Math.max(0, recordedCashCents - unlinkedCashCents - ambiguousCashCents), recordedCashCents);
    const ambiguityRatio = snapshot.ambiguityRatio ?? this.goldSafeDivide(unlinkedCashCents + ambiguousCashCents, recordedCashCents);
    const overdueRatio = snapshot.overdueRatio ?? (openResidualCents > 0 ? this.goldSafeDivide(overdueCents, openResidualCents) : 0);
    return {
      mathCore: isCore ? "cash_core_v1" : "legacy_cash",
      sourceUsed,
      billedDueCents,
      reconciledCashCents,
      recordedCashCents,
      unlinkedCashCents,
      ambiguousCashCents,
      overdueCents,
      openResidualCents,
      gapCents,
      collectionRatio,
      reconciliationRatio,
      ambiguityRatio,
      overdueRatio,
      confidence: isCore ? snapshot.confidence || "INCOMPLETE" : snapshot.confidence || "ESTIMATED",
      confidenceScore: Number(isCore ? snapshot.confidenceScore || 0 : snapshot.confidenceScore ?? 0.65),
      sourceFlags: [
        `cash_primary_candidate:${sourceUsed}`,
        ...((snapshot.sourceFlags || []).map((item) => String(item)))
      ]
    };
  }

  buildGoldCashControlledSwitch(cashParallel = {}, previousSource = "legacy") {
    const status = cashParallel?.status || "error";
    const diff = cashParallel?.diffSnapshot || {};
    const coreRaw = cashParallel?.coreSnapshot || {};
    const legacyRaw = cashParallel?.legacySnapshot || {};
    const agreementScore = diff.agreementScore == null ? 0 : Number(diff.agreementScore || 0);
    const agreementBand = diff.agreementBand || "N/A";
    const coreConfidence = coreRaw.confidence || "INCOMPLETE";
    const coreConfidenceScore = Number(coreRaw.confidenceScore || 0);
    const dataCompleteness = Number(coreRaw.confidenceBreakdown?.dataCompleteness ?? 0);
    const reconciliationRatio = Number(coreRaw.reconciliationRatio ?? 0);
    const ambiguityRatio = Number(coreRaw.ambiguityRatio ?? 1);
    const switchEligible = status === "ok"
      && ["ALIGNED", "WATCH"].includes(agreementBand)
      && ["REAL", "STANDARD"].includes(coreConfidence)
      && agreementScore >= CASH_CONTROLLED_SWITCH_THRESHOLDS.agreementScore
      && coreConfidenceScore >= CASH_CONTROLLED_SWITCH_THRESHOLDS.coreConfidenceScore
      && dataCompleteness >= CASH_CONTROLLED_SWITCH_THRESHOLDS.dataCompleteness
      && reconciliationRatio >= CASH_CONTROLLED_SWITCH_THRESHOLDS.reconciliationRatio
      && ambiguityRatio <= CASH_CONTROLLED_SWITCH_THRESHOLDS.ambiguityRatio;
    const reliabilityScore = this.goldRound(
      (CASH_CONTROLLED_SWITCH_WEIGHTS.agreementScore * agreementScore)
      + (CASH_CONTROLLED_SWITCH_WEIGHTS.coreConfidenceScore * coreConfidenceScore)
      + (CASH_CONTROLLED_SWITCH_WEIGHTS.dataCompleteness * dataCompleteness),
      4
    );
    const normalizedPreviousSource = previousSource === "core" ? "core" : "legacy";
    const staysOnCore = normalizedPreviousSource === "core"
      && status === "ok"
      && agreementBand !== "DRIFT"
      && reliabilityScore >= CASH_CONTROLLED_SWITCH_THRESHOLDS.hysteresisOff;
    const switchesOnCore = normalizedPreviousSource === "legacy"
      && switchEligible
      && reliabilityScore >= CASH_CONTROLLED_SWITCH_THRESHOLDS.hysteresisOn;
    const primarySource = staysOnCore || switchesOnCore ? "core" : "legacy";
    const fallbackReasons = [];
    if (status !== "ok") fallbackReasons.push(`status_${status}`);
    if (!["ALIGNED", "WATCH"].includes(agreementBand)) fallbackReasons.push(`agreement_${agreementBand}`);
    if (!["REAL", "STANDARD"].includes(coreConfidence)) fallbackReasons.push(`confidence_${coreConfidence}`);
    if (agreementScore < CASH_CONTROLLED_SWITCH_THRESHOLDS.agreementScore) fallbackReasons.push("agreement_below_threshold");
    if (coreConfidenceScore < CASH_CONTROLLED_SWITCH_THRESHOLDS.coreConfidenceScore) fallbackReasons.push("core_confidence_below_threshold");
    if (dataCompleteness < CASH_CONTROLLED_SWITCH_THRESHOLDS.dataCompleteness) fallbackReasons.push("data_completeness_below_threshold");
    if (reconciliationRatio < CASH_CONTROLLED_SWITCH_THRESHOLDS.reconciliationRatio) fallbackReasons.push("reconciliation_below_threshold");
    if (ambiguityRatio > CASH_CONTROLLED_SWITCH_THRESHOLDS.ambiguityRatio) fallbackReasons.push("ambiguity_above_threshold");
    if (normalizedPreviousSource === "core" && primarySource === "legacy" && reliabilityScore < CASH_CONTROLLED_SWITCH_THRESHOLDS.hysteresisOff) fallbackReasons.push("hysteresis_off");
    return {
      cashSelection: {
        mode: "controlled_switch",
        primarySource,
        previousSource: normalizedPreviousSource,
        shadowSource: primarySource === "core" ? "legacy" : "core",
        switchEligible,
        reliabilityScore,
        agreementScore,
        agreementBand,
        coreConfidence,
        coreConfidenceScore,
        dataCompleteness,
        reconciliationRatio,
        ambiguityRatio,
        thresholds: CASH_CONTROLLED_SWITCH_THRESHOLDS,
        switchReason: primarySource === "core"
          ? (switchesOnCore ? "eligible_reliability_above_on_threshold" : "hysteresis_keep_core")
          : "",
        fallbackReason: primarySource === "legacy" ? (fallbackReasons.join("|") || "legacy_default") : ""
      },
      cashPrimarySnapshot: this.normalizeGoldCashSnapshot(primarySource === "core" ? coreRaw : legacyRaw, primarySource),
      cashShadowSnapshot: this.normalizeGoldCashSnapshot(primarySource === "core" ? legacyRaw : coreRaw, primarySource === "core" ? "legacy" : "core")
    };
  }

  buildDataQualityCoreInput(session = null, state = {}) {
    return {
      horizon: { startDate: "", endDate: "" },
      clients: this.filterByCenter(this.clientsRepository.list(), session),
      appointments: this.filterByCenter(this.appointmentsRepository.list(), session),
      payments: this.filterByCenter(this.paymentsRepository.list(), session),
      services: this.filterByCenter(this.servicesRepository.list(), session),
      staff: this.filterByCenter(this.staffRepository.list(), session),
      inventory: this.filterByCenter(this.inventoryRepository.list(), session),
      resources: this.filterByCenter(this.resourcesRepository.list(), session),
      goldState: state
    };
  }

  normalizeDataQualityBandFromScore(score = 0) {
    const value = Number(score || 0);
    if (value >= 0.90) return "REAL";
    if (value >= 0.75) return "STANDARD";
    if (value >= 0.50) return "ESTIMATED";
    return "INCOMPLETE";
  }

  scoreLegacyQualityBlock(block = {}) {
    if (!block || typeof block !== "object") return null;
    if (Number.isFinite(Number(block.issueRate))) return this.goldClamp01(1 - Number(block.issueRate || 0));
    const total = Number(block.totalRecords || 0);
    if (total <= 0) return null;
    return this.goldClamp01(1 - (Number(block.missingCount || 0) / total));
  }

  normalizeLegacyDataQualitySnapshot(legacy = {}) {
    const score = this.goldClamp01(Number(legacy.score || 0) / 100);
    const crmQuality = this.scoreLegacyQualityBlock(legacy.clients);
    const appointmentQuality = this.scoreLegacyQualityBlock(legacy.appointments);
    const paymentQuality = this.scoreLegacyQualityBlock(legacy.payments);
    const servicesQuality = this.scoreLegacyQualityBlock(legacy.services);
    const profitabilityQuality = this.scoreLegacyQualityBlock(legacy.profitability);
    const costValues = [servicesQuality, profitabilityQuality].filter((value) => value !== null && value !== undefined);
    const costQuality = costValues.length ? this.goldRound(average(costValues), 4) : null;
    return {
      source: "legacy",
      score,
      band: this.normalizeDataQualityBandFromScore(score),
      crmQuality,
      appointmentQuality,
      paymentQuality,
      costQuality,
      linkQuality: null,
      consistencyQuality: null,
      temporalQuality: null,
      dataQualityScore: score,
      gate: {
        aiGoldEligible: score >= 0.75,
        decisionEligible: score >= 0.80,
        forecastEligible: false,
        profitabilityReliable: costQuality !== null ? costQuality >= 0.75 : false,
        cashReliable: paymentQuality !== null ? paymentQuality >= 0.75 : false,
        marketingReliable: crmQuality !== null ? crmQuality >= 0.75 : false,
        reportReliable: score >= 0.70
      },
      sourceFlags: ["legacy:data_quality_penalty_model"]
    };
  }

  normalizeCoreDataQualitySnapshot(core = {}) {
    const scores = core.scores || {};
    return {
      source: "core",
      score: Number(scores.dataQualityScore || 0),
      band: core.band || this.normalizeDataQualityBandFromScore(scores.dataQualityScore || 0),
      crmQuality: Number(scores.crmQuality || 0),
      appointmentQuality: Number(scores.appointmentQuality || 0),
      paymentQuality: Number(scores.paymentQuality || 0),
      costQuality: Number(scores.costQuality || 0),
      linkQuality: Number(scores.linkQuality || 0),
      consistencyQuality: scores.consistencyQuality === null || scores.consistencyQuality === undefined ? null : Number(scores.consistencyQuality || 0),
      temporalQuality: Number(scores.temporalQuality || 0),
      dataQualityScore: Number(scores.dataQualityScore || 0),
      gate: core.gate || {},
      sourceFlags: core.sourceFlags || []
    };
  }

  buildDataQualityDiffSnapshot(legacySnapshot = {}, coreSnapshot = {}) {
    const metricMap = {
      dataQualityScore: { warning: "DQ_TOTAL_DRIFT" },
      paymentQuality: { warning: "DQ_PAYMENT_DRIFT" },
      costQuality: { warning: "DQ_COST_DRIFT" },
      crmQuality: { warning: "DQ_CRM_DRIFT" },
      appointmentQuality: { warning: "DQ_APPOINTMENT_DRIFT" },
      linkQuality: { warning: "DQ_LINK_DRIFT" },
      consistencyQuality: { warning: "DQ_CONSISTENCY_DRIFT" },
      temporalQuality: { warning: "DQ_TEMPORAL_DRIFT" }
    };
    const comparableMetrics = Object.keys(metricMap).filter((metric) => (
      legacySnapshot[metric] !== null
      && legacySnapshot[metric] !== undefined
      && coreSnapshot[metric] !== null
      && coreSnapshot[metric] !== undefined
      && Number.isFinite(Number(legacySnapshot[metric]))
      && Number.isFinite(Number(coreSnapshot[metric]))
    ));
    if (!comparableMetrics.length) {
      return {
        comparableMetrics: [],
        deltas: {},
        relativeErrors: {},
        agreementScore: null,
        agreementBand: "N/A",
        warnings: ["DQ_PARALLEL_NOT_COMPARABLE"],
        weightsUsed: {}
      };
    }
    const totalWeight = comparableMetrics.reduce((sum, metric) => sum + Number(DATA_QUALITY_PARALLEL_WEIGHTS[metric] || 0), 0) || comparableMetrics.length;
    const deltas = {};
    const relativeErrors = {};
    const weightsUsed = {};
    const warnings = [];
    const weightedError = comparableMetrics.reduce((sum, metric) => {
      const legacyValue = Number(legacySnapshot[metric] || 0);
      const coreValue = Number(coreSnapshot[metric] || 0);
      const delta = this.goldRound(coreValue - legacyValue, 4);
      const error = this.goldRound(Math.abs(coreValue - legacyValue), 4);
      const weight = Number(DATA_QUALITY_PARALLEL_WEIGHTS[metric] || 0) / totalWeight;
      deltas[metric] = delta;
      relativeErrors[metric] = error;
      weightsUsed[metric] = this.goldRound(weight, 4);
      if (error > DATA_QUALITY_PARALLEL_WARNING_THRESHOLD) warnings.push(metricMap[metric].warning);
      return sum + (weight * error);
    }, 0);
    const agreementScore = this.goldClamp01(1 - weightedError);
    const agreementBand = agreementScore >= 0.90 ? "ALIGNED" : agreementScore >= 0.75 ? "WATCH" : "DRIFT";
    return {
      comparableMetrics,
      deltas,
      relativeErrors,
      agreementScore: this.goldRound(agreementScore, 4),
      agreementBand,
      warnings,
      weightsUsed
    };
  }

  buildDataQualityParallelState(state = {}, session = null) {
    try {
      const coreInput = this.buildDataQualityCoreInput(session, state);
      const legacyRaw = this.getDataQuality(session, { summaryOnly: true });
      const legacySnapshot = this.normalizeLegacyDataQualitySnapshot(legacyRaw);
      const coreRaw = computeDataQualitySnapshot(coreInput);
      const operationalSnapshot = this.normalizeCoreDataQualitySnapshot(coreRaw);
      const adapter = adaptDataQualitySnapshotToLegacyComparable(operationalSnapshot, {
        rawData: coreInput,
        legacySnapshot
      });
      const comparableSnapshot = adapter.comparableSnapshot || operationalSnapshot;
      const rawDiffSnapshot = this.buildDataQualityDiffSnapshot(legacySnapshot, operationalSnapshot);
      const diffSnapshot = this.buildDataQualityDiffSnapshot(legacySnapshot, comparableSnapshot);
      const status = diffSnapshot.agreementBand === "N/A" ? "not_comparable" : "ok";
      return {
        mode: "shadow",
        status,
        mathCore: "data_quality_core_v1",
        mathAdapter: "dq_policy_adapter_v1",
        horizon: coreRaw.horizon || { startDate: "", endDate: "" },
        legacySnapshot,
        coreSnapshot: operationalSnapshot,
        operationalSnapshot,
        comparableSnapshot,
        rawDiffSnapshot,
        diffSnapshot,
        agreementScore: diffSnapshot.agreementScore,
        agreementBand: diffSnapshot.agreementBand,
        rawAgreementScore: rawDiffSnapshot.agreementScore,
        rawAgreementBand: rawDiffSnapshot.agreementBand,
        policyAdapter: {
          mathAdapter: adapter.mathAdapter,
          policyDeltas: adapter.policyDeltas,
          excludedFromAgreement: adapter.excludedFromAgreement,
          policyFlags: adapter.policyFlags,
          policyNotes: adapter.policyNotes
        },
        sourceFlags: [
          ...(legacySnapshot.sourceFlags || []),
          ...(operationalSnapshot.sourceFlags || []),
          ...(comparableSnapshot.sourceFlags || []),
          status === "not_comparable" ? "data_quality_parallel:not_comparable" : ""
        ].filter(Boolean)
      };
    } catch (error) {
      console.error("[data_quality_parallel_error]", JSON.stringify({
        centerId: this.getCenterId(session),
        message: error?.message || String(error)
      }));
      return {
        mode: "shadow",
        status: "error",
        mathCore: "data_quality_core_v1",
        mathAdapter: "dq_policy_adapter_v1",
        horizon: { startDate: "", endDate: "" },
        legacySnapshot: null,
        coreSnapshot: null,
        operationalSnapshot: null,
        comparableSnapshot: null,
        rawDiffSnapshot: null,
        diffSnapshot: {
          comparableMetrics: [],
          deltas: {},
          relativeErrors: {},
          agreementScore: null,
          agreementBand: "N/A",
          warnings: ["DQ_PARALLEL_ERROR"]
        },
        agreementScore: null,
        agreementBand: "N/A",
        rawAgreementScore: null,
        rawAgreementBand: "N/A",
        sourceFlags: ["data_quality_parallel:error"]
      };
    }
  }

  buildPialDataQualityComparison(dataQualityParallel = null) {
    const legacy = dataQualityParallel?.legacySnapshot || null;
    const core = dataQualityParallel?.coreSnapshot || null;
    const agreementScore = dataQualityParallel?.agreementScore ?? null;
    const agreementBand = dataQualityParallel?.agreementBand || "N/A";
    const coreBand = core?.band || "N/A";
    let recommendedSource = "legacy";
    if (dataQualityParallel?.status === "error" || agreementBand === "DRIFT") {
      recommendedSource = "legacy";
    } else if (agreementBand === "WATCH" || agreementBand === "N/A") {
      recommendedSource = "watch";
    } else if (agreementBand === "ALIGNED" && ["REAL", "STANDARD"].includes(coreBand)) {
      recommendedSource = "core";
    } else if (agreementBand === "ALIGNED") {
      recommendedSource = "watch";
    }
    return {
      mode: "shadow",
      legacyScore: legacy?.dataQualityScore ?? null,
      coreScore: core?.dataQualityScore ?? null,
      comparableScore: dataQualityParallel?.comparableSnapshot?.dataQualityScore ?? null,
      legacyBand: legacy?.band || "N/A",
      coreBand,
      comparableBand: dataQualityParallel?.comparableSnapshot?.band || "N/A",
      rawAgreementScore: dataQualityParallel?.rawAgreementScore ?? null,
      rawAgreementBand: dataQualityParallel?.rawAgreementBand || "N/A",
      agreementScore,
      agreementBand,
      recommendedSource
    };
  }

  buildMarketingCoreInput(session = null) {
    const endDate = toDateOnly(nowIso());
    const start = new Date(`${endDate}T00:00:00.000Z`);
    start.setDate(start.getDate() - 365);
    return {
      horizon: {
        startDate: toDateOnly(start.toISOString()),
        endDate,
        mode: "last_365_days_marketing_shadow"
      },
      now: nowIso(),
      goal: { type: "recall", seasonFit: 0.5 },
      schedule: {},
      clients: this.filterByCenter(this.clientsRepository.list(), session),
      appointments: this.filterByCenter(this.appointmentsRepository.list(), session),
      payments: this.filterByCenter(this.paymentsRepository.list(), session),
      services: this.filterByCenter(this.servicesRepository.list(), session),
      marketingHistory: [
        ...this.filterByCenter(this.aiMarketingActionsRepository.list(), session),
        ...this.filterByCenter(this.whatsappMessagesRepository.list(), session)
      ]
    };
  }

  normalizeCoreMarketingSnapshot(core = {}) {
    const scores = core.scores || {};
    const counts = core.counts || {};
    return {
      source: "core",
      readiness: Number(scores.marketingReadiness || 0),
      averageOpportunity: Number(scores.averageOpportunity || 0),
      averageChurnRisk: Number(scores.averageChurnRisk || 0),
      averageContactability: Number(scores.averageContactability || 0),
      averageSpamPressure: Number(scores.averageSpamPressure || 0),
      clients: Number(counts.clients || 0),
      eligibleClients: Number(counts.eligibleClients || 0),
      contactableClients: Number(counts.contactableClients || 0),
      suppressedClients: Number(counts.suppressedClients || 0),
      eligibleRatio: this.goldSafeDivide(counts.eligibleClients || 0, counts.clients || 0),
      contactableRatio: this.goldSafeDivide(counts.contactableClients || 0, counts.clients || 0),
      suppressedRatio: this.goldSafeDivide(counts.suppressedClients || 0, counts.clients || 0),
      topCandidates: (core.topCandidates || []).map((item) => ({
        clientId: String(item.clientId || ""),
        clientName: item.clientName || item.name || "Cliente",
        opportunityScore: Number(item.opportunityScore || 0),
        actionBand: item.actionBand || "MONITOR",
        contactability: Number(item.contactability || 0),
        spamPressure: Number(item.spamPressure || 0),
        reasonCodes: item.reasonCodes || [],
        sourceFlags: item.sourceFlags || []
      })),
      sourceFlags: core.sourceFlags || []
    };
  }

  normalizeLegacyMarketingSnapshot(marketingActions = {}) {
    const actions = Array.isArray(marketingActions.actions) ? marketingActions.actions : [];
    const debug = marketingActions.debug || {};
    const counters = marketingActions.counters || {};
    const analyzed = Number(debug.clientsAnalyzed || actions.length || 0);
    const eligibleClients = Number(counters.totalActions ?? actions.length);
    const contactableClients = actions.filter((item) => item.contactable || (item.hasMarketingConsent && (item.phone || item.email))).length;
    const suppressedClients = Number(debug.excludedByFilter || debug.nonContactable || 0);
    const scores = actions
      .map((item) => Number(item.goldDecision?.score ?? item.priorityScore ?? item.score ?? 0))
      .filter(Number.isFinite);
    const topCandidates = actions.map((item) => ({
      clientId: String(item.clientId || ""),
      clientName: item.clientName || item.name || "Cliente",
      opportunityScore: Number(item.goldDecision?.score ?? item.priorityScore ?? item.score ?? 0),
      actionBand: item.goldDecision?.action || item.actionBand || "",
      status: item.status || "",
      contactable: Boolean(item.contactable),
      sourceFlags: ["legacy:gold_marketing_action_state"]
    }));
    return {
      source: "legacy",
      readiness: null,
      averageOpportunity: scores.length ? this.goldRound(average(scores), 4) : null,
      averageChurnRisk: null,
      averageContactability: null,
      averageSpamPressure: null,
      clients: analyzed,
      eligibleClients,
      contactableClients,
      suppressedClients,
      eligibleRatio: analyzed ? this.goldSafeDivide(eligibleClients, analyzed) : null,
      contactableRatio: analyzed ? this.goldSafeDivide(contactableClients, analyzed) : null,
      suppressedRatio: analyzed ? this.goldSafeDivide(suppressedClients, analyzed) : null,
      topCandidates,
      sourceFlags: ["legacy:gold_marketing_action_state", "legacy:readiness_not_available"]
    };
  }

  buildMarketingDiffSnapshot(legacySnapshot = {}, coreSnapshot = {}) {
    const scalarMetrics = {
      readiness: { warning: "MARKETING_READINESS_DRIFT" },
      eligibleRatio: { warning: "MARKETING_ELIGIBLE_DRIFT" },
      contactableRatio: { warning: "MARKETING_CONTACTABLE_DRIFT" },
      suppressedRatio: { warning: "MARKETING_SUPPRESSED_DRIFT" },
      averageOpportunity: { warning: "MARKETING_OPPORTUNITY_DRIFT" }
    };
    const comparableScalars = Object.keys(scalarMetrics).filter((metric) => (
      legacySnapshot[metric] !== null
      && legacySnapshot[metric] !== undefined
      && coreSnapshot[metric] !== null
      && coreSnapshot[metric] !== undefined
      && Number.isFinite(Number(legacySnapshot[metric]))
      && Number.isFinite(Number(coreSnapshot[metric]))
    ));
    const legacyTop = (legacySnapshot.topCandidates || []).map((item) => String(item.clientId || "")).filter(Boolean).slice(0, 3);
    const coreTop = (coreSnapshot.topCandidates || []).map((item) => String(item.clientId || "")).filter(Boolean).slice(0, 3);
    const top3Comparable = legacyTop.length > 0 && coreTop.length > 0;
    const top3Overlap = top3Comparable
      ? this.goldSafeDivide(legacyTop.filter((clientId) => coreTop.includes(clientId)).length, Math.max(1, Math.min(3, legacyTop.length, coreTop.length)))
      : null;
    const comparableMetrics = [
      ...comparableScalars,
      ...(top3Comparable ? ["top3Overlap"] : [])
    ];
    if (!comparableMetrics.length) {
      return {
        comparableMetrics: [],
        deltas: {},
        relativeErrors: {},
        top3Overlap: null,
        agreementScore: null,
        agreementBand: "N/A",
        warnings: ["MARKETING_NOT_COMPARABLE"],
        weightsUsed: {}
      };
    }
    const rawWeights = {};
    comparableScalars.forEach((metric) => {
      rawWeights[metric] = Number(MARKETING_PARALLEL_WEIGHTS[metric] || 0);
    });
    if (top3Comparable) rawWeights.top3Overlap = MARKETING_PARALLEL_WEIGHTS.top3Overlap;
    const totalWeight = Object.values(rawWeights).reduce((sum, value) => sum + Number(value || 0), 0) || comparableMetrics.length;
    const deltas = {};
    const relativeErrors = {};
    const weightsUsed = {};
    const warnings = [];
    let weightedAgreement = 0;
    comparableScalars.forEach((metric) => {
      const legacyValue = Number(legacySnapshot[metric] || 0);
      const coreValue = Number(coreSnapshot[metric] || 0);
      const delta = this.goldRound(coreValue - legacyValue, 4);
      const error = this.goldRound(Math.abs(delta), 4);
      const match = this.goldClamp01(1 - error);
      const weight = Number(rawWeights[metric] || 0) / totalWeight;
      deltas[metric] = delta;
      relativeErrors[metric] = error;
      weightsUsed[metric] = this.goldRound(weight, 4);
      weightedAgreement += weight * match;
      if (error > MARKETING_PARALLEL_WARNING_THRESHOLD) warnings.push(scalarMetrics[metric].warning);
    });
    if (top3Comparable) {
      const weight = Number(rawWeights.top3Overlap || 0) / totalWeight;
      weightsUsed.top3Overlap = this.goldRound(weight, 4);
      weightedAgreement += weight * top3Overlap;
      if (top3Overlap < 0.67) warnings.push("MARKETING_TOPK_DRIFT");
    }
    const agreementScore = this.goldClamp01(weightedAgreement);
    const agreementBand = agreementScore >= 0.90 ? "ALIGNED" : agreementScore >= 0.75 ? "WATCH" : "DRIFT";
    return {
      comparableMetrics,
      deltas,
      relativeErrors,
      top3Overlap: top3Overlap === null ? null : this.goldRound(top3Overlap, 4),
      agreementScore: this.goldRound(agreementScore, 4),
      agreementBand,
      warnings,
      weightsUsed
    };
  }

  buildMarketingParallelState(state = {}, session = null) {
    try {
      const legacySnapshot = this.normalizeLegacyMarketingSnapshot(state.marketingActions || this.buildGoldMarketingActionState(session));
      const coreRaw = computeMarketingSnapshot(this.buildMarketingCoreInput(session));
      const coreSnapshot = this.normalizeCoreMarketingSnapshot(coreRaw);
      const diffSnapshot = this.buildMarketingDiffSnapshot(legacySnapshot, coreSnapshot);
      const status = diffSnapshot.agreementBand === "N/A" ? "not_comparable" : "ok";
      return {
        mode: "shadow",
        status,
        mathCore: "marketing_core_v1",
        horizon: coreRaw.horizon || {},
        legacySnapshot,
        coreSnapshot,
        diffSnapshot,
        agreementScore: diffSnapshot.agreementScore,
        agreementBand: diffSnapshot.agreementBand,
        sourceFlags: [
          "marketing_parallel:shadow_only",
          "marketing_parallel:no_primary_switch",
          "marketing_parallel:no_message_send",
          ...(legacySnapshot.sourceFlags || []),
          ...(coreSnapshot.sourceFlags || []),
          status === "not_comparable" ? "marketing_parallel:not_comparable" : ""
        ].filter(Boolean)
      };
    } catch (error) {
      console.error("[marketing_parallel_error]", JSON.stringify({
        centerId: this.getCenterId(session),
        message: error?.message || String(error)
      }));
      return {
        mode: "shadow",
        status: "error",
        mathCore: "marketing_core_v1",
        horizon: { startDate: "", endDate: "" },
        legacySnapshot: null,
        coreSnapshot: null,
        diffSnapshot: {
          comparableMetrics: [],
          deltas: {},
          relativeErrors: {},
          top3Overlap: null,
          agreementScore: null,
          agreementBand: "N/A",
          warnings: ["MARKETING_PARALLEL_ERROR"]
        },
        agreementScore: null,
        agreementBand: "N/A",
        sourceFlags: ["marketing_parallel:error", "marketing_parallel:legacy_untouched"]
      };
    }
  }

  refreshGoldDerivedState(state = {}, session = null) {
    const next = this.normalizeGoldStateComponents({ ...this.buildDefaultGoldState(state.centerId, state.centerName), ...state });
    const previousDecision = next.decision || null;
    const previousStability = next.decisionStability || this.buildDefaultGoldState(state.centerId, state.centerName).decisionStability;
    next.snapshots = this.buildGoldSnapshotsFromState(next);
    const hasDirtyState = Boolean(
      (Array.isArray(next.dirty?.components) && next.dirty.components.length)
      || (Array.isArray(next.dirty?.snapshots) && next.dirty.snapshots.length)
      || (Array.isArray(next.dirty?.signals) && next.dirty.signals.length)
    );
    next.marketingActions = !hasDirtyState && next.marketingActions
      ? next.marketingActions
      : this.buildGoldMarketingActionState(session);
    next.marketingParallel = !hasDirtyState && next.marketingParallel
      ? next.marketingParallel
      : this.buildMarketingParallelState(next, session);
    next.cashParallel = !hasDirtyState && next.cashParallel
      ? next.cashParallel
      : this.buildGoldCashParallelState(next, session);
    next.dataQualityParallel = !hasDirtyState && next.dataQualityParallel
      ? next.dataQualityParallel
      : this.buildDataQualityParallelState(next, session);
    const cashSwitch = this.buildGoldCashControlledSwitch(next.cashParallel, state.cashSelection?.primarySource || next.cashSelection?.primarySource || "legacy");
    next.cashSelection = cashSwitch.cashSelection;
    next.cashPrimarySnapshot = cashSwitch.cashPrimarySnapshot;
    next.cashShadowSnapshot = cashSwitch.cashShadowSnapshot;
    next.signals = this.buildGoldSignalsFromState(next);
    const stabilized = this.stabilizeGoldDecision(previousDecision, previousStability, this.buildGoldDecisionFromState(next));
    next.decision = stabilized.decision;
    next.decisionStability = stabilized.stability;
    return next;
  }

  applyGoldStateEvent(eventType, payload = {}, session = null) {
    if (this.getPlanLevel(session) !== "gold") return null;
    const centerId = this.getCenterId(session);
    const recordId = this.getGoldStateRecordId(centerId);
    const existing = this.goldStateRepository.findById(recordId) || this.buildDefaultGoldState(centerId, this.getCenterName(session));
    const state = this.refreshGoldDerivedState(existing, session);
    const counters = state.counters;
    const before = payload.before || null;
    const after = payload.after || payload.item || null;
    const addServiceMargin = (item, direction = 1) => {
      const ratio = this.goldServiceMarginRatio(item);
      if (ratio === null) return;
      counters.marginTotal += ratio * direction;
      counters.marginSamples = Math.max(0, counters.marginSamples + direction);
    };
    const profitabilityCoreEvents = new Set([
      "appointment_created",
      "appointment_updated",
      "appointment_deleted",
      "payment_created",
      "payment_updated",
      "service_created",
      "service_updated",
      "service_deleted",
      "staff_created",
      "staff_updated",
      "staff_deleted",
      "inventory_created",
      "inventory_updated",
      "inventory_deleted"
    ]);

    if (eventType === "appointment_created" && this.goldAppointmentActiveForToday(after)) counters.todayAppointments += 1;
    if (eventType === "appointment_deleted" && this.goldAppointmentActiveForToday(before)) counters.todayAppointments = Math.max(0, counters.todayAppointments - 1);
    if (eventType === "appointment_updated") {
      if (this.goldAppointmentActiveForToday(before) && !this.goldAppointmentActiveForToday(after)) counters.todayAppointments = Math.max(0, counters.todayAppointments - 1);
      if (!this.goldAppointmentActiveForToday(before) && this.goldAppointmentActiveForToday(after)) counters.todayAppointments += 1;
    }

    if (eventType === "client_created") {
      counters.clientsTotal += 1;
      if (this.goldClientIsActive(after)) counters.activeClients += 1;
      if (this.goldClientHasContact(after)) counters.clientsWithContact += 1;
    }
    if (eventType === "client_deleted") {
      counters.clientsTotal = Math.max(0, counters.clientsTotal - 1);
      if (this.goldClientIsActive(before)) counters.activeClients = Math.max(0, counters.activeClients - 1);
      if (this.goldClientHasContact(before)) counters.clientsWithContact = Math.max(0, counters.clientsWithContact - 1);
    }
    if (eventType === "client_updated") {
      if (!this.goldClientIsActive(before) && this.goldClientIsActive(after)) counters.activeClients += 1;
      if (this.goldClientIsActive(before) && !this.goldClientIsActive(after)) counters.activeClients = Math.max(0, counters.activeClients - 1);
      if (!this.goldClientHasContact(before) && this.goldClientHasContact(after)) counters.clientsWithContact += 1;
      if (this.goldClientHasContact(before) && !this.goldClientHasContact(after)) counters.clientsWithContact = Math.max(0, counters.clientsWithContact - 1);
    }

    if (eventType === "payment_created") {
      counters.revenueTotalCents += Number(after?.amountCents || 0);
      counters.paymentCount += 1;
      if (this.goldPaymentIsUnlinked(after)) counters.unlinkedPayments += 1;
    }
    if (eventType === "payment_updated") {
      counters.revenueTotalCents += Number(after?.amountCents || 0) - Number(before?.amountCents || 0);
      if (this.goldPaymentIsUnlinked(before) && !this.goldPaymentIsUnlinked(after)) counters.unlinkedPayments = Math.max(0, counters.unlinkedPayments - 1);
      if (!this.goldPaymentIsUnlinked(before) && this.goldPaymentIsUnlinked(after)) counters.unlinkedPayments += 1;
    }

    if (eventType === "service_created") {
      counters.servicesTotal += 1;
      if (this.goldServiceHasPrice(after)) counters.servicesWithPrice += 1;
      if (this.goldServiceHasCost(after)) counters.servicesWithCost += 1;
      addServiceMargin(after, 1);
    }
    if (eventType === "service_deleted") {
      counters.servicesTotal = Math.max(0, counters.servicesTotal - 1);
      if (this.goldServiceHasPrice(before)) counters.servicesWithPrice = Math.max(0, counters.servicesWithPrice - 1);
      if (this.goldServiceHasCost(before)) counters.servicesWithCost = Math.max(0, counters.servicesWithCost - 1);
      addServiceMargin(before, -1);
    }
    if (eventType === "service_updated") {
      if (!this.goldServiceHasPrice(before) && this.goldServiceHasPrice(after)) counters.servicesWithPrice += 1;
      if (this.goldServiceHasPrice(before) && !this.goldServiceHasPrice(after)) counters.servicesWithPrice = Math.max(0, counters.servicesWithPrice - 1);
      if (!this.goldServiceHasCost(before) && this.goldServiceHasCost(after)) counters.servicesWithCost += 1;
      if (this.goldServiceHasCost(before) && !this.goldServiceHasCost(after)) counters.servicesWithCost = Math.max(0, counters.servicesWithCost - 1);
      addServiceMargin(before, -1);
      addServiceMargin(after, 1);
    }

    if (eventType === "staff_created") {
      counters.staffTotal += 1;
      if (after?.active !== false && after?.active !== 0) counters.staffActive += 1;
    }
    if (eventType === "staff_deleted") {
      counters.staffTotal = Math.max(0, counters.staffTotal - 1);
      if (before?.active !== false && before?.active !== 0) counters.staffActive = Math.max(0, counters.staffActive - 1);
    }
    if (eventType === "staff_updated") {
      if ((before?.active === false || before?.active === 0) && after?.active !== false && after?.active !== 0) counters.staffActive += 1;
      if (before?.active !== false && before?.active !== 0 && (after?.active === false || after?.active === 0)) counters.staffActive = Math.max(0, counters.staffActive - 1);
    }

    if (eventType === "inventory_created") {
      counters.inventoryTotal += 1;
      if (this.goldInventoryIsLow(after)) counters.lowStock += 1;
    }
    if (eventType === "inventory_deleted") {
      counters.inventoryTotal = Math.max(0, counters.inventoryTotal - 1);
      if (this.goldInventoryIsLow(before)) counters.lowStock = Math.max(0, counters.lowStock - 1);
    }
    if (eventType === "inventory_updated") {
      if (!this.goldInventoryIsLow(before) && this.goldInventoryIsLow(after)) counters.lowStock += 1;
      if (this.goldInventoryIsLow(before) && !this.goldInventoryIsLow(after)) counters.lowStock = Math.max(0, counters.lowStock - 1);
    }

    if (profitabilityCoreEvents.has(eventType)) {
      this.refreshGoldProfitabilityCountersFromRepositories(counters, session);
    }

    this.markGoldStateDirty(state, eventType);
    state.eventSeq += 1;
    state.updatedAt = nowIso();
    state.lastEvent = { type: eventType, at: state.updatedAt, entityId: after?.id || before?.id || "" };
    const next = this.refreshGoldDerivedState(state, session);
    if (this.goldStateRepository.findById(recordId)) {
      this.goldStateRepository.update(recordId, () => next);
    } else {
      this.goldStateRepository.create(next);
    }
    return next;
  }

  hasProtocolAiAccess(session = null) {
    if (this.isSuperAdminSession(session)) return true;
    const plan = this.getPlanLevel(session);
    return plan === "silver" || plan === "gold";
  }

  getProtocolAiLimit(session = null) {
    if (this.isSuperAdminSession(session)) return 300;
    const plan = this.getPlanLevel(session);
    if (plan === "gold") return 300;
    if (plan === "silver") return 7;
    return 0;
  }

  assertCanOperate(session = null) {
    if (this.canOperate(session)) {
      return;
    }
    const reason = String(session?.accessState || "unauthorized");
    const error = new Error(
      reason === "expired"
        ? "Trial scaduto. Attiva il piano per continuare."
        : reason === "suspended"
          ? "Account sospeso. Contatta SkinHarmony per riattivarlo."
          : reason === "pending_verification"
            ? "Verifica prima la tua email per attivare la prova."
            : reason === "pending_payment"
              ? "Pagamento in attesa. Completa l'attivazione per continuare."
          : "Accesso operativo non disponibile."
    );
    error.code = reason;
    throw error;
  }

  buildTrialCredentials(centerName = "", email = "", businessModel = "esthetic") {
    const centerSlug = slugifySegment(centerName) || "centro";
    const modelSlug = slugifySegment(businessModel) || "trial";
    const localEmail = String(email || "").split("@")[0];
    const emailSlug = slugifySegment(localEmail);
    const base = sanitizeUsername(`${modelSlug}.${centerSlug}`.slice(0, 22)) || `trial.${Date.now()}`;
    let username = base;
    let suffix = 1;
    const users = this.usersRepository.list();
    while (users.some((item) => String(item.username || "").toLowerCase() === username)) {
      username = sanitizeUsername(`${base}${suffix}`) || `trial${Date.now()}${suffix}`;
      suffix += 1;
    }
    const password = `SH-${Math.random().toString(36).slice(2, 6).toUpperCase()}${String(Date.now()).slice(-4)}`;
    return {
      username: emailSlug && !users.some((item) => String(item.username || "").toLowerCase() === emailSlug) ? emailSlug : username,
      password
    };
  }

  serializeUserSummary(user = {}, options = {}) {
    const normalized = this.normalizeUserAccount(user);
    const summary = {
      id: normalized.id,
      username: normalized.username,
      role: normalized.role,
      active: normalized.active,
      centerId: normalized.centerId || DEFAULT_CENTER_ID,
      centerName: normalized.centerName || DEFAULT_CENTER_NAME,
      planType: normalized.planType,
      subscriptionPlan: normalized.subscriptionPlan,
      requestedSubscriptionPlan: normalized.requestedSubscriptionPlan || "",
      subscriptionChangeRequestedAt: normalized.subscriptionChangeRequestedAt || "",
      subscriptionChangeStatus: normalized.subscriptionChangeStatus || "",
      paymentStatus: normalized.paymentStatus,
      accountStatus: normalized.accountStatus,
      accessState: normalized.accessState,
      trialStartsAt: normalized.trialStartsAt || "",
      trialEndsAt: normalized.trialEndsAt || "",
      trialRemainingDays: normalized.trialRemainingDays || 0,
      businessModel: normalized.businessModel || "",
      ownerName: normalized.ownerName || "",
      contactEmail: normalized.contactEmail || "",
      contactPhone: normalized.contactPhone || "",
      emailVerifiedAt: normalized.emailVerifiedAt || "",
      createdAt: normalized.createdAt || nowIso(),
      activatedAt: normalized.activatedAt || ""
    };
    if (options.includeControlStats) {
      summary.controlStats = this.getCenterControlStats(summary.centerId);
    }
    return summary;
  }

  getRepositoryItems(repository) {
    const items = repository?.list?.();
    return Array.isArray(items) ? items : [];
  }

  getCenterRepositoryItems(repository, centerId) {
    return this.getRepositoryItems(repository).filter((item) => this.belongsToCenter(item, centerId));
  }

  getCenterControlStats(centerId) {
    const centerKey = String(centerId || DEFAULT_CENTER_ID);
    const collections = {
      clients: this.getCenterRepositoryItems(this.clientsRepository, centerKey),
      appointments: this.getCenterRepositoryItems(this.appointmentsRepository, centerKey),
      services: this.getCenterRepositoryItems(this.servicesRepository, centerKey),
      staff: this.getCenterRepositoryItems(this.staffRepository, centerKey),
      shifts: this.getCenterRepositoryItems(this.shiftsRepository, centerKey),
      inventory: this.getCenterRepositoryItems(this.inventoryRepository, centerKey),
      inventoryMovements: this.getCenterRepositoryItems(this.inventoryMovementsRepository, centerKey),
      payments: this.getCenterRepositoryItems(this.paymentsRepository, centerKey),
      cashClosures: this.getCenterRepositoryItems(this.cashClosuresRepository, centerKey),
      treatments: this.getCenterRepositoryItems(this.treatmentsRepository, centerKey),
      protocols: this.getCenterRepositoryItems(this.protocolsRepository, centerKey),
      sales: this.getCenterRepositoryItems(this.salesRepository, centerKey),
      users: this.getCenterRepositoryItems(this.usersRepository, centerKey)
    };
    const storageBytes = Object.values(collections).reduce(
      (total, items) => total + Buffer.byteLength(JSON.stringify(items || []), "utf8"),
      0
    );
    const sessions = Array.from(this.sessions.values()).filter((item) => String(item.centerId || "") === centerKey);
    return {
      clients: collections.clients.length,
      appointments: collections.appointments.length,
      services: collections.services.length,
      staff: collections.staff.length,
      shifts: collections.shifts.length,
      inventoryItems: collections.inventory.length,
      inventoryMovements: collections.inventoryMovements.length,
      payments: collections.payments.length,
      cashClosures: collections.cashClosures.length,
      treatments: collections.treatments.length,
      sales: collections.sales.length,
      users: collections.users.length,
      storageBytes,
      storageLabel: formatBytes(storageBytes),
      activeSessions: sessions.length,
      supportSessions: sessions.filter((item) => item.supportMode).length
    };
  }

  async getDatabaseUsage(session = null) {
    if (!this.isSuperAdminSession(session)) {
      throw new Error("Funzione riservata al super admin.");
    }
    if (!this.persistenceAdapter?.getDatabaseUsage) {
      return {
        connected: false,
        source: "json_locale",
        note: "Postgres non e attivo in questo ambiente."
      };
    }
    const freePlanLimitBytes = 1024 * 1024 * 1024;
    return this.persistenceAdapter.getDatabaseUsage({ limitBytes: freePlanLimitBytes });
  }

  getTrialPublicConfig() {
    return {
      trialDays: DEFAULT_TRIAL_DAYS,
      emailVerificationEnabled: isTrialEmailVerificationConfigured(),
      verificationWindowMinutes: DEFAULT_TRIAL_VERIFICATION_MINUTES,
      payment: getTrialPaymentConfig()
    };
  }

  belongsToCenter(item, centerId) {
    return String(item?.centerId || DEFAULT_CENTER_ID) === String(centerId || DEFAULT_CENTER_ID);
  }

  filterByCenter(items = [], session = null) {
    const centerId = this.getCenterId(session);
    return items.filter((item) => this.belongsToCenter(item, centerId));
  }

  isGlobalSkinHarmonyProtocol(item = {}) {
    return String(item.centerId || "") === SKINHARMONY_LIBRARY_CENTER_ID
      && String(item.libraryScope || "").toLowerCase() === "skinharmony";
  }

  findByIdInCenter(repository, id, session = null) {
    const current = repository.findById(id);
    if (!current || !this.belongsToCenter(current, this.getCenterId(session))) {
      return null;
    }
    return current;
  }

  updateInCenter(repository, id, updater, session = null) {
    const centerId = this.getCenterId(session);
    const current = repository.findById(id);
    if (!current || !this.belongsToCenter(current, centerId)) {
      throw new Error("Elemento non trovato");
    }
    const updated = repository.update(id, updater);
    this.invalidateBusinessSnapshot(centerId, this.dirtyBlocksForRepository(repository));
    return updated;
  }

  deleteInCenter(repository, id, session = null) {
    const centerId = this.getCenterId(session);
    const current = repository.findById(id);
    if (!current || !this.belongsToCenter(current, centerId)) {
      return { success: false };
    }
    const success = repository.delete(id);
    if (success) this.invalidateBusinessSnapshot(centerId, this.dirtyBlocksForRepository(repository));
    return { success };
  }

  findExistingByIdempotency(repository, payload = {}, session = null) {
    const key = idempotencyKey(payload);
    if (!key) return null;
    return this.filterByCenter(repository.list(), session).find((item) => item.idempotencyKey === key) || null;
  }

  deleteSafeTestData(payload = {}, session = null) {
    if (!this.isSuperAdminSession(session)) {
      throw new Error("Cleanup riservato al super admin");
    }
    const prefix = cleanText(payload.prefix || "STRESS_", "STRESS_", 80);
    if (!prefix || prefix.length < 6) {
      throw new Error("Prefisso cleanup troppo corto");
    }
    const centerId = cleanText(payload.centerId || "", "", 120);
    const shouldDelete = (item = {}) => {
      if (centerId && String(item.centerId || "") !== centerId) return false;
      const text = [
        item.id,
        item.username,
        item.centerName,
        item.name,
        item.firstName,
        item.lastName,
        item.clientName,
        item.walkInName,
        item.title,
        item.sku,
        item.notes,
        item.source
      ].map((value) => String(value || "")).join(" ");
      return text.includes(prefix);
    };
    const repositories = {
      users: this.usersRepository,
      clients: this.clientsRepository,
      appointments: this.appointmentsRepository,
      services: this.servicesRepository,
      staff: this.staffRepository,
      shifts: this.shiftsRepository,
      shiftTemplates: this.shiftTemplatesRepository,
      resources: this.resourcesRepository,
      inventory: this.inventoryRepository,
      inventoryMovements: this.inventoryMovementsRepository,
      payments: this.paymentsRepository,
      cashClosures: this.cashClosuresRepository,
      treatments: this.treatmentsRepository,
      protocols: this.protocolsRepository,
      aiMarketingActions: this.aiMarketingActionsRepository,
      goldState: this.goldStateRepository,
      whatsappMessages: this.whatsappMessagesRepository,
      sales: this.salesRepository
    };
    const deleted = {};
    Object.entries(repositories).forEach(([name, repository]) => {
      deleted[name] = repository.deleteWhere(shouldDelete);
    });
    return {
      success: true,
      prefix,
      centerId,
      deleted
    };
  }

  cleanupDemoTestCenters(payload = {}, session = null) {
    if (!this.isSuperAdminSession(session)) {
      throw new Error("Cleanup demo/test riservato al super admin");
    }
    const keepCenterIds = new Set(
      [DEFAULT_CENTER_ID]
        .concat(Array.isArray(payload.keepCenterIds) ? payload.keepCenterIds : [])
        .concat(payload.keepCenterId ? [payload.keepCenterId] : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    const keepUsernames = new Set(
      [DEFAULT_ADMIN_USERNAME]
        .concat(Array.isArray(payload.keepUsernames) ? payload.keepUsernames : [])
        .concat(payload.keepUsername ? [payload.keepUsername] : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const markerMatch = (text = "") => {
      const normalized = normalizeText(text);
      return (
        normalized.startsWith("tenant") ||
        normalized.includes("demo") ||
        normalized.includes("test") ||
        normalized.includes("stress") ||
        normalized.includes("qa") ||
        normalized.includes("sandbox")
      );
    };
    const users = this.usersRepository.list();
    const removableUsers = users.filter((user) => {
      const role = String(user.role || "").toLowerCase();
      const centerId = String(user.centerId || "").trim();
      const username = String(user.username || "").trim().toLowerCase();
      if (role === "superadmin") return false;
      if (keepCenterIds.has(centerId) || keepUsernames.has(username)) return false;
      return markerMatch(centerId) || markerMatch(username) || markerMatch(user.centerName || "") || markerMatch(user.businessName || "");
    });
    const centerIdsToDelete = Array.from(new Set(removableUsers.map((user) => String(user.centerId || "").trim()).filter(Boolean)));
    const belongsToDeletedCenter = (item = {}) => centerIdsToDelete.includes(String(item.centerId || "").trim());
    const repositories = {
      users: this.usersRepository,
      clients: this.clientsRepository,
      appointments: this.appointmentsRepository,
      services: this.servicesRepository,
      staff: this.staffRepository,
      shifts: this.shiftsRepository,
      shiftTemplates: this.shiftTemplatesRepository,
      resources: this.resourcesRepository,
      inventory: this.inventoryRepository,
      inventoryMovements: this.inventoryMovementsRepository,
      payments: this.paymentsRepository,
      cashClosures: this.cashClosuresRepository,
      treatments: this.treatmentsRepository,
      protocols: this.protocolsRepository,
      aiMarketingActions: this.aiMarketingActionsRepository,
      goldState: this.goldStateRepository,
      whatsappMessages: this.whatsappMessagesRepository,
      sales: this.salesRepository
    };
    const deleted = {};
    Object.entries(repositories).forEach(([name, repository]) => {
      deleted[name] = repository.deleteWhere((item) => belongsToDeletedCenter(item));
    });
    const settingsStore = this.settingsRepository.list();
    let removedSettingsCenters = 0;
    if (settingsStore && !Array.isArray(settingsStore) && typeof settingsStore === "object") {
      centerIdsToDelete.forEach((centerId) => {
        if (centerId !== "default" && settingsStore[centerId]) {
          delete settingsStore[centerId];
          removedSettingsCenters += 1;
        }
      });
      this.settingsRepository.write(settingsStore);
    }
    return {
      success: true,
      removedCenters: centerIdsToDelete,
      removedSettingsCenters,
      deleted
    };
  }

  resetCenterOperationalData(payload = {}, session = null) {
    if (!this.isSuperAdminSession(session)) {
      throw new Error("Reset riservato al super admin");
    }
    const centerId = cleanText(payload.centerId || "", "", 120);
    const confirm = cleanText(payload.confirm || "", "", 120);
    if (!centerId || centerId === DEFAULT_CENTER_ID) {
      throw new Error("Centro non valido per il reset");
    }
    if (confirm !== `RESET-${centerId}`) {
      throw new Error("Conferma reset non valida");
    }
    const repositories = {
      clients: this.clientsRepository,
      appointments: this.appointmentsRepository,
      services: this.servicesRepository,
      staff: this.staffRepository,
      shifts: this.shiftsRepository,
      shiftTemplates: this.shiftTemplatesRepository,
      resources: this.resourcesRepository,
      inventory: this.inventoryRepository,
      inventoryMovements: this.inventoryMovementsRepository,
      payments: this.paymentsRepository,
      cashClosures: this.cashClosuresRepository,
      treatments: this.treatmentsRepository,
      protocols: this.protocolsRepository,
      aiMarketingActions: this.aiMarketingActionsRepository,
      goldState: this.goldStateRepository,
      whatsappMessages: this.whatsappMessagesRepository,
      sales: this.salesRepository
    };
    const deleted = {};
    Object.entries(repositories).forEach(([name, repository]) => {
      deleted[name] = repository.deleteWhere((item) => this.belongsToCenter(item, centerId));
    });
    return {
      success: true,
      centerId,
      deleted,
      remaining: this.getCenterControlStats(centerId)
    };
  }

  createRepository(name, defaultValue) {
    return new JsonFileRepository(
      path.join(DATA_DIR, `${name}.json`),
      defaultValue,
      { adapter: this.persistenceAdapter, collectionName: name }
    );
  }

  async init() {
    if (this.persistenceAdapter) {
      await this.persistenceAdapter.init([
        { name: "clients", filePath: path.join(DATA_DIR, "clients.json"), defaultValue: [] },
        { name: "appointments", filePath: path.join(DATA_DIR, "appointments.json"), defaultValue: [] },
        { name: "services", filePath: path.join(DATA_DIR, "services.json"), defaultValue: [] },
        { name: "staff", filePath: path.join(DATA_DIR, "staff.json"), defaultValue: [] },
        { name: "shifts", filePath: path.join(DATA_DIR, "shifts.json"), defaultValue: [] },
        { name: "shift_templates", filePath: path.join(DATA_DIR, "shift_templates.json"), defaultValue: [] },
        { name: "resources", filePath: path.join(DATA_DIR, "resources.json"), defaultValue: [] },
        { name: "inventory", filePath: path.join(DATA_DIR, "inventory.json"), defaultValue: [] },
        { name: "inventory_movements", filePath: path.join(DATA_DIR, "inventory_movements.json"), defaultValue: [] },
        { name: "payments", filePath: path.join(DATA_DIR, "payments.json"), defaultValue: [] },
        { name: "cash_closures", filePath: path.join(DATA_DIR, "cash_closures.json"), defaultValue: [] },
        { name: "treatments", filePath: path.join(DATA_DIR, "treatments.json"), defaultValue: [] },
        { name: "protocols", filePath: path.join(DATA_DIR, "protocols.json"), defaultValue: [] },
        { name: "ai_marketing_actions", filePath: path.join(DATA_DIR, "ai_marketing_actions.json"), defaultValue: [] },
        { name: "dashboard_snapshots", filePath: path.join(DATA_DIR, "dashboard_snapshots.json"), defaultValue: [] },
        { name: "gold_state", filePath: path.join(DATA_DIR, "gold_state.json"), defaultValue: [] },
        { name: "gold_decision_history", filePath: path.join(DATA_DIR, "gold_decision_history.json"), defaultValue: [] },
        { name: "gold_action_outcomes", filePath: path.join(DATA_DIR, "gold_action_outcomes.json"), defaultValue: [] },
        { name: "whatsapp_messages", filePath: path.join(DATA_DIR, "whatsapp_messages.json"), defaultValue: [] },
        { name: "users", filePath: path.join(DATA_DIR, "users.json"), defaultValue: [] },
        { name: "sales", filePath: path.join(DATA_DIR, "sales.json"), defaultValue: [] },
        { name: "settings", filePath: path.join(DATA_DIR, "settings.json"), defaultValue: defaultSettings }
      ]);
    }

    this.ensureInitialAdmin();
    this.ensureSkinHarmonyProtocolLibrary();
    this.ensureDefaultStaffForCenter(DEFAULT_CENTER_ID, DEFAULT_CENTER_NAME);
  }

  ensureSkinHarmonyProtocolLibrary() {
    const current = this.protocolsRepository.list();
    const now = nowIso();
    const currentById = new Map(current.map((item) => [String(item.id || ""), item]));
    let changed = false;
    const nextItems = [...current];
    skinHarmonyProtocolLibrary.forEach((protocol) => {
      const existing = currentById.get(protocol.id);
      const nextProtocol = {
        ...protocol,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      if (existing) {
        const index = nextItems.findIndex((item) => item.id === protocol.id);
        nextItems[index] = {
          ...existing,
          ...nextProtocol,
          centerId: SKINHARMONY_LIBRARY_CENTER_ID,
          libraryScope: "skinharmony",
          source: "skinharmony_library",
          status: "active"
        };
        changed = true;
        return;
      }
      nextItems.unshift(nextProtocol);
      changed = true;
    });
    if (changed) {
      this.protocolsRepository.write(nextItems);
    }
  }

  ensureInitialAdmin() {
    const users = this.usersRepository.list();
    const admin = users.find((item) => String(item.role || "").toLowerCase() === "superadmin");
    if (!admin) {
      this.usersRepository.create({
        id: makeId("user"),
        username: DEFAULT_ADMIN_USERNAME,
        passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
        role: "superadmin",
        active: true,
        centerId: DEFAULT_CENTER_ID,
        centerName: DEFAULT_CENTER_NAME,
        planType: "active",
        accountStatus: "active",
        paymentStatus: "paid",
        activatedAt: nowIso(),
        createdAt: nowIso()
      });
      return;
    }
    this.usersRepository.update(admin.id, (current) => ({
      ...current,
      username: DEFAULT_ADMIN_USERNAME,
      passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
      role: "superadmin",
      active: true,
      centerId: DEFAULT_CENTER_ID,
      centerName: DEFAULT_CENTER_NAME,
      planType: "active",
      accountStatus: "active",
      paymentStatus: "paid",
      activatedAt: current.activatedAt || nowIso(),
      updatedAt: nowIso()
    }));
  }

  ensureDefaultStaffForCenter(centerId, centerName = DEFAULT_CENTER_NAME) {
    const staff = this.staffRepository.list().filter((item) => this.belongsToCenter(item, centerId));
    if (staff.length) return;
    DEFAULT_STAFF.forEach((item) => {
      this.staffRepository.create({
        ...item,
        centerId,
        centerName,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    });
  }

  readSettingsStore() {
    const current = this.settingsRepository.list();
    if (!current || Array.isArray(current)) return {};
    if (current.centerName || current.centerType || current.businessModel) {
      return {
        [DEFAULT_CENTER_ID]: { ...defaultSettings, ...current }
      };
    }
    return current;
  }

  getSettings(session = null) {
    const store = this.readSettingsStore();
    const centerId = this.getCenterId(session);
    return { ...defaultSettings, ...(store[centerId] || {}), centerId };
  }

  saveSettings(payload = {}, session = null) {
    const store = this.readSettingsStore();
    const centerId = this.getCenterId(session);
    const next = { ...this.getSettings(session), ...payload, centerId, updatedAt: nowIso() };
    store[centerId] = next;
    this.settingsRepository.write(store);
    return next;
  }

  resetSettings(session = null) {
    const store = this.readSettingsStore();
    const centerId = this.getCenterId(session);
    const next = { ...defaultSettings, centerId, centerName: this.getCenterName(session), updatedAt: nowIso() };
    store[centerId] = next;
    this.settingsRepository.write(store);
    return next;
  }

  buildSession(user, token = crypto.randomUUID(), extra = {}) {
    const normalized = this.normalizeUserAccount(user);
    return {
      token: String(token),
      userId: normalized.id,
      username: normalized.username,
      role: normalized.role || "superadmin",
      centerId: normalized.centerId || DEFAULT_CENTER_ID,
      centerName: normalized.centerName || DEFAULT_CENTER_NAME,
      planType: normalized.planType,
      subscriptionPlan: normalized.subscriptionPlan,
      paymentStatus: normalized.paymentStatus,
      accountStatus: normalized.accountStatus,
      accessState: normalized.accessState,
      trialStartsAt: normalized.trialStartsAt || "",
      trialEndsAt: normalized.trialEndsAt || "",
      trialRemainingDays: normalized.trialRemainingDays || 0,
      businessModel: normalized.businessModel || "",
      emailVerifiedAt: normalized.emailVerifiedAt || "",
      createdAt: nowIso()
      ,
      ...extra
    };
  }

  createSession(user) {
    const session = this.buildSession(user);
    this.sessions.set(session.token, session);
    return session;
  }

  createSupportSessionForUser(userId, session = null) {
    if (!this.isSuperAdminSession(session)) {
      throw new Error("Operazione riservata al supporto SkinHarmony");
    }
    const user = this.usersRepository.findById(userId);
    if (!user) {
      throw new Error("Centro non trovato");
    }
    const supportSession = this.buildSession(user, crypto.randomUUID(), {
      username: session.username || "supporto",
      role: "superadmin",
      supportMode: true,
      supportBy: session.username || "supporto",
      supportTargetUserId: user.id,
      supportTargetUsername: user.username || "",
      supportTargetRole: user.role || "owner"
    });
    this.sessions.set(supportSession.token, supportSession);
    return supportSession;
  }

  invalidateSessionsForUser(userId) {
    for (const [token, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        this.sessions.delete(token);
      }
    }
  }

  login(payload = {}) {
    const username = sanitizeUsername(payload.username || payload.email || "");
    const password = String(payload.password || "");
    const user = this.usersRepository.list().find((item) => String(item.username || "").toLowerCase() === username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Credenziali non valide");
    }
    const normalized = this.normalizeUserAccount(user);
    if (normalized.accountStatus === "pending_verification") {
      throw new Error("Verifica prima la tua email per attivare la prova.");
    }
    if (normalized.accountStatus === "pending_payment") {
      throw new Error("Pagamento in attesa. Completa l'attivazione per continuare.");
    }
    if (normalized.active === false || normalized.accountStatus === "suspended") {
      throw new Error("Account sospeso. Contatta SkinHarmony.");
    }
    if (normalized.accountStatus !== user.accountStatus || normalized.trialEndsAt !== user.trialEndsAt) {
      this.usersRepository.update(user.id, (current) => ({ ...current, ...normalized, updatedAt: nowIso() }));
    }
    return this.createSession(user);
  }

  getSession(token) {
    const sessionToken = String(token || "");
    const current = this.sessions.get(sessionToken);
    if (!current) return null;
    const user = this.usersRepository.findById(current.userId);
    if (!user) {
      this.sessions.delete(sessionToken);
      return null;
    }
    const supportExtra = current.supportMode ? {
      username: current.username || "",
      role: current.role || "superadmin",
      supportMode: Boolean(current.supportMode),
      supportBy: current.supportBy || "",
      supportTargetUserId: current.supportTargetUserId || user.id,
      supportTargetUsername: current.supportTargetUsername || user.username || "",
      supportTargetRole: current.supportTargetRole || user.role || "owner"
    } : {
      supportMode: false,
      supportBy: ""
    };
    const refreshed = this.buildSession({ ...user, id: user.id }, sessionToken, supportExtra);
    this.sessions.set(sessionToken, refreshed);
    return refreshed;
  }

  logout(token) {
    this.sessions.delete(String(token || ""));
    return { success: true };
  }

  listAccessUsers(session = null) {
    const users = this.usersRepository.list();
    const includeControlStats = this.isSuperAdminSession(session);
    const visible = this.isSuperAdminSession(session)
      ? users
      : users.filter((item) => this.belongsToCenter(item, this.getCenterId(session)));
    return visible.map((item) => this.serializeUserSummary(item, { includeControlStats }));
  }

  createAccessUser(payload = {}, session = null) {
    const username = sanitizeUsername(payload.username || payload.email || "");
    if (!username) throw new Error("Username obbligatorio");
    if (this.usersRepository.list().some((item) => String(item.username || "").toLowerCase() === username)) {
      throw new Error("Utente già presente");
    }
    const canCreateCenter = this.isSuperAdminSession(session);
    const centerId = String(canCreateCenter ? (payload.centerId || makeId("center")) : this.getCenterId(session));
    const centerName = String(canCreateCenter ? (payload.centerName || payload.businessName || username) : this.getCenterName(session));
    const now = nowIso();
    const planType = String(payload.planType || "trial");
    const trialDays = Number(payload.trialDays || DEFAULT_TRIAL_DAYS);
    const trialStartsAt = planType === "trial" ? String(payload.trialStartsAt || now) : "";
    const trialEndsAt = planType === "trial" ? String(payload.trialEndsAt || addDaysIso(trialStartsAt, trialDays)) : "";
    const user = {
      id: makeId("user"),
      username,
      passwordHash: hashPassword(String(payload.password || "changeme123")),
      role: String(payload.role || (canCreateCenter ? "staff" : "staff")),
      active: payload.active !== false,
      centerId,
      centerName,
      ownerName: String(payload.ownerName || payload.referentName || ""),
      contactEmail: String(payload.contactEmail || payload.email || ""),
      contactPhone: String(payload.contactPhone || payload.phone || ""),
      businessModel: String(payload.businessModel || "esthetic"),
      planType,
      subscriptionPlan: String(payload.subscriptionPlan || (String(payload.role || "") === "superadmin" ? "gold" : "base")),
      trialDays,
      trialStartsAt,
      trialEndsAt,
      paymentStatus: String(payload.paymentStatus || (planType === "active" ? "paid" : "pending")),
      accountStatus: String(payload.accountStatus || (planType === "active" ? "active" : "trial")),
      emailVerifiedAt: String(payload.emailVerifiedAt || ""),
      emailVerificationCode: String(payload.emailVerificationCode || ""),
      emailVerificationExpiresAt: String(payload.emailVerificationExpiresAt || ""),
      emailVerificationSentAt: String(payload.emailVerificationSentAt || ""),
      activatedAt: planType === "active" ? String(payload.activatedAt || now) : "",
      createdAt: now,
      updatedAt: now
    };
    this.usersRepository.create(user);
    this.ensureDefaultStaffForCenter(centerId, centerName);
    this.saveSettings({
      centerName,
      businessModel: user.businessModel
    }, { centerId, centerName, role: session?.role || "superadmin" });
    return this.listAccessUsers(session).find((item) => item.id === user.id) || this.serializeUserSummary(user, { includeControlStats: this.isSuperAdminSession(session) });
  }

  requestTrial(payload = {}) {
    const centerName = String(payload.centerName || payload.businessName || "").trim();
    const ownerName = String(payload.ownerName || payload.referentName || "").trim();
    const contactEmail = String(payload.contactEmail || payload.email || "").trim().toLowerCase();
    const confirmEmail = String(payload.confirmEmail || "").trim().toLowerCase();
    const contactPhone = String(payload.contactPhone || payload.phone || "").trim();
    const businessModel = String(payload.businessModel || "esthetic");
    const chosenUsername = sanitizeUsername(String(payload.username || "").trim());
    const chosenPassword = String(payload.password || "");
    const privacyConsent = Boolean(payload.privacyConsent);
    const policyConsent = Boolean(payload.policyConsent);
    const emailConfirmed = Boolean(payload.emailConfirmed);
    if (!centerName) throw new Error("Nome centro obbligatorio");
    if (!ownerName) throw new Error("Nome referente obbligatorio");
    if (!contactEmail) throw new Error("Email obbligatoria");
    if (!confirmEmail || confirmEmail !== contactEmail) throw new Error("Le email non coincidono");
    if (!chosenUsername) throw new Error("Username obbligatorio");
    if (chosenPassword.length < 8) throw new Error("La password deve contenere almeno 8 caratteri");
    if (!emailConfirmed) throw new Error("Devi confermare che l'email inserita è corretta");
    if (!privacyConsent || !policyConsent) throw new Error("Devi confermare privacy e policy prima di attivare la prova");
    const alreadyPresent = this.usersRepository.list().find((item) => String(item.contactEmail || "").toLowerCase() === contactEmail);
    if (alreadyPresent) {
      throw new Error("Esiste già un accesso associato a questa email");
    }
    if (this.usersRepository.list().some((item) => String(item.username || "").toLowerCase() === chosenUsername)) {
      throw new Error("Username già presente");
    }
    const centerId = makeId("center");
    const trialDays = Number(payload.trialDays || DEFAULT_TRIAL_DAYS);
    const verificationEnabled = isTrialEmailVerificationConfigured();
    const verificationToken = verificationEnabled ? makeSecureToken() : "";
    const verificationRequestedAt = nowIso();
    const user = this.createAccessUser({
      username: chosenUsername,
      password: chosenPassword,
      role: "owner",
      centerId,
      centerName,
      ownerName,
      contactEmail,
      contactPhone,
      businessModel,
      planType: "trial",
      trialDays,
      trialStartsAt: verificationRequestedAt,
      accountStatus: verificationEnabled ? "pending_verification" : "trial",
      paymentStatus: "trial_free",
      emailVerifiedAt: verificationEnabled ? "" : verificationRequestedAt,
      emailVerificationCode: "",
      emailVerificationTokenHash: verificationEnabled ? hashToken(verificationToken) : "",
      emailVerificationExpiresAt: verificationEnabled ? addMinutesIso(verificationRequestedAt, DEFAULT_TRIAL_VERIFICATION_MINUTES) : "",
      emailVerificationSentAt: verificationEnabled ? verificationRequestedAt : ""
    }, { role: "superadmin", centerId: DEFAULT_CENTER_ID, centerName: DEFAULT_CENTER_NAME });
    return {
      success: true,
      message: verificationEnabled
        ? `Ti abbiamo inviato un codice email. Dopo la verifica, la prova gratuita durerà ${trialDays} giorni.`
        : `Prova gratuita attivata per ${trialDays} giorni`,
      credentials: {
        username: chosenUsername
      },
      verification: {
        required: verificationEnabled,
        email: contactEmail,
        token: verificationToken
      },
      payment: getTrialPaymentConfig(),
      user
    };
  }

  verifyTrialEmailToken(payload = {}) {
    const token = String(payload.token || "").trim();
    if (!token) throw new Error("Token verifica obbligatorio");
    const tokenHash = hashToken(token);
    const user = this.usersRepository.list().find((item) => String(item.emailVerificationTokenHash || "") === tokenHash);
    if (!user) throw new Error("Link di verifica non valido");
    if (String(user.emailVerifiedAt || "").trim()) {
      return {
        success: true,
        message: "Email già verificata. Puoi accedere al gestionale.",
        user: this.serializeUserSummary(user)
      };
    }
    if (user.emailVerificationExpiresAt && new Date(user.emailVerificationExpiresAt).getTime() < Date.now()) {
      throw new Error("Link di verifica scaduto. Richiedi una nuova attivazione.");
    }
    const verifiedAt = nowIso();
    const next = this.usersRepository.update(user.id, (current) => this.normalizeUserAccount({
      ...current,
      emailVerifiedAt: verifiedAt,
      emailVerificationCode: "",
      emailVerificationTokenHash: "",
      emailVerificationExpiresAt: "",
      accountStatus: "trial",
      updatedAt: verifiedAt
    }));
    return {
      success: true,
      message: "Email verificata. La tua prova gratuita è attiva.",
      payment: getTrialPaymentConfig(),
      user: this.serializeUserSummary(next || user)
    };
  }

  requestPasswordReset(payload = {}) {
    const identifier = sanitizeUsername(payload.identifier || payload.username || payload.email || "").trim();
    const emailIdentifier = String(payload.identifier || payload.email || "").trim().toLowerCase();
    const user = this.usersRepository.list().find((item) =>
      String(item.username || "").toLowerCase() === identifier ||
      String(item.contactEmail || "").toLowerCase() === emailIdentifier
    );
    if (!user || !String(user.contactEmail || "").trim()) {
      return {
        success: true,
        message: "Se l'account esiste, abbiamo inviato una mail per reimpostare la password."
      };
    }
    const resetToken = makeSecureToken();
    const resetIssuedAt = nowIso();
    this.usersRepository.update(user.id, (current) => ({
      ...current,
      passwordResetTokenHash: hashToken(resetToken),
      passwordResetExpiresAt: addMinutesIso(resetIssuedAt, 30),
      passwordResetSentAt: resetIssuedAt,
      updatedAt: resetIssuedAt
    }));
    return {
      success: true,
      message: "Se l'account esiste, abbiamo inviato una mail per reimpostare la password.",
      delivery: {
        email: String(user.contactEmail || "").trim().toLowerCase(),
        token: resetToken
      }
    };
  }

  resetPasswordWithToken(payload = {}) {
    const token = String(payload.token || "").trim();
    const password = String(payload.password || "");
    if (!token) throw new Error("Token reset obbligatorio");
    if (password.length < 8) throw new Error("La password deve contenere almeno 8 caratteri");
    const tokenHash = hashToken(token);
    const user = this.usersRepository.list().find((item) => String(item.passwordResetTokenHash || "") === tokenHash);
    if (!user) throw new Error("Link reset non valido");
    if (user.passwordResetExpiresAt && new Date(user.passwordResetExpiresAt).getTime() < Date.now()) {
      throw new Error("Link reset scaduto. Richiedi una nuova email.");
    }
    const changedAt = nowIso();
    const next = this.usersRepository.update(user.id, (current) => ({
      ...current,
      passwordHash: hashPassword(password),
      passwordResetTokenHash: "",
      passwordResetExpiresAt: "",
      passwordResetSentAt: "",
      lastPasswordChangeAt: changedAt,
      updatedAt: changedAt
    }));
    this.invalidateSessionsForUser(user.id);
    return {
      success: true,
      message: "Password aggiornata correttamente. Ora puoi accedere.",
      user: this.serializeUserSummary(next || user)
    };
  }

  updateAccessUserStatus(userId, payload = {}, session = null) {
    if (!this.isSuperAdminSession(session)) {
      throw new Error("Operazione riservata al supporto SkinHarmony");
    }
    const current = this.usersRepository.findById(userId);
    if (!current) throw new Error("Utente non trovato");
    const now = nowIso();
    const next = this.usersRepository.update(userId, (user) => {
      const merged = {
        ...user,
        active: payload.active === undefined ? user.active : payload.active !== false,
        planType: payload.planType || user.planType,
        subscriptionPlan: payload.subscriptionPlan || user.subscriptionPlan,
        requestedSubscriptionPlan: payload.requestedSubscriptionPlan === undefined ? user.requestedSubscriptionPlan : payload.requestedSubscriptionPlan,
        subscriptionChangeRequestedAt: payload.subscriptionChangeRequestedAt === undefined ? user.subscriptionChangeRequestedAt : payload.subscriptionChangeRequestedAt,
        subscriptionChangeStatus: payload.subscriptionChangeStatus === undefined ? user.subscriptionChangeStatus : payload.subscriptionChangeStatus,
        paymentStatus: payload.paymentStatus || user.paymentStatus,
        accountStatus: payload.accountStatus || user.accountStatus,
        trialStartsAt: payload.trialStartsAt || user.trialStartsAt,
        trialEndsAt: payload.trialEndsAt || user.trialEndsAt,
        activatedAt: payload.activatedAt || user.activatedAt,
        updatedAt: now
      };
      if (payload.extendTrialDays) {
        const base = merged.trialEndsAt || merged.trialStartsAt || now;
        merged.trialEndsAt = addDaysIso(base, Number(payload.extendTrialDays || 0));
        merged.accountStatus = "trial";
        merged.planType = "trial";
      }
      if (payload.markPaid === true || merged.planType === "active") {
        merged.planType = "active";
        merged.paymentStatus = "paid";
        merged.accountStatus = "active";
        merged.activatedAt = payload.activatedAt || now;
      }
      if (payload.subscriptionPlan) {
        merged.requestedSubscriptionPlan = "";
        merged.subscriptionChangeRequestedAt = "";
        merged.subscriptionChangeStatus = "";
      }
      if (payload.suspend === true) {
        merged.active = false;
        merged.accountStatus = "suspended";
      }
      if (payload.resetPassword) {
        merged.passwordHash = hashPassword(String(payload.resetPassword));
      }
      return this.normalizeUserAccount(merged);
    });
    return this.serializeUserSummary(next || current, { includeControlStats: this.isSuperAdminSession(session) });
  }

  requestSubscriptionChange(payload = {}, session = null) {
    this.assertCanOperate(session);
    const requestedPlan = String(payload.subscriptionPlan || "").toLowerCase();
    if (!["base", "silver", "gold"].includes(requestedPlan)) {
      throw new Error("Piano richiesto non valido");
    }
    const current = this.usersRepository.findById(session.userId);
    if (!current) throw new Error("Utente non trovato");
    const now = nowIso();
    const next = this.usersRepository.update(current.id, (user) => this.normalizeUserAccount({
      ...user,
      requestedSubscriptionPlan: requestedPlan,
      subscriptionChangeRequestedAt: now,
      subscriptionChangeStatus: "pending",
      updatedAt: now
    }));
    return {
      success: true,
      message: `Richiesta cambio piano a ${requestedPlan} inviata a SkinHarmony.`,
      user: this.serializeUserSummary(next || current)
    };
  }

  getSmartDeskPlanFromWooCommerceOrder(order = {}) {
    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    const candidates = lineItems.map((item) => {
      const sku = normalizeText(item.sku || "");
      const name = normalizeText(item.name || "");
      return `${sku} ${name}`;
    });
    const text = candidates.join(" ");
    const plan = text.includes("gold")
      ? "gold"
      : text.includes("silver")
        ? "silver"
        : text.includes("base")
          ? "base"
          : "";
    const cycle = text.includes("year") || text.includes("annuale")
      ? "yearly"
      : text.includes("month") || text.includes("mensile")
        ? "monthly"
        : "";
    return { plan, cycle };
  }

  activateSubscriptionFromWooCommerceOrder(order = {}) {
    const orderStatus = String(order.status || "").toLowerCase();
    if (!["processing", "completed"].includes(orderStatus)) {
      return {
        success: true,
        ignored: true,
        reason: `Ordine WooCommerce non pagato o non completato: ${orderStatus || "stato mancante"}`,
        orderId: order.id || ""
      };
    }
    const { plan, cycle } = this.getSmartDeskPlanFromWooCommerceOrder(order);
    if (!plan) {
      return {
        success: true,
        ignored: true,
        reason: "Ordine pagato ma nessun piano Smart Desk riconosciuto",
        orderId: order.id || ""
      };
    }
    const email = String(order.billing?.email || order.customer?.email || "").trim().toLowerCase();
    if (!email) {
      throw new Error("Email cliente WooCommerce mancante");
    }
    const user = this.usersRepository.list().find((item) =>
      String(item.contactEmail || "").trim().toLowerCase() === email ||
      String(item.username || "").trim().toLowerCase() === email
    );
    if (!user) {
      return {
        success: true,
        matched: false,
        action: "pending_manual_activation",
        message: "Pagamento ricevuto, ma nessun account Smart Desk trovato con la stessa email.",
        orderId: order.id || "",
        email,
        plan,
        cycle: cycle || "unknown"
      };
    }
    const now = nowIso();
    const subscriptionEndsAt = cycle === "yearly"
      ? addMonthsIso(now, 12)
      : cycle === "monthly"
        ? addMonthsIso(now, 1)
        : user.subscriptionEndsAt || "";
    const total = Number(order.total || 0);
    const next = this.usersRepository.update(user.id, (current) => this.normalizeUserAccount({
      ...current,
      active: true,
      planType: "active",
      subscriptionPlan: plan,
      requestedSubscriptionPlan: "",
      subscriptionChangeRequestedAt: "",
      subscriptionChangeStatus: "",
      paymentStatus: "paid",
      accountStatus: "active",
      activatedAt: current.activatedAt || now,
      subscriptionBillingCycle: cycle || current.subscriptionBillingCycle || "",
      subscriptionStartedAt: current.subscriptionStartedAt || now,
      subscriptionEndsAt,
      subscriptionSource: "woocommerce",
      subscriptionLastOrderId: String(order.id || ""),
      subscriptionLastPaymentAt: now,
      subscriptionLastAmountCents: Math.round(total * 100),
      updatedAt: now
    }));
    return {
      success: true,
      matched: true,
      action: "account_activated",
      orderId: order.id || "",
      email,
      plan,
      cycle: cycle || "unknown",
      user: this.serializeUserSummary(next || user)
    };
  }

  serializeClientListItem(client = {}) {
    const lastVisitAt = client.lastVisit || "";
    const lastVisitTime = lastVisitAt ? new Date(lastVisitAt).getTime() : NaN;
    const daysSinceLastVisit = Number.isFinite(lastVisitTime)
      ? Math.max(0, Math.floor((Date.now() - lastVisitTime) / 86400000))
      : null;
    const derivedStatus = daysSinceLastVisit === null
      ? "DATI_INSUFFICIENTI"
      : daysSinceLastVisit > 120
        ? "INATTIVO"
        : daysSinceLastVisit > 45
          ? "IN_RITARDO"
          : "ATTIVO";
    const statusLabel = derivedStatus === "ATTIVO"
      ? "Attivo"
      : derivedStatus === "IN_RITARDO"
        ? "In ritardo"
        : derivedStatus === "INATTIVO"
          ? "Inattivo"
          : "Dati insufficienti";
    const lastVisitLabel = daysSinceLastVisit === null
      ? "Nessuna visita"
      : daysSinceLastVisit === 0
        ? "Oggi"
        : `${daysSinceLastVisit} giorni fa`;
    return {
      id: client.id,
      firstName: client.firstName || "",
      lastName: client.lastName || "",
      name: `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "Cliente",
      phone: client.phone || "",
      phoneShort: client.phone || "",
      lastVisit: lastVisitAt,
      lastVisitLabel,
      clientStatus: derivedStatus,
      clientStatusLabel: statusLabel,
      tag: statusLabel,
      clientIntelligence: {
        frequencyStatus: derivedStatus,
        daysSinceLastVisit
      }
    };
  }

  listClients(search = "", session = null, options = {}) {
    const query = String(search || "").trim().toLowerCase();
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const filtered = query
      ? clients.filter((item) =>
        [item.name, item.firstName, item.lastName, item.phone, item.email].some((value) => String(value || "").toLowerCase().includes(query))
      )
      : clients;
    const limit = clampNumber(options.limit || 0, 0, { min: 0, max: 5000 });
    const result = options.summaryOnly ? filtered.map((client) => this.serializeClientListItem(client)) : filtered;
    return limit ? result.slice(0, limit) : result;
  }

  scoreClientSimilarity(left = {}, right = {}) {
    if (!left || !right || String(left.id || "") === String(right.id || "")) return 0;
    const leftEmail = cleanEmail(left.email || "");
    const rightEmail = cleanEmail(right.email || "");
    if (leftEmail && rightEmail && leftEmail === rightEmail) return 1;
    const leftPhone = cleanPhone(left.phone || "");
    const rightPhone = cleanPhone(right.phone || "");
    if (leftPhone && rightPhone && leftPhone === rightPhone) return 0.96;
    const nameScore = tokenSimilarity(clientNameForDuplicate(left), clientNameForDuplicate(right));
    const contactBoost = (leftPhone && rightPhone && leftPhone.slice(-7) === rightPhone.slice(-7)) ? 0.2 : 0;
    return Math.min(0.95, nameScore + contactBoost);
  }

  serializeDuplicateClient(client = {}, score = 0) {
    return {
      id: client.id,
      firstName: client.firstName || "",
      lastName: client.lastName || "",
      name: clientNameForDuplicate(client),
      phone: client.phone || "",
      email: client.email || "",
      score: Number(score.toFixed(2))
    };
  }

  findClientDuplicateSuggestions(payload = {}, session = null) {
    const candidate = {
      id: payload.id || "",
      firstName: payload.firstName || splitName(payload.name || payload.fullName || "").firstName,
      lastName: payload.lastName || splitName(payload.name || payload.fullName || "").lastName,
      name: payload.name || payload.fullName || "",
      phone: payload.phone || "",
      email: payload.email || ""
    };
    const hasSearchableValue = clientNameForDuplicate(candidate).length >= 3 || cleanPhone(candidate.phone).length >= 7 || Boolean(cleanEmail(candidate.email));
    if (!hasSearchableValue) return [];
    return this.filterByCenter(this.clientsRepository.list(), session)
      .map((client) => ({ client, score: this.scoreClientSimilarity(candidate, client) }))
      .filter((item) => item.score >= 0.55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => this.serializeDuplicateClient(item.client, item.score));
  }

  listClientDuplicateGroups(session = null) {
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const groups = [];
    const used = new Set();
    clients.forEach((client) => {
      if (used.has(client.id)) return;
      const matches = clients
        .filter((other) => String(other.id || "") !== String(client.id || ""))
        .map((other) => ({ client: other, score: this.scoreClientSimilarity(client, other) }))
        .filter((item) => item.score >= 0.72)
        .sort((a, b) => b.score - a.score);
      if (!matches.length) return;
      const groupClients = [this.serializeDuplicateClient(client, 1), ...matches.map((item) => this.serializeDuplicateClient(item.client, item.score))];
      groupClients.forEach((item) => used.add(item.id));
      groups.push({
        id: `dup_${client.id}`,
        clients: groupClients,
        score: Math.max(...matches.map((item) => item.score))
      });
    });
    return groups.sort((a, b) => b.score - a.score);
  }

  mergeClients(payload = {}, session = null) {
    const primaryId = String(payload.primaryClientId || "");
    const secondaryId = String(payload.secondaryClientId || "");
    assertValid(primaryId && secondaryId && primaryId !== secondaryId, "Clienti da unire non validi");
    const primary = this.findByIdInCenter(this.clientsRepository, primaryId, session);
    const secondary = this.findByIdInCenter(this.clientsRepository, secondaryId, session);
    assertValid(Boolean(primary && secondary), "Cliente duplicato non trovato");
    const now = nowIso();
    const merged = this.updateInCenter(this.clientsRepository, primaryId, (current) => ({
      ...current,
      firstName: current.firstName || secondary.firstName || "",
      lastName: current.lastName || secondary.lastName || "",
      name: clientNameForDuplicate(current) || clientNameForDuplicate(secondary),
      phone: current.phone || secondary.phone || "",
      email: current.email || secondary.email || "",
      birthDate: current.birthDate || secondary.birthDate || "",
      notes: mergeTextValues(current.notes, secondary.notes),
      allergies: mergeTextValues(current.allergies, secondary.allergies),
      preferences: Array.from(new Set([...(current.preferences || []), ...(secondary.preferences || [])].filter(Boolean))),
      packages: Array.from(new Set([...(current.packages || []), ...(secondary.packages || [])].filter(Boolean))),
      privacyConsent: Boolean(current.privacyConsent || secondary.privacyConsent),
      marketingConsent: Boolean(current.marketingConsent || secondary.marketingConsent),
      sensitiveDataConsent: Boolean(current.sensitiveDataConsent || secondary.sensitiveDataConsent),
      privacyConsentAt: current.privacyConsentAt || secondary.privacyConsentAt || "",
      marketingConsentAt: current.marketingConsentAt || secondary.marketingConsentAt || "",
      sensitiveDataConsentAt: current.sensitiveDataConsentAt || secondary.sensitiveDataConsentAt || "",
      totalValue: Math.max(Number(current.totalValue || 0), Number(secondary.totalValue || 0)),
      updatedAt: now,
      mergedClientIds: Array.from(new Set([...(current.mergedClientIds || []), secondaryId]))
    }), session);
    [this.appointmentsRepository, this.paymentsRepository, this.treatmentsRepository, this.protocolsRepository].forEach((repository) => {
      repository.list()
        .filter((item) => String(item.centerId || "") === this.getCenterId(session) && String(item.clientId || "") === secondaryId)
        .forEach((item) => repository.update(item.id, (current) => ({ ...current, clientId: primaryId, updatedAt: now })));
    });
    this.clientsRepository.delete(secondaryId);
    return {
      success: true,
      mergedClient: merged,
      removedClientId: secondaryId
    };
  }

  saveClient(payload = {}, session = null) {
    const existing = !payload.id ? this.findExistingByIdempotency(this.clientsRepository, payload, session) : null;
    if (existing) return existing;
    const providedName = cleanText(payload.name || payload.fullName || "", "", 180);
    const split = splitName(providedName);
    const firstName = cleanText(payload.firstName || split.firstName || "", "", 80);
    const lastName = cleanText(payload.lastName || split.lastName || "", "", 80);
    const fullName = cleanText(`${firstName} ${lastName}`.trim() || providedName, "", 180);
    assertValid(fullName.length >= 2, "Nome cliente obbligatorio");
    assertEmailIfProvided(payload.email, "Email cliente");
    assertPhoneIfProvided(payload.phone, "Telefono cliente");
    assertRange(payload.totalValue || 0, "Valore cliente", { min: 0, max: 100000000 });
    const now = nowIso();
    const centerId = this.getCenterId(session);
    const centerName = this.getCenterName(session);
    const entity = {
      id: payload.id || makeId("client"),
      idempotencyKey: idempotencyKey(payload),
      centerId,
      centerName,
      firstName,
      lastName,
      name: fullName,
      phone: cleanPhone(payload.phone || ""),
      email: cleanEmail(payload.email || ""),
      birthDate: cleanText(payload.birthDate || "", "", 20),
      notes: cleanText(payload.notes || "", "", 2000),
      allergies: cleanText(payload.allergies || "", "", 500),
      preferences: Array.isArray(payload.preferences)
        ? payload.preferences
        : String(payload.preferences || "").split(",").map((item) => item.trim()).filter(Boolean),
      packages: Array.isArray(payload.packages)
        ? payload.packages
        : String(payload.packages || "").split(",").map((item) => item.trim()).filter(Boolean),
      privacyConsent: Boolean(payload.privacyConsent),
      marketingConsent: Boolean(payload.marketingConsent),
      sensitiveDataConsent: Boolean(payload.sensitiveDataConsent),
      privacyConsentAt: String(payload.privacyConsentAt || (payload.privacyConsent ? now : "")),
      marketingConsentAt: String(payload.marketingConsentAt || (payload.marketingConsent ? now : "")),
      sensitiveDataConsentAt: String(payload.sensitiveDataConsentAt || (payload.sensitiveDataConsent ? now : "")),
      consentSource: String(payload.consentSource || "in_sede"),
      totalValue: clampNumber(payload.totalValue || 0, 0, { min: 0, max: 100000000 }),
      loyaltyTier: cleanText(payload.loyaltyTier || "base", "base", 40),
      lastVisit: cleanText(payload.lastVisit || "", "", 40),
      createdAt: payload.createdAt || now,
      updatedAt: now
    };

    if (!payload.id) {
      this.clientsRepository.create(entity);
      this.invalidateBusinessSnapshot(this.getCenterId(session), this.dirtyBlocksForRepository(this.clientsRepository));
      this.applyGoldStateEvent("client_created", { after: entity }, session);
      return entity;
    }

    const before = this.findByIdInCenter(this.clientsRepository, payload.id, session);
    const updated = this.updateInCenter(this.clientsRepository, payload.id, (current) => ({
      ...current,
      ...entity,
      createdAt: current.createdAt || entity.createdAt
    }), session);
    this.applyGoldStateEvent("client_updated", { before, after: updated }, session);
    return updated;
  }

  getClientDetail(clientId, session = null) {
    const client = this.findByIdInCenter(this.clientsRepository, clientId, session);
    if (!client) throw new Error("Cliente non trovato");
    const normalizedClientId = String(clientId || "");
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session).filter((item) => String(item.clientId || "") === normalizedClientId);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session).filter((item) => String(item.clientId || "") === normalizedClientId);
    const treatments = this.filterByCenter(this.treatmentsRepository.list(), session).filter((item) => String(item.clientId || "") === normalizedClientId);
    return {
      client,
      appointments,
      payments,
      treatments
    };
  }

  getClientConsultation(clientId, session = null) {
    const detail = this.getClientDetail(clientId, session);
    return {
      client: detail.client,
      history: detail.appointments.slice(0, 10),
      recommendations: []
    };
  }

  generateClientConsentDocument(clientId, session = null) {
    const detail = this.getClientDetail(clientId, session);
    ensureDir(EXPORTS_DIR);
    const client = detail.client || {};
    const settings = this.getSettings(session);
    const clientName = `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "Cliente";
    const legalName = String(settings.centerLegalName || settings.centerName || this.getCenterName(session) || "").trim();
    const centerDisplayName = String(settings.centerName || legalName || this.getCenterName(session) || "Centro").trim();
    const centerAddress = [
      settings.centerAddress,
      [settings.centerPostalCode, settings.centerCity, settings.centerProvince].filter(Boolean).join(" ")
    ].filter(Boolean).join(", ");
    const fiscalData = [
      settings.centerVatNumber ? `P.IVA ${settings.centerVatNumber}` : "",
      settings.centerTaxCode ? `CF ${settings.centerTaxCode}` : ""
    ].filter(Boolean).join(" - ");
    const contacts = [
      settings.centerEmail ? `Email ${settings.centerEmail}` : "",
      settings.centerPhone ? `Tel. ${settings.centerPhone}` : ""
    ].filter(Boolean).join(" - ");
    const missingLegalData = [
      !settings.centerLegalName ? "ragione sociale" : "",
      !settings.centerEmail ? "email centro" : "",
      !settings.centerPhone ? "telefono centro" : ""
    ].filter(Boolean);
    const fileName = `consensi-${sanitizeFileName(clientName)}-${Date.now()}.pdf`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const today = new Date().toLocaleDateString("it-IT");
    const sections = [
      { style: "title", text: "SkinHarmony Smart Desk - Modulo privacy e consensi" },
      { style: "heading", text: "Dati del centro / titolare del trattamento" },
      { style: "body", text: `Centro: ${centerDisplayName}` },
      { style: "body", text: `Ragione sociale / titolare: ${legalName || "Da completare in Impostazioni"}` },
      { style: "body", text: `Sede: ${centerAddress || "Da completare in Impostazioni"}` },
      { style: "body", text: `Dati fiscali: ${fiscalData || "Da completare in Impostazioni"}` },
      { style: "body", text: `Contatti privacy/centro: ${contacts || "Da completare in Impostazioni"}` },
      ...(missingLegalData.length ? [{ style: "body", text: `Attenzione operativa: completare in Impostazioni ${missingLegalData.join(", ")} per avere un documento piu completo.` }] : []),
      { style: "heading", text: "Dati cliente" },
      { style: "body", text: `Cliente: ${clientName}` },
      { style: "body", text: `Telefono: ${client.phone || "________________"}    Email: ${client.email || "________________"}` },
      { style: "body", text: `Data nascita: ${client.birthDate || "________________"}    Data documento: ${today}` },
      { style: "heading", text: "Informativa privacy" },
      { style: "body", text: `Il presente modulo raccoglie la presa visione dell'informativa privacy e i consensi del cliente per la gestione dei dati nel gestionale del centro ${centerDisplayName}. Il trattamento dei dati avviene nel rispetto del Regolamento UE 2016/679 (GDPR) e della normativa nazionale applicabile in materia di protezione dei dati personali.` },
      { style: "body", text: "I dati raccolti possono includere dati anagrafici, contatti, appuntamenti, servizi effettuati, preferenze operative, note di servizio, consensi e informazioni necessarie alla corretta gestione del rapporto con il cliente." },
      { style: "heading", text: "Finalita del trattamento" },
      { style: "body", text: "1. Gestione anagrafica cliente, appuntamenti, storico servizi e comunicazioni operative legate al servizio richiesto." },
      { style: "body", text: "2. Gestione amministrativa, fiscale e organizzativa del rapporto con il centro." },
      { style: "body", text: "3. Invio di comunicazioni marketing, promozionali o recall commerciali solo se il cliente presta consenso specifico." },
      { style: "body", text: "4. Gestione di note tecniche o informazioni utili allo svolgimento del servizio, incluse eventuali indicazioni su preferenze, sensibilita o controindicazioni dichiarate dal cliente." },
      { style: "heading", text: "Consensi" },
      { style: "body", text: `[${client.privacyConsent ? "X" : " "}] Presa visione informativa privacy - Data: ${client.privacyConsentAt ? new Date(client.privacyConsentAt).toLocaleDateString("it-IT") : "________________"}` },
      { style: "body", text: `[${client.marketingConsent ? "X" : " "}] Consenso marketing e recall commerciali - Data: ${client.marketingConsentAt ? new Date(client.marketingConsentAt).toLocaleDateString("it-IT") : "________________"}` },
      { style: "body", text: `[${client.sensitiveDataConsent ? "X" : " "}] Consenso al trattamento di dati particolari eventualmente dichiarati dal cliente per finalita operative del servizio - Data: ${client.sensitiveDataConsentAt ? new Date(client.sensitiveDataConsentAt).toLocaleDateString("it-IT") : "________________"}` },
      { style: "body", text: `Fonte consenso registrata: ${client.consentSource || "in_sede"}` },
      { style: "heading", text: "Diritti dell'interessato" },
      { style: "body", text: "Il cliente puo richiedere accesso, rettifica, aggiornamento, limitazione, cancellazione dei dati ove applicabile, opposizione al trattamento e revoca dei consensi prestati, senza pregiudicare la liceita del trattamento basata sul consenso prima della revoca." },
      { style: "heading", text: "Dichiarazione e firma" },
      { style: "body", text: "Il cliente dichiara di aver ricevuto le informazioni essenziali sul trattamento dei dati personali e di esprimere i consensi selezionati nel presente modulo." },
      { style: "body", text: "Luogo e data: ______________________________________________" },
      { style: "body", text: "Firma cliente: _____________________________________________" },
      { style: "body", text: `Firma operatore / ${centerDisplayName}: ______________________________` },
      { style: "heading", text: "Nota operativa" },
      { style: "body", text: "Documento generato da Smart Desk come supporto operativo. Il centro resta responsabile della propria informativa privacy completa, dei dati del titolare del trattamento e dell'adeguamento legale al proprio caso specifico." }
    ];
    writeSimplePdf(filePath, sections);
    return { path: filePath, url: `/exports/${fileName}`, format: "pdf" };
  }

  getAppointmentsDayCacheKey(day = "", session = null, filters = {}) {
    const centerId = this.getCenterId(session);
    const staffId = String(filters.staffId || filters.operatorId || "");
    const resourceId = String(filters.resourceId || "");
    const status = String(filters.status || "");
    return [centerId, toDateOnly(day || nowIso()), staffId, resourceId, status]
      .map((part) => String(part || "all").replace(/[^a-zA-Z0-9_-]+/g, "_"))
      .join(":");
  }

  invalidateAppointmentsDayCache(centerId = "", dates = []) {
    const normalizedDates = new Set((Array.isArray(dates) ? dates : [dates])
      .map((date) => toDateOnly(date || ""))
      .filter(Boolean));
    Array.from(this.appointmentsDayCache.keys()).forEach((key) => {
      const parts = String(key).split(":");
      const keyCenterId = parts[0] || "";
      const keyDate = parts[1] || "";
      if (centerId && keyCenterId !== centerId) return;
      if (normalizedDates.size && !normalizedDates.has(keyDate)) return;
      this.appointmentsDayCache.delete(key);
    });
  }

  serializeAppointmentDayItem(item = {}) {
    return {
      id: item.id || "",
      clientId: item.clientId || "",
      clientName: item.clientName || "",
      walkInName: item.walkInName || "",
      walkInPhone: item.walkInPhone || "",
      staffId: item.staffId || "",
      staffName: item.staffName || "",
      serviceId: item.serviceId || "",
      serviceIds: Array.isArray(item.serviceIds) ? item.serviceIds : (item.serviceId ? [String(item.serviceId)] : []),
      serviceName: item.serviceName || "",
      resourceId: item.resourceId || "",
      resourceName: item.resourceName || "",
      startAt: item.startAt || "",
      endAt: item.endAt || "",
      durationMin: Number(item.durationMin || 0),
      status: item.status || "",
      notes: item.notes || "",
      locked: item.locked ? 1 : 0,
      colorTag: item.colorTag || item.serviceColor || item.staffColor || ""
    };
  }

  listAppointments(view = "day", anchorDate = nowIso(), _includeArchived = false, session = null, filters = {}) {
    const day = toDateOnly(anchorDate);
    if (view === "day") {
      const cacheKey = this.getAppointmentsDayCacheKey(day, session, filters);
      const cached = this.appointmentsDayCache.get(cacheKey);
      if (cached && cached.expiresAtMs > Date.now()) {
        return cached.items;
      }
      if (filters.safeMode && cached?.items) {
        return cached.items;
      }
      const appointments = this.filterByCenter(this.appointmentsRepository.list(), session)
        .filter((item) => toDateOnly(item.startAt) === day)
        .filter((item) => !filters.staffId || String(item.staffId || "") === String(filters.staffId))
        .filter((item) => !filters.operatorId || String(item.staffId || "") === String(filters.operatorId))
        .filter((item) => !filters.resourceId || String(item.resourceId || "") === String(filters.resourceId))
        .filter((item) => !filters.status || String(item.status || "") === String(filters.status))
        .map((item) => this.serializeAppointmentDayItem(item));
      this.appointmentsDayCache.set(cacheKey, {
        items: appointments,
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + APPOINTMENTS_DAY_CACHE_TTL_MS
      });
      return appointments;
    }
    return this.filterByCenter(this.appointmentsRepository.list(), session);
  }

  saveAppointment(payload = {}, session = null) {
    const existing = !payload.id ? this.findExistingByIdempotency(this.appointmentsRepository, payload, session) : null;
    if (existing) return existing;
    const startAt = payload.startAt || toDateTime(payload.date, payload.time);
    assertDateTime(startAt, "Data appuntamento");
    const durationMin = assertRange(payload.durationMin || payload.duration || 45, "Durata appuntamento", { min: 5, max: 720 });
    const appointmentClientName = cleanText(payload.clientName || payload.client || "", "", 180);
    const appointmentWalkInName = cleanText(payload.walkInName || "", "", 180);
    assertValid(Boolean(payload.clientId || appointmentClientName || appointmentWalkInName), "Cliente appuntamento obbligatorio");
    assertPhoneIfProvided(payload.walkInPhone, "Telefono cliente appuntamento");
    const endAt = payload.endAt || addMinutes(startAt, durationMin);
    const centerId = this.getCenterId(session);
    const centerName = this.getCenterName(session);
    const entity = {
      id: payload.id || makeId("appt"),
      idempotencyKey: idempotencyKey(payload),
      centerId,
      centerName,
      clientId: String(payload.clientId || ""),
      clientName: appointmentClientName,
      walkInName: appointmentWalkInName,
      walkInPhone: cleanPhone(payload.walkInPhone || ""),
      staffId: String(payload.staffId || ""),
      staffName: cleanText(payload.staffName || payload.operator || "", "", 120),
      serviceId: String(payload.serviceId || ""),
      serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : (payload.serviceId ? [String(payload.serviceId)] : []),
      serviceName: cleanText(payload.serviceName || payload.service || "", "", 160),
      resourceId: String(payload.resourceId || ""),
      resourceName: cleanText(payload.resourceName || payload.room || "", "", 120),
      startAt,
      endAt,
      status: cleanText(payload.status || "requested", "requested", 40),
      notes: cleanText(payload.notes || "", "", 1000),
      durationMin,
      locked: payload.locked ? 1 : 0,
      createdAt: payload.createdAt || nowIso(),
      updatedAt: nowIso()
    };

    if (!payload.id) {
      this.appointmentsRepository.create(entity);
      this.invalidateAppointmentsDayCache(centerId, [entity.startAt]);
      this.invalidateBusinessSnapshot(this.getCenterId(session), this.dirtyBlocksForRepository(this.appointmentsRepository));
      this.applyGoldStateEvent("appointment_created", { after: entity }, session);
      return entity;
    }

    const currentAppointment = this.findByIdInCenter(this.appointmentsRepository, payload.id, session);
    const updated = this.updateInCenter(this.appointmentsRepository, payload.id, (current) => ({
      ...current,
      ...entity,
      createdAt: current.createdAt || entity.createdAt
    }), session);
    this.invalidateAppointmentsDayCache(centerId, [
      currentAppointment?.startAt || "",
      updated?.startAt || entity.startAt
    ]);
    this.applyGoldStateEvent("appointment_updated", { before: currentAppointment, after: updated }, session);
    return updated;
  }

  deleteAppointment(id, session = null) {
    const currentAppointment = this.findByIdInCenter(this.appointmentsRepository, id, session);
    const result = this.deleteInCenter(this.appointmentsRepository, id, session);
    if (result?.success) {
      this.invalidateAppointmentsDayCache(this.getCenterId(session), [currentAppointment?.startAt || ""]);
      this.applyGoldStateEvent("appointment_deleted", { before: currentAppointment }, session);
    }
    return result;
  }

  listServices(session = null) {
    return this.filterByCenter(this.servicesRepository.list(), session);
  }

  saveService(payload = {}, session = null) {
    const existing = !payload.id ? this.findExistingByIdempotency(this.servicesRepository, payload, session) : null;
    if (existing) return existing;
    const serviceName = cleanText(payload.name || "", "", 160);
    assertValid(serviceName.length >= 2, "Nome servizio obbligatorio");
    const durationMin = assertRange(payload.durationMin || payload.duration || 45, "Durata servizio", { min: 5, max: 720 });
    const priceCents = assertRange(payload.priceCents || payload.price || 0, "Prezzo servizio", { min: 0, max: 100000000 });
    const estimatedProductCostCents = assertRange(payload.estimatedProductCostCents || payload.productCostCents || 0, "Costo prodotto stimato", { min: 0, max: 100000000 });
    const technologyCostCents = assertRange(payload.technologyCostCents || 0, "Costo tecnologia", { min: 0, max: 100000000 });
    const productLinks = Array.isArray(payload.productLinks)
      ? payload.productLinks
        .map((item) => ({
          productId: String(item.productId || ""),
          usageUnits: Number(item.usageUnits || 1)
        }))
        .filter((item) => item.productId)
      : [];
    const technologyLinks = Array.isArray(payload.technologyLinks)
      ? payload.technologyLinks
        .map((item) => ({
          technologyId: String(item.technologyId || ""),
          usageUnits: Number(item.usageUnits || 1)
        }))
        .filter((item) => item.technologyId)
      : [];
    const entity = {
      id: payload.id || makeId("service"),
      idempotencyKey: idempotencyKey(payload),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      name: serviceName,
      category: cleanText(payload.category || "", "", 80),
      durationMin,
      priceCents,
      estimatedProductCostCents,
      technologyCostCents,
      productLinks,
      technologyLinks,
      active: payload.active !== false,
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.servicesRepository.create(entity);
      this.invalidateBusinessSnapshot(this.getCenterId(session), this.dirtyBlocksForRepository(this.servicesRepository));
      this.applyGoldStateEvent("service_created", { after: entity }, session);
      return entity;
    }
    const before = this.findByIdInCenter(this.servicesRepository, payload.id, session);
    const updated = this.updateInCenter(this.servicesRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
    this.applyGoldStateEvent("service_updated", { before, after: updated }, session);
    return updated;
  }

  deleteService(id, session = null) {
    const before = this.findByIdInCenter(this.servicesRepository, id, session);
    const result = this.deleteInCenter(this.servicesRepository, id, session);
    if (result?.success) this.applyGoldStateEvent("service_deleted", { before }, session);
    return result;
  }

  listStaff(session = null) {
    return this.filterByCenter(this.staffRepository.list(), session);
  }

  saveStaff(payload = {}, session = null) {
    const existing = !payload.id ? this.findExistingByIdempotency(this.staffRepository, payload, session) : null;
    if (existing) return existing;
    const staffName = cleanText(payload.name || "", "", 120);
    assertValid(staffName.length >= 2, "Nome operatore obbligatorio");
    assertEmailIfProvided(payload.email, "Email operatore");
    assertPhoneIfProvided(payload.phone, "Telefono operatore");
    const hourlyCostCents = assertRange(payload.hourlyCostCents || payload.hourlyCost || 0, "Costo orario operatore", { min: 0, max: 100000000 });
    const entity = {
      id: payload.id || makeId("staff"),
      idempotencyKey: idempotencyKey(payload),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      name: staffName,
      role: cleanText(payload.role || "", "", 80),
      colorTag: cleanText(payload.colorTag || "#6db7ff", "#6db7ff", 20),
      hourlyCostCents,
      email: cleanEmail(payload.email || ""),
      phone: cleanPhone(payload.phone || ""),
      active: payload.active === false ? 0 : 1,
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.staffRepository.create(entity);
      this.invalidateBusinessSnapshot(this.getCenterId(session), this.dirtyBlocksForRepository(this.staffRepository));
      this.applyGoldStateEvent("staff_created", { after: entity }, session);
      return entity;
    }
    const before = this.findByIdInCenter(this.staffRepository, payload.id, session);
    const updated = this.updateInCenter(this.staffRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
    this.applyGoldStateEvent("staff_updated", { before, after: updated }, session);
    return updated;
  }

  deleteStaff(id, session = null) {
    const before = this.findByIdInCenter(this.staffRepository, id, session);
    const result = this.deleteInCenter(this.staffRepository, id, session);
    if (result?.success) this.applyGoldStateEvent("staff_deleted", { before }, session);
    return result;
  }

  listShifts(view = "month", anchorDate = nowIso(), staffId = "", session = null) {
    const settings = this.getSettings(session);
    if (settings.shiftsBaseEnabled === false) return [];
    const date = toDateOnly(anchorDate);
    let shifts = this.filterByCenter(this.shiftsRepository.list(), session);
    if (staffId) {
      shifts = shifts.filter((item) => String(item.staffId || "") === String(staffId));
    }
    if (view === "day") {
      return shifts.filter((item) => toDateOnly(item.date) === date);
    }
    return shifts;
  }

  saveShift(payload = {}, session = null) {
    const settings = this.getSettings(session);
    if (settings.shiftsBaseEnabled === false) {
      throw new Error("Modulo turni non attivo");
    }
    const existing = !payload.id ? this.findExistingByIdempotency(this.shiftsRepository, payload, session) : null;
    if (existing) return existing;
    const staffName = cleanText(payload.staffName || "", "", 120);
    const startTime = cleanText(payload.startTime || "09:00", "09:00", 5);
    const endTime = cleanText(payload.endTime || "18:00", "18:00", 5);
    const originalStartTime = cleanText(payload.originalStartTime || "", "", 5);
    const originalEndTime = cleanText(payload.originalEndTime || "", "", 5);
    const rectifiedStartTime = cleanText(payload.rectifiedStartTime || "", "", 5);
    const rectifiedEndTime = cleanText(payload.rectifiedEndTime || "", "", 5);
    assertValid(Boolean(payload.staffId || staffName), "Operatore turno obbligatorio");
    assertTime(startTime, "Ora inizio turno");
    assertTime(endTime, "Ora fine turno");
    if (originalStartTime) assertTime(originalStartTime, "Ora entrata reale");
    if (originalEndTime) assertTime(originalEndTime, "Ora uscita reale");
    if (rectifiedStartTime) assertTime(rectifiedStartTime, "Ora entrata rettificata");
    if (rectifiedEndTime) assertTime(rectifiedEndTime, "Ora uscita rettificata");
    assertValid(minutesFromTime(endTime) > minutesFromTime(startTime), "Ora fine turno deve essere successiva all'inizio");
    const entity = {
      id: payload.id || makeId("shift"),
      idempotencyKey: idempotencyKey(payload),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      staffId: String(payload.staffId || ""),
      staffName,
      date: toDateOnly(payload.date || payload.startDate || nowIso()),
      startTime,
      endTime,
      originalStartTime,
      originalEndTime,
      originalAttendanceStatus: cleanText(payload.originalAttendanceStatus || "", "", 40),
      rectifiedStartTime,
      rectifiedEndTime,
      rectificationReason: cleanText(payload.rectificationReason || "", "", 1000),
      rectifiedBy: cleanText(payload.rectifiedBy || "", "", 120),
      rectifiedAt: cleanText(payload.rectifiedAt || "", "", 40),
      attendanceStatus: cleanText(payload.attendanceStatus || "scheduled", "scheduled", 40),
      attendanceNote: cleanText(payload.attendanceNote || "", "", 1000),
      confirmedAt: cleanText(payload.confirmedAt || "", "", 40),
      notes: cleanText(payload.notes || "", "", 1000),
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.shiftsRepository.create(entity);
      this.invalidateBusinessSnapshot(this.getCenterId(session), this.dirtyBlocksForRepository(this.shiftsRepository));
      return entity;
    }
    return this.updateInCenter(this.shiftsRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
  }

  deleteShift(id, session = null) {
    return this.deleteInCenter(this.shiftsRepository, id, session);
  }

  exportShiftReport(_options = {}, _session = null) {
    ensureDir(EXPORTS_DIR);
    const fileName = `shift-report-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    fs.writeFileSync(filePath, "<!doctype html><html><body><h1>Shift report</h1></body></html>");
    return { path: filePath, url: `/exports/${fileName}` };
  }

  listShiftTemplates(session = null) {
    return this.filterByCenter(this.shiftTemplatesRepository.list(), session);
  }

  saveShiftTemplate(payload = {}, session = null) {
    const templateName = cleanText(payload.name || "", "", 120);
    assertValid(templateName.length >= 2, "Nome schema turni obbligatorio");
    const entity = {
      id: payload.id || makeId("template"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      name: templateName,
      week: Array.isArray(payload.week) ? payload.week : [],
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.shiftTemplatesRepository.create(entity);
      return entity;
    }
    return this.updateInCenter(this.shiftTemplatesRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
  }

  deleteShiftTemplate(id, session = null) {
    return this.deleteInCenter(this.shiftTemplatesRepository, id, session);
  }

  generateShiftTemplate(payload = {}) {
    return {
      generated: true,
      templateId: payload.templateId || null,
      range: { start: toDateOnly(payload.startDate || nowIso()), end: toDateOnly(payload.endDate || nowIso()) }
    };
  }

  listResources(session = null) {
    return this.filterByCenter(this.resourcesRepository.list(), session);
  }

  saveResource(payload = {}, session = null) {
    const existing = !payload.id ? this.findExistingByIdempotency(this.resourcesRepository, payload, session) : null;
    if (existing) return existing;
    const resourceName = cleanText(payload.name || "", "", 120);
    assertValid(resourceName.length >= 2, "Nome risorsa obbligatorio");
    const totalCostCents = assertRange(payload.totalCostCents || 0, "Costo totale tecnologia", { min: 0, max: 100000000 });
    const durationMonths = assertRange(payload.durationMonths || 0, "Durata ammortamento tecnologia", { min: 0, max: 600 });
    const estimatedMonthlyUses = assertRange(payload.estimatedMonthlyUses || 0, "Utilizzi mensili tecnologia", { min: 0, max: 1000000 });
    const monthlyCostCents = durationMonths > 0 ? Math.round(totalCostCents / durationMonths) : assertRange(payload.monthlyCostCents || 0, "Costo mensile tecnologia", { min: 0, max: 100000000 });
    const costPerUseCents = estimatedMonthlyUses > 0 ? Math.round(monthlyCostCents / estimatedMonthlyUses) : assertRange(payload.costPerUseCents || 0, "Costo uso tecnologia", { min: 0, max: 100000000 });
    const entity = {
      id: payload.id || makeId("resource"),
      idempotencyKey: idempotencyKey(payload),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      name: resourceName,
      type: cleanText(payload.type || "room", "room", 60),
      totalCostCents,
      durationMonths,
      estimatedMonthlyUses,
      monthlyCostCents,
      costPerUseCents,
      active: payload.active !== false,
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.resourcesRepository.create(entity);
      this.invalidateBusinessSnapshot(this.getCenterId(session), this.dirtyBlocksForRepository(this.resourcesRepository));
      return entity;
    }
    return this.updateInCenter(this.resourcesRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
  }

  deleteResource(id, session = null) {
    return this.deleteInCenter(this.resourcesRepository, id, session);
  }

  listInventoryItems(session = null) {
    return this.filterByCenter(this.inventoryRepository.list(), session);
  }

  saveInventoryItem(payload = {}, session = null) {
    const existing = !payload.id ? this.findExistingByIdempotency(this.inventoryRepository, payload, session) : null;
    if (existing) return existing;
    const itemName = cleanText(payload.name || "", "", 160);
    const quantity = assertRange(payload.quantity ?? payload.stockQuantity ?? 0, "Quantità magazzino", { min: 0, max: 100000000 });
    const minQuantity = assertRange(payload.minQuantity ?? payload.thresholdQuantity ?? 0, "Soglia magazzino", { min: 0, max: 100000000 });
    const costCents = assertRange(payload.costCents || payload.unitCostCents || payload.purchaseCostCents || 0, "Costo articolo", { min: 0, max: 100000000 });
    const salePriceCents = assertRange(payload.salePriceCents || payload.retailPriceCents || 0, "Prezzo vendita articolo", { min: 0, max: 100000000 });
    assertValid(itemName.length >= 2, "Nome articolo obbligatorio");
    const entity = {
      id: payload.id || makeId("inv"),
      idempotencyKey: idempotencyKey(payload),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      name: itemName,
      sku: cleanText(payload.sku || "", "", 80).replace(/[^a-zA-Z0-9._-]/g, ""),
      quantity,
      stockQuantity: quantity,
      minQuantity,
      thresholdQuantity: minQuantity,
      costCents,
      unitCostCents: costCents,
      purchaseCostCents: costCents,
      salePriceCents,
      retailPriceCents: salePriceCents,
      category: cleanText(payload.category || "", "", 80),
      supplier: cleanText(payload.supplier || "", "", 120),
      unit: cleanText(payload.unit || "pz", "pz", 20),
      usageType: cleanText(payload.usageType || "cabina", "cabina", 40),
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.inventoryRepository.create(entity);
      this.invalidateBusinessSnapshot(this.getCenterId(session), this.dirtyBlocksForRepository(this.inventoryRepository));
      this.applyGoldStateEvent("inventory_created", { after: entity }, session);
      return entity;
    }
    const before = this.findByIdInCenter(this.inventoryRepository, payload.id, session);
    const updated = this.updateInCenter(this.inventoryRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
    this.applyGoldStateEvent("inventory_updated", { before, after: updated }, session);
    return updated;
  }

  deleteInventoryItem(id, session = null) {
    const before = this.findByIdInCenter(this.inventoryRepository, id, session);
    const result = this.deleteInCenter(this.inventoryRepository, id, session);
    if (result?.success) this.applyGoldStateEvent("inventory_deleted", { before }, session);
    return result;
  }

  listInventoryMovements(itemId = "", session = null) {
    return this.filterByCenter(this.inventoryMovementsRepository.list(), session).filter((item) => !itemId || item.itemId === itemId);
  }

  createInventoryMovement(payload = {}, session = null) {
    const centerId = this.getCenterId(session);
    assertValid(Boolean(payload.itemId), "Articolo magazzino obbligatorio");
    assertValid(Boolean(this.findByIdInCenter(this.inventoryRepository, payload.itemId, session)), "Articolo magazzino non trovato");
    const quantity = assertRange(payload.quantity || 0, "Quantità movimento", { min: 0.01, max: 100000 });
    const movement = {
      id: makeId("move"),
      centerId,
      centerName: this.getCenterName(session),
      itemId: String(payload.itemId || ""),
      type: cleanText(payload.type || "manual", "manual", 40),
      quantity,
      note: cleanText(payload.note || "", "", 500),
      createdAt: nowIso()
    };
    this.inventoryMovementsRepository.create(movement);
    this.invalidateBusinessSnapshot(centerId, this.dirtyBlocksForRepository(this.inventoryMovementsRepository));
    if (movement.itemId) {
      const signedQuantity = ["unload", "internal_use", "sale"].includes(movement.type)
        ? -movement.quantity
        : movement.quantity;
      this.updateInCenter(this.inventoryRepository, movement.itemId, (current) => ({
        ...current,
        quantity: Math.max(0, Number(current.quantity || current.stockQuantity || 0) + signedQuantity),
        stockQuantity: Math.max(0, Number(current.quantity || current.stockQuantity || 0) + signedQuantity),
        updatedAt: nowIso()
      }), session);
    }
    return movement;
  }

  getInventoryOverview(session = null) {
    const cached = this.getCachedAnalyticsBlock(ANALYTICS_BLOCKS.INVENTORY_OVERVIEW, {}, session);
    if (cached) return cached;
    const items = this.filterByCenter(this.inventoryRepository.list(), session);
    const overview = {
      totalItems: items.length,
      totalQuantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      lowStock: items.filter((item) => Number(item.quantity || 0) <= Number(item.minQuantity || 0))
    };
    return this.setCachedAnalyticsBlock(ANALYTICS_BLOCKS.INVENTORY_OVERVIEW, {}, session, overview);
  }

  listTreatments(clientId = "", session = null) {
    return this.filterByCenter(this.treatmentsRepository.list(), session).filter((item) => !clientId || item.clientId === clientId);
  }

  createTreatment(payload = {}, session = null) {
    const treatment = {
      id: makeId("treat"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      clientId: String(payload.clientId || ""),
      title: String(payload.title || "Trattamento"),
      note: String(payload.note || ""),
      createdAt: nowIso()
    };
    this.treatmentsRepository.create(treatment);
    this.invalidateBusinessSnapshot(this.getCenterId(session), [ANALYTICS_BLOCKS.OPERATIONAL_REPORT]);
    return treatment;
  }

  listProtocols(clientId = "", session = null) {
    const centerId = this.getCenterId(session);
    return this.protocolsRepository.list()
      .filter((item) => this.belongsToCenter(item, centerId) || this.isGlobalSkinHarmonyProtocol(item))
      .filter((item) => !clientId || item.clientId === clientId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  }

  saveProtocol(payload = {}, session = null) {
    const existing = !payload.id ? this.findExistingByIdempotency(this.protocolsRepository, payload, session) : null;
    if (existing) return existing;
    const now = nowIso();
    const clientId = String(payload.clientId || "");
    const client = clientId ? this.findByIdInCenter(this.clientsRepository, clientId, session) : null;
    const protocolTitle = cleanText(payload.title || "", "", 180);
    assertValid(protocolTitle.length >= 2, "Titolo protocollo obbligatorio");
    assertRange(payload.sessionsCount || 0, "Numero sedute protocollo", { min: 0, max: 200 });
    const entity = {
      idempotencyKey: idempotencyKey(payload),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      clientId,
      clientName: cleanText(payload.clientName || (client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() : ""), "", 180),
      title: protocolTitle,
      objective: cleanText(payload.objective || "", "", 1000),
      area: cleanText(payload.area || "", "", 120),
      libraryScope: ["center", "skinharmony"].includes(String(payload.libraryScope || "").toLowerCase())
        ? String(payload.libraryScope || "").toLowerCase()
        : "center",
      targetArea: cleanText(payload.targetArea || "", "", 40),
      needType: cleanText(payload.needType || "", "", 120),
      caseIntensity: cleanText(payload.caseIntensity || "", "", 40),
      sessionsCount: clampNumber(payload.sessionsCount || 0, 0, { min: 0, max: 200 }),
      frequency: cleanText(payload.frequency || "", "", 200),
      technologies: cleanText(payload.technologies || "", "", 1000),
      products: cleanText(payload.products || "", "", 1000),
      steps: cleanText(payload.steps || "", "", 5000),
      clientCommunication: cleanText(payload.clientCommunication || "", "", 2000),
      avoidClaims: cleanText(payload.avoidClaims || "Nessun risultato garantito. Nessun linguaggio medico o terapeutico.", "Nessun risultato garantito. Nessun linguaggio medico o terapeutico.", 1500),
      operatorNotes: cleanText(payload.operatorNotes || payload.notes || "", "", 3000),
      limitations: cleanText(payload.limitations || "Protocollo operativo non medico. Nessuna diagnosi o promessa terapeutica.", "Protocollo operativo non medico. Nessuna diagnosi o promessa terapeutica.", 1500),
      source: cleanText(payload.source || "manual", "manual", 80),
      status: cleanText(payload.status || "draft", "draft", 40),
      updatedAt: now
    };
    if (payload.id) {
      return this.updateInCenter(this.protocolsRepository, payload.id, (current) => ({
        ...current,
        ...entity,
        id: current.id,
        createdAt: current.createdAt || now
      }), session);
    }
    const protocol = {
      id: makeId("protocol"),
      ...entity,
      createdAt: now
    };
    this.protocolsRepository.create(protocol);
    this.invalidateBusinessSnapshot(this.getCenterId(session), [ANALYTICS_BLOCKS.OPERATIONAL_REPORT]);
    return protocol;
  }

  deleteProtocol(id, session = null) {
    return this.deleteInCenter(this.protocolsRepository, id, session);
  }

  async generateAiGoldProtocolDraft(payload = {}, session = null) {
    if (!this.hasProtocolAiAccess(session)) {
      return {
        protocolAiEnabled: false,
        goldEnabled: false,
        message: "Protocolli AI disponibili dal piano Silver.",
        draft: null
      };
    }
    const currentPlan = this.isSuperAdminSession(session) ? "gold" : this.getPlanLevel(session);
    const protocolLimit = this.getProtocolAiLimit(session);
    const savedProtocols = this.listProtocols("", session);
    const usedCount = savedProtocols.filter((item) => String(item.source || "").includes("ai_protocols")).length;
    if (usedCount >= protocolLimit) {
      return {
        protocolAiEnabled: false,
        goldEnabled: currentPlan === "gold",
        currentPlan,
        protocolLimit,
        usedCount,
        message: `Limite Protocolli AI raggiunto (${usedCount}/${protocolLimit}). Puoi continuare a usare i protocolli manuali del centro.`,
        draft: null
      };
    }
    const clientId = String(payload.clientId || "");
    const client = clientId ? this.findByIdInCenter(this.clientsRepository, clientId, session) : null;
    const protocolModeRaw = String(payload.protocolMode || "hybrid").toLowerCase();
    const protocolMode = ["center", "skinharmony", "hybrid"].includes(protocolModeRaw) ? protocolModeRaw : "hybrid";
    const modeLabels = {
      center: "Protocolli del centro",
      skinharmony: "Protocolli SkinHarmony",
      hybrid: "Ibrido centro + SkinHarmony"
    };
    const targetArea = String(payload.targetArea || "").trim();
    const issue = String(payload.issue || "").trim();
    const needType = String(payload.needType || issue || "").trim();
    const caseIntensity = String(payload.caseIntensity || "").trim();
    const ageRange = String(payload.ageRange || "").trim();
    const zoneDetail = String(payload.zoneDetail || "").trim();
    const journeyPhase = String(payload.journeyPhase || "").trim();
    const recentTreatmentsInput = String(payload.recentTreatments || "").trim();
    const sessionGoal = String(payload.sessionGoal || "").trim();
    const skinSensitivity = String(payload.skinSensitivity || "").trim();
    const timeBudget = String(payload.timeBudget || "").trim();
    const photoAnalysis = String(payload.photoAnalysis || "").trim();
    const photoConsent = Boolean(payload.photoConsent);
    const availableTechnologies = Array.isArray(payload.availableTechnologies)
      ? payload.availableTechnologies.map((item) => String(item || "").trim()).filter(Boolean)
      : String(payload.availableTechnologies || "").split(",").map((item) => item.trim()).filter(Boolean);
    const optionalFlags = Array.isArray(payload.optionalFlags)
      ? payload.optionalFlags.map((item) => String(item || "").trim()).filter(Boolean)
      : String(payload.optionalFlags || "").split(",").map((item) => item.trim()).filter(Boolean);
    const safetyFlags = Array.isArray(payload.safetyFlags)
      ? payload.safetyFlags.map((item) => String(item || "").trim()).filter(Boolean)
      : String(payload.safetyFlags || "").split(",").map((item) => item.trim()).filter(Boolean);
    const imageDataUrl = String(payload.imageDataUrl || "").trim();
    const preflightErrors = [];
    if (!targetArea || !needType || !zoneDetail || !ageRange) {
      preflightErrors.push("Compila fascia eta, area, zona specifica e obiettivo analisi.");
    }
    if (!imageDataUrl) {
      preflightErrors.push("Carica almeno una foto della zona da analizzare.");
    }
    if (!photoConsent) {
      preflightErrors.push("Conferma il consenso all'uso della foto per l'analisi estetica preliminare.");
    }
    if (!availableTechnologies.length) {
      preflightErrors.push("Seleziona le tecnologie realmente presenti nel centro.");
    }
    if (safetyFlags.length) {
      preflightErrors.push("Sono presenti blocchi di sicurezza dichiarati: serve valutazione professionale prima di procedere.");
    }
    if (availableTechnologies.includes("Nessuna delle precedenti") && availableTechnologies.length > 1) {
      preflightErrors.push("Non puoi selezionare 'Nessuna delle precedenti' insieme ad altre tecnologie.");
    }
    if (targetArea === "scalp" && !availableTechnologies.includes("O3 System")) {
      preflightErrors.push("Per un caso scalp, il motore richiede O3 System tra le tecnologie disponibili.");
    }
    if (preflightErrors.length) {
      return {
        protocolAiEnabled: true,
        goldEnabled: currentPlan === "gold",
        currentPlan,
        protocolLimit,
        usedCount,
        protocolMode,
        message: preflightErrors.join(" "),
        errors: preflightErrors,
        draft: null
      };
    }
    const searchText = [
      payload.title,
      payload.objective,
      payload.area,
      targetArea,
      needType,
      caseIntensity,
      issue,
      zoneDetail,
      journeyPhase,
      recentTreatmentsInput,
      sessionGoal,
      skinSensitivity,
      timeBudget,
      photoAnalysis,
      ...availableTechnologies,
      ...optionalFlags
    ].map((item) => String(item || "").toLowerCase()).join(" ");
    const centerProtocols = savedProtocols.filter((item) => {
      const scope = String(item.libraryScope || "center").toLowerCase();
      const status = String(item.status || "").toLowerCase();
      return scope === "center" && status !== "archived";
    });
    const skinHarmonyProtocols = savedProtocols.filter((item) => {
      const scope = String(item.libraryScope || "").toLowerCase();
      const status = String(item.status || "").toLowerCase();
      return scope === "skinharmony" && status !== "archived";
    });
    const scoreProtocol = (protocol) => {
      let score = 0;
      const protocolArea = String(protocol.targetArea || "").toLowerCase();
      const protocolNeed = String(protocol.needType || "").toLowerCase();
      const protocolText = [
        protocol.title,
        protocol.objective,
        protocol.area,
        protocol.steps,
        protocol.technologies
      ].map((item) => String(item || "").toLowerCase()).join(" ");
      if (targetArea && protocolArea && protocolArea === targetArea.toLowerCase()) score += 4;
      if (needType && protocolNeed && (protocolNeed.includes(needType.toLowerCase()) || needType.toLowerCase().includes(protocolNeed))) score += 3;
      if (targetArea && protocolText.includes(targetArea.toLowerCase())) score += 2;
      if (needType && protocolText.includes(needType.toLowerCase())) score += 2;
      searchText.split(/\s+/).filter((word) => word.length > 4).forEach((word) => {
        if (protocolText.includes(word)) score += 0.25;
      });
      return score;
    };
    const matchedCenterProtocol = centerProtocols
      .map((protocol) => ({ protocol, score: scoreProtocol(protocol) }))
      .sort((a, b) => b.score - a.score)[0];
    const centerProtocol = matchedCenterProtocol && matchedCenterProtocol.score > 0 ? matchedCenterProtocol.protocol : null;
    const matchedSkinHarmonyProtocol = skinHarmonyProtocols
      .map((protocol) => ({ protocol, score: scoreProtocol(protocol) }))
      .sort((a, b) => b.score - a.score)[0];
    const skinHarmonyProtocol = matchedSkinHarmonyProtocol && matchedSkinHarmonyProtocol.score > 0 ? matchedSkinHarmonyProtocol.protocol : null;
    const canUseRemoteProtocolLibrary = Boolean(imageDataUrl);
    if (protocolMode === "center" && !centerProtocol) {
      return {
        protocolAiEnabled: true,
        goldEnabled: currentPlan === "gold",
        currentPlan,
        protocolLimit,
        usedCount,
        protocolMode,
        message: "Non ho trovato un protocollo del centro coerente con area e obiettivo. Carica prima un protocollo del centro o usa modalita ibrida.",
        draft: null
      };
    }
    if (protocolMode === "skinharmony" && !skinHarmonyProtocol && !canUseRemoteProtocolLibrary) {
      return {
        protocolAiEnabled: true,
        goldEnabled: currentPlan === "gold",
        currentPlan,
        protocolLimit,
        usedCount,
        protocolMode,
        message: "Non ho trovato un protocollo SkinHarmony coerente con area e obiettivo. Carica o aggiorna la libreria prima di generare.",
        draft: null
      };
    }
    if (protocolMode === "hybrid" && !centerProtocol && !skinHarmonyProtocol && !canUseRemoteProtocolLibrary) {
      return {
        protocolAiEnabled: true,
        goldEnabled: currentPlan === "gold",
        currentPlan,
        protocolLimit,
        usedCount,
        protocolMode,
        message: "Non ci sono protocolli coerenti da combinare. Inserisci prima un protocollo del centro o usa una voce presente nella libreria SkinHarmony.",
        draft: null
      };
    }
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session)
      .filter((item) => !clientId || String(item.clientId || "") === clientId)
      .sort((a, b) => new Date(b.startAt || b.createdAt || 0).getTime() - new Date(a.startAt || a.createdAt || 0).getTime());
    const treatments = this.listTreatments(clientId, session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const inventory = this.filterByCenter(this.inventoryRepository.list(), session);
    const recentServices = appointments.slice(0, 5).map((appointment) => appointment.serviceName || services.find((service) => service.id === appointment.serviceId)?.name).filter(Boolean);
    const technologies = [
      ...new Set([
        ...availableTechnologies,
        ...services.map((service) => service.technologyName || service.technology || service.category).filter(Boolean),
        ...treatments.map((treatment) => treatment.technologyUsed).filter(Boolean)
      ])
    ].slice(0, 4);
    const products = inventory
      .filter((item) => Number(item.stockQuantity ?? item.quantity ?? 0) > 0)
      .slice(0, 4)
      .map((item) => item.name)
      .filter(Boolean);
    const clientName = client
      ? `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "Cliente"
      : String(payload.clientName || "");
    const baseProtocol = protocolMode === "skinharmony"
      ? skinHarmonyProtocol
      : centerProtocol || skinHarmonyProtocol;
    const objective = String(payload.objective || "").trim() || String(baseProtocol?.objective || "").trim() || (
      recentServices.length
        ? `Dare continuità ai servizi già eseguiti: ${recentServices.slice(0, 3).join(", ")}.`
        : "Costruire un percorso operativo progressivo dopo valutazione in cabina."
    );
    const areaLabel = targetArea === "viso" ? "Viso" : targetArea === "corpo" ? "Corpo" : targetArea === "scalp" ? "Cuoio capelluto" : "Area da confermare";
    const inferredJourneyPhase = journeyPhase || (
      treatments.length || appointments.length
        ? (sessionGoal === "mantenimento" ? "maintenance" : "active_phase")
        : "first_session"
    );
    const journeyPhaseLabels = {
      first_session: "Prima seduta",
      active_phase: "Fase attiva",
      maintenance: "Mantenimento",
      review: "Review / correzione percorso"
    };
    const highSensitivity = ["alta", "sensibile", "reattiva"].includes(skinSensitivity.toLowerCase());
    const hasRecentTreatment = Boolean(recentTreatmentsInput && !recentTreatmentsInput.toLowerCase().includes("nessun"));
    const evidentCase = caseIntensity === "evidente";
    const decisionHierarchy = [
      "1. Sicurezza: eventuali blocchi dichiarati fermano la generazione e richiedono valutazione professionale.",
      highSensitivity ? "2. Sensibilita: alta, quindi vince una prima impostazione prudente anche se il caso appare evidente." : "2. Sensibilita: non alta, si puo costruire una progressione controllata.",
      hasRecentTreatment ? `3. Trattamenti recenti: ${recentTreatmentsInput}, quindi ridurre intensita e verificare compatibilita prima della tecnologia centrale.` : "3. Trattamenti recenti: nessun vincolo forte dichiarato.",
      `4. Fase percorso: ${journeyPhaseLabels[inferredJourneyPhase] || inferredJourneyPhase}, quindi cambia frequenza e aggressivita operativa.`,
      evidentCase ? "5. Intensita caso: evidente, ma non supera sicurezza e sensibilita; si lavora per step e review." : "5. Intensita caso: gestibile con percorso progressivo."
    ];
    const buildTechnologyDecision = (technology) => {
      const lower = String(technology || "").toLowerCase();
      if (!technology || lower.includes("nessuna")) return "Tecnologie: nessuna tecnologia centrale dichiarata, usare protocollo manuale prudente o caricare tecnologie reali del centro.";
      if (targetArea === "scalp") {
        if (lower.includes("o3")) return "O3 System: prioritario per area scalp, con intensita progressiva e controllo comfort.";
        return `${technology}: disponibile ma non prioritaria per scalp; usarla solo se prevista dal protocollo centro.`;
      }
      if (highSensitivity && (lower.includes("radio") || lower.includes("rf") || lower.includes("presso"))) {
        return `${technology}: disponibile ma da limitare nella prima seduta per sensibilita alta; prima testare risposta e comfort.`;
      }
      if (targetArea === "viso" && lower.includes("skin pro")) {
        return highSensitivity
          ? "Skin Pro: consigliata in modalita prudente, seduta breve e progressiva."
          : "Skin Pro: tecnologia prioritaria per percorso viso, con progressione in base alla risposta.";
      }
      if (targetArea === "corpo" && (lower.includes("presso") || lower.includes("radio") || lower.includes("manual"))) {
        return `${technology}: consigliata per corpo, da collegare a obiettivo, durata e risposta cliente.`;
      }
      return `${technology}: disponibile; inserirla solo se coerente con area, obiettivo e tollerabilita.`;
    };
    const technologyPlan = technologies.map(buildTechnologyDecision).filter(Boolean);
    const adaptationRules = [
      inferredJourneyPhase === "first_session" ? "Prima seduta: ridurre ambizione, raccogliere risposta, non costruire subito protocollo aggressivo." : "",
      inferredJourneyPhase === "active_phase" ? "Fase attiva: mantenere progressione, ma inserire review dopo 2-3 sedute." : "",
      inferredJourneyPhase === "maintenance" ? "Mantenimento: frequenza piu distanziata, obiettivo continuita e controllo, non spinta intensiva." : "",
      inferredJourneyPhase === "review" ? "Review: confrontare foto/storico e correggere frequenza, tecnologia o obiettivo prima di proseguire." : "",
      highSensitivity ? "Sensibilita alta: seduta piu breve, meno tecnologia intensa, piu verifica comfort." : "",
      hasRecentTreatment ? "Trattamento recente: evitare sovrapposizioni aggressive e registrare il motivo della prudenza." : "",
      evidentCase && !highSensitivity ? "Caso evidente: dividere in blocchi e misurare miglioramento con review intermedia." : ""
    ].filter(Boolean);
    const suggestedSessions = inferredJourneyPhase === "maintenance"
      ? 4
      : highSensitivity
        ? 3
        : evidentCase
          ? 8
          : caseIntensity === "media"
            ? 5
            : 4;
    const suggestedFrequency = inferredJourneyPhase === "maintenance"
      ? "1 seduta ogni 21/30 giorni, con controllo fotografico periodico."
      : highSensitivity || hasRecentTreatment
        ? "1 seduta ogni 10/14 giorni, aumentando solo se la risposta e coerente."
        : evidentCase
          ? "1 seduta ogni 7 giorni, review obbligatoria a meta percorso."
          : "1 seduta ogni 7/10 giorni, review dopo 2-3 sedute.";
    const analysisSignals = [
      ageRange ? `Fascia eta: ${ageRange}.` : "Fascia eta non indicata.",
      zoneDetail ? `Zona specifica: ${zoneDetail}.` : "Zona specifica da completare.",
      issue ? `Esigenza dichiarata: ${issue}.` : "Esigenza da confermare con la cliente.",
      `Fase percorso: ${journeyPhaseLabels[inferredJourneyPhase] || inferredJourneyPhase}.`,
      recentTreatmentsInput ? `Trattamenti recenti: ${recentTreatmentsInput}.` : "Trattamenti recenti non indicati.",
      skinSensitivity ? `Sensibilita dichiarata: ${skinSensitivity}.` : "Sensibilita non dichiarata.",
      timeBudget ? `Tempo disponibile: ${timeBudget}.` : "Tempo seduta non indicato.",
      photoAnalysis ? `Lettura foto/operatore: ${photoAnalysis}.` : "Foto non analizzata: usare valutazione visiva professionale prima di procedere."
    ];
    const riskNotes = [
      skinSensitivity && skinSensitivity !== "normale" ? "Impostare una prima seduta prudente e controllare risposta immediata." : "",
      recentTreatmentsInput && !recentTreatmentsInput.toLowerCase().includes("nessun") ? "Verificare compatibilita con trattamenti recenti prima di usare tecnologie intense." : "",
      optionalFlags.includes("consenso-foto") ? "Consenso foto dichiarato: mantenere luce e distanza coerenti per confronti futuri." : "Se servono foto, raccogliere consenso prima dello scatto.",
      optionalFlags.includes("cliente-nuovo") ? "Cliente nuovo: prima seduta piu conservativa e anamnesi completa." : ""
    ].filter(Boolean);
    const decision = highSensitivity || hasRecentTreatment
      ? "Decisione AI: protocollo prudente adattato. Sicurezza, sensibilita e trattamenti recenti prevalgono su intensita e obiettivo estetico."
      : inferredJourneyPhase === "maintenance"
        ? "Decisione AI: percorso di mantenimento. L'obiettivo e continuita, controllo e prevenzione di sovraccarico operativo."
        : evidentCase
          ? "Decisione AI: percorso attivo a step. Il caso e evidente, ma va diviso in blocchi con review intermedia."
          : "Decisione AI: proposta progressiva standard, con verifica della risposta a ogni seduta.";
    const workLogic = [
      `Partire da ${areaLabel.toLowerCase()}${zoneDetail ? `, zona ${zoneDetail}` : ""}, collegando esigenza e tecnologie disponibili.`,
      sessionGoal ? `Obiettivo seduta: ${sessionGoal}.` : "Definire un obiettivo seduta misurabile prima di iniziare.",
      technologies.length ? `Tecnologie disponibili lette e pesate: ${technologies.join(", ")}.` : "Tecnologie non rilevate: selezionarle manualmente prima della seduta.",
      `Proposta percorso: ${suggestedSessions} sedute, frequenza ${suggestedFrequency}`,
      "L'AI propone una traccia; l'operatore deve confermare scheda, consenso e compatibilita."
    ];
    const strategy = [
      baseProtocol ? `Usare come base: ${baseProtocol.title || "protocollo selezionato"}.` : "Non usare protocolli inventati: completare libreria o scegliere SkinHarmony.",
      ...adaptationRules,
      "Registrare risposta cliente dopo ogni seduta per correggere frequenza e intensita."
    ];
    const sessionSteps = [
      "1. Verifica scheda cliente, consenso e trattamenti recenti.",
      "2. Controllo visivo/fotografico non medico con luce coerente.",
      technologies.length ? `3. Seduta centrale con tecnologia prioritaria selezionata, non con tutte insieme: ${technologies.slice(0, 2).join(" + ")} solo se coerenti.` : "3. Seduta centrale con tecnologia/manualita scelta dall'operatore.",
      products.length ? `4. Chiusura con prodotto coerente: ${products.slice(0, 2).join(", ")}.` : "4. Chiusura con prodotto coerente se disponibile.",
      "5. Nota finale su comfort, risposta e prossima azione."
    ];
    const verifications = [
      "Confermare consenso informato e consenso foto se si archiviano immagini.",
      "Controllare eventuali controindicazioni operative dichiarate dal cliente.",
      "Non promettere risultati certi: parlare di percorso progressivo e verifica."
    ];
    const clientScript = sessionGoal
      ? `Oggi lavoriamo su ${sessionGoal.toLowerCase()} con un percorso progressivo. Valutiamo la risposta e decidiamo insieme il passo successivo.`
      : "Oggi impostiamo una prima seduta controllata, leggiamo la risposta e costruiamo il percorso senza promesse automatiche.";
    let remoteProtocolAnalysis = null;
    let remoteProtocolWarning = "";
    if (imageDataUrl && typeof fetch === "function") {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const response = await fetch(process.env.PROTOCOL_ENGINE_URL || "https://skinharmony-ai-backend.onrender.com/api/protocols/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({
            imageDataUrl,
            issue: needType,
            area: targetArea,
            zoneDetail,
            ageRange,
            technologies,
            sessionGoal,
            skinSensitivity,
            timeBudget,
            caseIntensity,
            caseNotes: String(payload.caseNotes || ""),
            recentTreatments: recentTreatmentsInput,
            journeyPhase: inferredJourneyPhase,
            safetyFlags: Array.isArray(payload.safetyFlags) ? payload.safetyFlags : [],
            optionalFlags
          })
        });
        clearTimeout(timeout);
        const data = await response.json();
        if (response.ok && data?.ok && data.protocol) {
          remoteProtocolAnalysis = data;
        } else {
          remoteProtocolWarning = Array.isArray(data?.errors)
            ? data.errors.join(" ")
            : String(data?.error?.message || data?.error || "Motore Vision non disponibile.");
        }
      } catch (error) {
        remoteProtocolWarning = error instanceof Error ? error.message : "Motore Vision non disponibile.";
      }
    }
    const skinHarmonySteps = skinHarmonyProtocol?.steps
      ? [`Base SkinHarmony: ${skinHarmonyProtocol.title || "protocollo SkinHarmony"}.`, skinHarmonyProtocol.steps]
      : [];
    const centerSteps = centerProtocol?.steps
      ? [`Base protocollo centro: ${centerProtocol.title || "protocollo salvato"}.`, centerProtocol.steps]
      : [];
    const composedSteps = protocolMode === "skinharmony"
      ? skinHarmonySteps
      : protocolMode === "center"
        ? centerSteps
        : [...centerSteps, ...skinHarmonySteps];
    if (remoteProtocolAnalysis?.protocol?.sessionSteps?.length) {
      composedSteps.unshift(
        `Base Vision + Library pagina 600: ${remoteProtocolAnalysis.protocol.title || "protocollo remoto"}.`,
        remoteProtocolAnalysis.protocol.sessionSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")
      );
    }
    const protocolTechnologies = String(payload.technologies || baseProtocol?.technologies || "").trim()
      || (technologies.length ? technologies.join(", ") : "Tecnologia da scegliere tra quelle attive nel centro.");
    const protocolProducts = String(payload.products || baseProtocol?.products || "").trim()
      || (products.length ? products.join(", ") : "Prodotti da selezionare in base a disponibilità e scheda cliente.");
    const draft = {
      clientId,
      clientName,
      title: String(payload.title || (baseProtocol?.title ? `Adattamento ${baseProtocol.title}` : (clientName ? `Protocollo operativo ${clientName}` : "Protocollo operativo Protocolli AI"))),
      objective,
      area: String(payload.area || baseProtocol?.area || "Da definire in cabina"),
      libraryScope: "center",
      targetArea: targetArea || String(baseProtocol?.targetArea || ""),
      needType: needType || String(baseProtocol?.needType || ""),
      caseIntensity: caseIntensity || String(baseProtocol?.caseIntensity || ""),
      sessionsCount: Number(payload.sessionsCount || baseProtocol?.sessionsCount || suggestedSessions),
      frequency: String(payload.frequency || baseProtocol?.frequency || suggestedFrequency),
      technologies: protocolTechnologies,
      products: protocolProducts,
      steps: composedSteps.filter(Boolean).join("\n"),
      clientCommunication: String(baseProtocol?.clientCommunication || clientScript),
      avoidClaims: String(baseProtocol?.avoidClaims || "Evitare promesse di risultato, diagnosi mediche, linguaggio terapeutico e indicazioni non verificate dall’operatore."),
      operatorNotes: [
        `Modalità: ${modeLabels[protocolMode]}.`,
        "Gerarchia decisionale applicata:",
        ...decisionHierarchy,
        "Adattamenti applicati:",
        ...adaptationRules,
        "Tecnologie pesate:",
        ...technologyPlan,
        ...analysisSignals,
        ...riskNotes,
        centerProtocol ? `Protocollo centro usato come base: ${centerProtocol.title || "senza titolo"}.` : "Nessun protocollo centro compatibile usato come base.",
        skinHarmonyProtocol ? `Protocollo SkinHarmony usato come base: ${skinHarmonyProtocol.title || "senza titolo"}.` : "Nessun protocollo SkinHarmony compatibile usato come base.",
        appointments.length ? `Storico letto: ${appointments.length} appuntamenti collegati.` : "Storico appuntamenti non sufficiente.",
        treatments.length ? `Trattamenti registrati: ${treatments.length}.` : "Nessuna scheda trattamento registrata.",
        "La bozza va controllata e modificata dall’operatore prima del salvataggio."
      ].join("\n"),
      limitations: "Bozza operativa non medica. Non contiene diagnosi, promesse terapeutiche o garanzie di risultato.",
      source: `ai_protocols_${protocolMode}`,
      status: "draft"
    };
    return {
      protocolAiEnabled: true,
      goldEnabled: currentPlan === "gold",
      currentPlan,
      protocolLimit,
      usedCount,
      protocolMode,
      message: `Protocolli AI ha preparato una bozza in modalita ${modeLabels[protocolMode]}. Controlla i campi e salva solo se coerente.`,
      draft,
      analysis: {
        title: draft.title,
        decision,
        caseType: `${areaLabel}${needType ? ` / ${needType}` : ""}`,
        objective,
        confidence: photoAnalysis ? "media" : "prudente",
        remoteEngine: remoteProtocolAnalysis ? "Vision + Library pagina 600" : "Bozza interna Smart Desk",
        photoCoherence: remoteProtocolAnalysis?.vision
          ? [
              `Motore pagina 600: area ${remoteProtocolAnalysis.vision.probable_area || "non determinata"}, esigenza ${remoteProtocolAnalysis.vision.probable_issue || "non determinata"}, confidenza ${remoteProtocolAnalysis.vision.confidence || "non indicata"}.`,
              remoteProtocolAnalysis.protocol?.summary || "Protocollo compatibile trovato nella libreria remota.",
              "La foto non sostituisce la valutazione professionale."
            ]
          : remoteProtocolWarning
            ? [`Motore pagina 600 non usato: ${remoteProtocolWarning}`, "Eseguita bozza interna Smart Desk senza inventare dalla foto."]
            : photoAnalysis
              ? [`Lettura operatore/foto acquisita: ${photoAnalysis}.`, "La foto non sostituisce la valutazione professionale."]
              : ["Foto non presente o non descritta: completare controllo visivo prima di applicare il protocollo."],
        signals: analysisSignals,
        decisionHierarchy,
        adaptations: adaptationRules,
        technologyPlan,
        workLogic,
        strategy,
        sessionSteps: remoteProtocolAnalysis?.protocol?.sessionSteps?.length
          ? remoteProtocolAnalysis.protocol.sessionSteps
          : sessionSteps,
        verifications,
        clientScript,
        avoid: [
          "Non usare diagnosi mediche.",
          "Non promettere risultati garantiti.",
          "Non modificare prezzi, costi o scheda cliente senza conferma operatore."
        ],
        todayActions: [
          "Aprire scheda cliente e controllare dati essenziali.",
          "Confermare consenso e foto se necessaria.",
          "Usare la bozza solo dopo revisione dell'operatore."
        ],
        usage: {
          usedCount,
          limit: protocolLimit,
          remaining: Math.max(protocolLimit - usedCount - 1, 0)
        }
      }
    };
  }

  listPayments(clientId = "", session = null) {
    return this.filterByCenter(this.paymentsRepository.list(), session).filter((item) => !clientId || item.clientId === clientId);
  }

  buildPaymentLinkSuggestions(payment = {}, session = null, context = {}) {
    const paymentDay = toDateOnly(payment.createdAt || nowIso());
    const clients = context.clients || this.filterByCenter(this.clientsRepository.list(), session);
    const appointments = context.appointments || this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = context.payments || this.filterByCenter(this.paymentsRepository.list(), session);
    const clientsById = context.clientsById || mapById(clients);
    const servicesById = context.servicesById || mapById(this.filterByCenter(this.servicesRepository.list(), session));
    const linkedAppointmentIds = new Set(payments.map((item) => String(item.appointmentId || "")).filter(Boolean));
    const paymentClientId = String(payment.clientId || "");
    const paymentName = cleanText(payment.walkInName || "", "", 180);
    return appointments
      .filter((appointment) => {
        if (linkedAppointmentIds.has(String(appointment.id || ""))) return false;
        if (["cancelled", "no_show"].includes(String(appointment.status || ""))) return false;
        const sameDay = toDateOnly(appointment.startAt || appointment.createdAt) === paymentDay;
        const sameClient = paymentClientId && String(appointment.clientId || "") === paymentClientId;
        const client = clientsById.get(String(appointment.clientId || ""));
        const appointmentName = appointment.clientName || appointment.walkInName || clientNameForDuplicate(client);
        const similarName = paymentName && tokenSimilarity(paymentName, appointmentName) >= 0.5;
        return sameClient || (sameDay && (similarName || !paymentClientId));
      })
      .sort((a, b) => {
        const aSameClient = paymentClientId && String(a.clientId || "") === paymentClientId ? -1 : 0;
        const bSameClient = paymentClientId && String(b.clientId || "") === paymentClientId ? -1 : 0;
        if (aSameClient !== bSameClient) return aSameClient - bSameClient;
        return Math.abs(new Date(a.startAt || 0).getTime() - new Date(payment.createdAt || 0).getTime())
          - Math.abs(new Date(b.startAt || 0).getTime() - new Date(payment.createdAt || 0).getTime());
      })
      .slice(0, 4)
      .map((appointment) => {
        const client = clientsById.get(String(appointment.clientId || ""));
        const service = servicesById.get(String(appointment.serviceId || "")) || {};
        return {
          id: appointment.id,
          clientId: appointment.clientId || "",
          clientName: appointment.clientName || appointment.walkInName || clientNameForDuplicate(client),
          serviceName: service.name || appointment.serviceName || appointment.service || "Servizio",
          startAt: appointment.startAt || "",
          amountCents: Number(service.priceCents || appointment.amountCents || 0),
          status: appointment.status || ""
        };
      });
  }

  listUnlinkedPayments(session = null, options = {}) {
    const cacheOptions = { period: "manual", forceRefresh: Boolean(options.forceRefresh) };
    if (!cacheOptions.forceRefresh) {
      const validState = this.getValidGoldStateSnapshot("business", session);
      if (validState.valid) {
        const expectedCount = Number(validState.snapshot?.unlinkedPayments || 0);
        if (expectedCount <= 0) {
          this.logGoldStateEndpoint("payments_unlinked", session, { source: "gold_state", ...validState });
          return [];
        }
        const items = this.filterByCenter(this.paymentsRepository.list(), session)
          .filter((payment) => this.goldPaymentIsUnlinked(payment))
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
          .slice(0, Math.max(1, Math.min(80, expectedCount)))
          .map((payment) => ({
            ...payment,
            clientName: payment.walkInName || "Cliente occasionale",
            linkState: payment.appointmentId && payment.clientId
              ? "complete"
              : payment.appointmentId
                ? "missing_client"
                : "missing_appointment",
            suggestions: [],
            sourceLayer: "gold_state"
          }));
        this.logGoldStateEndpoint("payments_unlinked", session, { source: "gold_state", ...validState });
        return items;
      }
      this.logGoldStateEndpoint("payments_unlinked", session, { source: "raw_fallback", ...validState });
    }
    if (!cacheOptions.forceRefresh) {
      const cached = this.getCachedAnalyticsBlock(ANALYTICS_BLOCKS.PAYMENT_ISSUES, cacheOptions, session);
      if (cached) return cached.items || [];
    }
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const clientsById = mapById(clients);
    const servicesById = mapById(services);
    const suggestionContext = { clients, appointments, payments, clientsById, servicesById };
    const items = payments
      .filter((payment) => !["free", "ignored"].includes(String(payment.reconciliationStatus || "")))
      .filter((payment) => !payment.appointmentId || !payment.clientId)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 80)
      .map((payment) => {
        const client = clientsById.get(String(payment.clientId || ""));
        return {
          ...payment,
          clientName: payment.clientId ? clientNameForDuplicate(client) : payment.walkInName || "Cliente occasionale",
          linkState: payment.appointmentId && payment.clientId
            ? "complete"
            : payment.appointmentId
              ? "missing_client"
              : "missing_appointment",
          suggestions: this.buildPaymentLinkSuggestions(payment, session, suggestionContext)
        };
      });
    this.setCachedAnalyticsBlock(ANALYTICS_BLOCKS.PAYMENT_ISSUES, cacheOptions, session, { items }, 90000);
    return items;
  }

  linkPayment(paymentId, payload = {}, session = null) {
    const payment = this.findByIdInCenter(this.paymentsRepository, paymentId, session);
    assertValid(Boolean(payment), "Pagamento non trovato");
    if (payload.markAsFree || payload.ignoreReconciliation) {
      const before = { ...payment };
      const updatedFreePayment = this.updateInCenter(this.paymentsRepository, paymentId, (current) => ({
        ...current,
        reconciliationStatus: payload.ignoreReconciliation ? "ignored" : "free",
        reconciliationNote: cleanText(payload.note || "Pagamento libero confermato dall'operatore", "", 220),
        linkedAt: nowIso(),
        updatedAt: nowIso()
      }), session);
      this.applyGoldStateEvent("payment_updated", { before, after: updatedFreePayment }, session);
      return {
        success: true,
        payment: updatedFreePayment,
        suggestions: []
      };
    }
    const appointmentId = String(payload.appointmentId || payment.appointmentId || "");
    const appointment = appointmentId ? this.findByIdInCenter(this.appointmentsRepository, appointmentId, session) : null;
    const clientId = String(payload.clientId || appointment?.clientId || payment.clientId || "");
    const before = { ...payment };
    const updated = this.updateInCenter(this.paymentsRepository, paymentId, (current) => ({
      ...current,
      appointmentId,
      clientId,
      walkInName: clientId ? "" : current.walkInName || "",
      linkedAt: nowIso(),
      updatedAt: nowIso()
    }), session);
    this.applyGoldStateEvent("payment_updated", { before, after: updated }, session);
    if (appointment && !["completed", "cancelled", "no_show"].includes(String(appointment.status || ""))) {
      const updatedAppointment = this.updateInCenter(this.appointmentsRepository, appointment.id, (current) => ({
        ...current,
        status: "completed",
        locked: 1,
        updatedAt: nowIso()
      }), session);
      this.applyGoldStateEvent("appointment_updated", { before: appointment, after: updatedAppointment }, session);
      this.invalidateAppointmentsDayCache(this.getCenterId(session), [appointment.startAt || ""]);
    }
    return {
      success: true,
      payment: updated,
      suggestions: updated ? this.buildPaymentLinkSuggestions(updated, session) : []
    };
  }

  getDataQuality(session = null, options = {}) {
    const cacheBlock = options.summaryOnly ? ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY : ANALYTICS_BLOCKS.DATA_QUALITY;
    if (!options.forceRefresh) {
      const cached = this.getCachedAnalyticsBlock(cacheBlock, {}, session);
      if (cached) return cached;
    }
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const inventory = this.filterByCenter(this.inventoryRepository.list(), session);
    const resources = this.filterByCenter(this.resourcesRepository.list(), session);
    const paidAppointmentIds = new Set(payments.map((payment) => String(payment.appointmentId || "")).filter(Boolean));
    const activeClients = clients.filter((client) => client.active !== false && client.active !== 0);
    const activeServices = services.filter((service) => service.active !== false && service.active !== 0);
    const activeStaff = staff.filter((operator) => operator.active !== false && operator.active !== 0);
    const activeInventory = inventory.filter((item) => item.active !== false && item.active !== 0);
    const activeResources = resources.filter((resource) => resource.active !== false && resource.active !== 0);
    const completedAppointments = appointments.filter((appointment) => String(appointment.status || "").toLowerCase() === "completed");
    const soldServiceIds = new Set(completedAppointments.map((appointment) => String(appointment.serviceId || "")).filter(Boolean));
    const soldServices = activeServices.filter((service) => soldServiceIds.has(String(service.id || "")));
    const inferredOperatorServices = buildInferredOperatorServiceMap(completedAppointments, activeStaff);
    const staffIdsUsedByServices = new Set(activeServices.flatMap((service) => [
      ...(Array.isArray(service.staffIds) ? service.staffIds : []),
      ...(Array.isArray(service.operatorIds) ? service.operatorIds : []),
      ...(Array.isArray(service.assignedStaffIds) ? service.assignedStaffIds : [])
    ]).map((id) => String(id || "")).filter(Boolean));
    const serviceHasCompleteCost = (service) => {
      const hasProductCost = Array.isArray(service.productLinks) && service.productLinks.length > 0;
      const hasTechnologyCost = Array.isArray(service.technologyLinks) && service.technologyLinks.length > 0;
      const hasEstimatedCost = Number(service.estimatedProductCostCents || service.productCostCents || 0) > 0
        || Number(service.technologyCostCents || 0) > 0;
      return hasProductCost || hasTechnologyCost || hasEstimatedCost;
    };
    const serviceHasEstimatedCostOnly = (service) => {
      const hasProductCost = Array.isArray(service.productLinks) && service.productLinks.length > 0;
      const hasTechnologyCost = Array.isArray(service.technologyLinks) && service.technologyLinks.length > 0;
      const hasEstimatedCost = Number(service.estimatedProductCostCents || service.productCostCents || 0) > 0
        || Number(service.technologyCostCents || 0) > 0;
      return !hasProductCost && !hasTechnologyCost && hasEstimatedCost;
    };
    const clientsMissingContact = activeClients.filter((client) => !client.phone && !client.email);
    const clientsMissingPhone = activeClients.filter((client) => !client.phone);
    const clientsMissingEmail = activeClients.filter((client) => !client.email);
    const clientsWithExpectedHistory = activeClients.filter((client) => (
      appointments.some((appointment) => String(appointment.clientId || "") === String(client.id || ""))
      || payments.some((payment) => String(payment.clientId || "") === String(client.id || ""))
    ));
    const clientsMissingLastVisit = clientsWithExpectedHistory.filter((client) => !client.lastVisit);
    const servicesMissingCosts = activeServices.filter((service) => !serviceHasCompleteCost(service));
    const servicesWithEstimatedCosts = activeServices.filter((service) => serviceHasEstimatedCostOnly(service));
    const servicesMissingPrice = activeServices.filter((service) => Number(service.priceCents || service.price || 0) <= 0);
    const servicesMissingDuration = activeServices.filter((service) => Number(service.durationMin || service.duration || 0) <= 0);
    const servicesMissingCategory = activeServices.filter((service) => !cleanText(service.category || service.serviceCategory || service.type || "", "", 80));
    const appointmentsMissingPayment = appointments.filter((appointment) => {
      if (["cancelled", "no_show"].includes(String(appointment.status || ""))) return false;
      if (new Date(appointment.startAt || appointment.createdAt || 0).getTime() > Date.now()) return false;
      return !paidAppointmentIds.has(String(appointment.id || ""));
    });
    const unlinkedPayments = payments
      .filter((payment) => !["free", "ignored"].includes(String(payment.reconciliationStatus || "")))
      .filter((payment) => !payment.appointmentId || !payment.clientId);
    const paymentsMissingMethod = payments.filter((payment) => !cleanText(payment.method || "", "", 40));
    const appointmentsMissingClient = appointments.filter((appointment) => !appointment.clientId && !appointment.walkInName && !appointment.clientName);
    const appointmentsMissingService = appointments.filter((appointment) => !appointment.serviceId && !appointment.serviceName);
    const appointmentsMissingOperator = appointments.filter((appointment) => !appointment.staffId && !appointment.operatorId && !appointment.staffName);
    const completedAppointmentsMissingFinalData = completedAppointments.filter((appointment) => {
      const hasPayment = paidAppointmentIds.has(String(appointment.id || ""));
      return !hasPayment || (!appointment.serviceId && !appointment.serviceName) || (!appointment.clientId && !appointment.walkInName && !appointment.clientName);
    });
    const operatorsMissingHourlyCost = activeStaff.filter((operator) => Number(operator.hourlyCostCents || operator.hourlyCost || 0) <= 0);
    const operatorsMissingRole = activeStaff.filter((operator) => !cleanText(operator.role || "", "", 80));
    const operatorsMissingServices = activeStaff.filter((operator) => {
      const direct = Array.isArray(operator.serviceIds) || Array.isArray(operator.services) || Array.isArray(operator.assignedServiceIds);
      const directCount = [
        ...(Array.isArray(operator.serviceIds) ? operator.serviceIds : []),
        ...(Array.isArray(operator.services) ? operator.services : []),
        ...(Array.isArray(operator.assignedServiceIds) ? operator.assignedServiceIds : [])
      ].filter(Boolean).length;
      const inferredCount = inferredOperatorServices.get(String(operator.id || ""))?.size || 0;
      return direct ? directCount === 0 && inferredCount === 0 : !staffIdsUsedByServices.has(String(operator.id || "")) && inferredCount === 0;
    });
    const inventoryMissingCost = activeInventory.filter((item) => Number(item.costCents || item.unitCostCents || item.purchaseCostCents || 0) <= 0);
    const inventoryMissingStock = activeInventory.filter((item) => item.quantity === undefined && item.stockQuantity === undefined);
    const productServiceLinks = activeServices.flatMap((service) => (
      Array.isArray(service.productLinks)
        ? service.productLinks.map((link) => ({ ...link, serviceId: service.id, serviceName: service.name }))
        : []
    ));
    const productLinksMissingUsage = productServiceLinks.filter((link) => Number(link.quantityUsage || link.usageUnits || 0) <= 0);
    const soldServicesMissingMarginCost = soldServices.filter((service) => !serviceHasCompleteCost(service));
    const resourcesMissingCost = activeResources.filter((resource) => (
      Number(resource.monthlyCostCents || 0) <= 0 && Number(resource.costPerUseCents || 0) <= 0
    ));
    const servicesWithCalculatedMargin = activeServices.filter((service) => {
      const price = Number(service.priceCents || service.price || 0);
      return price > 0 && serviceHasCompleteCost(service);
    });
    const servicesLowMargin = servicesWithCalculatedMargin.filter((service) => {
      const price = Number(service.priceCents || service.price || 0);
      const cost = Number(service.estimatedProductCostCents || service.productCostCents || 0) + Number(service.technologyCostCents || 0);
      const marginPercent = price > 0 ? ((price - cost) / price) * 100 : 0;
      return marginPercent < 35;
    });
    const duplicateGroups = this.listClientDuplicateGroups(session);
    const makePreview = (items, mapper) => items.slice(0, 5).map(mapper);
    const makeCheck = (items, totalRecords, weight, mapper) => {
      const safeTotal = Math.max(0, Number(totalRecords || 0));
      const missingCount = Array.isArray(items) ? items.length : Number(items || 0);
      const issueRate = safeTotal > 0 ? missingCount / safeTotal : 0;
      const penalty = issueRate * Number(weight || 0);
      const severity = issueRate === 0 ? "ok" : issueRate <= 0.10 ? "info" : issueRate <= 0.25 ? "warning" : "critical";
      return {
        totalRecords: safeTotal,
        missingCount,
        issueRate: Number(issueRate.toFixed(4)),
        penalty: Number(penalty.toFixed(2)),
        severity,
        previewCount: Math.min(missingCount, 5),
        itemsPreview: Array.isArray(items) ? makePreview(items, mapper || ((item) => ({ id: item.id || "", name: item.name || item.id || "Record" }))) : [],
        lastComputedAt: nowIso()
      };
    };
    const summarizeBlock = (checks) => {
      const entries = Object.values(checks || {});
      const penalty = Number(entries.reduce((sum, item) => sum + Number(item.penalty || 0), 0).toFixed(2));
      const totalRecords = entries.reduce((max, item) => Math.max(max, Number(item.totalRecords || 0)), 0);
      const missingCount = entries.reduce((sum, item) => sum + Number(item.missingCount || 0), 0);
      const issueRate = totalRecords > 0 ? Math.min(1, missingCount / totalRecords) : 0;
      const severity = entries.some((item) => item.severity === "critical")
        ? "critical"
        : entries.some((item) => item.severity === "warning")
          ? "warning"
          : entries.some((item) => item.severity === "info")
            ? "info"
            : "ok";
      return {
        totalRecords,
        missingCount,
        issueRate: Number(issueRate.toFixed(4)),
        penalty,
        severity,
        previewCount: Math.min(missingCount, 5),
        lastComputedAt: nowIso(),
        checks
      };
    };
    const clientPreview = (client) => this.serializeDuplicateClient(client, 0);
    const servicePreview = (service) => ({ id: service.id, name: service.name || "Servizio" });
    const appointmentPreview = (appointment) => ({
      id: appointment.id,
      clientId: appointment.clientId || "",
      serviceId: appointment.serviceId || "",
      staffId: appointment.staffId || appointment.operatorId || "",
      startAt: appointment.startAt || "",
      status: appointment.status || ""
    });
    const paymentPreview = (payment) => ({
      id: payment.id,
      clientId: payment.clientId || "",
      appointmentId: payment.appointmentId || "",
      amountCents: Number(payment.amountCents || 0),
      method: payment.method || ""
    });
    const operatorPreview = (operator) => ({ id: operator.id, name: operator.name || "Operatore" });
    const inventoryPreview = (item) => ({ id: item.id, name: item.name || "Prodotto" });
    const clientsQuality = summarizeBlock({
      withoutContact: makeCheck(clientsMissingContact, activeClients.length, 12, clientPreview),
      withoutPhone: makeCheck(clientsMissingPhone, activeClients.length, 4, clientPreview),
      withoutEmail: makeCheck(clientsMissingEmail, activeClients.length, 2, clientPreview),
      withoutLastVisit: makeCheck(clientsMissingLastVisit, clientsWithExpectedHistory.length, 3, clientPreview)
    });
    const servicesQuality = summarizeBlock({
      withoutPrice: makeCheck(servicesMissingPrice, activeServices.length, 10, servicePreview),
      withoutCost: makeCheck(servicesMissingCosts, activeServices.length, 14, servicePreview),
      withoutDuration: makeCheck(servicesMissingDuration, activeServices.length, 6, servicePreview),
      withoutCategory: makeCheck(servicesMissingCategory, activeServices.length, 3, servicePreview)
    });
    const paymentsQuality = summarizeBlock({
      completedWithoutPayment: makeCheck(appointmentsMissingPayment, completedAppointments.length, 15, appointmentPreview),
      unlinkedPayments: makeCheck(unlinkedPayments, payments.length, 6, paymentPreview),
      withoutMethod: makeCheck(paymentsMissingMethod, payments.length, 4, paymentPreview)
    });
    const appointmentsQuality = summarizeBlock({
      withoutClient: makeCheck(appointmentsMissingClient, appointments.length, 8, appointmentPreview),
      withoutService: makeCheck(appointmentsMissingService, appointments.length, 8, appointmentPreview),
      withoutOperator: makeCheck(appointmentsMissingOperator, appointments.length, 5, appointmentPreview),
      completedWithMissingFinalData: makeCheck(completedAppointmentsMissingFinalData, completedAppointments.length, 7, appointmentPreview)
    });
    const operatorsQuality = summarizeBlock({
      withoutHourlyCost: makeCheck(operatorsMissingHourlyCost, activeStaff.length, 10, operatorPreview),
      withoutRole: makeCheck(operatorsMissingRole, activeStaff.length, 3, operatorPreview),
      withoutServices: makeCheck(operatorsMissingServices, activeStaff.length, 4, operatorPreview)
    });
    const inventoryQuality = summarizeBlock({
      withoutCost: makeCheck(inventoryMissingCost, activeInventory.length, 6, inventoryPreview),
      withoutStock: makeCheck(inventoryMissingStock, activeInventory.length, 3, inventoryPreview),
      productServiceLinksWithoutUsage: makeCheck(productLinksMissingUsage, productServiceLinks.length, 8, (link) => ({
        id: link.productId || "",
        serviceId: link.serviceId || "",
        name: link.serviceName || "Collegamento prodotto-servizio"
      }))
    });
    const profitabilityQuality = summarizeBlock({
      soldServicesWithoutCost: makeCheck(soldServicesMissingMarginCost, soldServices.length, 12, servicePreview),
      technologiesWithoutCost: makeCheck(resourcesMissingCost, activeResources.length, 6, (resource) => ({ id: resource.id, name: resource.name || "Tecnologia" })),
      lowMarginServices: makeCheck(servicesLowMargin, servicesWithCalculatedMargin.length, 5, servicePreview)
    });
    const totalPenalty = Number([
      clientsQuality,
      servicesQuality,
      paymentsQuality,
      appointmentsQuality,
      operatorsQuality,
      inventoryQuality,
      profitabilityQuality
    ].reduce((sum, block) => sum + Number(block.penalty || 0), 0).toFixed(2));
    const rawScore = 100 - totalPenalty;
    const score = Math.round(Math.max(0, Math.min(100, rawScore)));
    const state = score >= 85 ? "alto" : score >= 65 ? "medio" : score >= 40 ? "basso" : "critico";
    const status = state === "alto" ? "buono" : state === "critico" ? "basso" : state;
    const quality = {
      clients: clientsQuality,
      services: servicesQuality,
      payments: paymentsQuality,
      appointments: appointmentsQuality,
      operators: operatorsQuality,
      inventory: inventoryQuality,
      profitability: profitabilityQuality,
      scoreDetails: {
        value: score,
        state,
        totalPenalty,
        updatedAt: nowIso()
      },
      state,
      score,
      status,
      totalPenalty,
      updatedAt: nowIso(),
      metrics: {
        clients: activeClients.length,
        clientsMissingContact: clientsMissingContact.length,
        clientsMissingPhone: clientsMissingPhone.length,
        clientsMissingEmail: clientsMissingEmail.length,
        clientsMissingLastVisit: clientsMissingLastVisit.length,
        services: activeServices.length,
        servicesMissingCosts: servicesMissingCosts.length,
        servicesMissingPrice: servicesMissingPrice.length,
        servicesMissingDuration: servicesMissingDuration.length,
        servicesMissingCategory: servicesMissingCategory.length,
        servicesWithEstimatedCosts: servicesWithEstimatedCosts.length,
        appointments: appointments.length,
        appointmentsMissingPayment: appointmentsMissingPayment.length,
        appointmentsMissingClient: appointmentsMissingClient.length,
        appointmentsMissingService: appointmentsMissingService.length,
        appointmentsMissingOperator: appointmentsMissingOperator.length,
        completedAppointmentsMissingFinalData: completedAppointmentsMissingFinalData.length,
        payments: payments.length,
        unlinkedPayments: unlinkedPayments.length,
        paymentsMissingMethod: paymentsMissingMethod.length,
        operators: activeStaff.length,
        operatorsMissingHourlyCost: operatorsMissingHourlyCost.length,
        operatorsMissingRole: operatorsMissingRole.length,
        operatorsMissingServices: operatorsMissingServices.length,
        operatorsInferredServices: activeStaff.filter((operator) => (inferredOperatorServices.get(String(operator.id || ""))?.size || 0) > 0).length,
        inventory: activeInventory.length,
        inventoryMissingCost: inventoryMissingCost.length,
        inventoryMissingStock: inventoryMissingStock.length,
        productLinksMissingUsage: productLinksMissingUsage.length,
        technologies: activeResources.length,
        technologiesMissingCost: resourcesMissingCost.length,
        soldServicesMissingMarginCost: soldServicesMissingMarginCost.length,
        servicesLowMargin: servicesLowMargin.length,
        duplicateGroups: duplicateGroups.length
      },
      alerts: [
        clientsMissingContact.length ? `${clientsMissingContact.length} clienti senza telefono o email` : "",
        servicesMissingCosts.length ? `${servicesMissingCosts.length} servizi senza costi configurati` : "",
        servicesWithEstimatedCosts.length ? `${servicesWithEstimatedCosts.length} servizi con costi stimati non collegati a prodotti o tecnologie` : "",
        appointmentsMissingPayment.length ? `${appointmentsMissingPayment.length} appuntamenti passati senza pagamento collegato` : "",
        unlinkedPayments.length ? `${unlinkedPayments.length} pagamenti da collegare` : "",
        duplicateGroups.length ? `${duplicateGroups.length} gruppi di possibili duplicati cliente` : ""
      ].filter(Boolean),
      samples: {
        clientsMissingContact: clientsMissingContact.slice(0, 5).map((client) => this.serializeDuplicateClient(client, 0)),
        servicesMissingCosts: servicesMissingCosts.slice(0, 5).map((service) => ({ id: service.id, name: service.name || "Servizio" })),
        servicesWithEstimatedCosts: servicesWithEstimatedCosts.slice(0, 5).map((service) => ({ id: service.id, name: service.name || "Servizio" })),
        appointmentsMissingPayment: appointmentsMissingPayment.slice(0, 5).map((appointment) => ({
          id: appointment.id,
          clientId: appointment.clientId || "",
          startAt: appointment.startAt || "",
          status: appointment.status || ""
        })),
        unlinkedPayments: unlinkedPayments.slice(0, 5).map(paymentPreview),
        operatorsMissingHourlyCost: operatorsMissingHourlyCost.slice(0, 5).map(operatorPreview),
        inventoryMissingCost: inventoryMissingCost.slice(0, 5).map(inventoryPreview)
      }
    };
    const summary = {
      state: quality.state,
      score: quality.score,
      status: quality.status,
      totalPenalty: quality.totalPenalty,
      updatedAt: quality.updatedAt,
      metrics: quality.metrics,
      alerts: quality.alerts,
      scoreDetails: quality.scoreDetails,
      clients: {
        totalRecords: quality.clients.totalRecords,
        missingCount: quality.clients.missingCount,
        penalty: quality.clients.penalty,
        severity: quality.clients.severity
      },
      services: {
        totalRecords: quality.services.totalRecords,
        missingCount: quality.services.missingCount,
        penalty: quality.services.penalty,
        severity: quality.services.severity
      },
      payments: {
        totalRecords: quality.payments.totalRecords,
        missingCount: quality.payments.missingCount,
        penalty: quality.payments.penalty,
        severity: quality.payments.severity
      },
      appointments: {
        totalRecords: quality.appointments.totalRecords,
        missingCount: quality.appointments.missingCount,
        penalty: quality.appointments.penalty,
        severity: quality.appointments.severity
      },
      operators: {
        totalRecords: quality.operators.totalRecords,
        missingCount: quality.operators.missingCount,
        penalty: quality.operators.penalty,
        severity: quality.operators.severity
      },
      inventory: {
        totalRecords: quality.inventory.totalRecords,
        missingCount: quality.inventory.missingCount,
        penalty: quality.inventory.penalty,
        severity: quality.inventory.severity
      },
      profitability: {
        totalRecords: quality.profitability.totalRecords,
        missingCount: quality.profitability.missingCount,
        penalty: quality.profitability.penalty,
        severity: quality.profitability.severity
      }
    };
    this.setCachedAnalyticsBlock(ANALYTICS_BLOCKS.DATA_QUALITY, {}, session, quality);
    this.setCachedAnalyticsBlock(ANALYTICS_BLOCKS.DATA_QUALITY_SUMMARY, {}, session, summary);
    return options.summaryOnly ? summary : quality;
  }

  getPaymentsSummary(options = {}, session = null) {
    const mode = String(options.period || "day");
    const anchorDate = toDateOnly(options.anchorDate || nowIso());
    let startDate = String(options.startDate || "");
    let endDate = String(options.endDate || "");
    if (mode === "custom") {
      startDate = toDateOnly(startDate || anchorDate);
      endDate = toDateOnly(endDate || startDate);
    } else if (mode === "week") {
      const range = getWeekWindow(anchorDate);
      startDate = range.startDate;
      endDate = range.endDate;
    } else if (mode === "month") {
      const range = getMonthWindow(anchorDate);
      startDate = range.startDate;
      endDate = range.endDate;
    } else {
      startDate = anchorDate;
      endDate = anchorDate;
    }
    if (startDate > endDate) {
      const swap = startDate;
      startDate = endDate;
      endDate = swap;
    }

    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const clientNames = new Map(clients.map((client) => [
      String(client.id || ""),
      `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "Cliente"
    ]));
    const payments = this.filterByCenter(this.paymentsRepository.list(), session)
      .filter((item) => {
        const createdDate = toDateOnly(item.createdAt);
        return createdDate >= startDate && createdDate <= endDate;
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    const byMethod = {};
    const byDay = {};
    payments.forEach((payment) => {
      const amountCents = Number(payment.amountCents || 0);
      const method = String(payment.method || "cash");
      const day = toDateOnly(payment.createdAt);
      byMethod[method] = byMethod[method] || { method, amountCents: 0, count: 0 };
      byMethod[method].amountCents += amountCents;
      byMethod[method].count += 1;
      byDay[day] = (byDay[day] || 0) + amountCents;
    });

    return {
      period: mode,
      startDate,
      endDate,
      totals: {
        count: payments.length,
        revenueCents: payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0)
      },
      byMethod: Object.values(byMethod),
      byDay: Object.entries(byDay)
        .map(([date, amountCents]) => ({ date, amountCents }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date))),
      recentPayments: payments.slice(0, 12).map((payment) => ({
        ...payment,
        clientName: payment.clientId ? clientNames.get(String(payment.clientId)) || "Cliente" : payment.walkInName || "Cliente occasionale"
      }))
    };
  }

  closeCashdesk(payload = {}, session = null) {
    const closeDate = toDateOnly(payload.date || nowIso());
    const summary = this.getPaymentsSummary({ period: "day", anchorDate: closeDate }, session);
    const unlinkedPayments = this.listUnlinkedPayments(session, { forceRefresh: true })
      .filter((payment) => toDateOnly(payment.createdAt || nowIso()) === closeDate);
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const openStatuses = new Set(["requested", "confirmed", "arrived", "in_progress", "ready_checkout"]);
    const openAppointments = appointments
      .filter((appointment) => toDateOnly(appointment.startAt || appointment.createdAt || nowIso()) === closeDate)
      .filter((appointment) => openStatuses.has(String(appointment.status || "")))
      .map((appointment) => ({
        id: appointment.id,
        clientId: appointment.clientId || "",
        clientName: appointment.clientName || appointment.walkInName || "Cliente",
        serviceName: appointment.serviceName || appointment.service || "Servizio",
        status: appointment.status || "",
        startAt: appointment.startAt || ""
      }));

    const blockers = [];
    if (unlinkedPayments.length) blockers.push(`${unlinkedPayments.length} pagamenti da collegare`);
    if (openAppointments.length) blockers.push(`${openAppointments.length} appuntamenti ancora aperti`);

    if (blockers.length) {
      return {
        success: false,
        status: "blocked",
        date: closeDate,
        message: `Cassa non chiusa: ${blockers.join(" e ")}.`,
        summary,
        unlinkedPayments,
        openAppointments
      };
    }

    const centerId = this.getCenterId(session);
    const existing = this.filterByCenter(this.cashClosuresRepository.list(), session)
      .find((item) => String(item.date || "") === closeDate);
    const closure = {
      id: existing?.id || makeId("cashclose"),
      centerId,
      centerName: this.getCenterName(session),
      date: closeDate,
      status: "closed",
      totalPayments: Number(summary?.totals?.count || 0),
      revenueCents: Number(summary?.totals?.revenueCents || 0),
      byMethod: summary?.byMethod || [],
      closedBy: session?.username || session?.role || "operatore",
      closedAt: nowIso(),
      updatedAt: nowIso()
    };

    const saved = existing
      ? this.cashClosuresRepository.update(existing.id, () => closure)
      : this.cashClosuresRepository.create(closure);
    return {
      success: true,
      status: "closed",
      message: "Cassa chiusa: giornata salvata e nessuna incoerenza aperta.",
      closure: saved || closure,
      summary,
      unlinkedPayments: [],
      openAppointments: []
    };
  }

  createPayment(payload = {}, session = null) {
    const existing = this.findExistingByIdempotency(this.paymentsRepository, payload, session);
    if (existing) return existing;
    const amountCents = assertRange(payload.amountCents || payload.amount || 0, "Importo pagamento", { min: 1, max: 100000000 });
    const walkInName = cleanText(payload.walkInName || "", "", 180);
    assertValid(Boolean(payload.clientId || walkInName || payload.appointmentId), "Cliente o appuntamento pagamento obbligatorio");
    const createdAt = payload.createdAt || nowIso();
    assertDateTime(createdAt, "Data pagamento");
    const payment = {
      id: makeId("pay"),
      idempotencyKey: idempotencyKey(payload),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      clientId: String(payload.clientId || ""),
      walkInName,
      appointmentId: String(payload.appointmentId || ""),
      amountCents,
      method: cleanText(payload.method || "cash", "cash", 40),
      description: cleanText(payload.description || payload.note || "", "", 1000),
      note: cleanText(payload.note || payload.description || "", "", 1000),
      createdAt
    };
    this.paymentsRepository.create(payment);
    this.invalidateBusinessSnapshot(this.getCenterId(session), this.dirtyBlocksForRepository(this.paymentsRepository));
    this.applyGoldStateEvent("payment_created", { after: payment }, session);
    return payment;
  }

  normalizeDashboardStatsOptions(options = {}) {
    const period = ["day", "week", "month"].includes(String(options.period || "")) ? String(options.period) : "day";
    return {
      period,
      anchorDate: toDateOnly(options.anchorDate || nowIso())
    };
  }

  getDashboardSnapshotId(options = {}, session = null) {
    const centerId = this.getCenterId(session);
    const normalized = this.normalizeDashboardStatsOptions(options);
    return [
      centerId,
      this.getPlanLevel(session),
      normalized.period,
      normalized.anchorDate
    ].map((part) => String(part || "").replace(/[^a-zA-Z0-9_-]+/g, "_")).join(":");
  }

  getDashboardRefreshSlotMs(session = null, intervalMs = DASHBOARD_AUTO_REFRESH_MS) {
    const seed = `${this.getCenterId(session)}:${session?.userId || session?.username || ""}`;
    const digest = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 8);
    return parseInt(digest, 16) % Math.max(1, intervalMs);
  }

  getDashboardNextRefreshAt(snapshot = null, session = null) {
    const slotMs = this.getDashboardRefreshSlotMs(session, DASHBOARD_AUTO_REFRESH_MS);
    let nextMs = Math.floor(Date.now() / DASHBOARD_AUTO_REFRESH_MS) * DASHBOARD_AUTO_REFRESH_MS + slotMs;
    if (nextMs <= Date.now()) nextMs += DASHBOARD_AUTO_REFRESH_MS;
    const generatedMs = snapshot?.generatedAt ? new Date(snapshot.generatedAt).getTime() : 0;
    while (Number.isFinite(generatedMs) && generatedMs > 0 && nextMs <= generatedMs) {
      nextMs += DASHBOARD_AUTO_REFRESH_MS;
    }
    return new Date(nextMs).toISOString();
  }

  findDashboardSnapshot(options = {}, session = null) {
    const id = this.getDashboardSnapshotId(options, session);
    return this.dashboardSnapshotsRepository.findById(id);
  }

  saveDashboardSnapshot(options = {}, session = null, payload = {}, meta = {}) {
    const normalized = this.normalizeDashboardStatsOptions(options);
    const id = this.getDashboardSnapshotId(normalized, session);
    const now = nowIso();
    const current = this.dashboardSnapshotsRepository.findById(id);
    const next = {
      id,
      centerId: this.getCenterId(session),
      plan: this.getPlanLevel(session),
      period: normalized.period,
      anchorDate: normalized.anchorDate,
      payload,
      generatedAt: now,
      source: meta.source || "manual",
      lastManualRefreshAt: meta.manual ? now : current?.lastManualRefreshAt || "",
      createdAt: current?.createdAt || now,
      updatedAt: now
    };
    if (current) return this.dashboardSnapshotsRepository.update(id, () => next);
    return this.dashboardSnapshotsRepository.create(next);
  }

  decorateDashboardSnapshot(snapshot = null, session = null, extra = {}) {
    const payload = snapshot?.payload || {};
    const generatedAt = snapshot?.generatedAt || "";
    const ageMs = generatedAt ? Date.now() - new Date(generatedAt).getTime() : 0;
    const stale = Boolean(generatedAt && ageMs > DASHBOARD_AUTO_REFRESH_MS);
    return {
      ...payload,
      dashboardCache: {
        cached: true,
        source: snapshot?.source || "saved",
        generatedAt,
        ageMs: Math.max(0, Number.isFinite(ageMs) ? ageMs : 0),
        stale,
        autoRefreshMs: DASHBOARD_AUTO_REFRESH_MS,
        manualCooldownMs: DASHBOARD_MANUAL_COOLDOWN_MS,
        nextAutoRefreshAt: this.getDashboardNextRefreshAt(snapshot, session),
        ...extra
      }
    };
  }

  getDashboardStats(options = {}, session = null) {
    const normalized = this.normalizeDashboardStatsOptions(options);
    const stateDashboard = this.buildDashboardStatsFromGoldState(normalized, session);
    if (stateDashboard) return stateDashboard;
    const snapshot = this.findDashboardSnapshot(normalized, session);
    if (snapshot?.payload) {
      return this.decorateDashboardSnapshot(snapshot, session);
    }
    const payload = this.computeDashboardStats(normalized, session);
    const saved = this.saveDashboardSnapshot(normalized, session, payload, { source: "bootstrap" });
    return this.decorateDashboardSnapshot(saved, session, {
      bootstrap: true,
      message: "Primo snapshot dashboard creato. Le prossime aperture leggeranno il dato salvato."
    });
  }

  refreshDashboardStats(options = {}, session = null, meta = {}) {
    const normalized = this.normalizeDashboardStatsOptions(options);
    const key = this.getDashboardSnapshotId(normalized, session);
    const current = this.findDashboardSnapshot(normalized, session);
    if (this.dashboardRefreshLocks.has(key)) {
      return this.decorateDashboardSnapshot(current, session, {
        refreshStatus: "in_progress",
        message: "Aggiornamento in corso"
      });
    }
    const lastRefreshAt = current?.lastManualRefreshAt || current?.generatedAt || "";
    const lastRefreshMs = lastRefreshAt ? new Date(lastRefreshAt).getTime() : 0;
    const waitMs = lastRefreshMs > 0 ? DASHBOARD_MANUAL_COOLDOWN_MS - (Date.now() - lastRefreshMs) : 0;
    if (meta.mode !== "scheduler" && waitMs > 0) {
      return this.decorateDashboardSnapshot(current, session, {
        refreshStatus: "cooldown",
        retryAfterMs: waitMs,
        message: "Dati aggiornati recentemente, riprova tra pochi minuti"
      });
    }
    this.dashboardRefreshLocks.add(key);
    try {
      const payload = this.computeDashboardStats(normalized, session);
      const saved = this.saveDashboardSnapshot(normalized, session, payload, {
        source: meta.mode === "scheduler" ? "scheduler" : "manual",
        manual: meta.mode !== "scheduler"
      });
      return this.decorateDashboardSnapshot(saved, session, {
        refreshStatus: "refreshed",
        message: "Dashboard aggiornata"
      });
    } finally {
      this.dashboardRefreshLocks.delete(key);
    }
  }

  computeDashboardStats(options = {}, session = null) {
    const plan = this.getPlanLevel(session);
    const goldEnabled = plan === "gold";
    const mode = String(options.period || "day");
    const anchorDate = toDateOnly(options.anchorDate || nowIso());
    let startDate = anchorDate;
    let endDate = anchorDate;
    if (mode === "week") {
      const range = getWeekWindow(anchorDate);
      startDate = range.startDate;
      endDate = range.endDate;
    } else if (mode === "month") {
      const range = getMonthWindow(anchorDate);
      startDate = range.startDate;
      endDate = range.endDate;
    }
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const serviceById = new Map(services.map((item) => [String(item.id || ""), item]));
    const inRange = (value) => {
      const date = toDateOnly(value || "");
      return date >= startDate && date <= endDate;
    };
    const todayAppointments = appointments.filter((item) => inRange(item.startAt || item.createdAt));
    const periodPayments = payments.filter((item) => inRange(item.createdAt));
    const now = Date.now();
    const lastVisitByClient = new Map();
    appointments.forEach((appointment) => {
      const clientId = String(appointment.clientId || "");
      if (!clientId) return;
      const visitTime = new Date(appointment.startAt || appointment.createdAt || "").getTime();
      if (!Number.isFinite(visitTime) || visitTime > now) return;
      const current = lastVisitByClient.get(clientId);
      if (!current || visitTime > current.time) {
        lastVisitByClient.set(clientId, { time: visitTime, appointment });
      }
    });
    const inactiveClients = goldEnabled ? clients.map((client) => {
      const clientId = String(client.id || "");
      const lastVisit = lastVisitByClient.get(clientId);
      const lastVisitAt = lastVisit?.appointment?.startAt || client.lastVisit || "";
      const lastVisitTime = lastVisitAt ? new Date(lastVisitAt).getTime() : NaN;
      const daysSinceLastVisit = Number.isFinite(lastVisitTime) ? Math.max(0, Math.floor((now - lastVisitTime) / 86400000)) : 999;
      const lastService = lastVisit?.appointment ? serviceById.get(String(lastVisit.appointment.serviceId || "")) : null;
      const routine = expectedRecallRoutineFromService(lastService || lastVisit?.appointment?.serviceName || "", 45);
      const { recallStatus, recallStatusLabel, overdueDays } = classifyRecallStatus(daysSinceLastVisit, routine.maxDays);
      return {
        clientId,
        name: `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "Cliente",
        phone: client.phone || "",
        daysSinceLastVisit,
        expectedRoutineDays: routine.maxDays,
        expectedRoutineRange: routine,
        recallStatus,
        recallStatusLabel,
        overdueDays,
        alertLevel: recallStatus === "a_rischio" ? "rischio" : recallStatus === "da_richiamare" ? "alert" : "nessuno",
        priorityScore: Math.round((Math.min(1, Math.max(0, overdueDays) / 90) * 70) + (client.phone || client.email ? 0 : 20))
      };
    })
      .filter((item) => item.recallStatus === "da_richiamare" || item.recallStatus === "a_rischio")
      .sort((a, b) => {
        const rank = { a_rischio: 2, da_richiamare: 1 };
        return (rank[b.recallStatus] || 0) - (rank[a.recallStatus] || 0) || b.priorityScore - a.priorityScore;
      })
      .slice(0, 12) : [];
    const revenueCents = periodPayments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const paymentSummary = this.getPaymentsSummary({ period: mode, anchorDate, startDate, endDate }, session);
    const dataQuality = this.getDataQuality(session, { summaryOnly: true });
    return {
      todayAppointments: todayAppointments.length,
      inactiveClientsCount: goldEnabled ? inactiveClients.length : 0,
      inactiveClients: goldEnabled ? inactiveClients : [],
      centerAverageFrequencyDays: goldEnabled ? 45 : null,
      completedAppointments: todayAppointments.filter((item) => item.status === "completed").length,
      confirmedAppointments: todayAppointments.filter((item) => item.status === "confirmed").length,
      arrivedAppointments: todayAppointments.filter((item) => item.status === "arrived").length,
      inProgressAppointments: todayAppointments.filter((item) => item.status === "in_progress").length,
      readyCheckoutAppointments: todayAppointments.filter((item) => item.status === "ready_checkout").length,
      pendingConfirmations: todayAppointments.filter((item) => item.status === "requested" || item.status === "booked").length,
      upcomingAppointments: todayAppointments.filter((item) => !["completed", "cancelled", "no_show"].includes(String(item.status || ""))).length,
      revenueCents,
      todayRevenueCents: revenueCents,
      activeClients: clients.length,
      activeClientsCount: clients.length,
      paymentSummary,
      dataQuality
    };
  }

  getOperationalReport(options = {}, session = null) {
    const period = String(options.period || "day");
    let startDate = toDateOnly(options.startDate || nowIso());
    let endDate = toDateOnly(options.endDate || startDate);
    if (startDate > endDate) {
      const swap = startDate;
      startDate = endDate;
      endDate = swap;
    }
    if (!options.forceRefresh) {
      const stateReport = this.buildOperationalReportFromGoldState({ ...options, period, startDate, endDate }, session);
      if (stateReport) return stateReport;
    }
    const cacheOptions = { startDate, endDate, period };
    if (!options.forceRefresh) {
      const cached = this.getCachedAnalyticsBlock(ANALYTICS_BLOCKS.OPERATIONAL_REPORT, cacheOptions, session);
      if (cached) return cached;
    }
    const inRange = (value) => {
      const dateOnly = toDateOnly(value || "");
      return Boolean(dateOnly && dateOnly >= startDate && dateOnly <= endDate);
    };
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session)
      .filter((item) => inRange(item.startAt || item.createdAt));
    const payments = this.filterByCenter(this.paymentsRepository.list(), session)
      .filter((item) => inRange(item.createdAt));
    const allCenterAppointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const allAppointmentsByClientId = groupByClientId(allCenterAppointments);
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const clientNames = new Map(clients.map((client) => [String(client.id || ""), `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "Cliente"]));
    const staffById = new Map(staff.map((item) => [String(item.id || ""), item]));
    const serviceById = new Map(services.map((item) => [String(item.id || ""), item]));
    const paymentsByAppointment = new Map();
    payments.forEach((payment) => {
      const key = String(payment.appointmentId || "");
      if (!key) return;
      paymentsByAppointment.set(key, (paymentsByAppointment.get(key) || 0) + Number(payment.amountCents || 0));
    });
    const revenueForAppointment = (appointment) => {
      const linked = paymentsByAppointment.get(String(appointment.id || ""));
      if (linked) return linked;
      const service = serviceById.get(String(appointment.serviceId || ""));
      return Number(service?.priceCents || appointment.priceCents || 0);
    };
    const byDay = new Map();
    const byOperator = new Map();
    const byService = new Map();
    const byClientSpend = new Map();
    const byClientVisits = new Map();
    appointments.forEach((appointment) => {
      const day = toDateOnly(appointment.startAt || appointment.createdAt);
      const revenueCents = revenueForAppointment(appointment);
      const dayRow = byDay.get(day) || { label: day, appointments: 0, revenueCents: 0 };
      dayRow.appointments += 1;
      dayRow.revenueCents += revenueCents;
      byDay.set(day, dayRow);

      const staffId = String(appointment.staffId || "unassigned");
      const operator = staffById.get(staffId);
      const operatorRow = byOperator.get(staffId) || {
        staffId,
        name: operator?.name || appointment.staffName || "Operatore libero",
        appointments: 0,
        completed: 0,
        revenueCents: 0,
        colorTag: operator?.colorTag || null
      };
      operatorRow.appointments += 1;
      if (appointment.status === "completed") operatorRow.completed += 1;
      operatorRow.revenueCents += revenueCents;
      byOperator.set(staffId, operatorRow);

      const serviceId = String(appointment.serviceId || "free");
      const service = serviceById.get(serviceId);
      const serviceRow = byService.get(serviceId) || {
        serviceId,
        name: service?.name || appointment.serviceName || "Servizio libero",
        appointments: 0,
        revenueCents: 0,
        colorTag: service?.colorTag || null
      };
      serviceRow.appointments += 1;
      serviceRow.revenueCents += revenueCents;
      byService.set(serviceId, serviceRow);

      const clientId = String(appointment.clientId || "");
      if (clientId) {
        const spendRow = byClientSpend.get(clientId) || { clientId, name: clientNames.get(clientId) || appointment.clientName || "Cliente", visits: 0, amountCents: 0 };
        spendRow.visits += 1;
        spendRow.amountCents += revenueCents;
        byClientSpend.set(clientId, spendRow);
        byClientVisits.set(clientId, { clientId, name: spendRow.name, visits: spendRow.visits });
      }
    });
    const revenueCents = payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const completedAppointments = appointments.filter((item) => item.status === "completed").length;
    const topServices = Array.from(byService.values()).sort((a, b) => b.appointments - a.appointments);
    const reportNow = Date.now();
    const centerAverageFrequencyDays = getCenterAverageFrequencyDays(clients, allAppointmentsByClientId, reportNow);
    const inactiveClients = clients.map((client) => {
      const routine = classifyClientRoutine(client, allAppointmentsByClientId, centerAverageFrequencyDays, reportNow, serviceById);
      return {
        clientId: String(client.id || ""),
        name: clientNames.get(String(client.id || "")) || "Cliente",
        phone: client.phone || "",
        daysSinceLastVisit: routine.daysSinceLastVisit,
        lastVisitAt: routine.lastVisitAt,
        clientType: routine.clientType,
        averageFrequencyDays: routine.averageFrequencyDays,
        routineDays: routine.routineDays,
        expectedRoutineDays: routine.expectedRoutineDays,
        expectedRoutineRange: routine.expectedRoutineRange,
        recallStatus: routine.recallStatus,
        recallStatusLabel: routine.recallStatusLabel,
        overdueDays: routine.overdueDays,
        alertLevel: routine.alertLevel
      };
    }).filter((item) => item.recallStatus === "da_richiamare" || item.recallStatus === "a_rischio").sort((a, b) => {
      const rank = { a_rischio: 2, da_richiamare: 1 };
      return (rank[b.recallStatus] || 0) - (rank[a.recallStatus] || 0) || b.overdueDays - a.overdueDays;
    }).slice(0, 10);
    const insights = [];
    if (completedAppointments === 0) insights.push("Completa e incassa gli appuntamenti per attivare un report più preciso.");
    if (topServices[0]) insights.push(`Servizio più richiesto nel periodo: ${topServices[0].name}.`);
    if (inactiveClients[0]) insights.push(`${inactiveClients.length} clienti sono da richiamare o a rischio.`);
    const report = {
      period,
      generatedAt: nowIso(),
      dateLabel: startDate === endDate ? startDate : `${startDate} - ${endDate}`,
      totals: {
        appointments: appointments.length,
        completedAppointments,
        cancelledAppointments: appointments.filter((item) => item.status === "cancelled").length,
        noShowAppointments: appointments.filter((item) => item.status === "no_show").length,
        revenueCents,
        averageTicketCents: payments.length ? Math.round(revenueCents / payments.length) : 0,
        activeClients: new Set(appointments.map((item) => item.clientId).filter(Boolean)).size,
        returningClients: Array.from(byClientVisits.values()).filter((item) => item.visits > 1).length,
        occasionalClients: appointments.filter((item) => !item.clientId).length,
        rebookingRate: appointments.length ? Math.round((completedAppointments / appointments.length) * 100) : 0
      },
      timeline: Array.from(byDay.values()).sort((a, b) => String(a.label).localeCompare(String(b.label))),
      topOperators: Array.from(byOperator.values()).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 8),
      topServices: topServices.slice(0, 8),
      lowServices: topServices.slice().sort((a, b) => a.appointments - b.appointments).slice(0, 5),
      topClientsBySpend: Array.from(byClientSpend.values()).sort((a, b) => b.amountCents - a.amountCents).slice(0, 8),
      frequentClients: Array.from(byClientVisits.values()).sort((a, b) => b.visits - a.visits).slice(0, 8),
      inactiveClients,
      technologyUsage: [],
      lowTechnologyUsage: [],
      insights
    };
    return this.setCachedAnalyticsBlock(ANALYTICS_BLOCKS.OPERATIONAL_REPORT, cacheOptions, session, report);
  }

  exportOperationalReport(options = {}, format = "pdf", session = null) {
    ensureDir(EXPORTS_DIR);
    const report = this.getOperationalReport(options, session);
    if (format === "pdf") {
      const fileName = `operational-report-${Date.now()}.pdf`;
      const filePath = path.join(EXPORTS_DIR, fileName);
      const sections = [
        { style: "title", text: "Report operativo Smart Desk" },
        { style: "heading", text: `Periodo: ${report.dateLabel}` },
        { style: "body", text: `Appuntamenti: ${report.totals.appointments}` },
        { style: "body", text: `Completati: ${report.totals.completedAppointments}` },
        { style: "body", text: `Annullati: ${report.totals.cancelledAppointments}` },
        { style: "body", text: `No-show: ${report.totals.noShowAppointments}` },
        { style: "body", text: `Incasso: ${euro(report.totals.revenueCents)}` },
        { style: "body", text: `Ticket medio: ${euro(report.totals.averageTicketCents)}` },
        { style: "heading", text: "Servizi principali" },
        ...(report.topServices || []).slice(0, 8).map((item) => ({ style: "body", text: `${item.name}: ${item.appointments} appuntamenti, ${euro(item.revenueCents)}` })),
        { style: "heading", text: "Operatori" },
        ...(report.topOperators || []).slice(0, 8).map((item) => ({ style: "body", text: `${item.name}: ${item.appointments} appuntamenti, ${item.completed} completati, ${euro(item.revenueCents)}` })),
        { style: "heading", text: "Insight" },
        ...((report.insights || []).length ? report.insights : ["Nessun insight critico nel periodo."]).map((item) => ({ style: "body", text: item }))
      ];
      writeSimplePdf(filePath, sections);
      return { path: filePath, format: "pdf", url: `/exports/${fileName}` };
    }
    const fileName = `operational-report-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = `<!doctype html><html lang="it"><body><h1>Report operativo</h1><p>Periodo: ${report.dateLabel}</p><p>Appuntamenti: ${report.totals.appointments}</p><p>Completati: ${report.totals.completedAppointments}</p><p>Incasso: ${euro(report.totals.revenueCents)}</p></body></html>`;
    fs.writeFileSync(filePath, html);
    return { path: filePath, format: "html", url: `/exports/${fileName}` };
  }

  getOperatorReport(operatorId, options = {}, session = null) {
    const operator = this.findByIdInCenter(this.staffRepository, operatorId, session);
    if (!operator) throw new Error("Operatore non trovato");
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session).filter((item) => item.staffId === operatorId);
    return {
      operator,
      periodLabel: String(options.period || "month"),
      summary: {
        completedAppointments: appointments.filter((item) => item.status === "completed").length,
        revenueCents: 0,
        averageTicketCents: 0,
        uniqueClients: new Set(appointments.map((item) => item.clientId).filter(Boolean)).size
      },
      services: { top: [] },
      clients: { total: appointments.length, newClients: 0, returningClients: 0, inactiveClients: 0 },
      activity: { daysWorked: 0, averageAppointmentsPerDay: 0, topTimeBand: "N/D", lowTimeBand: "N/D" },
      incentives: [],
      trend: { state: "stable", note: "Nessun confronto disponibile" },
      summaryText: "Report sintetico operatore"
    };
  }

  exportOperatorReport(operatorId, options = {}, session = null) {
    ensureDir(EXPORTS_DIR);
    const report = this.getOperatorReport(operatorId, options, session);
    const fileName = `operator-report-${sanitizeFileName(report.operator.name)}-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    fs.writeFileSync(filePath, "<!doctype html><html><body><h1>Report operatore</h1></body></html>");
    return { path: filePath, format: "html", url: `/exports/${fileName}` };
  }

  getCenterHealth(options = {}, session = null, precomputedOperational = null) {
    const nowDate = toDateOnly(nowIso());
    const startDate = toDateOnly(options.startDate || `${nowDate.slice(0, 7)}-01`);
    const endDate = toDateOnly(options.endDate || nowDate);
    const cacheOptions = { startDate, endDate };
    if (!precomputedOperational && !options.forceRefresh) {
      const cached = this.getCachedAnalyticsBlock(ANALYTICS_BLOCKS.CENTER_HEALTH, cacheOptions, session);
      if (cached) return cached;
    }
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    const endMs = new Date(`${endDate}T00:00:00`).getTime();
    const dayCount = Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(1, Math.round((endMs - startMs) / 86400000) + 1)
      : 30;
    const monthsEquivalent = Math.max(1, dayCount / 30);
    const settings = this.getSettings(session);
    const modelText = `${settings.businessModel || ""} ${settings.centerType || ""}`.toLowerCase();
    const isBarber = modelText.includes("barber");
    const thresholds = isBarber
      ? { under: 200000, fragile: 300000, stable: 400000 }
      : { under: 250000, fragile: 350000, stable: 500000 };
    const operational = precomputedOperational || this.getOperationalReport({ startDate, endDate }, session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const activeOperators = Math.max(1, staff.filter((item) => item.active !== false).length || staff.length || 1);
    const revenueCents = Number(operational.totals?.revenueCents || 0);
    const monthlyRevenueCents = Math.round(revenueCents / monthsEquivalent);
    const revenuePerOperatorCents = Math.round(monthlyRevenueCents / activeOperators);
    const workingDays = Math.max(1, Math.round(dayCount * 5 / 7));
    const expectedAppointmentsPerOperatorDay = isBarber ? 8 : 6;
    const expectedCapacity = Math.max(1, activeOperators * workingDays * expectedAppointmentsPerOperatorDay);
    const appointments = Number(operational.totals?.appointments || 0);
    const saturationPercent = Math.min(100, Math.round((appointments / expectedCapacity) * 100));
    const activeClients = Number(operational.totals?.activeClients || 0);
    const returningClients = Number(operational.totals?.returningClients || 0);
    const continuityPercent = activeClients ? Math.round((returningClients / activeClients) * 100) : 0;
    const scale = ["sotto_soglia", "fragile", "stabile", "forte"];
    let statusIndex = revenuePerOperatorCents < thresholds.under
      ? 0
      : revenuePerOperatorCents < thresholds.fragile
        ? 1
        : revenuePerOperatorCents < thresholds.stable
          ? 2
          : 3;
    if (saturationPercent < 20 || continuityPercent < 10 || activeClients < 5) {
      statusIndex = Math.min(statusIndex, 1);
    }
    if (revenuePerOperatorCents < thresholds.under && (saturationPercent < 15 || activeClients < 3)) {
      statusIndex = 0;
    }
    const status = scale[statusIndex];
    const statusLabel = status === "sotto_soglia"
      ? "sotto soglia"
      : status === "fragile"
        ? "fragile"
        : status;
    const level = status === "sotto_soglia"
      ? "critical"
      : status === "fragile"
        ? "warning"
        : "success";
    const blockers = [];
    if (revenuePerOperatorCents < thresholds.under) blockers.push("fatturato per operatore sotto soglia");
    if (saturationPercent < 20) blockers.push("agenda poco satura");
    if (continuityPercent < 10) blockers.push("continuità clienti bassa");
    if (activeClients < 5) blockers.push("pochi clienti attivi nel periodo");
    const reason = blockers.length
      ? blockers.join(" · ")
      : "fatturato, saturazione agenda e continuità clienti sono coerenti con il periodo.";
    const health = {
      status,
      statusLabel,
      level,
      businessModel: isBarber ? "barber" : "standard",
      period: { startDate, endDate, dayCount, monthsEquivalent },
      thresholds,
      revenueCents,
      monthlyRevenueCents,
      revenuePerOperatorCents,
      activeOperators,
      appointments,
      saturationPercent,
      activeClients,
      returningClients,
      continuityPercent,
      reason,
      note: "La salute centro non include margini prodotti o resa tecnologie: prima sopravvivenza del centro, poi ottimizzazione dei margini."
    };
    if (!precomputedOperational) {
      return this.setCachedAnalyticsBlock(ANALYTICS_BLOCKS.CENTER_HEALTH, cacheOptions, session, health);
    }
    return health;
  }

  openExportsFolder() {
    ensureDir(EXPORTS_DIR);
    const entries = fs.readdirSync(EXPORTS_DIR).sort().reverse();
    return { success: true, url: entries[0] ? `/exports/${entries[0]}` : null };
  }

  getProfitabilityOverview(options = {}, session = null, precomputed = {}) {
    const startDate = String(options.startDate || "");
    const endDate = String(options.endDate || "");
    const cacheOptions = { startDate, endDate };
    if (!options.forceRefresh && !precomputed.centerHealth) {
      const stateOverview = this.buildProfitabilityOverviewFromGoldState(options, session);
      if (stateOverview) return stateOverview;
    }
    if (!options.forceRefresh && !precomputed.centerHealth) {
      const cached = this.getCachedAnalyticsBlock(ANALYTICS_BLOCKS.PROFITABILITY, cacheOptions, session);
      if (cached) return cached;
    }
    const inRange = (value) => {
      const dateOnly = toDateOnly(value || "");
      if (!dateOnly) return false;
      if (startDate && dateOnly < startDate) return false;
      if (endDate && dateOnly > endDate) return false;
      return true;
    };
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session)
      .filter((item) => item.status === "completed" && inRange(item.startAt || item.createdAt));
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const inventory = this.filterByCenter(this.inventoryRepository.list(), session);
    const resources = this.filterByCenter(this.resourcesRepository.list(), session);
    const profitabilitySnapshot = computeCenterProfitabilitySnapshot({
      appointments,
      services,
      staff,
      payments,
      inventory,
      resources
    });
    const overview = {
      ...profitabilitySnapshot,
      centerHealth: precomputed.centerHealth || this.getCenterHealth({ startDate, endDate }, session),
      meta: {
        ...(profitabilitySnapshot.meta || {}),
        source: "profitability_core",
        legacyFallbackSeparated: true
      }
    };
    if (!precomputed.centerHealth) {
      return this.setCachedAnalyticsBlock(ANALYTICS_BLOCKS.PROFITABILITY, cacheOptions, session, overview);
    }
    return overview;
  }

  getAiGoldMarketing(session = null) {
    this.assertCanOperate(session);
    const goldEnabled = this.hasGoldIntelligence(session);
    if (!goldEnabled) {
      return {
        goldEnabled: false,
        message: "AI Gold Marketing disponibile solo con piano Gold.",
        suggestions: []
      };
    }
    const cached = this.getCachedAnalyticsBlock(ANALYTICS_BLOCKS.MARKETING_RECALL, {}, session);
    if (cached?.coreVersion === "gold_phi_marketing_v1") return cached;
    const now = Date.now();
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const serviceById = new Map(services.map((item) => [String(item.id), item]));
    const appointmentsByClientId = groupByClientId(appointments);
    const paymentsByClientId = groupByClientId(payments);
    const centerAverageFrequencyDays = getCenterAverageFrequencyDays(clients, appointmentsByClientId, now);
    const cleanDisplayName = (client) => {
      const raw = `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "Cliente";
      return String(raw)
        .replace(/^AI Gold Recall Test\s*-\s*/i, "")
        .replace(/^AI Gold Test\s*-\s*/i, "")
        .trim() || "Cliente";
    };
    const usableFirstName = (name) => {
      const first = String(name || "").trim().split(/\s+/)[0] || "";
      if (!first || /^(ai|gold|test|cliente|top|persa|perso|ferma|fermo|colore|cute|balayage|piega|keratina)$/i.test(first)) return "";
      return first;
    };
    const marketingActions = this.filterByCenter(this.aiMarketingActionsRepository.list(), session)
      .sort((a, b) => new Date(b.updatedAt || b.generatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.generatedAt || a.createdAt || 0).getTime());
    const latestActionByClientId = new Map();
    marketingActions.forEach((action) => {
      const clientId = String(action.clientId || "");
      if (!clientId || latestActionByClientId.has(clientId)) return;
      latestActionByClientId.set(clientId, action);
    });
    const annualValuesByClientId = new Map(clients.map((client) => {
      const clientId = String(client.id || "");
      const clientAppointments = appointmentsByClientId.get(clientId) || [];
      const clientPayments = paymentsByClientId.get(clientId) || [];
      const totalSpentCents = clientPayments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
      const averageTicketCents = clientPayments.length ? totalSpentCents / clientPayments.length : 0;
      const firstVisitTime = clientAppointments[0]?.startAt ? new Date(clientAppointments[0].startAt).getTime() : now;
      const observedDays = Number.isFinite(firstVisitTime) ? Math.max(30, Math.floor((now - firstVisitTime) / 86400000)) : 365;
      const frequencyAnnual = clientAppointments.length
        ? Math.max(1, clientAppointments.length * (365 / observedDays))
        : 1;
      return [clientId, averageTicketCents * frequencyAnnual];
    }));
    const maxAnnualValue = Math.max(1, ...Array.from(annualValuesByClientId.values()).map((value) => Number(value || 0)));
    const serviceSignal = (serviceName, clientName) => {
      const text = normalizeText(`${serviceName || ""} ${clientName || ""}`);
      if (text.includes("cute") || text.includes("o3") || text.includes("cuoio")) {
        return {
          area: "cute",
          motive: "Richiamo mirato sul percorso cute/cuoio capelluto.",
          proposal: "un controllo cute e una proposta di mantenimento O3",
          push: "spingere percorso cute/O3 e mantenimento programmato"
        };
      }
      if (text.includes("balayage") || text.includes("schiar") || text.includes("tonal")) {
        return {
          area: "balayage",
          motive: "Richiamo su mantenimento colore e luminosita lunghezze.",
          proposal: "un controllo balayage con tonalizzazione o trattamento gloss",
          push: "spingere tonalizzazione, gloss e trattamento protezione lunghezze"
        };
      }
      if (text.includes("colore") || text.includes("ricresc")) {
        return {
          area: "colore",
          motive: "Richiamo su ricrescita e mantenimento colore.",
          proposal: "un controllo colore con servizio di mantenimento",
          push: "spingere colore premium, gloss e mantenimento ricrescita"
        };
      }
      if (text.includes("keratina") || text.includes("lisciante")) {
        return {
          area: "keratina",
          motive: "Richiamo su controllo mantenimento lunghezze.",
          proposal: "un controllo mantenimento keratina e lunghezze",
          push: "spingere mantenimento post-trattamento e prodotti domiciliari"
        };
      }
      if (text.includes("piega")) {
        return {
          area: "piega",
          motive: "Richiamo su routine piega e frequenza di ritorno.",
          proposal: "una piega con trattamento rapido di luminosita",
          push: "spingere pacchetti piega, trattamento rapido e fidelizzazione"
        };
      }
      if (text.includes("taglio")) {
        return {
          area: "taglio",
          motive: "Richiamo su mantenimento taglio e ordine immagine.",
          proposal: "un controllo taglio e styling",
          push: "spingere ritorno programmato e servizi abbinati"
        };
      }
      return {
        area: "generale",
        motive: "Richiamo personalizzato per recuperare continuita cliente.",
        proposal: "un controllo personalizzato in salone",
        push: "spingere servizio premium coerente con lo storico cliente"
      };
    };
    const allSuggestions = clients.map((client) => {
      const clientId = String(client.id || "");
      const displayName = cleanDisplayName(client);
      const routine = classifyClientRoutine(client, appointmentsByClientId, centerAverageFrequencyDays, now, serviceById);
      const clientAppointments = routine.visits;
      const lastAppointment = routine.lastVisit || null;
      const daysSinceLastVisit = routine.daysSinceLastVisit;
      const averageFrequencyDays = routine.averageFrequencyDays;
      const clientPayments = paymentsByClientId.get(clientId) || [];
      const totalSpentCents = clientPayments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
      const clientPaymentsCount = clientPayments.length;
      const lastService = lastAppointment ? serviceById.get(String(lastAppointment.serviceId || "")) : null;
      const averageTicketCents = clientPaymentsCount ? Math.round(totalSpentCents / clientPaymentsCount) : Number(lastService?.priceCents || 0);
      const referenceValueCents = Math.max(averageTicketCents || 0, Number(lastService?.priceCents || 0));
      const valueSource = clientPaymentsCount
        ? "ticket_medio_reale"
        : Number(lastService?.priceCents || 0) > 0
          ? "prezzo_ultimo_servizio"
          : "dato_non_disponibile";
      const hasMarketingConsent = Boolean(client.marketingConsent);
      const timing = classifyMarketingTiming(daysSinceLastVisit, routine.expectedRoutineDays);
      const latestAction = latestActionByClientId.get(clientId) || null;
      const relationState = relationStateFromMarketingAction(latestAction);
      const lastMarketingAt = latestAction?.copiedAt || latestAction?.approvedAt || latestAction?.generatedAt || latestAction?.createdAt || "";
      const lastMarketingTime = lastMarketingAt ? new Date(lastMarketingAt).getTime() : NaN;
      const daysSinceLastMarketingContact = Number.isFinite(lastMarketingTime)
        ? Math.max(0, Math.floor((now - lastMarketingTime) / 86400000))
        : null;
      const marketingCooldownDays = relationState === "contattato" || relationState === "in_attesa"
        ? 10
        : relationState === "risposto" || relationState === "prenotato"
          ? 21
          : 7;
      const annualValueCents = Number(annualValuesByClientId.get(clientId) || 0);
      const valueScoreNormalized = normalizeScore(maxAnnualValue > 0 ? annualValueCents / maxAnnualValue : 0.6, totalSpentCents >= 50000 ? 1 : totalSpentCents > 15000 ? 0.6 : 0.3);
      const historyScore = relationState === "prenotato"
        ? 1
        : relationState === "risposto"
          ? 0.7
          : relationState === "contattato" || relationState === "in_attesa"
            ? 0.4
            : hasMarketingConsent
              ? 0.7
              : 0.2;
      const affinityScore = lastService?.name ? 1 : lastAppointment ? 0.7 : 0.4;
      const freshness = freshnessScoreFromDays(daysSinceLastMarketingContact);
      const timingFit = timingFitScore(timing.timingScore);
      const cooldownPenalty = daysSinceLastMarketingContact !== null && daysSinceLastMarketingContact < marketingCooldownDays
        ? normalizeScore((marketingCooldownDays - daysSinceLastMarketingContact) / Math.max(marketingCooldownDays, 1))
        : 0;
      const responseProbability = normalizeScore((0.35 * historyScore) + (0.30 * affinityScore) + (0.20 * freshness) + (0.15 * timingFit) - (0.35 * cooldownPenalty));
      const responseClass = scoreClass(responseProbability, [
        { key: "bassa", label: "bassa probabilità risposta", max: 0.35 },
        { key: "media", label: "media probabilità risposta", max: 0.60 },
        { key: "buona", label: "buona probabilità risposta", max: 0.80 },
        { key: "alta", label: "alta probabilità risposta", max: Infinity }
      ]);
      const economicScore = normalizeScore(responseProbability * valueScoreNormalized * Math.min(timing.timingScore, 2));
      const economicClass = scoreClass(economicScore, [
        { key: "bassa", label: "bassa convenienza", max: 0.20 },
        { key: "media", label: "media convenienza", max: 0.45 },
        { key: "buona", label: "buona convenienza", max: 0.70 },
        { key: "alta", label: "alta convenienza", max: Infinity }
      ]);
      const finalScore = normalizeScore((0.45 * responseProbability) + (0.35 * valueScoreNormalized) + (0.20 * (Math.min(timing.timingScore, 2) / 2)));
      const finalClass = scoreClass(finalScore, [
        { key: "non_contattare", label: "Non contattare", max: 0.30 },
        { key: "possibile", label: "Contatto possibile", max: 0.50 },
        { key: "consigliato", label: "Contatto consigliato", max: 0.70 },
        { key: "priorita_alta", label: "Priorità alta", max: Infinity }
      ]);
      const lockedRelation = ["in_attesa", "risposto", "prenotato"].includes(relationState);
      const tooRecent = daysSinceLastMarketingContact !== null && daysSinceLastMarketingContact < marketingCooldownDays;
      const veryLowResponse = responseProbability < 0.35 && valueScoreNormalized < 0.95;
      const lostOrHistoric = timing.timingClass === "perso" || timing.timingClass === "storico";
      const inRoutine = timing.timingClass === "in_routine";
      const frictionScore = normalizeScore(Math.max(
        !hasMarketingConsent ? 1 : 0,
        lockedRelation ? 0.95 : 0,
        tooRecent ? 0.9 : 0,
        lostOrHistoric ? 0.8 : 0,
        veryLowResponse ? 0.55 : 0,
        inRoutine ? 0.5 : 0
      ));
      const antiInvasiveReason = !hasMarketingConsent
        ? "Consenso marketing non confermato."
        : lockedRelation
          ? "Cliente già in gestione: non inviare un nuovo messaggio."
          : tooRecent
            ? `Contatto troppo recente: attendi almeno ${marketingCooldownDays} giorni.`
            : veryLowResponse
              ? "Probabilità risposta bassa: meglio non forzare il contatto."
              : inRoutine
                ? "Cliente in routine: nessun contatto necessario."
              : lostOrHistoric
                  ? "Fuori dalla lista giornaliera: usare riattivazione separata."
                  : "";
      const goldDecision = computeGoldDecisionScore("marketing", {
        needScore: Math.min(timing.timingScore, 2) / 2,
        valueScoreNormalized,
        timingFit,
        responseProbability,
        frictionScore,
        blockedByAntiInvasiveRule: Boolean(antiInvasiveReason),
        suggestedAction: antiInvasiveReason || undefined,
        explanation: antiInvasiveReason
          ? antiInvasiveReason
          : `Routine ${routine.expectedRoutineDays} gg, fuori di ${timing.deltaDays} gg: ${timing.timingLabel.toLowerCase()}.`
      });
      const shouldContactOld = !antiInvasiveReason && finalScore >= 0.5;
      const shouldContactNew = !antiInvasiveReason && goldDecision.score >= 0.55;
      const followUpSuggested = (relationState === "contattato" || relationState === "in_attesa")
        && daysSinceLastMarketingContact !== null
        && daysSinceLastMarketingContact >= 3
        && daysSinceLastMarketingContact <= 7
        && responseProbability >= 0.6
        && finalScore >= 0.55;
      const segment = timing.timingClass === "storico"
        ? "storico"
        : timing.timingClass === "perso"
          ? "perso"
          : timing.timingClass;
      const oldPriority = finalScore >= 0.7 && shouldContactOld
        ? "alta"
        : finalScore >= 0.5 && shouldContactOld
          ? "media"
          : "bassa";
      const newPriority = goldDecision.score >= 0.75 && shouldContactNew
        ? "alta"
        : goldDecision.score >= 0.55 && shouldContactNew
          ? "media"
          : "bassa";
      const priority = oldPriority;
      const pattern = segment === "perso"
        ? "cliente a rischio perdita"
        : segment === "storico"
          ? "cliente storico inattivo"
        : timing.timingClass === "recupero_soft" || timing.timingClass === "recupero_attivo"
          ? "cliente in calo"
          : timing.timingClass === "promemoria_naturale" || timing.timingClass === "mantenimento"
            ? "cliente da richiamare"
          : routine.clientType === "abituale"
            ? "cliente abituale"
            : routine.clientType === "saltuario"
              ? "cliente saltuario"
              : "cliente occasionale";
      const risk = !hasMarketingConsent || antiInvasiveReason
        ? "medio"
        : timing.timingScore >= 1.5
          ? "alto"
          : segment === "perso" || segment === "storico"
            ? "medio"
            : "basso";
      const operatingDecision = priority === "alta"
        ? "contattare oggi"
        : priority === "media"
          ? "contattare entro 3 giorni"
          : "non contattare ora";
      const firstName = String(client.firstName || client.name || "Cliente").trim().split(/\s+/)[0] || "Cliente";
      const motive = !hasMarketingConsent
        ? "Consenso marketing non confermato: contatto solo se autorizzato."
        : lastService?.name
          ? `Richiamo legato a ${lastService.name}.`
          : "Richiamo di mantenimento per continuità cliente.";
      const signal = serviceSignal(lastService?.name || "", displayName);
      const urgencyReason = !hasMarketingConsent
        ? "Prima serve consenso marketing registrato."
        : segment === "storico"
          ? `Cliente storico: ${daysSinceLastVisit} giorni senza ritorno, fuori dalle priorità del giorno.`
        : segment === "perso"
          ? `Cliente perso: routine ${routine.expectedRoutineDays} gg, ultimo appuntamento ${daysSinceLastVisit} gg fa.`
        : timing.deltaDays > 0
            ? `Routine ${routine.expectedRoutineDays} gg, oggi fuori di ${timing.deltaDays} gg: ${timing.timingLabel.toLowerCase()}.`
            : totalSpentCents >= 50000
              ? "Cliente ad alto valore: conviene presidiare continuità e proposta."
              : "Cliente in routine: non serve un nuovo contatto.";
      const recommendedAction = antiInvasiveReason
        ? antiInvasiveReason
        : !hasMarketingConsent
        ? "Apri scheda cliente e registra consenso prima di inviare comunicazioni."
        : timing.timingClass === "recupero_soft"
            ? "Invia un messaggio attento e proponi uno slot semplice."
          : timing.timingClass === "recupero_attivo"
              ? "Contatto diretto ma non commerciale: riprendere il percorso prima che si perda."
            : timing.timingClass === "mantenimento"
              ? "Messaggio consulenziale di mantenimento."
            : timing.timingClass === "promemoria_naturale"
              ? "Promemoria leggero, senza pressione."
            : segment === "perso"
              ? "Recupero non prioritario: usa una campagna separata, non la lista del giorno."
            : segment === "storico"
              ? "Non trattarlo come recall urgente: mantienilo nello storico inattivi."
            : "Nessuna azione ora.";
      const clearReason = segment === "perso"
        ? "cliente perso"
        : segment === "storico"
          ? "storico inattivo"
        : timing.timingClass === "recupero_soft" || timing.timingClass === "recupero_attivo"
          ? "cliente fuori ritmo"
          : timing.timingClass === "promemoria_naturale" || timing.timingClass === "mantenimento"
            ? "momento corretto per contatto leggero"
          : totalSpentCents >= 50000
            ? "cliente di valore da presidiare"
            : "non contattare ora";
      const safeAction = !hasMarketingConsent
        ? "Verifica consenso, poi chiama o scrivi in modo autorizzato."
        : shouldContactOld
          ? `Proponi un appuntamento semplice legato a ${lastService?.name || "servizio abituale"}.`
          : "Non inviare messaggi: resta in osservazione.";
      const upsellAction = !hasMarketingConsent
        ? "Dopo consenso, proponi check gratuito o consulenza breve."
        : shouldContactOld && signal.push
          ? `Abbina ${signal.push}.`
          : "Nessun upsell ora.";
      const conclusion = priority === "alta"
        ? `${displayName} va gestita oggi.`
        : priority === "media"
          ? `${displayName} va recuperata entro 3 giorni.`
          : `${displayName} non va contattata ora.`;
      const greeting = usableFirstName(displayName) ? `Ciao ${usableFirstName(displayName)}` : "Ciao";
      const timingText = daysSinceLastVisit >= 90
        ? `sono passati ${daysSinceLastVisit} giorni dall'ultimo appuntamento`
        : `siamo nel momento giusto per mantenere il risultato`;
      const messageByClass = {
        promemoria_naturale: `${greeting}, ${timingText}. Se vuoi, ti riservo uno slot per mantenere bene il risultato del tuo ultimo servizio.`,
        mantenimento: `${greeting}, ti consiglio un controllo per mantenere bene il lavoro fatto con ${lastService?.name || "il tuo ultimo servizio"}. Vuoi che guardiamo insieme uno slot comodo?`,
        recupero_soft: `${greeting}, ${timingText}. Meglio intervenire ora per non perdere il risultato: ti propongo ${signal.proposal}.`,
        recupero_attivo: `${greeting}, il timing è già avanzato. Può essere utile rivederci per capire come mantenere o riprendere il percorso. Vuoi che ti proponga uno slot?`,
        perso: `${greeting}, se vuoi riprendere da dove avevamo lasciato, possiamo capire insieme cosa fare ora.`
      };
      const fT = normalizeScore(Math.min(timing.timingScore, 2) / 2);
      const fV = normalizeScore(valueScoreNormalized);
      const fR = normalizeScore(responseProbability);
      const fB = normalizeScore((affinityScore + timingFit) / 2);
      const fS = normalizeScore(frictionScore);
      return {
        clientId,
        name: displayName,
        phone: client.phone || "",
        daysSinceLastVisit,
        averageFrequencyDays,
        totalSpentCents,
        averageTicketCents,
        referenceValueCents,
        valueSource,
        estimatedRecallValueCents: referenceValueCents,
        lossIfIgnoredCents: 0,
        annualValueCents: Math.round(annualValueCents),
        valueScoreNormalized: Number(valueScoreNormalized.toFixed(2)),
        responseProbability: Number(responseProbability.toFixed(2)),
        responseProbabilityPercent: Math.round(responseProbability * 100),
        responseProbabilityLabel: responseClass.label,
        responseClass: responseClass.key,
        economicScore: Number(economicScore.toFixed(2)),
        economicConvenienceLabel: economicClass.label,
        economicConvenienceClass: economicClass.key,
        finalScore: Number(finalScore.toFixed(2)),
        finalScorePercent: Math.round(finalScore * 100),
        finalPriorityLabel: finalClass.label,
        finalPriorityClass: finalClass.key,
        oldDecision: {
          score: Number(finalScore.toFixed(3)),
          scorePercent: Math.round(finalScore * 100),
          priority: oldPriority,
          priorityLabel: finalClass.label,
          shouldContact: shouldContactOld
        },
        goldDecision,
        newDecision: {
          phi: goldDecision.score,
          phiPercent: goldDecision.scorePercent,
          priority: newPriority,
          priorityLabel: goldDecision.priorityLabel,
          shouldContact: shouldContactNew,
          fT: Number(fT.toFixed(3)),
          fV: Number(fV.toFixed(3)),
          fR: Number(fR.toFixed(3)),
          fB: Number(fB.toFixed(3)),
          fS: Number(fS.toFixed(3))
        },
        timingScore: Number(timing.timingScore.toFixed(2)),
        timingClass: timing.timingClass,
        timingLabel: timing.timingLabel,
        contactClass: timing.timingClass,
        contactClassLabel: timing.contactClassLabel,
        daysOutOfRoutine: timing.deltaDays,
        daysSinceLastMarketingContact,
        marketingCooldownDays,
        cooldownActive: Boolean(tooRecent),
        relationState,
        shouldContact: shouldContactOld,
        shouldContactOld,
        shouldContactNew,
        followUpSuggested,
        antiInvasiveReason,
        segment,
        pattern,
        priority,
        risk,
        clientType: routine.clientType,
        visitCount: routine.visitCount,
        routineDays: routine.routineDays,
        expectedRoutineDays: routine.expectedRoutineDays,
        expectedRoutineRange: routine.expectedRoutineRange,
        recallStatus: routine.recallStatus,
        recallStatusLabel: routine.recallStatusLabel,
        overdueDays: routine.overdueDays,
        centerAverageFrequencyDays: routine.centerAverageFrequencyDays,
        alertLevel: routine.alertLevel,
        operatingDecision,
        clearReason,
        safeAction,
        upsellAction,
        conclusion,
        urgencyReason,
        recommendedAction,
        motive: hasMarketingConsent ? signal.motive : motive,
        lastServiceName: lastService?.name || "",
        hasMarketingConsent,
        suggestedPush: signal.push,
        valueLabel: valueSource === "dato_non_disponibile"
          ? "Valore economico non disponibile: mancano incassi o prezzo ultimo servizio."
          : valueSource === "ticket_medio_reale"
            ? `Riferimento economico: ticket medio reale ${euro(referenceValueCents)}.`
            : `Riferimento economico: prezzo ultimo servizio ${euro(referenceValueCents)}.`,
        message: hasMarketingConsent
          ? shouldContactOld
            ? messageByClass[timing.timingClass] || `${greeting}, ti propongo un controllo leggero sul tuo percorso. Vuoi che guardiamo uno slot comodo?`
            : antiInvasiveReason || "Nessun messaggio da inviare ora."
          : `Prima di inviare messaggi marketing a ${firstName}, verifica e registra il consenso marketing nella scheda cliente.`
      };
    });
    const prioritySuggestions = allSuggestions.filter((item) => item.shouldContact && item.finalScore >= 0.5 && item.recallStatus !== "perso" && item.recallStatus !== "storico")
      .sort((a, b) => {
        const weight = { alta: 3, media: 2, bassa: 1 };
        return Number(b.finalScore || 0) - Number(a.finalScore || 0)
          || (weight[b.priority] || 0) - (weight[a.priority] || 0)
          || Number(b.economicScore || 0) - Number(a.economicScore || 0);
      })
      .slice(0, 20);
    const dataQualitySummary = this.getDataQuality(session, { summaryOnly: true });
    const softMarketingEligible = Number(dataQualitySummary?.score || 0) >= 65
      && Number(dataQualitySummary?.metrics?.clientsMissingLastVisit || 0) === 0
      && Number(dataQualitySummary?.metrics?.appointments || 0) > 0
      && Number(dataQualitySummary?.metrics?.payments || 0) > 0;
    const softModeSuggestions = prioritySuggestions.length
      ? []
      : allSuggestions.filter((item) => {
        if (item.antiInvasiveReason) return false;
        if (item.recallStatus === "perso" || item.recallStatus === "storico") return false;
        if (!softMarketingEligible) return false;
        if (!["recupero_soft", "recupero_attivo", "mantenimento", "promemoria_naturale"].includes(String(item.timingClass || ""))) return false;
        return Number(item.goldDecision?.score || 0) >= 0.4 || Number(item.finalScore || 0) >= 0.38;
      })
        .sort((a, b) => Number(b.goldDecision?.score || 0) - Number(a.goldDecision?.score || 0)
          || Number(b.finalScore || 0) - Number(a.finalScore || 0)
          || Number(b.economicScore || 0) - Number(a.economicScore || 0))
        .slice(0, 12);
    const activeSuggestions = prioritySuggestions.length ? prioritySuggestions : softModeSuggestions;
    const lostClients = allSuggestions.filter((item) => item.recallStatus === "perso")
      .sort((a, b) => b.overdueDays - a.overdueDays)
      .slice(0, 20);
    const historicInactiveClients = allSuggestions.filter((item) => item.recallStatus === "storico")
      .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit)
      .slice(0, 40);
    const blockedClients = allSuggestions.filter((item) => !item.shouldContact && item.recallStatus !== "perso" && item.recallStatus !== "storico");
    const newPrioritySuggestions = allSuggestions.filter((item) => item.shouldContactNew && item.goldDecision?.score >= 0.55 && item.recallStatus !== "perso" && item.recallStatus !== "storico")
      .sort((a, b) => Number(b.goldDecision?.score || 0) - Number(a.goldDecision?.score || 0)
        || Number(b.economicScore || 0) - Number(a.economicScore || 0))
      .slice(0, 20);
    const oldTop10 = activeSuggestions.slice(0, 10);
    const newTop10 = newPrioritySuggestions.slice(0, 10);
    const oldTopIds = new Set(oldTop10.map((item) => item.clientId));
    const newTopIds = new Set(newTop10.map((item) => item.clientId));
    const overlapIds = [...oldTopIds].filter((clientId) => newTopIds.has(clientId));
    const oldOnlyIds = [...oldTopIds].filter((clientId) => !newTopIds.has(clientId));
    const newOnlyIds = [...newTopIds].filter((clientId) => !oldTopIds.has(clientId));
    const factorLabel = (item) => {
      const factors = [
        { key: "fT", label: "timing", value: Number(item.newDecision?.fT || 0) },
        { key: "fV", label: "valore cliente", value: Number(item.newDecision?.fV || 0) },
        { key: "fR", label: "probabilita risposta", value: Number(item.newDecision?.fR || 0) },
        { key: "fB", label: "coerenza comportamento/messaggio", value: Number(item.newDecision?.fB || 0) },
        { key: "fS", label: "frizione anti-spam", value: Number(item.newDecision?.fS || 0) }
      ];
      return factors.sort((a, b) => b.value - a.value)[0];
    };
    const priorityNumber = (priority) => ({ alta: 3, media: 2, bassa: 1 }[String(priority || "")] || 0);
    const engineLogs = allSuggestions.map((item) => ({
      customerId: item.clientId,
      customerName: item.name,
      D: item.daysSinceLastVisit,
      R: item.expectedRoutineDays,
      delta: item.daysOutOfRoutine,
      OLD_priority: item.oldDecision?.priority || item.priority,
      NEW_phi: item.goldDecision?.score || 0,
      fT: item.newDecision?.fT || 0,
      fV: item.newDecision?.fV || 0,
      fR: item.newDecision?.fR || 0,
      fB: item.newDecision?.fB || 0,
      fS: item.newDecision?.fS || 0,
      NEW_priority: item.newDecision?.priority || "bassa",
      contactType: item.contactClassLabel,
      shouldContact_NEW: Boolean(item.shouldContactNew),
      shouldContact_OLD: Boolean(item.shouldContactOld)
    }));
    const differenceIds = new Set([...oldOnlyIds, ...newOnlyIds]);
    const differences = [...differenceIds].map((clientId) => {
      const item = allSuggestions.find((candidate) => candidate.clientId === clientId);
      const factor = item ? factorLabel(item) : null;
      const oldSelected = oldTopIds.has(clientId);
      const newSelected = newTopIds.has(clientId);
      return {
        customerId: clientId,
        customerName: item?.name || "Cliente",
        oldSelected,
        newSelected,
        oldReason: oldSelected
          ? `OLD lo include per score ${Math.round(Number(item?.oldDecision?.score || 0) * 100)}% e priorita ${item?.oldDecision?.priority || "bassa"}.`
          : "OLD non lo include nella top 10.",
        newReason: newSelected
          ? `NEW lo include per Φ ${Math.round(Number(item?.goldDecision?.score || 0) * 100)}% e band ${item?.goldDecision?.priorityLabel || "non prioritario"}.`
          : `NEW lo esclude o lo abbassa: ${item?.antiInvasiveReason || "score Φ non sufficiente per top list."}`,
        strongestFactor: factor?.key || "",
        strongestFactorLabel: factor?.label || "",
        strongestFactorValue: factor ? Number(factor.value.toFixed(3)) : 0
      };
    });
    const contactableOld = allSuggestions.filter((item) => item.shouldContactOld).length;
    const contactableNew = allSuggestions.filter((item) => item.shouldContactNew).length;
    const avoidedNewButNotOld = allSuggestions.filter((item) => item.shouldContactOld && !item.shouldContactNew).length;
    const averagePriorityChange = allSuggestions.length
      ? average(allSuggestions.map((item) => priorityNumber(item.newDecision?.priority) - priorityNumber(item.oldDecision?.priority)))
      : 0;
    const engineTest = {
      mode: "dual_engine",
      activeEngineForUi: "OLD",
      testedEngine: "NEW_GOLD_PHI_MARKETING",
      generatedAt: nowIso(),
      records: engineLogs,
      topOld: oldTop10.map((item) => ({ customerId: item.clientId, name: item.name, score: item.oldDecision?.score || 0, priority: item.oldDecision?.priority || item.priority })),
      topNew: newTop10.map((item) => ({ customerId: item.clientId, name: item.name, phi: item.goldDecision?.score || 0, priority: item.newDecision?.priority || "bassa" })),
      comparison: {
        oldTopCount: oldTop10.length,
        newTopCount: newTop10.length,
        overlapCount: overlapIds.length,
        changedCount: differenceIds.size,
        oldOnly: oldOnlyIds,
        newOnly: newOnlyIds
      },
      differences,
      kpis: {
        oldContactablePercent: allSuggestions.length ? Math.round((contactableOld / allSuggestions.length) * 100) : 0,
        newContactablePercent: allSuggestions.length ? Math.round((contactableNew / allSuggestions.length) * 100) : 0,
        avoidedNewButNotOldPercent: allSuggestions.length ? Math.round((avoidedNewButNotOld / allSuggestions.length) * 100) : 0,
        averagePriorityChange: Number(averagePriorityChange.toFixed(2)),
        phiOver07: allSuggestions.filter((item) => Number(item.goldDecision?.score || 0) > 0.7).length,
        phiUnder03: allSuggestions.filter((item) => Number(item.goldDecision?.score || 0) < 0.3).length
      },
      qualitativeReviewTopNew: newTop10.map((item) => ({
        customerId: item.clientId,
        name: item.name,
        makesSenseToContact: Boolean(item.shouldContactNew && !item.antiInvasiveReason),
        timingOk: Number(item.newDecision?.fT || 0) > 0,
        messageCoherent: Number(item.newDecision?.fB || 0) >= 0.5,
        lessInvasiveThanOld: !item.shouldContactOld && item.shouldContactNew ? false : Number(item.newDecision?.fS || 0) < 0.5,
        note: item.goldDecision?.explanation || item.recommendedAction || ""
      })),
      tuningSuggestions: [
        avoidedNewButNotOld > contactableOld * 0.4 ? "NEW frena molti clienti rispetto a OLD: valutare riduzione peso frizione fS." : "",
        allSuggestions.filter((item) => Number(item.goldDecision?.score || 0) > 0.7).length === 0 ? "Nessun cliente con Φ > 0.7: valutare soglia alta o bias marketing se la lista risulta troppo conservativa." : "",
        contactableNew > contactableOld ? "NEW spinge piu contatti di OLD: controllare peso anti-spam prima di attivarlo come principale." : ""
      ].filter(Boolean)
    };
    const contactsMade = marketingActions.filter((item) => ["copied", "done"].includes(String(item.status || ""))).length;
    const bookingsGenerated = marketingActions.filter((item) => String(item.status || "") === "done").length;
    const recoveryValueCents = marketingActions
      .filter((item) => String(item.status || "") === "done")
      .reduce((sum, item) => sum + Number(item.referenceValueCents || item.estimatedValueCents || 0), 0);
    const potentialRecoveryScore = activeSuggestions.reduce((sum, item) => sum + Number(item.economicScore || 0), 0);
    const marketing = {
      goldEnabled: true,
      coreVersion: "gold_phi_marketing_v1",
      generatedAt: nowIso(),
      suggestions: activeSuggestions,
      lostClients,
      historicInactiveClients,
      counts: {
        priority: activeSuggestions.length,
        lost: lostClients.length,
        historic: historicInactiveClients.length,
        avoid: blockedClients.length,
        waiting: allSuggestions.filter((item) => ["in_attesa", "risposto", "prenotato"].includes(item.relationState)).length
      },
      kpis: {
        contactsMade,
        responseRate: contactsMade ? Math.round((bookingsGenerated / contactsMade) * 100) : 0,
        bookingRate: contactsMade ? Math.round((bookingsGenerated / contactsMade) * 100) : 0,
        revenueRecoveryCents: recoveryValueCents,
        potentialRecoveryScore: Number(potentialRecoveryScore.toFixed(2)),
        recommendedToday: activeSuggestions.length,
        avoidToday: blockedClients.length,
        waiting: allSuggestions.filter((item) => ["in_attesa", "risposto", "prenotato"].includes(item.relationState)).length
      },
      engineTest,
      mode: prioritySuggestions.length ? "standard" : softModeSuggestions.length ? "soft" : "blocked"
    };
    return this.setCachedAnalyticsBlock(ANALYTICS_BLOCKS.MARKETING_RECALL, {}, session, marketing, 30000);
  }

  normalizeGoldMarketingStatus(status = "") {
    const normalized = String(status || "").toLowerCase();
    if (["approved", "copied", "queued", "sent", "delivered", "read", "done"].includes(normalized)) return "approved";
    if (["archived", "discarded", "rejected", "scartata", "scartato"].includes(normalized)) return "discarded";
    return "to_approve";
  }

  buildGoldMarketingActionState(session = null) {
    if (!this.hasGoldIntelligence(session)) {
      return {
        source: "gold_decision_engine",
        sourceEndpoint: "/api/ai-gold/state",
        generatedAt: nowIso(),
        actions: [],
        counters: {
          clientsAtRiskToday: 0,
          totalActions: 0,
          approvedActions: 0,
          callableApproved: 0
        },
        debug: {
          clientsAnalyzed: 0,
          excludedByFilter: 0,
          nonContactable: 0,
          inCooldown: 0,
          generatedActions: 0
        }
      };
    }
    const marketing = this.getAiGoldMarketing(session);
    const suggestions = Array.isArray(marketing?.suggestions) ? marketing.suggestions : [];
    const analyzed = Array.isArray(marketing?.engineTest?.records)
      ? marketing.engineTest.records.length
      : suggestions.length
        + (Array.isArray(marketing?.lostClients) ? marketing.lostClients.length : 0)
        + (Array.isArray(marketing?.historicInactiveClients) ? marketing.historicInactiveClients.length : 0)
        + Number(marketing?.counts?.avoid || 0);
    const persistedActions = this.filterByCenter(this.aiMarketingActionsRepository.list(), session)
      .filter((item) => String(item.type || "recall") === "recall")
      .sort((a, b) => new Date(b.updatedAt || b.generatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.generatedAt || a.createdAt || 0).getTime());
    const persistedByClientId = new Map();
    persistedActions.forEach((action) => {
      const clientId = String(action.clientId || "");
      if (!clientId || persistedByClientId.has(clientId)) return;
      persistedByClientId.set(clientId, action);
    });
    const actions = suggestions.map((suggestion) => {
      const clientId = String(suggestion.clientId || "");
      const persisted = persistedByClientId.get(clientId) || null;
      const status = this.normalizeGoldMarketingStatus(persisted?.status || suggestion.status || "to_approve");
      const contactable = Boolean(suggestion.hasMarketingConsent && (suggestion.phone || suggestion.email || suggestion.clientPhone));
      const inCooldown = Number(suggestion.daysSinceLastMarketingContact ?? 999) < 3;
      const valueCents = Number(suggestion.referenceValueCents || suggestion.estimatedRecallValueCents || suggestion.averageTicketCents || 0);
      const riskClient = ["recupero_soft", "recupero_attivo", "perso"].includes(String(suggestion.recallStatus || suggestion.timingClass || suggestion.segment || ""));
      return {
        id: persisted?.id || `gold-action-${clientId}`,
        virtual: !persisted,
        generatedByGold: true,
        source: "gold_decision_engine",
        sourceEndpoint: "/api/ai-gold/state",
        clientId,
        clientName: suggestion.name || "Cliente",
        name: suggestion.name || "Cliente",
        phone: suggestion.phone || "",
        type: "recall",
        status,
        statusLabel: status === "approved" ? "approvata" : status === "discarded" ? "scartata" : "da approvare",
        priority: suggestion.priority || "media",
        priorityLabel: suggestion.priority === "alta" ? "Critico" : suggestion.priority === "media" ? "Attenzione" : "OK",
        risk: suggestion.risk || "basso",
        riskLabel: riskClient ? "Rischio" : "Presidio",
        isImmediateRisk: Boolean(riskClient && ["alta", "media"].includes(String(suggestion.priority || ""))),
        highValueOpportunity: suggestion.priority === "alta" || valueCents >= 10000,
        contactable,
        inCooldown,
        hasMarketingConsent: Boolean(suggestion.hasMarketingConsent),
        pattern: suggestion.pattern || "",
        segment: suggestion.segment || "",
        reason: suggestion.motive || suggestion.urgencyReason || "Azione marketing generata da AI Gold.",
        motive: suggestion.motive || "",
        operatingDecision: suggestion.operatingDecision || "",
        clearReason: suggestion.clearReason || "",
        safeAction: suggestion.safeAction || "",
        upsellAction: suggestion.upsellAction || "",
        conclusion: suggestion.conclusion || "",
        urgencyReason: suggestion.urgencyReason || "",
        recommendedAction: suggestion.recommendedAction || "",
        estimatedValueCents: Number(suggestion.estimatedRecallValueCents || valueCents || 0),
        referenceValueCents: valueCents,
        valueSource: suggestion.valueSource || "",
        valueLabel: suggestion.valueLabel || "",
        lossIfIgnoredCents: Number(suggestion.lossIfIgnoredCents || 0),
        suggestedMessage: suggestion.message || "",
        message: suggestion.message || "",
        responseProbabilityPercent: Number(suggestion.responseProbabilityPercent || 0),
        economicConvenienceLabel: suggestion.economicConvenienceLabel || "",
        finalPriorityLabel: suggestion.finalPriorityLabel || "",
        relationState: suggestion.relationState || "non_contattato",
        daysSinceLastMarketingContact: suggestion.daysSinceLastMarketingContact ?? null,
        goldDecision: suggestion.goldDecision || null,
        generatedAt: persisted?.generatedAt || marketing.generatedAt || nowIso(),
        updatedAt: persisted?.updatedAt || marketing.generatedAt || nowIso()
      };
    });
    const approvedActions = actions.filter((item) => item.status === "approved").length;
    const callableApproved = actions.filter((item) => item.status === "approved" && item.contactable && !item.inCooldown).length;
    const debug = {
      clientsAnalyzed: analyzed,
      excludedByFilter: Math.max(0, analyzed - actions.length),
      nonContactable: actions.filter((item) => !item.contactable).length,
      inCooldown: actions.filter((item) => item.inCooldown).length,
      generatedActions: actions.length
    };
    const counters = {
      clientsAtRiskToday: actions.filter((item) => item.isImmediateRisk).length,
      totalActions: actions.length,
      approvedActions,
      callableApproved,
      highValueOpportunities: actions.filter((item) => item.highValueOpportunity).length,
      toApprove: actions.filter((item) => item.status === "to_approve").length,
      discarded: actions.filter((item) => item.status === "discarded").length
    };
    if (actions.length > 0 && debug.generatedActions === 0) {
      console.error("[gold_marketing_alignment_error]", JSON.stringify({
        centerId: this.getCenterId(session),
        reason: "actions_present_generated_zero",
        actions: actions.length,
        debug
      }));
    }
    return {
      source: "gold_decision_engine",
      sourceEndpoint: "/api/ai-gold/state",
      generatedAt: marketing.generatedAt || nowIso(),
      actions,
      counters,
      debug,
      semantics: {
        critical: "opportunita_ad_alto_valore",
        risk: "cliente_che_puo_perdersi",
        marketingActions: "opportunita_generate_da_ai"
      }
    };
  }

  getAiMarketingAutopilot(session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      return {
        goldEnabled: false,
        message: "Marketing Autopilot disponibile solo con piano Gold.",
        actions: []
      };
    }
    const marketingActions = this.getGoldState(session).marketingActions || this.buildGoldMarketingActionState(session);
    const actions = (marketingActions.actions || [])
      .sort((a, b) => {
        const priorityRank = { alta: 3, media: 2, bassa: 1 };
        const statusRank = { to_approve: 4, approved: 3, copied: 2, done: 1, archived: 0, discarded: 0 };
        return (priorityRank[String(b.priority || "")] || 0) - (priorityRank[String(a.priority || "")] || 0)
          || (statusRank[String(b.status || "")] || 0) - (statusRank[String(a.status || "")] || 0)
          || new Date(b.generatedAt || b.createdAt || 0).getTime() - new Date(a.generatedAt || a.createdAt || 0).getTime();
      });
    return {
      goldEnabled: true,
      generatedAt: marketingActions.generatedAt || nowIso(),
      actions,
      debug: marketingActions.debug || {},
      counters: marketingActions.counters || {},
      sourceEndpoint: "/api/ai-gold/state",
      summary: {
        total: actions.length,
        pending: actions.filter((item) => ["new", "to_approve"].includes(String(item.status || ""))).length,
        approved: actions.filter((item) => String(item.status || "") === "approved").length,
        done: actions.filter((item) => item.status === "done").length,
        archived: actions.filter((item) => ["archived", "discarded"].includes(String(item.status || ""))).length
      }
    };
  }

  generateAiMarketingAutopilotActions(session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      return {
        goldEnabled: false,
        message: "Marketing Autopilot disponibile solo con piano Gold.",
        actions: []
      };
    }
    const centerId = this.getCenterId(session);
    const centerName = this.getCenterName(session);
    const today = toDateOnly(nowIso());
    const existing = this.filterByCenter(this.aiMarketingActionsRepository.list(), session);
    const snapshot = this.getBusinessSnapshot({}, session);
    const insight = snapshot.marketing || { suggestions: [] };
    const created = [];
    const priorityRank = { alta: 3, media: 2, bassa: 1 };
    const candidates = (insight.suggestions || [])
      .filter((item) => item.hasMarketingConsent)
      .sort((a, b) => (
        (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0)
        || Number(b.daysSinceLastVisit || 0) - Number(a.daysSinceLastVisit || 0)
      ))
      .slice(0, 12);

    candidates.forEach((suggestion) => {
      const alreadyOpen = existing.some((item) => (
        String(item.clientId || "") === String(suggestion.clientId || "")
        && String(item.type || "") === "recall"
        && !["done", "archived"].includes(String(item.status || ""))
      ));
      const generatedToday = existing.some((item) => (
        String(item.clientId || "") === String(suggestion.clientId || "")
        && toDateOnly(item.generatedAt || item.createdAt) === today
      ));
      if (alreadyOpen || generatedToday) return;
      const action = {
        id: makeId("aimkt"),
        centerId,
        centerName,
        clientId: String(suggestion.clientId || ""),
        clientName: suggestion.name || "Cliente",
        type: "recall",
        status: "to_approve",
        priority: suggestion.priority || "media",
        risk: suggestion.risk || "medio",
        pattern: suggestion.pattern || "",
        operatingDecision: suggestion.operatingDecision || "",
        clearReason: suggestion.clearReason || "",
        safeAction: suggestion.safeAction || "",
        upsellAction: suggestion.upsellAction || "",
        conclusion: suggestion.conclusion || "",
        segment: suggestion.segment || "",
        reason: suggestion.motive || "Richiamo suggerito da AI Gold.",
        urgencyReason: suggestion.urgencyReason || "",
        recommendedAction: suggestion.recommendedAction || "",
        estimatedValueCents: Number(suggestion.estimatedRecallValueCents || 0),
        referenceValueCents: Number(suggestion.referenceValueCents || suggestion.estimatedRecallValueCents || 0),
        valueSource: suggestion.valueSource || "",
        valueLabel: suggestion.valueLabel || "",
        lossIfIgnoredCents: 0,
        suggestedMessage: suggestion.message || "",
        source: "ai_gold_marketing",
        aiProvider: "rules",
        generatedAt: nowIso(),
        updatedAt: nowIso(),
        completedAt: "",
        archivedAt: "",
        approvedAt: "",
        copiedAt: ""
      };
      this.aiMarketingActionsRepository.create(action);
      created.push(action);
    });
    if (created.length) {
      this.invalidateBusinessSnapshot(centerId, [ANALYTICS_BLOCKS.MARKETING_RECALL, ANALYTICS_BLOCKS.GOLD_STATE]);
    }

    return {
      goldEnabled: true,
      generatedAt: nowIso(),
      createdCount: created.length,
      actions: created
    };
  }

  updateAiMarketingActionStatus(actionId, payload = {}, session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      throw new Error("Marketing Autopilot disponibile solo con piano Gold");
    }
    const allowed = new Set(["to_approve", "approved", "copied", "done", "archived", "discarded"]);
    const status = String(payload.status || "").toLowerCase();
    if (!allowed.has(status)) {
      throw new Error("Stato azione non valido");
    }
    if (String(actionId || "").startsWith("gold-action-")) {
      const clientId = String(actionId || "").replace(/^gold-action-/, "");
      const state = this.getGoldState(session);
      const action = (state.marketingActions?.actions || []).find((item) => String(item.clientId || "") === clientId);
      if (!action) throw new Error("Azione Gold non trovata");
      const now = nowIso();
      const created = this.aiMarketingActionsRepository.create({
        id: makeId("aimkt"),
        centerId: this.getCenterId(session),
        centerName: this.getCenterName(session),
        clientId,
        clientName: action.clientName || action.name || "Cliente",
        type: "recall",
        status,
        priority: action.priority || "media",
        risk: action.risk || "basso",
        pattern: action.pattern || "",
        operatingDecision: action.operatingDecision || "",
        clearReason: action.clearReason || "",
        safeAction: action.safeAction || "",
        upsellAction: action.upsellAction || "",
        conclusion: action.conclusion || "",
        segment: action.segment || "",
        reason: action.reason || action.motive || "Azione marketing generata da AI Gold.",
        urgencyReason: action.urgencyReason || "",
        recommendedAction: action.recommendedAction || "",
        estimatedValueCents: Number(action.estimatedValueCents || 0),
        referenceValueCents: Number(action.referenceValueCents || action.estimatedValueCents || 0),
        valueSource: action.valueSource || "",
        valueLabel: action.valueLabel || "",
        lossIfIgnoredCents: Number(action.lossIfIgnoredCents || 0),
        suggestedMessage: action.suggestedMessage || action.message || "",
        source: "gold_decision_engine",
        aiProvider: "gold_engine",
        generatedAt: action.generatedAt || now,
        updatedAt: now,
        completedAt: status === "done" ? now : "",
        archivedAt: ["archived", "discarded"].includes(status) ? now : "",
        approvedAt: status === "approved" ? now : "",
        copiedAt: status === "copied" ? now : ""
      });
      this.invalidateBusinessSnapshot(this.getCenterId(session), [ANALYTICS_BLOCKS.MARKETING_RECALL, ANALYTICS_BLOCKS.GOLD_STATE]);
      return created;
    }
    const updated = this.updateInCenter(this.aiMarketingActionsRepository, actionId, (current) => ({
      ...current,
      status: status === "discarded" ? "archived" : status,
      updatedAt: nowIso(),
      approvedAt: status === "approved" ? nowIso() : current.approvedAt || "",
      copiedAt: status === "copied" ? nowIso() : current.copiedAt || "",
      completedAt: status === "done" ? nowIso() : current.completedAt || "",
      archivedAt: ["archived", "discarded"].includes(status) ? nowIso() : current.archivedAt || ""
    }), session);
    return updated;
  }

  updateAiMarketingActionDrafts(enhancements = [], session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      return [];
    }
    const byId = new Map(enhancements.map((item) => [String(item.id || ""), item]));
    const updated = [];
    this.filterByCenter(this.aiMarketingActionsRepository.list(), session).forEach((action) => {
      const enhancement = byId.get(String(action.id || ""));
      if (!enhancement) return;
      const next = this.updateInCenter(this.aiMarketingActionsRepository, action.id, (current) => ({
        ...current,
        reason: String(enhancement.reason || current.reason || ""),
        suggestedMessage: String(enhancement.suggestedMessage || current.suggestedMessage || ""),
        aiProvider: String(enhancement.aiProvider || "openai"),
        updatedAt: nowIso()
      }), session);
      updated.push(next);
    });
    return updated;
  }

  getGoldWhatsappStatus(session = null, whatsappService = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      return {
        goldEnabled: false,
        enabled: false,
        fallback: "copy",
        message: "WhatsApp API disponibile solo con piano Gold."
      };
    }
    const messages = this.filterByCenter(this.whatsappMessagesRepository.list(), session)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
      .slice(0, 50);
    return {
      goldEnabled: true,
      enabled: Boolean(whatsappService?.isConfigured?.()),
      fallback: whatsappService?.isConfigured?.() ? "" : "copy",
      costPerMessageEur: GOLD_WHATSAPP_MESSAGE_COST_EUR,
      templates: ["recupero_soft", "recupero_attivo", "mantenimento", "riattivazione_cliente_perso", "reminder_appuntamento"],
      messages
    };
  }

  getGoldWhatsappContext(clientId, session = null) {
    const normalizedClientId = String(clientId || "");
    const client = this.findByIdInCenter(this.clientsRepository, normalizedClientId, session);
    const snapshot = this.getBusinessSnapshot({}, session);
    const suggestions = [
      ...(snapshot.marketing?.suggestions || []),
      ...(snapshot.marketing?.lostClients || []),
      ...(snapshot.marketing?.historicInactiveClients || [])
    ];
    const suggestion = suggestions.find((item) => String(item.clientId || "") === normalizedClientId) || null;
    const goldItem = (snapshot.goldEngine?.marketing?.items || [])
      .find((item) => String(item.entityId || "") === normalizedClientId) || null;
    return { client, snapshot, suggestion, goldItem };
  }

  getGoldWhatsappTemplate(suggestion = {}) {
    const contactClass = String(suggestion.contactClass || suggestion.timingClass || suggestion.segment || "").toLowerCase();
    if (contactClass.includes("perso") || contactClass.includes("storico")) {
      return {
        key: "riattivazione_cliente_perso",
        label: "Riattivazione cliente perso",
        type: "riattivazione"
      };
    }
    if (contactClass.includes("recupero_attivo")) {
      return { key: "recupero_attivo", label: "Recupero attivo", type: "recupero" };
    }
    if (contactClass.includes("recupero_soft")) {
      return { key: "recupero_soft", label: "Recupero soft", type: "recupero" };
    }
    if (contactClass.includes("mantenimento")) {
      return { key: "mantenimento", label: "Mantenimento", type: "mantenimento" };
    }
    return { key: "reminder_appuntamento", label: "Reminder appuntamento", type: "reminder" };
  }

  buildGoldWhatsappMessage(client = {}, suggestion = {}, overrideMessage = "") {
    const text = cleanText(overrideMessage || suggestion.message || "", "", 1200);
    if (text) return text;
    const firstName = cleanText(client.firstName || suggestion.name || client.name || "Cliente", "Cliente", 80).split(/\s+/)[0] || "Cliente";
    const service = cleanText(suggestion.lastServiceName || "il tuo percorso", "il tuo percorso", 120);
    const proposal = cleanText(suggestion.recommendedAction || "ti propongo uno slot comodo questa settimana", "ti propongo uno slot comodo questa settimana", 180);
    const template = this.getGoldWhatsappTemplate(suggestion);
    if (template.key === "riattivazione_cliente_perso") {
      return `Ciao ${firstName}, se vuoi riprendere da dove avevamo lasciato, possiamo capire insieme cosa fare ora. ${proposal}`;
    }
    if (template.key === "recupero_attivo") {
      return `Ciao ${firstName}, il timing è già avanzato per ${service}. Vuoi che ti proponga uno slot per riprendere il percorso?`;
    }
    if (template.key === "recupero_soft") {
      return `Ciao ${firstName}, siamo nel momento giusto per mantenere ${service}. Vuoi che ti proponga uno slot questa settimana?`;
    }
    if (template.key === "mantenimento") {
      return `Ciao ${firstName}, ti consiglio un controllo per mantenere bene ${service}. Vuoi che guardiamo insieme uno slot comodo?`;
    }
    return `Ciao ${firstName}, ti ricordiamo il tuo appuntamento. Se hai bisogno di modifiche, rispondi pure a questo messaggio.`;
  }

  buildGoldWhatsappTemplateVariables(client = {}, suggestion = {}) {
    const name = cleanText(client.firstName || suggestion.name || client.name || "Cliente", "Cliente", 80).split(/\s+/)[0] || "Cliente";
    const service = cleanText(suggestion.lastServiceName || "il tuo percorso", "il tuo percorso", 120);
    const time = suggestion.daysOutOfRoutine !== undefined && suggestion.daysOutOfRoutine !== null
      ? `${Math.max(0, Number(suggestion.daysOutOfRoutine || 0))} giorni fuori routine`
      : suggestion.daysSinceLastVisit
        ? `${Number(suggestion.daysSinceLastVisit || 0)} giorni dall'ultimo appuntamento`
        : "nel momento giusto";
    const proposal = cleanText(suggestion.recommendedAction || "ti propongo uno slot questa settimana", "ti propongo uno slot questa settimana", 180);
    return {
      "1": name,
      "2": service,
      "3": time,
      "4": proposal,
      nome_cliente: name,
      servizio: service,
      tempo: time,
      proposta: proposal
    };
  }

  evaluateGoldWhatsappEligibility(clientId, payload = {}, session = null) {
    if (!this.hasGoldIntelligence(session)) {
      return {
        allowed: false,
        fallback: "copy",
        reason: "plan_locked",
        message: "WhatsApp API disponibile solo con piano Gold."
      };
    }
    const { client, suggestion, goldItem } = this.getGoldWhatsappContext(clientId, session);
    if (!client) {
      return { allowed: false, fallback: "copy", reason: "client_not_found", message: "Cliente non trovato." };
    }
    const phone = cleanPhone(client.phone || suggestion?.phone || "");
    const message = this.buildGoldWhatsappMessage(client, suggestion || {}, payload.message || "");
    const template = this.getGoldWhatsappTemplate(suggestion || {});
    const templateVariables = this.buildGoldWhatsappTemplateVariables(client, suggestion || {});
    const friction = normalizeScore(goldItem?.factors?.friction ?? suggestion?.newDecision?.fS ?? suggestion?.goldDecision?.axes?.friction ?? 0);
    const confidence = normalizeScore(goldItem?.confidenceTemporal ?? goldItem?.confidence ?? suggestion?.responseProbability ?? 0);
    const action = String(goldItem?.action || (suggestion?.shouldContact ? "SUGGEST" : "MONITOR"));
    const daysSinceLastMarketingContact = suggestion?.daysSinceLastMarketingContact ?? null;
    const activeStatuses = new Set(["sent", "delivered", "read", "approved", "queued"]);
    const centerMessages = this.filterByCenter(this.whatsappMessagesRepository.list(), session)
      .filter((item) => String(item.clientId || "") === String(client.id || ""));
    const activeMessage = centerMessages.find((item) => activeStatuses.has(String(item.status || "")));
    const attempts = centerMessages.filter((item) => !["failed", "fallback_copy"].includes(String(item.status || ""))).length;
    const blocks = [];
    if (!phone || phone.length < 7) blocks.push({ reason: "invalid_phone", message: "Numero cliente non valido." });
    if (!client.marketingConsent && !suggestion?.hasMarketingConsent) blocks.push({ reason: "missing_consent", message: "Consenso marketing non presente." });
    if (!["ACT_NOW", "SUGGEST"].includes(action)) blocks.push({ reason: "decision_not_actionable", message: "Decision Matrix non autorizza un invio ora." });
    if (confidence < 0.5) blocks.push({ reason: "low_confidence", message: "Confidence sotto soglia: usare copia manuale o verificare." });
    if (friction > 0.6) blocks.push({ reason: "high_friction", message: "Frizione alta: evitare invio diretto." });
    if (daysSinceLastMarketingContact !== null && Number(daysSinceLastMarketingContact) < 3) {
      blocks.push({ reason: "too_recent", message: "Cliente contattato da meno di 3 giorni." });
    }
    if (activeMessage) blocks.push({ reason: "active_message", message: "Esiste già un messaggio WhatsApp attivo per questo cliente." });
    if (attempts >= 2) blocks.push({ reason: "attempts_limit", message: "Dopo 2 tentativi il contatto va fermato." });
    return {
      allowed: blocks.length === 0,
      fallback: blocks.length ? "copy" : "",
      reason: blocks[0]?.reason || "",
      message: blocks[0]?.message || "Invio WhatsApp approvabile.",
      blocks,
      client,
      suggestion,
      goldItem,
      template,
      templateVariables,
      whatsapp: {
        phone,
        message,
        costEur: GOLD_WHATSAPP_MESSAGE_COST_EUR,
        action,
        confidence,
        friction,
        EV: Number(goldItem?.expectedValue ?? suggestion?.economicScore ?? 0),
        RAP: Number(goldItem?.riskAdjustedPriority2 ?? goldItem?.riskAdjustedPriority ?? suggestion?.goldDecision?.score ?? 0)
      }
    };
  }

  previewGoldWhatsappAction(payload = {}, session = null, whatsappService = null) {
    this.assertCanOperate(session);
    const result = this.evaluateGoldWhatsappEligibility(payload.clientId, payload, session);
    if (!result.client) return result;
    return {
      goldEnabled: this.hasGoldIntelligence(session),
      apiConfigured: Boolean(whatsappService?.isConfigured?.()),
      allowed: result.allowed,
      fallback: result.fallback || (whatsappService?.isConfigured?.() ? "" : "copy"),
      reason: result.reason,
      blockMessage: result.message,
      cliente: {
        id: result.client.id,
        name: result.suggestion?.name || result.client.name || `${result.client.firstName || ""} ${result.client.lastName || ""}`.trim(),
        phone: result.whatsapp.phone
      },
      messaggio: result.whatsapp.message,
      template: result.template,
      templateVariables: result.templateVariables,
      stato: result.allowed ? "ready" : "blocked",
      EV: result.whatsapp.EV,
      RAP: result.whatsapp.RAP,
      costo: GOLD_WHATSAPP_MESSAGE_COST_EUR,
      risposta: "",
      conversione: false
    };
  }

  upsertWhatsappMarketingAction(context = {}, status = "copied", session = null) {
    const client = context.client || {};
    const suggestion = context.suggestion || {};
    const centerId = this.getCenterId(session);
    const existing = this.filterByCenter(this.aiMarketingActionsRepository.list(), session)
      .find((item) => String(item.clientId || "") === String(client.id || "") && !["done", "archived"].includes(String(item.status || "")));
    const now = nowIso();
    if (existing) {
      const updated = this.aiMarketingActionsRepository.update(existing.id, (current) => ({
        ...current,
        status,
        updatedAt: now,
        copiedAt: status === "copied" ? now : current.copiedAt || "",
        approvedAt: current.approvedAt || now
      }));
      this.invalidateBusinessSnapshot(centerId, [ANALYTICS_BLOCKS.MARKETING_RECALL, ANALYTICS_BLOCKS.GOLD_STATE]);
      return updated;
    }
    const created = this.aiMarketingActionsRepository.create({
      id: makeId("aimkt"),
      centerId,
      centerName: this.getCenterName(session),
      clientId: String(client.id || ""),
      clientName: suggestion.name || client.name || `${client.firstName || ""} ${client.lastName || ""}`.trim() || "Cliente",
      type: "recall",
      status,
      priority: suggestion.priority || "media",
      risk: suggestion.risk || "medio",
      reason: suggestion.motive || "Invio WhatsApp approvato da Marketing Gold.",
      recommendedAction: suggestion.recommendedAction || "",
      estimatedValueCents: Number(suggestion.estimatedRecallValueCents || 0),
      referenceValueCents: Number(suggestion.referenceValueCents || suggestion.estimatedRecallValueCents || 0),
      suggestedMessage: context.message || suggestion.message || "",
      source: "whatsapp_gold",
      aiProvider: "gold_engine",
      generatedAt: now,
      updatedAt: now,
      completedAt: "",
      archivedAt: "",
      approvedAt: now,
      copiedAt: status === "copied" ? now : ""
    });
    this.invalidateBusinessSnapshot(centerId, [ANALYTICS_BLOCKS.MARKETING_RECALL, ANALYTICS_BLOCKS.GOLD_STATE]);
    return created;
  }

  async sendGoldWhatsappAction(payload = {}, session = null, whatsappService = null) {
    this.assertCanOperate(session);
    const eligibility = this.evaluateGoldWhatsappEligibility(payload.clientId, payload, session);
    const preview = this.previewGoldWhatsappAction(payload, session, whatsappService);
    if (!eligibility.client) return preview;
    const baseRecord = {
      id: makeId("wapp"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      clientId: String(eligibility.client.id || ""),
      clientName: preview.cliente.name,
      phone: eligibility.whatsapp.phone,
      template: eligibility.template.key,
      templateLabel: eligibility.template.label,
      templateVariables: eligibility.templateVariables,
      type: eligibility.template.type,
      message: eligibility.whatsapp.message,
      status: "approved",
      provider: "twilio_whatsapp",
      messageId: "",
      costEur: GOLD_WHATSAPP_MESSAGE_COST_EUR,
      EV: eligibility.whatsapp.EV,
      RAP: eligibility.whatsapp.RAP,
      confidence: eligibility.whatsapp.confidence,
      friction: eligibility.whatsapp.friction,
      response: "",
      conversion: false,
      error: "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    if (!eligibility.allowed) {
      const record = this.whatsappMessagesRepository.create({
        ...baseRecord,
        status: "fallback_copy",
        error: eligibility.message
      });
      return {
        ...preview,
        sent: false,
        fallback: "copy",
        stato: record.status,
        record,
        message: eligibility.message
      };
    }
    const sendResult = await whatsappService?.sendMessage?.({
      to: eligibility.whatsapp.phone,
      body: eligibility.whatsapp.message,
      templateKey: eligibility.template.key,
      contentVariables: eligibility.templateVariables
    });
    if (!sendResult?.ok) {
      const record = this.whatsappMessagesRepository.create({
        ...baseRecord,
        status: "fallback_copy",
        error: sendResult?.message || "WhatsApp API non disponibile."
      });
      return {
        ...preview,
        sent: false,
        fallback: "copy",
        stato: record.status,
        record,
        message: sendResult?.message || "WhatsApp API non disponibile: usa copia messaggio."
      };
    }
    const action = this.upsertWhatsappMarketingAction({
      client: eligibility.client,
      suggestion: eligibility.suggestion,
      message: eligibility.whatsapp.message
    }, "copied", session);
    const record = this.whatsappMessagesRepository.create({
      ...baseRecord,
      status: sendResult.status || "sent",
      messageId: sendResult.messageId || "",
      linkedActionId: action?.id || "",
      twilioRaw: sendResult.raw || null
    });
    return {
      ...preview,
      sent: true,
      fallback: "",
      stato: record.status,
      record,
      message: "Messaggio WhatsApp inviato."
    };
  }

  async sendGoldWhatsappBulk(payload = {}, session = null, whatsappService = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      throw new Error("WhatsApp Gold disponibile solo con piano Gold");
    }
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 5) : [];
    const results = [];
    for (const item of items) {
      results.push(await this.sendGoldWhatsappAction(item, session, whatsappService));
    }
    return {
      success: true,
      sequential: true,
      requested: items.length,
      sent: results.filter((item) => item.sent).length,
      fallback: results.filter((item) => item.fallback === "copy").length,
      estimatedCostEur: Number((results.filter((item) => item.sent).length * GOLD_WHATSAPP_MESSAGE_COST_EUR).toFixed(2)),
      results
    };
  }

  handleWhatsappWebhook(payload = {}, whatsappService = null) {
    const messageId = String(payload.MessageSid || payload.SmsSid || payload.SmsMessageSid || "");
    const status = whatsappService?.mapStatus?.(payload.MessageStatus || payload.SmsStatus || (payload.Body ? "received" : "")) || "";
    const from = cleanPhone(String(payload.From || "").replace(/^whatsapp:/, ""));
    const now = nowIso();
    const rows = this.whatsappMessagesRepository.list();
    let target = messageId
      ? rows.find((item) => String(item.messageId || "") === messageId)
      : null;
    if (!target && from) {
      target = rows.find((item) => cleanPhone(item.phone || "") === from && ["sent", "delivered", "read"].includes(String(item.status || "")));
    }
    if (!target) {
      return { success: true, matched: false, status };
    }
    const updated = this.whatsappMessagesRepository.update(target.id, (current) => ({
      ...current,
      status: status || current.status || "sent",
      response: payload.Body ? String(payload.Body || "").slice(0, 1000) : current.response || "",
      repliedAt: payload.Body ? now : current.repliedAt || "",
      deliveredAt: status === "delivered" ? now : current.deliveredAt || "",
      readAt: status === "read" ? now : current.readAt || "",
      failedAt: status === "failed" ? now : current.failedAt || "",
      error: status === "failed" ? String(payload.ErrorMessage || payload.ErrorCode || current.error || "") : current.error || "",
      updatedAt: now,
      webhookRaw: payload
    }));
    if (updated && status === "replied") {
      this.goldActionOutcomesRepository.create({
        id: crypto.randomUUID(),
        centerId: updated.centerId,
        createdAt: now,
        domain: "marketing",
        entityId: String(updated.clientId || ""),
        action: "SUGGEST",
        outcome: "replied",
        success: true,
        valueCents: 0,
        note: "Risposta WhatsApp registrata via webhook Twilio."
      });
    }
    return { success: true, matched: true, status: updated?.status || status, record: updated };
  }

  getGoldDecisionHistoryKey(item = {}) {
    return `${String(item.domain || "unknown")}:${String(item.entityId || "unknown")}`;
  }

  getGoldDecisionHistoryMap(session = null) {
    const rows = this.filterByCenter(this.goldDecisionHistoryRepository.list(), session);
    const map = new Map();
    rows.forEach((row) => {
      const key = String(row.historyKey || "");
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    map.forEach((items) => {
      items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    });
    return map;
  }

  compactGoldDecisionHistoryItem(item = {}, session = null, timestamp = nowIso()) {
    const historyKey = this.getGoldDecisionHistoryKey(item);
    return {
      id: `${historyKey}:${timestamp}`,
      centerId: this.getCenterId(session),
      historyKey,
      timestamp,
      domain: String(item.domain || ""),
      entityId: String(item.entityId || ""),
      phi: Number(item.phi || 0),
      confidence: Number(item.confidence || 0),
      confidenceTemporal: Number(item.confidenceTemporal ?? item.confidence ?? 0),
      expectedValue: Number(item.expectedValue || 0),
      opportunityCost: Number(item.opportunityCost || 0),
      netExpectedUtility: Number(item.netExpectedUtility || 0),
      enterpriseRisk: Number(item.enterpriseRisk ?? item.risk ?? 0),
      riskAdjustedPriority2: Number(item.riskAdjustedPriority2 ?? item.riskAdjustedPriorityTrend ?? item.riskAdjustedPriority ?? 0),
      primaryAction: String(item.primaryAction || ""),
      riskAdjustedPriority: Number(item.riskAdjustedPriority || 0),
      riskAdjustedPriorityTrend: Number(item.riskAdjustedPriorityTrend ?? item.riskAdjustedPriority ?? 0),
      need: Number(item.factors?.need || 0),
      value: Number(item.factors?.value || 0),
      urgency: Number(item.factors?.urgency || 0),
      coherence: Number(item.factors?.coherence || 0),
      friction: Number(item.factors?.friction || 0),
      dataQuality: Number(item.factors?.dataQuality || 0),
      band: String(item.band || ""),
      action: String(item.action || ""),
      tone: String(item.tone || ""),
      penaltyApplied: Boolean(item.penaltyApplied),
      explanationShort: String(item.explanationShort || item.output || "").slice(0, 240)
    };
  }

  getGoldLearningStatsMap(session = null) {
    const rows = this.filterByCenter(this.goldActionOutcomesRepository.list(), session);
    const map = new Map();
    rows.forEach((row) => {
      const key = `${String(row.domain || "unknown")}:${String(row.action || "unknown")}`;
      const current = map.get(key) || { attempts: 0, successes: 0, failures: 0 };
      current.attempts += 1;
      if (row.success === true || ["success", "completed", "booked", "resolved"].includes(String(row.outcome || ""))) {
        current.successes += 1;
      } else {
        current.failures += 1;
      }
      map.set(key, current);
    });
    return map;
  }

  getGoldLearningStatsForItem(item = {}, learningMap = new Map()) {
    const domain = String(item.domain || "unknown");
    const action = String(item.action || "unknown");
    return learningMap.get(`${domain}:${action}`) || { attempts: 0, successes: 0, failures: 0 };
  }

  recordGoldActionOutcome(payload = {}, session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      throw new Error("Outcome Gold disponibile solo con piano Gold");
    }
    const row = {
      id: crypto.randomUUID(),
      centerId: this.getCenterId(session),
      createdAt: nowIso(),
      domain: String(payload.domain || ""),
      entityId: String(payload.entityId || ""),
      action: String(payload.action || ""),
      outcome: String(payload.outcome || ""),
      success: Boolean(payload.success),
      valueCents: Number(payload.valueCents || 0),
      note: String(payload.note || "").slice(0, 500)
    };
    this.goldActionOutcomesRepository.create(row);
    return row;
  }

  trendLabelFromMetrics({ deltaRAP = 0, accelerationRAP = 0, volatilityRAP = 0, snapshots = 0 }) {
    if (snapshots <= 1) return "recent_unconfirmed";
    if (volatilityRAP >= 0.18) return "noisy";
    if (deltaRAP > GOLD_TEMPORAL_EPSILON && accelerationRAP > GOLD_TEMPORAL_EPSILON) return "rising_fast";
    if (deltaRAP > GOLD_TEMPORAL_EPSILON) return "rising";
    if (deltaRAP < -GOLD_TEMPORAL_EPSILON && accelerationRAP < -GOLD_TEMPORAL_EPSILON) return "falling_fast";
    if (deltaRAP < -GOLD_TEMPORAL_EPSILON) return "falling";
    return "stable";
  }

  trendExplanation(label) {
    switch (label) {
      case "rising_fast":
        return "Priorità in crescita accelerata rispetto agli ultimi rilevamenti.";
      case "rising":
        return "Priorità in crescita rispetto all'ultimo rilevamento.";
      case "falling_fast":
        return "Pressione in forte calo: evitare di promuovere come urgenza massima.";
      case "falling":
        return "Pressione in calo: monitorare senza forzare.";
      case "noisy":
        return "Segnale alto ma instabile: trattare con prudenza.";
      case "recent_unconfirmed":
        return "Segnale recente, non ancora consolidato nello storico.";
      case "stable":
      default:
        return "Segnale stabile negli ultimi snapshot.";
    }
  }

  applyGoldTemporalLayerToItems(items = [], historyMap = new Map()) {
    return (Array.isArray(items) ? items : []).map((item) => {
      const historyKey = this.getGoldDecisionHistoryKey(item);
      const history = historyMap.get(historyKey) || [];
      const previous = history[0] || null;
      const previous2 = history[1] || null;
      const phi = Number(item.phi || 0);
      const rap = Number(item.riskAdjustedPriority || 0);
      const confidence = Number(item.confidence || 0);
      const prevPhi = Number(previous?.phi ?? phi);
      const prevRap = Number(previous?.riskAdjustedPriorityTrend ?? previous?.riskAdjustedPriority ?? rap);
      const prevConfidence = Number(previous?.confidence ?? confidence);
      const prev2Phi = Number(previous2?.phi ?? prevPhi);
      const prev2Rap = Number(previous2?.riskAdjustedPriorityTrend ?? previous2?.riskAdjustedPriority ?? prevRap);
      const deltaPhiRaw = previous ? phi - prevPhi : 0;
      const deltaRAPRaw = previous ? rap - prevRap : 0;
      const prevDeltaPhi = previous && previous2 ? prevPhi - prev2Phi : 0;
      const prevDeltaRAP = previous && previous2 ? prevRap - prev2Rap : 0;
      const accelerationPhiRaw = deltaPhiRaw - prevDeltaPhi;
      const accelerationRAPRaw = deltaRAPRaw - prevDeltaRAP;
      const phiSeries = [phi, ...history.slice(0, 4).map((row) => Number(row.phi || 0))];
      const rapSeries = [rap, ...history.slice(0, 4).map((row) => Number(row.riskAdjustedPriorityTrend ?? row.riskAdjustedPriority ?? 0))];
      const volatilityPhi = normalizeScore(stddev(phiSeries));
      const volatilityRAP = normalizeScore(stddev(rapSeries));
      const confidenceTemporal = normalizeScore(confidence * (1 - (GOLD_TEMPORAL_CONFIDENCE_NU * volatilityRAP)));
      const trendBase = normalizeScore(rap + (GOLD_TREND_MU1 * deltaRAPRaw) + (GOLD_TREND_MU2 * accelerationRAPRaw));
      const riskAdjustedPriorityTrend = normalizeScore(trendBase * (1 - (0.5 * volatilityRAP)));
      const trendLabel = this.trendLabelFromMetrics({
        deltaRAP: deltaRAPRaw,
        accelerationRAP: accelerationRAPRaw,
        volatilityRAP,
        snapshots: history.length + 1
      });
      const temporalPenalty = volatilityRAP >= 0.18 || confidenceTemporal < 0.4;
      const trendExplanation = this.trendExplanation(trendLabel);
      return {
        ...item,
        confidenceTemporal: Number(confidenceTemporal.toFixed(3)),
        confidenceTemporalPercent: Math.round(confidenceTemporal * 100),
        riskAdjustedPriorityTrend: Number(riskAdjustedPriorityTrend.toFixed(3)),
        riskAdjustedPriorityTrendPercent: Math.round(riskAdjustedPriorityTrend * 100),
        temporalMode: "test_parallel",
        temporalVersion: "gold_temporal_v1",
        temporalPenaltyApplied: temporalPenalty,
        trend: {
          deltaPhi: Number((Math.abs(deltaPhiRaw) < GOLD_TEMPORAL_EPSILON ? 0 : deltaPhiRaw).toFixed(3)),
          deltaRAP: Number((Math.abs(deltaRAPRaw) < GOLD_TEMPORAL_EPSILON ? 0 : deltaRAPRaw).toFixed(3)),
          deltaConfidence: Number((Math.abs(confidence - prevConfidence) < GOLD_TEMPORAL_EPSILON ? 0 : confidence - prevConfidence).toFixed(3)),
          accelerationPhi: Number((Math.abs(accelerationPhiRaw) < GOLD_TEMPORAL_EPSILON ? 0 : accelerationPhiRaw).toFixed(3)),
          accelerationRAP: Number((Math.abs(accelerationRAPRaw) < GOLD_TEMPORAL_EPSILON ? 0 : accelerationRAPRaw).toFixed(3)),
          volatilityPhi: Number(volatilityPhi.toFixed(3)),
          volatilityRAP: Number(volatilityRAP.toFixed(3)),
          snapshots: history.length + 1,
          trendLabel
        },
        explanationLong: `${item.explanationLong || item.explanationShort || ""} ${trendExplanation}`.trim()
      };
    });
  }

  applyGoldTemporalLayer(branches = {}, session = null) {
    const historyMap = this.getGoldDecisionHistoryMap(session);
    const nextBranches = {};
    Object.entries(branches || {}).forEach(([key, branch]) => {
      nextBranches[key] = {
        ...branch,
        temporalMode: "test_parallel",
        items: this.applyGoldTemporalLayerToItems(branch?.items || [], historyMap)
      };
    });
    return nextBranches;
  }

  applyGoldEnterpriseLayerToItems(items = [], learningMap = new Map()) {
    return (Array.isArray(items) ? items : []).map((item) => {
      const friction = normalizeScore(item.factors?.friction ?? 0);
      const dataQuality = normalizeScore(item.factors?.dataQuality ?? item.confidence ?? 0);
      const instability = normalizeScore(item.trend?.volatilityRAP ?? 0);
      const risk = normalizeScore(
        (GOLD_ENTERPRISE_RISK_RHO.friction * friction)
        + (GOLD_ENTERPRISE_RISK_RHO.dataGap * (1 - dataQuality))
        + (GOLD_ENTERPRISE_RISK_RHO.instability * instability)
      );
      const confidence = normalizeScore(item.confidenceTemporal ?? item.confidence ?? 0);
      const value = normalizeScore(item.factors?.value ?? 0);
      const need = normalizeScore(item.factors?.need ?? 0);
      const rapTrendAdj = normalizeScore(item.riskAdjustedPriorityTrend ?? item.riskAdjustedPriority ?? 0);
      const riskAdjustedPriority2 = normalizeScore(rapTrendAdj * (1 - risk));
      const stats = this.getGoldLearningStatsForItem(item, learningMap);
      const pSuccessLearned = stats.attempts > 0 ? computeBayesianSuccessRate(stats) : normalizeScore(item.pSuccess ?? confidence * (1 - friction));
      const expectedValue = normalizeScore(confidence * (1 - risk) * value);
      const pLoss = normalizeScore(risk * Math.max(need, 1 - confidence));
      const opportunityCost = normalizeScore(value * pLoss);
      const actionCost = Number(GOLD_ENTERPRISE_ACTION_COST[item.action] ?? 0.03);
      const netExpectedUtility = clampSignedScore(expectedValue - opportunityCost - actionCost);
      const simulation = simulateGoldEnterpriseActions(item, {
        risk,
        pSuccessLearned,
        expectedValue
      });
      return {
        ...item,
        enterpriseLayer: "corelia_enterprise_v1",
        RAP_trend_adj: Number(rapTrendAdj.toFixed(3)),
        risk: Number(risk.toFixed(3)),
        enterpriseRisk: Number(risk.toFixed(3)),
        riskModel: {
          version: "gold_risk_model_v1",
          formula: "R = rho1*F + rho2*(1-Q) + rho3*instability",
          friction: Number(friction.toFixed(3)),
          dataGap: Number((1 - dataQuality).toFixed(3)),
          instability: Number(instability.toFixed(3)),
          rho: GOLD_ENTERPRISE_RISK_RHO,
          value: Number(risk.toFixed(3))
        },
        riskAdjustedPriority2: Number(riskAdjustedPriority2.toFixed(3)),
        riskAdjustedPriority2Percent: Math.round(riskAdjustedPriority2 * 100),
        expectedValue: Number(expectedValue.toFixed(3)),
        expectedValuePercent: Math.round(expectedValue * 100),
        opportunityCost: Number(opportunityCost.toFixed(3)),
        opportunityCostPercent: Math.round(opportunityCost * 100),
        netExpectedUtility: Number(netExpectedUtility.toFixed(3)),
        pSuccessLearned: Number(pSuccessLearned.toFixed(3)),
        learning: {
          version: "gold_learning_v1",
          method: "bayesian_update",
          attempts: stats.attempts,
          successes: stats.successes,
          failures: stats.failures,
          pSuccess: Number(pSuccessLearned.toFixed(3))
        },
        simulation,
        simulatedBestAction: simulation.bestAction,
        primaryAction: simulation.bestAction
      };
    });
  }

  applyGoldEnterpriseLayer(branches = {}, session = null) {
    const learningMap = this.getGoldLearningStatsMap(session);
    const nextBranches = {};
    Object.entries(branches || {}).forEach(([key, branch]) => {
      nextBranches[key] = {
        ...branch,
        enterpriseLayer: "corelia_enterprise_v1",
        items: this.applyGoldEnterpriseLayerToItems(branch?.items || [], learningMap)
      };
    });
    return nextBranches;
  }

  persistGoldDecisionHistory(branches = {}, session = null, timestamp = nowIso()) {
    const centerId = this.getCenterId(session);
    const incoming = Object.values(branches || {}).flatMap((branch) => branch?.items || [])
      .filter((item) => item?.domain && item?.entityId)
      .map((item) => this.compactGoldDecisionHistoryItem(item, session, timestamp));
    if (!incoming.length) return { saved: 0, retained: 0 };
    const existing = this.goldDecisionHistoryRepository.list()
      .filter((row) => String(row.centerId || "") !== centerId);
    const grouped = new Map();
    incoming.forEach((row) => {
      if (!grouped.has(row.historyKey)) grouped.set(row.historyKey, []);
      grouped.get(row.historyKey).push(row);
    });
    this.filterByCenter(this.goldDecisionHistoryRepository.list(), session).forEach((row) => {
      const key = String(row.historyKey || "");
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    const retained = [];
    grouped.forEach((rows) => {
      rows.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      retained.push(...rows.slice(0, GOLD_DECISION_HISTORY_LIMIT));
    });
    this.goldDecisionHistoryRepository.write([...existing, ...retained]);
    return { saved: incoming.length, retained: retained.length };
  }

  getAiGoldMarketingSnapshot(session = null) {
    this.assertCanOperate(session);
    if (!this.hasGoldIntelligence(session)) {
      return {
        goldEnabled: false,
        message: "AI Gold Marketing disponibile solo con piano Gold.",
        suggestions: []
      };
    }
    const state = this.getGoldState(session);
    const marketingActions = state.marketingActions || this.buildGoldMarketingActionState(session);
    const progressiveIntelligence = this.getProgressiveIntelligenceStatus(session);
    const marketingFeature = this.getFeatureActivation(progressiveIntelligence, "intelligent_marketing");
    const recallFeature = this.getFeatureActivation(progressiveIntelligence, "recall");
    const marketing = {
      goldEnabled: true,
      generatedAt: marketingActions.generatedAt || state.updatedAt || nowIso(),
      suggestions: marketingActions.actions || [],
      actions: marketingActions.actions || [],
      priorityClients: marketingActions.actions || [],
      lostClients: [],
      historicInactiveClients: [],
      counts: {
        priority: marketingActions.counters?.totalActions || 0,
        lost: 0,
        historic: 0,
        avoid: marketingActions.debug?.excludedByFilter || 0,
        waiting: marketingActions.counters?.toApprove || 0
      },
      kpis: {
        contactsMade: 0,
        responseRate: 0,
        bookingRate: 0,
        revenueRecoveryCents: 0,
        potentialRecoveryScore: (marketingActions.actions || []).reduce((sum, item) => sum + Number(item.goldDecision?.score || 0), 0),
        recommendedToday: marketingActions.counters?.totalActions || 0,
        avoidToday: marketingActions.debug?.excludedByFilter || 0,
        waiting: marketingActions.counters?.toApprove || 0,
        opportunitiesActive: marketingActions.counters?.approvedActions || 0,
        callableApproved: marketingActions.counters?.callableApproved || 0,
        clientsAtRiskToday: marketingActions.counters?.clientsAtRiskToday || 0
      },
      debug: marketingActions.debug || {},
      counters: marketingActions.counters || {},
      semantics: marketingActions.semantics || {},
      sourceLayer: "gold_state",
      sourceEndpoint: "/api/ai-gold/state"
    };
    return {
      ...marketing,
      message: (marketingActions.actions || []).length
        ? ""
        : "Marketing prudente: nessun contatto promosso oggi con le regole attuali.",
      summary: {
        totalActions: marketingActions.counters?.totalActions || 0,
        toApprove: marketingActions.counters?.toApprove || 0,
        approved: marketingActions.counters?.approvedActions || 0,
        excludedByFilter: marketingActions.debug?.excludedByFilter || 0,
        status: (marketingActions.actions || []).length ? "azioni_pronte" : "nessun_contatto_promosso"
      },
      progressiveIntelligence,
      activation: {
        recallEnabled: recallFeature.enabled,
        intelligentMarketingEnabled: marketingFeature.enabled,
        blockedReason: marketingFeature.enabled ? "" : marketingFeature.reason,
        rule: "PIAL abilita marketing avanzato solo con storico, CRM, volume e affidabilità sufficienti."
      }
    };
  }

  getGoldCapabilities(session = null) {
    this.assertCanOperate(session);
    const plan = this.getPlanLevel(session);
    const goldEnabled = plan === "gold";
    const settings = this.getSettings(session);
    const whatsappEnabled = goldEnabled && String(settings.whatsappGoldMode || "") === "active";
    const progressiveIntelligence = goldEnabled ? this.getProgressiveIntelligenceStatus(session) : null;
    const hasFeature = (key) => Boolean(progressiveIntelligence?.enabledFeatures?.some((item) => item.key === key));
    return {
      goldEnabled,
      currentPlan: plan,
      version: "corelia_enterprise_v1",
      goldEngineVersion: "corelia_phi_multi_domain_v1",
      decisionMatrixVersion: "corelia_decision_matrix_v1",
      engineName: "Corelia",
      runtimeStack: ["V0", "V2", "V7"],
      progressiveIntelligence,
      features: {
        hasDecisionMatrix: goldEnabled,
        hasRiskModel: goldEnabled,
        hasEconomicEngine: goldEnabled && hasFeature("margin_analysis"),
        hasSimulation: goldEnabled && hasFeature("forecast_scenarios"),
        hasLearning: goldEnabled && progressiveIntelligence?.activationLevel >= 3,
        hasWhatsAppAPI: whatsappEnabled,
        hasTrendLayer: goldEnabled && progressiveIntelligence?.activationLevel >= 3 && progressiveIntelligence?.qualityVector?.stateStability >= 0.75,
        hasProgressiveActivation: goldEnabled,
        hasForecastScenarios: goldEnabled && hasFeature("forecast_scenarios"),
        hasIntelligentMarketing: goldEnabled && hasFeature("intelligent_marketing")
      },
      limits: {
        whatsappEnabled,
        maxMessagesPerMonth: Number(settings.whatsappMonthlyQuota || 0),
        monthlyUsed: Number(settings.whatsappMonthlyUsed || 0),
        automationAllowed: false
      },
      rules: {
        execution: {
          allowedActions: ["ACT_NOW", "SUGGEST"],
          minConfidence: 0.5,
          maxRisk: 0.6,
          maxFriction: 0.6,
          requiresGold: true,
          requiresOperatorConfirmation: true
        },
        whatsapp: {
          requiresConsent: true,
          requiresValidPhone: true,
          fallback: whatsappEnabled ? "" : "manual_copy"
        },
        progressiveActivation: {
          activationLevel: progressiveIntelligence?.activationLevel ?? 0,
          maturityScore: progressiveIntelligence?.maturityScore ?? 0,
          blockedFeatures: progressiveIntelligence?.blockedFeatures || []
        }
      }
    };
  }

  canExecuteAction(decision = {}, context = {}) {
    const capabilities = context.capabilities || {};
    const plan = String(context.plan || capabilities.currentPlan || "").toLowerCase();
    const action = String(decision.action || decision.primaryAction || "").toUpperCase();
    const confidence = normalizeScore(decision.confidenceTemporal ?? decision.confidence ?? 0);
    const risk = normalizeScore(decision.enterpriseRisk ?? decision.risk ?? 0);
    const friction = normalizeScore(decision.factors?.friction ?? decision.friction ?? 0);
    const blocked = Boolean(decision.blocked || ["STOP", "VERIFY"].includes(action) || decision.band === "stop");
    const progressive = capabilities.progressiveIntelligence || null;
    const decisionDomain = String(decision.domain || "").toLowerCase();
    const requiredFeatureByDomain = {
      marketing: "recall",
      profit: "margin_analysis",
      profitability: "margin_analysis",
      agenda: "daily_priorities_basic",
      cash: "daily_priorities_basic",
      data_quality: "quality_alerts"
    };
    const requiredFeature = requiredFeatureByDomain[decisionDomain] || "";
    const blockedFeature = requiredFeature
      ? (progressive?.blockedFeatures || []).find((item) => item.key === requiredFeature)
      : null;
    const reasons = [];
    if (plan !== "gold") reasons.push("Piano non Gold");
    if (!["ACT_NOW", "SUGGEST"].includes(action)) reasons.push("Azione non eseguibile dal motore Gold");
    if (blocked) reasons.push("Azione bloccata dal Gold Engine");
    if (confidence < 0.5) reasons.push("Confidence sotto soglia");
    if (risk > 0.6) reasons.push("Rischio sopra soglia");
    if (friction > 0.6) reasons.push("Frizione sopra soglia");
    if (blockedFeature) reasons.push(`PIAL: ${blockedFeature.label} bloccato (${blockedFeature.reason})`);
    return {
      allowed: reasons.length === 0,
      reasons,
      action,
      confidence,
      risk,
      friction,
      requiresOperatorConfirmation: true,
      source: "gold_capability_layer"
    };
  }

  compactGoldDecisionForSmart(item = null, context = {}) {
    if (!item) return null;
    const execution = this.canExecuteAction(item, context);
    const priority = Number(item.riskAdjustedPriority2 ?? item.RAP_trend_adj ?? item.riskAdjustedPriorityTrend ?? item.riskAdjustedPriority ?? item.phi ?? 0);
    return {
      domain: item.domain || "",
      entityId: item.entityId || "",
      label: item.label || "",
      action: item.action || "",
      suggestedAction: item.suggestedAction || "",
      output: item.output || item.explanationShort || "",
      explanationShort: item.explanationShort || item.output || "",
      explanationLong: item.explanationLong || "",
      priority,
      RAP_2: Number(item.riskAdjustedPriority2 ?? 0),
      RAP_trend_adj: Number(item.RAP_trend_adj ?? item.riskAdjustedPriorityTrend ?? 0),
      phi: Number(item.phi || 0),
      confidence: Number(item.confidenceTemporal ?? item.confidence ?? 0),
      risk: Number(item.enterpriseRisk ?? item.risk ?? 0),
      EV: Number(item.expectedValue || 0),
      OC: Number(item.opportunityCost || 0),
      NEU: Number(item.netExpectedUtility || 0),
      trend: item.trend || null,
      band: item.band || "",
      tone: item.tone || "",
      penaltyApplied: Boolean(item.penaltyApplied || item.reliabilityPenaltyApplied || item.temporalPenaltyApplied),
      decisionMatrixVersion: item.decisionMatrixVersion || "",
      goldEngineVersion: item.enterpriseLayer || item.temporalVersion || "",
      canExecute: execution.allowed,
      execution
    };
  }

  getGoldDecisionContext(options = {}, session = null) {
    this.assertCanOperate(session);
    const capabilities = this.getGoldCapabilities(session);
    if (!capabilities.goldEnabled) {
      return {
        goldEnabled: false,
        currentPlan: capabilities.currentPlan,
        primaryAction: null,
        secondaryActions: [],
        blockedActions: [],
        topSignals: [],
        globalConfidence: 0,
        systemRisk: 0,
        lastUpdate: "",
        capabilities
      };
    }
    const snapshot = this.getBusinessSnapshot(options || {}, session);
    const dashboard = snapshot.goldEngine?.dashboard || {};
    const topSignals = (dashboard.items || []).map((item) => this.compactGoldDecisionForSmart(item, {
      plan: "gold",
      capabilities
    })).filter(Boolean);
    const primaryAction = this.compactGoldDecisionForSmart(dashboard.primaryAction || null, {
      plan: "gold",
      capabilities
    });
    const secondaryActions = (dashboard.secondaryActions || []).map((item) => this.compactGoldDecisionForSmart(item, {
      plan: "gold",
      capabilities
    })).filter(Boolean);
    const blockedActions = (dashboard.blockedActions || []).map((item) => this.compactGoldDecisionForSmart(item, {
      plan: "gold",
      capabilities
    })).filter(Boolean);
    const confidenceValues = topSignals.map((item) => Number(item.confidence || 0));
    const riskValues = topSignals.map((item) => Number(item.risk || 0));
    const dataQuality = this.getDataQuality(session, { summaryOnly: true });
    const profitabilityOverview = this.buildProfitabilityOverviewFromGoldState({}, session) || {};
    const anomalies = this.rankGoldDecisionAnomalies({
      dataQuality,
      profitabilityOverview,
      primaryAction,
      topSignals
    });
    const servicesMissingCosts = Number(dataQuality.metrics?.servicesMissingCosts || 0);
    const operatorsMissingHourlyCost = Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0);
    const profitabilityBlockedForConfig = dataQuality.profitabilityReliable === false && (servicesMissingCosts > 0 || operatorsMissingHourlyCost > 0);
    const exposedPrimaryAction = profitabilityBlockedForConfig
      ? {
        ...(primaryAction || {}),
        domain: "profitability",
        entityId: "profitability-config-block",
        label: "Volume presente, completa costi per sbloccare redditivita",
        action: "ACT_NOW",
        suggestedAction: "apri servizi e operatori, poi completa costi e costo orario",
        explanationShort: `Il centro lavora gia, ma la redditivita resta bloccata finche completi ${servicesMissingCosts} costi servizio e ${operatorsMissingHourlyCost} costi orari operatori.`,
        explanationLong: `Non e un giudizio negativo sul centro. Volume, pagamenti e storico sono presenti, ma Gold evita letture economiche forti finche la configurazione economica non e completa. Completa ${servicesMissingCosts} costi servizio e ${operatorsMissingHourlyCost} costi orari operatori per sbloccare redditivita e priorita economiche affidabili.`,
        target: "profitability"
      }
      : primaryAction;
    return {
      goldEnabled: true,
      capabilities,
      progressiveIntelligence: capabilities.progressiveIntelligence,
      primaryAction: exposedPrimaryAction,
      secondaryActions,
      blockedActions,
      topSignals,
      anomalies,
      globalConfidence: confidenceValues.length ? Number(average(confidenceValues).toFixed(3)) : 0,
      systemRisk: riskValues.length ? Number(Math.max(...riskValues).toFixed(3)) : 0,
      lastUpdate: snapshot.generatedAt || nowIso(),
      decisionMatrixVersion: capabilities.decisionMatrixVersion,
      goldEngineVersion: snapshot.goldEngine?.engineVersion || capabilities.goldEngineVersion,
      sourceLayer: "gold_decision_context"
    };
  }

  rankGoldDecisionAnomalies(input = {}) {
    const dataQuality = input.dataQuality || {};
    const profitabilityOverview = input.profitabilityOverview || {};
    const primaryAction = input.primaryAction || null;
    const topSignals = Array.isArray(input.topSignals) ? input.topSignals : [];
    const confidence = Number(primaryAction?.confidence || 0);
    const items = [
      {
        key: "clients_missing_contact",
        area: "crm",
        title: "Clienti senza contatto",
        actionLabel: "Completa telefono o email nelle schede cliente",
        impactScore: normalizeScore((Number(dataQuality.metrics?.clientsMissingContact || 0) / Math.max(1, Number(dataQuality.metrics?.clients || 1))) * 1.2),
        confidence
      },
      {
        key: "services_missing_costs",
        area: "profitability",
        title: "Servizi senza costi configurati",
        actionLabel: "Completa costi e collega prodotti o tecnologie",
        impactScore: normalizeScore((Number(dataQuality.metrics?.servicesMissingCosts || 0) / Math.max(1, Number(dataQuality.metrics?.services || 1))) * 1.2),
        confidence: Number(profitabilityOverview.confidence?.value || 0)
      },
      {
        key: "unlinked_payments",
        area: "cash",
        title: "Pagamenti da collegare",
        actionLabel: "Apri cassa e associa i pagamenti",
        impactScore: normalizeScore(Number(dataQuality.metrics?.unlinkedPayments || 0) / 5),
        confidence: 0.95
      },
      {
        key: "profitability_low_confidence",
        area: "profitability",
        title: "Margine con confidenza bassa",
        actionLabel: "Leggi la redditività solo dopo verifica costi",
        impactScore: normalizeScore(1 - Number(profitabilityOverview.confidence?.value || 0)),
        confidence: Number(profitabilityOverview.confidence?.value || 0)
      }
    ].filter((item) => item.impactScore > 0.05);

    const primaryArea = String(primaryAction?.domain || "");
    items.forEach((item) => {
      if (primaryArea && item.area.includes(primaryArea)) item.impactScore = normalizeScore(item.impactScore + 0.15);
      if (topSignals.some((signal) => String(signal.domain || "") === item.area || String(signal.target || "") === item.area)) {
        item.impactScore = normalizeScore(item.impactScore + 0.1);
      }
      item.impactScore = Number(item.impactScore.toFixed(3));
    });

    return items.sort((a, b) => b.impactScore - a.impactScore).slice(0, 5);
  }

  toGoldDecisionItem(domain, entityId, goldDecision, meta = {}) {
    const control = computeGoldDecisionControlMetrics(goldDecision, {
      dataQuality: meta.dataQuality,
      risk: meta.risk
    });
    const matrix = applyGoldDecisionMatrixV1(goldDecision, control, meta);
    const lowConfidence = matrix.action === "VERIFY" || control.confidence < 0.4;
    const highFrictionStop = matrix.action === "STOP";
    const monitorOnly = matrix.action === "MONITOR";
    const safeOutput = lowConfidence && /buono|opportunit|spingi|forte/i.test(String(meta.output || meta.explanationShort || ""))
      ? "dato da verificare"
      : highFrictionStop && /buono|opportunit|spingi|forte|chiudi ora|agire/i.test(String(meta.output || meta.explanationShort || ""))
        ? "da non forzare ora"
      : meta.output;
    const safeAction = lowConfidence && /spingi|promuovi|contatta|agisci/i.test(String(meta.suggestedAction || goldDecision.suggestedAction || ""))
      ? "verifica prima di agire"
      : highFrictionStop
        ? "non agire direttamente: verifica il dato"
        : monitorOnly && /spingi|promuovi|contatta|agisci|chiudi ora/i.test(String(meta.suggestedAction || goldDecision.suggestedAction || ""))
          ? "monitorare senza azione diretta"
      : meta.suggestedAction || goldDecision.suggestedAction;
    const matrixExplanation = matrix.action === "ACT_NOW"
      ? "Segnale forte, affidabile e con frizione bassa: azione consigliata ora."
      : matrix.action === "SUGGEST"
        ? "Segnale utile: suggerire l'azione mantenendo controllo operativo."
        : matrix.action === "MONITOR"
          ? "Segnale da monitorare: non serve forzare un'azione immediata."
          : matrix.action === "STOP"
            ? "Frizione alta: evitare azioni dirette finché il dato o il caso non è chiarito."
            : "Affidabilità bassa: verificare prima di trasformare il segnale in azione.";
    return {
      domain,
      entityId: String(entityId || `${domain}-${Date.now()}`),
      phi: goldDecision.score,
      phiPercent: goldDecision.scorePercent,
      confidence: control.confidence,
      confidencePercent: control.confidencePercent,
      confidenceBand: control.confidenceBand,
      confidenceLabel: control.confidenceLabel,
      expectedValue: control.expectedValue,
      expectedValuePercent: control.expectedValuePercent,
      pSuccess: control.pSuccess,
      risk: control.risk,
      riskAdjustedPriority: matrix.riskAdjustedPriority,
      riskAdjustedPriorityPercent: matrix.riskAdjustedPriorityPercent,
      action: matrix.action,
      tone: matrix.tone,
      decisionMatrixVersion: matrix.matrixVersion,
      decisionRulesApplied: matrix.rules,
      band: matrix.band,
      bandLabel: matrix.bandLabel,
      legacyBand: goldDecision.priorityBand,
      legacyBandLabel: goldDecision.priorityLabel,
      penaltyApplied: Boolean(meta.penaltyApplied || lowConfidence || highFrictionStop || matrix.rules.length),
      factors: {
        need: goldDecision.axes.need,
        value: goldDecision.axes.value,
        urgency: goldDecision.axes.urgency,
        coherence: goldDecision.axes.coherence,
        friction: goldDecision.axes.friction,
        dataQuality: control.dataQuality
      },
      suggestedAction: safeAction,
      explanationShort: safeOutput || meta.explanationShort || goldDecision.explanation,
      explanationLong: `${meta.explanationLong || goldDecision.explanation} ${matrixExplanation}`.trim(),
      ...meta,
      output: safeOutput,
      suggestedAction: safeAction,
      riskAdjustedPriority: matrix.riskAdjustedPriority,
      riskAdjustedPriorityPercent: matrix.riskAdjustedPriorityPercent,
      action: matrix.action,
      tone: matrix.tone,
      decisionMatrixVersion: matrix.matrixVersion,
      decisionRulesApplied: matrix.rules,
      band: matrix.band,
      bandLabel: matrix.bandLabel,
      legacyBand: goldDecision.priorityBand,
      legacyBandLabel: goldDecision.priorityLabel,
      penaltyApplied: Boolean(meta.penaltyApplied || lowConfidence || highFrictionStop || matrix.rules.length)
    };
  }

  buildGoldAgendaDecisions(context = {}, session = null) {
    const nowMs = Date.now();
    const appointments = Array.isArray(context.appointments) ? context.appointments : [];
    const servicesById = context.servicesById || new Map();
    const maxServicePrice = Math.max(1, ...Array.from(servicesById.values()).map((service) => Number(service.priceCents || 0)));
    const relevant = appointments
      .filter((appointment) => !["cancelled", "no_show"].includes(String(appointment.status || "")))
      .filter((appointment) => {
        const time = new Date(appointment.startAt || appointment.createdAt || 0).getTime();
        if (!Number.isFinite(time)) return false;
        return time >= nowMs - 86400000 && time <= nowMs + (7 * 86400000);
      })
      .slice(0, 120);
    const items = relevant.map((appointment) => {
      const service = servicesById.get(String(appointment.serviceId || "")) || {};
      const startMs = new Date(appointment.startAt || appointment.createdAt || 0).getTime();
      const hoursToStart = Number.isFinite(startMs) ? (startMs - nowMs) / 3600000 : 168;
      const status = String(appointment.status || "");
      const missingClient = !appointment.clientId && !appointment.clientName && !appointment.walkInName;
      const missingService = !appointment.serviceId && !appointment.serviceName && !appointment.service;
      const missingOperator = !appointment.staffId && !appointment.operatorId && !appointment.staffName;
      const incompleteScore = normalizeScore(([missingClient, missingService, missingOperator].filter(Boolean).length) / 3);
      const need = normalizeScore(Math.max(
        status === "requested" || status === "booked" ? 0.85 : 0,
        incompleteScore ? 0.75 + (incompleteScore * 0.25) : 0,
        status === "confirmed" ? 0.35 : 0
      ));
      const hour = Number(String(appointment.startAt || "").slice(11, 13));
      const strategicHour = Number.isFinite(hour) && ((hour >= 10 && hour <= 12) || (hour >= 17 && hour <= 19));
      const value = normalizeScore((Number(service.priceCents || appointment.amountCents || 0) / maxServicePrice) + (strategicHour ? 0.15 : 0));
      const urgency = hoursToStart <= 2 ? 1 : hoursToStart <= 24 ? 0.85 : hoursToStart <= 72 ? 0.55 : 0.25;
      const coherence = normalizeScore((Number(!missingClient) + Number(!missingService) + Number(!missingOperator)) / 3);
      const friction = normalizeScore(Math.max(
        incompleteScore,
        status === "completed" || status === "ready_checkout" ? 0.9 : 0,
        status === "confirmed" && hoursToStart > 24 ? 0.25 : 0
      ));
      const decision = computeGoldDecisionScore("appuntamento", {
        needScore: need,
        valueScore: value,
        urgencyScore: urgency,
        coherenceScore: coherence,
        frictionScore: friction,
        suggestedAction: need >= 0.75
          ? "sistema appuntamento"
          : urgency >= 0.85 && status !== "confirmed"
            ? "conferma appuntamento"
            : "monitora agenda",
        explanation: missingClient || missingService || missingOperator
          ? "Appuntamento con dati incompleti: conviene sistemarlo prima dell'orario."
          : urgency >= 0.85 && status !== "confirmed"
            ? "Appuntamento vicino non ancora pienamente confermato."
          : "Agenda sotto controllo per questo appuntamento."
      });
      const gatedDecision = need < 0.2
        ? {
          ...decision,
          score: Math.min(decision.score, 0.49),
          scorePercent: Math.min(decision.scorePercent, 49),
          priorityBand: "bassa",
          priorityLabel: "Monitorare",
          suggestedAction: "monitorare agenda",
          explanation: "Agenda stabile: nessuna azione operativa necessaria ora."
        }
        : decision;
      const output = need < 0.2
        ? "Agenda stabile, monitorare"
        : gatedDecision.score >= 0.7
        ? "da confermare ora"
        : gatedDecision.score >= 0.5
          ? "appuntamento fragile"
          : gatedDecision.score >= 0.3
            ? "può aspettare"
            : "nessuna azione urgente";
      return this.toGoldDecisionItem("agenda", appointment.id, gatedDecision, {
        label: appointment.clientName || appointment.walkInName || "Appuntamento",
        output,
        status,
        startAt: appointment.startAt || "",
        target: "agenda",
        suggestedAction: need < 0.2 ? "nessuna azione operativa necessaria ora" : output === "da confermare ora" ? "conferma o completa appuntamento" : gatedDecision.suggestedAction,
        explanationShort: output,
        explanationLong: gatedDecision.explanation
      });
    }).sort((a, b) => b.phi - a.phi).slice(0, 10);
    return {
      domain: "agenda",
      engineVersion: "gold_phi_agenda_v1",
      generatedAt: nowIso(),
      items,
      summary: {
        highPriority: items.filter((item) => item.band === "alta").length,
        recommended: items.filter((item) => item.band === "media").length,
        total: items.length,
        status: items.some((item) => item.phi >= 0.7) ? "intervento_ora" : items.some((item) => item.phi >= 0.5) ? "attenzione" : "giornata_equilibrata"
      }
    };
  }

  buildGoldCashDecisions(context = {}, session = null) {
    const payments = Array.isArray(context.payments) ? context.payments : [];
    const unlinkedPayments = this.listUnlinkedPayments(session);
    const maxAmount = Math.max(1, ...payments.map((payment) => Number(payment.amountCents || 0)));
    const items = unlinkedPayments.slice(0, 40).map((payment) => {
      const amount = Number(payment.amountCents || 0);
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(payment.createdAt || nowIso()).getTime()) / 86400000));
      const hasClient = Boolean(payment.clientId);
      const hasAppointment = Boolean(payment.appointmentId);
      const suggestionsCount = Array.isArray(payment.suggestions) ? payment.suggestions.length : 0;
      const need = normalizeScore(!hasClient || !hasAppointment ? 1 : 0.2);
      const value = normalizeScore(amount / maxAmount);
      const urgency = ageDays === 0 ? 0.75 : ageDays <= 3 ? 0.9 : 1;
      const coherence = normalizeScore((Number(hasClient) + Number(hasAppointment) + Number(Boolean(payment.method)) + (suggestionsCount === 1 ? 1 : suggestionsCount > 1 ? 0.6 : 0.2)) / 4);
      const friction = normalizeScore(Math.max(
        !hasClient && !hasAppointment ? 0.85 : 0.45,
        suggestionsCount > 1 ? 0.7 : 0,
        !payment.method ? 0.45 : 0
      ));
      const decision = computeGoldDecisionScore("pagamento", {
        needScore: need,
        valueScore: value,
        urgencyScore: urgency,
        coherenceScore: coherence,
        frictionScore: friction,
        suggestedAction: suggestionsCount === 1 ? "verifica collegamento" : "controlla pagamento",
        explanation: suggestionsCount === 1
          ? "Pagamento collegabile con buona probabilità: verifica e chiudi."
          : suggestionsCount > 1
            ? "Pagamento ambiguo: controlla prima di collegare."
            : "Pagamento non collegato: serve verifica manuale."
      });
      const output = decision.score >= 0.7
        ? "chiudi ora"
        : decision.score >= 0.5
          ? "verifica collegamento"
          : friction >= 0.7
            ? "dato poco affidabile"
            : "non urgente";
      return this.toGoldDecisionItem("cash", payment.id, decision, {
        label: payment.clientName || payment.walkInName || "Pagamento",
        output,
        amountCents: amount,
        ageDays,
        target: "cashdesk",
        suggestedAction: output,
        explanationShort: output,
        explanationLong: decision.explanation
      });
    }).sort((a, b) => b.phi - a.phi).slice(0, 10);
    return {
      domain: "cash",
      engineVersion: "gold_phi_cash_v1",
      generatedAt: nowIso(),
      items,
      summary: {
        highPriority: items.filter((item) => item.band === "alta").length,
        recommended: items.filter((item) => item.band === "media").length,
        total: items.length,
        status: items.some((item) => item.phi >= 0.7) ? "chiudere_ora" : items.length ? "verificare" : "cassa_chiara"
      }
    };
  }

  buildGoldEconomicReading(context = {}, dataQuality = {}) {
    const appointments = Array.isArray(context.appointments) ? context.appointments : [];
    const payments = Array.isArray(context.payments) ? context.payments : [];
    const servicesById = context.servicesById || new Map();
    const period = context.period || {};
    const inPeriod = (value) => {
      const date = toDateOnly(value || "");
      if (!date) return false;
      if (period.startDate && date < period.startDate) return false;
      if (period.endDate && date > period.endDate) return false;
      return true;
    };
    const completedAppointments = appointments.filter((appointment) => (
      ["completed", "ready_checkout"].includes(String(appointment.status || "")) &&
      inPeriod(appointment.startAt || appointment.createdAt)
    ));
    const operationalRevenueCents = completedAppointments.reduce((sum, appointment) => {
      const service = servicesById.get(String(appointment.serviceId || ""));
      return sum + Number(appointment.amountCents || appointment.priceCents || service?.priceCents || 0);
    }, 0);
    const cashRevenueCents = payments
      .filter((payment) => inPeriod(payment.createdAt || payment.paidAt))
      .reduce((sum, payment) => sum + Number(payment.amountCents || 0), 0);
    const gapCents = operationalRevenueCents - cashRevenueCents;
    const gapAbs = Math.abs(gapCents);
    const reference = Math.max(operationalRevenueCents, cashRevenueCents, 1);
    const gapRatio = normalizeScore(gapAbs / reference);
    const thresholdCents = Math.max(5000, Math.round(reference * 0.03));
    const dataQualityScore = normalizeScore(Number(dataQuality.score || 0) / 100);
    const friction = normalizeScore(gapRatio);
    const confidenceEcon = normalizeScore(dataQualityScore * (1 - friction));
    let status = "sistema_allineato";
    let signal = "sistema allineato";
    let action = "OK";
    let suggestedAction = "nessuna azione economica necessaria";
    if (confidenceEcon < 0.5) {
      status = "dato_non_affidabile";
      signal = "dato non affidabile";
      action = "VERIFY";
      suggestedAction = "verifica dati cassa e qualita dati";
    } else if (gapCents > thresholdCents && confidenceEcon >= 0.65) {
      status = "incasso_incompleto";
      signal = "incasso incompleto";
      action = "ACT_NOW";
      suggestedAction = "apri cassa e verifica incassi mancanti";
    } else if (gapCents < -thresholdCents) {
      status = "servizi_incompleti";
      signal = "dati servizi incompleti";
      action = "VERIFY";
      suggestedAction = "verifica servizi e appuntamenti collegati agli incassi";
    } else if (gapAbs <= thresholdCents) {
      status = "sistema_allineato";
      signal = "sistema allineato";
      action = "OK";
      suggestedAction = "mantieni controllo ordinario";
    } else {
      status = "gap_da_verificare";
      signal = "gap economico da verificare";
      action = "VERIFY";
      suggestedAction = "controlla differenza tra servizi completati e incassi";
    }
    return {
      domain: "economic",
      engineVersion: "gold_economic_reading_v1",
      generatedAt: nowIso(),
      period,
      operationalRevenueCents,
      cashRevenueCents,
      gapCents,
      gapRatio: Number(gapRatio.toFixed(3)),
      thresholdCents,
      dataQuality: Number(dataQualityScore.toFixed(3)),
      friction: Number(friction.toFixed(3)),
      confidenceEcon: Number(confidenceEcon.toFixed(3)),
      status,
      signal,
      action,
      suggestedAction,
      explanationShort: `${signal}: operativo ${euro(operationalRevenueCents)}, incasso reale ${euro(cashRevenueCents)}, gap ${euro(gapCents)}.`,
      explanationLong: `F_operativo = servizi completati nel periodo. F_cash = pagamenti registrati nel periodo. Gap = F_operativo - F_cash. Confidence economica ${Math.round(confidenceEcon * 100)}%.`
    };
  }

  buildGoldProfitDecisions(profitability = {}) {
    const services = Array.isArray(profitability.suggestions) ? profitability.suggestions : [];
    const maxRevenue = Math.max(1, ...services.map((service) => Number(service.revenueCents || service.averageRevenueCents || 0)));
    const items = services.slice(0, 80).map((service) => {
      const status = String(service.status || "");
      const marginPercent = Number(service.marginPercent || 0);
      const revenue = Number(service.revenueCents || service.averageRevenueCents || 0);
      const need = normalizeScore(status === "LOSS" ? 1 : status === "LOW_MARGIN" ? 0.75 : marginPercent < 35 ? 0.45 : 0.15);
      const value = normalizeScore(revenue / maxRevenue);
      const urgency = normalizeScore(Number(service.appointments || service.salesCount || 0) >= 10 ? 0.85 : Number(service.appointments || service.salesCount || 0) >= 4 ? 0.55 : 0.25);
      const coherence = normalizeScore(status === "MISSING_DATA" || Number(service.averageCostCents || 0) <= 0 ? 0.25 : 0.85);
      const friction = normalizeScore(status === "MISSING_DATA" ? 1 : Number(service.averageCostCents || 0) <= 0 ? 0.8 : status === "LOSS" ? 0.35 : 0.15);
      const decision = computeGoldDecisionScore("servizio", {
        needScore: need,
        valueScore: value,
        urgencyScore: urgency,
        coherenceScore: coherence,
        frictionScore: friction,
        suggestedAction: status === "MISSING_DATA"
          ? "completa costi"
          : status === "LOSS"
            ? "correggi servizio"
            : status === "LOW_MARGIN"
              ? "ottimizza margine"
              : "spingi servizio",
        explanation: status === "MISSING_DATA"
          ? "Dato incompleto: prima completa costi e durata."
          : status === "LOSS"
            ? "Servizio con margine negativo o sospetto: controllare prezzo, costo e tempo."
            : status === "LOW_MARGIN"
              ? "Servizio venduto con margine migliorabile."
              : "Servizio con lettura positiva."
      });
      const unreliableProfitData = coherence < 0.5 || friction > 0.6;
      const gatedDecision = unreliableProfitData
        ? {
          ...decision,
          score: Math.min(decision.score, 0.59),
          scorePercent: Math.min(decision.scorePercent, 59),
          priorityBand: decision.score >= 0.5 ? "media" : "bassa",
          priorityLabel: decision.score >= 0.5 ? "Priorità media" : "Priorità bassa",
          suggestedAction: "verifica dati redditività",
          explanation: "Dati insufficienti per valutare il margine. Costi o tempi non completi: verifica prima di analizzare."
        }
        : decision;
      const output = unreliableProfitData
        ? status === "MISSING_DATA" || Number(service.averageCostCents || 0) <= 0
          ? "dato incompleto"
          : "margine da verificare"
        : status === "MISSING_DATA"
        ? "dato incompleto"
        : gatedDecision.score >= 0.7
          ? "servizio da correggere"
          : gatedDecision.score >= 0.5
            ? "opportunità di ottimizzazione"
            : marginPercent >= 45
              ? "margine buono"
              : "margine sospetto";
      return this.toGoldDecisionItem("profit", service.id || service.serviceId || service.name, gatedDecision, {
        label: service.name || "Servizio",
        output,
        marginPercent,
        revenueCents: revenue,
        target: "profitability",
        suggestedAction: unreliableProfitData ? "verifica costi o tempi prima di analizzare" : output,
        explanationShort: output,
        explanationLong: gatedDecision.explanation
      });
    }).sort((a, b) => b.phi - a.phi).slice(0, 10);
    return {
      domain: "profit",
      engineVersion: "gold_phi_profit_v1",
      generatedAt: nowIso(),
      items,
      summary: {
        highPriority: items.filter((item) => item.band === "alta").length,
        recommended: items.filter((item) => item.band === "media").length,
        total: items.length,
        status: items.some((item) => item.output === "servizio da correggere") ? "margini_da_correggere" : items.length ? "ottimizzazione" : "nessun_segnale"
      }
    };
  }

  buildGoldOperatorDecisions(operational = {}) {
    const operators = Array.isArray(operational.topOperators) ? operational.topOperators : [];
    const maxRevenue = Math.max(1, ...operators.map((item) => Number(item.revenueCents || 0)));
    const items = operators.slice(0, 8).map((operator, index) => {
      const appointments = Number(operator.appointments || 0);
      const completed = Number(operator.completed || 0);
      const revenue = Number(operator.revenueCents || 0);
      const revenueRatio = normalizeScore(revenue / maxRevenue);
      const completionRate = appointments > 0 ? normalizeScore(completed / appointments) : 0;
      const need = normalizeScore(
        revenueRatio < 0.25 ? 0.9
          : revenueRatio < 0.45 ? 0.7
          : revenueRatio < 0.65 ? 0.45
          : 0.15
      );
      const value = normalizeScore(
        appointments >= 12 ? 0.9
          : appointments >= 6 ? 0.65
          : appointments >= 3 ? 0.4
          : 0.2
      );
      const urgency = normalizeScore(appointments >= 8 ? need : need * 0.8);
      const coherence = normalizeScore(
        completionRate >= 0.8 ? 0.9
          : completionRate >= 0.6 ? 0.72
          : 0.5
      );
      const friction = normalizeScore(
        revenueRatio < 0.25 && appointments >= 4 ? 0.35
          : completionRate < 0.5 ? 0.45
          : 0.15
      );
      const topPerformer = index === 0 && revenueRatio >= 0.85;
      const decision = computeGoldDecisionScore("operatore", {
        needScore: topPerformer ? 0.12 : need,
        valueScore: value,
        urgencyScore: topPerformer ? 0.2 : urgency,
        coherenceScore: topPerformer ? 0.9 : coherence,
        frictionScore: topPerformer ? 0.1 : friction,
        suggestedAction: topPerformer
          ? "usa benchmark operatore"
          : revenueRatio < 0.45
            ? "riequilibra agenda operatore"
            : "monitorare operatore",
        explanation: topPerformer
          ? "Operatore forte nel periodo: usarlo come riferimento operativo."
          : revenueRatio < 0.45
            ? "Operatore sotto ritmo: controllare agenda, assegnazione servizi e continuità clienti."
            : "Operatore da monitorare senza forzare correzioni."
      });
      const output = topPerformer
        ? "benchmark operativo"
        : revenueRatio < 0.45
          ? "operatore da rinforzare"
          : "operatore da monitorare";
      return this.toGoldDecisionItem("operators", operator.staffId || operator.operatorId || operator.name, decision, {
        label: operator.name || operator.operatorName || "Operatore",
        output,
        target: "shifts",
        appointments,
        revenueCents: revenue,
        suggestedAction: topPerformer
          ? "usa benchmark operatore"
          : revenueRatio < 0.45
            ? "riequilibra agenda operatore"
            : "monitorare operatore",
        explanationShort: output,
        explanationLong: decision.explanation
      });
    }).sort((a, b) => b.phi - a.phi).slice(0, 8);
    return {
      domain: "operators",
      engineVersion: "gold_phi_operators_v1",
      generatedAt: nowIso(),
      items,
      summary: {
        highPriority: items.filter((item) => item.band === "alta").length,
        recommended: items.filter((item) => item.band === "media").length,
        total: items.length,
        status: items.some((item) => item.output === "operatore da rinforzare") ? "operatori_da_rinforzare" : items.length ? "operatori_monitorati" : "nessun_segnale"
      }
    };
  }

  buildGoldInventoryDecisions(inventory = {}) {
    const lowStockItems = Array.isArray(inventory.lowStock) ? inventory.lowStock : [];
    const totalItems = Number(inventory.totalItems || 0);
    const items = lowStockItems.slice(0, 8).map((item) => {
      const quantity = Number(item.quantity || item.stockQuantity || 0);
      const minQuantity = Number(item.minQuantity || 0);
      const severity = minQuantity > 0 && quantity <= 0 ? 0.9 : minQuantity > 0 && quantity <= minQuantity ? 0.7 : 0.45;
      const decision = computeGoldDecisionScore("magazzino", {
        needScore: severity,
        valueScore: normalizeScore(totalItems > 0 ? 1 - (quantity / Math.max(minQuantity, 1, totalItems)) : 0.4),
        urgencyScore: severity >= 0.9 ? 0.9 : 0.6,
        coherenceScore: 0.85,
        frictionScore: 0.12,
        suggestedAction: quantity <= 0 ? "riordina subito" : "programma riordino",
        explanation: quantity <= 0
          ? "Articolo sotto zero o esaurito: rischio operativo diretto."
          : "Articolo sotto scorta: va riportato in sicurezza prima che blocchi il centro."
      });
      return this.toGoldDecisionItem("inventory", item.id || item.sku || item.name, decision, {
        label: item.name || "Articolo",
        output: quantity <= 0 ? "sottoscorta critica" : "sottoscorta da gestire",
        target: "inventory",
        quantity,
        minQuantity,
        suggestedAction: quantity <= 0 ? "riordina subito" : "programma riordino",
        explanationShort: quantity <= 0 ? "sottoscorta critica" : "sottoscorta da gestire",
        explanationLong: decision.explanation
      });
    }).sort((a, b) => b.phi - a.phi).slice(0, 8);
    return {
      domain: "inventory",
      engineVersion: "gold_phi_inventory_v1",
      generatedAt: nowIso(),
      items,
      summary: {
        totalItems,
        lowStock: lowStockItems.length,
        highPriority: items.filter((item) => item.band === "alta").length,
        status: lowStockItems.length ? "sottoscorta_attiva" : "stock_stabile"
      }
    };
  }

  buildGoldDashboardDecisions(branches = {}, dataQuality = {}, session = null, economicReading = null) {
    const learningMap = this.getGoldLearningStatsMap(session);
    const downgradeBand = (band) => {
      if (band === "alta") return { key: "media", label: "Priorità media" };
      if (band === "media") return { key: "bassa", label: "Priorità bassa" };
      if (band === "bassa") return { key: "stop", label: "Non prioritario" };
      return { key: band || "stop", label: "Non prioritario" };
    };
    const reliabilityGate = (item) => {
      const coherence = Number(item.factors?.coherence || 0);
      const friction = Number(item.factors?.friction || 0);
      if (!(coherence < 0.5 || friction > 0.6)) return item;
      const penalty = friction > 0.75 || coherence < 0.35 ? 0.7 : 0.8;
      const nextPhi = Number(Math.max(0, Number(item.phi || 0) * penalty).toFixed(3));
      const nextRap = Number(Math.max(0, Number(item.riskAdjustedPriority || 0) * penalty).toFixed(3));
      const nextTrendRap = Number(Math.max(0, Number(item.riskAdjustedPriorityTrend ?? item.riskAdjustedPriority ?? 0) * penalty).toFixed(3));
      const nextRap2 = Number(Math.max(0, Number(item.riskAdjustedPriority2 ?? item.riskAdjustedPriorityTrend ?? item.riskAdjustedPriority ?? 0) * penalty).toFixed(3));
      const downgraded = downgradeBand(item.band);
      return {
        ...item,
        phi: nextPhi,
        phiPercent: Math.round(nextPhi * 100),
        riskAdjustedPriority: nextRap,
        riskAdjustedPriorityPercent: Math.round(nextRap * 100),
        riskAdjustedPriorityTrend: nextTrendRap,
        riskAdjustedPriorityTrendPercent: Math.round(nextTrendRap * 100),
        riskAdjustedPriority2: nextRap2,
        riskAdjustedPriority2Percent: Math.round(nextRap2 * 100),
        band: downgraded.key,
        bandLabel: downgraded.label,
        reliabilityPenaltyApplied: true,
        reliabilityPenalty: Number((1 - penalty).toFixed(2)),
        explanationShort: item.output === "margine buono" || item.output === "Buona opportunità"
          ? "Segnale da verificare"
          : item.explanationShort,
        explanationLong: `${item.explanationLong || item.explanationShort || ""} Dato non abbastanza affidabile: priorità ridotta prima di mostrarlo come segnale operativo.`.trim()
      };
    };
    const branchItems = [
      ...(branches.marketing?.items || []),
      ...(branches.agenda?.items || []),
      ...(branches.cash?.items || []),
      ...(branches.profit?.items || []),
      ...(branches.operators?.items || []),
      ...(branches.inventory?.items || [])
    ].map(reliabilityGate);
    const qualityNeed = normalizeScore((100 - Number(dataQuality.score || 100)) / 100);
    let qualityDecision = qualityNeed > 0 ? this.toGoldDecisionItem("dashboard", "data-quality", computeGoldDecisionScore("data_quality_alert", {
      needScore: qualityNeed,
      valueScore: 0.55,
      urgencyScore: qualityNeed >= 0.35 ? 0.75 : 0.35,
      coherenceScore: normalizeScore(Number(dataQuality.score || 0) / 100),
      frictionScore: qualityNeed >= 0.5 ? 0.65 : 0.25,
      suggestedAction: "migliora qualità dati",
      explanation: `Qualità dati ${dataQuality.score || 0}%: correggi solo ciò che blocca letture affidabili.`
    }), {
      label: "Qualità dati",
      output: Number(dataQuality.score || 0) < 65 ? "rischio operativo reale" : "monitorare",
      target: "clients"
    }) : null;
    if (qualityDecision) {
      qualityDecision = this.applyGoldTemporalLayerToItems([qualityDecision], this.getGoldDecisionHistoryMap(session))[0];
      qualityDecision = this.applyGoldEnterpriseLayerToItems([qualityDecision], learningMap)[0];
    }
    let economicDecision = null;
    if (economicReading) {
      const need = economicReading.action === "ACT_NOW" ? 0.9 : economicReading.action === "VERIFY" ? 0.55 : 0.1;
      const urgency = economicReading.action === "ACT_NOW" ? 0.9 : economicReading.action === "VERIFY" ? 0.55 : 0.2;
      const value = normalizeScore(Math.abs(Number(economicReading.gapCents || 0)) / Math.max(Number(economicReading.operationalRevenueCents || 0), Number(economicReading.cashRevenueCents || 0), 1));
      const decision = computeGoldDecisionScore("pagamento", {
        needScore: need,
        valueScore: value,
        urgencyScore: urgency,
        coherenceScore: economicReading.confidenceEcon,
        frictionScore: economicReading.friction,
        suggestedAction: economicReading.suggestedAction,
        explanation: economicReading.explanationLong
      });
      economicDecision = this.toGoldDecisionItem("economic", "revenue-gap", decision, {
        label: "Lettura economica",
        output: economicReading.signal,
        target: "cashdesk",
        dataQuality: economicReading.confidenceEcon,
        risk: economicReading.friction,
        suggestedAction: economicReading.suggestedAction,
        explanationShort: economicReading.explanationShort,
        explanationLong: economicReading.explanationLong,
        economicReading
      });
      economicDecision = {
        ...economicDecision,
        action: economicReading.action === "OK" ? "OK" : economicDecision.action,
        suggestedAction: economicReading.suggestedAction,
        band: economicReading.action === "OK" ? "ok" : economicDecision.band,
        bandLabel: economicReading.action === "OK" ? "Sistema allineato" : economicDecision.bandLabel
      };
      economicDecision = this.applyGoldTemporalLayerToItems([economicDecision], this.getGoldDecisionHistoryMap(session))[0];
      economicDecision = this.applyGoldEnterpriseLayerToItems([economicDecision], learningMap)[0];
    }
    const allItems = [...branchItems, qualityDecision, economicDecision].filter(Boolean)
      .sort((a, b) => Number(b.riskAdjustedPriority2 ?? b.riskAdjustedPriorityTrend ?? b.riskAdjustedPriority ?? 0) - Number(a.riskAdjustedPriority2 ?? a.riskAdjustedPriorityTrend ?? a.riskAdjustedPriority ?? 0) || Number(b.netExpectedUtility || 0) - Number(a.netExpectedUtility || 0) || Number(b.riskAdjustedPriorityTrend ?? b.riskAdjustedPriority ?? 0) - Number(a.riskAdjustedPriorityTrend ?? a.riskAdjustedPriority ?? 0) || Number(b.phi || 0) - Number(a.phi || 0))
      .slice(0, 12);
    const actionableItems = allItems.filter((item) => !["STOP", "VERIFY"].includes(String(item.action || "")) && Number(item.riskAdjustedPriority2 ?? 0) >= 0.25);
    const fallbackItems = [];
    const profitabilityReliable = dataQuality?.profitabilityReliable !== false;
    const servicesMissingCosts = Number(dataQuality?.metrics?.servicesMissingCosts || 0);
    const operatorsMissingHourlyCost = Number(dataQuality?.metrics?.operatorsMissingHourlyCost || 0);
    const clientsMissingLastVisit = Number(dataQuality?.metrics?.clientsMissingLastVisit || 0);
    const clientsTotal = Math.max(1, Number(dataQuality?.metrics?.clients || 0));
    const marketingCandidates = Number(branches.marketing?.summary?.total || 0);
    const agendaAttention = String(branches.agenda?.summary?.status || "") === "attenzione";
    if (!profitabilityReliable) {
      if (clientsMissingLastVisit >= Math.max(10, Math.floor(clientsTotal * 0.25))) {
        fallbackItems.push(this.toGoldDecisionItem("marketing", "fallback-last-visit", computeGoldDecisionScore("fallback_last_visit", {
          needScore: normalizeScore(clientsMissingLastVisit / clientsTotal),
          valueScore: 0.62,
          urgencyScore: 0.72,
          coherenceScore: 0.78,
          frictionScore: 0.16,
          suggestedAction: "completa continuita clienti",
          explanation: "Mancano ultime visite su una quota rilevante di clienti: va ricostruita la continuità prima delle letture economiche."
        }), {
          label: "Completa continuità clienti",
          output: "ricostruisci ultime visite e richiami",
          target: "clients",
          suggestedAction: "verifica clienti storici e richiama i fuori routine",
          explanationShort: "Priorità operativa: recupera continuità clienti",
          explanationLong: "La redditività non è affidabile, ma puoi lavorare subito sulla continuità clienti ricostruendo ultime visite e richiami."
        }));
      } else if (marketingCandidates > 0) {
        fallbackItems.push(this.toGoldDecisionItem("marketing", "fallback-recall", computeGoldDecisionScore("fallback_recall", {
          needScore: normalizeScore(marketingCandidates / 5),
          valueScore: 0.68,
          urgencyScore: 0.7,
          coherenceScore: 0.84,
          frictionScore: 0.14,
          suggestedAction: "richiama clienti inattivi",
          explanation: "La redditività è ancora da verificare, ma il marketing Gold vede clienti già pronti a un richiamo morbido."
        }), {
          label: "Richiama clienti inattivi",
          output: "attiva recall morbido",
          target: "marketing",
          suggestedAction: "apri marketing e approva i richiami più utili",
          explanationShort: "Puoi lavorare subito sui richiami",
          explanationLong: "Anche senza margini affidabili il centro può lavorare su continuità e riattivazione clienti."
        }));
      } else if (agendaAttention) {
        fallbackItems.push(this.toGoldDecisionItem("agenda", "fallback-agenda", computeGoldDecisionScore("fallback_agenda", {
          needScore: 0.62,
          valueScore: 0.58,
          urgencyScore: 0.7,
          coherenceScore: 0.82,
          frictionScore: 0.12,
          suggestedAction: "riempi agenda",
          explanation: "La redditività non è affidabile, ma l'agenda mostra attenzione operativa: prima riempi volume e continuità."
        }), {
          label: "Riempi agenda",
          output: "copri slot e giornate deboli",
          target: "agenda",
          suggestedAction: "apri agenda e copri i buchi con recall mirati",
          explanationShort: "Prima agenda e continuità, poi margini",
          explanationLong: "Con margini ancora non affidabili, la leva più utile resta riempire agenda e stabilizzare il flusso clienti."
        }));
      } else {
        fallbackItems.push(this.toGoldDecisionItem("dashboard", "fallback-costs", computeGoldDecisionScore("fallback_costs", {
          needScore: normalizeScore(Number(dataQuality?.metrics?.servicesMissingCosts || 0) / Math.max(1, Number(dataQuality?.metrics?.services || 0))),
          valueScore: 0.5,
          urgencyScore: 0.55,
          coherenceScore: 0.92,
          frictionScore: 0.08,
          suggestedAction: "verifica dati costi",
          explanation: "La redditività è bloccata da costi mancanti: la prima azione è completare il catalogo economico."
        }), {
          label: "Verifica dati costi",
          output: "completa costi servizi",
          target: "profitability",
          suggestedAction: "apri servizi e completa costi prodotti o tecnologie",
          explanationShort: "Serve completare i costi per sbloccare Gold",
          explanationLong: "Il sistema legge bene il centro ma non può promuovere decisioni economiche finché i costi servizio restano vuoti."
        }));
      }
    }
    const topActionable = actionableItems[0] || null;
    const hardEconomicConfigBlock = !profitabilityReliable && (servicesMissingCosts > 0 || operatorsMissingHourlyCost > 0);
    const preferFallbackPrimary = fallbackItems.length > 0 && (
      hardEconomicConfigBlock
      || (
        !profitabilityReliable
        && (
          !topActionable
          || String(topActionable.action || "") === "MONITOR"
          || topActionable.canExecute === false
        )
      )
    );
    const primaryAction = preferFallbackPrimary
      ? fallbackItems[0]
      : topActionable || fallbackItems[0] || allItems.find((item) => String(item.action || "") === "VERIFY") || allItems[0] || null;
    const secondaryActions = allItems.filter((item) => primaryAction && `${item.domain}:${item.entityId}` !== `${primaryAction.domain}:${primaryAction.entityId}` && !["STOP", "VERIFY"].includes(String(item.action || ""))).slice(0, 3);
    const blockedActions = allItems.filter((item) => ["STOP", "VERIFY"].includes(String(item.action || ""))).slice(0, 5);
    const v7 = this.computeDecisionCenterV7(allItems);
    const uiReading = this.resolveDecisionCenterUiBand(v7, primaryAction);
    return {
      domain: "dashboard",
      engineVersion: "gold_phi_dashboard_v1",
      enterpriseLayer: "corelia_enterprise_v1",
      generatedAt: nowIso(),
      items: allItems,
      primaryAction,
      secondaryActions,
      blockedActions,
      v7,
      summary: {
        rankingMethod: "risk_adjusted_priority_2_enterprise",
        classicRankingAvailable: true,
        uiReadingBand: uiReading.key,
        uiReadingLabel: uiReading.label,
        conflictIndex: v7.conflictIndex,
        firstAction: primaryAction?.suggestedAction || "nessuna azione urgente",
        primaryAction: primaryAction ? {
          domain: primaryAction.domain,
          entityId: primaryAction.entityId,
          label: primaryAction.label,
          action: primaryAction.action,
          suggestedAction: primaryAction.suggestedAction,
          RAP_trend_adj: primaryAction.RAP_trend_adj ?? primaryAction.riskAdjustedPriorityTrend,
          risk: primaryAction.enterpriseRisk ?? primaryAction.risk,
          EV: primaryAction.expectedValue,
          OC: primaryAction.opportunityCost,
          NEU: primaryAction.netExpectedUtility
        } : null,
        secondaryActions: secondaryActions.map((item) => ({
          domain: item.domain,
          entityId: item.entityId,
          label: item.label,
          action: item.action,
          suggestedAction: item.suggestedAction,
          riskAdjustedPriority2: item.riskAdjustedPriority2
        })),
        blockedActions: blockedActions.map((item) => ({
          domain: item.domain,
          entityId: item.entityId,
          label: item.label,
          action: item.action,
          reason: item.explanationShort || item.output
        })),
        mainProblem: allItems.find((item) => ["cash", "agenda", "profit", "operators", "inventory"].includes(item.domain) && item.phi >= 0.5)?.explanationShort || "nessun problema urgente",
        bestOpportunity: allItems.find((item) => item.domain === "marketing" || item.output === "margine buono")?.explanationShort || "nessuna opportunità prioritaria",
        areaToAvoidNow: allItems.find((item) => item.factors?.friction >= 0.75)?.label || "",
        operationalRisk: allItems.find((item) => item.band === "alta")?.explanationShort || "rischio sotto controllo",
        fragileDataArea: allItems.find((item) => item.confidence < 0.4 || item.reliabilityPenaltyApplied)?.label || "",
        totalSignals: allItems.length
      }
    };
  }

  getBusinessSnapshot(options = {}, session = null) {
    this.assertCanOperate(session);
    const plan = this.getPlanLevel(session);
    if (plan !== "gold") {
      return {
        snapshotAvailable: false,
        requiredPlan: "gold",
        currentPlan: plan,
        message: "Business Snapshot disponibile solo come fonte decisionale del piano Gold."
      };
    }
    const stateSnapshot = this.buildBusinessSnapshotFromGoldState(options, session);
    if (stateSnapshot) return stateSnapshot;

    const startDate = String(options.startDate || "");
    const endDate = String(options.endDate || "");
    const cacheKey = this.getBusinessSnapshotCacheKey({ startDate, endDate }, session);
    const cached = this.businessSnapshotCache.get(cacheKey);
    const nowMs = Date.now();
    if (cached && cached.expiresAtMs > nowMs && !options.forceRefresh) {
      return {
        ...cached.snapshot,
        meta: {
          ...cached.snapshot.meta,
          cached: true,
          cacheAgeMs: nowMs - cached.createdAtMs
        }
      };
    }

    const nowDate = toDateOnly(nowIso());
    const currentMonthStart = `${nowDate.slice(0, 7)}-01`;
    const snapshotStartDate = startDate || currentMonthStart;
    const snapshotEndDate = endDate || nowDate;
    const marketing = this.getAiGoldMarketing(session);
    const operational = this.getOperationalReport({ startDate: snapshotStartDate, endDate: snapshotEndDate }, session);
    const centerHealth = this.getCenterHealth({ startDate: snapshotStartDate, endDate: snapshotEndDate }, session, operational);
    const profitabilityOverview = this.getProfitabilityOverview(
      { startDate: snapshotStartDate, endDate: snapshotEndDate },
      session,
      { centerHealth }
    );
    const profitability = this.buildAiGoldProfitabilityFromOverview(profitabilityOverview);
    const inventory = this.getInventoryOverview(session);
    const dataQuality = this.getDataQuality(session, { summaryOnly: true });
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const servicesById = mapById(services);
    const resources = this.filterByCenter(this.resourcesRepository.list(), session);
    const treatments = this.filterByCenter(this.treatmentsRepository.list(), session);
    const protocols = this.listProtocols("", session);
    const nextSeven = new Date(`${nowDate}T00:00:00`);
    nextSeven.setDate(nextSeven.getDate() + 7);
    const nextSevenDate = toDateOnly(nextSeven.toISOString());
    const upcomingAppointments = appointments.filter((item) => {
      const date = toDateOnly(item.startAt || item.createdAt);
      return date >= nowDate && date <= nextSevenDate && !["cancelled", "no_show"].includes(String(item.status || ""));
    });
    const upcomingByDay = new Map();
    upcomingAppointments.forEach((appointment) => {
      const date = toDateOnly(appointment.startAt || appointment.createdAt);
      upcomingByDay.set(date, (upcomingByDay.get(date) || 0) + 1);
    });
    const weakestUpcomingDay = Array.from(upcomingByDay.entries())
      .sort((a, b) => Number(a[1]) - Number(b[1]))[0] || null;
    const staffLoad = new Map();
    upcomingAppointments.forEach((appointment) => {
      const staffId = String(appointment.staffId || "unassigned");
      const row = staffLoad.get(staffId) || {
        staffId,
        name: appointment.staffName || "Operatore libero",
        appointments: 0
      };
      row.appointments += 1;
      staffLoad.set(staffId, row);
    });
    const leastLoadedOperator = Array.from(staffLoad.values())
      .sort((a, b) => Number(a.appointments || 0) - Number(b.appointments || 0))[0] || null;
    const topOperator = operational.topOperators?.[0] || null;
    const weakOperator = operational.topOperators?.slice().reverse()[0] || leastLoadedOperator || null;
    const topClient = operational.topClientsBySpend?.[0] || null;
    const focusClient = marketing.suggestions?.[0] || null;
    const goldMarketingBranch = {
      domain: "marketing",
      engineVersion: "gold_phi_marketing_v1",
      generatedAt: nowIso(),
      items: (Array.isArray(marketing.suggestions) ? marketing.suggestions : [])
        .filter((item) => item.goldDecision)
        .map((item) => this.toGoldDecisionItem("marketing", item.clientId, item.goldDecision, {
          label: item.name || "Cliente",
          output: item.contactClassLabel || item.finalPriorityLabel || "Marketing",
          target: "marketing",
          clientId: item.clientId,
          suggestedAction: item.recommendedAction || item.operatingDecision || "gestisci cliente",
          explanationShort: item.contactClassLabel || item.clearReason || "Priorità marketing",
          explanationLong: item.goldDecision?.explanation || item.urgencyReason || ""
        }))
        .sort((a, b) => b.phi - a.phi)
        .slice(0, 10),
      summary: {
        highPriority: (marketing.suggestions || []).filter((item) => Number(item.goldDecision?.score || 0) >= 0.7).length,
        recommended: (marketing.suggestions || []).filter((item) => Number(item.goldDecision?.score || 0) >= 0.5).length,
        total: (marketing.suggestions || []).length,
        status: marketing.suggestions?.length ? "priorita_clienti" : "nessun_recall_urgente"
      }
    };
    const rawGoldBranches = {
      marketing: goldMarketingBranch,
      agenda: this.buildGoldAgendaDecisions({ appointments, servicesById }, session),
      cash: this.buildGoldCashDecisions({ payments }, session),
      profit: this.buildGoldProfitDecisions(profitability),
      operators: this.buildGoldOperatorDecisions(operational),
      inventory: this.buildGoldInventoryDecisions(inventory)
    };
    const temporalGoldBranches = this.applyGoldTemporalLayer(rawGoldBranches, session);
    const enterpriseGoldBranches = this.applyGoldEnterpriseLayer(temporalGoldBranches, session);
    const economicReading = this.buildGoldEconomicReading({
      appointments,
      payments,
      servicesById,
      period: { startDate: snapshotStartDate, endDate: snapshotEndDate }
    }, dataQuality);
    const goldDashboardBranch = this.buildGoldDashboardDecisions(enterpriseGoldBranches, dataQuality, session, economicReading);
    const goldHistoryWrite = this.persistGoldDecisionHistory({
      ...enterpriseGoldBranches,
      dashboard: goldDashboardBranch
    }, session);
    const snapshot = {
      snapshotAvailable: true,
      snapshotVersion: "1.0",
      sourceLayer: "business_snapshot",
      generatedAt: nowIso(),
      expiresAt: new Date(nowMs + SNAPSHOT_CACHE_TTL_MS).toISOString(),
      plan,
      period: {
        startDate: snapshotStartDate,
        endDate: snapshotEndDate
      },
      meta: {
        cached: false,
        cacheTtlMs: SNAPSHOT_CACHE_TTL_MS,
        freshness: "fresh",
        rule: "Corelia comprime e ordina il campo, AI Gold lo espone in forma operativa.",
        dirtyBlocks: Array.from(this.getDirtyBlockSet(this.getCenterId(session)))
      },
      blockMeta: {
        policyVersion: "2026-04-16-update-modes",
        rule: "Live solo operativo immediato; event-driven per sintesi; timeout/batch per analisi pesanti; manuale per verifiche; Corelia resta read-first.",
        modes: UPDATE_MODES,
        policies: ANALYTICS_UPDATE_POLICIES,
        realtime: Object.entries(ANALYTICS_UPDATE_POLICIES).filter(([, policy]) => policy.mode === UPDATE_MODES.REALTIME).map(([key]) => key),
        eventDriven: Object.entries(ANALYTICS_UPDATE_POLICIES).filter(([, policy]) => policy.mode === UPDATE_MODES.EVENT_DRIVEN).map(([key]) => key),
        timeoutBatch: Object.entries(ANALYTICS_UPDATE_POLICIES).filter(([, policy]) => policy.mode === UPDATE_MODES.TIMEOUT_BATCH).map(([key]) => key),
        manual: Object.entries(ANALYTICS_UPDATE_POLICIES).filter(([, policy]) => policy.mode === UPDATE_MODES.MANUAL).map(([key]) => key),
        snapshotRead: Object.entries(ANALYTICS_UPDATE_POLICIES).filter(([, policy]) => policy.mode === UPDATE_MODES.SNAPSHOT_READ).map(([key]) => key)
      },
      core: {
        appointments: appointments.length,
        treatments: treatments.length,
        protocols: protocols.length,
        technologies: resources.length
      },
      report: {
        operational,
        centerHealth
      },
      marketing: {
        ...marketing,
        priorityClients: Array.isArray(marketing.suggestions) ? marketing.suggestions : [],
        lostClients: Array.isArray(marketing.lostClients) ? marketing.lostClients : [],
        historicInactiveClients: Array.isArray(marketing.historicInactiveClients) ? marketing.historicInactiveClients : [],
        focusClient
      },
      profitability,
      inventory,
      dataQuality,
      economic: economicReading,
      goldEngine: {
        engineLayer: "gold_decision_engine",
        engineVersion: "corelia_phi_multi_domain_v1",
        enterpriseLayer: "corelia_enterprise_v1",
        engineName: "Corelia",
        runtimeStack: ["V0", "V2", "V7"],
        enterpriseRule: "Gold Enterprise ordina con storico, rischio esplicito, valore atteso, costo opportunita, utilita netta, simulazione V1 e learning bayesiano sugli outcome.",
        temporalLayer: "gold_temporal_v1",
        temporalMode: "test_parallel",
        temporalRule: "RAP classico resta disponibile; Dashboard valuta in parallelo RAP trend-adjusted, confidence temporale, volatilita e delta.",
        history: goldHistoryWrite,
        rule: "Gold legge dati già presenti, pesa i segnali e produce priorità operative. Base e Silver non dipendono da questo motore.",
        marketing: enterpriseGoldBranches.marketing,
        agenda: enterpriseGoldBranches.agenda,
        cash: enterpriseGoldBranches.cash,
        profit: enterpriseGoldBranches.profit,
        operators: enterpriseGoldBranches.operators,
        inventory: enterpriseGoldBranches.inventory,
        dashboard: goldDashboardBranch
      },
      operations: {
        upcomingAppointments,
        weakestUpcomingDay,
        leastLoadedOperator,
        topOperator,
        weakOperator,
        topClient
      }
    };
    this.businessSnapshotCache.set(cacheKey, {
      createdAtMs: nowMs,
      expiresAtMs: nowMs + SNAPSHOT_CACHE_TTL_MS,
      snapshot
    });
    return snapshot;
  }

  computeDecisionCenterV7(items = []) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return {
        active: true,
        stage: "compressed",
        highMass: 0,
        midMass: 0,
        lowMass: 0,
        irreversibleMass: 0,
        overlapDensity: 0,
        dominanceMargin: 0,
        conflictIndex: 0
      };
    }
    const weighted = list.map((item) => {
      const action = String(item?.action || "MONITOR").toUpperCase();
      const priority = normalizeScore(item?.riskAdjustedPriority2 ?? item?.riskAdjustedPriorityTrend ?? item?.riskAdjustedPriority ?? item?.phi ?? 0);
      const phi = normalizeScore(item?.phi ?? priority);
      const risk = normalizeScore(item?.enterpriseRisk ?? item?.risk ?? item?.factors?.friction ?? 0);
      const weight = normalizeScore((0.5 * priority) + (0.3 * phi) + (0.2 * (1 - risk)));
      return { action, weight };
    }).filter((item) => item.weight > 0);
    const totalMass = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
    const massBy = (actions) => this.goldRound(weighted.filter((item) => actions.includes(item.action)).reduce((sum, item) => sum + item.weight, 0) / totalMass);
    const highMass = massBy(["ACT_NOW", "HIGH", "CRITICAL"]);
    const midMass = massBy(["SUGGEST", "MEDIUM", "WARNING"]);
    const lowMass = massBy(["MONITOR", "OK", "LOW"]);
    const irreversibleMass = massBy(["VERIFY", "STOP", "BLOCKED", "LOW_CONFIDENCE"]);
    const sortedMasses = [highMass, midMass, lowMass, irreversibleMass].sort((a, b) => b - a);
    const dominanceMargin = this.goldRound(Math.max(0, sortedMasses[0] - (sortedMasses[1] || 0)));
    const overlapDensity = this.goldRound(Math.min(1, highMass + midMass + (irreversibleMass * 0.5)));
    const conflictIndex = this.goldRound(clamp(Math.min(highMass, midMass) + (irreversibleMass * 0.35), 0, 1));
    return {
      active: true,
      stage: "compressed",
      highMass,
      midMass,
      lowMass,
      irreversibleMass,
      overlapDensity,
      dominanceMargin,
      conflictIndex
    };
  }

  resolveDecisionCenterUiBand(v7 = {}, primaryAction = null) {
    const action = String(primaryAction?.action || "").toUpperCase();
    const conflictIndex = Number(v7?.conflictIndex || 0);
    const irreversibleMass = Number(v7?.irreversibleMass || 0);
    const confidence = normalizeScore(primaryAction?.confidence ?? primaryAction?.dataQuality ?? primaryAction?.reliabilityScore ?? 1);
    if (action === "ACT_NOW" && confidence < 0.55) {
      return { key: "verify", label: "Quadro da verificare" };
    }
    if (action === "ACT_NOW" && confidence < 0.7) {
      return { key: "confirm", label: "Risposta da confermare" };
    }
    if (action === "STOP" || action === "VERIFY" || conflictIndex >= 0.45 || irreversibleMass >= 0.35) {
      return { key: "verify", label: "Quadro da verificare" };
    }
    if (action === "SUGGEST" || conflictIndex >= 0.25) {
      return { key: "confirm", label: "Risposta da confermare" };
    }
    return { key: "clear", label: "Risposta chiara" };
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
    if (this.getPlanLevel(session) === "gold") {
      try {
        const stateDecisionCenter = this.buildDecisionCenterFromGoldState(options, session);
        if (stateDecisionCenter) {
          console.log("[decision_center_source]", JSON.stringify({
            centerId: this.getCenterId(session),
            source: "gold_state"
          }));
          return stateDecisionCenter;
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
    const inventory = snapshot.inventory || {};
    const dataQuality = snapshot.dataQuality || {};
    const goldEngine = snapshot.goldEngine || {};
    const goldEnginePriorityItems = (goldEngine.dashboard?.items || []).slice(0, 5).map((item) => {
      const isEconomicGapItem = String(item.entityId || "").includes("economic-revenue-gap") || String(item.domain || "") === "dashboard";
      if (profitabilityBlockedForConfig && isEconomicGapItem) {
        return {
          id: `gold-engine-${item.domain}-${item.entityId}`,
          level: "warning",
          area: item.domain,
          conclusion: "Configurazione economica incompleta",
          reason: "Il centro ha segnali operativi reali, ma questa lettura non va usata come giudizio sul business finché costi servizi e costi orari non sono completi.",
          details: `Completa ${Number(dataQuality.metrics?.servicesMissingCosts || 0)} costi servizio e ${Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0)} costi orari operatori.`,
          impactCents: 0,
          riskCents: 0,
          action: "completa costi servizi e operatori",
          button: "Apri servizi",
          target: "services"
        };
      }
      return {
        id: `gold-engine-${item.domain}-${item.entityId}`,
        level: item.band === "alta" ? "critical" : item.band === "media" ? "warning" : item.band === "bassa" ? "info" : "success",
        area: item.domain,
        conclusion: item.explanationShort || item.output || "Segnale Gold",
        reason: item.explanationLong || item.suggestedAction || "Priorità calcolata da Corelia Decision Engine.",
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
    const profitabilityBlockedForConfig = Number(dataQuality.metrics?.servicesMissingCosts || 0) > 0
      || Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0) > 0;
    const membershipWarning = topClient && focusClient && String(topClient.clientId || "") === String(focusClient.clientId || "")
      ? topClient
      : null;
    const centerHealthNotRepresentative = profitabilityBlockedForConfig
      && Number(centerHealth.monthlyRevenueCents || 0) <= 0
      && Number(centerHealth.saturationPercent || 0) <= 0
      && Number(centerHealth.continuityPercent || 0) <= 0;
    const sections = [
      {
        key: "center_health",
        title: "Stato centro",
        items: [
          {
            id: "center-health-main",
            level: centerHealth.level,
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
              ? `Completa ${Number(dataQuality.metrics?.servicesMissingCosts || 0)} costi servizio e ${Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0)} costi orari operatori prima di usare questo blocco come lettura di stato.`
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
        key: "gold_engine",
        title: "Corelia Decision Engine",
        items: goldEnginePriorityItems
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
              ? `Volume presente, ma i costi non sono completi. Mancano ${Number(dataQuality.metrics?.servicesMissingCosts || 0)} costi servizio e ${Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0)} costi orari.`
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
            target: "inventory"
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
              ? "Redditività non ancora leggibile"
              : "Redditività pronta per lettura operativa",
            reason: profitabilityBlockedForConfig
              ? "Il centro lavora, ma i margini sarebbero fraintendibili finché costi servizi e costi orari restano incompleti."
              : "La lettura economica può essere usata come supporto operativo.",
            details: profitabilityBlockedForConfig
              ? `Completa ${Number(dataQuality.metrics?.servicesMissingCosts || 0)} costi servizio e ${Number(dataQuality.metrics?.operatorsMissingHourlyCost || 0)} costi orari operatori.`
              : "Configurazione economica sufficiente per letture Gold più forti.",
            impactCents: 0,
            riskCents: 0,
            action: profitabilityBlockedForConfig ? "completa costi servizi e operatori" : "controlla margini e opportunita",
            button: "Apri servizi",
            target: "services"
          },
          {
            id: "action-marketing",
            level: marketing.suggestions?.length ? "critical" : "info",
            area: "marketing",
            conclusion: marketing.suggestions?.length
              ? `${marketing.suggestions.length} clienti da leggere con priorità`
              : "Marketing prudente: nessun contatto promosso oggi",
            reason: marketing.suggestions?.length
              ? "Parti dai clienti più urgenti e prepara messaggi mirati."
              : "Con le regole attuali Gold non ha trovato recall abbastanza sicuri da promuovere oggi.",
            details: marketing.suggestions?.length
              ? "Gold ordina recall, rischio operativo e riferimenti economici reali già presenti prima di far partire il messaggio."
              : "Questo non significa che il marketing non funzioni: oggi mancano contatti utili o segnali abbastanza solidi per spingere un’azione.",
            impactCents: 0,
            riskCents: 0,
            action: marketing.suggestions?.length ? "lavora la lista recall" : "rivedi contatti, consensi e storico",
            button: "Genera azioni",
            target: "autopilot"
          },
          {
            id: "action-data",
            level: dataQuality.status === "basso" ? "warning" : "info",
            area: "qualità dati",
            conclusion: `Qualità dati ${dataQuality.score}%`,
            reason: dataQuality.status === "basso" ? "Correggi i dati che bloccano letture affidabili." : "Mantieni puliti cassa, clienti e servizi.",
            details: profitabilityBlockedForConfig
              ? `${Number(dataQuality.metrics?.servicesMissingCosts || 0)} servizi senza costi configurati`
              : dataQuality.alerts?.[0] || "Dati sufficienti per lettura operativa.",
            impactCents: 0,
            riskCents: 0,
            action: "correggi dati sporchi quando rallentano l'analisi",
            button: "Apri clienti",
            target: "clients"
          }
        ]
      }
    ].map((section) => ({
      ...section,
      items: section.items.slice(0, 4)
    }));
    const totalInsights = sections.reduce((sum, section) => sum + section.items.length, 0);
    return {
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
      sections
    };
  }

  buildAiGoldProfitabilityFromOverview(overview = {}) {
    const services = Array.isArray(overview.services) ? overview.services : [];
    const suggestions = services.map((service) => {
      const status = String(service.status || "HEALTHY");
      const suggestion = status === "CONFIG_REQUIRED"
        ? "Volume presente, ma la redditivita non e leggibile finche non completi costi servizio e costi orari."
        : status === "LOSS"
        ? "Verifica prezzo, durata, costo operatore e consumo prodotti: il servizio rischia di lavorare in perdita."
        : status === "LOW_MARGIN"
          ? "Margine basso: controlla durata reale e prodotti usati prima di spingere il servizio."
          : "Servizio sano: puoi mantenerlo o usarlo come riferimento commerciale.";
      const executions = Number(service.executions || 0);
      const averageRevenueCents = Number(service.averageRevenueCents || 0);
      const averageCostCents = Number(service.averageCostCents || 0);
      const nextAction = status === "CONFIG_REQUIRED"
        ? "Completa costi servizi e costo orario operatori prima di usare questa lettura come guida economica."
        : status === "LOSS"
        ? "Controlla il dato nel modulo servizi: prezzo, durata reale e consumo prodotto."
        : status === "LOW_MARGIN"
          ? "Verifica costi inseriti e valuta se il servizio va spinto o corretto."
          : "Usalo come servizio benchmark per costruire offerte sostenibili.";
      const clearConclusion = status === "CONFIG_REQUIRED"
        ? "lettura economica non ancora affidabile"
        : status === "LOSS"
        ? "stai perdendo soldi"
        : status === "LOW_MARGIN"
          ? "margine migliorabile"
          : "stai guadagnando bene";
      const economicGapCents = status === "LOSS"
        ? Math.abs(Number(service.profitCents || 0))
        : 0;
      const operatingAction = status === "CONFIG_REQUIRED"
        ? "completa configurazione costi"
        : status === "LOSS"
        ? "verifica prezzo, costo e durata nel servizio"
        : status === "LOW_MARGIN"
          ? "controlla costo prodotto e durata reale"
          : "spingi questo servizio";
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
        marginPercent: Number(service.marginPercent || 0),
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
    return {
      goldEnabled: true,
      generatedAt: nowIso(),
      summary: overview.totals,
      monthlyTrend: overview.monthlyTrend || [],
      alerts,
      suggestions
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
    return this.buildAiGoldProfitabilityFromOverview(overview);
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
        source: "gold_state",
        valid: true,
        reason: "ok",
        eventSeq: stateOverview.meta?.eventSeq ?? null
      });
      return this.buildAiGoldProfitabilityFromOverview(stateOverview);
    }
    this.logGoldStateEndpoint("ai_profitability", session, {
      source: "raw_fallback",
      valid: false,
      reason: "state_unavailable"
    });
    const snapshot = this.getBusinessSnapshot(options, session);
    return snapshot.profitability || {
      goldEnabled: true,
      generatedAt: snapshot.generatedAt || nowIso(),
      summary: {},
      monthlyTrend: [],
      alerts: [],
      suggestions: [],
      sourceLayer: "business_snapshot"
    };
  }
}

module.exports = {
  DesktopMirrorService,
  defaultSettings
};
