import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMemoryFabric } from "../src/memory-fabric.js";

function fixture(govern = async () => ({ allowed: true, decision: "allow_controlled", mediation: "allow" })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sh-memory-fabric-"));
  const config = { memoryFabricRoot: root, memoryRetentionDays: 365, personalMemoryRetentionDays: 90 };
  return { root, config, fabric: createMemoryFabric(config, { govern }) };
}

const tenantA = { tenantId: "tenant-a", subject: "agent-a" };
const tenantB = { tenantId: "tenant-b", subject: "agent-b" };

test("isolates tenants and returns only lexically relevant memories", async (t) => {
  const { root, fabric } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await fabric.append({ title: "Render plan", summary: "Move orchestration to Render", tags: ["render"] }, tenantA);
  await fabric.append({ title: "Billing plan", summary: "Prepare invoice reconciliation", tags: ["billing"] }, tenantA);
  await fabric.append({ title: "Private competitor", summary: "Render belongs to another customer" }, tenantB);

  const searchA = fabric.search({ query: "Render" }, tenantA);
  assert.equal(searchA.results.length, 1);
  assert.equal(searchA.results[0].title, "Render plan");
  assert.equal(fabric.search({ query: "competitor" }, tenantA).results.length, 0);
  assert.equal(fabric.search({ query: "competitor" }, tenantB).results.length, 1);
  assert.notEqual(
    path.dirname(path.dirname(path.join(root, "tenants", tenantA.tenantId, "memory-fabric", "state.json"))),
    path.dirname(path.dirname(path.join(root, "tenants", tenantB.tenantId, "memory-fabric", "state.json"))),
  );
});

test("inherits tenant and project memory into a new session without leaking sibling scopes", async (t) => {
  const { root, fabric } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await fabric.append({ title: "Tenant rule", summary: "Always require audit" }, tenantA);
  await fabric.append({ title: "Project decision", summary: "Use Render", project_id: "project-a" }, tenantA);
  await fabric.append({ title: "Old session", summary: "Previous session note", project_id: "project-a", session_id: "session-old" }, tenantA);
  await fabric.append({ title: "Sibling project", summary: "Must stay isolated", project_id: "project-b" }, tenantA);
  const context = fabric.context({ project_id: "project-a", session_id: "session-new", limit: 20 }, tenantA);
  assert.deepEqual(
    new Set(context.relevant_memories.map((item) => item.title)),
    new Set(["Tenant rule", "Project decision"]),
  );
});

test("redacts secrets and personal identifiers before persistence", async (t) => {
  const { root, fabric } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawSecret = "sk-proj-ThisMustNeverReachDisk123";
  const result = await fabric.append({
    title: "Credentials removed",
    summary: `Bearer abc.def.ghi password=hunter2 ${rawSecret} owner@example.com`,
  }, tenantA);
  assert.match(result.memory.summary, /REDACTED_SECRET/);
  assert.match(result.memory.summary, /REDACTED_EMAIL/);
  assert(result.memory.redaction_count >= 3);
  const stored = fs.readFileSync(path.join(root, "tenants", "tenant-a", "memory-fabric", "state.json"), "utf8");
  assert(!stored.includes(rawSecret));
  assert(!stored.includes("hunter2"));
  assert(!stored.includes("owner@example.com"));
});

test("enforces classification, consent and personal retention", async (t) => {
  const { root, fabric } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(
    fabric.append({ title: "Forbidden", summary: "Do not store", data_classification: "restricted" }, tenantA),
    /restricted_memory_not_storable/,
  );
  await assert.rejects(
    fabric.append({ title: "Personal", summary: "Consent missing", data_classification: "customer_personal" }, tenantA),
    /memory_consent_reference_required/,
  );
  const personal = await fabric.append({
    title: "Personal preference",
    summary: "Customer opted into preference memory",
    data_classification: "customer_personal",
    consent_reference: "consent-2026",
    retention_days: 365,
  }, tenantA);
  const days = (new Date(personal.memory.expires_at).getTime() - Date.now()) / 86_400_000;
  assert(days > 89 && days <= 90.01);
});

