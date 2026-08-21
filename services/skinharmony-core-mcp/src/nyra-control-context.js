import crypto from "node:crypto";

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

function firstReadyAssignment(autopilot = {}) {
  const assignments = Array.isArray(autopilot.assignments)
    ? autopilot.assignments
    : Array.isArray(autopilot?.materialization?.assignments)
      ? autopilot.materialization.assignments
      : [];
  const assignment = assignments.find((item) => item?.status === "offered") || null;
  if (!assignment) return null;
  return {
    assignment_id: clean(assignment.assignment_id, 64) || null,
    role: clean(assignment.role, 80) || null,
    state: "ready",
  };
}

export function buildNyraControlContext({ continuity = {}, autopilot = null, operation = "continue" } = {}) {
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
    work_revision: Number.isSafeInteger(Number(continuity.architecture_version || continuity.work_revision))
      ? Number(continuity.architecture_version || continuity.work_revision)
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
    execution_authorized: false,
    external_action_authorized: false,
  };
  return Object.freeze({ ...base, context_digest: digest(base) });
}
