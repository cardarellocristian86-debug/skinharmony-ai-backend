import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  compareCatalogs,
  compareInterpretations,
  createNyraV2Bridge,
} from "../src/nyra-v2-bridge.js";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function skinHarmonyCoreCatalog() {
  const branches = Array.from({ length: 18 }, (_, index) => ({
    id: `branch_${index}`,
    label: `Branch ${index}`,
    work_phase: "test",
    core_branch_bindings: ["core_test"],
    subbranch_count: index === 17 ? 18 : 13,
    subbranches: Array.from({ length: index === 17 ? 18 : 13 }, (__, subIndex) => `sub_${index}_${subIndex}`),
  }));
  return {
    ok: true,
    tenant_id: "codexai",
    catalog: {
      schema_version: "nyra_neural_branch_network_v1",
      governance: "core_opens_nyra_branches",
      domain_pack_id: "skinharmony",
      branches,
    },
  };
}

function deepCatalogFor(corePayload) {
  const capturedAt = "2026-07-23T18:19:34.000Z";
  const source = "https://core.test/v1/nira/branches";
  const snapshot = {
    schema_version: "nyra_live_branch_catalog_snapshot_v1",
    captured_at: capturedAt,
    source,
    authenticated_tenant: "codexai",
    response: corePayload,
  };
  return {
    ok: true,
    tenant_id: "codexai",
    feature_flags: { enabled: true, mode: "shadow" },
    state: "ready_lazy_sharded",
    validation: {
      ok: true,
      metrics: { branch_count: 18, subbranch_count: 239, node_count: 1434 },
    },
    catalog: {
      schema_version: "nyra_deep_branch_architecture_v2",
      version: "2.0.0",
      authority: "universal_core",
      catalog_fingerprint: "f".repeat(64),
      rollback_checkpoint: `sha256:${"a".repeat(64)}`,
      source_catalog: {
        schema_version: "nyra_neural_branch_network_v1",
        captured_at: capturedAt,
        source,
        tenant_id: "codexai",
        domain_pack_id: "skinharmony",
        source_snapshot_sha256: sha256(snapshot),
      },
      function_registry: {
        schema_version: "nyra_deep_branch_function_registry_v1",
        registry_hash: "b".repeat(64),
        function_count: 1434,
      },
      runtime_manifest: {
        schema_version: "nyra_deep_branch_runtime_manifest_v1",
        manifest_hash: "c".repeat(64),
        shard_count: 239,
      },
    },
    execution_allowed: false,
    core_final_authority: true,
  };
}

test("attests the 18/239 SkinHarmony V2 catalog while keeping V1 authoritative", () => {
  const core = skinHarmonyCoreCatalog();
  const result = compareCatalogs(core, deepCatalogFor(core), "codexai");

  assert.equal(result.state, "shadow_synced_v1_authoritative");
  assert.equal(result.synchronized, true);
  assert.equal(result.selected_authority, "V1");
  assert.equal(result.execution_authorized, false);
  assert.equal(result.core_final_authority, true);
  assert.equal(result.parity.core.branch_count, 18);
  assert.equal(result.parity.core.subbranch_count, 239);
  assert.equal(result.parity.v2.node_count, 1434);
  assert.equal(result.parity.checks.snapshot_match, true);
  assert.equal(result.catalog.runtime_manifest.shard_count, 239);
  assert.equal("nodes" in result.catalog, false);
});

test("fails closed to V1 when the V2 tenant or source snapshot differs", () => {
  const core = skinHarmonyCoreCatalog();
  const deep = deepCatalogFor(core);
  deep.tenant_id = "other-tenant";
  deep.catalog.source_catalog.source_snapshot_sha256 = "0".repeat(64);

  const result = compareCatalogs(core, deep, "codexai");

  assert.equal(result.state, "shadow_mismatch_v1_authoritative");
  assert.equal(result.synchronized, false);
  assert.equal(result.parity.checks.deep_tenant_match, false);
  assert.equal(result.parity.checks.snapshot_match, false);
  assert.equal(result.execution_authorized, false);
});

test("compares real shadow routing only when V2 remains a Core-opened subset", () => {
  const authoritative = {
    ok: true,
    tenant_id: "codexai",
    result: {
      nyra_neural_network: {
        opened_branches: [{ id: "context_intelligence" }, { id: "risk_governance" }],
      },
    },
  };
  const nyra = {
    ok: true,
    tenant_id: "codexai",
    execution_allowed: false,
    core_router: authoritative,
    deep_branch_v2: {
      state: "shadow_v1_authoritative",
      mode: "shadow",
      selected_branches: [{ id: "risk_governance" }],
      execution_authorized: false,
      core_final_authority: true,
      catalog_version: "2.0.0",
    },
  };

  const matched = compareInterpretations(authoritative, nyra, "codexai");
  assert.equal(matched.state, "shadow_compared_v1_authoritative");
  assert.equal(matched.matched, true);

  nyra.deep_branch_v2.selected_branches.push({ id: "analyzer_domain" });
  const rejected = compareInterpretations(authoritative, nyra, "codexai");
  assert.equal(rejected.state, "shadow_mismatch_v1_authoritative");
  assert.equal(rejected.matched, false);
  assert.equal(rejected.parity.checks.v2_subset_of_core, false);
});

test("uses only the dedicated server-side bearer for Nyra V2 requests", async () => {
  const calls = [];
  const bridge = createNyraV2Bridge({
    nyraRuntimeUrl: "https://nyra.test",
    nyraRuntimeApiKey: "nyra-bridge-secret",
    nyraRuntimeTimeoutMs: 1_000,
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await bridge.catalog();
  await bridge.interpret({ message: "test shadow" });

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/api/nyra/runtime/v2/catalog",
    "/api/nyra/runtime/interpret",
  ]);
  assert(calls.every((call) => call.init.headers.authorization === "Bearer nyra-bridge-secret"));
  assert.equal(JSON.parse(calls[1].init.body).message, "test shadow");
});
