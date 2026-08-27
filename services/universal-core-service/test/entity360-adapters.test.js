import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { assembleEntity360Snapshot, deterministicEntity360Id, entity360Digest,
  verifyEntity360Snapshot } from "../src/entity360.js";
import { createPostgresEntity360AdapterRegistry } from "../src/entity360Adapters.js";
import { loadEntity360Configuration } from "../src/entity360Runtime.js";
import { causalDigest } from "../src/causalContinuityCanonical.js";
import { buildCausalEventHash } from "../src/causalContinuityStore.js";
import {
  ICF_EVENT_CANONICALIZATION_V2,
  ICF_EVENT_DIGEST_ALGORITHM,
  ICF_EVENT_DIGEST_CONTRACT_V2,
  icfEventDigestV2,
  icfEventPayloadDigestV2,
} from "../src/icfEventDigest.js";
import { projectScopeObservationDigest } from "../src/projectScopeRenderOriginResolver.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const WORK_ID = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
const LEGACY_WORK_ID = "11111111-1111-4111-8111-111111111111";
const GENESIS_ID = "22222222-2222-4222-8222-222222222222";
const INTENT_REVISION_ID = "33333333-3333-4333-8333-333333333333";
const OBSERVATION_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_OBSERVATION_ID = "88888888-8888-4888-8888-888888888888";
const PROJECT_UUID = "55555555-5555-4555-8555-555555555555";
const CHANGE_ID = "66666666-6666-4666-8666-666666666666";
const OBLIGATION_ID = "77777777-7777-4777-8777-777777777777";
const CAUSAL_EVENT_ID = "99999999-9999-4999-8999-999999999999";
const CAUSAL_EVENT_SEQUENCE = 8;
const CAUSAL_PREVIOUS_EVENT_HASH = "f".repeat(64);
const AT = "2026-08-25T10:00:00.000Z";
const ADAPTER_REGISTRY_VERSION = "entity_360_adapter_registry_v1";
const QUALIFICATION_SECRET = "entity360-adapter-test-qualification-secret-v1";
const GENESIS_INTENT_TEXT = "Build a governed Entity 360 context and evidence layer";
const INTENT_ALIAS = "entity-360-v1";
const INTENT_CLASSIFICATION = "REFINEMENT";
const CAUSAL_BINDING_PROVENANCE = Object.freeze({ source: "entity360-adapter-test" });
const CAUSAL_ACTOR_PROVENANCE = Object.freeze({ actor_id: "agent:entity360-test",
  tenant_id: TENANT, operation: "work_bind_intent" });
const INTENT_REVISION_PAYLOAD = Object.freeze({
  motivation: "Qualify context before reasoning",
  problem: "Context is fragmented across authoritative sources",
  alternatives_considered: [],
  chosen_alternative: "Entity 360",
  rejected_alternatives: [],
  scope_added: [],
  scope_removed: [],
  invariants: ["Context is not authority"],
  risks: [],
  affected_work_ids: [LEGACY_WORK_ID],
  obligations_maintained: [],
  obligations_replaced: [],
  authorization: null,
});
const WORK_ARCHITECTURE = Object.freeze({ components: ["core"] });
const WORK_EVENT_PAYLOAD = Object.freeze({ status: "ACTIVE" });
const ICF_EVENT_TYPE = "STATE_BOUND";
const ICF_EVENT_PAYLOAD = Object.freeze({
  zeta: Object.freeze({ zeta: "last", alpha: "first" }),
  alpha: Object.freeze([Object.freeze({ zeta: 2, alpha: 1 }), "BOUND"]),
});
const ATLAS_NODE = Object.freeze({
  node_id: "src/app.js#entity360",
  node_kind: "module",
  path: "src/app.js",
  symbol: "entity360",
  summary: "Entity 360 integration",
  metadata: {},
  source_kind: "git",
  source_ref: "main",
  provenance: {},
  verification_state: "verified",
  confidence: 0.96,
});
const INTENT_ANCHOR = Object.freeze({
  schema_version: "intent_anchor_v1",
  initial_message: "Build Entity 360 as a governed context and evidence layer",
  idea: "Entità 360",
  objective: "Context and evidence layer",
  acceptance_criteria: ["tenant isolated", "non authoritative"],
  constraints: ["shadow mode", "no direct execution authority"],
  source: { client_type: "connected_ai", session_id: "session-1" },
  immutable: true,
});
const DIGESTS = Object.freeze({
  intent: entity360Digest(INTENT_ANCHOR),
  intentRevision: causalDigest({ project_id: PROJECT_UUID, genesis_intent_id: GENESIS_ID,
    parent_revision_id: null, alias: INTENT_ALIAS, classification: INTENT_CLASSIFICATION,
    revision_payload: INTENT_REVISION_PAYLOAD }),
  genesis: causalDigest({ project_id: PROJECT_UUID, intent_text: GENESIS_INTENT_TEXT }),
  icf: icfEventDigestV2({ tenantId: TENANT, workId: LEGACY_WORK_ID, seq: 3,
    eventType: ICF_EVENT_TYPE, payload: ICF_EVENT_PAYLOAD, previous: null,
    previousDigestContract: null }),
  security: "d".repeat(64),
  architecture: entity360Digest(WORK_ARCHITECTURE),
  atlasNode: entity360Digest(ATLAS_NODE),
  event: entity360Digest({ tenant_id: TENANT, work_id: LEGACY_WORK_ID,
    sequence_number: 9, event_type: "WORK_UPDATED", payload: WORK_EVENT_PAYLOAD,
    previous_event_hash: null }),
});
const { policy: POLICY, ontology: ONTOLOGY } = loadEntity360Configuration();

function qualificationSignature(payload, purpose) {
  return `hnc_${crypto.createHmac("sha256", QUALIFICATION_SECRET)
    .update(JSON.stringify({ purpose, payload })).digest("hex")}`;
}

const QUALIFICATION_SIGNER = Object.freeze({
  algorithm: "hmac-sha256",
  key_id: "entity360-adapter-test-key-v1",
  sign(payload, { purpose } = {}) { return qualificationSignature(payload, purpose); },
});
const QUALIFICATION_VERIFIER = Object.freeze({
  verify(payload, signature, { purpose, key_id: keyId } = {}) {
    if (keyId !== QUALIFICATION_SIGNER.key_id) return false;
    const expected = Buffer.from(qualificationSignature(payload, purpose));
    const actual = Buffer.from(String(signature || ""));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  },
});

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

function causalBindingProjection(overrides = {}) {
  return {
    tenant_id: TENANT,
    work_id: LEGACY_WORK_ID,
    project_id: PROJECT_UUID,
    genesis_intent_id: GENESIS_ID,
    intent_revision_id: INTENT_REVISION_ID,
    base_state_digest: DIGESTS.event,
    legacy_binding_state: "VERIFIED",
    provenance: structuredClone(CAUSAL_BINDING_PROVENANCE),
    created_at: AT,
    ...overrides,
  };
}

function causalBindingEvent({ resultPatch = {}, eventPatch = {} } = {}) {
  const payload = {
    schema_version: "causal_event_payload_v1",
    result: {
      ...causalBindingProjection(resultPatch),
      legacy_binding: { present: true, state: "VERIFIED", project_uuid: PROJECT_UUID },
    },
  };
  const event = {
    tenant_id: TENANT,
    event_project_uuid: PROJECT_UUID,
    event_id: CAUSAL_EVENT_ID,
    sequence_number: CAUSAL_EVENT_SEQUENCE,
    event_type: "WORK_OPENED",
    operation: "work_bind_intent",
    idempotency_key: "bind-entity360-test",
    request_digest: causalDigest({ operation: "work_bind_intent", work_id: LEGACY_WORK_ID }),
    payload,
    payload_digest: causalDigest(payload),
    actor_provenance: structuredClone(CAUSAL_ACTOR_PROVENANCE),
    actor_provenance_digest: causalDigest(CAUSAL_ACTOR_PROVENANCE),
    previous_event_hash: CAUSAL_PREVIOUS_EVENT_HASH,
    predecessor_event_hash: CAUSAL_PREVIOUS_EVENT_HASH,
    created_at: AT,
    ...eventPatch,
  };
  return { ...event, event_hash: eventPatch.event_hash || buildCausalEventHash({
    tenant_id: event.tenant_id,
    project_id: event.event_project_uuid,
    event_id: event.event_id,
    sequence_number: event.sequence_number,
    event_type: event.event_type,
    operation: event.operation,
    idempotency_key: event.idempotency_key,
    request_digest: event.request_digest,
    payload_digest: event.payload_digest,
    actor_provenance: event.actor_provenance,
    previous_event_hash: event.previous_event_hash,
  }) };
}

function securityObservation() {
  const observation = {
    tenant_id: TENANT,
    observation_id: OBSERVATION_ID,
    project_id: PROJECT_UUID,
    intent_revision_id: INTENT_REVISION_ID,
    work_id: LEGACY_WORK_ID,
    change_id: CHANGE_ID,
    obligation_id: OBLIGATION_ID,
    source: "security-scanner",
    observer_identity: "agent:security-scanner",
    observer_role: "security_verifier",
    provenance: { observer: { actor_id: "agent:security-scanner",
      actor_role: "security_verifier", observer_independence: "INDEPENDENT_SYSTEM" },
      source: { scanner: "security-scanner" } },
    independence: "INDEPENDENT_SYSTEM",
    baseline: { schema_version: "software_security_assessment_v1",
      raw_secret: "must-not-be-copied" },
    freshness_seconds: 60,
    observed_at: AT,
    evidence_digest: DIGESTS.security,
    causal_relation: "OBSERVED_AFTER_ACTION",
    confidence: 0.98,
    contradiction_status: "NONE",
  };
  return { ...observation, observation_digest: projectScopeObservationDigest(observation) };
}

function createFakePool(handler) {
  const queries = [];
  let releases = 0;
  let transactionAborted = false;
  const client = {
    async query(sql, values = []) {
      const statement = String(sql);
      queries.push({ sql: statement, values });
      if (/^ROLLBACK(?: TO SAVEPOINT)?/u.test(statement)) {
        transactionAborted = false;
        return result();
      }
      if (transactionAborted) {
        const error = new Error("current transaction is aborted");
        error.code = "25P02";
        throw error;
      }
      if (/^(BEGIN|COMMIT|SAVEPOINT|RELEASE)/u.test(statement)) return result();
      try {
        return handler(statement, values);
      } catch (error) {
        if (["42P01", "42703"].includes(error?.code)) transactionAborted = true;
        throw error;
      }
    },
    release() { releases += 1; },
  };
  return {
    pool: { async connect() { return client; } },
    queries,
    releaseCount: () => releases,
  };
}

