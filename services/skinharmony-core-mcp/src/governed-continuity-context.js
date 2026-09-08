import crypto from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,159}$/;
const EFFECT_STATES = new Set(["SUCCEEDED", "KNOWN_NO_EFFECT", "AMBIGUOUS", "RECONCILING"]);
const CLASSIFICATIONS = new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function plain(value, code = "governed_contract_object_invalid") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function exact(value, fields, code) {
  plain(value, code);
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) fail(code);
  return value;
}

function boundedString(value, code, max = 1_000, pattern = null) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /\u0000/u.test(value)) fail(code);
  const resolved = value.trim();
  if (pattern && !pattern.test(resolved)) fail(code);
  return resolved;
}

function boundedStrings(value, code, { maxItems = 100, maxLength = 1_000, pattern = null } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) fail(code);
  const normalized = value.map((item) => boundedString(item, code, maxLength, pattern));
  if (new Set(normalized).size !== normalized.length) fail(code);
  return Object.freeze(normalized);
}

function positiveInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(code);
  return value;
}

function canonicalTimestamp(value, code) {
  const timestamp = boundedString(value, code, 40);
  const epoch = Date.parse(timestamp);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== timestamp) fail(code);
  return timestamp;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableCanonical(value[key])]));
}

export function governedDigest(domain, value) {
  const label = boundedString(domain, "governed_digest_domain_invalid", 120, ID);
  return crypto.createHash("sha256")
    .update(`NYRA_CORE_GOVERNED_V1\0${label}\0`)
    .update(JSON.stringify(stableCanonical(value)))
    .digest("hex");
}

function digest(value, code) {
  return boundedString(value, code, 64, SHA256);
}

function uuid(value, code) {
  return boundedString(value, code, 36, UUID).toLowerCase();
}

function identifier(value, code, max = 160) {
  return boundedString(value, code, max, ID);
}

function frozenRecord(value) {
  return Object.freeze(stableCanonical(clone(value)));
}

function temporalInterval(value, code, { openEnd = true } = {}) {
  exact(value, ["from", "to"], code);
  const from = canonicalTimestamp(value.from, code);
  const to = value.to === null && openEnd ? null : canonicalTimestamp(value.to, code);
  if (to !== null && Date.parse(to) <= Date.parse(from)) fail(code);
  return Object.freeze({ from, to });
}

export function validateContextProvenance(value, expected = {}) {
  exact(value, [
    "schema_version", "origin_ref", "source_class", "tenant_scope", "work_scope",
    "classification", "derived_from", "transformation_refs", "valid_time",
    "knowledge_time", "content_digest",
  ], "context_provenance_envelope_invalid");
  if (value.schema_version !== "context_provenance_envelope_v1") fail("context_provenance_envelope_invalid");
  const envelope = {
    schema_version: value.schema_version,
    origin_ref: identifier(value.origin_ref, "context_origin_ref_invalid", 500),
    source_class: identifier(value.source_class, "context_source_class_invalid", 80),
    tenant_scope: identifier(value.tenant_scope, "context_tenant_scope_invalid", 64),
    work_scope: value.work_scope === null ? null : uuid(value.work_scope, "context_work_scope_invalid"),
    classification: boundedString(value.classification, "context_classification_invalid", 32),
    derived_from: boundedStrings(value.derived_from, "context_derived_from_invalid", {
      maxItems: 100, maxLength: 64, pattern: SHA256,
    }).sort(),
    transformation_refs: boundedStrings(value.transformation_refs, "context_transformation_refs_invalid", {
      maxItems: 100, maxLength: 160, pattern: ID,
    }).sort(),
    valid_time: temporalInterval(value.valid_time, "context_valid_time_invalid"),
    knowledge_time: temporalInterval(value.knowledge_time, "context_knowledge_time_invalid"),
    content_digest: digest(value.content_digest, "context_content_digest_invalid"),
  };
  if (!CLASSIFICATIONS.has(envelope.classification)) fail("context_classification_invalid");
  if (expected.tenant_scope && envelope.tenant_scope !== expected.tenant_scope) fail("context_cross_tenant_denied");
  if (expected.work_scope !== undefined && envelope.work_scope !== expected.work_scope) fail("context_cross_work_denied");
  if (expected.as_of) {
    const asOf = canonicalTimestamp(expected.as_of, "context_as_of_invalid");
    if (Date.parse(envelope.knowledge_time.from) > Date.parse(asOf) ||
        (envelope.knowledge_time.to && Date.parse(asOf) >= Date.parse(envelope.knowledge_time.to))) {
      fail("context_future_knowledge_denied");
    }
  }
  return frozenRecord(envelope);
}

