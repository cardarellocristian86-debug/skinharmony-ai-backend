import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import zlib from "node:zlib";
import {
  RUNTIME_ARTIFACT_LIMITS,
  RUNTIME_BINDINGS_SCHEMA_VERSION,
  RUNTIME_MANIFEST_SCHEMA_VERSION,
  RUNTIME_SHARD_LAYOUT_SCHEMA_VERSION,
  RUNTIME_SHARD_SCHEMA_VERSION,
  RUNTIME_SOURCE_ARTIFACT_SCHEMA_VERSION,
  RUNTIME_SOURCE_ARTIFACTS_SCHEMA_VERSION,
  SUPERVISOR_BINDING_SCHEMA_VERSION,
  VALIDATION_BINDING_SCHEMA_VERSION,
  reconstructCatalogFromRuntimeArtifacts,
  runtimeShardSetHash,
  sha256,
  supervisorAttestationBinding,
  supervisorAttestationHash,
  validationAttestationBinding,
  verifyRuntimeArtifacts,
} from "../lib/nyra-deep-branch-v2-shards.mjs";

const PROMOTER_PATH = path.resolve("scripts/promote-nyra-deep-branch-v2.mjs");
const BRANCH_ID = "branch_a";
const SUBBRANCH_ID = "subbranch_a";
const CANDIDATE_FINGERPRINT = "a".repeat(64);
const CANDIDATE_BYTE_SHA256 = "b".repeat(64);
const FIXTURE_BYTE_SHA256 = "c".repeat(64);
const SOURCE_SNAPSHOT_SHA256 = "d".repeat(64);
const GENERATOR_SHA256 = "e".repeat(64);
const RUNTIME_SHA256 = "f".repeat(64);
const HASHES = Object.freeze({
  semantic: crypto.createHash("sha256").update("semantic").digest("hex"),
  execution: crypto.createHash("sha256").update("execution").digest("hex"),
  observation: crypto.createHash("sha256").update("observation").digest("hex"),
});

function tempDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function canonicalFingerprint(value, field) {
  const payload = { ...value };
  delete payload[field];
  return sha256(payload);
}

function makeFunctions() {
  const l2 = `${BRANCH_ID}.${SUBBRANCH_ID}.capability`;
  const l3 = `${l2}.micro`;
  const ids = [
    l2,
    l3,
    `${l3}.method`,
    `${l3}.strategy`,
    `${l3}.verifier`,
    `${l3}.metric`,
  ];
  return ids.map((functionId) => ({
    function_id: functionId,
    source_row_hash: sha256(`source:${functionId}`),
    semantic_function_hash: HASHES.semantic,
    execution_plan_hash: HASHES.execution,
    observation_contract_hash: HASHES.observation,
  }));
}

function makeRegistry() {
  const registry = {
    schema_version: "nyra_deep_branch_function_registry_v1",
    research_sha256: "1".repeat(64),
    source_snapshot_sha256: SOURCE_SNAPSHOT_SHA256,
    functions: makeFunctions(),
    registry_hash: "",
  };
  registry.registry_hash = canonicalFingerprint(registry, "registry_hash");
  return registry;
}

function makeNodes(registryHash, status = "APPROVED") {
  const l2 = `${BRANCH_ID}.${SUBBRANCH_ID}.capability`;
  const l3 = `${l2}.micro`;
  const l4 = [
    { id: `${l3}.method`, node_type: "method" },
    { id: `${l3}.strategy`, node_type: "strategy" },
    { id: `${l3}.verifier`, node_type: "verifier" },
    { id: `${l3}.metric`, node_type: "metric" },
  ];
  const common = {
    branch_id: BRANCH_ID,
    version: "2.0.0",
    supervisor_status: status,
    methods: [{ operation: "test_operation" }],
    function_binding: {
      registry_hash: registryHash,
      semantic_function_hash: HASHES.semantic,
      execution_plan_hash: HASHES.execution,
      observation_contract_hash: HASHES.observation,
    },
  };
  return [
    {
      ...common,
      id: l2,
      parent_id: `${BRANCH_ID}.${SUBBRANCH_ID}`,
      level: 2,
      node_type: "specialized_capability",
      children: [l3],
    },
    {
      ...common,
      id: l3,
      parent_id: l2,
      level: 3,
      node_type: "micro_capability",
      children: l4.map((node) => node.id),
    },
    ...l4.map((node) => ({
      ...common,
      ...node,
      parent_id: l3,
      level: 4,
      children: [],
    })),
  ];
}

