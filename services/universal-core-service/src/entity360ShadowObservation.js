import {
  entity360Digest,
} from "./entity360.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PREFLIGHT_ID = /^preflight_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CURRENT_PATH_STATES = Object.freeze({
  ready_read_only: "ALLOW",
  memory_recall_required: "INSUFFICIENT_CONTEXT",
  routed_waiting_for_core_verdict: "HOLD",
  routed_owner_confirmed_waiting_for_core_verdict: "HOLD",
});
export const ENTITY_360_CURRENT_PATH_OBSERVATION_SIGNING_PURPOSE =
  "entity360-current-path-observation-v1";
export const ENTITY_360_SHADOW_RECEIPT_SIGNING_PURPOSE =
  "entity360-shadow-comparison-v1";
const ATTESTATION_KEYS = Object.freeze([
  "algorithm", "key_id", "purpose", "schema_version", "signature", "signer_domain",
]);

function fail(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function plain(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  return value;
}

function requiredText(value, code, max, pattern = null) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) fail(code);
  return normalized;
}

function canonicalTimestamp(value, code) {
  const normalized = requiredText(value, code, 40);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) fail(code);
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function exactKeys(value, keys, code) {
  const object = plain(value, code);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) fail(code);
  return object;
}

function signer(value) {
  if (!value || typeof value.sign !== "function") fail("entity360_domain_signer_required", 503);
  return value;
}

function verifier(value) {
  if (!value || typeof value.verify !== "function") fail("entity360_domain_verifier_required", 503);
  return value;
}

function attestation(signature, purpose, schemaVersion, domainSigner) {
  const signerCapability = signer(domainSigner);
  return {
    schema_version: schemaVersion,
    algorithm: requiredText(signerCapability.algorithm,
      "entity360_attestation_algorithm_invalid", 80),
    purpose,
    signer_domain: "host_native_governance",
    key_id: requiredText(signerCapability.key_id,
      "entity360_attestation_key_id_invalid", 160,
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u),
    signature: requiredText(signature, "entity360_attestation_signature_invalid", 200,
      /^hnc_[a-f0-9]{64}$/u),
  };
}

function verifyAttestation(value, signedPayload, domainVerifier, purpose, schemaVersion) {
  const proof = exactKeys(value, ATTESTATION_KEYS, "entity360_attestation_schema_invalid");
  if (proof.schema_version !== schemaVersion || proof.algorithm !== "hmac-sha256"
    || proof.purpose !== purpose || proof.signer_domain !== "host_native_governance"
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(String(proof.key_id || ""))
    || !/^hnc_[a-f0-9]{64}$/u.test(String(proof.signature || ""))
    || verifier(domainVerifier).verify(signedPayload, proof.signature,
      { purpose, key_id: proof.key_id }) !== true) {
    fail("entity360_attestation_verification_failed", 409);
  }
}

function currentPathOutcome(preflight) {
  const state = requiredText(preflight.state, "entity360_current_path_state_invalid", 100);
  const outcome = CURRENT_PATH_STATES[state];
  if (!outcome) fail("entity360_current_path_state_invalid");
  const executionAllowed = preflight.governance?.execution_allowed_by_preflight === true;
  if ((state === "ready_read_only") !== executionAllowed) {
    fail("entity360_current_path_execution_state_inconsistent", 409);
  }
  return { state, outcome };
}

export function buildVerifiedEntity360CurrentPathObservation({
  tenant_id,
  work_id,
  preflight,
  observed_at,
  domain_signer,
} = {}) {
  const tenantId = requiredText(tenant_id, "entity360_current_path_tenant_required", 120);
  const workId = requiredText(work_id, "entity360_current_path_work_required", 36, UUID).toLowerCase();
  const envelope = plain(preflight, "entity360_current_path_preflight_required");
  if (envelope.schema_version !== "skinharmony_work_preflight_v1") {
    fail("entity360_current_path_preflight_schema_invalid");
  }
  if (envelope.tenant_id !== tenantId || envelope.tenant_work_gallery?.tenant_id !== tenantId) {
    fail("entity360_current_path_tenant_binding_mismatch", 403);
  }
  if (String(envelope.work_binding?.work_id || "").toLowerCase() !== workId) {
    fail("entity360_current_path_work_binding_mismatch", 403);
  }
  const galleryWorks = Array.isArray(envelope.tenant_work_gallery?.works)
    ? envelope.tenant_work_gallery.works : [];
  const matches = galleryWorks.filter((work) => String(work?.work_id || "").toLowerCase() === workId);
  if (envelope.tenant_work_gallery?.available !== true
    || envelope.tenant_work_gallery?.state !== "ready" || matches.length !== 1) {
    fail("entity360_current_path_canonical_gallery_binding_required", 409);
  }
  const boundProject = String(envelope.work_binding?.project_id || "").trim();
  const galleryProject = String(matches[0]?.project_id || "").trim();
  if (boundProject && galleryProject && boundProject !== galleryProject) {
    fail("entity360_current_path_project_binding_mismatch", 409);
  }
  const preflightId = requiredText(envelope.preflight_id,
    "entity360_current_path_preflight_id_invalid", 80, PREFLIGHT_ID);
  const { state, outcome } = currentPathOutcome(envelope);
  const payload = {
    schema_version: "entity_360_verified_current_path_observation_v1",
    observation_id: preflightId,
    producer: "universal_core_work_preflight",
    tenant_scope: tenantId,
    work_id: workId,
    project_id: boundProject || galleryProject || null,
    current_path_stage: "work_preflight",
    current_path_state: state,
    current_path_outcome: outcome,
    current_path_context_digest: entity360Digest(envelope),
    observed_at: canonicalTimestamp(observed_at, "entity360_current_path_observed_at_invalid"),
    production_decision_changed: false,
    execution_authorized: false,
    authorization_effect: "NONE",
  };
  const signedPayload = { ...payload, observation_digest: entity360Digest(payload) };
  const signature = signer(domain_signer).sign(signedPayload, {
    purpose: ENTITY_360_CURRENT_PATH_OBSERVATION_SIGNING_PURPOSE,
  });
  return deepFreeze({
    ...signedPayload,
    observation_attestation: attestation(signature,
      ENTITY_360_CURRENT_PATH_OBSERVATION_SIGNING_PURPOSE,
      "entity_360_current_path_observation_attestation_v1", domain_signer),
  });
}

