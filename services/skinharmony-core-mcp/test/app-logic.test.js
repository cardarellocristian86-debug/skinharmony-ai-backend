import assert from "node:assert/strict";
import test from "node:test";
import {
  attachWorkPreflight,
  configureToolForRuntime,
  filterToolsForClient,
  hasTenantBoundChatGptReadCompatibility,
  requiresGenericWorkPreflight,
  resolveStaleChatGptReadTool,
  TOOLS,
} from "../src/app.js";

function tenantBoundChatGptCompatibilityIdentity(overrides = {}) {
  return {
    kind: "oauth",
    subject: "chatgpt-user",
    tenantId: "tenant-a",
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1",
      authenticated: true,
      tenant_id: "tenant-a",
      subject: "chatgpt-user",
    },
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: false,
      auth_kind: "oauth",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.read"],
    },
    ...overrides,
  };
}

test("keeps claim-only OAuth on Nyra while granting a tenant-bound governed read allowlist", () => {
  const claimOnlyTools = filterToolsForClient(TOOLS, { kind: "oauth" });
  assert.deepEqual(claimOnlyTools.map((tool) => tool.name), ["nyra_converse"]);

  const compatibility = tenantBoundChatGptCompatibilityIdentity();
  const names = filterToolsForClient(TOOLS, compatibility).map((tool) => tool.name);
  for (const name of [
    "core_health",
    "core_capability_catalog",
    "core_branch_registry",
    "core_semantic_select",
    "core_capability_read",
    "nyra_converse",
  ]) assert.equal(names.includes(name), true, name);
  assert.equal(names.includes("work_preflight"), false, "preflight remains cached/internal");
  for (const name of ["core_capability_invoke", "tenant_work_evidence_record", "host_native_delegation_issue"]) {
    assert.equal(names.includes(name), false, name);
  }
  assert.equal(hasTenantBoundChatGptReadCompatibility(compatibility, "core_capability_read"), true);
  assert.equal(hasTenantBoundChatGptReadCompatibility({
    ...compatibility,
    authenticatedTenantMembership: { ...compatibility.authenticatedTenantMembership, tenant_id: "tenant-b" },
  }, "core_capability_read"), false, "tenant membership cannot be injected across tenants");
  assert.equal(filterToolsForClient(TOOLS, { kind: "codex" }).length, TOOLS.length);
});

test("keeps governed reads and one governed continuation tool for a registered conversational host", () => {
  const identity = {
    kind: "oauth",
    subject: "chatgpt-user",
    tenantId: "tenant-a",
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1",
      authenticated: true,
      tenant_id: "tenant-a",
      subject: "chatgpt-user",
    },
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      registry_revision: "a".repeat(64),
      app_id: "chatgpt_prod",
      auth_kind: "oauth",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.read", "governed_continue"],
    },
  };
  const names = filterToolsForClient(TOOLS, identity).map((tool) => tool.name);
  for (const name of [
    "nyra_converse", "nyra_governed_continue", "core_health",
    "core_capability_catalog", "core_branch_registry", "core_semantic_select",
    "core_capability_read",
  ]) assert.equal(names.includes(name), true, name);
  assert.equal(names.includes("work_preflight"), false, "preflight remains cached/internal");
  assert.equal(filterToolsForClient(TOOLS, {
    ...identity,
    authenticatedHostPrincipal: {
      ...identity.authenticatedHostPrincipal,
      registered: false,
      capabilities: ["work.read"],
    },
  }).some((tool) => tool.name === "nyra_governed_continue"), false);
});

test("routes only verified tenant-bound stale governed reads to Core", () => {
  const nyra = TOOLS.find((tool) => tool.name === "nyra_converse");
  const health = TOOLS.find((tool) => tool.name === "core_health");
  const routedNyra = configureToolForRuntime(nyra, { environmentRoutingRequired: true });
  const routedHealth = configureToolForRuntime(health, { environmentRoutingRequired: true });
  assert.equal(routedNyra.inputSchema.required.includes("environment"), false);
  assert.equal(routedHealth.inputSchema.required.includes("environment"), true);
  assert.equal(
    resolveStaleChatGptReadTool("skinharmony_nyra_core.core_health", tenantBoundChatGptCompatibilityIdentity(), [nyra]),
    "core_health",
  );
  const registered = tenantBoundChatGptCompatibilityIdentity({
    authenticatedHostPrincipal: {
      ...tenantBoundChatGptCompatibilityIdentity().authenticatedHostPrincipal,
      registered: true,
    },
  });
  for (const toolName of ["core_health", "core_capability_catalog", "core_branch_registry", "core_semantic_select"]) {
    assert.equal(
      resolveStaleChatGptReadTool(`skinharmony_nyra_core.${toolName}`, registered, [nyra]),
      toolName,
      `${toolName} stays a direct governed read for a registered host`,
    );
  }
  assert.equal(
    resolveStaleChatGptReadTool("skinharmony_nyra_core.work_preflight", tenantBoundChatGptCompatibilityIdentity(), [nyra]),
    "work_preflight",
  );
  assert.equal(
    resolveStaleChatGptReadTool("skinharmony_nyra_core.work_preflight", { kind: "oauth" }, [nyra]),
    "nyra_converse",
  );
  assert.equal(
    resolveStaleChatGptReadTool("skinharmony_nyra_core.core_capability_invoke", tenantBoundChatGptCompatibilityIdentity(), [nyra]),
    null,
  );
});

