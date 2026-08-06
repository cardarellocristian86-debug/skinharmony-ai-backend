import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createNyraDeepV2OperationalSignerRuntime,
  NYRA_DEEP_V2_OPERATIONAL_SIGNER_CONTRACT,
  NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES,
  nyraDeepV2SignerCanonicalJson,
  validateNyraDeepV2OperationalSigningRequest,
} from "../src/nyraDeepV2OperationalSigner.js";
import { createMcpStagingIssuerServiceRuntime } from "../server.js";
import { MCP_STAGING_ISSUER_CONTRACT } from "../src/issuerRuntime.js";

const NOW = Date.parse("2026-08-05T18:00:00.000Z");
const TARGET_COMMIT = "068fb2d06006f53a1f7b7fb020398809e62b7470";
const OTHER_COMMIT = "1".repeat(40);
const SIGNING_SECRET = "nyra-deep-v2-signing-secret-test-only-0123456789abcdef";
const AUTH_TOKEN = "nyra-deep-v2-signing-token-test-only-0123456789abcdef";
const BASE_AUTH_TOKEN = "core-base-issuer-auth-token-test-only-0123456789abcdef";
const ENDPOINT = NYRA_DEEP_V2_OPERATIONAL_SIGNER_CONTRACT.endpoint;
const JWKS_ENDPOINT = NYRA_DEEP_V2_OPERATIONAL_SIGNER_CONTRACT.jwks_endpoint;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function opaqueContext(nodeId, index, payloadOverrides = {}) {
  const payload = {
    node_id: nodeId,
    capability_input: { subject: `subject_${index}`, records: [] },
    evidence: [],
    evidence_manifest: { manifest_hash: "a".repeat(64) },
    policy_decisions: [],
    ...payloadOverrides,
  };
  const raw = Buffer.from(nyraDeepV2SignerCanonicalJson(payload), "utf8");
  return {
    schema_version: "nyra_deep_branch_v2_opaque_node_context_v1",
    node_id: nodeId,
    context_id: `opctx_${index}_1234567890abcdef`,
    payload_encoding: "base64url_canonical_json",
    payload_sha256: sha256(raw),
    opaque_payload: raw.toString("base64url"),
  };
}

function unsignedAttestation(overrides = {}) {
  const nodeIds = [
    "context_intelligence.request_normalization.l2",
    "context_intelligence.request_normalization.l3",
    "context_intelligence.request_normalization.method",
    "context_intelligence.request_normalization.strategy",
    "context_intelligence.request_normalization.verifier",
    "context_intelligence.request_normalization.metric",
  ];
  const types = ["specialized_capability", "micro_capability", "method", "strategy", "verifier", "metric"];
  const lineage = nodeIds.map((nodeId, index) => ({
    node_id: nodeId,
    parent_id: index === 0
      ? "context_intelligence.request_normalization"
      : index === 1 ? nodeIds[0] : nodeIds[1],
    level: index === 0 ? 2 : index === 1 ? 3 : 4,
    node_type: types[index],
    function_binding_hash: String(index + 1).repeat(64),
    semantic_function_hash: String(index + 2).repeat(64),
  }));
  return {
    schema_version: "nyra_deep_branch_v2_operational_attestation_v1",
    issuer: "skinharmony-universal-core",
    audience: "skinharmony-nyra-core",
    key_id: "universal-core-nyra-v2",
    tenant_id: "codexai",
    request_id: "mcpv2_1234567890abcdef1234567890abcdef",
    domain_pack: "skinharmony",
    catalog_scope: "skinharmony",
    entitlement_domain_pack: "skinharmony",
    branch_id: "context_intelligence",
    subbranch_id: "request_normalization",
    preflight_id: "preflight_operational_signing_20260805",
    core_policy_hash: "a".repeat(64),
    envelope_binding_hash: "b".repeat(64),
    catalog_fingerprint: "c".repeat(64),
    root_binding_hash: "d".repeat(64),
    function_registry_hash: "e".repeat(64),
    package_hash: "f".repeat(64),
    lineage,
    node_contexts: nodeIds.map((nodeId, index) => opaqueContext(nodeId, index)),
    nonce: "1".repeat(64),
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 30_000).toISOString(),
    observed_at: NOW - 1_000,
    ...overrides,
  };
}

function signingRequest(overrides = {}) {
  return {
    schema_version: "nyra_deep_branch_v2_sign_request_v1",
    purpose: "nyra_deep_branch_v2_operational_attestation",
    target_commit: TARGET_COMMIT,
    attestation: unsignedAttestation(),
    ...overrides,
  };
}

