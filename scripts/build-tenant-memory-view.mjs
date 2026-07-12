#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const source = path.resolve(process.argv[2] || "shared-work-memory/archive/connector-memory");
const root = path.resolve(process.argv[3] || "shared-work-memory");
const tenantId = String(process.argv[4] || "owner-private");
if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(tenantId)) throw new Error("Invalid tenant id");
const target = path.join(root, "tenants", tenantId, "documents");
const textExtensions = new Set([".md", ".txt", ".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml", ".js", ".mjs", ".ts", ".html", ".css", ".xml"]);
const secretPatterns = [
  /(authorization\s*:\s*bearer\s+)[^\s"']+/gi,
  /((?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[=:]\s*)[^\s,"']+/gi,
  /\bsk-[a-z0-9_-]{12,}\b/gi
];
const documents = [];

function redact(text) {
  let value = text;
  let count = 0;
  for (const pattern of secretPatterns) value = value.replace(pattern, (...args) => { count += 1; return args[1] ? `${args[1]}[REDACTED]` : "[REDACTED]"; });
  return { value, count };
}

function walk(dir, relative = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    const from = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(from, rel);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) {
      const raw = fs.readFileSync(from, "utf8");
      const cleaned = redact(raw.replaceAll("\u0000", ""));
      const id = crypto.createHash("sha256").update(rel).digest("hex").slice(0, 24);
      const record = { id, title: path.basename(rel), source_path: rel.split(path.sep).join("/"), text: cleaned.value, redactions: cleaned.count };
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, `${id}.json`), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      documents.push({ id, title: record.title, source_path: record.source_path, redactions: record.redactions, bytes: Buffer.byteLength(record.text) });
    }
  }
}

fs.rmSync(target, { recursive: true, force: true });
walk(source);
const manifest = { schema_version: "tenant_memory_view_v1", generated_at: new Date().toISOString(), tenant_id: tenantId, document_count: documents.length, redaction_count: documents.reduce((n, d) => n + d.redactions, 0), documents };
fs.mkdirSync(path.join(root, "tenants", tenantId), { recursive: true });
fs.writeFileSync(path.join(root, "tenants", tenantId, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, tenant_id: tenantId, document_count: manifest.document_count, redaction_count: manifest.redaction_count }, null, 2));
