import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createNyraDeepBranchV2Client } from "../src/nyraDeepBranchV2Client.js";

const require = createRequire(import.meta.url);
const {
  createNyraDeepBranchV2Federation,
  loadCatalog,
} = (() => {
  const federation = require("../../../personal-control-center/lib/nyra-deep-branch-v2-federation.js");
  const runtime = require("../../../personal-control-center/lib/nyra-deep-branch-v2.js");
  return { ...federation, loadCatalog: runtime.loadCatalog };
})();

const branches = ["context_intelligence", "work_intake", "research_evidence", "quality_verification"];
const serviceKey = "nyra-deep-branch-v2-client-test-service-key-0123456789";
const loaded = loadCatalog({ runtimeMode: "lazy" });

function env(overrides = {}) {
  return {
    CORE_NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    CORE_NYRA_DEEP_BRANCH_V2_MODE: "preview",
    CORE_NYRA_DEEP_BRANCH_V2_URL: "https://nyra.test",
    CORE_NYRA_DEEP_BRANCH_V2_SERVICE_KEY: serviceKey,
    CORE_NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "codexai",
    CORE_NYRA_DEEP_BRANCH_V2_BRANCHES: branches.join(","),
    CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_CATALOG_FINGERPRINT: loaded.catalog.catalog_fingerprint,
    CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_ROOT_BINDING_HASH: loaded.manifest.root_binding_hash,
    CORE_NYRA_DEEP_BRANCH_V2_TIMEOUT_MS: "1000",
    NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_MODE: "active",
    NYRA_DEEP_BRANCH_V2_BRANCHES: branches.join(","),
    NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "codexai",
    NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_FEDERATION_TENANT_ALLOWLIST: "codexai",
    NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET: serviceKey,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    requested: true,
    tenantId: "codexai",
    requestId: "nyra-v2-preview-test",
    selectedByCore: { state: "ready", risk_band: "low", control_level: "observe" },
    nyraNetwork: { opened_branches: branches.map((id) => ({ id, status: "opened" })) },
    workPreflight: { preflight_id: "preflight-v2-preview", state: "ready_read_only", mandatory: true, governance: { execution_allowed_by_preflight: false } },
    ...overrides,
  };
}

function federatedFetch(federation) {
  return async (_url, options) => {
    const supplied = options.headers["X-Nyra-Deep-V2-Service-Key"];
    const auth = federation.authenticate(supplied);
    const result = auth.ok
      ? federation.evaluate(JSON.parse(options.body).envelope)
      : { ok: false, status: 401, error: auth.error };
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : result.status || 403,
      headers: { "content-type": "application/json" },
    });
  };
}

test("Core V2 client returns only a bounded Core-attested preview", async () => {
  const values = env();
  const federation = createNyraDeepBranchV2Federation({ env: values });
  const client = createNyraDeepBranchV2Client({ env: values, fetchImpl: federatedFetch(federation) });
  const result = await client.evaluate(input());

  assert.equal(result.state, "active_after_core_branch_open");
  assert.equal(result.rollout_mode, "preview");
  assert.equal(result.execution_authorized, false);
  assert.equal(result.core_final_authority, true);
  assert.equal(result.evaluation.state, "not_requested_core_evidence_contract_unavailable");
  assert.deepEqual(result.selected_branches.map((branch) => branch.id), branches);
  assert.equal(JSON.stringify(result).includes("input_schema"), false);
  assert.equal(JSON.stringify(result).includes("method_program"), false);
});

test("Core V2 client fails closed for an unallowlisted tenant without calling Nyra", async () => {
  const values = env();
  const client = createNyraDeepBranchV2Client({
    env: values,
    fetchImpl: async () => { throw new Error("Nyra must not be called"); },
  });
  const result = await client.evaluate(input({ tenantId: "tenant-other" }));
  assert.equal(result.state, "tenant_denied_v1_authoritative");
  assert.equal(result.execution_authorized, false);
  assert.deepEqual(result.selected_branches, []);
});

test("Core V2 client opens its circuit after an authority violation", async () => {
  const values = env({ CORE_NYRA_DEEP_BRANCH_V2_CIRCUIT_FAILURE_THRESHOLD: "1" });
  let calls = 0;
  const client = createNyraDeepBranchV2Client({
    env: values,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        ok: true,
        schema_version: "nyra_deep_branch_v2_federation_response_v1",
        tenant_id: "codexai",
        request_id: "nyra-v2-preview-test",
        catalog: { fingerprint: loaded.catalog.catalog_fingerprint, root_binding_hash: loaded.manifest.root_binding_hash },
        validation: { ok: true, unchecked_shards: 0 },
        selected_branches: [],
        provenance: { core_policy_hash: "0".repeat(64) },
        execution_authorized: true,
        core_final_authority: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const first = await client.evaluate(input());
  const second = await client.evaluate(input({ requestId: "nyra-v2-preview-test-two" }));
  assert.equal(first.state, "unavailable_v1_authoritative");
  assert.equal(second.state, "circuit_open_v1_authoritative");
  assert.equal(calls, 1);
  assert.equal(second.execution_authorized, false);
});

test("Core V2 operational context refuses a missing memory-first read-only preflight", () => {
  const values = env({
    CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED: "true",
    CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE: "advisory",
    CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST: "codexai",
  });
  const client = createNyraDeepBranchV2Client({
    env: values,
    fetchImpl: async () => { throw new Error("Nyra must not be called before a ready preflight"); },
  });
  const rejected = client.beginOperational(input({
    branchId: "context_intelligence",
    subbranchId: "request_normalization",
  }));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.response.state, "core_preflight_not_ready_v1_authoritative");

  const accepted = client.beginOperational(input({
    branchId: "context_intelligence",
    subbranchId: "request_normalization",
    workPreflight: {
      preflight_id: "preflight-v2-operational",
      mandatory: true,
      state: "ready_read_only",
      governance: { execution_allowed_by_preflight: true },
      memory_first: { status: "recalled" },
    },
  }));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.branch_id, "context_intelligence");
  assert.equal(accepted.subbranch_id, "request_normalization");
});
