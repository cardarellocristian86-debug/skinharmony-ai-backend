import assert from "node:assert/strict";
import fs from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createUniversalCoreService } from "../src/app.js";

const serviceRoot = path.resolve(import.meta.dirname, "..");
const uiRoot = path.join(serviceRoot, "admin-ui");
const fakeGithubToken = ["gho", "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"].join("_");
const fakeOpenAiToken = ["sk", "proj", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("-");

function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

async function start(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}

async function json(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

test("admin control room requires bootstrap, creates a server session and protects key writes", async () => {
  await withEnv({
    CORE_ADMIN_SESSION_SECRET: "s".repeat(48),
    CORE_ADMIN_BOOTSTRAP_USERNAME: "owner",
    CORE_ADMIN_BOOTSTRAP_PASSWORD: "A-long-bootstrap-password-2026",
    NODE_ENV: "test",
  }, async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-test-"));
    const { app } = createUniversalCoreService({ storageRoot });
    const instance = await start(app);
    const { base } = instance;
    try {
      const health = await fetch(`${base}/admin/healthz`);
      assert.equal(health.status, 200);
      const denied = await fetch(`${base}/admin/api/overview`);
      assert.equal(denied.status, 401);
      const invalid = await fetch(`${base}/admin/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "wrong" }) });
      assert.equal(invalid.status, 401);
      const login = await fetch(`${base}/admin/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      assert.equal(login.status, 200);
      const loginBody = await login.json();
      const setCookie = login.headers.get("set-cookie");
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Strict/);
      const cookie = setCookie.split(";")[0];
      const overview = await fetch(`${base}/admin/api/overview`, { headers: { cookie } });
      assert.equal(overview.status, 200);
      const noCsrf = await fetch(`${base}/admin/api/keys`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ tenant_id: "tenant-a", preset: "readonly_monitor", confirmation: "CREATE_KEY" }) });
      assert.equal(noCsrf.status, 403);
      const blocked = await fetch(`${base}/admin/api/keys`, { method: "POST", headers: { cookie, "x-csrf-token": loginBody.csrf_token, "content-type": "application/json" }, body: JSON.stringify({ tenant_id: "tenant-a", preset: "readonly_monitor", label: "monitor", confirmation: "CREATE_KEY" }) });
      assert.equal(blocked.status, 403);
      const blockedBody = await blocked.json();
      assert.equal(blockedBody.error, "request_bound_core_proof_required");
      assert.equal(blockedBody.mutation_allowed, false);
    } finally {
      await instance.close();
    }
  });
});

test("admin assets are routed under /admin and emit the strict browser security contract", async () => {
  await withEnv({
    CORE_ADMIN_SESSION_SECRET: "s".repeat(48),
    CORE_ADMIN_BOOTSTRAP_USERNAME: "owner",
    CORE_ADMIN_BOOTSTRAP_PASSWORD: "A-long-bootstrap-password-2026",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(48),
    NODE_ENV: "production",
  }, async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-assets-test-"));
    const { app } = createUniversalCoreService({ storageRoot });
    const instance = await start(app);
    try {
      const page = await fetch(`${instance.base}/admin`);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /href="\/admin\/assets\/styles\.css"/);
      assert.match(html, /src="\/admin\/assets\/app\.js"/);
      for (const [header, expected] of [
        ["cache-control", /no-store/],
        ["x-frame-options", /^DENY$/],
        ["referrer-policy", /^no-referrer$/],
        ["x-content-type-options", /^nosniff$/],
        ["content-security-policy", /frame-ancestors 'none'/],
      ]) {
        assert.match(page.headers.get(header) || "", expected, `${header} must be present on Admin responses`);
      }
      const permissionsPolicy = page.headers.get("permissions-policy") || "";
      for (const directive of ["camera=()", "microphone=()", "geolocation=()"]) {
        assert.ok(permissionsPolicy.includes(directive), `permissions-policy must disable ${directive}`);
      }
      const css = await fetch(`${instance.base}/admin/assets/styles.css`);
      const script = await fetch(`${instance.base}/admin/assets/app.js`);
      assert.equal(css.status, 200);
      assert.match(css.headers.get("content-type") || "", /text\/css/);
      assert.equal(script.status, 200);
      assert.match(script.headers.get("content-type") || "", /javascript/);
      assert.equal((await fetch(`${instance.base}/admin/assets/..%2Fapp.js`)).status, 404);
    } finally {
      await instance.close();
    }
  });
});

