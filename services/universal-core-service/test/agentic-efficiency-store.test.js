import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  agenticEfficiencyMigrationPlan,
  createAgenticEfficiencyPostgresStore,
} from "../src/agenticEfficiencyStore.js";

const NOW = new Date("2026-07-27T20:00:00.000Z");
const RECEIPT = `sha256:${"a".repeat(64)}`;
const ARTIFACT = `sha256:${"b".repeat(64)}`;

function capsule(overrides = {}) {
  return {
    goal: "Persist a resumable bounded checkpoint",
    scope: ["services/universal-core-service"],
    success_criteria: ["restart-resumes"],
    decisions: [],
    completed: [],
    open_risks: [],
    relevant_files: ["services/universal-core-service/src/agenticEfficiencyStore.js"],
    changed_files: ["services/universal-core-service/src/agenticEfficiencyStore.js"],
    diff_summary: "Additive tenant-bound store",
    test_state: { passed: 0, failed: 0, pending: 1 },
    artifact_hashes: [ARTIFACT],
    reusable_results: [],
    next_action: "Resume the focused test",
    budget: { token_limit: 10_000, invocation_limit: 4, retry_limit: 2 },
    created_at: "2026-07-27T19:59:00.000Z",
    expires_at: "2026-07-27T22:00:00.000Z",
    ...overrides,
  };
}

class FakePostgresPool {
  constructor() {
    this.calls = [];
    this.capsules = new Map();
    this.migrationAudit = [];
  }

  async connect() {
    return { query: this.query.bind(this), release() {} };
  }

