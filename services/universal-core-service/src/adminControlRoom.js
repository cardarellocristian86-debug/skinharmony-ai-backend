import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./audit.js";

const COOKIE_NAME = "sh_core_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 6;

function readJson(file, fallback) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; } catch { return fallback; }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function safeText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${derived}`;
}

function passwordMatches(password, stored) {
  const [scheme, salt, expected] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const received = Buffer.from(passwordHash(password, salt).split("$")[2]);
  const target = Buffer.from(expected);
  return received.length === target.length && crypto.timingSafeEqual(received, target);
}

function encodeCookie(value, signingSecret) {
  const signature = crypto.createHmac("sha256", signingSecret).update(value).digest("base64url");
  return `${value}.${signature}`;
}

function decodeCookie(raw, signingSecret) {
  const [value, signature] = String(raw || "").split(".");
  if (!value || !signature) return null;
  const expected = crypto.createHmac("sha256", signingSecret).update(value).digest("base64url");
  const received = Buffer.from(signature);
  const target = Buffer.from(expected);
  if (received.length !== target.length || !crypto.timingSafeEqual(received, target)) return null;
  return value;
}

function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function publicKey(record = {}) {
  const { key_hash, ...safe } = record;
  return safe;
}

function sanitizeAudit(event = {}) {
  return {
    audit_id: safeText(event.audit_id, 80),
    event_type: safeText(event.event_type, 120),
    created_at: safeText(event.created_at, 40),
    tenant_id: safeText(event.tenant_id, 120) || null,
    key_id: safeText(event.key_id, 120) || null,
    actor: safeText(event.actor, 120) || null,
    path: safeText(event.path, 160) || null,
    error: safeText(event.error, 120) || null,
  };
}

function cookieHeader(value, signingSecret, maxAge = SESSION_TTL_MS) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(encodeCookie(value, signingSecret))}`, "Path=/admin", "HttpOnly", "SameSite=Strict", `Max-Age=${Math.floor(maxAge / 1000)}`];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/**
 * Human-facing control plane. It intentionally talks to in-process stores so
 * that the browser never receives CORE_SERVICE_ADMIN_KEY or a tenant API key.
 */
