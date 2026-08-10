import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";
import { genericWorkCoreJoinDigest } from "../src/genericWorkCoreJoin.js";
import { createMemoryGenericWorkCoreJoinStore, createPostgresGenericWorkCoreJoinStore } from "../src/genericWorkCoreJoinStore.js";

const TENANT = "tenant-host-native";
const GATEWAY_KEY = "generic-work-core-join-mcp-key-0123456789";
const CONTEXT_SECRET = "generic-work-core-join-context-secret-0123456789";
const DTT_SECRET = "generic-work-core-join-dtt-secret-0123456789";
const HOST_SECRET = "generic-work-core-join-host-secret-0123456789";
const digest = (value) => genericWorkCoreJoinDigest({ value });
const KEYS = crypto.generateKeyPairSync("ed25519");
const PRIVATE_KEY = KEYS.privateKey.export({ type: "pkcs8", format: "pem" });
const PUBLIC_KEY = KEYS.publicKey.export({ type: "spki", format: "pem" });
const REMOTE_SIGNER_URL = "https://generic-work-core-join-signer.example/sign";
const REMOTE_SIGNER_HEALTH_URL = "https://generic-work-core-join-signer.example/health";
const REMOTE_SIGNER_REGISTRY = JSON.stringify({ schema_version: "generic_work_core_join_trust_registry_v1", revision: "generic-work-core-join-api-remote-v1", keys: { "generic-work-core-join-api-key": { status: "active", public_key: PUBLIC_KEY } } });

function tenantContext() {
  const issued_at = new Date().toISOString();
  const canonical = JSON.stringify({ version: "mcp_tenant_context_v1", tenant_id: TENANT, issued_at });
  return Buffer.from(JSON.stringify({ version: "mcp_tenant_context_v1", tenant_id: TENANT, issued_at, assertion: `mtc_${crypto.createHmac("sha256", CONTEXT_SECRET).update(`mcp-tenant-context\0${canonical}`).digest("hex")}` })).toString("base64url");
}
function body() {
  const acceptance_criteria = [{ criterion_id: "criterion-001", criterion_digest: digest("criterion"), evidence_digest: digest("criterion-evidence"), verification_digest: digest("criterion-verification") }];
  const task_state = [{ task_id: "task-001", completion_evidence_digest: digest("task-evidence"), task_state_digest: digest("task-state"), verification_digest: digest("task-verification") }];
  const evidence_digests = [digest("evidence-001")];
  const unsigned = { schema_version: "generic_work_independent_verifier_receipt_v1", tenant_id: TENANT, work_id: "work-001", adapter: "research", acceptance_criteria_digest: genericWorkCoreJoinDigest(acceptance_criteria), task_state_digest: genericWorkCoreJoinDigest(task_state), evidence_digest: genericWorkCoreJoinDigest([...evidence_digests].sort()), verification_digest: digest("verification"), verifier_identity: "verifier-001", session_id: "verifier-session-001", nonce: "nonce-001", issued_at: "2026-08-08T09:59:00.000Z", expires_at: "2099-08-08T10:05:00.000Z" };
  return { work_id: "work-001", adapter: "research", requester_identity: "builder-001", requester_session_id: "builder-session-001", idempotency_digest: digest("idem-001"), acceptance_criteria, task_state, evidence_digests, independent_verifier_receipt: { ...unsigned, signature: crypto.createHmac("sha256", DTT_SECRET).update(`generic_work_verifier_receipt_v1\0${genericWorkCoreJoinDigest(unsigned)}`).digest("base64url") } };
}
async function withService(options, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generic-work-join-api-"));
  const { app } = createUniversalCoreService({ storageRoot: root, mcpTenantGatewayKey: GATEWAY_KEY, tenantContextSigningSecret: CONTEXT_SECRET, dttAgentIdentitySigningSecret: DTT_SECRET, hostNativeSigningSecret: HOST_SECRET, genericWorkCoreJoinEd25519PrivateKey: PRIVATE_KEY, genericWorkCoreJoinEd25519KeyId: "generic-work-core-join-api-key", ...options });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = async (pathname, payload) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, { method: "POST", headers: { authorization: `Bearer ${GATEWAY_KEY}`, "content-type": "application/json", "x-sh-tenant-id": TENANT, "x-sh-tenant-context": tenantContext() }, body: JSON.stringify(payload) });
    return { status: response.status, json: await response.json() };
  };
  const health = async () => (await fetch(`http://127.0.0.1:${server.address().port}/healthz`)).json();
  try { await run(request, health); } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
}

