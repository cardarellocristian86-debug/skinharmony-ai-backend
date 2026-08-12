import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { buildVerificationEvidenceContract } from "../src/verificationEvidenceContract.js";
import { createFileDynamicTaskTreeJoinVerdictStore } from "../src/dynamicTaskTreeJoinVerdictStore.js";
import { issueDttAgentContext } from "../../shared/dtt-agent-identity-receipts.js";
import { DTT_WORK_CONTEXT_HEADER, issueDttWorkContext } from "../../shared/dtt-work-context.js";

const DTT_WORK_A = "11111111-1111-4111-8111-111111111111";
const DTT_WORK_B = "22222222-2222-4222-8222-222222222222";
const DEFAULT_TEST_DTT_PRINCIPAL = Object.freeze({
  agent_id: "test-dtt-gateway",
  session_id: "test-dtt-gateway-session",
  session_fingerprint: "test-dtt-gateway-session-fingerprint",
  host_transport_session_fingerprint: "test-dtt-gateway-transport-fingerprint",
  presence_signature: "test-dtt-gateway-presence-signature",
  opaque_agent_id: "test-dtt-gateway-opaque-agent",
  actor_provenance: "test-dtt-gateway-actor",
  client_type: "test",
});

function testPrincipalForPresence(presence) {
  return {
    agent_id: presence.agent_id,
    session_id: presence.session_id,
    session_fingerprint: presence.session_fingerprint,
    host_transport_session_fingerprint: presence.host_transport_session_fingerprint,
    presence_signature: presence.signature,
    opaque_agent_id: presence.opaque_agent_id,
    actor_provenance: presence.actor_provenance,
    client_type: presence.client_type,
  };
}

function testAgentContextHeaders({ secret, tenant_id, work_id, agent_presence }) {
  return {
    "x-sh-dtt-agent-context": issueDttAgentContext({
      secret,
      tenant_id,
      work_id,
      agent_presence,
    }),
    "x-test-dtt-principal": Buffer.from(
      JSON.stringify(testPrincipalForPresence(agent_presence)),
      "utf8",
    ).toString("base64url"),
  };
}

function resolveTestDttWorkBinding({ tenant_id, request }) {
  const encodedPrincipal = request.get("x-test-dtt-principal");
  const principal = encodedPrincipal
    ? JSON.parse(Buffer.from(encodedPrincipal, "base64url").toString("utf8"))
    : DEFAULT_TEST_DTT_PRINCIPAL;
  return Object.freeze({
    schema_version: "dtt_work_context_v1",
    tenant_id,
    work_id: request.get("x-test-dtt-work-id") || DTT_WORK_A,
    principal: Object.freeze(principal),
    execution_authorized: false,
  });
}

function signedTenantContext(tenantId, secret) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  const assertion = `mtc_${crypto.createHmac("sha256", secret)
    .update(`mcp-tenant-context\u0000${JSON.stringify(context)}`)
    .digest("hex")}`;
  return Buffer.from(JSON.stringify({ ...context, assertion })).toString("base64url");
}

