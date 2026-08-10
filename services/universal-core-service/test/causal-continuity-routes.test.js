import assert from "node:assert/strict";
import test from "node:test";
import { registerCausalContinuityRoutes } from "../src/causalContinuityRoutes.js";

test("route registrar exposes the versioned causal surface behind injected auth and scopes", () => {
  const routes = [];
  const app = {
    get(path, ...handlers) { routes.push({ method: "GET", path, handlers }); },
    post(path, ...handlers) { routes.push({ method: "POST", path, handlers }); },
  };
  const coreAuth = () => (_req, _res, next) => next();
  const scopeNames = [];
  const scopes = (name) => { scopeNames.push(name); return (_req, _res, next) => next(); };
  const runtime = { async invoke() { return {}; } };
  const resolveAgentContext = async () => ({
    tenant_id: "tenant-auth", agent_id: "agent-auth", session_fingerprint: "session-auth",
    actor_provenance: "provenance-auth", client_type: "codex",
  });
  const registered = registerCausalContinuityRoutes({ app, coreAuth, scopes, runtime, resolveAgentContext });
  assert.equal(routes.length, registered.routes.length);
  assert(routes.some((route) => route.path === "/v1/causal/contexts/issue"));
  assert(routes.some((route) => route.path === "/v1/causal/closures/reopen"));
  assert(routes.some((route) => route.method === "GET" && route.path === "/v1/causal/projects/rollout"));
  assert(routes.some((route) => route.method === "POST" && route.path === "/v1/causal/projects/rollout"));
  assert(routes.some((route) => route.method === "POST" && route.path === "/v1/causal/gallery/bindings/project"));
  assert(routes.some((route) => route.method === "POST" && route.path === "/v1/causal/gallery/projections/claim"));
  assert(routes.some((route) => route.method === "GET" && route.path === "/v1/causal/gallery/views"));
  assert(routes.some((route) => route.method === "GET" && route.path === "/v1/causal/metrics"));
  assert(scopeNames.includes("causal:read"));
  assert(scopeNames.includes("causal:close"));
});

test("route tenant identity comes from authenticated wiring, not request payload", async () => {
  const routes = [];
  const app = { get() {}, post(path, ...handlers) { routes.push({ path, handlers }); } };
  let seenContext;
  let seenInput;
  const runtime = { async invoke(_capability, context, input) { seenContext = context; seenInput = input; return { accepted: true }; } };
  const resolveAgentContext = async (token, tenantId) => {
    assert.equal(token, "signed-dtt-receipt");
    assert.equal(tenantId, "tenant-auth");
    return {
      tenant_id: "tenant-auth", agent_id: "receipt-agent", session_fingerprint: "receipt-session",
      actor_provenance: "receipt-provenance", client_type: "codex", authority_scope: ["causal:write"],
    };
  };
  registerCausalContinuityRoutes({ app, coreAuth: () => (_req, _res, next) => next(), runtime, resolveAgentContext });
  const route = routes.find((item) => item.path === "/v1/causal/projects");
  const handler = route.handlers.at(-1);
  const req = {
    tenantId: "tenant-auth",
    coreKey: { actor_id: "shared-core-key-must-not-be-actor", scopes: ["decision:write"], session_fingerprint: "shared-session" },
    headers: { "x-sh-dtt-agent-context": "signed-dtt-receipt" },
    body: { tenant_id: "tenant-forged", idempotency_key: "x" },
  };
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, response);
  assert.equal(seenContext.tenant_id, "tenant-auth");
  assert.equal(seenContext.actor_id, "receipt-agent");
  assert.equal(seenContext.provenance.session_fingerprint, "receipt-session");
  assert.equal(seenContext.provenance.actor_provenance, "receipt-provenance");
  assert.equal(seenContext.provenance.client_type, "codex");
  assert.equal("tenant_id" in seenInput, false);
  assert.equal(response.statusCode, 201);
});

test("verified receipt authority can narrow but never amplify platform scopes", async () => {
  const routes = [];
  let seenContext;
  const app = { get() {}, post(path, ...handlers) { routes.push({ path, handlers }); } };
  const runtime = { async invoke(_capability, context) { seenContext = context; return { accepted: true }; } };
  registerCausalContinuityRoutes({
    app, coreAuth: () => (_req, _res, next) => next(), runtime,
    resolveAgentContext: async () => ({
      tenant_id: "tenant-auth", agent_id: "agent-auth", session_fingerprint: "session-auth",
      actor_provenance: "receipt-auth", client_type: "codex", owner_confirmed: true,
      authority_scope: ["causal:read", "intent:approve:strategic"],
    }),
  });
  const handler = routes.find((item) => item.path === "/v1/causal/projects").handlers.at(-1);
  const response = responseHarness();
  await handler({
    tenantId: "tenant-auth", coreKey: { scopes: ["causal:read", "causal:write"], owner_confirmed: false },
    headers: { "x-sh-dtt-agent-context": "signed" }, body: { idempotency_key: "scope-narrowing" },
  }, response);
  assert.deepEqual(seenContext.authority_scope, ["causal:read"]);
  assert.equal(seenContext.owner_confirmed, false);
  assert.equal(seenContext.authority_scope.includes("intent:approve:strategic"), false);
});

function routeHarness(resolveAgentContext) {
  const routes = [];
  const app = { get() {}, post(path, ...handlers) { routes.push({ path, handlers }); } };
  const runtime = { async invoke() { return { accepted: true }; } };
  registerCausalContinuityRoutes({
    app,
    coreAuth: () => (_req, _res, next) => next(),
    runtime,
    resolveAgentContext,
  });
  return routes.find((item) => item.path === "/v1/causal/projects").handlers.at(-1);
}

function responseHarness() {
  return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("causal routes fail closed when DTT agent context is absent", async () => {
  const handler = routeHarness(async () => { throw new Error("must not be called"); });
  const response = responseHarness();
  await handler({ tenantId: "tenant-auth", headers: {}, body: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error.code, "AGENT_CONTEXT_REQUIRED");
});

test("causal routes fail closed when DTT agent receipt is invalid", async () => {
  const handler = routeHarness(async () => { throw new Error("invalid signature"); });
  const response = responseHarness();
  await handler({ tenantId: "tenant-auth", headers: { "x-sh-dtt-agent-context": "invalid" }, body: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error.code, "AGENT_CONTEXT_INVALID");
});

test("causal routes reject a verified DTT receipt from another tenant", async () => {
  const handler = routeHarness(async () => ({
    tenant_id: "tenant-other", agent_id: "agent", session_fingerprint: "session",
    actor_provenance: "provenance", client_type: "codex",
  }));
  const response = responseHarness();
  await handler({ tenantId: "tenant-auth", headers: { "x-sh-dtt-agent-context": "signed" }, body: {} }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, "CAUSAL_IDENTITY_MISMATCH");
});

test("causal route registration requires an explicit DTT context resolver", () => {
  const app = { get() {}, post() {} };
  assert.throws(
    () => registerCausalContinuityRoutes({ app, coreAuth: () => () => {}, runtime: { invoke() {} } }),
    (error) => error.code === "AGENT_CONTEXT_RESOLVER_REQUIRED",
  );
});