function durableReplayStore({ fail = false } = {}) {
  const claims = new Set();
  const inputs = [];
  return {
    durable: true,
    inputs,
    async claim(input) {
      inputs.push(input);
      if (fail) throw new Error("private-provider-detail-never-log");
      const key = `${input.mode}:${input.nonce}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
  };
}

function createRuntime(options = {}) {
  const logs = [];
  const replayStore = options.replayStore || durableReplayStore();
  const runtime = createNyraDeepV2OperationalSignerRuntime({
    mode: "core",
    environment: "staging",
    startupMode: "full",
    signingSecret: SIGNING_SECRET,
    authToken: AUTH_TOKEN,
    replayStore,
    targetCommit: options.targetCommit || TARGET_COMMIT,
    bodyLimit: options.bodyLimit,
    now: () => NOW,
    logger: (event) => logs.push(event),
  });
  return { runtime, replayStore, logs };
}

function anchorEnv(prefix, publicKey) {
  const exported = publicKey.export({ format: "jwk" });
  const kid = `ed25519-sha256:${crypto.createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
  const jwk = { alg: "EdDSA", crv: "Ed25519", kid, kty: "OKP", use: "sig", x: exported.x };
  return {
    [`${prefix}_PUBLIC_JWK`]: JSON.stringify(jwk),
    [`${prefix}_KID`]: kid,
  };
}

function serviceEnv(signerOverrides = {}) {
  const receipt = crypto.generateKeyPairSync("ed25519");
  const owner = crypto.generateKeyPairSync("ed25519");
  const nyra = crypto.generateKeyPairSync("ed25519");
  return {
    MCP_STAGING_ENVIRONMENT: "staging",
    MCP_STAGING_ISSUER_MODE: "core",
    MCP_STAGING_ISSUER_SIGNING_SECRET: "core-base-issuer-secret-test-only-0123456789abcdef",
    MCP_STAGING_ISSUER_AUTH_TOKEN: BASE_AUTH_TOKEN,
    MCP_STAGING_NYRA_DEEP_V2_SIGNING_SECRET: SIGNING_SECRET,
    MCP_STAGING_NYRA_DEEP_V2_SIGNING_TOKEN: AUTH_TOKEN,
    ...anchorEnv("MCP_STAGING_RECEIPT_AUTHORITY", receipt.publicKey),
    ...anchorEnv("MCP_STAGING_OWNER_AUTHORITY", owner.publicKey),
    ...anchorEnv("MCP_STAGING_NYRA_AUTHORITY", nyra.publicKey),
    ...signerOverrides,
  };
}

function invoke(runtime, {
  method = "POST",
  path = ENDPOINT,
  body = signingRequest(),
  token = AUTH_TOKEN,
  contentType = "application/json",
  rawBody,
  declaredLength,
} = {}) {
  const serialized = rawBody === undefined ? JSON.stringify(body) : rawBody;
  const req = method === "GET"
    ? new Readable({ read() { this.push(null); } })
    : Readable.from([Buffer.from(serialized, "utf8")]);
  req.method = method;
  req.url = path;
  req.headers = {
    ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    ...(method === "GET" ? {} : {
      "content-type": contentType,
      "content-length": String(declaredLength ?? Buffer.byteLength(serialized)),
    }),
  };
  req.socket = { remoteAddress: "127.0.0.1" };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(value = "") {
        try {
          resolve({
            status: this.statusCode,
            headers: this.headers,
            body: value ? JSON.parse(String(value)) : null,
          });
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(runtime.handle(req, res)).catch(reject);
  });
}

test("configuration is core/staging/full, commit-bound and requires a durable atomic replay store", () => {
  const base = {
    mode: "core",
    environment: "staging",
    startupMode: "full",
    signingSecret: SIGNING_SECRET,
    authToken: AUTH_TOKEN,
    replayStore: durableReplayStore(),
    targetCommit: TARGET_COMMIT,
    now: () => NOW,
  };
  for (const invalid of [
    { ...base, mode: "nyra" },
    { ...base, environment: "production" },
    { ...base, startupMode: "jwks_only" },
    { ...base, replayStore: { durable: false, claim() {} } },
  ]) assert.throws(() => createNyraDeepV2OperationalSignerRuntime(invalid));

  const first = createNyraDeepV2OperationalSignerRuntime(base);
  const second = createNyraDeepV2OperationalSignerRuntime({ ...base, targetCommit: OTHER_COMMIT });
  assert.notEqual(first.jwk.x, second.jwk.x, "derived public key must be commit-bound");
  assert.equal(NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES, 393_216);
  assert.equal(NYRA_DEEP_V2_OPERATIONAL_SIGNER_CONTRACT.maximum_wire_bytes, 393_216);
  assert.throws(() => createNyraDeepV2OperationalSignerRuntime({
    ...base,
    bodyLimit: NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES + 1,
  }), /nyra_deep_v2_signer_body_limit_invalid/);
});

test("the separate JWKS exposes only the fixed public Ed25519 key", async () => {
  const { runtime } = createRuntime();
  const response = await invoke(runtime, { method: "GET", path: JWKS_ENDPOINT, token: null });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["keys"]);
  assert.deepEqual(Object.keys(response.body.keys[0]).sort(), ["alg", "crv", "kid", "kty", "use", "x"]);
  assert.equal(response.body.keys[0].kid, "universal-core-nyra-v2");
  assert.equal("d" in response.body.keys[0], false);
  assert.equal(JSON.stringify(response).includes(SIGNING_SECRET), false);
  assert.equal(JSON.stringify(response).includes(AUTH_TOKEN), false);
});

test("a strict purpose-bound request returns a verifiable Federation-compatible signature", async () => {
  const { runtime, replayStore, logs } = createRuntime();
  assert.equal(validateNyraDeepV2OperationalSigningRequest(signingRequest(), {
    targetCommit: TARGET_COMMIT,
    nowMs: NOW,
  }), true);
  const response = await invoke(runtime);
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "attestation", "key_id", "purpose", "schema_version", "target_commit",
  ]);
  assert.equal(response.body.schema_version, "nyra_deep_branch_v2_sign_response_v1");
  assert.equal(response.body.target_commit, TARGET_COMMIT);
  assert.equal(response.body.key_id, "universal-core-nyra-v2");
  assert.equal(response.body.attestation.tenant_id, "codexai");
  assert.equal(replayStore.inputs.length, 1);
  assert.equal(replayStore.inputs[0].mode, "core");
  assert.match(replayStore.inputs[0].nonce, /^[A-Za-z0-9_-]{32}$/);
  const unsigned = structuredClone(response.body.attestation);
  const signature = unsigned.signature;
  delete unsigned.signature;
  assert.equal(crypto.verify(
    null,
    Buffer.from(`nyra-deep-branch-v2-operational-attestation\u0000${nyraDeepV2SignerCanonicalJson(unsigned)}`, "utf8"),
    runtime.publicKey,
    Buffer.from(signature, "base64url"),
  ), true);
  unsigned.package_hash = "0".repeat(64);
  assert.equal(crypto.verify(
    null,
    Buffer.from(`nyra-deep-branch-v2-operational-attestation\u0000${nyraDeepV2SignerCanonicalJson(unsigned)}`, "utf8"),
    runtime.publicKey,
    Buffer.from(signature, "base64url"),
  ), false);
  assert.deepEqual(logs, [{
    event: "nyra_deep_v2_operational_attestation_signed",
    mode: "core",
    purpose: "nyra_deep_branch_v2_operational_attestation",
    status: 201,
  }]);
});

