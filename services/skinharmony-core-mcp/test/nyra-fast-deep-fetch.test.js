import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";

const V2_REQUEST_SIGNING_SECRET = "mcp-nyra-v2-request-signing-secret-0123456789";
const REQUIREMENT_REF = `req_${"a".repeat(64)}`;
const EVIDENCE_REF_A = "b".repeat(64);
const EVIDENCE_REF_B = "c".repeat(64);

function v2MemoryContext(identity) {
  return {
    schema_version: "tenant_memory_context_v1",
    tenant_id: identity.tenantId,
    revision: 9,
    relevant_memories: [{ summary: "v2-memory-must-not-leak" }],
    pending_handoffs: [],
    recent_activity: [],
  };
}

function fixture(tenantId = "tenant-a") {
  return {
    ok: true,
    tenant_id: tenantId,
    result: {
      version: "nira_universal_core_bridge_v1",
      mode: "standard",
      god_mode_active: false,
      selected_by_core: { state: "guarded", risk_band: "medium", primary_action_label: "Verify first" },
      automation_plan: { execution_allowed: false, next_step: "Read only" },
      prepared_by_nira: { intent: "analyze", scenarios: [{ id: "s1", label: "baseline" }] },
      efficiency: { decision_confidence: 82 },
      core_branch_diagnostics: { branch_router_used: true },
      deep_nyra_runtime: {
        schema_version: "nyra_deep_cloud_runtime_v1",
        mode: "active",
        enabled: true,
        owner_protection: { hard_block: false },
        dialogue: { validator: { accepted: true }, preferred_reply: "Validated answer" },
        cognition: {
          opened_branch_count: 3,
          parallel_waves: 2,
          hypothesis_ranking: [{ id: "h1" }, { id: "h2" }],
          counterfactual_screening: true,
          verification_gate: true,
          learning_pipeline: ["capture", "verify"],
        },
        memory: { backend: "tenant_memory_fabric_postgresql", revision: 9 },
        execution_allowed: false,
        core_final_authority: true,
      },
      nyra_neural_network: {
        schema_version: "nyra_neural_branch_route_v1",
        opened_by: "universal_core",
        opened_branches: [{ id: "decision_reasoning", work_phase: "decide", subbranches: Array(20).fill("large") }],
        denied_branches: [],
        parallel_analysis: { enabled: true, waves: [["decision_reasoning"]], join_authority: "universal_core" },
        governed_learning: { state: "active", policy_activation_requires_verify: true },
      },
      memory_context: {
        schema_version: "tenant_memory_context_v1",
        tenant_id: tenantId,
        revision: 9,
        relevant_memories: [{ title: "secret memory", summary: "must-not-leak" }],
        pending_handoffs: [{}],
        recent_activity: [{}, {}],
      },
      work_preflight: {
        schema_version: "work_preflight_v1",
        preflight_id: "pf-1",
        tenant_id: tenantId,
        state: "ready_read_only",
        governance: { execution_allowed_by_preflight: true },
        task_graph: { nodes: Array(100).fill({ id: "large-node" }) },
      },
      core_input: { raw_large_input: "x".repeat(20_000) },
    },
    memory_context: { tenant_id: tenantId, revision: 9, relevant_memories: [{ summary: "must-not-leak" }] },
    branch_context: { selected_branches: ["decision_reasoning"], denied_branches: [], tier: "horizontal" },
    guardrail: { execution_allowed: false, mandatory_preflight_completed: true },
  };
}

function handlersFor(payload = fixture()) {
  return createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "key-a", "tenant-b": "key-b" } }, {
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
    contextProvider: async (_input, identity) => ({ tenant_id: identity.tenantId, revision: 9, relevant_memories: [] }),
  });
}

