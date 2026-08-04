import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import {
  createNyraDeepBranchV2Attester,
  NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_BUNDLE_SCHEMA_VERSION,
  NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_ISSUER,
  NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_SCHEMA_VERSION,
} from "../src/nyraDeepBranchV2Attestation.js";
import {
  createNyraDeepV2EvidenceLedger,
  NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_ISSUER,
  NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_SCHEMA_VERSION,
} from "../src/nyraDeepV2EvidenceLedger.js";
import { nyraBranchCatalog, routeNyraBranches } from "../src/nyraBranchNetwork.js";

const require = createRequire(import.meta.url);
const nyraRuntime = require("../../../personal-control-center/lib/nyra-deep-branch-v2.js");
const federationRuntime = require("../../../personal-control-center/lib/nyra-deep-branch-v2-federation.js");

const TENANT_ID = "codexai";
const NOW = 1_780_000_000_000;
const SERVICE_KEY = crypto.randomBytes(32).toString("hex");
const LEDGER_SECRET = crypto.randomBytes(32).toString("hex");
const KEY_ID = "universal-core-nyra-v2-coverage";
const CORE_SKINHARMONY_CATALOG = nyraBranchCatalog("skinharmony");
const CORE_BRANCH_IDS = new Set(CORE_SKINHARMONY_CATALOG.branches.map((branch) => branch.id));
const EXPECTED_V2_SUBBRANCH_COUNT = 299;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function entitlementPackForBranch(branchId) {
  if (branchId === "suite_domain") return "suite";
  if (branchId === "smartdesk_domain") return "smartdesk";
  if (branchId === "analyzer_domain") return "analyzer";
  return "generic";
}

function coreEnvelope({ loaded, branchId, requestId, nonce }) {
  return {
    schema_version: "nyra_deep_branch_v2_core_envelope_v1",
    issuer: "skinharmony-universal-core",
    audience: "skinharmony-nyra-core",
    tenant_id: TENANT_ID,
    request_id: requestId,
    domain_pack: "skinharmony",
    catalog_scope: "skinharmony",
    entitlement_domain_pack: entitlementPackForBranch(branchId),
    opened_branch_ids: [branchId],
    branch_allowlist: [branchId],
    preflight_id: `preflight-${requestId}`,
    core_policy_hash: sha256(`core-policy:${requestId}`),
    catalog_fingerprint: loaded.catalog.catalog_fingerprint,
    root_binding_hash: loaded.manifest.root_binding_hash,
    nonce,
    issued_at: new Date(NOW - 100).toISOString(),
    expires_at: new Date(NOW + 30_000).toISOString(),
  };
}

