import crypto from "node:crypto";
import {
  CAUSAL_CANONICAL_VERSION,
  causalDigest,
  CausalContinuityError,
  opaqueNonce,
  requireDigest,
  requireText,
  requireUuid,
  sortedUnique,
} from "./causalContinuityCanonical.js";
import {
  RELEASE_TUPLE_LOOKUP_VERSION,
  isServerOwnedReleaseTupleResolver,
  normalizeReleaseTupleLookup,
  verifyPersistedReleaseTuple,
} from "./causalIdentityReleaseResolution.js";

const INTENT_CLASSIFICATIONS = new Set(["REFINEMENT", "SCOPE_CHANGE", "STRATEGIC_PIVOT", "PURPOSE_CHANGE", "ROLLBACK", "TERMINATION"]);
const ASSURANCE = Object.freeze({ "CAL-0": 0, "CAL-1": 1, "CAL-2": 2, "CAL-3": 3, "CAL-4": 4 });
const REOPENABLE = new Set(["VERIFIED_PROVISIONAL", "VERIFIED_FINAL", "CLOSED"]);
const INDEPENDENCE = Object.freeze({ EXECUTOR: 0, INDEPENDENT_SYSTEM: 1, INDEPENDENT_HUMAN: 2, FORMAL: 3 });
const ROLLOUT_MODES = new Set(["SHADOW", "ENFORCE_NEW_WORK", "ENFORCE_ALL_COMPATIBLE"]);
const ROLLOUT_TRANSITIONS = Object.freeze({
  SHADOW: new Set(["ENFORCE_NEW_WORK"]),
  ENFORCE_NEW_WORK: new Set(["SHADOW", "ENFORCE_ALL_COMPATIBLE"]),
  ENFORCE_ALL_COMPATIBLE: new Set(["SHADOW", "ENFORCE_NEW_WORK"]),
});
const GALLERY_ENTITY_TYPES = new Set(["PROJECT_GENESIS", "INTENT_REVISION", "ARCHITECTURE_DECISION", "WORK", "CHANGE", "BLOCKER", "CONFLICT", "EVIDENCE", "VERIFICATION", "REMEDIATION", "ROLLBACK", "OUTCOME", "CLOSURE", "REOPENING"]);
const GALLERY_VIEWS = new Set(["project_timeline", "intent_evolution", "decision_history", "work_graph", "change_timeline", "evidence", "closure", "resume"]);
const PRESENCE_RECOVERY_AUTHORITY = "agent:presence:recover";
const PRESENCE_RECOVERY_MAX_TTL_MS = 10 * 60 * 1_000;
const PRESENCE_RECOVERY_CONSTRAINTS = Object.freeze([
  "presence_only", "no_host_action", "no_publish", "no_deploy",
]);
const CHANGE_TRANSITIONS = Object.freeze({
  DRAFT: new Set(["MODELED"]), MODELED: new Set(["AUTHORIZED"]), AUTHORIZED: new Set(["EXECUTED"]),
  EXECUTED: new Set(["OBSERVING"]), OBSERVING: new Set(["VERIFIED_PROVISIONAL", "PARTIAL", "CONTRADICTED", "HARMFUL", "UNKNOWN"]),
  VERIFIED_PROVISIONAL: new Set(["VERIFIED_FINAL", "CONTRADICTED", "REMEDIATING"]),
  PARTIAL: new Set(["OBSERVING", "REMEDIATING"]), CONTRADICTED: new Set(["REMEDIATING"]), HARMFUL: new Set(["REMEDIATING", "ROLLED_BACK"]),
  UNKNOWN: new Set(["OBSERVING", "ESCALATED"]), REMEDIATING: new Set(["EXECUTED", "ROLLED_BACK"]), VERIFIED_FINAL: new Set(["CONTRADICTED"]),
});
const OBLIGATION_TRANSITIONS = Object.freeze({
  DRAFT: new Set(["MODELED"]), MODELED: new Set(["AUTHORIZED"]), AUTHORIZED: new Set(["EXECUTED"]),
  EXECUTED: new Set(["OBSERVING"]), OBSERVING: new Set(["VERIFIED_PROVISIONAL", "PARTIAL", "CONTRADICTED", "HARMFUL", "UNKNOWN"]),
  VERIFIED_PROVISIONAL: new Set(["VERIFIED_FINAL", "CONTRADICTED", "REMEDIATING"]), VERIFIED_FINAL: new Set(["CONTRADICTED"]),
  CLOSED: new Set(["CONTRADICTED"]),
  PARTIAL: new Set(["OBSERVING", "REMEDIATING"]), CONTRADICTED: new Set(["REMEDIATING"]), HARMFUL: new Set(["REMEDIATING", "ROLLED_BACK"]),
  UNKNOWN: new Set(["OBSERVING", "ESCALATED"]), REMEDIATING: new Set(["EXECUTED", "ROLLED_BACK"]), ROLLED_BACK: new Set(["REMEDIATING"]),
});

