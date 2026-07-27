import {
  applyCollaborationPostgresMigration,
  collaborationSchemaContract,
  configureCollaborationRuntimeRole,
  verifyCollaborationPostgresSchema,
} from "../../skinharmony-core-mcp/src/collaboration-postgres-schema.js";
import {
  bootstrapConstants,
} from "./bootstrap.js";
import { requireMcpStagingTargetCommit } from
  "../../universal-core-service/src/mcpStagingTargetCommit.js";

const ENVIRONMENT = "staging";
const PROFILE = "collaboration";
const INITIALIZE = "initialize";
const STEADY = "steady";
const CONTROL_ROLE = bootstrapConstants.controlRole;
const RUNTIME_ROLE = "mcp_collaboration_runtime";
const GATE_SCHEMA = bootstrapConstants.gateSchema;
const GATE_MARKER = `${GATE_SCHEMA}.bootstrap_schema_version`;
const ADVISORY_LOCK_ID = 1_407_191_992;
const DEFAULT_RUNTIME_ROLE_ATTEMPTS = 300;
const DEFAULT_RUNTIME_ROLE_POLL_MS = 1_000;
const SENSITIVE_ENV_KEYS = Object.freeze([
  "PG_ADMIN_DATABASE_URL",
  "MCP_STAGING_GATE_CONTROL_PASSWORD",
]);
const TRUSTED_CODES = new Set([
  "collaboration_rollout_admin_identity_unsafe",
  "collaboration_rollout_control_plane_capability_consumed",
  "collaboration_rollout_control_plane_factory_invalid",
  "collaboration_rollout_control_role_unsafe",
  "collaboration_rollout_database_unavailable",
  "collaboration_rollout_environment_invalid",
  "collaboration_rollout_gate_schema_unsafe",
  "collaboration_rollout_migration_failed",
  "collaboration_rollout_mode_invalid",
  "collaboration_rollout_profile_invalid",
  "collaboration_rollout_provider_reference_invalid",
  "collaboration_rollout_runtime_role_missing",
  "collaboration_rollout_runtime_role_unsafe",
  "collaboration_rollout_secret_invalid",
  "collaboration_rollout_steady_reference_invalid",
  "collaboration_rollout_target_commit_invalid",
  "collaboration_rollout_timeout_invalid",
]);

export class McpStagingCollaborationRolloutError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingCollaborationRolloutError";
    this.code = code;
  }
}

function fail(code) {
  throw new McpStagingCollaborationRolloutError(code);
}

function safeError(error, fallback = "collaboration_rollout_database_unavailable") {
  try {
    if (error instanceof McpStagingCollaborationRolloutError && TRUSTED_CODES.has(error.code)) {
      return error;
    }
  } catch {
    // Provider details and hostile error properties are never reflected.
  }
  return new McpStagingCollaborationRolloutError(fallback);
}

function safeRead(env, key) {
  try {
    return env[key];
  } catch {
    fail("collaboration_rollout_environment_invalid");
  }
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 1_024 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{2,62}$/.test(value)) {
    fail("collaboration_rollout_provider_reference_invalid");
  }
  return `"${value}"`;
}

function databaseName(parsed) {
  try {
    return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    fail("collaboration_rollout_provider_reference_invalid");
  }
}

function username(parsed) {
  try {
    return decodeURIComponent(parsed.username);
  } catch {
    fail("collaboration_rollout_provider_reference_invalid");
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("collaboration_rollout_timeout_invalid");
  }
  return normalized;
}

function scrub(env) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) return;
  for (const key of SENSITIVE_ENV_KEYS) {
    try {
      if (Object.prototype.hasOwnProperty.call(env, key)) env[key] = "";
      delete env[key];
    } catch {
      // Scrubbing is best-effort and never exposes a value.
    }
  }
}

export function scrubCollaborationRolloutEnvironment(env = process.env) {
  scrub(env);
}

