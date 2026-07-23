import assert from "node:assert/strict";
import fs from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
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
    const server = app.listen(0);
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
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
      const generated = await fetch(`${base}/admin/api/keys`, { method: "POST", headers: { cookie, "x-csrf-token": loginBody.csrf_token, "content-type": "application/json" }, body: JSON.stringify({ tenant_id: "tenant-a", preset: "readonly_monitor", label: "monitor", confirmation: "CREATE_KEY" }) });
      assert.equal(generated.status, 201);
      const generatedBody = await generated.json();
      assert.match(generatedBody.key, /^SHX-/);
      assert.equal(generatedBody.record.tenant_id, "tenant-a");
      assert.equal(JSON.stringify(generatedBody.record).includes("key_hash"), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
