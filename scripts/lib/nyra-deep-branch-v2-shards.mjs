import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { nyraBranchCatalog } from "../../services/universal-core-service/src/nyraBranchNetwork.js";

export const RUNTIME_MANIFEST_SCHEMA_VERSION = "nyra_deep_branch_runtime_manifest_v1";
export const RUNTIME_SHARD_SCHEMA_VERSION = "nyra_deep_branch_runtime_shard_v1";
export const SUPERVISOR_BINDING_SCHEMA_VERSION =
  "nyra_deep_branch_v2_supervisor_binding_v1";
export const VALIDATION_BINDING_SCHEMA_VERSION =
  "nyra_deep_branch_v2_validation_binding_v1";
export const RUNTIME_BINDINGS_SCHEMA_VERSION =
  "nyra_deep_branch_v2_runtime_bindings_v1";
export const RUNTIME_LIMITS_SCHEMA_VERSION =
  "nyra_deep_branch_v2_runtime_limits_v1";
export const RUNTIME_SOURCE_ARTIFACTS_SCHEMA_VERSION =
  "nyra_deep_branch_v2_runtime_source_artifacts_v1";
export const RUNTIME_SOURCE_ARTIFACT_SCHEMA_VERSION =
  "nyra_deep_branch_v2_runtime_source_artifact_v1";
export const RUNTIME_SHARD_LAYOUT_SCHEMA_VERSION =
  "nyra_deep_branch_v2_runtime_shard_layout_v1";
export const MAX_RUNTIME_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_RUNTIME_SHARD_COMPRESSED_BYTES = 256 * 1024;
export const MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES = 1024 * 1024;
export const MAX_RUNTIME_SHARD_COMPRESSION_RATIO = 16;
export const MAX_RUNTIME_SHARDS_COMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

const LEVEL4_NODE_TYPES = Object.freeze(["method", "strategy", "verifier", "metric"]);
const NODES_PER_SUBBRANCH = 2 + LEVEL4_NODE_TYPES.length;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const RUNTIME_ARTIFACT_LIMITS = Object.freeze({
  schema_version: RUNTIME_LIMITS_SCHEMA_VERSION,
  manifest_max_bytes: MAX_RUNTIME_MANIFEST_BYTES,
  shard_max_compressed_bytes: MAX_RUNTIME_SHARD_COMPRESSED_BYTES,
  shard_max_uncompressed_bytes: MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES,
  shard_max_compression_ratio: MAX_RUNTIME_SHARD_COMPRESSION_RATIO,
  shard_set_max_compressed_bytes: MAX_RUNTIME_SHARDS_COMPRESSED_BYTES,
  shard_set_max_uncompressed_bytes: MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES,
  compression: Object.freeze({
    algorithm: "gzip",
    level: 9,
    mtime: 0,
  }),
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

export function sha256(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : JSON.stringify(canonicalize(value));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function requireSha256(value, label) {
  invariant(SHA256_PATTERN.test(String(value || "")), `${label} must be a canonical SHA-256`);
  return String(value);
}

function catalogFingerprint(catalog) {
  const payload = { ...catalog };
  delete payload.catalog_fingerprint;
  return sha256(payload);
}

function functionRegistryHash(registry) {
  const payload = { ...registry };
  delete payload.registry_hash;
  return sha256(payload);
}

function toPosixPath(value) {
  return String(value).split(path.sep).join("/");
}

function atomicWriteFile(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporaryPath, bytes);
  fs.renameSync(temporaryPath, filePath);
}

export function pruneStaleShardGenerations({
  shardRoot,
  catalogFingerprint,
  currentCatalogBindingHash,
  expectedShardCount,
} = {}) {
  const hexDigest = /^[a-f0-9]{64}$/;
  if (!hexDigest.test(String(catalogFingerprint || ""))) {
    throw new Error("A canonical 64-hex catalog fingerprint is required for shard cleanup");
  }
  if (!hexDigest.test(String(currentCatalogBindingHash || ""))) {
    throw new Error("A canonical 64-hex catalog binding hash is required for shard cleanup");
  }
  if (!Number.isSafeInteger(expectedShardCount) || expectedShardCount <= 0) {
    throw new Error("A positive expected shard count is required for shard cleanup");
  }
  const generatedRoot = path.resolve(shardRoot);
  const catalogRoot = path.resolve(generatedRoot, "v1", catalogFingerprint);
  if (!catalogRoot.startsWith(`${generatedRoot}${path.sep}`) || !fs.existsSync(catalogRoot)) {
    throw new Error("Generated catalog shard root is unavailable or outside the allowed root");
  }
  const removedGenerations = [];
  for (const entry of fs.readdirSync(catalogRoot, { withFileTypes: true })) {
    if (
      !entry.isDirectory()
      || entry.isSymbolicLink()
      || !hexDigest.test(entry.name)
      || entry.name === currentCatalogBindingHash
    ) continue;
    const generationPath = path.resolve(catalogRoot, entry.name);
    if (
      path.dirname(generationPath) !== catalogRoot
      || !generationPath.startsWith(`${generatedRoot}${path.sep}`)
    ) throw new Error(`Refusing unsafe shard generation cleanup path: ${generationPath}`);
    fs.rmSync(generationPath, { recursive: true, force: false });
    removedGenerations.push(entry.name);
  }
  const retainedGenerations = fs.readdirSync(catalogRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && hexDigest.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const currentGenerationPath = path.resolve(catalogRoot, currentCatalogBindingHash);
  const currentEntries = fs.readdirSync(currentGenerationPath, { withFileTypes: true });
  const shardFiles = currentEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json.gz"));
  if (
    retainedGenerations.length !== 1
    || retainedGenerations[0] !== currentCatalogBindingHash
    || currentEntries.length !== expectedShardCount
    || shardFiles.length !== expectedShardCount
  ) {
    throw new Error(
      `Runtime shard generation invariant failed: generations=${retainedGenerations.length} files=${shardFiles.length}`
    );
  }
  return {
    retained_generation: currentCatalogBindingHash,
    retained_generation_count: retainedGenerations.length,
    shard_file_count: shardFiles.length,
    removed_generation_count: removedGenerations.length,
    removed_generations: removedGenerations.sort(),
  };
}

function safeSegment(value) {
  const segment = String(value || "").toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(segment)) {
    throw new Error(`Unsafe shard path segment: ${value}`);
  }
  return segment;
}

function normalizeSupervisorSemanticValue(value, key = "") {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeSupervisorSemanticValue(item));
    if (["approved_node_ids", "rejected_node_ids", "reasons", "errors"].includes(key)) {
      return normalized.sort((left, right) => (
        JSON.stringify(canonicalize(left)).localeCompare(JSON.stringify(canonicalize(right)))
      ));
    }
    if (key === "decisions") {
      return normalized.sort((left, right) => (
        String(left?.node_id || "").localeCompare(String(right?.node_id || ""))
      ));
    }
    if (key === "per_branch_review") {
      return normalized.sort((left, right) => (
        String(left?.branch_id || "").localeCompare(String(right?.branch_id || ""))
      ));
    }
    return normalized;
  }
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((childKey) => (
        childKey !== "generated_at"
        && childKey !== "path"
        && !childKey.endsWith("_path")
      ))
      .sort()
      .map((childKey) => [
        childKey,
        normalizeSupervisorSemanticValue(value[childKey], childKey),
      ])
  );
}

function sortedStrings(value) {
  return Array.isArray(value) ? value.map(String).sort() : [];
}

