import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";

const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
process.env.CORE_SERVICE_ADMIN_KEY = "v016-rollback-join-admin";
test.after(() => {
  if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
  else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
});

async function listen(options) {
  const { app } = createUniversalCoreService(options);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
  };
}

async function request(base, method, pathname, body, key = "v016-rollback-join-admin") {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
}

async function tenantKey(base, tenantId) {
  const generated = await request(base, "POST", "/v1/keys/generate", {
    tenant_id: tenantId,
    preset: "codex_automation",
  });
  assert.equal(generated.status, 201);
  return generated.payload.key;
}

async function completeSingleWorkerPlan(base, key, runId) {
  const orchestration = await request(
    base,
    "POST",
    `/v1/generic-agents/runs/${runId}/orchestration`,
    {
      workers: [{
        worker_id: "worker",
        agent_id: "bounded-worker",
        task: "Produce bounded evidence",
      }],
    },
    key,
  );
  assert.equal(orchestration.status, 201);
  const planId = orchestration.payload.plan.plan_id;
  assert.equal(
    (await request(
      base,
      "POST",
      `/v1/generic-agents/orchestration/${planId}/claim`,
      {},
      key,
    )).status,
    200,
  );
  assert.equal(
    (await request(
      base,
      "POST",
      `/v1/generic-agents/orchestration/${planId}/workers/worker/complete`,
      { result: { evidence_digest: `sha256:${"a".repeat(64)}` } },
      key,
    )).status,
    200,
  );
  return planId;
}

test("off flags are true rollback switches even when v0.16 persistence is required", async () => {
  let storeCalls = 0;
  let telemetryCalls = 0;
  const service = await listen({
    storageRoot: path.join(os.tmpdir(), `v016-off-${Date.now()}-${Math.random()}`),
    v016PersistenceRequired: true,
    aiLearningFactoryMode: "off",
    agenticEfficiencyMode: "off",
    agenticEfficiencyStore: {
      async saveRunBudget() { storeCalls += 1; throw new Error("must_not_run"); },
      async saveWorkCapsule() { storeCalls += 1; throw new Error("must_not_run"); },
      async releaseClaim() { storeCalls += 1; throw new Error("must_not_run"); },
    },
    aiRuntimeTelemetryProducer: {
      async recordGenericRunCompletion() {
        telemetryCalls += 1;
        throw new Error("must_not_run");
      },
    },
  });
  try {
    const key = await tenantKey(service.base, "tenant-v016-off");
    const started = await request(service.base, "POST", "/v1/generic-agents/runs", {
      run_id: "run-v016-off",
      agent_id: "legacy-agent",
      task: "Run through the legacy bounded path",
    }, key);
    assert.equal(started.status, 201);
    assert.equal(
      Object.hasOwn(started.payload.run.metadata || {}, "agentic_efficiency_shadow"),
      false,
    );
    const planId = await completeSingleWorkerPlan(
      service.base,
      key,
      started.payload.run.run_id,
    );
    const joined = await request(
      service.base,
      "POST",
      `/v1/generic-agents/orchestration/${planId}/join`,
      {},
      key,
    );
    assert.equal(joined.status, 200);
    assert.equal(storeCalls, 0);
    assert.equal(telemetryCalls, 0);
  } finally {
    await new Promise((resolve) => service.server.close(resolve));
  }
});

test("shadow mode durably records the run budget and digest-only work capsule", async () => {
  const budgetWrites = [];
  const capsuleWrites = [];
  const service = await listen({
    storageRoot: path.join(os.tmpdir(), `v016-shadow-${Date.now()}-${Math.random()}`),
    v016PersistenceRequired: true,
    aiLearningFactoryMode: "off",
    agenticEfficiencyMode: "shadow",
    agenticBudgetMode: "observe",
    agenticEfficiencyStore: {
      async status() { return { available: true }; },
      async saveRunBudget(input) {
        budgetWrites.push(structuredClone(input));
        return {
          run_id: input.run_id,
          policy_version: input.policy_version,
          policy_expires_at: input.policy_expires_at,
        };
      },
      async saveWorkCapsule(input) {
        capsuleWrites.push(structuredClone(input));
        return {
          capsule_id: input.capsule_id,
          capsule_hash: `sha256:${"b".repeat(64)}`,
          version: 1,
          capsule: input.capsule,
          receipt_digest: input.receipt_digest,
        };
      },
    },
  });
  try {
    const key = await tenantKey(service.base, "tenant-v016-shadow");
    const started = await request(service.base, "POST", "/v1/generic-agents/runs", {
      run_id: "run-v016-shadow",
      agent_id: "shadow-agent",
      task: "Plan a bounded shadow run",
      success_criteria: ["produce evidence"],
    }, key);
    assert.equal(started.status, 201);
    assert.equal(budgetWrites.length, 1);
    assert.equal(capsuleWrites.length, 1);
    assert.equal(
      started.payload.run.metadata.agentic_efficiency_shadow.budget_persistence.persisted,
      true,
    );
    assert.equal(
      started.payload.run.metadata.agentic_efficiency_shadow.persistence.observation_only,
      true,
    );
    assert.match(capsuleWrites[0].capsule.goal, /^goal_digest:sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(capsuleWrites[0]).includes("Plan a bounded shadow run"), false);
  } finally {
    await new Promise((resolve) => service.server.close(resolve));
  }
});

