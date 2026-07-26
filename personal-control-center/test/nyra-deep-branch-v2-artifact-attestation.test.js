"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const catalogPath = path.join(repoRoot, "personal-control-center/data/nyra-deep-branch-v2.catalog.json");
const reportPath = path.join(repoRoot, "reports/nyra-deep-v2/validation_report.json");

test("runtime artifact validation binding ignores volatile measurement fields but detects semantic drift", async () => {
  const { validationAttestationHash } = await import("../../scripts/lib/nyra-deep-branch-v2-shards.mjs");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const baseline = validationAttestationHash(report, catalog);

  const volatileOnly = structuredClone(report);
  volatileOnly.generated_at = "2099-01-01T00:00:00.000Z";
  volatileOnly.runtime_evidence = { generated_at: "2099-01-01T00:00:00.000Z", benchmark: { p95_ms: 999 } };
  volatileOnly.final_runtime_gate = { passed: true, observed_at: "2099-01-01T00:00:00.000Z" };
  volatileOnly.runtime_artifact = { manifest_hash: "f".repeat(64), generated_at: "2099-01-01T00:00:00.000Z" };
  assert.equal(validationAttestationHash(volatileOnly, catalog), baseline);

  const semanticDrift = structuredClone(report);
  semanticDrift.validation.metrics.node_count -= 1;
  assert.notEqual(validationAttestationHash(semanticDrift, catalog), baseline);
});
