#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildRuntimeArtifacts } from "./lib/nyra-deep-branch-v2-shards.mjs";

const require = createRequire(import.meta.url);
const runtime = require("../personal-control-center/lib/nyra-deep-branch-v2.js");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key?.startsWith("--")
      || value === undefined
      || value.startsWith("--")
      || Object.hasOwn(args, key.slice(2))
    ) {
      throw new Error(`invalid_argument:${key || "end"}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function requiredPath(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) throw new Error(`missing_argument:${key}`);
  return path.resolve(value);
}

function build(args) {
  const result = buildRuntimeArtifacts({
    catalogPath: requiredPath(args, "catalog"),
    validationAttestationPath: requiredPath(args, "validation"),
    supervisorPath: requiredPath(args, "supervisor"),
    runtimePath: requiredPath(args, "runtime"),
    manifestPath: requiredPath(args, "manifest"),
    shardRoot: requiredPath(args, "shard-root"),
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
}

function verify(args) {
  const manifestPath = requiredPath(args, "manifest");
  const loaded = runtime.loadCatalog({
    manifestPath,
    runtimeMode: "lazy",
    forceReload: true,
    verifyArtifacts: true,
  });
  const integrity = loaded.validation?.integrity || {};
  const result = {
    ok: loaded.ok === true
      && loaded.runtime_lazy === true
      && integrity.unchecked_shards === 0
      && integrity.deferred_content_shards === 0
      && integrity.content_verified_shards
        === loaded.manifest?.shards?.length,
    state: loaded.state,
    manifest: path.relative(repoRoot, manifestPath),
    manifest_hash: loaded.manifest?.manifest_hash || null,
    root_binding_hash: loaded.manifest?.root_binding_hash || null,
    catalog_fingerprint:
      loaded.manifest?.root_binding?.catalog_fingerprint || null,
    shard_count: loaded.manifest?.shards?.length || 0,
    integrity,
    errors: loaded.validation?.errors || [],
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
const mode = String(args.mode || "").trim().toLowerCase();
if (mode === "build") build(args);
else if (mode === "verify") verify(args);
else throw new Error("mode_must_be_build_or_verify");
