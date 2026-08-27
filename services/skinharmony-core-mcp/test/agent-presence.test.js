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
  assert.equal(first.signature_version, "v2");
  assert.notEqual(first.signature, otherSession.signature);
  assert.notEqual(first.signature, otherTenant.signature);
  assert.notEqual(first.session_fingerprint, otherSession.session_fingerprint);
  assert(!JSON.stringify(first).includes(identity.subject));
  assert(!JSON.stringify(first).includes(input.session_id));
});

test("binds presence client type and host audience to the authenticated app principal", () => {
  const principalIdentity = {
    tenantId: "tenant-a",
    subject: "owner-a",
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      registry_revision: "a".repeat(64),
      app_id: "chatgpt_prod",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
    },
  };
  const presence = createAgentPresence(config, principalIdentity, {
    agent_id: "agent-one",
    client_type: "chatgpt",
    session_id: "session-one",
  });
  assert.equal(presence.host_app_id, "chatgpt_prod");
  assert.equal(presence.host_kind, "chatgpt_native");
  assert.equal(presence.host_registered, true);
  assert.throws(() => createAgentPresence(config, principalIdentity, {
    agent_id: "agent-one",
    client_type: "codex",
    session_id: "session-one",
  }), /client_type_principal_mismatch/);
});

test("preserves exact v1 session and presence identities during the bounded rollout window", () => {
  const principalIdentity = {
    tenantId: "tenant-a",
    subject: "owner-a",
    authenticatedHostPrincipal: {
      registered: true,
      registry_revision: "a".repeat(64),
      app_id: "chatgpt_prod",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
    },
  };
  const legacy = createAgentPresence({
    ...config,
    agentPresenceSignatureVersion: "v1",
  }, principalIdentity, {
    agent_id: "agent-one",
    client_type: "chatgpt",
    session_id: "session-one",
  });
  const legacyWithoutPrincipal = createAgentPresence({
    ...config,
    agentPresenceSignatureVersion: "v1",
  }, { tenantId: "tenant-a", subject: "owner-a" }, {
    agent_id: "agent-one",
    client_type: "chatgpt",
    session_id: "session-one",
  });
  const v2 = createAgentPresence({
    ...config,
    agentPresenceSignatureVersion: "v2",
  }, principalIdentity, {
    agent_id: "agent-one",
    client_type: "chatgpt",
    session_id: "session-one",
  });

  assert.equal(legacy.signature_version, "v1");
  assert.equal(legacy.session_binding_version, "v1");
  assert.equal(legacy.session_fingerprint, "a38583ad26c77b5e5a6fbe6f");
  assert.equal(legacy.signature, legacyWithoutPrincipal.signature);
  assert.equal(legacy.session_fingerprint, legacyWithoutPrincipal.session_fingerprint);
  assert.match(v2.session_fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(v2.signature, legacy.signature);
  assert.notEqual(v2.session_fingerprint, legacy.session_fingerprint);
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