function v2Fixture() {
  const payload = fixture();
  payload.result.deep_branch_v2 = {
    schema_version: "nyra_deep_branch_v2_federation_response_v1",
    state: "active_after_core_branch_open",
    mode: "active",
    rollout_mode: "preview",
    catalog: {
      version: "2.1.0",
      fingerprint: "a".repeat(64),
      root_binding_hash: "b".repeat(64),
    },
    validation: { ok: true, branch_count: 18, subbranch_count: 239, node_count: 1434, shard_count: 239, checked_shards: 239, unchecked_shards: 0 },
    selected_branches: [{
      id: "research_evidence",
      label: "Research evidence",
      work_phase: "research",
      subbranch_count: 20,
      subbranches: [{ id: "source_discovery", specialized_capability_count: 1, input_schema: { must_not_leak: true } }],
    }],
    evaluation: { state: "not_requested_core_evidence_contract_unavailable", evaluated_node_count: 0, reason: "evidence_pending" },
    execution_authorized: false,
    core_final_authority: true,
    fallback: "nyra_neural_branch_network_v1",
  };
  return payload;
}

function v2EvaluationFixture() {
  const payload = fixture();
  payload.result.deep_branch_v2 = {
    schema_version: "nyra_deep_branch_v2_federation_response_v1",
    state: "active_after_core_branch_open",
    evaluation: {
      state: "evaluated_read_only",
      lineage: {
        nodes: [{
          state: "approved",
          node_id: "source_discovery_specialized_capability",
          level: 2,
          node_type: "specialized_capability",
          confidence: 0.96,
          reason_codes: ["evidence_refs_attested", "core_policy_allowed"],
        }, {
          state: "approved",
          node_id: "source_discovery_evidence_ranker",
          level: 3,
          node_type: "micro_capability",
          confidence: 0.94,
          reason_codes: ["evidence_refs_attested", { code: "core_policy_allowed" }, "must not leak"],
          raw_contract: { secret: "must-not-leak" },
        }, ...["method", "strategy", "verifier", "metric"].map((nodeType, index) => ({
          state: "approved",
          node_id: `source_discovery_${nodeType}_${index + 1}`,
          level: 4,
          node_type: nodeType,
          confidence: 0.8,
          reason_codes: ["core_policy_allowed"],
        }))],
      },
      raw_node_outputs: [{ secret: "must-not-leak" }],
    },
    execution_authorized: false,
    core_final_authority: true,
  };
  return payload;
}

function v2EvidencePreparationFixture() {
  const payload = fixture();
  payload.result.deep_branch_v2 = {
    schema_version: "nyra_deep_branch_v2_federation_response_v1",
    state: "active_after_core_branch_open",
    evidence: {
      state: "evidence_prepared",
      evidence_refs: [EVIDENCE_REF_A, { record_ref: EVIDENCE_REF_B, source: "must-not-leak" }],
      validation: {
        state: "accepted",
        accepted_source_count: 2,
        accepted_claim_count: 2,
        rejected_count: 0,
        raw_rejections: [{ source: "must-not-leak" }],
      },
      sources: [{ excerpt: "must-not-leak" }],
    },
    execution_authorized: false,
    core_final_authority: true,
  };
  return payload;
}

