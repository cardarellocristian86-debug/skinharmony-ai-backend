import crypto from "node:crypto";

const ENVIRONMENT = "staging";
const CONTROL_ROLE = "mcp_staging_gate_control";
const GATE_SCHEMA = "mcp_staging_gate";
const MARKER_TABLE = `${GATE_SCHEMA}.bootstrap_schema_version`;
const SCHEMA_VERSION = 2;
const ADVISORY_LOCK_ID = 1_407_191_991;
const ROLE_PROVISIONING_MODE = "provider_native";
const ALLOWED_GATE_RELATIONS = Object.freeze([
  "bootstrap_schema_version",
  "control_plane_store_meta",
  "credential_receipts",
  "issuer_nonce_claims",
  "receipt_consumptions",
]);
const DEFAULT_TIMEOUTS = Object.freeze({
  statement: 8_000,
  lock: 3_000,
  idleInTransaction: 8_000,
  connection: 8_000,
});
const TRUSTED_BOOTSTRAP_ERROR_CODES = new Set([
  "bootstrap_admin_database_url_invalid",
  "bootstrap_admin_identity_unsafe",
  "bootstrap_control_plane_capability_consumed",
  "bootstrap_control_plane_factory_invalid",
  "bootstrap_control_plane_initialization_failed",
  "bootstrap_cross_schema_isolation_failed",
  "bootstrap_database_error",
  "bootstrap_database_factory_invalid",
  "bootstrap_database_isolation_failed",
  "bootstrap_default_privileges_unsafe",
  "bootstrap_environment_invalid",
  "bootstrap_gate_objects_unsafe",
  "bootstrap_identifier_invalid",
  "bootstrap_marker_isolation_failed",
  "bootstrap_provider_password_invalid",
  "bootstrap_provider_role_missing",
  "bootstrap_reset_role_failed",
  "bootstrap_role_authentication_failed",
  "bootstrap_role_membership_unsafe",
  "bootstrap_role_policy_mismatch",
  "bootstrap_role_provisioning_mode_invalid",
  "bootstrap_schema_isolation_failed",
  "bootstrap_schema_owner_unsafe",
  "bootstrap_schema_unversioned",
  "bootstrap_schema_version_mismatch",
  "bootstrap_set_role_failed",
  "bootstrap_staging_confirmation_required",
  "bootstrap_timeout_invalid",
]);