  async query(query, params = []) {
    const sql = String(query).replace(/\s+/g, " ").trim();
    this.calls.push({ sql, params });
    if (
      ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)
      || sql.startsWith("CREATE ")
      || sql.startsWith("ALTER ")
      || sql.startsWith("DO $role$")
      || sql.startsWith("GRANT ")
      || sql.startsWith("UPDATE agentic_governance.agentic_work_capsule SET expires_at=")
      || sql.startsWith("SET LOCAL ROLE ")
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SELECT current_user::text AS current_user")) {
      return {
        rows: [{
          current_user: "agentic_runtime",
          session_user: "governance_service_owner",
          schema_usage: true,
          capsule_ready: true,
          artifact_ready: true,
          usage_ready: true,
          comparison_ready: true,
        }],
        rowCount: 1,
      };
    }
    if (sql.startsWith("SELECT state FROM agentic_governance.agentic_schema_migration_audit")) {
      return { rows: [{ state: "active" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO agentic_governance.agentic_schema_migration_audit")) {
      this.migrationAudit.push({
        version: params[0],
        state: sql.includes("'disabled'") ? "disabled" : "active",
        actor: params[2],
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO agentic_governance.agentic_work_capsule")) {
      const [capsuleId, tenantId, capsuleHash, capsuleJson, expiresAt, actor, receipt, timestamp] = params;
      const key = `${tenantId}:${capsuleId}`;
      const current = this.capsules.get(key);
      if (current) return { rows: [], rowCount: 0 };
      const row = {
        capsule_id: capsuleId,
        tenant_id: tenantId,
        version: current ? current.version + 1 : 1,
        capsule_hash: capsuleHash,
        capsule: JSON.parse(capsuleJson),
        expires_at: expiresAt,
        actor_provenance: actor,
        receipt_digest: receipt,
        lease_owner: current?.lease_owner || null,
        lease_expires_at: current?.lease_expires_at || null,
        created_at: current?.created_at || timestamp,
        updated_at: timestamp,
      };
      this.capsules.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE agentic_governance.agentic_work_capsule SET version=version+1")) {
      const [tenantId, capsuleId, capsuleHash, capsuleJson, expiresAt, actor, receipt, timestamp, expected] = params;
      const key = `${tenantId}:${capsuleId}`;
      const current = this.capsules.get(key);
      if (!current || current.version !== expected) return { rows: [], rowCount: 0 };
      const row = {
        ...current,
        version: current.version + 1,
        capsule_hash: capsuleHash,
        capsule: JSON.parse(capsuleJson),
        expires_at: expiresAt,
        actor_provenance: actor,
        receipt_digest: receipt,
        updated_at: timestamp,
      };
      this.capsules.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT * FROM agentic_governance.agentic_work_capsule")) {
      const [tenantId, capsuleId] = params;
      const row = this.capsules.get(`${tenantId}:${capsuleId}`);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE agentic_governance.agentic_work_capsule SET lease_owner=$3")) {
      const [tenantId, capsuleId, claimant, expires, timestamp] = params;
      const key = `${tenantId}:${capsuleId}`;
      const row = this.capsules.get(key);
      if (!row) return { rows: [], rowCount: 0 };
      const leaseActive = row.lease_owner && Date.parse(row.lease_expires_at) > Date.parse(timestamp);
      if (leaseActive && row.lease_owner !== claimant) return { rows: [], rowCount: 0 };
      Object.assign(row, { lease_owner: claimant, lease_expires_at: expires, updated_at: timestamp });
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE agentic_governance.agentic_work_capsule SET lease_owner=NULL")) {
      const [tenantId, capsuleId, claimant, timestamp] = params;
      const row = this.capsules.get(`${tenantId}:${capsuleId}`);
      if (!row || row.lease_owner !== claimant) return { rows: [], rowCount: 0 };
      Object.assign(row, { lease_owner: null, lease_expires_at: null, updated_at: timestamp });
      return { rows: [{ capsule_id: capsuleId }], rowCount: 1 };
    }
    throw new Error(`unexpected_fake_query:${sql}`);
  }
}

test("migration is additive, defines the eight required structures and rollback preserves audit", () => {
  const migration = agenticEfficiencyMigrationPlan();
  const joined = readFileSync(
    new URL("../migrations/0.16.0-agentic-efficiency.up.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "agentic_run_budget",
    "agentic_usage_ledger",
    "agentic_work_capsule",
    "agentic_artifact_reuse",
    "agentic_efficiency_baseline",
    "agentic_efficiency_comparison",
    "agentic_savings_claim",
    "agentic_rate_card_snapshot",
  ]) {
    assert(joined.includes(table), `missing table ${table}`);
  }
  assert.equal(migration.additive, true);
  assert.equal(migration.rollback_safe, true);
  assert.equal(migration.preserves_audit, true);
  assert.equal(migration.creates_database, false);
  assert.equal(migration.creates_service, false);
  assert.equal(migration.runtime_ddl, false);
  assert.equal(migration.migration_artifact, "migrations/0.16.0-agentic-efficiency.up.sql");
  assert.equal(joined.includes("DROP "), false);
  assert(joined.includes("CREATE ROLE nyra_agentic_runtime_v016 NOLOGIN"));
  assert.equal(joined.includes("PASSWORD"), false);
});

test("store fails closed without the isolated governance database URL", () => {
  assert.throws(() => createAgenticEfficiencyPostgresStore({}), /governed_agent_database_url_invalid/);
});

test("fake-pool migration, checkpoint restart, tenant isolation and duplicate claim are enforced", async () => {
  const pool = new FakePostgresPool();
  const options = {
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(NOW),
    runtimeRole: "agentic_runtime",
    roleSeparationAttested: false,
  };
  const first = createAgenticEfficiencyPostgresStore(options);
  const initialized = await first.initialize({
    actor_provenance: "core:migration-test",
    rollback_reference: "git:rollback",
  });
  assert.equal(initialized.initialized, true);
  assert(pool.calls.some(({ sql }) => sql.startsWith(
    "SELECT state FROM agentic_governance.agentic_schema_migration_audit",
  )));
  assert.equal(pool.calls.some(({ sql }) => /^(?:CREATE|ALTER|DO \\$role\\$|GRANT )/.test(sql)), false);

  const saved = await first.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-1",
    capsule: capsule(),
    expected_version: 0,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });
  assert.equal(saved.version, 1);

  await first.claimWork({
    tenant_id: "tenant-a",
    capsule_id: "task-1",
    claimant_id: "agent-a",
    lease_ms: 60_000,
  });
  await assert.rejects(
    first.claimWork({
      tenant_id: "tenant-a",
      capsule_id: "task-1",
      claimant_id: "agent-b",
      lease_ms: 60_000,
    }),
    /duplicate_execution_blocked/,
  );

  const restarted = createAgenticEfficiencyPostgresStore(options);
  const resumed = await restarted.getWorkCapsule({ tenant_id: "tenant-a", capsule_id: "task-1" });
  assert.equal(resumed.capsule.next_action, "Resume the focused test");
  assert.equal(resumed.version, 1);
  assert.equal(await restarted.getWorkCapsule({ tenant_id: "tenant-b", capsule_id: "task-1" }), null);

  const rollback = await restarted.rollbackMigration({
    actor_provenance: "core:rollback-test",
    rollback_reference: "git:rollback",
  });
  assert.equal(rollback.data_dropped, false);
  assert.equal(rollback.audit_preserved, true);
  assert.equal(pool.capsules.size, 1);
  assert(pool.migrationAudit.some((entry) => entry.state === "disabled"));
});

test("optimistic concurrency supports create-update and rejects stale capsule versions", async () => {
  const pool = new FakePostgresPool();
  const store = createAgenticEfficiencyPostgresStore({
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(NOW),
    runtimeRole: "agentic_runtime",
    roleSeparationAttested: false,
  });
  await store.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-2",
    capsule: capsule(),
    expected_version: 0,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });
  const updated = await store.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-2",
    capsule: capsule({ next_action: "Second revision" }),
    expected_version: 1,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.capsule.next_action, "Second revision");

