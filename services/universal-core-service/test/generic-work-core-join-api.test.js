import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";
import { genericWorkCoreJoinDigest, genericWorkCoreJoinSignaturePayload } from "../src/genericWorkCoreJoin.js";
import { GENERIC_WORK_CORE_JOIN_SIGN_RESPONSE_SCHEMA_VERSION } from "../src/genericWorkCoreJoinRemoteSigner.js";
import { createMemoryGenericWorkCoreJoinStore, createPostgresGenericWorkCoreJoinStore } from "../src/genericWorkCoreJoinStore.js";
import {
  GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER,
  canonicalGenericWorkCoreJoinContextBody,
  issueGenericWorkCoreJoinContext,
} from "../../shared/generic-work-core-join-context.js";

const TENANT = "tenant-host-native";
const WORK_ID = "11111111-1111-8111-8111-111111111111";
const OTHER_WORK_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_ID = "33333333-3333-4333-8333-333333333333";
const GATEWAY_KEY = "generic-work-core-join-mcp-key-0123456789";
const CONTEXT_SECRET = "generic-work-core-join-context-secret-0123456789";
const DTT_SECRET = "generic-work-core-join-dtt-secret-0123456789";
const HOST_SECRET = "generic-work-core-join-host-secret-0123456789";
const digest = (value) => genericWorkCoreJoinDigest({ value });
const KEYS = crypto.generateKeyPairSync("ed25519");
const PRIVATE_KEY = KEYS.privateKey.export({ type: "pkcs8", format: "pem" });
const PUBLIC_KEY = KEYS.publicKey.export({ type: "spki", format: "pem" });
const PUBLIC_KEY_FINGERPRINT = crypto.createHash("sha256")
  .update(KEYS.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const REMOTE_TOKEN = "opaque-generic-join-service-token-0123456789";
const REMOTE_TARGET_COMMIT = "a".repeat(40);

function remoteSignerConfig(fetchImpl) {
  return {
    origin: "https://generic-join-signer.example.invalid",
    path: "/v1/sign",
    service: "universal-core-service",
    targetCommit: REMOTE_TARGET_COMMIT,
    purpose: "generic_work_core_join_v1",
    keyId: "generic-work-core-join-api-key",
    serviceToken: REMOTE_TOKEN,
    publicKey: PUBLIC_KEY,
    fetchImpl,
    timeoutMs: 250,
    maxResponseBytes: 4_096,
  };
}
function remoteSignerResponse(request, signingKey = KEYS.privateKey) {
  return new Response(JSON.stringify({
    schema_version: GENERIC_WORK_CORE_JOIN_SIGN_RESPONSE_SCHEMA_VERSION,
    service: request.service,
    target_commit: request.target_commit,
    purpose: request.purpose,
    key_id: request.key_id,
    digest: request.digest,
    signature_algorithm: "ed25519",
    signature: crypto.sign(null, genericWorkCoreJoinSignaturePayload(request.digest), signingKey).toString("base64url"),
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function tenantContext() {
  const issued_at = new Date().toISOString();
  const canonical = JSON.stringify({ version: "mcp_tenant_context_v1", tenant_id: TENANT, issued_at });
  return Buffer.from(JSON.stringify({ version: "mcp_tenant_context_v1", tenant_id: TENANT, issued_at, assertion: `mtc_${crypto.createHmac("sha256", CONTEXT_SECRET).update(`mcp-tenant-context\0${canonical}`).digest("hex")}` })).toString("base64url");
}
function agentPresence() {
  return {
    transport_bound: true,
    agent_id: "agent-generic-join-api",
    session_id: "session-generic-join-api",
    session_fingerprint: "a".repeat(24),
    host_transport_session_fingerprint: "b".repeat(24),
    signature: `ags_${"c".repeat(32)}`,
    opaque_agent_id: `ai_${"d".repeat(24)}`,
    actor_provenance: `ap_${"e".repeat(32)}`,
    client_type: "codex",
  };
}
function joinLeaseBinding({ workId = WORK_ID, nowMs = Date.now() } = {}) {
  const presence = agentPresence();
  return {
    schema_version: "generic_work_core_join_lease_binding_v1",
    tenant_id: TENANT,
    work_id: workId,
    lease_id: LEASE_ID,
    expires_at: new Date(nowMs + 30_000).toISOString(),
    participant_expires_at: new Date(nowMs + 45_000).toISOString(),
    session_id: presence.session_id,
    agent_id: presence.agent_id,
    client_type: presence.client_type,
    session_fingerprint: presence.session_fingerprint,
    host_transport_session_fingerprint: presence.host_transport_session_fingerprint,
    presence_signature: presence.signature,
    opaque_agent_id: presence.opaque_agent_id,
    actor_provenance: presence.actor_provenance,
    execution_authorized: false,
  };
}
function joinContext(pathname, payload, {
  workId = WORK_ID,
  nowMs = Date.now(),
  body: boundBody = payload,
  verifier = {
    key_id: "generic-work-core-join-api-key",
    public_key_fingerprint: PUBLIC_KEY_FINGERPRINT,
  },
} = {}) {
  return issueGenericWorkCoreJoinContext({
    secret: DTT_SECRET,
    tenant_id: TENANT,
    work_id: workId,
    lease_binding: joinLeaseBinding({ workId, nowMs }),
    agent_presence: agentPresence(),
    verifier,
    method: "POST",
    path: pathname,
    body: boundBody,
    now_ms: nowMs,
    ttl_ms: 10_000,
  });
}
function body({ idempotency = "idem-001", nonce = "nonce-001" } = {}) {
  const acceptance_criteria = [{ criterion_id: "criterion-001", criterion_digest: digest("criterion"), evidence_digest: digest("criterion-evidence"), verification_digest: digest("criterion-verification") }];
  const task_state = [{ task_id: "task-001", completion_evidence_digest: digest("task-evidence"), task_state_digest: digest("task-state"), verification_digest: digest("task-verification") }];
  const evidence_digests = [digest("evidence-001")];
  const unsigned = { schema_version: "generic_work_independent_verifier_receipt_v1", tenant_id: TENANT, work_id: WORK_ID, adapter: "research", acceptance_criteria_digest: genericWorkCoreJoinDigest(acceptance_criteria), task_state_digest: genericWorkCoreJoinDigest(task_state), evidence_digest: genericWorkCoreJoinDigest([...evidence_digests].sort()), verification_digest: digest("verification"), verifier_identity: "verifier-001", session_id: "verifier-session-001", nonce, issued_at: "2026-08-08T09:59:00.000Z", expires_at: "2099-08-08T10:05:00.000Z" };
  return { work_id: WORK_ID, adapter: "research", requester_identity: "builder-001", requester_session_id: "builder-session-001", idempotency_digest: digest(idempotency), acceptance_criteria, task_state, evidence_digests, independent_verifier_receipt: { ...unsigned, signature: crypto.createHmac("sha256", DTT_SECRET).update(`generic_work_verifier_receipt_v1\0${genericWorkCoreJoinDigest(unsigned)}`).digest("base64url") } };
}
async function withService(options, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generic-work-join-api-"));
  const {
    genericWorkCoreJoinTestDefaults = true,
    ...serviceOptions
  } = options;
  const signerMode = Object.hasOwn(serviceOptions, "genericWorkCoreJoinSignerMode")
    ? serviceOptions.genericWorkCoreJoinSignerMode
    : serviceOptions.genericWorkCoreJoinRemoteSignerConfig
      ? "remote"
      : "disabled";
  const genericWorkCoreJoinDefaults = genericWorkCoreJoinTestDefaults
    ? {
        genericWorkCoreJoinEnabled: true,
        genericWorkCoreJoinSignerMode: signerMode,
        genericWorkCoreJoinEd25519PrivateKey: PRIVATE_KEY,
        genericWorkCoreJoinEd25519KeyId: "generic-work-core-join-api-key",
      }
    : {};
  const { app } = createUniversalCoreService({ storageRoot: root, mcpTenantGatewayKey: GATEWAY_KEY, tenantContextSigningSecret: CONTEXT_SECRET, dttAgentIdentitySigningSecret: DTT_SECRET, hostNativeSigningSecret: HOST_SECRET, ...genericWorkCoreJoinDefaults, ...serviceOptions });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = async (pathname, payload, contextOptions = {}) => {
    const headers = { authorization: `Bearer ${GATEWAY_KEY}`, "content-type": "application/json", "x-sh-tenant-id": TENANT, "x-sh-tenant-context": tenantContext() };
    if (contextOptions.includeContext !== false) {
      headers[GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER] = contextOptions.token
        || joinContext(pathname, payload, contextOptions);
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, {
      method: "POST",
      headers,
      body: canonicalGenericWorkCoreJoinContextBody(payload),
    });
    return { status: response.status, json: await response.json() };
  };
  const health = async () => (await fetch(`http://127.0.0.1:${server.address().port}/healthz`)).json();
  try { await run(request, health); } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
}

test("Generic Core Join defaults code-dark without verifier material and does not initialize, read, sign, or record", async () => {
  const calls = { initialize: 0, read: 0, record: 0 };
  const store = {
    kind: "must_not_activate",
    restart_durable: true,
    distributed: true,
    async initialize() { calls.initialize += 1; },
    async read() { calls.read += 1; return null; },
    async record() { calls.record += 1; },
  };
  await withService({
    genericWorkCoreJoinTestDefaults: false,
    genericWorkCoreJoinStore: store,
  }, async (request, health) => {
    const status = await health();
    assert.equal(status.generic_work_core_join.enabled, false);
    assert.equal(status.generic_work_core_join.required, false);
    assert.equal(status.generic_work_core_join.configuration_valid, true);
    assert.equal(status.generic_work_core_join.state, "disabled");
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.generic_work_core_join.store_state, "disabled");
    assert.equal(status.generic_work_core_join.signer_mode, "disabled");
    assert.equal(status.generic_work_core_join.key_id, null);
    assert.equal(status.generic_work_core_join.public_key_fingerprint, null);
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "generic_work_core_join_disabled");
    assert.deepEqual(calls, { initialize: 0, read: 0, record: 0 });
  });
});

test("strict feature flags expose invalid configuration and required-only render gating", async () => {
  await withService({
    genericWorkCoreJoinTestDefaults: false,
    genericWorkCoreJoinEnabled: "TRUE",
    genericWorkCoreJoinRequired: false,
  }, async (request, health) => {
    const status = await health();
    assert.equal(status.generic_work_core_join.configuration_valid, false);
    assert.equal(status.generic_work_core_join.configuration_error, "generic_work_core_join_enabled_flag_invalid");
    assert.equal(status.generic_work_core_join.state, "configuration_invalid");
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "generic_work_core_join_enabled_flag_invalid");
  });
  await withService({
    genericWorkCoreJoinTestDefaults: false,
    genericWorkCoreJoinEnabled: true,
    genericWorkCoreJoinRequired: "TRUE",
  }, async (_request, health) => {
    const status = await health();
    assert.equal(status.generic_work_core_join.required, true);
    assert.equal(status.generic_work_core_join.configuration_error, "generic_work_core_join_required_flag_invalid");
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.render_ready, false);
  });
  await withService({
    genericWorkCoreJoinTestDefaults: false,
    genericWorkCoreJoinEnabled: false,
    genericWorkCoreJoinRequired: true,
  }, async (_request, health) => {
    const status = await health();
    assert.equal(status.generic_work_core_join.configuration_error, "generic_work_core_join_required_without_enabled");
    assert.equal(status.render_ready, false);
  });
  await withService({
    genericWorkCoreJoinTestDefaults: false,
    genericWorkCoreJoinEnabled: true,
    genericWorkCoreJoinRequired: true,
    genericWorkCoreJoinSignerMode: "REMOTE",
  }, async (_request, health) => {
    const status = await health();
    assert.equal(status.generic_work_core_join.configuration_valid, false);
    assert.equal(
      status.generic_work_core_join.configuration_error,
      "generic_work_core_join_signer_mode_invalid",
    );
    assert.equal(status.render_ready, false);
  });
});

test("remote signer residue cannot activate Core while signer mode is disabled", async () => {
  let fetchCalls = 0;
  const store = createMemoryGenericWorkCoreJoinStore();
  store.restart_durable = true;
  store.distributed = true;
  store.initialize = async () => {};
  await withService({
    genericWorkCoreJoinTestDefaults: false,
    genericWorkCoreJoinEnabled: true,
    genericWorkCoreJoinSignerMode: "disabled",
    genericWorkCoreJoinRemoteSignerConfig: remoteSignerConfig(async () => {
      fetchCalls += 1;
      throw new Error("must_not_fetch");
    }),
    genericWorkCoreJoinStore: store,
  }, async (request, health) => {
    const status = await health();
    assert.equal(status.generic_work_core_join.signer_mode, "disabled");
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(fetchCalls, 0);
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "generic_work_core_join_signer_unconfigured");
    assert.equal(fetchCalls, 0);
    assert.equal(store.events().length, 0);
  });
});

