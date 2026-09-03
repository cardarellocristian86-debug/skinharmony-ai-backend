import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createNyraDeepBranchV2Client, deepBranchV2Config } from "../src/nyraDeepBranchV2Client.js";
import { nyraBranchCatalog } from "../src/nyraBranchNetwork.js";

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
const runtimeBranchIds = loaded.catalog.branches.map((branch) => branch.id);

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
    entitlementDomainPackId: "generic",
    selectedByCore: { state: "ready", risk_band: "low", control_level: "observe" },
    nyraNetwork: { domain_pack_id: "generic", opened_branches: branches.map((id) => ({ id, status: "opened" })) },
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

function readinessPayload(overrides = {}, federationOverrides = {}) {
  return {
    ok: true,
    deep_branch_v2_federation: {
      enabled: true,
      configured: true,
      ready: true,
      ...federationOverrides,
    },
    deep_branch_v2_runtime: {
      schema_version: "nyra_deep_branch_v2_runtime_descriptor_v1",
      ready: true,
      feature_enabled: true,
      mode: "shadow",
      feature_tenant_configured: true,
      catalog_fingerprint: loaded.catalog.catalog_fingerprint,
      root_binding_hash: loaded.manifest.root_binding_hash,
      counts: {
        branch_count: runtimeBranchIds.length,
        subbranch_count: loaded.validation.metrics.subbranch_count,
        node_count: loaded.validation.metrics.node_count,
        shard_count: loaded.manifest.shards.length,
      },
      branch_ids: runtimeBranchIds,
      effective_branch_allowlist: branches,
      execution_authorized: false,
      core_final_authority: true,
      ...overrides,
    },
  };
}

function readinessResponse(overrides = {}, responseOptions = {}, federationOverrides = {}) {
  return new Response(JSON.stringify(readinessPayload(overrides, federationOverrides)), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...responseOptions,
  });
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

test("Core V2 configuration preserves all current SkinHarmony branches", () => {
  const allBranches = nyraBranchCatalog("skinharmony").branches.map((branch) => branch.id);
  const configuration = deepBranchV2Config(env({
    CORE_NYRA_DEEP_BRANCH_V2_BRANCHES: allBranches.join(","),
  }));

  assert.ok(allBranches.length > 0);
  assert.equal(new Set(allBranches).size, allBranches.length);
  assert.equal(configuration.enabled, true);
  assert.deepEqual(configuration.branch_allowlist, allBranches);
  assert.equal(configuration.branch_allowlist.at(-1), allBranches.at(-1));
});