function workRows(sql) {
  if (/FROM tenant_work/u.test(sql)) return result([{
    tenant_id: TENANT,
    work_id: WORK_ID,
    legacy_work_id: LEGACY_WORK_ID,
    work_code: "entity-360",
    work_name: "Entità 360",
    work_type: "architecture",
    project_id: "nyra_conversational_runtime",
    status: "active",
    progress_bp: 4000,
    progress_version: 2,
    progress_source: "governed",
    priority: "high",
    intent_digest: DIGESTS.intent,
    objective: "Context and evidence layer",
    next_action: "shadow validation",
    acceptance_criteria: ["tenant isolated", "non authoritative"],
    updated_at: AT,
    created_at: AT,
  }]);
  if (/FROM core_continuity_works/u.test(sql)) return result([{
    tenant_id: TENANT,
    project_id: "nyra_conversational_runtime",
    project_uuid: PROJECT_UUID,
    work_id: LEGACY_WORK_ID,
    session_id: "session-1",
    parent_work_id: null,
    idea: "Entità 360",
    objective: "Context and evidence layer",
    status: "ACTIVE",
    current_version: 2,
    repository_hash: DIGESTS.architecture,
    policy_hash: DIGESTS.icf,
    live_state_hash: DIGESTS.event,
    next_action: "shadow validation",
    created_at: AT,
    updated_at: AT,
  }]);
  if (/FROM core_continuity_intent_anchors/u.test(sql)) return result([{
    tenant_id: TENANT,
    project_id: "nyra_conversational_runtime",
    intent_digest: DIGESTS.intent,
    anchor: structuredClone(INTENT_ANCHOR),
    created_at: AT,
  }]);
  if (/FROM core_work_causal_bindings/u.test(sql)) return result([{
    tenant_id: TENANT,
    project_uuid: PROJECT_UUID,
    genesis_project_uuid: PROJECT_UUID,
    intent_project_uuid: PROJECT_UUID,
    intent_genesis_intent_id: GENESIS_ID,
    work_id: LEGACY_WORK_ID,
    genesis_intent_id: GENESIS_ID,
    intent_revision_id: INTENT_REVISION_ID,
    base_state_digest: DIGESTS.event,
    genesis_digest: DIGESTS.genesis,
    genesis_intent_text: GENESIS_INTENT_TEXT,
    genesis_created_at: AT,
    intent_revision_digest: DIGESTS.intentRevision,
    intent_parent_revision_id: null,
    intent_alias: INTENT_ALIAS,
    intent_classification: INTENT_CLASSIFICATION,
    intent_revision_payload: structuredClone(INTENT_REVISION_PAYLOAD),
    intent_state: "APPROVED",
    legacy_binding_state: "VERIFIED",
    binding_provenance: structuredClone(CAUSAL_BINDING_PROVENANCE),
    binding_created_at: AT,
    intent_created_at: AT,
    intent_decided_at: AT,
  }]);
  if (/FROM core_causal_event_ledger/u.test(sql)) return result([causalBindingEvent()]);
  if (/FROM core_icf_work/u.test(sql)) return result([{
    tenant_id: TENANT,
    version: 3,
    state: { state: "BOUND" },
    ledger_head_digest: DIGESTS.icf,
    ledger_head_digest_contract: ICF_EVENT_DIGEST_CONTRACT_V2,
    updated_at: AT,
  }]);
  if (/FROM core_icf_event/u.test(sql)) return result([{
    tenant_id: TENANT,
    work_id: LEGACY_WORK_ID,
    seq: 3,
    event_type: ICF_EVENT_TYPE,
    payload: structuredClone(ICF_EVENT_PAYLOAD),
    previous_digest: null,
    digest: DIGESTS.icf,
    digest_contract: ICF_EVENT_DIGEST_CONTRACT_V2,
    canonicalization_version: ICF_EVENT_CANONICALIZATION_V2,
    digest_algorithm: ICF_EVENT_DIGEST_ALGORITHM,
    payload_digest: icfEventPayloadDigestV2(ICF_EVENT_PAYLOAD),
    previous_digest_contract: null,
    created_at: AT,
  }]);
  if (/FROM core_reality_observations/u.test(sql)) return result([securityObservation()]);
  if (/FROM core_continuity_architecture_versions/u.test(sql)) return result([{
    tenant_id: TENANT,
    version: 4,
    architecture_digest: DIGESTS.architecture,
    architecture: structuredClone(WORK_ARCHITECTURE),
    impact_map: { affected: ["context"] },
    created_at: AT,
  }]);
  if (/FROM core_continuity_events/u.test(sql)) return result([{
    tenant_id: TENANT,
    work_id: LEGACY_WORK_ID,
    sequence_number: 9,
    event_hash: DIGESTS.event,
    event_type: "WORK_UPDATED",
    payload: structuredClone(WORK_EVENT_PAYLOAD),
    previous_event_hash: null,
    created_at: AT,
  }]);
  throw new Error(`unexpected_query:${sql}`);
}

async function assembleWork(handler = workRows, asOf = AT, registryOptions = {}) {
  const fake = createFakePool(handler);
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY,
    ...registryOptions });
  const identity = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity });
  const discovery = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity, as_of: asOf });
  return { fake, registry, identity, entityId, discovery };
}

function nsctVerifiedSet({ asOf = AT, heads = null, retrievalMeasurement = null } = {}) {
  const normalizedHeads = heads || [{
    plan_ref: "nyra_precore_plan:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    decision_ref: "nyra_precore_decision:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    decision_digest: "a".repeat(64),
    disposition: "CHALLENGE",
    next_step: "COLLECT_EVIDENCE",
    freshness: { evaluated_at: "2026-08-25T09:59:00.000Z",
      recorded_at: "2026-08-25T09:59:30.000Z",
      fresh_until: "2026-08-25T10:30:00.000Z", state: "fresh" },
    binding_digest: "b".repeat(64),
  }];
  const body = { schema_version: "nyra_precore_verified_as_of_work_v1",
    tenant_scope: TENANT, legacy_work_id: LEGACY_WORK_ID, as_of: asOf,
    heads: normalizedHeads };
  const measurement = retrievalMeasurement || { record_count: normalizedHeads.length,
    storage_bytes: 900 * Math.max(1, normalizedHeads.length),
    payload_bytes: 1_000 * Math.max(1, normalizedHeads.length) };
  return { ...body, status: normalizedHeads.length ? "VERIFIED" : "EMPTY",
    head_set_digest: entity360Digest(body), retrieval_measurement: measurement };
}

function nsctDependency({ value = nsctVerifiedSet(), mode = "ADVISORY", ready = true,
  verifierReady = true, error = null } = {}) {
  const calls = [];
  const store = { mode: "ADVISORY", verification_ready: true,
    async readVerifiedAsOfForWork(input, options) {
      calls.push({ input, options });
      if (error) throw error;
      return structuredClone(value);
    } };
  return { dependency: { store, mode: () => mode, ready: () => ready,
    verifier_ready: () => verifierReady }, calls, store };
}

function snapshotFor({ identity, entityId, discovery }, asOf = AT,
  projectWorkLinkage = discovery.project_work_linkage) {
  return assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
    entity_id: entityId, identity, resolution_candidates: discovery.candidates,
    project_work_linkage: projectWorkLinkage, as_of: asOf, snapshot_version: 1,
    source_contributions: discovery.source_contributions,
    source_discovery: sourceDiscoveryForSnapshot(discovery.source_discovery) },
  { policy: POLICY, ontology: ONTOLOGY, created_at: asOf, require_existing: true,
    adapter_registry_version: ADAPTER_REGISTRY_VERSION,
    qualification_signer: QUALIFICATION_SIGNER });
}

function sourceDiscoveryForSnapshot(sourceDiscovery) {
  return [...sourceDiscovery, { source_id: "entity360_context_assembler", state: "complete",
    consistent_cut: "postgres_repeatable_read" }];
}

