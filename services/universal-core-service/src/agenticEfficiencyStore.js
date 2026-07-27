import crypto from "node:crypto";
import { createRequire } from "node:module";

import {
  AGENTIC_WORK_CAPSULE_SCHEMA_VERSION,
  checkAgenticArtifactReuse,
  createWorkCapsuleEnvelope,
  verifyWorkCapsuleEnvelope,
} from "./agenticEfficiencyRuntime.js";

export const AGENTIC_EFFICIENCY_DATABASE_SCHEMA = "agentic_governance";
export const AGENTIC_EFFICIENCY_MIGRATION_VERSION = "0.16.0-agentic-efficiency-v1";
const require = createRequire(import.meta.url);

function requireText(value, field, max = 500) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || normalized.includes("\u0000")) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function requireIdentifier(value, field) {
  const normalized = requireText(value, field, 63);
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function requireDigest(value, field) {
  const normalized = requireText(value, field, 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function publicCapsule(row) {
  if (!row) return null;
  return {
    capsule_id: row.capsule_id,
    tenant_id: row.tenant_id,
    version: Number(row.version),
    capsule_hash: row.capsule_hash,
    capsule: typeof row.capsule === "string" ? JSON.parse(row.capsule) : row.capsule,
    actor_provenance: row.actor_provenance,
    receipt_digest: row.receipt_digest,
    lease_owner: row.lease_owner || null,
    lease_expires_at: row.lease_expires_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicArtifact(row) {
  if (!row) return null;
  return {
    tenant_id: row.tenant_id,
    artifact_hash: row.artifact_hash,
    artifact_version: row.artifact_version,
    provenance_digest: row.provenance_digest,
    verified: row.verified === true,
    security_checks_verified: row.security_checks_verified === true,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

function migrationStatements(schema) {
  const s = requireIdentifier(schema, "agentic_database_schema");
  return [
    `CREATE SCHEMA IF NOT EXISTS ${s}`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_schema_migration_audit (
      migration_version TEXT NOT NULL,
      state TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL,
      actor_provenance TEXT NOT NULL,
      rollback_reference TEXT NOT NULL,
      PRIMARY KEY (migration_version, state, applied_at)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_run_budget (
      tenant_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      budget JSONB NOT NULL,
      policy_expires_at TIMESTAMPTZ NOT NULL,
      actor_provenance TEXT NOT NULL,
      receipt_digest TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, run_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_usage_ledger (
      ledger_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      usage_kind TEXT NOT NULL CHECK (usage_kind IN ('actual','estimated')),
      usage JSONB NOT NULL,
      usage_source TEXT NOT NULL,
      rate_card_version TEXT NOT NULL,
      receipt_digest TEXT,
      actor_provenance TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS agentic_usage_ledger_tenant_run_idx
      ON ${s}.agentic_usage_ledger (tenant_id, run_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_work_capsule (
      capsule_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      capsule_hash TEXT NOT NULL,
      capsule JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      actor_provenance TEXT NOT NULL,
      receipt_digest TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, capsule_id)
    )`,
    `ALTER TABLE ${s}.agentic_work_capsule
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `UPDATE ${s}.agentic_work_capsule
      SET expires_at=(capsule->>'expires_at')::timestamptz
      WHERE expires_at IS NULL`,
    `ALTER TABLE ${s}.agentic_work_capsule
      ALTER COLUMN expires_at SET NOT NULL`,
    `CREATE INDEX IF NOT EXISTS agentic_work_capsule_expiry_idx
      ON ${s}.agentic_work_capsule (tenant_id, expires_at)`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_artifact_reuse (
      tenant_id TEXT NOT NULL,
      artifact_hash TEXT NOT NULL,
      artifact_version TEXT NOT NULL,
      provenance_digest TEXT NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      security_checks_verified BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      actor_provenance TEXT NOT NULL,
      receipt_digest TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, artifact_hash, artifact_version)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_efficiency_baseline (
      tenant_id TEXT NOT NULL,
      baseline_id TEXT NOT NULL,
      repository_snapshot TEXT NOT NULL,
      rubric_digest TEXT NOT NULL,
      metrics JSONB NOT NULL,
      usage_kind TEXT NOT NULL CHECK (usage_kind IN ('actual','estimated')),
      actor_provenance TEXT NOT NULL,
      receipt_digest TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, baseline_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_efficiency_comparison (
      tenant_id TEXT NOT NULL,
      comparison_id TEXT NOT NULL,
      baseline_id TEXT NOT NULL,
      optimized_run_id TEXT NOT NULL,
      metrics JSONB NOT NULL,
      usage_kind TEXT NOT NULL CHECK (usage_kind IN ('actual','estimated')),
      quality_floor_preserved BOOLEAN NOT NULL,
      safety_preserved BOOLEAN NOT NULL,
      actor_provenance TEXT NOT NULL,
      receipt_digest TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, comparison_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_savings_claim (
      tenant_id TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      comparison_id TEXT NOT NULL,
      claim_kind TEXT NOT NULL CHECK (claim_kind IN ('actual','estimated')),
      reconciled BOOLEAN NOT NULL DEFAULT FALSE,
      amount JSONB NOT NULL,
      quality_delta JSONB NOT NULL,
      actor_provenance TEXT NOT NULL,
      receipt_digest TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, claim_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ${s}.agentic_rate_card_snapshot (
      tenant_id TEXT NOT NULL,
      rate_card_version TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      rates JSONB NOT NULL,
      source_reference TEXT NOT NULL,
      provenance_digest TEXT NOT NULL,
      effective_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      actor_provenance TEXT NOT NULL,
      receipt_digest TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, rate_card_version)
    )`,
  ];
}

export function agenticEfficiencyMigrationPlan({
  schema = AGENTIC_EFFICIENCY_DATABASE_SCHEMA,
} = {}) {
  return Object.freeze({
    migration_version: AGENTIC_EFFICIENCY_MIGRATION_VERSION,
    schema: requireIdentifier(schema, "agentic_database_schema"),
    additive: true,
    rollback_safe: true,
    preserves_audit: true,
    creates_database: false,
    creates_service: false,
    statements: Object.freeze(migrationStatements(schema)),
    rollback_strategy: "record_disabled_state_and_retain_all_agentic_tables_for_audit_and_resume",
  });
}

async function useClient(database, callback) {
  if (typeof database.connect !== "function") return callback(database);
  const client = await database.connect();
  try {
    return await callback(client);
  } finally {
    client.release?.();
  }
}

export function createAgenticEfficiencyPostgresStore({
  connectionString,
  pool = null,
  schema = AGENTIC_EFFICIENCY_DATABASE_SCHEMA,
  now = () => new Date(),
  runtimeRole = null,
  roleSeparationAttested = false,
} = {}) {
  const databaseUrl = requireText(connectionString, "governed_agent_database_url", 4_000);
  const databaseSchema = requireIdentifier(schema, "agentic_database_schema");
  const databaseRuntimeRole = runtimeRole === null || runtimeRole === undefined || runtimeRole === ""
    ? null
    : requireIdentifier(runtimeRole, "agentic_runtime_role");
  const runtimeRoleReady = databaseRuntimeRole !== null && roleSeparationAttested === true;
  const database = pool || (() => {
    const { Pool } = require("pg");
    return new Pool({
      connectionString: databaseUrl,
      max: 4,
      idleTimeoutMillis: 10_000,
      application_name: "nyra-agentic-efficiency-v016",
    });
  })();
  let initialized = false;

  async function initialize({
    actor_provenance = "universal-core:migration",
    rollback_reference = "git:pre-v0.16",
  } = {}) {
    if (initialized) return { initialized: true, reused: true };
    const actor = requireText(actor_provenance, "actor_provenance", 160);
    const rollback = requireText(rollback_reference, "rollback_reference", 500);
    const timestamp = now().toISOString();
    await useClient(database, async (client) => {
      await client.query("BEGIN");
      try {
        for (const statement of migrationStatements(databaseSchema)) await client.query(statement);
        await client.query(
          `INSERT INTO ${databaseSchema}.agentic_schema_migration_audit
            (migration_version,state,applied_at,actor_provenance,rollback_reference)
           VALUES ($1,'active',$2,$3,$4)`,
          [AGENTIC_EFFICIENCY_MIGRATION_VERSION, timestamp, actor, rollback],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
    initialized = true;
    return { initialized: true, reused: false, migration_version: AGENTIC_EFFICIENCY_MIGRATION_VERSION };
  }

  async function ready() {
    if (!initialized) await initialize();
  }

  async function asRuntimeRole(callback) {
    await ready();
    if (!runtimeRoleReady) throw new Error("agentic_runtime_role_separation_required");
    return useClient(database, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${databaseRuntimeRole}`);
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async function runtimeQuery(query, params = []) {
    return asRuntimeRole((client) => client.query(query, params));
  }

  async function rollbackMigration({
    actor_provenance,
    rollback_reference,
  } = {}) {
    await ready();
    const actor = requireText(actor_provenance, "actor_provenance", 160);
    const rollback = requireText(rollback_reference, "rollback_reference", 500);
    await database.query(
      `INSERT INTO ${databaseSchema}.agentic_schema_migration_audit
        (migration_version,state,applied_at,actor_provenance,rollback_reference)
       VALUES ($1,'disabled',$2,$3,$4)`,
      [AGENTIC_EFFICIENCY_MIGRATION_VERSION, now().toISOString(), actor, rollback],
    );
    return {
      rolled_back: true,
      data_dropped: false,
      audit_preserved: true,
      strategy: "feature_disabled_schema_retained",
    };
  }

  async function saveWorkCapsule({
    tenant_id,
    capsule_id,
    capsule,
    expected_version = 0,
    actor_provenance,
    receipt_digest,
  } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const capsuleId = requireText(capsule_id, "capsule_id", 160);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(capsuleId)) throw new Error("capsule_id_invalid");
    const actor = requireText(actor_provenance, "actor_provenance", 160);
    const receipt = requireDigest(receipt_digest, "receipt_digest");
    const expected = Number(expected_version);
    if (!Number.isSafeInteger(expected) || expected < 0) throw new Error("expected_version_invalid");
    const envelope = createWorkCapsuleEnvelope({
      tenantId,
      actorId: actor,
      capsule,
      version: expected + 1,
      now: now(),
    });
    const timestamp = now().toISOString();
    const result = expected === 0
      ? await runtimeQuery(
        `INSERT INTO ${databaseSchema}.agentic_work_capsule
          (capsule_id,tenant_id,version,capsule_hash,capsule,expires_at,actor_provenance,receipt_digest,created_at,updated_at)
         VALUES ($1,$2,1,$3,$4::jsonb,$5,$6,$7,$8,$8)
         ON CONFLICT (tenant_id,capsule_id) DO NOTHING
         RETURNING *`,
        [
          capsuleId,
          tenantId,
          envelope.capsule_hash,
          JSON.stringify(envelope.capsule),
          envelope.capsule.expires_at,
          actor,
          receipt,
          timestamp,
        ],
      )
      : await runtimeQuery(
        `UPDATE ${databaseSchema}.agentic_work_capsule SET
           version=version+1,
           capsule_hash=$3,
           capsule=$4::jsonb,
           expires_at=$5,
           actor_provenance=$6,
           receipt_digest=$7,
           updated_at=$8
         WHERE tenant_id=$1 AND capsule_id=$2 AND version=$9
         RETURNING *`,
        [
          tenantId,
          capsuleId,
          envelope.capsule_hash,
          JSON.stringify(envelope.capsule),
          envelope.capsule.expires_at,
          actor,
          receipt,
          timestamp,
          expected,
        ],
      );
    if (!result.rows[0]) throw new Error("work_capsule_revision_conflict");
    return publicCapsule(result.rows[0]);
  }

  async function getWorkCapsule({ tenant_id, capsule_id } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const capsuleId = requireText(capsule_id, "capsule_id", 160);
    const result = await runtimeQuery(
      `SELECT * FROM ${databaseSchema}.agentic_work_capsule
       WHERE tenant_id=$1 AND capsule_id=$2`,
      [tenantId, capsuleId],
    );
    const record = publicCapsule(result.rows[0]);
    if (!record) return null;
    verifyWorkCapsuleEnvelope({
      schema_version: AGENTIC_WORK_CAPSULE_SCHEMA_VERSION,
      tenant_id: tenantId,
      capsule_version: record.version,
      capsule_hash: record.capsule_hash,
      actor_provenance: record.actor_provenance,
      capsule: record.capsule,
    }, { tenantId, now: now() });
    return record;
  }

  async function claimWork({
    tenant_id,
    capsule_id,
    claimant_id,
    lease_ms = 60_000,
  } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const capsuleId = requireText(capsule_id, "capsule_id", 160);
    const claimant = requireText(claimant_id, "claimant_id", 160);
    const lease = Number(lease_ms);
    if (!Number.isSafeInteger(lease) || lease < 1_000 || lease > 15 * 60_000) {
      throw new Error("claim_lease_invalid");
    }
    const expires = new Date(now().getTime() + lease).toISOString();
    const result = await runtimeQuery(
      `UPDATE ${databaseSchema}.agentic_work_capsule SET
         lease_owner=$3,lease_expires_at=$4,updated_at=$5
       WHERE tenant_id=$1 AND capsule_id=$2
         AND (lease_owner IS NULL OR lease_expires_at<=$5 OR lease_owner=$3)
       RETURNING *`,
      [tenantId, capsuleId, claimant, expires, now().toISOString()],
    );
    if (!result.rows[0]) throw new Error("duplicate_execution_blocked");
    return publicCapsule(result.rows[0]);
  }

  async function releaseClaim({ tenant_id, capsule_id, claimant_id } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const capsuleId = requireText(capsule_id, "capsule_id", 160);
    const claimant = requireText(claimant_id, "claimant_id", 160);
    const result = await runtimeQuery(
      `UPDATE ${databaseSchema}.agentic_work_capsule SET
         lease_owner=NULL,lease_expires_at=NULL,updated_at=$4
       WHERE tenant_id=$1 AND capsule_id=$2 AND lease_owner=$3
       RETURNING capsule_id`,
      [tenantId, capsuleId, claimant, now().toISOString()],
    );
    return { released: Boolean(result.rows[0]) };
  }

  async function registerArtifact({
    tenant_id,
    artifact_hash,
    artifact_version,
    provenance_digest,
    verified,
    security_checks_verified,
    expires_at,
    actor_provenance,
    receipt_digest,
  } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const artifactHash = requireDigest(artifact_hash, "artifact_hash");
    const artifactVersion = requireText(artifact_version, "artifact_version", 160);
    const provenance = requireDigest(provenance_digest, "provenance_digest");
    const expiry = new Date(expires_at);
    if (!Number.isFinite(expiry.getTime()) || expiry <= now()) throw new Error("artifact_expiry_invalid");
    const actor = requireText(actor_provenance, "actor_provenance", 160);
    const receipt = requireDigest(receipt_digest, "receipt_digest");
    const result = await runtimeQuery(
      `INSERT INTO ${databaseSchema}.agentic_artifact_reuse
        (tenant_id,artifact_hash,artifact_version,provenance_digest,verified,security_checks_verified,expires_at,actor_provenance,receipt_digest,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id,artifact_hash,artifact_version) DO UPDATE SET
         provenance_digest=EXCLUDED.provenance_digest,
         verified=EXCLUDED.verified,
         security_checks_verified=EXCLUDED.security_checks_verified,
         expires_at=EXCLUDED.expires_at,
         actor_provenance=EXCLUDED.actor_provenance,
         receipt_digest=EXCLUDED.receipt_digest
       RETURNING *`,
      [
        tenantId,
        artifactHash,
        artifactVersion,
        provenance,
        verified === true,
        security_checks_verified === true,
        expiry.toISOString(),
        actor,
        receipt,
        now().toISOString(),
      ],
    );
    return publicArtifact(result.rows[0]);
  }

  async function checkArtifactReuse({
    tenant_id,
    artifact_hash,
    artifact_version,
  } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const artifactHash = requireDigest(artifact_hash, "artifact_hash");
    const artifactVersion = requireText(artifact_version, "artifact_version", 160);
    const result = await runtimeQuery(
      `SELECT * FROM ${databaseSchema}.agentic_artifact_reuse
       WHERE tenant_id=$1 AND artifact_hash=$2 AND artifact_version=$3`,
      [tenantId, artifactHash, artifactVersion],
    );
    if (!result.rows[0]) return { reusable: false, reasons: ["artifact_not_found"] };
    return checkAgenticArtifactReuse({
      trustedTenantId: tenantId,
      requestedHash: artifactHash,
      requestedVersion: artifactVersion,
      candidate: publicArtifact(result.rows[0]),
      now: now(),
    });
  }

  async function recordUsage({
    tenant_id,
    run_id,
    usage,
    actor_provenance,
  } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const runId = requireText(run_id, "run_id", 160);
    const actor = requireText(actor_provenance, "actor_provenance", 160);
    if (!usage || !["actual", "estimated"].includes(usage.usage_kind)) throw new Error("normalized_usage_invalid");
    if (usage.usage_kind === "actual" && usage.reconciled !== true) throw new Error("actual_usage_not_reconciled");
    const receipt = usage.usage_kind === "actual"
      ? requireDigest(usage.provider_receipt_digest, "provider_receipt_digest")
      : null;
    const ledgerId = `aul_${crypto.randomUUID()}`;
    const result = await runtimeQuery(
      `INSERT INTO ${databaseSchema}.agentic_usage_ledger
        (ledger_id,tenant_id,run_id,usage_kind,usage,usage_source,rate_card_version,receipt_digest,actor_provenance,created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
       RETURNING ledger_id,tenant_id,run_id,usage_kind,usage_source,rate_card_version,created_at`,
      [
        ledgerId,
        tenantId,
        runId,
        usage.usage_kind,
        JSON.stringify(usage),
        requireText(usage.usage_source, "usage_source", 160),
        requireText(usage.rate_card_version, "rate_card_version", 160),
        receipt,
        actor,
        now().toISOString(),
      ],
    );
    return clone(result.rows[0]);
  }

  async function status({ tenant_id } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const [capsules, leases, artifacts, usage] = await Promise.all([
      runtimeQuery(
        `SELECT count(*)::int AS count FROM ${databaseSchema}.agentic_work_capsule WHERE tenant_id=$1`,
        [tenantId],
      ),
      runtimeQuery(
        `SELECT count(*)::int AS count FROM ${databaseSchema}.agentic_work_capsule
         WHERE tenant_id=$1 AND lease_owner IS NOT NULL AND lease_expires_at>=$2`,
        [tenantId, now().toISOString()],
      ),
      runtimeQuery(
        `SELECT count(*)::int AS count FROM ${databaseSchema}.agentic_artifact_reuse
         WHERE tenant_id=$1 AND verified=TRUE AND expires_at>$2`,
        [tenantId, now().toISOString()],
      ),
      runtimeQuery(
        `SELECT usage_kind,count(*)::int AS count FROM ${databaseSchema}.agentic_usage_ledger
         WHERE tenant_id=$1 GROUP BY usage_kind`,
        [tenantId],
      ),
    ]);
    return {
      tenant_id: tenantId,
      work_capsules: Number(capsules.rows[0]?.count || 0),
      active_claims: Number(leases.rows[0]?.count || 0),
      reusable_artifacts: Number(artifacts.rows[0]?.count || 0),
      usage_by_kind: Object.fromEntries(usage.rows.map((row) => [row.usage_kind, Number(row.count)])),
      runtime_role_separation_attested: runtimeRoleReady,
      execution_authorized: false,
    };
  }

  async function report({ tenant_id } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const result = await runtimeQuery(
      `SELECT
         count(*)::int AS comparison_count,
         count(*) FILTER (WHERE usage_kind='actual')::int AS actual_count,
         count(*) FILTER (WHERE quality_floor_preserved=TRUE AND safety_preserved=TRUE)::int AS safe_count
       FROM ${databaseSchema}.agentic_efficiency_comparison
       WHERE tenant_id=$1`,
      [tenantId],
    );
    return {
      tenant_id: tenantId,
      comparisons: Number(result.rows[0]?.comparison_count || 0),
      actual_comparisons: Number(result.rows[0]?.actual_count || 0),
      safe_comparisons: Number(result.rows[0]?.safe_count || 0),
      actual_savings_claimed: false,
      execution_authorized: false,
    };
  }

  async function close() {
    if (!pool) await database.end();
  }

  return Object.freeze({
    roleSeparationStatus: () => Object.freeze({
      attested: runtimeRoleReady,
      runtime_role_configured: databaseRuntimeRole !== null,
      writes_allowed: runtimeRoleReady,
    }),
    initialize,
    rollbackMigration,
    saveWorkCapsule,
    getWorkCapsule,
    claimWork,
    releaseClaim,
    registerArtifact,
    checkArtifactReuse,
    recordUsage,
    status,
    report,
    close,
  });
}
