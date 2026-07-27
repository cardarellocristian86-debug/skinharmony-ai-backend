import assert from "node:assert/strict";
import test from "node:test";
import { createCollaborationHandlers } from "../src/collaboration-handlers.js";
import { createCoreWriteGuard } from "../src/core-handlers.js";
import { createMemoryFabric } from "../src/memory-fabric.js";
import { createSharedMemoryPostgresStore, pathsOverlap, requestDigest } from "../src/shared-memory-postgres-store.js";
import { TOOLS } from "../src/tool-definitions.js";
import { configureToolForRuntime, coordinationGovernanceContext } from "../src/app.js";

const identity = {
  tenantId: "tenant-a",
  subject: "subject-a",
  kind: "codex",
  agentPresence: {
    agent_id: "codex-a",
    opaque_agent_id: "ai_0123456789abcdef01234567",
    signature: "ags_0123456789abcdef0123456789abcdef",
    signature_version: "v1",
    session_fingerprint: "0123456789abcdef01234567",
    session_id: "session-a",
    client_type: "codex",
  },
};

const config = {
  collaborationDatabaseUrl: "postgresql://unused.example/test",
  collaborationDatabaseSsl: false,
  collaborationLocksRequired: true,
  collaborationIdempotencyRequired: true,
  collaborationLockLeaseSeconds: 60,
  databasePoolMax: 2,
  memoryRetentionDays: 30,
  personalMemoryRetentionDays: 7,
};

function emptyResult(rows = []) {
  return { rows, rowCount: rows.length };
}

class FakeClient {
  constructor(handler) {
    this.handler = handler;
    this.calls = [];
    this.released = false;
  }

  async query(sql, params = []) {
    this.calls.push({ sql, params });
    return this.handler(sql, params);
  }

  release() {
    this.released = true;
  }
}

class FakePool {
  constructor(handler = () => emptyResult(), poolHandler = () => emptyResult()) {
    this.calls = [];
    this.client = new FakeClient(handler);
    this.poolHandler = poolHandler;
    this.connectCount = 0;
  }

  async query(sql, params = []) {
    this.calls.push({ sql, params });
    return this.poolHandler(sql, params);
  }

  async connect() {
    this.connectCount += 1;
    return this.client;
  }
}

test("path overlap covers equal, parent and child resources only", () => {
  assert.equal(pathsOverlap("reports", "reports"), true);
  assert.equal(pathsOverlap("reports", "reports/run.md"), true);
  assert.equal(pathsOverlap("reports/run.md", "reports"), true);
  assert.equal(pathsOverlap("reports-a", "reports"), false);
  assert.equal(pathsOverlap("reports/run.md", "snapshots/run.md"), false);
});

test("canonical request digests ignore object key order", () => {
  assert.equal(requestDigest({ b: 2, a: { y: 2, x: 1 } }), requestDigest({ a: { x: 1, y: 2 }, b: 2 }));
  assert.notEqual(requestDigest({ a: 1 }), requestDigest({ a: 2 }));
});

test("initialization declares the complete tenant-scoped PostgreSQL coordination schema", async () => {
  const pool = new FakePool();
  const store = createSharedMemoryPostgresStore(config, { pool, govern: async () => ({ allowed: true }) });
  await store.initialize();
  assert.equal(pool.calls.length, 1);
  const ddl = pool.calls[0].sql;
  for (const table of [
    "mcp_workspace_documents",
    "mcp_workspace_document_versions",
    "mcp_workspace_lock_leases",
    "mcp_memory_records",
    "mcp_memory_handoffs",
    "mcp_collaboration_idempotency",
    "mcp_coordination_events",
  ]) assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS mcp_collaboration_control\.consumed_receipts/);
  assert.match(ddl, /SECURITY DEFINER/);
  assert.match(ddl, /PRIMARY KEY \(tenant_id, document_id, version\)/);
  assert.match(ddl, /mcp_workspace_fencing_seq/);
  assert.doesNotMatch(ddl, /DATABASE_URL|password|authorization\s*:/i);
});

test("a denied Core gate fails before opening a database transaction", async () => {
  const pool = new FakePool();
  const store = createSharedMemoryPostgresStore(config, { pool, govern: async () => ({ allowed: false }) });
  await assert.rejects(store.createFolder({
    path: "reports",
    idempotency_key: "folder-denied-1",
    lock_id: "11111111-1111-4111-8111-111111111111",
    fencing_token: 1,
  }, identity), /core_gate_denied/);
  assert.equal(pool.connectCount, 0);
});