function stableUuid(...parts) {
  const bytes = crypto.createHash("sha256").update(parts.join("\u0000")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function tenantContext(context) {
  const tenant_id = requireText(context?.tenant_id, "tenant_id", 120);
  return {
    tenant_id,
    actor_id: requireText(context?.actor_id || "authenticated-core-actor", "actor_id", 160),
    actor_role: requireText(context?.actor_role || "core_actor", "actor_role", 120),
    authority_scope: Array.isArray(context?.authority_scope) ? sortedUnique(context.authority_scope, "authority_scope", { maxItems: 100 }) : [],
    owner_confirmed: context?.owner_confirmed === true,
    provenance: context?.provenance && typeof context.provenance === "object" ? context.provenance : {},
  };
}

function mutationInput(context, input, operation) {
  const actor = tenantContext(context);
  return {
    ...input,
    tenant_id: actor.tenant_id,
    actor_provenance: { ...actor.provenance, actor_id: actor.actor_id, actor_role: actor.actor_role },
    idempotency_key: requireText(input?.idempotency_key, "idempotency_key", 240),
    operation,
  };
}

function iso(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new CausalContinuityError(`${name.toUpperCase()}_INVALID`);
  return date.toISOString();
}

function stripEvent(value) {
  if (!value || typeof value !== "object") return value;
  const { _event, ...rest } = value;
  return rest;
}

function isSubset(child = [], parent = []) {
  const allowed = new Set(parent);
  return child.every((item) => allowed.has(item));
}

function riskNarrows(child = {}, parent = {}) {
  for (const [key, parentValue] of Object.entries(parent)) {
    const childValue = child[key];
    if (typeof parentValue === "number" && (typeof childValue !== "number" || childValue > parentValue)) return false;
  }
  return true;
}

function observationDigestPayload(observation) {
  return {
    schema_version: "reality_observation_v1", tenant_id: observation.tenant_id,
    observation_id: observation.observation_id, project_id: observation.project_id,
    intent_revision_id: observation.intent_revision_id, work_id: observation.work_id,
    change_id: observation.change_id, obligation_id: observation.obligation_id,
    source: observation.source, observer_identity: observation.observer_identity,
    observer_role: observation.observer_role, provenance: observation.provenance,
    independence: observation.independence, baseline: observation.baseline,
    freshness_seconds: Number(observation.freshness_seconds), observed_at: iso(observation.observed_at, "observed_at"),
    evidence_digest: observation.evidence_digest, causal_relation: observation.causal_relation,
    confidence: Number(observation.confidence), contradiction_status: observation.contradiction_status,
  };
}

export function createCausalContinuityRuntime({ store, now = () => new Date(), contextSigner, verifyActionLease, resolveReleaseTuple } = {}) {
  if (!store) throw new CausalContinuityError("CAUSAL_STORE_REQUIRED");

  async function validateDelegation(actor, envelope) {
    const delegation = envelope.delegated_from;
    if (!delegation || typeof delegation !== "object") throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    const parentDigest = requireDigest(delegation.parent_context_digest, "parent_context_digest");
    const delegatedActor = requireText(delegation.delegated_actor_id, "delegated_actor_id", 160);
    if (delegatedActor !== actor.actor_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    const parentRow = await store.readContext({ tenant_id: actor.tenant_id, context_digest: parentDigest });
    const parent = parentRow.envelope;
    if (!parent || parent.tenant_id !== envelope.tenant_id || parent.project_id !== envelope.project_id ||
        parent.work_id !== envelope.work_id || parent.change_id !== envelope.change_id ||
        parent.genesis_intent_id !== envelope.genesis_intent_id || parent.intent_revision_id !== envelope.intent_revision_id) {
      throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    }
    if (!isSubset(envelope.authority_scope, parent.authority_scope) ||
        !isSubset(envelope.obligation_ids, parent.obligation_ids) ||
        new Date(envelope.expires_at).getTime() > new Date(parent.expires_at).getTime() ||
        !riskNarrows(envelope.risk_budget, parent.risk_budget)) {
      throw new CausalContinuityError("AUTHORITY_SCOPE_VIOLATION");
    }
    const parentConstraints = parent.inherited_constraints || [];
    if (!parentConstraints.every((constraint) => (envelope.inherited_constraints || []).includes(constraint))) {
      throw new CausalContinuityError("AUTHORITY_SCOPE_VIOLATION");
    }
    return parentRow;
  }

  async function project_identity_create(context, input = {}) {
    const prepared = mutationInput(context, input, "project_identity_create");
    const project_id = stableUuid(prepared.tenant_id, prepared.operation, prepared.idempotency_key);
    let derivedFromProjectId = null;
    let purposeChangeRevisionId = null;
    if (input.derived_from_project_id) {
      const actor = tenantContext(context);
      if (!actor.owner_confirmed && !actor.authority_scope.includes("intent:approve:strategic")) {
        throw new CausalContinuityError("OWNER_AUTHORITY_REQUIRED");
      }
      derivedFromProjectId = requireUuid(input.derived_from_project_id, "derived_from_project_id");
      purposeChangeRevisionId = requireUuid(input.purpose_change_revision_id, "purpose_change_revision_id");
      const purposeChange = await store.readRevision({
        tenant_id: prepared.tenant_id,
        project_id: derivedFromProjectId,
        intent_revision_id: purposeChangeRevisionId,
      });
      if (purposeChange.classification !== "PURPOSE_CHANGE" || purposeChange.state !== "PROPOSED") {
        throw new CausalContinuityError("NEW_PROJECT_REQUIRED");
      }
    } else if (input.purpose_change_revision_id) {
      throw new CausalContinuityError("DERIVED_FROM_PROJECT_ID_REQUIRED");
    }
    return store.createProject({
      ...prepared,
      project_id,
      derived_from_project_id: derivedFromProjectId,
      purpose_change_revision_id: purposeChangeRevisionId,
      canonical_name: requireText(input.canonical_name || input.alias, "canonical_name", 500),
      alias: input.alias ? requireText(input.alias, "project_alias", 500) : null,
      provenance: input.provenance || prepared.actor_provenance,
      alias_verified_at: input.alias_verified_at ? iso(input.alias_verified_at, "alias_verified_at") : null,
    });
  }

  async function project_identity_resolve(context, input = {}) {
    const actor = tenantContext(context);
    return store.readProject({
      tenant_id: actor.tenant_id,
      ...(input.project_id ? { project_id: requireUuid(input.project_id, "project_id") } : { alias: requireText(input.alias, "project_alias", 500) }),
    });
  }

  async function project_scope_bind(context, input = {}) {
    const prepared = mutationInput(context, input, "project_scope_bind");
    const project_id = requireUuid(input.project_id, "project_id");
    const resource_id = stableUuid(prepared.tenant_id, project_id, prepared.operation, prepared.idempotency_key);
    return store.bindScope({
      ...prepared, project_id, resource_id,
      resource_type: requireText(input.resource_type, "resource_type", 120),
      canonical_identifier: requireText(input.canonical_identifier, "canonical_identifier", 1_000),
      environment: requireText(input.environment, "environment", 80),
      ownership: input.ownership || {}, active: input.active !== false,
      provenance: input.provenance || prepared.actor_provenance,
      resource_digest: input.resource_digest ? requireDigest(input.resource_digest, "resource_digest") : null,
      last_verified_at: input.last_verified_at ? iso(input.last_verified_at, "last_verified_at") : null,
    });
  }

  async function project_scope_read(context, input = {}) {
    const actor = tenantContext(context);
    return store.readScope({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id"), active_only: input.active_only !== false, limit: input.limit });
  }

  async function project_state_snapshot(context, input = {}) {
    const prepared = mutationInput(context, input, "project_state_snapshot");
    const project_id = requireUuid(input.project_id, "project_id");
    const resources = (await store.readScope({ tenant_id: prepared.tenant_id, project_id, active_only: true, limit: 500 }))
      .map((resource) => ({
        resource_type: resource.resource_type,
        canonical_identifier: resource.canonical_identifier,
        environment: resource.environment,
        ownership: resource.ownership,
        active: resource.active,
        resource_digest: resource.resource_digest || null,
        provenance: resource.provenance,
      }))
      .sort((a, b) => `${a.resource_type}\u0000${a.canonical_identifier}\u0000${a.environment}`.localeCompare(`${b.resource_type}\u0000${b.canonical_identifier}\u0000${b.environment}`));
    const canonical_state = { schema_version: "project_state_v1", canonicalization_version: CAUSAL_CANONICAL_VERSION, project_id, resources };
    const state_digest = causalDigest(canonical_state);
    return store.saveState({
      ...prepared, project_id,
      snapshot_id: stableUuid(prepared.tenant_id, project_id, prepared.operation, prepared.idempotency_key),
      canonicalization_version: CAUSAL_CANONICAL_VERSION, canonical_state, state_digest,
      base_state_digest: input.base_state_digest ? requireDigest(input.base_state_digest, "base_state_digest") : null,
      observed_at: input.observed_at ? iso(input.observed_at, "observed_at") : now().toISOString(),
    });
  }

  async function project_state_verify(context, input = {}) {
    const actor = tenantContext(context);
    const project_id = requireUuid(input.project_id, "project_id");
    const expected = requireDigest(input.project_state_digest, "project_state_digest");
    const current = await store.currentState({ tenant_id: actor.tenant_id, project_id });
    if (!current || current.state_digest !== expected) {
      throw new CausalContinuityError("STALE_PROJECT_STATE", "Project state digest is not current", { current_state_digest: current?.state_digest || null });
    }
    return { verified: true, project_id, project_state_digest: expected, ledger_sequence: Number(current.ledger_sequence || current._event?.sequence_number || 0) };
  }

  async function genesis_intent_create(context, input = {}) {
    const prepared = mutationInput(context, input, "genesis_intent_create");
    const project_id = requireUuid(input.project_id, "project_id");
    const intent_text = requireText(input.intent_text, "intent_text", 20_000);
    const genesis_intent_id = stableUuid(prepared.tenant_id, project_id, prepared.operation, prepared.idempotency_key);
    return store.createGenesis({ ...prepared, project_id, genesis_intent_id, intent_text, author_id: prepared.actor_provenance.actor_id, canonical_digest: causalDigest({ project_id, intent_text }) });
  }

  async function genesis_intent_read(context, input = {}) {
    const actor = tenantContext(context);
    return store.readGenesis({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id") });
  }

  async function intent_revision_propose(context, input = {}) {
    const prepared = mutationInput(context, input, "intent_revision_propose");
    const project_id = requireUuid(input.project_id, "project_id");
    const genesis = await store.readGenesis({ tenant_id: prepared.tenant_id, project_id });
    const classification = requireText(input.classification, "classification", 40).toUpperCase();
    if (!INTENT_CLASSIFICATIONS.has(classification)) throw new CausalContinuityError("INTENT_CLASSIFICATION_INVALID");
    const parent_revision_id = input.parent_revision_id ? requireUuid(input.parent_revision_id, "parent_revision_id") : null;
    const intent_revision_id = stableUuid(prepared.tenant_id, project_id, prepared.operation, prepared.idempotency_key);
    if (parent_revision_id) {
      const revisions = await store.listRevisions({ tenant_id: prepared.tenant_id, project_id, limit: 200 });
      const byId = new Map(revisions.map((revision) => [revision.intent_revision_id, revision]));
      const parent = byId.get(parent_revision_id);
      if (!parent || parent.project_id !== project_id || parent.state !== "APPROVED") throw new CausalContinuityError("INTENT_PARENT_INVALID");
      if (parent_revision_id === intent_revision_id) throw new CausalContinuityError("INTENT_REVISION_CYCLE");
      const visited = new Set([intent_revision_id]);
      let cursor = parent;
      while (cursor) {
        if (visited.has(cursor.intent_revision_id)) throw new CausalContinuityError("INTENT_REVISION_CYCLE");
        visited.add(cursor.intent_revision_id);
        if (!cursor.parent_revision_id) break;
        cursor = byId.get(cursor.parent_revision_id);
        if (!cursor) throw new CausalContinuityError("INTENT_PARENT_INVALID");
      }
    }
    const revision_payload = {
      motivation: requireText(input.motivation, "motivation", 8_000),
      problem: requireText(input.problem, "problem", 8_000),
      alternatives_considered: Array.isArray(input.alternatives_considered) ? input.alternatives_considered : [],
      chosen_alternative: input.chosen_alternative || null,
      rejected_alternatives: Array.isArray(input.rejected_alternatives) ? input.rejected_alternatives : [],
      scope_added: input.scope_added || [], scope_removed: input.scope_removed || [], invariants: input.invariants || [],
      risks: input.risks || [], affected_work_ids: input.affected_work_ids || [], obligations_maintained: input.obligations_maintained || [],
      obligations_replaced: input.obligations_replaced || [], authorization: input.authorization || null,
    };
    return store.proposeRevision({
      ...prepared, project_id, genesis_intent_id: genesis.genesis_intent_id, parent_revision_id,
      intent_revision_id, alias: requireText(input.alias, "intent_revision_alias", 240), classification,
      revision_payload, author_id: prepared.actor_provenance.actor_id,
      canonical_digest: causalDigest({ project_id, genesis_intent_id: genesis.genesis_intent_id, parent_revision_id, alias: input.alias, classification, revision_payload }),
    });
  }

  async function intent_revision_approve(context, input = {}) {
    const actor = tenantContext(context);
    const prepared = mutationInput(context, input, "intent_revision_approve");
    const intent_revision_id = requireUuid(input.intent_revision_id, "intent_revision_id");
    const revisions = await store.listRevisions({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id"), limit: 200 });
    const revision = revisions.find((item) => item.intent_revision_id === intent_revision_id);
    if (!revision) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
    if (revision.classification === "STRATEGIC_PIVOT" && !actor.owner_confirmed && !actor.authority_scope.includes("intent:approve:strategic")) {
      throw new CausalContinuityError("OWNER_AUTHORITY_REQUIRED");
    }
    return store.approveRevision({ ...prepared, project_id: revision.project_id, intent_revision_id, approved: input.approved !== false, authorized_by: actor.actor_id });
  }

  async function intent_revision_impact(context, input = {}) {
    const actor = tenantContext(context);
    const revisions = await store.listRevisions({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id"), limit: 200 });
    const revision = revisions.find((item) => item.intent_revision_id === input.intent_revision_id);
    if (!revision) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
    const classification = revision.classification;
    return {
      project_id: revision.project_id, intent_revision_id: revision.intent_revision_id,
      impact: classification === "REFINEMENT" ? "COMPATIBLE" : classification === "SCOPE_CHANGE" ? "REBASE_REQUIRED" : classification === "PURPOSE_CHANGE" ? "NEW_PROJECT_REQUIRED" : "OWNER_REVIEW_REQUIRED",
    };
  }

  async function project_decision_path_read(context, input = {}) {
    const actor = tenantContext(context);
    const project_id = requireUuid(input.project_id, "project_id");
    return {
      project: await store.readProject({ tenant_id: actor.tenant_id, project_id }),
      genesis_intent: await store.readGenesis({ tenant_id: actor.tenant_id, project_id }),
      intent_revisions: await store.listRevisions({ tenant_id: actor.tenant_id, project_id, limit: input.limit }),
    };
  }

  async function project_identity_spine_read(context, input = {}) {
    const actor = tenantContext(context);
    const project_id = requireUuid(input.project_id, "project_id");
    const project = await store.readProject({ tenant_id: actor.tenant_id, project_id });
    const genesis = await store.readGenesis({ tenant_id: actor.tenant_id, project_id });
    const requestedLimit = Math.min(Number(input.limit) || 200, 200);
    const revisions = await store.listRevisions({ tenant_id: actor.tenant_id, project_id, limit: requestedLimit });
    const currentState = await store.currentState({ tenant_id: actor.tenant_id, project_id });
    const ordered = revisions.map(stripEvent).sort((left, right) =>
      `${left.created_at || ""}\0${left.intent_revision_id}`.localeCompare(`${right.created_at || ""}\0${right.intent_revision_id}`));
    const active = project.active_intent_revision_id
      ? stripEvent(await store.readRevision({
          tenant_id: actor.tenant_id,
          project_id,
          intent_revision_id: project.active_intent_revision_id,
        }))
      : null;
    if (project.active_intent_revision_id && (!active || active.state !== "APPROVED")) {
      throw new CausalContinuityError("INTENT_LINEAGE_INTEGRITY_MISMATCH");
    }
    const spine = {
      schema_version: "project_identity_spine_v1",
      tenant_id: actor.tenant_id,
      project: stripEvent(project),
      project_state_digest: currentState?.state_digest || null,
      project_state_event_sequence: Number(currentState?.ledger_sequence || 0) || null,
      genesis_intent: stripEvent(genesis),
      active_intent_revision: active,
      intent_revisions: ordered,
      intent_revision_page_limit: requestedLimit,
      intent_revision_history_may_continue: ordered.length === requestedLimit,
    };
    return { ...spine, spine_digest: causalDigest(spine) };
  }

  async function release_tuple_resolve(context, input = {}) {
    if (!isServerOwnedReleaseTupleResolver(resolveReleaseTuple)) {
      throw new CausalContinuityError("RELEASE_RESOLVER_UNAVAILABLE");
    }
    const prepared = mutationInput(context, input, "release_tuple_resolve");
    const project_id = requireUuid(input.project_id, "project_id");
    const work_id = requireUuid(input.work_id, "work_id");
    const change_id = requireUuid(input.change_id, "change_id");
    const projectStateDigest = requireDigest(input.project_state_digest, "project_state_digest");
    await project_state_verify(context, { project_id, project_state_digest: projectStateDigest });
    const project = await store.readProject({ tenant_id: prepared.tenant_id, project_id });
    const genesis = await store.readGenesis({ tenant_id: prepared.tenant_id, project_id });
    const work = await store.readWork({ tenant_id: prepared.tenant_id, work_id });
    const change = await store.readChange({ tenant_id: prepared.tenant_id, change_id });
    if (work.project_id !== project_id || change.project_id !== project_id || change.work_id !== work_id ||
        work.genesis_intent_id !== genesis.genesis_intent_id ||
        work.intent_revision_id !== project.active_intent_revision_id) {
      throw new CausalContinuityError("RELEASE_CAUSAL_BINDING_MISMATCH");
    }
    const lookup = normalizeReleaseTupleLookup({
      schema_version: RELEASE_TUPLE_LOOKUP_VERSION,
      tenant_id: prepared.tenant_id,
      project_id,
      project_state_digest: projectStateDigest,
      genesis_intent_id: genesis.genesis_intent_id,
      intent_revision_id: work.intent_revision_id,
      work_id,
      change_id,
      pull_request: input.pull_request,
    });
    const resolved = await resolveReleaseTuple(lookup);
    const resolution_id = stableUuid(prepared.tenant_id, project_id, work_id, change_id, resolved.phase, causalDigest(lookup));
    const provenance = {
      schema_version: "server_owned_release_resolution_provenance_v1",
      authority: "universal_core",
      actor_id: prepared.actor_provenance.actor_id,
      lookup_digest: causalDigest(lookup),
      observation_evidence_digests: Object.values(resolved.observations).map((item) => item.evidence_digest).sort(),
    };
    return store.saveReleaseTupleResolution({
      ...prepared,
      project_id,
      resolution_id,
      project_state_digest: projectStateDigest,
      genesis_intent_id: genesis.genesis_intent_id,
      intent_revision_id: work.intent_revision_id,
      work_id,
      change_id,
      phase: resolved.phase,
      pull_request: lookup.pull_request,
      lookup_key: lookup,
      lookup_digest: causalDigest(lookup),
      release_tuple: resolved,
      release_tuple_digest: resolved.release_tuple_digest,
      provenance,
      provenance_digest: causalDigest(provenance),
      observed_at: resolved.observed_at,
      expires_at: resolved.expires_at,
      request: { lookup, idempotency_key: prepared.idempotency_key },
    });
  }

  async function release_tuple_read(context, input = {}) {
    const actor = tenantContext(context);
    const project_id = requireUuid(input.project_id, "project_id");
    const row = await store.readReleaseTupleResolution({
      tenant_id: actor.tenant_id,
      project_id,
      work_id: requireUuid(input.work_id, "work_id"),
      change_id: requireUuid(input.change_id, "change_id"),
      phase: input.phase ? requireText(input.phase, "release_phase", 40).toUpperCase() : null,
    });
    await project_state_verify(context, { project_id, project_state_digest: row.project_state_digest });
    const verified = verifyPersistedReleaseTuple(row, now);
    if (verified.tenant_id !== actor.tenant_id || verified.project_id !== project_id) {
      throw new CausalContinuityError("RELEASE_CAUSAL_BINDING_MISMATCH");
    }
    return { ...row, release_tuple: verified };
  }

  async function work_bind_intent(context, input = {}) {
    const prepared = mutationInput(context, input, "work_bind_intent");
    const project_id = requireUuid(input.project_id, "project_id");
    const work_id = requireUuid(input.work_id, "work_id");
    const genesis = await store.readGenesis({ tenant_id: prepared.tenant_id, project_id });
    const revisions = await store.listRevisions({ tenant_id: prepared.tenant_id, project_id, limit: 200 });
    const revision = revisions.find((item) => item.intent_revision_id === input.intent_revision_id && item.state === "APPROVED");
    if (!revision) throw new CausalContinuityError("INTENT_REVISION_REQUIRED");
    const legacy_binding_state = requireText(input.legacy_binding_state || "VERIFIED", "legacy_binding_state", 40).toUpperCase();
    if (!["VERIFIED", "UNRESOLVED_LEGACY_BINDING"].includes(legacy_binding_state)) throw new CausalContinuityError("LEGACY_BINDING_STATE_INVALID");
    let base_state_digest = null;
    if (legacy_binding_state === "VERIFIED") {
      base_state_digest = requireDigest(input.base_state_digest, "base_state_digest");
      await project_state_verify(context, { project_id, project_state_digest: base_state_digest });
    } else if (!input.provenance?.ambiguity_reason) {
      throw new CausalContinuityError("UNRESOLVED_LEGACY_BINDING", "Ambiguous legacy binding requires explicit provenance and remains non-authoritative");
    }
    return store.bindWork({
      ...prepared, project_id, work_id, genesis_intent_id: genesis.genesis_intent_id,
      intent_revision_id: revision.intent_revision_id,
      base_state_digest, legacy_binding_state, provenance: input.provenance || prepared.actor_provenance,
    });
  }

  async function change_create(context, input = {}) {
    const prepared = mutationInput(context, input, "change_create");
    const project_id = requireUuid(input.project_id, "project_id");
    const work_id = requireUuid(input.work_id, "work_id");
    const work = await store.readWork({ tenant_id: prepared.tenant_id, work_id });
    if (work.project_id !== project_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    if (work.legacy_binding_state !== "VERIFIED") throw new CausalContinuityError("UNRESOLVED_LEGACY_BINDING");
    const base_state_digest = requireDigest(input.base_state_digest, "base_state_digest");
    await project_state_verify(context, { project_id, project_state_digest: base_state_digest });
    const change_id = stableUuid(prepared.tenant_id, project_id, prepared.operation, prepared.idempotency_key);
    return store.createChange({
      ...prepared, project_id, work_id, change_id, intent_revision_id: work.intent_revision_id,
      parent_change_id: input.parent_change_id ? requireUuid(input.parent_change_id, "parent_change_id") : null,
      alias: input.alias || null, reason: requireText(input.reason, "reason", 8_000), scope: input.scope || {},
      expected_effects: input.expected_effects || [], forbidden_effects: input.forbidden_effects || [], base_state_digest,
      expected_target_state: input.expected_target_state || {},
    });
  }

  async function change_read(context, input = {}) {
    const actor = tenantContext(context);
    return store.readChange({ tenant_id: actor.tenant_id, change_id: requireUuid(input.change_id, "change_id") });
  }

  async function change_transition(context, input = {}) {
    const prepared = mutationInput(context, input, "change_transition");
    const actor = tenantContext(context);
    const change = await store.readChange({ tenant_id: prepared.tenant_id, change_id: requireUuid(input.change_id, "change_id") });
    const target_state = requireText(input.target_state, "target_state", 40).toUpperCase();
    if (!CHANGE_TRANSITIONS[change.state]?.has(target_state)) throw new CausalContinuityError("CHANGE_STATE_INVALID");
    if (!["MODELED", "REMEDIATING", "EXECUTED"].includes(target_state)) throw new CausalContinuityError("TRANSITION_ORIGIN_REQUIRED");
    if (target_state === "EXECUTED" && !actor.authority_scope.includes("causal:change:execute") && !actor.authority_scope.includes("core:govern")) {
      throw new CausalContinuityError("AUTHORITY_SCOPE_VIOLATION");
    }
    const event_type = target_state === "EXECUTED" ? "CHANGE_EXECUTED" : `CHANGE_${target_state}`;
    return store.transitionChange({ ...prepared, project_id: change.project_id, change_id: change.change_id,
      expected_state: change.state, target_state, event_type,
      transition_id: stableUuid(prepared.tenant_id, change.change_id, change.state, target_state, prepared.idempotency_key),
      reason: requireText(input.reason, "reason", 2_000),
      lease_id: target_state === "EXECUTED" ? requireText(input.lease_id, "lease_id", 240) : null,
      context_digest: target_state === "EXECUTED" ? requireDigest(input.context_digest, "context_digest") : null,
      execution_evidence_digest: target_state === "EXECUTED" ? requireDigest(input.execution_evidence_digest, "execution_evidence_digest") : null });
  }

  async function causal_obligation_create(context, input = {}) {
    const prepared = mutationInput(context, input, "causal_obligation_create");
    const change = await store.readChange({ tenant_id: prepared.tenant_id, change_id: requireUuid(input.change_id, "change_id") });
    const assurance_level = requireText(input.assurance_level || "CAL-1", "assurance_level", 8).toUpperCase();
    if (!(assurance_level in ASSURANCE)) throw new CausalContinuityError("ASSURANCE_LEVEL_INVALID");
    const obligation_id = stableUuid(prepared.tenant_id, change.project_id, prepared.operation, prepared.idempotency_key);
    const evidence_contract_id = stableUuid(prepared.tenant_id, obligation_id, "evidence-contract");
    const rawHorizons = input.evidence_contract?.horizons || input.verification_horizons || [];
    const temporal_checks = rawHorizons.map((item, index) => {
      const horizon = typeof item === "string" ? item : requireText(item?.horizon || item?.name, "verification_horizon", 160);
      const due_at = typeof item === "string" ? now().toISOString() : iso(item.due_at, "verification_due_at");
      return {
        temporal_check_id: stableUuid(prepared.tenant_id, obligation_id, "temporal-check", String(index), horizon),
        horizon: requireText(horizon, "verification_horizon", 160), due_at,
      };
    });
    const minimumIndependentObservers = Number(input.evidence_contract?.minimum_independent_observers ?? 1);
    if (!Number.isInteger(minimumIndependentObservers) || minimumIndependentObservers < 0 || minimumIndependentObservers > 32) throw new CausalContinuityError("EVIDENCE_CONTRACT_INVALID");
    const evidence = {
      evidence_contract_id,
      required_sources: sortedUnique(input.evidence_contract?.required_sources || [], "required_sources", { maxItems: 50, maxLength: 240 }),
      minimum_independence: requireText(input.evidence_contract?.minimum_independence || "INDEPENDENT_SYSTEM", "minimum_independence", 80),
      minimum_independent_observers: minimumIndependentObservers,
      freshness_seconds: Math.max(0, Number(input.evidence_contract?.freshness_seconds || 0)),
      minimum_assurance_level: requireText(input.evidence_contract?.minimum_assurance_level || assurance_level, "minimum_assurance_level", 8).toUpperCase(),
      horizons: temporal_checks.map(({ horizon, due_at }) => ({ horizon, due_at })), falsification_conditions: input.evidence_contract?.falsification_conditions || [],
      forbidden_effect_observers: input.evidence_contract?.forbidden_effect_observers || [],
    };
    if (!(evidence.minimum_assurance_level in ASSURANCE)) throw new CausalContinuityError("ASSURANCE_LEVEL_INVALID");
    evidence.contract_digest = causalDigest(evidence);
    const obligation = {
      ...prepared, obligation_id, project_id: change.project_id, intent_revision_id: change.intent_revision_id,
      work_id: change.work_id, change_id: change.change_id, claim: requireText(input.claim, "claim", 10_000),
      owner_id: requireText(input.owner_id || prepared.actor_provenance.actor_id, "owner_id", 160),
      delegated_owners: input.delegated_owners || [], expected_effects: input.expected_effects || change.expected_effects || [],
      forbidden_effects: input.forbidden_effects || change.forbidden_effects || [], assurance_level,
      verification_horizons: input.verification_horizons || [], rollback_plan: input.rollback_plan || {},
      residual_obligations: input.residual_obligations || [], next_verification_at: input.next_verification_at ? iso(input.next_verification_at, "next_verification_at") : null,
      evidence_contract: evidence, temporal_checks,
    };
    obligation.obligation_digest = causalDigest(stripEvent(obligation));
    return store.createObligation(obligation);
  }

  async function causal_obligation_read(context, input = {}) {
    const actor = tenantContext(context);
    return store.readObligation({ tenant_id: actor.tenant_id, obligation_id: requireUuid(input.obligation_id, "obligation_id") });
  }

  async function causal_obligation_transition(context, input = {}) {
    const prepared = mutationInput(context, input, "causal_obligation_transition");
    const actor = tenantContext(context);
    const obligation = await store.readObligation({ tenant_id: prepared.tenant_id, obligation_id: requireUuid(input.obligation_id, "obligation_id") });
    const target_state = requireText(input.target_state, "target_state", 40).toUpperCase();
    if (!OBLIGATION_TRANSITIONS[obligation.state]?.has(target_state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
    if (!["MODELED", "REMEDIATING", "ESCALATED", "EXECUTED"].includes(target_state)) throw new CausalContinuityError("TRANSITION_ORIGIN_REQUIRED");
    if (target_state === "EXECUTED" && !actor.authority_scope.includes("causal:obligation:execute") && !actor.authority_scope.includes("causal:change:execute") && !actor.authority_scope.includes("core:govern")) {
      throw new CausalContinuityError("AUTHORITY_SCOPE_VIOLATION");
    }
    const event_type = target_state === "EXECUTED" ? "ACTION_EXECUTED" : `OBLIGATION_${target_state}`;
    return store.transitionObligation({ ...prepared, project_id: obligation.project_id, obligation_id: obligation.obligation_id,
      expected_state: obligation.state, target_state, event_type,
      transition_id: stableUuid(prepared.tenant_id, obligation.obligation_id, obligation.state, target_state, prepared.idempotency_key),
      reason: requireText(input.reason, "reason", 2_000),
      lease_id: target_state === "EXECUTED" ? requireText(input.lease_id, "lease_id", 240) : null,
      context_digest: target_state === "EXECUTED" ? requireDigest(input.context_digest, "context_digest") : null,
      execution_evidence_digest: target_state === "EXECUTED" ? requireDigest(input.execution_evidence_digest, "execution_evidence_digest") : null });
  }

  async function causal_context_issue(context, input = {}) {
    if (!contextSigner || typeof contextSigner.sign !== "function") throw new CausalContinuityError("CAUSAL_SIGNER_UNAVAILABLE");
    const prepared = mutationInput(context, input, "causal_context_issue");
    const actor = tenantContext(context);
    const project_id = requireUuid(input.project_id, "project_id");
    const work = await store.readWork({ tenant_id: prepared.tenant_id, work_id: requireUuid(input.work_id, "work_id") });
    const change = await store.readChange({ tenant_id: prepared.tenant_id, change_id: requireUuid(input.change_id, "change_id") });
    if (work.project_id !== project_id || change.project_id !== project_id || change.work_id !== work.work_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    // AUTHORIZED is accepted here only so the authoritative store can identify
    // an already-bound lease as a replay. A new lease still fails its locked
    // MODELED -> AUTHORIZED transition in bindActionLease.
    if (!["MODELED", "AUTHORIZED"].includes(change.state)) throw new CausalContinuityError("CHANGE_STATE_INVALID");
    const obligation_ids = sortedUnique(input.obligation_ids || [], "obligation_ids", { maxItems: 64, maxLength: 36 }).map((id) => requireUuid(id, "obligation_id"));
    if (!obligation_ids.length) throw new CausalContinuityError("OBLIGATION_REQUIRED");
    const obligationRows = [];
    for (const obligation_id of obligation_ids) {
      const obligation = await store.readObligation({ tenant_id: prepared.tenant_id, obligation_id });
      if (obligation.project_id !== project_id || obligation.work_id !== work.work_id || obligation.change_id !== change.change_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
      if (!["MODELED", "AUTHORIZED"].includes(obligation.state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
      obligationRows.push(obligation);
    }
    const requestedAuthority = sortedUnique(input.authority_scope || actor.authority_scope, "authority_scope", { maxItems: 100, maxLength: 240 });
    const presenceRecovery = requestedAuthority.length === 1 && requestedAuthority[0] === PRESENCE_RECOVERY_AUTHORITY;
    if (!isSubset(requestedAuthority, actor.authority_scope) &&
        !(presenceRecovery && actor.authority_scope.includes("core:govern"))) {
      throw new CausalContinuityError("AUTHORITY_SCOPE_VIOLATION");
    }
    const inheritedConstraints = sortedUnique(input.inherited_constraints || [], "inherited_constraints", { maxItems: 100, maxLength: 240 });
    if (presenceRecovery) {
      const constraints = new Set(inheritedConstraints);
      if (PRESENCE_RECOVERY_CONSTRAINTS.some((constraint) => !constraints.has(constraint)) ||
          (Array.isArray(input.gallery_ticket_ids) && input.gallery_ticket_ids.length > 0)) {
        throw new CausalContinuityError("PRESENCE_RECOVERY_CONTRACT_INVALID");
      }
    }
    const actorSessionFingerprint = requireText(actor.provenance?.session_fingerprint, "actor_session_fingerprint", 64);
    if (typeof verifyActionLease !== "function") throw new CausalContinuityError("LEASE_VERIFIER_UNAVAILABLE");
    const lease_id = requireText(input.lease_id, "lease_id", 240);
    let lease;
    try {
      lease = await verifyActionLease({
        tenant_id: prepared.tenant_id, project_id, work_id: work.work_id, change_id: change.change_id,
        obligation_ids, lease_id, actor_id: actor.actor_id, actor_session_fingerprint: actorSessionFingerprint,
        authority_scope: requestedAuthority,
      });
    } catch {
      throw new CausalContinuityError("LEASE_INVALID");
    }
    if (!lease || typeof lease !== "object") throw new CausalContinuityError("LEASE_INVALID");
    const leaseObligations = Array.isArray(lease.obligation_ids) ? lease.obligation_ids : lease.obligation_id ? [lease.obligation_id] : [];
    const persistedAuthority = Array.isArray(lease.persisted_authority_scope) ? sortedUnique(lease.persisted_authority_scope, "persisted_authority_scope", { maxItems: 100, maxLength: 240 }) : [];
    const leaseSurfaces = Array.isArray(lease.surfaces) ? lease.surfaces.map((surface) => ({ kind: requireText(surface?.kind, "lease_surface_kind", 80), value: requireText(surface?.value, "lease_surface_value", 500) })).sort((a, b) => `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`)) : [];
    const requiredSurfaces = [
      { kind: "causal_project", value: project_id }, { kind: "causal_change", value: change.change_id },
      ...obligation_ids.map((value) => ({ kind: "causal_obligation", value })),
    ];
    const surfaceSet = new Set(leaseSurfaces.map((surface) => `${surface.kind}:${surface.value}`));
    const authorityProof = {
      schema_version: "persisted_lease_authority_v1", tenant_id: prepared.tenant_id, lease_id,
      actor_id: actor.actor_id, purpose: lease.purpose, surfaces: leaseSurfaces, persisted_authority_scope: persistedAuthority,
      policy_session_fingerprint: actorSessionFingerprint,
    };
    let leaseExpiresAt;
    try { leaseExpiresAt = iso(lease.expires_at, "lease_expires_at"); } catch { throw new CausalContinuityError("LEASE_INVALID"); }
    const authorityBindingDigest = typeof lease.authority_binding_digest === "string" && /^[a-f0-9]{64}$/.test(lease.authority_binding_digest)
      ? lease.authority_binding_digest
      : null;
    if (lease.valid !== true || lease.readback_verified !== true || lease.active !== true || lease.replayed === true || lease.consumed === true || lease.revoked === true ||
        lease.tenant_id !== prepared.tenant_id || lease.project_id !== project_id || lease.work_id !== work.work_id || lease.change_id !== change.change_id ||
        lease.lease_id !== lease_id || lease.policy_session_fingerprint !== actorSessionFingerprint || !isSubset(obligation_ids, leaseObligations) ||
        lease.purpose !== "causal_context_issue" || lease.authority_source !== "persisted_lease_policy_v1" ||
        authorityBindingDigest !== causalDigest(authorityProof) ||
        requiredSurfaces.some((surface) => !surfaceSet.has(`${surface.kind}:${surface.value}`)) ||
        !isSubset(requestedAuthority, persistedAuthority) ||
        new Date(leaseExpiresAt).getTime() <= now().getTime()) {
      throw new CausalContinuityError("LEASE_AUTHORITY_UNPROVEN");
    }
    const project_state_digest = requireDigest(input.project_state_digest, "project_state_digest");
    await project_state_verify(context, { project_id, project_state_digest });
    const issued_at = now().toISOString();
    const expires_at = iso(input.expires_at, "expires_at");
    if (new Date(expires_at).getTime() <= new Date(issued_at).getTime() || new Date(expires_at).getTime() > new Date(leaseExpiresAt).getTime() ||
        (presenceRecovery && new Date(expires_at).getTime() - new Date(issued_at).getTime() > PRESENCE_RECOVERY_MAX_TTL_MS)) {
      throw new CausalContinuityError("CONTEXT_EXPIRED");
    }
    await store.bindActionLease({
      ...prepared, project_id, work_id: work.work_id, change_id: change.change_id,
      obligation_id: obligation_ids[0], obligation_ids, lease_id, authority_scope: requestedAuthority,
      lease_purpose: lease.purpose, lease_surfaces: leaseSurfaces, authority_binding_digest: lease.authority_binding_digest,
      verification: lease, verification_digest: causalDigest(lease), verified_at: issued_at, expires_at: leaseExpiresAt,
      change_transition_id: stableUuid(prepared.tenant_id, change.change_id, "MODELED", "AUTHORIZED", lease_id),
      obligation_transition_ids: Object.fromEntries(obligationRows.map((obligation) => [obligation.obligation_id, stableUuid(prepared.tenant_id, obligation.obligation_id, "MODELED", "AUTHORIZED", lease_id)])),
      idempotency_key: `${prepared.idempotency_key}:lease`,
    });
    const timeline = await store.timeline({ tenant_id: prepared.tenant_id, project_id, limit: 1 });
    const event_ledger_sequence = Number(timeline.at(-1)?.sequence_number || 0) + 1;
    const envelope = {
      schema_version: "causal_context_envelope_v1", tenant_id: prepared.tenant_id, project_id,
      project_state_digest, genesis_intent_id: work.genesis_intent_id, intent_revision_id: work.intent_revision_id,
      work_id: work.work_id, change_id: change.change_id, obligation_ids,
      gallery_ticket_ids: sortedUnique(input.gallery_ticket_ids || [], "gallery_ticket_ids", { maxItems: 64, maxLength: 240 }),
      actor_id: actor.actor_id, actor_role: actor.actor_role, actor_provenance_digest: causalDigest(actor.provenance),
      delegated_from: input.delegated_from || null,
      environment: requireText(input.environment, "environment", 80), base_state_digest: change.base_state_digest,
      authority_scope: requestedAuthority,
      risk_budget: input.risk_budget || {}, inherited_constraints: inheritedConstraints,
      issued_at, expires_at, single_use_nonce: opaqueNonce(),
      lease_id, event_ledger_sequence,
    };
    if (envelope.delegated_from) await validateDelegation(actor, envelope);
    envelope.context_digest = causalDigest(envelope);
    const signature = await contextSigner.sign(envelope, { purpose: "causal_context_envelope_v1" });
    if (!signature) throw new CausalContinuityError("CAUSAL_SIGNER_UNAVAILABLE");
    const persistedEnvelope = { ...envelope, single_use_nonce: undefined, single_use_nonce_digest: causalDigest(envelope.single_use_nonce) };
    await store.saveContext({
      ...prepared, context_id: stableUuid(prepared.tenant_id, project_id, prepared.operation, prepared.idempotency_key),
      project_id, work_id: work.work_id, change_id: change.change_id, context_digest: envelope.context_digest,
      envelope: persistedEnvelope, signature, enforcement_mode: input.enforcement_mode || "SHADOW", issued_at, expires_at,
    });
    return { envelope, signature };
  }

  async function causal_context_validate(context, input = {}) {
    const actor = tenantContext(context);
    const envelope = input.envelope;
    if (!envelope || typeof envelope !== "object") throw new CausalContinuityError("CAUSAL_CONTEXT_REQUIRED");
    if (!contextSigner || typeof contextSigner.verify !== "function") throw new CausalContinuityError("CAUSAL_SIGNER_UNAVAILABLE");
    if (envelope.tenant_id !== actor.tenant_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    if (envelope.actor_provenance_digest !== causalDigest(actor.provenance)) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    if (envelope.actor_id !== actor.actor_id) await validateDelegation(actor, envelope);
    const claimed = requireDigest(envelope.context_digest, "context_digest");
    const { context_digest: ignored, ...unsigned } = envelope;
    if (causalDigest(unsigned) !== claimed) throw new CausalContinuityError("CONTEXT_DIGEST_MISMATCH");
    if (!(await contextSigner.verify(envelope, input.signature, { purpose: "causal_context_envelope_v1" }))) throw new CausalContinuityError("CONTEXT_SIGNATURE_INVALID");
    const currentTime = now().getTime();
    if (currentTime < new Date(envelope.issued_at).getTime() || currentTime >= new Date(envelope.expires_at).getTime()) throw new CausalContinuityError("CONTEXT_EXPIRED");
    await store.readContext({ tenant_id: actor.tenant_id, context_digest: claimed });
    if (input.expected_environment && envelope.environment !== input.expected_environment) throw new CausalContinuityError("ENVIRONMENT_MISMATCH");
    if (input.required_authority && !envelope.authority_scope.includes(input.required_authority)) throw new CausalContinuityError("AUTHORITY_SCOPE_VIOLATION");
    if (input.consume === true) {
      await store.consumeContextAtomic({
        tenant_id: actor.tenant_id, project_id: envelope.project_id, project_state_digest: envelope.project_state_digest,
        work_id: envelope.work_id, change_id: envelope.change_id, issuer_id: envelope.actor_id,
        nonce_digest: causalDigest(envelope.single_use_nonce), context_digest: claimed,
        issued_at: envelope.issued_at, expires_at: envelope.expires_at,
        actor_provenance_digest: envelope.actor_provenance_digest, actor_provenance: actor.provenance,
      });
    } else {
      await project_state_verify(context, { project_id: envelope.project_id, project_state_digest: envelope.project_state_digest });
    }
    return { valid: true, consumed: input.consume === true, context_digest: claimed, project_id: envelope.project_id, work_id: envelope.work_id, change_id: envelope.change_id };
  }

  async function causal_observation_record(context, input = {}) {
    const prepared = mutationInput(context, input, "causal_observation_record");
    const actor = tenantContext(context);
    const obligation = await store.readObligation({ tenant_id: prepared.tenant_id, obligation_id: requireUuid(input.obligation_id, "obligation_id") });
    const observed_at = input.observed_at ? iso(input.observed_at, "observed_at") : now().toISOString();
    const contradiction_status = requireText(input.contradiction_status || "NONE", "contradiction_status", 40).toUpperCase();
    if (input.observer_identity && input.observer_identity !== actor.actor_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    const authenticatedIndependence = actor.provenance?.observer_independence ||
      (actor.authority_scope.includes("causal:evidence:formal") ? "FORMAL" :
        actor.authority_scope.includes("causal:evidence:independent") ? "INDEPENDENT_SYSTEM" : "EXECUTOR");
    const observation = {
      ...prepared, observation_id: stableUuid(prepared.tenant_id, obligation.project_id, prepared.operation, prepared.idempotency_key),
      project_id: obligation.project_id, intent_revision_id: obligation.intent_revision_id, work_id: obligation.work_id,
      change_id: obligation.change_id, obligation_id: obligation.obligation_id,
      source: requireText(input.source, "source", 240), observer_identity: actor.actor_id,
      observer_role: actor.actor_role,
      provenance: { observer: prepared.actor_provenance, source: input.source_provenance && typeof input.source_provenance === "object" ? input.source_provenance : {} },
      independence: requireText(authenticatedIndependence, "independence", 80).toUpperCase(), baseline: input.baseline || {},
      freshness_seconds: Math.max(0, Number(input.freshness_seconds || 0)), observed_at,
      evidence_digest: requireDigest(input.evidence_digest, "evidence_digest"), causal_relation: requireText(input.causal_relation || "OBSERVED_AFTER_ACTION", "causal_relation", 120),
      confidence: Number(input.confidence), contradiction_status,
      automatic_reopen: contradiction_status === "CONFIRMED" && REOPENABLE.has(obligation.state),
      transition_id: stableUuid(prepared.tenant_id, obligation.obligation_id, obligation.state,
        contradiction_status === "CONFIRMED" && REOPENABLE.has(obligation.state) ? "CONTRADICTED" : obligation.state === "EXECUTED" ? "OBSERVING" : obligation.state,
        prepared.idempotency_key),
    };
    if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) throw new CausalContinuityError("CONFIDENCE_INVALID");
    observation.observation_digest = causalDigest(observationDigestPayload(observation));
    return store.recordObservation(observation);
  }

  async function causal_reconcile(context, input = {}) {
    const prepared = mutationInput(context, input, "causal_reconcile");
    const obligation = await store.readObligation({ tenant_id: prepared.tenant_id, obligation_id: requireUuid(input.obligation_id, "obligation_id") });
    const observations = await store.listObservations({ tenant_id: prepared.tenant_id, obligation_id: obligation.obligation_id, limit: 200 });
    const digestValid = observations.every((item) => item.observation_digest === causalDigest(observationDigestPayload(item)));
    if (!digestValid) throw new CausalContinuityError("EVIDENCE_DIGEST_MISMATCH");
    const currentTime = now().getTime();
    const fresh = observations.filter((item) => {
      const age = currentTime - new Date(item.observed_at).getTime();
      const limits = [Number(obligation.freshness_seconds || 0), Number(item.freshness_seconds || 0)].filter((value) => value > 0);
      return age >= 0 && (!limits.length || age <= Math.min(...limits) * 1_000);
    });
    const requiredSources = Array.isArray(obligation.required_sources) ? obligation.required_sources : obligation.evidence_contract?.required_sources || [];
    const sourcesSatisfied = requiredSources.every((source) => fresh.some((item) => item.source === source));
    const requiredIndependence = obligation.minimum_independence || obligation.evidence_contract?.minimum_independence || "INDEPENDENT_SYSTEM";
    const requiredIndependenceRank = INDEPENDENCE[requiredIndependence] ?? INDEPENDENCE.INDEPENDENT_SYSTEM;
    const independentObservers = new Set(fresh.filter((item) =>
      (INDEPENDENCE[item.independence] ?? 0) >= requiredIndependenceRank && item.observer_identity !== obligation.owner_id,
    ).map((item) => item.observer_identity));
    const minimumIndependentObservers = Number(obligation.minimum_independent_observers ?? obligation.evidence_contract?.minimum_independent_observers ?? 1);
    const independenceSatisfied = independentObservers.size >= minimumIndependentObservers;
    const hasContradiction = fresh.some((item) => item.contradiction_status === "CONFIRMED");
    const hasFormal = fresh.some((item) => item.independence === "FORMAL");
    const hasCausalTest = fresh.some((item) => ["COUNTERFACTUAL", "REPLAY", "INTERVENTION_TEST"].includes(item.causal_relation));
    let derivedCal = fresh.length ? "CAL-1" : "CAL-0";
    if (sourcesSatisfied && independenceSatisfied) derivedCal = "CAL-2";
    if (derivedCal === "CAL-2" && hasCausalTest) derivedCal = "CAL-3";
    if (hasFormal) derivedCal = "CAL-4";
    const minimum = obligation.minimum_assurance_level || obligation.assurance_level;
    const contractSatisfied = sourcesSatisfied && independenceSatisfied && ASSURANCE[derivedCal] >= ASSURANCE[minimum];
    const verdict = hasContradiction ? "CONTRADICTED" : !fresh.length ? "UNKNOWN" : contractSatisfied ? "VERIFIED_PROVISIONAL" : "PARTIAL";
    const reconciliation_payload = {
      intent: input.intent || null, prediction: input.prediction || null, action: input.action || null,
      baseline: input.baseline || null, result: input.result || null, alternative_causes: input.alternative_causes || [],
      side_effects: input.side_effects || [], forbidden_effects: input.forbidden_effects || [], residual_risks: input.residual_risks || [],
      open_obligation_ids: input.open_obligation_ids || [], observation_digests: observations.map((item) => item.observation_digest).sort(),
      evidence_evaluation: {
        required_sources: requiredSources, sources_satisfied: sourcesSatisfied, freshness_satisfied: fresh.length === observations.length,
        minimum_independent_observers: minimumIndependentObservers, independent_observers_observed: independentObservers.size,
        independence_satisfied: independenceSatisfied, minimum_assurance_level: minimum, achieved_assurance_level: derivedCal,
      },
    };
    const reconciliation_id = stableUuid(prepared.tenant_id, obligation.project_id, prepared.operation, prepared.idempotency_key);
    const reconciliation = {
      ...prepared, reconciliation_id, project_id: obligation.project_id, intent_revision_id: obligation.intent_revision_id,
      work_id: obligation.work_id, change_id: obligation.change_id, obligation_id: obligation.obligation_id,
      observation_ids: observations.map((item) => item.observation_id).sort(), reconciliation_payload, verdict,
      achieved_assurance_level: derivedCal,
      transition_id: stableUuid(prepared.tenant_id, obligation.obligation_id, obligation.state, verdict, prepared.idempotency_key),
    };
    reconciliation.reconciliation_digest = causalDigest(stripEvent(reconciliation));
    return store.saveReconciliation(reconciliation);
  }

  async function causal_close(context, input = {}) {
    const prepared = mutationInput(context, input, "causal_close");
    const obligation = await store.readObligation({ tenant_id: prepared.tenant_id, obligation_id: requireUuid(input.obligation_id, "obligation_id") });
    const reconciliation = await store.readReconciliation({ tenant_id: prepared.tenant_id, reconciliation_id: requireUuid(input.reconciliation_id, "reconciliation_id") });
    if (reconciliation.obligation_id !== obligation.obligation_id || !["VERIFIED_PROVISIONAL", "VERIFIED_FINAL"].includes(reconciliation.verdict)) throw new CausalContinuityError("EVIDENCE_CONTRACT_UNSATISFIED");
    const target = input.final === true ? "VERIFIED_FINAL" : "VERIFIED_PROVISIONAL";
    const temporalChecks = await store.listTemporalChecks({ tenant_id: prepared.tenant_id, obligation_id: obligation.obligation_id });
    if (target === "VERIFIED_FINAL" && (!temporalChecks.length || temporalChecks.some((check) => check.state !== "SATISFIED" || new Date(check.due_at).getTime() > now().getTime()))) {
      throw new CausalContinuityError("TEMPORAL_CHECKS_PENDING");
    }
    const receipt_payload = {
      schema_version: "outcome_receipt_v1", project_id: obligation.project_id, intent_revision_id: obligation.intent_revision_id,
      work_id: obligation.work_id, change_id: obligation.change_id, obligation_id: obligation.obligation_id,
      obligation_digest: obligation.obligation_digest, reconciliation_id: reconciliation.reconciliation_id,
      reconciliation_digest: reconciliation.reconciliation_digest, observation_ids: reconciliation.observation_ids,
      residual_risks: reconciliation.reconciliation_payload?.residual_risks || [],
      temporal_checks: temporalChecks.map((check) => ({ temporal_check_id: check.temporal_check_id, horizon: check.horizon, due_at: iso(check.due_at, "due_at"), state: check.state, observation_id: check.observation_id || null })),
      closure_state: target,
    };
    const receipt_digest = causalDigest(receipt_payload);
    return store.closeObligationAtomic({
      ...prepared, project_id: obligation.project_id,
      outcome_receipt_id: stableUuid(prepared.tenant_id, obligation.project_id, "outcome-receipt", prepared.idempotency_key),
      obligation_id: obligation.obligation_id, reconciliation_id: reconciliation.reconciliation_id,
      reconciliation_digest: reconciliation.reconciliation_digest, receipt_payload, receipt_digest,
      closure_state: target, expected_states: ["VERIFIED_PROVISIONAL"],
      transition_id: stableUuid(prepared.tenant_id, obligation.obligation_id, obligation.state, target, prepared.idempotency_key),
    });
  }

  async function causal_reopen(context, input = {}) {
    const prepared = mutationInput(context, input, "causal_reopen");
    const obligation = await store.readObligation({ tenant_id: prepared.tenant_id, obligation_id: requireUuid(input.obligation_id, "obligation_id") });
    if (!REOPENABLE.has(obligation.state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
    return store.updateObligation({ ...prepared, project_id: obligation.project_id, obligation_id: obligation.obligation_id, operation: "causal_reopen", event_type: "CLOSURE_REOPENED", state: "CONTRADICTED", expected_states: [...REOPENABLE],
      transition_id: stableUuid(prepared.tenant_id, obligation.obligation_id, obligation.state, "CONTRADICTED", prepared.idempotency_key), reason: requireText(input.reason || "new contradictory evidence", "reason", 2_000) });
  }

  async function continuity_capsule_build(context, input = {}) {
    const prepared = mutationInput(context, input, "continuity_capsule_build");
    const project_id = requireUuid(input.project_id, "project_id");
    const work_id = requireUuid(input.work_id, "work_id");
    const [project, project_scope, current, genesis_intent, intent_revisions, active_work, changes, obligations, timeline, support] = await Promise.all([
      store.readProject({ tenant_id: prepared.tenant_id, project_id }), store.readScope({ tenant_id: prepared.tenant_id, project_id, active_only: true }),
      store.currentState({ tenant_id: prepared.tenant_id, project_id }), store.readGenesis({ tenant_id: prepared.tenant_id, project_id }),
      store.listRevisions({ tenant_id: prepared.tenant_id, project_id, limit: 200 }), store.readWork({ tenant_id: prepared.tenant_id, work_id }),
      store.listChanges({ tenant_id: prepared.tenant_id, project_id, work_id, limit: 200 }), store.listObligations({ tenant_id: prepared.tenant_id, project_id, work_id, limit: 200 }),
      store.timeline({ tenant_id: prepared.tenant_id, project_id, limit: 200 }),
      store.readCapsuleSupport({ tenant_id: prepared.tenant_id, project_id, work_id, limit: 200 }),
    ]);
    const sequence = Number(timeline.at(-1)?.sequence_number || 0) + 1;
    const capsule = {
      project_identity: project, project_scope, current_project_state_digest: current?.state_digest || null,
      genesis_intent, active_intent_revision: intent_revisions.find((item) => item.intent_revision_id === project.active_intent_revision_id) || null,
      decision_path: intent_revisions, active_work,
      open_changes: changes.filter((item) => !["VERIFIED_FINAL", "CLOSED", "ROLLED_BACK"].includes(item.state)),
      completed_changes: changes.filter((item) => ["VERIFIED_FINAL", "CLOSED", "ROLLED_BACK"].includes(item.state)),
      open_obligations: obligations.filter((item) => !["CLOSED", "ROLLED_BACK"].includes(item.state)),
      closed_obligations: obligations.filter((item) => ["CLOSED", "ROLLED_BACK"].includes(item.state)),
      gallery_bindings: support.gallery_bindings, artifacts: support.artifacts, latest_verified_state: current || null,
      known_conflicts: support.conflicts, blocker: support.conflicts.find((item) => item.conflict_type === "BLOCKER" && item.state === "OPEN") || null,
      residual_risks: obligations.flatMap((item) => Array.isArray(item.residual_obligations) ? item.residual_obligations : []), next_safe_action: input.next_safe_action || null,
      forbidden_actions: input.forbidden_actions || [], pending_temporal_checks: support.pending_temporal_checks,
      release_tuple_resolutions: support.release_tuple_resolutions,
      capsule_version: "causal_continuity_capsule_v1", generated_from_event_sequence: sequence,
    };
    capsule.capsule_digest = causalDigest(capsule);
    return store.saveCapsule({
      ...prepared, project_id, work_id, capsule_id: stableUuid(prepared.tenant_id, project_id, prepared.operation, prepared.idempotency_key),
      generated_from_event_sequence: sequence, capsule, capsule_digest: capsule.capsule_digest,
    });
  }

  async function continuity_capsule_resume(context, input = {}) {
    const actor = tenantContext(context);
    const capsuleRow = await store.latestCapsule({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id"), work_id: requireUuid(input.work_id, "work_id") });
    const capsule = capsuleRow.capsule_payload || capsuleRow.capsule;
    if (!capsule || causalDigest({ ...capsule, capsule_digest: undefined }) !== capsule.capsule_digest) throw new CausalContinuityError("CAPSULE_DIGEST_MISMATCH");
    const current = await store.currentState({ tenant_id: actor.tenant_id, project_id: input.project_id });
    if (current?.state_digest !== capsule.current_project_state_digest) return { status: "REBASE_REQUIRED", capsule, current_state_digest: current?.state_digest || null };
    return { status: "RESUMED", capsule };
  }

  async function project_timeline_read(context, input = {}) {
    const actor = tenantContext(context);
    return store.timeline({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id"), limit: input.limit, before_sequence: input.before_sequence });
  }

  function requireGalleryAuthority(context) {
    const actor = tenantContext(context);
    if (!actor.authority_scope.includes("gallery:project") && !actor.authority_scope.includes("core:govern")) {
      throw new CausalContinuityError("AUTHORITY_SCOPE_VIOLATION");
    }
    return actor;
  }

  async function gallery_binding_project(context, input = {}) {
    requireGalleryAuthority(context);
    const prepared = mutationInput(context, input, "gallery_binding_project");
    const project_id = requireUuid(input.project_id, "project_id");
    const entity_type = requireText(input.entity_type, "entity_type", 80).toUpperCase();
    if (!GALLERY_ENTITY_TYPES.has(entity_type)) throw new CausalContinuityError("GALLERY_ENTITY_TYPE_INVALID");
    return store.createGalleryBinding({
      ...prepared,
      project_id,
      binding_id: stableUuid(prepared.tenant_id, project_id, prepared.operation, prepared.idempotency_key),
      project_state_digest: requireDigest(input.project_state_digest, "project_state_digest"),
      genesis_intent_id: requireUuid(input.genesis_intent_id, "genesis_intent_id"),
      intent_revision_id: requireUuid(input.intent_revision_id, "intent_revision_id"),
      work_id: requireUuid(input.work_id, "work_id"),
      change_id: input.change_id ? requireUuid(input.change_id, "change_id") : null,
      obligation_ids: sortedUnique(input.obligation_ids || [], "obligation_ids", { maxItems: 64 }).map((id) => requireUuid(id, "obligation_id")),
      entity_type,
      ticket_id: requireText(input.ticket_id, "ticket_id", 240),
      parent_ticket_id: input.parent_ticket_id ? requireText(input.parent_ticket_id, "parent_ticket_id", 240) : null,
      context_digest: requireDigest(input.context_digest, "context_digest"),
      provenance: input.provenance && typeof input.provenance === "object" ? input.provenance : prepared.actor_provenance,
    });
  }

  async function gallery_projection_claim(context, input = {}) {
    const actor = requireGalleryAuthority(context);
    return store.claimGalleryProjection({
      tenant_id: actor.tenant_id,
      project_id: input.project_id ? requireUuid(input.project_id, "project_id") : null,
      worker_id: requireText(actor.actor_id, "worker_id", 160),
      limit: input.limit,
      lease_seconds: input.lease_seconds,
    });
  }

  async function gallery_projection_complete(context, input = {}) {
    const actor = requireGalleryAuthority(context);
    const readback = input.readback && typeof input.readback === "object" ? input.readback : {};
    const readbackTenant = requireText(readback.tenant_id, "readback.tenant_id", 120);
    if (readbackTenant !== actor.tenant_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
    const coreEventSequence = Number(readback.core_event_sequence);
    if (!Number.isSafeInteger(coreEventSequence) || coreEventSequence < 1) throw new CausalContinuityError("CORE_EVENT_SEQUENCE_INVALID");
    return store.completeGalleryProjection({
      tenant_id: actor.tenant_id,
      worker_id: actor.actor_id,
      outbox_id: requireUuid(input.outbox_id, "outbox_id"),
      readback: {
        tenant_id: readbackTenant,
        project_id: requireUuid(readback.project_id, "readback.project_id"),
        project_state_digest: requireDigest(readback.project_state_digest, "readback.project_state_digest"),
        genesis_intent_id: requireUuid(readback.genesis_intent_id, "readback.genesis_intent_id"),
        intent_revision_id: requireUuid(readback.intent_revision_id, "readback.intent_revision_id"),
        work_id: requireUuid(readback.work_id, "readback.work_id"),
        change_id: readback.change_id ? requireUuid(readback.change_id, "readback.change_id") : null,
        obligation_ids: sortedUnique(readback.obligation_ids || [], "readback.obligation_ids", { maxItems: 64 }).map((id) => requireUuid(id, "readback.obligation_id")),
        entity_type: requireText(readback.entity_type, "readback.entity_type", 80).toUpperCase(),
        ticket_id: requireText(readback.ticket_id, "readback.ticket_id", 240),
        parent_ticket_id: readback.parent_ticket_id ? requireText(readback.parent_ticket_id, "readback.parent_ticket_id", 240) : null,
        core_event_sequence: coreEventSequence,
        context_digest: requireDigest(readback.context_digest, "readback.context_digest"),
        provenance: readback.provenance && typeof readback.provenance === "object" ? readback.provenance : {},
        binding_digest: requireDigest(readback.binding_digest, "readback.binding_digest"),
        core_event_hash: requireDigest(readback.core_event_hash, "readback.core_event_hash"),
      },
    });
  }

  async function gallery_projection_fail(context, input = {}) {
    const actor = requireGalleryAuthority(context);
    return store.failGalleryProjection({
      tenant_id: actor.tenant_id, worker_id: actor.actor_id,
      outbox_id: requireUuid(input.outbox_id, "outbox_id"),
      error_code: requireText(input.error_code, "error_code", 120),
      retry_after_seconds: input.retry_after_seconds,
    });
  }

  async function gallery_causal_view_read(context, input = {}) {
    const actor = tenantContext(context);
    const view = requireText(input.view || "project_timeline", "view", 80).toLowerCase();
    if (!GALLERY_VIEWS.has(view)) throw new CausalContinuityError("GALLERY_VIEW_INVALID");
    return store.readGalleryCausalView({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id"), view, limit: input.limit, before_sequence: input.before_sequence });
  }

  async function causal_metrics_snapshot(context, input = {}) {
    const actor = tenantContext(context);
    return store.metricsSnapshot({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id") });
  }

  async function gallery_binding_verify(context, input = {}) {
    const actor = tenantContext(context);
    return store.verifyGalleryBinding({ tenant_id: actor.tenant_id, ticket_id: requireText(input.ticket_id, "ticket_id", 240) });
  }

  async function causal_rollout_read(context, input = {}) {
    const actor = tenantContext(context);
    return store.readFeatureFlag({ tenant_id: actor.tenant_id, project_id: requireUuid(input.project_id, "project_id") });
  }

  async function causal_rollout_set(context, input = {}) {
    const actor = tenantContext(context);
    if (!actor.owner_confirmed && !actor.authority_scope.includes("causal:rollout") && !actor.authority_scope.includes("core:govern")) {
      throw new CausalContinuityError("AUTHORITY_SCOPE_VIOLATION", "Rollout promotion requires owner or Core governance authority");
    }
    const project_id = requireUuid(input.project_id, "project_id");
    const mode = requireText(input.mode, "mode", 40).toUpperCase();
    if (!ROLLOUT_MODES.has(mode)) throw new CausalContinuityError("ROLLOUT_MODE_INVALID");
    const expected_version = Number(input.expected_version);
    if (!Number.isSafeInteger(expected_version) || expected_version < 1) throw new CausalContinuityError("EXPECTED_VERSION_INVALID");
    const current = await store.readFeatureFlag({ tenant_id: actor.tenant_id, project_id });
    if (Number(current.version) !== expected_version) throw new CausalContinuityError("STALE_PROJECT_STATE", "Rollout flag version is stale", { current_version: Number(current.version) });
    if (current.mode === mode) return { ...current, unchanged: true };
    if (!ROLLOUT_TRANSITIONS[current.mode]?.has(mode)) {
      throw new CausalContinuityError("ROLLOUT_TRANSITION_INVALID", `Rollout cannot transition directly from ${current.mode} to ${mode}`);
    }
    return store.setFeatureFlag({
      ...mutationInput(context, input, "causal_rollout_set"), project_id, mode, expected_version,
      previous_mode: current.mode,
    });
  }

  const capabilities = {
    project_identity_resolve, project_identity_create, project_scope_read, project_scope_bind,
    project_state_snapshot, project_state_verify, genesis_intent_read, genesis_intent_create,
    intent_revision_propose, intent_revision_approve, intent_revision_impact, project_decision_path_read, project_identity_spine_read,
    work_bind_intent, change_create, change_read, change_transition, causal_context_issue, causal_context_validate,
    causal_obligation_create, causal_obligation_read, causal_obligation_transition, causal_observation_record, causal_reconcile,
    causal_close, causal_reopen, continuity_capsule_build, continuity_capsule_resume,
    project_timeline_read, gallery_binding_project, gallery_projection_claim, gallery_projection_complete,
    gallery_projection_fail, gallery_causal_view_read, causal_metrics_snapshot, gallery_binding_verify,
    causal_rollout_read, causal_rollout_set, release_tuple_resolve, release_tuple_read,
  };

  return {
    initialize: () => store.initialize(),
    health: () => store.health(),
    invoke(capability, context, input) {
      const handler = capabilities[capability];
      if (!handler) throw new CausalContinuityError("CAUSAL_CAPABILITY_NOT_FOUND");
      return handler(context, input);
    },
    ...capabilities,
  };
}
