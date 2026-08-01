import assert from "node:assert/strict";
import test from "node:test";

import { TOOLS } from "../src/tool-definitions.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";
import {
  COMPACT_MCP_TOOL_NAMES,
  compactMcpTools,
  createDynamicCapabilityHandlers,
  dynamicCapabilityCatalogSnapshot,
} from "../src/dynamic-capability-router.js";

const identity = {
  tenantId: "tenant-a",
  scopes: ["core:read", "core:govern"],
  ownerConfirmed: true,
};

function readTool(name = "nyra_dynamic_read") {
  return {
    name,
    title: "Dynamic read",
    description: "Reads a tenant-bound capability.",
    scopes: ["core:read"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
    },
  };
}

function writeTool(name = "workspace_dynamic_write") {
  return {
    name,
    title: "Dynamic write",
    description: "Writes through the governed capability router.",
    scopes: ["core:govern"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { "skinharmony/ownerConfirmationRequired": true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: "string", minLength: 1 },
        owner_confirmed: { type: "boolean" },
        confirmation_reference: { type: "string" },
      },
      required: ["value", "owner_confirmed"],
    },
  };
}

function delegatedWriteTool(name = "orchestration_dtt_agent_report") {
  const definition = writeTool(name);
  definition._meta = { "skinharmony/ownerConfirmationRequired": false };
  delete definition.inputSchema.properties.owner_confirmed;
  delete definition.inputSchema.properties.confirmation_reference;
  definition.inputSchema.required = ["value"];
  return definition;
}

function dedicatedCoreWriteTool(name = "host_native_action_reserve") {
  const definition = delegatedWriteTool(name);
  definition._meta["skinharmony/dedicatedCoreGate"] = true;
  return definition;
}

test("publishes a fixed compact MCP surface below the connector import budget", () => {
  const handlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({})]));
  const compact = compactMcpTools(TOOLS, handlers);

  assert.deepEqual(compact.map((tool) => tool.name), COMPACT_MCP_TOOL_NAMES);
  assert.equal(compact.length, 7);
  assert.equal(compact.some((tool) => tool.name.startsWith("tenant_provider_openai_")), false);
  assert(Buffer.byteLength(JSON.stringify({ tools: compact })) < 64 * 1024);
});

test("adds capabilities through the catalog without changing the connector surface", () => {
  const firstTools = [readTool()];
  const firstHandlers = { nyra_dynamic_read: async () => ({}) };
  const first = dynamicCapabilityCatalogSnapshot(firstTools, firstHandlers);
  const surfaceBefore = [...COMPACT_MCP_TOOL_NAMES];

  const secondTools = [...firstTools, readTool("nyra_future_read")];
  const secondHandlers = { ...firstHandlers, nyra_future_read: async () => ({}) };
  const second = dynamicCapabilityCatalogSnapshot(secondTools, secondHandlers);

  assert.notEqual(first.catalog_revision, second.catalog_revision);
  assert.deepEqual(COMPACT_MCP_TOOL_NAMES, surfaceBefore);
  assert.deepEqual(second.capabilities.map((item) => item.capability_id), [
    "nyra_dynamic_read",
    "nyra_future_read",
  ]);
});

