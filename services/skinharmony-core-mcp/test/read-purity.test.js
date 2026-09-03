import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createApp,
  qualifiesForStatePureReadPath,
  requiresGenericWorkPreflight,
  TOOLS,
} from "../src/app.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";
import { attachObservedContinuity } from "../src/work-preflight-observation.js";
import { createResearchAirlockRuntime } from "../../universal-core-service/src/researchAirlock.js";
import { createMemoryResearchAirlockStore } from "../../universal-core-service/src/researchAirlockStore.js";

const WORK_ID = "00000000-0000-4000-8000-000000000001";
const PURE_READ_CASES = Object.freeze([
  ["work_preflight", { request: "Inspect current work", work_id: WORK_ID }],
  ["work_continuity_read", { work_id: WORK_ID }],
  ["work_continuity_intent_read", { work_id: WORK_ID }],
  ["work_continuity_work_catalog", {}],
  ["work_continuity_v2_read", { work_id: WORK_ID }],
  ["tenant_work_gallery_list", {}],
  ["tenant_work_gallery_list_v2", { view: "operational" }],
  ["tenant_work_coordination_read", { work_id: WORK_ID }],
  ["tenant_work_coordination_overview", {}],
  ["decision_ledger_report", {}],
  ["agent_list", {}],
  ["message_inbox", { agent_id: "codex-reader" }],
]);

function mcpConfig() {
  return {
    publicUrl: "https://mcp.example.test",
    resource: "https://mcp.example.test/mcp",
    auth0Issuer: "https://tenant.auth0.com",
    auth0Audience: "https://core",
    jwksUri: "https://tenant.auth0.com/.well-known/jwks.json",
    codexKeys: ["codex-read-purity-key"],
    codexScopes: ["core:read", "core:govern"],
    defaultTenantId: "tenant-read-purity",
    supportedScopes: ["core:read", "core:govern"],
  };
}

test("gateway pure-read lifecycle performs only handler SELECTs and no wrapper mutations", async () => {
  for (const [name] of PURE_READ_CASES) {
    const definition = TOOLS.find((tool) => tool.name === name)
      || WORK_CONTINUITY_TOOLS.find((tool) => tool.name === name);
    assert.ok(definition, `missing definition for ${name}`);
    assert.equal(definition.annotations.readOnlyHint, true, `${name} must be declared read-only`);
    assert.notEqual(definition.annotations.openWorldHint, true,
      `${name} must not bypass the Research Airlock when open-world`);
    if (!TOOLS.some((tool) => tool.name === name)) TOOLS.push(definition);
    assert.equal(qualifiesForStatePureReadPath(name, TOOLS), true, `${name} must be proven pure`);
    assert.equal(requiresGenericWorkPreflight(name), false, `${name} must not materialize continuity`);
  }

  const queries = [];
  const query = async (sql) => {
    queries.push(String(sql));
    return { rows: [] };
  };
  const handlers = Object.fromEntries(PURE_READ_CASES.map(([name]) => [name, async (args) => {
    await query(`SELECT '${name}' AS capability`);
    if (name !== "work_preflight") {
      return { structuredContent: { ok: true, capability: name }, content: [] };
    }
    return attachObservedContinuity({
      structuredContent: {
        ok: true,
        tenant_id: "tenant-read-purity",
        work_preflight: {
          schema_version: "skinharmony_work_preflight_v1",
          preflight_id: "preflight-read-purity",
          tenant_id: "tenant-read-purity",
          mandatory: true,
        },
        tenant_work_gallery: {
          works: [{
            work_id: WORK_ID,
            project_id: "project-read-purity",
            status: "active",
            current_version: 7,
            next_action: "Observe only",
          }],
        },
      },
      content: [],
    }, args, "project-read-purity");
  }]));
  const app = createApp(mcpConfig(), {
    handlers,
    beforeToolCall: async ({ toolName }) => {
      if (qualifiesForStatePureReadPath(toolName, TOOLS)) {
        return { statePureReadPath: true, ledgerContext: null, preflight: null };
      }
      await query("INSERT INTO decision_ledger DEFAULT VALUES");
      return {};
    },
    afterToolCall: async (event) => {
      if (event.hookContext?.statePureReadPath === true ||
          qualifiesForStatePureReadPath(event.toolName, TOOLS)) return;
      await query("UPDATE core_continuity_session_bindings SET updated_at=NOW()");
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, args] of PURE_READ_CASES) {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer codex-read-purity-key",
          "content-type": "application/json",
          "mcp-session-id": "read-purity-session",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: name,
          method: "tools/call",
          params: { name, arguments: {
            ...args,
            agent_id: "codex-reader",
            client_type: "codex",
            session_id: "read-purity-session",
          } },
        }),
      }).then((value) => value.json());
      assert.equal(response.error, undefined, `${name}: ${JSON.stringify(response.error)}`);
      if (name === "work_preflight") {
        const binding = response.result.structuredContent.work_preflight.continuity;
        assert.equal(binding.observation_only, true);
        assert.equal(binding.materialized, false);
        assert.deepEqual(binding.read_binding, {
          state: "observed_only",
          session_bound: false,
          participant_joined: false,
          lease_acquired: false,
          heartbeat_recorded: false,
          control_context_persisted: false,
        });
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(queries.length, PURE_READ_CASES.length);
  assert.equal(queries.every((sql) => /^SELECT\b/i.test(sql)), true, queries.join("\n"));
});

