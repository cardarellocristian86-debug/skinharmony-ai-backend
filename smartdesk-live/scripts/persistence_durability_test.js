const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { JsonFileRepository } = require("../src/JsonFileRepository");
const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runTracked(adapter, callback) {
  return adapter.runWithWriteTracking(async (context) => {
    await callback(context);
    return adapter.flushTrackedWrites(context);
  });
}

async function main() {
  const sandboxDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-persistence-"));
  const filePath = path.join(sandboxDirectory, "records.json");
  const databaseWrites = [];
  const adapter = new PostgresPersistenceAdapter("postgres://smartdesk-local-sandbox");
  adapter.pool = {
    query: async (_sql, parameters) => {
      await delay(4);
      databaseWrites.push({
        collection: parameters[0],
        payload: JSON.parse(parameters[1])
      });
      return { rows: [] };
    }
  };

  try {
    const repository = new JsonFileRepository(filePath, [], {
      adapter,
      collectionName: "sandbox_records"
    });

    const successfulResults = await runTracked(adapter, async () => {
      repository.create({ id: "record-1", value: 1 });
      repository.update("record-1", (record) => ({ ...record, value: 2 }));
    });

    assert.equal(successfulResults.length, 2);
    assert.ok(successfulResults.every((result) => result.ok));
    assert.deepEqual(databaseWrites.map((write) => write.payload[0].value), [1, 2]);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), [
      { id: "record-1", value: 2 }
    ]);
    assert.equal(adapter.getPersistenceStatus().pendingWrites, 0);
    assert.equal(adapter.getPersistenceStatus().healthy, true);

    const fileBeforeSimulatedRenameFailure = fs.readFileSync(filePath, "utf8");
    const originalRenameSync = fs.renameSync;
    fs.renameSync = (source, destination) => {
      if (destination === filePath) {
        throw new Error("simulated_atomic_rename_failure");
      }
      return originalRenameSync(source, destination);
    };
    try {
      assert.throws(
        () => repository.write([{ id: "record-1", value: 99 }]),
        /simulated_atomic_rename_failure/
      );
    } finally {
      fs.renameSync = originalRenameSync;
    }
    assert.equal(fs.readFileSync(filePath, "utf8"), fileBeforeSimulatedRenameFailure);
    assert.equal(
      fs.readdirSync(sandboxDirectory).filter((name) => name.endsWith(".tmp")).length,
      0
    );

    adapter.pool = {
      query: async () => {
        throw new Error("simulated_database_outage_private_detail");
      }
    };
    await assert.rejects(
      () => runTracked(adapter, async () => {
        repository.update("record-1", (record) => ({ ...record, value: 3 }));
      }),
      (error) => {
        assert.equal(error.code, "persistence_sync_failed");
        assert.equal(error.message.includes("private_detail"), false);
        return true;
      }
    );
    assert.equal(adapter.getPersistenceStatus().healthy, false);
    assert.equal(adapter.getPersistenceStatus().pendingWrites, 0);

    adapter.pool = {
      query: async () => ({ rows: [] })
    };
    await runTracked(adapter, async () => {
      void adapter.enqueueWrite("another_collection", [{ id: "other" }]);
    });
    assert.equal(adapter.getPersistenceStatus().healthy, false);
    await runTracked(adapter, async () => {
      repository.update("record-1", (record) => ({ ...record, value: 4 }));
    });
    assert.equal(adapter.getPersistenceStatus().healthy, true);

    const atomicOnlyPath = path.join(sandboxDirectory, "atomic-benchmark.json");
    const atomicRepository = new JsonFileRepository(atomicOnlyPath, []);
    const startedAt = performance.now();
    for (let index = 0; index < 50; index += 1) {
      atomicRepository.write([{ id: `benchmark-${index}`, value: index }]);
    }
    const atomicWriteDurationMs = Number((performance.now() - startedAt).toFixed(2));
    assert.deepEqual(JSON.parse(fs.readFileSync(atomicOnlyPath, "utf8")), [
      { id: "benchmark-49", value: 49 }
    ]);
    assert.equal(
      fs.readdirSync(sandboxDirectory).filter((name) => name.endsWith(".tmp")).length,
      0
    );

    console.log(JSON.stringify({
      ok: true,
      suite: "persistence_durability",
      assertions: {
        atomicReplacePreservesPreviousFileOnFailure: true,
        postgresWritesAreOrderedAndAwaitable: true,
        failedCommitIsReportedWithoutPrivateErrorDetail: true,
        unrelatedSuccessDoesNotHideFailedCollection: true,
        adapterCanRecoverAfterFailure: true,
        temporaryFilesAreCleaned: true
      },
      performance: {
        atomicWrites: 50,
        durationMs: atomicWriteDurationMs,
        averageMs: Number((atomicWriteDurationMs / 50).toFixed(3))
      }
    }, null, 2));
  } finally {
    fs.rmSync(sandboxDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "persistence_durability_test_failed");
  process.exitCode = 1;
});
