import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BASE_ENTITY_360_ONTOLOGY,
  Entity360Error,
  applyBoundedSourceOccupancy,
  assembleEntity360Snapshot as assembleEntity360SnapshotKernel,
  compileEntity360Ontology,
  compileEntity360Policy,
  createEntity360IdentityMergeLineage,
  createEntity360IdentitySplitLineage,
  deterministicEntity360Id,
  entity360Digest,
  entity360SnapshotSemanticBody,
  reconcileEntity360TemporalState,
  resolveEntity360Identity,
  verifyEntity360IdentityLineage,
  verifyEntity360Snapshot as verifyEntity360SnapshotKernel,
} from "../src/entity360.js";
import { ENTITY_360_FEATURE_FLAG_AUTHORITY_SCOPE, ENTITY_360_SHADOW_OBSERVER_SCOPE,
  createEntity360Runtime as createEntity360RuntimeKernel,
  loadEntity360Configuration } from "../src/entity360Runtime.js";
import { createHostNativeDomainSigner, createHostNativeDomainVerifier }
  from "../src/hostNativeGovernance.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const WORK_ID = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
const LEGACY_WORK_ID = "11111111-1111-4111-8111-111111111111";
const UNRELATED_WORK_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "nyra_conversational_runtime";
const PROJECT_UUID = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT_UUID = "66666666-6666-4666-8666-666666666666";
const AT = "2026-08-25T10:00:00.000Z";
const VERIFICATION_TIME = "2026-08-30T10:00:00.000Z";
const ADAPTER_REGISTRY_VERSION = "entity_360_adapter_registry_v1";
const WORK_IDENTITY = Object.freeze({ work_id: WORK_ID });
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const { policy: POLICY, ontology: ONTOLOGY } = loadEntity360Configuration();
const POLICY_SOURCE = JSON.parse(readFileSync(new URL("../config/entity360-policy.v1.json", import.meta.url), "utf8"));

const QUALIFICATION_SECRET = "entity360-test-qualification-secret-material-v1";
function qualificationSignature(payload, purpose) {
  return `hnc_${crypto.createHmac("sha256", QUALIFICATION_SECRET)
    .update(JSON.stringify({ purpose, payload })).digest("hex")}`;
}
const QUALIFICATION_SIGNER = Object.freeze({
  algorithm: "hmac-sha256",
  key_id: "entity360-test-key-v1",
  sign(payload, { purpose } = {}) { return qualificationSignature(payload, purpose); },
});
const QUALIFICATION_VERIFIER = Object.freeze({
  verify(payload, signature, { purpose, key_id: keyId } = {}) {
    if (keyId !== QUALIFICATION_SIGNER.key_id) return false;
    const expected = qualificationSignature(payload, purpose);
    const actualBytes = Buffer.from(String(signature || ""));
    const expectedBytes = Buffer.from(expected);
    return actualBytes.length === expectedBytes.length
      && crypto.timingSafeEqual(actualBytes, expectedBytes);
  },
});

function assembleEntity360Snapshot(input, options = {}) {
  return assembleEntity360SnapshotKernel(input, {
    adapter_registry_version: ADAPTER_REGISTRY_VERSION,
    qualification_signer: QUALIFICATION_SIGNER,
    ...options,
  });
}

function createEntity360Runtime(options = {}) {
  return createEntity360RuntimeKernel({
    qualificationSigner: QUALIFICATION_SIGNER,
    qualificationVerifier: QUALIFICATION_VERIFIER,
    ...options,
  });
}

function verifyEntity360Snapshot(value, options = {}) {
  return verifyEntity360SnapshotKernel(value, { verification_time: VERIFICATION_TIME,
    qualification_verifier: QUALIFICATION_VERIFIER, ...options });
}

function source({ sourceId, adapterVersion, evidenceClass, digest, facts, identity = WORK_IDENTITY,
  tenant = TENANT, entityType = "work", entityId } = {}) {
  const resolvedEntityId = entityId || deterministicEntity360Id({ tenant_id: tenant, entity_type: entityType, identity });
  return {
    tenant_id: tenant,
    entity_id: resolvedEntityId,
    source_id: sourceId,
    adapter_version: adapterVersion,
    source_watermark: `${sourceId}:1`,
    observed_at: AT,
    recorded_at: AT,
    evidence_class: evidenceClass,
    evidence_digests: [digest],
    evidence_refs: [`${sourceId}:1`],
    facts,
  };
}

function completeContributions(order = "normal") {
  const continuity = source({ sourceId: "work_continuity",
    adapterVersion: "work_continuity_entity360_adapter_v1", evidenceClass: "authoritative_record",
    digest: DIGEST_A, facts: [
      { fact_id: "work.identity", value: { work_id: WORK_ID, project_id: PROJECT_ID },
        criticality: "high_impact" },
      { fact_id: "work.current_state", value: { status: "ACTIVE" }, criticality: "high_impact",
        evidence_class: "verified_observation" },
    ] });
  const intent = source({ sourceId: "intent", adapterVersion: "intent_entity360_adapter_v1",
    evidenceClass: "authoritative_record", digest: DIGEST_B,
    facts: [{ fact_id: "governance.intent.binding", value: { intent_digest: DIGEST_B },
      criticality: "high_impact" }] });
  const genesis = source({ sourceId: "genesis", adapterVersion: "genesis_entity360_adapter_v1",
    evidenceClass: "authoritative_record", digest: DIGEST_C,
    facts: [{ fact_id: "governance.genesis.binding",
      value: { genesis_digest: DIGEST_C, project_uuid: PROJECT_UUID },
      criticality: "high_impact" }] });
  const icf = source({ sourceId: "icf", adapterVersion: "icf_entity360_adapter_v2",
    evidenceClass: "authoritative_record", digest: DIGEST_D,
    facts: [{ fact_id: "governance.icf.binding", value: { ledger_head_digest: DIGEST_D },
      criticality: "high_impact" }] });
  const values = [continuity, intent, genesis, icf];
  return order === "reverse" ? values.reverse() : values;
}

function fixtureSourceDiscovery(contributions, supplied = [], {
  includeAssembler = true, policy = POLICY, asOf = AT,
} = {}) {
  const claimedSources = new Set(supplied.map((item) => item.source_id));
  const generated = contributions.filter((item) => {
    const registered = policy.source_registry[item.source_id];
    return !claimedSources.has(item.source_id) && registered && !registered.revoked
      && registered.adapter_versions.includes(item.adapter_version)
      && (!registered.valid_from || Date.parse(registered.valid_from) <= Date.parse(asOf))
      && (!registered.valid_until || Date.parse(registered.valid_until) > Date.parse(asOf))
      && item.facts.every((fact) => registered.allowed_fact_prefixes.some((prefix) =>
        fact.fact_id === prefix || fact.fact_id.startsWith(`${prefix}.`)));
  }).map((item) => ({
    source_id: item.source_id,
    state: "accepted",
    evidence_digest: item.evidence_digests[0],
    evidence_ref: item.evidence_refs[0],
  }));
  return [...generated, ...supplied,
    ...(!includeAssembler || claimedSources.has("entity360_context_assembler") ? [] : [{
      source_id: "entity360_context_assembler", state: "complete",
      consistent_cut: "postgres_repeatable_read",
    }])];
}

function snapshot({ contributions = completeContributions(), createdAt = AT, asOf = AT, extra = {},
  qualificationSigner = QUALIFICATION_SIGNER } = {}) {
  const { source_discovery: suppliedDiscovery = [], ...restExtra } = extra;
  return assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work", identity: WORK_IDENTITY,
    as_of: asOf, snapshot_version: 1, source_contributions: contributions,
    source_discovery: fixtureSourceDiscovery(contributions, suppliedDiscovery), ...restExtra },
  { policy: POLICY, ontology: ONTOLOGY, created_at: createdAt,
    qualification_signer: qualificationSigner });
}

function redigest(value) {
  const semantic = entity360SnapshotSemanticBody(value);
  value.deterministic_immutable_digest = entity360Digest(semantic);
  value.envelope_digest = entity360Digest({
    semantic_digest: value.deterministic_immutable_digest,
    created_at: value.created_at,
    schema_version: value.schema_version,
  });
  return value;
}

function qualificationAttestationPayload(value) {
  const cut = value.source_discovery.find((entry) =>
    entry.source_id === "entity360_context_assembler").consistent_cut;
  return {
    schema_version: "entity_360_qualification_attestation_payload_v1",
    tenant_scope: value.tenant_scope,
    entity_id: value.entity_id,
    entity_type: value.entity_type,
    identity_digest: entity360Digest(value.identity.canonical),
    snapshot_schema_version: value.schema_version,
    snapshot_version: value.snapshot_version,
    previous_snapshot_digest: value.previous_snapshot_digest,
    as_of: value.as_of,
    created_at: value.created_at,
    policy_version: value.policy_version,
    policy_digest: value.policy_digest,
    ontology_version: value.ontology_version,
    ontology_digest: value.ontology_digest,
    adapter_registry_version: value.adapter_registry_version,
    consistent_cut: cut,
    qualification_manifest_digest: value.qualification_manifest.manifest_digest,
    source_discovery_digest: entity360Digest(value.source_discovery),
    project_work_linkage_digest: entity360Digest(value.project_work_linkage),
    snapshot_semantic_digest: value.deterministic_immutable_digest,
  };
}

function rebindTamperedQualificationClaim(value, contribution, claim) {
  const oldClaimId = claim.claim_id;
  const oldContributionDigest = contribution.contribution_digest;
  const { value: _value, claim_id: _claimId, bytes: _bytes, tokens: _tokens,
    contribution_digest: _claimContribution, adapter_version: _adapterVersion,
    temporal_state: _temporalState, ...claimIdentity } = claim;
  claim.claim_id = `ecl_${entity360Digest(claimIdentity).slice(0, 48)}`;
  const { contribution_digest: _digest, ...contributionBody } = contribution;
  contribution.contribution_digest = entity360Digest(contributionBody);
  for (const decision of value.assembly_report.decisions) {
    if (decision.contribution_digest !== oldContributionDigest) continue;
    decision.contribution_digest = contribution.contribution_digest;
    decision.accepted_claim_ids = decision.accepted_claim_ids
      .map((claimId) => claimId === oldClaimId ? claim.claim_id : claimId).sort();
    decision.rejected_claim_ids = decision.rejected_claim_ids
      .map((claimId) => claimId === oldClaimId ? claim.claim_id : claimId).sort();
  }
  for (const current of Object.values(value.current_state)) {
    current.claim_ids = current.claim_ids.map((claimId) =>
      claimId === oldClaimId ? claim.claim_id : claimId).sort();
  }
  const manifestPayload = {
    schema_version: value.qualification_manifest.schema_version,
    source_contributions: value.qualification_manifest.source_contributions,
    source_rejections: value.qualification_manifest.source_rejections,
  };
  value.qualification_manifest.manifest_digest = entity360Digest(manifestPayload);
  return redigest(value);
}

test("configuration compiles a versioned domain-neutral policy and ontology", () => {
  assert.equal(POLICY.schema_version, "entity_360_context_policy_v1");
  assert.match(POLICY.policy_digest, /^[a-f0-9]{64}$/u);
  assert.equal(POLICY.shadow_observation.minimum_interval_ms, 30_000);
  assert.equal(POLICY.shadow_observation.max_inflight_per_tenant, 2);
  assert.equal(POLICY.shadow_observation.max_starts_per_tenant_window, 30);
  assert.equal(POLICY.shadow_observation.max_tracked_tenants, 1024);
  assert.equal(POLICY.shadow_observation.max_gate_inflight_global, 16);
  assert.equal(POLICY.shadow_observation.max_cached_tenant_gates, 1024);
  assert.equal(POLICY.shadow_observation.tenant_off_gate_cache_ttl_ms, 5_000);
  assert.equal(POLICY.shadow_observation.gate_timeout_ms, 5_000);
  assert.deepEqual(POLICY.corroboration.high_impact_eligible_trust_classes,
    ["core_verified", "provider_verified", "tenant_verified"]);
  assert.equal(POLICY.temporal_reconciliation.schema_version,
    "entity_360_temporal_reconciliation_policy_v1");
  assert.equal(compileEntity360Policy(POLICY).policy_digest, POLICY.policy_digest);
  const invalidTenantBudget = structuredClone(POLICY_SOURCE);
  invalidTenantBudget.shadow_observation.max_inflight_per_tenant =
    invalidTenantBudget.shadow_observation.max_inflight_global + 1;
  assert.throws(() => compileEntity360Policy(invalidTenantBudget),
    /entity360_shadow_observation_tenant_budget_invalid/u);
  const invalidGateFairness = structuredClone(POLICY_SOURCE);
  invalidGateFairness.shadow_observation.max_gate_inflight_global = 1;
  assert.throws(() => compileEntity360Policy(invalidGateFairness),
    /entity360_shadow_observation_gate_fairness_invalid/u);
  assert.throws(() => compileEntity360Policy({ ...POLICY_SOURCE,
    execution_authorized: true }), /entity360_policy_schema_invalid/u);
  assert.deepEqual(ONTOLOGY.entity_types.map((item) => item.type), ["software_component", "work"]);
  assert.equal(ONTOLOGY.extension_contract.kernel_modification_required, false);
});

