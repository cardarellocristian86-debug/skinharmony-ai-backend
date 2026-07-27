import crypto from "node:crypto";
import { requireMcpStagingTargetCommit } from "./mcpStagingTargetCommit.js";

const SCHEMA = "mcp_staging_gate";
const ROLE = "mcp_staging_gate_control";
const ENVIRONMENT = "staging";
const TENANT_ID = "codexai";
const TARGET_SERVICE = "skinharmony-core-mcp-staging";
const OPERATION = "create_only";
const DEFAULT_PROFILE = "render_executor";
const COLLABORATION_PROFILE = "collaboration";
const STORE_VERSION = 3;
const NONCE_CLEANUP_LIMIT = 256;
const STORE_CHECKSUM = crypto.createHash("sha256")
  .update("mcp-staging-postgres-control-plane-v3\u0000strict-schema-atomic-receipts-and-issuer-replay")
  .digest("hex");
const ADVISORY_LOCK = 1_641_977_023;
const ENV_KEYS = Object.freeze([
  "MCP_STAGING_GATE_PG_HOST",
  "MCP_STAGING_GATE_PG_PORT",
  "MCP_STAGING_GATE_PG_DATABASE",
  "MCP_STAGING_GATE_PG_USER",
  "MCP_STAGING_GATE_PG_PASSWORD",
  "MCP_STAGING_CONTROL_PLANE_ENVIRONMENT",
]);
const FORBIDDEN_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "PG_ADMIN_DATABASE_URL",
  "MCP_COLLABORATION_DATABASE_URL",
]);
const TRUSTED_CONTROL_PLANE_ERROR_CODES = new Set([
  "control_plane_bootstrap_capability_invalid",
  "control_plane_close_failed",
  "control_plane_constraint_conflict",
  "control_plane_consumption_evidence_verification_failed",
  "control_plane_consumption_invalid",
  "control_plane_database_identity_unsafe",
  "control_plane_database_unavailable",
  "control_plane_database_url_forbidden",
  "control_plane_dependencies_invalid",
  "control_plane_env_invalid",
  "control_plane_issuer_nonce_invalid",
  "control_plane_non_canonical_value",
  "control_plane_pool_invalid",
  "control_plane_provider_config_invalid",
  "control_plane_receipt_already_consumed",
  "control_plane_receipt_binding_mismatch",
  "control_plane_receipt_consumption_conflict",
  "control_plane_receipt_not_consumable",
  "control_plane_receipt_consumer_unavailable",
  "control_plane_receipt_verification_invalid",
  "control_plane_schema_contract_unsafe",
  "control_plane_schema_version_mismatch",
  "control_plane_serialization_conflict",
]);
const DIGEST = /^[a-f0-9]{64}$/;
const RECEIPT_ID = /^mcpstg_receipt_[A-Za-z0-9_-]{16,96}$/;
const ATTEMPT_ID = /^mcpstg_[A-Za-z0-9._:-]{8,120}$/;
const EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "receipt_id",
  "issuer",
  "kid",
  "verification_method",
  "signature_verified",
  "signature_digest",
  "payload_digest",
  "binding_digest",
  "credential_execution_id",
  "tenant_id",
  "target_service",
  "target_environment",
  "target_commit",
  "operation",
  "issued_at",
  "expires_at",
  "core_key_handle_digest",
  "codex_bearer_mode",
  "secret_values_present",
  "secret_values_persisted",
]);
const CONSUMPTION_KEYS = Object.freeze([
  "execution_id",
  "attempt_id",
  "action_digest",
  "executor_contract_id",
  "deployment_spec_digest",
  "preflight_digest",
  "credential_grant_digest",
  "core_grant_digest",
  "nyra_attestation_digest",
  "owner_confirmation_digest",
]);
function column(name, type, notNull, defaultExpression = null) {
  return Object.freeze({
    name,
    type,
    not_null: notNull,
    default_expression: defaultExpression,
    identity: "",
    generated: "",
  });
}

function constraint(type, {
  localColumns = [],
  checkExpression = null,
  referencedSchema = null,
  referencedTable = null,
  referencedColumns = [],
  foreignUpdate = null,
  foreignDelete = null,
  foreignMatch = null,
} = {}) {
  return Object.freeze({
    type,
    local_columns: Object.freeze(localColumns),
    check_expression: checkExpression,
    referenced_schema: referencedSchema,
    referenced_table: referencedTable,
    referenced_columns: Object.freeze(referencedColumns),
    foreign_update: foreignUpdate,
    foreign_delete: foreignDelete,
    foreign_match: foreignMatch,
    deferrable: false,
    deferred: false,
    validated: true,
    no_inherit: false,
  });
}

const digestCheck = (name) => constraint("c", {
  checkExpression: `${name} ~ '^[a-f0-9]{64}$'::text`,
});
const textEqualsCheck = (name, value) => constraint("c", {
  checkExpression: `${name} = '${value}'::text`,
});