function loadConfig(env, targetCommitValue, options = {}) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) {
    fail("collaboration_rollout_environment_invalid");
  }
  let targetCommit;
  let referenceValue;
  let controlPassword;
  try {
    if (safeRead(env, "MCP_STAGING_BOOTSTRAP_ENVIRONMENT") !== ENVIRONMENT) {
      fail("collaboration_rollout_environment_invalid");
    }
    if (safeRead(env, "MCP_STAGING_CONTROL_PLANE_PROFILE") !== PROFILE) {
      fail("collaboration_rollout_profile_invalid");
    }
    const mode = safeRead(env, "MCP_STAGING_DB_BOOTSTRAP_MODE");
    if (mode !== INITIALIZE && mode !== STEADY) fail("collaboration_rollout_mode_invalid");
    try {
      targetCommit = requireMcpStagingTargetCommit(targetCommitValue);
    } catch {
      fail("collaboration_rollout_target_commit_invalid");
    }
    referenceValue = safeRead(env, "PG_ADMIN_DATABASE_URL");
    controlPassword = safeRead(env, "MCP_STAGING_GATE_CONTROL_PASSWORD");
    const expectedDatabaseName = safeRead(env, "PG_EXPECTED_DATABASE_NAME");
    if (!validPassword(controlPassword)) fail("collaboration_rollout_secret_invalid");
    if (typeof referenceValue !== "string" || typeof expectedDatabaseName !== "string" ||
        !/^[a-z][a-z0-9_.-]{2,62}$/.test(expectedDatabaseName) ||
        !/staging/i.test(expectedDatabaseName)) {
      fail("collaboration_rollout_provider_reference_invalid");
    }
    let parsed;
    try {
      parsed = new URL(referenceValue);
    } catch {
      fail("collaboration_rollout_provider_reference_invalid");
    }
    const providerUser = username(parsed);
    const providerDatabase = databaseName(parsed);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname ||
        !parsed.password || providerDatabase !== expectedDatabaseName ||
        !/^[a-z][a-z0-9_.-]{2,62}$/.test(providerUser)) {
      fail("collaboration_rollout_provider_reference_invalid");
    }
    if (mode === STEADY && providerUser !== RUNTIME_ROLE) {
      fail("collaboration_rollout_steady_reference_invalid");
    }
    if (mode === INITIALIZE && [CONTROL_ROLE, RUNTIME_ROLE].includes(providerUser)) {
      fail("collaboration_rollout_admin_identity_unsafe");
    }
    const endpoint = Object.freeze({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || "5432",
      database: providerDatabase,
    });
    return Object.freeze({
      mode,
      profile: PROFILE,
      targetCommit,
      expectedDatabaseName,
      providerUser,
      endpoint,
      adminConnectionString: mode === INITIALIZE ? referenceValue : null,
      controlPassword,
      runtimeRoleAttempts: boundedInteger(
        options.runtimeRoleAttempts,
        DEFAULT_RUNTIME_ROLE_ATTEMPTS,
        1,
        600,
      ),
      runtimeRolePollMs: boundedInteger(
        options.runtimeRolePollMs,
        DEFAULT_RUNTIME_ROLE_POLL_MS,
        0,
        5_000,
      ),
    });
  } finally {
    scrub(env);
    referenceValue = "";
  }
}

function roleConnectionString(endpoint, role, password) {
  const value = new URL(`${endpoint.protocol}//provider.invalid`);
  value.hostname = endpoint.hostname;
  value.port = endpoint.port;
  value.pathname = `/${encodeURIComponent(endpoint.database)}`;
  value.username = role;
  value.password = password;
  value.searchParams.set("sslmode", "require");
  value.searchParams.set("application_name", "mcp-staging-collaboration-control");
  return value.toString();
}

async function defaultPoolFactory(config) {
  const { Pool } = await import("pg");
  return new Pool(config);
}

async function openPool(poolFactory, connectionString, applicationName) {
  let pool;
  try {
    pool = await poolFactory({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 8_000,
      query_timeout: 8_000,
      idle_in_transaction_session_timeout: 8_000,
      application_name: applicationName,
    });
  } catch (error) {
    throw safeError(error);
  }
  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") {
    try {
      if (pool && typeof pool.end === "function") await pool.end();
    } catch {
      // Cleanup is redacted.
    }
    fail("collaboration_rollout_database_unavailable");
  }
  return pool;
}

async function closePool(pool) {
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    fail("collaboration_rollout_database_unavailable");
  }
}

