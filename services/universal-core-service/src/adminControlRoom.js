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

function redactedText(value, max = 160) {
  return String(value || "")
    .replace(/\b(?:bearer\s+)?(?:sk|gho|ghp|ghs|github_pat|akia)[-_a-z0-9]{12,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]{12,}\b/gi, "$1 [REDACTED_SECRET]")
    .replace(/\b(password|passwd|secret|token|api[_ -]?key|authorization)\s*[:=]\s*[^\s,;&]+/gi, "$1=[REDACTED_SECRET]")
    .trim()
    .slice(0, max);
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
  return {
    key_id: safeText(record.key_id, 120),
    tenant_id: safeText(record.tenant_id, 120),
    brand_scope: safeText(record.brand_scope, 120) || null,
    key_type: safeText(record.key_type, 80) || null,
    preset: safeText(record.preset, 80) || null,
    label: redactedText(record.label, 160) || null,
    status: safeText(record.status, 40) || null,
    allowed_scopes: Array.isArray(record.allowed_scopes)
      ? record.allowed_scopes.map((scope) => safeText(scope, 120)).filter(Boolean)
      : [],
    created_at: safeText(record.created_at, 40) || null,
    updated_at: safeText(record.updated_at, 40) || null,
    expires_at: safeText(record.expires_at, 40) || null,
    last_used_at: safeText(record.last_used_at, 40) || null,
  };
}

