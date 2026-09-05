import crypto from "node:crypto";
import {
  NYRA_OPERATING_MANUAL,
  NYRA_OPERATING_MANUAL_VERSION,
} from "./nyra-operating-manual.js";

// Nyra's manual is intentionally versioned separately from the recovery
// registry.  The manual explains how Nyra works; the recovery registry is
// consulted only when an observed failure requires it.
export { NYRA_OPERATING_MANUAL_VERSION } from "./nyra-operating-manual.js";
export const NYRA_DIALOGUE_CONTEXT_SCHEMA_VERSION = "nyra_dialogue_context_v1";
export const NYRA_RECOVERY_REGISTRY_VERSION = "nyra_recovery_registry_v1";

function clean(value, maximum = 240) {
  return typeof value === "string" ? value.replaceAll("\u0000", " ").trim().slice(0, maximum) : "";
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export const NYRA_OPERATING_MANUAL_DIGEST = digest(NYRA_OPERATING_MANUAL);

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
  const continuityRevision = Number(continuity.architecture_version || continuity.work_revision || 0);
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
  if (!/^[a-f0-9]{64}$/.test(String(normalized.intent_digest || ""))) {
    return Object.freeze({
      schema_version: NYRA_RECOVERY_REGISTRY_VERSION,
      state: "intent_anchor_incomplete",
      source: "intent_anchor",
      local_action: "Refresh the Work briefing from the immutable Intent Anchor; do not reconstruct the request in chat.",
      core_action: "Ask Core to validate or repair the existing Work binding only if the immutable anchor is unavailable.",
      automatic_correction: "context_refreshed",
      remaining_action: "read_intent_anchor",
    });
  }
  if (normalized.checkpoint.capsule_id !== null && normalized.checkpoint.capsule_digest === null) {
    return Object.freeze({
      schema_version: NYRA_RECOVERY_REGISTRY_VERSION,
      state: "checkpoint_incomplete",
      source: "continuity_checkpoint",
      local_action: "Keep the current Work evidence and refresh the bounded context; do not claim a checkpoint is usable.",
      core_action: "Ask Core only if checkpoint integrity must be adjudicated.",
      automatic_correction: "context_refreshed",
      remaining_action: "verify_or_create_checkpoint",
    });
  }
  const terminalWork = new Set(["completed", "cancelled", "superseded", "archived"])
    .has(String(continuity.state || continuity.status || "").toLowerCase());
  if (normalized.gallery.state !== "available" ||
      (normalized.gallery.work_count < 1 && !terminalWork)) {
    return Object.freeze({
      schema_version: NYRA_RECOVERY_REGISTRY_VERSION,
      state: "gallery_projection_stale",
      source: "work_gallery",
      local_action: "Refresh the tenant-scoped Work projection; do not create a replacement Work.",
      core_action: "Consult Core only if the authoritative Work cannot be resolved.",
      automatic_correction: "context_refreshed",
      remaining_action: "refresh_work_gallery",
    });
  }
  if (continuityRevision > 0 && normalized.work_revision !== null && continuityRevision !== normalized.work_revision) {
    return Object.freeze({
      schema_version: NYRA_RECOVERY_REGISTRY_VERSION,
      state: "work_snapshot_stale",
      source: "work_revision",
      local_action: "Regenerate the Nyra briefing from the current Work revision before continuing.",
      core_action: "No Core call is required unless the revision cannot be read.",
      automatic_correction: "context_refreshed",
      remaining_action: "refresh_work_snapshot",
    });
  }
  if (operational?.software?.required === true &&
      (normalized.software.state !== "available" || normalized.software.atlas_revision === null)) {
    return Object.freeze({
      schema_version: NYRA_RECOVERY_REGISTRY_VERSION,
      state: "software_context_required",
      source: "software_cognition",
      local_action: "Request one bounded Software Cognition selection from verified Work seeds; never scan the whole project for chat context.",
      core_action: "Consult Core only if the bounded software evidence conflicts with policy or integrity.",
      automatic_correction: "context_refreshed",
      remaining_action: "bounded_atlas_select",
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
  // Preserve the local `software.required` signal for diagnosis while the
  // dialogue itself uses the normalized, bounded projection.
  const diagnosis = diagnoseNyraOperationalState({
    continuity,
    operational: {
      ...operational,
      intent_digest: normalized.intent_digest,
    },
  });
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
    assignment: assignment
      ? Object.freeze({
          assignment_id: clean(assignment.assignment_id, 64) || null,
          role: clean(assignment.role, 80) || null,
          state: clean(assignment.state, 40) || "ready",
        })
      : null,
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
