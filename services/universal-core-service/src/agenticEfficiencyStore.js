import crypto from "node:crypto";
import { createRequire } from "node:module";

import {
  AGENTIC_WORK_CAPSULE_SCHEMA_VERSION,
  assertAgenticContentSafe,
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

const FORBIDDEN_PERSISTED_KEYS = new Set([
  "authorization",
  "content",
  "credentials",
  "customer_data",
  "email",
  "messages",
  "password",
  "phone",
  "pii",
  "prompt",
  "raw_content",
  "raw_input",
  "raw_output",
  "raw_prompt",
  "secret",
  "token",
]);
const PERSISTED_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PERSISTED_PHONE_PATTERN = /(?:\+?\d[\d .()-]{7,}\d)/;
const PERSISTED_SECRET_PATTERN = /(?:\b(?:sk|gho|ghp|ghs|github_pat|akia)[-_a-z0-9]{12,}\b|\b(?:bearer)\s+[a-z0-9._~+/=-]{12,}\b)/i;
const PERSISTED_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PERSISTED_ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function assertSafePersistedJson(value, field, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (depth > 8 || budget.nodes > 2_000) throw new Error(`${field}_too_complex`);
  if (typeof value === "string") {
    if (PERSISTED_DIGEST_PATTERN.test(value) || PERSISTED_ISO_TIMESTAMP_PATTERN.test(value)) return;
    if (
      PERSISTED_EMAIL_PATTERN.test(value)
      || PERSISTED_PHONE_PATTERN.test(value)
      || PERSISTED_SECRET_PATTERN.test(value)
    ) {
      throw new Error(`${field}_sensitive_content_forbidden`);
    }
    return;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafePersistedJson(item, field, depth + 1, budget);
    return;
  }
  if (!value || typeof value !== "object") throw new Error(`${field}_invalid`);
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_PERSISTED_KEYS.has(String(key).trim().toLowerCase())) {
      throw new Error(`${field}_sensitive_field_forbidden`);
    }
    assertSafePersistedJson(item, field, depth + 1, budget);
  }
}

