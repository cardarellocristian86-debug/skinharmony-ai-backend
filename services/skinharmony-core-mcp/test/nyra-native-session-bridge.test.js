import assert from "node:assert/strict";
import test from "node:test";

import { resolveHostTransportPresence } from "../src/app.js";

test("native bind and report stay fail-closed without authenticated transport continuity", () => {
  const identity = {
    kind: "oauth",
    tenantId: "tenant-a",
    oauthOwnerBound: true,
    authenticatedTenantMembership: {
      authenticated: true,
      tenant_id: "tenant-a",
      role: "tenant_owner",
    },
  };
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
