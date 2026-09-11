import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureCanonicalWorkCausalLineage,
  ensureCanonicalWorkProjectDecisionPath,
} from "../src/canonical-work-causal-lineage.js";

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
    project_decision_path_read: invoke("project_decision_path_read", async () => {
      if (!genesis) { const error = new Error("CAUSAL_NOT_FOUND"); error.code = "CAUSAL_NOT_FOUND"; throw error; }
      return { project, genesis_intent: genesis, intent_revisions: revision ? [revision] : [] };
    }),
    genesis_intent_read: invoke("genesis_intent_read", async () => {
      if (!genesis) { const error = new Error("CAUSAL_NOT_FOUND"); error.code = "CAUSAL_NOT_FOUND"; throw error; }
      return genesis;
    }),
    genesis_intent_create: invoke("genesis_intent_create", async () =>
      (genesis ||= { genesis_intent_id: "33333333-3333-4333-8333-333333333333" })),
    intent_revision_propose: invoke("intent_revision_propose", async () =>
      (revision ||= {
        intent_revision_id: "44444444-4444-4444-8444-444444444444",
        canonical_digest: "d".repeat(64), state: "PROPOSED",
        alias: "canonical-work-bootstrap-initial", classification: "REFINEMENT",
        parent_revision_id: null,
        revision_payload: {
          motivation: "Establish the initial approved causal decision path for canonical Work lineage.",
          problem: WORK.objective,
          scope_added: [WORK.project_id],
          invariants: ["Canonical Work lineage remains server-derived and effect-free at bootstrap."],
        },
      })),
    intent_revision_approve: invoke("intent_revision_approve", async () => {
      revision = { ...revision, state: "APPROVED" };
      project = { ...project, active_intent_revision_id: revision.intent_revision_id };
      return revision;
    }),
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
    "project_identity_resolve", "genesis_intent_read", "project_decision_path_read",
    "project_state_snapshot", "work_bind_intent",
  ]);
  const binding = calls.at(-1).args;
  assert.equal(binding.work_id, WORK.work_id);
  assert.equal(binding.project_id, result.project_id);
  assert.equal(binding.intent_revision_id, result.intent_revision_id);
  assert.equal(binding.base_state_digest, result.state_digest);
  assert.equal(binding.legacy_binding_state, "VERIFIED");
});

test("canonical lineage materializes a missing project, genesis and initial approval before binding", async () => {
  const { handlers, calls } = fixture({ existing: false, genesisPresent: false, revisionPresent: false });
  const result = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK });
  assert.equal(result.work_id, WORK.work_id);
  assert.deepEqual(calls.map((item) => item.name), [
    "project_identity_resolve", "project_identity_create", "genesis_intent_read",
    "genesis_intent_create", "genesis_intent_read", "project_decision_path_read",
    "intent_revision_propose", "project_decision_path_read", "intent_revision_approve",
    "project_decision_path_read", "project_state_snapshot", "work_bind_intent",
  ]);
  assert.equal(calls.find((item) => item.name === "project_identity_create").args.alias, WORK.project_id);
  assert.equal(calls.find((item) => item.name === "genesis_intent_create").args.intent_text, WORK.objective);
  assert.equal(calls.find((item) => item.name === "intent_revision_propose").args.affected_work_ids.length, 0);
  assert.equal(calls.find((item) => item.name === "intent_revision_approve").args.expected_no_active_intent, true);
});

test("project-side causal bootstrap accepts server-owned material before a Work id exists", async () => {
  const { handlers, calls } = fixture({ existing: false, genesisPresent: false, revisionPresent: false });
  const result = await ensureCanonicalWorkProjectDecisionPath({
    handlers,
    identity: IDENTITY,
    work: { project_id: WORK.project_id, objective: WORK.objective },
  });
  assert.equal(result.project_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(result.intent_revision_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(calls.some((item) => item.name === "work_bind_intent"), false);
  assert.equal(calls.find((item) => item.name === "project_identity_create").args.provenance.work_id,
    undefined);
});

test("canonical lineage fails closed when existing causal history lacks an active approval", async () => {
  const { handlers } = fixture({ existing: true, genesisPresent: true, revisionPresent: false });
  handlers.intent_revision_propose = async () => ({ structuredContent: { ok: true, result: {
    intent_revision_id: "44444444-4444-4444-8444-444444444444", state: "PROPOSED",
  } } });
  handlers.intent_revision_approve = async () => {
    throw new Error("approval_must_not_be_invented_for_existing_history");
  };
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK }),
    /canonical_work_causal_active_intent_missing/u);
});

test("canonical lineage resumes only its exact pending bootstrap proposal", async () => {
  const { handlers, calls } = fixture({ existing: false, genesisPresent: false, revisionPresent: false });
  const approve = handlers.intent_revision_approve;
  let failFirstApproval = true;
  handlers.intent_revision_approve = async (args, identity) => {
    if (failFirstApproval) {
      failFirstApproval = false;
      throw new Error("transient_approval_failure");
    }
    return approve(args, identity);
  };
  await assert.rejects(() => ensureCanonicalWorkProjectDecisionPath({
    handlers, identity: IDENTITY, work: { project_id: WORK.project_id, objective: WORK.objective },
  }), /canonical_work_causal_active_intent_missing/u);
  const resumed = await ensureCanonicalWorkProjectDecisionPath({
    handlers, identity: IDENTITY, work: { project_id: WORK.project_id, objective: WORK.objective },
  });
  assert.equal(resumed.intent_revision_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(calls.filter((item) => item.name === "intent_revision_propose").length, 1);
});

test("canonical lineage keeps Work and project intent domains distinct and rejects malformed anchors", async () => {
  const { handlers } = fixture();
  const result = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY,
    work: { ...WORK, intent_digest: "c".repeat(64) } });
  assert.equal(result.work_intent_digest, "c".repeat(64));
  assert.equal(result.project_intent_digest, WORK.intent_digest);
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY,
    work: { ...WORK, intent_digest: "not-a-digest" } }),
  /canonical_work_causal_intent_binding_mismatch/u);
});

test("canonical lineage retains a valid request-scoped bootstrap intent without equating domains", async () => {
  const { handlers } = fixture();
  const result = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY,
    work: { ...WORK, architecture: { host_binding: { canonical_intent_binding: {
      canonical_intent_digest: "c".repeat(64),
    } } } } });
  assert.equal(result.project_intent_digest, WORK.intent_digest);
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({
    handlers,
    identity: IDENTITY,
    work: {
      ...WORK,
      architecture: { host_binding: { canonical_intent_binding: {
        canonical_intent_digest: "invalid",
      } } },
    },
  }), /canonical_work_causal_intent_binding_mismatch/u);
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
