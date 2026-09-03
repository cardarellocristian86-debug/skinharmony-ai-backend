import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("READ_DECISION work preflight has no Entity 360 shadow scheduler", async () => {
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  for (const deadSchedulerSymbol of [
    "entity360ShadowInFlight",
    "readEntity360ShadowTenantGate",
    "reserveEntity360ShadowObservation",
    "observeEntity360WorkPreflight",
  ]) assert.doesNotMatch(appSource, new RegExp(deadSchedulerSymbol, "u"));
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "entity360-read-purity-admin";
  const storageRoot = path.join(os.tmpdir(),
    `core-entity360-read-purity-${Date.now()}-${Math.random()}`);
  const gateReads = [];
  const observations = [];
  const entity360Runtime = {
    async initialize() {},
    async health() { return { ok: true, ready: true, mode: "SHADOW" }; },
    async invoke() { throw new Error("entity360_route_not_expected"); },
    async preflightObservationGate(identity, input) {
      gateReads.push({ identity, input });
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
      throw new Error("entity360_shadow_write_must_not_be_scheduled");
    },
  };
  const entity360Configuration = { policy: { shadow_observation: {
    minimum_interval_ms: 0,
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
      { tenant_id: "entity360-read-purity", preset: "codex_automation" },
      "entity360-read-purity-admin");
    assert.equal(tenant.status, 201);
    const auditFile = path.join(storageRoot, "audit", "events.jsonl");
    const auditBeforeReads = await readFile(auditFile, "utf8").catch(() => "");
    const body = {
      request: "Analizza il Work canonico senza eseguire mutazioni",
      operation_type: "advisory_work",
      memory_context: {
        schema_version: "tenant_memory_context_v1",
        tenant_id: "entity360-read-purity",
        revision: 1,
        relevant_memories: [],
        pending_handoffs: [],
      },
      gallery_context: {
        schema_version: "tenant_work_gallery_v1",
        tenant_id: "entity360-read-purity",
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
    assert.equal((await call(base, "GET", "/v1/nira/branches", undefined,
      tenant.json.key)).status, 200);
    assert.equal((await call(base, "GET", "/v1/branches/maturity", undefined,
      tenant.json.key)).status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(gateReads, [],
      "a READ_DECISION request must not even schedule the shadow writer gate");
    assert.deepEqual(observations, [],
      "a READ_DECISION request must not persist Entity 360 snapshots or receipts");
    assert.equal(await readFile(auditFile, "utf8").catch(() => ""), auditBeforeReads,
      "state-pure production endpoints must not append audit events");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
