import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildNyraOperationalDialogue,
  diagnoseNyraOperationalState,
  NYRA_OPERATING_MANUAL_DIGEST,
  NYRA_OPERATING_MANUAL_VERSION,
} from "../src/nyra-operational-dialogue.js";
import { NYRA_OPERATING_MANUAL } from "../src/nyra-operating-manual.js";

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
  assert.equal(dialogue.manual.digest, NYRA_OPERATING_MANUAL_DIGEST);
  assert.equal(NYRA_OPERATING_MANUAL.version, NYRA_OPERATING_MANUAL_VERSION);
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

test("Nyra diagnoses incomplete local state without asking an AI to rediscover the Work", () => {
  const cases = [
    [{}, "intent_anchor_incomplete", "read_intent_anchor"],
    [{ intent_digest: "a".repeat(64), checkpoint: { capsule_id: "only-id" } }, "checkpoint_incomplete", "verify_or_create_checkpoint"],
    [{ intent_digest: "a".repeat(64), gallery: { state: "available", work_count: 0 } }, "gallery_projection_stale", "refresh_work_gallery"],
    [{ intent_digest: "a".repeat(64), gallery: { state: "available", work_count: 1 }, work_revision: 2 }, "work_snapshot_stale", "refresh_work_snapshot"],
    [{ intent_digest: "a".repeat(64), gallery: { state: "available", work_count: 1 }, work_revision: 1, software: { state: "not_indexed" } }, "software_context_required", "bounded_atlas_select"],
  ];
  for (const [operational, state, remaining] of cases) {
    const diagnosis = diagnoseNyraOperationalState({
      continuity: { ...continuity, architecture_version: 1 },
      operational: state === "software_context_required" ? { ...operational, software: { ...operational.software, required: true } } : operational,
    });
    assert.equal(diagnosis.state, state);
    assert.equal(diagnosis.remaining_action, remaining);
    assert.equal(diagnosis.automatic_correction, "context_refreshed");
  }
});

test("a terminal Work remains readable when the operational Gallery is empty", () => {
  const diagnosis = diagnoseNyraOperationalState({
    continuity: { ...continuity, state: "completed" },
    operational: {
      intent_digest: "a".repeat(64),
      gallery: { state: "available", work_count: 0 },
    },
  });
  assert.notEqual(diagnosis.state, "gallery_projection_stale");
});

test("the reviewed manual declares every canonical runtime section", () => {
  const markdown = fs.readFileSync(new URL("../../../docs/architecture/nyra-persistent-operating-dialogue-v1.md", import.meta.url), "utf8");
  assert.match(markdown, new RegExp(NYRA_OPERATING_MANUAL_VERSION));
  for (const section of NYRA_OPERATING_MANUAL.sections) {
    assert(markdown.includes(section.doc_anchor), `manual must cover ${section.id}`);
  }
});
