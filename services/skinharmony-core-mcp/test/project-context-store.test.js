import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  PROJECT_CONTEXT_DOCUMENT_NAMES,
  canonicalProjectContextPaths,
  createCloudMemoryStore,
  normalizeProjectReviewInput,
  stableMemoryId,
} from "../src/cloud-memory-store.js";
import { createProjectContextService } from "../src/project-context-service.js";

class MemoryPool {
  constructor() {
    this.documents = new Map();
    this.calls = [];
    this.clock = 0;
    this.transactionSnapshot = null;
    this.failOnUpdatePath = null;
  }

  async connect() {
    return { query: this.query.bind(this), release() {} };
  }

  async query(sql, params) {
    this.calls.push({ sql, params });
    if (sql === "BEGIN") {
      this.transactionSnapshot = structuredClone(this.documents);
      return { rows: [], rowCount: 0 };
    }
    if (sql === "COMMIT") {
      this.transactionSnapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql === "ROLLBACK") {
      if (this.transactionSnapshot) this.documents = this.transactionSnapshot;
      this.transactionSnapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (!params) return { rows: [], rowCount: 0 };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("INSERT INTO mcp_memory_documents")) {
      const [tenantId, id, sourcePath, title, content, contentSha256, redactionCount, metadata] = params;
      const key = `${tenantId}\0${sourcePath}`;
      const existing = this.documents.get(key);
      if (existing && sql.includes("DO NOTHING")) return { rows: [], rowCount: 0 };
      const now = new Date(Date.parse("2026-07-22T10:00:00.000Z") + this.clock++).toISOString();
      const row = {
        tenant_id: tenantId,
        id,
        source_path: sourcePath,
        title,
        content,
        content_sha256: contentSha256,
        redaction_count: redactionCount,
        metadata: JSON.parse(metadata),
        created_at: existing?.created_at || now,
        updated_at: now,
      };
      this.documents.set(key, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("UPDATE mcp_memory_documents SET")) {
      const [tenantId, sourcePath, title, content, contentSha256, redactionCount, metadata] = params;
      if (this.failOnUpdatePath === sourcePath) throw new Error("forced_update_failure");
      const key = `${tenantId}\0${sourcePath}`;
      const existing = this.documents.get(key);
      if (!existing) return { rows: [], rowCount: 0 };
      const row = {
        ...existing,
        title,
        content,
        content_sha256: contentSha256,
        redaction_count: redactionCount,
        metadata: JSON.parse(metadata),
        updated_at: new Date(Date.parse("2026-07-22T10:00:00.000Z") + this.clock++).toISOString(),
      };
      this.documents.set(key, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("source_path = ANY($2::text[])")) {
      const [tenantId, paths] = params;
      const rows = paths
        .map((sourcePath) => this.documents.get(`${tenantId}\0${sourcePath}`))
        .filter(Boolean)
        .sort((left, right) => left.source_path.localeCompare(right.source_path));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("source_path LIKE $2")) {
      const [tenantId, escapedPattern, limit] = params;
      const prefix = escapedPattern.slice(0, -1).replace(/\\([\\%_])/g, "$1");
      const rows = [...this.documents.values()]
        .filter((row) => row.tenant_id === tenantId && row.source_path.startsWith(prefix))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .slice(0, limit);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("concat_ws(' ', title, source_path, content) ILIKE ALL")) {
      const [tenantId, patterns, limit] = params;
      const terms = patterns.map((pattern) => String(pattern).replace(/^%|%$/g, "").toLowerCase());
      const rows = [...this.documents.values()]
        .filter((row) => {
          const haystack = `${row.title} ${row.source_path} ${row.content}`.toLowerCase();
          return row.tenant_id === tenantId && terms.every((term) => haystack.includes(term));
        })
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .slice(0, limit)
        .map(({ id, title }) => ({ id, title }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("tenant_id = $1 AND id = $2")) {
      const [tenantId, id] = params;
      const row = [...this.documents.values()].find((candidate) => candidate.tenant_id === tenantId && candidate.id === id);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("source_path = $2")) {
      const [tenantId, sourcePath] = params;
      const row = this.documents.get(`${tenantId}\0${sourcePath}`);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error(`unexpected_query:${sql}`);
  }
}

function storeWith(pool = new MemoryPool(), options = {}) {
  return { pool, store: createCloudMemoryStore({ databaseUrl: "postgres://memory.test/db" }, { pool, ...options }) };
}

test("project context creates the canonical tenant-scoped logical folder exactly once", async () => {
  const { store } = storeWith();
  const first = await store.ensureProjectContext("tenant-a", {
    project_id: "agent-platform",
    title: "Agent platform",
    objective: "Build a reliable multi-agent workflow.",
  });
  const second = await store.ensureProjectContext("tenant-a", {
    project_id: "agent-platform",
    title: "This must not overwrite the original",
    objective: "This objective must not overwrite the original either.",
  });

  assert.equal(first.created, true);
  assert.equal(first.created_documents.length, 6);
  assert.equal(second.created, false);
  assert.deepEqual(second.created_documents, []);
  assert.equal(second.root_path, "PROJECTS/agent-platform");
  assert.equal(second.manifest.title, "Agent platform");
  assert.equal(second.manifest.objective, "Build a reliable multi-agent workflow.");
  assert.deepEqual(second.documents.map((document) => document.name), PROJECT_CONTEXT_DOCUMENT_NAMES);
  assert.deepEqual(second.documents.map((document) => document.source_path), [
    "PROJECTS/agent-platform/PROJECT.md",
    "PROJECTS/agent-platform/STATE.md",
    "PROJECTS/agent-platform/DECISIONS.md",
    "PROJECTS/agent-platform/EVIDENCE.md",
    "PROJECTS/agent-platform/HANDOFF.md",
  ]);
});

test("project context redacts provider credentials before any canonical document is persisted", async () => {
  const { pool, store } = storeWith();
  const secret = `sk-proj-${"a".repeat(24)}`;
  const project = await store.ensureProjectContext("tenant-a", {
    project_id: "secure-memory",
    title: `Secure ${secret}`,
    objective: `Use token=${secret} only through the provider vault.`,
  });

  const persisted = [...pool.documents.values()].map((row) => `${row.title}\n${row.content}`).join("\n");
  assert.equal(persisted.includes(secret), false);
  assert.equal(JSON.stringify(project).includes(secret), false);
  assert.match(persisted, /\[REDACTED\]/);
  assert(project.documents.some((document) => document.redaction_count > 0));
});

test("project context rejects traversal and malformed identifiers before persistence", async () => {
  const { pool, store } = storeWith();
  for (const project_id of ["../other", "one/two", ".hidden", "x", "project%2fescape"]) {
    await assert.rejects(
      store.ensureProjectContext("tenant-a", { project_id, title: "Title", objective: "Objective" }),
      /project_id_invalid/,
    );
  }
  assert.equal(pool.documents.size, 0);
  assert.throws(() => canonicalProjectContextPaths("../tenant-b"), /project_id_invalid/);
});

test("project context reads remain isolated when tenants reuse the same project id", async () => {
  const { store } = storeWith();
  await store.ensureProjectContext("tenant-a", { project_id: "shared-name", title: "Tenant A", objective: "A only" });
  await store.ensureProjectContext("tenant-b", { project_id: "shared-name", title: "Tenant B", objective: "B only" });

  const tenantA = await store.readProjectContext("tenant-a", "shared-name");
  const tenantB = await store.readProjectContext("tenant-b", "shared-name");
  assert.equal(tenantA.manifest.title, "Tenant A");
  assert.equal(tenantB.manifest.title, "Tenant B");
  assert.equal(JSON.stringify(tenantA).includes("B only"), false);
  assert.equal(JSON.stringify(tenantB).includes("A only"), false);
});

test("project context fails closed when PostgreSQL is absent, unavailable, or incomplete", async () => {
  assert.equal(createCloudMemoryStore({}), null);

  const offlinePool = { query: async () => { throw new Error("database_offline"); } };
  const offline = createCloudMemoryStore({ databaseUrl: "postgres://memory.test/db" }, { pool: offlinePool });
  await assert.rejects(
    offline.ensureProjectContext("tenant-a", { project_id: "offline", title: "Offline", objective: "Must fail" }),
    /database_offline/,
  );

  const { store } = storeWith();
  await assert.rejects(store.readProjectContext("tenant-a", "missing-project"), /project_context_incomplete/);
});

test("generic memory upsert cannot create or overwrite the managed project namespace", async () => {
  const { pool, store } = storeWith();
  await assert.rejects(
    store.upsert("tenant-a", {
      source_path: "PROJECTS/reserved/STATE.md",
      title: "forged",
      text: "forged",
    }),
    /project_context_namespace_reserved/,
  );

  assert.equal(pool.documents.size, 0);

  await store.ensureProjectContext("tenant-a", {
    project_id: "reserved",
    title: "Reserved",
    objective: "Protect canonical state.",
  });
  const stateKey = "tenant-a\0PROJECTS/reserved/STATE.md";
  const originalSha = pool.documents.get(stateKey).content_sha256;
  await assert.rejects(
    store.upsert("tenant-a", {
      source_path: "/PROJECTS/reserved/STATE.md",
      title: "forged",
      text: "forged",
    }),
    /project_context_namespace_reserved/,
  );
  assert.equal(pool.documents.get(stateKey).content_sha256, originalSha);

  await store.recordProjectRunTerminal("tenant-a", terminalRun({
    project_id: "reserved",
    run_id: "run_managed",
    output: "MANAGED_RESULT",
  }));
  const artifactKey = "tenant-a\0PROJECTS/reserved/RUNS/run_managed.md";
  const originalArtifact = pool.documents.get(artifactKey);
  await assert.rejects(
    store.upsert("tenant-a", {
      source_path: "PROJECTS/reserved/RUNS/run_managed.md",
      title: "Overwrite attempt",
      text: "FORGED_OVERWRITE",
    }),
    /project_context_namespace_reserved/,
  );
  assert.equal(pool.documents.get(artifactKey).content_sha256, originalArtifact.content_sha256);
  assert.doesNotMatch(pool.documents.get(artifactKey).content, /MANAGED_RESULT/);
  assert.match(pool.documents.get(artifactKey).content, /output withheld/i);
  assert.doesNotMatch(pool.documents.get(artifactKey).content, /FORGED_OVERWRITE/);

  await assert.rejects(
    store.upsert("tenant-a", {
      source_path: "PROJECTS/reserved/RUNS/run_forged.md",
      title: "Forged run",
      text: "Must be written only by the managed project store.",
    }),
    /project_context_namespace_reserved/,
  );

  const outside = await store.upsert("tenant-a", {
    source_path: "NOTES/manual-note.md",
    title: "Ordinary note",
    text: "Generic memory remains available outside PROJECTS.",
  });
  assert.equal(outside.source_path, "NOTES/manual-note.md");
});

test("ensure fails closed on partial or tampered canonical sets", async () => {
  const partial = storeWith();
  await partial.store.ensureProjectContext("tenant-a", {
    project_id: "partial",
    title: "Partial",
    objective: "Detect partial state.",
  });
  partial.pool.documents.delete("tenant-a\0PROJECTS/partial/HANDOFF.md");
  await assert.rejects(
    partial.store.ensureProjectContext("tenant-a", {
      project_id: "partial",
      title: "Partial",
      objective: "Detect partial state.",
    }),
    /project_context_conflict/,
  );
  assert.equal(partial.pool.documents.has("tenant-a\0PROJECTS/partial/HANDOFF.md"), false);

  for (const mutate of [
    (row) => { row.metadata.document_name = "EVIDENCE.md"; },
    (row) => { row.metadata.project_id = "other-project"; },
    (row) => { row.id = "f".repeat(24); },
    (row) => { row.content_sha256 = "0".repeat(64); },
  ]) {
    const tampered = storeWith();
    await tampered.store.ensureProjectContext("tenant-a", {
      project_id: "tampered",
      title: "Tampered",
      objective: "Validate provenance.",
    });
    mutate(tampered.pool.documents.get("tenant-a\0PROJECTS/tampered/STATE.md"));
    await assert.rejects(
      tampered.store.readProjectContext("tenant-a", "tampered"),
      /project_context_provenance_invalid/,
    );
    await assert.rejects(
      tampered.store.ensureProjectContext("tenant-a", {
        project_id: "tampered",
        title: "Tampered",
        objective: "Validate provenance.",
      }),
      /project_context_provenance_invalid/,
    );
  }
});

function terminalRun(overrides = {}) {
  const projectId = overrides.project_id || "runtime-safe";
  const runId = overrides.run_id || "run_current";
  const status = overrides.status || "completed";
  const output = Object.hasOwn(overrides, "output") ? overrides.output : "Reviewed later by the owner.";
  const outputDigestSha256 = output ? crypto.createHash("sha256").update(output).digest("hex") : undefined;
  return {
    project_id: projectId,
    run_id: runId,
    status,
    output_present: Boolean(output),
    ...(outputDigestSha256 ? { output_digest_sha256: outputDigestSha256 } : {}),
    created_at: overrides.created_at || overrides.started_at || "2026-07-22T11:00:00.000Z",
    started_at: overrides.started_at || "2026-07-22T11:00:00.000Z",
    ...(!Object.hasOwn(overrides, "completed_at") || overrides.completed_at
      ? { completed_at: overrides.completed_at || "2026-07-22T11:01:00.000Z" }
      : {}),
    artifact_title: `${projectId} — ${runId}`,
    artifact_text: `# ${runId}\n\nStatus: ${status}\n\nUNREVIEWED output withheld.\n`,
    state_title: `${projectId} — STATE.md`,
    state_text: `# Project state\n\n- Last multi-agent run: ${runId}\n- Status: ${status}\n`,
    handoff_title: `${projectId} — HANDOFF.md`,
    handoff_text: `# Current handoff\n\n- Run: ${runId}\n- Status: ${status}\n- Output: withheld\n`,
  };
}

async function initializedRuntimeStore() {
  const fixture = storeWith();
  await fixture.store.ensureProjectContext("tenant-a", {
    project_id: "runtime-safe",
    title: "Runtime safe",
    objective: "Keep terminal state monotonic.",
  });
  return fixture;
}

test("terminal persistence is idempotent and a cancel race cannot downgrade completed output", async () => {
  const { pool, store } = await initializedRuntimeStore();
  const completed = await store.recordProjectRunTerminal("tenant-a", terminalRun({
    status: "completed",
    output: "COMPLETE_RESULT",
  }));
  assert.equal(completed.recorded, true);
  assert.equal(completed.state_advanced, true);

  const repeated = await store.recordProjectRunTerminal("tenant-a", terminalRun({
    status: "completed",
    output: "DIFFERENT_RETRY_MUST_NOT_OVERWRITE",
  }));
  assert.equal(repeated.idempotent, true);

  const cancel = await store.recordProjectRunTerminal("tenant-a", terminalRun({
    status: "cancelled",
    output: "CANCEL_RACE_MUST_NOT_OVERWRITE",
  }));
  assert.equal(cancel.idempotent, true);
  const artifact = pool.documents.get("tenant-a\0PROJECTS/runtime-safe/RUNS/run_current.md");
  assert.equal(artifact.metadata.status, "completed");
  assert.equal(artifact.metadata.output_digest_sha256, crypto.createHash("sha256").update("COMPLETE_RESULT").digest("hex"));
  assert.doesNotMatch(artifact.content, /COMPLETE_RESULT/);
  assert.doesNotMatch(artifact.content, /CANCEL_RACE/);

  const project = await store.readProjectContext("tenant-a", "runtime-safe");
  const state = project.documents.find((document) => document.name === "STATE.md");
  const handoff = project.documents.find((document) => document.name === "HANDOFF.md");
  assert.equal(state.metadata.last_run_status, "completed");
  assert.equal(handoff.metadata.last_run_output_digest_sha256, artifact.metadata.output_digest_sha256);
  assert.doesNotMatch(handoff.content, /COMPLETE_RESULT/);
  assert.doesNotMatch(handoff.content, /DIFFERENT_RETRY/);
});

test("historical terminal reads persist their artifact without rewinding project state or handoff", async () => {
  const { pool, store } = await initializedRuntimeStore();
  await store.recordProjectRunTerminal("tenant-a", terminalRun({
    run_id: "run_later",
    started_at: "2026-07-22T12:00:00.000Z",
    completed_at: "2026-07-22T12:01:00.000Z",
    output: "LATEST_RESULT",
  }));
  const historical = await store.recordProjectRunTerminal("tenant-a", terminalRun({
    run_id: "run_older",
    started_at: "2026-07-22T10:00:00.000Z",
    completed_at: "2026-07-22T10:01:00.000Z",
    output: "HISTORICAL_RESULT",
  }));
  assert.equal(historical.recorded, true);
  assert.equal(historical.state_advanced, false);
  assert.equal(pool.documents.has("tenant-a\0PROJECTS/runtime-safe/RUNS/run_older.md"), true);

  const project = await store.readProjectContext("tenant-a", "runtime-safe");
  const state = project.documents.find((document) => document.name === "STATE.md");
  const handoff = project.documents.find((document) => document.name === "HANDOFF.md");
  assert.equal(state.metadata.last_run_id, "run_later");
  assert.equal(
    handoff.metadata.last_run_output_digest_sha256,
    crypto.createHash("sha256").update("LATEST_RESULT").digest("hex"),
  );
  assert.doesNotMatch(handoff.content, /LATEST_RESULT/);
  assert.doesNotMatch(handoff.content, /HISTORICAL_RESULT/);
});

test("a completed callback upgrades an earlier cancellation for the same run", async () => {
  const { store } = await initializedRuntimeStore();
  await store.recordProjectRunTerminal("tenant-a", terminalRun({
    status: "cancelled",
    output: "CANCELLED_FIRST",
  }));
  const completed = await store.recordProjectRunTerminal("tenant-a", terminalRun({
    status: "completed",
    output: "COMPLETED_AFTER_RACE",
  }));
  assert.equal(completed.recorded, true);
  assert.equal(completed.state_advanced, true);
  const project = await store.readProjectContext("tenant-a", "runtime-safe");
  const handoff = project.documents.find((document) => document.name === "HANDOFF.md");
  assert.equal(handoff.metadata.last_run_status, "completed");
  assert.equal(
    handoff.metadata.last_run_output_digest_sha256,
    crypto.createHash("sha256").update("COMPLETED_AFTER_RACE").digest("hex"),
  );
  assert.doesNotMatch(handoff.content, /COMPLETED_AFTER_RACE/);
});

test("a completed result read can enrich a prior output-less completed callback without later downgrade", async () => {
  const { pool, store } = await initializedRuntimeStore();
  const sparseCompleted = await store.recordProjectRunTerminal("tenant-a", terminalRun({
    status: "completed",
    output: "",
  }));
  assert.equal(sparseCompleted.artifact.metadata.output_present, false);
  assert.equal(sparseCompleted.state.metadata.last_run_output_present, false);
  assert.equal(sparseCompleted.handoff.metadata.last_run_output_present, false);
  assert.doesNotMatch(sparseCompleted.artifact.content, /FULL_COMPLETED_OUTPUT/);

  const enriched = await store.recordProjectRunTerminal("tenant-a", terminalRun({
    status: "completed",
    output: "FULL_COMPLETED_OUTPUT",
  }));
  assert.equal(enriched.recorded, true);
  assert.equal(enriched.state_advanced, true);
  assert.equal(enriched.artifact.metadata.output_present, true);
  assert.equal(enriched.state.metadata.last_run_output_present, true);
  assert.equal(enriched.handoff.metadata.last_run_output_present, true);
  const enrichedDigest = crypto.createHash("sha256").update("FULL_COMPLETED_OUTPUT").digest("hex");
  assert.equal(enriched.artifact.metadata.output_digest_sha256, enrichedDigest);
  assert.equal(enriched.handoff.metadata.last_run_output_digest_sha256, enrichedDigest);
  assert.doesNotMatch(enriched.artifact.content, /FULL_COMPLETED_OUTPUT/);
  assert.doesNotMatch(enriched.handoff.content, /FULL_COMPLETED_OUTPUT/);

  const project = await store.readProjectContext("tenant-a", "runtime-safe");
  const state = project.documents.find((document) => document.name === "STATE.md");
  const handoff = project.documents.find((document) => document.name === "HANDOFF.md");
  assert.equal(state.metadata.last_run_id, "run_current");
  assert.equal(state.metadata.last_run_status, "completed");
  assert.equal(state.metadata.last_run_output_present, true);
  assert.equal(handoff.metadata.last_run_output_present, true);
  assert.equal(handoff.metadata.last_run_output_digest_sha256, enrichedDigest);
  assert.doesNotMatch(handoff.content, /FULL_COMPLETED_OUTPUT/);

  const sparseRetry = await store.recordProjectRunTerminal("tenant-a", terminalRun({
    status: "completed",
    output: "",
  }));
  assert.equal(sparseRetry.idempotent, true);
  const afterRetry = await store.readProjectContext("tenant-a", "runtime-safe");
  const artifactAfterRetry = pool.documents.get("tenant-a\0PROJECTS/runtime-safe/RUNS/run_current.md");
  assert.equal(artifactAfterRetry.metadata.output_present, true);
  assert.equal(artifactAfterRetry.metadata.output_digest_sha256, enrichedDigest);
  assert.doesNotMatch(artifactAfterRetry.content, /FULL_COMPLETED_OUTPUT/);
  assert.equal(
    afterRetry.documents.find((document) => document.name === "STATE.md").metadata.last_run_output_present,
    true,
  );
  assert.doesNotMatch(afterRetry.documents.find((document) => document.name === "HANDOFF.md").content, /FULL_COMPLETED_OUTPUT/);
});

test("recent project runs reject forged provenance and exact-metadata deviations", async () => {
  const { pool, store } = await initializedRuntimeStore();
  await store.recordProjectRunTerminal("tenant-a", terminalRun({ output: "TRUSTED_RESULT" }));
  const prefix = "PROJECTS/runtime-safe/RUNS/";
  const valid = await store.listBySourcePrefix("tenant-a", prefix, 3);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].metadata.run_id, "run_current");

  const artifactKey = "tenant-a\0PROJECTS/runtime-safe/RUNS/run_current.md";
  const artifact = pool.documents.get(artifactKey);
  const originalMetadata = structuredClone(artifact.metadata);
  artifact.metadata = { ...originalMetadata, run_id: "run_other" };
  await assert.rejects(
    store.listBySourcePrefix("tenant-a", prefix, 3),
    /project_run_artifact_conflict/,
  );

  artifact.metadata = { ...originalMetadata, forged_extra_field: true };
  await assert.rejects(
    store.listBySourcePrefix("tenant-a", prefix, 3),
    /project_run_artifact_conflict/,
  );

  artifact.metadata = originalMetadata;
  artifact.id = stableMemoryId("tenant-a", "PROJECTS/runtime-safe/RUNS/run_other.md");
  await assert.rejects(
    createProjectContextService(store).read({ tenantId: "tenant-a" }, "runtime-safe"),
    /project_run_artifact_conflict/,
  );
});

test("terminal timestamps fail before insertion and a new run clears stale completion metadata", async () => {
  const { pool, store } = await initializedRuntimeStore();
  await assert.rejects(
    store.recordProjectRunTerminal("tenant-a", terminalRun({
      run_id: "run_invalid_time",
      started_at: "2026-07-22T12:00:00.000Z",
      completed_at: "2026-07-22T11:59:59.000Z",
    })),
    /run_completed_at_invalid/,
  );
  assert.equal(pool.documents.has("tenant-a\0PROJECTS/runtime-safe/RUNS/run_invalid_time.md"), false);

  await store.recordProjectRunTerminal("tenant-a", terminalRun({
    run_id: "run_with_completion",
    started_at: "2026-07-22T12:00:00.000Z",
    completed_at: "2026-07-22T12:01:00.000Z",
  }));
  await store.recordProjectRunTerminal("tenant-a", terminalRun({
    run_id: "run_without_completion",
    created_at: "2026-07-22T13:00:00.000Z",
    started_at: "2026-07-22T13:00:00.000Z",
    completed_at: null,
  }));
  const project = await store.readProjectContext("tenant-a", "runtime-safe");
  for (const name of ["STATE.md", "HANDOFF.md"]) {
    const metadata = project.documents.find((document) => document.name === name).metadata;
    assert.equal(metadata.last_run_id, "run_without_completion");
    assert.equal(Object.hasOwn(metadata, "last_run_completed_at"), false);
  }
});

test("equal start times use causal creation time before the deterministic run-id tie break", async () => {
  const { store } = await initializedRuntimeStore();
  await store.recordProjectRunTerminal("tenant-a", terminalRun({
    run_id: "run_z",
    created_at: "2026-07-22T10:59:58.000Z",
    started_at: "2026-07-22T11:00:00.000Z",
    completed_at: "2026-07-22T11:01:00.000Z",
  }));
  await store.recordProjectRunTerminal("tenant-a", terminalRun({
    run_id: "run_a",
    created_at: "2026-07-22T10:59:59.000Z",
    started_at: "2026-07-22T11:00:00.000Z",
    completed_at: "2026-07-22T11:01:00.000Z",
  }));
  const project = await store.readProjectContext("tenant-a", "runtime-safe");
  assert.equal(project.documents.find((document) => document.name === "STATE.md").metadata.last_run_id, "run_a");
});

test("same-tenant readers never receive owner-only model output through search, fetch, or project context", async () => {
  const sentinel = "OWNER_ONLY_SENTINEL_4F912E_DO_NOT_PERSIST";
  const { pool, store } = storeWith();
  const service = createProjectContextService(store);
  await service.ensure({ tenantId: "tenant-a" }, {
    project_id: "private-output",
    title: "Private output",
    objective: "Keep agent results owner-only until reviewed.",
  });
  await service.recordRun({ tenantId: "tenant-a" }, {
    run: {
      project_id: "private-output",
      run_id: "run_secret_result",
      status: "completed",
      created_at: "2026-07-22T14:00:00.000Z",
      started_at: "2026-07-22T14:00:01.000Z",
      completed_at: "2026-07-22T14:00:02.000Z",
      final_output: sentinel,
      stages: [{ role: "researcher", status: "completed" }, { role: "nyra", status: "completed" }],
    },
  });

  const artifactId = stableMemoryId("tenant-a", "PROJECTS/private-output/RUNS/run_secret_result.md");
  const search = await store.search("tenant-a", sentinel);
  const fetched = await store.fetch("tenant-a", artifactId);
  const context = await service.read({ tenantId: "tenant-a" }, "private-output");
  const persisted = JSON.stringify([...pool.documents.values()]);
  const digest = crypto.createHash("sha256").update(sentinel).digest("hex");

  assert.deepEqual(search, []);
  assert(fetched);
  assert.equal(JSON.stringify(fetched).includes(sentinel), false);
  assert.equal(JSON.stringify(context).includes(sentinel), false);
  assert.equal(persisted.includes(sentinel), false);
  assert.equal(fetched.metadata.output_digest_sha256, digest);
  assert.match(context.context.handoff, new RegExp(digest));
});

async function reviewReadyFixture(projectIdValue = "review-project") {
  const pool = new MemoryPool();
  const { store } = storeWith(pool, { now: () => new Date("2026-07-22T16:00:00.000Z") });
  const service = createProjectContextService(store);
  await service.ensure({ tenantId: "tenant-a" }, {
    project_id: projectIdValue,
    title: "Reviewed project",
    objective: "Carry owner-reviewed decisions into the next governed run.",
  });
  const terminal = await service.recordRun({ tenantId: "tenant-a" }, {
    run: {
      project_id: projectIdValue,
      run_id: "run_reviewed",
      status: "completed",
      created_at: "2026-07-22T15:00:00.000Z",
      started_at: "2026-07-22T15:00:00.000Z",
      completed_at: "2026-07-22T15:01:00.000Z",
      final_output: "UNREVIEWED_MODEL_OUTPUT_SENTINEL",
      stages: [{ role: "researcher", status: "completed" }],
    },
  });
  return { pool, store, service, revision: terminal.revision, projectId: projectIdValue };
}

function acceptedReview(revision, overrides = {}) {
  return {
    project_id: "review-project",
    run_id: "run_reviewed",
    expected_revision: revision,
    disposition: "accept_selected",
    decision_items: [{ decision: "Use bounded project memory.", rationale: "It preserves the logical thread." }],
    evidence_items: [{ claim: "The terminal run completed.", source: "Run artifact run_reviewed." }],
    idempotency_key: "review-001",
    ...overrides,
  };
}

test("owner review commits selected items atomically and exposes them to the next bounded context", async () => {
  const { pool, service, revision } = await reviewReadyFixture();
  const prepared = service.prepareReview(acceptedReview(revision));
  const committed = await service.commitReview({ tenantId: "tenant-a" }, prepared);

  assert.equal(committed.committed, true);
  assert.equal(committed.idempotent, false);
  assert.equal(committed.previous_revision, revision);
  assert.match(committed.revision, /^[a-f0-9]{64}$/);
  assert.notEqual(committed.revision, revision);
  assert.equal(committed.reviewed_at, "2026-07-22T16:00:00.000Z");

  const next = await service.read({ tenantId: "tenant-a" }, "review-project");
  assert.equal(next.context.revision, committed.revision);
  assert.match(next.context.decisions, /Use bounded project memory/);
  assert.match(next.context.evidence, /The terminal run completed/);
  assert.match(next.context.status, /owner reviewed/i);
  assert.match(next.context.handoff, /authenticated project owner review/i);
  assert.equal(JSON.stringify(next).includes("UNREVIEWED_MODEL_OUTPUT_SENTINEL"), false);

  const artifact = pool.documents.get("tenant-a\0PROJECTS/review-project/REVIEWS/review-001.json");
  assert(artifact);
  assert.equal(artifact.metadata.owner_reviewed, true);
  assert.equal(artifact.metadata.revision, committed.revision);
  assert.equal(artifact.content.includes("UNREVIEWED_MODEL_OUTPUT_SENTINEL"), false);
  for (const name of ["DECISIONS.md", "EVIDENCE.md", "STATE.md", "HANDOFF.md"]) {
    const document = pool.documents.get(`tenant-a\0PROJECTS/review-project/${name}`);
    assert.equal(document.metadata.last_review_provenance, "authenticated_owner_review");
    assert.equal(document.metadata.last_review_digest_sha256, prepared.review_digest_sha256);
  }
});

test("owner rejection records provenance without accepting any decision or evidence", async () => {
  const { service, revision } = await reviewReadyFixture();
  const committed = await service.commitReview({ tenantId: "tenant-a" }, service.prepareReview(acceptedReview(revision, {
    disposition: "reject",
    decision_items: [],
    evidence_items: [],
    idempotency_key: "review-reject-001",
  })));
  const next = await service.read({ tenantId: "tenant-a" }, "review-project");
  assert.equal(committed.disposition, "reject");
  assert.match(next.project.documents.find((document) => document.name === "DECISIONS.md").content, /rejected all proposed decisions/i);
  assert.match(next.project.documents.find((document) => document.name === "EVIDENCE.md").content, /rejected all proposed evidence/i);
  assert.doesNotMatch(next.context.decisions, /Use bounded project memory/);
});

test("project review is tenant scoped and requires a terminal run in the same project", async () => {
  const { service, store, revision } = await reviewReadyFixture();
  const prepared = service.prepareReview(acceptedReview(revision));
  await assert.rejects(
    store.commitProjectReview("tenant-b", prepared),
    /project_context_incomplete/,
  );
  await assert.rejects(
    service.commitReview({ tenantId: "tenant-a" }, service.prepareReview(acceptedReview(revision, {
      run_id: "run_missing",
      idempotency_key: "review-missing-run",
    }))),
    /project_review_run_not_found/,
  );
});

test("project review uses revision CAS and supports safe idempotent replay", async () => {
  const { service, revision } = await reviewReadyFixture();
  await assert.rejects(
    service.commitReview({ tenantId: "tenant-a" }, service.prepareReview(acceptedReview("0".repeat(64), {
      idempotency_key: "review-stale-001",
    }))),
    /project_review_revision_conflict/,
  );

  const prepared = service.prepareReview(acceptedReview(revision));
  const first = await service.commitReview({ tenantId: "tenant-a" }, prepared);
  const replay = await service.commitReview({ tenantId: "tenant-a" }, prepared);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.review_id, first.review_id);
  assert.equal(replay.revision, first.revision);
  await assert.rejects(
    service.commitReview({ tenantId: "tenant-a" }, service.prepareReview(acceptedReview(revision, {
      decision_items: [{ decision: "A conflicting decision.", rationale: "The same key cannot be reused." }],
    }))),
    /project_review_idempotency_conflict/,
  );
});

test("review normalization rejects secrets, redaction placeholders and invalid selection shapes", () => {
  const revision = "a".repeat(64);
  const withoutRationale = normalizeProjectReviewInput(acceptedReview(revision, {
    decision_items: [{ decision: "An owner-reviewed decision without a rationale." }],
  }));
  assert.equal(withoutRationale.decision_items[0].rationale, "");
  assert.throws(
    () => normalizeProjectReviewInput(acceptedReview(revision, {
      decision_items: [{ decision: `Use sk-proj-${"x".repeat(24)}`, rationale: "Never persist this." }],
    })),
    /project_review_sensitive_content/,
  );
  assert.throws(
    () => normalizeProjectReviewInput(acceptedReview(revision, {
      evidence_items: [{ claim: "[REDACTED]", source: "Owner note" }],
    })),
    /project_review_sensitive_content/,
  );
  assert.throws(
    () => normalizeProjectReviewInput(acceptedReview(revision, { decision_items: [], evidence_items: [] })),
    /project_review_selection_required/,
  );
  assert.throws(
    () => normalizeProjectReviewInput(acceptedReview(revision, { disposition: "reject" })),
    /project_review_reject_items_invalid/,
  );
  assert.throws(
    () => normalizeProjectReviewInput(acceptedReview(revision, { idempotency_key: `r${"x".repeat(120)}` })),
    /project_review_idempotency_key_invalid/,
  );
});

test("review commit rolls back every canonical document when a later update fails", async () => {
  const { pool, service, revision } = await reviewReadyFixture();
  const before = structuredClone(pool.documents);
  pool.failOnUpdatePath = "PROJECTS/review-project/STATE.md";
  await assert.rejects(
    service.commitReview({ tenantId: "tenant-a" }, service.prepareReview(acceptedReview(revision, {
      idempotency_key: "review-rollback-001",
    }))),
    /forced_update_failure/,
  );
  pool.failOnUpdatePath = null;
  assert.deepEqual(pool.documents, before);
  const after = await service.read({ tenantId: "tenant-a" }, "review-project");
  assert.equal(after.context.revision, revision);
  assert.equal(pool.documents.has("tenant-a\0PROJECTS/review-project/REVIEWS/review-rollback-001.json"), false);
  assert.doesNotMatch(JSON.stringify([...pool.documents.values()]), /Use bounded project memory/);
});
