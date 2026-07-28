import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";

test("active generic run applies only server-verified early stop evidence", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "agentic-early-stop-admin";
  const capsuleWrites = [];
  let persistedCapsule = null;
  const agenticEfficiencyStore = {
    async initialize() { return { initialized: true }; },
    readiness() {
      return {
        persistence_read_ready: true,
        persistence_write_ready: true,
        runtime_role_attested: true,
      };
    },
    async saveWorkCapsule(input) {
      capsuleWrites.push(input);
      if (!persistedCapsule) {
        persistedCapsule = {
          capsule_id: input.capsule_id,
          tenant_id: input.tenant_id,
          version: 1,
          capsule_hash: "sha256:expired",
          capsule: {
            ...input.capsule,
            created_at: "2026-07-27T00:00:00.000Z",
            expires_at: "2026-07-27T00:01:00.000Z",
          },
          actor_provenance: input.actor_provenance,
          receipt_digest: input.receipt_digest,
        };
        throw new Error("work_capsule_revision_conflict");
      }
      assert.equal(input.expected_version, 1);
      persistedCapsule = {
        ...persistedCapsule,
        version: 2,
        capsule_hash: "sha256:refreshed",
        capsule: input.capsule,
        receipt_digest: input.receipt_digest,
      };
      return persistedCapsule;
    },
    async getWorkCapsule(input) {
      assert.equal(input.allow_expired, true);
      return persistedCapsule;
    },
    async claimWork({ claimant_id }) {
      return { ...persistedCapsule, lease_owner: claimant_id };
    },
    async releaseClaim() { return { released: true }; },
    async checkArtifactReuse() { return { reusable: false, reasons: ["not_registered"] }; },
    async status() { return { available: true }; },
    async report() { return { available: true }; },
  };
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `agentic-early-stop-${Date.now()}-${Math.random()}`),
    agenticEfficiencyMode: "active",
    agenticEfficiencyStore,
    verifyAgenticAcceptanceEvidence: async () => ({
      receiptDigest: `sha256:${"a".repeat(64)}`,
      acceptanceVerified: true,
      testsVerified: true,
      evidenceVerified: true,
      securityTestsVerified: true,
      humanReviewVerified: true,
    }),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() };
  };
  try {
    const generated = await request("POST", "/v1/keys/generate", {
      tenant_id: "tenant-agentic-early-stop",
      preset: "codex_automation",
    }, "agentic-early-stop-admin");
    assert.equal(generated.status, 201);
    const key = generated.payload.key;
    const completed = await request("POST", "/v1/generic-agents/runs", {
      agent_id: "early-stop-agent",
      task: "Verify an already completed bounded task",
      success_criteria: ["tests-green"],
      completed: ["tests-green"],
      test_state: { passed: 1, failed: 0, pending: 0 },
      acceptance_evidence: ["verified-test-report"],
      security_tests_required: true,
      security_tests_passed: true,
      critical: true,
    }, key);
    assert.equal(completed.status, 200);
    assert.equal(completed.payload.run, null);
    assert.equal(completed.payload.agentic_efficiency.early_stopped, true);
    assert.equal(completed.payload.agentic_efficiency.plan.plan.early_stop.allowed, true);

    const pending = await request("POST", "/v1/generic-agents/runs", {
      agent_id: "continue-agent",
      task: "Continue an incomplete bounded task",
      success_criteria: ["tests-green"],
      completed: [],
      test_state: { passed: 0, failed: 0, pending: 1 },
      acceptance_evidence: ["partial-report"],
      security_tests_required: true,
      security_tests_passed: true,
    }, key);
    assert.equal(pending.status, 201);
    assert(pending.payload.run?.run_id);
    assert.equal(pending.payload.run.metadata.agentic_control.early_stop.allowed, false);
    assert.equal(capsuleWrites.length, 2);
    assert.equal(capsuleWrites[0].expected_version, 0);
    assert.equal(capsuleWrites[1].expected_version, 1);
    assert(Date.parse(capsuleWrites[1].capsule.expires_at) > Date.now());
    assert.equal(
      pending.payload.run.metadata.agentic_efficiency_shadow.persistence.capsule_version,
      2,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