test("a persisted owner can log in after bootstrap password removal", async () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-persisted-owner-test-"));
  const common = { CORE_ADMIN_SESSION_SECRET: "p".repeat(48), CORE_ADMIN_BOOTSTRAP_USERNAME: "owner", NODE_ENV: "test" };
  await withEnv({ ...common, CORE_ADMIN_BOOTSTRAP_PASSWORD: "A-long-bootstrap-password-2026" }, async () => {
    const first = await start(createUniversalCoreService({ storageRoot }).app);
    try {
      const login = await json(first.base, "/admin/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      assert.equal(login.response.status, 200);
    } finally { await first.close(); }
  });
  await withEnv(common, async () => {
    const second = await start(createUniversalCoreService({ storageRoot }).app);
    try {
      const login = await json(second.base, "/admin/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      assert.equal(login.response.status, 200, "an existing owner must not depend on retaining bootstrap password in Render");
      assert.match(login.response.headers.get("set-cookie") || "", /HttpOnly/);
      assert.match(login.response.headers.get("set-cookie") || "", /SameSite=Strict/);
    } finally { await second.close(); }
  });
});

test("tenant-admin overview, audit, key inventory and branch catalog are tenant-scoped", async () => {
  await withEnv({
    CORE_ADMIN_SESSION_SECRET: "t".repeat(48),
    CORE_ADMIN_BOOTSTRAP_USERNAME: "owner",
    CORE_ADMIN_BOOTSTRAP_PASSWORD: "A-long-bootstrap-password-2026",
    CORE_SERVICE_ADMIN_KEY: "core-admin-test-key",
    NODE_ENV: "test",
  }, async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-tenant-test-"));
    const { app } = createUniversalCoreService({ storageRoot });
    const instance = await start(app);
    try {
      const adminHeaders = { "content-type": "application/json", "x-api-key": "core-admin-test-key" };
      for (const tenant_id of ["tenant-a", "tenant-b"]) {
        const tenant = await json(instance.base, "/v1/tenants/upsert", { method: "POST", headers: adminHeaders, body: JSON.stringify({ tenant_id, label: tenant_id, lifecycle_state: "active", active_branches: ["context_intelligence"] }) });
        assert.equal(tenant.response.status, 201);
        const created = await json(instance.base, "/v1/keys/generate", { method: "POST", headers: adminHeaders, body: JSON.stringify({ tenant_id, preset: "readonly_monitor" }) });
        assert.equal(created.response.status, 201);
      }
      const usersFile = path.join(storageRoot, "admin-control-room", "users.json");
      await json(instance.base, "/admin/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      const users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
      users[0] = { ...users[0], role: "tenant_admin", tenant_ids: ["tenant-a"], status: "active" };
      fs.writeFileSync(usersFile, JSON.stringify(users), "utf8");
      fs.appendFileSync(
        path.join(storageRoot, "audit", "events.jsonl"),
        `${JSON.stringify({
          event_type: "sensitive_admin_test",
          tenant_id: "tenant-a",
          actor: `Bearer ${fakeGithubToken}`,
          path: `/internal?api_key=${fakeOpenAiToken}`,
          error: `password=hunter2 token=${fakeGithubToken}`,
          created_at: new Date().toISOString(),
        })}\n`,
        "utf8",
      );
      const login = await json(instance.base, "/admin/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      assert.equal(login.response.status, 200);
      const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
      const overview = await json(instance.base, "/admin/api/overview", { headers: { cookie } });
      assert.equal(overview.response.status, 200);
      assert.equal(overview.body.overview.keys.total, 1);
      assert.equal(overview.body.overview.keys.active, 1);
      assert.deepEqual(overview.body.overview.agents.agents, [], "tenant admins must not receive the root universal agent registry");
      assert.equal(overview.body.audit.some((event) => event.tenant_id === "tenant-b"), false);
      const overviewJson = JSON.stringify(overview.body);
      for (const secret of ["hunter2", fakeGithubToken, fakeOpenAiToken]) {
        assert.equal(overviewJson.includes(secret), false, `admin audit response must redact ${secret}`);
      }
      assert.match(overviewJson, /REDACTED_SECRET/);
      const keys = await json(instance.base, "/admin/api/keys", { headers: { cookie } });
      assert.equal(keys.response.status, 403, "tenant admins must not gain security-admin inventory access");
      const branches = await json(instance.base, "/admin/api/branches?tenant_id=tenant-b", { headers: { cookie } });
      assert.equal(branches.response.status, 403, "a branch catalog request for another tenant must fail closed");
    } finally { await instance.close(); }
  });
});

test("legacy owner wildcard retains root inventory while tenant_owner remains tenant and branch scoped", async () => {
  await withEnv({
    CORE_ADMIN_SESSION_SECRET: "l".repeat(48),
    CORE_ADMIN_BOOTSTRAP_USERNAME: "owner",
    CORE_ADMIN_BOOTSTRAP_PASSWORD: "A-long-bootstrap-password-2026",
    CORE_SERVICE_ADMIN_KEY: "legacy-owner-admin-key",
    NODE_ENV: "test",
  }, async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-legacy-owner-test-"));
    const instance = await start(createUniversalCoreService({ storageRoot }).app);
    try {
      const adminHeaders = { "content-type": "application/json", "x-api-key": "legacy-owner-admin-key" };
      const tenantDefinitions = [
        { tenant_id: "tenant-a", active_branches: ["context_intelligence"] },
        { tenant_id: "tenant-b", active_branches: ["research_evidence"] },
      ];
      for (const tenant of tenantDefinitions) {
        const upsert = await json(instance.base, "/v1/tenants/upsert", { method: "POST", headers: adminHeaders, body: JSON.stringify({ ...tenant, label: tenant.tenant_id, lifecycle_state: "active" }) });
        assert.equal(upsert.response.status, 201);
        const key = await json(instance.base, "/v1/keys/generate", {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({
            tenant_id: tenant.tenant_id,
            preset: "readonly_monitor",
            ...(tenant.tenant_id === "tenant-a"
              ? {
                  label: `monitor token=${fakeGithubToken}`,
                  metadata: { secret: fakeOpenAiToken, internal_note: "never expose metadata" },
                }
              : {}),
          }),
        });
        assert.equal(key.response.status, 201);
      }
      const loginHeaders = { "content-type": "application/json" };
      await json(instance.base, "/admin/api/login", { method: "POST", headers: loginHeaders, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      const usersFile = path.join(storageRoot, "admin-control-room", "users.json");
      const users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
      users[0] = { ...users[0], role: "owner", tenant_ids: ["*"], status: "active" };
      fs.writeFileSync(usersFile, JSON.stringify(users), "utf8");

      const legacyLogin = await json(instance.base, "/admin/api/login", { method: "POST", headers: loginHeaders, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      assert.equal(legacyLogin.response.status, 200);
      const legacyCookie = (legacyLogin.response.headers.get("set-cookie") || "").split(";")[0];
      const legacyOverview = await json(instance.base, "/admin/api/overview", { headers: { cookie: legacyCookie } });
      assert.equal(legacyOverview.response.status, 200);
      assert.equal(legacyOverview.body.overview.keys.total, 2);
      assert.ok(legacyOverview.body.overview.nyra.branches > 2, "root owner must see the complete generic Nyra catalog, not just tenant active_branches");
      const legacyKeys = await json(instance.base, "/admin/api/keys", { headers: { cookie: legacyCookie } });
      assert.equal(legacyKeys.response.status, 200);
      assert.equal(legacyKeys.body.keys.length, 2);
      const legacyKeysJson = JSON.stringify(legacyKeys.body);
      assert.equal(legacyKeysJson.includes("metadata"), false);
      assert.equal(legacyKeysJson.includes("never expose metadata"), false);
      assert.equal(legacyKeysJson.includes(fakeOpenAiToken), false);
      assert.equal(legacyKeysJson.includes(fakeGithubToken), false);
      assert.match(legacyKeysJson, /REDACTED_SECRET/);

      users[0] = { ...users[0], role: "owner", tenant_ids: ["tenant-a"], status: "active" };
      fs.writeFileSync(usersFile, JSON.stringify(users), "utf8");
      const limitedLegacyLogin = await json(instance.base, "/admin/api/login", { method: "POST", headers: loginHeaders, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      assert.equal(limitedLegacyLogin.response.status, 200);
      const limitedLegacyCookie = (limitedLegacyLogin.response.headers.get("set-cookie") || "").split(";")[0];
      const limitedLegacyOverview = await json(instance.base, "/admin/api/overview", { headers: { cookie: limitedLegacyCookie } });
      assert.equal(limitedLegacyOverview.response.status, 200);
      assert.equal(limitedLegacyOverview.body.overview.keys.total, 1, "legacy owner without wildcard must not be root");
      assert.equal(limitedLegacyOverview.body.overview.nyra.branches, 1);

      users[0] = { ...users[0], role: "tenant_owner", tenant_ids: ["tenant-a"], status: "active" };
      fs.writeFileSync(usersFile, JSON.stringify(users), "utf8");
      const tenantOwnerLogin = await json(instance.base, "/admin/api/login", { method: "POST", headers: loginHeaders, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      assert.equal(tenantOwnerLogin.response.status, 200);
      const tenantOwnerCookie = (tenantOwnerLogin.response.headers.get("set-cookie") || "").split(";")[0];
      const tenantOverview = await json(instance.base, "/admin/api/overview", { headers: { cookie: tenantOwnerCookie } });
      assert.equal(tenantOverview.response.status, 200);
      assert.equal(tenantOverview.body.overview.keys.total, 1);
      assert.deepEqual(tenantOverview.body.tenants.map((tenant) => tenant.tenant_id), ["tenant-a"]);
      const tenantBranches = await json(instance.base, "/admin/api/branches", { headers: { cookie: tenantOwnerCookie } });
      assert.equal(tenantBranches.response.status, 200);
      assert.deepEqual(tenantBranches.body.catalog.branches.map((branch) => branch.id), ["context_intelligence"]);
      const deniedOtherTenant = await json(instance.base, "/admin/api/keys?tenant_id=tenant-b", { headers: { cookie: tenantOwnerCookie } });
      assert.equal(deniedOtherTenant.response.status, 403);
    } finally { await instance.close(); }
  });
});

test("admin key mutations fail closed for invalid tenant, role, csrf and confirmation", async () => {
  await withEnv({
    CORE_ADMIN_SESSION_SECRET: "k".repeat(48),
    CORE_ADMIN_BOOTSTRAP_USERNAME: "owner",
    CORE_ADMIN_BOOTSTRAP_PASSWORD: "A-long-bootstrap-password-2026",
    NODE_ENV: "test",
  }, async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-key-guard-test-"));
    const instance = await start(createUniversalCoreService({ storageRoot }).app);
    try {
      const login = await json(instance.base, "/admin/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "A-long-bootstrap-password-2026" }) });
      const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
      const baseHeaders = { cookie, "content-type": "application/json", "x-csrf-token": login.body.csrf_token };
      for (const body of [
        { tenant_id: "", preset: "readonly_monitor", confirmation: "CREATE_KEY" },
        { tenant_id: "tenant-a", preset: "not-a-preset", confirmation: "CREATE_KEY" },
        { tenant_id: "tenant-a", preset: "readonly_monitor", confirmation: "wrong" },
      ]) {
        const response = await json(instance.base, "/admin/api/keys", { method: "POST", headers: baseHeaders, body: JSON.stringify(body) });
        assert.equal(response.response.status, 403);
      }
      const create = await json(instance.base, "/admin/api/keys", { method: "POST", headers: baseHeaders, body: JSON.stringify({ tenant_id: "tenant-a", preset: "readonly_monitor", confirmation: "CREATE_KEY" }) });
      assert.equal(create.response.status, 403);
      assert.equal(create.body.mutation_allowed, false);
      const revokeWrongConfirmation = await json(instance.base, "/admin/api/keys/key_attempt/revoke", { method: "POST", headers: baseHeaders, body: JSON.stringify({ confirmation: "wrong" }) });
      assert.equal(revokeWrongConfirmation.response.status, 403);
      const revokeMissing = await json(instance.base, "/admin/api/keys/not-a-real-key/revoke", { method: "POST", headers: baseHeaders, body: JSON.stringify({ confirmation: "REVOKE_KEY" }) });
      assert.equal(revokeMissing.response.status, 403);
    } finally { await instance.close(); }
  });
});

test("admin frontend has no fake operational data and disables unimplemented mutations accessibly", () => {
  const html = fs.readFileSync(path.join(uiRoot, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(uiRoot, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(uiRoot, "styles.css"), "utf8");
  for (const fake of ["Nyra Prime", "wordpress-production", "chatgpt-connector", "Routing preferenziale Nyra Fast", "Cristian", "Tutti i sistemi sono operativi"]) {
    assert.equal(html.includes(fake), false, `fake operational value must not be rendered: ${fake}`);
  }
  assert.equal(html.includes("AMBIENTE · PRODUCTION"), false);
  assert.equal(html.includes("Mappa completa del sistema"), false);
  assert.match(html, /id="login-message"[^>]*aria-live="polite"/);
  assert.match(html, /id="menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="sign-out"[^>]*aria-label="Esci"/);
  assert.match(html, /id="branch-dialog"[^>]*aria-labelledby="branch-dialog-title"/);
  assert.match(html, /<button[^>]*disabled[^>]*>\+ Genera chiave<\/button>/);
  assert.match(html, /<button[^>]*disabled[^>]*>\+ Registra agente<\/button>/);
  assert.match(html, /<button[^>]*disabled[^>]*>\+ Nuovo ramo<\/button>/);
  assert.match(script, /setAttribute\('aria-expanded'/);
  assert.match(styles, /\.audit-log>div\{[^}]*grid-template-columns:minmax\(0,170px\) minmax\(0,140px\) minmax\(0,130px\) minmax\(0,1fr\)/);
  assert.match(styles, /\.audit-log>div>\*\{min-width:0;overflow-wrap:anywhere\}/);
  assert.match(styles, /\.audit-log \.badge\{max-width:100%;white-space:normal;text-align:center\}/);

  const formatterSource = script.split("\n")
    .filter((line) => line.includes("function formatDate(") || line.includes("function formatExpiry("))
    .join("\n");
  const formatters = vm.runInNewContext(`(() => { ${formatterSource}; return { formatDate, formatExpiry }; })()`);
  assert.equal(formatters.formatDate(null), "—");
  assert.equal(formatters.formatDate(""), "—");
  for (const missing of [null, undefined, ""]) {
    assert.equal(formatters.formatExpiry(missing), "Nessuna");
  }
  for (const expired of [0, "0", "1970-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"]) {
    assert.match(formatters.formatExpiry(expired), /^Scaduta · /);
  }
  assert.equal(formatters.formatExpiry("invalid"), "Non valida");
  assert.match(formatters.formatExpiry("2030-06-15T12:30:00.000Z"), /2030/);
});
