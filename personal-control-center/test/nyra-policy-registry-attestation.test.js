"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ENVELOPE_FIELDS,
  SCHEMA_VERSION,
  SIGN_REQUEST_SCHEMA_VERSION,
  SIGN_RESPONSE_SCHEMA_VERSION,
  createFileReplayStore,
  createNyraPolicyRegistryAttester,
  createNyraPolicyRegistryLocalTestSigner,
  createNyraPolicyRegistryRemoteSigner,
  createPostgresReplayStore,
  payloadBytes,
  publicKeyFingerprint,
} = require("../lib/nyra-policy-registry-attestation");

const NOW = Date.parse("2026-08-03T12:00:00.000Z");
const COMMIT = "a".repeat(40);

function fixture(overrides = {}) {
  const core = crypto.generateKeyPairSync("ed25519");
  const nyra = crypto.generateKeyPairSync("ed25519");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-policy-attestation-"));
  const coreFingerprint = publicKeyFingerprint(core.publicKey);
  const nyraFingerprint = publicKeyFingerprint(nyra.publicKey);
  const env = {
    NODE_ENV: "test",
    RENDER_GIT_COMMIT: COMMIT,
    NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "true",
    NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED: "true",
    NYRA_POLICY_REGISTRY_SIGNER_MODE: "remote",
    NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST: "codexai",
    NYRA_POLICY_REGISTRY_CORE_SERVICE_KEY: "core-service-key-at-least-32-bytes",
    NYRA_POLICY_REGISTRY_CORE_KEY_ID: "core-policy-k1",
    NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-policy-k1",
    NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY: core.publicKey.export({ type: "spki", format: "pem" }),
    NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY: nyra.publicKey.export({ type: "spki", format: "pem" }),
    NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY_FINGERPRINT: coreFingerprint,
    NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT: nyraFingerprint,
    NYRA_POLICY_REGISTRY_REPLAY_STORE_PATH: path.join(directory, "replay.json"),
    NYRA_POLICY_REGISTRY_ATTESTATION_MAX_AGE_MS: "300000",
    ...overrides,
  };
  const envelope = {
    schema_version: SCHEMA_VERSION,
    tenant_id: "codexai",
    work_id: "work-12345678",
    preflight_id: "preflight-12345678",
    intent_digest: "a".repeat(64),
    operation_id: "operation-12345678",
    action: "policy.snapshot.activate",
    snapshot_digest: "b".repeat(64),
    compiler_provenance_digest: "d".repeat(64),
    domain_pack_id: "generic-policy",
    owner_approval_hash: "c".repeat(64),
    nonce: crypto.randomBytes(24).toString("base64url"),
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    core_key_id: "core-policy-k1",
    nyra_key_id: "nyra-policy-k1",
    core_public_key_fingerprint: coreFingerprint,
    nyra_public_key_fingerprint: nyraFingerprint,
  };
  const coreSignature = crypto.sign(null, payloadBytes(envelope), core.privateKey).toString("base64url");
  const testSigner = createNyraPolicyRegistryLocalTestSigner({ privateKey: nyra.privateKey, keyId: "nyra-policy-k1" });
  return { core, nyra, directory, env, envelope, coreSignature, testSigner };
}

async function createReady(value, options = {}) {
  const attester = createNyraPolicyRegistryAttester({
    env: value.env,
    now: () => NOW,
    testSigner: value.testSigner,
    allowLocalSignerForTests: true,
    probeCooldownMs: 0,
    ...options,
  });
  await attester.probe({ force: true });
  assert.equal(attester.status().ready, true, JSON.stringify(attester.status()));
  return attester;
}

