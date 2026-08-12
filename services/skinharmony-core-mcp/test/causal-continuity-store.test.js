import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CAUSAL_CONTINUITY_CAPABILITIES,
  CAUSAL_CONTINUITY_MIGRATION_ID,
  CAUSAL_CONTINUITY_SCHEMA_SQL,
  assertIndependentCausalAttestation,
  buildCausalRecord,
  createCausalContinuityStore,
} from "../src/causal-continuity-store.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(directory,
  "../migrations/20260810_causal_continuity_foundation_v1.sql"), "utf8");

function record(overrides = {}) {
  return buildCausalRecord({
    tenant_id: "tenant-a",
    project_id: "nyra-core",
    sequence_number: 1,
    record_type: "PROJECT_REGISTERED",
    subject_type: "PROJECT",
    subject_id: "nyra-core",
    payload: { objective: "causal continuity", constraints: ["fail-closed"] },
    previous_record_hash: null,
    actor_id: "owner-a",
    actor_kind: "owner",
    created_at: "2026-08-10T08:00:00.000Z",
    ...overrides,
  });
}

test("causal record contract is canonical, deterministic and tenant-bound", () => {
  const first = record();
  const reordered = record({ payload: { constraints: ["fail-closed"], objective: "causal continuity" } });
  assert.equal(first.payload_digest, reordered.payload_digest);
  assert.equal(first.record_hash, reordered.record_hash);
  assert.equal(first.record_id, reordered.record_id);
  assert.match(first.record_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(record({ tenant_id: "tenant-b" }).record_hash, first.record_hash);
});

test("causal payloads redact credential-shaped material before hashing", () => {
  const cleaned = record({ payload: {
    objective: "keep sk-proj-abcdefghijklmnop out of continuity",
    access_token: "bearer-value",
    nested: {
      secretKey: "secret-key-value",
      apiToken: "api-token-value",
      auth_token: "auth-token-value",
      signing_key: "signing-key-value",
      privateToken: "private-token-value",
      credentials: { username: "hidden", password: "hidden" },
    },
    list: [
      { credential: "credential-value" },
      { refreshKey: "refresh-key-value" },
      { accessToken: "access-token-value" },
    ],
  } });
  assert.doesNotMatch(JSON.stringify(cleaned.payload),
    /sk-proj-|bearer-value|secret-key-value|api-token-value|auth-token-value|signing-key-value|private-token-value|credential-value|refresh-key-value|access-token-value|username/);
  assert.equal(cleaned.payload.access_token, "[REDACTED]");
  assert.equal(cleaned.payload.nested.secretKey, "[REDACTED]");
  assert.equal(cleaned.payload.nested.apiToken, "[REDACTED]");
  assert.equal(cleaned.payload.nested.auth_token, "[REDACTED]");
  assert.equal(cleaned.payload.nested.signing_key, "[REDACTED]");
  assert.equal(cleaned.payload.nested.privateToken, "[REDACTED]");
  assert.equal(cleaned.payload.nested.credentials, "[REDACTED]");
  assert.equal(cleaned.payload.list[0].credential, "[REDACTED]");
  assert.equal(cleaned.payload.list[1].refreshKey, "[REDACTED]");
  assert.equal(cleaned.payload.list[2].accessToken, "[REDACTED]");
});

test("hash-chain contract rejects missing, unexpected and malformed predecessor hashes", () => {
  const head = record();
  const second = record({ sequence_number: 2, previous_record_hash: head.record_hash,
    record_type: "GENESIS_ANCHORED", subject_type: "GENESIS",
    subject_id: "d8fd42f0-7cf9-5db1-8fb1-82bea53093c5" });
  assert.equal(second.previous_record_hash, head.record_hash);
  assert.notEqual(second.record_hash, head.record_hash);
  assert.throws(() => record({ sequence_number: 2 }), /causal_previous_hash_invalid/);
  assert.throws(() => record({ previous_record_hash: "f".repeat(64) }), /causal_previous_hash_invalid/);
  assert.throws(() => record({ sequence_number: 2, previous_record_hash: "not-a-digest" }), /digest_invalid/);
});

test("later lifecycle transitions are reserved and cannot collapse executed, verified and closed", () => {
  for (const record_type of [
    "EXECUTION_RECORDED", "VERIFICATION_RECORDED", "CLOSURE_RECORDED", "REOPENING_RECORDED",
  ]) assert.throws(() => record({ record_type }), /causal_lifecycle_slice_not_implemented/);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL,
    /lifecycle_state IN \('DECLARED','EXECUTED','VERIFIED','CLOSED','REOPENED'\)/);
});

