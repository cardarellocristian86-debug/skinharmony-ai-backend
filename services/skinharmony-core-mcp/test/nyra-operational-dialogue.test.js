import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNyraOperationalDialogue,
  diagnoseNyraOperationalState,
  NYRA_OPERATING_MANUAL_VERSION,
} from "../src/nyra-operational-dialogue.js";

const continuity = {
  tenant_id: "tenant-a",
  project_id: "skinharmony-ai-backend",
  work_id: "11111111-1111-4111-8111-111111111111",
  intent_digest: "a".repeat(64),
  next_action: "Implement and verify the bounded change.",
};

test("Nyra dialogue binds Intent, checkpoint, Gallery and software cognition without raw evidence", () => {
  const dialogue = buildNyraOperationalDialogue({
    continuity,
    assignment: { assignment_id: "22222222-2222-4222-8222-222222222222" },
    operational: {
      work_revision: 9,
      checkpoint: { capsule_id: "capsule-9", capsule_digest: "b".repeat(64) },
      gallery: { state: "available", work_count: 3 },
      software: {
        state: "available",
        atlas_revision: 12,
        source_hash: "c".repeat(64),
        context_digest: "d".repeat(64),
      },
      incident: { fingerprint: "e".repeat(64), status: "verified" },
      raw_intent: "must not be carried",
      raw_capsule: { secret: "must not be carried" },
      atlas_nodes: [{ secret: "must not be carried" }],
    },
  });
  assert.equal(dialogue.manual.version, NYRA_OPERATING_MANUAL_VERSION);
  assert.equal(dialogue.persistent, true);
  assert.equal(dialogue.work.intent_digest, "a".repeat(64));
  assert.equal(dialogue.work.checkpoint.capsule_digest, "b".repeat(64));
  assert.equal(dialogue.work.gallery.work_count, 3);
  assert.equal(dialogue.work.software.atlas_revision, 12);
  assert.match(dialogue.dialogue_digest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(dialogue).includes("must not be carried"), false);
});

test("Nyra self-diagnosis preserves recovery state instead of blindly repeating work", () => {
  const diagnosis = diagnoseNyraOperationalState({
    continuity: {
      ...continuity,
      connector_state: {
        state: "reconnect_required",
        recovery_action: "Reconnect the same OAuth session, then resume this Work.",
      },
    },
  });
  assert.equal(diagnosis.state, "recovery_required");
  assert.match(diagnosis.local_action, /do not repeat an external action/i);
  assert.match(diagnosis.core_action, /Reconnect the same OAuth session/);
  assert.equal(diagnosis.automatic_correction, "context_preserved");
});

test("an unresolved local incident routes Nyra to Core instead of a new free-form search", () => {
  const diagnosis = diagnoseNyraOperationalState({
    continuity,
    operational: { incident: { fingerprint: "f".repeat(64), status: "candidate" } },
  });
  assert.equal(diagnosis.state, "diagnosis_pending");
  assert.match(diagnosis.local_action, /exact incident fingerprint/i);
  assert.match(diagnosis.core_action, /Core/);
});
