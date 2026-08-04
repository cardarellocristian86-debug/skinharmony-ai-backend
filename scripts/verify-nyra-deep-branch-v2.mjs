#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { nyraBranchCatalog, routeNyraBranches } from "../services/universal-core-service/src/nyraBranchNetwork.js";
import {
  buildRuntimeArtifacts,
  MAX_RUNTIME_SHARD_COMPRESSED_BYTES,
  MAX_RUNTIME_SHARD_COMPRESSION_RATIO,
  MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES,
  MAX_RUNTIME_SHARDS_COMPRESSED_BYTES,
  MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES,
  reconstructCatalogFromRuntimeArtifacts,
  validationAttestationHash,
} from "./lib/nyra-deep-branch-v2-shards.mjs";

const require = createRequire(import.meta.url);
const {
  evaluateNode,
  featureFlags,
  loadCatalog,
  route,
  validateCatalog,
} = require("../personal-control-center/lib/nyra-deep-branch-v2");
const { createNyraHorizontalRuntime } = require("../personal-control-center/lib/nyra-horizontal-runtime");

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const runtimePath = path.join(repoRoot, "personal-control-center/lib/nyra-deep-branch-v2.js");
const memoryHarnessPath = path.join(
  repoRoot,
  "personal-control-center/test/nyra-deep-branch-v2-memory.test.js"
);
const smokeHarnessPath = path.join(
  repoRoot,
  "personal-control-center/test/nyra-runtime-smoke.js"
);
const LEVEL4_NODE_TYPES = Object.freeze(["method", "strategy", "verifier", "metric"]);
const NODES_PER_SUBBRANCH = 2 + LEVEL4_NODE_TYPES.length;
const CORE_SKINHARMONY_CATALOG = nyraBranchCatalog("skinharmony");
// Keep verification aligned with generation and supervision: these V1
// compatibility branches stay outside the frozen Deep V2 corpus until their
// research coverage and fixtures are intentionally introduced.
const V2_EXCLUDED_BRANCH_IDS = new Set([
  "tenant_work_coordination",
  "agent_change_interlock",
]);
const CORE_SKINHARMONY_V2_BRANCHES = CORE_SKINHARMONY_CATALOG.branches.filter(
  (branch) => !V2_EXCLUDED_BRANCH_IDS.has(branch.id),
);
const REQUIRED_RUNTIME_SHARD_COUNT = 299;
const MEMORY_HARNESS_TEST_NAME =
  "validation and a lazy evaluated deep route stay below 256 MiB without reading the monolith";
const PATH_ARGUMENTS = Object.freeze([
  "catalog",
  "registry",
  "supervisor",
  "report-root",
  "manifest",
  "shard-root",
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`invalid_argument:${key || "end"}`);
    }
    const name = key.slice(2);
    if (![...PATH_ARGUMENTS, "fixture", "fixtures"].includes(name)) {
      throw new Error(`unknown_argument:${name}`);
    }
    if (Object.hasOwn(args, name)) throw new Error(`duplicate_argument:${name}`);
    args[name] = value;
  }
  if (args.fixture && args.fixtures) throw new Error("duplicate_fixture_argument");
  return args;
}

function requiredPath(args, name) {
  const value = String(args[name] || "").trim();
  if (!value) throw new Error(`missing_argument:${name}`);
  return path.resolve(value);
}

