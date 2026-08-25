import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST,
  ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
  actionEvaluatorDigest,
  createFileActionEvaluatorIdempotencyStore,
  createPostgresActionEvaluatorIdempotencyStore,
} from "../src/actionEvaluatorIdempotencyStore.js";

const OWNER = `osf_${"a".repeat(64)}`;

function input(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    action_type: "work.continuity.v2.create",
    idempotency_key: "nyra_cont_action_store_test_001",
    request_digest: actionEvaluatorDigest({ target: "work-bootstrap-a" }),
    owner_subject_fingerprint: OWNER,
    owner_approval: {
      approval_hash: `sha256:${"b".repeat(64)}`,
      expires_at: "2026-08-25T12:02:00.000Z",
    },
    authorization_expires_at: "2026-08-25T12:02:00.000Z",
    ...overrides,
  };
}

function response() {
  return {
    ok: true,
    tenant_id: "tenant-a",
    authorization: { allowed: true, state: "allow", execution_authorized: false },
  };
}

test("file action evaluator store serializes concurrent retries and persists one original receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-action-idem-"));
  const now = () => Date.parse("2026-08-25T12:00:00.000Z");
  const firstStore = createFileActionEvaluatorIdempotencyStore({ root, now });
  await firstStore.initialize();
  const first = await firstStore.begin(input());
  let secondSettled = false;
  const secondPromise = firstStore.begin(input()).then((value) => {
    secondSettled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondSettled, false);
  const created = await first.commit(response());
  const second = await secondPromise;
  assert.equal(created.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.receipt.receipt_digest, created.receipt.receipt_digest);
  assert.equal(second.authority_response.authorization.decision_id,
    created.authority_response.authorization.decision_id);

  const restarted = createFileActionEvaluatorIdempotencyStore({ root, now });
  const replay = await restarted.begin(input({
    owner_approval: {
      approval_hash: `sha256:${"c".repeat(64)}`,
      expires_at: "2026-08-25T12:02:00.000Z",
    },
  }));
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.receipt_digest, created.receipt.receipt_digest);
});

test("action evaluator store rejects semantic substitution and keeps expired keys as tombstones", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-action-idem-conflict-"));
  let clock = Date.parse("2026-08-25T12:00:00.000Z");
  const store = createFileActionEvaluatorIdempotencyStore({ root, now: () => clock });
  const session = await store.begin(input());
  await session.commit(response());
  await assert.rejects(store.begin(input({
    request_digest: actionEvaluatorDigest({ target: "substituted" }),
    owner_approval: {
      approval_hash: `sha256:${"d".repeat(64)}`,
      expires_at: "2026-08-25T12:02:00.000Z",
    },
  })), /core_action_idempotency_conflict/);
  clock = Date.parse("2026-08-25T12:02:01.000Z");
  await assert.rejects(store.begin(input({
    owner_approval: {
      approval_hash: `sha256:${"e".repeat(64)}`,
      expires_at: "2026-08-25T12:04:00.000Z",
    },
    authorization_expires_at: "2026-08-25T12:04:00.000Z",
  })), /core_action_idempotency_expired/);
});

test("producer failure rollback releases the owner approval without creating a receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-action-idem-rollback-"));
  const store = createFileActionEvaluatorIdempotencyStore({
    root,
    now: () => Date.parse("2026-08-25T12:00:00.000Z"),
  });
  const failed = await store.begin(input());
  await failed.rollback();
  const retry = await store.begin(input());
  assert.equal(retry.replayed, false);
  const completed = await retry.commit(response());
  assert.equal(completed.replayed, false);
});

test("commit fails closed when owner authority expires during evaluation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-action-idem-expiry-"));
  let clock = Date.parse("2026-08-25T12:00:00.000Z");
  const store = createFileActionEvaluatorIdempotencyStore({ root, now: () => clock });
  const session = await store.begin(input());
  clock = Date.parse("2026-08-25T12:02:01.000Z");
  await assert.rejects(session.commit(response()), /core_action_idempotency_expired/);
});

test("replay verifies the persisted response, receipt and digest before returning authority", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-action-idem-integrity-"));
  const now = () => Date.parse("2026-08-25T12:00:00.000Z");
  const store = createFileActionEvaluatorIdempotencyStore({ root, now });
  const session = await store.begin(input());
  await session.commit(response());
  const receiptFile = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.endsWith(".json") &&
      !entry.parentPath.includes("owner-approvals"));
  assert.ok(receiptFile);
  const file = path.join(receiptFile.parentPath, receiptFile.name);
  const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
  persisted.authority_response.authorization.allowed = false;
  fs.writeFileSync(file, JSON.stringify(persisted));
  const restarted = createFileActionEvaluatorIdempotencyStore({ root, now });
  await assert.rejects(restarted.begin(input({
    owner_approval: {
      approval_hash: `sha256:${"f".repeat(64)}`,
      expires_at: "2026-08-25T12:02:00.000Z",
    },
  })), /core_action_idempotency_record_invalid/);
});

