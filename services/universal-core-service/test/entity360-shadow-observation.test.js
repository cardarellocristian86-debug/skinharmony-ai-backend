import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerifiedEntity360CurrentPathObservation,
  compareVerifiedEntity360CurrentPath,
  verifyEntity360ShadowReceiptAttestation,
} from "../src/entity360ShadowObservation.js";
import { createHostNativeDomainSigner } from "../src/hostNativeGovernance.js";

const TENANT = "tenant-entity360-shadow";
const WORK_ID = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
const OTHER_WORK_ID = "11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-25T10:00:00.000Z";
const DOMAIN_SIGNER = createHostNativeDomainSigner({
  signingSecret: "entity360-shadow-observation-test-secret-0000000000001",
});

function preflight(overrides = {}) {
  return {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: "preflight_22222222-2222-4222-8222-222222222222",
    tenant_id: TENANT,
    state: "routed_waiting_for_core_verdict",
    work_binding: { work_id: WORK_ID, project_id: "nyra_conversational_runtime" },
    tenant_work_gallery: {
      tenant_id: TENANT,
      available: true,
      state: "ready",
      works: [{ work_id: WORK_ID, project_id: "nyra_conversational_runtime" }],
    },
    governance: { execution_allowed_by_preflight: false },
    request: { summary: "Implement Entity 360" },
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    tenant_scope: TENANT,
    project_work_linkage: { work_id: WORK_ID },
    deterministic_immutable_digest: "d".repeat(64),
    context_status: "READY",
    core_review_requirement: {
      admissible_outcomes: ["ALLOW", "HOLD", "BLOCK", "INSUFFICIENT_CONTEXT"],
    },
    ...overrides,
  };
}

test("verified Core preflight observation produces non-authoritative release-grade shadow evidence", () => {
  const observation = buildVerifiedEntity360CurrentPathObservation({
    tenant_id: TENANT,
    work_id: WORK_ID,
    preflight: preflight(),
    observed_at: OBSERVED_AT,
    domain_signer: DOMAIN_SIGNER,
  });
  assert.equal(observation.current_path_outcome, "HOLD");
  assert.equal(observation.execution_authorized, false);

  const receipt = compareVerifiedEntity360CurrentPath({ snapshot: snapshot(), observation,
    domain_verifier: DOMAIN_SIGNER, domain_signer: DOMAIN_SIGNER });
  assert.equal(receipt.comparison_evidence_state,
    "VERIFIED_UNIVERSAL_CORE_CURRENT_PATH_OBSERVATION");
  assert.equal(receipt.release_evidence_eligible, true);
  assert.equal(receipt.release_evidence_scope, "SHADOW_EVALUATION_ONLY");
  assert.equal(receipt.enforcement_evidence_eligible, false);
  assert.equal(receipt.production_decision_changed, false);
  assert.equal(receipt.execution_authorized, false);
  assert.equal(receipt.diverged, false);
  assert.equal(verifyEntity360ShadowReceiptAttestation(receipt, DOMAIN_SIGNER)
    .comparison_digest, receipt.comparison_digest);
  assert.throws(() => verifyEntity360ShadowReceiptAttestation({
    ...receipt, legacy_outcome: "ALLOW",
  }, DOMAIN_SIGNER), /entity360_attestation_verification_failed/u);
});

test("verified observation fails closed on tampering and cross-Work comparison", () => {
  const observation = buildVerifiedEntity360CurrentPathObservation({
    tenant_id: TENANT,
    work_id: WORK_ID,
    preflight: preflight(),
    observed_at: OBSERVED_AT,
    domain_signer: DOMAIN_SIGNER,
  });
  assert.throws(() => compareVerifiedEntity360CurrentPath({
    snapshot: snapshot(),
    observation: { ...observation, current_path_outcome: "ALLOW" },
    domain_verifier: DOMAIN_SIGNER,
    domain_signer: DOMAIN_SIGNER,
  }), /entity360_attestation_verification_failed/u);
  assert.throws(() => compareVerifiedEntity360CurrentPath({
    snapshot: snapshot({ project_work_linkage: { work_id: OTHER_WORK_ID } }),
    observation,
    domain_verifier: DOMAIN_SIGNER,
    domain_signer: DOMAIN_SIGNER,
  }), /entity360_current_path_snapshot_binding_mismatch/u);
});

test("current-path observation requires one canonical Gallery binding and consistent preflight state", () => {
  assert.throws(() => buildVerifiedEntity360CurrentPathObservation({
    tenant_id: TENANT,
    work_id: WORK_ID,
    preflight: preflight({ tenant_work_gallery: {
      tenant_id: TENANT, available: true, state: "ready",
      works: [{ work_id: WORK_ID }, { work_id: WORK_ID }],
    } }),
    observed_at: OBSERVED_AT,
    domain_signer: DOMAIN_SIGNER,
  }), /entity360_current_path_canonical_gallery_binding_required/u);
  assert.throws(() => buildVerifiedEntity360CurrentPathObservation({
    tenant_id: TENANT,
    work_id: WORK_ID,
    preflight: preflight({ state: "ready_read_only",
      governance: { execution_allowed_by_preflight: false } }),
    observed_at: OBSERVED_AT,
    domain_signer: DOMAIN_SIGNER,
  }), /entity360_current_path_execution_state_inconsistent/u);
});
