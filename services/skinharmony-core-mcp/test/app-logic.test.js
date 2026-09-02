import assert from "node:assert/strict";
import test from "node:test";
import {
  attachWorkPreflight,
  configureToolForRuntime,
  filterToolsForClient,
  hasTenantBoundChatGptReadCompatibility,
  normalizeLegacyNyraContinueArguments,
  requiresCanonicalWorkReadAuthorization,
  requiresGenericWorkPreflight,
  resolveConnectorToolName,
  resolveNyraConnectorFrontDoorFallback,
  resolveStaleChatGptReadTool,
  TOOLS,
} from "../src/app.js";
import { compactMcpTools } from "../src/dynamic-capability-router.js";
import { NYRA_AUTOPILOT_TOOLS } from "../src/nyra-autopilot-tools.js";
import { ENTITY_360_TOOLS } from "../src/entity-360.js";
import { validateToolArguments } from "../src/schema-validation.js";

test("resolves only deployed Nyra front-door descriptors across catalog projection drift", () => {
  assert.equal(resolveNyraConnectorFrontDoorFallback(
    "skinharmony_nyra_core.nyra_control_room_status", TOOLS,
  ), "nyra_control_room_status");
  assert.equal(resolveNyraConnectorFrontDoorFallback(
    "skinharmony_nyra_core.nyra_converse", TOOLS,
  ), "nyra_converse");
  assert.equal(resolveNyraConnectorFrontDoorFallback(
    "skinharmony_nyra_core.nyra_converse", TOOLS, { dialogueEnabled: false },
  ), null);
  for (const name of [
    "core_health",
    "core_capability_invoke",
    "work_continuity_v2_create",
    "not_registered",
  ]) {
    assert.equal(resolveNyraConnectorFrontDoorFallback(
      `skinharmony_nyra_core.${name}`, TOOLS,
    ), null, name);
  }
});

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

test("routes only the retired governed continuation name to the opaque current contract", () => {
  assert.equal(resolveConnectorToolName("nyra_governed_continue", TOOLS), "nyra_continue");
  assert.equal(
    resolveConnectorToolName("skinharmony_nyra_core.nyra_governed_continue", TOOLS),
    "nyra_continue",
  );
  for (const lookalike of [
    "unknown_governed_continue",
    "nyra_governed_continue ",
    "NYRA_GOVERNED_CONTINUE",
    "constructor",
    "toString",
    "skinharmony_nyra_core.nyra_governed_continue.extra",
    ["nyra_governed_continue"],
    [["nyra_governed_continue"]],
    ["skinharmony_nyra_core.nyra_governed_continue"],
  ]) {
    assert.equal(resolveConnectorToolName(lookalike, TOOLS), null);
  }

  const normalized = normalizeLegacyNyraContinueArguments({
    operation: "review_work_bootstrap",
    candidate_attestation: `nyc1_${"x".repeat(40)}`,
    review_id: "11111111-1111-4111-8111-111111111111",
    review_digest: "a".repeat(64),
    idempotency_key: "legacy-continuation-test",
  });
  assert.deepEqual(normalized, {
    operation: "review_work_bootstrap",
    continuation_ref: `nyc1_${"x".repeat(40)}`,
    idempotency_key: "legacy-continuation-test",
  });

  const ambiguous = normalizeLegacyNyraContinueArguments({
    operation: "authorize_action",
    candidate_attestation: `nyc1_${"a".repeat(40)}`,
    continuation_ref: `nyc1_${"b".repeat(40)}`,
    idempotency_key: "legacy-continuation-conflict",
  });
  const violations = validateToolArguments(
    TOOLS.find((tool) => tool.name === "nyra_continue").inputSchema,
    ambiguous,
  );
  assert(violations.some((item) =>
    item.path === "$.candidate_attestation" && item.code === "additional_property"));
});

