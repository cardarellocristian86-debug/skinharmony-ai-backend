import assert from "node:assert/strict";
import test from "node:test";

import { TOOLS } from "../src/tool-definitions.js";
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

function boundedCollaborationTool(name = "tenant_work_dynamic_join") {
  return {
    name,
    title: "Bounded tenant collaboration",
    description: "Coordinates tenant work without transferring owner authority.",
    scopes: ["core:govern"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { "skinharmony/ownerConfirmationRequired": false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        work_id: { type: "string", minLength: 1 },
        idempotency_key: { type: "string", minLength: 1 },
      },
      required: ["work_id", "idempotency_key"],
    },
  };
}

test("publishes a fixed compact MCP surface below the connector import budget", () => {
  const handlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({})]));
  const compact = compactMcpTools(TOOLS, handlers);

  assert.deepEqual(compact.map((tool) => tool.name), COMPACT_MCP_TOOL_NAMES);
  assert.equal(compact.length, 13);
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

test("bounded collaboration mutations keep wrapper confirmation out of target arguments", async () => {
  const tool = boundedCollaborationTool();
  let received;
  const handlers = {
    [tool.name]: async (args) => {
      received = args;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => ({
      structuredContent: { authorization: { allowed: true } },
    }),
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;

  await router.core_capability_invoke({
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "bounded-wrapper-1",
    owner_confirmed: true,
    confirmation_reference: "owner-approved-wrapper",
    arguments: {
      work_id: "work-a",
      idempotency_key: "bounded-target-1",
    },
  }, identity);

  assert.deepEqual(received, {
    work_id: "work-a",
    idempotency_key: "bounded-target-1",
  });
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