function verifiedSchemaRow(overrides = {}) {
  return {
    schema_version: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
    schema_digest: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST,
    append_only: true,
    receipt_primary_key_verified: true,
    approval_primary_key_verified: true,
    receipt_columns_verified: true,
    approval_columns_verified: true,
    expiry_index_verified: true,
    deny_mutation_function_verified: true,
    receipt_append_only_verified: true,
    approval_append_only_verified: true,
    manifest_append_only_verified: true,
    receipt_truncate_guard_verified: true,
    approval_truncate_guard_verified: true,
    manifest_truncate_guard_verified: true,
    ...overrides,
  };
}

function connectedSchemaPool(query) {
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  };
}

test("PostgreSQL initialization verifies manifest, keys, columns, index and append-only guards", async () => {
  const queries = [];
  const pool = connectedSchemaPool(async (sql) => {
      queries.push(sql);
      if (sql.includes("FROM core_action_evaluator_schema_manifest m")) {
        return { rows: [verifiedSchemaRow()] };
      }
      return { rows: [] };
    });
  const store = createPostgresActionEvaluatorIdempotencyStore({ pool });
  const status = await store.initialize();
  assert.deepEqual(status, {
    schema_version: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_VERSION,
    schema_digest: ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST,
    schema_verified: true,
    append_only_enforced: true,
  });
  const ddl = queries.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS core_action_evaluator_receipts"));
  const verification = queries.find((sql) => sql.includes("FROM core_action_evaluator_schema_manifest m"));
  assert.match(ddl, /core_action_evaluator_receipts_append_only/);
  assert.match(ddl, /core_action_evaluator_owner_approvals_append_only/);
  assert.match(ddl, /core_action_evaluator_receipts_truncate_guard/);
  assert.match(ddl, /core_action_evaluator_owner_approvals_truncate_guard/);
  assert.match(ddl, /core_action_evaluator_schema_manifest_truncate_guard/);
  assert.match(ddl, /core_action_evaluator_schema_manifest/);
  assert.match(verification, /receipt_primary_key_verified/);
  assert.match(verification, /receipt_columns_verified/);
  assert.match(verification, /t\.tgtype=27/);
  assert.match(verification, /t\.tgtype=34/);
  assert.match(verification, /deny_mutation_function_verified/);
  assert.match(verification, /authorization_expires_at/);
  assert(queries.includes("SET LOCAL lock_timeout='1s'"));
  assert(queries.includes("SET LOCAL statement_timeout='5s'"));
});

test("PostgreSQL initialization fails closed on schema drift and retries transient initialization", async () => {
  let attempt = 0;
  const retryingPool = connectedSchemaPool(async (sql) => {
      if (!sql.includes("FROM core_action_evaluator_schema_manifest m") && attempt++ === 0) {
        throw new Error("transient_database_startup");
      }
      if (sql.includes("FROM core_action_evaluator_schema_manifest m")) {
        return { rows: [verifiedSchemaRow()] };
      }
      return { rows: [] };
    });
  const retrying = createPostgresActionEvaluatorIdempotencyStore({ pool: retryingPool });
  await assert.rejects(retrying.initialize(), /core_action_idempotency_store_unavailable/);
  assert.equal((await retrying.initialize()).schema_verified, true);

  const drifted = createPostgresActionEvaluatorIdempotencyStore({ pool: connectedSchemaPool(
    async (sql) => {
      return sql.includes("FROM core_action_evaluator_schema_manifest m")
        ? { rows: [verifiedSchemaRow({ receipt_primary_key_verified: false })] }
        : { rows: [] };
    },
  ) });
  await assert.rejects(drifted.initialize(), /core_action_idempotency_schema_unverified/);
});

test("migration makes replay receipts, approvals and the schema manifest append-only", () => {
  const migration = fs.readFileSync(new URL(
    "../migrations/20260825_003_action_evaluator_idempotency_v1.sql",
    import.meta.url,
  ), "utf8");
  assert.match(migration, /core_action_evaluator_receipts_append_only/);
  assert.match(migration, /core_action_evaluator_owner_approvals_append_only/);
  assert.match(migration, /core_action_evaluator_schema_manifest_append_only/);
  assert.match(migration, /core_action_evaluator_receipts_truncate_guard/);
  assert.match(migration, /core_action_evaluator_owner_approvals_truncate_guard/);
  assert.match(migration, /core_action_evaluator_schema_manifest_truncate_guard/);
  assert.match(migration, /BEFORE TRUNCATE/);
  assert.match(migration, new RegExp(ACTION_EVALUATOR_IDEMPOTENCY_SCHEMA_DIGEST));
  assert.doesNotMatch(migration, /^\s*(?:DROP\b|TRUNCATE\b|DELETE\s+FROM\b)/im);
});
