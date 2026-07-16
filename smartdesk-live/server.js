const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { resolveBridgeScope, hasExplicitBridgeScope } = require("./src/TenantIsolation");
const nodemailer = require("nodemailer");
const { DesktopMirrorService } = require("./src/DesktopMirrorService");
const { AssistantService } = require("./src/AssistantService");
const { CoreliaBridge } = require("./src/corelia/CoreliaBridge");
const { NyraDialogueAdapter } = require("./src/nyra/NyraDialogueAdapter");
const { PostgresPersistenceAdapter } = require("./src/PostgresPersistenceAdapter");
const { WhatsappService } = require("./src/WhatsappService");
const { SuiteAppKeyBridge } = require("./src/SuiteAppKeyBridge");
const { UniversalCoreBridge } = require("./src/UniversalCoreBridge");
const { cockpit360Contract } = require("./src/Cockpit360Contract");
const { computeAppointmentProfitability } = require("./src/core/profitability/ProfitabilityCore");

const app = express();
let service = null;
let assistantService = null;
let coreliaBridge = null;
let nyraDialogue = null;
let whatsappService = null;
let suiteAppKeyBridge = null;
let universalCoreBridge = null;
const publicDir = path.resolve(__dirname, "public");
app.set("trust proxy", 1);

const rateLimitBuckets = new Map();
const safeModeMonitor = {
  activeRequests: 0,
  activeRequestStartedAt: new Map(),
  nextRequestId: 1,
  samples: [],
  active: false,
  enteredAt: 0,
  lastChangedAt: 0,
  lastReason: "",
  thresholds: {
    windowMs: Number(process.env.SAFE_MODE_WINDOW_MS || 45000),
    minSamples: Number(process.env.SAFE_MODE_MIN_SAMPLES || 40),
    p95Ms: Number(process.env.SAFE_MODE_P95_MS || 3000),
    avgMs: Number(process.env.SAFE_MODE_AVG_MS || 1200),
    errorRate: Number(process.env.SAFE_MODE_ERROR_RATE || 1),
    concurrentRequests: Number(process.env.SAFE_MODE_CONCURRENT_REQUESTS || 70),
    activeRequestAgeMs: Number(process.env.SAFE_MODE_ACTIVE_REQUEST_AGE_MS || 8000),
    oldestActiveRequestMs: Number(process.env.SAFE_MODE_OLDEST_ACTIVE_REQUEST_MS || 12000),
    slowActiveRequests: Number(process.env.SAFE_MODE_SLOW_ACTIVE_REQUESTS || 8),
    requestRatePerSecond: Number(process.env.SAFE_MODE_REQUEST_RATE_PER_SECOND || 12),
    burstSamples: Number(process.env.SAFE_MODE_BURST_SAMPLES || 450),
    minActiveMs: Number(process.env.SAFE_MODE_MIN_ACTIVE_MS || 90000),
    recoveryMs: Number(process.env.SAFE_MODE_RECOVERY_MS || 60000)
  }
};