test("canonical and legacy generic Core Join routes await the same durable issue path", async () => {
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.kind = "durable_fake"; store.initialize = async () => {};
  await withService({ genericWorkCoreJoinStore: store }, async (request, health) => {
    const canonical = await request("/v1/work-continuity/generic-core-join", body());
    const alias = await request("/v1/work/core-join-verdicts", body());
    assert.equal(canonical.status, 201, JSON.stringify(canonical.json));
    assert.equal(alias.status, 201, JSON.stringify(alias.json));
    assert.deepEqual(alias.json, canonical.json);
    assert.deepEqual(Object.keys(canonical.json), ["ok", "verdict"]);
    assert.equal(canonical.json.ok, true);
    assert.equal(canonical.json.verdict.signature_algorithm, "ed25519");
    const crossTenant = { ...body(), tenant_id: "tenant-other" };
    const deniedTenant = await request("/v1/work-continuity/generic-core-join", crossTenant);
    assert.equal(deniedTenant.status, 403);
    assert.equal(deniedTenant.json.error, "tenant_scope_denied");
    const conflict = body(); conflict.evidence_digests = [digest("different")];
    const rejected = await request("/v1/work-continuity/generic-core-join", conflict);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.json.error, "generic_work_core_join_idempotency_conflict");
    const status = await health();
    assert.equal(status.generic_work_core_join.ready, true);
    assert.equal(status.generic_work_core_join.algorithm, "Ed25519");
    assert.equal(status.generic_work_core_join.key_id, "generic-work-core-join-api-key");
    assert.match(status.generic_work_core_join.public_key_fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(status.generic_work_core_join, "private_key"), false);
  });
});

test("generic Core Join health is pending then ready only after durable initialization", async () => {
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true;
  let resolveInitialization; store.initialize = () => new Promise((resolve) => { resolveInitialization = resolve; });
  await withService({ genericWorkCoreJoinStore: store }, async (request, health) => {
    await Promise.resolve();
    const pending = await health();
    assert.equal(pending.generic_work_core_join.ready, false);
    assert.equal(pending.generic_work_core_join.state, "initializing");
    resolveInitialization();
    const issued = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(issued.status, 201, JSON.stringify(issued.json));
    const ready = await health();
    assert.equal(ready.generic_work_core_join.ready, true);
  });
});

test("generic Core Join fails closed when durable initialization fails", async () => {
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => { throw new Error("postgres_unavailable"); };
  await withService({ genericWorkCoreJoinStore: store }, async (request, health) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = await health();
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.generic_work_core_join.state, "failed");
    assert.equal(status.generic_work_core_join.initialization_error, "postgres_unavailable");
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
  });
});

test("production configuration without a durable generic join store fails closed", async () => {
  const previous = process.env.NODE_ENV; const previousEvidence = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production"; process.env.CORE_EVIDENCE_SIGNING_SECRET = "generic-work-core-join-evidence-secret-0123456789";
  try { await withService({ genericWorkCoreJoinEd25519PrivateKey: "", genericWorkCoreJoinSignerMode: "remote", genericWorkCoreJoinRemoteSignerUrl: REMOTE_SIGNER_URL, genericWorkCoreJoinRemoteSignerHealthUrl: REMOTE_SIGNER_HEALTH_URL, genericWorkCoreJoinRemoteSignerAllowedUrlsJson: JSON.stringify([REMOTE_SIGNER_URL, REMOTE_SIGNER_HEALTH_URL]), genericWorkCoreJoinRemoteSignerToken: "generic-work-core-join-api-test-token", genericWorkCoreJoinTrustRegistryJson: REMOTE_SIGNER_REGISTRY }, async (request) => {
    const response = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(response.status, 503);
    assert.equal(response.json.error, "generic_work_core_join_durable_store_unavailable");
  }); } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    if (previousEvidence === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET; else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidence;
  }
});

test("PostgreSQL adapter initializes only additive schema before use", async () => {
  const queries = [];
  const pool = { async query(sql) { queries.push(String(sql)); return { rows: [], rowCount: 0 }; }, async connect() { return { query: pool.query.bind(pool), release() {} }; } };
  const store = createPostgresGenericWorkCoreJoinStore({ pool });
  await store.initialize();
  assert.equal(store.restart_durable, true);
  assert.equal(store.distributed, true);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS generic_work_core_joins/);
  assert.match(queries[0], /generic_work_core_join_events/);
});