test("preserves a registered ChatGPT native-tooling capability-filtered Core surface", () => {
  const tools = [
    { name: "nyra_converse", annotations: { readOnlyHint: true } },
    { name: "core_health", annotations: { readOnlyHint: true } },
    { name: "memory_context", annotations: { readOnlyHint: true } },
    { name: "memory_checkpoint", annotations: { readOnlyHint: false } },
    { name: "core_capability_read", annotations: { readOnlyHint: true } },
    { name: "core_capability_invoke", annotations: { readOnlyHint: false } },
  ];
  const identity = {
    kind: "oauth",
    authenticatedHostPrincipal: {
      registered: true,
      auth_kind: "oauth",
      client_type: "chatgpt",
      interaction_mode: "native_tooling",
      capabilities: ["core.read"],
    },
  };
  assert.deepEqual(filterToolsForClient(tools, identity).map((tool) => tool.name), [
    "core_health", "memory_context", "core_capability_read",
  ]);
});

test("advertises explicit confirmation fields only on write tools", () => {
  const readTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint === true);
  const writeTools = TOOLS.filter((tool) => tool.annotations.readOnlyHint === false);
  assert(writeTools.length > 0);
  const confirmedWrites = writeTools.filter((tool) => tool._meta?.["skinharmony/ownerConfirmationRequired"] !== false);
  const advisoryWrites = writeTools.filter((tool) => tool._meta?.["skinharmony/ownerConfirmationRequired"] === false);
  assert(confirmedWrites.every((tool) => tool.inputSchema.properties.owner_confirmed?.type === "boolean"));
  assert(confirmedWrites.every((tool) => tool.inputSchema.properties.confirmation_reference?.type === "string"));
  assert(advisoryWrites
    .filter((tool) => !["core_capability_invoke", "nyra_governed_continue"].includes(tool.name))
    .every((tool) => tool.inputSchema.properties.owner_confirmed === undefined));
  const governedContinue = advisoryWrites.find((tool) => tool.name === "nyra_governed_continue");
  assert.equal(governedContinue.inputSchema.properties.owner_confirmed.type, "boolean");
  assert.equal(governedContinue._meta["skinharmony/nyraGovernedContinuation"], true);
  assert(advisoryWrites
    .filter((tool) => !["core_capability_invoke", "nyra_governed_continue"].includes(tool.name))
    .every((tool) => tool.inputSchema.properties.confirmation_reference === undefined));
  const dynamicInvoke = advisoryWrites.find((tool) => tool.name === "core_capability_invoke");
  assert.equal(dynamicInvoke.inputSchema.properties.owner_confirmed.type, "boolean");
  assert.equal(dynamicInvoke.inputSchema.properties.confirmation_reference.type, "string");
  assert.deepEqual(
    advisoryWrites.map((tool) => tool.name),
    [
      "nyra_governed_continue",
      "core_capability_invoke",
      "orchestration_dtt_core_join",
      "ai_work_quality_observe",
      "nyra_research_airlock_bootstrap",
      "nyra_research_airlock_plan",
      "nyra_research_airlock_open",
      "nyra_research_airlock_discover",
      "nyra_research_airlock_seal",
      "nyra_research_airlock_private_enter",
      "nyra_research_airlock_tool_authorize",
      "nyra_research_airlock_complete",
    ],
  );
  assert(readTools.every((tool) => tool.inputSchema.properties.owner_confirmed === undefined));
});

