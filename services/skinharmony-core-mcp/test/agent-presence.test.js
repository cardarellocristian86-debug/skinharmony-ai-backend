import assert from "node:assert/strict";
import test from "node:test";
import { createAgentPresence, sameAgentPresence } from "../src/agent-presence.js";

const config = { agentSignatureSecret: "s".repeat(32) };
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

test("agent presence never derives signatures or fingerprints from Core bearers", () => {
  const first = createAgentPresence({
    ...config,
    universalCoreKey: "a".repeat(32),
    universalCoreKeys: { "tenant-a": "b".repeat(32) },
  }, identity, input);
  const changedBearers = createAgentPresence({
    ...config,
    universalCoreKey: "c".repeat(32),
    universalCoreKeys: { "tenant-a": "d".repeat(32) },
  }, identity, input);
  assert.deepEqual(changedBearers, first);

  const developmentWithBearer = createAgentPresence({
    environment: "development",
    universalCoreKeys: { "tenant-a": "e".repeat(32) },
  }, identity, input);
  const developmentWithDifferentBearer = createAgentPresence({
    environment: "development",
    universalCoreKey: "f".repeat(32),
  }, identity, input);
  assert.deepEqual(developmentWithDifferentBearer, developmentWithBearer);
});

test("production createAgentPresence fails closed for missing or short dedicated secret despite Core bearers", () => {
  assert.throws(
    () => createAgentPresence({
      environment: "production",
      universalCoreKey: "g".repeat(32),
      universalCoreKeys: { "tenant-a": "h".repeat(32) },
    }, identity, input),
    /agent_signature_key_unavailable/,
  );
  assert.throws(
    () => createAgentPresence({
      environment: "production",
      agentSignatureSecret: "too-short",
    }, identity, input),
    /agent_signature_key_unavailable/,
  );
});

test("production createAgentPresence rejects a reused Core bearer or host-native secret", () => {
  const reusedSecret = "r".repeat(32);
  for (const reusedConfig of [
    {
      agentSignatureSecret: reusedSecret,
      universalCoreKey: reusedSecret,
    },
    {
      agentSignatureSecret: reusedSecret,
      ownerContextSigningSecret: reusedSecret,
    },
    {
      agentSignatureSecret: reusedSecret,
      agentSignatureSecretReused: true,
    },
  ]) {
    assert.throws(
      () => createAgentPresence({
        environment: "production",
        ...reusedConfig,
      }, identity, input),
      /agent_signature_key_reused/,
    );
  }
});