function makeBranches() {
  return [{
    id: BRANCH_ID,
    label: "Branch A",
    work_phase: "test",
    core_branch_bindings: ["test"],
    domain_packs: ["skinharmony"],
    subbranches: [{
      id: SUBBRANCH_ID,
      parent_id: BRANCH_ID,
      branch_id: BRANCH_ID,
      level: 1,
      node_type: "subbranch",
      children: [`${BRANCH_ID}.${SUBBRANCH_ID}.capability`],
    }],
  }];
}

function makeSupervisorReport({
  candidateFingerprint = CANDIDATE_FINGERPRINT,
  candidateSha256 = CANDIDATE_BYTE_SHA256,
  fixtureSha256 = FIXTURE_BYTE_SHA256,
  registryHash,
  runtimeSha256 = RUNTIME_SHA256,
  generatorSha256 = GENERATOR_SHA256,
  nodeIds,
  generatedAt = "2026-07-27T12:00:00.000Z",
  candidatePath = "run-a/candidate.json",
  fixturePath = "run-a/fixtures.json",
} = {}) {
  return {
    schema_version: "nyra_deep_branch_v2_supervisor_decisions_v2",
    audit_pass: 9,
    report_kind: "independent_fail_closed_supervisor",
    generated_at: generatedAt,
    supervisor_authority: "independent_offline_supervisor",
    universal_core_final_authority: true,
    tenant_scope: {
      tenant_id: "codexai",
      cross_tenant_allowed: false,
    },
    candidate: {
      path: candidatePath,
      sha256: candidateSha256,
      byte_sha256_before: candidateSha256,
      byte_sha256_after: candidateSha256,
      byte_sha256_stable: true,
      fixture_path: fixturePath,
      fixture_sha256: fixtureSha256,
      fixture_byte_sha256_before: fixtureSha256,
      fixture_byte_sha256_after: fixtureSha256,
      fixture_byte_sha256_stable: true,
      catalog_fingerprint: candidateFingerprint,
      registry_hash: registryHash,
      runtime_sha256: runtimeSha256,
      generator_sha256: generatorSha256,
      research_sha256: "1".repeat(64),
      rollback_checkpoint: `sha256:${"2".repeat(64)}`,
      build_checkpoint: `sha256:${"3".repeat(64)}`,
      source_snapshot_sha256: SOURCE_SNAPSHOT_SHA256,
      candidate_supervisor_status: "PENDING",
      approved_by_this_report: true,
    },
    decision_summary: {
      overall_decision: "APPROVED",
      admission_policy: "unanimous_all_checks_required",
      branches_reviewed: 1,
      level_1_subbranches_reviewed: 1,
      candidate_nodes_reviewed: nodeIds.length,
      approved_nodes: nodeIds.length,
      rejected_nodes: 0,
      pending_nodes_after_review: 0,
      runtime_inclusion_allowed: true,
      deploy_allowed: false,
    },
    formal_audit: {
      completed: true,
      errors: [],
      input_stability: {
        candidate_byte_sha256_stable: true,
        fixture_byte_sha256_stable: true,
      },
    },
    approved_node_ids: [...nodeIds],
    rejected_node_ids: [],
    decisions: nodeIds.map((nodeId) => ({
      node_id: nodeId,
      branch_id: BRANCH_ID,
      decision: "APPROVED",
      supervisor_status: "APPROVED",
      checks: {
        supervisor_approval: true,
        all_required_checks_passed: true,
      },
      reasons: ["SUPERVISOR_ALL_REQUIRED_CHECKS_PASSED"],
      runtime_inclusion_allowed: true,
    })),
    release_gate: {
      deploy_allowed: false,
      deploy_authorized: false,
      merge_authorized: false,
      explicit_owner_confirmation_required: true,
      universal_core_verdict_required: "ALLOW",
    },
  };
}

