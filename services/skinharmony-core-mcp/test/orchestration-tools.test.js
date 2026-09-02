import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";
import {
  DTT_WORK_CONTEXT_HEADER,
  DTT_WORK_READ_CONTEXT_HEADER,
  verifyDttWorkContext,
  verifyDttWorkReadContext,
} from "../../shared/dtt-work-context.js";

test("orchestration MCP tools expose accurate mutation hints and map to tenant-and-Work-bound Core routes", async () => {
  const calls = [];
  const bindingRequests = [];
  const readBindingRequests = [];
  const workId = "11111111-1111-4111-8111-111111111111";
  const leaseId = "22222222-2222-4222-8222-222222222222";
  const dttSigningSecret = "dtt-work-context-test-signing-secret-0001";
  const gatewayKey = "tenant-gateway-test-key-000000000001";
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    tenantGatewayKey: gatewayKey,
    tenantContextSigningSecret: "tenant-context-test-signing-secret-0001",
    dttAgentIdentitySigningSecret: dttSigningSecret,
  }, {
    resolveDttWorkBinding: async (identity, requestedWorkId) => {
      bindingRequests.push(requestedWorkId);
      return {
        schema_version: "dtt_work_lease_binding_v1",
        tenant_id: identity.tenantId,
        work_id: requestedWorkId,
        lease_id: leaseId,
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        participant_expires_at: new Date(Date.now() + 300_000).toISOString(),
        session_id: identity.agentPresence.session_id,
        agent_id: identity.agentPresence.agent_id,
        client_type: identity.agentPresence.client_type,
        session_fingerprint: identity.agentPresence.session_fingerprint,
        host_transport_session_fingerprint: identity.agentPresence.host_transport_session_fingerprint,
        presence_signature: identity.agentPresence.signature,
        opaque_agent_id: identity.agentPresence.opaque_agent_id,
        actor_provenance: identity.agentPresence.actor_provenance,
        execution_authorized: false,
      };
    },
    resolveDttWorkReadBinding: async (identity, requestedWorkId) => {
      readBindingRequests.push(requestedWorkId);
      return {
        schema_version: "dtt_work_acl_read_binding_v1",
        authorization_source: "tenant_work_v2_acl",
        tenant_id: identity.tenantId,
        work_id: requestedWorkId,
        execution_authorized: false,
      };
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const identity = {
    tenantId: "tenant-a",
    agentPresence: {
      transport_bound: true,
      agent_id: "agent-a",
      session_id: "session-a",
      session_fingerprint: "a".repeat(24),
      host_transport_session_fingerprint: "b".repeat(24),
      signature: `ags_${"c".repeat(32)}`,
      opaque_agent_id: `ai_${"d".repeat(24)}`,
      actor_provenance: `ap_${"e".repeat(32)}`,
      client_type: "codex",
    },
  };

  await handlers.orchestration_capability_catalog({
    branch: "agent_orchestration",
    view: "virtual",
    cursor: "10",
    limit: 2,
  }, identity);
  await handlers.orchestration_relational_evaluate({
    objective: "Coordinate",
    actors: [
      { actor_id: "core", role: "core" },
      { actor_id: "relations", role: "relational_supervisor" },
      { actor_id: "nyra", role: "nyra" },
    ],
    relations: [
      { from: "core", to: "relations", type: "governs" },
      { from: "relations", to: "nyra", type: "coordinates" },
    ],
  }, identity);
  await handlers.orchestration_dtt_plan({
    work_id: workId,
    objective: "Verify",
    nodes: [{ node_id: "verify", kind: "verification", task: "Verify" }],
  }, identity);
  await handlers.orchestration_dtt_read({ work_id: workId, tree_id: "dtt_test" }, identity);
  await handlers.orchestration_dtt_verification_readiness({ work_id: workId, tree_id: "dtt_test" }, identity);
  await handlers.orchestration_dtt_expansion_propose({
    work_id: workId,
    tree_id: "dtt_test",
    parent_node_id: "verify",
    nodes: [{ node_id: "join", kind: "join", task: "Join" }],
  }, identity);
  await handlers.orchestration_dtt_replan_propose({
    work_id: workId,
    tree_id: "dtt_test",
    prune_node_ids: ["verify"],
    replacement_nodes: [{ node_id: "verify_v2", kind: "verification", task: "Verify again" }],
    reason: "Evidence changed",
  }, identity);
  await handlers.orchestration_dtt_outcome_record({
    work_id: workId,
    tree_id: "dtt_test",
    node_id: "verify",
    idempotency_key: "outcome-verify-v1",
    outcome: "verified",
    evidence: {
      schema_version: "verification_evidence_contract_v2",
      work_id: workId,
      execution_authorized: false,
    },
  }, identity);
  await handlers.orchestration_dtt_evidence_prepare({
    work_id: workId,
    tree_id: "dtt_test",
    node_id: "verify",
    claim: "Verified",
    artifacts: [{ artifact_id: "artifact-a", artifact_digest: "a".repeat(64) }],
    provenance: {
      producer_id: "agent-a",
      source_type: "test",
      source_reference: "focused-test",
    },
    required_approvals: 1,
  }, identity);
  await handlers.orchestration_dtt_agent_attest({
    work_id: workId,
    tree_id: "dtt_test",
    node_id: "verify",
    evidence_digest: `evd_${"f".repeat(64)}`,
    decision: "approve",
    rationale: "Evidence verified",
    assignment_id: `dtta_${"1".repeat(32)}`,
  }, identity);
  await handlers.orchestration_dtt_verifier_assign_self({
    work_id: workId,
    tree_id: "dtt_test",
    node_id: "verify",
  }, identity);
  await handlers.orchestration_dtt_artifact_register({
    work_id: workId,
    artifact_id: "artifact-a",
    content: "immutable test evidence",
    source_reference: "focused-test",
    registry_reference: "registry-a",
  }, identity);
  await handlers.orchestration_dtt_cancel({
    work_id: workId,
    tree_id: "dtt_test",
    reason: "Bounded cancellation",
  }, identity);
  await handlers.orchestration_dtt_retry_fallback_read({ work_id: workId, tree_id: "dtt_test" }, identity);
  await handlers.orchestration_dtt_core_join({
    work_id: workId,
    tree_id: "dtt_test",
  }, identity);

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/v1/orchestration/capabilities",
    "/v1/orchestration/relational/evaluate",
    "/v1/orchestration/dtt/plan",
    "/v1/orchestration/dtt/dtt_test",
    "/v1/orchestration/dtt/dtt_test/verification-readiness",
    "/v1/orchestration/dtt/dtt_test/expansion-proposals",
    "/v1/orchestration/dtt/dtt_test/replan-proposals",
    "/v1/orchestration/dtt/dtt_test/nodes/verify/outcomes",
    "/v1/orchestration/dtt/dtt_test/nodes/verify/evidence-drafts",
    "/v1/orchestration/dtt/dtt_test/nodes/verify/attestations",
    "/v1/orchestration/dtt/dtt_test/nodes/verify/verifier-assignments",
    "/v1/orchestration/evidence/artifacts",
    "/v1/orchestration/dtt/dtt_test/cancel",
    "/v1/orchestration/dtt/dtt_test/retry-fallback",
    "/v1/orchestration/dtt/dtt_test/core-join",
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get("branch"), "agent_orchestration");
  assert.equal(new URL(calls[0].url).searchParams.get("view"), "virtual");
  assert(calls.slice(0, 2).every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert(calls.slice(2).every((call) => call.init.headers.authorization === `Bearer ${gatewayKey}`));
  assert.deepEqual(bindingRequests, Array(10).fill(workId));
  assert.deepEqual(readBindingRequests, Array(3).fill(workId));
  const durableReadIndexes = new Set([3, 4, 13]);
  for (const [index, call] of calls.entries()) {
    if (index < 2) continue;
    const path = new URL(call.url).pathname;
    const body = call.init.body === undefined ? undefined : JSON.parse(call.init.body);
    if (durableReadIndexes.has(index)) {
      assert.equal(call.init.headers[DTT_WORK_CONTEXT_HEADER], undefined);
      const binding = verifyDttWorkReadContext({
        token: call.init.headers[DTT_WORK_READ_CONTEXT_HEADER],
        secret: dttSigningSecret,
        expected_tenant_id: "tenant-a",
        expected_work_id: workId,
        method: call.init.method || "GET",
        path,
        body,
      });
      assert.equal(binding.schema_version, "dtt_work_read_context_v1");
      assert.equal(binding.work_id, workId);
      assert.equal(binding.authorization.authorization_source, "tenant_work_v2_acl");
      assert.equal(Object.hasOwn(binding, "lease"), false);
      assert.equal(binding.execution_authorized, false);
      continue;
    }
    assert.equal(call.init.headers[DTT_WORK_READ_CONTEXT_HEADER], undefined);
    const binding = verifyDttWorkContext({
      token: call.init.headers[DTT_WORK_CONTEXT_HEADER],
      secret: dttSigningSecret,
      expected_tenant_id: "tenant-a",
      expected_work_id: workId,
      method: call.init.method || "GET",
      path,
      body,
    });
    assert.equal(binding.schema_version, "dtt_work_context_v1");
    assert.equal(binding.work_id, workId);
    assert.equal(binding.lease.lease_id, leaseId);
    assert.equal(binding.execution_authorized, false);
    assert.equal(Object.isFrozen(binding), true);
  }
  assert.equal("tenant_id" in JSON.parse(calls[1].init.body), false);
  assert.equal("tenant_id" in JSON.parse(calls[2].init.body), false);
  assert.equal("tenant_id" in JSON.parse(calls[5].init.body), false);
  assert.equal(JSON.parse(calls[7].init.body).idempotency_key, "outcome-verify-v1");
  assert.equal("authority" in JSON.parse(calls.at(-1).init.body), false);
  assert.equal("verdict_reference" in JSON.parse(calls.at(-1).init.body), false);

  for (const name of [
    "orchestration_capability_catalog",
    "orchestration_relational_evaluate",
    "orchestration_dtt_plan",
    "orchestration_dtt_read",
    "orchestration_dtt_verification_readiness",
    "orchestration_dtt_expansion_propose",
    "orchestration_dtt_replan_propose",
    "orchestration_dtt_evidence_prepare",
    "orchestration_dtt_retry_fallback_read",
  ]) {
    const definition = TOOLS.find((item) => item.name === name);
    assert(definition);
    assert.equal(definition.annotations.readOnlyHint, true);
    assert.equal(definition.annotations.destructiveHint, false);
  }

  for (const name of [
    "orchestration_dtt_outcome_record",
    "orchestration_dtt_agent_attest",
    "orchestration_dtt_verifier_assign_self",
    "orchestration_dtt_artifact_register",
    "orchestration_dtt_cancel",
    "orchestration_dtt_core_join",
  ]) {
    const definition = TOOLS.find((item) => item.name === name);
    assert(definition);
    assert.equal(definition.annotations.readOnlyHint, false);
  }
  assert.equal(
    TOOLS.find((item) => item.name === "orchestration_dtt_cancel").annotations.destructiveHint,
    true,
  );
  const outcomeDefinition = TOOLS.find((item) => item.name === "orchestration_dtt_outcome_record");
  assert(outcomeDefinition.inputSchema.required.includes("idempotency_key"));
  assert.deepEqual(outcomeDefinition.inputSchema.properties.idempotency_key, {
    type: "string",
    minLength: 1,
    maxLength: 200,
  });
  const evidenceSchema = outcomeDefinition.inputSchema.properties.evidence.anyOf[0];
  assert.equal(evidenceSchema.properties.schema_version.const, "verification_evidence_contract_v2");
  assert(evidenceSchema.required.includes("work_id"));
  assert(evidenceSchema.required.includes("execution_authorized"));
  assert(evidenceSchema.properties.provenance.required.includes("work_id"));
  assert.equal(
    evidenceSchema.properties.attestations.items.properties.scheme.const,
    "sha256_work_bound_vote_integrity_v2",
  );
  const draftSchema = outcomeDefinition.inputSchema.properties.evidence_draft;
  assert.equal(draftSchema.properties.schema_version.const, "verification_evidence_draft_v2");
  assert(draftSchema.required.includes("work_id"));
  assert(draftSchema.required.includes("execution_authorized"));
  for (const definition of TOOLS.filter((item) => item.name.startsWith("orchestration_dtt_"))) {
    assert(definition.inputSchema.required.includes("work_id"), `${definition.name} must require work_id`);
    assert.deepEqual(definition.inputSchema.properties.work_id, {
      type: "string",
      format: "uuid",
    });
  }
});