function sanitizeAudit(event = {}) {
  return {
    audit_id: safeText(event.audit_id, 80),
    event_type: safeText(event.event_type, 120),
    created_at: safeText(event.created_at, 40),
    tenant_id: safeText(event.tenant_id, 120) || null,
    key_id: safeText(event.key_id, 120) || null,
    actor: redactedText(event.actor, 120) || null,
    path: redactedText(event.path, 160) || null,
    error: redactedText(event.error, 120) || null,
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

  function persistedBootstrapUser(rows = users()) {
    return rows.find((user) => user.username === bootstrapUsername) || null;
  }

  function usablePersistedUser(user) {
    return Boolean(
      user &&
      user.status !== "disabled" &&
      /^scrypt\$[^$]+\$[^$]+$/.test(String(user.password_hash || "")),
    );
  }

  function adminConfigured() {
    if (!enabled() || !bootstrapUsername) return false;
    const existing = persistedBootstrapUser();
    if (existing) return usablePersistedUser(existing);
    return bootstrapPassword.length >= 16;
  }

  function ensureBootstrapOwner() {
    if (!enabled() || !bootstrapUsername) return false;
    const current = users();
    const existing = persistedBootstrapUser(current);
    if (existing) return usablePersistedUser(existing);
    if (bootstrapPassword.length < 16) return false;
    current.push({
      user_id: `adm_${crypto.randomUUID()}`,
      username: bootstrapUsername,
      password_hash: passwordHash(bootstrapPassword),
      role: "owner_root",
      tenant_ids: ["*"],
      mfa_state: "not_configured",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    writeJson(usersFile, current);
    audit.append("core_admin_owner_bootstrapped", { actor: bootstrapUsername, role: "owner_root" });
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

  function requireKeyAdministrationRole(req, res, next) {
    const user = req.adminContext.user;
    if (isRootOwner(user) || ["tenant_owner", "security_admin"].includes(user.role)) return next();
    return res.status(403).json({ ok: false, error: "admin_role_denied" });
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

  function explicitTenantIds(user) {
    if (!Array.isArray(user?.tenant_ids)) return [];
    return [...new Set(user.tenant_ids.map((tenantId) => safeText(tenantId, 120)).filter((tenantId) => tenantId && tenantId !== "*"))];
  }

  function isRootOwner(user) {
    const rootCompatibleRole = user?.role === "owner_root" || user?.role === "owner";
    return rootCompatibleRole && Array.isArray(user.tenant_ids) && user.tenant_ids.includes("*");
  }

  function tenantAllowed(user, tenantId) {
    const normalizedTenantId = safeText(tenantId, 120);
    if (!normalizedTenantId) return false;
    return isRootOwner(user) || explicitTenantIds(user).includes(normalizedTenantId);
  }

  function metricTenantIds(user, requestedTenantId = "") {
    const requested = safeText(requestedTenantId, 120);
    if (requested) return tenantAllowed(user, requested) ? { ok: true, tenantIds: [requested] } : { ok: false, error: "tenant_scope_denied", tenantIds: [] };
    if (isRootOwner(user)) return { ok: true, tenantIds: null };
    return { ok: true, tenantIds: explicitTenantIds(user) };
  }

  function tenantScope(user, requestedTenantId = "") {
    const requested = safeText(requestedTenantId, 120);
    if (requested && !tenantAllowed(user, requested)) {
      return { ok: false, error: "tenant_scope_denied", tenantRows: [] };
    }
    const tenantRows = tenants.list().filter((tenant) => {
      if (requested && tenant.tenant_id !== requested) return false;
      return tenantAllowed(user, tenant.tenant_id);
    });
    return { ok: true, tenantRows };
  }

  function scopedBranchCatalog(user, requestedTenantId = "") {
    const scope = tenantScope(user, requestedTenantId);
    if (!scope.ok) return scope;
    const allowedBranches = new Set(scope.tenantRows.flatMap((tenant) => (
      Array.isArray(tenant.active_branches) ? tenant.active_branches.map((branch) => safeText(branch, 80)).filter(Boolean) : []
    )));
    const catalog = nyraCatalog("generic");
    const visibleBranches = Array.isArray(catalog.branches) ? catalog.branches : [];
    return {
      ok: true,
      tenantRows: scope.tenantRows,
      catalog: {
        ...catalog,
        tenant_scope: {
          mode: isRootOwner(user) ? "root_all_registered_tenants" : "assigned_tenants",
          tenant_ids: scope.tenantRows.map((tenant) => tenant.tenant_id),
        },
        branches: isRootOwner(user) ? visibleBranches : visibleBranches.filter((branch) => allowedBranches.has(branch.id)),
      },
    };
  }

  function scopedAudit(user, tenantIds, requestedTenantId = "", limit = 30) {
    const allowedTenantIds = tenantIds === null ? null : new Set(tenantIds);
    const includeGlobalEvents = isRootOwner(user) && !safeText(requestedTenantId, 120);
    const rows = audit.recent(200).filter((event) => {
      const eventTenantId = safeText(event.tenant_id, 120);
      return eventTenantId ? allowedTenantIds === null || allowedTenantIds.has(eventTenantId) : includeGlobalEvents;
    });
    return rows.slice(-Math.max(1, Math.min(100, Number(limit) || 30))).map(sanitizeAudit).reverse();
  }

  function blockKeyMutation(operation) {
    return (req, res) => {
      audit.append("core_admin_key_mutation_blocked", {
        actor: req.adminContext.user.username,
        operation,
        reason: "request_bound_core_proof_required",
      });
      return res.status(403).json({
        ok: false,
        error: "request_bound_core_proof_required",
        operation,
        mutation_allowed: false,
      });
    };
  }

  app.use("/admin", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'");
    next();
  });

  app.get("/admin/healthz", (_req, res) => res.json({ ok: true, service: "core-nyra-admin", configured: adminConfigured() }));
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
      configured: adminConfigured(),
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
    const requestedTenantId = safeText(req.query?.tenant_id, 120);
    const branchScope = scopedBranchCatalog(req.adminContext.user, requestedTenantId);
    if (!branchScope.ok) return res.status(403).json({ ok: false, error: branchScope.error });
    const metricScope = metricTenantIds(req.adminContext.user, requestedTenantId);
    if (!metricScope.ok) return res.status(403).json({ ok: false, error: metricScope.error });
    const tenantRows = branchScope.tenantRows;
    const visibleTenantIds = metricScope.tenantIds === null ? null : new Set(metricScope.tenantIds);
    const keys = keyStore.listKeys({}).filter((key) => visibleTenantIds === null || visibleTenantIds.has(key.tenant_id));
    const branches = branchScope.catalog;
    return res.json({
      ok: true,
      overview: {
        service: "universal-core-service",
        admin_security: {
          session: "http_only",
          csrf: "required_for_writes",
          mfa: req.adminContext.user.mfa_state,
          role: req.adminContext.user.role,
          console_mode: "read_only",
          mutations: "request_bound_core_proof_required",
        },
        tenants: { total: tenantRows.length, active: tenantRows.filter((tenant) => tenant.lifecycle_state === "active").length },
        keys: { total: keys.length, active: keys.filter((key) => key.status === "active").length, revoked: keys.filter((key) => key.status === "revoked").length },
        nyra: { branches: branches.branches?.length || 0, max_subbranches: branches.maximum_subbranches_per_branch || 20 },
        agents: isRootOwner(req.adminContext.user)
          ? { ...agentRegistry({ domainPackId: "generic" }), visibility: "root_universal_registry" }
          : { schema_version: "universal_multi_agent_architecture_v1", agents: [], visibility: "not_exposed_to_tenant_admin" },
      },
      tenants: tenantRows,
      audit: scopedAudit(req.adminContext.user, metricScope.tenantIds, requestedTenantId, 30),
    });
  });

  app.get("/admin/api/branches", requireSession, (req, res) => {
    const scoped = scopedBranchCatalog(req.adminContext.user, req.query?.tenant_id);
    if (!scoped.ok) return res.status(403).json({ ok: false, error: scoped.error });
    return res.json({ ok: true, catalog: scoped.catalog });
  });

  app.get("/admin/api/keys", requireSession, requireKeyAdministrationRole, (req, res) => {
    const requestedTenantId = safeText(req.query?.tenant_id, 120);
    const scope = metricTenantIds(req.adminContext.user, requestedTenantId);
    if (!scope.ok) return res.status(403).json({ ok: false, error: scope.error });
    const visibleTenantIds = scope.tenantIds === null ? null : new Set(scope.tenantIds);
    const keys = keyStore.listKeys({}).filter((key) => visibleTenantIds === null || visibleTenantIds.has(key.tenant_id));
    return res.json({ ok: true, keys: keys.map(publicKey) });
  });

  app.post("/admin/api/keys", requireSession, requireKeyAdministrationRole, requireCsrf, blockKeyMutation("create_key"));
  app.post("/admin/api/keys/:keyId/revoke", requireSession, requireKeyAdministrationRole, requireCsrf, blockKeyMutation("revoke_key"));
}