const POLICY_DOCUMENT = Object.freeze({
  schema_version: SCHEMA_VERSION,
  environment: ENVIRONMENT,
  role: {
    name: CONTROL_ROLE,
    login: true,
    inherit: false,
    superuser: false,
    create_database: false,
    create_role: false,
    replication: false,
    bypass_rls: false,
    outgoing_memberships: false,
    incoming_member: "bootstrap_database_owner_only",
  },
  database: {
    public_access: false,
    control_connect: true,
    control_create: false,
    control_temporary: false,
  },
  schema: { name: GATE_SCHEMA, owner: CONTROL_ROLE, public_access: false },
  object_defaults: { public_access: false, configured_by: CONTROL_ROLE },
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const POLICY_CHECKSUM = crypto.createHash("sha256")
  .update(`mcp-staging-db-bootstrap-policy-v1\u0000${canonicalJson(POLICY_DOCUMENT)}`)
  .digest("hex");

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function passwordValid(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 1_024 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function boundedTimeout(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 250 || normalized > 30_000) {
    throw new McpStagingDbBootstrapError("bootstrap_timeout_invalid");
  }
  return normalized;
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) {
    throw new McpStagingDbBootstrapError("bootstrap_identifier_invalid");
  }
  return `"${value}"`;
}

function databaseNameFromUrl(parsed) {
  try {
    return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new McpStagingDbBootstrapError("bootstrap_admin_database_url_invalid");
  }
}

function loadConfig(env, options) {
  if (!env || typeof env !== "object") throw new McpStagingDbBootstrapError("bootstrap_environment_invalid");
  if (env.MCP_STAGING_BOOTSTRAP_ENVIRONMENT !== ENVIRONMENT) {
    throw new McpStagingDbBootstrapError("bootstrap_staging_confirmation_required");
  }

  const adminDatabaseUrl = safeText(env.PG_ADMIN_DATABASE_URL);
  const expectedDatabaseName = safeText(env.PG_EXPECTED_DATABASE_NAME);
  const roleProvisioningMode = safeText(env.MCP_STAGING_CONTROL_ROLE_PROVISIONING_MODE);
  let parsed;
  try {
    parsed = new URL(adminDatabaseUrl);
  } catch {
    throw new McpStagingDbBootstrapError("bootstrap_admin_database_url_invalid");
  }
  const urlDatabaseName = databaseNameFromUrl(parsed);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username ||
      !parsed.password || !expectedDatabaseName || urlDatabaseName !== expectedDatabaseName ||
      !/^[a-z][a-z0-9_]{2,62}$/.test(expectedDatabaseName)) {
    throw new McpStagingDbBootstrapError("bootstrap_admin_database_url_invalid");
  }
  if (roleProvisioningMode !== ROLE_PROVISIONING_MODE) {
    throw new McpStagingDbBootstrapError("bootstrap_role_provisioning_mode_invalid");
  }

  const controlPassword = env.MCP_STAGING_GATE_CONTROL_PASSWORD;
  if (!passwordValid(controlPassword)) {
    throw new McpStagingDbBootstrapError("bootstrap_provider_password_invalid");
  }

  return Object.freeze({
    adminDatabaseUrl,
    expectedDatabaseName,
    roleProvisioningMode,
    controlPassword,
    timeouts: Object.freeze({
      statement: boundedTimeout(options.statementTimeoutMs, DEFAULT_TIMEOUTS.statement),
      lock: boundedTimeout(options.lockTimeoutMs, DEFAULT_TIMEOUTS.lock),
      idleInTransaction: boundedTimeout(options.idleInTransactionTimeoutMs, DEFAULT_TIMEOUTS.idleInTransaction),
      connection: boundedTimeout(options.connectionTimeoutMs, DEFAULT_TIMEOUTS.connection),
    }),
  });
}

function safeError(error, fallback = "bootstrap_database_error") {
  try {
    if (error instanceof McpStagingDbBootstrapError && TRUSTED_BOOTSTRAP_ERROR_CODES.has(error.code)) return error;
  } catch {
    // Hostile provider errors are replaced with a constant code.
  }
  return new McpStagingDbBootstrapError(fallback);
}

async function configureTransaction(client, timeouts) {
  await client.query("SELECT set_config('statement_timeout', $1, TRUE)", [`${timeouts.statement}ms`]);
  await client.query("SELECT set_config('lock_timeout', $1, TRUE)", [`${timeouts.lock}ms`]);
  await client.query("SELECT set_config('idle_in_transaction_session_timeout', $1, TRUE)", [
    `${timeouts.idleInTransaction}ms`,
  ]);
}

async function discoverAdmin(client, expectedDatabaseName) {
  const result = await client.query(`SELECT current_user, session_user, current_database() AS database_name,
      pg_get_userbyid(database_record.datdba) AS database_owner,
      admin_role.rolsuper AS admin_superuser
    FROM pg_database database_record
    JOIN pg_roles admin_role ON admin_role.rolname = current_user
    WHERE database_record.datname = current_database()`);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row || row.current_user !== row.session_user ||
      row.current_user !== row.database_owner || row.current_user === CONTROL_ROLE ||
      row.database_owner === CONTROL_ROLE || row.database_name !== expectedDatabaseName ||
      row.admin_superuser !== false) {
    throw new McpStagingDbBootstrapError("bootstrap_admin_identity_unsafe");
  }
  quoteIdentifier(String(row.current_user));
  return String(row.current_user);
}

