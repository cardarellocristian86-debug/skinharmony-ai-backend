import test from "node:test";
import assert from "node:assert/strict";
import { ensureCanonicalWorkCausalLineage } from "../src/canonical-work-causal-lineage.js";

const WORK = Object.freeze({
  work_id: "11111111-1111-4111-8111-111111111111",
  project_id: "nyra-runtime",
  objective: "Keep canonical Work creation horizontally usable.",
  intent_digest: "b".repeat(64),
});
const IDENTITY = Object.freeze({ tenantId: "tenant-a" });

function fixture({ existing = true, genesisPresent = true, revisionPresent = true } = {}) {
  const calls = [];
  let project = existing ? { project_id: "22222222-2222-4222-8222-222222222222",
    active_intent_revision_id: "44444444-4444-4444-8444-444444444444" } : null;
  let genesis = genesisPresent ? { genesis_intent_id: "33333333-3333-4333-8333-333333333333" } : null;
  let revision = revisionPresent ? { intent_revision_id: "44444444-4444-4444-8444-444444444444",
    canonical_digest: WORK.intent_digest, state: "APPROVED",
    decided_at: "2026-09-10T00:00:00.000Z" } : null;
  const invoke = (name, fn) => async (args) => {
    calls.push({ name, args });
    return { structuredContent: { ok: true, result: await fn(args) } };
  };
  const handlers = {
    project_identity_resolve: invoke("project_identity_resolve", async () => {
      if (!project) { const error = new Error("CAUSAL_NOT_FOUND"); error.code = "CAUSAL_NOT_FOUND"; throw error; }
      return project;
    }),
    project_identity_create: invoke("project_identity_create", async () =>
      (project ||= { project_id: "22222222-2222-4222-8222-222222222222" })),
    project_decision_path_read: invoke("project_decision_path_read", async () => ({
      genesis_intent: genesis, intent_revisions: revision ? [revision] : [],
    })),
    genesis_intent_create: invoke("genesis_intent_create", async () =>
      (genesis ||= { genesis_intent_id: "33333333-3333-4333-8333-333333333333" })),
    intent_revision_propose: invoke("intent_revision_propose", async () =>
      (revision ||= { intent_revision_id: "44444444-4444-4444-8444-444444444444", state: "PROPOSED" })),
    intent_revision_approve: invoke("intent_revision_approve", async () =>
      (revision = { ...revision, state: "APPROVED" })),
    project_state_snapshot: invoke("project_state_snapshot", async () => ({ state_digest: "a".repeat(64) })),
    work_bind_intent: invoke("work_bind_intent", async (args) => ({
      project_id: args.project_id, work_id: args.work_id,
    })),
  };
  return { handlers, calls };
}

test("canonical Work bootstrap repairs the server-derived causal binding", async () => {
  const { handlers, calls } = fixture();
  const result = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK });
  assert.equal(result.work_id, WORK.work_id);
  assert.deepEqual(calls.map((item) => item.name), [
    "project_identity_resolve", "project_decision_path_read", "project_state_snapshot", "work_bind_intent",
  ]);
  const binding = calls.at(-1).args;
  assert.equal(binding.work_id, WORK.work_id);
  assert.equal(binding.project_id, result.project_id);
  assert.equal(binding.intent_revision_id, result.intent_revision_id);
  assert.equal(binding.base_state_digest, result.state_digest);
  assert.equal(binding.legacy_binding_state, "VERIFIED");
});

test("canonical lineage fails closed when project, genesis or active intent is absent", async () => {
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({
    handlers: fixture({ existing: false }).handlers, identity: IDENTITY, work: WORK,
  }), /canonical_work_causal_project_missing/u);
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({
    handlers: fixture({ genesisPresent: false }).handlers, identity: IDENTITY, work: WORK,
  }), /canonical_work_causal_genesis_missing/u);
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({
    handlers: fixture({ revisionPresent: false }).handlers, identity: IDENTITY, work: WORK,
  }), /canonical_work_causal_active_intent_missing/u);
});

test("canonical lineage binds the project active intent and rejects Work intent drift", async () => {
  const { handlers } = fixture();
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY,
    work: { ...WORK, intent_digest: "c".repeat(64) } }),
  /canonical_work_causal_intent_binding_mismatch/u);
});

test("canonical Work replay repairs or replays only the idempotent binding", async () => {
  const { handlers, calls } = fixture({ existing: true });
  const first = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK });
  const second = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK });
  assert.deepEqual(second, first);
  assert.equal(calls.filter((item) => item.name === "project_identity_create").length, 0);
  assert.equal(calls.filter((item) => item.name === "genesis_intent_create").length, 0);
  assert.equal(calls.filter((item) => item.name === "intent_revision_propose").length, 0);
  assert.equal(calls.filter((item) => item.name === "work_bind_intent").length, 2);
  assert.equal(calls.filter((item) => item.name === "work_bind_intent")[0].args.idempotency_key,
    calls.filter((item) => item.name === "work_bind_intent")[1].args.idempotency_key);
});

test("canonical lineage rejects caller-like incomplete Work material", async () => {
  const { handlers } = fixture({ existing: true });
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY,
    work: { ...WORK, work_id: "" } }), /canonical_work_causal_lineage_source_invalid/u);
});
