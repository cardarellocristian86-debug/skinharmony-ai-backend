const { CoreliaBridge } = require("./corelia/CoreliaBridge");
const { NyraDialogueAdapter } = require("./nyra/NyraDialogueAdapter");

const ACTIONS = [
  "open_dashboard",
  "open_agenda",
  "open_clients",
  "open_client_form",
  "open_client_details",
  "open_inventory",
  "open_reports",
  "open_operator_report",
  "open_turns",
  "open_attendance",
  "open_profitability",
  "open_cashdesk",
  "open_protocols",
  "open_training",
  "open_settings",
  "search_client",
  "create_client",
  "create_appointment",
  "create_shift",
  "create_note",
  "create_task",
  "filter_appointments",
  "filter_clients"
];

const ACTION_PERMISSIONS = {
  open_dashboard: "UI_NAVIGATION",
  open_agenda: "UI_NAVIGATION",
  open_clients: "UI_NAVIGATION",
  open_client_form: "UI_NAVIGATION",
  open_client_details: "UI_NAVIGATION",
  open_inventory: "UI_NAVIGATION",
  open_reports: "UI_NAVIGATION",
  open_operator_report: "UI_NAVIGATION",
  open_turns: "UI_NAVIGATION",
  open_attendance: "UI_NAVIGATION",
  open_profitability: "UI_NAVIGATION",
  open_cashdesk: "UI_NAVIGATION",
  open_protocols: "UI_NAVIGATION",
  open_training: "UI_NAVIGATION",
  open_settings: "UI_NAVIGATION",
  search_client: "UI_NAVIGATION",
  filter_appointments: "UI_NAVIGATION",
  filter_clients: "UI_NAVIGATION",
  create_client: "SAFE_ACTIONS",
  create_appointment: "SAFE_ACTIONS",
  create_shift: "SAFE_ACTIONS",
  create_note: "SAFE_ACTIONS",
  create_task: "SAFE_ACTIONS"
};

const ROLE_CAPABILITIES = {
  superadmin: ["INFO_ONLY", "UI_NAVIGATION", "SAFE_ACTIONS"],
  owner: ["INFO_ONLY", "UI_NAVIGATION", "SAFE_ACTIONS"],
  admin: ["INFO_ONLY", "UI_NAVIGATION", "SAFE_ACTIONS"],
  manager: ["INFO_ONLY", "UI_NAVIGATION", "SAFE_ACTIONS"],
  staff: ["INFO_ONLY", "UI_NAVIGATION", "SAFE_ACTIONS"],
  viewer: ["INFO_ONLY", "UI_NAVIGATION"]
};

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["answer", "action", "blocked_action"] },
    message: { type: "string" },
    action: {
      anyOf: [
        { type: "string", enum: ACTIONS },
        { type: "null" }
      ]
    },
    payload: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { anyOf: [{ type: "string" }, { type: "null" }] },
        clientId: { anyOf: [{ type: "string" }, { type: "null" }] },
        operatorId: { anyOf: [{ type: "string" }, { type: "null" }] },
        section: { anyOf: [{ type: "string" }, { type: "null" }] },
        firstName: { anyOf: [{ type: "string" }, { type: "null" }] },
        lastName: { anyOf: [{ type: "string" }, { type: "null" }] },
        phone: { anyOf: [{ type: "string" }, { type: "null" }] },
        noContact: { anyOf: [{ type: "boolean" }, { type: "null" }] },
        walkInName: { anyOf: [{ type: "string" }, { type: "null" }] },
        email: { anyOf: [{ type: "string" }, { type: "null" }] },
        period: { anyOf: [{ type: "string" }, { type: "null" }] },
        startDate: { anyOf: [{ type: "string" }, { type: "null" }] },
        endDate: { anyOf: [{ type: "string" }, { type: "null" }] },
        date: { anyOf: [{ type: "string" }, { type: "null" }] },
        view: { anyOf: [{ type: "string" }, { type: "null" }] },
        status: { anyOf: [{ type: "string" }, { type: "null" }] },
        title: { anyOf: [{ type: "string" }, { type: "null" }] },
        note: { anyOf: [{ type: "string" }, { type: "null" }] },
        time: { anyOf: [{ type: "string" }, { type: "null" }] },
        durationMin: { anyOf: [{ type: "number" }, { type: "null" }] },
        clientName: { anyOf: [{ type: "string" }, { type: "null" }] },
        staffId: { anyOf: [{ type: "string" }, { type: "null" }] },
        staffName: { anyOf: [{ type: "string" }, { type: "null" }] },
        serviceId: { anyOf: [{ type: "string" }, { type: "null" }] },
        serviceName: { anyOf: [{ type: "string" }, { type: "null" }] },
        startTime: { anyOf: [{ type: "string" }, { type: "null" }] },
        endTime: { anyOf: [{ type: "string" }, { type: "null" }] }
      },
      required: ["query", "clientId", "operatorId", "section", "firstName", "lastName", "phone", "noContact", "walkInName", "email", "period", "startDate", "endDate", "date", "view", "status", "title", "note", "time", "durationMin", "clientName", "staffId", "staffName", "serviceId", "serviceName", "startTime", "endTime"]
    },
    requiresConfirmation: { type: "boolean" }
  },
  required: ["mode", "message", "action", "payload", "requiresConfirmation"]
};

function normalizeRole(role) {
  const safe = String(role || "owner").toLowerCase();
  return ROLE_CAPABILITIES[safe] ? safe : "owner";
}

function canUseAction(role, action) {
  const permission = ACTION_PERMISSIONS[action] || "INFO_ONLY";
  return (ROLE_CAPABILITIES[normalizeRole(role)] || ROLE_CAPABILITIES.owner).includes(permission);
}

function formatLocalDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return formatLocalDate(new Date());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateOnly(value) {
  if (!value) return formatLocalDate(new Date());
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return formatLocalDate(new Date());
  return formatLocalDate(parsed);
}

function shiftDate(dateValue, days) {
  const base = new Date(`${toDateOnly(dateValue)}T00:00:00`);
  base.setDate(base.getDate() + Number(days || 0));
  return toDateOnly(base);
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ")
  };
}

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(value) {
  return stripAccents(value).toLowerCase().trim();
}

