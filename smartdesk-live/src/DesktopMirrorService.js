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
    return { start: toDateOnly(start), end: toDateOnlx(end) };
  }
  if (view === "month") {
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return { start: toDateOnlx(start), end: toDateOnlx(end) };
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
    start: toDateOnlx(start),
    end: toDateOnly(now),
    label: period === "day" ? "Oggi" : period === "week" ? "Ultimi 7 giorni" : "Ultimi 30 giorni"
  };
}

function shiftDate(dateValue, days) {
  const base = new Date(`${toDateOnlx(dateValue)}T00:00:00`);
  base.setDate(base.getDate() + Number(days || 0));
  return toDateOnlx(base);
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
  constructor(options = {}) {
    this.persistenceAdapter = options.persistenceAdapter || null;
    this.clientsRepository = this.createRepository("clients", []);
    this.appointmentsRepository = this.createRepository("appointments", []);
    this.servicesRepository = this.createRepository("services", []);
    this.staffRepository = this.createRepository("staff", []);
    this.shiftsRepository = this.createRepository("shifts", []);
    this.shiftTemplatesRepository = this.createRepository("shift_templates", []);
    this.resourcesRepository = this.createRepository("resources", []);
    this.inventoryRepository = this.createRepository("inventory", []);
    this.inventoryMovementsRepository = this.createRepository("inventory_movements", []);
    this.profitabilityExecutionsRepository = this.createRepository("profitability_executions", []);
    this.operatorIncentiveRulesRepository = this.createRepository("operator_incentive_rules", []);
    this.operatorIncentiveResultsRepository = this.createRepository("operator_incentive_results", []);
    this.paymentsRepository = this.createRepository("payments", []);
    this.treatmentsRepository = this.createRepository("treatments", []);
    this.usersRepository = this.createRepository("users", []);
    this.settingsRepository = this.createRepository("settings", defaultSettings);
    this.centerSettingsRepository = this.createRepository("settings_by_center", []);
    this.centerRepository = this.createRepository("center", {});
    this.salesRepository = this.createRepository("sales", []);
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
        { name: "profitability_executions", filePath: path.join(DATA_DIR, "profitability_executions.json"), defaultValue: [] },
        { name: "operator_incentive_rules", filePath: path.join(DATA_DIR, "operator_incentive_rules.json"), defaultValue: [] },
        { name: "operator_incentive_results", filePath: path.join(DATA_DIR, "operator_incentive_results.json"), defaultValue: [] },
        { name: "payments", filePath: path.join(DATA_DIR, "payments.json"), defaultValue: [] },
        { name: "treatments", filePath: path.join(DATA_DIR, "treatments.json"), defaultValue: [] },
        { name: "users", filePath: path.join(DATA_DIR, "users.json"), defaultValue: [] },
        { name: "settings", filePath: path.join(DATA_DIR, "settings.json"), defaultValue: defaultSettings },
        { name: "settings_by_center", filePath: path.join(DATA_DIR, "settings_by_center.json"), defaultValue: [] },
        { name: "center", filePath: path.join(DATA_DIR, "center.json"), defaultValue: {} },
        { name: "sales", filePath: path.join(DATA_DIR, "sales.json"), defaultValue: [] }
      ]);
    }
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
    