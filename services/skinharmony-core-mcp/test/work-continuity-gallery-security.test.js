import assert from "node:assert/strict";
import test from "node:test";

import { assertGalleryParticipantBinding } from "../src/work-continuity-runtime.js";
import { requireTenantWorkCapability, tenantWorkCapabilities } from "../src/tenant-work-authorization.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";

function identity(overrides = {}) {
  return {
    tenantId: "codexai",
    kind: "codex",
    subject: "codex|gallery-worker",
    agentPresence: {
      session_id: "gallery-session",
      agent_id: "gallery-worker",
      client_type: "codex",
      signature: `ags_${"a".repeat(32)}`,
      transport_bound: true,
      host_transport_session_fingerprint: "b".repeat(24),
      session_fingerprint: "c".repeat(24),
    },
    ...overrides,
  };
}

const participantInput = {
  session_id: "gallery-session",
  agent_id: "gallery-worker",
  client_type: "codex",
};

test("Gallery participants require transport-bound server-signed presence", () => {
  assert.deepEqual(assertGalleryParticipantBinding(identity(), participantInput), {
    sessionId: "gallery-session",
    agentId: "gallery-worker",
    clientType: "codex",
    sessionFingerprint: "c".repeat(24),
    transportSessionFingerprint: "b".repeat(24),
    acl: ["gallery.read", "gallery.coordinate"],
  });
  for (const agentPresence of [
    undefined,
    { ...identity().agentPresence, transport_bound: false },
    { ...identity().agentPresence, signature: "caller-supplied" },
    { ...identity().agentPresence, host_transport_session_fingerprint: "short" },
  ]) {
    assert.throws(
      () => assertGalleryParticipantBinding(identity({ agentPresence }), participantInput),
      /gallery_signed_presence_required/,
    );
  }
});

test("Gallery derives the participant transport binding only from signed presence", () => {
  const first = assertGalleryParticipantBinding(identity(), participantInput);
  const second = assertGalleryParticipantBinding(identity({
    agentPresence: {
      ...identity().agentPresence,
      host_transport_session_fingerprint: "C".repeat(24),
    },
  }), participantInput);
  assert.equal(first.transportSessionFingerprint, "b".repeat(24));
  assert.equal(second.transportSessionFingerprint, "c".repeat(24));
  assert.notEqual(first.transportSessionFingerprint, second.transportSessionFingerprint);
});

test("Gallery participant claims cannot switch signed session, agent, or client", () => {
  for (const input of [
    { ...participantInput, session_id: "other-session" },
    { ...participantInput, agent_id: "other-agent" },
    { ...participantInput, client_type: "chatgpt" },
  ]) {
    assert.throws(
      () => assertGalleryParticipantBinding(identity(), input),
      /gallery_participant_presence_mismatch/,
    );
  }
});

test("Gallery writes expose only bounded coordination and cap participant leases at one hour", () => {
  const names = [
    "tenant_work_gallery_join",
    "tenant_work_gallery_heartbeat",
    "tenant_work_lease_acquire",
    "tenant_work_lease_renew",
  ];
  const tools = Object.fromEntries(WORK_CONTINUITY_TOOLS
    .filter((tool) => names.includes(tool.name))
    .map((tool) => [tool.name, tool]));
  for (const name of names) {
    assert.equal(tools[name]._meta["skinharmony/tenantBoundedCollaboration"], true);
    assert.equal(tools[name]._meta["skinharmony/ownerConfirmationRequired"], false);
    assert.equal(tools[name].inputSchema.properties.ttl_seconds.maximum, 3_600);
  }
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "member",
  }), ["read", "coordinate"]);
  assert.doesNotThrow(() => requireTenantWorkCapability({
    kind: "oauth",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "member",
  }, "coordinate"));
  assert.throws(() => requireTenantWorkCapability({ kind: "oauth" }, "coordinate"),
    /tenant_work_membership_required/);
});