test("policy extensions cannot make high-impact context optional or advisory-trusted", () => {
  const optionalHighImpact = structuredClone(POLICY_SOURCE);
  optionalHighImpact.policy_version = "entity_360_reference_policy_v1_invalid_optional_high_impact";
  optionalHighImpact.required_context.work.push({
    requirement_id: "optional_release_gate",
    fact_id: "risk.optional_release_gate",
    evidence_class: "analysis",
    source_class: "architecture",
    mandatory: false,
    high_impact: true,
    authoritative_required: false,
  });
  assert.throws(() => compileEntity360Policy(optionalHighImpact),
    /entity360_high_impact_requirement_must_be_mandatory/u);

  const advisoryEligible = structuredClone(POLICY_SOURCE);
  advisoryEligible.policy_version = "entity_360_reference_policy_v1_invalid_advisory_trust";
  advisoryEligible.corroboration.high_impact_eligible_trust_classes.push("advisory");
  assert.throws(() => compileEntity360Policy(advisoryEligible),
    /entity360_high_impact_advisory_trust_forbidden/u);
});

test("ontology accepts a future vertical through the declarative registry", () => {
  const extended = compileEntity360Ontology({ ...BASE_ENTITY_360_ONTOLOGY,
    ontology_version: "entity_360_ontology_v1_customer_extension",
    entity_types: [...BASE_ENTITY_360_ONTOLOGY.entity_types,
      { type: "customer", projection: "customer_360", extension: true }] });
  assert.equal(extended.entity_types.some((item) => item.type === "customer" && item.extension), true);
  assert.equal(extended.kernel_compatibility, "entity_360_kernel_v1");
});

test("ontology fails closed on incompatible versions and unknown root fields", () => {
  assert.throws(() => compileEntity360Ontology({ ...BASE_ENTITY_360_ONTOLOGY,
    schema_version: "entity_360_ontology_v999" }), /entity360_ontology_schema_invalid/u);
  assert.throws(() => compileEntity360Ontology({ ...BASE_ENTITY_360_ONTOLOGY,
    ontology_version: "entity_360_ontology_v999" }), /entity360_ontology_version_incompatible/u);
  assert.throws(() => compileEntity360Ontology({ ...BASE_ENTITY_360_ONTOLOGY,
    kernel_compatibility: "entity_360_kernel_v999" }), /entity360_kernel_compatibility_invalid/u);
  assert.throws(() => compileEntity360Ontology({ ...BASE_ENTITY_360_ONTOLOGY,
    vertical_extension: { type: "customer" } }), /entity360_ontology_schema_invalid/u);
});

const ONTOLOGY_VOCABULARY_FIELDS = ["entity_types", "relationship_types", "state_classes",
  "transition_classes", "dependency_classes", "policy_binding_classes", "evidence_classes",
  "source_classes", "trust_boundaries", "temporal_semantics"];

for (const vocabulary of ONTOLOGY_VOCABULARY_FIELDS) {
  test(`base ontology vocabulary ${vocabulary} cannot be removed or mutated`, () => {
    const removed = structuredClone(BASE_ENTITY_360_ONTOLOGY);
    removed[vocabulary] = removed[vocabulary].slice(1);
    assert.throws(() => compileEntity360Ontology(removed),
      /entity360_ontology_base_vocabulary_invalid/u);

    const mutated = structuredClone(BASE_ENTITY_360_ONTOLOGY);
    mutated[vocabulary][0] = vocabulary === "entity_types"
      ? { ...mutated[vocabulary][0], projection: `${mutated[vocabulary][0].projection}_mutated` }
      : `${mutated[vocabulary][0]}_mutated`;
    assert.throws(() => compileEntity360Ontology(mutated),
      /entity360_ontology_base_vocabulary_invalid/u);
  });

  test(`additive ontology extension preserves base vocabulary ${vocabulary}`, () => {
    const removed = structuredClone(BASE_ENTITY_360_ONTOLOGY);
    removed.ontology_version = "entity_360_ontology_v1_invalid_extension";
    removed[vocabulary] = removed[vocabulary].slice(1);
    assert.throws(() => compileEntity360Ontology(removed),
      /entity360_ontology_extension_base_vocabulary_invalid/u);

    const mutated = structuredClone(BASE_ENTITY_360_ONTOLOGY);
    mutated.ontology_version = "entity_360_ontology_v1_invalid_extension";
    mutated[vocabulary][0] = vocabulary === "entity_types"
      ? { ...mutated[vocabulary][0], projection: `${mutated[vocabulary][0].projection}_mutated` }
      : `${mutated[vocabulary][0]}_mutated`;
    assert.throws(() => compileEntity360Ontology(mutated),
      /entity360_ontology_extension_base_vocabulary_invalid/u);
  });
}

test("base ontology version rejects additive vocabulary without an extension version", () => {
  assert.throws(() => compileEntity360Ontology({ ...BASE_ENTITY_360_ONTOLOGY,
    state_classes: [...BASE_ENTITY_360_ONTOLOGY.state_classes, "future_state"] }),
  /entity360_ontology_base_vocabulary_invalid/u);
});

test("entity resolver is deterministic and fails closed on ambiguity", () => {
  const first = resolveEntity360Identity({ tenant_id: TENANT, entity_type: "work", identity: { name: "Entità 360" },
    candidates: [
      { tenant_id: TENANT, entity_type: "work", identity: { name: "Entità 360", work_id: WORK_ID } },
      { tenant_id: TENANT, entity_type: "work", identity: { name: "Entità 360", work_id: "11111111-1111-4111-8111-111111111111" } },
    ] });
  const second = resolveEntity360Identity({ tenant_id: TENANT, entity_type: "work", identity: { name: "ENTITÀ 360" },
    candidates: [
      { tenant_id: TENANT, entity_type: "work", identity: { work_id: "11111111-1111-4111-8111-111111111111", name: "entità 360" } },
      { tenant_id: TENANT, entity_type: "work", identity: { work_id: WORK_ID, name: "entità 360" } },
    ] });
  assert.equal(first.status, "AMBIGUOUS");
  assert.equal(first.entity_id, null);
  assert.deepEqual(first.missing_disambiguation, ["work_id"]);
  assert.deepEqual(first.candidates, second.candidates);
  assert.equal(first.execution_authorized, false);
});

test("entity resolver maps a legacy Work UUID only to its persistent canonical identity", () => {
  const legacyWorkId = "11111111-1111-4111-8111-111111111111";
  const canonicalIdentity = { work_id: WORK_ID, legacy_work_id: legacyWorkId };
  const canonicalEntityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work",
    identity: canonicalIdentity });
  const candidates = [{ tenant_id: TENANT, entity_type: "work", identity: canonicalIdentity }];
  const resolution = resolveEntity360Identity({ tenant_id: TENANT, entity_type: "work",
    entity_id: canonicalEntityId, identity: { work_id: legacyWorkId }, candidates,
    require_existing: true });

  assert.equal(resolution.status, "RESOLVED");
  assert.equal(resolution.entity_id, canonicalEntityId);
  assert.deepEqual(resolution.identity, canonicalIdentity);
  const aliasDerivedId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work",
    identity: { work_id: legacyWorkId } });
  assert.throws(() => resolveEntity360Identity({ tenant_id: TENANT, entity_type: "work",
    entity_id: aliasDerivedId, identity: { work_id: legacyWorkId }, candidates,
    require_existing: true }), (error) => error instanceof Entity360Error
      && error.code === "entity360_entity_id_scope_mismatch" && error.status === 403);
});

test("entity resolver rejects a cross-tenant candidate", () => {
  assert.throws(() => resolveEntity360Identity({ tenant_id: TENANT, entity_type: "work",
    identity: WORK_IDENTITY, candidates: [{ tenant_id: OTHER_TENANT, entity_type: "work",
      identity: WORK_IDENTITY }] }), (error) => error instanceof Entity360Error
      && error.code === "entity360_cross_tenant_resolution_candidate" && error.status === 403);
});

test("entity resolver does not invent an existing entity when discovery has no match", () => {
  const resolution = resolveEntity360Identity({ tenant_id: TENANT, entity_type: "work",
    identity: WORK_IDENTITY, candidates: [], require_existing: true });
  assert.equal(resolution.status, "UNRESOLVED");
  assert.equal(resolution.entity_id, null);
  assert.deepEqual(resolution.missing_disambiguation, ["authoritative_identity_match"]);
  assert.equal(resolution.execution_authorized, false);
});

test("identity lineage records a deterministic SHADOW merge and exact reversible split", () => {
  const canonicalIdentity = { work_id: WORK_ID };
  const absorbedIdentities = [{ work_id: LEGACY_WORK_ID }, { work_id: UNRELATED_WORK_ID }];
  const input = {
    tenant_id: TENANT,
    entity_type: "work",
    canonical_identity: canonicalIdentity,
    absorbed_identities: absorbedIdentities,
    observed_at: AT,
    evidence_digest: DIGEST_A,
    idempotency_key: "e360-identity-merge-observation-1",
  };
  const merge = createEntity360IdentityMergeLineage(input);
  const replay = createEntity360IdentityMergeLineage({ ...input,
    absorbed_identities: [...absorbedIdentities].reverse() });

  assert.deepEqual(replay, merge);
  assert.equal(merge.mode, "SHADOW");
  assert.equal(merge.operation, "MERGE");
  assert.equal(merge.execution_authorized, false);
  assert.equal(merge.production_decision_mutation, false);
  assert.deepEqual(verifyEntity360IdentityLineage(merge), {
    schema_version: "entity_360_identity_lineage_verification_v1",
    valid: true,
    reasons: [],
    execution_authorized: false,
    authority: "universal_core",
  });

  const splitInput = { tenant_id: TENANT, merge_lineage: merge, observed_at: "2026-08-25T10:01:00Z",
    evidence_digest: DIGEST_B, idempotency_key: "e360-identity-split-observation-1" };
  const split = createEntity360IdentitySplitLineage(splitInput);
  const splitReplay = createEntity360IdentitySplitLineage(splitInput);
  const restored = split.restored_entities.map((item) => item.identity);

  assert.deepEqual(splitReplay, split);
  assert.equal(split.mode, "SHADOW");
  assert.equal(split.operation, "SPLIT");
  assert.equal(split.predecessor_lineage_digest, merge.audit_digest);
  assert.equal(split.reverses_lineage_digest, merge.audit_digest);
  assert.deepEqual(restored, [canonicalIdentity, ...absorbedIdentities]
    .sort((left, right) => deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity: left })
      .localeCompare(deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity: right }))));
  assert.deepEqual(verifyEntity360IdentityLineage(split), {
    schema_version: "entity_360_identity_lineage_verification_v1",
    valid: true,
    reasons: [],
    execution_authorized: false,
    authority: "universal_core",
  });
});

test("identity lineage rejects cross-tenant, ambiguous, and contradictory observations without changing resolution", () => {
  const canonicalIdentity = { work_id: WORK_ID };
  const candidates = [{ tenant_id: TENANT, entity_type: "work", identity: canonicalIdentity }];
  const before = resolveEntity360Identity({ tenant_id: TENANT, entity_type: "work",
    identity: canonicalIdentity, candidates, require_existing: true });
  const merge = createEntity360IdentityMergeLineage({ tenant_id: TENANT, entity_type: "work",
    canonical_identity: canonicalIdentity, absorbed_identities: [{ work_id: LEGACY_WORK_ID }],
    observed_at: AT, evidence_digest: DIGEST_A, idempotency_key: "e360-identity-merge-observation-2" });
  const after = resolveEntity360Identity({ tenant_id: TENANT, entity_type: "work",
    identity: canonicalIdentity, candidates, require_existing: true });

  assert.deepEqual(after, before);
  assert.throws(() => createEntity360IdentityMergeLineage({ tenant_id: TENANT, entity_type: "work",
    canonical_identity: canonicalIdentity, absorbed_identities: [canonicalIdentity], observed_at: AT,
    evidence_digest: DIGEST_A, idempotency_key: "e360-identity-merge-ambiguous" }),
  (error) => error instanceof Entity360Error && error.code === "entity360_identity_lineage_ambiguous"
    && error.status === 409);
  assert.throws(() => createEntity360IdentitySplitLineage({ tenant_id: OTHER_TENANT,
    merge_lineage: merge, observed_at: AT, evidence_digest: DIGEST_B,
    idempotency_key: "e360-identity-split-cross-tenant" }),
  (error) => error instanceof Entity360Error && error.code === "entity360_identity_lineage_cross_tenant"
    && error.status === 403);

  const contradictory = structuredClone(merge);
  contradictory.absorbed_entities[0].identity.work_id = UNRELATED_WORK_ID;
  assert.equal(verifyEntity360IdentityLineage(contradictory).valid, false);
  assert.throws(() => createEntity360IdentitySplitLineage({ tenant_id: TENANT,
    merge_lineage: contradictory, observed_at: AT, evidence_digest: DIGEST_B,
    idempotency_key: "e360-identity-split-contradiction" }),
  (error) => error instanceof Entity360Error && error.code === "entity360_identity_lineage_contradiction"
    && error.status === 409);
});

