import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_BOOTSTRAP_PATHS,
  CANONICAL_BOOTSTRAP_SCOPE,
  canonicalBootstrapControlSchemaSql,
  createCanonicalBootstrapBundle,
  createCanonicalBootstrapProtocol,
  createPostgresCanonicalBootstrapConsumer,
} from "../src/index.js";

const COMMIT = "b".repeat(40);
const NOW = Date.parse("2026-07-23T13:00:00.000Z");

function fixtureBundle() {
  return createCanonicalBootstrapBundle({
    bootstrap_id: "mcpboot_abcdefghijklmnopqrstuvwxyz",
    target_commit: COMMIT,
    created_at: "2026-07-23T12:59:30.000Z",
    documents: CANONICAL_BOOTSTRAP_PATHS.map((path, index) => ({
      title: `Redacted canonical ${index}`,
      content: path === "SHARED_MEMORY/STATE.json"
        ? JSON.stringify({
            tenant: "codexai",
            generated_at: "2026-07-23T12:59:00.000Z",
            active_task_count: 0,
            active_lock_count: 0,
          })
        : path === "SHARED_MEMORY/TASKS.json"
          ? JSON.stringify({ tenant: "codexai", count: 0, tasks: [] })
          : path === "SHARED_MEMORY/LOCKS.json"
            ? JSON.stringify({ tenant: "codexai", count: 0, locks: [] })
            : path === "SHARED_MEMORY/ARTIFACTS.json"
              ? JSON.stringify({ tenant: "codexai", count: 0, artifacts: [] })
              : `# Redacted fixture ${index}`,
      redaction_count: 0,
      redaction_status: "reviewed_redacted",
    })),
  });
}

function verifiedApproval(expected) {
  return {
    ...expected,
    schema_version: "mcp_staging_canonical_bootstrap_verified_approval_v1",
    verified: true,
    decision: "allow",
    approval_jti: "mcpcr_abcdefghijklmnopqrstuvwxyz",
    issued_at: "2026-07-23T12:59:45.000Z",
    expires_at: "2026-07-23T13:00:15.000Z",
    authorities: [
      {
        issuer: "universal-core-staging",
        role: "final_authority",
        key_fingerprint: `ed25519-sha256:${"6".repeat(64)}`,
        receipt_digest: "7".repeat(64),
      },
      {
        issuer: "nyra-staging",
        role: "advisory_veto",
        key_fingerprint: `ed25519-sha256:${"8".repeat(64)}`,
        receipt_digest: "9".repeat(64),
      },
    ],
  };
}

function verifiedReceipt(approval) {
  return {
    schema_version: "mcp_collaboration_verified_receipt_v1",
    tenant_id: approval.tenant_id,
    jti: approval.approval_jti,
    binding_digest: "a".repeat(64),
    receipt_digest: "b".repeat(64),
    issued_at: approval.issued_at,
    expires_at: approval.expires_at,
    authorities: approval.authorities.map(({ issuer, key_fingerprint, receipt_digest }) => ({
      issuer,
      kid: key_fingerprint,
      receipt_digest,
    })),
  };
}

class FakePool {
  constructor({
    database = CANONICAL_BOOTSTRAP_SCOPE.target_database,
    currentUser = CANONICAL_BOOTSTRAP_SCOPE.control_role,
    sessionUser = CANONICAL_BOOTSTRAP_SCOPE.control_role,
    tenantRows = 0,
    failAt = null,
    releaseThrows = false,
    receiptRows = 2,
  } = {}) {
    this.database = database;
    this.currentUser = currentUser;
    this.sessionUser = sessionUser;
    this.failAt = failAt;
    this.releaseThrows = releaseThrows;
    this.receiptRows = receiptRows;
    this.state = {
      tenantRows,
      consumption: null,
      folders: [],
      documents: [],
      versions: [],
      heads: [],
      audits: [],
      receipts: [],
    };
    this.commands = [];
    this.releases = 0;
  }