function v2RequirementsFixture() {
  const payload = fixture();
  payload.result.deep_branch_v2 = {
    schema_version: "nyra_deep_branch_v2_core_operation_v1",
    state: "requirements_ready_v1_authoritative",
    requirements: [{
      requirement_ref: REQUIREMENT_REF,
      level: 2,
      node_type: "specialized_capability",
      minimum_count: 1,
      authority_requirement: "authoritative",
      raw_contract: { secret: "must-not-leak" },
    }, {
      requirement_ref: `req_${"d".repeat(64)}`,
      level: 4,
      node_type: "verifier",
      minimum_count: 2,
      authority_requirement: "independent_corroboration",
    }],
    execution_authorized: false,
    core_final_authority: true,
  };
  return payload;
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function expectedRequestAttestationSignature(attestation) {
  const {
    schema_version: _schemaVersion,
    issuer: _issuer,
    max_age_seconds: _maxAgeSeconds,
    signature: _signature,
    ...canonicalPayload
  } = attestation;
  return crypto
    .createHmac("sha256", V2_REQUEST_SIGNING_SECRET)
    .update(`nyra-deep-branch-v2-request\u0000${JSON.stringify(stableCanonical(canonicalPayload))}`)
    .digest("hex");
}

test("fast mode removes raw memory and duplicate diagnostic payloads", async () => {
  const handlers = handlersFor();
  const response = await handlers.nyra_interpret_request({ message: "analyze", session_id: "session-fast" }, { tenantId: "tenant-a" });
  const compact = response.structuredContent;
  assert.equal(compact.response_mode, "fast");
  assert.match(compact.analysis_id, /^nyra_[a-f0-9]{24}$/);
  assert.equal(compact.result.deep_nyra_runtime.core_final_authority, true);
  assert.equal(compact.result.deep_nyra_runtime.execution_allowed, false);
  assert.equal(compact.result.memory_context.relevant_count, 1);
  assert.equal(JSON.stringify(compact).includes("must-not-leak"), false);
  assert.equal(compact.result.core_input, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(response.content)) < 1_000);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(fixture())) / 4);
});

test("deep mode exposes reasoning details without raw tenant memory", async () => {
  const handlers = handlersFor();
  const response = await handlers.nyra_interpret_request({ message: "deep", session_id: "session-deep", response_mode: "deep" }, { tenantId: "tenant-a" });
  assert.equal(response.structuredContent.response_mode, "deep");
  assert.equal(response.structuredContent.result.deep_nyra_runtime.cognition.hypothesis_ranking.length, 2);
  assert.equal(response.structuredContent.result.prepared_by_nira.intent, "analyze");
  assert.equal(JSON.stringify(response).includes("must-not-leak"), false);
});

test("fetch returns cached details only inside the same tenant", async () => {
  const handlers = handlersFor();
  const first = await handlers.nyra_interpret_request({ message: "analyze", session_id: "session-fetch" }, { tenantId: "tenant-a" });
  const analysisId = first.structuredContent.analysis_id;
  const deep = await handlers.nyra_fetch_analysis({ analysis_id: analysisId }, { tenantId: "tenant-a" });
  assert.equal(deep.structuredContent.analysis_id, analysisId);
  assert.equal(deep.structuredContent.response_mode, "deep");
  await assert.rejects(
    handlers.nyra_fetch_analysis({ analysis_id: analysisId }, { tenantId: "tenant-b" }),
    /nyra_analysis_not_found_or_expired/,
  );
});

test("full mode is explicit and content remains a compact narration", async () => {
  const handlers = handlersFor();
  const response = await handlers.nyra_interpret_request({ message: "diagnose", session_id: "session-full", response_mode: "full" }, { tenantId: "tenant-a" });
  assert.equal(response.structuredContent.response_mode, "full");
  assert.equal(response.structuredContent.result.core_input.raw_large_input.length, 20_000);
  assert.ok(Buffer.byteLength(JSON.stringify(response.content)) < 500);
});

