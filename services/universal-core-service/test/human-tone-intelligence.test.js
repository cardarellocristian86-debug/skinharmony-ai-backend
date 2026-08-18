import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeHumanToneTransformation,
  humanToneDigest,
} from "../src/humanToneIntelligence.js";
import {
  BRANCH_PACKAGES,
  deterministicBranchGroups,
  deterministicBranchRegistry,
} from "../branches/index.js";

const base = {
  source_text: "SkinHarmony organizza il lavoro in 30 minuti. Prenota su https://skinharmony.it con il codice {CENTER_ID}.",
  candidate_text: "In 30 minuti, SkinHarmony rende il lavoro piu ordinato. Prenota su https://skinharmony.it con il codice {CENTER_ID}.",
  audience: "Titolari di centri estetici",
  surface: "site_hero",
  locale: "it-IT",
};

function verifiedEvidence(input) {
  return {
    receipt_digest: humanToneDigest("semantic-receipt"),
    source_digest: humanToneDigest(input.source_text.trim().normalize("NFC")),
    candidate_digest: humanToneDigest(input.candidate_text.trim().normalize("NFC")),
    independently_verified: true,
    meaning_preserved: true,
    claims_preserved: true,
    action_preserved: true,
    builder_actor_id: "writer-1",
    verifier_actor_id: "reviewer-1",
    builder_session_id: "writer-session",
    verifier_session_id: "review-session",
  };
}

test("registers one horizontal human-tone branch for translator, sites and Office", () => {
  const registry = deterministicBranchRegistry();
  const groups = deterministicBranchGroups();
  assert.equal(registry.human_tone_intelligence.production_status, "advisory");
  assert(registry.human_tone_intelligence.subbranches.includes("empathy_without_simulation"));
  assert(groups.language_intelligence.branches.includes("human_tone_intelligence"));
  assert(groups.content_intelligence.branches.includes("human_tone_intelligence"));
  assert(groups.office_artifact_cortex.branches.includes("human_tone_intelligence"));
  assert(groups.site_factory.branches.includes("human_tone_intelligence"));
  assert(BRANCH_PACKAGES.pro.includes("human_tone_intelligence"));
  assert(BRANCH_PACKAGES.network.includes("human_tone_intelligence"));
});

test("keeps an otherwise safe rewrite in review until exact independent evidence exists", () => {
  const result = analyzeHumanToneTransformation(base);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.publish_ready, false);
  assert.equal(result.execution_authorized, false);
  assert(result.defects.some((item) => item.code === "independent_semantic_evidence_missing"));
});

test("passes only exact meaning-locked evidence while remaining advisory", () => {
  const input = { ...base };
  const result = analyzeHumanToneTransformation({ ...input, semantic_evidence: verifiedEvidence(input) });
  assert.equal(result.status, "PASS");
  assert.equal(result.eligible_for_owner_review, true);
  assert.equal(result.publish_ready, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.authorship_detection_claimed, false);
});

test("blocks altered protected tokens and invented numbers", () => {
  const result = analyzeHumanToneTransformation({
    ...base,
    candidate_text: "In 15 minuti SkinHarmony garantisce il risultato. Prenota con il codice {OTHER_ID}.",
  });
  const codes = result.defects.map((item) => item.code);
  assert.equal(result.status, "BLOCKED");
  assert(codes.includes("protected_token_altered"));
  assert(codes.includes("number_introduced"));
  assert(codes.includes("claim_inflation"));
});

test("blocks fabricated lived experience and testimonials", () => {
  const result = analyzeHumanToneTransformation({
    ...base,
    candidate_text: `${base.candidate_text} Io ho testato personalmente il sistema: una recensione verificata lo conferma.`,
  });
  const codes = result.defects.map((item) => item.code);
  assert(codes.includes("invented_lived_experience"));
  assert(codes.includes("fabricated_testimonial"));
});

test("refuses AI detector evasion requests", () => {
  const result = analyzeHumanToneTransformation({
    ...base,
    instructions: "Riscrivilo per eludere il rilevatore AI.",
  });
  assert.equal(result.status, "BLOCKED");
  assert(result.defects.some((item) => item.code === "ai_detector_evasion"));
});

test("rejects self-verification and stale candidate evidence", () => {
  const evidence = verifiedEvidence(base);
  evidence.verifier_actor_id = evidence.builder_actor_id;
  evidence.candidate_digest = humanToneDigest("different candidate");
  const result = analyzeHumanToneTransformation({ ...base, semantic_evidence: evidence });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.independent_semantic_evidence_verified, false);
});