test("keeps claim-only and unregistered conversational hosts on the Nyra front door plus read-only status", () => {
  const claimOnlyTools = filterToolsForClient(TOOLS, { kind: "oauth" });
  assert.deepEqual(claimOnlyTools.map((tool) => tool.name), ["nyra_control_room_status", "nyra_converse"]);

  const compatibility = tenantBoundChatGptCompatibilityIdentity();
  const names = filterToolsForClient(TOOLS, compatibility).map((tool) => tool.name);
  assert.deepEqual(names, ["nyra_control_room_status", "nyra_converse"]);
  assert.equal(hasTenantBoundChatGptReadCompatibility(compatibility, "core_capability_read"), true);
  assert.equal(hasTenantBoundChatGptReadCompatibility({
    ...compatibility,
    authenticatedTenantMembership: { ...compatibility.authenticatedTenantMembership, tenant_id: "tenant-b" },
  }, "core_capability_read"), false, "tenant membership cannot be injected across tenants");

  const unregisteredCodex = {
    kind: "codex",
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: false,
      auth_kind: "bearer",
      client_type: "codex",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.read"],
    },
  };
  assert.deepEqual(filterToolsForClient(TOOLS, unregisteredCodex).map((tool) => tool.name), ["nyra_control_room_status", "nyra_converse"]);
  assert.equal(filterToolsForClient(TOOLS, { kind: "codex" }).length, TOOLS.length);
});

test("hides Nyra Dialogue entrypoints when disabled but preserves direct Control Room status", () => {
  const identity = tenantBoundChatGptCompatibilityIdentity();
  const names = filterToolsForClient(TOOLS, identity, false).map((tool) => tool.name);
  assert.equal(names.includes("nyra_converse"), false);
  assert.equal(names.includes("nyra_continue"), false);
  assert.equal(names.includes("nyra_governed_continue"), false);
  assert.equal(names.includes("nyra_control_room_status"), true);
});

test("exposes Nyra plus read-only Control Room status to every registered conversational host", () => {
  const serverTools = [...TOOLS, ...NYRA_AUTOPILOT_TOOLS];
  const identity = {
    kind: "oauth",
    subject: "codex-user",
    tenantId: "tenant-a",
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1",
      authenticated: true,
      tenant_id: "tenant-a",
      subject: "codex-user",
    },
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      registry_revision: "a".repeat(64),
      app_id: "codex_conversational",
      auth_kind: "oauth",
      host_kind: "codex_native",
      client_type: "codex",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.read", "work.coordinate", "governed_continue"],
    },
  };
  for (const clientType of ["codex", "other"]) {
    const names = filterToolsForClient(serverTools, {
      ...identity,
      authenticatedHostPrincipal: {
        ...identity.authenticatedHostPrincipal,
        client_type: clientType,
        app_id: `${clientType}_conversational`,
      },
    }).map((tool) => tool.name);
    assert.deepEqual(names, [
      "nyra_control_room_status",
      "nyra_converse",
      "nyra_continue",
      "nyra_work_assignment_claim",
      "nyra_work_assignment_submit",
    ], clientType);
  }
  const activationNames = filterToolsForClient(serverTools, {
    ...identity,
    authenticatedHostPrincipal: {
      ...identity.authenticatedHostPrincipal,
      capabilities: [...identity.authenticatedHostPrincipal.capabilities, "core.operate"],
    },
  }).map((tool) => tool.name);
  assert.deepEqual(activationNames, [
    "nyra_control_room_status",
    "nyra_converse",
    "nyra_continue",
    "nyra_autopilot_enable",
    "nyra_work_assignment_claim",
    "nyra_work_assignment_submit",
  ]);
  assert.equal(filterToolsForClient(TOOLS, {
    ...identity,
    authenticatedHostPrincipal: {
      ...identity.authenticatedHostPrincipal,
      registered: false,
      capabilities: ["work.read"],
    },
  }).map((tool) => tool.name).join(","), "nyra_control_room_status,nyra_converse");
});

test("keeps governed Entity 360 transitions reachable only for Core-operate holders on the compact Nyra surface", () => {
  const serverTools = [...TOOLS, ...NYRA_AUTOPILOT_TOOLS, ...ENTITY_360_TOOLS];
  const handlers = Object.fromEntries(serverTools.map((tool) => [tool.name, async () => ({})]));
  const compactTools = compactMcpTools(serverTools, handlers);
  const identity = {
    kind: "oauth",
    tenantId: "tenant-a",
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1",
      authenticated: true,
      tenant_id: "tenant-a",
      subject: "owner-a",
    },
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      app_id: "nyra-conversational-owner",
      auth_kind: "oauth",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.read"],
    },
  };
  const namesWithoutCoreOperate = filterToolsForClient(compactTools, identity)
    .map((tool) => tool.name);
  assert.equal(namesWithoutCoreOperate.includes("nyra_control_room_status"), true);
  assert.equal(namesWithoutCoreOperate.includes("entity_360_shadow_enable"), false);
  assert.equal(namesWithoutCoreOperate.includes("entity_360_shadow_disable"), false);

  const namesWithCoreOperate = filterToolsForClient(compactTools, {
    ...identity,
    authenticatedHostPrincipal: {
      ...identity.authenticatedHostPrincipal,
      capabilities: ["work.read", "core.operate"],
    },
  }).map((tool) => tool.name);
  assert.equal(namesWithCoreOperate.includes("entity_360_shadow_enable"), true);
  assert.equal(namesWithCoreOperate.includes("entity_360_shadow_disable"), true);
});