test("auth failure and invalid content type cannot consume replay state", async () => {
  const { runtime, replayStore, logs } = createRuntime();
  const unauthorized = await invoke(runtime, { token: "wrong-token-never-reflected-0123456789" });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error, "nyra_deep_v2_signer_auth_required");
  const unsupported = await invoke(runtime, { contentType: "text/plain" });
  assert.equal(unsupported.status, 415);
  assert.equal(replayStore.inputs.length, 0);
  assert.equal(JSON.stringify({ unauthorized, logs }).includes("wrong-token-never-reflected"), false);
});

test("atomic durable replay rejects a second signature for the same nonce", async () => {
  const { runtime, replayStore } = createRuntime();
  assert.equal((await invoke(runtime)).status, 201);
  const replay = await invoke(runtime);
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error, "nyra_deep_v2_sign_request_replay");
  assert.equal(replayStore.inputs.length, 2);
  assert.equal(replayStore.inputs[0].nonce, replayStore.inputs[1].nonce);
});

test("tenant, commit, TTL, purpose, signature field and extra keys fail exact validation", async () => {
  const cases = [
    signingRequest({ target_commit: OTHER_COMMIT }),
    signingRequest({ purpose: "arbitrary_signing" }),
    signingRequest({ attestation: unsignedAttestation({ tenant_id: "other-tenant" }) }),
    signingRequest({ attestation: unsignedAttestation({ expires_at: new Date(NOW + 61_000).toISOString() }) }),
    signingRequest({ attestation: unsignedAttestation({ expires_at: new Date(NOW).toISOString() }) }),
    signingRequest({ attestation: { ...unsignedAttestation(), signature: "a".repeat(86) } }),
    { ...signingRequest(), arbitrary: true },
  ];
  for (const body of cases) {
    const { runtime, replayStore } = createRuntime();
    const response = await invoke(runtime, { body });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "nyra_deep_v2_sign_request_invalid");
    assert.equal(replayStore.inputs.length, 0);
  }
});

