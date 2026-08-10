import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  genericWorkCoreJoinSignaturePayload,
} from "../src/genericWorkCoreJoin.js";
import {
  GENERIC_WORK_CORE_JOIN_SIGN_REQUEST_SCHEMA_VERSION,
  GENERIC_WORK_CORE_JOIN_SIGN_RESPONSE_SCHEMA_VERSION,
  createGenericWorkCoreJoinRemoteSigner,
} from "../src/genericWorkCoreJoinRemoteSigner.js";

const KEYS = crypto.generateKeyPairSync("ed25519");
const WRONG_KEYS = crypto.generateKeyPairSync("ed25519");
const KEY_ID = "generic-work-core-join-remote-key";
const TARGET_COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);
const TOKEN = "opaque-service-token-0123456789";
const PUBLIC_KEY = KEYS.publicKey.export({ type: "spki", format: "pem" });
const PRIVATE_KEY = KEYS.privateKey.export({ type: "pkcs8", format: "pem" });
const EXPORTED_JWK = KEYS.publicKey.export({ format: "jwk" });
const EXPORTED_PRIVATE_JWK = KEYS.privateKey.export({ format: "jwk" });
const JWKS = {
  keys: [{ alg: "EdDSA", crv: "Ed25519", kid: KEY_ID, kty: "OKP", use: "sig", x: EXPORTED_JWK.x }],
};

function config(overrides = {}) {
  return {
    origin: "https://signer.example.invalid",
    path: "/v1/generic-work-core-join/sign",
    service: "universal-core-service",
    targetCommit: TARGET_COMMIT,
    purpose: "generic_work_core_join_v1",
    keyId: KEY_ID,
    serviceToken: TOKEN,
    jwks: JWKS,
    ...overrides,
  };
}

function signedResponse(request, overrides = {}, signingKey = KEYS.privateKey) {
  const response = {
    schema_version: GENERIC_WORK_CORE_JOIN_SIGN_RESPONSE_SCHEMA_VERSION,
    service: request.service,
    target_commit: request.target_commit,
    purpose: request.purpose,
    key_id: request.key_id,
    digest: request.digest,
    signature_algorithm: "ed25519",
    signature: crypto.sign(null, genericWorkCoreJoinSignaturePayload(request.digest), signingKey).toString("base64url"),
    ...overrides,
  };
  return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
}

test("remote signer binds the exact request and returns only a locally verified signature", async () => {
  let observed = null;
  const signer = createGenericWorkCoreJoinRemoteSigner(config({
    async fetchImpl(url, init) {
      await new Promise((resolve) => setImmediate(resolve));
      const request = JSON.parse(init.body);
      observed = { url, init, request };
      return signedResponse(request);
    },
  }));
  const signature = await signer.signDigest(DIGEST);
  assert.equal(crypto.verify(null, genericWorkCoreJoinSignaturePayload(DIGEST), KEYS.publicKey, Buffer.from(signature, "base64url")), true);
  assert.equal(observed.url, "https://signer.example.invalid/v1/generic-work-core-join/sign");
  assert.equal(observed.init.redirect, "error");
  assert.equal(observed.init.credentials, "omit");
  assert.equal(observed.init.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(observed.request, {
    schema_version: GENERIC_WORK_CORE_JOIN_SIGN_REQUEST_SCHEMA_VERSION,
    service: "universal-core-service",
    target_commit: TARGET_COMMIT,
    purpose: "generic_work_core_join_v1",
    key_id: KEY_ID,
    digest: DIGEST,
  });
  assert.equal(observed.url.includes(TOKEN), false);
  assert.equal(observed.init.body.includes(TOKEN), false);
  assert.equal(JSON.stringify(signer).includes(TOKEN), false);
  assert.deepEqual(signer.health(), { signer_state: "ready", reason: null, custody: "external_remote_signer" });
});

test("remote signer rejects digest, commit, key, purpose and service response tampering", async (t) => {
  const cases = [
    ["digest", "c".repeat(64), "generic_work_core_join_signer_digest_mismatch"],
    ["target_commit", "d".repeat(40), "generic_work_core_join_signer_target_commit_mismatch"],
    ["key_id", "generic-work-core-join-other-key", "generic_work_core_join_signer_key_id_mismatch"],
    ["purpose", "generic_work_core_join_other", "generic_work_core_join_signer_purpose_mismatch"],
    ["service", "other-core-service", "generic_work_core_join_signer_service_mismatch"],
  ];
  for (const [field, value, code] of cases) {
    await t.test(field, async () => {
      const signer = createGenericWorkCoreJoinRemoteSigner(config({
        fetchImpl: async (_url, init) => signedResponse(JSON.parse(init.body), { [field]: value }),
      }));
      await assert.rejects(signer.signDigest(DIGEST), new RegExp(code));
      assert.equal(signer.health().signer_state, "rejected");
      assert.equal(signer.health().reason, code);
    });
  }
});

test("remote signer rejects invalid signatures and non-exact response schemas", async () => {
  const invalidSignature = createGenericWorkCoreJoinRemoteSigner(config({
    fetchImpl: async (_url, init) => signedResponse(JSON.parse(init.body), {}, WRONG_KEYS.privateKey),
  }));
  await assert.rejects(invalidSignature.signDigest(DIGEST), /generic_work_core_join_signer_signature_invalid/);

  const extraField = createGenericWorkCoreJoinRemoteSigner(config({
    fetchImpl: async (_url, init) => signedResponse(JSON.parse(init.body), { extra: true }),
  }));
  await assert.rejects(extraField.signDigest(DIGEST), /generic_work_core_join_signer_response_invalid/);
});

test("a slower older success cannot overwrite a newer cryptographic failure in health", async () => {
  let calls = 0;
  let releaseSlow;
  const signer = createGenericWorkCoreJoinRemoteSigner(config({
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      const call = ++calls;
      if (call === 1) await new Promise((resolve) => { releaseSlow = resolve; });
      return signedResponse(request, {}, call === 1 ? KEYS.privateKey : WRONG_KEYS.privateKey);
    },
  }));
  const slowSuccess = signer.signDigest(DIGEST);
  await new Promise((resolve) => setImmediate(resolve));
  const fastFailure = signer.signDigest("c".repeat(64));
  await assert.rejects(fastFailure, /generic_work_core_join_signer_signature_invalid/);
  assert.equal(signer.health().signer_state, "rejected");
  releaseSlow();
  await slowSuccess;
  assert.equal(signer.health().signer_state, "rejected");
  assert.equal(signer.health().reason, "generic_work_core_join_signer_signature_invalid");
});

