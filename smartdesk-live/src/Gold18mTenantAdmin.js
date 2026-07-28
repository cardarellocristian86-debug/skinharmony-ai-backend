"use strict";

const crypto = require("crypto");
const {
  skinHarmonyProtocolLibrary
} = require("./SkinHarmonyProtocolLibrary");
const {
  computeCenterProfitabilitySnapshot
} = require("./core/profitability/ProfitabilityCore");

const DATASET_VERSION = "smartdesk_gold_18m_20260726_v1";
const DATASET_CREATED_AT = "2026-07-26T12:00:00.000Z";
const DATASET_CENTER_NAME = "Atelier Aurora Hair & Beauty";
const TECHNICAL_CENTER_IDS = new Set(["", "center_admin"]);
const GLOBAL_LIBRARY_CENTER_ID = "__skinharmony_library";
const MONTH_KEYS = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"
];
const MONTHLY_CHECKOUTS = [
  260, 275, 290, 300, 310, 330, 315, 300, 285, 275, 290, 270,
  285, 290, 295, 300, 290, 290
];
const FIRST_YEAR_REVENUE_CENTS = 20000000;
const SECOND_PERIOD_REVENUE_CENTS = 10000000;
const TOTAL_REVENUE_CENTS = FIRST_YEAR_REVENUE_CENTS + SECOND_PERIOD_REVENUE_CENTS;
const TOTAL_CHECKOUTS = MONTHLY_CHECKOUTS.reduce((sum, value) => sum + value, 0);
const TOTAL_RETAIL_LINES = 1155;
const CATEGORY_TOTALS = Object.freeze({
  hair: 4000,
  beauty: 900,
  technology: 350
});
const CLIENT_VISIT_COUNT_DISTRIBUTION = Object.freeze([
  Object.freeze({ clients: 100, visits: 0, segment: "dormant_or_prospect" }),
  Object.freeze({ clients: 220, visits: 1, segment: "one_time" }),
  Object.freeze({ clients: 220, visits: 2, segment: "occasional" }),
  Object.freeze({ clients: 180, visits: 4, segment: "developing" }),
  Object.freeze({ clients: 150, visits: 6, segment: "regular" }),
  Object.freeze({ clients: 100, visits: 9, segment: "loyal" }),
  Object.freeze({ clients: 70, visits: 12, segment: "loyal_plus" }),
  Object.freeze({ clients: 40, visits: 18, segment: "silver_candidate" }),
  Object.freeze({ clients: 10, visits: 25, segment: "gold_candidate" }),
  Object.freeze({ clients: 10, visits: 26, segment: "gold_candidate" })
]);
const CLOSED_DATES = new Set([
  "2025-01-01", "2025-01-06", "2025-04-21", "2025-04-25", "2025-05-01",
  "2025-06-02", "2025-08-11", "2025-08-12", "2025-08-13", "2025-08-14",
  "2025-08-15", "2025-08-16", "2025-10-04", "2025-11-01", "2025-12-08",
  "2025-12-25", "2025-12-26",
  "2026-01-01", "2026-01-06", "2026-04-06", "2026-04-25", "2026-05-01",
  "2026-06-02"
]);
const STAFF_AVAILABILITY = Object.freeze({
  arianna: Object.freeze({
    weeklyDayOff: 1,
    leaveRanges: Object.freeze([["2025-07-28", "2025-08-02"], ["2026-01-12", "2026-01-17"]])
  }),
  elena: Object.freeze({
    weeklyDayOff: 2,
    leaveRanges: Object.freeze([["2025-08-18", "2025-08-23"], ["2026-03-09", "2026-03-14"]])
  }),
  marta: Object.freeze({
    weeklyDayOff: 3,
    leaveRanges: Object.freeze([["2025-07-14", "2025-07-19"], ["2026-02-16", "2026-02-21"]])
  }),
  giulia: Object.freeze({
    weeklyDayOff: 4,
    leaveRanges: Object.freeze([["2025-09-01", "2025-09-06"], ["2026-04-13", "2026-04-18"]])
  })
});

const COLLECTION_NAMES = Object.freeze([
  "clients",
  "appointments",
  "services",
  "staff",
  "shifts",
  "shift_templates",
  "resources",
  "inventory",
  "inventory_movements",
  "payments",
  "cash_closures",
  "treatments",
  "protocols",
  "ai_marketing_actions",
  "dashboard_snapshots",
  "gold_state",
  "gold_decision_history",
  "gold_action_outcomes",
  "gold_imports",
  "whatsapp_messages",
  "client_recall_profiles",
  "users",
  "sales",
  "settings"
]);

const REPOSITORY_PROPERTIES = Object.freeze({
  clients: "clientsRepository",
  appointments: "appointmentsRepository",
  services: "servicesRepository",
  staff: "staffRepository",
  shifts: "shiftsRepository",
  shift_templates: "shiftTemplatesRepository",
  resources: "resourcesRepository",
  inventory: "inventoryRepository",
  inventory_movements: "inventoryMovementsRepository",
  payments: "paymentsRepository",
  cash_closures: "cashClosuresRepository",
  treatments: "treatmentsRepository",
  protocols: "protocolsRepository",
  ai_marketing_actions: "aiMarketingActionsRepository",
  dashboard_snapshots: "dashboardSnapshotsRepository",
  gold_state: "goldStateRepository",
  gold_decision_history: "goldDecisionHistoryRepository",
  gold_action_outcomes: "goldActionOutcomesRepository",
  gold_imports: "goldImportRepository",
  whatsapp_messages: "whatsappMessagesRepository",
  client_recall_profiles: "clientRecallProfilesRepository",
  users: "usersRepository",
  sales: "salesRepository",
  settings: "settingsRepository"
});

