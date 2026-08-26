import assert from "node:assert/strict";
import test from "node:test";

import {
  hasTenantBoundChatGptReadCompatibility,
  hostAppCanAccessTool,
  requireHostAppToolCapability,
} from "../src/host-app-authorization.js";

const TOOLS = [
  { name: "work_preflight", annotations: { readOnlyHint: true } },
  { name: "core_branch_registry", annotations: { readOnlyHint: true } },
  { name: "core_semantic_select", annotations: { readOnlyHint: true } },
  { name: "core_capability_read", annotations: { readOnlyHint: true } },
  { name: "core_capability_invoke", annotations: { readOnlyHint: false } },
  { name: "work_continuity_v2_read", annotations: { readOnlyHint: true } },
  { name: "host_native_status", annotations: { readOnlyHint: true } },
  { name: "host_native_delegation_issue", annotations: { readOnlyHint: false } },
  { name: "host_native_action_authorize", annotations: { readOnlyHint: false } },
  { name: "nyra_native_team_status", annotations: { readOnlyHint: true } },
  { name: "nyra_native_team_enable", annotations: { readOnlyHint: false } },
  { name: "nyra_autopilot_status", annotations: { readOnlyHint: true } },
  { name: "nyra_autopilot_reconcile", annotations: { readOnlyHint: false } },
  { name: "memory_context", annotations: { readOnlyHint: true } },
  { name: "memory_checkpoint", annotations: { readOnlyHint: false } },
  { name: "task_update", annotations: { readOnlyHint: false } },
  { name: "generic_agent_checkpoint", annotations: { readOnlyHint: false } },
  { name: "agent_heartbeat", annotations: { readOnlyHint: false } },
  { name: "nyra_policy_registry_activate", annotations: { readOnlyHint: false } },
  { name: "nyra_policy_registry_rollback", annotations: { readOnlyHint: false } },
  { name: "nyra_policy_registry_reconcile", annotations: { readOnlyHint: false } },
];

function identity(capabilities, hostKind = "chatgpt_native", registered = true) {
  return {
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered,
      app_id: "test_app",
      host_kind: hostKind,
      capabilities,
    },
  };
}

