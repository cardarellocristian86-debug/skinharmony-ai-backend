import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const OTHER_HOST_IDENTITY = Object.freeze({ tenantId: "tenant-a", subject: "other-owner",
  authenticatedHostPrincipal: { app_id: "codex" },
  agentPresence: { session_fingerprint: "another-session" } });

function bootstrapRevisionId(projectId) {
  const binding = crypto.createHash("sha256").update(JSON.stringify({
    tenant_id: IDENTITY.tenantId, project_alias: WORK.project_id,
  })).digest("hex").slice(0, 48);
  const key = `canonical-work-initial-revision-${binding}`;
  const bytes = crypto.createHash("sha256").update([
    IDENTITY.tenantId, projectId, "intent_revision_propose", key,
  ].join("\u0000")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fixture({ existing = true, genesisPresent = true, revisionPresent = true, proposedRevision = null,
  extraRevisions = [] } = {}) {
  const calls = [];
  let project = existing ? { project_id: "22222222-2222-4222-8222-222222222222",
    active_intent_revision_id: "44444444-4444-4444-8444-444444444444" } : null;
  let genesis = genesisPresent ? { genesis_intent_id: "33333333-3333-4333-8333-333333333333" } : null;
  let revision = revisionPresent ? { intent_revision_id: "44444444-4444-4444-8444-444444444444",
    canonical_digest: WORK.intent_digest, state: "APPROVED",
    decided_at: "2026-09-10T00:00:00.000Z" } : proposedRevision;
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
      return { project, genesis_intent: genesis, intent_revisions: [
        ...(revision ? [revision] : []), ...extraRevisions,
      ] };
    }),
    genesis_intent_read: invoke("genesis_intent_read", async () => {
      if (!genesis) { const error = new Error("CAUSAL_NOT_FOUND"); error.code = "CAUSAL_NOT_FOUND"; throw error; }
      return genesis;
    }),
    genesis_intent_create: invoke("genesis_intent_create", async () =>
      (genesis ||= { genesis_intent_id: "33333333-3333-4333-8333-333333333333" })),
    intent_revision_propose: invoke("intent_revision_propose", async (args) =>
      (revision ||= {
        intent_revision_id: bootstrapRevisionId(args.project_id),
        canonical_digest: "d".repeat(64), state: "PROPOSED",
        alias: "canonical-work-bootstrap-initial", classification: "REFINEMENT",
        parent_revision_id: null,
        revision_payload: {
          motivation: "Establish the initial approved causal decision path for canonical Work lineage.",
          problem: WORK.objective,
          alternatives_considered: [], chosen_alternative: null, rejected_alternatives: [],
          scope_added: [WORK.project_id],
          scope_removed: [],
          invariants: ["Canonical Work lineage remains server-derived and effect-free at bootstrap."],
          risks: [], affected_work_ids: [], obligations_maintained: [],
          obligations_replaced: [], authorization: null,
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
    continuity_capsule_build: invoke("continuity_capsule_build", async (args) => {
      const capsule = {
        project_identity: { project_id: args.project_id },
        active_work: { work_id: args.work_id },
        capsule_version: "causal_continuity_capsule_v1",
      };
      const capsuleDigest = crypto.createHash("sha256")
        .update(stableCanonicalJson(capsule)).digest("hex");
      return { project_id: args.project_id, work_id: args.work_id,
        capsule_payload: { ...capsule, capsule_digest: capsuleDigest },
        capsule_digest: capsuleDigest };
    }),
  };
  return { handlers, calls };
}

function stableCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableCanonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

test("canonical Work bootstrap repairs the server-derived causal binding", async () => {
  const { handlers, calls } = fixture();
  const result = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK });
  assert.equal(result.work_id, WORK.work_id);
  assert.deepEqual(calls.map((item) => item.name), [
    "project_identity_resolve", "genesis_intent_read", "project_decision_path_read",
    "project_state_snapshot", "work_bind_intent", "continuity_capsule_build",
  ]);
  const binding = calls.find((item) => item.name === "work_bind_intent").args;
  assert.equal(binding.work_id, WORK.work_id);
  assert.equal(binding.project_id, result.project_id);
  assert.equal(binding.intent_revision_id, result.intent_revision_id);
  assert.equal(binding.base_state_digest, result.state_digest);
  assert.equal(binding.legacy_binding_state, "VERIFIED");
});

test("canonical Work bootstrap rejects a capsule bound to another Work", async () => {
  const { handlers } = fixture();
  handlers.continuity_capsule_build = async (args) => {
    const capsule = { project_identity: { project_id: args.project_id },
      active_work: { work_id: "99999999-9999-4999-8999-999999999999" },
      capsule_version: "causal_continuity_capsule_v1" };
    const capsuleDigest = crypto.createHash("sha256")
      .update(stableCanonicalJson(capsule)).digest("hex");
    return { ok: true, result: { project_id: args.project_id,
      work_id: "99999999-9999-4999-8999-999999999999",
      capsule_payload: { ...capsule, capsule_digest: capsuleDigest },
      capsule_digest: capsuleDigest } };
  };
  await assert.rejects(
    ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK }),
    /canonical_work_causal_capsule_readback_invalid/u,
  );
});