async function ensureControlRole(client, { adminRole }) {
  const role = await client.query(`SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
      rolinherit, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname = $1`, [CONTROL_ROLE]);
  if (role.rows.length === 0) {
    throw new McpStagingDbBootstrapError("bootstrap_provider_role_missing");
  }
  const row = role.rows[0];
  if (role.rows.length !== 1 || row.rolcanlogin !== true || row.rolsuper !== false ||
      row.rolcreatedb !== false || row.rolcreaterole !== false || row.rolinherit !== false ||
      row.rolreplication !== false || row.rolbypassrls !== false) {
    throw new McpStagingDbBootstrapError("bootstrap_role_policy_mismatch");
  }

  const memberships = await client.query(`SELECT
      COUNT(*) FILTER (WHERE member_name.rolname = $1)::int AS outgoing_count,
      COUNT(*) FILTER (WHERE role_name.rolname = $1)::int AS incoming_count,
      COUNT(*) FILTER (WHERE role_name.rolname = $1 AND member_name.rolname = $2
        AND membership.admin_option IS FALSE AND membership.inherit_option IS FALSE
        AND membership.set_option IS TRUE)::int AS exact_incoming_count
    FROM pg_auth_members membership
    JOIN pg_roles role_name ON role_name.oid = membership.roleid
    JOIN pg_roles member_name ON member_name.oid = membership.member
    WHERE role_name.rolname = $1 OR member_name.rolname = $1`, [CONTROL_ROLE, adminRole]);
  const membership = memberships.rows[0];
  if (memberships.rows.length !== 1 || membership?.outgoing_count !== 0 ||
      membership?.incoming_count !== 1 || membership?.exact_incoming_count !== 1) {
    throw new McpStagingDbBootstrapError("bootstrap_role_membership_unsafe");
  }
}

async function applyDatabaseLeastPrivilege(client, expectedDatabaseName) {
  const database = quoteIdentifier(expectedDatabaseName);
  const control = quoteIdentifier(CONTROL_ROLE);
  await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${control}`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${control}`);
}

async function verifyDatabaseIsolation(client, expectedDatabaseName) {
  const result = await client.query(`SELECT
      EXISTS (SELECT 1
        FROM aclexplode(COALESCE(database_record.datacl,
          acldefault('d', database_record.datdba))) acl
        WHERE acl.grantee = 0) AS public_has_privilege,
      has_database_privilege($2, database_record.oid, 'CONNECT') AS control_connect,
      has_database_privilege($2, database_record.oid, 'CREATE') AS control_create,
      has_database_privilege($2, database_record.oid, 'TEMPORARY') AS control_temporary,
      (SELECT COUNT(*)::int
        FROM aclexplode(COALESCE(database_record.datacl,
          acldefault('d', database_record.datdba))) acl
        WHERE acl.grantee = control_role.oid) AS control_acl_count,
      EXISTS (SELECT 1
        FROM aclexplode(COALESCE(database_record.datacl,
          acldefault('d', database_record.datdba))) acl
        WHERE acl.grantee = control_role.oid AND acl.privilege_type = 'CONNECT'
          AND acl.is_grantable IS FALSE) AS control_direct_connect,
      EXISTS (SELECT 1
        FROM aclexplode(COALESCE(database_record.datacl,
          acldefault('d', database_record.datdba))) acl
        WHERE acl.grantee = control_role.oid
          AND (acl.privilege_type <> 'CONNECT' OR acl.is_grantable IS TRUE)) AS control_acl_unsafe,
      EXISTS (SELECT 1
        FROM aclexplode(COALESCE(database_record.datacl,
          acldefault('d', database_record.datdba))) acl
        WHERE acl.grantee NOT IN (database_record.datdba, control_role.oid)) AS unexpected_database_grantee,
      EXISTS (SELECT 1 FROM pg_database other_database
        WHERE other_database.oid <> database_record.oid
          AND other_database.datistemplate IS FALSE
          AND other_database.datallowconn IS TRUE
          AND (has_database_privilege($2, other_database.oid, 'CONNECT') OR
            has_database_privilege($2, other_database.oid, 'CREATE') OR
            has_database_privilege($2, other_database.oid, 'TEMPORARY'))) AS other_database_access
    FROM pg_database database_record
    JOIN pg_roles control_role ON control_role.rolname = $2
    WHERE database_record.datname = $1`, [expectedDatabaseName, CONTROL_ROLE]);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row.public_has_privilege !== false || row.control_connect !== true ||
      row.control_create !== false || row.control_temporary !== false || row.control_acl_count !== 1 ||
      row.control_direct_connect !== true || row.control_acl_unsafe !== false ||
      row.unexpected_database_grantee !== false || row.other_database_access !== false) {
    throw new McpStagingDbBootstrapError("bootstrap_database_isolation_failed");
  }
}

