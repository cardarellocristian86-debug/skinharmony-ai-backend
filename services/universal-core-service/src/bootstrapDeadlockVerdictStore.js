import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRetryablePostgresInitializer } from "../../shared/retryable-postgres-initializer.js";

const MIGRATION_SQL = fs.readFileSync(
  fileURLToPath(new URL("../migrations/20260810_bootstrap_deadlock_verdicts.sql", import.meta.url)),
  "utf8",
);

export const BOOTSTRAP_DEADLOCK_VERDICT_SCHEMA_VERSION = "bootstrap_deadlock_verdict_v1";

const LEDGER_SCHEMA_VERSION = "bootstrap_deadlock_verdict_event_v1";
const REVOCATION_SCHEMA_VERSION = "bootstrap_deadlock_verdict_revocation_v1";
const CLASSIFICATION = "BOOTSTRAP_DEADLOCK_VERIFIED";
const ACTION = "github.merge";
const MAX_TTL_SECONDS = 15 * 60;
const DIGEST = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TENANT = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const CHECK_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,159}$/;
const ISSUE_FIELDS = [
  "action",
  "evidence_digest",
  "exception_id",
  "failure_code",
  "head_sha",
  "normal_path_available",
  "owner_confirmation_digest",
  "pr_number",
  "remediation_digest",
  "repository",
  "required_checks",
  "tenant_id",
  "ttl_seconds",
  "work_id",
];
const CHECK_FIELDS = ["conclusion", "details_digest", "name", "status"];
const SCOPE_FIELDS = [
  "action",
  "exception_id",
  "head_sha",
  "pr_number",
  "repository",
  "tenant_id",
  "verdict_digest",
  "work_id",
];
const REVOKE_FIELDS = [...SCOPE_FIELDS, "reason_digest"];
const VERDICT_FIELDS = [
  "action",
  "classification",
  "evaluation_source",
  "evidence_digest",
  "exception_id",
  "execution_authorized",
  "expires_at",
  "failure_code",
  "failure_policy_digest",
  "head_sha",
  "host_action_authorized",
  "issued_at",
  "normal_path_available",
  "owner_confirmation_digest",
  "pr_number",
  "remediation_digest",
  "repository",
  "required_checks",
  "required_checks_digest",
  "required_checks_results_digest",
  "schema_version",
  "tenant_id",
  "ttl_seconds",
  "verdict_digest",
  "verdict_id",
  "work_id",
];

