import assert from "node:assert/strict";
import test from "node:test";

import {
  bindNyraCanonicalIntent,
  finalizeNyraCanonicalIntent,
  nyraCanonicalIntentMessageDigest,
} from "../nyra-canonical-intent.mjs";
import {
  coreOrchestrationVerdictDigest,
  validateCoreOrchestrationVerdict,
} from "../nyra-core-orchestration-verdict.mjs";

function fixture() {
  const message = "Crea un nuovo Work per ripristinare Nyra.";
  const intent = finalizeNyraCanonicalIntent({
    schema_version: "nyra_canonical_intent_v1",
    requested_now: ["work_bootstrap"],
    future_goals: [],
    constraints: [],
    prohibited_actions: [],
    referenced_actions: ["work_bootstrap"],
    owner_reserved_actions: [],
    speech_act: "REQUEST",
    operation_class: "READ_ONLY",
    scope: "WORK",
    target: "work_create",
    work_requirement: "NEW",
    consequential_intent: false,
    confidence: 0.99,
    ambiguity: false,
    safety_signals: [],
    provenance: {
      source: "nyra_dialogue_semantic_intake",
      reason_code: "test_new_work",
      semantic_hint_state: "NOT_PROVIDED",
      raw_text_digest: nyraCanonicalIntentMessageDigest(message),
    },
  }, { message });
  const material = {
    schema_version: "core_orchestration_verdict_v1",
    authority: "UNIVERSAL_CORE",
    verdict: "HOLD",
    reason_codes: ["new_work_identity_required"],
    canonical_intent_binding: bindNyraCanonicalIntent(intent, { message }),
    required_nyra_branches: [{
      id: "quality_verification",
      work_phase: "verification",
      core_branch_bindings: ["test.read"],
    }],
    denied_nyra_branches: [],
    required_roles: ["memory_curator", "planner", "executor_specialist", "independent_verifier"],
    task_graph_digest: "d".repeat(64),
    maximum_parallel_assignments: 2,
    independent_verifier_required: true,
    nyra_materializes_branches: true,
    core_join_required: true,
    permitted_progress: ["ANALYSIS", "PLANNING", "EVIDENCE", "BOUNDED_WORKSPACE"],
    external_execution_authorized: false,
  };
  return {
    intent,
    verdict: { ...material, verdict_digest: coreOrchestrationVerdictDigest(material) },
  };
}

test("validates and freezes the exact Core-selected roles and Nyra branches", () => {
  const { intent, verdict } = fixture();
  const validated = validateCoreOrchestrationVerdict(verdict, {
    canonicalIntentDigest: intent.intent_digest,
    canonicalIntentBindingDigest: verdict.canonical_intent_binding.binding_digest,
  });
  assert.equal(validated.verdict, "HOLD");
  assert.deepEqual(validated.required_roles,
    ["memory_curator", "planner", "executor_specialist", "independent_verifier"]);
  assert.equal(validated.required_nyra_branches[0].id, "quality_verification");
  assert.equal(Object.isFrozen(validated.required_nyra_branches), true);
});

test("fails closed on digest, authority, role, branch or canonical binding drift", () => {
  const { intent, verdict } = fixture();
  for (const changed of [
    { ...verdict, verdict_digest: "f".repeat(64) },
    { ...verdict, authority: "NYRA" },
    { ...verdict, required_roles: [...verdict.required_roles, "untrusted_executor"] },
    { ...verdict, required_nyra_branches: [{ ...verdict.required_nyra_branches[0], id: "../escape" }] },
  ]) {
    assert.throws(() => validateCoreOrchestrationVerdict(changed, {
      canonicalIntentDigest: intent.intent_digest,
    }), /core_orchestration_/);
  }
  assert.throws(() => validateCoreOrchestrationVerdict(verdict, {
    canonicalIntentDigest: "0".repeat(64),
  }), /core_orchestration_verdict_canonical_binding_mismatch/);
});