function makePromotionInputs(directory) {
  const registry = makeRegistry();
  const nodes = makeNodes(registry.registry_hash, "PENDING");
  const candidate = {
    schema_version: "nyra_deep_branch_architecture_v2",
    version: "2.0.0",
    authority: "universal_core",
    rollback_checkpoint: `sha256:${"2".repeat(64)}`,
    build_checkpoint: `sha256:${"3".repeat(64)}`,
    research_sha256: "1".repeat(64),
    generator_sha256: GENERATOR_SHA256,
    runtime_sha256: RUNTIME_SHA256,
    confidence_calibration: {},
    catalog_fingerprint: "",
    source_catalog: {
      schema_version: "nyra_neural_branch_network_v1",
      captured_at: "2026-07-27T11:00:00.000Z",
      source: "https://example.invalid/branches",
      tenant_id: "codexai",
      domain_pack_id: "skinharmony",
      source_snapshot_sha256: SOURCE_SNAPSHOT_SHA256,
      branches: [{
        id: BRANCH_ID,
        label: "Branch A",
        work_phase: "test",
        core_branch_bindings: ["test"],
        subbranches: [SUBBRANCH_ID],
      }],
    },
    function_registry: registry,
    branches: makeBranches(),
    nodes,
  };
  candidate.catalog_fingerprint = canonicalFingerprint(candidate, "catalog_fingerprint");
  const fixtures = {
    schema_version: "nyra_deep_branch_v2_executable_fixtures_v1",
    catalog_fingerprint: candidate.catalog_fingerprint,
    fixture_count: 0,
    v1_goldens: {},
    confidence_calibration: {},
    fixtures: {},
  };
  const candidatePath = path.join(directory, "candidate.json");
  const fixturePath = path.join(directory, "fixtures.json");
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate)}\n`);
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixtures)}\n`);
  const report = makeSupervisorReport({
    candidateFingerprint: candidate.catalog_fingerprint,
    candidateSha256: sha256(fs.readFileSync(candidatePath)),
    fixtureSha256: sha256(fs.readFileSync(fixturePath)),
    registryHash: registry.registry_hash,
    nodeIds: nodes.map((node) => node.id),
  });
  return { candidate, fixtures, candidatePath, fixturePath, report };
}