test("V2 preview forwards only the server-side preview flag and compacts topology", async () => {
  let request;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "key-a" },
    nyraDeepBranchV2PreviewEnabled: true,
    nyraDeepBranchV2PreviewTenantIds: ["tenant-a"],
    nyraDeepBranchV2PreviewOauthOnly: true,
    nyraDeepBranchV2RequestSigningSecret: V2_REQUEST_SIGNING_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify(v2Fixture()), { status: 200, headers: { "content-type": "application/json" } });
    },
    contextProvider: async (_input, identity) => ({ tenant_id: identity.tenantId, revision: 9, relevant_memories: [] }),
  });
  const response = await handlers.nyra_v2_preview(
    { message: "Preview V2 research evidence", session_id: "v2-preview" },
    { tenantId: "tenant-a", kind: "oauth" },
  );
  const preview = response.structuredContent;
  assert.equal(request.deep_branch_v2_preview, true);
  assert.equal(request.deep_branch_v2.operation, "preview");
  assert.deepEqual(request.deep_branch_v2.evidence_refs, []);
  assert.equal(request.deep_branch_v2.request_attestation.request_id, request.request_id);
  assert.equal(request.deep_branch_v2.request_attestation.max_age_seconds, 60);
  assert.equal(request.deep_branch_v2.request_attestation.signature, expectedRequestAttestationSignature(request.deep_branch_v2.request_attestation));
  assert.equal(preview.response_mode, "preview");
  assert.equal(preview.deep_branch_v2.state, "active_after_core_branch_open");
  assert.equal(preview.deep_branch_v2.execution_authorized, false);
  assert.equal(preview.deep_branch_v2.evaluation.evaluated_node_count, 0);
  assert.deepEqual(preview.deep_branch_v2.selected_branches[0].subbranch_ids, ["source_discovery"]);
  assert.equal(preview.analysis_id, undefined);
  assert.equal(preview.details_available, false);
  assert.equal(JSON.stringify(preview).includes("must_not_leak"), false);
  await assert.rejects(
    handlers.nyra_fetch_analysis({ analysis_id: preview.request_id }, { tenantId: "tenant-a" }),
    /nyra_analysis_not_found_or_expired/,
  );
});

test("V2 preview fails closed before Core when its MCP gate is off", async () => {
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "key-a" } }, {
    fetchImpl: async () => { throw new Error("Core must not be called"); },
  });
  const response = await handlers.nyra_v2_preview({ message: "Preview V2" }, { tenantId: "tenant-a", kind: "oauth" });
  assert.equal(response.structuredContent.deep_branch_v2.state, "disabled_v1_authoritative");
  assert.equal(response.structuredContent.deep_branch_v2.execution_authorized, false);
});

test("V2 evaluation fails closed before Core when its independent MCP gate is off", async () => {
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "key-a" } }, {
    fetchImpl: async () => { throw new Error("Core must not be called"); },
  });
  const response = await handlers.nyra_v2_evaluate({
    branch_id: "research_evidence",
    subbranch_id: "source_discovery",
    evidence_refs: [EVIDENCE_REF_A],
  }, { tenantId: "tenant-a", kind: "oauth" });
  assert.equal(response.structuredContent.deep_branch_v2.state, "mcp_nyra_deep_branch_v2_evaluate_disabled");
  assert.equal(response.structuredContent.deep_branch_v2.execution_authorized, false);
});

test("V2 requirements opens a bound Core branch and returns only opaque evidence requirements", async () => {
  let request;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "key-a" },
    nyraDeepBranchV2EvaluateEnabled: true,
    nyraDeepBranchV2EvaluateTenantIds: ["tenant-a"],
    nyraDeepBranchV2EvaluateOauthOnly: true,
    nyraDeepBranchV2RequestSigningSecret: V2_REQUEST_SIGNING_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify(v2RequirementsFixture()), { status: 200, headers: { "content-type": "application/json" } });
    },
    contextProvider: async (_input, identity) => v2MemoryContext(identity),
  });
  const response = await handlers.nyra_v2_requirements({
    branch_id: "research_evidence",
    subbranch_id: "source_discovery",
  }, { tenantId: "tenant-a", kind: "oauth" });
  const requirements = response.structuredContent.deep_branch_v2.requirements;
  assert.equal(request.text, "Nyra Deep Branch V2 opaque requirement discovery");
  assert.equal(request.memory_context.tenant_id, "tenant-a");
  assert.equal(request.deep_branch_v2.memory_context, undefined);
  assert.equal(request.deep_branch_v2.operation, "requirements");
  assert.equal(request.deep_branch_v2.branch_id, "research_evidence");
  assert.equal(request.deep_branch_v2.subbranch_id, "source_discovery");
  assert.deepEqual(request.deep_branch_v2.evidence_refs, []);
  assert.equal(request.deep_branch_v2.request_attestation.signature, expectedRequestAttestationSignature(request.deep_branch_v2.request_attestation));
  assert.deepEqual(requirements, [{
    requirement_ref: REQUIREMENT_REF,
    level: 2,
    node_type: "specialized_capability",
    minimum_count: 1,
    authority_requirement: "authoritative",
  }, {
    requirement_ref: `req_${"d".repeat(64)}`,
    level: 4,
    node_type: "verifier",
    minimum_count: 2,
    authority_requirement: "independent_corroboration",
  }]);
  assert.equal(JSON.stringify(response.structuredContent).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(response.structuredContent).includes("v2-memory-must-not-leak"), false);
  assert.equal(response.structuredContent.execution_allowed, false);
});