test("snapshot is complete, non-authoritative and independently digest-verifiable", () => {
  const value = snapshot();
  assert.equal(value.context_status, "READY");
  assert.equal(value.completeness, 1);
  assert.equal(value.core_verification_required, true);
  assert.equal(value.execution_authorized, false);
  assert.equal(value.production_decision_mutation, false);
  assert.deepEqual(verifyEntity360Snapshot(value, { policy: POLICY, ontology: ONTOLOGY }), {
    schema_version: "entity_360_core_verification_v1", valid: true, reasons: [],
    execution_authorized: false, authority: "universal_core",
  });
});

test("qualification attestation binds the exact qualified adapter context", () => {
  const value = snapshot();
  assert.equal(value.adapter_registry_version, ADAPTER_REGISTRY_VERSION);
  assert.deepEqual(Object.keys(value.qualification_attestation).sort(), [
    "algorithm", "key_id", "payload_digest", "purpose", "schema_version", "semantic_digest",
    "signature", "signer_domain",
  ]);
  assert.equal(value.qualification_attestation.schema_version,
    "entity_360_qualification_attestation_v2");
  assert.equal(value.qualification_attestation.key_id, "entity360-test-key-v1");
  assert.equal(value.qualification_attestation.purpose, "entity360-qualified-context-v1");
  assert.equal(value.qualification_attestation.semantic_digest,
    value.deterministic_immutable_digest);
  assert.match(value.qualification_attestation.payload_digest, /^[a-f0-9]{64}$/u);
  assert.equal(verifyEntity360Snapshot(value, {
    policy: POLICY, ontology: ONTOLOGY,
  }).valid, true);
});

test("qualification attestation requires separated signer and verify-only capabilities", () => {
  const contributions = completeContributions();
  const input = { tenant_id: TENANT, entity_type: "work", identity: WORK_IDENTITY,
    as_of: AT, snapshot_version: 1, source_contributions: contributions,
    source_discovery: fixtureSourceDiscovery(contributions) };
  assert.throws(() => assembleEntity360SnapshotKernel(input, { policy: POLICY,
    ontology: ONTOLOGY, created_at: AT, adapter_registry_version: ADAPTER_REGISTRY_VERSION }),
  /entity360_qualification_signer_required/u);
  assert.throws(() => assembleEntity360SnapshotKernel(input, { policy: POLICY,
    ontology: ONTOLOGY, created_at: AT, qualification_signer: QUALIFICATION_SIGNER }),
  /entity360_adapter_registry_version_required/u);

  const value = snapshot();
  const missingVerifier = verifyEntity360SnapshotKernel(value, { policy: POLICY,
    ontology: ONTOLOGY, verification_time: VERIFICATION_TIME });
  assert.equal(missingVerifier.valid, false);
  assert.ok(missingVerifier.reasons.includes("QUALIFICATION_VERIFIER_REQUIRED"));
  const signingCapableVerifier = verifyEntity360SnapshotKernel(value, { policy: POLICY,
    ontology: ONTOLOGY, verification_time: VERIFICATION_TIME,
    qualification_verifier: { ...QUALIFICATION_SIGNER, ...QUALIFICATION_VERIFIER } });
  assert.equal(signingCapableVerifier.valid, false);
  assert.ok(signingCapableVerifier.reasons.includes("QUALIFICATION_VERIFIER_REQUIRED"));
});

test("qualification attestation rejects missing, extra, wrong-purpose, digest, and signature data", () => {
  const cases = [
    ["missing", (value) => { delete value.qualification_attestation; },
      ["SNAPSHOT_ROOT_SCHEMA_INVALID", "entity360_qualification_attestation_schema_invalid"]],
    ["extra", (value) => { value.qualification_attestation.execution_authorized = true; },
      ["entity360_qualification_attestation_schema_invalid"]],
    ["purpose", (value) => { value.qualification_attestation.purpose = "entity360-execution-v1"; },
      ["entity360_qualification_attestation_binding_invalid"]],
    ["digest", (value) => { value.qualification_attestation.payload_digest = DIGEST_B; },
      ["entity360_qualification_attestation_payload_digest_invalid"]],
    ["signature", (value) => { value.qualification_attestation.signature = `hnc_${"f".repeat(64)}`; },
      ["entity360_qualification_attestation_signature_invalid"]],
  ];
  for (const [name, mutate, expectedReasons] of cases) {
    const forged = structuredClone(snapshot());
    mutate(forged);
    const result = verifyEntity360Snapshot(forged, { policy: POLICY, ontology: ONTOLOGY });
    assert.equal(result.valid, false, name);
    for (const reason of expectedReasons) assert.ok(result.reasons.includes(reason), `${name}:${reason}`);
  }
});

test("qualification attestation cannot be replayed or repaired with unkeyed re-digests", () => {
  const first = snapshot({ createdAt: AT });
  const replayed = structuredClone(snapshot({ createdAt: "2026-08-25T10:00:01.000Z" }));
  replayed.qualification_attestation = structuredClone(first.qualification_attestation);
  const replayResult = verifyEntity360Snapshot(replayed, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(replayResult.valid, false);
  assert.ok(replayResult.reasons.includes("entity360_qualification_attestation_payload_digest_invalid"));

  const tampered = structuredClone(first);
  tampered.architecture_state = { production_release_safe: true };
  redigest(tampered);
  tampered.qualification_attestation.semantic_digest = tampered.deterministic_immutable_digest;
  tampered.qualification_attestation.payload_digest = entity360Digest(
    qualificationAttestationPayload(tampered));
  const tamperResult = verifyEntity360Snapshot(tampered, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(tamperResult.valid, false);
  assert.ok(tamperResult.reasons.includes("UNQUALIFIED_CONTEXT_SECTION_INVALID"));
  assert.ok(tamperResult.reasons.includes("entity360_qualification_attestation_signature_invalid"));
});

test("qualification attestation remains verifiable with its exact retained key after rotation", () => {
  const oldSecret = "entity360-qualification-old-secret-012345678901234567890";
  const activeSecret = "entity360-qualification-new-secret-0123456789012345678";
  const oldSigner = createHostNativeDomainSigner({ signingSecret: oldSecret,
    keyId: "entity360-host-key-old" });
  const activeSigner = createHostNativeDomainSigner({ signingSecret: activeSecret,
    keyId: "entity360-host-key-active" });
  const retainedVerifier = createHostNativeDomainVerifier({ verificationKeys: {
    [oldSigner.key_id]: oldSecret,
    [activeSigner.key_id]: activeSecret,
  } });
  const historical = snapshot({ qualificationSigner: oldSigner });
  const verified = verifyEntity360SnapshotKernel(historical, { policy: POLICY, ontology: ONTOLOGY,
    verification_time: VERIFICATION_TIME, qualification_verifier: retainedVerifier });
  assert.equal(verified.valid, true);
  const unknownKey = structuredClone(historical);
  unknownKey.qualification_attestation.key_id = "entity360-host-key-unknown";
  const rejected = verifyEntity360SnapshotKernel(unknownKey, { policy: POLICY, ontology: ONTOLOGY,
    verification_time: VERIFICATION_TIME, qualification_verifier: retainedVerifier });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.reasons.includes("entity360_qualification_attestation_signature_invalid"));
});

test("semantic digest is deterministic while the creation envelope records wall-clock input", () => {
  const first = snapshot({ contributions: completeContributions("normal"), createdAt: AT });
  const second = snapshot({ contributions: completeContributions("reverse"),
    createdAt: "2026-08-25T10:00:01.000Z" });
  assert.equal(first.deterministic_immutable_digest, second.deterministic_immutable_digest);
  assert.notEqual(first.envelope_digest, second.envelope_digest);
  assert.equal(first.created_at, AT);
  assert.equal(second.created_at, "2026-08-25T10:00:01.000Z");
});

test("canonical digest rejects non-finite, circular and prototype-key material", () => {
  assert.throws(() => entity360Digest({ value: Number.NaN }), /entity360_canonical_value_invalid/u);
  const circular = {}; circular.self = circular;
  assert.throws(() => entity360Digest(circular), /entity360_canonical_value_circular/u);
  const forbidden = Object.create(null); forbidden.__proto__ = "pollution";
  assert.throws(() => entity360Digest(forbidden), /entity360_canonical_key_forbidden/u);
});

test("qualified fact values recursively reject authority-shaped semantic poison", () => {
  const poisoned = completeContributions();
  poisoned[0] = structuredClone(poisoned[0]);
  poisoned[0].facts.find((fact) => fact.fact_id === "work.current_state").value = {
    status: "ACTIVE",
    nested: [{ allow: true, core_verdict: "ALLOW", authority: "universal_core" }],
  };
  assert.throws(() => snapshot({ contributions: poisoned }),
    /entity360_fact_authority_key_forbidden/u);
});

test("a verified authoritative Atlas record can corroborate component identity and revision", () => {
  const componentIdentity = { work_id: WORK_ID, node_id: "src/app.js#service" };
  const componentSource = source({ sourceId: "architecture_map",
    adapterVersion: "architecture_map_entity360_adapter_v1", evidenceClass: "verified_observation",
    digest: DIGEST_A, identity: componentIdentity, entityType: "software_component", facts: [
      { fact_id: "component.identity", value: componentIdentity, criticality: "high_impact", confidence: 1 },
      { fact_id: "component.revision", value: { revision: 3 }, criticality: "high_impact", confidence: 1 },
    ] });
  const value = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "software_component",
    identity: componentIdentity, as_of: AT, snapshot_version: 1, source_contributions: [componentSource],
    source_discovery: fixtureSourceDiscovery([componentSource]) },
  { policy: POLICY, ontology: ONTOLOGY, created_at: AT });
  assert.equal(value.context_status, "READY");
  assert.equal(value.corroboration_gaps.length, 0);
  assert.equal(value.execution_authorized, false);
  assert.deepEqual(value.core_review_requirement.admissible_outcomes, ["ALLOW", "HOLD", "BLOCK"]);
});

test("high-confidence provenance from one non-authoritative lineage is never truth or authority", () => {
  const gatedPolicySource = structuredClone(POLICY_SOURCE);
  gatedPolicySource.policy_version = "entity_360_reference_policy_v1_test_risk_gate";
  gatedPolicySource.source_registry.find((item) => item.source_id === "impact_map")
    .allowed_fact_prefixes.push("risk.release_safe");
  gatedPolicySource.required_context.work.push({
    requirement_id: "release_safety_signal",
    fact_id: "risk.release_safe",
    evidence_class: "analysis",
    source_class: "architecture",
    mandatory: true,
    high_impact: true,
    authoritative_required: false,
  });
  const gatedPolicy = compileEntity360Policy(gatedPolicySource);
  const lone = source({ sourceId: "impact_map", adapterVersion: "impact_map_entity360_adapter_v1",
    evidenceClass: "analysis", digest: DIGEST_A,
    facts: [{ fact_id: "risk.release_safe", value: true, criticality: "high_impact", confidence: 1 }] });
  const contributions = [...completeContributions(), lone];
  const value = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work", identity: WORK_IDENTITY,
    as_of: AT, snapshot_version: 1, source_contributions: contributions,
    source_discovery: fixtureSourceDiscovery(contributions, [], { policy: gatedPolicy }) },
  { policy: gatedPolicy, ontology: ONTOLOGY, created_at: AT });
  assert.equal(value.context_status, "INCOMPLETE");
  assert.ok(value.corroboration_gaps.some((item) => item.fact_id === "risk.release_safe"
    && item.reason_code === "INDEPENDENT_CORROBORATION_MISSING"));
  assert.equal(value.execution_authorized, false);
  assert.deepEqual(value.core_review_requirement.admissible_outcomes, ["INSUFFICIENT_CONTEXT", "HOLD"]);
});

