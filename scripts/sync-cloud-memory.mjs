#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const endpoint = String(process.env.SKINHARMONY_MCP_URL || "https://skinharmony-core-mcp.onrender.com/mcp");
const token = String(process.env.SKINHARMONY_MCP_TOKEN || "");
const root = path.resolve(process.argv[2] || path.join(os.homedir(), "skinharmony-codex", "SHARED_MEMORY"));
const stateRoot = path.join(os.homedir(), ".skinharmony", "cloud-memory-sync");
const manifestPath = path.join(stateRoot, "manifest.json");
const queuePath = path.join(stateRoot, "queue.json");
const allowedTop = new Set(["checklists", "decisions", "events", "external-drive", "handoffs", "policies", "programs", "prompts", "reports", "snapshots"]);
const allowedExtensions = new Set([".md", ".json", ".jsonl", ".txt", ".yaml", ".yml"]);
const deniedNames = /(?:^|[._-])(env|secret|token|credential|password|private[-_]?key)(?:$|[._-])/i;
const secretPatterns = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[opusr]_[A-Za-z0-9]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
];

if (!token) throw new Error("SKINHARMONY_MCP_TOKEN is not loaded");
fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });

function redact(input) {
  let text = input.replaceAll("\u0000", "");
  for (const pattern of secretPatterns) text = text.replace(pattern, "[REDACTED]");
  return text;
}

function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink() || deniedNames.test(entry.name)) continue;
    if (entry.isDirectory()) {
      const top = relative.split("/")[0];
      if (allowedTop.has(top)) output.push(...walk(absolute));
      continue;
    }
    if (!entry.isFile() || !allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    if (!relative.includes("/") || allowedTop.has(relative.split("/")[0])) output.push({ absolute, relative });
  }
  return output;
}

async function call(name, args) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body.result;
}

const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { documents: {} };
const pending = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, "utf8")) : [];
const cloudStatusResult = await call("memory_cloud_status", {});
const cloudStatus = cloudStatusResult.structuredContent || JSON.parse(cloudStatusResult.content?.[0]?.text || "{}");
if (cloudStatus.backend !== "postgres") {
  console.error("[cloud-memory] PostgreSQL backend is not configured; sync postponed without creating a queue");
  process.exitCode = 75;
} else {
const candidates = [];
for (const file of walk(root)) {
  const stat = fs.statSync(file.absolute);
  if (stat.size > 250_000) continue;
  const text = redact(fs.readFileSync(file.absolute, "utf8"));
  const content_sha256 = crypto.createHash("sha256").update(text).digest("hex");
  if (previous.documents?.[file.relative]?.content_sha256 === content_sha256) continue;
  candidates.push({ source_path: `SHARED_MEMORY/${file.relative}`, title: path.basename(file.relative), text, content_sha256,
    metadata: { source: "codex_curated_memory", modified_at: stat.mtime.toISOString() } });
}

const work = [...new Map([...pending, ...candidates].map((item) => [item.source_path, item])).values()];
const failed = [];
for (const item of work) {
  try {
    const result = await call("memory_document_upsert", {
      ...item,
      owner_confirmed: true,
      confirmation_reference: "owner-request-cloud-memory-2026-07-14",
    });
    const stored = result.structuredContent || JSON.parse(result.content?.[0]?.text || "{}");
    previous.documents ||= {};
    previous.documents[item.source_path.replace(/^SHARED_MEMORY\//, "")] = {
      content_sha256: stored.content_sha256,
      cloud_id: stored.id,
      synced_at: new Date().toISOString(),
    };
  } catch (error) {
    failed.push(item);
    process.stderr.write(`[cloud-memory] queued ${item.source_path}: ${error.message}\n`);
  }
}
previous.schema_version = "skinharmony_cloud_memory_sync_v1";
previous.root = root;
previous.last_run_at = new Date().toISOString();
previous.pending = failed.length;
fs.writeFileSync(manifestPath, `${JSON.stringify(previous, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(queuePath, `${JSON.stringify(failed, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: failed.length === 0, scanned: walk(root).length, attempted: work.length, pending: failed.length, manifest: manifestPath }));
}