async function queryRuntimeRole(client) {
  return client.query(
    `SELECT role.rolname,role.rolcanlogin,role.rolsuper,role.rolcreatedb,role.rolcreaterole,
            role.rolinherit,role.rolreplication,role.rolbypassrls,role.rolconfig,
            (SELECT count(*)::integer FROM pg_auth_members membership
             WHERE membership.member=role.oid OR membership.roleid=role.oid) AS membership_count,
            (SELECT count(*)::integer FROM pg_database database_record
             WHERE database_record.datdba=role.oid) AS owned_database_count,
            (SELECT count(*)::integer FROM pg_class relation
             WHERE relation.relowner=role.oid) AS owned_relation_count,
            (SELECT count(*)::integer FROM pg_proc function_record
             WHERE function_record.proowner=role.oid) AS owned_function_count,
            (SELECT count(*)::integer FROM pg_namespace namespace
             WHERE namespace.nspowner=role.oid) AS owned_schema_count
     FROM pg_roles role WHERE role.rolname=$1`,
    [RUNTIME_ROLE],
  );
}

function assertRuntimeRoleBase(result, { requireNoInherit = false } = {}) {
  const row = result?.rows?.[0];
  if (result?.rowCount !== 1 || row?.rolname !== RUNTIME_ROLE || row.rolcanlogin !== true ||
      row.rolsuper !== false || row.rolcreatedb !== false || row.rolcreaterole !== false ||
      row.rolreplication !== false || row.rolbypassrls !== false ||
      (row.rolinherit !== true && row.rolinherit !== false) || row.membership_count !== 0 ||
      row.owned_database_count !== 0 || row.owned_relation_count !== 0 ||
      row.owned_function_count !== 0 || row.owned_schema_count !== 0 ||
      (requireNoInherit && row.rolinherit !== false)) {
    fail("collaboration_rollout_runtime_role_unsafe");
  }
  return row;
}

async function waitForRuntimeRole(client, config, sleep) {
  for (let attempt = 0; attempt < config.runtimeRoleAttempts; attempt += 1) {
    let result;
    try {
      result = await queryRuntimeRole(client);
    } catch (error) {
      throw safeError(error);
    }
    if (result.rowCount === 1) return assertRuntimeRoleBase(result);
    if (result.rowCount !== 0) fail("collaboration_rollout_runtime_role_unsafe");
    if (attempt + 1 < config.runtimeRoleAttempts && config.runtimeRolePollMs > 0) {
      await sleep(config.runtimeRolePollMs);
    }
  }
  fail("collaboration_rollout_runtime_role_missing");
}

async function discoverAdmin(client, config) {
  const result = await client.query(
    `SELECT current_user,session_user,current_database() AS database_name,
            pg_get_userbyid(database_record.datdba) AS database_owner,
            admin_role.rolsuper AS admin_superuser,
            admin_role.rolcreaterole AS admin_create_role
     FROM pg_database database_record
     JOIN pg_roles admin_role ON admin_role.rolname=current_user
     WHERE database_record.datname=current_database()`,
  );
  const row = result.rows?.[0];
  if (result.rowCount !== 1 || row?.current_user !== row?.session_user ||
      row.current_user !== row.database_owner || row.current_user !== config.providerUser ||
      row.database_name !== config.expectedDatabaseName || row.admin_superuser !== false ||
      row.admin_create_role !== true || [CONTROL_ROLE, RUNTIME_ROLE].includes(row.current_user)) {
    fail("collaboration_rollout_admin_identity_unsafe");
  }
  quoteIdentifier(row.current_user);
  return row.current_user;
}