export function deriveContextProvenance(parentValues, transformation) {
  if (!Array.isArray(parentValues) || parentValues.length < 1 || parentValues.length > 100) {
    fail("context_parent_provenance_invalid");
  }
  const parents = parentValues.map((value) => validateContextProvenance(value));
  const tenantScope = parents[0].tenant_scope;
  if (parents.some((parent) => parent.tenant_scope !== tenantScope)) fail("context_cross_tenant_composition_denied");
  const workScopes = new Set(parents.map((parent) => parent.work_scope).filter(Boolean));
  if (workScopes.size > 1) fail("context_cross_work_composition_denied");
  const requested = plain(transformation, "context_transformation_invalid");
  if (requested.tenant_scope !== undefined && requested.tenant_scope !== tenantScope) {
    fail("context_scope_amplification_denied");
  }
  const inheritedWork = workScopes.size === 1 ? [...workScopes][0] : null;
  if (requested.work_scope !== undefined && requested.work_scope !== inheritedWork) {
    fail("context_scope_amplification_denied");
  }
  const classificationRank = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
  const inheritedClassification = parents.reduce((left, parent) =>
    classificationRank.indexOf(parent.classification) > classificationRank.indexOf(left)
      ? parent.classification : left, "PUBLIC");
  if (requested.classification !== undefined &&
      classificationRank.indexOf(requested.classification) < classificationRank.indexOf(inheritedClassification)) {
    fail("context_classification_downgrade_denied");
  }
  const derivedFrom = [...new Set(parents.flatMap((parent) =>
    [parent.content_digest, ...parent.derived_from]))].sort();
  return validateContextProvenance({
    schema_version: "context_provenance_envelope_v1",
    origin_ref: identifier(requested.origin_ref, "context_origin_ref_invalid", 500),
    source_class: identifier(requested.source_class, "context_source_class_invalid", 80),
    tenant_scope: tenantScope,
    work_scope: inheritedWork,
    classification: requested.classification || inheritedClassification,
    derived_from: derivedFrom,
    transformation_refs: boundedStrings(requested.transformation_refs || [], "context_transformation_refs_invalid", {
      maxItems: 100, maxLength: 160, pattern: ID,
    }),
    valid_time: requested.valid_time,
    knowledge_time: requested.knowledge_time,
    content_digest: requested.content_digest,
  });
}

export function validateSourceAuthorization(value, expected = {}, now = new Date().toISOString()) {
  exact(value, [
    "schema_version", "principal_id", "tenant_id", "work_id", "source_id", "namespace",
    "query_digest", "policy_revision", "revocation_revision", "issued_at", "expires_at",
  ], "source_authorization_invalid");
  if (value.schema_version !== "source_authorization_v1") fail("source_authorization_invalid");
  const authorization = {
    ...value,
    principal_id: identifier(value.principal_id, "source_authorization_principal_invalid"),
    tenant_id: identifier(value.tenant_id, "source_authorization_tenant_invalid", 64),
    work_id: value.work_id === null ? null : uuid(value.work_id, "source_authorization_work_invalid"),
    source_id: identifier(value.source_id, "source_authorization_source_invalid"),
    namespace: identifier(value.namespace, "source_authorization_namespace_invalid"),
    query_digest: digest(value.query_digest, "source_authorization_query_invalid"),
    policy_revision: digest(value.policy_revision, "source_authorization_policy_invalid"),
    revocation_revision: digest(value.revocation_revision, "source_authorization_revocation_invalid"),
    issued_at: canonicalTimestamp(value.issued_at, "source_authorization_time_invalid"),
    expires_at: canonicalTimestamp(value.expires_at, "source_authorization_time_invalid"),
  };
  const instant = Date.parse(canonicalTimestamp(now, "source_authorization_now_invalid"));
  if (Date.parse(authorization.issued_at) > instant || Date.parse(authorization.expires_at) <= instant) {
    fail("source_authorization_expired");
  }
  for (const field of ["principal_id", "tenant_id", "work_id", "source_id", "namespace", "query_digest", "policy_revision", "revocation_revision"]) {
    if (expected[field] !== undefined && authorization[field] !== expected[field]) {
      fail(`source_authorization_${field}_mismatch`);
    }
  }
  return frozenRecord(authorization);
}