test("uses the exact v3 envelope and adds a locally verified independent Nyra signature", async () => {
  const value = fixture();
  assert.deepEqual(Object.keys(value.envelope).sort(), [...ENVELOPE_FIELDS].sort());
  const attester = await createReady(value);
  const result = await attester.attest({ envelope: value.envelope, core_signature: value.coreSignature });
  assert.equal(result.idempotent_replay, false);
  assert.equal(crypto.verify(null, payloadBytes(value.envelope), value.core.publicKey,
    Buffer.from(result.core_signature, "base64url")), true);
  assert.equal(crypto.verify(null, payloadBytes(value.envelope), value.nyra.publicKey,
    Buffer.from(result.nyra_signature, "base64url")), true);
  assert.equal(result.envelope.owner_approval_hash, value.envelope.owner_approval_hash);
  assert.equal(result.envelope.compiler_provenance_digest, value.envelope.compiler_provenance_digest);
  assert.notEqual(result.core_signature, result.nyra_signature);
});

test("persists tenant-scoped replay and returns the same signature after restart", async () => {
  const value = fixture();
  const first = await (await createReady(value)).attest({ envelope: value.envelope, core_signature: value.coreSignature });
  const restarted = await createReady(value);
  const replay = await restarted.attest({ envelope: value.envelope, core_signature: value.coreSignature });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.nyra_signature, first.nyra_signature);
  const divergent = { ...value.envelope, operation_id: "operation-divergent" };
  const signature = crypto.sign(null, payloadBytes(divergent), value.core.privateKey).toString("base64url");
  await assert.rejects(restarted.attest({ envelope: divergent, core_signature: signature }),
    /nyra_policy_attestation_nonce_reused/);
});

test("legacy v2 file replay state is unsupported after the v3 cutover", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-policy-v2-replay-"));
  const replayPath = path.join(directory, "replay.json");
  fs.writeFileSync(replayPath, JSON.stringify({
    schema_version: "nyra_policy_attestation_replay_v2",
    entries: {},
  }));
  const store = createFileReplayStore(replayPath);
  await assert.rejects(store.initialize(), /nyra_policy_attestation_replay_store_invalid/);
});

test("fails closed for tampering, foreign tenant, expiry and every cross-binding field", async () => {
  const value = fixture();
  const attester = await createReady(value);
  await assert.rejects(attester.attest({
    envelope: { ...value.envelope, snapshot_digest: "d".repeat(64) },
    core_signature: value.coreSignature,
  }), /core_signature_invalid/);
  const mutations = {
    tenant_id: "other-tenant",
    work_id: "work-other-123",
    preflight_id: "preflight-other-123",
    intent_digest: "d".repeat(64),
    operation_id: "operation-other-123",
    action: "policy.snapshot.rollback",
    snapshot_digest: "d".repeat(64),
    compiler_provenance_digest: "e".repeat(64),
    domain_pack_id: "other-policy",
    owner_approval_hash: "d".repeat(64),
  };
  for (const [field, changed] of Object.entries(mutations)) {
    const envelope = { ...value.envelope, [field]: changed };
    if (field === "tenant_id") {
      await assert.rejects(attester.attest({ envelope, core_signature: value.coreSignature }), /tenant_denied/);
    } else {
      await assert.rejects(attester.attest({ envelope, core_signature: value.coreSignature }), /core_signature_invalid/);
    }
  }
  const expired = { ...value.envelope, nonce: crypto.randomBytes(24).toString("base64url"),
    issued_at: new Date(NOW - 120_000).toISOString(), expires_at: new Date(NOW - 1).toISOString() };
  const expiredSignature = crypto.sign(null, payloadBytes(expired), value.core.privateKey).toString("base64url");
  await assert.rejects(attester.attest({ envelope: expired, core_signature: expiredSignature }), /expired/);
});

test("rejects v2 envelopes and compiler provenance digest tampering", async () => {
  const value = fixture();
  const attester = await createReady(value);
  const v2 = { ...value.envelope, schema_version: "nyra_policy_activation_attestation_v2" };
  const v2Signature = crypto.sign(null, payloadBytes(v2), value.core.privateKey).toString("base64url");
  await assert.rejects(attester.attest({ envelope: v2, core_signature: v2Signature }),
    /nyra_policy_attestation_envelope_invalid/);

  const missing = { ...value.envelope };
  delete missing.compiler_provenance_digest;
  const missingSignature = crypto.sign(null, payloadBytes(missing), value.core.privateKey).toString("base64url");
  await assert.rejects(attester.attest({ envelope: missing, core_signature: missingSignature }),
    /nyra_policy_attestation_envelope_schema_invalid/);

  const tampered = { ...value.envelope, compiler_provenance_digest: "e".repeat(64) };
  await assert.rejects(attester.attest({ envelope: tampered, core_signature: value.coreSignature }),
    /nyra_policy_attestation_core_signature_invalid/);
});