function corePolicyBundle({ ledger, attester, envelope, branchId, subbranchId }) {
  const discovery = attester.operationalPolicySnapshotRequirements({ branchId, subbranchId });
  assert.equal(discovery.ok, true, `${branchId}.${subbranchId}: policy requirements`);
  const issuedAt = new Date(NOW).toISOString();
  return {
    schema_version: NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_BUNDLE_SCHEMA_VERSION,
    policy_snapshots: discovery.requirements.map((requirement) => {
      const receipt = ledger.issueCorePolicyDecisionReceipt({
        tenantId: TENANT_ID,
        requestId: envelope.request_id,
        branchId,
        subbranchId,
        nodeId: requirement.node_id,
        policyId: requirement.policy_id,
        effect: requirement.effect,
        decision: "ALLOW",
        preflightId: envelope.preflight_id,
        corePolicyHash: envelope.core_policy_hash,
        issuedAt,
        expiresAt: envelope.expires_at,
        observedAt: NOW,
      });
      assert.equal(receipt.ok, true, `${branchId}.${subbranchId}:${requirement.node_id}:${requirement.policy_id}`);
      assert.equal(receipt.decision_receipt.schema_version, NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_SCHEMA_VERSION);
      assert.equal(receipt.decision_receipt.issuer, NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_ISSUER);
      return {
        schema_version: NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_SCHEMA_VERSION,
        issuer: NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_ISSUER,
        decision_id: receipt.decision_id,
        decision_receipt: receipt.decision_receipt,
        decision: "ALLOW",
        tenant_id: TENANT_ID,
        request_id: envelope.request_id,
        branch_id: branchId,
        subbranch_id: subbranchId,
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

function preparedEvidence({ ledger, attester, branchId, subbranchId, requestId }) {
  const requirements = attester.requirementBindings({ branchId, subbranchId });
  assert.equal(requirements.ok, true, `${branchId}.${subbranchId}: requirement discovery`);
  const sources = [];
  const claims = [];
  const validatedClaims = [];
  const bindings = [];
  for (const [index, requirement] of requirements.requirement_bindings.entries()) {
    const suffix = `${branchId}_${subbranchId}_${index + 1}`;
    const sourceId = `source_${suffix}`;
    const claimId = `claim_${suffix}`;
    sources.push({ id: sourceId });
    claims.push({
      id: claimId,
      source_ids: [sourceId],
      content: `Core-qualified evidence atom ${suffix}`,
      observed_at: NOW,
    });
    validatedClaims.push({
      claim_id: claimId,
      valid: true,
      authority: "authoritative",
      independent: requirement.authority_requirement === "independent_corroboration",
      valid_until: NOW + 60_000,
      core_receipt: {
        schema_version: "nyra_deep_v2_core_source_receipt_bundle_v1",
        issuer: "skinharmony-universal-core",
        receipt_ids: [`ev_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`],
        sources: [{
          source_id: sourceId,
          source_url_sha256: sha256(`url:${suffix}`),
          content_sha256: sha256(`content:${suffix}`),
          excerpt_sha256: sha256(`excerpt:${suffix}`),
        }],
      },
    });
    bindings.push({
      requirement_ref: requirement.requirement_ref,
      node_ref: requirement.node_ref,
      source_ids: [sourceId],
      claim_ids: [claimId],
    });
  }
  const ingested = ledger.ingestResearchEvidence({
    tenantId: TENANT_ID,
    requestId,
    evidencePack: { sources, claims, validated_claims: validatedClaims },
    bindings: {
      branch_id: branchId,
      subbranch_id: subbranchId,
      evidence_session_id: `session_${branchId}_${subbranchId}`,
      requirement_bindings: bindings,
    },
  });
  assert.equal(ingested.ok, true, `${branchId}.${subbranchId}: evidence ingest`);
  assert.deepEqual(ingested.missing_bindings, [], `${branchId}.${subbranchId}: evidence completeness`);
  assert.equal(ingested.evidence_refs.length, requirements.requirement_bindings.length);
  const handoff = ledger.resolveEvidenceSession({
    tenantId: TENANT_ID,
    branchId,
    subbranchId,
    recordRefs: ingested.evidence_refs.map((item) => item.record_ref),
    now: NOW,
  });
  assert.equal(handoff.ok, true, `${branchId}.${subbranchId}: evidence handoff`);
  return { ingested, handoff };
}

test("all live V2 shards are Core-opened, attested, and operationally evaluated as an exact L2-to-L4 lineage", () => {
  const loaded = nyraRuntime.loadCatalog({ forceReload: true, runtimeMode: "lazy" });
  assert.equal(loaded.ok, true, loaded.validation.errors.join("\n"));
  assert.equal(loaded.manifest.shards.length, EXPECTED_V2_SUBBRANCH_COUNT);
  assert.equal(loaded.validation.integrity.unchecked_shards, 0);
  const branches = [...new Set(loaded.manifest.shards.map((shard) => shard.branch_id))];
  assert(branches.every((branchId) => CORE_BRANCH_IDS.has(branchId)));
  assert.equal(branches.includes("tenant_work_coordination"), false);
  assert.equal(branches.includes("agent_change_interlock"), false);

  const keys = crypto.generateKeyPairSync("ed25519");
  const ledger = createNyraDeepV2EvidenceLedger({ secret: LEDGER_SECRET, now: () => NOW });
  const attester = createNyraDeepBranchV2Attester({
    ledger,
    signingPrivateKey: keys.privateKey,
    signingPublicKey: keys.publicKey,
    keyId: KEY_ID,
    now: () => NOW,
  });
  const federation = federationRuntime.createNyraDeepBranchV2Federation({
    now: () => NOW,
    env: {
      NYRA_DEEP_BRANCH_V2_ENABLED: "true",
      NYRA_DEEP_BRANCH_V2_MODE: "active",
      NYRA_DEEP_BRANCH_V2_BRANCHES: branches.join(","),
      NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: TENANT_ID,
      NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED: "true",
      NYRA_DEEP_BRANCH_V2_FEDERATION_TENANT_ALLOWLIST: TENANT_ID,
      NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET: SERVICE_KEY,
      NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED: "true",
      NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST: TENANT_ID,
      NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_KEY_ID_ALLOWLIST: KEY_ID,
      NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_PUBLIC_KEYS: JSON.stringify({
        [KEY_ID]: keys.publicKey.export({ type: "spki", format: "pem" }),
      }),
    },
  });

  let evaluatedNodes = 0;
  let retainedEvidenceAtoms = 0;
  for (const [index, shard] of loaded.manifest.shards.entries()) {
    const branchId = shard.branch_id;
    const subbranchId = shard.subbranch_id;
    const label = `${branchId}.${subbranchId}`;
    // This is the V1 Core branch router, not the V2 catalog.  A V2 shard is
    // reachable only after Core emits this opened branch record.
    const coreRoute = routeNyraBranches({
      text: `Nyra Deep V2 bounded evaluation for ${label}`,
      requestedBranches: [branchId],
      domainPackId: entitlementPackForBranch(branchId),
    });
    const opened = coreRoute.opened_branches.find((branch) => branch.id === branchId);
    assert.equal(coreRoute.opened_by, "universal_core");
    assert(opened, `${label}: V1 Core did not open requested branch`);
    assert(opened.subbranches.includes(subbranchId), `${label}: V1 Core route lacks requested subbranch`);

    const preparationRequestId = `coverage_prepare_${index}`;
    const { ingested, handoff } = preparedEvidence({
      ledger,
      attester,
      branchId,
      subbranchId,
      requestId: preparationRequestId,
    });
    retainedEvidenceAtoms += ingested.evidence_refs.length;
    const evaluationRequestId = `coverage_evaluate_${index}`;
    const envelope = coreEnvelope({
      loaded,
      branchId,
      requestId: evaluationRequestId,
      nonce: crypto.randomBytes(32).toString("hex"),
    });
    const prepared = attester.prepareOperational({
      tenantId: TENANT_ID,
      requestId: evaluationRequestId,
      domainPackId: "skinharmony",
      entitlementDomainPackId: envelope.entitlement_domain_pack,
      branchId,
      subbranchId,
      preflightId: envelope.preflight_id,
      corePolicyHash: envelope.core_policy_hash,
      envelopeBindingHash: federationRuntime.coreEnvelopeBindingHash(envelope),
      issuedAt: envelope.issued_at,
      expiresAt: envelope.expires_at,
      observedAt: NOW,
      evidenceRefs: ingested.evidence_refs.map((item) => item.record_ref),
      evidenceSessionRef: handoff.evidence_session_ref,
      corePolicyContext: corePolicyBundle({ ledger, attester, envelope, branchId, subbranchId }),
    });
    assert.equal(prepared.ok, true, `${label}: operational attestation`);
    assert.equal(prepared.state, "operational_attestation_ready", `${label}: operational qualification`);
    assert.equal(
      prepared.attestation.node_contexts.length,
      shard.node_count,
      `${label}: opaque context coverage`
    );
    assert.equal(attester.verifyOperational(prepared.attestation, {
      tenantId: TENANT_ID,
      requestId: evaluationRequestId,
    }).ok, true, `${label}: attestation signature`);

    envelope.operational_attestation = prepared.attestation;
    envelope.signature = federationRuntime.signCoreEnvelope(envelope, SERVICE_KEY);
    const result = federation.evaluate(envelope);
    assert.equal(result.ok, true, `${label}: federation response`);
    assert.equal(result.state, "operational_advisory_verified_v1_authoritative", `${label}: runtime state`);
    assert.equal(
      result.evaluation.evaluated_node_count,
      shard.node_count,
      `${label}: evaluated node count`
    );
    assert.equal(result.evaluation.all_nodes_verified, true, `${label}: verified lineage`);
    assert.deepEqual(result.evaluation.lineage.nodes.map((node) => node.level), [2, 3, 4, 4, 4, 4], `${label}: levels`);
    assert(result.evaluation.lineage.nodes.every((node) => node.state === "advisory_verified"), `${label}: node runtime execution`);
    assert.equal(result.execution_authorized, false, `${label}: execution authority`);
    assert.equal(result.core_final_authority, true, `${label}: Core authority`);
    evaluatedNodes += result.evaluation.evaluated_node_count;
  }

  const expectedNodeCount = loaded.manifest.shards.reduce(
    (sum, shard) => sum + shard.node_count,
    0
  );
  assert.equal(loaded.manifest.topology.node_count, expectedNodeCount);
  assert.equal(evaluatedNodes, expectedNodeCount);
  assert(
    ledger.ledgerStats().record_count >= retainedEvidenceAtoms,
    "coverage ledger did not retain every qualified evidence atom"
  );
});
