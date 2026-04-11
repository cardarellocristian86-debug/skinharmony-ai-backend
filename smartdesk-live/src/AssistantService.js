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

  listClientsSafe(context = {}, session = null) {
    if (this.desktopMirror?.listClients) {
      try {
        return this.desktopMirror.listClients("", session) || [];
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

  buildContext(payload = {}, session = null) {
    const context = payload.context || {};
    const settings = this.getSettingsSafe(session);
    const dashboard = this.getDashboardSafe(session);
    const clients = this.listClientsSafe(context, session);
    const staff = this.listStaffSafe(context, session);
    const services = this.listServicesSafe(context, session);
    const role = normalizeRole(context.userRole || session?.role || "owner");

    return {
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
      dashboard: {
        todayAppointments: Number(dashboard.todayAppointments || 0),
        inactiveClientsCount: Number(dashboard.inactiveClientsCount || 0)
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
    return staff.find((item) => normalizeText(item.name).includes(normalizedQuery)) || null;
  }

  findServiceByQuery(query, context = {}, session = null) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;
    const services = this.listServicesSafe(context, session);
    return services.find((item) => {
      const name = normalizeText(item.name || "");
      return name && (normalizedQuery.includes(name) || name.includes(normalizedQuery));
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
      return normalizedName && normalizedMessage.includes(normalizedName);
    }) || null;
  }

  findServiceMention(message, context = {}, session = null) {
    const normalizedMessage = normalizeText(message);
    const services = this.listServicesSafe(context, session);
    return services.find((item) => {
      const normalizedName = normalizeText(item.name || "");
      return normalizedName && normalizedMessage.includes(normalizedName);
    }) || null;
  }

  extractAppointmentDraft(message, context = {}, session = null) {
    const normalized = normalizeText(message);
    if (!/(aggiungi|crea|inserisci|prenota).*(appuntamento|prenotazione|agenda)/.test(normalized)) return null;
    const client = this.findClientMention(message, context, session);
    const occasionalMatch = String(message || "").match(/cliente\s+(?:occasionale\s+)?([a-zà-ù]+(?:\s+[a-zà-ù]+){0,3})/i);
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
      notes: "Creato da SkinHarmony AI dopo conferma operatore."
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
      notes: "Turno creato da SkinHarmony AI dopo conferma operatore."
    };
  }

  buildLocalDecision(message, context, session) {
    const normalized = normalizeText(message);

    if (!normalized) {
      return buildAnswer("Scrivimi una richiesta breve: posso spiegarti un flusso, aprire una schermata o aiutarti con un cliente.");
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
        return buildAnswer("Agenda vuota oggi. Ti conviene lavorare su recall o clienti inattivi. Posso aprire agenda, clienti, report, turni, magazzino o guidarti su un nuovo cliente.");
      }
      return buildAnswer("Posso spiegarti come usare il gestionale, aprire schermate, cercare clienti e preparare clienti, appuntamenti o turni con conferma finale.");
    }

    return buildAnswer("Posso spiegarti un flusso, aprire agenda, clienti, turni, report, magazzino e redditività, oppure preparare cliente, appuntamento o turno con conferma.");
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
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    const model = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();

    if (!apiKey) {
      return { ...localDecision, provider: "fallback" };
    }

    const instructions = [
      "Sei SkinHarmony AI Assistant, assistente operativo reale del gestionale.",
      "Rispondi in italiano, tono premium, chiaro, breve, concreto.",
      "Non promettere azioni non eseguibili.",
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
      "Se mancano dati obbligatori, non aprire schermate: spiega esattamente cosa manca e proponi un esempio di comando completo.",
      "Non inventare dati che non sono nel contesto."
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
        if (sanitized.action === localDecision.action && sanitized.payload && typeof sanitized.payload === "object") {
          Object.entries(sanitized.payload).forEach(([key, value]) => {
            if ((mergedPayload[key] === undefined || mergedPayload[key] === null || mergedPayload[key] === "") && value !== undefined && value !== null && value !== "") {
              mergedPayload[key] = value;
            }
          });
        }
        return {
          ...localDecision,
          payload: mergedPayload,
          message: sanitized.message || localDecision.message,
          requiresConfirmation: true,
          provider: "openai"
        };
      }
      return {
        ...sanitized,
        provider: "openai"
      };
    } catch {
      return { ...localDecision, provider: "fallback" };
    }
  }

  buildAiGoldFallback(question, context) {
    const marketingCount = Array.isArray(context.marketing?.suggestions) ? context.marketing.suggestions.length : 0;
    const profitAlerts = Array.isArray(context.profitability?.alerts) ? context.profitability.alerts.length : 0;
    const monthlyTrend = Array.isArray(context.profitability?.monthlyTrend) ? context.profitability.monthlyTrend : [];
    const firstMarketing = context.marketing?.suggestions?.[0];
    const firstAlert = context.profitability?.alerts?.[0];
    const lastDrop = [...monthlyTrend].reverse().find((item) => item.signal === "drop");
    const lines = [
      "Lettura AI Gold operativa sui dati disponibili:",
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
    const context = {
      marketing: this.desktopMirror.getAiGoldMarketing(session),
      profitability: this.desktopMirror.getAiGoldProfitability(payload.period || {}, session),
      dashboard: this.getDashboardSafe(session),
      settings: this.getSettingsSafe(session)
    };
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    const model = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();

    if (!apiKey) {
      return {
        goldEnabled: true,
        provider: "fallback",
        answer: this.buildAiGoldFallback(question, context),
        actions: []
      };
    }

    const instructions = [
      "Sei AI Gold di SkinHarmony Smart Desk.",
      "Non sei un chatbot generico: sei un assistente operativo per centri estetici, parrucchieri e ibridi.",
      "Usa solo i dati presenti nel contesto JSON. Se un dato manca, dillo.",
      "Non inviare messaggi, non modificare prezzi, non cambiare dati e non fare campagne automatiche.",
      "Suggerisci azioni concrete che l'operatore deve confermare.",
      "Quando nel contesto trovi monthlyTrend, usa quei mesi per leggere oscillazioni, cali, riprese e instabilità operativa.",
      "Evita claim medici, terapeutici o promesse di risultato.",
      "Rispondi in italiano, tono premium, chiaro, pratico.",
      "Struttura la risposta in: Sintesi, Priorità, Azioni consigliate, Limiti/dati mancanti."
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
      return {
        goldEnabled: true,
        provider: "fallback",
        answer: this.buildAiGoldFallback(question, context),
        actions: []
      };
    }
  }

  async enhanceMarketingAutopilotActions(actions = [], session = null) {
    const items = Array.isArray(actions) ? actions.slice(0, 12) : [];
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    const model = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
    if (!items.length) {
      return { provider: apiKey ? "openai" : "fallback", actions: [] };
    }
    if (!apiKey) {
      return {
        provider: "fallback",
        actions: items.map((item) => ({ ...item, aiProvider: "rules" }))
      };
    }

    const instructions = [
      "Sei AI Gold Marketing di SkinHarmony Smart Desk.",
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
        provider: "fallback",
        actions: items.map((item) => ({ ...item, aiProvider: "rules" }))
      };
    }
  }
}

module.exports = {
  AssistantService
};