function extractPhone(value) {
  const match = String(value || "").match(/(\+?\d[\d\s]{5,})$/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function extractClientDraft(message) {
  const raw = String(message || "").trim();
  const match = raw.match(/(?:aggiungi|crea|inserisci)\s+cliente\s+(.+)/i);
  if (!match) return null;
  const tail = match[1].trim();
  const phone = extractPhone(tail);
  const noContact = /(senza\s+(telefono|numero|contatto|email|mail)|non\s+vuole\s+lasciare|no\s+contatto)/i.test(tail);
  const namePart = (phone ? tail.replace(/(\+?\d[\d\s]{5,})$/, "") : tail)
    .replace(/senza\s+(telefono|numero|contatto|email|mail)/ig, "")
    .replace(/non\s+vuole\s+lasciare\s+(telefono|numero|contatto|email|mail)/ig, "")
    .replace(/no\s+contatto/ig, "")
    .trim();
  const names = splitName(namePart);
  return {
    firstName: names.firstName,
    lastName: names.lastName,
    phone,
    noContact
  };
}

function parseAgendaFilter(message) {
  const normalized = normalizeText(message);
  if (!/(filtra|mostra).*(agenda|appuntamenti)/.test(normalized)) return null;
  let date = "";
  if (normalized.includes("domani")) date = shiftDate(new Date(), 1);
  else if (normalized.includes("ieri")) date = shiftDate(new Date(), -1);
  else if (normalized.includes("oggi")) date = toDateOnly(new Date());
  const statusMap = [
    ["confermat", "confirmed"],
    ["richiest", "requested"],
    ["arrivat", "arrived"],
    ["in corso", "in_progress"],
    ["checkout", "ready_checkout"],
    ["completat", "completed"],
    ["annullat", "cancelled"],
    ["no show", "no_show"]
  ];
  const status = statusMap.find(([label]) => normalized.includes(label))?.[1] || "";
  return { date, status };
}

function nextWeekdayDate(weekdayIndex) {
  const base = new Date();
  const current = base.getDay();
  let delta = weekdayIndex - current;
  if (delta <= 0) delta += 7;
  base.setDate(base.getDate() + delta);
  return toDateOnly(base);
}

function parseDateFromText(message) {
  const raw = String(message || "");
  const normalized = normalizeText(raw);
  if (normalized.includes("dopodomani")) return shiftDate(new Date(), 2);
  if (normalized.includes("domani")) return shiftDate(new Date(), 1);
  if (normalized.includes("oggi")) return toDateOnly(new Date());
  const isoMatch = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const italianMatch = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (italianMatch) {
    const day = italianMatch[1].padStart(2, "0");
    const month = italianMatch[2].padStart(2, "0");
    const currentYear = new Date().getFullYear();
    const year = italianMatch[3]
      ? (italianMatch[3].length === 2 ? `20${italianMatch[3]}` : italianMatch[3])
      : String(currentYear);
    return `${year}-${month}-${day}`;
  }
  const weekdays = [
    ["domenica", 0],
    ["lunedi", 1],
    ["lunedì", 1],
    ["martedi", 2],
    ["martedì", 2],
    ["mercoledi", 3],
    ["mercoledì", 3],
    ["giovedi", 4],
    ["giovedì", 4],
    ["venerdi", 5],
    ["venerdì", 5],
    ["sabato", 6]
  ];
  const found = weekdays.find(([label]) => normalized.includes(stripAccents(label)));
  return found ? nextWeekdayDate(found[1]) : "";
}

function parseTimeFromText(message) {
  const raw = String(message || "");
  const explicitMatch = raw.match(/\b(?:alle|ore)\s+(\d{1,2})(?:[:.,](\d{2}))?\b/i);
  const match = explicitMatch || raw.match(/\b(\d{1,2})[:.,](\d{2})\b/i);
  if (!match) return "";
  const hour = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseShiftTimesFromText(message) {
  const raw = String(message || "");
  const range = raw.match(/\b(?:dalle|da)\s+(\d{1,2})(?:[:.,](\d{2}))?\s+(?:alle|a)\s+(\d{1,2})(?:[:.,](\d{2}))?\b/i);
  if (range) {
    const startHour = Number(range[1]);
    const startMinutes = range[2] ? Number(range[2]) : 0;
    const endHour = Number(range[3]);
    const endMinutes = range[4] ? Number(range[4]) : 0;
    if (startHour >= 0 && startHour <= 23 && startMinutes >= 0 && startMinutes <= 59 && endHour >= 0 && endHour <= 23 && endMinutes >= 0 && endMinutes <= 59) {
      return [
        `${String(startHour).padStart(2, "0")}:${String(startMinutes).padStart(2, "0")}`,
        `${String(endHour).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`
      ];
    }
  }
  return [];
}

function parseDurationFromText(message, fallback = 45) {
  const raw = String(message || "");
  const hoursMatch = raw.match(/\b(\d+(?:[,.]\d+)?)\s*(?:ore|ora|h)\b/i);
  if (hoursMatch) return Math.max(15, Math.round(Number(hoursMatch[1].replace(",", ".")) * 60));
  const minutesMatch = raw.match(/\b(\d{2,3})\s*(?:minuti|min)\b/i);
  if (minutesMatch) return Math.max(15, Number(minutesMatch[1]));
  return fallback;
}

function buildAnswer(message, payload = {}) {
  return { mode: "answer", message, action: null, payload, requiresConfirmation: false };
}

function buildAction(message, action, payload = {}, requiresConfirmation = false) {
  return { mode: "action", message, action, payload, requiresConfirmation };
}

function buildBlocked(message, action = null, payload = {}) {
  return { mode: "blocked_action", message, action, payload, requiresConfirmation: false };
}

function significantTokens(value) {
  const stop = new Set([
    "ai", "gold", "test", "top", "stylist", "senior", "junior", "lento",
    "operatore", "responsabile", "premium", "redditivo", "redditiva",
    "promo", "perdita", "scontata", "scontato"
  ]);
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !stop.has(item));
}

function buildConfirmationMessage(action, payload = {}, fallback = "Confermi il salvataggio?") {
  if (action === "create_client") {
    const name = [payload.firstName, payload.lastName].filter(Boolean).join(" ") || "nuovo cliente";
    const contact = payload.noContact ? " senza telefono/email" : payload.phone ? ` con telefono ${payload.phone}` : "";
    return `Ho preparato il cliente ${name}${contact}. Confermi il salvataggio?`;
  }
  if (action === "create_appointment") {
    const client = payload.walkInName || payload.clientName || "cliente";
    const service = payload.serviceName ? ` per ${payload.serviceName}` : "";
    const staff = payload.staffName ? ` con ${payload.staffName}` : "";
    const date = payload.date ? ` il ${payload.date}` : "";
    const time = payload.time ? ` alle ${payload.time}` : "";
    return `Ho preparato l'appuntamento per ${client}${date}${time}${service}${staff}. Confermi il salvataggio?`;
  }
  if (action === "create_shift") {
    const staff = payload.staffName || "operatore";
    return `Ho preparato il turno per ${staff} il ${payload.date || "giorno indicato"} dalle ${payload.startTime || "--"} alle ${payload.endTime || "--"}. Confermi il salvataggio?`;
  }
  return fallback;
}

function hasAnyPayloadValue(payload = {}) {
  return Object.values(payload || {}).some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "number") return Number.isFinite(value) && value !== 0;
    return String(value).trim() !== "";
  });
}

class AssistantService {
  constructor(desktopMirror) {
    this.desktopMirror = desktopMirror;
    this.coreliaBridge = desktopMirror ? new CoreliaBridge(desktopMirror) : null;
    this.nyraDialogue = new NyraDialogueAdapter();
  }

  getAiProviderMode() {
    const mode = String(process.env.SMARTDESK_AI_PROVIDER || "corelia_only").trim().toLowerCase();
    return ["corelia_only", "openai_only", "hybrid"].includes(mode) ? mode : "hybrid";
  }

  shouldUseOpenAI() {
    if (this.getAiProviderMode() === "corelia_only") return false;
    return Boolean(String(process.env.OPENAI_API_KEY || "").trim());
  }

  getFallbackProviderName() {
    return this.getAiProviderMode() === "corelia_only" ? "corelia" : "fallback";
  }

  getSettingsSafe(session = null) {
    if (!this.desktopMirror?.getSettings) return {};
    try {
      return this.desktopMirror.getSettings(session) || {};
    } catch {
      return {};
    }
  }

  getDashboardSafe(session = null) {
    if (!this.desktopMirror?.getDashboardStats) return {};
    try {
      return this.desktopMirror.getDashboardStats({}, session) || {};
    } catch {
      return {};
    }
  }

  getDataQualitySafe(session = null) {
    if (!this.desktopMirror?.getDataQuality) return {};
    try {
      return this.desktopMirror.getDataQuality(session) || {};
    } catch {
      return {};
    }
  }

  getGoldCapabilitiesSafe(session = null) {
    if (!this.desktopMirror?.getGoldCapabilities) return null;
    try {
      return this.desktopMirror.getGoldCapabilities(session) || null;
    } catch {
      return null;
    }
  }

  getGoldDecisionContextSafe(session = null) {
    if (!this.desktopMirror?.getGoldDecisionContext) return null;
    try {
      return this.desktopMirror.getGoldDecisionContext({}, session) || null;
    } catch {
      return null;
    }
  }

  listClientsSafe(context = {}, session = null) {
    if (this.desktopMirror?.listClients) {
      try {
        return this.desktopMirror.listClients("", session, { summaryOnly: true, limit: 2000 }) || [];
      } catch {
        return [];
      }
    }
    return Array.isArray(context.clientsPreview) ? context.clientsPreview : [];
  }

  listStaffSafe(context = {}, session = null) {
    if (this.desktopMirror?.listStaff) {
      try {
        return this.desktopMirror.listStaff(session) || [];
      } catch {
        return [];
      }
    }
    return Array.isArray(context.staffPreview) ? context.staffPreview : [];
  }

  listServicesSafe(_context = {}, session = null) {
    if (this.desktopMirror?.listServices) {
      try {
        return this.desktopMirror.listServices(session) || [];
      } catch {
        return [];
      }
    }
    return [];
  }

  listProtocolsSafe(_context = {}, session = null) {
    if (this.desktopMirror?.listProtocols) {
      try {
        return this.desktopMirror.listProtocols("", session) || [];
      } catch {
        return [];
      }
    }
    return [];
  }