test("Work 360 adapters use an exact tenant-bound read-only cut and persist references/digests", async () => {
  const fake = createFakePool(workRows);
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const identity = { work_id: WORK_ID };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity: {
    work_id: WORK_ID,
    legacy_work_id: LEGACY_WORK_ID,
  } });

  const resolution = await registry.resolveCandidates({ tenant_id: TENANT, entity_type: "work", identity });
  assert.deepEqual(resolution.candidates, [{ tenant_id: TENANT, entity_type: "work", identity: {
    work_id: WORK_ID,
    legacy_work_id: LEGACY_WORK_ID,
  } }]);
  assert.deepEqual(resolution.project_work_linkage, {
    work_id: WORK_ID,
    legacy_work_id: LEGACY_WORK_ID,
    project_id: "nyra_conversational_runtime",
    project_uuid: PROJECT_UUID,
  });
  const preAssemblyQueryCount = fake.queries.length;
  const discovery = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity: resolution.candidates[0].identity, as_of: AT });

  assert.equal(discovery.consistent_cut, "postgres_repeatable_read");
  assert.equal(discovery.source_discovery.some((item) =>
    item.source_id === "entity360_context_assembler"), false,
  "the runtime is the sole owner of the assembler cut marker");
  assert.equal(discovery.resolution.entity_id, entityId);
  assert.equal(discovery.execution_authorized, false);
  assert.deepEqual(discovery.project_work_linkage, {
    work_id: WORK_ID,
    legacy_work_id: LEGACY_WORK_ID,
    project_id: "nyra_conversational_runtime",
    project_uuid: PROJECT_UUID,
  });
  assert.deepEqual([...new Set(discovery.source_contributions.map((item) => item.source_id))].sort(), [
    "architecture_map", "event_ledger", "genesis", "icf", "impact_map", "intent",
    "security_intelligence", "work_continuity",
  ]);
  assert.deepEqual(discovery.source_discovery.filter((item) =>
    ["nsct", "shared_memory", "runtime_state", "universal_core"].includes(item.source_id))
    .map((item) => item.source_id).sort(), ["nsct", "runtime_state", "shared_memory", "universal_core"]);
  assert.equal(discovery.source_contributions.every((item) => item.tenant_id === TENANT
    && item.entity_id === entityId && item.evidence_digests.every((digest) => /^[a-f0-9]{64}$/u.test(digest))), true);
  const serialized = JSON.stringify(discovery);
  assert.equal(serialized.includes("must-not-be-copied"), false);
  assert.equal(serialized.includes("raw_secret"), false);
  assert.equal(serialized.includes("baseline_digest"), true);
  const securityContribution = discovery.source_contributions.find((item) =>
    item.source_id === "security_intelligence");
  assert.deepEqual(securityContribution.evidence_digests.toSorted(),
    [DIGESTS.security, securityObservation().observation_digest].toSorted());
  const snapshot = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
    entity_id: entityId, identity: resolution.candidates[0].identity,
    resolution_candidates: resolution.candidates, project_work_linkage: discovery.project_work_linkage,
    as_of: AT, snapshot_version: 1, source_contributions: discovery.source_contributions,
    source_discovery: sourceDiscoveryForSnapshot(discovery.source_discovery) },
  { policy: POLICY, ontology: ONTOLOGY, created_at: AT, require_existing: true,
    adapter_registry_version: ADAPTER_REGISTRY_VERSION,
    qualification_signer: QUALIFICATION_SIGNER });
  assert.equal(snapshot.context_status, "READY");
  assert.equal(snapshot.contradictions.length, 0,
    "the independently digested anchor and Intent revision form one explicit binding");
  const intentContribution = discovery.source_contributions.find((item) => item.source_id === "intent");
  assert.deepEqual(intentContribution.evidence_digests.toSorted(),
    [DIGESTS.intent, DIGESTS.intentRevision, causalBindingEvent().event_hash].toSorted());
  assert.ok(intentContribution.evidence_refs.includes(
    `causal_event:${CAUSAL_EVENT_ID}:${CAUSAL_EVENT_SEQUENCE}`));
  const genesisContribution = discovery.source_contributions.find((item) =>
    item.source_id === "genesis");
  assert.ok(genesisContribution.evidence_digests.includes(causalBindingEvent().event_hash));
  assert.ok(discovery.source_discovery.some((item) => item.source_id === "genesis"
    && item.state === "accepted" && item.evidence_digest === causalBindingEvent().event_hash
    && item.evidence_ref === `causal_event:${CAUSAL_EVENT_ID}:${CAUSAL_EVENT_SEQUENCE}`));
  const causalEvent = causalBindingEvent();
  const eventLedgerContribution = discovery.source_contributions.find((item) =>
    item.source_id === "event_ledger");
  assert.deepEqual(eventLedgerContribution.evidence_digests.toSorted(), [causalEvent.event_hash,
    causalEvent.request_digest, causalEvent.payload_digest,
    causalEvent.actor_provenance_digest].toSorted());
  assert.deepEqual(eventLedgerContribution.facts.map((fact) => fact.value), [{
    event_id: CAUSAL_EVENT_ID,
    sequence_number: CAUSAL_EVENT_SEQUENCE,
    event_type: "WORK_OPENED",
    operation: "work_bind_intent",
    tenant_id: TENANT,
    project_id: PROJECT_UUID,
    work_id: LEGACY_WORK_ID,
    event_hash: causalEvent.event_hash,
    previous_event_hash: CAUSAL_PREVIOUS_EVENT_HASH,
    request_digest: causalEvent.request_digest,
    payload_digest: causalEvent.payload_digest,
    actor_provenance_digest: causalEvent.actor_provenance_digest,
    idempotency_key_digest: causalDigest(causalEvent.idempotency_key),
  }]);
  assert.equal(eventLedgerContribution.adapter_version, "event_ledger_entity360_adapter_v2");
  assert.equal(JSON.stringify(eventLedgerContribution).includes("agent:entity360-test"), false,
    "only the causal actor provenance digest may leave the ledger boundary");
  assert.deepEqual(intentContribution.facts.map((fact) => fact.value), [{
    intent_anchor_digest: DIGESTS.intent,
    intent_revision_id: INTENT_REVISION_ID,
    intent_revision_digest: DIGESTS.intentRevision,
    genesis_intent_id: GENESIS_ID,
  }]);
  const verification = verifyEntity360Snapshot(snapshot, { policy: POLICY, ontology: ONTOLOGY,
    verification_time: snapshot.created_at, qualification_verifier: QUALIFICATION_VERIFIER });
  assert.equal(verification.valid, true, JSON.stringify(verification));

  const domainQueries = fake.queries.filter(({ sql }) =>
    /^\s*(?:SELECT|WITH entity360_raw_rows)/u.test(sql));
  assert.equal(domainQueries.length > 0, true);
  assert.equal(domainQueries.every(({ sql, values }) => values[0] === TENANT
    && /tenant_id\s*=\s*\$1|tenant_id\s*=\$1/u.test(sql)), true);
  const assemblyQueries = fake.queries.slice(preAssemblyQueryCount)
    .filter(({ sql }) => /^\s*(?:SELECT|WITH entity360_raw_rows)/u.test(sql));
  assert.equal(assemblyQueries.every(({ sql, values }) => values.includes(AT)
    && /timestamptz/u.test(sql)), true,
  "every source in the assembly cut must be bounded by the requested as_of");
  assert.equal(fake.queries.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)/u.test(sql)), false);
  assert.equal(fake.queries.some(({ sql }) => /active_intent_revision_id|JOIN core_projects/u.test(sql)), false,
    "the explicit Work causal binding must not follow a mutable project Intent head");
  assert.equal(fake.queries.some(({ sql }) => /FROM core_icf_event/u.test(sql)
    && /created_at <= \$3::timestamptz/u.test(sql)
    && /ORDER BY seq DESC LIMIT 1/u.test(sql)), true,
  "ICF authority must be bound to the exact append-only event head as of the cut");
  assert.equal(fake.queries.some(({ sql }) => /FROM core_causal_event_ledger e/u.test(sql)
    && /e\.event_type='WORK_OPENED'/u.test(sql)
    && /e\.operation='work_bind_intent'/u.test(sql)
    && /predecessor\.sequence_number=e\.sequence_number-1/u.test(sql)), true,
  "causal Work authority must be bound to the append-only WORK_OPENED event and its predecessor");
  assert.equal(fake.queries.some(({ sql }) => /FROM core_continuity_events/u.test(sql)), false,
    "legacy continuity events cannot become a parallel Entity 360 evidence authority");
  assert.equal(fake.queries.filter(({ sql }) => sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY").length, 2);
  assert.equal(fake.queries.filter(({ sql }) => sql === "COMMIT").length, 2);
  assert.equal(fake.releaseCount(), 2);
});

test("causal event observation claims are deterministic under read replay", async () => {
  const first = await assembleWork();
  const second = await assembleWork();
  const claim = (assembled) => assembled.discovery.source_contributions.find((item) =>
    item.source_id === "event_ledger");
  assert.deepEqual(claim(second), claim(first));
  for (const assembled of [first, second]) {
    assert.equal(assembled.fake.queries.some(({ sql }) =>
      /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)/u.test(sql)), false);
  }
});

test("causal event evidence becomes stale at the event-ledger freshness boundary", async () => {
  const asOf = "2026-08-25T11:00:00.001Z";
  const assembled = await assembleWork(workRows, asOf);
  const snapshot = snapshotFor(assembled, asOf, {});
  assert.ok(snapshot.stale_state_references.some((item) =>
    item.fact_id === "work.event_ledger_head"));
  assert.equal(Object.hasOwn(snapshot.current_state, "work.event_ledger_head"), false);
});

test("NSCT v1 uses verified legacy Work heads while preserving the canonical Entity 360 identity", async () => {
  const nsct = nsctDependency();
  const assembled = await assembleWork(workRows, AT, { nsct: nsct.dependency });
  assert.equal(nsct.calls.length, 1);
  assert.deepEqual(nsct.calls[0].input, {
    tenant_id: TENANT, work_id: LEGACY_WORK_ID, as_of: AT,
  });
  assert.equal(typeof nsct.calls[0].options.transaction.query, "function");
  assert.equal(nsct.calls[0].options.limits.max_bytes > 0
    && nsct.calls[0].options.limits.max_bytes <= POLICY.budgets.per_source.default.max_bytes, true);
  assert.equal(nsct.calls[0].options.limits.max_records > 0
    && nsct.calls[0].options.limits.max_records < POLICY.budgets.per_source.default.max_evidence, true);
  const item = assembled.discovery.source_contributions.find((entry) => entry.source_id === "nsct");
  assert.equal(item.entity_id, assembled.entityId);
  assert.equal(item.adapter_version, "nsct_entity360_adapter_v1");
  assert.equal(item.evidence_class, "analysis");
  assert.equal(item.observed_at, "2026-08-25T09:59:00.000Z");
  assert.equal(item.recorded_at, "2026-08-25T09:59:30.000Z");
  assert.deepEqual(item.facts.map((fact) => fact.fact_id), ["nsct.plan_heads"]);
  assert.deepEqual(item.facts[0].value.heads, nsctVerifiedSet().heads);
  assert.equal(item.facts[0].value.head_set_digest, nsctVerifiedSet().head_set_digest);
  assert.equal(item.facts[0].value.set_ref,
    `nsct_head_set:${LEGACY_WORK_ID}:${nsctVerifiedSet().head_set_digest}`);
  assert.equal(JSON.stringify(item.facts[0].value).includes("retrieval_measurement"), false);
  assert.equal(POLICY.source_registry.nsct.authoritative, false);
  assert.equal(POLICY.source_registry.nsct.derived, true);
  const serialized = JSON.stringify(item);
  for (const forbidden of ["summary", "risks", "conditions", "execution_authorized",
    "authority_scope", "core_verdict"]) assert.equal(serialized.includes(forbidden), false);
  const snapshot = snapshotFor(assembled);
  assert.equal(verifyEntity360Snapshot(snapshot, { policy: POLICY, ontology: ONTOLOGY,
    verification_time: snapshot.created_at,
    qualification_verifier: QUALIFICATION_VERIFIER }).valid, true);
});

test("NSCT emits a non-selecting conflict set when more than one plan head exists as_of", async () => {
  const first = nsctVerifiedSet().heads[0];
  const second = { ...structuredClone(first),
    plan_ref: "nyra_precore_plan:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    decision_ref: "nyra_precore_decision:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    decision_digest: "c".repeat(64), binding_digest: "d".repeat(64),
    disposition: "ABSTAIN", next_step: "STOP_AND_REVIEW" };
  const value = nsctVerifiedSet({ heads: [first, second] });
  const nsct = nsctDependency({ value });
  const assembled = await assembleWork(workRows, AT, { nsct: nsct.dependency });
  const item = assembled.discovery.source_contributions.find((entry) => entry.source_id === "nsct");
  assert.equal(item.facts.length, 1);
  assert.equal(item.facts[0].state, "conflicting");
  assert.equal(item.facts[0].value.heads.length, 2);
  assert.ok(assembled.discovery.source_discovery.some((entry) => entry.source_id === "nsct"
    && entry.state === "conflicting" && entry.reason_code === "NSCT_MULTIPLE_PLAN_HEADS_AS_OF"
    && entry.evidence_digest === value.head_set_digest));
  assert.doesNotThrow(() => snapshotFor(assembled));
});

test("NSCT freshness is evaluated at as_of and stale evidence stays advisory", async () => {
  const head = structuredClone(nsctVerifiedSet().heads[0]);
  head.freshness = { evaluated_at: "2026-08-25T09:00:00.000Z",
    recorded_at: "2026-08-25T09:00:30.000Z",
    fresh_until: "2026-08-25T09:30:00.000Z", state: "stale" };
  const value = nsctVerifiedSet({ heads: [head] });
  const assembled = await assembleWork(workRows, AT,
    { nsct: nsctDependency({ value }).dependency });
  const item = assembled.discovery.source_contributions.find((entry) => entry.source_id === "nsct");
  assert.equal(item.facts[0].state, "stale");
  assert.ok(assembled.discovery.source_discovery.some((entry) => entry.source_id === "nsct"
    && entry.state === "stale" && entry.reason_code === "NSCT_EVIDENCE_STALE"
    && entry.valid_to === head.freshness.fresh_until));
  const snapshot = snapshotFor(assembled);
  assert.ok(snapshot.stale_state_references.some((entry) => entry.fact_id === "nsct.plan_heads"));
});

for (const unavailable of [
  { label: "mode OFF", options: { mode: "OFF" }, reason: "NSCT_MODE_NOT_ADVISORY" },
  { label: "store initializing", options: { ready: false }, reason: "NSCT_STORE_NOT_READY" },
  { label: "verifier unavailable", options: { verifierReady: false }, reason: "NSCT_VERIFIER_UNAVAILABLE" },
]) {
  test(`NSCT ${unavailable.label} fails closed before owner retrieval`, async () => {
    const nsct = nsctDependency(unavailable.options);
    const assembled = await assembleWork(workRows, AT, { nsct: nsct.dependency });
    assert.equal(nsct.calls.length, 0);
    assert.equal(assembled.discovery.source_contributions.some((entry) => entry.source_id === "nsct"), false);
    assert.ok(assembled.discovery.source_discovery.some((entry) => entry.source_id === "nsct"
      && entry.state === "unavailable" && entry.reason_code === unavailable.reason));
  });
}