test("rejects unknown actions, extra envelope fields, and extra request fields", async () => {
  const value = fixture();
  const attester = await createReady(value);
  const unknown = { ...value.envelope, action: "policy.snapshot.reconcile" };
  const signature = crypto.sign(null, payloadBytes(unknown), value.core.privateKey).toString("base64url");
  await assert.rejects(attester.attest({ envelope: unknown, core_signature: signature }), /envelope_invalid/);
  await assert.rejects(attester.attest({
    envelope: { ...value.envelope, owner_confirmed: true }, core_signature: value.coreSignature,
  }), /envelope_schema_invalid/);
  await assert.rejects(attester.attest({
    envelope: value.envelope, core_signature: value.coreSignature, snapshot: {},
  }), /request_schema_invalid/);
});

test("flags are byte-strict, default code-dark, and residual config causes zero outbound or replay access", async () => {
  let outbound = 0;
  let replayAccess = 0;
  const disabled = createNyraPolicyRegistryAttester({ env: {
    NYRA_POLICY_REGISTRY_NYRA_PRIVATE_KEY: "residual-private-key",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE_TOKEN: "residual-token-value",
    NYRA_POLICY_REGISTRY_SIGNER_MODE: "remote",
  }, fetchImpl: async () => { outbound += 1; }, replayStore: {
    async initialize() { replayAccess += 1; }, async probe() { replayAccess += 1; },
    async lookup() { replayAccess += 1; }, async record() { replayAccess += 1; },
  } });
  await disabled.probe({ force: true });
  assert.deepEqual({ enabled: disabled.status().enabled, mode: disabled.status().mode, ready: disabled.status().ready },
    { enabled: false, mode: "disabled", ready: false });
  assert.equal(disabled.status().configuration_valid, true);
  assert.equal(disabled.status().state, "disabled");
  assert.equal(outbound, 0);
  assert.equal(replayAccess, 0);
  const invalid = createNyraPolicyRegistryAttester({ env: {
    NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "TRUE",
    NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED: "false",
    NYRA_POLICY_REGISTRY_SIGNER_MODE: "disabled",
  } });
  assert.equal(invalid.status().configuration_valid, false);
  assert.match(invalid.status().error, /enabled_flag_invalid/);
  const invalidMode = createNyraPolicyRegistryAttester({ env: {
    NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "false",
    NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED: "false",
    NYRA_POLICY_REGISTRY_SIGNER_MODE: "REMOTE",
  } });
  assert.equal(invalidMode.status().configuration_valid, true);
  assert.equal(invalidMode.status().state, "disabled");
  assert.equal(invalidMode.status().error, null);
  const activeInvalidMode = createNyraPolicyRegistryAttester({ env: {
    NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "true",
    NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED: "true",
    NYRA_POLICY_REGISTRY_SIGNER_MODE: "REMOTE",
  } });
  assert.equal(activeInvalidMode.status().configuration_valid, false);
  assert.match(activeInvalidMode.status().error, /signer_mode_invalid/);
  const requiredWithoutEnabled = createNyraPolicyRegistryAttester({ env: {
    NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "false",
    NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED: "true",
    NYRA_POLICY_REGISTRY_SIGNER_MODE: "disabled",
  } });
  assert.equal(requiredWithoutEnabled.status().render_gate_required, true);
  assert.equal(requiredWithoutEnabled.status().configuration_valid, false);
  const invalidRequired = createNyraPolicyRegistryAttester({ env: {
    NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "false",
    NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED: "TRUE",
    NYRA_POLICY_REGISTRY_SIGNER_MODE: "disabled",
  } });
  assert.equal(invalidRequired.status().render_gate_required, true);
  assert.equal(invalidRequired.status().configuration_valid, false);
  assert.match(invalidRequired.status().error, /required_flag_invalid/);
});