test("routes normal actions through generic preflight without deadlocking Work bootstrap", () => {
  assert.equal(requiresGenericWorkPreflight("core_semantic_select"), true);
  assert.equal(
    requiresGenericWorkPreflight("core_capability_invoke", { capability_id: "workspace_write_document" }),
    true,
    "dynamic mutations must receive a server-issued Work Preflight",
  );
  for (const capability_id of [
    "tenant_work_open_review",
    "work_continuity_v2_create",
    "tenant_work_queue_create_v3",
  ]) {
    assert.equal(
      requiresGenericWorkPreflight("core_capability_invoke", { capability_id }),
      false,
      `${capability_id} must reach its dedicated pre-Work Core gate`,
    );
    assert.equal(
      requiresGenericWorkPreflight(capability_id),
      false,
      `${capability_id} must remain preflight-free on a direct surface`,
    );
  }
  for (const capability_id of [
    "tenant_work_open_review_extra",
    "work_continuity_v2_create_replay",
    "tenant_work_queue_create_v4",
  ]) {
    assert.equal(
      requiresGenericWorkPreflight("core_capability_invoke", { capability_id }),
      true,
      `${capability_id} must not inherit the exact bootstrap exemption`,
    );
  }
  assert.equal(
    requiresGenericWorkPreflight("core_capability_invoke", {
      capability_id: "agent_heartbeat",
      arguments: { agent_id: "bootstrap", client_type: "codex" },
    }),
    false,
    "the metadata-free heartbeat bootstrap remains the sole invoke exception",
  );
  assert.equal(
    requiresGenericWorkPreflight("core_capability_invoke", {
      capability_id: "agent_heartbeat",
      arguments: { agent_id: "bootstrap", client_type: "codex", display_name: "Decorated" },
    }),
    true,
    "a decorated heartbeat must receive a server-issued preflight",
  );
  assert.equal(requiresGenericWorkPreflight("core_health"), false);
  assert.equal(requiresGenericWorkPreflight("work_preflight"), false);
  assert.equal(
    requiresGenericWorkPreflight("nyra_converse"),
    false,
    "Nyra conversation owns its cache-or-one-preflight protocol",
  );
});

test("Airlock controls never invoke generic preflight before the public plan is open", () => {
  for (const name of [
    "nyra_research_airlock_status",
    "nyra_research_airlock_bootstrap",
    "nyra_research_airlock_plan",
    "nyra_research_airlock_open",
    "nyra_research_airlock_discover",
    "nyra_research_airlock_seal",
    "nyra_research_airlock_private_enter",
    "nyra_research_airlock_tool_authorize",
    "nyra_research_airlock_complete",
  ]) assert.equal(requiresGenericWorkPreflight(name), false, `${name} must remain isolated from generic preflight`);
});

test("does not expose client-selectable product packs on horizontal Core tools", () => {
  for (const name of ["work_preflight", "nyra_runtime_context", "nyra_interpret_request"]) {
    const definition = TOOLS.find((tool) => tool.name === name);
    assert(definition, `missing tool definition ${name}`);
    assert.equal(definition.inputSchema.properties.domain_pack, undefined);
  }
});

test("aligns Nyra branch request limits with Universal Core", () => {
  for (const name of ["work_preflight", "nyra_interpret_request"]) {
    const definition = TOOLS.find((tool) => tool.name === name);
    assert(definition, `missing tool definition ${name}`);
    assert.equal(definition.inputSchema.properties.nyra_branches.maxItems, 64);
  }
});

test("reports a completed read-only preflight as executable", () => {
  const result = attachWorkPreflight(
    { structuredContent: { documents: [] }, content: [] },
    {
      work_preflight: {
        preflight_id: "preflight-read",
        state: "ready_read_only",
        tool_routing: { preferred_route: { id: "tenant_shared_workspace" } },
        operational_surface: "tenant_work_gallery",
        gallery_version: "tenant_work_gallery_v1",
        tenant_work_gallery: { state: "ready", work_count: 1 },
        governance: { execution_allowed_by_preflight: true },
      },
    },
  );
  assert.equal(result.structuredContent.work_preflight.state, "completed_read_only");
  assert.equal(result.structuredContent.work_preflight.operational_surface, "tenant_work_gallery");
  assert.equal(result.structuredContent.work_preflight.tenant_work_gallery.state, "ready");
  assert.equal(JSON.parse(result.content.at(-1).text).mandatory_work_preflight.gallery_state, "ready");
  assert.equal(JSON.parse(result.content.at(-1).text).mandatory_work_preflight.execution_allowed, true);
});

test("reports a confirmed Core-gated write as completed", () => {
  const result = attachWorkPreflight(
    {
      structuredContent: {
        gate: {
          allowed: true,
          owner_confirmation_required: true,
          confirmation_satisfied: true,
        },
      },
      content: [],
    },
    {
      work_preflight: {
        preflight_id: "preflight-write",
        state: "routed_owner_confirmed_waiting_for_core_verdict",
        tool_routing: { preferred_route: { id: "tenant_shared_workspace" } },
        governance: { execution_allowed_by_preflight: false, owner_confirmation_satisfied: true },
      },
    },
  );
  assert.equal(result.structuredContent.work_preflight.state, "completed_after_core_gate");
  assert.equal(result.structuredContent.work_preflight.governance.execution_authorized_by_core_gate, true);
  assert.equal(result.structuredContent.work_preflight.governance.owner_confirmation_required, false);
  assert.equal(JSON.parse(result.content.at(-1).text).mandatory_work_preflight.execution_allowed, true);
});
