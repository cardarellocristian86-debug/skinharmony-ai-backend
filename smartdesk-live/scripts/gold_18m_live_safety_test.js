"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  COLLECTION_NAMES,
  REPOSITORY_PROPERTIES,
  auditCollections,
  stableStringify
} = require("../src/Gold18mTenantAdmin");
const {
  PostgresPersistenceAdapter
} = require("../src/PostgresPersistenceAdapter");
const {
  DesktopMirrorService
} = require("../src/DesktopMirrorService");
const {
  readCollectionsReadonly,
  acquireApplyLock,
  releaseApplyLock,
  openLockedService,
  assertWriteFreeze,
  resolveTargetCenter,
  assertSafeTargetUserId,
  resolveTargetUser,
  createBackup,
  loadBackup,
  restoreBackup
} = require("./manage_gold_18m_tenant_live");

function fixtureCollections() {
  const collections = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, name === "settings" ? {} : []]));
  collections.users = [
    {
      id: "superadmin_test",
      role: "superadmin",
      centerId: "center_admin",
      passwordHash: "opaque-admin-hash"
    },
    {
      id: "tenant_user_test",
      role: "staff",
      centerId: "center_test",
      centerName: "Tenant Test",
      passwordHash: "opaque-tenant-hash",
      active: true
    }
  ];
  collections.settings = {
    center_admin: { centerId: "center_admin" },
    center_test: { centerId: "center_test" }
  };
  return collections;
}

async function testReadonlySql() {
  const originalCreatePool = PostgresPersistenceAdapter.prototype.createPool;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const queries = [];
  const collections = fixtureCollections();
  const rows = COLLECTION_NAMES.map((name, index) => ({
    collection_name: name,
    payload: collections[name],
    revision: index + 1
  }));
  const client = {
    async query(sql) {
      queries.push(String(sql));
      if (String(sql).includes("SELECT collection_name")) return { rows };
      return { rows: [] };
    },
    release() {}
  };
  const pool = {
    async connect() {
      return client;
    },
    async end() {}
  };
  try {
    process.env.DATABASE_URL = "postgres://localhost/smartdesk_readonly_test";
    PostgresPersistenceAdapter.prototype.createPool = function createTestPool() {
      return pool;
    };
    const result = await readCollectionsReadonly();
    assert.strictEqual(result.collections.users.length, 2);
    assert.ok(queries[0].includes("REPEATABLE READ READ ONLY"));
    assert.ok(queries.some((query) => query.includes("SELECT collection_name")));
    assert.ok(queries.some((query) => query.includes("COMMIT")));
    assert.ok(!queries.some((query) => /\b(CREATE|INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(query)));
  } finally {
    PostgresPersistenceAdapter.prototype.createPool = originalCreatePool;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

async function testStableTenantLock() {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [{ locked: true }] };
    },
    release() {}
  };
  const adapter = {
    tenantId: "smartdesk-test",
    createPool() {
      return {
        async connect() {
          return client;
        }
      };
    }
  };
  const acquired = await acquireApplyLock(adapter);
  await releaseApplyLock(acquired, adapter);
  assert.ok(queries[0].sql.includes("hashtextextended"));
  assert.strictEqual(queries[0].params[0], "smartdesk:smartdesk-test:exclusive_tenant_maintenance");
  assert.ok(!queries[0].params[0].includes("smartdesk_gold_18m_20260726_v1"));
}

