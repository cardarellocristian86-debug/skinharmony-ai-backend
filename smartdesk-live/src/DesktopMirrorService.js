const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JsonFileRepository } = require("./JsonFileRepository");

const DATA_DIR = path.resolve(process.cwd(), "data");
const EXPORTS_DIR = path.resolve(process.cwd(), "public", "exports");

const DEFAULT_CENTER_ID = "center_admin";
const DEFAULT_CENTER_NAME = "SkinHarmony Smart Desk";
const DEFAULT_ADMIN_USERNAME = "cristian";
const DEFAULT_ADMIN_PASSWORD = "fabiana88!";
const DEFAULT_TRIAL_DAYS = 7;
const DEFAULT_TRIAL_VERIFICATION_MINUTES = 30;

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

function addDaysIso(value, days) {
  const base = new Date(value || nowIso());
  const next = new Date(base.getTime() + Number(days || 0) * 86400000);
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
    const subscriptionPlan = String(user.subscriptionPlan || (String(user.role || "") === "superadmin" ? "gold" : "gold"));
    const paymentStatus = String(user.paymentStatus || (planType === "active" ? "paid" : "pending"));
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

  serializeUserSummary(user = {}) {
    const normalized = this.normalizeUserAccount(user);
    return {
      id: normalized.id,
      username: normalized.username,
      role: normalized.role,
      active: normalized.active,
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
      ownerName: normalized.ownerName || "",
      contactEmail: normalized.contactEmail || "",
      contactPhone: normalized.contactPhone || "",
      emailVerifiedAt: normalized.emailVerifiedAt || "",
      createdAt: normalized.createdAt || nowIso(),
      activatedAt: normalized.activatedAt || ""
    };
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
    const refreshed = this.buildSession({ ...user, id: user.id }, sessionToken, {
      username: current.supportMode ? (current.username || "") : undefined,
      role: current.supportMode ? (current.role || "superadmin") : undefined,
      supportMode: Boolean(current.supportMode),
      supportBy: current.supportBy || "",
      supportTargetUserId: current.supportTargetUserId || user.id,
      supportTargetUsername: current.supportTargetUsername || user.username || "",
      supportTargetRole: current.supportTargetRole || user.role || "owner"
    });
    this.sessions.set(sessionToken, refreshed);
    return refreshed;
  }

  logout(token) {
    this.sessions.delete(String(token || ""));
    return { success: true };
  }

  listAccessUsers(session = null) {
    const users = this.usersRepository.list();
    const visible = this.isSuperAdminSession(session)
      ? users
      : users.filter((item) => this.belongsToCenter(item, this.getCenterId(session)));
    return visible.map((item) => this.serializeUserSummary(item));
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
      subscriptionPlan: String(payload.subscriptionPlan || (String(payload.role || "") === "superadmin" ? "gold" : "gold")),
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
    return this.listAccessUsers(session).find((item) => item.id === user.id) || this.serializeUserSummary(user);
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
      if (payload.suspend === true) {
        merged.active = false;
        merged.accountStatus = "suspended";
      }
      if (payload.resetPassword) {
        merged.passwordHash = hashPassword(String(payload.resetPassword));
      }
      return this.normalizeUserAccount(merged);
    });
    return this.serializeUserSummary(next || current);
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