function sourceCost(source) {
  return source.cost.token_budget + source.cost.latency_budget_ms + source.cost.candidate_budget;
}

export function buildBoundedContext({ sources, required_source_ids = [], budgets, expected_scope, now } = {}) {
  if (!Array.isArray(sources) || sources.length > 500) fail("context_sources_invalid");
  const required = new Set(boundedStrings(required_source_ids, "required_sources_invalid", {
    maxItems: 100, maxLength: 160, pattern: ID,
  }));
  const limits = exact(budgets, ["max_sources", "max_tokens", "max_latency_ms", "max_candidates"], "context_budgets_invalid");
  for (const field of Object.keys(limits)) positiveInteger(limits[field], "context_budgets_invalid", 1_000_000);
  const normalized = sources.map((source) => {
    plain(source, "context_source_invalid");
    const sourceId = identifier(source.source_id, "context_source_id_invalid");
    const provenance = validateContextProvenance(source.provenance, expected_scope || {});
    const authorization = validateSourceAuthorization(source.authorization, {
      principal_id: expected_scope?.principal_id,
      tenant_id: expected_scope?.tenant_scope,
      work_id: expected_scope?.work_scope,
      namespace: expected_scope?.namespace,
      query_digest: expected_scope?.query_digest,
      policy_revision: expected_scope?.policy_revision,
      revocation_revision: expected_scope?.revocation_revision,
      source_id: sourceId,
    }, now);
    const cost = exact(source.cost, ["token_budget", "latency_budget_ms", "candidate_budget"], "context_source_cost_invalid");
    for (const field of Object.keys(cost)) positiveInteger(cost[field], "context_source_cost_invalid", 1_000_000);
    if (typeof source.utility !== "number" || source.utility < 0 || source.utility > 1) fail("context_source_utility_invalid");
    return frozenRecord({
      source_id: sourceId,
      mandatory: source.mandatory === true || required.has(sourceId),
      utility: source.utility,
      cost,
      provenance,
      authorization,
      content_ref: identifier(source.content_ref, "context_content_ref_invalid", 500),
    });
  });
  for (const sourceId of required) {
    if (!normalized.some((source) => source.source_id === sourceId)) fail("mandatory_context_source_missing");
  }
  const ranked = [...normalized].sort((left, right) =>
    Number(right.mandatory) - Number(left.mandatory) ||
    right.utility - left.utility || sourceCost(left) - sourceCost(right) ||
    left.source_id.localeCompare(right.source_id));
  const selected = [];
  const originFamilies = new Set();
  const totals = { max_sources: 0, max_tokens: 0, max_latency_ms: 0, max_candidates: 0 };
  for (const source of ranked) {
    const family = source.provenance.derived_from[0] || source.provenance.content_digest;
    if (originFamilies.has(family)) continue;
    const next = {
      max_sources: totals.max_sources + 1,
      max_tokens: totals.max_tokens + source.cost.token_budget,
      max_latency_ms: totals.max_latency_ms + source.cost.latency_budget_ms,
      max_candidates: totals.max_candidates + source.cost.candidate_budget,
    };
    const exceeds = Object.keys(limits).some((field) => next[field] > limits[field]);
    if (exceeds && source.mandatory) fail("mandatory_context_budget_exceeded");
    if (exceeds) continue;
    Object.assign(totals, next);
    selected.push(source);
    originFamilies.add(family);
  }
  if ([...required].some((sourceId) => !selected.some((source) => source.source_id === sourceId))) {
    fail("mandatory_context_source_not_admitted");
  }
  const material = {
    schema_version: "bounded_context_v1",
    tenant_scope: expected_scope?.tenant_scope || null,
    work_scope: expected_scope?.work_scope ?? null,
    selected_sources: selected,
    totals: {
      source_count: totals.max_sources,
      token_budget: totals.max_tokens,
      latency_budget_ms: totals.max_latency_ms,
      candidate_budget: totals.max_candidates,
    },
    authority_granted: false,
  };
  return frozenRecord({ ...material, context_digest: governedDigest("bounded_context", material) });
}

