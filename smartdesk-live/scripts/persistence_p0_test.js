const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { JsonFileRepository } = require("../src/JsonFileRepository");
const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");
const { GoldOnboardingEngine } = require("../src/GoldOnboardingEngine");

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

function makeInventoryMovementService({ commitRepositorySnapshots } = {}) {
  const inventory = makeGoldRepository([{ id: "item-1", centerId: "center-a", quantity: 10, stockQuantity: 10 }], "inventory");
  const movements = makeGoldRepository([], "inventory_movements");
  const service = Object.create(DesktopMirrorService.prototype);
  service.inventoryRepository = inventory;
  service.inventoryMovementsRepository = movements;
  service.getCenterId = () => "center-a";
  service.getCenterName = () => "Center A";
  service.belongsToCenter = (item, centerId) => item.centerId === centerId;
  service.findByIdInCenter = (repository, id) => repository.list().find((item) => item.id === id && item.centerId === "center-a") || null;
  service.invalidateBusinessSnapshot = () => undefined;
  service.dirtyBlocksForRepository = () => [];
  service.commitRepositorySnapshots = commitRepositorySnapshots || (async (changes) => {
    changes.forEach(({ repository, payload }) => repository.write(payload));
  });
  return { service, inventory, movements };
}

async function testManualInventoryMovementCommitsAtomically() {
  const { service, inventory, movements } = makeInventoryMovementService();
  const movement = await service.createInventoryMovement({ itemId: "item-1", type: "unload", quantity: 3 }, { centerId: "center-a" });
  assert.strictEqual(movement.type, "unload");
  assert.strictEqual(movements.list().length, 1);
  assert.strictEqual(inventory.list()[0].quantity, 7);
  assert.strictEqual(inventory.list()[0].stockQuantity, 7);
}

async function testManualInventoryMovementDoesNotMutateWhenCommitFails() {
  const { service, inventory, movements } = makeInventoryMovementService({
    commitRepositorySnapshots: async () => { throw new Error("simulated inventory transaction rollback"); }
  });
  await assert.rejects(
    service.createInventoryMovement({ itemId: "item-1", type: "unload", quantity: 3 }, { centerId: "center-a" }),
    /rollback/
  );
  assert.strictEqual(movements.list().length, 0);
  assert.strictEqual(inventory.list()[0].quantity, 10);
  assert.strictEqual(inventory.list()[0].stockQuantity, 10);
}

function makeDurableAppointmentRepository(items = [], failure = null) {
  return {
    collectionName: "appointments",
    revision: 1,
    items,
    list() { return this.items; },
    findById(id) { return this.items.find((item) => item.id === id) || null; },
    async createDurable(item) {
      if (failure) throw failure;
      this.items = [item, ...this.items];
      return item;
    },
    async updateDurable(id, updater) {
      if (failure) throw failure;
      const index = this.items.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const updated = updater(this.items[index]);
      this.items = this.items.map((item, currentIndex) => currentIndex === index ? updated : item);
      return updated;
    },
    async deleteDurable(id) {
      if (failure) throw failure;
      const next = this.items.filter((item) => item.id !== id);
      const removed = next.length !== this.items.length;
      this.items = next;
      return removed;
    }
  };
}

function makeAppointmentService(repository) {
  const service = Object.create(DesktopMirrorService.prototype);
  service.appointmentsRepository = repository;
  service.getCenterId = () => "center-a";
  service.getCenterName = () => "Center A";
  service.belongsToCenter = (item, centerId) => item.centerId === centerId;
  service.filterByCenter = (items) => items.filter((item) => item.centerId === "center-a");
  service.findExistingByIdempotency = () => null;
  service.findByIdInCenter = (repo, id) => repo.list().find((item) => item.id === id && item.centerId === "center-a") || null;
  service.invalidateAppointmentsDayCache = () => undefined;
  service.invalidateBusinessSnapshot = () => undefined;
  service.dirtyBlocksForRepository = () => [];
  service.applyGoldStateEvent = () => undefined;
  return service;
}

async function testAppointmentWritesAreDurableBeforeCacheInvalidation() {
  const repository = makeDurableAppointmentRepository();
  const service = makeAppointmentService(repository);
  const appointment = await service.saveAppointment({
    clientName: "Cliente test",
    startAt: "2026-07-16T09:00:00.000Z",
    durationMin: 45,
    staffName: "Operatrice",
    serviceName: "Trattamento"
  }, { centerId: "center-a" });
  assert.strictEqual(repository.list().length, 1);
  assert.strictEqual(appointment.centerId, "center-a");
  const deleted = await service.deleteAppointment(appointment.id, { centerId: "center-a" });
  assert.deepStrictEqual(deleted, { success: true });
  assert.strictEqual(repository.list().length, 0);
}

