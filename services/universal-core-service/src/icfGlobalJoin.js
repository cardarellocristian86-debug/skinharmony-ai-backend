import crypto from "node:crypto";

const digest = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const OPEN = new Set(["proposed", "open", "in_progress", "blocked"]);

export function recomputeGlobalIntentJoin(work, { now = Date.now(), maxSnapshotAgeSeconds = 300 } = {}) {
  const obligations = [...(work?.obligations?.values?.() || work?.obligations || [])];
  const evidence = [...(work?.evidence?.values?.() || work?.evidence || [])];
  const warrants = [...(work?.warrants?.values?.() || work?.warrants || [])];
  const events = work?.events || [];
  const openObligations = obligations.filter((o) => OPEN.has(o.status));
  const residuals = obligations.filter((o) => o.residual === true && OPEN.has(o.status));
  const invalidEvidence = evidence.filter((e) => e.truth_state !== "TRUE" || e.verified !== true || (e.fresh_until && Date.parse(e.fresh_until) < now));
  const unknownWarrants = warrants.filter((w) => ["reserved", "unknown"].includes(w.status));
  const covered = new Set(obligations.flatMap((o) => o.clause_refs || []));
  const unaccounted = (work?.covenant?.clauses || []).filter((c) => !covered.has(c.clause_id) && !c.waived);
  const ledgerValid = events.every((e, i) => e.previous_digest === (i ? events[i - 1].digest : null));
  const snapshotAt = work?.snapshot_at ? Date.parse(work.snapshot_at) : NaN;
  const snapshotFresh = Number.isFinite(snapshotAt) && now - snapshotAt <= maxSnapshotAgeSeconds * 1000;
  const antiGoalViolations = work?.anti_goal_violations || 0;
  const result = { open_obligations: openObligations.length, open_residuals: residuals.length, invalid_evidence: invalidEvidence.length, unknown_warrants: unknownWarrants.length, unaccounted_obligations: unaccounted.length, anti_goal_violations: antiGoalViolations, ledger_head_consistent: ledgerValid, snapshot_fresh: snapshotFresh, join_decision: openObligations.length || residuals.length || invalidEvidence.length || unknownWarrants.length || unaccounted.length || antiGoalViolations || !ledgerValid || !snapshotFresh ? "block" : "close" };
  result.join_digest = digest(result);
  return result;
}