test("NSCT owner verification failure quarantines the source without an advisory fact", async () => {
  const error = new Error("nyra_precore_as_of_verification_failed");
  error.code = "nyra_precore_as_of_verification_failed";
  const nsct = nsctDependency({ error });
  const assembled = await assembleWork(workRows, AT, { nsct: nsct.dependency });
  assert.equal(nsct.calls.length, 1);
  assert.equal(assembled.discovery.source_contributions.some((entry) => entry.source_id === "nsct"), false);
  assert.ok(assembled.discovery.source_discovery.some((entry) => entry.source_id === "nsct"
    && entry.state === "rejected" && entry.reason_code === "NSCT_VERIFICATION_FAILED"));
  assert.doesNotThrow(() => snapshotFor(assembled));
});

test("NSCT owner pre-egress limit uses the residual aggregate trust budget", async () => {
  const aggregatePolicy = structuredClone(POLICY);
  delete aggregatePolicy.policy_digest;
  aggregatePolicy.budgets.per_trust_class.tenant_verified = {
    ...aggregatePolicy.budgets.per_trust_class.default,
    max_bytes: 100_000,
  };
  const nsct = nsctDependency();
  const assembled = await assembleWork(workRows, AT,
    { policy: aggregatePolicy, nsct: nsct.dependency });
  assert.equal(nsct.calls.length, 1);
  assert.equal(nsct.calls[0].options.limits.max_bytes > 0, true);
  assert.equal(nsct.calls[0].options.limits.max_bytes < 100_000, true,
    "prior tenant-verified reads must reduce the owner-side byte gate before NSCT egress");
  assert.ok(assembled.discovery.source_contributions.some((entry) => entry.source_id === "nsct"));
  const nsctReport = assembled.discovery.source_discovery.find((entry) => entry.source_id === "nsct"
    && entry.state === "accepted");
  assert.equal(nsctReport.retrieved_bytes, 1_000,
    "occupancy must consume the exact larger owner storage/payload measurement once");
});

test("NSCT absent store is unavailable and performs no owner retrieval", async () => {
  const assembled = await assembleWork(workRows, AT, { nsct: { mode: "ADVISORY",
    ready: true, verifier_ready: true, store: null } });
  assert.equal(assembled.discovery.source_contributions.some((entry) => entry.source_id === "nsct"), false);
  assert.ok(assembled.discovery.source_discovery.some((entry) => entry.source_id === "nsct"
    && entry.state === "unavailable" && entry.reason_code === "NSCT_STORE_UNAVAILABLE"));
});

test("Software Component 360 resolves exact Atlas identity without vertical kernel logic", async () => {
  const nodeId = "src/app.js#entity360";
  const handler = (sql, values) => {
    assert.deepEqual(values.slice(0, 3), [TENANT, WORK_ID, nodeId]);
    assert.equal(values.length, 5);
    assert.equal(values[3] === null || values[3] === AT, true);
    assert.equal(values[4] > 0 && values[4] <= POLICY.budgets.max_retrieval_bytes, true);
    if (/SELECT tenant_id, node_id/u.test(sql)) return result([{
      tenant_id: TENANT, node_id: nodeId, work_id: WORK_ID,
      project_id: "nyra_conversational_runtime", revision: 7,
    }]);
    if (/SELECT n\.tenant_id/u.test(sql)) return result([{
      tenant_id: TENANT,
      work_id: WORK_ID,
      project_id: "nyra_conversational_runtime",
      ...structuredClone(ATLAS_NODE),
      node_digest: DIGESTS.atlasNode,
      context_bytes: Buffer.byteLength(JSON.stringify(ATLAS_NODE)),
      revision: 7,
      source_digest: DIGESTS.atlasNode,
      updated_at: AT,
      atlas_source_digest: DIGESTS.event,
      node_count: 12,
      revision_created_at: AT,
    }]);
    throw new Error(`unexpected_query:${sql}`);
  };
  const fake = createFakePool(handler);
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const identity = { work_id: WORK_ID, node_id: nodeId };
  const resolution = await registry.resolveCandidates({ tenant_id: TENANT,
    entity_type: "software_component", identity });
  assert.equal(resolution.candidates.length, 1);
  assert.deepEqual(resolution.project_work_linkage, {
    work_id: WORK_ID,
    component_id: nodeId,
    project_id: "nyra_conversational_runtime",
  });
  const entityId = deterministicEntity360Id({ tenant_id: TENANT,
    entity_type: "software_component", identity });
  const discovery = await registry.discover({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "software_component", identity, as_of: AT });
  assert.deepEqual(discovery.project_work_linkage, {
    work_id: WORK_ID,
    component_id: nodeId,
    project_id: "nyra_conversational_runtime",
  });
  assert.deepEqual(discovery.source_contributions[0].facts.map((fact) => fact.fact_id), [
    "component.identity", "component.revision", "component.architecture_state",
  ]);
  const architectureState = discovery.source_contributions[0].facts.find((fact) =>
    fact.fact_id === "component.architecture_state");
  assert.deepEqual(architectureState.value, {
    verification_state: "verified",
    confidence: 0.96,
    node_count: 12,
  });
  assert.equal(fake.queries.some(({ sql }) => /core_continuity_atlas_state/u.test(sql)), false,
    "a historical cut must not read the mutable Atlas head");
  assert.equal(fake.queries.some(({ sql }) => /LEFT JOIN core_continuity_atlas_revision_history h/u.test(sql)
    && /h\.revision = n\.revision/u.test(sql) && /h\.created_at <= \$4::timestamptz/u.test(sql)), true);
  assert.equal(discovery.execution_authorized, false);
});

test("Software Component 360 fails with a machine-readable gap when revision history is only future", async () => {
  const nodeId = "src/app.js#entity360";
  const handler = (sql) => {
    if (/SELECT tenant_id, node_id/u.test(sql)) return result([{
      tenant_id: TENANT, node_id: nodeId, work_id: WORK_ID,
      project_id: "nyra_conversational_runtime", revision: 7,
    }]);
    if (/SELECT n\.tenant_id/u.test(sql)) return result([{
      tenant_id: TENANT,
      work_id: WORK_ID,
      project_id: "nyra_conversational_runtime",
      node_id: nodeId,
      node_kind: "module",
      path: "src/app.js",
      symbol: "entity360",
      node_digest: DIGESTS.architecture,
      revision: 7,
      source_digest: DIGESTS.event,
      verification_state: "verified",
      confidence: 0.96,
      updated_at: AT,
      atlas_source_digest: null,
      node_count: null,
      revision_created_at: null,
    }]);
    throw new Error(`unexpected_query:${sql}`);
  };
  const fake = createFakePool(handler);
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const identity = { work_id: WORK_ID, node_id: nodeId };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT,
    entity_type: "software_component", identity });
  const discovery = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "software_component", identity, as_of: AT });

  assert.deepEqual(discovery.source_contributions, []);
  assert.ok(discovery.source_discovery.some((item) => item.source_id === "architecture_map"
    && item.state === "missing"
    && item.reason_code === "COMPONENT_REVISION_HISTORY_MISSING_AS_OF"));
  assert.equal(fake.queries.some(({ sql }) => /core_continuity_atlas_state/u.test(sql)), false);
});

test("Software Component 360 rejects a verified Atlas row whose node digest is not authoritative", async () => {
  const nodeId = "src/app.js#entity360";
  const handler = (sql) => {
    if (/SELECT tenant_id, node_id/u.test(sql)) return result([{
      tenant_id: TENANT, node_id: nodeId, work_id: WORK_ID,
      project_id: "nyra_conversational_runtime", revision: 7,
    }]);
    if (/SELECT n\.tenant_id/u.test(sql)) return result([{
      tenant_id: TENANT,
      work_id: WORK_ID,
      project_id: "nyra_conversational_runtime",
      ...structuredClone(ATLAS_NODE),
      summary: "tampered summary",
      node_digest: DIGESTS.atlasNode,
      context_bytes: Buffer.byteLength(JSON.stringify(ATLAS_NODE)),
      revision: 7,
      source_digest: DIGESTS.atlasNode,
      updated_at: AT,
      atlas_source_digest: DIGESTS.event,
      node_count: 12,
      revision_created_at: AT,
    }]);
    throw new Error(`unexpected_query:${sql}`);
  };
  const fake = createFakePool(handler);
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const identity = { work_id: WORK_ID, node_id: nodeId };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT,
    entity_type: "software_component", identity });
  const discovery = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "software_component", identity, as_of: AT });

  assert.deepEqual(discovery.source_contributions, []);
  assert.ok(discovery.source_discovery.some((item) => item.source_id === "architecture_map"
    && item.state === "rejected"
    && item.reason_code === "ARCHITECTURE_DIGEST_MISMATCH"));
  assert.equal(JSON.stringify(discovery).includes("tampered summary"), false,
    "the adapter must not admit payload covered by a mismatched node digest");
  const snapshot = assembleEntity360Snapshot({ tenant_id: TENANT,
    entity_type: "software_component", entity_id: entityId, identity,
    resolution_candidates: discovery.candidates,
    project_work_linkage: discovery.project_work_linkage, as_of: AT, snapshot_version: 1,
    source_contributions: discovery.source_contributions,
    source_discovery: sourceDiscoveryForSnapshot(discovery.source_discovery) },
  { policy: POLICY, ontology: ONTOLOGY, created_at: AT, require_existing: true,
    adapter_registry_version: ADAPTER_REGISTRY_VERSION,
    qualification_signer: QUALIFICATION_SIGNER });
  assert.equal(snapshot.context_status, "INCOMPLETE");
  assert.ok(snapshot.missing_context.some((item) =>
    item.requirement_id === "component_revision"));
});

test("Work 360 legacy UUID lookup resolves to the persistent canonical identity", async () => {
  const fake = createFakePool(workRows);
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const canonicalIdentity = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work",
    identity: canonicalIdentity });

  const resolution = await registry.resolveCandidates({ tenant_id: TENANT, entity_type: "work",
    identity: { work_id: LEGACY_WORK_ID } });
  assert.deepEqual(resolution.candidates[0].identity, canonicalIdentity);
  const assembled = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity: { work_id: LEGACY_WORK_ID }, as_of: AT });
  assert.equal(assembled.resolution.status, "RESOLVED");
  assert.equal(assembled.resolution.entity_id, entityId);
  assert.deepEqual(assembled.resolution.identity, canonicalIdentity);
});