test("V2 evidence/evaluation reject tenant and non-OAuth callers before Core", async () => {
  let coreCalls = 0;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "key-a" },
    nyraDeepBranchV2EvaluateEnabled: true,
    nyraDeepBranchV2EvaluateTenantIds: ["tenant-a"],
    nyraDeepBranchV2EvaluateOauthOnly: true,
    nyraDeepBranchV2RequestSigningSecret: V2_REQUEST_SIGNING_SECRET,
  }, {
    fetchImpl: async () => {
      coreCalls += 1;
      throw new Error("Core must not be called");
    },
  });
  const args = {
    branch_id: "research_evidence",
    subbranch_id: "source_discovery",
    evidence_refs: [EVIDENCE_REF_A],
  };
  const tenantDenied = await handlers.nyra_v2_evaluate(args, { tenantId: "tenant-b", kind: "oauth" });
  const oauthDenied = await handlers.nyra_v2_evaluate(args, { tenantId: "tenant-a", kind: "codex" });
  assert.equal(tenantDenied.structuredContent.deep_branch_v2.state, "mcp_nyra_deep_branch_v2_evaluate_tenant_denied");
  assert.equal(oauthDenied.structuredContent.deep_branch_v2.state, "mcp_nyra_deep_branch_v2_evaluate_oauth_required");
  assert.equal(coreCalls, 0);
});

test("V2 evaluation forwards only opaque refs in an attested bounded Core request and compacts lineage", async () => {
  let request;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "key-a" },
    nyraDeepBranchV2EvaluateEnabled: true,
    nyraDeepBranchV2EvaluateTenantIds: ["tenant-a"],
    nyraDeepBranchV2EvaluateOauthOnly: true,
    nyraDeepBranchV2RequestSigningSecret: V2_REQUEST_SIGNING_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify(v2EvaluationFixture()), { status: 200, headers: { "content-type": "application/json" } });
    },
    contextProvider: async (_input, identity) => v2MemoryContext(identity),
  });
  const response = await handlers.nyra_v2_evaluate({
    branch_id: "research_evidence",
    subbranch_id: "source_discovery",
    evidence_refs: [EVIDENCE_REF_A, EVIDENCE_REF_B],
  }, { tenantId: "tenant-a", kind: "oauth" });
  const evaluation = response.structuredContent.deep_branch_v2;
  assert.equal(request.text, "Nyra Deep Branch V2 bounded node evaluation");
  assert.equal(request.memory_context.tenant_id, "tenant-a");
  assert.equal(request.deep_branch_v2.memory_context, undefined);
  assert.equal(request.evidence_pack, undefined);
  assert.deepEqual(request.deep_branch_v2.evidence_refs, [EVIDENCE_REF_A, EVIDENCE_REF_B]);
  assert.equal(request.deep_branch_v2.operation, "evaluate");
  assert.equal(request.deep_branch_v2.branch_id, "research_evidence");
  assert.equal(request.deep_branch_v2.subbranch_id, "source_discovery");
  const attestation = request.deep_branch_v2.request_attestation;
  assert.match(request.request_id, /^mcpv2_[a-f0-9]{32}$/);
  assert.equal(attestation.request_id, request.request_id);
  assert.equal(attestation.max_age_seconds, 60);
  assert.equal(attestation.signature, expectedRequestAttestationSignature(attestation));
  assert.equal(evaluation.state, "evaluated_read_only");
  assert.equal(evaluation.execution_authorized, false);
  assert.equal(evaluation.core_final_authority, true);
  assert.deepEqual(Object.keys(evaluation.lineage[0]).sort(), ["confidence", "id", "level", "node_type", "reasons", "state"]);
  assert.equal(evaluation.lineage.length, 6);
  assert.deepEqual(evaluation.lineage[0], {
    state: "approved",
    id: "source_discovery_specialized_capability",
    level: 2,
    node_type: "specialized_capability",
    confidence: 0.96,
    reasons: ["evidence_refs_attested", "core_policy_allowed"],
  });
  assert.equal(response.structuredContent.analysis_id, undefined);
  assert.equal(response.structuredContent.details_available, false);
  assert.equal(JSON.stringify(response.structuredContent).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(response.structuredContent).includes("v2-memory-must-not-leak"), false);
  await assert.rejects(
    handlers.nyra_fetch_analysis({ analysis_id: response.structuredContent.request_id }, { tenantId: "tenant-a" }),
    /nyra_analysis_not_found_or_expired/,
  );
});