test("lineage, opaque payload hashes and canonical bytes are bound before signing", async () => {
  const malformedLineage = unsignedAttestation();
  malformedLineage.lineage[2].parent_id = malformedLineage.lineage[0].node_id;
  const tamperedPayload = unsignedAttestation();
  tamperedPayload.node_contexts[0].payload_sha256 = "0".repeat(64);
  const nonCanonicalPayload = unsignedAttestation();
  const decoded = JSON.parse(Buffer.from(nonCanonicalPayload.node_contexts[0].opaque_payload, "base64url").toString("utf8"));
  const raw = Buffer.from(JSON.stringify(decoded, null, 2), "utf8");
  nonCanonicalPayload.node_contexts[0].opaque_payload = raw.toString("base64url");
  nonCanonicalPayload.node_contexts[0].payload_sha256 = sha256(raw);
  for (const attestation of [malformedLineage, tamperedPayload, nonCanonicalPayload]) {
    const { runtime } = createRuntime();
    assert.equal((await invoke(runtime, { body: signingRequest({ attestation }) })).status, 400);
  }
});

test("secret-like opaque content is rejected and never appears in response or logs", async () => {
  const marker = "NEVER_LEAK_TOKEN_1234567890";
  const attestation = unsignedAttestation();
  attestation.node_contexts[0] = opaqueContext(attestation.lineage[0].node_id, 0, {
    capability_input: { bearer_token: marker },
  });
  const { runtime, replayStore, logs } = createRuntime();
  const response = await invoke(runtime, { body: signingRequest({ attestation }) });
  assert.equal(response.status, 400);
  assert.equal(replayStore.inputs.length, 0);
  assert.equal(JSON.stringify({ response, logs }).includes(marker), false);

  const genericTokenMarker = "GENERIC_NESTED_TOKEN_NEVER_LEAK_0123456789";
  const genericTokenAttestation = unsignedAttestation();
  genericTokenAttestation.node_contexts[0] = opaqueContext(
    genericTokenAttestation.lineage[0].node_id,
    0,
    { capability_input: { token: genericTokenMarker } },
  );
  const genericTokenResponse = await invoke(runtime, {
    body: signingRequest({ attestation: genericTokenAttestation }),
  });
  assert.equal(genericTokenResponse.status, 400);
  assert.equal(JSON.stringify({ genericTokenResponse, logs }).includes(genericTokenMarker), false);
});

test("payload limits and replay-store provider failures fail closed without details", async () => {
  const limited = createRuntime({ bodyLimit: 16_384 });
  const tooLarge = await invoke(limited.runtime, { declaredLength: 16_385 });
  assert.equal(tooLarge.status, 413);
  assert.equal(limited.replayStore.inputs.length, 0);

  const unavailable = createRuntime({ replayStore: durableReplayStore({ fail: true }) });
  const failed = await invoke(unavailable.runtime);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error, "nyra_deep_v2_signer_replay_store_unavailable");
  assert.equal(JSON.stringify({ failed, logs: unavailable.logs }).includes("private-provider-detail"), false);
});

test("the raw request wire budget accepts exactly 384 KiB and rejects the next byte", async () => {
  const requestJson = JSON.stringify(signingRequest());
  const requestBytes = Buffer.byteLength(requestJson, "utf8");
  assert.ok(requestBytes < NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES);
  const exactBoundary = `${requestJson}${" ".repeat(
    NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES - requestBytes,
  )}`;
  assert.equal(Buffer.byteLength(exactBoundary, "utf8"), 393_216);

  const accepted = createRuntime();
  const acceptedResponse = await invoke(accepted.runtime, { rawBody: exactBoundary });
  assert.equal(acceptedResponse.status, 201);
  assert.equal(accepted.replayStore.inputs.length, 1);
  assert.ok(Number(acceptedResponse.headers["content-length"]) <= 393_216);

  const rejected = createRuntime();
  const rejectedResponse = await invoke(rejected.runtime, { rawBody: `${exactBoundary} ` });
  assert.equal(rejectedResponse.status, 413);
  assert.equal(rejectedResponse.body.error, "request_body_too_large");
  assert.equal(rejected.replayStore.inputs.length, 0);
});

