#!/usr/bin/env node

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

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = parseArgs(process.argv.slice(2));
const result = buildRuntimeArtifacts({
  catalogPath: path.resolve(args.catalog || path.join(
    repoRoot,
    "personal-control-center/data/nyra-deep-branch-v2.catalog.json"
  )),
  validationAttestationPath: path.resolve(args.validation || path.join(
    repoRoot,
    "reports/nyra-deep-v2/validation_report.json"
  )),
  supervisorPath: path.resolve(args.supervisor || path.join(
    repoRoot,
    "reports/nyra-deep-v2/supervisor_decisions.json"
  )),
  runtimePath: path.resolve(args.runtime || path.join(
    repoRoot,
    "personal-control-center/lib/nyra-deep-branch-v2.js"
  )),
  manifestPath: path.resolve(args.manifest || path.join(
    repoRoot,
    "personal-control-center/data/nyra-deep-branch-v2.runtime-manifest.json"
  )),
  shardRoot: path.resolve(args["shard-root"] || path.join(
    repoRoot,
    "personal-control-center/data/nyra-deep-branch-v2.shards"
  )),
});

process.stdout.write(`${JSON.stringify({
  ok: result.ok,
  manifest_path: result.manifest_path,
  manifest_hash: result.manifest.manifest_hash,
  root_binding_hash: result.manifest.root_binding_hash,
  shard_count: result.shard_count,
  compressed_bytes: result.compressed_bytes,
  uncompressed_bytes: result.uncompressed_bytes,
  cleanup: result.cleanup,
}, null, 2)}\n`);
