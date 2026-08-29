import crypto from "node:crypto";

/**
 * Entity 360 bitemporal projection.
 *
 * This is deliberately a projection of the immutable Entity 360 snapshot,
 * not another context store.  `valid_*` describes the represented world;
 * `known_*` describes what Core could actually use at a given point in time.
 */
export const ENTITY_360_BITEMPORAL_SNAPSHOT_VERSION = "entity_360_bitemporal_snapshot_v1";
export const ENTITY_360_BITEMPORAL_QUERY_VERSION = "entity_360_bitemporal_query_v1";
export const ENTITY_360_BITEMPORAL_QUERY_MODES = Object.freeze([
  "CURRENT_STATE", "VALID_AT", "KNOWN_AT", "VALID_AND_KNOWN_AT", "DECISION_CONTEXT_AT",
]);

const MODES = new Set(ENTITY_360_BITEMPORAL_QUERY_MODES);
const SHA256 = /^[a-f0-9]{64}$/u;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

export function entity360BitemporalDigest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function timestamp(value, code) {
  const normalized = String(value || "").trim();
  if (!RFC3339.test(normalized) || !Number.isFinite(Date.parse(normalized))) fail(code);
  // Canonicalize every RFC 3339 value accepted by the public schema so
  // equivalent offsets/fractional precision produce deterministic digests.
  return new Date(normalized).toISOString();
}

function nullableTimestamp(value, code) {
  return value === null || value === undefined ? null : timestamp(value, code);
}

function text(value, code, maximum = 240) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) fail(code);
  return normalized;
}

function digest(value, code) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
}

function canonicalSet(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function knownContract(snapshot) {
  const explicit = snapshot?.bitemporal;
  if (explicit && typeof explicit === "object") {
    const knownFrom = timestamp(explicit.as_of_knowledge_time,
      "entity360_bitemporal_knowledge_time_invalid");
    return {
      known_from: knownFrom,
      known_to: nullableTimestamp(explicit.knowledge_until,
        "entity360_bitemporal_knowledge_until_invalid"),
      knowledge_time_quality: text(explicit.knowledge_time_quality,
        "entity360_bitemporal_knowledge_quality_invalid", 40),
    };
  }
  // A legacy snapshot proves that data was recorded, not when it became
  // available to Core.  Do not convert that estimate into a fact.
  return { known_from: null, known_to: null, knowledge_time_quality: "UNKNOWN" };
}

function claimStateIndex(snapshot) {
  const states = new Map();
  for (const value of Object.values(snapshot?.current_state || {})) {
    for (const claimId of Array.isArray(value?.claim_ids) ? value.claim_ids : []) {
      states.set(claimId, "CURRENT");
    }
  }
  const references = [
    [snapshot?.historical_state_references, "HISTORICAL"],
    [snapshot?.superseded_state_references, "SUPERSEDED"],
    [snapshot?.stale_state_references, "STALE"],
  ];
  for (const [items, state] of references) {
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.claim_id) states.set(String(item.claim_id), state);
    }
  }
  for (const conflict of Array.isArray(snapshot?.contradictions) ? snapshot.contradictions : []) {
    for (const claimId of Array.isArray(conflict?.claim_ids) ? conflict.claim_ids : []) {
      states.set(String(claimId), "CONFLICTING");
    }
  }
  return states;
}

function claimState(fact, snapshot, indexedState) {
  const indexed = indexedState.get(String(fact.claim_id));
  if (indexed) return indexed;
  if (fact.valid_to && Date.parse(fact.valid_to) <= Date.parse(snapshot.as_of)) return "EXPIRED";
  const declared = String(fact.declared_state || "current").toUpperCase();
  if (["HISTORICAL", "SUPERSEDED", "STALE", "CONFLICTING"].includes(declared)) return declared;
  if (Date.parse(fact.valid_from) > Date.parse(snapshot.as_of)) return "HISTORICAL";
  return "CURRENT";
}

