import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { loadCollaborationTestDatabaseUrl } from "../../src/collaboration-database-guards.js";
import {
  applyCollaborationPostgresMigration,
  COLLABORATION_SCHEMA_CHECKSUM,
  COLLABORATION_SCHEMA_MIGRATION_ID,
  COLLABORATION_SCHEMA_VERSION,
  configureCollaborationRuntimeRole,
  verifyCollaborationPostgresSchema,
} from "../../src/collaboration-postgres-schema.js";

function testPoolOptions(connectionString) {
  try {
    const parsed = new URL(connectionString);
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    if (!user || !password) throw new Error();
    return {
      host: parsed.hostname.replace(/^\[|\]$/g, ""),
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      user,
      password,
      ssl: false,
      max: 1,
      connectionTimeoutMillis: 8_000,
      query_timeout: 8_000,
      statement_timeout: 8_000,
      options: "-c search_path=pg_catalog,public,pg_temp",
      application_name: "skinharmony-core-mcp-postgres-integration-test",
    };
  } catch {
    throw new Error("collaboration_test_database_url_credentials_required");
  }
}

async function migrationMarker(pool) {
  const result = await pool.query(
    `SELECT version,migration_id,checksum,applied_at
     FROM mcp_collaboration_schema_migrations
     WHERE version=$1 AND migration_id=$2`,
    [COLLABORATION_SCHEMA_VERSION, COLLABORATION_SCHEMA_MIGRATION_ID],
  );
  assert.equal(result.rowCount, 1);
  const row = result.rows[0];
  assert.equal(row.version, COLLABORATION_SCHEMA_VERSION);
  assert.equal(row.migration_id, COLLABORATION_SCHEMA_MIGRATION_ID);
  assert.equal(row.checksum, COLLABORATION_SCHEMA_CHECKSUM);
  return {
    version: row.version,
    migration_id: row.migration_id,
    checksum: row.checksum,
    applied_at: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
  };
}

function quoteTestRole(role) {
  if (!/^mcp_it_runtime_[a-z0-9_]{8,40}$/.test(role)) {
    throw new Error("collaboration_test_runtime_role_invalid");
  }
  return `"${role}"`;
}

async function expectDatabaseError(operation, predicate) {
  let matched = false;
  try {
    await operation;
  } catch (error) {
    matched = predicate(error);
  }
  assert.equal(matched, true);
}

function receiptInput(overrides = {}) {
  const now = Date.now();
  return {
    tenantId: "codexai",
    jti: `mcpcr_${crypto.randomBytes(18).toString("hex")}`,
    actionDigest: crypto.randomBytes(32).toString("hex"),
    issuedAt: new Date(now - 1_000),
    expiresAt: new Date(now + 20_000),
    firstIssuer: "universal-core-staging",
    firstReceiptDigest: crypto.randomBytes(32).toString("hex"),
    secondIssuer: "nyra-staging",
    secondReceiptDigest: crypto.randomBytes(32).toString("hex"),
    ...overrides,
  };
}

function consumeReceiptPair(queryable, input) {
  return queryable.query(
    `SELECT consumed_issuer
     FROM mcp_collaboration_control.consume_receipt_pair(
       $1::varchar,$2::varchar,$3::char(64),$4::timestamptz,$5::timestamptz,
       $6::varchar,$7::char(64),$8::varchar,$9::char(64)
     )
     ORDER BY consumed_issuer`,
    [
      input.tenantId,
      input.jti,
      input.actionDigest,
      input.issuedAt,
      input.expiresAt,
      input.firstIssuer,
      input.firstReceiptDigest,
      input.secondIssuer,
      input.secondReceiptDigest,
    ],
  );
}

async function receiptCount(pool, jti) {
  const result = await pool.query(
    `SELECT count(*)::integer AS receipt_count
     FROM mcp_collaboration_control.consumed_receipts
     WHERE tenant_id=$1 AND jti=$2`,
    ["codexai", jti],
  );
  return result.rows[0]?.receipt_count;
}