test("Gallery and continuity status divergence remains an explicit current-state conflict", async () => {
  const fake = createFakePool((sql) => {
    const response = workRows(sql);
    if (/FROM core_continuity_works/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row, status: "BLOCKED" })));
    }
    return response;
  });
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const identity = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity });
  const discovery = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity, as_of: AT });
  const currentClaims = discovery.source_contributions.flatMap((item) => item.facts || [])
    .filter((fact) => fact.fact_id === "work.current_state");
  assert.deepEqual(currentClaims.map((fact) => fact.value.status).sort(), ["ACTIVE", "BLOCKED"]);

  const snapshot = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
    entity_id: entityId, identity, resolution_candidates: discovery.candidates,
    project_work_linkage: discovery.project_work_linkage, as_of: AT, snapshot_version: 1,
    source_contributions: discovery.source_contributions,
    source_discovery: sourceDiscoveryForSnapshot(discovery.source_discovery) },
  { policy: POLICY, ontology: ONTOLOGY, created_at: AT, require_existing: true,
    adapter_registry_version: ADAPTER_REGISTRY_VERSION,
    qualification_signer: QUALIFICATION_SIGNER });
  assert.equal(snapshot.context_status, "CONFLICTED");
  assert.ok(snapshot.contradictions.some((item) => item.fact_id === "work.current_state"
    && item.reason_code === "CONCURRENT_CURRENT_VALUES_CONFLICT"));
  assert.deepEqual(snapshot.core_review_requirement.admissible_outcomes, ["HOLD"]);
});

test("Work state reconciliation preserves independent Gallery and continuity timestamps", async () => {
  const staleAt = "2026-08-25T08:00:00.000Z";
  const fake = createFakePool((sql) => {
    const response = workRows(sql);
    if (/FROM core_continuity_works/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row, status: "BLOCKED", updated_at: staleAt })));
    }
    return response;
  });
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const identity = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity });
  const discovery = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity, as_of: AT });
  const currentClaims = discovery.source_contributions.flatMap((item) => item.facts || [])
    .filter((fact) => fact.fact_id === "work.current_state")
    .sort((left, right) => left.value.status.localeCompare(right.value.status));
  assert.deepEqual(currentClaims.map((fact) => ({ status: fact.value.status,
    observed_at: fact.observed_at, recorded_at: fact.recorded_at })), [
    { status: "ACTIVE", observed_at: AT, recorded_at: AT },
    { status: "BLOCKED", observed_at: staleAt, recorded_at: staleAt },
  ]);

  const snapshot = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
    entity_id: entityId, identity, resolution_candidates: discovery.candidates,
    project_work_linkage: discovery.project_work_linkage, as_of: AT, snapshot_version: 1,
    source_contributions: discovery.source_contributions,
    source_discovery: sourceDiscoveryForSnapshot(discovery.source_discovery) },
  { policy: POLICY, ontology: ONTOLOGY, created_at: AT, require_existing: true,
    adapter_registry_version: ADAPTER_REGISTRY_VERSION,
    qualification_signer: QUALIFICATION_SIGNER });
  assert.equal(snapshot.context_status, "READY");
  assert.equal(snapshot.contradictions.some((item) => item.fact_id === "work.current_state"), false);
  assert.ok(snapshot.stale_state_references.some((item) => item.fact_id === "work.current_state"));
  assert.equal(snapshot.current_state["work.current_state"].value.status, "ACTIVE");
});

test("adapter rejects any cross-tenant row even when the database predicate is tenant-bound", async () => {
  const fake = createFakePool((sql) => /FROM tenant_work/u.test(sql)
    ? result([{ tenant_id: OTHER_TENANT, work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID }])
    : result());
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  await assert.rejects(registry.resolveCandidates({ tenant_id: TENANT, entity_type: "work",
    identity: { work_id: WORK_ID } }), (error) => error.code === "entity360_adapter_cross_tenant_row"
      && error.status === 403);
  assert.equal(fake.queries.some(({ sql }) => sql === "ROLLBACK"), true);
  assert.equal(fake.queries.some(({ sql }) => sql === "COMMIT"), false);
  assert.equal(fake.releaseCount(), 1);
});

test("missing optional source schema becomes a machine-readable gap; other database faults fail closed", async () => {
  const missing = createFakePool((sql) => {
    if (/FROM tenant_work/u.test(sql)) {
      const error = new Error("missing tenant_work");
      error.code = "42P01";
      throw error;
    }
    if (/FROM core_continuity_works/u.test(sql)) return result();
    if (/FROM core_work_causal_bindings/u.test(sql)) return result();
    throw new Error(`unexpected_query:${sql}`);
  });
  const registry = createPostgresEntity360AdapterRegistry({ pool: missing.pool, policy: POLICY });
  const resolution = await registry.resolveCandidates({ tenant_id: TENANT, entity_type: "work",
    identity: { work_id: WORK_ID } });
  assert.deepEqual(resolution.candidates, []);
  assert.deepEqual(resolution.source_discovery, [
    { source_id: "work_continuity", state: "unavailable",
      reason_code: "SOURCE_SCHEMA_UNAVAILABLE" },
    { source_id: "genesis", state: "missing", reason_code: "CAUSAL_BINDING_MISSING" },
  ]);
  const optionalRecovery = missing.queries.map(({ sql }) => sql);
  assert.equal(optionalRecovery[1], "SAVEPOINT entity360_optional_query");
  assert.match(optionalRecovery[2], /FROM tenant_work/u);
  assert.equal(optionalRecovery[3], "ROLLBACK TO SAVEPOINT entity360_optional_query");
  assert.equal(optionalRecovery[4], "RELEASE SAVEPOINT entity360_optional_query");
  assert.equal(optionalRecovery[5], "SAVEPOINT entity360_optional_query");
  assert.match(optionalRecovery[6], /FROM core_continuity_works/u);
  assert.equal(optionalRecovery[7], "RELEASE SAVEPOINT entity360_optional_query");
  assert.equal(missing.queries.some(({ sql }) => sql === "COMMIT"), true);

  const broken = createFakePool(() => {
    const error = new Error("connection terminated");
    error.code = "08006";
    throw error;
  });
  const brokenRegistry = createPostgresEntity360AdapterRegistry({ pool: broken.pool,
    policy: POLICY });
  await assert.rejects(brokenRegistry.resolveCandidates({ tenant_id: TENANT, entity_type: "work",
    identity: { work_id: WORK_ID } }), /connection terminated/u);
  assert.equal(broken.queries.some(({ sql }) => sql === "ROLLBACK"), true);
});

test("partial composite-source outage quarantines its whole batch and remains assemblable", async () => {
  let continuityReads = 0;
  const continuityPartial = await assembleWork((sql, values) => {
    if (/FROM core_continuity_works/u.test(sql) && ++continuityReads === 2) {
      const error = new Error("continuity detail schema unavailable");
      error.code = "42703";
      throw error;
    }
    return workRows(sql, values);
  });
  assert.equal(continuityPartial.discovery.source_contributions.some((item) =>
    item.source_id === "work_continuity"), false);
  const continuityGap = continuityPartial.discovery.source_discovery.filter((item) =>
    item.source_id === "work_continuity");
  assert.equal(continuityGap.length, 1);
  assert.equal(continuityGap[0].state, "unavailable");
  assert.equal(continuityGap[0].reason_code, "SOURCE_SCHEMA_UNAVAILABLE");
  assert.equal(continuityGap[0].retrieved_bytes > 0, true);
  assert.equal(continuityGap[0].retrieval_budget_bytes > 0, true);
  const continuitySnapshot = snapshotFor(continuityPartial);
  assert.equal(continuitySnapshot.context_status, "INCOMPLETE");
  assert.equal(continuitySnapshot.missing_context.some((item) =>
    item.fact_id === "work.identity"), true);

  const icfPartial = await assembleWork((sql, values) => {
    if (/FROM core_icf_event/u.test(sql)) {
      const error = new Error("icf event schema unavailable");
      error.code = "42P01";
      throw error;
    }
    return workRows(sql, values);
  });
  assert.equal(icfPartial.discovery.source_contributions.some((item) => item.source_id === "icf"), false);
  const icfGap = icfPartial.discovery.source_discovery.filter((item) =>
    item.source_id === "icf");
  assert.equal(icfGap.length, 1);
  assert.equal(icfGap[0].state, "unavailable");
  assert.equal(icfGap[0].reason_code, "SOURCE_SCHEMA_UNAVAILABLE");
  assert.equal(icfGap[0].retrieved_bytes > 0, true);
  assert.equal(icfGap[0].retrieval_budget_bytes > 0, true);
  const icfSnapshot = snapshotFor(icfPartial);
  assert.equal(icfSnapshot.context_status, "INCOMPLETE");
  assert.equal(icfSnapshot.missing_context.some((item) =>
    item.fact_id === "governance.icf.binding"), true);
});

test("Work acceptance criteria are represented only by digest and count", async () => {
  const assembled = await assembleWork((sql, values) => {
    const value = workRows(sql, values);
    if (/FROM tenant_work/u.test(sql) && value.rows[0]) {
      value.rows[0].acceptance_criteria = [{ allow: true, core_verdict: "ALLOW",
        authority: "universal_core", note: "tenant-controlled" }];
    }
    return value;
  });
  const fact = assembled.discovery.source_contributions
    .find((item) => item.source_id === "work_continuity")?.facts
    .find((item) => item.fact_id === "work.acceptance_criteria");
  assert.deepEqual(fact.value, {
    criteria_digest: entity360Digest([{ allow: true, core_verdict: "ALLOW",
      authority: "universal_core", note: "tenant-controlled" }]),
    item_count: 1,
  });
  assert.equal(JSON.stringify(fact.value).includes("core_verdict"), false);
  assert.doesNotThrow(() => snapshotFor(assembled));
});

test("raw Gallery and Architecture payloads are rejected at the policy-bound SQL retrieval guard", async () => {
  const oversized = "x".repeat(POLICY.budgets.per_source.default.max_bytes + 32_768);
  const galleryFlood = await assembleWork((sql, values) => {
    const response = workRows(sql, values);
    if (/FROM tenant_work/u.test(sql) && /acceptance_criteria/u.test(sql)
      && response.rows[0]) response.rows[0].acceptance_criteria = [oversized];
    return response;
  });
  assert.equal(galleryFlood.discovery.source_contributions.some((item) =>
    item.source_id === "work_continuity"), false);
  const galleryGap = galleryFlood.discovery.source_discovery.find((item) =>
    item.source_id === "work_continuity"
      && item.reason_code === "SOURCE_RETRIEVAL_BUDGET_EXCEEDED");
  assert.equal(galleryGap.state, "rejected");
  assert.equal(galleryGap.attempted_retrieval_bytes > galleryGap.retrieval_budget_bytes, true);
  const galleryBoundedQuery = galleryFlood.fake.queries.find(({ sql, values }) =>
    /entity360_encoded_rows/u.test(sql)
      && /FROM tenant_work/u.test(sql)
      && values.at(-1) <= POLICY.budgets.per_source.default.max_bytes);
  assert.ok(galleryBoundedQuery);
  assert.match(galleryBoundedQuery.sql,
    /CASE WHEN entity360_retrieval_total\.storage_bytes <=/u);
  assert.match(galleryBoundedQuery.sql,
    /entity360_retrieval_total\.storage_bytes AS entity360_storage_bytes/u);

  const architectureFlood = await assembleWork((sql, values) => {
    const response = workRows(sql, values);
    if (/FROM core_continuity_architecture_versions/u.test(sql) && response.rows[0]) {
      response.rows[0].architecture = { oversized };
    }
    return response;
  });
  assert.equal(architectureFlood.discovery.source_contributions.some((item) =>
    item.source_id === "architecture_map" || item.source_id === "impact_map"), false);
  const architectureGap = architectureFlood.discovery.source_discovery.find((item) =>
    item.source_id === "architecture_map"
      && item.reason_code === "SOURCE_RETRIEVAL_BUDGET_EXCEEDED");
  assert.equal(architectureGap.state, "rejected");
  assert.equal(architectureGap.attempted_retrieval_bytes
    > architectureGap.retrieval_budget_bytes, true);
  assert.equal(architectureFlood.fake.queries.some(({ sql }) =>
    /pg_column_size\(entity360_raw_rows\)/u.test(sql)
      && /entity360_pre_gated_rows/u.test(sql)), true);
});

