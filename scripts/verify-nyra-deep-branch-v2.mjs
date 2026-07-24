#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { nyraBranchCatalog, routeNyraBranches } from "../services/universal-core-service/src/nyraBranchNetwork.js";
import {
  buildRuntimeArtifacts,
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

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const catalogPath = path.join(repoRoot, "personal-control-center/data/nyra-deep-branch-v2.catalog.json");
const fixturePath = path.join(repoRoot, "personal-control-center/data/nyra-deep-branch-v2.fixtures.json");
const registryPath = path.join(repoRoot, "architecture/nyra-deep-branch-v2-function-registry.json");
const supervisorPath = path.join(repoRoot, "reports/nyra-deep-v2/supervisor_decisions.json");
const reportRoot = path.join(repoRoot, "reports/nyra-deep-v2");
const runtimePath = path.join(repoRoot, "personal-control-center/lib/nyra-deep-branch-v2.js");
const runtimeManifestPath = path.join(
  repoRoot,
  "personal-control-center/data/nyra-deep-branch-v2.runtime-manifest.json"
);
const runtimeShardRoot = path.join(
  repoRoot,
  "personal-control-center/data/nyra-deep-branch-v2.shards"
);
const memoryHarnessPath = path.join(
  repoRoot,
  "personal-control-center/test/nyra-deep-branch-v2-memory.test.js"
);
const smokeHarnessPath = path.join(
  repoRoot,
  "personal-control-center/test/nyra-runtime-smoke.js"
);

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

function runEvidenceHarness({
  label,
  args,
  reportPath,
  reportEnv,
  timeoutMs = 120_000,
} = {}) {
  fs.rmSync(reportPath, { force: true });
  const execution = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      [reportEnv]: reportPath,
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs,
  });
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
  if (!fs.existsSync(reportPath)) throw new Error(`${label}_report_missing`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.passed !== true && report.ok !== true) {
    throw new Error(`${label}_report_not_passed:${JSON.stringify(report).slice(0, 4000)}`);
  }
  return {
    report,
    stdout: execution.stdout,
    stderr: execution.stderr,
  };
}

