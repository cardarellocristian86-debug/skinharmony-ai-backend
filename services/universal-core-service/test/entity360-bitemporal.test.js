import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEntity360BitemporalSnapshot,
  queryEntity360BitemporalSnapshot,
  replayEntity360DecisionContext,
} from "../src/entity360Bitemporal.js";

const DIGEST = "a".repeat(64);
const FACT_DIGEST = "b".repeat(64);
const CONTRIBUTION_DIGEST = "c".repeat(64);

function snapshot({ knownAt = "2026-08-12T00:00:00.000Z", validFrom = "2026-08-10T00:00:00.000Z",
  validTo = null, supersedes = null, version = 1, quality = "VERIFIED", asOf = validFrom,
  declaredState = "current", additionalFacts = [], contradictions = [] } = {}) {
  return {
    schema_version: "entity_360_snapshot_v2",
    deterministic_immutable_digest: DIGEST,
    tenant_scope: "tenant-a", entity_id: "e360_" + "d".repeat(48), entity_type: "work",
    snapshot_version: version, policy_version: "policy-v1", policy_digest: "d".repeat(64),
    ontology_version: "ontology-v1", ontology_digest: "e".repeat(64),
    as_of: asOf, created_at: knownAt,
    bitemporal: { as_of_knowledge_time: knownAt, knowledge_time_quality: quality },
    qualification_manifest: { source_contributions: [{ contribution_digest: CONTRIBUTION_DIGEST,
      facts: [{ claim_id: "claim-a", fact_id: "work.state", value_digest: FACT_DIGEST,
        valid_from: validFrom, valid_to: validTo, observed_at: validFrom, recorded_at: validFrom,
        source_id: "event_ledger", evidence_refs: ["evidence:a"], evidence_digests: ["f".repeat(64)],
        supersedes_claim_id: supersedes, declared_state: declaredState, confidence: 0.9 },
      ...additionalFacts] }] },
    corroboration_state: { by_fact: {} },
    contradictions,
  };
}

test("bitemporal projection separates fact validity from Core knowledge", () => {
  const result = queryEntity360BitemporalSnapshot(snapshot(), {
    query_mode: "VALID_AND_KNOWN_AT", valid_at: "2026-08-11T00:00:00.000Z", known_at: "2026-08-11T00:00:00.000Z",
  });
  assert.equal(result.facts.length, 0);
  const known = queryEntity360BitemporalSnapshot(snapshot(), {
    query_mode: "VALID_AND_KNOWN_AT", valid_at: "2026-08-11T00:00:00.000Z", known_at: "2026-08-12T00:00:00.000Z",
  });
  assert.equal(known.facts.length, 1);
});

test("decision replay cannot use a fact acquired after the decision", () => {
  const replay = replayEntity360DecisionContext({ snapshots: [snapshot()], decision_time: "2026-08-11T00:00:00.000Z", work_revision: 4 });
  assert.equal(replay.disposition, "HOLD");
  assert.match(replay.reason_codes.join(","), /NO_VERIFIED_KNOWLEDGE/);
});

test("legacy snapshots preserve UNKNOWN knowledge time instead of inventing a timestamp", () => {
  const legacy = snapshot();
  delete legacy.bitemporal;
  const view = buildEntity360BitemporalSnapshot(legacy);
  assert.equal(view.knowledge_time_quality, "UNKNOWN");
  const replay = replayEntity360DecisionContext({ snapshots: [legacy], decision_time: "2026-08-20T00:00:00.000Z" });
  assert.equal(replay.disposition, "HOLD");
  const current = queryEntity360BitemporalSnapshot(legacy, { query_mode: "CURRENT_STATE" });
  assert.equal(current.facts.length, 1);
});

test("decision query holds rather than treating an unavailable future snapshot as empty context", () => {
  const result = queryEntity360BitemporalSnapshot(snapshot(), {
    query_mode: "DECISION_CONTEXT_AT", decision_time: "2026-08-11T00:00:00Z",
  });
  assert.equal(result.disposition, "HOLD");
  assert.match(result.reason_codes.join(","), /NO_VERIFIED_KNOWLEDGE/);
  assert.equal(result.decision_digest.length, 64);
});

test("CURRENT_STATE excludes superseded claims and normalizes RFC3339 offsets", () => {
  const view = queryEntity360BitemporalSnapshot(snapshot({ additionalFacts: [{
    claim_id: "claim-new", fact_id: "work.state", value_digest: "9".repeat(64),
    valid_from: "2026-08-11T02:00:00+02:00", valid_to: null,
    observed_at: "2026-08-11T02:00:00+02:00", recorded_at: "2026-08-11T02:00:00+02:00",
    source_id: "event_ledger", evidence_refs: ["evidence:new"], evidence_digests: ["8".repeat(64)],
    supersedes_claim_id: "claim-a", declared_state: "current", confidence: 0.9,
  }], asOf: "2026-08-12T00:00:00.000Z" }), { query_mode: "CURRENT_STATE" });
  assert.deepEqual(view.facts.map((claim) => claim.claim_id), ["claim-new"]);
  assert.equal(view.facts[0].valid_from, "2026-08-11T00:00:00.000Z");
});

test("expired and superseded facts remain present as auditable historical claims", () => {
  const expired = queryEntity360BitemporalSnapshot(snapshot({ validTo: "2026-08-15T00:00:00.000Z" }), {
    query_mode: "VALID_AT", valid_at: "2026-08-16T00:00:00.000Z",
  });
  assert.equal(expired.facts.length, 0);
  const historical = queryEntity360BitemporalSnapshot(snapshot({ supersedes: "claim-old" }), {
    query_mode: "KNOWN_AT", known_at: "2026-08-12T00:00:00.000Z",
  });
  assert.equal(historical.facts[0].supersedes_ref, "claim-old");
});

test("bitemporal claims preserve current, superseded, stale, conflicting and expired state", () => {
  const expired = buildEntity360BitemporalSnapshot(snapshot({
    validTo: "2026-08-11T00:00:00.000Z", asOf: "2026-08-16T00:00:00.000Z",
  }));
  assert.equal(expired.claims[0].state, "EXPIRED");

  const stale = buildEntity360BitemporalSnapshot(snapshot({ declaredState: "stale" }));
  assert.equal(stale.claims[0].state, "STALE");

  const superseded = buildEntity360BitemporalSnapshot(snapshot({ additionalFacts: [{
    claim_id: "claim-new", fact_id: "work.state", value_digest: "9".repeat(64),
    valid_from: "2026-08-11T00:00:00.000Z", valid_to: null,
    observed_at: "2026-08-11T00:00:00.000Z", recorded_at: "2026-08-11T00:00:00.000Z",
    source_id: "event_ledger", evidence_refs: ["evidence:new"], evidence_digests: ["8".repeat(64)],
    supersedes_claim_id: "claim-a", declared_state: "current", confidence: 0.9,
  }] }));
  assert.equal(superseded.claims.find((claim) => claim.claim_id === "claim-a").state, "SUPERSEDED");

  const conflicting = buildEntity360BitemporalSnapshot(snapshot({ contradictions: [{
    claim_ids: ["claim-a"], reason_code: "CONCURRENT_CURRENT_VALUES_CONFLICT",
  }] }));
  assert.equal(conflicting.claims[0].state, "CONFLICTING");
});

test("bitemporal snapshot digest is deterministic", () => {
  assert.equal(buildEntity360BitemporalSnapshot(snapshot()).snapshot_digest,
    buildEntity360BitemporalSnapshot(snapshot()).snapshot_digest);
});