test("V2 evidence preparation binds raw sources and claims to a hash but returns only opaque evidence refs", async () => {
  let request;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "key-a" },
    nyraDeepBranchV2EvaluateEnabled: true,
    nyraDeepBranchV2EvaluateTenantIds: ["tenant-a"],
    nyraDeepBranchV2EvaluateOauthOnly: true,
    nyraDeepBranchV2RequestSigningSecret: V2_REQUEST_SIGNING_SECRET,
  }, {
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify(v2EvidencePreparationFixture()), { status: 200, headers: { "content-type": "application/json" } });
    },
    contextProvider: async (_input, identity) => v2MemoryContext(identity),
  });
  const response = await handlers.nyra_v2_evidence_prepare({
    branch_id: "research_evidence",
    subbranch_id: "source_discovery",
    evidence_pack: {
      sources: [{
        id: "source_a",
        url: "https://evidence.example.test/a",
        title: "Reviewed source A",
        source_type: "official",
        excerpt: "raw source text must not return",
      }],
      claims: [{
        id: "claim_a",
        kind: "fact",
        text: "raw claim text must not return",
        source_ids: ["source_a"],
        confidence: 0.9,
      }],
    },
    requirement_bindings: [{
      id: "binding_a",
      requirement_ref: REQUIREMENT_REF,
      source_ids: ["source_a"],
      claim_ids: ["claim_a"],
    }],
  }, { tenantId: "tenant-a", kind: "oauth" });
  const evidence = response.structuredContent.deep_branch_v2.evidence;
  assert.equal(request.text, "Nyra Deep Branch V2 bounded evidence preparation");
  assert.equal(request.memory_context.tenant_id, "tenant-a");
  assert.equal(request.deep_branch_v2.memory_context, undefined);
  assert.equal(request.deep_branch_v2.operation, "prepare_evidence");
  assert.equal(request.deep_branch_v2.branch_id, "research_evidence");
  assert.equal(request.deep_branch_v2.subbranch_id, "source_discovery");
  assert.equal(request.deep_branch_v2.evidence_pack_hash, request.deep_branch_v2.request_attestation.evidence_pack_hash);
  assert.equal(request.deep_branch_v2.request_attestation.signature, expectedRequestAttestationSignature(request.deep_branch_v2.request_attestation));
  assert.deepEqual(evidence.evidence_refs, [EVIDENCE_REF_A, EVIDENCE_REF_B]);
  assert.deepEqual(evidence.validation, {
    state: "accepted",
    accepted_source_count: 2,
    accepted_claim_count: 2,
    rejected_count: 0,
  });
  assert.equal(evidence.execution_authorized, false);
  assert.equal(evidence.core_final_authority, true);
  assert.equal(JSON.stringify(response.structuredContent).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(response.structuredContent).includes("raw source text"), false);
  assert.equal(JSON.stringify(response.structuredContent).includes("raw claim text"), false);
  assert.equal(JSON.stringify(response.structuredContent).includes("v2-memory-must-not-leak"), false);
});
