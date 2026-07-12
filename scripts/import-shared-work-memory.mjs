#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const source = path.resolve(process.argv[2] || "../skinharmony-codex/SHARED_MEMORY");
const target = path.resolve(process.argv[3] || "shared-work-memory/archive/connector-memory");
const excludedNames = new Set([".DS_Store"]);
const excludedTopLevels = new Set(["locks"]);
const files = [];

function walk(dir, relative = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludedNames.has(entry.name)) continue;
    const nextRelative = path.join(relative, entry.name);
    if (!relative && excludedTopLevels.has(entry.name)) continue;
    const from = path.join(dir, entry.name);
    const to = path.join(target, nextRelative);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      walk(from, nextRelative);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      const buffer = fs.readFileSync(to);
      files.push({ path: nextRelative.split(path.sep).join("/"), bytes: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex") });
    }
  }
}

if (!fs.existsSync(source)) throw new Error(`Shared memory source not found: ${source}`);
fs.mkdirSync(target, { recursive: true });
walk(source);
const manifest = {
  schema_version: "skinharmony_shared_work_memory_manifest_v1",
  generated_at: new Date().toISOString(),
  source,
  target,
  mode: "non_destructive_copy",
  exclusions: [".DS_Store", "locks/"],
  file_count: files.length,
  total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  files
};
fs.mkdirSync(path.resolve("shared-work-memory/manifests"), { recursive: true });
fs.writeFileSync(path.resolve("shared-work-memory/manifests/connector-memory-latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, file_count: manifest.file_count, total_bytes: manifest.total_bytes, target }, null, 2));