function createTableContracts(targetCommit) {
  return Object.freeze({
  bootstrap_schema_version: Object.freeze({
    columns: Object.freeze([
      column("singleton", "boolean", true, "true"),
      column("schema_version", "integer", true),
      column("policy_checksum", "text", true),
      column("installed_at", "timestamp with time zone", true, "now()"),
    ]),
    constraints: Object.freeze([
      constraint("p", { localColumns: ["singleton"] }),
      constraint("c", { checkExpression: "singleton" }),
      constraint("c", { checkExpression: "schema_version > 0" }),
      digestCheck("policy_checksum"),
    ]),
  }),
  control_plane_store_meta: Object.freeze({
    columns: Object.freeze([
      column("singleton", "boolean", true, "true"),
      column("schema_version", "integer", true),
      column("schema_checksum", "text", true),
    ]),
    constraints: Object.freeze([
      constraint("p", { localColumns: ["singleton"] }),
      constraint("c", { checkExpression: "singleton" }),
      digestCheck("schema_checksum"),
    ]),
  }),
  credential_receipts: Object.freeze({
    columns: Object.freeze([
      column("receipt_id", "text", true),
      column("evidence_digest", "text", true),
      column("issuer", "text", true),
      column("kid", "text", true),
      column("verification_method", "text", true),
      column("signature_digest", "text", true),
      column("payload_digest", "text", true),
      column("binding_digest", "text", true),
      column("credential_execution_id", "text", true),
      column("tenant_id", "text", true),
      column("target_service", "text", true),
      column("target_environment", "text", true),
      column("target_commit", "text", true),
      column("operation", "text", true),
      column("issued_at", "timestamp with time zone", true),
      column("expires_at", "timestamp with time zone", true),
      column("core_key_handle_digest", "text", true),
      column("codex_bearer_mode", "text", true),
      column("signature_verified", "boolean", true),
      column("secret_values_present", "boolean", true, "false"),
      column("secret_values_persisted", "boolean", true, "false"),
      column("consumed_at", "timestamp with time zone", false),
      column("consumed_by_execution_id", "text", false),
      column("consumed_by_idempotency_key", "text", false),
    ]),
    constraints: Object.freeze([
      constraint("p", { localColumns: ["receipt_id"] }),
      constraint("u", { localColumns: ["evidence_digest"] }),
      constraint("u", { localColumns: ["credential_execution_id"] }),
      constraint("u", { localColumns: ["consumed_by_execution_id"] }),
      constraint("u", { localColumns: ["consumed_by_idempotency_key"] }),
      digestCheck("evidence_digest"),
      textEqualsCheck("issuer", "universal-core"),
      textEqualsCheck("verification_method", "ed25519"),
      digestCheck("signature_digest"),
      digestCheck("payload_digest"),
      digestCheck("binding_digest"),
      textEqualsCheck("tenant_id", TENANT_ID),
      textEqualsCheck("target_service", TARGET_SERVICE),
      textEqualsCheck("target_environment", ENVIRONMENT),
      textEqualsCheck("target_commit", targetCommit),
      textEqualsCheck("operation", OPERATION),
      constraint("c", { checkExpression: "expires_at > issued_at" }),
      digestCheck("core_key_handle_digest"),
      textEqualsCheck("codex_bearer_mode", "render_generate_value_on_create"),
      constraint("c", { checkExpression: "signature_verified" }),
      constraint("c", { checkExpression: "NOT secret_values_present" }),
      constraint("c", { checkExpression: "NOT secret_values_persisted" }),
      constraint("c", { checkExpression: "consumed_at IS NULL AND consumed_by_execution_id IS NULL AND consumed_by_idempotency_key IS NULL OR consumed_at IS NOT NULL AND consumed_by_execution_id IS NOT NULL AND consumed_by_idempotency_key IS NOT NULL" }),
    ]),
  }),
  receipt_consumptions: Object.freeze({
    columns: Object.freeze([
      column("idempotency_key", "text", true),
      column("receipt_id", "text", true),
      column("evidence_digest", "text", true),
      column("execution_id", "text", true),
      column("binding_digest", "text", true),
      column("credential_grant_digest", "text", true),
      column("core_grant_digest", "text", true),
      column("nyra_attestation_digest", "text", true),
      column("owner_confirmation_digest", "text", true),
      column("consumed_at", "timestamp with time zone", true, "now()"),
      column("secret_values_persisted", "boolean", true, "false"),
    ]),
    constraints: Object.freeze([
      constraint("p", { localColumns: ["idempotency_key"] }),
      constraint("u", { localColumns: ["receipt_id"] }),
      constraint("u", { localColumns: ["execution_id"] }),
      constraint("f", {
        localColumns: ["receipt_id"],
        referencedSchema: SCHEMA,
        referencedTable: "credential_receipts",
        referencedColumns: ["receipt_id"],
        foreignUpdate: "a",
        foreignDelete: "a",
        foreignMatch: "s",
      }),
      digestCheck("evidence_digest"),
      digestCheck("binding_digest"),
      digestCheck("credential_grant_digest"),
      digestCheck("core_grant_digest"),
      digestCheck("nyra_attestation_digest"),
      digestCheck("owner_confirmation_digest"),
      constraint("c", { checkExpression: "NOT secret_values_persisted" }),
    ]),
  }),
  issuer_nonce_claims: Object.freeze({
    columns: Object.freeze([
      column("mode", "text", true),
      column("nonce", "text", true),
      column("claimed_at", "timestamp with time zone", true, "now()"),
      column("expires_at", "timestamp with time zone", true),
    ]),
    constraints: Object.freeze([
      constraint("p", { localColumns: ["mode", "nonce"] }),
      constraint("c", { checkExpression: "mode = ANY (ARRAY['core'::text, 'nyra'::text])" }),
      constraint("c", { checkExpression: "nonce ~ '^[A-Za-z0-9_-]{32}$'::text" }),
      constraint("c", { checkExpression: "expires_at > claimed_at" }),
    ]),
  }),
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) return false;
  return actual.sort().join("\u0000") === [...expected].sort().join("\u0000");
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new McpStagingPostgresControlPlaneError("control_plane_non_canonical_value");
}

function digest(label, value) {
  return crypto.createHash("sha256").update(`${label}\u0000${canonicalJson(value)}`).digest("hex");
}

function exactIso(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function scrub(env) {
  for (const key of ENV_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
    try {
      env[key] = "";
      delete env[key];
    } catch {
      // No error path may echo an environment value.
    }
  }
}

function readProviderConfig(env) {
  if (!env || typeof env !== "object") throw new McpStagingPostgresControlPlaneError("control_plane_env_invalid");
  let values;
  try {
    if (FORBIDDEN_ENV_KEYS.some((key) => typeof env[key] === "string" && env[key].length > 0)) {
      throw new McpStagingPostgresControlPlaneError("control_plane_database_url_forbidden");
    }
    values = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    const host = values.MCP_STAGING_GATE_PG_HOST;
    const port = Number(values.MCP_STAGING_GATE_PG_PORT);
    const database = values.MCP_STAGING_GATE_PG_DATABASE;
    const user = values.MCP_STAGING_GATE_PG_USER;
    const password = values.MCP_STAGING_GATE_PG_PASSWORD;
    if (values.MCP_STAGING_CONTROL_PLANE_ENVIRONMENT !== ENVIRONMENT ||
        typeof host !== "string" || !/^[a-z0-9][a-z0-9.-]{2,252}$/i.test(host) ||
        !Number.isSafeInteger(port) || port < 1 || port > 65_535 ||
        typeof database !== "string" || !/^[a-z0-9][a-z0-9_.-]{2,62}$/i.test(database) ||
        !/staging/i.test(database) || user !== ROLE || typeof password !== "string" ||
        password.length < 32 || password.length > 1_024 || /[\u0000-\u001f\u007f]/.test(password)) {
      throw new McpStagingPostgresControlPlaneError("control_plane_provider_config_invalid");
    }
    const url = new URL("postgresql://provider.invalid");
    url.hostname = host;
    url.port = String(port);
    url.username = user;
    url.password = password;
    url.pathname = `/${encodeURIComponent(database)}`;
    url.searchParams.set("sslmode", "require");
    url.searchParams.set("application_name", "mcp-staging-control-plane");
    return Object.freeze({ connectionString: url.toString(), database });
  } finally {
    scrub(env);
    if (values) {
      for (const key of Object.keys(values)) values[key] = "";
    }
  }
}

function safeError(error, fallback = "control_plane_database_unavailable") {
  try {
    if (error instanceof McpStagingPostgresControlPlaneError &&
        TRUSTED_CONTROL_PLANE_ERROR_CODES.has(error.code)) return error;
    if (error?.code === "40001" || error?.code === "40P01") {
      return new McpStagingPostgresControlPlaneError("control_plane_serialization_conflict");
    }
    if (["23505", "23503", "23514", "23502"].includes(error?.code)) {
      return new McpStagingPostgresControlPlaneError("control_plane_constraint_conflict");
    }
  } catch {
    // Hostile provider errors are replaced with a constant code.
  }
  return new McpStagingPostgresControlPlaneError(fallback);
}

function normalizeEvidence(value, targetCommit) {
  if (!exactKeys(value, EVIDENCE_KEYS) || value.schema_version !== "mcp_staging_verified_credential_receipt_v1" ||
      !RECEIPT_ID.test(String(value.receipt_id || "")) || value.issuer !== "universal-core" ||
      !/^ed25519-sha256:[a-f0-9]{64}$/.test(String(value.kid || "")) ||
      value.verification_method !== "ed25519" || value.signature_verified !== true ||
      !DIGEST.test(String(value.signature_digest || "")) || !DIGEST.test(String(value.payload_digest || "")) ||
      !DIGEST.test(String(value.binding_digest || "")) ||
      !/^[A-Za-z0-9._:-]{8,160}$/.test(String(value.credential_execution_id || "")) ||
      value.tenant_id !== TENANT_ID || value.target_service !== TARGET_SERVICE ||
      value.target_environment !== ENVIRONMENT || value.target_commit !== targetCommit ||
      value.operation !== OPERATION || !exactIso(value.issued_at) || !exactIso(value.expires_at) ||
      Date.parse(value.issued_at) >= Date.parse(value.expires_at) ||
      Date.parse(value.expires_at) - Date.parse(value.issued_at) > 5 * 60_000 ||
      !DIGEST.test(String(value.core_key_handle_digest || "")) ||
      value.codex_bearer_mode !== "render_generate_value_on_create" ||
      value.secret_values_present !== false || value.secret_values_persisted !== false) {
    throw new McpStagingPostgresControlPlaneError("control_plane_receipt_verification_invalid");
  }
  return Object.freeze(structuredClone(value));
}

function normalizeConsumption(value) {
  if (!exactKeys(value, CONSUMPTION_KEYS) || value.execution_id !== "skinharmony-core-mcp-staging-render-create-v1" ||
      !ATTEMPT_ID.test(String(value.attempt_id || "")) || !DIGEST.test(String(value.action_digest || "")) ||
      value.executor_contract_id !== `domain_action_${value.action_digest.slice(0, 20)}` ||
      !DIGEST.test(String(value.deployment_spec_digest || "")) || !DIGEST.test(String(value.preflight_digest || "")) ||
      !DIGEST.test(String(value.credential_grant_digest || "")) ||
      !DIGEST.test(String(value.core_grant_digest || "")) ||
      !DIGEST.test(String(value.nyra_attestation_digest || "")) ||
      !DIGEST.test(String(value.owner_confirmation_digest || ""))) {
    throw new McpStagingPostgresControlPlaneError("control_plane_consumption_invalid");
  }
  return Object.freeze(structuredClone(value));
}

function persistedEvidenceMatches(row, evidence, evidenceDigest) {
  let issuedAt;
  let expiresAt;
  try {
    issuedAt = new Date(row?.issued_at).toISOString();
    expiresAt = new Date(row?.expires_at).toISOString();
  } catch {
    return false;
  }
  return row?.receipt_id === evidence.receipt_id && row?.evidence_digest === evidenceDigest &&
    row?.issuer === evidence.issuer && row?.kid === evidence.kid &&
    row?.verification_method === evidence.verification_method &&
    row?.signature_digest === evidence.signature_digest && row?.payload_digest === evidence.payload_digest &&
    row?.binding_digest === evidence.binding_digest &&
    row?.credential_execution_id === evidence.credential_execution_id && row?.tenant_id === evidence.tenant_id &&
    row?.target_service === evidence.target_service && row?.target_environment === evidence.target_environment &&
    row?.target_commit === evidence.target_commit && row?.operation === evidence.operation &&
    issuedAt === evidence.issued_at && expiresAt === evidence.expires_at &&
    row?.core_key_handle_digest === evidence.core_key_handle_digest &&
    row?.codex_bearer_mode === evidence.codex_bearer_mode && row?.signature_verified === true &&
    row?.secret_values_present === false && row?.secret_values_persisted === false;
}

function normalizeCatalogExpression(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 4_096) return undefined;
  let normalized = value.trim().replace(/\s+/g, " ");
  for (;;) {
    if (!normalized.startsWith("(") || !normalized.endsWith(")")) break;
    let depth = 0;
    let enclosesWholeExpression = true;
    let quoted = false;
    for (let index = 0; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (character === "'" && normalized[index - 1] !== "\\") quoted = !quoted;
      if (quoted) continue;
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0 && index < normalized.length - 1) {
        enclosesWholeExpression = false;
        break;
      }
      if (depth < 0) return undefined;
    }
    if (!enclosesWholeExpression || depth !== 0 || quoted) break;
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function normalizedColumnContract(value) {
  const keys = ["name", "type", "not_null", "default_expression", "identity", "generated"];
  if (!exactKeys(value, keys) || typeof value.name !== "string" || typeof value.type !== "string" ||
      typeof value.not_null !== "boolean" || typeof value.identity !== "string" ||
      typeof value.generated !== "string") return null;
  const defaultExpression = normalizeCatalogExpression(value.default_expression);
  if (defaultExpression === undefined) return null;
  return {
    name: value.name,
    type: value.type,
    not_null: value.not_null,
    default_expression: defaultExpression,
    identity: value.identity,
    generated: value.generated,
  };
}

function normalizedConstraintContract(value) {
  const keys = [
    "type", "local_columns", "check_expression", "referenced_schema", "referenced_table",
    "referenced_columns", "foreign_update", "foreign_delete", "foreign_match", "deferrable",
    "deferred", "validated", "no_inherit",
  ];
  if (!exactKeys(value, keys) || !["c", "f", "p", "u"].includes(value.type) ||
      !Array.isArray(value.local_columns) || value.local_columns.some((item) => typeof item !== "string") ||
      !Array.isArray(value.referenced_columns) ||
      value.referenced_columns.some((item) => typeof item !== "string") ||
      ![value.deferrable, value.deferred, value.validated, value.no_inherit]
        .every((item) => typeof item === "boolean")) return null;
  const checkExpression = normalizeCatalogExpression(value.check_expression);
  if (checkExpression === undefined) return null;
  for (const key of ["referenced_schema", "referenced_table", "foreign_update", "foreign_delete", "foreign_match"]) {
    if (value[key] !== null && typeof value[key] !== "string") return null;
  }
  return {
    type: value.type,
    local_columns: [...value.local_columns],
    check_expression: checkExpression,
    referenced_schema: value.referenced_schema,
    referenced_table: value.referenced_table,
    referenced_columns: [...value.referenced_columns],
    foreign_update: value.foreign_update,
    foreign_delete: value.foreign_delete,
    foreign_match: value.foreign_match,
    deferrable: value.deferrable,
    deferred: value.deferred,
    validated: value.validated,
    no_inherit: value.no_inherit,
  };
}

function sameCatalogContract(actual, expected, normalizer, ordered) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const normalizedActual = actual.map(normalizer);
  const normalizedExpected = expected.map(normalizer);
  if (normalizedActual.some((item) => item === null) || normalizedExpected.some((item) => item === null)) return false;
  const actualValues = normalizedActual.map(canonicalJson);
  const expectedValues = normalizedExpected.map(canonicalJson);
  if (!ordered) {
    actualValues.sort();
    expectedValues.sort();
  }
  return actualValues.every((value, index) => value === expectedValues[index]);
}

async function verifyOwnedSchemaContract(client, tableContracts) {
  const objects = await client.query(`SELECT schema_object.relname, schema_object.relkind::text AS relkind
    FROM pg_class schema_object
    JOIN pg_namespace namespace ON namespace.oid = schema_object.relnamespace
    WHERE namespace.nspname = $1
      AND schema_object.relkind::text = ANY($2::text[])
    ORDER BY schema_object.relname, schema_object.relkind`, [SCHEMA, ["r", "p", "v", "m", "S", "f", "c"]]);
  const expectedObjects = Object.keys(tableContracts).sort().map((relname) => ({ relname, relkind: "r" }));
  if (canonicalJson(objects.rows) !== canonicalJson(expectedObjects)) {
    throw new McpStagingPostgresControlPlaneError("control_plane_schema_contract_unsafe");
  }

  const result = await client.query(`SELECT table_object.relname,
      pg_get_userbyid(table_object.relowner) AS table_owner,
      table_object.relkind::text AS relkind,
      table_object.relpersistence::text AS relpersistence,
      table_object.relrowsecurity,
      table_object.relforcerowsecurity,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'name', attribute.attname,
          'type', format_type(attribute.atttypid, attribute.atttypmod),
          'not_null', attribute.attnotnull,
          'default_expression', pg_get_expr(default_object.adbin, default_object.adrelid, TRUE),
          'identity', attribute.attidentity::text,
          'generated', attribute.attgenerated::text
        ) ORDER BY attribute.attnum)
        FROM pg_attribute attribute
        LEFT JOIN pg_attrdef default_object ON default_object.adrelid = attribute.attrelid
          AND default_object.adnum = attribute.attnum
        WHERE attribute.attrelid = table_object.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
      ), '[]'::jsonb) AS column_contract,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'type', constraint_object.contype::text,
          'local_columns', CASE WHEN constraint_object.contype IN ('p', 'u', 'f') THEN
            ARRAY(SELECT local_attribute.attname
              FROM unnest(constraint_object.conkey) WITH ORDINALITY AS local_key(attnum, ordinal_position)
              JOIN pg_attribute local_attribute ON local_attribute.attrelid = constraint_object.conrelid
                AND local_attribute.attnum = local_key.attnum
              ORDER BY local_key.ordinal_position) ELSE ARRAY[]::text[] END,
          'check_expression', CASE WHEN constraint_object.contype = 'c'
            THEN pg_get_expr(constraint_object.conbin, constraint_object.conrelid, TRUE) ELSE NULL END,
          'referenced_schema', CASE WHEN constraint_object.contype = 'f' THEN
            (SELECT referenced_namespace.nspname FROM pg_class referenced_table
              JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_table.relnamespace
              WHERE referenced_table.oid = constraint_object.confrelid) ELSE NULL END,
          'referenced_table', CASE WHEN constraint_object.contype = 'f' THEN
            (SELECT referenced_table.relname FROM pg_class referenced_table
              WHERE referenced_table.oid = constraint_object.confrelid) ELSE NULL END,
          'referenced_columns', CASE WHEN constraint_object.contype = 'f' THEN
            ARRAY(SELECT referenced_attribute.attname
              FROM unnest(constraint_object.confkey) WITH ORDINALITY AS referenced_key(attnum, ordinal_position)
              JOIN pg_attribute referenced_attribute ON referenced_attribute.attrelid = constraint_object.confrelid
                AND referenced_attribute.attnum = referenced_key.attnum
              ORDER BY referenced_key.ordinal_position) ELSE ARRAY[]::text[] END,
          'foreign_update', CASE WHEN constraint_object.contype = 'f'
            THEN constraint_object.confupdtype::text ELSE NULL END,
          'foreign_delete', CASE WHEN constraint_object.contype = 'f'
            THEN constraint_object.confdeltype::text ELSE NULL END,
          'foreign_match', CASE WHEN constraint_object.contype = 'f'
            THEN constraint_object.confmatchtype::text ELSE NULL END,
          'deferrable', constraint_object.condeferrable,
          'deferred', constraint_object.condeferred,
          'validated', constraint_object.convalidated,
          'no_inherit', constraint_object.connoinherit
        ) ORDER BY constraint_object.contype, constraint_object.oid)
        FROM pg_constraint constraint_object WHERE constraint_object.conrelid = table_object.oid
      ), '[]'::jsonb) AS constraint_contract,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(table_object.relacl,
        acldefault('r', table_object.relowner))) acl
        WHERE acl.grantee <> table_object.relowner) AS unexpected_acl_grantee,
      (SELECT COUNT(*)::int FROM pg_trigger trigger_object
        WHERE trigger_object.tgrelid = table_object.oid AND NOT trigger_object.tgisinternal) AS user_trigger_count
    FROM pg_class table_object
    JOIN pg_namespace namespace ON namespace.oid = table_object.relnamespace
    WHERE namespace.nspname = $1 AND table_object.relkind = 'r'
      AND table_object.relname = ANY($2::text[])`, [SCHEMA, Object.keys(tableContracts)]);
  if (result.rows.length !== Object.keys(tableContracts).length) {
    throw new McpStagingPostgresControlPlaneError("control_plane_schema_contract_unsafe");
  }
  for (const row of result.rows) {
    const expected = tableContracts[row.relname];
    if (!expected || row.table_owner !== ROLE || row.unexpected_acl_grantee !== false ||
        row.user_trigger_count !== 0 || row.relkind !== "r" || row.relpersistence !== "p" ||
        row.relrowsecurity !== false || row.relforcerowsecurity !== false ||
        !sameCatalogContract(row.column_contract, expected.columns, normalizedColumnContract, true) ||
        !sameCatalogContract(row.constraint_contract, expected.constraints, normalizedConstraintContract, false)) {
      throw new McpStagingPostgresControlPlaneError("control_plane_schema_contract_unsafe");
    }
  }
}

export class McpStagingPostgresControlPlaneError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingPostgresControlPlaneError";
    this.code = code;
  }
}

