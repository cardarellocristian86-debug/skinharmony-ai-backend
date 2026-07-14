import assert from "node:assert/strict";
import test from "node:test";
import { attachSharedMemoryBootstrap, createSharedMemoryBootstrap, SHARED_MEMORY_BOOTSTRAP_PATHS } from "../src/shared-memory-bootstrap.js";

function document(sourcePath, content, suffix = "a") {
  return { id: suffix.repeat(24), source_path: sourcePath, content: typeof content === "string" ? content : JSON.stringify(content), content_sha256: suffix.repeat(64), updated_at: "2026-07-14T18:45:29.447Z" };
}

function fixtureRecords() {
  return [
    document("SHARED_MEMORY/STATE.json", { generated_at: "2026-07-14T18:45:29.447Z", active_task_count: 107, active_lock_count: 24 }, "a"),
    document("SHARED_MEMORY/TASKS.json", { count: 107, tasks: [{ contract_id: "task-1", agent_id: "codex", title: "Bootstrap memory", status: "current", updated_at: "2026-07-14T18:45:00Z", source: "SHARED_MEMORY/task-contracts/task-1.json", secret: "must-not-leak" }] }, "b"),
    document("SHARED_MEMORY/LOCKS.json", { count: 24, locks: [] }, "c"),
    document("SHARED_MEMORY/ARTIFACTS.json", { count: 890, artifacts: [{ path: "SHARED_MEMORY/reports/latest.json", size_bytes: 42, modified_at: "2026-07-14T18:44:00Z", sha256: "d".repeat(64), content: "must-not-leak" }] }, "d"),
    document("SHARED_MEMORY/HANDOFF.md", "# Handoff\n\n- `SHARED_MEMORY/handoffs/latest.md` — 2026-07-14T18:43:00Z\n", "e"),
  ];
}

function storeFixture(initialRecords = fixtureRecords()) {
  let records = initialRecords;
  const calls = { inspect: [], fetch: [] };
  return {
    calls,
    setRecords(value) { records = value; },
    async inspectBySourcePaths(tenantId, paths) {
      calls.inspect.push({ tenantId, paths });
      return records.map(({ source_path, content_sha256, updated_at, id }) => ({ source_path, content_sha256, updated_at, id }));
    },
    async fetchBySourcePaths(tenantId, paths) {
      calls.fetch.push({ tenantId, paths });
      return records;
    },
  };
}

test("loads compact canonical bootstrap for the authenticated tenant and invalidates by checksum", async () => {
  let time = 1_000;
  const store = storeFixture();
  const bootstrap = createSharedMemoryBootstrap(store, { cacheTtlMs: 300_000, now: () => time });
  const first = await bootstrap.load({ tenantId: "codexai" });
  const second = await bootstrap.load({ tenantId: "codexai" });
  assert.equal(first.loaded, true);
  assert.equal(first.tenant_id, "codexai");
  assert.equal(first.generated_at, "2026-07-14T18:45:29.447Z");
  assert.equal(first.active_task_count, 107);
  assert.equal(first.active_lock_count, 24);
  assert.equal(first.artifact_count, 890);
  assert.equal(first.cache_ttl_seconds, 300);
  assert.deepEqual(first.latest_handoff, { path: "SHARED_MEMORY/handoffs/latest.md", modified_at: "2026-07-14T18:43:00Z" });
  assert.equal(first.recent_tasks[0].secret, undefined);
  assert.equal(first.recent_artifacts[0].content, undefined);
  assert.equal(store.calls.inspect.length, 2);
  assert.equal(store.calls.fetch.length, 1);
  assert.strictEqual(second, first);
  assert(store.calls.inspect.every((call) => call.tenantId === "codexai"));
  assert(store.calls.inspect.every((call) => call.paths.join("|") === SHARED_MEMORY_BOOTSTRAP_PATHS.join("|")));

  time += 1;
  const changed = fixtureRecords();
  changed[0] = { ...changed[0], content_sha256: "f".repeat(64), content: JSON.stringify({ generated_at: "2026-07-14T19:00:00Z", active_task_count: 108, active_lock_count: 24 }) };
  store.setRecords(changed);
  const refreshed = await bootstrap.load({ tenantId: "codexai" });
  assert.equal(refreshed.generated_at, "2026-07-14T19:00:00Z");
  assert.equal(refreshed.active_task_count, 108);
  assert.equal(store.calls.fetch.length, 2);
});

test("fails closed and lists canonical missing files", async () => {
  const result = await createSharedMemoryBootstrap(storeFixture(fixtureRecords().slice(0, 4))).load({ tenantId: "tenant-a" });
  assert.equal(result.loaded, false);
  assert.deepEqual(result.missing_files, ["SHARED_MEMORY/HANDOFF.md"]);
  const payload = attachSharedMemoryBootstrap({ work_preflight: { state: "ready", governance: { execution_allowed_by_preflight: true } } }, result);
  assert.equal(payload.work_preflight.state, "shared_memory_bootstrap_required");
  assert.equal(payload.work_preflight.governance.execution_allowed_by_preflight, false);
});

test("keeps cache isolated by tenant", async () => {
  const store = storeFixture();
  const bootstrap = createSharedMemoryBootstrap(store);
  await bootstrap.load({ tenantId: "tenant-a" });
  await bootstrap.load({ tenantId: "tenant-b" });
  assert.deepEqual(store.calls.fetch.map((call) => call.tenantId), ["tenant-a", "tenant-b"]);
});
