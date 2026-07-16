import assert from "node:assert/strict";
import test from "node:test";
import { deterministicBranchGroups, deterministicBranchRegistry, getBranch } from "../branches/index.js";
import { nyraBranchCatalog } from "../src/nyraBranchNetwork.js";

test("SkinAnalyzer and Scalp expose deep governed acquisition and learning branches", () => {
  const registry = deterministicBranchRegistry(); const skin = registry.skinharmony_analyzer; const scalp = registry.scalp_analyzer;
  assert(skin); assert(scalp);
  for (const id of ["acquisition_quality_gate", "longitudinal_comparability", "uncertainty_abstention", "skin_tone_fairness_audit", "verified_outcome_learning", "human_review_release"]) assert(skin.subbranches.includes(id), `missing SkinAnalyzer subbranch ${id}`);
  for (const id of ["scalp_acquisition_quality", "capture_comparability", "reported_warning_stop", "drift_detection", "learning_candidate_release", "medical_study_dossier", "salon_trichology_consultation"]) assert(scalp.subbranches.includes(id), `missing Scalp subbranch ${id}`);
  const definition = getBranch("scalp_analyzer"); assert.equal(definition.guardrails.allowed_action_level, "read_only_cosmetic_advisory"); assert(definition.guardrails.blocked_actions.includes("medical_diagnosis")); assert(deterministicBranchGroups().beauty_cortex.branches.includes("scalp_analyzer"));
});

test("Nyra analyzer domain binds both vertical Core branches without exceeding limits", () => {
  const catalog = nyraBranchCatalog("analyzer"); const analyzer = catalog.branches.find((branch) => branch.id === "analyzer_domain");
  assert(analyzer); assert(analyzer.core_branch_bindings.includes("skinharmony_analyzer")); assert(analyzer.core_branch_bindings.includes("scalp_analyzer")); assert(analyzer.subbranch_count <= catalog.maximum_subbranches_per_branch); assert(analyzer.subbranches.includes("verified_outcome_learning"));
});