export async function createMcpStagingPostgresControlPlaneFromEnv({
  env = process.env,
  poolFactory = async (config) => {
    const { Pool } = await import("pg");
    return new Pool(config);
  },
  consumptionEvidenceVerifier,
  targetCommit: targetCommitValue,
  profile = DEFAULT_PROFILE,
} = {}) {
  let targetCommit;
  try {
    targetCommit = requireMcpStagingTargetCommit(targetCommitValue);
  } catch {
    throw new McpStagingPostgresControlPlaneError("control_plane_dependencies_invalid");
  }
  const tableContracts = createTableContracts(targetCommit);
  const provider = readProviderConfig(env);
  if (![DEFAULT_PROFILE, COLLABORATION_PROFILE].includes(profile) ||
      typeof poolFactory !== "function" ||
      (profile === DEFAULT_PROFILE && typeof consumptionEvidenceVerifier !== "function") ||
      (profile === COLLABORATION_PROFILE && consumptionEvidenceVerifier !== undefined)) {
    throw new McpStagingPostgresControlPlaneError("control_plane_dependencies_invalid");
  }
  let pool;
  try {
    pool = await poolFactory({
      connectionString: provider.connectionString,
      max: 2,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 8_000,
      query_timeout: 8_000,
      idle_in_transaction_session_timeout: 8_000,
      application_name: "mcp-staging-control-plane",
    });
  } catch (error) {
    throw safeError(error);
  }
  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") {
    if (pool && typeof pool.end === "function") {
      try { await pool.end(); } catch { /* Provider detail remains private. */ }
    }
    throw new McpStagingPostgresControlPlaneError("control_plane_pool_invalid");
  }

  async function transaction(callback, readOnly = false) {
    let client;
    try {
      client = await pool.connect();
      await client.query(`BEGIN ISOLATION LEVEL SERIALIZABLE ${readOnly ? "READ ONLY" : "READ WRITE"}`);
      await client.query("SELECT set_config('statement_timeout', '8000ms', TRUE)");
      await client.query("SELECT set_config('lock_timeout', '3000ms', TRUE)");
      await client.query("SELECT set_config('idle_in_transaction_session_timeout', '8000ms', TRUE)");
      await client.query("SELECT set_config('search_path', $1, TRUE)", [SCHEMA]);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch { /* Provider detail remains private. */ }
      }
      throw safeError(error);
    } finally {
      if (client && typeof client.release === "function") {
        try { client.release(); } catch { /* Provider detail remains private. */ }
      }
    }
  }

  async function initialize() {
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK]);
      const identity = await client.query(`SELECT current_user, current_database() AS database_name,
        pg_get_userbyid(namespace.nspowner) AS schema_owner,
        has_schema_privilege(current_user, namespace.oid, 'USAGE') AS schema_usage,
        has_schema_privilege(current_user, namespace.oid, 'CREATE') AS schema_create,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(namespace.nspacl,
          acldefault('n', namespace.nspowner))) acl
          WHERE acl.grantee <> namespace.nspowner) AS unexpected_schema_acl_grantee
        FROM pg_namespace namespace WHERE namespace.nspname = $1`, [SCHEMA]);
      const row = identity.rows[0];
      if (!row || row.current_user !== ROLE || row.database_name !== provider.database || row.schema_owner !== ROLE ||
          row.schema_usage !== true || row.schema_create !== true) {
        throw new McpStagingPostgresControlPlaneError("control_plane_database_identity_unsafe");
      }
      if (row.unexpected_schema_acl_grantee !== false) {
        throw new McpStagingPostgresControlPlaneError("control_plane_schema_contract_unsafe");
      }
      await client.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.control_plane_store_meta (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        schema_version INTEGER NOT NULL,
        schema_checksum TEXT NOT NULL CHECK (schema_checksum ~ '^[a-f0-9]{64}$')
      )`);
      await client.query(`INSERT INTO ${SCHEMA}.control_plane_store_meta (singleton, schema_version, schema_checksum)
        VALUES (TRUE, $1, $2) ON CONFLICT (singleton) DO NOTHING`, [STORE_VERSION, STORE_CHECKSUM]);
      const metadata = await client.query(`SELECT schema_version, schema_checksum
        FROM ${SCHEMA}.control_plane_store_meta WHERE singleton IS TRUE FOR UPDATE`);
      if (metadata.rows.length !== 1 || metadata.rows[0].schema_version !== STORE_VERSION ||
          metadata.rows[0].schema_checksum !== STORE_CHECKSUM) {
        throw new McpStagingPostgresControlPlaneError("control_plane_schema_version_mismatch");
      }
      await client.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.credential_receipts (
        receipt_id TEXT PRIMARY KEY,
        evidence_digest TEXT NOT NULL UNIQUE CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
        issuer TEXT NOT NULL CHECK (issuer = 'universal-core'),
        kid TEXT NOT NULL, verification_method TEXT NOT NULL CHECK (verification_method = 'ed25519'),
        signature_digest TEXT NOT NULL CHECK (signature_digest ~ '^[a-f0-9]{64}$'),
        payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
        binding_digest TEXT NOT NULL CHECK (binding_digest ~ '^[a-f0-9]{64}$'),
        credential_execution_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL CHECK (tenant_id = '${TENANT_ID}'),
        target_service TEXT NOT NULL CHECK (target_service = '${TARGET_SERVICE}'),
        target_environment TEXT NOT NULL CHECK (target_environment = '${ENVIRONMENT}'),
        target_commit TEXT NOT NULL CHECK (target_commit = '${targetCommit}'),
        operation TEXT NOT NULL CHECK (operation = '${OPERATION}'),
        issued_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > issued_at),
        core_key_handle_digest TEXT NOT NULL CHECK (core_key_handle_digest ~ '^[a-f0-9]{64}$'),
        codex_bearer_mode TEXT NOT NULL CHECK (codex_bearer_mode = 'render_generate_value_on_create'),
        signature_verified BOOLEAN NOT NULL CHECK (signature_verified),
        secret_values_present BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT secret_values_present),
        secret_values_persisted BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT secret_values_persisted),
        consumed_at TIMESTAMPTZ, consumed_by_execution_id TEXT UNIQUE, consumed_by_idempotency_key TEXT UNIQUE,
        CHECK ((consumed_at IS NULL AND consumed_by_execution_id IS NULL AND consumed_by_idempotency_key IS NULL) OR
          (consumed_at IS NOT NULL AND consumed_by_execution_id IS NOT NULL AND consumed_by_idempotency_key IS NOT NULL))
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.receipt_consumptions (
        idempotency_key TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL UNIQUE REFERENCES ${SCHEMA}.credential_receipts(receipt_id),
        evidence_digest TEXT NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
        execution_id TEXT NOT NULL UNIQUE,
        binding_digest TEXT NOT NULL CHECK (binding_digest ~ '^[a-f0-9]{64}$'),
        credential_grant_digest TEXT NOT NULL CHECK (credential_grant_digest ~ '^[a-f0-9]{64}$'),
        core_grant_digest TEXT NOT NULL CHECK (core_grant_digest ~ '^[a-f0-9]{64}$'),
        nyra_attestation_digest TEXT NOT NULL CHECK (nyra_attestation_digest ~ '^[a-f0-9]{64}$'),
        owner_confirmation_digest TEXT NOT NULL CHECK (owner_confirmation_digest ~ '^[a-f0-9]{64}$'),
        consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        secret_values_persisted BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT secret_values_persisted)
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.issuer_nonce_claims (
        mode TEXT NOT NULL CHECK (mode IN ('core', 'nyra')),
        nonce TEXT NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{32}$'),
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > claimed_at),
        PRIMARY KEY (mode, nonce)
      )`);
      await verifyOwnedSchemaContract(client, tableContracts);
    });
  }

  try {
    await initialize();
  } catch (error) {
    try { await pool.end(); } catch { /* Provider detail remains private. */ }
    throw safeError(error);
  }

  async function claimIssuerNonce(input) {
    if (!exactKeys(input, ["mode", "nonce", "now_ms", "expires_at"]) ||
        !["core", "nyra"].includes(input.mode) ||
        !/^[A-Za-z0-9_-]{32}$/.test(String(input.nonce || "")) ||
        !Number.isSafeInteger(input.now_ms) || !Number.isSafeInteger(input.expires_at) ||
        input.expires_at <= input.now_ms || input.expires_at - input.now_ms > 30_000) {
      throw new McpStagingPostgresControlPlaneError("control_plane_issuer_nonce_invalid");
    }
    return transaction(async (client) => {
      await client.query(`WITH expired AS MATERIALIZED (
          SELECT mode, nonce FROM ${SCHEMA}.issuer_nonce_claims
          WHERE expires_at <= NOW()
          ORDER BY expires_at, mode, nonce
          LIMIT $1
        )
        DELETE FROM ${SCHEMA}.issuer_nonce_claims AS claimed
        USING expired
        WHERE claimed.mode = expired.mode AND claimed.nonce = expired.nonce`, [NONCE_CLEANUP_LIMIT]);
      const claimed = await client.query(`INSERT INTO ${SCHEMA}.issuer_nonce_claims
        (mode, nonce, claimed_at, expires_at)
        SELECT $1, $2, NOW(), to_timestamp($3 / 1000.0)
        WHERE to_timestamp($3 / 1000.0) > NOW()
          AND to_timestamp($3 / 1000.0) <= NOW() + INTERVAL '30 seconds'
        ON CONFLICT (mode, nonce) DO NOTHING`, [input.mode, input.nonce, input.expires_at]);
      return claimed.rowCount === 1;
    });
  }

  const issuerReplayStore = Object.freeze({
    durable: true,
    claim: claimIssuerNonce,
  });

  async function verifyAndConsumeReceipt(input) {
    if (profile === COLLABORATION_PROFILE) {
      throw new McpStagingPostgresControlPlaneError("control_plane_receipt_consumer_unavailable");
    }
    let verifiedResult;
    try {
      verifiedResult = await consumptionEvidenceVerifier(input);
    } catch {
      throw new McpStagingPostgresControlPlaneError("control_plane_consumption_evidence_verification_failed");
    }
    if (!exactKeys(verifiedResult, ["receipt_evidence", "consumption", "temporally_current"]) ||
        typeof verifiedResult.temporally_current !== "boolean") {
      throw new McpStagingPostgresControlPlaneError("control_plane_consumption_evidence_verification_failed");
    }
    let verified;
    try {
      verified = normalizeEvidence(verifiedResult.receipt_evidence, targetCommit);
    } catch {
      throw new McpStagingPostgresControlPlaneError("control_plane_consumption_evidence_verification_failed");
    }
    const binding = normalizeConsumption(verifiedResult.consumption);
    if (binding.credential_grant_digest !== verified.binding_digest) {
      throw new McpStagingPostgresControlPlaneError("control_plane_receipt_binding_mismatch");
    }
    const evidenceDigest = digest("mcp-staging-verified-receipt-v1", verified);
    const consumptionBindingDigest = digest("mcp-staging-receipt-consumption-v1", {
      receipt_id: verified.receipt_id,
      evidence_digest: evidenceDigest,
      ...binding,
      tenant_id: TENANT_ID,
      target_service: TARGET_SERVICE,
      target_commit: targetCommit,
      operation: OPERATION,
    });
    const idempotencyKey = `mcpstg-consume-${consumptionBindingDigest}`;
    return transaction(async (client) => {
      await client.query(`INSERT INTO ${SCHEMA}.credential_receipts (
        receipt_id,evidence_digest,issuer,kid,verification_method,signature_digest,payload_digest,binding_digest,
        credential_execution_id,tenant_id,target_service,target_environment,target_commit,operation,
        issued_at,expires_at,core_key_handle_digest,codex_bearer_mode,signature_verified,
        secret_values_present,secret_values_persisted
      ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16::timestamptz,$17,$18,TRUE,FALSE,FALSE
        WHERE $15::timestamptz <= NOW() AND $16::timestamptz > NOW()
      ON CONFLICT (receipt_id) DO NOTHING`, [
        verified.receipt_id, evidenceDigest, verified.issuer, verified.kid, verified.verification_method,
        verified.signature_digest, verified.payload_digest, verified.binding_digest, verified.credential_execution_id,
        verified.tenant_id, verified.target_service, verified.target_environment, verified.target_commit,
        verified.operation, verified.issued_at, verified.expires_at, verified.core_key_handle_digest,
        verified.codex_bearer_mode,
      ]);
      const locked = await client.query(`SELECT *,
        (issued_at <= NOW() AND expires_at > NOW()) AS currently_valid
        FROM ${SCHEMA}.credential_receipts WHERE receipt_id = $1 FOR UPDATE`, [verified.receipt_id]);
      const receipt = locked.rows[0];
      if (!persistedEvidenceMatches(receipt, verified, evidenceDigest)) {
        throw new McpStagingPostgresControlPlaneError("control_plane_receipt_not_consumable");
      }
      if (receipt.consumed_at !== null) {
        if (receipt.consumed_by_execution_id !== binding.execution_id ||
            receipt.consumed_by_idempotency_key !== idempotencyKey) {
          throw new McpStagingPostgresControlPlaneError("control_plane_receipt_already_consumed");
        }
        return Object.freeze({ ok: true, status: "consumed", idempotent: true,
          receipt_id: verified.receipt_id, evidence_digest: evidenceDigest, execution_id: binding.execution_id,
          idempotency_key: idempotencyKey, secrets_exposed: false });
      }
      if (verifiedResult.temporally_current !== true || receipt.currently_valid !== true) {
        throw new McpStagingPostgresControlPlaneError("control_plane_receipt_not_consumable");
      }
      await client.query(`INSERT INTO ${SCHEMA}.receipt_consumptions (
        idempotency_key,receipt_id,evidence_digest,execution_id,binding_digest,credential_grant_digest,
        core_grant_digest,nyra_attestation_digest,owner_confirmation_digest,secret_values_persisted
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)`, [
        idempotencyKey, verified.receipt_id, evidenceDigest, binding.execution_id, consumptionBindingDigest,
        binding.credential_grant_digest, binding.core_grant_digest, binding.nyra_attestation_digest,
        binding.owner_confirmation_digest,
      ]);
      const consumed = await client.query(`UPDATE ${SCHEMA}.credential_receipts
        SET consumed_at = NOW(), consumed_by_execution_id = $2, consumed_by_idempotency_key = $3
        WHERE receipt_id = $1 AND consumed_at IS NULL`, [verified.receipt_id, binding.execution_id, idempotencyKey]);
      if (consumed.rowCount !== 1) {
        throw new McpStagingPostgresControlPlaneError("control_plane_receipt_consumption_conflict");
      }
      return Object.freeze({ ok: true, status: "consumed", idempotent: false,
        receipt_id: verified.receipt_id, evidence_digest: evidenceDigest, execution_id: binding.execution_id,
        idempotency_key: idempotencyKey, secrets_exposed: false });
    });
  }

  async function close() {
    try { await pool.end(); } catch { throw new McpStagingPostgresControlPlaneError("control_plane_close_failed"); }
  }

  return Object.freeze({ profile, verifyAndConsumeReceipt, issuerReplayStore, close });
}

