const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JsonFileRepository } = require("./JsonFileRepository");

const DATA_DIR = path.resolve(process.cwd(), "data");
const EXPORTS_DIR = path.resolve(process.cwd(), "public", "exports");
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin1234";
const DEFAULT_CENTER_ID = "center_admin";
const DEFAULT_CENTER_NAME = "SkinHarmony Smart Desk";
const DEFAULT_STAFF_PRESET = [
  { name: "Operatore 1", colorTag: "#6db7ff" },
  { name: "Operatore 2", colorTag: "#8fd9c8" },
  { name: "Responsabile", colorTag: "#d7b3ff" }
];

const defaultSettings = {
  centerName: "Ecosistema Center",
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
  moduleSkinPro: false,
  moduleO3System: false,
  moduleTermosauna: false,
  moduleExternalTech: true,
  aiMode: "local",
  aiActionsEnabled: true,
  backupFrequency: "Ogni 6 ore",
  syncEnabled: false,
  membershipEnabled: true,
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
  membershipPearlThresholdCents: 30000,
  membershipSilverThresholdCents: 70000,
  membershipGoldThresholdCents: 120000,
  membershipPearlDiscountPercent: 5,
  membershipSilverDiscountPercent: 10,
  membershipGoldDiscountPercent: 15
};

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function sanitizeFileName(value) {
  return String(value || "file")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "file";
}

function splitName(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function toDateOnly(value) {
  if (!value) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value).slice(0, 10);
  }
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function toDateTime(date, time) {
  return `${toDateOnly(date)}T${String(time || "09:00").slice(0, 5)}:00`;
}

function toTimeOnly(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "09:00";
  }
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

function rangeForView(view, anchorDate) {
  const anchor = new Date(anchorDate || new Date().toISOString());
  const base = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (view === "week") {
    const day = base.getDay();
    const diffToMonday = (day + 6) % 7;
    const start = new Date(base);
    start.setDate(base.getDate() - diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: toDateOnly(start), end: toDateOnly(end) };
  }
  if (view === "month") {
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return { start: toDateOnly(start), end: toDateOnly(end) };
  }
  return { start: toDateOnly(base), end: toDateOnly(base) };
}

function resolveDashboardRange(options = {}) {
  const period = typeof options === "object" ? String(options.period || "day") : "day";
  const anchorDate = typeof options === "object" ? options.anchorDate : undefined;
  return { period, ...rangeForView(period, anchorDate || new Date().toISOString()) };
}

function resolveReportRange(options = {}) {
  const period = typeof options === "string" ? options : String(options.period || "day");
  const customStart = typeof options === "object" ? String(options.startDate || "") : "";
  const customEnd = typeof options === "object" ? String(options.endDate || "") : "";
  if (customStart && customEnd) {
    return {
      period,
      start: customStart,
      end: customEnd,
      label: `${new Date(customStart).toLocaleDateString("it-IT")} - ${new Date(customEnd).toLocaleDateString("it-IT")}`
    };
  }
  const now = new Date();
  let start = new Date(now);
  if (period === "week") {
    start.setDate(now.getDate() - 7);
  } else if (period === "month") {
    start.setMonth(now.getMonth() - 1);
  } else {
    start.setHours(0, 0, 0, 0);
  }
  return {
    period,
    start: toDateOnly(start),
    end: toDateOnly(now),
    label: period === "day" ? "Oggi" : period === "week" ? "Ultimi 7 giorni" : "Ultimi 30 giorni"
  };
}

function shiftDate(dateValue, days) {
  const base = new Date(`${toDateOnly(dateValue)}T00:00:00`);
  base.setDate(base.getDate() + Number(days || 0));
  return toDateOnly(base);
}

function daysBetweenInclusive(start, end) {
  const startDate = new Date(`${toDateOnly(start)}T00:00:00`);
  const endDate = new Date(`${toDateOnly(end)}T00:00:00`);
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
}

function timeBandFromDate(dateValue) {
  const hour = new Date(dateValue).getHours();
  if (hour < 12) return "Mattina";
  if (hour < 15) return "Pranzo";
  if (hour < 18) return "Pomeriggio";
  return "Sera";
}

function minutesBetween(startTime, endTime) {
  const [startHour = "0", startMinute = "0"] = String(startTime || "").split(":");
  const [endHour = "0", endMinute = "0"] = String(endTime || "").split(":");
  return (Number(endHour) * 60 + Number(endMinute)) - (Number(startHour) * 60 + Number(startMinute));
}

