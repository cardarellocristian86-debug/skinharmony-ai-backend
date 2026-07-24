import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { createNyraDeepV2EvidenceLedger } from "../src/nyraDeepV2EvidenceLedger.js";
import { createNyraDeepBranchV2Attester } from "../src/nyraDeepBranchV2Attestation.js";

const TENANT = "codexai";
const REQUEST = "nyra-deep-v2-attestation-test";
const BRANCH = "context_intelligence";
const SUBBRANCH = "request_normalization";
const NOW = 1_780_000_000_000;
const require = createRequire(import.meta.url);
const federationRuntime = require("../../../personal-control-center/lib/nyra-deep-branch-v2-federation.js");
const nyraRuntime = require("../../../personal-control-center/lib/nyra-deep-branch-v2.js");
const FEDERATION_SERVICE_KEY = "nyra-deep-branch-v2-federation-test-service-key-0123456789";

function createHarness() {
  const keys = crypto.generateKeyPairSync("ed25519");
  const ledger = createNyraDeepV2EvidenceLedger({
    secret: "nyra-deep-v2-attestation-ledger-secret-0123456789",
    now: () => NOW,
  });
  const attester = createNyraDeepBranchV2Attester({
    ledger,
    signingPrivateKey: keys.privateKey,
    signingPublicKey: keys.publicKey,
    now: () => NOW,
  });
  return { ledger, attester, publicKey: keys.publicKey };
}

function coreInput(overrides = {}) {
  return {
    tenantId: TENANT,
    requestId: REQUEST,
    domainPackId: "skinharmony",
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    nyraNetwork: { opened_branches: [{ id: BRANCH, status: "opened" }] },
    branchContext: { branch_id: BRANCH, source: "core-router" },
    workPreflight: { preflight_id: "preflight-nyra-v2", state: "ready_read_only", mandatory: true },
    selectedByCore: { state: "ready", risk_band: "low", control_level: "observe" },
    ...overrides,
  };
}

function operationalEnvelope() {
  const loaded = nyraRuntime.loadCatalog({ runtimeMode: "lazy" });
  const envelope = {
    schema_version: "nyra_deep_branch_v2_core_envelope_v1",
    issuer: "skinharmony-universal-core",
    audience: "skinharmony-nyra-core",
    tenant_id: TENANT,
    request_id: "mcpv2_1234567890abcdef1234567890abcdef",
    domain_pack: "skinharmony",
    opened_branch_ids: [BRANCH],
    branch_allowlist: [BRANCH],
    preflight_id: "preflight-operational-test",
    core_policy_hash: "a".repeat(64),
    catalog_fingerprint: loaded.catalog.catalog_fingerprint,
    root_binding_hash: loaded.manifest.root_binding_hash,
    nonce: "b".repeat(64),
    issued_at: new Date(NOW - 100).toISOString(),
    expires_at: new Date(NOW + 30_000).toISOString(),
  };
  envelope.signature = federationRuntime.signCoreEnvelope(envelope, FEDERATION_SERVICE_KEY);
  return envelope;
}

function operationalPolicyContext(ledger, attester, envelope, { deniedNodeId = null, deniedPolicyId = "tenant_isolation" } = {}) {
  const requirements = attester.operationalPolicySnapshotRequirements({ branchId: BRANCH, subbranchId: SUBBRANCH });
  assert.equal(requirements.ok, true);
  const issuedAt = new Date(NOW).toISOString();
  return {
    schema_version: "nyra_deep_branch_v2_core_policy_snapshot_bundle_v1",
    policy_snapshots: requirements.requirements.map((requirement) => {
      const decision = requirement.node_id === deniedNodeId && requirement.policy_id === deniedPolicyId ? "DENY" : "ALLOW";
      const receipt = ledger.issueCorePolicyDecisionReceipt({
        tenantId: TENANT,
        requestId: envelope.request_id,
        branchId: BRANCH,
        subbranchId: SUBBRANCH,
        nodeId: requirement.node_id,
        policyId: requirement.policy_id,
        effect: requirement.effect,
        decision,
        preflightId: envelope.preflight_id,
        corePolicyHash: envelope.core_policy_hash,
        issuedAt,
        expiresAt: envelope.expires_at,
        observedAt: NOW,
      });
      assert.equal(receipt.ok, true);
      return {
        schema_version: "nyra_deep_branch_v2_core_policy_snapshot_v1",
        issuer: "skinharmony-universal-core",
        decision_id: receipt.decision_id,
        decision_receipt: receipt.decision_receipt,
        decision,
        tenant_id: TENANT,
        request_id: envelope.request_id,
        branch_id: BRANCH,
        subbranch_id: SUBBRANCH,
        node_id: requirement.node_id,
        policy_id: requirement.policy_id,
        effect: requirement.effect,
        preflight_id: envelope.preflight_id,
        core_policy_hash: envelope.core_policy_hash,
        issued_at: issuedAt,
        expires_at: envelope.expires_at,
      };
    }),
  };
}

