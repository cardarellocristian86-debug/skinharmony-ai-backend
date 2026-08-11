import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createBootstrapDeadlockVerdictStore } from "../src/bootstrapDeadlockVerdictStore.js";

const NOW = "2026-08-10T16:00:00.000Z";
const digest = (character) => character.repeat(64);

function input(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    work_id: "work-genesis-01",
    repository: "skinharmony/core",
    pr_number: 223,
    head_sha: "a".repeat(40),
    exception_id: "exception-pr-223",
    action: "github.merge",
    failure_code: "RELEASE_MANIFEST_REQUIRED",
    normal_path_available: false,
    required_checks: [
      { name: "core-mcp", status: "completed", conclusion: "success", details_digest: digest("1") },
      { name: "deployment-parity", status: "completed", conclusion: "success", details_digest: digest("2") },
      { name: "universal-core", status: "completed", conclusion: "success", details_digest: digest("3") },
    ],
    evidence_digest: digest("4"),
    remediation_digest: digest("5"),
    owner_confirmation_digest: digest("6"),
    ttl_seconds: 900,
    ...overrides,
  };
}

class FakePostgresPool {
  constructor() {
    this.now = NOW;
    this.verdicts = new Map();
    this.revocations = new Map();
    this.events = new Map();
    this.queries = [];
  }
  async connect() { return this; }
  release() {}
  async query(sql, params = []) {
    this.queries.push(sql);
    if (/CREATE TABLE IF NOT EXISTS core_bootstrap_deadlock_verdicts/.test(sql)) return { rowCount: 0, rows: [] };
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("bdv:lock")) return { rowCount: 1, rows: [{}] };
    if (sql.includes("bdv:clock")) return { rowCount: 1, rows: [{ now: this.now }] };
    if (sql.includes("bdv:insert-verdict")) {
      const key = `${params[0]}\0${params[1]}`;
      if (this.verdicts.has(key) || [...this.verdicts.values()].some((entry) =>
        entry.tenant_id === params[0] && entry.exception_id === params[3])) {
        const error = new Error("duplicate"); error.code = "23505"; throw error;
      }
      this.verdicts.set(key, {
        tenant_id: params[0], verdict_digest: params[1], exception_id: params[3], work_id: params[4],
        repository: params[5], pr_number: params[6], head_sha: params[7], action: params[8],
        expires_at: params[19], verdict: JSON.parse(params[21]),
      });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("bdv:insert-event")) {
      const key = `${params[0]}\0${params[1]}`;
      const rows = this.events.get(key) || [];
      rows.push({ event: JSON.parse(params[6]) });
      this.events.set(key, rows);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("bdv:resolve-active")) {
      const key = `${params[0]}\0${params[1]}`;
      const value = this.verdicts.get(key);
      const matches = value && value.exception_id === params[2] && value.work_id === params[3]
        && value.repository === params[4] && value.pr_number === params[5] && value.head_sha === params[6]
        && value.action === params[7] && !this.revocations.has(key)
        && Date.parse(value.expires_at) > Date.parse(this.now);
      return { rowCount: matches ? 1 : 0, rows: matches ? [{ verdict: structuredClone(value.verdict) }] : [] };
    }
    if (sql.includes("bdv:find-for-revoke")) {
      const key = `${params[0]}\0${params[1]}`;
      const value = this.verdicts.get(key);
      const matches = value && value.exception_id === params[2] && value.work_id === params[3]
        && value.repository === params[4] && value.pr_number === params[5] && value.head_sha === params[6]
        && value.action === params[7];
      return { rowCount: matches ? 1 : 0, rows: matches ? [{ verdict: structuredClone(value.verdict) }] : [] };
    }
    if (sql.includes("bdv:find-revocation")) {
      const value = this.revocations.get(`${params[0]}\0${params[1]}`);
      return { rowCount: value ? 1 : 0, rows: value ? [structuredClone(value)] : [] };
    }
    if (sql.includes("bdv:insert-revocation")) {
      const key = `${params[0]}\0${params[1]}`;
      this.revocations.set(key, { reason_digest: params[3], revoked_at: params[4] });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("bdv:last-event")) {
      const rows = this.events.get(`${params[0]}\0${params[1]}`) || [];
      const value = rows.at(-1);
      return { rowCount: value ? 1 : 0, rows: value ? [structuredClone(value)] : [] };
    }
    throw new Error(`unexpected_query:${sql.slice(0, 100)}`);
  }
}

function store(pool = new FakePostgresPool()) {
  return { pool, store: createBootstrapDeadlockVerdictStore({
    pool,
    allowedFailureCodes: ["RELEASE_MANIFEST_REQUIRED", "REQUIRED_CHECKS_POLICY_UNAVAILABLE"],
  }) };
}
function scope(verdict, overrides = {}) {
  return {
    tenant_id: verdict.tenant_id,
    work_id: verdict.work_id,
    repository: verdict.repository,
    pr_number: verdict.pr_number,
    head_sha: verdict.head_sha,
    exception_id: verdict.exception_id,
    action: verdict.action,
    verdict_digest: verdict.verdict_digest,
    ...overrides,
  };
}

