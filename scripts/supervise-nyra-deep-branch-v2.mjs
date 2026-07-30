#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  nyraBranchCatalog,
  routeNyraBranches,
} from "../services/universal-core-service/src/nyraBranchNetwork.js";

const require = createRequire(import.meta.url);
const runtime = require("../personal-control-center/lib/nyra-deep-branch-v2.js");
const { createNyraHorizontalRuntime } = require(
  "../personal-control-center/lib/nyra-horizontal-runtime.js"
);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const generatorPath = path.join(repoRoot, "scripts/generate-nyra-deep-branch-v2.mjs");
const runtimePath = path.join(
  repoRoot,
  "personal-control-center/lib/nyra-deep-branch-v2.js"
);
const researchPath = path.join(repoRoot, "research/NYRA_DEEP_BRANCH_V2_RESEARCH.md");

const EXPECTED = Object.freeze({
  branches: 21,
  subbranches: 299,
  nodes: 1794,
  fixtures: 7176,
  nodesPerSubbranch: 6,
  fixturesPerNode: 4,
  tenant: "codexai",
  schemaVersion: "nyra_deep_branch_architecture_v2",
  fixtureSchemaVersion: "nyra_deep_branch_v2_executable_fixtures_v1",
  level4Types: Object.freeze(["method", "strategy", "verifier", "metric"]),
});

const V1_SOURCE_PIN = Object.freeze({
  repository_commit: "b8cf5d4cf6cdaaec979f5c5d4e0d9c48119d8b54",
  horizontal_runtime_pre_v2_sha256:
    "eea4aef34164f3681433aca0b338c93ed8276d719a18e379d124bc0b60b2a6d3",
  core_branch_network_sha256:
    "25bd1cc03fb77dbf265b7802929c129edf14ca6b35dddee43ba2f6dcef7aa106",
});
const V1_COMPATIBLE_IMPLEMENTATION_PIN = Object.freeze({
  repository_commit: "1a5c6ca6f7d6a3a0a578aea701b9e687a97b3760",
  horizontal_runtime_sha256:
    "267fead17d3b288ed7cc647fa45112200582fbd71bf1bf75c13c464972cbefe7",
  core_branch_network_sha256:
    "28018fa5a628bff2732ef82b579a9b2411365de8645e90bee01916141495de0d",
});
const V2_EXCLUDED_BRANCH_IDS = new Set(["tenant_work_coordination"]);

const FIXTURE_FAMILIES = Object.freeze([
  ["positive_tests", "positive", "ALLOW_ADVISORY"],
  ["negative_tests", "negative", "ABSTAIN"],
  ["adversarial_tests", "adversarial", "DENY"],
  ["regression_tests", "regression", "ALLOW_ADVISORY"],
]);

const REQUIRED_AUDIT_FIELDS = Object.freeze([
  "tenant_id",
  "request_id",
  "node_id",
  "contract_version",
  "core_verdict",
  "timestamp",
]);

const REQUIRED_PROVENANCE_FIELDS = Object.freeze([
  "contract_hash",
  "source_refs",
  "evidence_hashes",
  "route_trace",
  "policy_snapshot_hash",
]);