function tenantBoundUnregisteredChatGpt(overrides = {}) {
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

test("limits unregistered tenant-bound ChatGPT OAuth to governed read and exact dynamic reauthorization", () => {
  const compatible = tenantBoundUnregisteredChatGpt();
  for (const name of ["work_preflight", "core_branch_registry", "core_semantic_select"]) {
    assert.equal(hasTenantBoundChatGptReadCompatibility(compatible, name), true, name);
    assert.doesNotThrow(() => requireHostAppToolCapability({ identity: compatible, toolName: name, tools: TOOLS }));
  }
  assert.doesNotThrow(() => requireHostAppToolCapability({
    identity: compatible,
    toolName: "core_capability_read",
    args: { capability_id: "work_continuity_v2_read" },
    tools: TOOLS,
  }));
  assert.throws(() => requireHostAppToolCapability({
    identity: compatible,
    toolName: "core_capability_read",
    args: { capability_id: "memory_context", tenant_id: "tenant-b" },
    tools: TOOLS,
  }), /host_app_capability_required:core\.read/);
  assert.throws(() => requireHostAppToolCapability({
    identity: compatible,
    toolName: "core_capability_invoke",
    args: { capability_id: "memory_checkpoint", tenant_id: "tenant-b" },
    tools: TOOLS,
  }), /host_app_capability_required:core\.operate/);
  assert.equal(hasTenantBoundChatGptReadCompatibility({
    ...compatible,
    authenticatedTenantMembership: { ...compatible.authenticatedTenantMembership, tenant_id: "tenant-b" },
  }, "work_preflight"), false);
});

test("enforces work.read on direct and dynamic Work reads", () => {
  const denied = identity([]);
  let failure;
  try {
    requireHostAppToolCapability({
      identity: denied,
      toolName: "work_continuity_v2_read",
      tools: TOOLS,
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, "host_app_capability_required");
  assert.equal(failure?.required_capability, "work.read");
  assert.equal(failure?.status, 403);
  assert.throws(() => requireHostAppToolCapability({
    identity: denied,
    toolName: "work_continuity_v2_read",
    tools: TOOLS,
  }), /host_app_capability_required:work\.read/);
  assert.throws(() => requireHostAppToolCapability({
    identity: denied,
    toolName: "core_capability_read",
    args: { capability_id: "work_continuity_v2_read" },
    tools: TOOLS,
  }), /host_app_capability_required:work\.read/);
  assert.doesNotThrow(() => requireHostAppToolCapability({
    identity: identity(["work.read"]),
    toolName: "core_capability_read",
    args: { capability_id: "work_continuity_v2_read" },
    tools: TOOLS,
  }));
});

test("a work.read app cannot dynamically invoke host-native delegation or authorization", () => {
  const reader = identity(["work.read"]);
  for (const capability_id of ["host_native_delegation_issue", "host_native_action_authorize"]) {
    assert.throws(() => requireHostAppToolCapability({
      identity: reader,
      toolName: "core_capability_invoke",
      args: { capability_id },
      tools: TOOLS,
    }), /host_app_capability_required:host_native\.(?:delegate|authorize)/);
    assert.equal(hostAppCanAccessTool({ identity: reader, toolName: capability_id, tools: TOOLS }), false);
  }
});

test("native execution supports registered ChatGPT and Codex hosts but fails closed for future host kinds", () => {
  const capabilities = ["host_native.delegate"];
  assert.doesNotThrow(() => requireHostAppToolCapability({
    identity: identity(capabilities, "chatgpt_native"),
    toolName: "host_native_delegation_issue",
    tools: TOOLS,
  }));
  assert.doesNotThrow(() => requireHostAppToolCapability({
    identity: identity(capabilities, "codex_native"),
    toolName: "host_native_delegation_issue",
    tools: TOOLS,
  }));
  assert.throws(() => requireHostAppToolCapability({
    identity: identity(capabilities, "future_ai_native"),
    toolName: "host_native_delegation_issue",
    tools: TOOLS,
  }), /host_native_host_kind_not_supported/);
});

test("future registered AI apps may read, coordinate and create Work without native execution support", () => {
  const future = identity(["work.read", "work.coordinate", "work.create"], "future_ai_native");
  assert.doesNotThrow(() => requireHostAppToolCapability({
    identity: future,
    toolName: "nyra_converse",
    tools: TOOLS,
  }));
  assert.doesNotThrow(() => requireHostAppToolCapability({
    identity: future,
    toolName: "work_continuity_start_or_resume",
    tools: TOOLS,
  }));
  assert.doesNotThrow(() => requireHostAppToolCapability({
    identity: future,
    toolName: "work_continuity_v2_create",
    tools: TOOLS,
  }));
});

test("governed continuation intersects wrapper, operation and supported-host capabilities", () => {
  const wrapperOnly = identity(["governed_continue"]);
  assert.throws(() => requireHostAppToolCapability({
    identity: wrapperOnly,
    toolName: "nyra_governed_continue",
    args: { operation: "review_work_bootstrap" },
    tools: TOOLS,
  }), /host_app_capability_required:work\.create/);
  assert.throws(() => requireHostAppToolCapability({
    identity: wrapperOnly,
    toolName: "nyra_governed_continue",
    args: { operation: "issue_delegation" },
    tools: TOOLS,
  }), /host_app_capability_required:host_native\.delegate/);
  assert.throws(() => requireHostAppToolCapability({
    identity: wrapperOnly,
    toolName: "nyra_governed_continue",
    args: { operation: "authorize_action" },
    tools: TOOLS,
  }), /host_app_capability_required:host_native\.authorize/);
  assert.throws(() => requireHostAppToolCapability({
    identity: identity(["governed_continue", "host_native.delegate"], "future_ai_native"),
    toolName: "nyra_governed_continue",
    args: { operation: "issue_delegation" },
    tools: TOOLS,
  }), /host_native_host_kind_not_supported/);
  assert.doesNotThrow(() => requireHostAppToolCapability({
    identity: identity(["governed_continue", "host_native.authorize"], "codex_native"),
    toolName: "nyra_governed_continue",
    args: { operation: "authorize_action" },
    tools: TOOLS,
  }));
});

test("Nyra Native Team and Autopilot mutations require work.operate directly and dynamically", () => {
  const reader = identity(["work.read"]);
  for (const toolName of ["nyra_native_team_status", "nyra_autopilot_status"]) {
    assert.doesNotThrow(() => requireHostAppToolCapability({
      identity: reader, toolName, tools: TOOLS,
    }));
  }
  for (const capability_id of ["nyra_native_team_enable", "nyra_autopilot_reconcile"]) {
    assert.throws(() => requireHostAppToolCapability({
      identity: reader, toolName: capability_id, tools: TOOLS,
    }), /host_app_capability_required:work\.operate/);
    assert.throws(() => requireHostAppToolCapability({
      identity: reader,
      toolName: "core_capability_invoke",
      args: { capability_id },
      tools: TOOLS,
    }), /host_app_capability_required:work\.operate/);
    assert.doesNotThrow(() => requireHostAppToolCapability({
      identity: identity(["work.operate"]), toolName: capability_id, tools: TOOLS,
    }));
  }
});

test("non-Work reads, mutations and policy administration use separate app upper bounds", () => {
  const workReader = identity(["work.read"]);
  for (const invocation of [
    ["memory_context", {}],
    ["core_capability_read", { capability_id: "memory_context" }],
  ]) {
    assert.throws(() => requireHostAppToolCapability({
      identity: workReader,
      toolName: invocation[0],
      args: invocation[1],
      tools: TOOLS,
    }), /host_app_capability_required:core\.read/);
    assert.doesNotThrow(() => requireHostAppToolCapability({
      identity: identity(["core.read"]),
      toolName: invocation[0],
      args: invocation[1],
      tools: TOOLS,
    }));
  }

  for (const capability_id of [
    "memory_checkpoint",
    "task_update",
    "generic_agent_checkpoint",
  ]) {
    for (const invocation of [
      [capability_id, {}],
      ["core_capability_invoke", { capability_id }],
    ]) {
      assert.throws(() => requireHostAppToolCapability({
        identity: workReader,
        toolName: invocation[0],
        args: invocation[1],
        tools: TOOLS,
      }), /host_app_capability_required:core\.operate/);
      assert.doesNotThrow(() => requireHostAppToolCapability({
        identity: identity(["core.operate"]),
        toolName: invocation[0],
        args: invocation[1],
        tools: TOOLS,
      }));
    }
  }

  for (const capability_id of [
    "nyra_policy_registry_activate",
    "nyra_policy_registry_rollback",
    "nyra_policy_registry_reconcile",
  ]) {
    for (const invocation of [
      [capability_id, {}],
      ["core_capability_invoke", { capability_id }],
    ]) {
      assert.throws(() => requireHostAppToolCapability({
        identity: identity(["core.operate"]),
        toolName: invocation[0],
        args: invocation[1],
        tools: TOOLS,
      }), /host_app_capability_required:core\.admin/);
      assert.doesNotThrow(() => requireHostAppToolCapability({
        identity: identity(["core.admin"]),
        toolName: invocation[0],
        args: invocation[1],
        tools: TOOLS,
      }));
    }
  }
});

test("agent heartbeat requires bounded Work coordination directly and dynamically", () => {
  for (const invocation of [
    ["agent_heartbeat", {}],
    ["core_capability_invoke", { capability_id: "agent_heartbeat" }],
  ]) {
    assert.throws(() => requireHostAppToolCapability({
      identity: identity(["work.read"]),
      toolName: invocation[0],
      args: invocation[1],
      tools: TOOLS,
    }), /host_app_capability_required:work\.coordinate/);
    assert.doesNotThrow(() => requireHostAppToolCapability({
      identity: identity(["work.coordinate"]),
      toolName: invocation[0],
      args: invocation[1],
      tools: TOOLS,
    }));
  }
});
