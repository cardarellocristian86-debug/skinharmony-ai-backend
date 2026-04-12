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
    commands.push(`/F1 8 Tf ${margin} 28 Td (Pagina ${pageIndex + 1} di ${pages.length} - Documento consensi SkinHarmony Smart Desk) Tj`);
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
    this.protocolsRepository = this.createRepository("protocols", []);
    this.aiMarketingActionsRepository = this.createRepository("ai_marketing_actions", []);
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
      treatments: collections.treatments.length,
      sales: collections.sales.length,
      users: collections.users.length,
      storageBytes,
      storageLabel: formatBytes(storageBytes),
      activeSessions: sessions.length,
      supportSessions: sessions.filter((item) => item.supportMode).length
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
        { name: "protocols", filePath: path.join(DATA_DIR, "protocols.json"), defaultValue: [] },
        { name: "ai_marketing_actions", filePath: path.join(DATA_DIR, "ai_marketing_actions.json"), defaultValue: [] },
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

  listClients(search = "", session = null) {
    const query = String(search || "").trim().toLowerCase();
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    if (!query) return clients;
    return clients.filter((item) =>
      [item.name, item.phone, item.email].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }

  saveClient(payload = {}, session = null) {
    const providedName = String(payload.name || payload.fullName || "").trim();
    const split = splitName(providedName);
    const firstName = String(payload.firstName || split.firstName || "").trim();
    const lastName = String(payload.lastName || split.lastName || "").trim();
    const fullName = String(`${firstName} ${lastName}`.trim() || providedName || "Nuovo cliente");
    const now = nowIso();
    const centerId = this.getCenterId(session);
    const centerName = this.getCenterName(session);
    const entity = {
      id: payload.id || makeId("client"),
      centerId,
      centerName,
      firstName,
      lastName,
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
      privacyConsentAt: String(payload.privacyConsentAt || (payload.privacyConsent ? now : "")),
      marketingConsentAt: String(payload.marketingConsentAt || (payload.marketingConsent ? now : "")),
      sensitiveDataConsentAt: String(payload.sensitiveDataConsentAt || (payload.sensitiveDataConsent ? now : "")),
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
      walkInName: String(payload.walkInName || ""),
      walkInPhone: String(payload.walkInPhone || ""),
      staffId: String(payload.staffId || ""),
      staffName: String(payload.staffName || payload.operator || ""),
      serviceId: String(payload.serviceId || ""),
      serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : (payload.serviceId ? [String(payload.serviceId)] : []),
      serviceName: String(payload.serviceName || payload.service || ""),
      resourceId: String(payload.resourceId || ""),
      resourceName: String(payload.resourceName || payload.room || ""),
      startAt,
      endAt,
      status: String(payload.status || "requested"),
      notes: String(payload.notes || ""),
      durationMin,
      locked: payload.locked ? 1 : 0,
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
      estimatedProductCostCents: Number(payload.estimatedProductCostCents || payload.productCostCents || 0),
      technologyCostCents: Number(payload.technologyCostCents || 0),
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
      hourlyCostCents: Number(payload.hourlyCostCents || payload.hourlyCost || 0),
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

  listProtocols(clientId = "", session = null) {
    return this.filterByCenter(this.protocolsRepository.list(), session)
      .filter((item) => !clientId || item.clientId === clientId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  }

  saveProtocol(payload = {}, session = null) {
    const now = nowIso();
    const clientId = String(payload.clientId || "");
    const client = clientId ? this.findByIdInCenter(this.clientsRepository, clientId, session) : null;
    const entity = {
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      clientId,
      clientName: String(payload.clientName || (client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() : "")),
      title: String(payload.title || "Protocollo operativo"),
      objective: String(payload.objective || ""),
      area: String(payload.area || ""),
      sessionsCount: Number(payload.sessionsCount || 0),
      frequency: String(payload.frequency || ""),
      technologies: String(payload.technologies || ""),
      products: String(payload.products || ""),
      steps: String(payload.steps || ""),
      operatorNotes: String(payload.operatorNotes || payload.notes || ""),
      limitations: String(payload.limitations || "Protocollo operativo non medico. Nessuna diagnosi o promessa terapeutica."),
      source: String(payload.source || "manual"),
      status: String(payload.status || "draft"),
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
    return protocol;
  }

  deleteProtocol(id, session = null) {
    return this.deleteInCenter(this.protocolsRepository, id, session);
  }

  generateAiGoldProtocolDraft(payload = {}, session = null) {
    if (!this.hasGoldIntelligence(session)) {
      return {
        goldEnabled: false,
        message: "Protocollo AI disponibile solo con AI Gold.",
        draft: null
      };
    }
    const clientId = String(payload.clientId || "");
    const client = clientId ? this.findByIdInCenter(this.clientsRepository, clientId, session) : null;
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session)
      .filter((item) => !clientId || String(item.clientId || "") === clientId)
      .sort((a, b) => new Date(b.startAt || b.createdAt || 0).getTime() - new Date(a.startAt || a.createdAt || 0).getTime());
    const treatments = this.listTreatments(clientId, session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const inventory = this.filterByCenter(this.inventoryRepository.list(), session);
    const recentServices = appointments.slice(0, 5).map((appointment) => appointment.serviceName || services.find((service) => service.id === appointment.serviceId)?.name).filter(Boolean);
    const technologies = [
      ...new Set([
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
    const objective = String(payload.objective || "").trim() || (
      recentServices.length
        ? `Dare continuità ai servizi già eseguiti: ${recentServices.slice(0, 3).join(", ")}.`
        : "Costruire un percorso operativo progressivo dopo valutazione in cabina."
    );
    const draft = {
      clientId,
      clientName,
      title: String(payload.title || (clientName ? `Protocollo operativo ${clientName}` : "Protocollo operativo AI Gold")),
      objective,
      area: String(payload.area || "Da definire in cabina"),
      sessionsCount: Number(payload.sessionsCount || (recentServices.length ? 4 : 3)),
      frequency: String(payload.frequency || "1 seduta ogni 7/14 giorni, da confermare dopo risposta del cliente."),
      technologies: technologies.length ? technologies.join(", ") : "Tecnologia da scegliere tra quelle attive nel centro.",
      products: products.length ? products.join(", ") : "Prodotti da selezionare in base a disponibilità e scheda cliente.",
      steps: [
        "1. Verifica scheda cliente, consensi, preferenze e note operative.",
        "2. Esegui prima seduta con parametri conservativi e registra risposta cliente.",
        "3. Conferma frequenza e continuità solo dopo valutazione dell’operatore.",
        "4. Aggiorna note, prodotti usati e prossimo richiamo."
      ].join("\n"),
      operatorNotes: [
        appointments.length ? `Storico letto: ${appointments.length} appuntamenti collegati.` : "Storico appuntamenti non sufficiente.",
        treatments.length ? `Trattamenti registrati: ${treatments.length}.` : "Nessuna scheda trattamento registrata.",
        "La bozza va controllata e modificata dall’operatore prima del salvataggio."
      ].join("\n"),
      limitations: "Bozza operativa non medica. Non contiene diagnosi, promesse terapeutiche o garanzie di risultato.",
      source: "ai_gold",
      status: "draft"
    };
    return {
      goldEnabled: true,
      message: "AI Gold ha preparato una bozza protocollo. Controlla i campi e salva solo se coerente.",
      draft
    };
  }

  listPayments(clientId = "", session = null) {
    return this.filterByCenter(this.paymentsRepository.list(), session).filter((item) => !clientId || item.clientId === clientId);
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
      const anchor = new Date(`${anchorDate}T00:00:00`);
      const diffToMonday = (anchor.getDay() + 6) % 7;
      const start = new Date(anchor);
      start.setDate(anchor.getDate() - diffToMonday);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      startDate = toDateOnly(start.toISOString());
      endDate = toDateOnly(end.toISOString());
    } else if (mode === "month") {
      const anchor = new Date(`${anchorDate}T00:00:00`);
      startDate = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-01`;
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      endDate = toDateOnly(end.toISOString());
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
      byMethod[method] = (byMethod[method] || 0) + amountCents;
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
      byMethod: Object.entries(byMethod).map(([method, amountCents]) => ({ method, amountCents })),
      byDay: Object.entries(byDay)
        .map(([date, amountCents]) => ({ date, amountCents }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date))),
      recentPayments: payments.slice(0, 12).map((payment) => ({
        ...payment,
        clientName: payment.clientId ? clientNames.get(String(payment.clientId)) || "Cliente" : payment.walkInName || "Cliente occasionale"
      }))
    };
  }

  createPayment(payload = {}, session = null) {
    const payment = {
      id: makeId("pay"),
      centerId: this.getCenterId(session),
      centerName: this.getCenterName(session),
      clientId: String(payload.clientId || ""),
      walkInName: String(payload.walkInName || ""),
      appointmentId: String(payload.appointmentId || ""),
      amountCents: Number(payload.amountCents || payload.amount || 0),
      method: String(payload.method || "cash"),
      description: String(payload.description || payload.note || ""),
      note: String(payload.note || payload.description || ""),
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
    const now = Date.now();
    const inactiveClients = clients.map((client) => {
      const clientId = String(client.id || "");
      const clientAppointments = appointments
        .filter((item) => String(item.clientId || "") === clientId)
        .sort((a, b) => new Date(b.startAt || b.createdAt || 0).getTime() - new Date(a.startAt || a.createdAt || 0).getTime());
      const lastAppointment = clientAppointments[0] || null;
      const lastVisitAt = lastAppointment?.startAt || client.lastVisit || "";
      const daysSinceLastVisit = lastVisitAt
        ? Math.max(0, Math.floor((now - new Date(lastVisitAt).getTime()) / 86400000))
        : 999;
      return {
        clientId,
        name: `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "Cliente",
        phone: client.phone || "",
        daysSinceLastVisit
      };
    })
      .filter((item) => item.daysSinceLastVisit >= 30)
      .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);
    const revenueCents = payments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    return {
      todayAppointments: todayAppointments.length,
      inactiveClientsCount: inactiveClients.length,
      inactiveClients,
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

  getProfitabilityOverview(options = {}, session = null) {
    const startDate = String(options.startDate || "");
    const endDate = String(options.endDate || "");
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
    const serviceById = new Map(services.map((item) => [String(item.id), item]));
    const staffById = new Map(staff.map((item) => [String(item.id), item]));
    const inventoryCostAverage = inventory.length
      ? Math.round(inventory.reduce((sum, item) => sum + Number(item.costCents || 0), 0) / inventory.length)
      : 0;
    const serviceMap = new Map();
    const monthlyMap = new Map();
    appointments.forEach((appointment) => {
      const service = serviceById.get(String(appointment.serviceId || "")) || {};
      const serviceId = String(service.id || appointment.serviceId || "unknown");
      const current = serviceMap.get(serviceId) || {
        id: serviceId,
        name: service.name || appointment.serviceName || "Servizio non configurato",
        executions: 0,
        revenueCents: 0,
        costCents: 0,
        profitCents: 0,
        marginPercent: 0,
        status: "HEALTHY"
      };
      const linkedPayments = payments.filter((payment) => String(payment.appointmentId || "") === String(appointment.id || ""));
      const revenueCents = linkedPayments.length
        ? linkedPayments.reduce((sum, payment) => sum + Number(payment.amountCents || 0), 0)
        : Number(service.priceCents || appointment.priceCents || 0);
      const operator = staffById.get(String(appointment.staffId || ""));
      const durationMin = Number(appointment.durationMin || service.durationMin || 60);
      const operatorCostCents = Math.round((Number(operator?.hourlyCostCents || 0) / 60) * durationMin);
      const productCostCents = Number(service.estimatedProductCostCents || service.productCostCents || inventoryCostAverage || 0);
      const technologyCostCents = Number(service.technologyCostCents || 0);
      const costCents = operatorCostCents + productCostCents + technologyCostCents;
      const monthKey = String(appointment.startAt || appointment.createdAt || "").slice(0, 7) || "senza-data";
      const monthly = monthlyMap.get(monthKey) || {
        month: monthKey,
        executions: 0,
        revenueCents: 0,
        costCents: 0,
        profitCents: 0,
        marginPercent: 0,
        deltaRevenueCents: 0,
        signal: "stable"
      };
      current.executions += 1;
      current.revenueCents += revenueCents;
      current.costCents += costCents;
      current.profitCents += revenueCents - costCents;
      monthly.executions += 1;
      monthly.revenueCents += revenueCents;
      monthly.costCents += costCents;
      monthly.profitCents += revenueCents - costCents;
      serviceMap.set(serviceId, current);
      monthlyMap.set(monthKey, monthly);
    });
    const serviceRows = Array.from(serviceMap.values()).map((item) => {
      const marginPercent = item.revenueCents > 0 ? Math.round((item.profitCents / item.revenueCents) * 100) : 0;
      const status = item.profitCents < 0 ? "LOSS" : marginPercent < 30 ? "LOW_MARGIN" : "HEALTHY";
      return { ...item, marginPercent, status };
    }).sort((a, b) => a.marginPercent - b.marginPercent);
    const totals = serviceRows.reduce((summary, item) => ({
      executions: summary.executions + Number(item.executions || 0),
      revenueCents: summary.revenueCents + Number(item.revenueCents || 0),
      costCents: summary.costCents + Number(item.costCents || 0),
      profitCents: summary.profitCents + Number(item.profitCents || 0)
    }), { executions: 0, revenueCents: 0, costCents: 0, profitCents: 0 });
    const monthlyTrend = Array.from(monthlyMap.values())
      .sort((a, b) => String(a.month).localeCompare(String(b.month)))
      .map((item, index, rows) => {
        const marginPercent = item.revenueCents > 0 ? Math.round((item.profitCents / item.revenueCents) * 100) : 0;
        const previous = rows[index - 1];
        const deltaRevenueCents = previous ? item.revenueCents - Number(previous.revenueCents || 0) : 0;
        const signal = deltaRevenueCents <= -300000
          ? "drop"
          : deltaRevenueCents >= 300000
            ? "growth"
            : "stable";
        return {
          ...item,
          marginPercent,
          deltaRevenueCents,
          signal
        };
      });
    const alerts = serviceRows
      .filter((item) => item.status !== "HEALTHY")
      .map((item) => ({
        area: "servizi",
        level: item.status === "LOSS" ? "critical" : "warning",
        title: item.status === "LOSS" ? `${item.name} lavora in perdita` : `${item.name} ha margine basso`,
        body: item.status === "LOSS"
          ? "Controlla prezzo, durata, costo operatore e prodotti usati prima di proporlo ancora."
          : "Il servizio rende poco rispetto al ricavo: verifica durata reale e consumo prodotti.",
        serviceId: item.id
      }));
    return {
      totals,
      services: serviceRows,
      products: [],
      technologies: [],
      monthlyTrend,
      alerts,
      revenueCents: totals.revenueCents,
      inventoryCostCents: totals.costCents
    };
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
    const now = Date.now();
    const clients = this.filterByCenter(this.clientsRepository.list(), session);
    const appointments = this.filterByCenter(this.appointmentsRepository.list(), session);
    const payments = this.filterByCenter(this.paymentsRepository.list(), session);
    const services = this.filterByCenter(this.servicesRepository.list(), session);
    const serviceById = new Map(services.map((item) => [String(item.id), item]));
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
    const suggestions = clients.map((client) => {
      const clientId = String(client.id || "");
      const displayName = cleanDisplayName(client);
      const clientAppointments = appointments
        .filter((item) => String(item.clientId || "") === clientId)
        .sort((a, b) => new Date(a.startAt || a.createdAt || 0).getTime() - new Date(b.startAt || b.createdAt || 0).getTime());
      const lastAppointment = clientAppointments[clientAppointments.length - 1] || null;
      const lastVisitAt = lastAppointment?.startAt || client.lastVisit || client.updatedAt || client.createdAt || "";
      const daysSinceLastVisit = lastVisitAt ? Math.max(0, Math.floor((now - new Date(lastVisitAt).getTime()) / 86400000)) : 999;
      const gaps = clientAppointments.slice(1).map((item, index) => {
        const previous = clientAppointments[index];
        return Math.max(1, Math.round((new Date(item.startAt || 0).getTime() - new Date(previous.startAt || 0).getTime()) / 86400000));
      }).filter((value) => Number.isFinite(value));
      const averageFrequencyDays = gaps.length ? Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length) : 45;
      const totalSpentCents = payments
        .filter((item) => String(item.clientId || "") === clientId)
        .reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
      const lastService = lastAppointment ? serviceById.get(String(lastAppointment.serviceId || "")) : null;
      const hasMarketingConsent = Boolean(client.marketingConsent);
      const segment = totalSpentCents >= 50000
        ? "top_cliente"
        : daysSinceLastVisit >= 90
          ? "perso"
          : daysSinceLastVisit >= Math.max(45, averageFrequencyDays + 15)
            ? "a_rischio"
            : "attivo";
      const priority = !hasMarketingConsent
        ? "media"
        : segment === "perso"
          ? "alta"
          : segment === "a_rischio" || totalSpentCents >= 50000
            ? "alta"
            : daysSinceLastVisit >= 30
              ? "media"
              : "bassa";
      const firstName = String(client.firstName || client.name || "Cliente").trim().split(/\s+/)[0] || "Cliente";
      const motive = !hasMarketingConsent
        ? "Consenso marketing non confermato: contatto solo se autorizzato."
        : lastService?.name
          ? `Richiamo legato a ${lastService.name}.`
          : "Richiamo di mantenimento per continuità cliente.";
      const signal = serviceSignal(lastService?.name || "", displayName);
      const greeting = usableFirstName(displayName) ? `Ciao ${usableFirstName(displayName)}` : "Ciao";
      const timing = daysSinceLastVisit >= 90
        ? `sono passati ${daysSinceLastVisit} giorni dall'ultimo appuntamento`
        : `è il momento giusto per rivedere il percorso`;
      return {
        clientId,
        name: displayName,
        phone: client.phone || "",
        daysSinceLastVisit,
        averageFrequencyDays,
        segment,
        priority,
        motive: hasMarketingConsent ? signal.motive : motive,
        lastServiceName: lastService?.name || "",
        hasMarketingConsent,
        suggestedPush: signal.push,
        message: hasMarketingConsent
          ? `${greeting}, ${timing}. Ti proporrei ${signal.proposal}: così controlliamo insieme cosa conviene fare adesso, senza aspettare che il risultato perda forza. Vuoi che ti riservi uno slot questa settimana o la prossima?`
          : `Prima di inviare messaggi marketing a ${firstName}, verifica e registra il consenso marketing nella scheda cliente.`
      };
    }).filter((item) => item.daysSinceLastVisit >= 30 || item.segment !== "attivo")
      .sort((a, b) => {
        const weight = { alta: 3, media: 2, bassa: 1 };
        return (weight[b.priority] || 0) - (weight[a.priority] || 0) || b.daysSinceLastVisit - a.daysSinceLastVisit;
      })
      .slice(0, 20);
    return {
      goldEnabled: true,
      generatedAt: nowIso(),
      suggestions
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
    const actions = this.filterByCenter(this.aiMarketingActionsRepository.list(), session)
      .sort((a, b) => {
        const priorityRank = { alta: 3, media: 2, bassa: 1 };
        const statusRank = { to_approve: 4, approved: 3, copied: 2, done: 1, archived: 0 };
        return (priorityRank[String(b.priority || "")] || 0) - (priorityRank[String(a.priority || "")] || 0)
          || (statusRank[String(b.status || "")] || 0) - (statusRank[String(a.status || "")] || 0)
          || new Date(b.generatedAt || b.createdAt || 0).getTime() - new Date(a.generatedAt || a.createdAt || 0).getTime();
      });
    return {
      goldEnabled: true,
      generatedAt: nowIso(),
      actions,
      summary: {
        total: actions.length,
        pending: actions.filter((item) => ["new", "to_approve", "approved"].includes(String(item.status || ""))).length,
        done: actions.filter((item) => item.status === "done").length,
        archived: actions.filter((item) => item.status === "archived").length
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
    const insight = this.getAiGoldMarketing(session);
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
        segment: suggestion.segment || "",
        reason: suggestion.motive || "Richiamo suggerito da AI Gold.",
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
    const allowed = new Set(["to_approve", "approved", "copied", "done", "archived"]);
    const status = String(payload.status || "").toLowerCase();
    if (!allowed.has(status)) {
      throw new Error("Stato azione non valido");
    }
    const updated = this.updateInCenter(this.aiMarketingActionsRepository, actionId, (current) => ({
      ...current,
      status,
      updatedAt: nowIso(),
      approvedAt: status === "approved" ? nowIso() : current.approvedAt || "",
      copiedAt: status === "copied" ? nowIso() : current.copiedAt || "",
      completedAt: status === "done" ? nowIso() : current.completedAt || "",
      archivedAt: status === "archived" ? nowIso() : current.archivedAt || ""
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

  getAiGoldProfitability(options = {}, session = null) {
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
    const overview = this.getProfitabilityOverview(options, session);
    const suggestions = overview.services.map((service) => {
      const status = String(service.status || "HEALTHY");
      const suggestion = status === "LOSS"
        ? "Verifica prezzo, durata, costo operatore e consumo prodotti: il servizio rischia di lavorare in perdita."
        : status === "LOW_MARGIN"
          ? "Margine basso: controlla durata reale e prodotti usati prima di spingere il servizio."
          : "Servizio sano: puoi mantenerlo o usarlo come riferimento commerciale.";
      return {
        id: service.id,
        name: service.name || "Servizio",
        executions: Number(service.executions || 0),
        revenueCents: Number(service.revenueCents || 0),
        costCents: Number(service.costCents || 0),
        profitCents: Number(service.profitCents || 0),
        marginPercent: Number(service.marginPercent || 0),
        status,
        suggestion
      };
    }).sort((a, b) => a.marginPercent - b.marginPercent);
    const alerts = suggestions
      .filter((item) => item.status !== "HEALTHY")
      .map((item) => ({
        level: item.status === "LOSS" ? "critical" : "warning",
        title: item.status === "LOSS" ? `${item.name} in perdita` : `${item.name} con margine basso`,
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
}

module.exports = {
  DesktopMirrorService,
  defaultSettings
};