test("supports idempotent append, checkpoint, handoff and acknowledgement", async (t) => {
  const { root, config, fabric } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payload = { title: "Decision", summary: "Use tenant memory fabric", idempotency_key: "idem-001", project_id: "project-x" };
  const first = await fabric.append(payload, tenantA);
  const replay = await fabric.append(payload, tenantA);
  assert.equal(first.memory.id, replay.memory.id);
  assert.equal(replay.idempotent_replay, true);

  await fabric.checkpoint({ summary: "Implementation is ready for integration tests", project_id: "project-x" }, tenantA);
  const handoff = await fabric.handoff({ summary: "Run end-to-end tests", to_agent_id: "core-agent", project_id: "project-x" }, tenantA);
  let context = fabric.context({ project_id: "project-x", agent_id: "core-agent" }, tenantA);
  assert(context.latest_checkpoint);
  assert.equal(context.pending_handoffs.length, 1);
  await assert.rejects(
    fabric.acknowledge({ handoff_id: handoff.handoff.id, agent_id: "wrong-agent" }, tenantA),
    /handoff_recipient_mismatch/,
  );
  await fabric.acknowledge({ handoff_id: handoff.handoff.id, agent_id: "core-agent" }, tenantA);
  context = fabric.context({ project_id: "project-x", agent_id: "core-agent" }, tenantA);
  assert.equal(context.pending_handoffs.length, 0);

  const reloaded = createMemoryFabric(config, { govern: async () => ({ allowed: true }) });
  assert.equal(reloaded.search({ query: "tenant memory" }, tenantA).results.length, 1);
  assert(reloaded.context({ project_id: "project-x" }, tenantA).latest_checkpoint);
});

test("preserves every concurrent write under a per-tenant lock", async (t) => {
  const { root, fabric } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await Promise.all(Array.from({ length: 40 }, (_, index) => fabric.append({
    title: `Concurrent ${index}`,
    summary: `Unique memory concurrent_${index}`,
    idempotency_key: `concurrent-${index}`,
  }, tenantA)));
  const context = fabric.context({ query: "concurrent", limit: 50, activity_limit: 50 }, tenantA);
  assert.equal(context.relevant_memories.length, 40);
  assert.equal(new Set(context.relevant_memories.map((item) => item.title)).size, 40);
  assert.equal(context.revision, 40);
});

test("automatic journal stores safe metadata but never raw arguments", async (t) => {
  const { root, fabric } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawPrompt = "raw customer prompt that must not persist";
  const rawSecret = "sk-proj-automaticJournalSecret123";
  await fabric.recordToolActivity({
    identity: tenantA,
    toolName: "nyra_interpret_request",
    args: { message: `${rawPrompt} ${rawSecret}`, project_id: "project-x" },
    result: { structuredContent: { result: { selected_by_core: { state: "controlled" } } } },
  });
  const stored = fs.readFileSync(path.join(root, "tenants", "tenant-a", "memory-fabric", "state.json"), "utf8");
  assert(!stored.includes(rawPrompt));
  assert(!stored.includes(rawSecret));
  const recent = fabric.context({ project_id: "project-x" }, tenantA).recent_activity;
  assert.equal(recent[0].source, "mcp_auto_journal");
  assert.equal(recent[0].summary, "Tool nyra_interpret_request completed.");
});

test("fails closed when Core governance denies a memory write", async (t) => {
  const { root, fabric } = fixture(async () => ({ allowed: false, decision: "block", mediation: "hard_block" }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(fabric.append({ title: "Denied", summary: "Must not be written" }, tenantA), /core_gate_denied/);
  assert.equal(fabric.search({ query: "Denied" }, tenantA).results.length, 0);
});