function operationalFederationEnv(publicKey) {
  return {
    NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_MODE: "shadow",
    NYRA_DEEP_BRANCH_V2_BRANCHES: BRANCH,
    NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: TENANT,
    NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_FEDERATION_TENANT_ALLOWLIST: TENANT,
    NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET: FEDERATION_SERVICE_KEY,
    NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST: TENANT,
    NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_KEY_ID_ALLOWLIST: "universal-core-nyra-v2",
    NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_PUBLIC_KEYS: JSON.stringify({
      "universal-core-nyra-v2": publicKey.export({ type: "spki", format: "pem" }),
    }),
  };
}

function ingestCompleteEvidence({ ledger, attester, includeSensitiveValues = false } = {}) {
  const requirements = attester.requirementBindings({ branchId: BRANCH, subbranchId: SUBBRANCH });
  assert.equal(requirements.ok, true);
  const sources = requirements.requirement_bindings.map((_, index) => ({
    id: `source-${index}`,
    authority: "authoritative",
    url: includeSensitiveValues ? `https://private.example.test/source/${index}?token=NEVER_LEAK_SOURCE_TOKEN` : undefined,
  }));
  const claims = requirements.requirement_bindings.map((binding, index) => ({
    id: `claim-${index}`,
    source_ids: [`source-${index}`],
    authority: binding.authority_requirement,
    observed_at: NOW,
    content: includeSensitiveValues ? `PRIVATE_MEMORY_DO_NOT_SERIALIZE_${index}` : `claim-${index}`,
    source_url: includeSensitiveValues ? `https://private.example.test/claim/${index}?token=NEVER_LEAK_SOURCE_TOKEN` : undefined,
    metadata: includeSensitiveValues ? { user_memory: "NEVER_LEAK_MEMORY" } : {},
  }));
  const validated_claims = requirements.requirement_bindings.map((binding, index) => ({
    claim_id: `claim-${index}`,
    valid: true,
    authority: "authoritative",
    independent: binding.authority_requirement === "independent_corroboration",
    valid_until: NOW + 60_000,
    core_receipt: {
      schema_version: "nyra_deep_v2_core_source_receipt_bundle_v1",
      issuer: "skinharmony-universal-core",
      receipt_ids: [`ev_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`],
      sources: [{
        source_id: `source-${index}`,
        source_url_sha256: "a".repeat(64),
        content_sha256: "b".repeat(64),
        excerpt_sha256: "c".repeat(64),
      }],
    },
  }));
  const bindings = requirements.requirement_bindings.map((binding, index) => ({
    requirement_ref: binding.requirement_ref,
    node_ref: binding.node_ref,
    claim_id: `claim-${index}`,
  }));
  const ingestion = ledger.ingestResearchEvidence({
    tenantId: TENANT,
    requestId: REQUEST,
    evidencePack: {
      sources,
      claims,
      validated_claims,
      policy_atoms: requirements.policy_bindings
        .filter((binding) => binding.core_decision_required)
        .map((binding) => ({
          node_ref: binding.node_ref,
          policy_ref: binding.policy_ref,
          decision: "allow",
          observed_at: NOW,
        })),
    },
    bindings: {
      branch_id: BRANCH,
      subbranch_id: SUBBRANCH,
      evidence_session_id: "evidence-session-test",
      requirement_bindings: bindings,
    },
  });
  assert.equal(ingestion.ok, true);
  assert.equal(ingestion.missing_bindings.length, 0);
  return { requirements, ingestion };
}

