import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapConstants,
  bootstrapMcpStagingDatabase,
  bootstrapMcpStagingDatabaseWithControlPlane,
  McpStagingDbBootstrapError,
} from "../src/bootstrap.js";
import { createHealthServer, loadPrivatePort, scrubBootstrapEnvironment } from "../src/server.js";

const DATABASE_NAME = "skinharmony_staging";
const ADMIN_URL = `postgresql://admin:admin-password@staging-db.invalid/${DATABASE_NAME}`;
const CONTROL_PASSWORD = "C".repeat(48);

function environment(overrides = {}) {
  return {
    MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "staging",
    MCP_STAGING_CONTROL_ROLE_PROVISIONING_MODE: "provider_native",
    PG_ADMIN_DATABASE_URL: ADMIN_URL,
    PG_EXPECTED_DATABASE_NAME: DATABASE_NAME,
    MCP_STAGING_GATE_CONTROL_PASSWORD: CONTROL_PASSWORD,
    ...overrides,
  };
}

function controlRoleRow(overrides = {}) {
  return {
    rolname: bootstrapConstants.controlRole,
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolreplication: false,
    rolbypassrls: false,
    ...overrides,
  };
}

function exactMembership() {
  return { outgoing_count: 0, incoming_count: 1, exact_incoming_count: 1 };
}

function safeDatabaseIsolation() {
  return {
    public_has_privilege: false,
    control_connect: true,
    control_create: false,
    control_temporary: false,
    control_acl_count: 1,
    control_direct_connect: true,
    control_acl_unsafe: false,
    unexpected_database_grantee: false,
    other_database_access: false,
  };
}

function safeLogin(databaseName = DATABASE_NAME) {
  return {
    current_user: bootstrapConstants.controlRole,
    session_user: bootstrapConstants.controlRole,
    database_name: databaseName,
    database_connect: true,
    database_create: false,
    database_temporary: false,
    gate_usage: true,
    gate_create: true,
    outgoing_membership_count: 0,
  };
}

class FakePostgres {
  constructor(overrides = {}) {
    this.calls = [];
    this.roleExists = overrides.roleExists !== false;
    this.role = controlRoleRow(overrides.role || {});
    this.membership = overrides.membership || (this.roleExists
      ? exactMembership()
      : { outgoing_count: 0, incoming_count: 0, exact_incoming_count: 0 });
    this.schemaOwner = overrides.schemaOwner || null;
    this.markerOwner = overrides.markerOwner || null;
    this.marker = overrides.marker || null;
    this.adminRole = overrides.adminRole || "render_staging_admin";
    this.sessionRole = overrides.sessionRole || this.adminRole;
    this.databaseOwner = overrides.databaseOwner || this.adminRole;
    this.adminSuperuser = overrides.adminSuperuser === true;
    this.databaseName = overrides.databaseName || DATABASE_NAME;
    this.databaseIsolation = { ...safeDatabaseIsolation(), ...(overrides.databaseIsolation || {}) };
    this.outsidePrivilege = overrides.outsidePrivilege === true;
    this.objectRows = overrides.objectRows || null;
    this.functionRows = overrides.functionRows || [];
    this.defaultPrivilegeRows = overrides.defaultPrivilegeRows || [
      { object_type: "S", unexpected_acl_grantee: false, unexpected_owner: false },
      { object_type: "f", unexpected_acl_grantee: false, unexpected_owner: false },
      { object_type: "r", unexpected_acl_grantee: false, unexpected_owner: false },
    ];
    this.login = { ...safeLogin(this.databaseName), ...(overrides.login || {}) };
    this.currentRole = this.adminRole;
    this.poolEnds = 0;
    this.releases = 0;
    this.roleLogins = 0;
  }

  poolFactory = (config) => {
    assert.equal(config.connectionString, ADMIN_URL);
    return {
      connect: async () => ({
        query: (sql, values = []) => this.query(sql, values),
        release: () => { this.releases += 1; },
      }),
      end: async () => { this.poolEnds += 1; },
    };
  };

