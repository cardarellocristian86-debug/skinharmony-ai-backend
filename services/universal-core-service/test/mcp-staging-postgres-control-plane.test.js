import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createMcpStagingPostgresControlPlaneFromBootstrap,
  createMcpStagingPostgresControlPlaneFromEnv,
  McpStagingPostgresControlPlaneError,
  mcpStagingPostgresControlPlaneContract,
} from "../src/mcpStagingPostgresControlPlane.js";

const ROLE = "mcp_staging_gate_control";
const DATABASE = "skinharmony_mcp_staging";
const TARGET_COMMIT = crypto.randomBytes(20).toString("hex");
const PASSWORD_MARKER = "provider-password-marker-0000000000000000";

function providerEnv(overrides = {}) {
  return {
    MCP_STAGING_GATE_PG_HOST: "internal-staging-db.invalid",
    MCP_STAGING_GATE_PG_PORT: "5432",
    MCP_STAGING_GATE_PG_DATABASE: DATABASE,
    MCP_STAGING_GATE_PG_USER: ROLE,
    MCP_STAGING_GATE_PG_PASSWORD: PASSWORD_MARKER,
    MCP_STAGING_CONTROL_PLANE_ENVIRONMENT: "staging",
    ...overrides,
  };
}

function verifiedEvidence(overrides = {}) {
  const now = Date.now();
  return {
    schema_version: "mcp_staging_verified_credential_receipt_v1",
    receipt_id: "mcpstg_receipt_0123456789abcdef",
    issuer: "universal-core",
    kid: `ed25519-sha256:${"1".repeat(64)}`,
    verification_method: "ed25519",
    signature_verified: true,
    signature_digest: "2".repeat(64),
    payload_digest: "3".repeat(64),
    binding_digest: "4".repeat(64),
    credential_execution_id: "mcp-staging-credentials-20260719-01",
    tenant_id: "codexai",
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_commit: TARGET_COMMIT,
    operation: "create_only",
    issued_at: new Date(now - 2_000).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
    core_key_handle_digest: "5".repeat(64),
    codex_bearer_mode: "render_generate_value_on_create",
    secret_values_present: false,
    secret_values_persisted: false,
    ...overrides,
  };
}

function consumption(overrides = {}) {
  const actionDigest = overrides.action_digest || "6".repeat(64);
  return {
    execution_id: "skinharmony-core-mcp-staging-render-create-v1",
    attempt_id: "mcpstg_attempt-12345678",
    action_digest: actionDigest,
    executor_contract_id: `domain_action_${actionDigest.slice(0, 20)}`,
    deployment_spec_digest: "7".repeat(64),
    preflight_digest: "8".repeat(64),
    credential_grant_digest: "4".repeat(64),
    core_grant_digest: "9".repeat(64),
    nyra_attestation_digest: "a".repeat(64),
    owner_confirmation_digest: "b".repeat(64),
    ...overrides,
  };
}

function catalogColumn(name, type, notNull, defaultExpression = null) {
  return { name, type, not_null: notNull, default_expression: defaultExpression, identity: "", generated: "" };
}

function catalogConstraint(type, overrides = {}) {
  return {
    type,
    local_columns: [],
    check_expression: null,
    referenced_schema: null,
    referenced_table: null,
    referenced_columns: [],
    foreign_update: null,
    foreign_delete: null,
    foreign_match: null,
    deferrable: false,
    deferred: false,
    validated: true,
    no_inherit: false,
    ...overrides,
  };
}

const digestConstraint = (name) => catalogConstraint("c", {
  check_expression: `${name} ~ '^[a-f0-9]{64}$'::text`,
});
const equalsConstraint = (name, value) => catalogConstraint("c", {
  check_expression: `${name} = '${value}'::text`,
});

