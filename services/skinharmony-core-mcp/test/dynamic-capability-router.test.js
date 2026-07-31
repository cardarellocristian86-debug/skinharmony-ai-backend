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
  kind: "codex",
  subject: "codex|owner",
  role: "owner_root",
  scopes: ["core:read", "core:govern"],
  ownerConfirmed: true,
};

const boundedMemberIdentity = {
  tenantId: "tenant-a",
  kind: "oauth",
  subject: "oauth|member-a",
  role: "member",
  oauthTenantMemberBound: true,
  tenantMembershipRole: "member",
  scopes: ["core:read", "core:govern"],
  ownerConfirmed: false,
  agentPresence: {
    agent_id: "member-agent-a",
    client_type: "chatgpt",
    session_id: "member-session-a",
    signature: "ags_verified_member_a",
  },
};

const horizontalExposure = Object.freeze({
  exposure_class: "chatgpt_horizontal",
  allowed_client_types: ["chatgpt", "codex", "api_agent", "admin"],
  allowed_audiences: ["chatgpt_connector", "codex_internal", "api_agent", "admin_control_room"],
  discoverable_in_connector: true,
  semantic_select_allowed: true,
});

function readTool(name = "nyra_dynamic_read") {
  return {
    name,
    title: "Dynamic read",
    description: "Reads a tenant-bound capability.",
    scopes: ["core:read"],
    exposure: horizontalExposure,
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
    exposure: horizontalExposure,
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
        idempotency_key: { type: "string", minLength: 8 },
      },
      required: ["value", "owner_confirmed"],
    },
  };
}

function boundedGalleryTool(name = "tenant_work_branch_open") {
  return {
    name,
    title: "Join tenant work",
    description: "Joins shared tenant work through a bounded Core action.",
    scopes: ["core:govern"],
    exposure: horizontalExposure,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      "skinharmony/ownerConfirmationRequired": false,
      "skinharmony/tenantBoundedCollaboration": true,
      "skinharmony/boundedActionType": "work.branch.open",
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        work_id: { type: "string", minLength: 1 },
        agent_id: { type: "string", minLength: 1 },
        client_type: { type: "string", minLength: 1 },
        session_id: { type: "string", minLength: 1 },
        idempotency_key: { type: "string", minLength: 8 },
      },
      required: ["work_id", "agent_id", "client_type", "session_id", "idempotency_key"],
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
  const toolDefinitions = [...TOOLS, ...WORK_CONTINUITY_TOOLS];
  const handlers = Object.fromEntries(toolDefinitions.map((tool) => [tool.name, async () => ({})]));
  const compact = compactMcpTools(toolDefinitions, handlers);

  assert.deepEqual(compact.map((tool) => tool.name), COMPACT_MCP_TOOL_NAMES);
  assert.equal(compact.length, 13);
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

test("unknown or incomplete capabilities stay hidden until explicitly classified", () => {
  const unknown = { ...readTool("mystery_capability") };
  delete unknown.exposure;
  const handlers = { mystery_capability: async () => ({}) };
  const snapshot = dynamicCapabilityCatalogSnapshot([unknown], handlers);

  assert.deepEqual(snapshot.capabilities, []);
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
    /dynamic_capability_catalog_revision_mismatch|dynamic_capability_unavailable/,
  );
});

test("mutations fail closed unless owner confirmation, Core gate, and safe arguments agree", async () => {
  const tool = writeTool();
  let writes = 0;
  let receivedArguments = null;
  let gateAllowed = true;
  const handlers = {
    [tool.name]: async (arguments_) => {
      writes += 1;
      receivedArguments = arguments_;
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
    idempotency_key: "write-01",
    owner_confirmed: true,
    confirmation_reference: "owner-approved",
    arguments: { value: "safe" },
  };

  await router.core_capability_invoke(args, identity);
  assert.equal(writes, 1);
  assert.equal(receivedArguments.idempotency_key, "write-01");

  gateAllowed = false;
  await assert.rejects(
    router.core_capability_invoke({ ...args, idempotency_key: "write-02" }, identity),
    /dynamic_capability_not_authorized/,
  );
  assert.equal(writes, 1);

  await assert.rejects(
    router.core_capability_invoke(
      { ...args, idempotency_key: "write-03", arguments: { value: "unsafe", nested: { tenant_id: "tenant-b" } } },
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

test("bounded Gallery mutations accept a verified tenant member and overwrite spoofed presence", async () => {
  const tool = boundedGalleryTool();
  let receivedArguments;
  let receivedGate;
  const handlers = {
    [tool.name]: async (arguments_) => {
      receivedArguments = arguments_;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async (input) => {
      receivedGate = input;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const result = await router.core_capability_invoke({
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "gallery-join-01",
    arguments: {
      work_id: "work-a",
      agent_id: "spoofed-agent",
      client_type: "other",
      session_id: "spoofed-session",
    },
  }, boundedMemberIdentity);

  assert.deepEqual(receivedArguments, {
    work_id: "work-a",
    agent_id: "member-agent-a",
    client_type: "chatgpt",
    session_id: "member-session-a",
    idempotency_key: "gallery-join-01",
  });
  assert.equal(receivedGate.tool.name, tool.name);
  assert.equal(receivedGate.identity, boundedMemberIdentity);
  assert.equal(result.structuredContent.dynamic_capability.tenant_bounded_collaboration, true);
  assert.equal(result.structuredContent.dynamic_capability.gate_allowed, true);
});

test("bounded Gallery mutations fail closed for unbound membership, invalid presence, and unsafe payloads", async () => {
  const tool = boundedGalleryTool();
  let writes = 0;
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
      structuredContent: { authorization: { allowed: true } },
    }),
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const request = {
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "gallery-join-02",
    arguments: { work_id: "work-a" },
  };

  for (const caller of [
    { ...boundedMemberIdentity, agentPresence: undefined },
    { ...boundedMemberIdentity, oauthTenantMemberBound: false },
    { ...boundedMemberIdentity, tenantMembershipRole: "unbound" },
    {
      ...boundedMemberIdentity,
      agentPresence: {
        ...boundedMemberIdentity.agentPresence,
        signature: "caller-declared",
      },
    },
    { ...boundedMemberIdentity, tenantId: "" },
  ]) {
    await assert.rejects(
      router.core_capability_invoke(request, caller),
      /tenant_work_membership_required|tenant_collaboration_identity_required/,
    );
  }
  await assert.rejects(
    router.core_capability_invoke({
      ...request,
      arguments: { work_id: "work-a", nested: { tenant_id: "tenant-b" } },
    }, boundedMemberIdentity),
    /dynamic_capability_reserved_argument/,
  );
  assert.equal(writes, 0);
});

test("bounded internal mutations use target metadata instead of impersonating the owner", async () => {
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
  assert.deepEqual(received.args, {
    value: "verified receipt",
    idempotency_key: "agent-report-1",
  });
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

test("semantic selection rejects every candidate without an exact visible catalog binding", async () => {
  const tool = readTool("nyra_dynamic_read");
  const handlers = { [tool.name]: async () => ({}) };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => {
      throw new Error("semantic_selector_must_not_run");
    },
  });

  for (const candidate of [
    { id: "mystery_capability", text: "Looks harmless" },
    { id: "skin_private_read", text: "Prefixed vertical" },
    { id: "operations_silver", text: "Non-prefixed vertical" },
  ]) {
    await assert.rejects(
      router.core_semantic_select({ candidates: [candidate] }, identity),
      /branch_not_available_for_client/,
    );
  }
});
