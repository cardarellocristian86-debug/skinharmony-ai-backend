import assert from "node:assert/strict";
import test from "node:test";
import { createSuiteClient, SuiteClientError } from "../src/suite-client.js";

function config(overrides = {}) {
  return {
    suiteControlPlaneUrl: "https://suite.example.test",
    suiteControlPlaneKeys: { "tenant-a": "secret-a", "tenant-b": "secret-b" },
    suiteControlPlaneTimeoutMs: 100,
    suiteControlPlaneCacheTtlMs: 0,
    ...overrides,
  };
}

test("binds every Suite request to the authenticated tenant and server-side key", async () => {
  const calls = [];
  const client = createSuiteClient(config(), {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ ok: true, scope: { tenant_id: "tenant-a", node_id: "node-a" } }), { status: 200 });
    },
  });

  await client.cockpit360({ tenantId: "tenant-a" }, "node-a");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/suite\/cockpit-360\?node_id=node-a$/);
  assert.equal(calls[0].options.headers["x-sh-tenant-id"], "tenant-a");
  assert.equal(calls[0].options.headers["x-sh-suite-key"], "secret-a");
  assert.equal(calls[0].options.redirect, "error");
});

test("supports an explicit server-side MCP-to-Suite tenant binding", async () => {
  let headers;
  const client = createSuiteClient(config({
    suiteControlPlaneKeys: { codexai: "suite-key" },
    suiteControlPlaneTenantMap: { codexai: "skinharmony-suite" },
  }), {
    fetchImpl: async (_url, options) => {
      headers = options.headers;
      return new Response(JSON.stringify({ ok: true, scope: { tenant_id: "skinharmony-suite" } }), { status: 200 });
    },
  });
  await client.cockpit360({ tenantId: "codexai" });
  assert.equal(headers["x-sh-tenant-id"], "skinharmony-suite");
  assert.equal(headers["x-sh-suite-key"], "suite-key");
});

test("fails closed when a tenant has no server-side Suite binding", async () => {
  let called = false;
  const client = createSuiteClient(config({ suiteControlPlaneKeys: { "tenant-a": "secret-a" } }), {
    fetchImpl: async () => { called = true; return new Response("{}"); },
  });
  await assert.rejects(
    client.cockpit360({ tenantId: "tenant-b" }),
    (error) => error instanceof SuiteClientError && error.code === "suite_tenant_binding_missing" && error.status === 403,
  );
  assert.equal(called, false);
});

test("rejects an upstream response bound to another tenant", async () => {
  const client = createSuiteClient(config(), {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, scope: { tenant_id: "tenant-b" } }), { status: 200 }),
  });
  await assert.rejects(
    client.cockpit360({ tenantId: "tenant-a" }),
    (error) => error.code === "suite_upstream_tenant_mismatch" && error.status === 502,
  );
});

test("normalizes timeouts and upstream errors without leaking provider messages", async () => {
  const timeoutClient = createSuiteClient(config({ suiteControlPlaneTimeoutMs: 10 }), {
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("provider secret details");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(
    timeoutClient.cockpit360({ tenantId: "tenant-a" }),
    (error) => error.code === "suite_control_plane_timeout" && error.retryable === true && !error.message.includes("secret"),
  );

  const errorClient = createSuiteClient(config(), {
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: "suite_backend_failure",
      message: "secret-a must never be returned",
    }), { status: 503 }),
  });
  await assert.rejects(
    errorClient.cockpit360({ tenantId: "tenant-a" }),
    (error) => error.code === "suite_backend_failure" && error.message === "suite_backend_failure" && error.retryable === true,
  );
});

test("caches only tenant-scoped GET responses", async () => {
  let calls = 0;
  const client = createSuiteClient(config({ suiteControlPlaneCacheTtlMs: 10_000 }), {
    fetchImpl: async (_url, options) => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true, scope: { tenant_id: options.headers["x-sh-tenant-id"] }, calls }), { status: 200 });
    },
  });
  const first = await client.cockpit360({ tenantId: "tenant-a" });
  const replay = await client.cockpit360({ tenantId: "tenant-a" });
  const otherTenant = await client.cockpit360({ tenantId: "tenant-b" });
  assert.equal(first.calls, 1);
  assert.equal(replay.calls, 1);
  assert.equal(otherTenant.calls, 2);
  assert.equal(calls, 2);
});

test("decision preview forwards only the bounded model contract", async () => {
  let request;
  const client = createSuiteClient(config(), {
    fetchImpl: async (url, options) => {
      request = { url: String(url), body: JSON.parse(options.body), headers: options.headers };
      return new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a", mode: "preview_only" }), { status: 200 });
    },
  });
  await client.decisionPreview({ tenantId: "tenant-a" }, {
    question: "What should change?",
    branch_keys: ["pricing_margin"],
    node_id: "node-a",
    tenant_id: "tenant-b",
    url: "https://attacker.invalid",
    api_key: "attacker-key",
  });
  assert.match(request.url, /\/api\/suite\/nyra\/decision-preview$/);
  assert.deepEqual(request.body, { text: "What should change?", node_id: "node-a", branches: ["pricing_margin"] });
  assert.equal(request.headers["x-sh-tenant-id"], "tenant-a");
});
