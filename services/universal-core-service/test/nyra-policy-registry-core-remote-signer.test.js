import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  POLICY_REGISTRY_SIGN_REQUEST_SCHEMA,
  POLICY_REGISTRY_SIGN_RESPONSE_SCHEMA,
  createNyraPolicyRegistryCoreRemoteSigner,
} from "../src/nyraPolicyRegistryCoreRemoteSigner.js";

const ORIGIN = "https://core-policy-signer.example";
const PATH = "/v1/policy-registry/sign";
const ENDPOINT = `${ORIGIN}${PATH}`;
const COMMIT = "b".repeat(40);
const TOKEN = "signer-service-token-not-for-logs";

function jsonResponse(url, value, { status = 200, bodyDelayMs = 0 } = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    url,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return "application/json; charset=utf-8";
        if (String(name).toLowerCase() === "content-length") return String(bytes.length);
        return null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (sent) return { done: true };
            sent = true;
            if (bodyDelayMs) await new Promise((resolve) => setTimeout(resolve, bodyDelayMs));
            return { done: false, value: bytes };
          },
          releaseLock() {},
          async cancel() {},
        };
      },
    },
  };
}

function validSignerResponse(request, privateKey, overrides = {}) {
  const payload = Buffer.from(request.payload, "base64url");
  return {
    schema_version: POLICY_REGISTRY_SIGN_RESPONSE_SCHEMA,
    service: request.service,
    target_commit: request.target_commit,
    purpose: request.purpose,
    key_id: request.key_id,
    digest: request.digest,
    signature_algorithm: "Ed25519",
    signature: crypto.sign(null, payload, privateKey).toString("base64url"),
    ...overrides,
  };
}

function setup(fetchImpl, overrides = {}) {
  const keys = overrides.keys || crypto.generateKeyPairSync("ed25519");
  const signer = createNyraPolicyRegistryCoreRemoteSigner({
    origin: ORIGIN,
    path: PATH,
    service: "core-policy-registry-signer",
    targetCommit: COMMIT,
    keyId: "core-policy-key-v2",
    serviceToken: TOKEN,
    publicKey: keys.publicKey,
    fetchImpl,
    timeoutMs: overrides.timeoutMs ?? 100,
    probeCooldownMs: overrides.probeCooldownMs ?? 100,
    maxResponseBytes: 4096,
    now: overrides.now,
  });
  return { keys, signer };
}

test("remote signer binds exact request, target commit and locally verifies Ed25519", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  let calls = 0;
  const { signer } = setup(async (url, options) => {
    calls += 1;
    assert.equal(url, ENDPOINT);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, `Bearer ${TOKEN}`);
    const request = JSON.parse(options.body);
    assert.equal(request.schema_version, POLICY_REGISTRY_SIGN_REQUEST_SCHEMA);
    assert.equal(request.target_commit, COMMIT);
    return jsonResponse(url, validSignerResponse(request, keys.privateKey));
  }, { keys });

  assert.equal(await signer.probe(), true);
  assert.equal(signer.health().signer_state, "ready");
  const payload = Buffer.from("receipt-v2-payload");
  const signature = await signer.signPayload(payload, "core-policy-activation-receipt-v2");
  assert.equal(crypto.verify(null, payload, keys.publicKey, Buffer.from(signature, "base64url")), true);
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(signer.health()).includes(TOKEN), false);
});

test("remote signer rejects private/RSA keys and exact response drift", async () => {
  const ed = crypto.generateKeyPairSync("ed25519");
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => setup(async () => null, { keys: { ...ed, publicKey: ed.privateKey } }),
    /policy_registry_core_signer_public_key_invalid/);
  assert.throws(() => setup(async () => null, { keys: rsa }),
    /policy_registry_core_signer_public_key_invalid/);

  const { signer } = setup(async (url, options) => {
    const request = JSON.parse(options.body);
    return jsonResponse(url, validSignerResponse(request, ed.privateKey, { target_commit: "c".repeat(40) }));
  }, { keys: ed });
  await assert.rejects(
    signer.signPayload(Buffer.from("payload"), "core-policy-activation-receipt-v2"),
    /policy_registry_core_signer_target_commit_mismatch/,
  );
  assert.equal(signer.health().signer_state, "rejected");
});

test("hard deadline retains single-flight and late success cannot promote readiness", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  let calls = 0;
  const { signer } = setup(async (url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const response = jsonResponse(url, validSignerResponse(request, keys.privateKey), {
      bodyDelayMs: calls === 1 ? 150 : 0,
    });
    return response;
  }, { keys, timeoutMs: 100, probeCooldownMs: 100 });

  assert.equal(await signer.probe(), false);
  assert.equal(signer.health().signer_state, "unavailable");
  assert.equal(signer.health().reason, "policy_registry_core_signer_timeout");
  assert.equal(await signer.probe(), false);
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(signer.health().signer_state, "unavailable");
  assert.equal(await signer.probe(), false);
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 105));
  assert.equal(await signer.probe(), true);
  assert.equal(calls, 2);
  assert.equal(signer.health().signer_state, "ready");
});

test("a ready probe expires after cooldown and detects a later signer outage", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  let timestamp = Date.parse("2026-08-10T12:00:00.000Z");
  let upstreamReady = true;
  let calls = 0;
  const { signer } = setup(async (url, options) => {
    calls += 1;
    if (!upstreamReady) throw new Error(`signer outage ${TOKEN}`);
    const request = JSON.parse(options.body);
    return jsonResponse(url, validSignerResponse(request, keys.privateKey));
  }, { keys, now: () => timestamp, probeCooldownMs: 100 });

  assert.equal(await signer.probe(), true);
  assert.equal(calls, 1);
  assert.equal(await signer.probe(), true);
  assert.equal(calls, 1);

  upstreamReady = false;
  timestamp += 101;
  assert.equal(await signer.probe(), false);
  assert.equal(calls, 2);
  assert.equal(signer.health().signer_state, "unavailable");
  assert.equal(JSON.stringify(signer.health()).includes(TOKEN), false);
});

test("unknown transport errors are closed and never reflect service tokens", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const { signer } = setup(async () => {
    throw new Error(`upstream leaked ${TOKEN}`);
  }, { keys });
  await assert.rejects(
    signer.signPayload(Buffer.from("payload"), "nyra-policy-activation-attestation-v2"),
    /policy_registry_core_signer_unavailable/,
  );
  assert.equal(JSON.stringify(signer.health()).includes(TOKEN), false);
});