  async connect() {
    const pool = this;
    let transaction = null;
    return {
      async query(input) {
        const name = typeof input === "string" ? input : input.name;
        pool.commands.push(name);
        if (name === "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE") {
          transaction = structuredClone(pool.state);
          return { rowCount: null, rows: [] };
        }
        if (name === "ROLLBACK") {
          transaction = null;
          return { rowCount: null, rows: [] };
        }
        if (name === "COMMIT") {
          pool.state = transaction;
          transaction = null;
          return { rowCount: null, rows: [] };
        }
        if (name === pool.failAt) throw new Error("provider detail must be hidden");
        if (name === "canonical-bootstrap-advisory-lock-v1") return { rowCount: 1, rows: [{}] };
        if (name === "canonical-bootstrap-database-and-role-binding-v2") {
          return {
            rowCount: 1,
            rows: [{
              database_name: pool.database,
              current_user: pool.currentUser,
              session_user: pool.sessionUser,
            }],
          };
        }
        if (name === "canonical-bootstrap-existing-consumption-v1") {
          return transaction.consumption
            ? { rowCount: 1, rows: [{ consumption_id: transaction.consumption }] }
            : { rowCount: 0, rows: [] };
        }
        if (name === "canonical-bootstrap-empty-data-plane-v1") {
          return { rowCount: 1, rows: [{ tenant_row_count: transaction.tenantRows }] };
        }
        if (name === "canonical-bootstrap-consume-receipt-pair-v1") {
          const issuers = ["universal-core-staging", "nyra-staging"].slice(0, pool.receiptRows);
          transaction.receipts.push(...issuers);
          return {
            rowCount: issuers.length,
            rows: issuers.map((issuer) => ({ issuer })),
          };
        }
        if (name === "canonical-bootstrap-database-time-v1") {
          return { rowCount: 1, rows: [{ consumed_at: new Date(NOW) }] };
        }
        if (name === "canonical-bootstrap-insert-folder-v1") {
          transaction.folders.push(input.values[2]);
          return { rowCount: 1, rows: [] };
        }
        if (name === "canonical-bootstrap-insert-document-v1") {
          transaction.documents.push(input.values[2]);
          return { rowCount: 1, rows: [] };
        }
        if (name === "canonical-bootstrap-insert-document-version-v1") {
          transaction.versions.push(input.values[1]);
          return { rowCount: 1, rows: [] };
        }
        if (name === "canonical-bootstrap-insert-workspace-head-v1") {
          transaction.heads.push(input.values[1]);
          return { rowCount: 1, rows: [] };
        }
        if (name === "canonical-bootstrap-insert-coordination-audit-v1") {
          transaction.audits.push(JSON.parse(input.values[4]));
          return { rowCount: 1, rows: [] };
        }
        if (name === "canonical-bootstrap-insert-consumption-v1") {
          transaction.consumption = input.values[1];
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${name}`);
      },
      release() {
        pool.releases += 1;
        if (pool.releaseThrows) throw new Error("provider release detail must be hidden");
      },
    };
  }
}

function protocol(pool) {
  return createCanonicalBootstrapProtocol({
    approvalVerifier: {
      async verify(_artifact, expected) {
        const approval = verifiedApproval(expected);
        return {
          approval,
          receipt_evidence: verifiedReceipt(approval),
        };
      },
    },
    consumer: createPostgresCanonicalBootstrapConsumer(pool),
    now: () => NOW,
  });
}

function request() {
  return {
    bundle: fixtureBundle(),
    runtime_binding: {
      tenant_id: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
      executor_service: CANONICAL_BOOTSTRAP_SCOPE.executor_service,
      control_role: CANONICAL_BOOTSTRAP_SCOPE.control_role,
      target_service: CANONICAL_BOOTSTRAP_SCOPE.target_service,
      target_environment: CANONICAL_BOOTSTRAP_SCOPE.target_environment,
      target_database: CANONICAL_BOOTSTRAP_SCOPE.target_database,
      target_commit: COMMIT,
    },
    approval_artifact: Object.freeze({ opaque: true }),
  };
}

test("commits all eight documents, redacted audit, and one consumption atomically", async () => {
  const pool = new FakePool();
  const result = await protocol(pool).execute(request());
  assert.equal(result.bootstrapped, true);
  assert.equal(pool.state.folders.length, 3);
  assert.deepEqual(pool.state.documents, CANONICAL_BOOTSTRAP_PATHS);
  assert.equal(pool.state.versions.length, 8);
  assert.deepEqual(pool.state.heads, [8]);
  assert.equal(pool.state.audits.length, 1);
  assert.deepEqual(pool.state.receipts, ["universal-core-staging", "nyra-staging"]);
  assert.match(pool.state.consumption, /^mcpbootcons_/);
  assert(
    pool.commands.indexOf("canonical-bootstrap-consume-receipt-pair-v1") <
      pool.commands.indexOf("canonical-bootstrap-insert-folder-v1"),
  );
  assert.equal(pool.commands.at(-1), "COMMIT");
  assert.equal(pool.releases, 1);
  const storedAudit = JSON.stringify(pool.state.audits[0]);
  assert.equal(storedAudit.includes("Redacted fixture"), false);
  assert.equal(storedAudit.includes("approval_jti"), true);
  assert.equal(storedAudit.includes("mcpcr_abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(pool.state.audits[0].executor_service, CANONICAL_BOOTSTRAP_SCOPE.executor_service);
  assert.equal(pool.state.audits[0].control_role, CANONICAL_BOOTSTRAP_SCOPE.control_role);
});

test("rolls back every write and hides provider errors", async () => {
  const pool = new FakePool({ failAt: "canonical-bootstrap-insert-document-version-v1" });
  await assert.rejects(
    protocol(pool).execute(request()),
    (error) => error.code === "canonical_bootstrap_database_error" &&
      !error.message.includes("provider detail"),
  );
  assert.equal(pool.state.folders.length, 0);
  assert.equal(pool.state.documents.length, 0);
  assert.equal(pool.state.receipts.length, 0);
  assert.equal(pool.state.consumption, null);
  assert(pool.commands.includes("ROLLBACK"));
  assert.equal(pool.releases, 1);
});

test("rolls back when the receipt pair is expired or replayed", async () => {
  const pool = new FakePool({ receiptRows: 1 });
  await assert.rejects(
    protocol(pool).execute(request()),
    /canonical_bootstrap_receipt_expired_or_replayed/,
  );
  assert.equal(pool.state.receipts.length, 0);
  assert.equal(pool.state.documents.length, 0);
  assert.equal(pool.state.consumption, null);
  assert(pool.commands.includes("ROLLBACK"));
});

test("rejects replay, a non-empty tenant data plane, and a wrong database or role binding", async () => {
  const replayPool = new FakePool();
  const executor = protocol(replayPool);
  await executor.execute(request());
  await assert.rejects(
    executor.execute(request()),
    /canonical_bootstrap_already_consumed/,
  );
  assert.equal(replayPool.state.documents.length, 8);

  const nonEmpty = new FakePool({ tenantRows: 1 });
  await assert.rejects(
    protocol(nonEmpty).execute(request()),
    /canonical_bootstrap_database_not_empty/,
  );
  assert.equal(nonEmpty.state.documents.length, 0);

  const wrongDatabase = new FakePool({ database: "another_database" });
  await assert.rejects(
    protocol(wrongDatabase).execute(request()),
    /canonical_bootstrap_database_binding_mismatch/,
  );
  assert.equal(wrongDatabase.state.documents.length, 0);

  for (const roleBinding of [
    { currentUser: "provider_admin", sessionUser: "provider_admin" },
    {
      currentUser: CANONICAL_BOOTSTRAP_SCOPE.control_role,
      sessionUser: "provider_admin",
    },
  ]) {
    const wrongRole = new FakePool(roleBinding);
    await assert.rejects(
      protocol(wrongRole).execute(request()),
      /canonical_bootstrap_database_binding_mismatch/,
    );
    assert.equal(wrongRole.state.documents.length, 0);
  }
});

test("does not let a provider release error override a committed result", async () => {
  const pool = new FakePool({ releaseThrows: true });
  const result = await protocol(pool).execute(request());
  assert.equal(result.bootstrapped, true);
  assert.equal(pool.state.documents.length, 8);
  assert.equal(pool.commands.at(-1), "COMMIT");
  assert.equal(pool.releases, 1);
});

test("consumer cannot be called without the protocol's validated capsule", async () => {
  const consumer = createPostgresCanonicalBootstrapConsumer(new FakePool());
  await assert.rejects(
    consumer.consumeOnce({}),
    /canonical_bootstrap_validated_capsule_required/,
  );
});

test("control schema is append-only, private, and contains no grants to runtime", () => {
  const sql = canonicalBootstrapControlSchemaSql();
  assert.match(sql, /REVOKE ALL ON TABLE .*canonical_bootstrap_consumptions FROM PUBLIC/);
  assert.match(sql, /BEFORE UPDATE OR DELETE OR TRUNCATE/);
  assert.equal(/\bGRANT\b/i.test(sql), false);
  assert.equal(/content\s+text/i.test(sql), false);
  assert.equal(/password|connectionString|DATABASE_URL/i.test(sql), false);
  assert.match(sql, /executor_service varchar\(120\) NOT NULL/);
  assert.match(sql, /control_role name NOT NULL/);
  assert.match(sql, /ALTER SCHEMA mcp_collaboration_control OWNER TO CURRENT_USER/);
  assert.match(
    sql,
    /ALTER TABLE mcp_collaboration_control\.canonical_bootstrap_consumptions OWNER TO CURRENT_USER/,
  );
  assert.match(
    sql,
    /ALTER FUNCTION mcp_collaboration_control\.reject_canonical_bootstrap_mutation\(\) OWNER TO CURRENT_USER/,
  );
});