function formatMinutes(totalMinutes) {
  const safe = Math.max(0, Number(totalMinutes || 0));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function effectiveStartTime(item) {
  return item.rectifiedStartTime || item.originalStartTime || item.startTime;
}

function effectiveEndTime(item) {
  return item.rectifiedEndTime || item.originalEndTime || item.endTime;
}

function clockStartTime(item) {
  return item.rectifiedStartTime || item.originalStartTime || "";
}

function clockEndTime(item) {
  return item.rectifiedEndTime || item.originalEndTime || "";
}

function plannedMinutes(item) {
  return Math.max(0, minutesBetween(item.startTime, item.endTime));
}

function workedMinutes(item) {
  const start = clockStartTime(item);
  const end = clockEndTime(item);
  if (!start || !end) return 0;
  return Math.max(0, minutesBetween(start, end));
}

function dailyBalanceMinutes(item) {
  const planned = plannedMinutes(item);
  const worked = workedMinutes(item);
  const todayKey = toDateOnly(new Date());
  const hasClockStart = Boolean(clockStartTime(item));
  const hasClockEnd = Boolean(clockEndTime(item));
  if ((item.attendanceStatus === "absent" || (!hasClockStart && item.date < todayKey)) && item.date <= todayKey) {
    return -planned;
  }
  if (hasClockStart && hasClockEnd) {
    return worked - planned;
  }
  return 0;
}

function derivedAttendanceLabel(item) {
  const todayKey = toDateOnly(new Date());
  const hasClockStart = Boolean(clockStartTime(item));
  const hasClockEnd = Boolean(clockEndTime(item));
  if (item.attendanceStatus === "absent" || (!hasClockStart && item.date < todayKey)) return "Assente";
  if (hasClockStart && !hasClockEnd) return "Entrato";
  const balance = dailyBalanceMinutes(item);
  if (hasClockStart && hasClockEnd) {
    if (balance > 0) return "Straordinario";
    if (balance < 0) return "Debito ore";
    return "Regolare";
  }
  return "Da timbrare";
}

function formatSignedMinutes(totalMinutes) {
  if (!totalMinutes) return "0h 00m";
  const sign = totalMinutes > 0 ? "+" : "-";
  return `${sign}${formatMinutes(Math.abs(totalMinutes))}`;
}

function normalizeWeek(days) {
  return Array.from({ length: 7 }, (_, weekday) => {
    const current = Array.isArray(days) ? days.find((item) => Number(item.weekday) === weekday) : null;
    return {
      weekday,
      enabled: Boolean(current?.enabled),
      startTime: current?.startTime || "09:00",
      endTime: current?.endTime || "18:00"
    };
  });
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

function resolveMembership(totalSpentCents, settings) {
  if (!settings.membershipEnabled) {
    return null;
  }
  if (totalSpentCents >= Number(settings.membershipGoldThresholdCents || 0)) {
    return { level: "Gold", discountPercent: Number(settings.membershipGoldDiscountPercent || 0) };
  }
  if (totalSpentCents >= Number(settings.membershipSilverThresholdCents || 0)) {
    return { level: "Silver", discountPercent: Number(settings.membershipSilverDiscountPercent || 0) };
  }
  if (totalSpentCents >= Number(settings.membershipPearlThresholdCents || 0)) {
    return { level: "Pearl", discountPercent: Number(settings.membershipPearlDiscountPercent || 0) };
  }
  return null;
}

class DesktopMirrorService {
  constructor() {
    this.clientsRepository = new JsonFileRepository(path.join(DATA_DIR, "clients.json"), []);
    this.appointmentsRepository = new JsonFileRepository(path.join(DATA_DIR, "appointments.json"), []);
    this.servicesRepository = new JsonFileRepository(path.join(DATA_DIR, "services.json"), []);
    this.staffRepository = new JsonFileRepository(path.join(DATA_DIR, "staff.json"), []);
    this.shiftsRepository = new JsonFileRepository(path.join(DATA_DIR, "shifts.json"), []);
    this.shiftTemplatesRepository = new JsonFileRepository(path.join(DATA_DIR, "shift_templates.json"), []);
    this.resourcesRepository = new JsonFileRepository(path.join(DATA_DIR, "resources.json"), []);
    this.inventoryRepository = new JsonFileRepository(path.join(DATA_DIR, "inventory.json"), []);
    this.inventoryMovementsRepository = new JsonFileRepository(path.join(DATA_DIR, "inventory_movements.json"), []);
    this.profitabilityExecutionsRepository = new JsonFileRepository(path.join(DATA_DIR, "profitability_executions.json"), []);
    this.operatorIncentiveRulesRepository = new JsonFileRepository(path.join(DATA_DIR, "operator_incentive_rules.json"), []);
    this.operatorIncentiveResultsRepository = new JsonFileRepository(path.join(DATA_DIR, "operator_incentive_results.json"), []);
    this.paymentsRepository = new JsonFileRepository(path.join(DATA_DIR, "payments.json"), []);
    this.treatmentsRepository = new JsonFileRepository(path.join(DATA_DIR, "treatments.json"), []);
    this.usersRepository = new JsonFileRepository(path.join(DATA_DIR, "users.json"), []);
    this.settingsRepository = new JsonFileRepository(path.join(DATA_DIR, "settings.json"), defaultSettings);
    this.centerSettingsRepository = new JsonFileRepository(path.join(DATA_DIR, "settings_by_center.json"), []);
    this.centerRepository = new JsonFileRepository(path.join(DATA_DIR, "center.json"), {});
    this.salesRepository = new JsonFileRepository(path.join(DATA_DIR, "sales.json"), []);
    this.sessions = new Map();
    this.ensureInitialAdmin();
  }

  ensureInitialAdmin() {
    const users = this.usersRepository.list();
    const existingAdmin = users.find((user) => String(user.username || "").trim().toLowerCase() === DEFAULT_ADMIN_USERNAME);
    if (!existingAdmin) {
      this.usersRepository.create({
        id: crypto.randomUUID(),
        username: DEFAULT_ADMIN_USERNAME,
        passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
        role: "superadmin",
        active: true,
        centerId: DEFAULT_CENTER_ID,
        centerName: DEFAULT_CENTER_NAME,
        createdAt: new Date().toISOString()
      });
    } else if (existingAdmin.role !== "superadmin" || !existingAdmin.centerId || !existingAdmin.centerName) {
      this.usersRepository.update(existingAdmin.id, (user) => ({
        ...user,
        role: "superadmin",
        centerId: user.centerId || DEFAULT_CENTER_ID,
        centerName: user.centerName || DEFAULT_CENTER_NAME
      }));
    }
    this.ensureCenterSettings(DEFAULT_CENTER_ID, DEFAULT_CENTER_NAME);
    this.seedDefaultStaffForCenter(DEFAULT_CENTER_ID, DEFAULT_CENTER_NAME);
  }

  getCenterId(session) {
    return session?.centerId || DEFAULT_CENTER_ID;
  }

  getCenterName(session) {
    return session?.centerName || DEFAULT_CENTER_NAME;
  }

  isInCenter(item, centerId) {
    return (item?.centerId || DEFAULT_CENTER_ID) === centerId;
  }

  filterByCenter(items, session) {
    const centerId = this.getCenterId(session);
    return items.filter((item) => this.isInCenter(item, centerId));
  }

  attachCenter(item, session) {
    return {
      ...item,
      centerId: item.centerId || this.getCenterId(session)
    };
  }

  findByIdInCenter(repository, id, session) {
    const found = repository.findById(id);
    if (!found) return null;
    return this.isInCenter(found, this.getCenterId(session)) ? found : null;
  }

  ensureCenterSettings(centerId, centerName) {
    const items = this.centerSettingsRepository.list();
    const existing = items.find((item) => item.centerId === centerId);
    if (existing) {
      if (existing.id !== centerId) {
        this.centerSettingsRepository.write(items.map((item) => item.centerId === centerId ? { ...item, id: centerId, staffSeeded: item.staffSeeded === true } : item));
      }
      return;
    }
    this.centerSettingsRepository.create({
      id: centerId,
      centerId,
      centerName,
      staffSeeded: false,
      settings: { ...defaultSettings, centerName }
    });
  }

  getCenterSettingsRecord(session) {
    const centerId = this.getCenterId(session);
    const centerName = this.getCenterName(session);
    this.ensureCenterSettings(centerId, centerName);
    const items = this.centerSettingsRepository.list();
    return items.find((item) => item.centerId === centerId) || {
      id: centerId,
      centerId,
      centerName,
      staffSeeded: false,
      settings: { ...defaultSettings, centerName }
    };
  }

  seedDefaultStaffForCenter(centerId, centerName) {
    this.ensureCenterSettings(centerId, centerName);
    const record = this.centerSettingsRepository.list().find((item) => item.centerId === centerId);
    if (record?.staffSeeded) return;

    const hasStaffInCenter = this.staffRepository.list().some((item) => (item.centerId || DEFAULT_CENTER_ID) === centerId);
    if (!hasStaffInCenter) {
      DEFAULT_STAFF_PRESET.forEach((item, index) => {
        this.staffRepository.create({
          id: `${centerId}_staff_${index + 1}`,
          centerId,
          name: item.name,
          colorTag: item.colorTag,
          role: "",
          shift: "",
          targetProgress: 0,
          active: 1,
          createdAt: new Date().toISOString()
        });
      });
    }

    this.centerSettingsRepository.update(centerId, (current) => ({
      ...current,
      id: centerId,
      centerId,
      centerName: current.centerName || centerName,
      staffSeeded: true
    }));
  }

  listClients(search = "", session) {
    const normalizedSearch = String(search || "").trim().toLowerCase();
    const clients = this.filterByCenter(this.clientsRepository.list(), session)
      .filter((client) => {
        if (!normalizedSearch) return true;
        return [client.name, client.phone, client.email].filter(Boolean).some((field) => String(field).toLowerCase().includes(normalizedSearch));
      });
    const appointments = this.listAppointments("month", new Date().toISOString(), true, session);
    const servicesById = new Map(this.listServices(session).map((service) => [service.id, service]));
    const inventoryItems = this.listInventoryItems(session);
    return clients.map((client) => {
      const mapped = this.mapClient(client);
      const completedAppointments = appointments.filter((item) => item.clientId === client.id && item.status === "completed");
      const treatments = this.listTreatments(client.id, session);
      return {
        ...mapped,
        clientIntelligence: this.buildClientIntelligence(completedAppointments, treatments, servicesById, inventoryItems)
      };
    });
  }

  saveClient(payload, session) {
    const next = this.attachCenter(this.toClientEntity(payload), session);
    if (payload.id) {
      const current = this.findByIdInCenter(this.clientsRepository, payload.id, session);
      if (!current) {
        throw new Error("Cliente non trovato");
      }
      const updated = this.clientsRepository.update(payload.id, (entry) => ({ ...entry, ...next, id: entry.id, centerId: entry.centerId || next.centerId }));
      return this.mapClient(updated || next);
    }
    this.clientsRepository.create(next);
    return this.mapClient(next);
  }

  getClientDetail(id, session) {
    const client = this.findByIdInCenter(this.clientsRepository, id, session);
    if (!client) {
      throw new Error("Cliente non trovato");
    }
    const appointments = this.listAppointments("month", new Date().toISOString(), true, session).filter((item) => item.clientId === id);
    const treatments = this.listTreatments(id, session);
    const payments = this.listPayments(id, session);
    const settings = this.getSettings(session);
    const services = this.listServices(session);
    const servicesById = new Map(services.map((service) => [service.id, service]));
    const completedAppointments = appointments.filter((item) => item.status === "completed");
    const totalSpentCents = completedAppointments.reduce((sum, appointment) => {
      const serviceIds = Array.isArray(appointment.serviceIds) && appointment.serviceIds.length > 0
        ? appointment.serviceIds
        : appointment.serviceId ? [appointment.serviceId] : [];
      return sum + serviceIds.reduce((serviceSum, serviceId) => serviceSum + Number(servicesById.get(serviceId)?.priceCents || 0), 0);
    }, 0);
    const lastCompletedAppointment = completedAppointments
      .slice()
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())[0] || null;
    const daysSinceLastVisit = lastCompletedAppointment ? Math.max(0, Math.floor((Date.now() - new Date(lastCompletedAppointment.startAt).getTime()) / 86400000)) : null;
    const clientTags = [
      ...(completedAppointments.length > 5 ? ["cliente frequente"] : []),
      ...(totalSpentCents >= 50000 ? ["cliente premium"] : []),
      ...(typeof daysSinceLastVisit === "number" && daysSinceLastVisit >= 30 ? ["cliente inattivo"] : [])
    ];
    const membership = resolveMembership(totalSpentCents, settings);
    const clientIntelligence = this.buildClientIntelligence(completedAppointments, treatments, servicesById, this.listInventoryItems(session));
    return {
      client: this.mapClient(client),
      appointments,
      treatments,
      payments,
      clientTags,
      membership,
      businessSummary: {
        completedVisits: completedAppointments.length,
        totalSpentCents,
        daysSinceLastVisit
      },
      clientIntelligence
    };
  }

  getClientConsultation(id, session) {
    const detail = this.getClientDetail(id, session);
    const revenueCents = detail.payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const appointments = detail.appointments;
    const completed = appointments.filter((item) => item.status === "completed").length;
    const cancelled = appointments.filter((item) => item.status === "cancelled").length;
    const lastAppointment = appointments[0];
    const summary = [
      `${detail.client.firstName} ${detail.client.lastName} ha ${appointments.length} appuntamenti registrati.`,
      completed ? `${completed} appuntamenti risultano completati.` : "Non risultano appuntamenti completati.",
      revenueCents ? `Incasso storico cliente: ${euro(revenueCents)}.` : "Nessun pagamento registrato."
    ];
    const missingData = [];
    if (!detail.client.phone) missingData.push("telefono mancante");
    if (!detail.client.email) missingData.push("email mancante");
    if (!detail.client.notes) missingData.push("note cliente assenti");
    const intelligence = detail.clientIntelligence || null;
    const intelligenceSuggestions = Array.isArray(intelligence?.suggestionCards) ? intelligence.suggestionCards : [];
    return {
      clientName: `${detail.client.firstName} ${detail.client.lastName}`.trim(),
      summary,
      protocolBrief: detail.treatments.length ? `Trattamenti registrati: ${detail.treatments.length}.` : "Nessun trattamento registrato.",
      technologyBrief: detail.treatments.length ? "Storico tecnico disponibile." : "Storico tecnico non disponibile.",
      missingData,
      nextActions: [
        ...intelligenceSuggestions,
        !detail.client.phone ? "raccogliere telefono per follow-up rapido" : "telefono cliente aggiornato",
        cancelled ? "verificare cause di annullamento o no-show" : "nessuna criticita evidente da annullamenti",
        lastAppointment ? `ripartire dall'ultima visita del ${new Date(lastAppointment.startAt).toLocaleDateString("it-IT")}` : "programmarea una prima visita completa"
      ].slice(0, 5),
      clientIntelligence: intelligence,
      drafts: {
        note: `Briefing AI ${new Date().toLocaleString("it-IT")}\n${summary.join("\n")}\nDati mancanti: ${missingData.join(", ") || "nessuno."}`,
        protocol: "Bozza protocollo AI: usare lo storico reale del cliente e definire il prossimo step in cabina.",
        nextStep: {
          serviceId: lastAppointment?.serviceId || null,
          serviceName: lastAppointment?.serviceName || null,
          notes: "Preparare il prossimo appuntamento partendo dallo storico cliente reale."
        }
      },
      metrics: {
        appointments: appointments.length,
        completedAppointments: completed,
        payments: detail.payments.length,
        totalRevenueCents: revenueCents,
        treatments: detail.treatments.length
      }
    };
  }

  buildClientIntelligence(completedAppointments, treatments, servicesById, inventoryItems = []) {
    const sortedVisits = completedAppointments
      .slice()
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    const visitCount = sortedVisits.length;
    const totalSpentCents = sortedVisits.reduce((sum, appointment) => {
      const serviceIds = Array.isArray(appointment.serviceIds) && appointment.serviceIds.length > 0
        ? appointment.serviceIds
        : appointment.serviceId ? [appointment.serviceId] : [];
      return sum + serviceIds.reduce((serviceSum, serviceId) => serviceSum + Number(servicesById.get(serviceId)?.priceCents || 0), 0);
    }, 0);
    const averageTicketCents = visitCount > 0 ? Math.round(totalSpentCents / visitCount) : 0;
    const lastVisitDate = visitCount > 0 ? sortedVisits[visitCount - 1].startAt : null;
    const daysSinceLastVisit = lastVisitDate ? Math.max(0, Math.floor((Date.now() - new Date(lastVisitDate).getTime()) / 86400000)) : null;
    const intervals = sortedVisits.slice(1).map((appointment, index) => Math.max(0, Math.round((new Date(appointment.startAt).getTime() - new Date(sortedVisits[index].startAt).getTime()) / 86400000)));
    const averageDaysBetweenVisits = visitCount >= 3 && intervals.length > 0
      ? Math.max(1, Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length))
      : null;
    let frequencyStatus = "DATI_INSUFFICIENTI";
    if (averageDaysBetweenVisits && typeof daysSinceLastVisit === "number") {
      if (daysSinceLastVisit <= averageDaysBetweenVisits) frequencyStatus = "ATTIVO";
      else if (daysSinceLastVisit <= averageDaysBetweenVisits * 1.5) frequencyStatus = "IN_RITARDO";
      else frequencyStatus = "INATTIVO";
    }
    const serviceCounter = new Map();
    sortedVisits.forEach((appointment) => {
      const serviceIds = Array.isArray(appointment.serviceIds) && appointment.serviceIds.length > 0
        ? appointment.serviceIds
        : appointment.serviceId ? [appointment.serviceId] : [];
      serviceIds.forEach((serviceId) => {
        const service = servicesById.get(serviceId);
        if (!service) return;
        const current = serviceCounter.get(serviceId) || { serviceId, name: service.name, count: 0, priceCents: Number(service.priceCents || 0) };
        current.count += 1;
        serviceCounter.set(serviceId, current);
      });
    });
    const favoriteServices = Array.from(serviceCounter.values())
      .sort((a, b) => b.count - a.count || b.priceCents - a.priceCents)
      .slice(0, 3)
      .map(({ serviceId, name, count }) => ({ serviceId, name, count }));
    const lastServices = sortedVisits.slice(-3).reverse().map((appointment) => servicesById.get(appointment.serviceId)?.name || appointment.serviceName || "Servizio");
    const purchasedProducts = Array.from(new Set(
      treatments.flatMap((item) => String(item.productsUsed || "").split(/[,;]+/).map((product) => product.trim()).filter(Boolean))
    )).slice(0, 6);
    const recommendedProduct = purchasedProducts.length > 0
      ? null
      : inventoryItems
        .filter((item) => Number(item.stockQuantity || 0) > 0)
        .sort((a, b) => {
          const aRetail = a.usageType === "retail" || a.usageType === "misto" ? 1 : 0;
          const bRetail = b.usageType === "retail" || b.usageType === "misto" ? 1 : 0;
          return bRetail - aRetail || Number(b.retailPriceCents || 0) - Number(a.retailPriceCents || 0);
        })[0]?.name || null;
    const spendingLevel = averageTicketCents < 6000 ? "LOW" : averageTicketCents < 11000 ? "MEDIUM" : "HIGH";
    const mostlyBaseServices = favoriteServices.length > 0 && favoriteServices.every((service) => {
      const linked = servicesById.get(service.serviceId);
      const name = String(linked?.name || service.name || "").toLowerCase();
      const category = String(linked?.category || "").toLowerCase();
      return Number(linked?.priceCents || 0) < 9000 && !/premium|advanced|ritual|focus|pro/.test(`${name} ${category}`);
    });
    const mainService = favoriteServices[0]?.name || "servizio abituale";
    const suggestionCards = [];
    if (frequencyStatus === "IN_RITARDO") suggestionCards.push(`Cliente in ritardo rispetto alla sua routine. Proponi ${mainService}.`);
    else if (frequencyStatus === "INATTIVO") suggestionCards.push("Cliente inattivo. Consigliato contatto.");
    else if (frequencyStatus === "ATTIVO") suggestionCards.push(`Cliente attivo. Mantieni continuità su ${mainService}.`);
    else suggestionCards.push("Dati ancora limitati. Costruisci una routine dalle prossime visite.");
    if (mostlyBaseServices) suggestionCards.push("Puoi proporre upgrade a servizio avanzato.");
    if (purchasedProducts.length === 0) suggestionCards.push(recommendedProduct ? `Suggerisci prodotto mantenimento: ${recommendedProduct}.` : "Suggerisci prodotto mantenimento.");
    if (spendingLevel === "HIGH") suggestionCards.push("Cliente ad alto valore. Punta su fidelizzazione.");
    return {
      lastVisitDate,
      visitCount,
      averageDaysBetweenVisits,
      frequencyStatus,
      averageTicketCents,
      spendingLevel,
      totalSpentCents,
      favoriteServices,
      lastServices,
      purchasedProducts,
      recommendedProduct,
      suggestionCards: suggestionCards.slice(0, 4),
      suggestedAction: suggestionCards[0] || "Mantieni la relazione e registra il prossimo step."
    };
  }

  listShifts(view = "month", anchorDate = new Date().toISOString(), staffId, session) {
    const { start, end } = rangeForView(view, anchorDate);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    return this.filterByCenter(this.shiftsRepository.list(), session)
      .filter((item) => item.date >= start && item.date <= end && (!staffId || item.staffId === staffId))
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
      .map((item) => {
        const operator = staff.find((entry) => entry.id === item.staffId);
        return {
          ...item,
          clockStartTime: clockStartTime(item),
          clockEndTime: clockEndTime(item),
          effectiveStartTime: effectiveStartTime(item),
          effectiveEndTime: effectiveEndTime(item),
          isRectified: Boolean(item.rectifiedAt),
          plannedMinutes: plannedMinutes(item),
          workedMinutes: workedMinutes(item),
          dailyBalanceMinutes: dailyBalanceMinutes(item),
          derivedAttendanceLabel: derivedAttendanceLabel(item),
          staffName: operator?.name || "Operatore",
          staffColorTag: operator?.colorTag || null
        };
      });
  }

  saveShift(payload, session) {
    const now = new Date().toISOString();
    const current = payload.id ? this.findByIdInCenter(this.shiftsRepository, payload.id, session) : null;
    if (payload.id && !current) {
      throw new Error("Turno non trovato");
    }
    const next = this.attachCenter({
      id: payload.id || `shift_${Date.now()}`,
      staffId: payload.staffId,
      date: payload.date || toDateOnly(now),
      startTime: String(payload.startTime || "09:00").slice(0, 5),
      endTime: String(payload.endTime || "18:00").slice(0, 5),
      originalStartTime: payload.originalStartTime ? String(payload.originalStartTime).slice(0, 5) : null,
      originalEndTime: payload.originalEndTime ? String(payload.originalEndTime).slice(0, 5) : null,
      originalAttendanceStatus: payload.originalAttendanceStatus || null,
      rectifiedStartTime: payload.rectifiedStartTime ? String(payload.rectifiedStartTime).slice(0, 5) : null,
      rectifiedEndTime: payload.rectifiedEndTime ? String(payload.rectifiedEndTime).slice(0, 5) : null,
      rectificationReason: payload.rectificationReason || "",
      rectifiedBy: payload.rectifiedBy || "",
      rectifiedAt: payload.rectifiedAt || "",
      notes: payload.notes || "",
      attendanceStatus: payload.attendanceStatus || "unconfirmed",
      attendanceNote: payload.attendanceNote || "",
      confirmedAt: payload.confirmedAt || "",
      createdAt: payload.createdAt || now,
      updatedAt: now
    }, session);

    if ((session?.role || "owner") === "staff") {
      next.rectifiedStartTime = current?.rectifiedStartTime || null;
      next.rectifiedEndTime = current?.rectifiedEndTime || null;
      next.rectificationReason = current?.rectificationReason || "";
      next.rectifiedBy = current?.rectifiedBy || "";
      next.rectifiedAt = current?.rectifiedAt || "";
      next.originalStartTime = current?.originalStartTime || next.originalStartTime;
      next.originalEndTime = current?.originalEndTime || next.originalEndTime;
      next.originalAttendanceStatus = current?.originalAttendanceStatus || next.originalAttendanceStatus;
    }

    if (payload.id) {
      this.shiftsRepository.update(payload.id, (entry) => ({ ...entry, ...next, id: entry.id, centerId: entry.centerId || next.centerId, createdAt: entry.createdAt || next.createdAt }));
    } else {
      this.shiftsRepository.create(next);
    }
    return next;
  }

  deleteShift(id, session) {
    if (!this.findByIdInCenter(this.shiftsRepository, id, session)) return { success: false };
    return { success: this.shiftsRepository.delete(id) };
  }

  listShiftTemplates(session) {
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    return this.filterByCenter(this.shiftTemplatesRepository.list(), session).map((item) => ({
      ...item,
      repeatEveryDays: Number(item.repeatEveryDays || 7),
      weekA: normalizeWeek(item.weekA),
      weekB: normalizeWeek(item.weekB),
      staffName: staff.find((entry) => entry.id === item.staffId)?.name || "Operatore"
    }));
  }

  saveShiftTemplate(payload, session) {
    const now = new Date().toISOString();
    const next = this.attachCenter({
      id: payload.id || `template_${Date.now()}`,
      staffId: payload.staffId,
      name: payload.name || "Schema turni",
      mode: payload.mode === "rotation" ? "rotation" : "single",
      repeatEveryDays: Number(payload.repeatEveryDays || 7),
      weekA: normalizeWeek(payload.weekA),
      weekB: payload.mode === "rotation" ? normalizeWeek(payload.weekB) : [],
      createdAt: payload.createdAt || now,
      updatedAt: now
    }, session);
    if (payload.id) {
      const current = this.findByIdInCenter(this.shiftTemplatesRepository, payload.id, session);
      if (!current) throw new Error("Schema turni non trovato");
      this.shiftTemplatesRepository.update(payload.id, (entry) => ({ ...entry, ...next, id: entry.id, centerId: entry.centerId || next.centerId, createdAt: entry.createdAt || next.createdAt }));
    } else {
      this.shiftTemplatesRepository.create(next);
    }
    return this.listShiftTemplates(session).find((item) => item.id === next.id) || next;
  }

  deleteShiftTemplate(id, session) {
    if (!this.findByIdInCenter(this.shiftTemplatesRepository, id, session)) return { success: false };
    return { success: this.shiftTemplatesRepository.delete(id) };
  }

  generateShiftTemplate(payload, session) {
    const template = this.findByIdInCenter(this.shiftTemplatesRepository, payload.templateId, session);
    if (!template) throw new Error("Schema turni non trovato");
    const start = new Date(payload.startDate);
    const end = new Date(payload.endDate);
    const weekA = normalizeWeek(template.weekA);
    const weekB = normalizeWeek(template.weekB);
    const repeatWeeks = Math.max(1, Math.round(Number(template.repeatEveryDays || 7) / 7));
    const existingKeys = new Set(this.filterByCenter(this.shiftsRepository.list(), session).filter((item) => item.staffId === template.staffId).map((item) => `${item.staffId}:${item.date}:${item.startTime}:${item.endTime}`));
    let generatedCount = 0;

    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const cursorDate = toDateOnly(cursor);
      const startWeek = new Date(start);
      startWeek.setDate(start.getDate() - start.getDay());
      const currentWeek = new Date(cursor);
      currentWeek.setDate(cursor.getDate() - cursor.getDay());
      const weekDiff = Math.round((currentWeek.getTime() - startWeek.getTime()) / 604800000);
      if (template.mode !== "rotation" && weekDiff % repeatWeeks !== 0) continue;
      const weekday = new Date(cursor).getDay();
      const dayConfig = (template.mode === "rotation" && weekDiff % 2 === 1 ? weekB : weekA).find((item) => item.weekday === weekday);
      if (!dayConfig?.enabled) continue;
      const key = `${template.staffId}:${cursorDate}:${dayConfig.startTime}:${dayConfig.endTime}`;
      if (existingKeys.has(key)) continue;
      this.shiftsRepository.create(this.attachCenter({
        id: `shift_${Date.now()}_${generatedCount}`,
        staffId: template.staffId,
        date: cursorDate,
        startTime: dayConfig.startTime,
        endTime: dayConfig.endTime,
        originalStartTime: null,
        originalEndTime: null,
        originalAttendanceStatus: null,
        rectifiedStartTime: null,
        rectifiedEndTime: null,
        rectificationReason: "",
        rectifiedBy: "",
        rectifiedAt: "",
        notes: `Generato da schema: ${template.name}`,
        attendanceStatus: "unconfirmed",
        attendanceNote: "",
        confirmedAt: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, session));
      existingKeys.add(key);
      generatedCount += 1;
    }

    return { success: true, generatedCount };
  }

  exportShiftReport(options = {}, session) {
    const mode = options.mode || "month";
    const anchorDate = options.anchorDate || new Date().toISOString();
    let range = rangeForView(mode === "custom" ? "month" : mode, anchorDate);
    if (mode === "custom") {
      range = {
        start: options.startDate || range.start,
        end: options.endDate || range.end
      };
    }
    const settings = this.getSettings(session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const rows = this.filterByCenter(this.shiftsRepository.list(), session)
      .filter((item) => item.date >= range.start && item.date <= range.end && (!options.staffId || item.staffId === options.staffId))
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
    const staffName = options.staffId ? (staff.find((item) => item.id === options.staffId)?.name || "Operatore") : "Tutti gli operatori";
    const totalWorkedMinutes = rows.reduce((sum, item) => sum + workedMinutes(item), 0);
    const totalPlannedMinutes = rows.reduce((sum, item) => sum + plannedMinutes(item), 0);
    const totalBalanceMinutes = rows.reduce((sum, item) => sum + dailyBalanceMinutes(item), 0);
    const overtimeMinutes = rows.reduce((sum, item) => sum + Math.max(0, dailyBalanceMinutes(item)), 0);
    const debitMinutes = rows.reduce((sum, item) => sum + Math.max(0, -dailyBalanceMinutes(item)), 0);
    const periodLabel = mode === "month"
      ? `${range.start.slice(5, 7)}/${range.start.slice(0, 4)}`
      : mode === "day"
        ? range.start.split("-").reverse().join("/")
        : `${range.start.split("-").reverse().join("/")} - ${range.end.split("-").reverse().join("/")}`;
    const rowsHtml = rows.map((item) => {
      const operator = staff.find((entry) => entry.id === item.staffId);
      return `<tr><td>${item.date.split("-").reverse().join("/")}</td><td>${escapeHtml(operator?.name || "Operatore")}</td><td>${item.startTime} - ${item.endTime}</td><td>${clockStartTime(item) || "--:--"} - ${clockEndTime(item) || "--:--"}</td><td class="${dailyBalanceMinutes(item) > 0 ? "status-positive" : dailyBalanceMinutes(item) < 0 ? "status-negative" : "status-neutral"}">${derivedAttendanceLabel(item) === "Regolare" ? "&#10003; Regolare" : derivedAttendanceLabel(item) === "Debito ore" ? "&ndash; Ritardo" : derivedAttendanceLabel(item) === "Straordinario" ? "+ Straordinario" : derivedAttendanceLabel(item)}</td><td>${formatMinutes(workedMinutes(item))}</td><td class="${dailyBalanceMinutes(item) > 0 ? "saldo-positive" : dailyBalanceMinutes(item) < 0 ? "saldo-negative" : "saldo-neutral"}">${formatSignedMinutes(dailyBalanceMinutes(item))}</td></tr>`;
    }).join("");
    ensureDir(EXPORTS_DIR);
    const fileName = `presenze-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Foglio presenze</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#163047;padding:34px}h1{margin:0 0 8px;color:#1F86AA}.meta{color:#6e8299;margin-bottom:18px}.box{border:1px solid #dfe8f3;border-radius:16px;padding:18px;margin-bottom:20px;background:#f8fbff}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.summary-item{background:#fff;border:1px solid #e7eef5;border-radius:14px;padding:14px 16px}.summary-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6e8299;margin-bottom:6px}.summary-value{font-size:20px;font-weight:700;color:#163047;line-height:1.2}.summary-value.compact{font-size:16px}.summary-value.saldo-positive{color:#2e8b57}.summary-value.saldo-negative{color:#c05a5a}.summary-value.saldo-neutral{color:#163047}table{width:100%;border-collapse:collapse}th,td{padding:13px 12px;border-bottom:1px solid #edf3f8;text-align:left;font-size:13px;vertical-align:middle}th{text-transform:uppercase;font-size:11px;letter-spacing:.05em;color:#6e8299}tbody tr:nth-child(even){background:#fbfdff}.status-positive{color:#2e8b57;font-weight:600}.status-negative{color:#c05a5a;font-weight:600}.status-neutral{color:#163047;font-weight:600}.saldo-positive{color:#2e8b57;font-weight:700}.saldo-negative{color:#c05a5a;font-weight:700}.saldo-neutral{color:#163047;font-weight:700}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:36px}.signature{padding-top:34px;border-top:1px solid #cfdbe6;color:#5b707a;font-size:13px}@media print{.printbar{display:none}}</style></head><body><div class="printbar" style="margin-bottom:16px;"><button onclick="window.print()" style="padding:10px 16px;border-radius:999px;border:1px solid #4FB6D6;background:#4FB6D6;color:#fff;font-weight:700;cursor:pointer;">Stampa documento</button></div><h1>Foglio presenze</h1><div class="meta">${escapeHtml(settings.centerName)} · ${periodLabel}</div><div class="box"><div class="summary-grid"><div class="summary-item"><div class="summary-label">Operatore</div><div class="summary-value compact">${escapeHtml(staffName)}</div></div><div class="summary-item"><div class="summary-label">Ore previste</div><div class="summary-value">${formatMinutes(totalPlannedMinutes)}</div></div><div class="summary-item"><div class="summary-label">Ore lavorate</div><div class="summary-value">${formatMinutes(totalWorkedMinutes)}</div></div><div class="summary-item"><div class="summary-label">${settings.shiftsFlexEnabled ? "Saldo finale" : "Saldo ore"}</div><div class="summary-value ${totalBalanceMinutes > 0 ? "saldo-positive" : totalBalanceMinutes < 0 ? "saldo-negative" : "saldo-neutral"}">${settings.shiftsFlexEnabled ? formatSignedMinutes(totalBalanceMinutes) : totalBalanceMinutes > 0 ? `+${formatMinutes(overtimeMinutes)}` : totalBalanceMinutes < 0 ? `-${formatMinutes(debitMinutes)}` : "0h 00m"}</div></div></div></div><table><thead><tr><th>Data</th><th>Operatore</th><th>Turno</th><th>Reale</th><th>Stato</th><th>Ore</th><th>Saldo</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="7">Nessun turno disponibile nel periodo selezionato.</td></tr>`}</tbody></table><div class="signatures"><div class="signature">Firma operatore</div><div class="signature">Firma responsabile</div></div></body></html>`;
    fs.writeFileSync(filePath, html);
    return { path: filePath, format: "html", url: `/exports/${fileName}` };
  }

  generateClientConsentDocument(id, session) {
    const detail = this.getClientDetail(id, session);
    const settings = this.getSettings(session);
    const requiredFields = [
      { label: "Nome centro", value: settings.centerName },
      { label: "Ragione sociale", value: settings.centerLegalName },
      { label: "Email centro", value: settings.centerEmail },
      { label: "Telefono centro", value: settings.centerPhone }
    ];
    const missingFields = requiredFields.filter((field) => !String(field.value || "").trim());
    if (missingFields.length > 0) {
      throw new Error(`Completa prima il profilo centro: ${missingFields.map((field) => field.label).join(" · ")}`);
    }

    ensureDir(EXPORTS_DIR);
    const timestamp = Date.now();
    const fullName = `${detail.client.firstName || ""} ${detail.client.lastName || ""}`.trim() || "Cliente";
    const safeName = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cliente";
    const fileName = `consenso-${safeName}-${timestamp}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    fs.writeFileSync(filePath, this.buildClientConsentDocumentHtml(detail, settings));
    return { path: filePath, format: "html", url: `/exports/${fileName}` };
  }

  listAppointments(view = "day", anchorDate = new Date().toISOString(), includeAll = false, session) {
    const anchor = new Date(anchorDate);
    const anchorKey = toDateOnly(anchorDate);
    const start = new Date(anchor);
    const end = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    if (view === "week") {
      start.setDate(anchor.getDate() - anchor.getDay() + 1);
      end.setDate(start.getDate() + 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (view === "month") {
      start.setDate(1);
      end.setMonth(anchor.getMonth() + 1, 0);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    }
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    const resources = this.filterByCenter(this.resourcesRepository.list(), session);
    const items = this.filterByCenter(this.appointmentsRepository.list(), session).map((item) => {
      const mapped = this.mapAppointment(item, clients, services, staff, resources);
      const date = new Date(mapped.startAt);
      return { mapped, date };
    });
    return items
      .filter(({ mapped, date }) => includeAll || (date >= start && date <= end) || (view === "day" && toDateOnly(mapped.startAt) === anchorKey))
      .sort((a, b) => new Date(a.mapped.startAt).getTime() - new Date(b.mapped.startAt).getTime())
      .map(({ mapped }) => mapped);
  }

  saveAppointment(payload, session) {
    if (payload.id) {
      const current = this.findByIdInCenter(this.appointmentsRepository, payload.id, session);
      if (!current) {
        throw new Error("Appuntamento non trovato");
      }
      const updated = this.appointmentsRepository.update(payload.id, (current) => {
        const next = this.toAppointmentEntity({
          ...current,
          ...payload,
          id: current.id,
          createdAt: current.createdAt,
          locked: payload.locked ?? current.locked ?? 0
        }, session);
        return { ...current, ...this.attachCenter(next, session), id: current.id, centerId: current.centerId || this.getCenterId(session) };
      });
      return this.mapAppointment(updated || this.attachCenter(this.toAppointmentEntity(payload, session), session), this.filterByCenter(this.clientsRepository.list(), session), this.filterByCenter(this.servicesRepository.list(), session), this.filterByCenter(this.staffRepository.list(), session), this.filterByCenter(this.resourcesRepository.list(), session));
    }
    const next = this.attachCenter(this.toAppointmentEntity(payload, session), session);
    this.appointmentsRepository.create(next);
    return this.mapAppointment(next, this.filterByCenter(this.clientsRepository.list(), session), this.filterByCenter(this.servicesRepository.list(), session), this.filterByCenter(this.staffRepository.list(), session), this.filterByCenter(this.resourcesRepository.list(), session));
  }

  listServices(session) {
    return this.filterByCenter(this.servicesRepository.list(), session).map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category || "",
      colorTag: item.colorTag || null,
      durationMin: Number(item.durationMin ?? item.duration ?? 60),
      priceCents: Number(item.priceCents ?? Math.round(Number(item.price || 0) * 100)),
      productLinks: Array.isArray(item.productLinks) ? item.productLinks.map((link) => ({
        productId: link.productId,
        usageUnits: Number(link.usageUnits || 1)
      })) : [],
      technologyLinks: Array.isArray(item.technologyLinks) ? item.technologyLinks.map((link) => ({
        technologyId: link.technologyId,
        usageUnits: Number(link.usageUnits || 1)
      })) : [],
      active: Number(item.active ?? 1),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString()
    }));
  }

  saveService(payload, session) {
    const next = this.attachCenter({
      id: payload.id || `srv_${Date.now()}`,
      name: payload.name || "Servizio",
      category: payload.category || "",
      colorTag: payload.colorTag || null,
      duration: Number(payload.durationMin ?? payload.duration ?? 60),
      durationMin: Number(payload.durationMin ?? payload.duration ?? 60),
      price: Number(payload.priceCents ?? payload.price ?? 0) / (payload.priceCents ? 100 : 1),
      priceCents: Number(payload.priceCents ?? Math.round(Number(payload.price || 0) * 100)),
      productLinks: Array.isArray(payload.productLinks) ? payload.productLinks.map((link) => ({
        productId: link.productId,
        usageUnits: Number(link.usageUnits || 1)
      })) : [],
      technologyLinks: Array.isArray(payload.technologyLinks) ? payload.technologyLinks.map((link) => ({
        technologyId: link.technologyId,
        usageUnits: Number(link.usageUnits || 1)
      })) : [],
      operatorType: payload.operatorType || "",
      room: payload.room || "",
      active: Number(payload.active ?? 1),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, session);
    if (payload.id) {
      const current = this.findByIdInCenter(this.servicesRepository, payload.id, session);
      if (!current) throw new Error("Servizio non trovato");
      this.servicesRepository.update(payload.id, (entry) => ({ ...entry, ...next, id: entry.id, centerId: entry.centerId || next.centerId }));
    } else {
      this.servicesRepository.create(next);
    }
    return this.listServices(session).find((item) => item.id === next.id) || next;
  }

  deleteService(id, session) {
    if (!this.findByIdInCenter(this.servicesRepository, id, session)) return { success: false };
    return { success: this.servicesRepository.delete(id) };
  }

  listStaff(session) {
    this.seedDefaultStaffForCenter(this.getCenterId(session), this.getCenterName(session));
    return this.filterByCenter(this.staffRepository.list(), session).map((item) => ({
      id: item.id,
      name: item.name,
      colorTag: item.colorTag || null,
      hourlyCostCents: Number(item.hourlyCostCents || 0),
      role: item.role || "",
      shift: item.shift || "",
      targetProgress: Number(item.targetProgress || 0),
      active: Number(item.active === false ? 0 : item.active ?? 1),
      createdAt: item.createdAt || new Date().toISOString()
    }));
  }

  saveStaff(payload, session) {
    const next = this.attachCenter({
      id: payload.id || `st_${Date.now()}`,
      name: payload.name || "Operatore",
      colorTag: payload.colorTag || null,
      hourlyCostCents: Number(payload.hourlyCostCents || 0),
      role: payload.role || "",
      shift: payload.shift || "",
      targetProgress: Number(payload.targetProgress || 0),
      active: Number(payload.active ?? 1),
      createdAt: payload.createdAt || new Date().toISOString()
    }, session);
    if (payload.id) {
      const current = this.findByIdInCenter(this.staffRepository, payload.id, session);
      if (!current) throw new Error("Operatore non trovato");
      this.staffRepository.update(payload.id, (entry) => ({ ...entry, ...next, id: entry.id, centerId: entry.centerId || next.centerId }));
    } else {
      this.staffRepository.create(next);
    }
    return this.listStaff(session).find((item) => item.id === next.id) || next;
  }

  deleteStaff(id, session) {
    if (!this.findByIdInCenter(this.staffRepository, id, session)) return { success: false };
    return { success: this.staffRepository.delete(id) };
  }

  listResources(session) {
    return this.filterByCenter(this.resourcesRepository.list(), session).map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type || null,
      totalCostCents: Number(item.totalCostCents || 0),
      durationMonths: Number(item.durationMonths || 48),
      estimatedMonthlyUses: Number(item.estimatedMonthlyUses || 0),
      monthlyCostCents: Number(item.durationMonths || 0) > 0 ? Math.round(Number(item.totalCostCents || 0) / Number(item.durationMonths || 1)) : 0,
      costPerUseCents: Number(item.durationMonths || 0) > 0 && Number(item.estimatedMonthlyUses || 0) > 0 ? Math.round((Number(item.totalCostCents || 0) / Number(item.durationMonths || 1)) / Number(item.estimatedMonthlyUses || 1)) : 0,
      active: Number(item.active ?? 1),
      createdAt: item.createdAt || new Date().toISOString()
    }));
  }

  saveResource(payload, session) {
    const next = this.attachCenter({
      id: payload.id || `res_${Date.now()}`,
      name: payload.name || "Risorsa",
      type: payload.type || "cabina",
      totalCostCents: Number(payload.totalCostCents || 0),
      durationMonths: Number(payload.durationMonths || 48),
      estimatedMonthlyUses: Number(payload.estimatedMonthlyUses || 0),
      active: Number(payload.active ?? 1),
      createdAt: payload.createdAt || new Date().toISOString()
    }, session);
    if (payload.id) {
      const current = this.findByIdInCenter(this.resourcesRepository, payload.id, session);
      if (!current) throw new Error("Risorsa non trovata");
      this.resourcesRepository.update(payload.id, (entry) => ({ ...entry, ...next, id: entry.id, centerId: entry.centerId || next.centerId }));
    } else {
      this.resourcesRepository.create(next);
    }
    return this.listResources(session).find((item) => item.id === next.id) || next;
  }

  deleteResource(id, session) {
    if (!this.findByIdInCenter(this.resourcesRepository, id, session)) return { success: false };
    return { success: this.resourcesRepository.delete(id) };
  }

  listInventoryItems(session) {
    return this.filterByCenter(this.inventoryRepository.list(), session)
      .map((item) => ({
        id: item.id,
        name: item.name || "Articolo",
        category: item.category || "",
        supplier: item.supplier || "",
        sku: item.sku || "",
        usageType: item.usageType || "cabina",
        unit: item.unit || "pz",
        stockQuantity: Number(item.stockQuantity ?? item.stock ?? 0),
        thresholdQuantity: Number(item.thresholdQuantity ?? item.threshold ?? 0),
        costCents: Number(item.costCents ?? 0),
        purchaseCostCents: Number(item.purchaseCostCents ?? item.costCents ?? 0),
        estimatedTotalUses: Number(item.estimatedTotalUses ?? 0),
        costPerUseCents: Number(item.estimatedTotalUses || 0) > 0 ? Math.round(Number(item.purchaseCostCents ?? item.costCents ?? 0) / Number(item.estimatedTotalUses || 1)) : 0,
        retailPriceCents: Number(item.retailPriceCents ?? 0),
        active: Number(item.active ?? 1),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
      }))
      .filter((item) => item.active === 1)
      .sort((a, b) => {
        const aCritical = a.stockQuantity <= 0 ? 0 : a.stockQuantity <= a.thresholdQuantity ? 1 : 2;
        const bCritical = b.stockQuantity <= 0 ? 0 : b.stockQuantity <= b.thresholdQuantity ? 1 : 2;
        return aCritical - bCritical || a.name.localeCompare(b.name);
      });
  }

  saveInventoryItem(payload, session) {
    const next = this.attachCenter({
      id: payload.id || `inv_${Date.now()}`,
      name: payload.name || "Articolo",
      category: payload.category || "",
      supplier: payload.supplier || "",
      sku: payload.sku || "",
      usageType: payload.usageType || "cabina",
      unit: payload.unit || "pz",
      stockQuantity: Number(payload.stockQuantity ?? payload.stock ?? 0),
      thresholdQuantity: Number(payload.thresholdQuantity ?? payload.threshold ?? 0),
      costCents: Number(payload.costCents ?? 0),
      purchaseCostCents: Number(payload.purchaseCostCents ?? payload.costCents ?? 0),
      estimatedTotalUses: Number(payload.estimatedTotalUses ?? 0),
      retailPriceCents: Number(payload.retailPriceCents ?? 0),
      active: Number(payload.active ?? 1),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, session);
    if (payload.id) {
      const current = this.findByIdInCenter(this.inventoryRepository, payload.id, session);
      if (!current) throw new Error("Articolo di magazzino non trovato");
      this.inventoryRepository.update(payload.id, (entry) => ({ ...entry, ...next, id: entry.id, centerId: entry.centerId || next.centerId, createdAt: entry.createdAt }));
    } else {
      this.inventoryRepository.create(next);
    }
    return this.listInventoryItems(session).find((item) => item.id === next.id) || next;
  }

  deleteInventoryItem(id, session) {
    if (!this.findByIdInCenter(this.inventoryRepository, id, session)) return { success: false };
    return { success: this.inventoryRepository.delete(id) };
  }

  listInventoryMovements(itemId = "", session) {
    return this.filterByCenter(this.inventoryMovementsRepository.list(), session)
      .filter((item) => !itemId || item.itemId === itemId)
      .map((item) => ({
        id: item.id,
        itemId: item.itemId,
        type: item.type,
        quantity: Number(item.quantity || 0),
        note: item.note || "",
        operatorName: item.operatorName || "",
        createdAt: item.createdAt || new Date().toISOString()
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  createInventoryMovement(payload, session) {
    const item = this.findByIdInCenter(this.inventoryRepository, payload.itemId, session);
    if (!item) {
      throw new Error("Articolo di magazzino non trovato");
    }
    const quantity = Number(payload.quantity || 0);
    const delta = payload.type === "load" || payload.type === "return"
      ? quantity
      : payload.type === "adjustment"
        ? quantity - Number(item.stockQuantity ?? item.stock ?? 0)
        : -quantity;
    const nextStock = Math.max(0, Number(item.stockQuantity ?? item.stock ?? 0) + delta);
    this.inventoryRepository.update(item.id, (current) => ({
      ...current,
      stockQuantity: nextStock,
      updatedAt: new Date().toISOString()
    }));
    const movement = this.attachCenter({
      id: `mov_${Date.now()}`,
      itemId: item.id,
      type: payload.type || "load",
      quantity,
      note: payload.note || "",
      operatorName: payload.operatorName || "",
      createdAt: new Date().toISOString()
    }, session);
    this.inventoryMovementsRepository.create(movement);
    return {
      movement,
      item: this.listInventoryItems(session).find((entry) => entry.id === item.id)
    };
  }

  getInventoryOverview(session) {
    const items = this.listInventoryItems(session);
    const movements = this.listInventoryMovements("", session);
    const lowStockItems = items.filter((item) => item.stockQuantity <= item.thresholdQuantity);
    const criticalItems = items.filter((item) => item.stockQuantity <= 0);
    return {
      summary: {
        itemsCount: items.length,
        lowStockCount: lowStockItems.length,
        criticalCount: criticalItems.length,
        stockValueCents: items.reduce((sum, item) => sum + Math.round(item.stockQuantity * item.costCents), 0),
        retailValueCents: items.reduce((sum, item) => sum + Math.round(item.stockQuantity * item.retailPriceCents), 0)
      },
      lowStockItems: lowStockItems.slice(0, 10),
      recentMovements: movements.slice(0, 12)
    };
  }

  listTreatments(clientId, session) {
    return this.filterByCenter(this.treatmentsRepository.list(), session)
      .filter((item) => !clientId || item.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => ({
        id: item.id,
        clientId: item.clientId,
        appointmentId: item.appointmentId || null,
        serviceId: item.serviceId || null,
        operatorName: item.operatorName || "",
        productsUsed: item.productsUsed || "",
        technologyUsed: item.technologyUsed || "",
        protocolUsed: item.protocolUsed || "",
        resultNotes: item.resultNotes || "",
        photoPath: item.photoPath || "",
        createdAt: item.createdAt || new Date().toISOString()
      }));
  }

  createTreatment(payload, session) {
    const item = this.attachCenter({
      id: `trt_${Date.now()}`,
      clientId: payload.clientId,
      appointmentId: payload.appointmentId || null,
      serviceId: payload.serviceId || null,
      operatorName: payload.operatorName || "",
      productsUsed: payload.productsUsed || "",
      technologyUsed: payload.technologyUsed || "",
      protocolUsed: payload.protocolUsed || "",
      resultNotes: payload.resultNotes || "",
      photoPath: payload.photoPath || "",
      createdAt: new Date().toISOString()
    }, session);
    this.treatmentsRepository.create(item);
    return item;
  }

  listPayments(clientId, session) {
    return this.filterByCenter(this.paymentsRepository.list(), session)
      .filter((item) => !clientId || item.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => ({
        id: item.id,
        clientId: item.clientId,
        appointmentId: item.appointmentId || null,
        amountCents: Number(item.amountCents || 0),
        method: item.method || "card",
        description: item.description || "",
        createdAt: item.createdAt || new Date().toISOString()
      }));
  }

  createPayment(payload, session) {
    const item = this.attachCenter({
      id: `pay_${Date.now()}`,
      clientId: payload.clientId,
      appointmentId: payload.appointmentId || null,
      amountCents: Number(payload.amountCents || 0),
      method: payload.method || "card",
      description: payload.description || "",
      createdAt: new Date().toISOString()
    }, session);
    this.paymentsRepository.create(item);
    if (item.appointmentId) {
      this.appointmentsRepository.update(item.appointmentId, (current) => ({
        ...current,
        locked: 1,
        status: current.status === "cancelled" || current.status === "no_show" ? current.status : "completed",
        updatedAt: new Date().toISOString()
      }));
      this.captureProfitabilityFromPayment(item, session);
    }
    return item;
  }

  captureProfitabilityFromPayment(payment, session) {
    const settings = this.getSettings(session);
    if (!settings.profitabilityEnabled || !payment.appointmentId) return [];
    const existing = this.filterByCenter(this.profitabilityExecutionsRepository.list(), session).filter((item) => item.appointmentId === payment.appointmentId);
    if (existing.length > 0) return existing;
    const appointment = this.filterByCenter(this.appointmentsRepository.list(), session).find((item) => item.id === payment.appointmentId);
    if (!appointment) return [];
    const services = this.listServices(session);
    const inventoryItems = this.listInventoryItems(session);
    const staff = this.listStaff(session);
    const resources = this.listResources(session);
    const serviceIds = Array.isArray(appointment.serviceIds) && appointment.serviceIds.length ? appointment.serviceIds : appointment.serviceId ? [appointment.serviceId] : [];
    const serviceRows = serviceIds.map((serviceId) => services.find((item) => item.id === serviceId)).filter(Boolean);
    if (!serviceRows.length) return [];
    const totalListPrice = serviceRows.reduce((sum, item) => sum + Number(item.priceCents || 0), 0);
    const operator = staff.find((item) => item.id === appointment.staffId);
    let allocatedSoFar = 0;
    return serviceRows.map((service, index) => {
      const shareAmount = totalListPrice > 0 ? Math.round(Number(payment.amountCents || 0) * (Number(service.priceCents || 0) / totalListPrice)) : Math.round(Number(payment.amountCents || 0) / serviceRows.length);
      const priceChargedCents = index === serviceRows.length - 1 ? Number(payment.amountCents || 0) - allocatedSoFar : shareAmount;
      allocatedSoFar += shareAmount;
      const productCostTotalCents = (service.productLinks || []).reduce((sum, link) => {
        const product = inventoryItems.find((item) => item.id === link.productId);
        return sum + Math.round(Number(product?.costPerUseCents || 0) * Number(link.usageUnits || 1));
      }, 0);
      const technologyCostTotalCents = settings.profitabilityTechnologyAnalysisEnabled ? (service.technologyLinks || []).reduce((sum, link) => {
        const technology = resources.find((item) => item.id === link.technologyId);
        return sum + Math.round(Number(technology?.costPerUseCents || 0) * Number(link.usageUnits || 1));
      }, 0) : 0;
      const operatorCostTotalCents = settings.profitabilityOperatorCostEnabled && operator?.hourlyCostCents
        ? Math.round((Number(service.durationMin || 0) / 60) * Number(operator.hourlyCostCents || 0))
        : 0;
      const totalCostCents = productCostTotalCents + technologyCostTotalCents + operatorCostTotalCents;
      const execution = this.attachCenter({
        id: `exec_${Date.now()}_${index}`,
        appointmentId: appointment.id,
        paymentId: payment.id,
        serviceId: service.id,
        operatorId: appointment.staffId || null,
        date: toDateOnly(payment.createdAt || appointment.startAt),
        priceChargedCents,
        durationMinutes: Number(service.durationMin || 0),
        productCostTotalCents,
        technologyCostTotalCents,
        operatorCostTotalCents,
        totalCostCents,
        profitCents: priceChargedCents - totalCostCents,
        createdAt: new Date().toISOString()
      }, session);
      this.profitabilityExecutionsRepository.create(execution);
      return execution;
    });
  }

  getProfitabilityOverview(options = {}, session) {
    const settings = this.getSettings(session);
    const services = this.listServices(session);
    const inventoryItems = this.listInventoryItems(session);
    const technologies = this.listResources(session).filter((item) => item.type === "tecnologia" || item.type === "macchinario");
    const { start, end } = resolveReportRange({ period: "month", ...options });
    const executions = this.filterByCenter(this.profitabilityExecutionsRepository.list(), session).filter((item) => {
      const date = String(item.date || toDateOnly(item.createdAt || new Date().toISOString()));
      return date >= start && date <= end;
    });
    const serviceMap = new Map(services.map((item) => [item.id, item]));
    const productMap = new Map(inventoryItems.map((item) => [item.id, item]));
    const technologyMap = new Map(technologies.map((item) => [item.id, item]));
    const serviceAcc = new Map();
    const productAcc = new Map();
    const technologyAcc = new Map();

    for (const execution of executions) {
      const currentService = serviceAcc.get(execution.serviceId) || { revenueCents: 0, costCents: 0, profitCents: 0, executions: 0 };
      currentService.revenueCents += Number(execution.priceChargedCents || 0);
      currentService.costCents += Number(execution.totalCostCents || 0);
      currentService.profitCents += Number(execution.profitCents || 0);
      currentService.executions += 1;
      serviceAcc.set(execution.serviceId, currentService);
      const service = serviceMap.get(execution.serviceId);
      (service?.productLinks || []).forEach((link) => {
        const current = productAcc.get(link.productId) || { revenueCents: 0, costConsumedCents: 0, totalUses: 0 };
        const product = productMap.get(link.productId);
        current.revenueCents += Number(execution.priceChargedCents || 0);
        current.costConsumedCents += Math.round(Number(product?.costPerUseCents || 0) * Number(link.usageUnits || 1));
        current.totalUses += Number(link.usageUnits || 1);
        productAcc.set(link.productId, current);
      });
      if (settings.profitabilityTechnologyAnalysisEnabled) {
        (service?.technologyLinks || []).forEach((link) => {
          const current = technologyAcc.get(link.technologyId) || { revenueCents: 0, costCents: 0, totalUses: 0 };
          const technology = technologyMap.get(link.technologyId);
          current.revenueCents += Number(execution.priceChargedCents || 0);
          current.costCents += Math.round(Number(technology?.costPerUseCents || 0) * Number(link.usageUnits || 1));
          current.totalUses += Number(link.usageUnits || 1);
          technologyAcc.set(link.technologyId, current);
        });
      }
    }

    const statusFrom = (profitCents, revenueCents) => {
      if (profitCents < 0) return "LOSS";
      const margin = revenueCents > 0 ? Math.round((profitCents / revenueCents) * 100) : 0;
      return margin < 15 ? "LOW_MARGIN" : "PROFIT";
    };

    const servicesRows = services.map((service) => {
      const row = serviceAcc.get(service.id) || { revenueCents: 0, costCents: 0, profitCents: 0, executions: 0 };
      return { id: service.id, name: service.name, revenueCents: row.revenueCents, costCents: row.costCents, profitCents: row.profitCents, marginPercent: row.revenueCents > 0 ? Math.round((row.profitCents / row.revenueCents) * 100) : 0, status: statusFrom(row.profitCents, row.revenueCents), executions: row.executions };
    }).sort((a, b) => b.profitCents - a.profitCents);
    const productsRows = inventoryItems.map((item) => {
      const row = productAcc.get(item.id) || { revenueCents: 0, costConsumedCents: 0, totalUses: 0 };
      const profitCents = row.revenueCents - row.costConsumedCents;
      return { id: item.id, name: item.name, revenueCents: row.revenueCents, costCents: row.costConsumedCents, profitCents, marginPercent: row.revenueCents > 0 ? Math.round((profitCents / row.revenueCents) * 100) : 0, status: statusFrom(profitCents, row.revenueCents), totalUses: row.totalUses, costConsumedCents: row.costConsumedCents };
    }).sort((a, b) => b.profitCents - a.profitCents);
    const technologiesRows = technologies.map((item) => {
      const row = technologyAcc.get(item.id) || { revenueCents: 0, costCents: 0, totalUses: 0 };
      const profitCents = row.revenueCents - row.costCents;
      return { id: item.id, name: item.name, revenueCents: row.revenueCents, costCents: row.costCents, profitCents, marginPercent: row.revenueCents > 0 ? Math.round((profitCents / row.revenueCents) * 100) : 0, status: row.revenueCents < Number(item.monthlyCostCents || 0) && Number(item.monthlyCostCents || 0) > 0 ? "LOSS" : statusFrom(profitCents, row.revenueCents), monthlyCostCents: Number(item.monthlyCostCents || 0), totalUses: row.totalUses };
    }).sort((a, b) => b.profitCents - a.profitCents);
    const totals = executions.reduce((sum, item) => ({ executions: sum.executions + 1, revenueCents: sum.revenueCents + Number(item.priceChargedCents || 0), costCents: sum.costCents + Number(item.totalCostCents || 0), profitCents: sum.profitCents + Number(item.profitCents || 0) }), { executions: 0, revenueCents: 0, costCents: 0, profitCents: 0 });
    const alerts = [
      ...servicesRows.filter((item) => item.status !== "PROFIT" && item.revenueCents > 0).slice(0, 3).map((item) => ({ level: item.status === "LOSS" ? "critical" : "warning", area: "services", title: `${item.name} sotto controllo`, body: item.status === "LOSS" ? "Il servizio sta generando una perdita sui costi configurati." : "Il margine è basso: valuta prezzo, prodotti o durata." })),
      ...technologiesRows.filter((item) => item.monthlyCostCents > 0 && item.revenueCents < item.monthlyCostCents).slice(0, 2).map((item) => ({ level: "warning", area: "technologies", title: `${item.name} non copre il costo mensile`, body: "Il ricavo generato non raggiunge ancora il costo medio mensile configurato." }))
    ];
    return { totals, services: servicesRows, products: productsRows, technologies: technologiesRows, alerts };
  }

  ensureDefaultOperatorIncentiveRules(session) {
    const centerId = this.getCenterId(session);
    const existing = this.filterByCenter(this.operatorIncentiveRulesRepository.list(), session);
    if (existing.length > 0) {
      return existing;
    }
    const defaults = [
      {
        id: `${centerId}_rule_sales`,
        active: true,
        operator_id: null,
        type: "sales",
        target_value: 110,
        comparison_type: "gte",
        reward_type: "benefit",
        reward_value: 0,
        benefit_label: "Bonus vendita premium",
        period_type: "mese",
        notes: "Ticket medio operatore sopra il 110% della media centro",
        centerId
      },
      {
        id: `${centerId}_rule_retention`,
        active: true,
        operator_id: null,
        type: "retention",
        target_value: 60,
        comparison_type: "gte",
        reward_type: "benefit",
        reward_value: 0,
        benefit_label: "Benefit retention",
        period_type: "mese",
        notes: "Retention clienti almeno al 60%",
        centerId
      },
      {
        id: `${centerId}_rule_performance`,
        active: true,
        operator_id: null,
        type: "custom",
        target_value: 10,
        comparison_type: "gte",
        reward_type: "benefit",
        reward_value: 0,
        benefit_label: "Benefit performance",
        period_type: "mese",
        notes: "Crescita fatturato almeno del 10% sul periodo precedente",
        centerId
      },
      {
        id: `${centerId}_rule_service_push`,
        active: true,
        operator_id: null,
        type: "service_push",
        target_value: 5,
        comparison_type: "gte",
        reward_type: "benefit",
        reward_value: 0,
        benefit_label: "Benefit servizi premium",
        period_type: "mese",
        notes: "Almeno 5 servizi premium nel periodo",
        centerId
      }
    ];
    defaults.forEach((item) => this.operatorIncentiveRulesRepository.create(item));
    return defaults;
  }

  getOperatorReport(operatorId, options = {}, session) {
    const settings = this.getSettings(session);
    const operator = this.findByIdInCenter(this.staffRepository, operatorId, session);
    if (!operator) {
      throw new Error("Operatore non trovato");
    }

    const range = resolveReportRange(options);
    const previousSpan = daysBetweenInclusive(range.start, range.end);
    const previousRange = {
      start: shiftDate(range.start, -previousSpan),
      end: shiftDate(range.start, -1)
    };

    const allAppointments = this.listAppointments("month", new Date().toISOString(), true, session);
    const payments = this.listPayments(undefined, session);
    const services = this.listServices(session);
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const paymentByAppointment = new Map();
    payments.forEach((payment) => {
      const current = paymentByAppointment.get(payment.appointmentId) || 0;
      paymentByAppointment.set(payment.appointmentId, current + Number(payment.amountCents || 0));
    });
    const serviceById = new Map(services.map((item) => [item.id, item]));
    const premiumThreshold = services.length ? services.reduce((sum, item) => sum + Number(item.priceCents || 0), 0) / services.length : 0;
    const clientAppointmentsMap = new Map();
    allAppointments.filter((item) => item.status === "completed").forEach((item) => {
      const list = clientAppointmentsMap.get(item.clientId) || [];
      list.push(item);
      clientAppointmentsMap.set(item.clientId, list);
    });

    const filterOperatorPeriod = (start, end) => allAppointments.filter((item) => {
      const date = toDateOnly(item.startAt);
      return item.staffId === operatorId && item.status === "completed" && date >= start && date <= end;
    });
    const currentAppointments = filterOperatorPeriod(range.start, range.end);
    const previousAppointments = filterOperatorPeriod(previousRange.start, previousRange.end);
    const centerAppointmentsCurrent = allAppointments.filter((item) => {
      const date = toDateOnly(item.startAt);
      return item.status === "completed" && date >= range.start && date <= range.end;
    });

    const revenueFor = (appointmentsList) => appointmentsList.reduce((sum, item) => sum + Number(paymentByAppointment.get(item.id) || 0), 0);
    const currentRevenueCents = revenueFor(currentAppointments);
    const previousRevenueCents = revenueFor(previousAppointments);
    const completedAppointments = currentAppointments.length;
    const uniqueClientIds = [...new Set(currentAppointments.map((item) => item.clientId).filter(Boolean))];
    const averageTicketCents = completedAppointments ? Math.round(currentRevenueCents / completedAppointments) : 0;
    const centerRevenueCents = revenueFor(centerAppointmentsCurrent);
    const centerAverageTicketCents = centerAppointmentsCurrent.length ? Math.round(centerRevenueCents / centerAppointmentsCurrent.length) : 0;
    const uniqueClients = uniqueClientIds.length;

    const newClients = uniqueClientIds.filter((clientId) => {
      const history = (clientAppointmentsMap.get(clientId) || []).slice().sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      return history[0] && toDateOnly(history[0].startAt) >= range.start && toDateOnly(history[0].startAt) <= range.end;
    }).length;
    const returningClients = uniqueClients - newClients;
    const previousOperatorClientIds = new Set(allAppointments.filter((item) => item.staffId === operatorId && item.status === "completed" && toDateOnly(item.startAt) < range.start).map((item) => item.clientId));
    const inactiveClients = [...previousOperatorClientIds].filter((clientId) => {
      if (uniqueClientIds.includes(clientId)) return false;
      const history = (clientAppointmentsMap.get(clientId) || []).slice().sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
      const lastVisit = history[0];
      return lastVisit ? Math.floor((new Date(`${range.end}T23:59:59`).getTime() - new Date(lastVisit.startAt).getTime()) / 86400000) >= 30 : false;
    }).length;
    const retentionRate = uniqueClients ? Math.round((returningClients / uniqueClients) * 100) : 0;

    const serviceCounts = new Map();
    currentAppointments.forEach((item) => {
      const ids = Array.isArray(item.serviceIds) && item.serviceIds.length > 0 ? item.serviceIds : item.serviceId ? [item.serviceId] : [];
      ids.forEach((serviceId) => {
        serviceCounts.set(serviceId, (serviceCounts.get(serviceId) || 0) + 1);
      });
    });
    const topServices = [...serviceCounts.entries()]
      .map(([serviceId, count]) => ({ serviceId, name: serviceById.get(serviceId)?.name || "Servizio", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const lowServices = services
      .map((item) => ({ serviceId: item.id, name: item.name, count: Number(serviceCounts.get(item.id) || 0) }))
      .sort((a, b) => a.count - b.count)
      .slice(0, 3);
    const premiumServices = services
      .filter((item) => Number(item.priceCents || 0) >= premiumThreshold)
      .map((item) => ({ serviceId: item.id, name: item.name, count: Number(serviceCounts.get(item.id) || 0) }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const premiumCount = premiumServices.reduce((sum, item) => sum + item.count, 0);

    const daysWorked = [...new Set(currentAppointments.map((item) => toDateOnly(item.startAt)))].length;
    const averageAppointmentsPerDay = daysWorked ? Number((completedAppointments / daysWorked).toFixed(1)) : 0;
    const timeBands = new Map([["Mattina", 0], ["Pranzo", 0], ["Pomeriggio", 0], ["Sera", 0]]);
    currentAppointments.forEach((item) => {
      const band = timeBandFromDate(item.startAt);
      timeBands.set(band, Number(timeBands.get(band) || 0) + 1);
    });
    const sortedBands = [...timeBands.entries()].sort((a, b) => b[1] - a[1]);
    const topTimeBand = sortedBands[0]?.[0] || "—";
    const lowTimeBand = [...timeBands.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] || "—";

    let deltaRevenuePercent = null;
    let trendState = "unknown";
    let trendNote = "Nessun confronto disponibile";
    if (settings.operatorComparisonEnabled && previousRevenueCents > 0) {
      deltaRevenuePercent = Math.round(((currentRevenueCents - previousRevenueCents) / previousRevenueCents) * 100);
      if (deltaRevenuePercent > 10) trendState = "growth";
      else if (deltaRevenuePercent < -10) trendState = "decline";
      else trendState = "stable";
      trendNote = `${deltaRevenuePercent > 0 ? "+" : ""}${deltaRevenuePercent}% rispetto al periodo precedente`;
    }

    let salesState = "average";
    if (centerAverageTicketCents > 0) {
      const deltaVsCenter = ((averageTicketCents - centerAverageTicketCents) / centerAverageTicketCents) * 100;
      if (deltaVsCenter > 10) salesState = "above";
      else if (deltaVsCenter < -10) salesState = "below";
    }

    const rules = this.ensureDefaultOperatorIncentiveRules(session).filter((rule) => rule.active && (!rule.operator_id || rule.operator_id === operatorId));
    const rewardsEnabled = settings.operatorRewardsEnabled;
    const incentiveResults = [];
    if (rewardsEnabled) {
      rules.forEach((rule) => {
        if ((rule.type === "sales" && !settings.operatorSalesBonusEnabled) || (rule.type === "retention" && !settings.operatorRetentionBonusEnabled) || (rule.type === "custom" && !settings.operatorPerformanceBonusEnabled)) {
          return;
        }
        const progressValue = rule.type === "sales"
          ? (centerAverageTicketCents ? Math.round((averageTicketCents / centerAverageTicketCents) * 100) : 0)
          : rule.type === "retention"
            ? retentionRate
            : rule.type === "service_push"
              ? premiumCount
              : Number(deltaRevenuePercent || 0);
        const achieved = rule.comparison_type === "gte"
          ? progressValue >= Number(rule.target_value || 0)
          : rule.comparison_type === "lte"
            ? progressValue <= Number(rule.target_value || 0)
            : progressValue === Number(rule.target_value || 0);
        const near = !achieved && Number(rule.target_value || 0) > 0 && progressValue >= Number(rule.target_value || 0) * 0.8;
        const status = achieved ? "reached" : near ? "near" : "missed";
        const resultId = `${this.getCenterId(session)}_${operatorId}_${rule.id}_${range.start}_${range.end}`;
        const resultPayload = this.attachCenter({
          id: resultId,
          operator_id: operatorId,
          rule_id: rule.id,
          period_start: range.start,
          period_end: range.end,
          achieved,
          progress_value: progressValue,
          reward_calculated: rule.reward_type === "fixed" || rule.reward_type === "percentage" ? Number(rule.reward_value || 0) : null,
          benefit_awarded: achieved && settings.operatorBenefitsEnabled ? (rule.benefit_label || null) : null,
          status,
          updatedAt: new Date().toISOString()
        }, session);
        const current = this.findByIdInCenter(this.operatorIncentiveResultsRepository, resultId, session);
        if (current) {
          this.operatorIncentiveResultsRepository.update(resultId, (entry) => ({ ...entry, ...resultPayload }));
        } else {
          this.operatorIncentiveResultsRepository.create(resultPayload);
        }
        incentiveResults.push({
          id: resultId,
          title: rule.type === "sales" ? "Ticket medio target" : rule.type === "retention" ? "Retention target" : rule.type === "service_push" ? "Servizi premium target" : "Crescita target",
          progressLabel: `${progressValue}${rule.type === "sales" || rule.type === "retention" || rule.type === "custom" ? "%" : ""} su target ${rule.target_value}${rule.type === "sales" || rule.type === "retention" || rule.type === "custom" ? "%" : ""}`,
          rewardLabel: settings.operatorBenefitsEnabled ? (rule.benefit_label || "Benefit disponibile") : "Benefit disattivato",
          status
        });
      });
    }

    let summaryText = "Operatore stabile, dati sotto controllo.";
    const reachedCount = incentiveResults.filter((item) => item.status === "reached").length;
    if (trendState === "growth" && salesState === "above" && reachedCount > 0) {
      summaryText = "Operatore molto performante, crescita attiva, ticket sopra media e premio maturato.";
    } else if (trendState === "growth") {
      summaryText = premiumCount > 0
        ? "Operatore in crescita, buon ticket medio, può spingere servizi premium."
        : "Operatore in crescita, buona continuità operativa nel periodo.";
    } else if (trendState === "decline" || salesState === "below") {
      summaryText = "Operatore in calo, ticket basso e pochi servizi premium: suggerita formazione vendita.";
    } else if (retentionRate >= 60) {
      summaryText = "Operatore stabile, buona retention, nessun segnale critico nel periodo.";
    }

    return {
      operator: {
        id: operator.id,
        name: operator.name,
        colorTag: operator.colorTag || null
      },
      period,
      periodLabel: label,
      summary: {
        revenueCents: currentRevenueCents,
        completedAppointments,
        averageTicketCents,
        uniqueClients
      },
      trend: {
        state: trendState,
        deltaRevenuePercent,
        note: trendNote
      },
      clients: {
        total: uniqueClients,
        newClients,
        returningClients,
        inactiveClients,
        retentionRate
      },
      services: {
        top: topServices,
        low: lowServices,
        premium: premiumServices
      },
      activity: {
        daysWorked,
        averageAppointmentsPerDay,
        topTimeBand,
        lowTimeBand
      },
      sales: {
        operatorAverageTicketCents: averageTicketCents,
        centerAverageTicketCents,
        state: salesState
      },
      incentives: incentiveResults,
      summaryText
    };
  }

  getSettings(session) {
    const record = this.getCenterSettingsRecord(session);
    return { ...defaultSettings, ...record.settings, centerName: record.centerName || record.settings.centerName || this.getCenterName(session) };
  }

  saveSettings(payload, session) {
    const centerId = this.getCenterId(session);
    const current = this.getCenterSettingsRecord(session);
    const next = { ...defaultSettings, ...current.settings, ...payload, centerName: payload.centerName || current.centerName || this.getCenterName(session) };
    this.centerSettingsRepository.update(centerId, (record) => ({
      ...record,
      centerName: next.centerName,
      settings: next
    }));
    return next;
  }

  resetSettings(session) {
    const centerId = this.getCenterId(session);
    const next = { ...defaultSettings, centerName: this.getCenterName(session) };
    this.centerSettingsRepository.update(centerId, (record) => ({
      ...record,
      centerName: next.centerName,
      settings: next
    }));
    return next;
  }

  login({ username, password }) {
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const user = this.usersRepository.list().find((item) => String(item.username || "").trim().toLowerCase() === normalizedUsername);
    if (!user) throw new Error("Utente non trovato");
    if (user.active === false) throw new Error("Utente disattivato");
    if (!verifyPassword(password, user.passwordHash)) {
      throw new Error("Password non valida");
    }
    const token = crypto.randomBytes(24).toString("hex");
    const session = {
      username: user.username,
      role: user.role || "owner",
      centerId: user.centerId || DEFAULT_CENTER_ID,
      centerName: user.centerName || DEFAULT_CENTER_NAME,
      savedAt: new Date().toISOString()
    };
    this.sessions.set(token, session);
    return { success: true, token, username: session.username, role: session.role, centerId: session.centerId, centerName: session.centerName };
  }

  getSession(token) {
    if (!token || !this.sessions.has(token)) return null;
    return this.sessions.get(token);
  }

  logout(token) {
    if (token) this.sessions.delete(token);
    return { success: true };
  }

  listAccessUsers(session) {
    const currentCenterId = this.getCenterId(session);
    const currentRole = session?.role || "owner";
    return this.usersRepository
      .list()
      .filter((user) => currentRole === "superadmin" || this.isInCenter(user, currentCenterId))
      .map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role || "owner",
        active: user.active !== false,
        centerId: user.centerId || DEFAULT_CENTER_ID,
        centerName: user.centerName || DEFAULT_CENTER_NAME,
        createdAt: user.createdAt || null
      }))
      .sort((a, b) => a.centerName.localeCompare(b.centerName) || a.username.localeCompare(b.username));
  }

  createAccessUser(payload, session) {
    const currentRole = session?.role || "owner";
    if (currentRole !== "superadmin") {
      throw new Error("Permessi insufficienti");
    }
    const username = String(payload.username || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const centerName = String(payload.centerName || "").trim() || `Centro ${username}`;
    if (!username) throw new Error("Username obbligatorio");
    if (password.length < 8) throw new Error("Password troppo corta");
    const exists = this.usersRepository.list().some((user) => String(user.username || "").trim().toLowerCase() === username);
    if (exists) throw new Error("Username già presente");
    const centerId = crypto.randomUUID();
    this.ensureCenterSettings(centerId, centerName);
    this.seedDefaultStaffForCenter(centerId, centerName);
    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash: hashPassword(password),
      role: payload.role || "owner",
      active: true,
      centerId,
      centerName,
      createdAt: new Date().toISOString()
    };
    this.usersRepository.create(user);
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      active: user.active,
      centerId: user.centerId,
      centerName: user.centerName,
      createdAt: user.createdAt
    };
  }

  getDashboardStats(options = {}, session) {
    const range = resolveDashboardRange(options);
    const appointments = this.listAppointments(range.period, range.end, true, session);
    const payments = this.listPayments(undefined, session);
    const services = this.listServices(session);
    const servicesById = new Map(services.map((service) => [service.id, service]));
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const referenceTimestamp = new Date(`${range.end}T23:59:59`).getTime();
    const periodAppointments = appointments.filter((item) => {
      const itemDate = toDateOnly(item.startAt);
      return itemDate >= range.start && itemDate <= range.end;
    });
    const historicalAppointments = this.listAppointments("month", range.end, true, session)
      .filter((item) => toDateOnly(item.startAt) <= range.end);
    const completedAppointments = periodAppointments.filter((item) => item.status === "completed");
    const spendByClient = new Map();
    const visitsByClient = new Map();
    const lastVisitByClient = new Map();
    const servicePerformance = new Map();

    historicalAppointments
      .filter((item) => item.status === "completed")
      .forEach((item) => {
        const prev = lastVisitByClient.get(item.clientId);
        if (!prev || new Date(item.startAt).getTime() > new Date(prev).getTime()) {
          lastVisitByClient.set(item.clientId, item.startAt);
        }
      });

    completedAppointments.forEach((item) => {
      visitsByClient.set(item.clientId, (visitsByClient.get(item.clientId) || 0) + 1);
      const serviceIds = Array.isArray(item.serviceIds) && item.serviceIds.length > 0
        ? item.serviceIds
        : item.serviceId ? [item.serviceId] : [];
      const appointmentValue = serviceIds.reduce((sum, serviceId) => sum + Number(servicesById.get(serviceId)?.priceCents || 0), 0);
      spendByClient.set(item.clientId, (spendByClient.get(item.clientId) || 0) + appointmentValue);
      serviceIds.forEach((serviceId) => {
        const service = servicesById.get(serviceId);
        const current = servicePerformance.get(serviceId) || {
          serviceId,
          name: service?.name || "Servizio",
          appointments: 0,
          revenueCents: 0,
          colorTag: service?.colorTag || null
        };
        current.appointments += 1;
        current.revenueCents += Number(service?.priceCents || 0);
        servicePerformance.set(serviceId, current);
      });
    });

    const topClients = clients
      .map((client) => ({
        clientId: client.id,
        name: client.name || "Cliente",
        visits: visitsByClient.get(client.id) || 0,
        totalSpentCents: spendByClient.get(client.id) || 0
      }))
      .filter((client) => client.visits > 0 || client.totalSpentCents > 0)
      .sort((a, b) => b.totalSpentCents - a.totalSpentCents || b.visits - a.visits)
      .slice(0, 5);

    const profitableServices = [...servicePerformance.values()]
      .sort((a, b) => b.revenueCents - a.revenueCents || b.appointments - a.appointments)
      .slice(0, 5);

    const lowPerformingServices = [...servicePerformance.values()]
      .filter((service) => service.appointments > 0)
      .sort((a, b) => a.appointments - b.appointments || a.revenueCents - b.revenueCents)
      .slice(0, 5);

    const inactiveClients = clients
      .map((client) => {
        const lastVisitAt = lastVisitByClient.get(client.id) || client.lastVisit || null;
        const daysSinceLastVisit = lastVisitAt ? Math.max(0, Math.floor((referenceTimestamp - new Date(lastVisitAt).getTime()) / 86400000)) : -1;
        return {
          clientId: client.id,
          name: client.name || "Cliente",
          phone: client.phone || "",
          daysSinceLastVisit
        };
      })
      .filter((client) => client.daysSinceLastVisit >= 30)
      .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit)
      .slice(0, 5);

    const agendaLoad = periodAppointments.filter((item) => item.status !== "cancelled" && item.status !== "no_show").length;
    const alerts = [
      ...(inactiveClients.length > 0 ? [`Hai ${inactiveClients.length} clienti inattivi`] : []),
      ...(agendaLoad <= 3 ? ["Agenda leggera nel periodo selezionato"] : [])
    ];

    const nextAppointments = periodAppointments
      .filter((item) => item.status !== "cancelled" && item.status !== "no_show")
      .sort((first, second) => new Date(first.startAt).getTime() - new Date(second.startAt).getTime())
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        clientName: item.clientName,
        serviceName: item.serviceName,
        staffName: item.staffName,
        startAt: item.startAt,
        status: item.status,
        locked: item.locked || 0
      }));
    return {
      todayAppointments: periodAppointments.length,
      confirmedAppointments: periodAppointments.filter((item) => item.status === "confirmed").length,
      arrivedAppointments: periodAppointments.filter((item) => item.status === "arrived").length,
      inProgressAppointments: periodAppointments.filter((item) => item.status === "in_progress").length,
      readyCheckoutAppointments: periodAppointments.filter((item) => item.status === "ready_checkout").length,
      completedAppointments: periodAppointments.filter((item) => item.status === "completed").length,
      todayRevenueCents: payments
        .filter((item) => {
          const createdDate = toDateOnly(item.createdAt);
          return createdDate >= range.start && createdDate <= range.end;
        })
        .reduce((sum, item) => sum + item.amountCents, 0),
      activeClients: new Set(periodAppointments.map((item) => item.clientId).filter(Boolean)).size,
      upcomingAppointments: agendaLoad,
      activeStaff: new Set(periodAppointments.map((item) => item.staffId).filter(Boolean)).size,
      activeServices: new Set(
        periodAppointments.flatMap((item) => Array.isArray(item.serviceIds) && item.serviceIds.length > 0 ? item.serviceIds : item.serviceId ? [item.serviceId] : [])
      ).size,
      pendingConfirmations: periodAppointments.filter((item) => item.status === "requested" || item.status === "booked").length,
      inactiveClientsCount: inactiveClients.length,
      alerts,
      topClients,
      profitableServices,
      lowPerformingServices,
      inactiveClients,
      nextAppointments
    };
  }

  getOperationalReport(options = { period: "day" }, session) {
    const appointments = this.listAppointments("month", new Date().toISOString(), true, session);
    const payments = this.listPayments(undefined, session);
    const services = this.listServices(session);
    const staff = this.listStaff(session);
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const treatments = this.listTreatments(undefined, session);
    const resources = this.listResources(session);
    const { period, start, end, label } = resolveReportRange(options);
    const scopedAppointments = appointments.filter((item) => {
      const date = toDateOnly(item.startAt);
      return date >= start && date <= end;
    });
    const scopedPayments = payments.filter((item) => {
      const date = toDateOnly(item.createdAt);
      return date >= start && date <= end;
    });

    const spendByClient = new Map();
    const visitByClient = new Map();
    const lastVisitByClient = new Map();
    scopedAppointments.forEach((item) => {
      if (item.clientId) {
        spendByClient.set(item.clientId, (spendByClient.get(item.clientId) || 0) + scopedPayments.filter((payment) => payment.appointmentId === item.id).reduce((sum, payment) => sum + payment.amountCents, 0));
        visitByClient.set(item.clientId, (visitByClient.get(item.clientId) || 0) + 1);
        const prev = lastVisitByClient.get(item.clientId);
        if (!prev || new Date(item.startAt).getTime() > new Date(prev).getTime()) {
          lastVisitByClient.set(item.clientId, item.startAt);
        }
      }
    });

    const totals = {
      appointments: scopedAppointments.length,
      completedAppointments: scopedAppointments.filter((item) => item.status === "completed").length,
      cancelledAppointments: scopedAppointments.filter((item) => item.status === "cancelled").length,
      noShowAppointments: scopedAppointments.filter((item) => item.status === "no_show").length,
      revenueCents: scopedPayments.reduce((sum, item) => sum + item.amountCents, 0),
      averageTicketCents: scopedAppointments.filter((item) => item.status === "completed").length
        ? Math.round(scopedPayments.reduce((sum, item) => sum + item.amountCents, 0) / scopedAppointments.filter((item) => item.status === "completed").length)
        : 0,
      activeClients: clients.length,
      returningClients: clients.filter((item) => Number(item.totalValue || 0) >= 500).length,
      occasionalClients: clients.filter((item) => Number(item.totalValue || 0) < 500).length,
      rebookingRate: scopedAppointments.length ? Math.round((scopedAppointments.filter((item) => item.status === "confirmed" || item.status === "completed").length / scopedAppointments.length) * 100) : 0
    };

    const topOperators = staff.map((operator) => {
      const operatorAppointments = scopedAppointments.filter((item) => item.staffId === operator.id);
      const revenueCents = scopedPayments
        .filter((payment) => operatorAppointments.some((appointment) => appointment.id === payment.appointmentId))
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      return {
        staffId: operator.id,
        name: operator.name,
        appointments: operatorAppointments.length,
        completed: operatorAppointments.filter((item) => item.status === "completed").length,
        revenueCents,
        colorTag: operator.colorTag || null
      };
    }).sort((a, b) => b.revenueCents - a.revenueCents);

    const topServices = services.map((service) => {
      const serviceAppointments = scopedAppointments.filter((item) => item.serviceId === service.id || item.serviceIds?.includes?.(service.id));
      const revenueCents = scopedPayments
        .filter((payment) => serviceAppointments.some((appointment) => appointment.id === payment.appointmentId))
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      return {
        serviceId: service.id,
        name: service.name,
        appointments: serviceAppointments.length,
        revenueCents,
        colorTag: service.colorTag || null
      };
    }).sort((a, b) => b.appointments - a.appointments);

    const lowServices = services.map((service) => {
      const serviceAppointments = scopedAppointments.filter((item) => item.serviceId === service.id || item.serviceIds?.includes?.(service.id));
      const revenueCents = scopedPayments
        .filter((payment) => serviceAppointments.some((appointment) => appointment.id === payment.appointmentId))
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      return {
        serviceId: service.id,
        name: service.name,
        appointments: serviceAppointments.length,
        revenueCents,
        colorTag: service.colorTag || null
      };
    }).filter((item) => item.appointments > 0).sort((a, b) => a.appointments - b.appointments);

    const technologyMap = new Map();
    treatments.forEach((item) => {
      String(item.technologyUsed || "").split(/[,\n;/]+/).map((token) => token.trim()).filter(Boolean).forEach((name) => {
        technologyMap.set(name, (technologyMap.get(name) || 0) + 1);
      });
    });
    scopedAppointments.forEach((item) => {
      const resource = resources.find((resourceItem) => resourceItem.id === item.resourceId);
      if (resource && (resource.type === "tecnologia" || resource.type === "macchinario")) {
        technologyMap.set(resource.name, (technologyMap.get(resource.name) || 0) + 1);
      }
    });
    const technologyUsage = [...technologyMap.entries()].map(([name, uses]) => ({ name, uses })).sort((a, b) => b.uses - a.uses).slice(0, 5);
    const lowTechnologyUsage = [...technologyMap.entries()].map(([name, uses]) => ({ name, uses })).filter((item) => item.uses > 0).sort((a, b) => a.uses - b.uses).slice(0, 5);

    const paymentBreakdown = ["cash", "card", "mixed", "bank_transfer"].map((method) => ({
      method,
      amountCents: scopedPayments.filter((item) => item.method === method).reduce((sum, item) => sum + item.amountCents, 0),
      count: scopedPayments.filter((item) => item.method === method).length
    }));

    const topClientsBySpend = clients
      .map((client) => ({
        clientId: client.id,
        name: client.name || "Cliente",
        visits: visitByClient.get(client.id) || 0,
        amountCents: spendByClient.get(client.id) || 0
      }))
      .filter((item) => item.amountCents > 0)
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 5);

    const frequentClients = clients
      .map((client) => ({
        clientId: client.id,
        name: client.name || "Cliente",
        visits: visitByClient.get(client.id) || 0
      }))
      .filter((item) => item.visits > 0)
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5);

    const inactiveClients = clients
      .map((client) => {
        const lastVisitAt = lastVisitByClient.get(client.id) || client.lastVisit || null;
        const daysSinceLastVisit = lastVisitAt ? Math.max(0, Math.floor((Date.now() - new Date(lastVisitAt).getTime()) / 86400000)) : 999;
        return {
          clientId: client.id,
          name: client.name || "Cliente",
          phone: client.phone || "",
          daysSinceLastVisit,
          lastVisitAt
        };
      })
      .filter((item) => item.daysSinceLastVisit >= 30)
      .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit)
      .slice(0, 5);

    const timelineMap = new Map();
    const labelFormat = period === "day" ? "hour" : "date";
    scopedAppointments.forEach((item) => {
      const d = new Date(item.startAt);
      const label = labelFormat === "hour"
        ? `${String(d.getHours()).padStart(2, "0")}:00`
        : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      const current = timelineMap.get(label) || { label, appointments: 0, revenueCents: 0 };
      current.appointments += 1;
      current.revenueCents += scopedPayments.filter((payment) => payment.appointmentId === item.id).reduce((sum, payment) => sum + payment.amountCents, 0);
      timelineMap.set(label, current);
    });
    const timeline = [...timelineMap.values()].sort((a, b) => a.label.localeCompare(b.label));
    const insights = [
      `Servizio più richiesto: ${topServices[0]?.name || "Nessun dato"}`,
      `Cliente più attivo: ${frequentClients[0]?.name || "Nessun dato"}`,
      `Tecnologia meno utilizzata: ${lowTechnologyUsage[0]?.name || "Nessun dato"}`
    ];

    return {
      period,
      generatedAt: new Date().toISOString(),
      dateLabel: label,
      totals,
      timeline,
      topOperators,
      topServices,
      lowServices,
      clientSegments: [
        { label: "Attivi", value: totals.activeClients, note: "Clienti con scheda presente" },
        { label: "Ritorno", value: totals.returningClients, note: "Clienti con valore consolidato" },
        { label: "Occasionali", value: totals.occasionalClients, note: "Clienti ancora a bassa frequenza" }
      ],
      topClientsBySpend,
      frequentClients,
      inactiveClients,
      technologyUsage,
      lowTechnologyUsage,
      insights,
      paymentBreakdown
    };
  }

  exportOperationalReport(options = { period: "day" }, format = "pdf", session) {
    ensureDir(EXPORTS_DIR);
    const report = this.getOperationalReport(options, session);
    const period = typeof options === "string" ? options : String(options.period || "day");
    const fileName = `operational-report-${period}-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Report operativo</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#163047}h1,h2{color:#236eb8}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border:1px solid #dfe8f3;padding:10px;text-align:left}</style></head><body><h1>Report operativo</h1><p>${report.dateLabel}</p><h2>Totali</h2><table><tr><th>Appuntamenti</th><th>Completati</th><th>Incasso</th></tr><tr><td>${report.totals.appointments}</td><td>${report.totals.completedAppointments}</td><td>${euro(report.totals.revenueCents)}</td></tr></table></body></html>`;
    fs.writeFileSync(filePath, html);
    return {
      path: filePath,
      format,
      url: `/exports/${fileName}`
    };
  }

  exportOperatorReport(operatorId, options = {}, session) {
    ensureDir(EXPORTS_DIR);
    const report = this.getOperatorReport(operatorId, options, session);
    const fileName = `operator-report-${sanitizeFileName(report.operator?.name || "operatore")}-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = this.buildOperatorReportHtml(report);
    fs.writeFileSync(filePath, html);
    return {
      path: filePath,
      format: "html",
      url: `/exports/${fileName}`
    };
  }

  buildOperatorReportHtml(report) {
    const trendLabel = report?.trend?.state === "growth" ? "Crescita" : report?.trend?.state === "decline" ? "Calo" : report?.trend?.state === "stable" ? "Stabile" : "Nessun confronto";
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Report operatore</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:32px;color:#163047}h1{margin:0 0 8px;color:#1F86AA}h2{color:#2A9EC4;margin:24px 0 12px;font-size:18px}.meta{color:#6e8299;margin-bottom:18px}.summary{border:1px solid #dfe8f3;border-radius:18px;background:#f8fbff;padding:18px;margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.box{border:1px solid #e5edf5;border-radius:14px;padding:14px;background:#fff}.label{color:#6e8299;font-size:12px;text-transform:uppercase;letter-spacing:.04em}.value{font-size:22px;font-weight:700}.row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #edf3f8}.row:last-child{border-bottom:0}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:34px}.signature{padding-top:30px;border-top:1px solid #cfdbe6;color:#4d6470;font-size:13px}.printbar{margin-bottom:16px}@media print{.printbar{display:none}}</style></head><body><div class="printbar"><button onclick="window.print()" style="padding:10px 16px;border-radius:999px;border:1px solid #4FB6D6;background:#4FB6D6;color:#fff;font-weight:700;cursor:pointer;">Stampa report</button></div><h1>Report operatore</h1><div class="meta">${escapeHtml(report?.operator?.name || "Operatore")} · ${escapeHtml(report?.periodLabel || "")}</div><div class="summary"><div class="grid"><div class="box"><div class="label">Fatturato periodo</div><div class="value">${euro(report?.summary?.revenueCents || 0)}</div></div><div class="box"><div class="label">Appuntamenti completati</div><div class="value">${Number(report?.summary?.completedAppointments || 0)}</div></div><div class="box"><div class="label">Ticket medio</div><div class="value">${euro(report?.summary?.averageTicketCents || 0)}</div></div><div class="box"><div class="label">Clienti unici</div><div class="value">${Number(report?.summary?.uniqueClients || 0)}</div></div></div></div><h2>Andamento</h2><div class="box"><div class="row"><div>Stato</div><div>${trendLabel}</div></div><div class="row"><div>Confronto</div><div>${escapeHtml(report?.trend?.note || "Nessun confronto disponibile")}</div></div><div class="row"><div>Sintesi</div><div>${escapeHtml(report?.summaryText || "")}</div></div></div><h2>Clienti</h2><div class="box"><div class="row"><div>Totali serviti</div><div>${Number(report?.clients?.total || 0)}</div></div><div class="row"><div>Nuovi clienti</div><div>${Number(report?.clients?.newClients || 0)}</div></div><div class="row"><div>Clienti di ritorno</div><div>${Number(report?.clients?.returningClients || 0)}</div></div><div class="row"><div>Clienti inattivi</div><div>${Number(report?.clients?.inactiveClients || 0)}</div></div></div><h2>Servizi</h2><div class="box">${(report?.services?.top || []).map((item) => `<div class="row"><div>${escapeHtml(item.name)}</div><div>${Number(item.count || 0)}</div></div>`).join("") || "<div>Nessun dato</div>"}</div><h2>Attività reale</h2><div class="box"><div class="row"><div>Giorni lavorati</div><div>${Number(report?.activity?.daysWorked || 0)}</div></div><div class="row"><div>Media appuntamenti / giorno</div><div>${report?.activity?.averageAppointmentsPerDay || 0}</div></div><div class="row"><div>Fascia più attiva</div><div>${escapeHtml(report?.activity?.topTimeBand || "—")}</div></div><div class="row"><div>Fascia meno piena</div><div>${escapeHtml(report?.activity?.lowTimeBand || "—")}</div></div></div><h2>Premi & Benefit</h2><div class="box">${(report?.incentives || []).slice(0,4).map((item) => `<div class="row"><div>${escapeHtml(item.title)}<br><small>${escapeHtml(item.progressLabel)}</small></div><div>${item.status === "reached" ? "Raggiunto" : item.status === "near" ? "Quasi raggiunto" : "Non raggiunto"}</div></div>`).join("") || "<div>Nessuna regola premio attiva.</div>"}</div><div class="signatures"><div class="signature">Firma responsabile</div><div class="signature">Firma operatore</div></div></body></html>`;
  }

  openExportsFolder() {
    ensureDir(EXPORTS_DIR);
    const entries = fs.readdirSync(EXPORTS_DIR).sort().reverse();
    return {
      success: true,
      url: entries[0] ? `/exports/${entries[0]}` : null
    };
  }

  buildClientConsentDocumentHtml(detail, settings) {
    const formatDate = (value) => value ? new Date(value).toLocaleDateString("it-IT") : "________________";
    const yesNo = (value) => value ? "Si" : "No";
    const addressLine = [settings.centerAddress, settings.centerPostalCode, settings.centerCity, settings.centerProvince].filter(Boolean).join(", ");
    const sourceLabelMap = {
      in_sede: "In sede",
      telefonico: "Telefonico",
      online: "Online",
      importato: "Importato"
    };
    const consentSource = sourceLabelMap[String(detail.client.consentSource || "")] || "In sede";
    const fullName = `${detail.client.firstName || ""} ${detail.client.lastName || ""}`.trim() || "Cliente";
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Modulo privacy e consensi</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#163047;padding:34px}h1{margin:0 0 8px;color:#1F86AA;font-size:28px}h2{margin:22px 0 10px;color:#2A9EC4;font-size:17px}.meta{color:#6e8299;font-size:13px;margin-bottom:18px}.box{border:1px solid #dfe8f3;border-radius:14px;padding:16px;margin-bottom:14px;background:#f8fbff}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6e8299;margin-bottom:4px}.value{font-size:15px;font-weight:600;color:#163047}p{margin:0 0 10px;line-height:1.65}.small{font-size:12px;color:#6e8299}.consent-row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid #edf3f8}.consent-row:last-child{border-bottom:0}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:34px}.signature-box{padding-top:36px;border-top:1px solid #cfdbe6;color:#4d6470;font-size:13px}@media print{.printbar{display:none}}</style></head><body><div class="printbar" style="margin-bottom:16px;"><button onclick="window.print()" style="padding:10px 16px;border-radius:999px;border:1px solid #4FB6D6;background:#4FB6D6;color:#fff;font-weight:700;cursor:pointer;">Stampa documento</button></div><h1>Modulo privacy e consensi</h1><div class="meta">Documento precompilato da SkinHarmony Smart Desk · generato il ${new Date().toLocaleString("it-IT")}</div><h2>Dati centro</h2><div class="box"><div class="grid"><div><div class="label">Nome centro</div><div class="value">${escapeHtml(settings.centerName)}</div></div><div><div class="label">Ragione sociale</div><div class="value">${escapeHtml(settings.centerLegalName)}</div></div><div><div class="label">Email</div><div class="value">${escapeHtml(settings.centerEmail)}</div></div><div><div class="label">Telefono</div><div class="value">${escapeHtml(settings.centerPhone)}</div></div></div>${addressLine ? `<p class="small" style="margin-top:12px;">Indirizzo: ${escapeHtml(addressLine)}</p>` : ""}${settings.centerVatNumber ? `<p class="small">P. IVA: ${escapeHtml(settings.centerVatNumber)}</p>` : ""}${settings.centerTaxCode ? `<p class="small">Codice fiscale: ${escapeHtml(settings.centerTaxCode)}</p>` : ""}</div><h2>Dati cliente</h2><div class="box"><div class="grid"><div><div class="label">Cliente</div><div class="value">${escapeHtml(fullName)}</div></div><div><div class="label">Telefono</div><div class="value">${escapeHtml(detail.client.phone || "—")}</div></div><div><div class="label">Email</div><div class="value">${escapeHtml(detail.client.email || "—")}</div></div><div><div class="label">Data di nascita</div><div class="value">${detail.client.birthDate ? new Date(detail.client.birthDate).toLocaleDateString("it-IT") : "—"}</div></div></div></div><h2>Informativa e consensi</h2><div class="box"><p>Il cliente dichiara di aver preso visione dell'informativa privacy del centro e di esprimere i consensi qui riportati in modo libero e specifico.</p><div class="consent-row"><div><div class="value">Presa visione privacy</div><div class="small">Data registrata: ${formatDate(detail.client.privacyConsentAt)}</div></div><div class="value">${yesNo(detail.client.privacyConsent)}</div></div><div class="consent-row"><div><div class="value">Consenso marketing</div><div class="small">Data registrata: ${formatDate(detail.client.marketingConsentAt)}</div></div><div class="value">${yesNo(detail.client.marketingConsent)}</div></div><div class="consent-row"><div><div class="value">Consenso dati sensibili / scheda tecnica</div><div class="small">Data registrata: ${formatDate(detail.client.sensitiveDataConsentAt)}</div></div><div class="value">${yesNo(detail.client.sensitiveDataConsent)}</div></div><p class="small" style="margin-top:12px;">Fonte consenso registrata nel gestionale: ${escapeHtml(consentSource)}</p></div><div class="signatures"><div class="signature-box">Firma cliente</div><div class="signature-box">Firma operatore / centro</div></div></body></html>`;
  }

  toClientEntity(payload) {
    const now = new Date().toISOString();
    const fullName = [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim() || payload.fullName || "Nuovo cliente";
    return {
      id: payload.id || `cl_${Date.now()}`,
      name: fullName,
      type: payload.type || "beauty",
      phone: payload.phone || "",
      email: payload.email || "",
      birthDate: payload.birthDate || "",
      notes: payload.notes || "",
      preferences: payload.preferences ? String(payload.preferences).split(",").map((item) => item.trim()).filter(Boolean) : [],
      allergies: payload.allergies || "",
      activePlans: payload.packages ? String(payload.packages).split(",").map((item) => item.trim()).filter(Boolean) : [],
      privacyConsent: Boolean(payload.privacyConsent),
      privacyConsentAt: payload.privacyConsentAt || "",
      marketingConsent: Boolean(payload.marketingConsent),
      marketingConsentAt: payload.marketingConsentAt || "",
      sensitiveDataConsent: Boolean(payload.sensitiveDataConsent),
      sensitiveDataConsentAt: payload.sensitiveDataConsentAt || "",
      consentSource: payload.consentSource || "in_sede",
      recallDue: payload.recallDue || "",
      recommendedProtocol: payload.recommendedProtocol || "",
      totalValue: Number(payload.totalValue || 0),
      photoStatus: payload.photoStatus || "",
      loyaltyTier: payload.loyaltyTier || "base",
      lastVisit: payload.lastVisit || "",
      createdAt: payload.createdAt || now,
      updatedAt: now
    };
  }

  mapClient(client) {
    const { firstName, lastName } = splitName(client.name);
    return {
      id: client.id,
      firstName,
      lastName,
      phone: client.phone || "",
      email: client.email || "",
      birthDate: client.birthDate || "",
      notes: client.notes || "",
      preferences: Array.isArray(client.preferences) ? client.preferences.join(", ") : client.preferences || "",
      allergies: client.allergies || "",
      packages: Array.isArray(client.activePlans) ? client.activePlans.join(", ") : client.packages || "",
      privacyConsent: Boolean(client.privacyConsent),
      privacyConsentAt: client.privacyConsentAt || "",
      marketingConsent: Boolean(client.marketingConsent),
      marketingConsentAt: client.marketingConsentAt || "",
      sensitiveDataConsent: Boolean(client.sensitiveDataConsent),
      sensitiveDataConsentAt: client.sensitiveDataConsentAt || "",
      consentSource: client.consentSource || "in_sede",
      createdAt: client.createdAt || new Date().toISOString(),
      updatedAt: client.updatedAt || client.createdAt || new Date().toISOString(),
      totalValue: Number(client.totalValue || 0)
    };
  }

  toAppointmentEntity(payload, session) {
    const now = new Date().toISOString();
    const startAt = payload.startAt || toDateTime(payload.date, payload.time);
    const durationMin = Number(payload.durationMin || payload.duration || this.findServiceDurationById(payload.serviceId, session) || 45);
    const endAt = payload.endAt || addMinutes(startAt, durationMin);
    return {
      id: payload.id || `appt_${Date.now()}`,
      clientId: payload.clientId || this.findClientIdByName(payload.clientName, session),
      staffId: payload.staffId || this.findStaffIdByName(payload.staffName, session),
      serviceId: payload.serviceId || this.findServiceIdByName(payload.serviceName, session),
      serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : payload.serviceId ? [payload.serviceId] : undefined,
      resourceId: payload.resourceId || this.findResourceIdByName(payload.resourceName, session),
      startAt,
      endAt,
      date: toDateOnly(startAt),
      time: toTimeOnly(startAt),
      client: payload.clientName || this.findClientNameById(payload.clientId, session) || "Cliente",
      service: payload.serviceName || this.findServiceNameById(payload.serviceId, session) || "Servizio",
      operator: payload.staffName || this.findStaffNameById(payload.staffId, session) || "Operatore",
      room: payload.resourceName || this.findResourceNameById(payload.resourceId, session) || "Postazione",
      status: payload.status || "requested",
      day: "scheduled",
      reminderSent: false,
      duration: durationMin,
      notes: payload.notes || "",
      createdAt: payload.createdAt || now,
      updatedAt: now,
      locked: Number(payload.locked || 0)
    };
  }

  mapAppointment(item, clients = this.clientsRepository.list(), services = this.servicesRepository.list(), staff = this.staffRepository.list(), resources = this.resourcesRepository.list()) {
    const client = clients.find((entry) => entry.id === item.clientId || entry.name === item.client);
    const service = services.find((entry) => entry.id === item.serviceId || entry.name === item.service);
    const operator = staff.find((entry) => entry.id === item.staffId || entry.name === item.operator);
    const resource = resources.find((entry) => entry.id === item.resourceId || entry.name === item.room);
    const startAt = item.startAt || toDateTime(item.date, item.time);
    const durationMin = Number(item.durationMin || item.duration || service?.durationMin || service?.duration || 45);
    const candidateEndAt = item.endAt || addMinutes(startAt, durationMin);
    const endAt = new Date(candidateEndAt).getTime() > new Date(startAt).getTime()
      ? candidateEndAt
      : addMinutes(startAt, durationMin);
    return {
      id: item.id,
      clientId: client?.id || item.clientId || "",
      staffId: operator?.id || item.staffId || null,
      serviceId: service?.id || item.serviceId || null,
      serviceIds: Array.isArray(item.serviceIds) ? item.serviceIds : item.serviceId ? [item.serviceId] : service?.id ? [service.id] : [],
      resourceId: resource?.id || item.resourceId || null,
      startAt,
      endAt,
      status: item.status || "requested",
      locked: Number(item.locked || 0),
      notes: item.notes || "",
      createdAt: item.createdAt || startAt,
      updatedAt: item.updatedAt || startAt,
      clientName: client?.name || item.client || "Cliente",
      serviceName: service?.name || item.service || "Servizio",
      staffName: operator?.name || item.operator || "Operatore",
      resourceName: resource?.name || item.room || "Postazione"
    };
  }

  findClientIdByName(name, session) {
    return this.filterByCenter(this.clientsRepository.list(), session).find((item) => item.name === name)?.id || "";
  }
  findStaffIdByName(name, session) {
    return this.filterByCenter(this.staffRepository.list(), session).find((item) => item.name === name)?.id || "";
  }
  findServiceIdByName(name, session) {
    return this.filterByCenter(this.servicesRepository.list(), session).find((item) => item.name === name)?.id || "";
  }
  findResourceIdByName(name, session) {
    return this.filterByCenter(this.resourcesRepository.list(), session).find((item) => item.name === name)?.id || "";
  }
  findClientNameById(id, session) {
    return this.findByIdInCenter(this.clientsRepository, id, session)?.name || "";
  }
  findStaffNameById(id, session) {
    return this.findByIdInCenter(this.staffRepository, id, session)?.name || "";
  }
  findServiceNameById(id, session) {
    return this.findByIdInCenter(this.servicesRepository, id, session)?.name || "";
  }
  findResourceNameById(id, session) {
    return this.findByIdInCenter(this.resourcesRepository, id, session)?.name || "";
  }
  findServiceDurationById(id, session) {
    const service = this.findByIdInCenter(this.servicesRepository, id, session);
    return Number(service?.durationMin || service?.duration || 45);
  }
}

module.exports = {
  DesktopMirrorService,
  defaultSettings
};
