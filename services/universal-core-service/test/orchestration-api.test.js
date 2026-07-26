import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { buildVerificationEvidenceContract } from "../src/verificationEvidenceContract.js";
import { createFileDynamicTaskTreeJoinVerdictStore } from "../src/dynamicTaskTreeJoinVerdictStore.js";
import { issueDttAgentContext } from "../../shared/dtt-agent-identity-receipts.js";

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

test("orchestration API is tenant-bound, paged and proposal-only", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "orchestration-api-admin";
  const storageRoot = path.join(os.tmpdir(), `core-orchestration-${Date.now()}-${Math.random()}`);
  const joinVerdictStore = createFileDynamicTaskTreeJoinVerdictStore({
    root: path.join(storageRoot, "test-join-verdicts"),
  });
  const { app } = createUniversalCoreService({
    storageRoot,
    dynamicTaskTreeJoinVerdictStore: joinVerdictStore,
    dttVerificationTrustStore: {
      verifyArtifact: () => ({ verified: true, registry_id: "api-registry" }),
      verifyAssignment: () => ({ verified: true }),
      assignVerifier: () => { throw new Error("unused"); },
      listAssignments: () => [],
      registerArtifact: () => { throw new Error("unused"); },
    },
    resolveDttVerifierIdentity: ({ tenant_id, verifier_id, identity_receipt }) => ({
      verified: tenant_id === "tenant-orchestration"
        && identity_receipt === `receipt-${verifier_id}`,
      session_fingerprint: `session-${verifier_id}`,
      assignment_id: `assignment-${verifier_id}`,
    }),
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
    assert.equal(tree.json.execution.authorized, false);
    assert.equal(tree.json.execution.core_join_required, true);
    assert.equal(tree.json.limits.max_parallel, 2);

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

    const researchOutcome = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/research/outcomes`, {
      outcome: "verified",
      evidence: evidenceFor(tree.json, "research", 1),
    }, key);
    assert.equal(researchOutcome.status, 200);
    assert.equal(researchOutcome.json.state, "verified");
    const verificationOutcome = await request(base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/outcomes`, {
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
      outcome: "failed",
      evidence: { failure_reference: "first-attempt" },
    }, key);
    assert.equal(retry.json.state, "retry_proposed");
    const retryState = await request(base, "GET", `/v1/orchestration/dtt/${retryTree.json.tree_id}/retry-fallback`, undefined, key);
    assert.equal(retryState.status, 200);
    assert.equal(retryState.json.nodes[0].state, "retry_proposed");
    const fallback = await request(base, "POST", `/v1/orchestration/dtt/${retryTree.json.tree_id}/nodes/attempt/outcomes`, {
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
  const verifier = ({ tenant_id, verifier_id, identity_receipt }) => ({
    verified: tenant_id === "tenant-orchestration"
      && identity_receipt === `receipt-${verifier_id}`,
    session_fingerprint: `session-${verifier_id}`,
    assignment_id: `assignment-${verifier_id}`,
  });

  async function start(joinStore) {
    const { app } = createUniversalCoreService({
      storageRoot,
      dynamicTaskTreeJoinVerdictStore: joinStore,
      resolveDttVerifierIdentity: verifier,
      dttVerificationTrustStore: {
        verifyArtifact: () => ({ verified: true, registry_id: "api-registry" }),
        verifyAssignment: () => ({ verified: true }),
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
      { outcome: "verified", evidence: evidenceFor(tree.json, "verify", 2) },
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
      durableLedger.read({ tenant_id: "tenant-orchestration", tree_id: tree.json.tree_id })
        .map((event) => event.event_type),
      ["issued"],
    );
    await new Promise((resolve) => first.server.close(resolve));
    first = null;

    second = await start(createFileDynamicTaskTreeJoinVerdictStore({ root: ledgerRoot }));
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
      .read({ tenant_id: "tenant-orchestration", tree_id: tree.json.tree_id });
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
      {
        "x-sh-dtt-agent-context": issueDttAgentContext({
          secret,
          tenant_id: "tenant-e2e",
          agent_presence: {
            agent_id: "worker-unassigned",
            opaque_agent_id: "ai_worker_unassigned",
            actor_provenance: "ap_actor_unassigned",
            session_fingerprint: "session_unassigned",
            signature: "ags_worker_unassigned",
            client_type: "codex",
          },
        }),
      },
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
    const presences = ["a", "b"].map((suffix) => ({
      agent_id: `worker-${suffix}`,
      opaque_agent_id: `ai_worker_${suffix}`,
      actor_provenance: `ap_actor_${suffix}`,
      session_fingerprint: `session_${suffix}`,
      signature: `ags_worker_${suffix}`,
      client_type: "codex",
    }));
    const votes = [];
    for (const [presenceIndex, presence] of presences.entries()) {
      const assignmentContext = issueDttAgentContext({
        secret, tenant_id: "tenant-e2e", agent_presence: presence,
      });
      const assignment = await request(
        base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/verifier-assignments`,
        {}, key, { "x-sh-dtt-agent-context": assignmentContext },
      );
      assert.equal(assignment.status, 200);
      if (presenceIndex === 0) {
        const aliasAssignment = await request(
          base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/verifier-assignments`,
          {}, key, {
            "x-sh-dtt-agent-context": issueDttAgentContext({
              secret,
              tenant_id: "tenant-e2e",
              agent_presence: {
                ...presence,
                agent_id: "worker-b",
                opaque_agent_id: "ai_worker_alias_b",
                session_fingerprint: "session_alias_b",
                signature: "ags_worker_alias_b",
              },
            }),
          },
        );
        assert.equal(aliasAssignment.status, 403);
        assert.equal(aliasAssignment.json.error, "dtt_verifier_actor_already_assigned");
      }
      const rationale = `Independent verification by ${presence.agent_id}`;
      const attestationContext = issueDttAgentContext({
        secret, tenant_id: "tenant-e2e", agent_presence: presence,
      });
      const attestation = await request(
        base, "POST", `/v1/orchestration/dtt/${tree.json.tree_id}/nodes/verify/attestations`,
        {
          evidence_digest: draft.json.evidence_digest,
          decision: "approve",
          rationale,
          assignment_id: assignment.json.assignment_id,
        },
        key,
        { "x-sh-dtt-agent-context": attestationContext },
      );
      assert.equal(attestation.status, 200);
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
      { outcome: "verified", evidence_draft: draft.json, votes }, key,
    );
    assert.equal(outcome.status, 200);
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