async function prepareGateSchema(client) {
  const schemaResult = await client.query(`SELECT nspname, pg_get_userbyid(nspowner) AS schema_owner
    FROM pg_namespace WHERE nspname = $1`, [GATE_SCHEMA]);
  if (schemaResult.rows.length === 0) {
    await client.query(`CREATE SCHEMA ${quoteIdentifier(GATE_SCHEMA)}
      AUTHORIZATION ${quoteIdentifier(CONTROL_ROLE)}`);
    return true;
  }
  if (schemaResult.rows.length !== 1 || schemaResult.rows[0].schema_owner !== CONTROL_ROLE) {
    throw new McpStagingDbBootstrapError("bootstrap_schema_owner_unsafe");
  }
  return false;
}

async function enterControlRole(client, adminRole) {
  await client.query(`SET LOCAL ROLE ${quoteIdentifier(CONTROL_ROLE)}`);
  const result = await client.query("SELECT current_user, session_user");
  if (result.rows.length !== 1 || result.rows[0].current_user !== CONTROL_ROLE ||
      result.rows[0].session_user !== adminRole) {
    throw new McpStagingDbBootstrapError("bootstrap_set_role_failed");
  }
}

async function resetAdminRole(client, adminRole) {
  await client.query("RESET ROLE");
  const result = await client.query("SELECT current_user, session_user");
  if (result.rows.length !== 1 || result.rows[0].current_user !== adminRole ||
      result.rows[0].session_user !== adminRole) {
    throw new McpStagingDbBootstrapError("bootstrap_reset_role_failed");
  }
}

