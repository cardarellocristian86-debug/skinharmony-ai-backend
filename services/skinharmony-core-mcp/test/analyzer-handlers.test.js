import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyzerHandlers, interpretScalp } from "../src/analyzer-handlers.js";

test("Scalp Analyzer produces read-only non-diagnostic priorities without tenant data", async () => {
  const result = interpretScalp({
    overall: { density_index: 54, miniaturization_index: 38, desquamation_percent: 22, redness_percent: 12, confidence: 0.9 },
    zones: [{ zone: "frontal", metrics: { density_index: 42, confidence: 0.8 } }],
    locale: "it",
  });
  assert.equal(result.ok, true);
  assert.equal(result.schema_version, "scalp_analyzer_interpretation_v1");
  assert.equal(result.governance.tenant_scoped, true);
  assert.equal(result.governance.execution_allowed, false);
  assert.equal(result.governance.diagnosis_allowed, false);
  assert.equal(result.governance.raw_images_received, false);
  assert.equal("tenant_id" in result, false);
  assert.match(result.safety_boundary, /non diagnostica/);
  assert.equal(result.zones[0].zone, "frontal");

  const viaHandler = await createAnalyzerHandlers().scalp_analyzer({ overall: { confidence: 0.4 } });
  assert.equal(viaHandler.structuredContent.data_quality.repeat_acquisition_recommended, true);
});