  await assert.rejects(
    store.saveWorkCapsule({
      tenant_id: "tenant-a",
      capsule_id: "task-2",
      capsule: capsule({ next_action: "Stale revision" }),
      expected_version: 1,
      actor_provenance: "agent-a",
      receipt_digest: RECEIPT,
    }),
    /work_capsule_revision_conflict/,
  );
});

test("an exact expired capsule can be verified and CAS-refreshed after restart", async () => {
  const pool = new FakePostgresPool();
  let clock = new Date("2026-07-27T20:00:00.000Z");
  const options = {
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(clock),
    runtimeRole: "agentic_runtime",
    roleSeparationAttested: false,
  };
  const first = createAgenticEfficiencyPostgresStore(options);
  await first.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-expiry",
    capsule: capsule({ expires_at: "2026-07-27T20:01:00.000Z" }),
    expected_version: 0,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });

  clock = new Date("2026-07-27T20:02:00.000Z");
  const restarted = createAgenticEfficiencyPostgresStore(options);
  await assert.rejects(
    restarted.getWorkCapsule({ tenant_id: "tenant-a", capsule_id: "task-expiry" }),
    /work_capsule_stale/,
  );
  const expired = await restarted.getWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-expiry",
    allow_expired: true,
  });
  assert.equal(expired.version, 1);
  const refreshed = await restarted.saveWorkCapsule({
    tenant_id: "tenant-a",
    capsule_id: "task-expiry",
    capsule: capsule({
      created_at: "2026-07-27T20:02:00.000Z",
      expires_at: "2026-07-27T21:02:00.000Z",
    }),
    expected_version: expired.version,
    actor_provenance: "agent-a",
    receipt_digest: RECEIPT,
  });
  assert.equal(refreshed.version, 2);
  assert.equal(
    (await restarted.getWorkCapsule({
      tenant_id: "tenant-a",
      capsule_id: "task-expiry",
    })).capsule.expires_at,
    "2026-07-27T21:02:00.000Z",
  );
});

test("runtime writes fail closed until a pre-existing separated role is attested", async () => {
  const pool = new FakePostgresPool();
  const store = createAgenticEfficiencyPostgresStore({
    connectionString: "postgres://governance:masked@localhost:5432/nyra",
    pool,
    now: () => new Date(NOW),
  });
  assert.equal(store.roleSeparationStatus().attested, false);
  assert.equal(store.roleSeparationStatus().runtime_role_configured, false);
  assert.equal(store.roleSeparationStatus().writes_allowed, false);
  await assert.rejects(
    store.saveWorkCapsule({
      tenant_id: "tenant-a",
      capsule_id: "task-role",
      capsule: capsule(),
      expected_version: 0,
      actor_provenance: "agent-a",
      receipt_digest: RECEIPT,
    }),
    /agentic_runtime_role_attestation_failed/,
  );
});