test("raw retrieval budgets aggregate across source and trust classes", async () => {
  const aggregatePolicy = structuredClone(POLICY);
  delete aggregatePolicy.policy_digest;
  aggregatePolicy.budgets.per_source.default.max_bytes = 196_608;
  aggregatePolicy.budgets.per_source_class.governance = {
    ...aggregatePolicy.budgets.per_source_class.default,
    max_bytes: 225_280,
  };
  aggregatePolicy.budgets.per_trust_class.core_verified = {
    ...aggregatePolicy.budgets.per_trust_class.default,
    max_bytes: 225_280,
  };
  const intentFlood = "i".repeat(131_072);
  const genesisFlood = "g".repeat(131_072);
  const fake = createFakePool((sql, values) => {
    const response = workRows(sql, values);
    if (/FROM core_continuity_intent_anchors/u.test(sql) && response.rows[0]) {
      response.rows[0].anchor = { ...response.rows[0].anchor, padding: intentFlood };
    }
    if (/FROM core_work_causal_bindings/u.test(sql) && response.rows[0]) {
      response.rows[0].genesis_intent_text = genesisFlood;
    }
    return response;
  });
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool,
    policy: aggregatePolicy });
  const identity = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity });
  const discovery = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity, as_of: AT });
  const firstGovernanceRead = discovery.source_discovery.find((item) => item.source_id === "genesis"
    && item.retrieved_bytes > 100_000);
  const aggregateGap = discovery.source_discovery.find((item) => item.source_id === "intent"
    && item.reason_code === "SOURCE_RETRIEVAL_BUDGET_EXCEEDED");
  assert.ok(firstGovernanceRead, JSON.stringify(discovery.source_discovery));
  assert.ok(aggregateGap, JSON.stringify(discovery.source_discovery));
  assert.equal(aggregateGap.attempted_retrieval_bytes < aggregateGap.retrieval_budget_bytes, true,
    "the second source fits its own cap and is rejected only by the aggregate class/trust cap");
  assert.equal(discovery.source_contributions.some((item) => item.source_id === "intent"), false);
});

test("ICF canonical v2 remains verifiable after jsonb reorders zeta/alpha keys", async () => {
  const jsonbOrderedPayload = {
    alpha: [{ alpha: 1, zeta: 2 }, "BOUND"],
    zeta: { alpha: "first", zeta: "last" },
  };
  assert.equal(icfEventPayloadDigestV2(jsonbOrderedPayload),
    icfEventPayloadDigestV2(ICF_EVENT_PAYLOAD));
  const assembled = await assembleWork((sql, values) => {
    const response = workRows(sql, values);
    if (/FROM core_icf_event/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row, payload: jsonbOrderedPayload })));
    }
    return response;
  });
  assert.ok(assembled.discovery.source_contributions.some((item) =>
    item.source_id === "icf" && item.adapter_version === "icf_entity360_adapter_v2"));
  assert.equal(snapshotFor(assembled).context_status, "READY");
});

test("a stale verified ICF head remains stale instead of inheriting snapshot freshness", async () => {
  const later = "2026-08-27T10:00:00.000Z";
  const assembled = await assembleWork((sql, values) => {
    const response = workRows(sql, values);
    if (/FROM tenant_work|FROM core_continuity_works/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row, updated_at: later })));
    }
    return response;
  }, later);
  const icfContribution = assembled.discovery.source_contributions.find((item) =>
    item.source_id === "icf");
  assert.equal(icfContribution.observed_at, AT);
  assert.equal(icfContribution.recorded_at, AT);
  assert.equal(icfContribution.facts[0].observed_at, AT);

  const snapshot = snapshotFor(assembled, later);
  assert.equal(snapshot.context_status, "INCOMPLETE");
  assert.ok(snapshot.stale_state_references.some((item) =>
    item.fact_id === "governance.icf.binding"));
  assert.ok(snapshot.missing_context.some((item) =>
    item.requirement_id === "work_icf_binding"
      && item.reason_codes.includes("ONLY_STALE_EVIDENCE_AVAILABLE")));
  assert.deepEqual(snapshot.core_review_requirement.admissible_outcomes,
    ["INSUFFICIENT_CONTEXT", "HOLD"]);
});

test("mutable ICF work state cannot alter the evidence-bound head fact", async () => {
  const assembled = await assembleWork((sql, values) => {
    const response = workRows(sql, values);
    if (/FROM core_icf_work/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row,
        state: { state: "TAMPERED_WITHOUT_A_NEW_EVENT" } })));
    }
    return response;
  });
  const icfContribution = assembled.discovery.source_contributions.find((item) =>
    item.source_id === "icf");
  assert.deepEqual(icfContribution.facts[0].value, {
    ledger_head_digest: DIGESTS.icf,
    version: 3,
  });
  assert.equal(Object.hasOwn(icfContribution.facts[0].value, "state_digest"), false);
  assert.equal(JSON.stringify(icfContribution).includes("TAMPERED_WITHOUT_A_NEW_EVENT"), false);
  const icfWorkRead = assembled.fake.queries.find(({ sql }) => /FROM core_icf_work/u.test(sql));
  assert.doesNotMatch(icfWorkRead.sql, /SELECT[^]*\bstate\b[^]*FROM core_icf_work/iu);
  assert.equal(snapshotFor(assembled).context_status, "READY");
});

test("Work project linkage divergence is explicit, non-selecting and forces HOLD", async () => {
  const alternateProject = "alternate_project";
  const fake = createFakePool((sql) => {
    const response = workRows(sql);
    if (/FROM core_continuity_works/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row, project_id: alternateProject })));
    }
    return response;
  });
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const identity = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity });

  const resolution = await registry.resolveCandidates({ tenant_id: TENANT,
    entity_type: "work", identity });
  assert.equal(resolution.project_work_linkage.project_id, null);
  assert.ok(resolution.source_discovery.some((item) => item.state === "conflicting"
    && item.reason_code === "WORK_PROJECT_LINKAGE_CONFLICT"
    && item.project_slug_candidates.includes("nyra_conversational_runtime")
    && item.project_slug_candidates.includes(alternateProject)));

  const discovery = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity, as_of: AT });
  assert.deepEqual(discovery.project_work_linkage, {
    work_id: WORK_ID,
    legacy_work_id: LEGACY_WORK_ID,
    project_id: null,
    project_uuid: null,
  });
  const snapshot = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
    entity_id: entityId, identity, resolution_candidates: discovery.candidates,
    project_work_linkage: discovery.project_work_linkage, as_of: AT, snapshot_version: 1,
    source_contributions: discovery.source_contributions,
    source_discovery: sourceDiscoveryForSnapshot(discovery.source_discovery) },
  { policy: POLICY, ontology: ONTOLOGY, created_at: AT, require_existing: true,
    adapter_registry_version: ADAPTER_REGISTRY_VERSION,
    qualification_signer: QUALIFICATION_SIGNER });
  assert.equal(snapshot.context_status, "CONFLICTED");
  assert.ok(snapshot.contradictions.some((item) => item.fact_id === "work.identity"
    && item.blocking === true));
  assert.deepEqual(snapshot.core_review_requirement.admissible_outcomes, ["HOLD"]);
  assert.equal(verifyEntity360Snapshot(snapshot, { policy: POLICY, ontology: ONTOLOGY,
    verification_time: snapshot.created_at,
    qualification_verifier: QUALIFICATION_VERIFIER }).valid, true);
});

test("continuity cannot synthesize a Work candidate when canonical Gallery identity is absent", async () => {
  const handler = (sql) => /FROM tenant_work/u.test(sql) ? result([]) : workRows(sql);
  const fake = createFakePool(handler);
  const registry = createPostgresEntity360AdapterRegistry({ pool: fake.pool, policy: POLICY });
  const identity = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity });

  const resolution = await registry.resolveCandidates({ tenant_id: TENANT,
    entity_type: "work", identity });
  assert.deepEqual(resolution.candidates, []);
  assert.deepEqual(resolution.project_work_linkage, {});
  assert.ok(resolution.source_discovery.some((item) =>
    item.reason_code === "CANONICAL_GALLERY_IDENTITY_REQUIRED"));
  const assembled = await registry.assembleContext({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity, as_of: AT });
  assert.equal(assembled.resolution.status, "UNRESOLVED");
  assert.deepEqual(assembled.source_contributions, []);
  const direct = await registry.discover({ tenant_id: TENANT, entity_id: entityId,
    entity_type: "work", identity, as_of: AT });
  assert.deepEqual(direct.source_contributions, []);
  assert.deepEqual(direct.project_work_linkage, {});
});

for (const invalidCausal of [
  { label: "unverified", patch: { legacy_binding_state: "UNRESOLVED_LEGACY_BINDING" },
    reason: "CAUSAL_LEGACY_BINDING_UNVERIFIED" },
  { label: "rejected", patch: { legacy_binding_state: "REJECTED" },
    reason: "CAUSAL_LEGACY_BINDING_UNVERIFIED" },
  { label: "unapproved", patch: { intent_state: "PROPOSED" },
    reason: "CAUSAL_INTENT_REVISION_NOT_APPROVED" },
]) {
  test(`${invalidCausal.label} causal binding cannot authorize Intent or Genesis context`, async () => {
    const assembled = await assembleWork((sql) => {
      const response = workRows(sql);
      if (/FROM core_work_causal_bindings/u.test(sql)) {
        return result(response.rows.map((row) => ({ ...row, ...invalidCausal.patch })));
      }
      return response;
    });
    const governanceSources = assembled.discovery.source_contributions
      .filter((item) => ["intent", "genesis"].includes(item.source_id));
    assert.deepEqual(governanceSources, []);
    assert.ok(assembled.discovery.source_discovery.some((item) =>
      item.reason_code === invalidCausal.reason));
    const snapshot = snapshotFor(assembled);
    assert.equal(snapshot.context_status, "INCOMPLETE");
    assert.deepEqual(snapshot.core_review_requirement.admissible_outcomes,
      ["INSUFFICIENT_CONTEXT", "HOLD"]);
  });
}