test("Core V2 client rejects a preview that omits an opened branch", async () => {
  const values = env();
  const federation = createNyraDeepBranchV2Federation({ env: values });
  const upstream = federatedFetch(federation);
  const client = createNyraDeepBranchV2Client({
    env: values,
    fetchImpl: async (url, options) => {
      const response = await upstream(url, options);
      const payload = await response.json();
      payload.selected_branches = payload.selected_branches.slice(0, -1);
      return new Response(JSON.stringify(payload), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await client.evaluate(input());

  assert.equal(result.state, "unavailable_v1_authoritative");
  assert.equal(result.reason, "nyra_deep_branch_v2_preview_incomplete");
  assert.deepEqual(result.selected_branches, []);
  assert.equal(result.execution_authorized, false);
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

test("Core V2 client rejects a domain branch outside the authenticated entitlement pack", async () => {
  const values = env({ CORE_NYRA_DEEP_BRANCH_V2_BRANCHES: `${branches.join(",")},suite_domain` });
  const client = createNyraDeepBranchV2Client({
    env: values,
    fetchImpl: async () => { throw new Error("Nyra must not be called for an invalid entitlement route"); },
  });
  const result = await client.evaluate(input({
    nyraNetwork: { domain_pack_id: "generic", opened_branches: [{ id: "suite_domain", status: "opened" }] },
  }));
  assert.equal(result.state, "entitlement_denied_v1_authoritative");
  assert.equal(result.reason, "nyra_deep_branch_v2_branch_outside_entitlement_pack");
  assert.equal(result.execution_authorized, false);
});

test("Core V2 client accepts vertical branches only for the combined SkinHarmony entitlement", async () => {
  const verticalBranches = ["suite_domain", "smartdesk_domain", "analyzer_domain"];
  const allowedBranches = [...branches, ...verticalBranches];
  const values = env({
    CORE_NYRA_DEEP_BRANCH_V2_BRANCHES: allowedBranches.join(","),
    NYRA_DEEP_BRANCH_V2_BRANCHES: allowedBranches.join(","),
  });
  const federation = createNyraDeepBranchV2Federation({ env: values });
  const client = createNyraDeepBranchV2Client({
    env: values,
    fetchImpl: federatedFetch(federation),
  });
  const result = await client.evaluate(input({
    entitlementDomainPackId: "skinharmony",
    nyraNetwork: {
      domain_pack_id: "skinharmony",
      opened_branches: verticalBranches.map((id) => ({ id, status: "opened" })),
    },
  }));

  assert.equal(result.state, "active_after_core_branch_open");
  assert.deepEqual(
    result.selected_branches.map((branch) => branch.id),
    verticalBranches,
  );
  assert.equal(result.execution_authorized, false);
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

test("Core V2 operational POST rejects a declared response above 1 MB before reading it", async () => {
  let postSignal;
  const client = createNyraDeepBranchV2Client({
    env: env({
      CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED: "true",
      CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE: "advisory",
      CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST: "codexai",
    }),
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, "POST");
      postSignal = options.signal;
      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "1000001",
        },
      });
    },
  });
  const context = client.beginOperational(input({
    branchId: "context_intelligence",
    subbranchId: "request_normalization",
    workPreflight: {
      preflight_id: "preflight-v2-operational-declared-limit",
      mandatory: true,
      state: "ready_read_only",
      governance: { execution_allowed_by_preflight: true },
      memory_first: { status: "recalled" },
    },
  }));

  const result = await client.evaluateOperational({
    context,
    operationalAttestation: { schema_version: "test_attestation_v1" },
  });

  assert.equal(context.ok, true);
  assert.equal(result.state, "unavailable_v1_authoritative");
  assert.equal(result.reason, "nyra_deep_branch_v2_response_too_large");
  assert.equal(postSignal.aborted, true);
});

test("Core V2 operational POST aborts a chunked response after it crosses 1 MB", async () => {
  let postSignal;
  let streamCancelled = false;
  const client = createNyraDeepBranchV2Client({
    env: env({
      CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED: "true",
      CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE: "advisory",
      CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST: "codexai",
    }),
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, "POST");
      postSignal = options.signal;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(600_000));
          controller.enqueue(new Uint8Array(400_001));
        },
        cancel() {
          streamCancelled = true;
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const context = client.beginOperational(input({
    requestId: "nyra-v2-operational-chunked-limit",
    branchId: "context_intelligence",
    subbranchId: "request_normalization",
    workPreflight: {
      preflight_id: "preflight-v2-operational-chunked-limit",
      mandatory: true,
      state: "ready_read_only",
      governance: { execution_allowed_by_preflight: true },
      memory_first: { status: "recalled" },
    },
  }));

  const result = await client.evaluateOperational({
    context,
    operationalAttestation: { schema_version: "test_attestation_v1" },
  });

  assert.equal(context.ok, true);
  assert.equal(result.state, "unavailable_v1_authoritative");
  assert.equal(result.reason, "nyra_deep_branch_v2_response_too_large");
  assert.equal(postSignal.aborted, true);
  assert.equal(streamCancelled, true);
});

test("Core V2 readiness is healthy and network-free when V2 is disabled", async () => {
  const client = createNyraDeepBranchV2Client({
    env: env({ CORE_NYRA_DEEP_BRANCH_V2_ENABLED: "false" }),
    fetchImpl: async () => { throw new Error("disabled readiness must not call Nyra"); },
  });

  const result = await client.readiness();

  assert.equal(result.ready, true);
  assert.equal(result.enabled, false);
  assert.equal(result.state, "disabled_v1_authoritative");
  assert.equal(result.fallback, "nyra_neural_branch_network_v1");
  assert.equal(result.execution_authorized, false);
});

test("Core V2 readiness rejects a Nyra runtime pin mismatch", async () => {
  let requestOptions;
  const client = createNyraDeepBranchV2Client({
    env: env(),
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://nyra.test/healthz");
      requestOptions = options;
      return readinessResponse({ catalog_fingerprint: "b".repeat(64) });
    },
  });

  const result = await client.readiness();

  assert.equal(result.ready, false);
  assert.equal(result.reason, "nyra_deep_branch_v2_readiness_pin_mismatch");
  assert.equal(result.upstream_verified, false);
  assert.equal(requestOptions.method, "GET");
  assert.equal(requestOptions.redirect, "error");
  assert.equal(JSON.stringify(requestOptions.headers).includes(serviceKey), false);
});

test("Core V2 readiness rejects an effective Nyra allowlist missing a Core branch", async () => {
  const client = createNyraDeepBranchV2Client({
    env: env(),
    fetchImpl: async () => readinessResponse({
      effective_branch_allowlist: branches.slice(0, -1),
    }),
  });

  const result = await client.readiness();

  assert.equal(result.ready, false);
  assert.equal(result.reason, "nyra_deep_branch_v2_readiness_allowlist_mismatch");
  assert.equal(result.execution_authorized, false);
});

test("Core V2 readiness observes the tenant-effective Nyra feature kill switch", async () => {
  const client = createNyraDeepBranchV2Client({
    env: env(),
    fetchImpl: async () => readinessResponse({
      feature_enabled: false,
      mode: "disabled",
      effective_branch_allowlist: [],
    }),
  });

  const result = await client.readiness();

  assert.equal(result.ready, false);
  assert.equal(result.feature_enabled, false);
  assert.equal(result.feature_mode, "disabled");
  assert.equal(result.reason, "nyra_deep_branch_v2_readiness_feature_disabled");
  assert.equal(result.state, "upstream_mismatch_v1_authoritative");
});

test("Core V2 readiness rejects a disabled Nyra federation", async () => {
  const client = createNyraDeepBranchV2Client({
    env: env(),
    fetchImpl: async () => readinessResponse({}, {}, {
      enabled: false,
      configured: true,
      ready: false,
    }),
  });

  const result = await client.readiness();

  assert.equal(result.ready, false);
  assert.equal(result.federation_verified, false);
  assert.equal(result.reason, "nyra_deep_branch_v2_readiness_federation_disabled");
});

test("Core V2 readiness requires coherent shadow and active rollout modes", async () => {
  const shadowClient = createNyraDeepBranchV2Client({
    env: env(),
    fetchImpl: async () => readinessResponse({ mode: "active" }),
  });
  const activeClient = createNyraDeepBranchV2Client({
    env: env({ CORE_NYRA_DEEP_BRANCH_V2_MODE: "active" }),
    fetchImpl: async () => readinessResponse({ mode: "active" }),
  });

  const mismatch = await shadowClient.readiness();
  const active = await activeClient.readiness();

  assert.equal(mismatch.ready, false);
  assert.equal(mismatch.reason, "nyra_deep_branch_v2_readiness_mode_mismatch");
  assert.equal(active.ready, true);
  assert.equal(active.feature_mode, "active");
  assert.equal(active.federation_verified, true);
});

test("Core V2 readiness timeout is bounded and keeps V1 authoritative", async () => {
  const client = createNyraDeepBranchV2Client({
    env: env({ CORE_NYRA_DEEP_BRANCH_V2_READINESS_TIMEOUT_MS: "50" }),
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  const startedAt = Date.now();

  const result = await client.readiness();

  assert.equal(result.ready, false);
  assert.equal(result.reason, "nyra_deep_branch_v2_readiness_timeout");
  assert.equal(result.state, "upstream_unavailable_v1_authoritative");
  assert.ok(Date.now() - startedAt < 500);
});

test("Core V2 readiness is single-flight and caches a verified descriptor", async () => {
  let calls = 0;
  const client = createNyraDeepBranchV2Client({
    env: env({ CORE_NYRA_DEEP_BRANCH_V2_READINESS_CACHE_TTL_MS: "5000" }),
    fetchImpl: async () => {
      calls += 1;
      await Promise.resolve();
      return readinessResponse();
    },
  });

  const [first, second] = await Promise.all([client.readiness(), client.readiness()]);
  const cached = await client.readiness();

  assert.equal(calls, 1);
  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.equal(cached.ready, true);
  assert.equal(cached.upstream_verified, true);
  assert.deepEqual(cached.counts, {
    branch_count: 24,
    subbranch_count: 337,
    node_count: 2022,
    shard_count: 337,
  });
});

test("Core V2 readiness rejects a declared response above its byte budget", async () => {
  const client = createNyraDeepBranchV2Client({
    env: env(),
    fetchImpl: async () => readinessResponse({}, {
      headers: {
        "content-type": "application/json",
        "content-length": String(129 * 1024),
      },
    }),
  });

  const result = await client.readiness();

  assert.equal(result.ready, false);
  assert.equal(result.reason, "nyra_deep_branch_v2_readiness_response_too_large");
});