test("reads only exact server-registered capabilities with scopes and a fresh revision", async () => {
  const tool = readTool();
  let received;
  const handlers = {
    [tool.name]: async (args, caller) => {
      received = { args, caller };
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const result = await router.core_capability_read({
    capability_id: tool.name,
    catalog_revision: revision,
    arguments: { query: "status" },
  }, identity);

  assert.deepEqual(received, { args: { query: "status" }, caller: identity });
  assert.equal(result.structuredContent.dynamic_capability.capability_id, tool.name);
  await assert.rejects(
    router.core_capability_read({
      capability_id: tool.name,
      catalog_revision: "0".repeat(64),
      arguments: { query: "status" },
    }, identity),
    /dynamic_capability_catalog_revision_mismatch/,
  );
  await assert.rejects(
    router.core_capability_read({
      capability_id: tool.name,
      catalog_revision: revision,
      arguments: { query: "status" },
    }, { ...identity, scopes: [] }),
    /insufficient_scope/,
  );
});

test("mutations fail closed unless owner confirmation, Core gate, and safe arguments agree", async () => {
  const tool = writeTool();
  let writes = 0;
  let gateAllowed = true;
  const handlers = {
    [tool.name]: async () => {
      writes += 1;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => ({
      structuredContent: { authorization: { allowed: gateAllowed } },
    }),
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const args = {
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "write-1",
    owner_confirmed: true,
    confirmation_reference: "owner-approved",
    arguments: { value: "safe" },
  };

  await router.core_capability_invoke(args, identity);
  assert.equal(writes, 1);

  gateAllowed = false;
  await assert.rejects(
    router.core_capability_invoke({ ...args, idempotency_key: "write-2" }, identity),
    /dynamic_capability_not_authorized/,
  );
  assert.equal(writes, 1);

  await assert.rejects(
    router.core_capability_invoke(
      { ...args, idempotency_key: "write-3", arguments: { value: "unsafe", nested: { tenant_id: "tenant-b" } } },
      identity,
    ),
    /dynamic_capability_reserved_argument/,
  );
  await assert.rejects(
    router.core_capability_invoke(args, { ...identity, ownerConfirmed: false }),
    /owner_confirmation_required/,
  );
  assert.equal(writes, 1);
});

test("allows only a metadata-free agent heartbeat without owner confirmation", async () => {
  const tool = writeTool("agent_heartbeat");
  tool.inputSchema.properties = {
    agent_id: { type: "string" },
    client_type: { type: "string" },
    session_id: { type: "string" },
    display_name: { type: "string" },
    capabilities: { type: "array", items: { type: "string" } },
    owner_confirmed: { type: "boolean" },
    confirmation_reference: { type: "string" },
  };
  tool.inputSchema.required = ["agent_id", "client_type", "session_id", "owner_confirmed"];
  let received;
  let gatedTool;
  const handlers = {
    agent_heartbeat: async (args) => {
      received = args;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async ({ tool: target }) => {
      gatedTool = target;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const minimal = {
    capability_id: "agent_heartbeat",
    catalog_revision: revision,
    idempotency_key: "heartbeat-minimal-1",
    arguments: { agent_id: "agent-a", client_type: "codex", session_id: "session-a" },
  };

  const result = await router.core_capability_invoke(minimal, { ...identity, ownerConfirmed: false });
  assert.equal(gatedTool._meta["skinharmony/ownerConfirmationRequired"], false);
  assert.equal(result.structuredContent.dynamic_capability.owner_confirmation_required, false);
  assert.deepEqual(received, { ...minimal.arguments, owner_confirmed: false });

  for (const arguments_ of [
    { ...minimal.arguments, display_name: "Custom agent" },
    { ...minimal.arguments, capabilities: ["release_governance"] },
    { ...minimal.arguments, capabilities: "release_governance" },
  ]) {
    await assert.rejects(
      router.core_capability_invoke(
        { ...minimal, idempotency_key: `blocked-${String(arguments_.display_name || arguments_.capabilities)}`, arguments: arguments_ },
        { ...identity, ownerConfirmed: false },
      ),
      /owner_confirmation_required/,
    );
  }
});

test("bounded internal mutations use the target metadata instead of impersonating the owner", async () => {
  const tool = delegatedWriteTool();
  let received;
  let gated = 0;
  const handlers = {
    [tool.name]: async (args, caller) => {
      received = { args, caller };
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => {
      gated += 1;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const caller = { ...identity, ownerConfirmed: false };
  const result = await router.core_capability_invoke({
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "agent-report-1",
    arguments: { value: "verified receipt" },
  }, caller);

  assert.equal(gated, 1);
  assert.deepEqual(received.args, { value: "verified receipt" });
  assert.equal(received.caller, caller);
  assert.equal(result.structuredContent.dynamic_capability.owner_confirmation_required, false);
  assert.equal(result.structuredContent.dynamic_capability.owner_confirmation_satisfied, true);
});

test("dedicated Core routes replace the generic gate only with a verified Core marker", async () => {
  const tool = dedicatedCoreWriteTool();
  let genericGateCalls = 0;
  let markerAuthorized = true;
  const handlers = {
    [tool.name]: async () => ({
      structuredContent: {
        ok: true,
        dedicated_core_gate: {
          authorized: markerAuthorized,
          authority: "universal_core",
        },
      },
    }),
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => {
      genericGateCalls += 1;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const args = {
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "reserve-ticket-1",
    arguments: { value: "ticket" },
  };

  const result = await router.core_capability_invoke(args, {
    ...identity,
    ownerConfirmed: false,
  });
  assert.equal(genericGateCalls, 0);
  assert.equal(
    result.structuredContent.dynamic_capability.gate_source,
    "universal_core_dedicated_route",
  );

  markerAuthorized = false;
  await assert.rejects(
    router.core_capability_invoke(
      { ...args, idempotency_key: "reserve-ticket-2" },
      { ...identity, ownerConfirmed: false },
    ),
    /dynamic_capability_dedicated_core_gate_unverified/,
  );
  assert.equal(genericGateCalls, 0);
});

test("OAuth-owner continuity bootstrap capabilities use only their server-owned Core gate", async () => {
  const bootstrapTools = WORK_CONTINUITY_TOOLS.filter((tool) => [
    "work_continuity_create",
    "work_continuity_start_or_resume",
  ].includes(tool.name));
  assert.deepEqual(bootstrapTools.map((tool) => tool.name), [
    "work_continuity_create",
    "work_continuity_start_or_resume",
  ]);
  for (const tool of bootstrapTools) {
    assert.equal(tool._meta["skinharmony/dedicatedCoreGate"], true);
    assert.equal(tool._meta["skinharmony/serverOwnedGovernance"], true);
  }
  assert.equal(WORK_CONTINUITY_TOOLS
    .filter((tool) => !bootstrapTools.includes(tool))
    .some((tool) => tool._meta?.["skinharmony/serverOwnedGovernance"] === true), false);
  assert.equal(WORK_CONTINUITY_TOOLS
    .filter((tool) => !bootstrapTools.includes(tool))
    .some((tool) => tool._meta?.["skinharmony/dedicatedCoreGate"] === true), false);

  for (const tool of bootstrapTools) {
    let genericGateCalls = 0;
    let includeMarker = true;
    const handlers = {
      [tool.name]: async (args, caller) => {
        assert.equal(caller.kind, "oauth");
        assert.equal(caller.oauthOwnerElevated, true);
        assert.equal(caller.ownerConfirmed, true);
        assert.equal(args.owner_confirmed, true);
        assert.equal(args.confirmation_reference, "owner-approved-work-bootstrap");
        return {
          structuredContent: {
            ok: true,
            ...(includeMarker ? {
              dedicated_core_gate: {
                authorized: true,
                authority: "universal_core",
                server_owned: true,
              },
            } : {}),
          },
        };
      },
    };
    const router = createDynamicCapabilityHandlers({
      tools: [tool],
      handlers,
      semanticSelect: async () => ({}),
      gateAction: async () => {
        genericGateCalls += 1;
        return { structuredContent: { authorization: { allowed: true } } };
      },
    });
    const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
    const argumentsByTool = tool.name === "work_continuity_create"
      ? {
        project_id: "client-project",
        session_id: "owner-session",
        idea: "Create the client work",
        objective: "Track the work",
        architecture: {},
        next_action: "Start the approved work",
      }
      : {
        project_id: "client-project",
        session_id: "owner-session",
        initial_message: "Create the client work",
        idea: "Create the client work",
        objective: "Track the work",
        architecture: {},
        next_action: "Start the approved work",
      };
    const args = {
      capability_id: tool.name,
      catalog_revision: revision,
      idempotency_key: `bootstrap-${tool.name}`,
      owner_confirmed: true,
      confirmation_reference: "owner-approved-work-bootstrap",
      arguments: argumentsByTool,
    };
    const oauthOwner = {
      ...identity,
      kind: "oauth",
      subject: "auth0|client-owner",
      oauthOwnerBound: true,
      oauthOwnerElevated: true,
      ownerConfirmed: true,
      confirmationReference: "owner-approved-work-bootstrap",
    };

    const result = await router.core_capability_invoke(args, oauthOwner);
    assert.equal(genericGateCalls, 0);
    assert.equal(result.structuredContent.dynamic_capability.gate_source, "universal_core_dedicated_route");

    includeMarker = false;
    await assert.rejects(
      router.core_capability_invoke({ ...args, idempotency_key: `missing-marker-${tool.name}` }, oauthOwner),
      /dynamic_capability_dedicated_core_gate_unverified/,
    );
    assert.equal(genericGateCalls, 0);
  }
});

test("semantic selection builds candidates from the server catalog and never authorizes execution", async () => {
  const tools = [readTool(), writeTool()];
  const handlers = Object.fromEntries(tools.map((tool) => [tool.name, async () => ({})]));
  let selectedArgs;
  const router = createDynamicCapabilityHandlers({
    tools,
    handlers,
    semanticSelect: async (args) => {
      selectedArgs = args;
      return { structuredContent: { selected: [args.candidates[0].id] } };
    },
  });

  const result = await router.core_semantic_select({
    query: "read current status",
    capability_ids: ["nyra_dynamic_read"],
  }, identity);

  assert.deepEqual(selectedArgs.candidates.map((item) => item.id), ["nyra_dynamic_read"]);
  assert.equal(result.structuredContent.execution_authorized, false);
  assert.deepEqual(result.structuredContent.candidate_capability_ids, ["nyra_dynamic_read"]);
});
