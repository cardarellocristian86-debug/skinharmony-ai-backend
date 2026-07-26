import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { nyraDeepV2EvidencePackHash, nyraDeepV2StableJson } from "../src/nyraDeepV2McpRequest.js";

const require = createRequire(import.meta.url);
const nyraRuntime = require("../../../personal-control-center/lib/nyra-deep-branch-v2.js");
const nyraFederationRuntime = require("../../../personal-control-center/lib/nyra-deep-branch-v2-federation.js");

const MCP_REQUEST_SECRET = "nyra-deep-v2-bridge-mcp-request-secret-0123456789";
const FEDERATION_SERVICE_KEY = "nyra-deep-v2-bridge-federation-service-key-0123456789";

function signedMcpRequest({
  tenantId,
  requestId,
  operation,
  branchId,
  subbranchId,
  evidenceRefs = [],
  evidencePackHash,
  secret = MCP_REQUEST_SECRET,
}) {
  const issuedAt = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = {
    tenant_id: tenantId,
    request_id: requestId,
    operation,
    ...(branchId ? { branch_id: branchId } : {}),
    ...(subbranchId ? { subbranch_id: subbranchId } : {}),
    evidence_refs: evidenceRefs,
    ...(evidencePackHash ? { evidence_pack_hash: evidencePackHash } : {}),
    issued_at: issuedAt,
    nonce,
  };
  return {
    schema_version: "mcp_nyra_deep_branch_v2_request_attestation_v1",
    issuer: "skinharmony-core-mcp",
    ...payload,
    max_age_seconds: 60,
    signature: crypto
      .createHmac("sha256", secret)
      .update(`nyra-deep-branch-v2-request\u0000${nyraDeepV2StableJson(payload)}`)
      .digest("hex"),
  };
}

function federationFetch(federation) {
  return async (_url, options) => {
    const envelope = JSON.parse(options.body).envelope;
    const authentication = federation.authenticate(options.headers["X-Nyra-Deep-V2-Service-Key"]);
    const result = authentication.ok
      ? federation.evaluate(envelope)
      : { ok: false, status: 401, error: authentication.error };
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : result.status || 403,
      headers: { "content-type": "application/json" },
    });
  };
}