  clientFactory = (config) => {
    const parsed = new URL(config.connectionString);
    assert.equal(decodeURIComponent(parsed.username), bootstrapConstants.controlRole);
    assert.equal(decodeURIComponent(parsed.password), CONTROL_PASSWORD);
    this.roleLogins += 1;
    return {
      connect: async () => {
        if (!this.roleExists) throw new Error("private-provider-error");
      },
      query: async () => ({ rows: [this.login], rowCount: 1 }),
      end: async () => {},
    };
  };

  gateObjects() {
    if (this.objectRows) return this.objectRows;
    if (!this.markerOwner) return [];
    return [
      {
        relname: "bootstrap_schema_version",
        relkind: "r",
        object_owner: this.markerOwner,
        indexed_relation: null,
        unexpected_acl_grantee: false,
      },
      {
        relname: "bootstrap_schema_version_pkey",
        relkind: "i",
        object_owner: this.markerOwner,
        indexed_relation: "bootstrap_schema_version",
        unexpected_acl_grantee: false,
      },
    ];
  }

  async query(sql, values) {
    this.calls.push({ sql, values });
    if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE" || sql === "COMMIT" ||
        sql.startsWith("SELECT set_config") || sql.startsWith("SELECT pg_advisory_xact_lock")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql === "ROLLBACK") {
      this.currentRole = this.adminRole;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM pg_database database_record") && sql.includes("admin_role.rolsuper")) {
      return { rows: [{
        current_user: this.adminRole,
        session_user: this.sessionRole,
        database_name: this.databaseName,
        database_owner: this.databaseOwner,
        admin_superuser: this.adminSuperuser,
      }], rowCount: 1 };
    }
    if (sql.includes("FROM pg_roles WHERE rolname = $1")) {
      const rows = this.roleExists ? [this.role] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM pg_auth_members membership") && sql.includes("AS outgoing_count")) {
      return { rows: [this.membership], rowCount: 1 };
    }
    if (sql.startsWith("REVOKE ALL PRIVILEGES ON DATABASE") ||
        sql.startsWith("GRANT CONNECT ON DATABASE") || sql.startsWith("REVOKE ALL ON") ||
        sql.startsWith("ALTER DEFAULT PRIVILEGES")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("AS control_acl_count")) {
      return { rows: [this.databaseIsolation], rowCount: 1 };
    }
    if (sql.includes("FROM pg_namespace WHERE nspname = $1")) {
      const rows = this.schemaOwner
        ? [{ nspname: bootstrapConstants.gateSchema, schema_owner: this.schemaOwner }]
        : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("CREATE SCHEMA \"mcp_staging_gate\"")) {
      this.schemaOwner = bootstrapConstants.controlRole;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SET LOCAL ROLE")) {
      this.currentRole = bootstrapConstants.controlRole;
      return { rows: [], rowCount: 0 };
    }
    if (sql === "RESET ROLE") {
      this.currentRole = this.adminRole;
      return { rows: [], rowCount: 0 };
    }
    if (sql === "SELECT current_user, session_user") {
      return { rows: [{ current_user: this.currentRole, session_user: this.sessionRole }], rowCount: 1 };
    }
    if (sql.startsWith("CREATE TABLE mcp_staging_gate.bootstrap_schema_version")) {
      this.markerOwner = this.currentRole;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("INSERT INTO mcp_staging_gate.bootstrap_schema_version")) {
      this.marker = { schema_version: values[0], policy_checksum: values[1] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("JOIN pg_namespace namespace ON namespace.oid = marker.relnamespace")) {
      const rows = this.markerOwner
        ? [{ relname: "bootstrap_schema_version", table_owner: this.markerOwner }]
        : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT schema_version, policy_checksum FROM mcp_staging_gate.bootstrap_schema_version")) {
      return { rows: this.marker ? [this.marker] : [], rowCount: this.marker ? 1 : 0 };
    }
    if (sql.includes("has_schema_privilege") && sql.includes("AS unexpected_acl_grantee")) {
      return { rows: [{
        schema_owner: this.schemaOwner,
        unexpected_acl_grantee: false,
        control_usage: true,
        control_create: true,
      }], rowCount: 1 };
    }
    if (sql.includes("marker.oid = to_regclass") && sql.includes("AS unexpected_acl_grantee")) {
      return { rows: [{
        table_owner: this.markerOwner,
        unexpected_acl_grantee: false,
      }], rowCount: 1 };
    }
    if (sql.includes("ORDER BY object.relkind, object.relname")) {
      const rows = this.gateObjects();
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM pg_proc function_record")) {
      return { rows: this.functionRows, rowCount: this.functionRows.length };
    }
    if (sql.startsWith("WITH requested(object_type) AS")) {
      return { rows: this.defaultPrivilegeRows, rowCount: this.defaultPrivilegeRows.length };
    }
    if (sql.includes("AS can_create_outside_gate")) {
      return { rows: [{
        can_create_outside_gate: this.outsidePrivilege,
        can_access_objects_outside_gate: this.outsidePrivilege,
        can_access_sequences_outside_gate: this.outsidePrivilege,
        can_execute_functions_outside_gate: this.outsidePrivilege,
      }], rowCount: 1 };
    }
    throw new Error(`unhandled_fake_query:${sql.slice(0, 120)}`);
  }
}

