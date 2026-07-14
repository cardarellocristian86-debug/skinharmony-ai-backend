import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "src/universalSoftwareIntelligence.js",
  "src/ghidraHeadlessAdapter.js",
  "src/fridaLocalAdapter.js",
  "vendor-manifests/software-intelligence-components.json",
  "vendor-manifests/software-intelligence-sbom.cdx.json",
  "test/universal-software-intelligence.test.js",
  "test/ghidra-headless-adapter.test.js",
  "test/ghidra-container-launcher.test.js",
  "test/frida-local-adapter.test.js",
  "workers/ghidra/Containerfile",
  "workers/ghidra/run-analysis.sh",
  "workers/ghidra/UniversalEvidenceExporter.java",
  "workers/ghidra/ghidra-container-launcher.mjs",
  "workers/ghidra/build-image.sh",
  "workers/ghidra/README.md",
  "workers/local-agent/frida-local-agent.py",
  "workers/local-agent/ghidra-local-launcher.mjs",
  "workers/local-agent/README.md",
];
const forbidden = [/skinharmony/i, /beauty/i, /cosmetic/i, /skin[_-]?harmony[_-]?domain/i, /brand_scope/i];
const violations = [];
for (const relative of targets) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  for (const expression of forbidden) if (expression.test(text)) violations.push(`${relative}:${expression}`);
}
if (violations.length) {
  console.error(JSON.stringify({ ok: false, violations }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checked: targets, forbidden_patterns: forbidden.map(String) }, null, 2));