test("advisory lineages cannot satisfy a high-impact quorum or authoritative alternative", () => {
  const gatedPolicySource = structuredClone(POLICY_SOURCE);
  gatedPolicySource.policy_version = "entity_360_reference_policy_v1_test_advisory_trust_gate";
  gatedPolicySource.source_registry.push(
    {
      source_id: "advisory_risk_alpha",
      source_class: "memory",
      trust_class: "advisory",
      trust_boundary: "tenant_internal",
      independence_group: "advisory_risk_alpha_lineage",
      adapter_versions: ["advisory_risk_alpha_entity360_adapter_v1"],
      allowed_fact_prefixes: ["risk.advisory_gate"],
      authoritative: true,
      authoritative_fact_prefixes: ["risk.advisory_gate"],
    },
    {
      source_id: "advisory_risk_beta",
      source_class: "memory",
      trust_class: "advisory",
      trust_boundary: "tenant_internal",
      independence_group: "advisory_risk_beta_lineage",
      adapter_versions: ["advisory_risk_beta_entity360_adapter_v1"],
      allowed_fact_prefixes: ["risk.advisory_gate"],
      authoritative: false,
    },
  );
  gatedPolicySource.required_context.work.push({
    requirement_id: "advisory_release_gate",
    fact_id: "risk.advisory_gate",
    evidence_class: "analysis",
    source_class: "memory",
    mandatory: true,
    high_impact: true,
    authoritative_required: false,
  });
  const gatedPolicy = compileEntity360Policy(gatedPolicySource);
  const advisoryAlpha = source({ sourceId: "advisory_risk_alpha",
    adapterVersion: "advisory_risk_alpha_entity360_adapter_v1",
    evidenceClass: "analysis", digest: DIGEST_A,
    facts: [{ fact_id: "risk.advisory_gate", value: true,
      criticality: "high_impact", confidence: 1 }] });
  const advisoryBeta = source({ sourceId: "advisory_risk_beta",
    adapterVersion: "advisory_risk_beta_entity360_adapter_v1",
    evidenceClass: "analysis", digest: DIGEST_B,
    facts: [{ fact_id: "risk.advisory_gate", value: true,
      criticality: "high_impact", confidence: 1 }] });
  const contributions = [...completeContributions(), advisoryAlpha, advisoryBeta];
  const value = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
    identity: WORK_IDENTITY, as_of: AT, snapshot_version: 1,
    source_contributions: contributions,
    source_discovery: fixtureSourceDiscovery(contributions, [], { policy: gatedPolicy }) },
  { policy: gatedPolicy, ontology: ONTOLOGY, created_at: AT });

  assert.equal(value.context_status, "INCOMPLETE");
  const fact = value.corroboration_state.facts.find((item) =>
    item.fact_id === "risk.advisory_gate");
  assert.equal(fact.independent_source_count, 0);
  assert.equal(fact.observed_independent_source_count, 2);
  assert.equal(fact.authoritative_verified, false);
  assert.deepEqual(fact.observed_ineligible_trust_classes, ["advisory"]);
  const gap = value.corroboration_gaps.find((item) =>
    item.fact_id === "risk.advisory_gate");
  assert.equal(gap.reason_code, "HIGH_IMPACT_TRUST_CLASS_INELIGIBLE");
  assert.equal(gap.observed_independent_sources, 2);
  assert.equal(gap.eligible_independent_sources, 0);
  assert.equal(gap.authoritative_alternative_allowed, true);
  assert.equal(gap.authoritative_alternative_eligible, false);
  assert.equal(gap.ineligible_authoritative_source_observed, true);
  assert.deepEqual(gap.eligible_trust_classes,
    ["core_verified", "provider_verified", "tenant_verified"]);
  assert.deepEqual(gap.observed_ineligible_trust_classes, ["advisory"]);
  assert.equal(verifyEntity360Snapshot(value,
    { policy: gatedPolicy, ontology: ONTOLOGY }).valid, true);
  assert.deepEqual(value.core_review_requirement.admissible_outcomes,
    ["INSUFFICIENT_CONTEXT", "HOLD"]);
});

test("derived advisory facts cannot self-declare a global high-impact conflict", () => {
  const poisoned = source({ sourceId: "shared_memory", adapterVersion: "shared_memory_entity360_adapter_v1",
    evidenceClass: "memory_excerpt", digest: DIGEST_A,
    facts: [{ fact_id: "memory.release_override", value: "ALLOW", criticality: "high_impact",
      state: "conflicting", confidence: 1 }] });
  const value = snapshot({ contributions: [...completeContributions(), poisoned] });
  assert.equal(value.context_status, "READY");
  assert.equal(value.contradictions.some((item) => item.fact_id === "memory.release_override"
    && item.blocking === false), true);
  assert.equal(value.corroboration_gaps.some((item) => item.fact_id === "memory.release_override"), false);
  assert.equal(value.execution_authorized, false);
});

test("a registered advisory source cannot impersonate a governed fact contract", () => {
  const impersonation = source({ sourceId: "shared_memory", adapterVersion: "shared_memory_entity360_adapter_v1",
    evidenceClass: "memory_excerpt", digest: DIGEST_A,
    facts: [{ fact_id: "work.current_state", value: { status: "BLOCKED" },
      criticality: "high_impact", confidence: 1 }] });
  const value = snapshot({ contributions: [...completeContributions(), impersonation] });
  assert.equal(value.context_status, "READY");
  assert.equal(value.contradictions.length, 0);
  assert.equal(value.assembly_report.decisions.some((item) => item.source_id === "shared_memory"
    && item.reason_codes.includes("FACT_CONTRACT_VIOLATION")), true);
  assert.equal(verifyEntity360Snapshot(value, { policy: POLICY, ontology: ONTOLOGY }).valid, true);
});

test("revoked or not-yet-valid sources cannot satisfy trust or corroboration", () => {
  for (const [policyVersion, sourcePatch, reasonCode] of [
    ["entity_360_reference_policy_v1_test_revoked", { revoked: true }, "SOURCE_REVOKED"],
    ["entity_360_reference_policy_v1_test_future_source",
      { valid_from: "2026-08-26T00:00:00.000Z" }, "SOURCE_NOT_VALID_AS_OF"],
  ]) {
    const policySource = structuredClone(POLICY_SOURCE);
    policySource.policy_version = policyVersion;
    Object.assign(policySource.source_registry.find((item) => item.source_id === "intent"), sourcePatch);
    const policy = compileEntity360Policy(policySource);
    const contributions = completeContributions();
    const value = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
      identity: WORK_IDENTITY, as_of: AT, snapshot_version: 1,
      source_contributions: contributions,
      source_discovery: fixtureSourceDiscovery(contributions, [], { policy }) },
    { policy, ontology: ONTOLOGY, created_at: AT });
    assert.equal(value.context_status, "INCOMPLETE");
    assert.equal(value.current_state["governance.intent.binding"], undefined);
    assert.equal(value.assembly_report.decisions.some((item) => item.source_id === "intent"
      && item.reason_codes.includes(reasonCode)), true);
    assert.equal(verifyEntity360Snapshot(value, { policy, ontology: ONTOLOGY }).valid, true);
  }
});

test("policy-bound confirmed Security Intelligence conflict forces Core HOLD", () => {
  const security = source({ sourceId: "security_intelligence",
    adapterVersion: "security_intelligence_entity360_adapter_v1",
    evidenceClass: "verified_observation", digest: DIGEST_A,
    facts: [{ fact_id: "security.signal.observation-1", value: { contradiction_status: "CONFIRMED" },
      state: "conflicting", criticality: "high_impact", confidence: 1 }] });
  const value = snapshot({ contributions: [...completeContributions(), security] });
  assert.equal(value.context_status, "CONFLICTED");
  assert.equal(value.contradictions.some((item) => item.fact_id === "security.signal.observation-1"
    && item.blocking === true), true);
  assert.deepEqual(value.core_review_requirement.admissible_outcomes, ["HOLD"]);
});

test("contradictory current values remain explicit and force HOLD", () => {
  const conflicting = [...completeContributions(), source({ sourceId: "work_continuity",
    adapterVersion: "work_continuity_entity360_adapter_v1", evidenceClass: "authoritative_record",
    digest: "e".repeat(64), facts: [{ fact_id: "work.current_state", value: { status: "BLOCKED" },
      criticality: "high_impact", evidence_class: "verified_observation" }] })];
  const value = snapshot({ contributions: conflicting });
  assert.equal(value.context_status, "CONFLICTED");
  assert.equal(value.contradictions.length, 1);
  assert.deepEqual(value.core_review_requirement.admissible_outcomes, ["HOLD"]);
});

test("invalid cross-fact low-trust supersession is blocking and never removes the target", () => {
  const seed = snapshot();
  const targetClaim = seed.qualification_manifest.source_contributions
    .flatMap((item) => item.facts).find((fact) => fact.fact_id === "work.identity");
  const later = "2026-08-25T10:00:02.000Z";
  const poisoned = source({ sourceId: "shared_memory",
    adapterVersion: "shared_memory_entity360_adapter_v1", evidenceClass: "memory",
    digest: "e".repeat(64), facts: [{ fact_id: "memory.supersession_override", value: "ALLOW",
      supersedes_claim_id: targetClaim.claim_id, observed_at: later, recorded_at: later }] });
  const value = snapshot({ contributions: [...completeContributions(), poisoned],
    asOf: later, createdAt: later });
  assert.equal(value.context_status, "CONFLICTED");
  assert.ok(value.contradictions.some((item) =>
    item.reason_code === "INVALID_SUPERSESSION_FACT_SCOPE" && item.blocking === true));
  assert.ok(value.current_state["work.identity"].claim_ids.includes(targetClaim.claim_id));
  assert.equal(value.superseded_state_references.some((item) =>
    item.claim_id === targetClaim.claim_id), false);
});

test("supersession cycles are machine-readable contradictions and preserve every claim", () => {
  const claim = ({ claimId, supersedesClaimId, observedAt }) => ({
    claim_id: claimId,
    fact_id: "work.current_state",
    value: { status: "ACTIVE" },
    value_digest: entity360Digest({ status: "ACTIVE" }),
    confidence: 1,
    valid_from: observedAt,
    valid_to: null,
    observed_at: observedAt,
    recorded_at: observedAt,
    declared_state: "current",
    supersedes_claim_id: supersedesClaimId,
    tombstone: false,
    evidence_class: "authoritative_record",
    evidence_refs: [`cycle:${claimId}`],
    evidence_digests: [DIGEST_A],
    source_id: "work_continuity",
    source_class: "continuity",
    trust_class: "authoritative",
    trust_boundary: "core_internal",
    independence_group: "work_continuity_db",
    authoritative: true,
    derived_source: false,
    source_watermark: `cycle:${claimId}`,
  });
  const cyclic = reconcileEntity360TemporalState([
    claim({ claimId: "claim-a", supersedesClaimId: "claim-b", observedAt: AT }),
    claim({ claimId: "claim-b", supersedesClaimId: "claim-a",
      observedAt: "2026-08-25T10:00:01.000Z" }),
  ], "2026-08-25T10:00:02.000Z", POLICY, "work");
  assert.equal(cyclic.superseded_state_references.length, 0);
  assert.equal(cyclic.contradictions.filter((item) =>
    item.reason_code === "INVALID_SUPERSESSION_CYCLE" && item.blocking).length, 2);
  assert.deepEqual(cyclic.current_state["work.current_state"].claim_ids, ["claim-a", "claim-b"]);
});

test("future, stale, and expired superseders cannot remove evidence effective at the cut", () => {
  const claim = ({ claimId, supersedesClaimId = null, observedAt = AT,
    validFrom = observedAt, validTo = null, declaredState = "current" }) => ({
    claim_id: claimId,
    fact_id: "work.current_state",
    value: { status: claimId === "claim-target" ? "ACTIVE" : "BLOCKED" },
    value_digest: entity360Digest({ status: claimId === "claim-target" ? "ACTIVE" : "BLOCKED" }),
    confidence: 1,
    valid_from: validFrom,
    valid_to: validTo,
    observed_at: observedAt,
    recorded_at: observedAt,
    declared_state: declaredState,
    supersedes_claim_id: supersedesClaimId,
    tombstone: false,
    evidence_class: "authoritative_record",
    evidence_refs: [`supersession:${claimId}`],
    evidence_digests: [DIGEST_A],
    source_id: "work_continuity",
    source_class: "continuity",
    trust_class: "authoritative",
    trust_boundary: "core_internal",
    independence_group: "work_continuity_db",
    authoritative: true,
    derived_source: false,
    source_watermark: `supersession:${claimId}`,
  });
  const asOf = "2026-08-25T10:00:02.000Z";
  const variants = [
    claim({ claimId: "claim-future", supersedesClaimId: "claim-target",
      observedAt: "2026-08-25T10:00:01.000Z", validFrom: "2026-08-25T10:00:03.000Z" }),
    claim({ claimId: "claim-stale", supersedesClaimId: "claim-target",
      observedAt: "2026-08-25T10:00:01.000Z", declaredState: "stale" }),
    claim({ claimId: "claim-expired", supersedesClaimId: "claim-target",
      observedAt: "2026-08-25T10:00:01.000Z", validTo: asOf }),
  ];
  for (const superseder of variants) {
    const reconciled = reconcileEntity360TemporalState([
      claim({ claimId: "claim-target" }), superseder,
    ], asOf, POLICY, "work");
    assert.ok(reconciled.current_state["work.current_state"].claim_ids.includes("claim-target"));
    assert.equal(reconciled.superseded_state_references.some((item) =>
      item.claim_id === "claim-target"), false);
    assert.ok(reconciled.contradictions.some((item) =>
      item.reason_code === "INVALID_SUPERSESSION_SUPERSEDER_NOT_CURRENT"
      && item.claim_ids.includes(superseder.claim_id) && item.blocking));
  }
});

test("stale mandatory evidence is not promoted to current", () => {
  const staleAt = "2026-08-20T10:00:00.000Z";
  const contributions = completeContributions().map((item) => item.source_id === "work_continuity"
    ? { ...item, observed_at: staleAt, recorded_at: staleAt,
      facts: item.facts.map((fact) => ({ ...fact, observed_at: staleAt, recorded_at: staleAt })) } : item);
  const value = snapshot({ contributions });
  assert.equal(value.context_status, "INCOMPLETE");
  assert.ok(value.stale_sources.length >= 2);
  assert.ok(value.missing_context.some((item) => item.reason_codes.includes("ONLY_STALE_EVIDENCE_AVAILABLE")));
});