function fail(code) { throw new Error(code); }
function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value, fields, code) {
  if (!plain(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) fail(code);
}
function text(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}
function digest(value, code) { return text(value, DIGEST, code); }
function identifier(value, code) { return text(value, ID, code); }
function tenant(value) { return text(value, TENANT, "bootstrap_deadlock_tenant_invalid"); }
function repository(value) {
  const result = text(value, REPOSITORY, "bootstrap_deadlock_repository_invalid");
  if (result.includes("..") || result.endsWith(".git")) fail("bootstrap_deadlock_repository_invalid");
  return result;
}
function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
}
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!plain(value)) fail("bootstrap_deadlock_canonical_value_invalid");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function hash(value, domain) {
  return crypto.createHash("sha256").update(domain, "utf8").update(canonical(value), "utf8").digest("hex");
}
function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("bootstrap_deadlock_database_timestamp_invalid");
  return date.toISOString();
}
function normalizedFailurePolicy(allowedFailureCodes) {
  const values = allowedFailureCodes instanceof Set ? [...allowedFailureCodes] : allowedFailureCodes;
  if (!Array.isArray(values) || values.length < 1 || values.length > 256) {
    fail("bootstrap_deadlock_failure_policy_unavailable");
  }
  const normalized = [...new Set(values.map((value) => text(value, FAILURE_CODE, "bootstrap_deadlock_failure_policy_invalid")))].sort();
  if (normalized.length !== values.length) fail("bootstrap_deadlock_failure_policy_invalid");
  return Object.freeze(normalized);
}
function normalizedChecks(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) fail("bootstrap_deadlock_required_checks_invalid");
  const names = new Set();
  const checks = value.map((entry) => {
    exact(entry, CHECK_FIELDS, "bootstrap_deadlock_required_check_schema_invalid");
    const name = text(entry.name, CHECK_NAME, "bootstrap_deadlock_required_check_name_invalid");
    if (names.has(name)) fail("bootstrap_deadlock_required_check_duplicate");
    names.add(name);
    if (entry.status !== "completed" || entry.conclusion !== "success") fail("bootstrap_deadlock_required_checks_not_green");
    return Object.freeze({
      name,
      status: "completed",
      conclusion: "success",
      details_digest: digest(entry.details_digest, "bootstrap_deadlock_required_check_digest_invalid"),
    });
  });
  return Object.freeze(checks.sort((left, right) => left.name.localeCompare(right.name)));
}
function normalizedIssue(input, failurePolicy) {
  exact(input, ISSUE_FIELDS, "bootstrap_deadlock_issue_schema_invalid");
  if (input.action !== ACTION) fail("bootstrap_deadlock_action_invalid");
  if (input.normal_path_available !== false) fail("bootstrap_deadlock_normal_path_available");
  const failureCode = text(input.failure_code, FAILURE_CODE, "bootstrap_deadlock_failure_code_invalid");
  if (!failurePolicy.includes(failureCode)) fail("bootstrap_deadlock_failure_code_not_allowed");
  const ttlSeconds = positiveInteger(input.ttl_seconds, "bootstrap_deadlock_ttl_invalid");
  if (ttlSeconds > MAX_TTL_SECONDS) fail("bootstrap_deadlock_ttl_invalid");
  return Object.freeze({
    tenant_id: tenant(input.tenant_id),
    work_id: identifier(input.work_id, "bootstrap_deadlock_work_invalid"),
    repository: repository(input.repository),
    pr_number: positiveInteger(input.pr_number, "bootstrap_deadlock_pr_invalid"),
    head_sha: text(input.head_sha, SHA, "bootstrap_deadlock_sha_invalid"),
    exception_id: identifier(input.exception_id, "bootstrap_deadlock_exception_invalid"),
    action: ACTION,
    failure_code: failureCode,
    normal_path_available: false,
    required_checks: normalizedChecks(input.required_checks),
    evidence_digest: digest(input.evidence_digest, "bootstrap_deadlock_evidence_digest_invalid"),
    remediation_digest: digest(input.remediation_digest, "bootstrap_deadlock_remediation_digest_invalid"),
    owner_confirmation_digest: digest(input.owner_confirmation_digest, "bootstrap_deadlock_owner_confirmation_digest_invalid"),
    ttl_seconds: ttlSeconds,
  });
}
function normalizedScope(input, fields = SCOPE_FIELDS) {
  exact(input, fields, "bootstrap_deadlock_scope_schema_invalid");
  if (input.action !== ACTION) fail("bootstrap_deadlock_action_invalid");
  return Object.freeze({
    tenant_id: tenant(input.tenant_id),
    work_id: identifier(input.work_id, "bootstrap_deadlock_work_invalid"),
    repository: repository(input.repository),
    pr_number: positiveInteger(input.pr_number, "bootstrap_deadlock_pr_invalid"),
    head_sha: text(input.head_sha, SHA, "bootstrap_deadlock_sha_invalid"),
    exception_id: identifier(input.exception_id, "bootstrap_deadlock_exception_invalid"),
    action: ACTION,
    verdict_digest: digest(input.verdict_digest, "bootstrap_deadlock_verdict_digest_invalid"),
  });
}
function deriveVerdict(input, failurePolicy, databaseNow) {
  const normalized = normalizedIssue(input, failurePolicy);
  const issuedAt = timestamp(databaseNow);
  const expiresAt = new Date(Date.parse(issuedAt) + normalized.ttl_seconds * 1000).toISOString();
  const requiredChecksDigest = hash(
    normalized.required_checks.map(({ name }) => ({ name })),
    "bootstrap_deadlock_required_checks_v1\0",
  );
  const requiredChecksResultsDigest = hash(normalized.required_checks, "bootstrap_deadlock_required_check_results_v1\0");
  const failurePolicyDigest = hash(failurePolicy, "bootstrap_deadlock_failure_policy_v1\0");
  const verdictId = `bdv_${hash({
    exception_id: normalized.exception_id,
    tenant_id: normalized.tenant_id,
    work_id: normalized.work_id,
    repository: normalized.repository,
    pr_number: normalized.pr_number,
    head_sha: normalized.head_sha,
    issued_at: issuedAt,
    required_checks_results_digest: requiredChecksResultsDigest,
  }, "bootstrap_deadlock_verdict_id_v1\0").slice(0, 40)}`;
  const unsigned = {
    schema_version: BOOTSTRAP_DEADLOCK_VERDICT_SCHEMA_VERSION,
    verdict_id: verdictId,
    classification: CLASSIFICATION,
    evaluation_source: "server",
    tenant_id: normalized.tenant_id,
    work_id: normalized.work_id,
    repository: normalized.repository,
    pr_number: normalized.pr_number,
    head_sha: normalized.head_sha,
    exception_id: normalized.exception_id,
    action: ACTION,
    failure_code: normalized.failure_code,
    failure_policy_digest: failurePolicyDigest,
    normal_path_available: false,
    required_checks: normalized.required_checks.map((entry) => ({ ...entry })),
    required_checks_digest: requiredChecksDigest,
    required_checks_results_digest: requiredChecksResultsDigest,
    evidence_digest: normalized.evidence_digest,
    remediation_digest: normalized.remediation_digest,
    owner_confirmation_digest: normalized.owner_confirmation_digest,
    issued_at: issuedAt,
    expires_at: expiresAt,
    ttl_seconds: normalized.ttl_seconds,
    execution_authorized: false,
    host_action_authorized: false,
  };
  return Object.freeze({
    ...unsigned,
    verdict_digest: hash(unsigned, "bootstrap_deadlock_verdict_v1\0"),
  });
}
function verifyPersistedVerdict(value) {
  exact(value, VERDICT_FIELDS, "bootstrap_deadlock_persisted_verdict_invalid");
  if (value.schema_version !== BOOTSTRAP_DEADLOCK_VERDICT_SCHEMA_VERSION
      || value.classification !== CLASSIFICATION
      || value.evaluation_source !== "server"
      || value.action !== ACTION
      || value.normal_path_available !== false
      || value.execution_authorized !== false
      || value.host_action_authorized !== false) fail("bootstrap_deadlock_persisted_verdict_invalid");
  const { verdict_digest: verdictDigest, ...unsigned } = value;
  if (hash(unsigned, "bootstrap_deadlock_verdict_v1\0") !== verdictDigest) fail("bootstrap_deadlock_persisted_verdict_digest_invalid");
  return value;
}
function parseJson(value) { return typeof value === "string" ? JSON.parse(value) : value; }

