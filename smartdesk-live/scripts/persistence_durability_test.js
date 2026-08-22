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
    try {
      await callback(context);
      return await adapter.flushTrackedWrites(context);
    } finally {
      adapter.releaseTrackedWrites(context);
    }
  });
}

function transactionalPool(query) {
  return {
    query,
    connect: async () => ({ query, release: () => undefined })
  };
}

async function main() {
  const sslCases = [
    ["postgresql://localhost:5432/smartdesk", false],
    ["postgresql://user:pass@127.0.0.1:5432/smartdesk", false],
    ["postgresql://[::1]:5432/smartdesk", false],
    ["postgresql://localhost.evil.test:5432/smartdesk", { rejectUnauthorized: false }],
    ["postgresql://user@localhost:5432@evil.example/smartdesk", { rejectUnauthorized: false }],
    ["postgresql://user@127.0.0.1:5432@evil.example/smartdesk", { rejectUnauthorized: false }],
    ["postgresql://user@[::1]:5432@evil.example/smartdesk", { rejectUnauthorized: false }],
    ["postgresql://db.example.test:5432/smartdesk", { rejectUnauthorized: false }]
  ];
  for (const [databaseUrl, expectedSsl] of sslCases) {
    const sslAdapter = new PostgresPersistenceAdapter(databaseUrl);
    const sslPool = sslAdapter.createPool();
    assert.deepEqual(sslPool.options.ssl, expectedSsl);
    await sslPool.end();
  }

  const sandboxDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-persistence-"));
  const filePath = path.join(sandboxDirectory, "records.json");
  const databaseWrites = [];
  const adapter = new PostgresPersistenceAdapter("postgres://smartdesk-local-sandbox");
  adapter.revisions.set("sandbox_records", 1);
  adapter.revisions.set("another_collection", 1);
  let revision = 1;
  adapter.pool = transactionalPool(async (sql, parameters) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(String(sql).trim())) return { rows: [] };
      await delay(4);
      databaseWrites.push({
        collection: parameters[2],
        payload: JSON.parse(parameters[0])
      });
      revision += 1;
      return { rows: [{ revision }] };
    });

  try {
    const repository = new JsonFileRepository(filePath, [], {
      adapter,
      collectionName: "sandbox_records"
    });

    const successfulResults = await runTracked(adapter, async () => {
      repository.create({ id: "record-1", value: 1 });
      repository.update("record-1", (record) => ({ ...record, value: 2 }));
    });

    assert.equal(successfulResults.length, 1);
    assert.ok(successfulResults.every((result) => result.ok));
    assert.deepEqual(databaseWrites.map((write) => write.payload[0].value), [2]);
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

    adapter.pool = transactionalPool(async (sql) => {
      if (/^ROLLBACK/.test(String(sql).trim())) return { rows: [] };
        throw new Error("simulated_database_outage_private_detail");
      });
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
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), [
      { id: "record-1", value: 2 }
    ]);
    assert.equal(adapter.getPersistenceStatus().healthy, false);
    assert.equal(adapter.getPersistenceStatus().pendingWrites, 0);

    adapter.pool = transactionalPool(async (sql) => (
      /^(BEGIN|COMMIT|ROLLBACK)/.test(String(sql).trim())
        ? { rows: [] }
        : { rows: [{ revision: revision += 1 }] }
    ));
    await runTracked(adapter, async () => {
      void adapter.enqueueWrite("another_collection", [{ id: "other" }]);
    });
    assert.equal(adapter.getPersistenceStatus().healthy, false);
    await runTracked(adapter, async () => {
      repository.update("record-1", (record) => ({ ...record, value: 4 }));
    });
    assert.equal(adapter.getPersistenceStatus().healthy, true);

    const derivedFilePath = path.join(sandboxDirectory, "derived.json");
    const derivedRepository = new JsonFileRepository(derivedFilePath, [], {
      adapter,
      collectionName: "derived_records"
    });
    derivedRepository.ensureFile();
    adapter.revisions.set("derived_records", 1);
    const primaryBeforeDerivedFailure = fs.readFileSync(filePath, "utf8");
    const derivedBeforeFailure = fs.readFileSync(derivedFilePath, "utf8");
    const transactionEvents = [];
    let transactionalUpdates = 0;
    adapter.pool = transactionalPool(async (sql) => {
      const operation = String(sql).trim().split(/\s+/)[0];
      transactionEvents.push(operation);
      if (operation === "UPDATE") {
        transactionalUpdates += 1;
        if (transactionalUpdates === 2) throw new Error("simulated_derived_write_failure");
        return { rows: [{ revision: 2 }] };
      }
      return { rows: [] };
    });
    await assert.rejects(
      () => runTracked(adapter, async () => {
        await repository.createDurable({ id: "primary-after", value: 5 });
        derivedRepository.create({ id: "derived-after", primaryId: "primary-after" });
      }),
      (error) => error.code === "persistence_sync_failed"
    );
    assert.equal(fs.readFileSync(filePath, "utf8"), primaryBeforeDerivedFailure);
    assert.equal(fs.readFileSync(derivedFilePath, "utf8"), derivedBeforeFailure);
    assert(transactionEvents.includes("ROLLBACK"));

    adapter.pool = transactionalPool(async (sql) => (
      /^(BEGIN|COMMIT|ROLLBACK)/.test(String(sql).trim())
        ? { rows: [] }
        : { rows: [{ revision: revision += 1 }] }
    ));
    await Promise.all([
      runTracked(adapter, async () => {
        await repository.updateDurable("record-1", (record) => ({ ...record, value: record.value + 1 }));
      }),
      runTracked(adapter, async () => {
        await repository.updateDurable("record-1", (record) => ({ ...record, value: record.value + 1 }));
      })
    ]);
    assert.equal(repository.findById("record-1").value, 6);

    const abortFilePath = path.join(sandboxDirectory, "abort-race.json");
    const abortAdapter = new PostgresPersistenceAdapter("postgres://smartdesk-abort-race");
    abortAdapter.revisions.set("abort_records", 1);
    const abortRepository = new JsonFileRepository(abortFilePath, [], {
      adapter: abortAdapter,
      collectionName: "abort_records"
    });
    abortRepository.ensureFile();
    let unblockFirstTransaction;
    let signalFirstUpdate;
    const firstUpdateReached = new Promise((resolve) => { signalFirstUpdate = resolve; });
    const firstBlocked = new Promise((resolve) => { unblockFirstTransaction = resolve; });
    abortAdapter.pool = transactionalPool(async (sql) => {
      const operation = String(sql).trim().split(/\s+/)[0];
      if (operation === "UPDATE") {
        signalFirstUpdate();
        await firstBlocked;
        throw new Error("simulated_client_abort_transaction_failure");
      }
      return { rows: [] };
    });
    let firstContext;
    const firstMutation = abortAdapter.runWithWriteTracking(async (context) => {
      firstContext = context;
      try {
        await abortRepository.createDurable({ id: "aborted", value: 1 });
        await abortAdapter.flushTrackedWrites(context);
      } catch (error) {
        abortAdapter.pool = transactionalPool(async (sql) => (
          /^(BEGIN|COMMIT|ROLLBACK)/.test(String(sql).trim())
            ? { rows: [] }
            : { rows: [{ revision: 2 }] }
        ));
        throw error;
      } finally {
        abortAdapter.releaseTrackedWrites(context);
      }
    });
    await firstUpdateReached;
    assert.equal(abortAdapter.releaseTrackedWrites(firstContext), false);
    let secondEntered = false;
    const secondMutation = runTracked(abortAdapter, async () => {
      secondEntered = true;
      await abortRepository.createDurable({ id: "second", value: 2 });
    });
    await delay(10);
    assert.equal(secondEntered, false);
    unblockFirstTransaction();
    await assert.rejects(firstMutation, (error) => error.code === "persistence_sync_failed");
    await secondMutation;
    assert.deepEqual(abortRepository.list(), [{ id: "second", value: 2 }]);

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
        failedCommitRollsBackLocalMirror: true,
        primaryAndDerivedWritesShareOneTransaction: true,
        concurrentMutationsAreSerializedWithoutLostUpdate: true,
        sharedCollectionMutationsUseOneCasLock: true,
        clientAbortCannotReleaseInFlightTransactionLock: true,
        unrelatedSuccessDoesNotHideFailedCollection: true,
        adapterCanRecoverAfterFailure: true,
        temporaryFilesAreCleaned: true,
        loopbackSslPolicyIsExact: true
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