function isSafeModeForced() {
  return ["1", "true", "yes", "on"].includes(String(process.env.SAFE_MODE_FORCE || "").toLowerCase());
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function safeModeSnapshot(now = Date.now()) {
  const windowMs = safeModeMonitor.thresholds.windowMs;
  safeModeMonitor.samples = safeModeMonitor.samples.filter((item) => now - item.at <= windowMs);
  const samples = safeModeMonitor.samples;
  const durations = samples.map((item) => item.ms);
  const errors = samples.filter((item) => item.status >= 500 || item.error).length;
  const activeAges = Array.from(safeModeMonitor.activeRequestStartedAt.values())
    .map((startedAt) => now - startedAt)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const slowActiveRequests = activeAges.filter((age) => age >= safeModeMonitor.thresholds.activeRequestAgeMs).length;
  const avgMs = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
  const p95Ms = Math.round(percentile(durations, 95));
  const errorRate = samples.length ? Number(((errors / samples.length) * 100).toFixed(2)) : 0;
  const requestRatePerSecond = Number((samples.length / Math.max(1, windowMs / 1000)).toFixed(2));
  return {
    active: safeModeMonitor.active || isSafeModeForced(),
    forced: isSafeModeForced(),
    activeRequests: safeModeMonitor.activeRequests,
    slowActiveRequests,
    oldestActiveRequestMs: activeAges.length ? Math.round(Math.max(...activeAges)) : 0,
    sampleCount: samples.length,
    requestRatePerSecond,
    avgMs,
    p95Ms,
    errorRate,
    enteredAt: safeModeMonitor.enteredAt ? new Date(safeModeMonitor.enteredAt).toISOString() : "",
    lastChangedAt: safeModeMonitor.lastChangedAt ? new Date(safeModeMonitor.lastChangedAt).toISOString() : "",
    reason: safeModeMonitor.lastReason,
    thresholds: safeModeMonitor.thresholds
  };
}

function evaluateSafeMode() {
  if (isSafeModeForced()) {
    if (!safeModeMonitor.active) {
      const now = Date.now();
      safeModeMonitor.active = true;
      safeModeMonitor.enteredAt = now;
      safeModeMonitor.lastChangedAt = now;
      safeModeMonitor.lastReason = "forzata da SAFE_MODE_FORCE";
      console.warn("[safe-mode] attiva: forzata da SAFE_MODE_FORCE");
    }
    return;
  }
  const now = Date.now();
  const snapshot = safeModeSnapshot(now);
  const reasons = [];
  const enoughSamples = snapshot.sampleCount >= safeModeMonitor.thresholds.minSamples;
  if (safeModeMonitor.activeRequests >= safeModeMonitor.thresholds.concurrentRequests) {
    reasons.push(`concorrenza ${safeModeMonitor.activeRequests} >= ${safeModeMonitor.thresholds.concurrentRequests}`);
  }
  if (snapshot.slowActiveRequests >= safeModeMonitor.thresholds.slowActiveRequests) {
    reasons.push(`richieste lente attive ${snapshot.slowActiveRequests} >= ${safeModeMonitor.thresholds.slowActiveRequests}`);
  }
  if (snapshot.sampleCount >= safeModeMonitor.thresholds.burstSamples) {
    reasons.push(`burst API ${snapshot.sampleCount} campioni >= ${safeModeMonitor.thresholds.burstSamples}`);
  }
  if (snapshot.requestRatePerSecond >= safeModeMonitor.thresholds.requestRatePerSecond && snapshot.sampleCount >= safeModeMonitor.thresholds.minSamples) {
    reasons.push(`pressione API ${snapshot.requestRatePerSecond}/s >= ${safeModeMonitor.thresholds.requestRatePerSecond}/s`);
  }
  if (
    snapshot.oldestActiveRequestMs >= safeModeMonitor.thresholds.oldestActiveRequestMs &&
    safeModeMonitor.activeRequests >= Math.max(5, Math.floor(safeModeMonitor.thresholds.slowActiveRequests / 2))
  ) {
    reasons.push(`richiesta attiva da ${snapshot.oldestActiveRequestMs}ms >= ${safeModeMonitor.thresholds.oldestActiveRequestMs}ms`);
  }
  if (enoughSamples && snapshot.p95Ms >= safeModeMonitor.thresholds.p95Ms) {
    reasons.push(`p95 ${snapshot.p95Ms}ms >= ${safeModeMonitor.thresholds.p95Ms}ms`);
  }
  if (enoughSamples && snapshot.avgMs >= safeModeMonitor.thresholds.avgMs) {
    reasons.push(`avg ${snapshot.avgMs}ms >= ${safeModeMonitor.thresholds.avgMs}ms`);
  }
  if (enoughSamples && snapshot.errorRate >= safeModeMonitor.thresholds.errorRate) {
    reasons.push(`errorRate ${snapshot.errorRate}% >= ${safeModeMonitor.thresholds.errorRate}%`);
  }

  if (reasons.length && !safeModeMonitor.active) {
    safeModeMonitor.active = true;
    safeModeMonitor.enteredAt = now;
    safeModeMonitor.lastChangedAt = now;
    safeModeMonitor.lastReason = reasons.join("; ");
    console.warn(`[safe-mode] attiva: ${safeModeMonitor.lastReason}`);
    return;
  }

  if (!safeModeMonitor.active) return;
  const activeLongEnough = now - safeModeMonitor.enteredAt >= safeModeMonitor.thresholds.minActiveMs;
  const recovered = !reasons.length && now - safeModeMonitor.lastChangedAt >= safeModeMonitor.thresholds.recoveryMs;
  if (activeLongEnough && recovered) {
    safeModeMonitor.active = false;
    safeModeMonitor.lastChangedAt = now;
    safeModeMonitor.lastReason = "rientro sotto soglia";
    console.warn("[safe-mode] disattiva: rientro sotto soglia");
  }
}

function isSafeModeActive() {
  evaluateSafeMode();
  return safeModeMonitor.active || isSafeModeForced();
}

function safeModePayload(message = "Sistema sotto carico: operazione temporaneamente limitata per mantenere operatività") {
  return {
    success: false,
    code: "safe_mode_active",
    safeMode: safeModeSnapshot(),
    message
  };
}

function recordApiSample({ requestId, startedAt, status, error = false }) {
  const endedAt = Date.now();
  safeModeMonitor.activeRequestStartedAt.delete(requestId);
  safeModeMonitor.activeRequests = Math.max(0, safeModeMonitor.activeRequests - 1);
  safeModeMonitor.samples.push({
    at: endedAt,
    ms: endedAt - startedAt,
    status: Number(status || 0),
    error: Boolean(error || Number(status || 0) >= 500)
  });
  evaluateSafeMode();
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function createRateLimiter({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${clientIp(req)}:${String(req.body?.username || req.body?.contactEmail || req.body?.email || "").toLowerCase()}`;
    const current = rateLimitBuckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    rateLimitBuckets.set(key, bucket);
    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        code: "rate_limited",
        message: "Troppe richieste ravvicinate. Attendi qualche minuto e riprova."
      });
    }
    return next();
  };
}

const loginRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: "login" });
const trialRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: "trial" });
const passwordRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 8, keyPrefix: "password" });

function trialMailConfigured() {
  return Boolean(
    process.env.TRIAL_SMTP_HOST &&
    process.env.TRIAL_SMTP_PORT &&
    process.env.TRIAL_MAIL_FROM &&
    process.env.TRIAL_SMTP_USER &&
    process.env.TRIAL_SMTP_PASS
  );
}

async function sendTrialVerificationMail({ email, centerName, ownerName, verificationUrl }) {
  if (!trialMailConfigured()) {
    return { status: "disabled" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.TRIAL_SMTP_HOST,
    port: Number(process.env.TRIAL_SMTP_PORT || 587),
    secure: String(process.env.TRIAL_SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.TRIAL_SMTP_USER,
      pass: process.env.TRIAL_SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.TRIAL_MAIL_FROM,
    to: email,
    subject: "Verifica il tuo accesso Smart Desk",
    html: `
      <div style="font-family:Arial,sans-serif;color:#163747;line-height:1.6">
        <h2 style="margin:0 0 12px">Completa l'attivazione del tuo accesso</h2>
        <p>Ciao ${ownerName || "team"}, abbiamo ricevuto la richiesta di prova per <strong>${centerName}</strong>.</p>
        <p>Per confermare la tua email e attivare la prova gratuita, usa questo link sicuro:</p>
        <p><a href="${verificationUrl}" style="display:inline-block;padding:12px 18px;border-radius:14px;background:#2a8ec4;color:#fff;text-decoration:none;font-weight:700">Conferma la tua email</a></p>
        <p style="margin:12px 0 0">Se il pulsante non si apre correttamente, copia e incolla questo link:</p>
        <p style="word-break:break-all;color:#2a8ec4">${verificationUrl}</p>
        <p style="margin-top:16px">Il link scade automaticamente e può essere usato una sola volta.</p>
      </div>
    `
  });
  return { status: "sent" };
}

function appBaseUrl(req) {
  return String(process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`);
}

async function sendTrialWelcomeMail({ email, centerName, username, trialEndsAt }) {
  if (!trialMailConfigured()) {
    return { status: "disabled" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.TRIAL_SMTP_HOST,
    port: Number(process.env.TRIAL_SMTP_PORT || 587),
    secure: String(process.env.TRIAL_SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.TRIAL_SMTP_USER,
      pass: process.env.TRIAL_SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.TRIAL_MAIL_FROM,
    to: email,
    subject: "Benvenuto in Smart Desk",
    html: `
      <div style="font-family:Arial,sans-serif;color:#163747;line-height:1.6">
        <h2 style="margin:0 0 12px">Benvenuto in Smart Desk</h2>
        <p>La prova del centro <strong>${centerName}</strong> è attiva.</p>
        <p><strong>Username:</strong> ${username}</p>
        <p><strong>Scadenza prova:</strong> ${trialEndsAt ? new Date(trialEndsAt).toLocaleDateString("it-IT") : "non disponibile"}</p>
        <p>Puoi accedere qui: <a href="${process.env.APP_BASE_URL || "https://skinharmony-smartdesk-live.onrender.com"}/login">Apri login</a></p>
      </div>
    `
  });
  return { status: "sent" };
}

async function sendPasswordResetMail({ email, resetUrl }) {
  if (!trialMailConfigured()) {
    return { status: "disabled" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.TRIAL_SMTP_HOST,
    port: Number(process.env.TRIAL_SMTP_PORT || 587),
    secure: String(process.env.TRIAL_SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.TRIAL_SMTP_USER,
      pass: process.env.TRIAL_SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.TRIAL_MAIL_FROM,
    to: email,
    subject: "Reimposta la tua password Smart Desk",
    html: `
      <div style="font-family:Arial,sans-serif;color:#163747;line-height:1.6">
        <h2 style="margin:0 0 12px">Richiesta cambio password</h2>
        <p>Abbiamo ricevuto una richiesta di reimpostazione password per il tuo account Smart Desk.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:14px;background:#2a8ec4;color:#fff;text-decoration:none;font-weight:700">Imposta una nuova password</a></p>
        <p style="margin:12px 0 0">Se il pulsante non si apre correttamente, copia e incolla questo link:</p>
        <p style="word-break:break-all;color:#2a8ec4">${resetUrl}</p>
        <p>Se non hai richiesto tu questa operazione, ignora la mail.</p>
      </div>
    `
  });
  return { status: "sent" };
}

async function sendPasswordChangedMail({ email }) {
  if (!trialMailConfigured()) {
    return { status: "disabled" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.TRIAL_SMTP_HOST,
    port: Number(process.env.TRIAL_SMTP_PORT || 587),
    secure: String(process.env.TRIAL_SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.TRIAL_SMTP_USER,
      pass: process.env.TRIAL_SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.TRIAL_MAIL_FROM,
    to: email,
    subject: "Password Smart Desk aggiornata",
    html: `
      <div style="font-family:Arial,sans-serif;color:#163747;line-height:1.6">
        <h2 style="margin:0 0 12px">Password aggiornata</h2>
        <p>La password del tuo account Smart Desk è stata modificata correttamente.</p>
        <p>Se non hai effettuato tu questa operazione, contatta subito SkinHarmony.</p>
      </div>
    `
  });
  return { status: "sent" };
}

function readToken(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

function readBridgeKey(req) {
  const headerKey = String(req.headers["x-skinharmony-bridge-key"] || "").trim();
  if (headerKey) return headerKey;
  return readToken(req).trim();
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function parseBridgeKeyRecords() {
  const rawJson = String(process.env.SMARTDESK_BRIDGE_KEYS_JSON || "").trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  const legacyKey = String(process.env.SMARTDESK_BRIDGE_API_KEY || "").trim();
  if (!legacyKey) return [];
  return [{
    id: "legacy_bridge_key",
    label: "Legacy Smart Desk Bridge key",
    keyHash: hashSecret(legacyKey),
    plan: "legacy",
    scopes: ["health", "waas_bridge"]
  }];
}

function findBridgeAccess(req) {
  const providedKey = readBridgeKey(req);
  if (!providedKey) {
    return { ok: false, code: "missing_bridge_key" };
  }

  const providedHash = hashSecret(providedKey);
  const now = new Date();
  const records = parseBridgeKeyRecords();
  for (const record of records) {
    const keyHash = String(record.keyHash || record.key_hash || "").trim();
    if (!keyHash || keyHash.length !== providedHash.length) continue;
    if (!crypto.timingSafeEqual(Buffer.from(keyHash), Buffer.from(providedHash))) continue;

    const expiresAt = String(record.expiresAt || record.expires_at || "").trim();
    if (expiresAt && Number.isFinite(Date.parse(expiresAt)) && new Date(expiresAt) < now) {
      return { ok: false, code: "bridge_key_expired", id: record.id || "" };
    }
    if (String(process.env.SMARTDESK_REQUIRE_SCOPED_BRIDGE_KEYS || "").toLowerCase() === "true" && !hasExplicitBridgeScope(record)) {
      return { ok: false, code: "bridge_scope_required", id: record.id || "" };
    }

    return {
      ok: true,
      id: record.id || "bridge_key",
      label: record.label || record.name || "Smart Desk Bridge",
      plan: record.plan || "annual",
      expiresAt,
      scopes: Array.isArray(record.scopes) ? record.scopes : ["health", "waas_bridge"],
      scopeBound: hasExplicitBridgeScope(record),
      ...resolveBridgeScope(record, {
        tenantId: process.env.UNIVERSAL_CORE_TENANT_ID || "smartdesk-skinharmony",
        centerId: service?.getCenterId?.() || "center_admin",
        centerName: service?.getCenterName?.() || "Privilege Parrucchieri"
      })
    };
  }

  return { ok: false, code: "invalid_bridge_key" };
}

function bridgeSession(bridge = {}) {
  const scope = resolveBridgeScope(bridge, {
    tenantId: process.env.UNIVERSAL_CORE_TENANT_ID || "smartdesk-skinharmony",
    centerId: service?.getCenterId?.() || "center_admin",
    centerName: service?.getCenterName?.() || "Privilege Parrucchieri"
  });
  return {
    role: "superadmin",
    username: "nyra_bridge",
    tenantId: scope.tenantId,
    centerId: scope.centerId,
    centerName: scope.centerName,
    subscriptionPlan: "gold",
    accessState: "active"
  };
}

function bridgeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bridgeMoney(row, keys = []) {
  for (const key of keys) {
    const value = bridgeNumber(row?.[key]);
    if (value === null) continue;
    return key.toLowerCase().endsWith("cents") ? value / 100 : value;
  }
  return null;
}

function buildNyraBridgeSnapshot(bridge) {
  const session = bridgeSession(bridge);
  const tenantId = session.tenantId;
  const centerId = session.centerId;
  const scope = { tenant_id: tenantId, center_id: centerId };
  const scoped = (repository) => service.getCenterRepositoryItems(repository, centerId);
  const clients = scoped(service.clientsRepository);
  const appointments = scoped(service.appointmentsRepository);
  const treatments = scoped(service.treatmentsRepository);
  const sales = scoped(service.salesRepository);
  const payments = scoped(service.paymentsRepository);
  const services = scoped(service.servicesRepository);
  const staff = scoped(service.staffRepository);
  const resources = scoped(service.resourcesRepository);
  const inventory = scoped(service.inventoryRepository);
  const consentEvents = clients
    .filter((client) => client.consentStatus === "granted" || client.consentGiven === true || client.consentAt)
    .map((client) => ({
      ...scope,
      stage: "consent",
      event_type: "consent_granted",
      status: "ready",
      source: "smartdesk",
      external_event_id: `consent:${client.id}`,
      profile_external_id: client.id,
      occurred_at: client.consentAt || client.updatedAt || client.createdAt || new Date().toISOString(),
      metadata: { consent_basis: client.consentBasis || "smartdesk_record" }
    }));
  const bookingEvents = appointments
    .filter((appointment) => appointment.clientId)
    .filter((appointment) => !["cancelled", "no_show"].includes(String(appointment.status || "").toLowerCase()))
    .map((appointment) => ({
      ...scope,
      stage: "booking",
      event_type: "booking_recorded",
      status: ["completed", "confirmed", "booked", "scheduled"].includes(String(appointment.status || "").toLowerCase()) ? "ready" : "pending",
      source: "smartdesk",
      external_event_id: `booking:${appointment.id}`,
      profile_external_id: appointment.clientId,
      occurred_at: appointment.startAt || appointment.createdAt || new Date().toISOString(),
      metadata: { booking_id: appointment.id, protocol_id: appointment.protocolId || "" }
    }));
  const treatmentEvents = treatments
    .filter((treatment) => treatment.clientId)
    .map((treatment) => ({
      ...scope,
      stage: "treatment",
      event_type: "treatment_recorded",
      status: ["completed", "done", "closed"].includes(String(treatment.status || "").toLowerCase()) ? "ready" : "pending",
      source: "smartdesk",
      external_event_id: `treatment:${treatment.id}`,
      profile_external_id: treatment.clientId,
      occurred_at: treatment.completedAt || treatment.updatedAt || treatment.createdAt || new Date().toISOString(),
      metadata: { treatment_id: treatment.id, protocol_id: treatment.protocolId || "" }
    }));
  const saleRows = sales.map((sale) => ({
    ...scope,
    sale_id: sale.id,
    client_id: sale.clientId || "",
    product_id: sale.productId || sale.product || "",
    amount: bridgeMoney(sale, ["amount", "price", "priceCents", "amountCents"]),
    cost: bridgeMoney(sale, ["cost", "estimatedCost", "costCents", "estimatedCostCents"]),
    currency: sale.currency || "EUR",
    occurred_at: sale.date || sale.paidAt || sale.createdAt || new Date().toISOString(),
    campaign_id: sale.campaignId || ""
  }));
  const saleEvents = saleRows
    .filter((sale) => sale.client_id)
    .map((sale) => ({
      ...scope,
      stage: "commerce",
      event_type: "sale_recorded",
      status: "ready",
      source: "smartdesk",
      external_event_id: `sale:${sale.sale_id}`,
      profile_external_id: sale.client_id,
      occurred_at: sale.occurred_at,
      value: { currency: sale.currency, amount: sale.amount, cost: sale.cost },
      metadata: { sale_id: sale.sale_id, product_id: sale.product_id, campaign_id: sale.campaign_id }
    }));
  const servicesById = new Map(services.map((item) => [String(item.id || ""), item]));
  const staffById = new Map(staff.map((item) => [String(item.id || ""), item]));
  const inventoryById = new Map(inventory.map((item) => [String(item.id || ""), item]));
  const resourcesById = new Map(resources.map((item) => [String(item.id || ""), item]));
  const paymentsByAppointment = new Map();
  payments.forEach((payment) => {
    const appointmentId = String(payment.appointmentId || "");
    if (!appointmentId) return;
    if (!paymentsByAppointment.has(appointmentId)) paymentsByAppointment.set(appointmentId, []);
    paymentsByAppointment.get(appointmentId).push(payment);
  });
  const appointmentById = new Map(appointments.map((item) => [String(item.id || ""), item]));
  const paymentCostById = new Map();
  payments.forEach((payment) => {
    const appointment = appointmentById.get(String(payment.appointmentId || ""));
    if (!appointment) return;
    try {
      const profitability = computeAppointmentProfitability({
        appointment,
        servicesById,
        staffById,
        inventoryById,
        resourcesById,
        linkedPayments: paymentsByAppointment.get(String(appointment.id || "")) || [payment]
      });
      if (Number(profitability.directCostCents || 0) > 0) {
        paymentCostById.set(String(payment.id || ""), {
          cost: Number(profitability.directCostCents || 0) / 100,
          source: "smartdesk_profitability_core",
          confidence: profitability.confidence || "unknown"
        });
      }
    } catch (_error) {
      // A malformed appointment must not block the read-only bridge.
    }
  });
  const paymentRows = payments.map((payment) => ({
    ...scope,
    payment_id: payment.id,
    client_id: payment.clientId || "",
    appointment_id: payment.appointmentId || "",
    amount: bridgeMoney(payment, ["amountCents", "amount", "totalCents", "valueCents"]),
    cost: paymentCostById.get(String(payment.id || ""))?.cost ?? null,
    cost_source: paymentCostById.get(String(payment.id || ""))?.source || "missing",
    currency: payment.currency || "EUR",
    method: payment.method || "",
    occurred_at: payment.date || payment.paidAt || payment.createdAt || new Date().toISOString()
  }));
  const paymentEvents = paymentRows
    .filter((payment) => payment.client_id && Number(payment.amount || 0) > 0)
    .map((payment) => ({
      ...scope,
      stage: "commerce",
      event_type: "payment_recorded",
      status: "ready",
      source: "smartdesk_payment",
      external_event_id: `payment:${payment.payment_id}`,
      profile_external_id: payment.client_id,
      occurred_at: payment.occurred_at,
      value: { currency: payment.currency, amount: payment.amount, cost: payment.cost },
      metadata: { payment_id: payment.payment_id, appointment_id: payment.appointment_id, channel: payment.method, cost_source: payment.cost_source }
    }));
  const inventoryRows = inventory.map((item) => ({
    ...scope,
    product_id: item.id || item.sku || "",
    sku: item.sku || "",
    quantity: bridgeNumber(item.quantity ?? item.stockQuantity ?? item.stock) || 0,
    min_quantity: bridgeNumber(item.minQuantity ?? item.thresholdQuantity) || 0,
    cost: bridgeMoney(item, ["costCents", "unitCostCents", "purchaseCostCents", "cost"]),
    sale_price: bridgeMoney(item, ["salePriceCents", "retailPriceCents", "salePrice"])
  }));
  const dataQuality = service.getDataQuality(session, { summaryOnly: true });
  return {
    ok: true,
    source: "smartdesk_live_bridge",
    generated_at: new Date().toISOString(),
    bridge: {
      id: bridge.id,
      label: bridge.label,
      plan: bridge.plan,
      scopes: bridge.scopes,
      scope_bound: Boolean(bridge.scopeBound)
    },
    tenant_id: tenantId,
    center_id: centerId,
    counts: service.getCenterControlStats(centerId),
    data_quality: {
      score: Number(dataQuality.score || 0),
      state: dataQuality.state || "unknown",
      status: dataQuality.status || "unknown",
      metrics: dataQuality.metrics || {}
    },
    sales: saleRows,
    payments: paymentRows,
    inventory: inventoryRows,
    journey_events: [...consentEvents, ...bookingEvents, ...treatmentEvents, ...(saleRows.length ? saleEvents : paymentEvents)]
  };
}

function requireAuth(req, res, next) {
  const session = service.getSession(readToken(req));
  if (!session) {
    return res.status(401).json({
      success: false,
      code: "session_invalid",
      message: "Sessione non valida o scaduta.",
      nextAction: "Esegui di nuovo il login o aggiorna la pagina."
    });
  }
  req.session = session;
  return next();
}

function requireOperationalAccess(req, res, next) {
  if (service.canOperate(req.session)) {
    return next();
  }
  return res.status(402).json({
    success: false,
    code: req.session?.accessState || "blocked",
    message: req.session?.accessState === "expired"
      ? "Trial scaduto. Attiva il piano per continuare."
      : req.session?.accessState === "suspended"
        ? "Account sospeso. Contatta SkinHarmony per riattivarlo."
        : req.session?.accessState === "pending_verification"
          ? "Verifica prima la tua email per attivare la prova."
          : req.session?.accessState === "pending_payment"
            ? "Pagamento in attesa. Completa l'attivazione per continuare."
        : "Accesso operativo non disponibile.",
    session: req.session
  });
}

function requireSuperAdmin(req, res, next) {
  if (String(req.session?.role || "").toLowerCase() === "superadmin") {
    return next();
  }
  return res.status(403).json({
    success: false,
    code: "superadmin_only",
    message: "Funzione in test riservata al super admin."
  });
}

function requireSuperAdminFleet(req, res, next) {
  if (String(req.session?.role || "").toLowerCase() === "superadmin") {
    req.fleetMode = "SUPER_ADMIN_FLEET";
    return next();
  }
  return res.status(403).json({
    success: false,
    code: "superadmin_fleet_only",
    message: "Fleet Intelligence disponibile solo in modalita Super Admin Fleet."
  });
}

function fleetFilters(req) {
  return {
    fleetId: req.query.fleetId || "",
    centerIds: req.query.centerIds || ""
  };
}

const planWeight = {
  base: 1,
  silver: 2,
  gold: 3,
  enterprise: 4
};

function normalizedPlan(session) {
  if (String(session?.role || "").toLowerCase() === "superadmin" && !session?.supportMode) return "enterprise";
  const plan = String(session?.subscriptionPlan || "").toLowerCase();
  return planWeight[plan] ? plan : "base";
}

function requirePlan(requiredPlan) {
  return (req, res, next) => {
    const currentWeight = planWeight[normalizedPlan(req.session)] || planWeight.gold;
    const requiredWeight = planWeight[requiredPlan] || planWeight.gold;
    if (currentWeight >= requiredWeight) {
      return next();
    }
    return res.status(403).json({
      success: false,
      code: "plan_locked",
      requiredPlan,
      currentPlan: normalizedPlan(req.session),
      message: `Funzione disponibile dal piano ${requiredPlan}.`
    });
  };
}

function sendCoreliaSafe(res, fallbackFactory, compute) {
  try {
    return res.json(compute());
  } catch (error) {
    const fallback = typeof fallbackFactory === "function" ? fallbackFactory(error) : {};
    return res.status(200).json({
      success: false,
      engineName: "Smart Desk data fallback",
      runtimeStack: ["V0", "V2", "V7"],
      fallback: true,
      error: error instanceof Error ? error.message : "Corelia non disponibile",
      ...fallback
    });
  }
}

function sendBadRequest(res, error, fallback) {
  const code = String(error?.code || "");
  const status = code === "persistence_conflict"
    ? 409
    : code === "persistence_unavailable" || code === "persistence_revision_missing"
      ? 503
      : 400;
  res.status(status).send(error instanceof Error ? error.message : fallback);
}

function verifyWooCommerceWebhook(req) {
  const secret = String(process.env.WOOCOMMERCE_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return { ok: false, code: "missing_secret", message: "WooCommerce webhook secret non configurato" };
  }
  const signature = String(req.headers["x-wc-webhook-signature"] || "").trim();
  if (!signature) {
    return { ok: false, code: "missing_signature", message: "Firma WooCommerce mancante" };
  }
  const rawBody = req.rawBody || "";
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const provided = Buffer.from(signature);
  const calculated = Buffer.from(expected);
  if (provided.length !== calculated.length || !crypto.timingSafeEqual(provided, calculated)) {
    return { ok: false, code: "invalid_signature", message: "Firma WooCommerce non valida" };
  }
  return { ok: true };
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-SkinHarmony-Bridge-Key, X-SkinHarmony-Bridge");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  return next();
});

app.use(express.json({
  limit: "15mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  const startedAt = Date.now();
  const requestId = safeModeMonitor.nextRequestId++;
  let sampleRecorded = false;
  safeModeMonitor.activeRequests += 1;
  safeModeMonitor.activeRequestStartedAt.set(requestId, startedAt);
  res.setHeader("X-SmartDesk-Safe-Mode", isSafeModeActive() ? "1" : "0");
  const recordOnce = ({ aborted = false } = {}) => {
    if (sampleRecorded) return;
    sampleRecorded = true;
    recordApiSample({
      requestId,
      startedAt,
      status: Number(res.statusCode || (aborted ? 499 : 0)),
      error: aborted || Number(res.statusCode || 0) >= 500
    });
  };
  res.on("finish", () => {
    recordOnce();
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      recordOnce({ aborted: true });
    }
  });
  return next();
});

setInterval(() => {
  evaluateSafeMode();
}, Math.max(1000, Math.min(5000, Math.floor(safeModeMonitor.thresholds.activeRequestAgeMs / 2)))).unref();

app.use("/assets", express.static(path.join(publicDir, "assets")));
app.use("/exports", express.static(path.join(publicDir, "exports")));
app.use("/web-preview", express.static(path.join(publicDir, "preview-shell")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "skinharmony-smartdesk-live" });
});

app.get("/api/health", (req, res) => {
  const bridge = findBridgeAccess(req);
  if (!bridge.ok) {
    return res.status(401).json({
      success: false,
      ok: false,
      code: bridge.code,
      message: "Smart Desk Bridge non autorizzato."
    });
  }

  return res.json({
    success: true,
    ok: true,
    service: "skinharmony-smartdesk-live",
    bridge: {
      authorized: true,
      id: bridge.id,
      label: bridge.label,
      plan: bridge.plan,
      expiresAt: bridge.expiresAt,
      scopes: bridge.scopes
    }
  });
});

app.get("/api/bridge/nyra-snapshot", (req, res) => {
  const bridge = findBridgeAccess(req);
  if (!bridge.ok) {
    return res.status(401).json({
      success: false,
      ok: false,
      code: bridge.code,
      message: "Smart Desk Bridge non autorizzato."
    });
  }
  if (!bridge.scopes.includes("stats")) {
    return res.status(403).json({
      success: false,
      ok: false,
      code: "bridge_scope_missing",
      requiredScope: "stats"
    });
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(buildNyraBridgeSnapshot(bridge));
  } catch (error) {
    return res.status(500).json({
      success: false,
      ok: false,
      code: "nyra_snapshot_failed",
      message: error instanceof Error ? error.message : "Snapshot Smart Desk non disponibile."
    });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/legacy-live", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/fleet-intelligence", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/web-preview", (_req, res) => {
  res.redirect(302, "/web-preview/");
});

app.post("/api/auth/login", loginRateLimit, (req, res) => {
  try {
    res.json({ success: true, ...service.login(req.body || {}) });
  } catch (error) {
    res.status(401).send(error instanceof Error ? error.message : "Credenziali non valide");
  }
});

app.get("/api/auth/trial-config", (_req, res) => {
  res.json(service.getTrialPublicConfig());
});

app.post("/api/auth/request-trial", trialRateLimit, async (req, res) => {
  try {
    const result = service.requestTrial(req.body || {});
    let emailDelivery = { status: "disabled" };
    if (result.verification?.required && result.verification?.token) {
      emailDelivery = await sendTrialVerificationMail({
        email: result.verification.email,
        centerName: req.body?.centerName || "",
        ownerName: req.body?.ownerName || "",
        verificationUrl: `${appBaseUrl(req)}/verify-email?token=${encodeURIComponent(result.verification.token)}`
      });
    }
    res.status(201).json({
      success: result.success,
      message: result.message,
      credentials: result.credentials,
      user: result.user,
      verification: {
        required: Boolean(result.verification?.required),
        email: result.verification?.email || "",
        deliveryStatus: emailDelivery.status
      },
      payment: result.payment
    });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile attivare la prova");
  }
});

app.post("/api/auth/verify-trial-email", (req, res) => {
  try {
    const result = service.verifyTrialEmailToken(req.body || {});
    void sendTrialWelcomeMail({
      email: result.user.contactEmail || "",
      centerName: result.user.centerName || "",
      username: result.user.username || "",
      trialEndsAt: result.user.trialEndsAt || ""
    });
    res.json(result);
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile verificare l'email");
  }
});

app.post("/api/auth/forgot-password", passwordRateLimit, async (req, res) => {
  try {
    const result = service.requestPasswordReset(req.body || {});
    if (result.delivery?.email && result.delivery?.token) {
      await sendPasswordResetMail({
        email: result.delivery.email,
        resetUrl: `${appBaseUrl(req)}/reset-password?token=${encodeURIComponent(result.delivery.token)}`
      });
    }
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile avviare il reset password");
  }
});

app.post("/api/auth/reset-password", passwordRateLimit, async (req, res) => {
  try {
    const result = service.resetPasswordWithToken(req.body || {});
    if (result.user.contactEmail) {
      await sendPasswordChangedMail({ email: result.user.contactEmail });
    }
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aggiornare la password");
  }
});

app.get("/api/auth/session", (req, res) => {
  res.json(service.getSession(readToken(req)));
});

app.post("/api/auth/logout", (req, res) => {
  res.json(service.logout(readToken(req)));
});

app.get("/api/auth/users", requireAuth, (req, res) => {
  try {
    res.json(service.listAccessUsers(req.session));
  } catch (error) {
    try {
      const includeControlStats = String(req.session?.role || "").toLowerCase() === "superadmin";
      const users = Array.isArray(service.usersRepository?.list?.()) ? service.usersRepository.list() : [];
      const visible = includeControlStats
        ? users
        : users.filter((item) => service.belongsToCenter(item, req.session?.centerId));
      const fallback = visible.map((item) => {
        try {
          return service.serializeUserSummary(item, { includeControlStats });
        } catch {
          return service.serializeUserSummary(item, { includeControlStats: false });
        }
      });
      return res.json(fallback);
    } catch {
      return res.status(500).send(error instanceof Error ? error.message : "Impossibile leggere gli accessi");
    }
  }
});

app.get("/api/enterprise/control", requireAuth, requireSuperAdmin, (req, res) => {
  try {
    res.json(service.getEnterpriseControlState(req.session));
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Controllo Enterprise non disponibile"
    });
  }
});

app.post("/api/auth/users", requireAuth, (req, res) => {
  try {
    res.status(201).json(service.createAccessUser(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile creare l'accesso");
  }
});

app.post("/api/auth/users/:id/status", requireAuth, (req, res) => {
  try {
    res.json(service.updateAccessUserStatus(req.params.id, req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aggiornare lo stato utente");
  }
});

app.post("/api/auth/users/:id/support-session", requireAuth, (req, res) => {
  try {
    res.json({ success: true, ...service.createSupportSessionForUser(req.params.id, req.session) });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aprire la sessione supporto");
  }
});

app.post("/api/auth/subscription/request-change", requireAuth, (req, res) => {
  try {
    res.json(service.requestSubscriptionChange(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile inviare la richiesta abbonamento");
  }
});

app.post("/api/integrations/woocommerce/order-paid", (req, res) => {
  const verification = verifyWooCommerceWebhook(req);
  if (!verification.ok) {
    return res.status(401).json({ success: false, ...verification });
  }
  try {
    res.json(service.activateSubscriptionFromWooCommerceOrder(req.body || {}));
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Impossibile collegare ordine WooCommerce"
    });
  }
});

app.post("/api/integrations/twilio/whatsapp-webhook", (req, res) => {
  const expectedToken = String(process.env.TWILIO_WEBHOOK_TOKEN || "").trim();
  const providedToken = String(req.query.token || req.headers["x-smartdesk-webhook-token"] || "").trim();
  if (expectedToken && providedToken !== expectedToken) {
    return res.status(401).json({ success: false, message: "Webhook non autorizzato" });
  }
  try {
    res.json(service.handleWhatsappWebhook(req.body || {}, whatsappService));
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Webhook WhatsApp non gestibile"
    });
  }
});

app.get("/api/suite-bridge/status", (_req, res) => {
  res.json({
    success: true,
    service: "skinharmony-smartdesk-live",
    bridge: suiteAppKeyBridge.status()
  });
});

app.post("/api/suite-bridge/activate", async (req, res) => {
  try {
    const result = await suiteAppKeyBridge.activate(req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "suite_bridge_activate_failed",
      message: error instanceof Error ? error.message : "Attivazione App Key non riuscita."
    });
  }
});

app.post("/api/suite-bridge/config-bundle", async (req, res) => {
  try {
    const result = await suiteAppKeyBridge.configBundle(req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "suite_bridge_config_failed",
      message: error instanceof Error ? error.message : "Bundle configurazione non disponibile."
    });
  }
});

app.post("/api/suite-bridge/pulse", async (req, res) => {
  try {
    const result = await suiteAppKeyBridge.pulse(req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "suite_bridge_pulse_failed",
      message: error instanceof Error ? error.message : "Pulse Suite non inviato."
    });
  }
});

app.get("/api/universal-core/status", (_req, res) => {
  res.json({
    success: true,
    service: "skinharmony-smartdesk-live",
    bridge: universalCoreBridge.status()
  });
});

app.get("/api/universal-core/tenant-status", requireAuth, async (_req, res) => {
  try {
    const result = await universalCoreBridge.tenantStatus();
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "universal_core_tenant_status_failed",
      message: error instanceof Error ? error.message : "Stato tenant Core non disponibile."
    });
  }
});

