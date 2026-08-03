import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_WORK_FAILURE_CLASS,
  AI_WORK_FAILURE_CODES,
  AI_WORK_FAILURE_DISPOSITION,
  AI_WORK_QUALITY_INVARIANTS,
  AI_WORK_ROLLOUT_TIER,
  assertAiWorkAuthorityInvariant,
  aiWorkQualityEvidenceBindingReference,
  assertAiWorkFailureCode,
  buildAiWorkQualityObservation,
  buildDeterministicQualityExplanationInputs,
  getAiWorkFailureDefinition,
  redactAiWorkQualityValue,
  verifyAiWorkQualityObservation,
} from "../ai-work-quality-failure.js";

test("uses a closed exact-code taxonomy with c36 hardening codes", () => {
  assert.ok(AI_WORK_FAILURE_CODES.length >= 32);
  assert.deepEqual(getAiWorkFailureDefinition("PROMPT_INJECTION_DETECTED"), {
    code: "PROMPT_INJECTION_DETECTED",
    failure_class: AI_WORK_FAILURE_CLASS.SECURITY_BOUNDARY,
    disposition: AI_WORK_FAILURE_DISPOSITION.ABSOLUTE,
  });
  assert.equal(getAiWorkFailureDefinition("PROMPT_INJECTION_DETECTED_extra"), null);
  assert.throws(() => assertAiWorkFailureCode("TEST_FAILED_AND_MORE"), /ai_work_failure_code_unknown/);
});

test("normalizes and digests an evidence-bound observation", () => {
  const bindingInput = {
    tenant_id: "codexai", work_id: "work-1", attempt_id: "attempt-1",
    observer_id: "verifier-1", observer_session_id: "session-1",
    expected_state_digest: `sha256:${"b".repeat(64)}`,
    observed_state_digest: `sha256:${"c".repeat(64)}`,
  };
  const observation = buildAiWorkQualityObservation({
    observation_id: "obs-1",
    tenant_id: "codexai",
    work_id: "work-1",
    attempt_id: "attempt-1",
    observer_id: "verifier-1",
    observer_session_id: "session-1",
    code: "FALSE_COMPLETION_CLAIM",
    rollout_tier: AI_WORK_ROLLOUT_TIER.SANDBOX_ACTIVE,
    summary: "Completion was claimed before the test receipt existed.",
    evidence: ["test receipt missing", "test receipt missing", "api_key=sk-proj-abcdefghijklmnop"],
    evidence_receipts: [{
      artifact_id: "artifact-1",
      content_digest: `sha256:${"a".repeat(64)}`,
      source_reference: "test-run-1",
      registry_reference: aiWorkQualityEvidenceBindingReference(bindingInput),
    }],
    expected_state_digest: `sha256:${"b".repeat(64)}`,
    observed_state_digest: `sha256:${"c".repeat(64)}`,
    created_at: "2026-08-03T10:00:00.000Z",
  });
  assert.equal(observation.evidence.length, 2);
  assert.equal(observation.evidence[1], "[REDACTED_SECRET]");
  assert.equal(verifyAiWorkQualityObservation(observation), true);
  assert.equal(verifyAiWorkQualityObservation({ ...observation, summary: "tampered" }), false);

  const explanation = buildDeterministicQualityExplanationInputs(observation);
  assert.equal(explanation.observation_digest, observation.observation_digest);
  assert.equal(explanation.required_core_outcome, "NEW_CORE_VERDICT_REQUIRED");
});

test("requires evidence and preserves Core authority", () => {
  assert.throws(() => buildAiWorkQualityObservation({
    observation_id: "obs-2",
    tenant_id: "codexai",
    work_id: "work-2",
    observer_id: "verifier-2",
    observer_session_id: "session-2",
    code: "TEST_FAILED",
    summary: "A test failed.",
  }), /observation_verified_evidence_required/);
  assert.equal(AI_WORK_QUALITY_INVARIANTS.core_is_only_allow_authority, true);
  assert.throws(() => assertAiWorkAuthorityInvariant({ actor_role: "nyra", requested_outcome: "ALLOW" }), /core_allow_authority_required/);
  assert.equal(assertAiWorkAuthorityInvariant({ actor_role: "universal_core", requested_outcome: "ALLOW" }), true);
  assert.throws(() => assertAiWorkAuthorityInvariant({ actor_role: "worker", requested_outcome: "CLOSED" }), /independent_verification_required/);
});

test("redacts JWT and GitHub tokens recursively without retaining raw substrings", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz";
  const github = "github_pat_11AA22BB33CC44DD55EE66FF";
  const redacted = redactAiWorkQualityValue({
    outer: [{ message: `receipt ${jwt}`, nested: { value: github } }],
  });
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes(jwt), false);
  assert.equal(serialized.includes(github), false);
  assert.match(serialized, /REDACTED_SECRET/);
});