test("remote signer reads the canonical PUBLIC_KEY environment name and rejects ambiguous legacy material", async (t) => {
  const canonicalName = "CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_PUBLIC_KEY";
  const legacyName = "CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_ED25519_PUBLIC_KEY";
  const savedCanonical = process.env[canonicalName];
  const savedLegacy = process.env[legacyName];
  const remoteOptions = () => {
    const store = createMemoryGenericWorkCoreJoinStore();
    store.restart_durable = true;
    store.distributed = true;
    store.initialize = async () => {};
    return {
      genericWorkCoreJoinTestDefaults: false,
      genericWorkCoreJoinEnabled: true,
      genericWorkCoreJoinSignerMode: "remote",
      genericWorkCoreJoinStore: store,
      genericWorkCoreJoinRemoteSignerOrigin: "https://generic-join-signer.example.invalid",
      genericWorkCoreJoinRemoteSignerPath: "/v1/generic-work-core-join/sign",
      genericWorkCoreJoinRemoteSignerService: "universal-core-service",
      genericWorkCoreJoinRemoteSignerTargetCommit: REMOTE_TARGET_COMMIT,
      genericWorkCoreJoinRemoteSignerPurpose: "generic_work_core_join_v1",
      genericWorkCoreJoinRemoteSignerKeyId: "generic-work-core-join-api-key",
      genericWorkCoreJoinRemoteSignerServiceToken: REMOTE_TOKEN,
      genericWorkCoreJoinRemoteSignerFetch: async (_url, init) => remoteSignerResponse(JSON.parse(init.body)),
    };
  };
  try {
    await t.test("canonical name", async () => {
      process.env[canonicalName] = PUBLIC_KEY;
      delete process.env[legacyName];
      await withService(remoteOptions(), async (_request, health) => {
        const status = await health();
        assert.equal(status.generic_work_core_join.configuration_error, null);
        assert.equal(status.generic_work_core_join.signer_state, "ready");
        assert.equal(status.generic_work_core_join.ready, true);
      });
    });
    await t.test("unambiguous legacy compatibility", async () => {
      delete process.env[canonicalName];
      process.env[legacyName] = PUBLIC_KEY;
      await withService(remoteOptions(), async (_request, health) => {
        const status = await health();
        assert.equal(status.generic_work_core_join.configuration_error, null);
        assert.equal(status.generic_work_core_join.signer_state, "ready");
        assert.equal(status.generic_work_core_join.ready, true);
      });
    });
    await t.test("ambiguous names fail closed", async () => {
      const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
      process.env[canonicalName] = PUBLIC_KEY;
      process.env[legacyName] = other;
      await withService(remoteOptions(), async (_request, health) => {
        const status = await health();
        assert.equal(status.generic_work_core_join.configuration_valid, false);
        assert.equal(
          status.generic_work_core_join.configuration_error,
          "generic_work_core_join_signer_public_key_ambiguous",
        );
        assert.equal(status.generic_work_core_join.ready, false);
      });
    });
  } finally {
    if (savedCanonical === undefined) delete process.env[canonicalName];
    else process.env[canonicalName] = savedCanonical;
    if (savedLegacy === undefined) delete process.env[legacyName];
    else process.env[legacyName] = savedLegacy;
  }
});

