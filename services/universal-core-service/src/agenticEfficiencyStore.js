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
export const AGENTIC_EFFICIENCY_RUNTIME_ROLE = "nyra_agentic_runtime_v016";
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
    runtime_ddl: false,
    migration_artifact: "migrations/0.16.0-agentic-efficiency.up.sql",
    rollback_artifact: "migrations/0.16.0-agentic-efficiency.down.sql",
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
  // A caller-provided boolean is not an attestation. PostgreSQL must prove
  // SET LOCAL ROLE, a distinct session_user, and bounded table privileges.
  void roleSeparationAttested;
  let runtimeRoleState = {
    configured: databaseRuntimeRole !== null,
    attempted: false,
    attested: false,
    read_ready: false,
    write_ready: false,
    session_user_separated: false,
    reason: databaseRuntimeRole ? "runtime_role_not_yet_attested" : "runtime_role_not_configured",
  };
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

  async function attestRuntimeRole() {
    if (!databaseRuntimeRole) return runtimeRoleState;
    runtimeRoleState = { ...runtimeRoleState, attempted: true };
    try {
      const attestation = await useClient(database, async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(`SET LOCAL ROLE ${databaseRuntimeRole}`);
          const result = await client.query(
            `SELECT
               current_user::text AS current_user,
               session_user::text AS session_user,
               has_schema_privilege(current_user,$1,'USAGE') AS schema_usage,
               has_table_privilege(current_user,$2,'SELECT,INSERT,UPDATE') AS capsule_ready,
               has_table_privilege(current_user,$3,'SELECT,INSERT,UPDATE') AS artifact_ready,
               has_table_privilege(current_user,$4,'SELECT,INSERT') AS usage_ready,
               has_table_privilege(current_user,$5,'SELECT,INSERT') AS comparison_ready`,
            [
              databaseSchema,
              `${databaseSchema}.agentic_work_capsule`,
              `${databaseSchema}.agentic_artifact_reuse`,
              `${databaseSchema}.agentic_usage_ledger`,
              `${databaseSchema}.agentic_efficiency_comparison`,
            ],
          );
          await client.query("ROLLBACK");
          return result.rows[0] || {};
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });
      const sessionSeparated = Boolean(attestation.session_user)
        && attestation.session_user !== databaseRuntimeRole;
      const readReady = attestation.current_user === databaseRuntimeRole
        && sessionSeparated
        && attestation.schema_usage === true
        && attestation.capsule_ready === true
        && attestation.artifact_ready === true
        && attestation.usage_ready === true
        && attestation.comparison_ready === true;
      const writeReady = readReady;
      runtimeRoleState = {
        configured: true,
        attempted: true,
        attested: writeReady,
        read_ready: readReady,
        write_ready: writeReady,
        session_user_separated: sessionSeparated,
        reason: writeReady
          ? "verified_set_local_role_and_privileges"
          : "runtime_role_privilege_or_separation_probe_failed",
      };
    } catch {
      runtimeRoleState = {
        configured: true,
        attempted: true,
        attested: false,
        read_ready: false,
        write_ready: false,
        session_user_separated: false,
        reason: "runtime_role_attestation_query_failed",
      };
    }
    return runtimeRoleState;
  }

  async function initialize() {
    if (initialized) return { initialized: true, reused: true };
    const migration = await database.query(
      `SELECT state FROM ${databaseSchema}.agentic_schema_migration_audit
       WHERE migration_version=$1
       ORDER BY applied_at DESC
       LIMIT 1`,
      [AGENTIC_EFFICIENCY_MIGRATION_VERSION],
    );
    if (migration.rows[0]?.state !== "active") {
      throw new Error("agentic_static_migration_not_active");
    }
    const attestation = await attestRuntimeRole();
    if (!attestation.read_ready || !attestation.write_ready || !attestation.attested) {
      throw new Error("agentic_runtime_role_attestation_failed");
    }
    initialized = true;
    return {
      initialized: true,
      reused: false,
      migration_version: AGENTIC_EFFICIENCY_MIGRATION_VERSION,
      runtime_role: { ...runtimeRoleState },
    };
  }

  async function ready() {
    if (!initialized) await initialize();
  }

  async function asRuntimeRole(callback) {
    await ready();
    if (!runtimeRoleState.read_ready || !runtimeRoleState.write_ready) {
      throw new Error("agentic_runtime_role_separation_required");
    }
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

  async function getWorkCapsule({ tenant_id, capsule_id, allow_expired = false } = {}) {
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
    }, { tenantId, now: now(), allowExpired: allow_expired === true });
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
       ON CONFLICT (tenant_id,receipt_digest) WHERE receipt_digest IS NOT NULL DO NOTHING
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
    if (!result.rows[0]) throw new Error("agentic_provider_receipt_replayed");
    return clone(result.rows[0]);
  }

  async function recordComparison({
    tenant_id,
    comparison_id,
    baseline_id,
    optimized_run_id,
    comparison,
    actor_provenance,
    receipt_digest,
  } = {}) {
    await ready();
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const comparisonId = requireText(comparison_id, "comparison_id", 160);
    const baselineId = requireText(baseline_id, "baseline_id", 160);
    const optimizedRunId = requireText(optimized_run_id, "optimized_run_id", 160);
    const actor = requireText(actor_provenance, "actor_provenance", 160);
    const receipt = requireDigest(receipt_digest, "receipt_digest");
    if (!comparison || typeof comparison !== "object" || Array.isArray(comparison)) {
      throw new Error("agentic_comparison_invalid");
    }
    const usageKind = comparison.usage_kind === "actual" ? "actual" : "estimated";
    const result = await runtimeQuery(
      `INSERT INTO ${databaseSchema}.agentic_efficiency_comparison
        (tenant_id,comparison_id,baseline_id,optimized_run_id,metrics,usage_kind,quality_floor_preserved,safety_preserved,actor_provenance,receipt_digest,created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id,comparison_id) DO NOTHING
       RETURNING tenant_id,comparison_id,baseline_id,optimized_run_id,usage_kind,created_at`,
      [
        tenantId,
        comparisonId,
        baselineId,
        optimizedRunId,
        JSON.stringify(comparison),
        usageKind,
        comparison.quality?.within_floor === true,
        comparison.security_preserved === true,
        actor,
        receipt,
        now().toISOString(),
      ],
    );
    if (!result.rows[0]) throw new Error("agentic_comparison_replayed");
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
      runtime_role_separation_attested: runtimeRoleState.attested,
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
      attested: runtimeRoleState.attested,
      runtime_role_configured: databaseRuntimeRole !== null,
      probe_attempted: runtimeRoleState.attempted,
      session_user_separated: runtimeRoleState.session_user_separated,
      reads_allowed: runtimeRoleState.read_ready,
      writes_allowed: runtimeRoleState.write_ready,
      reason: runtimeRoleState.reason,
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
    recordComparison,
    status,
    report,
    close,
  });
}
