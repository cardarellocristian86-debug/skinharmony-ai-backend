import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCoreJoinPostgresStore,
  createCoreJoinSigner,
} from "../src/coreJoinPostgresStore.js";
import { buildIcfGenericWorkCoreJoinReadiness } from "../src/icfRuntimeFacade.js";
import { createUniversalCoreService } from "../src/app.js";

const secret = "generic-join-test-signing-material-32-bytes";

function tenantContextHeader(tenantId, signingSecret) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  const canonical = JSON.stringify(context);
  const assertion = `mtc_${crypto.createHmac("sha256", signingSecret)
    .update(`mcp-tenant-context\u0000${canonical}`)
    .digest("hex")}`;
  return Buffer.from(JSON.stringify({ ...context, assertion })).toString("base64url");
}

test("ICF Generic Join readiness fails closed when signer is absent", () => {
  const store = createCoreJoinPostgresStore({
    pool: { async query() {} },
    signer: createCoreJoinSigner(),
  });

  assert.deepEqual(buildIcfGenericWorkCoreJoinReadiness(store), {
    enabled: false,
    state: "signer_unavailable",
    ready: false,
    backend: "postgres_append_only_v1",
    restart_durable: true,
    distributed: true,
    signer_mode: "hmac_icf",
    signer_state: "unconfigured",
    signer_configured: false,
    reason: "generic_work_core_join_signer_unconfigured",
  });
});

test("ICF Generic Join readiness fails closed when ledger is absent", () => {
  const store = createCoreJoinPostgresStore({
    signer: createCoreJoinSigner({ secret }),
  });

  assert.deepEqual(buildIcfGenericWorkCoreJoinReadiness(store), {
    enabled: false,
    state: "unavailable",
    ready: false,
    backend: "unavailable",
    restart_durable: false,
    distributed: false,
    signer_mode: "hmac_icf",
    signer_state: "configured",
    signer_configured: true,
    reason: "generic_work_core_join_postgres_unavailable",
  });
});

test("ICF Generic Join attests a PostgreSQL-ready durable distributed ledger", async () => {
  const statements = [];
  const store = createCoreJoinPostgresStore({
    pool: { async query(statement) { statements.push(statement); } },
    signer: createCoreJoinSigner({ secret }),
  });

  assert.equal(buildIcfGenericWorkCoreJoinReadiness(store).ready, false);
  await store.initialize();
  const readiness = buildIcfGenericWorkCoreJoinReadiness(store);
  assert.equal(statements.length, 1);
  assert.equal(readiness.enabled, true);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.state, "ready");
  assert.equal(readiness.backend, "postgres_append_only_v1");
  assert.equal(readiness.restart_durable, true);
  assert.equal(readiness.distributed, true);
  assert.equal(readiness.signer_mode, "hmac_icf");
  assert.equal(readiness.signer_state, "configured");
  assert.equal(readiness.reason, null);
});

test("ICF Generic Join restart durability and distributed state are mandatory", () => {
  const base = {
    kind: "postgres_append_only_v1",
    ready: true,
    initialized: true,
    initialization_state: "ready",
    signer_configured: true,
    restart_durable: true,
    distributed: true,
  };
  const durability = buildIcfGenericWorkCoreJoinReadiness({
    ...base,
    restart_durable: false,
  });
  assert.equal(durability.ready, false);
  assert.equal(durability.reason, "generic_work_core_join_durable_store_unavailable");

  const distributed = buildIcfGenericWorkCoreJoinReadiness({
    ...base,
    distributed: false,
  });
  assert.equal(distributed.ready, false);
  assert.equal(distributed.reason, "generic_work_core_join_distributed_store_unavailable");
});

test("ICF Generic Join latches a migration failure and never reports ready", async () => {
  const store = createCoreJoinPostgresStore({
    pool: { async query() { throw new Error("relation creation denied"); } },
    signer: createCoreJoinSigner({ secret }),
  });

  await assert.rejects(() => store.initialize(), /relation creation denied/);
  const readiness = buildIcfGenericWorkCoreJoinReadiness(store);
  assert.equal(readiness.enabled, false);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.state, "failed");
  assert.equal(readiness.reason, "generic_work_core_join_migration_unavailable");
});

test("authenticated ICF runtime attestation exposes only non-secret HMAC readiness", async () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "icf-join-attestation-"));
  const gatewayKey = "test-icf-attestation-gateway-key-32-bytes";
  const contextSecret = "test-icf-attestation-context-secret-32-bytes";
  const coreJoinStore = {
    kind: "postgres_append_only_v1",
    ready: true,
    initialized: true,
    initialization_state: "ready",
    restart_durable: true,
    distributed: true,
    signer_configured: true,
  };
  const icfStore = {
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    async initialize() {},
    async loadWork() {},
    async appendEvent() {},
    async compareAndSwapHead() {},
  };
  const service = createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: gatewayKey,
    tenantContextSigningSecret: contextSecret,
    coreJoinStore,
    icfStore,
  });
  const server = http.createServer(service.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/icf/runtime/attestation`;
  try {
    const unauthenticated = await fetch(url);
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        "x-sh-tenant-id": "tenant-a",
        "x-sh-tenant-context": tenantContextHeader("tenant-a", contextSecret),
      },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.schema, "nyra.icf.runtime-attestation/1.0");
    assert.deepEqual(body.generic_work_core_join, {
      enabled: true,
      state: "ready",
      ready: true,
      backend: "postgres_append_only_v1",
      restart_durable: true,
      distributed: true,
      signer_mode: "hmac_icf",
      signer_state: "configured",
      signer_configured: true,
      reason: null,
    });
    assert.equal(JSON.stringify(body).includes(gatewayKey), false);
    assert.equal(JSON.stringify(body).includes(contextSecret), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await service.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});