  buildContext(payload = {}, session = null) {
    const context = payload.context || {};
    const settings = this.getSettingsSafe(session);
    const dashboard = this.getDashboardSafe(session);
    const dataQuality = this.getDataQualitySafe(session);
    const clients = this.listClientsSafe(context, session);
    const staff = this.listStaffSafe(context, session);
    const services = this.listServicesSafe(context, session);
    const protocols = this.listProtocolsSafe(context, session);
    const role = normalizeRole(context.userRole || session?.role || "owner");
    const currentPlan = this.desktopMirror?.getPlanLevel
      ? this.desktopMirror.getPlanLevel(session)
      : String(session?.subscriptionPlan || "base").toLowerCase();
    const coreDecisionEnabled = ["silver", "gold", "enterprise"].includes(String(currentPlan || "").toLowerCase());
    const goldCapabilities = coreDecisionEnabled ? this.getGoldCapabilitiesSafe(session) : null;
    const goldDecisionContext = coreDecisionEnabled ? this.getGoldDecisionContextSafe(session) : null;

    return {
      centerId: String(session?.centerId || ""),
      centerName: String(session?.centerName || ""),
      subscriptionPlan: currentPlan,
      supportMode: Boolean(session?.supportMode),
      currentPage: String(context.currentPage || payload.page || "dashboard"),
      currentModule: String(context.currentModule || ""),
      currentRoute: String(payload.page || context.currentPage || "dashboard"),
      userRole: role,
      selectedClientId: context.selectedClientId || "",
      selectedOperatorId: context.selectedOperatorId || "",
      activePeriod: context.activePeriod || null,
      settings: {
        inventoryBaseEnabled: Boolean(settings.inventoryBaseEnabled),
        profitabilityEnabled: Boolean(settings.profitabilityEnabled),
        enableProtocolsHub: Boolean(settings.enableProtocolsHub),
        enableTrainingHub: Boolean(settings.enableTrainingHub),
        operatorReportsEnabled: Boolean(settings.operatorReportsEnabled)
      },
      goldCapabilities,
      goldDecisionContext,
      dashboard: {
        todayAppointments: Number(dashboard.todayAppointments || 0),
        inactiveClientsCount: Number(dashboard.inactiveClientsCount || 0),
        completedAppointments: Number(dashboard.completedAppointments || 0),
        activeClientsCount: Number(dashboard.activeClientsCount || 0)
      },
      dataQuality: {
        score: Number(dataQuality.score || 100),
        status: String(dataQuality.status || "buono"),
        metrics: {
          clientsMissingContact: Number(dataQuality.metrics?.clientsMissingContact || 0),
          servicesMissingCosts: Number(dataQuality.metrics?.servicesMissingCosts || 0),
          appointmentsMissingPayment: Number(dataQuality.metrics?.appointmentsMissingPayment || 0),
          unlinkedPayments: Number(dataQuality.metrics?.unlinkedPayments || 0),
          duplicateGroups: Number(dataQuality.metrics?.duplicateGroups || 0)
        },
        alerts: Array.isArray(dataQuality.alerts) ? dataQuality.alerts.slice(0, 6) : []
      },
      clientsPreview: clients.slice(0, 25).map((client) => ({
        id: client.id,
        name: `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "",
        phone: client.phone || ""
      })),
      staffPreview: staff.slice(0, 25).map((item) => ({
        id: item.id,
        name: item.name || ""
      })),
      servicesPreview: services.slice(0, 25).map((item) => ({
        id: item.id,
        name: item.name || "",
        durationMin: Number(item.durationMin || 45)
      })),
      protocolsPreview: protocols.slice(0, 25).map((item) => ({
        id: item.id,
        title: item.title || "",
        libraryScope: item.libraryScope || "",
        targetArea: item.targetArea || "",
        needType: item.needType || "",
        source: item.source || ""
      }))
    };
  }

  findClientByQuery(query, context = {}, session = null) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;
    const clients = this.listClientsSafe(context, session);
    return clients.find((client) => {
      const fullName = `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "";
      return normalizeText(fullName).includes(normalizedQuery);
    }) || null;
  }

  findStaffByQuery(query, context = {}, session = null) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;
    const staff = this.listStaffSafe(context, session);
    return staff.find((item) => {
      const name = normalizeText(item.name || "");
      const tokens = significantTokens(item.name || "");
      return name.includes(normalizedQuery) || tokens.some((token) => normalizedQuery.includes(token));
    }) || null;
  }

  findServiceByQuery(query, context = {}, session = null) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;
    const services = this.listServicesSafe(context, session);
    return services.find((item) => {
      const name = normalizeText(item.name || "");
      const tokens = significantTokens(item.name || "");
      return name && (normalizedQuery.includes(name) || name.includes(normalizedQuery) || tokens.some((token) => normalizedQuery.includes(token)));
    }) || null;
  }