async function testConcurrentJobsInitializeOnlyAfterLock() {
  let held = false;
  let durableGeneration = 1;
  const events = [];

  function adapterFor(job) {
    const adapter = {
      tenantId: "smartdesk-race-test",
      pool: {
        async end() {
          events.push(`${job}:pool_end`);
        }
      },
      createPool() {
        return {
          async connect() {
            return {
              async query(sql) {
                const text = String(sql);
                if (text.includes("pg_try_advisory_lock")) {
                  const locked = !held;
                  if (locked) held = true;
                  events.push(`${job}:lock:${locked ? "acquired" : "denied"}`);
                  return { rows: [{ locked }] };
                }
                if (text.includes("pg_advisory_unlock")) {
                  held = false;
                  events.push(`${job}:unlock`);
                  return { rows: [{ pg_advisory_unlock: true }] };
                }
                if (text.includes("pg_backend_pid")) return { rows: [{ backend_pid: 9001 }] };
                return { rows: [] };
              },
              release() {
                events.push(`${job}:client_release`);
              }
            };
          }
        };
      }
    };
    return adapter;
  }

  const first = await openLockedService({
    adapter: adapterFor("A"),
    buildService: () => ({ loadedGeneration: null }),
    initialize: async (service) => {
      events.push("A:initialize");
      service.loadedGeneration = durableGeneration;
    }
  });
  assert.strictEqual(first.service.loadedGeneration, 1);

  let secondInitialized = false;
  await assert.rejects(
    () => openLockedService({
      adapter: adapterFor("B"),
      buildService: () => ({ loadedGeneration: null }),
      initialize: async (service) => {
        secondInitialized = true;
        service.loadedGeneration = durableGeneration;
      }
    }),
    (error) => error.code === "gold_seed_concurrent_job"
  );
  assert.strictEqual(secondInitialized, false, "Il job B non deve caricare uno snapshot prima del lock");
  assert.ok(events.indexOf("B:lock:denied") >= 0);
  assert.strictEqual(events.includes("B:initialize"), false);

  durableGeneration = 2;
  await releaseApplyLock(first.lockClient, first.adapter);
  const second = await openLockedService({
    adapter: adapterFor("B2"),
    buildService: () => ({ loadedGeneration: null }),
    initialize: async (service) => {
      events.push("B2:initialize");
      service.loadedGeneration = durableGeneration;
    }
  });
  assert.strictEqual(second.service.loadedGeneration, 2, "Il job successivo deve caricare lo stato durevole post-lock");
  assert.ok(events.indexOf("B2:lock:acquired") < events.indexOf("B2:initialize"));
  await releaseApplyLock(second.lockClient, second.adapter);
}

function testExactTargetBinding() {
  const audit = auditCollections(fixtureCollections());
  assert.strictEqual(resolveTargetCenter(audit, { "keep-center-id": "center_test" }), "center_test");
  assert.strictEqual(resolveTargetUser(audit, "center_test", { "keep-user-id": "tenant_user_test" }), "tenant_user_test");
  assert.throws(() => resolveTargetCenter(audit, {}), (error) => error.code === "gold_seed_target_required");
  assert.throws(() => resolveTargetUser(audit, "center_test", {}), (error) => error.code === "gold_seed_target_user_required");
  assert.strictEqual(assertSafeTargetUserId("809e1324-cbee-473b-8384-a094f3714ef7"), "809e1324-cbee-473b-8384-a094f3714ef7");
  [
    "a",
    "x".repeat(161),
    "__proto__",
    "constructor",
    "bad user",
    "user;touch_/tmp/pwned",
    "user$(id)",
    "user`id`",
    "user\nnext"
  ].forEach((value) => {
    assert.throws(
      () => resolveTargetUser(audit, "center_test", { "keep-user-id": value }),
      (error) => error.code === "gold_seed_invalid_target_user"
    );
  });
}

function testFreezeGate() {
  const original = process.env.SMARTDESK_WRITE_FREEZE;
  try {
    delete process.env.SMARTDESK_WRITE_FREEZE;
    assert.throws(() => assertWriteFreeze(), (error) => error.code === "gold_seed_write_freeze_required");
    process.env.SMARTDESK_WRITE_FREEZE = "true";
    assert.doesNotThrow(() => assertWriteFreeze());
  } finally {
    if (original === undefined) delete process.env.SMARTDESK_WRITE_FREEZE;
    else process.env.SMARTDESK_WRITE_FREEZE = original;
  }
}

