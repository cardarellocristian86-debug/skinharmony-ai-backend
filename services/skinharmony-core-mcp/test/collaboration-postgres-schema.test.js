import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCollaborationPostgresMigration,
  configureCollaborationRuntimeRole,
  COLLABORATION_SCHEMA_CHECKSUM,
  COLLABORATION_SCHEMA_MIGRATION_ID,
  COLLABORATION_SCHEMA_SQL,
  COLLABORATION_SCHEMA_VERSION,
  verifyCollaborationPostgresSchema,
} from "../src/collaboration-postgres-schema.js";

const marker = (overrides = {}) => ({
  version: COLLABORATION_SCHEMA_VERSION,
  migration_id: COLLABORATION_SCHEMA_MIGRATION_ID,
  checksum: COLLABORATION_SCHEMA_CHECKSUM,
  owner_role: "migration_owner",
  current_user: "mcp_runtime_test",
  session_user: "mcp_runtime_test",
  relations_ready: true,
  receipt_shape_ready: true,
  trust_shape_ready: true,
  canonical_shape_ready: true,
  receipt_primary_key_ready: true,
  canonical_keys_ready: true,
  receipt_append_only: true,
  trust_append_only: true,
  ledger_append_only: true,
  canonical_append_only: true,
  receipt_function_hardened: true,
  trust_function_hardened: true,
  canonical_function_hardened: true,
  receipt_public_execute_denied: true,
  trust_public_execute_denied: true,
  canonical_public_execute_denied: true,
  receipt_acl_exclusive: true,
  trust_acl_exclusive: true,
  canonical_acl_exclusive: true,
  control_plane_identity_ready: true,
  trusted_ownership_ready: true,
  runtime_role_separated: true,
  receipt_function_owner_separated: true,
  trust_owner_separated: true,
  canonical_owner_separated: true,
  receipt_direct_dml_denied: true,
  trust_direct_dml_denied: true,
  canonical_direct_access_denied: true,
  canonical_function_execute_denied: true,
  runtime_schema_create_denied: true,
  runtime_search_path_ready: true,
  schema_create_acl_exclusive: true,
  runtime_row_security_on: true,
  runtime_role_safe: true,
  destructive_privileges_denied: true,
  runtime_privileges_exact: true,
  runtime_acl_exclusive: true,
  runtime_grant_options_denied: true,
  receipt_consumer_executable: true,
  trust_pin_executable: true,
  tenant_isolation_ready: true,
  decision_view_security_invoker: true,
  ...overrides,
});

test("control-plane grants the runtime only enumerated DML and receipt function execution", async () => {
  const calls = [];
  let released = false;
  const pool = {
    async query() { return result(); },
    async connect() {
      return {
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (sql.includes("FROM pg_roles role")) return result([{
            current_user: "migration_owner",
            rolname: "mcp_runtime_test",
            rolcanlogin: true,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: false,
            rolinherit: false,
            membership_count: 0,
          }]);
          return result();
        },
        release() { released = true; },
      };
    },
  };
  const configured = await configureCollaborationRuntimeRole(pool, "mcp_runtime_test", { controlPlane: true });
  assert.equal(configured.configured, true);
  assert(calls.some(({ sql }) => sql.includes("GRANT SELECT,INSERT,UPDATE ON TABLE")));
  assert(calls.some(({ sql }) => sql.includes("REVOKE ALL ON SCHEMA public,mcp_collaboration_control")));
  assert(calls.some(({ sql }) => sql.includes("REVOKE ALL ON TABLE mcp_collaboration_control.consumed_receipts")));
  assert(calls.some(({ sql }) => sql.includes("GRANT EXECUTE ON FUNCTION mcp_collaboration_control.consume_receipt_pair")));
  assert(calls.some(({ sql }) => sql.includes("REVOKE ALL ON TABLE mcp_collaboration_control.trusted_issuer_keys")));
  assert(calls.some(({ sql }) => sql.includes("GRANT EXECUTE ON FUNCTION mcp_collaboration_control.pin_or_verify_issuer_pair")));
  assert(calls.some(({ sql }) => sql.includes("REVOKE ALL ON TABLE mcp_collaboration_control.canonical_bootstrap_consumptions")));
  assert(calls.some(({ sql }) => sql.includes("REVOKE ALL ON FUNCTION mcp_collaboration_control.reject_canonical_bootstrap_mutation")));
  assert.equal(calls.some(({ sql }) =>
    /GRANT .*canonical_bootstrap_consumptions|GRANT .*reject_canonical_bootstrap_mutation/i.test(sql)), false);
  assert.equal(calls.some(({ sql }) => /GRANT .*DELETE|GRANT .*TRUNCATE|GRANT .*CREATE ON SCHEMA/i.test(sql)), false);
  assert.equal(released, true);

  const unsafe = {
    async query() { return result(); },
    async connect() {
      return {
        async query(sql) {
          if (sql.includes("FROM pg_roles role")) return result([{
            current_user: "mcp_runtime_test",
            rolname: "mcp_runtime_test",
            rolcanlogin: true,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: false,
            rolinherit: false,
            membership_count: 0,
          }]);
          return result();
        },
        release() {},
      };
    },
  };
  await assert.rejects(
    configureCollaborationRuntimeRole(unsafe, "mcp_runtime_test", { controlPlane: true }),
    /collaboration_runtime_role_unsafe/,
  );
});
const result = (rows = []) => ({ rows, rowCount: rows.length });

