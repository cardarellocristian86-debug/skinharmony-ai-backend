import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function call(base, method, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("work preflight issues a tenant-bound non-executing Core research directive", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "research-directive-admin";
  const storageRoot = path.join(os.tmpdir(), `core-research-directive-${Date.now()}-${Math.random()}`);
  const { app } = createUniversalCoreService({ storageRoot });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const tenantA = await call(base, "POST", "/v1/keys/generate", { tenant_id: "directive-a", preset: "codex_automation" }, "research-directive-admin");
    const tenantB = await call(base, "POST", "/v1/keys/generate", { tenant_id: "directive-b", preset: "codex_automation" }, "research-directive-admin");
    assert.equal(tenantA.status, 201);
    assert.equal(tenantB.status, 201);
    const body = {
      request: "Verifica la normativa attuale prima della pubblicazione",
      operation_type: "publish",
      evidence_state: {
        source_count: 1,
        confidence: 0.4,
        freshness_state: "stale",
        contradiction_count: 1,
      },
      memory_context: {
        schema_version: "tenant_memory_context_v1",
        tenant_id: "directive-a",
        revision: 1,
        relevant_memories: [],
        pending_handoffs: [],
      },
      gallery_context: {
        schema_version: "tenant_work_gallery_v1",
        tenant_id: "directive-a",
        available: true,
        state: "ready",
        work_count: 1,
        works: [{
          work_id: "11111111-1111-4111-8111-111111111111",
          project_id: "gallery",
          status: "active",
          current_version: 3,
        }],
      },
    };
    const result = await call(base, "POST", "/v1/work/preflight", body, tenantA.json.key);
    assert.equal(result.status, 200);
    const directive = result.json.work_preflight.core_research.directive;
    assert.equal(directive.tenant_scope.tenant_id, "directive-a");
    assert.equal(directive.issued_by, "universal_core");
    assert.equal(directive.authority.research_execution_authorized, false);
    assert.equal(directive.authority.consolidation_authorized, false);
    assert.equal(result.json.work_preflight.operational_surface, "tenant_work_gallery");
    assert.equal(result.json.work_preflight.tenant_work_gallery.tenant_isolated, true);
    assert.equal(result.json.work_preflight.tenant_work_gallery.work_count, 1);

    const crossTenantBody = {
      ...body,
      memory_context: { ...body.memory_context, tenant_id: "directive-a" },
    };
    const denied = await call(base, "POST", "/v1/work/preflight", crossTenantBody, tenantB.json.key);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, "memory_context_tenant_mismatch");

    const galleryDenied = await call(base, "POST", "/v1/work/preflight", {
      ...body,
      memory_context: { ...body.memory_context, tenant_id: "directive-b" },
      gallery_context: { ...body.gallery_context, tenant_id: "directive-a" },
    }, tenantB.json.key);
    assert.equal(galleryDenied.status, 403);
    assert.equal(galleryDenied.json.error, "gallery_context_tenant_mismatch");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("Work-bound Core preflight automatically emits a non-mutating Entity 360 shadow observation", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "entity360-shadow-admin";
  const storageRoot = path.join(os.tmpdir(), `core-entity360-shadow-${Date.now()}-${Math.random()}`);
  const observations = [];
  let releaseObservation;
  const observationGate = new Promise((resolve) => { releaseObservation = resolve; });
  const entity360Runtime = {
    async initialize() {},
    async health() { return { ok: true, ready: true, mode: "SHADOW" }; },
    async invoke() { throw new Error("entity360_route_not_expected"); },
    async preflightObservationGate(identity, input) {
      return {
        schema_version: "entity_360_shadow_observation_gate_v1",
        eligible: true,
        reason: null,
        tenant_scope: identity.tenant_id,
        work_id: input.work_id,
        read_only: true,
        production_decision_changed: false,
        execution_authorized: false,
      };
    },
    async observeCurrentPath(identity, input) {
      observations.push({ identity, input });
      await observationGate;
      return {
        snapshot: { deterministic_immutable_digest: "a".repeat(64) },
        receipt: { comparison_digest: "b".repeat(64), diverged: false },
        production_decision_changed: false,
        execution_authorized: false,
      };
    },
  };
  const entity360Configuration = { policy: { shadow_observation: {
    minimum_interval_ms: 30_000,
    max_inflight_global: 1,
    max_inflight_per_tenant: 1,
    window_ms: 60_000,
    max_starts_per_window: 1,
    max_starts_per_tenant_window: 1,
    max_tracked_work_keys: 8,
    max_tracked_tenants: 8,
    max_gate_inflight_global: 2,
    max_cached_tenant_gates: 8,
    tenant_off_gate_cache_ttl_ms: 5_000,
    gate_timeout_ms: 5_000,
  } } };
  const { app } = createUniversalCoreService({ storageRoot, entity360Mode: "SHADOW",
    entity360Runtime, entity360Configuration });
  await new Promise((resolve) => setImmediate(resolve));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const workId = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
  try {
    const tenant = await call(base, "POST", "/v1/keys/generate",
      { tenant_id: "entity360-shadow-tenant", preset: "codex_automation" },
      "entity360-shadow-admin");
    assert.equal(tenant.status, 201);
    const body = {
      request: "Analizza il Work canonico senza eseguire mutazioni",
      operation_type: "advisory_work",
      memory_context: {
        schema_version: "tenant_memory_context_v1",
        tenant_id: "entity360-shadow-tenant",
        revision: 1,
        relevant_memories: [],
        pending_handoffs: [],
      },
      gallery_context: {
        schema_version: "tenant_work_gallery_v1",
        tenant_id: "entity360-shadow-tenant",
        available: true,
        state: "ready",
        works: [{ work_id: workId, project_id: "nyra_conversational_runtime",
          status: "active", current_version: 2 }],
      },
      work_binding: { work_id: workId, project_id: "nyra_conversational_runtime" },
    };
    const result = await call(base, "POST", "/v1/work/preflight", body, tenant.json.key);
    assert.equal(result.status, 200);
    assert.equal(result.json.guardrail.execution_allowed, false);
    for (let attempt = 0; attempt < 20 && observations.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(observations.length, 1);
    assert.equal(observations[0].identity.actor_id,
      "universal_core:work_preflight_shadow_observer");
    assert.deepEqual(observations[0].identity.authority_scope, ["entity360:shadow-observe"]);
    assert.equal(observations[0].identity.work_id, workId);
    assert.equal(observations[0].input.work_id, workId);
    assert.equal(observations[0].input.preflight.preflight_id,
      result.json.work_preflight.preflight_id);
    assert.equal(observations[0].input.preflight.governance.execution_allowed_by_preflight, false);
    const concurrent = await call(base, "POST", "/v1/work/preflight", body, tenant.json.key);
    assert.equal(concurrent.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(observations.length, 1,
      "policy-bounded singleflight must coalesce concurrent observations for one Work");
    const secondWorkId = "91e82640-9edc-5424-a3e8-eb7853b0d8de";
    const secondWorkBody = {
      ...body,
      gallery_context: { ...body.gallery_context,
        works: [{ ...body.gallery_context.works[0], work_id: secondWorkId }] },
      work_binding: { ...body.work_binding, work_id: secondWorkId },
    };
    const globalInflight = await call(base, "POST", "/v1/work/preflight",
      secondWorkBody, tenant.json.key);
    assert.equal(globalInflight.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(observations.length, 1,
      "policy global in-flight budget must bound observations across Works");
    releaseObservation();
    await new Promise((resolve) => setImmediate(resolve));
    const rateBounded = await call(base, "POST", "/v1/work/preflight",
      secondWorkBody, tenant.json.key);
    assert.equal(rateBounded.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(observations.length, 1,
      "policy global rate window must bound starts across Works");
    const cooldown = await call(base, "POST", "/v1/work/preflight", body, tenant.json.key);
    assert.equal(cooldown.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(observations.length, 1,
      "policy cooldown must prevent append-only snapshot flooding");
  } finally {
    releaseObservation?.();
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("Entity 360 shadow scheduler gates OFF tenants before tenant-scoped and global budgets", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "entity360-shadow-fairness-admin";
  const storageRoot = path.join(os.tmpdir(),
    `core-entity360-shadow-fairness-${Date.now()}-${Math.random()}`);
  const enabledTenants = new Set(["entity360-shadow-a", "entity360-shadow-b"]);
  const gateReads = [];
  const observations = [];
  let releaseOffGate;
  const offGate = new Promise((resolve) => { releaseOffGate = resolve; });
  let releaseStalledGates;
  const stalledGate = new Promise((resolve) => { releaseStalledGates = resolve; });
  let releaseObservations;
  const observationGate = new Promise((resolve) => { releaseObservations = resolve; });
  const entity360Runtime = {
    async initialize() {},
    async health() { return { ok: true, ready: true, mode: "SHADOW" }; },
    async invoke() { throw new Error("entity360_route_not_expected"); },
    async preflightObservationGate(identity, input) {
      gateReads.push({ tenant_id: identity.tenant_id, work_id: input.work_id });
      if (identity.tenant_id.startsWith("entity360-stalled-")) await stalledGate;
      if (identity.tenant_id === "entity360-off") await offGate;
      const eligible = enabledTenants.has(identity.tenant_id);
      return {
        schema_version: "entity_360_shadow_observation_gate_v1",
        eligible,
        reason: eligible ? null : "TENANT_ENTITY360_OFF",
        tenant_scope: identity.tenant_id,
        work_id: input.work_id,
        read_only: true,
        production_decision_changed: false,
        execution_authorized: false,
      };
    },
    async observeCurrentPath(identity, input) {
      observations.push({ identity, input });
      await observationGate;
      return {
        snapshot: { deterministic_immutable_digest: "c".repeat(64) },
        receipt: { comparison_digest: "d".repeat(64), diverged: false },
        production_decision_changed: false,
        execution_authorized: false,
      };
    },
  };
  const entity360Configuration = { policy: { shadow_observation: {
    minimum_interval_ms: 0,
    max_inflight_global: 2,
    max_inflight_per_tenant: 1,
    window_ms: 60_000,
    max_starts_per_window: 2,
    max_starts_per_tenant_window: 1,
    max_tracked_work_keys: 8,
    max_tracked_tenants: 2,
    max_gate_inflight_global: 2,
    max_cached_tenant_gates: 2,
    tenant_off_gate_cache_ttl_ms: 5_000,
    gate_timeout_ms: 100,
  } } };
  const { app } = createUniversalCoreService({ storageRoot, entity360Mode: "SHADOW",
    entity360Runtime, entity360Configuration });
  await new Promise((resolve) => setImmediate(resolve));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tenants = ["entity360-stalled-a", "entity360-stalled-b", "entity360-off",
    "entity360-absent", "entity360-shadow-a", "entity360-shadow-b"];
  const keys = new Map();
  const waitFor = async (predicate, message) => {
    for (let attempt = 0; attempt < 50 && !predicate(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(predicate(), true, message);
  };
  const bodyFor = (tenantId, workId) => ({
    request: "Osserva il Work in shadow senza mutare il percorso corrente",
    operation_type: "advisory_work",
    memory_context: {
      schema_version: "tenant_memory_context_v1",
      tenant_id: tenantId,
      revision: 1,
      relevant_memories: [],
      pending_handoffs: [],
    },
    gallery_context: {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: tenantId,
      available: true,
      state: "ready",
      works: [{ work_id: workId, project_id: "nyra_conversational_runtime",
        status: "active", current_version: 1 }],
    },
    work_binding: { work_id: workId, project_id: "nyra_conversational_runtime" },
  });
  try {
    for (const tenantId of tenants) {
      const generated = await call(base, "POST", "/v1/keys/generate",
        { tenant_id: tenantId, preset: "codex_automation" },
        "entity360-shadow-fairness-admin");
      assert.equal(generated.status, 201);
      keys.set(tenantId, generated.json.key);
    }
    const tenantAFirst = "44444444-4444-5444-8444-444444444444";
    const tenantASecond = "55555555-5555-5555-8555-555555555555";
    const tenantBFirst = "66666666-6666-5666-8666-666666666666";
    const stalledRequests = [
      ["entity360-stalled-a", "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa"],
      ["entity360-stalled-b", "bbbbbbbb-bbbb-5bbb-8bbb-bbbbbbbbbbbb"],
    ];
    for (const [tenantId, workId] of stalledRequests) {
      assert.equal((await call(base, "POST", "/v1/work/preflight",
        bodyFor(tenantId, workId), keys.get(tenantId))).status, 200);
    }
    await waitFor(() => gateReads.filter((item) =>
      item.tenant_id.startsWith("entity360-stalled-")).length === 2,
    "policy-bound global gate slots must cap simultaneous Store probes");
    assert.equal((await call(base, "POST", "/v1/work/preflight",
      bodyFor("entity360-shadow-a", tenantAFirst), keys.get("entity360-shadow-a"))).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(observations.length, 0,
      "the gate backstop must fail closed while every bounded probe slot is occupied");
    await new Promise((resolve) => setTimeout(resolve, 110));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await call(base, "POST", "/v1/work/preflight",
        bodyFor(stalledRequests[attempt % stalledRequests.length][0],
          stalledRequests[attempt % stalledRequests.length][1]),
        keys.get(stalledRequests[attempt % stalledRequests.length][0]))).status, 200);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(gateReads.filter((item) =>
      item.tenant_id.startsWith("entity360-stalled-")).length, 2,
    "response timeouts must not recreate unresolved Store operations");
    assert.equal(observations.length, 0);
    releaseStalledGates();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await call(base, "POST", "/v1/work/preflight",
      bodyFor("entity360-shadow-a", tenantAFirst), keys.get("entity360-shadow-a"))).status, 200);
    await waitFor(() => observations.length === 1,
      "a settled/cancelled Store probe must release its real slot so SHADOW can resume");

    const offWorkIds = [
      "11111111-1111-5111-8111-111111111111",
      "22222222-2222-5222-8222-222222222222",
      "33333333-3333-5333-8333-333333333333",
    ];
    const firstOff = await call(base, "POST", "/v1/work/preflight",
      bodyFor("entity360-off", offWorkIds[0]), keys.get("entity360-off"));
    assert.equal(firstOff.status, 200);
    await waitFor(() => gateReads.filter((item) => item.tenant_id === "entity360-off").length === 1,
      "the first OFF tenant probe must start without blocking current preflight");
    for (const workId of offWorkIds.slice(1)) {
      const result = await call(base, "POST", "/v1/work/preflight",
        bodyFor("entity360-off", workId), keys.get("entity360-off"));
      assert.equal(result.status, 200);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(gateReads.filter((item) => item.tenant_id === "entity360-off").length, 1,
      "concurrent OFF tenant flooding must coalesce into one Store-backed gate probe");
    assert.equal(observations.length, 1,
      "OFF tenants must not start additional automatic shadow observations");
    assert.equal((await call(base, "POST", "/v1/work/preflight",
      bodyFor("entity360-shadow-b", tenantBFirst), keys.get("entity360-shadow-b"))).status, 200);
    await waitFor(() => observations.length === 2,
      "tenant B must proceed while the OFF tenant occupies only its coalesced gate probe");
    assert.equal((await call(base, "POST", "/v1/work/preflight",
      bodyFor("entity360-shadow-a", tenantASecond), keys.get("entity360-shadow-a"))).status, 200);
    await waitFor(() => gateReads.filter((item) => item.tenant_id === "entity360-shadow-a").length === 2,
      "tenant A second Work must be gated");
    assert.equal(observations.length, 2,
      "one tenant cannot monopolize the configured per-tenant in-flight budget");
    releaseOffGate();
    const postReleaseOffWorkIds = [
      "77777777-7777-5777-8777-777777777777",
      "cccccccc-cccc-5ccc-8ccc-cccccccccccc",
      "dddddddd-dddd-5ddd-8ddd-dddddddddddd",
    ];
    const postReleaseOffRequests = postReleaseOffWorkIds.map((workId) =>
      call(base, "POST", "/v1/work/preflight",
        bodyFor("entity360-off", workId), keys.get("entity360-off")));
    assert.deepEqual((await Promise.all(postReleaseOffRequests)).map(({ status }) => status),
      [200, 200, 200]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(gateReads.filter((item) => item.tenant_id === "entity360-off").length, 1,
      "release/cache publication must not reopen the tenant slot or duplicate OFF probes");
    const absentWorkIds = ["88888888-8888-5888-8888-888888888888",
      "99999999-9999-5999-8999-999999999999"];
    assert.equal((await call(base, "POST", "/v1/work/preflight",
      bodyFor("entity360-absent", absentWorkIds[0]), keys.get("entity360-absent"))).status, 200);
    await waitFor(() => gateReads.filter((item) => item.tenant_id === "entity360-absent").length === 1,
      "an absent tenant must perform one fail-closed gate probe");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await call(base, "POST", "/v1/work/preflight",
      bodyFor("entity360-absent", absentWorkIds[1]), keys.get("entity360-absent"))).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(gateReads.filter((item) => item.tenant_id === "entity360-absent").length, 1,
      "an absent tenant must reuse the bounded negative cache without observation accounting");
    assert.equal(observations.length, 2);
    assert.deepEqual(observations.map((item) => item.identity.tenant_id).sort(),
      ["entity360-shadow-a", "entity360-shadow-b"]);
  } finally {
    releaseStalledGates?.();
    releaseOffGate?.();
    releaseObservations?.();
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