test("startup signer challenge is single-flight and retries only after cooldown", async () => {
  let now = 1_000;
  let calls = 0;
  const wrongKeys = crypto.generateKeyPairSync("ed25519");
  const store = createMemoryGenericWorkCoreJoinStore();
  store.restart_durable = true;
  store.distributed = true;
  store.initialize = async () => {};
  const remote = remoteSignerConfig(async (_url, init) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const request = JSON.parse(init.body);
    return remoteSignerResponse(request, calls === 1 ? wrongKeys.privateKey : KEYS.privateKey);
  });
  await withService({
    genericWorkCoreJoinStore: store,
    genericWorkCoreJoinRemoteSignerConfig: remote,
    genericWorkCoreJoinProbeNow: () => now,
    genericWorkCoreJoinSignerProbeCooldownMs: 100,
  }, async (_request, health) => {
    const [first, concurrent] = await Promise.all([health(), health()]);
    assert.equal(calls, 1);
    assert.equal(first.generic_work_core_join.ready, false);
    assert.equal(concurrent.generic_work_core_join.ready, false);
    assert.equal(first.generic_work_core_join.signer_probe_attempts, 1);
    assert.equal(store.events().length, 0);
    const duringCooldown = await health();
    assert.equal(calls, 1);
    assert.equal(duringCooldown.generic_work_core_join.ready, false);
    now += 101;
    const recovered = await health();
    assert.equal(calls, 2);
    assert.equal(recovered.generic_work_core_join.signer_probe_attempts, 2);
    assert.equal(recovered.generic_work_core_join.ready, true);
    assert.equal(store.events().length, 0);
  });
});