async function ensureGateSchema(client, schemaCreated) {
  if (schemaCreated) {
    await client.query(`CREATE TABLE ${MARKER_TABLE} (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      policy_checksum TEXT NOT NULL CHECK (policy_checksum ~ '^[a-f0-9]{64}$'),
      installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`INSERT INTO ${MARKER_TABLE} (singleton, schema_version, policy_checksum)
      VALUES (TRUE, $1, $2)`, [SCHEMA_VERSION, POLICY_CHECKSUM]);
    return;
  }
  const marker = await client.query(`SELECT marker.relname,
      pg_get_userbyid(marker.relowner) AS table_owner
    FROM pg_class marker
    JOIN pg_namespace namespace ON namespace.oid = marker.relnamespace
    WHERE namespace.nspname = $1 AND marker.relname = 'bootstrap_schema_version' AND marker.relkind = 'r'`,
  [GATE_SCHEMA]);
  if (marker.rows.length !== 1 || marker.rows[0].table_owner !== CONTROL_ROLE) {
    throw new McpStagingDbBootstrapError("bootstrap_schema_unversioned");
  }
  const version = await client.query(`SELECT schema_version, policy_checksum FROM ${MARKER_TABLE}
    WHERE singleton IS TRUE FOR UPDATE`);
  if (version.rows.length !== 1 || version.rows[0].schema_version !== SCHEMA_VERSION ||
      version.rows[0].policy_checksum !== POLICY_CHECKSUM) {
    throw new McpStagingDbBootstrapError("bootstrap_schema_version_mismatch");
  }
}

async function applyLeastPrivilege(client) {
  await client.query(`REVOKE ALL ON SCHEMA ${GATE_SCHEMA} FROM PUBLIC`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${GATE_SCHEMA} FROM PUBLIC`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${GATE_SCHEMA} FROM PUBLIC`);
  await client.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${GATE_SCHEMA} FROM PUBLIC`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${GATE_SCHEMA}
    REVOKE ALL ON TABLES FROM PUBLIC`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${GATE_SCHEMA}
    REVOKE ALL ON SEQUENCES FROM PUBLIC`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${GATE_SCHEMA}
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
}

async function verifyIsolation(client) {
  const schema = await client.query(`SELECT pg_get_userbyid(namespace.nspowner) AS schema_owner,
      EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
        WHERE acl.grantee <> control_role.oid
      ) AS unexpected_acl_grantee,
      has_schema_privilege($2, namespace.oid, 'USAGE') AS control_usage,
      has_schema_privilege($2, namespace.oid, 'CREATE') AS control_create
    FROM pg_namespace namespace
    CROSS JOIN pg_roles control_role
    WHERE namespace.nspname = $1 AND control_role.rolname = $2`, [GATE_SCHEMA, CONTROL_ROLE]);
  const row = schema.rows[0];
  if (schema.rows.length !== 1 || row.schema_owner !== CONTROL_ROLE || row.unexpected_acl_grantee !== false ||
      row.control_usage !== true || row.control_create !== true) {
    throw new McpStagingDbBootstrapError("bootstrap_schema_isolation_failed");
  }

  const marker = await client.query(`SELECT pg_get_userbyid(marker.relowner) AS table_owner,
      EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(marker.relacl, acldefault('r', marker.relowner))) acl
        WHERE acl.grantee <> control_role.oid
      ) AS unexpected_acl_grantee
    FROM pg_class marker
    CROSS JOIN pg_roles control_role
    WHERE marker.oid = to_regclass($1) AND control_role.rolname = $2`, [MARKER_TABLE, CONTROL_ROLE]);
  if (marker.rows.length !== 1 || marker.rows[0].table_owner !== CONTROL_ROLE ||
      marker.rows[0].unexpected_acl_grantee !== false) {
    throw new McpStagingDbBootstrapError("bootstrap_marker_isolation_failed");
  }

  const objects = await client.query(`SELECT object.relname, object.relkind,
      pg_get_userbyid(object.relowner) AS object_owner,
      indexed_relation.relname AS indexed_relation,
      CASE WHEN object.relkind = 'r' THEN EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(object.relacl, acldefault('r', object.relowner))) acl
        WHERE acl.grantee <> control_role.oid
      ) ELSE FALSE END AS unexpected_acl_grantee
    FROM pg_class object
    JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
    CROSS JOIN pg_roles control_role
    LEFT JOIN pg_index index_record ON index_record.indexrelid = object.oid
    LEFT JOIN pg_class indexed_relation ON indexed_relation.oid = index_record.indrelid
    WHERE namespace.nspname = $1 AND control_role.rolname = $2
    ORDER BY object.relkind, object.relname`, [GATE_SCHEMA, CONTROL_ROLE]);
  let markerFound = false;
  for (const object of objects.rows) {
    const normalTable = object.relkind === "r" && ALLOWED_GATE_RELATIONS.includes(object.relname);
    const attachedIndex = object.relkind === "i" && ALLOWED_GATE_RELATIONS.includes(object.indexed_relation);
    if ((!normalTable && !attachedIndex) || object.object_owner !== CONTROL_ROLE ||
        object.unexpected_acl_grantee !== false) {
      throw new McpStagingDbBootstrapError("bootstrap_gate_objects_unsafe");
    }
    if (object.relkind === "r" && object.relname === "bootstrap_schema_version") markerFound = true;
  }
  if (!markerFound) throw new McpStagingDbBootstrapError("bootstrap_schema_unversioned");

  const functions = await client.query(`SELECT function_record.proname
    FROM pg_proc function_record
    JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    WHERE namespace.nspname = $1`, [GATE_SCHEMA]);
  if (functions.rows.length !== 0) {
    throw new McpStagingDbBootstrapError("bootstrap_gate_objects_unsafe");
  }

  const defaultPrivileges = await client.query(`WITH requested(object_type) AS (
      VALUES ('r'::"char"), ('S'::"char"), ('f'::"char")
    )
    SELECT requested.object_type::text AS object_type,
      EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(default_acl.defaclacl,
          acldefault(requested.object_type, control_role.oid))) acl
        WHERE acl.grantee <> control_role.oid
      ) AS unexpected_acl_grantee,
      EXISTS (
        SELECT 1 FROM pg_default_acl unexpected_default
        WHERE unexpected_default.defaclnamespace = namespace.oid
          AND unexpected_default.defaclrole <> control_role.oid
      ) AS unexpected_owner
    FROM requested
    CROSS JOIN pg_namespace namespace
    CROSS JOIN pg_roles control_role
    LEFT JOIN pg_default_acl default_acl
      ON default_acl.defaclnamespace = namespace.oid
      AND default_acl.defaclrole = control_role.oid
      AND default_acl.defaclobjtype = requested.object_type
    WHERE namespace.nspname = $1 AND control_role.rolname = $2
    ORDER BY requested.object_type`, [GATE_SCHEMA, CONTROL_ROLE]);
  const requiredDefaultTypes = new Set(["r", "S", "f"]);
  if (defaultPrivileges.rows.length !== requiredDefaultTypes.size) {
    throw new McpStagingDbBootstrapError("bootstrap_default_privileges_unsafe");
  }
  for (const privilege of defaultPrivileges.rows) {
    if (!requiredDefaultTypes.delete(privilege.object_type) || privilege.unexpected_acl_grantee !== false ||
        privilege.unexpected_owner !== false) {
      throw new McpStagingDbBootstrapError("bootstrap_default_privileges_unsafe");
    }
  }
  if (requiredDefaultTypes.size !== 0) {
    throw new McpStagingDbBootstrapError("bootstrap_default_privileges_unsafe");
  }

  const outside = await client.query(`SELECT
      EXISTS (SELECT 1 FROM pg_namespace namespace
        WHERE namespace.nspname NOT IN ($1, 'pg_catalog', 'information_schema')
          AND namespace.nspname !~ '^pg_toast'
          AND has_schema_privilege($2, namespace.oid, 'CREATE')) AS can_create_outside_gate,
      EXISTS (SELECT 1 FROM pg_class object
        JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
        WHERE namespace.nspname <> $1 AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname !~ '^pg_toast' AND object.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (has_table_privilege($2, object.oid, 'SELECT') OR
            has_table_privilege($2, object.oid, 'INSERT') OR
            has_table_privilege($2, object.oid, 'UPDATE') OR
            has_table_privilege($2, object.oid, 'DELETE') OR
            has_table_privilege($2, object.oid, 'TRUNCATE') OR
            has_table_privilege($2, object.oid, 'REFERENCES') OR
            has_table_privilege($2, object.oid, 'TRIGGER') OR
            has_any_column_privilege($2, object.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))) AS can_access_objects_outside_gate,
      EXISTS (SELECT 1 FROM pg_class sequence_object
        JOIN pg_namespace namespace ON namespace.oid = sequence_object.relnamespace
        WHERE namespace.nspname <> $1 AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname !~ '^pg_toast' AND sequence_object.relkind = 'S'
          AND (has_sequence_privilege($2, sequence_object.oid, 'USAGE') OR
            has_sequence_privilege($2, sequence_object.oid, 'SELECT') OR
            has_sequence_privilege($2, sequence_object.oid, 'UPDATE'))) AS can_access_sequences_outside_gate,
      EXISTS (SELECT 1 FROM pg_proc function_object
        JOIN pg_namespace namespace ON namespace.oid = function_object.pronamespace
        WHERE namespace.nspname <> $1 AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname !~ '^pg_toast'
          AND has_function_privilege($2, function_object.oid, 'EXECUTE')) AS can_execute_functions_outside_gate`,
  [GATE_SCHEMA, CONTROL_ROLE]);
  if (outside.rows.length !== 1 || outside.rows[0].can_create_outside_gate !== false ||
      outside.rows[0].can_access_objects_outside_gate !== false ||
      outside.rows[0].can_access_sequences_outside_gate !== false ||
      outside.rows[0].can_execute_functions_outside_gate !== false) {
    throw new McpStagingDbBootstrapError("bootstrap_cross_schema_isolation_failed");
  }
}

function roleConnectionString(adminDatabaseUrl, role, password) {
  try {
    const value = new URL(adminDatabaseUrl);
    value.username = role;
    value.password = password;
    return value.toString();
  } catch {
    throw new McpStagingDbBootstrapError("bootstrap_role_authentication_failed");
  }
}

async function verifyRoleLogin({ config, clientFactory, identityOnly = false }) {
  let client;
  try {
    client = await clientFactory({
      connectionString: roleConnectionString(config.adminDatabaseUrl, CONTROL_ROLE, config.controlPassword),
      connectionTimeoutMillis: config.timeouts.connection,
      statement_timeout: config.timeouts.statement,
      query_timeout: config.timeouts.statement,
      application_name: "mcp-staging-db-bootstrap-verifier",
    });
    await client.connect();
    const result = identityOnly
      ? await client.query("SELECT current_user, session_user, current_database() AS database_name")
      : await client.query(`SELECT current_user, session_user,
      current_database() AS database_name,
      has_database_privilege(current_user, current_database(), 'CONNECT') AS database_connect,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      has_database_privilege(current_user, current_database(), 'TEMPORARY') AS database_temporary,
      has_schema_privilege(current_user, $1, 'USAGE') AS gate_usage,
      has_schema_privilege(current_user, $1, 'CREATE') AS gate_create,
      (SELECT COUNT(*)::int
        FROM pg_auth_members membership
        JOIN pg_roles member_role ON member_role.oid = membership.member
        WHERE member_role.rolname = current_user) AS outgoing_membership_count`, [GATE_SCHEMA]);
    const row = result.rows[0];
    if (result.rows.length !== 1 || row?.current_user !== CONTROL_ROLE || row?.session_user !== CONTROL_ROLE ||
        row?.database_name !== config.expectedDatabaseName || (!identityOnly && (
          row?.database_connect !== true || row?.database_create !== false ||
          row?.database_temporary !== false || row?.gate_usage !== true || row?.gate_create !== true ||
          row?.outgoing_membership_count !== 0))) {
      throw new McpStagingDbBootstrapError("bootstrap_role_authentication_failed");
    }
  } catch (error) {
    throw safeError(error, "bootstrap_role_authentication_failed");
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Cleanup cannot expose connection material.
      }
    }
  }
}

