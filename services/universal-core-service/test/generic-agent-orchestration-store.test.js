import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGenericAgentOrchestrator } from "../src/genericAgentOrchestrator.js";
import { createGenericAgentOrchestrationStore } from "../src/genericAgentOrchestrationStore.js";

test("durable orchestration snapshots retain topology but digest worker tasks and results", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generic-orchestration-store-"));
  const email = "mario.rossi@example.test";
  const secret = "ghp_abcdefghijklmnopqrstuv";
  try {
    const store = createGenericAgentOrchestrationStore({
      root,
      now: () => "2026-07-17T08:00:00.000Z",
    });
    const orchestrator = createGenericAgentOrchestrator({
      now: () => "2026-07-17T08:00:00.000Z",
      idFactory: () => "fixed",
    });
    const plan = orchestrator.createPlan({
      tenant_id: "tenant_a",
      run_id: "run_private",
      workers: [{
        worker_id: "worker",
        agent_id: "agent_private",
        role: "reviewer",
        task: `Review ${email}`,
      }],
    });
    plan.status = "ready_for_core_join";
    plan.workers[0].status = "completed";
    plan.workers[0].result = {
        evidence: [`Sensitive evidence ${email}`],
        content: secret,
    };
    const saved = store.save({
      tenant_id: "tenant_a",
      plan_snapshot: plan,
    });
    assert.equal(saved.schema_version, "generic_agent_orchestration_store_v2");
    assert.match(
      saved.plan_snapshot.workers[0].task,
      /^worker_task_digest:sha256:[a-f0-9]{64}$/,
    );
    assert.match(
      saved.plan_snapshot.workers[0].result.evidence_digest,
      /^sha256:[a-f0-9]{64}$/,
    );
    assert.equal(saved.raw_content_persisted, false);

    const files = fs.readdirSync(root, { recursive: true })
      .filter((entry) => String(entry).endsWith(".json"));
    assert.equal(files.length, 1);
    const disk = fs.readFileSync(path.join(root, files[0]), "utf8");
    for (const raw of [email, secret, "Sensitive evidence", `"content"`]) {
      assert.equal(disk.includes(raw), false, `orchestration disk must not contain ${raw}`);
    }

    const restored = createGenericAgentOrchestrator({
      now: () => "2026-07-17T08:01:00.000Z",
    }).restorePlan({
      tenant_id: "tenant_a",
      plan_snapshot: store.load({
        tenant_id: "tenant_a",
        plan_id: plan.plan_id,
      }).plan_snapshot,
    });
    assert.equal(restored.status, "ready_for_core_join");
    assert.equal(restored.workers[0].status, "completed");
    assert.equal(restored.workers[0].result.raw_content_persisted, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("durable orchestration store rejects sensitive tenant and plan identifiers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generic-orchestration-store-"));
  try {
    const store = createGenericAgentOrchestrationStore({ root });
    assert.throws(() => store.save({
      tenant_id: "mario.rossi@example.test",
      plan_snapshot: {},
    }), /tenant_id_invalid/);
    assert.throws(() => store.load({
      tenant_id: "tenant_a",
      plan_id: "plan:+39-333-1234567",
    }), /plan_id_invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
