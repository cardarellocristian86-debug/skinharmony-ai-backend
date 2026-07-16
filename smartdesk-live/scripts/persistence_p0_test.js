const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { JsonFileRepository } = require("../src/JsonFileRepository");
const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");

async function withTempRepository(adapter, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-persistence-test-"));
  const filePath = path.join(directory, "clients.json");
  try {
    await run(new JsonFileRepository(filePath, [], { adapter, collectionName: "clients", revision: 1 }), filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function testRepositoryDoesNotWriteLocallyWhenDatabaseFails() {
  const adapter = {
    async writeCollection() {
      const error = new Error("database offline");
      error.code = "persistence_unavailable";
      throw error;
    }
  };
  await withTempRepository(adapter, async (repository) => {
    await assert.rejects(
      repository.createDurable({ id: "client-1", centerId: "center-a" }),
      (error) => error.code === "persistence_unavailable"
    );
    assert.deepStrictEqual(repository.list(), []);
  });
}

async function testRepositoryCommitsAfterDatabaseConfirmation() {
  const adapter = {
    async writeCollection(_collection, _payload, revision) {
      assert.strictEqual(revision, 1);
      return 2;
    }
  };
  await withTempRepository(adapter, async (repository) => {
    const created = await repository.createDurable({ id: "client-1", centerId: "center-a" });
    assert.strictEqual(created.id, "client-1");
    assert.strictEqual(repository.revision, 2);
    assert.deepStrictEqual(repository.list().map((item) => item.id), ["client-1"]);
  });
}

async function testAdapterDistinguishesConflictAndOutage() {
  const conflictAdapter = new PostgresPersistenceAdapter("postgres://example", {
    poolFactory: () => ({ query: async () => ({ rows: [] }) })
  });
  conflictAdapter.revisions.set("clients", 3);
  await assert.rejects(
    conflictAdapter.writeCollection("clients", [], 3),
    (error) => error.code === "persistence_conflict"
  );

  const unavailableAdapter = new PostgresPersistenceAdapter("postgres://example", {
    poolFactory: () => ({ query: async () => { throw new Error("network unavailable"); } })
  });
  unavailableAdapter.revisions.set("clients", 3);
  await assert.rejects(
    unavailableAdapter.writeCollection("clients", [], 3),
    (error) => error.code === "persistence_unavailable"
  );
}

async function main() {
  await testRepositoryDoesNotWriteLocallyWhenDatabaseFails();
  await testRepositoryCommitsAfterDatabaseConfirmation();
  await testAdapterDistinguishesConflictAndOutage();
  console.log("persistence P0 tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