export class McpStagingDbBootstrapError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingDbBootstrapError";
    this.code = code;
  }
}

export async function bootstrapMcpStagingDatabase({
  env = process.env,
  poolFactory = async (config) => {
    const { Pool } = await import("pg");
    return new Pool(config);
  },
  clientFactory = async (config) => {
    const { Client } = await import("pg");
    return new Client(config);
  },
  statementTimeoutMs,
  lockTimeoutMs,
  idleInTransactionTimeoutMs,
  connectionTimeoutMs,
} = {}) {
  const config = loadConfig(env, {
    statementTimeoutMs,
    lockTimeoutMs,
    idleInTransactionTimeoutMs,
    connectionTimeoutMs,
  });
  if (typeof poolFactory !== "function" || typeof clientFactory !== "function") {
    throw new McpStagingDbBootstrapError("bootstrap_database_factory_invalid");
  }

  let pool;
  let client;
  try {
    pool = await poolFactory({
      connectionString: config.adminDatabaseUrl,
      max: 1,
      connectionTimeoutMillis: config.timeouts.connection,
      statement_timeout: config.timeouts.statement,
      query_timeout: config.timeouts.statement,
      idle_in_transaction_session_timeout: config.timeouts.idleInTransaction,
      application_name: "mcp-staging-db-bootstrap",
    });
    if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") {
      throw new McpStagingDbBootstrapError("bootstrap_database_factory_invalid");
    }
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await configureTransaction(client, config.timeouts);
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_ID]);
    const adminRole = await discoverAdmin(client, config.expectedDatabaseName);
    await ensureControlRole(client, { adminRole });
    await verifyRoleLogin({ config, clientFactory, identityOnly: true });
    await applyDatabaseLeastPrivilege(client, config.expectedDatabaseName);
    const schemaCreated = await prepareGateSchema(client);
    await enterControlRole(client, adminRole);
    await ensureGateSchema(client, schemaCreated);
    await applyLeastPrivilege(client);
    await verifyIsolation(client);
    await resetAdminRole(client, adminRole);
    await verifyDatabaseIsolation(client, config.expectedDatabaseName);
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Rollback errors are intentionally redacted.
      }
    }
    throw safeError(error);
  } finally {
    if (client && typeof client.release === "function") {
      try {
        client.release();
      } catch {
        // Cleanup cannot expose connection material.
      }
    }
    if (pool) {
      try {
        await pool.end();
      } catch {
        // Cleanup cannot expose connection material.
      }
    }
  }

  await verifyRoleLogin({ config, clientFactory });
  return Object.freeze({
    ok: true,
    status: "ready",
    environment: ENVIRONMENT,
    schema_version: SCHEMA_VERSION,
    role_count: 1,
    isolation: "verified",
    secrets_exposed: false,
  });
}