test("rejects invalid max-age, private material in public slots, mismatched pins and production local custody", () => {
  const invalidAge = fixture({ NYRA_POLICY_REGISTRY_ATTESTATION_MAX_AGE_MS: "not-a-number" });
  assert.match(createNyraPolicyRegistryAttester({ env: invalidAge.env,
    testSigner: invalidAge.testSigner, allowLocalSignerForTests: true }).status().error, /max_age_invalid/);

  const privateCore = fixture();
  privateCore.env.NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY = privateCore.core.privateKey.export({ type: "pkcs8", format: "pem" });
  assert.match(createNyraPolicyRegistryAttester({ env: privateCore.env,
    testSigner: privateCore.testSigner, allowLocalSignerForTests: true }).status().error, /core_public_key_invalid/);

  const privateNyra = fixture();
  privateNyra.env.NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY = privateNyra.nyra.privateKey.export({ type: "pkcs8", format: "pem" });
  assert.match(createNyraPolicyRegistryAttester({ env: privateNyra.env,
    testSigner: privateNyra.testSigner, allowLocalSignerForTests: true }).status().error, /nyra_public_key_invalid/);

  const privateJwk = fixture();
  const exportedPrivateJwk = privateJwk.core.privateKey.export({ format: "jwk" });
  privateJwk.env.NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY = JSON.stringify({
    alg: "EdDSA", crv: "Ed25519", kid: "core-policy-k1", kty: "OKP", use: "sig",
    x: exportedPrivateJwk.x, d: exportedPrivateJwk.d,
  });
  assert.match(createNyraPolicyRegistryAttester({ env: privateJwk.env,
    testSigner: privateJwk.testSigner, allowLocalSignerForTests: true }).status().error, /core_public_key_invalid/);

  const badPin = fixture({ NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT: "f".repeat(64) });
  assert.match(createNyraPolicyRegistryAttester({ env: badPin.env,
    testSigner: badPin.testSigner, allowLocalSignerForTests: true }).status().error, /fingerprint_mismatch/);

  const production = fixture({ NODE_ENV: "production" });
  assert.match(createNyraPolicyRegistryAttester({ env: production.env,
    testSigner: production.testSigner, allowLocalSignerForTests: true }).status().error, /local_signer_forbidden/);

  const missingServiceKey = fixture({ NYRA_POLICY_REGISTRY_CORE_SERVICE_KEY: "" });
  assert.match(createNyraPolicyRegistryAttester({ env: missingServiceKey.env,
    testSigner: missingServiceKey.testSigner, allowLocalSignerForTests: true }).status().error, /service_key_required/);
});

test("enabled production rejects replay-store and pool injection with zero dependency use", async () => {
  const value = fixture({
    NODE_ENV: "production",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_ORIGIN: "https://signer.example",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PATH: "/v1/policy-registry/sign",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE: "nyra-policy-registry-signer",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_TARGET_COMMIT: COMMIT,
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PURPOSE: "nyra.policy_registry.attestation",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_KEY_ID: "nyra-policy-k1",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE_TOKEN: "remote-signer-token-at-least-32-bytes",
    NYRA_POLICY_REGISTRY_DATABASE_URL: "",
  });
  const attester = createNyraPolicyRegistryAttester({ env: value.env, fetchImpl: async () => {
    throw new Error("outbound_not_expected_during_configuration");
  } });
  assert.equal(attester.status().ready, false);
  assert.match(attester.status().error, /postgres_required/);

  let replayAccess = 0;
  let poolQueries = 0;
  let outbound = 0;
  const injectedFileReplay = {
    kind: "postgresql", restart_durable: true, distributed: true,
    async initialize() { replayAccess += 1; },
    async probe() { replayAccess += 1; },
    async lookup() { replayAccess += 1; return null; },
    async record() { replayAccess += 1; },
  };
  const injected = createNyraPolicyRegistryAttester({
    env: value.env,
    replayStore: injectedFileReplay,
    fetchImpl: async () => { outbound += 1; throw new Error("outbound_not_expected_during_configuration"); },
  });
  await injected.probe({ force: true });
  assert.equal(injected.status().configuration_valid, false);
  assert.equal(injected.status().error,
    "nyra_policy_attestation_production_dependency_injection_forbidden");

  const pool = { async query() { poolQueries += 1; return { rows: [], rowCount: 0 }; } };
  const poolInjected = createNyraPolicyRegistryAttester({
    env: value.env,
    postgresPool: pool,
    fetchImpl: async () => { outbound += 1; throw new Error("outbound_not_expected_during_configuration"); },
  });
  await poolInjected.probe({ force: true });
  assert.equal(poolInjected.status().configuration_valid, false);
  assert.equal(poolInjected.status().error,
    "nyra_policy_attestation_production_dependency_injection_forbidden");
  assert.deepEqual({ replayAccess, poolQueries, outbound }, { replayAccess: 0, poolQueries: 0, outbound: 0 });
});