function testBackupEventBeforeMutation() {
  const scriptSource = fs.readFileSync(path.join(__dirname, "manage_gold_18m_tenant_live.js"), "utf8");
  const backupCreatedAt = scriptSource.indexOf("backup = await createBackup");
  const backupEventAt = scriptSource.indexOf('event: "gold18m_backup_created"', backupCreatedAt);
  const mutationStartedAt = scriptSource.indexOf("mutationStarted = true", backupCreatedAt);
  assert.ok(backupCreatedAt >= 0, "Creazione backup non trovata");
  assert.ok(backupEventAt > backupCreatedAt, "Evento backup_created deve seguire la persistenza del backup");
  assert.ok(mutationStartedAt > backupEventAt, "Evento backup_created deve precedere ogni mutazione");
}

function createMinimalHttpApp() {
  const middlewares = [];
  const routes = new Map();
  const register = (method, pathname, handler) => {
    routes.set(`${method}:${pathname}`, handler);
  };
  return {
    use(handler) {
      middlewares.push(handler);
    },
    get(pathname, handler) {
      register("GET", pathname, handler);
    },
    post(pathname, handler) {
      register("POST", pathname, handler);
    },
    inject({ method = "GET", pathname = "/" } = {}) {
      return new Promise((resolve, reject) => {
        const headers = {};
        const req = {
          method,
          path: pathname,
          url: pathname,
          headers: { host: "localhost" }
        };
        const res = {
          statusCode: 200,
          setHeader(name, value) {
            headers[String(name).toLowerCase()] = String(value);
          },
          status(status) {
            this.statusCode = status;
            return this;
          },
          json(payload) {
            resolve({
              status: this.statusCode,
              headers,
              body: JSON.stringify(payload)
            });
          },
          end(body = "") {
            resolve({
              status: this.statusCode,
              headers,
              body: String(body)
            });
          }
        };
        try {
          let index = 0;
          const next = () => {
            const middleware = middlewares[index++];
            if (middleware) return middleware(req, res, next);
            const route = routes.get(`${req.method}:${req.path}`);
            if (route) return route(req, res);
            res.statusCode = 404;
            return res.end("not found");
          };
          next();
        } catch (error) {
          reject(error);
        }
      });
    }
  };
}

async function testServerSourceFreezeMiddleware() {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const sourceStart = serverSource.indexOf("function isWriteFreezeEnabled()");
  const nextMiddlewareMarker = "\n\napp.use((req, res, next) => {\n  if (!req.path.startsWith(\"/api\"))";
  const sourceEnd = serverSource.indexOf(nextMiddlewareMarker, sourceStart);
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart, "Middleware freeze non individuato nel server reale");
  const freezeSource = serverSource.slice(sourceStart, sourceEnd);
  const app = createMinimalHttpApp();
  const installFreeze = new Function("app", "process", `${freezeSource}\nreturn isWriteFreezeEnabled;`);
  const original = process.env.SMARTDESK_WRITE_FREEZE;
  process.env.SMARTDESK_WRITE_FREEZE = "true";
  installFreeze(app, process);
  app.get("/api/health", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/api/clients", (_req, res) => res.status(200).json({ shouldNotRun: true }));
  app.post("/api/clients", (_req, res) => res.status(201).json({ shouldNotRun: true }));
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
  try {
    const [apiRead, apiWrite, apiHealth, publicHealth] = await Promise.all([
      app.inject({ pathname: "/api/clients" }),
      app.inject({ method: "POST", pathname: "/api/clients" }),
      app.inject({ pathname: "/api/health" }),
      app.inject({ pathname: "/health" })
    ]);
    assert.strictEqual(apiRead.status, 503);
    assert.strictEqual(apiWrite.status, 503);
    assert.strictEqual(apiRead.headers["retry-after"], "120");
    assert.strictEqual(JSON.parse(apiRead.body).code, "smartdesk_maintenance_write_freeze");
    assert.strictEqual(apiHealth.status, 200);
    assert.strictEqual(publicHealth.status, 200);
  } finally {
    if (original === undefined) delete process.env.SMARTDESK_WRITE_FREEZE;
    else process.env.SMARTDESK_WRITE_FREEZE = original;
  }
}