test("a signer result after the probe deadline cannot promote readiness or overlap a retry", async () => {
  let now = 1_000;
  let calls = 0;
  const store = createMemoryGenericWorkCoreJoinStore();
  store.restart_durable = true;
  store.distributed = true;
  store.initialize = async () => {};
  const remote = remoteSignerConfig(async (_url, init) => {
    calls += 1;
    if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 180));
    return remoteSignerResponse(JSON.parse(init.body));
  });
  remote.timeoutMs = 1_000;
  await withService({
    genericWorkCoreJoinStore: store,
    genericWorkCoreJoinRemoteSignerConfig: remote,
    genericWorkCoreJoinProbeNow: () => now,
    genericWorkCoreJoinSignerProbeCooldownMs: 5_000,
    genericWorkCoreJoinSignerProbeTimeoutMs: 100,
  }, async (_request, health) => {
    const timedOut = await health();
    assert.equal(timedOut.generic_work_core_join.ready, false);
    assert.equal(timedOut.generic_work_core_join.reason, "generic_work_core_join_signer_timeout");
    assert.equal(timedOut.generic_work_core_join.signer_probe_attempts, 1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const stale = await health();
    assert.equal(stale.generic_work_core_join.ready, false);
    assert.equal(stale.generic_work_core_join.signer_probe_attempts, 1);
    assert.equal(calls, 1);
    now += 5_001;
    const recovered = await health();
    assert.equal(recovered.generic_work_core_join.ready, true);
    assert.equal(recovered.generic_work_core_join.signer_probe_attempts, 2);
    assert.equal(calls, 2);
    assert.equal(store.events().length, 0);
  });
});

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
    assert.equal(status.generic_work_core_join.store_state, "ready");
    assert.equal(status.generic_work_core_join.signer_state, "ready");
    assert.equal(status.generic_work_core_join.reason, null);
    assert.equal(status.generic_work_core_join.custody, "local_process_key");
    assert.equal(status.generic_work_core_join.algorithm, "Ed25519");
    assert.equal(status.generic_work_core_join.key_id, "generic-work-core-join-api-key");
    assert.match(status.generic_work_core_join.public_key_fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(status.generic_work_core_join, "private_key"), false);
  });
});