test("enabled production binds the remote signer target to the running build", async () => {
  let outbound = 0;
  const mismatch = fixture({
    NODE_ENV: "production",
    RENDER_GIT_COMMIT: "a".repeat(40),
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_TARGET_COMMIT: "b".repeat(40),
  });
  const mismatchAttester = createNyraPolicyRegistryAttester({
    env: mismatch.env,
    fetchImpl: async () => { outbound += 1; throw new Error("outbound_not_expected"); },
  });
  await mismatchAttester.probe({ force: true });
  assert.equal(mismatchAttester.status().configuration_valid, false);
  assert.equal(mismatchAttester.status().error,
    "nyra_policy_attestation_signer_target_commit_mismatch");

  const missingBuild = fixture({
    NODE_ENV: "production",
    RENDER_GIT_COMMIT: "",
    GIT_COMMIT: "",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_TARGET_COMMIT: COMMIT,
  });
  const missingBuildAttester = createNyraPolicyRegistryAttester({
    env: missingBuild.env,
    fetchImpl: async () => { outbound += 1; throw new Error("outbound_not_expected"); },
  });
  await missingBuildAttester.probe({ force: true });
  assert.equal(missingBuildAttester.status().error,
    "nyra_policy_attestation_signer_target_commit_mismatch");
  assert.equal(outbound, 0);

  const matching = fixture({
    NODE_ENV: "production",
    RENDER_GIT_COMMIT: COMMIT,
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_TARGET_COMMIT: COMMIT,
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_ORIGIN: "https://signer.example",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PATH: "/v1/policy-registry/sign",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE: "nyra-policy-registry-signer",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PURPOSE: "nyra.policy_registry.attestation",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_KEY_ID: "nyra-policy-k1",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE_TOKEN: "remote-signer-token-at-least-32-bytes",
    NYRA_POLICY_REGISTRY_DATABASE_URL: "",
  });
  assert.match(createNyraPolicyRegistryAttester({ env: matching.env }).status().error,
    /postgres_required/);
});

function remoteSignerFixture(overrides = {}) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const captured = [];
  const fetchImpl = overrides.fetchImpl || (async (url, init) => {
    const request = JSON.parse(init.body);
    captured.push({ url, init, request });
    const payload = Buffer.from(request.payload, "base64url");
    const body = {
      schema_version: SIGN_RESPONSE_SCHEMA_VERSION,
      service: request.service,
      target_commit: request.target_commit,
      purpose: request.purpose,
      key_id: request.key_id,
      digest: request.digest,
      signature_algorithm: "ed25519",
      signature: crypto.sign(null, payload, pair.privateKey).toString("base64url"),
      ...(overrides.response || {}),
    };
    return new Response(JSON.stringify(body), { status: overrides.status || 200,
      headers: { "content-type": "application/json", ...(overrides.headers || {}) } });
  });
  const signer = createNyraPolicyRegistryRemoteSigner({
    origin: "https://signer.example",
    path: "/v1/policy-registry/sign",
    service: "nyra-policy-registry-signer",
    targetCommit: COMMIT,
    purpose: "nyra.policy_registry.attestation",
    keyId: "nyra-policy-k1",
    serviceToken: "remote-signer-token-at-least-32-bytes",
    publicKey: pair.publicKey,
    fetchImpl,
    timeoutMs: overrides.timeoutMs,
    maxResponseBytes: overrides.maxResponseBytes,
  });
  return { pair, signer, captured };
}