async function testBackupCreateLoadRestoreAndFailure() {
  const collections = fixtureCollections();
  const queries = [];
  let storedRow = null;
  let markedStatus = "";
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (text.includes("INSERT INTO smartdesk_gold_seed_backups")) {
        storedRow = {
          backup_id: params[1],
          state_digest: params[3],
          superadmin_set_digest: params[4],
          payload: JSON.parse(params[5]),
          status: "available",
          expires_at: new Date(Date.now() + 60_000).toISOString()
        };
        return { rows: [] };
      }
      if (text.includes("SELECT backup_id::text")) return { rows: storedRow ? [storedRow] : [] };
      if (text.includes("SELECT pg_backend_pid")) return { rows: [{ backend_pid: 1234 }] };
      if (text.includes("UPDATE smartdesk_gold_seed_backups")) {
        markedStatus = String(params[2] || "");
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const adapter = {
    tenantId: "smartdesk-test",
    getRevision() {
      return 7;
    }
  };
  const created = await createBackup(client, adapter, collections);
  assert.ok(/^[0-9a-f-]{36}$/i.test(created.backupId));
  assert.ok(queries.some((item) => item.sql.includes("INSERT INTO smartdesk_gold_seed_backups")));
  assert.strictEqual(storedRow.state_digest, created.stateDigest);
  const loaded = await loadBackup(client, adapter, created.backupId);
  assert.strictEqual(loaded.stateDigest, created.stateDigest);
  assert.strictEqual(stableStringify(loaded.collections), stableStringify(collections));

  const service = {
    async commitRepositorySnapshots(changes) {
      changes.forEach(({ repository, payload }) => {
        repository.items = JSON.parse(JSON.stringify(payload));
      });
    }
  };
  Object.entries(REPOSITORY_PROPERTIES).forEach(([name, property]) => {
    service[property] = {
      collectionName: name,
      items: name === "settings" ? {} : [],
      list() {
        return this.items;
      }
    };
  });
  await restoreBackup(service, adapter, client, loaded);
  assert.strictEqual(markedStatus, "restored");
  assert.strictEqual(stableStringify(service.usersRepository.list()), stableStringify(collections.users));

  const corrupted = {
    ...storedRow,
    state_digest: "0".repeat(64)
  };
  const corruptedClient = {
    async query(sql) {
      if (String(sql).includes("SELECT backup_id::text")) return { rows: [corrupted] };
      return { rows: [] };
    }
  };
  await assert.rejects(
    () => loadBackup(corruptedClient, adapter, created.backupId),
    (error) => error.code === "gold_seed_backup_digest_mismatch"
  );

  let failureMarked = false;
  const failingClient = {
    async query(sql) {
      if (String(sql).includes("SELECT pg_backend_pid")) return { rows: [{ backend_pid: 1234 }] };
      if (String(sql).includes("UPDATE smartdesk_gold_seed_backups")) failureMarked = true;
      return { rows: [] };
    }
  };
  const failingService = {
    ...service,
    async commitRepositorySnapshots(changes) {
      changes.forEach(({ repository, payload }) => {
        repository.items = JSON.parse(JSON.stringify(payload));
      });
      this.usersRepository.items = [];
    }
  };
  await assert.rejects(
    () => restoreBackup(failingService, adapter, failingClient, loaded),
    (error) => error.code === "gold_seed_rollback_mismatch"
  );
  assert.strictEqual(failureMarked, false, "Un rollback non riconciliato non deve essere marcato restored");
}

async function testRestartPreservesCompleteSuperadmin() {
  const admin = {
    id: "superadmin_restart_test",
    username: "owner-control",
    passwordHash: "opaque-preserved-hash",
    role: "SuPeRaDmIn",
    active: true,
    centerId: "center_admin",
    centerName: "SkinHarmony Admin",
    planType: "active",
    accountStatus: "active",
    paymentStatus: "paid",
    activatedAt: "2025-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const before = stableStringify(admin);
  let updates = 0;
  const service = Object.create(DesktopMirrorService.prototype);
  service.usersRepository = {
    list() {
      return [admin];
    },
    async updateDurable() {
      updates += 1;
    }
  };
  await service.ensureInitialAdmin();
  assert.strictEqual(updates, 0);
  assert.strictEqual(stableStringify(admin), before);

  const incomplete = { ...admin, planType: "" };
  let normalized = null;
  service.usersRepository = {
    list() {
      return [incomplete];
    },
    async updateDurable(_id, updater) {
      normalized = updater(incomplete);
    }
  };
  await service.ensureInitialAdmin();
  assert.strictEqual(normalized.planType, "active");
  assert.strictEqual(normalized.role, "SuPeRaDmIn");
  assert.strictEqual(normalized.passwordHash, admin.passwordHash);
}

async function testWhatsappNeverSendsSyntheticOrManualProfiles() {
  async function exercise({ synthetic, mode }) {
    let sendCalls = 0;
    const service = Object.create(DesktopMirrorService.prototype);
    service.assertCanOperate = () => {};
    service.hasGoldIntelligence = () => true;
    service.getSettings = () => ({ whatsappGoldMode: mode });
    service.getCenterId = () => "center_test";
    service.getCenterName = () => "Tenant Test";
    service.getTenantWhatsappCredentials = () => null;
    service.isTenantWhatsappConfigured = () => false;
    service.filterByCenter = (rows) => rows;
    service.getGoldWhatsappContext = () => ({
      client: {
        id: "client_demo",
        firstName: "Demo",
        name: "Demo Client",
        phone: "+390000000000",
        marketingConsent: true,
        synthetic
      },
      suggestion: {
        name: "Demo Client",
        hasMarketingConsent: true,
        shouldContact: true,
        responseProbability: 0.9,
        daysSinceLastMarketingContact: 30,
        recommendedAction: "Solo anteprima"
      },
      goldItem: {
        action: "SUGGEST",
        confidence: 0.9,
        factors: { friction: 0.1 },
        expectedValue: 100,
        riskAdjustedPriority: 0.8
      }
    });
    service.whatsappMessagesRepository = {
      list() {
        return [];
      },
      create(record) {
        return { ...record };
      }
    };
    const whatsappService = {
      isConfigured() {
        return true;
      },
      async sendMessage() {
        sendCalls += 1;
        return { ok: true, status: "sent", messageId: "must-not-exist" };
      }
    };
    const result = await service.sendGoldWhatsappAction(
      { clientId: "client_demo" },
      { centerId: "center_test", subscriptionPlan: "gold", role: "owner" },
      whatsappService
    );
    return { result, sendCalls };
  }

  const syntheticActive = await exercise({ synthetic: true, mode: "active" });
  assert.strictEqual(syntheticActive.sendCalls, 0);
  assert.strictEqual(syntheticActive.result.sent, false);
  assert.strictEqual(syntheticActive.result.reason, "synthetic_profile");

  const realManual = await exercise({ synthetic: false, mode: "manual" });
  assert.strictEqual(realManual.sendCalls, 0);
  assert.strictEqual(realManual.result.sent, false);
  assert.strictEqual(realManual.result.reason, "whatsapp_manual_mode");
}

async function run() {
  await testReadonlySql();
  await testStableTenantLock();
  await testConcurrentJobsInitializeOnlyAfterLock();
  testExactTargetBinding();
  testFreezeGate();
  testBackupEventBeforeMutation();
  await testServerSourceFreezeMiddleware();
  await testBackupCreateLoadRestoreAndFailure();
  await testRestartPreservesCompleteSuperadmin();
  await testWhatsappNeverSendsSyntheticOrManualProfiles();
  console.log(JSON.stringify({
    success: true,
    checks: {
      repeatableReadReadonly: "pass",
      noSqlWritesDuringAudit: "pass",
      stableTenantScopedLock: "pass",
      concurrentJobsInitializeOnlyAfterLock: "pass",
      exactTargetBinding: "pass",
      targetUserCliAllowlist: "pass",
      maintenanceFreezeGate: "pass",
      backupEventBeforeMutation: "pass",
      maintenanceFreezeServerSourceRequests: "pass",
      backupCreateLoadRestore: "pass",
      backupDigestTamperRejected: "pass",
      rollbackMismatchNotMarked: "pass",
      restartPreservesCompleteSuperadmin: "pass",
      whatsappSyntheticAndManualFailClosed: "pass"
    }
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
