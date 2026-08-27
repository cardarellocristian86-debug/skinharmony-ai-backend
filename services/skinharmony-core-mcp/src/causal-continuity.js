const identifier = { type: "string", minLength: 1, maxLength: 160 };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const dateTime = { type: "string", format: "date-time" };
const stringList = { type: "array", maxItems: 100, uniqueItems: true, items: identifier };
const verificationHorizon = object({ horizon: identifier, due_at: dateTime }, ["horizon", "due_at"]);
const verificationHorizons = { type: "array", maxItems: 50, items: verificationHorizon };
const independence = { type: "string", enum: ["EXECUTOR", "INDEPENDENT_SYSTEM", "INDEPENDENT_HUMAN", "FORMAL"] };
const galleryEntityType = { type: "string", enum: ["PROJECT_GENESIS", "INTENT_REVISION", "ARCHITECTURE_DECISION", "WORK", "CHANGE", "BLOCKER", "CONFLICT", "EVIDENCE", "VERIFICATION", "REMEDIATION", "ROLLBACK", "OUTCOME", "CLOSURE", "REOPENING"] };
const galleryView = { type: "string", enum: ["project_timeline", "intent_evolution", "decision_history", "work_graph", "change_timeline", "evidence", "closure", "resume"] };
const galleryReadback = object({
  tenant_id: identifier,
  project_id: identifier,
  project_state_digest: digest,
  genesis_intent_id: identifier,
  intent_revision_id: identifier,
  work_id: identifier,
  change_id: identifier,
  obligation_ids: stringList,
  entity_type: galleryEntityType,
  ticket_id: { type: "string", minLength: 1, maxLength: 240 },
  parent_ticket_id: { type: "string", minLength: 1, maxLength: 240 },
  core_event_sequence: { type: "integer", minimum: 1 },
  context_digest: digest,
  provenance: { type: "object", additionalProperties: true },
  binding_digest: digest,
  core_event_hash: digest,
}, ["tenant_id", "project_id", "project_state_digest", "genesis_intent_id", "intent_revision_id", "work_id", "obligation_ids", "entity_type", "ticket_id", "core_event_sequence", "context_digest", "binding_digest", "core_event_hash"]);
const evidenceContract = object({
  required_sources: { type: "array", maxItems: 50, uniqueItems: true, items: identifier },
  minimum_independence: independence,
  minimum_independent_observers: { type: "integer", minimum: 0, maximum: 32 },
  freshness_seconds: { type: "integer", minimum: 0 },
  minimum_assurance_level: { type: "string", enum: ["CAL-0", "CAL-1", "CAL-2", "CAL-3", "CAL-4"] },
  horizons: verificationHorizons,
  falsification_conditions: stringList,
  forbidden_effect_observers: stringList,
});