/**
 * Stable, path-independent Supervisor identity.
 *
 * The complete semantic report is covered by semantic_report_sha256, while
 * generated_at and informational path fields are deliberately excluded. The
 * remaining named fields make the binding inspectable without embedding every
 * per-node check in the runtime manifest.
 */
export function supervisorAttestationBinding(supervisor) {
  const report = isPlainObject(supervisor) ? supervisor : {};
  const candidate = isPlainObject(report.candidate) ? report.candidate : {};
  const summary = isPlainObject(report.decision_summary)
    ? report.decision_summary
    : (isPlainObject(report.summary) ? report.summary : {});
  const decisions = Array.isArray(report.decisions) ? report.decisions : [];
  const approvedNodeIds = sortedStrings(report.approved_node_ids);
  const rejectedNodeIds = sortedStrings(report.rejected_node_ids);
  const semanticReport = normalizeSupervisorSemanticValue(report);
  return {
    schema_version: SUPERVISOR_BINDING_SCHEMA_VERSION,
    supervisor_report_schema_version: report.schema_version ?? null,
    audit_pass: report.audit_pass ?? report.pass ?? null,
    report_kind: report.report_kind ?? null,
    authority: {
      supervisor: report.supervisor_authority ?? null,
      universal_core_final_authority:
        report.universal_core_final_authority === true,
    },
    tenant_scope: {
      tenant_id: report?.tenant_scope?.tenant_id ?? null,
      cross_tenant_allowed:
        report?.tenant_scope?.cross_tenant_allowed === true,
    },
    candidate: {
      byte_sha256: candidate.sha256 ?? null,
      fixture_byte_sha256: candidate.fixture_sha256 ?? null,
      catalog_fingerprint: candidate.catalog_fingerprint ?? null,
      function_registry_hash: candidate.registry_hash ?? null,
      runtime_sha256: candidate.runtime_sha256 ?? null,
      generator_sha256: candidate.generator_sha256 ?? null,
      research_sha256: candidate.research_sha256 ?? null,
      rollback_checkpoint: candidate.rollback_checkpoint ?? null,
      build_checkpoint: candidate.build_checkpoint ?? null,
      source_snapshot_sha256: candidate.source_snapshot_sha256 ?? null,
      candidate_supervisor_status:
        candidate.candidate_supervisor_status ?? null,
    },
    decision: {
      overall_decision:
        summary.overall_decision ?? summary.decision ?? null,
      admission_policy: summary.admission_policy ?? null,
      candidate_nodes_reviewed:
        summary.candidate_nodes_reviewed ?? summary.nodes_total ?? null,
      approved_nodes: summary.approved_nodes ?? null,
      rejected_nodes: summary.rejected_nodes ?? null,
      runtime_inclusion_allowed:
        summary.runtime_inclusion_allowed === true,
      deploy_allowed: summary.deploy_allowed === true,
    },
    release_gate: {
      deploy_allowed: report?.release_gate?.deploy_allowed === true,
      deploy_authorized:
        report?.release_gate?.deploy_authorized === true,
      merge_authorized: report?.release_gate?.merge_authorized === true,
      explicit_owner_confirmation_required:
        report?.release_gate?.explicit_owner_confirmation_required === true,
      universal_core_verdict_required:
        report?.release_gate?.universal_core_verdict_required ?? null,
    },
    approved_node_count: approvedNodeIds.length,
    rejected_node_count: rejectedNodeIds.length,
    approved_node_ids_sha256: sha256(approvedNodeIds),
    rejected_node_ids_sha256: sha256(rejectedNodeIds),
    decision_set_sha256: sha256(
      normalizeSupervisorSemanticValue(decisions, "decisions")
    ),
    semantic_report_sha256: sha256(semanticReport),
  };
}

export function supervisorAttestationHash(supervisor) {
  return sha256(supervisorAttestationBinding(supervisor));
}

/**
 * Immutable projection of a validation report used to bind runtime artifacts.
 *
 * Operational measurements, timestamps and report paths are deliberately not
 * part of this projection. They are useful release evidence, but including
 * them would regenerate a byte-identical runtime catalog on every benchmark
 * run and make the shard identity non-reproducible.
 */
export function validationAttestationBinding(validationReport, catalog) {
  const report = validationReport && typeof validationReport === "object" ? validationReport : {};
  const metrics = report?.validation?.metrics || {};
  const contractTests = report?.executable_contract_tests || {};
  const contractSummary = Object.fromEntries(Object.keys(contractTests).sort().map((name) => {
    const result = contractTests[name] && typeof contractTests[name] === "object" ? contractTests[name] : {};
    return [name, {
      executed: Number(result.executed || 0),
      passed: Number(result.passed || 0),
      failed: Number(result.failed || 0),
    }];
  }));
  return {
    schema_version: VALIDATION_BINDING_SCHEMA_VERSION,
    validation_report_schema_version: String(report.schema_version || ""),
    catalog_fingerprint: String(report.catalog_fingerprint || ""),
    validation: {
      ok: report?.validation?.ok === true,
      errors: Array.isArray(report?.validation?.errors) ? [...report.validation.errors] : [],
      branch_count: Number(metrics.branch_count || 0),
      subbranch_count: Number(metrics.subbranch_count || 0),
      node_count: Number(metrics.node_count || 0),
      rejected_node_count: Number(metrics.rejected_node_count || 0),
      duplicate_contract_count: Number(metrics.duplicate_contract_count || 0),
    },
    report_errors: Array.isArray(report.errors) ? [...report.errors] : [],
    supervisor: {
      approved_node_count: Number(report?.supervisor?.approved_node_count || 0),
      rejected_node_count: Number(report?.supervisor?.rejected_node_count || 0),
    },
    executable_contract_tests: contractSummary,
    deep_routing: {
      selected_branch_count: Number(report?.deep_routing?.selected_branch_count || 0),
      evaluated_node_count: Number(report?.deep_routing?.evaluated_node_count || 0),
      all_verified: report?.deep_routing?.all_verified === true,
      core_final_authority: report?.deep_routing?.core_final_authority === true,
      execution_authorized: report?.deep_routing?.execution_authorized === true,
    },
    rollback_verified: report?.rollback_verified === true,
    release_gate: {
      deploy_authorized: report?.release_gate?.deploy_authorized === true,
      merge_authorized: report?.release_gate?.merge_authorized === true,
      required_core_verdict: String(report?.release_gate?.required_core_verdict || ""),
      explicit_owner_confirmation_required: report?.release_gate?.explicit_owner_confirmation_required === true,
    },
    expected_catalog: {
      branch_count: Array.isArray(catalog?.branches) ? catalog.branches.length : 0,
      subbranch_count: Array.isArray(catalog?.branches)
        ? catalog.branches.reduce((sum, branch) => sum + (Array.isArray(branch?.subbranches) ? branch.subbranches.length : 0), 0)
        : 0,
      node_count: Array.isArray(catalog?.nodes) ? catalog.nodes.length : 0,
    },
  };
}

export function validationAttestationHash(validationReport, catalog) {
  return sha256(validationAttestationBinding(validationReport, catalog));
}

