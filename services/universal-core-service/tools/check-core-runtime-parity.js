import assert from "node:assert/strict";
import { createCoreRuntimeWorker } from "../src/coreRuntimeWorker.js";
import { compareDigestParity, runDigestV1Canonical } from "../src/coreRuntimeHierarchy.js";

const worker = createCoreRuntimeWorker({ timeoutMs: 5_000 });
const total = Math.max(1, Math.min(100_000, Number(process.argv[2] || 10_000)));
let matched = 0;

try {
  await worker.health();
  for (let index = 0; index < total; index += 1) {
    const score = (index * 37) % 101;
    const value = {
      request_id: `parity-${index}`,
      generated_at: "2026-07-15T00:00:00.000Z",
      domain: "custom",
      context: { tenant_id: "parity", metadata: {} },
      signals: [{ id: "signal", source: "parity", category: "test", label: "Parity", value: score, normalized_score: score, severity_hint: score, confidence_hint: (index * 13) % 101, reliability_hint: (index * 17) % 101, friction_hint: (index * 19) % 101, risk_hint: (index * 23) % 101, reversibility_hint: (index * 29) % 101, trend: { consecutive_count: index % 5, stability_score: (index * 31) % 101 }, tags: index % 7 === 0 ? ["system"] : [] }],
      data_quality: { score: (index * 11) % 101, completeness: 90, freshness: 90, consistency: 90, reliability: 90 },
      constraints: { allow_automation: index % 3 === 0, require_confirmation: index % 5 === 0, blocked_actions: [], blocked_action_rules: index % 11 === 0 ? [{ scope: "test", reason_code: "parity", severity: 80, blocks_execution: true }] : [] },
    };
    const comparison = compareDigestParity(runDigestV1Canonical(value), await worker.digest(value));
    assert.equal(comparison.matched, true, `parity mismatch at case ${index}`);
    matched += 1;
  }
  console.log(JSON.stringify({ ok: true, contract: "core_runtime_hierarchy_v1", cases: total, matched }));
} finally {
  worker.close();
}