async function readControlRoleState(client, adminRole) {
  const role = await client.query(
    `SELECT role.rolname,role.rolcanlogin,role.rolsuper,role.rolcreatedb,role.rolcreaterole,
            role.rolinherit,role.rolreplication,role.rolbypassrls
     FROM pg_roles role WHERE role.rolname=$1`,
    [CONTROL_ROLE],
  );
  if (role.rowCount > 1) fail("collaboration_rollout_control_role_unsafe");
  if (role.rowCount === 1) {
    const row = role.rows[0];
    if (row.rolname !== CONTROL_ROLE || row.rolcanlogin !== true || row.rolsuper !== false ||
        row.rolcreatedb !== false || row.rolcreaterole !== false || row.rolinherit !== false ||
        row.rolreplication !== false || row.rolbypassrls !== false) {
      fail("collaboration_rollout_control_role_unsafe");
    }
  }
  const memberships = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE member_name.rolname=$1)::integer AS outgoing_count,
       COUNT(*) FILTER (WHERE role_name.rolname=$1)::integer AS incoming_count,
       COUNT(*) FILTER (WHERE role_name.rolname=$1 AND member_name.rolname=$2
         AND membership.admin_option IS FALSE AND membership.inherit_option IS FALSE
         AND membership.set_option IS TRUE)::integer AS exact_incoming_count
     FROM pg_auth_members membership
     JOIN pg_roles role_name ON role_name.oid=membership.roleid
     JOIN pg_roles member_name ON member_name.oid=membership.member
     WHERE role_name.rolname=$1 OR member_name.rolname=$1`,
    [CONTROL_ROLE, adminRole],
  );
  const membership = memberships.rows?.[0];
  if (memberships.rowCount !== 1 || membership?.outgoing_count !== 0 ||
      ![0, 1].includes(membership?.incoming_count) ||
      ![0, 1].includes(membership?.exact_incoming_count) ||
      membership.incoming_count !== membership.exact_incoming_count) {
    fail("collaboration_rollout_control_role_unsafe");
  }
  return Object.freeze({ exists: role.rowCount === 1, membershipReady: membership.incoming_count === 1 });
}

async function configureControlRole(client, adminRole, controlPassword) {
  const before = await readControlRoleState(client, adminRole);
  await client.query(`CREATE OR REPLACE FUNCTION pg_temp.mcp_staging_configure_control_role(secret_value text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
    AS $function$
    BEGIN
      IF secret_value IS NULL OR length(secret_value) < 32 OR length(secret_value) > 1024 OR
          secret_value ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'invalid_control_credential';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='${CONTROL_ROLE}') THEN
        EXECUTE format(
          'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
          '${CONTROL_ROLE}', secret_value
        );
      ELSE
        EXECUTE format(
          'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
          '${CONTROL_ROLE}', secret_value
        );
      END IF;
      secret_value := NULL;
    END
    $function$`);
  await client.query("SELECT pg_temp.mcp_staging_configure_control_role($1::text)", [controlPassword]);
  await client.query("DROP FUNCTION pg_temp.mcp_staging_configure_control_role(text)");
  if (!before.membershipReady) {
    await client.query(`GRANT ${quoteIdentifier(CONTROL_ROLE)} TO ${quoteIdentifier(adminRole)}
      WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  }
  const after = await readControlRoleState(client, adminRole);
  if (!after.exists || !after.membershipReady) fail("collaboration_rollout_control_role_unsafe");
}