test("folder creation supports an explicitly lock-free runtime without an empty UUID", async () => {
  const pool = new FakePool((sql, params) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return emptyResult();
    if (sql.includes("pg_advisory_xact_lock")) return emptyResult([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) return emptyResult([{ state: "pending" }]);
    if (sql.includes("SELECT 1 FROM agent_presence")) return emptyResult([{ ok: 1 }]);
    if (sql.includes("SELECT 1 FROM mcp_workspace_lock_leases")) throw new Error("unexpected_lock_ownership_check");
    if (sql.includes("SELECT lock_id FROM mcp_workspace_lock_leases")) {
      assert.equal(params[2], null);
      return emptyResult();
    }
    if (sql.includes("SELECT 1 FROM mcp_workspace_documents")) return emptyResult();
    if (sql.includes("INSERT INTO mcp_workspace_folders")) return emptyResult([{
      id: params[1], path: "reports", version: 1, created_at: new Date().toISOString(), created_by: "subject-a", created: true,
    }]);
    if (sql.includes("INSERT INTO mcp_workspace_heads")) return emptyResult([{ revision: "1" }]);
    if (sql.includes("UPDATE mcp_collaboration_idempotency")) return emptyResult([{ state: "completed" }]);
    if (sql.includes("INSERT INTO mcp_coordination_events")) return emptyResult([{ id: 1 }]);
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore({ ...config, collaborationLocksRequired: false }, {
    pool,
    govern: async () => ({ allowed: true, decision: "allow" }),
  });
  const response = await store.createFolder({ path: "reports", idempotency_key: "folder-unlocked-1" }, identity);
  assert.equal(response.structuredContent.created, true);
  await assert.rejects(store.writeDocument({
    path: "reports/unsafe.md",
    content: "unsafe fence",
    expected_version: 0,
    idempotency_key: "write-unpaired-fence-1",
    fencing_token: 99,
  }, identity), /workspace_lock_pair_required/);
});

test("workspace rejects a folder and document sharing the same tenant path", async () => {
  const pool = new FakePool((sql) => {
    if (/^(BEGIN|ROLLBACK)$/.test(sql)) return emptyResult();
    if (sql.includes("pg_advisory_xact_lock")) return emptyResult([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) return emptyResult([{ state: "pending" }]);
    if (sql.includes("SELECT 1 FROM agent_presence")) return emptyResult([{ ok: 1 }]);
    if (sql.includes("SELECT 1 FROM mcp_workspace_lock_leases")) return emptyResult([{ ok: 1 }]);
    if (sql.includes("SELECT lock_id FROM mcp_workspace_lock_leases")) return emptyResult();
    if (sql.includes("SELECT 1 FROM mcp_workspace_documents")) return emptyResult([{ ok: 1 }]);
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore(config, { pool, govern: async () => ({ allowed: true }) });
  await assert.rejects(store.createFolder({
    path: "reports",
    idempotency_key: "folder-collision-1",
    lock_id: "11111111-1111-4111-8111-111111111111",
    fencing_token: 1,
  }, identity), /workspace_path_type_conflict/);
  assert.ok(pool.client.calls.some(({ sql }) => sql === "ROLLBACK"));
});

test("lock acquisition is transactional, tenant-scoped and returns a fencing token", async () => {
  const expires = new Date(Date.now() + 60_000).toISOString();
  const taskTrace = "33333333-3333-4333-8333-333333333333";
  const pool = new FakePool((sql, params) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return emptyResult();
    if (sql.includes("pg_advisory_xact_lock")) return emptyResult([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) return emptyResult([{ state: "pending" }]);
    if (sql.includes("SELECT 1 FROM agent_presence")) return emptyResult([{ ok: 1 }]);
    if (sql.includes("SELECT task.trace_id::text AS trace_id")) return emptyResult([{ trace_id: taskTrace }]);
    if (sql.includes("SELECT lock_id,resource_path")) return emptyResult();
    if (sql.includes("INSERT INTO mcp_workspace_lock_leases")) {
      assert.equal(params[7], taskTrace);
      return emptyResult([{
        tenant_id: "tenant-a",
        lock_id: "11111111-1111-4111-8111-111111111111",
        resource_path: "reports/run.md",
        mode: "exclusive",
        owner_agent_id: "codex-a",
        fencing_token: "17",
        trace_id: taskTrace,
        version: 1,
        acquired_at: new Date().toISOString(),
        renewed_at: new Date().toISOString(),
        lease_expires_at: expires,
        released_at: null,
      }]);
    }
    if (sql.includes("UPDATE mcp_collaboration_idempotency")) return emptyResult([{ state: "completed" }]);
    if (sql.includes("INSERT INTO mcp_coordination_events")) return emptyResult([{ id: 1 }]);
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore(config, { pool, govern: async () => ({ allowed: true, decision: "allow", mediation: "controlled" }) });
  const result = await store.acquireLock({ path: "reports/run.md", idempotency_key: "lock-run-1" }, identity);
  assert.equal(result.structuredContent.lock.fencing_token, 17);
  assert.equal(result.structuredContent.lock.active, true);
  assert.equal(result.structuredContent.gate.allowed, true);
  assert.equal(pool.client.released, true);
  assert.ok(pool.client.calls.some(({ sql, params }) => sql.includes("pg_advisory_xact_lock") && params[0].includes("tenant-a")));
  assert.ok(pool.client.calls.some(({ sql }) => sql === "COMMIT"));
});

test("lock acquisition fails closed without exactly one active task lease", async () => {
  const pool = new FakePool((sql) => {
    if (/^(BEGIN|ROLLBACK)$/.test(sql)) return emptyResult();
    if (sql.includes("pg_advisory_xact_lock")) return emptyResult([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) return emptyResult([{ state: "pending" }]);
    if (sql.includes("SELECT 1 FROM agent_presence")) return emptyResult([{ ok: 1 }]);
    if (sql.includes("SELECT task.trace_id::text AS trace_id")) return emptyResult();
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore(config, {
    pool,
    govern: async () => ({ allowed: true, decision: "allow" }),
  });
  await assert.rejects(
    store.acquireLock({ path: "reports/run.md", idempotency_key: "lock-without-task-1" }, identity),
    /workspace_lock_task_lease_required/,
  );
  assert.equal(pool.client.calls.some(({ sql }) => sql.includes("INSERT INTO mcp_workspace_lock_leases")), false);
  assert.ok(pool.client.calls.some(({ sql }) => sql === "ROLLBACK"));
});

test("live coordination binding is identity-, task- and trace-scoped", async () => {
  const taskTrace = "33333333-3333-4333-8333-333333333333";
  const updatedAt = new Date().toISOString();
  const acquiredAt = new Date().toISOString();
  const pool = new FakePool(undefined, (sql, params) => {
    if (sql.includes("FROM agent_task_leases lease")) {
      assert.deepEqual(params, [
        "tenant-a",
        "codex-a",
        identity.agentPresence.session_fingerprint,
        identity.agentPresence.signature,
        "subject-a",
        "session-a",
      ]);
      return emptyResult([{
        contract_id: "11111111-1111-4111-8111-111111111111",
        trace_id: taskTrace,
        agent_id: "codex-a",
        session_id: "session-a",
        signature: identity.agentPresence.signature,
        session_fingerprint: identity.agentPresence.session_fingerprint,
        title: "Live task",
        updated_at: updatedAt,
      }]);
    }
    if (sql.includes("FROM mcp_workspace_lock_leases")) {
      assert.equal(params[4], taskTrace);
      return emptyResult([{
        name: "reports/run.md",
        trace_id: taskTrace,
        agent_id: "codex-a",
        session_id: "session-a",
        agent_signature: identity.agentPresence.signature,
        session_fingerprint: identity.agentPresence.session_fingerprint,
        acquired_at: acquiredAt,
      }]);
    }
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore(config, {
    pool,
    schemaReady: true,
    govern: async () => ({ allowed: true }),
  });
  const binding = await store.findCoordinationBinding(identity);
  assert.equal(binding.taskContract.contract_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(binding.taskContract.status, "current");
  assert.equal(binding.coordinationLock.trace_id, taskTrace);
  assert.equal(binding.coordinationLock.source, "postgres:mcp_workspace_lock_leases");
});

test("live coordination binding rejects more than one active task", async () => {
  const pool = new FakePool(undefined, (sql) => {
    if (sql.includes("FROM agent_task_leases lease")) {
      return emptyResult([
        { contract_id: "11111111-1111-4111-8111-111111111111" },
        { contract_id: "22222222-2222-4222-8222-222222222222" },
      ]);
    }
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore(config, {
    pool,
    schemaReady: true,
    govern: async () => ({ allowed: true }),
  });
  await assert.rejects(store.findCoordinationBinding(identity), /coordination_task_binding_ambiguous/);
});

test("document write verifies lock and version, versions content, and redacts secrets", async () => {
  const versionInserts = [];
  const pool = new FakePool((sql, params) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return emptyResult();
    if (sql.includes("pg_advisory_xact_lock")) return emptyResult([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) return emptyResult([{ state: "pending" }]);
    if (sql.includes("SELECT 1 FROM agent_presence")) return emptyResult([{ ok: 1 }]);
    if (sql.includes("SELECT 1 FROM mcp_workspace_lock_leases")) return emptyResult([{ ok: 1 }]);
    if (sql.includes("SELECT lock_id FROM mcp_workspace_lock_leases")) return emptyResult();
    if (sql.includes("SELECT 1 FROM mcp_workspace_folders")) return emptyResult();
    if (sql.includes("SELECT * FROM mcp_workspace_documents")) return emptyResult();
    if (sql.includes("INSERT INTO mcp_workspace_documents")) return emptyResult([{ id: params[1] }]);
    if (sql.includes("INSERT INTO mcp_workspace_document_versions")) {
      versionInserts.push(params);
      return emptyResult([{ document_id: params[1] }]);
    }
    if (sql.includes("INSERT INTO mcp_workspace_heads")) return emptyResult([{ revision: "1" }]);
    if (sql.includes("UPDATE mcp_collaboration_idempotency")) return emptyResult([{ state: "completed" }]);
    if (sql.includes("INSERT INTO mcp_coordination_events")) return emptyResult([{ id: 1 }]);
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore(config, { pool, govern: async () => ({ allowed: true, decision: "allow" }) });
  const result = await store.writeDocument({
    path: "reports/run.md",
    title: "Run report",
    content: "Safe line\npassword=supersecret",
    expected_version: 0,
    idempotency_key: "write-run-1",
    lock_id: "11111111-1111-4111-8111-111111111111",
    fencing_token: 17,
  }, identity);
  assert.equal(result.structuredContent.document.version, 1);
  assert.equal(result.structuredContent.document.redaction_count, 1);
  assert.equal(result.structuredContent.workspace_revision, 1);
  assert.equal(versionInserts.length, 1);
  assert.match(versionInserts[0][4], /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify([...pool.calls, ...pool.client.calls]), /supersecret/);
  const ownership = pool.client.calls.find(({ sql }) => sql.includes("SELECT 1 FROM mcp_workspace_lock_leases"));
  assert.match(ownership.sql, /left\(\$3,length\(resource_path\)\+1\)=resource_path\|\|'\/'/);
});

test("consumes dual-signed receipt after BEGIN and before the shared-memory mutation", async () => {
  const receiptEvidence = {
    schema_version: "mcp_collaboration_verified_receipt_v1",
    tenant_id: "tenant-a",
    jti: "mcpcr_0123456789abcdef0123456789abcdef",
    binding_digest: "1".repeat(64),
    receipt_digest: "2".repeat(64),
    issued_at: new Date(Date.now() - 1_000).toISOString(),
    expires_at: new Date(Date.now() + 20_000).toISOString(),
    authorities: [
      { issuer: "universal-core-staging", kid: "core-kid", receipt_digest: "3".repeat(64) },
      { issuer: "nyra-staging", kid: "nyra-kid", receipt_digest: "4".repeat(64) },
    ],
  };
  const pool = new FakePool((sql, params) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return emptyResult();
    if (sql.includes("mcp_collaboration_control.consume_receipt_pair")) {
      assert.equal(params[0], "tenant-a");
      return emptyResult([{ issuer: "universal-core-staging" }, { issuer: "nyra-staging" }]);
    }
    if (sql.includes("pg_advisory_xact_lock")) return emptyResult([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) return emptyResult([{ state: "pending" }]);
    if (sql.includes("SELECT 1 FROM agent_presence")) return emptyResult([{ ok: 1 }]);
    if (sql.includes("SELECT lock_id FROM mcp_workspace_lock_leases")) return emptyResult();
    if (sql.includes("SELECT 1 FROM mcp_workspace_documents")) return emptyResult();
    if (sql.includes("INSERT INTO mcp_workspace_folders")) return emptyResult([{
      id: params[1], path: "reports", version: 1, created_at: new Date().toISOString(), created_by: "subject-a", created: true,
    }]);
    if (sql.includes("INSERT INTO mcp_workspace_heads")) return emptyResult([{ revision: "1" }]);
    if (sql.includes("UPDATE mcp_collaboration_idempotency")) return emptyResult([{ state: "completed" }]);
    if (sql.includes("INSERT INTO mcp_coordination_events")) return emptyResult([{ id: 1 }]);
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const receiptIdentity = {
    ...identity,
    governanceContext: {
      tool_name: "workspace_create_folder",
      trace_id: "33333333-3333-4333-8333-333333333333",
      preflight_id: "preflight-1",
      task_contract_id: "contract-1",
      task_trace_id: "task-trace-1",
      coordination_lock: "lock-1",
      shared_memory_checksum: "a".repeat(64),
    },
  };
  const store = createSharedMemoryPostgresStore({
    ...config,
    collaborationLocksRequired: false,
    collaborationReceiptEnforcement: true,
  }, {
    pool,
    govern: async () => ({ allowed: true, coordination_receipt: { opaque: true } }),
    collaborationReceiptVerifier: {
      ready: true,
      verify: async (_receipt, expected) => {
        assert.equal(expected.action.action_type, "workspace.create_folder");
        assert.match(expected.action.idempotency_key_sha256, /^[a-f0-9]{64}$/);
        return receiptEvidence;
      },
    },
  });
  await store.createFolder({ path: "reports", idempotency_key: "receipt-folder-1" }, receiptIdentity);
  const sql = pool.client.calls.map((call) => call.sql);
  const begin = sql.indexOf("BEGIN");
  const consume = sql.findIndex((value) => value.includes("mcp_collaboration_control.consume_receipt_pair"));
  const mutate = sql.findIndex((value) => value.includes("INSERT INTO mcp_workspace_folders"));
  assert(begin >= 0 && consume > begin && mutate > consume);
  assert(sql.includes("COMMIT"));
});

test("receipt replay aborts and rolls back before any shared-memory mutation", async () => {
  const pool = new FakePool((sql) => {
    if (sql === "BEGIN" || sql === "ROLLBACK") return emptyResult();
    if (sql.includes("pg_advisory_xact_lock")) return emptyResult([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("mcp_collaboration_control.consume_receipt_pair")) return emptyResult([{ issuer: "universal-core-staging" }]);
    throw new Error(`mutation_reached:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore({
    ...config,
    collaborationLocksRequired: false,
    collaborationReceiptEnforcement: true,
  }, {
    pool,
    govern: async () => ({ allowed: true, coordination_receipt: {} }),
    collaborationReceiptVerifier: {
      ready: true,
      verify: async () => ({
        schema_version: "mcp_collaboration_verified_receipt_v1",
        tenant_id: "tenant-a",
        jti: "mcpcr_0123456789abcdef0123456789abcdef",
        binding_digest: "1".repeat(64),
        receipt_digest: "2".repeat(64),
        issued_at: new Date(Date.now() - 1_000).toISOString(),
        expires_at: new Date(Date.now() + 20_000).toISOString(),
        authorities: [
          { issuer: "universal-core-staging", kid: "core-kid", receipt_digest: "3".repeat(64) },
          { issuer: "nyra-staging", kid: "nyra-kid", receipt_digest: "4".repeat(64) },
        ],
      }),
    },
  });
  await assert.rejects(store.createFolder({ path: "reports", idempotency_key: "receipt-replay-1" }, identity), /collaboration_receipt_expired_or_replayed/);
  assert.deepEqual(pool.client.calls.map(({ sql }) => {
    if (sql === "BEGIN" || sql === "ROLLBACK") return sql;
    return sql.includes("pg_advisory_xact_lock") ? "tenant-lock" : "consume";
  }), ["BEGIN", "tenant-lock", "consume", "ROLLBACK"]);
});

test("automatic lifecycle journaling consumes a governed dual-signed receipt before persistence", async () => {
  const receiptEvidence = {
    schema_version: "mcp_collaboration_verified_receipt_v1",
    tenant_id: "tenant-a",
    jti: "mcpcr_1123456789abcdef0123456789abcdef",
    binding_digest: "5".repeat(64),
    receipt_digest: "6".repeat(64),
    issued_at: new Date(Date.now() - 1_000).toISOString(),
    expires_at: new Date(Date.now() + 20_000).toISOString(),
    authorities: [
      { issuer: "universal-core-staging", kid: "core-kid", receipt_digest: "7".repeat(64) },
      { issuer: "nyra-staging", kid: "nyra-kid", receipt_digest: "8".repeat(64) },
    ],
  };
  const pool = new FakePool((sql) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return emptyResult();
    if (sql.includes("pg_advisory_xact_lock")) return emptyResult([{ pg_advisory_xact_lock: null }]);
    if (sql.includes("mcp_collaboration_control.consume_receipt_pair")) {
      return emptyResult([{ issuer: "universal-core-staging" }, { issuer: "nyra-staging" }]);
    }
    if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) return emptyResult([{ state: "pending" }]);
    if (sql.includes("INSERT INTO mcp_memory_stream_heads")) return emptyResult();
    if (sql.includes("UPDATE mcp_memory_stream_heads")) return emptyResult([{ revision: "1" }]);
    if (sql.includes("INSERT INTO mcp_memory_records")) return emptyResult([{ id: "mem_lifecycle" }]);
    if (sql.includes("INSERT INTO mcp_memory_events")) return emptyResult([{ id: 1 }]);
    if (sql.includes("INSERT INTO mcp_memory_heads")) return emptyResult([{ revision: "1" }]);
    if (sql.includes("UPDATE mcp_collaboration_idempotency")) return emptyResult([{ state: "completed" }]);
    if (sql.includes("INSERT INTO mcp_coordination_events")) return emptyResult([{ id: 1 }]);
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const receiptIdentity = {
    ...identity,
    governanceContext: {
      tool_name: "workspace_write_document",
      trace_id: "44444444-4444-4444-8444-444444444444",
      preflight_id: "preflight-lifecycle",
      task_contract_id: "contract-lifecycle",
      task_trace_id: "task-trace-lifecycle",
      coordination_lock: "lock-lifecycle",
      shared_memory_checksum: "b".repeat(64),
    },
  };
  const receipt = { binding: {}, core: {}, nyra: {} };
  const guardConfig = {
    ...config,
    collaborationReceiptEnforcement: true,
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-test-key" },
    collaborationReceiptAudience: "https://mcp.example.test/mcp",
    collaborationTargetService: "skinharmony-core-mcp-staging",
    collaborationTargetEnvironment: "staging",
    collaborationBuildCommit: "a".repeat(40),
  };
  const receiptVerifier = {
    ready: true,
    verify: async (bundle, expected) => {
      assert.equal(bundle, receipt);
      assert.equal(expected.action.action_type, "memory.checkpoint");
      assert.match(expected.action.idempotency_key_sha256, /^[a-f0-9]{64}$/);
      return receiptEvidence;
    },
  };
  const guard = createCoreWriteGuard(guardConfig, {
    fetchImpl: async () => new Response(JSON.stringify({
      authorization: { allowed: true, state: "authorized", mediation: "allow" },
      collaboration_core_gate: {
        claims: { schema_version: "mcp_collaboration_core_gate_v1" },
        signature: "a".repeat(43),
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
    collaborationReceiptClient: {
      ready: true,
      issue: async (binding, options) => {
        assert.equal(binding.action_type, "memory.checkpoint");
        assert.equal(binding.tool_name, "memory_checkpoint");
        assert.equal(options.coreGate.signature, "a".repeat(43));
        receipt.binding = binding;
        return receipt;
      },
    },
    collaborationReceiptVerifier: receiptVerifier,
  });
  const store = createSharedMemoryPostgresStore(guardConfig, {
    pool,
    govern: guard,
    collaborationReceiptVerifier: receiptVerifier,
  });
  const timestamp = new Date().toISOString();
  const checkpoint = {
    id: "mem_lifecycle",
    kind: "checkpoint",
    title: "Connected AI progress checkpoint",
    summary: "Connected AI completed governed work.",
    facts: [],
    decisions: [],
    actions: ["Tool call: workspace_write_document"],
    outcomes: ["completed"],
    next_steps: ["Read tenant memory context before the next action."],
    tags: ["connected_ai", "checkpoint"],
    importance: 45,
    data_classification: "internal",
    project_id: "project-a",
    session_id: "session-a",
    agent_id: identity.agentPresence.opaque_agent_id,
    source: "mcp_work_lifecycle",
    actor_subject: "subject-a",
    created_at: timestamp,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    idempotency_key: "agent_lifecycle:preflight-lifecycle",
  };
  const event = {
    id: "evt_lifecycle",
    kind: "action",
    title: "MCP workspace_write_document",
    summary: "Tool workspace_write_document completed.",
    project_id: "project-a",
    session_id: "session-a",
    agent_id: identity.agentPresence.opaque_agent_id,
    source: "mcp_auto_journal",
    created_at: timestamp,
    expires_at: checkpoint.expires_at,
  };
  const result = await store.recordAutomatic({ checkpoint, event }, receiptIdentity);
  assert.equal(result.recorded, true);
  const sql = pool.client.calls.map((call) => call.sql);
  const begin = sql.indexOf("BEGIN");
  const consume = sql.findIndex((value) => value.includes("mcp_collaboration_control.consume_receipt_pair"));
  const persist = sql.findIndex((value) => value.includes("INSERT INTO mcp_memory_records"));
  const commit = sql.indexOf("COMMIT");
  assert(begin >= 0 && consume > begin && persist > consume && commit > persist);
  assert.equal(sql.filter((value) => value.includes("INSERT INTO mcp_memory_events")).length, 2);
});

test("automatic lifecycle idempotency binds the event as well as the checkpoint", async () => {
  let idempotencyDigest = null;
  let idempotencyResult = null;
  let memoryInsertCount = 0;
  const pool = new FakePool((sql, params) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return emptyResult();
    if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) {
      if (idempotencyDigest) return emptyResult();
      idempotencyDigest = params[4];
      return emptyResult([{ state: "pending" }]);
    }
    if (sql.includes("SELECT request_sha256,state,result_ref")) {
      return emptyResult([{ request_sha256: idempotencyDigest, state: "completed", result_ref: idempotencyResult }]);
    }
    if (sql.includes("INSERT INTO mcp_memory_stream_heads")) return emptyResult();
    if (sql.includes("UPDATE mcp_memory_stream_heads")) return emptyResult([{ revision: "1" }]);
    if (sql.includes("INSERT INTO mcp_memory_records")) {
      memoryInsertCount += 1;
      return emptyResult([{ id: "mem_lifecycle" }]);
    }
    if (sql.includes("INSERT INTO mcp_memory_events")) return emptyResult([{ id: 1 }]);
    if (sql.includes("INSERT INTO mcp_memory_heads")) return emptyResult([{ revision: "1" }]);
    if (sql.includes("UPDATE mcp_collaboration_idempotency")) {
      idempotencyResult = JSON.parse(params[4]);
      return emptyResult([{ state: "completed" }]);
    }
    if (sql.includes("INSERT INTO mcp_coordination_events")) return emptyResult([{ id: 1 }]);
    throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
  });
  const store = createSharedMemoryPostgresStore(config, {
    pool,
    govern: async () => ({ allowed: true }),
  });
  const checkpoint = {
    id: "mem_lifecycle",
    kind: "checkpoint",
    title: "Connected AI progress checkpoint",
    summary: "Completed governed work.",
    facts: [],
    decisions: [],
    actions: ["Tool call: task_update"],
    outcomes: ["completed"],
    next_steps: [],
    tags: ["connected_ai"],
    importance: 45,
    data_classification: "internal",
    consent_reference: null,
    project_id: "project-a",
    session_id: "session-a",
    agent_id: identity.agentPresence.opaque_agent_id,
    logical_agent_id: identity.agentPresence.agent_id,
    source: "mcp_work_lifecycle",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    idempotency_key: "agent_lifecycle:preflight-event-binding",
  };
  const firstEvent = {
    id: "evt_lifecycle",
    kind: "action",
    title: "MCP task_update",
    summary: "Tool task_update completed.",
    project_id: "project-a",
    session_id: "session-a",
    source: "mcp_auto_journal",
    created_at: checkpoint.created_at,
  };
  await store.recordAutomatic({ checkpoint, event: firstEvent }, identity);
  await assert.rejects(
    store.recordAutomatic({
      checkpoint,
      event: { ...firstEvent, summary: "Altered event with the same retry key." },
    }, identity),
    /idempotency_key_reused/,
  );
  assert.equal(memoryInsertCount, 1);
  assert.ok(pool.client.calls.some(({ sql }) => sql === "ROLLBACK"));
});

test("canonical bootstrap and memory reads use the versioned workspace SSOT and newest recipient-scoped rows", async () => {
  const pool = new FakePool();
  const store = createSharedMemoryPostgresStore(config, { pool, govern: async () => ({ allowed: true }) });
  await store.inspectBySourcePaths("tenant-a", ["SHARED_MEMORY/STATE.json"]);
  await store.fetchBySourcePaths("tenant-a", ["SHARED_MEMORY/STATE.json"]);
  await store.readMemoryState("tenant-a", { agentId: "codex-a" });
  const sql = pool.calls.map((call) => call.sql).join("\n");
  assert.match(sql, /FROM mcp_workspace_documents/);
  assert.match(sql, /JOIN mcp_workspace_document_versions/);
  assert.match(sql, /h\.to_agent_id='all' OR h\.to_agent_id=\$2/);
  assert.match(sql, /ORDER BY created_at DESC LIMIT 5000/);
  assert.doesNotMatch(sql, /FROM mcp_memory_documents/);
  const handoffRead = pool.calls.find(({ sql: statement }) => statement.includes("FROM mcp_memory_handoffs h"));
  assert.equal(handoffRead.params[1], "");
});

test("direct handoffs are exposed only to a durable registered presence", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT 1 FROM agent_presence")) return emptyResult([{ ok: 1 }]);
      if (sql.includes("SELECT revision FROM mcp_memory_heads")) return emptyResult([{ revision: "0" }]);
      return emptyResult();
    },
    async connect() { throw new Error("unexpected_connect"); },
    async end() {},
  };
  const store = createSharedMemoryPostgresStore(config, { pool, govern: async () => ({ allowed: true }) });
  await store.readMemoryState("tenant-a", { agentId: "codex-a", identity });
  const handoffRead = calls.find(({ sql }) => sql.includes("FROM mcp_memory_handoffs h"));
  assert.equal(handoffRead.params[1], "codex-a");
  const registration = calls.find(({ sql }) => sql.includes("SELECT 1 FROM agent_presence"));
  assert.equal(registration.params[2], "subject-a");
  assert.equal(registration.params[3], identity.agentPresence.signature);
});

test("collaboration handlers route every workspace operation to PostgreSQL without filesystem fallback", async () => {
  const calls = [];
  const shared = {
    listWorkspace: async (...args) => { calls.push(["list", ...args]); return { structuredContent: { backend: "postgres" } }; },
    createFolder: async (...args) => { calls.push(["folder", ...args]); return { structuredContent: {} }; },
    readDocument: async (...args) => { calls.push(["read", ...args]); return { structuredContent: {} }; },
    writeDocument: async (...args) => { calls.push(["write", ...args]); return { structuredContent: {} }; },
    acquireLock: async (...args) => { calls.push(["lock", ...args]); return { structuredContent: {} }; },
    renewLock: async () => ({ structuredContent: {} }),
    releaseLock: async () => ({ structuredContent: {} }),
    listLocks: async () => ({ structuredContent: {} }),
  };
  const postgres = {
    listTasks: async () => ({ structuredContent: { tasks: [] } }),
  };
  const handlers = createCollaborationHandlers(config, {
    collaborationPostgresStore: postgres,
    sharedMemoryPostgresStore: shared,
  });
  await handlers.workspace_list({ prefix: "reports" }, identity);
  await handlers.workspace_create_folder({ path: "reports" }, identity);
  await handlers.workspace_read_document({ path: "reports/run.md" }, identity);
  await handlers.workspace_write_document({ path: "reports/run.md", content: "ok", expected_version: 0, idempotency_key: "write-1" }, identity);
  await handlers.workspace_lock_acquire({ path: "reports/run.md", idempotency_key: "lock-1" }, identity);
  assert.deepEqual(calls.map(([name]) => name), ["list", "folder", "read", "write", "lock"]);
});

test("PostgreSQL memory fabric supports async recall and delegates redacted writes and lifecycle events", async () => {
  const calls = [];
  const stored = {
    schema_version: "tenant_memory_fabric_v1",
    revision: 4,
    memories: [{ id: "mem_11111111-1111-4111-8111-111111111111", kind: "observation", title: "Shared report", summary: "Postgres coordination", facts: [], decisions: [], actions: [], outcomes: [], next_steps: [], tags: ["postgres"], importance: 50, project_id: "project-a", session_id: null, source: "mcp_explicit", created_at: new Date().toISOString() }],
    checkpoints: [],
    handoffs: [],
    events: [],
    audit: [],
  };
  const shared = {
    readMemoryState: async () => stored,
    appendMemory: async (record) => { calls.push(["append", record]); return { memory: record, created: true }; },
    createHandoff: async (record) => { calls.push(["handoff", record]); return { handoff: record, created: true }; },
    acknowledgeHandoff: async (args) => { calls.push(["ack", args]); return { handoff: { id: args.handoff_id } }; },
    recordAutomatic: async (payload) => { calls.push(["automatic", payload]); return { recorded: true }; },
  };
  const fabric = createMemoryFabric(config, { sharedMemoryPostgresStore: shared, govern: async () => ({ allowed: true }) });
  const context = await fabric.context({ query: "coordination", project_id: "project-a" }, identity);
  assert.equal(context.revision, 4);
  assert.equal(context.relevant_memories.length, 1);
  const search = await fabric.search({ query: "postgres" }, identity);
  assert.equal(search.results.length, 1);
  await fabric.append({ title: "Safe", summary: "token=verysecret", idempotency_key: "memory-1" }, identity);
  assert.equal(calls[0][0], "append");
  assert.match(calls[0][1].summary, /\[REDACTED_SECRET\]/);
  assert.doesNotMatch(JSON.stringify(calls[0][1]), /verysecret/);
  await fabric.recordToolActivity({
    identity: { ...identity, governanceContext: { preflight_id: "preflight-1", trace_id: "trace-1" } },
    toolName: "workspace_write_document",
    args: { project_id: "project-a" },
    result: { structuredContent: {} },
    toolAnnotations: { readOnlyHint: false },
  });
  assert.equal(calls.at(-1)[0], "automatic");
});

test("lock tools expose accurate safety annotations and fencing inputs", () => {
  for (const name of ["workspace_lock_acquire", "workspace_lock_renew", "workspace_lock_release"]) {
    const tool = TOOLS.find((candidate) => candidate.name === name);
    assert.ok(tool);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.annotations.destructiveHint, false);
  }
  const list = TOOLS.find((candidate) => candidate.name === "workspace_lock_list");
  assert.equal(list.annotations.readOnlyHint, true);
  const write = TOOLS.find((candidate) => candidate.name === "workspace_write_document");
  assert.ok(write.inputSchema.properties.lock_id);
  assert.ok(write.inputSchema.properties.fencing_token);
});

test("PostgreSQL tool contracts require runtime lock, lease and idempotency inputs", () => {
  const runtime = (name) => configureToolForRuntime(TOOLS.find((tool) => tool.name === name), { collaborationDatabaseUrl: "configured" });
  assert.deepEqual(new Set(runtime("workspace_write_document").inputSchema.required), new Set(["path", "content", "expected_version", "idempotency_key", "lock_id", "fencing_token"]));
  assert(runtime("workspace_create_folder").inputSchema.required.includes("lock_id"));
  assert(runtime("memory_handoff").inputSchema.required.includes("idempotency_key"));
  assert(runtime("task_update").inputSchema.required.includes("lease_token"));
  assert(runtime("message_post").inputSchema.required.includes("to_agent_id"));
  const unlocked = configureToolForRuntime(TOOLS.find((tool) => tool.name === "workspace_create_folder"), {
    collaborationDatabaseUrl: "configured",
    collaborationLocksRequired: false,
  });
  assert.equal(unlocked.inputSchema.required.includes("lock_id"), false);
  assert.equal(unlocked.inputSchema.required.includes("fencing_token"), false);
});

test("PostgreSQL coordination mutations fail closed without bootstrap, contract and trace", () => {
  const tool = TOOLS.find((candidate) => candidate.name === "workspace_write_document");
  const configWithPostgres = { collaborationDatabaseUrl: "configured", collaborationTaskContractRequired: true, coordinationReceiptVerifierReady: true };
  assert.throws(() => coordinationGovernanceContext({ ...configWithPostgres, coordinationReceiptVerifierReady: false }, tool, {}, {}, identity), /collaboration_signed_receipt_verifier_required/);
  const governance = {
    core_verdict_required_before_execution: true,
    direct_connector_bypass_forbidden_by_protocol: true,
    cross_tenant_actions_allowed: false,
    audit_required: true,
  };
  const bootstrap = {
    loaded: true,
    tenant_id: "tenant-a",
    checksum: "a".repeat(64),
    active_task_count: 1,
    active_lock_count: 1,
    task_contract: { contract_id: "contract-1", trace_id: "task-trace-1", agent_id: "codex-a", session_id: "session-a", agent_signature: identity.agentPresence.signature, session_fingerprint: identity.agentPresence.session_fingerprint, status: "current", updated_at: "2026-07-22T10:00:00.000Z" },
    coordination_lock: { name: "lock-1", trace_id: "task-trace-1", agent_id: "codex-a", session_id: "session-a", agent_signature: identity.agentPresence.signature, session_fingerprint: identity.agentPresence.session_fingerprint, acquired_at: "2026-07-22T09:59:00.000Z" },
  };
  assert.throws(() => coordinationGovernanceContext(configWithPostgres, tool, {
    tenant_id: "tenant-a",
    shared_memory_bootstrap: bootstrap,
    governance,
  }, {}, identity), /collaboration_task_contract_required/);
  assert.throws(() => coordinationGovernanceContext(configWithPostgres, tool, {
    preflight_id: "preflight-1",
    tenant_id: "tenant-a",
    shared_memory_bootstrap: bootstrap,
    governance,
  }, {}, identity), /collaboration_trace_required/);
  assert.throws(() => coordinationGovernanceContext(configWithPostgres, tool, {
    preflight_id: "preflight-1",
    tenant_id: "tenant-a",
    shared_memory_bootstrap: { ...bootstrap, loaded: false },
    governance,
  }, { ledgerContext: { traceId: "11111111-1111-4111-8111-111111111111" } }, identity), /shared_memory_bootstrap_required/);
  assert.deepEqual(coordinationGovernanceContext(configWithPostgres, tool, {
    preflight_id: "preflight-1",
    tenant_id: "tenant-a",
    shared_memory_bootstrap: bootstrap,
    governance,
  }, { ledgerContext: { traceId: "11111111-1111-4111-8111-111111111111" } }, identity), {
    tool_name: "workspace_write_document",
    preflight_id: "preflight-1",
    trace_id: "11111111-1111-4111-8111-111111111111",
    shared_memory_checksum: "a".repeat(64),
    task_contract_id: "contract-1",
    task_trace_id: "task-trace-1",
    coordination_lock: "lock-1",
  });
  const nonCoordinationWrite = TOOLS.find((candidate) => candidate.name === "outcome_record");
  assert.equal(nonCoordinationWrite.annotations.readOnlyHint, false);
  assert.equal(coordinationGovernanceContext(configWithPostgres, nonCoordinationWrite, {
    preflight_id: "preflight-1",
    tenant_id: "tenant-a",
    shared_memory_bootstrap: bootstrap,
    governance,
  }, { ledgerContext: { traceId: "11111111-1111-4111-8111-111111111111" } }, identity).tool_name, "outcome_record");
  const readOnlyTool = TOOLS.find((candidate) => candidate.name === "core_health");
  assert.equal(coordinationGovernanceContext(configWithPostgres, readOnlyTool, {}, {}, identity), null);
  assert.throws(() => coordinationGovernanceContext(configWithPostgres, tool, {
    preflight_id: "preflight-1",
    tenant_id: "tenant-a",
    shared_memory_bootstrap: { ...bootstrap, coordination_lock: null },
    governance,
  }, { ledgerContext: { traceId: "11111111-1111-4111-8111-111111111111" } }, identity), /collaboration_lock_required/);
});

test("progressive enrollment permits only heartbeat, task create/claim and task-bound lock acquisition", () => {
  const configWithPostgres = {
    collaborationDatabaseUrl: "configured",
    collaborationTaskContractRequired: true,
    coordinationReceiptVerifierReady: true,
  };
  const traceId = "11111111-1111-4111-8111-111111111111";
  const governance = {
    core_verdict_required_before_execution: true,
    direct_connector_bypass_forbidden_by_protocol: true,
    cross_tenant_actions_allowed: false,
    audit_required: true,
  };
  const emptyBootstrap = {
    loaded: true,
    tenant_id: "tenant-a",
    checksum: "a".repeat(64),
    active_task_count: 0,
    active_lock_count: 0,
    task_contract: null,
    coordination_lock: null,
  };
  const preflight = {
    preflight_id: "preflight-enrollment",
    tenant_id: "tenant-a",
    shared_memory_bootstrap: emptyBootstrap,
    governance,
  };
  for (const toolName of ["agent_heartbeat", "task_create", "task_claim"]) {
    const context = coordinationGovernanceContext(
      configWithPostgres,
      TOOLS.find((candidate) => candidate.name === toolName),
      preflight,
      { ledgerContext: { traceId } },
      identity,
    );
    assert.equal(context.task_contract_id, "mcp-enrollment:codex-a");
    assert.equal(context.task_trace_id, traceId);
    assert.equal(context.coordination_lock, "mcp-enrollment:codex-a");
  }
  assert.throws(() => coordinationGovernanceContext(
    configWithPostgres,
    TOOLS.find((candidate) => candidate.name === "workspace_write_document"),
    preflight,
    { ledgerContext: { traceId } },
    identity,
  ), /collaboration_task_contract_required/);
  assert.throws(() => coordinationGovernanceContext(
    configWithPostgres,
    TOOLS.find((candidate) => candidate.name === "workspace_lock_acquire"),
    preflight,
    { ledgerContext: { traceId } },
    identity,
  ), /collaboration_task_contract_required/);

  const taskOnlyBootstrap = {
    ...emptyBootstrap,
    active_task_count: 1,
    task_contract: {
      contract_id: "contract-1",
      trace_id: "33333333-3333-4333-8333-333333333333",
      agent_id: "codex-a",
      session_id: "session-a",
      agent_signature: identity.agentPresence.signature,
      session_fingerprint: identity.agentPresence.session_fingerprint,
      status: "current",
      updated_at: "2026-07-22T10:00:00.000Z",
    },
  };
  const lockContext = coordinationGovernanceContext(
    configWithPostgres,
    TOOLS.find((candidate) => candidate.name === "workspace_lock_acquire"),
    { ...preflight, shared_memory_bootstrap: taskOnlyBootstrap },
    { ledgerContext: { traceId } },
    identity,
  );
  assert.equal(lockContext.task_contract_id, "contract-1");
  assert.equal(lockContext.task_trace_id, "33333333-3333-4333-8333-333333333333");
  assert.equal(lockContext.coordination_lock, "mcp-enrollment:codex-a");
});

test("read-only tools never append an automatic PostgreSQL checkpoint", async () => {
  const calls = [];
  const fabric = createMemoryFabric(config, {
    sharedMemoryPostgresStore: {
      readMemoryState: async () => ({ schema_version: "tenant_memory_fabric_v1", revision: 0, memories: [], checkpoints: [], handoffs: [], events: [], audit: [] }),
      recordAutomatic: async () => { calls.push("automatic"); },
    },
    govern: async () => ({ allowed: true }),
  });
  await fabric.recordToolActivity({ identity, toolName: "workspace_list", toolAnnotations: { readOnlyHint: true } });
  assert.deepEqual(calls, []);
});
