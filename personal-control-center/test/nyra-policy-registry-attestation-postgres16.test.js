"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
let Pool = null;
try { ({ Pool } = require("pg")); } catch { /* reported as an explicit environment skip below */ }

const {
  createPostgresReplayStore,
} = require("../lib/nyra-policy-registry-attestation");

const DATABASE_URL = String(process.env.NYRA_POLICY_REGISTRY_DATABASE_URL || "").trim();
const PG16 = { skip: !Pool
  ? "PostgreSQL runtime dependency not installed"
  : DATABASE_URL ? false : "Nyra Policy Registry PostgreSQL URL not configured" };

test("PostgreSQL 16 replay is distributed, restart-durable and atomic", PG16, async () => {
  const tenantId = `nyra-policy-pg16-${process.pid}-${crypto.randomUUID()}`;
  const firstPool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  const secondPool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  let firstEnded = false;
  try {
    const version = await firstPool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16);
    const first = createPostgresReplayStore(firstPool);
    const second = createPostgresReplayStore(secondPool);
    await first.initialize();
    await second.initialize();
    const input = {
      tenantId,
      nonce: crypto.randomBytes(24).toString("base64url"),
      envelopeDigest: crypto.randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      response: { schema_version: "test", signature: crypto.randomBytes(64).toString("base64url") },
    };
    const [left, right] = await Promise.all([first.record(input), second.record(input)]);
    assert.deepEqual([left.idempotent_replay, right.idempotent_replay].sort(), [false, true]);
    assert.deepEqual(await second.lookup(input), input.response);
    await assert.rejects(second.lookup({ ...input, envelopeDigest: crypto.randomBytes(32).toString("hex") }),
      /nyra_policy_attestation_nonce_reused/);

    await firstPool.end();
    firstEnded = true;
    const restartedPool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    try {
      const restarted = createPostgresReplayStore(restartedPool);
      await restarted.initialize();
      assert.deepEqual(await restarted.lookup(input), input.response);
    } finally {
      await restartedPool.query("DELETE FROM nyra_policy_registry_attestation_replay WHERE tenant_id=$1", [tenantId]);
      await restartedPool.end();
    }
  } finally {
    if (!firstEnded) await firstPool.end();
    await secondPool.end();
  }
});