test("a continuity-to-causal project UUID mismatch is machine-readable and non-authoritative", async () => {
  const alternateUuid = "66666666-6666-4666-8666-666666666666";
  const assembled = await assembleWork((sql) => {
    const response = workRows(sql);
    if (/FROM core_work_causal_bindings/u.test(sql)) return result(response.rows.map((row) => ({
      ...row,
      project_uuid: alternateUuid,
      genesis_project_uuid: alternateUuid,
      intent_project_uuid: alternateUuid,
    })));
    return response;
  });

  assert.equal(assembled.discovery.project_work_linkage.project_id,
    "nyra_conversational_runtime");
  assert.equal(assembled.discovery.project_work_linkage.project_uuid, null);
  assert.ok(assembled.discovery.source_discovery.some((item) =>
    item.reason_code === "WORK_PROJECT_UUID_BINDING_MISMATCH"
    && item.continuity_project_uuid === PROJECT_UUID
    && item.causal_project_uuid === alternateUuid));
  assert.equal(assembled.discovery.source_contributions.some((item) =>
    ["intent", "genesis"].includes(item.source_id)), false);
  const snapshot = snapshotFor(assembled);
  assert.equal(snapshot.context_status, "INCOMPLETE");
  assert.deepEqual(snapshot.core_review_requirement.admissible_outcomes,
    ["INSUFFICIENT_CONTEXT", "HOLD"]);
});

for (const invalidGraph of [
  { label: "anchor slug", source: "anchor", reason: "INTENT_ANCHOR_PROJECT_SLUG_MISMATCH" },
  { label: "causal authority graph", source: "causal", reason: "CAUSAL_AUTHORITY_GRAPH_MISMATCH" },
]) {
  test(`a mismatched ${invalidGraph.label} cannot produce authoritative governance facts`, async () => {
    const alternateUuid = "66666666-6666-4666-8666-666666666666";
    const assembled = await assembleWork((sql) => {
      const response = workRows(sql);
      if (invalidGraph.source === "anchor" && /FROM core_continuity_intent_anchors/u.test(sql)) {
        return result(response.rows.map((row) => ({ ...row, project_id: "wrong_project_slug" })));
      }
      if (invalidGraph.source === "causal" && /FROM core_work_causal_bindings/u.test(sql)) {
        return result(response.rows.map((row) => ({ ...row, genesis_project_uuid: alternateUuid })));
      }
      return response;
    });
    const gap = assembled.discovery.source_discovery.find((item) =>
      item.reason_code === invalidGraph.reason);
    assert.ok(gap);
    if (invalidGraph.source === "anchor") {
      assert.equal(gap.expected_project_slug, "nyra_conversational_runtime");
      assert.equal(gap.observed_project_slug, "wrong_project_slug");
    }
    assert.equal(assembled.discovery.source_contributions.some((item) =>
      ["intent", "genesis"].includes(item.source_id)), false);
    assert.equal(snapshotFor(assembled).context_status, "INCOMPLETE");
    if (invalidGraph.source === "causal") {
      assert.ok(assembled.fake.queries.some(({ sql }) => /g\.project_id=b\.project_id/u.test(sql)
        && /i\.project_id=b\.project_id/u.test(sql)
        && /i\.genesis_intent_id=b\.genesis_intent_id/u.test(sql)));
    }
  });
}

test("a mutable Work projection retargeted to another valid approved Intent is rejected", async () => {
  const replacementIntentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const replacementAlias = "entity-360-replacement";
  const replacementPayload = {
    ...structuredClone(INTENT_REVISION_PAYLOAD),
    motivation: "A second independently valid approved revision",
  };
  const replacementDigest = causalDigest({ project_id: PROJECT_UUID,
    genesis_intent_id: GENESIS_ID, parent_revision_id: null, alias: replacementAlias,
    classification: INTENT_CLASSIFICATION, revision_payload: replacementPayload });
  const assembled = await assembleWork((sql) => {
    const response = workRows(sql);
    if (/FROM core_work_causal_bindings/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row,
        intent_revision_id: replacementIntentId,
        intent_alias: replacementAlias,
        intent_revision_payload: replacementPayload,
        intent_revision_digest: replacementDigest,
        intent_state: "APPROVED",
      })));
    }
    return response;
  });

  assert.equal(assembled.discovery.source_contributions.some((item) =>
    ["intent", "genesis"].includes(item.source_id)), false);
  assert.ok(assembled.discovery.source_discovery.some((item) => item.source_id === "genesis"
    && item.state === "rejected" && item.reason_code === "CAUSAL_BINDING_EVENT_MISMATCH"));
  const snapshot = snapshotFor(assembled);
  assert.equal(snapshot.context_status, "INCOMPLETE");
  assert.deepEqual(snapshot.core_review_requirement.admissible_outcomes,
    ["INSUFFICIENT_CONTEXT", "HOLD"]);
});

for (const invalidEvent of [
  { label: "missing", rows: () => [] },
  { label: "ambiguous", rows: () => [causalBindingEvent(), causalBindingEvent({
    eventPatch: { event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  })] },
  { label: "broken predecessor link", rows: () => [causalBindingEvent({
    eventPatch: { predecessor_event_hash: "e".repeat(64) },
  })] },
  { label: "actor provenance digest mismatch", rows: () => [causalBindingEvent({
    eventPatch: { actor_provenance_digest: "a".repeat(64) },
  })] },
  { label: "event hash mismatch", rows: () => [causalBindingEvent({
    eventPatch: { event_hash: "a".repeat(64) },
  })] },
  { label: "cross-tenant event", expected_error: "entity360_adapter_cross_tenant_row", rows: () => [causalBindingEvent({
    eventPatch: { tenant_id: OTHER_TENANT },
  })] },
  { label: "cross-project event", rows: () => [causalBindingEvent({
    eventPatch: { event_project_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  })] },
  { label: "cross-Work event", rows: () => [causalBindingEvent({
    resultPatch: { work_id: WORK_ID },
  })] },
  { label: "recorded after as-of", asOf: "2026-08-25T10:30:00.000Z", rows: () => [causalBindingEvent({
    eventPatch: { created_at: "2026-08-25T10:30:00.001Z" },
  })] },
  { label: "extra authority field", rows: () => [causalBindingEvent({
    resultPatch: { authority_escalation: "forged" },
  })] },
]) {
  test(`${invalidEvent.label} causal binding event cannot authorize governance context`, async () => {
    const assemble = () => assembleWork((sql) => {
      if (/FROM core_causal_event_ledger/u.test(sql)) return result(invalidEvent.rows());
      return workRows(sql);
    }, invalidEvent.asOf || AT);
    if (invalidEvent.expected_error) {
      await assert.rejects(assemble(), (error) => error?.code === invalidEvent.expected_error);
      return;
    }
    const assembled = await assemble();

    assert.equal(assembled.discovery.source_contributions.some((item) =>
      ["intent", "genesis"].includes(item.source_id)), false);
    assert.equal(assembled.discovery.source_contributions.some((item) =>
      item.source_id === "event_ledger"), false);
    assert.ok(assembled.discovery.source_discovery.some((item) => item.source_id === "genesis"
      && item.state === "rejected" && item.reason_code === "CAUSAL_BINDING_EVENT_MISMATCH"));
    assert.ok(assembled.discovery.source_discovery.some((item) => item.source_id === "event_ledger"
      && item.state === "rejected" && item.reason_code === "CAUSAL_BINDING_EVENT_MISMATCH"));
    assert.equal(JSON.stringify(assembled.discovery).includes("authority_escalation"), false);
    assert.equal(snapshotFor(assembled, invalidEvent.asOf || AT).context_status, "INCOMPLETE");
  });
}

for (const invalidDigest of [
  {
    label: "Genesis payload",
    patch: { genesis_intent_text: `${GENESIS_INTENT_TEXT} (tampered)` },
    reason: "CAUSAL_GENESIS_DIGEST_MISMATCH",
  },
  {
    label: "Intent revision payload",
    patch: { intent_revision_payload: {
      ...structuredClone(INTENT_REVISION_PAYLOAD), motivation: "poisoned motivation",
    } },
    reason: "CAUSAL_INTENT_DIGEST_MISMATCH",
  },
]) {
  test(`a tampered ${invalidDigest.label} cannot produce authoritative governance facts`, async () => {
    const assembled = await assembleWork((sql) => {
      const response = workRows(sql);
      if (/FROM core_work_causal_bindings/u.test(sql)) {
        return result(response.rows.map((row) => ({ ...row, ...invalidDigest.patch })));
      }
      return response;
    });

    assert.equal(assembled.discovery.source_contributions.some((item) =>
      ["intent", "genesis"].includes(item.source_id)), false);
    assert.ok(assembled.discovery.source_discovery.some((item) =>
      item.state === "rejected" && item.reason_code === invalidDigest.reason));
    assert.equal(JSON.stringify(assembled.discovery).includes("poisoned motivation"), false);
    assert.equal(snapshotFor(assembled).context_status, "INCOMPLETE");
  });
}

for (const invalidAnchor of [
  {
    label: "tampered payload",
    anchor: { ...structuredClone(INTENT_ANCHOR), objective: "poisoned objective" },
    digest: DIGESTS.intent,
    galleryDigest: DIGESTS.intent,
  },
  {
    label: "self-digested mutable payload",
    anchor: { ...structuredClone(INTENT_ANCHOR), immutable: false },
  },
]) {
  test(`Intent ${invalidAnchor.label} cannot produce authoritative governance facts`, async () => {
    const invalidDigest = invalidAnchor.digest || entity360Digest(invalidAnchor.anchor);
    const galleryDigest = invalidAnchor.galleryDigest || invalidDigest;
    const assembled = await assembleWork((sql) => {
      const response = workRows(sql);
      if (/FROM tenant_work/u.test(sql)) {
        return result(response.rows.map((row) => ({ ...row, intent_digest: galleryDigest })));
      }
      if (/FROM core_continuity_intent_anchors/u.test(sql)) {
        return result(response.rows.map((row) => ({ ...row,
          anchor: structuredClone(invalidAnchor.anchor), intent_digest: invalidDigest })));
      }
      return response;
    });

    assert.equal(assembled.discovery.source_contributions.some((item) =>
      ["intent", "genesis"].includes(item.source_id)), false);
    assert.ok(assembled.discovery.source_discovery.some((item) => item.source_id === "intent"
      && item.state === "rejected" && item.reason_code === "INTENT_ANCHOR_DIGEST_MISMATCH"));
    assert.equal(snapshotFor(assembled).context_status, "INCOMPLETE");
  });
}

for (const invalidSource of [
  {
    label: "Architecture Map payload",
    sourceId: "architecture_map",
    reason: "ARCHITECTURE_DIGEST_MISMATCH",
    query: /FROM core_continuity_architecture_versions/u,
    patch: { architecture: { components: ["poisoned-component"] } },
    forbidden: "poisoned-component",
  },
]) {
  test(`a tampered ${invalidSource.label} is rejected before context assembly`, async () => {
    const assembled = await assembleWork((sql) => {
      const response = workRows(sql);
      if (invalidSource.query.test(sql)) {
        return result(response.rows.map((row) => ({ ...row, ...invalidSource.patch })));
      }
      return response;
    });

    assert.equal(assembled.discovery.source_contributions.some((item) =>
      item.source_id === invalidSource.sourceId), false);
    if (invalidSource.sourceId === "architecture_map") {
      assert.equal(assembled.discovery.source_contributions.some((item) =>
        item.source_id === "impact_map"), false,
      "Impact Map cannot be derived from an unverified Architecture Map row");
    }
    assert.ok(assembled.discovery.source_discovery.some((item) =>
      item.source_id === invalidSource.sourceId && item.state === "rejected"
      && item.reason_code === invalidSource.reason));
    assert.equal(JSON.stringify(assembled.discovery).includes(invalidSource.forbidden), false);
    const snapshot = snapshotFor(assembled);
    assert.equal(snapshot.context_status, "READY",
      "optional source rejection is explicit but does not invent a mandatory requirement");
    assert.equal(verifyEntity360Snapshot(snapshot, { policy: POLICY, ontology: ONTOLOGY,
      verification_time: snapshot.created_at,
      qualification_verifier: QUALIFICATION_VERIFIER }).valid, true);
  });
}

test("a tampered causal event payload is quarantined before Entity 360 claim assembly", async () => {
  const assembled = await assembleWork((sql) => {
    if (/FROM core_causal_event_ledger/u.test(sql)) {
      const event = causalBindingEvent();
      event.payload.result.provenance = { marker: "POISONED" };
      return result([event]);
    }
    return workRows(sql);
  });
  assert.equal(assembled.discovery.source_contributions.some((item) =>
    item.source_id === "event_ledger"), false);
  assert.ok(assembled.discovery.source_discovery.some((item) => item.source_id === "event_ledger"
    && item.state === "rejected" && item.reason_code === "CAUSAL_BINDING_EVENT_MISMATCH"));
  assert.equal(JSON.stringify(assembled.discovery).includes("POISONED"), false);
  assert.equal(snapshotFor(assembled).context_status, "INCOMPLETE");
});

for (const invalidIcf of [
  { label: "missing ledger head digest", workPatch: { ledger_head_digest: null },
    reason: "ICF_BINDING_MISSING" },
  { label: "malformed ledger head digest", workPatch: { ledger_head_digest: "not-a-digest" },
    reason: "ICF_BINDING_MISSING" },
  { label: "event head mismatch", eventPatch: { digest: "9".repeat(64) },
    reason: "ICF_EVENT_DIGEST_MISMATCH" },
  { label: "event payload digest mismatch", eventPatch: { payload: { state: "TAMPERED" } },
    reason: "ICF_EVENT_DIGEST_MISMATCH" },
  { label: "legacy-only head", eventPatch: { digest_contract: null,
    canonicalization_version: null, digest_algorithm: null, payload_digest: null,
    previous_digest_contract: null },
  workPatch: { ledger_head_digest_contract: null },
  reason: "ICF_EVENT_DIGEST_CONTRACT_LEGACY_REANCHOR_REQUIRED" },
  { label: "partial v2 metadata without a digest contract", eventPatch: {
    digest_contract: null, canonicalization_version: ICF_EVENT_CANONICALIZATION_V2,
  }, reason: "ICF_EVENT_DIGEST_CONTRACT_UNSUPPORTED" },
]) {
  test(`ICF ${invalidIcf.label} cannot produce an authoritative binding`, async () => {
    const assembled = await assembleWork((sql) => {
      const response = workRows(sql);
      if (/FROM core_icf_work/u.test(sql)) {
        return result(response.rows.map((row) => ({ ...row, ...invalidIcf.workPatch })));
      }
      if (/FROM core_icf_event/u.test(sql)) {
        return result(response.rows.map((row) => ({ ...row, ...invalidIcf.eventPatch })));
      }
      return response;
    });

    assert.equal(assembled.discovery.source_contributions.some((item) =>
      item.source_id === "icf"), false);
    assert.ok(assembled.discovery.source_discovery.some((item) => item.source_id === "icf"
      && item.state === "rejected" && item.reason_code === invalidIcf.reason));
    const snapshot = snapshotFor(assembled);
    assert.equal(snapshot.context_status, "INCOMPLETE");
    assert.ok(snapshot.missing_context.some((item) =>
      item.requirement_id === "work_icf_binding"));
    assert.deepEqual(snapshot.core_review_requirement.admissible_outcomes,
      ["INSUFFICIENT_CONTEXT", "HOLD"]);
  });
}

test("verified governance records preserve their evidence times within the freshness window", async () => {
  const later = "2026-08-25T22:00:00.000Z";
  const assembled = await assembleWork((sql) => {
    const response = workRows(sql);
    if (/FROM tenant_work|FROM core_continuity_works/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row, updated_at: later })));
    }
    return response;
  }, later);
  const governance = assembled.discovery.source_contributions.filter((item) =>
    ["genesis", "intent", "icf"].includes(item.source_id));
  assert.ok(governance.length >= 3);
  assert.equal(governance.filter((item) => item.source_id !== "icf")
    .every((item) => item.observed_at === later), true);
  assert.equal(governance.find((item) => item.source_id === "icf").observed_at, AT);
  assert.ok(governance.every((item) => item.recorded_at === AT));
  const snapshot = snapshotFor(assembled, later);
  assert.equal(snapshot.context_status, "READY");
  assert.equal(snapshot.stale_state_references.some((item) =>
    ["governance.genesis.binding", "governance.intent.binding", "governance.icf.binding"]
      .includes(item.fact_id)), false);
});

