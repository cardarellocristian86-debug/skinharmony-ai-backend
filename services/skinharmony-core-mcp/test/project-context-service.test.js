import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBoundedProjectContext,
  createProjectContextService,
  deterministicProjectId,
  normalizeProjectReviewInput,
  normalizeSpecialist,
} from "../src/project-context-service.js";

function project(projectId = "alpha-project") {
  const names = ["PROJECT.md", "STATE.md", "DECISIONS.md", "EVIDENCE.md", "HANDOFF.md"];
  return {
    project_id: projectId,
    manifest: { objective: "Build a bounded agent workflow" },
    documents: names.map((name) => ({ name, content: `${name} content`, content_sha256: name.padEnd(64, "0").slice(0, 64) })),
  };
}

test("project ids are deterministic, readable and traversal safe", () => {
  assert.equal(deterministicProjectId("Nyra Core Launch"), deterministicProjectId("Nyra Core Launch"));
  assert.match(deterministicProjectId("Nyra Core Launch"), /^nyra-core-launch-[a-f0-9]{10}$/);
  assert.throws(() => deterministicProjectId(""), /project_title_invalid/);
});

test("specialist is a closed architecture or code choice", () => {
  assert.equal(normalizeSpecialist(""), "architecture");
  assert.equal(normalizeSpecialist("code"), "code");
  assert.throws(() => normalizeSpecialist("shell-admin"), /project_specialist_invalid/);
});

test("bounded context exposes only prior run metadata and never forwards model output", () => {
  const sentinel = "OWNER_ONLY_SENTINEL_MUST_NOT_BE_FORWARDED";
  const context = buildBoundedProjectContext(project(), [{
    source_path: "PROJECTS/alpha-project/RUNS/run_a.md",
    content: sentinel,
    metadata: {
      run_id: "run_a",
      status: "completed",
      output_present: true,
      output_digest_sha256: "a".repeat(64),
      secret: "must not be forwarded",
    },
  }]);
  assert.match(context.revision, /^[a-f0-9]{64}$/);
  assert.match(context.handoff, /UNREVIEWED previous run run_a: status=completed; output=withheld/);
  assert.equal(JSON.stringify(context).includes(sentinel), false);
  assert.equal(JSON.stringify(context).includes("must not be forwarded"), false);
  assert.match(context.constraints, /never accepted evidence/);
  assert(Buffer.byteLength(JSON.stringify(context), "utf8") <= 2_000);
});

test("service always binds reads, ensures and run artifacts to authenticated tenant", async () => {
  const calls = [];
  const cloud = {
    ensureProjectContext: async (tenantId, input) => { calls.push(["ensure", tenantId, input]); return project(input.project_id); },
    readProjectContext: async (tenantId, projectId) => { calls.push(["read", tenantId, projectId]); return project(projectId); },
    listBySourcePrefix: async (tenantId, prefix, limit) => { calls.push(["list", tenantId, prefix, limit]); return []; },
    recordProjectRunTerminal: async (tenantId, input) => {
      calls.push(["terminal", tenantId, input]);
      return { recorded: true, artifact: { id: "a".repeat(24) } };
    },
  };
  const service = createProjectContextService(cloud);
  const identity = { tenantId: "tenant-a" };
  const ensured = await service.ensure(identity, { title: "Alpha", objective: "Test architecture" });
  assert.match(ensured.project.project_id, /^alpha-/);
  assert.equal(ensured.project_id, ensured.project.project_id);
  await service.read(identity, ensured.project.project_id);
  const recorded = await service.recordRun(identity, {
    run: {
      run_id: "run_abc",
      project_id: ensured.project.project_id,
      status: "completed",
      started_at: "2026-07-22T10:00:00.000Z",
      completed_at: "2026-07-22T10:01:00.000Z",
      final_output: "OWNER_ONLY_DRAFT_SENTINEL",
    },
  });
  assert(calls.every((call) => call[1] === "tenant-a"));
  const terminal = calls.find((call) => call[0] === "terminal")[2];
  assert.match(terminal.project_id, /^alpha-[a-f0-9]{10}$/);
  assert.equal(terminal.run_id, "run_abc");
  assert.equal(terminal.started_at, "2026-07-22T10:00:00.000Z");
  assert.equal(terminal.created_at, "2026-07-22T10:00:00.000Z");
  assert.match(terminal.output_digest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(terminal).includes("OWNER_ONLY_DRAFT_SENTINEL"), false);
  assert.match(terminal.artifact_text, /UNREVIEWED model output withheld/);
  assert.match(terminal.handoff_text, /unreviewed model output/);
  assert.equal(recorded.project_id, ensured.project.project_id);
  assert.match(recorded.revision, /^[a-f0-9]{64}$/);
});

test("non-terminal runs are not persisted as project results", async () => {
  let writes = 0;
  const service = createProjectContextService({
    ensureProjectContext: async () => project(),
    readProjectContext: async () => project(),
    recordProjectRunTerminal: async () => { writes += 1; },
  });
  const result = await service.recordRun({ tenantId: "tenant-a" }, {
    run: { run_id: "run_abc", project_id: "alpha-project", status: "running" },
  });
  assert.deepEqual(result, { recorded: false, reason: "run_not_terminal" });
  assert.equal(writes, 0);
});

test("review preparation is canonical and commit remains bound to the authenticated tenant", async () => {
  const calls = [];
  const cloud = {
    ensureProjectContext: async () => project(),
    readProjectContext: async () => project(),
    commitProjectReview: async (tenantId, prepared) => {
      calls.push({ tenantId, prepared });
      return {
        committed: true,
        idempotent: false,
        project_id: prepared.project_id,
        run_id: prepared.run_id,
        disposition: prepared.disposition,
        review_id: "a".repeat(24),
        reviewed_at: "2026-07-22T16:00:00.000Z",
        previous_revision: prepared.expected_revision,
        revision: "b".repeat(64),
      };
    },
  };
  const service = createProjectContextService(cloud);
  const input = {
    project_id: "alpha-project",
    run_id: "run_review",
    expected_revision: "A".repeat(64),
    disposition: "accept_selected",
    decision_items: [{ decision: "Keep context bounded.", rationale: "Avoid drift." }],
    evidence_items: [],
    idempotency_key: "review-service-001",
  };
  const prepared = service.prepareReview(input);
  assert.deepEqual(prepared, normalizeProjectReviewInput(input));
  assert.equal(prepared.expected_revision, "a".repeat(64));
  assert.match(prepared.review_digest_sha256, /^[a-f0-9]{64}$/);

  const result = await service.commitReview({ tenantId: "tenant-a" }, prepared);
  assert.equal(result.revision, "b".repeat(64));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenantId, "tenant-a");
  assert.deepEqual(calls[0].prepared, prepared);
});