test("generic Core Join routes deny missing, tampered, expired, and cross-Work context proofs", async () => {
  const store = createMemoryGenericWorkCoreJoinStore();
  store.restart_durable = true;
  store.distributed = true;
  store.kind = "durable_fake";
  store.initialize = async () => {};
  await withService({ genericWorkCoreJoinStore: store }, async (request) => {
    const input = body({ idempotency: "context-denial-001", nonce: "context-denial-001" });

    const missing = await request(
      "/v1/work-continuity/generic-core-join",
      input,
      { includeContext: false },
    );
    assert.equal(missing.status, 403);
    assert.equal(missing.json.error, "generic_work_core_join_context_required");

    const tampered = await request(
      "/v1/work-continuity/generic-core-join",
      { ...input, adapter: "generic" },
      { body: input },
    );
    assert.equal(tampered.status, 403);
    assert.equal(tampered.json.error, "generic_work_core_join_context_request_mismatch");

    const expired = await request(
      "/v1/work-continuity/generic-core-join",
      input,
      { nowMs: Date.now() - 60_000 },
    );
    assert.equal(expired.status, 403);
    assert.equal(expired.json.error, "generic_work_core_join_context_expired");

    const crossWork = await request(
      "/v1/work-continuity/generic-core-join",
      { ...input, work_id: OTHER_WORK_ID },
      { workId: WORK_ID },
    );
    assert.equal(crossWork.status, 403);
    assert.equal(crossWork.json.error, "generic_work_core_join_cross_work_denied");
    assert.equal(store.events().length, 0);
  });
});

test("generic Core Join verifier trust mismatch stops before store read or signing", async () => {
  let readCalls = 0;
  let recordCalls = 0;
  let signCalls = 0;
  const store = {
    kind: "durable_fake",
    restart_durable: true,
    distributed: true,
    async initialize() {},
    async read() { readCalls += 1; return null; },
    async record() { recordCalls += 1; throw new Error("must_not_record"); },
  };
  const signer = {
    algorithm: "Ed25519",
    key_id: "generic-work-core-join-api-key",
    public_key: KEYS.publicKey,
    public_key_fingerprint: PUBLIC_KEY_FINGERPRINT,
    custody: "external_kms",
    signer_state: "ready",
    async signDigest(value) {
      signCalls += 1;
      return crypto.sign(null, genericWorkCoreJoinSignaturePayload(value), KEYS.privateKey)
        .toString("base64url");
    },
  };
  await withService({
    genericWorkCoreJoinStore: store,
    genericWorkCoreJoinSigner: signer,
  }, async (request) => {
    const denied = await request(
      "/v1/work-continuity/generic-core-join",
      body({ idempotency: "trust-mismatch-001", nonce: "trust-mismatch-001" }),
      { verifier: {
        key_id: signer.key_id,
        public_key_fingerprint: "0".repeat(64),
      } },
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, "generic_work_core_join_verifier_binding_mismatch");
    assert.equal(readCalls, 0);
    assert.equal(signCalls, 0);
    assert.equal(recordCalls, 0);
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
    assert.equal(pending.generic_work_core_join.store_state, "initializing");
    assert.equal(pending.generic_work_core_join.signer_state, "ready");
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
    assert.equal(status.generic_work_core_join.store_state, "failed");
    assert.equal(status.generic_work_core_join.signer_state, "ready");
    assert.equal(status.generic_work_core_join.reason, "postgres_unavailable");
    assert.equal(status.generic_work_core_join.initialization_error, "postgres_unavailable");
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
  });
});