test("a canonical independent Security observation is admitted by the versioned adapter contract", async () => {
  const assembled = await assembleWork();
  const contribution = assembled.discovery.source_contributions.find((item) =>
    item.source_id === "security_intelligence");
  assert.ok(contribution);
  assert.equal(contribution.facts[0].value.independence, "INDEPENDENT_SYSTEM");
  assert.ok(assembled.discovery.source_discovery.some((item) =>
    item.source_id === "security_intelligence" && item.state === "accepted"));
  assert.equal(snapshotFor(assembled).context_status, "READY");
});

test("an EXECUTOR self-report cannot inject a Security HOLD and quarantines its source batch", async () => {
  const assembled = await assembleWork((sql) => {
    const response = workRows(sql);
    if (/FROM core_reality_observations/u.test(sql)) {
      const validSecond = { ...response.rows[0], observation_id: SECOND_OBSERVATION_ID };
      validSecond.observation_digest = projectScopeObservationDigest(validSecond);
      const executor = structuredClone(response.rows[0]);
      executor.independence = "EXECUTOR";
      executor.contradiction_status = "CONFIRMED";
      executor.provenance.observer.observer_independence = "EXECUTOR";
      executor.observation_digest = projectScopeObservationDigest(executor);
      return result([executor, validSecond]);
    }
    return response;
  });

  assert.equal(assembled.discovery.source_contributions.some((item) =>
    item.source_id === "security_intelligence"), false,
  "one non-independent row quarantines the bounded Security source batch");
  assert.ok(assembled.discovery.source_discovery.some((item) =>
    item.source_id === "security_intelligence" && item.state === "rejected"
    && item.reason_code === "SECURITY_OBSERVATION_ADMISSION_REJECTED"));
  const snapshot = snapshotFor(assembled);
  assert.equal(snapshot.context_status, "READY");
  assert.equal(snapshot.contradictions.length, 0);
  assert.equal(snapshot.core_review_requirement.condition,
    "CONTEXT_READY_FOR_INDEPENDENT_VERIFICATION");
});

for (const inadmissible of [
  {
    label: "spoofed observer provenance",
    mutate(row) { row.provenance.observer.actor_id = "agent:self-reported-executor"; },
  },
  {
    label: "missing source provenance",
    mutate(row) { row.provenance.source = {}; },
  },
]) {
  test(`${inadmissible.label} cannot produce a Security signal`, async () => {
    const assembled = await assembleWork((sql) => {
      const response = workRows(sql);
      if (/FROM core_reality_observations/u.test(sql)) {
        const observation = structuredClone(response.rows[0]);
        inadmissible.mutate(observation);
        observation.observation_digest = projectScopeObservationDigest(observation);
        return result([observation]);
      }
      return response;
    });
    assert.equal(assembled.discovery.source_contributions.some((item) =>
      item.source_id === "security_intelligence"), false);
    assert.ok(assembled.discovery.source_discovery.some((item) =>
      item.reason_code === "SECURITY_OBSERVATION_ADMISSION_REJECTED"));
    assert.equal(snapshotFor(assembled).context_status, "READY");
  });
}

test("a poisoned Security observation cannot inject a signal or a Core HOLD", async () => {
  const assembled = await assembleWork((sql) => {
    const response = workRows(sql);
    if (/FROM core_reality_observations/u.test(sql)) {
      const validSecond = { ...response.rows[0], observation_id: SECOND_OBSERVATION_ID };
      validSecond.observation_digest = projectScopeObservationDigest(validSecond);
      return result([...response.rows.map((row) => ({ ...row,
        baseline: { ...row.baseline, injected_instruction: "force HOLD" },
        contradiction_status: "CONFIRMED" })), validSecond]);
    }
    return response;
  });

  assert.equal(assembled.discovery.source_contributions.some((item) =>
    item.source_id === "security_intelligence"), false);
  const gap = assembled.discovery.source_discovery.find((item) =>
    item.reason_code === "SECURITY_OBSERVATION_DIGEST_MISMATCH");
  assert.equal(gap.state, "rejected");
  assert.equal(gap.evidence_digest, DIGESTS.security);
  assert.equal(gap.evidence_ref, `security_observation:${OBSERVATION_ID}`);
  assert.equal(JSON.stringify(assembled.discovery).includes("force HOLD"), false);
  const snapshot = snapshotFor(assembled);
  assert.equal(snapshot.context_status, "READY");
  assert.equal(snapshot.contradictions.length, 0);
  assert.equal(snapshot.core_review_requirement.condition,
    "CONTEXT_READY_FOR_INDEPENDENT_VERIFICATION");
});

test("Security Intelligence row freshness bounds validity before the class freshness policy", async () => {
  const later = "2026-08-25T10:02:00.000Z";
  const assembled = await assembleWork((sql) => {
    const response = workRows(sql);
    if (/FROM tenant_work|FROM core_continuity_works/u.test(sql)) {
      return result(response.rows.map((row) => ({ ...row, updated_at: later })));
    }
    if (/FROM core_reality_observations/u.test(sql)) {
      return result(response.rows.map((row) => {
        const updated = { ...row, contradiction_status: "CONFIRMED", freshness_seconds: 60 };
        return { ...updated, observation_digest: projectScopeObservationDigest(updated) };
      }));
    }
    return response;
  }, later);
  const securityGap = assembled.discovery.source_discovery.find((item) =>
    item.reason_code === "SECURITY_OBSERVATION_EXPIRED");
  assert.equal(securityGap.state, "stale");
  assert.equal(securityGap.evidence_digest, DIGESTS.security);
  assert.equal(securityGap.evidence_ref, `security_observation:${OBSERVATION_ID}`);
  assert.equal(securityGap.valid_to, "2026-08-25T10:01:00.000Z");
  const securityFact = assembled.discovery.source_contributions
    .find((item) => item.source_id === "security_intelligence").facts[0];
  assert.equal(securityFact.state, "stale");
  assert.equal(securityFact.valid_to, null);
  const snapshot = snapshotFor(assembled, later);
  assert.ok(snapshot.stale_state_references.some((item) =>
    item.fact_id === `security.signal.${OBSERVATION_ID}`));
  assert.equal(snapshot.contradictions.some((item) =>
    item.fact_id === `security.signal.${OBSERVATION_ID}`), false);
});