const PRICE_SOURCES = Object.freeze({
  revlonOfficial: {
    label: "Revlon Professional FAQ - prezzi professionali riservati",
    url: "https://www.revlonprofessional.com/it/domande-frequenti/",
    accessedAt: "2026-07-26",
    note: "Il listino wholesale ufficiale non e pubblico. I costi sotto sono acquisti spot pubblici osservati, non condizioni B2B contrattuali."
  },
  revlonKosmoOriginal: {
    label: "Kosmo Bellezza - UniqOne Original 150 ml",
    url: "https://www.kosmobellezza.it/home/4441-revlon-uniq-one-rosso-trattamento-10-benefici.html",
    accessedAt: "2026-07-26"
  },
  revlonKosmoCoconut: {
    label: "Kosmo Bellezza - UniqOne Coconut 150 ml",
    url: "https://www.kosmobellezza.it/home/4706-revlon-uniq-one-trattamento-riparatore-10-in-1-cocco-150-ml-.html",
    accessedAt: "2026-07-26"
  },
  revlonDouglas: {
    label: "Douglas Italia - Revlon Professional UniqOne",
    url: "https://www.douglas.it/it/b/revlon-professional/uniqone/b036306",
    accessedAt: "2026-07-26"
  },
  revlonNlb: {
    label: "NLB - Revlonissimo Colorsmetique e Color Sublime",
    url: "https://www.nlb.bz.it/it/catalogo-articoli/marchi/revlon",
    accessedAt: "2026-07-26"
  },
  revlonBellaffairOrofluido: {
    label: "BellAffair - Revlon Professional Orofluido",
    url: "https://www.bellaffair.it/revlon-professional/orofluido",
    accessedAt: "2026-07-26"
  },
  revlonBellaffairUniqone: {
    label: "BellAffair - Revlon Professional UniqOne",
    url: "https://www.bellaffair.it/revlon-professional/uniqone",
    accessedAt: "2026-07-26"
  },
  hairDyesign: {
    label: "DyeSign Salon - listino 2026",
    url: "https://www.dyesignsalon.it/wp-content/uploads/2026/02/Listino-Prezzi-Web.pdf",
    accessedAt: "2026-07-26"
  },
  hairOrazioAnelli: {
    label: "Orazio Anelli - listino 2026",
    url: "https://orazioanelli.it/wp-content/uploads/LISTINO-OA_NEW-2026.pdf",
    accessedAt: "2026-07-26"
  },
  comfortZoneTreatments: {
    label: "Comfort Zone - trattamenti professionali",
    url: "https://it.comfortzoneskin.com/pages/professional-treatments",
    accessedAt: "2026-07-26"
  },
  comfortZoneSalon: {
    label: "Estetica Elisir Desenzano - listino prenotazione Comfort Zone",
    url: "https://elisirdesenzanobooking.beautycheck.it/booking/prenotaPerGiorno.aspx",
    accessedAt: "2026-07-26"
  },
  beautyAmaelle: {
    label: "Centro Estetico Amaelle Milano - listino trattamenti",
    url: "https://www.amaelle.it/listino-trattamenti/",
    accessedAt: "2026-07-26"
  },
  techM17: {
    label: "4DermaShop - analizzatore pelle e capelli M17",
    url: "https://4dermashop.com/products/analizzatore-diagnostico-pelle-e-capelli",
    accessedAt: "2026-07-26"
  },
  techPressotherapy: {
    label: "meeBy - Drena-Pro S612",
    url: "https://www.meeby.it/prodotto/pressoterapia-professionale-massaggio-e-drenaggio-linfatico/",
    accessedAt: "2026-07-26"
  },
  techRadiofrequency: {
    label: "meeBy - OMIA reShapingFIX",
    url: "https://www.meeby.it/prodotto/radiofrequenza-viso-e-corpo-capacitiva-monopolare-resistiva-bipolare-multipolare-frazionata-trattamenti-studio-estetica/",
    accessedAt: "2026-07-26"
  },
  rentBenchmark: {
    label: "Idealista - negozi in affitto Bologna, benchmark pubblico",
    url: "https://www.idealista.it/affitto-negozi/bologna-bologna/con-negozio/",
    accessedAt: "2026-07-26"
  },
  accountantBenchmark: {
    label: "TaxMan - confronto commercialisti online SRL 2026",
    url: "https://www.taxmanapp.it/blog-srl/2026/04/29/i-migliori-commercialisti-online-per-srl-in-italia-2026/",
    accessedAt: "2026-07-26"
  },
  softwareBenchmark: {
    label: "Trimm - piano Pro salone 2026",
    url: "https://www.trimm.app/",
    accessedAt: "2026-07-26"
  }
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, Object.create(null));
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertInvariant(condition, message, code = "gold_seed_invariant_failed") {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizedRole(user = {}) {
  return String(user.role || "").trim().toLowerCase();
}

function normalizedCenterId(value = "") {
  return String(value || "").trim();
}

function assertSafeTargetCenterId(centerId = "") {
  const value = normalizedCenterId(centerId);
  assertInvariant(Boolean(value), "centerId target obbligatorio", "gold_seed_invalid_target");
  assertInvariant(value !== "center_admin", "center_admin non puo essere usato come tenant demo", "gold_seed_invalid_target");
  assertInvariant(value !== GLOBAL_LIBRARY_CENTER_ID, "La libreria globale non puo essere usata come tenant demo", "gold_seed_invalid_target");
  assertInvariant(!["__proto__", "prototype", "constructor"].includes(value.toLowerCase()), "centerId target non sicuro", "gold_seed_invalid_target");
  assertInvariant(/^[a-zA-Z0-9._:-]{3,120}$/.test(value), "centerId target contiene caratteri non ammessi", "gold_seed_invalid_target");
  return value;
}

function assertSafeTargetCenterName(centerName = "") {
  const value = String(centerName || "").normalize("NFC").trim();
  assertInvariant(value.length >= 3 && value.length <= 120, "Nome centro target non valido", "gold_seed_invalid_target_name");
  assertInvariant(!/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value), "Nome centro target contiene caratteri non ammessi", "gold_seed_invalid_target_name");
  return value;
}

function allocateInteger(total, weights = []) {
  const sum = weights.reduce((acc, value) => acc + Number(value || 0), 0);
  assertInvariant(Number.isSafeInteger(total) && total >= 0, "Totale da allocare non valido");
  assertInvariant(sum > 0, "Pesi allocazione non validi");
  const raw = weights.map((weight) => (total * Number(weight || 0)) / sum);
  const allocated = raw.map(Math.floor);
  let remaining = total - allocated.reduce((acc, value) => acc + value, 0);
  raw
    .map((value, index) => ({ index, remainder: value - allocated[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .slice(0, remaining)
    .forEach(({ index }) => {
      allocated[index] += 1;
      remaining -= 1;
    });
  assertInvariant(remaining === 0, "Allocazione intera non riconciliata");
  return allocated;
}

function balancedLabels(totals = {}) {
  const entries = Object.entries(totals);
  const total = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const used = Object.fromEntries(entries.map(([key]) => [key, 0]));
  const labels = [];
  for (let index = 0; index < total; index += 1) {
    const selected = entries
      .map(([key, count]) => ({
        key,
        deficit: (((index + 1) * Number(count || 0)) / total) - used[key]
      }))
      .filter(({ key }) => used[key] < Number(totals[key] || 0))
      .sort((left, right) => right.deficit - left.deficit || left.key.localeCompare(right.key))[0];
    assertInvariant(Boolean(selected), "Sequenza bilanciata non costruibile");
    labels.push(selected.key);
    used[selected.key] += 1;
  }
  return labels;
}

function monthRevenueTargets() {
  return [
    ...allocateInteger(FIRST_YEAR_REVENUE_CENTS, MONTHLY_CHECKOUTS.slice(0, 12)),
    ...allocateInteger(SECOND_PERIOD_REVENUE_CENTS, MONTHLY_CHECKOUTS.slice(12))
  ];
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function isCanonicalIsoTimestamp(value = "") {
  const raw = String(value || "");
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === raw;
}

function businessDays(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const rows = [];
  const cursor = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  while (cursor.getUTCMonth() === month - 1) {
    const date = dateOnly(cursor);
    if (cursor.getUTCDay() !== 0 && !CLOSED_DATES.has(date)) rows.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

function staffKey(staff = {}) {
  return String(staff.id || "").replace(/^gold18m_staff_/, "");
}

function dateInRange(date = "", range = []) {
  return Array.isArray(range) && range.length === 2 && date >= range[0] && date <= range[1];
}

function staffAvailabilityOnDate(staff = {}, date = "") {
  const policy = STAFF_AVAILABILITY[staffKey(staff)];
  if (!policy) return { available: true, reason: "working" };
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  if (day === Number(policy.weeklyDayOff)) return { available: false, reason: "weekly_day_off" };
  if (policy.leaveRanges.some((range) => dateInRange(date, range))) return { available: false, reason: "planned_leave" };
  return { available: true, reason: "working" };
}

function staffWorkingWindow(staff = {}) {
  const earlyShift = ["arianna", "marta"].includes(staffKey(staff));
  return earlyShift
    ? { startTime: "08:00", endTime: "17:30", startMinute: 8 * 60, endMinute: 17 * 60 + 30 }
    : { startTime: "09:00", endTime: "19:30", startMinute: 9 * 60, endMinute: 19 * 60 + 30 };
}

function addMinutesIso(value, minutes) {
  const date = new Date(value);
  date.setUTCMinutes(date.getUTCMinutes() + Number(minutes || 0));
  return date.toISOString();
}

function clientVisitTargets(clients = []) {
  const targets = [];
  let cursor = 0;
  CLIENT_VISIT_COUNT_DISTRIBUTION.forEach((group) => {
    for (let index = 0; index < group.clients; index += 1) {
      const client = clients[cursor];
      assertInvariant(Boolean(client), "Distribuzione visite eccede i clienti disponibili");
      targets.push({
        client,
        visits: group.visits,
        segment: group.segment,
        clientIndex: cursor
      });
      cursor += 1;
    }
  });
  assertInvariant(cursor === clients.length, "Distribuzione visite non copre tutti i clienti");
  assertInvariant(
    targets.reduce((sum, item) => sum + item.visits, 0) === TOTAL_CHECKOUTS,
    "Distribuzione visite non riconcilia i checkout"
  );
  return targets;
}

function clientCheckoutSequence(clients = []) {
  const slots = [];
  clientVisitTargets(clients).forEach((target) => {
    if (!target.visits) return;
    const phase = ((target.clientIndex * 73) % 997) / 997;
    for (let visit = 0; visit < target.visits; visit += 1) {
      slots.push({
        client: target.client,
        score: ((visit + phase) / target.visits) % 1,
        tie: (target.clientIndex * 131 + visit * 17) % 10007
      });
    }
  });
  slots.sort((left, right) =>
    left.score - right.score
    || left.tie - right.tie
    || String(left.client.id || "").localeCompare(String(right.client.id || ""))
  );
  assertInvariant(slots.length === TOTAL_CHECKOUTS, "Sequenza clienti non riconcilia i checkout");
  return slots.map((slot) => slot.client);
}

function inventoryTemplates(centerId, centerName) {
  const rows = [
    {
      id: "uniqone_original_150",
      name: "Revlon UniqOne Original Hair Treatment 150 ml",
      sku: "RV-UNIQ-ORIG-150",
      costCents: 720,
      salePriceCents: 2709,
      sourceKeys: ["revlonKosmoOriginal", "revlonDouglas"],
      usageType: "rivendita"
    },
    {
      id: "uniqone_coconut_150",
      name: "Revlon UniqOne Coconut Hair Treatment 150 ml",
      sku: "RV-UNIQ-COCO-150",
      costCents: 999,
      salePriceCents: 1999,
      sourceKeys: ["revlonKosmoCoconut", "revlonDouglas"],
      usageType: "rivendita"
    },
    {
      id: "revlonissimo_colorsmetique_60",
      name: "Revlonissimo Colorsmetique 60 ml",
      sku: "RV-COLORSM-060",
      costCents: 917,
      salePriceCents: 1410,
      sourceKeys: ["revlonNlb"],
      usageType: "cabina"
    },
    {
      id: "revlonissimo_color_sublime_75",
      name: "Revlonissimo Color Sublime 75 ml",
      sku: "RV-COLSUB-075",
      costCents: 949,
      salePriceCents: 1460,
      sourceKeys: ["revlonNlb"],
      usageType: "cabina"
    },
    {
      id: "orofluido_elixir_30",
      name: "Revlon Orofluido Argan Oil Elixir 30 ml",
      sku: "RV-ORO-ELIX-030",
      costCents: 995,
      salePriceCents: 1280,
      sourceKeys: ["revlonBellaffairOrofluido"],
      usageType: "rivendita"
    },
    {
      id: "orofluido_shampoo_240",
      name: "Revlon Orofluido Shampoo 240 ml",
      sku: "RV-ORO-SHAM-240",
      costCents: 1565,
      salePriceCents: 2920,
      sourceKeys: ["revlonBellaffairOrofluido"],
      usageType: "rivendita"
    },
    {
      id: "orofluido_conditioner_240",
      name: "Revlon Orofluido Conditioner 240 ml",
      sku: "RV-ORO-COND-240",
      costCents: 1645,
      salePriceCents: 3060,
      sourceKeys: ["revlonBellaffairOrofluido"],
      usageType: "rivendita"
    },
    {
      id: "orofluido_mask_250",
      name: "Revlon Orofluido Mask 250 ml",
      sku: "RV-ORO-MASK-250",
      costCents: 1895,
      salePriceCents: 3380,
      sourceKeys: ["revlonBellaffairOrofluido"],
      usageType: "rivendita"
    },
    {
      id: "uniqone_mask_300",
      name: "Revlon UniqOne Mask 300 ml",
      sku: "RV-UNIQ-MASK-300",
      costCents: 2015,
      salePriceCents: 2900,
      sourceKeys: ["revlonBellaffairUniqone"],
      usageType: "rivendita"
    },
    {
      id: "uniqone_shampoo_490",
      name: "Revlon UniqOne Shampoo 490 ml",
      sku: "RV-UNIQ-SHAM-490",
      costCents: 2055,
      salePriceCents: 3300,
      sourceKeys: ["revlonBellaffairUniqone"],
      usageType: "rivendita"
    }
  ];
  return rows.map((item) => ({
    id: `gold18m_inventory_${item.id}`,
    idempotencyKey: `${DATASET_VERSION}:inventory:${item.id}`,
    centerId,
    centerName,
    name: item.name,
    sku: item.sku,
    openingQuantity: item.usageType === "rivendita" ? 20 : 12,
    quantity: item.usageType === "rivendita" ? 30 : 20,
    stockQuantity: item.usageType === "rivendita" ? 30 : 20,
    minQuantity: item.usageType === "rivendita" ? 8 : 5,
    thresholdQuantity: item.usageType === "rivendita" ? 8 : 5,
    costCents: item.costCents,
    unitCostCents: item.costCents,
    purchaseCostCents: item.costCents,
    salePriceCents: item.salePriceCents,
    retailPriceCents: item.salePriceCents,
    category: item.usageType === "rivendita" ? "Revlon Professional retail" : "Revlon Professional tecnico",
    supplier: "Revlon Professional - acquisto spot pubblico osservato",
    unit: "pz",
    usageType: item.usageType,
    stockAccounting: {
      model: "historical_movement_reconciliation",
      openingBalanceAt: "2025-01-01T06:30:00.000Z",
      openingQuantity: item.usageType === "rivendita" ? 20 : 12,
      targetClosingQuantity: item.usageType === "rivendita" ? 30 : 20
    },
    priceEvidence: {
      costType: "observed_public_spot_purchase_gross",
      sellType: "observed_public_reference_gross",
      officialWholesale: false,
      sourceKeys: item.sourceKeys,
      accessedAt: "2026-07-26"
    },
    datasetVersion: DATASET_VERSION,
    createdAt: DATASET_CREATED_AT,
    updatedAt: DATASET_CREATED_AT
  }));
}

function resourceTemplates(centerId, centerName) {
  const templates = [
    {
      id: "m17",
      name: "Analizzatore AI pelle e capelli M17",
      totalCostCents: 169000,
      durationMonths: 36,
      estimatedMonthlyUses: 10,
      sourceKey: "techM17",
      taxStatus: "not_explicit_on_public_page"
    },
    {
      id: "drena_pro_s612",
      name: "Pressoterapia meeBy Drena-Pro S612",
      totalCostCents: 179000,
      durationMonths: 48,
      estimatedMonthlyUses: 5,
      sourceKey: "techPressotherapy",
      taxStatus: "vat_included"
    },
    {
      id: "omia_reshapingfix",
      name: "Radiofrequenza OMIA reShapingFIX viso/corpo",
      totalCostCents: 653700,
      durationMonths: 60,
      estimatedMonthlyUses: 5,
      sourceKey: "techRadiofrequency",
      taxStatus: "vat_included"
    }
  ];
  return templates.map((item) => {
    const monthlyCostCents = Math.round(item.totalCostCents / item.durationMonths);
    return {
      id: `gold18m_resource_${item.id}`,
      idempotencyKey: `${DATASET_VERSION}:resource:${item.id}`,
      centerId,
      centerName,
      name: item.name,
      type: "technology",
      totalCostCents: item.totalCostCents,
      durationMonths: item.durationMonths,
      installmentStartDate: "2025-01-01",
      installmentEndDate: new Date(Date.UTC(2025, item.durationMonths, 1)).toISOString().slice(0, 10),
      elapsedInstallmentMonths: 18,
      remainingInstallmentMonths: Math.max(0, item.durationMonths - 18),
      baseMonthlyCostCents: monthlyCostCents,
      estimatedMonthlyUses: item.estimatedMonthlyUses,
      monthlyCostCents,
      costPerUseCents: Math.round(monthlyCostCents / item.estimatedMonthlyUses),
      active: true,
      priceEvidence: {
        type: "observed_public_sell_price",
        sourceKey: item.sourceKey,
        taxStatus: item.taxStatus,
        accessedAt: "2026-07-26",
        financingTermsObserved: false,
        monthlyCostModel: "synthetic_straight_line_amortization",
        usageCostModel: "synthetic_estimated_monthly_uses"
      },
      datasetVersion: DATASET_VERSION,
      createdAt: DATASET_CREATED_AT,
      updatedAt: DATASET_CREATED_AT
    };
  });
}

function staffTemplates(centerId, centerName) {
  return [
    ["arianna", "Arianna Demo", "Hair director", "#7b61ff", 1550, 180000, ["hair"]],
    ["elena", "Elena Demo", "Hair stylist e colorist", "#26a69a", 1375, 160000, ["hair"]],
    ["marta", "Marta Demo", "Beauty specialist", "#ec407a", 1375, 160000, ["beauty", "technology"]],
    ["giulia", "Giulia Demo", "Beauty tech e retail", "#ffb300", 1375, 160000, ["beauty", "technology"]]
  ].map(([key, name, role, colorTag, hourlyCostCents, grossSalaryCents, serviceCategories]) => {
    const availability = STAFF_AVAILABILITY[key];
    return {
      id: `gold18m_staff_${key}`,
      idempotencyKey: `${DATASET_VERSION}:staff:${key}`,
      centerId,
      centerName,
      name,
      role,
      colorTag,
      hourlyCostCents,
      grossSalaryCents,
      serviceCategories,
      weeklyDayOff: availability.weeklyDayOff,
      plannedAbsences: availability.leaveRanges.map(([startDate, endDate]) => ({
        type: "planned_leave",
        startDate,
        endDate,
        synthetic: true
      })),
      payrollEvidence: {
        type: "synthetic_operating_assumption",
        note: "Retribuzione lorda mensile dimostrativa, non dato personale reale."
      },
      email: `${key}@staff.example.invalid`,
      phone: "",
      active: 1,
      datasetVersion: DATASET_VERSION,
      createdAt: DATASET_CREATED_AT,
      updatedAt: DATASET_CREATED_AT
    };
  });
}

function serviceTemplates(centerId, centerName, inventory, resources) {
  const productByKey = new Map(inventory.map((item) => [item.id.replace("gold18m_inventory_", ""), item]));
  const resourceByKey = new Map(resources.map((item) => [item.id.replace("gold18m_resource_", ""), item]));
  const templates = [
    ["piega_revlon", "Piega Revlon", "hair", 45, 45, 300, "hairDyesign", "orofluido_shampoo_240", 0.191693, "", 0, 20, "observed_exact"],
    ["piega_gloss", "Piega Gloss", "hair", 50, 45, 380, "hairOrazioAnelli", "orofluido_mask_250", 0.200528, "", 0, 10, "observed_exact"],
    ["taglio_art_director", "Taglio Art Director (piega esclusa)", "hair", 50, 50, 450, "hairDyesign", "orofluido_conditioner_240", 0.273556, "", 0, 8, "observed_exact"],
    ["color_care", "Color&Care", "hair", 110, 95, 1250, "hairOrazioAnelli", "revlonissimo_colorsmetique_60", 1.363141, "", 0, 3, "observed_exact"],
    ["tonalizzante", "Tonalizzante (a partire da)", "hair", 45, 15, 700, "hairOrazioAnelli", "revlonissimo_color_sublime_75", 0.737619, "", 0, 15, "observed_exact"],
    ["glow_go", "Glow&Go (a partire da)", "hair", 180, 135, 2600, "hairOrazioAnelli", "revlonissimo_color_sublime_75", 2.739726, "", 0, 1, "observed_exact"],
    ["platinum_color", "Platinum Color (a partire da)", "hair", 210, 175, 3200, "hairOrazioAnelli", "revlonissimo_colorsmetique_60", 3.489640, "", 0, 1, "observed_exact"],
    ["extreme_gloss", "Extreme Gloss", "hair", 60, 60, 850, "hairOrazioAnelli", "orofluido_elixir_30", 0.854271, "", 0, 2, "observed_exact"],
    ["ricostruzione_molecolare", "Ricostruzione Molecolare (styling escluso)", "hair", 45, 35, 750, "hairDyesign", "uniqone_mask_300", 0.372208, "", 0, 8, "observed_exact"],
    ["skin_test_m17", "Skin Test 2.0", "technology", 30, 40, 250, "comfortZoneSalon", "", 0, "m17", 1, 6, "observed_exact"],
    ["hydramemory", "Comfort Zone Hydramemory 4.0", "beauty", 50, 86, 1300, "comfortZoneSalon", "", 0, "", 0, 4, "observed_exact"],
    ["pulizia_viso", "Comfort Zone Pulizia viso", "beauty", 50, 77, 1150, "comfortZoneSalon", "", 0, "", 0, 10, "observed_exact"],
    ["remedy", "Comfort Zone Remedy Giada Complex", "beauty", 50, 91, 1450, "comfortZoneSalon", "", 0, "", 0, 2, "observed_exact"],
    ["skin_regimen_detox", "Skin Regimen Lx Longevity Detox", "beauty", 50, 88, 1400, "comfortZoneSalon", "", 0, "", 0, 2, "observed_exact"],
    ["pro_collagen", "Skin Regimen Lx Pro Collagen", "beauty", 60, 130, 2100, "comfortZoneSalon", "", 0, "", 0, 1, "observed_exact"],
    ["tranquillity", "Comfort Zone Tranquillity Ritual", "beauty", 60, 90, 1500, "comfortZoneSalon", "", 0, "", 0, 2, "observed_exact"],
    ["pressoterapia", "Pressoterapia", "technology", 50, 70, 550, "beautyAmaelle", "", 0, "drena_pro_s612", 1, 3, "observed_exact"],
    ["radiofrequenza", "Radiofrequenza viso", "technology", 50, 80, 800, "beautyAmaelle", "", 0, "omia_reshapingfix", 1, 3, "observed_exact"]
  ];
  return templates.map(([key, name, category, durationMin, priceEuro, estimatedProductCostCents, sourceKey, productKey, usageUnits, technologyKey, technologyUnits, weight, evidenceType]) => {
    const product = productByKey.get(productKey);
    const resource = resourceByKey.get(technologyKey);
    const linkedProductCostCents = product
      ? Math.round(Number(product.unitCostCents || product.costCents || 0) * Number(usageUnits || 0))
      : Number(estimatedProductCostCents || 0);
    return {
      id: `gold18m_service_${key}`,
      idempotencyKey: `${DATASET_VERSION}:service:${key}`,
      centerId,
      centerName,
      name,
      category,
      durationMin,
      priceCents: Math.round(priceEuro * 100),
      estimatedProductCostCents: linkedProductCostCents,
      technologyCostCents: resource ? Number(resource.costPerUseCents || 0) : 0,
      productLinks: product ? [{
        productId: product.id,
        usageUnits,
        unitCostCents: Number(product.unitCostCents || product.costCents || 0)
      }] : [],
      technologyLinks: resource ? [{ technologyId: resource.id, usageUnits: technologyUnits }] : [],
      active: true,
      priceEvidence: {
        type: evidenceType,
        sourceKey,
        observedPriceCents: Math.round(priceEuro * 100),
        taxStatus: "public_consumer_price_as_displayed",
        accessedAt: "2026-07-26"
      },
      costEvidence: {
        productCostModel: "synthetic_service_consumption_assumption",
        declaredProductCostCents: linkedProductCostCents,
        linkedProductCostReconciled: true,
        technologyCostModel: resource ? "synthetic_amortization_per_use_assumption" : "not_applicable",
        technologyBinding: resource ? "synthetic_operational_mapping_to_observed_public_equipment" : "not_applicable"
      },
      selectionWeight: weight,
      datasetVersion: DATASET_VERSION,
      createdAt: DATASET_CREATED_AT,
      updatedAt: DATASET_CREATED_AT
    };
  });
}

function clientTemplates(centerId, centerName, count = 1100) {
  const firstNames = [
    "Adele", "Alice", "Anna", "Beatrice", "Camilla", "Carla", "Chiara", "Claudia",
    "Elena", "Elisa", "Federica", "Francesca", "Giada", "Giulia", "Ilaria", "Irene",
    "Laura", "Lucia", "Marta", "Martina", "Monica", "Noemi", "Paola", "Sara",
    "Silvia", "Sofia", "Valentina", "Veronica"
  ];
  const lastNames = [
    "Rossi", "Bianchi", "Romano", "Gallo", "Costa", "Fontana", "Conti", "Esposito",
    "Ricci", "Marino", "Greco", "Bruno", "Ferrari", "Lombardi", "Moretti", "Barbieri"
  ];
  return Array.from({ length: count }, (_, index) => {
    const sequence = String(index + 1).padStart(4, "0");
    const firstName = firstNames[index % firstNames.length];
    const lastName = `${lastNames[(index * 7) % lastNames.length]} Demo ${sequence}`;
    const marketingConsent = index % 10 !== 0;
    return {
      id: `gold18m_client_${sequence}`,
      idempotencyKey: `${DATASET_VERSION}:client:${sequence}`,
      centerId,
      centerName,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      phone: `+3900000${sequence}`,
      email: `cliente.${sequence}@example.invalid`,
      birthDate: "",
      notes: "Profilo sintetico per tenant dimostrativo Gold; nessun dato personale reale.",
      allergies: "",
      preferences: [],
      packages: [],
      privacyConsent: true,
      marketingConsent,
      sensitiveDataConsent: false,
      privacyConsentAt: "2025-01-02T09:00:00.000Z",
      marketingConsentAt: marketingConsent ? "2025-01-02T09:00:00.000Z" : "",
      sensitiveDataConsentAt: "",
      consentSource: "synthetic_demo_gold_18m",
      totalValue: 0,
      loyaltyTier: "base",
      lastVisit: "",
      synthetic: true,
      datasetVersion: DATASET_VERSION,
      createdAt: "2025-01-02T09:00:00.000Z",
      updatedAt: DATASET_CREATED_AT
    };
  });
}

function shiftTemplates(centerId, centerName, staff) {
  return staff.map((operator, index) => ({
    id: `gold18m_shift_template_${index + 1}`,
    idempotencyKey: `${DATASET_VERSION}:shift-template:${index + 1}`,
    centerId,
    centerName,
    name: `${operator.name} - settimana standard`,
    staffId: operator.id,
    week: [1, 2, 3, 4, 5, 6]
      .filter((day) => day !== Number(operator.weeklyDayOff))
      .map((day) => ({
      day,
      startTime: "08:00",
      endTime: day === 6 ? "18:30" : "19:30"
      })),
    weeklyDayOff: Number(operator.weeklyDayOff),
    plannedAbsences: clone(operator.plannedAbsences || []),
    datasetVersion: DATASET_VERSION,
    createdAt: DATASET_CREATED_AT,
    updatedAt: DATASET_CREATED_AT
  }));
}

function protocolTemplates(centerId, centerName, clients) {
  return clients.slice(0, 60).map((client, index) => ({
    id: `gold18m_protocol_${String(index + 1).padStart(3, "0")}`,
    idempotencyKey: `${DATASET_VERSION}:protocol:${index + 1}`,
    centerId,
    centerName,
    clientId: client.id,
    clientName: client.name,
    title: index % 3 === 0
      ? "Percorso mantenimento colore Revlon"
      : index % 3 === 1
        ? "Percorso Comfort Zone idratazione e continuita"
        : "Percorso tecnologia corpo progressivo",
    objective: "Continuita operativa, controllo dei costi e verifica della risposta riportata dal cliente.",
    area: index % 3 === 0 ? "hair" : index % 3 === 1 ? "face" : "body",
    libraryScope: "center",
    targetArea: index % 3 === 0 ? "capelli" : index % 3 === 1 ? "viso" : "corpo",
    needType: "mantenimento",
    caseIntensity: "moderata",
    sessionsCount: index % 3 === 2 ? 6 : 4,
    frequency: "Cadenza da verificare dall'operatore in base allo storico.",
    technologies: index % 3 === 2 ? "Drena-Pro oppure OMIA solo dopo valutazione operatore." : "",
    products: index % 3 === 0 ? "Revlon Professional, selezione coerente con il servizio." : "Comfort Zone, selezione professionale del centro.",
    steps: "1. Verifica scheda e consenso. 2. Conferma obiettivo. 3. Esegui solo il servizio approvato. 4. Registra risposta e costi.",
    clientCommunication: "Percorso graduale senza promessa di risultato.",
    avoidClaims: "Nessun risultato garantito. Nessun linguaggio medico o terapeutico.",
    operatorNotes: "Dataset sintetico: conferma sempre con il cliente e con il responsabile.",
    limitations: "Protocollo operativo non medico. Nessuna diagnosi o promessa terapeutica.",
    source: "synthetic_gold_18m_operator_reviewed",
    status: "active",
    datasetVersion: DATASET_VERSION,
    createdAt: "2025-01-05T09:00:00.000Z",
    updatedAt: DATASET_CREATED_AT
  }));
}

function fixedCostProfile() {
  return {
    fiscalRegime: "ordinary_vat",
    businessType: "hybrid",
    vatRate: 22,
    workingDaysMonthly: 26,
    operatingHoursDaily: 10,
    rent: 2200,
    utilitiesPower: 420,
    utilitiesWaterGas: 140,
    accountant: 199,
    insurance: 100,
    software: 62.5,
    marketing: 450,
    leasing: 0,
    cleaningLaundry: 300,
    bankPosFees: 220,
    payrollOwner: 1800,
    ownerIncludedInStaff: false,
    ownerCompensationModel: "separate_fixed_monthly_compensation",
    taxesContributionsReserve: 1200,
    otherFixedCosts: 250,
    evidence: {
      rent: { type: "observed_public_single_listing", sourceKey: "rentBenchmark" },
      accountant: { type: "vendor_reported_public_list_price", sourceKey: "accountantBenchmark" },
      software: { type: "public_list_price", sourceKey: "softwareBenchmark" },
      utilitiesPower: { type: "synthetic_operating_assumption" },
      utilitiesWaterGas: { type: "synthetic_operating_assumption" },
      insurance: { type: "synthetic_operating_assumption" },
      marketing: { type: "synthetic_operating_assumption" },
      cleaningLaundry: { type: "synthetic_operating_assumption" },
      bankPosFees: { type: "synthetic_operating_assumption" },
      payrollOwner: { type: "synthetic_operating_assumption" },
      taxesContributionsReserve: { type: "synthetic_operating_assumption" },
      otherFixedCosts: { type: "synthetic_operating_assumption" }
    },
    note: "Valori dimostrativi realistici. I quattro dipendenti sono separati dal compenso titolare; il compenso titolare va contato una sola volta nei costi fissi. Il margine diretto per servizio e il baseline payroll mensile sono due lenti alternative e non vanno sommati due volte. Solo le voci con fonte pubblica sono benchmark osservati; le altre sono assunzioni sintetiche e non contabilita reale."
  };
}

function centerSettings(centerId, centerName) {
  return {
    centerId,
    centerName,
    centerType: "Hair & Beauty Technology Center",
    centerLegalName: "Atelier Aurora Demo S.r.l. (dati sintetici)",
    centerVatNumber: "",
    centerTaxCode: "",
    centerEmail: "atelier.aurora@example.invalid",
    centerPhone: "+390000000000",
    centerAddress: "Area commerciale dimostrativa - indirizzo non reale",
    centerCity: "Bologna",
    centerProvince: "BO",
    centerPostalCode: "00000",
    businessModel: "hybrid_beauty_hair",
    agendaStartHour: "08:00",
    agendaEndHour: "20:00",
    agendaSlotMinutes: "30",
    agendaSoundEnabled: true,
    agendaPageFlipEnabled: false,
    defaultView: "week",
    fullscreenAgenda: true,
    enableMarketing: true,
    enableTreatments: true,
    enableCashdesk: true,
    enableProtocolsHub: true,
    enableTrainingHub: true,
    enableMultiLocation: false,
    aiMode: "hybrid_governed",
    aiActionsEnabled: true,
    shiftsBaseEnabled: true,
    shiftsTemplatesEnabled: true,
    shiftsClockEnabled: true,
    shiftsReportsEnabled: true,
    shiftsFlexEnabled: true,
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
    whatsappGoldMode: "manual",
    whatsappBusinessPhone: "",
    whatsappActivationRequestedAt: "",
    whatsappCenterNumberConfirmed: false,
    whatsappCustomerConsentConfirmed: false,
    whatsappMonthlyQuota: 100,
    whatsappMonthlyUsed: 0,
    whatsappMode: "manual_copy",
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
    whatsappTwilioLastTestMessage: "",
    goldFixedCostProfile: fixedCostProfile(),
    goldDatasetManifest: {
      datasetVersion: DATASET_VERSION,
      syntheticCustomers: true,
      periodStart: "2025-01-01",
      periodEnd: "2026-06-30",
      priceSources: PRICE_SOURCES,
      localDesignReferences: [
        "SMARTDESK_CHECKOUT_PAYMENT_GUARD_2026-05-25.md",
        "SMARTDESK_RENDER_GOLD_COCKPIT_V1_2026-05-19.md",
        "nyra_smartdesk_gold_product_audit_latest.json"
      ]
    },
    updatedAt: DATASET_CREATED_AT
  };
}

function serviceCycle(services, category) {
  return services
    .filter((item) => item.category === category)
    .flatMap((item) => Array.from({ length: Math.max(1, Number(item.selectionWeight || 1)) }, () => item));
}

function createAppointmentScheduler(staff = [], resources = []) {
  const staffNextMinute = new Map();
  const resourceNextMinute = new Map();
  const clientDates = new Set();
  const poolCursor = new Map();
  const resourceIds = new Set(resources.map((item) => String(item.id || "")));
  const turnaroundMinute = 10;

  function qualifiedCandidates(monthKey, service) {
    const qualified = staff.filter((operator) =>
      Array.isArray(operator.serviceCategories)
      && operator.serviceCategories.includes(service.category)
    );
    assertInvariant(qualified.length > 0, `Nessun operatore qualificato per ${service.category}`);
    const candidates = businessDays(monthKey)
      .flatMap((date) => qualified
        .filter((operator) => staffAvailabilityOnDate(operator, date).available)
        .map((operator) => ({ date, operator })));
    assertInvariant(candidates.length > 0, `Nessuna disponibilita operatore per ${service.category} in ${monthKey}`);
    return candidates;
  }

  function reserve(monthKey, service, resource = null, clientId = "") {
    if (resource) {
      assertInvariant(resourceIds.has(String(resource.id || "")), `Risorsa sconosciuta per ${service.name}`);
    }
    const candidates = qualifiedCandidates(monthKey, service);
    const poolKey = `${monthKey}:${service.category === "hair" ? "hair" : "beauty_technology"}`;
    const startIndex = Number(poolCursor.get(poolKey) || 0) % candidates.length;
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const candidateIndex = (startIndex + offset) % candidates.length;
      const candidate = candidates[candidateIndex];
      const workingWindow = staffWorkingWindow(candidate.operator);
      const clientDateKey = clientId ? `${clientId}:${candidate.date}` : "";
      if (clientDateKey && clientDates.has(clientDateKey)) continue;
      const staffKey = `${candidate.operator.id}:${candidate.date}`;
      const resourceKey = resource ? `${resource.id}:${candidate.date}` : "";
      const startMinute = Math.max(
        workingWindow.startMinute,
        Number(staffNextMinute.get(staffKey) || workingWindow.startMinute),
        resourceKey ? Number(resourceNextMinute.get(resourceKey) || workingWindow.startMinute) : workingWindow.startMinute
      );
      const endMinute = startMinute + Number(service.durationMin || 0);
      if (endMinute > workingWindow.endMinute) continue;
      staffNextMinute.set(staffKey, endMinute + turnaroundMinute);
      if (resourceKey) resourceNextMinute.set(resourceKey, endMinute + turnaroundMinute);
      if (clientDateKey) clientDates.add(clientDateKey);
      poolCursor.set(poolKey, (candidateIndex + 1) % candidates.length);
      const hour = String(Math.floor(startMinute / 60)).padStart(2, "0");
      const minute = String(startMinute % 60).padStart(2, "0");
      return {
        operator: candidate.operator,
        startAt: `${candidate.date}T${hour}:${minute}:00.000Z`,
        endAt: addMinutesIso(`${candidate.date}T${hour}:${minute}:00.000Z`, service.durationMin)
      };
    }
    assertInvariant(false, `Capacita mensile insufficiente per ${service.name} in ${monthKey}`);
  }

  function reserveCancelled(monthKey, service, resource = null, seed = 0) {
    if (resource) {
      assertInvariant(resourceIds.has(String(resource.id || "")), `Risorsa sconosciuta per ${service.name}`);
    }
    const candidates = qualifiedCandidates(monthKey, service);
    const candidate = candidates[Math.abs(Number(seed || 0)) % candidates.length];
    const workingWindow = staffWorkingWindow(candidate.operator);
    const startMinute = Math.min(
      workingWindow.endMinute - Number(service.durationMin || 0),
      workingWindow.startMinute + 90 + (Math.abs(Number(seed || 0)) % 4) * 30
    );
    const hour = String(Math.floor(startMinute / 60)).padStart(2, "0");
    const minute = String(startMinute % 60).padStart(2, "0");
    return {
      operator: candidate.operator,
      startAt: `${candidate.date}T${hour}:${minute}:00.000Z`,
      endAt: addMinutesIso(`${candidate.date}T${hour}:${minute}:00.000Z`, service.durationMin)
    };
  }

  return { reserve, reserveCancelled };
}

function reconcileMonthlyServicePrices(monthRows = [], targetServiceRevenueCents = 0) {
  const pricing = monthRows.map((row) => ({
    salePriceCents: Number(row.service.priceCents || 0),
    priceAdjustmentType: "none",
    priceAdjustmentCents: 0
  }));
  const listTotal = pricing.reduce((sum, item) => sum + item.salePriceCents, 0);
  let remaining = Math.abs(listTotal - Number(targetServiceRevenueCents || 0));
  if (!remaining) return pricing;
  const discountMode = listTotal > Number(targetServiceRevenueCents || 0);
  const candidates = monthRows
    .map((row, index) => ({ row, index }))
    .sort((left, right) =>
      ((left.row.globalIndex * 97) % Math.max(1, monthRows.length))
      - ((right.row.globalIndex * 97) % Math.max(1, monthRows.length))
      || left.index - right.index
    );
  const ordered = discountMode
    ? candidates
    : [
        ...candidates.filter(({ row }) => String(row.service.name || "").includes("a partire da")),
        ...candidates.filter(({ row }) => !String(row.service.name || "").includes("a partire da"))
      ];
  ordered.forEach(({ row, index }) => {
    if (!remaining) return;
    const listPrice = Number(row.service.priceCents || 0);
    const cap = Math.max(1, Math.floor(listPrice * (discountMode ? 0.15 : 0.25)));
    const adjustment = Math.min(remaining, cap);
    pricing[index] = {
      salePriceCents: listPrice + (discountMode ? -adjustment : adjustment),
      priceAdjustmentType: discountMode ? "membership_or_campaign_discount" : "length_or_complexity_surcharge",
      priceAdjustmentCents: discountMode ? -adjustment : adjustment
    };
    remaining -= adjustment;
  });
  assertInvariant(remaining === 0, "Impossibile riconciliare il ricavo mensile con variazioni prezzo realistiche");
  return pricing;
}

function buildHistory(centerId, centerName, clients, staff, services, inventory, resources) {
  const revenueTargets = monthRevenueTargets();
  const categoryLabels = balancedLabels(CATEGORY_TOTALS);
  const retailFlags = balancedLabels({ retail: TOTAL_RETAIL_LINES, none: TOTAL_CHECKOUTS - TOTAL_RETAIL_LINES });
  const retailItems = inventory.filter((item) => item.usageType === "rivendita");
  const inventoryById = new Map(inventory.map((item) => [String(item.id || ""), item]));
  const cycles = {
    hair: serviceCycle(services, "hair"),
    beauty: serviceCycle(services, "beauty"),
    technology: serviceCycle(services, "technology")
  };
  const cyclePositions = { hair: 0, beauty: 0, technology: 0 };
  const appointments = [];
  const payments = [];
  const shifts = [];
  const treatments = [];
  const inventoryMovements = [];
  const cashClosures = [];
  const aiMarketingActions = [];
  const goldActionOutcomes = [];
  const scheduler = createAppointmentScheduler(staff, resources);
  const checkoutClients = clientCheckoutSequence(clients);
  let globalCheckoutIndex = 0;

  inventory.forEach((item) => {
    inventoryMovements.push({
      id: `gold18m_move_opening_${item.id}`,
      idempotencyKey: `${DATASET_VERSION}:movement:opening:${item.id}`,
      centerId,
      centerName,
      itemId: item.id,
      type: "load",
      quantity: Number(item.openingQuantity || 0),
      paymentId: "",
      appointmentId: "",
      salePriceCents: 0,
      lineTotalCents: 0,
      note: "Saldo iniziale sintetico riconciliato del periodo storico.",
      seedMonthIndex: 0,
      datasetVersion: DATASET_VERSION,
      createdAt: "2025-01-01T06:30:00.000Z"
    });
  });

  MONTH_KEYS.forEach((monthKey, monthIndex) => {
    const count = MONTHLY_CHECKOUTS[monthIndex];
    const days = businessDays(monthKey);
    const monthRows = [];
    const productSalesForMonth = [];
    const cabinConsumptionForMonth = new Map();
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      const globalIndex = globalCheckoutIndex + localIndex;
      const category = categoryLabels[globalIndex];
      const cycle = cycles[category];
      const service = cycle[cyclePositions[category] % cycle.length];
      cyclePositions[category] += 1;
      const client = checkoutClients[globalIndex];
      assertInvariant(Boolean(client), `Cliente non assegnato al checkout ${globalIndex + 1}`);
      const resource = service.technologyLinks[0]
        ? resources.find((item) => item.id === service.technologyLinks[0].technologyId)
        : null;
      const reservation = scheduler.reserve(monthKey, service, resource, client.id);
      const operator = reservation.operator;
      const startAt = reservation.startAt;
      const hasRetail = retailFlags[globalIndex] === "retail";
      const retail = hasRetail ? retailItems[(globalIndex * 7 + monthIndex) % retailItems.length] : null;
      const productSales = retail ? [{
        itemId: retail.id,
        name: retail.name,
        quantity: 1,
        salePriceCents: retail.salePriceCents
      }] : [];
      productSalesForMonth.push(...productSales);
      monthRows.push({
        globalIndex,
        localIndex,
        monthIndex,
        monthKey,
        client,
        operator,
        service,
        resource,
        startAt,
        productSales
      });
    }

    const retailRevenueCents = productSalesForMonth
      .reduce((sum, line) => sum + Number(line.salePriceCents || 0) * Number(line.quantity || 0), 0);
    const serviceRevenueTarget = revenueTargets[monthIndex] - retailRevenueCents;
    assertInvariant(serviceRevenueTarget > 0, `Ricavo servizi non valido per ${monthKey}`);
    const serviceSalePrices = reconcileMonthlyServicePrices(monthRows, serviceRevenueTarget);
    monthRows.forEach((row, rowIndex) => {
      const appointmentId = `gold18m_appointment_${String(row.globalIndex + 1).padStart(5, "0")}`;
      const paymentId = `gold18m_payment_${String(row.globalIndex + 1).padStart(5, "0")}`;
      const pricing = serviceSalePrices[rowIndex];
      const salePriceCents = pricing.salePriceCents;
      const listPriceCents = Number(row.service.priceCents || 0);
      const productRevenueCents = row.productSales.reduce((sum, line) => sum + line.salePriceCents * line.quantity, 0);
      const amountCents = salePriceCents + productRevenueCents;
      const appointment = {
        id: appointmentId,
        idempotencyKey: `${DATASET_VERSION}:appointment:${row.globalIndex + 1}`,
        centerId,
        centerName,
        clientId: row.client.id,
        clientName: row.client.name,
        walkInName: "",
        walkInPhone: "",
        staffId: row.operator.id,
        staffName: row.operator.name,
        serviceId: row.service.id,
        serviceIds: [row.service.id],
        serviceName: row.service.name,
        productSales: row.productSales,
        resourceId: row.resource?.id || "",
        resourceName: row.resource?.name || "",
        startAt: row.startAt,
        endAt: addMinutesIso(row.startAt, row.service.durationMin),
        status: "completed",
        durationMin: row.service.durationMin,
        actualDurationMin: row.service.durationMin,
        priceCents: salePriceCents,
        discountCents: Math.max(0, listPriceCents - salePriceCents),
        priceAdjustmentType: pricing.priceAdjustmentType,
        priceAdjustmentCents: pricing.priceAdjustmentCents,
        notes: "Storico sintetico Gold 18 mesi; servizio e checkout riconciliati.",
        locked: 1,
        seedMonthIndex: monthIndex,
        datasetVersion: DATASET_VERSION,
        createdAt: row.startAt,
        updatedAt: row.startAt
      };
      const payment = {
        id: paymentId,
        idempotencyKey: `${DATASET_VERSION}:payment:${row.globalIndex + 1}`,
        centerId,
        centerName,
        clientId: row.client.id,
        walkInName: "",
        appointmentId,
        amountCents,
        method: row.globalIndex % 10 < 2 ? "cash" : row.globalIndex % 10 === 9 ? "bank_transfer" : "card",
        description: `Checkout sintetico: ${row.service.name}${row.productSales.length ? " + retail Revlon" : ""}.`,
        note: "Pagamento dimostrativo collegato a un singolo appuntamento completato.",
        serviceLines: [{
          serviceId: row.service.id,
          name: row.service.name,
          listPriceCents,
          salePriceCents,
          priceAdjustmentType: pricing.priceAdjustmentType,
          priceAdjustmentCents: pricing.priceAdjustmentCents
        }],
        productSales: row.productSales,
        seedMonthIndex: monthIndex,
        datasetVersion: DATASET_VERSION,
        createdAt: row.startAt
      };
      appointments.push(appointment);
      payments.push(payment);
      row.productSales.forEach((line) => {
        const inventoryItem = inventoryById.get(String(line.itemId || "")) || {};
        inventoryMovements.push({
          id: `gold18m_move_sale_${paymentId}_${line.itemId}`,
          idempotencyKey: `${DATASET_VERSION}:movement:sale:${paymentId}:${line.itemId}`,
          centerId,
          centerName,
          itemId: line.itemId,
          type: "sale",
          quantity: line.quantity,
          paymentId,
          appointmentId,
          salePriceCents: line.salePriceCents,
          lineTotalCents: line.salePriceCents * line.quantity,
          unitCostCents: Number(inventoryItem.unitCostCents || inventoryItem.costCents || 0),
          costCents: Math.round(Number(inventoryItem.unitCostCents || inventoryItem.costCents || 0) * Number(line.quantity || 0)),
          note: `Vendita checkout sintetica: ${line.name}.`,
          seedMonthIndex: monthIndex,
          datasetVersion: DATASET_VERSION,
          createdAt: row.startAt
        });
      });
      (row.service.productLinks || []).forEach((link) => {
        const inventoryItem = inventoryById.get(String(link.productId || ""));
        assertInvariant(Boolean(inventoryItem), `Prodotto cabina non trovato per ${row.service.name}`);
        const usageUnits = Number(link.usageUnits || 0);
        const unitCostCents = Number(link.unitCostCents || inventoryItem.unitCostCents || inventoryItem.costCents || 0);
        const current = cabinConsumptionForMonth.get(inventoryItem.id) || {
          itemId: inventoryItem.id,
          quantity: 0,
          costCents: 0,
          appointmentCount: 0,
          serviceIds: new Set()
        };
        current.quantity += usageUnits;
        current.costCents += Math.round(unitCostCents * usageUnits);
        current.appointmentCount += 1;
        current.serviceIds.add(row.service.id);
        cabinConsumptionForMonth.set(inventoryItem.id, current);
      });
      if (row.globalIndex % 5 === 0) {
        treatments.push({
          id: `gold18m_treatment_${String(row.globalIndex + 1).padStart(5, "0")}`,
          idempotencyKey: `${DATASET_VERSION}:treatment:${row.globalIndex + 1}`,
          centerId,
          centerName,
          clientId: row.client.id,
          title: `${row.service.name} - scheda storica`,
          note: "Trattamento sintetico non medico; risultato non garantito e verifica operatore richiesta.",
          seedMonthIndex: monthIndex,
          datasetVersion: DATASET_VERSION,
          createdAt: row.startAt
        });
      }
    });

    const monthlyPayments = payments.filter((item) => item.seedMonthIndex === monthIndex);
    const byDate = new Map();
    monthlyPayments.forEach((payment) => {
      const date = payment.createdAt.slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(payment);
    });
    byDate.forEach((rows, date) => {
      const byMethodMap = new Map();
      rows.forEach((payment) => {
        const current = byMethodMap.get(payment.method) || { method: payment.method, amountCents: 0, count: 0 };
        current.amountCents += payment.amountCents;
        current.count += 1;
        byMethodMap.set(payment.method, current);
      });
      cashClosures.push({
        id: `gold18m_cashclose_${date}`,
        centerId,
        centerName,
        date,
        status: "closed",
        totalPayments: rows.length,
        revenueCents: rows.reduce((sum, item) => sum + item.amountCents, 0),
        byMethod: Array.from(byMethodMap.values()),
        closedBy: "operatore_demo",
        closedAt: `${date}T20:30:00.000Z`,
        updatedAt: `${date}T20:30:00.000Z`,
        seedMonthIndex: monthIndex,
        datasetVersion: DATASET_VERSION
      });
    });

    const salesByItem = new Map();
    monthlyPayments.flatMap((item) => item.productSales).forEach((line) => {
      salesByItem.set(line.itemId, (salesByItem.get(line.itemId) || 0) + Number(line.quantity || 0));
    });
    cabinConsumptionForMonth.forEach((consumption, itemId) => {
      inventoryMovements.push({
        id: `gold18m_move_internal_${monthKey}_${itemId}`,
        idempotencyKey: `${DATASET_VERSION}:movement:internal_use:${monthKey}:${itemId}`,
        centerId,
        centerName,
        itemId,
        type: "internal_use",
        quantity: Number(consumption.quantity.toFixed(6)),
        paymentId: "",
        appointmentId: "",
        salePriceCents: 0,
        lineTotalCents: 0,
        unitCostCents: Number(inventoryById.get(itemId)?.unitCostCents || inventoryById.get(itemId)?.costCents || 0),
        costCents: consumption.costCents,
        linkedAppointmentCount: consumption.appointmentCount,
        serviceIds: Array.from(consumption.serviceIds).sort(),
        note: "Consumo cabina sintetico mensile aggregato da appuntamenti completati.",
        seedMonthIndex: monthIndex,
        datasetVersion: DATASET_VERSION,
        createdAt: `${monthKey}-28T20:45:00.000Z`
      });
    });
    inventory.forEach((item) => {
      const saleQuantity = Number(salesByItem.get(item.id) || 0);
      const internalQuantity = Number(cabinConsumptionForMonth.get(item.id)?.quantity || 0);
      const closingGrowth = monthIndex === MONTH_KEYS.length - 1
        ? Number(item.stockQuantity || item.quantity || 0) - Number(item.openingQuantity || 0)
        : 0;
      const quantity = saleQuantity + internalQuantity + closingGrowth;
      assertInvariant(quantity > 0, `Carico mensile non valido per ${item.id} in ${monthKey}`);
      inventoryMovements.push({
        id: `gold18m_move_replenish_${monthKey}_${item.id}`,
        idempotencyKey: `${DATASET_VERSION}:movement:replenish:${monthKey}:${item.id}`,
        centerId,
        centerName,
        itemId: item.id,
        type: "replenish",
        quantity: Number(quantity.toFixed(6)),
        paymentId: "",
        appointmentId: "",
        salePriceCents: 0,
        lineTotalCents: 0,
        unitCostCents: Number(item.unitCostCents || item.costCents || 0),
        costCents: Math.round(Number(item.unitCostCents || item.costCents || 0) * quantity),
        note: monthIndex === MONTH_KEYS.length - 1
          ? "Riordino sintetico mensile con crescita della scorta finale."
          : "Riordino sintetico mensile riconciliato a vendite e consumi cabina.",
        seedMonthIndex: monthIndex,
        datasetVersion: DATASET_VERSION,
        createdAt: `${monthKey}-01T07:30:00.000Z`
      });
    });

    days.forEach((date) => {
      staff.forEach((operator) => {
        if (!staffAvailabilityOnDate(operator, date).available) return;
        const workingWindow = staffWorkingWindow(operator);
        shifts.push({
          id: `gold18m_shift_${date}_${operator.id}`,
          idempotencyKey: `${DATASET_VERSION}:shift:${date}:${operator.id}`,
          centerId,
          centerName,
          staffId: operator.id,
          staffName: operator.name,
          date,
          startTime: workingWindow.startTime,
          endTime: workingWindow.endTime,
          originalStartTime: workingWindow.startTime,
          originalEndTime: workingWindow.endTime,
          originalAttendanceStatus: "confirmed",
          rectifiedStartTime: "",
          rectifiedEndTime: "",
          rectificationReason: "",
          rectifiedBy: "",
          rectifiedAt: "",
          attendanceStatus: "confirmed",
          attendanceNote: "",
          confirmedAt: `${date}T20:00:00.000Z`,
          notes: "Turno sintetico storico.",
          seedMonthIndex: monthIndex,
          datasetVersion: DATASET_VERSION,
          createdAt: `${date}T07:00:00.000Z`,
          updatedAt: `${date}T20:00:00.000Z`
        });
      });
    });

    globalCheckoutIndex += count;
  });

  const noShowCounts = allocateInteger(126, MONTHLY_CHECKOUTS);
  const cancelledCounts = allocateInteger(84, MONTHLY_CHECKOUTS);
  const extraServiceCycle = services.flatMap((service) =>
    Array.from({ length: Math.max(1, Number(service.selectionWeight || 1)) }, () => service)
  );
  MONTH_KEYS.forEach((monthKey, monthIndex) => {
    const extraCount = noShowCounts[monthIndex] + cancelledCounts[monthIndex];
    for (let index = 0; index < extraCount; index += 1) {
      const isNoShow = index < noShowCounts[monthIndex];
      const client = clients[(monthIndex * 53 + index * 19) % clients.length];
      const service = extraServiceCycle[(monthIndex * 17 + index * 7) % extraServiceCycle.length];
      const resource = service.technologyLinks[0]
        ? resources.find((item) => item.id === service.technologyLinks[0].technologyId)
        : null;
      const reservation = isNoShow
        ? scheduler.reserve(monthKey, service, resource, client.id)
        : scheduler.reserveCancelled(monthKey, service, resource, monthIndex * 100 + index);
      const operator = reservation.operator;
      const startAt = reservation.startAt;
      appointments.push({
        id: `gold18m_appointment_${isNoShow ? "noshow" : "cancelled"}_${monthIndex}_${index}`,
        idempotencyKey: `${DATASET_VERSION}:appointment:${isNoShow ? "noshow" : "cancelled"}:${monthIndex}:${index}`,
        centerId,
        centerName,
        clientId: client.id,
        clientName: client.name,
        walkInName: "",
        walkInPhone: "",
        staffId: operator.id,
        staffName: operator.name,
        serviceId: service.id,
        serviceIds: [service.id],
        serviceName: service.name,
        productSales: [],
        resourceId: resource?.id || "",
        resourceName: resource?.name || "",
        startAt,
        endAt: addMinutesIso(startAt, service.durationMin),
        status: isNoShow ? "no_show" : "cancelled",
        durationMin: service.durationMin,
        actualDurationMin: 0,
        priceCents: 0,
        discountCents: 0,
        notes: "Evento sintetico senza incasso per realismo operativo.",
        locked: 1,
        seedMonthIndex: monthIndex,
        datasetVersion: DATASET_VERSION,
        createdAt: startAt,
        updatedAt: startAt
      });
    }
  });

  const completedAppointmentsByClient = new Map();
  appointments
    .filter((appointment) => appointment.status === "completed")
    .forEach((appointment) => {
      const rows = completedAppointmentsByClient.get(appointment.clientId) || [];
      rows.push(appointment);
      completedAppointmentsByClient.set(appointment.clientId, rows);
    });
  completedAppointmentsByClient.forEach((rows) =>
    rows.sort((left, right) => String(left.startAt).localeCompare(String(right.startAt)))
  );
  const paymentByAppointmentId = new Map(payments.map((payment) => [payment.appointmentId, payment]));
  const recallClients = clients
    .filter((client) => client.marketingConsent && (completedAppointmentsByClient.get(client.id) || []).length >= 6)
    .slice(0, 36);
  assertInvariant(recallClients.length === 36, "Clienti con storico insufficiente per azioni marketing coerenti");

  for (let index = 0; index < recallClients.length; index += 1) {
    const client = recallClients[index];
    const clientAppointments = completedAppointmentsByClient.get(client.id) || [];
    const success = index % 4 !== 0;
    const basisAppointment = success
      ? clientAppointments[clientAppointments.length - 2]
      : clientAppointments[clientAppointments.length - 1];
    const convertedAppointment = success ? clientAppointments[clientAppointments.length - 1] : null;
    const basisTime = new Date(basisAppointment.startAt).getTime();
    const conversionTime = convertedAppointment ? new Date(convertedAppointment.startAt).getTime() : 0;
    const createdTime = success
      ? basisTime + Math.max(60 * 60 * 1000, Math.floor((conversionTime - basisTime) / 2))
      : Math.min(
          basisTime + (14 * 24 * 60 * 60 * 1000),
          new Date("2026-07-20T10:00:00.000Z").getTime()
        );
    const createdAt = new Date(createdTime).toISOString();
    const convertedPayment = convertedAppointment
      ? paymentByAppointmentId.get(convertedAppointment.id)
      : null;
    const observedValueCents = success ? Number(convertedPayment?.amountCents || 0) : 0;
    const observedVisitCount = clientAppointments
      .filter((appointment) => String(appointment.startAt || "") <= String(basisAppointment.startAt || ""))
      .length;
    assertInvariant(!success || (createdTime > basisTime && createdTime < conversionTime), "Finestra recall conversione non coerente");
    assertInvariant(!success || observedValueCents > 0, "Conversione marketing senza incasso collegato");
    const actionId = `gold18m_marketing_${String(index + 1).padStart(3, "0")}`;
    aiMarketingActions.push({
      id: actionId,
      centerId,
      centerName,
      clientId: client.id,
      clientName: client.name,
      type: "recall",
      status: success ? "done" : "archived",
      priority: index % 3 === 0 ? "alta" : "media",
      risk: "basso",
      reason: `Richiamo storico sintetico dopo ${observedVisitCount} visite concluse osservate.`,
      recommendedAction: "Verifica operatore prima di qualunque contatto.",
      estimatedValueCents: success ? observedValueCents : 6500,
      referenceValueCents: success ? observedValueCents : 6500,
      suggestedMessage: "",
      source: "synthetic_gold_18m",
      aiProvider: "rules",
      basisAppointmentId: basisAppointment.id,
      convertedAppointmentId: convertedAppointment?.id || "",
      observedVisitCount,
      generatedAt: createdAt,
      updatedAt: createdAt,
      completedAt: success ? createdAt : "",
      archivedAt: success ? "" : createdAt,
      approvedAt: createdAt,
      copiedAt: "",
      seedMonthIndex: Number(basisAppointment.seedMonthIndex || 0),
      datasetVersion: DATASET_VERSION
    });
    goldActionOutcomes.push({
      id: `gold18m_outcome_${String(index + 1).padStart(3, "0")}`,
      centerId,
      createdAt: success ? convertedAppointment.startAt : createdAt,
      domain: "marketing",
      entityId: client.id,
      actionId,
      basisAppointmentId: basisAppointment.id,
      convertedAppointmentId: convertedAppointment?.id || "",
      action: "SUGGEST",
      outcome: success ? "booked" : "not_converted",
      success,
      valueCents: observedValueCents,
      note: success
        ? "Outcome sintetico riconciliato con appuntamento e pagamento successivi."
        : "Outcome sintetico archiviato senza visite successive.",
      seedMonthIndex: Number((convertedAppointment || basisAppointment).seedMonthIndex || 0),
      datasetVersion: DATASET_VERSION
    });
  }

  return {
    appointments,
    payments,
    shifts,
    treatments,
    inventoryMovements,
    cashClosures,
    aiMarketingActions,
    goldActionOutcomes
  };
}

function clientStateAtWave(clients, payments, appointments, wave) {
  const maxMonthIndex = Math.min(17, wave * 6 - 1);
  const allowedPayments = payments.filter((item) => item.seedMonthIndex <= maxMonthIndex);
  const allowedAppointments = appointments
    .filter((item) => item.seedMonthIndex <= maxMonthIndex && item.status === "completed");
  const spendByClient = new Map();
  allowedPayments.forEach((payment) => {
    spendByClient.set(payment.clientId, (spendByClient.get(payment.clientId) || 0) + Number(payment.amountCents || 0));
  });
  const lastVisitByClient = new Map();
  allowedAppointments.forEach((appointment) => {
    const current = lastVisitByClient.get(appointment.clientId);
    if (!current || appointment.startAt > current) lastVisitByClient.set(appointment.clientId, appointment.startAt);
  });
  return clients.map((client) => {
    const totalValue = spendByClient.get(client.id) || 0;
    return {
      ...client,
      totalValue,
      lastVisit: lastVisitByClient.get(client.id) || "",
      loyaltyTier: totalValue >= 120000 ? "gold" : totalValue >= 70000 ? "silver" : totalValue >= 30000 ? "pearl" : "base",
      updatedAt: DATASET_CREATED_AT
    };
  });
}

function buildGold18mDataset({ centerId, centerName = DATASET_CENTER_NAME } = {}) {
  const targetCenterId = assertSafeTargetCenterId(centerId);
  const targetCenterName = assertSafeTargetCenterName(centerName || DATASET_CENTER_NAME);
  const inventory = inventoryTemplates(targetCenterId, targetCenterName);
  const resources = resourceTemplates(targetCenterId, targetCenterName);
  const staff = staffTemplates(targetCenterId, targetCenterName);
  const services = serviceTemplates(targetCenterId, targetCenterName, inventory, resources);
  const clients = clientTemplates(targetCenterId, targetCenterName);
  const history = buildHistory(targetCenterId, targetCenterName, clients, staff, services, inventory, resources);
  const protocols = protocolTemplates(targetCenterId, targetCenterName, clients);
  const templates = shiftTemplates(targetCenterId, targetCenterName, staff);
  const settings = centerSettings(targetCenterId, targetCenterName);
  const manifest = {
    id: `gold18m_manifest_${targetCenterId}`,
    centerId: targetCenterId,
    centerName: targetCenterName,
    datasetVersion: DATASET_VERSION,
    datasetDigest: "",
    status: "prepared",
    syntheticCustomers: true,
    periodStart: "2025-01-01",
    periodEnd: "2026-06-30",
    targetCheckouts: TOTAL_CHECKOUTS,
    targetRevenueCents: TOTAL_REVENUE_CENTS,
    priceSources: PRICE_SOURCES,
    appliedWaves: [],
    createdAt: DATASET_CREATED_AT,
    updatedAt: DATASET_CREATED_AT
  };
  const digestInput = {
    centerId: targetCenterId,
    staff,
    services,
    resources,
    inventory,
    clients,
    protocols,
    history
  };
  manifest.datasetDigest = sha256(stableStringify(digestInput));
  return {
    centerId: targetCenterId,
    centerName: targetCenterName,
    staff,
    services,
    resources,
    inventory,
    clients,
    shiftTemplates: templates,
    protocols,
    settings,
    history,
    manifest,
    clientsAtWave: (wave) => clientStateAtWave(clients, history.payments, history.appointments, wave)
  };
}

function selectPrimaryUser(users = [], centerId = "") {
  const candidates = users.filter((user) =>
    normalizedRole(user) !== "superadmin"
    && normalizedCenterId(user.centerId) === normalizedCenterId(centerId)
  );
  return candidates.sort((left, right) => {
    const score = (user) => {
      const role = normalizedRole(user);
      const plan = String(user.subscriptionPlan || "").toLowerCase();
      return (["owner", "admin", "admin_centro"].includes(role) ? 100 : 0)
        + (plan === "gold" ? 30 : plan === "silver" ? 20 : 10)
        + (user.active === false ? 0 : 10)
        + (String(user.accountStatus || "").toLowerCase() === "active" ? 10 : 0);
    };
    return score(right) - score(left)
      || String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
      || String(left.id || "").localeCompare(String(right.id || ""));
  })[0] || null;
}

function userRecordFingerprint(user = {}) {
  return sha256(stableStringify(user));
}

function superadminSetDigest(users = []) {
  const fingerprints = (Array.isArray(users) ? users : [])
    .filter((user) => normalizedRole(user) === "superadmin")
    .map(userRecordFingerprint)
    .sort();
  return sha256(stableStringify(fingerprints));
}

function tenantAuthDigest(users = [], userId = "") {
  const expectedId = String(userId || "");
  const user = (Array.isArray(users) ? users : []).find((item) => String(item.id || "") === expectedId);
  if (!user) return "";
  return sha256(stableStringify({
    id: String(user.id || ""),
    username: String(user.username || ""),
    email: String(user.email || ""),
    contactEmail: String(user.contactEmail || ""),
    contactPhone: String(user.contactPhone || ""),
    passwordHash: String(user.passwordHash || ""),
    passwordSalt: String(user.passwordSalt || ""),
    passwordResetTokenHash: String(user.passwordResetTokenHash || ""),
    passwordResetExpiresAt: String(user.passwordResetExpiresAt || ""),
    passwordResetSentAt: String(user.passwordResetSentAt || ""),
    lastPasswordChangeAt: String(user.lastPasswordChangeAt || ""),
    emailVerifiedAt: String(user.emailVerifiedAt || ""),
    emailVerificationCode: String(user.emailVerificationCode || ""),
    emailVerificationTokenHash: String(user.emailVerificationTokenHash || ""),
    emailVerificationExpiresAt: String(user.emailVerificationExpiresAt || ""),
    emailVerificationSentAt: String(user.emailVerificationSentAt || ""),
    role: String(user.role || ""),
    active: user.active !== false
  }));
}

function collectionDigests(collections = {}) {
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [
    name,
    sha256(stableStringify(collections[name] ?? (name === "settings" ? {} : [])))
  ]));
}

function auditCollections(collections = {}) {
  const users = Array.isArray(collections.users) ? collections.users : [];
  const superadmins = users.filter((user) => normalizedRole(user) === "superadmin");
  const tenantUsers = users.filter((user) => normalizedRole(user) !== "superadmin" && normalizedCenterId(user.centerId));
  const centerIds = Array.from(new Set(tenantUsers.map((user) => normalizedCenterId(user.centerId))))
    .filter((centerId) => centerId && centerId !== "center_admin" && centerId !== GLOBAL_LIBRARY_CENTER_ID);
  const candidates = centerIds.map((centerId) => {
    const centerUsers = tenantUsers.filter((user) => normalizedCenterId(user.centerId) === centerId);
    const primary = selectPrimaryUser(users, centerId);
    const counts = {};
    COLLECTION_NAMES.filter((name) => !["settings", "users"].includes(name)).forEach((name) => {
      const rows = Array.isArray(collections[name]) ? collections[name] : [];
      counts[name] = rows.filter((item) => normalizedCenterId(item.centerId) === centerId).length;
    });
    const plan = String(primary?.subscriptionPlan || "").toLowerCase();
    const score = (plan === "gold" ? 1000 : plan === "silver" ? 600 : 300)
      + (primary?.active === false ? 0 : 100)
      + (String(primary?.accountStatus || "").toLowerCase() === "active" ? 100 : 0)
      + Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    return {
      centerId,
      centerName: String(primary?.centerName || centerUsers[0]?.centerName || "").slice(0, 120),
      accountCount: centerUsers.length,
      primaryUserId: primary?.id || "",
      primaryUserFingerprint: primary ? userRecordFingerprint(primary) : "",
      accounts: centerUsers.map((user) => ({
        id: String(user.id || ""),
        role: normalizedRole(user),
        active: user.active !== false,
        accountStatus: String(user.accountStatus || ""),
        fingerprint: userRecordFingerprint(user)
      })).sort((left, right) => left.id.localeCompare(right.id)),
      plan: plan || "base",
      active: primary?.active !== false,
      counts,
      score
    };
  }).sort((left, right) => right.score - left.score || left.centerId.localeCompare(right.centerId));
  const digests = collectionDigests(collections);
  const centerlessCounts = Object.fromEntries(COLLECTION_NAMES
    .filter((name) => !["settings", "users"].includes(name))
    .map((name) => {
      const rows = Array.isArray(collections[name]) ? collections[name] : [];
      return [name, rows.filter((item) => !normalizedCenterId(item.centerId)).length];
    }));
  return {
    datasetVersion: DATASET_VERSION,
    superadminCount: superadmins.length,
    tenantCenterCount: candidates.length,
    tenantAccountCount: tenantUsers.length,
    candidates,
    recommendedKeepCenterId: candidates[0]?.centerId || "",
    superadminSetDigest: superadminSetDigest(users),
    centerlessCounts,
    collectionDigests: digests,
    previewDigest: sha256(stableStringify({
      userFingerprints: users.map(userRecordFingerprint).sort(),
      superadminSetDigest: superadminSetDigest(users),
      collectionDigests: digests
    }))
  };
}

function buildApplyDigest(audit = {}, {
  centerId = "",
  userId = "",
  centerName = ""
} = {}) {
  const targetCenterId = assertSafeTargetCenterId(centerId);
  const targetCenterName = assertSafeTargetCenterName(centerName);
  const candidate = (audit.candidates || []).find((item) => item.centerId === targetCenterId);
  assertInvariant(Boolean(candidate), "Centro target non presente nell'audit", "gold_seed_target_not_found");
  const accounts = (candidate.accounts || []).filter((item) => item.id === String(userId || ""));
  assertInvariant(accounts.length === 1 && accounts[0].fingerprint, "Account target esplicito non presente o ambiguo", "gold_seed_target_user_missing");
  return sha256(stableStringify({
    operation: "smartdesk_gold_18m_exact_prune_and_seed",
    datasetVersion: DATASET_VERSION,
    previewDigest: audit.previewDigest,
    targetCenterId,
    targetUserId: accounts[0].id,
    targetUserFingerprint: accounts[0].fingerprint,
    requestedCenterName: targetCenterName,
    superadminSetDigest: audit.superadminSetDigest
  }));
}

const CANONICAL_GLOBAL_PROTOCOL_IDS = new Set(skinHarmonyProtocolLibrary.map((item) => String(item.id || "")));
const GOLD_IMPORT_VERIFICATION_CHECKS_TOTAL = 69;

function isPreservedTechnicalRow(item = {}, collectionName = "") {
  const centerId = normalizedCenterId(item.centerId);
  if (centerId === "center_admin") return true;
  if (collectionName === "protocols") {
    return centerId === GLOBAL_LIBRARY_CENTER_ID
      && String(item.libraryScope || "").toLowerCase() === "skinharmony"
      && String(item.source || "").toLowerCase() === "skinharmony_library"
      && CANONICAL_GLOBAL_PROTOCOL_IDS.has(String(item.id || ""));
  }
  return false;
}

function normalizedSettingsStore(settings = {}) {
  if (!settings || Array.isArray(settings) || typeof settings !== "object") return {};
  if (settings.centerName || settings.centerType || settings.businessModel) {
    return { center_admin: clone(settings) };
  }
  return clone(settings);
}

function structureManifest(dataset) {
  return {
    ...dataset.manifest,
    status: "structured",
    appliedWaves: [],
    updatedAt: DATASET_CREATED_AT
  };
}

function isCompleteGoldImportManifest(manifests = [], dataset = null) {
  if (!dataset || !Array.isArray(manifests) || manifests.length !== 1) return false;
  const manifest = manifests[0] || {};
  const expected = dataset.manifest || {};
  const verification = manifest.verification;
  const expectedTotals = {
    clients: 1100,
    appointments: 5460,
    completedAppointments: 5250,
    payments: 5250,
    revenueCents: TOTAL_REVENUE_CENTS,
    staff: 4,
    technologies: 3,
    services: 18,
    inventoryItems: 10,
    inventoryMovements: 1471,
    cashClosures: 445,
    firstYearPayments: 3500,
    firstYearRevenueCents: 20000000
  };
  const manifestMatches = manifest.id === expected.id
    && manifest.centerId === expected.centerId
    && manifest.centerName === expected.centerName
    && manifest.datasetVersion === expected.datasetVersion
    && manifest.datasetDigest === expected.datasetDigest
    && manifest.status === "complete"
    && manifest.syntheticCustomers === true
    && manifest.periodStart === expected.periodStart
    && manifest.periodEnd === expected.periodEnd
    && manifest.targetCheckouts === expected.targetCheckouts
    && manifest.targetRevenueCents === expected.targetRevenueCents
    && stableStringify(manifest.priceSources || []) === stableStringify(expected.priceSources || [])
    && stableStringify(manifest.appliedWaves || []) === stableStringify([1, 2, 3])
    && manifest.createdAt === DATASET_CREATED_AT
    && manifest.updatedAt === DATASET_CREATED_AT;
  const manifestAllowedKeys = new Set([
    "id", "centerId", "centerName", "datasetVersion", "datasetDigest", "status", "syntheticCustomers",
    "periodStart", "periodEnd", "targetCheckouts", "targetRevenueCents", "priceSources", "appliedWaves",
    "createdAt", "updatedAt", "verification"
  ]);
  const manifestShapeMatches = Object.keys(manifest).every((key) => manifestAllowedKeys.has(key));
  const verificationAllowedKeys = new Set(["ok", "checksPassed", "checksTotal", "totals"]);
  const verificationMatches = Boolean(verification)
    && verification.ok === true
    && verification.checksPassed === GOLD_IMPORT_VERIFICATION_CHECKS_TOTAL
    && verification.checksTotal === GOLD_IMPORT_VERIFICATION_CHECKS_TOTAL
    && Object.keys(verification).every((key) => verificationAllowedKeys.has(key))
    && stableStringify(verification.totals || {}) === stableStringify(expectedTotals);
  return manifestMatches && manifestShapeMatches && verificationMatches;
}

function planStructureCollections(collections = {}, centerId = "", dataset, primaryUserId = "") {
  const targetCenterId = assertSafeTargetCenterId(centerId);
  assertInvariant(dataset?.centerId === targetCenterId, "Dataset e centerId target non coincidono");
  const users = Array.isArray(collections.users) ? collections.users : [];
  const superadmins = users.filter((user) => normalizedRole(user) === "superadmin");
  assertInvariant(superadmins.length >= 1, "Nessun superadmin: prune bloccato", "gold_seed_superadmin_missing");
  const primaryMatches = users.filter((user) =>
    normalizedRole(user) !== "superadmin"
    && normalizedCenterId(user.centerId) === targetCenterId
    && String(user.id || "") === String(primaryUserId || "")
  );
  assertInvariant(primaryMatches.length === 1, "Account tenant target esplicito mancante o ambiguo", "gold_seed_target_user_missing");
  const primary = primaryMatches[0];
  const primaryUser = {
    ...clone(primary),
    active: true,
    centerId: targetCenterId,
    centerName: dataset.centerName,
    businessModel: "hybrid_beauty_hair",
    planType: "active",
    subscriptionPlan: "gold",
    requestedSubscriptionPlan: "",
    paymentStatus: "paid",
    accountStatus: "active",
    activatedAt: primary.activatedAt || DATASET_CREATED_AT,
    goldDatasetVersion: DATASET_VERSION,
    updatedAt: DATASET_CREATED_AT
  };
  const result = {};
  COLLECTION_NAMES.forEach((name) => {
    if (name === "users" || name === "settings") return;
    const rows = Array.isArray(collections[name]) ? collections[name] : [];
    result[name] = rows.filter((item) => isPreservedTechnicalRow(item, name)).map(clone);
  });
  result.protocols = result.protocols.filter((item) => normalizedCenterId(item.centerId) === "center_admin");
  result.users = [...superadmins.map(clone), primaryUser];
  const currentSettings = normalizedSettingsStore(collections.settings);
  const preservedSettings = {};
  if (currentSettings.center_admin) preservedSettings.center_admin = clone(currentSettings.center_admin);
  result.settings = {
    ...preservedSettings,
    [targetCenterId]: clone(dataset.settings)
  };
  result.clients = [...clone(dataset.clients), ...result.clients];
  result.services = [...clone(dataset.services), ...result.services];
  result.staff = [...clone(dataset.staff), ...result.staff];
  result.resources = [...clone(dataset.resources), ...result.resources];
  result.inventory = [...clone(dataset.inventory), ...result.inventory];
  result.shift_templates = [...clone(dataset.shiftTemplates), ...result.shift_templates];
  result.protocols = [
    ...clone(skinHarmonyProtocolLibrary),
    ...clone(dataset.protocols),
    ...result.protocols
  ];
  result.gold_imports = [structureManifest(dataset), ...result.gold_imports];
  assertInvariant(superadminSetDigest(result.users) === superadminSetDigest(users), "Superadmin modificato durante il prune", "gold_seed_superadmin_changed");
  return result;
}

const WAVE_COLLECTIONS = Object.freeze({
  appointments: "appointments",
  payments: "payments",
  shifts: "shifts",
  treatments: "treatments",
  inventory_movements: "inventoryMovements",
  cash_closures: "cashClosures",
  ai_marketing_actions: "aiMarketingActions",
  gold_action_outcomes: "goldActionOutcomes"
});

function planWaveCollections(collections = {}, centerId = "", dataset, wave = 1) {
  const targetCenterId = assertSafeTargetCenterId(centerId);
  assertInvariant(dataset?.centerId === targetCenterId, "Dataset e centerId target non coincidono");
  assertInvariant([1, 2, 3].includes(Number(wave)), "Ondata non valida", "gold_seed_invalid_wave");
  const result = clone(collections);
  const maxMonthIndex = Number(wave) * 6 - 1;
  Object.entries(WAVE_COLLECTIONS).forEach(([collectionName, historyKey]) => {
    const existing = Array.isArray(collections[collectionName]) ? collections[collectionName] : [];
    const base = existing.filter((item) => normalizedCenterId(item.centerId) !== targetCenterId).map(clone);
    const targetRows = dataset.history[historyKey]
      .filter((item) => Number(item.seedMonthIndex) <= maxMonthIndex)
      .map(clone);
    result[collectionName] = [...targetRows, ...base];
  });
  const existingClients = Array.isArray(collections.clients) ? collections.clients : [];
  result.clients = [
    ...clone(dataset.clientsAtWave(Number(wave))),
    ...existingClients.filter((item) => normalizedCenterId(item.centerId) !== targetCenterId).map(clone)
  ];
  const existingImports = Array.isArray(collections.gold_imports) ? collections.gold_imports : [];
  result.gold_imports = [
    {
      ...dataset.manifest,
      status: Number(wave) === 3 ? "history_complete" : "history_loading",
      appliedWaves: Array.from({ length: Number(wave) }, (_, index) => index + 1),
      updatedAt: DATASET_CREATED_AT
    },
    ...existingImports.filter((item) => normalizedCenterId(item.centerId) !== targetCenterId).map(clone)
  ];
  return result;
}

function dashboardSnapshotsForDataset(service, session, dataset) {
  return MONTH_KEYS.map((monthKey) => {
    const options = { period: "month", anchorDate: `${monthKey}-15` };
    const payload = service.computeDashboardStats(options, session);
    const id = service.getDashboardSnapshotId(options, session);
    return {
      id,
      centerId: dataset.centerId,
      plan: "gold",
      period: "month",
      anchorDate: `${monthKey}-15`,
      payload,
      generatedAt: DATASET_CREATED_AT,
      source: "gold_18m_seed_finalize",
      lastManualRefreshAt: "",
      datasetVersion: DATASET_VERSION,
      createdAt: DATASET_CREATED_AT,
      updatedAt: DATASET_CREATED_AT
    };
  });
}

function planFinalizeCollections(collections = {}, centerId = "", dataset, dashboardSnapshots = [], verification = null) {
  const targetCenterId = assertSafeTargetCenterId(centerId);
  const result = clone(collections);
  const currentSnapshots = Array.isArray(collections.dashboard_snapshots) ? collections.dashboard_snapshots : [];
  result.dashboard_snapshots = [
    ...clone(dashboardSnapshots),
    ...currentSnapshots.filter((item) => normalizedCenterId(item.centerId) !== targetCenterId).map(clone)
  ];
  const currentImports = Array.isArray(collections.gold_imports) ? collections.gold_imports : [];
  result.gold_imports = [
    {
      ...dataset.manifest,
      status: verification?.ok === false ? "verification_failed" : "complete",
      appliedWaves: [1, 2, 3],
      verification: verification ? {
        ok: verification.ok,
        checksPassed: verification.checks.filter((item) => item.ok).length,
        checksTotal: verification.checks.length,
        totals: verification.totals
      } : null,
      updatedAt: DATASET_CREATED_AT
    },
    ...currentImports.filter((item) => normalizedCenterId(item.centerId) !== targetCenterId).map(clone)
  ];
  return result;
}

function collectionsForService(service) {
  const collections = {};
  COLLECTION_NAMES.forEach((name) => {
    const repository = service[REPOSITORY_PROPERTIES[name]];
    assertInvariant(Boolean(repository), `Repository mancante: ${name}`);
    collections[name] = clone(repository.list());
  });
  return collections;
}

function changesForCollections(service, collections, names = COLLECTION_NAMES) {
  return names.map((name) => ({
    repository: service[REPOSITORY_PROPERTIES[name]],
    payload: collections[name]
  }));
}

function repositoryDescriptors(service) {
  return COLLECTION_NAMES.map((name) => {
    const repository = service[REPOSITORY_PROPERTIES[name]];
    return {
      name,
      filePath: repository.filePath,
      defaultValue: repository.defaultValue
    };
  });
}

async function initializeServiceRepositories(service, adapter) {
  assertInvariant(Boolean(adapter?.databaseUrl), "DATABASE_URL PostgreSQL obbligatorio", "gold_seed_postgres_required");
  await adapter.init(repositoryDescriptors(service));
  COLLECTION_NAMES.forEach((name) => {
    service[REPOSITORY_PROPERTIES[name]].setRevision(adapter.getRevision(name));
  });
}

async function commitCollections(service, collections, names = COLLECTION_NAMES) {
  await service.commitRepositorySnapshots(changesForCollections(service, collections, names));
}

async function flushLegacyWritesAndVerify(service, adapter) {
  const names = Array.from(adapter.legacyWriteChains.keys());
  if (!names.length) return [];
  await Promise.all(Array.from(adapter.legacyWriteChains.values()));
  for (const name of names) {
    const repository = service[REPOSITORY_PROPERTIES[name]];
    if (!repository) continue;
    const localPayload = repository.list();
    const remote = await adapter.readCollection(name);
    assertInvariant(
      sha256(stableStringify(localPayload)) === sha256(stableStringify(remote.payload)),
      `Persistenza legacy non riconciliata per ${name}`,
      "gold_seed_persistence_mismatch"
    );
    repository.acceptDurableCommit(remote.payload, remote.revision);
  }
  return names;
}

function check(name, condition, details = {}) {
  return { name, ok: Boolean(condition), details };
}

function intervalConflicts(rows = [], keyForRow = () => "") {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keyForRow(row);
    if (!key) return;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });
  const conflicts = [];
  groups.forEach((group, key) => {
    const ordered = group.slice().sort((left, right) =>
      String(left.startAt || "").localeCompare(String(right.startAt || ""))
      || String(left.id || "").localeCompare(String(right.id || ""))
    );
    for (let index = 1; index < ordered.length; index += 1) {
      if (String(ordered[index].startAt || "") < String(ordered[index - 1].endAt || "")) {
        conflicts.push({ key, leftId: ordered[index - 1].id || "", rightId: ordered[index].id || "" });
      }
    }
  });
  return conflicts;
}

function verifyGold18mCollections(
  collections = {},
  centerId = "",
  dataset = null,
  expectedSuperadminDigest = "",
  expectedTenantAuthDigest = "",
  { requireCompleteImportManifest = true } = {}
) {
  const targetCenterId = assertSafeTargetCenterId(centerId);
  const users = Array.isArray(collections.users) ? collections.users : [];
  const superadmins = users.filter((user) => normalizedRole(user) === "superadmin");
  const tenantUsers = users.filter((user) => normalizedRole(user) !== "superadmin");
  const tenantUser = tenantUsers[0] || {};
  const target = (name) => (Array.isArray(collections[name]) ? collections[name] : [])
    .filter((item) => normalizedCenterId(item.centerId) === targetCenterId);
  const clients = target("clients");
  const appointments = target("appointments");
  const completed = appointments.filter((item) => item.status === "completed");
  const payments = target("payments");
  const services = target("services");
  const staff = target("staff");
  const resources = target("resources");
  const inventory = target("inventory");
  const closures = target("cash_closures");
  const movements = target("inventory_movements");
  const shifts = target("shifts");
  const treatments = target("treatments");
  const shiftTemplateRows = target("shift_templates");
  const centerProtocols = target("protocols");
  const marketingActions = target("ai_marketing_actions");
  const actionOutcomes = target("gold_action_outcomes");
  const goldState = target("gold_state");
  const goldImports = target("gold_imports");
  const statusCounts = appointments.reduce((counts, appointment) => {
    const status = String(appointment.status || "unknown");
    counts[status] = Number(counts[status] || 0) + 1;
    return counts;
  }, {});
  const paymentByAppointment = new Map(payments.map((item) => [String(item.appointmentId || ""), item]));
  const appointmentIds = new Set(appointments.map((item) => String(item.id || "")));
  const clientIds = new Set(clients.map((item) => String(item.id || "")));
  const clientById = new Map(clients.map((item) => [String(item.id || ""), item]));
  const appointmentById = new Map(appointments.map((item) => [String(item.id || ""), item]));
  const serviceIds = new Set(services.map((item) => String(item.id || "")));
  const staffIds = new Set(staff.map((item) => String(item.id || "")));
  const inventoryIds = new Set(inventory.map((item) => String(item.id || "")));
  const resourceIds = new Set(resources.map((item) => String(item.id || "")));
  const serviceById = new Map(services.map((item) => [String(item.id || ""), item]));
  const staffById = new Map(staff.map((item) => [String(item.id || ""), item]));
  const monthly = Object.fromEntries(MONTH_KEYS.map((key) => [key, { payments: 0, revenueCents: 0 }]));
  payments.forEach((payment) => {
    const key = String(payment.createdAt || "").slice(0, 7);
    if (!monthly[key]) monthly[key] = { payments: 0, revenueCents: 0 };
    monthly[key].payments += 1;
    monthly[key].revenueCents += Number(payment.amountCents || 0);
  });
  const totalRevenueCents = payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const paymentDates = new Set(payments.map((item) => String(item.createdAt || "").slice(0, 10)));
  const closuresReconcile = closures.length === paymentDates.size
    && closures.every((closure) => {
      const datePayments = payments.filter((payment) => String(payment.createdAt || "").slice(0, 10) === closure.date);
      return datePayments.length === Number(closure.totalPayments || 0)
        && datePayments.reduce((sum, payment) => sum + Number(payment.amountCents || 0), 0) === Number(closure.revenueCents || 0);
    });
  const firstYearPayments = MONTH_KEYS.slice(0, 12).reduce((sum, key) => sum + Number(monthly[key]?.payments || 0), 0);
  const firstYearRevenueCents = MONTH_KEYS.slice(0, 12).reduce((sum, key) => sum + Number(monthly[key]?.revenueCents || 0), 0);
  const visitsByClient = new Map(clients.map((client) => [String(client.id || ""), 0]));
  completed.forEach((appointment) => {
    const clientId = String(appointment.clientId || "");
    visitsByClient.set(clientId, Number(visitsByClient.get(clientId) || 0) + 1);
  });
  const visitDistribution = Array.from(visitsByClient.values()).reduce((counts, visits) => {
    counts[visits] = Number(counts[visits] || 0) + 1;
    return counts;
  }, {});
  const expectedVisitDistribution = Object.fromEntries(
    CLIENT_VISIT_COUNT_DISTRIBUTION.map((item) => [String(item.visits), item.clients])
  );
  const tierCounts = clients.reduce((counts, client) => {
    const tier = String(client.loyaltyTier || "base").toLowerCase();
    counts[tier] = Number(counts[tier] || 0) + 1;
    return counts;
  }, {});
  const clientDayKeys = completed.map((appointment) =>
    `${appointment.clientId}:${String(appointment.startAt || "").slice(0, 10)}`
  );
  const noDuplicateClientDay = new Set(clientDayKeys).size === clientDayKeys.length;
  const closureCalendarRespected = appointments.every((appointment) =>
    !CLOSED_DATES.has(String(appointment.startAt || "").slice(0, 10))
  ) && shifts.every((shift) => !CLOSED_DATES.has(String(shift.date || "")))
    && closures.every((closure) => !CLOSED_DATES.has(String(closure.date || "")));
  const staffAvailabilityRespected = appointments.every((appointment) => {
    const operator = staffById.get(String(appointment.staffId || ""));
    return Boolean(operator && staffAvailabilityOnDate(operator, String(appointment.startAt || "").slice(0, 10)).available);
  }) && shifts.every((shift) => {
    const operator = staffById.get(String(shift.staffId || ""));
    return Boolean(operator && staffAvailabilityOnDate(operator, String(shift.date || "")).available);
  });
  const productReconciliationOk = payments.every((payment) => {
    const serviceTotal = (payment.serviceLines || []).reduce((sum, line) => sum + Number(line.salePriceCents || 0), 0);
    const productTotal = (payment.productSales || []).reduce((sum, line) => sum + Number(line.salePriceCents || 0) * Number(line.quantity || 0), 0);
    return serviceTotal + productTotal === Number(payment.amountCents || 0);
  });
  const referenceIntegrityOk = completed.every((appointment) =>
    clientIds.has(String(appointment.clientId || ""))
    && serviceIds.has(String(appointment.serviceId || ""))
    && staffIds.has(String(appointment.staffId || ""))
    && paymentByAppointment.has(String(appointment.id || ""))
  ) && payments.every((payment) =>
    appointmentIds.has(String(payment.appointmentId || ""))
    && clientIds.has(String(payment.clientId || ""))
    && String(appointmentById.get(String(payment.appointmentId || ""))?.clientId || "") === String(payment.clientId || "")
    && (payment.productSales || []).every((line) => inventoryIds.has(String(line.itemId || "")))
  ) && movements.every((movement) => inventoryIds.has(String(movement.itemId || "")));
  const technologyAppointments = appointments.filter((appointment) => {
    const service = serviceById.get(String(appointment.serviceId || ""));
    return Array.isArray(service?.technologyLinks) && service.technologyLinks.length > 0;
  });
  const completedTechnologyAppointments = technologyAppointments.filter((appointment) => appointment.status === "completed");
  const technologyResourceLinkageOk = technologyAppointments.every((appointment) => {
    const service = serviceById.get(String(appointment.serviceId || ""));
    const expectedResourceId = String(service?.technologyLinks?.[0]?.technologyId || "");
    return expectedResourceId
      && String(appointment.resourceId || "") === expectedResourceId
      && resourceIds.has(expectedResourceId);
  });
  const staffSkillAssignmentOk = appointments.every((appointment) => {
    const operator = staffById.get(String(appointment.staffId || ""));
    const service = serviceById.get(String(appointment.serviceId || ""));
    return Boolean(operator && service && Array.isArray(operator.serviceCategories) && operator.serviceCategories.includes(service.category));
  });
  const shiftByStaffDate = new Map(shifts.map((shift) => [`${shift.staffId}:${shift.date}`, shift]));
  const appointmentsWithinShifts = appointments.every((appointment) => {
    const date = String(appointment.startAt || "").slice(0, 10);
    const shift = shiftByStaffDate.get(`${appointment.staffId}:${date}`);
    if (!shift) return false;
    const startTime = String(appointment.startAt || "").slice(11, 16);
    const endTime = String(appointment.endAt || "").slice(11, 16);
    return startTime >= String(shift.startTime || "") && endTime <= String(shift.endTime || "");
  });
  const capacityAppointments = appointments.filter((item) => item.status !== "cancelled");
  const staffConflicts = intervalConflicts(capacityAppointments, (item) =>
    item.staffId ? `${item.staffId}:${String(item.startAt || "").slice(0, 10)}` : ""
  );
  const resourceConflicts = intervalConflicts(technologyAppointments.filter((item) => item.status !== "cancelled"), (item) =>
    item.resourceId ? `${item.resourceId}:${String(item.startAt || "").slice(0, 10)}` : ""
  );
  const completedCategoryCounts = completed.reduce((counts, appointment) => {
    const category = serviceById.get(String(appointment.serviceId || ""))?.category || "unknown";
    counts[category] = Number(counts[category] || 0) + 1;
    return counts;
  }, {});
  const otherTenantRows = COLLECTION_NAMES
    .filter((name) => !["settings", "users"].includes(name))
    .reduce((sum, name) => sum + (Array.isArray(collections[name]) ? collections[name] : [])
      .filter((item) => {
        const itemCenterId = normalizedCenterId(item.centerId);
        const canonicalGlobalProtocol = name === "protocols"
          && itemCenterId === GLOBAL_LIBRARY_CENTER_ID
          && isPreservedTechnicalRow(item, name);
        return itemCenterId !== targetCenterId
          && itemCenterId !== "center_admin"
          && !canonicalGlobalProtocol;
      }).length, 0);
  const settingsStore = normalizedSettingsStore(collections.settings);
  const settings = settingsStore[targetCenterId] || {};
  const settingsKeys = Object.keys(settingsStore);
  const exactSettingsKeys = settingsKeys.includes(targetCenterId)
    && settingsKeys.every((key) => key === targetCenterId || key === "center_admin");
  const servicePriceEvidenceOk = services.every((service) =>
    service.priceEvidence?.type === "observed_exact"
    && Boolean(PRICE_SOURCES[service.priceEvidence?.sourceKey])
    && Number(service.priceEvidence?.observedPriceCents || 0) === Number(service.priceCents || 0)
  );
  const profitability = computeCenterProfitabilitySnapshot({
    appointments,
    services,
    staff,
    payments,
    inventory,
    resources,
    fixedCostProfile: settings.goldFixedCostProfile || {}
  });
  const serviceProductCostCents = profitability.appointmentBreakdowns.reduce((sum, appointment) =>
    sum + (appointment.productBreakdown || []).reduce((productSum, product) =>
      productSum + Number(product.costCents || 0), 0
    ), 0
  );
  const internalUseCostCents = movements
    .filter((movement) => movement.type === "internal_use")
    .reduce((sum, movement) => sum + Number(movement.costCents || 0), 0);
  const retailMovementCostCents = movements
    .filter((movement) => movement.type === "sale")
    .reduce((sum, movement) => sum + Number(movement.costCents || 0), 0);
  const movementTypeCounts = movements.reduce((counts, movement) => {
    const type = String(movement.type || "");
    counts[type] = Number(counts[type] || 0) + 1;
    return counts;
  }, {});
  const stockLedgerReconciles = inventory.every((item) => {
    const signedQuantity = movements
      .filter((movement) => String(movement.itemId || "") === String(item.id || ""))
      .reduce((sum, movement) => {
        const quantity = Number(movement.quantity || 0);
        return sum + (["sale", "internal_use", "unload"].includes(String(movement.type || "")) ? -quantity : quantity);
      }, 0);
    return Math.abs(signedQuantity - Number(item.stockQuantity ?? item.quantity ?? 0)) < 0.01;
  });
  const serviceLinkCostsReconcile = services.every((service) => {
    const links = Array.isArray(service.productLinks) ? service.productLinks : [];
    if (!links.length) return true;
    const linkedCost = links.reduce((sum, link) => {
      const product = inventory.find((item) => String(item.id || "") === String(link.productId || ""));
      return sum + Math.round(Number(link.unitCostCents || product?.unitCostCents || product?.costCents || 0) * Number(link.usageUnits || 0));
    }, 0);
    return linkedCost === Number(service.estimatedProductCostCents || 0)
      && linkedCost === Number(service.costEvidence?.declaredProductCostCents || 0);
  });
  const globalProtocols = (Array.isArray(collections.protocols) ? collections.protocols : [])
    .filter((protocol) => normalizedCenterId(protocol.centerId) === GLOBAL_LIBRARY_CENTER_ID);
  const canonicalGlobalProtocolById = new Map(
    skinHarmonyProtocolLibrary.map((protocol) => [String(protocol.id || ""), protocol])
  );
  const allowedGlobalProtocolRuntimeFields = new Set(["createdAt", "updatedAt"]);
  const globalProtocolIds = new Set(globalProtocols.map((protocol) => String(protocol.id || "")));
  const canonicalGlobalProtocolsExact = globalProtocols.length === skinHarmonyProtocolLibrary.length
    && globalProtocolIds.size === skinHarmonyProtocolLibrary.length
    && skinHarmonyProtocolLibrary.every((protocol) => globalProtocolIds.has(String(protocol.id || "")))
    && globalProtocols.every((protocol) => {
      const expected = canonicalGlobalProtocolById.get(String(protocol.id || ""));
      if (!expected) return false;
      const expectedKeys = Object.keys(expected);
      const projected = Object.fromEntries(expectedKeys.map((key) => [key, protocol[key]]));
      const fieldsAllowed = Object.keys(protocol).every((key) =>
        expectedKeys.includes(key) || allowedGlobalProtocolRuntimeFields.has(key)
      );
      const runtimeTimestampsValid = ["createdAt", "updatedAt"].every((key) =>
        protocol[key] === undefined || isCanonicalIsoTimestamp(protocol[key])
      );
      return fieldsAllowed
        && runtimeTimestampsValid
        && stableStringify(projected) === stableStringify(expected);
    });
  const settingsDatasetExact = !dataset || stableStringify(settings) === stableStringify(dataset.settings);
  const marketingPayloadExact = !dataset || (
    stableStringify(marketingActions.slice().sort((left, right) => String(left.id || "").localeCompare(String(right.id || ""))))
      === stableStringify(dataset.history.aiMarketingActions.slice().sort((left, right) => String(left.id || "").localeCompare(String(right.id || ""))))
    && stableStringify(actionOutcomes.slice().sort((left, right) => String(left.id || "").localeCompare(String(right.id || ""))))
      === stableStringify(dataset.history.goldActionOutcomes.slice().sort((left, right) => String(left.id || "").localeCompare(String(right.id || ""))))
  );
  const marketingActionById = new Map(marketingActions.map((action) => [String(action.id || ""), action]));
  const marketingOutcomeActionIds = new Set(actionOutcomes.map((outcome) => String(outcome.actionId || "")));
  const marketingHistoryCoherent = marketingActions.length === actionOutcomes.length
    && marketingOutcomeActionIds.size === marketingActions.length
    && actionOutcomes.every((outcome) => {
      const action = marketingActionById.get(String(outcome.actionId || ""));
      const client = clientById.get(String(outcome.entityId || ""));
      const basisAppointment = appointmentById.get(String(outcome.basisAppointmentId || ""));
      const generatedAt = String(action?.generatedAt || "");
      const generatedAtMs = Date.parse(generatedAt);
      const basisAppointmentMs = Date.parse(String(basisAppointment?.startAt || ""));
      const observedVisitCount = completed.filter((appointment) =>
        String(appointment.clientId || "") === String(client?.id || "")
        && String(appointment.startAt || "") <= String(basisAppointment?.startAt || "")
      ).length;
      if (!action || !client || client.marketingConsent !== true || !basisAppointment) return false;
      if (String(action.clientId || "") !== String(client.id || "")
        || String(basisAppointment.clientId || "") !== String(client.id || "")
        || basisAppointment.status !== "completed"
        || String(action.basisAppointmentId || "") !== String(basisAppointment.id || "")
        || !isCanonicalIsoTimestamp(basisAppointment.startAt)
        || !isCanonicalIsoTimestamp(generatedAt)
        || basisAppointmentMs >= generatedAtMs
        || generatedAtMs > Date.parse(DATASET_CREATED_AT)
        || String(action.updatedAt || "") !== generatedAt
        || String(action.approvedAt || "") !== generatedAt
        || Number(action.observedVisitCount || 0) !== observedVisitCount
        || observedVisitCount < 4) {
        return false;
      }
      const convertedAppointmentId = String(outcome.convertedAppointmentId || "");
      if (outcome.success === true) {
        const convertedAppointment = appointmentById.get(convertedAppointmentId);
        const convertedPayment = paymentByAppointment.get(convertedAppointmentId);
        const convertedAt = String(convertedAppointment?.startAt || "");
        return action.status === "done"
          && outcome.outcome === "booked"
          && String(action.convertedAppointmentId || "") === convertedAppointmentId
          && Boolean(convertedAppointment && convertedPayment)
          && convertedAppointment.status === "completed"
          && String(convertedAppointment.clientId || "") === String(client.id || "")
          && String(convertedPayment.appointmentId || "") === String(convertedAppointment.id || "")
          && String(convertedPayment.clientId || "") === String(client.id || "")
          && isCanonicalIsoTimestamp(convertedAt)
          && Date.parse(convertedAt) > generatedAtMs
          && String(outcome.createdAt || "") === convertedAt
          && isCanonicalIsoTimestamp(outcome.createdAt)
          && String(action.completedAt || "") === generatedAt
          && isCanonicalIsoTimestamp(action.completedAt)
          && !String(action.archivedAt || "")
          && Number(outcome.valueCents || 0) === Number(convertedPayment.amountCents || 0)
          && Number(action.estimatedValueCents || 0) === Number(convertedPayment.amountCents || 0)
          && Number(action.referenceValueCents || 0) === Number(convertedPayment.amountCents || 0);
      }
      return outcome.success === false
        && action.status === "archived"
        && outcome.outcome === "not_converted"
        && !String(action.convertedAppointmentId || "")
        && !convertedAppointmentId
        && Number(outcome.valueCents || 0) === 0
        && !String(action.completedAt || "")
        && String(action.archivedAt || "") === generatedAt
        && isCanonicalIsoTimestamp(action.archivedAt)
        && String(outcome.createdAt || "") === generatedAt
        && isCanonicalIsoTimestamp(outcome.createdAt)
        && !completed.some((appointment) =>
          String(appointment.clientId || "") === String(client.id || "")
          && String(appointment.startAt || "") > generatedAt
        );
    });
  const profitabilityProductRolesSeparated = profitability.products.every((product) =>
    ["service_consumption", "retail_sale"].includes(String(product.economicRole || ""))
    && String(product.id || "") === `${String(product.productId || "")}:${String(product.economicRole || "")}`
  ) && profitability.products
    .filter((product) => product.economicRole === "service_consumption")
    .every((product) => Number(product.revenueCents || 0) === 0
      && product.marginPercent === null
      && product.status === "COST_ONLY")
    && profitability.products
      .filter((product) => product.economicRole === "retail_sale")
      .reduce((sum, product) => sum + Number(product.revenueCents || 0), 0) === Number(profitability.totals?.retailRevenueCents || 0);
  const orderedRows = (rows = []) => rows.slice().sort((left, right) =>
    String(left.id || "").localeCompare(String(right.id || ""))
  );
  const expectedManagedCollections = dataset ? {
    clients: orderedRows(dataset.clientsAtWave(3)),
    appointments: orderedRows(dataset.history.appointments),
    services: orderedRows(dataset.services),
    staff: orderedRows(dataset.staff),
    shifts: orderedRows(dataset.history.shifts),
    shift_templates: orderedRows(dataset.shiftTemplates),
    resources: orderedRows(dataset.resources),
    inventory: orderedRows(dataset.inventory),
    inventory_movements: orderedRows(dataset.history.inventoryMovements),
    payments: orderedRows(dataset.history.payments),
    cash_closures: orderedRows(dataset.history.cashClosures),
    treatments: orderedRows(dataset.history.treatments),
    protocols: orderedRows(dataset.protocols),
    ai_marketing_actions: orderedRows(dataset.history.aiMarketingActions),
    gold_action_outcomes: orderedRows(dataset.history.goldActionOutcomes)
  } : null;
  const actualManagedCollections = dataset ? Object.fromEntries(
    Object.keys(expectedManagedCollections).map((name) => [name, orderedRows(target(name))])
  ) : null;
  const expectedManagedStateDigest = dataset ? sha256(stableStringify(expectedManagedCollections)) : "";
  const actualManagedStateDigest = dataset ? sha256(stableStringify(actualManagedCollections)) : "";
  const managedDatasetPayloadExact = !dataset || actualManagedStateDigest === expectedManagedStateDigest;
  const whatsappQueueEmpty = target("whatsapp_messages").length === 0;
  const tenantOperationalProfileExact = tenantUsers.length === 1
    && normalizedCenterId(tenantUser.centerId) === targetCenterId
    && String(tenantUser.centerName || "") === String(dataset?.centerName || "")
    && String(tenantUser.businessModel || "") === "hybrid_beauty_hair"
    && tenantUser.active === true
    && String(tenantUser.planType || "") === "active"
    && String(tenantUser.subscriptionPlan || "") === "gold"
    && String(tenantUser.requestedSubscriptionPlan || "") === ""
    && String(tenantUser.paymentStatus || "") === "paid"
    && String(tenantUser.accountStatus || "") === "active"
    && String(tenantUser.goldDatasetVersion || "") === DATASET_VERSION
    && isCanonicalIsoTimestamp(tenantUser.activatedAt);
  const checks = [
    check("superadmin_preserved", superadmins.length >= 1, { count: superadmins.length }),
    check("superadmin_set_unchanged", !expectedSuperadminDigest || superadminSetDigest(users) === expectedSuperadminDigest),
    check("single_tenant_account", tenantUsers.length === 1 && normalizedCenterId(tenantUsers[0]?.centerId) === targetCenterId, { count: tenantUsers.length }),
    check("tenant_auth_unchanged", !expectedTenantAuthDigest
      || tenantAuthDigest(users, String(tenantUsers[0]?.id || "")) === expectedTenantAuthDigest),
    check("tenant_operational_profile_exact", tenantOperationalProfileExact),
    check("tenant_plan_gold", String(tenantUsers[0]?.subscriptionPlan || "").toLowerCase() === "gold"),
    check("staff_exact", staff.length === 4, { actual: staff.length, expected: 4 }),
    check("technologies_exact", resources.length === 3, { actual: resources.length, expected: 3 }),
    check("staff_payroll_present", staff.reduce((sum, item) => sum + Number(item.grossSalaryCents || 0), 0) === 660000, {
      actual: staff.reduce((sum, item) => sum + Number(item.grossSalaryCents || 0), 0),
      expected: 660000
    }),
    check("clients_synthetic", clients.length === 1100 && clients.every((item) => item.synthetic === true && String(item.email || "").endsWith(".invalid")), { actual: clients.length }),
    check("client_visit_distribution_exact", stableStringify(visitDistribution) === stableStringify(expectedVisitDistribution), {
      actual: visitDistribution,
      expected: expectedVisitDistribution
    }),
    check("loyalty_tiers_exercised", ["base", "pearl", "silver", "gold"].every((tier) => Number(tierCounts[tier] || 0) > 0), tierCounts),
    check("loyalty_tier_distribution_exact", stableStringify(tierCounts) === stableStringify({
      base: 750,
      pearl: 265,
      silver: 63,
      gold: 22
    }), tierCounts),
    check("client_single_checkout_per_day", noDuplicateClientDay),
    check("checkout_total", payments.length === TOTAL_CHECKOUTS && completed.length === TOTAL_CHECKOUTS, { payments: payments.length, completed: completed.length, expected: TOTAL_CHECKOUTS }),
    check("appointment_status_totals_exact", appointments.length === 5460
      && Number(statusCounts.completed || 0) === 5250
      && Number(statusCounts.no_show || 0) === 126
      && Number(statusCounts.cancelled || 0) === 84, statusCounts),
    check("revenue_total", totalRevenueCents === TOTAL_REVENUE_CENTS, { actual: totalRevenueCents, expected: TOTAL_REVENUE_CENTS }),
    check("first_year_volume", firstYearPayments === 3500, { actual: firstYearPayments, expected: 3500 }),
    check("first_year_revenue", firstYearRevenueCents === FIRST_YEAR_REVENUE_CENTS, { actual: firstYearRevenueCents, expected: FIRST_YEAR_REVENUE_CENTS }),
    check("month_coverage", MONTH_KEYS.every((key) => Number(monthly[key]?.payments || 0) > 0), { months: MONTH_KEYS.length }),
    check("monthly_checkout_targets_exact", MONTH_KEYS.every((key, index) => Number(monthly[key]?.payments || 0) === MONTHLY_CHECKOUTS[index])),
    check("monthly_revenue_targets_exact", MONTH_KEYS.every((key, index) => Number(monthly[key]?.revenueCents || 0) === monthRevenueTargets()[index])),
    check("service_category_totals_exact", Object.entries(CATEGORY_TOTALS).every(([category, expected]) => Number(completedCategoryCounts[category] || 0) === expected), completedCategoryCounts),
    check("payment_one_to_one", payments.length === new Set(payments.map((item) => item.appointmentId)).size && completed.every((item) => paymentByAppointment.has(item.id))),
    check("payment_lines_reconcile", productReconciliationOk),
    check("referential_integrity", referenceIntegrityOk),
    check("staff_skill_assignment_valid", staffSkillAssignmentOk),
    check("appointments_within_shifts", appointmentsWithinShifts),
    check("staff_schedule_no_overlap", staffConflicts.length === 0, { conflicts: staffConflicts.length }),
    check("closure_calendar_respected", closureCalendarRespected),
    check("staff_days_off_and_leave_respected", staffAvailabilityRespected),
    check("shift_history_exact", shifts.length === 1443, { actual: shifts.length, expected: 1443 }),
    check("technology_resource_linkage", technologyResourceLinkageOk, { appointments: technologyAppointments.length }),
    check("technology_resource_no_overlap", resourceConflicts.length === 0, { conflicts: resourceConflicts.length }),
    check("cash_closures_reconcile", closuresReconcile, { actual: closures.length, expected: paymentDates.size }),
    check("cash_closures_exact", closures.length === 445, { actual: closures.length, expected: 445 }),
    check("inventory_non_negative", inventory.every((item) => Number(item.quantity || 0) >= 0 && Number(item.stockQuantity || 0) >= 0)),
    check("inventory_catalog_exact", inventory.length === 10, { actual: inventory.length, expected: 10 }),
    check("inventory_movement_mix_exact", stableStringify(movementTypeCounts) === stableStringify({
      load: 10,
      sale: 1155,
      internal_use: 126,
      replenish: 180
    }), movementTypeCounts),
    check("inventory_stock_ledger_reconciles", stockLedgerReconciles),
    check("service_consumption_cost_reconciles", internalUseCostCents === serviceProductCostCents, {
      movementCostCents: internalUseCostCents,
      profitabilityCostCents: serviceProductCostCents
    }),
    check("retail_cogs_reconciles", retailMovementCostCents === Number(profitability.totals?.retailCostCents || 0), {
      movementCostCents: retailMovementCostCents,
      profitabilityCostCents: Number(profitability.totals?.retailCostCents || 0)
    }),
    check("service_product_links_reconcile", serviceLinkCostsReconcile),
    check("fixed_costs_server_side", Number(settings.goldFixedCostProfile?.rent || 0) > 0 && Number(settings.goldFixedCostProfile?.accountant || 0) > 0),
    check("price_evidence_present", inventory.every((item) => item.priceEvidence?.accessedAt === "2026-07-26") && resources.every((item) => item.priceEvidence?.accessedAt === "2026-07-26")),
    check("service_price_evidence_exact", servicePriceEvidenceOk),
    check("profitability_revenue_exact", Number(profitability.totals?.revenueCents || 0) === totalRevenueCents, {
      actual: Number(profitability.totals?.revenueCents || 0),
      expected: totalRevenueCents
    }),
    check("profitability_payroll_complete", Number(profitability.operatingCostMinuteProfile?.staffMonthlyCents || 0) === 660000),
    check("profitability_owner_payroll_once", Number(profitability.operatingCostMinuteProfile?.ownerPayrollMonthlyCents || 0) === 180000
      && profitability.operatingCostMinuteProfile?.ownerIncludedInStaff === false),
    check("profitability_monthly_baseline_complete", Number(profitability.operatingCostMinuteProfile?.totalMonthlyBaselineCents || 0) === 1413468, {
      actual: Number(profitability.operatingCostMinuteProfile?.totalMonthlyBaselineCents || 0),
      expected: 1413468
    }),
    check("profitability_retail_separated", Number(profitability.totals?.retailRevenueCents || 0) === 3109943
      && Number(profitability.totals?.retailCostCents || 0) === 1716018),
    check("profitability_product_roles_separated", profitabilityProductRolesSeparated),
    check("profitability_technology_complete", completedTechnologyAppointments.length === CATEGORY_TOTALS.technology
      && Number(profitability.technologies?.reduce((sum, item) => sum + Number(item.totalUses || 0), 0) || 0) === CATEGORY_TOTALS.technology),
    check("cross_tenant_residue_zero", otherTenantRows === 0, { actual: otherTenantRows }),
    check("settings_keys_exact", exactSettingsKeys, { keys: settingsKeys.sort() }),
    check("settings_dataset_exact", settingsDatasetExact),
    check("whatsapp_queue_empty", whatsappQueueEmpty),
    check("gold_state_single", goldState.length === 1, { actual: goldState.length }),
    check("service_catalog_exact", services.length === 18, { actual: services.length, expected: 18 }),
    check("treatments_exact", treatments.length === 1050, { actual: treatments.length, expected: 1050 }),
    check("shift_templates_exact", shiftTemplateRows.length === 4, { actual: shiftTemplateRows.length, expected: 4 }),
    check("center_protocols_exact", centerProtocols.length === 60, { actual: centerProtocols.length, expected: 60 }),
    check("canonical_global_protocols_exact", canonicalGlobalProtocolsExact, {
      actual: globalProtocols.length,
      expected: skinHarmonyProtocolLibrary.length
    }),
    check("gold_marketing_history_exact", marketingActions.length === 36 && actionOutcomes.length === 36, {
      actions: marketingActions.length,
      outcomes: actionOutcomes.length
    }),
    check("gold_marketing_history_coherent", marketingHistoryCoherent),
    check("gold_marketing_payload_exact", marketingPayloadExact),
    check("managed_dataset_payload_exact", managedDatasetPayloadExact, {
      actualDigest: actualManagedStateDigest,
      expectedDigest: expectedManagedStateDigest
    }),
    check("gold_import_manifest_exact", !requireCompleteImportManifest || isCompleteGoldImportManifest(goldImports, dataset), {
      actual: goldImports.length
    }),
    check("dataset_digest_matches", !dataset || (
      String(goldImports[0]?.datasetDigest || "") === dataset.manifest.datasetDigest
      && managedDatasetPayloadExact
    ))
  ];
  return {
    ok: checks.every((item) => item.ok),
    datasetVersion: DATASET_VERSION,
    centerId: targetCenterId,
    totals: {
      clients: clients.length,
      appointments: appointments.length,
      completedAppointments: completed.length,
      payments: payments.length,
      revenueCents: totalRevenueCents,
      staff: staff.length,
      technologies: resources.length,
      services: services.length,
      inventoryItems: inventory.length,
      inventoryMovements: movements.length,
      cashClosures: closures.length,
      firstYearPayments,
      firstYearRevenueCents
    },
    monthly,
    managedState: {
      actualDigest: actualManagedStateDigest,
      expectedDigest: expectedManagedStateDigest
    },
    checks
  };
}

function runtimeGoldSummary(service, centerId, centerName) {
  const session = {
    userId: "gold18m_runtime_verify",
    username: "gold18m_runtime_verify",
    role: "owner",
    centerId,
    centerName,
    subscriptionPlan: "gold",
    planType: "active",
    paymentStatus: "paid",
    accountStatus: "active",
    accessState: "active",
    supportMode: true
  };
  const profitability = service.getProfitabilityOverview({
    startDate: "2025-01-01",
    endDate: "2026-06-30",
    forceRefresh: true
  }, session);
  const cockpit = service.getAiGoldCockpit({}, session);
  return {
    session,
    summary: {
      cockpitVersion: cockpit.cockpitVersion || "",
      cockpitSections: Array.isArray(cockpit.sections)
        ? cockpit.sections.map((item) => ({ key: item.key, status: item.status || "", items: item.items?.length || 0 }))
        : [],
      cockpitReadOnly: cockpit.governance?.readOnly !== false,
      profitabilityRevenueCents: Number(profitability.totals?.revenueCents || profitability.revenueCents || 0),
      profitabilityConfidence: profitability.confidence || profitability.confidenceLabel || profitability.meta?.confidence || "",
      centerHealthStatus: profitability.centerHealth?.status || ""
    }
  };
}

module.exports = {
  DATASET_VERSION,
  DATASET_CENTER_NAME,
  DATASET_CREATED_AT,
  MONTH_KEYS,
  MONTHLY_CHECKOUTS,
  TOTAL_CHECKOUTS,
  TOTAL_REVENUE_CENTS,
  FIRST_YEAR_REVENUE_CENTS,
  CLIENT_VISIT_COUNT_DISTRIBUTION,
  CLOSED_DATES,
  CATEGORY_TOTALS,
  COLLECTION_NAMES,
  REPOSITORY_PROPERTIES,
  PRICE_SOURCES,
  stableStringify,
  sha256,
  allocateInteger,
  buildGold18mDataset,
  auditCollections,
  buildApplyDigest,
  planStructureCollections,
  planWaveCollections,
  planFinalizeCollections,
  dashboardSnapshotsForDataset,
  collectionsForService,
  changesForCollections,
  repositoryDescriptors,
  initializeServiceRepositories,
  commitCollections,
  flushLegacyWritesAndVerify,
  verifyGold18mCollections,
  runtimeGoldSummary,
  assertSafeTargetCenterId,
  assertSafeTargetCenterName,
  userRecordFingerprint,
  superadminSetDigest,
  tenantAuthDigest,
  collectionDigests
};
