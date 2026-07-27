import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAudit } from "../src/audit.js";
import {
  createKeyStore,
  isMcpStagingServiceRecord,
} from "../src/keyStore.js";
import { createUniversalCoreService } from "../src/app.js";
import { DEFAULT_AUTOMATION_SCOPES } from "../src/scope.js";

function fixture() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-mcp-staging-key-"));
  return {
    storageRoot,
    store: createKeyStore(storageRoot, createAudit(storageRoot)),
  };
}

test("seeds one tenant-scoped MCP staging automation key without persisting plaintext", () => {
  const { storageRoot, store } = fixture();
  const secret = "staging-only-service-secret-0123456789";
  const first = store.ensureMcpStagingServiceKey({ secret });
  const second = store.ensureMcpStagingServiceKey({ secret });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(isMcpStagingServiceRecord(first.record), true);
  assert.equal(first.record.tenant_id, "codexai");
  assert.equal(first.record.key_type, "automation");
  assert.deepEqual(first.record.allowed_scopes, DEFAULT_AUTOMATION_SCOPES);
  assert.equal(first.record.metadata.bootstrap_kind, "mcp_staging_service");
  assert.equal(store.authenticate(secret).ok, true);

  const serialized = fs.readFileSync(path.join(storageRoot, "keys", "keys.json"), "utf8");
  assert.equal(serialized.includes(secret), false);
});

test("fails closed on secret reuse or implicit rotation", () => {
  const { store } = fixture();
  const existing = store.createKey({
    tenant_id: "codexai",
    key_type: "connector",
    allowed_scopes: [],
  });
  assert.throws(
    () => store.ensureMcpStagingServiceKey({ secret: existing.key }),
    /mcp_staging_service_key_conflict/,
  );

  store.ensureMcpStagingServiceKey({
    secret: "staging-only-service-secret-aaaaaaaa",
  });
  assert.throws(
    () => store.ensureMcpStagingServiceKey({
      secret: "staging-only-service-secret-bbbbbbbb",
    }),
    /mcp_staging_service_key_rotation_required/,
  );
  assert.throws(
    () => store.ensureMcpStagingServiceKey({}),
    /mcp_staging_service_key_required/,
  );
});

test("Universal Core seeds the configured MCP staging service key at startup", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-mcp-staging-app-"));
  const secret = "staging-only-service-secret-app-0123456789";
  createUniversalCoreService({
    storageRoot,
    mcpStagingServiceKey: secret,
  });
  const store = createKeyStore(storageRoot);
  const authenticated = store.authenticate(secret);
  assert.equal(authenticated.ok, true);
  assert.equal(isMcpStagingServiceRecord(authenticated.record), true);
});
