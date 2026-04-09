const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JsonFileRepository } = require("./JsonFileRepository");

const DATA_DIR = path.resolve(process.cwd(), "data");
const EXPORTS_DIR = path.resolve(process.cwd(), "public", "exports");

const DEFAULT_CENTER_ID = "center_admin";
const DEFAULT_CENTER_NAME = "SkinHarmony Smart Desk";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin1234";

const defaultSettings = {
  centerName: DEFAULT_CENTER_NAME,
  centerType: "Advanced Aesthetic Systems",
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
  membershipGoldDiscountPercent: 15
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

function toDateOnly(value) {
  if (!value) return nowIso().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return nowIso().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
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
    this.treatmentsRepository = this.createRepository("treatments", []);
    this.usersRepository = this.createRepository("users", []);
    this.salesRepository = this.createRepository("sales", []);
    this.settingsRepository = this.createRepository("settings", defaultSettings);

    this.sessions = new Map();
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
        { name: "treatments", filePath: path.join(DATA_DIR, "treatments.json"), defaultValue: [] },
        { name: "users", filePath: path.join(DATA_DIR, "users.json"), defaultValue: [] },
        { name: "sales", filePath: path.join(DATA_DIR, "sales.json"), defaultValue: [] },
        { name: "settings", filePath: path.join(DATA_DIR, "settings.json"), defaultValue: defaultSettings }
      ]);
    }

    this.ensureInitialAdmin();
    this.ensureDefaultStaff();
  }

  ensureInitialAdmin() {
    const users = this.usersRepository.list();
    const admin = users.find((item) => String(item.username || "").toLowerCase() === DEFAULT_ADMIN_USERNAME);
    if (!admin) {
      this.usersRepository.create({
        id: makeId("user"),
        username: DEFAULT_ADMIN_USERNAME,
        passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
        role: "superadmin",
        active: true,
        centerId: DEFAULT_CENTER_ID,
        centerName: DEFAULT_CENTER_NAME,
        createdAt: nowIso()
      });
    }
  }

  ensureDefaultStaff() {
    const staff = this.staffRepository.list();
    if (staff.length) return;
    DEFAULT_STAFF.forEach((item) => {
      this.staffRepository.create({
        ...item,
        centerId: DEFAULT_CENTER_ID,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    });
  }

  getSettings() {
    const current = this.settingsRepository.list();
    if (Array.isArray(current)) return { ...defaultSettings };
    return { ...defaultSettings, ...current };
  }

  saveSettings(payload = {}) {
    const next = { ...this.getSettings(), ...payload, updatedAt: nowIso() };
    this.settingsRepository.write(next);
    return next;
  }

  resetSettings() {
    const next = { ...defaultSettings, updatedAt: nowIso() };
    this.settingsRepository.write(next);
    return next;
  }

  createSession(user) {
    const token = crypto.randomUUID();
    const session = {
      token,
      userId: user.id,
      username: user.username,
      role: user.role || "superadmin",
      centerId: user.centerId || DEFAULT_CENTER_ID,
      centerName: user.centerName || DEFAULT_CENTER_NAME,
      createdAt: nowIso()
    };
    this.sessions.set(token, session);
    return session;
  }

  login(payload = {}) {
    const username = String(payload.username || payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const user = this.usersRepository.list().find((item) => String(item.username || "").toLowerCase() === username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Credenziali non valide");
    }
    return this.createSession(user);
  }

  getSession(token) {
    return this.sessions.get(String(token || "")) || null;
  }

  logout(token) {
    this.sessions.delete(String(token || ""));
    return { success: true };
  }

  listAccessUsers() {
    return this.usersRepository.list().map((item) => ({
      id: item.id,
      username: item.username,
      role: item.role,
      active: item.active,
      centerId: item.centerId || DEFAULT_CENTER_ID,
      centerName: item.centerName || DEFAULT_CENTER_NAME,
      createdAt: item.createdAt || nowIso()
    }));
  }

  createAccessUser(payload = {}) {
    const username = String(payload.username || "").trim().toLowerCase();
    if (!username) throw new Error("Username obbligatorio");
    if (this.usersRepository.list().some((item) => String(item.username || "").toLowerCase() === username)) {
      throw new Error("Utente già presente");
    }
    const user = {
      id: makeId("user"),
      username,
      passwordHash: hashPassword(String(payload.password || "changeme123")),
      role: String(payload.role || "staff"),
      active: payload.active !== false,
      centerId: DEFAULT_CENTER_ID,
      centerName: DEFAULT_CENTER_NAME,
      createdAt: nowIso()
    };
    this.usersRepository.create(user);
    return this.listAccessUsers().find((item) => item.id === user.id);
  }

  listClients(search = "") {
    const query = String(search || "").trim().toLowerCase();
    const clients = this.clientsRepository.list();
    if (!query) return clients;
    return clients.filter((item) =>
      [item.name, item.phone, item.email].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }

  saveClient(payload = {}) {
    const firstName = String(payload.firstName || "").trim();
    const lastName = String(payload.lastName || "").trim();
    const fullName = String(payload.name || `${firstName} ${lastName}`.trim() || payload.fullName || "Nuovo cliente");
    const now = nowIso();
    const entity = {
      id: payload.id || makeId("client"),
      name: fullName,
      phone: String(payload.phone || ""),
      email: String(payload.email || ""),
      birthDate: String(payload.birthDate || ""),
      notes: String(payload.notes || ""),
      allergies: String(payload.allergies || ""),
      preferences: Array.isArray(payload.preferences)
        ? payload.preferences
        : String(payload.preferences || "").split(",").map((item) => item.trim()).filter(Boolean),
      packages: Array.isArray(payload.packages)
        ? payload.packages
        : String(payload.packages || "").split(",").map((item) => item.trim()).filter(Boolean),
      privacyConsent: Boolean(payload.privacyConsent),
      marketingConsent: Boolean(payload.marketingConsent),
      sensitiveDataConsent: Boolean(payload.sensitiveDataConsent),
      consentSource: String(payload.consentSource || "in_sede"),
      totalValue: Number(payload.totalValue || 0),
      loyaltyTier: String(payload.loyaltyTier || "base"),
      lastVisit: String(payload.lastVisit || ""),
      createdAt: payload.createdAt || now,
      updatedAt: now
    };

    if (!payload.id) {
      this.clientsRepository.create(entity);
      return entity;
    }

    return this.clientsRepository.update(payload.id, (current) => ({
      ...current,
      ...entity,
      createdAt: current.createdAt || entity.createdAt
    }));
  }

  getClientDetail(clientId) {
    const client = this.clientsRepository.findById(clientId);
    if (!client) throw new Error("Cliente non trovato");
    const appointments = this.appointmentsRepository.list().filter((item) => item.clientId === clientId);
    const payments = this.paymentsRepository.list().filter((item) => item.clientId === clientId);
    const treatments = this.treatmentsRepository.list().filter((item) => item.clientId === clientId);
    return {
      client,
      appointments,
      payments,
      treatments
    };
  }

  getClientConsultation(clientId) {
    const detail = this.getClientDetail(clientId);
    return {
      client: detail.client,
      history: detail.appointments.slice(0, 10),
      recommendations: []
    };
  }

  generateClientConsentDocument(clientId) {
    const detail = this.getClientDetail(clientId);
    ensureDir(EXPORTS_DIR);
    const fileName = `consent-${sanitizeFileName(detail.client.name)}-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Consenso</title></head><body><h1>${escapeHtml(detail.client.name)}</h1><p>Documento consenso generato da Smart Desk.</p></body></html>`;
    fs.writeFileSync(filePath, html);
    return { path: filePath, url: `/exports/${fileName}` };
  }

  listAppointments(view = "day", anchorDate = nowIso()) {
    const appointments = this.appointmentsRepository.list();
    const day = toDateOnly(anchorDate);
    if (view === "day") {
      return appointments.filter((item) => toDateOnly(item.startAt) === day);
    }
    return appointments;
  }

  saveAppointment(payload = {}) {
    const startAt = payload.startAt || toDateTime(payload.date, payload.time);
    const durationMin = Number(payload.durationMin || payload.duration || 45);
    const endAt = payload.endAt || addMinutes(startAt, durationMin);
    const entity = {
      id: payload.id || makeId("appt"),
      clientId: String(payload.clientId || ""),
      clientName: String(payload.clientName || payload.client || ""),
      staffId: String(payload.staffId || ""),
      staffName: String(payload.staffName || payload.operator || ""),
      serviceId: String(payload.serviceId || ""),
      serviceName: String(payload.serviceName || payload.service || ""),
      resourceId: String(payload.resourceId || ""),
      resourceName: String(payload.resourceName || payload.room || ""),
      startAt,
      endAt,
      status: String(payload.status || "requested"),
      notes: String(payload.notes || ""),
      durationMin,
      createdAt: payload.createdAt || nowIso(),
      updatedAt: nowIso()
    };

    if (!payload.id) {
      this.appointmentsRepository.create(entity);
      return entity;
    }

    return this.appointmentsRepository.update(payload.id, (current) => ({
      ...current,
      ...entity,
      createdAt: current.createdAt || entity.createdAt
    }));
  }

  listServices() {
    return this.servicesRepository.list();
  }

  saveService(payload = {}) {
    const entity = {
      id: payload.id || makeId("service"),
      name: String(payload.name || "Nuovo servizio"),
      category: String(payload.category || ""),
      durationMin: Number(payload.durationMin || payload.duration || 45),
      priceCents: Number(payload.priceCents || payload.price || 0),
      active: payload.active !== false,
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.servicesRepository.create(entity);
      return entity;
    }
    return this.servicesRepository.update(payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }));
  }

  deleteService(id) {
    return { success: this.servicesRepository.delete(id) };
  }

  listStaff() {
    return this.staffRepository.list();
  }

  saveStaff(payload = {}) {
    const entity = {
      id: payload.id || makeId("staff"),
      name: String(payload.name || "Nuovo operatore"),
      role: String(payload.role || ""),
      colorTag: String(payload.colorTag || "#6db7ff"),
      active: payload.active === false ? 0 : 1,
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.staffRepository.create(entity);
      return entity;
    }
    return this.staffRepository.update(payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }));
  }

  deleteStaff(id) {
    return { success: this.staffRepository.delete(id) };
  }

  listShifts() {
    return this.shiftsRepository.list();
  }

  saveShift(payload = {}) {
    const entity = {
      id: payload.id || makeId("shift"),
      staffId: String(payload.staffId || ""),
      staffName: String(payload.staffName || ""),
      date: toDateOnly(payload.date || payload.startDate || nowIso()),
      startTime: String(payload.startTime || "09:00"),
      endTime: String(payload.endTime || "18:00"),
      attendanceStatus: String(payload.attendanceStatus || "scheduled"),
      notes: String(payload.notes || ""),
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.shiftsRepository.create(entity);
      return entity;
    }
    return this.shiftsRepository.update(payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }));
  }

  deleteShift(id) {
    return { success: this.shiftsRepository.delete(id) };
  }

  exportShiftReport() {
    ensureDir(EXPORTS_DIR);
    const fileName = `shift-report-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    fs.writeFileSync(filePath, "<!doctype html><html><body><h1>Shift report</h1></body></html>");
    return { path: filePath, url: `/exports/${fileName}` };
  }

  listShiftTemplates() {
    return this.shiftTemplatesRepository.list();
  }

  saveShiftTemplate(payload = {}) {
    const entity = {
      id: payload.id || makeId("template"),
      name: String(payload.name || "Nuovo template"),
      week: Array.isArray(payload.week) ? payload.week : [],
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.shiftTemplatesRepository.create(entity);
      return entity;
    }
    return this.shiftTemplatesRepository.update(payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }));
  }

  deleteShiftTemplate(id) {
    return { success: this.shiftTemplatesRepository.delete(id) };
  }

  generateShiftTemplate(payload = {}) {
    return {
      generated: true,
      templateId: payload.templateId || null,
      range: { start: toDateOnly(payload.startDate || nowIso()), end: toDateOnly(payload.endDate || nowIso()) }
    };
  }

  listResources() {
    return this.resourcesRepository.list();
  }

  saveResource(payload = {}) {
    const entity = {
      id: payload.id || makeId("resource"),
      name: String(payload.name || "Nuova risorsa"),
      type: String(payload.type || "room"),
      active: payload.active !== false,
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.resourcesRepository.create(entity);
      return entity;
    }
    return this.resourcesRepository.update(payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }));
  }

  deleteResource(id) {
    return { success: this.resourcesRepository.delete(id) };
  }

  listInventoryItems() {
    return this.inventoryRepository.list();
  }

  saveInventoryItem(payload = {}) {
    const entity = {
      id: payload.id || makeId("inv"),
      name: String(payload.name || "Nuovo articolo"),
      sku: String(payload.sku || ""),
      quantity: Number(payload.quantity || 0),
      minQuantity: Number(payload.minQuantity || 0),
      costCents: Number(payload.costCents || 0),
      updatedAt: nowIso(),
      createdAt: payload.createdAt || nowIso()
    };
    if (!payload.id) {
      this.inventoryRepository.create(entity);
      return entity;
    }
    return this.inventoryRepository.update(payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }));
  }

  deleteInventoryItem(id) {
    return { success: this.inventoryRepository.delete(id) };
  }

  listInventoryMovements(itemId = "") {
    return this.inventoryMovementsRepository.list().filter((item) => !itemId || item.itemId === itemId);
  }

  createInventoryMovement(payload = {}) {
    const movement = {
      id: makeId("move"),
      itemId: String(payload.itemId || ""),
      type: String(payload.type || "manual"),
      quantity: Number(payload.quantity || 0),
      note: String(payload.note || ""),
      createdAt: nowIso()
    };
    this.inventoryMovementsRepository.create(movement);
    if (movement.itemId) {
      this.inventoryRepository.update(movement.itemId, (current) => ({
        ...current,
        quantity: Number(current.quantity || 0) + movement.quantity,
        updatedAt: nowIso()
      }));
    }
    return movement;
  }

  getInventoryOverview() {
    const items = this.inventoryRepository.list();
    return {
      totalItems: items.length,
      totalQuantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      lowStock: items.filter((item) => Number(item.quantity || 0) <= Number(item.minQuantity || 0))
    };
  }

  listTreatments(clientId = "") {
    return this.treatmentsRepository.list().filter((item) => !clientId || item.clientId === clientId);
  }

  createTreatment(payload = {}) {
    const treatment = {
      id: makeId("treat"),
      clientId: String(payload.clientId || ""),
      title: String(payload.title || "Trattamento"),
      note: String(payload.note || ""),
      createdAt: nowIso()
    };
    this.treatmentsRepository.create(treatment);
    return treatment;
  }

  listPayments(clientId = "") {
    return this.paymentsRepository.list().filter((item) => !clientId || item.clientId === clientId);
  }

  createPayment(payload = {}) {
    const payment = {
      id: makeId("pay"),
      clientId: String(payload.clientId || ""),
      amountCents: Number(payload.amountCents || payload.amount || 0),
      method: String(payload.method || "cash"),
      note: String(payload.note || ""),
      createdAt: nowIso()
    };
    this.paymentsRepository.create(payment);
    return payment;
  }

  getDashboardStats(options = {}) {
    const today = toDateOnly(options.anchorDate || nowIso());
    const appointments = this.appointmentsRepository.list();
    const clients = this.clientsRepository.list();
    const payments = this.paymentsRepository.list();
    const todayAppointments = appointments.filter((item) => toDateOnly(item.startAt) === today);
    const inactiveClientsCount = clients.filter((item) => !item.lastVisit).length;
    const revenueCents = payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    return {
      todayAppointments: todayAppointments.length,
      inactiveClientsCount,
      completedAppointments: appointments.filter((item) => item.status === "completed").length,
      revenueCents,
      activeClientsCount: clients.length
    };
  }

  getOperationalReport(options = {}) {
    const appointments = this.appointmentsRepository.list();
    const payments = this.paymentsRepository.list();
    return {
      periodLabel: String(options.period || "day"),
      totals: {
        appointments: appointments.length,
        completedAppointments: appointments.filter((item) => item.status === "completed").length,
        revenueCents: payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0)
      }
    };
  }

  exportOperationalReport(options = {}, format = "pdf") {
    ensureDir(EXPORTS_DIR);
    const report = this.getOperationalReport(options);
    const fileName = `operational-report-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = `<!doctype html><html lang="it"><body><h1>Report operativo</h1><p>Appuntamenti: ${report.totals.appointments}</p><p>Completati: ${report.totals.completedAppointments}</p><p>Incasso: ${euro(report.totals.revenueCents)}</p></body></html>`;
    fs.writeFileSync(filePath, html);
    return { path: filePath, format, url: `/exports/${fileName}` };
  }

  getOperatorReport(operatorId, options = {}) {
    const operator = this.staffRepository.findById(operatorId);
    if (!operator) throw new Error("Operatore non trovato");
    const appointments = this.appointmentsRepository.list().filter((item) => item.staffId === operatorId);
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

  exportOperatorReport(operatorId, options = {}) {
    ensureDir(EXPORTS_DIR);
    const report = this.getOperatorReport(operatorId, options);
    const fileName = `operator-report-${sanitizeFileName(report.operator.name)}-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    fs.writeFileSync(filePath, "<!doctype html><html><body><h1>Report operatore</h1></body></html>");
    return { path: filePath, format: "html", url: `/exports/${fileName}` };
  }

  openExportsFolder() {
    ensureDir(EXPORTS_DIR);
    const entries = fs.readdirSync(EXPORTS_DIR).sort().reverse();
    return { success: true, url: entries[0] ? `/exports/${entries[0]}` : null };
  }

  getProfitabilityOverview() {
    const payments = this.paymentsRepository.list();
    const inventory = this.inventoryRepository.list();
    return {
      revenueCents: payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0),
      inventoryCostCents: inventory.reduce((sum, item) => sum + Number(item.costCents || 0) * Number(item.quantity || 0), 0)
    };
  }
}

module.exports = {
  DesktopMirrorService,
  defaultSettings
};