  findClientMention(message, context = {}, session = null) {
    const normalizedMessage = normalizeText(message);
    const clients = this.listClientsSafe(context, session);
    return clients.find((client) => {
      const fullName = `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "";
      const normalizedName = normalizeText(fullName);
      return normalizedName && normalizedMessage.includes(normalizedName);
    }) || null;
  }

  findStaffMention(message, context = {}, session = null) {
    const normalizedMessage = normalizeText(message);
    const staff = this.listStaffSafe(context, session);
    return staff.find((item) => {
      const normalizedName = normalizeText(item.name || "");
      const tokens = significantTokens(item.name || "");
      return normalizedName && (normalizedMessage.includes(normalizedName) || tokens.some((token) => normalizedMessage.includes(token)));
    }) || null;
  }

  findServiceMention(message, context = {}, session = null) {
    const normalizedMessage = normalizeText(message);
    const services = this.listServicesSafe(context, session);
    return services.find((item) => {
      const normalizedName = normalizeText(item.name || "");
      const tokens = significantTokens(item.name || "");
      return normalizedName && (normalizedMessage.includes(normalizedName) || tokens.some((token) => normalizedMessage.includes(token)));
    }) || null;
  }

  extractAppointmentDraft(message, context = {}, session = null) {
    const normalized = normalizeText(message);
    if (!/(aggiungi|crea|inserisci|prenota).*(appuntamento|prenotazione|agenda)/.test(normalized)) return null;
    const client = this.findClientMention(message, context, session);
    const occasionalMatch = String(message || "").match(/cliente\s+(?:occasionale\s+)?(.+?)(?=\s+(?:oggi|domani|dopodomani|alle|ore|con|per)\b|$)/i);
    const walkInName = !client && occasionalMatch
      ? occasionalMatch[1]
        .replace(/\b(oggi|domani|dopodomani|alle|ore|con|per)\b.*$/i, "")
        .trim()
      : "";
    const staff = this.findStaffMention(message, context, session);
    const service = this.findServiceMention(message, context, session);
    const date = parseDateFromText(message);
    const time = parseTimeFromText(message);
    const durationMin = parseDurationFromText(message, Number(service?.durationMin || 45));
    return {
      clientId: client?.id || "",
      clientName: client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "" : "",
      walkInName,
      staffId: staff?.id || "",
      staffName: staff?.name || "",
      serviceId: service?.id || "",
      serviceName: service?.name || "",
      date,
      time,
      durationMin,
      status: "confirmed",
      notes: "Creato dal pulsante Smart dopo conferma operatore."
    };
  }

  extractShiftDraft(message, context = {}, session = null) {
    const normalized = normalizeText(message);
    if (!/(aggiungi|crea|inserisci|programma).*(turno|calendario|orario)/.test(normalized)) return null;
    const staff = this.findStaffMention(message, context, session);
    const date = parseDateFromText(message);
    const times = parseShiftTimesFromText(message);
    return {
      staffId: staff?.id || "",
      staffName: staff?.name || "",
      date,
      startTime: times[0] || "",
      endTime: times[1] || "",
      notes: "Turno creato dal pulsante Smart dopo conferma operatore."
    };
  }

  buildSmartPriorityAnswer(context) {
    const plan = String(context.subscriptionPlan || "base").toLowerCase();
    if (plan !== "gold") {
      if (plan === "silver") {
        const silverContext = context.goldDecisionContext || {};
        const primary = silverContext.primaryAction || null;
        const secondary = Array.isArray(silverContext.secondaryActions) ? silverContext.secondaryActions : [];
        if (primary || secondary.length) {
          return [
            "Nel piano Silver uso il core in lettura operativa, ma non attivo AI Gold decisionale.",
            "",
            "Lettura core adesso:",
            primary
              ? `- ${primary.label || primary.domain}: ${primary.suggestedAction || primary.explanationShort || "azione da valutare"}`
              : "- Nessuna priorità operativa disponibile.",
            "",
            "Controlli successivi:",
            ...(secondary.length
              ? secondary.slice(0, 3).map((item, index) => `${index + 1}. ${item.label || item.domain}: ${item.suggestedAction || item.explanationShort || "monitorare"}`)
              : ["1. Apri Report, Cassa e Agenda per leggere i moduli core."]),
            "",
            "Limite Silver:",
            "Il sistema ti orienta, ma non genera priorità AI Gold, recall automatici o decisioni premium."
          ].join("\n");
        }
        return [
          "Nel piano Silver posso guidarti nei moduli, leggere il centro con il core e aiutarti sui report.",
          "",
          "Cosa fare ora:",
          "1. Apri Report per leggere andamento e numeri del periodo.",
          "2. Apri Cassa per controllare incassi e pagamenti.",
          "3. Apri Clienti o Agenda per correggere dati e appuntamenti.",
          "",
          "Le priorità AI premium, i recall suggeriti e le letture decisionali restano nel piano Gold."
        ].join("\n");
      }
      return [
        "Nel piano Base il pulsante Smart resta operativo, ma non usa priorità AI.",
        "",
        "Cosa puoi fare ora:",
        "1. Apri Agenda.",
        "2. Crea o cerca un cliente.",
        "3. Apri Cassa e controlla gli incassi.",
        "",
        "Gli alert decisionali, recall prioritari e letture AI sono disponibili nel piano Gold."
      ].join("\n");
    }
    const goldContext = context.goldDecisionContext || {};
    const primary = goldContext.primaryAction || null;
    const secondary = Array.isArray(goldContext.secondaryActions) ? goldContext.secondaryActions : [];
    const blocked = Array.isArray(goldContext.blockedActions) ? goldContext.blockedActions : [];
    if (primary || secondary.length || blocked.length) {
      const lines = [
        "Lettura Smart allineata a Corelia Decision Engine.",
        "",
        "Priorità principale:",
        primary
          ? `- ${primary.label || primary.domain}: ${primary.suggestedAction || primary.explanationShort || "azione da valutare"}`
          : "- Nessuna priorità principale disponibile.",
        primary
          ? `  RAP_2 ${Math.round(Number(primary.RAP_2 || primary.priority || 0) * 100)}% · confidence ${Math.round(Number(primary.confidence || 0) * 100)}% · rischio ${Math.round(Number(primary.risk || 0) * 100)}%`
          : "",
        primary?.NEU !== undefined ? `  Utilità netta stimata: ${Number(primary.NEU || 0).toFixed(2)}` : "",
        primary?.trend?.trendLabel ? `  Trend: ${primary.trend.trendLabel}` : "",
        "",
        "Azioni consigliate:",
        ...(secondary.length ? secondary.slice(0, 3).map((item, index) => `${index + 1}. ${item.label || item.domain}: ${item.suggestedAction || item.explanationShort || "monitorare"}`) : ["1. Nessuna azione secondaria prioritaria."]),
        "",
        "Blocchi e verifiche:",
        ...(blocked.length ? blocked.slice(0, 3).map((item) => `- ${item.label || item.domain}: ${item.explanationShort || "verificare prima di agire"}`) : ["- Nessun blocco critico dal Gold Engine."]),
        "",
        "Esecuzione:",
        primary?.canExecute
          ? "Posso accompagnarti all'azione, ma ogni esecuzione resta confermata dall'operatore."
          : "Non eseguo azioni dirette se Gold segnala rischio, frizione o confidence insufficiente."
      ].filter(Boolean);
      return lines.join("\n");
    }
    const dashboard = context.dashboard || {};
    const quality = context.dataQuality || {};
    const metrics = quality.metrics || {};
    const alerts = [];

    if (Number(dashboard.todayAppointments || 0) <= 2) {
      alerts.push("Critico: centro sotto ritmo. Aumenta agenda e richiami prima di lavorare sui margini.");
    }
    if (Number(dashboard.inactiveClientsCount || 0) > 0) {
      alerts.push("Attenzione: clienti da recuperare. Parti dai richiami prima di cercare nuovi clienti.");
    }
    if (Number(metrics.unlinkedPayments || 0) > 0) {
      alerts.push("Attenzione: cassa da riallineare. Collega o archivia i pagamenti aperti.");
    }
    if (Number(metrics.appointmentsMissingPayment || 0) > 0) {
      alerts.push("Attenzione: appuntamenti senza incasso collegato. Controlla la cassa prima dei report.");
    }
    if (Number(metrics.clientsMissingContact || 0) > 0) {
      alerts.push("Attenzione: clienti non contattabili. Completa i dati quando fai recall o checkout.");
    }
    if (Number(metrics.servicesMissingCosts || 0) > 0) {
      alerts.push("Attenzione: costi servizio incompleti. La redditività resta stimata finché non li completi.");
    }
    if (String(quality.status || "") === "basso") {
      alerts.push("Critico: qualità dati bassa. Prima pulisci cassa, clienti e servizi, poi leggi l'analisi.");
    }

    if (!alerts.length) {
      return "Non vedo priorita operative urgenti nei dati disponibili. Puoi lavorare normalmente su agenda, clienti e cassa.";
    }

    const actions = [];
    if (Number(dashboard.inactiveClientsCount || 0) > 0) actions.push("1. Apri Marketing o Clienti e richiama prima i clienti inattivi.");
    if (Number(dashboard.todayAppointments || 0) <= 2) actions.push("2. Riempi l'agenda: controlla slot liberi e clienti da recuperare.");
    if (Number(metrics.unlinkedPayments || 0) > 0 || Number(metrics.appointmentsMissingPayment || 0) > 0) actions.push("3. Apri Cassa e collega pagamenti/appuntamenti prima di leggere i report.");
    if (Number(metrics.clientsMissingContact || 0) > 0 || Number(metrics.servicesMissingCosts || 0) > 0) actions.push("4. Completa i dati mancanti per rendere report e AI piu affidabili.");

    return [
      "Ci sono priorita operative da gestire.",
      "",
      "Sintesi operativa:",
      ...alerts.slice(0, 6).map((item) => `- ${item}`),
      "",
      "Cosa fare ora:",
      ...(actions.length ? actions.slice(0, 4) : ["1. Controlla dashboard, agenda e cassa."])
    ].join("\n");
  }

  buildSmartDeskGoldGuideAnswer(message, context) {
    const normalized = normalizeText(message);
    const centerName = context.centerName || "questo centro";
    const planName = String(context.subscriptionPlan || "gold").toUpperCase();

    if (!normalized || /(come funziona|cosa fai|cosa puoi fare|help|aiuto|manuale|guida|smart desk gold|gold)/.test(normalized)) {
      return [
        `Smart Desk ${planName} in ${centerName} va usato come guida operativa, non come chatbot libero.`,
        "Ti aiuta in tre modi:",
        "1. Ti spiega come usare moduli e flussi del gestionale.",
        "2. Ti apre la schermata corretta quando sai già cosa devi fare.",
        "3. Ti dice cosa controllare quando un dato o un risultato non torna.",
        "Dentro i limiti del gestionale non esegue azioni autonome: guida, prepara e ti porta nel modulo giusto."
      ].join("\n");
    }

    if (/(agenda|appuntamenti|slot|giornata)/.test(normalized)) {
      return [
        "Agenda è il centro operativo della giornata.",
        "Da lì puoi inserire appuntamenti, spostare orari, confermare arrivo, segnare no-show, aprire checkout e cassa.",
        "Se non sai dove intervenire, parti dagli slot liberi e dagli appuntamenti da confermare.",
        "Se vuoi posso aprire direttamente l’agenda."
      ].join("\n");
    }

    if (/(clienti|crm|scheda cliente|duplicati|contatti)/.test(normalized)) {
      return [
        "Clienti serve per tenere anagrafica, storico, note e contatti in ordine.",
        "Se un cliente non riceve recall o lo storico sembra spezzato, controlla prima duplicati, telefono ed email.",
        "La regola è semplice: prima anagrafica pulita, poi marketing e letture Gold affidabili.",
        "Se vuoi posso aprire i clienti o cercare una scheda precisa."
      ].join("\n");
    }

    if (/(marketing|recall|whatsapp|richiamare|clienti inattivi)/.test(normalized)) {
      return [
        "Marketing Gold non invia da solo.",
        "Ti prepara clienti da contattare, priorità, motivo e messaggio suggerito da confermare.",
        "Se un’azione non parte, controlla prima contatti cliente, consenso marketing e stato Decision Matrix.",
        "Se vuoi posso aprire marketing o guidarti sul significato di Da richiamare, A rischio, Perso e Storico."
      ].join("\n");
    }

    if (/(redditivita|redditività|margini|costi|profitto)/.test(normalized)) {
      return [
        "Redditività legge il lavoro del centro solo quando i costi sono completi.",
        "Se il margine non torna, non correggere l’AI: controlla costi servizio, costo orario operatore, prodotti e tecnologie collegate.",
        "La regola è: prima volume e continuità del centro, poi ottimizzazione dei margini.",
        "Se vuoi posso aprire la redditività o dirti cosa controllare prima."
      ].join("\n");
    }

    if (/(cassa|pagamenti|incassi|checkout)/.test(normalized)) {
      return [
        "Cassa serve a chiudere bene la giornata, non solo a vedere incassi.",
        "Controlla pagamenti non collegati, appuntamenti aperti e metodo di pagamento prima dei report.",
        "Se qualcosa non torna nei numeri, quasi sempre il primo controllo è qui.",
        "Se vuoi posso aprire la cassa."
      ].join("\n");
    }

    if (/(protocolli|trattamenti|scheda tecnica|analisi protocollo)/.test(normalized)) {
      return [
        "Protocolli e trattamenti servono a registrare bene il lavoro e guidare l’operatore.",
        "L’analisi protocollo prepara una bozza strutturata, ma l’operatore conferma sempre.",
        "Se manca un protocollo coerente, il sistema deve fermarsi e chiedere dati o libreria corretta.",
        "Se vuoi posso aprire protocolli o trattamenti."
      ].join("\n");
    }

    if (/(servizi|operatori|staff|risorse|tecnologie)/.test(normalized)) {
      return [
        "Servizi raccoglie listino, team operativo, postazioni e tecnologie del centro.",
        "Qui sistemi costi, durata, operatori e collegamenti che poi servono a agenda, redditività e report.",
        "Se una lettura Gold non è affidabile, spesso il problema parte da qui.",
        "Se vuoi posso aprire Servizi."
      ].join("\n");
    }

    if (/(turni|presenze|timbrature|orari staff)/.test(normalized)) {
      return [
        "Turni ti aiuta a pianificare, gestire la giornata e chiudere con report.",
        "Prima definisci schemi o turni base, poi controlli presenze e saldo giornata.",
        "Se il team sembra sotto pressione o sbilanciato, parti da qui.",
        "Se vuoi posso aprire Turni."
      ].join("\n");
    }

    if (/(magazzino|stock|inventario|sottoscorta)/.test(normalized)) {
      return [
        "Magazzino è controllo operativo del centro: articoli, giacenze, movimenti e sottoscorta.",
        "Se vedi costi o consumi poco credibili, controlla prima anagrafica articoli e movimenti.",
        "Non serve usarlo come elenco freddo: serve per capire cosa sostiene davvero il lavoro.",
        "Se vuoi posso aprire il magazzino."
      ].join("\n");
    }

    return [
      "Posso funzionare come guida utente interattiva di Smart Desk Gold.",
      "Spiegami cosa non ti è chiaro e ti dico:",
      "- dove intervenire",
      "- quale modulo aprire",
      "- cosa controllare prima",
      "- qual è il limite operativo del gestionale"
    ].join("\n");
  }

  buildLocalDecision(message, context, session) {
    const normalized = normalizeText(message);

    if (!normalized) {
      return buildAnswer("Scrivimi una richiesta breve: posso spiegarti come funziona Smart Desk Gold, aprire una schermata o guidarti in un flusso del gestionale.");
    }

    if (/(disattiva|attiva|modifica impostazioni|cambia permessi|elimina.*operatore|elimina.*cliente|cancella.*cliente|cancella dati)/.test(normalized)) {
      return buildBlocked(
        "Non posso eseguire direttamente questa operazione. Ti apro Impostazioni o la sezione corretta e ti guido, ma non modifico dati sensibili in automatico.",
        "open_settings",
        { section: "general" }
      );
    }

    if (/(come.*operatori|inser.*operatori|aggiung.*operatori|dove.*operatori)/.test(normalized)) {
      return buildAnswer("Per inserire un operatore vai in Servizi > Operatori. Lì puoi aggiungere nome, colore e costo orario. Se vuoi posso aprire direttamente quella schermata.");
    }

    if (/(report.*dipendent|resa dipendent|report operatore|performance operatore)/.test(normalized) && /(come|dove)/.test(normalized)) {
      return buildAnswer("Il report dipendenti è in Report business > Resa dipendenti. Da lì clicchi il nome dell’operatore e apri il suo report personale. Se vuoi posso aprire i report.");
    }

    if (/(come.*magazzino|funziona.*magazzino)/.test(normalized)) {
      return buildAnswer("Il magazzino ti fa gestire articoli, movimenti, sottoscorta e controllo stock. Parti dalla panoramica, poi anagrafica articoli e infine movimenti. Se vuoi posso aprire il magazzino.");
    }

    if (/(chi sono|che centro|quale centro|che piano|abbonamento|riconosci)/.test(normalized)) {
      return buildAnswer([
        `Stai lavorando nel centro: ${context.centerName || "centro non indicato"}.`,
        `Piano rilevato: ${context.subscriptionPlan || "non indicato"}.`,
        `Ruolo sessione: ${context.userRole || "owner"}.`,
        "Leggo solo i dati collegati a questa sessione e non uso dati di altri centri."
      ].join("\n"));
    }

    if (/(priorita|priorità|cosa devo fare|oggi|piano operativo)/.test(normalized)) {
      return buildAnswer(this.buildSmartPriorityAnswer(context));
    }

    if (/(libreria skinharmony|protocolli skinharmony|come uso.*protocolli|cosa manca.*protocolli)/.test(normalized)) {
      const skinHarmonyCount = (context.protocolsPreview || []).filter((item) => item.libraryScope === "skinharmony").length;
      const centerCount = (context.protocolsPreview || []).filter((item) => item.libraryScope === "center").length;
      return buildAnswer([
        `Nel contesto leggo ${skinHarmonyCount} protocolli SkinHarmony e ${centerCount} protocolli del centro.`,
        "Per partire: duplica un protocollo SkinHarmony nel centro, adattalo ai tuoi prodotti/tecnologie e poi usa Protocolli AI in modalità Ibrida.",
        "Se manca un protocollo coerente, Protocolli AI deve fermarsi e chiedere di caricarlo invece di inventare."
      ].join("\n"));
    }

    const clientDraft = extractClientDraft(message);
    if (clientDraft) {
      if (clientDraft.firstName && (clientDraft.phone || clientDraft.noContact)) {
        const noContactCopy = clientDraft.noContact ? " senza contatto telefonico/email registrato" : ` con telefono ${clientDraft.phone}`;
        return buildAction(
          `Ho preparato il cliente ${[clientDraft.firstName, clientDraft.lastName].filter(Boolean).join(" ")}${noContactCopy}. Confermi il salvataggio?`,
          "create_client",
          clientDraft,
          true
        );
      }
      return buildAnswer(
        [
          "Posso creare il cliente anche senza telefono, ma devi indicarlo chiaramente.",
          "Esempi:",
          "crea cliente Mario Rossi 3331234567",
          "crea cliente Maria Rossi senza telefono"
        ].join("\n"),
        clientDraft
      );
    }

    const appointmentDraft = this.extractAppointmentDraft(message, context, session);
    if (appointmentDraft) {
      const missing = [];
      if (!appointmentDraft.clientId && !appointmentDraft.walkInName) missing.push("cliente esistente oppure cliente occasionale");
      if (!appointmentDraft.date) missing.push("data");
      if (!appointmentDraft.time) missing.push("ora");
      if (missing.length) {
        return buildAnswer(
          [
            `Per creare l’appuntamento mi manca: ${missing.join(", ")}.`,
            "Scrivi un comando più completo, ad esempio:",
            "aggiungi appuntamento a Maria Rossi domani alle 15 con Anna per colore.",
            "Oppure: aggiungi appuntamento cliente occasionale Maria domani alle 15 con Anna per colore.",
            "Se il cliente non esiste ancora, crea prima il cliente."
          ].join("\n"),
          appointmentDraft
        );
      }
      const details = [
        appointmentDraft.clientName || `cliente occasionale ${appointmentDraft.walkInName}`,
        appointmentDraft.serviceName ? `servizio ${appointmentDraft.serviceName}` : "servizio non indicato",
        appointmentDraft.staffName ? `con ${appointmentDraft.staffName}` : "operatore non indicato",
        `${appointmentDraft.date} alle ${appointmentDraft.time}`
      ].filter(Boolean).join(", ");
      return buildAction(`Ho preparato l’appuntamento: ${details}. Confermi il salvataggio in agenda?`, "create_appointment", appointmentDraft, true);
    }

    const shiftDraft = this.extractShiftDraft(message, context, session);
    if (shiftDraft) {
      const missing = [];
      if (!shiftDraft.staffId) missing.push("operatore");
      if (!shiftDraft.date) missing.push("data");
      if (!shiftDraft.startTime) missing.push("ora inizio");
      if (!shiftDraft.endTime) missing.push("ora fine");
      if (missing.length) {
        return buildAnswer(
          [
            `Per creare il turno mi manca: ${missing.join(", ")}.`,
            "Scrivi un comando completo, ad esempio:",
            "crea turno Anna domani dalle 9 alle 18."
          ].join("\n"),
          shiftDraft
        );
      }
      return buildAction(
        `Ho preparato il turno di ${shiftDraft.staffName} per ${shiftDraft.date}, dalle ${shiftDraft.startTime} alle ${shiftDraft.endTime}. Confermi il salvataggio?`,
        "create_shift",
        shiftDraft,
        true
      );
    }

    if (/(nuovo cliente|apri form cliente|apri nuovo cliente)/.test(normalized)) {
      return buildAction("Apro il form cliente.", "open_client_form", {});
    }

    const clientSearchMatch = message.match(/(?:cerca|trova)\s+cliente\s+(.+)/i);
    if (clientSearchMatch) {
      const query = clientSearchMatch[1].trim();
      const client = this.findClientByQuery(query, context, session);
      if (client) {
        const fullName = `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "cliente richiesto";
        return buildAction(`Apro la scheda cliente di ${fullName}.`, "open_client_details", { clientId: client.id });
      }
      return buildAction(`Apro l’area clienti filtrata per ${query}.`, "search_client", { query });
    }

    if (/(filtra clienti|mostra clienti)/.test(normalized)) {
      const query = message.replace(/.*(?:filtra clienti|mostra clienti)\s*/i, "").trim();
      return buildAction(query ? `Filtro la lista clienti per ${query}.` : "Apro la lista clienti.", query ? "filter_clients" : "open_clients", query ? { query } : {});
    }

    const operatorReportMatch = message.match(/(?:report|scheda)\s+operatore\s+(.+)/i);
    if (operatorReportMatch) {
      const staff = this.findStaffByQuery(operatorReportMatch[1].trim(), context, session);
      if (staff) {
        return buildAction(`Apro il report operatore di ${staff.name}.`, "open_operator_report", {
          operatorId: staff.id,
          period: context.activePeriod?.period || "month",
          startDate: context.activePeriod?.startDate || "",
          endDate: context.activePeriod?.endDate || ""
        });
      }
      return buildAnswer("Non ho trovato un operatore con quel nome. Se vuoi scrivimi il nome preciso oppure apri Report > Resa dipendenti.");
    }

    const agendaFilter = parseAgendaFilter(message);
    if (agendaFilter) {
      return buildAction("Filtro l’agenda sul periodo richiesto.", "filter_appointments", agendaFilter);
    }

    if (/(apri dashboard|torna dashboard|home)/.test(normalized)) return buildAction("Apro la dashboard.", "open_dashboard", {});
    if (/(apri agenda|vai agenda|portami agenda|agenda|appuntamenti)/.test(normalized)) return buildAction("Apro l’agenda.", "open_agenda", {});
    if (/(apri clienti|vai clienti|scheda clienti|crm)/.test(normalized)) return buildAction("Apro i clienti.", "open_clients", {});
    if (/(apri magazzino|magazzino|stock|inventario)/.test(normalized)) {
      return context.settings.inventoryBaseEnabled
        ? buildAction("Apro il magazzino.", "open_inventory", {})
        : buildBlocked("Il modulo magazzino non è attivo in questo centro.", "open_settings", { section: "inventory" });
    }
    if (/(apri report|vai report|report business|reportistica)/.test(normalized)) return buildAction("Apro i report.", "open_reports", {});
    if (/(apri cassa|vai cassa|cassa|pagamento|pagamenti)/.test(normalized)) return buildAction("Apro la cassa operativa.", "open_cashdesk", {});
    if (/(apri turni|turni|presenze)/.test(normalized)) return buildAction("Apro turni e presenze.", normalized.includes("presenze") ? "open_attendance" : "open_turns", {});
    if (/(apri redditivita|redditivita|margini|profitto)/.test(normalized)) {
      return context.settings.profitabilityEnabled
        ? buildAction("Apro il controllo redditività.", "open_profitability", {})
        : buildBlocked("La redditività non è attiva. Ti apro le impostazioni del modulo.", "open_settings", { section: "profitability" });
    }
    if (/(apri protocolli|protocolli)/.test(normalized)) {
      return context.settings.enableProtocolsHub
        ? buildAction("Apro i protocolli.", "open_protocols", {})
        : buildBlocked("L’hub protocolli non è attivo. Ti porto in Impostazioni.", "open_settings", { section: "protocols" });
    }
    if (/(apri training|training|formazione)/.test(normalized)) {
      return context.settings.enableTrainingHub
        ? buildAction("Apro l’area training.", "open_training", {})
        : buildBlocked("L’area training non è attiva. Ti porto in Impostazioni.", "open_settings", { section: "training" });
    }
    if (/(apri impostazioni|impostazioni|settings)/.test(normalized)) return buildAction("Apro le impostazioni.", "open_settings", {});

    if (/(aiuto|help|cosa puoi fare|suggerisci|consiglio)/.test(normalized)) {
      if (context.dashboard.todayAppointments === 0) {
        return buildAnswer("Agenda vuota oggi. Posso spiegarti come lavorare con recall, clienti inattivi, agenda e cassa, oppure aprire direttamente il modulo giusto.");
      }
      return buildAnswer("Posso funzionare come manuale utente interattivo: spiego i flussi, apro schermate, cerco clienti e preparo azioni nei limiti del gestionale.");
    }

    return buildAnswer("Posso spiegarti come usare Smart Desk Gold, aprire agenda, clienti, turni, report, magazzino e redditività, oppure guidarti nel modulo corretto.");
  }