function requireJsonObject(value, field, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}_invalid`);
  }
  assertAgenticContentSafe(value, field);
  assertSafePersistedJson(value, field);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new Error(`${field}_unknown_field`);
  }
  return clone(value);
}

function requireFinite(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const number = Number(value);
  if (
    !Number.isFinite(number)
    || number < min
    || number > max
    || (integer && !Number.isSafeInteger(number))
  ) throw new Error(`${field}_invalid`);
  return number;
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") throw new Error(`${field}_invalid`);
  return value;
}

function requireSafeMetadataText(value, field, max = 160) {
  const normalized = requireText(value, field, max);
  assertSafePersistedJson(normalized, field);
  return normalized;
}

function requireRecordIdentifier(value, field, max = 160) {
  const normalized = requireText(value, field, max);
  const generatedUuid = /^[a-z][a-z0-9._:-]*[_:-][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized);
  if (
    !/^[a-z0-9][a-z0-9._:@/-]*$/i.test(normalized)
    || PERSISTED_EMAIL_PATTERN.test(normalized)
    || (/(?:^|[_:-])\+?\d[\d .()-]{7,}\d$/.test(normalized) && !generatedUuid)
    || PERSISTED_SECRET_PATTERN.test(normalized)
  ) throw new Error(`${field}_invalid`);
  return normalized;
}

function normalizeRunBudget(value) {
  const allowed = new Set([
    "override",
    "skip_security_tests",
    "remove_critical_reviewer",
    "model_escalation",
    "quality_baseline",
    "quality_prediction",
    "quality_floor",
    "security_checks_required",
    "usage_required",
    "token_limit",
    "invocation_limit",
    "retry_limit",
    "observed_invocations",
    "observed_retries",
    "critical_task",
    "hard_budget_stop",
    "expires_at",
    "verdict_mode",
    "optimization_allowed",
    "verdict_reasons",
    "execution_authorized",
  ]);
  const source = requireJsonObject(value, "agentic_run_budget", allowed);
  const normalized = {};
  const booleanFields = [
    "override",
    "skip_security_tests",
    "remove_critical_reviewer",
    "model_escalation",
    "security_checks_required",
    "usage_required",
    "critical_task",
    "hard_budget_stop",
    "optimization_allowed",
    "execution_authorized",
  ];
  const integerFields = [
    "token_limit",
    "invocation_limit",
    "retry_limit",
    "observed_invocations",
    "observed_retries",
  ];
  const qualityFields = ["quality_baseline", "quality_prediction", "quality_floor"];
  for (const field of booleanFields) {
    if (Object.hasOwn(source, field)) normalized[field] = requireBoolean(source[field], field);
  }
  for (const field of integerFields) {
    if (Object.hasOwn(source, field)) {
      normalized[field] = requireFinite(source[field], field, { integer: true, max: 1_000_000_000 });
    }
  }
  for (const field of qualityFields) {
    if (Object.hasOwn(source, field)) normalized[field] = requireFinite(source[field], field, { max: 1 });
  }
  if (Object.hasOwn(source, "verdict_mode")) {
    const mode = requireSafeMetadataText(source.verdict_mode, "verdict_mode", 32);
    if (!["off", "observe", "soft_enforce"].includes(mode)) throw new Error("verdict_mode_invalid");
    normalized.verdict_mode = mode;
  }
  if (Object.hasOwn(source, "expires_at")) {
    const expiresAt = new Date(source.expires_at);
    if (!Number.isFinite(expiresAt.getTime())) throw new Error("budget_expires_at_invalid");
    normalized.expires_at = expiresAt.toISOString();
  }
  if (Object.hasOwn(source, "verdict_reasons")) {
    if (!Array.isArray(source.verdict_reasons) || source.verdict_reasons.length > 50) {
      throw new Error("verdict_reasons_invalid");
    }
    normalized.verdict_reasons = source.verdict_reasons.map((reason) => {
      const code = requireSafeMetadataText(reason, "verdict_reason", 120);
      if (!/^[a-z0-9_.:-]+$/i.test(code)) throw new Error("verdict_reason_invalid");
      return code;
    });
  }
  if (normalized.execution_authorized === true) {
    throw new Error("agentic_budget_external_execution_forbidden");
  }
  return normalized;
}

const USAGE_FIELDS = new Set([
  "usage_kind",
  "reconciled",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "total_tokens",
  "amount",
  "currency",
  "formula",
  "rate_card_version",
  "rate_card_provenance",
  "rate_card_verified",
  "usage_source",
  "provider_receipt_digest",
]);

function normalizeUsagePayload(value, field = "agentic_usage") {
  const source = requireJsonObject(value, field, USAGE_FIELDS);
  const usageKind = source.usage_kind === "actual" ? "actual" : source.usage_kind === "estimated" ? "estimated" : "";
  if (!usageKind) throw new Error("normalized_usage_invalid");
  const normalized = {
    usage_kind: usageKind,
    reconciled: requireBoolean(source.reconciled, "usage_reconciled"),
    input_tokens: requireFinite(source.input_tokens, "usage_input_tokens", { integer: true, max: 1_000_000_000 }),
    cached_input_tokens: requireFinite(source.cached_input_tokens, "usage_cached_input_tokens", { integer: true, max: 1_000_000_000 }),
    output_tokens: requireFinite(source.output_tokens, "usage_output_tokens", { integer: true, max: 1_000_000_000 }),
    total_tokens: requireFinite(source.total_tokens, "usage_total_tokens", { integer: true, max: 2_000_000_000 }),
    amount: requireFinite(source.amount, "usage_amount", { max: 1_000_000_000 }),
    currency: requireSafeMetadataText(source.currency, "usage_currency", 16),
    formula: requireSafeMetadataText(source.formula, "usage_formula", 500),
    rate_card_version: requireSafeMetadataText(source.rate_card_version, "usage_rate_card_version", 160),
    rate_card_provenance: requireDigest(source.rate_card_provenance, "usage_rate_card_provenance"),
    rate_card_verified: requireBoolean(source.rate_card_verified, "usage_rate_card_verified"),
    usage_source: requireSafeMetadataText(source.usage_source, "usage_source", 160),
    provider_receipt_digest: source.provider_receipt_digest === null
      ? null
      : requireDigest(source.provider_receipt_digest, "provider_receipt_digest"),
  };
  if (normalized.cached_input_tokens > normalized.input_tokens) {
    throw new Error("cached_usage_exceeds_input");
  }
  if (normalized.total_tokens !== normalized.input_tokens + normalized.output_tokens) {
    throw new Error("usage_total_tokens_mismatch");
  }
  if (
    normalized.usage_kind === "estimated"
    && (normalized.reconciled || normalized.provider_receipt_digest !== null)
  ) {
    throw new Error("estimated_usage_reconciliation_forbidden");
  }
  if (
    normalized.usage_kind === "actual"
    && (!normalized.reconciled || normalized.provider_receipt_digest === null)
  ) {
    throw new Error("actual_usage_reconciliation_required");
  }
  return normalized;
}

const BASELINE_METRIC_FIELDS = new Set([
  "usage_kind",
  "quality",
  "task_success_rate",
  "sample_count",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "total_tokens",
  "agent_count",
  "new_invocations",
  "tool_call_count",
  "retry_count",
  "duplicate_work_count",
  "latency_ms",
  "amount",
  "currency",
  "actual_usage_reconciled",
  "provider_receipt_digest",
  "rate_card_version",
]);

function normalizeBaselineMetrics(value) {
  const source = requireJsonObject(value, "agentic_baseline_metrics", BASELINE_METRIC_FIELDS);
  const normalized = {};
  for (const [key, item] of Object.entries(source)) {
    if (["usage_kind", "currency", "rate_card_version"].includes(key)) {
      normalized[key] = requireSafeMetadataText(item, `baseline_${key}`, 160);
    } else if (key === "provider_receipt_digest") {
      normalized[key] = requireDigest(item, "baseline_provider_receipt_digest");
    } else if (key === "actual_usage_reconciled") {
      normalized[key] = requireBoolean(item, "baseline_actual_usage_reconciled");
    } else {
      normalized[key] = requireFinite(item, `baseline_${key}`, {
        max: ["quality", "task_success_rate"].includes(key) ? 1 : 2_000_000_000,
        integer: [
          "sample_count",
          "input_tokens",
          "cached_input_tokens",
          "output_tokens",
          "total_tokens",
          "agent_count",
          "new_invocations",
          "tool_call_count",
          "retry_count",
          "duplicate_work_count",
        ].includes(key),
      });
    }
  }
  if (normalized.usage_kind && !["actual", "estimated"].includes(normalized.usage_kind)) {
    throw new Error("agentic_baseline_usage_kind_invalid");
  }
  return normalized;
}

function normalizeRateCardRates(value) {
  const source = requireJsonObject(
    value,
    "agentic_rate_card_rates",
    new Set(["input_per_million", "cached_input_per_million", "output_per_million"]),
  );
  if (!Object.hasOwn(source, "input_per_million") || !Object.hasOwn(source, "output_per_million")) {
    throw new Error("agentic_rate_card_rates_incomplete");
  }
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [
    key,
    requireFinite(item, `agentic_rate_card_${key}`, { max: 1_000_000_000 }),
  ]));
}

function normalizeSavingsAmount(value) {
  const source = requireJsonObject(
    value,
    "agentic_savings_amount",
    new Set(["value", "currency"]),
  );
  return {
    value: requireFinite(source.value, "agentic_savings_value", { min: -1_000_000_000, max: 1_000_000_000 }),
    currency: requireSafeMetadataText(source.currency, "agentic_savings_currency", 16),
  };
}

function normalizeSavingsQualityDelta(value) {
  const source = requireJsonObject(
    value,
    "agentic_savings_quality_delta",
    new Set(["loss", "baseline", "optimized", "within_floor"]),
  );
  const normalized = {
    loss: requireFinite(source.loss, "agentic_savings_quality_loss", { max: 1 }),
  };
  for (const field of ["baseline", "optimized"]) {
    if (Object.hasOwn(source, field)) {
      normalized[field] = requireFinite(source[field], `agentic_savings_quality_${field}`, { max: 1 });
    }
  }
  if (Object.hasOwn(source, "within_floor")) {
    normalized.within_floor = requireBoolean(source.within_floor, "agentic_savings_quality_within_floor");
  }
  return normalized;
}

function normalizeComparisonPayload(value, tenantId) {
  const source = requireJsonObject(
    value,
    "agentic_comparison",
    new Set([
      "schema_version",
      "tenant_id",
      "usage_kind",
      "reconciled",
      "baseline",
      "optimized",
      "token_savings_ratio",
      "amount_savings",
      "quality",
      "security_preserved",
      "quality_safety_attestation_verified",
      "rate_card_verified",
      "actual_savings_claim_allowed",
      "label",
      "execution_authorized",
    ]),
  );
  if (source.tenant_id !== tenantId) throw new Error("agentic_comparison_cross_tenant");
  if (source.schema_version !== "agentic_savings_comparison_v1") {
    throw new Error("agentic_comparison_schema_invalid");
  }
  const usageKind = source.usage_kind === "actual" ? "actual" : source.usage_kind === "estimated" ? "estimated" : "";
  if (!usageKind) throw new Error("agentic_comparison_usage_kind_invalid");
  const quality = requireJsonObject(
    source.quality,
    "agentic_comparison_quality",
    new Set(["baseline", "optimized", "loss", "within_floor"]),
  );
  const normalized = {
    schema_version: source.schema_version,
    tenant_id: tenantId,
    usage_kind: usageKind,
    reconciled: requireBoolean(source.reconciled, "agentic_comparison_reconciled"),
    baseline: normalizeUsagePayload(source.baseline, "agentic_comparison_baseline"),
    optimized: normalizeUsagePayload(source.optimized, "agentic_comparison_optimized"),
    token_savings_ratio: requireFinite(
      source.token_savings_ratio,
      "agentic_comparison_token_savings_ratio",
      { min: -1, max: 1 },
    ),
    amount_savings: requireFinite(
      source.amount_savings,
      "agentic_comparison_amount_savings",
      { min: -1_000_000_000, max: 1_000_000_000 },
    ),
    quality: {
      baseline: requireFinite(quality.baseline, "agentic_comparison_quality_baseline", { max: 1 }),
      optimized: requireFinite(quality.optimized, "agentic_comparison_quality_optimized", { max: 1 }),
      loss: requireFinite(quality.loss, "agentic_comparison_quality_loss", { max: 1 }),
      within_floor: requireBoolean(quality.within_floor, "agentic_comparison_quality_within_floor"),
    },
    security_preserved: requireBoolean(source.security_preserved, "agentic_comparison_security_preserved"),
    quality_safety_attestation_verified: requireBoolean(
      source.quality_safety_attestation_verified,
      "agentic_comparison_quality_safety_attestation_verified",
    ),
    rate_card_verified: requireBoolean(source.rate_card_verified, "agentic_comparison_rate_card_verified"),
    actual_savings_claim_allowed: requireBoolean(
      source.actual_savings_claim_allowed,
      "agentic_comparison_actual_savings_claim_allowed",
    ),
    label: requireSafeMetadataText(source.label, "agentic_comparison_label", 120),
    execution_authorized: requireBoolean(
      source.execution_authorized,
      "agentic_comparison_execution_authorized",
    ),
  };
  if (normalized.execution_authorized) throw new Error("agentic_comparison_external_execution_forbidden");
  if (
    normalized.baseline.usage_kind !== usageKind
    || normalized.optimized.usage_kind !== usageKind
  ) {
    throw new Error("agentic_comparison_usage_binding_invalid");
  }
  return normalized;
}

function requireFutureTimestamp(value, field, now) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp <= now()) {
    throw new Error(`${field}_invalid`);
  }
  return timestamp.toISOString();
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
               has_table_privilege(current_user,$5,'SELECT,INSERT') AS comparison_ready,
               has_table_privilege(current_user,$6,'SELECT,INSERT,UPDATE') AS budget_ready,
               has_table_privilege(current_user,$7,'SELECT,INSERT') AS baseline_ready,
               has_table_privilege(current_user,$8,'SELECT,INSERT') AS savings_ready,
               has_table_privilege(current_user,$9,'SELECT,INSERT') AS rate_card_ready`,
            [
              databaseSchema,
              `${databaseSchema}.agentic_work_capsule`,
              `${databaseSchema}.agentic_artifact_reuse`,
              `${databaseSchema}.agentic_usage_ledger`,
              `${databaseSchema}.agentic_efficiency_comparison`,
              `${databaseSchema}.agentic_run_budget`,
              `${databaseSchema}.agentic_efficiency_baseline`,
              `${databaseSchema}.agentic_savings_claim`,
              `${databaseSchema}.agentic_rate_card_snapshot`,
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
        && attestation.comparison_ready === true
        && attestation.budget_ready === true
        && attestation.baseline_ready === true
        && attestation.savings_ready === true
        && attestation.rate_card_ready === true;
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
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
    const rollback = requireSafeMetadataText(rollback_reference, "rollback_reference", 500);
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
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const capsuleId = requireRecordIdentifier(capsule_id, "capsule_id", 160);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(capsuleId)) throw new Error("capsule_id_invalid");
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
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
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const capsuleId = requireRecordIdentifier(capsule_id, "capsule_id", 160);
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
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const capsuleId = requireRecordIdentifier(capsule_id, "capsule_id", 160);
    const claimant = requireRecordIdentifier(claimant_id, "claimant_id", 160);
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
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const capsuleId = requireRecordIdentifier(capsule_id, "capsule_id", 160);
    const claimant = requireRecordIdentifier(claimant_id, "claimant_id", 160);
    const result = await runtimeQuery(
      `UPDATE ${databaseSchema}.agentic_work_capsule SET
         lease_owner=NULL,lease_expires_at=NULL,updated_at=$4
       WHERE tenant_id=$1 AND capsule_id=$2 AND lease_owner=$3
       RETURNING capsule_id`,
      [tenantId, capsuleId, claimant, now().toISOString()],
    );
    return { released: Boolean(result.rows[0]) };
  }

  async function saveRunBudget({
    tenant_id,
    run_id,
    policy_version,
    budget,
    policy_expires_at,
    actor_provenance,
    receipt_digest,
  } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const runId = requireRecordIdentifier(run_id, "run_id", 160);
    const policyVersion = requireRecordIdentifier(policy_version, "policy_version", 160);
    const normalizedBudget = normalizeRunBudget(budget);
    const expiresAt = requireFutureTimestamp(policy_expires_at, "policy_expires_at", now);
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
    const receipt = requireDigest(receipt_digest, "receipt_digest");
    const timestamp = now().toISOString();
    const result = await runtimeQuery(
      `INSERT INTO ${databaseSchema}.agentic_run_budget
        (tenant_id,run_id,policy_version,budget,policy_expires_at,actor_provenance,receipt_digest,created_at,updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$8)
       ON CONFLICT (tenant_id,run_id) DO UPDATE SET
         policy_version=EXCLUDED.policy_version,
         budget=EXCLUDED.budget,
         policy_expires_at=EXCLUDED.policy_expires_at,
         actor_provenance=EXCLUDED.actor_provenance,
         receipt_digest=EXCLUDED.receipt_digest,
         updated_at=EXCLUDED.updated_at
       WHERE ${databaseSchema}.agentic_run_budget.receipt_digest=EXCLUDED.receipt_digest
       RETURNING tenant_id,run_id,policy_version,budget,policy_expires_at,actor_provenance,receipt_digest,created_at,updated_at`,
      [
        tenantId,
        runId,
        policyVersion,
        JSON.stringify(normalizedBudget),
        expiresAt,
        actor,
        receipt,
        timestamp,
      ],
    );
    if (!result.rows[0]) throw new Error("agentic_run_budget_conflict");
    return clone(result.rows[0]);
  }

  async function getRunBudget({ tenant_id, run_id } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const runId = requireRecordIdentifier(run_id, "run_id", 160);
    const result = await runtimeQuery(
      `SELECT tenant_id,run_id,policy_version,budget,policy_expires_at,actor_provenance,receipt_digest,created_at,updated_at
       FROM ${databaseSchema}.agentic_run_budget
       WHERE tenant_id=$1 AND run_id=$2`,
      [tenantId, runId],
    );
    return clone(result.rows[0] || null);
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
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const artifactHash = requireDigest(artifact_hash, "artifact_hash");
    const artifactVersion = requireRecordIdentifier(artifact_version, "artifact_version", 160);
    const provenance = requireDigest(provenance_digest, "provenance_digest");
    const expiry = new Date(expires_at);
    if (!Number.isFinite(expiry.getTime()) || expiry <= now()) throw new Error("artifact_expiry_invalid");
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
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
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const artifactHash = requireDigest(artifact_hash, "artifact_hash");
    const artifactVersion = requireRecordIdentifier(artifact_version, "artifact_version", 160);
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
    provider_usage_verified = false,
  } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const runId = requireRecordIdentifier(run_id, "run_id", 160);
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
    const normalizedUsage = normalizeUsagePayload(usage);
    if (
      normalizedUsage.usage_kind === "actual"
      && (normalizedUsage.reconciled !== true || provider_usage_verified !== true)
    ) throw new Error("actual_usage_not_reconciled");
    const receipt = normalizedUsage.usage_kind === "actual"
      ? requireDigest(normalizedUsage.provider_receipt_digest, "provider_receipt_digest")
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
        normalizedUsage.usage_kind,
        JSON.stringify(normalizedUsage),
        normalizedUsage.usage_source,
        normalizedUsage.rate_card_version,
        receipt,
        actor,
        now().toISOString(),
      ],
    );
    if (!result.rows[0]) throw new Error("agentic_provider_receipt_replayed");
    return clone(result.rows[0]);
  }

  async function recordBaseline({
    tenant_id,
    baseline_id,
    repository_snapshot,
    rubric_digest,
    metrics,
    usage_kind,
    actor_provenance,
    receipt_digest,
    provider_usage_verified = false,
  } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const baselineId = requireRecordIdentifier(baseline_id, "baseline_id", 160);
    const repositorySnapshot = requireDigest(repository_snapshot, "repository_snapshot");
    const rubricDigest = requireDigest(rubric_digest, "rubric_digest");
    const normalizedMetrics = normalizeBaselineMetrics(metrics);
    const usageKind = usage_kind === "actual" ? "actual" : usage_kind === "estimated" ? "estimated" : "";
    if (!usageKind) throw new Error("agentic_baseline_usage_kind_invalid");
    if (normalizedMetrics.usage_kind !== usageKind) {
      throw new Error("agentic_baseline_usage_kind_mismatch");
    }
    if (
      usageKind === "estimated"
      && (
        normalizedMetrics.actual_usage_reconciled === true
        || normalizedMetrics.provider_receipt_digest
      )
    ) {
      throw new Error("agentic_baseline_estimated_reconciliation_forbidden");
    }
    if (
      usageKind === "actual"
      && (
        provider_usage_verified !== true
        ||
        normalizedMetrics.actual_usage_reconciled !== true
        || !/^sha256:[a-f0-9]{64}$/.test(String(normalizedMetrics.provider_receipt_digest || ""))
      )
    ) {
      throw new Error("agentic_baseline_actual_usage_unverified");
    }
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
    const receipt = requireDigest(receipt_digest, "receipt_digest");
    const result = await runtimeQuery(
      `INSERT INTO ${databaseSchema}.agentic_efficiency_baseline
        (tenant_id,baseline_id,repository_snapshot,rubric_digest,metrics,usage_kind,actor_provenance,receipt_digest,created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
       ON CONFLICT (tenant_id,baseline_id) DO NOTHING
       RETURNING tenant_id,baseline_id,repository_snapshot,rubric_digest,metrics,usage_kind,actor_provenance,receipt_digest,created_at`,
      [
        tenantId,
        baselineId,
        repositorySnapshot,
        rubricDigest,
        JSON.stringify(normalizedMetrics),
        usageKind,
        actor,
        receipt,
        now().toISOString(),
      ],
    );
    if (!result.rows[0]) throw new Error("agentic_baseline_replayed");
    return clone(result.rows[0]);
  }

  async function getBaseline({ tenant_id, baseline_id } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const baselineId = requireRecordIdentifier(baseline_id, "baseline_id", 160);
    const result = await runtimeQuery(
      `SELECT tenant_id,baseline_id,repository_snapshot,rubric_digest,metrics,usage_kind,actor_provenance,receipt_digest,created_at
       FROM ${databaseSchema}.agentic_efficiency_baseline
       WHERE tenant_id=$1 AND baseline_id=$2`,
      [tenantId, baselineId],
    );
    return clone(result.rows[0] || null);
  }

  async function saveRateCardSnapshot({
    tenant_id,
    rate_card_version,
    provider,
    model_id,
    currency,
    rates,
    source_reference,
    provenance_digest,
    effective_at,
    expires_at,
    actor_provenance,
    receipt_digest,
  } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const rateCardVersion = requireRecordIdentifier(rate_card_version, "rate_card_version", 160);
    const normalizedRates = normalizeRateCardRates(rates);
    const effective = new Date(effective_at);
    const expires = new Date(expires_at);
    if (
      !Number.isFinite(effective.getTime())
      || !Number.isFinite(expires.getTime())
      || expires <= effective
      || expires <= now()
    ) {
      throw new Error("agentic_rate_card_window_invalid");
    }
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
    const receipt = requireDigest(receipt_digest, "receipt_digest");
    const result = await runtimeQuery(
      `INSERT INTO ${databaseSchema}.agentic_rate_card_snapshot
        (tenant_id,rate_card_version,provider,model_id,currency,rates,source_reference,provenance_digest,effective_at,expires_at,actor_provenance,receipt_digest,created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (tenant_id,rate_card_version) DO NOTHING
       RETURNING tenant_id,rate_card_version,provider,model_id,currency,rates,source_reference,provenance_digest,effective_at,expires_at,actor_provenance,receipt_digest,created_at`,
      [
        tenantId,
        rateCardVersion,
        requireSafeMetadataText(provider, "provider", 160),
        requireSafeMetadataText(model_id, "model_id", 160),
        requireSafeMetadataText(currency, "currency", 16),
        JSON.stringify(normalizedRates),
        requireSafeMetadataText(source_reference, "source_reference", 500),
        requireDigest(provenance_digest, "provenance_digest"),
        effective.toISOString(),
        expires.toISOString(),
        actor,
        receipt,
        now().toISOString(),
      ],
    );
    if (!result.rows[0]) throw new Error("agentic_rate_card_replayed");
    return clone(result.rows[0]);
  }

  async function getRateCardSnapshot({ tenant_id, rate_card_version } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const rateCardVersion = requireRecordIdentifier(rate_card_version, "rate_card_version", 160);
    const result = await runtimeQuery(
      `SELECT tenant_id,rate_card_version,provider,model_id,currency,rates,source_reference,provenance_digest,effective_at,expires_at,actor_provenance,receipt_digest,created_at
       FROM ${databaseSchema}.agentic_rate_card_snapshot
       WHERE tenant_id=$1 AND rate_card_version=$2`,
      [tenantId, rateCardVersion],
    );
    return clone(result.rows[0] || null);
  }

  async function recordComparison({
    tenant_id,
    comparison_id,
    baseline_id,
    optimized_run_id,
    comparison,
    actor_provenance,
    receipt_digest,
    provider_usage_verified = false,
    quality_safety_verified = false,
  } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const comparisonId = requireRecordIdentifier(comparison_id, "comparison_id", 160);
    const baselineId = requireRecordIdentifier(baseline_id, "baseline_id", 160);
    const optimizedRunId = requireRecordIdentifier(optimized_run_id, "optimized_run_id", 160);
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
    const receipt = requireDigest(receipt_digest, "receipt_digest");
    const normalizedComparison = normalizeComparisonPayload(comparison, tenantId);
    const usageKind = normalizedComparison.usage_kind;
    if (
      usageKind === "actual"
      && (
        provider_usage_verified !== true
        || quality_safety_verified !== true
        || normalizedComparison.quality.within_floor !== true
        || normalizedComparison.security_preserved !== true
      )
    ) {
      throw new Error("agentic_actual_comparison_unverified");
    }
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
        JSON.stringify(normalizedComparison),
        usageKind,
        normalizedComparison.quality.within_floor === true,
        normalizedComparison.security_preserved === true,
        actor,
        receipt,
        now().toISOString(),
      ],
    );
    if (!result.rows[0]) throw new Error("agentic_comparison_replayed");
    return clone(result.rows[0]);
  }

  async function recordSavingsClaim({
    tenant_id,
    claim_id,
    comparison_id,
    claim_kind,
    reconciled,
    amount,
    quality_delta,
    actor_provenance,
    receipt_digest,
    savings_evidence_verified = false,
  } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
    const claimId = requireRecordIdentifier(claim_id, "claim_id", 160);
    const comparisonId = requireRecordIdentifier(comparison_id, "comparison_id", 160);
    const claimKind = claim_kind === "actual" ? "actual" : claim_kind === "estimated" ? "estimated" : "";
    if (!claimKind) throw new Error("agentic_savings_claim_kind_invalid");
    if (claimKind === "estimated" && reconciled === true) {
      throw new Error("agentic_estimated_savings_reconciliation_forbidden");
    }
    const normalizedAmount = normalizeSavingsAmount(amount);
    const normalizedQualityDelta = normalizeSavingsQualityDelta(quality_delta);
    const comparison = await runtimeQuery(
      `SELECT usage_kind,quality_floor_preserved,safety_preserved
       FROM ${databaseSchema}.agentic_efficiency_comparison
       WHERE tenant_id=$1 AND comparison_id=$2`,
      [tenantId, comparisonId],
    );
    const source = comparison.rows[0];
    if (!source) throw new Error("agentic_savings_comparison_not_found");
    const actualAllowed = source.usage_kind === "actual"
      && source.quality_floor_preserved === true
      && source.safety_preserved === true
      && reconciled === true
      && savings_evidence_verified === true;
    if (claimKind === "actual" && !actualAllowed) {
      throw new Error("agentic_actual_savings_claim_unverified");
    }
    const actor = requireSafeMetadataText(actor_provenance, "actor_provenance", 160);
    const receipt = requireDigest(receipt_digest, "receipt_digest");
    const result = await runtimeQuery(
      `INSERT INTO ${databaseSchema}.agentic_savings_claim
        (tenant_id,claim_id,comparison_id,claim_kind,reconciled,amount,quality_delta,actor_provenance,receipt_digest,created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
       ON CONFLICT (tenant_id,claim_id) DO NOTHING
       RETURNING tenant_id,claim_id,comparison_id,claim_kind,reconciled,amount,quality_delta,actor_provenance,receipt_digest,created_at`,
      [
        tenantId,
        claimId,
        comparisonId,
        claimKind,
        claimKind === "actual" && actualAllowed,
        JSON.stringify(normalizedAmount),
        JSON.stringify(normalizedQualityDelta),
        actor,
        receipt,
        now().toISOString(),
      ],
    );
    if (!result.rows[0]) throw new Error("agentic_savings_claim_replayed");
    return clone(result.rows[0]);
  }

  async function status({ tenant_id } = {}) {
    await ready();
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
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
    const tenantId = requireRecordIdentifier(tenant_id, "tenant_id", 120);
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
    saveRunBudget,
    getRunBudget,
    registerArtifact,
    checkArtifactReuse,
    recordUsage,
    recordBaseline,
    getBaseline,
    saveRateCardSnapshot,
    getRateCardSnapshot,
    recordComparison,
    recordSavingsClaim,
    status,
    report,
    close,
  });
}