async function initializeRolesAndDatabase(adminPool, config, sleep) {
  let client;
  try {
    client = await adminPool.connect();
    await waitForRuntimeRole(client, config, sleep);
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT set_config('statement_timeout','8000ms',TRUE)");
    await client.query("SELECT set_config('lock_timeout','3000ms',TRUE)");
    await client.query("SELECT set_config('idle_in_transaction_session_timeout','8000ms',TRUE)");
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_ID]);
    const adminRole = await discoverAdmin(client, config);
    await configureControlRole(client, adminRole, config.controlPassword);
    await client.query(`ALTER ROLE ${quoteIdentifier(RUNTIME_ROLE)}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    assertRuntimeRoleBase(await queryRuntimeRole(client), { requireNoInherit: true });
    const database = quoteIdentifier(config.expectedDatabaseName);
    const control = quoteIdentifier(CONTROL_ROLE);
    const runtime = quoteIdentifier(RUNTIME_ROLE);
    await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM PUBLIC`);
    await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${control}`);
    await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${runtime}`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${control},${runtime}`);
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query(`GRANT USAGE,CREATE ON SCHEMA public TO ${control}`);
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${runtime}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${runtime}`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(GATE_SCHEMA)}
      AUTHORIZATION ${control}`);
    await client.query("COMMIT");
    return adminRole;
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Rollback detail is private.
      }
    }
    throw safeError(error);
  } finally {
    if (client && typeof client.release === "function") {
      try {
        client.release();
      } catch {
        // Cleanup detail is private.
      }
    }
  }
}

async function ensureGateMarker(controlPool, expectedDatabaseName) {
  let client;
  try {
    client = await controlPool.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_ID]);
    const identity = await client.query(
      `SELECT current_user,session_user,current_database() AS database_name,
              pg_get_userbyid(namespace.nspowner) AS schema_owner
       FROM pg_namespace namespace WHERE namespace.nspname=$1`,
      [GATE_SCHEMA],
    );
    const row = identity.rows?.[0];
    if (identity.rowCount !== 1 || row?.current_user !== CONTROL_ROLE ||
        row.session_user !== CONTROL_ROLE || row.database_name !== expectedDatabaseName ||
        row.schema_owner !== CONTROL_ROLE) {
      fail("collaboration_rollout_gate_schema_unsafe");
    }
    await client.query(`REVOKE ALL ON SCHEMA ${GATE_SCHEMA} FROM PUBLIC`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${GATE_SCHEMA}
      REVOKE ALL ON TABLES FROM PUBLIC`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${GATE_SCHEMA}
      REVOKE ALL ON SEQUENCES FROM PUBLIC`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${GATE_SCHEMA}
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${GATE_MARKER} (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      policy_checksum TEXT NOT NULL CHECK (policy_checksum ~ '^[a-f0-9]{64}$'),
      installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`INSERT INTO ${GATE_MARKER} (singleton,schema_version,policy_checksum)
      VALUES (TRUE,$1,$2) ON CONFLICT (singleton) DO NOTHING`, [
      bootstrapConstants.schemaVersion,
      bootstrapConstants.policyChecksum,
    ]);
    const marker = await client.query(
      `SELECT schema_version,policy_checksum,pg_get_userbyid(marker.relowner) AS table_owner
       FROM ${GATE_MARKER}
       JOIN pg_class marker ON marker.oid=to_regclass($1)
       WHERE singleton IS TRUE FOR UPDATE`,
      [GATE_MARKER],
    );
    if (marker.rowCount !== 1 || marker.rows[0]?.schema_version !== bootstrapConstants.schemaVersion ||
        marker.rows[0]?.policy_checksum !== bootstrapConstants.policyChecksum ||
        marker.rows[0]?.table_owner !== CONTROL_ROLE) {
      fail("collaboration_rollout_gate_schema_unsafe");
    }
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Rollback detail is private.
      }
    }
    throw safeError(error, "collaboration_rollout_gate_schema_unsafe");
  } finally {
    if (client && typeof client.release === "function") {
      try {
        client.release();
      } catch {
        // Cleanup detail is private.
      }
    }
  }
}

function adminControlBridgePool(adminPool) {
  return Object.freeze({
    query(sql, values) {
      return adminPool.query(sql, values);
    },
    async connect() {
      const raw = await adminPool.connect();
      let phase = "admin";
      return Object.freeze({
        async query(sql, values) {
          const normalized = String(sql).trim();
          if (phase === "admin" && normalized.startsWith("REVOKE ALL ON SCHEMA public,")) {
            await raw.query(`SET LOCAL ROLE ${quoteIdentifier(CONTROL_ROLE)}`);
            phase = "control";
          }
          if (phase === "control" && normalized.startsWith(`ALTER ROLE ${quoteIdentifier(RUNTIME_ROLE)}`)) {
            await raw.query("RESET ROLE");
            phase = "admin_settings";
          }
          if (phase === "admin_settings" &&
              !normalized.startsWith(`ALTER ROLE ${quoteIdentifier(RUNTIME_ROLE)}`) &&
              normalized !== "COMMIT" && normalized !== "ROLLBACK") {
            fail("collaboration_rollout_runtime_role_unsafe");
          }
          return raw.query(sql, values);
        },
        release() {
          raw.release();
        },
      });
    },
  });
}

async function configureRuntimeThroughAdmin(adminPool) {
  try {
    return await configureCollaborationRuntimeRole(
      adminControlBridgePool(adminPool),
      RUNTIME_ROLE,
      { controlPlane: true },
    );
  } catch (error) {
    throw safeError(error, "collaboration_rollout_runtime_role_unsafe");
  }
}

async function revokeControlSchemaCreation(adminPool) {
  let client;
  try {
    client = await adminPool.connect();
    await client.query("BEGIN");
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${quoteIdentifier(CONTROL_ROLE)}`);
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Rollback detail is private.
      }
    }
    throw safeError(error);
  } finally {
    if (client && typeof client.release === "function") client.release();
  }
}

