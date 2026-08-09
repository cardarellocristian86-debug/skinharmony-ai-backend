"use strict";

const INTENT_CLASSIFICATIONS = new Set(["REFINEMENT", "SCOPE_CHANGE", "STRATEGIC_PIVOT", "PURPOSE_CHANGE", "ROLLBACK", "TERMINATION"]);
const IMPACT_STATES = new Set(["COMPATIBLE", "REBASE_REQUIRED", "CONFLICTING", "OBSOLETE", "OWNER_REVIEW_REQUIRED"]);
const list = (value) => Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
const strings = (value) => [...new Set(list(value).map((item) => String(item).trim()).filter(Boolean))];
const normalizeText = (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
function tokens(value) { return new Set(normalizeText(value).toLocaleLowerCase("en").split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length > 2)); }
function overlap(left, right) { const a = tokens(left); const b = tokens(right); if (!a.size || !b.size) return 0; let count = 0; for (const token of a) if (b.has(token)) count += 1; return count / Math.max(1, Math.min(a.size, b.size)); }
function requireText(value, code) { const result = normalizeText(value); if (!result) throw new Error(code); return result; }
function ordered(records) { return list(records).slice().sort((left, right) => { const a = Number(left.event_sequence ?? left.sequence_number ?? Number.MAX_SAFE_INTEGER); const b = Number(right.event_sequence ?? right.sequence_number ?? Number.MAX_SAFE_INTEGER); return a !== b ? a - b : String(left.timestamp || left.created_at || "").localeCompare(String(right.timestamp || right.created_at || "")); }); }

function detectIntentDrift(input = {}) {
  const request = requireText(input.request || input.current_request, "nyra_current_request_required");
  const explicit = String(input.proposed_classification || input.classification || "").toUpperCase();
  if (explicit && !INTENT_CLASSIFICATIONS.has(explicit)) throw new Error("nyra_intent_classification_invalid");
  const removedInvariants = strings(input.removed_invariants);
  const contradictions = strings(input.contradictions);
  const baseline = [input.genesis_intent, input.active_intent_revision, input.work_intent].map(normalizeText).filter(Boolean).join(" ");
  let classification = "ALIGNED"; let blocked = false; let required_authority = "CORE"; const reasons = [];
  if (explicit === "PURPOSE_CHANGE") { classification = "NEW_PROJECT_REQUIRED"; blocked = true; required_authority = "OWNER"; reasons.push("purpose_change_requires_derived_project"); }
  else if (contradictions.length || removedInvariants.length) { classification = "CONTRADICTION"; blocked = true; required_authority = "OWNER"; reasons.push(...contradictions.map((item) => `contradiction:${item}`), ...removedInvariants.map((item) => `invariant_removed:${item}`)); }
  else if (explicit === "STRATEGIC_PIVOT") { classification = "STRATEGIC_PIVOT"; blocked = input.owner_approved !== true; required_authority = "OWNER"; reasons.push(blocked ? "strategic_pivot_requires_owner_approval" : "strategic_pivot_owner_approved"); }
  else if (explicit === "SCOPE_CHANGE" || strings(input.added_scope).length || strings(input.removed_scope).length) { classification = "SCOPE_CHANGE"; reasons.push("scope_delta_declared"); }
  else if (explicit === "REFINEMENT" || strings(input.refinements).length) { classification = "REFINEMENT"; reasons.push("refinement_declared"); }
  else if (explicit === "ROLLBACK" || explicit === "TERMINATION") { classification = explicit === "ROLLBACK" ? "SCOPE_CHANGE" : "CONTRADICTION"; blocked = input.owner_approved !== true; required_authority = "OWNER"; reasons.push(`${explicit.toLocaleLowerCase("en")}_requires_owner_approval`); }
  else if (baseline && overlap(request, baseline) < 0.2) { classification = "SCOPE_CHANGE"; reasons.push("low_semantic_overlap_requires_impact_analysis"); }
  else reasons.push("request_preserves_declared_intent_and_invariants");
  return { schema_version: "nyra_intent_drift_v1", classification, blocked, required_authority, reasons, request };
}

function compileIntent(input = {}) {
  const request = requireText(input.request || input.human_request, "nyra_human_request_required");
  const drift = detectIntentDrift({ ...input, request }); const criteria = strings(input.acceptance_criteria); const supplied = list(input.obligations);
  const currentProject = input.project || (input.project_id ? { project_id: input.project_id } : null);
  const newProjectRequired = drift.classification === "NEW_PROJECT_REQUIRED";
  return { schema_version: "nyra_intent_compilation_v1", project: currentProject, genesis_intent_id: input.genesis_intent_id || null, active_intent_revision_id: input.intent_revision_id || null, proposed_intent_revision: drift.classification === "ALIGNED" || newProjectRequired ? null : { classification: drift.classification, text: request, approval_state: "PROPOSED", required_authority: drift.required_authority }, new_project_required: newProjectRequired ? { derived_from_project_id: currentProject?.project_id || null, purpose: request, required_authority: "OWNER" } : null, work: input.work || (input.work_id ? { work_id: input.work_id } : null), changes: list(input.changes).map((item) => ({ ...item })), obligations: supplied.length ? supplied.map((item) => ({ ...item })) : criteria.map((claim) => ({ claim, state: "DRAFT", evidence_contract: null })), success_criteria: criteria, forbidden_effects: strings(input.forbidden_effects), drift, execution_authorized: false };
}

