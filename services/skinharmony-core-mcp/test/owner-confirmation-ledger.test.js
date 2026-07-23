import test from "node:test";
import assert from "node:assert/strict";
import { createOwnerConfirmationLedger, OWNER_CONFIRMATION_LEDGER_SCHEMA_VERSION } from "../src/owner-confirmation-ledger.js";

function fakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (/DELETE FROM core_owner_confirmation_ledger/.test(sql)) {
        for (const [key, row] of rows) if (row.expires_at <= params[0]) rows.delete(key);
        return { rows: [] };
      }
      if (/INSERT INTO core_owner_confirmation_ledger/.test(sql)) {
        if (rows.has(params[0])) return { rows: [] };
        rows.set(params[0], { tenant_id: params[1], subject_digest: params[2], request_binding_digest: params[3], expires_at: params[5] });
        return { rows: [{ confirmation_digest: params[0] }] };
      }
      return { rows: [] };
    },
  };
}

test("ledger consumes atomically and stores only digests", async () => {
  const pool = fakePool();
  const ledger = createOwnerConfirmationLedger({ databaseUrl: "postgres://unused" }, { pool });
  const now = new Date("2026-01-01T00:00:00Z");
  const result = await ledger.consume({ tenantId: "codexai", subject: "owner-subject", reference: "private-reference", requestBinding: "tool\u0000args", now });
  assert.equal(result.schema_version, OWNER_CONFIRMATION_LEDGER_SCHEMA_VERSION);
  const row = [...pool.rows.values()][0];
  assert.equal(row.tenant_id, "codexai");
  assert.equal(row.subject_digest.length, 64);
  assert.equal(row.request_binding_digest.length, 64);
  assert.equal([...pool.rows.keys()][0].length, 64);
  assert.equal(JSON.stringify(row).includes("private-reference"), false);
  await assert.rejects(() => ledger.consume({ tenantId: "codexai", subject: "owner-subject", reference: "private-reference", requestBinding: "different", now }), /owner_confirmation_replayed/);
});

test("ledger rejects replay across tenant and supports TTL eviction", async () => {
  const pool = fakePool();
  const ledger = createOwnerConfirmationLedger({ databaseUrl: "postgres://unused" }, { pool });
  const start = new Date("2026-01-01T00:00:00Z");
  await ledger.consume({ tenantId: "codexai", subject: "subject-a", reference: "r", requestBinding: "b", now: start, ttlSeconds: 1 });
  await assert.rejects(() => ledger.consume({ tenantId: "other", subject: "subject-b", reference: "r", requestBinding: "b", now: start }), /owner_confirmation_replayed/);
  await ledger.consume({ tenantId: "other", subject: "subject-b", reference: "r", requestBinding: "b", now: new Date(start.getTime() + 2_000), ttlSeconds: 1 });
});

test("ledger is disabled without persistent database", () => {
  assert.equal(createOwnerConfirmationLedger({ databaseUrl: "" }), null);
});

test("one reference wins under concurrent consumers and survives authenticator restart", async () => {
  const pool = fakePool();
  const firstReplica = createOwnerConfirmationLedger({ databaseUrl: "postgres://unused" }, { pool });
  const restartedReplica = createOwnerConfirmationLedger({ databaseUrl: "postgres://unused" }, { pool });
  const request = { tenantId: "codexai", subject: "owner", reference: "concurrent", requestBinding: "tool\u0000args", now: new Date("2026-01-01T00:00:00Z") };
  const results = await Promise.allSettled([firstReplica.consume(request), restartedReplica.consume(request)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && /replayed/.test(result.reason.message)).length, 1);
});
