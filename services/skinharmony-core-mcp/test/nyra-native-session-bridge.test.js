import assert from "node:assert/strict";
import test from "node:test";

import { resolveHostTransportPresence } from "../src/app.js";

function oauthOwner() {
  return {
    kind: "oauth",
    tenantId: "tenant-a",
    oauthOwnerBound: true,
    authenticatedTenantMembership: {
      authenticated: true,
      tenant_id: "tenant-a",
      role: "tenant_owner",
    },
  };
}

test("keeps Nyra native plan and bind on one authenticated logical coordinator", () => {
  const agentPresence = { session_fingerprint: "a".repeat(24) };
  const transportAgentPresence = { session_fingerprint: "b".repeat(24) };
  for (const operation of ["create_native_plan", "bind_native_child"]) {
    const resolved = resolveHostTransportPresence({
      identity: oauthOwner(),
      toolName: "nyra_governed_continue",
      operation,
      declaredSessionId: "stable-owner-coordinator",
      agentPresence,
      transportAgentPresence,
    });
    assert.equal(resolved.presence, agentPresence, operation);
    assert.equal(resolved.binding_source, "oauth_declared_coordinator", operation);
  }
});

test("keeps non-native continuations and child reports on the real transport", () => {
  const agentPresence = { session_fingerprint: "a".repeat(24) };
  const transportAgentPresence = { session_fingerprint: "b".repeat(24) };
  for (const [toolName, operation] of [
    ["nyra_governed_continue", "create_work"],
    ["work_continuity_native_report", undefined],
  ]) {
    const resolved = resolveHostTransportPresence({
      identity: oauthOwner(),
      toolName,
      operation,
      declaredSessionId: "stable-owner-coordinator",
      agentPresence,
      transportAgentPresence,
    });
    assert.equal(resolved.presence, transportAgentPresence, `${toolName}:${operation}`);
    assert.equal(resolved.binding_source, "transport", `${toolName}:${operation}`);
  }
});

test("does not grant the logical coordinator bridge outside the exact owner tenant", () => {
  const agentPresence = { session_fingerprint: "a".repeat(24) };
  const transportAgentPresence = { session_fingerprint: "b".repeat(24) };
  for (const [label, identity] of [
    [
      "non-owner",
      {
        ...oauthOwner(),
        oauthOwnerBound: false,
        authenticatedTenantMembership: {
          authenticated: true,
          tenant_id: "tenant-a",
          role: "member",
        },
      },
    ],
    [
      "tenant-mismatch",
      {
        ...oauthOwner(),
        authenticatedTenantMembership: {
          authenticated: true,
          tenant_id: "tenant-b",
          role: "tenant_owner",
        },
      },
    ],
  ]) {
    for (const operation of ["create_native_plan", "bind_native_child"]) {
      const resolved = resolveHostTransportPresence({
        identity,
        toolName: "nyra_governed_continue",
        operation,
        declaredSessionId: "caller-controlled-session",
        agentPresence,
        transportAgentPresence,
      });
      assert.equal(resolved.presence, transportAgentPresence, `${label}:${operation}`);
      assert.equal(resolved.binding_source, "transport", `${label}:${operation}`);
    }
  }
});

test("native bind and report stay fail-closed without authenticated transport continuity", () => {
  const identity = oauthOwner();
  for (const [toolName, capabilityId] of [
    ["work_continuity_native_bind", undefined],
    ["work_continuity_native_report", undefined],
    ["core_capability_invoke", "work_continuity_native_bind"],
    ["core_capability_invoke", "work_continuity_native_report"],
  ]) {
    const resolved = resolveHostTransportPresence({
      identity,
      toolName,
      capabilityId,
      declaredSessionId: "caller-controlled-logical-session",
      agentPresence: { session_fingerprint: "a".repeat(24) },
      transportAgentPresence: null,
    });
    assert.equal(resolved.presence, null, `${toolName}:${capabilityId}`);
    assert.equal(resolved.binding_source, null, `${toolName}:${capabilityId}`);
  }
});