app.get("/api/universal-core/pulse", requireAuth, async (_req, res) => {
  try {
    const result = await universalCoreBridge.ecosystemPulse();
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "universal_core_pulse_failed",
      message: error instanceof Error ? error.message : "Pulse Universal Core non disponibile."
    });
  }
});

app.post("/api/universal-core/decision", requireAuth, async (req, res) => {
  try {
    const result = await universalCoreBridge.decision(req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "universal_core_decision_failed",
      message: error instanceof Error ? error.message : "Decisione Universal Core non disponibile."
    });
  }
});

app.post("/api/universal-core/branches/:branch", requireAuth, async (req, res) => {
  try {
    const result = await universalCoreBridge.branchAnalyze(req.params.branch, req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "universal_core_branch_failed",
      message: error instanceof Error ? error.message : "Ramo Universal Core non disponibile."
    });
  }
});

app.get("/api/universal-core/customer-intelligence/contract", requireAuth, async (_req, res) => {
  try {
    const result = await universalCoreBridge.customerIntelligenceContract();
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "universal_core_customer_intelligence_contract_failed",
      message: error instanceof Error ? error.message : "Contratto Customer Intelligence non disponibile."
    });
  }
});

app.post("/api/universal-core/customer-intelligence/readiness", requireAuth, async (req, res) => {
  try {
    const result = await universalCoreBridge.customerIntelligenceReadiness(req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "universal_core_customer_intelligence_readiness_failed",
      message: error instanceof Error ? error.message : "Readiness Customer Intelligence non disponibile."
    });
  }
});

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) {
    return next();
  }
  return requireAuth(req, res, () => requireOperationalAccess(req, res, next));
});