test("bounded source occupancy limits semantic domination using policy budgets", () => {
  const rawPolicy = JSON.parse(JSON.stringify(POLICY));
  delete rawPolicy.policy_digest;
  rawPolicy.source_registry = Object.values(rawPolicy.source_registry);
  rawPolicy.policy_version = "entity_360_test_occupancy_v1";
  rawPolicy.budgets.per_source.shared_memory = { max_contributions: 1, max_evidence: 2,
    max_bytes: 100000, max_tokens: 10000 };
  const bounded = compileEntity360Policy(rawPolicy);
  const memory = source({ sourceId: "shared_memory", adapterVersion: "shared_memory_entity360_adapter_v1",
    evidenceClass: "memory", digest: DIGEST_A, facts: [
      { fact_id: "memory.claim.one", value: "poison-one-secret", context_tokens: 1 },
      { fact_id: "memory.claim.two", value: "poison-two-secret", context_tokens: 1 },
    ] });
  const normalizedSnapshot = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
    identity: WORK_IDENTITY, as_of: AT, snapshot_version: 1, source_contributions: [memory],
    source_discovery: fixtureSourceDiscovery([memory]) },
  { policy: bounded, ontology: ONTOLOGY, created_at: AT });
  assert.equal(normalizedSnapshot.assembly_report.admitted_claim_count, 1);
  assert.equal(normalizedSnapshot.assembly_report.limited_source_contribution_count, 1);
  assert.ok(normalizedSnapshot.assembly_report.decisions[0].reason_codes.includes("SOURCE_OCCUPANCY_REACHED"));
  assert.ok(normalizedSnapshot.assembly_report.occupancy.context_tokens > 1,
    "source-declared token under-reporting must be ignored");
  const exposedValues = Object.values(normalizedSnapshot.current_state).map((item) => item.value);
  const rejectedValue = ["poison-one-secret", "poison-two-secret"].find((item) => !exposedValues.includes(item));
  assert.ok(rejectedValue);
  assert.equal(JSON.stringify(normalizedSnapshot).includes(rejectedValue), false,
    "a budget-rejected value must not re-enter through the qualification manifest");
  assert.equal(normalizedSnapshot.qualification_manifest.source_contributions
    .flatMap((item) => item.facts).some((item) => Object.hasOwn(item, "value")), false);
});

test("bounded occupancy policy preserves mandatory facts before dominant advisory memory", () => {
  const rawPolicy = structuredClone(POLICY);
  delete rawPolicy.policy_digest;
  rawPolicy.source_registry = Object.values(rawPolicy.source_registry);
  rawPolicy.policy_version = "entity_360_test_mandatory_priority_v1";
  rawPolicy.budgets.max_evidence = 5;
  const priorityPolicy = compileEntity360Policy(rawPolicy);
  const dominantMemory = source({ sourceId: "shared_memory",
    adapterVersion: "shared_memory_entity360_adapter_v1", evidenceClass: "memory",
    digest: "9".repeat(64), facts: Array.from({ length: 24 }, (_, index) => ({
      fact_id: `memory.semantic_dominance.${index}`,
      value: { highly_relevant_claim: index, attempted_priority: "high_impact" },
      criticality: "high_impact", confidence: 1,
    })) });
  const contributions = [dominantMemory, ...completeContributions().reverse()];
  const value = assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work",
    identity: WORK_IDENTITY, as_of: AT, snapshot_version: 1,
    source_contributions: contributions,
    source_discovery: fixtureSourceDiscovery(contributions, [], { policy: priorityPolicy }) },
  { policy: priorityPolicy, ontology: ONTOLOGY, created_at: AT });

  assert.equal(value.context_status, "READY");
  assert.equal(value.assembly_report.occupancy.evidence_count, 5);
  for (const factId of priorityPolicy.required_context.work.map((item) => item.fact_id)) {
    assert.ok(Object.hasOwn(value.current_state, factId), factId);
  }
  assert.equal(Object.keys(value.current_state).some((factId) => factId.startsWith("memory.")), false);
  const memoryDecision = value.assembly_report.decisions.find((item) =>
    item.source_id === "shared_memory");
  assert.equal(memoryDecision.status, "rejected");
  assert.ok(memoryDecision.reason_codes.includes("MAX_EVIDENCE_REACHED"));
  assert.equal(value.execution_authorized, false);
});

