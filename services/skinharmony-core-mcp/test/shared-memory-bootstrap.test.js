import assert from "node:assert/strict";
import test from "node:test";
import { attachSharedMemoryBootstrap, createSharedMemoryBootstrap, SHARED_MEMORY_BOOTSTRAP_PATHS } from "../src/shared-memory-bootstrap.js";

function document(sourcePath, content, suffix = "a") {
  return { id: suffix.repeat(24), source_path: sourcePath, content: typeof content === "string" ? content : JSON.stringify(content), content_sha256: suffix.repeat(64), updated_at: "2026-07-14T18:45:29.447Z" };
}

function fixtureRecords(tenant = "codexai") {
  return [
    document("SHARED_MEMORY/INDEX.md", "# Shared memory", "1"),
    document("SHARED_MEMORY/STATE.json", { tenant, generated_at: "2026-07-14T18:45:29.447Z", active_task_count: 1, active_lock_count: 1 }, "a"),
    document("SHARED_MEMORY/TASKS.json", { tenant, count: 1, tasks: [{ contract_id: "task-1", trace_id: "trace-task-1", agent_id: "codex", session_id: "session-codex", agent_signature: "ags_fixture", session_fingerprint: "fingerprint-fixture", title: "Bootstrap memory", status: "current", updated_at: "2026-07-14T18:45:00Z", source: "SHARED_MEMORY/task-contracts/task-1.json", secret: "must-not-leak" }] }, "b"),
    document("SHARED_MEMORY/LOCKS.json", { tenant, count: 1, locks: [{ name: "bootstrap-lock", trace_id: "trace-task-1", agent_id: "codex", session_id: "session-codex", agent_signature: "ags_fixture", session_fingerprint: "fingerprint-fixture", acquired_at: "2026-07-14T18:44:30Z", source: "SHARED_MEMORY/LOCKS.json" }] }, "c"),
    document("SHARED_MEMORY/ARTIFACTS.json", { tenant, count: 1, artifacts: [{ path: "SHARED_MEMORY/reports/latest.json", size_bytes: 42, modified_at: "2026-07-14T18:44:00Z", sha256: "d".repeat(64), content: "must-not-leak" }] }, "d"),
    document("SHARED_MEMORY/HANDOFF.md", "# Handoff\n\n- `SHARED_MEMORY/handoffs/latest.md` — 2026-07-14T18:43:00Z\n", "e"),
    document("SHARED_MEMORY/handoffs/MCP_STAGING_MULTI_SESSION_COORDINATION_2026-07-21.md", "# MCP staging coordination", "2"),
    document("SHARED_MEMORY/snapshots/WORK_SNAPSHOT.md", "# Work snapshot", "3"),
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
      const selected = typeof records === "function" ? records(tenantId) : records;
      return selected.map(({ source_path, content_sha256, updated_at, id }) => ({ source_path, content_sha256, updated_at, id }));
    },
    async fetchBySourcePaths(tenantId, paths) {
      calls.fetch.push({ tenantId, paths });
      return typeof records === "function" ? records(tenantId) : records;
    },
  };
}

test("loads compact canonical bootstrap for the authenticated tenant and invalidates by checksum", async () => {
  let time = 1_000;
  const store = storeFixture();
  const bootstrap = createSharedMemoryBootstrap(store, { cacheTtlMs: 300_000, now: () => time });
  const identity = { tenantId: "codexai", agentPresence: { agent_id: "codex", session_id: "session-codex", signature: "ags_fixture", session_fingerprint: "fingerprint-fixture" } };
  const first = await bootstrap.load(identity);
  const second = await bootstrap.load(identity);
  assert.equal(first.loaded, true);
  assert.equal(first.tenant_id, "codexai");
  assert.equal(first.generated_at, "2026-07-14T18:45:29.447Z");
  assert.equal(first.active_task_count, 1);
  assert.equal(first.active_lock_count, 1);
  assert.equal(first.artifact_count, 1);
  assert.equal(first.task_contract.contract_id, "task-1");
  assert.equal(first.coordination_lock.name, "bootstrap-lock");
  assert.equal(first.cache_ttl_seconds, 300);
  assert.deepEqual(first.latest_handoff, { path: "SHARED_MEMORY/handoffs/latest.md", modified_at: "2026-07-14T18:43:00Z" });
  assert.equal(first.recent_tasks[0].secret, undefined);
  assert.equal(first.recent_artifacts[0].content, undefined);
  assert.equal(store.calls.inspect.length, 2);
  assert.equal(store.calls.fetch.length, 1);
  assert.strictEqual(second, first);
  assert(store.calls.inspect.every((call) => call.tenantId === "codexai"));
  assert(store.calls.inspect.every((call) => call.paths.join("|") === SHARED_MEMORY_BOOTSTRAP_PATHS.join("|")));
  const attacker = await bootstrap.load({
    tenantId: "codexai",
    agentPresence: { ...identity.agentPresence, signature: "ags_other", session_fingerprint: "fingerprint-other" },
  });
  assert.equal(attacker.loaded, true);
  assert.equal(attacker.task_contract, null);
  assert.equal(attacker.coordination_lock, null);
  assert.equal(store.calls.fetch.length, 2);

  time += 1;
  const changed = fixtureRecords();
  changed[1] = { ...changed[1], content_sha256: "f".repeat(64), content: JSON.stringify({ tenant: "codexai", generated_at: "2026-07-14T19:00:00Z", active_task_count: 1, active_lock_count: 1 }) };
  store.setRecords(changed);
  const refreshed = await bootstrap.load(identity);
  assert.equal(refreshed.generated_at, "2026-07-14T19:00:00Z");
  assert.equal(refreshed.active_task_count, 1);
  assert.equal(store.calls.fetch.length, 3);
});