test("production lifecycle bypass precedes every mutating hook and explicit preflight is observational", () => {
  const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const beforeStart = source.indexOf("beforeToolCall: async");
  const beforeEnd = source.indexOf("afterToolCall: async", beforeStart);
  const before = source.slice(beforeStart, beforeEnd);
  const classification = before.indexOf("const statePureReadPath = qualifiesForStatePureReadPath(toolName, TOOLS)");
  const airlock = before.indexOf("coreHandlers.nyra_research_airlock_state_pure_authorize");
  const bypass = before.indexOf("if (statePureReadPath) {", airlock);
  assert.ok(classification >= 0);
  assert.ok(airlock > classification);
  assert.ok(bypass > airlock);
  for (const mutation of [
    "registerAuthenticatedPresence(identity)",
    "decisionLedger.startWork(identity",
    "ensureContinuity(",
  ]) {
    if (mutation === "registerAuthenticatedPresence(identity)") {
      assert.ok(before.indexOf(mutation) > classification && before.indexOf(mutation) < airlock);
    } else {
      assert.ok(before.indexOf(mutation) > bypass, `${mutation} must follow pure-read bypass`);
    }
  }

  const after = source.slice(beforeEnd, source.indexOf("const startupReadiness", beforeEnd));
  assert.match(after, /event\.hookContext\?\.statePureReadPath === true/);
  assert.match(after, /qualifiesForStatePureReadPath\(event\.toolName, TOOLS\)/);

  const handlerStart = source.indexOf("work_preflight: async (args, identity) => {");
  const handlerEnd = source.indexOf("...createMemoryHandlers", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /return attachObservedContinuity\(/);
  assert.doesNotMatch(handler, /ensureContinuity\(/);
  assert.doesNotMatch(handler, /materializeNyraControlContext\(/);
  assert.doesNotMatch(handler, /ensureNyraReadBinding\(/);
});

test("DISCOVERY_OPEN blocks private pure reads before their handlers run without mutating Airlock", async () => {
  const store = createMemoryResearchAirlockStore();
  const airlock = createResearchAirlockRuntime({
    store,
    signingSecret: "read-purity-airlock-secret-000000000000000",
    mode: "enforced",
    allowTestStore: true,
    releaseCommitSha: "b".repeat(40),
    transport: { fetch: async () => { throw new Error("fetch_not_expected"); } },
  });
  const workBinding = {
    project_id: "project-read-purity",
    work_id: "work-read-purity",
    session_id: "read-purity-session",
  };
  const plan = await airlock.createPlan({
    work_binding: workBinding,
    source_urls: ["https://www.nist.gov/ai"],
  }, { tenantId: "tenant-read-purity" });
  await airlock.createWork({
    work_binding: workBinding,
    plan_capability: plan.plan_capability,
  }, { tenantId: "tenant-read-purity" });
  const before = await airlock.status("tenant-read-purity");
  let handlerCalls = 0;
  const app = createApp(mcpConfig(), {
    handlers: {
      workspace_read_document: async () => {
        handlerCalls += 1;
        return { structuredContent: { ok: true }, content: [] };
      },
      memory_context: async () => {
        handlerCalls += 1;
        return { structuredContent: { ok: true }, content: [] };
      },
    },
    beforeToolCall: async ({ identity, toolName }) => {
      const decision = await airlock.authorizeSessionToolReadOnly({
        session_id: identity.agentPresence.session_id,
        tool_name: toolName,
      }, { tenantId: identity.tenantId });
      if (decision.verdict !== "ALLOW") {
        const error = new Error(decision.reason);
        error.code = decision.reason;
        error.status = 403;
        throw error;
      }
      return { statePureReadPath: true };
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, args] of [
      ["workspace_read_document", { path: "private/customer.json" }],
      ["memory_context", { query: "private customer context" }],
    ]) {
      const result = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer codex-read-purity-key",
          "content-type": "application/json",
          "mcp-session-id": "read-purity-session",
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: name, method: "tools/call",
          params: { name, arguments: {
            ...args,
            agent_id: "codex-reader",
            client_type: "codex",
            session_id: "read-purity-session",
          } },
        }),
      }).then((response) => response.json());
      assert.equal(result.result?.isError, true, JSON.stringify(result));
      assert.match(result.result.content[0].text, /research_airlock_public_phase_tool_denied/);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(handlerCalls, 0);
  assert.deepEqual(await airlock.status("tenant-read-purity"), before);
});

test("DTT reads that can issue participant context retain governed lifecycle", () => {
  for (const capabilityId of [
    "entity_360_snapshot_read",
    "software_cognition_challenge_read",
    "nyra_precore_decision_read",
  ]) {
    assert.equal(qualifiesForStatePureReadPath("core_capability_read", TOOLS), false);
    assert.equal(requiresGenericWorkPreflight("core_capability_read", {
      capability_id: capabilityId,
    }), true, capabilityId);
  }
});
