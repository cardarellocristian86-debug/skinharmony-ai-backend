import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  createGenericWorkCoreJoinSignerEndpoint,
} from "../../github-standing-release-worker/src/genericWorkCoreJoinSigner.js";
import {
  createGenericWorkCoreJoinRemoteSigner,
} from "../src/genericWorkCoreJoinRemoteSigner.js";

const KEYS = crypto.generateKeyPairSync("ed25519");
const PRIVATE_KEY = KEYS.privateKey.export({ type: "pkcs8", format: "pem" });
const PUBLIC_KEY = KEYS.publicKey.export({ type: "spki", format: "pem" });
const TOKEN = "test-only-cross-service-token-0123456789";
const TARGET_COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);
const KEY_ID = "generic-work-core-join-production-v1";
const ORIGIN = "https://signer.example.invalid";
const PATH = "/v1/generic-work-core-join/sign";

function responseAdapter(resolve) {
  let status = 200;
  const headers = new Headers({ "content-type": "application/json" });
  return {
    set(name, value) {
      headers.set(name, value);
      return this;
    },
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      resolve(new Response(JSON.stringify(value), { status, headers }));
      return this;
    },
  };
}

test("Universal Core client and worker endpoint share the exact authenticated signing contract", async () => {
  const endpoint = createGenericWorkCoreJoinSignerEndpoint({
    env: {
      GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE: "universal-core-service",
      GENERIC_WORK_CORE_JOIN_SIGNER_PURPOSE: "generic_work_core_join_v1",
      GENERIC_WORK_CORE_JOIN_SIGNER_KEY_ID: KEY_ID,
      GENERIC_WORK_CORE_JOIN_SIGNER_TARGET_COMMIT: TARGET_COMMIT,
      GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE_TOKEN: TOKEN,
      GENERIC_WORK_CORE_JOIN_SIGNER_PRIVATE_KEY: PRIVATE_KEY,
    },
  });
  let calls = 0;
  const signer = createGenericWorkCoreJoinRemoteSigner({
    origin: ORIGIN,
    path: PATH,
    service: "universal-core-service",
    targetCommit: TARGET_COMMIT,
    purpose: "generic_work_core_join_v1",
    keyId: KEY_ID,
    serviceToken: TOKEN,
    publicKey: PUBLIC_KEY,
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, `${ORIGIN}${PATH}`);
      assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(init.headers["content-type"], "application/json");
      return new Promise((resolve) => endpoint.handle({
        body: JSON.parse(init.body),
        get(name) {
          return name.toLowerCase() === "authorization" ? init.headers.authorization : undefined;
        },
      }, responseAdapter(resolve), {
        worker_enabled: true,
        worker_ready: true,
        emergency_stop: false,
      }));
    },
  });

  const signature = await signer.signDigest(DIGEST);
  assert.equal(calls, 1);
  assert.equal(crypto.verify(
    null,
    Buffer.from(`generic_work_core_join_v1\0${DIGEST}`, "utf8"),
    KEYS.publicKey,
    Buffer.from(signature, "base64url"),
  ), true);
  assert.deepEqual(signer.health(), {
    signer_state: "ready",
    reason: null,
    custody: "external_remote_signer",
  });
  assert.equal(JSON.stringify(endpoint.health({
    worker_enabled: true,
    worker_ready: true,
    emergency_stop: false,
  })).includes(TOKEN), false);
});