function object(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function executionTransition(idField, nonExecutionStates) {
  const baseProperties = {
    [idField]: identifier,
    target_state: { type: "string", enum: [...nonExecutionStates, "EXECUTED"] },
    reason: { type: "string", minLength: 1, maxLength: 2000 },
    lease_id: identifier,
    context_digest: digest,
    execution_evidence_digest: digest,
    idempotency_key: identifier,
  };
  const baseRequired = [idField, "target_state", "reason", "idempotency_key"];
  return {
    type: "object",
    properties: baseProperties,
    required: baseRequired,
    additionalProperties: false,
    anyOf: [
      object({ ...baseProperties, target_state: { type: "string", enum: nonExecutionStates } }, baseRequired),
      object({ ...baseProperties, target_state: { const: "EXECUTED" } }, [
        ...baseRequired,
        "lease_id",
        "context_digest",
        "execution_evidence_digest",
      ]),
    ],
  };
}

function tool(name, title, description, inputSchema, readOnly) {
  return {
    name,
    title,
    description,
    inputSchema,
    outputSchema: { type: "object", additionalProperties: true },
    scopes: [readOnly ? "core:read" : "core:govern"],
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  };
}

const definitions = [
  ["project_identity_resolve", "Resolve project identity", "Resolve an authoritative project identity without treating a repository name as authority.", object({ project_id: identifier, alias: { type: "string", minLength: 1, maxLength: 500 } }), true],
  ["project_identity_create", "Create project identity", "Create one tenant-scoped authoritative project identity.", object({ alias: { type: "string", minLength: 1, maxLength: 500 }, canonical_name: { type: "string", minLength: 1, maxLength: 500 }, derived_from_project_id: identifier, provenance: { type: "object", additionalProperties: true }, alias_verified_at: dateTime, idempotency_key: identifier }, ["alias", "idempotency_key"]), false],
  ["project_scope_read", "Read project scope", "Read the verified project scope manifest.", object({ project_id: identifier }, ["project_id"]), true],
  ["project_scope_bind", "Bind project scope resource", "Bind a verified resource to the project scope without inventing legacy lineage.", object({ project_id: identifier, resource_type: identifier, canonical_identifier: { type: "string", minLength: 1, maxLength: 1000 }, environment: identifier, ownership: { type: "object", additionalProperties: true }, active: { type: "boolean" }, provenance: { type: "object", additionalProperties: true }, resource_digest: digest, last_verified_at: dateTime, idempotency_key: identifier }, ["project_id", "resource_type", "canonical_identifier", "environment", "idempotency_key"]), false],
  ["project_state_snapshot", "Snapshot project state", "Create a deterministic verified project-state snapshot bound to the event ledger.", object({ project_id: identifier, base_state_digest: digest, observed_at: dateTime, idempotency_key: identifier }, ["project_id", "idempotency_key"]), false],
  ["project_state_verify", "Verify project state", "Verify a state digest and report stale state without authorizing execution.", object({ project_id: identifier, project_state_digest: digest }, ["project_id", "project_state_digest"]), true],
  ["genesis_intent_read", "Read genesis intent", "Read the immutable Genesis Intent for a project.", object({ project_id: identifier }, ["project_id"]), true],
  ["genesis_intent_create", "Create genesis intent", "Create an immutable Genesis Intent when no authoritative one exists.", object({ project_id: identifier, intent_text: { type: "string", minLength: 1, maxLength: 20000 }, idempotency_key: identifier }, ["project_id", "intent_text", "idempotency_key"]), false],
  ["intent_revision_propose", "Propose intent revision", "Append a proposed intent revision; proposal never grants approval.", object({ project_id: identifier, parent_revision_id: identifier, alias: identifier, classification: { type: "string", enum: ["REFINEMENT", "SCOPE_CHANGE", "STRATEGIC_PIVOT", "PURPOSE_CHANGE", "ROLLBACK", "TERMINATION"] }, motivation: { type: "string", minLength: 1, maxLength: 8000 }, problem: { type: "string", minLength: 1, maxLength: 8000 }, alternatives_considered: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: true } }, chosen_alternative: { type: "object", additionalProperties: true }, rejected_alternatives: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: true } }, scope_added: stringList, scope_removed: stringList, invariants: stringList, risks: stringList, affected_work_ids: stringList, obligations_maintained: stringList, obligations_replaced: stringList, authorization: { type: "object", additionalProperties: true }, idempotency_key: identifier }, ["project_id", "alias", "classification", "motivation", "problem", "idempotency_key"]), false],
  ["intent_revision_approve", "Approve intent revision", "Apply the required Core or owner authority to a proposed intent revision.", object({ project_id: identifier, intent_revision_id: identifier, approved: { type: "boolean" }, idempotency_key: identifier }, ["project_id", "intent_revision_id", "approved", "idempotency_key"]), false],
  ["intent_revision_impact", "Analyze intent revision impact", "Classify the impact of an intent revision on open Work identities.", object({ project_id: identifier, intent_revision_id: identifier, work_ids: stringList }, ["project_id", "intent_revision_id"]), true],
  ["project_decision_path_read", "Read project decision path", "Reconstruct the project decision path from authoritative events and records.", object({ project_id: identifier, through_event_sequence: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 500 } }, ["project_id"]), true],
  ["work_bind_intent", "Bind Work to intent", "Bind a Work identity to one project state and approved intent revision.", object({ project_id: identifier, work_id: identifier, intent_revision_id: identifier, base_state_digest: digest, legacy_binding_state: identifier, provenance: { type: "object", additionalProperties: true }, idempotency_key: identifier }, ["project_id", "work_id", "intent_revision_id", "idempotency_key"]), false],
  ["change_create", "Create causal change", "Create a semantic Change under an existing Work identity.", object({ project_id: identifier, work_id: identifier, base_state_digest: digest, parent_change_id: identifier, alias: identifier, reason: { type: "string", minLength: 1, maxLength: 8000 }, scope: { type: "object", additionalProperties: true }, expected_effects: stringList, forbidden_effects: stringList, expected_target_state: { type: "object", additionalProperties: true }, idempotency_key: identifier }, ["project_id", "work_id", "base_state_digest", "reason", "idempotency_key"]), false],
  ["change_read", "Read causal change", "Read a Change and its state transitions.", object({ change_id: identifier }, ["change_id"]), true],
  ["change_transition", "Transition causal change", "Transition a Change through the authoritative state machine. Execution requires an exact consumed context and evidence digest.", executionTransition("change_id", ["MODELED", "REMEDIATING"]), false],
  ["causal_context_issue", "Issue causal context", "Ask Universal Core to issue an expiring, anti-replay Causal Context Envelope.", object({ project_id: identifier, project_state_digest: digest, work_id: identifier, change_id: identifier, obligation_ids: { ...stringList, minItems: 1 }, gallery_ticket_ids: stringList, delegated_from: object({ parent_context_digest: digest, delegated_actor_id: identifier }, ["parent_context_digest", "delegated_actor_id"]), environment: identifier, authority_scope: stringList, risk_budget: { type: "object", additionalProperties: { type: "number" } }, inherited_constraints: stringList, expires_at: dateTime, lease_id: identifier, enforcement_mode: { type: "string", enum: ["SHADOW", "ENFORCE_NEW_WORK", "ENFORCE_ALL_COMPATIBLE"] }, idempotency_key: identifier }, ["project_id", "project_state_digest", "work_id", "change_id", "obligation_ids", "environment", "expires_at", "lease_id", "idempotency_key"]), false],
  ["causal_context_validate", "Validate causal context", "Validate and optionally consume a Core-issued Causal Context Envelope without trusting caller identity fields.", object({ envelope: { type: "object", additionalProperties: true }, signature: { anyOf: [{ type: "string", pattern: "^hnc_[a-f0-9]{64}$" }, object({ key_id: identifier, digest }, ["key_id", "digest"])] }, consume: { type: "boolean" }, expected_environment: identifier, required_authority: identifier }, ["envelope", "signature"]), false],
  ["causal_obligation_create", "Create causal obligation", "Create an evidence-bound causal obligation before governed execution.", object({ change_id: identifier, claim: { type: "string", minLength: 1, maxLength: 10000 }, owner_id: identifier, delegated_owners: stringList, expected_effects: stringList, forbidden_effects: stringList, evidence_contract: evidenceContract, assurance_level: { type: "string", enum: ["CAL-0", "CAL-1", "CAL-2", "CAL-3", "CAL-4"] }, verification_horizons: verificationHorizons, rollback_plan: { type: "object", additionalProperties: true }, residual_obligations: stringList, next_verification_at: dateTime, idempotency_key: identifier }, ["change_id", "claim", "evidence_contract", "assurance_level", "rollback_plan", "idempotency_key"]), false],
  ["causal_obligation_read", "Read causal obligation", "Read a causal obligation and its durable state.", object({ obligation_id: identifier }, ["obligation_id"]), true],
  ["causal_obligation_transition", "Transition causal obligation", "Transition an obligation through the authoritative state machine. Execution requires an exact consumed context and evidence digest.", executionTransition("obligation_id", ["MODELED", "REMEDIATING", "ESCALATED"]), false],
  ["causal_observation_record", "Record reality observation", "Record a tenant-bound observation with provenance, freshness and an evidence digest.", object({ obligation_id: identifier, source: identifier, observer_identity: identifier, source_provenance: { type: "object", additionalProperties: true }, independence, baseline: { type: "object", additionalProperties: true }, freshness_seconds: { type: "integer", minimum: 0 }, observed_at: dateTime, evidence_digest: digest, causal_relation: identifier, confidence: { type: "number", minimum: 0, maximum: 1 }, contradiction_status: { type: "string", enum: ["NONE", "POTENTIAL", "CONFIRMED"] }, idempotency_key: identifier }, ["obligation_id", "source", "evidence_digest", "confidence", "idempotency_key"]), false],
  ["causal_reconcile", "Reconcile causal outcome", "Reconcile intent, prediction, action, observations and residual risks.", object({ obligation_id: identifier, achieved_assurance_level: { type: "string", enum: ["CAL-0", "CAL-1", "CAL-2", "CAL-3", "CAL-4"] }, verdict: { type: "string", enum: ["VERIFIED_PROVISIONAL", "VERIFIED_FINAL", "PARTIAL", "CONTRADICTED", "HARMFUL", "UNKNOWN"] }, intent: { type: "object", additionalProperties: true }, prediction: { type: "object", additionalProperties: true }, action: { type: "object", additionalProperties: true }, baseline: { type: "object", additionalProperties: true }, result: { type: "object", additionalProperties: true }, alternative_causes: stringList, side_effects: stringList, forbidden_effects: stringList, residual_risks: stringList, open_obligation_ids: stringList, idempotency_key: identifier }, ["obligation_id", "achieved_assurance_level", "verdict", "idempotency_key"]), false],
  ["causal_close", "Close causal obligation", "Request provisional or final closure; Core alone evaluates the Evidence Contract and assurance level.", object({ obligation_id: identifier, reconciliation_id: identifier, final: { type: "boolean" }, temporal_checks_satisfied: { type: "boolean" }, temporal_checks: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: true } }, idempotency_key: identifier }, ["obligation_id", "reconciliation_id", "final", "idempotency_key"]), false],
  ["causal_reopen", "Reopen causal obligation", "Reopen closure from contradictory or delayed evidence without rewriting history.", object({ obligation_id: identifier, trigger: { type: "string", enum: ["CONTRADICTORY_EVIDENCE", "TEMPORAL_CHECK_FAILED", "PRODUCTION_COMMIT_MISMATCH", "METRIC_DEGRADED", "DEPENDENCY_INVALIDATED", "REGRESSION_DISCOVERED"] }, evidence_digest: digest, reason: { type: "string", minLength: 1, maxLength: 10000 }, idempotency_key: identifier }, ["obligation_id", "trigger", "reason", "idempotency_key"]), false],
  ["continuity_capsule_build", "Build causal continuity capsule", "Build a digest-verifiable capsule from the authoritative causal ledger.", object({ project_id: identifier, work_id: identifier, generated_from_event_sequence: { type: "integer", minimum: 1 }, bounded_history: { type: "integer", minimum: 1, maximum: 1000 }, idempotency_key: identifier }, ["project_id", "work_id", "idempotency_key"]), false],
  ["continuity_capsule_resume", "Resume causal continuity capsule", "Resume only after capsule digest and current project state verification.", object({ project_id: identifier, work_id: identifier }, ["project_id", "work_id"]), true],
  ["project_timeline_read", "Read project timeline", "Read a bounded page of project causal events.", object({ project_id: identifier, before_sequence: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 500 } }, ["project_id"]), true],
  ["gallery_binding_project", "Project Gallery binding", "Create a tenant-bound Gallery projection from an authoritative causal context.", object({ project_id: identifier, project_state_digest: digest, genesis_intent_id: identifier, intent_revision_id: identifier, work_id: identifier, change_id: identifier, obligation_ids: stringList, entity_type: galleryEntityType, ticket_id: { type: "string", minLength: 1, maxLength: 240 }, parent_ticket_id: { type: "string", minLength: 1, maxLength: 240 }, context_digest: digest, provenance: { type: "object", additionalProperties: true }, idempotency_key: identifier }, ["project_id", "project_state_digest", "genesis_intent_id", "intent_revision_id", "work_id", "obligation_ids", "entity_type", "ticket_id", "context_digest", "idempotency_key"]), false],
  ["gallery_projection_claim", "Claim Gallery projections", "Atomically claim a bounded batch of pending Gallery projection outbox records.", object({ project_id: identifier, limit: { type: "integer", minimum: 1, maximum: 50 }, lease_seconds: { type: "integer", minimum: 5, maximum: 300 } }), false],
  ["gallery_projection_complete", "Complete Gallery projection", "Complete one claimed Gallery projection only after exact authoritative readback.", object({ outbox_id: identifier, readback: galleryReadback }, ["outbox_id", "readback"]), false],
  ["gallery_projection_fail", "Fail Gallery projection", "Record a bounded Gallery projection retry or quarantine transition.", object({ outbox_id: identifier, error_code: { type: "string", minLength: 1, maxLength: 120 }, retry_after_seconds: { type: "integer", minimum: 1, maximum: 300 } }, ["outbox_id", "error_code"]), false],
  ["gallery_causal_view_read", "Read Gallery causal view", "Read one bounded tenant/project-scoped Gallery causal projection view.", object({ project_id: identifier, view: galleryView, limit: { type: "integer", minimum: 1, maximum: 200 }, before_sequence: { type: "integer", minimum: 1 } }, ["project_id", "view"]), true],
  ["causal_metrics_snapshot", "Read causal metrics", "Read a bounded tenant/project-scoped causal continuity metrics snapshot.", object({ project_id: identifier }, ["project_id"]), true],
  ["gallery_binding_verify", "Verify Gallery binding", "Verify that a Gallery item is a valid projection of authoritative Core state.", object({ ticket_id: identifier }, ["ticket_id"]), true],
  ["causal_rollout_read", "Read causal rollout", "Read the tenant-scoped causal-continuity rollout mode and version for a project.", object({ project_id: identifier }, ["project_id"]), true],
  ["causal_rollout_set", "Set causal rollout", "Set a tenant-scoped causal-continuity rollout mode with optimistic concurrency.", object({ project_id: identifier, mode: { type: "string", enum: ["SHADOW", "ENFORCE_NEW_WORK", "ENFORCE_ALL_COMPATIBLE"] }, expected_version: { type: "integer", minimum: 1 }, idempotency_key: identifier }, ["project_id", "mode", "expected_version", "idempotency_key"]), false],
];

