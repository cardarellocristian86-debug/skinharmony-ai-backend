import assert from "node:assert/strict";
import test from "node:test";
import { createAgentPresence, sameAgentPresence } from "../src/agent-presence.js";

const config = { agentSignatureSecret: "test-agent-signature-secret" };
const identity = { tenantId: "tenant-a", subject: "auth0|owner", kind: "chatgpt" };
const input = { agent_id: "worker-one", client_type: "chatgpt", session_id: "session-one-20260714" };

test("agent presence is stable, opaque and tenant/session scoped", () => {
  const first = createAgentPresence(config, identity, input);
  const replay = createAgentPresence(config, identity, input);
  const otherSession = createAgentPresence(config, identity, { ...input, session_id: "session-two-20260714" });
  const otherTenant = createAgentPresence(config, { ...identity, tenantId: "tenant-b" }, input);

  assert.deepEqual(first, replay);
  assert.equal(sameAgentPresence(first, replay), true);
  assert.match(first.signature, /^ags_[a-f0-9]{32}$/);
  assert.match(first.opaque_agent_id, /^ai_[a-f0-9]{24}$/);
  assert.equal(first.signature_version, "v1");
  assert.notEqual(first.signature, otherSession.signature);
  assert.notEqual(first.signature, otherTenant.signature);
  assert.notEqual(first.session_fingerprint, otherSession.session_fingerprint);
  assert(!JSON.stringify(first).includes(identity.subject));
  assert(!JSON.stringify(first).includes(input.session_id));
});

test("agent presence rejects invalid or incomplete declarations", () => {
  assert.throws(() => createAgentPresence(config, identity, { ...input, client_type: "browser" }), /client_type_invalid/);
  assert.throws(() => createAgentPresence(config, identity, { ...input, session_id: "" }), /session_invalid/);
  assert.throws(() => createAgentPresence(config, identity, { ...input, agent_id: "../other" }), /agent_invalid/);
});