async function start(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function request(base, pathName, body, key) {
  const response = await fetch(`${base}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("Core attaches a signed V2 preview only after V1 routing and preserves V1 without the preview flag", async () => {
  const previousAdminKey = process.env.CORE_SERVICE_ADMIN_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.CORE_SERVICE_ADMIN_KEY = "nyra-v2-bridge-test-admin";
  process.env.NODE_ENV = "test";
  let calls = 0;
  let captured;
  const nyraDeepBranchV2Client = {
    async evaluate(input) {
      calls += 1;
      captured = input;
      return {
        schema_version: "nyra_deep_branch_v2_federation_response_v1",
        state: "shadow_v1_authoritative",
        mode: "shadow",
        rollout_mode: "preview",
        tenant_id: input.tenantId,
        request_id: input.requestId,
        validation: { ok: true, unchecked_shards: 0 },
        selected_branches: [{ id: "context_intelligence", subbranch_count: 10, subbranches: [] }],
        evaluation: { state: "not_requested_core_evidence_contract_unavailable", evaluated_node_count: 0 },
        execution_authorized: false,
        core_final_authority: true,
        fallback: "nyra_neural_branch_network_v1",
      };
    },
  };
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `nyra-v2-bridge-${Date.now()}`),
    nyraDeepBranchV2Client,
    nyraDeepV2McpSigningSecret: MCP_REQUEST_SECRET,
  });
  const server = await start(app);
  try {
    const generated = await request(server.base, "/v1/keys/generate", {
      tenant_id: "codexai",
      brand_scope: "skinharmony",
      key_type: "connector",
      preset: "suite_connector",
      domain_pack_id: "suite",
      label: "Nyra V2 bridge test key",
    }, process.env.CORE_SERVICE_ADMIN_KEY);
    assert.equal(generated.status, 201);
    const key = generated.json.key;
    const payload = {
      text: "Ricerca fonti e verifica qualita",
      request_id: "nyra-v2-bridge-preview",
      deep_branch_v2_preview: true,
      deep_branch_v2: {
        operation: "preview",
        evidence_refs: [],
        request_attestation: signedMcpRequest({
          tenantId: "codexai",
          requestId: "nyra-v2-bridge-preview",
          operation: "preview",
        }),
      },
      memory_context: { schema_version: "tenant_memory_context_v1", tenant_id: "codexai", revision: 1, relevant_memories: [], pending_handoffs: [], recent_activity: [] },
    };
    const preview = await request(server.base, "/v1/nira/core-bridge", payload, key);
    assert.equal(preview.status, 200);
    assert.equal(calls, 1);
    assert.equal(captured.requested, true);
    assert.equal(captured.tenantId, "codexai");
    assert.equal(captured.workPreflight.mandatory, true);
    assert.equal(preview.json.result.deep_branch_v2.execution_authorized, false);
    assert.equal(preview.json.result.deep_branch_v2.core_final_authority, true);
    assert.equal(preview.json.result.deep_branch_v2.evaluation.evaluated_node_count, 0);

    const v1 = await request(server.base, "/v1/nira/core-bridge", {
      text: payload.text,
      request_id: "nyra-v2-bridge-v1",
      memory_context: payload.memory_context,
    }, key);
    assert.equal(v1.status, 200);
    assert.equal(calls, 1);
    assert.equal("deep_branch_v2" in v1.json.result, false);
    assert.equal(v1.json.result.automation_plan.execution_allowed, false);
  } finally {
    await server.close();
    if (previousAdminKey === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdminKey;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("Core opens a requested V2 branch and uses Core-validated evidence to evaluate all L2-to-L4 nodes", async () => {
  const previousAdminKey = process.env.CORE_SERVICE_ADMIN_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.CORE_SERVICE_ADMIN_KEY = "nyra-v2-operational-bridge-test-admin";
  process.env.NODE_ENV = "test";
  const tenantId = "codexai";
  const branchId = "context_intelligence";
  const subbranchId = "request_normalization";
  const loaded = nyraRuntime.loadCatalog({ runtimeMode: "lazy" });
  assert.equal(loaded.ok, true);
  const signer = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = signer.publicKey.export({ type: "spki", format: "pem" });
  const privateKeyPem = signer.privateKey.export({ type: "pkcs8", format: "pem" });
  const federationEnvironment = {
    NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_MODE: "active",
    NYRA_DEEP_BRANCH_V2_BRANCHES: branchId,
    NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: tenantId,
    NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_FEDERATION_TENANT_ALLOWLIST: tenantId,
    NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET: FEDERATION_SERVICE_KEY,
    NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST: tenantId,
    NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_KEY_ID_ALLOWLIST: "universal-core-nyra-v2",
    NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_PUBLIC_KEYS: JSON.stringify({ "universal-core-nyra-v2": publicKeyPem }),
  };
  const coreEnvironment = {
    CORE_NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    CORE_NYRA_DEEP_BRANCH_V2_MODE: "active",
    CORE_NYRA_DEEP_BRANCH_V2_URL: "https://nyra.test",
    CORE_NYRA_DEEP_BRANCH_V2_ALLOWED_ORIGIN: "https://nyra.test",
    CORE_NYRA_DEEP_BRANCH_V2_SERVICE_KEY: FEDERATION_SERVICE_KEY,
    CORE_NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: tenantId,
    CORE_NYRA_DEEP_BRANCH_V2_BRANCHES: branchId,
    CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_CATALOG_FINGERPRINT: loaded.catalog.catalog_fingerprint,
    CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_ROOT_BINDING_HASH: loaded.manifest.root_binding_hash,
    CORE_NYRA_DEEP_BRANCH_V2_TIMEOUT_MS: "1000",
    CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED: "true",
    CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE: "advisory",
    CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST: tenantId,
    CORE_NYRA_DEEP_BRANCH_V2_LEDGER_SECRET: "nyra-deep-v2-operational-bridge-ledger-secret-0123456789",
    CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET: MCP_REQUEST_SECRET,
    CORE_NYRA_DEEP_BRANCH_V2_ATTESTATION_PRIVATE_KEY: privateKeyPem,
    CORE_NYRA_DEEP_BRANCH_V2_ATTESTATION_KEY_ID: "universal-core-nyra-v2",
  };
  const federation = nyraFederationRuntime.createNyraDeepBranchV2Federation({ env: federationEnvironment });
  const sourceExcerptA = "Core reviewed official source A evidence excerpt.";
  const sourceExcerptB = "Core reviewed official source B evidence excerpt.";
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `nyra-v2-operational-bridge-${Date.now()}`),
    nyraDeepV2Env: coreEnvironment,
    nyraDeepBranchV2FetchImpl: federationFetch(federation),
    nyraDeepV2SourceFetchImpl: async () => new Response(
      `<html><body>${sourceExcerptA} ${sourceExcerptB}</body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    ),
    nyraDeepV2SourceDnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const server = await start(app);
  try {
    const generated = await request(server.base, "/v1/keys/generate", {
      tenant_id: tenantId,
      brand_scope: "skinharmony",
      key_type: "connector",
      preset: "suite_connector",
      domain_pack_id: "suite",
      label: "Nyra V2 operational bridge test key",
    }, process.env.CORE_SERVICE_ADMIN_KEY);
    assert.equal(generated.status, 201);
    const key = generated.json.key;
    const memoryContext = {
      schema_version: "tenant_memory_context_v1",
      tenant_id: tenantId,
      revision: 1,
      relevant_memories: [],
      pending_handoffs: [],
      recent_activity: [],
    };
    const requirementsRequestId = "nyra-v2-operational-requirements";
    const requirementsResponse = await request(server.base, "/v1/nira/core-bridge", {
      text: "Normalizza il contesto della richiesta con fonti controllate",
      request_id: requirementsRequestId,
      source_tool: "nyra_v2_requirements",
      operation_type: "nyra_v2_requirements",
      nyra_branches: [branchId],
      memory_context: memoryContext,
      deep_branch_v2: {
        operation: "requirements",
        branch_id: branchId,
        subbranch_id: subbranchId,
        evidence_refs: [],
        request_attestation: signedMcpRequest({
          tenantId,
          requestId: requirementsRequestId,
          operation: "requirements",
          branchId,
          subbranchId,
        }),
      },
    }, key);
    assert.equal(requirementsResponse.status, 200);
    const requirementsRuntime = requirementsResponse.json.result.deep_branch_v2;
    assert.equal(requirementsRuntime.state, "requirements_ready_v1_authoritative");
    // Each of the six concrete L2–L4 nodes has four independent evidence
    // obligations. Core keeps those requirements opaque, then Nyra receives
    // only the qualified evidence references and still evaluates six nodes.
    assert.equal(requirementsRuntime.requirements.length, 24);
    assert.deepEqual(requirementsRuntime.requirements.map((item) => item.level), [
      2, 2, 2, 2,
      3, 3, 3, 3,
      4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    ]);

    const evidencePack = {
      sources: [
        {
          id: "source_a",
          url: "https://www.fda.gov/",
          title: "Official source A",
          source_type: "official",
          excerpt: sourceExcerptA,
        },
        {
          id: "source_b",
          url: "https://www.nih.gov/",
          title: "Official source B",
          source_type: "official",
          excerpt: sourceExcerptB,
        },
      ],
      claims: requirementsRuntime.requirements.map((_, index) => ({
        id: `claim_${index + 1}`,
        kind: "fact",
        text: `Reviewed evidence supports bounded Nyra node ${index + 1}.`,
        source_ids: ["source_a", "source_b"],
        confidence: 0.9,
      })),
    };
    const requirementBindings = requirementsRuntime.requirements.map((requirement, index) => ({
      id: `binding_${index + 1}`,
      requirement_ref: requirement.requirement_ref,
      source_ids: ["source_a", "source_b"],
      claim_ids: [`claim_${index + 1}`],
    }));
    const evidencePackHash = nyraDeepV2EvidencePackHash(evidencePack, requirementBindings);
    const preparationRequestId = "nyra-v2-operational-evidence";
    const preparationResponse = await request(server.base, "/v1/nira/core-bridge", {
      text: "Nyra Deep Branch V2 bounded evidence preparation",
      request_id: preparationRequestId,
      source_tool: "nyra_v2_evidence_prepare",
      operation_type: "nyra_v2_evidence_prepare",
      nyra_branches: [branchId],
      memory_context: memoryContext,
      deep_branch_v2: {
        operation: "prepare_evidence",
        branch_id: branchId,
        subbranch_id: subbranchId,
        evidence_pack: evidencePack,
        requirement_bindings: requirementBindings,
        evidence_pack_hash: evidencePackHash,
        evidence_refs: [],
        request_attestation: signedMcpRequest({
          tenantId,
          requestId: preparationRequestId,
          operation: "prepare_evidence",
          branchId,
          subbranchId,
          evidencePackHash,
        }),
      },
    }, key);
    assert.equal(preparationResponse.status, 200);
    const preparedRuntime = preparationResponse.json.result.deep_branch_v2;
    assert.equal(preparedRuntime.state, "evidence_prepared_v1_authoritative");
    assert.equal(preparedRuntime.evidence.evidence_refs.length, 24);
    assert.equal(JSON.stringify(preparedRuntime).includes("Reviewed evidence supports"), false);

    const evaluationRequestId = "nyra-v2-operational-evaluate";
    const evidenceRefs = preparedRuntime.evidence.evidence_refs;
    const evaluationResponse = await request(server.base, "/v1/nira/core-bridge", {
      text: "Nyra Deep Branch V2 bounded node evaluation",
      request_id: evaluationRequestId,
      source_tool: "nyra_v2_evaluate",
      operation_type: "nyra_v2_evaluate",
      nyra_branches: [branchId],
      memory_context: memoryContext,
      deep_branch_v2: {
        operation: "evaluate",
        branch_id: branchId,
        subbranch_id: subbranchId,
        evidence_refs: evidenceRefs,
        request_attestation: signedMcpRequest({
          tenantId,
          requestId: evaluationRequestId,
          operation: "evaluate",
          branchId,
          subbranchId,
          evidenceRefs,
        }),
      },
    }, key);
    assert.equal(evaluationResponse.status, 200);
    const evaluatedRuntime = evaluationResponse.json.result.deep_branch_v2;
    assert.equal(evaluatedRuntime.state, "operational_advisory_verified_v1_authoritative");
    assert.equal(evaluatedRuntime.evaluation.all_nodes_verified, true);
    assert.equal(evaluatedRuntime.evaluation.evaluated_node_count, 6);
    assert.deepEqual(evaluatedRuntime.evaluation.lineage.nodes.map((node) => node.level), [2, 3, 4, 4, 4, 4]);
    assert.equal(evaluatedRuntime.evaluation.lineage.nodes.every((node) => node.state === "advisory_verified"), true);
    assert.equal(evaluatedRuntime.execution_authorized, false);
    assert.equal(evaluatedRuntime.core_final_authority, true);

    // The same tenant-scoped, Core-verified evidence is not enough to bypass
    // a new V1 Core decision. A release-shaped request produces real policy
    // DENY receipts for the exact node bindings and Nyra must return a
    // non-executing fallback lineage.
    const deniedRequestId = "nyra-v2-operational-policy-denied";
    const deniedResponse = await request(server.base, "/v1/nira/core-bridge", {
      text: "Deploy and publish a release to production",
      request_id: deniedRequestId,
      source_tool: "nyra_v2_evaluate",
      operation_type: "nyra_v2_evaluate",
      nyra_branches: [branchId],
      memory_context: memoryContext,
      deep_branch_v2: {
        operation: "evaluate",
        branch_id: branchId,
        subbranch_id: subbranchId,
        evidence_refs: evidenceRefs,
        request_attestation: signedMcpRequest({
          tenantId,
          requestId: deniedRequestId,
          operation: "evaluate",
          branchId,
          subbranchId,
          evidenceRefs,
        }),
      },
    }, key);
    assert.equal(deniedResponse.status, 200);
    const deniedRuntime = deniedResponse.json.result.deep_branch_v2;
    assert.equal(deniedRuntime.state, "operational_advisory_fallback_v1_authoritative");
    assert.equal(deniedRuntime.evaluation.all_nodes_verified, false);
    assert.equal(deniedRuntime.evaluation.lineage.nodes.every((node) => node.state !== "advisory_verified"), true);
    assert.equal(deniedRuntime.evaluation.lineage.nodes.some((node) => (
      Array.isArray(node.reason_codes) && node.reason_codes.some((reason) => String(reason).includes("policy"))
    )), true);
    assert.equal(deniedRuntime.execution_authorized, false);
  } finally {
    await server.close();
    if (previousAdminKey === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdminKey;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