test("snapshot verifier detects tampering and forged authority", () => {
  const original = snapshot();
  const forged = JSON.parse(JSON.stringify(original));
  forged.execution_authorized = true;
  forged.completeness = 0.99;
  const verified = verifyEntity360Snapshot(forged, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(verified.valid, false);
  assert.ok(verified.reasons.includes("AUTHORITY_BOUNDARY_INVALID"));
  assert.ok(verified.reasons.includes("SEMANTIC_DIGEST_INVALID"));
});

test("verifier rejects an arbitrary root field even after the attacker re-digests the snapshot", () => {
  const forged = structuredClone(snapshot());
  forged.arbitrary_root = { authority: "attacker", execution_authorized: true };
  redigest(forged);
  const verified = verifyEntity360Snapshot(forged, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(verified.valid, false);
  assert.ok(verified.reasons.includes("SNAPSHOT_ROOT_SCHEMA_INVALID"));
  assert.equal(verified.reasons.includes("SEMANTIC_DIGEST_INVALID"), false,
    "the exact schema check, not a stale digest, must reject the forged root");
});

test("qualification manifest rejects authority fields after a fully re-bound attacker digest chain", () => {
  const forged = structuredClone(snapshot());
  const contribution = forged.qualification_manifest.source_contributions
    .find((item) => item.source_id === "genesis");
  const claim = contribution.facts[0];
  claim.execution_authorized = true;
  rebindTamperedQualificationClaim(forged, contribution, claim);
  const verified = verifyEntity360Snapshot(forged, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(verified.valid, false);
  assert.ok(verified.reasons.includes("entity360_qualification_claim_schema_invalid"));
  assert.equal(verified.reasons.includes("SEMANTIC_DIGEST_INVALID"), false);

  const reportForgery = structuredClone(snapshot());
  reportForgery.assembly_report.authority = "attacker";
  redigest(reportForgery);
  const reportResult = verifyEntity360Snapshot(reportForgery, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(reportResult.valid, false);
  assert.ok(reportResult.reasons.includes("entity360_assembly_report_schema_invalid"));
});

test("persisted v1 identity is exact and binds only the resolved canonical entity", () => {
  const missingCandidate = structuredClone(snapshot());
  missingCandidate.identity.candidate_entity_ids = [];
  redigest(missingCandidate);
  const candidateResult = verifyEntity360Snapshot(missingCandidate,
    { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(candidateResult.valid, false);
  assert.ok(candidateResult.reasons.includes("ENTITY_RESOLUTION_CANDIDATE_BINDING_INVALID"));

  const authorityMetadata = structuredClone(snapshot());
  authorityMetadata.identity.canonical.execution_authorized = "true";
  redigest(authorityMetadata);
  const authorityResult = verifyEntity360Snapshot(authorityMetadata,
    { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(authorityResult.valid, false);
  assert.ok(authorityResult.reasons.includes("entity360_identity_authority_key_forbidden"));
});

test("verifier requires canonical RFC3339 timestamps and the assembler's bounded temporal relation", () => {
  const historical = snapshot({ createdAt: "2026-08-28T10:00:00.000Z" });
  assert.equal(historical.as_of, AT);
  assert.equal(historical.created_at, "2026-08-28T10:00:00.000Z");
  assert.equal(verifyEntity360Snapshot(historical, { policy: POLICY, ontology: ONTOLOGY }).valid, true);

  const nonCanonical = structuredClone(snapshot());
  nonCanonical.created_at = "2026-08-25 10:00:00Z";
  redigest(nonCanonical);
  const invalidFormat = verifyEntity360Snapshot(nonCanonical, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(invalidFormat.valid, false);
  assert.ok(invalidFormat.reasons.includes("entity360_snapshot_created_at_rfc3339_invalid"));

  const futureBeyondSkew = structuredClone(snapshot());
  futureBeyondSkew.created_at = "2026-08-25T09:54:59.000Z";
  redigest(futureBeyondSkew);
  const invalidAnchor = verifyEntity360Snapshot(futureBeyondSkew, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(invalidAnchor.valid, false);
  assert.ok(invalidAnchor.reasons.includes("SNAPSHOT_TEMPORAL_ANCHOR_INVALID"));
  assert.throws(() => snapshot({ createdAt: "2026-08-25T09:54:59.000Z" }),
    /entity360_as_of_after_creation_invalid/u);
});

test("trusted verification time rejects a re-digested snapshot created in the far future", () => {
  const original = snapshot();
  const noTrustedTime = verifyEntity360SnapshotKernel(original, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(noTrustedTime.valid, false);
  assert.ok(noTrustedTime.reasons.includes("entity360_trusted_verification_time_required"));

  const future = structuredClone(original);
  future.created_at = "9999-12-31T23:59:59.000Z";
  redigest(future);
  const futureResult = verifyEntity360SnapshotKernel(future, { policy: POLICY, ontology: ONTOLOGY,
    verification_time: VERIFICATION_TIME });
  assert.equal(futureResult.valid, false);
  assert.ok(futureResult.reasons.includes("SNAPSHOT_CREATED_AT_FUTURE_INVALID"));

  const persistenceResult = verifyEntity360SnapshotKernel(original, { policy: POLICY, ontology: ONTOLOGY,
    verification_time: VERIFICATION_TIME, persisted_at: "2026-08-20T10:00:00.000Z" });
  assert.equal(persistenceResult.valid, false);
  assert.ok(persistenceResult.reasons.includes("SNAPSHOT_PERSISTENCE_TIME_BINDING_INVALID"));
});

test("project/work linkage is derived from qualified slug and UUID namespaces", () => {
  const original = snapshot();
  assert.deepEqual(original.project_work_linkage, {
    work_id: WORK_ID,
    project_id: PROJECT_ID,
    project_uuid: PROJECT_UUID,
  });

  const forgedSlug = structuredClone(original);
  forgedSlug.project_work_linkage.project_id = "different_project";
  redigest(forgedSlug);
  const slugResult = verifyEntity360Snapshot(forgedSlug, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(slugResult.valid, false);
  assert.ok(slugResult.reasons.includes("PROJECT_WORK_LINKAGE_DERIVATION_INVALID"));

  const forgedUuid = structuredClone(original);
  forgedUuid.project_work_linkage.project_uuid = OTHER_PROJECT_UUID;
  redigest(forgedUuid);
  const uuidResult = verifyEntity360Snapshot(forgedUuid, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(uuidResult.valid, false);
  assert.ok(uuidResult.reasons.includes("PROJECT_WORK_LINKAGE_DERIVATION_INVALID"));

  const noGenesis = snapshot({ contributions: completeContributions()
    .filter((item) => item.source_id !== "genesis") });
  assert.equal(Object.hasOwn(noGenesis.project_work_linkage, "project_uuid"), false);
  const opaqueUuid = structuredClone(noGenesis);
  opaqueUuid.project_work_linkage.project_uuid = PROJECT_UUID;
  redigest(opaqueUuid);
  const opaqueResult = verifyEntity360Snapshot(opaqueUuid, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(opaqueResult.valid, false);
  assert.ok(opaqueResult.reasons.includes("PROJECT_WORK_LINKAGE_DERIVATION_INVALID"));
});

test("verifier rebuilds relationships and rejects cross-tenant, excessive depth, and entity flooding", () => {
  const original = snapshot({ extra: { relationships: [{ type: "depends_on",
    target_entity_id: "e360_related_1", depth: 1, evidence_digests: [DIGEST_A] }] } });
  assert.equal(verifyEntity360Snapshot(original, { policy: POLICY, ontology: ONTOLOGY }).valid, true);

  const crossTenant = structuredClone(original);
  crossTenant.relationships[0].tenant_id = OTHER_TENANT;
  redigest(crossTenant);
  const tenantResult = verifyEntity360Snapshot(crossTenant, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(tenantResult.valid, false);
  assert.ok(tenantResult.reasons.includes("entity360_cross_tenant_relationship"));

  const excessiveDepth = structuredClone(original);
  excessiveDepth.relationships[0].depth = 999;
  redigest(excessiveDepth);
  const depthResult = verifyEntity360Snapshot(excessiveDepth, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(depthResult.valid, false);
  assert.ok(depthResult.reasons.includes("entity360_relationship_depth_invalid"));

  const flooded = structuredClone(original);
  flooded.relationships = Array.from({ length: POLICY.budgets.max_entities + 1 }, (_, index) => ({
    type: "depends_on", target_entity_id: `e360_related_${index}`, depth: 1,
    evidence_digests: [DIGEST_A],
  }));
  redigest(flooded);
  const budgetResult = verifyEntity360Snapshot(flooded, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(budgetResult.valid, false);
  assert.ok(budgetResult.reasons.includes("entity360_relationship_budget_exceeded"));
});

test("v1 verifier rejects unqualified context sections and executable source-discovery metadata", () => {
  for (const [field, forgedValue] of [
    ["architecture_state", { release_safe: true }],
    ["runtime_state", { production: "healthy" }],
    ["concurrent_active_work", [{ work_id: "forged" }]],
    ["agent_provider_state", { provider: "trusted" }],
    ["genesis_intent_icf_policy_bindings", { allow: true }],
  ]) {
    const forged = structuredClone(snapshot());
    forged[field] = forgedValue;
    redigest(forged);
    const result = verifyEntity360Snapshot(forged, { policy: POLICY, ontology: ONTOLOGY });
    assert.equal(result.valid, false, field);
    assert.ok(result.reasons.includes("UNQUALIFIED_CONTEXT_SECTION_INVALID"), field);
  }

  const executableDiscovery = structuredClone(snapshot());
  executableDiscovery.source_discovery = [{ source_id: "work_continuity", state: "accepted",
    execution_authorized: true }];
  redigest(executableDiscovery);
  const executableResult = verifyEntity360Snapshot(executableDiscovery,
    { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(executableResult.valid, false);
  assert.ok(executableResult.reasons.includes("entity360_source_discovery_field_invalid"));

  const arbitrarySource = structuredClone(snapshot());
  arbitrarySource.source_discovery = [{ source_id: "malicious_provider", state: "accepted" }];
  redigest(arbitrarySource);
  const sourceResult = verifyEntity360Snapshot(arbitrarySource, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(sourceResult.valid, false);
  assert.ok(sourceResult.reasons.includes("entity360_source_discovery_source_not_registered"));

  const wrongReasonBinding = structuredClone(snapshot());
  wrongReasonBinding.source_discovery = [{ source_id: "shared_memory", state: "rejected",
    reason_code: "GENESIS_BINDING_MISSING" }];
  redigest(wrongReasonBinding);
  const reasonResult = verifyEntity360Snapshot(wrongReasonBinding,
    { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(reasonResult.valid, false);
  assert.ok(reasonResult.reasons.includes("entity360_source_discovery_reason_binding_invalid"));
});

test("source-discovery audit schema preserves bounded stale and project-mismatch evidence", () => {
  const staleSecurity = source({ sourceId: "security_intelligence",
    adapterVersion: "security_intelligence_entity360_adapter_v1",
    evidenceClass: "verified_observation", digest: DIGEST_A,
    facts: [{ fact_id: "security.signal.observation-1", value: { status: "expired" },
      state: "stale", criticality: "critical" }] });
  const contributions = [...completeContributions().filter((item) => item.source_id !== "intent"),
    staleSecurity];
  const value = snapshot({ contributions, extra: { source_discovery: [
    { source_id: "security_intelligence", state: "stale",
      reason_code: "SECURITY_OBSERVATION_EXPIRED", evidence_digest: DIGEST_A,
      evidence_ref: "security_intelligence:1", valid_to: AT, tenant_id: TENANT },
    { source_id: "intent", state: "rejected", reason_code: "INTENT_ANCHOR_PROJECT_SLUG_MISMATCH",
      expected_project_slug: PROJECT_ID, observed_project_slug: "other_project" },
  ] } });
  assert.equal(verifyEntity360Snapshot(value, { policy: POLICY, ontology: ONTOLOGY }).valid, true);
  assert.equal(value.source_discovery.some((item) => item.state === "stale"
    && item.valid_to === AT && item.evidence_ref === "security_intelligence:1"), true);
});

test("source-discovery audit states are evidence-bound to qualified same-source contributions", () => {
  const omitted = structuredClone(snapshot());
  omitted.source_discovery = [];
  redigest(omitted);
  const omittedResult = verifyEntity360Snapshot(omitted, { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(omittedResult.valid, false);
  assert.ok(omittedResult.reasons.includes("entity360_source_discovery_assembler_marker_required"));

  const wrongEvidence = structuredClone(snapshot());
  wrongEvidence.source_discovery = [{ source_id: "work_continuity", state: "accepted",
    evidence_digest: DIGEST_B, evidence_ref: "work_continuity:1" },
  { source_id: "entity360_context_assembler", state: "complete",
    consistent_cut: "postgres_repeatable_read" }];
  redigest(wrongEvidence);
  const wrongEvidenceResult = verifyEntity360Snapshot(wrongEvidence,
    { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(wrongEvidenceResult.valid, false);
  assert.ok(wrongEvidenceResult.reasons.includes("entity360_source_discovery_accepted_binding_invalid"));

  const falseMissing = structuredClone(snapshot());
  falseMissing.source_discovery = [{ source_id: "work_continuity", state: "missing",
    reason_code: "NO_ELIGIBLE_EVIDENCE_AS_OF" },
  { source_id: "entity360_context_assembler", state: "complete",
    consistent_cut: "postgres_repeatable_read" }];
  redigest(falseMissing);
  const falseMissingResult = verifyEntity360Snapshot(falseMissing,
    { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(falseMissingResult.valid, false);
  assert.ok(falseMissingResult.reasons.includes("entity360_source_discovery_negative_binding_invalid"));

  const invalidCut = structuredClone(snapshot());
  invalidCut.source_discovery = [{ source_id: "entity360_context_assembler", state: "complete",
    consistent_cut: "caller_claimed_cut" }];
  redigest(invalidCut);
  const invalidCutResult = verifyEntity360Snapshot(invalidCut,
    { policy: POLICY, ontology: ONTOLOGY });
  assert.equal(invalidCutResult.valid, false);
  assert.ok(invalidCutResult.reasons.includes("entity360_source_discovery_cut_invalid"));
});

function memoryRuntimeDependencies() {
  const snapshots = new Map();
  const heads = new Map();
  const idempotency = new Map();
  const shadow = new Map();
  const registry = new Map();
  let featureFlag = { tenant_id: TENANT, flag_id: "entity360", mode: "SHADOW", enabled: true,
    revision: 1, policy_digest: POLICY.policy_digest, enforcement_authority_digest: null,
    config: {}, config_digest: entity360Digest({}) };
  const store = {
    kind: "memory_test",
    async initialize() {},
    async health() { return { ok: true, schema_verified: true, backend: "memory_test",
      migration: { application_state: "COMPLETED", checkpoint: "READBACK_VERIFIED" } }; },
    async readHead({ tenant_id, entity_id }) { return heads.get(`${tenant_id}:${entity_id}`) || null; },
    async registerDefinition(input) {
      const key = `${input.tenant_id}:${input.kind}:${input.registry_id}:${input.version}`;
      const payloadDigest = entity360Digest(input.payload);
      const existing = registry.get(key);
      if (existing && existing.payload_digest !== payloadDigest) {
        const error = new Error("entity360_registry_version_conflict"); error.status = 409; throw error;
      }
      if (!existing) registry.set(key, { kind: input.kind, registry_id: input.registry_id,
        version: input.version, payload: input.payload, payload_digest: payloadDigest,
        status: input.status || "ACTIVE" });
      return { ...registry.get(key), created: !existing };
    },
    async readRegistry({ tenant_id, kind, registry_id, version }) {
      const key = `${tenant_id}:${kind}:${registry_id}:${version}`;
      return registry.has(key) ? [registry.get(key)] : [];
    },
    async readFeatureFlag() { return featureFlag; },
    async writeFeatureFlag(input) {
      const actualRevision = Number(featureFlag?.revision || 0);
      if (input.expected_revision !== actualRevision) {
        const error = new Error("entity360_feature_revision_conflict");
        error.code = "entity360_feature_revision_conflict"; error.status = 409; throw error;
      }
      featureFlag = { tenant_id: input.tenant_id, flag_id: input.flag_id, mode: input.mode,
        enabled: input.enabled, policy_digest: input.policy_digest,
        enforcement_authority_digest: input.enforcement_authority_digest,
        config: structuredClone(input.config), config_digest: entity360Digest(input.config),
        revision: actualRevision + 1, updated_by: input.actor_id };
      return structuredClone(featureFlag);
    },
    async readSnapshotWriteReplay({ tenant_id, idempotency_key, request_digest }) {
      const prior = idempotency.get(`${tenant_id}:${idempotency_key}`);
      if (!prior) return null;
      if (prior.request_digest !== request_digest) {
        const error = new Error("entity360_idempotency_conflict"); error.status = 409; throw error;
      }
      return { ...prior.result, replayed: true };
    },
    async writeSnapshot({ snapshot: value, idempotency_key, request_digest, expected_head_version }) {
      const idem = `${value.tenant_scope}:${idempotency_key}`;
      if (idempotency.has(idem)) {
        const prior = idempotency.get(idem);
        if (prior.request_digest !== request_digest) { const error = new Error("entity360_idempotency_conflict"); error.status = 409; throw error; }
        return { ...prior.result, replayed: true };
      }
      const key = `${value.tenant_scope}:${value.entity_id}`;
      const current = heads.get(key)?.revision || 0;
      if (current !== expected_head_version) { const error = new Error("entity360_head_revision_conflict"); error.status = 409; throw error; }
      const result = { snapshot: value, entity_id: value.entity_id,
        snapshot_version: value.snapshot_version, revision: current + 1, replayed: false };
      snapshots.set(`${key}:${value.snapshot_version}`, value);
      heads.set(key, { revision: current + 1, current_snapshot_version: value.snapshot_version, snapshot: value });
      idempotency.set(idem, { request_digest, result });
      return result;
    },
    async readLatestSnapshot({ tenant_id, entity_id }) { return heads.get(`${tenant_id}:${entity_id}`)?.snapshot || null; },
    async readSnapshot({ tenant_id, entity_id, snapshot_version }) {
      return snapshots.get(`${tenant_id}:${entity_id}:${snapshot_version}`) || null;
    },
    async writeShadowReceipt({ tenant_id, entity_id, snapshot_version, receipt, idempotency_key }) {
      const key = `${tenant_id}:${entity_id}:${snapshot_version}:${idempotency_key}`;
      if (shadow.has(key)) return { receipt: shadow.get(key), replayed: true };
      shadow.set(key, receipt); return { receipt, replayed: false };
    },
    async readMetrics() { return { schema_version: "entity_360_persisted_metrics_v1",
      metrics_scope: "persisted_snapshots_and_shadow_receipts",
      snapshot_count: snapshots.size, shadow_receipt_count: shadow.size,
      resolver_metrics_persisted: false, resolver_attempt_count: null,
      resolver_ambiguity_count: null, entity_resolver_ambiguity_rate: null }; },
  };
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity: WORK_IDENTITY });
  const discoveredContributions = completeContributions().map((item) => ({ ...item, entity_id: entityId }));
  const sourceDiscovery = fixtureSourceDiscovery(discoveredContributions, [], { includeAssembler: false });
  const adapterRegistry = {
    schema_version: "entity_360_adapter_registry_test_v1",
    adapter_versions: ["test_v1"],
    async resolveCandidates({ tenant_id, entity_type, identity }) {
      return { candidates: [{ tenant_id, entity_type, identity }], source_discovery: [] };
    },
    async discover() { return { source_contributions: discoveredContributions,
      source_discovery: sourceDiscovery, project_work_linkage: { work_id: WORK_ID },
      consistent_cut: "postgres_repeatable_read", execution_authorized: false }; },
    async assembleContext({ tenant_id, entity_type, identity }) {
      return { candidates: [{ tenant_id, entity_type, identity }],
        source_contributions: discoveredContributions,
        source_discovery: sourceDiscovery, project_work_linkage: { work_id: WORK_ID },
        consistent_cut: "postgres_repeatable_read", execution_authorized: false };
    },
  };
  return { store, adapterRegistry, entityId,
    setFeatureFlag(value) { featureFlag = value; } };
}

const DTT_IDENTITY = Object.freeze({ tenant_id: TENANT, work_id: WORK_ID, actor_id: "agent:test",
  provenance: { session_fingerprint: "f".repeat(64), actor_provenance: "test" } });
const CORE_OPERATOR_IDENTITY = Object.freeze({ tenant_id: TENANT,
  actor_id: "core-key:entity360-operator-test", actor_role: "universal_core_operator",
  authority_scope: [ENTITY_360_FEATURE_FLAG_AUTHORITY_SCOPE],
  provenance: { session_fingerprint: "core-operator-test",
    actor_provenance: "universal_core_platform_auth", client_type: "core_operator" } });
const CORE_SHADOW_OBSERVER_IDENTITY = Object.freeze({ tenant_id: TENANT, work_id: WORK_ID,
  actor_id: "universal_core:work_preflight_shadow_observer",
  actor_role: "universal_core_shadow_observer",
  authority_scope: [ENTITY_360_SHADOW_OBSERVER_SCOPE],
  provenance: { session_fingerprint: "core-shadow-observer-test",
    actor_provenance: "universal_core_server_internal", client_type: "core_internal" } });

function workPreflight({ tenant = TENANT, workId = WORK_ID,
  state = "routed_waiting_for_core_verdict" } = {}) {
  return {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: "preflight_77777777-7777-4777-8777-777777777777",
    tenant_id: tenant,
    state,
    work_binding: { work_id: workId, project_id: PROJECT_ID },
    tenant_work_gallery: { tenant_id: tenant, available: true, state: "ready",
      works: [{ work_id: workId, project_id: PROJECT_ID }] },
    governance: { execution_allowed_by_preflight: state === "ready_read_only" },
  };
}

test("runtime initialization rejects an unverified Store before any adapter read or Store write", async () => {
  const { store, adapterRegistry } = memoryRuntimeDependencies();
  let adapterReads = 0;
  let storeWrites = 0;
  store.health = async () => ({ ok: false, schema_verified: false, migration: null,
    error: "entity360_migration_schema_manifest_mismatch" });
  for (const method of ["resolveCandidates", "assembleContext", "discover"]) {
    adapterRegistry[method] = async () => { adapterReads += 1; throw new Error("adapter_must_not_run"); };
  }
  for (const method of ["registerDefinition", "writeSnapshot", "writeShadowReceipt", "writeFeatureFlag"]) {
    const original = store[method];
    store[method] = async (...args) => { storeWrites += 1; return original(...args); };
  }
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await assert.rejects(() => runtime.initialize(),
    (error) => error.code === "entity360_store_verification_failed" && error.status === 503);
  assert.equal(adapterReads, 0);
  assert.equal(storeWrites, 0);
  const health = await runtime.health();
  assert.equal(health.ok, false);
  assert.equal(health.ready, false);
  assert.equal(health.schema_verified, false);
  assert.equal(health.state, "initialization_failed");
});

test("post-initialization Store drift blocks resolve, assembly and observer before reads or writes", async () => {
  const operations = [
    ["resolve", (runtime) => runtime.invoke("entity_360_resolve", DTT_IDENTITY, {
      work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY,
    })],
    ["assemble", (runtime) => runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
      work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY,
      expected_revision: 0, idempotency_key: "drift-assemble", as_of: AT,
    })],
    ["observer", (runtime) => runtime.observeCurrentPath(CORE_SHADOW_OBSERVER_IDENTITY, {
      work_id: WORK_ID, preflight: workPreflight(),
    })],
  ];
  for (const [label, operation] of operations) {
    const { store, adapterRegistry } = memoryRuntimeDependencies();
    let drifted = false;
    let adapterReads = 0;
    let operationalStoreCalls = 0;
    store.health = async () => drifted
      ? { ok: false, schema_verified: false, migration: null,
        error: "entity360_migration_schema_manifest_mismatch" }
      : { ok: true, schema_verified: true, backend: "memory_test",
        migration: { application_state: "COMPLETED", checkpoint: "READBACK_VERIFIED" } };
    for (const method of ["resolveCandidates", "assembleContext", "discover"]) {
      const original = adapterRegistry[method];
      adapterRegistry[method] = async (...args) => {
        adapterReads += 1;
        return original(...args);
      };
    }
    for (const method of ["readFeatureFlag", "readHead", "readSnapshotWriteReplay", "readSnapshot",
      "registerDefinition", "writeSnapshot", "writeShadowReceipt", "writeFeatureFlag"]) {
      const original = store[method];
      store[method] = async (...args) => {
        operationalStoreCalls += 1;
        return original(...args);
      };
    }
    const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY,
      ontology: ONTOLOGY, mode: "SHADOW", now: () => Date.parse(AT) });
    await runtime.initialize();
    drifted = true;
    await assert.rejects(() => operation(runtime),
      (error) => error.code === "entity360_store_verification_failed" && error.status === 503,
      `${label} must fail on the operation's own Store verification`);
    assert.equal(adapterReads, 0, `${label}: no adapter read after drift`);
    assert.equal(operationalStoreCalls, 0, `${label}: no operational Store read/write after drift`);
    const health = await runtime.health();
    assert.equal(health.ok, false);
    assert.equal(health.schema_verified, false);
    assert.equal(health.state, "store_verification_failed");
  }
});

test("concurrent operations coalesce the Store verification probe", async () => {
  const { store, adapterRegistry } = memoryRuntimeDependencies();
  let healthCalls = 0;
  store.health = async () => {
    healthCalls += 1;
    await Promise.resolve();
    return { ok: true, schema_verified: true, backend: "memory_test",
      migration: { application_state: "COMPLETED", checkpoint: "READBACK_VERIFIED" } };
  };
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  const input = { work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY };
  await Promise.all([
    runtime.invoke("entity_360_resolve", DTT_IDENTITY, input),
    runtime.invoke("entity_360_resolve", DTT_IDENTITY, input),
  ]);
  assert.equal(healthCalls, 2, "one init probe plus one shared operational probe");
});

test("runtime assembles and persists only server-discovered context in SHADOW mode", async () => {
  const { store, adapterRegistry, entityId } = memoryRuntimeDependencies();
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  const result = await runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0,
    idempotency_key: "assemble-1", as_of: AT,
  });
  assert.equal(result.snapshot.entity_id, entityId);
  assert.equal(result.snapshot.context_status, "READY");
  assert.equal(result.shadow_mode, true);
  assert.equal(result.production_decision_changed, false);
  const verification = await runtime.invoke("entity_360_snapshot_verify", DTT_IDENTITY, {
    work_id: WORK_ID, entity_id: entityId, snapshot_version: 1,
  });
  assert.equal(verification.valid, true);
});

test("runtime exact retry replays the persisted snapshot before any stale-head rejection", async () => {
  const { store, adapterRegistry } = memoryRuntimeDependencies();
  let assemblyCalls = 0;
  const assembleContext = adapterRegistry.assembleContext;
  adapterRegistry.assembleContext = async (...args) => {
    assemblyCalls += 1;
    if (assemblyCalls > 1) throw new Error("mutable_source_must_not_be_reassembled_on_exact_retry");
    return assembleContext(...args);
  };
  let nowMs = Date.parse(AT);
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => nowMs });
  await runtime.initialize();
  const input = { work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0,
    idempotency_key: "assemble-retry", as_of: AT };
  const first = await runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, input);
  nowMs += 1_000;
  const replay = await runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, input);
  assert.equal(replay.persistence.replayed, true);
  assert.equal(replay.snapshot.envelope_digest, first.snapshot.envelope_digest);
  assert.equal(replay.snapshot.created_at, first.snapshot.created_at);
  assert.equal(assemblyCalls, 1);
});

test("runtime maps an exact legacy DTT Work UUID to the canonical Gallery identity", async () => {
  const { store, adapterRegistry } = memoryRuntimeDependencies();
  const canonicalIdentity = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID };
  const canonicalEntityId = deterministicEntity360Id({ tenant_id: TENANT,
    entity_type: "work", identity: canonicalIdentity });
  const contributions = completeContributions().map((contribution) => ({
    ...contribution,
    entity_id: canonicalEntityId,
    facts: contribution.facts.map((fact) => fact.fact_id === "work.identity"
      ? { ...fact, value: { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID,
        project_id: PROJECT_ID } } : fact),
  }));
  const sourceDiscovery = fixtureSourceDiscovery(contributions, [], { includeAssembler: false });
  const candidate = { tenant_id: TENANT, entity_type: "work", identity: canonicalIdentity };
  const linkage = { work_id: WORK_ID, legacy_work_id: LEGACY_WORK_ID, project_id: PROJECT_ID };
  adapterRegistry.resolveCandidates = async () => ({ candidates: [candidate],
    source_discovery: [], project_work_linkage: linkage });
  adapterRegistry.assembleContext = async () => ({ candidates: [candidate],
    source_contributions: contributions, source_discovery: sourceDiscovery,
    project_work_linkage: linkage, consistent_cut: "postgres_repeatable_read",
    execution_authorized: false });
  const legacyIdentity = Object.freeze({ ...DTT_IDENTITY, work_id: LEGACY_WORK_ID });
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();

  const assembled = await runtime.invoke("entity_360_snapshot_assemble", legacyIdentity, {
    work_id: LEGACY_WORK_ID, entity_type: "work", identity: { work_id: LEGACY_WORK_ID },
    expected_revision: 0, idempotency_key: "legacy-work-assemble", as_of: AT,
  });
  assert.equal(assembled.snapshot.entity_id, canonicalEntityId);
  assert.deepEqual(assembled.snapshot.identity.canonical, canonicalIdentity);
  assert.equal(assembled.snapshot.project_work_linkage.work_id, WORK_ID);
  assert.equal(assembled.snapshot.project_work_linkage.legacy_work_id, LEGACY_WORK_ID);
  const read = await runtime.invoke("entity_360_snapshot_read", legacyIdentity, {
    work_id: LEGACY_WORK_ID, entity_id: canonicalEntityId, snapshot_version: 1,
  });
  assert.equal(read.deterministic_immutable_digest,
    assembled.snapshot.deterministic_immutable_digest);

  const unrelatedIdentity = Object.freeze({ ...DTT_IDENTITY, work_id: UNRELATED_WORK_ID });
  await assert.rejects(() => runtime.invoke("entity_360_snapshot_read", unrelatedIdentity, {
    work_id: UNRELATED_WORK_ID, entity_id: canonicalEntityId, snapshot_version: 1,
  }), (error) => error.code === "entity360_cross_work_snapshot" && error.status === 403);
  await assert.rejects(() => runtime.invoke("entity_360_snapshot_assemble", unrelatedIdentity, {
    work_id: UNRELATED_WORK_ID, entity_type: "work", identity: { work_id: UNRELATED_WORK_ID },
    expected_revision: 0, idempotency_key: "unrelated-work-assemble", as_of: AT,
  }), (error) => error.code === "entity360_entity_resolution_not_found" && error.status === 409);
});

test("runtime verifies an old snapshot with its exact append-only policy and ontology definitions", async () => {
  const { store, adapterRegistry, entityId } = memoryRuntimeDependencies();
  const v1 = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await v1.initialize();
  await v1.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0,
    idempotency_key: "historical-v1", as_of: AT,
  });
  const nextPolicySource = structuredClone(POLICY_SOURCE);
  nextPolicySource.policy_version = "entity_360_reference_policy_v2_test";
  const v2 = createEntity360Runtime({ store, adapterRegistry,
    policy: compileEntity360Policy(nextPolicySource), ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await v2.initialize();
  const verification = await v2.invoke("entity_360_snapshot_verify", DTT_IDENTITY, {
    work_id: WORK_ID, entity_id: entityId, snapshot_version: 1,
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.snapshot_digest.length, 64);
});

test("tenant SHADOW flag must pin the exact compiled policy digest", async () => {
  const { store, adapterRegistry, setFeatureFlag } = memoryRuntimeDependencies();
  setFeatureFlag({ mode: "SHADOW", enabled: true, revision: 1,
    policy_digest: "0".repeat(64) });
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  await assert.rejects(runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0,
    idempotency_key: "policy-mismatch", as_of: AT,
  }), (error) => error.code === "entity360_tenant_policy_binding_mismatch" && error.status === 409);
});

test("tenant without an explicit feature flag remains OFF under the SHADOW deployment ceiling", async () => {
  const { store, adapterRegistry, setFeatureFlag } = memoryRuntimeDependencies();
  setFeatureFlag(null);
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  const policy = await runtime.invoke("entity_360_policy_read", DTT_IDENTITY, { work_id: WORK_ID });
  assert.deepEqual(policy.feature_flag, { mode: "OFF", enabled: false, revision: 0,
    source: "tenant_feature_flag_default_off" });
  await assert.rejects(() => runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0,
    idempotency_key: "default-off", as_of: AT,
  }), (error) => error.code === "entity360_shadow_mode_required" && error.status === 503);
});

test("tenant OFF kill-switch prevents public resolve and automatic observer adapter reads", async () => {
  const featureStates = [
    ["absent", null],
    ["explicit-off", { tenant_id: TENANT, flag_id: "entity360", mode: "OFF", enabled: false,
      revision: 2, policy_digest: null, enforcement_authority_digest: null,
      config: {}, config_digest: entity360Digest({}) }],
  ];
  for (const [label, featureFlag] of featureStates) {
    const { store, adapterRegistry, setFeatureFlag } = memoryRuntimeDependencies();
    setFeatureFlag(featureFlag);
    let gateFeatureRead = null;
    const readFeatureFlag = store.readFeatureFlag.bind(store);
    store.readFeatureFlag = async (input) => {
      gateFeatureRead = input;
      return readFeatureFlag(input);
    };
    let adapterReads = 0;
    adapterRegistry.resolveCandidates = async () => {
      adapterReads += 1;
      throw new Error(`adapter_resolve_must_not_run:${label}`);
    };
    adapterRegistry.assembleContext = async () => {
      adapterReads += 1;
      throw new Error(`adapter_assembly_must_not_run:${label}`);
    };
    const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY,
      ontology: ONTOLOGY, mode: "SHADOW", now: () => Date.parse(AT) });
    await runtime.initialize();
    const gate = await runtime.preflightObservationGate(CORE_SHADOW_OBSERVER_IDENTITY, {
      work_id: WORK_ID,
    });
    assert.equal(gate.eligible, false, `${label}: scheduler pre-gate must reject tenant OFF`);
    assert.equal(gate.reason, "TENANT_ENTITY360_OFF");
    assert.equal(gate.read_only, true);
    assert.equal(gate.execution_authorized, false);
    assert.equal(gateFeatureRead.statement_timeout_ms,
      POLICY.shadow_observation.gate_timeout_ms,
    `${label}: gate feature read must carry the policy-bound PostgreSQL timeout`);
    assert.equal(adapterReads, 0, `${label}: scheduler pre-gate must not read adapters`);
    await assert.rejects(() => runtime.invoke("entity_360_resolve", DTT_IDENTITY, {
      work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY,
    }), (error) => error.code === "entity360_shadow_mode_required" && error.status === 503);
    assert.equal(adapterReads, 0, `${label}: public resolve must not read adapters`);
    await assert.rejects(() => runtime.observeCurrentPath(CORE_SHADOW_OBSERVER_IDENTITY, {
      work_id: WORK_ID, preflight: workPreflight(),
    }), (error) => error.code === "entity360_shadow_mode_required" && error.status === 503);
    assert.equal(adapterReads, 0, `${label}: automatic observer must not read adapters`);
  }
});

test("feature flags accept only the exact Core operator and server-owned OFF or SHADOW bindings", async () => {
  const { store, adapterRegistry, setFeatureFlag } = memoryRuntimeDependencies();
  setFeatureFlag(null);
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  const baseInput = { mode: "SHADOW", enabled: true, expected_revision: 0,
    idempotency_key: "feature-shadow" };

  await assert.rejects(() => runtime.invoke("entity_360_feature_flag_write", DTT_IDENTITY,
    baseInput), (error) => error.code === "entity360_feature_flag_authority_required"
      && error.status === 403);
  const scopeSpoofingDtt = { ...DTT_IDENTITY,
    authority_scope: [ENTITY_360_FEATURE_FLAG_AUTHORITY_SCOPE] };
  await assert.rejects(() => runtime.invoke("entity_360_feature_flag_write", scopeSpoofingDtt,
    baseInput), (error) => error.code === "entity360_feature_flag_authority_required"
      && error.status === 403);
  const overScopedOperator = { ...CORE_OPERATOR_IDENTITY,
    authority_scope: [ENTITY_360_FEATURE_FLAG_AUTHORITY_SCOPE, "entity360:admin"] };
  await assert.rejects(() => runtime.invoke("entity_360_feature_flag_write", overScopedOperator,
    baseInput), /entity360_feature_flag_authority_required/u);
  await assert.rejects(() => runtime.invoke("entity_360_feature_flag_write", CORE_OPERATOR_IDENTITY,
    { ...baseInput, policy_digest: DIGEST_A }),
  (error) => error.code === "entity360_feature_flag_server_binding_required" && error.status === 403);
  await assert.rejects(() => runtime.invoke("entity_360_feature_flag_write", CORE_OPERATOR_IDENTITY,
    { ...baseInput, mode: "ENFORCED" }), /entity360_mode_invalid/u);

  const shadow = await runtime.invoke("entity_360_feature_flag_write", CORE_OPERATOR_IDENTITY,
    baseInput);
  assert.equal(shadow.mode, "SHADOW");
  assert.equal(shadow.enabled, true);
  assert.equal(shadow.policy_digest, POLICY.policy_digest);
  assert.equal(shadow.enforcement_authority_digest, null);
  assert.equal(shadow.configured_by, "universal_core_governed_operator");
  assert.equal(shadow.execution_authorized, false);
  const off = await runtime.invoke("entity_360_feature_flag_write", CORE_OPERATOR_IDENTITY, {
    mode: "OFF", enabled: false, expected_revision: 1, idempotency_key: "feature-off",
  });
  assert.equal(off.mode, "OFF");
  assert.equal(off.enabled, false);
  assert.equal(off.policy_digest, null);
  assert.equal(off.revision, 2);
  assert.equal(off.execution_authorized, false);
});

test("runtime rejects caller-supplied evidence and cross-tenant input", async () => {
  const { store, adapterRegistry } = memoryRuntimeDependencies();
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  await assert.rejects(() => runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0, idempotency_key: "forged",
    source_contributions: completeContributions(),
  }), /entity360_caller_supplied_source_material_forbidden/u);
  await assert.rejects(() => runtime.invoke("entity_360_resolve", DTT_IDENTITY, {
    work_id: WORK_ID, tenant_id: OTHER_TENANT, entity_type: "work", identity: WORK_IDENTITY,
  }), /entity360_cross_tenant_request/u);
  await assert.rejects(() => runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0, idempotency_key: "bad-link",
    project_work_linkage: { project_id: "forged-project" },
  }), /entity360_project_work_linkage_mismatch/u);
});

test("runtime never persists an unresolved or ambiguous pseudo-entity", async () => {
  const { store, adapterRegistry } = memoryRuntimeDependencies();
  let writes = 0;
  const writeSnapshot = store.writeSnapshot;
  store.writeSnapshot = async (input) => { writes += 1; return writeSnapshot(input); };
  let discoveryCalls = 0;
  adapterRegistry.discover = async () => { discoveryCalls += 1; throw new Error("must_not_discover"); };
  adapterRegistry.assembleContext = async ({ tenant_id, entity_type }) => ({
    candidates: [], source_discovery: [{ source_id: "work_continuity", state: "missing" }],
    tenant_id, entity_type,
  });
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  await assert.rejects(() => runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0,
    idempotency_key: "unresolved", as_of: AT,
  }), (error) => error.code === "entity360_entity_resolution_not_found" && error.status === 409
      && error.details?.admissible_core_outcomes?.includes("INSUFFICIENT_CONTEXT"));
  assert.equal(writes, 0);
  assert.equal(discoveryCalls, 0);
});

test("resolver ambiguity rate uses every resolve and assembly attempt and remains bounded", async () => {
  const { store, adapterRegistry } = memoryRuntimeDependencies();
  const resolvedCandidates = adapterRegistry.resolveCandidates;
  let ambiguous = true;
  adapterRegistry.resolveCandidates = async ({ tenant_id, entity_type }) => ambiguous
    ? {
      candidates: [
        { tenant_id, entity_type, identity: { work_id: WORK_ID, name: "Entità 360",
          legacy_work_id: "11111111-1111-4111-8111-111111111111" } },
        { tenant_id, entity_type, identity: { work_id: WORK_ID, name: "Entità 360",
          legacy_work_id: "22222222-2222-4222-8222-222222222222" } },
      ],
      source_discovery: [],
    }
    : resolvedCandidates({ tenant_id, entity_type, identity: WORK_IDENTITY });
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY,
    ontology: ONTOLOGY, mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  const ambiguousInput = { work_id: WORK_ID, entity_type: "work",
    identity: { work_id: WORK_ID, name: "Entità 360" } };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolution = await runtime.invoke("entity_360_resolve", DTT_IDENTITY, ambiguousInput);
    assert.equal(resolution.status, "AMBIGUOUS");
  }
  ambiguous = false;
  const resolved = await runtime.invoke("entity_360_resolve", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY,
  });
  assert.equal(resolved.status, "RESOLVED");
  await runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY,
    expected_revision: 0, idempotency_key: "resolver-metrics-assembly", as_of: AT,
  });
  const metrics = await runtime.invoke("entity_360_metrics_read", DTT_IDENTITY, {
    work_id: WORK_ID,
  });
  assert.equal(metrics.metrics_scope, "runtime_process");
  assert.equal(metrics.resolver_attempt_count, 4);
  assert.equal(metrics.resolver_ambiguity_count, 2);
  assert.equal(metrics.entity_resolver_ambiguity_rate, 0.5);
  assert.equal(metrics.entity_resolver_ambiguity_rate >= 0
    && metrics.entity_resolver_ambiguity_rate <= 1, true);
  assert.equal(metrics.persisted.metrics_scope, "persisted_snapshots_and_shadow_receipts");
  assert.equal(metrics.persisted.resolver_metrics_persisted, false);
  assert.equal(metrics.persisted.resolver_attempt_count, null);
  assert.equal(metrics.persisted.entity_resolver_ambiguity_rate, null);
});