test("the same wire budget bounds the signed response before replay state is consumed", async () => {
  const attestation = unsignedAttestation();
  attestation.node_contexts = attestation.lineage.map((node, index) => opaqueContext(
    node.node_id,
    index,
    { evidence: ["x".repeat(12_000)] },
  ));
  const body = signingRequest({ attestation });
  const baseline = createRuntime();
  const baselineResponse = await invoke(baseline.runtime, { body });
  assert.equal(baselineResponse.status, 201);
  const responseBytes = Buffer.byteLength(JSON.stringify(baselineResponse.body), "utf8");
  const requestBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  assert.ok(responseBytes >= 16_384);
  assert.ok(requestBytes < responseBytes);
  assert.ok(responseBytes < NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES);

  const accepted = createRuntime({ bodyLimit: responseBytes });
  const acceptedResponse = await invoke(accepted.runtime, { body });
  assert.equal(acceptedResponse.status, 201);
  assert.equal(Number(acceptedResponse.headers["content-length"]), responseBytes);
  assert.equal(accepted.replayStore.inputs.length, 1);

  const rejected = createRuntime({ bodyLimit: responseBytes - 1 });
  const rejectedResponse = await invoke(rejected.runtime, { body });
  assert.equal(rejectedResponse.status, 413);
  assert.equal(rejectedResponse.body.error, "nyra_deep_v2_sign_response_too_large");
  assert.equal(rejected.replayStore.inputs.length, 0);
});

test("the existing Core issuer composes the signer without changing receipt/grant routes or key material", async () => {
  const env = serviceEnv();
  const replayStore = durableReplayStore();
  const runtime = createMcpStagingIssuerServiceRuntime({
    env,
    replayStore,
    targetCommit: TARGET_COMMIT,
    now: () => NOW,
  });
  assert.equal(runtime.mode, "core");
  assert.equal(runtime.endpoint, MCP_STAGING_ISSUER_CONTRACT.endpoints.core);
  assert.equal(runtime.nyraDeepV2OperationalSignerReady, true);
  assert.notEqual(runtime.jwk.x, runtime.nyraDeepV2OperationalSignerJwk.x);
  assert.equal("MCP_STAGING_ISSUER_SIGNING_SECRET" in env, false);
  assert.equal("MCP_STAGING_NYRA_DEEP_V2_SIGNING_SECRET" in env, false);
  assert.equal("MCP_STAGING_NYRA_DEEP_V2_SIGNING_TOKEN" in env, false);

  const baseJwks = await invoke(runtime, { method: "GET", path: "/.well-known/jwks.json", token: null });
  const signerJwks = await invoke(runtime, { method: "GET", path: JWKS_ENDPOINT, token: null });
  assert.equal(baseJwks.status, 200);
  assert.equal(signerJwks.status, 200);
  assert.equal(baseJwks.body.keys[0].kid, runtime.jwk.kid);
  assert.equal(signerJwks.body.keys[0].kid, "universal-core-nyra-v2");

  const existingRoute = await invoke(runtime, {
    path: MCP_STAGING_ISSUER_CONTRACT.endpoints.core,
    token: BASE_AUTH_TOKEN,
  });
  assert.equal(existingRoute.status, 400);
  assert.equal(existingRoute.body.error, "issuer_request_invalid");
  const signed = await invoke(runtime);
  assert.equal(signed.status, 201);
});

test("partial remote-signer configuration fails closed and scrubs both dedicated variables", () => {
  const env = serviceEnv({ MCP_STAGING_NYRA_DEEP_V2_SIGNING_TOKEN: undefined });
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env,
      replayStore: durableReplayStore(),
      targetCommit: TARGET_COMMIT,
      now: () => NOW,
    }),
    /nyra_deep_v2_signer_config_incomplete/,
  );
  assert.equal("MCP_STAGING_NYRA_DEEP_V2_SIGNING_SECRET" in env, false);
  assert.equal("MCP_STAGING_NYRA_DEEP_V2_SIGNING_TOKEN" in env, false);
});