function validationAttestation(validationReport, catalog) {
  const metrics = validationReport?.validation?.metrics || {};
  const valid = validationReport?.ok === true
    && validationReport?.validation?.ok === true
    && Array.isArray(validationReport?.errors)
    && validationReport.errors.length === 0
    && Array.isArray(validationReport?.validation?.errors)
    && validationReport.validation.errors.length === 0
    && validationReport.catalog_fingerprint === catalog.catalog_fingerprint
    && metrics.branch_count === catalog.branches.length
    && metrics.subbranch_count === catalog.branches.reduce(
      (sum, branch) => sum + branch.subbranches.length,
      0
    )
    && metrics.node_count === catalog.nodes.length
    && validationReport?.supervisor?.approved_node_count === catalog.nodes.length
    && validationReport?.supervisor?.rejected_node_count === 0
    && validationReport?.rollback_verified === true
    && validationReport?.release_gate?.deploy_authorized === false
    && validationReport?.release_gate?.explicit_owner_confirmation_required === true;
  if (!valid) throw new Error("Validation attestation is not a full approved offline validation");
  return {
    schema_version: validationReport.schema_version,
    binding_schema_version: VALIDATION_BINDING_SCHEMA_VERSION,
    sha256: validationAttestationHash(validationReport, catalog),
    catalog_fingerprint: validationReport.catalog_fingerprint,
    full_offline_validated: true,
    validated_branch_count: metrics.branch_count,
    validated_subbranch_count: metrics.subbranch_count,
    validated_node_count: metrics.node_count,
    rejected_node_count: metrics.rejected_node_count,
    duplicate_contract_count: metrics.duplicate_contract_count,
    rollback_verified: true,
  };
}