export function attestEntity360ShadowReceipt(receipt, domainSigner) {
  const value = plain(receipt, "entity360_shadow_receipt_required");
  if (Object.hasOwn(value, "receipt_attestation")) {
    fail("entity360_shadow_receipt_already_attested", 409);
  }
  const signature = signer(domainSigner).sign(value, {
    purpose: ENTITY_360_SHADOW_RECEIPT_SIGNING_PURPOSE,
  });
  return deepFreeze({
    ...value,
    receipt_attestation: attestation(signature,
      ENTITY_360_SHADOW_RECEIPT_SIGNING_PURPOSE,
      "entity_360_shadow_receipt_attestation_v1", domainSigner),
  });
}

export function verifyEntity360ShadowReceiptAttestation(receipt, domainVerifier) {
  const value = plain(receipt, "entity360_shadow_receipt_required");
  const { receipt_attestation: proof, ...signedPayload } = value;
  verifyAttestation(proof, signedPayload, domainVerifier,
    ENTITY_360_SHADOW_RECEIPT_SIGNING_PURPOSE,
    "entity_360_shadow_receipt_attestation_v1");
  return deepFreeze(signedPayload);
}

export function compareVerifiedEntity360CurrentPath({ snapshot, observation,
  domain_verifier, domain_signer } = {}) {
  const current = plain(snapshot, "entity360_snapshot_required");
  const observed = plain(observation, "entity360_current_path_observation_required");
  const { observation_attestation: observationProof, ...signedObservation } = observed;
  verifyAttestation(observationProof, signedObservation, domain_verifier,
    ENTITY_360_CURRENT_PATH_OBSERVATION_SIGNING_PURPOSE,
    "entity_360_current_path_observation_attestation_v1");
  const observationDigest = requiredText(observed.observation_digest,
    "entity360_current_path_observation_digest_invalid", 64, SHA256);
  const payload = { ...signedObservation };
  delete payload.observation_digest;
  if (observed.schema_version !== "entity_360_verified_current_path_observation_v1"
    || observed.producer !== "universal_core_work_preflight"
    || observed.authorization_effect !== "NONE"
    || observed.execution_authorized !== false
    || observed.production_decision_changed !== false
    || entity360Digest(payload) !== observationDigest) {
    fail("entity360_current_path_observation_verification_failed", 409);
  }
  const snapshotWorkId = String(current.project_work_linkage?.work_id || "").toLowerCase();
  if (current.tenant_scope !== observed.tenant_scope || snapshotWorkId !== observed.work_id) {
    fail("entity360_current_path_snapshot_binding_mismatch", 403);
  }
  const admissible = current.core_review_requirement?.admissible_outcomes || [];
  const diverged = !admissible.includes(observed.current_path_outcome);
  const comparison = {
    schema_version: "entity_360_shadow_comparison_v1",
    snapshot_digest: requiredText(current.deterministic_immutable_digest,
      "entity360_snapshot_digest_required", 64, SHA256),
    legacy_context_digest: observed.current_path_context_digest,
    legacy_outcome: observed.current_path_outcome,
    current_path_observation_id: observed.observation_id,
    current_path_observation_digest: observationDigest,
    current_path_stage: observed.current_path_stage,
    entity360_context_status: current.context_status,
    entity360_admissible_core_outcomes: admissible,
    diverged,
    reason_codes: diverged ? ["CURRENT_PATH_OUTCOME_OUTSIDE_ENTITY360_CONTEXT_ENVELOPE"] : [],
    comparison_evidence_state: "VERIFIED_UNIVERSAL_CORE_CURRENT_PATH_OBSERVATION",
    release_evidence_eligible: true,
    release_evidence_scope: "SHADOW_EVALUATION_ONLY",
    enforcement_evidence_eligible: false,
    production_decision_changed: false,
    execution_authorized: false,
    authorization_effect: "NONE",
    authority: "universal_core",
  };
  return attestEntity360ShadowReceipt({
    ...comparison,
    comparison_digest: entity360Digest(comparison),
  }, domain_signer);
}