function exactCatalogRows() {
  const base = {
    table_owner: ROLE,
    relkind: "r",
    relpersistence: "p",
    relrowsecurity: false,
    relforcerowsecurity: false,
    unexpected_acl_grantee: false,
    user_trigger_count: 0,
  };
  return [
    { ...base, relname: "bootstrap_schema_version", column_contract: [
      catalogColumn("singleton", "boolean", true, "true"),
      catalogColumn("schema_version", "integer", true),
      catalogColumn("policy_checksum", "text", true),
      catalogColumn("installed_at", "timestamp with time zone", true, "now()"),
    ], constraint_contract: [
      catalogConstraint("p", { local_columns: ["singleton"] }),
      catalogConstraint("c", { check_expression: "singleton" }),
      catalogConstraint("c", { check_expression: "schema_version > 0" }),
      digestConstraint("policy_checksum"),
    ] },
    { ...base, relname: "control_plane_store_meta", column_contract: [
      catalogColumn("singleton", "boolean", true, "true"),
      catalogColumn("schema_version", "integer", true),
      catalogColumn("schema_checksum", "text", true),
    ], constraint_contract: [
      catalogConstraint("p", { local_columns: ["singleton"] }),
      catalogConstraint("c", { check_expression: "singleton" }),
      digestConstraint("schema_checksum"),
    ] },
    { ...base, relname: "credential_receipts", column_contract: [
      catalogColumn("receipt_id", "text", true),
      catalogColumn("evidence_digest", "text", true),
      catalogColumn("issuer", "text", true),
      catalogColumn("kid", "text", true),
      catalogColumn("verification_method", "text", true),
      catalogColumn("signature_digest", "text", true),
      catalogColumn("payload_digest", "text", true),
      catalogColumn("binding_digest", "text", true),
      catalogColumn("credential_execution_id", "text", true),
      catalogColumn("tenant_id", "text", true),
      catalogColumn("target_service", "text", true),
      catalogColumn("target_environment", "text", true),
      catalogColumn("target_commit", "text", true),
      catalogColumn("operation", "text", true),
      catalogColumn("issued_at", "timestamp with time zone", true),
      catalogColumn("expires_at", "timestamp with time zone", true),
      catalogColumn("core_key_handle_digest", "text", true),
      catalogColumn("codex_bearer_mode", "text", true),
      catalogColumn("signature_verified", "boolean", true),
      catalogColumn("secret_values_present", "boolean", true, "false"),
      catalogColumn("secret_values_persisted", "boolean", true, "false"),
      catalogColumn("consumed_at", "timestamp with time zone", false),
      catalogColumn("consumed_by_execution_id", "text", false),
      catalogColumn("consumed_by_idempotency_key", "text", false),
    ], constraint_contract: [
      catalogConstraint("p", { local_columns: ["receipt_id"] }),
      catalogConstraint("u", { local_columns: ["evidence_digest"] }),
      catalogConstraint("u", { local_columns: ["credential_execution_id"] }),
      catalogConstraint("u", { local_columns: ["consumed_by_execution_id"] }),
      catalogConstraint("u", { local_columns: ["consumed_by_idempotency_key"] }),
      digestConstraint("evidence_digest"),
      equalsConstraint("issuer", "universal-core"),
      equalsConstraint("verification_method", "ed25519"),
      digestConstraint("signature_digest"),
      digestConstraint("payload_digest"),
      digestConstraint("binding_digest"),
      equalsConstraint("tenant_id", "codexai"),
      equalsConstraint("target_service", "skinharmony-core-mcp-staging"),
      equalsConstraint("target_environment", "staging"),
      equalsConstraint("target_commit", TARGET_COMMIT),
      equalsConstraint("operation", "create_only"),
      catalogConstraint("c", { check_expression: "expires_at > issued_at" }),
      digestConstraint("core_key_handle_digest"),
      equalsConstraint("codex_bearer_mode", "render_generate_value_on_create"),
      catalogConstraint("c", { check_expression: "signature_verified" }),
      catalogConstraint("c", { check_expression: "NOT secret_values_present" }),
      catalogConstraint("c", { check_expression: "NOT secret_values_persisted" }),
      catalogConstraint("c", { check_expression: "consumed_at IS NULL AND consumed_by_execution_id IS NULL AND consumed_by_idempotency_key IS NULL OR consumed_at IS NOT NULL AND consumed_by_execution_id IS NOT NULL AND consumed_by_idempotency_key IS NOT NULL" }),
    ] },
    { ...base, relname: "receipt_consumptions", column_contract: [
      catalogColumn("idempotency_key", "text", true),
      catalogColumn("receipt_id", "text", true),
      catalogColumn("evidence_digest", "text", true),
      catalogColumn("execution_id", "text", true),
      catalogColumn("binding_digest", "text", true),
      catalogColumn("credential_grant_digest", "text", true),
      catalogColumn("core_grant_digest", "text", true),
      catalogColumn("nyra_attestation_digest", "text", true),
      catalogColumn("owner_confirmation_digest", "text", true),
      catalogColumn("consumed_at", "timestamp with time zone", true, "now()"),
      catalogColumn("secret_values_persisted", "boolean", true, "false"),
    ], constraint_contract: [
      catalogConstraint("p", { local_columns: ["idempotency_key"] }),
      catalogConstraint("u", { local_columns: ["receipt_id"] }),
      catalogConstraint("u", { local_columns: ["execution_id"] }),
      catalogConstraint("f", {
        local_columns: ["receipt_id"],
        referenced_schema: "mcp_staging_gate",
        referenced_table: "credential_receipts",
        referenced_columns: ["receipt_id"],
        foreign_update: "a",
        foreign_delete: "a",
        foreign_match: "s",
      }),
      digestConstraint("evidence_digest"),
      digestConstraint("binding_digest"),
      digestConstraint("credential_grant_digest"),
      digestConstraint("core_grant_digest"),
      digestConstraint("nyra_attestation_digest"),
      digestConstraint("owner_confirmation_digest"),
      catalogConstraint("c", { check_expression: "NOT secret_values_persisted" }),
    ] },
    { ...base, relname: "issuer_nonce_claims", column_contract: [
      catalogColumn("mode", "text", true),
      catalogColumn("nonce", "text", true),
      catalogColumn("claimed_at", "timestamp with time zone", true, "now()"),
      catalogColumn("expires_at", "timestamp with time zone", true),
    ], constraint_contract: [
      catalogConstraint("p", { local_columns: ["mode", "nonce"] }),
      catalogConstraint("c", { check_expression: "mode = ANY (ARRAY['core'::text, 'nyra'::text])" }),
      catalogConstraint("c", { check_expression: "nonce ~ '^[A-Za-z0-9_-]{32}$'::text" }),
      catalogConstraint("c", { check_expression: "expires_at > claimed_at" }),
    ] },
  ];
}

