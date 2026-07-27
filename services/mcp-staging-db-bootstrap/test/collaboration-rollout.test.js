import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapMcpStagingCollaborationDatabaseWithControlPlane,
  collaborationRolloutContract,
  McpStagingCollaborationRolloutError,
} from "../src/collaboration-rollout.js";
import { bootstrapConstants } from "../src/bootstrap.js";
import { collaborationSchemaContract } from
  "../../skinharmony-core-mcp/src/collaboration-postgres-schema.js";

const TARGET_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const DATABASE = "skinharmony_mcp_staging_db";
const ADMIN_PASSWORD = "admin-private-password-test-only";
const RUNTIME_PASSWORD = "runtime-provider-password-test-only";
const CONTROL_PASSWORD = "control-generated-password-test-only-0123456789abcdef";
const ADMIN_URL = `postgresql://render_staging_admin:${ADMIN_PASSWORD}@private-staging-db.invalid/${DATABASE}`;
const RUNTIME_URL =
  `postgresql://mcp_collaboration_runtime:${RUNTIME_PASSWORD}@private-staging-db.invalid/${DATABASE}`;

function rolloutEnv(mode, overrides = {}) {
  return {
    MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "staging",
    MCP_STAGING_CONTROL_PLANE_PROFILE: "collaboration",
    MCP_STAGING_DB_BOOTSTRAP_MODE: mode,
    PG_ADMIN_DATABASE_URL: mode === "initialize" ? ADMIN_URL : RUNTIME_URL,
    PG_EXPECTED_DATABASE_NAME: DATABASE,
    MCP_STAGING_GATE_CONTROL_PASSWORD: CONTROL_PASSWORD,
    UNRELATED: "preserved",
    ...overrides,
  };
}

function safeRuntimeRole(overrides = {}) {
  return {
    rolname: collaborationRolloutContract.runtime_role,
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: true,
    rolreplication: false,
    rolbypassrls: false,
    rolconfig: null,
    membership_count: 0,
    owned_database_count: 0,
    owned_relation_count: 0,
    owned_function_count: 0,
    owned_schema_count: 0,
    ...overrides,
  };
}

function safeControlRole() {
  return {
    rolname: bootstrapConstants.controlRole,
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolreplication: false,
    rolbypassrls: false,
  };
}

class RolloutPostgres {
  constructor({
    runtimeAvailableAfter = 1,
    runtimeOverrides = {},
  } = {}) {
    this.calls = [];
    this.poolOpens = [];
    this.poolEnds = 0;
    this.releases = 0;
    this.runtimeAvailableAfter = runtimeAvailableAfter;
    this.runtimeRoleReads = 0;
    this.runtime = safeRuntimeRole(runtimeOverrides);
    this.controlExists = false;
    this.controlMembershipReady = false;
    this.gateSchemaReady = false;
    this.marker = null;
  }

  record(kind, sql, values) {
    this.calls.push({
      kind,
      sql,
      values: values.map((value) => value === CONTROL_PASSWORD ? "[bound-control-secret]" : value),
    });
  }

  poolFactory = async (config) => {
    const parsed = new URL(config.connectionString);
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    if (user === collaborationRolloutContract.runtime_role) {
      throw new Error("runtime_reference_must_not_be_opened");
    }
    const kind = user === "render_staging_admin" ? "admin" :
      user === bootstrapConstants.controlRole ? "control" : "unknown";
    if (kind === "unknown") throw new Error("unexpected_provider_identity");
    assert.equal(parsed.hostname, "private-staging-db.invalid");
    assert.equal(parsed.pathname, `/${DATABASE}`);
    assert.equal(
      password,
      kind === "admin" ? ADMIN_PASSWORD : CONTROL_PASSWORD,
    );
    this.poolOpens.push({ kind, user, database: parsed.pathname, passwordVerified: true });
    const database = this;
    return {
      async connect() {
        return {
          query(sql, values = []) {
            return database.query(kind, sql, values);
          },
          release() {
            database.releases += 1;
          },
        };
      },
      query(sql, values = []) {
        return database.query(kind, sql, values);
      },
      async end() {
        database.poolEnds += 1;
      },
    };
  };

  runtimeRoleResult() {
    this.runtimeRoleReads += 1;
    if (this.runtimeRoleReads < this.runtimeAvailableAfter) return { rows: [], rowCount: 0 };
    return { rows: [{ ...this.runtime }], rowCount: 1 };
  }

  async query(kind, sql, values) {
    this.record(kind, sql, values);
    if (kind === "admin") return this.adminQuery(sql, values);
    return this.controlQuery(sql, values);
  }

