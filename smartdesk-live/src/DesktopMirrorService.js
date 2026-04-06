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
    return this.filterByCenter(this.clientsRepository.list(), session)
      .filter((client) => {
        if (!normalizedSearch) return true;
        return [client.name, client.phone, client.email].filter(Boolean).some((field) => String(field).toLowerCase().includes(normalizedSearch));
      })
      .map((client) => this.mapClient(client));
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
      }
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
    return {
      clientName: `${detail.client.firstName} ${detail.client.lastName}`.trim(),
      summary,
      protocolBrief: detail.treatments.length ? `Trattamenti registrati: ${detail.treatments.length}.` : "Nessun trattamento registrato.",
      technologyBrief: detail.treatments.length ? "Storico tecnico disponibile." : "Storico tecnico non disponibile.",
      missingData,
      nextActions: [
        !detail.client.phone ? "raccogliere telefono per follow-up rapido" : "telefono cliente aggiornato",
        cancelled ? "verificare cause di annullamento o no-show" : "nessuna criticita evidente da annullamenti",
        lastAppointment ? `ripartire dall'ultima visita del ${new Date(lastAppointment.startAt).toLocaleDateString("it-IT")}` : "programmarea una prima visita completa"
      ],
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

  listShifts(view = "month", anchorDate = new Date().toISOString(), staffId, session) {
    const { start, end } = rangeForView(view, anchorDate);
    const staff = this.filterByCenter(this.staffRepository.list(), session);
    return this.filterByCenter(this.shiftsRepository.list(), session)
      .filter((item) => item.date >= start && item.date <= end && (!staffId || item.staffId === staffId))
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
      .map((item) => {
        const operator = staff.find((entry) => entry.id === item.staffId);
        const workedMinutes = item.attendanceStatus === "present" || item.attendanceStatus === "late"
          ? Math.max(0, minutesBetween(effectiveStartTime(item), effectiveEndTime(item)))
          : 0;
        return {
          ...item,
          effectiveStartTime: effectiveStartTime(item),
          effectiveEndTime: effectiveEndTime(item),
          isRectified: Boolean(item.rectifiedAt),
          staffName: operator?.name || "Operatore",
          staffColorTag: operator?.colorTag || null,
          workedMinutes
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
    const totalWorkedMinutes = rows.reduce((sum, item) => sum + ((item.attendanceStatus === "present" || item.attendanceStatus === "late") ? Math.max(0, minutesBetween(effectiveStartTime(item), effectiveEndTime(item))) : 0), 0);
    const periodLabel = mode === "month"
      ? `${range.start.slice(5, 7)}/${range.start.slice(0, 4)}`
      : mode === "day"
        ? range.start.split("-").reverse().join("/")
        : `${range.start.split("-").reverse().join("/")} - ${range.end.split("-").reverse().join("/")}`;
    const rowsHtml = rows.map((item) => {
      const operator = staff.find((entry) => entry.id === item.staffId);
      const worked = item.attendanceStatus === "present" || item.attendanceStatus === "late" ? formatMinutes(minutesBetween(effectiveStartTime(item), effectiveEndTime(item))) : "0h 00m";
      const statusLabel = item.attendanceStatus === "present" ? "Presente" : item.attendanceStatus === "absent" ? "Assente" : item.attendanceStatus === "late" ? "Ritardo" : "Da confermare";
      return `<tr><td>${item.date.split("-").reverse().join("/")}</td><td>${escapeHtml(operator?.name || "Operatore")}</td><td>${effectiveStartTime(item)} - ${effectiveEndTime(item)}</td><td>${statusLabel}</td><td>${worked}</td></tr>`;
    }).join("");
    ensureDir(EXPORTS_DIR);
    const fileName = `presenze-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Foglio presenze</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#163047;padding:34px}h1{margin:0 0 8px;color:#1F86AA}.meta{color:#6e8299;margin-bottom:18px}.box{border:1px solid #dfe8f3;border-radius:14px;padding:14px;margin-bottom:18px;background:#f8fbff}table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;border-bottom:1px solid #edf3f8;text-align:left;font-size:13px}th{text-transform:uppercase;font-size:11px;letter-spacing:.05em;color:#6e8299}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:36px}.signature{padding-top:34px;border-top:1px solid #cfdbe6;color:#5b707a;font-size:13px}@media print{.printbar{display:none}}</style></head><body><div class="printbar" style="margin-bottom:16px;"><button onclick="window.print()" style="padding:10px 16px;border-radius:999px;border:1px solid #4FB6D6;background:#4FB6D6;color:#fff;font-weight:700;cursor:pointer;">Stampa documento</button></div><h1>Foglio presenze</h1><div class="meta">${escapeHtml(settings.centerName)} · ${periodLabel}</div><div class="box"><div><strong>Operatore:</strong> ${escapeHtml(staffName)}</div><div><strong>Totale ore lavorate:</strong> ${formatMinutes(totalWorkedMinutes)}</div></div><table><thead><tr><th>Data</th><th>Operatore</th><th>Orario</th><th>Stato</th><th>Ore</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="5">Nessun turno disponibile nel periodo selezionato.</td></tr>`}</tbody></table><div class="signatures"><div class="signature">Firma operatore</div><div class="signature">Firma responsabile</div></div></body></html>`;
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
      active: Number(item.active ?? 1),
      createdAt: item.createdAt || new Date().toISOString()
    }));
  }

  saveResource(payload, session) {
    const next = this.attachCenter({
      id: payload.id || `res_${Date.now()}`,
      name: payload.name || "Risorsa",
      type: payload.type || "cabina",
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
    }
    return item;
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

  getDashboardStats(session) {
    const appointments = this.listAppointments("month", new Date().toISOString(), true, session);
    const payments = this.listPayments(undefined, session);
    const services = this.listServices(session);
    const servicesById = new Map(services.map((service) => [service.id, service]));
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const today = toDateOnly(new Date().toISOString());
    const todayAppointments = appointments.filter((item) => toDateOnly(item.startAt) === today);
    const completedAppointments = appointments.filter((item) => item.status === "completed");
    const spendByClient = new Map();
    const visitsByClient = new Map();
    const lastVisitByClient = new Map();
    const servicePerformance = new Map();

    completedAppointments.forEach((item) => {
      visitsByClient.set(item.clientId, (visitsByClient.get(item.clientId) || 0) + 1);
      const prev = lastVisitByClient.get(item.clientId);
      if (!prev || new Date(item.startAt).getTime() > new Date(prev).getTime()) {
        lastVisitByClient.set(item.clientId, item.startAt);
      }
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
        const daysSinceLastVisit = lastVisitAt ? Math.max(0, Math.floor((Date.now() - new Date(lastVisitAt).getTime()) / 86400000)) : -1;
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

    const agendaLoad = todayAppointments.filter((item) => item.status !== "cancelled" && item.status !== "no_show").length;
    const alerts = [
      ...(inactiveClients.length > 0 ? [`Hai ${inactiveClients.length} clienti inattivi`] : []),
      ...(agendaLoad <= 3 ? ["Agenda leggera oggi"] : [])
    ];

    const nextAppointments = appointments
      .filter((item) => new Date(item.startAt).getTime() >= Date.now())
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
      todayAppointments: todayAppointments.length,
      confirmedAppointments: todayAppointments.filter((item) => item.status === "confirmed").length,
      arrivedAppointments: todayAppointments.filter((item) => item.status === "arrived").length,
      inProgressAppointments: todayAppointments.filter((item) => item.status === "in_progress").length,
      readyCheckoutAppointments: todayAppointments.filter((item) => item.status === "ready_checkout").length,
      completedAppointments: todayAppointments.filter((item) => item.status === "completed").length,
      todayRevenueCents: payments.filter((item) => toDateOnly(item.createdAt) === today).reduce((sum, item) => sum + item.amountCents, 0),
      activeClients: clients.length,
      upcomingAppointments: appointments.filter((item) => {
        const diff = new Date(item.startAt).getTime() - Date.now();
        return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
      }).length,
      activeStaff: this.filterByCenter(this.staffRepository.list(), session).filter((item) => item.active !== false).length,
      activeServices: services.filter((item) => item.active !== false).length,
      pendingConfirmations: todayAppointments.filter((item) => item.status === "requested" || item.status === "booked").length,
      inactiveClientsCount: inactiveClients.length,
      alerts,
      topClients,
      profitableServices,
      lowPerformingServices,
      inactiveClients,
      nextAppointments
    };
  }

  getOperationalReport(period = "day", session) {
    const appointments = this.listAppointments("month", new Date().toISOString(), true, session);
    const payments = this.listPayments(undefined, session);
    const services = this.listServices(session);
    const staff = this.listStaff(session);
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const treatments = this.listTreatments(undefined, session);
    const resources = this.listResources(session);
    const now = new Date();
    let start = new Date(now);
    if (period === "week") {
      start.setDate(now.getDate() - 7);
    } else if (period === "month") {
      start.setMonth(now.getMonth() - 1);
    } else {
      start.setHours(0, 0, 0, 0);
    }
    const scopedAppointments = appointments.filter((item) => new Date(item.startAt).getTime() >= start.getTime());
    const scopedPayments = payments.filter((item) => new Date(item.createdAt).getTime() >= start.getTime());

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
      dateLabel: period === "day" ? "Oggi" : period === "week" ? "Ultimi 7 giorni" : "Ultimi 30 giorni",
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

  exportOperationalReport(period = "day", format = "pdf", session) {
    ensureDir(EXPORTS_DIR);
    const report = this.getOperationalReport(period, session);
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
