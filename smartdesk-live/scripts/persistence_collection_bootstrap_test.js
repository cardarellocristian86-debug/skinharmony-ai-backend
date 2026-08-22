"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-bootstrap-contract-"));
  process.env.SMARTDESK_DATA_DIR = sandbox;
  const { DesktopMirrorService } = require("../src/DesktopMirrorService");
  const revisions = new Map();
  const writes = [];
  let initialized = [];
  const adapter = {
    init: async (definitions) => {
      initialized = definitions;
      definitions.forEach(({ name }) => revisions.set(name, 1));
      return revisions;
    },
    getRevision: (name) => revisions.get(name) || null,
    runWithWriteTracking: async (callback) => callback({}),
    flushTrackedWrites: async () => [],
    releaseTrackedWrites: () => true,
    trackLocalRollback: () => false,
    enqueueWrite: async (name, payload) => {
      writes.push({
        name,
        payload: JSON.parse(JSON.stringify(payload)),
        revision: revisions.get(name) || null
      });
      return { ok: true, collection: name };
    }
  };

  try {
    const service = new DesktopMirrorService({ persistenceAdapter: adapter });
    await service.init();
    const repositoryDefinitions = service.getPersistenceCollectionDefinitions();
    const repositoryNames = repositoryDefinitions.map(({ name }) => name).sort();
    const initializedNames = initialized.map(({ name }) => name).sort();
    assert.deepEqual(initializedNames, repositoryNames);
    assert.equal(new Set(initializedNames).size, initializedNames.length);
    assert(initializedNames.includes("control_room_audit"));
    assert.equal(service.controlAuditRepository.revision, 1);

    service.recordControlAuditEvent({
      session: { userId: "owner-1", username: "owner", role: "superadmin", centerId: "tenant-a" },
      action: "login_success",
      outcome: "success",
      reason: "login",
      targetTenantId: "tenant-a"
    });
    service.recordControlAuditEvent({
      actor: { username: "unknown" },
      action: "login_failed",
      outcome: "failed",
      reason: "invalid credentials"
    });
    await Promise.resolve();

    const auditWrites = writes.filter(({ name }) => name === "control_room_audit");
    assert.equal(auditWrites.length, 2);
    assert(auditWrites.every(({ revision }) => revision === 1));
    assert.deepEqual(
      auditWrites.map(({ payload }) => payload[0].action),
      ["login_success", "login_failed"]
    );

    const incompleteRevisions = new Map();
    const incompleteAdapter = {
      ...adapter,
      init: async (definitions) => {
        definitions
          .filter(({ name }) => name !== "control_room_audit")
          .forEach(({ name }) => incompleteRevisions.set(name, 1));
        return incompleteRevisions;
      },
      getRevision: (name) => incompleteRevisions.get(name) || null
    };
    const incompleteService = new DesktopMirrorService({ persistenceAdapter: incompleteAdapter });
    await assert.rejects(
      () => incompleteService.init(),
      (error) => {
        assert.equal(error.code, "persistence_revision_missing");
        assert.equal(error.bootstrapIncomplete, true);
        assert.deepEqual(error.failedCollections, ["control_room_audit"]);
        return true;
      }
    );

    console.log(JSON.stringify({
      ok: true,
      suite: "persistence_collection_bootstrap",
      assertions: {
        everyRepositoryIsBootstrapped: true,
        controlRoomAuditRevisionIsInitialized: true,
        successfulLoginAuditIsPersisted: true,
        failedLoginAuditIsPersisted: true,
        loginAuditNeverWritesWithMissingRevision: true,
        missingAuditRevisionBlocksStartup: true
      }
    }, null, 2));
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