async function verifyRolesFromControl(controlPool, config) {
  let result;
  try {
    result = await controlPool.query(
      `SELECT current_user,session_user,current_database() AS database_name,
              pg_get_userbyid(database_record.datdba) AS database_owner,
              control.rolcanlogin AS control_login,control.rolsuper AS control_superuser,
              control.rolcreatedb AS control_createdb,control.rolcreaterole AS control_createrole,
              control.rolinherit AS control_inherit,control.rolreplication AS control_replication,
              control.rolbypassrls AS control_bypassrls,
              runtime.rolcanlogin AS runtime_login,runtime.rolsuper AS runtime_superuser,
              runtime.rolcreatedb AS runtime_createdb,runtime.rolcreaterole AS runtime_createrole,
              runtime.rolinherit AS runtime_inherit,runtime.rolreplication AS runtime_replication,
              runtime.rolbypassrls AS runtime_bypassrls,runtime.rolconfig AS runtime_config,
              (SELECT count(*)::integer FROM pg_auth_members membership
               WHERE membership.member=runtime.oid OR membership.roleid=runtime.oid) AS runtime_membership_count,
              (SELECT count(*)::integer FROM pg_auth_members membership
               WHERE membership.member=control.oid) AS control_outgoing_membership_count,
              (SELECT count(*)::integer FROM pg_class relation WHERE relation.relowner=runtime.oid) AS runtime_owned_relations,
              (SELECT count(*)::integer FROM pg_proc function_record
               WHERE function_record.proowner=runtime.oid) AS runtime_owned_functions,
              (SELECT count(*)::integer FROM pg_namespace namespace
               WHERE namespace.nspowner=runtime.oid) AS runtime_owned_schemas,
              has_database_privilege($1,current_database(),'CONNECT') AS runtime_connect,
              has_database_privilege($1,current_database(),'CREATE') AS runtime_create,
              has_database_privilege($1,current_database(),'TEMPORARY') AS runtime_temporary,
              has_schema_privilege($1,'public','USAGE') AS runtime_public_usage,
              has_schema_privilege($1,'public','CREATE') AS runtime_public_create,
              has_schema_privilege($1,'mcp_collaboration_control','USAGE') AS runtime_control_usage,
              has_schema_privilege($1,'mcp_collaboration_control','CREATE') AS runtime_control_create,
              has_schema_privilege($1,$2,'USAGE') AS runtime_gate_usage,
              NOT EXISTS (
                SELECT 1 FROM pg_class guarded
                JOIN pg_namespace namespace ON namespace.oid=guarded.relnamespace
                WHERE namespace.nspname IN ('public','mcp_collaboration_control')
                  AND guarded.relkind IN ('r','p','v','m','f')
                  AND (has_table_privilege($1,guarded.oid,'DELETE') OR
                    has_table_privilege($1,guarded.oid,'TRUNCATE') OR
                    has_table_privilege($1,guarded.oid,'TRIGGER') OR
                    has_table_privilege($1,guarded.oid,'REFERENCES'))
              ) AS runtime_destructive_denied,
              NOT EXISTS (
                SELECT 1 FROM pg_class guarded
                JOIN pg_namespace namespace ON namespace.oid=guarded.relnamespace
                CROSS JOIN LATERAL aclexplode(COALESCE(guarded.relacl,ARRAY[]::aclitem[])) acl
                WHERE namespace.nspname IN ('public','mcp_collaboration_control')
                  AND acl.grantee=runtime.oid AND acl.is_grantable
              ) AS runtime_grant_options_denied
       FROM pg_database database_record
       JOIN pg_roles control ON control.rolname=current_user
       JOIN pg_roles runtime ON runtime.rolname=$1
       WHERE database_record.datname=current_database()`,
      [RUNTIME_ROLE, GATE_SCHEMA],
    );
  } catch (error) {
    throw safeError(error);
  }
  const row = result.rows?.[0];
  const runtimeConfig = new Set(Array.isArray(row?.runtime_config) ? row.runtime_config : []);
  if (result.rowCount !== 1 || row.current_user !== CONTROL_ROLE || row.session_user !== CONTROL_ROLE ||
      row.database_name !== config.expectedDatabaseName || row.database_owner === CONTROL_ROLE ||
      row.database_owner === RUNTIME_ROLE || row.control_login !== true || row.control_superuser !== false ||
      row.control_createdb !== false || row.control_createrole !== false || row.control_inherit !== false ||
      row.control_replication !== false || row.control_bypassrls !== false ||
      row.runtime_login !== true || row.runtime_superuser !== false || row.runtime_createdb !== false ||
      row.runtime_createrole !== false || row.runtime_inherit !== false ||
      row.runtime_replication !== false || row.runtime_bypassrls !== false ||
      row.runtime_membership_count !== 0 || row.control_outgoing_membership_count !== 0 ||
      row.runtime_owned_relations !== 0 || row.runtime_owned_functions !== 0 ||
      row.runtime_owned_schemas !== 0 || row.runtime_connect !== true || row.runtime_create !== false ||
      row.runtime_temporary !== false || row.runtime_public_usage !== true ||
      row.runtime_public_create !== false || row.runtime_control_usage !== true ||
      row.runtime_control_create !== false || row.runtime_gate_usage !== false ||
      row.runtime_destructive_denied !== true || row.runtime_grant_options_denied !== true ||
      runtimeConfig.size !== 2 ||
      !runtimeConfig.has("row_security=on") ||
      !runtimeConfig.has("search_path=pg_catalog, public, pg_temp")) {
    fail("collaboration_rollout_runtime_role_unsafe");
  }
}

