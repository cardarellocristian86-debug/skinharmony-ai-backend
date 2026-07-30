import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkContinuityRuntime } from "../src/workContinuityRuntime.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-continuity-"));
  const runtime = createWorkContinuityRuntime({ root, now: () => "2026-07-28T00:00:00.000Z" });
  const work = runtime.create({ project_id: "nyra", session_id: "s1", architecture_map: { idea_origin: "continuity", objective: "preserve long work", current_state: "planned" } }, "codexai");
  return { root, runtime, work };
}
test("work continuity persists tenant-scoped capsule, checkpoint and idempotent event", () => {
  const { root, runtime, work } = fixture();
  try {
    const id = work.identity.work_id;
    runtime.append({ tenant_id: "codexai", work_id: id, event_type: "function_added", actor: "architecture_mapper", data: { function: { id: "resume" }, impact_map: { depth: 2, connections: [{ from: "resume", to: "capsule" }], dependencies: ["checkpoint"] } } });
    const first = runtime.append({ tenant_id: "codexai", work_id: id, event_type: "branch_opened", actor: "dtt_event_agent", data: { branch: "core" }, idempotency_key: "event-1" });
    assert.equal(runtime.append({ tenant_id: "codexai", work_id: id, event_type: "branch_opened", actor: "dtt_event_agent", idempotency_key: "event-1" }).event.event_id, first.event.event_id);
    const checkpoint = runtime.checkpoint({ tenant_id: "codexai", work_id: id, actor: "codex_worker", next_action: "run tests", tests: [{ id: "unit", passed: true }], idempotency_key: "cp-1" });
    assert.match(checkpoint.capsule.digest, /^[a-f0-9]{64}$/);
    const resumed = runtime.resume({ tenant_id: "codexai", work_id: id, session_id: "s2" });
    assert.equal(resumed.revalidation_required, true);
    assert.equal(resumed.execution_authorized, false);
    assert.equal(runtime.read({ tenant_id: "codexai", work_id: id }).impact_maps.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("work continuity denies cross-tenant resume, drift and unverified memory", () => {
  const { root, runtime, work } = fixture();
  try {
    const id = work.identity.work_id;
    runtime.checkpoint({ tenant_id: "codexai", work_id: id, actor: "codex_worker", next_action: "resume", commit_patch: { digest: "expected-repository-digest" } });
    assert.throws(() => runtime.read({ tenant_id: "other", work_id: id }), /work_not_found|cross_tenant/);
    assert.throws(() => runtime.resume({ tenant_id: "codexai", work_id: id, session_id: "s2", repository_digest: "wrong" }), /continuity_drift_detected/);
    assert.throws(() => runtime.verifyMemory({ tenant_id: "codexai", work_id: id, actor: "memory_curator", supervisor_approved: true, test_reference: "missing", memory: { provenance: "test", confidence: 1, valid_until: "2027", summary: "x" } }), /verified_memory_test_evidence_required/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