export const CAUSAL_CONTINUITY_TOOLS = Object.freeze(definitions.map((definition) => tool(...definition)));

export const CAUSAL_CONTINUITY_ROUTES = Object.freeze({
  project_identity_resolve: { method: "GET", path: "/v1/causal/projects/resolve" },
  project_identity_create: { method: "POST", path: "/v1/causal/projects" },
  project_scope_read: { method: "GET", path: "/v1/causal/projects/scope" },
  project_scope_bind: { method: "POST", path: "/v1/causal/projects/scope" },
  project_state_snapshot: { method: "POST", path: "/v1/causal/projects/state/snapshot" },
  project_state_verify: { method: "GET", path: "/v1/causal/projects/state/verify" },
  genesis_intent_read: { method: "GET", path: "/v1/causal/intents/genesis" },
  genesis_intent_create: { method: "POST", path: "/v1/causal/intents/genesis" },
  intent_revision_propose: { method: "POST", path: "/v1/causal/intents/revisions" },
  intent_revision_approve: { method: "POST", path: "/v1/causal/intents/revisions/approve" },
  intent_revision_impact: { method: "GET", path: "/v1/causal/intents/revisions/impact" },
  project_decision_path_read: { method: "GET", path: "/v1/causal/projects/decision-path" },
  work_bind_intent: { method: "POST", path: "/v1/causal/works/bind" },
  change_create: { method: "POST", path: "/v1/causal/changes" },
  change_read: { method: "GET", path: "/v1/causal/changes/read" },
  change_transition: { method: "POST", path: "/v1/causal/changes/transition" },
  causal_context_issue: { method: "POST", path: "/v1/causal/contexts/issue" },
  causal_context_validate: { method: "POST", path: "/v1/causal/contexts/validate" },
  causal_obligation_create: { method: "POST", path: "/v1/causal/obligations" },
  causal_obligation_read: { method: "GET", path: "/v1/causal/obligations/read" },
  causal_obligation_transition: { method: "POST", path: "/v1/causal/obligations/transition" },
  causal_observation_record: { method: "POST", path: "/v1/causal/observations" },
  causal_reconcile: { method: "POST", path: "/v1/causal/reconciliations" },
  causal_close: { method: "POST", path: "/v1/causal/closures" },
  causal_reopen: { method: "POST", path: "/v1/causal/closures/reopen" },
  continuity_capsule_build: { method: "POST", path: "/v1/causal/continuity/capsules" },
  continuity_capsule_resume: { method: "GET", path: "/v1/causal/continuity/resume" },
  project_timeline_read: { method: "GET", path: "/v1/causal/projects/timeline" },
  gallery_binding_project: { method: "POST", path: "/v1/causal/gallery/bindings/project" },
  gallery_projection_claim: { method: "POST", path: "/v1/causal/gallery/projections/claim" },
  gallery_projection_complete: { method: "POST", path: "/v1/causal/gallery/projections/complete" },
  gallery_projection_fail: { method: "POST", path: "/v1/causal/gallery/projections/fail" },
  gallery_causal_view_read: { method: "GET", path: "/v1/causal/gallery/views" },
  causal_metrics_snapshot: { method: "GET", path: "/v1/causal/metrics" },
  gallery_binding_verify: { method: "GET", path: "/v1/causal/gallery/bindings/verify" },
  causal_rollout_read: { method: "GET", path: "/v1/causal/projects/rollout" },
  causal_rollout_set: { method: "POST", path: "/v1/causal/projects/rollout" },
});