export function buildTaskStateContract(input) {
  exact(input, [
    "task_id", "work_id", "contract_revision", "intent_digest", "declared_inputs",
    "dependency_refs", "output_schema_ref", "required_claims", "allowed_effects",
    "recovery_policy", "budgets",
  ], "task_state_contract_invalid");
  const material = {
    schema_version: "task_state_contract_v1",
    task_id: uuid(input.task_id, "task_contract_task_invalid"),
    work_id: uuid(input.work_id, "task_contract_work_invalid"),
    contract_revision: positiveInteger(input.contract_revision, "task_contract_revision_invalid", 1_000_000),
    intent_digest: digest(input.intent_digest, "task_contract_intent_invalid"),
    declared_inputs: frozenRecord(plain(input.declared_inputs, "task_contract_inputs_invalid")),
    dependency_refs: boundedStrings(input.dependency_refs, "task_contract_dependencies_invalid", { maxItems: 250, maxLength: 500 }),
    output_schema_ref: identifier(input.output_schema_ref, "task_contract_output_schema_invalid", 500),
    required_claims: boundedStrings(input.required_claims, "task_contract_claims_invalid", { maxItems: 100, maxLength: 240 }),
    allowed_effects: boundedStrings(input.allowed_effects, "task_contract_effects_invalid", { maxItems: 100, maxLength: 160, pattern: ID }),
    recovery_policy: frozenRecord(plain(input.recovery_policy, "task_contract_recovery_invalid")),
    budgets: frozenRecord(plain(input.budgets, "task_contract_budgets_invalid")),
  };
  if (material.contract_revision < 1) fail("task_contract_revision_invalid");
  return frozenRecord({ ...material, contract_digest: governedDigest("task_state_contract", material) });
}

export function buildCommittedTaskState(input) {
  exact(input, [
    "task_id", "work_id", "revision", "contract_revision", "input_digest", "output_ref",
    "output_digest", "evidence_refs", "effect_lineage_refs", "validation_ref",
    "ledger_position", "committed_at",
  ], "committed_task_state_invalid");
  const material = {
    schema_version: "committed_task_state_v1",
    task_id: uuid(input.task_id, "committed_task_id_invalid"),
    work_id: uuid(input.work_id, "committed_work_id_invalid"),
    revision: positiveInteger(input.revision, "committed_revision_invalid", 1_000_000),
    contract_revision: positiveInteger(input.contract_revision, "committed_contract_revision_invalid", 1_000_000),
    input_digest: digest(input.input_digest, "committed_input_digest_invalid"),
    output_ref: identifier(input.output_ref, "committed_output_ref_invalid", 500),
    output_digest: digest(input.output_digest, "committed_output_digest_invalid"),
    evidence_refs: boundedStrings(input.evidence_refs, "committed_evidence_refs_invalid", { maxItems: 250, maxLength: 160, pattern: ID }),
    effect_lineage_refs: boundedStrings(input.effect_lineage_refs, "committed_effect_refs_invalid", { maxItems: 250, maxLength: 160, pattern: ID }),
    validation_ref: identifier(input.validation_ref, "committed_validation_ref_invalid", 500),
    ledger_position: positiveInteger(input.ledger_position, "committed_ledger_position_invalid", 10_000_000_000),
    committed_at: canonicalTimestamp(input.committed_at, "committed_at_invalid"),
  };
  if (material.revision < 1 || material.contract_revision < 1 || material.ledger_position < 1) {
    fail("committed_task_state_invalid");
  }
  return frozenRecord({ ...material, commit_digest: governedDigest("committed_task_state", material) });
}