async function testAppointmentFailureDoesNotMutateRepository() {
  const failure = new Error("simulated appointment persistence outage");
  failure.code = "persistence_unavailable";
  const repository = makeDurableAppointmentRepository([], failure);
  const service = makeAppointmentService(repository);
  await assert.rejects(service.saveAppointment({
    clientName: "Cliente test",
    startAt: "2026-07-16T09:00:00.000Z",
    durationMin: 45,
    staffName: "Operatrice",
    serviceName: "Trattamento"
  }, { centerId: "center-a" }), (error) => error.code === "persistence_unavailable");
  assert.strictEqual(repository.list().length, 0);
}

function makeDurableRepository(items = [], collectionName = "catalog", failure = null) {
  return {
    collectionName,
    revision: 1,
    items,
    list() { return this.items; },
    findById(id) { return this.items.find((item) => item.id === id) || null; },
    async createDurable(item) {
      if (failure) throw failure;
      this.items = [item, ...this.items];
      return item;
    },
    async updateDurable(id, updater) {
      if (failure) throw failure;
      const index = this.items.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const updated = updater(this.items[index]);
      this.items = this.items.map((item, currentIndex) => currentIndex === index ? updated : item);
      return updated;
    },
    async deleteDurable(id) {
      if (failure) throw failure;
      const next = this.items.filter((item) => item.id !== id);
      const removed = next.length !== this.items.length;
      this.items = next;
      return removed;
    }
  };
}

function makeCatalogService(repository, field) {
  const service = Object.create(DesktopMirrorService.prototype);
  service[field] = repository;
  service.getCenterId = () => "center-a";
  service.getCenterName = () => "Center A";
  service.belongsToCenter = (item, centerId) => item.centerId === centerId;
  service.filterByCenter = (items) => items.filter((item) => item.centerId === "center-a");
  service.findExistingByIdempotency = () => null;
  service.findByIdInCenter = (repo, id) => repo.list().find((item) => item.id === id && item.centerId === "center-a") || null;
  service.invalidateBusinessSnapshot = () => undefined;
  service.dirtyBlocksForRepository = () => [];
  service.applyGoldStateEvent = () => undefined;
  return service;
}

async function testServiceCatalogWritesAreDurable() {
  const repository = makeDurableRepository([], "services");
  const service = makeCatalogService(repository, "servicesRepository");
  const created = await service.saveService({ name: "Servizio test", durationMin: 45, priceCents: 1000 }, { centerId: "center-a" });
  assert.strictEqual(repository.list().length, 1);
  const updated = await service.saveService({ id: created.id, name: "Servizio aggiornato", durationMin: 60, priceCents: 1200 }, { centerId: "center-a" });
  assert.strictEqual(updated.name, "Servizio aggiornato");
  assert.deepStrictEqual(await service.deleteService(created.id, { centerId: "center-a" }), { success: true });
  assert.strictEqual(repository.list().length, 0);
}

async function testCatalogFailureDoesNotMutateRepository() {
  const failure = new Error("simulated catalog persistence outage");
  failure.code = "persistence_unavailable";
  const repository = makeDurableRepository([], "services", failure);
  const service = makeCatalogService(repository, "servicesRepository");
  await assert.rejects(
    service.saveService({ name: "Servizio test", durationMin: 45, priceCents: 1000 }, { centerId: "center-a" }),
    (error) => error.code === "persistence_unavailable"
  );
  assert.strictEqual(repository.list().length, 0);
}

function makeGoldRepository(items, collectionName) {
  return {
    collectionName,
    revision: 1,
    items,
    list() { return this.items; },
    findById(id) { return this.items.find((item) => String(item.id) === String(id)) || null; },
    write(next) { this.items = next; }
  };
}

function makeGoldImportRecord() {
  return {
    id: "gold-import-1",
    centerId: "center-a",
    status: "analyzed",
    importHash: "fixture-hash",
    snapshots: {
      import_customers_snapshot: { validRows: [{ id: "customer-1", normalized: { name: "Alice Rossi", email: "alice@example.test", phone: "+393331234567", privacyConsent: true, sensitiveDataConsent: true, marketingConsent: true } }], reviewRows: [], invalidRows: [], duplicates: [] },
      import_appointments_snapshot: { validRows: [
        { id: "appointment-1", normalized: { clientName: "Alice Rossi", serviceName: "Trattamento", staffName: "Operatrice", startAt: "2026-07-16T09:00:00.000Z", endAt: "2026-07-16T10:00:00.000Z", durationMin: 60, status: "completed" } },
        { id: "appointment-duplicate", normalized: { clientName: "Alice Rossi", serviceName: "Trattamento", staffName: "Operatrice", startAt: "2026-07-16T09:00:00.000Z", durationMin: 60, status: "completed" } }
      ], reviewRows: [], invalidRows: [], duplicates: [] },
      import_payments_snapshot: { validRows: [
        { id: "payment-1", normalized: { walkInName: "Alice Rossi", amountCents: 5000, method: "card", createdAt: "2026-07-16T10:00:00.000Z" } },
        { id: "payment-duplicate", normalized: { walkInName: "Alice Rossi", amountCents: 5000, method: "card", createdAt: "2026-07-16T11:00:00.000Z" } }
      ], reviewRows: [], invalidRows: [], duplicates: [] }
    }
  };
}

