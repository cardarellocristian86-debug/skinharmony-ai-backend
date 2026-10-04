import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import { createDttWorkBootstrapBindingResolver } from "../src/dtt-work-bootstrap-binding.js";
import { authorizeDttExactWorkRead } from "../src/work-continuity-runtime.js";
import {
  DTT_WORK_BOOTSTRAP_CONTEXT_HEADER,
  verifyDttWorkBootstrapContext,
} from "../../shared/dtt-work-context.js";

const TENANT_ID = "tenant-a";
const WORK_ID = "11111111-1111-8111-8111-111111111111";
const SECRET = "dtt-bootstrap-integration-signing-secret-0123456789";
const GATEWAY_KEY = "dtt-bootstrap-integration-gateway-key-0123456789";

function presence(overrides = {}) {
  return {
    transport_bound: true, agent_id: "agent-a", session_id: "session-a", client_type: "codex",
    session_fingerprint: "a".repeat(24), host_transport_session_fingerprint: "b".repeat(24),
    signature: `ags_${"c".repeat(32)}`, opaque_agent_id: `ai_${"d".repeat(24)}`,
    actor_provenance: `ap_${"e".repeat(32)}`,
    ...overrides,
  };
}

function readyWork(overrides = {}) {
  return {
    tenant_id: TENANT_ID, work_id: WORK_ID, project_id: "project-a",
    intent_digest: "a".repeat(64), causal_lineage_state: "READY",
    causal_lineage_digest: "b".repeat(64),
    ...overrides,
  };
}

function resolverFor(store, { readsCapability = () => {}, now } = {}) {
  return createDttWorkBootstrapBindingResolver({
    authorizeExactWorkRead: authorizeDttExactWorkRead,
    store,
    withTenantWorkAcl: (identity) => ({ ...identity, tenant_work_acl: { server_derived: true } }),
    requireTenantWorkCapability: readsCapability,
    aclError: (code, status) => Object.assign(new Error(code), { code, status }),
    ...(now ? { now } : {}),
  });
}

test("Entity360 bootstrap uses the real DTT ACL resolver once and signs its canonical READY Work", async () => {
  let reads = 0;
  let fetches = 0;
  const resolver = resolverFor({ async readWork(identity, input) {
    reads += 1;
    assert.equal(input.work_id, WORK_ID);
    assert.equal(identity.tenant_work_acl.server_derived, true);
    return { schema_version: "work_continuity_v2", work: readyWork() };
  } });
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test", tenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: SECRET, dttAgentIdentitySigningSecret: SECRET,
  }, {
    resolveDttWorkBootstrapBinding: resolver,
    fetchImpl: async (url, init) => {
      fetches += 1;
      const body = JSON.parse(init.body);
      const verified = verifyDttWorkBootstrapContext({
        token: init.headers[DTT_WORK_BOOTSTRAP_CONTEXT_HEADER], secret: SECRET,
        expected_tenant_id: TENANT_ID, expected_work_id: WORK_ID, method: "POST",
        path: "/v1/entity-360/snapshots/bootstrap", body,
      });
      assert.equal(verified.execution_authorized, false);
      return new Response(JSON.stringify({ ok: true }), { status: 200,
        headers: { "content-type": "application/json" } });
    },
  });
  const args = { work_id: WORK_ID, expected_revision: 0,
    idempotency_key: `entity360-work-bootstrap-${WORK_ID}` };
  await handlers.dttWorkBootstrapCoreRequest("/v1/entity-360/snapshots/bootstrap", args,
    { tenantId: TENANT_ID, agentPresence: presence() }, { method: "POST", body: args });
  assert.equal(reads, 1);
  assert.equal(fetches, 1);
});

test("DTT bootstrap denies cross-bound Work, unsigned presence, and pending lineage before Core fetch", async () => {
  for (const scenario of [
    { name: "cross-tenant", work: readyWork({ tenant_id: "tenant-b" }), error: "dtt_work_acl_denied", signed: true },
    { name: "cross-work", work: readyWork({ work_id: "22222222-2222-4222-8222-222222222222" }), error: "dtt_work_acl_denied", signed: true },
    { name: "unsigned", work: readyWork(), error: "dtt_work_signed_presence_required", signed: false },
    { name: "lineage pending", work: readyWork({ causal_lineage_state: "PENDING" }), error: "dtt_work_bootstrap_binding_denied", signed: true },
  ]) {
    let reads = 0;
    let fetches = 0;
    const resolver = resolverFor({ async readWork() {
      reads += 1;
      return { schema_version: "work_continuity_v2", work: scenario.work };
    } });
    const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test",
      tenantGatewayKey: GATEWAY_KEY, tenantContextSigningSecret: SECRET,
      dttAgentIdentitySigningSecret: SECRET }, {
      resolveDttWorkBootstrapBinding: resolver,
      fetchImpl: async () => { fetches += 1; throw new Error("fetch_must_not_run"); },
    });
    const args = { work_id: WORK_ID, expected_revision: 0 };
    await assert.rejects(() => handlers.dttWorkBootstrapCoreRequest(
      "/v1/entity-360/snapshots/bootstrap", args,
      { tenantId: TENANT_ID, agentPresence: presence({ transport_bound: scenario.signed }) },
      { method: "POST", body: args },
    ), new RegExp(scenario.error));
    assert.equal(reads, scenario.signed ? 1 : 0, scenario.name);
    assert.equal(fetches, 0, scenario.name);
  }
});