class MigrationPool {
  constructor({ existing = [] } = {}) {
    this.existing = existing;
    this.clientCalls = [];
    this.poolCalls = [];
    this.released = false;
  }
  async connect() {
    return {
      query: async (sql, params = []) => {
        this.clientCalls.push({ sql, params });
        if (sql.includes("FROM public.mcp_collaboration_schema_migrations") && sql.includes("FOR UPDATE")) {
          return result(this.existing);
        }
        if (sql.startsWith("SELECT migration.version")) return result([marker({ current_user: "migration_owner", session_user: "migration_owner" })]);
        return result();
      },
      release: () => { this.released = true; },
    };
  }
  async query(sql, params = []) {
    this.poolCalls.push({ sql, params });
    return result([marker()]);
  }
}

test("control-plane migration is transactional, checksum-bound and idempotent", async () => {
  const fresh = new MigrationPool();
  const applied = await applyCollaborationPostgresMigration(fresh, { controlPlane: true });
  assert.equal(applied.ready, true);
  assert.equal(fresh.clientCalls[0].sql, "BEGIN");
  assert.equal(fresh.clientCalls[1].sql, "SET LOCAL search_path = public, pg_catalog, pg_temp");
  assert.match(fresh.clientCalls[2].sql, /pg_advisory_xact_lock/);
  assert(fresh.clientCalls.some(({ sql }) => sql === COLLABORATION_SCHEMA_SQL));
  assert.match(COLLABORATION_SCHEMA_SQL, /SECURITY DEFINER/);
  assert.match(COLLABORATION_SCHEMA_SQL, /pg_advisory_xact_lock/);
  assert.match(COLLABORATION_SCHEMA_SQL, /p_expires_at - p_issued_at > interval '30 seconds'/);
  assert.match(COLLABORATION_SCHEMA_SQL, /inserted_count <> 2/);
  assert.match(COLLABORATION_SCHEMA_SQL, /STRICT/);
  assert.match(COLLABORATION_SCHEMA_SQL, /p_first_issuer <> 'universal-core-staging'/);
  assert.match(COLLABORATION_SCHEMA_SQL, /p_second_issuer <> 'nyra-staging'/);
  assert.match(COLLABORATION_SCHEMA_SQL, /FORCE ROW LEVEL SECURITY/);
  assert.match(COLLABORATION_SCHEMA_SQL, /REVOKE ALL ON TABLE mcp_collaboration_control\.consumed_receipts FROM PUBLIC/);
  assert.match(COLLABORATION_SCHEMA_SQL, /trusted_issuer_keys/);
  assert.match(COLLABORATION_SCHEMA_SQL, /pin_or_verify_issuer_pair/);
  assert.equal(COLLABORATION_SCHEMA_VERSION, 3);
  assert.equal(COLLABORATION_SCHEMA_MIGRATION_ID, "0003_canonical_shared_memory_bootstrap");
  assert.match(COLLABORATION_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS mcp_collaboration_control\.canonical_bootstrap_consumptions/);
  assert.match(COLLABORATION_SCHEMA_SQL, /canonical_bootstrap_consumptions_no_mutation/);
  assert.match(COLLABORATION_SCHEMA_SQL, /ALTER TABLE mcp_collaboration_control\.canonical_bootstrap_consumptions OWNER TO CURRENT_USER/);
  assert.match(COLLABORATION_SCHEMA_SQL, /REVOKE ALL ON TABLE mcp_collaboration_control\.canonical_bootstrap_consumptions FROM PUBLIC/);
  assert.match(COLLABORATION_SCHEMA_SQL, /REVOKE ALL ON FUNCTION mcp_collaboration_control\.reject_canonical_bootstrap_mutation\(\) FROM PUBLIC/);
  assert(fresh.clientCalls.some(({ sql }) => sql.includes("INSERT INTO public.mcp_collaboration_schema_migrations")));
  assert(fresh.clientCalls.some(({ sql }) => sql === "COMMIT"));
  assert.equal(fresh.released, true);

  const existing = new MigrationPool({ existing: [marker()] });
  await applyCollaborationPostgresMigration(existing, { controlPlane: true });
  assert.equal(existing.clientCalls.some(({ sql }) => sql === COLLABORATION_SCHEMA_SQL), false);
  assert.equal(existing.clientCalls.some(({ sql }) => sql.includes("INSERT INTO public.mcp_collaboration_schema_migrations")), false);
});

