const ASSURANCE_LEVELS = Object.freeze(["CAL-0", "CAL-1", "CAL-2", "CAL-3", "CAL-4"]);
const IDENTITY_FIELDS = Object.freeze(["tenant_id", "project_id", "genesis_intent_id", "intent_revision_id", "work_id", "change_id"]);
const REQUIRED_CONTEXT_FIELDS = Object.freeze(["schema_version", "tenant_id", "project_id", "project_state_digest", "genesis_intent_id", "intent_revision_id", "work_id", "change_id", "obligation_ids", "gallery_ticket_ids", "actor_id", "actor_role", "environment", "base_state_digest", "authority_scope", "risk_budget", "issued_at", "expires_at", "single_use_nonce", "context_digest", "lease_id", "event_ledger_sequence"]);
export const CAUSAL_BRANCH_DEFAULTS = Object.freeze({ requires_causal_context: true, can_propose_intent_revision: false, can_approve_intent_revision: false, can_create_change: false, can_execute_change: false, can_produce_evidence: true, can_reconcile_outcome: false, can_close_obligation: false, minimum_assurance_level: "CAL-1", allowed_environments: Object.freeze(["shadow", "staging", "production"]), required_observers: Object.freeze([]), inherited_constraints: Object.freeze([]), context_schema_version: "causal_context_envelope_v1" });
export const CAUSAL_BRANCH_AUTHORITY_SCOPES = Object.freeze({
  proposed_intent_revision: "causal:intent:propose",
  approved_intent_revision: "causal:intent:approve",
  created_change: "causal:change:create",
  executed_change: "causal:change:execute",
  evidence: "causal:evidence:produce",
  reconciliation: "causal:outcome:reconcile",
  closure: "causal:obligation:close",
});
const list = (value) => Array.isArray(value) ? value : [];
const uniqueStrings = (value) => [...new Set(list(value).map((item) => String(item).trim()).filter(Boolean))];
function clone(value) { if (Array.isArray(value)) return value.map(clone); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])); return value; }
function normalizedContract(source = {}, override = {}) { const merged = { ...CAUSAL_BRANCH_DEFAULTS, ...clone(source), ...clone(override) }; merged.allowed_environments = Object.freeze(uniqueStrings(merged.allowed_environments).sort()); merged.inherited_constraints = Object.freeze(uniqueStrings(merged.inherited_constraints).sort()); merged.required_observers = Object.freeze(uniqueStrings(merged.required_observers).sort()); if (!ASSURANCE_LEVELS.includes(merged.minimum_assurance_level)) merged.minimum_assurance_level = CAUSAL_BRANCH_DEFAULTS.minimum_assurance_level; return merged; }

export function extendCausalBranchRegistry(branches, overrides = {}) {
  const defaults = overrides.default && typeof overrides.default === "object" ? overrides.default : {};
  if (Array.isArray(branches)) return branches.map((branch) => { const id = String(branch?.id || ""); return normalizedContract(branch, { ...defaults, ...(overrides[id] || {}) }); });
  const source = branches && typeof branches === "object" ? branches : {};
  return Object.fromEntries(Object.entries(source).map(([id, branch]) => [id, normalizedContract(branch, { ...defaults, ...(overrides[id] || {}) })]));
}

const timestamp = (value) => { const result = Date.parse(String(value || "")); return Number.isFinite(result) ? result : null; };
const assuranceIndex = (value) => ASSURANCE_LEVELS.indexOf(String(value || ""));

