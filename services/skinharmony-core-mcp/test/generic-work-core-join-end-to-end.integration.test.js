import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCoreHandlers } from "../src/core-handlers.js";
import {
  createWorkContinuityV2Store,
  deriveAuthenticatedTenantWorkAcl,
  verifyGenericCoreJoinVerdict,
} from "../src/work-continuity-v2-store.js";
import { createUniversalCoreService as createApp } from "../../universal-core-service/src/app.js";
import { genericWorkCoreJoinDigest } from "../../universal-core-service/src/genericWorkCoreJoin.js";
import { createMemoryGenericWorkCoreJoinStore } from "../../universal-core-service/src/genericWorkCoreJoinStore.js";
import {
  GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER,
  canonicalGenericWorkCoreJoinContextBody,
  issueGenericWorkCoreJoinContext,
} from "../../shared/generic-work-core-join-context.js";

const TENANT = "tenant-generic-e2e";
const OTHER_TENANT = "tenant-generic-other";
const WORK_ID = "77777777-7777-4777-8777-777777777777";
const LEASE_ID = "88888888-8888-4888-8888-888888888888";
const ADAPTER = "research";
const GATEWAY_KEY = "generic-e2e-tenant-gateway-key-0123456789";
const CONTEXT_SECRET = "generic-e2e-context-signing-secret-0123456789";
const DTT_SECRET = "generic-e2e-dtt-signing-secret-0123456789";
const HOST_SECRET = "generic-e2e-host-signing-secret-0123456789";
const KEY_ID = "generic-e2e-ed25519-key";

function digest(value) {
  return genericWorkCoreJoinDigest({ value });
}

function tenantContext(tenantId) {
  const issued_at = new Date().toISOString();
  const canonical = JSON.stringify({ version: "mcp_tenant_context_v1", tenant_id: tenantId, issued_at });
  const assertion = `mtc_${crypto.createHmac("sha256", CONTEXT_SECRET)
    .update(`mcp-tenant-context\0${canonical}`).digest("hex")}`;
  return Buffer.from(JSON.stringify({ version: "mcp_tenant_context_v1", tenant_id: tenantId,
    issued_at, assertion })).toString("base64url");
}

function agentPresence() {
  return {
    transport_bound: true,
    agent_id: "agent-generic-e2e",
    session_id: "session-generic-e2e",
    session_fingerprint: "a".repeat(24),
    host_transport_session_fingerprint: "b".repeat(24),
    signature: `ags_${"c".repeat(32)}`,
    opaque_agent_id: `ai_${"d".repeat(24)}`,
    actor_provenance: `ap_${"e".repeat(32)}`,
    client_type: "codex",
  };
}

