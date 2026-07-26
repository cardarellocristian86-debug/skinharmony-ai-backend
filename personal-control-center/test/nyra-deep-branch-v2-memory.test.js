"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const zlib = require("node:zlib");
const {
  DEFAULT_RUNTIME_MANIFEST_PATH,
  featureFlags,
  loadCatalog,
  loadRuntimeShard,
  route,
} = require("../lib/nyra-deep-branch-v2");

const repoRoot = path.resolve(__dirname, "../..");
const branchIds = [
  "context_intelligence",
  "work_intake",
  "research_evidence",
  "decision_reasoning",
  "planning_prioritization",
  "risk_governance",
  "delegated_authority",
  "decision_provenance",
  "execution_planning",
  "parallel_coordination",
  "quality_verification",
  "learning_memory",
  "adaptive_learning",
  "communication_explanation",
  "software_intelligence",
  "suite_domain",
  "smartdesk_domain",
  "analyzer_domain",
];

function enabledEnv(overrides = {}) {
  return {
    NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_MODE: "shadow",
    NYRA_DEEP_BRANCH_V2_BRANCHES: branchIds.join(","),
    NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "codexai",
    ...overrides,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) || typeof value === "string"
    ? value
    : JSON.stringify(canonicalize(value));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function rebindRuntimeManifest(manifest) {
  const descriptorProjection = manifest.shards.map((descriptor) => ({
    branch_id: descriptor.branch_id,
    subbranch_id: descriptor.subbranch_id,
    relative_path: descriptor.relative_path,
    uncompressed_sha256: descriptor.uncompressed_sha256,
    uncompressed_bytes: descriptor.uncompressed_bytes,
    node_count: descriptor.node_count,
    function_count: descriptor.function_count,
    node_ids: descriptor.node_ids,
  }));
  manifest.root_binding.shard_set_hash = sha256(descriptorProjection);
  manifest.root_binding_hash = sha256(manifest.root_binding);
  const manifestPayload = { ...manifest };
  delete manifestPayload.manifest_hash;
  manifest.manifest_hash = sha256(manifestPayload);
  return manifest;
}

test("disabled and foreign-tenant routes remain V1-authoritative without loading a catalog", () => {
  const missingCatalogPath = path.join(repoRoot, "does-not-exist", "nyra-v2.json");
  const disabled = route({
    tenantId: "codexai",
    env: { NYRA_DEEP_BRANCH_V2_ENABLED: "false" },
    catalogPath: missingCatalogPath,
  });
  assert.equal(disabled.state, "disabled_v1_authoritative");
  assert.deepEqual(disabled.selected_branches, []);
  assert.equal(disabled.execution_authorized, false);
  assert.equal(disabled.core_final_authority, true);
  assert.equal(disabled.fallback, "nyra_neural_branch_network_v1");

  assert.equal(featureFlags(enabledEnv(), "tenant-other").enabled, false);
  const foreign = route({
    tenantId: "tenant-other",
    env: enabledEnv(),
    catalogPath: missingCatalogPath,
  });
  assert.equal(foreign.state, "disabled_v1_authoritative");
  assert.deepEqual(foreign.selected_branches, []);
  assert.equal(foreign.execution_authorized, false);
  assert.equal(foreign.core_final_authority, true);
});

test("validation and a lazy evaluated deep route stay below 256 MiB without reading the monolith", (t) => {
  const childScript = String.raw`
    const assert = require("node:assert/strict");
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const v8 = require("node:v8");
    const reads = [];
    const opens = [];
    const originalReadFileSync = fs.readFileSync;
    const originalOpenSync = fs.openSync;
    fs.readFileSync = function trackedReadFileSync(filePath, ...args) {
      reads.push(path.resolve(String(filePath)));
      return originalReadFileSync.call(this, filePath, ...args);
    };
    fs.openSync = function trackedOpenSync(filePath, ...args) {
      opens.push(path.resolve(String(filePath)));
      return originalOpenSync.call(this, filePath, ...args);
    };
    const {
      loadCatalog,
      loadRuntimeShard,
      route,
    } = require("./personal-control-center/lib/nyra-deep-branch-v2");

    const branchIds = ${JSON.stringify(branchIds)};
    const env = {
      NYRA_DEEP_BRANCH_V2_ENABLED: "true",
      NYRA_DEEP_BRANCH_V2_MODE: "shadow",
      NYRA_DEEP_BRANCH_V2_BRANCHES: branchIds.join(","),
      NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "codexai",
    };
    const corePayload = {
      tenant_id: "codexai",
      domain_pack: { id: "skinharmony" },
      result: {
        nyra_neural_network: {
          opened_by: "universal_core",
          opened_branches: branchIds.map((id) => ({ id, status: "opened" })),
          execution_authorized: false,
        },
      },
    };

    const loaded = loadCatalog({ forceReload: true, runtimeMode: "lazy" });
    assert.equal(loaded.ok, true, loaded.validation.errors.join("\\n"));
    const validationPayload = {
      ok: loaded.ok,
      state: loaded.state,
      validation: loaded.validation,
      catalog_fingerprint: loaded.catalog.catalog_fingerprint,
      execution_allowed: false,
      core_final_authority: true,
    };
    const validationBody = JSON.stringify(validationPayload);
    assert(!validationBody.includes('"function_registry"'));
    assert(!validationBody.includes('"nodes"'));
    assert(Buffer.byteLength(validationBody) < 32 * 1024);

    const routed = route({
      tenantId: "codexai",
      domainPackId: "skinharmony",
      corePayload,
      requestedBranches: branchIds,
      evaluationContext: {
        subbranch_id: "request_normalization",
        evidence: [],
        evidence_source: "bounded_memory_negative_probe",
        node_inputs: {},
        request_id: "bounded_memory_deep_route",
        observed_at: Date.parse("2026-07-23T00:00:00.000Z"),
      },
      env,
    });
    assert.equal(routed.state, "shadow_v1_authoritative");
    assert.equal(routed.selected_branches.length, 18);
    assert.equal(routed.evaluations.length, 6);
    assert(routed.evaluations.every((evaluation) => evaluation.state !== "advisory_verified"));
    assert(routed.evaluations.every((evaluation) => evaluation.execution_authorized === false));
    assert(routed.evaluations.every((evaluation) => evaluation.core_final_authority === true));
    assert.equal(routed.execution_authorized, false);
    assert.equal(routed.core_final_authority, true);

    let routedNodeCount = 0;
    for (const branch of routed.selected_branches) {
      for (const subbranch of branch.subbranches) {
        for (const specialized of subbranch.specialized_capabilities) {
          routedNodeCount += 1;
          for (const micro of specialized.micro_capabilities) {
            routedNodeCount += 1 + micro.level4.length;
          }
        }
      }
    }
    assert.equal(routedNodeCount, 1434);
    const routeBody = JSON.stringify(routed);
    assert(!routeBody.includes('"input_schema"'));
    assert(!routeBody.includes('"function_registry"'));
    assert(!routeBody.includes('"semantic_assertions"'));
    assert(Buffer.byteLength(routeBody) < 1024 * 1024);

    const noCore = route({
      tenantId: "codexai",
      domainPackId: "skinharmony",
      corePayload: {},
      requestedBranches: branchIds,
      env,
    });
    assert.equal(noCore.state, "core_route_absent_v1_authoritative");
    assert.deepEqual(noCore.selected_branches, []);
    assert.equal(noCore.execution_authorized, false);
    assert.equal(noCore.core_final_authority, true);

    const tenantShard = loadRuntimeShard({
      loaded,
      tenantId: "codexai",
      branchId: "context_intelligence",
      subbranchId: "request_normalization",
      env,
    });
    const foreignTenantShard = loadRuntimeShard({
      loaded,
      tenantId: "tenant-other",
      branchId: "context_intelligence",
      subbranchId: "request_normalization",
      env,
    });
    assert.equal(tenantShard.ok, true);
    assert.equal(foreignTenantShard.ok, true);
    assert.notStrictEqual(tenantShard.nodes, foreignTenantShard.nodes);

    const memory = process.memoryUsage();
    const peakRssMib = process.resourceUsage().maxRSS / 1024;
    const maxOldSpaceArgument = process.execArgv.find(
      (argument) => argument.startsWith("--max-old-space-size=")
    );
    const requestedMaxOldSpaceMib = Number(maxOldSpaceArgument?.split("=")[1] || 0);
    const monolithPath = path.resolve(
      "personal-control-center/data/nyra-deep-branch-v2.catalog.json"
    );
    assert(!reads.includes(monolithPath), "legacy catalog monolith was read");
    assert(!opens.includes(monolithPath), "legacy catalog monolith was opened");
    assert(memory.heapUsed < 256 * 1024 * 1024);
    assert(memory.rss < 256 * 1024 * 1024);
    assert(peakRssMib < 256);
    const runtimePath = path.resolve(
      "personal-control-center/lib/nyra-deep-branch-v2.js"
    );
    const runtimeLoaderSha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(runtimePath))
      .digest("hex");
    const firstShardPath = path.resolve(
      path.dirname(loaded.manifest_path),
      loaded.manifest.shards[0].relative_path
    );
    const generationRoot = path.dirname(firstShardPath);
    const catalogShardRoot = path.dirname(generationRoot);
    const generationCount = fs.readdirSync(catalogShardRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
      .length;
    const shardFileCount = fs.readdirSync(generationRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json.gz"))
      .length;
    const validationBytes = Buffer.byteLength(validationBody);
    const routeBytes = Buffer.byteLength(routeBody);
    const heapLimitMib = v8.getHeapStatistics().heap_size_limit / 1024 / 1024;
    const heapUsedMib = memory.heapUsed / 1024 / 1024;
    const rssMib = memory.rss / 1024 / 1024;
    const monolithReads = reads.filter((filePath) => filePath === monolithPath).length;
    const monolithOpens = opens.filter((filePath) => filePath === monolithPath).length;
    const budgets = {
      requested_max_old_space_mib: 256,
      heap_size_limit_max_mib: 384,
      heap_used_max_mib: 256,
      rss_max_mib: 256,
      peak_rss_max_mib: 256,
      validation_response_max_bytes: 100 * 1024,
      route_response_max_bytes: 1024 * 1024,
      monolith_reads_max: 0,
      monolith_opens_max: 0,
      required_shard_count: 239,
      required_generation_count: 1,
    };
    const checks = {
      requested_max_old_space: requestedMaxOldSpaceMib === budgets.requested_max_old_space_mib,
      heap_size_limit: heapLimitMib < budgets.heap_size_limit_max_mib,
      heap_used: heapUsedMib < budgets.heap_used_max_mib,
      rss: rssMib < budgets.rss_max_mib,
      peak_rss: peakRssMib < budgets.peak_rss_max_mib,
      validation_response: validationBytes < budgets.validation_response_max_bytes,
      route_response: routeBytes < budgets.route_response_max_bytes,
      monolith_reads: monolithReads <= budgets.monolith_reads_max,
      monolith_opens: monolithOpens <= budgets.monolith_opens_max,
      catalog_binding: runtimeLoaderSha256 === loaded.manifest.root_binding.runtime_loader_sha256,
      shard_count: loaded.manifest.shards.length === budgets.required_shard_count
        && loaded.validation.integrity.checked_shards === budgets.required_shard_count
        && loaded.validation.integrity.unchecked_shards === 0
        && shardFileCount === budgets.required_shard_count,
      generation_count: generationCount === budgets.required_generation_count,
      topology: routedNodeCount === 1434 && routed.evaluations.length === 6,
      authority: routed.execution_authorized === false && routed.core_final_authority === true,
    };
    const report = {
      schema_version: "nyra_deep_branch_v2_runtime_memory_benchmark_v1",
      generated_at: new Date().toISOString(),
      harness: {
        command: process.execPath,
        exec_argv: process.execArgv,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      identity: {
        canonical_catalog_fingerprint: loaded.catalog.catalog_fingerprint,
        manifest_catalog_fingerprint: loaded.manifest.root_binding.catalog_fingerprint,
        runtime_loader_sha256_declared: loaded.manifest.root_binding.runtime_loader_sha256,
        runtime_loader_sha256_actual: runtimeLoaderSha256,
        runtime_loader_hash_match: runtimeLoaderSha256
          === loaded.manifest.root_binding.runtime_loader_sha256,
        manifest_hash: loaded.manifest.manifest_hash,
        root_binding_hash: loaded.manifest.root_binding_hash,
        catalog_binding_hash: loaded.manifest.catalog_binding_hash,
      },
      process_memory: {
        requested_max_old_space_mib: requestedMaxOldSpaceMib,
        heap_limit_mib: heapLimitMib,
        heap_used_mib: heapUsedMib,
        rss_mib: rssMib,
        peak_rss_mib: peakRssMib,
      },
      runtime_io: {
        tracked_reads: reads.length,
        tracked_opens: opens.length,
        monolith_path: monolithPath,
        monolith_reads: monolithReads,
        monolith_opens: monolithOpens,
      },
      shard_integrity: {
        manifest_shard_count: loaded.manifest.shards.length,
        checked_shards: loaded.validation.integrity.checked_shards,
        unchecked_shards: loaded.validation.integrity.unchecked_shards,
        on_disk_shard_count: shardFileCount,
        on_disk_generation_count: generationCount,
      },
      responses: {
        validation_bytes: validationBytes,
        route_bytes: routeBytes,
      },
      deep_route: {
        selected_branches: routed.selected_branches.length,
        routed_nodes: routedNodeCount,
        evaluated_nodes: routed.evaluations.length,
        execution_authorized: routed.execution_authorized,
        core_final_authority: routed.core_final_authority,
      },
      tenant_isolation: {
        foreign_tenant_cache_object_shared: tenantShard.nodes === foreignTenantShard.nodes,
        passed: tenantShard.nodes !== foreignTenantShard.nodes,
      },
      budgets,
      checks,
      passed: Object.values(checks).every(Boolean)
        && tenantShard.nodes !== foreignTenantShard.nodes,
    };
    process.stdout.write(JSON.stringify(report));
  `;

  const child = spawnSync(process.execPath, [
    "--max-old-space-size=256",
    "-e",
    childScript,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });

  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.passed, true);
  assert.equal(result.deep_route.routed_nodes, 1434);
  assert.equal(result.deep_route.evaluated_nodes, 6);
  assert(result.process_memory.heap_used_mib < 256);
  assert(result.process_memory.rss_mib < 256);
  assert(result.process_memory.peak_rss_mib < 256);
  assert(result.responses.validation_bytes < 100 * 1024);
  assert(result.responses.route_bytes < 1024 * 1024);
  const reportPath = String(process.env.NYRA_DEEP_V2_MEMORY_REPORT_PATH || "").trim();
  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  t.diagnostic(JSON.stringify({
    heap_limit_mib: result.process_memory.heap_limit_mib,
    heap_used_mib: result.process_memory.heap_used_mib,
    rss_mib: result.process_memory.rss_mib,
    peak_rss_mib: result.process_memory.peak_rss_mib,
    validation_bytes: result.responses.validation_bytes,
    route_bytes: result.responses.route_bytes,
    routed_nodes: result.deep_route.routed_nodes,
    evaluated_nodes: result.deep_route.evaluated_nodes,
    tracked_reads: result.runtime_io.tracked_reads,
    tracked_opens: result.runtime_io.tracked_opens,
    monolith_reads: result.runtime_io.monolith_reads,
    monolith_opens: result.runtime_io.monolith_opens,
  }));
});