app.get("/api/system/safe-mode", (req, res) => {
  res.json({
    success: true,
    safeMode: safeModeSnapshot()
  });
});

app.get("/api/dashboard/stats", (req, res) => {
  res.json(service.getDashboardStats({
    period: req.query.period || "day",
    anchorDate: req.query.anchorDate || new Date().toISOString()
  }, req.session));
});

app.post("/api/dashboard/refresh", (req, res) => {
  if (isSafeModeActive()) {
    const dashboard = service.getDashboardStats({
        period: req.body?.period || req.query.period || "day",
        anchorDate: req.body?.anchorDate || req.query.anchorDate || new Date().toISOString()
      }, req.session);
    return res.json({
      ...dashboard,
      dashboardCache: {
        ...(dashboard.dashboardCache || {}),
        refreshStatus: "safe_mode",
        message: "Sistema sotto carico: aggiornamento temporaneamente limitato per mantenere operatività",
        safeMode: true
      },
      safeMode: safeModeSnapshot()
    });
  }
  res.json(service.refreshDashboardStats({
    period: req.body?.period || req.query.period || "day",
    anchorDate: req.body?.anchorDate || req.query.anchorDate || new Date().toISOString()
  }, req.session, { mode: "manual" }));
});

app.post("/api/assistant/chat", async (req, res) => {
  try {
    res.json(await assistantService.chat(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile usare l'assistente");
  }
});

app.post("/api/support-assistant/chat", async (req, res) => {
  try {
    res.json(await assistantService.supportChat(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile usare il supporto SkinHarmony");
  }
});

app.get("/api/assistant/brief", (req, res) => {
  const settings = service.getPublicSettings(req.session);
  const dashboard = service.getDashboardStats({ period: "day" }, req.session);
  res.json({
    ok: true,
    title: "Assistente operativo",
    answer: "Leggo agenda, clienti, incassi, priorita e moduli attivi. Le azioni operative restano da confermare dall'operatore.",
    centerName: settings.centerName || service.getCenterName(req.session),
    centerType: settings.centerType || "",
    language: settings.appLanguage || "it",
    priority: dashboard?.priority || dashboard?.aiPriority || null,
    generatedAt: new Date().toISOString()
  });
});

app.post("/api/assistant/query", async (req, res) => {
  try {
    const question = String(req.body?.question || req.body?.message || "").trim();
    const response = await assistantService.chat({ ...req.body, message: question, question }, req.session);
    res.json({
      ok: true,
      title: response.title || "Risposta Smart Desk",
      answer: response.answer || response.message || response.text || "",
      actions: response.actions || response.suggestedActions || [],
      raw: response
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      title: "Assistente non disponibile",
      answer: error instanceof Error ? error.message : "Impossibile usare l'assistente"
    });
  }
});

app.get("/api/center", (req, res) => {
  const settings = service.getPublicSettings(req.session);
  res.json({
    id: service.getCenterId(req.session),
    name: settings.centerName || service.getCenterName(req.session),
    businessType: settings.businessModel || "",
    centerType: settings.centerType || "",
    email: settings.centerEmail || "",
    phone: settings.centerPhone || "",
    address: settings.centerAddress || "",
    city: settings.centerCity || "",
    province: settings.centerProvince || "",
    postalCode: settings.centerPostalCode || "",
    hours: `${settings.agendaStartHour || "08:00"}-${settings.agendaEndHour || "20:00"}`,
    devices: [
      settings.moduleSkinPro ? "Skin Pro" : "",
      settings.moduleO3System ? "O3 System" : "",
      settings.moduleTermosauna ? "Termosauna" : "",
      settings.moduleExternalTech ? "Tecnologie esterne" : ""
    ].filter(Boolean),
    goldFixedCostProfile: settings.goldFixedCostProfile || null
  });
});

app.post("/api/center", (req, res) => {
  const payload = req.body || {};
  const updates = {
    centerName: payload.name || payload.centerName,
    businessModel: payload.businessType || payload.businessModel,
    centerType: payload.centerType,
    centerEmail: payload.email || payload.centerEmail,
    centerPhone: payload.phone || payload.centerPhone,
    centerAddress: payload.address || payload.centerAddress,
    centerCity: payload.city || payload.centerCity,
    centerProvince: payload.province || payload.centerProvince,
    centerPostalCode: payload.postalCode || payload.centerPostalCode,
    goldFixedCostProfile: payload.goldFixedCostProfile && typeof payload.goldFixedCostProfile === "object" ? payload.goldFixedCostProfile : undefined,
    updatedFrom: "preview_shell_center_adapter"
  };
  res.json(service.saveSettings(Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined && value !== "")
  ), req.session));
});

app.get("/api/runtime-meta", (req, res) => {
  const settings = service.getPublicSettings(req.session);
  const plan = normalizedPlan(req.session);
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    session: {
      state: req.session?.accessState || "active",
      role: req.session?.role || "admin_centro",
      confirmationMode: "required_for_sensitive_actions",
      supportMode: Boolean(req.session?.supportMode),
      note: "Le azioni sensibili richiedono conferma."
    },
    subscription: {
      plan,
      tier: plan,
      state: req.session?.paymentStatus || "configured",
      centerType: settings.centerType || "",
      activeModules: [
        settings.enableMarketing,
        settings.enableTreatments,
        settings.enableCashdesk,
        settings.enableProtocolsHub,
        settings.inventoryBaseEnabled,
        settings.profitabilityEnabled,
        settings.operatorReportsEnabled,
        settings.aiActionsEnabled
      ].filter(Boolean).length
    },
    permissions: {
      canEditCenter: true,
      canEditOperationalData: true,
      canExecuteSensitiveActionsWithoutConfirmation: false
    }
  });
});

