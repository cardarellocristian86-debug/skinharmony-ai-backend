import crypto from "node:crypto";
import { buildNyraOperationalDialogue } from "./nyra-operational-dialogue.js";

// This is the only conversational payload that a connected AI needs for an
// already-known Work.  The full Work, plan, receipts and preflight remain in
// the server-side ledger; sending them again on every turn wastes context and
// makes a fresh chat reconstruct decisions that Nyra has already made.
export const NYRA_CONTROL_CONTEXT_SCHEMA_VERSION = "nyra_control_context_v1";

function clean(value, max = 240) {
  return typeof value === "string" ? value.replaceAll("\u0000", " ").trim().slice(0, max) : "";
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Work Continuity's legacy architecture revision is not a Gallery V2 ledger
// revision. When a V2 projection exists, directives must use that projection
// as their revision source so the later V2 directive read compares like with
// like. An absent projection keeps historical legacy Work compatible; an
// invalid present projection remains fail-closed.
export function resolveNyraDialogueWorkRevision(continuity = {}, projection = null) {
  const legacyRevision = Number(continuity.work_revision || continuity.architecture_version || 0);
  if (!projection) {
    return Number.isSafeInteger(legacyRevision) && legacyRevision > 0
      ? legacyRevision : null;
  }
  const revision = Number(projection.work_revision || 0);
  const watermark = Number(projection.ledger_watermark || 0);
  const workId = clean(continuity.work_id, 64);
  if (
    projection.schema_version !== "work_state_projection_v1" ||
    projection.available === false ||
    !workId || projection.work_id !== workId ||
    !Number.isSafeInteger(revision) || revision < 1 ||
    !Number.isSafeInteger(watermark) || watermark < 1 ||
    revision !== watermark ||
    !/^[a-f0-9]{64}$/.test(String(projection.projection_digest || ""))
  ) {
    throw new Error("continuity_work_projection_invalid");
  }
  return revision;
}

function firstReadyAssignment(autopilot = {}) {
  const assignments = Array.isArray(autopilot.assignments)
    ? autopilot.assignments
    : Array.isArray(autopilot?.materialization?.assignments)
      ? autopilot.materialization.assignments
      : [];
  // A persisted dialogue is later read by another connected AI. A claimed
  // assignment might already be expired or belong to that other worker, so
  // only a fresh offered assignment may be surfaced as actionable here. The
  // claimant receives its exact assignment directly from the claim result.
  const states = new Map(assignments.map((item) => [`${item?.run_id || ""}:${item?.assignment_key || ""}`, item?.status]));
  const assignment = assignments.find((item) => item?.status === "offered" &&
    (Array.isArray(item.dependencies) ? item.dependencies : []).every((dependency) =>
      ["submitted", "verified"].includes(states.get(`${item?.run_id || ""}:${dependency}`)),
    )) || null;
  if (!assignment) return null;
  return {
    assignment_id: clean(assignment.assignment_id, 64) || null,
    role: clean(assignment.role, 80) || null,
    state: clean(assignment.status, 40) || "ready",
  };
}

export function buildNyraControlContext({ continuity = {}, autopilot = null, operational = null, operation = "continue" } = {}) {
  const workId = clean(continuity.work_id, 64) || null;
  const projectId = clean(continuity.project_id, 80) || null;
  const intentDigest = clean(continuity.intent_digest, 64) || null;
  const assignment = firstReadyAssignment(autopilot || {});
  const connectorState = continuity?.connector_state?.state === "reconnect_required"
    ? "reconnect_required"
    : "healthy";
  const base = {
    schema_version: NYRA_CONTROL_CONTEXT_SCHEMA_VERSION,
    tenant_id: clean(continuity.tenant_id, 64) || null,
    project_id: projectId,
    work_id: workId,
    intent_digest: intentDigest,
    work_state: clean(continuity.state || continuity.status, 80) || "unknown",
    // Work Continuity V2 is the authoritative mutation ledger.  The legacy
    // architecture version is a different counter and must never mask a
    // newer Work revision in a dialogue/readback contract.
    work_revision: Number.isSafeInteger(Number(continuity.work_revision || continuity.architecture_version))
      ? Number(continuity.work_revision || continuity.architecture_version)
      : null,
    operation: clean(operation, 80) || "continue",
    next_action: clean(
      connectorState === "reconnect_required"
        ? continuity?.connector_state?.recovery_action
        : continuity.next_action,
      360,
    ) || (assignment
      ? "Nyra has assigned the next bounded task to a connected AI."
      : "Continue the existing Work through Nyra and Core."),
    assignment,
    connector: {
      state: connectorState,
      ...(connectorState === "reconnect_required" ? { recovery_action: clean(continuity?.connector_state?.recovery_action, 240) } : {}),
    },
    // This is server-emitted on every bound Work. A connected AI never has to
    // remember a special Nyra tool in order to receive the orchestration.
    nyra_dialogue: buildNyraOperationalDialogue({
      continuity,
      operational: operational || {},
      assignment,
      operation,
    }),
    execution_authorized: false,
    external_action_authorized: false,
  };
  return Object.freeze({ ...base, context_digest: digest(base) });
}