  async adminQuery(sql, values) {
    if (sql.includes("FROM pg_roles role WHERE role.rolname=$1") &&
        values[0] === collaborationRolloutContract.runtime_role &&
        !sql.includes("SELECT current_user,role.")) {
      return this.runtimeRoleResult();
    }
    if (sql.includes("admin_role.rolcreaterole AS admin_create_role")) {
      return {
        rows: [{
          current_user: "render_staging_admin",
          session_user: "render_staging_admin",
          database_name: DATABASE,
          database_owner: "render_staging_admin",
          admin_superuser: false,
          admin_create_role: true,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM pg_roles role WHERE role.rolname=$1") &&
        values[0] === bootstrapConstants.controlRole) {
      const rows = this.controlExists ? [safeControlRole()] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("AS outgoing_count") && sql.includes("pg_auth_members")) {
      const count = this.controlMembershipReady ? 1 : 0;
      return {
        rows: [{ outgoing_count: 0, incoming_count: count, exact_incoming_count: count }],
        rowCount: 1,
      };
    }
    if (sql === "SELECT pg_temp.mcp_staging_configure_control_role($1::text)") {
      assert.equal(values[0], CONTROL_PASSWORD);
      this.controlExists = true;
      return { rows: [{}], rowCount: 1 };
    }
    if (sql.startsWith(`GRANT "${bootstrapConstants.controlRole}" TO "render_staging_admin"`)) {
      this.controlMembershipReady = true;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith(`ALTER ROLE "${collaborationRolloutContract.runtime_role}"`) &&
        sql.includes("NOINHERIT")) {
      this.runtime.rolinherit = false;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith(`ALTER ROLE "${collaborationRolloutContract.runtime_role}" SET search_path`)) {
      const existing = new Set(this.runtime.rolconfig || []);
      existing.add("search_path=pg_catalog, public, pg_temp");
      this.runtime.rolconfig = [...existing];
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith(`ALTER ROLE "${collaborationRolloutContract.runtime_role}" SET row_security`)) {
      const existing = new Set(this.runtime.rolconfig || []);
      existing.add("row_security=on");
      this.runtime.rolconfig = [...existing];
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("SELECT current_user,role.rolname") &&
        values[0] === collaborationRolloutContract.runtime_role) {
      return {
        rows: [{
          current_user: "render_staging_admin",
          ...this.runtime,
          membership_count: 0,
        }],
        rowCount: 1,
      };
    }
    if (sql.startsWith(`CREATE SCHEMA IF NOT EXISTS "${bootstrapConstants.gateSchema}"`)) {
      this.gateSchemaReady = true;
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  async controlQuery(sql, values) {
    if (sql.includes("FROM pg_namespace namespace WHERE namespace.nspname=$1")) {
      const rows = this.gateSchemaReady ? [{
        current_user: bootstrapConstants.controlRole,
        session_user: bootstrapConstants.controlRole,
        database_name: DATABASE,
        schema_owner: bootstrapConstants.controlRole,
      }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith(`INSERT INTO ${bootstrapConstants.gateSchema}.bootstrap_schema_version`)) {
      this.marker ||= {
        schema_version: values[0],
        policy_checksum: values[1],
        table_owner: bootstrapConstants.controlRole,
      };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("pg_get_userbyid(marker.relowner) AS table_owner")) {
      return { rows: this.marker ? [{ ...this.marker }] : [], rowCount: this.marker ? 1 : 0 };
    }
    if (sql.includes("runtime_destructive_denied")) {
      return {
        rows: [{
          current_user: bootstrapConstants.controlRole,
          session_user: bootstrapConstants.controlRole,
          database_name: DATABASE,
          database_owner: "render_staging_admin",
          control_login: true,
          control_superuser: false,
          control_createdb: false,
          control_createrole: false,
          control_inherit: false,
          control_replication: false,
          control_bypassrls: false,
          runtime_login: true,
          runtime_superuser: false,
          runtime_createdb: false,
          runtime_createrole: false,
          runtime_inherit: this.runtime.rolinherit,
          runtime_replication: false,
          runtime_bypassrls: false,
          runtime_config: this.runtime.rolconfig,
          runtime_membership_count: this.runtime.membership_count,
          control_outgoing_membership_count: 0,
          runtime_owned_relations: 0,
          runtime_owned_functions: 0,
          runtime_owned_schemas: 0,
          runtime_connect: true,
          runtime_create: false,
          runtime_temporary: false,
          runtime_public_usage: true,
          runtime_public_create: false,
          runtime_control_usage: true,
          runtime_control_create: false,
          runtime_gate_usage: false,
          runtime_destructive_denied: true,
          runtime_grant_options_denied: true,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }
}

function exactMigrationResult() {
  return Object.freeze({
    ready: true,
    version: collaborationSchemaContract.version,
    migration_id: collaborationSchemaContract.migration_id,
    checksum: collaborationSchemaContract.checksum,
  });
}

function dependencyHarness() {
  const calls = { migration: 0, verification: 0, controlPlane: 0 };
  return {
    calls,
    migrationApplier: async (_pool, options) => {
      assert.deepEqual(options, { controlPlane: true });
      calls.migration += 1;
      return exactMigrationResult();
    },
    schemaVerifier: async (_pool, options) => {
      assert.deepEqual(options, { controlPlane: true });
      calls.verification += 1;
      return exactMigrationResult();
    },
    controlPlaneFactory: async (capability, binding) => {
      calls.controlPlane += 1;
      assert.deepEqual(binding, { profile: "collaboration", targetCommit: TARGET_COMMIT });
      assert.equal(capability.profile, "collaboration");
      assert.equal(capability.targetCommit, TARGET_COMMIT);
      const connection = new URL(capability.takeConnectionString());
      assert.equal(decodeURIComponent(connection.username), bootstrapConstants.controlRole);
      assert.equal(decodeURIComponent(connection.password), CONTROL_PASSWORD);
      assert.throws(
        () => capability.takeConnectionString(),
        /collaboration_rollout_control_plane_capability_consumed/,
      );
      return Object.freeze({
        profile: "collaboration",
        issuerReplayStore: Object.freeze({ durable: true, claim: async () => true }),
        verifyAndConsumeReceipt: async () => {
          throw new Error("receipt_consumer_fail_closed");
        },
        close: async () => {},
      });
    },
  };
}

async function runRollout(postgres, harness, mode, overrides = {}) {
  const env = rolloutEnv(mode, overrides.env || {});
  const result = await bootstrapMcpStagingCollaborationDatabaseWithControlPlane({
    env,
    targetCommit: overrides.targetCommit || TARGET_COMMIT,
    poolFactory: postgres.poolFactory,
    migrationApplier: harness.migrationApplier,
    schemaVerifier: harness.schemaVerifier,
    controlPlaneFactory: harness.controlPlaneFactory,
    runtimeRoleAttempts: overrides.runtimeRoleAttempts,
    runtimeRolePollMs: overrides.runtimeRolePollMs,
    sleep: overrides.sleep || (async () => {}),
  });
  return { env, result };
}

test("initialize is idempotent, applies the checksum-bound migration, then steady uses only endpoint plus control secret", async () => {
  const postgres = new RolloutPostgres();
  const harness = dependencyHarness();

  const first = await runRollout(postgres, harness, "initialize");
  const second = await runRollout(postgres, harness, "initialize");
  const steady = await runRollout(postgres, harness, "steady");

  for (const execution of [first, second, steady]) {
    assert.deepEqual(execution.result.health, {
      ok: true,
      status: "ready",
      environment: "staging",
      schema_version: 2,
      role_count: 2,
      isolation: "verified",
      secrets_exposed: false,
    });
    assert.deepEqual(execution.env, {
      MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "staging",
      MCP_STAGING_CONTROL_PLANE_PROFILE: "collaboration",
      MCP_STAGING_DB_BOOTSTRAP_MODE: execution === steady ? "steady" : "initialize",
      PG_EXPECTED_DATABASE_NAME: DATABASE,
      UNRELATED: "preserved",
    });
  }
  assert.deepEqual(harness.calls, { migration: 2, verification: 3, controlPlane: 3 });
  assert.deepEqual(
    postgres.poolOpens.map(({ kind }) => kind),
    ["admin", "control", "admin", "control", "control"],
  );
  assert.equal(postgres.poolOpens.some(({ user }) =>
    user === collaborationRolloutContract.runtime_role), false);
  assert.equal(postgres.marker.schema_version, bootstrapConstants.schemaVersion);
  assert.equal(postgres.marker.policy_checksum, bootstrapConstants.policyChecksum);
  const sql = postgres.calls.map(({ sql: statement }) => statement).join("\n");
  assert.match(sql, /pg_temp\.mcp_staging_configure_control_role/);
  assert.match(sql, /PASSWORD %L/);
  assert.match(sql, /ALTER ROLE "mcp_collaboration_runtime".*NOINHERIT/s);
  assert.doesNotMatch(sql, /CREATE ROLE\s+"?mcp_collaboration_runtime/i);
  assert.match(sql, /SET LOCAL ROLE "mcp_staging_gate_control"/);
  assert.match(sql, /RESET ROLE/);
  assert.equal(JSON.stringify([postgres.calls, first.result, second.result, steady.result])
    .includes(ADMIN_PASSWORD), false);
  assert.equal(JSON.stringify([postgres.calls, first.result, second.result, steady.result])
    .includes(RUNTIME_PASSWORD), false);
  assert.equal(JSON.stringify([postgres.calls, first.result, second.result, steady.result])
    .includes(CONTROL_PASSWORD), false);
});

test("initialize waits for the provider runtime role and never creates it in SQL", async () => {
  const postgres = new RolloutPostgres({ runtimeAvailableAfter: 3 });
  const harness = dependencyHarness();
  let waits = 0;
  await runRollout(postgres, harness, "initialize", {
    runtimeRoleAttempts: 3,
    runtimeRolePollMs: 1,
    sleep: async () => { waits += 1; },
  });
  assert.equal(postgres.runtimeRoleReads >= 3, true);
  assert.equal(waits, 2);
  assert.equal(postgres.calls.some(({ sql }) =>
    /CREATE ROLE\s+"?mcp_collaboration_runtime/i.test(sql)), false);
});

test("missing or unsafe provider runtime role fails before migration and secret output", async (t) => {
  for (const [name, postgres, code] of [
    ["missing", new RolloutPostgres({ runtimeAvailableAfter: Number.POSITIVE_INFINITY }),
      "collaboration_rollout_runtime_role_missing"],
    ["unsafe", new RolloutPostgres({ runtimeOverrides: { rolsuper: true } }),
      "collaboration_rollout_runtime_role_unsafe"],
  ]) {
    await t.test(name, async () => {
      const harness = dependencyHarness();
      const env = rolloutEnv("initialize");
      await assert.rejects(
        bootstrapMcpStagingCollaborationDatabaseWithControlPlane({
          env,
          targetCommit: TARGET_COMMIT,
          poolFactory: postgres.poolFactory,
          migrationApplier: harness.migrationApplier,
          schemaVerifier: harness.schemaVerifier,
          controlPlaneFactory: harness.controlPlaneFactory,
          runtimeRoleAttempts: 2,
          runtimeRolePollMs: 0,
        }),
        (error) => error instanceof McpStagingCollaborationRolloutError &&
          error.code === code && !String(error).includes(ADMIN_PASSWORD) &&
          !String(error).includes(RUNTIME_PASSWORD) && !String(error).includes(CONTROL_PASSWORD),
      );
      assert.equal(harness.calls.migration, 0);
      assert.equal(postgres.controlExists, false);
      assert.equal("PG_ADMIN_DATABASE_URL" in env, false);
      assert.equal("MCP_STAGING_GATE_CONTROL_PASSWORD" in env, false);
    });
  }
});

test("profile, phase, target commit and provider references fail closed before any database connection", async (t) => {
  const cases = [
    ["profile", { env: { MCP_STAGING_CONTROL_PLANE_PROFILE: "render_executor" } },
      "collaboration_rollout_profile_invalid"],
    ["phase", { env: { MCP_STAGING_DB_BOOTSTRAP_MODE: "unknown" } },
      "collaboration_rollout_mode_invalid"],
    ["commit", { targetCommit: "not-a-commit" }, "collaboration_rollout_target_commit_invalid"],
    ["steady identity", {
      mode: "steady",
      env: { PG_ADMIN_DATABASE_URL: ADMIN_URL },
    }, "collaboration_rollout_steady_reference_invalid"],
    ["weak secret", { env: { MCP_STAGING_GATE_CONTROL_PASSWORD: "short" } },
      "collaboration_rollout_secret_invalid"],
  ];
  for (const [name, overrides, code] of cases) {
    await t.test(name, async () => {
      let factoryCalls = 0;
      const mode = overrides.mode || "initialize";
      const env = rolloutEnv(mode, overrides.env || {});
      await assert.rejects(
        bootstrapMcpStagingCollaborationDatabaseWithControlPlane({
          env,
          targetCommit: overrides.targetCommit || TARGET_COMMIT,
          poolFactory: async () => {
            factoryCalls += 1;
            throw new Error("must_not_connect");
          },
          controlPlaneFactory: async () => {
            throw new Error("must_not_run");
          },
        }),
        (error) => error.code === code,
      );
      assert.equal(factoryCalls, 0);
      assert.equal("PG_ADMIN_DATABASE_URL" in env, false);
      assert.equal("MCP_STAGING_GATE_CONTROL_PASSWORD" in env, false);
    });
  }
});