test("manual shadow comparison stays unverified and cannot inflate Core HOLD correlation", async () => {
  const { store, adapterRegistry, entityId } = memoryRuntimeDependencies();
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  await runtime.invoke("entity_360_snapshot_assemble", DTT_IDENTITY, {
    work_id: WORK_ID, entity_type: "work", identity: WORK_IDENTITY, expected_revision: 0,
    idempotency_key: "assemble-shadow", as_of: AT,
  });
  const compared = await runtime.invoke("entity_360_shadow_compare", DTT_IDENTITY, {
    work_id: WORK_ID, entity_id: entityId, snapshot_version: 1, legacy_context_digest: "d".repeat(64),
    legacy_outcome: "HOLD", idempotency_key: "shadow-1",
  });
  assert.equal(compared.receipt.comparison_evidence_state, "UNVERIFIED_CALLER_OBSERVATION");
  assert.equal(compared.receipt.release_evidence_eligible, false);
  assert.equal(compared.receipt.receipt_attestation.purpose, "entity360-shadow-comparison-v1");
  assert.equal(compared.receipt.production_decision_changed, false);
  assert.equal(compared.execution_authorized, false);
  const metrics = await runtime.invoke("entity_360_metrics_read", DTT_IDENTITY, {
    work_id: WORK_ID,
  });
  assert.equal(metrics.shadow_comparison_count, 1);
  assert.equal(metrics.unverified_shadow_comparison_count, 1);
  assert.equal(metrics.core_hold_count, 0);
  assert.equal(metrics.core_hold_correlated_count, 0);
  assert.equal(metrics.core_hold_correlation_rate, 0);
  assert.equal(metrics.core_insufficient_context_count, 0);
  assert.equal(metrics.core_insufficient_context_correlated_count, 0);
  assert.equal(metrics.core_insufficient_context_correlation_rate, 0);
  assert.equal(metrics.execution_authorized, false);
});