test("remote signer denies timeout, oversized responses, redirects and upstream unavailability", async () => {
  const timeout = createGenericWorkCoreJoinRemoteSigner(config({
    timeoutMs: 100,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
  }));
  await assert.rejects(timeout.signDigest(DIGEST), /generic_work_core_join_signer_timeout/);

  const ignoresAbort = createGenericWorkCoreJoinRemoteSigner(config({
    timeoutMs: 100,
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      await new Promise((resolve) => setTimeout(resolve, 180));
      return signedResponse(request);
    },
  }));
  const started = Date.now();
  await assert.rejects(ignoresAbort.signDigest(DIGEST), /generic_work_core_join_signer_timeout/);
  assert.ok(Date.now() - started < 170, "hard deadline must not await a transport that ignores AbortSignal");
  assert.equal(ignoresAbort.health().signer_state, "unavailable");

  const oversized = createGenericWorkCoreJoinRemoteSigner(config({
    maxResponseBytes: 512,
    fetchImpl: async () => new Response("x".repeat(513), { status: 200, headers: { "content-type": "application/json" } }),
  }));
  await assert.rejects(oversized.signDigest(DIGEST), /generic_work_core_join_signer_response_too_large/);

  const redirect = createGenericWorkCoreJoinRemoteSigner(config({
    fetchImpl: async () => new Response("", { status: 302, headers: { location: "https://other.example.invalid/sign" } }),
  }));
  await assert.rejects(redirect.signDigest(DIGEST), /generic_work_core_join_signer_redirect_denied/);

  const unavailable = createGenericWorkCoreJoinRemoteSigner(config({
    fetchImpl: async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } }),
  }));
  await assert.rejects(unavailable.signDigest(DIGEST), /generic_work_core_join_signer_unavailable/);
});

test("remote signer requires a credential-free HTTPS endpoint and one pinned inline Ed25519 key", () => {
  assert.throws(() => createGenericWorkCoreJoinRemoteSigner(config({ origin: "https://user:password@signer.example.invalid" })), /generic_work_core_join_signer_origin_invalid/);
  assert.throws(() => createGenericWorkCoreJoinRemoteSigner(config({ path: "/sign?token=secret" })), /generic_work_core_join_signer_path_invalid/);
  assert.throws(() => createGenericWorkCoreJoinRemoteSigner(config({ jwks: undefined })), /generic_work_core_join_signer_pinned_key_required/);
  assert.throws(() => createGenericWorkCoreJoinRemoteSigner(config({ publicKey: PUBLIC_KEY })), /generic_work_core_join_signer_pinned_key_required/);
  const publicJwk = JWKS.keys[0];
  for (const accepted of [KEYS.publicKey, PUBLIC_KEY, publicJwk, JSON.stringify(publicJwk)]) {
    const inline = createGenericWorkCoreJoinRemoteSigner(config({ jwks: undefined, publicKey: accepted }));
    assert.match(inline.public_key_fingerprint, /^[a-f0-9]{64}$/);
  }
  const privateJwk = { ...EXPORTED_PRIVATE_JWK, alg: "EdDSA", kid: KEY_ID, use: "sig" };
  for (const rejected of [
    KEYS.privateKey,
    PRIVATE_KEY,
    { key: KEYS.privateKey },
    { key: PRIVATE_KEY, format: "pem" },
    privateJwk,
    JSON.stringify(privateJwk),
  ]) {
    assert.throws(() => createGenericWorkCoreJoinRemoteSigner(config({ jwks: undefined, publicKey: rejected })), /generic_work_core_join_signer_public_key_invalid/);
  }
  assert.throws(() => createGenericWorkCoreJoinRemoteSigner(config({ jwks: { keys: [privateJwk] } })), /generic_work_core_join_signer_jwks_invalid/);
});