async function request(base, method, pathname, body, key, extraHeaders = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

function evidenceFor(tree, nodeId, requiredApprovals) {
  const votes = [
    {
      verifier_id: "api-verifier-a",
      identity_receipt: "receipt-api-verifier-a",
      assignment_id: "assignment-api-verifier-a",
      decision: "approve",
      rationale: "Artifact and claim are consistent.",
    },
    ...(requiredApprovals > 1
      ? [{
          verifier_id: "api-verifier-b",
          identity_receipt: "receipt-api-verifier-b",
          assignment_id: "assignment-api-verifier-b",
          decision: "approve",
          rationale: "Independent API verification passed.",
        }]
      : []),
  ];
  return buildVerificationEvidenceContract({
    tenant_id: "tenant-orchestration",
    work_id: tree.work_id,
    tree_id: tree.tree_id,
    node_id: nodeId,
    claim: `API evidence for ${nodeId}`,
    artifacts: [{
      artifact_id: `${nodeId}-api-artifact`,
      content_digest: `sha256:test-${nodeId}`,
      source_reference: `urn:api-test:${nodeId}`,
    }],
    provenance: {
      tenant_id: "tenant-orchestration",
      work_id: tree.work_id,
      tree_id: tree.tree_id,
      node_id: nodeId,
      producer_id: "api-producer",
      source_type: "deterministic_api_test",
      source_reference: "urn:api-test:producer",
    },
    votes,
    required_approvals: requiredApprovals,
  });
}

function resolveApiArtifact(input) {
  return {
    verified: true,
    tenant_id: input.tenant_id,
    work_id: input.work_id,
    artifact_id: input.artifact_id,
    content_digest: input.content_digest,
    source_reference: input.source_reference,
    registry_id: "api-registry",
    execution_authorized: false,
  };
}

function resolveApiVerifier(input) {
  return {
    verified: input.tenant_id === "tenant-orchestration"
      && input.identity_receipt === `receipt-${input.verifier_id}`,
    tenant_id: input.tenant_id,
    work_id: input.work_id,
    tree_id: input.tree_id,
    node_id: input.node_id,
    verifier_id: input.verifier_id,
    evidence_digest: input.evidence_digest,
    session_fingerprint: `session-${input.verifier_id}`,
    assignment_id: input.assignment_id,
    execution_authorized: false,
  };
}

function resolveApiAssignment(input) {
  return {
    verified: true,
    tenant_id: input.tenant_id,
    work_id: input.work_id,
    tree_id: input.tree_id,
    node_id: input.node_id,
    verifier_id: input.verifier_id,
    assignment_id: input.assignment_id,
    execution_authorized: false,
  };
}

test("orchestration API is tenant-and-Work-bound, paged and proposal-only", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "orchestration-api-admin";
  const storageRoot = path.join(os.tmpdir(), `core-orchestration-${Date.now()}-${Math.random()}`);
  const joinVerdictStore = createFileDynamicTaskTreeJoinVerdictStore({
    root: path.join(storageRoot, "test-join-verdicts"),
  });
  const { app } = createUniversalCoreService({
    storageRoot,
    allowTestDttWorkBindingResolver: true,
    resolveDttWorkBinding: resolveTestDttWorkBinding,
    dynamicTaskTreeJoinVerdictStore: joinVerdictStore,
    dttVerificationTrustStore: {
      verifyArtifact: resolveApiArtifact,
      verifyAssignment: resolveApiAssignment,
      assignVerifier: () => { throw new Error("unused"); },
      listAssignments: () => [],
      registerArtifact: () => { throw new Error("unused"); },
    },
    resolveDttVerifierIdentity: resolveApiVerifier,
    dynamicTaskTreeEnv: {
      NODE_ENV: "production",
      CORE_DTT_ENABLED: "true",
      CORE_DTT_MODE: "shadow",
      CORE_DTT_TENANT_ALLOWLIST: "tenant-orchestration",
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const generated = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-orchestration",
      preset: "codex_automation",
    }, "orchestration-api-admin");
    const key = generated.json.key;

    const catalog = await request(
      base,
      "GET",
      "/v1/orchestration/capabilities?branch=agent_orchestration&view=virtual&limit=2",
      undefined,
      key,
    );
    assert.equal(catalog.status, 200);
    assert.equal(catalog.json.tenant_id, "tenant-orchestration");
    assert.equal(catalog.json.items.length, 2);
    assert.equal(catalog.json.items[0].materialized, false);
    assert.equal(catalog.json.execution_authorized, false);

    const deniedRelational = await request(base, "POST", "/v1/orchestration/relational/evaluate", {
      tenant_id: "attacker-tenant",
      objective: "Coordinate bounded work",
      actors: [
        { actor_id: "core", role: "core" },
        { actor_id: "relations", role: "relational_supervisor" },
        { actor_id: "nyra", role: "nyra" },
      ],
      relations: [
        { from: "core", to: "relations", type: "governs" },
        { from: "relations", to: "nyra", type: "coordinates" },
      ],
    }, key);
    assert.equal(deniedRelational.status, 403);
    const relational = await request(base, "POST", "/v1/orchestration/relational/evaluate", {
      objective: "Coordinate bounded work",
      actors: [
        { actor_id: "core", role: "core" },
        { actor_id: "relations", role: "relational_supervisor" },
        { actor_id: "nyra", role: "nyra" },
      ],
      relations: [
        { from: "core", to: "relations", type: "governs" },
        { from: "relations", to: "nyra", type: "coordinates" },
      ],
    }, key);
    assert.equal(relational.status, 200);
    assert.equal(relational.json.tenant_id, "tenant-orchestration");
    assert.equal(relational.json.hierarchy.decision_authority, "universal_core");
    assert.equal(relational.json.guarantees.execution_authorized, false);

    const deniedTree = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      tenant_id: "attacker-tenant",
      objective: "Research, verify and join",
      nodes: [
        { node_id: "research", kind: "research", task: "Collect evidence", depth: 0 },
        {
          node_id: "verify",
          kind: "verification", verification_policy: { required_approvals: 2, allowed_verifier_ids: ["api-verifier-a", "api-verifier-b"] },
          task: "Verify evidence",
          parent_node_id: "research",
          dependencies: ["research"],
          depth: 1,
        },
      ],
    }, key);
    assert.equal(deniedTree.status, 403);
    const tree = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      objective: "Research, verify and join",
      nodes: [
        { node_id: "research", kind: "research", task: "Collect evidence", depth: 0 },
        {
          node_id: "verify",
          kind: "verification", verification_policy: { required_approvals: 2, allowed_verifier_ids: ["api-verifier-a", "api-verifier-b"] },
          task: "Verify evidence",
          parent_node_id: "research",
          dependencies: ["research"],
          depth: 1,
        },
      ],
    }, key);
    assert.equal(tree.status, 200);
    assert.equal(tree.json.tenant_id, "tenant-orchestration");
    assert.equal(tree.json.work_id, DTT_WORK_A);
    assert.equal(tree.json.execution.authorized, false);
    assert.equal(tree.json.execution.core_join_required, true);
    assert.equal(tree.json.limits.max_parallel, 2);
    assert.deepEqual(tree.json.rollout, {
      enabled: true,
      mode: "shadow",
      tenant_allowed: true,
      execution_authorized: false,
      core_join_required: true,
    });

    const workClaimMismatch = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      work_id: DTT_WORK_B,
      objective: "Caller claims another Work",
      nodes: [{ node_id: "analysis", kind: "analysis", task: "Must not be created" }],
    }, key);
    assert.equal(workClaimMismatch.status, 403);
    assert.equal(workClaimMismatch.json.error, "cross_work_task_tree_denied");

    const secondWorkTree = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      objective: "Research, verify and join",
      nodes: [
        { node_id: "research", kind: "research", task: "Collect evidence", depth: 0 },
        {
          node_id: "verify",
          kind: "verification", verification_policy: { required_approvals: 2, allowed_verifier_ids: ["api-verifier-a", "api-verifier-b"] },
          task: "Verify evidence",
          parent_node_id: "research",
          dependencies: ["research"],
          depth: 1,
        },
      ],
    }, key, { "x-test-dtt-work-id": DTT_WORK_B });
    assert.equal(secondWorkTree.status, 200);
    assert.equal(secondWorkTree.json.work_id, DTT_WORK_B);
    assert.notEqual(secondWorkTree.json.tree_id, tree.json.tree_id);

    const crossWorkRead = await request(
      base,
      "GET",
      `/v1/orchestration/dtt/${tree.json.tree_id}`,
      undefined,
      key,
      { "x-test-dtt-work-id": DTT_WORK_B },
    );
    assert.equal(crossWorkRead.status, 403);
    assert.equal(crossWorkRead.json.error, "cross_work_task_tree_denied");

    const read = await request(base, "GET", `/v1/orchestration/dtt/${tree.json.tree_id}`, undefined, key);
    assert.equal(read.status, 200);
    assert.equal(read.json.tree_id, tree.json.tree_id);
    assert.equal(read.json.execution_authorized, false);

    const expansion = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/expansion-proposals`, {
      parent_node_id: "verify",
      nodes: [{ node_id: "join", kind: "join", task: "Propose a bounded join" }],
    }, key);
    assert.equal(expansion.status, 200);
    assert.equal(expansion.json.applied, false);
    assert.equal(expansion.json.execution_authorized, false);

    const replan = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/replan-proposals`, {
      prune_node_ids: ["verify"],
      replacement_nodes: [{
        node_id: "verify_v2",
        kind: "verification", verification_policy: { required_approvals: 2, allowed_verifier_ids: ["api-verifier-a", "api-verifier-b"] },
        task: "Verify replacement",
        parent_node_id: "research",
        dependencies: ["research"],
        depth: 1,
      }],
      reason: "Exercise the non-applying replan surface",
    }, key);
    assert.equal(replan.status, 200);
    assert.equal(replan.json.applied, false);

    const unchanged = await request(base, "GET", `/v1/orchestration/dtt/${tree.json.tree_id}`, undefined, key);
    assert.equal(unchanged.json.nodes.length, 2);
    assert(unchanged.json.nodes.some((node) => node.node_id === "verify"));

    const missingOutcomeKey = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/research/outcomes`, {
      outcome: "verified",
      evidence: evidenceFor(tree.json, "research", 1),
    }, key);
    assert.equal(missingOutcomeKey.status, 400);
    assert.equal(missingOutcomeKey.json.error, "idempotency_key_invalid");
    const researchOutcomeRequest = {
      idempotency_key: "research-verified-1",
      outcome: "verified",
      evidence: evidenceFor(tree.json, "research", 1),
    };
    const researchOutcome = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/research/outcomes`, researchOutcomeRequest, key);
    assert.equal(researchOutcome.status, 200);
    assert.equal(researchOutcome.json.state, "verified");
    const researchReplay = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/research/outcomes`, researchOutcomeRequest, key);
    assert.equal(researchReplay.status, 200);
    assert.deepEqual(researchReplay.json, researchOutcome.json);
    const researchConflict = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/research/outcomes`, {
      ...researchOutcomeRequest,
      evidence: { changed: true },
    }, key);
    assert.equal(researchConflict.status, 409);
    assert.equal(researchConflict.json.error, "outcome_idempotency_key_conflict");
    const afterResearch = await request(base, "GET", `/v1/orchestration/dtt/${tree.json.tree_id}`, undefined, key);
    assert.equal(Object.hasOwn(afterResearch.json, "outcome_idempotency"), false);
    assert.equal(afterResearch.json.nodes.find((node) => node.node_id === "research").attempts, 1);
    const verificationOutcome = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/outcomes`, {
      idempotency_key: "verification-verified-1",
      outcome: "verified",
      evidence: evidenceFor(tree.json, "verify", 2),
    }, key);
    assert.equal(verificationOutcome.status, 200);
    assert.equal(verificationOutcome.json.state, "verified");

    const forgedJoin = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/core-join`, {
      verdict_reference: "caller-manufactured-allow",
      allowed: true,
      authority: "universal_core",
    }, key);
    assert.equal(forgedJoin.status, 400);
    assert.equal(forgedJoin.json.error, "client_core_verdict_denied");

    const joined = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/core-join`, {}, key);
    assert.equal(joined.status, 200);
    assert.equal(joined.json.status, "core_joined");
    assert.equal(joined.json.core_join.authority, "universal_core");
    assert.match(joined.json.core_join.verdict_reference, /^dttv_[a-f0-9]{64}$/);
    assert.equal(joined.json.core_join.verification.source, "universal_core_persisted_tree_inspection");
    assert.equal(joined.json.execution_authorized, false);
    assert.deepEqual(
      joinVerdictStore.read({
        tenant_id: "tenant-orchestration",
        work_id: DTT_WORK_A,
        tree_id: tree.json.tree_id,
      }).map((event) => event.event_type),
      ["issued", "consumed"],
    );
    const replayedJoin = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/core-join`, {}, key);
    assert.equal(replayedJoin.status, 409);
    assert.equal(replayedJoin.json.error, "task_tree_already_joined");

    const retryTree = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      objective: "Expose retry fallback and cancellation",
      nodes: [
        {
          node_id: "attempt",
          kind: "analysis",
          task: "Attempt bounded work",
          retry_policy: { max_attempts: 1 },
          fallback_node_id: "fallback",
        },
        { node_id: "fallback", kind: "analysis", task: "Propose fallback" },
        { node_id: "verify_retry", kind: "verification", verification_policy: { required_approvals: 2, allowed_verifier_ids: ["api-verifier-a", "api-verifier-b"] }, task: "Verify recovery" },
      ],
    }, key);
    assert.equal(retryTree.status, 200);
    const retry = await request(base, "POST", `/v1/orchestration/dtt/${retryTree.json.tree_id}/nodes/attempt/outcomes`, {
      idempotency_key: "retry-failed-1",
      outcome: "failed",
      evidence: { failure_reference: "first-attempt" },
    }, key);
    assert.equal(retry.json.state, "retry_proposed");
    const retryState = await request(base, "GET", `/v1/orchestration/dtt/${retryTree.json.tree_id}/retry-fallback`, undefined, key);
    assert.equal(retryState.status, 200);
    assert.equal(retryState.json.nodes[0].state, "retry_proposed");
    const fallback = await request(base, "POST", `/v1/orchestration/dtt/${retryTree.json.tree_id}/nodes/attempt/outcomes`, {
      idempotency_key: "retry-failed-2",
      outcome: "failed",
      evidence: { failure_reference: "second-attempt" },
    }, key);
    assert.equal(fallback.json.state, "fallback_proposed");
    const fallbackState = await request(base, "GET", `/v1/orchestration/dtt/${retryTree.json.tree_id}/retry-fallback`, undefined, key);
    assert.equal(fallbackState.json.nodes[0].state, "fallback_proposed");
    const cancelled = await request(base, "POST", `/v1/orchestration/dtt/${retryTree.json.tree_id}/cancel`, {
      reason: "API cancellation test",
    }, key);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.status, "cancelled");
    assert.equal(cancelled.json.kill_signal.propagated, true);

    const otherTenantKey = (await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-other",
      preset: "codex_automation",
    }, "orchestration-api-admin")).json.key;
    const crossTenantRead = await request(
      base,
      "GET",
      `/v1/orchestration/dtt/${tree.json.tree_id}`,
      undefined,
      otherTenantKey,
    );
    assert.equal(crossTenantRead.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("a direct tenant Core key cannot substitute for an authenticated DTT Work context", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "dtt-work-auth-admin";
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `dtt-work-auth-${Date.now()}-${Math.random()}`),
    dynamicTaskTreeEnv: {
      NODE_ENV: "production",
      CORE_DTT_ENABLED: "true",
      CORE_DTT_MODE: "shadow",
      CORE_DTT_TENANT_ALLOWLIST: "tenant-direct-key",
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const generated = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-direct-key",
      preset: "codex_automation",
    }, "dtt-work-auth-admin");
    assert.equal(generated.status, 201);

    const denied = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      work_id: DTT_WORK_A,
      objective: "A caller-provided Work selector is not an authority",
      nodes: [{ node_id: "analysis", kind: "analysis", task: "Must remain unavailable" }],
      work_preflight: { state: "READY", execution_allowed: true },
      gallery_context: { work_id: DTT_WORK_A, active_lease: true },
    }, generated.json.key);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, "dtt_work_gateway_required");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("the production DTT boundary verifies a request-bound gateway Work context", async () => {
  const tenantId = "tenant-dtt-work-context";
  const gatewayKey = "dtt-work-context-gateway-key-01234567890123456789";
  const tenantSecret = "dtt-work-tenant-context-secret-01234567890123456789";
  const workSecret = "dtt-work-request-context-secret-01234567890123456789";
  const storageRoot = path.join(os.tmpdir(), `dtt-work-context-${Date.now()}-${Math.random()}`);
  const { app } = createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: gatewayKey,
    tenantContextSigningSecret: tenantSecret,
    dttAgentIdentitySigningSecret: workSecret,
    dynamicTaskTreeEnv: {
      NODE_ENV: "production",
      CORE_DTT_ENABLED: "true",
      CORE_DTT_MODE: "shadow",
      CORE_DTT_TENANT_ALLOWLIST: tenantId,
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pathname = "/v1/orchestration/dtt/plan";
  const body = {
    objective: "Bind one exact Work to one exact DTT request",
    nodes: [{ node_id: "analysis", kind: "analysis", task: "Remain non-executive" }],
  };
  const nowMs = Date.now();
  const presence = {
    agent_id: "dtt-bound-agent",
    session_id: "dtt-bound-session",
    session_fingerprint: "a".repeat(64),
    host_transport_session_fingerprint: "b".repeat(64),
    signature: `ags_${"c".repeat(32)}`,
    opaque_agent_id: `ai_${"d".repeat(32)}`,
    actor_provenance: `ap_${"e".repeat(32)}`,
    client_type: "codex",
    transport_bound: true,
  };
  const leaseBinding = {
    schema_version: "dtt_work_lease_binding_v1",
    tenant_id: tenantId,
    work_id: DTT_WORK_A,
    lease_id: "33333333-3333-4333-8333-333333333333",
    expires_at: new Date(nowMs + 120_000).toISOString(),
    participant_expires_at: new Date(nowMs + 120_000).toISOString(),
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
  const gatewayHeaders = {
    "x-sh-tenant-id": tenantId,
    "x-sh-tenant-context": signedTenantContext(tenantId, tenantSecret),
  };
  const tokenFor = (overrides = {}) => issueDttWorkContext({
    secret: workSecret,
    tenant_id: tenantId,
    work_id: DTT_WORK_A,
    lease_binding: leaseBinding,
    agent_presence: presence,
    method: "POST",
    path: pathname,
    body,
    now_ms: nowMs,
    ...overrides,
  });
  try {
    const valid = await request(base, "POST", pathname, body, gatewayKey, {
      ...gatewayHeaders,
      [DTT_WORK_CONTEXT_HEADER]: tokenFor(),
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.json.work_id, DTT_WORK_A);
    assert.equal(valid.json.execution_authorized, false);

    const missing = await request(base, "POST", pathname, body, gatewayKey, gatewayHeaders);
    assert.equal(missing.status, 403);
    assert.equal(missing.json.error, "dtt_work_context_token_invalid");

    const tamperCases = [
      {
        label: "body",
        token: tokenFor(),
        sendBody: { ...body, objective: "Tampered after signing" },
      },
      { label: "method", token: tokenFor({ method: "GET" }), sendBody: body },
      { label: "path", token: tokenFor({ path: "/v1/orchestration/dtt/not-the-plan-route" }), sendBody: body },
      {
        label: "expiry",
        token: tokenFor({ now_ms: nowMs - 10_000, ttl_ms: 1_000 }),
        sendBody: body,
        expected: "dtt_work_context_expired",
      },
    ];
    for (const item of tamperCases) {
      const denied = await request(base, "POST", pathname, item.sendBody, gatewayKey, {
        ...gatewayHeaders,
        [DTT_WORK_CONTEXT_HEADER]: item.token,
      });
      assert.equal(denied.status, 403, item.label);
      assert.equal(denied.json.error, item.expected || "dtt_work_context_request_mismatch", item.label);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("DTT outcome API reports persisted receipt corruption as an internal failure", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "orchestration-corruption-admin";
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `core-orchestration-corruption-${Date.now()}-${Math.random()}`),
    allowTestDttWorkBindingResolver: true,
    resolveDttWorkBinding: resolveTestDttWorkBinding,
    dynamicTaskTreeRuntime: {
      recordOutcome: async () => { throw new Error("dynamic_task_tree_state_corrupt"); },
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const generated = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-orchestration",
      preset: "codex_automation",
    }, "orchestration-corruption-admin");
    const response = await request(
      base,
      "POST",
      "/v1/orchestration/dtt/dtt_aaaaaaaaaaaaaaaaaaaaaaaa/nodes/analysis/outcomes",
      { idempotency_key: "corrupt-receipt", outcome: "failed", evidence: {} },
      generated.json.key,
    );
    assert.equal(response.status, 500);
    assert.deepEqual(response.json, {
      ok: false,
      error: "dynamic_task_tree_state_corrupt",
      message: "dynamic_task_tree_state_corrupt",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("DTT join reconciles a durable joined tree after consume failure and restart", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "orchestration-recovery-admin";
  const storageRoot = path.join(os.tmpdir(), `core-orchestration-recovery-${Date.now()}-${Math.random()}`);
  const ledgerRoot = path.join(storageRoot, "join-verdicts");
  const durableLedger = createFileDynamicTaskTreeJoinVerdictStore({ root: ledgerRoot });
  const failingLedger = {
    ...durableLedger,
    consume: async () => {
      throw new Error("fault_injected_consume_failure");
    },
  };
  const verifier = resolveApiVerifier;

  async function start(joinStore) {
    const { app } = createUniversalCoreService({
      storageRoot,
      allowTestDttWorkBindingResolver: true,
      resolveDttWorkBinding: resolveTestDttWorkBinding,
      dynamicTaskTreeJoinVerdictStore: joinStore,
      resolveDttVerifierIdentity: verifier,
      dttVerificationTrustStore: {
        verifyArtifact: resolveApiArtifact,
        verifyAssignment: resolveApiAssignment,
        assignVerifier: () => { throw new Error("unused"); },
        listAssignments: () => [],
        registerArtifact: () => { throw new Error("unused"); },
      },
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      server,
      base: `http://127.0.0.1:${server.address().port}`,
    };
  }

  let first;
  let second;
  try {
    first = await start(failingLedger);
    const generated = await request(first.base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-orchestration",
      preset: "codex_automation",
    }, "orchestration-recovery-admin");
    const key = generated.json.key;
    const tree = await request(first.base, "POST", "/v1/orchestration/dtt/plan", {
      objective: "Recover join finalization after restart",
      nodes: [{ node_id: "verify", kind: "verification", verification_policy: { required_approvals: 2, allowed_verifier_ids: ["api-verifier-a", "api-verifier-b"] }, task: "Verify durable recovery" }],
    }, key);
    assert.equal(tree.status, 200);
    const outcome = await request(
      first.base,
      "POST",
      `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/outcomes`,
      { idempotency_key: "restart-verified-1", outcome: "verified", evidence: evidenceFor(tree.json, "verify", 2) },
      key,
    );
    assert.equal(outcome.status, 200);

    const interrupted = await request(
      first.base,
      "POST",
      `/v1/orchestration/dtt/${tree.json.tree_id}/core-join`,
      {},
      key,
    );
    assert.equal(interrupted.status, 503);
    assert.equal(interrupted.json.error, "dtt_join_finalization_pending");
    const joinedBeforeRestart = await request(
      first.base,
      "GET",
      `/v1/orchestration/dtt/${tree.json.tree_id}`,
      undefined,
      key,
    );
    assert.equal(joinedBeforeRestart.json.status, "core_joined");
    assert.deepEqual(
      durableLedger.read({ tenant_id: "tenant-orchestration", work_id: DTT_WORK_A, tree_id: tree.json.tree_id })
        .map((event) => event.event_type),
      ["issued"],
    );
    await new Promise((resolve) => first.server.close(resolve));
    first = null;

    second = await start(createFileDynamicTaskTreeJoinVerdictStore({ root: ledgerRoot }));
    const outcomeReplay = await request(
      second.base,
      "POST",
      `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/outcomes`,
      { idempotency_key: "restart-verified-1", outcome: "verified", evidence: evidenceFor(tree.json, "verify", 2) },
      key,
    );
    assert.equal(outcomeReplay.status, 200);
    assert.deepEqual(outcomeReplay.json, outcome.json);
    const replayedTree = await request(
      second.base,
      "GET",
      `/v1/orchestration/dtt/${tree.json.tree_id}`,
      undefined,
      key,
    );
    assert.equal(Object.hasOwn(replayedTree.json, "outcome_idempotency"), false);
    assert.equal(replayedTree.json.nodes[0].attempts, 1);
    const recovered = await request(
      second.base,
      "POST",
      `/v1/orchestration/dtt/${tree.json.tree_id}/core-join`,
      {},
      key,
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.json.reconciled, true);
    assert.equal(recovered.json.status, "core_joined");
    const events = createFileDynamicTaskTreeJoinVerdictStore({ root: ledgerRoot })
      .read({ tenant_id: "tenant-orchestration", work_id: DTT_WORK_A, tree_id: tree.json.tree_id });
    assert.deepEqual(events.map((event) => event.event_type), ["issued", "consumed"]);
    assert.equal(events.some((event) => event.event_type === "voided"), false);

    const replay = await request(
      second.base,
      "POST",
      `/v1/orchestration/dtt/${tree.json.tree_id}/core-join`,
      {},
      key,
    );
    assert.equal(replay.status, 409);
    assert.equal(replay.json.error, "task_tree_already_joined");
  } finally {
    if (first) await new Promise((resolve) => first.server.close(resolve));
    if (second) await new Promise((resolve) => second.server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("signed assigned agents complete artifact registry, draft, quorum, outcome and Core join end to end", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "dtt-e2e-admin";
  const secret = "dtt-e2e-shared-identity-secret-0000000000000000";
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `dtt-e2e-${Date.now()}-${Math.random()}`),
    allowTestDttWorkBindingResolver: true,
    resolveDttWorkBinding: resolveTestDttWorkBinding,
    dttAgentIdentitySigningSecret: secret,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const generated = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-e2e", preset: "codex_automation",
    }, "dtt-e2e-admin");
    const key = generated.json.key;
    const tree = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      objective: "Verify registered evidence",
      nodes: [{
        node_id: "verify",
        kind: "verification",
        task: "Independent verification",
        verification_policy: {
          required_approvals: 2,
          allowed_verifier_ids: ["worker-a", "worker-b"],
        },
      }],
    }, key);
    assert.equal(tree.status, 200);
    const deniedAssignment = await request(
      base,
      "POST",
      `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/verifier-assignments`,
      {},
      key,
      testAgentContextHeaders({
        secret,
        tenant_id: "tenant-e2e",
        work_id: DTT_WORK_A,
        agent_presence: {
          agent_id: "worker-unassigned",
          opaque_agent_id: "ai_worker_unassigned",
          actor_provenance: "ap_actor_unassigned",
          session_id: "session-id-unassigned",
          session_fingerprint: "session_unassigned",
          host_transport_session_fingerprint: "transport_unassigned",
          signature: "ags_worker_unassigned",
          client_type: "codex",
        },
      }),
    );
    assert.equal(deniedAssignment.status, 403);
    const artifact = await request(base, "POST", "/v1/orchestration/evidence/artifacts", {
      artifact_id: "artifact-e2e",
      content: "immutable reviewed evidence",
      source_reference: "urn:e2e:source",
      registry_reference: "urn:e2e:registry",
    }, key);
    assert.equal(artifact.status, 200);
    assert.match(artifact.json.content_digest, /^sha256:/);
    assert.equal(artifact.json.execution_authorized, false);
    const draft = await request(
      base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/evidence-drafts`,
      {
        claim: "The registered artifact supports the claim.",
        artifacts: [{
          artifact_id: artifact.json.artifact_id,
          content_digest: artifact.json.content_digest,
          source_reference: artifact.json.source_reference,
        }],
        provenance: {
          producer_id: "producer-e2e",
          source_type: "registered_evidence",
          source_reference: artifact.json.registry_reference,
        },
        required_approvals: 2,
      },
      key,
    );
    assert.equal(draft.status, 200);
    assert.equal(draft.json.execution_authorized, false);
    const presences = ["a", "b"].map((suffix) => ({
      agent_id: `worker-${suffix}`,
      opaque_agent_id: `ai_worker_${suffix}`,
      actor_provenance: `ap_actor_${suffix}`,
      session_id: `session-id-${suffix}`,
      session_fingerprint: `session_${suffix}`,
      host_transport_session_fingerprint: `transport_${suffix}`,
      signature: `ags_worker_${suffix}`,
      client_type: "codex",
    }));
    const votes = [];
    for (const [presenceIndex, presence] of presences.entries()) {
      const assignment = await request(
        base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/verifier-assignments`,
        {}, key, testAgentContextHeaders({
          secret, tenant_id: "tenant-e2e", work_id: DTT_WORK_A, agent_presence: presence,
        }),
      );
      assert.equal(assignment.status, 200);
      assert.equal(assignment.json.execution_authorized, false);
      if (presenceIndex === 0) {
        const aliasAssignment = await request(
          base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/verifier-assignments`,
          {}, key, testAgentContextHeaders({
            secret,
            tenant_id: "tenant-e2e",
            work_id: DTT_WORK_A,
            agent_presence: {
              ...presence,
              agent_id: "worker-b",
              opaque_agent_id: "ai_worker_alias_b",
              session_id: "session-id-alias-b",
              session_fingerprint: "session_alias_b",
              host_transport_session_fingerprint: "transport_alias_b",
              signature: "ags_worker_alias_b",
            },
          }),
        );
        assert.equal(aliasAssignment.status, 403);
        assert.equal(aliasAssignment.json.error, "dtt_verifier_actor_already_assigned");
      }
      const rationale = `Independent verification by ${presence.agent_id}`;
      const attestation = await request(
        base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/attestations`,
        {
          evidence_digest: draft.json.evidence_digest,
          decision: "approve",
          rationale,
          assignment_id: assignment.json.assignment_id,
        },
        key,
        testAgentContextHeaders({
          secret, tenant_id: "tenant-e2e", work_id: DTT_WORK_A, agent_presence: presence,
        }),
      );
      assert.equal(attestation.status, 200);
      assert.equal(attestation.json.execution_authorized, false);
      votes.push({
        verifier_id: attestation.json.verifier_id,
        identity_receipt: attestation.json.identity_receipt,
        assignment_id: assignment.json.assignment_id,
        decision: "approve",
        rationale,
      });
    }
    const outcome = await request(
      base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/outcomes`,
      { idempotency_key: "signed-verified-1", outcome: "verified", evidence_draft: draft.json, votes }, key,
    );
    assert.equal(outcome.status, 200);
    assert.equal(outcome.json.execution_authorized, false);
    const joined = await request(
      base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/core-join`, {}, key,
    );
    assert.equal(joined.status, 200);
    assert.equal(joined.json.status, "core_joined");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("DTT persistent-store corruption is always reported as an internal failure", async (t) => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.CORE_SERVICE_ADMIN_KEY = "dtt-corruption-admin";
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });
  const treeId = "dtt_999999999999999999999999";
  const corrupt = (code) => { throw new Error(code); };
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `dtt-corruption-${Date.now()}-${Math.random()}`),
    allowTestDttWorkBindingResolver: true,
    resolveDttWorkBinding: resolveTestDttWorkBinding,
    dynamicTaskTreeRuntime: {
      get: async ({ tenant_id, work_id, tree_id }) => ({
        tenant_id,
        work_id,
        tree_id,
        status: "advisory_ready",
        nodes: [{ node_id: "verify", status: "pending" }],
        execution_authorized: false,
      }),
      inspectCoreJoin: async ({ tenant_id, work_id, tree_id }) => ({
        tenant_id,
        work_id,
        tree_id,
        evidence_set_digest: "dttset_corruption_probe",
        verified_node_count: 1,
        verification_node_count: 1,
        execution_authorized: false,
      }),
    },
    dynamicTaskTreeJoinVerdictStore: {
      kind: "corrupt_test",
      restart_durable: true,
      distributed: false,
      read: async () => corrupt("dtt_join_verdict_ledger_integrity_failed"),
    },
    dttVerificationTrustStore: {
      kind: "corrupt_test",
      distributed: false,
      registerArtifact: async () => corrupt("dtt_verification_trust_store_corrupt"),
      verifyArtifact: async () => ({ verified: false, execution_authorized: false }),
      verifyAssignment: async () => ({ verified: false, execution_authorized: false }),
      assignVerifier: async () => corrupt("dtt_verification_trust_store_corrupt"),
      listAssignments: async () => corrupt("dtt_verification_trust_store_corrupt"),
    },
    dttAgentIdentityReceiptService: {
      configured: true,
      issue: async () => corrupt("dtt_agent_identity_store_corrupt"),
      verifyContext: () => corrupt("dtt_agent_identity_store_corrupt"),
      size: () => 0,
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const generated = await request(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant-corruption", preset: "codex_automation",
  }, "dtt-corruption-admin");
  assert.equal(generated.status, 201);
  const key = generated.json.key;

  const artifact = await request(base, "POST", "/v1/orchestration/evidence/artifacts", {
    artifact_id: "artifact-corruption",
    content: "bounded test evidence",
    source_reference: "urn:test:corruption",
    registry_reference: "urn:test:registry",
  }, key);
  assert.equal(artifact.status, 500);
  assert.equal(artifact.json.error, "dtt_verification_trust_store_corrupt");

  const attestation = await request(
    base,
    "POST",
    `/v1/orchestration/dtt/${treeId}/nodes/verify/attestations`,
    {
      evidence_digest: `evd_${"a".repeat(64)}`,
      decision: "approve",
      rationale: "Corruption status probe.",
      assignment_id: `dtta_${"b".repeat(32)}`,
    },
    key,
  );
  assert.equal(attestation.status, 500);
  assert.equal(attestation.json.error, "dtt_agent_identity_store_corrupt");

  const join = await request(base, "POST", `/v1/orchestration/dtt/${treeId}/core-join`, {}, key);
  assert.equal(join.status, 500);
  assert.equal(join.json.error, "dtt_join_verdict_ledger_integrity_failed");
});