function options(fake, env = environment()) {
  return {
    env,
    poolFactory: fake.poolFactory,
    clientFactory: fake.clientFactory,
    statementTimeoutMs: 2_000,
    lockTimeoutMs: 1_000,
    idleInTransactionTimeoutMs: 2_000,
    connectionTimeoutMs: 2_000,
  };
}

test("provider_native revalidates one isolated control role idempotently", async () => {
  const fake = new FakePostgres();
  const first = await bootstrapMcpStagingDatabase(options(fake));
  const second = await bootstrapMcpStagingDatabase(options(fake));

  assert.deepEqual(first, {
    ok: true,
    status: "ready",
    environment: "staging",
    schema_version: 2,
    role_count: 1,
    isolation: "verified",
    secrets_exposed: false,
  });
  assert.deepEqual(second, first);
  assert.equal(fake.roleExists, true);
  assert.equal(fake.schemaOwner, bootstrapConstants.controlRole);
  assert.equal(fake.markerOwner, bootstrapConstants.controlRole);
  assert.equal(fake.marker.policy_checksum, bootstrapConstants.policyChecksum);
  assert.equal(fake.roleLogins, 4);
  assert.equal(fake.poolEnds, 2);
  assert.equal(fake.releases, 2);
  assert.equal(fake.calls.some(({ sql }) => /CREATE ROLE|ALTER ROLE|PASSWORD/i.test(sql)), false);
  const serialized = JSON.stringify(first);
  for (const forbidden of [ADMIN_URL, CONTROL_PASSWORD, "admin-password"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("provider_native requires a pre-provisioned exact role and never changes its password", async () => {
  const missing = new FakePostgres({ roleExists: false });
  await assert.rejects(
    bootstrapMcpStagingDatabase(options(missing,
      environment({ MCP_STAGING_CONTROL_ROLE_PROVISIONING_MODE: "provider_native" }))),
    /bootstrap_provider_role_missing/,
  );
  assert.equal(missing.calls.some(({ sql }) => /CREATE ROLE|ALTER ROLE|PASSWORD/i.test(sql)), false);

  const existing = new FakePostgres({ roleExists: true });
  await bootstrapMcpStagingDatabase(options(existing,
    environment({ MCP_STAGING_CONTROL_ROLE_PROVISIONING_MODE: "provider_native" })));
  const sql = existing.calls.map(({ sql: statement }) => statement).join("\n");
  assert.doesNotMatch(sql, /ALTER ROLE/i);
  assert.doesNotMatch(sql, /CREATE ROLE %I/i);
  assert.equal(existing.roleLogins, 2);
});

test("uses PG18 membership, SET ROLE and exact database/default ACL SQL without ownership transfer", async () => {
  const fake = new FakePostgres();
  await bootstrapMcpStagingDatabase(options(fake));
  const sql = fake.calls.map((call) => call.sql).join("\n");
  assert.doesNotMatch(sql, /CREATE ROLE|ALTER ROLE|PASSWORD/i);
  assert.match(sql, /CREATE SCHEMA "mcp_staging_gate"\s+AUTHORIZATION "mcp_staging_gate_control"/);
  assert.match(sql, /SET LOCAL ROLE "mcp_staging_gate_control"/);
  assert.match(sql, /RESET ROLE/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON DATABASE "skinharmony_staging" FROM PUBLIC/);
  assert.match(sql, /GRANT CONNECT ON DATABASE "skinharmony_staging"/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA mcp_staging_gate/);
  assert.match(sql, /membership\.inherit_option IS FALSE/);
  assert.match(sql, /membership\.set_option IS TRUE/);
  assert.match(sql, /has_sequence_privilege/);
  assert.match(sql, /has_function_privilege/);
  assert.match(sql, /has_any_column_privilege/);
  assert.doesNotMatch(sql, /ALTER\s+(?:TABLE|SCHEMA).*OWNER TO/i);
  assert.doesNotMatch(sql, /ALTER DEFAULT PRIVILEGES\s+(?:FOR ROLE|FOR USER)/i);
  assert.doesNotMatch(sql, /mcp_staging_runtime|mcp_collaboration/);
  assert.doesNotMatch(sql, /DROP\s+(?:ROLE|SCHEMA|TABLE|DATABASE)/i);
  assert.equal(sql.includes(ADMIN_URL), false);
  assert.equal(sql.includes(CONTROL_PASSWORD), false);
  assert.equal(fake.calls.some((call) => call.values?.includes(CONTROL_PASSWORD)), false);
});

test("fails closed on unsafe role attributes or any non-exact membership", async () => {
  const unsafeRole = new FakePostgres({ roleExists: true, role: { rolinherit: true } });
  await assert.rejects(bootstrapMcpStagingDatabase(options(unsafeRole)), /bootstrap_role_policy_mismatch/);

  for (const membership of [
    { outgoing_count: 1, incoming_count: 1, exact_incoming_count: 1 },
    { outgoing_count: 0, incoming_count: 2, exact_incoming_count: 1 },
    { outgoing_count: 0, incoming_count: 1, exact_incoming_count: 0 },
  ]) {
    const fake = new FakePostgres({ roleExists: true, membership });
    await assert.rejects(
      bootstrapMcpStagingDatabase(options(fake)),
      (error) => error instanceof McpStagingDbBootstrapError &&
        error.code === "bootstrap_role_membership_unsafe",
    );
    assert.equal(fake.calls.at(-1).sql, "ROLLBACK");
  }
});

test("fails closed unless database ACL is PUBLIC-zero and control has direct CONNECT only", async () => {
  for (const databaseIsolation of [
    { public_has_privilege: true },
    { control_create: true },
    { control_temporary: true },
    { control_acl_count: 2, control_acl_unsafe: true },
    { control_direct_connect: false },
    { unexpected_database_grantee: true },
    { other_database_access: true },
  ]) {
    const fake = new FakePostgres({ databaseIsolation });
    await assert.rejects(
      bootstrapMcpStagingDatabase(options(fake)),
      /bootstrap_database_isolation_failed/,
    );
    assert.equal(fake.calls.at(-1).sql, "ROLLBACK");
  }
});

test("fails closed on an unsafe, unversioned or mismatched gate schema", async () => {
  const wrongOwner = new FakePostgres({
    roleExists: true,
    schemaOwner: "unsafe_owner",
    markerOwner: bootstrapConstants.controlRole,
    marker: { schema_version: 2, policy_checksum: bootstrapConstants.policyChecksum },
  });
  await assert.rejects(bootstrapMcpStagingDatabase(options(wrongOwner)), /bootstrap_schema_owner_unsafe/);

  const unversioned = new FakePostgres({
    roleExists: true,
    schemaOwner: bootstrapConstants.controlRole,
  });
  await assert.rejects(bootstrapMcpStagingDatabase(options(unversioned)), /bootstrap_schema_unversioned/);

  const wrongVersion = new FakePostgres({
    roleExists: true,
    schemaOwner: bootstrapConstants.controlRole,
    markerOwner: bootstrapConstants.controlRole,
    marker: { schema_version: 1, policy_checksum: bootstrapConstants.policyChecksum },
  });
  await assert.rejects(bootstrapMcpStagingDatabase(options(wrongVersion)),
    /bootstrap_schema_version_mismatch/);
});

test("fails closed on unexpected, wrongly owned or PUBLIC-accessible gate objects and defaults", async () => {
  const baseMarker = {
    relname: "bootstrap_schema_version",
    relkind: "r",
    object_owner: bootstrapConstants.controlRole,
    indexed_relation: null,
    unexpected_acl_grantee: false,
  };
  for (const overrides of [
    { objectRows: [baseMarker, { ...baseMarker, relname: "unexpected_table" }] },
    { objectRows: [{ ...baseMarker, object_owner: "unsafe_owner" }] },
    { objectRows: [{ ...baseMarker, unexpected_acl_grantee: true }] },
    { functionRows: [{ proname: "unexpected_function" }] },
    { defaultPrivilegeRows: [
      { object_type: "S", unexpected_acl_grantee: false, unexpected_owner: false },
      { object_type: "f", unexpected_acl_grantee: true, unexpected_owner: false },
      { object_type: "r", unexpected_acl_grantee: false, unexpected_owner: false },
    ] },
    { defaultPrivilegeRows: [
      { object_type: "S", unexpected_acl_grantee: false, unexpected_owner: false },
      { object_type: "f", unexpected_acl_grantee: false, unexpected_owner: false },
      { object_type: "r", unexpected_acl_grantee: false, unexpected_owner: true },
    ] },
  ]) {
    const fake = new FakePostgres(overrides);
    await assert.rejects(
      bootstrapMcpStagingDatabase(options(fake)),
      /bootstrap_(?:gate_objects|default_privileges)_unsafe/,
    );
    assert.equal(fake.calls.at(-1).sql, "ROLLBACK");
  }
});

test("fails closed if control can create, read or execute outside the gate schema", async () => {
  const fake = new FakePostgres({ outsidePrivilege: true });
  await assert.rejects(
    bootstrapMcpStagingDatabase(options(fake)),
    /bootstrap_cross_schema_isolation_failed/,
  );
  assert.equal(fake.calls.at(-1).sql, "ROLLBACK");
});

test("requires admin to be current=session=database owner and non-superuser", async () => {
  for (const overrides of [
    { sessionRole: "another_session" },
    { databaseOwner: "another_owner" },
    { adminSuperuser: true },
    { adminRole: bootstrapConstants.controlRole, databaseOwner: bootstrapConstants.controlRole },
  ]) {
    const fake = new FakePostgres(overrides);
    await assert.rejects(bootstrapMcpStagingDatabase(options(fake)), /bootstrap_admin_identity_unsafe/);
    assert.equal(fake.calls.at(-1).sql, "ROLLBACK");
  }
});

test("the direct control-role login must retain the complete least-privilege identity", async () => {
  for (const login of [
    { session_user: "unexpected_session" },
    { database_connect: false },
    { database_create: true },
    { database_temporary: true },
    { gate_usage: false },
    { gate_create: false },
    { outgoing_membership_count: 1 },
  ]) {
    const fake = new FakePostgres({ login });
    await assert.rejects(
      bootstrapMcpStagingDatabase(options(fake)),
      /bootstrap_role_authentication_failed/,
    );
  }
});

test("rejects production, invalid mode, weak credentials, database mismatch and unsafe identifiers", async () => {
  let factoryCalls = 0;
  const neverPool = () => { factoryCalls += 1; throw new Error("must_not_run"); };
  for (const [overrides, code] of [
    [{ MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "production" }, "bootstrap_staging_confirmation_required"],
    [{ MCP_STAGING_CONTROL_ROLE_PROVISIONING_MODE: "automatic" }, "bootstrap_role_provisioning_mode_invalid"],
    [{ MCP_STAGING_GATE_CONTROL_PASSWORD: "short" }, "bootstrap_provider_password_invalid"],
    [{ PG_EXPECTED_DATABASE_NAME: "another_database" }, "bootstrap_admin_database_url_invalid"],
  ]) {
    await assert.rejects(
      bootstrapMcpStagingDatabase({ env: environment(overrides), poolFactory: neverPool }),
      new RegExp(code),
    );
  }
  assert.equal(factoryCalls, 0);

  const unsafeIdentifier = new FakePostgres({
    adminRole: "unsafe-admin",
    databaseOwner: "unsafe-admin",
    sessionRole: "unsafe-admin",
  });
  await assert.rejects(bootstrapMcpStagingDatabase(options(unsafeIdentifier)), /bootstrap_identifier_invalid/);
});

test("provider-thrown bootstrap error instances cannot smuggle arbitrary error text", async () => {
  const marker = "provider-error-code-secret-marker";
  await assert.rejects(
    bootstrapMcpStagingDatabase({
      env: environment(),
      poolFactory: async () => { throw new McpStagingDbBootstrapError(marker); },
      clientFactory: async () => { throw new Error("must_not_run"); },
    }),
    (error) => error.code === "bootstrap_database_error" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
});

test("health is redacted and long-running process credentials are scrubbed", () => {
  assert.throws(() => createHealthServer({ ok: false }), /bootstrap_health_not_ready/);
  const health = {
    ok: true,
    status: "ready",
    environment: "staging",
    schema_version: 2,
    role_count: 1,
    isolation: "verified",
    secrets_exposed: false,
  };
  const server = createHealthServer(health);
  assert.equal(server.listening, false);
  server.close();
  assert.throws(
    () => createHealthServer({ ...health, private_marker: "must-not-be-reflected" }),
    (error) => error.message === "bootstrap_health_not_ready" &&
      !String(error).includes("must-not-be-reflected"),
  );

  assert.equal(loadPrivatePort({ PORT: "10001" }), 10_001);
  for (const env of [{}, { PORT: "10000" }, { PORT: "8789" }, { PORT: 10_001 }]) {
    assert.throws(() => loadPrivatePort(env), /bootstrap_private_port_invalid/);
  }
  const marker = "private-port-getter-marker";
  assert.throws(
    () => loadPrivatePort(new Proxy({}, { get() { throw new Error(marker); } })),
    (error) => error.message === "bootstrap_private_port_invalid" && !String(error).includes(marker),
  );

  const env = environment({ UNRELATED: "keep" });
  scrubBootstrapEnvironment(env);
  assert.equal(env.PG_ADMIN_DATABASE_URL, undefined);
  assert.equal(env.MCP_STAGING_GATE_CONTROL_PASSWORD, undefined);
  assert.equal(env.UNRELATED, "keep");
});

test("hands control-plane login to the consumer as an in-memory one-use capability", async () => {
  const fake = new FakePostgres();
  let capturedCapability;
  const controlPlane = {
    verifyAndConsumeReceipt: async () => ({ ok: true }),
    issuerReplayStore: { durable: true, claim: async () => true },
    close: async () => {},
  };
  const result = await bootstrapMcpStagingDatabaseWithControlPlane({
    ...options(fake),
    controlPlaneFactory: async (capability) => {
      capturedCapability = capability;
      const parsed = new URL(capability.takeConnectionString());
      assert.equal(decodeURIComponent(parsed.username), bootstrapConstants.controlRole);
      assert.equal(decodeURIComponent(parsed.password), CONTROL_PASSWORD);
      assert.equal(capability.expectedDatabaseName, DATABASE_NAME);
      assert.equal(capability.schema, bootstrapConstants.gateSchema);
      assert.throws(() => capability.takeConnectionString(), /bootstrap_control_plane_capability_consumed/);
      return controlPlane;
    },
  });
  assert.equal(result.health.role_count, 1);
  assert.equal(result.controlPlane, controlPlane);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedCapability, "connectionString"), false);
  assert.throws(() => capturedCapability.takeConnectionString(), /bootstrap_control_plane_capability_consumed/);
  assert.equal(JSON.stringify(result).includes(CONTROL_PASSWORD), false);
});
