import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { nyraDigest } from "../../shared/nyra-work-automation-receipts.js";
import { createNyraFileStore, createNyraMemoryStore, createNyraWorkAutomationRuntime } from "../src/nyraWorkAutomationRuntime.js";

const digest = "a".repeat(64);
const base = "b".repeat(40);

function input(overrides = {}) {
  const objective = "Rebuild governed automation";
  return { tenant_id: "tenant", work_id: "work", intent_anchor_digest: digest, intent_objective: objective,
    task_objective_digest: nyraDigest(objective), repository: "owner/repo", base_branch: "main",
    delivery_branch: "agent/work", base_commit: base, allowed_paths: ["services/a.js"], advisory_capabilities: ["planner"], ...overrides };
}
function builderBinding() {
  const unsigned = { schema_version: "nyra_authoritative_builder_binding_v1", builder_agent_id: "builder", session_fingerprint: "session", expires_at: "2099-01-01T00:00:00.000Z" };
  return { ...unsigned, binding_digest: nyraDigest(unsigned) };
}
async function bind(runtime) {
  const artifact = builderBinding();
  return runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "PLAN_PENDING", next_state: "BUILDER_PENDING", actor_id: "builder", artifact_name: "builder_binding", artifact, evidence_digest: artifact.binding_digest });
}

test("runtime enforces objective, path and single builder binding", async () => {
  const runtime = createNyraWorkAutomationRuntime({ now: () => 1_700_000_000_000 });
  await runtime.create(input());
  await bind(runtime);
  await runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "BUILDER_PENDING", next_state: "BUILDING", actor_id: "builder", session_fingerprint: "session" });
  await assert.rejects(runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "BUILDING", next_state: "COMMIT_READBACK_PENDING", actor_id: "builder", changed_files: ["smartdesk-live/a.js"] }), /smart_desk_denied/);
});

test("a different builder or session cannot hijack a bound build", async () => {
  const runtime = createNyraWorkAutomationRuntime();
  await runtime.create(input());
  await bind(runtime);
  await assert.rejects(runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "BUILDER_PENDING", next_state: "BUILDING", actor_id: "attacker", session_fingerprint: "session" }), /builder_binding_mismatch/);
  await assert.rejects(runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "BUILDER_PENDING", next_state: "BUILDING", actor_id: "builder", session_fingerprint: "other" }), /builder_binding_mismatch/);
  assert.equal((await runtime.read({ tenant_id: "tenant", work_id: "work", includePrivate: true })).active_builder, null);
});

test("runtime caps advisory capabilities at six", async () => {
  const runtime = createNyraWorkAutomationRuntime();
  await assert.rejects(runtime.create(input({ advisory_capabilities: ["a", "b", "c", "d", "e", "f", "g"] })), /budget_exceeded/);
});

test("state machine denies skipping commit readback and caller artifacts", async () => {
  const runtime = createNyraWorkAutomationRuntime();
  await runtime.create(input());
  await bind(runtime);
  await runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "BUILDER_PENDING", next_state: "BUILDING", actor_id: "builder", session_fingerprint: "session" });
  await assert.rejects(runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "BUILDING", next_state: "BUILDER_REPORT_PENDING", actor_id: "builder", artifact_name: "commit_attestation", artifact: { schema_version: "nyra_commit_attestation_v2" }, evidence_digest: digest }), /transition_denied/);
  await assert.rejects(runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "BUILDING", next_state: "COMMIT_READBACK_PENDING", actor_id: "builder", artifact_name: "commit_readback", artifact: { schema_version: "wrong", readback_digest: digest }, evidence_digest: digest }), /stage_evidence_required/);
});

test("deployment readback cannot skip authoritative service observation", async () => {
  const state = { schema_version: "nyra_work_automation_store_v1", records: {} };
  const record = { ...(await createNyraWorkAutomationRuntime({ store: createNyraMemoryStore(state) }).create(input())), state: "DEPLOYMENT_READBACK_PENDING" };
  record.events = [];
  record.revision = 0;
  record.record_digest = nyraDigest({ ...record, record_digest: undefined });
  const runtime = createNyraWorkAutomationRuntime({ store: createNyraMemoryStore({ schema_version: "nyra_work_automation_store_v1", records: { work: record } }) });
  await assert.rejects(runtime.transition({ tenant_id: "tenant", work_id: "work", expected_state: "DEPLOYMENT_READBACK_PENDING", next_state: "FINAL_ACCEPTANCE_PENDING", artifact_name: "service_observations", artifact: { schema_version: "nyra_service_observations_v1" }, evidence_digest: digest }), /transition_denied/);
});

test("store read rejects a tampered event chain", async () => {
  const memory = createNyraMemoryStore();
  const runtime = createNyraWorkAutomationRuntime({ store: memory });
  await runtime.create(input());
  const state = await memory.read();
  state.records.work.events[0].payload.task_objective_digest = "f".repeat(64);
  const tampered = { ...state };
  const malicious = { kind: "malicious", restart_durable: false, read: async () => tampered, compareAndSwap: async () => true };
  const guarded = createNyraWorkAutomationRuntime({ store: malicious });
  await assert.rejects(guarded.read({ tenant_id: "tenant", work_id: "work" }), /event_chain_invalid/);
});

test("file CAS recovers only an expired PID lease and persists a valid chain", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v3-store-"));
  const filePath = path.join(root, "state.json");
  let clock = 1_700_000_000_000;
  const store = createNyraFileStore({ filePath, lockLeaseMs: 1000, now: () => clock });
  fs.writeFileSync(`${filePath}.lock`, JSON.stringify({ schema_version: "nyra_work_automation_lock_v1", pid: 999999, expires_at: new Date(clock - 1).toISOString() }));
  const runtime = createNyraWorkAutomationRuntime({ store, now: () => clock });
  await runtime.create(input());
  assert.equal((await runtime.read({ tenant_id: "tenant", work_id: "work" })).state, "PLAN_PENDING");
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("file CAS never steals an expired lease from a live PID", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v3-live-lock-"));
  const filePath = path.join(root, "state.json");
  const clock = 1_700_000_000_000;
  fs.writeFileSync(`${filePath}.lock`, JSON.stringify({ schema_version: "nyra_work_automation_lock_v1", pid: process.pid, fencing_token: "held", expires_at: new Date(clock - 1).toISOString() }));
  const runtime = createNyraWorkAutomationRuntime({ store: createNyraFileStore({ filePath, now: () => clock }) });
  await assert.rejects(runtime.create(input()), /store_busy/);
  assert.equal(fs.existsSync(`${filePath}.lock`), true);
  fs.rmSync(root, { recursive: true, force: true });
});