test("issues an exact server-derived verified verdict only for an eligible deadlock", async () => {
  const { pool, store: verdicts } = store();
  const verdict = await verdicts.issue(input());
  assert.equal(verdict.schema_version, "bootstrap_deadlock_verdict_v1");
  assert.equal(verdict.classification, "BOOTSTRAP_DEADLOCK_VERIFIED");
  assert.equal(verdict.evaluation_source, "server");
  assert.equal(verdict.execution_authorized, false);
  assert.equal(verdict.host_action_authorized, false);
  assert.equal(verdict.issued_at, NOW);
  assert.equal(verdict.expires_at, "2026-08-10T16:15:00.000Z");
  assert.match(verdict.verdict_id, /^bdv_[a-f0-9]{40}$/);
  assert.match(verdict.verdict_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(verdict.required_checks.map((entry) => entry.name), ["core-mcp", "deployment-parity", "universal-core"]);
  assert.deepEqual(await verdicts.resolveActive(scope(verdict)), verdict);
  assert.equal(pool.events.get(`${verdict.tenant_id}\0${verdict.verdict_digest}`).length, 1);
  await assert.rejects(verdicts.evaluate(input()), /bootstrap_deadlock_exception_already_issued/);
});

test("fails closed for non-green checks, available normal path, wrong action, policy miss and excessive TTL", async () => {
  const cases = [
    [input({ required_checks: [{ name: "core", status: "completed", conclusion: "failure", details_digest: digest("1") }] }), /required_checks_not_green/],
    [input({ normal_path_available: true }), /normal_path_available/],
    [input({ action: "render.deploy" }), /action_invalid/],
    [input({ failure_code: "ORDINARY_POLICY_DENY" }), /failure_code_not_allowed/],
    [input({ ttl_seconds: 901 }), /ttl_invalid/],
    [input({ evidence_digest: "invalid" }), /evidence_digest_invalid/],
  ];
  for (const [value, expected] of cases) {
    const { store: verdicts } = store();
    await assert.rejects(verdicts.issue(value), expected);
  }
});

test("rejects caller-derived verdict fields and requires an explicit server failure-code policy", async () => {
  const { store: verdicts } = store();
  await assert.rejects(verdicts.issue({ ...input(), classification: "BOOTSTRAP_DEADLOCK_VERIFIED" }), /issue_schema_invalid/);
  assert.throws(() => createBootstrapDeadlockVerdictStore({ pool: new FakePostgresPool(), allowedFailureCodes: [] }), /failure_policy_unavailable/);
});

test("resolveActive is digest-and-scope bound and expires using the PostgreSQL clock", async () => {
  const { pool, store: verdicts } = store();
  const verdict = await verdicts.issue(input());
  assert.equal(await verdicts.resolveActive(scope(verdict, { tenant_id: "tenant-b" })), null);
  assert.equal(await verdicts.resolveActive(scope(verdict, { head_sha: "b".repeat(40) })), null);
  pool.now = "2026-08-10T16:15:00.000Z";
  assert.equal(await verdicts.resolveActive(scope(verdict)), null);
});

test("revoke is terminal, append-only and idempotent only for the same reason", async () => {
  const { pool, store: verdicts } = store();
  const verdict = await verdicts.issue(input());
  const reason = digest("7");
  const revoked = await verdicts.revoke({ ...scope(verdict), reason_digest: reason });
  assert.equal(revoked.schema_version, "bootstrap_deadlock_verdict_revocation_v1");
  assert.equal(revoked.terminal, true);
  assert.equal(await verdicts.resolveActive(scope(verdict)), null);
  assert.deepEqual(await verdicts.revoke({ ...scope(verdict), reason_digest: reason }), revoked);
  await assert.rejects(
    verdicts.revoke({ ...scope(verdict), reason_digest: digest("8") }),
    /already_revoked/,
  );
  const events = pool.events.get(`${verdict.tenant_id}\0${verdict.verdict_digest}`).map((entry) => entry.event);
  assert.deepEqual(events.map((event) => event.event_type), [
    "bootstrap_deadlock_verdict_issued",
    "bootstrap_deadlock_verdict_revoked",
  ]);
  assert.equal(events[1].previous_event_digest, events[0].event_digest);
});

test("migration enforces immutable verdicts, revocations and ledger rows", () => {
  const sql = fs.readFileSync(fileURLToPath(new URL("../migrations/20260810_bootstrap_deadlock_verdicts.sql", import.meta.url)), "utf8");
  assert.match(sql, /BEFORE UPDATE OR DELETE ON core_bootstrap_deadlock_verdicts/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON core_bootstrap_deadlock_verdict_revocations/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON core_bootstrap_deadlock_verdict_events/);
  assert.match(sql, /classification = 'BOOTSTRAP_DEADLOCK_VERIFIED'/);
  assert.match(sql, /ttl_seconds BETWEEN 1 AND 900/);
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE).*github\.merge\s*\(/is);
});
