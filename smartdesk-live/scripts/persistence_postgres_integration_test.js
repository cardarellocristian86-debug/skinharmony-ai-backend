"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { JsonFileRepository } = require("../src/JsonFileRepository");
const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");

const databaseUrl = String(process.env.SMARTDESK_TEST_DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("SMARTDESK_TEST_DATABASE_URL is required");

async function tracked(adapter, callback) {
  return adapter.runWithWriteTracking(async (context) => {
    try {
      await callback();
      return await adapter.flushTrackedWrites(context);
    } finally {
      adapter.releaseTrackedWrites(context);
    }
  });
}

async function main() {
  const tenantId = `smartdesk_ci_${crypto.randomUUID()}`;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-postgres-"));
  const firstDir = path.join(sandbox, "first");
  const secondDir = path.join(sandbox, "second");
  fs.mkdirSync(firstDir, { recursive: true });
  fs.mkdirSync(secondDir, { recursive: true });
  const collectionDefinitions = (directory) => [
    { name: "primary_records", filePath: path.join(directory, "primary.json"), defaultValue: [] },
    { name: "derived_records", filePath: path.join(directory, "derived.json"), defaultValue: [] }
  ];
  const first = new PostgresPersistenceAdapter(databaseUrl, { tenantId });
  const second = new PostgresPersistenceAdapter(databaseUrl, { tenantId });
  try {
    await first.init(collectionDefinitions(firstDir));
    const primary = new JsonFileRepository(path.join(firstDir, "primary.json"), [], {
      adapter: first,
      collectionName: "primary_records",
      revision: first.getRevision("primary_records")
    });
    const derived = new JsonFileRepository(path.join(firstDir, "derived.json"), [], {
      adapter: first,
      collectionName: "derived_records",
      revision: first.getRevision("derived_records")
    });
    await tracked(first, async () => {
      await primary.createDurable({ id: "primary-1", value: 1 });
      derived.create({ id: "derived-1", primaryId: "primary-1" });
    });

    await second.init(collectionDefinitions(secondDir));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(secondDir, "primary.json"), "utf8")), [
      { id: "primary-1", value: 1 }
    ]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(secondDir, "derived.json"), "utf8")), [
      { id: "derived-1", primaryId: "primary-1" }
    ]);

    const stalePrimary = new JsonFileRepository(path.join(secondDir, "primary.json"), [], {
      adapter: second,
      collectionName: "primary_records",
      revision: second.getRevision("primary_records")
    });
    await tracked(first, async () => {
      await primary.updateDurable("primary-1", (record) => ({ ...record, value: 2 }));
    });
    await assert.rejects(
      () => tracked(second, async () => {
        await stalePrimary.updateDurable("primary-1", (record) => ({ ...record, value: 99 }));
      }),
      (error) => error.code === "persistence_sync_failed"
    );
    assert.equal(stalePrimary.findById("primary-1").value, 1);
    const authoritative = await first.readCollection("primary_records");
    assert.equal(authoritative.payload[0].value, 2);
    assert.equal((await first.probeHealth()).databaseReachable, true);

    console.log(JSON.stringify({
      ok: true,
      suite: "smartdesk_postgres_integration",
      assertions: {
        primaryAndDerivedCommitAtomically: true,
        restartReadbackMatchesDatabase: true,
        staleRevisionRejectedWithoutLocalLeak: true,
        databaseProbeVerified: true
      }
    }, null, 2));
  } finally {
    const pool = first.createPool();
    await pool.query("DELETE FROM smartdesk_collection_snapshots WHERE tenant_id = $1", [tenantId]);
    await Promise.allSettled([first.pool?.end?.(), second.pool?.end?.()]);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