function synthesizeDecisionPath(input = {}) {
  const genesis = input.genesis_intent || null; const revisions = ordered(input.intent_revisions); const decisions = ordered(input.decisions);
  const timeline = [...(genesis ? [{ kind: "GENESIS_INTENT", ...genesis }] : []), ...revisions.map((item) => ({ kind: "INTENT_REVISION", ...item })), ...decisions.map((item) => ({ kind: "DECISION", ...item }))];
  return { schema_version: "nyra_decision_path_v1", project_id: input.project_id || genesis?.project_id || null, why_project_exists: genesis?.text || genesis?.intent || null, initial_problem: genesis?.problem || null, revisions, decisions, discarded_alternatives: decisions.flatMap((decision) => list(decision.alternatives).filter((alternative) => alternative.selected !== true)), current_state_reason: decisions.at(-1)?.reason || revisions.at(-1)?.motivation || genesis?.text || null, timeline, generated_from_event_sequence: input.generated_from_event_sequence ?? null };
}

function analyzeProjectImpact(input = {}) {
  const revision = input.intent_revision || {}; const classification = String(revision.classification || input.classification || "REFINEMENT").toUpperCase(); const removedScope = new Set(strings(revision.removed_scope)); const removedInvariants = new Set(strings(revision.removed_invariants));
  const works = list(input.open_works).map((work) => { const scopeConflict = strings(work.scope).some((item) => removedScope.has(item)); const invariantConflict = strings(work.invariants).some((item) => removedInvariants.has(item)); let impact = "COMPATIBLE"; const reasons = [];
    if (classification === "PURPOSE_CHANGE" || classification === "TERMINATION") { impact = "OBSOLETE"; reasons.push("project_purpose_or_lifecycle_changed"); }
    else if (invariantConflict) { impact = "CONFLICTING"; reasons.push("work_depends_on_removed_invariant"); }
    else if (classification === "STRATEGIC_PIVOT") { impact = "OWNER_REVIEW_REQUIRED"; reasons.push("strategic_pivot_requires_owner_review"); }
    else if (scopeConflict || (work.intent_revision_id && revision.intent_revision_id && work.intent_revision_id !== revision.intent_revision_id)) { impact = "REBASE_REQUIRED"; reasons.push(scopeConflict ? "work_scope_removed" : "work_bound_to_previous_revision"); }
    else reasons.push("work_preserves_scope_and_invariants");
    if (!IMPACT_STATES.has(impact)) throw new Error("nyra_work_impact_invalid"); return { work_id: work.work_id || null, impact, reasons }; });
  return { schema_version: "nyra_project_impact_v1", intent_revision_id: revision.intent_revision_id || input.intent_revision_id || null, classification, works, summary: Object.fromEntries([...IMPACT_STATES].map((state) => [state, works.filter((item) => item.impact === state).length])) };
}

function buildWorkRebasePlan(input = {}) { const work = input.work || {}; const target = input.target_intent_revision || {}; const impact = input.impact || analyzeProjectImpact({ intent_revision: target, open_works: [work] }).works[0]; const blocked = ["CONFLICTING", "OBSOLETE", "OWNER_REVIEW_REQUIRED"].includes(impact?.impact); return { schema_version: "nyra_work_rebase_plan_v1", work_id: work.work_id || null, from_intent_revision_id: work.intent_revision_id || null, to_intent_revision_id: target.intent_revision_id || null, base_project_state_digest: work.project_state_digest || null, impact: impact?.impact || "REBASE_REQUIRED", blocked, steps: blocked ? ["obtain_required_authority", "resolve_conflicts", "rerun_impact_analysis"] : ["snapshot_current_project_state", "rebind_work_intent", "recompute_change_impacts", "refresh_obligations", "issue_new_causal_context"], preserved_invariants: strings(input.preserved_invariants || work.invariants), forbidden_actions: strings(input.forbidden_actions) }; }
function generateCausalScenarios(input = {}) { const forbidden = strings(input.forbidden_effects); return { schema_version: "nyra_causal_scenarios_v1", expected: strings(input.expected_effects).map((effect) => ({ effect, observation_required: true })), side_effects: strings(input.side_effects).map((effect) => ({ effect, must_be_measured: true })), counterfactuals: list(input.counterfactuals).map((item) => ({ ...item })), falsification_conditions: strings(input.falsification_conditions).concat(forbidden.map((effect) => `forbidden_effect_observed:${effect}`)), delayed_risks: strings(input.delayed_risks).map((risk) => ({ risk, temporal_check_required: true })), minimum_assurance_level: input.minimum_assurance_level || "CAL-1" }; }
function buildContinuityBrief(input = {}) { const openChanges = list(input.open_changes); const openObligations = list(input.open_obligations); return { schema_version: "nyra_continuity_brief_v1", project_id: input.project_id || input.project_identity?.project_id || null, why_project_exists: input.genesis_intent?.text || input.genesis_intent || null, current_intent: input.active_intent_revision || null, intent_evolution: ordered(input.intent_revisions), active_work: input.active_work || null, completed_changes: list(input.completed_changes), open_changes: openChanges, decisions: ordered(input.decisions), blockers: list(input.blockers), conflicts: list(input.conflicts), latest_verified_state: input.latest_verified_state || null, open_obligations: openObligations, next_safe_action: input.next_safe_action || (openObligations.length ? "satisfy_next_open_obligation" : openChanges.length ? "continue_next_authorized_change" : null), forbidden_actions: strings(input.forbidden_actions), pending_temporal_checks: list(input.pending_temporal_checks), generated_from_event_sequence: input.generated_from_event_sequence ?? null, memory_source: "authoritative_registry" }; }

module.exports = { compileIntent, detectIntentDrift, synthesizeDecisionPath, analyzeProjectImpact, buildWorkRebasePlan, generateCausalScenarios, buildContinuityBrief };
