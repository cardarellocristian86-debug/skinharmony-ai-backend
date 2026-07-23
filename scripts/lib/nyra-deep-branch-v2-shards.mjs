import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const RUNTIME_MANIFEST_SCHEMA_VERSION = "nyra_deep_branch_runtime_manifest_v1";
export const RUNTIME_SHARD_SCHEMA_VERSION = "nyra_deep_branch_runtime_shard_v1";
export const MAX_RUNTIME_SHARD_COMPRESSED_BYTES = 256 * 1024;
export const MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES = 1024 * 1024;
export const MAX_RUNTIME_SHARD_COMPRESSION_RATIO = 16;
export const MAX_RUNTIME_SHARDS_COMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

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
} = {}) {
  const hexDigest = /^[a-f0-9]{64}$/;
  if (!hexDigest.test(String(catalogFingerprint || ""))) {
    throw new Error("A canonical 64-hex catalog fingerprint is required for shard cleanup");
  }
  if (!hexDigest.test(String(currentCatalogBindingHash || ""))) {
    throw new Error("A canonical 64-hex catalog binding hash is required for shard cleanup");
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
    || currentEntries.length !== 239
    || shardFiles.length !== 239
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

function validationAttestation(validationReport, validationBytes, catalog) {
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
    sha256: sha256(validationBytes),
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

function supervisorAttestation(supervisor, supervisorBytes, catalog) {
  const expectedHash = catalog?.supervisor_admission?.supervisor_report_sha256;
  const actualHash = sha256(supervisorBytes);
  const summary = supervisor?.decision_summary || supervisor?.summary || {};
  const valid = expectedHash === actualHash
    && summary.overall_decision === "APPROVED"
    && summary.runtime_inclusion_allowed === true
    && summary.approved_nodes === catalog.nodes.length
    && summary.rejected_nodes === 0
    && catalog?.supervisor_admission?.runtime_inclusion_allowed === true
    && catalog?.supervisor_admission?.approved_node_count === catalog.nodes.length
    && catalog?.supervisor_admission?.rejected_node_count === 0;
  if (!valid) throw new Error("Supervisor attestation does not match the promoted catalog");
  return {
    schema_version: supervisor.schema_version,
    audit_pass: supervisor.audit_pass || supervisor.pass || catalog.supervisor_admission.audit_pass,
    sha256: actualHash,
    candidate_catalog_fingerprint: catalog.supervisor_admission.candidate_catalog_fingerprint,
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
  const nodeIds = catalog.nodes.map((node) => node.id);
  const functionIds = catalog.function_registry.functions.map((spec) => spec.function_id);
  if (nodeIds.length !== 1434 || new Set(nodeIds).size !== nodeIds.length) {
    throw new Error(`Expected 1434 unique approved nodes, received ${nodeIds.length}`);
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
  const branchCount = catalog.branches.length;
  const subbranchCount = catalog.branches.reduce((sum, branch) => sum + branch.subbranches.length, 0);
  if (branchCount !== 18 || subbranchCount !== 239) {
    throw new Error(`Unexpected topology ${branchCount}/${subbranchCount}`);
  }
}

export function buildRuntimeArtifacts({
  catalogPath,
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
  const validationBytes = fs.readFileSync(validationAttestationPath);
  const validationReport = JSON.parse(validationBytes.toString("utf8"));
  const supervisorBytes = fs.readFileSync(supervisorPath);
  const supervisor = JSON.parse(supervisorBytes.toString("utf8"));
  const validation = validationAttestation(validationReport, validationBytes, catalog);
  const supervisorBinding = supervisorAttestation(supervisor, supervisorBytes, catalog);
  const runtimeLoaderSha256 = sha256(fs.readFileSync(runtimePath));
  const catalogBinding = {
    catalog_fingerprint: catalog.catalog_fingerprint,
    function_registry_hash: catalog.function_registry.registry_hash,
    source_snapshot_sha256: catalog.source_catalog.source_snapshot_sha256,
    supervisor_report_sha256: supervisorBinding.sha256,
    validation_attestation_sha256: validation.sha256,
    rollback_checkpoint: catalog.rollback_checkpoint,
    catalog_runtime_sha256: catalog.runtime_sha256,
    runtime_loader_sha256: runtimeLoaderSha256,
    generator_sha256: catalog.generator_sha256,
    catalog_schema_version: catalog.schema_version,
    catalog_version: catalog.version,
  };
  const catalogBindingHash = sha256(catalogBinding);
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
        if (nodes.length !== 6 || functions.some((spec) => !spec)) {
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
            "nyra-deep-branch-v2.shards",
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
        && expectedNames.every((name) => (
          sha256(fs.readFileSync(path.join(temporaryRoot, name)))
          === sha256(fs.readFileSync(path.join(finalShardRoot, name)))
        ));
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
  const shardSetHash = sha256(shardDescriptors.map((descriptor) => ({
    branch_id: descriptor.branch_id,
    subbranch_id: descriptor.subbranch_id,
    relative_path: descriptor.relative_path,
    compressed_sha256: descriptor.compressed_sha256,
    uncompressed_sha256: descriptor.uncompressed_sha256,
    compressed_bytes: descriptor.compressed_bytes,
    uncompressed_bytes: descriptor.uncompressed_bytes,
    node_count: descriptor.node_count,
    function_count: descriptor.function_count,
    node_ids: descriptor.node_ids,
  })));
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
  const manifestPayload = {
    schema_version: RUNTIME_MANIFEST_SCHEMA_VERSION,
    catalog_binding_hash: catalogBindingHash,
    root_binding: rootBinding,
    root_binding_hash: rootBindingHash,
    offline_audit_artifact: {
      relative_path: path.relative(path.dirname(manifestPath), catalogPath).split(path.sep).join("/"),
      byte_sha256: sha256(catalogBytes),
      byte_size: catalogBytes.length,
      canonical_catalog_fingerprint: catalog.catalog_fingerprint,
      runtime_read_allowed: false,
    },
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
    shards: shardDescriptors,
  };
  const manifest = {
    ...manifestPayload,
    manifest_hash: sha256(manifestPayload),
  };
  atomicWriteFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const cleanup = pruneStaleShardGenerations({
    shardRoot,
    catalogFingerprint: catalog.catalog_fingerprint,
    currentCatalogBindingHash: catalogBindingHash,
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

export function reconstructCatalogFromRuntimeArtifacts({ manifestPath } = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const nodes = [];
  const functions = [];
  for (const descriptor of manifest.shards) {
    if (
      descriptor.compressed_bytes > MAX_RUNTIME_SHARD_COMPRESSED_BYTES
      || descriptor.uncompressed_bytes > MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES
      || descriptor.uncompressed_bytes / descriptor.compressed_bytes > MAX_RUNTIME_SHARD_COMPRESSION_RATIO
    ) throw new Error(`Shard size budget exceeded: ${descriptor.branch_id}.${descriptor.subbranch_id}`);
    const artifactPath = path.resolve(path.dirname(manifestPath), descriptor.relative_path);
    const stat = fs.statSync(artifactPath);
    if (stat.size !== descriptor.compressed_bytes) {
      throw new Error(`Compressed shard size mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`);
    }
    const compressed = fs.readFileSync(artifactPath);
    if (sha256(compressed) !== descriptor.compressed_sha256) {
      throw new Error(`Compressed shard hash mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`);
    }
    const uncompressed = zlib.gunzipSync(compressed, {
      maxOutputLength: descriptor.uncompressed_bytes,
    });
    if (sha256(uncompressed) !== descriptor.uncompressed_sha256) {
      throw new Error(`Uncompressed shard hash mismatch: ${descriptor.branch_id}.${descriptor.subbranch_id}`);
    }
    const shard = JSON.parse(uncompressed.toString("utf8"));
    nodes.push(...shard.nodes);
    functions.push(...shard.functions);
  }
  const catalog = structuredClone(manifest.catalog);
  catalog.nodes = nodes;
  catalog.function_registry.functions = functions;
  return catalog;
}
