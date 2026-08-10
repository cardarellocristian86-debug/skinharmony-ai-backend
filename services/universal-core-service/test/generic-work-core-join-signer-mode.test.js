import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import http from "node:http";

import { createUniversalCoreService } from "../src/app.js";
import { createMemoryGenericWorkCoreJoinStore } from "../src/genericWorkCoreJoinStore.js";

process.env.NODE_ENV = "test";

const keyPair = crypto.generateKeyPairSync("ed25519");
const privateKey = keyPair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" });
const fingerprint = crypto.createHash("sha256").update(keyPair.publicKey.export({ type: "spki", format: "der" })).digest("hex");

function durableStore() { const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => {}; return store; }
function base(overrides = {}) { return { storageRoot: "/tmp/gwcj-signer-mode", dttAgentIdentitySigningSecret: "dtt-signer-mode-secret-0123456789", genericWorkCoreJoinStore: durableStore(), genericWorkCoreJoinEd25519PrivateKey: privateKey, genericWorkCoreJoinEd25519KeyId: "key-01", ...overrides }; }
function probeResponse(request) { const signature = crypto.sign(null, Buffer.from(`generic_work_core_join_remote_probe_v1\0${request.nonce}`), keyPair.privateKey).toString("base64url"); return { ok: true, async json() { return { schema_version: "generic_work_core_join_probe_response_v1", purpose: "generic_work_core_join_remote_probe_v1", key_id: "key-01", nonce: request.nonce, algorithm: "Ed25519", public_key_fingerprint: fingerprint, signature }; } }; }
function trustRegistry(status = "active", keyId = "key-01") { return JSON.stringify({ schema_version: "generic_work_core_join_trust_registry_v1", revision: "registry-20260809-v1", keys: { [keyId]: { status, ...(status === "revoked" ? {} : { public_key: publicKey }) }, "retired-key-01": { status: "retired", public_key: publicKey } } }); }
function signer(probe = async () => ({ key_id: "key-01", public_key_fingerprint: fingerprint })) { return { algorithm: "Ed25519", key_id: "key-01", public_key: keyPair.publicKey, public_key_fingerprint: fingerprint, custody: "test_only", probe, signDigest: async () => "signature" }; }
function remote(overrides = {}) { return { genericWorkCoreJoinSignerMode: "remote", genericWorkCoreJoinEd25519KeyId: "key-01", genericWorkCoreJoinRemoteSignerUrl: "https://signer.example/sign", genericWorkCoreJoinRemoteSignerHealthUrl: "https://signer.example/health", genericWorkCoreJoinRemoteSignerAllowedUrlsJson: JSON.stringify(["https://signer.example/sign", "https://signer.example/health"]), genericWorkCoreJoinRemoteSignerToken: "token", genericWorkCoreJoinTrustRegistryJson: trustRegistry(), testOnlyGenericWorkCoreJoinRemoteSignerFactory: () => signer(), ...overrides }; }
async function health(app) { const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); try { const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`); return response.json(); } finally { await new Promise((resolve) => server.close(resolve)); } }

test("legacy local signer remains available only with remote configuration absent", async () => {
  const { app } = createUniversalCoreService(base());
  assert.ok(app);
  const optionSigner = { algorithm: "Ed25519", key_id: "option-key-01", public_key: keyPair.publicKey, public_key_fingerprint: fingerprint, custody: "test_option", signDigest: () => "signature" };
  const optionService = createUniversalCoreService(base({ genericWorkCoreJoinSigner: optionSigner }));
  await new Promise((resolve) => setImmediate(resolve));
  const optionHealth = await health(optionService.app);
  assert.equal(optionHealth.generic_work_core_join.key_id, "option-key-01");
  assert.throws(() => createUniversalCoreService(base({ ...remote() })), /generic_work_core_join_signer_configuration_ambiguous/);
  assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinRemoteSignerUrl: "https://signer.example/sign" })), /generic_work_core_join_remote_signer_mode_required/);
});

test("remote mode requires complete trusted configuration and probes before readiness", async () => {
  assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ genericWorkCoreJoinRemoteSignerToken: "" }) })), /generic_work_core_join_remote_signer_configuration_incomplete/);
  let completeProbe;
  const { app } = createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ testOnlyGenericWorkCoreJoinRemoteSignerFactory: () => signer(() => new Promise((resolve) => { completeProbe = () => resolve({ key_id: "key-01", public_key_fingerprint: fingerprint }); })) }) }));
  await Promise.resolve();
  const pending = await health(app);
  assert.equal(pending.generic_work_core_join.probe_state, "initializing");
  assert.equal(pending.generic_work_core_join.ready, false);
  completeProbe();
  let ready;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    ready = await health(app);
    if (ready.generic_work_core_join.ready) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(ready.generic_work_core_join.probe_state, "ready");
  assert.equal(ready.generic_work_core_join.ready, true, JSON.stringify(ready.generic_work_core_join));
  const failed = createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ testOnlyGenericWorkCoreJoinRemoteSignerFactory: () => signer(async () => { throw new Error("probe_failed"); }) }) }));
  await new Promise((resolve) => setImmediate(resolve));
  const failedHealth = await health(failed.app);
  assert.equal(failedHealth.generic_work_core_join.probe_state, "failed");
  assert.equal(failedHealth.generic_work_core_join.ready, false);
});

test("required Generic Join is surfaced as a production readiness dependency", async () => {
  const { app } = createUniversalCoreService(base({ genericWorkCoreJoinRequired: true, genericWorkCoreJoinEd25519PrivateKey: "" }));
  const result = await health(app);
  assert.equal(result.generic_work_core_join.required, true);
  assert.equal(result.generic_work_core_join.ready, false);
  assert.equal(result.render_ready, false);
});

test("remote mode derives the active key from the versioned trust registry and rejects retired, revoked, or unknown active keys", () => {
  const active = createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote() }));
  assert.ok(active.app);
  assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ genericWorkCoreJoinTrustRegistryJson: trustRegistry("retired") }) })), /generic_work_core_join_remote_signer_trust_configuration_invalid/);
  assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ genericWorkCoreJoinTrustRegistryJson: trustRegistry("revoked") }) })), /generic_work_core_join_remote_signer_trust_configuration_invalid/);
  assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ genericWorkCoreJoinEd25519KeyId: "unknown-key" }) })), /generic_work_core_join_remote_signer_trust_configuration_invalid/);
});

test("test-only remote signer injection is rejected outside NODE_ENV=test and legacy fetch injection is always denied", () => {
  assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinRemoteSignerFetchImpl: async () => ({ ok: true }) })), /generic_work_core_join_remote_test_dependency_in_config/);
  const previous = process.env.NODE_ENV;
  const previousEvidence = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production";
  process.env.CORE_EVIDENCE_SIGNING_SECRET = "test-evidence-signing-secret-0123456789";
  try {
    assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote() })), /generic_work_core_join_remote_test_dependency_in_config/);
  } finally {
    process.env.NODE_ENV = previous;
    if (previousEvidence === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET;
    else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidence;
  }
});

test("production permits only complete remote mode and denies every local signer path", () => {
  const previous = process.env.NODE_ENV;
  const previousEvidence = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production";
  process.env.CORE_EVIDENCE_SIGNING_SECRET = "test-evidence-signing-secret-0123456789";
  try {
    assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinRequired: false })), /generic_work_core_join_production_local_signer_forbidden/);
    assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", genericWorkCoreJoinRequired: false })), /generic_work_core_join_production_remote_signer_required/);
  } finally {
    process.env.NODE_ENV = previous;
    if (previousEvidence === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET;
    else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidence;
  }
});

test("test-only production readiness cannot be enabled outside NODE_ENV=test", () => {
  const previous = process.env.NODE_ENV;
  const previousEvidence = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production";
  process.env.CORE_EVIDENCE_SIGNING_SECRET = "test-evidence-signing-secret-0123456789";
  try {
    assert.throws(() => createUniversalCoreService(base({ testOnlyProductionReadiness: true })), /test_only_production_readiness_forbidden/);
  } finally {
    process.env.NODE_ENV = previous;
    if (previousEvidence === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET;
    else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidence;
  }
});

test("registry rejects multiple active keys, missing revision, and invalid entry shape", () => {
  const multipleActive = JSON.stringify({ schema_version: "generic_work_core_join_trust_registry_v1", revision: "registry-20260809-v1", keys: { "key-01": { status: "active", public_key: publicKey }, "key-02": { status: "active", public_key: publicKey } } });
  const missingRevision = JSON.stringify({ schema_version: "generic_work_core_join_trust_registry_v1", revision: "", keys: { "key-01": { status: "active", public_key: publicKey } } });
  const invalidStatus = JSON.stringify({ schema_version: "generic_work_core_join_trust_registry_v1", revision: "registry-20260809-v1", keys: { "key-01": { status: "unknown", public_key: publicKey } } });
  for (const registry of [multipleActive, missingRevision, invalidStatus]) {
    assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ genericWorkCoreJoinTrustRegistryJson: registry }) })), /generic_work_core_join_remote_signer_trust_configuration_invalid/);
  }
});

test("remote trust registry is schema-closed with Core MCP parity vectors", () => {
  const valid = { schema_version: "generic_work_core_join_trust_registry_v1", revision: "registry-20260810-v1", keys: { "key-01": { status: "active", public_key: publicKey }, "retired-key-01": { status: "retired", public_key: publicKey }, "revoked-key-01": { status: "revoked" } } };
  const invalid = [
    { ...valid, extra: true },
    { ...valid, keys: { ...valid.keys, "key-01": { ...valid.keys["key-01"], extra: true } } },
    { ...valid, keys: { ...valid.keys, "revoked-key-01": { status: "revoked", public_key: 17 } } },
    { ...valid, keys: { ...valid.keys, "revoked-key-01": { status: "revoked", extra: true } } },
  ];
  assert.ok(createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ genericWorkCoreJoinTrustRegistryJson: JSON.stringify(valid) }) })).app);
  for (const registry of invalid) {
    assert.throws(() => createUniversalCoreService(base({ genericWorkCoreJoinEd25519PrivateKey: "", ...remote({ genericWorkCoreJoinTrustRegistryJson: JSON.stringify(registry) }) })), /generic_work_core_join_remote_signer_trust_configuration_invalid/);
  }
});
