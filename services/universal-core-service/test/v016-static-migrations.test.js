import assert from "node:assert/strict";
import test from "node:test";

import {
  applyV016StaticMigrations,
  loadV016StaticMigrations,
  v016MigrationPublicErrorCode,
  V016_STATIC_MIGRATIONS,
} from "../src/v016StaticMigrations.js";

test("v0.16 predeploy loads only the two additive, transaction-bound migrations", async () => {
  const migrations = await loadV016StaticMigrations();
  assert.deepEqual(
    migrations.map(({ version, file }) => ({ version, file })),
    V016_STATIC_MIGRATIONS.map(({ version, file }) => ({ version, file })),
  );
  for (const migration of migrations) {
    assert.match(migration.digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(migration.sql, /\bBEGIN\s*;/i);
    assert.match(migration.sql, /\bCOMMIT\s*;\s*$/i);
    assert.equal(migration.file.endsWith(".up.sql"), true);
    assert.equal(migration.sql.includes("__V016_MIGRATION_DIGEST__"), false);
    assert.equal(migration.sql.includes("__V016_ROLLBACK_REFERENCE__"), false);
    assert.match(migration.rollback_reference, /^git:[a-f0-9]{40}$/);
  }
});

test("v0.16 predeploy is lock-serialized, digest-bound and idempotent", async () => {
  const migrations = await loadV016StaticMigrations();
  const expected = new Map(migrations.map((item) => [item.version, item]));
  const audit = new Map();
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ released: true }] };
      if (sql.startsWith("SELECT state,migration_digest,rollback_reference")) {
        return { rows: audit.has(parameters[0]) ? [audit.get(parameters[0])] : [] };
      }
      for (const migration of migrations) {
        if (sql.includes(migration.version)) {
          assert.equal(sql.includes("__V016_MIGRATION_DIGEST__"), false);
          assert.equal(sql.includes("__V016_ROLLBACK_REFERENCE__"), false);
          audit.set(migration.version, {
            state: "active",
            migration_digest: migration.digest,
            rollback_reference: migration.rollback_reference,
          });
          break;
        }
      }
      return { rows: [] };
    },
    release() {
      calls.push({ release: true });
    },
  };
  const receipt = await applyV016StaticMigrations({
    pool: { connect: async () => client },
  });
  const replay = await applyV016StaticMigrations({
    pool: { connect: async () => client },
  });

  assert.equal(receipt.migration_count, 2);
  assert.equal(receipt.applied_count, 2);
  assert.equal(receipt.reconciled_count, 0);
  assert.equal(replay.applied_count, 0);
  assert.equal(replay.reconciled_count, 2);
  assert.equal(receipt.secrets_exposed, false);
  assert.deepEqual(receipt.migrations.map((item) => item.state), ["active", "active"]);
  assert.deepEqual(
    receipt.migrations.map((item) => item.digest),
    [...expected.values()].map((item) => item.digest),
  );
  assert.equal(
    calls.filter((call) => call.sql?.includes("CREATE SCHEMA IF NOT EXISTS")).length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.sql?.includes("pg_try_advisory_lock(")).length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.sql?.includes("pg_advisory_unlock(")).length,
    2,
  );
  assert.equal(calls.at(-1).release, true);
  assert.equal(JSON.stringify(receipt).includes("postgres"), false);
});

