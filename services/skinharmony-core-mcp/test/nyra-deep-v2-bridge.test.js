import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";
import {
  createNyraDeepV2McpRequestVerifier,
  nyraDeepV2EvidencePackHash,
} from "../../universal-core-service/src/nyraDeepV2McpRequest.js";

const SIGNING_SECRET = "mcp-nyra-deep-v2-signing-secret-0123456789";
const IDENTITY = { tenantId: "tenant-a" };
const BRANCH_ID = "context_intelligence";
const SUBBRANCH_ID = "request_normalization";
const REQUIREMENT_REF = `req_${"a".repeat(64)}`;
const EVIDENCE_REF = "b".repeat(64);

function coreResponse(requestBody) {
  const operation = requestBody.deep_branch_v2.operation;
  return new Response(JSON.stringify({
    ok: true,
    tenant_id: "tenant-a",
    result: {
      core_runtime: {
        hierarchy_version: "core_runtime_hierarchy_v1",
        mode: "shadow",
        router: { route: "V1" },
        selected_authority: "V1",
        parity: { attempted: false, matched: null, fallback: null },
        execution_allowed: false,
      },
      work_preflight: {
        schema_version: "skinharmony_work_preflight_v1",
        preflight_id: `preflight-${operation}`,
        tenant_id: "tenant-a",
        state: "ready_read_only",
        mandatory: true,
        request: { operation_type: requestBody.operation_type },
        governance: { execution_allowed_by_preflight: true },
      },
      deep_branch_v2: {
        schema_version: "nyra_deep_branch_v2_core_operation_v1",
        state: `${operation}_v1_authoritative`,
        ...(operation === "requirements" ? { requirements: [{ requirement_ref: REQUIREMENT_REF }] } : {}),
        ...(operation === "prepare_evidence"
          ? { evidence: { state: "verified", evidence_refs: [EVIDENCE_REF] } }
          : {}),
        execution_authorized: false,
        core_final_authority: true,
      },
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("MCP signs and routes all Deep V2 operations through Universal Core", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    defaultTenantId: "owner-private",
    nyraDeepV2McpRequestSigningSecret: SIGNING_SECRET,
  }, {
    contextProvider: async () => ({
      schema_version: "tenant_memory_context_v1",
      tenant_id: "tenant-a",
      revision: 3,
      relevant_memories: [],
      pending_handoffs: [],
      recent_activity: [],
    }),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, init, body });
      return coreResponse(body);
    },
  });
  const evidencePack = {
    research_question: "Which bounded evidence applies?",
    sources: [{
      id: "source_a",
      registry_source_id: "nist",
      url: "https://www.nist.gov/example",
      title: "NIST evidence",
      source_type: "official",
      excerpt: "Verified NIST evidence supports this bounded test claim.",
    }],
    claims: [{
      id: "claim_a",
      kind: "fact",
      text: "The bounded claim is supported.",
      source_ids: ["source_a"],
      confidence: 0.9,
    }],
  };
  const requirementBindings = [{
    id: "binding_a",
    requirement_ref: REQUIREMENT_REF,
    source_ids: ["source_a"],
    claim_ids: ["claim_a"],
  }];

  await handlers.nyra_v2_preview({
    message: "Preview the current Nyra branch topology",
    request_id: "mcp-v2-preview",
    nyra_branches: [BRANCH_ID],
  }, IDENTITY);
  await handlers.nyra_v2_requirements({
    message: "Read the evidence requirements",
    request_id: "mcp-v2-requirements",
    branch_id: BRANCH_ID,
    subbranch_id: SUBBRANCH_ID,
  }, IDENTITY);
  await handlers.nyra_v2_evidence_prepare({
    message: "Prepare registry-bound evidence",
    request_id: "mcp-v2-prepare",
    branch_id: BRANCH_ID,
    subbranch_id: SUBBRANCH_ID,
    evidence_pack: evidencePack,
    requirement_bindings: requirementBindings,
  }, IDENTITY);
  const evaluated = await handlers.nyra_v2_evaluate({
    message: "Evaluate with opaque verified evidence",
    request_id: "mcp-v2-evaluate",
    branch_id: BRANCH_ID,
    subbranch_id: SUBBRANCH_ID,
    evidence_refs: [EVIDENCE_REF],
  }, IDENTITY);

  assert.equal(calls.length, 4);
  assert(calls.every((call) => new URL(call.url).pathname === "/v1/nira/core-bridge"));
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert(calls.every((call) => call.body.tenant_id === "tenant-a"));
  assert(calls.every((call) => call.body.memory_context?.tenant_id === "tenant-a"));
  assert.deepEqual(calls.map((call) => call.body.operation_type), [
    "nyra_v2_preview",
    "nyra_v2_requirements",
    "nyra_v2_evidence_prepare",
    "nyra_v2_evaluate",
  ]);
  assert.deepEqual(calls[0].body.nyra_branches, [BRANCH_ID]);
  assert(calls.every((call) => call.body.deep_branch_v2.request_attestation.tenant_id === "tenant-a"));
  assert.deepEqual(calls.slice(1).map((call) => call.body.nyra_branches), [
    [BRANCH_ID],
    [BRANCH_ID],
    [BRANCH_ID],
  ]);

  const verifier = createNyraDeepV2McpRequestVerifier({ secret: SIGNING_SECRET });
  for (const call of calls) {
    const deep = call.body.deep_branch_v2;
    const verified = verifier.verify({
      attestation: deep.request_attestation,
      tenantId: "tenant-a",
      requestId: call.body.request_id,
      operation: deep.operation,
    });
    assert.equal(verified.ok, true, verified.reason);
  }
  assert.equal(
    calls[2].body.deep_branch_v2.evidence_pack_hash,
    nyraDeepV2EvidencePackHash(evidencePack, requirementBindings),
  );
  assert.deepEqual(calls[3].body.deep_branch_v2.evidence_refs, [EVIDENCE_REF]);
  assert.equal(evaluated.structuredContent.deep_branch_v2.execution_authorized, false);
  assert.equal(evaluated.structuredContent.deep_branch_v2.core_final_authority, true);
});