test("live PostgreSQL coordination changes invalidate the identity cache and override the snapshot", async () => {
  const identity = {
    tenantId: "codexai",
    agentPresence: {
      agent_id: "codex",
      session_id: "session-codex",
      signature: "ags_fixture",
      session_fingerprint: "fingerprint-fixture",
    },
  };
  let liveBinding = null;
  const store = storeFixture();
  store.findCoordinationBinding = async () => liveBinding;
  const bootstrap = createSharedMemoryBootstrap(store);
  const snapshot = await bootstrap.load(identity);
  assert.equal(snapshot.coordination_binding_source, "canonical_snapshot");
  assert.equal(snapshot.task_contract.contract_id, "task-1");

  liveBinding = {
    taskContract: {
      contract_id: "11111111-1111-4111-8111-111111111111",
      trace_id: "33333333-3333-4333-8333-333333333333",
      agent_id: "codex",
      session_id: "session-codex",
      agent_signature: "ags_fixture",
      session_fingerprint: "fingerprint-fixture",
      title: "Live PostgreSQL task",
      status: "current",
      updated_at: "2026-07-22T10:00:00.000Z",
      source: "postgres:agent_tasks",
    },
    coordinationLock: null,
  };
  const live = await bootstrap.load(identity);
  assert.equal(live.coordination_binding_source, "postgres");
  assert.equal(live.task_contract.contract_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(live.coordination_lock, null);
  assert.equal(store.calls.fetch.length, 2);

  liveBinding = {
    ...liveBinding,
    taskContract: { ...liveBinding.taskContract, agent_signature: "ags_attacker" },
  };
  await assert.rejects(bootstrap.load(identity), /shared_memory_bootstrap_live_binding_invalid/);
});

test("fails closed and lists canonical missing files", async () => {
  const records = fixtureRecords().filter((record) => record.source_path !== "SHARED_MEMORY/HANDOFF.md");
  const result = await createSharedMemoryBootstrap(storeFixture(records)).load({ tenantId: "tenant-a" });
  assert.equal(result.loaded, false);
  assert.deepEqual(result.missing_files, ["SHARED_MEMORY/HANDOFF.md"]);
  const payload = attachSharedMemoryBootstrap({ work_preflight: { state: "ready", governance: { execution_allowed_by_preflight: true } } }, result);
  assert.equal(payload.work_preflight.state, "shared_memory_bootstrap_required");
  assert.equal(payload.work_preflight.governance.execution_allowed_by_preflight, false);
});

test("rejects inconsistent counts and tenant metadata before exposing a contract", async () => {
  const inconsistent = fixtureRecords();
  inconsistent[3] = {
    ...inconsistent[3],
    content: JSON.stringify({ tenant: "codexai", count: 2, locks: [] }),
  };
  await assert.rejects(
    createSharedMemoryBootstrap(storeFixture(inconsistent)).load({ tenantId: "codexai" }),
    /shared_memory_bootstrap_inconsistent:locks/,
  );

  const wrongTenant = fixtureRecords();
  wrongTenant[2] = {
    ...wrongTenant[2],
    content: JSON.stringify({ tenant: "other-tenant", count: 0, tasks: [] }),
  };
  await assert.rejects(
    createSharedMemoryBootstrap(storeFixture(wrongTenant)).load({ tenantId: "codexai" }),
    /shared_memory_bootstrap_tenant_mismatch/,
  );
});

test("fails closed when canonical documents change between manifest and fetch", async () => {
  const records = fixtureRecords();
  const store = {
    async inspectBySourcePaths() {
      return records.map(({ source_path, content_sha256, updated_at, id }) => ({ source_path, content_sha256, updated_at, id }));
    },
    async fetchBySourcePaths() {
      return records.map((record, index) => index === 1
        ? { ...record, content_sha256: "f".repeat(64) }
        : record);
    },
  };
  const result = await createSharedMemoryBootstrap(store).load({ tenantId: "codexai" });
  assert.equal(result.loaded, false);
  assert.equal(result.reason, "shared_memory_bootstrap_changed_during_load");
});

test("keeps cache isolated by tenant", async () => {
  const store = storeFixture((tenantId) => fixtureRecords(tenantId));
  const bootstrap = createSharedMemoryBootstrap(store);
  await bootstrap.load({ tenantId: "tenant-a" });
  await bootstrap.load({ tenantId: "tenant-b" });
  assert.deepEqual(store.calls.fetch.map((call) => call.tenantId), ["tenant-a", "tenant-b"]);
});
