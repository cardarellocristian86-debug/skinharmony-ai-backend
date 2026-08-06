import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { nyraDeepV2CanonicalJson } from "../src/nyraDeepV2EvidenceLedger.js";
import {
  createNyraDeepBranchV2RemoteSigner,
  NYRA_DEEP_V2_REMOTE_SIGNER_JWKS_PATH,
  NYRA_DEEP_V2_REMOTE_SIGNER_PATH,
  NYRA_DEEP_V2_SIGN_PURPOSE,
  NYRA_DEEP_V2_SIGN_REQUEST_SCHEMA_VERSION,
  NYRA_DEEP_V2_SIGN_RESPONSE_SCHEMA_VERSION,
  remoteSignerConfig,
} from "../src/nyraDeepBranchV2RemoteSigner.js";

const SERVICE = "skinharmony-core-staging-issuer";
const HOSTPORT = `${SERVICE}:10000`;
const KEY_ID = "universal-core-nyra-v2";
const TARGET_COMMIT = "50d9bb6a7b3a06eb93b6cf12ba3d726534b4476a";
const TOKEN = crypto.randomBytes(32).toString("hex");

function keyMaterial() {
  const pair = crypto.generateKeyPairSync("ed25519");
  const jwk = pair.publicKey.export({ format: "jwk" });
  return {
    pair,
    jwks: { keys: [{ ...jwk, kid: KEY_ID, use: "sig", alg: "EdDSA" }] },
  };
}

function env(overrides = {}, jwks = null) {
  return {
    CORE_NYRA_DEEP_BRANCH_V2_ATTESTATION_KEY_ID: KEY_ID,
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_URL: HOSTPORT,
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_ALLOWED_ORIGIN: HOSTPORT,
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_BEARER_TOKEN: TOKEN,
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_PUBLIC_JWKS: jwks ? JSON.stringify(jwks) : "",
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_PUBLIC_JWKS_URL: jwks ? "" : HOSTPORT,
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_EXPECTED_SERVICE: SERVICE,
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_TARGET_COMMIT: TARGET_COMMIT,
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_TIMEOUT_MS: "250",
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_MAX_RESPONSE_BYTES: "393216",
    ...overrides,
  };
}

function unsignedAttestation(overrides = {}) {
  return {
    schema_version: "nyra_deep_branch_v2_operational_attestation_v1",
    issuer: "skinharmony-universal-core",
    audience: "skinharmony-nyra-core",
    key_id: KEY_ID,
    tenant_id: "codexai",
    request_id: "mcpv2_remote_signer_test",
    nonce: "a".repeat(64),
    issued_at: "2026-08-05T18:00:00.000Z",
    expires_at: "2026-08-05T18:01:00.000Z",
    ...overrides,
  };
}

function sign(privateKey, attestation) {
  return crypto.sign(
    null,
    Buffer.from(
      `nyra-deep-branch-v2-operational-attestation\u0000${nyraDeepV2CanonicalJson(attestation)}`,
      "utf8",
    ),
    privateKey,
  ).toString("base64url");
}