export function validateDependencyManifest(input, expected = {}) {
  exact(input, [
    "schema_version", "plan_digest", "task_revision", "intent_digest", "dependency_ids",
    "source_versions", "relevant_predicates", "required_evidence_refs", "policy_revision",
    "manifest_digest",
  ], "dependency_manifest_invalid");
  const material = {
    schema_version: "dependency_manifest_v1",
    plan_digest: digest(input.plan_digest, "dependency_plan_digest_invalid"),
    task_revision: positiveInteger(input.task_revision, "dependency_task_revision_invalid", 1_000_000),
    intent_digest: digest(input.intent_digest, "dependency_intent_digest_invalid"),
    dependency_ids: boundedStrings(input.dependency_ids, "dependency_ids_invalid", { maxItems: 250, maxLength: 160, pattern: ID }).sort(),
    source_versions: frozenRecord(plain(input.source_versions, "dependency_source_versions_invalid")),
    relevant_predicates: frozenRecord(plain(input.relevant_predicates, "dependency_predicates_invalid")),
    required_evidence_refs: boundedStrings(input.required_evidence_refs, "dependency_evidence_invalid", { maxItems: 250, maxLength: 160, pattern: ID }).sort(),
    policy_revision: digest(input.policy_revision, "dependency_policy_revision_invalid"),
  };
  if (material.task_revision < 1) fail("dependency_task_revision_invalid");
  if (input.manifest_digest !== governedDigest("dependency_manifest", material)) fail("dependency_manifest_digest_invalid");
  for (const field of ["plan_digest", "task_revision", "intent_digest", "policy_revision"]) {
    if (expected[field] !== undefined && material[field] !== expected[field]) fail(`dependency_${field}_drift`);
  }
  const mandatory = new Set(expected.mandatory_dependency_ids || []);
  if ([...mandatory].some((value) => !material.dependency_ids.includes(value))) fail("mandatory_dependency_missing");
  return frozenRecord({ ...material, manifest_digest: input.manifest_digest });
}

export function evaluateTrajectory({ previous, proposal, policy } = {}) {
  const prior = previous || {
    read_scopes: [], write_scopes: [], recipients: [], effect_count: 0, egress_count: 0,
  };
  const nextProposal = plain(proposal, "trajectory_proposal_invalid");
  const limits = exact(policy, [
    "max_read_scopes", "max_write_scopes", "max_recipients", "max_effects", "max_egress",
    "forbidden_scope_pairs",
  ], "trajectory_policy_invalid");
  const union = (left, right, code) => [...new Set([
    ...boundedStrings(left || [], code, { maxItems: 10_000, maxLength: 160, pattern: ID }),
    ...boundedStrings(right || [], code, { maxItems: 1_000, maxLength: 160, pattern: ID }),
  ])].sort();
  const state = {
    schema_version: "work_trajectory_v1",
    read_scopes: union(prior.read_scopes, nextProposal.read_scopes, "trajectory_read_scope_invalid"),
    write_scopes: union(prior.write_scopes, nextProposal.write_scopes, "trajectory_write_scope_invalid"),
    recipients: union(prior.recipients, nextProposal.recipients, "trajectory_recipient_invalid"),
    effect_count: positiveInteger(prior.effect_count || 0, "trajectory_effect_count_invalid") +
      positiveInteger(nextProposal.effect_count || 0, "trajectory_effect_count_invalid", 1_000),
    egress_count: positiveInteger(prior.egress_count || 0, "trajectory_egress_count_invalid") +
      positiveInteger(nextProposal.egress_count || 0, "trajectory_egress_count_invalid", 1_000),
  };
  const reasons = [];
  for (const [field, maximum] of [
    ["read_scopes", limits.max_read_scopes], ["write_scopes", limits.max_write_scopes],
    ["recipients", limits.max_recipients], ["effect_count", limits.max_effects],
    ["egress_count", limits.max_egress],
  ]) {
    positiveInteger(maximum, "trajectory_policy_invalid", 1_000_000);
    const count = Array.isArray(state[field]) ? state[field].length : state[field];
    if (count > maximum) reasons.push(`trajectory_${field}_limit_exceeded`);
  }
  if (!Array.isArray(limits.forbidden_scope_pairs) || limits.forbidden_scope_pairs.length > 100) {
    fail("trajectory_policy_invalid");
  }
  const allScopes = new Set([...state.read_scopes, ...state.write_scopes]);
  for (const pair of limits.forbidden_scope_pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((item) => !ID.test(String(item)))) {
      fail("trajectory_policy_invalid");
    }
    if (pair.every((scope) => allScopes.has(scope))) reasons.push("trajectory_forbidden_scope_composition");
  }
  const material = { ...state, disposition: reasons.length ? "HOLD" : "ALLOW", reason_codes: [...new Set(reasons)].sort() };
  return frozenRecord({ ...material, trajectory_digest: governedDigest("work_trajectory", material) });
}

