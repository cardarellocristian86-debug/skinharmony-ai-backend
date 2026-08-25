import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";
import { createIcfPostgresStore } from "../src/icfPostgresStore.js";

async function waitForEntity360(base) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${base}/healthz`);
    const body = await response.json();
    if (body.entity_360?.state === "ready") return { response, body };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("entity360_app_initialization_timeout");
}

test("Universal Core exposes Entity 360 SHADOW health without making it a production authority gate", async () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "entity360-app-"));
  let initialized = 0;
  let runtimeHealthy = true;
  const entity360Runtime = {
    async initialize() { initialized += 1; },
    async health() {
      return { schema_version: "entity_360_health_v1", ok: runtimeHealthy, ready: runtimeHealthy,
        state: runtimeHealthy ? "ready" : "store_verification_failed",
        ...(runtimeHealthy ? {} : { operational_error: "entity360_store_verification_failed" }),
        mode: "SHADOW", backend: "test_postgresql", migration: { checkpoint: "READBACK_VERIFIED" },
        shadow_non_mutating: true, execution_authorized: false };
    },
    async invoke() { return { execution_authorized: false }; },
  };
  const { app } = createUniversalCoreService({ storageRoot, entity360Mode: "SHADOW", entity360Runtime });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { body } = await waitForEntity360(base);
    assert.equal(initialized, 1);
    assert.equal(body.entity_360.configured, true);
    assert.equal(body.entity_360.ready, true);
    assert.equal(body.entity_360.mode, "SHADOW");
    assert.equal(body.entity_360.production_required, false);
    assert.equal(body.entity_360.global_readiness_gate, false);
    assert.equal(body.entity_360.current_path_authoritative, true);
    assert.equal(body.entity_360.production_decision_mutation, false);
    assert.equal(body.entity_360.execution_authorized, false);
    runtimeHealthy = false;
    const driftResponse = await fetch(`${base}/healthz`);
    const drift = await driftResponse.json();
    assert.equal(drift.entity_360.ready, false);
    assert.equal(drift.entity_360.state, "store_verification_failed");
    assert.equal(drift.entity_360.bootstrap_state, "ready");
    assert.equal(drift.entity_360.operational_error, "entity360_store_verification_failed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("Universal Core rejects malformed retained Entity 360 verification keyrings before merge", async () => {
  for (const [label, retainedInput] of [
    ["array", JSON.stringify(["b".repeat(64)])],
    ["primitive", "7"],
  ]) {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), `entity360-keyring-${label}-`));
    const { app } = createUniversalCoreService({
      storageRoot,
      entity360Mode: "SHADOW",
      hostNativeSigningSecret: "a".repeat(64),
      entity360QualificationVerificationKeys: retainedInput,
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.entity_360.state, "signer_unavailable", label);
      assert.equal(body.entity_360.ready, false, label);
      assert.equal(body.entity_360.initialization_error,
        "entity360_verification_keyring_invalid", label);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  }
});

test("ICF v2 startup DDL failure latches store failure and keeps Entity 360 non-ready", async () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "entity360-icf-failure-"));
  let runtimeInitializations = 0;
  let released = false;
  const startupError = Object.assign(new Error("startup DDL denied"), { code: "42501" });
  const client = {
    async query() { throw startupError; },
    release() { released = true; },
  };
  const icfStore = createIcfPostgresStore({
    pool: {
      async query() { throw startupError; },
      async connect() { return client; },
    },
  });
  await assert.rejects(() => icfStore.initialize(), /startup DDL denied/u);
  assert.deepEqual(icfStore.health(), {
    schema_version: "icf_postgres_store_health_v1",
    ok: false,
    ready: false,
    initialized: false,
    state: "failed",
    reason: "migration_unavailable",
    error: "42501",
    backend: "postgresql",
    restart_durable: true,
    distributed: true,
    migration: null,
  });
  assert.equal(released, true);

  const entity360Runtime = {
    async initialize() { runtimeInitializations += 1; },
    async health() { return { ok: true, ready: true, state: "ready" }; },
    async invoke() { return { execution_authorized: false }; },
  };
  const { app } = createUniversalCoreService({
    storageRoot,
    entity360Mode: "SHADOW",
    entity360Runtime,
    icfStore,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const body = await response.json();
    assert.equal(runtimeInitializations, 0);
    assert.equal(body.entity_360.ready, false);
    assert.equal(body.entity_360.state, "upstream_dependency_unavailable");
    assert.equal(body.entity_360.initialization_error,
      "icf_event_digest_v2_migration_unavailable");
    assert.deepEqual(body.entity_360.icf_event_digest_v2_dependency, {
      schema_version: "entity_360_icf_event_digest_dependency_v1",
      required: true,
      ready: false,
      state: "migration_failed",
      migration_id: null,
      application_state: null,
      checkpoint: null,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});