test("v0.16 predeploy fails closed when an audit row is missing or inactive", async () => {
  const client = {
    async query(sql, parameters = []) {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ released: true }] };
      if (sql.startsWith("SELECT state,migration_digest,rollback_reference")) {
        return { rows: [{ state: "disabled" }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    applyV016StaticMigrations({ pool: { connect: async () => client } }),
    /static_migration_not_active:0\.16\.0-ai-learning-factory-v1/,
  );
});

test("v0.16 predeploy rejects active digest or rollback drift before executing DDL", async () => {
  for (const drift of [
    { migration_digest: `sha256:${"0".repeat(64)}`, rollback_reference: `git:${"1".repeat(40)}` },
    { migration_digest: null, rollback_reference: `git:${"1".repeat(40)}` },
  ]) {
    let ddlExecuted = false;
    const client = {
      async query(sql) {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
        if (sql.includes("pg_advisory_unlock")) return { rows: [{ released: true }] };
        if (sql.startsWith("SELECT state,migration_digest,rollback_reference")) {
          return { rows: [{ state: "active", ...drift }] };
        }
        ddlExecuted = true;
        return { rows: [] };
      },
      release() {},
    };
    await assert.rejects(
      applyV016StaticMigrations({ pool: { connect: async () => client } }),
      /static_migration_digest_mismatch:0\.16\.0-ai-learning-factory-v1/,
    );
    assert.equal(ddlExecuted, false);
  }
});

test("CLI error sanitizer never emits driver URLs, users or passwords", () => {
  const unsafe = new Error(
    "connect failed for postgres://admin:super-secret@db.internal:5432/governance",
  );
  assert.equal(v016MigrationPublicErrorCode(unsafe), "v016_static_migration_failed");
  assert.equal(
    v016MigrationPublicErrorCode(new Error("rollback_point_invalid")),
    "rollback_point_invalid",
  );
});

test("v0.16 predeploy resumes a partial first migration without repeating it", async () => {
  const migrations = await loadV016StaticMigrations();
  const audit = new Map([[
    migrations[0].version,
    {
      state: "active",
      migration_digest: migrations[0].digest,
      rollback_reference: migrations[0].rollback_reference,
    },
  ]]);
  const executed = [];
  const client = {
    async query(sql, parameters = []) {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ released: true }] };
      if (sql.startsWith("SELECT state,migration_digest,rollback_reference")) {
        return { rows: audit.has(parameters[0]) ? [audit.get(parameters[0])] : [] };
      }
      const migration = migrations.find((item) => sql.includes(item.version));
      if (migration) {
        executed.push(migration.version);
        audit.set(migration.version, {
          state: "active",
          migration_digest: migration.digest,
          rollback_reference: migration.rollback_reference,
        });
      }
      return { rows: [] };
    },
    release() {},
  };

  const receipt = await applyV016StaticMigrations({
    pool: { connect: async () => client },
  });
  assert.deepEqual(executed, [migrations[1].version]);
  assert.equal(receipt.applied_count, 1);
  assert.equal(receipt.reconciled_count, 1);
});

test("v0.16 predeploy fails immediately on advisory-lock contention", async () => {
  let released = false;
  const client = {
    async query(sql) {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: false }] };
      throw new Error("query_after_failed_lock");
    },
    release() {
      released = true;
    },
  };
  await assert.rejects(
    applyV016StaticMigrations({ pool: { connect: async () => client } }),
    /static_migration_lock_unavailable/,
  );
  assert.equal(released, true);
});

test("v0.16 predeploy verifies unlock and never masks the primary failure", async () => {
  const migrations = await loadV016StaticMigrations();
  let releaseCount = 0;
  const client = {
    async query(sql, parameters = []) {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ released: false }] };
      if (sql.startsWith("SELECT state,migration_digest,rollback_reference")) {
        const migration = migrations.find((item) => item.version === parameters[0]);
        return {
          rows: [{
            state: "active",
            migration_digest: migration.digest,
            rollback_reference: migration.rollback_reference,
          }],
        };
      }
      return { rows: [] };
    },
    release() {
      releaseCount += 1;
    },
  };
  await assert.rejects(
    applyV016StaticMigrations({ pool: { connect: async () => client } }),
    /static_migration_unlock_failed/,
  );
  assert.equal(releaseCount, 1);

  const primaryFailureClient = {
    async query(sql) {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("pg_advisory_unlock")) throw new Error("driver_cleanup_secret");
      if (sql.startsWith("SELECT state,migration_digest,rollback_reference")) {
        return {
          rows: [{
            state: "active",
            migration_digest: `sha256:${"0".repeat(64)}`,
            rollback_reference: `git:${"1".repeat(40)}`,
          }],
        };
      }
      return { rows: [] };
    },
    release() {
      releaseCount += 1;
    },
  };
  await assert.rejects(
    applyV016StaticMigrations({
      pool: { connect: async () => primaryFailureClient },
    }),
    /static_migration_digest_mismatch:0\.16\.0-ai-learning-factory-v1/,
  );
  assert.equal(releaseCount, 2);
});