test("production denies local-process Generic Core Join signing even with a durable store", async () => {
  const previous = process.env.NODE_ENV; const previousEvidence = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production"; process.env.CORE_EVIDENCE_SIGNING_SECRET = "generic-work-core-join-evidence-secret-0123456789";
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => {};
  try { await withService({ genericWorkCoreJoinStore: store }, async (request, health) => {
    const response = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(response.status, 503);
    assert.equal(response.json.error, "generic_work_core_join_local_signer_forbidden");
    assert.equal(store.events().length, 0);
    const status = await health();
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.generic_work_core_join.store_state, "ready");
    assert.equal(status.generic_work_core_join.signer_state, "forbidden");
    assert.equal(status.generic_work_core_join.custody, "local_process_key");
    assert.equal(status.generic_work_core_join.reason, "generic_work_core_join_local_signer_forbidden");
  }); } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    if (previousEvidence === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET; else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidence;
  }
});

test("production rejects an injected signer even when it claims external custody", async () => {
  const previous = process.env.NODE_ENV;
  const previousEvidence = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production";
  process.env.CORE_EVIDENCE_SIGNING_SECRET = "generic-work-core-join-evidence-secret-0123456789";
  let initializeCalls = 0;
  let signCalls = 0;
  const store = createMemoryGenericWorkCoreJoinStore();
  store.restart_durable = true;
  store.distributed = true;
  store.initialize = async () => { initializeCalls += 1; };
  const injectedSigner = {
    algorithm: "Ed25519",
    key_id: "generic-work-core-join-api-key",
    public_key: KEYS.publicKey,
    public_key_fingerprint: PUBLIC_KEY_FINGERPRINT,
    custody: "external_kms",
    signer_state: "ready",
    async signDigest(value) {
      signCalls += 1;
      return crypto.sign(null, genericWorkCoreJoinSignaturePayload(value), KEYS.privateKey)
        .toString("base64url");
    },
  };
  try {
    await withService({
      genericWorkCoreJoinTestDefaults: false,
      genericWorkCoreJoinEnabled: true,
      genericWorkCoreJoinRequired: true,
      genericWorkCoreJoinSignerMode: "remote",
      genericWorkCoreJoinSigner: injectedSigner,
      genericWorkCoreJoinStore: store,
    }, async (request, health) => {
      const status = await health();
      assert.equal(status.generic_work_core_join.configuration_valid, false);
      assert.equal(
        status.generic_work_core_join.configuration_error,
        "generic_work_core_join_signer_injection_forbidden",
      );
      assert.equal(status.generic_work_core_join.ready, false);
      assert.equal(status.render_ready, false);
      const denied = await request("/v1/work-continuity/generic-core-join", body());
      assert.equal(denied.status, 503);
      assert.equal(denied.json.error, "generic_work_core_join_signer_injection_forbidden");
      assert.equal(initializeCalls, 0);
      assert.equal(signCalls, 0);
      assert.equal(store.events().length, 0);
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    if (previousEvidence === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET;
    else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidence;
  }
});

test("production remote signer target must be derived from and match the running build", async () => {
  const previous = process.env.NODE_ENV;
  const previousEvidence = process.env.CORE_EVIDENCE_SIGNING_SECRET;
  process.env.NODE_ENV = "production";
  process.env.CORE_EVIDENCE_SIGNING_SECRET = "generic-work-core-join-evidence-secret-0123456789";
  let initializeCalls = 0;
  let fetchCalls = 0;
  const store = createMemoryGenericWorkCoreJoinStore();
  store.restart_durable = true;
  store.distributed = true;
  store.initialize = async () => { initializeCalls += 1; };
  try {
    await withService({
      genericWorkCoreJoinStore: store,
      genericWorkCoreJoinRemoteSignerConfig: remoteSignerConfig(async () => {
        fetchCalls += 1;
        throw new Error("must_not_fetch");
      }),
    }, async (request, health) => {
      const status = await health();
      assert.equal(status.generic_work_core_join.configuration_valid, false);
      assert.equal(
        status.generic_work_core_join.configuration_error,
        "generic_work_core_join_signer_target_commit_mismatch",
      );
      assert.equal(status.generic_work_core_join.ready, false);
      const denied = await request("/v1/work-continuity/generic-core-join", body());
      assert.equal(denied.status, 503);
      assert.equal(denied.json.error, "generic_work_core_join_signer_target_commit_mismatch");
      assert.equal(initializeCalls, 0);
      assert.equal(fetchCalls, 0);
      assert.equal(store.events().length, 0);
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    if (previousEvidence === undefined) delete process.env.CORE_EVIDENCE_SIGNING_SECRET;
    else process.env.CORE_EVIDENCE_SIGNING_SECRET = previousEvidence;
  }
});

test("remote signer startup challenge is locally verified before health becomes ready and writes no verdict", async () => {
  let calls = 0;
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => {};
  const remote = remoteSignerConfig(async (_url, init) => {
    calls += 1;
    return remoteSignerResponse(JSON.parse(init.body));
  });
  await withService({ genericWorkCoreJoinStore: store, genericWorkCoreJoinRemoteSignerConfig: remote }, async (request, health) => {
    const before = await health();
    assert.equal(calls, 1);
    assert.equal(store.events().length, 0);
    assert.equal(before.generic_work_core_join.ready, true);
    assert.equal(before.generic_work_core_join.store_state, "ready");
    assert.equal(before.generic_work_core_join.signer_state, "ready");
    assert.equal(before.generic_work_core_join.state, "ready");
    assert.equal(before.generic_work_core_join.reason, null);
    assert.equal(before.generic_work_core_join.signer_probe_attempts, 1);
    const issued = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(issued.status, 201, JSON.stringify(issued.json));
    assert.equal(calls, 2);
    assert.equal(issued.json.verdict.execution_authorized, false);
    assert.equal(issued.json.verdict.host_action_authorized, false);
    const after = await health();
    assert.equal(after.generic_work_core_join.ready, true);
    assert.equal(after.generic_work_core_join.signer_state, "ready");
    assert.equal(after.generic_work_core_join.reason, null);
  });
});

test("remote signer infrastructure failures map to 503, update secret-free health, and never persist", async () => {
  const wrongKeys = crypto.generateKeyPairSync("ed25519");
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => {};
  const remote = remoteSignerConfig(async (_url, init) => {
    const request = JSON.parse(init.body);
    return remoteSignerResponse(request, wrongKeys.privateKey);
  });
  await withService({ genericWorkCoreJoinStore: store, genericWorkCoreJoinRemoteSignerConfig: remote }, async (request, health) => {
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "generic_work_core_join_signer_signature_invalid");
    assert.equal(store.events().length, 0);
    const status = await health();
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.generic_work_core_join.store_state, "ready");
    assert.equal(status.generic_work_core_join.signer_state, "rejected");
    assert.equal(status.generic_work_core_join.custody, "external_remote_signer");
    assert.equal(status.generic_work_core_join.reason, "generic_work_core_join_signer_signature_invalid");
    assert.equal(JSON.stringify(status).includes(REMOTE_TOKEN), false);
    assert.equal(JSON.stringify(denied.json).includes(REMOTE_TOKEN), false);
  });
});

test("hard signer deadline rejects a transport that ignores AbortSignal and never persists its late signature", async () => {
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => {};
  const remote = {
    ...remoteSignerConfig(async (_url, init) => {
      const request = JSON.parse(init.body);
      await new Promise((resolve) => setTimeout(resolve, 180));
      return remoteSignerResponse(request);
    }),
    timeoutMs: 100,
  };
  await withService({ genericWorkCoreJoinStore: store, genericWorkCoreJoinRemoteSignerConfig: remote }, async (request, health) => {
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "generic_work_core_join_signer_timeout");
    assert.equal(store.events().length, 0);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(store.events().length, 0);
    const status = await health();
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.generic_work_core_join.signer_state, "unavailable");
    assert.equal(status.generic_work_core_join.reason, "generic_work_core_join_signer_timeout");
  });
});

test("runtime store read and record infrastructure failures map to 503 while semantic conflicts remain 409", async () => {
  const base = { kind: "durable_fake", restart_durable: true, distributed: true, initialize: async () => {} };
  let recordCalls = 0;
  await withService({ genericWorkCoreJoinStore: { ...base, read: async () => { throw new Error("postgres_unavailable"); }, record: async () => { recordCalls += 1; } } }, async (request, health) => {
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "postgres_unavailable");
    assert.equal(recordCalls, 0);
    const status = await health();
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.generic_work_core_join.store_state, "failed");
    assert.equal(status.generic_work_core_join.reason, "postgres_unavailable");
    assert.equal(status.generic_work_core_join.initialization_error, "postgres_unavailable");
  });
  await withService({ genericWorkCoreJoinStore: { ...base, read: async () => null, record: async () => { throw new Error("store_unavailable"); } } }, async (request, health) => {
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "store_unavailable");
    const status = await health();
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.generic_work_core_join.store_state, "failed");
    assert.equal(status.generic_work_core_join.reason, "store_unavailable");
    assert.equal(status.generic_work_core_join.initialization_error, "store_unavailable");
  });
});