test("Core-only current-path observation assembles attested shadow evidence without authority", async () => {
  const { store, adapterRegistry } = memoryRuntimeDependencies();
  const runtime = createEntity360Runtime({ store, adapterRegistry, policy: POLICY, ontology: ONTOLOGY,
    mode: "SHADOW", now: () => Date.parse(AT) });
  await runtime.initialize();
  const input = { work_id: WORK_ID, preflight: workPreflight() };

  await assert.rejects(() => runtime.observeCurrentPath(DTT_IDENTITY, input),
    (error) => error.code === "entity360_shadow_observer_authority_required" && error.status === 403);
  const actorSpoof = { ...CORE_SHADOW_OBSERVER_IDENTITY, actor_id: "agent:shadow-spoof" };
  await assert.rejects(() => runtime.observeCurrentPath(actorSpoof, input),
    /entity360_shadow_observer_authority_required/u);
  const scopeSpoof = { ...CORE_SHADOW_OBSERVER_IDENTITY,
    authority_scope: [ENTITY_360_SHADOW_OBSERVER_SCOPE, "entity360:shadow-admin"] };
  await assert.rejects(() => runtime.observeCurrentPath(scopeSpoof, input),
    /entity360_shadow_observer_authority_required/u);

  const result = await runtime.observeCurrentPath(CORE_SHADOW_OBSERVER_IDENTITY, input);
  assert.equal(result.schema_version, "entity_360_automatic_shadow_observation_result_v1");
  assert.equal(result.observation.current_path_outcome, "HOLD");
  assert.equal(result.observation.observation_attestation.purpose,
    "entity360-current-path-observation-v1");
  assert.equal(result.snapshot.qualification_attestation.purpose,
    "entity360-qualified-context-v1");
  assert.equal(result.receipt.comparison_evidence_state,
    "VERIFIED_UNIVERSAL_CORE_CURRENT_PATH_OBSERVATION");
  assert.equal(result.receipt.release_evidence_eligible, true);
  assert.equal(result.receipt.enforcement_evidence_eligible, false);
  assert.equal(result.receipt.receipt_attestation.purpose, "entity360-shadow-comparison-v1");
  assert.equal(result.production_decision_changed, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.authorization_effect, "NONE");
  assert.equal(result.observation.execution_authorized, false);
  assert.equal(result.snapshot.execution_authorized, false);
  assert.equal(result.receipt.execution_authorized, false);
  assert.equal(verifyEntity360Snapshot(result.snapshot, { policy: POLICY, ontology: ONTOLOGY }).valid,
    true);

  const metrics = await runtime.invoke("entity_360_metrics_read", DTT_IDENTITY, {
    work_id: WORK_ID,
  });
  assert.equal(metrics.shadow_comparison_count, 1);
  assert.equal(metrics.core_hold_count, 1);
  assert.equal(metrics.core_hold_correlated_count, 0);
  assert.equal(metrics.core_hold_correlation_rate, 0);
  assert.equal(metrics.unverified_shadow_comparison_count, 0);
  assert.equal(metrics.execution_authorized, false);
});
