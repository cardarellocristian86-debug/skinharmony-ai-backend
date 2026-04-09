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

  getCenterId(session = null) {
    return String(session?.centerId || DEFAULT_CENTER_ID);
  }

  getCenterName(session = null) {
    return String(session?.centerName || DEFAULT_CENTER_NAME);
  }

  belongsToCenter(item, centerId) {
    return String(item?.centerId || DEFAULT_CENTER_ID) === String(centerId || DEFAULT_CENTER_ID);
  }

  filterByCenter(items = [], session = null) {
    const centerId = this.getCenterId(session);
    return items.filter((item) => this.belongsToCenter(item, centerId));
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
    return repository.update(id, updater);
  }

  deleteInCenter(repository, id, session = null) {
    const centerId = this.getCenterId(session);
    const current = repository.findById(id);
    if (!current || !this.belongsToCenter(current, centerId)) {
      return { success: false };
    }
    return { success: repository.delete(id) };
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
    this.ensureDefaultStaffForCenter(DEFAULT_CENTER_ID, DEFAULT_CENTER_NAME);
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

  listAccessUsers(_session = null) {
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

  createAccessUser(payload = {}, session = null) {
    const username = String(payload.username || "").trim().toLowerCase();
    if (!username) throw new Error("Username obbligatorio");
    if (this.usersRepository.list().some((item) => String(item.username || "").toLowerCase() === username)) {
      throw new Error("Utente già presente");
    }
    const centerId = String(payload.centerId || makeId("center"));
    const centerName = String(payload.centerName || payload.businessName || username);
    const user = {
      id: makeId("user"),
      username,
      passwordHash: hashPassword(String(payload.password || "changeme123")),
      role: String(payload.role || "staff"),
      active: payload.active !== false,
      centerId,
      centerName,
      createdAt: nowIso()
    };
    this.usersRepository.create(user);
    this.ensureDefaultStaffForCenter(centerId, centerName);
    this.saveSettings({ centerName }, { centerId, centerName, role: session?.role || "superadmin" });
    return this.listAccessUsers(session).find((item) => item.id === user.id);
  }

  listClients(search = "", session = null) {
    const query = String(search || "").trim().toLowerCase();
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    if (!query) return clients;
    return clients.filter((item) =>
      [item.name, item.phone, item.email].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }

  saveClient(payload = {}, session = null) {
    const firstName = String(payload.firstName || "").trim();
    const lastName = String(payload.lastName || "").trim();
    const fullName = String(payload.name || `${firstName} ${lastName}`.trim() || payload.fullName || "Nuovo cliente");
    const now = nowIso();
    const centerId = this.getCenterId(session);
    const centerName = this.getCenterName(session);
    const entity = {
      id: payload.id || makeId("client"),
      centerId,
      centerName,
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

    return this.updateInCenter(this.clientsRepository, payload.id, (current) => ({
      ...current,
      ...entity,
      createdAt: current.createdAt || entity.createdAt
    }), session);
  }

  getClientDetail(clientId, session = null) {
    const client = this.findByIdInCenter(this.clientsRepository, clientId, session);
    if (!client) throw new Error("Cliente non trovato");
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session).filter((item) => item.clientId === clientId);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session).filter((item) => item.clientId === clientId);
    const treatments = this.filterByCenter(this.treatmentsRepository.list(), session).filter((item) => item.clientId === clientId);
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
    const fileName = `consent-${sanitizeFileName(detail.client.name)}-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Consenso</title></head><body><h1>${escapeHtml(detail.client.name)}</h1><p>Documento consenso generato da Smart Desk.</p></body></html>`;
    fs.writeFileSync(filePath, html);
    return { path: filePath, url: `/exports/${fileName}` };
  }

  listAppointments(view = "day", anchorDate = nowIso(), _includeArchived = false, session = null) {
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const day = toDateOnly(anchorDate);
    if (view === "day") {
      return appointments.filter((item) => toDateOnly(item.startAt) === day);
    }
    return appointments;
  }

  saveAppointment(payload = {}, session = null) {
    const startAt = payload.startAt || toDateTime(payload.date, payload.time);
    const durationMin = Number(payload.durationMin || payload.duration || 45);
    const endAt = payload.endAt || addMinutes(startAt, durationMin);
    const centerId = this.getCenterId(session);
    const centerName = this.getCenterName(session);
    const entity = {
      id: payload.id || makeId("appt"),
      centerId,
      centerName,
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

    return this.updateInCenter(this.appointmentsRepository, payload.id, (current) => ({
      ...current,
      ...entity,
      createdAt: current.createdAt || entity.createdAt
    }), session);
  }

  listServices(session = null) {
    return this.filterByCenter(this.servicesRepository.list(), session);
  }

  saveService(payload = {}, session = null) {
    const entity = {
      id: payload.id || makeId("service"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
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
    return this.updateInCenter(this.servicesRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
  }

  deleteService(id, session = null) {
    return this.deleteInCenter(this.servicesRepository, id, session);
  }

  listStaff(session = null) {
    return this.filterByCenter(this.staffRepository.list(), session);
  }

  saveStaff(payload = {}, session = null) {
    const entity = {
      id: payload.id || makeId("staff"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
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
    return this.updateInCenter(this.staffRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
  }

  deleteStaff(id, session = null) {
    return this.deleteInCenter(this.staffRepository, id, session);
  }

  listShifts(view = "month", anchorDate = nowIso(), staffId = "", session = null) {
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
    const entity = {
      id: payload.id || makeId("shift"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
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
    const entity = {
      id: payload.id || makeId("template"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      name: String(payload.name || "Nuovo template"),
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
    const entity = {
      id: payload.id || makeId("resource"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
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
    return this.updateInCenter(this.resourcesRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
  }

  deleteResource(id, session = null) {
    return this.deleteInCenter(this.resourcesRepository, id, session);
  }

  listInventoryItems(session = null) {
    return this.filterByCenter(this.inventoryRepository.list(), session);
  }

  saveInventoryItem(payload = {}, session = null) {
    const entity = {
      id: payload.id || makeId("inv"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
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
    return this.updateInCenter(this.inventoryRepository, payload.id, (current) => ({ ...current, ...entity, createdAt: current.createdAt || entity.createdAt }), session);
  }

  deleteInventoryItem(id, session = null) {
    return this.deleteInCenter(this.inventoryRepository, id, session);
  }

  listInventoryMovements(itemId = "", session = null) {
    return this.filterByCenter(this.inventoryMovementsRepository.list(), session).filter((item) => !itemId || item.itemId === itemId);
  }

  createInventoryMovement(payload = {}, session = null) {
    const centerId = this.getCenterId(session);
    const movement = {
      id: makeId("move"),
      centerId,
      centerName: this.getCenterName(session),
      itemId: String(payload.itemId || ""),
      type: String(payload.type || "manual"),
      quantity: Number(payload.quantity || 0),
      note: String(payload.note || ""),
      createdAt: nowIso()
    };
    this.inventoryMovementsRepository.create(movement);
    if (movement.itemId) {
      this.updateInCenter(this.inventoryRepository, movement.itemId, (current) => ({
        ...current,
        quantity: Number(current.quantity || 0) + movement.quantity,
        updatedAt: nowIso()
      }), session);
    }
    return movement;
  }

  getInventoryOverview(session = null) {
    const items = this.filterByCenter(this.inventoryRepository.list(), session);
    return {
      totalItems: items.length,
      totalQuantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      lowStock: items.filter((item) => Number(item.quantity || 0) <= Number(item.minQuantity || 0))
    };
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
    return treatment;
  }

  listPayments(clientId = "", session = null) {
    return this.filterByCenter(this.paymentsRepository.list(), session).filter((item) => !clientId || item.clientId === clientId);
  }

  createPayment(payload = {}, session = null) {
    const payment = {
      id: makeId("pay"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      clientId: String(payload.clientId || ""),
      amountCents: Number(payload.amountCents || payload.amount || 0),
      method: String(payload.method || "cash"),
      note: String(payload.note || ""),
      createdAt: nowIso()
    };
    this.paymentsRepository.create(payment);
    return payment;
  }

  getDashboardStats(options = {}, session = null) {
    const today = toDateOnly(options.anchorDate || nowIso());
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
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

  getOperationalReport(options = {}, session = null) {
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    return {
      periodLabel: String(options.period || "day"),
      totals: {
        appointments: appointments.length,
        completedAppointments: appointments.filter((item) => item.status === "completed").length,
        revenueCents: payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0)
      }
    };
  }

  exportOperationalReport(options = {}, format = "pdf", session = null) {
    ensureDir(EXPORTS_DIR);
    const report = this.getOperationalReport(options, session);
    const fileName = `operational-report-${Date.now()}.html`;
    const filePath = path.join(EXPORTS_DIR, fileName);
    const html = `<!doctype html><html lang="it"><body><h1>Report operativo</h1><p>Appuntamenti: ${report.totals.appointments}</p><p>Completati: ${report.totals.completedAppointments}</p><p>Incasso: ${euro(report.totals.revenueCents)}</p></body></html>`;
    fs.writeFileSync(filePath, html);
    return { path: filePath, format, url: `/exports/${fileName}` };
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

  openExportsFolder() {
    ensureDir(EXPORTS_DIR);
    const entries = fs.readdirSync(EXPORTS_DIR).sort().reverse();
    return { success: true, url: entries[0] ? `/exports/${entries[0]}` : null };
  }

  getProfitabilityOverview(_options = {}, session = null) {
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const inventory = this.filterByCenter(this.inventoryRepository.list(), session);
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