function supervisorAttestation(supervisor, catalog) {
  const admission = catalog?.supervisor_admission || {};
  const binding = supervisorAttestationBinding(supervisor);
  const bindingHash = sha256(binding);
  const expectedHash =
    admission.supervisor_binding_sha256
    || admission.supervisor_report_sha256;
  const summary = supervisor?.decision_summary || supervisor?.summary || {};
  const decisions = Array.isArray(supervisor?.decisions) ? supervisor.decisions : [];
  const decisionById = new Map(
    decisions.map((decision) => [decision?.node_id, decision])
  );
  const catalogNodeIds = catalog.nodes.map((node) => node.id);
  const approvedNodeIds = sortedStrings(supervisor?.approved_node_ids);
  const valid = expectedHash === bindingHash
    && (
      admission.supervisor_binding_sha256 === undefined
      || admission.supervisor_binding_sha256 === bindingHash
    )
    && (
      admission.supervisor_report_sha256 === undefined
      || admission.supervisor_report_sha256 === bindingHash
    )
    && admission.binding_schema_version === SUPERVISOR_BINDING_SCHEMA_VERSION
    && summary.overall_decision === "APPROVED"
    && summary.runtime_inclusion_allowed === true
    && summary.approved_nodes === catalog.nodes.length
    && summary.rejected_nodes === 0
    && decisions.length === catalog.nodes.length
    && decisionById.size === catalog.nodes.length
    && catalogNodeIds.every((nodeId) => {
      const decision = decisionById.get(nodeId);
      return decision?.decision === "APPROVED"
        && decision?.checks?.all_required_checks_passed === true
        && decision?.runtime_inclusion_allowed === true;
    })
    && (
      approvedNodeIds.length === 0
      || canonicalEqual(approvedNodeIds, [...catalogNodeIds].sort())
    )
    && (!Array.isArray(supervisor?.rejected_node_ids)
      || supervisor.rejected_node_ids.length === 0)
    && admission.runtime_inclusion_allowed === true
    && admission.approved_node_count === catalog.nodes.length
    && admission.rejected_node_count === 0
    && supervisor?.candidate?.catalog_fingerprint
      === admission.candidate_catalog_fingerprint
    && supervisor?.candidate?.sha256 === admission.candidate_byte_sha256
    && supervisor?.candidate?.fixture_sha256 === admission.fixture_byte_sha256;
  if (!valid) throw new Error("Supervisor attestation does not match the promoted catalog");
  return {
    schema_version: supervisor.schema_version,
    binding_schema_version: SUPERVISOR_BINDING_SCHEMA_VERSION,
    audit_pass: supervisor.audit_pass || supervisor.pass || admission.audit_pass,
    sha256: bindingHash,
    binding_sha256: bindingHash,
    candidate_catalog_fingerprint: admission.candidate_catalog_fingerprint,
    candidate_byte_sha256: admission.candidate_byte_sha256,
    fixture_byte_sha256: admission.fixture_byte_sha256,
    approved_node_count: catalog.nodes.length,
    rejected_node_count: 0,
    runtime_inclusion_allowed: true,
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

function catalogTemplate(catalog) {
  return {
    schema_version: catalog.schema_version,
    version: catalog.version,
    authority: catalog.authority,
    rollback_checkpoint: catalog.rollback_checkpoint,
    build_checkpoint: catalog.build_checkpoint,
    research_sha256: catalog.research_sha256,
    generator_sha256: catalog.generator_sha256,
    runtime_sha256: catalog.runtime_sha256,
    confidence_calibration: catalog.confidence_calibration,
    catalog_fingerprint: catalog.catalog_fingerprint,
    source_catalog: catalog.source_catalog,
    function_registry: {
      schema_version: catalog.function_registry.schema_version,
      research_sha256: catalog.function_registry.research_sha256,
      source_snapshot_sha256: catalog.function_registry.source_snapshot_sha256,
      functions: [],
      registry_hash: catalog.function_registry.registry_hash,
    },
    branches: catalog.branches,
    nodes: [],
    supervisor_admission: catalog.supervisor_admission,
  };
}

function exactNodeCoverage(catalog) {
  invariant(isPlainObject(catalog), "Runtime catalog must be an object");
  invariant(Array.isArray(catalog.nodes), "Runtime catalog nodes must be an array");
  invariant(Array.isArray(catalog.branches), "Runtime catalog branches must be an array");
  invariant(
    isPlainObject(catalog.function_registry)
      && Array.isArray(catalog.function_registry.functions),
    "Runtime function registry must be complete"
  );
  requireSha256(catalog.catalog_fingerprint, "Catalog fingerprint");
  requireSha256(catalog.function_registry.registry_hash, "Function registry hash");
  invariant(
    catalog.catalog_fingerprint === catalogFingerprint(catalog),
    "Runtime catalog fingerprint mismatch"
  );
  invariant(
    catalog.function_registry.registry_hash
      === functionRegistryHash(catalog.function_registry),
    "Runtime function registry hash mismatch"
  );
  const nodeIds = catalog.nodes.map((node) => node.id);
  const functionIds = catalog.function_registry.functions.map((spec) => spec.function_id);
  const domainPackId = String(catalog?.source_catalog?.domain_pack_id || "");
  if (domainPackId !== "skinharmony") {
    throw new Error(`Expected the skinharmony Core topology, received ${domainPackId || "missing"}`);
  }
  const coreTopology = nyraBranchCatalog(domainPackId);
  const topologyProjection = (branches) => branches.map((branch) => ({
    id: branch.id,
    subbranches: branch.subbranches.map((subbranch) => (
      typeof subbranch === "string" ? subbranch : subbranch.id
    )),
  }));
  const expectedTopology = topologyProjection(coreTopology.branches);
  const actualTopology = topologyProjection(catalog.branches);
  const branchCount = actualTopology.length;
  const subbranchCount = actualTopology.reduce(
    (sum, branch) => sum + branch.subbranches.length,
    0
  );
  const expectedNodeCount = subbranchCount * NODES_PER_SUBBRANCH;
  if (JSON.stringify(actualTopology) !== JSON.stringify(expectedTopology)) {
    throw new Error(
      `Unexpected topology ${branchCount}/${subbranchCount}; Core exposes `
      + `${expectedTopology.length}/${expectedTopology.reduce(
        (sum, branch) => sum + branch.subbranches.length,
        0
      )}`
    );
  }
  if (nodeIds.length !== expectedNodeCount || new Set(nodeIds).size !== nodeIds.length) {
    throw new Error(
      `Expected ${expectedNodeCount} unique approved nodes, received ${nodeIds.length}`
    );
  }
  if (
    functionIds.length !== nodeIds.length
    || new Set(functionIds).size !== functionIds.length
    || nodeIds.some((id) => !functionIds.includes(id))
  ) {
    throw new Error("Function registry does not cover every node exactly once");
  }
  if (catalog.nodes.some((node) => node.supervisor_status !== "APPROVED")) {
    throw new Error("Every runtime node must be Supervisor APPROVED");
  }
}

function inferredFixturePath(catalogPath) {
  const suffix = ".catalog.json";
  const value = String(catalogPath || "");
  return value.endsWith(suffix)
    ? `${value.slice(0, -suffix.length)}.fixtures.json`
    : null;
}

function safeRelativeRoot(manifestPath, shardRoot) {
  const manifestDirectory = path.resolve(path.dirname(manifestPath));
  const absoluteShardRoot = path.resolve(shardRoot);
  const relativeRoot = toPosixPath(path.relative(manifestDirectory, absoluteShardRoot));
  const segments = relativeRoot.split("/");
  invariant(
    relativeRoot.length > 0
      && relativeRoot !== "."
      && !path.posix.isAbsolute(relativeRoot)
      && !relativeRoot.includes("\\")
      && segments.every((segment) => segment && segment !== "." && segment !== ".."),
    "Runtime shard root must be a safe descendant of the manifest directory"
  );
  invariant(
    absoluteShardRoot.startsWith(`${manifestDirectory}${path.sep}`),
    "Runtime shard root escapes the manifest directory"
  );
  return relativeRoot;
}

function ephemeralSourceArtifact({
  artifactKind,
  bytes,
  catalogFingerprint: fingerprint,
  fixtureCount,
}) {
  const descriptor = {
    schema_version: RUNTIME_SOURCE_ARTIFACT_SCHEMA_VERSION,
    artifact_kind: artifactKind,
    lifecycle: "ephemeral",
    ephemeral: true,
    committed: false,
    runtime_read_allowed: false,
    byte_sha256: sha256(bytes),
    byte_size: bytes.length,
    canonical_catalog_fingerprint: fingerprint,
  };
  if (fixtureCount !== undefined) descriptor.fixture_count = fixtureCount;
  return descriptor;
}

function buildCatalogBinding({
  catalog,
  supervisor,
  validation,
  runtimeLoaderSha256,
}) {
  return {
    catalog_fingerprint: catalog.catalog_fingerprint,
    function_registry_hash: catalog.function_registry.registry_hash,
    source_snapshot_sha256: catalog.source_catalog.source_snapshot_sha256,
    supervisor_report_sha256: supervisor.sha256,
    supervisor_binding_schema_version: supervisor.binding_schema_version,
    validation_attestation_sha256: validation.sha256,
    validation_binding_schema_version: validation.binding_schema_version,
    rollback_checkpoint: catalog.rollback_checkpoint,
    catalog_runtime_sha256: catalog.runtime_sha256,
    runtime_loader_sha256: runtimeLoaderSha256,
    generator_sha256: catalog.generator_sha256,
    catalog_schema_version: catalog.schema_version,
    catalog_version: catalog.version,
  };
}

export function runtimeShardSetBinding(shardDescriptors) {
  invariant(Array.isArray(shardDescriptors), "Runtime shard descriptors must be an array");
  return shardDescriptors.map((descriptor) => ({
    branch_id: descriptor.branch_id,
    subbranch_id: descriptor.subbranch_id,
    relative_path: descriptor.relative_path,
    compressed_sha256: descriptor.compressed_sha256,
    compressed_bytes: descriptor.compressed_bytes,
    uncompressed_sha256: descriptor.uncompressed_sha256,
    uncompressed_bytes: descriptor.uncompressed_bytes,
    node_count: descriptor.node_count,
    function_count: descriptor.function_count,
    node_ids: descriptor.node_ids,
  }));
}

export function runtimeShardSetHash(shardDescriptors) {
  return sha256(runtimeShardSetBinding(shardDescriptors));
}

export function buildRuntimeArtifacts({
  catalogPath,
  fixturePath,
  validationAttestationPath,
  supervisorPath,
  runtimePath,
  manifestPath,
  shardRoot,
} = {}) {
  const requiredPaths = {
    catalogPath,
    validationAttestationPath,
    supervisorPath,
    runtimePath,
    manifestPath,
    shardRoot,
  };
  for (const [name, filePath] of Object.entries(requiredPaths)) {
    if (!String(filePath || "").trim()) throw new Error(`${name} is required`);
  }
  const catalogBytes = fs.readFileSync(catalogPath);
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  exactNodeCoverage(catalog);
  const resolvedFixturePath = fixturePath || inferredFixturePath(catalogPath);
  invariant(
    String(resolvedFixturePath || "").trim(),
    "fixturePath is required when it cannot be inferred from catalogPath"
  );
  const fixtureBytes = fs.readFileSync(resolvedFixturePath);
  const fixtureBundle = JSON.parse(fixtureBytes.toString("utf8"));
  invariant(
    isPlainObject(fixtureBundle)
      && fixtureBundle.catalog_fingerprint === catalog.catalog_fingerprint
      && Number.isSafeInteger(fixtureBundle.fixture_count)
      && fixtureBundle.fixture_count >= 0,
    "Runtime fixture artifact does not match the promoted catalog"
  );
  const validationReport = JSON.parse(fs.readFileSync(validationAttestationPath, "utf8"));
  const supervisor = JSON.parse(fs.readFileSync(supervisorPath, "utf8"));
  const validationBinding = validationAttestationBinding(validationReport, catalog);
  const canonicalSupervisorBinding = supervisorAttestationBinding(supervisor);
  const validation = validationAttestation(validationReport, catalog);
  const supervisorBinding = supervisorAttestation(supervisor, catalog);
  const runtimeLoaderSha256 = sha256(fs.readFileSync(runtimePath));
  invariant(
    runtimeLoaderSha256 === requireSha256(
      catalog.runtime_sha256,
      "Catalog runtime SHA-256"
    ),
    "Runtime loader SHA-256 does not match catalog.runtime_sha256"
  );
  const catalogBinding = buildCatalogBinding({
    catalog,
    supervisor: supervisorBinding,
    validation,
    runtimeLoaderSha256,
  });
  const catalogBindingHash = sha256(catalogBinding);
  const shardRelativeRoot = safeRelativeRoot(manifestPath, shardRoot);
  const functionById = new Map(
    catalog.function_registry.functions.map((spec) => [spec.function_id, spec])
  );
  const temporaryRoot = path.join(
    path.dirname(shardRoot),
    `.nyra-v2-shards-${process.pid}-${crypto.randomBytes(6).toString("hex")}`
  );
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const shardDescriptors = [];
  try {
    for (const branch of catalog.branches) {
      for (const subbranch of branch.subbranches) {
        const nodes = catalog.nodes.filter(
          (node) => node.branch_id === branch.id && node.id.split(".")[1] === subbranch.id
        );
        const functions = nodes.map((node) => functionById.get(node.id));
        if (nodes.length !== NODES_PER_SUBBRANCH || functions.some((spec) => !spec)) {
          throw new Error(`Invalid shard coverage for ${branch.id}.${subbranch.id}`);
        }
        const shardPayload = {
          schema_version: RUNTIME_SHARD_SCHEMA_VERSION,
          catalog_binding_hash: catalogBindingHash,
          catalog_fingerprint: catalog.catalog_fingerprint,
          function_registry_hash: catalog.function_registry.registry_hash,
          branch_id: branch.id,
          subbranch_id: subbranch.id,
          nodes,
          functions,
        };
        const shard = {
          ...shardPayload,
          shard_hash: sha256(shardPayload),
        };
        const uncompressed = Buffer.from(`${JSON.stringify(shard)}\n`, "utf8");
        const compressed = zlib.gzipSync(uncompressed, { level: 9, mtime: 0 });
        if (
          compressed.length > MAX_RUNTIME_SHARD_COMPRESSED_BYTES
          || uncompressed.length > MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES
          || uncompressed.length / compressed.length > MAX_RUNTIME_SHARD_COMPRESSION_RATIO
        ) {
          throw new Error(`Shard size budget exceeded for ${branch.id}.${subbranch.id}`);
        }
        const fileName = `${safeSegment(branch.id)}--${safeSegment(subbranch.id)}.json.gz`;
        fs.writeFileSync(path.join(temporaryRoot, fileName), compressed);
        shardDescriptors.push({
          branch_id: branch.id,
          subbranch_id: subbranch.id,
          relative_path: path.posix.join(
            shardRelativeRoot,
            "v1",
            catalog.catalog_fingerprint,
            catalogBindingHash,
            fileName
          ),
          compressed_sha256: sha256(compressed),
          uncompressed_sha256: sha256(uncompressed),
          compressed_bytes: compressed.length,
          uncompressed_bytes: uncompressed.length,
          node_count: nodes.length,
          function_count: functions.length,
          node_ids: nodes.map((node) => node.id),
        });
      }
    }
    const finalShardRoot = path.join(
      shardRoot,
      "v1",
      catalog.catalog_fingerprint,
      catalogBindingHash
    );
    fs.mkdirSync(path.dirname(finalShardRoot), { recursive: true });
    if (fs.existsSync(finalShardRoot)) {
      const expectedNames = fs.readdirSync(temporaryRoot).sort();
      const actualNames = fs.readdirSync(finalShardRoot).sort();
      const identical = JSON.stringify(expectedNames) === JSON.stringify(actualNames)
        && expectedNames.every((name) => {
          const expected = fs.readFileSync(path.join(temporaryRoot, name));
          const actual = fs.readFileSync(path.join(finalShardRoot, name));
          return expected.length === actual.length && sha256(expected) === sha256(actual);
        });
      if (!identical) {
        throw new Error(`Existing shard set differs for immutable fingerprint ${catalog.catalog_fingerprint}`);
      }
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } else {
      fs.renameSync(temporaryRoot, finalShardRoot);
    }
  } catch (error) {
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  const shardSetHash = runtimeShardSetHash(shardDescriptors);
  const totalCompressedBytes = shardDescriptors.reduce(
    (sum, descriptor) => sum + descriptor.compressed_bytes,
    0
  );
  const totalUncompressedBytes = shardDescriptors.reduce(
    (sum, descriptor) => sum + descriptor.uncompressed_bytes,
    0
  );
  if (
    totalCompressedBytes > MAX_RUNTIME_SHARDS_COMPRESSED_BYTES
    || totalUncompressedBytes > MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES
  ) throw new Error("Runtime shard aggregate size budget exceeded");
  const rootBinding = {
    ...catalogBinding,
    shard_set_hash: shardSetHash,
  };
  const rootBindingHash = sha256(rootBinding);
  const monolithArtifact = ephemeralSourceArtifact({
    artifactKind: "catalog_monolith",
    bytes: catalogBytes,
    catalogFingerprint: catalog.catalog_fingerprint,
  });
  const fixtureArtifact = ephemeralSourceArtifact({
    artifactKind: "fixture_bundle",
    bytes: fixtureBytes,
    catalogFingerprint: catalog.catalog_fingerprint,
    fixtureCount: fixtureBundle.fixture_count,
  });
  const manifestPayload = {
    schema_version: RUNTIME_MANIFEST_SCHEMA_VERSION,
    limits: RUNTIME_ARTIFACT_LIMITS,
    bindings: {
      schema_version: RUNTIME_BINDINGS_SCHEMA_VERSION,
      catalog: catalogBinding,
      supervisor: canonicalSupervisorBinding,
      validation: validationBinding,
    },
    catalog_binding_hash: catalogBindingHash,
    root_binding: rootBinding,
    root_binding_hash: rootBindingHash,
    shard_layout: {
      schema_version: RUNTIME_SHARD_LAYOUT_SCHEMA_VERSION,
      relative_root: shardRelativeRoot,
      generation: "v1",
    },
    runtime_source_artifacts: {
      schema_version: RUNTIME_SOURCE_ARTIFACTS_SCHEMA_VERSION,
      monolith: monolithArtifact,
      fixtures: fixtureArtifact,
    },
    offline_audit_artifact: monolithArtifact,
    offline_fixture_artifact: fixtureArtifact,
    supervisor_attestation: supervisorBinding,
    validation_attestation: validation,
    catalog: catalogTemplate(catalog),
    function_registry: {
      schema_version: catalog.function_registry.schema_version,
      registry_hash: catalog.function_registry.registry_hash,
      function_count: catalog.function_registry.functions.length,
    },
    topology: {
      branch_count: catalog.branches.length,
      subbranch_count: catalog.branches.reduce((sum, branch) => sum + branch.subbranches.length, 0),
      node_count: catalog.nodes.length,
      node_summaries: catalog.nodes.map(nodeSummary),
    },
    shard_totals: {
      shard_count: shardDescriptors.length,
      compressed_bytes: totalCompressedBytes,
      uncompressed_bytes: totalUncompressedBytes,
    },
    shards: shardDescriptors,
  };
  const manifest = {
    ...manifestPayload,
    manifest_hash: sha256(manifestPayload),
  };
  atomicWriteFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  verifyRuntimeArtifacts({ manifestPath, runtimePath });
  const cleanup = pruneStaleShardGenerations({
    shardRoot,
    catalogFingerprint: catalog.catalog_fingerprint,
    currentCatalogBindingHash: catalogBindingHash,
    expectedShardCount: shardDescriptors.length,
  });
  return {
    ok: true,
    manifest,
    manifest_path: path.resolve(manifestPath),
    shard_root: path.resolve(shardRoot),
    shard_count: shardDescriptors.length,
    compressed_bytes: totalCompressedBytes,
    uncompressed_bytes: totalUncompressedBytes,
    cleanup,
  };
}

function branchTopologyProjection(branches) {
  invariant(Array.isArray(branches), "Runtime catalog branches must be an array");
  return branches.map((branch) => {
    invariant(isPlainObject(branch), "Runtime catalog branch must be an object");
    invariant(
      safeSegment(branch.id) === branch.id,
      `Runtime catalog branch id is not canonical: ${branch.id}`
    );
    invariant(
      Array.isArray(branch.subbranches),
      `Runtime catalog branch has no subbranches: ${branch.id}`
    );
    return {
      id: branch.id,
      subbranches: branch.subbranches.map((subbranch) => {
        const subbranchId = typeof subbranch === "string" ? subbranch : subbranch?.id;
        invariant(
          safeSegment(subbranchId) === subbranchId,
          `Runtime catalog subbranch id is not canonical: ${branch.id}.${subbranchId}`
        );
        return subbranchId;
      }),
    };
  });
}

function orderedSubbranchLineage(catalog) {
  const lineage = [];
  for (const branch of catalog.branches) {
    for (const subbranch of branch.subbranches) {
      invariant(
        isPlainObject(subbranch),
        `Runtime subbranch template must be an object: ${branch.id}`
      );
      lineage.push({
        branch,
        subbranch,
        branch_id: branch.id,
        subbranch_id: subbranch.id,
      });
    }
  }
  return lineage;
}

function verifyEphemeralSourceArtifact(descriptor, artifactKind, catalogFingerprintValue) {
  invariant(isPlainObject(descriptor), `${artifactKind} source artifact is required`);
  invariant(
    descriptor.schema_version === RUNTIME_SOURCE_ARTIFACT_SCHEMA_VERSION,
    `${artifactKind} source artifact schema mismatch`
  );
  invariant(descriptor.artifact_kind === artifactKind, `${artifactKind} artifact kind mismatch`);
  invariant(
    descriptor.lifecycle === "ephemeral"
      && descriptor.ephemeral === true
      && descriptor.committed === false
      && descriptor.runtime_read_allowed === false,
    `${artifactKind} must be ephemeral, uncommitted and runtime-unreadable`
  );
  invariant(
    !Object.keys(descriptor).some((key) => key === "path" || key.endsWith("_path")),
    `${artifactKind} must not expose a runtime-readable path`
  );
  requireSha256(descriptor.byte_sha256, `${artifactKind} byte SHA-256`);
  invariant(
    Number.isSafeInteger(descriptor.byte_size) && descriptor.byte_size > 0,
    `${artifactKind} byte size is invalid`
  );
  invariant(
    descriptor.canonical_catalog_fingerprint === catalogFingerprintValue,
    `${artifactKind} catalog fingerprint mismatch`
  );
  if (artifactKind === "fixture_bundle") {
    invariant(
      Number.isSafeInteger(descriptor.fixture_count) && descriptor.fixture_count >= 0,
      "Fixture artifact count is invalid"
    );
  }
}

function safeShardArtifactPath(manifestPath, manifest, descriptor) {
  const manifestDirectory = path.resolve(path.dirname(manifestPath));
  const relativeRoot = manifest?.shard_layout?.relative_root;
  const generation = manifest?.shard_layout?.generation;
  invariant(
    manifest?.shard_layout?.schema_version === RUNTIME_SHARD_LAYOUT_SCHEMA_VERSION
      && generation === "v1",
    "Runtime shard layout schema mismatch"
  );
  const resolvedShardRoot = path.resolve(
    manifestDirectory,
    String(relativeRoot || "").split("/").join(path.sep)
  );
  invariant(
    safeRelativeRoot(manifestPath, resolvedShardRoot) === relativeRoot,
    "Runtime shard layout root is unsafe"
  );
  const expectedRelativePath = path.posix.join(
    relativeRoot,
    generation,
    manifest.root_binding.catalog_fingerprint,
    manifest.catalog_binding_hash,
    `${safeSegment(descriptor.branch_id)}--${safeSegment(descriptor.subbranch_id)}.json.gz`
  );
  invariant(
    descriptor.relative_path === expectedRelativePath
      && !descriptor.relative_path.includes("\\"),
    `Unsafe or non-canonical shard path: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  const artifactPath = path.resolve(
    manifestDirectory,
    descriptor.relative_path.split("/").join(path.sep)
  );
  invariant(
    artifactPath.startsWith(`${manifestDirectory}${path.sep}`),
    `Shard path escapes manifest root: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  const manifestRealRoot = fs.realpathSync(manifestDirectory);
  const artifactRealPath = fs.realpathSync(artifactPath);
  invariant(
    artifactRealPath.startsWith(`${manifestRealRoot}${path.sep}`),
    `Shard real path escapes manifest root: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  const linkStat = fs.lstatSync(artifactPath);
  invariant(
    linkStat.isFile() && !linkStat.isSymbolicLink(),
    `Shard artifact must be a regular non-symlink file: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  return artifactPath;
}

function verifyShardDescriptor(descriptor, expectedLineage) {
  invariant(isPlainObject(descriptor), "Runtime shard descriptor must be an object");
  invariant(
    descriptor.branch_id === expectedLineage.branch_id
      && descriptor.subbranch_id === expectedLineage.subbranch_id,
    `Runtime shard descriptor lineage mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    safeSegment(descriptor.branch_id) === descriptor.branch_id
      && safeSegment(descriptor.subbranch_id) === descriptor.subbranch_id,
    `Runtime shard descriptor lineage is unsafe: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  requireSha256(
    descriptor.compressed_sha256,
    `Compressed shard ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  requireSha256(
    descriptor.uncompressed_sha256,
    `Uncompressed shard ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    Number.isSafeInteger(descriptor.compressed_bytes)
      && descriptor.compressed_bytes > 0
      && descriptor.compressed_bytes <= MAX_RUNTIME_SHARD_COMPRESSED_BYTES,
    `Compressed shard size limit exceeded: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    Number.isSafeInteger(descriptor.uncompressed_bytes)
      && descriptor.uncompressed_bytes > 0
      && descriptor.uncompressed_bytes <= MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES,
    `Uncompressed shard size limit exceeded: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    descriptor.uncompressed_bytes / descriptor.compressed_bytes
      <= MAX_RUNTIME_SHARD_COMPRESSION_RATIO,
    `Shard compression ratio limit exceeded: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    descriptor.node_count === NODES_PER_SUBBRANCH
      && descriptor.function_count === NODES_PER_SUBBRANCH
      && Array.isArray(descriptor.node_ids)
      && descriptor.node_ids.length === NODES_PER_SUBBRANCH
      && new Set(descriptor.node_ids).size === NODES_PER_SUBBRANCH,
    `Runtime shard descriptor coverage mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
}

function verifyShardContent(shard, descriptor, manifest, expectedLineage) {
  invariant(isPlainObject(shard), "Runtime shard must be an object");
  const shardPayload = { ...shard };
  delete shardPayload.shard_hash;
  invariant(
    shard.schema_version === RUNTIME_SHARD_SCHEMA_VERSION,
    `Runtime shard schema mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    requireSha256(
      shard.shard_hash,
      `Shard payload ${descriptor.branch_id}.${descriptor.subbranch_id}`
    ) === sha256(shardPayload),
    `Shard payload hash mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    shard.catalog_binding_hash === manifest.catalog_binding_hash
      && shard.catalog_fingerprint === manifest.root_binding.catalog_fingerprint
      && shard.function_registry_hash === manifest.root_binding.function_registry_hash,
    `Shard catalog binding mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    shard.branch_id === descriptor.branch_id
      && shard.subbranch_id === descriptor.subbranch_id,
    `Shard lineage mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  invariant(
    Array.isArray(shard.nodes)
      && Array.isArray(shard.functions)
      && shard.nodes.length === NODES_PER_SUBBRANCH
      && shard.functions.length === NODES_PER_SUBBRANCH,
    `Shard node/function coverage mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  const nodeIds = shard.nodes.map((node) => node?.id);
  const functionIds = shard.functions.map((spec) => spec?.function_id);
  invariant(
    canonicalEqual(nodeIds, descriptor.node_ids)
      && canonicalEqual(functionIds, descriptor.node_ids),
    `Shard node ids mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  const l2 = shard.nodes.filter((node) => node?.level === 2);
  const l3 = shard.nodes.filter((node) => node?.level === 3);
  const l4 = shard.nodes.filter((node) => node?.level === 4);
  invariant(
    l2.length === 1
      && l3.length === 1
      && l4.length === LEVEL4_NODE_TYPES.length
      && new Set(l4.map((node) => node.node_type)).size === LEVEL4_NODE_TYPES.length
      && LEVEL4_NODE_TYPES.every((type) => l4.some((node) => node.node_type === type)),
    `Shard level coverage mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  const lineageRoot = `${descriptor.branch_id}.${descriptor.subbranch_id}`;
  invariant(
    l2[0].parent_id === lineageRoot
      && l3[0].parent_id === l2[0].id
      && l4.every((node) => node.parent_id === l3[0].id)
      && expectedLineage.subbranch.children?.[0] === l2[0].id
      && (
        !Object.hasOwn(l2[0], "children")
        || canonicalEqual(l2[0].children, [l3[0].id])
      )
      && (
        !Object.hasOwn(l3[0], "children")
        || canonicalEqual(l3[0].children, l4.map((node) => node.id))
      ),
    `Shard parent/child lineage mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  const functionById = new Map(
    shard.functions.map((spec) => [spec.function_id, spec])
  );
  invariant(
    functionById.size === NODES_PER_SUBBRANCH,
    `Shard function ids are duplicated: ${descriptor.branch_id}.${descriptor.subbranch_id}`
  );
  for (const node of shard.nodes) {
    const spec = functionById.get(node.id);
    invariant(
      node.branch_id === descriptor.branch_id
        && node.id.startsWith(`${lineageRoot}.`)
        && node.supervisor_status === "APPROVED"
        && isPlainObject(node.function_binding)
        && node.function_binding.registry_hash
          === manifest.root_binding.function_registry_hash
        && node.function_binding.semantic_function_hash
          === spec?.semantic_function_hash
        && node.function_binding.execution_plan_hash
          === spec?.execution_plan_hash
        && node.function_binding.observation_contract_hash
          === spec?.observation_contract_hash,
      `Shard node binding invalid: ${node?.id || "unknown"}`
    );
  }
}

function verifyManifestBindings(manifest, runtimePath) {
  const catalog = manifest.catalog;
  const supervisor = manifest.supervisor_attestation;
  const validation = manifest.validation_attestation;
  const bindings = manifest.bindings;
  invariant(
    isPlainObject(bindings)
      && bindings.schema_version === RUNTIME_BINDINGS_SCHEMA_VERSION,
    "Runtime bindings schema mismatch"
  );
  invariant(
    isPlainObject(bindings.supervisor)
      && bindings.supervisor.schema_version === SUPERVISOR_BINDING_SCHEMA_VERSION
      && supervisor.binding_schema_version === SUPERVISOR_BINDING_SCHEMA_VERSION
      && supervisor.sha256 === sha256(bindings.supervisor)
      && supervisor.binding_sha256 === supervisor.sha256,
    "Supervisor binding mismatch"
  );
  invariant(
    isPlainObject(bindings.validation)
      && bindings.validation.schema_version === VALIDATION_BINDING_SCHEMA_VERSION
      && validation.binding_schema_version === VALIDATION_BINDING_SCHEMA_VERSION
      && validation.sha256 === sha256(bindings.validation),
    "Validation binding mismatch"
  );
  const admission = catalog.supervisor_admission || {};
  invariant(
    admission.binding_schema_version === SUPERVISOR_BINDING_SCHEMA_VERSION
      && admission.supervisor_binding_sha256 === supervisor.sha256
      && admission.supervisor_report_sha256 === supervisor.sha256
      && admission.candidate_catalog_fingerprint
        === supervisor.candidate_catalog_fingerprint
      && admission.candidate_byte_sha256 === supervisor.candidate_byte_sha256
      && admission.fixture_byte_sha256 === supervisor.fixture_byte_sha256
      && bindings.supervisor.candidate.catalog_fingerprint
        === admission.candidate_catalog_fingerprint
      && bindings.supervisor.candidate.byte_sha256
        === admission.candidate_byte_sha256
      && bindings.supervisor.candidate.fixture_byte_sha256
        === admission.fixture_byte_sha256,
    "Promoted catalog Supervisor admission binding mismatch"
  );
  requireSha256(admission.candidate_catalog_fingerprint, "Candidate catalog fingerprint");
  requireSha256(admission.candidate_byte_sha256, "Candidate byte SHA-256");
  requireSha256(admission.fixture_byte_sha256, "Fixture byte SHA-256");
  const expectedNodeCount = manifest.topology.node_count;
  invariant(
    bindings.supervisor.decision.overall_decision === "APPROVED"
      && bindings.supervisor.decision.runtime_inclusion_allowed === true
      && bindings.supervisor.decision.deploy_allowed === false
      && bindings.supervisor.approved_node_count === expectedNodeCount
      && bindings.supervisor.rejected_node_count === 0
      && supervisor.approved_node_count === expectedNodeCount
      && supervisor.rejected_node_count === 0
      && supervisor.runtime_inclusion_allowed === true
      && admission.approved_node_count === expectedNodeCount
      && admission.rejected_node_count === 0
      && admission.runtime_inclusion_allowed === true,
    "Supervisor approval binding is not unanimous"
  );
  invariant(
    bindings.validation.catalog_fingerprint === catalog.catalog_fingerprint
      && bindings.validation.validation.ok === true
      && bindings.validation.validation.errors.length === 0
      && bindings.validation.report_errors.length === 0
      && bindings.validation.expected_catalog.branch_count
        === manifest.topology.branch_count
      && bindings.validation.expected_catalog.subbranch_count
        === manifest.topology.subbranch_count
      && bindings.validation.expected_catalog.node_count === expectedNodeCount
      && validation.catalog_fingerprint === catalog.catalog_fingerprint
      && validation.validated_branch_count === manifest.topology.branch_count
      && validation.validated_subbranch_count === manifest.topology.subbranch_count
      && validation.validated_node_count === expectedNodeCount
      && validation.rejected_node_count === 0
      && validation.duplicate_contract_count === 0
      && validation.rollback_verified === true
      && validation.full_offline_validated === true,
    "Validation attestation binding mismatch"
  );
  const rootRuntimeSha256 = requireSha256(
    manifest.root_binding.runtime_loader_sha256,
    "Runtime loader SHA-256"
  );
  invariant(
    rootRuntimeSha256 === requireSha256(
      catalog.runtime_sha256,
      "Catalog runtime SHA-256"
    )
      && manifest.root_binding.catalog_runtime_sha256 === catalog.runtime_sha256,
    "Runtime loader binding does not match catalog.runtime_sha256"
  );
  if (runtimePath) {
    invariant(
      sha256(fs.readFileSync(runtimePath)) === rootRuntimeSha256,
      "Runtime loader bytes do not match the manifest binding"
    );
  }
  const expectedCatalogBinding = buildCatalogBinding({
    catalog,
    supervisor,
    validation,
    runtimeLoaderSha256: rootRuntimeSha256,
  });
  invariant(
    canonicalEqual(bindings.catalog, expectedCatalogBinding),
    "Exact catalog binding mismatch"
  );
  invariant(
    manifest.catalog_binding_hash === sha256(bindings.catalog),
    "Catalog binding hash mismatch"
  );
  return expectedCatalogBinding;
}

export function verifyRuntimeArtifacts({ manifestPath, runtimePath } = {}) {
  invariant(String(manifestPath || "").trim(), "manifestPath is required");
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestStat = fs.lstatSync(absoluteManifestPath);
  invariant(
    manifestStat.isFile()
      && !manifestStat.isSymbolicLink()
      && manifestStat.size > 0
      && manifestStat.size <= MAX_RUNTIME_MANIFEST_BYTES,
    "Runtime manifest must be a bounded regular non-symlink file"
  );
  const manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, "utf8"));
  invariant(isPlainObject(manifest), "Runtime manifest must be an object");
  invariant(
    manifest.schema_version === RUNTIME_MANIFEST_SCHEMA_VERSION,
    "Runtime manifest schema mismatch"
  );
  invariant(
    requireSha256(manifest.manifest_hash, "Runtime manifest hash")
      === sha256(Object.fromEntries(
        Object.entries(manifest).filter(([key]) => key !== "manifest_hash")
      )),
    "Runtime manifest hash mismatch"
  );
  invariant(
    canonicalEqual(manifest.limits, RUNTIME_ARTIFACT_LIMITS),
    "Runtime manifest limits mismatch"
  );
  const catalog = manifest.catalog;
  invariant(
    isPlainObject(catalog)
      && Array.isArray(catalog.branches)
      && Array.isArray(catalog.nodes)
      && catalog.nodes.length === 0
      && isPlainObject(catalog.function_registry)
      && Array.isArray(catalog.function_registry.functions)
      && catalog.function_registry.functions.length === 0,
    "Runtime catalog template is invalid"
  );
  requireSha256(catalog.catalog_fingerprint, "Runtime catalog fingerprint");
  requireSha256(catalog.function_registry.registry_hash, "Runtime registry hash");
  const catalogTopology = branchTopologyProjection(catalog.branches);
  const sourceTopology = branchTopologyProjection(catalog.source_catalog?.branches);
  invariant(
    canonicalEqual(catalogTopology, sourceTopology),
    "Runtime source/catalog topology mismatch"
  );
  const subbranchLineage = orderedSubbranchLineage(catalog);
  const expectedNodeCount = subbranchLineage.length * NODES_PER_SUBBRANCH;
  invariant(
    isPlainObject(manifest.topology)
      && manifest.topology.branch_count === catalog.branches.length
      && manifest.topology.subbranch_count === subbranchLineage.length
      && manifest.topology.node_count === expectedNodeCount
      && Array.isArray(manifest.topology.node_summaries)
      && manifest.topology.node_summaries.length === expectedNodeCount,
    "Runtime topology declaration mismatch"
  );
  invariant(
    isPlainObject(manifest.function_registry)
      && manifest.function_registry.schema_version
        === catalog.function_registry.schema_version
      && manifest.function_registry.registry_hash
        === catalog.function_registry.registry_hash
      && manifest.function_registry.function_count === expectedNodeCount,
    "Runtime function registry declaration mismatch"
  );
  verifyManifestBindings(manifest, runtimePath);
  const descriptors = manifest.shards;
  invariant(
    Array.isArray(descriptors)
      && descriptors.length === subbranchLineage.length,
    "Runtime shard descriptor count mismatch"
  );
  const shardSetHash = runtimeShardSetHash(descriptors);
  const expectedRootBinding = {
    ...manifest.bindings.catalog,
    shard_set_hash: shardSetHash,
  };
  invariant(
    canonicalEqual(manifest.root_binding, expectedRootBinding),
    "Runtime root binding mismatch"
  );
  invariant(
    requireSha256(manifest.root_binding_hash, "Runtime root binding hash")
      === sha256(expectedRootBinding),
    "Runtime root binding hash mismatch"
  );
  const sources = manifest.runtime_source_artifacts;
  invariant(
    isPlainObject(sources)
      && sources.schema_version === RUNTIME_SOURCE_ARTIFACTS_SCHEMA_VERSION,
    "Runtime source artifacts schema mismatch"
  );
  verifyEphemeralSourceArtifact(
    sources.monolith,
    "catalog_monolith",
    catalog.catalog_fingerprint
  );
  verifyEphemeralSourceArtifact(
    sources.fixtures,
    "fixture_bundle",
    catalog.catalog_fingerprint
  );
  invariant(
    canonicalEqual(manifest.offline_audit_artifact, sources.monolith)
      && canonicalEqual(manifest.offline_fixture_artifact, sources.fixtures),
    "Runtime source artifact aliases mismatch"
  );
  const nodes = [];
  const functions = [];
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    const expectedLineage = subbranchLineage[index];
    verifyShardDescriptor(descriptor, expectedLineage);
    const artifactPath = safeShardArtifactPath(
      absoluteManifestPath,
      manifest,
      descriptor
    );
    const stat = fs.statSync(artifactPath);
    invariant(
      stat.size === descriptor.compressed_bytes,
      `Compressed shard size mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
    );
    const compressed = fs.readFileSync(artifactPath);
    invariant(
      compressed.length === descriptor.compressed_bytes
        && sha256(compressed) === descriptor.compressed_sha256,
      `Compressed shard hash mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
    );
    const uncompressed = zlib.gunzipSync(compressed, {
      maxOutputLength: descriptor.uncompressed_bytes,
    });
    invariant(
      uncompressed.length === descriptor.uncompressed_bytes
        && sha256(uncompressed) === descriptor.uncompressed_sha256
        && uncompressed.length / compressed.length
          <= MAX_RUNTIME_SHARD_COMPRESSION_RATIO,
      `Uncompressed shard integrity mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`
    );
    const shard = JSON.parse(uncompressed.toString("utf8"));
    verifyShardContent(shard, descriptor, manifest, expectedLineage);
    nodes.push(...shard.nodes);
    functions.push(...shard.functions);
    totalCompressedBytes += compressed.length;
    totalUncompressedBytes += uncompressed.length;
    invariant(
      Number.isSafeInteger(totalCompressedBytes)
        && Number.isSafeInteger(totalUncompressedBytes)
        && totalCompressedBytes <= MAX_RUNTIME_SHARDS_COMPRESSED_BYTES
        && totalUncompressedBytes <= MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES,
      "Runtime shard aggregate size budget exceeded"
    );
  }
  invariant(
    canonicalEqual(manifest.shard_totals, {
      shard_count: descriptors.length,
      compressed_bytes: totalCompressedBytes,
      uncompressed_bytes: totalUncompressedBytes,
    }),
    "Runtime shard totals mismatch"
  );
  const nodeIds = nodes.map((node) => node.id);
  const functionIds = functions.map((spec) => spec.function_id);
  invariant(
    nodeIds.length === expectedNodeCount
      && new Set(nodeIds).size === expectedNodeCount
      && functionIds.length === expectedNodeCount
      && new Set(functionIds).size === expectedNodeCount
      && canonicalEqual(nodeIds, functionIds)
      && canonicalEqual(
        manifest.topology.node_summaries,
        nodes.map(nodeSummary)
      ),
    "Runtime global node/function coverage mismatch"
  );
  const reconstructedCatalog = structuredClone(catalog);
  reconstructedCatalog.nodes = nodes;
  reconstructedCatalog.function_registry.functions = functions;
  invariant(
    functionRegistryHash(reconstructedCatalog.function_registry)
      === reconstructedCatalog.function_registry.registry_hash,
    "Reconstructed function registry hash mismatch"
  );
  invariant(
    catalogFingerprint(reconstructedCatalog)
      === reconstructedCatalog.catalog_fingerprint,
    "Reconstructed catalog fingerprint mismatch"
  );
  return {
    ok: true,
    manifest,
    catalog: reconstructedCatalog,
    shard_count: descriptors.length,
    compressed_bytes: totalCompressedBytes,
    uncompressed_bytes: totalUncompressedBytes,
  };
}

export function reconstructCatalogFromRuntimeArtifacts({
  manifestPath,
  runtimePath,
} = {}) {
  return verifyRuntimeArtifacts({ manifestPath, runtimePath }).catalog;
}