test("injected signer failures latch health and only a fresh signed durable issue can recover it", async () => {
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => {};
  let failSigning = false;
  let signCalls = 0;
  const signer = {
    algorithm: "Ed25519",
    key_id: "generic-work-core-join-api-key",
    public_key: PUBLIC_KEY,
    custody: "external_remote_signer",
    signer_state: "ready",
    async signDigest(verdictDigest) {
      signCalls += 1;
      if (failSigning) throw new Error("generic_work_core_join_signer_timeout");
      return crypto.sign(null, genericWorkCoreJoinSignaturePayload(verdictDigest), KEYS.privateKey).toString("base64url");
    },
  };
  await withService({ genericWorkCoreJoinStore: store, genericWorkCoreJoinSigner: signer }, async (request, health) => {
    assert.equal((await health()).generic_work_core_join.ready, true);
    const firstInput = body();
    assert.equal((await request("/v1/work-continuity/generic-core-join", firstInput)).status, 201);
    assert.equal(signCalls, 1);
    failSigning = true;
    const denied = await request("/v1/work-continuity/generic-core-join", body({ idempotency: "idem-002", nonce: "nonce-002" }));
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "generic_work_core_join_signer_timeout");
    const failed = await health();
    assert.equal(failed.generic_work_core_join.ready, false);
    assert.equal(failed.generic_work_core_join.signer_state, "unavailable");
    assert.equal(failed.generic_work_core_join.reason, "generic_work_core_join_signer_timeout");
    failSigning = false;
    const replay = await request("/v1/work-continuity/generic-core-join", firstInput);
    assert.equal(replay.status, 201);
    assert.equal(signCalls, 2);
    const afterReplay = await health();
    assert.equal(afterReplay.generic_work_core_join.ready, false);
    assert.equal(afterReplay.generic_work_core_join.reason, "generic_work_core_join_signer_timeout");
    const recovered = await request("/v1/work-continuity/generic-core-join", body({ idempotency: "idem-003", nonce: "nonce-003" }));
    assert.equal(recovered.status, 201, JSON.stringify(recovered.json));
    assert.equal(signCalls, 3);
    const afterFresh = await health();
    assert.equal(afterFresh.generic_work_core_join.ready, true);
    assert.equal(afterFresh.generic_work_core_join.signer_state, "ready");
    assert.equal(afterFresh.generic_work_core_join.reason, null);
  });
});