test("migration rejects missing control-plane authority and divergent checksums", async () => {
  await assert.rejects(
    applyCollaborationPostgresMigration(new MigrationPool()),
    /collaboration_schema_control_plane_required/,
  );
  const mismatched = new MigrationPool({ existing: [marker({ checksum: "0".repeat(64) })] });
  await assert.rejects(
    applyCollaborationPostgresMigration(mismatched, { controlPlane: true }),
    /collaboration_schema_checksum_mismatch/,
  );
  assert(mismatched.clientCalls.some(({ sql }) => sql === "ROLLBACK"));
  assert.equal(mismatched.released, true);
});

test("runtime schema gate is strictly read-only and fails closed", async () => {
  const readyPool = new MigrationPool();
  const verified = await verifyCollaborationPostgresSchema(readyPool, { expectedRuntimeRole: "mcp_runtime_test" });
  assert.equal(verified.checksum, COLLABORATION_SCHEMA_CHECKSUM);
  assert.equal(readyPool.clientCalls.length, 0);
  assert.equal(readyPool.poolCalls.length, 1);
  assert.match(readyPool.poolCalls[0].sql, /^SELECT/);

  const missing = new MigrationPool();
  missing.query = async () => result([]);
  await assert.rejects(verifyCollaborationPostgresSchema(missing, { expectedRuntimeRole: "mcp_runtime_test" }), /collaboration_schema_not_ready/);

  const unavailable = new MigrationPool();
  unavailable.query = async () => { throw new Error("private database detail"); };
  await assert.rejects(verifyCollaborationPostgresSchema(unavailable, { expectedRuntimeRole: "mcp_runtime_test" }), (error) => {
    assert.equal(error.message, "collaboration_schema_not_ready");
    assert.equal(error.message.includes("private database detail"), false);
    return true;
  });

  for (const drift of [
    { session_user: "migration_owner" },
    { runtime_role_safe: false },
    { trusted_ownership_ready: false },
    { receipt_function_hardened: false },
    { trust_function_hardened: false },
    { canonical_shape_ready: false },
    { canonical_keys_ready: false },
    { canonical_append_only: false },
    { canonical_function_hardened: false },
    { canonical_public_execute_denied: false },
    { canonical_acl_exclusive: false },
    { canonical_owner_separated: false },
    { canonical_direct_access_denied: false },
    { canonical_function_execute_denied: false },
    { trust_pin_executable: false },
    { tenant_isolation_ready: false },
    { runtime_search_path_ready: false },
    { schema_create_acl_exclusive: false },
    { runtime_privileges_exact: false },
    { runtime_acl_exclusive: false },
    { runtime_grant_options_denied: false },
  ]) {
    const drifted = new MigrationPool();
    drifted.query = async () => result([marker(drift)]);
    await assert.rejects(
      verifyCollaborationPostgresSchema(drifted, { expectedRuntimeRole: "mcp_runtime_test" }),
      /collaboration_schema_not_ready/,
    );
  }
});