test("canonical Work bootstrap rejects a capsule bound to another project", async () => {
  const { handlers } = fixture();
  handlers.continuity_capsule_build = async (args) => {
    const otherProjectId = "88888888-8888-4888-8888-888888888888";
    const capsule = { project_identity: { project_id: otherProjectId },
      active_work: { work_id: args.work_id },
      capsule_version: "causal_continuity_capsule_v1" };
    const capsuleDigest = crypto.createHash("sha256")
      .update(stableCanonicalJson(capsule)).digest("hex");
    return { ok: true, result: { project_id: otherProjectId, work_id: args.work_id,
      capsule_payload: { ...capsule, capsule_digest: capsuleDigest },
      capsule_digest: capsuleDigest } };
  };
  await assert.rejects(
    ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK }),
    /canonical_work_causal_capsule_readback_invalid/u,
  );
});

test("canonical Work bootstrap rejects a tampered capsule digest", async () => {
  const { handlers } = fixture();
  const original = handlers.continuity_capsule_build;
  handlers.continuity_capsule_build = async (args) => {
    const response = await original(args);
    response.structuredContent.result.capsule_payload.active_work.work_id =
      "99999999-9999-4999-8999-999999999999";
    return response;
  };
  await assert.rejects(
    ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK }),
    /canonical_work_causal_capsule_readback_invalid/u,
  );
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
    "continuity_capsule_build",
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
  assert.equal(result.intent_revision_id, bootstrapRevisionId("22222222-2222-4222-8222-222222222222"));
  assert.equal(calls.some((item) => item.name === "work_bind_intent"), false);
  assert.equal(calls.find((item) => item.name === "project_identity_create").args.provenance.work_id,
    undefined);
});

test("canonical project bootstrap never materializes a project after a causal presence failure", async () => {
  const { handlers, calls } = fixture({ existing: false, genesisPresent: false, revisionPresent: false });
  handlers.project_identity_resolve = async () => {
    const error = new Error("host_transport_session_fingerprint_invalid");
    error.code = "host_transport_session_fingerprint_invalid";
    throw error;
  };
  await assert.rejects(() => ensureCanonicalWorkProjectDecisionPath({
    handlers,
    identity: IDENTITY,
    work: { project_id: WORK.project_id, objective: WORK.objective },
  }), /canonical_work_causal_presence_binding_invalid/u);
  assert.equal(calls.some((item) => item.name === "project_identity_create"), false);
  assert.equal(calls.some((item) => item.name === "genesis_intent_create"), false);
});

test("canonical lineage recovers a historical project with unrelated pending proposals", async () => {
  const unrelatedId = "55555555-5555-4555-8555-555555555555";
  const { handlers, calls } = fixture({
    existing: true, genesisPresent: true, revisionPresent: false,
    extraRevisions: [{
      intent_revision_id: unrelatedId, state: "PROPOSED", alias: "operator-draft",
      classification: "REFINEMENT", parent_revision_id: null, revision_payload: {},
    }],
  });
  const result = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY, work: WORK });
  const approval = calls.find((item) => item.name === "intent_revision_approve");
  assert.equal(result.work_id, WORK.work_id);
  assert.equal(approval.args.intent_revision_id, bootstrapRevisionId(result.project_id));
  assert.notEqual(approval.args.intent_revision_id, unrelatedId);
  assert.equal(approval.args.expected_no_active_intent, true);
});

test("canonical lineage resumes only its exact pending bootstrap payload", async () => {
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
  assert.equal(resumed.intent_revision_id, bootstrapRevisionId("22222222-2222-4222-8222-222222222222"));
  assert.equal(calls.filter((item) => item.name === "intent_revision_propose").length, 1);
});

test("canonical lineage resumes a tenant-project bootstrap across registered hosts", async () => {
  const { handlers, calls } = fixture({ existing: false, genesisPresent: false, revisionPresent: false });
  const firstApproval = handlers.intent_revision_approve;
  let interrupt = true;
  handlers.intent_revision_approve = async (...args) => {
    if (interrupt) { interrupt = false; throw new Error("lost_response_after_server_write"); }
    return firstApproval(...args);
  };
  await assert.rejects(() => ensureCanonicalWorkProjectDecisionPath({
    handlers, identity: IDENTITY, work: { project_id: WORK.project_id, objective: WORK.objective },
  }), /canonical_work_causal_active_intent_missing/u);
  const resumed = await ensureCanonicalWorkProjectDecisionPath({
    handlers, identity: OTHER_HOST_IDENTITY,
    work: { project_id: WORK.project_id, objective: WORK.objective },
  });
  assert.equal(resumed.intent_revision_id, bootstrapRevisionId(resumed.project_id));
  assert.equal(calls.filter((item) => item.name === "intent_revision_propose").length, 1);
});

