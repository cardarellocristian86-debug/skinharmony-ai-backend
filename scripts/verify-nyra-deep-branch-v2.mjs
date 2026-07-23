#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { nyraBranchCatalog, routeNyraBranches } from "../services/universal-core-service/src/nyraBranchNetwork.js";

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

function deepEqualJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
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
  writeJson(path.join(reportRoot, "validation_report.json"), report);
  writeJson(path.join(reportRoot, "benchmark.json"), benchmark);
  writeJson(path.join(reportRoot, "rollback-verification.json"), rollbackReport);
  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    errors,
    validation: validation.metrics,
    executable_cases: Object.values(fixtureResults).reduce((sum, result) => sum + result.executed, 0),
    benchmark: benchmark.route_100_iterations,
    rollback_verified: rollbackVerified,
  }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main();