function signerResponse(privateKey, request, mutate = null) {
  const attestation = structuredClone(request.attestation);
  mutate?.(attestation);
  attestation.signature = sign(privateKey, attestation);
  return {
    schema_version: NYRA_DEEP_V2_SIGN_RESPONSE_SCHEMA_VERSION,
    purpose: NYRA_DEEP_V2_SIGN_PURPOSE,
    target_commit: request.target_commit,
    key_id: KEY_ID,
    attestation,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("remote signer config binds provider-native hostport, exact service, endpoint, and commit", () => {
  const { jwks } = keyMaterial();
  const config = remoteSignerConfig(env({}, jwks));
  assert.equal(config.configured, true);
  assert.equal(config.url, `http://${HOSTPORT}${NYRA_DEEP_V2_REMOTE_SIGNER_PATH}`);
  assert.equal(config.expected_service, SERVICE);
  assert.equal(config.target_commit, TARGET_COMMIT);
  assert.equal(config.max_response_bytes, 393_216);
  assert.equal("bearer_token" in config, true);
  assert.equal(remoteSignerConfig(env({
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_EXPECTED_SERVICE: "different-service",
  }, jwks)).configured, false);
  assert.equal(remoteSignerConfig(env({
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_URL:
      `https://${SERVICE}.onrender.com${NYRA_DEEP_V2_REMOTE_SIGNER_PATH}`,
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_ALLOWED_ORIGIN:
      `https://${SERVICE}.onrender.com`,
  }, jwks)).configured, false);
  assert.equal(remoteSignerConfig(env({
    CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_MAX_RESPONSE_BYTES: "393217",
  }, jwks)).max_response_bytes, 393_216);
});

test("remote signer fetches public JWKS, sends an opaque bearer, and verifies Ed25519 locally", async () => {
  const { pair, jwks } = keyMaterial();
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (String(url).endsWith(NYRA_DEEP_V2_REMOTE_SIGNER_JWKS_PATH)) {
      return jsonResponse(jwks);
    }
    const request = JSON.parse(options.body);
    assert.deepEqual(Object.keys(request).sort(), [
      "attestation", "purpose", "schema_version", "target_commit",
    ]);
    assert.equal(request.schema_version, NYRA_DEEP_V2_SIGN_REQUEST_SCHEMA_VERSION);
    assert.equal(request.purpose, NYRA_DEEP_V2_SIGN_PURPOSE);
    assert.equal(request.target_commit, TARGET_COMMIT);
    assert.equal(options.headers.authorization, `Bearer ${TOKEN}`);
    return jsonResponse(signerResponse(pair.privateKey, request));
  };
  const signer = createNyraDeepBranchV2RemoteSigner({ env: env(), fetchImpl });
  const result = await signer.signOperational({ attestation: unsignedAttestation() });
  assert.equal(result.ok, true);
  assert.equal(signer.verifyOperationalSignature(result.attestation), true);
  assert.equal(requests.length, 2);
  assert.equal(signer.status().public_key_ready, true);
});

test("remote signer rejects signed-but-mutated attestation and a mismatched target commit", async () => {
  const { pair, jwks } = keyMaterial();
  const mutated = createNyraDeepBranchV2RemoteSigner({
    env: env({}, jwks),
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return jsonResponse(signerResponse(pair.privateKey, request, (attestation) => {
        attestation.tenant_id = "other-tenant";
      }));
    },
  });
  assert.deepEqual(
    await mutated.signOperational({ attestation: unsignedAttestation() }),
    { ok: false, reason: "nyra_deep_v2_remote_signer_attestation_tampered" },
  );

  const commitMismatch = createNyraDeepBranchV2RemoteSigner({
    env: env({}, jwks),
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      const response = signerResponse(pair.privateKey, request);
      response.target_commit = "f".repeat(40);
      return jsonResponse(response);
    },
  });
  assert.deepEqual(
    await commitMismatch.signOperational({ attestation: unsignedAttestation() }),
    { ok: false, reason: "nyra_deep_v2_remote_signer_response_binding_invalid" },
  );
});

test("remote signer fails closed on invalid signature, timeout, and unavailability", async () => {
  const { pair, jwks } = keyMaterial();
  const invalidSignature = createNyraDeepBranchV2RemoteSigner({
    env: env({}, jwks),
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      const response = signerResponse(pair.privateKey, request);
      response.attestation.signature = "A".repeat(86);
      return jsonResponse(response);
    },
  });
  assert.equal(
    (await invalidSignature.signOperational({ attestation: unsignedAttestation() })).reason,
    "nyra_deep_v2_remote_signer_signature_invalid",
  );

  const timeout = createNyraDeepBranchV2RemoteSigner({
    env: env({}, jwks),
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });
  assert.equal(
    (await timeout.signOperational({ attestation: unsignedAttestation() })).reason,
    "nyra_deep_v2_remote_signer_timeout",
  );

  const unavailable = createNyraDeepBranchV2RemoteSigner({
    env: env({}, jwks),
    fetchImpl: async () => { throw new Error("network unavailable"); },
  });
  assert.equal(
    (await unavailable.signOperational({ attestation: unsignedAttestation() })).reason,
    "nyra_deep_v2_remote_signer_unavailable",
  );
});

test("remote signer enforces the bounded response body", async () => {
  const { jwks } = keyMaterial();
  const signer = createNyraDeepBranchV2RemoteSigner({
    env: env({
      CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_MAX_RESPONSE_BYTES: "4096",
    }, jwks),
    fetchImpl: async () => jsonResponse({ padding: "x".repeat(8_000) }),
  });
  assert.equal(
    (await signer.signOperational({ attestation: unsignedAttestation() })).reason,
    "nyra_deep_v2_remote_signer_response_too_large",
  );
});
