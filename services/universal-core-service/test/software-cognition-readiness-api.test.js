import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";

async function withEnv(values, run) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withService(options, run) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "software-cognition-readiness-"));
  const { app } = createUniversalCoreService({ storageRoot, ...options });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = async (pathname) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`);
    return { status: response.status, json: await response.json() };
  };
  try {
    await run(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

async function waitForSoftwareState(request, expected) {
  let response;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    response = await request("/healthz");
    if (response.json.software_cognition.state === expected) return response;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return response;
}

function softwareOptions(mode, initialize) {
  return {
    softwareCognitionMode: mode,
    softwareCognitionStore: {},
    softwareCognitionRuntime: { initialize, invoke: async () => ({}) },
  };
}

for (const failure of [
  {
    label: "throws",
    initialize: async () => { throw new Error("synthetic_software_initialization_failure"); },
    error: "software_cognition_initialization_failed",
  },
  {
    label: "returns a non-ready result",
    initialize: async () => ({ ready: false }),
    error: "software_cognition_initialization_not_ready",
  },
]) {
  test(`ENFORCED health and readiness fail closed when Software Cognition ${failure.label}`, async () => {
    await withService(softwareOptions("ENFORCED", failure.initialize), async (request) => {
      const health = await waitForSoftwareState(request, "initialization_failed");
      const readiness = await request("/readyz");
      assert.equal(health.status, 503);
      assert.equal(health.json.render_ready, false);
      assert.equal(health.json.readiness, false);
      assert.equal(health.json.software_cognition.ready, false);
      assert.equal(health.json.software_cognition.readiness_required, true);
      assert.equal(health.json.software_cognition.readiness_ready, false);
      assert.equal(health.json.software_cognition.error, failure.error);
      assert.equal(readiness.status, 503);
      assert.equal(readiness.json.render_ready, false);
      assert.equal(readiness.json.software_cognition.readiness_ready, false);
    });
  });
}

test("Software Cognition health never exposes a raw initialization error or DSN", async () => {
  await withService(softwareOptions("ENFORCED", async () => {
    throw new Error("postgres://user:LEAK_ME@db.internal/cognition");
  }), async (request) => {
    const health = await waitForSoftwareState(request, "initialization_failed");
    const readiness = await request("/readyz");
    assert.equal(health.status, 503);
    assert.equal(health.json.software_cognition.error,
      "software_cognition_initialization_failed");
    assert.equal(readiness.json.software_cognition.error,
      "software_cognition_initialization_failed");
    assert.doesNotMatch(JSON.stringify(health.json), /LEAK_ME|db\.internal|postgres:\/\//u);
    assert.doesNotMatch(JSON.stringify(readiness.json), /LEAK_ME|db\.internal|postgres:\/\//u);
  });
});

test("ADVISORY Software Cognition failure remains observable without gating global readiness", async () => {
  await withService(softwareOptions("ADVISORY", async () => {
    throw new Error("synthetic_advisory_initialization_failure");
  }), async (request) => {
    const health = await waitForSoftwareState(request, "initialization_failed");
    const readiness = await request("/readyz");
    assert.equal(health.status, 200);
    assert.equal(health.json.render_ready, true);
    assert.equal(health.json.software_cognition.ready, false);
    assert.equal(health.json.software_cognition.readiness_required, false);
    assert.equal(health.json.software_cognition.readiness_ready, true);
    assert.equal(readiness.status, 200);
    assert.equal(readiness.json.render_ready, true);
  });
});

test("pre-Core advisory initialization performs one bounded signer probe and projects its public status", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  let probeCalls = 0;
  let storeInitializationCalls = 0;
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const publicKeyFingerprint = crypto.createHash("sha256")
    .update(keys.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const signerFetch = async (_url, options) => {
    probeCalls += 1;
    const request = JSON.parse(options.body);
    assert.equal(request.purpose, "nyra.precore.decision.v1");
    const payload = Buffer.from(request.payload, "base64url");
    return new Response(JSON.stringify({
      schema_version: "nyra_policy_registry_sign_response_v1",
      service: request.service,
      target_commit: request.target_commit,
      purpose: request.purpose,
      key_id: request.key_id,
      digest: request.digest,
      signature_algorithm: "ed25519",
      signature: crypto.sign(null, payload, keys.privateKey).toString("base64url"),
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const pool = {
    async query() { return { rows: [] }; },
    async connect() { return { query: this.query.bind(this), release() {} }; },
  };
  const policyStore = {
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    async status() {
      return { configured: true, backend: "postgresql", restart_durable: true,
        distributed: true, state: "ready", ready: true };
    },
  };
  await withEnv({
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_ORIGIN: "https://nyra-precore-signer.example",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_PATH: "/v1/policy-registry/nyra/sign",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_SERVICE: "nyra-policy-registry-signer",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_TARGET_COMMIT: "b".repeat(40),
    CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-precore-test-key",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_SERVICE_TOKEN: "precore-service-token-at-least-32-bytes",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_ED25519_PUBLIC_KEY: publicKey,
  }, () => withService({
    ...softwareOptions("ADVISORY", async () => ({ ready: true })),
    nyraPolicyRegistryPostgresPool: pool,
    nyraPolicyRegistryStore: policyStore,
    causalContinuityStore: {},
    causalContinuityRuntime: {
      async initialize() { return { ready: true }; },
      async health() { return { ok: true }; },
      async invoke() { return {}; },
    },
    nyraPrecoreDecisionMode: "ADVISORY",
    nyraPrecoreDecisionSignerFetch: signerFetch,
    nyraPrecoreDecisionStore: {
      verification_key_count: 1,
      async initialize() { storeInitializationCalls += 1; return {}; },
    },
  }, async (request) => {
    const health = await waitForSoftwareState(request, "ready");
    const precore = health.json.software_cognition.nyra_precore_decision;
    assert.equal(health.status, 200);
    assert.equal(health.json.render_ready, true);
    assert.equal(probeCalls, 1);
    assert.equal(storeInitializationCalls, 1);
    assert.equal(precore.state, "ready");
    assert.equal(precore.ready, true);
    assert.equal(precore.signer_state, "ready");
    assert.equal(precore.signer_probe_purpose, "nyra.precore.decision.v1");
    assert.equal(precore.signer_probe_attempts, 1);
    assert.equal(precore.signer_key_id, "nyra-precore-test-key");
    assert.equal(precore.signer_public_key_fingerprint, publicKeyFingerprint);
    assert.equal(precore.signer_target_commit, "b".repeat(40));
  }));

  await withEnv({
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_ORIGIN: "https://nyra-precore-signer.example",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_PATH: "/v1/policy-registry/nyra/sign",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_SERVICE: "nyra-policy-registry-signer",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_TARGET_COMMIT: "b".repeat(40),
    CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-precore-test-key",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_SERVICE_TOKEN: "precore-service-token-at-least-32-bytes",
    CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_ED25519_PUBLIC_KEY: publicKey,
  }, () => withService({
    ...softwareOptions("ADVISORY", async () => ({ ready: true })),
    nyraPolicyRegistryPostgresPool: pool,
    nyraPolicyRegistryStore: policyStore,
    causalContinuityStore: {},
    causalContinuityRuntime: {
      async initialize() { return { ready: true }; },
      async health() { return { ok: true }; },
      async invoke() { return {}; },
    },
    nyraPrecoreDecisionMode: "ADVISORY",
    nyraPrecoreDecisionSignerFetch: signerFetch,
    nyraPrecoreDecisionStore: {
      verification_key_count: 1,
      async initialize() {
        throw new Error("postgres://user:PRECORE_LEAK@db.internal/precore");
      },
    },
  }, async (request) => {
    const health = await waitForSoftwareState(request, "ready");
    const readiness = await request("/readyz");
    const precore = health.json.software_cognition.nyra_precore_decision;
    assert.equal(precore.state, "initialization_failed");
    assert.equal(precore.error, "nyra_precore_initialization_failed");
    assert.equal(readiness.json.software_cognition.nyra_precore_decision.error,
      "nyra_precore_initialization_failed");
    assert.doesNotMatch(JSON.stringify(health.json), /PRECORE_LEAK|db\.internal|postgres:\/\//u);
    assert.doesNotMatch(JSON.stringify(readiness.json), /PRECORE_LEAK|db\.internal|postgres:\/\//u);
  }));
});