function leaseBinding(tenantId, presence = agentPresence()) {
  return {
    schema_version: "generic_work_core_join_lease_binding_v1",
    tenant_id: tenantId,
    work_id: WORK_ID,
    lease_id: LEASE_ID,
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    participant_expires_at: new Date(Date.now() + 120_000).toISOString(),
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

function genericJoinRequest() {
  const acceptance_criteria = [{
    criterion_id: "criterion-e2e-001",
    criterion_digest: digest("criterion"),
    evidence_digest: digest("criterion-evidence"),
    verification_digest: digest("criterion-verification"),
  }];
  const task_state = [{
    task_id: "task-e2e-001",
    completion_evidence_digest: digest("task-evidence"),
    task_state_digest: digest("task-state"),
    verification_digest: digest("task-verification"),
  }];
  const evidence_digests = [digest("evidence-e2e-001")];
  const issued = Date.now();
  const unsignedReceipt = {
    schema_version: "generic_work_independent_verifier_receipt_v1",
    tenant_id: TENANT,
    work_id: WORK_ID,
    adapter: ADAPTER,
    acceptance_criteria_digest: genericWorkCoreJoinDigest(acceptance_criteria),
    task_state_digest: genericWorkCoreJoinDigest(task_state),
    evidence_digest: genericWorkCoreJoinDigest([...evidence_digests].sort()),
    verification_digest: digest("independent-verification"),
    verifier_identity: "verifier-e2e-001",
    session_id: "verifier-session-e2e-001",
    nonce: "nonce-generic-e2e-001",
    issued_at: new Date(issued - 1_000).toISOString(),
    expires_at: new Date(issued + 300_000).toISOString(),
  };
  const signature = crypto.createHmac("sha256", DTT_SECRET)
    .update(`generic_work_verifier_receipt_v1\0${genericWorkCoreJoinDigest(unsignedReceipt)}`)
    .digest("base64url");
  return {
    work_id: WORK_ID,
    adapter: ADAPTER,
    requester_identity: "builder-e2e-001",
    requester_session_id: "builder-session-e2e-001",
    idempotency_digest: digest("generic-e2e-idempotency"),
    acceptance_criteria,
    task_state,
    evidence_digests,
    independent_verifier_receipt: { ...unsignedReceipt, signature },
  };
}

function v2Identity(tenantId, subject = "owner-e2e") {
  const base = {
    tenantId,
    subject,
    userId: subject,
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1",
      authenticated: true,
      tenant_id: tenantId,
      subject,
      role: "tenant_owner",
      expires_at: "2030-01-01T00:00:00.000Z",
      team_ids: [],
      managed_team_ids: [],
      assigned_work_ids: [],
    },
  };
  return {
    ...base,
    coreJoinTrusted: true,
    tenant_work_acl: deriveAuthenticatedTenantWorkAcl(base, Date.now()),
  };
}

class VerdictPersistencePool {
  constructor() {
    this.work = {
      tenant_id: TENANT,
      work_id: WORK_ID,
      legacy_work_id: WORK_ID,
      work_code: "GENERIC-20260808-0001",
      work_name: "Generic Join cross-service E2E",
      work_type: ADAPTER,
      project_id: "nyra-core",
      owner_user_id: "owner-e2e",
      created_by_user_id: "owner-e2e",
      assigned_user_ids: [],
      supervising_user_ids: [],
      agent_ids: [],
      visibility_scope: "private",
      status: "ACTIVE",
      progress_bp: 0,
      priority: "P4",
      priority_score: 0,
      priority_version: "work_priority_v1",
      priority_context: {},
      created_at: "2026-08-08T00:00:00.000Z",
      updated_at: "2026-08-08T00:00:00.000Z",
    };
    this.join = null;
    this.insertCount = 0;
  }

  async connect() {
    return { query: this.query.bind(this), release() {} };
  }

  async query(sql, parameters = []) {
    const queryText = typeof sql === "string" ? sql : sql.text;
    if (!parameters.length && Array.isArray(sql?.values)) parameters = sql.values;
    const query = queryText.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return { rows: [], rowCount: 0 };
    if (query.startsWith("SET LOCAL ")) return { rows: [], rowCount: 0 };
    if (query.includes("CREATE TABLE IF NOT EXISTS tenant_work")) return { rows: [], rowCount: 0 };
    if (query.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2")) {
      const found = parameters[0] === this.work.tenant_id && parameters[1] === this.work.work_id;
      return { rows: found ? [structuredClone(this.work)] : [], rowCount: found ? 1 : 0 };
    }
    if (query.startsWith("SELECT core_join_digest,core_join_context FROM tenant_work_core_join")) {
      return { rows: this.join ? [structuredClone(this.join)] : [], rowCount: this.join ? 1 : 0 };
    }
    if (query.startsWith("INSERT INTO tenant_work_core_join")) {
      this.join = { core_join_digest: parameters[2], core_join_context: JSON.parse(parameters[3]),
        persisted_by_user_id: parameters[4] };
      this.insertCount += 1;
      return { rows: [], rowCount: 1 };
    }
    if (query.startsWith("SELECT title,weight,status,required,acceptance_verified FROM tenant_work_task")) {
      return { rows: [], rowCount: 0 };
    }
    if (query.startsWith("SELECT weight,required,independently_verified FROM tenant_work_evidence")) {
      return { rows: [], rowCount: 0 };
    }
    if (query.startsWith("SELECT core_join_digest FROM tenant_work_core_join")) {
      return { rows: this.join ? [{ core_join_digest: this.join.core_join_digest }] : [], rowCount: this.join ? 1 : 0 };
    }
    if (query.startsWith("SELECT count(*) FILTER")) {
      return { rows: [{ dependent_work_count: 0, blocking_dependencies: 0 }], rowCount: 1 };
    }
    if (query.startsWith("UPDATE tenant_work SET progress_bp=")) {
      this.work.progress_bp = parameters[2];
      this.work.progress_version = parameters[3];
      this.work.progress_source = parameters[4];
      this.work.priority = parameters[5];
      this.work.priority_score = parameters[6];
      this.work.priority_version = parameters[7];
      this.work.priority_context = JSON.parse(parameters[8]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`verdict_persistence_query_unhandled:${query}`);
  }
}

test("Generic Work Core Join crosses Universal Core, MCP bridge and V2 persistence fail-closed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generic-work-core-join-e2e-"));
  const keys = crypto.generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const publicKeyFingerprint = crypto.createHash("sha256")
    .update(keys.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const verifierMetadata = Object.freeze({
    key_id: KEY_ID,
    public_key_fingerprint: publicKeyFingerprint,
  });
  const durableStore = createMemoryGenericWorkCoreJoinStore();
  durableStore.restart_durable = true;
  durableStore.distributed = true;
  durableStore.kind = "restart_durable_memory_fixture";
  durableStore.initialize = async () => ({ restart_durable: true, distributed: true });
  const { app } = createApp({
    storageRoot: root,
    mcpTenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: CONTEXT_SECRET,
    dttAgentIdentitySigningSecret: DTT_SECRET,
    hostNativeSigningSecret: HOST_SECRET,
    genericWorkCoreJoinEnabled: true,
    genericWorkCoreJoinStore: durableStore,
    genericWorkCoreJoinEd25519PrivateKey: privateKey,
    genericWorkCoreJoinEd25519KeyId: KEY_ID,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = genericJoinRequest();
  const postCanonical = async (tenantId, payload) => {
    const workContext = issueGenericWorkCoreJoinContext({
      secret: DTT_SECRET,
      tenant_id: tenantId,
      work_id: WORK_ID,
      lease_binding: leaseBinding(tenantId),
      agent_presence: agentPresence(),
      verifier: verifierMetadata,
      method: "POST",
      path: "/v1/work-continuity/generic-core-join",
      body: payload,
    });
    const response = await fetch(`${baseUrl}/v1/work-continuity/generic-core-join`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${GATEWAY_KEY}`,
        "content-type": "application/json",
        "x-sh-tenant-id": tenantId,
        "x-sh-tenant-context": tenantContext(tenantId),
        [GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER]: workContext,
      },
      body: canonicalGenericWorkCoreJoinContextBody(payload),
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    const direct = await postCanonical(TENANT, request);
    assert.equal(direct.status, 201, JSON.stringify(direct.body));
    assert.deepEqual(Object.keys(direct.body), ["ok", "verdict"]);
    assert.equal(direct.body.ok, true);
    const verdict = direct.body.verdict;
    assert.equal(verdict.tenant_id, TENANT);
    assert.equal(verdict.work_id, WORK_ID);
    assert.equal(verdict.adapter, ADAPTER);
    assert.equal(verdict.acceptance_criteria_digest, genericWorkCoreJoinDigest(request.acceptance_criteria));
    assert.equal(verdict.task_state_digest, genericWorkCoreJoinDigest(request.task_state));
    assert.equal(verdict.evidence_digest, genericWorkCoreJoinDigest([...request.evidence_digests].sort()));
    assert.equal(verdict.idempotency_digest, request.idempotency_digest);
    assert.equal(verdict.signature_algorithm, "ed25519");
    assert.equal(verdict.key_id, KEY_ID);
    assert.equal(verdict.host_action_authorized, false);
    assert.equal(verdict.execution_authorized, false);
    assert.match(verdict.signature, /^[A-Za-z0-9_-]+$/);
    assert.equal(verifyGenericCoreJoinVerdict(verdict, { publicKey, keyId: KEY_ID }), true);

    const bridgeIdentity = { tenantId: TENANT, agentPresence: agentPresence() };
    const handlers = createCoreHandlers({ universalCoreUrl: baseUrl, tenantGatewayKey: GATEWAY_KEY,
      tenantContextSigningSecret: CONTEXT_SECRET, dttAgentIdentitySigningSecret: DTT_SECRET }, {
      fetchImpl: fetch,
      genericWorkCoreJoinVerifierMetadata: verifierMetadata,
      resolveGenericWorkCoreJoinBinding: async () => leaseBinding(TENANT, bridgeIdentity.agentPresence),
    });
    const bridged = await handlers.generic_work_core_join_issue(request, bridgeIdentity);
    assert.equal(bridged.structuredContent.ok, true);
    assert.deepEqual(bridged.structuredContent.generic_core_join_verdict, verdict);
    assert.equal(bridged.structuredContent.generic_core_join_verdict.host_action_authorized, false);

    const replay = await postCanonical(TENANT, request);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, direct.body);
    assert.equal(durableStore.events().length, 1);

    const crossTenant = await postCanonical(OTHER_TENANT, request);
    assert.ok([403, 409].includes(crossTenant.status), JSON.stringify(crossTenant));
    assert.notEqual(crossTenant.body.ok, true);

    const malformedHandlers = createCoreHandlers({ universalCoreUrl: baseUrl,
      tenantGatewayKey: GATEWAY_KEY, tenantContextSigningSecret: CONTEXT_SECRET,
      dttAgentIdentitySigningSecret: DTT_SECRET }, {
      genericWorkCoreJoinVerifierMetadata: verifierMetadata,
      resolveGenericWorkCoreJoinBinding: async () => leaseBinding(TENANT, bridgeIdentity.agentPresence),
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, verdict: { ...verdict, work_id: null } }),
        { status: 201, headers: { "content-type": "application/json" } }),
    });
    await assert.rejects(() => malformedHandlers.generic_work_core_join_issue(request, bridgeIdentity),
      /generic_work_core_join_response_invalid/);

    const pool = new VerdictPersistencePool();
    const v2Store = createWorkContinuityV2Store({ pool, coreJoinVerifier: { publicKey, keyId: KEY_ID } });
    assert.equal(v2Store.verifyCoreJoinVerdict(verdict), true);
    const persisted = await v2Store.persistCoreJoin(v2Identity(TENANT), {
      work_id: WORK_ID,
      core_join_digest: verdict.verdict_digest,
      core_join_context: verdict,
    });
    assert.equal(persisted.work.work_id, WORK_ID);
    assert.equal(pool.join.core_join_digest, verdict.verdict_digest);
    assert.equal(pool.join.core_join_context.host_action_authorized, false);
    await v2Store.persistCoreJoin(v2Identity(TENANT), {
      work_id: WORK_ID,
      core_join_digest: verdict.verdict_digest,
      core_join_context: verdict,
    });
    assert.equal(pool.insertCount, 1);
    await assert.rejects(() => v2Store.persistCoreJoin(v2Identity(OTHER_TENANT, "other-owner"), {
      work_id: WORK_ID,
      core_join_digest: verdict.verdict_digest,
      core_join_context: verdict,
    }), /tenant_work_not_found|work_acl_denied/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
