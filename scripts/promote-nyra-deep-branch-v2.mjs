#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildRuntimeArtifacts } from "./lib/nyra-deep-branch-v2-shards.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key || "end"}`);
    args[key.slice(2)] = value;
  }
  return args;
}

function required(args, key) {
  if (!String(args[key] || "").trim()) throw new Error(`--${key} is required`);
  return args[key];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function sha256(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : JSON.stringify(canonicalize(value));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function catalogFingerprint(catalog) {
  return sha256(Object.fromEntries(Object.entries(catalog).filter(([key]) => key !== "catalog_fingerprint")));
}

function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function toYaml(value, indent = 0) {
  const padding = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${padding}[]`;
    return value.map((item) => {
      if (item && typeof item === "object") {
        const rendered = toYaml(item, indent + 2);
        const lines = rendered.split("\n");
        return `${padding}- ${lines[0].trimStart()}${lines.length > 1 ? `\n${lines.slice(1).join("\n")}` : ""}`;
      }
      return `${padding}- ${yamlScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return `${padding}{}`;
    return entries.map(([key, item]) => {
      if (item && typeof item === "object" && Object.keys(item).length) {
        return `${padding}${key}:\n${toYaml(item, indent + 2)}`;
      }
      if (item && typeof item === "object") return `${padding}${key}: ${Array.isArray(item) ? "[]" : "{}"}`;
      return `${padding}${key}: ${yamlScalar(item)}`;
    }).join("\n");
  }
  return `${padding}${yamlScalar(value)}`;
}

function buildMap(catalog) {
  const nodeIndex = new Map(catalog.nodes.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of catalog.nodes) {
    const list = children.get(node.parent_id) || [];
    list.push(node);
    children.set(node.parent_id, list);
  }
  const lines = [
    "# Nyra Deep Branch Architecture V2 — complete approved map",
    "",
    `Catalog fingerprint: \`${catalog.catalog_fingerprint}\`.`,
    "",
    "| Branch | L1 subbranch | L2 specialized capability | L3 micro-capability | L4 method | L4 strategy | L4 verifier | L4 metric |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const branch of catalog.branches) {
    for (const subbranch of branch.subbranches) {
      const l2 = nodeIndex.get(subbranch.children[0]);
      const l3 = (children.get(l2.id) || [])[0];
      const level4 = Object.fromEntries((children.get(l3.id) || []).map((node) => [node.node_type, node.id]));
      lines.push(`| ${branch.id} | ${subbranch.id} | ${l2.id} | ${l3.id} | ${level4.method} | ${level4.strategy} | ${level4.verifier} | ${level4.metric} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildYamlReview(catalog) {
  return {
    schema_version: "nyra_deep_branch_v2_yaml_review_v1",
    catalog_version: catalog.version,
    authority: catalog.authority,
    catalog_fingerprint: catalog.catalog_fingerprint,
    authoritative_json: "personal-control-center/data/nyra-deep-branch-v2.catalog.json",
    function_registry: {
      schema_version: catalog.function_registry.schema_version,
      registry_hash: catalog.function_registry.registry_hash,
      function_count: catalog.function_registry.functions.length,
      artifact: "architecture/nyra-deep-branch-v2-function-registry.json",
    },
    source_catalog: catalog.source_catalog,
    branches: catalog.branches,
    nodes: catalog.nodes.map((node) => ({
      id: node.id,
      parent_id: node.parent_id,
      branch_id: node.branch_id,
      level: node.level,
      node_type: node.node_type,
      purpose: node.purpose,
      problem_solved: node.problem_solved,
      risk_class: node.risk_class,
      operation: node.methods[0].operation,
      semantic_function_hash: node.function_binding.semantic_function_hash,
      observation_contract_hash: node.function_binding.observation_contract_hash,
      execution_plan_hash: node.function_binding.execution_plan_hash,
      fallback_node: node.fallback_node,
      feature_flag: node.feature_flag,
      version: node.version,
      supervisor_status: node.supervisor_status,
      contract_json_pointer: `/nodes/${catalog.nodes.indexOf(node)}`,
    })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidatePath = required(args, "candidate");
  const fixturePath = required(args, "fixtures");
  const supervisorPath = required(args, "supervisor");
  const catalogOutput = required(args, "catalog-output");
  const fixturesOutput = required(args, "fixtures-output");
  const yamlOutput = required(args, "yaml-output");
  const registryOutput = required(args, "registry-output");
  const snapshotOutput = required(args, "snapshot-output");
  const mapOutput = required(args, "map-output");
  const candidate = readJson(candidatePath);
  const fixtures = readJson(fixturePath);
  const supervisor = readJson(supervisorPath);
  if (candidate.catalog_fingerprint !== catalogFingerprint(candidate)) throw new Error("Candidate fingerprint mismatch");
  if (fixtures.catalog_fingerprint !== candidate.catalog_fingerprint) throw new Error("Fixture fingerprint mismatch");
  if (candidate.nodes.some((node) => node.supervisor_status !== "PENDING")) throw new Error("Candidate must remain PENDING");
  if (supervisor.candidate?.catalog_fingerprint !== candidate.catalog_fingerprint) {
    throw new Error("Supervisor audited a different catalog fingerprint");
  }
  const decisions = Array.isArray(supervisor.decisions) ? supervisor.decisions : [];
  const decisionById = new Map(decisions.map((decision) => [decision.node_id, decision]));
  if (decisionById.size !== candidate.nodes.length || decisions.length !== candidate.nodes.length) {
    throw new Error(`Supervisor decision coverage mismatch: ${decisionById.size}/${candidate.nodes.length}`);
  }
  for (const node of candidate.nodes) {
    const decision = decisionById.get(node.id);
    if (!decision || decision.decision !== "APPROVED") throw new Error(`Supervisor did not approve ${node.id}`);
    if (decision.checks?.all_required_checks_passed !== true) throw new Error(`Supervisor checks incomplete for ${node.id}`);
    if (decision.runtime_inclusion_allowed !== true) throw new Error(`Runtime inclusion denied for ${node.id}`);
  }
  const supervisorSummary = supervisor.decision_summary || supervisor.summary;
  if (
    supervisorSummary?.overall_decision !== "APPROVED"
    || supervisorSummary?.runtime_inclusion_allowed !== true
    || supervisorSummary?.approved_nodes !== candidate.nodes.length
  ) {
    throw new Error("Supervisor summary does not authorize catalog admission");
  }
  const supervisorFileBytes = fs.readFileSync(supervisorPath);
  const promoted = structuredClone(candidate);
  promoted.nodes = promoted.nodes.map((node) => ({ ...node, supervisor_status: "APPROVED" }));
  promoted.supervisor_admission = {
    schema_version: supervisor.schema_version,
    audit_pass: supervisor.audit_pass || supervisor.pass || 3,
    candidate_catalog_fingerprint: candidate.catalog_fingerprint,
    supervisor_report_sha256: sha256(supervisorFileBytes),
    approved_node_count: promoted.nodes.length,
    rejected_node_count: 0,
    runtime_inclusion_allowed: true,
  };
  promoted.catalog_fingerprint = "";
  promoted.catalog_fingerprint = catalogFingerprint(promoted);
  const promotedFixtures = structuredClone(fixtures);
  promotedFixtures.catalog_fingerprint = promoted.catalog_fingerprint;
  const snapshot = {
    schema_version: "nyra_live_branch_catalog_snapshot_v1",
    captured_at: promoted.source_catalog.captured_at,
    source: promoted.source_catalog.source,
    authenticated_tenant: promoted.source_catalog.tenant_id,
    source_snapshot_sha256: promoted.source_catalog.source_snapshot_sha256,
    catalog: {
      schema_version: promoted.source_catalog.schema_version,
      domain_pack_id: promoted.source_catalog.domain_pack_id,
      branches: promoted.source_catalog.branches,
    },
  };
  writeFile(catalogOutput, `${JSON.stringify(promoted)}\n`);
  writeFile(fixturesOutput, `${JSON.stringify(promotedFixtures)}\n`);
  writeFile(yamlOutput, `${toYaml(buildYamlReview(promoted))}\n`);
  writeFile(registryOutput, `${JSON.stringify(promoted.function_registry, null, 2)}\n`);
  writeFile(snapshotOutput, `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFile(mapOutput, buildMap(promoted));
  let runtimeArtifacts = null;
  if (args["validation-attestation"]) {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
    runtimeArtifacts = buildRuntimeArtifacts({
      catalogPath: catalogOutput,
      validationAttestationPath: args["validation-attestation"],
      supervisorPath,
      runtimePath: args["runtime"] || path.join(
        repoRoot,
        "personal-control-center/lib/nyra-deep-branch-v2.js"
      ),
      manifestPath: args["runtime-manifest-output"] || path.join(
        path.dirname(catalogOutput),
        "nyra-deep-branch-v2.runtime-manifest.json"
      ),
      shardRoot: args["runtime-shard-root"] || path.join(
        path.dirname(catalogOutput),
        "nyra-deep-branch-v2.shards"
      ),
    });
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    candidate_catalog_fingerprint: candidate.catalog_fingerprint,
    promoted_catalog_fingerprint: promoted.catalog_fingerprint,
    approved_node_count: promoted.nodes.length,
    fixture_count: promotedFixtures.fixture_count,
    yaml_output: yamlOutput,
    registry_output: registryOutput,
    runtime_manifest_hash: runtimeArtifacts?.manifest?.manifest_hash || null,
    runtime_shard_count: runtimeArtifacts?.shard_count || 0,
    runtime_shard_cleanup: runtimeArtifacts?.cleanup || null,
  }, null, 2)}\n`);
}

main();
