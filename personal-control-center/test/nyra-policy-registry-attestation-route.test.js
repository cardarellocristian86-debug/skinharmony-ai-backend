"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { SCHEMA_VERSION, payloadBytes } = require("../lib/nyra-policy-registry-attestation");
const repoRoot = path.resolve(__dirname, "../..");
let runtimeAvailable = true;
try { require.resolve("express", { paths: [repoRoot] }); } catch { runtimeAvailable = false; }

test("Nyra server binds the exact Policy Registry path to dedicated auth and health", () => {
  const source = fs.readFileSync(path.join(repoRoot, "personal-control-center/server.js"), "utf8");
  assert.match(source, /NYRA_POLICY_REGISTRY_ATTESTATION_PATH = "\/api\/nyra\/policy-registry\/attestations"/);
  assert.match(source, /x-nyra-policy-registry-service-key/);
  assert.match(source, /NYRA_POLICY_REGISTRY_CORE_SERVICE_KEY/);
  assert.match(source, /policy_registry_attestation: policyRegistryAttestation/);
  assert.doesNotMatch(source, /NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET[^\n]*policy_registry/i);
});

async function waitForHealth(origin, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`nyra_server_exited:${child.exitCode}:${child.stderrText || ""}`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return response.json();
    } catch { /* startup race */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("nyra_server_start_timeout");
}

test("dedicated Nyra S2S route authenticates, signs and reports readiness", {
  skip: runtimeAvailable ? false : "runtime dependencies not installed in worktree",
}, async () => {
  const core = crypto.generateKeyPairSync("ed25519");
  const nyra = crypto.generateKeyPairSync("ed25519");
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-policy-route-"));
  const port = 35000 + Math.floor(Math.random() * 2000);
  const serviceKey = crypto.randomBytes(32).toString("base64url");
  const child = spawn(process.execPath, ["personal-control-center/server.js"], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env, NODE_ENV: "test", PORT: String(port), HOST: "127.0.0.1",
      NYRA_ALLOW_UNAUTHENTICATED: "false", NYRA_DISABLE_BASIC_AUTH: "true",
      NYRA_API_KEY: "", NYRA_API_KEYS: "", NYRA_STORAGE_ROOT: storage,
      NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED: "false",
      NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "true",
      NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST: "codexai",
      NYRA_POLICY_REGISTRY_CORE_SERVICE_KEY: serviceKey,
      NYRA_POLICY_REGISTRY_CORE_KEY_ID: "universal-core-policy-registry-v1",
      NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-policy-registry-v1",
      NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY: core.publicKey.export({ type: "spki", format: "pem" }),
      NYRA_POLICY_REGISTRY_NYRA_PRIVATE_KEY: nyra.privateKey.export({ type: "pkcs8", format: "pem" }),
      NYRA_POLICY_REGISTRY_REPLAY_STORE_PATH: path.join(storage, "policy-replay.json"),
      NYRA_WORLD_PAPER_AUTOSTART: "false",
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; child.stderrText = stderr; });
  const origin = `http://127.0.0.1:${port}`;
  try {
    const health = await waitForHealth(origin, child);
    assert.equal(health.policy_registry_attestation.ready, true);
    assert.equal(health.policy_registry_attestation.algorithm, "Ed25519");
    const now = Date.now();
    const envelope = {
      schema_version: SCHEMA_VERSION, tenant_id: "codexai", work_id: "work-route-1234",
      preflight_id: "preflight-route-1234", intent_digest: "a".repeat(64),
      operation_id: "operation-route-1234", action: "policy.snapshot.activate",
      snapshot_digest: "b".repeat(64), domain_pack_id: "generic-policy",
      nonce: crypto.randomBytes(24).toString("base64url"),
      issued_at: new Date(now - 1_000).toISOString(), expires_at: new Date(now + 60_000).toISOString(),
      core_key_id: "universal-core-policy-registry-v1", nyra_key_id: "nyra-policy-registry-v1",
    };
    const body = JSON.stringify({ envelope,
      core_signature: crypto.sign(null, payloadBytes(envelope), core.privateKey).toString("base64url") });
    const denied = await fetch(`${origin}/api/nyra/policy-registry/attestations`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error, "nyra_policy_registry_auth_required");
    const invoke = () => fetch(`${origin}/api/nyra/policy-registry/attestations`, {
      method: "POST", headers: { "content-type": "application/json",
        "x-nyra-policy-registry-service-key": serviceKey }, body,
    });
    const response = await invoke();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(crypto.verify(null, payloadBytes(envelope), nyra.publicKey,
      Buffer.from(result.attestation.nyra_signature, "base64url")), true);
    const replay = await invoke();
    assert.equal((await replay.json()).attestation.idempotent_replay, true);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
  }
  assert.equal(stderr, "");
});