test("attester builds and Ed25519-signs a complete six-node L2-to-L4 evidence package", () => {
  const { ledger, attester } = createHarness();
  const { ingestion } = ingestCompleteEvidence({ ledger, attester });
  const prepared = attester.prepare({ ...coreInput(), evidenceRefs: ingestion });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.attestation.nodes.length, 6);
  assert.deepEqual(prepared.attestation.nodes.map((node) => node.level), [2, 3, 4, 4, 4, 4]);
  assert.deepEqual(prepared.attestation.nodes.slice(2).map((node) => node.node_type), ["method", "strategy", "verifier", "metric"]);
  assert.equal(prepared.attestation.package_state, "attested");
  assert.equal(prepared.attestation.execution_authorized, false);
  assert.equal(prepared.attestation.core_final_authority, true);
  assert.equal(prepared.attestation.nodes.every((node) => node.state === "supported"), true);
  assert.equal(attester.verify(prepared.attestation, { tenantId: TENANT, requestId: REQUEST }).ok, true);
});

test("operational attestation hands verified evidence across MCP requests and drives all six nodes", () => {
  const { ledger, attester, publicKey } = createHarness();
  const { ingestion } = ingestCompleteEvidence({ ledger, attester });
  const envelope = operationalEnvelope();
  const handoff = ledger.resolveEvidenceSession({
    tenantId: TENANT,
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    recordRefs: ingestion.evidence_refs.map((item) => item.record_ref),
  });
  assert.equal(handoff.ok, true);
  assert.equal(handoff.evidence_session_ref, ingestion.evidence_session_ref);
  assert.equal(
    ledger.resolveEvidenceSession({
      tenantId: TENANT,
      branchId: "work_intake",
      subbranchId: SUBBRANCH,
      recordRefs: ingestion.evidence_refs.map((item) => item.record_ref),
    }).ok,
    false
  );
  const prepared = attester.prepareOperational({
    tenantId: TENANT,
    requestId: envelope.request_id,
    domainPackId: "skinharmony",
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    preflightId: envelope.preflight_id,
    corePolicyHash: envelope.core_policy_hash,
    envelopeBindingHash: federationRuntime.coreEnvelopeBindingHash(envelope),
    issuedAt: envelope.issued_at,
    expiresAt: envelope.expires_at,
    observedAt: NOW,
    evidenceRefs: ingestion,
    evidenceSessionRef: handoff.evidence_session_ref,
    corePolicyContext: operationalPolicyContext(ledger, attester, envelope),
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.state, "operational_attestation_ready");
  assert.equal(prepared.attestation.node_contexts.length, 6);
  assert.equal(attester.verifyOperational(prepared.attestation, { tenantId: TENANT, requestId: envelope.request_id }).ok, true);

  envelope.operational_attestation = prepared.attestation;
  envelope.signature = federationRuntime.signCoreEnvelope(envelope, FEDERATION_SERVICE_KEY);
  const federation = federationRuntime.createNyraDeepBranchV2Federation({
    env: operationalFederationEnv(publicKey),
    now: () => NOW,
  });
  const result = federation.evaluate(envelope);
  assert.equal(result.ok, true);
  assert.equal(result.state, "operational_advisory_verified_v1_authoritative");
  assert.equal(result.evaluation.all_nodes_verified, true);
  assert.equal(result.evaluation.lineage.nodes.every((node) => node.state === "advisory_verified"), true);

  const denied = attester.prepareOperational({
    tenantId: TENANT,
    requestId: envelope.request_id,
    domainPackId: "skinharmony",
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    preflightId: envelope.preflight_id,
    corePolicyHash: envelope.core_policy_hash,
    envelopeBindingHash: federationRuntime.coreEnvelopeBindingHash(envelope),
    issuedAt: envelope.issued_at,
    expiresAt: envelope.expires_at,
    observedAt: NOW,
    evidenceRefs: ingestion,
    evidenceSessionRef: handoff.evidence_session_ref,
    corePolicyContext: {
      core_trusted: true,
      tenant_id: TENANT,
      preflight_id: envelope.preflight_id,
      core_policy_hash: envelope.core_policy_hash,
      opened_branches: [{ id: BRANCH, status: "opened" }],
      tenant_isolation: true,
      preflight_state: "ready_read_only",
    },
  });
  assert.equal(denied.ok, true);
  assert.equal(denied.state, "operational_attestation_abstaining");
  const deniedPayload = JSON.parse(Buffer.from(denied.attestation.node_contexts[0].opaque_payload, "base64url").toString("utf8"));
  assert.equal(deniedPayload.policy_decisions.every((decision) => decision.decision === "DENY"), true);
});

test("each Core policy receipt DENY fails only its exact node while malformed receipts fail closed", () => {
  const { ledger, attester } = createHarness();
  const { ingestion } = ingestCompleteEvidence({ ledger, attester });
  const envelope = operationalEnvelope();
  const handoff = ledger.resolveEvidenceSession({
    tenantId: TENANT,
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    recordRefs: ingestion.evidence_refs.map((item) => item.record_ref),
  });
  assert.equal(handoff.ok, true);
  const common = {
    tenantId: TENANT,
    requestId: envelope.request_id,
    domainPackId: "skinharmony",
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    preflightId: envelope.preflight_id,
    corePolicyHash: envelope.core_policy_hash,
    envelopeBindingHash: federationRuntime.coreEnvelopeBindingHash(envelope),
    issuedAt: envelope.issued_at,
    expiresAt: envelope.expires_at,
    observedAt: NOW,
    evidenceRefs: ingestion,
    evidenceSessionRef: handoff.evidence_session_ref,
  };
  const requirements = attester.operationalPolicySnapshotRequirements({ branchId: BRANCH, subbranchId: SUBBRANCH });
  const nodeIds = [...new Set(requirements.requirements.map((item) => item.node_id))];
  assert.equal(nodeIds.length, 6);
  assert.equal(requirements.requirements.length, 12);

  for (const deniedRequirement of requirements.requirements) {
    const prepared = attester.prepareOperational({
      ...common,
      corePolicyContext: operationalPolicyContext(ledger, attester, envelope, {
        deniedNodeId: deniedRequirement.node_id,
        deniedPolicyId: deniedRequirement.policy_id,
      }),
    });
    const label = `${deniedRequirement.node_id}:${deniedRequirement.policy_id}:${deniedRequirement.effect}`;
    assert.equal(prepared.ok, true, label);
    assert.equal(prepared.state, "operational_attestation_abstaining", label);
    const payloadByNodeId = new Map(prepared.attestation.node_contexts.map((context) => [
      context.node_id,
      JSON.parse(Buffer.from(context.opaque_payload, "base64url").toString("utf8")),
    ]));
    for (const [nodeId, payload] of payloadByNodeId) {
      for (const decision of payload.policy_decisions) {
        const isTarget = nodeId === deniedRequirement.node_id
          && decision.policy_id === deniedRequirement.policy_id
          && decision.effect === deniedRequirement.effect;
        assert.equal(decision.decision, isTarget ? "DENY" : "ALLOW", `${label}:${nodeId}:${decision.policy_id}`);
      }
    }
  }

  const missingDecisionId = operationalPolicyContext(ledger, attester, envelope);
  delete missingDecisionId.policy_snapshots[0].decision_id;
  const malformed = attester.prepareOperational({ ...common, corePolicyContext: missingDecisionId });
  assert.equal(malformed.ok, true);
  assert.equal(malformed.state, "operational_attestation_abstaining");
  for (const context of malformed.attestation.node_contexts) {
    const payload = JSON.parse(Buffer.from(context.opaque_payload, "base64url").toString("utf8"));
    assert.equal(payload.policy_decisions.every((decision) => decision.decision === "DENY"), true);
  }
});

test("strict Core policy receipts reject tampered scope, time, hash, duplicate ID, and receipt hash", () => {
  const { ledger, attester } = createHarness();
  const { ingestion } = ingestCompleteEvidence({ ledger, attester });
  const envelope = operationalEnvelope();
  const handoff = ledger.resolveEvidenceSession({
    tenantId: TENANT,
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    recordRefs: ingestion.evidence_refs.map((item) => item.record_ref),
  });
  assert.equal(handoff.ok, true);
  const common = {
    tenantId: TENANT,
    requestId: envelope.request_id,
    domainPackId: "skinharmony",
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    preflightId: envelope.preflight_id,
    corePolicyHash: envelope.core_policy_hash,
    envelopeBindingHash: federationRuntime.coreEnvelopeBindingHash(envelope),
    issuedAt: envelope.issued_at,
    expiresAt: envelope.expires_at,
    observedAt: NOW,
    evidenceRefs: ingestion,
    evidenceSessionRef: handoff.evidence_session_ref,
  };
  const scenarios = [
    ["expired", (bundle) => { bundle.policy_snapshots[0].expires_at = new Date(NOW - 1).toISOString(); }],
    ["future_issued", (bundle) => { bundle.policy_snapshots[0].issued_at = new Date(NOW + 1).toISOString(); }],
    ["outside_envelope", (bundle) => { bundle.policy_snapshots[0].expires_at = new Date(Date.parse(envelope.expires_at) + 1).toISOString(); }],
    ["request_scope", (bundle) => { bundle.policy_snapshots[0].request_id = "mcpv2_ffffffffffffffffffffffffffffffff"; }],
    ["branch_scope", (bundle) => { bundle.policy_snapshots[0].branch_id = "work_intake"; }],
    ["policy_hash", (bundle) => { bundle.policy_snapshots[0].core_policy_hash = "b".repeat(64); }],
    ["duplicate_decision_id", (bundle) => { bundle.policy_snapshots[1].decision_id = bundle.policy_snapshots[0].decision_id; }],
    ["receipt_hash", (bundle) => { bundle.policy_snapshots[0].decision_receipt.receipt_hash = "d".repeat(64); }],
  ];
  for (const [name, mutate] of scenarios) {
    const bundle = operationalPolicyContext(ledger, attester, envelope);
    mutate(bundle);
    const prepared = attester.prepareOperational({ ...common, corePolicyContext: bundle });
    assert.equal(prepared.ok, true, name);
    assert.equal(prepared.state, "operational_attestation_abstaining", name);
    for (const context of prepared.attestation.node_contexts) {
      const payload = JSON.parse(Buffer.from(context.opaque_payload, "base64url").toString("utf8"));
      assert.equal(payload.policy_decisions.every((decision) => decision.decision === "DENY"), true, name);
    }
  }
});

test("attester discovers a six-node L2-to-L4 lineage for every live lazy shard", () => {
  const { attester } = createHarness();
  const loaded = nyraRuntime.loadCatalog({ runtimeMode: "lazy" });
  let shardCount = 0;
  for (const shard of loaded.manifest.shards) {
    const result = attester.requirementBindings({
      branchId: shard.branch_id,
      subbranchId: shard.subbranch_id,
    });
    assert.equal(result.ok, true, `${shard.branch_id}.${shard.subbranch_id}`);
    assert.equal(new Set(result.requirement_bindings.map((binding) => binding.node_ref)).size, 6);
    assert.equal(result.requirement_bindings.every((binding) => /^req_[a-f0-9]{64}$/.test(binding.requirement_ref)), true);
    assert.equal(new Set(result.policy_bindings.map((binding) => binding.node_ref)).size, 6);
    assert.equal(result.core_policy_snapshot_requirements.length > 0, true);
    assert.equal(result.core_policy_snapshot_requirements.every((binding) => (
      binding.branch_id === shard.branch_id
      && binding.subbranch_id === shard.subbranch_id
      && binding.core_decision_required === true
    )), true);
    const operationalRequirements = attester.operationalPolicySnapshotRequirements({
      branchId: shard.branch_id,
      subbranchId: shard.subbranch_id,
    });
    assert.equal(operationalRequirements.ok, true);
    assert.deepEqual(operationalRequirements.requirements, result.core_policy_snapshot_requirements);
    shardCount += 1;
  }
  assert.equal(shardCount, 239);
});

test("missing evidence produces a valid abstaining package rather than synthetic support", () => {
  const { attester } = createHarness();
  const prepared = attester.prepare(coreInput());

  assert.equal(prepared.ok, true);
  assert.equal(prepared.attestation.package_state, "abstaining");
  assert.equal(prepared.attestation.nodes.every((node) => node.state === "abstaining"), true);
  assert.equal(
    prepared.attestation.nodes.flatMap((node) => node.evidence_atoms).every((atom) => atom.state === "missing" && atom.evidence_record_refs.length === 0),
    true
  );
  assert.equal(attester.verify(prepared.attestation, { tenantId: TENANT, requestId: REQUEST }).ok, true);
});

test("ledger rejects caller-declared valid evidence without a live Core source receipt", () => {
  const { ledger, attester } = createHarness();
  const requirement = attester.requirementBindings({ branchId: BRANCH, subbranchId: SUBBRANCH }).requirement_bindings[0];
  const coreReceipt = {
    schema_version: "nyra_deep_v2_core_source_receipt_bundle_v1",
    issuer: "skinharmony-universal-core",
    receipt_ids: ["ev_00000000-0000-4000-8000-000000000001"],
    sources: [{
      source_id: "source-proof",
      source_url_sha256: "a".repeat(64),
      content_sha256: "b".repeat(64),
      excerpt_sha256: "c".repeat(64),
    }],
  };
  const ingest = (requestId, validation) => ledger.ingestResearchEvidence({
    tenantId: TENANT,
    requestId,
    evidencePack: {
      sources: [{ id: "source-proof" }],
      claims: [{ id: "claim-proof", source_ids: ["source-proof"], content: "bounded proof" }],
      validated_claims: [{
        claim_id: "claim-proof",
        valid: true,
        authority: "authoritative",
        independent: false,
        ...validation,
      }],
    },
    bindings: [{
      requirement_ref: requirement.requirement_ref,
      node_ref: requirement.node_ref,
      claim_id: "claim-proof",
    }],
  });

  const bare = ingest("nyra-deep-v2-bare-validation", {});
  assert.equal(bare.ok, true);
  assert.equal(bare.evidence_refs.length, 0);
  assert.equal(bare.missing_bindings.length, 1);

  const expired = ingest("nyra-deep-v2-expired-receipt", {
    valid_until: NOW - 1,
    core_receipt: coreReceipt,
  });
  assert.equal(expired.ok, true);
  assert.equal(expired.evidence_refs.length, 0);
  assert.equal(expired.missing_bindings.length, 1);

  const accepted = ingest("nyra-deep-v2-live-receipt", {
    valid_until: NOW + 60_000,
    core_receipt: coreReceipt,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.evidence_refs.length, 1);
  const record = ledger.resolve({ tenantId: TENANT, requestId: "nyra-deep-v2-live-receipt" }).records[0];
  assert.match(record.core_receipt_ref, /^[a-f0-9]{64}$/);
});

test("ledger and attestation reject tenant confusion and tampering", () => {
  const { ledger, attester } = createHarness();
  const { ingestion } = ingestCompleteEvidence({ ledger, attester });
  const records = ledger.resolve({ tenantId: TENANT, requestId: REQUEST });
  assert.equal(records.ok, true);
  assert.equal(records.records.length > 0, true);
  const tamperedRecord = { ...records.records[0], authority: "unverified" };
  assert.equal(ledger.verifyRecord(tamperedRecord), false);
  assert.equal(ledger.resolve({ tenantId: "other-tenant", requestId: REQUEST }).records.length, 0);

  const prepared = attester.prepare({ ...coreInput(), evidenceRefs: ingestion });
  assert.equal(prepared.ok, true);
  assert.equal(attester.verify(prepared.attestation, { tenantId: "other-tenant", requestId: REQUEST }).ok, false);
  const tamperedEnvelope = { ...prepared.attestation, package_state: "attested-and-executing" };
  assert.equal(attester.verify(tamperedEnvelope, { tenantId: TENANT, requestId: REQUEST }).ok, false);
});

test("serialized ledger and attestation never contain raw memory, text, or source URLs", () => {
  const { ledger, attester } = createHarness();
  const { ingestion } = ingestCompleteEvidence({ ledger, attester, includeSensitiveValues: true });
  const prepared = attester.prepare({
    ...coreInput({ selectedByCore: { note: "NEVER_LEAK_SELECTED_BY_CORE_TEXT" } }),
    evidenceRefs: ingestion,
  });
  assert.equal(prepared.ok, true);
  const envelope = operationalEnvelope();
  const handoff = ledger.resolveEvidenceSession({
    tenantId: TENANT,
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    recordRefs: ingestion.evidence_refs.map((item) => item.record_ref),
  });
  assert.equal(handoff.ok, true);
  const operational = attester.prepareOperational({
    tenantId: TENANT,
    requestId: envelope.request_id,
    branchId: BRANCH,
    subbranchId: SUBBRANCH,
    preflightId: envelope.preflight_id,
    corePolicyHash: envelope.core_policy_hash,
    envelopeBindingHash: federationRuntime.coreEnvelopeBindingHash(envelope),
    issuedAt: envelope.issued_at,
    expiresAt: envelope.expires_at,
    observedAt: NOW,
    evidenceRefs: ingestion,
    evidenceSessionRef: handoff.evidence_session_ref,
    corePolicyContext: operationalPolicyContext(ledger, attester, envelope),
  });
  assert.equal(operational.ok, true);
  const serialized = JSON.stringify({
    ledger: ledger.resolve({ tenantId: TENANT, requestId: REQUEST }),
    attestation: prepared.attestation,
    operational_attestation: operational.attestation,
  });
  for (const forbidden of [
    "PRIVATE_MEMORY_DO_NOT_SERIALIZE",
    "NEVER_LEAK_SOURCE_TOKEN",
    "NEVER_LEAK_MEMORY",
    "NEVER_LEAK_SELECTED_BY_CORE_TEXT",
    "private.example.test",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
