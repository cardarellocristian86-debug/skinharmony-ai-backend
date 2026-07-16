const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { JsonFileRepository } = require("../src/JsonFileRepository");
const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

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

async function testAtomicSnapshotsCommitOrRollbackTogether() {
  const committedCalls = [];
  let revision = 3;
  const committedClient = {
    query: async (sql) => {
      committedCalls.push(sql.trim().split(/\s+/)[0]);
      if (sql.includes("UPDATE smartdesk_collection_snapshots")) {
        revision += 1;
        return { rows: [{ revision }] };
      }
      return { rows: [] };
    },
    release: () => committedCalls.push("RELEASE")
  };
  const committedAdapter = new PostgresPersistenceAdapter("postgres://example", {
    poolFactory: () => ({ connect: async () => committedClient })
  });
  ["payments", "inventory", "inventory_movements"].forEach((name) => committedAdapter.revisions.set(name, 3));
  const revisions = await committedAdapter.writeCollectionsAtomically([
    { name: "payments", payload: [], expectedRevision: 3 },
    { name: "inventory_movements", payload: [], expectedRevision: 3 },
    { name: "inventory", payload: [], expectedRevision: 3 }
  ]);
  assert.strictEqual(revisions.size, 3);
  assert.ok(committedCalls.includes("BEGIN"));
  assert.ok(committedCalls.includes("COMMIT"));
  assert.ok(!committedCalls.includes("ROLLBACK"));

  const rollbackCalls = [];
  let updates = 0;
  const rollbackClient = {
    query: async (sql) => {
      rollbackCalls.push(sql.trim().split(/\s+/)[0]);
      if (sql.includes("UPDATE smartdesk_collection_snapshots")) {
        updates += 1;
        return { rows: updates === 2 ? [] : [{ revision: 4 }] };
      }
      return { rows: [] };
    },
    release: () => rollbackCalls.push("RELEASE")
  };
  const rollbackAdapter = new PostgresPersistenceAdapter("postgres://example", {
    poolFactory: () => ({ connect: async () => rollbackClient })
  });
  ["payments", "inventory", "inventory_movements"].forEach((name) => rollbackAdapter.revisions.set(name, 3));
  await assert.rejects(
    rollbackAdapter.writeCollectionsAtomically([
      { name: "payments", payload: [], expectedRevision: 3 },
      { name: "inventory", payload: [], expectedRevision: 3 },
      { name: "inventory_movements", payload: [], expectedRevision: 3 }
    ]),
    (error) => error.code === "persistence_conflict"
  );
  assert.ok(rollbackCalls.includes("ROLLBACK"));
  assert.strictEqual(rollbackAdapter.getRevision("payments"), 3);
}

async function testPaymentWithRepeatedInventoryLineUsesOneAtomicSnapshotSet() {
  const fakeRepository = (items, collectionName) => ({
    collectionName,
    revision: 1,
    items,
    list() { return this.items; },
    write(next) { this.items = next; }
  });
  const payments = fakeRepository([], "payments");
  const movements = fakeRepository([], "inventory_movements");
  const inventory = fakeRepository([{ id: "item-1", centerId: "center-a", quantity: 10, stockQuantity: 10 }], "inventory");
  const service = Object.create(DesktopMirrorService.prototype);
  service.persistenceAdapter = null;
  service.paymentsRepository = payments;
  service.inventoryMovementsRepository = movements;
  service.inventoryRepository = inventory;
  service.findExistingByIdempotency = () => null;
  service.findByIdInCenter = (repository, id) => repository.list().find((item) => item.id === id) || null;
  service.getCenterId = () => "center-a";
  service.getCenterName = () => "Center A";
  service.belongsToCenter = (item, centerId) => item.centerId === centerId;
  service.invalidateBusinessSnapshot = () => undefined;
  service.dirtyBlocksForRepository = () => [];
  service.applyGoldStateEvent = () => undefined;
  await service.createPayment({
    walkInName: "Cliente test",
    amountCents: 1200,
    productSales: [
      { itemId: "item-1", quantity: 2, salePriceCents: 400 },
      { itemId: "item-1", quantity: 3, salePriceCents: 200 }
    ]
  }, { centerId: "center-a", centerName: "Center A" });
  assert.strictEqual(payments.list().length, 1);
  assert.strictEqual(movements.list().length, 2);
  assert.strictEqual(inventory.list()[0].quantity, 5);
  assert.strictEqual(inventory.list()[0].stockQuantity, 5);
}

async function main() {
  await testRepositoryDoesNotWriteLocallyWhenDatabaseFails();
  await testRepositoryCommitsAfterDatabaseConfirmation();
  await testAdapterDistinguishesConflictAndOutage();
  await testAtomicSnapshotsCommitOrRollbackTogether();
  await testPaymentWithRepeatedInventoryLineUsesOneAtomicSnapshotSet();
  console.log("persistence P0 tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