  sanitizeResponse(candidate, context, fallback) {
    const safe = {
      mode: ["answer", "action", "blocked_action"].includes(candidate?.mode) ? candidate.mode : fallback.mode,
      message: typeof candidate?.message === "string" && candidate.message.trim() ? candidate.message.trim() : fallback.message,
      action: typeof candidate?.action === "string" ? candidate.action : null,
      payload: candidate?.payload && typeof candidate.payload === "object" ? candidate.payload : {},
      requiresConfirmation: Boolean(candidate?.requiresConfirmation)
    };

    if (safe.action && !ACTIONS.includes(safe.action)) return fallback;

    if (safe.mode === "answer" && safe.action) {
      safe.mode = "action";
    }

    if (safe.action && !canUseAction(context.userRole, safe.action)) {
      return buildBlocked(
        "Questa azione non è consentita per il tuo ruolo. Ti apro solo la schermata corretta quando disponibile e ti guido nei passaggi.",
        ACTION_PERMISSIONS[safe.action] === "UI_NAVIGATION" ? safe.action : null,
        safe.payload
      );
    }

    if ((safe.action === "create_appointment" || safe.action === "create_shift" || safe.action === "create_client") && !hasAnyPayloadValue(safe.payload)) {
      return fallback;
    }

    if (safe.action === "create_appointment") {
      const payload = safe.payload || {};
      if ((!payload.clientId && !payload.walkInName) || !payload.date || !payload.time) {
        return buildAnswer(
          "Non salvo appuntamenti senza cliente esistente o cliente occasionale, data e ora. Scrivi ad esempio: aggiungi appuntamento a Maria Rossi domani alle 15 con Anna per colore. Oppure: aggiungi appuntamento cliente occasionale Maria domani alle 15.",
          payload
        );
      }
      safe.requiresConfirmation = true;
    }

    if (safe.action === "create_shift") {
      const payload = safe.payload || {};
      if (!payload.staffId || !payload.date || !payload.startTime || !payload.endTime) {
        return buildAnswer(
          "Non salvo turni senza operatore, data, ora inizio e ora fine. Scrivi ad esempio: crea turno Anna domani dalle 9 alle 18.",
          payload
        );
      }
      safe.requiresConfirmation = true;
    }

    if (safe.action === "create_note" || safe.action === "create_task") {
      return buildBlocked(
        "Questa azione non è ancora disponibile come salvataggio diretto. Posso aprire la schermata corretta e guidarti, ma non la eseguo in automatico.",
        safe.action === "create_note" ? "open_client_form" : "open_dashboard",
        safe.payload
      );
    }

    return safe;
  }