export function normalizeEffectObservation(value) {
  exact(value, ["effect_ref", "state", "observed_at", "provider_receipt_digest"], "effect_observation_invalid");
  const state = boundedString(value.state, "effect_observation_state_invalid", 32);
  if (!EFFECT_STATES.has(state)) fail("effect_observation_state_invalid");
  return frozenRecord({
    effect_ref: identifier(value.effect_ref, "effect_observation_ref_invalid", 160),
    state,
    observed_at: canonicalTimestamp(value.observed_at, "effect_observation_time_invalid"),
    provider_receipt_digest: value.provider_receipt_digest === null
      ? null : digest(value.provider_receipt_digest, "effect_observation_receipt_invalid"),
  });
}

function emptyProjection({ work_id, intent_digest }) {
  return {
    schema_version: "work_state_projection_v1",
    work_id: uuid(work_id, "projection_work_id_invalid"),
    work_revision: 0,
    intent_digest: digest(intent_digest, "projection_intent_digest_invalid"),
    projection_version: 1,
    ledger_watermark: 0,
    current_task: null,
    completed_tasks: [],
    invalidated_tasks: [],
    blockers: [],
    unresolved_effects: [],
    safety_state_refs: [],
    evidence_refs: [],
    next_allowed_actions: [],
  };
}