export function createBootstrapDeadlockVerdictStore({ pool, allowedFailureCodes } = {}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    fail("bootstrap_deadlock_postgres_pool_required");
  }
  const failurePolicy = normalizedFailurePolicy(allowedFailureCodes);
  const initialize = createRetryablePostgresInitializer({ pool, sql: MIGRATION_SQL });

  async function transaction(work) {
    await initialize();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release?.();
    }
  }
  async function databaseNow(client) {
    const result = await client.query("/* bdv:clock */ SELECT clock_timestamp() AS now");
    if (result.rowCount !== 1) fail("bootstrap_deadlock_database_clock_unavailable");
    return result.rows[0].now;
  }
  async function lock(client, tenantId, streamId) {
    await client.query("/* bdv:lock */ SELECT pg_advisory_xact_lock(hashtext($1))", [`${tenantId}\0${streamId}`]);
  }
  async function appendEvent(client, { verdict, type, sequence, previousEventDigest, occurredAt, payload }) {
    const unsigned = {
      schema_version: LEDGER_SCHEMA_VERSION,
      tenant_id: verdict.tenant_id,
      stream_id: verdict.verdict_digest,
      sequence_number: sequence,
      event_type: type,
      occurred_at: timestamp(occurredAt),
      previous_event_digest: previousEventDigest,
      payload,
    };
    const event = { ...unsigned, event_digest: hash(unsigned, "bootstrap_deadlock_ledger_event_v1\0") };
    await client.query(
      `/* bdv:insert-event */ INSERT INTO core_bootstrap_deadlock_verdict_events
       (tenant_id,stream_id,sequence_number,event_type,event_digest,previous_event_digest,event,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [verdict.tenant_id, verdict.verdict_digest, sequence, type, event.event_digest,
        previousEventDigest, JSON.stringify(event), event.occurred_at],
    );
    return event;
  }
  async function issue(input) {
    try {
      return await transaction(async (client) => {
        const normalized = normalizedIssue(input, failurePolicy);
        await lock(client, normalized.tenant_id, normalized.exception_id);
        const verdict = deriveVerdict(input, failurePolicy, await databaseNow(client));
        await client.query(
          `/* bdv:insert-verdict */ INSERT INTO core_bootstrap_deadlock_verdicts
           (tenant_id,verdict_digest,verdict_id,exception_id,work_id,repository,pr_number,head_sha,action,
            failure_code,classification,required_checks_digest,required_checks_results_digest,evidence_digest,
            remediation_digest,owner_confirmation_digest,failure_policy_digest,normal_path_available,issued_at,
            expires_at,ttl_seconds,verdict)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb)`,
          [verdict.tenant_id, verdict.verdict_digest, verdict.verdict_id, verdict.exception_id, verdict.work_id,
            verdict.repository, verdict.pr_number, verdict.head_sha, verdict.action, verdict.failure_code,
            verdict.classification, verdict.required_checks_digest, verdict.required_checks_results_digest,
            verdict.evidence_digest, verdict.remediation_digest, verdict.owner_confirmation_digest,
            verdict.failure_policy_digest, verdict.normal_path_available, verdict.issued_at, verdict.expires_at,
            verdict.ttl_seconds, JSON.stringify(verdict)],
        );
        await appendEvent(client, {
          verdict,
          type: "bootstrap_deadlock_verdict_issued",
          sequence: 1,
          previousEventDigest: null,
          occurredAt: verdict.issued_at,
          payload: {
            verdict_digest: verdict.verdict_digest,
            exception_id: verdict.exception_id,
            classification: verdict.classification,
            execution_authorized: false,
            host_action_authorized: false,
          },
        });
        return Object.freeze(structuredClone(verdict));
      });
    } catch (error) {
      if (error?.code === "23505") fail("bootstrap_deadlock_exception_already_issued");
      throw error;
    }
  }

  return Object.freeze({
    kind: "postgresql_bootstrap_deadlock_verdict_store_v1",
    restart_durable: true,
    initialize,
    issue,
    evaluate: issue,

    async resolveActive(input) {
      const scope = normalizedScope(input);
      await initialize();
      const result = await pool.query(
        `/* bdv:resolve-active */ SELECT v.verdict
         FROM core_bootstrap_deadlock_verdicts v
         LEFT JOIN core_bootstrap_deadlock_verdict_revocations r
           ON r.tenant_id=v.tenant_id AND r.verdict_digest=v.verdict_digest
         WHERE v.tenant_id=$1 AND v.verdict_digest=$2 AND v.exception_id=$3 AND v.work_id=$4
           AND v.repository=$5 AND v.pr_number=$6 AND v.head_sha=$7 AND v.action=$8
           AND r.verdict_digest IS NULL AND v.expires_at > clock_timestamp()`,
        [scope.tenant_id, scope.verdict_digest, scope.exception_id, scope.work_id, scope.repository,
          scope.pr_number, scope.head_sha, scope.action],
      );
      if (result.rowCount !== 1) return null;
      const verdict = verifyPersistedVerdict(parseJson(result.rows[0].verdict));
      return Object.freeze(structuredClone(verdict));
    },

    async revoke(input) {
      const scope = normalizedScope(input, REVOKE_FIELDS);
      const reasonDigest = digest(input.reason_digest, "bootstrap_deadlock_revocation_reason_invalid");
      return transaction(async (client) => {
        await lock(client, scope.tenant_id, scope.verdict_digest);
        const found = await client.query(
          `/* bdv:find-for-revoke */ SELECT verdict
           FROM core_bootstrap_deadlock_verdicts
           WHERE tenant_id=$1 AND verdict_digest=$2 AND exception_id=$3 AND work_id=$4
             AND repository=$5 AND pr_number=$6 AND head_sha=$7 AND action=$8 FOR UPDATE`,
          [scope.tenant_id, scope.verdict_digest, scope.exception_id, scope.work_id, scope.repository,
            scope.pr_number, scope.head_sha, scope.action],
        );
        if (found.rowCount !== 1) fail("bootstrap_deadlock_verdict_not_found");
        const verdict = verifyPersistedVerdict(parseJson(found.rows[0].verdict));
        const prior = await client.query(
          `/* bdv:find-revocation */ SELECT reason_digest,revoked_at
           FROM core_bootstrap_deadlock_verdict_revocations
           WHERE tenant_id=$1 AND verdict_digest=$2`,
          [scope.tenant_id, scope.verdict_digest],
        );
        if (prior.rowCount) {
          if (prior.rows[0].reason_digest !== reasonDigest) fail("bootstrap_deadlock_verdict_already_revoked");
          return Object.freeze({
            schema_version: REVOCATION_SCHEMA_VERSION,
            tenant_id: scope.tenant_id,
            verdict_digest: scope.verdict_digest,
            exception_id: scope.exception_id,
            reason_digest: reasonDigest,
            revoked_at: timestamp(prior.rows[0].revoked_at),
            terminal: true,
          });
        }
        const revokedAt = timestamp(await databaseNow(client));
        await client.query(
          `/* bdv:insert-revocation */ INSERT INTO core_bootstrap_deadlock_verdict_revocations
           (tenant_id,verdict_digest,exception_id,reason_digest,revoked_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [scope.tenant_id, scope.verdict_digest, scope.exception_id, reasonDigest, revokedAt],
        );
        const ledger = await client.query(
          `/* bdv:last-event */ SELECT event
           FROM core_bootstrap_deadlock_verdict_events
           WHERE tenant_id=$1 AND stream_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
          [scope.tenant_id, scope.verdict_digest],
        );
        if (ledger.rowCount !== 1) fail("bootstrap_deadlock_ledger_missing");
        const previous = parseJson(ledger.rows[0].event);
        digest(previous.event_digest, "bootstrap_deadlock_ledger_integrity_invalid");
        await appendEvent(client, {
          verdict,
          type: "bootstrap_deadlock_verdict_revoked",
          sequence: previous.sequence_number + 1,
          previousEventDigest: previous.event_digest,
          occurredAt: revokedAt,
          payload: {
            verdict_digest: verdict.verdict_digest,
            exception_id: verdict.exception_id,
            reason_digest: reasonDigest,
            terminal: true,
          },
        });
        return Object.freeze({
          schema_version: REVOCATION_SCHEMA_VERSION,
          tenant_id: scope.tenant_id,
          verdict_digest: scope.verdict_digest,
          exception_id: scope.exception_id,
          reason_digest: reasonDigest,
          revoked_at: revokedAt,
          terminal: true,
        });
      });
    },
  });
}
