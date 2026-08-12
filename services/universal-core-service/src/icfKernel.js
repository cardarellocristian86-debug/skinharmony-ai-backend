import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { recomputeGlobalIntentJoin } from "./icfGlobalJoin.js";

const TRUTH_STATES = new Set(["TRUE", "FALSE", "UNKNOWN", "STALE", "CONFLICTING", "UNOBSERVABLE"]);
const DISPOSITIONS = new Set(["satisfied", "waived", "transferred"]);
const OPEN_STATUSES = new Set(["proposed", "open", "in_progress", "blocked"]);
const digest = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function createIcfKernel({ audit, storageRoot, mode = process.env.CORE_ICF_MODE || "shadow" } = {}) {
  const rolloutMode = ["off", "shadow", "advisory", "enforced"].includes(String(mode).toLowerCase()) ? String(mode).toLowerCase() : "shadow";
  const root = storageRoot ? path.join(storageRoot, "icf") : null;
  const works = new Map();
  if (root && fs.existsSync(root)) {
    for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".json"))) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
        raw.obligations = new Map((raw.obligations || []).map((item) => [item.obligation_id, item]));
        raw.cells = new Map((raw.cells || []).map((item) => [item.cell_id, item]));
        raw.warrants = new Map((raw.warrants || []).map((item) => [item.warrant_id, item]));
        raw.evidence = new Map((raw.evidence || []).map((item) => [item.evidence_id, item]));
        works.set(`${raw.tenant_id}:${raw.work_id}`, raw);
      } catch { /* corrupt files are ignored and surfaced by the audit/health layer */ }
    }
  }
  const persist = (work) => {
    if (!root) return;
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `${crypto.createHash("sha256").update(`${work.tenant_id}:${work.work_id}`).digest("hex")}.json`);
    const serializable = { ...work, obligations: [...work.obligations.values()], cells: [...work.cells.values()], warrants: [...work.warrants.values()], evidence: [...work.evidence.values()] };
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(serializable, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  const scoped = (tenantId, workId) => {
    const key = `${tenantId}:${workId}`;
    let work = works.get(key);
    if (!work) {
      work = { tenant_id: tenantId, work_id: workId, version: 0, events: [], covenant: null, obligations: new Map(), cells: new Map(), warrants: new Map(), evidence: new Map(), closure: "OPEN" };
      works.set(key, work);
    }
    return work;
  };
  const append = (work, type, payload) => {
    const previous = work.events.at(-1)?.digest || null;
    const record = { seq: work.events.length + 1, type, at: new Date().toISOString(), previous_digest: previous, payload };
    record.digest = digest(stable(record));
    work.events.push(record); work.version = record.seq; persist(work);
    audit?.append?.(`icf_${type}`, { tenant_id: work.tenant_id, work_id: work.work_id, seq: record.seq });
    return record;
  };
  const openObligations = (work) => [...work.obligations.values()].filter((item) => OPEN_STATUSES.has(item.status));
  const closure = (work) => {
    const obligations = [...work.obligations.values()];
    const open = openObligations(work);
    const unknownWarrants = [...work.warrants.values()].filter((item) => ["reserved", "unknown"].includes(item.status));
    const staleEvidence = [...work.evidence.values()].filter((item) => item.truth_state !== "TRUE" || item.verified !== true || (item.fresh_until && Date.parse(item.fresh_until) < Date.now()));
    const criticalResiduals = obligations.filter((item) => item.residual === true && item.criticality === "critical" && OPEN_STATUSES.has(item.status));
    const coveredClauses = new Set(obligations.flatMap((item) => item.clause_refs || []));
    const unaccountedClauses = (work.covenant?.clauses || []).filter((item) => !coveredClauses.has(item.clause_id) && !item.waived).length;
    const result = { required_open_obligations: open.length, unaccounted_obligations: obligations.filter((item) => !item.disposition && !item.status).length, unaccounted_covenant_clauses: unaccountedClauses, critical_residual_obligations: criticalResiduals.length, active_or_unknown_warrants: unknownWarrants.length, invalid_or_stale_evidence: staleEvidence.length, event_ledger_chain_valid: work.events.every((item, index) => item.previous_digest === (index ? work.events[index - 1].digest : null)), decision: open.length || unaccountedClauses || unknownWarrants.length || criticalResiduals.length || staleEvidence.length ? "BLOCK" : "ALLOW_CLOSE" };
    return result;
  };
  return {
    putCovenant(tenantId, workId, input = {}) {
      const work = scoped(tenantId, workId);
      if (work.covenant?.status === "sealed") return { ok: false, error: "covenant_sealed" };
      const covenant = { schema: "nyra.icf.intent-covenant/1.0", covenant_id: input.covenant_id || id("icv"), tenant_id: tenantId, work_id: workId, version: (work.covenant?.version || 0) + 1, outcomes: [], constraints: [], anti_goals: [], scope: {}, closure_policy: { zero_unaccounted: true }, ...input, status: "sealed" };
      covenant.clauses = [...covenant.outcomes.map((claim) => ({ clause_id: id("clause"), kind: "outcome", claim })), ...covenant.constraints.map((claim) => ({ clause_id: id("clause"), kind: "constraint", claim })), ...covenant.anti_goals.map((claim) => ({ clause_id: id("clause"), kind: "anti_goal", claim }))];
      covenant.digest = digest(stable(covenant)); work.covenant = covenant; append(work, "covenant_sealed", { covenant_digest: covenant.digest }); return { ok: true, covenant: clone(covenant) };
    },
    compile(tenantId, workId, claims = []) {
      const work = scoped(tenantId, workId); if (!work.covenant) return { ok: false, error: "covenant_required" };
      const obligations = claims.map((claim, index) => {
        const item = { schema: "nyra.icf.obligation/1.0", obligation_id: claim.obligation_id || id("obl"), tenant_id: tenantId, work_id: workId, covenant_digest: work.covenant.digest, kind: claim.kind || "achievement", claim: claim.claim || String(claim), clause_refs: claim.clause_refs || [], criticality: claim.criticality || "medium", parent_ids: claim.parent_ids || [], child_ids: [], status: "open", disposition: null, residual: false, version: 1 };
        item.digest = digest(stable(item)); work.obligations.set(item.obligation_id, item); return item;
      });
      append(work, "obligations_compiled", { obligation_ids: obligations.map((item) => item.obligation_id) }); return { ok: true, obligations: clone(obligations) };
    },
    importLegacy(tenantId, workId, input = {}) {
      const work = scoped(tenantId, workId); if (!work.covenant) { const covenant = this.putCovenant(tenantId, workId, { outcomes: [input.intent || "legacy_work"] }); if (!covenant.ok) return covenant; }
      const nodes = Array.isArray(input.nodes) ? input.nodes : []; const obligations = nodes.map((node) => { const item = { schema: "nyra.icf.obligation/1.0", obligation_id: node.obligation_id || id("obl"), tenant_id: tenantId, work_id: workId, covenant_digest: work.covenant.digest, kind: node.kind || "achievement", claim: node.claim || node.title || "legacy obligation", criticality: node.criticality || "medium", status: node.done === true ? "in_progress" : "open", disposition: null, legacy_imported: true, legacy_done_evidence: node.done === true ? "evidence_submitted" : null, parent_ids: node.parent_id ? [node.parent_id] : [], child_ids: [] }; item.digest = digest(stable(item)); work.obligations.set(item.obligation_id, item); return item; });
      append(work, "legacy_work_imported", { node_count: obligations.length, verified_done_count: 0 }); return { ok: true, obligations: clone(obligations), rule: "legacy_done_is_evidence_submitted_not_verified" };
    },
    decompose(tenantId, workId, parentId, children = [], coverage = {}) {
      const work = scoped(tenantId, workId); const parent = work.obligations.get(parentId);
      if (!parent) return { ok: false, error: "obligation_not_found" };
      if (!Array.isArray(children) || !children.length || !coverage.predicates) return { ok: false, error: "coverage_certificate_required" };
      const parentClauses = new Set(parent.clause_refs || []); const childClauses = new Set(children.flatMap((item) => item.clause_refs || []));
      if ([...parentClauses].some((item) => !childClauses.has(item))) return { ok: false, error: "coverage_incomplete", uncovered_clause_refs: [...parentClauses].filter((item) => !childClauses.has(item)) };
      const certificate = { schema: "nyra.icf.coverage-certificate/1.0", parent_id: parentId, child_ids: children.map((item) => item.obligation_id || id("obl")), predicates: coverage.predicates, clause_refs: [...childClauses], invariants: coverage.invariants || [], prohibitions: coverage.prohibitions || [], digest: digest(stable(coverage)) };
      const created = children.map((claim, index) => { const item = { ...claim, obligation_id: certificate.child_ids[index], tenant_id: tenantId, work_id: workId, covenant_digest: work.covenant?.digest, parent_ids: [parentId], status: "open", disposition: null, version: 1 }; item.digest = digest(stable(item)); work.obligations.set(item.obligation_id, item); return item; });
      parent.child_ids.push(...created.map((item) => item.obligation_id)); parent.status = "transferred"; parent.disposition = "refined"; parent.coverage_certificate = certificate; append(work, "obligation_decomposed", { parent_id: parentId, child_ids: certificate.child_ids, coverage_digest: certificate.digest }); return { ok: true, certificate, obligations: clone(created) };
    },
    merge(tenantId, workId, childIds = [], input = {}) {
      const work = scoped(tenantId, workId); const children = childIds.map((item) => work.obligations.get(item)); if (children.length < 2 || children.some((item) => !item)) return { ok: false, error: "merge_children_required" };
      const parent = { schema: "nyra.icf.obligation/1.0", obligation_id: input.obligation_id || id("obl"), tenant_id: tenantId, work_id: workId, covenant_digest: work.covenant?.digest, kind: input.kind || "achievement", claim: input.claim || children.map((item) => item.claim).join("; "), clause_refs: [...new Set(children.flatMap((item) => item.clause_refs || []))], parent_ids: [], child_ids: childIds, status: "open", disposition: null, version: 1 };
      parent.digest = digest(stable(parent)); work.obligations.set(parent.obligation_id, parent); for (const child of children) { child.parent_ids = [...new Set([...(child.parent_ids || []), parent.obligation_id])]; child.status = "transferred"; child.disposition = "merged"; }
      const certificate = { schema: "nyra.icf.coverage-certificate/1.0", parent_id: parent.obligation_id, child_ids: childIds, clause_refs: parent.clause_refs, predicates: input.predicates || [parent.claim], digest: digest(stable({ parent_id: parent.obligation_id, child_ids: childIds, clause_refs: parent.clause_refs })) }; parent.coverage_certificate = certificate; append(work, "obligations_merged", { parent_id: parent.obligation_id, child_ids: childIds, coverage_digest: certificate.digest }); return { ok: true, obligation: clone(parent), certificate };
    },
    registerCell(tenantId, workId, input = {}) {
      const work = scoped(tenantId, workId); const obligationIds = input.obligation_ids || (input.obligation_id ? [input.obligation_id] : []);
      if (!obligationIds.length || obligationIds.some((item) => !work.obligations.has(item))) return { ok: false, error: "obligation_required" };
      const cell = { schema: "nyra.icf.assurance-cell/1.0", cell_id: input.cell_id || id("cell"), tenant_id: tenantId, work_id: workId, obligation_ids: obligationIds, dependency_cell_ids: input.dependency_cell_ids || [], action: input.action || {}, predicted_delta: input.predicted_delta || {}, effect_boundary: input.effect_boundary || {}, evidence_contract: input.evidence_contract || {}, verification: input.verification || { mode: "independent" }, risk: input.risk || "medium", retry_budget: input.retry_budget ?? 0, retry_count: 0, status: "planned", plan_digest: digest(stable(input)) };
      work.cells.set(cell.cell_id, cell); append(work, "assurance_cell_registered", { cell_id: cell.cell_id, obligation_ids: obligationIds }); return { ok: true, cell: clone(cell) };
    },
    frontier(tenantId, workId) {
      const work = scoped(tenantId, workId); const eligible = [...work.cells.values()].filter((cell) => cell.status === "planned" && cell.obligation_ids.every((item) => OPEN_STATUSES.has(work.obligations.get(item)?.status)) && cell.dependency_cell_ids.every((item) => work.cells.get(item)?.status === "verified"));
      return { cells: clone(eligible), blockers: [...work.cells.values()].filter((cell) => cell.status === "planned" && !eligible.some((item) => item.cell_id === cell.cell_id)).map((cell) => ({ cell_id: cell.cell_id, reason: "dependency_or_obligation_not_ready" })) };
    },
    requestWarrant(tenantId, workId, cellId, input = {}) {
      if (rolloutMode === "off") return { ok: false, error: "icf_disabled" };
      const work = scoped(tenantId, workId); const cell = work.cells.get(cellId);
      const existing = [...work.warrants.values()].find((item) => item.idempotency_key === (input.idempotency_key || ""));
      if (existing) return { ok: true, idempotent_replay: true, warrant: clone(existing) };
      const frontier = this.frontier(tenantId, workId).cells.some((item) => item.cell_id === cellId);
      if (!cell || !frontier) return { ok: false, error: "cell_not_admissible" };
      const warrant = { schema: "nyra.icf.warrant/1.0", warrant_id: id("war"), tenant_id: tenantId, work_id: workId, cell_id: cellId, covenant_digest: work.covenant?.digest, input_digest: input.input_digest || digest(input), pre_state_digest: input.pre_state_digest || null, capability_id: input.capability_id || cell.action.capability_id, canonical_targets: input.canonical_targets || cell.action.canonical_targets || [], nonce: crypto.randomUUID(), idempotency_key: input.idempotency_key || crypto.randomUUID(), expires_at: input.expires_at || new Date(Date.now() + 300000).toISOString(), status: "issued", rollout_mode: rolloutMode, advisory: rolloutMode === "shadow" || rolloutMode === "advisory" };
      warrant.digest = digest(stable(warrant)); work.warrants.set(warrant.warrant_id, warrant); cell.status = "warranted"; append(work, "warrant_issued", { warrant_id: warrant.warrant_id, cell_id: cellId }); return { ok: true, warrant: clone(warrant) };
    },
    reserveWarrant(tenantId, workId, warrantId) {
      const work = scoped(tenantId, workId); const warrant = work.warrants.get(warrantId); if (!warrant || Date.parse(warrant.expires_at) < Date.now()) return { ok: false, error: "warrant_invalid" };
      if (warrant.status === "reserved") return { ok: true, idempotent_replay: true, warrant: clone(warrant) };
      if (warrant.status !== "issued") return { ok: false, error: "warrant_invalid" };
      warrant.status = "reserved"; work.cells.get(warrant.cell_id).status = "running"; append(work, "warrant_reserved", { warrant_id: warrantId }); return { ok: true, warrant: clone(warrant) };
    },
    reportExecution(tenantId, workId, warrantId, input = {}) {
      const work = scoped(tenantId, workId); const warrant = work.warrants.get(warrantId); if (!warrant) return { ok: false, error: "warrant_not_found" };
      if (["effect_confirmed", "no_effect", "unknown"].includes(warrant.status)) return { ok: true, idempotent_replay: true, warrant: clone(warrant), cell: clone(work.cells.get(warrant.cell_id)) };
      if (warrant.status !== "reserved") return { ok: false, error: "warrant_not_reserved" };
      const cell = work.cells.get(warrant.cell_id); const status = ["effect_confirmed", "no_effect", "unknown"].includes(input.status) ? input.status : "unknown";
      warrant.status = status; cell.status = status === "effect_confirmed" ? "evidence_submitted" : status === "unknown" ? "divergent" : "failed";
      if (status === "unknown") { cell.retry_blocked = true; const residual = { obligation_id: id("obl"), tenant_id: tenantId, work_id: workId, kind: "epistemic", claim: `Determine effect of warrant ${warrantId}`, criticality: "high", status: "open", residual: true, parent_ids: cell.obligation_ids }; residual.digest = digest(stable(residual)); work.obligations.set(residual.obligation_id, residual); }
      append(work, "execution_reported", { warrant_id: warrantId, status, residual_created: status === "unknown" }); return { ok: true, warrant: clone(warrant), cell: clone(cell) };
    },
    retryCell(tenantId, workId, cellId) {
      const work = scoped(tenantId, workId); const cell = work.cells.get(cellId); if (!cell) return { ok: false, error: "cell_not_found" };
      if (cell.retry_blocked) return { ok: false, error: "retry_blocked_unknown_effect" };
      if (cell.retry_count >= cell.retry_budget) return { ok: false, error: "retry_budget_exhausted" };
      cell.retry_count = (cell.retry_count || 0) + 1; cell.status = "planned"; append(work, "cell_retry_scheduled", { cell_id: cellId, retry_count: cell.retry_count }); return { ok: true, cell: clone(cell) };
    },
    verifyLedger(tenantId, workId) {
      const work = scoped(tenantId, workId); const valid = work.events.every((item, index) => item.seq === index + 1 && item.previous_digest === (index ? work.events[index - 1].digest : null) && item.digest === digest(stable({ ...item, digest: undefined })));
      return { valid, head: work.events.at(-1)?.digest || null, sequence: work.events.length };
    },
    addEvidence(tenantId, workId, input = {}) {
      const work = scoped(tenantId, workId); if (!TRUTH_STATES.has(input.truth_state)) return { ok: false, error: "truth_state_invalid" };
      const evidence = { schema: "nyra.icf.evidence-cell/1.0", evidence_id: id("ev"), tenant_id: tenantId, work_id: workId, obligation_id: input.obligation_id, cell_id: input.cell_id, source_identity: input.source_identity || null, source_authority: input.source_authority || "unknown", subject_digest: input.subject_digest || null, oracle_digest: input.oracle_digest || null, observation_time: input.observation_time || new Date().toISOString(), fresh_until: input.fresh_until || null, truth_state: input.truth_state, verified: false, verifier_identity: null, warrant_nonce: input.warrant_nonce || null };
      evidence.digest = digest(stable(evidence)); work.evidence.set(evidence.evidence_id, evidence); append(work, "evidence_recorded", { evidence_id: evidence.evidence_id, truth_state: evidence.truth_state }); return { ok: true, evidence: clone(evidence) };
    },
    verifyEvidence(tenantId, workId, evidenceId, input = {}) {
      const work = scoped(tenantId, workId); const evidence = work.evidence.get(evidenceId);
      if (!evidence) return { ok: false, error: "evidence_not_found" };
      if (!input.verifier_identity || input.verifier_identity === evidence.source_identity) return { ok: false, error: "independent_verifier_required" };
      if (evidence.truth_state !== "TRUE") return { ok: false, error: "evidence_not_positive" };
      if (evidence.fresh_until && Date.parse(evidence.fresh_until) < Date.now()) { evidence.truth_state = "STALE"; return { ok: false, error: "evidence_stale" }; }
      if (!evidence.source_identity || !evidence.subject_digest || !evidence.oracle_digest || evidence.source_authority === "unknown") return { ok: false, error: "evidence_provenance_incomplete" };
      evidence.verified = true; evidence.verifier_identity = input.verifier_identity; evidence.verification_digest = digest(stable({ evidence: evidence.digest, verifier: input.verifier_identity, at: new Date().toISOString() })); append(work, "evidence_verified", { evidence_id: evidenceId, verifier_identity: input.verifier_identity }); return { ok: true, evidence: clone(evidence) };
    },
    invalidateEvidence(tenantId, workId, predicate = {}) {
      const work = scoped(tenantId, workId); const invalidated = [];
      for (const evidence of work.evidence.values()) {
        const match = (predicate.subject_digest && evidence.subject_digest === predicate.subject_digest)
          || (predicate.oracle_digest && evidence.oracle_digest === predicate.oracle_digest)
          || (predicate.cell_id && evidence.cell_id === predicate.cell_id);
        if (match && evidence.truth_state === "TRUE") { evidence.truth_state = "STALE"; evidence.invalidated_reason = predicate.reason || "upstream_drift"; invalidated.push(evidence.evidence_id); }
      }
      if (invalidated.length) append(work, "evidence_invalidated", { evidence_ids: invalidated, reason: predicate.reason || "upstream_drift" });
      return { ok: true, invalidated_evidence_ids: invalidated };
    },
    invalidateGraph(tenantId, workId, input = {}) {
      const work = scoped(tenantId, workId); const obligations = new Set(input.obligation_id ? [input.obligation_id] : []); const cells = new Set(input.cell_id ? [input.cell_id] : []);
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of work.obligations.values()) if ([...(item.parent_ids || [])].some((parent) => obligations.has(parent)) && !obligations.has(item.obligation_id)) { obligations.add(item.obligation_id); changed = true; }
        for (const item of work.cells.values()) if ([...(item.obligation_ids || [])].some((ref) => obligations.has(ref)) || [...(item.dependency_cell_ids || [])].some((ref) => cells.has(ref))) if (!cells.has(item.cell_id)) { cells.add(item.cell_id); changed = true; }
      }
      const invalidatedEvidence = []; for (const evidence of work.evidence.values()) if (obligations.has(evidence.obligation_id) || cells.has(evidence.cell_id)) { evidence.truth_state = "STALE"; evidence.verified = false; evidence.invalidated_reason = input.reason || "transitive_drift"; invalidatedEvidence.push(evidence.evidence_id); }
      for (const cellId of cells) { const cell = work.cells.get(cellId); if (cell && cell.status !== "verified") cell.status = "stale"; }
      const result = { obligation_ids: [...obligations], cell_ids: [...cells], evidence_ids: invalidatedEvidence, reason: input.reason || "transitive_drift" }; append(work, "graph_invalidated", result); return { ok: true, result };
    },
    reconcile(tenantId, workId, input = {}) {
      const work = scoped(tenantId, workId); const expected = digest(stable(input.expected_delta || {})); const observed = digest(stable(input.observed_delta || {})); const state = input.truth_state || (expected === observed ? "TRUE" : "CONFLICTING");
      const result = { expected_digest: expected, observed_digest: observed, truth_state: TRUTH_STATES.has(state) ? state : "UNKNOWN", side_effects: input.side_effects || [] };
      if (result.truth_state !== "TRUE") { const residual = { obligation_id: id("obl"), tenant_id: tenantId, work_id: workId, kind: "achievement", claim: `Reconcile residual for ${input.cell_id || "unknown cell"}`, criticality: input.criticality || "high", status: "open", residual: true, parent_ids: input.obligation_ids || [] }; residual.digest = digest(stable(residual)); work.obligations.set(residual.obligation_id, residual); result.residual_obligation_id = residual.obligation_id; }
      append(work, "reality_reconciled", result); return { ok: true, result };
    },
    beginClosure(tenantId, workId) {
      const work = scoped(tenantId, workId); if (work.closure === "CLOSING") return { ok: true, snapshot: work.closure_snapshot };
      const blockers = closure(work); if (blockers.decision === "BLOCK") return { ok: false, error: "closure_blocked", blockers };
      for (const warrant of work.warrants.values()) if (warrant.status === "issued") warrant.status = "revoked";
      work.closure = "CLOSING"; work.closure_snapshot = { ledger_head: work.events.at(-1)?.digest || null, version: work.version, captured_at: new Date().toISOString(), state_digest: digest(stable({ covenant: work.covenant, obligations: [...work.obligations.values()], cells: [...work.cells.values()], evidence: [...work.evidence.values()] })) };
      append(work, "closure_started", work.closure_snapshot); return { ok: true, snapshot: clone(work.closure_snapshot) };
    },
    localJoin(tenantId, workId, snapshot) {
      const work = scoped(tenantId, workId); if (work.closure !== "CLOSING" || work.closure_snapshot?.state_digest !== snapshot?.state_digest) return { ok: false, error: "closure_snapshot_invalid" };
      const blockers = closure(work); const result = { join: "LOCAL_PROOF_JOIN", verified: blockers.decision === "ALLOW_CLOSE", snapshot_digest: snapshot.state_digest, blockers };
      work.local_join = result; append(work, "local_join_completed", result); return { ok: result.verified, result };
    },
    globalJoin(tenantId, workId, snapshot, reality = {}) {
      const work = scoped(tenantId, workId); if (work.closure !== "CLOSING" || work.closure_snapshot?.state_digest !== snapshot?.state_digest) return { ok: false, error: "closure_snapshot_invalid" };
      const result = { join: "GLOBAL_INTENT_JOIN", ...recomputeGlobalIntentJoin({ ...work, snapshot_at: snapshot.captured_at, anti_goal_violations: (reality?.violations || []).length }, { now: Date.now() }), snapshot_digest: snapshot.state_digest };
      result.verified = result.join_decision === "close";
      work.global_join = result; append(work, "global_join_completed", result); return { ok: result.verified, result };
    },
    issueCoreSeal(tenantId, workId) {
      const work = scoped(tenantId, workId); if (work.closure !== "CLOSING" || !work.local_join?.verified || !work.global_join?.verified) return { ok: false, error: "dual_join_required" };
      const signingSecret = process.env.ICF_CORESEAL_SECRET;
      if (rolloutMode === "enforced" && !signingSecret) return { ok: false, error: "coreseal_signing_key_required" };
      if (work.events.at(-1)?.digest !== work.closure_snapshot?.ledger_head && work.events.at(-1)?.type !== "global_join_completed") return { ok: false, error: "ledger_changed" };
      const seal = { schema: "nyra.icf.core-seal/1.0", seal_id: id("seal"), tenant_id: tenantId, work_id: workId, covenant_digest: work.covenant?.digest, obligation_root_digest: digest(stable([...work.obligations.values()])), proof_root_digest: digest(stable([...work.evidence.values()])), final_state_digest: work.closure_snapshot.state_digest, ledger_head: work.events.at(-1)?.digest, closure_class: "SEALED_COMPLETE", decision: "ALLOW_CLOSE", issued_at: new Date().toISOString() };
      seal.digest = digest(stable(seal)); seal.signature_algorithm = "HMAC-SHA256"; seal.signature_key_id = signingSecret ? "env:ICF_CORESEAL_SECRET" : "development-only"; seal.signature = crypto.createHmac("sha256", signingSecret || "development-icf-seal-secret").update(seal.digest).digest("hex"); work.core_seal = seal; work.closure = "SEALED"; append(work, "core_seal_issued", { seal_id: seal.seal_id, seal_digest: seal.digest, signature_algorithm: seal.signature_algorithm }); return { ok: true, seal: clone(seal) };
    },
    verifyCoreSeal(tenantId, workId, seal = null) {
      const work = scoped(tenantId, workId); const candidate = seal || work.core_seal; if (!candidate) return { ok: false, error: "coreseal_not_found" };
      const signingSecret = process.env.ICF_CORESEAL_SECRET || "development-icf-seal-secret"; const expected = crypto.createHmac("sha256", signingSecret).update(candidate.digest).digest("hex");
      return { ok: crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(candidate.signature || ""))), seal_id: candidate.seal_id, algorithm: candidate.signature_algorithm || "HMAC-SHA256" };
    },
    resolve(tenantId, workId, obligationId, disposition, options = {}) {
      const work = scoped(tenantId, workId); const obligation = work.obligations.get(obligationId);
      if (!obligation) return { ok: false, error: "obligation_not_found" }; if (!DISPOSITIONS.has(disposition)) return { ok: false, error: "invalid_disposition" }; if (disposition === "waived" && !options.authority) return { ok: false, error: "waiver_authority_required" };
      obligation.status = disposition; obligation.disposition = disposition; obligation.resolution_ref = options.resolution_ref || null; append(work, "obligation_resolved", { obligation_id: obligationId, disposition }); return { ok: true, obligation: clone(obligation) };
    },
    status(tenantId, workId) {
      const work = scoped(tenantId, workId); const result = closure(work); return { tenant_id: tenantId, work_id: workId, mode: rolloutMode, ledger_head: work.events.at(-1) || null, covenant: clone(work.covenant), obligations: clone([...work.obligations.values()]), cells: clone([...work.cells.values()]), warrants: clone([...work.warrants.values()]), evidence: clone([...work.evidence.values()]), closure: result };
    },
    rollout() { return { mode: rolloutMode, execution_enforced: rolloutMode === "enforced", closure_enforced: rolloutMode === "enforced", shadow_observation: rolloutMode === "shadow", advisory_warning: rolloutMode === "advisory" }; },
  };
}