async function applyAndVerifyMigration(controlPool, migrationApplier, schemaVerifier) {
  try {
    const migration = await migrationApplier(controlPool, { controlPlane: true });
    if (!migration || migration.ready !== true ||
        migration.version !== collaborationSchemaContract.version ||
        migration.migration_id !== collaborationSchemaContract.migration_id ||
        migration.checksum !== collaborationSchemaContract.checksum) {
      fail("collaboration_rollout_migration_failed");
    }
    const verified = await schemaVerifier(controlPool, { controlPlane: true });
    if (!verified || verified.ready !== true || verified.checksum !== collaborationSchemaContract.checksum) {
      fail("collaboration_rollout_migration_failed");
    }
    return verified;
  } catch (error) {
    throw safeError(error, "collaboration_rollout_migration_failed");
  }
}

async function verifyMigration(controlPool, schemaVerifier) {
  try {
    const verified = await schemaVerifier(controlPool, { controlPlane: true });
    if (!verified || verified.ready !== true ||
        verified.version !== collaborationSchemaContract.version ||
        verified.migration_id !== collaborationSchemaContract.migration_id ||
        verified.checksum !== collaborationSchemaContract.checksum) {
      fail("collaboration_rollout_migration_failed");
    }
    return verified;
  } catch (error) {
    throw safeError(error, "collaboration_rollout_migration_failed");
  }
}

function createOneUseCapability(config, controlConnectionString) {
  let connection = controlConnectionString;
  let consumed = false;
  const capability = Object.freeze({
    expectedDatabaseName: config.expectedDatabaseName,
    role: CONTROL_ROLE,
    schema: GATE_SCHEMA,
    profile: PROFILE,
    targetCommit: config.targetCommit,
    takeConnectionString() {
      if (consumed || !connection) {
        fail("collaboration_rollout_control_plane_capability_consumed");
      }
      consumed = true;
      const value = connection;
      connection = "";
      return value;
    },
  });
  return Object.freeze({
    capability,
    consumed: () => consumed,
    scrub() {
      consumed = true;
      connection = "";
    },
  });
}

