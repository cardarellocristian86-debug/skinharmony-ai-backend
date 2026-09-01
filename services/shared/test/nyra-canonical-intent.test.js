import assert from "node:assert/strict";
import test from "node:test";

import {
  bindNyraCanonicalIntent,
  finalizeNyraCanonicalIntent,
  nyraCanonicalIntentMessageDigest,
  validateNyraCanonicalIntent,
} from "../nyra-canonical-intent.mjs";

function envelope(message, overrides = {}) {
  return finalizeNyraCanonicalIntent({
    schema_version: "nyra_canonical_intent_v1",
    requested_now: [],
    future_goals: [],
    constraints: [],
    prohibited_actions: [],
    referenced_actions: [],
    owner_reserved_actions: [],
    speech_act: "QUESTION",
    operation_class: "READ_ONLY",
    scope: "GLOBAL",
    target: "advisory_read",
    work_requirement: "NONE",
    consequential_intent: false,
    confidence: 0.99,
    ambiguity: false,
    safety_signals: [],
    ...overrides,
    provenance: {
      source: "nyra_dialogue_semantic_intake",
      reason_code: "test_intent",
      semantic_hint_state: "NOT_PROVIDED",
      raw_text_digest: nyraCanonicalIntentMessageDigest(message),
      ...(overrides.provenance || {}),
    },
  }, { message });
}

test("finalizes one immutable provider-neutral Intent envelope and binding", () => {
  const message = "Crea la pull request; il merge lo faccio io.";
  const intent = envelope(message, {
    requested_now: ["pull_request"],
    referenced_actions: ["pull_request", "merge"],
    owner_reserved_actions: ["merge", "release"],
    speech_act: "REQUEST",
    operation_class: "EXTERNAL_MUTATION",
    scope: "WORK",
    target: "ticket_or_action",
    work_requirement: "EXISTING",
    consequential_intent: true,
  });
  const binding = bindNyraCanonicalIntent(intent, { message });

  assert.deepEqual(intent.requested_now, ["pull_request"]);
  assert.deepEqual(intent.owner_reserved_actions, ["merge", "release"]);
  assert.equal(Object.isFrozen(intent), true);
  assert.equal(Object.isFrozen(intent.requested_now), true);
  assert.equal(binding.intent_digest, intent.intent_digest);
  assert.equal(binding.operation_class, "EXTERNAL_MUTATION");
  assert.match(binding.binding_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateNyraCanonicalIntent(intent, { message }), intent);
});

test("requested_now is disjoint from future, prohibited and owner-reserved actions", () => {
  const message = "Più avanti crea la PR; merge manuale owner; non fare deploy.";
  for (const overlap of [
    { future_goals: ["pull_request"] },
    { prohibited_actions: ["pull_request"] },
    { owner_reserved_actions: ["pull_request"] },
  ]) {
    assert.throws(() => envelope(message, {
      requested_now: ["pull_request"],
      operation_class: "EXTERNAL_MUTATION",
      scope: "WORK",
      target: "ticket_or_action",
      work_requirement: "EXISTING",
      consequential_intent: true,
      ...overlap,
    }), /nyra_canonical_intent_temporal_authority_overlap/);
  }
});

test("canonical semantics, exact shape, digest and raw-message provenance fail closed", () => {
  const message = "Cosa ti manca?";
  const intent = envelope(message);

  assert.throws(() => validateNyraCanonicalIntent({
    ...intent,
    execution_authorized: true,
  }, { message }), /nyra_canonical_intent_shape_invalid/);
  assert.throws(() => validateNyraCanonicalIntent({
    ...intent,
    intent_digest: "f".repeat(64),
  }, { message }), /nyra_canonical_intent_digest_mismatch/);
  assert.throws(() => validateNyraCanonicalIntent(intent, {
    message: "Un altro messaggio",
  }), /nyra_canonical_intent_message_binding_mismatch/);
  assert.throws(() => envelope(message, {
    operation_class: "EXTERNAL_MUTATION",
  }), /nyra_canonical_intent_semantics_invalid/);
});