export async function createMcpStagingPostgresControlPlaneFromBootstrap({
  capability,
  poolFactory,
  consumptionEvidenceVerifier,
  targetCommit,
  profile = DEFAULT_PROFILE,
} = {}) {
  if (!capability || typeof capability !== "object" ||
      typeof capability.takeConnectionString !== "function" ||
      (profile === COLLABORATION_PROFILE &&
        (capability.profile !== COLLABORATION_PROFILE || capability.targetCommit !== targetCommit))) {
    throw new McpStagingPostgresControlPlaneError("control_plane_bootstrap_capability_invalid");
  }
  let connectionString;
  let parsed;
  try {
    connectionString = capability.takeConnectionString();
    parsed = new URL(connectionString);
  } catch {
    throw new McpStagingPostgresControlPlaneError("control_plane_bootstrap_capability_invalid");
  } finally {
    connectionString = "";
  }
  const database = (() => {
    try { return decodeURIComponent(parsed.pathname.replace(/^\//, "")); } catch { return ""; }
  })();
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.username !== ROLE ||
      !parsed.password || database !== capability.expectedDatabaseName || capability.role !== ROLE ||
      capability.schema !== SCHEMA || !parsed.hostname) {
    parsed.password = "";
    throw new McpStagingPostgresControlPlaneError("control_plane_bootstrap_capability_invalid");
  }
  const ephemeralEnv = {
    MCP_STAGING_GATE_PG_HOST: parsed.hostname,
    MCP_STAGING_GATE_PG_PORT: parsed.port || "5432",
    MCP_STAGING_GATE_PG_DATABASE: database,
    MCP_STAGING_GATE_PG_USER: parsed.username,
    MCP_STAGING_GATE_PG_PASSWORD: parsed.password,
    MCP_STAGING_CONTROL_PLANE_ENVIRONMENT: ENVIRONMENT,
  };
  try {
    return await createMcpStagingPostgresControlPlaneFromEnv({
      env: ephemeralEnv,
      poolFactory,
      consumptionEvidenceVerifier,
      targetCommit,
      profile,
    });
  } finally {
    scrub(ephemeralEnv);
    parsed.password = "";
  }
}

export const mcpStagingPostgresControlPlaneContract = Object.freeze({
  schema: SCHEMA,
  role: ROLE,
  environment: ENVIRONMENT,
  tenant_id: TENANT_ID,
  target_service: TARGET_SERVICE,
  target_commit_required: true,
  operation: OPERATION,
  profiles: Object.freeze([DEFAULT_PROFILE, COLLABORATION_PROFILE]),
  catalog: createTableContracts,
});