export function foldWorkProjection({ work_id, intent_digest, base = null, events = [] } = {}) {
  if (!Array.isArray(events) || events.length > 100_000) fail("projection_events_invalid");
  const state = base ? clone(base) : emptyProjection({ work_id, intent_digest });
  // A persisted digest authenticates the base snapshot but is not part of the
  // state being folded. Including it in the next digest would make an
  // incremental fold diverge from a full replay.
  delete state.projection_digest;
  if (state.work_id !== uuid(work_id, "projection_work_id_invalid") ||
      state.intent_digest !== digest(intent_digest, "projection_intent_digest_invalid")) {
    fail("projection_base_binding_invalid");
  }
  const seenIds = new Set();
  for (const event of events) {
    plain(event, "projection_event_invalid");
    const eventId = uuid(event.event_id, "projection_event_id_invalid");
    if (seenIds.has(eventId)) continue;
    seenIds.add(eventId);
    const position = positiveInteger(event.sequence_number, "projection_event_sequence_invalid", 10_000_000_000);
    if (position <= state.ledger_watermark) fail("projection_event_out_of_order");
    if (position !== state.ledger_watermark + 1) fail("projection_event_out_of_order");
    const payload = plain(event.payload || {}, "projection_event_payload_invalid");
    switch (event.event_type) {
      case "task_contract_recorded":
        state.current_task = uuid(payload.task_id, "projection_task_id_invalid");
        break;
      case "task_state_committed": {
        const taskId = uuid(payload.task_id, "projection_task_id_invalid");
        state.completed_tasks = [...new Set([...state.completed_tasks, taskId])].sort();
        state.invalidated_tasks = state.invalidated_tasks.filter((value) => value !== taskId);
        if (state.current_task === taskId) state.current_task = null;
        state.evidence_refs = [...new Set([...state.evidence_refs, ...(payload.evidence_refs || [])])].sort();
        break;
      }
      case "task_state_invalidated": {
        const taskId = uuid(payload.task_id, "projection_task_id_invalid");
        state.completed_tasks = state.completed_tasks.filter((value) => value !== taskId);
        state.invalidated_tasks = [...new Set([...state.invalidated_tasks, taskId])].sort();
        state.current_task ||= taskId;
        break;
      }
      case "effect_observed": {
        const observation = normalizeEffectObservation(payload);
        state.unresolved_effects = state.unresolved_effects.filter((item) => item.effect_ref !== observation.effect_ref);
        if (["AMBIGUOUS", "RECONCILING"].includes(observation.state)) state.unresolved_effects.push(observation);
        state.unresolved_effects.sort((left, right) => left.effect_ref.localeCompare(right.effect_ref));
        break;
      }
      case "trajectory_evaluated": {
        const trajectoryDigest = digest(payload.trajectory_digest,
          "projection_trajectory_digest_invalid");
        state.blockers = state.blockers.filter((value) => !value.startsWith("trajectory:"));
        if (payload.disposition === "HOLD") state.blockers.push(`trajectory:${trajectoryDigest}`);
        else if (payload.disposition !== "ALLOW") fail("projection_trajectory_disposition_invalid");
        state.blockers.sort();
        break;
      }
      case "work_blocker_recorded":
        state.blockers = [...new Set([...state.blockers, identifier(payload.blocker_ref, "projection_blocker_invalid", 160)])].sort();
        break;
      case "work_blocker_resolved":
        state.blockers = state.blockers.filter((value) => value !== payload.blocker_ref);
        break;
      case "safety_state_recorded":
        state.safety_state_refs = [...new Set([...state.safety_state_refs,
          identifier(payload.safety_state_ref, "projection_safety_ref_invalid", 160)])].sort();
        break;
      case "next_actions_set":
        state.next_allowed_actions = boundedStrings(payload.next_allowed_actions, "projection_actions_invalid", {
          maxItems: 100, maxLength: 160, pattern: ID,
        }).sort();
        break;
      default:
        break;
    }
    state.ledger_watermark = position;
    state.work_revision = position;
  }
  const material = stableCanonical(state);
  return frozenRecord({ ...material, projection_digest: governedDigest("work_state_projection", material) });
}

const PROJECTION_VIEWS = new Set(["agent", "verifier", "core", "owner"]);
const CONTINUITY_ROLLOUT_MODES = new Set(["OFF", "SHADOW", "ENFORCED"]);

export function evaluateGovernedContinuityRollout({
  mode,
  mutation = false,
  legacy_completion = false,
} = {}) {
  const selectedMode = boundedString(mode, "governed_continuity_mode_invalid", 16).toUpperCase();
  if (!CONTINUITY_ROLLOUT_MODES.has(selectedMode) || typeof mutation !== "boolean" ||
      typeof legacy_completion !== "boolean") fail("governed_continuity_mode_invalid");
  const reason = mutation && selectedMode === "OFF"
    ? "governed_continuity_context_off"
    : legacy_completion && selectedMode === "ENFORCED"
      ? "governed_task_commit_required"
      : null;
  const material = {
    schema_version: "governed_continuity_rollout_decision_v1",
    mode: selectedMode,
    allowed: reason === null,
    reason,
    mutation,
    shadow_observation_only: selectedMode === "SHADOW",
    legacy_completion_requires_governed_commit: selectedMode === "ENFORCED",
    authority_granted: false,
  };
  return frozenRecord({ ...material,
    decision_digest: governedDigest("governed_continuity_rollout", material) });
}