test("remote signer fixes origin/path/service/commit/purpose/key and verifies the canonical response locally", async () => {
  const value = remoteSignerFixture();
  const payload = Buffer.from("canonical-policy-registry-payload");
  const signature = await value.signer.signPayload(payload);
  assert.equal(crypto.verify(null, payload, value.pair.publicKey, Buffer.from(signature, "base64url")), true);
  assert.equal(value.captured.length, 1);
  const request = value.captured[0].request;
  assert.deepEqual(Object.keys(request).sort(), [
    "digest", "key_id", "payload", "purpose", "schema_version", "service", "target_commit",
  ]);
  assert.equal(request.schema_version, SIGN_REQUEST_SCHEMA_VERSION);
  assert.equal(value.captured[0].url, "https://signer.example/v1/policy-registry/sign");
  assert.equal(value.captured[0].init.redirect, "error");
  assert.equal(value.captured[0].init.headers.authorization, "Bearer remote-signer-token-at-least-32-bytes");
  assert.equal(JSON.stringify(value.signer).includes("remote-signer-token"), false);
});

test("remote signer rejects redirect, timeout, oversize, mismatch and noncanonical signatures", async () => {
  const redirect = remoteSignerFixture({ fetchImpl: async () => new Response(null, {
    status: 302, headers: { location: "https://other.example" },
  }) });
  await assert.rejects(redirect.signer.signPayload(Buffer.from("payload")), /redirect_denied/);

  const timeout = remoteSignerFixture({ fetchImpl: async () => new Promise(() => {}), timeoutMs: 100 });
  await assert.rejects(timeout.signer.signPayload(Buffer.from("payload")), /signer_timeout/);

  const oversize = remoteSignerFixture({ headers: { "content-length": "20000" }, maxResponseBytes: 512 });
  await assert.rejects(oversize.signer.signPayload(Buffer.from("payload")), /response_too_large/);

  const mismatch = remoteSignerFixture({ response: { purpose: "wrong.purpose" } });
  await assert.rejects(mismatch.signer.signPayload(Buffer.from("payload")), /purpose_mismatch/);

  const noncanonical = remoteSignerFixture({ response: { signature: "A".repeat(87) } });
  await assert.rejects(noncanonical.signer.signPayload(Buffer.from("payload")), /signature_invalid/);

  const reflectedSecret = "remote-signer-token-must-never-reflect";
  const transportFailure = remoteSignerFixture({ fetchImpl: async () => {
    throw new Error(`transport:${reflectedSecret}`);
  } });
  await assert.rejects(transportFailure.signer.signPayload(Buffer.from("payload")), (error) => {
    assert.equal(error.message, "nyra_policy_signer_unavailable");
    assert.equal(error.message.includes(reflectedSecret), false);
    return true;
  });
});