test("required budget persistence failure blocks before a run is created", async () => {
  const service = await listen({
    storageRoot: path.join(os.tmpdir(), `v016-budget-fail-${Date.now()}-${Math.random()}`),
    v016PersistenceRequired: true,
    aiLearningFactoryMode: "off",
    agenticEfficiencyMode: "shadow",
    agenticEfficiencyStore: {
      async status() { return { available: false }; },
      async saveRunBudget() {
        throw new Error("budget_adapter_unavailable");
      },
    },
  });
  try {
    const key = await tenantKey(service.base, "tenant-v016-budget-fail");
    const started = await request(service.base, "POST", "/v1/generic-agents/runs", {
      run_id: "run-v016-must-not-exist",
      agent_id: "bounded-agent",
      task: "Do not start without a durable budget",
    }, key);
    assert.equal(started.status, 400);
    assert.equal(started.payload.error, "budget_adapter_unavailable");
    const fetched = await request(
      service.base,
      "GET",
      "/v1/generic-agents/runs/run-v016-must-not-exist",
      undefined,
      key,
    );
    assert.equal(fetched.status, 404);
  } finally {
    await new Promise((resolve) => service.server.close(resolve));
  }
});

test("failed telemetry persistence can retry the same completed Core join", async () => {
  let telemetryCalls = 0;
  let durableWrites = 0;
  const service = await listen({
    storageRoot: path.join(os.tmpdir(), `v016-join-retry-${Date.now()}-${Math.random()}`),
    v016PersistenceRequired: true,
    aiLearningFactoryMode: "shadow",
    agenticEfficiencyMode: "off",
    aiRuntimeTelemetryProducer: {
      async recordGenericRunCompletion() {
        telemetryCalls += 1;
        if (telemetryCalls === 1) throw new Error("transient_telemetry_failure");
        durableWrites += 1;
        return {
          telemetry_digest: `sha256:${"c".repeat(64)}`,
          usage_kind: "unavailable",
          provider_usage_verified: false,
        };
      },
    },
  });
  try {
    const key = await tenantKey(service.base, "tenant-v016-join-retry");
    const started = await request(service.base, "POST", "/v1/generic-agents/runs", {
      run_id: "run-v016-join-retry",
      agent_id: "bounded-agent",
      task: "Retry the Core join telemetry write",
    }, key);
    const planId = await completeSingleWorkerPlan(
      service.base,
      key,
      started.payload.run.run_id,
    );
    const first = await request(
      service.base,
      "POST",
      `/v1/generic-agents/orchestration/${planId}/join`,
      {},
      key,
    );
    assert.equal(first.status, 400);
    assert.equal(first.payload.error, "ai_runtime_telemetry_persistence_required");
    const second = await request(
      service.base,
      "POST",
      `/v1/generic-agents/orchestration/${planId}/join`,
      {},
      key,
    );
    assert.equal(second.status, 200);
    assert.equal(telemetryCalls, 2);
    assert.equal(durableWrites, 1);
  } finally {
    await new Promise((resolve) => service.server.close(resolve));
  }
});

test("Core join restores the run checkpoint after restart before telemetry", async () => {
  const storageRoot = path.join(
    os.tmpdir(),
    `v016-join-restart-${Date.now()}-${Math.random()}`,
  );
  let first = null;
  let second = null;
  let telemetryInput = null;
  try {
    first = await listen({
      storageRoot,
      v016PersistenceRequired: true,
      aiLearningFactoryMode: "shadow",
      agenticEfficiencyMode: "off",
      aiRuntimeTelemetryProducer: {
        async recordGenericRunCompletion() {
          throw new Error("must_not_join_before_restart");
        },
      },
    });
    const key = await tenantKey(first.base, "tenant-v016-join-restart");
    const started = await request(first.base, "POST", "/v1/generic-agents/runs", {
      run_id: "run-v016-join-restart",
      agent_id: "bounded-agent",
      task: "Restore this run before Core join",
    }, key);
    const checkpointed = await request(
      first.base,
      "POST",
      `/v1/generic-agents/runs/${started.payload.run.run_id}/checkpoint`,
      {
        checkpoint: {
          cursor: "before-orchestration",
          state: { ready: true },
          idempotency_key: "v016-restart-checkpoint",
        },
        expected_revision: 0,
      },
      key,
    );
    assert.equal(checkpointed.status, 200);
    const planId = await completeSingleWorkerPlan(
      first.base,
      key,
      started.payload.run.run_id,
    );
    await new Promise((resolve) => first.server.close(resolve));
    first = null;

    second = await listen({
      storageRoot,
      v016PersistenceRequired: true,
      aiLearningFactoryMode: "shadow",
      agenticEfficiencyMode: "off",
      aiRuntimeTelemetryProducer: {
        async recordGenericRunCompletion(input) {
          telemetryInput = structuredClone(input);
          return {
            telemetry_digest: `sha256:${"d".repeat(64)}`,
            usage_kind: "unavailable",
            provider_usage_verified: false,
          };
        },
      },
    });
    const joined = await request(
      second.base,
      "POST",
      `/v1/generic-agents/orchestration/${planId}/join`,
      {},
      key,
    );
    assert.equal(joined.status, 200);
    assert.equal(telemetryInput.run.run_id, started.payload.run.run_id);
    assert(
      telemetryInput.run.trace.some((entry) => entry.event === "run_restored"),
    );
  } finally {
    if (first) await new Promise((resolve) => first.server.close(resolve));
    if (second) await new Promise((resolve) => second.server.close(resolve));
  }
});