function textResult(payload) {
  return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function requireIdentity(identity) {
  const tenantId = String(identity?.tenantId || "").trim();
  if (!tenantId) throw new Error("causal_tenant_identity_required");
  return tenantId;
}

function queryPath(path, args) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else if (typeof value === "object") {
      query.append(key, JSON.stringify(value));
    } else {
      query.append(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function createCausalContinuityHandlers({ coreRequest, issueAgentContext } = {}) {
  if (typeof coreRequest !== "function") throw new TypeError("coreRequest must be a function");
  if (typeof issueAgentContext !== "function") throw new TypeError("issueAgentContext must be a function");
  return Object.fromEntries(definitions.map(([capabilityId]) => [capabilityId, async (args = {}, identity = {}) => {
    const tenantId = requireIdentity(identity);
    if (!identity.agentPresence) throw new Error("agent_presence_session_required");
    const body = { ...(args && typeof args === "object" ? args : {}) };
    delete body.tenant_id;
    delete body.tenantId;
    const agentContext = issueAgentContext({ tenant_id: tenantId, agent_presence: identity.agentPresence });
    if (!agentContext) throw new Error("dtt_agent_identity_not_ready");
    const route = CAUSAL_CONTINUITY_ROUTES[capabilityId];
    const path = route.method === "GET" ? queryPath(route.path, body) : route.path;
    const additionalHeaders = { "x-sh-dtt-agent-context": agentContext };
    const options = route.method === "GET" ? { method: "GET", additionalHeaders } : { method: "POST", body, additionalHeaders };
    const payload = await coreRequest(path, tenantId, options);
    return textResult(payload);
  }]));
}

const GALLERY_BINDING_FIELDS = Object.freeze(["tenant_id", "project_id", "project_state_digest", "genesis_intent_id", "intent_revision_id", "work_id", "core_event_sequence", "context_digest"]);

export function verifyGalleryBinding(binding, authoritative) {
  const candidate = binding && typeof binding === "object" ? binding : {};
  const source = authoritative && typeof authoritative === "object" ? authoritative : {};
  const missing = GALLERY_BINDING_FIELDS.filter((field) => candidate[field] === undefined || candidate[field] === null || candidate[field] === "");
  const authoritative_missing = GALLERY_BINDING_FIELDS.filter((field) => source[field] === undefined || source[field] === null || source[field] === "");
  const mismatches = GALLERY_BINDING_FIELDS.filter((field) => source[field] !== undefined && candidate[field] !== source[field]).map((field) => ({ field, expected: source[field], observed: candidate[field] }));
  for (const field of ["change_id", "parent_ticket_id"]) if (source[field] !== undefined && candidate[field] !== source[field]) mismatches.push({ field, expected: source[field], observed: candidate[field] });
  if (Array.isArray(source.obligation_ids)) {
    const expected = [...new Set(source.obligation_ids.map(String))].sort();
    const observed = [...new Set((Array.isArray(candidate.obligation_ids) ? candidate.obligation_ids : []).map(String))].sort();
    if (JSON.stringify(expected) !== JSON.stringify(observed)) mismatches.push({ field: "obligation_ids", expected, observed });
  }
  const ok = missing.length === 0 && authoritative_missing.length === 0 && mismatches.length === 0;
  return { ok, status: ok ? "BOUND" : "ORPHAN_GALLERY_ITEM", action_authorization_allowed: ok, missing, authoritative_missing, mismatches };
}

const GALLERY_TYPE_BY_EVENT = Object.freeze({ PROJECT_REGISTERED: "PROJECT_GENESIS", GENESIS_INTENT_CREATED: "PROJECT_GENESIS", INTENT_REVISION_PROPOSED: "INTENT_REVISION", INTENT_REVISION_APPROVED: "INTENT_REVISION", DECISION_RECORDED: "ARCHITECTURE_DECISION", WORK_OPENED: "WORK", CHANGE_OPENED: "CHANGE", EVIDENCE_RECORDED: "EVIDENCE", OUTCOME_RECONCILED: "OUTCOME", CLOSURE_PROVISIONAL: "CLOSURE", CLOSURE_FINAL: "CLOSURE", CLOSURE_REOPENED: "REOPENING", REMEDIATION_STARTED: "REMEDIATION", ROLLBACK_EXECUTED: "ROLLBACK" });

export function buildGalleryProjection(event, authoritativeBinding) {
  const source = event && typeof event === "object" ? event : {};
  const payload = source.payload && typeof source.payload === "object" ? source.payload : {};
  const binding = payload.binding && typeof payload.binding === "object" ? payload.binding : payload;
  const authoritativeSource = authoritativeBinding && typeof authoritativeBinding === "object" ? authoritativeBinding : {};
  const authoritative = {
    ...authoritativeSource,
    core_event_sequence: authoritativeSource.core_event_sequence ?? authoritativeSource.sequence ?? authoritativeSource.sequence_number,
  };
  const verification = verifyGalleryBinding(binding, authoritative);
  const eventType = authoritative.event_type || source.event_type || "UNKNOWN";
  return { schema_version: "causal_gallery_projection_v1", entity_type: GALLERY_TYPE_BY_EVENT[eventType] || "EVIDENCE", event_type: eventType, event_id: authoritative.event_id || source.event_id || null, ...binding, core_event_sequence: authoritative.core_event_sequence ?? null, status: verification.ok ? (binding.status || "OPEN") : "ORPHAN_GALLERY_ITEM", action_authorization_allowed: verification.ok, binding_verification: verification };
}