function manifestClaims(snapshot) {
  const contributions = snapshot?.qualification_manifest?.source_contributions;
  if (!Array.isArray(contributions)) fail("entity360_bitemporal_manifest_required");
  const contract = knownContract(snapshot);
  const stateByClaimId = claimStateIndex(snapshot);
  const claims = [];
  for (const contribution of contributions) {
    if (!contribution || typeof contribution !== "object" || !Array.isArray(contribution.facts)) {
      fail("entity360_bitemporal_manifest_invalid");
    }
    for (const fact of contribution.facts) {
      const validFrom = timestamp(fact.valid_from, "entity360_bitemporal_valid_from_invalid");
      const validTo = nullableTimestamp(fact.valid_to, "entity360_bitemporal_valid_to_invalid");
      if (validTo && Date.parse(validTo) <= Date.parse(validFrom)) {
        fail("entity360_bitemporal_valid_interval_invalid");
      }
      claims.push({
        claim_id: text(fact.claim_id, "entity360_bitemporal_claim_id_invalid", 160),
        fact_id: text(fact.fact_id, "entity360_bitemporal_fact_id_invalid", 160),
        value_digest: digest(fact.value_digest, "entity360_bitemporal_value_digest_invalid"),
        valid_from: validFrom,
        valid_to: validTo,
        known_from: contract.known_from,
        known_to: contract.known_to,
        knowledge_time_quality: contract.knowledge_time_quality,
        observed_at: timestamp(fact.observed_at, "entity360_bitemporal_observed_at_invalid"),
        recorded_at: timestamp(fact.recorded_at, "entity360_bitemporal_recorded_at_invalid"),
        source_ref: text(fact.source_id, "entity360_bitemporal_source_ref_invalid", 160),
        provenance_ref: text(contribution.contribution_digest,
          "entity360_bitemporal_provenance_ref_invalid", 64),
        evidence_refs: canonicalSet(Array.isArray(fact.evidence_refs) ? fact.evidence_refs.map((item) =>
          text(item, "entity360_bitemporal_evidence_ref_invalid", 2_000)) : []),
        evidence_digests: canonicalSet(Array.isArray(fact.evidence_digests) ? fact.evidence_digests.map((item) =>
          digest(item, "entity360_bitemporal_evidence_digest_invalid")) : []),
        supersedes_ref: fact.supersedes_claim_id || null,
        superseded_by_ref: null,
        expiry: validTo,
        scope: snapshot.tenant_scope,
        method: "entity360_qualified_snapshot_projection",
        confidence: Number(fact.confidence),
        corroboration_state: snapshot.corroboration_state?.by_fact?.[fact.fact_id]?.state || null,
        state: claimState(fact, snapshot, stateByClaimId),
        revision: Number(snapshot.snapshot_version),
      });
    }
  }
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]));
  for (const claim of claims) {
    const previous = claim.supersedes_ref && byId.get(claim.supersedes_ref);
    if (previous) {
      previous.superseded_by_ref = claim.claim_id;
      if (previous.state === "CURRENT") previous.state = "SUPERSEDED";
    }
  }
  return claims.sort((left, right) => left.claim_id.localeCompare(right.claim_id));
}

function snapshotBindings(snapshot) {
  if (!snapshot || typeof snapshot !== "object") fail("entity360_bitemporal_snapshot_required");
  const semanticDigest = digest(snapshot.deterministic_immutable_digest,
    "entity360_bitemporal_snapshot_digest_invalid");
  return {
    tenant_scope: text(snapshot.tenant_scope, "entity360_bitemporal_tenant_invalid", 120),
    entity_id: text(snapshot.entity_id, "entity360_bitemporal_entity_invalid", 160),
    entity_type: text(snapshot.entity_type, "entity360_bitemporal_entity_type_invalid", 80),
    entity360_snapshot_ref: semanticDigest,
    snapshot_version: Number(snapshot.snapshot_version),
    policy_revision: text(snapshot.policy_version, "entity360_bitemporal_policy_revision_invalid", 160),
    ontology_revision: text(snapshot.ontology_version, "entity360_bitemporal_ontology_revision_invalid", 160),
  };
}