export async function bootstrapMcpStagingCollaborationDatabaseWithControlPlane({
  env = process.env,
  targetCommit,
  controlPlaneFactory,
  poolFactory = defaultPoolFactory,
  migrationApplier = applyCollaborationPostgresMigration,
  schemaVerifier = verifyCollaborationPostgresSchema,
  runtimeConfigurator = configureRuntimeThroughAdmin,
  runtimeRoleAttempts,
  runtimeRolePollMs,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof controlPlaneFactory !== "function" || typeof poolFactory !== "function" ||
      typeof migrationApplier !== "function" || typeof schemaVerifier !== "function" ||
      typeof runtimeConfigurator !== "function" || typeof sleep !== "function") {
    fail("collaboration_rollout_control_plane_factory_invalid");
  }
  const config = loadConfig(env, targetCommit, { runtimeRoleAttempts, runtimeRolePollMs });
  let adminPool;
  let controlPool;
  let controlConnectionString = "";
  let controlPlane;
  let capabilityState;
  try {
    if (config.mode === INITIALIZE) {
      adminPool = await openPool(
        poolFactory,
        config.adminConnectionString,
        "mcp-staging-collaboration-bootstrap-admin",
      );
      await initializeRolesAndDatabase(adminPool, config, sleep);
    }
    controlConnectionString = roleConnectionString(
      config.endpoint,
      CONTROL_ROLE,
      config.controlPassword,
    );
    controlPool = await openPool(
      poolFactory,
      controlConnectionString,
      "mcp-staging-collaboration-bootstrap-control",
    );
    await ensureGateMarker(controlPool, config.expectedDatabaseName);
    if (config.mode === INITIALIZE) {
      await applyAndVerifyMigration(controlPool, migrationApplier, schemaVerifier);
      await runtimeConfigurator(adminPool);
      await revokeControlSchemaCreation(adminPool);
    } else {
      await verifyMigration(controlPool, schemaVerifier);
    }
    await verifyRolesFromControl(controlPool, config);
    capabilityState = createOneUseCapability(config, controlConnectionString);
    controlConnectionString = "";
    controlPlane = await controlPlaneFactory(capabilityState.capability, {
      profile: PROFILE,
      targetCommit: config.targetCommit,
    });
    if (!capabilityState.consumed() || !controlPlane ||
        typeof controlPlane.verifyAndConsumeReceipt !== "function" ||
        controlPlane.issuerReplayStore?.durable !== true ||
        typeof controlPlane.issuerReplayStore.claim !== "function" ||
        typeof controlPlane.close !== "function" || controlPlane.profile !== PROFILE) {
      fail("collaboration_rollout_control_plane_factory_invalid");
    }
    return Object.freeze({
      health: Object.freeze({
        ok: true,
        status: "ready",
        environment: ENVIRONMENT,
        schema_version: bootstrapConstants.schemaVersion,
        role_count: 2,
        isolation: "verified",
        secrets_exposed: false,
      }),
      controlPlane,
    });
  } catch (error) {
    if (controlPlane && typeof controlPlane.close === "function") {
      try {
        await controlPlane.close();
      } catch {
        // Cleanup detail is private.
      }
    }
    throw safeError(error);
  } finally {
    if (capabilityState) capabilityState.scrub();
    controlConnectionString = "";
    try {
      await closePool(controlPool);
    } catch {
      if (!controlPlane) throw new McpStagingCollaborationRolloutError(
        "collaboration_rollout_database_unavailable",
      );
    }
    try {
      await closePool(adminPool);
    } catch {
      if (!controlPlane) throw new McpStagingCollaborationRolloutError(
        "collaboration_rollout_database_unavailable",
      );
    }
  }
}

export const collaborationRolloutContract = Object.freeze({
  environment: ENVIRONMENT,
  profile: PROFILE,
  modes: Object.freeze([INITIALIZE, STEADY]),
  control_role: CONTROL_ROLE,
  runtime_role: RUNTIME_ROLE,
  runtime_role_created_by_sql: false,
  target_commit_required: true,
  provider_reference_env_key: "PG_ADMIN_DATABASE_URL",
  control_password_env_key: "MCP_STAGING_GATE_CONTROL_PASSWORD",
});