app.get("/api/reports/operational", (req, res) => {
  res.json(service.getOperationalReport({
    period: req.query.period || "day",
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || "",
    forceRefresh: !isSafeModeActive() && (req.query.forceRefresh === "1" || req.query.forceRefresh === "true")
  }, req.session));
});

app.get("/api/reports/export", (req, res) => {
  res.json(service.exportOperationalReport({
    period: req.query.period || "day",
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.query.format || "pdf", req.session));
});

app.get("/api/reports/open-exports", (_req, res) => {
  res.json(service.openExportsFolder());
});

app.get("/api/reports/operator/:id", (req, res) => {
  try {
    res.json(service.getOperatorReport(req.params.id, {
      period: req.query.period || "month",
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || ""
    }, req.session));
  } catch (error) {
    res.status(404).send(error instanceof Error ? error.message : "Report operatore non disponibile");
  }
});

app.get("/api/reports/operator/:id/export", requirePlan("silver"), (req, res) => {
  try {
    res.json(service.exportOperatorReport(req.params.id, {
      period: req.query.period || "month",
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || ""
    }, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare il report operatore");
  }
});

app.get("/api/clients", (req, res) => {
  res.json(service.listClients(req.query.search, req.session, {
    summaryOnly: req.query.summary === "1" || req.query.summary === "true",
    limit: req.query.limit
  }));
});

app.get("/api/clients/duplicates", (req, res) => {
  res.json(service.listClientDuplicateGroups(req.session));
});

app.post("/api/clients/duplicate-suggestions", (req, res) => {
  res.json(service.findClientDuplicateSuggestions(req.body || {}, req.session));
});

app.post("/api/clients/merge", (req, res) => {
  try {
    res.json(service.mergeClients(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile unire i clienti");
  }
});

app.post("/api/clients", async (req, res) => {
  try {
    res.status(201).json(await service.saveClient(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare il cliente");
  }
});

app.put("/api/clients/:id", async (req, res) => {
  try {
    res.json(await service.saveClient({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile aggiornare il cliente");
  }
});

app.get("/api/clients/:id", (req, res) => {
  try {
    res.json(service.getClientDetail(req.params.id, req.session));
  } catch (error) {
    res.status(404).send(error instanceof Error ? error.message : "Cliente non trovato");
  }
});

app.get("/api/clients/:id/consultation", (req, res) => {
  try {
    res.json(service.getClientConsultation(req.params.id, req.session));
  } catch (error) {
    res.status(404).send(error instanceof Error ? error.message : "Cliente non trovato");
  }
});

app.get("/api/clients/:id/consent-document", (req, res) => {
  try {
    res.json(service.generateClientConsentDocument(req.params.id, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare il documento");
  }
});

app.get("/api/appointments", (req, res) => {
  res.json(service.listAppointments(req.query.view || "day", req.query.anchorDate || new Date().toISOString(), false, req.session, {
    staffId: req.query.staffId || "",
    operatorId: req.query.operatorId || "",
    resourceId: req.query.resourceId || "",
    status: req.query.status || "",
    safeMode: isSafeModeActive()
  }));
});

app.post("/api/appointments", async (req, res) => {
  try {
    res.status(201).json(await service.saveAppointment(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare l'appuntamento");
  }
});

app.put("/api/appointments/:id", async (req, res) => {
  try {
    res.json(await service.saveAppointment({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile aggiornare l'appuntamento");
  }
});

app.delete("/api/appointments/:id", async (req, res) => {
  try {
    res.json(await service.deleteAppointment(req.params.id, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile eliminare l'appuntamento");
  }
});

app.get("/api/catalog/services", (req, res) => {
  res.json(service.listServices(req.session));
});

app.post("/api/catalog/services", async (req, res) => {
  try {
    res.status(201).json(await service.saveService(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare il servizio");
  }
});

app.put("/api/catalog/services/:id", async (req, res) => {
  try {
    res.json(await service.saveService({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile aggiornare il servizio");
  }
});

app.delete("/api/catalog/services/:id", async (req, res) => {
  try { res.json(await service.deleteService(req.params.id, req.session)); } catch (error) { sendBadRequest(res, error, "Impossibile eliminare il servizio"); }
});

app.get("/api/catalog/staff", (req, res) => {
  res.json(service.listStaff(req.session));
});

app.post("/api/catalog/staff", async (req, res) => {
  try {
    res.status(201).json(await service.saveStaff(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare l'operatore");
  }
});

app.put("/api/catalog/staff/:id", async (req, res) => {
  try {
    res.json(await service.saveStaff({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile aggiornare l'operatore");
  }
});

app.delete("/api/catalog/staff/:id", async (req, res) => {
  try { res.json(await service.deleteStaff(req.params.id, req.session)); } catch (error) { sendBadRequest(res, error, "Impossibile eliminare l'operatore"); }
});

app.get("/api/shifts", (req, res) => {
  res.json(service.listShifts(req.query.view || "month", req.query.anchorDate || new Date().toISOString(), req.query.staffId || "", req.session));
});

app.post("/api/shifts", async (req, res) => {
  try {
    res.status(201).json(await service.saveShift(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare il turno");
  }
});

app.put("/api/shifts/:id", async (req, res) => {
  try {
    res.json(await service.saveShift({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile aggiornare il turno");
  }
});

app.delete("/api/shifts/:id", async (req, res) => {
  try { res.json(await service.deleteShift(req.params.id, req.session)); } catch (error) { sendBadRequest(res, error, "Impossibile eliminare il turno"); }
});

app.get("/api/shifts/export", requirePlan("silver"), (req, res) => {
  try {
    res.json(service.exportShiftReport(req.query || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare il foglio presenze");
  }
});

app.get("/api/shifts/templates", requirePlan("silver"), (req, res) => {
  res.json(service.listShiftTemplates(req.session));
});

app.post("/api/shifts/templates", requirePlan("silver"), async (req, res) => {
  try {
    res.status(201).json(await service.saveShiftTemplate(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare lo schema turni");
  }
});

app.put("/api/shifts/templates/:id", requirePlan("silver"), async (req, res) => {
  try {
    res.json(await service.saveShiftTemplate({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile aggiornare lo schema turni");
  }
});

app.delete("/api/shifts/templates/:id", requirePlan("silver"), async (req, res) => {
  try { res.json(await service.deleteShiftTemplate(req.params.id, req.session)); } catch (error) { sendBadRequest(res, error, "Impossibile eliminare lo schema turni"); }
});

app.post("/api/shifts/templates/generate", requirePlan("silver"), (req, res) => {
  try {
    res.json(service.generateShiftTemplate(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare i turni dallo schema");
  }
});

app.get("/api/catalog/resources", (req, res) => {
  res.json(service.listResources(req.session));
});

app.post("/api/catalog/resources", async (req, res) => {
  try {
    res.status(201).json(await service.saveResource(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare la risorsa");
  }
});

app.put("/api/catalog/resources/:id", async (req, res) => {
  try {
    res.json(await service.saveResource({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile aggiornare la risorsa");
  }
});

app.delete("/api/catalog/resources/:id", async (req, res) => {
  try { res.json(await service.deleteResource(req.params.id, req.session)); } catch (error) { sendBadRequest(res, error, "Impossibile eliminare la risorsa"); }
});

app.get("/api/inventory/items", (req, res) => {
  res.json(service.listInventoryItems(req.session));
});

app.post("/api/inventory/items", (req, res) => {
  try {
    res.status(201).json(service.saveInventoryItem(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare l'articolo");
  }
});

app.put("/api/inventory/items/:id", (req, res) => {
  try {
    res.json(service.saveInventoryItem({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile aggiornare l'articolo");
  }
});

app.delete("/api/inventory/items/:id", (req, res) => {
  res.json(service.deleteInventoryItem(req.params.id, req.session));
});

app.get("/api/inventory/movements", requirePlan("silver"), (req, res) => {
  res.json(service.listInventoryMovements(String(req.query.itemId || ""), req.session));
});

app.post("/api/inventory/movements", requirePlan("silver"), async (req, res) => {
  try {
    res.status(201).json(await service.createInventoryMovement(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile registrare il movimento");
  }
});

app.get("/api/inventory/overview", requirePlan("silver"), (req, res) => {
  res.json(service.getInventoryOverview(req.session));
});

app.get("/api/profitability/overview", requirePlan("silver"), (req, res) => {
  res.json(service.getProfitabilityOverview({
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || "",
    forceRefresh: !isSafeModeActive() && (req.query.forceRefresh === "1" || req.query.forceRefresh === "true")
  }, req.session));
});

app.get("/api/ai-gold/marketing", requirePlan("gold"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: false,
    actions: [],
    summary: { total: 0, toApprove: 0 },
    sourceLayer: "smartdesk_data_fallback"
  }), () => service.getAiGoldMarketingSnapshot(req.session));
});

app.get("/api/ai-gold/profitability", requirePlan("gold"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: false,
    summary: null,
    services: [],
    sourceLayer: "smartdesk_data_fallback"
  }), () => service.getAiGoldProfitability({
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.session));
});

app.get("/api/business-snapshot", requirePlan("gold"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: false,
    generatedAt: new Date().toISOString(),
    goldEngine: null,
    sourceLayer: "smartdesk_data_fallback"
  }), () => service.getBusinessSnapshot({
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || "",
    forceRefresh: !isSafeModeActive() && (
      req.query.forceRefresh === "1"
      || req.query.forceRefresh === "true"
      || req.query.force === "1"
      || req.query.force === "true"
    )
  }, req.session));
});

app.get("/api/ai-gold/decision-center", requirePlan("gold"), async (req, res) => {
  try {
    const payload = service.getAiGoldDecisionCenter({
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || "",
      forceRefresh: !isSafeModeActive() && (
        req.query.forceRefresh === "1"
        || req.query.forceRefresh === "true"
        || req.query.force === "1"
        || req.query.force === "true"
      )
    }, req.session);
    if (String(req.query.external || "") === "1") {
      return res.json(await assistantService.enhanceGoldPayloadWithExternalReadout(payload, req.session, "gold"));
    }
    res.json({
      ...payload,
      externalAi: {
        skipped: true,
        reason: "fast_path_default",
        endpoint: "/api/ai-gold/decision-center?external=1"
      }
    });
  } catch (error) {
    res.json({
      goldEnabled: false,
      title: "AI Gold",
      sections: [],
      sourceLayer: "external_core_nyra_fallback",
      message: error instanceof Error ? error.message : "Decision Center Gold non disponibile"
    });
  }
});

app.get("/api/ai-gold/cockpit", requirePlan("gold"), async (req, res) => {
  try {
    const payload = service.getAiGoldCockpit({
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || ""
    }, req.session);
    if (String(req.query.external || "") === "1") {
      return res.json(await assistantService.enhanceGoldPayloadWithExternalReadout(payload, req.session, "gold"));
    }
    res.json({
      ...payload,
      externalAi: {
        skipped: true,
        reason: "fast_path_default",
        endpoint: "/api/ai-gold/cockpit?external=1"
      }
    });
  } catch (error) {
    res.json({
      goldEnabled: false,
      cockpitVersion: "gold_cockpit_v1",
      sourceLayer: "external_core_nyra_fallback",
      summary: {},
      guardrails: {
        readOnly: true,
        automaticExecutionAllowed: false,
        operatorConfirmationRequired: true
      },
      sections: [],
      message: error instanceof Error ? error.message : "Cockpit Gold non disponibile"
    });
  }
});

app.get("/api/ai-gold/cockpit-360", requirePlan("gold"), async (req, res) => {
  try {
    const cockpit = service.getAiGoldCockpit({
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || ""
    }, req.session);
    const enhanced = await assistantService.enhanceGoldPayloadWithExternalReadout(cockpit, req.session, "gold");
    return res.json(cockpit360Contract({
      cockpit,
      enhanced,
      tenantId: req.session?.tenantId || process.env.UNIVERSAL_CORE_TENANT_ID || "",
      centerId: req.session?.centerId || ""
    }));
  } catch (error) {
    return res.status(502).json({
      ok: false,
      schema_version: "cockpit_360_v1",
      mode: "read_only_advisory",
      code: "cockpit_360_e2e_unavailable",
      message: error instanceof Error ? error.message : "Cockpit 360 non disponibile.",
      guardrails: {
        read_only: true,
        automatic_execution_allowed: false,
        operator_confirmation_required: true,
        tenant_scoped: true,
        source_data_mutated: false
      }
    });
  }
});

app.get("/api/ai-gold/capabilities", requirePlan("silver"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: false,
    currentPlan: normalizedPlan(req.session),
    version: "smartdesk_data_fallback_v1",
    goldEngineVersion: "external_core_nyra_openai_v1",
    decisionMatrixVersion: "external_core_nyra_decision_contract_v1",
    features: {},
    limits: {},
    rules: {},
    sourceLayer: "smartdesk_data_fallback"
  }), () => service.getGoldCapabilities(req.session));
});

app.get("/api/ai-gold/progressive-intelligence", requirePlan("silver"), (req, res) => {
  res.json(service.getProgressiveIntelligenceStatus(req.session, {
    force: req.query.force === "1",
    reason: req.query.force === "1" ? "api_force_refresh" : "api_read"
  }));
});

app.get("/api/ai-gold/decision-context", requirePlan("silver"), async (req, res) => {
  try {
    const payload = service.getGoldDecisionContext({
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || ""
    }, req.session);
    const mode = normalizedPlan(req.session) === "silver" ? "silver" : "gold";
    if (String(req.query.external || "") === "1") {
      return res.json(await assistantService.enhanceGoldPayloadWithExternalReadout(payload, req.session, mode));
    }
    res.json({
      ...payload,
      sourceLayer: payload.sourceLayer || "smartdesk_gold_state",
      externalAi: {
        skipped: true,
        reason: "fast_path_default",
        endpoint: "/api/ai-gold/decision-context?external=1"
      }
    });
  } catch (error) {
    res.json({
      goldEnabled: false,
      currentPlan: normalizedPlan(req.session),
      primaryAction: null,
      secondaryActions: [],
      blockedActions: [],
      topSignals: [],
      globalConfidence: 0,
      systemRisk: 0,
      sourceLayer: "external_core_nyra_fallback",
      message: error instanceof Error ? error.message : "Decision context non disponibile"
    });
  }
});

app.get("/api/ai-gold/change-impact-contract", requirePlan("silver"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    enabled: false,
    source: "smartdesk_data_fallback",
    mode: "read_only_domino_guard",
    executionAllowed: false,
    ownerConfirmationRequired: true,
    message: "Contratto effetto domino non disponibile nel fallback."
  }), () => service.getChangeImpactContract(req.session));
});

app.get("/api/ai-gold/customer-intelligence", requirePlan("gold"), async (req, res) => {
  try {
    const payload = service.buildCustomerIntelligenceCorePayload(req.session);
    const [contract, readiness] = await Promise.all([
      universalCoreBridge.customerIntelligenceContract(),
      universalCoreBridge.customerIntelligenceReadiness(payload)
    ]);
    return res.status(contract.success || readiness.success ? 200 : 400).json({
      success: contract.success || readiness.success,
      sourceLayer: "universal_core_customer_intelligence",
      contract: contract.contract || null,
      readiness: readiness.readiness || null,
      rule: readiness.rule || contract.contract?.rule || "AI Gold prepara bozze e priorita; l'operatore conferma sempre.",
      localSummary: payload.local_summary,
      automation: {
        automaticSendAllowed: Boolean(contract.contract?.automation_limits?.automatic_send_allowed) && Boolean(readiness.readiness?.can_send_automatically),
        operatorConfirmationRequired: true
      }
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "ai_gold_customer_intelligence_failed",
      message: error instanceof Error ? error.message : "Customer Intelligence Gold non disponibile."
    });
  }
});

app.get("/api/ai-gold/state", requirePlan("gold"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: false,
    version: "corelia_state_v1",
    snapshots: {},
    signals: {},
    decision: null,
    sourceLayer: "smartdesk_data_fallback"
  }), () => service.getGoldState(req.session));
});

app.get("/api/ai-gold/state/snapshots", requirePlan("gold"), (req, res) => {
  sendCoreliaSafe(res, () => ({}), () => service.getGoldState(req.session).snapshots || {});
});

app.get("/api/ai-gold/state/signals", requirePlan("gold"), (req, res) => {
  sendCoreliaSafe(res, () => ({}), () => service.getGoldState(req.session).signals || {});
});

app.get("/api/corelia/capabilities", requirePlan("silver"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: false,
    currentPlan: normalizedPlan(req.session),
    version: "smartdesk_data_fallback_v1",
    sourceLayer: "smartdesk_data_fallback"
  }), () => service.getGoldCapabilities(req.session));
});

app.get("/api/corelia/decision-context", requirePlan("silver"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: false,
    currentPlan: normalizedPlan(req.session),
    primaryAction: null,
    secondaryActions: [],
    blockedActions: [],
    topSignals: [],
    sourceLayer: "smartdesk_data_fallback"
  }), () => service.getGoldDecisionContext({
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.session));
});

app.get("/api/corelia/decision-center", requirePlan("gold"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: false,
    title: "Smart Desk Data Fallback",
    sections: [],
    sourceLayer: "smartdesk_data_fallback"
  }), () => service.getAiGoldDecisionCenter({
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.session));
});

app.get("/api/ai-gold/state/decision", requirePlan("gold"), (req, res) => {
  res.json(service.getGoldState(req.session).decision || {});
});

app.get("/api/ai-gold/onboarding/imports", requirePlan("gold"), (req, res) => {
  try {
    res.json(service.listGoldOnboardingImports(req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Import Gold non disponibile");
  }
});

const GOLD_ONBOARDING_SYNC_RECORD_LIMIT = Number(process.env.GOLD_ONBOARDING_SYNC_RECORD_LIMIT || 200);

function countGoldOnboardingRecords(record = {}) {
  const snapshots = record.snapshots || {};
  return Object.values(snapshots).reduce((sum, block = {}) => (
    sum
    + Number(block.validRows?.length || 0)
    + Number(block.reviewRows?.length || 0)
  ), 0);
}

app.post("/api/ai-gold/onboarding/analyze", requirePlan("gold"), (req, res) => {
  if (isSafeModeActive()) {
    return res.status(429).json(safeModePayload("Sistema sotto carico: analisi import Gold temporaneamente limitata"));
  }
  try {
    const analysis = service.analyzeGoldOnboardingImport(req.body || {}, req.session);
    const recordCount = countGoldOnboardingRecords(analysis);
    if (recordCount > GOLD_ONBOARDING_SYNC_RECORD_LIMIT) {
      return res.status(413).json({
        success: false,
        code: "gold_onboarding_import_too_large",
        message: `Import Gold troppo grande per conferma sincrona: ${recordCount} record. Dividi il file in blocchi fino a ${GOLD_ONBOARDING_SYNC_RECORD_LIMIT} record.`,
        importId: analysis.importId,
        recordCount,
        limit: GOLD_ONBOARDING_SYNC_RECORD_LIMIT
      });
    }
    res.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossibile analizzare i file";
    res.status(400).json({
      success: false,
      code: "gold_onboarding_analyze_failed",
      message
    });
  }
});

app.post("/api/ai-gold/onboarding/confirm", requirePlan("gold"), async (req, res) => {
  if (isSafeModeActive()) {
    return res.status(429).json(safeModePayload("Sistema sotto carico: import Gold temporaneamente limitato"));
  }
  try {
    const imports = service.listGoldOnboardingImports(req.session) || [];
    const importId = String(req.body?.importId || "");
    const pendingImport = imports.find((item) => String(item.importId || item.id || "") === importId);
    const recordCount = countGoldOnboardingRecords(pendingImport);
    if (recordCount > GOLD_ONBOARDING_SYNC_RECORD_LIMIT) {
      return res.status(413).json({
        success: false,
        code: "gold_onboarding_import_too_large",
        message: `Import Gold troppo grande per conferma sincrona: ${recordCount} record. Dividi il file in blocchi fino a ${GOLD_ONBOARDING_SYNC_RECORD_LIMIT} record.`,
        importId,
        recordCount,
        limit: GOLD_ONBOARDING_SYNC_RECORD_LIMIT
      });
    }
    res.json(await service.confirmGoldOnboardingImport(req.body || {}, req.session));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossibile completare import Gold";
    const status = error?.code === "persistence_conflict"
      ? 409
      : error?.code === "persistence_unavailable" || error?.code === "persistence_revision_missing"
        ? 503
        : 400;
    res.status(status).json({
      success: false,
      code: "gold_onboarding_confirm_failed",
      message
    });
  }
});

app.get("/api/fleet/overview", requireSuperAdminFleet, (req, res) => {
  res.json(service.getFleetOverview(req.session, fleetFilters(req)));
});

app.get("/api/fleet/maturity", requireSuperAdminFleet, (req, res) => {
  res.json(service.getFleetMaturity(req.session, fleetFilters(req)));
});

app.get("/api/fleet/outliers", requireSuperAdminFleet, (req, res) => {
  res.json(service.getFleetOutliers(req.session, fleetFilters(req)));
});

app.get("/api/fleet/alerts", requireSuperAdminFleet, (req, res) => {
  res.json(service.getFleetAlerts(req.session, fleetFilters(req)));
});

app.get("/api/fleet/performance", requireSuperAdminFleet, (req, res) => {
  res.json(service.getFleetPerformance(req.session, fleetFilters(req)));
});

app.get("/api/fleet/oracle", requireSuperAdminFleet, (req, res) => {
  res.json(service.getFleetOracleSummary(req.session, fleetFilters(req)));
});

app.post("/api/ai-gold/ask", requirePlan("gold"), async (req, res) => {
  if (isSafeModeActive()) {
    return res.status(429).json(safeModePayload("Sistema sotto carico: AI temporaneamente limitata, agenda e cassa restano operative"));
  }
  try {
    res.json(await assistantService.aiGoldAsk(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "AI Gold non disponibile");
  }
});

app.post("/api/corelia/dialog", requirePlan("gold"), (req, res) => {
  try {
    const payload = req.body || {};
    const structured = coreliaBridge.buildDialog(payload, req.session);
    const dialogue = nyraDialogue.render(structured, { message: payload.message || payload.question || "" });
    res.json({
      identity: "corelia_nyra_bridge",
      provider: "corelia_only",
      structured,
      dialogue
    });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Bridge Corelia/Nyra non disponibile");
  }
});

app.post("/api/ai-gold/command", requirePlan("gold"), async (req, res) => {
  try {
    if (!service.hasGoldIntelligence(req.session)) {
      res.status(403).send("Comandi operativi disponibili solo con AI Gold.");
      return;
    }
    res.json(await assistantService.chat(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Comando AI Gold non disponibile");
  }
});

app.get("/api/ai-gold/marketing/autopilot", requirePlan("gold"), (req, res) => {
  sendCoreliaSafe(res, () => ({
    goldEnabled: true,
    generatedAt: new Date().toISOString(),
    actions: [],
    counters: {},
    debug: {},
    summary: {
      total: 0,
      pending: 0,
      approved: 0,
      done: 0,
      archived: 0
    },
    sourceEndpoint: "/api/ai-gold/marketing/autopilot",
    fallbackReason: "Marketing Autopilot non disponibile in questo momento."
  }), () => service.getAiMarketingAutopilot(req.session));
});

app.post("/api/ai-gold/marketing/autopilot/generate", requirePlan("gold"), async (req, res) => {
  if (isSafeModeActive()) {
    return res.status(429).json(safeModePayload("Sistema sotto carico: generazione marketing temporaneamente limitata"));
  }
  try {
    const generated = service.generateAiMarketingAutopilotActions(req.session);
    const enhanced = await assistantService.enhanceMarketingAutopilotActions(generated.actions || [], req.session);
    if (enhanced.actions?.length) {
      service.updateAiMarketingActionDrafts(enhanced.actions, req.session);
    }
    res.json({
      ...service.getAiMarketingAutopilot(req.session),
      createdCount: generated.createdCount || 0,
      aiProvider: enhanced.provider
    });
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile generare Marketing Autopilot");
  }
});

app.post("/api/ai-gold/marketing/autopilot/:id/status", requirePlan("gold"), (req, res) => {
  try {
    res.json(service.updateAiMarketingActionStatus(req.params.id, req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aggiornare l'azione marketing");
  }
});

app.get("/api/ai-gold/marketing/autopilot/learning", requirePlan("gold"), (req, res) => {
  const autopilot = service.getAiMarketingAutopilot(req.session);
  const actions = Array.isArray(autopilot.actions) ? autopilot.actions : [];
  res.json({
    ok: true,
    status: "ready",
    learning: {
      totalActions: actions.length,
      approved: actions.filter((item) => item.status === "approved").length,
      done: actions.filter((item) => item.status === "done").length,
      archived: actions.filter((item) => item.status === "archived").length,
      lastGeneratedAt: autopilot.generatedAt || autopilot.updatedAt || null
    },
    note: "Marketing Autopilot legge dati reali e prepara azioni da approvare; non invia nulla senza conferma operatore."
  });
});

app.post("/api/ai-gold/marketing/autopilot/learning/reset", requirePlan("gold"), (req, res) => {
  const autopilot = service.getAiMarketingAutopilot(req.session);
  res.json({
    ok: true,
    reset: "noop",
    status: "ready",
    actionsCount: Array.isArray(autopilot.actions) ? autopilot.actions.length : 0,
    note: "Reset apprendimento registrato come operazione sicura: le azioni marketing restano in coda e vanno archiviate o completate dall'operatore."
  });
});

app.get("/api/ai-gold/whatsapp/status", requirePlan("gold"), (req, res) => {
  res.json(service.getGoldWhatsappStatus(req.session, whatsappService));
});

app.post("/api/ai-gold/whatsapp/test-twilio", requirePlan("gold"), async (req, res) => {
  try {
    res.json(await service.testGoldWhatsappTwilioCredentials(req.body || {}, req.session, whatsappService));
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Test Twilio non riuscito",
      settings: error && typeof error === "object" ? error.publicSettings || null : null
    });
  }
});

app.post("/api/ai-gold/whatsapp/preview", requirePlan("gold"), (req, res) => {
  try {
    res.json(service.previewGoldWhatsappAction(req.body || {}, req.session, whatsappService));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile preparare WhatsApp Gold");
  }
});

app.post("/api/ai-gold/whatsapp/send", requirePlan("gold"), async (req, res) => {
  try {
    res.json(await service.sendGoldWhatsappAction(req.body || {}, req.session, whatsappService));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile inviare WhatsApp Gold");
  }
});

app.post("/api/ai-gold/whatsapp/bulk-send", requirePlan("gold"), async (req, res) => {
  try {
    res.json(await service.sendGoldWhatsappBulk(req.body || {}, req.session, whatsappService));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile inviare WhatsApp Gold");
  }
});

app.post("/api/ai-gold/protocols/draft", requirePlan("silver"), (_req, res) => {
  res.status(423).json({
    success: false,
    code: "protocol_ai_standby",
    message: "Protocolli AI in standby. Usa i protocolli manuali del centro."
  });
});

app.get("/api/treatments", requirePlan("silver"), (req, res) => {
  res.json(service.listTreatments(req.query.clientId, req.session));
});

app.post("/api/treatments", requirePlan("silver"), (req, res) => {
  try {
    res.status(201).json(service.createTreatment(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile salvare il trattamento");
  }
});

app.get("/api/protocols", (req, res) => {
  res.json(service.listProtocols(req.query.clientId, req.session));
});

app.post("/api/protocols", (req, res) => {
  try {
    res.status(201).json(service.saveProtocol(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile salvare il protocollo");
  }
});

app.put("/api/protocols/:id", (req, res) => {
  try {
    res.json(service.saveProtocol({ ...(req.body || {}), id: req.params.id }, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile aggiornare il protocollo");
  }
});

app.delete("/api/protocols/:id", (req, res) => {
  res.json(service.deleteProtocol(req.params.id, req.session));
});

app.get("/api/payments", (req, res) => {
  res.json(service.listPayments(req.query.clientId, req.session));
});

app.get("/api/sales", (req, res) => {
  res.json({
    ok: true,
    items: service.listPayments(req.query.clientId, req.session),
    summary: service.getPaymentsSummary({
      period: req.query.period || "day",
      anchorDate: req.query.anchorDate || "",
      startDate: req.query.startDate || "",
      endDate: req.query.endDate || ""
    }, req.session)
  });
});

app.get("/api/payments/summary", (req, res) => {
  res.json(service.getPaymentsSummary({
    period: req.query.period || "day",
    anchorDate: req.query.anchorDate || "",
    startDate: req.query.startDate || "",
    endDate: req.query.endDate || ""
  }, req.session));
});

app.get("/api/payments/unlinked", (req, res) => {
  res.json(service.listUnlinkedPayments(req.session, {
    forceRefresh: !isSafeModeActive() && (req.query.forceRefresh === "1" || req.query.forceRefresh === "true")
  }));
});

app.post("/api/payments/cash-close", async (req, res) => {
  try {
    res.json(await service.closeCashdesk(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile chiudere la cassa");
  }
});

app.post("/api/payments", async (req, res) => {
  try {
    res.status(201).json(await service.createPayment(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile registrare il pagamento");
  }
});

app.post("/api/sales", async (req, res) => {
  try {
    res.status(201).json(await service.createPayment(req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile registrare la vendita");
  }
});

app.get("/api/history", (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
  const payments = service.listPayments(req.query.clientId, req.session)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      type: "payment",
      date: item.date || item.createdAt || "",
      title: item.description || item.serviceName || "Pagamento",
      amount: item.amount || item.total || item.amountCents || item.totalCents || 0,
      clientId: item.clientId || "",
      source: "payments"
    }));
  const appointments = service.listAppointments(req.query.view || "month", req.query.anchorDate || new Date().toISOString(), false, req.session, {
    status: req.query.status || "",
    safeMode: isSafeModeActive()
  })
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      type: "appointment",
      date: item.startAt || item.start || item.startDate || item.date || "",
      title: item.serviceName || item.title || "Appuntamento",
      clientId: item.clientId || "",
      status: item.status || "",
      source: "appointments"
    }));
  res.json({
    ok: true,
    items: [...appointments, ...payments]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, limit)
  });
});

app.post("/api/payments/:id/link", (req, res) => {
  try {
    res.json(service.linkPayment(req.params.id, req.body || {}, req.session));
  } catch (error) {
    sendBadRequest(res, error, "Impossibile collegare il pagamento");
  }
});

app.get("/api/data-quality", (req, res) => {
  res.json(service.getDataQuality(req.session, {
    summaryOnly: isSafeModeActive() || req.query.summary === "1" || req.query.summary === "true",
    forceRefresh: !isSafeModeActive() && (req.query.forceRefresh === "1" || req.query.forceRefresh === "true")
  }));
});

app.get("/api/settings", (req, res) => {
  res.json(service.getPublicSettings(req.session));
});

app.put("/api/settings", (req, res) => {
  res.json(service.saveSettings(req.body || {}, req.session));
});

app.post("/api/settings/reset", (req, res) => {
  res.json(service.resetSettings(req.session));
});

app.post("/api/admin/cleanup-test-data", requireSuperAdmin, (req, res) => {
  try {
    res.json(service.deleteSafeTestData(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile eseguire cleanup test");
  }
});

app.post("/api/admin/reset-center-data", requireSuperAdmin, (req, res) => {
  try {
    res.json(service.resetCenterOperationalData(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile eseguire reset centro");
  }
});

app.post("/api/admin/cleanup-demo-centers", requireSuperAdmin, (req, res) => {
  try {
    res.json(service.cleanupDemoTestCenters(req.body || {}, req.session));
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Impossibile pulire i centri demo/test"
    });
  }
});

app.post("/api/admin/gold-state/rebuild", requireAuth, requireSuperAdmin, (req, res) => {
  try {
    res.json(service.rebuildGoldStateForTenant(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile ricostruire Gold State");
  }
});

app.post("/api/admin/progressive-intelligence/recompute", requireAuth, requireSuperAdmin, (req, res) => {
  try {
    res.json(service.recomputeProgressiveIntelligenceForTenant(req.body || {}, req.session));
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Impossibile ricalcolare Progressive Intelligence");
  }
});

app.get("/api/admin/database-usage", requireSuperAdmin, async (req, res) => {
  try {
    res.json(await service.getDatabaseUsage(req.session));
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Impossibile leggere uso database"
    });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT || 10000);

async function bootstrap() {
  const requireDurablePersistence = ["1", "true", "yes"].includes(String(process.env.SMARTDESK_REQUIRE_DURABLE_PERSISTENCE || "").trim().toLowerCase());
  if (requireDurablePersistence && !process.env.DATABASE_URL) {
    throw new Error("SMARTDESK_REQUIRE_DURABLE_PERSISTENCE richiede DATABASE_URL: avvio bloccato per evitare persistenza locale non durevole.");
  }
  const persistenceAdapter = process.env.DATABASE_URL
    ? new PostgresPersistenceAdapter(process.env.DATABASE_URL)
    : null;

  service = new DesktopMirrorService({ persistenceAdapter });
  await service.init();
  universalCoreBridge = new UniversalCoreBridge();
  assistantService = new AssistantService(service, { universalCoreBridge });
  coreliaBridge = new CoreliaBridge(service);
  nyraDialogue = new NyraDialogueAdapter();
  whatsappService = new WhatsappService();
  suiteAppKeyBridge = new SuiteAppKeyBridge();

  app.listen(port, () => {
    console.log(`SkinHarmony Smart Desk live su http://localhost:${port}`);
    console.log(`[SmartDesk] Persistence: ${process.env.DATABASE_URL ? "Postgres (DATABASE_URL)" : "JSON locale"}`);
    console.log(`[SmartDesk] WhatsApp Twilio: ${whatsappService.isConfigured() ? "configurato" : "fallback copia"}`);
    console.log(`[SmartDesk] Suite App Key Bridge: ${suiteAppKeyBridge.isConfigured() ? suiteAppKeyBridge.baseUrl : "non configurato"}`);
    console.log(`[SmartDesk] External Universal Core Bridge: ${universalCoreBridge.isConfigured() ? universalCoreBridge.baseUrl : "non configurato"}`);
  });
}

bootstrap().catch((error) => {
  console.error("[SmartDesk] Avvio fallito:", error);
  process.exit(1);
});