function resolveCliPaths(argv) {
  const args = parseArgs(argv);
  const paths = Object.fromEntries(
    PATH_ARGUMENTS.map((name) => [name, requiredPath(args, name)])
  );
  const fixtureValue = String(args.fixtures || args.fixture || "").trim();
  if (!fixtureValue) throw new Error("missing_argument:fixtures");
  paths.fixtures = path.resolve(fixtureValue);
  const requiredInputFiles = {
    catalog: paths.catalog,
    fixtures: paths.fixtures,
    registry: paths.registry,
    supervisor: paths.supervisor,
  };
  for (const [name, filePath] of Object.entries(requiredInputFiles)) {
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch (error) {
      throw new Error(`input_unavailable:${name}:${error.code || error.message}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`regular_input_file_required:${name}`);
    }
  }
  const manifestDirectory = path.resolve(path.dirname(paths.manifest));
  const relativeShardRoot = path.relative(manifestDirectory, paths["shard-root"]);
  if (
    !relativeShardRoot
    || relativeShardRoot === "."
    || relativeShardRoot.startsWith(`..${path.sep}`)
    || relativeShardRoot === ".."
    || path.isAbsolute(relativeShardRoot)
  ) {
    throw new Error(
      "runtime_layout_invalid:--shard-root must be a safe descendant"
      + " of the --manifest directory"
    );
  }
  const mutablePaths = [
    paths["report-root"],
    paths.manifest,
    paths["shard-root"],
  ].map((filePath) => path.resolve(filePath));
  for (const inputPath of Object.values(requiredInputFiles)) {
    if (mutablePaths.some((mutablePath) => (
      inputPath === mutablePath
      || inputPath.startsWith(`${mutablePath}${path.sep}`)
    ))) {
      throw new Error(`input_overlaps_mutable_output:${inputPath}`);
    }
  }
  return {
    catalogPath: paths.catalog,
    fixturePath: paths.fixtures,
    registryPath: paths.registry,
    supervisorPath: paths.supervisor,
    reportRoot: paths["report-root"],
    runtimeManifestPath: paths.manifest,
    runtimeShardRoot: paths["shard-root"],
  };
}

function branchTopologyProjection(branches) {
  return (Array.isArray(branches) ? branches : []).map((branch) => ({
    id: branch.id,
    subbranches: (Array.isArray(branch.subbranches) ? branch.subbranches : []).map(
      (subbranch) => (typeof subbranch === "string" ? subbranch : subbranch.id)
    ),
  }));
}

function catalogTopology(catalog) {
  const branchProjection = branchTopologyProjection(catalog?.branches);
  const subbranchCount = branchProjection.reduce(
    (sum, branch) => sum + branch.subbranches.length,
    0
  );
  return {
    branch_count: branchProjection.length,
    subbranch_count: subbranchCount,
    node_count: subbranchCount * NODES_PER_SUBBRANCH,
  };
}

const CORE_SKINHARMONY_TOPOLOGY = Object.freeze({
  projection: branchTopologyProjection(CORE_SKINHARMONY_V2_BRANCHES),
  ...catalogTopology({
    ...CORE_SKINHARMONY_CATALOG,
    branches: CORE_SKINHARMONY_V2_BRANCHES,
  }),
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] || 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function rawSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deepEqualJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function extractHarnessReport(stdout) {
  const source = String(stdout || "");
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const candidate = JSON.parse(source.slice(start, index + 1));
          if (
            candidate
            && typeof candidate === "object"
            && (candidate.ok === true || candidate.passed === true)
          ) {
            candidates.push(candidate);
          }
        } catch {
          // Ignore non-JSON process logs.
        }
        start = -1;
      }
    }
  }
  return candidates
    .sort((left, right) => JSON.stringify(right).length - JSON.stringify(left).length)[0]
    || null;
}

function runEvidenceHarness({
  label,
  args,
  reportPath,
  reportEnv,
  runtimeManifestPath,
  allowStdoutReport = false,
  timeoutMs = 120_000,
} = {}) {
  fs.rmSync(reportPath, { force: true });
  const execution = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      [reportEnv]: reportPath,
      NYRA_DEEP_BRANCH_V2_RUNTIME_MANIFEST_PATH: runtimeManifestPath,
      NYRA_DEEP_BRANCH_V2_RUNTIME_MODE: "lazy",
      NYRA_DEEP_V2_RUNTIME_MANIFEST_PATH: runtimeManifestPath,
      NYRA_DEEP_V2_RUNTIME_MODE: "lazy",
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs,
  });
  fs.writeFileSync(`${reportPath}.stdout.log`, execution.stdout || "", "utf8");
  fs.writeFileSync(`${reportPath}.stderr.log`, execution.stderr || "", "utf8");
  if (execution.error || execution.status !== 0 || execution.signal) {
    const details = [
      execution.error?.message,
      execution.signal ? `signal=${execution.signal}` : "",
      Number.isInteger(execution.status) ? `status=${execution.status}` : "",
      execution.stdout?.slice(-4000),
      execution.stderr?.slice(-4000),
    ].filter(Boolean).join("\n");
    throw new Error(`${label}_failed:${details}`);
  }
  const report = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
    : allowStdoutReport
      ? extractHarnessReport(execution.stdout)
      : null;
  if (!report) throw new Error(`${label}_report_missing`);
  if (!fs.existsSync(reportPath)) writeJson(reportPath, report);
  if (report.passed !== true && report.ok !== true) {
    throw new Error(`${label}_report_not_passed:${JSON.stringify(report).slice(0, 4000)}`);
  }
  return {
    report,
    stdout: execution.stdout,
    stderr: execution.stderr,
    forwarding: {
      runtime_mode: "lazy",
      manifest_path: path.resolve(runtimeManifestPath),
      environment_api: [
        "NYRA_DEEP_BRANCH_V2_RUNTIME_MANIFEST_PATH",
        "NYRA_DEEP_BRANCH_V2_RUNTIME_MODE",
      ],
    },
  };
}

function strictDirectoryEntries(directoryPath) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`runtime_set_symlink_forbidden:${path.join(directoryPath, entry.name)}`);
    }
  }
  return entries;
}

function assertRuntimeArtifactBudgets({
  manifestPath,
  shardRoot,
  expectedShardCount = REQUIRED_RUNTIME_SHARD_COUNT,
}) {
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("runtime_manifest_regular_file_required");
  }
  if (manifestStat.size > 5 * 1024 * 1024) {
    throw new Error(`runtime_manifest_size_exceeded:${manifestStat.size}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const fingerprint = String(manifest.catalog?.catalog_fingerprint || "");
  const binding = String(manifest.catalog_binding_hash || "");
  const hexDigest = /^[a-f0-9]{64}$/;
  if (
    !hexDigest.test(fingerprint)
    || !hexDigest.test(binding)
    || !hexDigest.test(String(manifest.root_binding_hash || ""))
    || !hexDigest.test(String(manifest.manifest_hash || ""))
    || manifest.root_binding?.catalog_fingerprint !== fingerprint
  ) {
    throw new Error("runtime_manifest_identity_invalid");
  }
  const rootEntries = strictDirectoryEntries(shardRoot);
  if (
    rootEntries.length !== 1
    || rootEntries[0].name !== "v1"
    || !rootEntries[0].isDirectory()
  ) throw new Error("runtime_shard_root_contains_foreign_entries");
  const v1Root = path.join(shardRoot, "v1");
  const fingerprintEntries = strictDirectoryEntries(v1Root);
  if (
    fingerprintEntries.length !== 1
    || fingerprintEntries[0].name !== fingerprint
    || !fingerprintEntries[0].isDirectory()
  ) throw new Error("runtime_shard_fingerprint_generation_invalid");
  const fingerprintRoot = path.join(v1Root, fingerprint);
  const bindingEntries = strictDirectoryEntries(fingerprintRoot);
  if (
    bindingEntries.length !== 1
    || bindingEntries[0].name !== binding
    || !bindingEntries[0].isDirectory()
  ) throw new Error("runtime_shard_binding_generation_invalid");
  const generationRoot = path.join(fingerprintRoot, binding);
  const generationEntries = strictDirectoryEntries(generationRoot);
  if (
    generationEntries.length !== expectedShardCount
    || generationEntries.some((entry) => (
      !entry.isFile() || !entry.name.endsWith(".json.gz")
    ))
  ) {
    throw new Error(`runtime_shard_file_set_invalid:${generationEntries.length}`);
  }
  const descriptors = Array.isArray(manifest.shards) ? manifest.shards : [];
  if (
    descriptors.length !== expectedShardCount
    || new Set(descriptors.map((descriptor) => descriptor.relative_path)).size
      !== expectedShardCount
  ) throw new Error(`runtime_manifest_shard_index_invalid:${descriptors.length}`);
  const expectedFiles = new Set(
    descriptors.map((descriptor) => path.resolve(
      path.dirname(manifestPath),
      descriptor.relative_path
    ))
  );
  const actualFiles = generationEntries.map((entry) => path.join(generationRoot, entry.name));
  if (
    actualFiles.some((filePath) => !expectedFiles.has(filePath))
    || [...expectedFiles].some((filePath) => !actualFiles.includes(filePath))
  ) throw new Error("runtime_manifest_disk_shard_set_mismatch");
  let compressedBytes = 0;
  let uncompressedBytes = 0;
  let maximumCompressedBytes = 0;
  let maximumUncompressedBytes = 0;
  let maximumCompressionRatio = 0;
  const descriptorByPath = new Map(descriptors.map((descriptor) => [
    path.resolve(path.dirname(manifestPath), descriptor.relative_path),
    descriptor,
  ]));
  for (const filePath of actualFiles) {
    const descriptor = descriptorByPath.get(filePath);
    const compressed = fs.readFileSync(filePath);
    if (
      compressed.length === 0
      || compressed.length > MAX_RUNTIME_SHARD_COMPRESSED_BYTES
      || descriptor.compressed_bytes !== compressed.length
      || descriptor.compressed_sha256 !== rawSha256(compressed)
    ) throw new Error(`runtime_compressed_shard_invalid:${path.basename(filePath)}`);
    const uncompressed = zlib.gunzipSync(compressed, {
      maxOutputLength: MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES,
    });
    const ratio = uncompressed.length / compressed.length;
    if (
      uncompressed.length > MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES
      || ratio > MAX_RUNTIME_SHARD_COMPRESSION_RATIO
      || descriptor.uncompressed_bytes !== uncompressed.length
      || descriptor.uncompressed_sha256 !== rawSha256(uncompressed)
    ) throw new Error(`runtime_uncompressed_shard_invalid:${path.basename(filePath)}`);
    compressedBytes += compressed.length;
    uncompressedBytes += uncompressed.length;
    maximumCompressedBytes = Math.max(maximumCompressedBytes, compressed.length);
    maximumUncompressedBytes = Math.max(maximumUncompressedBytes, uncompressed.length);
    maximumCompressionRatio = Math.max(maximumCompressionRatio, ratio);
  }
  if (
    compressedBytes > MAX_RUNTIME_SHARDS_COMPRESSED_BYTES
    || uncompressedBytes > MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES
  ) throw new Error("runtime_shard_aggregate_size_exceeded");
  return {
    passed: true,
    manifest_bytes: manifestStat.size,
    shard_count: actualFiles.length,
    fingerprint_count: fingerprintEntries.length,
    binding_count: bindingEntries.length,
    catalog_fingerprint: fingerprint,
    catalog_binding_hash: binding,
    root_binding_hash: manifest.root_binding_hash,
    compressed_bytes: compressedBytes,
    uncompressed_bytes: uncompressedBytes,
    maximum_compressed_bytes: maximumCompressedBytes,
    maximum_uncompressed_bytes: maximumUncompressedBytes,
    maximum_compression_ratio: maximumCompressionRatio,
  };
}

function runtimeSetSnapshot({ manifestPath, shardRoot }) {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const directories = [];
  const files = [];
  const visit = (directoryPath) => {
    for (const entry of strictDirectoryEntries(directoryPath)
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(shardRoot, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        directories.push(relativePath);
        visit(absolutePath);
      } else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolutePath);
        files.push({
          relative_path: relativePath,
          bytes: bytes.length,
          byte_sha256: rawSha256(bytes),
        });
      } else {
        throw new Error(`runtime_set_foreign_entry:${absolutePath}`);
      }
    }
  };
  visit(shardRoot);
  return {
    manifest: {
      bytes: manifestBytes.length,
      byte_sha256: rawSha256(manifestBytes),
      manifest_hash: manifest.manifest_hash,
      root_binding_hash: manifest.root_binding_hash,
      catalog_binding_hash: manifest.catalog_binding_hash,
      catalog_fingerprint: manifest.catalog?.catalog_fingerprint,
    },
    directories,
    files,
  };
}

function commonAncestor(directoryPaths) {
  let ancestor = path.resolve(directoryPaths[0]);
  for (const candidate of directoryPaths.slice(1).map((item) => path.resolve(item))) {
    while (
      candidate !== ancestor
      && !candidate.startsWith(`${ancestor}${path.sep}`)
    ) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
  return ancestor;
}

function isolatedRuntimeBuildPaths({
  catalogPath,
  fixturePath,
  manifestPath,
  shardRoot,
  temporaryRoot,
}) {
  const sourceRoot = commonAncestor([
    path.dirname(catalogPath),
    path.dirname(fixturePath),
    path.dirname(manifestPath),
    path.dirname(shardRoot),
  ]);
  const project = (sourcePath) => path.join(
    temporaryRoot,
    path.relative(sourceRoot, sourcePath)
  );
  const isolatedCatalogPath = project(catalogPath);
  const isolatedFixturePath = project(fixturePath);
  const isolatedManifestPath = project(manifestPath);
  const isolatedShardRoot = project(shardRoot);
  fs.mkdirSync(path.dirname(isolatedCatalogPath), { recursive: true });
  fs.mkdirSync(path.dirname(isolatedFixturePath), { recursive: true });
  fs.copyFileSync(catalogPath, isolatedCatalogPath);
  fs.copyFileSync(fixturePath, isolatedFixturePath);
  return {
    catalogPath: isolatedCatalogPath,
    fixturePath: isolatedFixturePath,
    manifestPath: isolatedManifestPath,
    shardRoot: isolatedShardRoot,
  };
}

function assertReconstructedCatalog({ label, manifestPath, catalog, expectedTopology }) {
  const reconstructed = reconstructCatalogFromRuntimeArtifacts({ manifestPath });
  const reconstructedValidation = validateCatalog(reconstructed);
  if (
    reconstructed.catalog_fingerprint !== catalog.catalog_fingerprint
    || !deepEqualJson(reconstructed, catalog)
    || JSON.stringify(reconstructed) !== JSON.stringify(catalog)
    || !reconstructedValidation.ok
    || reconstructedValidation.metrics.node_count !== expectedTopology.node_count
  ) {
    throw new Error(
      `${label}_runtime_shard_reconstruction_invalid:`
      + `${reconstructedValidation.errors.join(",")}`
    );
  }
  return {
    catalog_fingerprint: reconstructed.catalog_fingerprint,
    byte_exact_json_projection: true,
    canonical_catalog_match: true,
    validation: reconstructedValidation.metrics,
  };
}

function assertRuntimeLoaderModes({
  label,
  manifestPath,
  expectedManifest,
  expectedShardCount,
}) {
  const lazy = loadCatalog({
    manifestPath,
    runtimeMode: "lazy",
    forceReload: true,
    verifyArtifacts: false,
  });
  const lazyIntegrity = lazy.validation?.integrity || {};
  if (
    lazy.ok !== true
    || lazy.manifest?.manifest_hash !== expectedManifest.manifest_hash
    || lazyIntegrity.checked_shards !== expectedShardCount
    || lazyIntegrity.unchecked_shards !== 0
    || lazyIntegrity.content_verified_shards !== 0
    || lazyIntegrity.deferred_content_shards !== expectedShardCount
    || lazyIntegrity.parse_mode !== "manifest_descriptor_and_file_stat_only"
  ) {
    throw new Error(`${label}_lazy_descriptor_verification_failed:${JSON.stringify({
      ok: lazy.ok,
      errors: lazy.validation?.errors,
      integrity: lazyIntegrity,
    })}`);
  }
  const full = loadCatalog({
    manifestPath,
    runtimeMode: "lazy",
    forceReload: true,
    verifyArtifacts: true,
  });
  const fullIntegrity = full.validation?.integrity || {};
  if (
    full.ok !== true
    || full.manifest?.manifest_hash !== expectedManifest.manifest_hash
    || fullIntegrity.checked_shards !== expectedShardCount
    || fullIntegrity.unchecked_shards !== 0
    || fullIntegrity.content_verified_shards !== expectedShardCount
    || fullIntegrity.deferred_content_shards !== 0
    || fullIntegrity.parse_mode !== "sequential_hash_and_gunzip_without_json_parse"
  ) {
    throw new Error(`${label}_full_artifact_verification_failed:${JSON.stringify({
      ok: full.ok,
      errors: full.validation?.errors,
      integrity: fullIntegrity,
    })}`);
  }
  return {
    lazy_descriptor_stat: {
      passed: true,
      checked_shards: lazyIntegrity.checked_shards,
      content_verified_shards: lazyIntegrity.content_verified_shards,
      deferred_content_shards: lazyIntegrity.deferred_content_shards,
      parse_mode: lazyIntegrity.parse_mode,
    },
    full_verify_artifacts: {
      passed: true,
      checked_shards: fullIntegrity.checked_shards,
      content_verified_shards: fullIntegrity.content_verified_shards,
      deferred_content_shards: fullIntegrity.deferred_content_shards,
      parse_mode: fullIntegrity.parse_mode,
    },
  };
}

function buildRuntimeEvidence({
  catalog,
  catalogPath,
  manifest,
  memoryReport,
  smokeReport,
  memoryForwarding,
  smokeForwarding,
}) {
  const runtimeLoaderSha256 = rawSha256(fs.readFileSync(runtimePath));
  const catalogArtifactSha256 = rawSha256(fs.readFileSync(catalogPath));
  const memory = memoryReport.process_memory || {};
  const io = memoryReport.runtime_io || {};
  const shards = memoryReport.shard_integrity || {};
  const memoryResponses = memoryReport.responses || {};
  const httpResponses = smokeReport.bounded_payload_bytes || {};
  const validationBurst = smokeReport.authenticated_bursts?.validation || {};
  const catalogBurst = smokeReport.authenticated_bursts?.catalog || {};
  const detailedHttpEvidence = [
    httpResponses.deep_validation,
    httpResponses.deep_catalog_summary,
    httpResponses.deep_interpretation,
    validationBurst.requests,
    catalogBurst.requests,
  ].every(Number.isFinite);
  const budgets = {
    requested_max_old_space_mib: 256,
    heap_size_limit_max_mib: 384,
    heap_used_max_mib: 256,
    rss_max_mib: 256,
    peak_rss_max_mib: 256,
    monolith_reads_max: 0,
    monolith_opens_max: 0,
    required_shard_count: catalogTopology(catalog).subbranch_count,
    required_generation_count: 1,
    validation_response_max_bytes: 100 * 1024,
    catalog_response_max_bytes: 100 * 1024,
    route_response_max_bytes: 1024 * 1024,
    burst_requests_per_endpoint: 40,
    burst_minimum_concurrency: 16,
    burst_latency_p95_max_ms: 1000,
    burst_latency_max_ms: 2000,
  };
  const checks = {
    memory_harness_passed: memoryReport.passed === true,
    http_harness_passed: smokeReport.passed === true || smokeReport.ok === true,
    harness_runtime_forwarding: memoryForwarding?.runtime_mode === "lazy"
      && smokeForwarding?.runtime_mode === "lazy"
      && path.resolve(memoryForwarding.manifest_path) === path.resolve(smokeForwarding.manifest_path),
    catalog_fingerprint: memoryReport.identity?.canonical_catalog_fingerprint
      === catalog.catalog_fingerprint,
    manifest_identity: memoryReport.identity?.manifest_hash === manifest.manifest_hash
      && memoryReport.identity?.root_binding_hash === manifest.root_binding_hash
      && memoryReport.identity?.catalog_binding_hash === manifest.catalog_binding_hash,
    runtime_loader_hash: memoryReport.identity?.runtime_loader_sha256_actual
      === runtimeLoaderSha256
      && memoryReport.identity?.runtime_loader_sha256_declared === runtimeLoaderSha256,
    max_old_space: memory.requested_max_old_space_mib === budgets.requested_max_old_space_mib,
    heap_size_limit: memory.heap_limit_mib < budgets.heap_size_limit_max_mib,
    heap_used: memory.heap_used_mib < budgets.heap_used_max_mib,
    rss: memory.rss_mib < budgets.rss_max_mib,
    peak_rss: memory.peak_rss_mib < budgets.peak_rss_max_mib,
    monolith_reads: io.monolith_reads <= budgets.monolith_reads_max,
    monolith_opens: io.monolith_opens <= budgets.monolith_opens_max,
    shard_counts: shards.manifest_shard_count === budgets.required_shard_count
      && shards.checked_shards === budgets.required_shard_count
      && shards.unchecked_shards === 0
      && shards.on_disk_shard_count === budgets.required_shard_count,
    generation_count: shards.on_disk_generation_count === budgets.required_generation_count,
    memory_response_sizes: memoryResponses.validation_bytes
      < budgets.validation_response_max_bytes
      && memoryResponses.route_bytes < budgets.route_response_max_bytes,
    http_contract: detailedHttpEvidence
      ? smokeReport.passed === true
      : smokeReport.ok === true
        && Array.isArray(smokeReport.checks)
        && smokeReport.checks.length > 0,
    core_authority: memoryReport.deep_route?.execution_authorized === false
      && memoryReport.deep_route?.core_final_authority === true,
    tenant_isolation: memoryReport.tenant_isolation?.passed === true,
    ...(detailedHttpEvidence ? {
      validation_response: httpResponses.deep_validation
        < budgets.validation_response_max_bytes,
      catalog_response: httpResponses.deep_catalog_summary
        < budgets.catalog_response_max_bytes,
      route_response: httpResponses.deep_interpretation
        < budgets.route_response_max_bytes,
      validation_burst: validationBurst.passed === true
        && validationBurst.requests === budgets.burst_requests_per_endpoint
        && validationBurst.concurrency >= budgets.burst_minimum_concurrency,
      catalog_burst: catalogBurst.passed === true
        && catalogBurst.requests === budgets.burst_requests_per_endpoint
        && catalogBurst.concurrency >= budgets.burst_minimum_concurrency,
    } : {}),
  };
  return {
    schema_version: "nyra_deep_branch_v2_runtime_evidence_v1",
    generated_at: new Date().toISOString(),
    provenance: {
      producer: "scripts/verify-nyra-deep-branch-v2.mjs",
      memory_harness: path.relative(repoRoot, memoryHarnessPath),
      http_harness: path.relative(repoRoot, smokeHarnessPath),
      measurement_phase: "candidate_runtime_artifact",
      http_measurement_mode: detailedHttpEvidence
        ? "bounded_payload_and_authenticated_burst"
        : "current_smoke_contract",
      harness_runtime_forwarding: {
        memory: memoryForwarding,
        http: smokeForwarding,
      },
      final_integrity_gate_required: true,
    },
    identity: {
      canonical_catalog_fingerprint: catalog.catalog_fingerprint,
      catalog_artifact_sha256: catalogArtifactSha256,
      runtime_loader_sha256: runtimeLoaderSha256,
      runtime_loader_hash_match: checks.runtime_loader_hash,
      manifest_hash: manifest.manifest_hash,
      root_binding_hash: manifest.root_binding_hash,
      catalog_binding_hash: manifest.catalog_binding_hash,
    },
    memory: memoryReport,
    http: smokeReport,
    summary: {
      requested_max_old_space_mib: memory.requested_max_old_space_mib,
      heap_limit_mib: memory.heap_limit_mib,
      heap_used_mib: memory.heap_used_mib,
      rss_mib: memory.rss_mib,
      peak_rss_mib: memory.peak_rss_mib,
      monolith_reads: io.monolith_reads,
      monolith_opens: io.monolith_opens,
      manifest_shard_count: shards.manifest_shard_count,
      checked_shards: shards.checked_shards,
      unchecked_shards: shards.unchecked_shards,
      on_disk_shard_count: shards.on_disk_shard_count,
      on_disk_generation_count: shards.on_disk_generation_count,
      validation_response_bytes: httpResponses.deep_validation ?? null,
      catalog_response_bytes: httpResponses.deep_catalog_summary ?? null,
      route_response_bytes: httpResponses.deep_interpretation ?? null,
      validation_burst_p50_ms: validationBurst.latency?.p50_ms ?? null,
      validation_burst_p95_ms: validationBurst.latency?.p95_ms ?? null,
      validation_burst_max_ms: validationBurst.latency?.max_ms ?? null,
      validation_burst_statuses: validationBurst.statuses ?? null,
      catalog_burst_p50_ms: catalogBurst.latency?.p50_ms ?? null,
      catalog_burst_p95_ms: catalogBurst.latency?.p95_ms ?? null,
      catalog_burst_max_ms: catalogBurst.latency?.max_ms ?? null,
      catalog_burst_statuses: catalogBurst.statuses ?? null,
    },
    budgets,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function assertFinalMemoryGate({ evidence, finalMemoryReport }) {
  const previous = evidence.memory;
  const current = finalMemoryReport;
  const previousPeak = Number(previous.process_memory?.peak_rss_mib || 0);
  const currentPeak = Number(current.process_memory?.peak_rss_mib || Infinity);
  const peakNoRegressionBudget = Math.max(previousPeak + 16, previousPeak * 1.25);
  const requiredShardCount = evidence.budgets.required_shard_count;
  const checks = {
    passed: current.passed === true,
    catalog_fingerprint: current.identity?.canonical_catalog_fingerprint
      === evidence.identity.canonical_catalog_fingerprint,
    runtime_artifact_identity: current.identity?.manifest_hash
      === evidence.identity.manifest_hash
      && current.identity?.root_binding_hash === evidence.identity.root_binding_hash
      && current.identity?.catalog_binding_hash === evidence.identity.catalog_binding_hash,
    runtime_loader_hash: current.identity?.runtime_loader_sha256_actual
      === evidence.identity.runtime_loader_sha256,
    monolith_reads: current.runtime_io?.monolith_reads === 0,
    monolith_opens: current.runtime_io?.monolith_opens === 0,
    shard_count: current.shard_integrity?.manifest_shard_count === requiredShardCount
      && current.shard_integrity?.checked_shards === requiredShardCount
      && current.shard_integrity?.unchecked_shards === 0
      && current.shard_integrity?.on_disk_shard_count === requiredShardCount,
    generation_count: current.shard_integrity?.on_disk_generation_count === 1,
    response_sizes: current.responses?.validation_bytes
      <= evidence.memory.responses.validation_bytes
      && current.responses?.route_bytes <= evidence.memory.responses.route_bytes,
    peak_rss_no_regression: currentPeak <= peakNoRegressionBudget
      && currentPeak < evidence.budgets.peak_rss_max_mib,
    heap_size_limit: current.process_memory?.heap_limit_mib
      < evidence.budgets.heap_size_limit_max_mib,
    heap_budget: current.process_memory?.heap_used_mib < evidence.budgets.heap_used_max_mib,
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`final_runtime_memory_gate_failed:${JSON.stringify({
      checks,
      previous: previous.process_memory,
      current: current.process_memory,
      previous_responses: previous.responses,
      current_responses: current.responses,
    })}`);
  }
  return {
    passed: true,
    checks,
    provisional: {
      heap_used_mib: previous.process_memory.heap_used_mib,
      rss_mib: previous.process_memory.rss_mib,
      peak_rss_mib: previousPeak,
      validation_bytes: previous.responses.validation_bytes,
      route_bytes: previous.responses.route_bytes,
    },
    final: {
      heap_used_mib: current.process_memory.heap_used_mib,
      rss_mib: current.process_memory.rss_mib,
      peak_rss_mib: currentPeak,
      validation_bytes: current.responses.validation_bytes,
      route_bytes: current.responses.route_bytes,
      manifest_hash: current.identity.manifest_hash,
      root_binding_hash: current.identity.root_binding_hash,
      catalog_binding_hash: current.identity.catalog_binding_hash,
    },
    peak_rss_no_regression_budget_mib: peakNoRegressionBudget,
  };
}

function resolveFixture(bundle, fixtureId, seen = new Set()) {
  const descriptor = bundle.fixtures[fixtureId];
  if (!descriptor) return null;
  if (seen.has(fixtureId)) throw new Error(`Fixture cycle: ${fixtureId}`);
  seen.add(fixtureId);
  const {
    base_fixture: baseFixture,
    evidence_tenant_override: evidenceTenantOverride,
    ...own
  } = descriptor;
  const resolved = baseFixture
    ? { ...structuredClone(resolveFixture(bundle, baseFixture, seen)), ...structuredClone(own) }
    : structuredClone(own);
  if (evidenceTenantOverride) {
    resolved.evidence = resolved.evidence.map((item) => ({ ...item, tenant_id: evidenceTenantOverride }));
  }
  return resolved;
}

function enabledEnv(branches) {
  return {
    NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_MODE: "shadow",
    NYRA_DEEP_BRANCH_V2_BRANCHES: branches.join(","),
    NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "codexai",
  };
}

function corePayload(branches) {
  return {
    tenant_id: "codexai",
    domain_pack: { id: "skinharmony" },
    result: {
      nyra_neural_network: {
        opened_by: "universal_core",
        opened_branches: branches.map((id) => ({ id, status: "opened" })),
        execution_authorized: false,
      },
    },
  };
}

function supervisorApprovedIds(supervisor) {
  if (Array.isArray(supervisor.approved_node_ids)) return new Set(supervisor.approved_node_ids);
  return new Set((supervisor.decisions || [])
    .filter((decision) => decision.decision === "APPROVED")
    .map((decision) => decision.node_id));
}

function v1EntitlementPackForBranch(branchId) {
  if (branchId === "suite_domain") return "suite";
  if (branchId === "smartdesk_domain") return "smartdesk";
  if (branchId === "analyzer_domain") return "analyzer";
  return "generic";
}

function authenticatedV1CatalogUnion(catalogGolden) {
  if (!catalogGolden) return null;
  const catalogs = ["generic", "suite", "smartdesk", "analyzer"].map((packId) => nyraBranchCatalog(packId));
  const branchById = new Map(catalogs.flatMap((catalog) => catalog.branches).map((branch) => [branch.id, branch]));
  return {
    ...catalogs[0],
    domain_pack_id: catalogGolden.input.domain_pack_id,
    branches: catalogGolden.output.branches.map((branch) => branchById.get(branch.id)),
  };
}

function main() {
  const {
    catalogPath,
    fixturePath,
    registryPath,
    supervisorPath,
    reportRoot,
    runtimeManifestPath,
    runtimeShardRoot,
  } = resolveCliPaths(process.argv.slice(2));
  fs.mkdirSync(reportRoot, { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const fixtureBundle = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const registryArtifact = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const supervisor = JSON.parse(fs.readFileSync(supervisorPath, "utf8"));
  const validationStarted = performance.now();
  const validation = validateCatalog(catalog);
  const validationMs = performance.now() - validationStarted;
  const errors = [...validation.errors];
  const expectedTopology = catalogTopology(catalog);
  if (!deepEqualJson(
    branchTopologyProjection(catalog.branches),
    CORE_SKINHARMONY_TOPOLOGY.projection
  )) {
    errors.push(
      `core_topology_mismatch:${expectedTopology.branch_count}/${expectedTopology.subbranch_count}`
      + `!=${CORE_SKINHARMONY_TOPOLOGY.branch_count}/${CORE_SKINHARMONY_TOPOLOGY.subbranch_count}`
    );
  }
  if (expectedTopology.subbranch_count !== REQUIRED_RUNTIME_SHARD_COUNT) {
    errors.push(
      `runtime_shard_topology_count:${expectedTopology.subbranch_count}`
      + `/${REQUIRED_RUNTIME_SHARD_COUNT}`
    );
  }
  if (fixtureBundle.catalog_fingerprint !== catalog.catalog_fingerprint) errors.push("fixture_catalog_fingerprint_mismatch");
  if (
    registryArtifact.registry_hash !== catalog.function_registry.registry_hash
    || !deepEqualJson(registryArtifact, catalog.function_registry)
  ) {
    errors.push("function_registry_artifact_mismatch");
  }
  if (fixtureBundle.fixture_count !== catalog.nodes.length * 4) errors.push("fixture_count_mismatch");
  const approvedIds = supervisorApprovedIds(supervisor);
  if (approvedIds.size !== catalog.nodes.length) errors.push(`supervisor_approval_count:${approvedIds.size}/${catalog.nodes.length}`);
  const nodeIndex = new Map(catalog.nodes.map((node) => [node.id, node]));
  const functionIndex = new Map(catalog.function_registry.functions.map((spec) => [spec.function_id, spec]));
  const fixtureResults = {
    positive: { executed: 0, passed: 0, failed: [] },
    negative: { executed: 0, passed: 0, failed: [] },
    adversarial: { executed: 0, passed: 0, failed: [] },
    regression: { executed: 0, passed: 0, failed: [] },
  };
  for (const node of catalog.nodes) {
    if (!approvedIds.has(node.id)) errors.push(`supervisor_node_not_approved:${node.id}`);
    for (const [field, kind] of [
      ["positive_tests", "positive"],
      ["negative_tests", "negative"],
      ["adversarial_tests", "adversarial"],
    ]) {
      const testCase = node[field]?.[0];
      const fixture = resolveFixture(fixtureBundle, testCase?.input_fixture);
      fixtureResults[kind].executed += 1;
      if (!fixture) {
        fixtureResults[kind].failed.push({ node_id: node.id, reason: "fixture_missing" });
        continue;
      }
      const parentEvaluations = new Map((fixture.verified_parent_ids || []).map((id) => [id, { state: "advisory_verified" }]));
      const result = evaluateNode({
        node,
        tenantId: fixture.tenant_id,
        subbranchId: fixture.subbranch_id,
        corePayload: fixture.core_payload,
        evidence: fixture.evidence,
        evidenceSource: fixture.evidence_source,
        capabilityInput: fixture.capability_input,
        functionSpec: functionIndex.get(node.id),
        functionRegistryHash: catalog.function_registry.registry_hash,
        parentEvaluations,
        requestId: testCase.id,
        observedAt: fixture.observed_at,
      });
      if (result.state === fixture.expected_state && result.execution_authorized === false) {
        fixtureResults[kind].passed += 1;
      } else {
        fixtureResults[kind].failed.push({
          node_id: node.id,
          expected_state: fixture.expected_state,
          actual_state: result.state,
        });
      }
    }
    const regressionCase = node.regression_tests?.[0];
    const regressionFixture = resolveFixture(fixtureBundle, regressionCase?.input_fixture);
    const refs = regressionFixture?.v1_golden_refs || {};
    const horizontalGolden = fixtureBundle.v1_goldens?.[refs.horizontal];
    const catalogGolden = fixtureBundle.v1_goldens?.[refs.catalog];
    const routeGolden = fixtureBundle.v1_goldens?.[refs.route];
    const actualHorizontal = horizontalGolden
      ? createNyraHorizontalRuntime({ NYRA_DEEP_BRANCH_V2_ENABLED: "false" }).prepareInterpretation(horizontalGolden.input)
      : null;
    const actualCatalog = authenticatedV1CatalogUnion(catalogGolden);
    const authenticatedRoute = routeGolden ? routeNyraBranches({
      ...routeGolden.input,
      domainPackId: v1EntitlementPackForBranch(refs.expected_branch_id),
    }) : null;
    const actualRoute = authenticatedRoute ? {
      ...authenticatedRoute,
      domain_pack_id: routeGolden.output.domain_pack_id,
    } : null;
    const openedBranch = actualRoute?.opened_branches?.find((branch) => branch.id === refs.expected_branch_id);
    fixtureResults.regression.executed += 1;
    if (
      regressionFixture
      && featureFlags(regressionFixture.feature_flags, regressionFixture.tenant_id).enabled === false
      && node.v1_compatibility?.fallback_to_v1 === true
      && node.rollback_reference?.kill_switch === "NYRA_DEEP_BRANCH_V2_ENABLED=false"
      && deepEqualJson(actualHorizontal, horizontalGolden?.output)
      && deepEqualJson(actualCatalog, catalogGolden?.output)
      && deepEqualJson(actualRoute, routeGolden?.output)
      && horizontalGolden?.output_hash === sha256(actualHorizontal)
      && catalogGolden?.output_hash === sha256(actualCatalog)
      && routeGolden?.output_hash === sha256(actualRoute)
      && openedBranch?.subbranches?.includes(refs.expected_subbranch_id)
      && actualRoute?.execution_authorized === false
      && !Object.hasOwn(actualHorizontal?.local_interpretation || {}, "deep_branch_v2")
    ) {
      fixtureResults.regression.passed += 1;
    } else {
      fixtureResults.regression.failed.push({ node_id: node.id, reason: "v1_regression_gate_failed" });
    }
  }
  for (const [kind, result] of Object.entries(fixtureResults)) {
    if (result.failed.length) errors.push(`${kind}_fixture_failures:${result.failed.length}`);
  }

  const branchIds = catalog.branches.map((branch) => branch.id);
  const env = enabledEnv(branchIds);
  const routeSamples = [];
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    const routed = route({
      tenantId: "codexai",
      domainPackId: "skinharmony",
      corePayload: corePayload(branchIds),
      requestedBranches: branchIds,
      env,
      catalogPath,
      runtimeMode: "legacy",
    });
    routeSamples.push(performance.now() - started);
    if (routed.selected_branches.length !== branchIds.length || routed.execution_authorized !== false) {
      errors.push(`deep_route_iteration_failed:${index}`);
    }
  }
  const firstBranch = catalog.branches[0];
  const firstSubbranch = firstBranch.subbranches[0].id;
  const lineage = catalog.nodes
    .filter((node) => node.branch_id === firstBranch.id && node.id.split(".")[1] === firstSubbranch)
    .sort((left, right) => left.level - right.level || left.id.localeCompare(right.id));
  const lineageEvidence = lineage.flatMap((node) => {
    const fixture = resolveFixture(fixtureBundle, node.positive_tests[0].input_fixture);
    return fixture.evidence;
  });
  const lineageNodeInputs = Object.fromEntries(lineage.map((node) => {
    const fixture = resolveFixture(fixtureBundle, node.positive_tests[0].input_fixture);
    return [node.id, fixture.capability_input];
  }));
  const lineageCorePayload = corePayload([firstBranch.id]);
  lineageCorePayload.result.evidence_manifests = Object.fromEntries(lineage.map((node) => {
    const fixture = resolveFixture(fixtureBundle, node.positive_tests[0].input_fixture);
    return [node.id, fixture.core_payload.result.evidence_manifest];
  }));
  lineageCorePayload.result.policy_decisions = lineage.flatMap((node) => {
    const fixture = resolveFixture(fixtureBundle, node.positive_tests[0].input_fixture);
    return fixture.core_payload.result.policy_decisions;
  });
  const evaluatedRoute = route({
    tenantId: "codexai",
    domainPackId: "skinharmony",
    corePayload: lineageCorePayload,
    requestedBranches: [firstBranch.id],
    evaluationContext: {
      subbranch_id: firstSubbranch,
      evidence: lineageEvidence,
      evidence_source: "verified_fixture",
      node_inputs: lineageNodeInputs,
      request_id: "benchmark_deep_lineage",
      observed_at: Date.parse(catalog.source_catalog.captured_at),
    },
    env: enabledEnv([firstBranch.id]),
    catalogPath,
    runtimeMode: "legacy",
  });
  if (
    evaluatedRoute.evaluations.length !== 6
    || evaluatedRoute.evaluations.some((evaluation) => evaluation.state !== "advisory_verified")
  ) {
    errors.push("deep_lineage_evaluation_failed");
  }

  const disabledRoute = route({
    tenantId: "codexai",
    domainPackId: "skinharmony",
    corePayload: corePayload([firstBranch.id]),
    requestedBranches: [firstBranch.id],
    env: { ...env, NYRA_DEEP_BRANCH_V2_ENABLED: "false" },
    catalogPath,
    runtimeMode: "legacy",
  });
  const rollbackVerified = disabledRoute.state === "disabled_v1_authoritative"
    && disabledRoute.fallback === "nyra_neural_branch_network_v1"
    && disabledRoute.execution_authorized === false;
  if (!rollbackVerified) errors.push("kill_switch_rollback_failed");

  const benchmark = {
    schema_version: "nyra_deep_branch_v2_benchmark_v1",
    generated_at: new Date().toISOString(),
    catalog_fingerprint: catalog.catalog_fingerprint,
    host: {
      platform: os.platform(),
      arch: os.arch(),
      node: process.version,
      cpu_count: os.cpus().length,
    },
    topology: validation.metrics,
    confidence_calibration: {
      formula: "0.50 evidence coverage + 0.20 authority compliance + 0.15 freshness compliance + 0.15 input validity",
      positive_fixture_expected_confidence: 1,
      abstain_below_contract_threshold: true,
      verified_node_count: fixtureResults.positive.passed,
    },
    catalog_validation_ms: Number(validationMs.toFixed(3)),
    route_100_iterations: {
      p50_ms: Number(percentile(routeSamples, 0.5).toFixed(3)),
      p95_ms: Number(percentile(routeSamples, 0.95).toFixed(3)),
      max_ms: Number(Math.max(...routeSamples).toFixed(3)),
      budget_p95_ms: 100,
      passed: percentile(routeSamples, 0.95) < 100,
    },
    deep_lineage: {
      branch_id: firstBranch.id,
      subbranch_id: firstSubbranch,
      evaluated_nodes: evaluatedRoute.evaluations.length,
      verified_nodes: evaluatedRoute.evaluations.filter((evaluation) => evaluation.state === "advisory_verified").length,
      execution_authorized: false,
    },
  };
  if (!benchmark.route_100_iterations.passed) errors.push("route_performance_budget_failed");

  const report = {
    schema_version: "nyra_deep_branch_v2_validation_report_v1",
    generated_at: new Date().toISOString(),
    ok: errors.length === 0,
    tenant_id: "codexai",
    catalog_fingerprint: catalog.catalog_fingerprint,
    input_artifacts: {
      catalog: {
        file_name: path.basename(catalogPath),
        byte_sha256: rawSha256(fs.readFileSync(catalogPath)),
      },
      fixtures: {
        file_name: path.basename(fixturePath),
        byte_sha256: rawSha256(fs.readFileSync(fixturePath)),
      },
      registry: {
        file_name: path.basename(registryPath),
        byte_sha256: rawSha256(fs.readFileSync(registryPath)),
      },
      supervisor: {
        file_name: path.basename(supervisorPath),
        byte_sha256: rawSha256(fs.readFileSync(supervisorPath)),
      },
    },
    source_catalog: catalog.source_catalog,
    validation,
    supervisor: {
      approved_node_count: approvedIds.size,
      rejected_node_count: (supervisor.rejected_node_ids || []).length,
      decision_count: (supervisor.decisions || []).length,
    },
    executable_contract_tests: fixtureResults,
    deep_routing: {
      selected_branch_count: evaluatedRoute.selected_branches.length,
      evaluated_node_count: evaluatedRoute.evaluations.length,
      all_verified: evaluatedRoute.evaluations.every((evaluation) => evaluation.state === "advisory_verified"),
      core_final_authority: evaluatedRoute.core_final_authority,
      execution_authorized: evaluatedRoute.execution_authorized,
    },
    rollback_verified: rollbackVerified,
    errors,
    release_gate: {
      deploy_authorized: false,
      merge_authorized: false,
      required_core_verdict: "ALLOW",
      explicit_owner_confirmation_required: true,
    },
  };
  const rollbackReport = {
    schema_version: "nyra_deep_branch_v2_rollback_verification_v1",
    generated_at: report.generated_at,
    ok: rollbackVerified,
    catalog_fingerprint: catalog.catalog_fingerprint,
    rollback_checkpoint: catalog.rollback_checkpoint,
    kill_switch: "NYRA_DEEP_BRANCH_V2_ENABLED=false",
    disabled_route_state: disabledRoute.state,
    fallback: disabledRoute.fallback,
    execution_authorized: disabledRoute.execution_authorized,
    verification_steps: [
      "Set NYRA_DEEP_BRANCH_V2_ENABLED=false.",
      "Confirm the V2 route reports disabled_v1_authoritative.",
      "Confirm fallback is nyra_neural_branch_network_v1.",
      "Confirm execution_authorized remains false.",
      "Re-enable only after Universal Core ALLOW and explicit owner confirmation.",
    ],
  };
  const validationReportPath = path.join(reportRoot, "validation_report.json");
  const benchmarkReportPath = path.join(reportRoot, "benchmark.json");
  const rollbackReportPath = path.join(reportRoot, "rollback-verification.json");
  const runtimeArtifactReportPath = path.join(reportRoot, "runtime_artifact_report.json");
  writeJson(validationReportPath, report);
  writeJson(benchmarkReportPath, benchmark);
  writeJson(rollbackReportPath, rollbackReport);
  const evidenceRoot = path.join(reportRoot, "harness-evidence");
  fs.rmSync(evidenceRoot, { recursive: true, force: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });
  let runtimeArtifacts = null;
  let runtimeEvidence = null;
  let finalRuntimeGate = null;
  let runtimeArtifactReport = null;
  let runtimeArtifactBudgets = null;
  let runtimeDeterminism = null;
  let runtimeLoaderVerification = null;
  if (report.ok) {
    try {
      runtimeArtifacts = buildRuntimeArtifacts({
        catalogPath,
        fixturePath,
        validationAttestationPath: validationReportPath,
        supervisorPath,
        runtimePath,
        manifestPath: runtimeManifestPath,
        shardRoot: runtimeShardRoot,
      });
      const primaryReconstruction = assertReconstructedCatalog({
        label: "primary",
        manifestPath: runtimeManifestPath,
        catalog,
        expectedTopology,
      });
      runtimeLoaderVerification = assertRuntimeLoaderModes({
        label: "primary",
        manifestPath: runtimeManifestPath,
        expectedManifest: runtimeArtifacts.manifest,
        expectedShardCount: REQUIRED_RUNTIME_SHARD_COUNT,
      });
      runtimeArtifactBudgets = assertRuntimeArtifactBudgets({
        manifestPath: runtimeManifestPath,
        shardRoot: runtimeShardRoot,
      });
      const memoryExecution = runEvidenceHarness({
        label: "runtime_memory_harness",
        args: [
          "--test",
          `--test-name-pattern=${MEMORY_HARNESS_TEST_NAME}`,
          memoryHarnessPath,
        ],
        reportPath: path.join(evidenceRoot, "memory-provisional.json"),
        reportEnv: "NYRA_DEEP_V2_MEMORY_REPORT_PATH",
        runtimeManifestPath,
      });
      const smokeExecution = runEvidenceHarness({
        label: "runtime_http_smoke_harness",
        args: [smokeHarnessPath],
        reportPath: path.join(evidenceRoot, "http-provisional.json"),
        reportEnv: "NYRA_DEEP_V2_SMOKE_REPORT_PATH",
        runtimeManifestPath,
        allowStdoutReport: true,
        timeoutMs: 180_000,
      });
      runtimeEvidence = buildRuntimeEvidence({
        catalog,
        catalogPath,
        manifest: runtimeArtifacts.manifest,
        memoryReport: memoryExecution.report,
        smokeReport: smokeExecution.report,
        memoryForwarding: memoryExecution.forwarding,
        smokeForwarding: smokeExecution.forwarding,
      });
      if (!runtimeEvidence.passed) {
        throw new Error(`runtime_evidence_gate_failed:${JSON.stringify(runtimeEvidence.checks)}`);
      }
      benchmark.runtime_evidence = runtimeEvidence;
      benchmark.passed = benchmark.route_100_iterations.passed && runtimeEvidence.passed;
      report.runtime_evidence = runtimeEvidence;
      report.ok = errors.length === 0 && runtimeEvidence.passed;
      report.errors = errors;
      writeJson(benchmarkReportPath, benchmark);
      writeJson(validationReportPath, report);

      const primarySnapshot = runtimeSetSnapshot({
        manifestPath: runtimeManifestPath,
        shardRoot: runtimeShardRoot,
      });
      const deterministicRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "nyra-v2-deterministic-build-")
      );
      try {
        const isolatedPaths = isolatedRuntimeBuildPaths({
          catalogPath,
          fixturePath,
          manifestPath: runtimeManifestPath,
          shardRoot: runtimeShardRoot,
          temporaryRoot: deterministicRoot,
        });
        const deterministicArtifacts = buildRuntimeArtifacts({
          catalogPath: isolatedPaths.catalogPath,
          fixturePath: isolatedPaths.fixturePath,
          validationAttestationPath: validationReportPath,
          supervisorPath,
          runtimePath,
          manifestPath: isolatedPaths.manifestPath,
          shardRoot: isolatedPaths.shardRoot,
        });
        const deterministicReconstruction = assertReconstructedCatalog({
          label: "deterministic_second_build",
          manifestPath: isolatedPaths.manifestPath,
          catalog,
          expectedTopology,
        });
        const deterministicLoaderVerification = assertRuntimeLoaderModes({
          label: "deterministic_second_build",
          manifestPath: isolatedPaths.manifestPath,
          expectedManifest: deterministicArtifacts.manifest,
          expectedShardCount: REQUIRED_RUNTIME_SHARD_COUNT,
        });
        const deterministicBudgets = assertRuntimeArtifactBudgets({
          manifestPath: isolatedPaths.manifestPath,
          shardRoot: isolatedPaths.shardRoot,
        });
        const deterministicSnapshot = runtimeSetSnapshot({
          manifestPath: isolatedPaths.manifestPath,
          shardRoot: isolatedPaths.shardRoot,
        });
        const primarySetHash = sha256(primarySnapshot);
        const deterministicSetHash = sha256(deterministicSnapshot);
        if (
          primarySetHash !== deterministicSetHash
          || !deepEqualJson(primarySnapshot, deterministicSnapshot)
        ) {
          throw new Error(`runtime_commit_set_drift:${JSON.stringify({
            primary_set_hash: primarySetHash,
            deterministic_set_hash: deterministicSetHash,
            primary_manifest_sha256: primarySnapshot.manifest.byte_sha256,
            deterministic_manifest_sha256:
              deterministicSnapshot.manifest.byte_sha256,
            primary_files: primarySnapshot.files.length,
            deterministic_files: deterministicSnapshot.files.length,
          })}`);
        }
        runtimeDeterminism = {
          passed: true,
          runtime_commit_set_no_drift: true,
          primary_set_sha256: primarySetHash,
          deterministic_second_build_set_sha256: deterministicSetHash,
          manifest_byte_identical: primarySnapshot.manifest.byte_sha256
            === deterministicSnapshot.manifest.byte_sha256,
          shard_file_count: primarySnapshot.files.length,
          directory_count: primarySnapshot.directories.length,
          primary_reconstruction: primaryReconstruction,
          deterministic_reconstruction: deterministicReconstruction,
          deterministic_loader_verification: deterministicLoaderVerification,
          deterministic_artifact_budgets: deterministicBudgets,
        };
      } finally {
        fs.rmSync(deterministicRoot, { recursive: true, force: true });
      }
      report.runtime_loader_verification = runtimeLoaderVerification;
      report.runtime_artifact_budgets = runtimeArtifactBudgets;
      report.runtime_determinism = runtimeDeterminism;
      benchmark.runtime_determinism = runtimeDeterminism;
      writeJson(validationReportPath, report);
      writeJson(benchmarkReportPath, benchmark);

      const finalMemoryExecution = runEvidenceHarness({
        label: "final_runtime_memory_integrity_harness",
        args: [
          "--test",
          `--test-name-pattern=${MEMORY_HARNESS_TEST_NAME}`,
          memoryHarnessPath,
        ],
        reportPath: path.join(evidenceRoot, "memory-final.json"),
        reportEnv: "NYRA_DEEP_V2_MEMORY_REPORT_PATH",
        runtimeManifestPath,
      });
      finalRuntimeGate = assertFinalMemoryGate({
        evidence: runtimeEvidence,
        finalMemoryReport: finalMemoryExecution.report,
      });
      const finalValidationBindingHash = validationAttestationHash(report, catalog);
      if (
        runtimeArtifacts.shard_count !== expectedTopology.subbranch_count
        || runtimeArtifacts.cleanup?.retained_generation_count !== 1
        || runtimeArtifacts.cleanup?.shard_file_count !== expectedTopology.subbranch_count
        || runtimeArtifacts.manifest?.validation_attestation?.sha256
          !== finalValidationBindingHash
        || runtimeArtifactBudgets?.passed !== true
        || runtimeDeterminism?.passed !== true
        || runtimeLoaderVerification?.full_verify_artifacts?.passed !== true
      ) {
        throw new Error(`final_runtime_artifact_count_invalid:${JSON.stringify({
          shard_count: runtimeArtifacts.shard_count,
          cleanup: runtimeArtifacts.cleanup,
          manifest_validation_attestation_sha256:
            runtimeArtifacts.manifest?.validation_attestation?.sha256,
          final_validation_binding_sha256: finalValidationBindingHash,
          runtime_artifact_budgets_passed: runtimeArtifactBudgets?.passed,
          runtime_determinism_passed: runtimeDeterminism?.passed,
          runtime_loader_full_verification_passed:
            runtimeLoaderVerification?.full_verify_artifacts?.passed,
        })}`);
      }
      const runtimeArtifact = {
        schema_version: "nyra_deep_branch_v2_runtime_artifact_reference_v1",
        relative_path: path.relative(reportRoot, runtimeArtifactReportPath),
        manifest_hash: runtimeArtifacts.manifest.manifest_hash,
        root_binding_hash: runtimeArtifacts.manifest.root_binding_hash,
        catalog_binding_hash: runtimeArtifacts.manifest.catalog_binding_hash,
        validation_attestation_sha256: finalValidationBindingHash,
        shard_count: runtimeArtifacts.shard_count,
        retained_generation: runtimeArtifacts.cleanup?.retained_generation || null,
        runtime_set_sha256: runtimeDeterminism.primary_set_sha256,
        deterministic_second_build: runtimeDeterminism.passed === true,
        artifact_budgets_passed: runtimeArtifactBudgets.passed === true,
        final_runtime_gate_passed: finalRuntimeGate.passed === true,
      };
      report.runtime_artifact = runtimeArtifact;
      report.final_runtime_gate = finalRuntimeGate;
      benchmark.runtime_artifact = runtimeArtifact;
      writeJson(validationReportPath, report);
      writeJson(benchmarkReportPath, benchmark);
      const persistedReport = JSON.parse(fs.readFileSync(validationReportPath, "utf8"));
      if (validationAttestationHash(persistedReport, catalog) !== finalValidationBindingHash) {
        throw new Error("final_runtime_validation_binding_drift");
      }
      runtimeArtifactReport = {
        schema_version: "nyra_deep_branch_v2_runtime_artifact_report_v1",
        generated_at: new Date().toISOString(),
        catalog_fingerprint: catalog.catalog_fingerprint,
        validation_report: {
          relative_path: path.relative(reportRoot, validationReportPath),
          byte_sha256: rawSha256(fs.readFileSync(validationReportPath)),
          binding_sha256: finalValidationBindingHash,
        },
        benchmark_report: {
          relative_path: path.relative(reportRoot, benchmarkReportPath),
          byte_sha256: rawSha256(fs.readFileSync(benchmarkReportPath)),
        },
        runtime_artifact: runtimeArtifact,
        runtime_evidence: {
          passed: runtimeEvidence.passed === true,
          identity: runtimeEvidence.identity,
          summary: runtimeEvidence.summary,
          checks: runtimeEvidence.checks,
        },
        runtime_loader_verification: runtimeLoaderVerification,
        runtime_artifact_budgets: runtimeArtifactBudgets,
        runtime_determinism: runtimeDeterminism,
        final_runtime_gate: finalRuntimeGate,
      };
      writeJson(runtimeArtifactReportPath, runtimeArtifactReport);
    } catch (error) {
      errors.push(`runtime_artifact_verification_failed:${error.message}`);
      report.ok = false;
      report.errors = errors;
      if (runtimeEvidence) {
        report.runtime_evidence = runtimeEvidence;
        benchmark.runtime_evidence = runtimeEvidence;
        benchmark.passed = false;
      }
      writeJson(validationReportPath, report);
      writeJson(benchmarkReportPath, benchmark);
    }
  }
  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    errors,
    validation: validation.metrics,
    executable_cases: Object.values(fixtureResults).reduce((sum, result) => sum + result.executed, 0),
    benchmark: benchmark.route_100_iterations,
    rollback_verified: rollbackVerified,
    runtime_manifest_hash: runtimeArtifacts?.manifest?.manifest_hash || null,
    runtime_root_binding_hash: runtimeArtifacts?.manifest?.root_binding_hash || null,
    runtime_shard_count: runtimeArtifacts?.shard_count || 0,
    runtime_shard_cleanup: runtimeArtifacts?.cleanup || null,
    runtime_artifact_budgets: runtimeArtifactBudgets,
    runtime_determinism: runtimeDeterminism,
    runtime_loader_verification: runtimeLoaderVerification,
    runtime_evidence: runtimeEvidence ? {
      passed: runtimeEvidence.passed,
      summary: runtimeEvidence.summary,
      checks: runtimeEvidence.checks,
    } : null,
    final_runtime_gate: finalRuntimeGate,
    runtime_artifact_report: runtimeArtifactReport ? {
      relative_path: path.relative(repoRoot, runtimeArtifactReportPath),
      manifest_hash: runtimeArtifactReport.runtime_artifact.manifest_hash,
      root_binding_hash: runtimeArtifactReport.runtime_artifact.root_binding_hash,
    } : null,
  }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main();