test("real PostgreSQL migration is idempotent and the schema gate is ready", { timeout: 30_000 }, async () => {
  // Deliberately no skip and no fallback: a missing dedicated test DSN must make
  // `npm run test:postgres` fail instead of reporting a false green.
  const connectionString = loadCollaborationTestDatabaseUrl(process.env);
  const poolOptions = testPoolOptions(connectionString);
  const pool = new Pool(poolOptions);

  try {
    const database = await pool.query("SELECT current_database() AS database_name");
    assert.equal(database.rows[0]?.database_name, poolOptions.database);

    const firstMigration = await applyCollaborationPostgresMigration(pool, { controlPlane: true });
    assert.equal(firstMigration.ready, true);
    assert.equal(firstMigration.checksum, COLLABORATION_SCHEMA_CHECKSUM);
    const firstMarker = await migrationMarker(pool);
    const firstGate = await verifyCollaborationPostgresSchema(pool, { controlPlane: true });
    assert.equal(firstGate.ready, true);
    assert.equal(firstGate.checksum, COLLABORATION_SCHEMA_CHECKSUM);

    const secondMigration = await applyCollaborationPostgresMigration(pool, { controlPlane: true });
    assert.equal(secondMigration.ready, true);
    assert.equal(secondMigration.checksum, COLLABORATION_SCHEMA_CHECKSUM);
    const secondMarker = await migrationMarker(pool);
    const secondGate = await verifyCollaborationPostgresSchema(pool, { controlPlane: true });
    assert.equal(secondGate.ready, true);
    assert.equal(secondGate.checksum, COLLABORATION_SCHEMA_CHECKSUM);

    assert.deepEqual(secondMarker, firstMarker);
  } catch {
    // Database errors can contain connection metadata. Keep test output closed
    // to a stable code and never surface the DSN, username, or password.
    throw new Error("collaboration_postgres_integration_failed");
  } finally {
    await pool.end().catch(() => {});
  }
});

