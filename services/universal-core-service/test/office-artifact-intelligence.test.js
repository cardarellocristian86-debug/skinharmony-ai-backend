import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfficeArtifactPlan,
  evaluateOfficeArtifactQuality,
  officeArtifactDigest,
} from "../src/officeArtifactIntelligence.js";
import {
  deterministicBranchGroups,
  deterministicBranchRegistry,
  getBranch,
} from "../branches/index.js";

const d = (value) => officeArtifactDigest(value);

function plan(overrides = {}) {
  return buildOfficeArtifactPlan({
    artifact_id: "pitch_alpha",
    kind: "mixed",
    title: "Pitch and operating dossier",
    audience: "Investors and operating leadership",
    purpose: "Explain the opportunity with traceable evidence and an executable operating model.",
    source_locale: "it-IT",
    target_locales: ["en-US"],
    brand_profile_id: "skinharmony",
    source_revision_digest: d("source-v1"),
    planned_units: 4,
    checkpoint_interval: 2,
    sections: [
      { section_id: "problem", title: "Problem", purpose: "Establish the need.", unit_budget: 2, required_claim_ids: ["claim_problem"] },
      { section_id: "solution", title: "Solution", purpose: "Explain the governed solution.", unit_budget: 2, required_claim_ids: ["claim_solution"] },
    ],
    ...overrides,
  });
}

function checkpoints(planRecord) {
  let previous = null;
  return planRecord.context_ledger.checkpoint_units.map((unitNumber) => {
    const record = {
    unit_number: unitNumber,
    plan_digest: planRecord.plan_digest,
    source_revision_digest: planRecord.source_revision_digest,
    facts_digest: d(`facts-${unitNumber}`),
    claims_digest: d(`claims-${unitNumber}`),
    terminology_digest: d(`terms-${unitNumber}`),
    decisions_digest: d(`decisions-${unitNumber}`),
    open_questions_digest: d(`questions-${unitNumber}`),
      completed_section_ids: planRecord.sections
        .filter((section) => section.order <= Math.ceil((unitNumber / planRecord.planned_units) * planRecord.sections.length))
        .map((section) => section.section_id),
      previous_checkpoint_digest: previous,
    };
    record.checkpoint_digest = officeArtifactDigest(record);
    previous = record.checkpoint_digest;
    return record;
  });
}

function evidence(planRecord) {
  return {
    plan_digest: planRecord.plan_digest,
    source_revision_digest: planRecord.source_revision_digest,
    receipt_digest: d("independent-visual-receipt"),
    independently_verified: true,
    builder_actor_id: "builder-1",
    verifier_actor_id: "verifier-1",
    builder_session_id: "builder-session",
    verifier_session_id: "verifier-session",
    units: Array.from({ length: planRecord.planned_units }, (_, index) => ({
      unit_number: index + 1,
      section_id: index < 2 ? "problem" : "solution",
      rendered: true,
      blank_ratio: 0.25,
      required_content_present: true,
      clipped_text_count: 0,
      overflow_count: 0,
      unintended_overlap_count: 0,
      unresolved_placeholder_count: 0,
      reading_order_valid: true,
      layout_consistent: true,
      minimum_font_pt: planRecord.layout_contract.minimum_font_pt,
      sequence_marker_valid: true,
      title_overflow: false,
    })),
    charts: [{
      chart_id: "market",
      data_source_digest: d("market-data"),
      values_match_source: true,
      title: "Addressable market by segment",
      labels_legible: true,
      bounds_valid: true,
      alt_text: "Bar chart comparing the addressable market across three segments.",
      axis_titles_required: true,
      axis_titles_present: true,
      legend_required: true,
      legend_present: true,
    }],
    images: [{
      image_id: "hero",
      provenance_digest: d("image-generation-receipt"),
      rights_status: "generated",
      bounds_valid: true,
      crop_valid: true,
      resolution_ok: true,
      text_ocr_match: true,
      decorative: false,
      alt_text: "Abstract visualization of governed software intelligence.",
      reuse_count: 1,
    }],
    context_checkpoints: checkpoints(planRecord),
    formula_error_count: 0,
    key_totals_reconciled: true,
    full_visual_inventory: true,
    claims_reconciled: true,
    context_contradiction_count: 0,
  };
}

test("registers the Office Artifact Cortex and horizontal typography guard", () => {
  const registry = deterministicBranchRegistry();
  assert.equal(registry.office_artifact_intelligence.production_status, "advisory");
  assert.equal(getBranch("office_artifact_intelligence").guardrails.maximum_planned_units, 200);
  assert(registry.typography_layout_guard.subbranches.includes("overflow_overlap_detection"));
  const group = deterministicBranchGroups().office_artifact_cortex;
  assert(group.branches.includes("office_artifact_intelligence"));
  assert(group.branches.includes("typography_layout_guard"));
  assert(group.branches.includes("human_tone_intelligence"));
  assert(group.branches.includes("ramo_testo"));
  assert(group.branches.includes("translation_governance"));
});

test("builds a deterministic bounded plan with context checkpoints", () => {
  const first = plan();
  const second = plan();
  assert.deepEqual(first, second);
  assert.deepEqual(first.context_ledger.checkpoint_units, [2, 4]);
  assert.equal(first.execution_authorized, false);
  assert.throws(() => plan({ planned_units: 201 }), /office_artifact_planned_units_invalid/);
  assert.throws(() => plan({ planned_units: 5 }), /office_artifact_section_budget_mismatch/);
});

