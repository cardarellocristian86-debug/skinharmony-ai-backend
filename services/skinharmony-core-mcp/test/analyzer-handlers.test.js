import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyzerHandlers, interpretScalp } from "../src/analyzer-handlers.js";

test("Scalp Analyzer produces read-only non-diagnostic priorities without tenant data", async () => {
  const result = interpretScalp({
    overall: { density_index: 54, miniaturization_index: 38, desquamation_percent: 22, redness_percent: 12, confidence: 0.9 },
    zones: [{ zone: "frontal", metrics: { density_index: 42, confidence: 0.8 } }],
    acquisition: { device_model: "test-scope", magnification: "50x", capture_protocol_id: "scalp_standard", polarization: "polarized", focus_score: 90, illumination_score: 88, zone_coverage_score: 85 },
    locale: "it",
  });
  assert.equal(result.ok, true);
  assert.equal(result.schema_version, "scalp_analyzer_interpretation_v2");
  assert.equal(result.governance.tenant_scoped, true);
  assert.equal(result.governance.execution_allowed, false);
  assert.equal(result.governance.diagnosis_allowed, false);
  assert.equal(result.governance.raw_images_received, false);
  assert.equal("tenant_id" in result, false);
  assert.match(result.safety_boundary, /non diagnostica/);
  assert.equal(result.zones[0].zone, "frontal");
  assert.equal(result.data_quality.abstained, false);

  const viaHandler = await createAnalyzerHandlers().scalp_analyzer({ overall: { confidence: 0.4 } });
  assert.equal(viaHandler.structuredContent.data_quality.repeat_acquisition_recommended, true);
});

test("Scalp Analyzer abstains on poor acquisition and stops cosmetic interpretation on reported warnings", () => {
  const result = interpretScalp({ overall: { density_index: 20, confidence: 0.92 }, acquisition: { device_model: "test-scope", magnification: "50x", capture_protocol_id: "scalp_standard", focus_score: 30, illumination_score: 40, zone_coverage_score: 45 }, reported_warning_signals: ["pain", "open_lesion"] });
  assert.equal(result.data_quality.abstained, true); assert.equal(result.dominant_pattern, null);
  assert.equal(result.warning_gate.stop_cosmetic_interpretation, true); assert.equal(result.warning_gate.professional_review_recommended, true); assert.equal(result.suggested_direction, null);
});

test("Scalp Analyzer exposes deltas and learning candidates only for verified comparable captures", () => {
  const acquisition = { device_model: "test-scope", magnification: "50x", capture_protocol_id: "scalp_standard", polarization: "polarized", focus_score: 90, illumination_score: 90, zone_coverage_score: 90 };
  const result = interpretScalp({ overall: { density_index: 60, shaft_caliber_index: 70, confidence: 0.9 }, acquisition, previous: { overall: { density_index: 55, shaft_caliber_index: 68, confidence: 0.9 }, acquisition }, learning_context: { outcome_verified: true, human_reviewed: true, comparable_capture_count: 3 } });
  assert.equal(result.longitudinal.comparable, true); assert.equal(result.longitudinal.deltas.density_index, 5); assert.equal(result.learning.eligible_candidate, true); assert.equal(result.learning.activation_allowed, false); assert.equal(result.governance.live_weight_mutation_allowed, false);
  const mismatch = interpretScalp({ overall: { confidence: 0.9 }, acquisition, previous: { overall: { confidence: 0.9 }, acquisition: { ...acquisition, magnification: "200x" } }, learning_context: { outcome_verified: true, human_reviewed: true, comparable_capture_count: 5 } });
  assert.equal(mismatch.longitudinal.comparable, false); assert.equal(mismatch.learning.eligible_candidate, false);
});

test("Scalp Analyzer separates medical, salon and pharmacy communication without impersonation", () => {
  const acquisition = { device_model: "test-scope", magnification: "50x", capture_protocol_id: "scalp_standard", polarization: "polarized", focus_score: 90, illumination_score: 90, zone_coverage_score: 90 };
  const base = { overall: { density_index: 58, shaft_caliber_index: 62, confidence: 0.9 }, acquisition };
  const medical = interpretScalp({ ...base, professional_profile: "medical_study" });
  assert.equal(medical.professional_context.output_mode, "clinician_review_dossier"); assert.equal(medical.professional_context.clinician_review_required, true); assert.equal(medical.communication.marketing_allowed, false);
  const salon = interpretScalp({ ...base, professional_profile: "salon_trichology" });
  assert.equal(salon.professional_context.output_mode, "technical_cosmetic_consultation"); assert.equal(salon.communication.marketing_allowed, true); assert.match(salon.communication.cta, /consulenza tricologica cosmetica/i);
  const pharmacy = interpretScalp({ ...base, professional_profile: "pharmacy_dermocosmetic" });
  assert.equal(pharmacy.professional_context.output_mode, "dermocosmetic_counselling"); assert(pharmacy.professional_context.blocked.includes("drug_recommendation"));
  for (const result of [medical, salon, pharmacy]) { assert.equal(result.governance.impersonation_allowed, false); assert.equal(result.governance.medical_conclusion_allowed, false); assert.equal(result.governance.marketing_auto_publish_allowed, false); }
});