test("real runtime role enforces RLS, least privilege, and atomic receipt consumption", { timeout: 45_000 }, async () => {
  const connectionString = loadCollaborationTestDatabaseUrl(process.env);
  const controlPlaneOptions = testPoolOptions(connectionString);
  const controlPlanePool = new Pool(controlPlaneOptions);
  const runtimeRole = `mcp_it_runtime_${process.pid}_${crypto.randomBytes(6).toString("hex")}`;
  const quotedRuntimeRole = quoteTestRole(runtimeRole);
  const runtimePassword = crypto.randomBytes(32).toString("hex");
  const agentSessionId = `postgres-it-${crypto.randomBytes(10).toString("hex")}`;
  let runtimePool;
  let runtimeRoleCreated = false;
  let failure;

  try {
    await applyCollaborationPostgresMigration(controlPlanePool, { controlPlane: true });
    await controlPlanePool.query(
      `CREATE ROLE ${quotedRuntimeRole}
       WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
       NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`,
    );
    runtimeRoleCreated = true;
    await configureCollaborationRuntimeRole(controlPlanePool, runtimeRole, { controlPlane: true });

    runtimePool = new Pool({
      ...controlPlaneOptions,
      user: runtimeRole,
      password: runtimePassword,
      application_name: "skinharmony-core-mcp-postgres-integration-runtime",
    });

    const runtimeGate = await verifyCollaborationPostgresSchema(runtimePool, {
      expectedRuntimeRole: runtimeRole,
    });
    assert.equal(runtimeGate.ready, true);
    assert.equal(runtimeGate.checksum, COLLABORATION_SCHEMA_CHECKSUM);

    const roleState = await runtimePool.query(
      `SELECT current_user AS current_role,session_user AS session_role,
              role.rolinherit,role.rolsuper,role.rolcreatedb,role.rolcreaterole,
              role.rolreplication,role.rolbypassrls,
              current_setting('row_security') AS row_security,
              regexp_replace(current_setting('search_path'),'[[:space:]]+','','g') AS search_path,
              has_schema_privilege(current_user,'public','USAGE') AS public_usage,
              has_schema_privilege(current_user,'public','CREATE') AS public_create,
              has_schema_privilege(current_user,'mcp_collaboration_control','USAGE') AS control_usage,
              has_schema_privilege(current_user,'mcp_collaboration_control','CREATE') AS control_create,
              has_table_privilege(current_user,'public.agent_sessions','SELECT') AS sessions_select,
              has_table_privilege(current_user,'public.agent_sessions','INSERT') AS sessions_insert,
              has_table_privilege(current_user,'public.agent_sessions','UPDATE') AS sessions_update,
              has_table_privilege(current_user,'public.agent_sessions','DELETE') AS sessions_delete,
              has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','SELECT') AS receipts_select,
              has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','INSERT') AS receipts_insert,
              has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','SELECT') AS trust_select,
              has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','INSERT') AS trust_insert,
              has_function_privilege(current_user,
                'mcp_collaboration_control.consume_receipt_pair(character varying,character varying,character,timestamp with time zone,timestamp with time zone,character varying,character,character varying,character)',
                'EXECUTE') AS receipt_execute,
              has_function_privilege(current_user,
                'mcp_collaboration_control.pin_or_verify_issuer_pair(character varying,character,character varying,character,character)',
                'EXECUTE') AS trust_execute
       FROM pg_roles role
       WHERE role.rolname=current_user`,
    );
    assert.equal(roleState.rowCount, 1);
    assert.deepEqual(roleState.rows[0], {
      current_role: runtimeRole,
      session_role: runtimeRole,
      rolinherit: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      row_security: "on",
      search_path: "pg_catalog,public,pg_temp",
      public_usage: true,
      public_create: false,
      control_usage: true,
      control_create: false,
      sessions_select: true,
      sessions_insert: true,
      sessions_update: true,
      sessions_delete: false,
      receipts_select: false,
      receipts_insert: false,
      trust_select: false,
      trust_insert: false,
      receipt_execute: true,
      trust_execute: true,
    });

    const coreKid = `ed25519-sha256:${"1".repeat(64)}`;
    const nyraKid = `ed25519-sha256:${"2".repeat(64)}`;
    const coreDigest = "3".repeat(64);
    const nyraDigest = "4".repeat(64);
    const pinTrust = () => runtimePool.query(
      `SELECT mcp_collaboration_control.pin_or_verify_issuer_pair(
         $1::varchar,$2::char(64),$3::varchar,$4::char(64),$5::char(40)
       ) AS verified`,
      [coreKid, coreDigest, nyraKid, nyraDigest, "a".repeat(40)],
    );
    assert.equal((await pinTrust()).rows[0]?.verified, true);
    assert.equal((await pinTrust()).rows[0]?.verified, true);
    await expectDatabaseError(
      runtimePool.query(
        `SELECT mcp_collaboration_control.pin_or_verify_issuer_pair(
           $1::varchar,$2::char(64),$3::varchar,$4::char(64),$5::char(40)
         )`,
        [coreKid, crypto.randomBytes(32).toString("hex"),
          nyraKid, nyraDigest, "a".repeat(40)],
      ),
      (error) => error?.code === "P0001" &&
        error?.message === "collaboration_trust_anchor_mismatch",
    );
    await expectDatabaseError(
      runtimePool.query(
        "SELECT 1 FROM mcp_collaboration_control.trusted_issuer_keys LIMIT 1",
      ),
      (error) => error?.code === "42501",
    );

    await runtimePool.query(
      `INSERT INTO public.agent_sessions
         (tenant_id,session_id,agent_id,actor_subject,expires_at)
       VALUES ('codexai',$1,$2,$3,clock_timestamp()+interval '5 minutes')`,
      [agentSessionId, "postgres-it-agent", "postgres-integration-test"],
    );
    const ownedSession = await runtimePool.query(
      `SELECT session_id FROM public.agent_sessions
       WHERE tenant_id='codexai' AND session_id=$1`,
      [agentSessionId],
    );
    assert.equal(ownedSession.rowCount, 1);
    await runtimePool.query(
      `UPDATE public.agent_sessions
       SET expires_at=clock_timestamp()+interval '6 minutes'
       WHERE tenant_id='codexai' AND session_id=$1`,
      [agentSessionId],
    );
    await expectDatabaseError(
      runtimePool.query(
        `INSERT INTO public.agent_sessions
           (tenant_id,session_id,agent_id,actor_subject,expires_at)
         VALUES ('other-tenant',$1,$2,$3,clock_timestamp()+interval '5 minutes')`,
        [`cross-${agentSessionId}`, "postgres-it-agent", "postgres-integration-test"],
      ),
      (error) => error?.code === "42501",
    );
    await expectDatabaseError(
      runtimePool.query(
        "DELETE FROM public.agent_sessions WHERE tenant_id='codexai' AND session_id=$1",
        [agentSessionId],
      ),
      (error) => error?.code === "42501",
    );
    await expectDatabaseError(
      runtimePool.query("SELECT 1 FROM mcp_collaboration_control.consumed_receipts LIMIT 1"),
      (error) => error?.code === "42501",
    );

    const partialReceipt = receiptInput();
    const controlPlaneClient = await controlPlanePool.connect();
    try {
      await controlPlaneClient.query("BEGIN");
      await controlPlaneClient.query(
        `INSERT INTO mcp_collaboration_control.consumed_receipts
           (tenant_id,issuer,jti,receipt_digest,action_digest)
         VALUES ($1,$2,$3,$4,$5)`,
        [partialReceipt.tenantId, partialReceipt.firstIssuer, partialReceipt.jti,
          partialReceipt.firstReceiptDigest, partialReceipt.actionDigest],
      );
      await controlPlaneClient.query(`SET LOCAL ROLE ${quotedRuntimeRole}`);
      await controlPlaneClient.query("SAVEPOINT partial_pair");
      await expectDatabaseError(
        consumeReceiptPair(controlPlaneClient, partialReceipt),
        (error) => error?.code === "P0001" &&
          error?.message === "collaboration_receipt_expired_or_replayed",
      );
      await controlPlaneClient.query("ROLLBACK TO SAVEPOINT partial_pair");
      await controlPlaneClient.query("RESET ROLE");
      assert.equal(await receiptCount(controlPlaneClient, partialReceipt.jti), 1);
      await controlPlaneClient.query("ROLLBACK");
    } catch (error) {
      try { await controlPlaneClient.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      controlPlaneClient.release();
    }
    assert.equal(await receiptCount(controlPlanePool, partialReceipt.jti), 0);

    const receipt = receiptInput();
    const runtimeClient = await runtimePool.connect();
    try {
      await runtimeClient.query("BEGIN");
      const firstPair = await consumeReceiptPair(runtimeClient, receipt);
      assert.deepEqual(
        firstPair.rows.map((row) => row.consumed_issuer),
        [receipt.firstIssuer, receipt.secondIssuer].sort(),
      );

      await runtimeClient.query("SAVEPOINT replay_pair");
      await expectDatabaseError(
        consumeReceiptPair(runtimeClient, receipt),
        (error) => error?.code === "P0001" &&
          error?.message === "collaboration_receipt_expired_or_replayed",
      );
      await runtimeClient.query("ROLLBACK TO SAVEPOINT replay_pair");
      await runtimeClient.query("ROLLBACK");
    } catch (error) {
      try { await runtimeClient.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      runtimeClient.release();
    }
    assert.equal(await receiptCount(controlPlanePool, receipt.jti), 0);

    const expiredReceipt = receiptInput({
      issuedAt: new Date(Date.now() - 40_000),
      expiresAt: new Date(Date.now() - 10_000),
    });
    await expectDatabaseError(
      consumeReceiptPair(runtimePool, expiredReceipt),
      (error) => error?.code === "P0001" &&
        error?.message === "collaboration_receipt_invalid",
    );
    assert.equal(await receiptCount(controlPlanePool, expiredReceipt.jti), 0);
  } catch {
    failure = new Error("collaboration_postgres_runtime_integration_failed");
  } finally {
    if (runtimePool) {
      try { await runtimePool.end(); } catch {
        failure ||= new Error("collaboration_postgres_runtime_cleanup_failed");
      }
    }
    try {
      await controlPlanePool.query(
        "DELETE FROM public.agent_sessions WHERE tenant_id='codexai' AND session_id=$1",
        [agentSessionId],
      );
      if (runtimeRoleCreated) {
        await controlPlanePool.query(`DROP OWNED BY ${quotedRuntimeRole}`);
        await controlPlanePool.query(`DROP ROLE ${quotedRuntimeRole}`);
      }
    } catch {
      failure ||= new Error("collaboration_postgres_runtime_cleanup_failed");
    }
    try { await controlPlanePool.end(); } catch {
      failure ||= new Error("collaboration_postgres_runtime_cleanup_failed");
    }
  }

  if (failure) throw failure;
});