function runPromotion(directory, inputs, report, label) {
  const supervisorPath = path.join(directory, `${label}-supervisor.json`);
  const outputRoot = path.join(directory, label);
  fs.mkdirSync(outputRoot);
  fs.writeFileSync(supervisorPath, `${JSON.stringify(report)}\n`);
  const outputs = {
    catalog: path.join(outputRoot, "catalog.json"),
    fixtures: path.join(outputRoot, "fixtures.json"),
    yaml: path.join(outputRoot, "catalog.yaml"),
    registry: path.join(outputRoot, "registry.json"),
    snapshot: path.join(outputRoot, "snapshot.json"),
    map: path.join(outputRoot, "map.md"),
  };
  const result = spawnSync(process.execPath, [
    PROMOTER_PATH,
    "--candidate", inputs.candidatePath,
    "--fixtures", inputs.fixturePath,
    "--supervisor", supervisorPath,
    "--catalog-output", outputs.catalog,
    "--fixtures-output", outputs.fixtures,
    "--yaml-output", outputs.yaml,
    "--registry-output", outputs.registry,
    "--snapshot-output", outputs.snapshot,
    "--map-output", outputs.map,
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  return { result, outputs };
}

function makeRuntimeCatalog() {
  const registry = makeRegistry();
  const nodes = makeNodes(registry.registry_hash);
  const supervisorReport = makeSupervisorReport({
    registryHash: registry.registry_hash,
    nodeIds: nodes.map((node) => node.id),
  });
  const supervisorBindingSha256 = supervisorAttestationHash(supervisorReport);
  const catalog = {
    schema_version: "nyra_deep_branch_architecture_v2",
    version: "2.0.0",
    authority: "universal_core",
    rollback_checkpoint: `sha256:${"2".repeat(64)}`,
    build_checkpoint: `sha256:${"3".repeat(64)}`,
    research_sha256: "1".repeat(64),
    generator_sha256: GENERATOR_SHA256,
    runtime_sha256: RUNTIME_SHA256,
    confidence_calibration: {},
    catalog_fingerprint: "",
    source_catalog: {
      schema_version: "nyra_neural_branch_network_v1",
      captured_at: "2026-07-27T11:00:00.000Z",
      source: "https://example.invalid/branches",
      tenant_id: "codexai",
      domain_pack_id: "skinharmony",
      source_snapshot_sha256: SOURCE_SNAPSHOT_SHA256,
      branches: [{
        id: BRANCH_ID,
        subbranches: [SUBBRANCH_ID],
      }],
    },
    function_registry: registry,
    branches: makeBranches(),
    nodes,
    supervisor_admission: {
      schema_version: supervisorReport.schema_version,
      binding_schema_version: SUPERVISOR_BINDING_SCHEMA_VERSION,
      audit_pass: 9,
      candidate_catalog_fingerprint: CANDIDATE_FINGERPRINT,
      candidate_byte_sha256: CANDIDATE_BYTE_SHA256,
      fixture_byte_sha256: FIXTURE_BYTE_SHA256,
      supervisor_binding_sha256: supervisorBindingSha256,
      supervisor_report_sha256: supervisorBindingSha256,
      approved_node_count: nodes.length,
      rejected_node_count: 0,
      runtime_inclusion_allowed: true,
    },
  };
  catalog.catalog_fingerprint = canonicalFingerprint(catalog, "catalog_fingerprint");
  return { catalog, supervisorReport };
}

function catalogTemplate(catalog) {
  return {
    ...structuredClone(catalog),
    nodes: [],
    function_registry: {
      ...structuredClone(catalog.function_registry),
      functions: [],
    },
  };
}

function nodeSummary(node) {
  return {
    id: node.id,
    parent_id: node.parent_id,
    branch_id: node.branch_id,
    subbranch_id: node.id.split(".")[1],
    level: node.level,
    node_type: node.node_type,
    version: node.version,
    supervisor_status: node.supervisor_status,
    semantic_function_hash: node.function_binding.semantic_function_hash,
  };
}

function sourceArtifact(artifactKind, bytes, catalogFingerprint, fixtureCount) {
  const descriptor = {
    schema_version: RUNTIME_SOURCE_ARTIFACT_SCHEMA_VERSION,
    artifact_kind: artifactKind,
    lifecycle: "ephemeral",
    ephemeral: true,
    committed: false,
    runtime_read_allowed: false,
    byte_sha256: sha256(bytes),
    byte_size: bytes.length,
    canonical_catalog_fingerprint: catalogFingerprint,
  };
  if (fixtureCount !== undefined) descriptor.fixture_count = fixtureCount;
  return descriptor;
}

function rehashManifest(manifest) {
  manifest.root_binding.shard_set_hash = runtimeShardSetHash(manifest.shards);
  manifest.root_binding_hash = sha256(manifest.root_binding);
  const payload = { ...manifest };
  delete payload.manifest_hash;
  manifest.manifest_hash = sha256(payload);
}

function writeManifest(filePath, manifest) {
  fs.writeFileSync(filePath, `${JSON.stringify(manifest)}\n`);
}

function writeShard(filePath, shard, descriptor) {
  const payload = { ...shard };
  delete payload.shard_hash;
  shard.shard_hash = sha256(payload);
  const uncompressed = Buffer.from(`${JSON.stringify(shard)}\n`);
  const compressed = zlib.gzipSync(uncompressed, { level: 9, mtime: 0 });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, compressed);
  Object.assign(descriptor, {
    compressed_sha256: sha256(compressed),
    compressed_bytes: compressed.length,
    uncompressed_sha256: sha256(uncompressed),
    uncompressed_bytes: uncompressed.length,
  });
}

function makeRuntimeArtifacts(t) {
  const directory = tempDirectory(t, "nyra-v2-shard-test-");
  const { catalog, supervisorReport } = makeRuntimeCatalog();
  const validationReport = {
    schema_version: "nyra_deep_branch_v2_validation_report_v1",
    ok: true,
    catalog_fingerprint: catalog.catalog_fingerprint,
    errors: [],
    validation: {
      ok: true,
      errors: [],
      metrics: {
        branch_count: 1,
        subbranch_count: 1,
        node_count: 6,
        rejected_node_count: 0,
        duplicate_contract_count: 0,
      },
    },
    supervisor: {
      approved_node_count: 6,
      rejected_node_count: 0,
    },
    executable_contract_tests: {},
    deep_routing: {
      selected_branch_count: 1,
      evaluated_node_count: 6,
      all_verified: true,
      core_final_authority: true,
      execution_authorized: false,
    },
    rollback_verified: true,
    release_gate: {
      deploy_authorized: false,
      merge_authorized: false,
      required_core_verdict: "ALLOW",
      explicit_owner_confirmation_required: true,
    },
  };
  const supervisorBinding = supervisorAttestationBinding(supervisorReport);
  const validationBinding = validationAttestationBinding(validationReport, catalog);
  const supervisorAttestation = {
    schema_version: supervisorReport.schema_version,
    binding_schema_version: SUPERVISOR_BINDING_SCHEMA_VERSION,
    audit_pass: 9,
    sha256: sha256(supervisorBinding),
    binding_sha256: sha256(supervisorBinding),
    candidate_catalog_fingerprint: CANDIDATE_FINGERPRINT,
    candidate_byte_sha256: CANDIDATE_BYTE_SHA256,
    fixture_byte_sha256: FIXTURE_BYTE_SHA256,
    approved_node_count: 6,
    rejected_node_count: 0,
    runtime_inclusion_allowed: true,
  };
  const validationAttestation = {
    schema_version: validationReport.schema_version,
    binding_schema_version: VALIDATION_BINDING_SCHEMA_VERSION,
    sha256: sha256(validationBinding),
    catalog_fingerprint: catalog.catalog_fingerprint,
    full_offline_validated: true,
    validated_branch_count: 1,
    validated_subbranch_count: 1,
    validated_node_count: 6,
    rejected_node_count: 0,
    duplicate_contract_count: 0,
    rollback_verified: true,
  };
  const catalogBinding = {
    catalog_fingerprint: catalog.catalog_fingerprint,
    function_registry_hash: catalog.function_registry.registry_hash,
    source_snapshot_sha256: SOURCE_SNAPSHOT_SHA256,
    supervisor_report_sha256: supervisorAttestation.sha256,
    supervisor_binding_schema_version: SUPERVISOR_BINDING_SCHEMA_VERSION,
    validation_attestation_sha256: validationAttestation.sha256,
    validation_binding_schema_version: VALIDATION_BINDING_SCHEMA_VERSION,
    rollback_checkpoint: catalog.rollback_checkpoint,
    catalog_runtime_sha256: RUNTIME_SHA256,
    runtime_loader_sha256: RUNTIME_SHA256,
    generator_sha256: GENERATOR_SHA256,
    catalog_schema_version: catalog.schema_version,
    catalog_version: catalog.version,
  };
  const catalogBindingHash = sha256(catalogBinding);
  const shard = {
    schema_version: RUNTIME_SHARD_SCHEMA_VERSION,
    catalog_binding_hash: catalogBindingHash,
    catalog_fingerprint: catalog.catalog_fingerprint,
    function_registry_hash: catalog.function_registry.registry_hash,
    branch_id: BRANCH_ID,
    subbranch_id: SUBBRANCH_ID,
    nodes: structuredClone(catalog.nodes),
    functions: structuredClone(catalog.function_registry.functions),
    shard_hash: "",
  };
  const descriptor = {
    branch_id: BRANCH_ID,
    subbranch_id: SUBBRANCH_ID,
    relative_path: path.posix.join(
      "shards",
      "v1",
      catalog.catalog_fingerprint,
      catalogBindingHash,
      `${BRANCH_ID}--${SUBBRANCH_ID}.json.gz`
    ),
    compressed_sha256: "",
    uncompressed_sha256: "",
    compressed_bytes: 0,
    uncompressed_bytes: 0,
    node_count: 6,
    function_count: 6,
    node_ids: catalog.nodes.map((node) => node.id),
  };
  const shardPath = path.join(directory, ...descriptor.relative_path.split("/"));
  writeShard(shardPath, shard, descriptor);
  const monolith = sourceArtifact(
    "catalog_monolith",
    Buffer.from(JSON.stringify(catalog)),
    catalog.catalog_fingerprint
  );
  const fixtures = sourceArtifact(
    "fixture_bundle",
    Buffer.from('{"fixtures":{}}'),
    catalog.catalog_fingerprint,
    0
  );
  const manifest = {
    schema_version: RUNTIME_MANIFEST_SCHEMA_VERSION,
    limits: RUNTIME_ARTIFACT_LIMITS,
    bindings: {
      schema_version: RUNTIME_BINDINGS_SCHEMA_VERSION,
      catalog: catalogBinding,
      supervisor: supervisorBinding,
      validation: validationBinding,
    },
    catalog_binding_hash: catalogBindingHash,
    root_binding: {
      ...catalogBinding,
      shard_set_hash: runtimeShardSetHash([descriptor]),
    },
    root_binding_hash: "",
    shard_layout: {
      schema_version: RUNTIME_SHARD_LAYOUT_SCHEMA_VERSION,
      relative_root: "shards",
      generation: "v1",
    },
    runtime_source_artifacts: {
      schema_version: RUNTIME_SOURCE_ARTIFACTS_SCHEMA_VERSION,
      monolith,
      fixtures,
    },
    offline_audit_artifact: monolith,
    offline_fixture_artifact: fixtures,
    supervisor_attestation: supervisorAttestation,
    validation_attestation: validationAttestation,
    catalog: catalogTemplate(catalog),
    function_registry: {
      schema_version: catalog.function_registry.schema_version,
      registry_hash: catalog.function_registry.registry_hash,
      function_count: 6,
    },
    topology: {
      branch_count: 1,
      subbranch_count: 1,
      node_count: 6,
      node_summaries: catalog.nodes.map(nodeSummary),
    },
    shard_totals: {
      shard_count: 1,
      compressed_bytes: descriptor.compressed_bytes,
      uncompressed_bytes: descriptor.uncompressed_bytes,
    },
    shards: [descriptor],
    manifest_hash: "",
  };
  rehashManifest(manifest);
  const manifestPath = path.join(directory, "manifest.json");
  writeManifest(manifestPath, manifest);
  return { catalog, descriptor, directory, manifest, manifestPath, shard, shardPath };
}

test("Supervisor binding ignores generated_at and informational paths only", () => {
  const registry = makeRegistry();
  const nodeIds = makeNodes(registry.registry_hash).map((node) => node.id);
  const first = makeSupervisorReport({ registryHash: registry.registry_hash, nodeIds });
  const equivalent = structuredClone(first);
  equivalent.generated_at = "2099-01-01T00:00:00.000Z";
  equivalent.candidate.path = "other/candidate.json";
  equivalent.candidate.fixture_path = "other/fixtures.json";
  assert.deepEqual(
    supervisorAttestationBinding(first),
    supervisorAttestationBinding(equivalent)
  );
  const changed = structuredClone(first);
  changed.decisions[0].runtime_inclusion_allowed = false;
  assert.notEqual(supervisorAttestationHash(first), supervisorAttestationHash(changed));
});

test("promoter verifies byte SHA-256 and remains stable across equivalent reports", (t) => {
  const directory = tempDirectory(t, "nyra-v2-promotion-test-");
  const inputs = makePromotionInputs(directory);
  const first = runPromotion(directory, inputs, inputs.report, "first");
  assert.equal(first.result.status, 0, first.result.stderr);
  const equivalent = structuredClone(inputs.report);
  equivalent.generated_at = "2099-01-01T00:00:00.000Z";
  equivalent.candidate.path = "other/candidate.json";
  equivalent.candidate.fixture_path = "other/fixtures.json";
  const second = runPromotion(directory, inputs, equivalent, "second");
  assert.equal(second.result.status, 0, second.result.stderr);
  assert.deepEqual(
    fs.readFileSync(first.outputs.catalog),
    fs.readFileSync(second.outputs.catalog)
  );
  const mismatch = structuredClone(inputs.report);
  mismatch.candidate.sha256 = "0".repeat(64);
  const rejected = runPromotion(directory, inputs, mismatch, "rejected");
  assert.notEqual(rejected.result.status, 0);
  assert.match(rejected.result.stderr, /Candidate byte SHA-256/);
  assert.equal(fs.existsSync(rejected.outputs.catalog), false);
});

test("shard-set identity includes compressed hash and compressed bytes", () => {
  const descriptor = {
    branch_id: BRANCH_ID,
    subbranch_id: SUBBRANCH_ID,
    relative_path: "shards/example.json.gz",
    compressed_sha256: "1".repeat(64),
    compressed_bytes: 100,
    uncompressed_sha256: "2".repeat(64),
    uncompressed_bytes: 200,
    node_count: 6,
    function_count: 6,
    node_ids: ["a", "b", "c", "d", "e", "f"],
  };
  const baseline = runtimeShardSetHash([descriptor]);
  assert.notEqual(
    baseline,
    runtimeShardSetHash([{ ...descriptor, compressed_sha256: "3".repeat(64) }])
  );
  assert.notEqual(
    baseline,
    runtimeShardSetHash([{ ...descriptor, compressed_bytes: 101 }])
  );
});

test("reconstruct verifies complete valid runtime artifacts", (t) => {
  const artifacts = makeRuntimeArtifacts(t);
  const verified = verifyRuntimeArtifacts({ manifestPath: artifacts.manifestPath });
  assert.equal(verified.ok, true);
  assert.deepEqual(
    reconstructCatalogFromRuntimeArtifacts({ manifestPath: artifacts.manifestPath }),
    artifacts.catalog
  );
});

test("reconstruct rejects a rehashed path traversal", (t) => {
  const artifacts = makeRuntimeArtifacts(t);
  artifacts.manifest.shards[0].relative_path = "../escape.json.gz";
  rehashManifest(artifacts.manifest);
  writeManifest(artifacts.manifestPath, artifacts.manifest);
  assert.throws(
    () => reconstructCatalogFromRuntimeArtifacts({ manifestPath: artifacts.manifestPath }),
    /Unsafe or non-canonical shard path/
  );
});

test("reconstruct rejects compressed byte tampering", (t) => {
  const artifacts = makeRuntimeArtifacts(t);
  const compressed = fs.readFileSync(artifacts.shardPath);
  compressed[compressed.length - 1] ^= 0xff;
  fs.writeFileSync(artifacts.shardPath, compressed);
  assert.throws(
    () => reconstructCatalogFromRuntimeArtifacts({ manifestPath: artifacts.manifestPath }),
    /Compressed shard hash mismatch/
  );
});

test("reconstruct rejects rehashed size/ratio and lineage tampering", async (t) => {
  await t.test("compression ratio", () => {
    const artifacts = makeRuntimeArtifacts(t);
    artifacts.manifest.shards[0].compressed_bytes = 1;
    rehashManifest(artifacts.manifest);
    writeManifest(artifacts.manifestPath, artifacts.manifest);
    assert.throws(
      () => reconstructCatalogFromRuntimeArtifacts({ manifestPath: artifacts.manifestPath }),
      /compression ratio limit exceeded/
    );
  });
  await t.test("lineage", () => {
    const artifacts = makeRuntimeArtifacts(t);
    artifacts.shard.nodes[2].parent_id = "wrong.parent";
    writeShard(artifacts.shardPath, artifacts.shard, artifacts.manifest.shards[0]);
    artifacts.manifest.shard_totals.compressed_bytes =
      artifacts.manifest.shards[0].compressed_bytes;
    artifacts.manifest.shard_totals.uncompressed_bytes =
      artifacts.manifest.shards[0].uncompressed_bytes;
    rehashManifest(artifacts.manifest);
    writeManifest(artifacts.manifestPath, artifacts.manifest);
    assert.throws(
      () => reconstructCatalogFromRuntimeArtifacts({ manifestPath: artifacts.manifestPath }),
      /parent\/child lineage mismatch/
    );
  });
  await t.test("node ids", () => {
    const artifacts = makeRuntimeArtifacts(t);
    artifacts.manifest.shards[0].node_ids[0] = "wrong.node";
    rehashManifest(artifacts.manifest);
    writeManifest(artifacts.manifestPath, artifacts.manifest);
    assert.throws(
      () => reconstructCatalogFromRuntimeArtifacts({ manifestPath: artifacts.manifestPath }),
      /Shard node ids mismatch/
    );
  });
});

test("reconstruct rejects manifest and root binding tampering", async (t) => {
  await t.test("manifest hash", () => {
    const artifacts = makeRuntimeArtifacts(t);
    artifacts.manifest.topology.node_count = 7;
    writeManifest(artifacts.manifestPath, artifacts.manifest);
    assert.throws(
      () => reconstructCatalogFromRuntimeArtifacts({ manifestPath: artifacts.manifestPath }),
      /Runtime manifest hash mismatch/
    );
  });
  await t.test("root binding", () => {
    const artifacts = makeRuntimeArtifacts(t);
    artifacts.manifest.root_binding.catalog_version = "tampered";
    artifacts.manifest.root_binding_hash = sha256(artifacts.manifest.root_binding);
    const payload = { ...artifacts.manifest };
    delete payload.manifest_hash;
    artifacts.manifest.manifest_hash = sha256(payload);
    writeManifest(artifacts.manifestPath, artifacts.manifest);
    assert.throws(
      () => reconstructCatalogFromRuntimeArtifacts({ manifestPath: artifacts.manifestPath }),
      /Runtime root binding mismatch/
    );
  });
});