async function testGoldConfirmPlansAndCommitsOneAtomicBatch() {
  const clients = makeGoldRepository([], "clients");
  const appointments = makeGoldRepository([], "appointments");
  const payments = makeGoldRepository([], "payments");
  const imports = makeGoldRepository([makeGoldImportRecord()], "gold_imports");
  let commits = 0;
  const service = {
    clientsRepository: clients,
    appointmentsRepository: appointments,
    paymentsRepository: payments,
    getCenterId: () => "center-a",
    getCenterName: () => "Center A",
    filterByCenter: (items) => items.filter((item) => item.centerId === "center-a"),
    commitRepositorySnapshots: async (changes) => {
      commits += 1;
      changes.forEach(({ repository, payload }) => repository.write(payload));
    },
    invalidateAppointmentsDayCache: () => undefined,
    invalidateBusinessSnapshot: () => undefined,
    dirtyBlocksForRepository: () => []
  };
  const engine = new GoldOnboardingEngine({ service, importRepository: imports });
  const result = await engine.confirm({ importId: "gold-import-1" }, { centerId: "center-a", centerName: "Center A" });
  assert.strictEqual(commits, 1);
  assert.deepStrictEqual(result.createdCounts, { customers: 1, appointments: 1, payments: 1 });
  assert.strictEqual(appointments.list().length, 1, "same-import duplicate appointment must be skipped");
  assert.strictEqual(payments.list().length, 1, "same-import duplicate payment must be skipped");
  assert.strictEqual(clients.list()[0].privacyConsent, true);
  assert.strictEqual(clients.list()[0].sensitiveDataConsent, true);
  assert.strictEqual(appointments.list()[0].endAt, "2026-07-16T10:00:00.000Z");
  assert.strictEqual(imports.list()[0].status, "imported");
  const replay = await engine.confirm({ importId: "gold-import-1" }, { centerId: "center-a", centerName: "Center A" });
  assert.strictEqual(replay.duplicateConfirm, true);
  assert.strictEqual(commits, 1, "idempotent replay must not write");
}

async function testGoldConfirmDoesNotMutateWhenAtomicCommitFails() {
  const clients = makeGoldRepository([], "clients");
  const appointments = makeGoldRepository([], "appointments");
  const payments = makeGoldRepository([], "payments");
  const imports = makeGoldRepository([makeGoldImportRecord()], "gold_imports");
  const service = {
    clientsRepository: clients,
    appointmentsRepository: appointments,
    paymentsRepository: payments,
    getCenterId: () => "center-a",
    getCenterName: () => "Center A",
    filterByCenter: (items) => items.filter((item) => item.centerId === "center-a"),
    commitRepositorySnapshots: async () => { throw new Error("simulated transaction rollback"); },
    invalidateAppointmentsDayCache: () => undefined,
    invalidateBusinessSnapshot: () => undefined,
    dirtyBlocksForRepository: () => []
  };
  const engine = new GoldOnboardingEngine({ service, importRepository: imports });
  await assert.rejects(engine.confirm({ importId: "gold-import-1" }, { centerId: "center-a" }), /rollback/);
  assert.strictEqual(clients.list().length, 0);
  assert.strictEqual(appointments.list().length, 0);
  assert.strictEqual(payments.list().length, 0);
  assert.strictEqual(imports.list()[0].status, "analyzed");
}

async function main() {
  await testRepositoryDoesNotWriteLocallyWhenDatabaseFails();
  await testRepositoryCommitsAfterDatabaseConfirmation();
  await testAdapterDistinguishesConflictAndOutage();
  await testAtomicSnapshotsCommitOrRollbackTogether();
  await testPaymentWithRepeatedInventoryLineUsesOneAtomicSnapshotSet();
  await testManualInventoryMovementCommitsAtomically();
  await testManualInventoryMovementDoesNotMutateWhenCommitFails();
  await testAppointmentWritesAreDurableBeforeCacheInvalidation();
  await testAppointmentFailureDoesNotMutateRepository();
  await testServiceCatalogWritesAreDurable();
  await testCatalogFailureDoesNotMutateRepository();
  await testGoldConfirmPlansAndCommitsOneAtomicBatch();
  await testGoldConfirmDoesNotMutateWhenAtomicCommitFails();
  console.log("persistence P0 tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