export function buildEntity360BitemporalSnapshot(snapshot, { as_of_valid_time, as_of_knowledge_time } = {}) {
  const bindings = snapshotBindings(snapshot);
  const validTime = timestamp(as_of_valid_time || snapshot.as_of,
    "entity360_bitemporal_valid_time_required");
  const inherited = knownContract(snapshot);
  const knowledgeTime = timestamp(as_of_knowledge_time || inherited.known_from || snapshot.created_at,
    "entity360_bitemporal_knowledge_time_required");
  const claims = manifestClaims(snapshot);
  const payload = {
    schema_version: ENTITY_360_BITEMPORAL_SNAPSHOT_VERSION,
    ...bindings,
    as_of_valid_time: validTime,
    as_of_knowledge_time: knowledgeTime,
    knowledge_time_quality: inherited.knowledge_time_quality,
    source_set_digest: entity360BitemporalDigest(canonicalSet(claims.map((claim) => claim.source_ref))),
    evidence_set_digest: entity360BitemporalDigest(canonicalSet(claims.flatMap((claim) => claim.evidence_digests))),
    policy_digest: digest(snapshot.policy_digest, "entity360_bitemporal_policy_digest_invalid"),
    ontology_digest: digest(snapshot.ontology_digest, "entity360_bitemporal_ontology_digest_invalid"),
    claims,
    deterministic: true,
  };
  return Object.freeze({ ...payload, snapshot_digest: entity360BitemporalDigest(payload) });
}

function within(timestampValue, from, to) {
  if (!timestampValue || !from) return false;
  const value = Date.parse(timestampValue);
  return value >= Date.parse(from) && (!to || value < Date.parse(to));
}

function selected(claim, validTime, knownTime, { requireVerifiedKnowledge = false } = {}) {
  const valid = validTime ? within(validTime, claim.valid_from, claim.valid_to) : true;
  // Legacy knowledge time is unknown, not false.  It remains visible in the
  // present-state projection but is never admitted into historical replay.
  const known = knownTime ? (!requireVerifiedKnowledge || claim.knowledge_time_quality === "VERIFIED"
    && within(knownTime, claim.known_from, claim.known_to)) : true;
  return valid && known;
}

function normalizeMode(value) {
  const mode = String(value || "CURRENT_STATE").toUpperCase();
  if (!MODES.has(mode)) fail("entity360_bitemporal_query_mode_invalid");
  return mode;
}

function queryTimes(mode, input, snapshot) {
  if (mode === "CURRENT_STATE") return {
    valid: timestamp(input.as_of_valid_time || snapshot.as_of_valid_time,
      "entity360_bitemporal_valid_time_required"),
    known: timestamp(input.as_of_knowledge_time || snapshot.as_of_knowledge_time,
      "entity360_bitemporal_knowledge_time_required"),
  };
  if (mode === "VALID_AT") return { valid: timestamp(input.valid_at, "entity360_bitemporal_valid_at_required"), known: null };
  if (mode === "KNOWN_AT") return { valid: null, known: timestamp(input.known_at, "entity360_bitemporal_known_at_required") };
  if (mode === "VALID_AND_KNOWN_AT") return {
    valid: timestamp(input.valid_at, "entity360_bitemporal_valid_at_required"),
    known: timestamp(input.known_at, "entity360_bitemporal_known_at_required"),
  };
  const decision = timestamp(input.decision_time, "entity360_bitemporal_decision_time_required");
  return { valid: decision, known: decision };
}