export function mountAdminControlRoom({ app, storageRoot, audit, keyStore, tenants, nyraCatalog, agentRegistry, uiRoot }) {
  const root = path.join(storageRoot, "admin-control-room");
  const usersFile = path.join(root, "users.json");
  const sessionsFile = path.join(root, "sessions.json");
  ensureDir(root);
  const loginAttempts = new Map();
  const signingSecret = String(process.env.CORE_ADMIN_SESSION_SECRET || "").trim();
  const bootstrapUsername = safeText(process.env.CORE_ADMIN_BOOTSTRAP_USERNAME, 80).toLowerCase();
  const bootstrapPassword = String(process.env.CORE_ADMIN_BOOTSTRAP_PASSWORD || "");

  function enabled() { return signingSecret.length >= 32; }
  function users() { return readJson(usersFile, []); }
  function sessions() { return readJson(sessionsFile, []); }
  function saveSessions(rows) { writeJson(sessionsFile, rows.filter((item) => Date.parse(item.expires_at || "") > Date.now())); }

  function ensureBootstrapOwner() {
    if (!enabled() || !bootstrapUsername || bootstrapPassword.length < 16) return false;
    const current = users();
    if (current.some((user) => user.username === bootstrapUsername)) return true;
    current.push({
      user_id: `adm_${crypto.randomUUID()}`,
      username: bootstrapUsername,
      password_hash: passwordHash(bootstrapPassword),
      role: "owner",
      tenant_ids: ["*"],
      mfa_state: "not_configured",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    writeJson(usersFile, current);
    audit.append("core_admin_owner_bootstrapped", { actor: bootstrapUsername, role: "owner" });
    return true;
  }

  function currentSession(req) {
    if (!enabled()) return null;
    const sessionId = decodeCookie(parseCookies(req.headers.cookie || "")[COOKIE_NAME], signingSecret);
    if (!sessionId) return null;
    const active = sessions().find((session) => session.session_id === sessionId && Date.parse(session.expires_at || "") > Date.now());
    if (!active) return null;
    const user = users().find((item) => item.user_id === active.user_id && item.status !== "disabled");
    return user ? { session: active, user } : null;
  }

  function requireSession(req, res, next) {
    const context = currentSession(req);
    if (!context) return res.status(401).json({ ok: false, error: "admin_session_required" });
    req.adminContext = context;
    return next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.adminContext.user.role)) return res.status(403).json({ ok: false, error: "admin_role_denied" });
      return next();
    };
  }

  function requireCsrf(req, res, next) {
    const received = String(req.get("x-csrf-token") || "");
    const expected = String(req.adminContext.session.csrf_token || "");
    const valid = received && expected && Buffer.byteLength(received) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    if (!valid) return res.status(403).json({ ok: false, error: "admin_csrf_denied" });
    return next();
  }

  function loginKey(req, username) { return `${req.ip || "unknown"}:${username}`; }
  function limited(req, username) {
    const key = loginKey(req, username);
    const attempts = (loginAttempts.get(key) || []).filter((timestamp) => timestamp > Date.now() - LOGIN_WINDOW_MS);
    loginAttempts.set(key, attempts);
    return attempts.length >= LOGIN_MAX_ATTEMPTS;
  }

  function recordFailure(req, username) {
    const key = loginKey(req, username);
    const attempts = (loginAttempts.get(key) || []).filter((timestamp) => timestamp > Date.now() - LOGIN_WINDOW_MS);
    attempts.push(Date.now());
    loginAttempts.set(key, attempts);
  }

  function tenantAllowed(user, tenantId) {
    return user.role === "owner" || user.tenant_ids?.includes("*") || user.tenant_ids?.includes(String(tenantId || ""));
  }

  app.use("/admin", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'");
    next();
  });

  app.get("/admin/healthz", (_req, res) => res.json({ ok: true, service: "core-nyra-admin", configured: enabled() && Boolean(bootstrapUsername) }));
  app.get("/admin", (_req, res) => res.sendFile(path.join(uiRoot, "index.html")));
  app.get("/admin/assets/:asset", (req, res) => {
    const asset = String(req.params.asset || "");
    if (!/^[a-z0-9_.-]+$/i.test(asset)) return res.status(404).end();
    return res.sendFile(path.join(uiRoot, asset));
  });

  app.get("/admin/api/bootstrap", (req, res) => {
    const context = currentSession(req);
    return res.json({
      ok: true,
      configured: enabled() && Boolean(bootstrapUsername),
      authenticated: Boolean(context),
      user: context ? { username: context.user.username, role: context.user.role, mfa_state: context.user.mfa_state } : null,
      csrf_token: context?.session.csrf_token || null,
    });
  });

  app.post("/admin/api/login", (req, res) => {
    if (!ensureBootstrapOwner()) return res.status(503).json({ ok: false, error: "admin_bootstrap_required" });
    const username = safeText(req.body?.username, 80).toLowerCase();
    const password = String(req.body?.password || "");
    if (!username || limited(req, username)) return res.status(429).json({ ok: false, error: "login_rate_limited" });
    const user = users().find((item) => item.username === username && item.status !== "disabled");
    if (!user || !passwordMatches(password, user.password_hash)) {
      recordFailure(req, username);
      audit.append("core_admin_login_denied", { actor: username || "unknown" });
      return res.status(401).json({ ok: false, error: "login_invalid" });
    }
    const session = {
      session_id: crypto.randomBytes(32).toString("base64url"),
      csrf_token: crypto.randomBytes(24).toString("base64url"),
      user_id: user.user_id,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    saveSessions([...sessions(), session]);
    audit.append("core_admin_login_succeeded", { actor: user.username, role: user.role });
    res.setHeader("Set-Cookie", cookieHeader(session.session_id, signingSecret));
    return res.json({ ok: true, csrf_token: session.csrf_token, user: { username: user.username, role: user.role, mfa_state: user.mfa_state } });
  });

  app.post("/admin/api/logout", requireSession, requireCsrf, (req, res) => {
    saveSessions(sessions().filter((session) => session.session_id !== req.adminContext.session.session_id));
    audit.append("core_admin_logout", { actor: req.adminContext.user.username });
    res.setHeader("Set-Cookie", cookieHeader("expired", signingSecret, 0));
    return res.json({ ok: true });
  });

  app.get("/admin/api/overview", requireSession, (req, res) => {
    const keys = keyStore.listKeys({});
    const tenantRows = tenants.list().filter((tenant) => tenantAllowed(req.adminContext.user, tenant.tenant_id));
    const branches = nyraCatalog("generic");
    return res.json({
      ok: true,
      overview: {
        service: "universal-core-service",
        admin_security: { session: "http_only", csrf: "required_for_writes", mfa: req.adminContext.user.mfa_state, role: req.adminContext.user.role },
        tenants: { total: tenantRows.length, active: tenantRows.filter((tenant) => tenant.lifecycle_state === "active").length },
        keys: { total: keys.length, active: keys.filter((key) => key.status === "active").length, revoked: keys.filter((key) => key.status === "revoked").length },
        nyra: { branches: branches.branches?.length || 0, max_subbranches: branches.constraints?.max_subbranches || 20 },
        agents: agentRegistry("generic"),
      },
      tenants: tenantRows,
      audit: audit.recent(30).map(sanitizeAudit).reverse(),
    });
  });

  app.get("/admin/api/branches", requireSession, (_req, res) => res.json({ ok: true, catalog: nyraCatalog("generic") }));
  app.get("/admin/api/keys", requireSession, requireRole("owner", "security_admin"), (req, res) => {
    const keys = keyStore.listKeys({ tenant_id: req.query.tenant_id }).filter((key) => tenantAllowed(req.adminContext.user, key.tenant_id));
    return res.json({ ok: true, keys: keys.map(publicKey) });
  });

  app.post("/admin/api/keys", requireSession, requireRole("owner", "security_admin"), requireCsrf, (req, res) => {
    if (String(req.body?.confirmation || "") !== "CREATE_KEY") return res.status(400).json({ ok: false, error: "admin_confirmation_required" });
    const tenantId = safeText(req.body?.tenant_id, 120);
    if (!tenantAllowed(req.adminContext.user, tenantId)) return res.status(403).json({ ok: false, error: "tenant_scope_denied" });
    try {
      const result = keyStore.createKey({
        tenant_id: tenantId,
        brand_scope: safeText(req.body?.brand_scope, 120),
        preset: safeText(req.body?.preset, 80),
        label: safeText(req.body?.label, 160),
        expires_at: safeText(req.body?.expires_at, 40) || null,
      });
      audit.append("core_admin_key_issued", { actor: req.adminContext.user.username, tenant_id: tenantId, key_id: result.record.key_id, preset: result.record.preset });
      return res.status(201).json({ ok: true, key: result.key, record: result.record, warning: "Mostrata una sola volta: salvarla nel connector o nel Portachiavi." });
    } catch (error) {
      return res.status(400).json({ ok: false, error: safeText(error.message, 120) || "key_generation_failed" });
    }
  });

  app.post("/admin/api/keys/:keyId/revoke", requireSession, requireRole("owner", "security_admin"), requireCsrf, (req, res) => {
    if (String(req.body?.confirmation || "") !== "REVOKE_KEY") return res.status(400).json({ ok: false, error: "admin_confirmation_required" });
    const current = keyStore.listKeys({}).find((key) => key.key_id === req.params.keyId);
    if (!current || !tenantAllowed(req.adminContext.user, current.tenant_id)) return res.status(404).json({ ok: false, error: "key_not_found" });
    const record = keyStore.revokeKey(current.key_id, "revoked");
    audit.append("core_admin_key_revoked", { actor: req.adminContext.user.username, tenant_id: current.tenant_id, key_id: current.key_id });
    return res.json({ ok: true, key: record });
  });
}