test("a ready probe refreshes after cooldown, stays single-flight, and ignores a late success", async () => {
  const value = fixture({
    NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED: "false",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_ORIGIN: "https://signer.example",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PATH: "/v1/policy-registry/sign",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE: "nyra-policy-registry-signer",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_TARGET_COMMIT: COMMIT,
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PURPOSE: "nyra.policy_registry.attestation",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_KEY_ID: "nyra-policy-k1",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE_TOKEN: "remote-signer-token-at-least-32-bytes",
    NYRA_POLICY_REGISTRY_REMOTE_SIGNER_TIMEOUT_MS: "100",
  });
  let signerRequests = 0;
  const fetchImpl = async (_url, init) => {
    signerRequests += 1;
    const request = JSON.parse(init.body);
    if (signerRequests > 1) await new Promise((resolve) => setTimeout(resolve, 160));
    const payload = Buffer.from(request.payload, "base64url");
    return new Response(JSON.stringify({
      schema_version: SIGN_RESPONSE_SCHEMA_VERSION,
      service: request.service,
      target_commit: request.target_commit,
      purpose: request.purpose,
      key_id: request.key_id,
      digest: request.digest,
      signature_algorithm: "ed25519",
      signature: crypto.sign(null, payload, value.nyra.privateKey).toString("base64url"),
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const attester = createNyraPolicyRegistryAttester({ env: value.env, fetchImpl, probeCooldownMs: 10 });
  await attester.probe({ force: true });
  assert.equal(attester.status().ready, true);
  assert.equal(signerRequests, 1);
  await attester.probe();
  assert.equal(signerRequests, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await Promise.all([attester.probe(), attester.probe(), attester.probe()]);
  assert.equal(signerRequests, 2);
  assert.equal(attester.status().ready, false);
  assert.equal(attester.status().signer_state, "unavailable");
  assert.equal(attester.status().error, "nyra_policy_signer_timeout");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(attester.status().ready, false);
  assert.equal(attester.status().signer_state, "unavailable");
  assert.equal(attester.status().error, "nyra_policy_signer_timeout");
});

test("startup probe is single-purpose and writes zero replay records", async () => {
  const value = fixture();
  let records = 0;
  const replayStore = {
    kind: "postgresql", restart_durable: true, distributed: true,
    async initialize() {}, async probe() {}, async lookup() { return null; },
    async record() { records += 1; throw new Error("record_not_expected"); },
  };
  const attester = await createReady(value, { replayStore });
  assert.equal(attester.status().ready, true);
  assert.equal(attester.status().attestation_schema_version, SCHEMA_VERSION);
  assert.equal(attester.status().compiler_provenance_binding_required, true);
  assert.equal(records, 0);
});

test("runtime replay failures latch health unavailable and never return an unrecorded signature", async () => {
  const value = fixture();
  const replayStore = {
    kind: "postgresql", restart_durable: true, distributed: true,
    async initialize() {}, async probe() {}, async lookup() { return null; },
    async record() { throw new Error("database-credential-must-not-leak"); },
  };
  const attester = await createReady(value, { replayStore });
  await assert.rejects(attester.attest({ envelope: value.envelope, core_signature: value.coreSignature }),
    /nyra_policy_attestation_replay_store_unavailable/);
  assert.equal(attester.status().ready, false);
  assert.equal(attester.status().replay_state, "unavailable");
  assert.equal(attester.status().error, "nyra_policy_attestation_replay_store_unavailable");
  assert.equal(JSON.stringify(attester.status()).includes("database-credential"), false);
});

test("tampered durable replay responses are rejected and latch the backend unavailable", async () => {
  const value = fixture();
  const replayStore = {
    kind: "postgresql", restart_durable: true, distributed: true,
    async initialize() {}, async probe() {},
    async lookup() {
      return {
        schema_version: SCHEMA_VERSION,
        envelope: value.envelope,
        core_signature: value.coreSignature,
        nyra_signature: "A".repeat(86),
      };
    },
    async record() { throw new Error("record_not_expected"); },
  };
  const attester = await createReady(value, { replayStore });
  await assert.rejects(attester.attest({ envelope: value.envelope, core_signature: value.coreSignature }),
    /nyra_policy_attestation_replay_response_invalid/);
  assert.equal(attester.status().ready, false);
  assert.equal(attester.status().replay_state, "unavailable");
});

test("record responses are revalidated exactly, cryptographically, and against the request", async () => {
  const mutations = [
    (_recorded, value) => {
      const envelope = {
        ...value.envelope,
        operation_id: "operation-other-valid",
        nonce: crypto.randomBytes(24).toString("base64url"),
      };
      return {
        response: {
          schema_version: SCHEMA_VERSION,
          envelope,
          core_signature: crypto.sign(null, payloadBytes(envelope), value.core.privateKey).toString("base64url"),
          nyra_signature: crypto.sign(null, payloadBytes(envelope), value.nyra.privateKey).toString("base64url"),
        },
        idempotent_replay: true,
      };
    },
    (recorded) => ({
      ...recorded,
      response: { ...recorded.response, unexpected_store_field: true },
    }),
    (recorded) => ({
      ...recorded,
      response: { ...recorded.response, nyra_signature: "A".repeat(86) },
    }),
    (recorded) => ({ ...recorded, unexpected_wrapper_field: true }),
  ];
  for (const mutate of mutations) {
    const value = fixture();
    const replayStore = {
      kind: "postgresql", restart_durable: true, distributed: true,
      async initialize() {}, async probe() {}, async lookup() { return null; },
      async record({ response }) {
        return mutate({ response: clone(response), idempotent_replay: false }, value);
      },
    };
    const attester = await createReady(value, { replayStore });
    await assert.rejects(attester.attest({ envelope: value.envelope, core_signature: value.coreSignature }),
      /nyra_policy_attestation_replay_response_invalid/);
    assert.equal(attester.status().ready, false);
    assert.equal(attester.status().replay_state, "unavailable");
    assert.equal(attester.status().error, "nyra_policy_attestation_replay_response_invalid");
  }
});

class MemoryPgPool {
  constructor() { this.rows = new Map(); }
  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    if (/^(?:CREATE TABLE|CREATE INDEX|SELECT 1)/.test(normalized)) return { rows: [], rowCount: 0 };
    const key = `${params[0]}:${params[1]}`;
    if (normalized.startsWith("INSERT INTO nyra_policy_registry_attestation_replay")) {
      if (this.rows.has(key)) return { rows: [], rowCount: 0 };
      const response = JSON.parse(params[4]);
      this.rows.set(key, { envelope_digest: params[2], response });
      return { rows: [{ response }], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT envelope_digest,response")) {
      const row = this.rows.get(key);
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error(`unexpected_sql:${normalized}`);
  }
}

function clone(value) { return structuredClone(value); }

test("PostgreSQL schema initialization retries after a shared transient failure", async () => {
  let queryCalls = 0;
  const pool = {
    async query() {
      queryCalls += 1;
      if (queryCalls === 1) throw new Error("transient_database_startup_failure");
      return { rows: [], rowCount: 0 };
    },
  };
  const store = createPostgresReplayStore(pool);
  const firstAttempt = await Promise.allSettled([store.initialize(), store.initialize(), store.initialize()]);
  assert.deepEqual(firstAttempt.map((item) => item.status), ["rejected", "rejected", "rejected"]);
  assert.equal(queryCalls, 1);
  await store.initialize();
  assert.equal(queryCalls, 3);
  await store.initialize();
  assert.equal(queryCalls, 3);
});

test("PostgreSQL replay is restart-shared, atomic and rejects nonce drift", async () => {
  const pool = new MemoryPgPool();
  const first = createPostgresReplayStore(pool);
  const restarted = createPostgresReplayStore(pool);
  await Promise.all([first.initialize(), restarted.initialize()]);
  const input = { tenantId: "codexai", nonce: "n".repeat(24), envelopeDigest: "a".repeat(64),
    expiresAt: new Date(NOW + 60_000).toISOString(), response: { signature: "first" } };
  const [left, right] = await Promise.all([first.record(input), restarted.record(input)]);
  assert.deepEqual([left.idempotent_replay, right.idempotent_replay].sort(), [false, true]);
  assert.deepEqual(await restarted.lookup(input), input.response);
  await assert.rejects(restarted.lookup({ ...input, envelopeDigest: "b".repeat(64) }), /nonce_reused/);
});

test("concurrent attestation callers converge on one PostgreSQL replay response", async () => {
  const value = fixture();
  const replayStore = createPostgresReplayStore(new MemoryPgPool());
  const attester = await createReady(value, { replayStore });
  const request = { envelope: value.envelope, core_signature: value.coreSignature };
  const [left, right] = await Promise.all([attester.attest(request), attester.attest(request)]);
  assert.deepEqual([left.idempotent_replay, right.idempotent_replay].sort(), [false, true]);
  assert.equal(left.nyra_signature, right.nyra_signature);
});