export async function bootstrapMcpStagingDatabaseWithControlPlane({
  env = process.env,
  controlPlaneFactory,
  poolFactory,
  clientFactory,
  statementTimeoutMs,
  lockTimeoutMs,
  idleInTransactionTimeoutMs,
  connectionTimeoutMs,
} = {}) {
  if (typeof controlPlaneFactory !== "function") {
    throw new McpStagingDbBootstrapError("bootstrap_control_plane_factory_invalid");
  }
  const config = loadConfig(env, {
    statementTimeoutMs,
    lockTimeoutMs,
    idleInTransactionTimeoutMs,
    connectionTimeoutMs,
  });
  const health = await bootstrapMcpStagingDatabase({
    env,
    poolFactory,
    clientFactory,
    statementTimeoutMs,
    lockTimeoutMs,
    idleInTransactionTimeoutMs,
    connectionTimeoutMs,
  });
  let roleConnection = roleConnectionString(config.adminDatabaseUrl, CONTROL_ROLE, config.controlPassword);
  let capabilityConsumed = false;
  const capability = Object.freeze({
    expectedDatabaseName: config.expectedDatabaseName,
    role: CONTROL_ROLE,
    schema: GATE_SCHEMA,
    takeConnectionString() {
      if (capabilityConsumed || !roleConnection) {
        throw new McpStagingDbBootstrapError("bootstrap_control_plane_capability_consumed");
      }
      capabilityConsumed = true;
      const value = roleConnection;
      roleConnection = "";
      return value;
    },
  });
  try {
    const controlPlane = await controlPlaneFactory(capability);
    if (!controlPlane || typeof controlPlane.verifyAndConsumeReceipt !== "function" ||
        !controlPlane.issuerReplayStore || controlPlane.issuerReplayStore.durable !== true ||
        typeof controlPlane.issuerReplayStore.claim !== "function" || typeof controlPlane.close !== "function") {
      throw new McpStagingDbBootstrapError("bootstrap_control_plane_factory_invalid");
    }
    return Object.freeze({ health, controlPlane });
  } catch (error) {
    throw safeError(error, "bootstrap_control_plane_initialization_failed");
  } finally {
    capabilityConsumed = true;
    roleConnection = "";
  }
}

export const bootstrapConstants = Object.freeze({
  environment: ENVIRONMENT,
  controlRole: CONTROL_ROLE,
  gateSchema: GATE_SCHEMA,
  schemaVersion: SCHEMA_VERSION,
  policyChecksum: POLICY_CHECKSUM,
});