class RecordingPool {
  constructor({
    identity = {},
    connectError = null,
    lockReceipt = true,
    currentlyValid = true,
    unsafeSchema = false,
  } = {}) {
    this.identity = identity;
    this.connectError = connectError;
    this.lockReceipt = lockReceipt;
    this.currentlyValid = currentlyValid;
    this.unsafeSchema = unsafeSchema;
    this.calls = [];
    this.releases = 0;
    this.ends = 0;
    this.transactions = 0;
    this.meta = null;
    this.receipt = null;
    this.consumptionInserts = 0;
    this.issuerNonces = new Map();
    this.nonceCleanupBatchSizes = [];
  }

  async connect() {
    if (this.connectError) throw this.connectError;
    return {
      query: async (sql, values = []) => this.query(sql, values),
      release: () => { this.releases += 1; },
    };
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    if (sql.startsWith("BEGIN")) {
      this.transactions += 1;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("SELECT current_user")) {
      return { rows: [{
        current_user: ROLE,
        database_name: DATABASE,
        schema_owner: ROLE,
        schema_usage: true,
        schema_create: true,
        unexpected_schema_acl_grantee: this.unsafeSchema === "schema_acl",
        ...this.identity,
      }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO mcp_staging_gate.control_plane_store_meta")) {
      this.meta ||= { schema_version: values[0], schema_checksum: values[1] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT schema_version, schema_checksum")) {
      return { rows: this.meta ? [this.meta] : [], rowCount: this.meta ? 1 : 0 };
    }
    if (sql.includes("FROM pg_class schema_object")) {
      const rows = exactCatalogRows()
        .map(({ relname, relkind }) => ({ relname, relkind }))
        .sort((left, right) => left.relname.localeCompare(right.relname));
      if (this.unsafeSchema === "extra_object") rows.push({ relname: "unexpected_table", relkind: "r" });
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM pg_class table_object")) {
      const rows = structuredClone(exactCatalogRows());
      const target = rows.find(({ relname }) => relname === "credential_receipts");
      if (this.unsafeSchema === true || this.unsafeSchema === "owner") target.table_owner = "postgres";
      if (this.unsafeSchema === "table_acl") target.unexpected_acl_grantee = true;
      if (this.unsafeSchema === "unlogged") target.relpersistence = "u";
      if (this.unsafeSchema === "rls") target.relrowsecurity = true;
      if (this.unsafeSchema === "forced_rls") target.relforcerowsecurity = true;
      if (this.unsafeSchema === "column_type") target.column_contract[3].type = "character varying";
      if (this.unsafeSchema === "column_nullability") target.column_contract[3].not_null = false;
      if (this.unsafeSchema === "column_default") target.column_contract[3].default_expression = "''::text";
      if (this.unsafeSchema === "constraint_expression") {
        const nonceTable = rows.find(({ relname }) => relname === "issuer_nonce_claims");
        nonceTable.constraint_contract[1].check_expression = "mode = 'core'::text";
      }
      if (this.unsafeSchema === "constraint_validation") target.constraint_contract[5].validated = false;
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("DELETE FROM mcp_staging_gate.issuer_nonce_claims AS claimed")) {
      const expiredKeys = [...this.issuerNonces.entries()]
        .filter(([, expiresAt]) => expiresAt <= Date.now())
        .sort((left, right) => left[1] - right[1])
        .slice(0, values[0])
        .map(([key]) => key);
      for (const key of expiredKeys) this.issuerNonces.delete(key);
      this.nonceCleanupBatchSizes.push(expiredKeys.length);
      return { rows: [], rowCount: expiredKeys.length };
    }
    if (sql.includes("INSERT INTO mcp_staging_gate.issuer_nonce_claims")) {
      const key = `${values[0]}:${values[1]}`;
      if (this.issuerNonces.has(key)) return { rows: [], rowCount: 0 };
      this.issuerNonces.set(key, values[2]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO mcp_staging_gate.credential_receipts")) {
      if (!this.receipt) {
        this.receipt = {
          receipt_id: values[0],
          evidence_digest: values[1],
          issuer: values[2],
          kid: values[3],
          verification_method: values[4],
          signature_digest: values[5],
          payload_digest: values[6],
          binding_digest: values[7],
          credential_execution_id: values[8],
          tenant_id: values[9],
          target_service: values[10],
          target_environment: values[11],
          target_commit: values[12],
          operation: values[13],
          issued_at: values[14],
          expires_at: values[15],
          core_key_handle_digest: values[16],
          codex_bearer_mode: values[17],
          signature_verified: true,
          secret_values_present: false,
          secret_values_persisted: false,
          consumed_at: null,
          consumed_by_execution_id: null,
          consumed_by_idempotency_key: null,
        };
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM mcp_staging_gate.credential_receipts WHERE receipt_id")) {
      const rows = this.lockReceipt && this.receipt
        ? [{ ...this.receipt, currently_valid: this.currentlyValid }]
        : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("INSERT INTO mcp_staging_gate.receipt_consumptions")) {
      this.consumptionInserts += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE mcp_staging_gate.credential_receipts")) {
      if (!this.receipt || this.receipt.consumed_at !== null) return { rows: [], rowCount: 0 };
      this.receipt.consumed_at = new Date().toISOString();
      this.receipt.consumed_by_execution_id = values[1];
      this.receipt.consumed_by_idempotency_key = values[2];
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  async end() {
    this.ends += 1;
  }
}

async function controlPlane({ env = providerEnv(), pool = new RecordingPool(), verifier } = {}) {
  let poolConfig;
  const evidence = verifiedEvidence();
  const plane = await createMcpStagingPostgresControlPlaneFromEnv({
    env,
    poolFactory: async (config) => {
      poolConfig = config;
      return pool;
    },
    consumptionEvidenceVerifier: verifier || (async (input) => ({
      receipt_evidence: structuredClone(evidence),
      consumption: structuredClone(input.consumption),
      temporally_current: true,
    })),
    targetCommit: TARGET_COMMIT,
  });
  return { plane, pool, poolConfig };
}

test("uses only an exact staging control role, creates the DSN in memory, and scrubs inputs", async () => {
  const env = providerEnv();
  const { plane, pool, poolConfig } = await controlPlane({ env });

  assert.deepEqual(env, {});
  const dsn = new URL(poolConfig.connectionString);
  assert.equal(dsn.protocol, "postgresql:");
  assert.equal(dsn.hostname, "internal-staging-db.invalid");
  assert.equal(dsn.username, ROLE);
  assert.equal(dsn.pathname, `/${DATABASE}`);
  assert.equal(dsn.searchParams.get("sslmode"), "require");
  assert.equal(mcpStagingPostgresControlPlaneContract.environment, "staging");
  assert.equal(mcpStagingPostgresControlPlaneContract.role, ROLE);

  const sql = pool.calls.map(({ sql: statement }) => statement).join("\n");
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /pg_get_userbyid\(namespace\.nspowner\)/);
  assert.match(sql, /mcp_staging_gate\.credential_receipts/);
  assert.match(sql, /mcp_staging_gate\.receipt_consumptions/);
  assert.match(sql, /credential_grant_digest TEXT NOT NULL/);
  assert.match(sql, /core_grant_digest TEXT NOT NULL/);
  assert.match(sql, /nyra_attestation_digest TEXT NOT NULL/);
  assert.match(sql, /owner_confirmation_digest TEXT NOT NULL/);
  assert.equal(sql.includes("CREATE SCHEMA"), false);
  assert.equal(sql.includes("DATABASE_URL"), false);
  assert.equal(sql.includes("AUTH0"), false);
  assert.equal(JSON.stringify(pool.calls).includes(PASSWORD_MARKER), false);
  await plane.close();
  assert.equal(pool.ends, 1);
});

test("accepts only the one-use bootstrap capability and clears its role connection", async () => {
  const roleUrl = new URL(`postgresql://placeholder@internal-staging-db.invalid/${DATABASE}`);
  roleUrl.username = ROLE;
  roleUrl.password = PASSWORD_MARKER;
  let roleConnection = roleUrl.toString();
  const capability = Object.freeze({
    expectedDatabaseName: DATABASE,
    role: ROLE,
    schema: "mcp_staging_gate",
    takeConnectionString() {
      if (!roleConnection) throw new Error("consumed");
      const value = roleConnection;
      roleConnection = "";
      return value;
    },
  });
  const pool = new RecordingPool();
  const plane = await createMcpStagingPostgresControlPlaneFromBootstrap({
    capability,
    poolFactory: async () => pool,
    consumptionEvidenceVerifier: async (input) => ({
      receipt_evidence: verifiedEvidence(), consumption: input.consumption, temporally_current: true,
    }),
    targetCommit: TARGET_COMMIT,
  });
  assert.equal(roleConnection, "");
  assert.throws(() => capability.takeConnectionString(), /consumed/);
  assert.equal(pool.calls.some(({ sql }) => sql.includes("SELECT current_user")), true);
  await plane.close();

  await assert.rejects(createMcpStagingPostgresControlPlaneFromBootstrap({
    capability: {
      expectedDatabaseName: DATABASE,
      role: ROLE,
      schema: "mcp_staging_gate",
      takeConnectionString: () =>
        `postgresql://postgres:${PASSWORD_MARKER}@internal-staging-db.invalid/${DATABASE}`,
    },
    poolFactory: async () => new RecordingPool(),
    consumptionEvidenceVerifier: async (input) => ({
      receipt_evidence: verifiedEvidence(), consumption: input.consumption, temporally_current: true,
    }),
    targetCommit: TARGET_COMMIT,
  }), /control_plane_bootstrap_capability_invalid/);
});

test("claims issuer nonces atomically in the durable PostgreSQL replay store", async () => {
  const pool = new RecordingPool();
  const { plane } = await controlPlane({ pool });
  const now = Date.now();
  const claim = {
    mode: "core",
    nonce: "r".repeat(32),
    now_ms: now,
    expires_at: now + 20_000,
  };
  assert.equal(plane.issuerReplayStore.durable, true);
  assert.equal(await plane.issuerReplayStore.claim(claim), true);
  assert.equal(await plane.issuerReplayStore.claim(claim), false);
  assert.equal(await plane.issuerReplayStore.claim({ ...claim, mode: "nyra" }), true);
  await assert.rejects(
    plane.issuerReplayStore.claim({ ...claim, expires_at: now + 30_001 }),
    /control_plane_issuer_nonce_invalid/,
  );
  assert.equal(pool.issuerNonces.size, 2);
  const cleanupCalls = pool.calls.filter(({ sql }) =>
    sql.includes("DELETE FROM mcp_staging_gate.issuer_nonce_claims AS claimed"));
  const firstCleanupIndex = pool.calls.findIndex(({ sql }) =>
    sql.includes("DELETE FROM mcp_staging_gate.issuer_nonce_claims AS claimed"));
  const firstInsertIndex = pool.calls.findIndex(({ sql }) =>
    sql.includes("INSERT INTO mcp_staging_gate.issuer_nonce_claims"));
  assert.equal(cleanupCalls.length, 3);
  assert(cleanupCalls.every(({ sql, values }) =>
    sql.includes("expires_at <= NOW()") && sql.includes("LIMIT $1") && values[0] === 256));
  assert(firstCleanupIndex >= 0 && firstCleanupIndex < firstInsertIndex);
  await plane.close();
});

test("cleans only a bounded database-time batch of expired issuer nonces before each insert", async () => {
  const pool = new RecordingPool();
  const { plane } = await controlPlane({ pool });
  const now = Date.now();
  for (let index = 0; index < 300; index += 1) {
    pool.issuerNonces.set(`expired:${String(index).padStart(3, "0")}`, now - 1_000 - index);
  }
  pool.issuerNonces.set("future:retained", now + 60_000);

  assert.equal(await plane.issuerReplayStore.claim({
    mode: "core", nonce: "x".repeat(32), now_ms: now, expires_at: now + 20_000,
  }), true);
  assert.equal(pool.nonceCleanupBatchSizes.at(-1), 256);
  assert.equal([...pool.issuerNonces.values()].filter((expiresAt) => expiresAt <= now).length, 44);
  assert.equal(pool.issuerNonces.has("future:retained"), true);

  assert.equal(await plane.issuerReplayStore.claim({
    mode: "nyra", nonce: "y".repeat(32), now_ms: now, expires_at: now + 20_000,
  }), true);
  assert.equal(pool.nonceCleanupBatchSizes.at(-1), 44);
  assert.equal([...pool.issuerNonces.values()].filter((expiresAt) => expiresAt <= now).length, 0);
  await plane.close();
});

test("verifies and consumes one receipt atomically, with deterministic exact replay", async () => {
  const pool = new RecordingPool();
  const { plane } = await controlPlane({ pool });
  const first = await plane.verifyAndConsumeReceipt({ envelope: { opaque: true }, consumption: consumption() });
  const replay = await plane.verifyAndConsumeReceipt({ envelope: { opaque: true }, consumption: consumption() });

  assert.deepEqual({ ...first, evidence_digest: undefined, idempotency_key: undefined }, {
    ok: true,
    status: "consumed",
    idempotent: false,
    receipt_id: "mcpstg_receipt_0123456789abcdef",
    evidence_digest: undefined,
    execution_id: "skinharmony-core-mcp-staging-render-create-v1",
    idempotency_key: undefined,
    secrets_exposed: false,
  });
  assert.match(first.evidence_digest, /^[a-f0-9]{64}$/);
  assert.match(first.idempotency_key, /^mcpstg-consume-[a-f0-9]{64}$/);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.idempotency_key, first.idempotency_key);
  assert.equal(pool.consumptionInserts, 1);
  assert.equal(pool.transactions, 3);

  const lockIndex = pool.calls.findIndex(({ sql }) => sql.includes("AS currently_valid"));
  const insertIndex = pool.calls.findIndex(({ sql }) => sql.includes("INSERT INTO mcp_staging_gate.receipt_consumptions"));
  const updateIndex = pool.calls.findIndex(({ sql }) => sql.includes("UPDATE mcp_staging_gate.credential_receipts"));
  assert(lockIndex >= 0 && lockIndex < insertIndex && insertIndex < updateIndex);
  assert(pool.calls.filter(({ sql }) => sql.startsWith("BEGIN ISOLATION LEVEL SERIALIZABLE")).length === 3);
  assert.equal(JSON.stringify([first, replay]).includes(PASSWORD_MARKER), false);
});

test("an exact already-consumed replay stays idempotent after database-time expiry", async () => {
  const pool = new RecordingPool();
  let temporallyCurrent = true;
  const evidence = verifiedEvidence();
  const { plane } = await controlPlane({ pool, verifier: async (input) => ({
    receipt_evidence: evidence,
    consumption: input.consumption,
    temporally_current: temporallyCurrent,
  }) });
  const first = await plane.verifyAndConsumeReceipt({ envelope: { opaque: true }, consumption: consumption() });
  pool.currentlyValid = false;
  temporallyCurrent = false;
  const replay = await plane.verifyAndConsumeReceipt({ envelope: { opaque: true }, consumption: consumption() });
  assert.equal(first.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.idempotency_key, first.idempotency_key);
  assert.equal(pool.consumptionInserts, 1);
});

test("non-current signed evidence cannot perform a first consumption", async () => {
  const pool = new RecordingPool();
  const { plane } = await controlPlane({ pool, verifier: async (input) => ({
    receipt_evidence: verifiedEvidence(),
    consumption: input.consumption,
    temporally_current: false,
  }) });
  await assert.rejects(
    plane.verifyAndConsumeReceipt({ envelope: { opaque: true }, consumption: consumption() }),
    (error) => error.code === "control_plane_receipt_not_consumable",
  );
  assert.equal(pool.consumptionInserts, 0);
});

test("rejects generic database URLs and unsafe provider identity before use, then scrubs all values", async (t) => {
  const cases = [
    ["generic URL", { DATABASE_URL: "postgresql://operator:do-not-echo@example.invalid/private" },
      "control_plane_database_url_forbidden"],
    ["production environment", { MCP_STAGING_CONTROL_PLANE_ENVIRONMENT: "production" },
      "control_plane_provider_config_invalid"],
    ["default provider user", { MCP_STAGING_GATE_PG_USER: "postgres" },
      "control_plane_provider_config_invalid"],
    ["non-staging database", { MCP_STAGING_GATE_PG_DATABASE: "skinharmony" },
      "control_plane_provider_config_invalid"],
  ];
  for (const [name, overrides, expectedCode] of cases) {
    await t.test(name, async () => {
      const env = providerEnv(overrides);
      let factoryCalled = false;
      await assert.rejects(
        createMcpStagingPostgresControlPlaneFromEnv({
          env,
          poolFactory: async () => { factoryCalled = true; return new RecordingPool(); },
          consumptionEvidenceVerifier: async () => ({
            receipt_evidence: verifiedEvidence(), consumption: consumption(), temporally_current: true,
          }),
          targetCommit: TARGET_COMMIT,
        }),
        (error) => error instanceof McpStagingPostgresControlPlaneError && error.code === expectedCode &&
          !String(error).includes("do-not-echo"),
      );
      assert.equal(factoryCalled, false);
      if (name === "generic URL") {
        assert.deepEqual(env, { DATABASE_URL: overrides.DATABASE_URL });
      } else {
        assert.deepEqual(env, {});
      }
    });
  }
});

test("fails closed when the database identity is not the dedicated role", async () => {
  const pool = new RecordingPool({ identity: { current_user: "postgres" } });
  await assert.rejects(
    controlPlane({ pool }),
    (error) => error.code === "control_plane_database_identity_unsafe" && !String(error).includes(PASSWORD_MARKER),
  );
  assert.equal(pool.calls.at(-1).sql, "ROLLBACK");
  assert.equal(pool.ends, 1);
});

test("fails closed on every unsafe pre-existing catalog contract variant", async (t) => {
  for (const unsafeSchema of [
    "owner", "schema_acl", "extra_object", "unlogged", "rls", "forced_rls", "table_acl", "column_type",
    "column_nullability", "column_default", "constraint_expression", "constraint_validation",
  ]) {
    await t.test(unsafeSchema, async () => {
      const pool = new RecordingPool({ unsafeSchema });
      await assert.rejects(
        controlPlane({ pool }),
        (error) => error.code === "control_plane_schema_contract_unsafe",
      );
      assert.equal(pool.calls.at(-1).sql, "ROLLBACK");
      assert.equal(pool.ends, 1);
    });
  }
});

test("does not enter a database transaction when receipt verification fails", async () => {
  const marker = "verifier-secret-marker";
  const pool = new RecordingPool();
  const { plane } = await controlPlane({ pool, verifier: async () => { throw new Error(marker); } });
  await assert.rejects(
    plane.verifyAndConsumeReceipt({ envelope: { secret: marker }, consumption: consumption() }),
    (error) => error.code === "control_plane_consumption_evidence_verification_failed" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
  assert.equal(pool.transactions, 1);
  assert.equal(pool.receipt, null);
});

test("database and factory failures return only constant redacted errors", async () => {
  const marker = "postgresql://operator:plaintext-secret@example.invalid/private";
  const env = providerEnv();
  await assert.rejects(
    createMcpStagingPostgresControlPlaneFromEnv({
      env,
      poolFactory: async () => { throw new Error(marker); },
      consumptionEvidenceVerifier: async () => ({
        receipt_evidence: verifiedEvidence(), consumption: consumption(), temporally_current: true,
      }),
      targetCommit: TARGET_COMMIT,
    }),
    (error) => error.code === "control_plane_database_unavailable" && !String(error).includes(marker),
  );
  assert.deepEqual(env, {});

  const hostileEnv = providerEnv();
  await assert.rejects(
    createMcpStagingPostgresControlPlaneFromEnv({
      env: hostileEnv,
      poolFactory: async () => { throw new McpStagingPostgresControlPlaneError(marker); },
      consumptionEvidenceVerifier: async () => ({
        receipt_evidence: verifiedEvidence(), consumption: consumption(), temporally_current: true,
      }),
      targetCommit: TARGET_COMMIT,
    }),
    (error) => error.code === "control_plane_database_unavailable" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
  assert.deepEqual(hostileEnv, {});

  const pool = new RecordingPool({ connectError: new Error(marker) });
  await assert.rejects(
    controlPlane({ pool }),
    (error) => error.code === "control_plane_database_unavailable" && !String(error).includes(marker),
  );
  assert.equal(pool.ends, 1);
});

test("a receipt absent under the database-time validity predicate cannot be consumed", async () => {
  const pool = new RecordingPool({ lockReceipt: false });
  const { plane } = await controlPlane({ pool });
  await assert.rejects(
    plane.verifyAndConsumeReceipt({ envelope: {}, consumption: consumption() }),
    (error) => error.code === "control_plane_receipt_not_consumable",
  );
  assert.equal(pool.calls.at(-1).sql, "ROLLBACK");
  assert.equal(pool.consumptionInserts, 0);
});

test("collaboration profile keeps durable nonce replay and disables the legacy receipt consumer fail-closed", async () => {
  const pool = new RecordingPool();
  const env = providerEnv();
  const plane = await createMcpStagingPostgresControlPlaneFromEnv({
    env,
    poolFactory: async () => pool,
    targetCommit: TARGET_COMMIT,
    profile: "collaboration",
  });
  assert.equal(plane.profile, "collaboration");
  assert.equal(plane.issuerReplayStore.durable, true);
  const now = Date.now();
  assert.equal(await plane.issuerReplayStore.claim({
    mode: "core",
    nonce: "q".repeat(32),
    now_ms: now,
    expires_at: now + 20_000,
  }), true);
  const transactionsBeforeReceipt = pool.transactions;
  await assert.rejects(
    plane.verifyAndConsumeReceipt({ envelope: { legacy: true }, consumption: consumption() }),
    (error) => error instanceof McpStagingPostgresControlPlaneError &&
      error.code === "control_plane_receipt_consumer_unavailable",
  );
  assert.equal(pool.transactions, transactionsBeforeReceipt);
  assert.equal(pool.receipt, null);
  assert.deepEqual(env, {});
  await plane.close();
});

test("collaboration profile rejects legacy authority injection and requires capability commit binding", async () => {
  const injectedEnv = providerEnv();
  let injectedFactoryCalled = false;
  await assert.rejects(
    createMcpStagingPostgresControlPlaneFromEnv({
      env: injectedEnv,
      poolFactory: async () => {
        injectedFactoryCalled = true;
        return new RecordingPool();
      },
      consumptionEvidenceVerifier: async () => {
        throw new Error("legacy_authority_must_not_run");
      },
      targetCommit: TARGET_COMMIT,
      profile: "collaboration",
    }),
    /control_plane_dependencies_invalid/,
  );
  assert.equal(injectedFactoryCalled, false);
  assert.deepEqual(injectedEnv, {});

  await assert.rejects(
    createMcpStagingPostgresControlPlaneFromBootstrap({
      capability: {
        expectedDatabaseName: DATABASE,
        role: ROLE,
        schema: "mcp_staging_gate",
        profile: "collaboration",
        targetCommit: "f".repeat(40),
        takeConnectionString: () =>
          `postgresql://${ROLE}:${PASSWORD_MARKER}@internal-staging-db.invalid/${DATABASE}`,
      },
      poolFactory: async () => new RecordingPool(),
      targetCommit: TARGET_COMMIT,
      profile: "collaboration",
    }),
    /control_plane_bootstrap_capability_invalid/,
  );
});