export function projectWorkStateForView(projection, view) {
  plain(projection, "work_projection_invalid");
  const selectedView = boundedString(view, "work_projection_view_invalid", 16).toLowerCase();
  if (!PROJECTION_VIEWS.has(selectedView)) fail("work_projection_view_invalid");
  if (projection.schema_version !== "work_state_projection_v1" ||
      projection.available === false || !SHA256.test(String(projection.projection_digest || ""))) {
    fail("work_projection_invalid");
  }
  const common = {
    schema_version: "work_state_projection_view_v1",
    view: selectedView,
    work_id: uuid(projection.work_id, "projection_work_id_invalid"),
    work_revision: positiveInteger(projection.work_revision || 0,
      "projection_work_revision_invalid", 10_000_000_000),
    intent_digest: digest(projection.intent_digest, "projection_intent_digest_invalid"),
    projection_version: positiveInteger(projection.projection_version,
      "projection_version_invalid", 1_000_000),
    ledger_watermark: positiveInteger(projection.ledger_watermark || 0,
      "projection_watermark_invalid", 10_000_000_000),
    source_projection_digest: digest(projection.projection_digest, "projection_digest_invalid"),
    current_task: projection.current_task || null,
    blockers: clone(projection.blockers || []),
    unresolved_effects: clone(projection.unresolved_effects || []),
    authority_granted: false,
    read_only: true,
  };
  const roleFields = selectedView === "agent" ? {
    completed_tasks: clone(projection.completed_tasks || []),
    invalidated_tasks: clone(projection.invalidated_tasks || []),
    next_allowed_actions: clone(projection.next_allowed_actions || []),
  } : selectedView === "verifier" ? {
    completed_tasks: clone(projection.completed_tasks || []),
    invalidated_tasks: clone(projection.invalidated_tasks || []),
    evidence_refs: clone(projection.evidence_refs || []),
    safety_state_refs: clone(projection.safety_state_refs || []),
  } : {
    completed_tasks: clone(projection.completed_tasks || []),
    invalidated_tasks: clone(projection.invalidated_tasks || []),
    evidence_refs: clone(projection.evidence_refs || []),
    safety_state_refs: clone(projection.safety_state_refs || []),
    next_allowed_actions: clone(projection.next_allowed_actions || []),
  };
  const material = { ...common, ...roleFields };
  return frozenRecord({ ...material,
    view_digest: governedDigest("work_state_projection_view", material) });
}

export function buildExecutionConstraintsProjection(input) {
  exact(input, ["work_id", "task_id", "runtime", "tools", "network", "resources", "concurrency", "budgets", "policy", "effect_ceiling"], "execution_constraints_invalid");
  const observedKinds = new Set(["DECLARED", "OBSERVED", "VERIFIED", "UNKNOWN"]);
  const dimension = (value, code) => {
    exact(value, ["state", "value", "evidence_refs"], code);
    if (!observedKinds.has(value.state)) fail(code);
    return frozenRecord({
      state: value.state,
      value: clone(value.value),
      evidence_refs: boundedStrings(value.evidence_refs, code, { maxItems: 100, maxLength: 160, pattern: ID }).sort(),
    });
  };
  const material = {
    schema_version: "execution_constraints_projection_v1",
    work_id: uuid(input.work_id, "execution_constraints_work_invalid"),
    task_id: uuid(input.task_id, "execution_constraints_task_invalid"),
    runtime: dimension(input.runtime, "execution_constraints_runtime_invalid"),
    tools: dimension(input.tools, "execution_constraints_tools_invalid"),
    network: dimension(input.network, "execution_constraints_network_invalid"),
    resources: dimension(input.resources, "execution_constraints_resources_invalid"),
    concurrency: dimension(input.concurrency, "execution_constraints_concurrency_invalid"),
    budgets: dimension(input.budgets, "execution_constraints_budgets_invalid"),
    policy: dimension(input.policy, "execution_constraints_policy_invalid"),
    effect_ceiling: dimension(input.effect_ceiling, "execution_constraints_effect_invalid"),
    read_only: true,
    server_derived: true,
  };
  return frozenRecord({ ...material, projection_digest: governedDigest("execution_constraints", material) });
}