const FORBIDDEN_PLACEHOLDER = /\b(?:todo|tbd|placeholder|lorem ipsum|fixme|generic purpose)\b/i;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`invalid_argument:${key || "end"}`);
    }
    if (Object.hasOwn(args, key.slice(2))) {
      throw new Error(`duplicate_argument:${key.slice(2)}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function requiredArg(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) throw new Error(`missing_argument:${key}`);
  return value;
}

function optionalSha256(args, key) {
  const value = String(args[key] || "").trim().toLowerCase();
  if (!value) return null;
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`invalid_sha256_argument:${key}`);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function byteHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function catalogFingerprint(catalog) {
  return canonicalHash(
    Object.fromEntries(
      Object.entries(catalog || {}).filter(([key]) => key !== "catalog_fingerprint")
    )
  );
}

function deepEqualJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readJsonBytes(filePath, label) {
  const bytes = fs.readFileSync(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label}_json_invalid`);
  }
  return {
    bytes,
    byte_sha256: byteHash(bytes),
    value,
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function safeArtifactName(filePath, fallback) {
  const name = path.basename(String(filePath || ""));
  return name && name !== "." && name !== path.sep ? name : fallback;
}

function sanitizedError(error) {
  const message = String(error?.message || error || "unknown_error");
  return message
    .replaceAll(repoRoot, "<repo>")
    .replace(/\/(?:private|tmp|home|Users)\/[^\s:"']+/g, "<path>")
    .slice(0, 512);
}

function absolutePathLocations(value, pointer = "$", found = []) {
  if (typeof value === "string") {
    if (path.isAbsolute(value)) found.push(pointer);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => absolutePathLocations(item, `${pointer}/${index}`, found));
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      absolutePathLocations(item, `${pointer}/${key}`, found);
    }
  }
  return found;
}

function branchTopologyProjection(branches) {
  return (Array.isArray(branches) ? branches : []).map((branch) => ({
    id: branch?.id,
    subbranches: (Array.isArray(branch?.subbranches) ? branch.subbranches : []).map(
      (subbranch) => (typeof subbranch === "string" ? subbranch : subbranch?.id)
    ),
  }));
}

function topologyCounts(catalog) {
  const branches = Array.isArray(catalog?.branches) ? catalog.branches : [];
  const nodes = Array.isArray(catalog?.nodes) ? catalog.nodes : [];
  return {
    branch_count: branches.length,
    subbranch_count: branches.reduce(
      (sum, branch) => sum + (Array.isArray(branch?.subbranches) ? branch.subbranches.length : 0),
      0
    ),
    node_count: nodes.length,
    fixture_count: nodes.length * EXPECTED.fixturesPerNode,
    level_counts: {
      2: nodes.filter((node) => node?.level === 2).length,
      3: nodes.filter((node) => node?.level === 3).length,
      4: nodes.filter((node) => node?.level === 4).length,
    },
    level4_type_counts: Object.fromEntries(
      EXPECTED.level4Types.map((type) => [
        type,
        nodes.filter((node) => node?.level === 4 && node?.node_type === type).length,
      ])
    ),
  };
}

function indexTopology(catalog) {
  const nodes = Array.isArray(catalog?.nodes) ? catalog.nodes : [];
  const nodeIndex = new Map();
  const children = new Map();
  for (const node of nodes) {
    if (node?.id && !nodeIndex.has(node.id)) nodeIndex.set(node.id, node);
    const list = children.get(node?.parent_id) || [];
    list.push(node);
    children.set(node?.parent_id, list);
  }

  const nodeChecks = new Map();
  let allLineagesExact = true;
  for (const branch of Array.isArray(catalog?.branches) ? catalog.branches : []) {
    for (const subbranch of Array.isArray(branch?.subbranches) ? branch.subbranches : []) {
      const qualifiedSubbranch = `${branch.id}.${subbranch.id}`;
      const l2 = children.get(qualifiedSubbranch) || [];
      const l3 = l2.length === 1 ? children.get(l2[0].id) || [] : [];
      const l4 = l3.length === 1 ? children.get(l3[0].id) || [] : [];
      const exact =
        subbranch.parent_id === branch.id
        && subbranch.branch_id === branch.id
        && subbranch.level === 1
        && subbranch.node_type === "subbranch"
        && Array.isArray(subbranch.children)
        && subbranch.children.length === 1
        && l2.length === 1
        && l2[0].id === subbranch.children[0]
        && l2[0].level === 2
        && l2[0].parent_id === qualifiedSubbranch
        && l2[0].branch_id === branch.id
        && l3.length === 1
        && l3[0].level === 3
        && l3[0].parent_id === l2[0].id
        && l3[0].branch_id === branch.id
        && l4.length === EXPECTED.level4Types.length
        && deepEqualJson(
          l4.map((node) => node.node_type).sort(),
          [...EXPECTED.level4Types].sort()
        )
        && l4.every(
          (node) => node.level === 4
            && node.parent_id === l3[0].id
            && node.branch_id === branch.id
            && (children.get(node.id) || []).length === 0
        );
      allLineagesExact &&= exact;
      for (const node of [...l2, ...l3, ...l4]) nodeChecks.set(node.id, exact);
    }
  }

  return {
    nodeIndex,
    children,
    nodeChecks,
    all_lineages_exact: allLineagesExact
      && nodeChecks.size === EXPECTED.nodes
      && nodes.every((node) => nodeChecks.get(node.id) === true),
  };
}

function transientRuntimeValidation(candidate) {
  const originalFingerprint = candidate.catalog_fingerprint;
  const originalStatuses = candidate.nodes.map((node) => node.supervisor_status);
  try {
    candidate.nodes.forEach((node) => {
      node.supervisor_status = "APPROVED";
    });
    candidate.catalog_fingerprint = catalogFingerprint(candidate);
    const runtimeFingerprintMatch =
      runtime.catalogFingerprint(candidate) === candidate.catalog_fingerprint;
    const validation = runtime.validateCatalog(candidate);
    return {
      ...validation,
      runtime_fingerprint_match: runtimeFingerprintMatch,
    };
  } finally {
    candidate.nodes.forEach((node, index) => {
      node.supervisor_status = originalStatuses[index];
    });
    candidate.catalog_fingerprint = originalFingerprint;
  }
}

function functionRegistryAudit(candidate) {
  const registry = candidate.function_registry;
  const functions = Array.isArray(registry?.functions) ? registry.functions : [];
  const functionIndex = new Map(functions.map((spec) => [spec?.function_id, spec]));
  const nodeIds = new Set(candidate.nodes.map((node) => node.id));
  const registryPayload = {
    schema_version: registry?.schema_version,
    research_sha256: registry?.research_sha256,
    source_snapshot_sha256: registry?.source_snapshot_sha256,
    functions,
  };
  const registryHashMatch =
    /^[a-f0-9]{64}$/.test(String(registry?.registry_hash || ""))
    && registry.registry_hash === canonicalHash(registryPayload);
  const semanticHashes = new Set();
  const semanticProfiles = new Set();
  const perNode = new Map();

  for (const node of candidate.nodes) {
    const spec = functionIndex.get(node.id);
    const semanticContent = spec
      ? {
          source_row_hash: spec.source_row_hash,
          semantic_source: spec.semantic_source,
          semantic_assertions: spec.semantic_assertions,
          execution_plan: spec.execution_plan,
        }
      : null;
    const semanticHash = semanticContent ? canonicalHash(semanticContent) : null;
    const executionPlanHash = spec ? canonicalHash(spec.execution_plan) : null;
    const observationContractHash = spec ? canonicalHash(spec.semantic_assertions) : null;
    const profile = spec
      ? canonicalHash({
          semantic_source: spec.semantic_source,
          semantic_assertions: spec.semantic_assertions,
          execution_plan: spec.execution_plan,
        })
      : null;
    const binding = node.function_binding;
    const valid =
      Boolean(spec)
      && spec.function_id === node.id
      && semanticHash === spec.semantic_function_hash
      && executionPlanHash === spec.execution_plan_hash
      && observationContractHash === spec.observation_contract_hash
      && binding?.registry_hash === registry?.registry_hash
      && binding?.source_row_hash === spec.source_row_hash
      && binding?.semantic_function_hash === spec.semantic_function_hash
      && binding?.execution_plan_hash === spec.execution_plan_hash
      && binding?.observation_contract_hash === spec.observation_contract_hash
      && node.methods?.[0]?.program?.semantic_function_hash === spec.semantic_function_hash
      && node.methods?.[0]?.program?.execution_plan_hash === spec.execution_plan_hash
      && node.methods?.[0]?.program?.record_claim_hash === spec.observation_contract_hash
      && node.semantic_contract?.semantic_function_hash === spec.semantic_function_hash
      && node.semantic_contract?.execution_plan_hash === spec.execution_plan_hash
      && node.semantic_contract?.record_claim_hash === spec.observation_contract_hash;
    perNode.set(node.id, {
      valid,
      semantic_hash: semanticHash,
      semantic_profile: profile,
    });
    if (semanticHash) semanticHashes.add(semanticHash);
    if (profile) semanticProfiles.add(profile);
  }

  return {
    functionIndex,
    perNode,
    registry_hash_match: registryHashMatch,
    registry_ids_exact:
      functions.length === EXPECTED.nodes
      && functionIndex.size === EXPECTED.nodes
      && functionIndex.size === nodeIds.size
      && [...functionIndex.keys()].every((id) => nodeIds.has(id)),
    semantic_functions_unique: semanticHashes.size === EXPECTED.nodes,
    semantic_profiles_unique: semanticProfiles.size === EXPECTED.nodes,
  };
}

function fixtureReferences(candidate, bundle) {
  const perNode = new Map();
  const referencedIds = [];
  for (const node of candidate.nodes) {
    const family = {};
    let exact = true;
    for (const [field, kind, expectedVerdict] of FIXTURE_FAMILIES) {
      const cases = node[field];
      const testCase = Array.isArray(cases) && cases.length === 1 ? cases[0] : null;
      const fixtureId = testCase?.input_fixture;
      const descriptor = fixtureId ? bundle.fixtures?.[fixtureId] : null;
      const valid =
        Boolean(testCase)
        && typeof fixtureId === "string"
        && fixtureId.startsWith("catalog-fixture/")
        && testCase.expected_core_verdict === expectedVerdict
        && Array.isArray(testCase.assertions)
        && testCase.assertions.length >= 3
        && Boolean(descriptor)
        && descriptor.fixture_kind === kind;
      family[kind] = { valid, fixture_id: fixtureId || null };
      exact &&= valid;
      if (fixtureId) referencedIds.push(fixtureId);
    }
    perNode.set(node.id, { exact, family });
  }
  const descriptorIds = Object.keys(bundle.fixtures || {});
  const referencedSet = new Set(referencedIds);
  const descriptorSet = new Set(descriptorIds);
  return {
    perNode,
    referencedIds,
    exact:
      referencedIds.length === EXPECTED.fixtures
      && referencedSet.size === EXPECTED.fixtures
      && descriptorIds.length === EXPECTED.fixtures
      && descriptorSet.size === EXPECTED.fixtures
      && [...referencedSet].every((id) => descriptorSet.has(id))
      && [...descriptorSet].every((id) => referencedSet.has(id)),
  };
}

function resolveFixture(bundle, fixtureId, seen = new Set()) {
  const descriptor = bundle.fixtures?.[fixtureId];
  if (!descriptor) throw new Error("fixture_missing");
  if (seen.has(fixtureId)) throw new Error("fixture_cycle");
  seen.add(fixtureId);
  const {
    base_fixture: baseFixture,
    evidence_tenant_override: evidenceTenantOverride,
    ...own
  } = descriptor;
  const resolved = baseFixture
    ? {
        ...structuredClone(resolveFixture(bundle, baseFixture, seen)),
        ...structuredClone(own),
      }
    : structuredClone(own);
  if (evidenceTenantOverride) {
    if (!Array.isArray(resolved.evidence)) throw new Error("fixture_evidence_required");
    resolved.evidence = resolved.evidence.map((item) => ({
      ...item,
      tenant_id: evidenceTenantOverride,
    }));
  }
  return resolved;
}

function evaluateFixture(node, fixture, functionSpec, registryHash, requestId, overrides = {}) {
  const verifiedParents = Array.isArray(fixture.verified_parent_ids)
    ? fixture.verified_parent_ids
    : [];
  return runtime.evaluateNode({
    node,
    tenantId: fixture.tenant_id,
    subbranchId: fixture.subbranch_id,
    corePayload: fixture.core_payload,
    evidence: fixture.evidence,
    evidenceSource: fixture.evidence_source,
    capabilityInput: fixture.capability_input,
    functionSpec,
    functionRegistryHash: registryHash,
    parentEvaluations: new Map(
      verifiedParents.map((id) => [id, { state: "advisory_verified" }])
    ),
    requestId,
    observedAt: fixture.observed_at,
    ...overrides,
  });
}

function expectedStateMatches(actualState, expectedState) {
  return Array.isArray(expectedState)
    ? expectedState.includes(actualState)
    : actualState === expectedState;
}

function acceptedFixtureResult(result, expectedState) {
  return Boolean(result)
    && expectedStateMatches(result.state, expectedState)
    && result.execution_authorized === false
    && result.core_final_authority === true;
}

function rejectedProbe(result) {
  return Boolean(result)
    && result.state !== "advisory_verified"
    && result.execution_authorized === false
    && result.core_final_authority === true;
}

function evidenceProvenanceHash(item) {
  return canonicalHash({
    tenant_id: item.tenant_id,
    evidence_type: item.evidence_type,
    authority: item.authority,
    independent: item.independent === true,
    content: item.content,
    payload_hash: item.payload_hash,
    observed_at: item.observed_at,
  });
}

function rebindFixture(node, sourceFixture) {
  const fixture = structuredClone(sourceFixture);
  const capabilityInputHash = canonicalHash(fixture.capability_input);
  const subjectHash = canonicalHash(fixture.capability_input.subject);
  const recordHashes = fixture.capability_input.records.map((record) => canonicalHash(record));
  for (const item of fixture.evidence) {
    item.content.semantic_hash = node.semantic_contract.semantic_hash;
    item.content.capability_input_hash = capabilityInputHash;
    item.content.subject_hash = subjectHash;
    item.content.record_hashes = recordHashes;
    item.payload_hash = canonicalHash(item.content);
    item.provenance_hash = evidenceProvenanceHash(item);
  }
  const manifestPayload = {
    issuer: "universal_core",
    tenant_id: fixture.tenant_id,
    node_id: node.id,
    branch_id: node.branch_id,
    semantic_hash: node.semantic_contract.semantic_hash,
    function_registry_hash: node.function_binding.registry_hash,
    semantic_function_hash: node.function_binding.semantic_function_hash,
    capability_input_hash: capabilityInputHash,
    evidence_hashes: fixture.evidence.map((item) => item.provenance_hash),
  };
  const manifest = {
    ...manifestPayload,
    manifest_hash: canonicalHash(manifestPayload),
  };
  fixture.core_payload.result.evidence_manifest = manifest;
  for (const decision of fixture.core_payload.result.policy_decisions) {
    decision.snapshot.semantic_hash = node.semantic_contract.semantic_hash;
    decision.snapshot.function_registry_hash = node.function_binding.registry_hash;
    decision.snapshot.semantic_function_hash = node.function_binding.semantic_function_hash;
    decision.snapshot.evidence_manifest_hash = manifest.manifest_hash;
    decision.snapshot_hash = canonicalHash(decision.snapshot);
  }
  return fixture;
}

function assertionBodyHash(assertion) {
  return canonicalHash({
    subject: assertion.subject,
    predicate: assertion.predicate,
    object: assertion.object,
    polarity: assertion.polarity,
  });
}

function observationFacts(observation) {
  return [
    observation?.problem_resolution?.object,
    ...(observation?.evidence_support || []).map((assertion) => assertion.object),
    ...(observation?.failure_absence || []).map((assertion) => assertion.object),
    observation?.boundary_preservation?.object,
  ].filter(Boolean);
}

function addObservationFacts(fixture) {
  const observation = fixture.capability_input.records[0].semantic_observation;
  const facts = observationFacts(observation);
  for (const item of fixture.evidence) {
    item.content.facts = [...new Set([...(item.content.facts || []), ...facts])];
  }
  return fixture;
}

function structuralDonorKey(node, spec) {
  return JSON.stringify({
    node_type: node.node_type,
    evidence_requirements: node.required_evidence?.length || 0,
    policy_bindings: node.core_policy_bindings?.length || 0,
    evidence_assertions: spec?.semantic_assertions?.evidence_support?.length || 0,
    failure_assertions: spec?.semantic_assertions?.failure_absence?.length || 0,
    input_required: node.input_schema?.required?.length || 0,
    output_required: node.output_schema?.required?.length || 0,
  });
}

function donorIndex(candidate, functionIndex) {
  const groups = new Map();
  const nodesByType = new Map();
  for (const node of candidate.nodes) {
    const key = structuralDonorKey(node, functionIndex.get(node.id));
    const group = groups.get(key) || [];
    group.push(node);
    groups.set(key, group);
    const typed = nodesByType.get(node.node_type) || [];
    typed.push(node);
    nodesByType.set(node.node_type, typed);
  }
  const result = new Map();
  for (const node of candidate.nodes) {
    const group = groups.get(structuralDonorKey(node, functionIndex.get(node.id))) || [];
    const currentIndex = group.findIndex((candidateNode) => candidateNode.id === node.id);
    const typed = nodesByType.get(node.node_type) || [];
    const typedIndex = typed.findIndex((candidateNode) => candidateNode.id === node.id);
    const peer = group.length > 1
      ? group[(currentIndex + 1) % group.length]
      : typed.length > 1
        ? typed[(typedIndex + 1) % typed.length]
        : null;
    result.set(node.id, peer);
  }
  return result;
}

function v1EntitlementPackForBranch(branchId) {
  if (branchId === "suite_domain") return "suite";
  if (branchId === "smartdesk_domain") return "smartdesk";
  if (branchId === "analyzer_domain") return "analyzer";
  return "generic";
}

function authenticatedV1CatalogUnion(catalogGolden) {
  if (!catalogGolden) return null;
  const catalogs = ["generic", "suite", "smartdesk", "analyzer"].map((packId) =>
    nyraBranchCatalog(packId)
  );
  const branchById = new Map(
    catalogs.flatMap((catalog) => catalog.branches).map((branch) => [branch.id, branch])
  );
  return {
    ...catalogs[0],
    domain_pack_id: catalogGolden.input.domain_pack_id,
    branches: catalogGolden.output.branches.map((branch) => branchById.get(branch.id)),
  };
}

function corePayload(branchIds) {
  return {
    tenant_id: EXPECTED.tenant,
    domain_pack: { id: "skinharmony" },
    result: {
      nyra_neural_network: {
        opened_by: "universal_core",
        opened_branches: branchIds.map((id) => ({ id, status: "opened" })),
        execution_authorized: false,
      },
    },
  };
}

function rollbackAudit(candidate, fixtureBundle, candidatePath) {
  const horizontal = fixtureBundle.v1_goldens?.horizontal_runtime;
  const horizontalActual = horizontal
    ? createNyraHorizontalRuntime({
        NYRA_DEEP_BRANCH_V2_ENABLED: "false",
      }).prepareInterpretation(horizontal.input)
    : null;
  const horizontalPassed =
    Boolean(horizontal)
    && deepEqualJson(horizontalActual, horizontal.output)
    && canonicalHash(horizontalActual) === horizontal.output_hash
    && !Object.hasOwn(horizontalActual?.local_interpretation || {}, "deep_branch_v2");

  const catalogGolden = fixtureBundle.v1_goldens?.catalog_skinharmony;
  const catalogActual = authenticatedV1CatalogUnion(catalogGolden);
  const catalogPassed =
    Boolean(catalogGolden)
    && deepEqualJson(catalogActual, catalogGolden.output)
    && canonicalHash(catalogActual) === catalogGolden.output_hash;

  const routeResults = new Map();
  for (const branch of candidate.branches) {
    const golden = fixtureBundle.v1_goldens?.[`route_${branch.id}`];
    const actualRaw = golden
      ? routeNyraBranches({
          ...golden.input,
          domainPackId: v1EntitlementPackForBranch(branch.id),
        })
      : null;
    const actual = actualRaw
      ? { ...actualRaw, domain_pack_id: golden.output.domain_pack_id }
      : null;
    routeResults.set(branch.id, {
      passed:
        Boolean(golden)
        && deepEqualJson(actual, golden.output)
        && canonicalHash(actual) === golden.output_hash
        && actual?.execution_authorized === false,
      actual,
      golden,
    });
  }

  let disabledRoute = null;
  try {
    const firstBranchId = candidate.branches[0]?.id;
    disabledRoute = runtime.route({
      tenantId: EXPECTED.tenant,
      domainPackId: "skinharmony",
      corePayload: corePayload(firstBranchId ? [firstBranchId] : []),
      requestedBranches: firstBranchId ? [firstBranchId] : [],
      env: {
        NYRA_DEEP_BRANCH_V2_ENABLED: "false",
        NYRA_DEEP_BRANCH_V2_MODE: "active",
        NYRA_DEEP_BRANCH_V2_BRANCHES: firstBranchId || "",
        NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: EXPECTED.tenant,
      },
      catalogPath: candidatePath,
      runtimeMode: "legacy",
    });
  } catch {
    disabledRoute = null;
  }
  const killSwitchPassed =
    disabledRoute?.state === "disabled_v1_authoritative"
    && disabledRoute?.fallback === "nyra_neural_branch_network_v1"
    && disabledRoute?.execution_authorized === false;

  const featureFlagsPassed =
    runtime.featureFlags({}, EXPECTED.tenant).enabled === false
    && runtime.featureFlags(
      {
        NYRA_DEEP_BRANCH_V2_ENABLED: "true",
        NYRA_DEEP_BRANCH_V2_MODE: "active",
        NYRA_DEEP_BRANCH_V2_BRANCHES: candidate.branches.map((branch) => branch.id).join(","),
        NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: EXPECTED.tenant,
      },
      "tenant-other"
    ).enabled === false;

  return {
    horizontal_passed: horizontalPassed,
    catalog_passed: catalogPassed,
    route_results: routeResults,
    all_routes_passed:
      routeResults.size === EXPECTED.branches
      && [...routeResults.values()].every((result) => result.passed),
    kill_switch_passed: killSwitchPassed,
    feature_flags_passed: featureFlagsPassed,
    disabled_route_state: disabledRoute?.state || null,
    disabled_route_fallback: disabledRoute?.fallback || null,
  };
}

function regressionFixturePassed(node, fixture, rollback) {
  const refs = fixture?.v1_golden_refs || {};
  const routeResult = rollback.route_results.get(node.branch_id);
  const openedBranch = routeResult?.actual?.opened_branches?.find(
    (branch) => branch.id === refs.expected_branch_id
  );
  return (
    fixture?.fixture_kind === "regression"
    && fixture.expected_execution_authorized === false
    && runtime.featureFlags(fixture.feature_flags || {}, fixture.tenant_id).enabled === false
    && node.v1_compatibility?.breaking_change === false
    && node.v1_compatibility?.fallback_to_v1 === true
    && node.rollback_reference?.kill_switch === "NYRA_DEEP_BRANCH_V2_ENABLED=false"
    && refs.horizontal === "horizontal_runtime"
    && refs.catalog === "catalog_skinharmony"
    && refs.route === `route_${node.branch_id}`
    && refs.expected_branch_id === node.branch_id
    && refs.expected_subbranch_id === node.id.split(".")[1]
    && rollback.horizontal_passed
    && rollback.catalog_passed
    && routeResult?.passed === true
    && openedBranch?.subbranches?.includes(refs.expected_subbranch_id)
    && rollback.kill_switch_passed
  );
}

function contractStaticChecks(node, topology, functionAudit, fixtureAudit, candidate) {
  const requiredFields = runtime.REQUIRED_CONTRACT_FIELDS || [];
  const auditNames = new Set((node.audit_fields || []).map((field) => field?.name));
  const provenanceNames = new Set(
    (node.provenance_fields || []).map((field) => field?.name)
  );
  const purpose = normalizedText(node.purpose);
  const problem = normalizedText(node.problem_solved);
  const functionResult = functionAudit.perNode.get(node.id);
  const subbranchId = node.id.split(".")[1];
  return {
    candidate_pending: node.supervisor_status === "PENDING",
    required_contract_fields_complete:
      requiredFields.length > 0
      && requiredFields.every((field) => Object.hasOwn(node, field)),
    identity_and_parent_topology: topology.nodeChecks.get(node.id) === true,
    function_distinct: functionResult?.valid === true,
    problem_distinct: purpose.length >= 8 && problem.length >= 8 && purpose !== problem,
    contract_independent:
      typeof node.semantic_contract?.semantic_hash === "string"
      && /^[a-f0-9]{64}$/.test(node.semantic_contract.semantic_hash),
    no_placeholder_or_todo:
      !FORBIDDEN_PLACEHOLDER.test(String(node.purpose || ""))
      && !FORBIDDEN_PLACEHOLDER.test(String(node.problem_solved || "")),
    input_schema_complete:
      node.input_schema?.type === "object"
      && node.input_schema?.additionalProperties === false
      && Array.isArray(node.input_schema?.required)
      && node.input_schema.required.length > 0,
    output_schema_complete:
      node.output_schema?.type === "object"
      && node.output_schema?.additionalProperties === false
      && Array.isArray(node.output_schema?.required)
      && node.output_schema.required.length > 0,
    activation_conditions_executable:
      Array.isArray(node.activation_conditions)
      && node.activation_conditions.length > 0
      && node.activation_conditions.every(
        (condition) => condition?.signal && condition?.operator
          && Object.hasOwn(condition, "expected") && condition?.reason
      ),
    non_activation_conditions_executable:
      Array.isArray(node.non_activation_conditions)
      && node.non_activation_conditions.length > 0
      && node.non_activation_conditions.every(
        (condition) => condition?.signal && condition?.operator
          && Object.hasOwn(condition, "expected") && condition?.reason
      ),
    evidence_contract_complete:
      Array.isArray(node.required_evidence)
      && node.required_evidence.length > 0
      && node.required_evidence.every(
        (requirement) =>
          /^[a-f0-9]{64}$/.test(String(requirement?.semantic_claim_hash || ""))
          && requirement?.acceptance_program?.require_subject_binding === true
          && requirement?.acceptance_program?.require_record_binding === true
          && requirement?.acceptance_program?.require_core_manifest_binding === true
      ),
    universal_core_policy_bound:
      node.dependencies?.some(
        (dependency) => dependency?.type === "universal_core" && dependency?.required === true
      )
      && node.core_policy_bindings?.some(
        (binding) =>
          binding?.policy_id === "tenant_isolation"
          && binding?.core_decision_required === true
      ),
    risk_and_confidence_complete:
      ["low", "medium", "high", "critical"].includes(node.risk_class)
      && Number.isFinite(node.confidence_threshold)
      && node.confidence_threshold >= 0
      && node.confidence_threshold <= 1
      && node.confidence_method?.abstain_below_threshold === true,
    verifier_executable:
      Array.isArray(node.verifiers)
      && node.verifiers.length > 0
      && node.verifiers.every(
        (verifier) =>
          verifier?.predicate_program?.kind === "verifier_gate_v1"
          && Array.isArray(verifier?.checks)
          && verifier.checks.length > 0
          && new Set(verifier.checks).size === verifier.checks.length
      ),
    metric_executable:
      Array.isArray(node.metrics)
      && node.metrics.length > 0
      && node.metrics.every(
        (metric) =>
          metric?.formula_program?.kind === "metric_formula_v1"
          && Array.isArray(metric?.source_fields)
          && metric.source_fields.length > 0
          && Number.isFinite(metric?.target)
          && Boolean(metric?.unit)
          && Boolean(metric?.direction)
          && Boolean(metric?.threshold_operator)
      ),
    fallback_declared: node.fallback_node === `v1:${node.branch_id}/${subbranchId}`,
    audit_fields_complete: REQUIRED_AUDIT_FIELDS.every((name) => auditNames.has(name)),
    provenance_exact: REQUIRED_PROVENANCE_FIELDS.every((name) => provenanceNames.has(name)),
    rollback_reference_verified:
      node.rollback_reference?.catalog_checkpoint === candidate.rollback_checkpoint
      && node.rollback_reference?.kill_switch === "NYRA_DEEP_BRANCH_V2_ENABLED=false"
      && Array.isArray(node.rollback_reference?.steps)
      && node.rollback_reference.steps.length >= 2
      && Array.isArray(node.rollback_reference?.verification)
      && node.rollback_reference.verification.some((step) =>
        String(step).includes(node.regression_tests?.[0]?.input_fixture || "<missing>")
      ),
    tenant_isolation:
      node.tenant_scope?.partition_key === "tenant_id"
      && node.tenant_scope?.domain_pack_source === "authenticated_core_key"
      && node.tenant_scope?.cross_tenant_allowed === false
      && node.tenant_scope?.memory_scope === "tenant_only"
      && node.tenant_scope?.evidence_scope === "tenant_only",
    core_final_authority_preserved:
      node.routing?.core_open_required === true
      && node.feature_flag?.default_enabled === false,
    function_registry_bound: functionResult?.valid === true,
    semantic_profile_unique_without_ids_hashes:
      functionAudit.semantic_profiles_unique && Boolean(functionResult?.semantic_profile),
    fixture_binding_exact: fixtureAudit.perNode.get(node.id)?.exact === true,
  };
}

function materialChecksPassed(checks) {
  return Object.values(checks).every((value) => value === true);
}

function reasonCodeForCheck(check) {
  return `SUPERVISOR_${check.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function currentArtifactBindings(candidate) {
  const generatorSha256 = byteHash(fs.readFileSync(generatorPath));
  const runtimeSha256 = byteHash(fs.readFileSync(runtimePath));
  const researchSha256 = byteHash(fs.readFileSync(researchPath));
  const horizontalRuntimeSha256 = byteHash(fs.readFileSync(path.join(
    repoRoot,
    "personal-control-center/lib/nyra-horizontal-runtime.js",
  )));
  const coreBranchNetworkSha256 = byteHash(fs.readFileSync(path.join(
    repoRoot,
    "services/universal-core-service/src/nyraBranchNetwork.js",
  )));
  const currentV1ImplementationPin = {
    repository_commit: V1_COMPATIBLE_IMPLEMENTATION_PIN.repository_commit,
    horizontal_runtime_sha256: horizontalRuntimeSha256,
    core_branch_network_sha256: coreBranchNetworkSha256,
  };
  const expectedBuildCheckpoint = canonicalHash({
    schema_version: candidate.schema_version,
    version: candidate.version,
    source_snapshot_sha256: candidate.source_catalog?.source_snapshot_sha256,
    research_sha256: researchSha256,
    generator_sha256: generatorSha256,
    runtime_sha256: runtimeSha256,
    confidence_calibration: candidate.confidence_calibration,
  });
  const expectedRollbackCheckpoint = canonicalHash({
    ...V1_SOURCE_PIN,
    live_v1_catalog_snapshot_sha256: candidate.source_catalog?.source_snapshot_sha256,
  });
  return {
    generator_sha256: generatorSha256,
    runtime_sha256: runtimeSha256,
    research_sha256: researchSha256,
    horizontal_runtime_sha256: horizontalRuntimeSha256,
    core_branch_network_sha256: coreBranchNetworkSha256,
    generator_match: candidate.generator_sha256 === generatorSha256,
    runtime_match: candidate.runtime_sha256 === runtimeSha256,
    research_match:
      candidate.research_sha256 === researchSha256
      && candidate.function_registry?.research_sha256 === researchSha256,
    source_registry_match:
      candidate.function_registry?.source_snapshot_sha256
      === candidate.source_catalog?.source_snapshot_sha256,
    source_pin_match: deepEqualJson(
      candidate.source_catalog?.source_pin,
      V1_SOURCE_PIN,
    ),
    source_pin_bytes_match:
      deepEqualJson(
        currentV1ImplementationPin,
        V1_COMPATIBLE_IMPLEMENTATION_PIN,
      ),
    build_checkpoint_match:
      candidate.build_checkpoint === `sha256:${expectedBuildCheckpoint}`,
    rollback_checkpoint_match:
      candidate.rollback_checkpoint === `sha256:${expectedRollbackCheckpoint}`,
    fixture_source_pin_match: null,
  };
}

function globalPreflight({
  candidate,
  fixtureBundle,
  topology,
  functionAudit,
  fixtureAudit,
  runtimeValidation,
  artifactBindings,
  coreProjection,
}) {
  const counts = topologyCounts(candidate);
  const sourceProjection = branchTopologyProjection(candidate.source_catalog?.branches);
  const candidateProjection = branchTopologyProjection(candidate.branches);
  const fixtureSourcePin = fixtureBundle.v1_goldens?.source_pin;
  artifactBindings.fixture_source_pin_match = deepEqualJson(
    fixtureSourcePin,
    V1_SOURCE_PIN
  );
  return {
    candidate_schema:
      candidate.schema_version === EXPECTED.schemaVersion
      && candidate.authority === "universal_core",
    candidate_fingerprint:
      /^[a-f0-9]{64}$/.test(String(candidate.catalog_fingerprint || ""))
      && candidate.catalog_fingerprint === catalogFingerprint(candidate)
      && runtime.catalogFingerprint(candidate) === candidate.catalog_fingerprint,
    candidate_pending:
      candidate.nodes.every((node) => node.supervisor_status === "PENDING")
      && !Object.hasOwn(candidate, "supervisor_admission"),
    tenant_scope:
      candidate.source_catalog?.tenant_id === EXPECTED.tenant,
    exact_topology_counts:
      counts.branch_count === EXPECTED.branches
      && counts.subbranch_count === EXPECTED.subbranches
      && counts.node_count === EXPECTED.nodes
      && counts.level_counts[2] === EXPECTED.subbranches
      && counts.level_counts[3] === EXPECTED.subbranches
      && counts.level_counts[4] === EXPECTED.subbranches * EXPECTED.level4Types.length
      && EXPECTED.level4Types.every(
        (type) => counts.level4_type_counts[type] === EXPECTED.subbranches
      ),
    exact_topology_shape: topology.all_lineages_exact,
    authenticated_core_topology:
      deepEqualJson(candidateProjection, coreProjection)
      && deepEqualJson(sourceProjection, coreProjection),
    unique_node_ids: new Set(candidate.nodes.map((node) => node.id)).size === EXPECTED.nodes,
    unique_purposes:
      new Set(candidate.nodes.map((node) => normalizedText(node.purpose))).size
      === EXPECTED.nodes,
    unique_problems:
      new Set(candidate.nodes.map((node) => normalizedText(node.problem_solved))).size
      === EXPECTED.nodes,
    function_registry_hash: functionAudit.registry_hash_match,
    function_registry_coverage: functionAudit.registry_ids_exact,
    function_registry_uniqueness:
      functionAudit.semantic_functions_unique && functionAudit.semantic_profiles_unique,
    function_registry_bindings:
      [...functionAudit.perNode.values()].every((result) => result.valid),
    fixture_schema:
      fixtureBundle.schema_version === EXPECTED.fixtureSchemaVersion,
    fixture_fingerprint:
      fixtureBundle.catalog_fingerprint === candidate.catalog_fingerprint,
    fixture_count:
      fixtureBundle.fixture_count === EXPECTED.fixtures
      && Object.keys(fixtureBundle.fixtures || {}).length === EXPECTED.fixtures,
    fixture_reference_bijection: fixtureAudit.exact,
    generator_byte_binding: artifactBindings.generator_match,
    runtime_byte_binding: artifactBindings.runtime_match,
    research_byte_binding: artifactBindings.research_match,
    source_registry_binding: artifactBindings.source_registry_match,
    source_pin_binding: artifactBindings.source_pin_match,
    source_pin_bytes_binding: artifactBindings.source_pin_bytes_match,
    build_checkpoint_binding: artifactBindings.build_checkpoint_match,
    rollback_checkpoint_binding: artifactBindings.rollback_checkpoint_match,
    v1_source_pin_binding: artifactBindings.fixture_source_pin_match,
    runtime_catalog_validation:
      runtimeValidation.ok === true
      && runtimeValidation.runtime_fingerprint_match === true
      && runtimeValidation.errors.length === 0,
  };
}

function runNodeAudit({
  node,
  candidate,
  fixtureBundle,
  topology,
  functionAudit,
  fixtureAudit,
  globalChecks,
  rollback,
  donorById,
  supportedOperations,
  probeTotals,
}) {
  const checks = {
    ...Object.fromEntries(
      Object.entries(globalChecks).map(([key, value]) => [`catalog_${key}`, value])
    ),
    ...contractStaticChecks(
      node,
      topology,
      functionAudit,
      fixtureAudit,
      candidate
    ),
  };
  const functionSpec = functionAudit.functionIndex.get(node.id);
  const registryHash = candidate.function_registry.registry_hash;
  const references = fixtureAudit.perNode.get(node.id)?.family;

  let positiveFixture;
  let negativeFixture;
  let adversarialFixture;
  let regressionFixture;
  try {
    positiveFixture = resolveFixture(fixtureBundle, references?.positive?.fixture_id);
    negativeFixture = resolveFixture(fixtureBundle, references?.negative?.fixture_id);
    adversarialFixture = resolveFixture(
      fixtureBundle,
      references?.adversarial?.fixture_id
    );
    regressionFixture = resolveFixture(
      fixtureBundle,
      references?.regression?.fixture_id
    );
  } catch {
    checks.fixture_resolution = false;
  }

  if (positiveFixture && negativeFixture && adversarialFixture && regressionFixture) {
    checks.fixture_resolution = true;
    const positiveResult = evaluateFixture(
      node,
      positiveFixture,
      functionSpec,
      registryHash,
      `${node.id}:positive`
    );
    const negativeResult = evaluateFixture(
      node,
      negativeFixture,
      functionSpec,
      registryHash,
      `${node.id}:negative`
    );
    const adversarialResult = evaluateFixture(
      node,
      adversarialFixture,
      functionSpec,
      registryHash,
      `${node.id}:adversarial`
    );
    checks.positive_fixture_passes = acceptedFixtureResult(
      positiveResult,
      positiveFixture.expected_state
    );
    checks.negative_fixture_passes = acceptedFixtureResult(
      negativeResult,
      negativeFixture.expected_state
    );
    checks.adversarial_fixture_passes = acceptedFixtureResult(
      adversarialResult,
      adversarialFixture.expected_state
    );
    checks.regression_fixture_passes = regressionFixturePassed(
      node,
      regressionFixture,
      rollback
    );
    checks.core_final_authority_preserved =
      checks.core_final_authority_preserved
      && [positiveResult, negativeResult, adversarialResult].every(
        (result) =>
          result?.execution_authorized === false
          && result?.core_final_authority === true
      );
    checks.tenant_isolation =
      checks.tenant_isolation
      && adversarialFixture.evidence?.some(
        (item) => item.tenant_id !== positiveFixture.tenant_id
      )
      && adversarialResult.state !== "advisory_verified";
    const capabilityResult = Object.values(positiveResult?.output || {}).find(
      (value) => value && typeof value === "object" && value.status === "satisfied"
    );
    checks.causal_output_verified =
      checks.positive_fixture_passes
      && Boolean(capabilityResult)
      && capabilityResult.finding !== node.purpose
      && capabilityResult.finding !== node.problem_solved;
    probeTotals.fixtures.executed += 4;
    probeTotals.fixtures.passed += [
      checks.positive_fixture_passes,
      checks.negative_fixture_passes,
      checks.adversarial_fixture_passes,
      checks.regression_fixture_passes,
    ].filter(Boolean).length;

    const donor = donorById.get(node.id);
    const donorSpec = donor ? functionAudit.functionIndex.get(donor.id) : null;
    checks.structural_donor_available =
      Boolean(donor)
      && donor.id !== node.id
      && donor.node_type === node.node_type
      && Boolean(donorSpec);
    if (checks.structural_donor_available) {
      const donorFunctionResult = evaluateFixture(
        node,
        positiveFixture,
        donorSpec,
        registryHash,
        `${node.id}:donor-function`
      );
      checks.donor_function_registry_rejected = rejectedProbe(donorFunctionResult);

      const donorFixture = resolveFixture(
        fixtureBundle,
        fixtureAudit.perNode.get(donor.id).family.positive.fixture_id
      );
      let donorObservationFixture = structuredClone(positiveFixture);
      const donorObservation = structuredClone(
        donorFixture.capability_input.records[0].semantic_observation
      );
      donorObservation.function_hash = functionSpec.semantic_function_hash;
      donorObservationFixture.capability_input.records[0].semantic_observation =
        donorObservation;
      donorObservationFixture = addObservationFacts(donorObservationFixture);
      donorObservationFixture = rebindFixture(node, donorObservationFixture);
      const donorObservationResult = evaluateFixture(
        node,
        donorObservationFixture,
        functionSpec,
        registryHash,
        `${node.id}:donor-observation`
      );
      checks.donor_semantic_observation_rejected =
        rejectedProbe(donorObservationResult);
      probeTotals.donor.executed += 2;
      probeTotals.donor.passed += [
        checks.donor_function_registry_rejected,
        checks.donor_semantic_observation_rejected,
      ].filter(Boolean).length;
    } else {
      checks.donor_function_registry_rejected = false;
      checks.donor_semantic_observation_rejected = false;
    }

    const replacementOperation = supportedOperations.find(
      (operation) => operation !== node.methods?.[0]?.operation
    );
    if (replacementOperation) {
      const mutatedNode = structuredClone(node);
      mutatedNode.methods[0].operation = replacementOperation;
      checks.mutation_contract_operation_rejected = rejectedProbe(
        evaluateFixture(
          mutatedNode,
          positiveFixture,
          functionSpec,
          registryHash,
          `${node.id}:mutation-operation`
        )
      );
    } else {
      checks.mutation_contract_operation_rejected = false;
    }

    let exactEnvelopeFixture = structuredClone(positiveFixture);
    exactEnvelopeFixture.evidence[0].__supervisor_forbidden_probe = true;
    checks.mutation_exact_envelope_rejected = rejectedProbe(
      evaluateFixture(
        node,
        exactEnvelopeFixture,
        functionSpec,
        registryHash,
        `${node.id}:mutation-envelope`
      )
    );

    let semanticFixture = structuredClone(positiveFixture);
    const semanticAssertion =
      semanticFixture.capability_input.records[0].semantic_observation.problem_resolution;
    semanticAssertion.object =
      "Coherently rebound lunar observation outside the registered function domain";
    semanticAssertion.key = assertionBodyHash(semanticAssertion);
    semanticFixture = addObservationFacts(semanticFixture);
    semanticFixture = rebindFixture(node, semanticFixture);
    checks.mutation_semantic_assertion_rejected = rejectedProbe(
      evaluateFixture(
        node,
        semanticFixture,
        functionSpec,
        registryHash,
        `${node.id}:mutation-semantic`
      )
    );

    let denyFixture = structuredClone(positiveFixture);
    denyFixture.core_payload.result.policy_decisions[0].decision = "DENY";
    denyFixture.core_payload.result.policy_decisions[0].snapshot.decision = "DENY";
    denyFixture.core_payload.result.policy_decisions[0].snapshot_hash = canonicalHash(
      denyFixture.core_payload.result.policy_decisions[0].snapshot
    );
    checks.mutation_core_deny_rejected = rejectedProbe(
      evaluateFixture(
        node,
        denyFixture,
        functionSpec,
        registryHash,
        `${node.id}:mutation-core-deny`
      )
    );

    const semanticMutations = {};

    let mutated = structuredClone(positiveFixture);
    mutated.capability_input.records[0].semantic_observation.evidence_support.pop();
    mutated = rebindFixture(node, mutated);
    semanticMutations.missing = rejectedProbe(
      evaluateFixture(
        node,
        mutated,
        functionSpec,
        registryHash,
        `${node.id}:semantic-missing`
      )
    );

    mutated = structuredClone(positiveFixture);
    const support = mutated.capability_input.records[0].semantic_observation.evidence_support;
    support.push(structuredClone(support[0]));
    mutated = rebindFixture(node, mutated);
    semanticMutations.duplicate = rejectedProbe(
      evaluateFixture(
        node,
        mutated,
        functionSpec,
        registryHash,
        `${node.id}:semantic-duplicate`
      )
    );

    mutated = structuredClone(positiveFixture);
    const polarityAssertion =
      mutated.capability_input.records[0].semantic_observation.problem_resolution;
    polarityAssertion.polarity = "negative";
    polarityAssertion.key = assertionBodyHash(polarityAssertion);
    mutated = addObservationFacts(mutated);
    mutated = rebindFixture(node, mutated);
    semanticMutations.polarity = rejectedProbe(
      evaluateFixture(
        node,
        mutated,
        functionSpec,
        registryHash,
        `${node.id}:semantic-polarity`
      )
    );

    mutated = structuredClone(positiveFixture);
    mutated.capability_input.records[0].semantic_observation
      .boundary_preservation.evidence_ids = ["ev_missing"];
    mutated = rebindFixture(node, mutated);
    semanticMutations.evidence_join = rejectedProbe(
      evaluateFixture(
        node,
        mutated,
        functionSpec,
        registryHash,
        `${node.id}:semantic-evidence-join`
      )
    );

    mutated = structuredClone(positiveFixture);
    mutated.capability_input.records[0].semantic_observation.failure_absence[0].result =
      "supported";
    mutated = rebindFixture(node, mutated);
    semanticMutations.failure = rejectedProbe(
      evaluateFixture(
        node,
        mutated,
        functionSpec,
        registryHash,
        `${node.id}:semantic-failure`
      )
    );

    mutated = structuredClone(positiveFixture);
    delete mutated.capability_input.records[0].semantic_observation.boundary_preservation;
    mutated = rebindFixture(node, mutated);
    semanticMutations.boundary = rejectedProbe(
      evaluateFixture(
        node,
        mutated,
        functionSpec,
        registryHash,
        `${node.id}:semantic-boundary`
      )
    );

    checks.semantic_missing_rejected = semanticMutations.missing;
    checks.semantic_duplicate_rejected = semanticMutations.duplicate;
    checks.semantic_polarity_rejected = semanticMutations.polarity;
    checks.semantic_evidence_join_rejected = semanticMutations.evidence_join;
    checks.semantic_failure_rejected = semanticMutations.failure;
    checks.semantic_boundary_rejected = semanticMutations.boundary;
    checks.full_operation_rebind_rejected =
      checks.mutation_contract_operation_rejected;
    checks.historic_profile_donor_rejected =
      checks.donor_function_registry_rejected;
    checks.semantic_lunar_rejected =
      checks.mutation_semantic_assertion_rejected;
    checks.semantic_donor_rejected =
      checks.donor_semantic_observation_rejected;
    checks.pass4_matrix_passes =
      checks.mutation_contract_operation_rejected
      && checks.mutation_core_deny_rejected;
    checks.pass6_matrix_passes =
      checks.mutation_exact_envelope_rejected
      && checks.mutation_semantic_assertion_rejected
      && Object.values(semanticMutations).every(Boolean);
    checks.v1_horizontal_golden = rollback.horizontal_passed;
    checks.v1_core_catalog_golden = rollback.catalog_passed;
    checks.v1_route_goldens = rollback.all_routes_passed;
    checks.feature_flag_fail_closed =
      rollback.feature_flags_passed && rollback.kill_switch_passed;

    const mutationChecks = [
      checks.mutation_contract_operation_rejected,
      checks.mutation_exact_envelope_rejected,
      checks.mutation_semantic_assertion_rejected,
      checks.mutation_core_deny_rejected,
      ...Object.values(semanticMutations),
    ];
    probeTotals.mutation.executed += mutationChecks.length;
    probeTotals.mutation.passed += mutationChecks.filter(Boolean).length;
    probeTotals.rollback.executed += 1;
    probeTotals.rollback.passed += checks.regression_fixture_passes ? 1 : 0;
  } else {
    for (const check of [
      "positive_fixture_passes",
      "negative_fixture_passes",
      "adversarial_fixture_passes",
      "regression_fixture_passes",
      "causal_output_verified",
      "structural_donor_available",
      "donor_function_registry_rejected",
      "donor_semantic_observation_rejected",
      "mutation_contract_operation_rejected",
      "mutation_exact_envelope_rejected",
      "mutation_semantic_assertion_rejected",
      "mutation_core_deny_rejected",
      "semantic_missing_rejected",
      "semantic_duplicate_rejected",
      "semantic_polarity_rejected",
      "semantic_evidence_join_rejected",
      "semantic_failure_rejected",
      "semantic_boundary_rejected",
      "full_operation_rebind_rejected",
      "historic_profile_donor_rejected",
      "semantic_lunar_rejected",
      "semantic_donor_rejected",
      "pass4_matrix_passes",
      "pass6_matrix_passes",
      "v1_horizontal_golden",
      "v1_core_catalog_golden",
      "v1_route_goldens",
      "feature_flag_fail_closed",
    ]) checks[check] = false;
  }

  const supervisorApproval = materialChecksPassed(checks);
  checks.supervisor_approval = supervisorApproval;
  checks.all_required_checks_passed =
    supervisorApproval
    && Object.entries(checks)
      .filter(([key]) => key !== "all_required_checks_passed")
      .every(([, value]) => value === true);
  const approved = checks.all_required_checks_passed;
  const failedChecks = Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  return {
    node_id: node.id,
    branch_id: node.branch_id,
    parent_id: node.parent_id,
    level: node.level,
    node_type: node.node_type,
    candidate_status: node.supervisor_status,
    supervisor_status: approved ? "APPROVED" : "REJECTED",
    decision: approved ? "APPROVED" : "REJECTED",
    reasons: approved
      ? ["SUPERVISOR_ALL_REQUIRED_CHECKS_PASSED"]
      : failedChecks.map(reasonCodeForCheck),
    checks,
    runtime_inclusion_allowed: approved,
  };
}

function rejectAllForLateFailure(decisions, checkName) {
  for (const decision of decisions) {
    decision.checks[checkName] = false;
    decision.checks.supervisor_approval = false;
    decision.checks.all_required_checks_passed = false;
    decision.supervisor_status = "REJECTED";
    decision.decision = "REJECTED";
    decision.runtime_inclusion_allowed = false;
    const reason = reasonCodeForCheck(checkName);
    if (!decision.reasons.includes(reason)) decision.reasons.push(reason);
    decision.reasons = decision.reasons.filter(
      (item) => item !== "SUPERVISOR_ALL_REQUIRED_CHECKS_PASSED"
    );
  }
}

function buildFatalReport({
  candidatePath,
  fixturePath,
  candidateSha256 = null,
  fixtureSha256 = null,
  error,
}) {
  return {
    schema_version: "nyra_deep_branch_v2_supervisor_decisions_v2",
    audit_pass: 9,
    report_kind: "independent_fail_closed_supervisor",
    generated_at: new Date().toISOString(),
    supervisor_authority: "independent_offline_supervisor",
    universal_core_final_authority: true,
    summary: {
      decision: "REJECTED",
      all_or_nothing_gate_passed: false,
      nodes_total: 0,
      approved_nodes: 0,
      rejected_nodes: 0,
      runtime_inclusion_allowed: false,
      deploy_allowed: false,
    },
    candidate: {
      path: safeArtifactName(candidatePath, "candidate.json"),
      sha256: candidateSha256,
      fixture_path: safeArtifactName(fixturePath, "fixtures.json"),
      fixture_sha256: fixtureSha256,
      approved_by_this_report: false,
    },
    decision_summary: {
      overall_decision: "REJECTED",
      admission_policy: "unanimous_all_checks_required",
      branches_reviewed: 0,
      level_1_subbranches_reviewed: 0,
      candidate_nodes_reviewed: 0,
      approved_nodes: 0,
      rejected_nodes: 0,
      pending_nodes_after_review: 0,
      runtime_inclusion_allowed: false,
      deploy_allowed: false,
    },
    formal_audit: {
      completed: false,
      errors: [sanitizedError(error)],
    },
    approved_node_ids: [],
    rejected_node_ids: [],
    decisions: [],
    release_gate: {
      deploy_allowed: false,
      deploy_authorized: false,
      merge_authorized: false,
      explicit_owner_confirmation_required: true,
      universal_core_verdict_required: "ALLOW",
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidatePath = requiredArg(args, "candidate");
  const fixturePath = requiredArg(args, "fixtures");
  const outputPath = requiredArg(args, "output");
  if (
    path.resolve(outputPath) === path.resolve(candidatePath)
    || path.resolve(outputPath) === path.resolve(fixturePath)
  ) {
    throw new Error("output_must_not_overwrite_input");
  }
  const expectedCandidateSha256 = optionalSha256(args, "candidate-sha256");
  const expectedFixtureSha256 = optionalSha256(args, "fixtures-sha256");
  let candidateArtifact = null;
  let fixtureArtifact = null;

  try {
    candidateArtifact = readJsonBytes(candidatePath, "candidate");
    fixtureArtifact = readJsonBytes(fixturePath, "fixtures");
    const candidate = candidateArtifact.value;
    const fixtureBundle = fixtureArtifact.value;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("candidate_object_required");
    }
    if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.branches)) {
      throw new Error("candidate_topology_required");
    }
    if (!fixtureBundle || typeof fixtureBundle !== "object" || Array.isArray(fixtureBundle)) {
      throw new Error("fixture_bundle_object_required");
    }
    if (!fixtureBundle.fixtures || typeof fixtureBundle.fixtures !== "object") {
      throw new Error("fixture_descriptors_required");
    }

    const coreCatalog = nyraBranchCatalog("skinharmony");
    const coreProjection = branchTopologyProjection(
      coreCatalog.branches.filter(
        (branch) => !V2_EXCLUDED_BRANCH_IDS.has(branch.id),
      ),
    );
    const topology = indexTopology(candidate);
    const functionAudit = functionRegistryAudit(candidate);
    const fixtureAudit = fixtureReferences(candidate, fixtureBundle);
    const runtimeValidation = transientRuntimeValidation(candidate);
    const artifactBindings = currentArtifactBindings(candidate);
    const globalChecks = globalPreflight({
      candidate,
      fixtureBundle,
      topology,
      functionAudit,
      fixtureAudit,
      runtimeValidation,
      artifactBindings,
      coreProjection,
    });
    globalChecks.candidate_byte_sha256_expected =
      expectedCandidateSha256 === null
      || candidateArtifact.byte_sha256 === expectedCandidateSha256;
    globalChecks.fixture_byte_sha256_expected =
      expectedFixtureSha256 === null
      || fixtureArtifact.byte_sha256 === expectedFixtureSha256;

    const rollback = rollbackAudit(candidate, fixtureBundle, candidatePath);
    globalChecks.v1_horizontal_golden = rollback.horizontal_passed;
    globalChecks.v1_core_catalog_golden = rollback.catalog_passed;
    globalChecks.v1_route_goldens = rollback.all_routes_passed;
    globalChecks.kill_switch_rollback = rollback.kill_switch_passed;
    globalChecks.feature_flags_fail_closed = rollback.feature_flags_passed;

    const donorById = donorIndex(candidate, functionAudit.functionIndex);
    const supportedOperations = [
      ...new Set(candidate.nodes.map((node) => node.methods?.[0]?.operation).filter(Boolean)),
    ];
    const probeTotals = {
      fixtures: { executed: 0, passed: 0 },
      donor: { executed: 0, passed: 0 },
      mutation: { executed: 0, passed: 0 },
      rollback: { executed: 0, passed: 0 },
    };
    const decisions = [];
    for (const [index, node] of candidate.nodes.entries()) {
      try {
        decisions.push(
          runNodeAudit({
            node,
            candidate,
            fixtureBundle,
            topology,
            functionAudit,
            fixtureAudit,
            globalChecks,
            rollback,
            donorById,
            supportedOperations,
            probeTotals,
          })
        );
      } catch (error) {
        decisions.push({
          node_id: node?.id || `invalid-node-${index}`,
          branch_id: node?.branch_id || null,
          parent_id: node?.parent_id || null,
          level: node?.level || null,
          node_type: node?.node_type || null,
          candidate_status: node?.supervisor_status || null,
          supervisor_status: "REJECTED",
          decision: "REJECTED",
          reasons: [
            "SUPERVISOR_NODE_AUDIT_EXCEPTION",
            reasonCodeForCheck(sanitizedError(error)),
          ],
          checks: {
            node_audit_completed: false,
            supervisor_approval: false,
            all_required_checks_passed: false,
          },
          runtime_inclusion_allowed: false,
        });
      }
      if ((index + 1) % 250 === 0) {
        process.stderr.write(
          `Supervisor audited ${index + 1}/${candidate.nodes.length} candidate nodes\n`
        );
      }
    }

    const candidatePostSha256 = byteHash(fs.readFileSync(candidatePath));
    const fixturePostSha256 = byteHash(fs.readFileSync(fixturePath));
    const artifactBindingsPost = currentArtifactBindings(candidate);
    const candidateBytesStable =
      candidatePostSha256 === candidateArtifact.byte_sha256;
    const fixtureBytesStable =
      fixturePostSha256 === fixtureArtifact.byte_sha256;
    const implementationBytesStable =
      artifactBindingsPost.generator_sha256 === artifactBindings.generator_sha256
      && artifactBindingsPost.runtime_sha256 === artifactBindings.runtime_sha256
      && artifactBindingsPost.research_sha256 === artifactBindings.research_sha256
      && artifactBindingsPost.horizontal_runtime_sha256
        === artifactBindings.horizontal_runtime_sha256
      && artifactBindingsPost.core_branch_network_sha256
        === artifactBindings.core_branch_network_sha256;
    if (!candidateBytesStable) {
      rejectAllForLateFailure(decisions, "candidate_byte_sha256_stable");
    }
    if (!fixtureBytesStable) {
      rejectAllForLateFailure(decisions, "fixture_byte_sha256_stable");
    }
    if (!implementationBytesStable) {
      rejectAllForLateFailure(decisions, "implementation_byte_sha256_stable");
    }

    const approvedNodeIds = decisions
      .filter((decision) => decision.decision === "APPROVED")
      .map((decision) => decision.node_id);
    const rejectedNodeIds = decisions
      .filter((decision) => decision.decision !== "APPROVED")
      .map((decision) => decision.node_id);
    const allProbesPassed = Object.values(probeTotals).every(
      (probe) => probe.executed > 0 && probe.executed === probe.passed
    );
    const approved =
      candidateBytesStable
      && fixtureBytesStable
      && implementationBytesStable
      && materialChecksPassed(globalChecks)
      && allProbesPassed
      && decisions.length === EXPECTED.nodes
      && approvedNodeIds.length === EXPECTED.nodes
      && rejectedNodeIds.length === 0
      && decisions.every(
        (decision) =>
          decision.checks?.all_required_checks_passed === true
          && decision.runtime_inclusion_allowed === true
      );

    if (!approved) {
      rejectAllForLateFailure(decisions, "unanimous_all_checks_required");
    }
    const finalApprovedNodeIds = decisions
      .filter((decision) => decision.decision === "APPROVED")
      .map((decision) => decision.node_id);
    const finalRejectedNodeIds = decisions
      .filter((decision) => decision.decision !== "APPROVED")
      .map((decision) => decision.node_id);
    const counts = topologyCounts(candidate);
    const perBranchReview = candidate.branches.map((branch) => {
      const branchDecisions = decisions.filter(
        (decision) => decision.branch_id === branch.id
      );
      return {
        branch_id: branch.id,
        subbranches_reviewed: branch.subbranches.length,
        candidate_nodes_reviewed: branchDecisions.length,
        approved_nodes: branchDecisions.filter(
          (decision) => decision.decision === "APPROVED"
        ).length,
        rejected_nodes: branchDecisions.filter(
          (decision) => decision.decision !== "APPROVED"
        ).length,
      };
    });

    const report = {
      schema_version: "nyra_deep_branch_v2_supervisor_decisions_v2",
      audit_pass: 9,
      report_kind: "independent_fail_closed_supervisor",
      generated_at: new Date().toISOString(),
      supervisor_authority: "independent_offline_supervisor",
      universal_core_final_authority: true,
      tenant_scope: {
        tenant_id: EXPECTED.tenant,
        cross_tenant_allowed: false,
      },
      summary: {
        decision: approved ? "APPROVED" : "REJECTED",
        all_or_nothing_gate_passed: approved,
        nodes_total: decisions.length,
        approved_nodes: finalApprovedNodeIds.length,
        rejected_nodes: finalRejectedNodeIds.length,
        runtime_inclusion_allowed: approved,
        deploy_allowed: false,
      },
      candidate: {
        path: safeArtifactName(candidatePath, "candidate.json"),
        sha256: candidateArtifact.byte_sha256,
        byte_sha256_before: candidateArtifact.byte_sha256,
        byte_sha256_after: candidatePostSha256,
        byte_sha256_stable: candidateBytesStable,
        expected_byte_sha256: expectedCandidateSha256,
        expected_byte_sha256_match: globalChecks.candidate_byte_sha256_expected,
        fixture_path: safeArtifactName(fixturePath, "fixtures.json"),
        fixture_sha256: fixtureArtifact.byte_sha256,
        fixture_byte_sha256_before: fixtureArtifact.byte_sha256,
        fixture_byte_sha256_after: fixturePostSha256,
        fixture_byte_sha256_stable: fixtureBytesStable,
        expected_fixture_byte_sha256: expectedFixtureSha256,
        expected_fixture_byte_sha256_match:
          globalChecks.fixture_byte_sha256_expected,
        expected_catalog_fingerprint: catalogFingerprint(candidate),
        catalog_fingerprint: candidate.catalog_fingerprint,
        fingerprint_match: globalChecks.candidate_fingerprint,
        expected_registry_hash: canonicalHash({
          schema_version: candidate.function_registry?.schema_version,
          research_sha256: candidate.function_registry?.research_sha256,
          source_snapshot_sha256:
            candidate.function_registry?.source_snapshot_sha256,
          functions: candidate.function_registry?.functions,
        }),
        registry_hash: candidate.function_registry?.registry_hash,
        registry_hash_match: globalChecks.function_registry_hash,
        expected_runtime_sha256: artifactBindings.runtime_sha256,
        runtime_sha256: candidate.runtime_sha256,
        runtime_sha256_match: artifactBindings.runtime_match,
        expected_generator_sha256: artifactBindings.generator_sha256,
        generator_sha256: candidate.generator_sha256,
        generator_sha256_match: artifactBindings.generator_match,
        research_sha256: candidate.research_sha256,
        research_sha256_match: artifactBindings.research_match,
        rollback_checkpoint: candidate.rollback_checkpoint,
        rollback_checkpoint_match: artifactBindings.rollback_checkpoint_match,
        build_checkpoint: candidate.build_checkpoint,
        build_checkpoint_match: artifactBindings.build_checkpoint_match,
        source_snapshot_sha256:
          candidate.source_catalog?.source_snapshot_sha256,
        source_captured_at: candidate.source_catalog?.captured_at,
        candidate_supervisor_status: candidate.nodes.every(
          (node) => node.supervisor_status === "PENDING"
        )
          ? "PENDING"
          : "MIXED_OR_INVALID",
        approved_by_this_report: approved,
      },
      decision_summary: {
        overall_decision: approved ? "APPROVED" : "REJECTED",
        admission_policy: "unanimous_all_checks_required",
        branches_reviewed: counts.branch_count,
        level_1_subbranches_reviewed: counts.subbranch_count,
        candidate_nodes_reviewed: decisions.length,
        approved_nodes: finalApprovedNodeIds.length,
        rejected_nodes: finalRejectedNodeIds.length,
        pending_nodes_after_review: 0,
        runtime_inclusion_allowed: approved,
        deploy_allowed: false,
      },
      formal_audit: {
        completed: true,
        global_checks: globalChecks,
        runtime_validation: {
          ok: runtimeValidation.ok,
          error_count: runtimeValidation.errors.length,
          warning_count: runtimeValidation.warnings.length,
          errors: runtimeValidation.errors,
        },
        topology: {
          expected: {
            branch_count: EXPECTED.branches,
            subbranch_count: EXPECTED.subbranches,
            node_count: EXPECTED.nodes,
            fixture_count: EXPECTED.fixtures,
          },
          observed: counts,
          exact_lineages: topology.all_lineages_exact,
        },
        executable_probes: probeTotals,
        input_stability: {
          candidate_byte_sha256_stable: candidateBytesStable,
          fixture_byte_sha256_stable: fixtureBytesStable,
          implementation_byte_sha256_stable: implementationBytesStable,
        },
        rollback: {
          horizontal_golden_passed: rollback.horizontal_passed,
          core_catalog_golden_passed: rollback.catalog_passed,
          route_goldens_passed: rollback.all_routes_passed,
          kill_switch_passed: rollback.kill_switch_passed,
          feature_flags_fail_closed: rollback.feature_flags_passed,
          disabled_route_state: rollback.disabled_route_state,
          disabled_route_fallback: rollback.disabled_route_fallback,
        },
      },
      reason_catalog: {
        approval: "SUPERVISOR_ALL_REQUIRED_CHECKS_PASSED",
        rejection_rule:
          "Every false or non-boolean material check is emitted as a stable SUPERVISOR_* reason.",
      },
      per_branch_review: perBranchReview,
      approved_node_ids: finalApprovedNodeIds,
      rejected_node_ids: finalRejectedNodeIds,
      decisions,
      release_gate: {
        deploy_allowed: false,
        deploy_authorized: false,
        merge_authorized: false,
        explicit_owner_confirmation_required: true,
        universal_core_verdict_required: "ALLOW",
      },
    };

    const absolutePaths = absolutePathLocations(report);
    if (absolutePaths.length > 0) {
      throw new Error(`absolute_path_in_report:${absolutePaths.join(",")}`);
    }
    writeJsonAtomic(outputPath, report);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: approved,
          overall_decision: report.decision_summary.overall_decision,
          candidate_catalog_fingerprint: candidate.catalog_fingerprint,
          approved_nodes: finalApprovedNodeIds.length,
          rejected_nodes: finalRejectedNodeIds.length,
          fixture_probes: probeTotals.fixtures,
          donor_probes: probeTotals.donor,
          mutation_probes: probeTotals.mutation,
          rollback_probes: probeTotals.rollback,
          runtime_inclusion_allowed: approved,
          deploy_allowed: false,
        },
        null,
        2
      )}\n`
    );
    if (!approved) process.exitCode = 1;
  } catch (error) {
    const report = buildFatalReport({
      candidatePath,
      fixturePath,
      candidateSha256: candidateArtifact?.byte_sha256 || null,
      fixtureSha256: fixtureArtifact?.byte_sha256 || null,
      error,
    });
    if (absolutePathLocations(report).length > 0) {
      report.formal_audit.errors = ["fatal_report_path_sanitization_failed"];
    }
    writeJsonAtomic(outputPath, report);
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        overall_decision: "REJECTED",
        error: sanitizedError(error),
        runtime_inclusion_allowed: false,
        deploy_allowed: false,
      })}\n`
    );
    process.exitCode = 1;
  }
}

main();