export function queryEntity360BitemporalSnapshot(snapshot, input = {}) {
  const bitemporal = snapshot?.schema_version === ENTITY_360_BITEMPORAL_SNAPSHOT_VERSION
    ? snapshot : buildEntity360BitemporalSnapshot(snapshot);
  const mode = normalizeMode(input.query_mode);
  const times = queryTimes(mode, input, bitemporal);
  const historicalKnowledge = ["KNOWN_AT", "VALID_AND_KNOWN_AT", "DECISION_CONTEXT_AT"].includes(mode);
  if (mode === "DECISION_CONTEXT_AT" && (bitemporal.knowledge_time_quality !== "VERIFIED"
    || Date.parse(bitemporal.as_of_knowledge_time) > Date.parse(times.known))) {
    const unavailable = { schema_version: ENTITY_360_BITEMPORAL_QUERY_VERSION, query_mode: mode,
      entity360_snapshot_ref: bitemporal.entity360_snapshot_ref,
      bitemporal_snapshot_digest: bitemporal.snapshot_digest, as_of_valid_time: times.valid,
      as_of_knowledge_time: times.known, policy_revision: bitemporal.policy_revision,
      ontology_revision: bitemporal.ontology_revision, facts: [],
      evidence_set_digest: entity360BitemporalDigest([]), no_hindsight_leakage: true,
      disposition: "HOLD", reason_codes: ["NO_VERIFIED_KNOWLEDGE_SNAPSHOT_AT_DECISION_TIME"],
      execution_authorized: false, authority: "universal_core" };
    return Object.freeze({ ...unavailable, decision_digest: entity360BitemporalDigest(unavailable) });
  }
  const claims = bitemporal.claims.filter((claim) => selected(claim, times.valid, times.known,
    { requireVerifiedKnowledge: historicalKnowledge }) && (mode !== "CURRENT_STATE" || claim.state === "CURRENT"));
  const selectedEvidence = canonicalSet(claims.flatMap((claim) => claim.evidence_digests));
  const result = {
    schema_version: ENTITY_360_BITEMPORAL_QUERY_VERSION,
    query_mode: mode,
    entity360_snapshot_ref: bitemporal.entity360_snapshot_ref,
    bitemporal_snapshot_digest: bitemporal.snapshot_digest,
    as_of_valid_time: times.valid,
    as_of_knowledge_time: times.known,
    policy_revision: bitemporal.policy_revision,
    ontology_revision: bitemporal.ontology_revision,
    facts: claims,
    evidence_set_digest: entity360BitemporalDigest(selectedEvidence),
    no_hindsight_leakage: mode !== "DECISION_CONTEXT_AT" || claims.every((claim) =>
      claim.knowledge_time_quality === "VERIFIED" && Date.parse(claim.known_from) <= Date.parse(times.known)),
    execution_authorized: false,
    authority: "universal_core",
  };
  return Object.freeze({ ...result, decision_digest: entity360BitemporalDigest(result) });
}

export function replayEntity360DecisionContext({ snapshots, decision_time, work_revision, policy_revision,
  evidence_refs = [] } = {}) {
  if (!Array.isArray(snapshots) || !snapshots.length) fail("entity360_bitemporal_replay_snapshots_required");
  const decisionTime = timestamp(decision_time, "entity360_bitemporal_decision_time_required");
  const candidates = snapshots.map((snapshot) => snapshot?.schema_version === ENTITY_360_BITEMPORAL_SNAPSHOT_VERSION
    ? snapshot : buildEntity360BitemporalSnapshot(snapshot)).filter((snapshot) =>
    snapshot.knowledge_time_quality === "VERIFIED" && Date.parse(snapshot.as_of_knowledge_time) <= Date.parse(decisionTime));
  const finalize = (value) => Object.freeze({ ...value, decision_digest: entity360BitemporalDigest(value) });
  if (!candidates.length) {
    return finalize({ schema_version: ENTITY_360_BITEMPORAL_QUERY_VERSION,
      disposition: "HOLD", reason_codes: ["NO_VERIFIED_KNOWLEDGE_SNAPSHOT_AT_DECISION_TIME"],
      decision_time: decisionTime, work_revision: work_revision ?? null,
      policy_revision: policy_revision || null, facts: [], execution_authorized: false });
  }
  const selectedSnapshot = candidates.sort((left, right) => Date.parse(right.as_of_knowledge_time)
    - Date.parse(left.as_of_knowledge_time) || right.snapshot_version - left.snapshot_version)[0];
  const result = queryEntity360BitemporalSnapshot(selectedSnapshot, {
    query_mode: "DECISION_CONTEXT_AT", decision_time: decisionTime,
  });
  if (policy_revision && result.policy_revision !== policy_revision) {
    const { decision_digest: _ignored, ...unsigned } = result;
    return finalize({ ...unsigned, disposition: "HOLD", reason_codes: ["POLICY_REVISION_NOT_AVAILABLE_AT_DECISION_TIME"], work_revision: work_revision ?? null });
  }
  const requestedEvidence = canonicalSet(evidence_refs.map((value) => text(value,
    "entity360_bitemporal_evidence_ref_invalid", 2_000)));
  const availableEvidence = new Set(result.facts.flatMap((fact) => fact.evidence_refs));
  if (requestedEvidence.some((value) => !availableEvidence.has(value))) {
    const { decision_digest: _ignored, ...unsigned } = result;
    return finalize({ ...unsigned, disposition: "HOLD", reason_codes: ["EVIDENCE_NOT_AVAILABLE_AT_DECISION_TIME"], work_revision: work_revision ?? null });
  }
  const { decision_digest: _ignored, ...unsigned } = result;
  return finalize({ ...unsigned, disposition: "READY", reason_codes: [], work_revision: work_revision ?? null });
}