function buildRuntimeEvidence({ catalog, memoryReport, smokeReport }) {
  const runtimeLoaderSha256 = rawSha256(fs.readFileSync(runtimePath));
  const catalogArtifactSha256 = rawSha256(fs.readFileSync(catalogPath));
  const memory = memoryReport.process_memory || {};
  const io = memoryReport.runtime_io || {};
  const shards = memoryReport.shard_integrity || {};
  const memoryResponses = memoryReport.responses || {};
  const httpResponses = smokeReport.bounded_payload_bytes || {};
  const validationBurst = smokeReport.authenticated_bursts?.validation || {};
  const catalogBurst = smokeReport.authenticated_bursts?.catalog || {};
  const budgets = {
    requested_max_old_space_mib: 256,
    heap_size_limit_max_mib: 384,
    heap_used_max_mib: 256,
    rss_max_mib: 256,
    peak_rss_max_mib: 256,
    monolith_reads_max: 0,
    monolith_opens_max: 0,
    required_shard_count: 239,
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
    http_harness_passed: smokeReport.passed === true,
    catalog_fingerprint: memoryReport.identity?.canonical_catalog_fingerprint
      === catalog.catalog_fingerprint,
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
    validation_response: httpResponses.deep_validation < budgets.validation_response_max_bytes
      && memoryResponses.validation_bytes < budgets.validation_response_max_bytes,
    catalog_response: httpResponses.deep_catalog_summary < budgets.catalog_response_max_bytes,
    route_response: httpResponses.deep_interpretation < budgets.route_response_max_bytes
      && memoryResponses.route_bytes < budgets.route_response_max_bytes,
    validation_burst: validationBurst.passed === true
      && validationBurst.requests === budgets.burst_requests_per_endpoint
      && validationBurst.concurrency >= budgets.burst_minimum_concurrency,
    catalog_burst: catalogBurst.passed === true
      && catalogBurst.requests === budgets.burst_requests_per_endpoint
      && catalogBurst.concurrency >= budgets.burst_minimum_concurrency,
    core_authority: memoryReport.deep_route?.execution_authorized === false
      && memoryReport.deep_route?.core_final_authority === true,
    tenant_isolation: memoryReport.tenant_isolation?.passed === true,
  };
  return {
    schema_version: "nyra_deep_branch_v2_runtime_evidence_v1",
    generated_at: new Date().toISOString(),
    provenance: {
      producer: "scripts/verify-nyra-deep-branch-v2.mjs",
      memory_harness: path.relative(repoRoot, memoryHarnessPath),
      http_harness: path.relative(repoRoot, smokeHarnessPath),
      measurement_phase: "candidate_runtime_artifact",
      final_integrity_gate_required: true,
    },
    identity: {
      canonical_catalog_fingerprint: catalog.catalog_fingerprint,
      catalog_artifact_sha256: catalogArtifactSha256,
      runtime_loader_sha256: runtimeLoaderSha256,
      runtime_loader_hash_match: checks.runtime_loader_hash,
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
      validation_response_bytes: httpResponses.deep_validation,
      catalog_response_bytes: httpResponses.deep_catalog_summary,
      route_response_bytes: httpResponses.deep_interpretation,
      validation_burst_p50_ms: validationBurst.latency?.p50_ms,
      validation_burst_p95_ms: validationBurst.latency?.p95_ms,
      validation_burst_max_ms: validationBurst.latency?.max_ms,
      validation_burst_statuses: validationBurst.statuses,
      catalog_burst_p50_ms: catalogBurst.latency?.p50_ms,
      catalog_burst_p95_ms: catalogBurst.latency?.p95_ms,
      catalog_burst_max_ms: catalogBurst.latency?.max_ms,
      catalog_burst_statuses: catalogBurst.statuses,
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
  const checks = {
    passed: current.passed === true,
    catalog_fingerprint: current.identity?.canonical_catalog_fingerprint
      === evidence.identity.canonical_catalog_fingerprint,
    runtime_loader_hash: current.identity?.runtime_loader_sha256_actual
      === evidence.identity.runtime_loader_sha256,
    monolith_reads: current.runtime_io?.monolith_reads === 0,
    monolith_opens: current.runtime_io?.monolith_opens === 0,
    shard_count: current.shard_integrity?.manifest_shard_count === 239
      && current.shard_integrity?.checked_shards === 239
      && current.shard_integrity?.unchecked_shards === 0
      && current.shard_integrity?.on_disk_shard_count === 239,
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

function main() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const fixtureBundle = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const registryArtifact = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const supervisor = JSON.parse(fs.readFileSync(supervisorPath, "utf8"));
  const validationStarted = performance.now();
  const validation = validateCatalog(catalog);
  const validationMs = performance.now() - validationStarted;
  const errors = [...validation.errors];
  if (fixtureBundle.catalog_fingerprint !== catalog.catalog_fingerprint) errors.push("fixture_catalog_fingerprint_mismatch");
  if (registryArtifact.registry_hash !== catalog.function_registry.registry_hash) {
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
    const actualCatalog = catalogGolden ? nyraBranchCatalog(catalogGolden.input.domain_pack_id) : null;
    const actualRoute = routeGolden ? routeNyraBranches(routeGolden.input) : null;
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
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-runtime-evidence-"));
  let runtimeArtifacts = null;
  let runtimeEvidence = null;
  let finalRuntimeGate = null;
  let runtimeArtifactReport = null;
  if (report.ok) {
    try {
      const provisionalArtifacts = buildRuntimeArtifacts({
        catalogPath,
        validationAttestationPath: validationReportPath,
        supervisorPath,
        runtimePath,
        manifestPath: runtimeManifestPath,
        shardRoot: runtimeShardRoot,
      });
      const provisionalReconstructed = reconstructCatalogFromRuntimeArtifacts({
        manifestPath: runtimeManifestPath,
      });
      const provisionalValidation = validateCatalog(provisionalReconstructed);
      if (
        provisionalReconstructed.catalog_fingerprint !== catalog.catalog_fingerprint
        || JSON.stringify(provisionalReconstructed) !== JSON.stringify(catalog)
        || !provisionalValidation.ok
        || provisionalValidation.metrics.node_count !== 1434
      ) {
        throw new Error(
          `provisional_runtime_shard_reconstruction_invalid:${provisionalValidation.errors.join(",")}`
        );
      }
      const memoryExecution = runEvidenceHarness({
        label: "runtime_memory_harness",
        args: ["--test", memoryHarnessPath],
        reportPath: path.join(evidenceRoot, "memory-provisional.json"),
        reportEnv: "NYRA_DEEP_V2_MEMORY_REPORT_PATH",
      });
      const smokeExecution = runEvidenceHarness({
        label: "runtime_http_smoke_harness",
        args: [smokeHarnessPath],
        reportPath: path.join(evidenceRoot, "http-provisional.json"),
        reportEnv: "NYRA_DEEP_V2_SMOKE_REPORT_PATH",
      });
      runtimeEvidence = buildRuntimeEvidence({
        catalog,
        memoryReport: memoryExecution.report,
        smokeReport: smokeExecution.report,
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

      runtimeArtifacts = buildRuntimeArtifacts({
        catalogPath,
        validationAttestationPath: validationReportPath,
        supervisorPath,
        runtimePath,
        manifestPath: runtimeManifestPath,
        shardRoot: runtimeShardRoot,
      });
      const finalReconstructed = reconstructCatalogFromRuntimeArtifacts({
        manifestPath: runtimeManifestPath,
      });
      const finalReconstructedValidation = validateCatalog(finalReconstructed);
      if (
        finalReconstructed.catalog_fingerprint !== catalog.catalog_fingerprint
        || JSON.stringify(finalReconstructed) !== JSON.stringify(catalog)
        || !finalReconstructedValidation.ok
        || finalReconstructedValidation.metrics.node_count !== 1434
      ) {
        throw new Error(
          `final_runtime_shard_reconstruction_invalid:${finalReconstructedValidation.errors.join(",")}`
        );
      }
      const finalMemoryExecution = runEvidenceHarness({
        label: "final_runtime_memory_integrity_harness",
        args: ["--test", memoryHarnessPath],
        reportPath: path.join(evidenceRoot, "memory-final.json"),
        reportEnv: "NYRA_DEEP_V2_MEMORY_REPORT_PATH",
      });
      finalRuntimeGate = assertFinalMemoryGate({
        evidence: runtimeEvidence,
        finalMemoryReport: finalMemoryExecution.report,
      });
      const finalValidationBindingHash = validationAttestationHash(report, catalog);
      if (
        runtimeArtifacts.shard_count !== 239
        || runtimeArtifacts.cleanup?.retained_generation_count !== 1
        || runtimeArtifacts.cleanup?.shard_file_count !== 239
        || runtimeArtifacts.manifest?.validation_attestation?.sha256
          !== finalValidationBindingHash
      ) {
        throw new Error(`final_runtime_artifact_count_invalid:${JSON.stringify({
          shard_count: runtimeArtifacts.shard_count,
          cleanup: runtimeArtifacts.cleanup,
          manifest_validation_attestation_sha256:
            runtimeArtifacts.manifest?.validation_attestation?.sha256,
          final_validation_binding_sha256: finalValidationBindingHash,
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
        final_runtime_gate: finalRuntimeGate,
      };
      writeJson(runtimeArtifactReportPath, runtimeArtifactReport);
      void provisionalArtifacts;
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
  fs.rmSync(evidenceRoot, { recursive: true, force: true });
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