test("independent attestation denies self-verification and keeps high risk unavailable", () => {
  assert.equal(assertIndependentCausalAttestation({
    executor_actor_id: "builder-a", verifier_actor_id: "verifier-b",
  }), true);
  assert.throws(() => assertIndependentCausalAttestation({
    executor_actor_id: "builder-a", verifier_actor_id: "builder-a",
  }), /causal_self_attestation_denied/);
  assert.throws(() => assertIndependentCausalAttestation({
    executor_actor_id: "builder-a", verifier_actor_id: "verifier-b", risk_class: "high",
  }), /causal_high_risk_attestation_not_implemented/);
});

test("schema is additive, explicitly sourced, composite-tenant scoped and honestly defers projection", () => {
  for (const table of [
    "causal_project", "causal_genesis_intent", "causal_intent_revision", "causal_operation",
    "causal_record", "causal_idempotency", "causal_outbox", "causal_projection_cursor",
  ]) {
    assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, /CHECK \(source_kind = 'explicit'\)/);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, /FOREIGN KEY \(tenant_id, project_id, genesis_id\)/);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, /FOREIGN KEY \(tenant_id, project_id, intent_revision_id\)/);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, /FOREIGN KEY \(tenant_id, project_id, operation_id\)/);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, /causal_history_append_only/);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, /causal_outbox_pending_idx/);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, /causal_projection_cursor/);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL, /cursor advance is unavailable/);
  assert.equal(CAUSAL_CONTINUITY_CAPABILITIES.projection_cursor_advance, false);
  assert.match(CAUSAL_CONTINUITY_SCHEMA_SQL,
    /PRIMARY KEY \(tenant_id, project_id, scope_kind, scope_id, idempotency_key\)/);
  assert.doesNotMatch(CAUSAL_CONTINUITY_SCHEMA_SQL, /^\s*(DROP\b|TRUNCATE\b|DELETE\s+FROM\b)/im);
  assert.doesNotMatch(migration, /^\s*(DROP\b|TRUNCATE\b|DELETE\s+FROM\b|UPDATE\s+tenant_work\b)/im);
  assert.doesNotMatch(migration, /\b(INSERT|UPDATE)\s+INTO?\s+tenant_work\b/i);
  assert.match(migration, new RegExp(CAUSAL_CONTINUITY_MIGRATION_ID));
});

test("startup initialization is idempotent per store and restart-safe across store instances", async () => {
  const calls = [];
  const pool = { query: async (sql) => { calls.push(String(sql)); return { rows: [], rowCount: 0 }; } };
  const first = createCausalContinuityStore({ pool });
  await first.initialize();
  await first.initialize();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], CAUSAL_CONTINUITY_SCHEMA_SQL);
  const restarted = createCausalContinuityStore({ pool });
  await restarted.initialize();
  assert.equal(calls.length, 2);
  assert.equal(calls[1], CAUSAL_CONTINUITY_SCHEMA_SQL);
});

test("store requires PostgreSQL and rejects malformed scope before causal writes", async () => {
  assert.throws(() => createCausalContinuityStore({}), /causal_postgres_pool_required/);
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const store = createCausalContinuityStore({ pool });
  await assert.rejects(store.registerProject({
    tenant_id: "../foreign", project_id: "project-a", project_name: "A",
    actor_id: "owner-a", idempotency_key: "create-a",
  }), /causal_tenant_invalid/);
  await assert.rejects(store.registerProject({
    tenant_id: "tenant-a", project_id: "project-a", project_name: "A",
    actor_id: "owner-a", idempotency_key: "create-a",
  }), /causal_transaction_adapter_required/);
});

test("multi-write operation rolls back and releases when outbox persistence fails", async () => {
  const queries = [];
  let released = false;
  let projectRow = null;
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      queries.push(normalized);
      if (normalized.startsWith("INSERT INTO causal_project")) {
        projectRow = { project_name: params[2], project_digest: params[3] };
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("SELECT project_name,project_digest FROM causal_project")) {
        return { rows: [projectRow], rowCount: 1 };
      }
      if (normalized.startsWith("SELECT request_digest,response_document FROM causal_idempotency")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith("SELECT 1 FROM causal_project")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (normalized.startsWith("SELECT sequence_number,record_hash FROM causal_record")) return { rows: [], rowCount: 0 };
      if (normalized.startsWith("INSERT INTO causal_outbox")) throw new Error("outbox_write_failed");
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => client,
  };
  const store = createCausalContinuityStore({ pool, now: () => new Date("2026-08-10T08:00:00.000Z") });
  await assert.rejects(store.registerProject({
    tenant_id: "tenant-a", project_id: "project-a", project_name: "A",
    actor_id: "owner-a", idempotency_key: "create-a",
  }), /outbox_write_failed/);
  assert.equal(queries[0], "BEGIN");
  assert.equal(queries.some((query) => query.startsWith("INSERT INTO causal_record")), true);
  assert.equal(queries.some((query) => query.startsWith("INSERT INTO causal_outbox")), true);
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(queries.includes("COMMIT"), false);
  assert.equal(released, true);
});