export function validateCausalBranchInvocation({ context, contract, output, authenticatedTenantId, now = new Date(), verifyObserverEvidence } = {}) {
  const envelope = context && typeof context === "object" ? context : {}; const branchContract = normalizedContract(contract); const result = output && typeof output === "object" ? output : {}; const errors = []; const add = (code, field, detail) => errors.push({ code, field, ...(detail ? { detail } : {}) });
  if (branchContract.requires_causal_context) for (const field of REQUIRED_CONTEXT_FIELDS) { const value = envelope[field]; if (value === undefined || value === null || value === "" || (Array.isArray(value) && field === "obligation_ids" && value.length === 0)) add("CAUSAL_CONTEXT_REQUIRED", field); }
  if (!authenticatedTenantId || envelope.tenant_id !== authenticatedTenantId) add("CROSS_TENANT_CONTEXT", "tenant_id");
  if (envelope.schema_version && envelope.schema_version !== branchContract.context_schema_version) add("CONTEXT_SCHEMA_MISMATCH", "schema_version");
  if (envelope.environment && !branchContract.allowed_environments.includes(envelope.environment)) add("ENVIRONMENT_NOT_ALLOWED", "environment");
  const issuedAt = timestamp(envelope.issued_at); const expiresAt = timestamp(envelope.expires_at); const currentTime = now instanceof Date ? now.getTime() : timestamp(now);
  if (issuedAt === null || expiresAt === null || currentTime === null) add("CONTEXT_TIME_INVALID", "issued_at"); else { if (issuedAt > currentTime) add("CONTEXT_NOT_YET_VALID", "issued_at"); if (expiresAt <= currentTime) add("CONTEXT_EXPIRED", "expires_at"); if (expiresAt <= issuedAt) add("CONTEXT_TTL_INVALID", "expires_at"); }
  for (const field of IDENTITY_FIELDS) if (result[field] !== undefined && result[field] !== envelope[field]) add("IDENTITY_MUTATION_BLOCKED", field);
  if (result.project_state_digest !== undefined && result.project_state_digest !== envelope.project_state_digest) add("STALE_PROJECT_STATE", "project_state_digest");
  const inherited = new Set(uniqueStrings(result.inherited_constraints));
  const requiredConstraints = uniqueStrings([...branchContract.inherited_constraints, ...uniqueStrings(envelope.inherited_constraints)]).sort();
  for (const constraint of requiredConstraints) if (!inherited.has(constraint)) add("INHERITED_CONSTRAINT_LOST", "inherited_constraints", constraint);
  const authority = new Set(uniqueStrings(envelope.authority_scope));
  const requireGovernedAuthority = (active, allowed, field, scopeKey = field) => {
    if (active && (!allowed || !authority.has(CAUSAL_BRANCH_AUTHORITY_SCOPES[scopeKey]))) add("BRANCH_AUTHORITY_EXCEEDED", field);
  };
  const closureRequested = Boolean(result.closure) || ["VERIFIED_FINAL", "CLOSED"].includes(result.obligation_state);
  requireGovernedAuthority(Boolean(result.proposed_intent_revision), branchContract.can_propose_intent_revision, "proposed_intent_revision");
  requireGovernedAuthority(Boolean(result.approved_intent_revision), branchContract.can_approve_intent_revision, "approved_intent_revision");
  requireGovernedAuthority(Boolean(result.created_change), branchContract.can_create_change, "created_change");
  requireGovernedAuthority(Boolean(result.executed_change), branchContract.can_execute_change, "executed_change");
  requireGovernedAuthority(list(result.evidence).length > 0, branchContract.can_produce_evidence, "evidence");
  requireGovernedAuthority(Boolean(result.reconciliation), branchContract.can_reconcile_outcome, "reconciliation");
  requireGovernedAuthority(closureRequested, branchContract.can_close_obligation, "obligation_state", "closure");
  if (assuranceIndex(result.causal_assurance_level || "CAL-0") < assuranceIndex(branchContract.minimum_assurance_level)) add("ASSURANCE_LEVEL_INSUFFICIENT", "causal_assurance_level");
  const evidence = list(result.evidence);
  const verifiedObserverRoles = new Set();
  if (typeof verifyObserverEvidence === "function") {
    for (const item of evidence) {
      let verification;
      try { verification = verifyObserverEvidence({ evidence: clone(item), context: clone(envelope), contract: clone(branchContract) }); } catch { verification = null; }
      if (verification && typeof verification.then === "function") {
        add("OBSERVER_VERIFIER_ASYNC_UNSUPPORTED", "evidence");
        continue;
      }
      const independence = String(verification?.independence || "").toUpperCase();
      if (verification?.verified === true && verification?.receipt_verified === true &&
          verification?.readback_verified === true && verification?.identity_binding_verified === true &&
          typeof verification?.observer_identity === "string" && verification.observer_identity.length > 0 &&
          verification.observer_identity !== envelope.actor_id &&
          typeof verification?.observer_role === "string" && verification.observer_role.length > 0 &&
          typeof verification?.independence_key === "string" && verification.independence_key.length > 0 &&
          ["INDEPENDENT_SYSTEM", "INDEPENDENT_HUMAN", "FORMAL"].includes(independence)) {
        verifiedObserverRoles.add(verification.observer_role);
      }
    }
  }
  const verifiedOutcomeRequested = Boolean(result.reconciliation) || closureRequested;
  if (verifiedOutcomeRequested && typeof verifyObserverEvidence !== "function") add("OBSERVER_VERIFIER_REQUIRED", "evidence");
  if (typeof verifyObserverEvidence === "function" || verifiedOutcomeRequested) {
    for (const requiredRole of branchContract.required_observers) {
      if (!verifiedObserverRoles.has(requiredRole)) add("INDEPENDENT_OBSERVER_REQUIRED", "evidence", requiredRole);
    }
  }
  const ok = errors.length === 0; return { ok, decision: ok ? "ALLOWED" : "BLOCKED", code: ok ? "CAUSAL_BRANCH_VALID" : errors[0].code, errors, context_digest: envelope.context_digest || null, evidence_mode: typeof verifyObserverEvidence === "function" ? "VERIFIED" : "PROPOSAL_ONLY" };
}

export function buildCausalBranchResult(input = {}) {
  const context = input.context && typeof input.context === "object" ? input.context : {}; const contract = normalizedContract(input.contract);
  return { schema_version: "causal_branch_result_v1", tenant_id: context.tenant_id || null, project_id: context.project_id || null, genesis_intent_id: context.genesis_intent_id || null, intent_revision_id: context.intent_revision_id || null, work_id: context.work_id || null, change_id: context.change_id || null, obligation_ids: uniqueStrings(context.obligation_ids), context_digest: context.context_digest || null, input_state_digest: input.input_state_digest || context.project_state_digest || null, output_digest: input.output_digest || null, decision: input.decision || null, proposal: input.proposal || null, evidence: list(input.evidence).map(clone), residual_risks: uniqueStrings(input.residual_risks), obligation_state: input.obligation_state || "UNKNOWN", inherited_constraints: uniqueStrings([...contract.inherited_constraints, ...uniqueStrings(context.inherited_constraints)]).sort(), causal_assurance_level: input.causal_assurance_level || "CAL-0" };
}