test("missing, tampered, swapped, oversized and stale shards all fail closed", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-shard-negative-"));
  const manifestPath = path.join(temporaryRoot, path.basename(DEFAULT_RUNTIME_MANIFEST_PATH));
  const sourceManifestBytes = fs.readFileSync(DEFAULT_RUNTIME_MANIFEST_PATH);
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const sourceShardRoot = path.resolve(
    path.dirname(DEFAULT_RUNTIME_MANIFEST_PATH),
    "nyra-deep-branch-v2.shards"
  );
  const temporaryShardRoot = path.resolve(temporaryRoot, "nyra-deep-branch-v2.shards");
  fs.writeFileSync(manifestPath, sourceManifestBytes);
  fs.cpSync(sourceShardRoot, temporaryShardRoot, { recursive: true });

  const firstDescriptor = sourceManifest.shards[0];
  const secondDescriptor = sourceManifest.shards[1];
  const firstShardPath = path.resolve(temporaryRoot, firstDescriptor.relative_path);
  const secondShardPath = path.resolve(temporaryRoot, secondDescriptor.relative_path);
  const firstShardBytes = fs.readFileSync(firstShardPath);
  const secondShardBytes = fs.readFileSync(secondShardPath);
  const reset = () => {
    fs.writeFileSync(manifestPath, sourceManifestBytes);
    fs.writeFileSync(firstShardPath, firstShardBytes);
    fs.writeFileSync(secondShardPath, secondShardBytes);
  };
  const rejectedManifest = (label) => {
    const loaded = loadCatalog({
      manifestPath,
      runtimeMode: "lazy",
      forceReload: true,
    });
    assert.equal(loaded.ok, false, `${label} unexpectedly loaded`);
    assert.equal(loaded.catalog, null);
    assert.equal(loaded.state, "runtime_manifest_rejected");
    assert(loaded.validation.errors.length > 0);
    return loaded.validation.errors;
  };

  try {
    fs.rmSync(firstShardPath);
    assert(
      rejectedManifest("missing shard").some((error) => error.startsWith("shard_integrity_failed:"))
    );

    reset();
    const tampered = Buffer.from(firstShardBytes);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    fs.writeFileSync(firstShardPath, tampered);
    assert(
      rejectedManifest("tampered shard").some((error) => error.startsWith(
        `shard_integrity_failed:${firstDescriptor.branch_id}.${firstDescriptor.subbranch_id}:`
      ))
    );

    reset();
    fs.writeFileSync(firstShardPath, secondShardBytes);
    const swappedErrors = rejectedManifest("swapped shard");
    assert(
      swappedErrors.some((error) => error.startsWith(
        `shard_integrity_failed:${firstDescriptor.branch_id}.${firstDescriptor.subbranch_id}:`
      ))
    );

    reset();
    const bombManifest = structuredClone(sourceManifest);
    const bombDescriptor = bombManifest.shards[0];
    const gzipBomb = zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024, 0x41), {
      level: 9,
      mtime: 0,
    });
    bombDescriptor.compressed_sha256 = sha256(gzipBomb);
    bombDescriptor.compressed_bytes = gzipBomb.length;
    bombDescriptor.uncompressed_bytes = gzipBomb.length * 16;
    bombDescriptor.uncompressed_sha256 = sha256(Buffer.alloc(bombDescriptor.uncompressed_bytes));
    rebindRuntimeManifest(bombManifest);
    fs.writeFileSync(firstShardPath, gzipBomb);
    fs.writeFileSync(manifestPath, `${JSON.stringify(bombManifest)}\n`);
    assert(
      rejectedManifest("oversized gzip shard").some(
        (error) => error.startsWith(
          `shard_integrity_failed:${firstDescriptor.branch_id}.${firstDescriptor.subbranch_id}:`
        )
      )
    );

    reset();
    const staleManifest = structuredClone(sourceManifest);
    const staleDescriptor = staleManifest.shards[0];
    const staleShard = JSON.parse(zlib.gunzipSync(firstShardBytes).toString("utf8"));
    staleShard.catalog_fingerprint = "0".repeat(64);
    const stalePayload = { ...staleShard };
    delete stalePayload.shard_hash;
    staleShard.shard_hash = sha256(stalePayload);
    const staleUncompressed = Buffer.from(`${JSON.stringify(staleShard)}\n`, "utf8");
    const staleCompressed = zlib.gzipSync(staleUncompressed, { level: 9, mtime: 0 });
    staleDescriptor.compressed_sha256 = sha256(staleCompressed);
    staleDescriptor.uncompressed_sha256 = sha256(staleUncompressed);
    staleDescriptor.compressed_bytes = staleCompressed.length;
    staleDescriptor.uncompressed_bytes = staleUncompressed.length;
    rebindRuntimeManifest(staleManifest);
    fs.writeFileSync(firstShardPath, staleCompressed);
    fs.writeFileSync(manifestPath, `${JSON.stringify(staleManifest)}\n`);

    const loaded = loadCatalog({
      manifestPath,
      runtimeMode: "lazy",
      forceReload: true,
    });
    assert.equal(loaded.ok, true, loaded.validation.errors.join("\n"));
    const stale = loadRuntimeShard({
      loaded,
      tenantId: "codexai",
      branchId: staleDescriptor.branch_id,
      subbranchId: staleDescriptor.subbranch_id,
      env: enabledEnv(),
    });
    assert.equal(stale.ok, false);
    assert(stale.errors.includes("shard_catalog_fingerprint_mismatch"));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("runtime packaging retains exactly the manifest generation and 239 shards", () => {
  const manifest = JSON.parse(fs.readFileSync(DEFAULT_RUNTIME_MANIFEST_PATH, "utf8"));
  const firstShardPath = path.resolve(
    path.dirname(DEFAULT_RUNTIME_MANIFEST_PATH),
    manifest.shards[0].relative_path
  );
  const generationRoot = path.dirname(firstShardPath);
  const catalogRoot = path.dirname(generationRoot);
  const generations = fs.readdirSync(catalogRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const shardFiles = fs.readdirSync(generationRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json.gz"));
  assert.deepEqual(generations, [manifest.catalog_binding_hash]);
  assert.equal(shardFiles.length, 239);
  assert.equal(manifest.shards.length, 239);
});

test("generation cleanup removes only stale 64-hex siblings inside the generated root", async () => {
  const modulePath = path.join(repoRoot, "scripts/lib/nyra-deep-branch-v2-shards.mjs");
  const { pruneStaleShardGenerations } = await import(pathToFileURL(modulePath).href);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-generation-cleanup-"));
  const shardRoot = path.join(temporaryRoot, "generated-shards");
  const catalogFingerprint = "a".repeat(64);
  const currentBinding = "b".repeat(64);
  const staleBinding = "c".repeat(64);
  const catalogRoot = path.join(shardRoot, "v1", catalogFingerprint);
  const currentRoot = path.join(catalogRoot, currentBinding);
  const staleRoot = path.join(catalogRoot, staleBinding);
  const nonGenerationRoot = path.join(catalogRoot, "manual-do-not-remove");
  const outsideSentinel = path.join(temporaryRoot, "outside-sentinel");
  try {
    fs.mkdirSync(currentRoot, { recursive: true });
    fs.mkdirSync(staleRoot, { recursive: true });
    fs.mkdirSync(nonGenerationRoot, { recursive: true });
    fs.mkdirSync(outsideSentinel, { recursive: true });
    for (let index = 0; index < 239; index += 1) {
      fs.writeFileSync(path.join(currentRoot, `shard-${index}.json.gz`), "current");
    }
    fs.writeFileSync(path.join(staleRoot, "stale.json.gz"), "stale");
    fs.writeFileSync(path.join(nonGenerationRoot, "sentinel"), "preserve");
    fs.writeFileSync(path.join(outsideSentinel, "sentinel"), "preserve");
    const cleanup = pruneStaleShardGenerations({
      shardRoot,
      catalogFingerprint,
      currentCatalogBindingHash: currentBinding,
    });
    assert.equal(cleanup.retained_generation, currentBinding);
    assert.equal(cleanup.retained_generation_count, 1);
    assert.equal(cleanup.shard_file_count, 239);
    assert.deepEqual(cleanup.removed_generations, [staleBinding]);
    assert.equal(fs.existsSync(staleRoot), false);
    assert.equal(fs.existsSync(currentRoot), true);
    assert.equal(fs.existsSync(nonGenerationRoot), true);
    assert.equal(fs.existsSync(outsideSentinel), true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