  async chat(payload = {}, session = null) {
    const message = String(payload.message || "").trim();
    const context = this.buildContext(payload, session);
    const localDecision = this.buildLocalDecision(message, context, session);
    const normalizedMessage = normalizeText(message);
    if (/(priorita|priorità|cosa devo fare|oggi|piano operativo)/.test(normalizedMessage)) {
      return { ...localDecision, provider: this.getAiProviderMode() === "corelia_only" ? "corelia" : "rules" };
    }
    const model = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();

    if (!this.shouldUseOpenAI()) {
      return { ...localDecision, provider: this.getFallbackProviderName() };
    }

    const instructions = [
      "Sei SkinHarmony AI Assistant, guida utente interattiva di Smart Desk Gold.",
      "Rispondi in italiano, tono premium, chiaro, breve, concreto.",
      "Il tuo compito principale è spiegare come funziona il gestionale, aprire la schermata corretta e guidare l’utente entro i limiti reali del prodotto.",
      "Riconosci il centro e il piano solo dal contesto di sessione. Non chiedere all'utente chi e se il contesto lo contiene.",
      "Usa esclusivamente dati del centro presenti nel contesto JSON. Non parlare di altri centri e non inventare dati mancanti.",
      "Non promettere azioni non eseguibili e non comportarti come consulente strategico generico.",
      `Puoi usare solo queste azioni: ${ACTIONS.join(", ")}.`,
      "Le azioni sensibili non si eseguono: usa blocked_action e guida l’utente.",
      "Se la richiesta è una domanda, usa mode=answer.",
      "Se l’azione è consentita e chiara, usa mode=action.",
      "Per create_client richiedi conferma finale quando nome e telefono sono completi, oppure quando l'utente scrive esplicitamente senza telefono/senza contatto.",
      "Per create_appointment richiedi sempre conferma finale e usa solo cliente, operatore e servizio presenti nel contesto.",
      "Per create_shift richiedi sempre conferma finale e usa solo operatori presenti nel contesto.",
      "Puoi creare appuntamenti senza clientId solo se payload.walkInName e presente come cliente occasionale.",
      "Non creare appuntamenti senza clientId o walkInName, date e time.",
      "Non creare turni senza staffId, date, startTime ed endTime.",
      "Se mancano dati obbligatori, spiega esattamente cosa manca, dove si sistema nel gestionale e proponi un esempio di comando completo.",
      "Se il contesto contiene goldDecisionContext o goldCapabilities, trattali come fonte ufficiale per priorità, blocchi, rischio, confidence, WhatsApp e azioni consentite.",
      "Non duplicare logiche Gold: leggi primaryAction, secondaryActions, blockedActions, canExecute, risk, confidence, EV, NEU e trend se presenti.",
      "Se una decisione Gold ha canExecute=false o compare nei blockedActions, non proporre azione diretta: guida solo alla verifica.",
      "Se goldCapabilities.limits.whatsappEnabled=true puoi proporre invio WhatsApp controllato; altrimenti proponi fallback manuale/copia.",
      "Devi essere forward-compatible: se trovi campi Gold nuovi, usali nella spiegazione; se mancano, ignora senza inventare.",
      "Non inventare dati che non sono nel contesto.",
      "Quando l’utente chiede come funziona un modulo, rispondi come un manuale operativo e proponi di aprire la pagina corretta."
    ].join("\n");

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: [
            { role: "system", content: [{ type: "input_text", text: instructions }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify({ message, context }) }] }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "skinharmony_assistant_response",
              strict: true,
              schema: RESPONSE_SCHEMA
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI HTTP ${response.status}`);
      }

      const data = await response.json();
      const raw = data?.output_text || data?.output?.[0]?.content?.[0]?.text || "{}";
      const parsed = JSON.parse(raw);
      const sanitized = this.sanitizeResponse(parsed, context, localDecision);
      if (localDecision.action && ["create_client", "create_appointment", "create_shift"].includes(localDecision.action)) {
        const mergedPayload = { ...(localDecision.payload || {}) };
        const normalizedMessage = normalizeText(message);
        const candidateStaffName = String(sanitized.payload?.staffName || "").trim();
        const staffFromAi = this.findStaffByQuery(candidateStaffName, context, session);
        const canMergeStaff = staffFromAi && normalizedMessage.includes(normalizeText(candidateStaffName));
        const candidateServiceName = String(sanitized.payload?.serviceName || "").trim();
        const serviceFromAi = this.findServiceByQuery(candidateServiceName, context, session);
        const canMergeService = candidateServiceName
          && serviceFromAi
          && normalizeText(candidateServiceName).split(/\s+/).some((word) => word.length >= 4 && normalizedMessage.includes(word));
        if (sanitized.action === localDecision.action && sanitized.payload && typeof sanitized.payload === "object") {
          Object.entries(sanitized.payload).forEach(([key, value]) => {
            if ((mergedPayload[key] === undefined || mergedPayload[key] === null || mergedPayload[key] === "") && value !== undefined && value !== null && value !== "") {
              if (["staffId", "staffName", "operatorId"].includes(key) && !canMergeStaff) return;
              if (["serviceId", "serviceName"].includes(key) && !canMergeService) return;
              mergedPayload[key] = value;
            }
          });
          if (canMergeStaff) {
            mergedPayload.staffId = mergedPayload.staffId || staffFromAi.id || "";
            mergedPayload.operatorId = mergedPayload.operatorId || staffFromAi.id || "";
            mergedPayload.staffName = mergedPayload.staffName || staffFromAi.name || candidateStaffName;
          }
          if (canMergeService) {
            mergedPayload.serviceId = mergedPayload.serviceId || serviceFromAi.id || "";
            mergedPayload.serviceName = mergedPayload.serviceName || serviceFromAi.name || candidateServiceName;
          }
          if (canMergeService && Number(sanitized.payload.durationMin || 0) > 0) {
            mergedPayload.durationMin = Number(sanitized.payload.durationMin);
          }
        }
        return {
          ...localDecision,
          payload: mergedPayload,
          message: buildConfirmationMessage(localDecision.action, mergedPayload, localDecision.message),
          requiresConfirmation: true,
          provider: "openai"
        };
      }
      return {
        ...sanitized,
        provider: "openai"
      };
    } catch {
      return { ...localDecision, provider: this.getFallbackProviderName() };
    }
  }

  buildAiGoldFallback(question, context) {
    const snapshot = context.businessSnapshot || null;
    const marketing = snapshot?.marketing || context.marketing || {};
    const profitability = snapshot?.profitability || context.profitability || {};
    const centerHealth = snapshot?.report?.centerHealth || null;
    const marketingCount = Array.isArray(marketing.suggestions) ? marketing.suggestions.length : 0;
    const profitAlerts = Array.isArray(profitability.alerts) ? profitability.alerts.length : 0;
    const monthlyTrend = Array.isArray(profitability.monthlyTrend) ? profitability.monthlyTrend : [];
    const firstMarketing = marketing.suggestions?.[0];
    const firstAlert = profitability.alerts?.[0];
    const lastDrop = [...monthlyTrend].reverse().find((item) => item.signal === "drop");
    const lines = [
      "Lettura AI Gold operativa sui dati disponibili, con Corelia come motore decisionale:",
      centerHealth
        ? `Stato centro: ${centerHealth.statusLabel || centerHealth.status}. Azione: ${centerHealth.status === "sotto_soglia" ? "aumenta agenda e richiami prima dei margini" : "mantieni controllo operativo e correggi i punti deboli"}.`
        : "Stato centro: dato non disponibile nello snapshot.",
      marketingCount
        ? `Marketing: ci sono ${marketingCount} clienti da valutare. Prima priorità: ${firstMarketing?.name || "cliente"} (${firstMarketing?.motive || "richiamo suggerito"}).`
        : "Marketing: nessun cliente prioritario rilevato ora.",
      profitAlerts
        ? `Redditività: ci sono ${profitAlerts} alert. Primo controllo: ${firstAlert?.title || "servizio critico"}.`
        : "Redditività: nessun alert critico rilevato sui dati configurati.",
      lastDrop
        ? `Trend mensile: ${lastDrop.month} mostra un calo da controllare rispetto al mese precedente.`
        : "Trend mensile: nessun calo importante rilevato nel periodo selezionato.",
      "Non ho eseguito azioni automatiche. Conferma sempre tu eventuali contatti, modifiche o verifiche operative."
    ];
    if (question) {
      lines.unshift(`Domanda ricevuta: ${question}`);
    }
    return lines.join("\n");
  }

  buildAiGoldCoreliaResponse(payload = {}, session = null, context = null) {
    if (!this.coreliaBridge) {
      return {
        goldEnabled: true,
        provider: this.getFallbackProviderName(),
        answer: this.buildAiGoldFallback(String(payload.question || ""), context || {}),
        actions: []
      };
    }
    try {
      const structured = this.coreliaBridge.buildDialog({
        message: String(payload.question || ""),
        startDate: payload?.period?.startDate || "",
        endDate: payload?.period?.endDate || ""
      }, session);
      const dialogue = this.nyraDialogue.render(structured, { message: String(payload.question || "") });
      return {
        goldEnabled: true,
        provider: "corelia",
        answer: String(dialogue.reply || structured.humanSummary || ""),
        actions: [],
        structured,
        dialogue,
        uiReadingBand: structured.uiReadingBand,
        uiReadingLabel: structured.uiReadingLabel,
        conflictIndex: Number(structured?.v7?.conflictIndex || 0)
      };
    } catch {
      return {
        goldEnabled: true,
        provider: this.getFallbackProviderName(),
        answer: this.buildAiGoldFallback(String(payload.question || ""), context || {}),
        actions: []
      };
    }
  }

  async aiGoldAsk(payload = {}, session = null) {
    if (!this.desktopMirror?.hasGoldIntelligence?.(session)) {
      return {
        goldEnabled: false,
        provider: "blocked",
        answer: "AI Gold disponibile solo con piano Gold.",
        actions: []
      };
    }

    const question = String(payload.question || "").trim();
    const snapshot = this.desktopMirror.getBusinessSnapshot
      ? this.desktopMirror.getBusinessSnapshot(payload.period || {}, session)
      : null;
    const goldCapabilities = this.getGoldCapabilitiesSafe(session);
    const goldDecisionContext = this.getGoldDecisionContextSafe(session);
    const context = snapshot?.snapshotAvailable ? {
      businessSnapshot: snapshot,
      goldCapabilities,
      goldDecisionContext,
      dashboard: this.getDashboardSafe(session),
      settings: this.getSettingsSafe(session)
    } : {
      marketing: this.desktopMirror.getAiGoldMarketing(session),
      profitability: this.desktopMirror.getAiGoldProfitability(payload.period || {}, session),
      goldCapabilities,
      goldDecisionContext,
      dashboard: this.getDashboardSafe(session),
      settings: this.getSettingsSafe(session)
    };
    const model = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();

    if (!this.shouldUseOpenAI()) {
      return {
        goldEnabled: true,
        provider: this.getFallbackProviderName(),
        answer: this.buildSmartDeskGoldGuideAnswer(question, {
          centerName: snapshot?.centerName || snapshot?.center_health?.centerName || "",
          subscriptionPlan: goldCapabilities?.plan || "gold",
          userRole: session?.role || "owner",
          settings: this.getSettingsSafe(session)
        }),
        actions: []
      };
    }

    const instructions = [
      "Sei AI Gold di SkinHarmony Smart Desk.",
      "Non sei un chatbot generico e non sei un consulente libero: sei una guida utente interattiva del prodotto.",
      "Usa solo i dati presenti nel contesto JSON. Se un dato manca, dillo.",
      "Spiega come funziona il modulo giusto, dove intervenire e quale schermata aprire.",
      "Non inviare messaggi, non modificare prezzi, non cambiare dati e non fare campagne automatiche.",
      "Puoi suggerire azioni concrete solo come passaggi guidati del gestionale che l'operatore deve confermare.",
      "Quando nel contesto trovi monthlyTrend, usa quei mesi per leggere oscillazioni, cali, riprese e instabilità operativa.",
      "Quando nel contesto trovi goldDecisionContext, usa quello come fonte ufficiale: primaryAction, secondaryActions, blockedActions, risk, confidence, EV, NEU, RAP_2 e trend.",
      "Non bypassare canExecute, blockedActions, risk alto o confidence bassa. Se Gold blocca, devi bloccare o chiedere verifica.",
      "Quando nel contesto trovi goldCapabilities, usa features e limits per sapere cosa è attivo. Se WhatsApp non è abilitato, proponi solo copia/fallback manuale.",
      "Evita claim medici, terapeutici o promesse di risultato.",
      "Rispondi in italiano, tono premium, chiaro, pratico.",
      "Struttura la risposta come mini manuale operativo: Cosa significa, Dove si gestisce, Cosa fare ora, Limiti."
    ].join("\n");

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: [
            { role: "system", content: [{ type: "input_text", text: instructions }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify({ question, context }) }] }
          ]
        })
      });
      if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
      const data = await response.json();
      const answer = data?.output_text || data?.output?.[0]?.content?.[0]?.text || this.buildAiGoldFallback(question, context);
      return {
        goldEnabled: true,
        provider: "openai",
        answer,
        actions: []
      };
    } catch {
      return this.buildAiGoldCoreliaResponse(payload, session, context);
    }
  }

  async enhanceMarketingAutopilotActions(actions = [], session = null) {
    const items = Array.isArray(actions) ? actions.slice(0, 12) : [];
    const model = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
    if (!items.length) {
      return { provider: this.shouldUseOpenAI() ? "openai" : this.getFallbackProviderName(), actions: [] };
    }
    if (!this.shouldUseOpenAI()) {
      return {
        provider: this.getFallbackProviderName(),
        actions: items.map((item) => ({ ...item, aiProvider: "corelia_rules" }))
      };
    }

    const instructions = [
      "Sei AI Gold Marketing di SkinHarmony Smart Desk con Corelia come motore decisionale.",
      "Rifinisci azioni recall gia generate da dati reali.",
      "Non inventare dati non presenti.",
      "Non promettere risultati medici o terapeutici.",
      "Non inviare messaggi e non creare campagne automatiche.",
      "Crea messaggi brevi, professionali, premium, utilizzabili via WhatsApp/SMS.",
      "Rispetta il consenso marketing: se manca, non proporre invio.",
      "Rispondi solo JSON valido con array actions."
    ].join("\n");

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              reason: { type: "string" },
              suggestedMessage: { type: "string" }
            },
            required: ["id", "reason", "suggestedMessage"]
          }
        }
      },
      required: ["actions"]
    };

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: [
            { role: "system", content: [{ type: "input_text", text: instructions }] },
            {
              role: "user",
              content: [{
                type: "input_text",
                text: JSON.stringify({
                  center: {
                    centerId: session?.centerId || "",
                    centerName: session?.centerName || ""
                  },
                  actions: items.map((item) => ({
                    id: item.id,
                    clientName: item.clientName,
                    priority: item.priority,
                    segment: item.segment,
                    reason: item.reason,
                    suggestedMessage: item.suggestedMessage
                  }))
                })
              }]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "skinharmony_ai_marketing_actions",
              strict: true,
              schema
            }
          }
        })
      });
      if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
      const data = await response.json();
      const raw = data?.output_text || data?.output?.[0]?.content?.[0]?.text || "{}";
      const parsed = JSON.parse(raw);
      const byId = new Map((parsed.actions || []).map((item) => [String(item.id || ""), item]));
      return {
        provider: "openai",
        actions: items.map((item) => {
          const enhanced = byId.get(String(item.id || ""));
          return {
            ...item,
            reason: enhanced?.reason || item.reason,
            suggestedMessage: enhanced?.suggestedMessage || item.suggestedMessage,
            aiProvider: "openai"
          };
        })
      };
    } catch {
      return {
        provider: this.getFallbackProviderName(),
        actions: items.map((item) => ({ ...item, aiProvider: this.getAiProviderMode() === "corelia_only" ? "corelia_rules" : "rules" }))
      };
    }
  }
}

module.exports = {
  AssistantService
};
    if (/(come funziona|manuale|guida|smart desk gold|gold|non so|non capisco|spiegami)/.test(normalized)) {
      return buildAnswer(this.buildSmartDeskGoldGuideAnswer(message, context));
    }