test("passes only complete independently verified rendered evidence", () => {
  const artifactPlan = plan();
  const result = evaluateOfficeArtifactQuality(artifactPlan, evidence(artifactPlan));
  assert.equal(result.status, "PASS");
  assert.equal(result.release_eligible, true);
  assert.equal(result.defects.length, 0);
  assert.equal(result.execution_authorized, false);
});

test("blocks half-filled pages, clipping, overflow and overlap", () => {
  const artifactPlan = plan();
  const attacked = evidence(artifactPlan);
  attacked.units[1] = {
    ...attacked.units[1],
    blank_ratio: 0.98,
    required_content_present: false,
    clipped_text_count: 2,
    overflow_count: 1,
    unintended_overlap_count: 3,
  };
  const result = evaluateOfficeArtifactQuality(artifactPlan, attacked);
  assert.equal(result.status, "BLOCKED");
  const codes = result.defects.map((item) => item.code);
  for (const code of ["blank_or_partial_unit", "required_content_missing", "clipped_text", "content_outside_canvas", "unintended_overlap"]) {
    assert(codes.includes(code), code);
  }
});

test("blocks lost context, stale checkpoints and sample-only review", () => {
  const artifactPlan = plan();
  const attacked = evidence(artifactPlan);
  attacked.context_checkpoints.pop();
  attacked.context_checkpoints[0].source_revision_digest = d("stale");
  attacked.context_contradiction_count = 1;
  attacked.full_visual_inventory = false;
  const result = evaluateOfficeArtifactQuality(artifactPlan, attacked);
  const codes = result.defects.map((item) => item.code);
  assert(codes.includes("context_checkpoint_missing"));
  assert(codes.includes("context_checkpoint_source_mismatch"));
  assert(codes.includes("long_context_contradiction"));
  assert(codes.includes("sample_only_visual_review"));
});

test("blocks chart fabrication and malformed images", () => {
  const artifactPlan = plan();
  const attacked = evidence(artifactPlan);
  attacked.charts[0].values_match_source = false;
  attacked.charts[0].bounds_valid = false;
  attacked.images[0].crop_valid = false;
  attacked.images[0].text_ocr_match = false;
  attacked.images[0].rights_status = "unknown";
  const result = evaluateOfficeArtifactQuality(artifactPlan, attacked);
  const codes = result.defects.map((item) => item.code);
  for (const code of ["chart_data_mismatch", "chart_outside_layout", "image_crop_invalid", "image_text_corrupted", "image_rights_unverified"]) {
    assert(codes.includes(code), code);
  }
});

test("blocks unreadable typography, broken context chain and unjustified image reuse", () => {
  const artifactPlan = plan();
  const attacked = evidence(artifactPlan);
  attacked.units[0].minimum_font_pt = 6;
  attacked.units[0].sequence_marker_valid = false;
  attacked.units[0].title_overflow = true;
  attacked.context_checkpoints[1].previous_checkpoint_digest = d("wrong-parent");
  attacked.images[0].reuse_count = 3;
  const result = evaluateOfficeArtifactQuality(artifactPlan, attacked);
  const codes = result.defects.map((item) => item.code);
  for (const code of [
    "font_below_readability_floor", "pagination_or_slide_number_invalid", "title_overflow",
    "context_checkpoint_chain_broken", "image_reused_without_reason",
  ]) assert(codes.includes(code), code);
});

test("blocks builder self-verification and session reuse", () => {
  const artifactPlan = plan();
  const attacked = evidence(artifactPlan);
  attacked.verifier_actor_id = attacked.builder_actor_id;
  attacked.verifier_session_id = attacked.builder_session_id;
  const result = evaluateOfficeArtifactQuality(artifactPlan, attacked);
  assert(result.defects.some((item) => item.code === "builder_self_verification"));
  assert(result.defects.some((item) => item.code === "builder_verifier_session_reuse"));
});

test("rejects a tampered plan rather than trusting caller quality fields", () => {
  const artifactPlan = { ...plan(), title: "Tampered title" };
  assert.throws(() => evaluateOfficeArtifactQuality(artifactPlan, { release_eligible: true }),
    /office_artifact_plan_digest_mismatch/);
});

test("supports a complete 200-unit plan without sampling", () => {
  const longPlan = plan({
    artifact_id: "long_dossier",
    kind: "document",
    planned_units: 200,
    checkpoint_interval: 20,
    sections: [
      { section_id: "front", title: "Front matter", purpose: "Orient the reader.", unit_budget: 10 },
      { section_id: "body", title: "Body", purpose: "Provide the complete analysis.", unit_budget: 180 },
      { section_id: "appendix", title: "Appendix", purpose: "Preserve evidence and references.", unit_budget: 10 },
    ],
  });
  const longEvidence = evidence(longPlan);
  longEvidence.units = Array.from({ length: 200 }, (_, index) => ({
    unit_number: index + 1,
    section_id: index < 10 ? "front" : index < 190 ? "body" : "appendix",
    rendered: true,
    blank_ratio: 0.3,
    required_content_present: true,
    clipped_text_count: 0,
    overflow_count: 0,
    unintended_overlap_count: 0,
    unresolved_placeholder_count: 0,
    reading_order_valid: true,
    layout_consistent: true,
    minimum_font_pt: longPlan.layout_contract.minimum_font_pt,
    sequence_marker_valid: true,
    title_overflow: false,
  }));
  longEvidence.context_checkpoints = checkpoints(longPlan);
  const result = evaluateOfficeArtifactQuality(longPlan, longEvidence);
  assert.equal(result.status, "PASS");
  assert.equal(result.checked_unit_count, 200);
});