test("MCP Deep V2 bridge fails closed when its dedicated signing secret is missing", async () => {
  let calls = 0;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    defaultTenantId: "owner-private",
    nyraDeepV2McpRequestSigningSecret: "",
  }, {
    fetchImpl: async () => {
      calls += 1;
      return coreResponse({});
    },
  });

  await assert.rejects(
    handlers.nyra_v2_preview({ message: "Preview" }, IDENTITY),
    /nyra_deep_v2_mcp_request_signing_unavailable/,
  );
  assert.equal(calls, 0);
});

test("MCP publishes bounded non-executing Deep V2 tools without caller-supplied attestations", () => {
  for (const name of ["nyra_v2_preview", "nyra_v2_requirements"]) {
    const definition = TOOLS.find((candidate) => candidate.name === name);
    assert(definition, `missing ${name}`);
    assert.deepEqual(definition.scopes, ["core:read"]);
    assert.equal(definition.annotations.readOnlyHint, true);
    assert.equal(definition.annotations.destructiveHint, false);
    assert.equal("request_attestation" in definition.inputSchema.properties, false);
    assert.equal("evidence_pack_hash" in definition.inputSchema.properties, false);
  }
  for (const name of ["nyra_v2_evidence_prepare", "nyra_v2_evaluate"]) {
    const definition = TOOLS.find((candidate) => candidate.name === name);
    assert(definition, `missing ${name}`);
    assert.deepEqual(definition.scopes, ["core:govern"]);
    assert.equal(definition.annotations.readOnlyHint, false);
    assert.equal(definition.annotations.destructiveHint, false);
    assert.equal(definition.annotations.openWorldHint, true);
    assert.equal(definition._meta["skinharmony/externalSideEffect"], false);
    assert.equal("request_attestation" in definition.inputSchema.properties, false);
    assert.equal("evidence_pack_hash" in definition.inputSchema.properties, false);
  }
  const evaluate = TOOLS.find((candidate) => candidate.name === "nyra_v2_evaluate");
  const prepare = TOOLS.find((candidate) => candidate.name === "nyra_v2_evidence_prepare");
  const claimSchema = prepare.inputSchema.properties.evidence_pack.properties.claims.items;
  for (const field of [
    "facts",
    "claim_hash",
    "semantic_hash",
    "content_tag",
    "capability_spec_hash",
  ]) {
    assert.equal(claimSchema.required.includes(field), true);
  }
  assert.equal(claimSchema.properties.claim_hash.pattern, "^[a-f0-9]{64}$");
  assert.equal(claimSchema.properties.semantic_hash.pattern, "^[a-f0-9]{64}$");
  assert.equal(claimSchema.properties.content_tag.pattern, "^[a-z][a-z0-9_]{1,159}$");
  assert.equal(claimSchema.properties.capability_spec_hash.pattern, "^[a-f0-9]{64}$");
  assert.equal("evidence_pack" in evaluate.inputSchema.properties, false);
  assert.equal(evaluate.inputSchema.properties.evidence_refs.minItems, 1);
});