test("routes stale conversational Core read descriptors to Nyra", () => {
  const nyra = TOOLS.find((tool) => tool.name === "nyra_converse");
  const health = TOOLS.find((tool) => tool.name === "core_health");
  const routedNyra = configureToolForRuntime(nyra, { environmentRoutingRequired: true });
  const routedHealth = configureToolForRuntime(health, { environmentRoutingRequired: true });
  assert.equal(routedNyra.inputSchema.required.includes("environment"), false);
  assert.equal(routedHealth.inputSchema.required.includes("environment"), true);
  assert.equal(
    resolveStaleChatGptReadTool("skinharmony_nyra_core.core_health", tenantBoundChatGptCompatibilityIdentity(), [nyra]),
    "nyra_converse",
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
      "nyra_converse",
      `${toolName} is translated to the Nyra front door`,
    );
  }
  assert.equal(
    resolveStaleChatGptReadTool("skinharmony_nyra_core.work_preflight", tenantBoundChatGptCompatibilityIdentity(), [nyra]),
    "nyra_converse",
  );
  assert.equal(
    resolveStaleChatGptReadTool("skinharmony_nyra_core.work_preflight", { kind: "oauth" }, [nyra]),
    "nyra_converse",
  );
  assert.equal(
    resolveStaleChatGptReadTool(
      "skinharmony_nyra_core.nyra_control_room_status",
      tenantBoundChatGptCompatibilityIdentity(),
      [],
      {},
      false,
    ),
    "nyra_control_room_status",
    "a cached Control Room descriptor must not restart Nyra Dialogue",
  );
  assert.equal(
    resolveStaleChatGptReadTool("skinharmony_nyra_core.core_capability_invoke", tenantBoundChatGptCompatibilityIdentity(), [nyra]),
    null,
  );
});

test("preserves a registered Codex native-tooling capability-filtered Core surface", () => {
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
      client_type: "codex",
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
    .filter((tool) => !["core_capability_invoke", "nyra_continue"].includes(tool.name))
    .every((tool) => tool.inputSchema.properties.owner_confirmed === undefined));
  const governedContinue = advisoryWrites.find((tool) => tool.name === "nyra_continue");
  assert.equal(governedContinue.inputSchema.properties.owner_confirmed.type, "boolean");
  assert.equal(governedContinue._meta["skinharmony/nyraGovernedContinuation"], true);
  assert(advisoryWrites
    .filter((tool) => !["core_capability_invoke", "nyra_continue"].includes(tool.name))
    .every((tool) => tool.inputSchema.properties.confirmation_reference === undefined));
  const dynamicInvoke = advisoryWrites.find((tool) => tool.name === "core_capability_invoke");
  assert.equal(dynamicInvoke.inputSchema.properties.owner_confirmed.type, "boolean");
  assert.equal(dynamicInvoke.inputSchema.properties.confirmation_reference.type, "string");
  assert.deepEqual(
    advisoryWrites.map((tool) => tool.name),
    [
      "nyra_continue",
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
  assert.equal(
    requiresGenericWorkPreflight("core_capability_invoke", {
      capability_id: "tenant_work_legacy_reconcile_close",
    }),
    false,
    "legacy reconciliation must inspect the Work before continuity creates a technical lease",
  );
  assert.equal(
    requiresCanonicalWorkReadAuthorization("core_capability_invoke", {
      capability_id: "tenant_work_legacy_reconcile_close",
    }),
    true,
    "the preflight-free reconciliation path must retain exact Work ACL",
  );
  assert.equal(
    requiresGenericWorkPreflight("core_capability_invoke", {
      capability_id: "tenant_work_legacy_reconcile_close_replay",
    }),
    true,
    "lookalike capability names must not inherit the reconciliation exemption",
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