test("canonical lineage accepts an exact bootstrap payload after JSONB key reordering", async () => {
  const { handlers, calls } = fixture({
    existing: true, genesisPresent: true, revisionPresent: false,
    proposedRevision: {
      intent_revision_id: "55555555-5555-4555-8555-555555555555", state: "PROPOSED",
      alias: "canonical-work-bootstrap-initial", classification: "REFINEMENT", parent_revision_id: null,
      revision_payload: {
        risks: [], problem: WORK.objective,
        invariants: ["Canonical Work lineage remains server-derived and effect-free at bootstrap."],
        motivation: "Establish the initial approved causal decision path for canonical Work lineage.",
        scope_added: [WORK.project_id], authorization: null, scope_removed: [], affected_work_ids: [],
        chosen_alternative: null, obligations_replaced: [], rejected_alternatives: [],
        obligations_maintained: [], alternatives_considered: [],
      },
    },
  });
  const result = await ensureCanonicalWorkProjectDecisionPath({
    handlers, identity: OTHER_HOST_IDENTITY,
    work: { project_id: WORK.project_id, objective: WORK.objective },
  });
  assert.equal(result.intent_revision_id, "55555555-5555-4555-8555-555555555555");
  assert.equal(calls.some((item) => item.name === "intent_revision_propose"), false);
  assert.equal(calls.find((item) => item.name === "intent_revision_approve").args.intent_revision_id,
    result.intent_revision_id);
});
test("canonical lineage never approves a proposal that only imitates bootstrap fields", async () => {
  const { handlers, calls } = fixture({
    existing: true,
    genesisPresent: true,
    revisionPresent: false,
    proposedRevision: {
      intent_revision_id: "55555555-5555-4555-8555-555555555555",
      state: "PROPOSED",
      alias: "canonical-work-bootstrap-initial",
      classification: "REFINEMENT",
      parent_revision_id: null,
      revision_payload: {
        motivation: "Establish the initial approved causal decision path for canonical Work lineage.",
        problem: WORK.objective,
        scope_added: [WORK.project_id],
        invariants: ["Canonical Work lineage remains server-derived and effect-free at bootstrap."],
        authorization: { forged: true },
      },
    },
  });
  await assert.rejects(() => ensureCanonicalWorkProjectDecisionPath({
    handlers, identity: IDENTITY, work: { project_id: WORK.project_id, objective: WORK.objective },
  }), /canonical_work_causal_active_intent_missing/u);
  assert.equal(calls.some((item) => item.name === "intent_revision_approve"), false);
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
  assert.equal(calls.filter((item) => item.name === "continuity_capsule_build").length, 2);
  assert.equal(calls.filter((item) => item.name === "work_bind_intent")[0].args.idempotency_key,
    calls.filter((item) => item.name === "work_bind_intent")[1].args.idempotency_key);
  assert.equal(calls.filter((item) => item.name === "continuity_capsule_build")[0].args.idempotency_key,
    calls.filter((item) => item.name === "continuity_capsule_build")[1].args.idempotency_key);
});

test("canonical lineage rejects caller-like incomplete Work material", async () => {
  const { handlers } = fixture({ existing: true });
  await assert.rejects(() => ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY,
    work: { ...WORK, work_id: "" } }), /canonical_work_causal_lineage_source_invalid/u);
});


test("upgraded causal bootstrap never reuses legacy output-hashed request keys", async () => {
  const { handlers, calls } = fixture();
  const requests = new Map();
  for (const name of ["project_state_snapshot", "work_bind_intent", "continuity_capsule_build"]) {
    const original = handlers[name];
    handlers[name] = async (args, identity) => {
      if (args.idempotency_key.startsWith("canonical-work-lineage:")) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      const material = JSON.stringify(args);
      const prior = requests.get(args.idempotency_key);
      if (prior && prior !== material) throw new Error("IDEMPOTENCY_CONFLICT");
      requests.set(args.idempotency_key, material);
      return original(args, identity);
    };
  }
  const first = await ensureCanonicalWorkCausalLineage({ handlers, identity: IDENTITY,
    work: { ...WORK, next_action: "Old operational step" } });
  const replay = await ensureCanonicalWorkCausalLineage({ handlers, identity: OTHER_HOST_IDENTITY,
    work: { ...WORK, next_action: "New operational step" } });
  assert.equal(first.lineage_digest, replay.lineage_digest);
  assert.equal(requests.size, 3);
  assert.equal(calls.filter((call) => call.name === "continuity_capsule_build").length, 2);
});
