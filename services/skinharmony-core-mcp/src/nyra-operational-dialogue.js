import crypto from "node:crypto";

// Nyra's manual is intentionally versioned separately from the recovery
// registry.  The manual explains how Nyra works; the recovery registry is
// consulted only when an observed failure requires it.
export const NYRA_OPERATING_MANUAL_VERSION = "nyra_operating_manual_v1";
export const NYRA_DIALOGUE_CONTEXT_SCHEMA_VERSION = "nyra_dialogue_context_v1";
export const NYRA_RECOVERY_REGISTRY_VERSION = "nyra_recovery_registry_v1";

function clean(value, maximum = 240) {
  return typeof value === "string" ? value.replaceAll("\u0000", " ").trim().slice(0, maximum) : "";
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const MANUAL = Object.freeze({
  schema_version: NYRA_OPERATING_MANUAL_VERSION,
  identity: "Nyra owns Work continuity, the operational brief and delegation order.",
  core_relationship: "Universal Core verifies policy, authority and consequential actions.",
  memory: "Intent, checkpoint, Gallery and bounded software evidence are reused instead of reconstructed.",
  orchestration: "Connected AIs receive one bounded next step and return evidence to Nyra.",
  learning: "Verified local outcomes, incidents and software evidence improve future Work context without model-weight training.",
});

export const NYRA_OPERATING_MANUAL_DIGEST = digest(MANUAL);

function normalizeOperationalState(operational = {}) {
  const checkpoint = operational?.checkpoint && typeof operational.checkpoint === "object"
    ? operational.checkpoint
    : {};
  const gallery = operational?.gallery && typeof operational.gallery === "object"
    ? operational.gallery
    : {};
  const software = operational?.software && typeof operational.software === "object"
    ? operational.software
    : {};
  const incident = operational?.incident && typeof operational.incident === "object"
    ? operational.incident
    : {};
  const revision = Number(operational.work_revision);
  return Object.freeze({
    intent_digest: clean(operational.intent_digest, 64) || null,
    checkpoint: Object.freeze({
      capsule_id: clean(checkpoint.capsule_id, 64) || null,
      capsule_digest: clean(checkpoint.capsule_digest, 64) || null,
      available: Boolean(clean(checkpoint.capsule_id, 64) && clean(checkpoint.capsule_digest, 64)),
    }),
    gallery: Object.freeze({
      state: clean(gallery.state, 40) || "available",
      work_count: Number.isSafeInteger(Number(gallery.work_count))
        ? Math.max(0, Math.min(Number(gallery.work_count), 100_000))
        : 0,
    }),
    software: Object.freeze({
      state: clean(software.state, 40) || "not_indexed",
      atlas_revision: Number.isSafeInteger(Number(software.atlas_revision))
        ? Math.max(0, Number(software.atlas_revision))
        : null,
      source_hash: clean(software.source_hash, 64) || null,
      context_digest: clean(software.context_digest, 64) || null,
      discovery_required: software.discovery_required === true,
    }),
    incident: Object.freeze({
      fingerprint: clean(incident.fingerprint, 64) || null,
      status: clean(incident.status, 40) || null,
    }),
    work_revision: Number.isSafeInteger(revision) && revision > 0 ? revision : null,
  });
}

export function diagnoseNyraOperationalState({ continuity = {}, operational = {} } = {}) {
  const normalized = normalizeOperationalState(operational);
  const reconnect = continuity?.connector_state?.state === "reconnect_required";
  if (reconnect) {
    return Object.freeze({
      schema_version: NYRA_RECOVERY_REGISTRY_VERSION,
      state: "recovery_required",
      source: "connector_state",
      local_action: "Preserve the Work and its checkpoint; do not repeat an external action.",
      core_action: clean(continuity?.connector_state?.recovery_action, 240) || "Ask Core to resume the existing bounded recovery after reconnection.",
      automatic_correction: "context_preserved",
    });
  }
  if (normalized.incident.fingerprint && normalized.incident.status !== "verified") {
    return Object.freeze({
      schema_version: NYRA_RECOVERY_REGISTRY_VERSION,
      state: "diagnosis_pending",
      source: "incident_runbook",
      local_action: "Reuse the exact incident fingerprint and existing Work evidence; do not start an unbounded search.",
      core_action: "Ask Core to evaluate the recorded recovery path against the current Work.",
      automatic_correction: "context_refreshed",
    });
  }
  return Object.freeze({
    schema_version: NYRA_RECOVERY_REGISTRY_VERSION,
    state: "healthy",
    source: "local_work_snapshot",
    local_action: "Keep the Work briefing synchronized with the latest verified state.",
    core_action: "Consult Core only for a real policy, integrity or consequential-action decision.",
    automatic_correction: "context_refreshed",
  });
}

export function buildNyraOperationalDialogue({ continuity = {}, operational = {}, assignment = null, operation = "continue" } = {}) {
  const workId = clean(continuity.work_id, 64) || null;
  const projectId = clean(continuity.project_id, 80) || null;
  const normalized = normalizeOperationalState({
    ...operational,
    intent_digest: operational.intent_digest || continuity.intent_digest,
  });
  const diagnosis = diagnoseNyraOperationalState({ continuity, operational: normalized });
  const base = {
    schema_version: NYRA_DIALOGUE_CONTEXT_SCHEMA_VERSION,
    dialogue_id: workId && projectId ? `nyra-work-${digest({ workId, projectId }).slice(0, 32)}` : null,
    mode: "automatic_work_briefing",
    persistent: true,
    session_strategy: "work_scoped_continuation",
    activation: "work_bind_or_material_change",
    manual: {
      version: NYRA_OPERATING_MANUAL_VERSION,
      digest: NYRA_OPERATING_MANUAL_DIGEST,
    },
    work: {
      work_id: workId,
      project_id: projectId,
      work_revision: normalized.work_revision,
      intent_digest: normalized.intent_digest,
      checkpoint: normalized.checkpoint,
      gallery: normalized.gallery,
      software: normalized.software,
    },
    self_diagnosis: diagnosis,
    connected_ai_instruction: Object.freeze([
      "Continue the bound Work; do not recreate its intent or rescan the project.",
      assignment?.assignment_id
        ? "Take the offered bounded assignment, return evidence, then let Nyra advance the next step."
        : "Use the recorded next action and return bounded evidence to Nyra.",
      "Use the checkpoint, Intent and bounded software context already attached by Nyra before requesting more context.",
    ]),
    learning: Object.freeze({
      mode: "local_verified_evidence",
      update_on: "verified_outcome_or_incident_verification",
      model_weight_training: false,
    }),
    operation: clean(operation, 80) || "continue",
    execution_authorized: false,
    external_action_authorized: false,
  };
  return Object.freeze({ ...base, dialogue_digest: digest(base) });
}