test("token-shaped injected signer errors are reduced to allowlisted response and health codes", async () => {
  const secretCode = "generic_work_core_join_signer_do_not_expose_token_987654321";
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => {};
  const signer = {
    algorithm: "Ed25519",
    key_id: "generic-work-core-join-api-key",
    public_key: PUBLIC_KEY,
    custody: "external_remote_signer",
    async signDigest() { throw new Error(secretCode); },
    health() { return { signer_state: `unavailable_${secretCode}`, reason: secretCode, custody: "external_remote_signer" }; },
  };
  await withService({ genericWorkCoreJoinStore: store, genericWorkCoreJoinSigner: signer }, async (request, health) => {
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "generic_work_core_join_signer_unavailable");
    assert.equal(JSON.stringify(denied.json).includes(secretCode), false);
    assert.equal(store.events().length, 0);
    const status = await health();
    assert.equal(status.generic_work_core_join.signer_state, "unavailable");
    assert.equal(status.generic_work_core_join.reason, "generic_work_core_join_signer_unavailable");
    assert.equal(JSON.stringify(status).includes(secretCode), false);
  });
});

test("an invalid requested remote signer remains fail-closed without constructing an authority", async () => {
  const store = createMemoryGenericWorkCoreJoinStore(); store.restart_durable = true; store.distributed = true; store.initialize = async () => {};
  await withService({
    genericWorkCoreJoinStore: store,
    genericWorkCoreJoinRemoteSignerConfig: { origin: "https://signer.example.invalid" },
  }, async (request, health) => {
    const denied = await request("/v1/work-continuity/generic-core-join", body());
    assert.equal(denied.status, 503);
    assert.equal(denied.json.error, "generic_work_core_join_signer_path_invalid");
    assert.equal(store.events().length, 0);
    const status = await health();
    assert.equal(status.generic_work_core_join.ready, false);
    assert.equal(status.generic_work_core_join.signer_state, "invalid");
    assert.equal(status.generic_work_core_join.custody, "external_remote_signer");
    assert.equal(status.generic_work_core_join.reason, "generic_work_core_join_signer_path_invalid");
  });
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
